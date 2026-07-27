//! Come il kernel alimenta gli [`IndexProvider`].
//!
//! La proprietà sotto esame è che **un indice non può perdere aggiornamenti**:
//! il `Workspace` lo alimenta dentro le stesse operazioni che aggiornano il
//! grafo, non via event bus (che invece ha un budget e può troncare). Qui non
//! c'è tantivy: c'è una spia che registra le chiamate ricevute, così il test
//! parla del *contratto* e non dell'implementazione.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::Notice;
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fubmd_abi::traits::{
    DocumentMatch, HostApi, IndexProvider, IndexQuery, IndexResult, Page, Paged, PredicateKind,
    PropertySelect, QueryRoute,
};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Provider minimo: il documento è il suo testo, niente link né struttura.
/// All'indice serve solo che `DocumentModel.text` arrivi popolato.
struct PlainProvider;

impl FormatProvider for PlainProvider {
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
        let source = source.text().unwrap_or_default();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Una chiamata ricevuta dalla spia.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    /// L'attivazione, col contenuto ritrovato nel proprio storage (`None` = mai
    /// scritto niente): è il punto in cui un indice persistente si ricorda.
    Activate(Option<String>),
    Indexed(String, String),
    Removed(String),
    Reconcile(Vec<String>),
    Flush,
    Query,
}

/// Nome del blob con cui la spia si ricorda di sé stessa, nello spazio dati che
/// l'host le assegna.
const MEMORIA: &str = "memoria.txt";

/// Spia che registra ciò che il kernel le manda.
///
/// `answers`: cosa risponde alle query. `None` = "non è roba mia"
/// (`BadArgs`), che è il modo con cui, per contratto, un provider si sfila e
/// lascia la parola al successivo.
struct SpyIndex {
    calls: Arc<Mutex<Vec<Call>>>,
    answers: bool,
}

impl SpyIndex {
    fn new(answers: bool) -> (Self, Arc<Mutex<Vec<Call>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        (
            SpyIndex {
                calls: calls.clone(),
                answers,
            },
            calls,
        )
    }

    fn record(&self, call: Call) {
        self.calls.lock().unwrap().push(call);
    }
}

impl IndexProvider for SpyIndex {
    /// Una spia che risponde dichiara di saper valutare il **testo**; una muta
    /// non dichiara niente — e non è più un indice che dice «non è roba mia» a
    /// ogni domanda, è un indice che non ne riceve nessuna.
    fn routes(&self) -> Vec<QueryRoute> {
        if self.answers {
            vec![QueryRoute::Predicate(PredicateKind::Text)]
        } else {
            Vec::new()
        }
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // Un indice persistente si ricorda da `data_*`, ed è l'unico storage
        // durevole che avrà anche un provider di terzi: la spia lo esercita
        // come lo eserciterebbe lui.
        let memoria = host
            .data_read(MEMORIA)?
            .map(|b| String::from_utf8_lossy(&b).into_owned());
        self.record(Call::Activate(memoria));
        host.data_write(MEMORIA, b"c'ero")?;
        Ok(())
    }

    fn on_document_indexed(&mut self, doc: &DocumentModel) {
        self.record(Call::Indexed(doc.id.to_string(), doc.text.clone()));
    }

    fn on_document_removed(&mut self, id: &DocId) {
        self.record(Call::Removed(id.to_string()));
    }

    fn reconcile(&mut self, ids: &[DocId]) {
        let mut ids: Vec<String> = ids.iter().map(|i| i.to_string()).collect();
        ids.sort();
        self.record(Call::Reconcile(ids));
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.record(Call::Flush);
        Ok(())
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.record(Call::Query);
        Ok(IndexResult::Documents(Paged::all(vec![DocumentMatch::of(
            DocId::new("risposta.txt"),
        )
        .with_score(1.0)])))
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    fn write(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(Box::new(PlainProvider))
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry);
        for plugin in [
            "test.spia",
            "test.loudmouth",
            "test.muta",
            "test.risponde",
            "test.rivale",
            "test.altra",
        ] {
            ws.register_core_feature(plugin, plugin)
                .expect("dichiarato");
        }
        ws
    }
}

fn calls_of(log: &Arc<Mutex<Vec<Call>>>) -> Vec<Call> {
    log.lock().unwrap().clone()
}

#[test]
fn reindex_feeds_every_document_then_declares_the_full_truth() {
    let fx = Fixture::new();
    fx.write("a.txt", "alfa");
    fx.write("sub/b.txt", "beta");

    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");
    ws.reindex().unwrap();

    let calls = calls_of(&log);
    assert!(calls.contains(&Call::Indexed("a.txt".into(), "alfa".into())));
    assert!(calls.contains(&Call::Indexed("sub/b.txt".into(), "beta".into())));
    // La riconciliazione arriva DOPO l'alimentazione — altrimenti dichiarerebbe
    // morti documenti che l'indice non ha ancora visto — e prima del flush.
    let reconcile = calls
        .iter()
        .position(|c| matches!(c, Call::Reconcile(_)))
        .expect("reconcile");
    let flush = calls.iter().position(|c| *c == Call::Flush).expect("flush");
    assert!(
        calls[..reconcile]
            .iter()
            .filter(|c| matches!(c, Call::Indexed(..)))
            .count()
            == 2
    );
    assert!(reconcile < flush);
    assert_eq!(
        calls[reconcile],
        Call::Reconcile(vec!["a.txt".into(), "sub/b.txt".into()])
    );
}

#[test]
fn writes_and_removals_reach_the_index() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");
    ws.reindex().unwrap();
    log.lock().unwrap().clear();

    ws.write_document(&DocId::new("nuova.txt"), "contenuto")
        .unwrap();
    ws.remove_document(&DocId::new("nuova.txt"));

    assert_eq!(
        calls_of(&log),
        vec![
            Call::Indexed("nuova.txt".into(), "contenuto".into()),
            Call::Removed("nuova.txt".into()),
        ]
    );
}

#[test]
fn a_rename_is_remove_plus_add_for_an_index() {
    let fx = Fixture::new();
    fx.write("vecchio.txt", "corpo");

    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");
    ws.reindex().unwrap();
    log.lock().unwrap().clear();

    ws.rename_document(&DocId::new("vecchio.txt"), &DocId::new("nuovo.txt"))
        .unwrap();

    // Per l'indice la chiave È l'identità, e la chiave è cambiata: il vecchio
    // documento va cancellato, altrimenti resterebbe cercabile un fantasma.
    assert_eq!(
        calls_of(&log),
        vec![
            Call::Removed("vecchio.txt".into()),
            Call::Indexed("nuovo.txt".into(), "corpo".into()),
        ]
    );
}

#[test]
fn an_index_never_misses_an_update_even_when_the_event_queue_overflows() {
    use fubmd_abi::event::{Event, EventMask};
    use fubmd_abi::traits::EventHandler;

    /// Handler che a ogni evento ne emette un altro: fa esaurire il budget del
    /// dispatch e produce un `Event::Overflow`.
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

    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");
    ws.register_event_handler("test.loudmouth", Box::new(Loudmouth))
        .expect("registrato");
    ws.reindex().unwrap();
    log.lock().unwrap().clear();

    // Questa scrittura fa traboccare la coda eventi...
    ws.write_document(&DocId::new("a.txt"), "sopravvissuto")
        .unwrap();

    // ...ma l'indice ha ricevuto comunque il suo aggiornamento, perché non
    // passa dalla coda: è la ragione per cui il kernel lo alimenta da sé.
    assert_eq!(
        calls_of(&log),
        vec![Call::Indexed("a.txt".into(), "sopravvissuto".into())]
    );
}

#[test]
fn a_file_the_vault_ignores_never_reaches_models_events_or_index() {
    let fx = Fixture::new();
    fx.write("viva.txt", "presente");

    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");
    ws.reindex().unwrap();
    log.lock().unwrap().clear();
    let events = ws.bus().subscribe();

    // Questi file esistono, hanno un'estensione gestita e un provider: è solo
    // il posto in cui si trovano a renderli invisibili al vault. Ed è il
    // percorso del *watcher* — `sync_path` — non quello della scansione, che
    // il filtro già lo aveva.
    let ignorati = [
        ".trash/cestinata.txt",
        ".obsidian/workspace.txt",
        "node_modules/pacchetto/readme.txt",
    ];
    for rel in ignorati {
        fx.write(rel, "roba che il vault non deve guardare");
        assert!(
            !ws.sync_path(&fx.root.join(rel)).unwrap(),
            "{rel} non è roba del vault"
        );
    }

    assert_eq!(ws.documents(), vec![DocId::new("viva.txt")]);
    assert!(
        calls_of(&log).is_empty(),
        "l'indice non deve nemmeno sentirne parlare: sarebbe cercabile una nota cestinata"
    );
    assert!(events.try_iter().next().is_none(), "nessun evento");
}

#[test]
fn backlinks_never_reach_the_providers() {
    let fx = Fixture::new();
    fx.write("a.txt", "corpo");

    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");
    ws.reindex().unwrap();
    log.lock().unwrap().clear();

    let r = ws.query_index(IndexQuery::Backlinks {
        target: DocId::new("a.txt"),
        page: None,
    });

    // Il grafo del kernel è l'unica fonte di verità dei backlink: nessun
    // provider viene interpellato, non c'è una seconda verità che possa
    // divergere dalla prima.
    assert!(matches!(r, Ok(IndexResult::Backlinks(_))));
    assert!(calls_of(&log).is_empty());
}

/// Chi non ha dichiarato una rotta **non viene interpellato**: non c'è nessuna
/// caduta in avanti da provocare, e la spia muta non vede passare niente.
#[test]
fn a_provider_that_declared_nothing_is_never_asked() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let (mute, mute_log) = SpyIndex::new(false);
    let (answering, answering_log) = SpyIndex::new(true);
    ws.register_index_provider("test.muta", Box::new(mute))
        .expect("registrato");
    ws.register_index_provider("test.risponde", Box::new(answering))
        .expect("registrato");
    ws.reindex().unwrap();
    mute_log.lock().unwrap().clear();
    answering_log.lock().unwrap().clear();

    let r = ws.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms("qualsiasi"))),
        sort: None,
        select: PropertySelect::None,
        page: Some(Page::first(5)),
    });

    match r {
        Ok(IndexResult::Documents(hits)) => {
            assert_eq!(hits.items[0].doc, DocId::new("risposta.txt"))
        }
        other => panic!("attesi dei documenti, trovato {other:?}"),
    }
    assert!(
        calls_of(&mute_log).is_empty(),
        "prima veniva interpellata per prima e rispondeva `BadArgs`: il \
         dispatch per tentativi faceva girare ogni query su ogni indice"
    );
    assert_eq!(calls_of(&answering_log), vec![Call::Query]);
}

/// «Nessuno la serve» è una risposta a sé, e non l'errore dell'ultimo
/// interpellato: chi disegna deve poter scegliere fra «installa un indice» e
/// «qualcosa è andato storto».
#[test]
fn a_query_nobody_declared_is_unserved() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let (mute, _) = SpyIndex::new(false);
    ws.register_index_provider("test.muta", Box::new(mute))
        .expect("registrato");
    ws.reindex().unwrap();

    let r = ws.query_index(IndexQuery::Custom {
        ns: "nessuno".into(),
        query: serde_json::Value::Null,
    });
    assert!(matches!(r, Err(PluginError::Unserved(_))), "{r:?}");
}

#[test]
fn with_no_provider_a_search_says_so_instead_of_pretending() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.reindex().unwrap();

    let r = ws.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms("qualsiasi"))),
        sort: None,
        select: PropertySelect::None,
        page: Some(Page::first(5)),
    });
    // Zero risultati e "nessun indice sa cercare nel testo" sono due cose
    // diverse: la prima è una risposta, la seconda una mancanza, e confonderle
    // nasconderebbe un guasto.
    assert!(matches!(r, Err(PluginError::Unserved(_))), "{r:?}");
}

/// Due indici che rivendicano la stessa famiglia: prima vinceva il primo
/// registrato **in silenzio**, adesso il secondo non si registra e lo dice.
#[test]
fn two_indexes_claiming_the_same_family_is_a_conflict_at_registration() {
    struct Rivale;
    impl IndexProvider for Rivale {
        fn routes(&self) -> Vec<QueryRoute> {
            vec![QueryRoute::Query(fubmd_abi::traits::QueryKind::Tags)]
        }
        fn activate(&mut self, _h: &mut dyn HostApi) -> Result<(), PluginError> {
            Ok(())
        }
        fn on_document_indexed(&mut self, _d: &DocumentModel) {}
        fn on_document_removed(&mut self, _id: &DocId) {}
        fn reconcile(&mut self, _ids: &[DocId]) {}
        fn flush(&mut self, _h: &mut dyn HostApi) -> Result<(), PluginError> {
            Ok(())
        }
        fn query(&self, _q: IndexQuery) -> Result<IndexResult, PluginError> {
            Ok(IndexResult::Tags(Paged::all(vec![
                fubmd_abi::traits::TagCount {
                    name: "dal-rivale".into(),
                    count: 1,
                },
            ])))
        }
    }

    let fx = Fixture::new();
    fx.write("a.txt", "#gatto");
    let mut ws = fx.workspace();
    let err = ws
        .register_index_provider("test.rivale", Box::new(Rivale))
        .expect_err("i tag sono già dell'indice del kernel");
    assert!(
        matches!(err, fubmd_kernel::RegistryError::Route(_)),
        "{err}"
    );
    ws.reindex().unwrap();

    // E chi c'era risponde ancora: il perdente non si è registrato a metà.
    let r = ws.query_index(IndexQuery::Tags {
        matching: QueryExpr::all(),
        page: None,
    });
    match r {
        Ok(IndexResult::Tags(tags)) => assert!(
            !tags.items.iter().any(|t| t.name == "dal-rivale"),
            "risponde ancora l'indice del kernel: il perdente non si è \
             registrato nemmeno a metà"
        ),
        other => panic!("attesi dei tag, trovato {other:?}"),
    }

    // Sostituirlo resta possibile, ma si chiede per nome.
    ws.replace_index_provider("test.rivale", Box::new(Rivale))
        .expect("la sostituzione dichiarata non è un conflitto");
    let r = ws.query_index(IndexQuery::Tags {
        matching: QueryExpr::all(),
        page: None,
    });
    match r {
        Ok(IndexResult::Tags(tags)) => assert_eq!(
            tags.items.first().map(|t| t.name.as_str()),
            Some("dal-rivale"),
            "adesso risponde il rivale, e il kernel non è più il primo \
             rispondente non scavalcabile"
        ),
        other => panic!("attesi dei tag, trovato {other:?}"),
    }
}

#[test]
fn registering_an_index_activates_it_in_its_own_data_space() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    ws.register_index_provider("test.spia", Box::new(spy))
        .expect("registrato");

    // L'attivazione è la PRIMA cosa che accade, e accade alla registrazione:
    // dopo il primo `on_document_indexed` sarebbe già troppo tardi per
    // ricordarsi di ciò che si è già visto.
    assert_eq!(calls_of(&log), vec![Call::Activate(None)]);

    // E ciò che l'indice scrive finisce nel *suo* recinto, che gli assegna
    // l'host: il provider ha nominato un blob, non un path.
    let memoria = fx
        .root
        .join(".fubmd-data")
        .join("plugins")
        .join("test.spia")
        .join(MEMORIA);
    assert_eq!(std::fs::read_to_string(&memoria).unwrap(), "c'ero");

    // Alla riapertura del vault la memoria si ritrova. È esattamente ciò che
    // un indice persistente deve poter fare — e ciò che, senza host in
    // `activate`, un provider di terzi non potrebbe fare affatto.
    let mut riaperto = fx.workspace();
    let (spy, log) = SpyIndex::new(true);
    riaperto
        .register_index_provider("test.spia", Box::new(spy))
        .unwrap();
    assert_eq!(calls_of(&log), vec![Call::Activate(Some("c'ero".into()))]);

    // Un altro indice non vede la memoria del primo: il recinto è per-id.
    let (spy, log) = SpyIndex::new(true);
    riaperto
        .register_index_provider("test.altra", Box::new(spy))
        .unwrap();
    assert_eq!(calls_of(&log), vec![Call::Activate(None)]);
}
