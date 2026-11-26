use std::sync::atomic::{AtomicBool, Ordering};

use camino::Utf8PathBuf;
use fub_kernel::storage::{DirEntry, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, MemStorage};

use super::*;

struct ProbeStorage {
    inner: MemStorage,
    workspace: Mutex<Option<Custody<Workspace>>>,
    armed: AtomicBool,
    write_progressed: AtomicBool,
}

impl VaultStorage for ProbeStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        if self.armed.load(Ordering::Acquire) {
            let workspace = self
                .workspace
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            // Basta una lettura con il lucchetto libero: chi l'ha già vista
            // non riprova, e chi no la cerca entro una scadenza.
            if !self.write_progressed.load(Ordering::Acquire)
                && workspace
                    .is_some_and(|workspace| crate::legacy_tests::write_comes_free(&workspace))
            {
                self.write_progressed.store(true, Ordering::Release);
            }
        }
        self.inner.read(path)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }

    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }

    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }

    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }

    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }

    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }

    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }

    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }

    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

#[test]
fn read_version_provider_does_not_hold_workspace_lock_during_storage_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let storage = Arc::new(ProbeStorage {
        inner: MemStorage::new(),
        workspace: Mutex::new(None),
        armed: AtomicBool::new(false),
        write_progressed: AtomicBool::new(false),
    });
    let mut workspace = Workspace::on(
        &root,
        FormatRegistry::new(),
        Arc::clone(&storage) as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("workspace opens");
    workspace
        .register_core_feature(VERSIONING_ID, "Versioning")
        .expect("versioning registers");
    let store = workspace
        .with_host(VERSIONING_ID, VersionStore::open)
        .expect("versioning opens");
    let id = DocId::new("Nota.md");
    workspace
        .with_host(VERSIONING_ID, |host| {
            store.snapshot(&id, b"# Nota\n\nversione\n", host)
        })
        .expect("the seed version is stored");
    let ts = store.list(&id).first().expect("the seed version exists").ts;
    let workspace = Custody::new("test workspace", workspace);
    *storage
        .workspace
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(workspace.clone());
    storage.armed.store(true, Ordering::Release);

    let source =
        read_version_with_workspace(workspace, store, &id, ts).expect("the version is readable");

    assert_eq!(source, "# Nota\n\nversione\n");
    assert!(
        storage.write_progressed.load(Ordering::Acquire),
        "VersionStore/provider I/O retained the workspace lock"
    );
}

#[test]
fn applying_claim_blocks_open_and_releases_on_drop() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    std::fs::create_dir(&root).expect("vault root");
    let root = root.canonicalize_utf8().expect("canonical root");
    let host = Host::without_watcher();
    let claim = host.claim_snapshot(&root).expect("snapshot claim");
    assert!(matches!(host.open(&root), Err(PluginError::Conflict(_))));
    let close_errors = host.close();
    assert!(matches!(
        close_errors.as_slice(),
        [PluginError::Conflict(_)]
    ));
    drop(claim);
    assert!(host.sessions.read().expect("sessions").slots.is_empty());
}

#[test]
fn applying_claim_blocks_recovery_for_missing_root() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let host = Host::without_watcher();
    let recovery_root = snapshot_recovery_root(&root).expect("recovery root");
    let claim = host.claim_snapshot(&recovery_root).expect("snapshot claim");
    assert!(matches!(
        host.recover_snapshot_artifacts(&root),
        Err(SnapshotHostError::Lifecycle(PluginError::Conflict(_)))
    ));
    drop(claim);
}

#[cfg(unix)]
#[test]
fn applying_claim_blocks_recovery_for_missing_root_through_alias_parent() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().expect("tempdir");
    let canonical_parent =
        Utf8PathBuf::from_path_buf(dir.path().join("canonical")).expect("canonical parent");
    let alias_parent = Utf8PathBuf::from_path_buf(dir.path().join("alias")).expect("alias parent");
    std::fs::create_dir(&canonical_parent).expect("canonical parent");
    std::fs::create_dir(canonical_parent.join("sub")).expect("canonical sub");
    symlink(&canonical_parent, &alias_parent).expect("alias parent");
    let canonical_root = canonical_parent.join("vault");
    let aliased_root = alias_parent.join("sub").join("..").join("vault");
    let host = Host::without_watcher();
    let canonical_key = snapshot_recovery_root(&canonical_root).expect("canonical recovery root");
    let claim = host
        .claim_snapshot(&canonical_key)
        .expect("canonical snapshot claim");

    assert!(!canonical_root.exists());
    assert!(matches!(
        host.recover_snapshot_artifacts(&aliased_root),
        Err(SnapshotHostError::Lifecycle(PluginError::Conflict(_)))
    ));
    drop(claim);
}

#[test]
fn recovery_reports_not_found_for_missing_parent() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("missing/vault")).expect("missing root");
    let host = Host::without_watcher();

    assert!(matches!(
        host.recover_snapshot_artifacts(&root),
        Err(SnapshotHostError::Lifecycle(PluginError::NotFound(_)))
    ));
}
