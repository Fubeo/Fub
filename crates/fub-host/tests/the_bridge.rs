//! **Il ponte degli eventi** end-to-end (§10.2,
//! [decisione 0034](../../../docs/decisions/0034-il-freno-e-il-raggruppamento.md)):
//! il bus da un capo, un sink dall'altro, e in mezzo il freno.
//!
//! La politica — cosa si raggruppa, cosa si degrada, in che ordine — ha le sue
//! prove in `src/bridge.rs`, dove è una funzione pura e si prova senza thread.
//! Qui si prova l'unica cosa che quelle non possono: che il ponte **vero**, col
//! suo thread e la sua coda, faccia la stessa cosa.
//!
//! # Perché queste prove non dormono
//!
//! Il raggruppamento è opportunista per costruzione: raggruppa ciò che trova
//! già in coda, quindi «quanti messaggi passano» dipende da chi corre più
//! veloce. Un test che aspettasse un tempo fisso proverebbe la macchina su cui
//! gira — e sarebbe verde sul portatile e rosso in CI, o peggio il contrario.
//!
//! La raffica qui si costruisce con una **barriera**: il sink si blocca sul
//! primo evento, il test ne accoda mille sapendo che nessuno li sta ritirando,
//! e poi lo libera. Da quel momento il ponte trova mille eventi in coda **per
//! forza**, e ciò che consegna è la politica, non la fortuna.
//!
//! # E perché non si aspetta nemmeno il ponte a occhio
//!
//! Il banco deve cominciare a contare da un ponte silenzioso, e l'apertura a
//! fasi (§15.7) di eventi ne racconta parecchi. Sapere che l'apertura ha finito
//! — `wait_indexed` — non dice **quanti dei suoi eventi il ponte abbia già
//! consegnato**: il ponte è un thread a sé, e quella è l'unica domanda che
//! conta qui. Chiederlo guardando cosa è arrivato al sink e poi buttarlo è
//! guardare due volte una cosa che si muove; il banco lo ha fatto per un po', e
//! si è visto — vedi [`SinkWithBrake`] e il **sigillo**.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::JobId;
use fub_abi::{Event, Notice};
use fub_host::{Delivery, EventSink, Host, NoWatcher};

/// Il topic del **sigillo**: l'evento che chiude l'apertura e apre il conto.
///
/// È un `custom` perché di tutte le specie del contratto è quella che nessuna
/// delle due riduzioni può toccare — non ha una grana con cui raggrupparsi
/// (`bridge::grain`) e non è recuperabile, quindi né il tetto del bus né il
/// degrado lo sostituiscono con un «riconcilia». Un sigillo che il ponte può
/// legittimamente non consegnare non sigillerebbe niente.
const SEAL: &str = "test.bench:ready";

/// Un sink che si ferma al primo evento e riparte quando glielo si dice.
///
/// È la barriera a due tempi della decisione 0032, applicata al ponte: il primo
/// `emit` blocca il thread del ponte, e finché è bloccato tutto ciò che il bus
/// riceve si accumula. Nessun `sleep`, e nessuna ipotesi su chi sia più veloce.
///
/// # Perché tutto sta sotto **un** lucchetto
///
/// Il sink fa due cose per ogni evento — lo registra, e decide se fermarsi — e
/// il banco ne fa due sue: azzera il conto e arma la barriera. Quando erano due
/// lucchetti (`seen` e `via`) le due coppie si potevano intrecciare, e una
/// delle quattro trecce fermava il banco per sempre: il ponte registrava
/// l'ultimo evento dell'apertura, il banco lo vedeva, azzerava e armava, e il
/// ponte — ripreso — trovava la barriera armata e **si fermava su un evento che
/// il test aveva appena buttato**. Da lì `visti` era vuoto e il ponte fermo:
/// ogni attesa successiva contava zero, che è precisamente il rosso da cui
/// questo commento nasce. Sotto un lucchetto solo quella treccia non esiste,
/// perché registrare e decidere sono la stessa mossa.
struct SinkWithBrake {
    state: Mutex<State>,
    bell: Condvar,
}

/// Le due fasi del banco. Prima del sigillo si butta tutto e non ci si ferma
/// mai; dopo, si registra tutto e ci si ferma una volta.
#[derive(PartialEq)]
enum Phase {
    /// L'apertura sta ancora raccontandosi: ciò che arriva è suo.
    Opening,
    /// Il sigillo è passato: da qui in poi ogni evento è del test.
    Count,
}

struct State {
    phase: Phase,
    seen: Vec<Notice>,
    /// **La barriera**: il primo evento del conto la prende e si ferma finché
    /// il test non manda il via. Si arma alla costruzione e non dopo
    /// l'apertura, perché in fase [`Fase::Opening`] non la si guarda affatto:
    /// il racconto dell'apertura (§15.7) — un `JobStarted`, dei `JobProgress`,
    /// un `JobDone` — attraversa il sink senza toccarla.
    via: Option<Receiver<()>>,
    /// Le specie viste prima del sigillo: non servono a nessuna prova, servono
    /// al messaggio di un'attesa che scade. Un banco che non arriva in fondo
    /// deve poter dire **a che punto era**, o il rosso costa un giro di ipotesi.
    opening: Vec<String>,
}

impl EventSink for SinkWithBrake {
    fn emit(&self, notice: &Notice) -> Delivery {
        let mut state = self.state.lock().unwrap();
        if state.phase == Phase::Opening {
            if matches!(&notice.event, Event::Custom { topic, .. } if topic == SEAL) {
                state.phase = Phase::Count;
                self.bell.notify_all();
            } else {
                state.opening.push(format!("{:?}", notice.kind()));
            }
            return Delivery::Done;
        }
        state.seen.push(notice.clone());
        // Si prende la barriera **sotto lo stesso lucchetto** con cui si è
        // registrato, e la si aspetta fuori: fermarsi tenendo il lucchetto
        let via = state.via.take();
        drop(state);
        self.bell.notify_all();
        if let Some(via) = via {
            let _ = via.recv();
        }
        Delivery::Done
    }
}

struct Bench {
    _dir: tempfile::TempDir,
    host: Host,
    sink: Arc<SinkWithBrake>,
    open: Sender<()>,
}

impl Bench {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").expect("writes");
        let (open, via) = channel();
        let sink = Arc::new(SinkWithBrake {
            state: Mutex::new(State {
                phase: Phase::Opening,
                seen: Vec::new(),
                via: Some(via),
                opening: Vec::new(),
            }),
            bell: Condvar::new(),
        });
        let host = Host::new()
            .with_watcher(Box::new(NoWatcher))
            .with_sink(sink.clone());
        host.open(&root).expect("il vault si apre");

        // **Si parte da un ponte silenzioso, e lo si sa per certo.** L'apertura
        // a fasi (§15.7) attraversa questo stesso ponte — è il suo racconto, ed
        // è voluto — ma qui si prova il *freno*, e contare gli eventi di
        // qualcun altro insieme ai propri renderebbe ogni conto una somma di
        // due cose.
        //
        // Il confine fra i due conti non si indovina guardando cosa è arrivato:
        // si **manda**. Finita l'apertura si mette sul bus un sigillo, e il
        // sink butta tutto finché non lo vede passare. Il bus consegna a ogni
        // abbonato nell'ordine in cui riceve e il raggruppamento conserva
        // l'ordine relativo di ciò che tiene, quindi tutto ciò che l'apertura
        // ha detto **precede** il sigillo per costruzione: quando il sigillo
        // arriva, non c'è più niente di suo in volo. È l'unico modo di
        // sincronizzarsi col ponte che non contenga né un tempo né un'ipotesi
        host.wait_indexed(None).expect("opening is done");
        let bench = Bench {
            _dir: dir,
            host,
            sink,
            open,
        };
        bench.emit(Event::Custom {
            topic: SEAL.into(),
            payload: serde_json::Value::Null,
        });
        bench.wait_for_the_seal();
        bench
    }

    /// Aspetta che il sigillo abbia attraversato il ponte, e **grida** se non
    /// lo fa: la scadenza esiste per non piantare la suite, non per proseguire
    /// lo stesso. Un banco che tira dritto su un'apertura ancora in volo si
    /// porta dietro un ponte fermo su un evento buttato, e il rosso che ne
    /// segue arriva più tardi e parla di un'altra cosa.
    fn wait_for_the_seal(&self) {
        let state = self.sink.state.lock().unwrap();
        let (state, outcome) = self
            .sink
            .bell
            .wait_timeout_while(state, Duration::from_secs(5), |s| s.phase == Phase::Opening)
            .expect("stato avvelenato");
        assert!(
            !outcome.timed_out(),
            "the seal did not cross the bridge in five seconds: \
             opening delivered {:?}",
            state.opening
        );
    }

    /// Mette un evento sul bus. Il ponte è abbonato al bus, non al dispatcher:
    /// qui interessa cosa **attraversa**, non chi lo ha causato.
    fn emit(&self, event: Event) {
        self.host
            .with_session(None, |s| {
                s.workspace()
                    .read()
                    .expect("workspace")
                    .bus()
                    .emit(Notice::of(event))
            })
            .expect("vault aperto");
    }

    /// Aspetta che il sink abbia visto **almeno** `n` eventi. Non è un tempo
    /// fisso: è una condizione, con una scadenza che esiste solo per non
    /// piantare la suite se il ponte è morto.
    ///
    /// «Almeno» e non «esattamente», perché il ponte può legittimamente
    /// consegnarne di più: quanti ne consegna è la politica, e la provano gli
    /// `assert_eq!` dei test, non questa attesa.
    fn wait_for(&self, n: usize) {
        let state = self.sink.state.lock().unwrap();
        let (state, outcome) = self
            .sink
            .bell
            .wait_timeout_while(state, Duration::from_secs(5), |s| s.seen.len() < n)
            .expect("stato avvelenato");
        assert!(
            !outcome.timed_out(),
            "il ponte non ha consegnato {n} eventi: ne ha consegnati {} ({:?})",
            state.seen.len(),
            state
                .seen
                .iter()
                .map(|n| format!("{:?}", n.kind()))
                .collect::<Vec<_>>()
        );
    }

    fn seen(&self) -> Vec<Notice> {
        self.sink.state.lock().unwrap().seen.clone()
    }

    fn kind(&self) -> Vec<String> {
        self.seen()
            .iter()
            .map(|n| format!("{:?}", n.kind()))
            .collect()
    }
}

/// Mille `index-updated` sono **un** messaggio: è il caso che la voce nominava
/// col caso peggiore — «ogni evento costa un giro di shell».
#[test]
fn a_burst_crosses_the_bridge_once() {
    let bench = Bench::new();
    // 1. Il primo evento blocca il sink: da qui il ponte è fermo.
    bench.emit(Event::IndexUpdated);
    bench.wait_for(1);
    // 2. Mille arrivano mentre nessuno ritira.
    for _ in 0..1000 {
        bench.emit(Event::IndexUpdated);
    }
    // 3. Il ponte riparte e trova la coda piena, per costruzione.
    bench.open.send(()).expect("libera il sink");
    bench.wait_for(2);

    // Il ponte è vivo e potrebbe consegnarne altri: si dà tempo di sbagliare,
    // e si guarda che non lo faccia.
    let stopped = Instant::now() + Duration::from_millis(50);
    while Instant::now() < stopped {
        std::thread::yield_now();
    }
    assert_eq!(
        bench.kind(),
        vec!["IndexUpdated".to_string(), "IndexUpdated".to_string()],
        "a thousand redraw invitations are a single redraw: before this decision
         they were a thousand IPC messages and a thousand `list_documents` turns"
    );
}

/// Nella stessa raffica, ciò che nessuno può riscoprire passa **intero** — e
/// nel proprio ordine.
#[test]
fn what_is_not_rediscovered_crosses_the_bridge_anyway() {
    let bench = Bench::new();
    bench.emit(Event::IndexUpdated);
    bench.wait_for(1);

    for _ in 0..500 {
        bench.emit(Event::IndexUpdated);
    }
    bench.emit(Event::JobDone {
        id: JobId(7),
        job: "export".into(),
        result: Ok(serde_json::json!({"scritti": 3})),
    });
    bench.emit(Event::Custom {
        topic: "com.acme.tasks:done".into(),
        payload: serde_json::json!({"n": 1}),
    });
    for _ in 0..500 {
        bench.emit(Event::IndexUpdated);
    }
    bench.open.send(()).expect("libera il sink");
    bench.wait_for(4);

    assert_eq!(
        bench.kind(),
        vec![
            "IndexUpdated".to_string(),
            // I due che portano l'unica copia di un fatto, al proprio posto...
            "JobDone".to_string(),
            "Custom".to_string(),
            // ...e i mille che dicono la stessa cosa, detti una volta. Che
            // l'`index-updated` stia **dopo** non è un dettaglio: si tiene
            // l'ultima occorrenza, e l'ultima è arrivata dopo l'esito del job.
            "IndexUpdated".to_string(),
        ],
        "a job's outcome is not rediscovered by re-checking the vault: whoever waited
         for it would wait forever"
    );
}

/// Sopra il tetto della raffica il ponte smette di raccontare e dice
/// «riconcilia»: mille documenti **diversi** non si raggruppano — sono mille
/// fatti — e consegnarli uno per uno costa più della riconciliazione che li
/// sostituisce.
#[test]
fn above_the_ceiling_the_bridge_says_reconcile() {
    let bench = Bench::new();
    bench.emit(Event::IndexUpdated);
    bench.wait_for(1);
    for n in 0..1000 {
        bench.emit(Event::DocumentChanged {
            id: DocId::new(format!("nota-{n}.md")),
            changes: None,
        });
    }
    bench.open.send(()).expect("libera il sink");
    bench.wait_for(2);

    let stopped = Instant::now() + Duration::from_millis(50);
    while Instant::now() < stopped {
        std::thread::yield_now();
    }
    let seen = bench.seen();
    assert_eq!(seen.len(), 2, "{:?}", bench.kind());
    assert!(
        matches!(seen[1].event, Event::Overflow { dropped } if dropped == 1000),
        "the count must be there: a silent truncation is the defect the `overflow`
         exists to prevent. Seen: {:?}",
        seen[1].event
    );
}

/// Quando il vault è fermo — cioè quasi sempre — il ponte non raggruppa niente
/// e non ritarda niente: la finestra è la velocità di chi consuma, e con un
/// consumatore veloce è zero.
#[test]
fn a_vault_stopped_every_fact_arrives_from_only() {
    let bench = Bench::new();
    bench.emit(Event::IndexUpdated);
    bench.wait_for(1);
    bench.open.send(()).expect("libera il sink");

    for n in 0..5 {
        bench.emit(Event::DocumentChanged {
            id: DocId::new(format!("nota-{n}.md")),
            changes: None,
        });
        // Si aspetta che questo sia arrivato prima di mandare il prossimo: è
        // ciò che rende la raffica di uno, che è il caso normale.
        bench.wait_for(n + 2);
    }
    assert_eq!(
        bench.kind().len(),
        6,
        "five distinct facts are five messages: the brake must cost nothing to those
         who do not need it"
    );
}
