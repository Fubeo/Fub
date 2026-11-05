//! Il tetto della memoria dei motori e la pressione che lo abbassa (ADR 0236,
//! A5).
//!
//! Il tetto parte da un ottavo della RAM installata, fra 256 MiB e 2 GiB; se
//! la RAM non si sa (macOS, Windows, un `/proc` che non si legge) parte da
//! 1 GiB. Su Linux scende con la pressione della memoria (PSI,
//! `/proc/pressure/memory`): a metà con `some avg10 ≥ 10`, a un quarto con
//! `full avg10 ≥ 5`. Senza PSI (kernel vecchio, container, altri sistemi) il
//! tetto resta quello di partenza.
//!
//! La lettura dei file è separata dal significato: [`mem_totale`] e [`psi`]
//! sono funzioni pure sul testo, e la [`Sorgente`] che dà il testo si
//! sostituisce nelle prove.

use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

/// Il tetto più basso che la RAM installata può dare.
pub const TETTO_MINIMO: u64 = 256 * MIB;
/// Il tetto più alto che la RAM installata può dare.
pub const TETTO_MASSIMO: u64 = 2 * GIB;
/// Il tetto quando la RAM installata non si sa.
pub const TETTO_SENZA_RAM: u64 = GIB;
/// Ogni quanto, al più, si rilegge la pressione: chiamate fitte di
/// [`crate::Budget::rispetta`] non leggono il file ogni volta.
pub const INTERVALLO_PRESSIONE: Duration = Duration::from_secs(1);

/// Da dove arriva il testo di `/proc/meminfo` e di `/proc/pressure/memory`.
pub trait Sorgente: Send + Sync {
    /// Il testo di `/proc/meminfo`, se c'è.
    fn meminfo(&self) -> Option<String>;
    /// Il testo di `/proc/pressure/memory`, se c'è.
    fn pressione(&self) -> Option<String>;
}

/// La sorgente vera: i file di `/proc` su Linux, niente altrove.
#[derive(Debug, Default, Clone, Copy)]
pub struct Proc;

impl Sorgente for Proc {
    fn meminfo(&self) -> Option<String> {
        leggi("/proc/meminfo")
    }

    fn pressione(&self) -> Option<String> {
        leggi("/proc/pressure/memory")
    }
}

#[cfg(target_os = "linux")]
fn leggi(percorso: &str) -> Option<String> {
    std::fs::read_to_string(percorso).ok()
}

#[cfg(not(target_os = "linux"))]
fn leggi(_percorso: &str) -> Option<String> {
    None
}

/// La RAM installata in byte, dalla riga `MemTotal:` di `/proc/meminfo`.
///
/// `None` se la riga manca, non ha un numero o non è in `kB`.
pub fn mem_totale(meminfo: &str) -> Option<u64> {
    meminfo.lines().find_map(|riga| {
        let resto = riga.strip_prefix("MemTotal:")?;
        let mut parti = resto.split_whitespace();
        let numero: u64 = parti.next()?.parse().ok()?;
        match parti.next() {
            Some("kB") => numero.checked_mul(1024),
            _ => None,
        }
    })
}

/// La pressione della memoria, i soli valori che decidono il tetto.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Psi {
    /// `some avg10`: la percentuale degli ultimi 10 s in cui almeno un
    /// processo ha aspettato la memoria.
    pub some_avg10: f64,
    /// `full avg10`: la percentuale degli ultimi 10 s in cui tutti i processi
    /// hanno aspettato. Manca nei kernel che scrivono la sola riga `some`.
    pub full_avg10: Option<f64>,
}

/// Il testo di `/proc/pressure/memory`, letto. `None` se la riga `some` manca
/// o non ha un `avg10` numerico; una riga `full` storpiata vale come assente.
pub fn psi(testo: &str) -> Option<Psi> {
    let mut some = None;
    let mut full = None;
    for riga in testo.lines() {
        let mut parti = riga.split_whitespace();
        let tipo = parti.next();
        let avg10 = parti
            .find_map(|campo| campo.strip_prefix("avg10="))
            .and_then(|valore| valore.parse::<f64>().ok())
            .filter(|valore| valore.is_finite());
        match tipo {
            Some("some") => some = avg10,
            Some("full") => full = avg10,
            _ => {}
        }
    }
    Some(Psi {
        some_avg10: some?,
        full_avg10: full,
    })
}

/// Il tetto di partenza: un ottavo della RAM installata, fra
/// [`TETTO_MINIMO`] e [`TETTO_MASSIMO`]; [`TETTO_SENZA_RAM`] se non si sa.
pub fn tetto_di_partenza(ram: Option<u64>) -> u64 {
    ram.map_or(TETTO_SENZA_RAM, |ram| {
        (ram / 8).clamp(TETTO_MINIMO, TETTO_MASSIMO)
    })
}

/// Il tetto con la pressione: un quarto con `full avg10 ≥ 5`, metà con
/// `some avg10 ≥ 10`, intero altrimenti o senza PSI.
pub fn tetto_con_pressione(partenza: u64, pressione: Option<Psi>) -> u64 {
    let Some(pressione) = pressione else {
        return partenza;
    };
    if pressione.full_avg10.is_some_and(|full| full >= 5.0) {
        partenza / 4
    } else if pressione.some_avg10 >= 10.0 {
        partenza / 2
    } else {
        partenza
    }
}

/// Il tetto della memoria di un [`crate::Budget`]: fisso, o letto dal sistema.
pub struct Tetto(Modo);

enum Modo {
    Fisso(u64),
    Sistema(Sistema),
}

struct Sistema {
    sorgente: Arc<dyn Sorgente>,
    intervallo: Duration,
    /// La RAM non cambia: il tetto di partenza si legge una volta, alla
    /// prima richiesta.
    partenza: OnceLock<u64>,
    /// L'ultima lettura della pressione e il tetto che ne è venuto.
    ultimo: Mutex<Option<(Instant, u64)>>,
}

impl Tetto {
    /// Un tetto che non cambia: per le prove, o per chi lo sceglie.
    pub fn fisso(byte: u64) -> Self {
        Self(Modo::Fisso(byte))
    }

    /// Il tetto del sistema: `/proc` su Linux, [`TETTO_SENZA_RAM`] altrove.
    pub fn dal_sistema() -> Self {
        Self::da_sorgente(Arc::new(Proc), INTERVALLO_PRESSIONE)
    }

    /// Il tetto calcolato da `sorgente`, con la pressione riletta al più ogni
    /// `intervallo`. Non legge niente finché nessuno chiede il tetto.
    pub fn da_sorgente(sorgente: Arc<dyn Sorgente>, intervallo: Duration) -> Self {
        Self(Modo::Sistema(Sistema {
            sorgente,
            intervallo,
            partenza: OnceLock::new(),
            ultimo: Mutex::new(None),
        }))
    }

    /// Il tetto adesso, in byte.
    pub fn adesso(&self) -> u64 {
        match &self.0 {
            Modo::Fisso(byte) => *byte,
            Modo::Sistema(sistema) => sistema.adesso(),
        }
    }
}

impl Sistema {
    fn adesso(&self) -> u64 {
        let partenza = *self.partenza.get_or_init(|| {
            tetto_di_partenza(self.sorgente.meminfo().as_deref().and_then(mem_totale))
        });
        let ora = Instant::now();
        let precedente = *self.ultimo.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((quando, tetto)) = precedente {
            if ora.duration_since(quando) < self.intervallo {
                return tetto;
            }
        }
        // Il file si legge a lucchetto lasciato.
        let pressione = self.sorgente.pressione().as_deref().and_then(psi);
        let tetto = tetto_con_pressione(partenza, pressione);
        *self.ultimo.lock().unwrap_or_else(PoisonError::into_inner) = Some((ora, tetto));
        tetto
    }
}

impl std::fmt::Debug for Tetto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.0 {
            Modo::Fisso(byte) => f.debug_tuple("Tetto::fisso").field(byte).finish(),
            Modo::Sistema(sistema) => f
                .debug_struct("Tetto::dal_sistema")
                .field("intervallo", &sistema.intervallo)
                .finish_non_exhaustive(),
        }
    }
}
