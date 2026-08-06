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
//! si è visto — vedi [`SinkConFreno`] e il **sigillo**.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::JobId;
use fub_abi::{Event, Notice};
use fub_host::{Consegna, EventSink, Host, NoWatcher};

/// Il topic del **sigillo**: l'evento che chiude l'apertura e apre il conto.
///
/// È un `custom` perché di tutte le specie del contratto è quella che nessuna
/// delle due riduzioni può toccare — non ha una grana con cui raggrupparsi
/// (`bridge::grain`) e non è recuperabile, quindi né il tetto del bus né il
/// degrado lo sostituiscono con un «riconcilia». Un sigillo che il ponte può
/// legittimamente non consegnare non sigillerebbe niente.
const SIGILLO: &str = "test.banco:pronto";

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
/// lucchetti (`visti` e `via`) le due coppie si potevano intrecciare, e una
/// delle quattro trecce fermava il banco per sempre: il ponte registrava
/// l'ultimo evento dell'apertura, il banco lo vedeva, azzerava e armava, e il
/// ponte — ripreso — trovava la barriera armata e **si fermava su un evento che
/// il test aveva appena buttato**. Da lì `visti` era vuoto e il ponte fermo:
/// ogni attesa successiva contava zero, che è precisamente il rosso da cui
/// questo commento nasce. Sotto un lucchetto solo quella treccia non esiste,
/// perché registrare e decidere sono la stessa mossa.
struct SinkConFreno {
    stato: Mutex<Stato>,
    campana: Condvar,
}

/// Le due fasi del banco. Prima del sigillo si butta tutto e non ci si ferma
/// mai; dopo, si registra tutto e ci si ferma una volta.
#[derive(PartialEq)]
enum Fase {
    /// L'apertura sta ancora raccontandosi: ciò che arriva è suo.
    Apertura,
    /// Il sigillo è passato: da qui in poi ogni evento è del test.
    Conto,
}

struct Stato {
    fase: Fase,
    visti: Vec<Notice>,
    /// **La barriera**: il primo evento del conto la prende e si ferma finché
    /// il test non manda il via. Si arma alla costruzione e non dopo
    /// l'apertura, perché in fase [`Fase::Apertura`] non la si guarda affatto:
    /// il racconto dell'apertura (§15.7) — un `JobStarted`, dei `JobProgress`,
    /// un `JobDone` — attraversa il sink senza toccarla.
    via: Option<Receiver<()>>,
    /// Le specie viste prima del sigillo: non servono a nessuna prova, servono
    /// al messaggio di un'attesa che scade. Un banco che non arriva in fondo
    /// deve poter dire **a che punto era**, o il rosso costa un giro di ipotesi.
    apertura: Vec<String>,
}

impl EventSink for SinkConFreno {
    fn emit(&self, notice: &Notice) -> Consegna {
        let mut stato = self.stato.lock().unwrap();
        if stato.fase == Fase::Apertura {
            if matches!(&notice.event, Event::Custom { topic, .. } if topic == SIGILLO) {
                stato.fase = Fase::Conto;
                self.campana.notify_all();
            } else {
                stato.apertura.push(format!("{:?}", notice.kind()));
            }
            return Consegna::Fatta;
        }
        stato.visti.push(notice.clone());
        // Si prende la barriera **sotto lo stesso lucchetto** con cui si è
        // registrato, e la si aspetta fuori: fermarsi tenendo il lucchetto
        // fermerebbe anche chi guarda.
        let via = stato.via.take();
        drop(stato);
        self.campana.notify_all();
        if let Some(via) = via {
            let _ = via.recv();
        }
        Consegna::Fatta
    }
}

struct Banco {
    _dir: tempfile::TempDir,
    host: Host,
    sink: Arc<SinkConFreno>,
    apri: Sender<()>,
}

impl Banco {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").expect("scrive");
        let (apri, via) = channel();
        let sink = Arc::new(SinkConFreno {
            stato: Mutex::new(Stato {
                fase: Fase::Apertura,
                visti: Vec::new(),
                via: Some(via),
                apertura: Vec::new(),
            }),
            campana: Condvar::new(),
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
        // su chi corre più veloce.
        host.wait_indexed(None).expect("l'apertura ha finito");
        let banco = Banco {
            _dir: dir,
            host,
            sink,
            apri,
        };
        banco.emetti(Event::Custom {
            topic: SIGILLO.into(),
            payload: serde_json::Value::Null,
        });
        banco.attende_il_sigillo();
        banco
    }

    /// Aspetta che il sigillo abbia attraversato il ponte, e **grida** se non
    /// lo fa: la scadenza esiste per non piantare la suite, non per proseguire
    /// lo stesso. Un banco che tira dritto su un'apertura ancora in volo si
    /// porta dietro un ponte fermo su un evento buttato, e il rosso che ne
    /// segue arriva più tardi e parla di un'altra cosa.
    fn attende_il_sigillo(&self) {
        let stato = self.sink.stato.lock().unwrap();
        let (stato, esito) = self
            .sink
            .campana
            .wait_timeout_while(stato, Duration::from_secs(5), |s| s.fase == Fase::Apertura)
            .expect("stato avvelenato");
        assert!(
            !esito.timed_out(),
            "il sigillo non ha attraversato il ponte in cinque secondi: \
             dell'apertura sono arrivati {:?}",
            stato.apertura
        );
    }

    /// Mette un evento sul bus. Il ponte è abbonato al bus, non al dispatcher:
    /// qui interessa cosa **attraversa**, non chi lo ha causato.
    fn emetti(&self, event: Event) {
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
    fn attendi(&self, n: usize) {
        let stato = self.sink.stato.lock().unwrap();
        let (stato, esito) = self
            .sink
            .campana
            .wait_timeout_while(stato, Duration::from_secs(5), |s| s.visti.len() < n)
            .expect("stato avvelenato");
        assert!(
            !esito.timed_out(),
            "il ponte non ha consegnato {n} eventi: ne ha consegnati {} ({:?})",
            stato.visti.len(),
            stato
                .visti
                .iter()
                .map(|n| format!("{:?}", n.kind()))
                .collect::<Vec<_>>()
        );
    }

    fn visti(&self) -> Vec<Notice> {
        self.sink.stato.lock().unwrap().visti.clone()
    }

    fn specie(&self) -> Vec<String> {
        self.visti()
            .iter()
            .map(|n| format!("{:?}", n.kind()))
            .collect()
    }
}

/// Mille `index-updated` sono **un** messaggio: è il caso che la voce nominava
/// col caso peggiore — «ogni evento costa un giro di shell».
#[test]
fn una_raffica_attraversa_il_ponte_una_volta_sola() {
    let banco = Banco::nuovo();
    // 1. Il primo evento blocca il sink: da qui il ponte è fermo.
    banco.emetti(Event::IndexUpdated);
    banco.attendi(1);
    // 2. Mille arrivano mentre nessuno ritira.
    for _ in 0..1000 {
        banco.emetti(Event::IndexUpdated);
    }
    // 3. Il ponte riparte e trova la coda piena, per costruzione.
    banco.apri.send(()).expect("libera il sink");
    banco.attendi(2);

    // Il ponte è vivo e potrebbe consegnarne altri: si dà tempo di sbagliare,
    // e si guarda che non lo faccia.
    let fermo = Instant::now() + Duration::from_millis(50);
    while Instant::now() < fermo {
        std::thread::yield_now();
    }
    assert_eq!(
        banco.specie(),
        vec!["IndexUpdated".to_string(), "IndexUpdated".to_string()],
        "mille inviti a ridisegnare sono un ridisegno: prima di questa \
         decisione erano mille messaggi IPC e mille giri di `list_documents`"
    );
}

/// Nella stessa raffica, ciò che nessuno può riscoprire passa **intero** — e
/// nel proprio ordine.
#[test]
fn cio_che_non_si_riscopre_attraversa_il_ponte_comunque() {
    let banco = Banco::nuovo();
    banco.emetti(Event::IndexUpdated);
    banco.attendi(1);

    for _ in 0..500 {
        banco.emetti(Event::IndexUpdated);
    }
    banco.emetti(Event::JobDone {
        id: JobId(7),
        job: "export".into(),
        result: Ok(serde_json::json!({"scritti": 3})),
    });
    banco.emetti(Event::Custom {
        topic: "com.acme.tasks:done".into(),
        payload: serde_json::json!({"n": 1}),
    });
    for _ in 0..500 {
        banco.emetti(Event::IndexUpdated);
    }
    banco.apri.send(()).expect("libera il sink");
    banco.attendi(4);

    assert_eq!(
        banco.specie(),
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
        "l'esito di un job non si riscopre riguardando il vault: chi lo aspettava \
         aspetterebbe per sempre"
    );
}

/// Sopra il tetto della raffica il ponte smette di raccontare e dice
/// «riconcilia»: mille documenti **diversi** non si raggruppano — sono mille
/// fatti — e consegnarli uno per uno costa più della riconciliazione che li
/// sostituisce.
#[test]
fn sopra_il_tetto_il_ponte_dice_riconcilia() {
    let banco = Banco::nuovo();
    banco.emetti(Event::IndexUpdated);
    banco.attendi(1);
    for n in 0..1000 {
        banco.emetti(Event::DocumentChanged {
            id: DocId::new(format!("nota-{n}.md")),
            changes: None,
        });
    }
    banco.apri.send(()).expect("libera il sink");
    banco.attendi(2);

    let fermo = Instant::now() + Duration::from_millis(50);
    while Instant::now() < fermo {
        std::thread::yield_now();
    }
    let visti = banco.visti();
    assert_eq!(visti.len(), 2, "{:?}", banco.specie());
    assert!(
        matches!(visti[1].event, Event::Overflow { dropped } if dropped == 1000),
        "il conto dev'esserci: un troncamento silenzioso è il difetto che \
         l'`overflow` esiste per non avere. Visto: {:?}",
        visti[1].event
    );
}

/// Quando il vault è fermo — cioè quasi sempre — il ponte non raggruppa niente
/// e non ritarda niente: la finestra è la velocità di chi consuma, e con un
/// consumatore veloce è zero.
#[test]
fn a_vault_fermo_ogni_fatto_arriva_da_solo() {
    let banco = Banco::nuovo();
    banco.emetti(Event::IndexUpdated);
    banco.attendi(1);
    banco.apri.send(()).expect("libera il sink");

    for n in 0..5 {
        banco.emetti(Event::DocumentChanged {
            id: DocId::new(format!("nota-{n}.md")),
            changes: None,
        });
        // Si aspetta che questo sia arrivato prima di mandare il prossimo: è
        // ciò che rende la raffica di uno, che è il caso normale.
        banco.attendi(n + 2);
    }
    assert_eq!(
        banco.specie().len(),
        6,
        "cinque fatti distinti sono cinque messaggi: il freno non deve costare \
         niente a chi non ne ha bisogno"
    );
}
