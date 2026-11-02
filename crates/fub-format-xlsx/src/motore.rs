//! GridCraft sullo strato dei motori (ADR 0236, `docs/architecture/motori.md`):
//! il motore dei fogli costruito alla prima apertura, le sue due cache nel
//! budget comune e la memoria resa quando l'ultimo foglio si chiude.
//!
//! - [`MotoreFogli`] è ciò che la prima apertura prepara: il catalogo dei
//!   comandi della facciata e l'elenco delle funzioni. Sta dietro un
//!   [`Pigro`]: crearsi il provider non lo costruisce, la prima apertura sì.
//! - [`Fogli`] è il motore come lo vede il processo: il `Pigro`, i servizi e il
//!   conto delle istanze aperte. Quello del processo ([`Fogli::processo`]) si
//!   iscrive in [`Motori::processo`] con lo spazio [`SPAZIO`] e le estensioni
//!   del formato la prima volta che un provider si crea, una volta sola.
//! - Le due cache sono quelle che GridCraft tiene per tutto il processo: il
//!   dizionario dell'ortografia (`review.spelling`, `review.thesaurus`,
//!   `review.changeSpelling`) e i formati dei numeri già letti. Sono una per
//!   processo come i dati che contano.
//!
//! Il conto è delle istanze, non delle chiusure: un'istanza tiene una
//! [`Presa`], e quando cade l'ultima presa le cache si svuotano e la memoria
//! torna al sistema. Il salvataggio di `fub-host` apre e chiude un'istanza
//! sua: con un foglio ancora aperto la sua chiusura non svuota niente.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Instant;

use fub_motori::{rilascia_al_sistema, Cache, ErroreMotore, Motori, Pigro, Servizi, Voce};
use gridcraft_engine::cmd::spelling::{release_spelling_dictionary, spelling_dictionary_bytes};
use gridcraft_engine::display::{clear_number_format_cache, number_format_cache_len};
use gridcraft_engine::CommandSpec;
use gridcraft_numfmt::NumberFormat;

use crate::EXTENSIONS;

/// Lo spazio dei fogli nel registro dei motori.
pub const SPAZIO: &str = "fogli";

/// I comandi della facciata che leggono il dizionario dell'ortografia.
const COMANDI_DEL_DIZIONARIO: &[&str] = &[
    "review.spelling",
    "review.changeSpelling",
    "review.thesaurus",
];

/// I byte di un formato dei numeri nella cache di GridCraft, per difetto: la
/// voce della tabella (il codice e il formato letto) e il suo byte di
/// controllo. Il testo del codice e le sezioni del formato sul heap non si
/// vedono da fuori, e non si contano.
const BYTE_DI_UN_FORMATO: u64 =
    (std::mem::size_of::<String>() + std::mem::size_of::<NumberFormat>() + 1) as u64;

/// L'ultima volta che una cache è stata usata.
struct Uso(Mutex<Instant>);

impl Uso {
    fn nuovo() -> Self {
        Self(Mutex::new(Instant::now()))
    }

    fn tocca(&self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }

    fn quando(&self) -> Instant {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Il dizionario dell'ortografia di GridCraft, letto al primo controllo.
struct Ortografia {
    uso: Uso,
}

impl Cache for Ortografia {
    fn nome(&self) -> &str {
        "fogli.ortografia"
    }

    fn byte(&self) -> u64 {
        spelling_dictionary_bytes() as u64
    }

    /// Il dizionario si libera tutto o niente; il controllo dopo lo rilegge.
    fn libera(&self, _quanto: u64) -> u64 {
        release_spelling_dictionary() as u64
    }

    fn ultimo_uso(&self) -> Instant {
        self.uso.quando()
    }
}

/// I formati dei numeri che la facciata ha già letto.
struct Formati {
    uso: Uso,
}

impl Cache for Formati {
    fn nome(&self) -> &str {
        "fogli.formati"
    }

    fn byte(&self) -> u64 {
        number_format_cache_len() as u64 * BYTE_DI_UN_FORMATO
    }

    /// La cache si svuota tutta: i formati si rileggono quando servono.
    fn libera(&self, _quanto: u64) -> u64 {
        clear_number_format_cache() as u64 * BYTE_DI_UN_FORMATO
    }

    fn ultimo_uso(&self) -> Instant {
        self.uso.quando()
    }
}

/// Le due cache, una per processo come i dati di GridCraft che contano.
struct LeCache {
    ortografia: Arc<Ortografia>,
    formati: Arc<Formati>,
}

impl LeCache {
    fn del_processo() -> &'static LeCache {
        static CACHE: OnceLock<LeCache> = OnceLock::new();
        CACHE.get_or_init(|| LeCache {
            ortografia: Arc::new(Ortografia { uso: Uso::nuovo() }),
            formati: Arc::new(Formati { uso: Uso::nuovo() }),
        })
    }

    fn tutte(&self) -> [Arc<dyn Cache>; 2] {
        [
            Arc::clone(&self.ortografia) as Arc<dyn Cache>,
            Arc::clone(&self.formati) as Arc<dyn Cache>,
        ]
    }
}

/// Il motore dei fogli: ciò che la prima apertura prepara, e le cache.
pub struct MotoreFogli {
    servizi: Arc<Servizi>,
    cache: &'static LeCache,
    comandi: &'static [CommandSpec],
    /// I byte delle cache all'ultima occhiata: se crescono, si chiede al
    /// budget di rispettare il tetto.
    visti: AtomicU64,
}

impl MotoreFogli {
    /// Prepara il catalogo dei comandi della facciata e l'elenco delle
    /// funzioni, e iscrive le cache nel budget dei servizi.
    fn crea(servizi: &Arc<Servizi>) -> Result<MotoreFogli, ErroreMotore> {
        let comandi = gridcraft_engine::command_specs();
        // L'elenco delle funzioni di GridCraft nasce alla prima domanda.
        gridcraft_calc::is_known_function("SUM");
        let cache = LeCache::del_processo();
        for una in cache.tutte() {
            servizi.memoria().registra(&una);
        }
        let motore = MotoreFogli {
            servizi: Arc::clone(servizi),
            cache,
            comandi,
            visti: AtomicU64::new(0),
        };
        motore.visti.store(motore.byte(), Ordering::Relaxed);
        Ok(motore)
    }

    /// Il catalogo dei comandi della facciata, preparato con il motore.
    pub fn comandi(&self) -> &'static [CommandSpec] {
        self.comandi
    }

    /// I byte delle due cache, adesso.
    pub fn byte(&self) -> u64 {
        self.cache.ortografia.byte() + self.cache.formati.byte()
    }

    /// I byte del dizionario dell'ortografia, adesso.
    pub fn byte_del_dizionario(&self) -> u64 {
        self.cache.ortografia.byte()
    }

    /// I byte dei formati dei numeri, adesso.
    pub fn byte_dei_formati(&self) -> u64 {
        self.cache.formati.byte()
    }

    /// Svuota le due cache e dice quanti byte se ne sono andati.
    pub fn svuota(&self) -> u64 {
        let prima = self.byte();
        self.cache.ortografia.libera(u64::MAX);
        self.cache.formati.libera(u64::MAX);
        let dopo = self.byte();
        self.visti.store(dopo, Ordering::Relaxed);
        prima.saturating_sub(dopo)
    }

    /// Dopo un comando della facciata: segna l'uso delle cache che il comando
    /// raggiunge e, se sono cresciute, chiede al budget di rispettare il
    /// tetto.
    ///
    /// Ogni comando può formattare numeri (un riempimento, una ricerca, una
    /// copia, la stampa), quindi segna i formati; soltanto i comandi
    /// dell'ortografia leggono il dizionario.
    pub(crate) fn dopo_il_comando(&self, id: &str) {
        self.cache.formati.uso.tocca();
        if COMANDI_DEL_DIZIONARIO.contains(&id) {
            self.cache.ortografia.uso.tocca();
        }
        let adesso = self.byte();
        let prima = self.visti.swap(adesso, Ordering::Relaxed);
        if adesso > prima {
            self.servizi.memoria().rispetta();
            self.visti.store(self.byte(), Ordering::Relaxed);
        }
    }
}

/// Il motore dei fogli come lo vede il processo: il `Pigro`, i servizi in cui
/// nasce e il conto delle istanze aperte.
pub struct Fogli {
    pigro: Arc<Pigro<MotoreFogli>>,
    servizi: Arc<Servizi>,
    aperte: AtomicUsize,
}

impl Fogli {
    /// Il motore dei fogli del processo, sui servizi del processo e iscritto
    /// nel suo registro. La prima chiamata iscrive; nessuna costruisce il
    /// motore.
    pub fn processo() -> Arc<Fogli> {
        static PROCESSO: OnceLock<Arc<Fogli>> = OnceLock::new();
        Arc::clone(PROCESSO.get_or_init(|| {
            let fogli = Fogli::nuovi(Servizi::processo());
            if let Err(errore) = fogli.iscrivi(&Motori::processo()) {
                tracing::warn!(%errore, "fub-format-xlsx: il motore dei fogli non è iscritto nel registro");
            }
            fogli
        }))
    }

    /// Un motore dei fogli separato da quello del processo, sui servizi
    /// dati: per le prove, che lo danno al provider con
    /// [`crate::grid::XlsxGridProvider::con_fogli`]. Non lo iscrive in nessun
    /// registro e non lo costruisce.
    #[doc(hidden)]
    pub fn nuovi(servizi: Arc<Servizi>) -> Arc<Fogli> {
        Arc::new(Fogli {
            pigro: Arc::new(Pigro::nuovo(MotoreFogli::crea)),
            servizi,
            aperte: AtomicUsize::new(0),
        })
    }

    /// Iscrive il motore in `motori` con lo spazio [`SPAZIO`] e le estensioni
    /// del formato.
    pub fn iscrivi(self: &Arc<Self>, motori: &Motori) -> Result<(), ErroreMotore> {
        motori.registra(SPAZIO, &EXTENSIONS, Arc::clone(self) as Arc<dyn Voce>)
    }

    /// I servizi su cui il motore nasce.
    pub fn servizi(&self) -> &Arc<Servizi> {
        &self.servizi
    }

    /// Il motore, costruito adesso se non c'è.
    pub fn motore(&self) -> Result<Arc<MotoreFogli>, ErroreMotore> {
        self.pigro.prendi(&self.servizi)
    }

    /// Il motore se c'è già, senza costruirlo.
    pub fn se_acceso(&self) -> Option<Arc<MotoreFogli>> {
        self.pigro.se_acceso()
    }

    /// Quante istanze della griglia sono aperte sul motore.
    pub fn aperte(&self) -> usize {
        self.aperte.load(Ordering::SeqCst)
    }

    /// Una presa sul motore per un'istanza aperta.
    pub(crate) fn prendi(self: &Arc<Self>, motore: Arc<MotoreFogli>) -> Presa {
        self.aperte.fetch_add(1, Ordering::SeqCst);
        Presa {
            fogli: Arc::clone(self),
            motore,
        }
    }

    /// Un'istanza si è chiusa: il budget rispetta il tetto.
    pub(crate) fn chiusa(&self) {
        self.servizi.memoria().rispetta();
    }

    /// L'ultima istanza si è chiusa: le cache si svuotano e la memoria torna
    /// al sistema. Il motore resta, finché il budget non lo libera.
    fn chiusa_l_ultima(&self, motore: &MotoreFogli) {
        motore.svuota();
        rilascia_al_sistema();
    }
}

impl Voce for Fogli {
    fn acceso(&self) -> bool {
        self.pigro.acceso()
    }

    fn scalda(&self, servizi: &Arc<Servizi>) {
        self.pigro.scalda(Arc::clone(servizi));
    }

    fn svuota(&self) -> u64 {
        self.se_acceso().map_or(0, |motore| motore.svuota())
    }

    /// Spegne il motore, con le cache vuote. Le istanze aperte tengono il
    /// loro: se ne va con l'ultima.
    fn libera(&self) -> bool {
        if let Some(motore) = self.se_acceso() {
            motore.svuota();
        }
        self.pigro.libera()
    }

    fn byte(&self) -> u64 {
        self.se_acceso().map_or(0, |motore| motore.byte())
    }
}

/// La presa di un'istanza aperta sul motore: tiene vivo il motore e conta
/// l'istanza. Quando cade l'ultima, le cache si svuotano.
pub(crate) struct Presa {
    fogli: Arc<Fogli>,
    motore: Arc<MotoreFogli>,
}

impl Presa {
    pub(crate) fn motore(&self) -> &MotoreFogli {
        &self.motore
    }
}

impl Drop for Presa {
    fn drop(&mut self) {
        if self.fogli.aperte.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.fogli.chiusa_l_ultima(&self.motore);
        }
    }
}
