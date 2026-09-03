//! **Come un componente smette, e come si chiude il vault** (§9.2 + §9.4,
//! decisione 0028; §9.5, decisione 0029).
//!
//! Prima di questa seduta il kernel sapeva solo aggiungere: `register_*` faceva
//! `push`, `IndexProvider` non aveva un `close`, e "spento" poteva voler dire
//! una cosa sola — non registrato all'avvio, deciso da una variabile
//! d'ambiente. Qui si prova l'inverso: che `deactivate_plugin` **toglie
//! davvero**, che l'ultima cosa che un indice riceve sono `flush` e poi `close`,
//! e che ciò che resta non eredita ciò che se n'è andato.
//!
//! L'ultimo punto è quello che si sarebbe scoperto tardi: le rotte del canale
//! dati puntano a una **posizione** nell'elenco degli indici, e togliere il
//! primo di due, senza rimappare, manderebbe le domande del primo al secondo —
//! che risponderebbe, e nessuno avrebbe modo di accorgersi che sta rispondendo
//! per conto di un altro.
//!
//! In coda ci sono le due prove della **chiusura del vault**, che è la stessa
//! cosa fatta a tutti in una volta: l'ordine — l'evento mentre si può ancora
//! scrivere, poi il flush, poi chi smette — e l'idempotenza.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::edit::WriteBase;
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::format::{ParseContext, RenderOptions};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, JobSpec,
    PluginManifest, PluginPermissions, QueryKind, QueryRoute, ReadApi, ViewInstance, ViewProvider,
    ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_kernel::{FormatRegistry, RegistryError, Trust, Workspace};
use fub_testkit::SampleExtractor;

// --- il minimo indispensabile per avere un vault ----------------------------

// --- una spia che registra la propria vita ----------------------------------

/// Cosa un indice ha ricevuto, in ordine.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Life {
    Activated,
    Indexed(String),
    Flush,
    Closed,
    Queried,
}

/// Un indice che serve **una** famiglia custom e scrive la propria vita su un
/// registro condiviso.
struct Spy {
    ns: &'static str,
    life: Arc<Mutex<Vec<Life>>>,
}

impl Spy {
    fn new(ns: &'static str) -> (Self, Arc<Mutex<Vec<Life>>>) {
        let life = Arc::new(Mutex::new(Vec::new()));
        (
            Spy {
                ns,
                life: life.clone(),
            },
            life,
        )
    }

    fn record(&self, v: Life) {
        self.life.lock().unwrap().push(v);
    }
}

impl IndexProvider for Spy {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(self.ns.to_string()))]
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.record(Life::Activated);
        Ok(())
    }

    /// Una voce **per documento** anche se l'alimentazione è a lotti: la spia
    /// serve a dire *quali* documenti sono arrivati, e contare i lotti non lo
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        for doc in docs {
            self.record(Life::Indexed(doc.id.to_string()));
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.record(Life::Flush);
        Ok(())
    }

    /// La chiusura ha l'host, e la spia lo usa: è il punto in cui un indice
    /// persistente lascia scritto di essersi chiuso bene.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.record(Life::Closed);
        host.data_write("closed", b"yes")?;
        Ok(())
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.record(Life::Queried);
        Ok(IndexResult::Custom(serde_json::json!({ "from": self.ns })))
    }
}

// --- gli altri quattro modi di registrarsi ----------------------------------

struct Panel(&'static str);

impl ViewProvider for Panel {
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(self.0, "Panel", ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("hi"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

struct Listener(Arc<Mutex<u32>>);

impl EventHandler for Listener {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, _notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        *self.0.lock().unwrap() += 1;
        Ok(())
    }
}

struct Rule(&'static str);

impl SyntaxRule for Rule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: self.0.to_string(),
            format: "plain".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["test".into()],
            },
            order: 0,
            option: None,
            produces: vec![format!("{}:block", ns_of(self.0))],
        }
    }

    fn apply(
        &self,
        _m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(None)
    }
}

struct Drawer(&'static str);

impl CustomRenderer for Drawer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: self.0.to_string(),
            kinds: vec![format!("{}:block", ns_of(self.0))],
        }
    }

    fn render(
        &self,
        _block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        Ok(CustomRendering::Fallback)
    }
}

/// Il namespace di un id `ns:name`.
fn ns_of(id: &str) -> &str {
    id.split_once(':').map(|(ns, _)| ns).unwrap_or(id)
}

// --- il banco ---------------------------------------------------------------

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Bench {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("a.txt"), "hi").unwrap();
        Bench { _dir: dir, root }
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleExtractor::by_extension("txt").boxed())
            .expect("format");
        let mut ws = Workspace::new(&self.root, registry).expect("the vault opens");
        for id in ["test.one", "test.two"] {
            declare(&mut ws, id);
        }
        ws
    }
}

/// Dichiara un plugin **non** del core: i suoi nomi vivono sotto il proprio id
/// (§7.4), che è ciò che serve a una regola sintattica e a un renderer — i loro
/// id vogliono un namespace, e per il core quel namespace sarebbe `fub`.
///
/// I permessi sono quelli di una feature ufficiale perché qui si prova il ciclo
/// di vita, non il §7.3: senza `write_vault` un handler che scrive riceverebbe
/// un rifiuto, e il test parlerebbe della politica invece che della chiusura.
/// un rifiuto, e il test parlerebbe della politica invece che della chiusura.
fn declare(ws: &mut Workspace, id: &str) {
    ws.register_plugin(
        PluginManifest::new(id, id).granting(PluginPermissions::core()),
        Trust::Community,
    )
    .expect("declared");
}

fn life(log: &Arc<Mutex<Vec<Life>>>) -> Vec<Life> {
    log.lock().unwrap().clone()
}

fn custom(ns: &str) -> IndexQuery {
    IndexQuery::Custom {
        ns: ns.to_string(),
        query: serde_json::Value::Null,
    }
}

// --- le prove ---------------------------------------------------------------

/// L'ultima cosa che un indice riceve sono `flush` e **poi** `close`, in
/// quest'ordine — e dopo non riceve più niente, nemmeno l'alimentazione.
#[test]
fn a_deactivated_index_receives_flush_then_close_then_nothing() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let (spy, log) = Spy::new("test.one:data");
    ws.register_index_provider("test.one", Box::new(spy))
        .expect("registered");
    ws.reindex().expect("scan");

    let errors = ws.deactivate_plugin("test.one").expect("deactivated");
    assert!(
        errors.is_empty(),
        "neither of the two steps failed: {errors:?}"
    );

    let tail: Vec<Life> = life(&log).into_iter().rev().take(2).rev().collect();
    assert_eq!(
        tail,
        vec![Life::Flush, Life::Closed],
        "the contract says flush and then close: whoever reaches closing has \
         already had its persistence point"
    );

    // E la chiusura ha davvero avuto un host: ha scritto nel proprio spazio
    // dati, che è ciò che un `Drop` non avrebbe potuto fare.
    let data = ws.plugin_data_dir("test.one").expect("data space");
    assert!(
        data.join("closed").exists(),
        "`close` receives the HostApi, and what it writes there stays"
    );

    let before = life(&log).len();
    std::fs::write(bench.root.join("b.txt"), "new").unwrap();
    ws.write_document(&DocId::new("b.txt"), "new", WriteBase::Dictated)
        .expect("write");
    assert_eq!(
        life(&log).len(),
        before,
        "a closed index is no longer fed: if it were, it would hold state \
         that nobody would ever flush"
    );
}

/// Le rotte di chi se ne va **spariscono**, e quelle di chi resta restano sue.
///
/// È il caso che si sarebbe scoperto in silenzio: un bersaglio è una posizione
/// nell'elenco, e senza rimappatura la domanda del primo finirebbe al secondo.
/// nell'elenco, e senza rimappatura la domanda del primo finirebbe al secondo.
/// nell'elenco, e senza rimappatura la domanda del primo finirebbe al secondo.
#[test]
fn the_routes_of_the_one_who_leaves_do_not_pass_to_the_one_who_was_behind() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let (one, _log_one) = Spy::new("test.one:data");
    let (two, log_two) = Spy::new("test.two:data");
    ws.register_index_provider("test.one", Box::new(one))
        .expect("first");
    ws.register_index_provider("test.two", Box::new(two))
        .expect("second");

    ws.deactivate_plugin("test.one").expect("deactivated");

    let orphan = ws.query_index(custom("test.one:data"));
    assert!(
        matches!(orphan, Err(PluginError::Unserved(_))),
        "whoever served this family is gone, and the right answer is \
         \"nobody serves it\": {orphan:?}"
    );

    let answer = ws
        .query_index(custom("test.two:data"))
        .expect("the second is there");
    assert_eq!(
        answer,
        IndexResult::Custom(serde_json::json!({ "from": "test.two:data" })),
        "and it answers for itself, not for the place it inherited"
    );
    assert!(
        life(&log_two).contains(&Life::Queried),
        "the query really reached it"
    );
}

/// Disattivare toglie **tutto** ciò che un plugin aveva registrato, ritira la
/// sua dichiarazione, e libera i nomi che teneva: riaccendere passa dalla porta
/// da cui si era entrati.
#[test]
fn deactivation_removes_everything_and_frees_the_names() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let hits = Arc::new(Mutex::new(0));

    ws.register_view_provider("test.one", Box::new(Panel("test.one:panel")))
        .expect("view");
    ws.register_event_handler("test.one", Box::new(Listener(hits.clone())))
        .expect("handler");
    ws.register_syntax_rule("test.one", Box::new(Rule("test.one:rule")))
        .expect("syntax");
    ws.register_custom_renderer("test.one", Box::new(Drawer("test.one:drawing")))
        .expect("renderer");

    ws.deactivate_plugin("test.one").expect("deactivated");

    assert!(ws.views().is_empty(), "the view is no longer offered");
    assert!(
        !ws.plugins().iter().any(|p| p.id == "test.one"),
        "and the §7.6 inventory no longer lists it: \"declared with zero \
         registrations\" means something else"
    );

    // L'handler non riceve più: la prova è una scrittura, che di eventi ne
    // produce sempre.
    let before = *hits.lock().unwrap();
    std::fs::write(bench.root.join("c.txt"), "x").unwrap();
    ws.write_document(&DocId::new("c.txt"), "x", WriteBase::Dictated)
        .expect("write");
    assert_eq!(*hits.lock().unwrap(), before, "the handler is disconnected");

    // E i nomi sono liberi: chi rientra li riprende, con la stessa strada della
    // prima volta. Se le rivendicazioni di sintassi e renderer fossero rimaste
    // appese, questa riga fallirebbe con un conflitto contro un fantasma.
    declare(&mut ws, "test.one");
    ws.register_view_provider("test.one", Box::new(Panel("test.one:panel")))
        .expect("the view id was free");
    ws.register_syntax_rule("test.one", Box::new(Rule("test.one:rule")))
        .expect("the syntax claim was free");
    ws.register_custom_renderer("test.one", Box::new(Drawer("test.one:drawing")))
        .expect("the custom_kind was free");
}

/// I job che un plugin aveva in coda non partono, e **non spariscono in
/// silenzio**: ognuno riceve il proprio esito.
///
/// È la terza faccia del momento in cui un componente smette — quella che la
/// decisione 0027 aveva lasciato aperta. Il corpo di un job è
/// `Plugin::run_job`: spento il plugin, quel corpo non esiste più, e un job che
/// sparisse senza dirlo lascerebbe chi lo aspetta ad aspettare per sempre.
#[test]
fn the_queued_jobs_of_the_one_shutting_down_receive_an_outcome() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let events = ws.bus().subscribe();

    let id = ws
        .with_host("test.one", |host| {
            host.spawn_job(JobSpec {
                job: "long".into(),
                payload: serde_json::Value::Null,
            })
        })
        .expect("the job queues");

    ws.deactivate_plugin("test.one").expect("deactivated");

    assert!(
        ws.take_pending_jobs().is_empty(),
        "the queue does not keep the work of whoever is no longer there"
    );
    let outcome = events
        .try_iter()
        .find_map(|notice| match notice.event {
            Event::JobDone {
                id: finished,
                ref result,
                ..
            } if finished == id => Some(result.clone()),
            _ => None,
        })
        .expect("the job had its `JobDone`");
    assert!(
        matches!(outcome, Err(PluginError::Internal(ref msg)) if msg.to_string().contains("test.one")),
        "and the outcome says what happened, naming who shut down: {outcome:?}"
    );
}

/// E quell'esito arriva **anche agli handler**, non solo al bus.
///
/// Le due strade non sono la stessa e il banco qui sopra ne guarda una sola: il
/// bus riceve al momento dell'emissione, gli handler ricevono da un
/// **drenaggio**. Che il drenaggio ci sia, qui, non lo decide `deactivate_plugin`
/// — che drena solo se il plugin aveva degli indici — ma `complete_job`, che
/// drena per conto suo a ogni esito. È una coincidenza fra due funzioni, e
/// finché nessuno la guarda è anche una che si può disfare cambiando l'altra:
/// questo banco la guarda. Toglietelo da `complete_job` e diventa rosso.
/// questo banco la guarda. Toglietelo da `complete_job` e diventa rosso.
#[test]
fn and_the_outcome_also_reaches_the_one_listening_from_the_kernel() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let heard = Arc::new(Mutex::new(0));
    ws.register_event_handler("test.two", Box::new(Listener(heard.clone())))
        .expect("handler");
    ws.with_host("test.one", |host| {
        host.spawn_job(JobSpec {
            job: "long".into(),
            payload: serde_json::Value::Null,
        })
    })
    .expect("the job queues");
    // `test.one` non ha indici: è il caso in cui il drenaggio non partiva.
    *heard.lock().unwrap() = 0;

    ws.deactivate_plugin("test.one").expect("deactivated");

    assert!(
        *heard.lock().unwrap() > 0,
        "the `JobDone` stayed in the queue: whoever listens from the kernel \
         does not know that job will not start, and will learn only when \
         somebody else touches the vault"
    );
}

/// Un id che nessuno ha dichiarato non si disattiva: è la stessa risposta che
/// riceve chi prova a registrare qualcosa a suo nome.
#[test]
fn a_plugin_that_does_not_exist_cannot_be_deactivated() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let result = ws.deactivate_plugin("test.never-seen");
    assert!(
        matches!(result, Err(RegistryError::UnknownPlugin(id)) if id == "test.never-seen"),
        "switching off what is not on is not a no-op: it is a question about \
         something that is not there"
    );
}

// --- la chiusura del vault (§9.5) -------------------------------------------

/// Un handler che, quando il vault sta per chiudersi, scrive ciò che aveva in
/// memoria: è il caso per cui `VaultClosed` esiste.
struct Last;

impl EventHandler for Last {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if matches!(notice.event, Event::VaultClosed { .. }) {
            host.write_document(
                &DocId::new("last.txt"),
                "told to the last one",
                WriteBase::Dictated,
            )?;
        }
        Ok(())
    }
}

/// Chiudere è: **l'ultimo giro sincrono**, poi il punto di consistenza, poi chi
/// smette — e in quest'ordine, o l'ultima scrittura non sarebbe indicizzata da
/// nessuno.
#[test]
fn closing_is_the_last_round_then_flush_then_the_one_stopping() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let (spy, log) = Spy::new("test.one:data");
    ws.register_index_provider("test.one", Box::new(spy))
        .expect("index");
    ws.register_event_handler("test.two", Box::new(Last))
        .expect("handler");
    ws.reindex().expect("scan");

    let errors = ws.close();
    assert!(errors.is_empty(), "nothing went wrong: {errors:?}");

    assert!(
        ws.read_source(&DocId::new("last.txt")).is_ok(),
        "whoever receives `VaultClosed` is still registered and can still write"
    );

    let life = life(&log);
    let last_indexed = life
        .iter()
        .rposition(|v| matches!(v, Life::Indexed(id) if id == "last.txt"))
        .expect("the index saw the last write");
    let flush = life
        .iter()
        .rposition(|v| *v == Life::Flush)
        .expect("there was a flush");
    let closed = life
        .iter()
        .position(|v| *v == Life::Closed)
        .expect("the index was closed");
    assert!(
        last_indexed < flush && flush < closed,
        "the order is: the event (which causes the write), the flush, the closing — {life:?}"
    );
    assert!(
        ws.plugins().is_empty(),
        "and in the end nobody is registered"
    );
}

/// Chiudere due volte non è chiudere due volte: la seconda non fa niente e non
/// annuncia una seconda chiusura a nessuno.
#[test]
fn closing_twice_does_not_close_twice() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let events = ws.bus().subscribe();
    ws.close();
    ws.close();

    let closures = events
        .try_iter()
        .filter(|n| matches!(n.event, Event::VaultClosed { .. }))
        .count();
    assert_eq!(closures, 1, "a vault closes only once");
    assert!(ws.is_closed());
}

/// La radice non è l'identità di un workspace: una sessione ritirata e quella
/// riaperta sullo stesso vault hanno lo stesso path. I token possono quindi
/// essere scambiati per errore proprio nel caso in cui il vecchio confronto
/// della radice li avrebbe accettati. Il nonce rifiuta entrambi senza avviare
/// una finalizzazione parziale e riconsegna i token ai proprietari corretti.
#[test]
fn close_tokens_cannot_be_swapped_between_workspaces_on_the_same_root() {
    let bench = Bench::new();
    let mut first = bench.workspace();
    let mut replacement = bench.workspace();
    let first_token = first.prepare_close().expect("first close prepares");
    let replacement_token = replacement
        .prepare_close()
        .expect("replacement close prepares");

    let (first_token, first_error) = match replacement
        .finish_close_with(first_token, |_, _| Vec::new())
    {
        Ok(_) => panic!("the replacement accepted the retired workspace token"),
        Err(rejected) => rejected,
    };
    let (replacement_token, replacement_error) =
        match first.finish_close_with(replacement_token, |_, _| Vec::new()) {
            Ok(_) => panic!("the retired workspace accepted its replacement token"),
            Err(rejected) => rejected,
        };
    assert!(matches!(first_error, PluginError::Conflict(_)));
    assert!(matches!(replacement_error, PluginError::Conflict(_)));
    assert_eq!(first.plugins().len(), 2, "mismatch did not finalize first");
    assert_eq!(
        replacement.plugins().len(),
        2,
        "mismatch did not finalize replacement"
    );

    let first_errors = first
        .finish_close_with(first_token, |_, _| Vec::new())
        .expect("the token returns to the first workspace");
    let replacement_errors = replacement
        .finish_close_with(replacement_token, |_, _| Vec::new())
        .expect("the token returns to the replacement workspace");
    assert!(first_errors.is_empty(), "first closes: {first_errors:?}");
    assert!(
        replacement_errors.is_empty(),
        "replacement closes: {replacement_errors:?}"
    );
    assert!(first.plugins().is_empty());
    assert!(replacement.plugins().is_empty());
}

// --- la guardia dei job in chiusura ----------------------------------------

/// Un handler che, ricevendo l'ultimo giro, chiede un job — **due volte**, per
/// provare che i due trigger non fanno un doppio effetto. È il gesto che il
/// difetto del job in chiusura lasciava senza risposta: prima della guardia,
/// quei job entravano in coda e nessuno li drenava più.
struct CloseAndAsk(Arc<Mutex<Vec<PluginError>>>);

impl EventHandler for CloseAndAsk {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, _notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        for _ in 0..2 {
            match host.spawn_job(JobSpec {
                job: "too-late".into(),
                payload: serde_json::Value::Null,
            }) {
                Ok(id) => {
                    panic!("a job requested during closing should not start: {id:?}")
                }
                Err(result) => self.0.lock().unwrap().push(result),
            }
        }
        Ok(())
    }
}

/// Un job chiesto quando il vault sta chiudendo non entra nemmeno in coda: chi
/// lo chiede riceve il rifiuto subito, e due trigger non producono un doppio
/// effetto — né due voci in coda, né un `JobStarted` per un lavoro che nessuno
/// eseguirà.
#[test]
fn a_job_requested_during_closing_is_refused_immediately() {
    let bench = Bench::new();
    let mut ws = bench.workspace();
    let results = Arc::new(Mutex::new(Vec::new()));
    ws.register_event_handler("test.one", Box::new(CloseAndAsk(results.clone())))
        .expect("handler");
    let events = ws.bus().subscribe();

    let errors = ws.close();
    assert!(
        errors.is_empty(),
        "nothing went wrong while closing: {errors:?}"
    );

    let results = results.lock().unwrap();
    assert_eq!(results.len(), 2, "both triggers received their answer");
    for result in results.iter() {
        assert!(
            matches!(result, PluginError::Cancelled(msg) if msg.to_string().contains("si sta chiudendo")),
            "the refusal is a cancellation that says why: {result:?}"
        );
    }
    drop(results);

    assert!(
        ws.take_pending_jobs().is_empty(),
        "no job entered the queue: the guard refused before"
    );
    let started = events
        .try_iter()
        .filter(|n| matches!(n.event, Event::JobStarted { .. }))
        .count();
    assert_eq!(
        started, 0,
        "a job that does not start does not announce itself"
    );
}

/// La guardia è **della generazione del workspace**: chiudere e riaprire il
/// vault crea un workspace nuovo col proprio `closed` a posto, e la chiusura
/// vecchia non lascia chiuso lo stato corrente — la riapertura accoda di
/// nuovo, e il job aspetta il runner come sempre.
#[test]
fn the_closing_guard_does_not_survive_a_reopen() {
    let bench = Bench::new();
    let mut before = bench.workspace();
    before.close();
    drop(before);

    let mut after = bench.workspace();
    after
        .with_host("test.one", |host| {
            host.spawn_job(JobSpec {
                job: "after".into(),
                payload: serde_json::Value::Null,
            })
        })
        .expect("the reopen accepts jobs again");
    let queued = after.take_pending_jobs();
    assert_eq!(
        queued.len(),
        1,
        "the job of the new generation is in the queue, awaiting the runner"
    );
    assert_eq!(
        queued[0].spec.job, "after",
        "and it is precisely the job requested after the reopen"
    );
}
