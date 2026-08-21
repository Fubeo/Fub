//! **Ciò che va storto arriva a qualcuno** (seduta 20:
//! [0051](../../../docs/decisions/0051-l-alimentazione-risponde.md) +
//! [0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)).
//!
//! La proprietà sotto esame è quella che il piano dichiarava di avere e aveva a
//! metà: *perdite silenziose non esistono per contratto*. Qui si guarda dai due
//! versi in cui era falsa —
//!
//! 1. un indice che **non prende** un documento adesso lo nomina, e il kernel
//!    trasforma quel nome in un `Event::Trouble`;
//! 2. un handler che **fallisce** non viene più ignorato con un `let _ =`.
//!
//! Ogni test qui fallisce nel modo che conta: non «la firma è diversa», ma
//! «nessuno lo ha saputo».

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::event::{Event, EventKind, EventMask, Notice, Severity};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute,
};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::SampleExtractor;

/// Un indice che rifiuta ciò che gli si dà, e **lo dice**: è il
/// `SearchIndex` col writer andato, ridotto all'osso.
struct RejectingIndex;

impl IndexProvider for RejectingIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        docs.iter()
            .map(|d| {
                IndexLoss::new(
                    d.id.clone(),
                    PluginError::Internal("the writer is gone".into()),
                )
            })
            .collect()
    }
    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("nothing".into()))
    }
}

/// L'handler che fallisce: è la forma del versioning quando il disco è pieno —
/// `handle` propaga l'errore di `snapshot`, e prima di questa seduta il kernel
/// lo scartava con un `let _ =`.
struct FailingHandler;

impl EventHandler for FailingHandler {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }
    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        // **Non** sui guasti: un handler che fallisce ricevendo un `Trouble` è
        // esattamente il ciclo che la 0052 chiude nel kernel, e senza questa
        // riga il test lo eserciterebbe invece di provare ciò che vuole
        // provare.
        if matches!(notice.event, Event::DocumentChanged { .. }) {
            return Err(PluginError::Io("disk full".into()));
        }
        Ok(())
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

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleExtractor::by_extension("txt").boxed())
            .expect("plain");
        let mut ws = Workspace::new(&self.root, registry).expect("the vault opens");
        for plugin in ["test.rejects", "test.fails"] {
            ws.register_core_feature(plugin, plugin)
                .expect("declared");
        }
        ws
    }
}

/// Tutti i guasti arrivati sul bus, in ordine.
fn troubles(rx: &fub_kernel::Subscription) -> Vec<(Severity, Option<String>, String)> {
    let mut out = Vec::new();
    while let Ok(n) = rx.try_recv() {
        out.push(n);
    }
    out.into_iter()
        .filter_map(|n| match n.event {
            Event::Trouble {
                severity,
                subject,
                error,
                ..
            } => Some((severity, subject.map(|s| s.to_string()), error.to_string())),
            _ => None,
        })
        .collect()
}

#[test]
fn a_document_the_index_does_not_take_reaches_the_watcher() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_index_provider("test.rejects", Box::new(RejectingIndex))
        .expect("registered");
    ws.reindex().unwrap();
    let rx = ws.bus().subscribe();

    ws.create_notes(Some("Note.txt")).unwrap();
    ws.write_document(&DocId::new("Note.txt"), "body", WriteBase::Dictated)
        .unwrap();

    let seen = troubles(&rx);
    assert!(
        !seen.is_empty(),
        "the index said it lost the document and nobody learned: it is exactly \
         the defect session 20 closes"
    );
    let (severity, subject, message) = &seen[0];
    assert_eq!(
        subject.as_deref(),
        Some("Note.txt"),
        "a trouble that does not name the document makes nobody act: it is the \
         reason the cumulative flush result was discarded"
    );
    assert_eq!(
        *severity,
        Severity::Warning,
        "an index is a derivative: it is rebuilt by reopening the vault"
    );
    assert!(message.contains("the writer is gone"), "{message}");
}

#[test]
fn the_write_succeeds_even_when_the_index_refuses() {
    // L'altra metà, e conta quanto la prima: il vault è la verità, un indice è
    // un derivato. Dire la perdita non deve trasformarla in un fallimento
    // dell'operazione che l'utente ha chiesto.
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_index_provider("test.rejects", Box::new(RejectingIndex))
        .expect("registered");
    ws.reindex().unwrap();

    ws.create_notes(Some("Note.txt")).unwrap();
    ws.write_document(&DocId::new("Note.txt"), "body", WriteBase::Dictated)
        .expect("the write succeeds");
    assert_eq!(ws.read_source(&DocId::new("Note.txt")).unwrap(), "body");
}

#[test]
fn a_handler_error_is_not_lost_anymore() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_event_handler("test.fails", Box::new(FailingHandler))
        .expect("registered");
    ws.reindex().unwrap();
    let rx = ws.bus().subscribe();

    ws.create_notes(Some("Note.txt")).unwrap();
    ws.write_document(&DocId::new("Note.txt"), "body", WriteBase::Dictated)
        .unwrap();

    let seen = troubles(&rx);
    assert!(
        !seen.is_empty(),
        "`let _ = handler.handle(…)`: the versioning that stopped taking snapshots \
         was indistinguishable from the versioning that worked"
    );
    let (severity, _, message) = &seen[0];
    assert_eq!(
        *severity,
        Severity::Failure,
        "the kernel does not know what DID NOT happen behind a handler: \
         underestimating is worse than overestimating"
    );
    assert!(message.contains("disk full"), "{message}");
}

#[test]
fn a_failing_handler_does_not_make_the_write_fail() {
    // La metà del vecchio commento che era giusta, e che resta: «l'errore di un
    // handler non deve far fallire l'operazione che ha emesso l'evento».
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_event_handler("test.fails", Box::new(FailingHandler))
        .expect("registered");
    ws.reindex().unwrap();

    ws.create_notes(Some("Note.txt")).unwrap();
    ws.write_document(&DocId::new("Note.txt"), "body", WriteBase::Dictated)
        .expect("the write succeeds even though a handler said no");
}

// ---------------------------------------------------------------------------
// Il troncamento a budget esaurito (§20.5): un guasto non è sacrificabile
// ---------------------------------------------------------------------------

/// Riempie la coda oltre il budget e ci mette **in fondo** un guasto: è la
/// forma di ogni cascata reale — tanti eventi che si riscoprono guardando il
/// vault, e dentro un fatto che non si riscopre.
struct Cascade {
    count: usize,
    already: bool,
}

impl EventHandler for Cascade {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::DocumentChanged])
    }
    fn handle(&mut self, _notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if std::mem::replace(&mut self.already, true) {
            return Ok(());
        }
        for _ in 0..self.count {
            host.emit(Event::IndexUpdated);
        }
        host.emit(Event::Trouble {
            severity: Severity::Failure,
            subject: None,
            error: PluginError::Io("the flush did not go through".into()),
            gate: None,
        });
        Ok(())
    }
}

/// Due handler che si rimbalzano un custom per sempre. Un custom **non** è
/// recuperabile — il suo payload non lo ricostruisce nessuno — quindi qui il
/// troncamento non ha niente da buttare fra ciò che è in coda, e ciò che si
/// perde si perde nel **tratto finale**.
struct PingPong;

impl EventHandler for PingPong {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::DocumentChanged, EventKind::Custom])
    }
    fn handle(&mut self, _notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        host.emit(Event::Custom {
            topic: "fub:pong".into(),
            payload: serde_json::Value::Null,
        });
        Ok(())
    }
}

/// Tutto ciò che è arrivato a un `EventHandler`, in ordine: è l'unico punto di
/// vista da cui il difetto del §20.5 si vede, perché sul bus quegli eventi ci
/// sono passati comunque.
#[derive(Default, Clone)]
struct Recorder(std::sync::Arc<std::sync::Mutex<Vec<String>>>);

impl EventHandler for Recorder {
    fn subscribed(&self) -> EventMask {
        // **Non** `EventMask::all()`, e la scoperta vale la riga: `all()` non
        // contiene `Trouble`, di proposito e per una ragione che è di un'altra
        // voce (§20.2). Chi vuole i guasti li nomina.
        EventMask::of([
            EventKind::DocumentChanged,
            EventKind::IndexUpdated,
            EventKind::Custom,
            EventKind::Overflow,
            EventKind::Trouble,
        ])
    }
    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let line = match &notice.event {
            Event::Overflow { dropped } => format!("overflow:{dropped}"),
            Event::Trouble { error, .. } => format!("trouble:{error}"),
            other => format!("{:?}", other.kind()),
        };
        self.0.lock().unwrap().push(line);
        Ok(())
    }
}

fn with_two_handlers(fx: &Fixture, cascade: Box<dyn EventHandler>) -> (Workspace, Recorder) {
    let mut ws = fx.workspace();
    let recorder = Recorder::default();
    ws.register_core_feature("test.cascade", "test.cascade")
        .expect("declared");
    ws.register_core_feature("test.record", "test.record")
        .expect("declared");
    ws.register_event_handler("test.cascade", cascade)
        .expect("registered");
    ws.register_event_handler("test.record", Box::new(recorder.clone()))
        .expect("registered");
    (ws, recorder)
}

/// **Il budget è un tetto sul lavoro, non sui fatti.** Quando la coda si tronca,
/// ciò che si riscopre riguardando il vault diventa un `Overflow`; il guasto,
/// che porta l'unica copia di un fatto, arriva lo stesso — e arriva **dopo**
/// l'invito a riconciliare, che è l'ordine in cui le due cose sono successe.
/// l'invito a riconciliare, che è l'ordine in cui le due cose sono successe.
#[test]
fn truncation_does_not_throw_away_a_trouble() {
    let fx = Fixture::new();
    let (mut ws, recorder) = with_two_handlers(
        &fx,
        Box::new(Cascade {
            count: 2_000,
            already: false,
        }),
    );
    ws.reindex().unwrap();
    ws.create_notes(Some("Note.txt")).unwrap();
    ws.write_document(&DocId::new("Note.txt"), "body", WriteBase::Dictated)
        .unwrap();

    let seen = recorder.0.lock().unwrap().clone();
    let overflow = seen
        .iter()
        .position(|r| r.starts_with("overflow:"))
        .expect("with two thousand events in the queue the budget must truncate");
    let trouble = seen.iter().position(|r| r.starts_with("trouble:")).expect(
        "the trouble was in the queue behind the truncation, and emptying the \
         queue in bulk would have lost it: no reconciliation brings it back",
    );
    assert!(
        overflow < trouble,
        "the invitation to reconcile stands where the last event that replaces \
         was, i.e. before the trouble: {seen:?}"
    );
    assert!(
        seen[trouble].contains("the flush did not go through"),
        "{:?}",
        seen[trouble]
    );
}

/// L'altra metà, ed è il difetto che stava **fuori** dalla voce: ciò che gli
/// handler emettono mentre ricevono il tratto finale non si può consegnare (la
/// coda deve terminare), ma si può **dire**. Prima si buttava in silenzio, e
/// con un ping-pong di custom — che non sono recuperabili — il troncamento
/// finiva per non dire proprio niente.
#[test]
fn the_final_stretch_says_how_many_it_threw_away() {
    let fx = Fixture::new();
    let (mut ws, recorder) = with_two_handlers(&fx, Box::new(PingPong));
    ws.reindex().unwrap();
    ws.create_notes(Some("Note.txt")).unwrap();
    ws.write_document(&DocId::new("Note.txt"), "body", WriteBase::Dictated)
        .unwrap();

    let seen = recorder.0.lock().unwrap().clone();
    let last = seen.last().expect("something arrived");
    assert!(
        last.starts_with("overflow:"),
        "the last thing a handler receives from a truncated drain is the count \
         of what did not reach it: {last}"
    );
    assert_eq!(
        last, "overflow:1",
        "a count of zero would mean nothing was lost, but the ping-pong was \
         still emitting"
    );
}
