use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use fub_kernel::storage::{DirEntry, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MemStorage};

use super::*;

struct BlockingUpdateStorage {
    inner: MemStorage,
    armed: AtomicBool,
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl VaultStorage for BlockingUpdateStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }

    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }

    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        if self.armed.load(Ordering::Acquire) {
            self.entered
                .send(())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            self.release
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .recv()
                .map_err(|error| std::io::Error::other(error.to_string()))?;
        }
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
fn host_side_data_update_releases_workspace_custody_during_storage_io() {
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let storage = Arc::new(BlockingUpdateStorage {
        inner: MemStorage::new(),
        armed: AtomicBool::new(false),
        entered: entered_tx,
        release: Mutex::new(release_rx),
    });
    let root = Utf8PathBuf::from("/side-data-lock-test");
    let workspace = Workspace::on(
        &root,
        FormatRegistry::new(),
        Arc::clone(&storage) as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("the workspace opens on the blocking storage");
    storage.armed.store(true, Ordering::Release);
    let workspace = Custody::new("the side-data test workspace", workspace);
    let worker_workspace = workspace.clone();
    let worker = std::thread::spawn(move || {
        update_organization(&worker_workspace, |store| {
            store.set_icon("Nota.md", Some("📌".into()))
        })
    });

    entered_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the organization update reaches storage");
    // Entro una scadenza e prima di liberare lo storage: un prestito
    // trattenuto dall'aggiornamento resterebbe preso fino in fondo.
    let read_progressed = crate::legacy_tests::read_comes_free(&workspace);
    let write_progressed = crate::legacy_tests::write_comes_free(&workspace);
    release_tx.send(()).expect("the storage update resumes");

    worker
        .join()
        .expect("the host-side update thread does not panic")
        .expect("the organization update succeeds");
    storage.armed.store(false, Ordering::Release);
    assert!(
        read_progressed,
        "Host side-data I/O retained a write guard on Custody<Workspace>"
    );
    assert!(
        write_progressed,
        "Host side-data I/O retained a read or write guard on Custody<Workspace>"
    );

    let reopened = Workspace::on(
        &root,
        FormatRegistry::new(),
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("the persisted organization reopens");
    assert_eq!(
        reopened
            .organization()
            .icons
            .get("Nota.md")
            .map(String::as_str),
        Some("📌")
    );
}
