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
use fub_kernel::storage::{DirEntry, FsStorage, Fusione, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Workspace};

struct TxtProvider;

impl FormatProvider for TxtProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("plain", "Testo semplice (test)", &["txt"])
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
    fn render_html(&self, m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

/// Sul path della nota, le `stat` dispari mentono sulla dimensione: è il file
/// che sta ancora crescendo sotto la lettura.
struct InCorso {
    inner: FsStorage,
    nota: Utf8PathBuf,
    stats: AtomicUsize,
    size_prima: u64,
    size_dopo: u64,
}

impl InCorso {
    fn nuovo(nota: Utf8PathBuf, size_prima: u64, size_dopo: u64) -> Arc<Self> {
        Arc::new(InCorso {
            inner: FsStorage,
            nota,
            stats: AtomicUsize::new(0),
            size_prima,
            size_dopo,
        })
    }
}

impl VaultStorage for InCorso {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> std::io::Result<()> {
        self.inner.update(path, fondi)
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
        if path == self.nota {
            let n = self.stats.fetch_add(1, Ordering::Relaxed) + 1;
            s.size = if n % 2 == 1 {
                self.size_prima
            } else {
                self.size_dopo
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
        .expect("nessun conflitto");
    registry
}

fn aperto(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Workspace {
    let mut ws = Workspace::on(root, registry(), storage, MachineSettings::in_memory())
        .expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex");
    ws
}

/// Un file che sta ancora cambiando **non entra in anagrafe**.
#[test]
fn un_file_instabile_non_si_parsa() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let nota = root.join("nota.txt");
    std::fs::write(&nota, "versione completa\n").expect("semina");

    let supporto = InCorso::nuovo(nota.clone(), 4, 18);
    let ws = aperto(&root, supporto);

    assert!(
        ws.plan_sync(&nota).is_none(),
        "due stat discordi: il piano è None, non una metà ingerita"
    );
}

/// La stessa prova sotto il prestito esclusivo: `sync_path` non ingerisce
/// i byte letti a metà.
#[test]
fn un_file_instabile_non_si_ingerisce_neanche_in_esclusiva() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let nota = root.join("nota.txt");
    std::fs::write(&nota, "versione completa\n").expect("semina");
    let supporto = InCorso::nuovo(nota.clone(), 4, 18);
    let mut ws =
        Workspace::on(&root, registry(), supporto, MachineSettings::in_memory()).expect("apertura");
    let cambiato = ws.sync_path(&nota).expect("sync");
    assert!(
        !cambiato,
        "un file instabile non è un cambiamento da applicare"
    );
}

/// Il caso fermo: due `stat` uguali, il piano c'è, e i byte sono quelli.
#[test]
fn un_file_fermo_si_parsa() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let nota = root.join("nota.txt");
    std::fs::write(&nota, "fermo\n").expect("semina");
    let ws = aperto(&root, Arc::new(FsStorage));
    let piano = ws.plan_sync(&nota);
    assert!(
        piano.is_some(),
        "un file fermo ha un piano, anche se è l'eco della scansione"
    );
}
