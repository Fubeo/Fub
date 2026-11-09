//! Il registro dei motori, i servizi del processo e il gruppo di thread.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use fub_motori::{Config, ErroreMotore, Motori, Servizi, StatoVoce, Tetto, Voce};

fn servizi(fili: usize) -> Arc<Servizi> {
    Servizi::nuovi(Config {
        fili: Some(fili),
        tetto: Tetto::fisso(0),
    })
}

#[derive(Default)]
struct Finta {
    acceso: AtomicBool,
    byte: AtomicU64,
}

impl Voce for Finta {
    fn acceso(&self) -> bool {
        self.acceso.load(Ordering::SeqCst)
    }
    fn scalda(&self, _servizi: &Arc<Servizi>) {
        self.acceso.store(true, Ordering::SeqCst);
        self.byte.store(64, Ordering::SeqCst);
    }
    fn svuota(&self) -> u64 {
        self.byte.swap(0, Ordering::SeqCst)
    }
    fn libera(&self) -> bool {
        self.byte.store(0, Ordering::SeqCst);
        self.acceso.swap(false, Ordering::SeqCst)
    }
    fn byte(&self) -> u64 {
        self.byte.load(Ordering::SeqCst)
    }
}

#[test]
fn un_motore_si_iscrive_e_si_scalda_dalla_sua_estensione() {
    let motori = Motori::nuovi(servizi(1));
    let fogli = Arc::new(Finta::default());
    let documenti = Arc::new(Finta::default());
    motori
        .registra("fogli", &["xlsx", ".xlsm"], fogli.clone())
        .unwrap();
    motori
        .registra("documenti", &["docx"], documenti.clone())
        .unwrap();
    assert!(!fogli.acceso(), "iscriversi non costruisce");

    assert!(motori.scalda_per(".XLSM").unwrap());
    assert!(fogli.acceso());
    assert!(!documenti.acceso());
    assert!(
        !motori.scalda_per("pdf").unwrap(),
        "un'estensione di nessuno"
    );

    assert_eq!(
        motori.elenco().unwrap(),
        [
            StatoVoce {
                spazio: "documenti".into(),
                acceso: false,
                byte: 0
            },
            StatoVoce {
                spazio: "fogli".into(),
                acceso: true,
                byte: 64
            },
        ]
    );
    assert_eq!(motori.voce("fogli").unwrap().svuota(), 64);
    assert!(motori.voce("fogli").unwrap().libera());
    assert!(!fogli.acceso());
}

#[test]
fn uno_spazio_e_un_estensione_si_iscrivono_una_volta_sola() {
    let motori = Motori::nuovi(servizi(1));
    motori
        .registra("fogli", &["xlsx"], Arc::new(Finta::default()))
        .unwrap();
    assert_eq!(
        motori.registra("fogli", &["ods"], Arc::new(Finta::default())),
        Err(ErroreMotore::SpazioGiaIscritto("fogli".into()))
    );
    assert_eq!(
        motori.registra("altro", &["ods", "XLSX"], Arc::new(Finta::default())),
        Err(ErroreMotore::EstensioneContesa {
            estensione: "xlsx".into(),
            spazio: "fogli".into()
        })
    );
    // Un'iscrizione rifiutata non lascia niente: «ods» resta libera.
    assert!(!motori.scalda_per("ods").unwrap());
    assert!(matches!(
        motori.voce("altro"),
        Err(ErroreMotore::MotoreSconosciuto(spazio)) if spazio == "altro"
    ));
    assert_eq!(motori.elenco().unwrap().len(), 1);
}

#[test]
fn servizi_e_registro_del_processo_sono_uno_e_non_avviano_niente() {
    let servizi = Servizi::processo();
    assert!(Arc::ptr_eq(&servizi, &Servizi::processo()));
    let motori = Motori::processo();
    assert!(Arc::ptr_eq(&motori, &Motori::processo()));
    assert!(Arc::ptr_eq(motori.servizi(), &servizi));
    assert!(!servizi.lavori().avviato(), "niente thread all'avvio");
    // I servizi di una prova non sono quelli del processo.
    assert!(!Arc::ptr_eq(&Servizi::nuovi(Config::default()), &servizi));
}

#[test]
fn il_gruppo_ha_i_thread_con_il_nome_e_il_numero_giusti() {
    assert_eq!(servizi(0).lavori().quanti(), 1, "almeno uno");
    assert_eq!(servizi(64).lavori().quanti(), 8, "al più otto");
    let attesi = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .saturating_sub(1)
        .clamp(1, 8);
    assert_eq!(Servizi::nuovi(Config::default()).lavori().quanti(), attesi);

    let servizi = servizi(2);
    assert!(!servizi.lavori().avviato());
    let nome = servizi
        .lavori()
        .installa(|| std::thread::current().name().map(str::to_owned));
    assert!(servizi.lavori().avviato());
    assert!(nome.unwrap().starts_with("fub-motore-"));
}

#[test]
fn un_panico_in_un_lavoro_non_chiude_il_processo() {
    let servizi = servizi(1);
    servizi.lavori().in_sottofondo(|| panic!("un lavoro rotto"));
    let (manda, ricevi) = mpsc::channel();
    servizi
        .lavori()
        .in_sottofondo(move || manda.send(41 + 1).unwrap());
    assert_eq!(ricevi.recv_timeout(Duration::from_secs(5)), Ok(42));
    // Il gruppo, con il suo unico thread, lavora ancora.
    assert_eq!(servizi.lavori().installa(|| 7), 7);
}
