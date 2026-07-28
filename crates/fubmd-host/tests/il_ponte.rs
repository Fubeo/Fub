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

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::JobId;
use fubmd_abi::{Event, Notice};
use fubmd_host::{EventSink, Host, NoWatcher};

/// Un sink che si ferma al primo evento e riparte quando glielo si dice.
///
/// È la barriera a due tempi della decisione 0032, applicata al ponte: il primo
/// `emit` blocca il thread del ponte, e finché è bloccato tutto ciò che il bus
/// riceve si accumula. Nessun `sleep`, e nessuna ipotesi su chi sia più veloce.
struct SinkConFreno {
    visti: Arc<Mutex<Vec<Notice>>>,
    via: Mutex<Option<Receiver<()>>>,
}

impl EventSink for SinkConFreno {
    fn emit(&self, notice: &Notice) {
        self.visti.lock().unwrap().push(notice.clone());
        if let Some(via) = self.via.lock().unwrap().take() {
            let _ = via.recv();
        }
    }
}

struct Banco {
    _dir: tempfile::TempDir,
    host: Host,
    visti: Arc<Mutex<Vec<Notice>>>,
    apri: Sender<()>,
}

impl Banco {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").expect("scrive");
        let visti: Arc<Mutex<Vec<Notice>>> = Arc::default();
        let (apri, via) = channel();
        let host = Host::new()
            .with_watcher(Box::new(NoWatcher))
            .with_sink(Arc::new(SinkConFreno {
                visti: visti.clone(),
                via: Mutex::new(Some(via)),
            }));
        host.open(&root).expect("il vault si apre");
        Banco {
            _dir: dir,
            host,
            visti,
            apri,
        }
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
    fn attendi(&self, n: usize) {
        let scadenza = Instant::now() + Duration::from_secs(5);
        while self.visti.lock().unwrap().len() < n && Instant::now() < scadenza {
            std::thread::yield_now();
        }
        assert!(
            self.visti.lock().unwrap().len() >= n,
            "il ponte non ha consegnato {n} eventi: ne ha consegnati {}",
            self.visti.lock().unwrap().len()
        );
    }

    fn specie(&self) -> Vec<String> {
        self.visti
            .lock()
            .unwrap()
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
        });
    }
    banco.apri.send(()).expect("libera il sink");
    banco.attendi(2);

    let fermo = Instant::now() + Duration::from_millis(50);
    while Instant::now() < fermo {
        std::thread::yield_now();
    }
    let visti = banco.visti.lock().unwrap().clone();
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
