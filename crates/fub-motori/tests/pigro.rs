//! Il motore pigro: una costruzione sola, errori e panici che non lasciano lo
//! stato a metà, `libera` che non distrugge sotto i piedi di nessuno.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use fub_motori::{Config, ErroreMotore, Pigro, Servizi, Tetto};

fn servizi() -> Arc<Servizi> {
    Servizi::nuovi(Config {
        fili: Some(2),
        tetto: Tetto::fisso(0),
    })
}

/// Aspetta che `condizione` diventi vera, al più cinque secondi.
fn finche(condizione: impl Fn() -> bool) {
    let fine = Instant::now() + Duration::from_secs(5);
    while !condizione() {
        assert!(Instant::now() < fine, "la condizione non è arrivata");
        thread::sleep(Duration::from_millis(5));
    }
}

#[derive(Debug)]
struct Motore(usize);

static DIECI_CREATI: AtomicUsize = AtomicUsize::new(0);

fn crea_lento(_: &Arc<Servizi>) -> Result<Motore, ErroreMotore> {
    let n = DIECI_CREATI.fetch_add(1, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(100));
    Ok(Motore(n))
}

#[test]
fn dieci_thread_insieme_una_costruzione_sola() {
    let pigro = Arc::new(Pigro::nuovo(crea_lento));
    let servizi = servizi();
    let via = Arc::new(Barrier::new(10));
    let mani: Vec<_> = (0..10)
        .map(|_| {
            let (pigro, servizi, via) = (pigro.clone(), servizi.clone(), via.clone());
            thread::spawn(move || {
                via.wait();
                pigro.prendi(&servizi).expect("il motore")
            })
        })
        .collect();
    let motori: Vec<Arc<Motore>> = mani.into_iter().map(|m| m.join().unwrap()).collect();
    assert_eq!(DIECI_CREATI.load(Ordering::SeqCst), 1);
    assert!(motori.iter().all(|m| Arc::ptr_eq(m, &motori[0])));
    assert_eq!(motori[0].0, 0);
    assert!(pigro.acceso());
}

static RIPROVE: AtomicUsize = AtomicUsize::new(0);

fn crea_la_seconda_volta(_: &Arc<Servizi>) -> Result<Motore, ErroreMotore> {
    match RIPROVE.fetch_add(1, Ordering::SeqCst) {
        0 => Err(ErroreMotore::creazione("il disco non risponde")),
        n => Ok(Motore(n)),
    }
}

#[test]
fn una_creazione_fallita_torna_vuoto_e_si_riprova() {
    let pigro = Pigro::nuovo(crea_la_seconda_volta);
    let servizi = servizi();
    let errore = pigro.prendi(&servizi).unwrap_err();
    assert_eq!(errore, ErroreMotore::creazione("il disco non risponde"));
    assert!(!pigro.acceso());
    let motore = pigro.prendi(&servizi).expect("la seconda volta riesce");
    assert_eq!(motore.0, 1);
    assert!(pigro.acceso());
    assert_eq!(RIPROVE.load(Ordering::SeqCst), 2);
}

static ATTESE_CHIAMATE: AtomicUsize = AtomicUsize::new(0);
static ATTESE_VIA: AtomicBool = AtomicBool::new(false);

fn crea_e_fallisci_dopo(_: &Arc<Servizi>) -> Result<Motore, ErroreMotore> {
    ATTESE_CHIAMATE.fetch_add(1, Ordering::SeqCst);
    while !ATTESE_VIA.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(2));
    }
    Err(ErroreMotore::creazione("niente"))
}

#[test]
fn chi_aspettava_riceve_lo_stesso_errore() {
    let pigro = Arc::new(Pigro::nuovo(crea_e_fallisci_dopo));
    let servizi = servizi();
    let mani: Vec<_> = (0..6)
        .map(|_| {
            let (pigro, servizi) = (pigro.clone(), servizi.clone());
            thread::spawn(move || pigro.prendi(&servizi))
        })
        .collect();
    finche(|| ATTESE_CHIAMATE.load(Ordering::SeqCst) == 1);
    // Il tempo agli altri cinque di mettersi in attesa.
    thread::sleep(Duration::from_millis(200));
    ATTESE_VIA.store(true, Ordering::SeqCst);
    for mano in mani {
        assert_eq!(
            mano.join().unwrap().unwrap_err(),
            ErroreMotore::creazione("niente")
        );
    }
    assert_eq!(ATTESE_CHIAMATE.load(Ordering::SeqCst), 1);
}

static PANICI: AtomicUsize = AtomicUsize::new(0);

fn crea_in_panico(_: &Arc<Servizi>) -> Result<Motore, ErroreMotore> {
    if PANICI.fetch_add(1, Ordering::SeqCst) == 0 {
        panic!("il motore si è rotto");
    }
    Ok(Motore(7))
}

#[test]
fn un_panico_in_crea_non_lascia_lo_stato_in_costruzione() {
    let pigro = Pigro::nuovo(crea_in_panico);
    let servizi = servizi();
    match pigro.prendi(&servizi) {
        Err(ErroreMotore::CreazioneFallita { motivo }) => {
            assert!(motivo.contains("il motore si è rotto"), "{motivo}");
        }
        altro => panic!("atteso un errore di creazione, arrivato {altro:?}"),
    }
    assert!(!pigro.acceso());
    // Lo stato è tornato Vuoto: la richiesta dopo costruisce, non aspetta per
    // sempre.
    assert_eq!(pigro.prendi(&servizi).unwrap().0, 7);
}

static CADUTI: AtomicUsize = AtomicUsize::new(0);
static TENUTO: Pigro<Tenuto> = Pigro::nuovo(crea_tenuto);

struct Tenuto;

impl Drop for Tenuto {
    fn drop(&mut self) {
        // Il motore cade a lucchetto lasciato: chiedere al suo `Pigro` qui
        // dentro non si blocca.
        assert!(!TENUTO.acceso());
        CADUTI.fetch_add(1, Ordering::SeqCst);
    }
}

fn crea_tenuto(_: &Arc<Servizi>) -> Result<Tenuto, ErroreMotore> {
    Ok(Tenuto)
}

#[test]
fn libera_lascia_vivo_il_motore_finche_qualcuno_lo_tiene() {
    let servizi = servizi();
    let tenuto = TENUTO.prendi(&servizi).unwrap();
    assert!(TENUTO.libera());
    assert!(!TENUTO.acceso());
    assert!(!TENUTO.libera(), "non c'è più niente da liberare");
    assert_eq!(
        CADUTI.load(Ordering::SeqCst),
        0,
        "chi lo tiene lo usa ancora"
    );
    drop(tenuto);
    assert_eq!(CADUTI.load(Ordering::SeqCst), 1);

    // Senza nessun altro `Arc`, `libera` lo fa cadere subito, fuori lucchetto.
    drop(TENUTO.prendi(&servizi).unwrap());
    assert!(TENUTO.libera());
    assert_eq!(CADUTI.load(Ordering::SeqCst), 2);
}

static LENTO_VIA: AtomicBool = AtomicBool::new(false);
static LENTO_PARTITO: AtomicBool = AtomicBool::new(false);

fn crea_quando_via(_: &Arc<Servizi>) -> Result<Motore, ErroreMotore> {
    LENTO_PARTITO.store(true, Ordering::SeqCst);
    while !LENTO_VIA.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(2));
    }
    Ok(Motore(3))
}

#[test]
fn libera_durante_la_costruzione_non_la_interrompe() {
    let pigro = Arc::new(Pigro::nuovo(crea_quando_via));
    let servizi = servizi();
    let mano = {
        let (pigro, servizi) = (pigro.clone(), servizi.clone());
        thread::spawn(move || pigro.prendi(&servizi))
    };
    finche(|| LENTO_PARTITO.load(Ordering::SeqCst));
    assert!(!pigro.libera());
    assert!(!pigro.acceso());
    assert!(pigro.se_acceso().is_none());
    LENTO_VIA.store(true, Ordering::SeqCst);
    assert_eq!(mano.join().unwrap().unwrap().0, 3);
    assert!(pigro.acceso());
    assert_eq!(pigro.se_acceso().unwrap().0, 3);
}

static SCALDATI: AtomicUsize = AtomicUsize::new(0);

fn crea_scaldato(_: &Arc<Servizi>) -> Result<Motore, ErroreMotore> {
    let nome = thread::current().name().unwrap_or_default().to_owned();
    assert!(nome.starts_with("fub-motore-"), "costruito su «{nome}»");
    Ok(Motore(SCALDATI.fetch_add(1, Ordering::SeqCst)))
}

#[test]
fn scalda_costruisce_in_sottofondo_sul_gruppo_dei_motori() {
    let pigro = Arc::new(Pigro::nuovo(crea_scaldato));
    let servizi = servizi();
    assert!(
        !servizi.lavori().avviato(),
        "niente thread prima del primo lavoro"
    );
    pigro.scalda(servizi.clone());
    finche(|| pigro.acceso());
    assert!(servizi.lavori().avviato());
    pigro.scalda(servizi.clone());
    assert_eq!(pigro.prendi(&servizi).unwrap().0, 0);
    assert_eq!(
        SCALDATI.load(Ordering::SeqCst),
        1,
        "acceso, scalda non rifà"
    );
}
