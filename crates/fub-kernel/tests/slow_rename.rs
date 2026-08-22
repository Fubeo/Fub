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
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Subscription, Workspace};

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
    fn render_html(&self, m: &DocumentModel, _or: &RenderOptions) -> Result<String, FormatError> {
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

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    ws: Workspace,
}

impl Bench {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("a.txt"), "il contenuto che si sposta\n").expect("semina");
        let mut ws = Workspace::new(&root, registry()).expect("apertura");
        ws.reindex().expect("reindex");
        Bench {
            _dir: dir,
            root,
            ws,
        }
    }

    fn attach_data(&self, doc: &str) {
        let dir = self
            .ws
            .plugin_data_dir(PLUGIN)
            .expect("spazio dati")
            .join(doc_data::DOC_SPACE)
            .join(doc_data::encode(doc));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("annotazione"), format!("i dati di {doc}")).unwrap();
    }

    fn data_of(&self, doc: &str) -> Option<String> {
        let path = self
            .root
            .join(".fub/plugins")
            .join(PLUGIN)
            .join(doc_data::DOC_SPACE)
            .join(doc_data::encode(doc))
            .join("annotazione");
        std::fs::read_to_string(path).ok()
    }

    fn draft_of(&self, doc: &str) -> Option<String> {
        self.ws
            .drafts()
            .expect("bozze")
            .drafts
            .into_iter()
            .find(|b| b.doc.as_str() == doc)
            .map(|b| b.text)
    }
}

/// Gli avvisi arrivati sul bus da quando ci si è iscritti.
fn events(rx: &Subscription) -> Vec<Notice> {
    let mut seen = Vec::new();
    while let Ok(n) = rx.try_recv() {
        seen.push(n);
    }
    seen
}

/// Le due metà di una rinomina esterna, come due lotti del rilevatore.
#[test]
fn a_rename_split_carries_behind_draft_and_data() {
    let mut b = Bench::new();
    b.ws.save_draft(&DocId::new("a.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    b.ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    b.attach_data("a.txt");

    std::fs::rename(b.root.join("a.txt"), b.root.join("b.txt")).expect("rinomina sul disco");
    b.ws.sync_path(&b.root.join("a.txt"))
        .expect("la partenza: il file non c'è più");
    b.ws.sync_path(&b.root.join("b.txt"))
        .expect("l'arrivo: è comparso un file con la stessa impronta");

    assert_eq!(
        b.draft_of("b.txt").as_deref(),
        Some("e questo non l'ho salvato"),
        "la bozza ha seguito la nota"
    );
    assert!(
        b.draft_of("a.txt").is_none(),
        "e non è rimasta anche sotto il nome vecchio"
    );
    assert_eq!(
        b.data_of("b.txt").as_deref(),
        Some("i dati di a.txt"),
        "e lo spazio per-documento"
    );
    assert!(
        b.data_of("a.txt").is_none(),
        "che si è spostato, non copiato"
    );
    assert_eq!(
        b.ws.organization().icons.get("b.txt").map(String::as_str),
        Some("📌"),
        "e l'icona, che passa dalla stessa funzione"
    );
}

/// **La stessa rinomina, ma con partenza e arrivo in due finestre del
/// debounce** (difetto 0198): il caso che il presidio qui sopra non copre.
///
/// Là le due metà si chiamano con `sync_path`, che è la porta del kernel; qui
/// si chiamano con le **fasi di un lotto del rilevatore** — `plan_sync` sotto
/// prestito condiviso e `sync_path_prepared` sotto quello esclusivo, che è
/// ciò che `ExternalSync::batch` fa davvero. La differenza non è di forma: la
/// partenza, che in un lotto vero è un `Touched` su un path sparito, esce da
/// `plan_sync` come `None` — «non c'è niente da preparare» — e tocca a
/// `sync_path_prepared` rifare la strada intera, che è il ramo in cui il
/// documento si toglie e l'impronta si ricorda. Se l'accoppiamento vivesse
/// solo nel ramo «piano pronto», la rinomina spezzata resterebbe spezzata
/// proprio quando il debounce la spezza.
///
/// L'arrivo è il lotto **dopo**: un `Touched` su un path che è comparso, con
/// un piano vero. L'impronta è la stessa di chi è appena sparito, e la bozza,
/// i dati per-documento e l'icona seguono la nota — come nel presidio
/// stessa-finestra, che è il come.
#[test]
fn a_rename_split_in_two_windows_carries_behind_draft_and_data() {
    let mut b = Bench::new();
    b.ws.save_draft(&DocId::new("a.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    b.ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    b.attach_data("a.txt");
    // Chi tiene stato per-documento fuori dallo spazio dichiarato — il
    // versioning, che ha uno store suo — ascolta la rinomina: senza l'evento
    // la storia si spezza in due chiavi.
    let rx = b.ws.bus().subscribe();

    std::fs::rename(b.root.join("a.txt"), b.root.join("b.txt")).expect("rinomina sul disco");

    // Finestra 1: la partenza. Il path non esiste più, quindi `plan_sync` non
    // ha niente da preparare — è il ramo che in `ExternalSync::batch` rifà la
    // strada intera sotto il prestito esclusivo.
    let plan = b.ws.plan_sync(&b.root.join("a.txt"));
    assert!(
        plan.is_none(),
        "un path sparito non ha un piano: è il ramo che la fase 2 rifà per intero"
    );
    b.ws.sync_path_prepared(&b.root.join("a.txt"), plan)
        .expect("la partenza: il file non c'è più");

    // Finestra 2: l'arrivo, con un piano vero.
    let plan = b.ws.plan_sync(&b.root.join("b.txt")).expect("un piano");
    b.ws.sync_path_prepared(&b.root.join("b.txt"), Some(plan))
        .expect("l'arrivo: è comparso un file con la stessa impronta");

    assert_eq!(
        b.draft_of("b.txt").as_deref(),
        Some("e questo non l'ho salvato"),
        "la bozza ha seguito la nota anche attraverso due finestre"
    );
    assert!(
        b.draft_of("a.txt").is_none(),
        "e non è rimasta anche sotto il nome vecchio"
    );
    assert_eq!(
        b.data_of("b.txt").as_deref(),
        Some("i dati di a.txt"),
        "e lo spazio per-documento"
    );
    assert!(
        b.data_of("a.txt").is_none(),
        "che si è spostato, non copiato"
    );
    assert_eq!(
        b.ws.organization().icons.get("b.txt").map(String::as_str),
        Some("📌"),
        "e l'icona"
    );
    // E l'accoppiamento lo **dice**, con lo stesso evento della rinomina
    // vista: il gemello a vault chiuso lo emette (workspace.rs, il precedente
    // del rejoin), e chi ascolta non deve distinguere i due casi.
    let seen = events(&rx);
    assert!(
        seen.iter().any(|n| matches!(
            &n.event,
            Event::DocumentRenamed { from, to }
                if from.as_str() == "a.txt" && to.as_str() == "b.txt"
        )),
        "l'accoppiamento ha annunciato la rinomina: {seen:?}"
    );
}

/// **Un remove seguito a distanza da un add non correlato non diventa una
/// rinomina** (difetto 0198, il falso positivo).
///
/// L'accoppiamento per impronta è la regola della 0099 vista dal rilevatore
/// aperto, e la 0099 ha un bound: **uno solo**. Due sparizioni di fila
/// tengono l'ultima — la prima non ha più un arrivo da aspettare, e un
/// arrivo che arrivasse dopo sarebbe di un'altra mossa. Qui la prima
/// sparizione è di `a.txt`; poi sparisce anche `b.txt`; poi compare `c.txt`
/// con l'impronta di **`a`**. Se il posto non si consumasse, `c` erediterebbe
/// la bozza di `a` — un contenuto identico non è una prova di identità quando
/// in mezzo c'è stata un'altra sparizione.
#[test]
fn a_remove_a_distance_from_a_add_not_related_not_pairs() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("a.txt"), "il contenuto di a\n").unwrap();
    std::fs::write(root.join("b.txt"), "il contenuto di b\n").unwrap();
    let mut ws = Workspace::new(&root, registry()).expect("apertura");
    ws.reindex().expect("reindex");
    ws.save_draft(&DocId::new("a.txt"), "bozza di a", None)
        .expect("bozza a");

    // Due sparizioni di fila: la prima non è più l'ultima.
    std::fs::remove_file(root.join("a.txt")).unwrap();
    ws.sync_path(&root.join("a.txt")).expect("a sparisce");
    std::fs::remove_file(root.join("b.txt")).unwrap();
    ws.sync_path(&root.join("b.txt")).expect("b sparisce");

    // L'arrivo porta l'impronta di `a`, ma non è la stessa mossa: in mezzo
    // c'è stata un'altra sparizione, e il posto di `a` si è consumato.
    std::fs::write(root.join("c.txt"), "il contenuto di a\n").unwrap();
    ws.sync_path(&root.join("c.txt")).expect("c compare");

    assert!(
        ws.drafts()
            .expect("bozze")
            .drafts
            .iter()
            .all(|d| d.doc.as_str() != "c.txt"),
        "un contenuto identico a chi è sparito due mosse fa non eredita la bozza"
    );
    assert_eq!(
        ws.drafts()
            .expect("bozze")
            .drafts
            .iter()
            .find(|d| d.doc.as_str() == "a.txt")
            .map(|d| d.text.as_str()),
        Some("bozza di a"),
        "e la bozza resta sotto la chiave vecchia, dove il recupero la ritrova"
    );
}

/// Una destinazione già viva non è una rinomina (0135): i dati di chi sparisce
/// non si scrivono sopra quelli di chi c'è.
#[test]
fn a_destination_live_not_is_overwrites() {
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

    let drafts = ws.drafts().expect("bozze");
    let of = |doc: &str| {
        drafts
            .drafts
            .iter()
            .find(|d| d.doc.as_str() == doc)
            .map(|d| d.text.as_str())
    };
    assert_eq!(of("b.txt"), Some("bozza di b"), "la bozza di b resta di b");
    assert_eq!(
        of("a.txt"),
        Some("bozza di a"),
        "la destinazione viva non mangia la bozza di a: a è sparita dal disco \
         e la bozza resta orfana sul suo nome"
    );
}

/// Un arrivo con impronta diversa non consuma il posto: non è quella rinomina.
#[test]
fn a_arrival_with_another_fingerprint_not_pairs() {
    let mut b = Bench::new();
    b.ws.save_draft(&DocId::new("a.txt"), "bozza di a", None)
        .expect("bozza");
    b.attach_data("a.txt");

    std::fs::remove_file(b.root.join("a.txt")).unwrap();
    b.ws.sync_path(&b.root.join("a.txt")).expect("a sparisce");
    std::fs::write(b.root.join("c.txt"), "tutt'altra cosa\n").unwrap();
    b.ws.sync_path(&b.root.join("c.txt")).expect("c compare");

    assert!(
        b.draft_of("c.txt").is_none(),
        "un contenuto diverso non eredita la bozza"
    );
    assert_eq!(
        b.data_of("a.txt").as_deref(),
        Some("i dati di a.txt"),
        "i dati restano sotto la chiave vecchia: non si è accoppiato"
    );
}

/// Il supporto verifica **nell'istante del rename del file** che i dati siano
/// già sotto la chiave nuova (difetto 0168).
struct Order {
    inner: FsStorage,
    doc_from: Utf8PathBuf,
    data_from: Utf8PathBuf,
    data_to: Utf8PathBuf,
}

impl VaultStorage for Order {
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
fn the_internal_rename_migrates_data_before_moving_the_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("a.txt"), "il contenuto\n").unwrap();

    // Lo spazio dati autorevole (§31.8): è lì che la rinomina interna deve
    // migrare i dati del documento, non nella cache derivata.
    let data_from = root
        .join(".fub/plugins")
        .join(PLUGIN)
        .join(doc_data::DOC_SPACE)
        .join(doc_data::encode("a.txt"));
    let data_to = root
        .join(".fub/plugins")
        .join(PLUGIN)
        .join(doc_data::DOC_SPACE)
        .join(doc_data::encode("b.txt"));
    let support = Arc::new(Order {
        inner: FsStorage,
        doc_from: root.join("a.txt"),
        data_from: data_from.clone(),
        data_to: data_to.clone(),
    });
    let mut ws =
        Workspace::on(&root, registry(), support, MachineSettings::in_memory()).expect("apertura");
    ws.reindex().expect("reindex");
    std::fs::create_dir_all(&data_from).unwrap();
    std::fs::write(data_from.join("annotazione"), "i dati di a.txt").unwrap();

    ws.rename_document(&DocId::new("a.txt"), &DocId::new("b.txt"))
        .expect("rinomina");

    assert_eq!(
        std::fs::read_to_string(data_to.join("annotazione"))
            .ok()
            .as_deref(),
        Some("i dati di a.txt")
    );
    assert!(!data_from.exists(), "la chiave vecchia è vuota");
}
