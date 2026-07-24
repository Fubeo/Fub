//! Il versioning montato come lo monta l'app: workspace vero, provider
//! markdown vero, handler registrato come un plugin qualsiasi.
//!
//! Qui si verifica ciò che i test dello store non possono vedere — che gli
//! **eventi** del kernel bastino a tenere la storia allineata al vault — e la
//! proprietà che rende il ripristino sicuro: essendo una scrittura normale
//! (D8), genera a sua volta una versione, quindi si può annullare.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_features::{VersionStore, VersioningHandler};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    /// Apre il vault col versioning acceso, e restituisce anche lo store: è
    /// esattamente la coppia che tiene l'app — una copia dentro l'handler, una
    /// in mano a chi deve elencare e rileggere le versioni.
    fn open(&self) -> (Workspace, VersionStore) {
        let mut registry = FormatRegistry::new();
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        let store = VersionStore::open(&self.root).expect("store versioni");
        ws.register_event_handler(Box::new(VersioningHandler::new(store.clone())));
        ws.reindex().expect("reindex");
        // La prima fotografia del vault, come la scatta l'app.
        for id in ws.documents() {
            if store.has_versions(&id) {
                continue;
            }
            let source = ws.read_source(&id).expect("lettura");
            store.snapshot(&id, &source).expect("prima versione");
        }
        (ws, store)
    }

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    /// Apre il vault col versioning **spento** (D7): l'handler non si registra.
    fn open_senza_versioning(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        ws.reindex().expect("reindex");
        ws
    }
}

#[test]
fn every_save_that_changes_something_leaves_a_version_behind() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let nota = DocId::new("Nota.md");

    ws.write_document(&nota, "prima stesura\n").unwrap();
    ws.write_document(&nota, "seconda stesura\n").unwrap();
    // Salvare senza aver cambiato niente non è una versione (D6).
    ws.write_document(&nota, "seconda stesura\n").unwrap();

    let versioni = store.list(&nota);
    assert_eq!(versioni.len(), 2, "versioni: {versioni:?}");
    assert_eq!(store.read(&nota, versioni[0].ts).unwrap(), "seconda stesura\n");
    assert_eq!(store.read(&nota, versioni[1].ts).unwrap(), "prima stesura\n");
}

#[test]
fn restoring_a_version_is_itself_undoable() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let nota = DocId::new("Nota.md");
    ws.write_document(&nota, "quella buona\n").unwrap();
    ws.write_document(&nota, "quella che ho rovinato\n").unwrap();

    // Il ripristino è una scrittura normale (D8): non c'è un percorso speciale
    // che scavalchi grafo, indici ed eventi — e infatti passa dall'handler.
    let vecchia = *store.list(&nota).last().unwrap();
    let contenuto = store.read(&nota, vecchia.ts).unwrap();
    ws.write_document(&nota, &contenuto).unwrap();

    assert_eq!(ws.read_source(&nota).unwrap(), "quella buona\n");
    let versioni = store.list(&nota);
    assert_eq!(versioni.len(), 3, "il ripristino stesso è una versione");
    // Quindi si può annullare il ripristino: la versione rovinata è ancora lì.
    assert_eq!(
        store.read(&nota, versioni[1].ts).unwrap(),
        "quella che ho rovinato\n"
    );
}

#[test]
fn a_renamed_note_keeps_its_history_under_the_new_name() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    ws.write_document(&DocId::new("Bozza.md"), "appunti\n").unwrap();

    ws.rename_document(&DocId::new("Bozza.md"), &DocId::new("Definitivo.md"))
        .unwrap();

    assert!(store.list(&DocId::new("Bozza.md")).is_empty());
    // L'identità è il path, e la storia lo segue: il rename è un evento a sé
    // (`DocumentRenamed`), non un remove+add che spezzerebbe la cronologia.
    let versioni = store.list(&DocId::new("Definitivo.md"));
    assert_eq!(versioni.len(), 1);
    assert_eq!(
        store.read(&DocId::new("Definitivo.md"), versioni[0].ts).unwrap(),
        "appunti\n"
    );
}

#[test]
fn a_note_thrown_away_can_still_be_read_from_its_history() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let nota = DocId::new("Effimera.md");
    ws.write_document(&nota, "contenuto che vorrò rileggere\n").unwrap();

    ws.delete_document(&nota).unwrap();

    assert!(!ws.documents().contains(&nota));
    let versioni = store.list(&nota);
    assert_eq!(versioni.len(), 1, "il cestino svuota il vault, non la storia");
    assert_eq!(
        store.read(&nota, versioni[0].ts).unwrap(),
        "contenuto che vorrò rileggere\n"
    );
}

#[test]
fn with_versioning_off_the_vault_has_no_trace_of_it() {
    let v = Vault::new();
    let mut ws = v.open_senza_versioning();

    ws.write_document(&DocId::new("Nota.md"), "una stesura\n").unwrap();
    ws.write_document(&DocId::new("Nota.md"), "un'altra\n").unwrap();

    // Spento = non esiste (D7): nessun handler, e quindi nemmeno la cartella.
    assert!(
        !v.root.join(".fubmd-data").join("versions").exists(),
        "il versioning spento non deve scrivere nulla"
    );
}

#[test]
fn the_state_a_note_was_found_in_is_recoverable_after_the_first_edit() {
    let v = Vault::new();
    // Una nota che c'era già: FubMD non l'ha mai vista cambiare.
    v.put("Trovata.md", "come l'ho trovata\n");
    let (mut ws, store) = v.open();
    let nota = DocId::new("Trovata.md");

    ws.write_document(&nota, "come l'ho rovinata\n").unwrap();

    // L'handler gira *dopo* la scrittura e vede solo il testo nuovo: senza la
    // prima fotografia all'apertura, lo stato originale sarebbe perso.
    let versioni = store.list(&nota);
    assert_eq!(versioni.len(), 2, "versioni: {versioni:?}");
    assert_eq!(
        store.read(&nota, versioni[1].ts).unwrap(),
        "come l'ho trovata\n"
    );
}

#[test]
fn the_history_survives_closing_and_reopening_the_vault() {
    let v = Vault::new();
    let nota = DocId::new("Nota.md");
    {
        let (mut ws, _store) = v.open();
        ws.write_document(&nota, "scritta ieri\n").unwrap();
    }

    let (_ws, store) = v.open();

    let versioni = store.list(&nota);
    assert_eq!(versioni.len(), 1);
    assert_eq!(store.read(&nota, versioni[0].ts).unwrap(), "scritta ieri\n");
}
