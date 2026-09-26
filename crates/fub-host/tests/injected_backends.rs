//! Ciò che tocca il mondo lo sceglie chi compone l'host.
//!
//! Il supporto del vault, il rilevatore delle modifiche esterne, il client di
//! rete e l'orologio sono porte di `Host`, non scelte di `mount`: un banco le
//! sostituisce dall'esterno del crate e l'host non tiene nessun secondo canale
//! verso il disco, il filesystem, la rete o l'orologio di sistema.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::{DocId, WriteBase};
use fub_host::mount::VaultStorageSource;
use fub_host::{Custody, Host, VaultWatcher, WatcherFactory};
use fub_kernel::storage::VaultStorage;
use fub_kernel::{MemStorage, Workspace};

fn root() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8 root");
    std::fs::create_dir(&root).expect("vault root");
    let root = root.canonicalize_utf8().expect("canonical root");
    (dir, root)
}

/// Un supporto in memoria condiviso da ogni apertura: la radice sul disco resta
/// vuota, e ciò che il vault contiene sta soltanto qui.
struct InMemory(Arc<MemStorage>);

impl VaultStorageSource for InMemory {
    fn open(&self, _root: &Utf8Path) -> std::io::Result<Arc<dyn VaultStorage>> {
        Ok(Arc::clone(&self.0) as Arc<dyn VaultStorage>)
    }
}

#[test]
fn the_vault_lives_on_the_storage_the_host_was_given() {
    let (_dir, root) = root();
    let memory = Arc::new(MemStorage::new());
    memory
        .write(&root.join("nota.md"), b"in memoria")
        .expect("the seed note is in memory");

    let host = Host::without_watcher().with_storage(Arc::new(InMemory(Arc::clone(&memory))));
    host.open(&root)
        .expect("the vault opens on the memory storage");
    host.wait_indexed(None).expect("indexing finishes");

    let id = DocId::new("nota.md");
    let (text, revision) = host.read_document(None, &id).expect("the note reads");
    assert_eq!(text, "in memoria");
    assert!(
        !root.join("nota.md").exists(),
        "the disk never saw the note: it belongs to the memory storage"
    );

    host.write_document(None, &id, "riscritta", WriteBase::DescendsFrom(revision))
        .expect("the note writes");
    assert_eq!(
        memory
            .read(&root.join("nota.md"))
            .expect("the memory keeps the write"),
        b"riscritta"
    );
    // L'unica cosa che il disco vede è l'indice di ricerca: tantivy mappa i
    // suoi file in memoria e non passa dal supporto del vault. È un derivato
    // ricostruibile, non un dato del vault, e resta l'unico canale laterale.
    let on_disk: Vec<String> = walk(root.as_std_path(), root.as_std_path())
        .into_iter()
        .filter(|path| {
            !(path == ".fub"
                || path == ".fub/plugins"
                || path.starts_with(".fub/plugins/fub.search"))
        })
        .collect();
    assert!(
        on_disk.is_empty(),
        "the vault lives on the storage the host was given, not on the disk — found {on_disk:?}"
    );
}

/// Ogni path sotto `dir`, relativo a `base`: il nome di chi ha scritto sul disco.
fn walk(dir: &std::path::Path, base: &std::path::Path) -> Vec<String> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).expect("a directory") {
        let path = entry.expect("entry").path();
        found.push(
            path.strip_prefix(base)
                .expect("under base")
                .display()
                .to_string(),
        );
        if path.is_dir() {
            found.extend(walk(&path, base));
        }
    }
    found
}

struct Watching;

impl VaultWatcher for Watching {
    fn is_watching(&self) -> bool {
        true
    }
}

/// Una fabbrica del banco: conta le partenze e alza la bandiera del kernel.
struct Probe {
    started: Arc<AtomicUsize>,
}

impl WatcherFactory for Probe {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        self.started.fetch_add(1, Ordering::SeqCst);
        watching.store(true, Ordering::SeqCst);
        Ok(Box::new(Watching))
    }
}

#[test]
fn the_watcher_is_the_one_the_host_was_given() {
    let (_dir, root) = root();
    std::fs::write(root.join("nota.md"), b"prima").expect("seed note");
    let started = Arc::new(AtomicUsize::new(0));
    let host = Host::new().with_watcher(Box::new(Probe {
        started: Arc::clone(&started),
    }));

    host.open(&root).expect("the vault opens");
    assert_eq!(started.load(Ordering::SeqCst), 1, "the probe started once");
    assert!(host.is_watching(None), "the probe's flag is the vault's");

    host.close_vault(&root).expect("the vault closes");
    assert_eq!(started.load(Ordering::SeqCst), 1);
}

#[test]
fn the_clock_is_the_one_the_host_was_given() {
    const INSTANT: u64 = 1_000_000_000_000;
    let (_dir, root) = root();
    std::fs::write(root.join("nota.md"), b"prima").expect("seed note");
    let host = Host::without_watcher().with_clock(Arc::new(fub_testkit::ManualClock::at(INSTANT)));
    host.open(&root).expect("the vault opens");
    host.wait_indexed(None).expect("indexing finishes");

    let id = DocId::new("nota.md");
    let (_, revision) = host.read_document(None, &id).expect("the note reads");
    host.write_document(None, &id, "dopo", WriteBase::DescendsFrom(revision))
        .expect("the note writes");
    let journal = host.journal(None).expect("the journal reads");
    let last = journal.records.last().expect("the write is recorded");
    assert_eq!(last.at, INSTANT, "the journal row carries the host's clock");
}
