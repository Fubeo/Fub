//! Il budget delle cache e il tetto della memoria: l'ordine in cui si libera,
//! le `Weak` morte, la pressione letta dai campioni.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::thread;
use std::time::{Duration, Instant};

use fub_motori::pressione::{
    mem_totale, psi, tetto_con_pressione, tetto_di_partenza, Psi, Sorgente, TETTO_MASSIMO,
    TETTO_MINIMO, TETTO_SENZA_RAM,
};
use fub_motori::{Budget, Cache, Tetto};

const MIB: u64 = 1024 * 1024;

/// Come libera una cache di prova.
#[derive(Clone, Copy)]
enum Modo {
    /// Libera quanto chiesto, al più tutto.
    Onesta,
    /// Libera la metà di quanto chiesto.
    Avara,
    /// Non libera niente.
    Sorda,
}

struct Finta {
    nome: String,
    byte: AtomicU64,
    uso: Instant,
    modo: Modo,
    chiamate: Arc<Mutex<Vec<String>>>,
}

impl Finta {
    fn nuova(
        nome: &str,
        byte: u64,
        vecchia_di: u64,
        modo: Modo,
        chiamate: &Arc<Mutex<Vec<String>>>,
    ) -> Arc<Finta> {
        Arc::new(Finta {
            nome: nome.to_owned(),
            byte: AtomicU64::new(byte),
            uso: Instant::now() - Duration::from_secs(vecchia_di),
            modo,
            chiamate: chiamate.clone(),
        })
    }
}

impl Cache for Finta {
    fn nome(&self) -> &str {
        &self.nome
    }
    fn byte(&self) -> u64 {
        self.byte.load(Ordering::SeqCst)
    }
    fn libera(&self, quanto: u64) -> u64 {
        self.chiamate.lock().unwrap().push(self.nome.clone());
        let ha = self.byte();
        let via = match self.modo {
            Modo::Onesta => quanto.min(ha),
            Modo::Avara => (quanto / 2).min(ha),
            Modo::Sorda => 0,
        };
        self.byte.store(ha - via, Ordering::SeqCst);
        via
    }
    fn ultimo_uso(&self) -> Instant {
        self.uso
    }
}

fn iscrivi(budget: &Budget, cache: &Arc<Finta>) {
    let cache: Arc<dyn Cache> = cache.clone();
    budget.registra(&cache);
}

#[test]
fn rispetta_libera_dalla_meno_usata_e_si_ferma_sotto_il_tetto() {
    let chiamate = Arc::default();
    let budget = Budget::nuovo(Tetto::fisso(150));
    let nuova = Finta::nuova("nuova", 100, 1, Modo::Onesta, &chiamate);
    let vecchia = Finta::nuova("vecchia", 100, 30, Modo::Onesta, &chiamate);
    let media = Finta::nuova("media", 100, 10, Modo::Onesta, &chiamate);
    for cache in [&nuova, &vecchia, &media] {
        iscrivi(&budget, cache);
    }
    assert_eq!(budget.usati(), 300);

    let resoconto = budget.rispetta();
    assert_eq!(
        (resoconto.prima, resoconto.dopo, resoconto.tetto),
        (300, 150, 150)
    );
    assert!(!resoconto.saltato);
    assert_eq!(*chiamate.lock().unwrap(), ["vecchia", "media"]);
    assert_eq!((vecchia.byte(), media.byte(), nuova.byte()), (0, 50, 100));

    // Sotto il tetto non si chiama nessuno.
    budget.rispetta();
    assert_eq!(chiamate.lock().unwrap().len(), 2);
}

#[test]
fn una_cache_che_libera_meno_o_niente_fa_passare_alla_seguente() {
    let chiamate = Arc::default();
    let budget = Budget::nuovo(Tetto::fisso(100));
    let sorda = Finta::nuova("sorda", 100, 30, Modo::Sorda, &chiamate);
    let avara = Finta::nuova("avara", 100, 20, Modo::Avara, &chiamate);
    let onesta = Finta::nuova("onesta", 100, 10, Modo::Onesta, &chiamate);
    for cache in [&sorda, &avara, &onesta] {
        iscrivi(&budget, cache);
    }
    let resoconto = budget.rispetta();
    assert_eq!(*chiamate.lock().unwrap(), ["sorda", "avara", "onesta"]);
    // La sorda tiene 100, l'avara ne ha dati 100 su 200 chiesti, l'onesta i 100
    // che restavano.
    assert_eq!((sorda.byte(), avara.byte(), onesta.byte()), (100, 0, 0));
    assert_eq!(resoconto.dopo, 100);
}

#[test]
fn con_il_tetto_a_zero_si_svuota_tutto_quello_che_si_puo() {
    let chiamate = Arc::default();
    let budget = Budget::nuovo(Tetto::fisso(0));
    let a = Finta::nuova("a", 10, 2, Modo::Onesta, &chiamate);
    let b = Finta::nuova("b", 20, 1, Modo::Onesta, &chiamate);
    let vuota = Finta::nuova("vuota", 0, 3, Modo::Onesta, &chiamate);
    for cache in [&a, &b, &vuota] {
        iscrivi(&budget, cache);
    }
    assert_eq!(budget.rispetta().dopo, 0);
    assert_eq!(budget.usati(), 0);
    assert_eq!(
        *chiamate.lock().unwrap(),
        ["a", "b"],
        "una cache vuota non si chiama"
    );
}

#[test]
fn una_weak_morta_sparisce_dall_elenco() {
    let chiamate = Arc::default();
    let budget = Budget::nuovo(Tetto::fisso(0));
    let viva = Finta::nuova("viva", 5, 1, Modo::Onesta, &chiamate);
    let morta = Finta::nuova("morta", 5, 2, Modo::Onesta, &chiamate);
    iscrivi(&budget, &viva);
    iscrivi(&budget, &morta);
    iscrivi(&budget, &viva);
    assert_eq!(
        budget.quante(),
        2,
        "la stessa cache iscritta due volte conta una"
    );
    drop(morta);
    assert_eq!(budget.quante(), 1);
    assert_eq!(budget.usati(), 5);
    budget.rispetta();
    assert_eq!(*chiamate.lock().unwrap(), ["viva"]);
}

#[test]
fn svuota_tutto_ignora_il_tetto() {
    let chiamate = Arc::default();
    let budget = Budget::nuovo(Tetto::fisso(u64::MAX));
    let a = Finta::nuova("a", 10, 1, Modo::Onesta, &chiamate);
    let sorda = Finta::nuova("sorda", 7, 1, Modo::Sorda, &chiamate);
    iscrivi(&budget, &a);
    iscrivi(&budget, &sorda);
    assert_eq!(budget.rispetta().dopo, 17);
    assert_eq!(budget.svuota_tutto(), 10);
    assert_eq!(budget.usati(), 7);
    // Rendere al sistema non rompe niente, su ogni piattaforma.
    budget.rilascia_al_sistema();
}

/// Una cache che, mentre libera, chiama il budget: se il budget tenesse il
/// lucchetto dell'elenco, qui si bloccherebbe. E si ferma finché il test non
/// dice via, per far arrivare una seconda `rispetta` durante la prima.
struct Rientrante {
    byte: AtomicU64,
    budget: OnceLock<Weak<Budget>>,
    dentro: AtomicBool,
    via: AtomicBool,
    chiamate: AtomicUsize,
}

impl Cache for Rientrante {
    fn nome(&self) -> &str {
        "rientrante"
    }
    fn byte(&self) -> u64 {
        self.byte.load(Ordering::SeqCst)
    }
    fn libera(&self, _quanto: u64) -> u64 {
        self.chiamate.fetch_add(1, Ordering::SeqCst);
        let budget = self.budget.get().unwrap().upgrade().unwrap();
        assert_eq!(budget.quante(), 1);
        assert_eq!(budget.usati(), self.byte());
        self.dentro.store(true, Ordering::SeqCst);
        while !self.via.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(2));
        }
        self.byte.swap(0, Ordering::SeqCst)
    }
    fn ultimo_uso(&self) -> Instant {
        Instant::now()
    }
}

#[test]
fn due_rispetta_insieme_non_lavorano_due_volte_e_nessun_lucchetto_e_tenuto() {
    let budget = Arc::new(Budget::nuovo(Tetto::fisso(0)));
    let cache = Arc::new(Rientrante {
        byte: AtomicU64::new(40),
        budget: OnceLock::new(),
        dentro: AtomicBool::new(false),
        via: AtomicBool::new(false),
        chiamate: AtomicUsize::new(0),
    });
    cache.budget.set(Arc::downgrade(&budget)).unwrap();
    let dyn_cache: Arc<dyn Cache> = cache.clone();
    budget.registra(&dyn_cache);

    let prima = {
        let budget = budget.clone();
        thread::spawn(move || budget.rispetta())
    };
    let fine = Instant::now() + Duration::from_secs(5);
    while !cache.dentro.load(Ordering::SeqCst) {
        assert!(Instant::now() < fine);
        thread::sleep(Duration::from_millis(2));
    }
    let seconda = budget.rispetta();
    assert!(seconda.saltato, "la seconda torna subito");
    cache.via.store(true, Ordering::SeqCst);
    let prima = prima.join().unwrap();
    assert!(!prima.saltato);
    assert_eq!((prima.prima, prima.dopo), (40, 0));
    // La prima ripassa per la seconda, ma trova tutto sotto il tetto.
    assert_eq!(cache.chiamate.load(Ordering::SeqCst), 1);
}

// ---------------------------------------------------------------- pressione

const MEMINFO: &str = "\
MemTotal:       16318412 kB
MemFree:         1203348 kB
MemAvailable:    9876544 kB
Buffers:          412300 kB
";

const PSI_CALMA: &str = "\
some avg10=0.00 avg60=0.12 avg300=0.08 total=123456
full avg10=0.00 avg60=0.05 avg300=0.02 total=65432
";

const PSI_SOME: &str = "\
some avg10=12.50 avg60=4.00 avg300=1.00 total=9999999
full avg10=1.20 avg60=0.40 avg300=0.10 total=888888
";

const PSI_FULL: &str = "\
some avg10=40.00 avg60=20.00 avg300=5.00 total=9999999
full avg10=7.31 avg60=3.00 avg300=1.00 total=888888
";

#[test]
fn meminfo_si_legge_dai_campioni() {
    assert_eq!(mem_totale(MEMINFO), Some(16_318_412 * 1024));
    assert_eq!(mem_totale("MemFree: 12 kB\n"), None);
    assert_eq!(mem_totale("MemTotal: tanti kB\n"), None);
    assert_eq!(
        mem_totale("MemTotal: 12\n"),
        None,
        "senza unità non si indovina"
    );
    assert_eq!(mem_totale(""), None);
}

#[test]
fn psi_si_legge_dai_campioni() {
    assert_eq!(
        psi(PSI_CALMA),
        Some(Psi {
            some_avg10: 0.0,
            full_avg10: Some(0.0)
        })
    );
    assert_eq!(
        psi(PSI_FULL),
        Some(Psi {
            some_avg10: 40.0,
            full_avg10: Some(7.31)
        })
    );
    // Un kernel che scrive la sola riga `some`.
    assert_eq!(
        psi("some avg10=3.00 avg60=1.00 avg300=0.50 total=1\n"),
        Some(Psi {
            some_avg10: 3.0,
            full_avg10: None
        })
    );
    assert_eq!(psi(""), None);
    assert_eq!(psi("full avg10=9.00 avg60=1 avg300=1 total=1\n"), None);
    assert_eq!(psi("some avg10=NaN avg60=1 avg300=1 total=1\n"), None);
}

#[test]
fn il_tetto_parte_da_un_ottavo_della_ram_fra_i_limiti() {
    assert_eq!(tetto_di_partenza(None), TETTO_SENZA_RAM);
    assert_eq!(tetto_di_partenza(Some(8 * 1024 * MIB)), 1024 * MIB);
    assert_eq!(tetto_di_partenza(Some(1024 * MIB)), TETTO_MINIMO);
    assert_eq!(tetto_di_partenza(Some(64 * 1024 * MIB)), TETTO_MASSIMO);
    assert_eq!(tetto_di_partenza(Some(0)), TETTO_MINIMO);
}

#[test]
fn la_pressione_abbassa_il_tetto() {
    let base = 1024 * MIB;
    assert_eq!(tetto_con_pressione(base, None), base);
    assert_eq!(tetto_con_pressione(base, psi(PSI_CALMA)), base);
    assert_eq!(tetto_con_pressione(base, psi(PSI_SOME)), base / 2);
    assert_eq!(tetto_con_pressione(base, psi(PSI_FULL)), base / 4);
    let soglie = Psi {
        some_avg10: 10.0,
        full_avg10: Some(5.0),
    };
    assert_eq!(
        tetto_con_pressione(base, Some(soglie)),
        base / 4,
        "le soglie sono comprese"
    );
}

struct Campioni {
    meminfo: Option<&'static str>,
    pressione: Mutex<Option<&'static str>>,
    letture: AtomicUsize,
}

impl Sorgente for Campioni {
    fn meminfo(&self) -> Option<String> {
        self.meminfo.map(str::to_owned)
    }
    fn pressione(&self) -> Option<String> {
        self.letture.fetch_add(1, Ordering::SeqCst);
        self.pressione.lock().unwrap().map(str::to_owned)
    }
}

#[test]
fn il_tetto_del_sistema_legge_la_sorgente_sostituita() {
    let campioni = Arc::new(Campioni {
        meminfo: Some(MEMINFO),
        pressione: Mutex::new(Some(PSI_CALMA)),
        letture: AtomicUsize::new(0),
    });
    let tetto = Tetto::da_sorgente(campioni.clone(), Duration::ZERO);
    assert_eq!(
        campioni.letture.load(Ordering::SeqCst),
        0,
        "niente letture prima della domanda"
    );
    let base = tetto_di_partenza(Some(16_318_412 * 1024));
    assert_eq!(tetto.adesso(), base);
    *campioni.pressione.lock().unwrap() = Some(PSI_SOME);
    assert_eq!(tetto.adesso(), base / 2);
    *campioni.pressione.lock().unwrap() = Some(PSI_FULL);
    assert_eq!(tetto.adesso(), base / 4);
}

#[test]
fn senza_proc_pressure_il_tetto_resta_quello_di_partenza() {
    let campioni = Arc::new(Campioni {
        meminfo: None,
        pressione: Mutex::new(None),
        letture: AtomicUsize::new(0),
    });
    let tetto = Tetto::da_sorgente(campioni, Duration::ZERO);
    assert_eq!(tetto.adesso(), TETTO_SENZA_RAM);
    let budget = Budget::nuovo(tetto);
    assert_eq!(budget.tetto(), TETTO_SENZA_RAM);
}

#[test]
fn chiamate_fitte_non_rileggono_la_pressione() {
    let campioni = Arc::new(Campioni {
        meminfo: Some(MEMINFO),
        pressione: Mutex::new(Some(PSI_CALMA)),
        letture: AtomicUsize::new(0),
    });
    let budget = Budget::nuovo(Tetto::da_sorgente(
        campioni.clone(),
        Duration::from_secs(3600),
    ));
    for _ in 0..50 {
        budget.rispetta();
    }
    assert_eq!(campioni.letture.load(Ordering::SeqCst), 1);
}

#[test]
fn il_tetto_del_sistema_si_legge_su_questa_macchina() {
    let tetto = Tetto::dal_sistema().adesso();
    assert!(
        (TETTO_MINIMO / 4..=TETTO_MASSIMO).contains(&tetto),
        "{tetto}"
    );
}
