//! Il record di recovery persistente, i path di una transazione e la recovery
//! startup che conclude o annulla le transazioni lasciate a metà.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::schema::SchemaVersion;
use serde::{Deserialize, Serialize};

use super::disk::{
    io_error, read_regular_file, remove_dir_if_exists, remove_file_if_exists, sync_parent,
    sync_tree, valid_transaction_id,
};
use super::{
    SnapshotBundle, SnapshotError, SnapshotRecoveryReport, OLD_SUFFIX, RECORD_SUFFIX,
    REJECTED_SUFFIX, SNAPSHOT_SCHEMA_VERSION, STAGING_SUFFIX, TRANSACTION_PREFIX,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct RecoveryRecord {
    schema_version: SchemaVersion,
    transaction_id: String,
    root: String,
    staging: String,
    old: String,
    record: String,
    expected_manifest: Revision,
    pub(super) phase: RecoveryPhase,
}

#[derive(Deserialize)]
struct RecoverySchema {
    schema_version: SchemaVersion,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RecoveryPhase {
    Prepared,
    OldMoved,
    Published,
}

impl RecoveryRecord {
    pub(super) fn new(
        root: &Utf8Path,
        paths: &TransactionPaths,
        id: &str,
        expected: Revision,
    ) -> Self {
        Self {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            transaction_id: id.to_owned(),
            root: root.to_string(),
            staging: paths.staging.to_string(),
            old: paths.old.to_string(),
            record: paths.record.to_string(),
            expected_manifest: expected,
            phase: RecoveryPhase::Prepared,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct TransactionPaths {
    pub(super) staging: Utf8PathBuf,
    pub(super) old: Utf8PathBuf,
    pub(super) record: Utf8PathBuf,
    rejected: Utf8PathBuf,
}

impl TransactionPaths {
    pub(super) fn new(root: &Utf8Path, id: &str) -> Result<Self, SnapshotError> {
        let parent = root
            .parent()
            .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
        let name = root
            .file_name()
            .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
        let stem = format!("{TRANSACTION_PREFIX}{name}-{id}");
        Ok(Self {
            staging: parent.join(format!("{stem}{STAGING_SUFFIX}")),
            old: parent.join(format!("{stem}{OLD_SUFFIX}")),
            record: parent.join(format!("{stem}{RECORD_SUFFIX}")),
            rejected: parent.join(format!("{stem}{REJECTED_SUFFIX}")),
        })
    }
}

pub(super) fn recover_locked(root: &Utf8Path) -> Result<SnapshotRecoveryReport, SnapshotError> {
    let parent = root
        .parent()
        .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
    let Some(root_name) = root.file_name() else {
        return Err(SnapshotError::InvalidRoot(root.to_owned()));
    };
    let prefix = format!("{TRANSACTION_PREFIX}{root_name}-");
    let mut records = Vec::new();
    let read_dir = fs::read_dir(parent.as_std_path())
        .map_err(|source| io_error("scan snapshot recovery records", parent, source))?;
    for item in read_dir {
        let item =
            item.map_err(|source| io_error("read snapshot recovery record", parent, source))?;
        let name = item.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(&prefix) && name.ends_with(RECORD_SUFFIX) {
            records.push(parent.join(name));
        }
    }
    records.sort();
    let mut report = SnapshotRecoveryReport::default();
    for record_path in records {
        let bytes = read_regular_file(&record_path)?;
        let schema: RecoverySchema =
            serde_json::from_slice(&bytes).map_err(|error| SnapshotError::MalformedRecovery {
                path: record_path.clone(),
                reason: error.to_string(),
            })?;
        if schema.schema_version != SNAPSHOT_SCHEMA_VERSION {
            // Artefatto futuro o di un altro programma: non toccarlo.
            continue;
        }
        let record: RecoveryRecord =
            serde_json::from_slice(&bytes).map_err(|error| SnapshotError::MalformedRecovery {
                path: record_path.clone(),
                reason: error.to_string(),
            })?;
        if !valid_transaction_id(&record.transaction_id) {
            return Err(SnapshotError::MalformedRecovery {
                path: record_path,
                reason: "transaction id non canonico".into(),
            });
        }
        let paths = TransactionPaths::new(root, &record.transaction_id)?;
        if record_path != paths.record
            || record.root != root.as_str()
            || record.staging != paths.staging.as_str()
            || record.old != paths.old.as_str()
            || record.record != paths.record.as_str()
        {
            return Err(SnapshotError::MalformedRecovery {
                path: record_path,
                reason: "record punta a path inattesi".into(),
            });
        }
        match record.phase {
            RecoveryPhase::Prepared => {
                remove_dir_if_exists(&paths.staging)?;
                remove_file_if_exists(&paths.record)?;
            }
            RecoveryPhase::OldMoved => {
                if root.is_dir() {
                    if paths.old.is_dir() {
                        let current = SnapshotBundle::capture(root)?;
                        if current.manifest.digest() != record.expected_manifest {
                            return Err(SnapshotError::RecoveryNeeded {
                                transaction_id: record.transaction_id,
                                reason: "root presente ma non coerente durante OldMoved".into(),
                            });
                        }
                        remove_dir_if_exists(&paths.old)?;
                    }
                    // Il marker può essere stato scritto prima della rename:
                    // in questo caso il vault live non è stato toccato.
                    remove_dir_if_exists(&paths.staging)?;
                    remove_file_if_exists(&paths.record)?;
                } else {
                    if !paths.old.is_dir() {
                        return Err(SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id,
                            reason: "contenitore precedente mancante".into(),
                        });
                    }
                    fs::rename(paths.old.as_std_path(), root.as_std_path()).map_err(|source| {
                        SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id.clone(),
                            reason: format!("rollback della root precedente: {source}"),
                        }
                    })?;
                    sync_parent(parent)?;
                    remove_dir_if_exists(&paths.staging)?;
                    remove_file_if_exists(&paths.record)?;
                }
            }
            RecoveryPhase::Published => {
                if root.is_dir() {
                    let current = SnapshotBundle::capture(root)?;
                    if current.manifest.digest() == record.expected_manifest {
                        remove_dir_if_exists(&paths.old)?;
                        remove_dir_if_exists(&paths.staging)?;
                        remove_file_if_exists(&paths.record)?;
                    } else if !paths.old.is_dir() && paths.staging.is_dir() {
                        // Published era stato scritto prima della rename:
                        // root è ancora quella vecchia, quindi si annulla solo
                        // lo staging privato.
                        remove_dir_if_exists(&paths.staging)?;
                        remove_file_if_exists(&paths.record)?;
                    } else if paths.old.is_dir() {
                        // La root pubblicata non è quella che la transazione
                        // doveva scrivere, e la precedente è ancora intera.
                        report
                            .set_aside
                            .push(roll_back_published(root, parent, &paths, &record)?);
                    } else {
                        return Err(SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id,
                            reason: "root pubblicata non corrisponde al manifest atteso".into(),
                        });
                    }
                } else if paths.old.is_dir() && !paths.staging.is_dir() {
                    // Né root né staging: la recovery di prima si è fermata fra
                    // le due rename del ritorno indietro. La precedente torna
                    // al suo posto; ciò che era stato messo da parte resta lì.
                    restore_old_root(root, parent, &paths, &record)?;
                } else if paths.old.is_dir() && paths.staging.is_dir() {
                    // Crash dopo il marker Published ma prima della rename:
                    // completare il commit è deterministico e conserva la
                    // vecchia root fino alla verifica del nuovo manifest.
                    sync_tree(&paths.staging).map_err(|error| SnapshotError::RecoveryNeeded {
                        transaction_id: record.transaction_id.clone(),
                        reason: format!("preparazione della pubblicazione: {error}"),
                    })?;
                    fs::rename(paths.staging.as_std_path(), root.as_std_path()).map_err(
                        |source| SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id.clone(),
                            reason: format!("completamento della pubblicazione: {source}"),
                        },
                    )?;
                    sync_parent(parent)?;
                    let current = SnapshotBundle::capture(root)?;
                    if current.manifest.digest() != record.expected_manifest {
                        report
                            .set_aside
                            .push(roll_back_published(root, parent, &paths, &record)?);
                    } else {
                        remove_dir_if_exists(&paths.old)?;
                        remove_file_if_exists(&paths.record)?;
                    }
                } else {
                    return Err(SnapshotError::RecoveryNeeded {
                        transaction_id: record.transaction_id,
                        reason: "root pubblicata o contenitore precedente mancante".into(),
                    });
                }
            }
        }
        sync_parent(parent)?;
        report.recovered += 1;
    }
    Ok(report)
}
/// **Il ritorno alla root precedente** quando quella pubblicata non è la
/// root che la transazione doveva scrivere.
///
/// Senza, un vault restava chiuso per sempre: ogni apertura ripeteva la stessa
/// recovery e riceveva lo stesso `RecoveryNeeded`, con i dati dell'utente
/// parcheggiati nel contenitore `.old`. Tornare indietro è la metà «old» di
/// all-or-old-or-new; la root pubblicata però non si cancella, perché può
/// contenere scritture arrivate dopo la pubblicazione — si sposta accanto, in
/// `.rejected`, e il chiamante la trova nel rapporto.
///
/// Un crash fra le due rename lascia né root né staging, con il record ancora
/// in `Published`: è il caso che [`restore_old_root`] chiude alla recovery
/// seguente.
fn roll_back_published(
    root: &Utf8Path,
    parent: &Utf8Path,
    paths: &TransactionPaths,
    record: &RecoveryRecord,
) -> Result<Utf8PathBuf, SnapshotError> {
    if paths.rejected.exists() {
        return Err(SnapshotError::RecoveryNeeded {
            transaction_id: record.transaction_id.clone(),
            reason: format!("{} esiste già", paths.rejected),
        });
    }
    fs::rename(root.as_std_path(), paths.rejected.as_std_path()).map_err(|source| {
        SnapshotError::RecoveryNeeded {
            transaction_id: record.transaction_id.clone(),
            reason: format!("messa da parte della root pubblicata: {source}"),
        }
    })?;
    sync_parent(parent)?;
    restore_old_root(root, parent, paths, record)?;
    tracing::warn!(
        target: "fub.snapshot",
        transaction = %record.transaction_id,
        set_aside = %paths.rejected,
        "root pubblicata diversa dal manifest atteso: ripristinata la precedente"
    );
    Ok(paths.rejected.clone())
}

/// Rimette la root precedente al suo posto e chiude la transazione.
fn restore_old_root(
    root: &Utf8Path,
    parent: &Utf8Path,
    paths: &TransactionPaths,
    record: &RecoveryRecord,
) -> Result<(), SnapshotError> {
    fs::rename(paths.old.as_std_path(), root.as_std_path()).map_err(|source| {
        SnapshotError::RecoveryNeeded {
            transaction_id: record.transaction_id.clone(),
            reason: format!("rollback della root precedente: {source}"),
        }
    })?;
    sync_parent(parent)?;
    remove_dir_if_exists(&paths.staging)?;
    remove_file_if_exists(&paths.record)?;
    Ok(())
}

pub(super) fn finalize_record(
    paths: &TransactionPaths,
    _record: &RecoveryRecord,
) -> Result<(), SnapshotError> {
    remove_dir_if_exists(&paths.old)?;
    remove_file_if_exists(&paths.record)?;
    sync_parent(paths.record.parent().unwrap_or(Utf8Path::new(".")))?;
    Ok(())
}

pub(super) fn abort_precommit(paths: &TransactionPaths, error: SnapshotError) -> SnapshotError {
    let cleanup =
        remove_dir_if_exists(&paths.staging).and_then(|_| remove_file_if_exists(&paths.record));
    if let Err(cleanup) = cleanup {
        return SnapshotError::RecoveryNeeded {
            transaction_id: paths.record.to_string(),
            reason: format!("{error}; cleanup fallita: {cleanup}"),
        };
    }
    error
}
