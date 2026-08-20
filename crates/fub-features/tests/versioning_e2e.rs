// Il banco di questa feature vive con lei: senza la cargo feature `versioning`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "versioning")]
//! Il versioning montato come lo monta l'app: workspace vero, provider
//! markdown vero, handler registrato come un plugin qualsiasi.
//!
//! Qui si verifica ciò che i test dello store non possono vedere — che gli
//! **eventi** del kernel bastino a tenere la storia allineata al vault — e la
//! proprietà che rende il ripristino sicuro: essendo una scrittura normale
//! (D8), genera a sua volta una versione, quindi si può annullare.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::event::Notice;
use fub_abi::model::DocId;
use fub_features::{VersionStore, VersioningHandler, VERSIONING_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{data_root, FormatRegistry, Workspace};

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
    ///
    /// La prima fotografia è copy-on-first-write (0154): la chiama il gancio
    /// del workspace, un istante prima della prima sovrascrittura. Qui, a
    /// livello kernel, la si chiama a mano dopo `reindex` per avere lo stesso
    /// stato.
    fn open(&self) -> (Workspace, VersionStore) {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        for plugin in [VERSIONING_ID, "test.loudmouth"] {
            ws.register_core_feature(plugin, plugin)
                .expect("dichiarato");
        }
        let store = ws
            .with_host(VERSIONING_ID, VersionStore::open)
            .expect("store versioni");
        let handler = VersioningHandler::new(store.clone());
        ws.register_event_handler(
            VERSIONING_ID,
            Box::new(VersioningHandler::new(store.clone())),
        )
        .expect("registrato");
        ws.reindex().expect("reindex");
        // La prima fotografia è copy-on-first-write (0154): la chiama il
        // gancio del workspace, un istante prima della prima sovrascrittura.
        // Qui, a livello kernel, la si chiama a mano dopo reindex per avere
        // lo stesso stato.
        ws.with_host(VERSIONING_ID, |host| {
            handler.first_snapshot_of_the_vault(host)
        })
        .expect("la prima fotografia");
        (ws, store)
    }

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    /// Apre il vault col versioning **spento** (D7): l'handler non si registra.
    fn open_without_versioning(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        for plugin in [VERSIONING_ID, "test.loudmouth"] {
            ws.register_core_feature(plugin, plugin)
                .expect("dichiarato");
        }
        ws.reindex().expect("reindex");
        ws
    }
}

/// Rileggere una versione passa dall'`HostApi`, come farebbe l'app: lo store
/// non ha un canale sul filesystem tutto suo.
fn version(ws: &mut Workspace, store: &VersionStore, id: &DocId, ts: u64) -> String {
    ws.with_host(VERSIONING_ID, |host| store.read(id, ts, host))
        .expect("lettura della versione")
}

#[test]
fn every_save_that_changes_something_leaves_a_version_behind() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let notes = DocId::new("Nota.md");

    ws.write_document(&notes, "prima stesura\n", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&notes, "seconda stesura\n", WriteBase::Dictated)
        .unwrap();
    // Salvare senza aver cambiato niente non è una versione (D6).
    ws.write_document(&notes, "seconda stesura\n", WriteBase::Dictated)
        .unwrap();

    let versions = store.list(&notes);
    assert_eq!(versions.len(), 2, "versioni: {versions:?}");
    assert_eq!(
        version(&mut ws, &store, &notes, versions[0].ts),
        "seconda stesura\n"
    );
    assert_eq!(
        version(&mut ws, &store, &notes, versions[1].ts),
        "prima stesura\n"
    );
}

#[test]
fn restoring_a_version_is_itself_undoable() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let notes = DocId::new("Nota.md");
    ws.write_document(&notes, "quella buona\n", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&notes, "quella che ho rovinato\n", WriteBase::Dictated)
        .unwrap();

    // Il ripristino è una scrittura normale (D8): non c'è un percorso speciale
    // che scavalchi grafo, indici ed eventi — e infatti passa dall'handler.
    let old = *store.list(&notes).last().unwrap();
    let content = version(&mut ws, &store, &notes, old.ts);
    ws.write_document(&notes, &content, WriteBase::Dictated)
        .unwrap();

    assert_eq!(ws.read_source(&notes).unwrap(), "quella buona\n");
    let versions = store.list(&notes);
    assert_eq!(versions.len(), 3, "il ripristino stesso è una versione");
    // Quindi si può annullare il ripristino: la versione rovinata è ancora lì.
    assert_eq!(
        version(&mut ws, &store, &notes, versions[1].ts),
        "quella che ho rovinato\n"
    );
}

#[test]
fn a_renamed_notes_keeps_its_history_under_the_new_name() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    ws.write_document(&DocId::new("Bozza.md"), "appunti\n", WriteBase::Dictated)
        .unwrap();

    ws.rename_document(&DocId::new("Bozza.md"), &DocId::new("Definitivo.md"))
        .unwrap();

    assert!(store.list(&DocId::new("Bozza.md")).is_empty());
    // L'identità è il path, e la storia lo segue: il rename è un evento a sé
    // (`DocumentRenamed`), non un remove+add che spezzerebbe la cronologia.
    let versions = store.list(&DocId::new("Definitivo.md"));
    assert_eq!(versions.len(), 1);
    assert_eq!(
        version(
            &mut ws,
            &store,
            &DocId::new("Definitivo.md"),
            versions[0].ts
        ),
        "appunti\n"
    );
}

#[test]
fn a_notes_thrown_away_can_still_be_read_from_its_history() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let notes = DocId::new("Effimera.md");
    ws.write_document(
        &notes,
        "contenuto che vorrò rileggere\n",
        WriteBase::Dictated,
    )
    .unwrap();

    ws.delete_document(&notes).unwrap();

    assert!(!ws.documents().contains(&notes));
    let versions = store.list(&notes);
    assert_eq!(
        versions.len(),
        1,
        "il cestino svuota il vault, non la storia"
    );
    assert_eq!(
        version(&mut ws, &store, &notes, versions[0].ts),
        "contenuto che vorrò rileggere\n"
    );
}

#[test]
fn a_restore_from_a_folder_reunites_the_notes_with_its_history() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    std::fs::create_dir_all(v.root.join("progetti")).unwrap();
    let notes = DocId::new("progetti/Nota.md");
    ws.write_document(&notes, "prima del cestino\n", WriteBase::Dictated)
        .unwrap();

    let trashed = ws.delete_document(&notes).unwrap();
    let restored = ws.restore_from_trash(&trashed, None).unwrap();

    // Il sidecar riporta la nota NELLA SUA CARTELLA: la storia è ancora sotto
    // la stessa chiave, con lo snapshot del ripristino in coda — niente storia
    // orfana in radice, niente tombstone che mente.
    assert_eq!(restored, notes);
    let versions = store.list(&notes);
    assert!(!store.is_deleted(&notes));
    assert_eq!(versions.len(), 1, "versioni: {versions:?}");
    assert_eq!(
        version(&mut ws, &store, &notes, versions[0].ts),
        "prima del cestino\n"
    );
}

#[test]
fn a_restore_under_a_new_name_migrates_the_history() {
    let v = Vault::new();
    let (mut ws, store) = v.open();
    let notes = DocId::new("Nota.md");
    ws.write_document(&notes, "prima vita\n", WriteBase::Dictated)
        .unwrap();
    let trashed = ws.delete_document(&notes).unwrap();
    // Il path d'origine viene rioccupato: il ripristino dovrà andare altrove.
    ws.write_document(&notes, "usurpatrice\n", WriteBase::Dictated)
        .unwrap();

    let restored = ws
        .restore_from_trash(&trashed, Some(DocId::new("Nota 1.md")))
        .unwrap();

    assert_eq!(restored, DocId::new("Nota 1.md"));
    // La storia della prima vita ha seguito la nota sul nuovo path (il
    // ripristino emette `DocumentRenamed`): non è rimasta orfana con un
    // tombstone sotto la chiave vecchia — quella ora appartiene all'usurpatrice.
    let migrate = store.list(&DocId::new("Nota 1.md"));
    let contents: Vec<String> = migrate
        .iter()
        .map(|v| version(&mut ws, &store, &DocId::new("Nota 1.md"), v.ts))
        .collect();
    assert!(
        contents.contains(&"prima vita\n".to_string()),
        "la prima vita deve stare nella storia migrata: {contents:?}"
    );
    assert!(!store.is_deleted(&DocId::new("Nota 1.md")));
}

#[test]
fn with_versioning_off_the_vault_has_no_trace_of_it() {
    let v = Vault::new();
    let mut ws = v.open_without_versioning();

    ws.write_document(&DocId::new("Nota.md"), "una stesura\n", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&DocId::new("Nota.md"), "un'altra\n", WriteBase::Dictated)
        .unwrap();

    // Spento = non esiste (D7): nessun handler, e quindi nemmeno la cartella.
    assert!(
        !data_root(&v.root).join("plugins").exists(),
        "il versioning spento non deve scrivere nulla"
    );
}

#[test]
fn the_state_a_notes_was_found_in_is_recoverable_after_the_first_edit() {
    let v = Vault::new();
    // Una nota che c'era già: Fub non l'ha mai vista cambiare.
    v.put("Trovata.md", "come l'ho trovata\n");
    let (mut ws, store) = v.open();
    let notes = DocId::new("Trovata.md");

    ws.write_document(&notes, "come l'ho rovinata\n", WriteBase::Dictated)
        .unwrap();

    // L'handler gira *dopo* la scrittura e vede solo il testo nuovo: senza la
    // prima fotografia — qui chiamata a mano, in produzione dal gancio del
    // workspace (0154) — lo stato originale sarebbe perso.
    let versions = store.list(&notes);
    assert_eq!(versions.len(), 2, "versioni: {versions:?}");
    assert_eq!(
        version(&mut ws, &store, &notes, versions[1].ts),
        "come l'ho trovata\n"
    );
}

#[test]
fn the_history_survives_closing_and_reopening_the_vault() {
    let v = Vault::new();
    let notes = DocId::new("Nota.md");
    {
        let (mut ws, _store) = v.open();
        ws.write_document(&notes, "scritta ieri\n", WriteBase::Dictated)
            .unwrap();
    }

    let (mut ws, store) = v.open();

    let versions = store.list(&notes);
    assert_eq!(versions.len(), 1);
    assert_eq!(
        version(&mut ws, &store, &notes, versions[0].ts),
        "scritta ieri\n"
    );
}

#[test]
fn a_real_overflow_reaches_the_handler_and_it_reconciles() {
    use fub_abi::event::{Event, EventMask};
    use fub_abi::traits::{EventHandler, HostApi};
    use fub_abi::PluginError;

    /// Handler che a ogni evento ne emette un altro: fa esaurire il budget del
    /// dispatch e produce un `Event::Overflow`. È il ping-pong fra plugin che il
    /// budget esiste per troncare — oggi impossibile (l'unico handler
    /// registrato non emette), possibile con i plugin di terzi di M4/M5.
    struct Loudmouth;
    impl EventHandler for Loudmouth {
        fn subscribed(&self) -> EventMask {
            EventMask::all()
        }
        fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
            let event = &notice.event;
            if !matches!(event, Event::Overflow { .. }) {
                host.emit(Event::Custom {
                    topic: "test/eco".into(),
                    payload: serde_json::Value::Null,
                });
            }
            Ok(())
        }
    }

    let v = Vault::new();
    v.put("Nota.md", "come l'ho trovata\n");
    let (mut ws, store) = v.open();
    let notes = DocId::new("Nota.md");
    assert_eq!(store.list(&notes).len(), 1, "la prima fotografia");

    ws.register_event_handler("test.loudmouth", Box::new(Loudmouth))
        .expect("registrato");

    // La nota cambia sul disco e il workspace non ne sa niente: nessun
    // `DocumentChanged`, quindi nessuno snapshot per la via normale.
    v.put("Nota.md", "cambiata alle spalle di tutti\n");
    assert_eq!(store.list(&notes).len(), 1);

    // Un'altra operazione fa traboccare la coda: da qui nasce l'`Event::Overflow`.
    ws.write_document(
        &DocId::new("Altra.md"),
        "qualsiasi cosa\n",
        WriteBase::Dictated,
    )
    .unwrap();

    // L'handler era abbonato, l'overflow gli è arrivato, e la riconciliazione ha
    // riletto il vault: la versione che l'evento perso non ha prodotto c'è.
    let versions = store.list(&notes);
    assert_eq!(
        versions.len(),
        2,
        "l'overflow deve aver innescato la riconciliazione: {versions:?}"
    );
    assert_eq!(
        version(&mut ws, &store, &notes, versions[0].ts),
        "cambiata alle spalle di tutti\n"
    );
}
