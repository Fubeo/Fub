//! Durable intent for an explicit rename.
//!
//! A rename moves side-data and the file before it can finish provider-owned
//! backlink edits.  This record is written before the first move and removed
//! only after every edit is known to have landed.  Reopening can therefore
//! distinguish an untouched source from a moved destination and can replay each
//! edit with its existing CAS precondition.

use std::io;
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::{DocId, EditRequest, Fnv1a, Revision};
use serde::{Deserialize, Serialize};

use crate::error::{KernelError, Result};
use crate::storage::{ConditionalWrite, VaultStorage};
use crate::FUB_DIR;

const SCHEMA_VERSION: u32 = 1;
const DIR: &str = "rename-recovery";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Record {
    schema_version: u32,
    state: RecordState,
    from: DocId,
    to: DocId,
    preimage: Revision,
    rewrites: Vec<RenameRecoveryEdit>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RecordState {
    Active,
    Cancelled,
}

/// A backlink edit captured before the rename starts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenameRecoveryEdit {
    source: DocId,
    request: EditRequest,
    result: Revision,
}

impl RenameRecoveryEdit {
    pub(crate) fn new(source: DocId, request: EditRequest, result: Revision) -> Self {
        Self {
            source,
            request,
            result,
        }
    }

    pub fn source(&self) -> &DocId {
        &self.source
    }

    pub fn request(&self) -> &EditRequest {
        &self.request
    }

    pub fn result(&self) -> &Revision {
        &self.result
    }
}

/// Storage-only scan prepared without doing I/O under the workspace lock.
pub struct RenameRecoveryScan {
    storage: Arc<dyn VaultStorage>,
    root: Utf8PathBuf,
}

/// Records that can be replayed plus isolated records that must remain for
/// manual recovery. A bad sibling never hides a valid intent.
pub struct RenameRecoveryScanResult {
    pending: Vec<PendingRenameRecovery>,
    failures: Vec<KernelError>,
}

impl RenameRecoveryScanResult {
    pub fn into_parts(self) -> (Vec<PendingRenameRecovery>, Vec<KernelError>) {
        (self.pending, self.failures)
    }
}

impl RenameRecoveryScan {
    pub(crate) fn new(storage: Arc<dyn VaultStorage>, root: Utf8PathBuf) -> Self {
        Self { storage, root }
    }

    pub fn invoke(self) -> Result<RenameRecoveryScanResult> {
        let dir = recovery_dir(&self.root);
        let entries = match self.storage.list(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(RenameRecoveryScanResult {
                    pending: Vec::new(),
                    failures: Vec::new(),
                })
            }
            Err(source) => return Err(io_error(dir, source)),
        };
        let mut pending = Vec::new();
        let mut failures = Vec::new();
        for entry in entries {
            if !entry.stat.is_file() || entry.path.extension() != Some("json") {
                continue;
            }
            let bytes = match self.storage.read(&entry.path) {
                Ok(bytes) => bytes,
                Err(source) => {
                    failures.push(io_error(entry.path, source));
                    continue;
                }
            };
            let record: Record = match serde_json::from_slice(&bytes) {
                Ok(record) => record,
                Err(error) => {
                    failures.push(io_error(
                        entry.path,
                        io::Error::new(io::ErrorKind::InvalidData, error),
                    ));
                    continue;
                }
            };
            if record.schema_version != SCHEMA_VERSION {
                failures.push(io_error(
                    entry.path,
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "intent di rinomina in versione {}, supportata fino alla {}",
                            record.schema_version, SCHEMA_VERSION
                        ),
                    ),
                ));
                continue;
            }
            pending.push(PendingRenameRecovery {
                storage: Arc::clone(&self.storage),
                root: self.root.clone(),
                path: entry.path,
                record,
            });
        }
        pending.sort_by(|left, right| {
            (&left.record.from, &left.record.to, &left.path).cmp(&(
                &right.record.from,
                &right.record.to,
                &right.path,
            ))
        });
        Ok(RenameRecoveryScanResult { pending, failures })
    }
}

/// Ground truth found for a persisted rename intent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RenameRecoveryPosition {
    /// The original file is still present with the captured preimage.
    Source,
    /// The file already landed at the destination with the captured preimage.
    Destination,
    /// A rejected in-memory commit still has its file at the destination.
    /// Recovery must finish the reverse move, never replay the rejected rename.
    Rollback,
    /// A rejected in-memory commit already restored the source; only cleanup remains.
    Cancelled,
    /// Neither safe state matches. Recovery must not overwrite either path.
    Conflict(String),
}

/// One durable intent loaded from the vault.
pub struct PendingRenameRecovery {
    storage: Arc<dyn VaultStorage>,
    root: Utf8PathBuf,
    path: Utf8PathBuf,
    record: Record,
}

impl PendingRenameRecovery {
    pub fn from(&self) -> &DocId {
        &self.record.from
    }

    pub fn to(&self) -> &DocId {
        &self.record.to
    }

    pub fn preimage(&self) -> &Revision {
        &self.record.preimage
    }

    pub fn rewrites(&self) -> &[RenameRecoveryEdit] {
        &self.record.rewrites
    }

    pub fn classify(&self) -> Result<RenameRecoveryPosition> {
        let from = revision_at(
            self.storage.as_ref(),
            &self.root.join(self.record.from.as_str()),
        )?;
        let to = revision_at(
            self.storage.as_ref(),
            &self.root.join(self.record.to.as_str()),
        )?;
        Ok(match (self.record.state, from, to) {
            (RecordState::Active, Some(found), None) if found == self.record.preimage => {
                RenameRecoveryPosition::Source
            }
            (RecordState::Active, None, Some(found)) if found == self.record.preimage => {
                RenameRecoveryPosition::Destination
            }
            (RecordState::Cancelled, Some(found), None) if found == self.record.preimage => {
                RenameRecoveryPosition::Cancelled
            }
            (RecordState::Cancelled, None, Some(found)) if found == self.record.preimage => {
                RenameRecoveryPosition::Rollback
            }
            (_, from, to) => RenameRecoveryPosition::Conflict(format!(
                "la rinomina {} → {} non coincide più con la preimmagine (sorgente: {}, destinazione: {})",
                self.record.from,
                self.record.to,
                describe_revision(from.as_ref(), &self.record.preimage),
                describe_revision(to.as_ref(), &self.record.preimage),
            )),
        })
    }

    /// Removes an intent after completion or a verified terminal rollback. No
    /// user document is touched.
    pub fn clear(&self) -> Result<()> {
        remove_if_present(self.storage.as_ref(), &self.path)
    }
}

pub(crate) struct RenameRecoveryReceipt {
    storage: Arc<dyn VaultStorage>,
    path: Utf8PathBuf,
    record: Record,
}

impl RenameRecoveryReceipt {
    pub(crate) fn complete(&self) -> Result<()> {
        remove_if_present(self.storage.as_ref(), &self.path)
    }

    /// Marks a rejected operation as rollback-only before any compensating
    /// mutation. A crash can then never replay the rejected forward rename.
    pub(crate) fn mark_cancelled(&mut self) -> Result<()> {
        self.record.state = RecordState::Cancelled;
        let bytes = encode(&self.record, &self.path)?;
        self.storage
            .write(&self.path, &bytes)
            .map(|_| ())
            .map_err(|source| io_error(self.path.clone(), source))
    }

    /// Marks a rollback already completed by the caller, then removes its record.
    pub(crate) fn cancel(&mut self) -> Result<()> {
        self.mark_cancelled()?;
        self.complete()
    }
}

pub(crate) fn persist(
    storage: Arc<dyn VaultStorage>,
    root: &Utf8Path,
    from: DocId,
    to: DocId,
    preimage: Revision,
    rewrites: Vec<RenameRecoveryEdit>,
) -> Result<RenameRecoveryReceipt> {
    let record = Record {
        schema_version: SCHEMA_VERSION,
        state: RecordState::Active,
        from,
        to,
        preimage,
        rewrites,
    };
    let path = record_path(root, &record);
    let bytes = encode(&record, &path)?;
    match storage
        .write_if_unchanged(&path, None, &bytes)
        .map_err(|source| io_error(path.clone(), source))?
    {
        ConditionalWrite::Written(_) => Ok(RenameRecoveryReceipt {
            storage,
            path,
            record,
        }),
        ConditionalWrite::Changed => {
            let existing = storage
                .read(&path)
                .map_err(|source| io_error(path.clone(), source))?;
            let existing: Record = serde_json::from_slice(&existing).map_err(|error| {
                io_error(
                    path.clone(),
                    io::Error::new(io::ErrorKind::InvalidData, error),
                )
            })?;
            if existing == record {
                Ok(RenameRecoveryReceipt {
                    storage,
                    path,
                    record,
                })
            } else {
                Err(KernelError::AlreadyExists(format!(
                    "recupero di una rinomina già pendente per {}",
                    record.from
                )))
            }
        }
    }
}

fn recovery_dir(root: &Utf8Path) -> Utf8PathBuf {
    root.join(FUB_DIR).join(DIR)
}

fn record_path(root: &Utf8Path, record: &Record) -> Utf8PathBuf {
    let mut hash = Fnv1a::new();
    hash.update(record.from.as_str().as_bytes());
    hash.update(&[0]);
    hash.update(record.to.as_str().as_bytes());
    hash.update(&[0]);
    hash.update(record.preimage.0.as_bytes());
    recovery_dir(root).join(format!("{:016x}.json", hash.value()))
}

fn encode(record: &Record, path: &Utf8Path) -> Result<Vec<u8>> {
    serde_json::to_vec_pretty(record).map_err(|error| {
        io_error(
            path.to_owned(),
            io::Error::new(io::ErrorKind::InvalidData, error),
        )
    })
}

fn revision_at(storage: &dyn VaultStorage, path: &Utf8Path) -> Result<Option<Revision>> {
    match storage.read(path) {
        Ok(bytes) => Ok(Some(Revision::of_bytes(&bytes))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(io_error(path.to_owned(), source)),
    }
}

fn remove_if_present(storage: &dyn VaultStorage, path: &Utf8Path) -> Result<()> {
    match storage.remove(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error(path.to_owned(), source)),
    }
}

fn describe_revision(found: Option<&Revision>, expected: &Revision) -> &'static str {
    match found {
        None => "assente",
        Some(found) if found == expected => "preimmagine attesa",
        Some(_) => "contenuto diverso",
    }
}

fn io_error(path: Utf8PathBuf, source: io::Error) -> KernelError {
    KernelError::Io { path, source }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MemStorage;

    fn fixture() -> (Arc<dyn VaultStorage>, Utf8PathBuf) {
        (Arc::new(MemStorage::new()), Utf8PathBuf::from("/vault"))
    }

    fn scan(
        storage: Arc<dyn VaultStorage>,
        root: Utf8PathBuf,
    ) -> (Vec<PendingRenameRecovery>, Vec<KernelError>) {
        RenameRecoveryScan::new(storage, root)
            .invoke()
            .unwrap()
            .into_parts()
    }

    #[test]
    fn persisted_intent_classifies_each_safe_file_position() {
        let (storage, root) = fixture();
        storage.write(&root.join("a.md"), b"a").unwrap();
        let receipt = persist(
            Arc::clone(&storage),
            &root,
            DocId::new("a.md"),
            DocId::new("b.md"),
            Revision::of("a"),
            Vec::new(),
        )
        .unwrap();

        let pending = scan(Arc::clone(&storage), root.clone()).0;
        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending[0].classify().unwrap(),
            RenameRecoveryPosition::Source
        );

        storage
            .rename_no_replace(&root.join("a.md"), &root.join("b.md"))
            .unwrap();
        let pending = scan(Arc::clone(&storage), root.clone()).0;
        assert_eq!(
            pending[0].classify().unwrap(),
            RenameRecoveryPosition::Destination
        );

        receipt.complete().unwrap();
        assert!(scan(storage, root).0.is_empty());
    }

    #[test]
    fn collision_is_a_conflict_and_preserves_both_files_and_the_intent() {
        let (storage, root) = fixture();
        storage.write(&root.join("a.md"), b"a").unwrap();
        let _receipt = persist(
            Arc::clone(&storage),
            &root,
            DocId::new("a.md"),
            DocId::new("b.md"),
            Revision::of("a"),
            Vec::new(),
        )
        .unwrap();
        storage.write(&root.join("b.md"), b"external").unwrap();

        let pending = scan(Arc::clone(&storage), root.clone()).0;
        assert!(matches!(
            pending[0].classify().unwrap(),
            RenameRecoveryPosition::Conflict(_)
        ));
        assert_eq!(storage.read(&root.join("a.md")).unwrap(), b"a");
        assert_eq!(storage.read(&root.join("b.md")).unwrap(), b"external");
        assert_eq!(scan(storage, root).0.len(), 1);
    }

    #[test]
    fn unknown_schema_is_reported_without_deleting_the_record() {
        let (storage, root) = fixture();
        storage.write(&root.join("a.md"), b"a").unwrap();
        let receipt = persist(
            Arc::clone(&storage),
            &root,
            DocId::new("a.md"),
            DocId::new("b.md"),
            Revision::of("a"),
            Vec::new(),
        )
        .unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&storage.read(&receipt.path).unwrap()).unwrap();
        value["schema_version"] = serde_json::json!(SCHEMA_VERSION + 1);
        storage
            .write(&receipt.path, &serde_json::to_vec(&value).unwrap())
            .unwrap();

        storage.write(&root.join("c.md"), b"c").unwrap();
        let valid = persist(
            Arc::clone(&storage),
            &root,
            DocId::new("c.md"),
            DocId::new("d.md"),
            Revision::of("c"),
            Vec::new(),
        )
        .unwrap();

        let (pending, failures) = scan(Arc::clone(&storage), root);
        assert_eq!(failures.len(), 1);
        assert!(matches!(failures[0], KernelError::Io { .. }));
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].from(), &DocId::new("c.md"));
        assert!(storage.exists(&receipt.path));
        assert!(storage.exists(&valid.path));
    }

    #[test]
    fn identical_persist_is_idempotent_and_cancelled_position_never_replays_forward() {
        let (storage, root) = fixture();
        storage.write(&root.join("a.md"), b"a").unwrap();
        let mut receipt = persist(
            Arc::clone(&storage),
            &root,
            DocId::new("a.md"),
            DocId::new("b.md"),
            Revision::of("a"),
            Vec::new(),
        )
        .unwrap();
        persist(
            Arc::clone(&storage),
            &root,
            DocId::new("a.md"),
            DocId::new("b.md"),
            Revision::of("a"),
            Vec::new(),
        )
        .expect("the same intent is reusable without a clear-first window");
        receipt.mark_cancelled().unwrap();
        let pending = scan(Arc::clone(&storage), root.clone()).0;
        assert_eq!(
            pending[0].classify().unwrap(),
            RenameRecoveryPosition::Cancelled
        );
        storage
            .rename_no_replace(&root.join("a.md"), &root.join("b.md"))
            .unwrap();
        let pending = scan(storage, root).0;
        assert_eq!(
            pending[0].classify().unwrap(),
            RenameRecoveryPosition::Rollback
        );
    }
}
