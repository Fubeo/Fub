//! Snapshot globale offline del contenuto autorevole di un vault.
//!
//! Questo modulo possiede il formato, il preflight e la transazione di
//! sostituzione. Non apre un [`Workspace`] e non conosce provider o watcher:
//! l'host chiude/quiesce il vault prima dell'applicazione e lo riapre dopo.
//!
//! Il manifest è una fotografia deterministica. Ogni voce porta path relativo
//! normalizzato, classe, proprietario, schema (quando il formato lo dichiara),
//! dimensione e SHA-256. Le cache note (`.fub/data/entries.json` e lo spazio
//! dati derivato dei plugin) non entrano nel manifest; alla riapertura vengono
//! ricostruite dal kernel.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::schema::SchemaVersion;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Schema del contenitore e del record di recovery.
pub const SNAPSHOT_SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);
const MANIFEST_FILE: &str = "manifest.json";
const PAYLOAD_DIR: &str = "payload";
const TRANSACTION_PREFIX: &str = ".fub-snapshot-";
const LOCK_SUFFIX: &str = ".snapshot.lock";
const RECORD_SUFFIX: &str = ".record";
const STAGING_SUFFIX: &str = ".staging";
const OLD_SUFFIX: &str = ".old";
static TRANSACTION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Classificazione esplicita della voce nel manifest.
///
/// `Unknown` è intenzionale: un file che nessun provider riconosce resta parte
/// dello snapshot e non viene promosso a cache dal solo nome.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotClass {
    /// Documento riconosciuto dal catalogo statico minimo del kernel.
    Document,
    /// Allegato o altro contenuto utente binario.
    Attachment,
    /// File utente non riconosciuto.
    Unknown,
    /// Voce del cestino condiviso del vault.
    Trash,
    /// Impostazioni del vault.
    Settings,
    /// Sidecar di organizzazione del vault.
    Organization,
    /// Bozza non consolidata.
    Draft,
    /// Registro delle mutazioni.
    Journal,
    /// Sidecar autorevole del cestino.
    Sidecar,
    /// Storage persistente posseduto da un plugin.
    Plugin,
}

/// Una voce verificata del manifest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotEntry {
    /// Path relativo alla radice del vault, con separatori `/`.
    pub path: String,
    /// Classe assegnata dal catalogo, non dedotta genericamente dalla radice.
    pub class: SnapshotClass,
    /// Proprietario logico (`user`, `kernel`, `plugin:<id>` o `trash`).
    pub owner: String,
    /// Schema del formato persistente, quando applicabile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<SchemaVersion>,
    /// Dimensione in byte.
    pub size: u64,
    /// Digest SHA-256 canonico con prefisso `sha256:`.
    pub digest: Revision,
}

/// Manifest deterministico dello stato autorevole.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotManifest {
    /// Versione del formato del manifest.
    pub schema_version: SchemaVersion,
    /// Voci ordinate lessicograficamente per `path`.
    pub entries: Vec<SnapshotEntry>,
}

impl SnapshotManifest {
    /// Crea un manifest ordinando le voci per path e verificando i duplicati.
    pub fn new(mut entries: Vec<SnapshotEntry>) -> Result<Self, SnapshotError> {
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        let manifest = Self {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            entries,
        };
        manifest.validate_structure()?;
        Ok(manifest)
    }

    /// Digest deterministico del manifest, usato come revisione globale.
    pub fn digest(&self) -> Revision {
        // `serde_json` serializza i campi di una struct nel loro ordine
        // dichiarato; `entries` è già ordinato e non contiene mappe arbitrarie.
        let bytes = serde_json::to_vec(self).expect("SnapshotManifest è serializzabile");
        Revision::of_bytes(&bytes)
    }

    /// Verifica schema, path, proprietari, classi e duplicati, senza leggere
    /// payload. È quindi sicuro da chiamare prima di ogni mutazione.
    pub fn validate_structure(&self) -> Result<(), SnapshotError> {
        if self.schema_version > SNAPSHOT_SCHEMA_VERSION {
            return Err(SnapshotError::FutureSchema {
                path: MANIFEST_FILE.into(),
                found: self.schema_version,
                supported: SNAPSHOT_SCHEMA_VERSION,
            });
        }
        if self.schema_version < SNAPSHOT_SCHEMA_VERSION {
            return Err(SnapshotError::SchemaMismatch {
                path: MANIFEST_FILE.into(),
                expected: SNAPSHOT_SCHEMA_VERSION,
                found: self.schema_version,
            });
        }

        let mut paths = BTreeSet::new();
        let mut previous_path: Option<&str> = None;
        for entry in &self.entries {
            validate_relative_path(&entry.path)?;
            if !paths.insert(entry.path.clone()) {
                return Err(SnapshotError::DuplicatePath(entry.path.clone()));
            }
            if let Some(previous) = previous_path {
                if previous >= entry.path.as_str() {
                    return Err(SnapshotError::UnsortedManifest {
                        previous: previous.to_owned(),
                        current: entry.path.clone(),
                    });
                }
            }
            previous_path = Some(&entry.path);
            validate_owner(&entry.owner)?;
            validate_digest(&entry.digest, &entry.path)?;
            validate_catalog_entry(entry)?;
        }
        Ok(())
    }

    /// Verifica anche dimensioni e digest dei byte associati.
    pub fn validate_files(&self, files: &BTreeMap<String, Vec<u8>>) -> Result<(), SnapshotError> {
        self.validate_structure()?;
        let expected: BTreeSet<_> = self
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        for entry in &self.entries {
            let bytes = files
                .get(&entry.path)
                .ok_or_else(|| SnapshotError::MissingEntry(entry.path.clone()))?;
            if bytes.len() as u64 != entry.size {
                return Err(SnapshotError::SizeMismatch {
                    path: entry.path.clone(),
                    expected: entry.size,
                    found: bytes.len() as u64,
                });
            }
            let digest = Revision::of_bytes(bytes);
            if digest != entry.digest {
                return Err(SnapshotError::DigestMismatch {
                    path: entry.path.clone(),
                    expected: entry.digest.clone(),
                    found: digest,
                });
            }
        }
        if let Some(path) = files.keys().find(|path| !expected.contains(path.as_str())) {
            return Err(SnapshotError::UnexpectedEntry(path.clone()));
        }
        Ok(())
    }
}

/// Snapshot completo in memoria: manifest, revisione di base e payload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotBundle {
    manifest: SnapshotManifest,
    base_revision: Revision,
    files: BTreeMap<String, Vec<u8>>,
}

impl SnapshotBundle {
    /// Costruisce uno snapshot da manifest e payload. La validazione completa è
    /// ripetuta anche da [`SnapshotApplier::apply`], quindi un errore non può
    /// arrivare alla prima rename.
    pub fn new(
        manifest: SnapshotManifest,
        base_revision: Revision,
        files: BTreeMap<String, Vec<u8>>,
    ) -> Result<Self, SnapshotError> {
        let bundle = Self {
            manifest,
            base_revision,
            files,
        };
        bundle.validate()?;
        Ok(bundle)
    }

    /// Cattura lo stato autorevole del vault senza includere dati derivati.
    pub fn capture(root: &Utf8Path) -> Result<Self, SnapshotError> {
        let metadata = symlink_metadata(root)?;
        if !metadata.is_dir() {
            return Err(SnapshotError::InvalidRoot(root.to_owned()));
        }
        let mut files = BTreeMap::new();
        collect_authoritative(root, root, &mut files)?;
        let entries = files
            .iter()
            .map(|(path, bytes)| entry_for_path(path, bytes))
            .collect::<Result<Vec<_>, _>>()?;
        let manifest = SnapshotManifest::new(entries)?;
        let base_revision = manifest.digest();
        let bundle = Self {
            manifest,
            base_revision,
            files,
        };
        bundle.validate()?;
        Ok(bundle)
    }

    /// Legge un contenitore snapshot (`manifest.json` + `payload/`).
    pub fn read_from(path: &Utf8Path) -> Result<Self, SnapshotError> {
        let metadata = symlink_metadata(path)?;
        if !metadata.is_dir() {
            return Err(SnapshotError::InvalidArtifact(path.to_owned()));
        }
        let manifest_path = path.join(MANIFEST_FILE);
        let bytes = read_regular_file(&manifest_path)?;
        let envelope: SnapshotEnvelope =
            serde_json::from_slice(&bytes).map_err(|error| SnapshotError::MalformedArtifact {
                path: manifest_path,
                reason: error.to_string(),
            })?;
        if envelope.schema_version > SNAPSHOT_SCHEMA_VERSION {
            return Err(SnapshotError::FutureSchema {
                path: MANIFEST_FILE.into(),
                found: envelope.schema_version,
                supported: SNAPSHOT_SCHEMA_VERSION,
            });
        }
        if envelope.schema_version < SNAPSHOT_SCHEMA_VERSION {
            return Err(SnapshotError::SchemaMismatch {
                path: MANIFEST_FILE.into(),
                expected: SNAPSHOT_SCHEMA_VERSION,
                found: envelope.schema_version,
            });
        }
        envelope.manifest.validate_structure()?;
        let payload_root = path.join(PAYLOAD_DIR);
        let payload_metadata = symlink_metadata(&payload_root)?;
        if !payload_metadata.is_dir() {
            return Err(SnapshotError::InvalidArtifact(payload_root));
        }
        let expected: BTreeSet<&str> = envelope
            .manifest
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        validate_payload_tree(&payload_root, "", &expected)?;
        let mut files = BTreeMap::new();
        for entry in &envelope.manifest.entries {
            let payload = payload_root.join(&entry.path);
            let bytes = match read_regular_file(&payload) {
                Err(SnapshotError::Io { source, .. })
                    if source.kind() == io::ErrorKind::NotFound =>
                {
                    return Err(SnapshotError::MissingEntry(entry.path.clone()));
                }
                result => result,
            }?;
            files.insert(entry.path.clone(), bytes);
        }

        Self::new(envelope.manifest, envelope.base_revision, files)
    }

    /// Pubblica il contenitore con una directory temporanea sorella e rename.
    pub fn write_to(&self, path: &Utf8Path) -> Result<(), SnapshotError> {
        self.validate()?;
        if path.exists() {
            return Err(SnapshotError::AlreadyExists(path.to_owned()));
        }
        let parent = path
            .parent()
            .ok_or_else(|| SnapshotError::InvalidArtifact(path.to_owned()))?;
        fs::create_dir_all(parent)
            .map_err(|source| io_error("create snapshot parent", parent, source))?;
        let temporary = parent.join(format!(".{MANIFEST_FILE}.{}", transaction_id()));
        if let Err(error) = self.write_container(&temporary) {
            let _ = fs::remove_dir_all(temporary.as_std_path());
            return Err(error);
        }
        fs::rename(temporary.as_std_path(), path.as_std_path())
            .map_err(|source| io_error("publish snapshot", path, source))?;
        sync_parent(parent);
        Ok(())
    }

    /// Manifest pubblico in sola lettura.
    pub fn manifest(&self) -> &SnapshotManifest {
        &self.manifest
    }

    /// Revisione globale del manifest autorevole da cui lo snapshot è stato
    /// catturato.
    pub fn base_revision(&self) -> &Revision {
        &self.base_revision
    }

    /// Payload verificato per un path.
    pub fn bytes(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }

    /// Numero di file autorevoli nello snapshot.
    pub fn len(&self) -> usize {
        self.files.len()
    }

    /// Indica se il payload è vuoto.
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    fn validate(&self) -> Result<(), SnapshotError> {
        self.manifest.validate_files(&self.files)?;
        validate_digest(&self.base_revision, "<base_revision>")?;
        Ok(())
    }

    fn write_container(&self, path: &Utf8Path) -> Result<(), SnapshotError> {
        fs::create_dir_all(path.join(PAYLOAD_DIR).as_std_path())
            .map_err(|source| io_error("create snapshot staging", path, source))?;
        let envelope = SnapshotEnvelope {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            base_revision: self.base_revision.clone(),
            manifest: self.manifest.clone(),
        };
        let manifest = serde_json::to_vec(&envelope)
            .map_err(|error| SnapshotError::Serialization(error.to_string()))?;
        write_regular_file(&path.join(MANIFEST_FILE), &manifest)?;
        for (relative, bytes) in &self.files {
            let destination = path.join(PAYLOAD_DIR).join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent.as_std_path())
                    .map_err(|source| io_error("create snapshot payload parent", parent, source))?;
            }
            write_regular_file(&destination, bytes)?;
        }
        sync_dir(path);
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SnapshotEnvelope {
    schema_version: SchemaVersion,
    base_revision: Revision,
    manifest: SnapshotManifest,
}

/// Fault injection deterministica per i test del protocollo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotFault {
    /// Fallisce prima di creare lo staging.
    BeforeWrite,
    /// Lascia prepare e staging persistenti senza toccare il vault live.
    AfterPrepare,
    /// Fallisce dopo aver scritto `entries` payload nello staging.
    DuringWrite { entries: usize },
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
        let metadata = symlink_metadata(root)?;
        if !metadata.is_dir() {
            return Err(SnapshotError::InvalidRoot(root.to_owned()));
        }
        let root = absolute_utf8(root)?;
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
        fs::create_dir(&paths.staging)
            .map_err(|source| io_error("create snapshot staging", &paths.staging, source))?;
        let mut record = RecoveryRecord::new(&root, &paths, &id, snapshot.manifest.digest());
        persist_record(&paths.record, &record)?;
        sync_parent(paths.record.parent().unwrap_or(Utf8Path::new(".")));

        if matches!(fault, Some(SnapshotFault::AfterPrepare)) {
            return Err(SnapshotError::FaultInjected("after prepare"));
        }

        let mut written = 0usize;
        for entry in &snapshot.manifest.entries {
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
                fs::create_dir_all(parent.as_std_path()).map_err(|source| {
                    abort_precommit(&paths, io_error("create staged parent", parent, source))
                })?;
            }
            write_regular_file(
                &destination,
                snapshot.files.get(&entry.path).expect("validated payload"),
            )
            .map_err(|error| abort_precommit(&paths, error))?;
            written += 1;
        }
        sync_dir(&paths.staging);

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
        persist_record(&paths.record, &record)?;
        fs::rename(root.as_std_path(), paths.old.as_std_path()).map_err(|source| {
            SnapshotError::RecoveryNeeded {
                transaction_id: id.clone(),
                reason: format!("move old snapshot root: {source}"),
            }
        })?;
        sync_parent(paths.old.parent().unwrap_or(Utf8Path::new(".")));

        // Il marker Published è persistente prima della rename: dopo un crash
        // la recovery può distinguere una pubblicazione non ancora iniziata
        // dalla nuova root già resa visibile.
        record.phase = RecoveryPhase::Published;
        persist_record(&paths.record, &record)?;

        fs::rename(paths.staging.as_std_path(), root.as_std_path()).map_err(|source| {
            // Il vecchio contenitore è ancora disponibile. La recovery può
            // ripetere esattamente il rollback se la rename fallisce.
            SnapshotError::RecoveryNeeded {
                transaction_id: id.clone(),
                reason: format!("publish new snapshot root: {source}"),
            }
        })?;
        sync_parent(root.parent().unwrap_or(Utf8Path::new(".")));

        if matches!(fault, Some(SnapshotFault::AfterCommit)) {
            return Err(SnapshotError::FaultInjected("after commit"));
        }

        finalize_record(&paths, &record)?;
        Ok(SnapshotApplyReport {
            transaction_id: id,
            base_revision: snapshot.base_revision.clone(),
            entries: snapshot.manifest.entries.len(),
            derived_invalidated: true,
        })
    }

    /// Riconosce e risolve soltanto record con schema e nomi propri.
    pub fn recover(root: &Utf8Path) -> Result<SnapshotRecoveryReport, SnapshotError> {
        let root = absolute_utf8(root)?;
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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RecoveryRecord {
    schema_version: SchemaVersion,
    transaction_id: String,
    root: String,
    staging: String,
    old: String,
    record: String,
    expected_manifest: Revision,
    phase: RecoveryPhase,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RecoveryPhase {
    Prepared,
    OldMoved,
    Published,
}

impl RecoveryRecord {
    fn new(root: &Utf8Path, paths: &TransactionPaths, id: &str, expected: Revision) -> Self {
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
struct TransactionPaths {
    staging: Utf8PathBuf,
    old: Utf8PathBuf,
    record: Utf8PathBuf,
}

impl TransactionPaths {
    fn new(root: &Utf8Path, id: &str) -> Result<Self, SnapshotError> {
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
        })
    }
}

fn recover_locked(root: &Utf8Path) -> Result<SnapshotRecoveryReport, SnapshotError> {
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
        let record: RecoveryRecord =
            serde_json::from_slice(&bytes).map_err(|error| SnapshotError::MalformedRecovery {
                path: record_path.clone(),
                reason: error.to_string(),
            })?;
        if record.schema_version != SNAPSHOT_SCHEMA_VERSION {
            // Artefatto futuro o di un altro programma: non toccarlo.
            continue;
        }
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
                    } else {
                        return Err(SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id,
                            reason: "root pubblicata non corrisponde al manifest atteso".into(),
                        });
                    }
                } else if paths.old.is_dir() && paths.staging.is_dir() {
                    // Crash dopo il marker Published ma prima della rename:
                    // completare il commit è deterministico e conserva la
                    // vecchia root fino alla verifica del nuovo manifest.
                    fs::rename(paths.staging.as_std_path(), root.as_std_path()).map_err(
                        |source| SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id.clone(),
                            reason: format!("completamento della pubblicazione: {source}"),
                        },
                    )?;
                    let current = SnapshotBundle::capture(root)?;
                    if current.manifest.digest() != record.expected_manifest {
                        return Err(SnapshotError::RecoveryNeeded {
                            transaction_id: record.transaction_id,
                            reason: "nuova root non coerente dopo recovery".into(),
                        });
                    }
                    remove_dir_if_exists(&paths.old)?;
                    remove_file_if_exists(&paths.record)?;
                } else {
                    return Err(SnapshotError::RecoveryNeeded {
                        transaction_id: record.transaction_id,
                        reason: "root pubblicata o contenitore precedente mancante".into(),
                    });
                }
            }
        }
        sync_parent(parent);
        report.recovered += 1;
    }
    Ok(report)
}

fn finalize_record(
    paths: &TransactionPaths,
    _record: &RecoveryRecord,
) -> Result<(), SnapshotError> {
    remove_dir_if_exists(&paths.old)?;
    remove_file_if_exists(&paths.record)?;
    sync_parent(paths.record.parent().unwrap_or(Utf8Path::new(".")));
    Ok(())
}

fn abort_precommit(paths: &TransactionPaths, error: SnapshotError) -> SnapshotError {
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

fn acquire_lock(root: &Utf8Path) -> Result<File, SnapshotError> {
    let parent = root
        .parent()
        .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
    let name = root
        .file_name()
        .ok_or_else(|| SnapshotError::InvalidRoot(root.to_owned()))?;
    let path = parent.join(format!(".{name}{LOCK_SUFFIX}"));
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path.as_std_path())
        .map_err(|source| io_error("open snapshot lock", &path, source))?;
    file.lock()
        .map_err(|source| io_error("acquire snapshot lock", &path, source))?;
    Ok(file)
}

fn collect_authoritative(
    root: &Utf8Path,
    directory: &Utf8Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), SnapshotError> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(directory.as_std_path())
        .map_err(|source| io_error("enumerate vault", directory, source))?;
    for item in read_dir {
        let item = item.map_err(|source| io_error("read vault entry", directory, source))?;
        entries.push(item.path());
    }
    entries.sort();
    for path in entries {
        let metadata = symlink_metadata_path(&path)?;
        let relative = path
            .strip_prefix(root.as_std_path())
            .map_err(|_| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let relative = normalize_path(relative)?;
        if metadata.is_dir() {
            if is_derived_directory(&relative) {
                continue;
            }
            let child = Utf8PathBuf::from_path_buf(path)
                .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
            collect_authoritative(root, &child, files)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(SnapshotError::UnsupportedFile(relative));
        }
        if is_derived_file(&relative) {
            continue;
        }
        let child = Utf8PathBuf::from_path_buf(path)
            .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let bytes = fs::read(child.as_std_path())
            .map_err(|source| io_error("read vault entry", &child, source))?;
        files.insert(relative, bytes);
    }
    Ok(())
}

fn validate_payload_tree(
    directory: &Utf8Path,
    relative: &str,
    expected: &BTreeSet<&str>,
) -> Result<(), SnapshotError> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(directory.as_std_path())
        .map_err(|source| io_error("enumerate snapshot payload", directory, source))?;
    for item in read_dir {
        let item = item.map_err(|source| io_error("read snapshot payload", directory, source))?;
        entries.push(item.path());
    }
    entries.sort();
    for path in entries {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let child_relative = if relative.is_empty() {
            name.to_owned()
        } else {
            format!("{relative}/{name}")
        };
        validate_relative_path(&child_relative)?;
        let metadata = symlink_metadata_path(&path)?;
        if metadata.is_dir() {
            let child = Utf8PathBuf::from_path_buf(path)
                .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
            validate_payload_tree(&child, &child_relative, expected)?;
        } else if metadata.is_file() {
            if !expected.contains(child_relative.as_str()) {
                return Err(SnapshotError::UnexpectedEntry(child_relative));
            }
        } else {
            return Err(SnapshotError::UnsupportedFile(child_relative));
        }
    }
    Ok(())
}

fn entry_for_path(path: &str, bytes: &[u8]) -> Result<SnapshotEntry, SnapshotError> {
    let (class, owner, schema) = classify_path(path)?;
    Ok(SnapshotEntry {
        path: path.to_owned(),
        class,
        owner,
        schema,
        size: bytes.len() as u64,
        digest: Revision::of_bytes(bytes),
    })
}

fn classify_path(
    path: &str,
) -> Result<(SnapshotClass, String, Option<SchemaVersion>), SnapshotError> {
    validate_relative_path(path)?;
    if path == ".fub/settings.json" {
        return Ok((
            SnapshotClass::Settings,
            "kernel".into(),
            Some(crate::settings::SCHEMA_VERSION),
        ));
    }
    if path == ".fub/workspace.json" {
        return Ok((
            SnapshotClass::Organization,
            "kernel".into(),
            Some(crate::organization::SCHEMA_VERSION),
        ));
    }
    if path == ".fub/journal.jsonl" {
        return Ok((
            SnapshotClass::Journal,
            "kernel".into(),
            Some(crate::journal::SCHEMA_VERSION),
        ));
    }
    if path.starts_with(".fub/drafts/") {
        return Ok((
            SnapshotClass::Draft,
            "kernel".into(),
            Some(crate::drafts::SCHEMA_VERSION),
        ));
    }
    if path.starts_with(".fub/data/trash/") {
        return Ok((
            SnapshotClass::Sidecar,
            "kernel".into(),
            Some(crate::vault::SCHEMA_VERSION),
        ));
    }
    if let Some(rest) = path.strip_prefix(".fub/plugins/") {
        let owner = rest
            .split('/')
            .next()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| SnapshotError::InvalidPath(path.to_owned()))?;
        return Ok((SnapshotClass::Plugin, format!("plugin:{owner}"), None));
    }
    if path == ".fub/data/entries.json" || is_derived_directory(path) {
        return Err(SnapshotError::ExcludedDerived(path.to_owned()));
    }
    if path.starts_with(".trash/") {
        return Ok((SnapshotClass::Trash, "trash".into(), None));
    }
    if path.starts_with("attachments/") {
        return Ok((SnapshotClass::Attachment, "user".into(), None));
    }
    let class = SnapshotClass::Unknown;
    Ok((class, "user".into(), None))
}

fn validate_catalog_entry(entry: &SnapshotEntry) -> Result<(), SnapshotError> {
    let (class, owner, schema) = classify_path(&entry.path)?;
    let class_matches = if class == SnapshotClass::Unknown && owner == "user" {
        matches!(
            entry.class,
            SnapshotClass::Document | SnapshotClass::Attachment | SnapshotClass::Unknown
        )
    } else {
        class == entry.class
    };
    if !class_matches || owner != entry.owner {
        return Err(SnapshotError::EntryClassMismatch(entry.path.clone()));
    }
    match (schema, entry.schema) {
        (Some(expected), Some(found)) if found > expected => Err(SnapshotError::FutureSchema {
            path: entry.path.clone(),
            found,
            supported: expected,
        }),
        (Some(expected), Some(found)) if expected != found => Err(SnapshotError::SchemaMismatch {
            path: entry.path.clone(),
            expected,
            found,
        }),
        (Some(expected), None) => Err(SnapshotError::SchemaMissing {
            path: entry.path.clone(),
            expected,
        }),
        (None, Some(_))
            if matches!(
                entry.class,
                SnapshotClass::Document
                    | SnapshotClass::Attachment
                    | SnapshotClass::Unknown
                    | SnapshotClass::Trash
            ) =>
        {
            Err(SnapshotError::UnexpectedSchema(entry.path.clone()))
        }
        _ => Ok(()),
    }
}

fn validate_relative_path(path: &str) -> Result<(), SnapshotError> {
    if path.is_empty() || path.contains('\\') || path.contains('\0') || path.starts_with('/') {
        return Err(SnapshotError::InvalidPath(path.to_owned()));
    }
    let candidate = Path::new(path);
    let mut saw = false;
    for component in candidate.components() {
        match component {
            Component::Normal(name) if !name.is_empty() => saw = true,
            _ => return Err(SnapshotError::InvalidPath(path.to_owned())),
        }
    }
    if !saw || candidate.to_string_lossy() != path {
        return Err(SnapshotError::InvalidPath(path.to_owned()));
    }
    Ok(())
}

fn validate_owner(owner: &str) -> Result<(), SnapshotError> {
    if owner.is_empty() || owner.contains('/') || owner.contains('\\') || owner.contains('\0') {
        return Err(SnapshotError::InvalidOwner(owner.to_owned()));
    }
    Ok(())
}

fn validate_digest(digest: &Revision, path: &str) -> Result<(), SnapshotError> {
    let Some(hex) = digest.as_str().strip_prefix("sha256:") else {
        return Err(SnapshotError::InvalidDigest(path.to_owned()));
    };
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(SnapshotError::InvalidDigest(path.to_owned()));
    }
    Ok(())
}

fn normalize_path(path: &Path) -> Result<String, SnapshotError> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(component) = component else {
            return Err(SnapshotError::InvalidPath(
                path.to_string_lossy().into_owned(),
            ));
        };
        let component = component
            .to_str()
            .ok_or_else(|| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))?;
        if component.is_empty() {
            return Err(SnapshotError::InvalidPath(
                path.to_string_lossy().into_owned(),
            ));
        }
        parts.push(component);
    }
    if parts.is_empty() {
        return Err(SnapshotError::InvalidPath(
            path.to_string_lossy().into_owned(),
        ));
    }
    Ok(parts.join("/"))
}

fn is_derived_directory(path: &str) -> bool {
    path == ".fub/data/plugins" || path.starts_with(".fub/data/plugins/")
}

fn is_derived_file(path: &str) -> bool {
    path == ".fub/data/entries.json"
}

fn read_regular_file(path: &Utf8Path) -> Result<Vec<u8>, SnapshotError> {
    let metadata = symlink_metadata(path)?;
    if !metadata.is_file() {
        return Err(SnapshotError::UnsupportedFile(path.to_string()));
    }
    fs::read(path.as_std_path()).map_err(|source| io_error("read snapshot payload", path, source))
}

fn write_regular_file(path: &Utf8Path, bytes: &[u8]) -> Result<(), SnapshotError> {
    if let Ok(metadata) = fs::symlink_metadata(path.as_std_path()) {
        if !metadata.is_file() {
            return Err(SnapshotError::UnsupportedFile(path.to_string()));
        }
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path.as_std_path())
        .map_err(|source| io_error("create snapshot payload", path, source))?;
    if let Err(source) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(path.as_std_path());
        return Err(io_error("write snapshot payload", path, source));
    }
    Ok(())
}

fn persist_record(path: &Utf8Path, record: &RecoveryRecord) -> Result<(), SnapshotError> {
    let bytes = serde_json::to_vec(record)
        .map_err(|error| SnapshotError::Serialization(error.to_string()))?;
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    let mut file = options
        .open(path.as_std_path())
        .map_err(|source| io_error("open snapshot recovery record", path, source))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|source| io_error("write snapshot recovery record", path, source))?;
    Ok(())
}

fn remove_file_if_exists(path: &Utf8Path) -> Result<(), SnapshotError> {
    match fs::remove_file(path.as_std_path()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error("remove snapshot recovery record", path, source)),
    }
}

fn remove_dir_if_exists(path: &Utf8Path) -> Result<(), SnapshotError> {
    match fs::remove_dir_all(path.as_std_path()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error(
            "remove snapshot transaction directory",
            path,
            source,
        )),
    }
}

fn sync_dir(path: &Utf8Path) {
    let _ = File::open(path.as_std_path()).and_then(|file| file.sync_all());
}

fn sync_parent(path: &Utf8Path) {
    if let Some(parent) = path.parent() {
        sync_dir(parent);
    }
}

fn symlink_metadata(path: &Utf8Path) -> Result<std::fs::Metadata, SnapshotError> {
    symlink_metadata_path(path.as_std_path())
}

fn symlink_metadata_path(path: &Path) -> Result<std::fs::Metadata, SnapshotError> {
    fs::symlink_metadata(path).map_err(|source| SnapshotError::Io {
        operation: "stat snapshot path".into(),
        path: path.to_string_lossy().into_owned(),
        source,
    })
}

fn absolute_utf8(path: &Utf8Path) -> Result<Utf8PathBuf, SnapshotError> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|source| io_error("resolve snapshot root", path, source))
            .and_then(|cwd| {
                Utf8PathBuf::from_path_buf(cwd)
                    .map_err(|path| SnapshotError::InvalidPath(path.to_string_lossy().into_owned()))
            })?
            .join(path)
    };
    Ok(absolute)
}

fn valid_transaction_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn transaction_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = TRANSACTION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{now:x}-{}-{sequence:x}", std::process::id())
}

fn io_error(operation: &str, path: &Utf8Path, source: io::Error) -> SnapshotError {
    SnapshotError::Io {
        operation: operation.into(),
        path: path.to_string(),
        source,
    }
}

/// Errori strutturali, di preflight, I/O e recovery dello snapshot globale.
#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("radice vault non valida: {0}")]
    InvalidRoot(Utf8PathBuf),
    #[error("artefatto snapshot non valido: {0}")]
    InvalidArtifact(Utf8PathBuf),
    #[error("path snapshot non valido: {0}")]
    InvalidPath(String),
    #[error("proprietario snapshot non valido: {0}")]
    InvalidOwner(String),
    #[error("path duplicato nel manifest: {0}")]
    DuplicatePath(String),
    #[error("ordine non deterministico del manifest: {previous} prima di {current}")]
    UnsortedManifest { previous: String, current: String },
    #[error("entry non prevista dal manifest: {0}")]
    UnexpectedEntry(String),
    #[error("entry richiesta assente: {0}")]
    MissingEntry(String),
    #[error("file speciale o symlink rifiutato: {0}")]
    UnsupportedFile(String),
    #[error("dato derivato escluso dallo snapshot: {0}")]
    ExcludedDerived(String),
    #[error("classe o proprietario non corrispondono al catalogo: {0}")]
    EntryClassMismatch(String),
    #[error("schema assente per {path}; atteso {expected}")]
    SchemaMissing {
        path: String,
        expected: SchemaVersion,
    },
    #[error("schema inatteso per {0}")]
    UnexpectedSchema(String),
    #[error("schema non supportato per {path}: trovato {found}, atteso {expected}")]
    SchemaMismatch {
        path: String,
        expected: SchemaVersion,
        found: SchemaVersion,
    },
    #[error("schema futuro per {path}: trovato {found}, supportato {supported}")]
    FutureSchema {
        path: String,
        found: SchemaVersion,
        supported: SchemaVersion,
    },
    #[error("digest non canonico per {0}")]
    InvalidDigest(String),
    #[error("dimensione errata per {path}: attesa {expected}, trovata {found}")]
    SizeMismatch {
        path: String,
        expected: u64,
        found: u64,
    },
    #[error("digest errato per {path}: atteso {expected:?}, trovato {found:?}")]
    DigestMismatch {
        path: String,
        expected: Revision,
        found: Revision,
    },
    #[error("revisione di base obsoleta: snapshot {expected:?}, vault {found:?}")]
    BaseRevisionStale { expected: Revision, found: Revision },
    #[error("path già esistente: {0}")]
    AlreadyExists(Utf8PathBuf),
    #[error("recovery necessaria per {transaction_id}: {reason}")]
    RecoveryNeeded {
        transaction_id: String,
        reason: String,
    },
    #[error("recovery record malformato {path}: {reason}")]
    MalformedRecovery { path: Utf8PathBuf, reason: String },
    #[error("artefatto malformato {path}: {reason}")]
    MalformedArtifact { path: Utf8PathBuf, reason: String },
    #[error("fault injection: {0}")]
    FaultInjected(&'static str),
    #[error("serializzazione snapshot fallita: {0}")]
    Serialization(String),
    #[error("I/O snapshot durante {operation} su {path}: {source}")]
    Io {
        operation: String,
        path: String,
        #[source]
        source: io::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn root() -> (TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
        fs::create_dir(&root).expect("root");
        (dir, root)
    }

    #[test]
    fn manifest_revision_is_deterministic_and_sorted() {
        let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        files.insert("b.md".into(), b"b".to_vec());
        files.insert("a.md".into(), b"a".to_vec());
        let entries = files
            .iter()
            .map(|(path, bytes)| entry_for_path(path, bytes).expect("entry"))
            .collect();
        let manifest = SnapshotManifest::new(entries).expect("manifest");
        assert_eq!(manifest.entries[0].path, "a.md");
        assert_eq!(manifest.digest(), manifest.digest());
        assert!(manifest.digest().as_str().starts_with("sha256:"));
    }

    #[test]
    fn capture_excludes_known_derived_but_keeps_unknown() {
        let (_dir, root) = root();
        fs::create_dir_all(root.join(".fub/data/plugins/x")).expect("cache");
        fs::write(root.join(".fub/data/plugins/x/index.bin"), b"derived").expect("cache");
        fs::create_dir_all(root.join(".fub/data")).expect("data");
        fs::write(root.join(".fub/data/unknown.bin"), b"keep").expect("unknown");
        fs::write(root.join("note.md"), b"note").expect("note");
        let snapshot = SnapshotBundle::capture(&root).expect("capture");
        assert!(snapshot.bytes(".fub/data/plugins/x/index.bin").is_none());
        assert_eq!(snapshot.bytes(".fub/data/unknown.bin"), Some(&b"keep"[..]));
    }

    #[test]
    fn preflight_rejects_future_schema_duplicate_traversal_and_corrupt_payload() {
        let (_dir, root) = root();
        fs::write(root.join("note.md"), b"note").expect("note");
        let original = SnapshotBundle::capture(&root).expect("capture");

        let mut future = original.manifest.clone();
        future.schema_version = SchemaVersion::new(2);
        assert!(matches!(
            future.validate_structure(),
            Err(SnapshotError::FutureSchema { .. })
        ));

        let entry = original.manifest.entries[0].clone();
        let duplicate = SnapshotManifest {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            entries: vec![entry.clone(), entry],
        };
        assert!(matches!(
            duplicate.validate_structure(),
            Err(SnapshotError::DuplicatePath(_))
        ));

        let traversal = SnapshotManifest {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            entries: vec![SnapshotEntry {
                path: "../outside".into(),
                class: SnapshotClass::Unknown,
                owner: "user".into(),
                schema: None,
                size: 0,
                digest: Revision::of_bytes(b""),
            }],
        };
        assert!(matches!(
            traversal.validate_structure(),
            Err(SnapshotError::InvalidPath(_))
        ));

        let mut corrupt = original.files.clone();
        corrupt.insert("note.md".into(), b"changed".to_vec());
        assert!(matches!(
            original.manifest.validate_files(&corrupt),
            Err(SnapshotError::SizeMismatch { .. }) | Err(SnapshotError::DigestMismatch { .. })
        ));
        assert_eq!(fs::read(root.join("note.md")).expect("old"), b"note");
    }

    #[test]
    fn artifact_rejects_payload_not_listed_in_manifest() {
        let (_dir, root) = root();
        fs::write(root.join("note.md"), b"note").expect("note");
        let snapshot = SnapshotBundle::capture(&root).expect("capture");
        let artifact = root.parent().expect("parent").join("snapshot-artifact");
        snapshot.write_to(&artifact).expect("write artifact");
        fs::write(artifact.join("payload/rogue.bin"), b"rogue").expect("rogue");
        assert!(matches!(
            SnapshotBundle::read_from(&artifact),
            Err(SnapshotError::UnexpectedEntry(path)) if path == "rogue.bin"
        ));
    }

    #[test]
    fn stale_base_and_fault_before_commit_leave_old_bytes_untouched() {
        let (_dir, root) = root();
        fs::write(root.join("note.md"), b"before").expect("before");
        let snapshot = SnapshotBundle::capture(&root).expect("capture");
        fs::write(root.join("note.md"), b"newer").expect("newer");
        let before = fs::read(root.join("note.md")).expect("before bytes");
        assert!(matches!(
            SnapshotApplier::apply(&root, &snapshot),
            Err(SnapshotError::BaseRevisionStale { .. })
        ));
        assert_eq!(fs::read(root.join("note.md")).expect("unchanged"), before);

        let same = SnapshotBundle::capture(&root).expect("capture newer");
        assert!(matches!(
            SnapshotApplier::apply_with_fault(&root, &same, Some(SnapshotFault::BeforeWrite)),
            Err(SnapshotError::FaultInjected(_))
        ));
        assert_eq!(fs::read(root.join("note.md")).expect("unchanged"), before);
        assert!(matches!(
            SnapshotApplier::apply_with_fault(
                &root,
                &same,
                Some(SnapshotFault::DuringWrite { entries: 0 })
            ),
            Err(SnapshotError::FaultInjected(_))
        ));
        assert_eq!(fs::read(root.join("note.md")).expect("unchanged"), before);
    }

    #[test]
    fn restart_recovery_rolls_back_prepare_and_finalizes_commit() {
        let (_dir, root) = root();
        fs::write(root.join("note.md"), b"stable").expect("note");
        let base = SnapshotBundle::capture(&root).expect("capture");
        let before = fs::read(root.join("note.md")).expect("before");
        assert!(matches!(
            SnapshotApplier::apply_with_fault(&root, &base, Some(SnapshotFault::AfterPrepare)),
            Err(SnapshotError::FaultInjected(_))
        ));
        let recovered = SnapshotApplier::recover(&root).expect("rollback prepare");
        assert_eq!(recovered.recovered, 1);
        assert_eq!(
            fs::read(root.join("note.md")).expect("after rollback"),
            before
        );

        let target_bytes = b"restored".to_vec();
        let target_files = BTreeMap::from([("note.md".to_owned(), target_bytes.clone())]);
        let target_manifest = SnapshotManifest::new(vec![
            entry_for_path("note.md", &target_bytes).expect("entry")
        ])
        .expect("target manifest");
        let target = SnapshotBundle::new(target_manifest, base.base_revision.clone(), target_files)
            .expect("target snapshot");
        assert!(matches!(
            SnapshotApplier::apply_with_fault(&root, &target, Some(SnapshotFault::AfterCommit)),
            Err(SnapshotError::FaultInjected(_))
        ));
        assert_eq!(
            fs::read(root.join("note.md")).expect("published"),
            target_bytes
        );
        let recovered = SnapshotApplier::recover(&root).expect("finalize commit");
        assert_eq!(recovered.recovered, 1);
        assert_eq!(
            fs::read(root.join("note.md")).expect("after finalize"),
            b"restored"
        );
    }
}
