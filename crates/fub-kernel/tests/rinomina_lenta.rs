//! **La rinomina che il debounce spezza, e quella che il crash può spezzare.**
//!
//! Due difetti, la stessa identità:
//!
//! 1. **0198.** `changes()` accoppia solo `RenameMode::Both` nella stessa
//!    finestra. Partenza e arrivo in due lotti arrivano come remove+add, e
//!    senza l'accoppiamento per impronta la bozza e lo stato per-documento
//!    restano sotto il nome morto.
//! 2. **0168.** `rename_document` spostava il file e *poi* i dati: un crash
//!    in mezzo lasciava il file al nome nuovo e i dati sotto la chiave vecchia,
//!    dove la prima `collect` li spazza. Adesso i dati si spostano **prima**,
//!    e il supporto di prova lo verifica nell'istante in cui il file si muove.
//!
//! Zero `sleep`. Il debounce è una finestra di chi osserva il filesystem; qui
//! le due metà si chiamano in sequenza, che è ciò che due finestre producono.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Fusione, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Workspace};

const PLUGIN: &str = "test.appiccicoso";

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

fn registry() -> FormatRegistry {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(TxtProvider))
        .expect("nessun conflitto");
    registry
}

struct Banco {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    ws: Workspace,
}

impl Banco {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("a.txt"), "il contenuto che si sposta\n").expect("semina");
        let mut ws = Workspace::new(&root, registry()).expect("apertura");
        ws.reindex().expect("reindex");
        Banco {
            _dir: dir,
            root,
            ws,
        }
    }

    fn attacca_dati(&self, doc: &str) {
        let dir = self
            .ws
            .plugin_data_dir(PLUGIN)
            .expect("spazio dati")
            .join(doc_data::DOC_SPACE)
            .join(doc_data::encode(doc));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("annotazione"), format!("i dati di {doc}")).unwrap();
    }

    fn dati_di(&self, doc: &str) -> Option<String> {
        let path = self
            .root
            .join(".fub/data/plugins")
            .join(PLUGIN)
            .join(doc_data::DOC_SPACE)
            .join(doc_data::encode(doc))
            .join("annotazione");
        std::fs::read_to_string(path).ok()
    }

    fn bozza_di(&self, doc: &str) -> Option<String> {
        self.ws
            .drafts()
            .expect("bozze")
            .drafts
            .into_iter()
            .find(|b| b.doc.as_str() == doc)
            .map(|b| b.text)
    }
}

/// Le due metà di una rinomina esterna, come due lotti del rilevatore.
#[test]
fn una_rinomina_spezzata_porta_dietro_bozza_e_dati() {
    let mut b = Banco::nuovo();
    b.ws
        .save_draft(&DocId::new("a.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    b.ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    b.attacca_dati("a.txt");

    std::fs::rename(b.root.join("a.txt"), b.root.join("b.txt")).expect("rinomina sul disco");
    b.ws
        .sync_path(&b.root.join("a.txt"))
        .expect("la partenza: il file non c'è più");
    b.ws
        .sync_path(&b.root.join("b.txt"))
        .expect("l'arrivo: è comparso un file con la stessa impronta");

    assert_eq!(
        b.bozza_di("b.txt").as_deref(),
        Some("e questo non l'ho salvato"),
        "la bozza ha seguito la nota"
    );
    assert!(
        b.bozza_di("a.txt").is_none(),
        "e non è rimasta anche sotto il nome vecchio"
    );
    assert_eq!(
        b.dati_di("b.txt").as_deref(),
        Some("i dati di a.txt"),
        "e lo spazio per-documento"
    );
    assert!(b.dati_di("a.txt").is_none(), "che si è spostato, non copiato");
    assert_eq!(
        b.ws.organization()
            .icons
            .get("b.txt")
            .map(String::as_str),
        Some("📌"),
        "e l'icona, che passa dalla stessa funzione"
    );
}

/// Una destinazione già viva non è una rinomina (0135): i dati di chi sparisce
/// non si scrivono sopra quelli di chi c'è.
#[test]
fn una_destinazione_viva_non_si_sovrascrive() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("a.txt"), "aaa\n").unwrap();
    std::fs::write(root.join("b.txt"), "bbb\n").unwrap();
    let mut ws = Workspace::new(&root, registry()).expect("apertura");
    ws.reindex().expect("reindex");
    ws.save_draft(&DocId::new("a.txt"), "bozza di a", None)
        .expect("bozza a");
    ws.save_draft(&DocId::new("b.txt"), "bozza di b", None)
        .expect("bozza b");

    std::fs::remove_file(root.join("a.txt")).unwrap();
    ws.sync_path(&root.join("a.txt")).expect("a sparisce");
    // `b` è già in anagrafe: anche se i byte coincidessero, non è una rinomina.
    std::fs::write(root.join("b.txt"), "aaa\n").unwrap();
    ws.sync_path(&root.join("b.txt")).expect("b toccato");

    let bozze = ws.drafts().expect("bozze");
    let di = |doc: &str| {
        bozze
            .drafts
            .iter()
            .find(|d| d.doc.as_str() == doc)
            .map(|d| d.text.as_str())
    };
    assert_eq!(di("b.txt"), Some("bozza di b"), "la bozza di b resta di b");
    assert_ne!(
        di("b.txt"),
        Some("bozza di a"),
        "e quella di a non ci si è scritta sopra"
    );
}

/// Un arrivo con impronta diversa non consuma il posto: non è quella rinomina.
#[test]
fn un_arrivo_con_unaltra_impronta_non_accoppia() {
    let mut b = Banco::nuovo();
    b.ws
        .save_draft(&DocId::new("a.txt"), "bozza di a", None)
        .expect("bozza");
    b.attacca_dati("a.txt");

    std::fs::remove_file(b.root.join("a.txt")).unwrap();
    b.ws.sync_path(&b.root.join("a.txt")).expect("a sparisce");
    std::fs::write(b.root.join("c.txt"), "tutt'altra cosa\n").unwrap();
    b.ws.sync_path(&b.root.join("c.txt")).expect("c compare");

    assert!(
        b.bozza_di("c.txt").is_none(),
        "un contenuto diverso non eredita la bozza"
    );
    assert_eq!(
        b.dati_di("a.txt").as_deref(),
        Some("i dati di a.txt"),
        "i dati restano sotto la chiave vecchia: non si è accoppiato"
    );
}

/// Il supporto verifica **nell'istante del rename del file** che i dati siano
/// già sotto la chiave nuova (difetto 0168).
struct Ordine {
    inner: FsStorage,
    doc_from: Utf8PathBuf,
    data_from: Utf8PathBuf,
    data_to: Utf8PathBuf,
}

impl VaultStorage for Ordine {
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
        if from == self.doc_from {
            assert!(
                self.inner.exists(&self.data_to),
                "i dati per-documento devono già essere sotto la chiave nuova \
                 quando il file si muove (0168)"
            );
            assert!(
                !self.inner.exists(&self.data_from),
                "e non devono più stare sotto la chiave vecchia"
            );
        }
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
fn la_rinomina_interna_migra_i_dati_prima_di_muovere_il_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("a.txt"), "il contenuto\n").unwrap();

    let data_from = root
        .join(".fub/data/plugins")
        .join(PLUGIN)
        .join(doc_data::DOC_SPACE)
        .join(doc_data::encode("a.txt"));
    let data_to = root
        .join(".fub/data/plugins")
        .join(PLUGIN)
        .join(doc_data::DOC_SPACE)
        .join(doc_data::encode("b.txt"));
    let supporto = Arc::new(Ordine {
        inner: FsStorage,
        doc_from: root.join("a.txt"),
        data_from: data_from.clone(),
        data_to: data_to.clone(),
    });
    let mut ws = Workspace::on(
        &root,
        registry(),
        supporto,
        MachineSettings::in_memory(),
    )
    .expect("apertura");
    ws.reindex().expect("reindex");
    std::fs::create_dir_all(&data_from).unwrap();
    std::fs::write(data_from.join("annotazione"), "i dati di a.txt").unwrap();

    ws.rename_document(&DocId::new("a.txt"), &DocId::new("b.txt"))
        .expect("rinomina");

    assert_eq!(
        std::fs::read_to_string(data_to.join("annotazione")).ok().as_deref(),
        Some("i dati di a.txt")
    );
    assert!(!data_from.exists(), "la chiave vecchia è vuota");
}
