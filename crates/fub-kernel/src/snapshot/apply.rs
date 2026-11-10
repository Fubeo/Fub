//! L'applicazione dello snapshot: fault injection dei test, report e
//! `SnapshotApplier` con prepare/commit/finalize, più le due funzioni brevi.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;

use super::disk::{
    acquire_lock, canonical_apply_root, create_private_directory, create_private_directory_all,
    io_error, persist_record, recovery_root, sync_parent, sync_tree, transaction_id,
    write_regular_file,
};
use super::recovery::{
    abort_precommit, finalize_record, recover_locked, RecoveryPhase, RecoveryRecord,
    TransactionPaths,
};
use super::{SnapshotBundle, SnapshotError};

/// Fault injection deterministica per i test del protocollo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotFault {
    /// Fallisce prima di creare lo staging.
    BeforeWrite,
    /// Lascia prepare e staging persistenti senza toccare il vault live.
    AfterPrepare,
    /// Fallisce dopo aver scritto `entries` payload nello staging.
    DuringWrite { entries: usize },
    /// Lascia `OldMoved`: la root live è assente, la vecchia è conservata.
    AfterOldMoved,
    /// Lascia `Published`: la root live è assente, staging e vecchia root esistono.
    AfterPublished,
    /// Fallisce subito dopo la pubblicazione della nuova root, prima di
    /// finalizzare e cancellare la vecchia.
    AfterCommit,
}

/// Report tipizzato di un'applicazione riuscita.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotApplyReport {
    /// Identificatore della transazione completata.
    pub transaction_id: String,
    /// Revisione di base confrontata sotto lock.
    pub base_revision: Revision,
    /// Numero di voci pubblicate.
    pub entries: usize,
    /// Le cache sono state invalidate rimuovendo la vecchia root; l'apertura
    /// successiva le ricostruisce.
    pub derived_invalidated: bool,
}

/// Report della recovery startup.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SnapshotRecoveryReport {
    /// Transazioni riconosciute e concluse.
    pub recovered: usize,
    /// Root pubblicate che non corrispondevano al manifest atteso: la recovery
    /// ha rimesso al loro posto le root precedenti e queste le ha solo spostate
    /// accanto, senza cancellarle.
    pub set_aside: Vec<Utf8PathBuf>,
}

/// Applica snapshot offline con prepare/commit/finalize e recovery persistente.
pub struct SnapshotApplier;

impl SnapshotApplier {
    /// Applica uno snapshot senza fault injection.
    pub fn apply(
        root: &Utf8Path,
        snapshot: &SnapshotBundle,
    ) -> Result<SnapshotApplyReport, SnapshotError> {
        Self::apply_with_fault(root, snapshot, None)
    }

    /// Variante per i test del protocollo; il fault non è una modalità di
    /// produzione e lascia artefatti riconoscibili dalla recovery.
    pub fn apply_with_fault(
        root: &Utf8Path,
        snapshot: &SnapshotBundle,
        fault: Option<SnapshotFault>,
    ) -> Result<SnapshotApplyReport, SnapshotError> {
        snapshot.validate()?;
        let root = canonical_apply_root(root)?;
        let _lock = acquire_lock(&root)?;
        recover_locked(&root)?;

        let current = SnapshotBundle::capture(&root)?;
        if current.manifest.digest() != *snapshot.base_revision() {
            return Err(SnapshotError::BaseRevisionStale {
                expected: snapshot.base_revision.clone(),
                found: current.manifest.digest(),
            });
        }
        if matches!(fault, Some(SnapshotFault::BeforeWrite)) {
            return Err(SnapshotError::FaultInjected("before write"));
        }

        let id = transaction_id();
        let paths = TransactionPaths::new(&root, &id)?;
        create_private_directory(&paths.staging)
            .map_err(|source| io_error("create snapshot staging", &paths.staging, source))?;
        sync_parent(paths.staging.parent().unwrap_or(Utf8Path::new(".")))
            .map_err(|error| abort_precommit(&paths, error))?;
        let mut record = RecoveryRecord::new(&root, &paths, &id, snapshot.manifest.digest());
        persist_record(&paths.record, &record).map_err(|error| abort_precommit(&paths, error))?;
        sync_parent(paths.record.parent().unwrap_or(Utf8Path::new(".")))
            .map_err(|error| abort_precommit(&paths, error))?;

        if matches!(fault, Some(SnapshotFault::AfterPrepare)) {
            return Err(SnapshotError::FaultInjected("after prepare"));
        }

        for (written, entry) in snapshot.manifest.entries.iter().enumerate() {
            if let Some(SnapshotFault::DuringWrite { entries }) = fault {
                if written >= entries {
                    return Err(abort_precommit(
                        &paths,
                        SnapshotError::FaultInjected("during write"),
                    ));
                }
            }
            let destination = paths.staging.join(&entry.path);
            if let Some(parent) = destination.parent() {
                create_private_directory_all(parent).map_err(|source| {
                    abort_precommit(&paths, io_error("create staged parent", parent, source))
                })?;
            }
            write_regular_file(
                &destination,
                snapshot.files.get(&entry.path).expect("validated payload"),
            )
            .map_err(|error| abort_precommit(&paths, error))?;
        }
        sync_tree(&paths.staging).map_err(|error| abort_precommit(&paths, error))?;

        // Ultima rilettura immediatamente prima del commit: il lock esclude gli
        // altri writer cooperativi, ma non può fermare processi esterni.
        let current = SnapshotBundle::capture(&root)?;
        if current.manifest.digest() != *snapshot.base_revision() {
            return Err(abort_precommit(
                &paths,
                SnapshotError::BaseRevisionStale {
                    expected: snapshot.base_revision.clone(),
                    found: current.manifest.digest(),
                },
            ));
        }
        record.phase = RecoveryPhase::OldMoved;
        persist_record(&paths.record, &record).map_err(|error| abort_precommit(&paths, error))?;
        fs::rename(root.as_std_path(), paths.old.as_std_path()).map_err(|source| {
            SnapshotError::RecoveryNeeded {
                transaction_id: id.clone(),
                reason: format!("move old snapshot root: {source}"),
            }
        })?;
        sync_parent(paths.old.parent().unwrap_or(Utf8Path::new("."))).map_err(|error| {
            SnapshotError::RecoveryNeeded {
                transaction_id: id.clone(),
                reason: format!("sync old snapshot root: {error}"),
            }
        })?;

        if matches!(fault, Some(SnapshotFault::AfterOldMoved)) {
            return Err(SnapshotError::FaultInjected("after old moved"));
        }

        // Il marker Published è persistente prima della rename: dopo un crash
        // la recovery può distinguere una pubblicazione non ancora iniziata
        // dalla nuova root già resa visibile.
        record.phase = RecoveryPhase::Published;
        persist_record(&paths.record, &record).map_err(|error| SnapshotError::RecoveryNeeded {
            transaction_id: id.clone(),
            reason: format!("persist published marker: {error}"),
        })?;

        if matches!(fault, Some(SnapshotFault::AfterPublished)) {
            return Err(SnapshotError::FaultInjected("after published"));
        }

        fs::rename(paths.staging.as_std_path(), root.as_std_path()).map_err(|source| {
            // Il vecchio contenitore è ancora disponibile. La recovery può
            // ripetere esattamente il rollback se la rename fallisce.
            SnapshotError::RecoveryNeeded {
                transaction_id: id.clone(),
                reason: format!("publish new snapshot root: {source}"),
            }
        })?;
        sync_parent(root.parent().unwrap_or(Utf8Path::new("."))).map_err(|error| {
            SnapshotError::RecoveryNeeded {
                transaction_id: id.clone(),
                reason: format!("sync published root: {error}"),
            }
        })?;
        if matches!(fault, Some(SnapshotFault::AfterCommit)) {
            return Err(SnapshotError::FaultInjected("after commit"));
        }

        finalize_record(&paths, &record).map_err(|error| SnapshotError::RecoveryNeeded {
            transaction_id: id.clone(),
            reason: format!("finalize snapshot: {error}"),
        })?;
        Ok(SnapshotApplyReport {
            transaction_id: id,
            base_revision: snapshot.base_revision.clone(),
            entries: snapshot.manifest.entries.len(),
            derived_invalidated: true,
        })
    }

    /// Riconosce e risolve soltanto record con schema e nomi propri.
    pub fn recover(root: &Utf8Path) -> Result<SnapshotRecoveryReport, SnapshotError> {
        let root = recovery_root(root)?;
        let _lock = acquire_lock(&root)?;
        recover_locked(&root)
    }
}

/// Funzione breve per il caso comune.
pub fn apply_snapshot(
    root: &Utf8Path,
    snapshot: &SnapshotBundle,
) -> Result<SnapshotApplyReport, SnapshotError> {
    SnapshotApplier::apply(root, snapshot)
}

/// Funzione breve per la recovery startup.
pub fn recover_snapshots(root: &Utf8Path) -> Result<SnapshotRecoveryReport, SnapshotError> {
    SnapshotApplier::recover(root)
}
