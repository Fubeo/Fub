//! Snapshot globale offline del contenuto autorevole di un vault.
//!
//! Questo modulo possiede il formato, il preflight e la transazione di
//! sostituzione. Non apre un [`Workspace`] e non conosce provider o watcher:
//! l'host chiude/quiesce il vault prima dell'applicazione e lo riapre dopo.
//!
//! Il manifest è una fotografia deterministica. Ogni voce porta path relativo
//! normalizzato, classe, proprietario, schema (quando il formato lo dichiara),
//! dimensione e SHA-256. Le cache dei plugin (`.fub/data/plugins/<id>/`) sono
//! escluse soltanto quando la radice contiene il marker `.fub-cache-root`;
//! la stessa directory senza marker resta storage autorevole legacy.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Component, Path};
use std::sync::atomic::AtomicU64;

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
const REJECTED_SUFFIX: &str = ".rejected";
static TRANSACTION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

mod apply;
mod disk;
mod recovery;

use disk::{
    acquire_lock, collect_authoritative, create_private_directory_all, io_error, normalize_path,
    read_regular_file, symlink_metadata, sync_parent, sync_tree, transaction_id,
    validate_payload_tree, write_regular_file,
};

pub use apply::{
    apply_snapshot, recover_snapshots, SnapshotApplier, SnapshotApplyReport, SnapshotFault,
    SnapshotRecoveryReport,
};

/// Classificazione esplicita della voce nel manifest.
///
/// Il kernel non possiede il [`FormatRegistry`](crate::registry::FormatRegistry):
/// tutto il contenuto utente resta quindi nella classe unica `User`, senza
/// dedurre documenti o allegati dal nome.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotClass {
    /// Documento, allegato o file sconosciuto posseduto dall'utente.
    User,
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

    /// Lo stesso contenuto, preparato contro un'altra revisione di base.
    ///
    /// Serve a chi ripristina uno snapshot vecchio: la base registrata alla
    /// cattura non è più quella del vault, e l'applicazione la rifiuterebbe.
    /// Il chiamante la sostituisce con quella appena osservata sotto il proprio
    /// claim, così il confronto sotto lock continua a proteggere dalle
    /// scritture avvenute dopo l'osservazione.
    pub fn rebased(self, base_revision: Revision) -> Result<Self, SnapshotError> {
        Self::new(self.manifest, base_revision, self.files)
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
        let parent = path
            .parent()
            .ok_or_else(|| SnapshotError::InvalidArtifact(path.to_owned()))?;
        fs::create_dir_all(parent)
            .map_err(|source| io_error("create snapshot parent", parent, source))?;
        let _lock = acquire_lock(path)?;
        let temporary = parent.join(format!(".{MANIFEST_FILE}.{}", transaction_id()));
        if let Err(error) = self.write_container(&temporary) {
            let _ = fs::remove_dir_all(temporary.as_std_path());
            return Err(error);
        }
        if let Err(source) = crate::storage::rename_no_replace_path(&temporary, path) {
            let _ = fs::remove_dir_all(temporary.as_std_path());
            if source.kind() == io::ErrorKind::AlreadyExists {
                return Err(SnapshotError::AlreadyExists(path.to_owned()));
            }
            return Err(io_error("publish snapshot", path, source));
        }
        sync_parent(parent)?;
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
        create_private_directory_all(&path.join(PAYLOAD_DIR))
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
                create_private_directory_all(parent)
                    .map_err(|source| io_error("create snapshot payload parent", parent, source))?;
            }
            write_regular_file(&destination, bytes)?;
        }
        sync_tree(path)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SnapshotEnvelope {
    schema_version: SchemaVersion,
    base_revision: Revision,
    manifest: SnapshotManifest,
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
    if let Some(rest) = path
        .strip_prefix(".fub/plugins/")
        .or_else(|| path.strip_prefix(".fub/data/plugins/"))
    {
        let owner = rest
            .split('/')
            .next()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| SnapshotError::InvalidPath(path.to_owned()))?;
        return Ok((SnapshotClass::Plugin, format!("plugin:{owner}"), None));
    }
    if path == ".fub/data/entries.json" {
        return Err(SnapshotError::ExcludedDerived(path.to_owned()));
    }
    if path.starts_with(".trash/") {
        return Ok((SnapshotClass::Trash, "trash".into(), None));
    }
    Ok((SnapshotClass::User, "user".into(), None))
}

fn validate_catalog_entry(entry: &SnapshotEntry) -> Result<(), SnapshotError> {
    let (class, owner, schema) = classify_path(&entry.path)?;
    if class != entry.class || owner != entry.owner {
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
            if entry.class == SnapshotClass::User || entry.class == SnapshotClass::Trash =>
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
            Component::Normal(name) if !name.is_empty() => {
                let name = name
                    .to_str()
                    .ok_or_else(|| SnapshotError::InvalidPath(path.to_owned()))?;
                validate_portable_component(name, path)?;
                saw = true;
            }
            _ => return Err(SnapshotError::InvalidPath(path.to_owned())),
        }
    }
    let normalized = normalize_path(candidate)?;
    if !saw || normalized != path {
        return Err(SnapshotError::InvalidPath(path.to_owned()));
    }
    Ok(())
}

fn validate_portable_component(name: &str, path: &str) -> Result<(), SnapshotError> {
    if name.ends_with(['.', ' '])
        || name.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
    {
        return Err(SnapshotError::InvalidPath(path.to_owned()));
    }
    let device = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end_matches(['.', ' '])
        .to_ascii_uppercase();
    let reserved = matches!(
        device.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "CONIN$"
            | "CONOUT$"
            | "COM¹"
            | "COM²"
            | "COM³"
            | "LPT¹"
            | "LPT²"
            | "LPT³"
    ) || (device.len() == 4
        && (device.starts_with("COM") || device.starts_with("LPT"))
        && device.as_bytes()[3].is_ascii_digit()
        && device.as_bytes()[3] != b'0');
    if reserved {
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
mod tests;
