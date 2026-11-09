//! Il budget comune delle cache dei motori.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::Instant;

use crate::Tetto;

/// Una cache di un motore, come la vede il budget.
///
/// I byte sono una stima onesta (la capacità delle strutture, non la sola
/// `size_of`). Il budget non tiene lucchetti mentre chiama una cache, quindi
/// una cache può chiamare il budget anche da dentro [`Cache::libera`].
pub trait Cache: Send + Sync {
    /// Il nome per il log e per l'elenco: «fogli.ortografia».
    fn nome(&self) -> &str;
    /// Quanti byte tiene adesso.
    fn byte(&self) -> u64;
    /// Libera **almeno** `quanto` byte se può, anche tutto; dice quanti ne ha
    /// liberati. Può liberarne meno, o nessuno: il budget passa alla cache
    /// seguente.
    fn libera(&self, quanto: u64) -> u64;
    /// L'ultima volta che qualcuno l'ha usata: si libera prima la meno usata
    /// di recente.
    fn ultimo_uso(&self) -> Instant;
}

/// Che cosa ha fatto una chiamata a [`Budget::rispetta`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resoconto {
    /// Il tetto con cui si è confrontato.
    pub tetto: u64,
    /// I byte delle cache prima.
    pub prima: u64,
    /// I byte delle cache dopo.
    pub dopo: u64,
    /// Vero se un'altra chiamata stava già lavorando: questa non ha fatto
    /// niente, e quella ripasserà una volta in più.
    pub saltato: bool,
}

/// Il budget della memoria delle cache dei motori: un tetto e l'elenco delle
/// cache iscritte.
///
/// L'elenco tiene `Weak`: una cache che il suo motore lascia cadere esce
/// dall'elenco da sola, alla prima occhiata. Il lucchetto dell'elenco copre
/// soltanto l'elenco: si prendono gli `Arc` vivi, lo si lascia, poi si
/// chiamano le cache.
pub struct Budget {
    tetto: Tetto,
    cache: Mutex<Vec<Weak<dyn Cache>>>,
    /// Vero mentre una [`Budget::rispetta`] lavora.
    in_corso: AtomicBool,
    /// Vero se una [`Budget::rispetta`] è arrivata mentre un'altra lavorava.
    di_nuovo: AtomicBool,
}

impl Budget {
    /// Un budget vuoto con questo tetto.
    pub fn nuovo(tetto: Tetto) -> Self {
        Self {
            tetto,
            cache: Mutex::new(Vec::new()),
            in_corso: AtomicBool::new(false),
            di_nuovo: AtomicBool::new(false),
        }
    }

    /// Iscrive una cache. La stessa cache iscritta due volte conta una volta.
    pub fn registra(&self, cache: &Arc<dyn Cache>) {
        let nuova = Arc::downgrade(cache);
        let mut elenco = self.elenco();
        elenco.retain(|vecchia| vecchia.strong_count() > 0);
        if !elenco.iter().any(|vecchia| Weak::ptr_eq(vecchia, &nuova)) {
            elenco.push(nuova);
        }
    }

    // Il lucchetto dell'elenco non è mai tenuto mentre si chiama codice
    // esterno, quindi un avvelenamento non può lasciare l'elenco a metà: lo si
    // riprende così com'è.
    fn elenco(&self) -> std::sync::MutexGuard<'_, Vec<Weak<dyn Cache>>> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Le cache vive, togliendo dall'elenco quelle morte.
    fn vive(&self) -> Vec<Arc<dyn Cache>> {
        let mut elenco = self.elenco();
        let mut vive = Vec::with_capacity(elenco.len());
        elenco.retain(|cache| match cache.upgrade() {
            Some(viva) => {
                vive.push(viva);
                true
            }
            None => false,
        });
        vive
    }

    /// Quante cache vive sono iscritte.
    pub fn quante(&self) -> usize {
        self.vive().len()
    }

    /// I byte di tutte le cache iscritte, adesso.
    pub fn usati(&self) -> u64 {
        self.vive().iter().map(|cache| cache.byte()).sum()
    }

    /// Il tetto adesso. Su Linux tiene conto della pressione della memoria,
    /// riletta al più una volta al secondo.
    pub fn tetto(&self) -> u64 {
        self.tetto.adesso()
    }

    /// Libera dalle cache meno usate di recente finché i byte stanno sotto il
    /// tetto, o finché le cache non hanno più niente da dare.
    ///
    /// Due chiamate insieme non lavorano due volte: la seconda torna subito
    /// ([`Resoconto::saltato`]) e la prima ripassa una volta in più alla fine,
    /// perché la seconda poteva avere un motivo nuovo.
    pub fn rispetta(&self) -> Resoconto {
        // Prima la richiesta, poi il turno: chi trova il turno occupato ha già
        // lasciato la richiesta, e chi lascia il turno la vede.
        self.di_nuovo.store(true, Ordering::SeqCst);
        if !self.prendi_turno() {
            return Resoconto {
                tetto: self.tetto(),
                prima: 0,
                dopo: 0,
                saltato: true,
            };
        }
        let mut resoconto: Option<Resoconto> = None;
        loop {
            let giro = {
                let _turno = Turno(&self.in_corso);
                self.di_nuovo.store(false, Ordering::SeqCst);
                self.un_giro()
            };
            let resoconto = resoconto.get_or_insert(giro);
            resoconto.tetto = giro.tetto;
            resoconto.dopo = giro.dopo;
            // Il turno è lasciato: se nel frattempo qualcuno ha chiesto, e
            // nessun altro ha preso il turno, si ripassa.
            if !self.di_nuovo.load(Ordering::SeqCst) || !self.prendi_turno() {
                return *resoconto;
            }
        }
    }

    fn prendi_turno(&self) -> bool {
        self.in_corso
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn un_giro(&self) -> Resoconto {
        let tetto = self.tetto();
        let mut cache: Vec<(Instant, u64, Arc<dyn Cache>)> = self
            .vive()
            .into_iter()
            .map(|cache| (cache.ultimo_uso(), cache.byte(), cache))
            .collect();
        let prima: u64 = cache.iter().map(|(_, byte, _)| byte).sum();
        let mut usati = prima;
        if usati > tetto {
            cache.sort_by_key(|(uso, _, _)| *uso);
            for (_, byte, cache) in &cache {
                if usati <= tetto {
                    break;
                }
                if *byte == 0 {
                    continue;
                }
                let chiesti = usati - tetto;
                let detti = cache.libera(chiesti);
                // Si conta ciò che la cache tiene dopo, non ciò che dice di aver
                // liberato: una stima sbagliata non inganna il conto.
                let dopo = cache.byte();
                usati = usati - byte + dopo.min(*byte);
                tracing::debug!(
                    cache = cache.nome(),
                    chiesti,
                    detti,
                    liberati = byte.saturating_sub(dopo),
                    "fub-motori: il budget ha liberato una cache"
                );
            }
        }
        Resoconto {
            tetto,
            prima,
            dopo: usati,
            saltato: false,
        }
    }

    /// Svuota ogni cache iscritta e dice quanti byte se ne sono andati. Il
    /// tetto non conta: è la chiusura.
    pub fn svuota_tutto(&self) -> u64 {
        self.vive()
            .iter()
            .map(|cache| {
                let prima = cache.byte();
                cache.libera(u64::MAX);
                prima.saturating_sub(cache.byte())
            })
            .sum()
    }

    /// Rende al sistema la memoria che l'allocatore tiene libera
    /// ([`rilascia_al_sistema`]).
    pub fn rilascia_al_sistema(&self) -> bool {
        rilascia_al_sistema()
    }
}

/// Lascia il turno di [`Budget::rispetta`] anche se una cache va in panico.
struct Turno<'a>(&'a AtomicBool);

impl Drop for Turno<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl std::fmt::Debug for Budget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Budget")
            .field("tetto", &self.tetto)
            .field("cache", &self.elenco().len())
            .finish()
    }
}

/// Rende al sistema la memoria che l'allocatore tiene libera.
///
/// Su Linux con la glibc chiama `malloc_trim(0)`: la glibc trattiene le pagine
/// liberate, e senza questa chiamata chiudere un motore non abbassa la memoria
/// del processo (`docs/misure/motori-2026-10-31-linux-ryzen.md`). Vero se ha
/// reso qualcosa. Altrove non fa niente e dà falso.
pub fn rilascia_al_sistema() -> bool {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        // SAFETY: `malloc_trim` non ha precondizioni: lavora sulle arene della
        // glibc sotto i lucchetti suoi, e il margine 0 chiede di rendere tutto
        // ciò che si può. Non tocca memoria in uso.
        unsafe { libc::malloc_trim(0) != 0 }
    }
    #[cfg(not(all(target_os = "linux", target_env = "gnu")))]
    {
        false
    }
}
