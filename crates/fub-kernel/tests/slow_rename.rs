//! **L'identità segue solo una rinomina esplicita.**
//!
//! Le notifiche `Touched` descrivono soltanto lo stato di un path. Anche quando
//! una rimozione e una creazione hanno gli stessi byte, il kernel non può
//! dedurne che siano lo stesso documento: bozza, organizzazione e dati
//! per-documento restano sotto la chiave precedente. La rotta esplicita di
//! rename, invece, migra quell'identità una volta sola.
//!
//! Il secondo presidio resta il difetto 0168: `rename_document` deve spostare i
//! dati prima del file, così un crash fra le due operazioni non lascia il file
//! al nome nuovo e i dati sotto quello vecchio.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::FormatError;
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{ExternalRenamePlan, FormatRegistry, MachineSettings, Subscription, Workspace};

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

/// Rimozione e creazione successiva con gli stessi byte sono due identità.
#[test]
fn same_bytes_remove_then_create_does_not_migrate_identity() {
    let mut b = Bench::new();
    b.ws.save_draft(&DocId::new("a.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    b.ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    b.attach_data("a.txt");

    let bytes = std::fs::read(b.root.join("a.txt")).expect("contenuto");
    std::fs::remove_file(b.root.join("a.txt")).expect("rimozione");
    b.ws.sync_path(&b.root.join("a.txt"))
        .expect("il path è sparito");
    std::fs::write(b.root.join("b.txt"), bytes).expect("creazione successiva");
    b.ws.sync_path(&b.root.join("b.txt"))
        .expect("il nuovo path compare");

    assert!(b.draft_of("b.txt").is_none());
    assert_eq!(
        b.draft_of("a.txt").as_deref(),
        Some("e questo non l'ho salvato")
    );
    assert!(b.data_of("b.txt").is_none());
    assert_eq!(b.data_of("a.txt").as_deref(), Some("i dati di a.txt"));
    assert!(!b.ws.organization().icons.contains_key("b.txt"));
    assert_eq!(
        b.ws.organization().icons.get("a.txt").map(String::as_str),
        Some("📌")
    );
}

/// La rotta `Renamed` del watcher conserva l'identità senza eseguire le fasi
/// detached sotto il workspace.
#[test]
fn a_watcher_rename_carries_identity_once() {
    let mut b = Bench::new();
    b.ws.save_draft(&DocId::new("a.txt"), "testo non salvato", None)
        .expect("bozza");
    b.ws.set_icon("a.txt", Some("📌".into())).expect("icona");
    b.attach_data("a.txt");
    b.ws.set_active_document(Some(DocId::new("a.txt")));
    let rx = b.ws.bus().subscribe();
    let to = b.root.join("nested/b.txt");
    std::fs::create_dir_all(to.parent().expect("cartella destinazione")).expect("cartella");
    std::fs::rename(b.root.join("a.txt"), &to).expect("rinomina sul disco");
    let prepared = match b.ws.plan_external_rename(&b.root.join("a.txt"), &to) {
        ExternalRenamePlan::Document(plan) => plan,
        _ => panic!("la rinomina documento nota deve avere la rotta staged"),
    };
    let parsed = prepared.invoke();
    let pending =
        b.ws.prepare_external_document_rename(parsed)
            .expect("prepare")
            .expect("fotografia corrente");
    let completed = pending.invoke();

    let other_dir = tempfile::tempdir().expect("secondo tempdir");
    let other_root =
        Utf8PathBuf::from_path_buf(other_dir.path().to_path_buf()).expect("seconda radice utf8");
    let mut other = Workspace::new(&other_root, registry()).expect("secondo workspace");
    let completed = match other.finish_external_document_rename(completed) {
        Err((_error, completed)) => completed,
        Ok(outcome) => panic!("il workspace sbagliato ha consumato il token: {outcome}"),
    };
    let result = b.ws.finish_external_document_rename(completed);
    let Ok(rename_is_current) = result else {
        panic!("il proprietario recupera il token");
    };
    assert!(rename_is_current, "la fotografia resta corrente");

    let renamed = DocId::new("nested/b.txt");
    assert!(!b.ws.documents().contains(&DocId::new("a.txt")));
    assert!(b.ws.documents().contains(&renamed));
    assert_eq!(
        b.draft_of(renamed.as_str()).as_deref(),
        Some("testo non salvato")
    );
    assert!(b.draft_of("a.txt").is_none());
    assert_eq!(
        b.data_of(renamed.as_str()).as_deref(),
        Some("i dati di a.txt")
    );
    assert!(b.data_of("a.txt").is_none());
    assert_eq!(
        b.ws.organization()
            .icons
            .get(renamed.as_str())
            .map(String::as_str),
        Some("📌")
    );
    assert!(
        !b.ws.organization().icons.contains_key("a.txt"),
        "l'organizzazione non conserva la chiave vecchia"
    );
    assert_eq!(
        b.ws.active_document().as_ref().map(DocId::as_str),
        Some("nested/b.txt")
    );
    let IndexResult::Folders(folders) =
        b.ws.query_index(IndexQuery::Folders {
            under: None,
            page: None,
        })
        .expect("indice cartelle")
    else {
        panic!("risposta cartelle");
    };
    assert!(
        folders.items.iter().any(|folder| folder.path == "nested"),
        "la prepare registra la cartella d'arrivo"
    );

    let seen = events(&rx);
    assert_eq!(
        seen.iter()
            .filter(|notice| matches!(&notice.event, Event::DocumentRenamed { .. }))
            .count(),
        1,
        "DocumentRenamed esce una volta: {seen:?}"
    );
    assert_eq!(
        seen.iter()
            .filter(|notice| matches!(&notice.event, Event::IndexUpdated))
            .count(),
        1,
        "IndexUpdated esce una volta: {seen:?}"
    );
    assert!(
        seen.iter().all(|notice| !matches!(
            &notice.event,
            Event::DocumentRemoved { .. } | Event::DocumentChanged { .. }
        )),
        "nessun evento remove/change duplicato: {seen:?}"
    );
}

/// Anche attraverso le fasi detached di due lotti, gli stessi byte non
/// trasformano due `Touched` in una rinomina.
#[test]
fn same_bytes_in_two_watcher_windows_do_not_migrate_identity() {
    let mut b = Bench::new();
    b.ws.save_draft(&DocId::new("a.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    b.attach_data("a.txt");
    let rx = b.ws.bus().subscribe();

    let bytes = std::fs::read(b.root.join("a.txt")).expect("contenuto");
    std::fs::remove_file(b.root.join("a.txt")).expect("rimozione");
    let plan =
        b.ws.plan_sync(&b.root.join("a.txt"))
            .expect("piano di rimozione")
            .invoke();
    b.ws.sync_path_prepared(&b.root.join("a.txt"), Some(plan))
        .expect("primo lotto");

    std::fs::write(b.root.join("b.txt"), bytes).expect("creazione");
    let plan =
        b.ws.plan_sync(&b.root.join("b.txt"))
            .expect("piano di creazione")
            .invoke();
    b.ws.sync_path_prepared(&b.root.join("b.txt"), Some(plan))
        .expect("secondo lotto");

    assert!(b.draft_of("b.txt").is_none());
    assert_eq!(
        b.draft_of("a.txt").as_deref(),
        Some("e questo non l'ho salvato")
    );
    assert!(b.data_of("b.txt").is_none());
    assert_eq!(b.data_of("a.txt").as_deref(), Some("i dati di a.txt"));
    assert!(events(&rx)
        .iter()
        .all(|notice| !matches!(&notice.event, Event::DocumentRenamed { .. })));
}

/// Più rimozioni e creazioni nello stesso scenario non si accoppiano per
/// contenuto: senza un fatto di rename ogni nuova chiave resta nuova.
#[test]
fn multiple_same_bytes_pairs_do_not_migrate_without_explicit_renames() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("a.txt"), "contenuto a\n").unwrap();
    std::fs::write(root.join("b.txt"), "contenuto b\n").unwrap();
    let mut ws = Workspace::new(&root, registry()).expect("apertura");
    ws.reindex().expect("reindex");
    ws.save_draft(&DocId::new("a.txt"), "bozza a", None)
        .expect("bozza a");
    ws.save_draft(&DocId::new("b.txt"), "bozza b", None)
        .expect("bozza b");

    std::fs::remove_file(root.join("a.txt")).unwrap();
    std::fs::remove_file(root.join("b.txt")).unwrap();
    ws.sync_path(&root.join("a.txt")).expect("a sparisce");
    ws.sync_path(&root.join("b.txt")).expect("b sparisce");
    std::fs::write(root.join("c.txt"), "contenuto a\n").unwrap();
    std::fs::write(root.join("d.txt"), "contenuto b\n").unwrap();
    ws.sync_path(&root.join("c.txt")).expect("c compare");
    ws.sync_path(&root.join("d.txt")).expect("d compare");

    let drafts = ws.drafts().expect("bozze");
    let of = |doc: &str| {
        drafts
            .drafts
            .iter()
            .find(|draft| draft.doc.as_str() == doc)
            .map(|draft| draft.text.as_str())
    };
    assert_eq!(of("a.txt"), Some("bozza a"));
    assert_eq!(of("b.txt"), Some("bozza b"));
    assert_eq!(of("c.txt"), None);
    assert_eq!(of("d.txt"), None);
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
