//! Budget aggregati di processo e modello di minaccia esplicito (P11.3, #58).
//!
//! I presidi per-store vivono in [`crate::limits`]: scadenza a epoche di circa
//! 5 secondi per chiamata e tetto di 64 MiB **per memoria lineare** di un
//! componente. Questo modulo dichiara che cosa quei presidi garantiscono, che
//! cosa non garantiscono, e tiene il conto aggregato di ciò che il processo
//! spende davvero. La regola che lo governa è quella del piano: mantenere i
//! limiti per-store, valutare worker/processi isolati per quote forti,
//! dichiarare le garanzie effettive di ciascuna piattaforma — senza mai
//! spacciare un tetto di heap per-store per una quota RAM di processo.
//!
//! # Modello di minaccia
//!
//! L'attaccante è un componente WASM ostile o difettoso già installato con
//! consenso: il consenso copre *questi esatti byte*, non la buona condotta a
//! runtime. L'obiettivo dell'attaccante è negare il servizio (tempo CPU,
//! memoria, thread del pool) o uscire dal proprio recinto (file, rete,
//! capacità altrui). La vittima è l'app dell'utente, che deve restare viva e
//! responsiva e non deve perdere dati del vault.
//!
//! # Cosa è garantito (nel perimetro)
//!
//! - **Tempo per chiamata**: ogni attraversamento del confine arma una scadenza
//!   a epoche (`limits::renew` dentro ogni `with_guest`/`with_read_guest` e in
//!   ogni proxy di formato/view/grid). Un ciclo infinito dentro una chiamata
//!   viene interrotto con un trap, che il proxy traduce in errore tipizzato;
//!   l'host resta vivo (presidio `ciclo-wasm`).
//! - **Heap lineare per istanza**: `StoreLimits` limita ogni memoria lineare a
//!   64 MiB. Non è una prenotazione (cresce a pagine su richiesta) e non è una
//!   quota RAM del processo: vedi sotto.
//! - **Recinto delle capacità**: il componente chiama solo le famiglie
//!   importate dal suo mondo e solo attraverso l'`HostApi` già incappucciato
//!   dal `Guard` del kernel (decisione 0021). Questo crate non decide permessi.
//! - **Niente rientranza**: `enter_instance` rifiuta la chiamata rientrante
//!   sulla stessa istanza; il kernel non consegna mai un evento dentro la
//!   chiamata che lo ha prodotto.
//! - **Panici contenuti**: ogni attraversamento passa da `safety::{external,
//!   calling, reporting}`; un provider che pania costa la chiamata, non il
//!   vault.
//!
//! # Cosa NON è garantito (fuori perimetro, dichiarato)
//!
//! - **Quota assoluta CPU del processo**: la scadenza è per chiamata, non un
//!   budget cumulato. N chiamate legittime da 4,9 secondi consumano N volte il
//!   budget senza mai violarlo; M istanze su M thread consumano M volte.
//! - **Quota assoluta RAM del processo**: il tetto vale per memoria lineare
//!   WASM. Restano fuori: heap dell'host per tradurre ciò che attraversa
//!   (alberi arena→modello, pagine di query, JSON dei job), memorie multiple
//!   per componente (il tetto è per memoria), tabelle/istanze core del
//!   componente, memoria del compilatore condivisa. Le traduzioni ostili sono
//!   contenute dai propri tetti (`MAX_MATERIALIZATION_UNITS` in `model.rs`,
//!   tetti analoghi in `ui.rs`), non da questo modulo.
//! - **Scheduler starvation**: i job girano su un pool condiviso; un plugin che
//!   occupa tutti i thread con lavoro quasi-sotto-soglia rallenta gli altri
//!   senza violare alcun limite.
//! - **Isolamento forte**: stesso processo, stessa address space. Un bug di
//!   wasmtime o una Spectre di turno sono fuori modello, come su qualunque
//!   runtime in-process.
//! - **Piattaforme mobili**: JIT/WASM, vincoli degli store e memoria dei
//!   dispositivi non sono verificati qui; nessuna garanzia di questo modulo va
//!   letta come valida su iOS/Android finché P14 non la misura.
//!
//! # Valutazione: perché il limite resta cooperativo
//!
//! Un worker o processo dedicato per plugin darebbe quote assolute vere (ulimit,
//! cgroup, kill), ma cambierebbe il modello di costo e di failure di ogni
//! chiamata (serializzazione totale, supervisione, restart) per una minaccia —
//! l'abuso CPU/RAM oltre i tetti per-store — che nei casi d'uso di questo
//! contratto (note, testo, query) non ha un vettore osservato: i vettori noti
//! (ciclo infinito, allocazione in ciclo) sono già chiusi dai presidi
//! per-store. La decisione è quindi: limiti cooperativi ora, isolamento di
//! processo rivalutato quando un plugin reale avrà bisogno di più di 5 secondi
//! per chiamata o di più di 64 MiB di heap, oppure quando P14 lo imporrà. Ciò
//! che si fa comunque ora è il conto aggregato qui sotto: osservare è il
//! prerequisito di qualunque quota futura.
//!
//! # Il conto aggregato
//!
//! [`ProcessBudgets`] tiene tre contatori di processo (istanze vive, chiamate,
//! chiamate interrotte per scadenza o memoria) e un fermo operativo sul numero
//! di istanze vive contemporanee. Il fermo è un backstop operativo — impedisce
//! l'accumulo illimitato di istanze — e non una quota di sicurezza: è
//! documentato come tale perché prometterlo come confine sarebbe la bugia che
//! questo modulo esiste per non dire.

use std::sync::atomic::{AtomicU64, Ordering};

/// Fermo operativo sulle istanze vive contemporanee: **64**.
///
/// Ogni istanza trattiene stato compilato più heap lineare fino a 64 MiB per
/// memoria; 64 istanze sono due ordini di grandezza sopra l'uso legittimo
/// (un'istanza per montaggio per plugin) e abbastanza sotto il punto in cui
/// l'accumulo da solo mette in ginocchio un desktop. Non è una quota RAM: con
/// 64 istanze al tetto il processo tiene comunque oltre 4 GiB di heap lineare.
/// Chi legge questo numero come garanzia di memoria ha letto male, e il test
/// che lo presidia verifica il rifiuto oltre il fermo, non un consumo.
pub const MAX_LIVE_INSTANCES: usize = 64;

static LIVE_INSTANCES: AtomicU64 = AtomicU64::new(0);
static TOTAL_CALLS: AtomicU64 = AtomicU64::new(0);
static TIMED_OUT_CALLS: AtomicU64 = AtomicU64::new(0);
static OOM_CALLS: AtomicU64 = AtomicU64::new(0);

/// Fotografia dei contatori di processo, per diagnostica e smoke.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct BudgetSnapshot {
    /// Istanze con almeno un proxy vivo in questo momento.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub live_instances: u64,
    /// Attraversamenti del confine completati (qualunque esito).
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub total_calls: u64,
    /// Chiamate interrotte dalla scadenza a epoche.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub timed_out_calls: u64,
    /// Chiamate cadute per memoria lineare esaurita.
    #[serde(with = "fub_abi::ipc::u64_string")]
    pub oom_calls: u64,
}

/// Il rifiuto del fermo operativo: tipizzato, non una stringa.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BudgetError {
    /// Troppe istanze vive: il chiamante deve smontare prima di montare.
    #[error("troppe istanze WASM vive: {live} su un massimo operativo di {max}")]
    TooManyInstances {
        /// Istanze vive al momento del rifiuto.
        live: u64,
        /// Il fermo, cioè [`MAX_LIVE_INSTANCES`].
        max: usize,
    },
}

/// Permesso di esistere per un'istanza: lo trattiene il proxy, alla sua morte
/// il conto scende da sé. Non è `Clone`: un'istanza, un permesso.
#[derive(Debug)]
pub struct InstanceLease {
    _held: (),
}

impl Drop for InstanceLease {
    fn drop(&mut self) {
        LIVE_INSTANCES.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Prende un permesso d'istanza o rifiuta oltre il fermo.
///
/// Il conteggio sale prima di qualunque allocazione del componente: un
/// fallimento qui non lascia residui da smaltire.
pub fn try_acquire_instance() -> Result<InstanceLease, BudgetError> {
    let live = LIVE_INSTANCES.fetch_add(1, Ordering::Relaxed) + 1;
    if live as usize > MAX_LIVE_INSTANCES {
        LIVE_INSTANCES.fetch_sub(1, Ordering::Relaxed);
        return Err(BudgetError::TooManyInstances {
            live,
            max: MAX_LIVE_INSTANCES,
        });
    }
    Ok(InstanceLease { _held: () })
}

/// Istanze vive in questo momento, senza acquisirne nessuna.
pub fn live_instances() -> u64 {
    LIVE_INSTANCES.load(Ordering::Relaxed)
}

/// Registra un attraversamento completato, qualunque ne sia stato l'esito.
/// La chiama il proxy a fine chiamata, fuori dal confine.
pub fn note_call_completed() {
    TOTAL_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// Registra un'interruzione per scadenza a epoche. La chiama il proxy quando
/// traduce il trap `Interrupt` in errore tipizzato.
pub fn note_call_timed_out() {
    TOTAL_CALLS.fetch_add(1, Ordering::Relaxed);
    TIMED_OUT_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// Registra una caduta per memoria lineare esaurita. La chiama il proxy quando
/// traduce il fallimento di crescita in errore tipizzato.
pub fn note_call_oom() {
    TOTAL_CALLS.fetch_add(1, Ordering::Relaxed);
    OOM_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// Fotografia dei contatori, per diagnostica e per lo smoke centrale.
pub fn snapshot() -> BudgetSnapshot {
    BudgetSnapshot {
        live_instances: LIVE_INSTANCES.load(Ordering::Relaxed),
        total_calls: TOTAL_CALLS.load(Ordering::Relaxed),
        timed_out_calls: TIMED_OUT_CALLS.load(Ordering::Relaxed),
        oom_calls: OOM_CALLS.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operational_cap_refuses_without_hiding_the_count() {
        let mut leases = Vec::new();
        for _ in 0..MAX_LIVE_INSTANCES {
            leases.push(try_acquire_instance().expect("sotto il fermo si passa"));
        }
        assert_eq!(live_instances(), MAX_LIVE_INSTANCES as u64);
        let refused = try_acquire_instance().expect_err("oltre il fermo si rifiuta");
        assert_eq!(
            refused,
            BudgetError::TooManyInstances {
                live: MAX_LIVE_INSTANCES as u64 + 1,
                max: MAX_LIVE_INSTANCES,
            }
        );
        drop(leases.pop());
        try_acquire_instance().expect("un posto liberato torna disponibile");
    }
}
