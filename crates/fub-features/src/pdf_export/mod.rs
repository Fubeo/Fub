//! L'esportazione delle note in PDF: la vista compone, Fub scrive (ADR 0247).
//!
//! La strada A dell'esportazione: la pagina la compone la vista, il PDF lo
//! scrive Fub. La vista impagina la nota e misura ciò che ha disegnato: ogni
//! pezzo di testo con la sua posizione, il suo carattere e la posizione di
//! ogni lettera, i fondi e i bordi, i vettori (diagrammi, radici delle
//! formule), le immagini, i collegamenti e i segnalibri. Ne fa un
//! [`ElencoPagine`] e lo passa al core, che scrive il PDF con [`scrivi`] (o
//! [`scrivi_con`], che si può fermare): testo vero, che si seleziona e si
//! cerca, coi caratteri incorporati in sotto-insieme, i vettori come vettori,
//! i collegamenti che si cliccano, i segnalibri e i dati del documento.
//!
//! Anteprima e file coincidono perché nascono dalla stessa misura: il core non
//! va a capo e non impagina, mette ogni lettera dove la vista l'ha messa. Per
//! questo coincidono sulla macchina che esporta e non fra due macchine: due
//! sistemi possono andare a capo in punti diversi, e ognuno scrive il suo.
//!
//! # Lo scrittore
//!
//! - [`writer`]: il controllo dell'elenco, le pagine, i dati del documento e i
//!   collegamenti;
//! - `text`: i caratteri, i loro sotto-insiemi e il testo;
//! - `images`: i vettori e le immagini, piene o alleggerite;
//! - `outline`: i segnalibri;
//! - `tags`: la struttura del PDF accessibile (i tag, l'ordine di lettura, i
//!   testi alternativi), dalla [`struttura`](ElencoPagine::struttura) che la
//!   vista manda;
//! - `pdfa`: ciò che il PDF/A aggiunge (il profilo di colore, i metadati XMP)
//!   e ciò che non permette, detto prima che il file si scriva.
//!
//! # Il comando e il suo lavoro
//!
//! [`lavoro`] porta l'elenco dalla vista al file: il comando
//! [`PDF_WRITE_PAGES`](lavoro::PDF_WRITE_PAGES) lo controlla e accoda un
//! lavoro del core, che si vede nel centro attività e si annulla; il lavoro
//! scrive il PDF e lo deposita nel vault in un colpo solo, così il file arriva
//! intero o non arriva.
//!
//! # Più note in un PDF
//!
//! [`book`] compone un libro (più note, una per capitolo, coi collegamenti
//! fra loro che diventano interni) in un elenco solo, e il suo comando lo
//! passa al lavoro di una nota.
//!
//! # Il profilo e la memoria
//!
//! Le regolazioni dell'esportazione stanno in due posti, fuori dalla nota:
//! il [`profile`] (tema, colori, caratteri, pagina, contenuto: vale per ogni
//! nota del vault) e la [`memory`] di ogni nota (lo stile dato a un solo
//! diagramma e i blocchi lasciati fuori). Tutti e due vivono nello spazio
//! dati [`SPAZIO_DATI`]; la forma dei file e dell'elenco è in
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
pub mod book;
#[cfg(test)]
mod book_tests;
mod images;
#[cfg(test)]
mod images_tests;
pub mod lavoro;
pub mod memory;
mod outline;
#[cfg(test)]
mod outline_tests;
mod pdfa;
#[cfg(test)]
mod pdfa_tests;
pub mod profile;
mod tags;
#[cfg(test)]
mod tags_tests;
#[cfg(test)]
mod tests;
mod text;
pub mod writer;
#[cfg(test)]
mod writer_tests;

/// L'id dello spazio dati dell'esportazione: profili e memorie delle note
/// stanno sotto `.fub/plugins/fub.esporta-pdf/`.
pub const SPAZIO_DATI: &str = "fub.esporta-pdf";

pub use pdfa::OstacoloPdfa;
pub use tags::{Ambito, Nodo, Specie};
pub use writer::{scrivi, scrivi_con, Controllo, Interruzione, Opzioni, QualitaImmagini};

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

/// L'elenco più pesante, in byte del suo JSON: un libro con molti diagrammi
/// ci sta, un elenco che porta le immagini dentro di sé no (le immagini si
/// nominano per file).
pub const MAX_ELENCO_BYTE: usize = 64 * 1024 * 1024;

/// L'immagine più pesante, in byte del suo file: oltre, resta fuori e lo dice
/// un avviso.
pub const MAX_IMMAGINE_BYTE: usize = 64 * 1024 * 1024;

/// Quanti collegamenti al più in una pagina.
pub const MAX_COLLEGAMENTI_PAGINA: usize = 10_000;

/// Quanti segnalibri al più nel documento.
pub const MAX_SEGNALIBRI: usize = 20_000;

/// Il livello più profondo di un segnalibro: quello del Titolo 6.
pub const MAX_LIVELLO_SEGNALIBRO: u8 = 6;

/// L'indirizzo più lungo di un collegamento verso fuori, in byte.
pub const MAX_URL_BYTE: usize = 8 * 1024;

/// Il testo più lungo di un segnalibro, del titolo, dell'autore o della
/// lingua, in caratteri.
pub const MAX_TESTO_DATI: usize = 2_000;

/// Quanti nodi al più nella struttura del PDF accessibile: più dei pezzi di
/// un libro lungo, meno di un elenco impazzito.
pub const MAX_NODI: usize = 1_000_000;

/// Il testo alternativo più lungo, in caratteri: la descrizione di un
/// diagramma ci sta.
pub const MAX_TESTO_ALTERNATIVO: usize = 10_000;

/// Quanto può durare la scrittura di un PDF nel lavoro del core, in
/// millisecondi: oltre, si ferma con [`ErroreEsportazione::TempoScaduto`].
pub const MAX_TEMPO_MS: u64 = 10 * 60 * 1000;

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
    /// Chi l'ha scritto, per i dati del PDF: dalle proprietà della nota.
    #[serde(default)]
    pub autore: String,
    /// La lingua del testo, come etichetta BCP 47 (`it`, `en-GB`): un lettore
    /// di schermo la usa per la pronuncia.
    #[serde(default)]
    pub lingua: String,
    /// Le facce dei caratteri che il testo usa: un pezzo di testo ne nomina
    /// una col suo indice.
    pub facce: Vec<Faccia>,
    /// Le pagine, dalla prima.
    pub pagine: Vec<Pagina>,
    /// I segnalibri, nell'ordine in cui si leggono: ognuno col suo livello,
    /// e l'albero lo fanno i livelli.
    #[serde(default)]
    pub segnalibri: Vec<Segnalibro>,
    /// La struttura del PDF accessibile: i [`Nodo`] nell'ordine in cui si
    /// leggono, e ognuno col suo genitore. Un pezzo o un collegamento nomina
    /// il suo nodo col suo indice; vuota, il PDF non porta tag.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub struttura: Vec<Nodo>,
}

/// Un segnalibro: un titolo della nota e il punto della pagina dove comincia.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Segnalibro {
    /// Il testo che il lettore mostra nell'elenco dei segnalibri.
    pub titolo: String,
    /// Da 1 (Titolo 1) a [`MAX_LIVELLO_SEGNALIBRO`]: un segnalibro sta sotto
    /// l'ultimo di livello più basso che lo precede.
    pub livello: u8,
    /// L'indice della pagina, dalla prima, che è la 0.
    pub pagina: usize,
    /// Dove comincia sulla pagina, in pixel CSS dall'alto.
    #[serde(default)]
    pub y: f64,
}

/// Un collegamento: un riquadro della pagina che porta altrove.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Collegamento {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub destinazione: Destinazione,
    /// Il nodo [`Specie::Collegamento`] della struttura a cui appartiene.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nodo: Option<usize>,
}

/// Dove porta un collegamento.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase", deny_unknown_fields)]
pub enum Destinazione {
    /// Un indirizzo fuori dal documento: solo `http`, `https` e `mailto`.
    Fuori { url: String },
    /// Un punto del documento: un titolo, una nota a piè, un rimando.
    Dentro {
        /// L'indice della pagina, dalla prima, che è la 0.
        pagina: usize,
        /// Il punto della pagina, in pixel CSS dall'alto.
        #[serde(default)]
        y: f64,
    },
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

/// Una pagina: i suoi pezzi nell'ordine in cui si disegnano, e i suoi
/// collegamenti, che non si disegnano ma si cliccano.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pagina {
    pub pezzi: Vec<Pezzo>,
    #[serde(default)]
    pub collegamenti: Vec<Collegamento>,
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
        /// Il nodo della [struttura](ElencoPagine::struttura) a cui appartiene;
        /// senza, nel PDF accessibile è un artefatto (una testata, un numero
        /// di pagina).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        nodo: Option<usize>,
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
        /// Il nodo della struttura a cui appartiene, di solito una figura.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        nodo: Option<usize>,
    },
    /// Un'immagine, coi byte che [`Risorse::immagine`] dà per `file`.
    Immagine {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        file: String,
        /// Il nodo della struttura a cui appartiene, di solito una figura.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        nodo: Option<usize>,
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
    /// L'immagine pesa più di [`MAX_IMMAGINE_BYTE`]: al suo posto non c'è
    /// niente.
    ImmagineTroppoGrande { file: String, byte: u64 },
    /// Un vettore che non si legge come SVG.
    VettoreIlleggibile { motivo: String },
    /// Un collegamento verso un indirizzo che il PDF non apre (uno schema che
    /// non è `http`, `https` o `mailto`): il testo resta, il clic no.
    CollegamentoScartato { url: String },
    /// Una lingua che non è un'etichetta BCP 47: il PDF non la dice.
    LinguaScartata { lingua: String },
    /// Il PDF accessibile è stato chiesto ma l'elenco non ha la struttura:
    /// il PDF esce senza tag.
    StrutturaMancante,
    /// Una figura o una formula senza testo alternativo: un lettore di schermo
    /// non sa dire che cosa mostra. `nodo` è il suo indice nella struttura,
    /// `pagina` (dalla prima, che è la 1) dove comincia.
    TestoAlternativoMancante { nodo: usize, pagina: Option<usize> },
    /// Una tabella senza celle d'intestazione: un lettore di schermo legge le
    /// celle senza dire di che colonna sono.
    TabellaSenzaIntestazione { nodo: usize, pagina: Option<usize> },
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
    /// Il JSON dell'elenco non si legge come un elenco di questa versione.
    ElencoIlleggibile { motivo: String },
    /// Il JSON dell'elenco pesa più di [`MAX_ELENCO_BYTE`].
    ElencoTroppoGrande { byte: u64 },
    /// Più di [`MAX_COLLEGAMENTI_PAGINA`] collegamenti in una pagina.
    TroppiCollegamenti { pagina: usize },
    /// Un collegamento con una misura che non è un numero, o che porta a una
    /// pagina che l'elenco non ha.
    CollegamentoRotto { pagina: usize, collegamento: usize },
    /// Più di [`MAX_SEGNALIBRI`] segnalibri.
    TroppiSegnalibri { segnalibri: usize },
    /// Un segnalibro con un livello fuori misura, un testo troppo lungo o una
    /// pagina che l'elenco non ha.
    SegnalibroRotto { segnalibro: usize },
    /// Il titolo, l'autore o la lingua sono più lunghi di [`MAX_TESTO_DATI`].
    DatiTroppoLunghi,
    /// La scrittura è durata più del tempo concesso.
    TempoScaduto { secondi: u64 },
    /// Chi l'ha chiesta l'ha annullata.
    Annullato,
    /// Più di [`MAX_NODI`] nodi nella struttura.
    TroppiNodi { nodi: usize },
    /// Un nodo della struttura con un genitore che non viene prima, un campo
    /// che non vale per la sua specie o un testo troppo lungo.
    NodoRotto { nodo: usize },
    /// Un pezzo che nomina un nodo che la struttura non ha.
    NodoSconosciuto { pagina: usize, pezzo: usize },
    /// Il PDF/A non si può scrivere: ciò che non permette, detto per nome.
    PdfaNonPossibile { ostacoli: Vec<OstacoloPdfa> },
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
            Self::ElencoIlleggibile { motivo } => {
                write!(f, "the page list cannot be read: {motivo}")
            }
            Self::ElencoTroppoGrande { byte } => write!(
                f,
                "the page list is {byte} bytes, more than {} MiB",
                MAX_ELENCO_BYTE >> 20
            ),
            Self::TroppiCollegamenti { pagina } => write!(
                f,
                "page {pagina} has more than {MAX_COLLEGAMENTI_PAGINA} links"
            ),
            Self::CollegamentoRotto {
                pagina,
                collegamento,
            } => write!(
                f,
                "link {collegamento} of page {pagina} has an invalid measure or target"
            ),
            Self::TroppiSegnalibri { segnalibri } => write!(
                f,
                "{segnalibri} bookmarks: at most {MAX_SEGNALIBRI} are allowed"
            ),
            Self::SegnalibroRotto { segnalibro } => write!(
                f,
                "bookmark {segnalibro} has an invalid level, title or target"
            ),
            Self::DatiTroppoLunghi => write!(
                f,
                "the title, author or language is longer than {MAX_TESTO_DATI} characters"
            ),
            Self::TempoScaduto { secondi } => {
                write!(f, "writing the PDF took more than {secondi} seconds")
            }
            Self::Annullato => f.write_str("writing the PDF was cancelled"),
            Self::TroppiNodi { nodi } => {
                write!(f, "{nodi} structure nodes: at most {MAX_NODI} are allowed")
            }
            Self::NodoRotto { nodo } => write!(
                f,
                "structure node {nodo} has an invalid parent, field or text"
            ),
            Self::NodoSconosciuto { pagina, pezzo } => write!(
                f,
                "item {pezzo} of page {pagina} names an unknown structure node"
            ),
            Self::PdfaNonPossibile { ostacoli } => write!(
                f,
                "the PDF/A cannot be written: {} obstacles",
                ostacoli.len()
            ),
        }
    }
}

impl std::error::Error for ErroreEsportazione {}
