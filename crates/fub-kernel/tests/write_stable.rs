//! **Il rilevatore non ingerisce un file a metà scrittura** (difetto 0197).
//!
//! `plan_sync` e `refresh_from_disk` fanno due `stat` attorno alla lettura: se
//! dimensione o data cambiano in mezzo, i byte sono una metà e il piano è
//! `None`. Il debounce del rilevatore riproverà. Qui non si aspetta: un tempo
//! su una macchina condivisa non è un segnale, e la prova è sui due numeri.
//!
//! Il supporto di prova **mente sulla dimensione** fra la prima e la seconda
//! `stat` dello stesso path: è la finestra presa invece che aspettata.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Workspace};

struct TxtProvider;

impl FormatProvider for TxtProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("plain", "Plain text (test)", &["txt"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }
    fn render_html(&self, m: &DocumentModel, _or: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

/// Sul path della nota, le `stat` dispari mentono sulla dimensione: è il file
/// che sta ancora crescendo sotto la lettura.
struct InProgress {
    inner: FsStorage,
    notes: Utf8PathBuf,
    stats: AtomicUsize,
    size_before: u64,
    size_after: u64,
}

impl InProgress {
    fn new(notes: Utf8PathBuf, size_before: u64, size_after: u64) -> Arc<Self> {
        Arc::new(InProgress {
            inner: FsStorage,
            notes,
            stats: AtomicUsize::new(0),
            size_before,
            size_after,
        })
    }
}

impl VaultStorage for InProgress {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
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
        let mut s = self.inner.stat(path)?;
        if path == self.notes {
            let n = self.stats.fetch_add(1, Ordering::Relaxed) + 1;
            s.size = if n % 2 == 1 {
                self.size_before
            } else {
                self.size_after
            };
        }
        Ok(s)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

fn registry() -> FormatRegistry {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(TxtProvider))
        .expect("no conflict");
    registry
}

fn opened(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Workspace {
    let mut ws = Workspace::on(root, registry(), storage, MachineSettings::in_memory())
        .expect("vault opens successfully");
    ws.reindex().expect("reindex");
    ws
}

/// Un file che sta ancora cambiando **non entra in anagrafe**.
#[test]
fn an_unstable_file_is_not_parsed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let notes = root.join("nota.txt");
    std::fs::write(&notes, "full version\n").expect("seed");

    let storage = InProgress::new(notes.clone(), 4, 18);
    let ws = opened(&root, storage);

    assert!(
        ws.plan_sync(&notes).is_none(),
        "two disagreeing stat: the plan is None, not half-swallowed"
    );
}

/// La stessa prova sotto il prestito esclusivo: `sync_path` non ingerisce
/// i byte letti a metà.
#[test]
fn an_unstable_file_is_not_swallowed_even_under_exclusive_borrow() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let notes = root.join("nota.txt");
    std::fs::write(&notes, "full version\n").expect("seed");
    let storage = InProgress::new(notes.clone(), 4, 18);
    let mut ws =
        Workspace::on(&root, registry(), storage, MachineSettings::in_memory()).expect("open");
    let changed = ws.sync_path(&notes).expect("sync");
    assert!(
        !changed,
        "an unstable file is not a change to apply"
    );
}

/// Il caso fermo: due `stat` uguali, il piano c'è, e i byte sono quelli.
#[test]
fn a_stable_file_is_parsed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let notes = root.join("nota.txt");
    std::fs::write(&notes, "stable\n").expect("seed");
    let ws = opened(&root, Arc::new(FsStorage));
    let plan = ws.plan_sync(&notes);
    assert!(
        plan.is_some(),
        "a stable file has a plan, even if it is the echo of the scan"
    );
}
