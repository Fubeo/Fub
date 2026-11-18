//! L'esportazione delle note in PDF: **la prova del motore** (ADR 0247).
//!
//! La strada A dell'esportazione: la pagina la compone la vista, il PDF lo
//! scrive Fub. La vista impagina la nota e misura ciò che ha disegnato: ogni
//! pezzo di testo con la sua posizione, il suo carattere e la posizione di
//! ogni lettera, i fondi e i bordi, i vettori (diagrammi, radici delle
//! formule), le immagini. Ne fa un [`ElencoPagine`] e lo passa al core, che
//! scrive il PDF con [`scrivi`]: testo vero, che si seleziona e si cerca, coi
//! caratteri incorporati in sotto-insieme, e i vettori come vettori.
//!
//! Anteprima e file coincidono perché nascono dalla stessa misura: il core non
//! va a capo e non impagina, mette ogni lettera dove la vista l'ha messa. Per
//! questo coincidono sulla macchina che esporta e non fra due macchine: due
//! sistemi possono andare a capo in punti diversi, e ognuno scrive il suo.
//!
//! È una prova e non ancora il contratto: il formato dell'elenco ha una
//! versione ([`VERSIONE`]) e i suoi limiti, ma non attraversa ancora l'IPC
//! (lo farà con `invoke_command` e un lavoro del core). Le misure e la scelta
//! stanno nell'ADR.
//!
//! # Il profilo e la memoria
//!
//! Le regolazioni dell'esportazione stanno in due posti, fuori dalla nota:
//! il [`profile`] (tema, colori, caratteri, pagina, contenuto: vale per ogni
//! nota del vault) e la [`memory`] di ogni nota (lo stile dato a un solo
//! diagramma e i blocchi lasciati fuori). Tutti e due vivono nello spazio
//! dati [`SPAZIO_DATI`]; la forma dei file è in
//! `docs/reference/pdf-export-format.md`.
//!
//! # Le unità
//!
//! Tutte le misure dell'elenco sono in pixel CSS, con l'origine in alto a
//! sinistra della pagina e la `y` verso il basso, come le misura la vista. Il
//! core le porta in punti PDF (un pixel CSS è 3/4 di punto) con una sola
//! trasformazione in testa a ogni pagina.

use std::fmt;

use serde::{Deserialize, Serialize};

mod aperta;
pub mod memory;
pub mod profile;
mod prova;
#[cfg(test)]
mod tests;

/// L'id dello spazio dati dell'esportazione: profili e memorie delle note
/// stanno sotto `.fub/plugins/fub.esporta-pdf/`.
pub const SPAZIO_DATI: &str = "fub.esporta-pdf";

pub use prova::scrivi;

/// La versione del formato dell'elenco delle pagine.
pub const VERSIONE: u32 = 1;

/// Quante pagine al più: un libro lungo ci sta, un elenco impazzito no.
pub const MAX_PAGINE: usize = 5_000;

/// Quanti pezzi al più in una pagina. Una pagina fitta di testo in corpo 9
/// ne ha qualche centinaio; il tetto è largo e ferma solo un elenco rotto.
pub const MAX_PEZZI_PAGINA: usize = 50_000;

/// Il lato più grande di una pagina, in pixel CSS: un A0 è 3179 px.
pub const MAX_LATO_PAGINA: f64 = 20_000.0;

/// Il vettore più grande, in byte del suo SVG.
pub const MAX_VETTORE_BYTE: usize = 8 * 1024 * 1024;

/// Ciò che la vista misura di una nota impaginata.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ElencoPagine {
    /// [`VERSIONE`].
    pub versione: u32,
    /// La larghezza della pagina, in pixel CSS.
    pub larghezza: f64,
    /// L'altezza della pagina, in pixel CSS.
    pub altezza: f64,
    /// Il titolo del documento, per i dati del PDF.
    #[serde(default)]
    pub titolo: String,
    /// Le facce dei caratteri che il testo usa: un pezzo di testo ne nomina
    /// una col suo indice.
    pub facce: Vec<Faccia>,
    /// Le pagine, dalla prima.
    pub pagine: Vec<Pagina>,
}

/// Una faccia di un carattere, come la vista l'ha scelta: il file da cui il
/// browser l'ha presa e il punto dei suoi assi.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Faccia {
    /// La famiglia, come la dice il CSS: serve ai messaggi.
    pub famiglia: String,
    /// Il file del carattere, come la vista lo nomina (l'URL della regola
    /// `@font-face`, o il percorso di un carattere del vault). Lo risolve chi
    /// scrive, con [`Risorse::carattere`].
    pub file: String,
    /// Il corsivo: con un file che non ha l'asse `ital` dice solo che cosa si
    /// è chiesto.
    #[serde(default)]
    pub corsivo: bool,
    /// I punti degli assi: `wght` dal peso, `opsz` dal corpo quando il
    /// browser lo fissa da sé, e ciò che `font-variation-settings` aggiunge.
    #[serde(default)]
    pub assi: Vec<Asse>,
}

/// Un punto su un asse di un carattere variabile.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Asse {
    pub tag: String,
    pub valore: f64,
}

/// Una pagina: i suoi pezzi nell'ordine in cui si disegnano.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pagina {
    pub pezzi: Vec<Pezzo>,
}

/// Un colore: rosso, verde e blu da 0 a 255, e l'opacità da 0 a 1.
pub type Colore = [f64; 4];

/// Un pezzo di una pagina.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase", deny_unknown_fields)]
pub enum Pezzo {
    /// Un pezzo di testo su una riga, in una faccia sola.
    Testo {
        /// Dove comincia la prima lettera.
        x: f64,
        /// La linea di base.
        y: f64,
        /// La larghezza del pezzo, per sottolineato e barrato.
        larghezza: f64,
        /// L'indice della faccia in [`ElencoPagine::facce`].
        faccia: usize,
        /// Il corpo, in pixel CSS.
        corpo: f64,
        colore: Colore,
        /// Il testo, come la vista lo mostra.
        testo: String,
        /// Dove comincia ogni lettera (ogni carattere Unicode), da `x`: sono
        /// le posizioni del browser, con la crenatura e la spaziatura.
        posizioni: Vec<f64>,
        #[serde(default)]
        sottolineato: bool,
        #[serde(default)]
        barrato: bool,
    },
    /// Un rettangolo pieno: un fondo, un lato di un bordo, una linea.
    Riquadro {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        colore: Colore,
    },
    /// Un disegno vettoriale, in SVG, senza testo: le sue scritte la vista le
    /// manda come [`Pezzo::Testo`].
    Vettore {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        svg: String,
    },
    /// Un'immagine, coi byte che [`Risorse::immagine`] dà per `file`.
    Immagine {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        file: String,
    },
}

/// Ciò che chi scrive deve dare: i byte dei caratteri e delle immagini che
/// l'elenco nomina. Nell'app sono i file dell'app e quelli del vault; nella
/// prova, quelli del banco.
pub trait Risorse {
    /// I byte del file di un carattere (TrueType, OpenType, WOFF o WOFF2).
    fn carattere(&self, file: &str) -> Option<Vec<u8>>;
    /// I byte di un'immagine (PNG, JPEG, GIF o WebP).
    fn immagine(&self, file: &str) -> Option<Vec<u8>>;
}

/// Il PDF scritto, e ciò che non è uscito come la vista lo mostrava.
#[derive(Debug)]
pub struct Scritto {
    pub pdf: Vec<u8>,
    pub avvisi: Vec<Avviso>,
}

/// Ciò che il PDF ha di diverso dalla vista, detto per nome. Non ferma la
/// scrittura: chi esporta lo mostra.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "avviso", rename_all = "snake_case")]
pub enum Avviso {
    /// Il file del carattere non c'è: il testo esce in Literata.
    CarattereMancante { famiglia: String, file: String },
    /// Il file c'è ma non si legge come un carattere.
    CarattereIlleggibile {
        famiglia: String,
        file: String,
        motivo: String,
    },
    /// La licenza del carattere non lascia incorporarlo (`fsType`): il testo
    /// esce in Literata, che si incorpora.
    CarattereNonIncorporabile { famiglia: String },
    /// Lettere che né il carattere né Literata sanno disegnare: escono nel
    /// riquadro vuoto, e restano nel testo che si copia.
    LettereMancanti { famiglia: String, lettere: String },
    /// L'immagine non c'è, o non si legge: al suo posto non c'è niente.
    ImmagineMancante { file: String },
    /// Un vettore che non si legge come SVG.
    VettoreIlleggibile { motivo: String },
}

/// Perché un elenco non diventa un PDF.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "errore", rename_all = "snake_case")]
pub enum ErroreEsportazione {
    /// Un elenco di un'altra versione del formato.
    Versione { trovata: u32 },
    /// Una pagina senza misura, o fuori misura.
    MisuraPagina,
    /// Nessuna pagina, o più di [`MAX_PAGINE`].
    NumeroPagine { pagine: usize },
    /// Più di [`MAX_PEZZI_PAGINA`] pezzi in una pagina.
    TroppiPezzi { pagina: usize },
    /// Un pezzo con una misura che non è un numero, o fuori dalla pagina di
    /// molto.
    MisuraPezzo { pagina: usize, pezzo: usize },
    /// Un testo che nomina una faccia che l'elenco non ha.
    FacciaSconosciuta { pagina: usize, pezzo: usize },
    /// Un testo con le posizioni che non sono una per lettera.
    Posizioni { pagina: usize, pezzo: usize },
    /// Un vettore più grande di [`MAX_VETTORE_BYTE`].
    VettoreTroppoGrande { pagina: usize, pezzo: usize },
    /// Il sotto-insieme di un carattere non si scrive.
    SottoInsieme { famiglia: String, motivo: String },
}

impl fmt::Display for ErroreEsportazione {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Versione { trovata } => {
                write!(f, "page list version {trovata}, expected {VERSIONE}")
            }
            Self::MisuraPagina => f.write_str("the page size is missing or out of range"),
            Self::NumeroPagine { pagine } => {
                write!(f, "{pagine} pages: from 1 to {MAX_PAGINE} are allowed")
            }
            Self::TroppiPezzi { pagina } => {
                write!(f, "page {pagina} has more than {MAX_PEZZI_PAGINA} items")
            }
            Self::MisuraPezzo { pagina, pezzo } => {
                write!(f, "item {pezzo} of page {pagina} has an invalid measure")
            }
            Self::FacciaSconosciuta { pagina, pezzo } => {
                write!(f, "item {pezzo} of page {pagina} names an unknown face")
            }
            Self::Posizioni { pagina, pezzo } => write!(
                f,
                "item {pezzo} of page {pagina} does not have one position per character"
            ),
            Self::VettoreTroppoGrande { pagina, pezzo } => write!(
                f,
                "item {pezzo} of page {pagina} is a vector larger than {} MiB",
                MAX_VETTORE_BYTE >> 20
            ),
            Self::SottoInsieme { famiglia, motivo } => {
                write!(f, "the font {famiglia} could not be subset: {motivo}")
            }
        }
    }
}

impl std::error::Error for ErroreEsportazione {}
