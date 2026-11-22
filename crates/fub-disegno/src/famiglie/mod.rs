//! Le famiglie del Disegno completo (piano K6, `docs/architecture/disegno-completo.md`):
//! le 26 famiglie della mappa (`crates/fub-disegno/mappa.tsv`), ognuna con il
//! suo stato pigro.
//!
//! - **La mappa** si legge una volta sola ([`righe`]), dalle righe del motore,
//!   degli effetti e degli strumenti: id, famiglia e stato. Le righe
//!   dell'interfaccia e dei pannelli non hanno stato in Rust.
//! - **Lo stato di una famiglia** sta in un [`Pigro`] dello strato dei motori,
//!   dentro [`Famiglie`]: nasce alla prima chiamata della famiglia, o con
//!   `disegno.famiglia.prepara`, mai prima. Nato, si iscrive nel `Budget` dei
//!   servizi come una cache, `disegno.<famiglia>`: i suoi byte sono quelli
//!   delle tabelle del motore che la famiglia fa crescere (patch 0008), e
//!   liberarlo svuota le tabelle e lo rimette da nascere. Un comando che gira
//!   tiene il suo `Arc`: la famiglia liberata intanto cade dopo di lui.
//! - **Ogni famiglia ha il suo file**, `famiglie/<id>.rs`, con lo stato
//!   ([`StatoFamiglia`]): il task della famiglia lo riempie senza toccare
//!   questo modulo.
//! - **Un comando `disegno.<id>`** ([`esegui`]) prepara la sua famiglia, gira
//!   nella sessione del motore sulla selezione e passa per la differenza: rende
//!   le operazioni, o la lettura di un comando che non cambia il documento.
//!   [`Filtro::Fatte`] accetta solo le righe «fatto» della mappa;
//!   [`Filtro::Tutte`] anche le altre, ed esiste solo per le prove.
//! - **Preparare** ([`Famiglie::prepara`]) avvia la nascita in sottofondo
//!   (`Lavori::in_sottofondo`) e risponde subito; una seconda richiesta mentre
//!   il lavoro gira si unisce a lui. Spegnere le famiglie
//!   ([`Famiglie::spegni`]) le libera tutte e alza il numero di giro: l'esito
//!   di un lavoro di un giro passato si butta.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock, PoisonError, Weak};
use std::time::{Duration, Instant};

use fub_abi::{
    DrawingCommandRequest, DrawingDisabledReason, DrawingOutcome, DrawingRefusal, PluginError,
    Text, MAX_DRAWING_OPS_BYTES,
};
use fub_motori::{Cache, ErroreMotore, Pigro, Servizi};
use serde_json::Value;
use vectorcraft_doc::{NodeId, Selection};
use vectorcraft_engine::EngineError;

use crate::apertura::Copia;
use crate::differenza;
use crate::gesti::{esito_vuoto, selezione_di_fub, Banco};

/// Il prefisso dei comandi del disegno; dopo c'è l'id del motore.
pub const PREFISSO: &str = "disegno.";

/// La mappa, letta dal sorgente: le righe e le colonne sono quelle che la
/// guardia `check-disegno-mappa.mjs` controlla.
const MAPPA: &str = include_str!("../../mappa.tsv");

/// Lo stato di una famiglia, nel suo file `famiglie/<id>.rs`.
///
/// Nasce alla prima chiamata della famiglia ([`StatoFamiglia::nasce`]);
/// [`StatoFamiglia::byte`] e [`StatoFamiglia::libera`] sono quelli della sua
/// cache nel `Budget`. Le altre funzioni hanno un comportamento di serie che
/// la famiglia cambia quando le serve.
pub(crate) trait StatoFamiglia: Send + Sync + 'static {
    /// Lo stato appena nato. Un errore lascia la famiglia da nascere: la
    /// chiamata dopo riprova.
    fn nasce(servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore>
    where
        Self: Sized;

    /// Quanti byte tiene adesso la famiglia (le sue tabelle e cache).
    fn byte(&self) -> u64;

    /// Svuota ciò che si può svuotare e dice quanti byte se ne sono andati.
    fn libera(&self) -> u64;

    /// Gli argomenti del comando `id` (del motore, senza prefisso) come li
    /// vuole il motore. Di serie restano come sono.
    fn adatta(&self, _id: &str, argomenti: Value) -> Result<Value, PluginError> {
        Ok(argomenti)
    }

    /// La lettura di un comando che non cambia il documento, nella forma di
    /// `DrawingOutcome.reading`. Di serie è il risultato del motore.
    fn lettura(&self, _id: &str, risultato: Value) -> Value {
        risultato
    }

    /// Perché il comando `id` è spento sulla copia e sulla selezione date, o
    /// `None` se è acceso. Non fa nascere la famiglia; di serie è acceso.
    fn spento(_id: &str, _copia: &Copia, _selezione: &[String]) -> Option<DrawingDisabledReason>
    where
        Self: Sized,
    {
        None
    }
}

/// Le 26 famiglie, nell'ordine di `fub_abi::DRAWING_FAMILIES`: per ognuna la
/// variante, il modulo e il nome nella mappa.
macro_rules! famiglie {
    ($($variante:ident, $modulo:ident, $nome:literal;)*) => {
        $(mod $modulo;)*

        /// Una famiglia della mappa.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum Famiglia {
            $(#[doc = concat!("`", $nome, "`")] $variante,)*
        }

        impl Famiglia {
            /// Tutte, nell'ordine della mappa e del contratto.
            pub const TUTTE: [Famiglia; 26] = [$(Famiglia::$variante,)*];

            /// Il nome nella mappa e nel contratto.
            pub fn nome(self) -> &'static str {
                match self {
                    $(Famiglia::$variante => $nome,)*
                }
            }

            /// Lo stato appena nato della famiglia.
            fn nasce(self, servizi: &Arc<Servizi>) -> Result<Box<dyn StatoFamiglia>, ErroreMotore> {
                match self {
                    $(Famiglia::$variante => Ok(Box::new(
                        <$modulo::Stato as StatoFamiglia>::nasce(servizi)?,
                    )),)*
                }
            }

            /// Perché il comando `id` della famiglia è spento.
            fn spento(
                self,
                id: &str,
                copia: &Copia,
                selezione: &[String],
            ) -> Option<DrawingDisabledReason> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::spento(id, copia, selezione)
                    })*
                }
            }
        }

        /// Un `Pigro` per famiglia, nello stesso ordine.
        fn caselle() -> [Pigro<Nata>; 26] {
            [$(Pigro::nuovo(|servizi: &Arc<Servizi>| Nata::nuova(Famiglia::$variante, servizi)),)*]
        }
    };
}

/// L'inchiostro di Fub e gli strumenti dei tracciati (T12): il ponte lo
/// chiede a ogni `commit`.
pub(crate) use tracciati::inchiostro_toccato;

famiglie! {
    Aspetto, aspetto, "aspetto";
    Automazione, automazione, "automazione";
    Colore, colore, "colore";
    Dati, dati, "dati";
    Dinamici, dinamici, "dinamici";
    Effetti, effetti, "effetti";
    Formati, formati, "formati";
    Forme, forme, "forme";
    Grafici, grafici, "grafici";
    Immagini, immagini, "immagini";
    Livelli, livelli, "livelli";
    Nucleo, nucleo, "nucleo";
    Pennelli, pennelli, "pennelli";
    Prospettiva, prospettiva, "prospettiva";
    Pulizia, pulizia, "pulizia";
    Raster, raster, "raster";
    Simboli, simboli, "simboli";
    Stampa, stampa, "stampa";
    Tavole, tavole, "tavole";
    Testo, testo, "testo";
    Tracciati, tracciati, "tracciati";
    Trame, trame, "trame";
    Trasforma, trasforma, "trasforma";
    TreD, tre_d, "tre-d";
    Vista, vista, "vista";
    Web, web, "web";
}

impl Famiglia {
    /// La famiglia con questo nome, se la mappa la conosce.
    pub fn da_nome(nome: &str) -> Option<Famiglia> {
        Famiglia::TUTTE.into_iter().find(|f| f.nome() == nome)
    }

    fn indice(self) -> usize {
        self as usize
    }
}

// ---------------------------------------------------------------------------
// La mappa
// ---------------------------------------------------------------------------

/// Da dove viene una riga della mappa (la colonna `fonte`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Fonte {
    /// Un comando del motore.
    Motore,
    /// Un effetto.
    Effetto,
    /// Uno strumento.
    Strumento,
}

/// A che punto è una riga della mappa (la colonna `stato`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatoRiga {
    /// Ha il suo caso: si raggiunge e fa ciò che fa nel motore.
    Fatto,
    /// Ancora da fare.
    DaFare,
    /// La serve già una funzione di Fub.
    Fub,
    /// Fub non la offre.
    Escluso,
}

/// Una riga della mappa del motore, degli effetti o degli strumenti.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Riga {
    pub fonte: Fonte,
    pub id: String,
    /// La colonna `famiglia` come la scrive la mappa (anche `fub` o
    /// `escluso`, che non sono famiglie).
    pub nome_famiglia: String,
    /// La famiglia, se la colonna ne nomina una.
    pub famiglia: Option<Famiglia>,
    pub stato: StatoRiga,
    /// La feature del motore dietro cui sta, per le righe `sotto:<feature>`
    /// della colonna `pigro` (formati, plug-in, script: fuori da `completo`).
    pub sotto: Option<String>,
}

/// La mappa letta: le righe in ordine e l'indice per fonte e id.
struct Mappa {
    righe: Vec<Riga>,
    indice: HashMap<(Fonte, String), usize>,
}

/// Le righe della mappa che hanno stato in Rust, lette una volta sola.
///
/// # Panics
///
/// Se la mappa compilata non ha le colonne attese o ha uno stato che non
/// conosce: la guardia della mappa e la prova di questo modulo lo vedono
/// prima.
pub fn righe() -> &'static [Riga] {
    &mappa().righe
}

fn mappa() -> &'static Mappa {
    static MAPPA_LETTA: OnceLock<Mappa> = OnceLock::new();
    MAPPA_LETTA.get_or_init(|| leggi(MAPPA).expect("la mappa compilata si legge"))
}

/// Legge il testo della mappa.
fn leggi(testo: &str) -> Result<Mappa, String> {
    let mut linee = testo.lines().filter(|l| !l.starts_with('#'));
    let testa: Vec<&str> = linee
        .next()
        .ok_or("la mappa non ha l'intestazione")?
        .split('\t')
        .collect();
    let colonna = |nome: &str| {
        testa
            .iter()
            .position(|c| *c == nome)
            .ok_or_else(|| format!("la mappa non ha la colonna `{nome}`"))
    };
    let (c_fonte, c_id, c_famiglia, c_stato, c_pigro) = (
        colonna("fonte")?,
        colonna("id")?,
        colonna("famiglia")?,
        colonna("stato")?,
        colonna("pigro")?,
    );
    let mut righe = Vec::new();
    let mut indice = HashMap::new();
    for (n, linea) in linee.enumerate() {
        if linea.is_empty() {
            continue;
        }
        let celle: Vec<&str> = linea.split('\t').collect();
        let cella = |c: usize| {
            celle
                .get(c)
                .copied()
                .ok_or_else(|| format!("la riga {} della mappa è corta", n + 3))
        };
        let fonte = match cella(c_fonte)? {
            "motore" => Fonte::Motore,
            "effetto" => Fonte::Effetto,
            "strumento" => Fonte::Strumento,
            // L'interfaccia e i pannelli non hanno stato in Rust.
            _ => continue,
        };
        let stato = match cella(c_stato)? {
            "fatto" => StatoRiga::Fatto,
            "da fare" => StatoRiga::DaFare,
            "fub" => StatoRiga::Fub,
            "escluso" => StatoRiga::Escluso,
            altro => {
                return Err(format!(
                    "la riga {} della mappa ha lo stato `{altro}`",
                    n + 3
                ))
            }
        };
        let nome_famiglia = cella(c_famiglia)?.to_string();
        let riga = Riga {
            fonte,
            id: cella(c_id)?.to_string(),
            famiglia: Famiglia::da_nome(&nome_famiglia),
            nome_famiglia,
            stato,
            sotto: cella(c_pigro)?.strip_prefix("sotto:").map(str::to_string),
        };
        indice.insert((fonte, riga.id.clone()), righe.len());
        righe.push(riga);
    }
    Ok(Mappa { righe, indice })
}

/// La riga di `id` per la fonte data.
pub fn riga(fonte: Fonte, id: &str) -> Option<&'static Riga> {
    let mappa = mappa();
    mappa
        .indice
        .get(&(fonte, id.to_string()))
        .map(|&i| &mappa.righe[i])
}

/// La famiglia di `id`: di un comando del motore, se no di un effetto, se no
/// di uno strumento.
pub fn famiglia_di(id: &str) -> Option<Famiglia> {
    [Fonte::Motore, Fonte::Effetto, Fonte::Strumento]
        .into_iter()
        .find_map(|fonte| riga(fonte, id))
        .and_then(|r| r.famiglia)
}

/// Quali righe della mappa si eseguono.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Filtro {
    /// Solo le righe «fatto»: quelle che l'IPC raggiunge.
    #[default]
    Fatte,
    /// Anche quelle da fare: solo per le prove, l'IPC non lo accende.
    Tutte,
}

// ---------------------------------------------------------------------------
// Le tabelle del motore
// ---------------------------------------------------------------------------

/// I byte delle tabelle del motore nominate (`vectorcraft_engine::tables`,
/// patch 0008). Un nome che il motore non ha conta zero: la prova del modulo
/// lo vede.
pub(crate) fn byte_delle_tabelle(nomi: &[&str]) -> u64 {
    vectorcraft_engine::tables::tables()
        .iter()
        .filter(|t| nomi.contains(&t.name))
        .map(|t| (t.bytes)() as u64)
        .sum()
}

/// Svuota le tabelle nominate che si possono svuotare; dice quanti byte se
/// ne sono andati.
pub(crate) fn libera_le_tabelle(nomi: &[&str]) -> u64 {
    let prima = byte_delle_tabelle(nomi);
    for t in vectorcraft_engine::tables::tables() {
        if let (true, Some(svuota)) = (nomi.contains(&t.name), t.release) {
            let _ = vectorcraft_engine::guard::catch_panic(svuota);
        }
    }
    prima.saturating_sub(byte_delle_tabelle(nomi))
}

// ---------------------------------------------------------------------------
// Lo stato nato e il suo Budget
// ---------------------------------------------------------------------------

/// Lo stato nato di una famiglia: la cache che si iscrive nel `Budget`.
pub struct Nata {
    famiglia: Famiglia,
    nome: String,
    stato: Box<dyn StatoFamiglia>,
    ultimo_uso: Mutex<Instant>,
    /// Le famiglie che la tengono, per tornare da nascere quando il `Budget`
    /// la libera.
    casa: OnceLock<Weak<Famiglie>>,
    /// Vero dopo l'iscrizione nel `Budget`.
    iscritta: AtomicBool,
}

impl Nata {
    fn nuova(famiglia: Famiglia, servizi: &Arc<Servizi>) -> Result<Nata, ErroreMotore> {
        Ok(Nata {
            famiglia,
            nome: format!("disegno.{}", famiglia.nome()),
            stato: famiglia.nasce(servizi)?,
            ultimo_uso: Mutex::new(Instant::now()),
            casa: OnceLock::new(),
            iscritta: AtomicBool::new(false),
        })
    }

    /// La famiglia di questo stato.
    pub fn famiglia(&self) -> Famiglia {
        self.famiglia
    }

    /// Lo stato della famiglia.
    pub(crate) fn stato(&self) -> &dyn StatoFamiglia {
        self.stato.as_ref()
    }

    fn usata(&self) {
        *self
            .ultimo_uso
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }
}

impl Cache for Nata {
    fn nome(&self) -> &str {
        &self.nome
    }

    fn byte(&self) -> u64 {
        self.stato.byte()
    }

    /// Svuota lo stato e lo rimette da nascere. Chi tiene ancora un `Arc`
    /// (un comando che gira) lo tiene vivo fino alla sua fine.
    fn libera(&self, _quanto: u64) -> u64 {
        let reso = self.stato.libera();
        if let Some(casa) = self.casa.get().and_then(Weak::upgrade) {
            casa.dimentica(self);
        }
        reso
    }

    fn ultimo_uso(&self) -> Instant {
        *self
            .ultimo_uso
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Che cosa ha fatto [`Famiglie::prepara`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preparazione {
    /// La famiglia è già nata.
    Pronta,
    /// La famiglia nasce in sottofondo (avviata adesso o già in corso).
    InCorso,
    /// Il `Budget` non ha memoria per farla nascere.
    NoMemory,
}

impl Preparazione {
    /// Il nome nella lettura di `disegno.famiglia.prepara`.
    pub fn nome(self) -> &'static str {
        match self {
            Preparazione::Pronta => "pronta",
            Preparazione::InCorso => "in-corso",
            Preparazione::NoMemory => "no-memory",
        }
    }
}

/// I lavori di preparazione, sotto il lucchetto di [`Famiglie`].
#[derive(Default)]
struct Preparazioni {
    /// Le famiglie che nascono in sottofondo adesso.
    in_corso: [bool; 26],
    /// L'errore dell'ultimo lavoro fallito, dato una volta sola alla
    /// richiesta dopo.
    fallite: [Option<String>; 26],
}

/// Gli stati delle 26 famiglie di un motore del disegno.
pub struct Famiglie {
    servizi: Arc<Servizi>,
    caselle: [Pigro<Nata>; 26],
    /// Il numero di giro: sale a ogni [`Famiglie::spegni`].
    giro: AtomicU64,
    preparazioni: Mutex<Preparazioni>,
    finito: Condvar,
    lavori: AtomicUsize,
    nascite: [AtomicUsize; 26],
}

impl Famiglie {
    /// Le famiglie, tutte da nascere, sui servizi dati.
    pub fn nuove(servizi: Arc<Servizi>) -> Arc<Famiglie> {
        Arc::new(Famiglie {
            servizi,
            caselle: caselle(),
            giro: AtomicU64::new(0),
            preparazioni: Mutex::default(),
            finito: Condvar::new(),
            lavori: AtomicUsize::new(0),
            nascite: Default::default(),
        })
    }

    fn casella(&self, famiglia: Famiglia) -> &Pigro<Nata> {
        &self.caselle[famiglia.indice()]
    }

    fn preparazioni(&self) -> std::sync::MutexGuard<'_, Preparazioni> {
        self.preparazioni
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Lo stato della famiglia, che nasce adesso se non c'è. Durante una
    /// nascita avviata da altri (un lavoro di preparazione) aspetta quella.
    pub fn prendi(self: &Arc<Self>, famiglia: Famiglia) -> Result<Arc<Nata>, ErroreMotore> {
        let nata = self.casella(famiglia).prendi(&self.servizi)?;
        self.iscrivi(&nata);
        nata.usata();
        Ok(nata)
    }

    /// Iscrive nel `Budget` uno stato appena nato, una volta sola.
    fn iscrivi(self: &Arc<Self>, nata: &Arc<Nata>) {
        if nata.iscritta.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = nata.casa.set(Arc::downgrade(self));
        self.nascite[nata.famiglia.indice()].fetch_add(1, Ordering::SeqCst);
        let cache: Arc<dyn Cache> = Arc::clone(nata) as Arc<dyn Cache>;
        self.servizi.memoria().registra(&cache);
    }

    /// Rimette da nascere la famiglia di `nata`, se è ancora lei a tenere la
    /// casella: una famiglia rinata intanto resta com'è.
    fn dimentica(&self, nata: &Nata) {
        let casella = self.casella(nata.famiglia);
        let sua = casella
            .se_acceso()
            .is_some_and(|attuale| std::ptr::eq(Arc::as_ptr(&attuale), nata));
        if sua {
            casella.libera();
        }
    }

    /// Lo stato della famiglia se è nato, senza farlo nascere.
    pub fn se_nata(&self, famiglia: Famiglia) -> Option<Arc<Nata>> {
        self.casella(famiglia).se_acceso()
    }

    /// Le famiglie nate adesso.
    pub fn nate(&self) -> Vec<Famiglia> {
        Famiglia::TUTTE
            .into_iter()
            .filter(|f| self.casella(*f).acceso())
            .collect()
    }

    /// I byte delle famiglie nate.
    pub fn byte(&self) -> u64 {
        Famiglia::TUTTE
            .into_iter()
            .filter_map(|f| self.se_nata(f))
            .map(|nata| nata.byte())
            .sum()
    }

    /// Vero se il `Budget` ha posto per una famiglia che nasce: prima libera
    /// ciò che può, poi guarda se sta sotto il tetto.
    fn c_e_memoria(&self) -> bool {
        let conto = self.servizi.memoria().rispetta();
        conto.saltato || conto.dopo <= conto.tetto
    }

    /// Lo stato della famiglia per un comando: quello nato, o uno che nasce
    /// adesso se il `Budget` ha memoria. `Ok(None)` vuol dire `NoMemory`.
    pub fn per_un_comando(
        self: &Arc<Self>,
        famiglia: Famiglia,
    ) -> Result<Option<Arc<Nata>>, ErroreMotore> {
        if let Some(nata) = self.se_nata(famiglia) {
            nata.usata();
            return Ok(Some(nata));
        }
        // Una preparazione in corso ha già guardato la memoria: ci si unisce.
        let in_corso = self.preparazioni().in_corso[famiglia.indice()];
        if !in_corso && !self.c_e_memoria() {
            return Ok(None);
        }
        self.prendi(famiglia).map(Some)
    }

    /// Prepara la famiglia: avvia la sua nascita in sottofondo e risponde
    /// subito. Una famiglia già nata è pronta; una che nasce già si unisce a
    /// quel lavoro; un lavoro precedente fallito dà il suo errore, una volta.
    pub fn prepara(self: &Arc<Self>, famiglia: Famiglia) -> Result<Preparazione, PluginError> {
        if self.casella(famiglia).acceso() {
            return Ok(Preparazione::Pronta);
        }
        let i = famiglia.indice();
        {
            let mut preparazioni = self.preparazioni();
            if preparazioni.in_corso[i] {
                return Ok(Preparazione::InCorso);
            }
            if let Some(errore) = preparazioni.fallite[i].take() {
                return Err(PluginError::Internal(errore.into()));
            }
        }
        // Il `Budget` libera senza il lucchetto delle preparazioni: le cache
        // che libera possono essere famiglie.
        if !self.c_e_memoria() {
            return Ok(Preparazione::NoMemory);
        }
        {
            let mut preparazioni = self.preparazioni();
            if preparazioni.in_corso[i] {
                return Ok(Preparazione::InCorso);
            }
            preparazioni.in_corso[i] = true;
        }
        self.lavori.fetch_add(1, Ordering::SeqCst);
        // Il lavoro porta con sé la sua fine: anche se non parte, o va in
        // panico, la famiglia non resta «in corso».
        let fine = FineDelLavoro {
            famiglie: Arc::clone(self),
            famiglia,
        };
        let giro = self.giro.load(Ordering::SeqCst);
        self.servizi.lavori().in_sottofondo(move || {
            let famiglie = &fine.famiglie;
            match famiglie.casella(famiglia).prendi(&famiglie.servizi) {
                Ok(nata) if famiglie.giro.load(Ordering::SeqCst) == giro => {
                    famiglie.iscrivi(&nata);
                }
                Ok(nata) => {
                    // Spente mentre nasceva: l'esito si butta.
                    famiglie.dimentica(&nata);
                }
                Err(errore) if famiglie.giro.load(Ordering::SeqCst) == giro => {
                    // Il motivo arriva alla richiesta dopo, una volta.
                    famiglie.preparazioni().fallite[famiglia.indice()] = Some(errore.to_string());
                }
                Err(_) => {}
            }
            drop(fine);
        });
        Ok(Preparazione::InCorso)
    }

    /// Libera ogni famiglia nata: tornano da nascere e lasciano il `Budget`
    /// quando cade l'ultimo `Arc`. Dice quanti byte se ne sono andati.
    pub fn libera_tutte(&self) -> u64 {
        Famiglia::TUTTE
            .into_iter()
            .filter_map(|f| self.se_nata(f))
            .map(|nata| Cache::libera(nata.as_ref(), u64::MAX))
            .sum()
    }

    /// Il componente si spegne: un nuovo giro, così che l'esito dei lavori
    /// in corso si butti, e ogni famiglia si libera.
    pub fn spegni(&self) -> u64 {
        self.giro.fetch_add(1, Ordering::SeqCst);
        self.libera_tutte()
    }

    /// Quanti lavori di preparazione sono partiti (per le prove).
    #[doc(hidden)]
    pub fn lavori_avviati(&self) -> usize {
        self.lavori.load(Ordering::SeqCst)
    }

    /// Quante volte la famiglia è nata (per le prove).
    #[doc(hidden)]
    pub fn nascite(&self, famiglia: Famiglia) -> usize {
        self.nascite[famiglia.indice()].load(Ordering::SeqCst)
    }

    /// Aspetta, fino a `massimo`, che nessuna famiglia stia nascendo in
    /// sottofondo; vero se è così (per le prove).
    #[doc(hidden)]
    pub fn aspetta_i_lavori(&self, massimo: Duration) -> bool {
        let preparazioni = self.preparazioni();
        let (preparazioni, _) = self
            .finito
            .wait_timeout_while(preparazioni, massimo, |p| p.in_corso.iter().any(|x| *x))
            .unwrap_or_else(PoisonError::into_inner);
        !preparazioni.in_corso.iter().any(|x| *x)
    }
}

/// La fine di un lavoro di preparazione, quando cade.
struct FineDelLavoro {
    famiglie: Arc<Famiglie>,
    famiglia: Famiglia,
}

impl Drop for FineDelLavoro {
    fn drop(&mut self) {
        self.famiglie.preparazioni().in_corso[self.famiglia.indice()] = false;
        self.famiglie.finito.notify_all();
    }
}

// ---------------------------------------------------------------------------
// I comandi
// ---------------------------------------------------------------------------

/// Il messaggio di una riga che il filtro non lascia passare.
fn non_fatta() -> PluginError {
    PluginError::Unserved(Text::key("host.drawing.not_done"))
}

/// La riga del comando `disegno.<id>` che il filtro lascia passare, con la
/// sua famiglia; `Ok(None)` per un id che il motore non serve qui.
fn riga_del_comando(
    id: &str,
    filtro: Filtro,
) -> Result<Option<(&'static Riga, Famiglia)>, PluginError> {
    let Some(riga) = id
        .strip_prefix(PREFISSO)
        .and_then(|id| riga(Fonte::Motore, id))
    else {
        return Ok(None);
    };
    let Some(famiglia) = riga.famiglia else {
        return Ok(None);
    };
    match riga.stato {
        StatoRiga::Fub | StatoRiga::Escluso => return Ok(None),
        // Le righe dietro una feature del motore che `completo` non accende.
        _ if riga.sotto.is_some() => return Ok(None),
        StatoRiga::DaFare if filtro == Filtro::Fatte => return Err(non_fatta()),
        StatoRiga::Fatto | StatoRiga::DaFare => {}
    }
    Ok(Some((riga, famiglia)))
}

/// Le righe «fatto» del motore, come comandi del disegno accesi o spenti
/// sulla selezione. Nessuna famiglia nasce per dirlo.
pub(crate) fn elenco(copia: &Copia, selezione: &[String]) -> Vec<fub_abi::DrawingCommandInfo> {
    righe()
        .iter()
        .filter(|r| r.fonte == Fonte::Motore && r.stato == StatoRiga::Fatto && r.sotto.is_none())
        .filter_map(|r| {
            let famiglia = r.famiglia?;
            let perche = famiglia.spento(&r.id, copia, selezione);
            Some(fub_abi::DrawingCommandInfo {
                id: format!("{PREFISSO}{}", r.id),
                enabled: perche.is_none(),
                disabled_reason: perche,
            })
        })
        .collect()
}

/// Esegue il comando `disegno.<id>` della richiesta: prepara la sua
/// famiglia, lo fa girare nella sessione del motore sulla selezione e passa
/// per la differenza. Le operazioni, se il documento cambia; la lettura, se
/// il comando non va nella cronologia del motore e rende un valore; se no
/// `empty`. Un id che il motore non serve qui è `unsupported`, uno che il
/// filtro non lascia passare `Unserved`, argomenti che il motore rifiuta
/// `BadArgs`.
pub(crate) fn esegui(
    famiglie: &Arc<Famiglie>,
    filtro: Filtro,
    banco: &mut Banco,
    copia: &Copia,
    richiesta: &DrawingCommandRequest,
) -> Result<DrawingOutcome, PluginError> {
    let rifiuta = |r: DrawingRefusal| DrawingOutcome {
        refused: Some(r),
        ..esito_vuoto(richiesta.revision)
    };
    let Some((riga, famiglia)) = riga_del_comando(&richiesta.id, filtro)? else {
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    };
    let nata = match famiglie.per_un_comando(famiglia) {
        Ok(Some(nata)) => nata,
        Ok(None) => return Ok(rifiuta(DrawingRefusal::NoMemory)),
        Err(errore) => return Err(PluginError::Internal(errore.to_string().into())),
    };
    if !copia.modificabile {
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    }
    let scelti = match nodi_scelti(copia, &richiesta.selection) {
        Ok(scelti) => scelti,
        Err(r) => return Ok(rifiuta(r)),
    };
    // I punti scelti di un comando sui punti (T12): tolti dal valore, vanno
    // nella selezione del motore.
    let mut valore = richiesta.value.clone();
    let punti = if famiglia == Famiglia::Tracciati
        && tracciati::SUI_PUNTI.contains(&riga.id.as_str())
    {
        if tracciati::sceglie_inchiostro(copia, &richiesta.selection) {
            return Ok(rifiuta(DrawingRefusal::Unmapped));
        }
        match tracciati::punti(copia, &mut valore) {
            Ok(punti) => punti,
            Err(tracciati::Rifiuto::Motore(r)) => return Ok(rifiuta(r)),
            Err(tracciati::Rifiuto::Argomenti(m)) => return Err(PluginError::BadArgs(m.into())),
        }
    } else {
        Default::default()
    };
    let argomenti = nata.stato().adatta(&riga.id, valore)?;
    // Un gesto lasciato a metà non entra nel comando.
    if banco.in_corso.is_some() {
        banco.ripristina(copia);
    }
    let sessione = &mut banco.sessione;
    let fatto = vectorcraft_engine::guard::catch_panic(|| {
        // Il comando cambia anche lo stile delle forme nuove: quello della
        // sessione resta com'era.
        let stile = sessione.paint.clone();
        let fatto = sessione.doc_mut().map(|stato| {
            stato.selection = Selection::default();
            scelti.iter().for_each(|n| stato.selection.add(*n));
            for (n, set) in &punti {
                if !stato.selection.objects.contains(n) {
                    stato.selection.add(*n);
                }
                stato.selection.anchors.insert(*n, set.clone());
            }
        });
        let fatto = fatto.and_then(|()| sessione.execute(&riga.id, &argomenti));
        sessione.paint = stile;
        fatto
    });
    let risultato = match fatto {
        Ok(Ok(risultato)) => risultato,
        Ok(Err(EngineError::BadParams { msg, .. })) => {
            banco.ripristina(copia);
            return Err(PluginError::BadArgs(msg.into()));
        }
        Ok(Err(EngineError::Disabled(..))) => {
            banco.ripristina(copia);
            return Ok(rifiuta(DrawingRefusal::Empty));
        }
        // Il motore rifiuta il comando qui (nessun documento, un oggetto
        // che non c'è, un errore suo): `unsupported`, e niente cambia.
        Ok(Err(_)) => {
            banco.ripristina(copia);
            return Ok(rifiuta(DrawingRefusal::Unsupported));
        }
        Err(_panico) => {
            banco.ripristina(copia);
            return Ok(rifiuta(DrawingRefusal::Unsupported));
        }
    };
    let Some(dopo) = banco.documento() else {
        banco.ripristina(copia);
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    };
    let selezione: Vec<NodeId> = banco
        .sessione
        .doc()
        .map(|d| d.selection.objects.clone())
        .unwrap_or_default();
    let differenza =
        vectorcraft_engine::guard::catch_panic(|| differenza::differenza(copia, &dopo, None, None));
    banco.ripristina(copia);
    let differenza = match differenza {
        Ok(Ok(d)) => d,
        Ok(Err(r)) => return Ok(rifiuta(r.rifiuto())),
        Err(_) => return Ok(rifiuta(DrawingRefusal::Unsupported)),
    };
    let mut esito = esito_vuoto(richiesta.revision);
    match differenza.testo() {
        Ok(Some(ops)) => {
            esito.selection = selezione_di_fub(copia, &differenza, &selezione);
            esito.ops = Some(ops);
        }
        // Il documento non cambia ma la selezione sì (`select.all`,
        // `select.inverse`…): l'esito porta la selezione nuova, senza
        // operazioni e senza un passo della cronologia.
        Ok(None) if selezione != scelti => {
            esito.selection = selezione_di_fub(copia, &differenza, &selezione);
        }
        Ok(None) => {
            let legge = vectorcraft_engine::find_command(&riga.id).is_some_and(|c| !c.journal);
            if !legge || risultato.is_null() {
                return Ok(rifiuta(DrawingRefusal::Empty));
            }
            let lettura = nata.stato().lettura(&riga.id, risultato);
            let byte = serde_json::to_vec(&lettura).map_or(usize::MAX, |b| b.len());
            if byte > MAX_DRAWING_OPS_BYTES {
                return Ok(rifiuta(DrawingRefusal::TooLarge));
            }
            esito.selection = richiesta.selection.clone();
            esito.reading = Some(lettura);
        }
        Err(r) => return Ok(rifiuta(r.rifiuto())),
    }
    // Lo stato della famiglia resta vivo fino a qui, anche se il `Budget`
    // lo ha liberato intanto.
    drop(nata);
    Ok(esito)
}

/// Gli oggetti del motore della selezione di Fub: un id che la mappa non ha,
/// o che il motore non sa modificare, è `unmapped`; uno bloccato (lui o un
/// antenato) `locked`.
fn nodi_scelti(copia: &Copia, selezione: &[String]) -> Result<Vec<NodeId>, DrawingRefusal> {
    let mappa = &copia.mappa;
    selezione
        .iter()
        .map(|id| {
            let i = mappa.dell_id(id).ok_or(DrawingRefusal::Unmapped)?;
            let nodo = mappa
                .elemento(i)
                .and_then(|e| e.nodo)
                .ok_or(DrawingRefusal::Unmapped)?;
            let mut j = Some(i);
            while let Some(e) = j.and_then(|j| mappa.elemento(j)) {
                if e.bloccato {
                    return Err(DrawingRefusal::Locked);
                }
                j = e.genitore;
            }
            Ok(nodo)
        })
        .collect()
}

/// `disegno.famiglia.prepara { famiglia }`: la lettura con lo stato della
/// preparazione, o `no_memory`. Il valore l'ha già controllato `validate()`.
pub(crate) fn prepara(
    famiglie: &Arc<Famiglie>,
    richiesta: &DrawingCommandRequest,
) -> Result<DrawingOutcome, PluginError> {
    let nome = richiesta
        .value
        .get("famiglia")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let famiglia = Famiglia::da_nome(nome)
        .ok_or_else(|| PluginError::BadArgs(format!("la famiglia `{nome}` non c'è").into()))?;
    let mut esito = esito_vuoto(richiesta.revision);
    match famiglie.prepara(famiglia)? {
        Preparazione::NoMemory => esito.refused = Some(DrawingRefusal::NoMemory),
        stato => {
            esito.reading = Some(serde_json::json!({
                "famiglia": famiglia.nome(),
                "stato": stato.nome(),
            }));
        }
    }
    Ok(esito)
}

#[cfg(test)]
mod tests;
