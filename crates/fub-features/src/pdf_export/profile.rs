//! **Il profilo d'esportazione**: tutte le regolazioni dello spazio «Esporta
//! in PDF» insieme, con un nome («Relazione per il Comune», «Bozza con i
//! commenti»).
//!
//! Un profilo vale per ogni nota del vault ed è un file JSON suo, uno per
//! profilo, nello spazio dati dell'esportazione:
//!
//! ```text
//! .fub/plugins/fub.draw/profili/<id>.json
//! ```
//!
//! L'`id` è il nome del file senza `.json`, e resta quello anche quando il
//! profilo cambia nome: il nome che la persona vede sta **dentro** il file.
//! Così un profilo si copia anche a mano, col gestore dei file, e la copia è
//! un profilo nuovo che porta lo stesso nome finché qualcuno non lo cambia:
//! [`elenca`] li mostra tutti e due e dice che si chiamano uguale.
//!
//! # Il tema e ciò che è «tuo»
//!
//! Il profilo nomina un tema di stampa ([`IdTema`]) e tiene soltanto ciò che
//! la persona ha cambiato rispetto al tema: i colori in [`Profilo::colori`],
//! i caratteri e l'impostazione in [`Testo`] (un `Some` è una scelta tua, un
//! `None` lascia decidere il tema). Cambiando tema le scelte tue restano, ed è
//! questo che le segna «tue»; «torna al tema» le toglie una per una
//! ([`Profilo::colore_al_tema`], [`Testo::torna_al_tema`]) o tutte insieme
//! ([`Profilo::tutto_al_tema`]). I colori e i caratteri di ogni tema li
//! conosce la vista, che disegna le pagine: il core non li ripete.
//!
//! # Un profilo di una versione più nuova
//!
//! Si legge per ciò che si conosce. Il resto si conserva: le chiavi che
//! questa versione non conosce, a ogni livello, restano nelle mappe `altro`, e
//! i valori a elenco che non conosce restano `Altro(...)`. Il file di un
//! profilo futuro non si riscrive ([`salva`] risponde
//! [`ErroreProfilo::Futuro`]): chi vuole cambiarlo ne fa una copia
//! ([`copia`]), che porta con sé anche ciò che questa versione non capisce.

use std::collections::BTreeMap;
use std::fmt;

use fub_abi::error::PluginError;
use fub_abi::rules::doc_data;
use fub_abi::rules::path::resolution_key;
use fub_abi::traits::{DataRead, DataWrite};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::aperta::scelta_aperta;

/// La versione del formato del profilo che questa versione di Fub scrive.
pub const VERSIONE_PROFILO: u32 = 1;

/// La cartella dei profili, nello spazio dati dell'esportazione.
pub const CARTELLA_PROFILI: &str = "profili";

/// Il profilo più grande che si legge. Un profilo con tutte le regolazioni
/// pesa qualche KB; il tetto ferma soltanto un file che non è un profilo.
pub const MAX_PROFILO_BYTE: usize = 256 * 1024;

/// Il nome più lungo, in caratteri.
pub const MAX_NOME: usize = 120;

/// L'id più lungo, in byte: sta in un nome di file su ogni sistema, con
/// `.json` e il numero di una copia.
pub const MAX_ID_BYTE: usize = 200;

/// Il nome del profilo che c'è sempre, anche senza nessun file.
pub const NOME_DI_SERIE: &str = "Di serie";

/// Le chiavi che non si conoscono, conservate com'erano.
pub type Altro = Map<String, Value>;

/// Il tema di stampa che il profilo nomina: uno degli otto di Fub
/// (`fub`, `classico`, `relazione`, `rivista`, `accademico`, `quaderno`,
/// `essenziale`, `notte`) o uno che questa versione non conosce, che la vista
/// mostra col tema `fub`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdTema(pub String);

impl IdTema {
    /// I temi di stampa di Fub, nell'ordine in cui la vista li mostra.
    pub const DI_FUB: [&'static str; 8] = [
        "fub",
        "classico",
        "relazione",
        "rivista",
        "accademico",
        "quaderno",
        "essenziale",
        "notte",
    ];

    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Se è uno dei temi di stampa di Fub.
    pub fn conosciuto(&self) -> bool {
        Self::DI_FUB.contains(&self.0.as_str())
    }
}

impl Default for IdTema {
    fn default() -> Self {
        Self::new(Self::DI_FUB[0])
    }
}

scelta_aperta! {
    /// Uno dei colori che si cambiano uno per uno: gli undici della pagina e i
    /// quattro dei diagrammi, che vincono sullo stile.
    pub enum ChiaveColore {
        Carta => "carta",
        Testo => "testo",
        Titoli => "titoli",
        Accento => "accento",
        Link => "link",
        TestoSecondario => "testo-secondario",
        Linee => "linee",
        Evidenziato => "evidenziato",
        Riquadri => "riquadri",
        Codice => "codice",
        IntestazioniTabella => "intestazioni-tabella",
        DiagrammaNodi => "diagramma-nodi",
        DiagrammaDecisioni => "diagramma-decisioni",
        DiagrammaInizioFine => "diagramma-inizio-fine",
        DiagrammaLinee => "diagramma-linee",
    }
}

/// Un colore valido: rosso, verde e blu.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb(pub [u8; 3]);

impl Rgb {
    /// Legge `#rrggbb` o `#rgb`, maiuscole o minuscole.
    pub fn leggi(testo: &str) -> Option<Self> {
        let cifre = testo.trim().strip_prefix('#')?;
        if !cifre.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |s: &str| u8::from_str_radix(s, 16).ok();
        match cifre.len() {
            6 => Some(Self([
                byte(&cifre[0..2])?,
                byte(&cifre[2..4])?,
                byte(&cifre[4..6])?,
            ])),
            3 => {
                let mut rgb = [0u8; 3];
                for (i, c) in cifre.chars().enumerate() {
                    let v = c.to_digit(16)? as u8;
                    rgb[i] = v * 16 + v;
                }
                Some(Self(rgb))
            }
            _ => None,
        }
    }

    /// La forma con cui il colore sta nel file: `#rrggbb`, minuscolo.
    pub fn esadecimale(self) -> String {
        let [r, g, b] = self.0;
        format!("#{r:02x}{g:02x}{b:02x}")
    }
}

scelta_aperta! {
    /// Come si staccano i paragrafi.
    pub enum Paragrafi {
        /// Uno spazio fra un paragrafo e l'altro.
        Spazio => "spazio",
        /// Il rientro della prima riga, come in un libro.
        Rientro => "rientro",
    }
}

scelta_aperta! {
    /// Dove stanno i titoli sulla riga.
    pub enum AllineamentoTitoli {
        Sinistra => "sinistra",
        Centro => "centro",
    }
}

/// Una delle scelte che il tema decide finché non la decidi tu.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ChiaveTesto {
    CarattereTesto,
    CarattereTitoli,
    Corpo,
    Interlinea,
    Paragrafi,
    Giustificato,
    TitoliNumerati,
    ScalaTitoli,
    AllineamentoTitoli,
    Colonne,
}

impl ChiaveTesto {
    pub const TUTTE: [ChiaveTesto; 10] = [
        Self::CarattereTesto,
        Self::CarattereTitoli,
        Self::Corpo,
        Self::Interlinea,
        Self::Paragrafi,
        Self::Giustificato,
        Self::TitoliNumerati,
        Self::ScalaTitoli,
        Self::AllineamentoTitoli,
        Self::Colonne,
    ];
}

/// I caratteri e l'impostazione del testo.
///
/// Ogni `Option` è una scelta che il tema decide: `None` lascia decidere il
/// tema, `Some` è una scelta tua, che resta cambiando tema.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Testo {
    /// Il carattere del testo: l'id di un carattere di Fub (`newsreader`,
    /// `hanken`, `georgia`, `palatino`, `plex`) o il percorso di uno del vault.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carattere_testo: Option<String>,
    /// Il carattere dei titoli, come [`Testo::carattere_testo`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carattere_titoli: Option<String>,
    /// Il corpo del testo, in punti.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corpo: Option<f64>,
    /// L'interlinea, in multipli del corpo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interlinea: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paragrafi: Option<Paragrafi>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub giustificato: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub titoli_numerati: Option<bool>,
    /// Quanto cresce un titolo rispetto a quello sotto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scala_titoli: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allineamento_titoli: Option<AllineamentoTitoli>,
    /// Una colonna o due.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colonne: Option<u8>,
    /// La sillabazione: non la decide il tema.
    #[serde(default = "vero")]
    pub sillabazione: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for Testo {
    /// Niente di tuo: decide tutto il tema.
    fn default() -> Self {
        Self {
            carattere_testo: None,
            carattere_titoli: None,
            corpo: None,
            interlinea: None,
            paragrafi: None,
            giustificato: None,
            titoli_numerati: None,
            scala_titoli: None,
            allineamento_titoli: None,
            colonne: None,
            sillabazione: true,
            altro: Altro::new(),
        }
    }
}

impl Testo {
    /// Se la scelta l'hai decisa tu.
    pub fn e_tua(&self, chiave: ChiaveTesto) -> bool {
        match chiave {
            ChiaveTesto::CarattereTesto => self.carattere_testo.is_some(),
            ChiaveTesto::CarattereTitoli => self.carattere_titoli.is_some(),
            ChiaveTesto::Corpo => self.corpo.is_some(),
            ChiaveTesto::Interlinea => self.interlinea.is_some(),
            ChiaveTesto::Paragrafi => self.paragrafi.is_some(),
            ChiaveTesto::Giustificato => self.giustificato.is_some(),
            ChiaveTesto::TitoliNumerati => self.titoli_numerati.is_some(),
            ChiaveTesto::ScalaTitoli => self.scala_titoli.is_some(),
            ChiaveTesto::AllineamentoTitoli => self.allineamento_titoli.is_some(),
            ChiaveTesto::Colonne => self.colonne.is_some(),
        }
    }

    /// «Torna al tema» su una scelta sola.
    pub fn torna_al_tema(&mut self, chiave: ChiaveTesto) {
        match chiave {
            ChiaveTesto::CarattereTesto => self.carattere_testo = None,
            ChiaveTesto::CarattereTitoli => self.carattere_titoli = None,
            ChiaveTesto::Corpo => self.corpo = None,
            ChiaveTesto::Interlinea => self.interlinea = None,
            ChiaveTesto::Paragrafi => self.paragrafi = None,
            ChiaveTesto::Giustificato => self.giustificato = None,
            ChiaveTesto::TitoliNumerati => self.titoli_numerati = None,
            ChiaveTesto::ScalaTitoli => self.scala_titoli = None,
            ChiaveTesto::AllineamentoTitoli => self.allineamento_titoli = None,
            ChiaveTesto::Colonne => self.colonne = None,
        }
    }

    /// Quante scelte sono tue.
    pub fn tue(&self) -> usize {
        ChiaveTesto::TUTTE
            .iter()
            .filter(|chiave| self.e_tua(**chiave))
            .count()
    }
}

/// Il bianco e nero e il risparmio d'inchiostro: valgono sopra ogni tema.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Inchiostro {
    #[serde(default)]
    pub bianco_e_nero: bool,
    #[serde(default)]
    pub risparmio: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

scelta_aperta! {
    /// Il formato della pagina.
    pub enum Formato {
        A4 => "A4",
        A5 => "A5",
        A3 => "A3",
        Lettera => "Lettera",
        /// Una misura propria: [`Pagina::misura_propria`].
        Proprio => "proprio",
    }
}

/// I margini, in millimetri. Un lato che manca è quello di serie.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Margini {
    pub sopra: f64,
    pub destra: f64,
    pub sotto: f64,
    pub sinistra: f64,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for Margini {
    /// I margini «normali».
    fn default() -> Self {
        Self {
            sopra: 25.0,
            destra: 22.0,
            sotto: 25.0,
            sinistra: 22.0,
            altro: Altro::new(),
        }
    }
}

/// La pagina.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Pagina {
    #[serde(default)]
    pub formato: Formato,
    /// Larghezza e altezza in millimetri, con [`Formato::Proprio`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub misura_propria: Option<[f64; 2]>,
    #[serde(default)]
    pub orizzontale: bool,
    #[serde(default)]
    pub margini: Margini,
    /// I margini a specchio, per il fronte e retro.
    #[serde(default)]
    pub specchio: bool,
    /// Il testo della filigrana; vuoto, nessuna.
    #[serde(default)]
    pub filigrana: String,
    #[serde(flatten)]
    pub altro: Altro,
}

scelta_aperta! {
    /// Ciò che sta in un posto della testata o del piè.
    pub enum VoceTestata {
        Niente => "",
        Titolo => "titolo",
        Sezione => "sezione",
        Data => "data",
        Pagina => "pagina",
        PaginaDiPagine => "pagina-di-pagine",
        Autore => "autore",
        Percorso => "percorso",
        /// Un testo tuo: [`Posto::testo`].
        Testo => "testo",
    }
}

scelta_aperta! {
    /// Uno dei sei posti: sinistra, centro e destra, sopra e sotto.
    pub enum ChiavePosto {
        SopraSinistra => "sopra-sinistra",
        SopraCentro => "sopra-centro",
        SopraDestra => "sopra-destra",
        SottoSinistra => "sotto-sinistra",
        SottoCentro => "sotto-centro",
        SottoDestra => "sotto-destra",
    }
}

/// Un posto della testata o del piè.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Posto {
    #[serde(default)]
    pub voce: VoceTestata,
    /// Il testo, con [`VoceTestata::Testo`].
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub testo: String,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Posto {
    pub fn con(voce: VoceTestata) -> Self {
        Self {
            voce,
            ..Self::default()
        }
    }
}

/// La testata e il piè.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TestataPie {
    /// I posti che hanno qualcosa; un posto che manca è vuoto.
    #[serde(default)]
    pub posti: BTreeMap<ChiavePosto, Posto>,
    /// Il filo sotto la testata.
    #[serde(default = "vero")]
    pub filo: bool,
    #[serde(default)]
    pub prima_pagina_senza: bool,
    /// I numeri romani per frontespizio e indice.
    #[serde(default)]
    pub numeri_romani: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for TestataPie {
    /// Il titolo in alto a destra, «pagina di pagine» in basso al centro.
    fn default() -> Self {
        Self {
            posti: BTreeMap::from([
                (ChiavePosto::SopraDestra, Posto::con(VoceTestata::Titolo)),
                (
                    ChiavePosto::SottoCentro,
                    Posto::con(VoceTestata::PaginaDiPagine),
                ),
            ]),
            filo: true,
            prima_pagina_senza: false,
            numeri_romani: false,
            altro: Altro::new(),
        }
    }
}

/// Il frontespizio, l'indice e i segnalibri.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontespizioIndice {
    #[serde(default)]
    pub frontespizio: bool,
    #[serde(default)]
    pub indice: bool,
    /// Fino a quale livello di titolo arriva l'indice: 2 o 3.
    #[serde(default = "due")]
    pub profondita_indice: u8,
    #[serde(default = "vero")]
    pub segnalibri: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for FrontespizioIndice {
    fn default() -> Self {
        Self {
            frontespizio: false,
            indice: false,
            profondita_indice: 2,
            segnalibri: true,
            altro: Altro::new(),
        }
    }
}

scelta_aperta! {
    /// Quali proprietà escono.
    pub enum Proprieta {
        Nessuna => "nessuna",
        InEvidenza => "in-evidenza",
        Tutte => "tutte",
    }
}

scelta_aperta! {
    /// Dove escono i commenti.
    pub enum Commenti {
        No => "no",
        Margine => "margine",
        InFondo => "in-fondo",
    }
}

scelta_aperta! {
    /// Come escono i link.
    pub enum Link {
        Colorati => "colorati",
        Sottolineati => "sottolineati",
        ComeIlTesto => "come-il-testo",
    }
}

scelta_aperta! {
    /// I blocchi ripiegabili.
    pub enum Ripiegabili {
        Aperti => "aperti",
        Chiusi => "chiusi",
    }
}

scelta_aperta! {
    /// Le schede vive nella nota.
    pub enum Schede {
        Anteprima => "anteprima",
        SoloNome => "solo-nome",
        /// Per un PDF, tutte le sue pagine in coda.
        PagineInCoda => "pagine-in-coda",
    }
}

scelta_aperta! {
    /// Il disegno delle tabelle.
    pub enum Tabelle {
        Linee => "linee",
        RigheAlterne => "righe-alterne",
        Griglia => "griglia",
    }
}

/// Il contenuto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Contenuto {
    #[serde(default)]
    pub proprieta: Proprieta,
    #[serde(default)]
    pub commenti: Commenti,
    #[serde(default)]
    pub link: Link,
    #[serde(default = "vero")]
    pub compiti_fatti: bool,
    #[serde(default)]
    pub ripiegabili: Ripiegabili,
    #[serde(default)]
    pub schede: Schede,
    #[serde(default)]
    pub tabelle: Tabelle,
    #[serde(default)]
    pub codice_numerato: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for Contenuto {
    fn default() -> Self {
        Self {
            proprieta: Proprieta::default(),
            commenti: Commenti::default(),
            link: Link::default(),
            compiti_fatti: true,
            ripiegabili: Ripiegabili::default(),
            schede: Schede::default(),
            tabelle: Tabelle::default(),
            codice_numerato: false,
            altro: Altro::new(),
        }
    }
}

/// Lo stile di un diagramma per l'esportazione: `nota` (com'è nella nota),
/// `tema` (come il tema di stampa) o il nome di uno degli stili col fondo del
/// diagramma. È un testo e non un elenco chiuso perché gli stili sono del
/// diagramma, che può averne di nuovi.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StileDiagramma(pub String);

impl StileDiagramma {
    /// Com'è nella nota (`%% stile:`).
    pub const NOTA: &'static str = "nota";
    /// Come il tema di stampa.
    pub const TEMA: &'static str = "tema";

    pub fn new(stile: impl Into<String>) -> Self {
        Self(stile.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for StileDiagramma {
    fn default() -> Self {
        Self::new(Self::NOTA)
    }
}

/// I diagrammi. I quattro colori dati a mano stanno in [`Profilo::colori`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagrammi {
    #[serde(default)]
    pub stile: StileDiagramma,
    #[serde(default = "vero")]
    pub fondo: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for Diagrammi {
    fn default() -> Self {
        Self {
            stile: StileDiagramma::default(),
            fondo: true,
            altro: Altro::new(),
        }
    }
}

/// Le interruzioni di pagina che si scelgono. Quelle messe a mano stanno
/// nella nota (`<!-- pagina -->`), non qui.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interruzioni {
    /// Ogni Titolo 2 comincia una pagina.
    #[serde(default)]
    pub ogni_titolo_2: bool,
    /// Il separatore volta pagina.
    #[serde(default = "vero")]
    pub separatore: bool,
    /// L'intestazione ripetuta nelle tabelle lunghe.
    #[serde(default = "vero")]
    pub ripeti_intestazione: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for Interruzioni {
    fn default() -> Self {
        Self {
            ogni_titolo_2: false,
            separatore: true,
            ripeti_intestazione: true,
            altro: Altro::new(),
        }
    }
}

scelta_aperta! {
    /// Le immagini nel file.
    pub enum Immagini {
        Piene => "piene",
        Alleggerite => "alleggerite",
    }
}

/// Il file che esce.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Uscita {
    /// Quali pagine, come si scrive in una finestra di stampa (`1-3, 5`);
    /// vuoto, tutte.
    #[serde(default)]
    pub pagine: String,
    #[serde(default)]
    pub immagini: Immagini,
    #[serde(default = "vero")]
    pub accessibile: bool,
    #[serde(default)]
    pub pdfa: bool,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for Uscita {
    fn default() -> Self {
        Self {
            pagine: String::new(),
            immagini: Immagini::default(),
            accessibile: true,
            pdfa: false,
            altro: Altro::new(),
        }
    }
}

/// Un profilo d'esportazione.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Profilo {
    /// La versione del formato con cui il file è stato scritto.
    pub versione: u32,
    /// Il nome che la persona vede.
    pub nome: String,
    #[serde(default)]
    pub tema: IdTema,
    /// I colori tuoi, in `#rrggbb`: ogni colore che manca è quello del tema.
    /// Un valore che non è un colore resta com'è e non vale
    /// ([`Profilo::colore_tuo`]).
    #[serde(default)]
    pub colori: BTreeMap<ChiaveColore, String>,
    #[serde(default)]
    pub inchiostro: Inchiostro,
    #[serde(default)]
    pub testo: Testo,
    #[serde(default)]
    pub pagina: Pagina,
    #[serde(default)]
    pub testata: TestataPie,
    #[serde(default)]
    pub frontespizio: FrontespizioIndice,
    #[serde(default)]
    pub contenuto: Contenuto,
    #[serde(default)]
    pub diagrammi: Diagrammi,
    #[serde(default)]
    pub interruzioni: Interruzioni,
    #[serde(default)]
    pub uscita: Uscita,
    #[serde(flatten)]
    pub altro: Altro,
}

fn vero() -> bool {
    true
}

fn due() -> u8 {
    2
}

impl Default for Profilo {
    fn default() -> Self {
        Self::nuovo(NOME_DI_SERIE)
    }
}

impl Profilo {
    /// Un profilo con le regolazioni di serie e il tema `fub`.
    pub fn nuovo(nome: impl Into<String>) -> Self {
        Self {
            versione: VERSIONE_PROFILO,
            nome: nome.into(),
            tema: IdTema::default(),
            colori: BTreeMap::new(),
            inchiostro: Inchiostro::default(),
            testo: Testo::default(),
            pagina: Pagina::default(),
            testata: TestataPie::default(),
            frontespizio: FrontespizioIndice::default(),
            contenuto: Contenuto::default(),
            diagrammi: Diagrammi::default(),
            interruzioni: Interruzioni::default(),
            uscita: Uscita::default(),
            altro: Altro::new(),
        }
    }

    /// Il profilo «Di serie», che c'è anche senza nessun file.
    pub fn di_serie() -> Self {
        Self::nuovo(NOME_DI_SERIE)
    }

    /// Se il file viene da una versione più nuova di Fub.
    pub fn futuro(&self) -> bool {
        self.versione > VERSIONE_PROFILO
    }

    /// Le chiavi che questa versione non conosce, con il percorso
    /// (`pagina.rilegatura`): la vista può dire che il profilo ha regolazioni
    /// che qui non si vedono.
    pub fn chiavi_sconosciute(&self) -> Vec<String> {
        let mut chiavi = Vec::new();
        let mut aggiungi = |sezione: &str, altro: &Altro| {
            for chiave in altro.keys() {
                chiavi.push(if sezione.is_empty() {
                    chiave.clone()
                } else {
                    format!("{sezione}.{chiave}")
                });
            }
        };
        aggiungi("", &self.altro);
        aggiungi("inchiostro", &self.inchiostro.altro);
        aggiungi("testo", &self.testo.altro);
        aggiungi("pagina", &self.pagina.altro);
        aggiungi("pagina.margini", &self.pagina.margini.altro);
        aggiungi("testata", &self.testata.altro);
        for (posto, valore) in &self.testata.posti {
            aggiungi(
                &format!("testata.posti.{}", posto.come_testo()),
                &valore.altro,
            );
        }
        aggiungi("frontespizio", &self.frontespizio.altro);
        aggiungi("contenuto", &self.contenuto.altro);
        aggiungi("diagrammi", &self.diagrammi.altro);
        aggiungi("interruzioni", &self.interruzioni.altro);
        aggiungi("uscita", &self.uscita.altro);
        chiavi
    }

    /// Cambia tema: ciò che è tuo resta.
    pub fn cambia_tema(&mut self, tema: IdTema) {
        self.tema = tema;
    }

    /// Il colore tuo per quella chiave, se c'è ed è un colore.
    pub fn colore_tuo(&self, chiave: &ChiaveColore) -> Option<Rgb> {
        self.colori.get(chiave).and_then(|testo| Rgb::leggi(testo))
    }

    /// Se il colore l'hai cambiato tu (anche se scritto male: è comunque una
    /// scelta tua, che «torna al tema» toglie).
    pub fn colore_e_tuo(&self, chiave: &ChiaveColore) -> bool {
        self.colori.contains_key(chiave)
    }

    /// Dà un colore tuo, scritto come lo scrive la persona (`#1F4F8F`, `#fff`).
    pub fn imposta_colore(
        &mut self,
        chiave: ChiaveColore,
        colore: &str,
    ) -> Result<Rgb, ErroreColore> {
        let rgb = Rgb::leggi(colore).ok_or_else(|| ErroreColore {
            scritto: colore.to_owned(),
        })?;
        self.colori.insert(chiave, rgb.esadecimale());
        Ok(rgb)
    }

    /// «Torna al tema» su un colore.
    pub fn colore_al_tema(&mut self, chiave: &ChiaveColore) {
        self.colori.remove(chiave);
    }

    /// «Torna al tema» su tutto: colori, caratteri e impostazione.
    pub fn tutto_al_tema(&mut self) {
        self.colori.clear();
        for chiave in ChiaveTesto::TUTTE {
            self.testo.torna_al_tema(chiave);
        }
    }

    /// Quante regolazioni sono tue: «Quaderno · 2 regolazioni tue».
    pub fn regolazioni_tue(&self) -> usize {
        self.colori.len() + self.testo.tue()
    }
}

/// Un colore scritto male.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ErroreColore {
    pub scritto: String,
}

impl fmt::Display for ErroreColore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "`{}` is not a #rrggbb or #rgb colour", self.scritto)
    }
}

impl std::error::Error for ErroreColore {}

/// L'id di un profilo: il nome del suo file senza `.json`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdProfilo(pub String);

impl IdProfilo {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Se l'id può essere il nome di un file nella cartella dei profili: un
    /// componente solo, che non risale, non è nascosto e non porta caratteri
    /// che un sistema rifiuta.
    pub fn valido(&self) -> bool {
        let id = self.0.as_str();
        !id.is_empty()
            && id.len() <= MAX_ID_BYTE
            && !id.starts_with('.')
            && !id.ends_with(' ')
            && !id.ends_with('.')
            && !id.chars().any(|c| {
                c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            })
    }

    fn percorso(&self) -> String {
        format!("{CARTELLA_PROFILI}/{}.json", self.0)
    }
}

impl fmt::Display for IdProfilo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Perché un profilo non si legge o non si scrive.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "errore", rename_all = "snake_case")]
pub enum ErroreProfilo {
    /// Non c'è un profilo con questo id.
    NonTrovato { id: IdProfilo },
    /// Un id che non può essere il nome di un file di profilo.
    IdNonValido { id: IdProfilo },
    /// Il file non è un profilo: JSON rotto, o una forma che non è quella di
    /// un profilo. Il file resta com'è.
    Illeggibile { id: IdProfilo, motivo: String },
    /// Il file è più grande di [`MAX_PROFILO_BYTE`].
    TroppoGrande { id: IdProfilo, byte: usize },
    /// Il profilo viene da una versione più nuova: si legge, ma il suo file
    /// non si riscrive.
    Futuro { id: IdProfilo, versione: u32 },
    /// Un nome vuoto.
    NomeVuoto,
    /// Un nome più lungo di [`MAX_NOME`] caratteri.
    NomeTroppoLungo,
    /// Un altro profilo si chiama già così.
    NomeGiaUsato { nome: String, id: IdProfilo },
    /// Lo spazio dati ha detto di no (disco pieno, permesso): il valore di
    /// prima resta.
    Archivio { causa: PluginError },
}

impl fmt::Display for ErroreProfilo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonTrovato { id } => write!(f, "no export profile `{id}`"),
            Self::IdNonValido { id } => write!(f, "`{id}` is not a valid profile id"),
            Self::Illeggibile { id, motivo } => {
                write!(f, "the export profile `{id}` cannot be read: {motivo}")
            }
            Self::TroppoGrande { id, byte } => write!(
                f,
                "the export profile `{id}` is {byte} bytes, more than {MAX_PROFILO_BYTE}"
            ),
            Self::Futuro { id, versione } => write!(
                f,
                "the export profile `{id}` has version {versione}, newer than \
                 {VERSIONE_PROFILO}: it is read but not rewritten"
            ),
            Self::NomeVuoto => f.write_str("a profile needs a name"),
            Self::NomeTroppoLungo => {
                write!(f, "a profile name has at most {MAX_NOME} characters")
            }
            Self::NomeGiaUsato { nome, id } => {
                write!(f, "the profile `{id}` is already called «{nome}»")
            }
            Self::Archivio { causa } => write!(f, "export profile storage: {causa}"),
        }
    }
}

impl std::error::Error for ErroreProfilo {}

impl From<PluginError> for ErroreProfilo {
    fn from(causa: PluginError) -> Self {
        Self::Archivio { causa }
    }
}

/// Un profilo nell'elenco: quello che si è letto, o perché non si legge.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VoceProfilo {
    pub id: IdProfilo,
    /// Il profilo, o l'errore che lo rende illeggibile: un profilo che non si
    /// legge resta nell'elenco, perché la persona sappia che c'è.
    pub esito: Result<Profilo, ErroreProfilo>,
    /// Se un altro profilo leggibile ha lo stesso nome: la vista mostra
    /// accanto il nome del file.
    pub stesso_nome: bool,
}

/// Legge i byte di un profilo.
pub fn da_byte(id: &IdProfilo, byte: &[u8]) -> Result<Profilo, ErroreProfilo> {
    if byte.len() > MAX_PROFILO_BYTE {
        return Err(ErroreProfilo::TroppoGrande {
            id: id.clone(),
            byte: byte.len(),
        });
    }
    serde_json::from_slice::<Profilo>(byte).map_err(|errore| ErroreProfilo::Illeggibile {
        id: id.clone(),
        motivo: errore.to_string(),
    })
}

/// I byte con cui un profilo sta nel file: JSON indentato, le chiavi sempre
/// nello stesso ordine, una riga vuota in fondo.
pub fn in_byte(profilo: &Profilo) -> Vec<u8> {
    let mut byte = serde_json::to_vec_pretty(profilo)
        .expect("un profilo è fatto solo di mappe a chiavi di testo");
    byte.push(b'\n');
    byte
}

fn controlla_id(id: &IdProfilo) -> Result<(), ErroreProfilo> {
    if id.valido() {
        Ok(())
    } else {
        Err(ErroreProfilo::IdNonValido { id: id.clone() })
    }
}

/// Il nome com'è da salvare: senza spazi ai lati, non vuoto, non troppo lungo.
fn nome_pulito(nome: &str) -> Result<String, ErroreProfilo> {
    let nome = nome.trim();
    if nome.is_empty() {
        return Err(ErroreProfilo::NomeVuoto);
    }
    if nome.chars().count() > MAX_NOME {
        return Err(ErroreProfilo::NomeTroppoLungo);
    }
    Ok(nome.to_owned())
}

/// Due nomi sono lo stesso nome se differiscono solo per maiuscole, forma
/// Unicode o spazi ai lati: la stessa chiave dei nomi dei documenti
/// ([`resolution_key`]), così «uguale» vuol dire una cosa sola in tutto Fub.
fn stesso_nome(a: &str, b: &str) -> bool {
    resolution_key(a) == resolution_key(b)
}

/// Gli id dei file nella cartella dei profili, in ordine.
fn ids(host: &dyn DataRead) -> Result<Vec<IdProfilo>, ErroreProfilo> {
    let prefisso = format!("{CARTELLA_PROFILI}/");
    let mut ids = Vec::new();
    // Il prefisso si dà senza `/` finale (lo spazio dati vuole un path che
    // nomina un posto); lo `/` lo controlla il filtro qui sotto.
    for percorso in host.data_list(CARTELLA_PROFILI)? {
        let Some(nome) = percorso.strip_prefix(&prefisso) else {
            continue;
        };
        // Solo i file della cartella, non quelli delle sottocartelle.
        if nome.contains('/') {
            continue;
        }
        let Some(stem) = nome.strip_suffix(".json") else {
            continue;
        };
        let id = IdProfilo(stem.to_owned());
        if id.valido() {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// Tutti i profili della cartella, anche quelli che non si leggono, in ordine
/// di id. Il profilo «Di serie» non c'è: non è un file.
pub fn elenca(host: &dyn DataRead) -> Result<Vec<VoceProfilo>, ErroreProfilo> {
    let mut voci = Vec::new();
    for id in ids(host)? {
        let esito = match host.data_read(&id.percorso())? {
            Some(byte) => da_byte(&id, &byte),
            // Sparito fra l'elenco e la lettura: non è più un profilo.
            None => continue,
        };
        voci.push(VoceProfilo {
            id,
            esito,
            stesso_nome: false,
        });
    }
    let nomi: Vec<Option<String>> = voci
        .iter()
        .map(|voce| voce.esito.as_ref().ok().map(|p| p.nome.clone()))
        .collect();
    for (i, voce) in voci.iter_mut().enumerate() {
        if let Some(nome) = &nomi[i] {
            voce.stesso_nome = nomi
                .iter()
                .enumerate()
                .any(|(j, altro)| j != i && altro.as_deref().is_some_and(|a| stesso_nome(a, nome)));
        }
    }
    Ok(voci)
}

/// Legge un profilo.
pub fn leggi(host: &dyn DataRead, id: &IdProfilo) -> Result<Profilo, ErroreProfilo> {
    controlla_id(id)?;
    match host.data_read(&id.percorso())? {
        Some(byte) => da_byte(id, &byte),
        None => Err(ErroreProfilo::NonTrovato { id: id.clone() }),
    }
}

/// Il profilo leggibile, diverso da `tranne`, che si chiama già `nome`.
fn chi_si_chiama(
    host: &dyn DataRead,
    nome: &str,
    tranne: Option<&IdProfilo>,
) -> Result<Option<IdProfilo>, ErroreProfilo> {
    Ok(elenca(host)?.into_iter().find_map(|voce| {
        let profilo = voce.esito.ok()?;
        (Some(&voce.id) != tranne && stesso_nome(&profilo.nome, nome)).then_some(voce.id)
    }))
}

/// Controlla che il file al posto di `id`, se c'è, si possa sostituire: un
/// file illeggibile o futuro resta com'è.
fn si_puo_sostituire(host: &dyn DataRead, id: &IdProfilo) -> Result<(), ErroreProfilo> {
    let Some(byte) = host.data_read(&id.percorso())? else {
        return Ok(());
    };
    let attuale = da_byte(id, &byte)?;
    if attuale.futuro() {
        return Err(ErroreProfilo::Futuro {
            id: id.clone(),
            versione: attuale.versione,
        });
    }
    Ok(())
}

fn scrivi(
    host: &mut dyn DataWrite,
    id: &IdProfilo,
    profilo: &Profilo,
) -> Result<(), ErroreProfilo> {
    let byte = in_byte(profilo);
    if byte.len() > MAX_PROFILO_BYTE {
        return Err(ErroreProfilo::TroppoGrande {
            id: id.clone(),
            byte: byte.len(),
        });
    }
    // La scrittura dello spazio dati è atomica: se non riesce, il file di
    // prima resta intero.
    host.data_write(&id.percorso(), &byte)?;
    Ok(())
}

/// Salva un profilo che c'è già (o che si crea con quell'id).
///
/// Non sostituisce un file illeggibile né quello di un profilo futuro, e non
/// scrive un profilo futuro: lo dice con l'errore e non tocca niente. Il nome
/// non può essere quello di un altro profilo.
pub fn salva(
    host: &mut dyn DataWrite,
    id: &IdProfilo,
    profilo: &Profilo,
) -> Result<(), ErroreProfilo> {
    controlla_id(id)?;
    if profilo.futuro() {
        return Err(ErroreProfilo::Futuro {
            id: id.clone(),
            versione: profilo.versione,
        });
    }
    let nome = nome_pulito(&profilo.nome)?;
    si_puo_sostituire(host, id)?;
    if let Some(altro) = chi_si_chiama(host, &nome, Some(id))? {
        return Err(ErroreProfilo::NomeGiaUsato { nome, id: altro });
    }
    let mut profilo = profilo.clone();
    profilo.nome = nome;
    profilo.versione = VERSIONE_PROFILO;
    scrivi(host, id, &profilo)
}

/// L'id libero per un nome: il nome stesso, codificato perché stia in un nome
/// di file, e un numero dopo se il file c'è già.
fn id_libero(host: &dyn DataRead, nome: &str) -> Result<IdProfilo, ErroreProfilo> {
    let mut base = doc_data::encode(nome);
    // Un nome che comincia col punto farebbe un file nascosto.
    if base.starts_with('.') {
        base.replace_range(0..1, "%2E");
    }
    while base.len() > MAX_ID_BYTE - 8 {
        base.pop();
    }
    let base = base.trim_end_matches([' ', '.']).to_owned();
    let presi = ids(host)?;
    let preso = |id: &IdProfilo| {
        presi
            .iter()
            // Due file che differiscono solo per le maiuscole sono lo stesso
            // file su macOS e Windows: la chiave dei nomi dei documenti.
            .any(|p| resolution_key(&p.0) == resolution_key(&id.0))
    };
    let mut id = IdProfilo(base.clone());
    let mut n = 2u32;
    while preso(&id) || !id.valido() {
        id = IdProfilo(format!("{base} {n}"));
        n += 1;
    }
    Ok(id)
}

/// Crea un profilo nuovo col suo nome e torna il suo id.
pub fn crea(host: &mut dyn DataWrite, profilo: &Profilo) -> Result<IdProfilo, ErroreProfilo> {
    let nome = nome_pulito(&profilo.nome)?;
    if let Some(altro) = chi_si_chiama(host, &nome, None)? {
        return Err(ErroreProfilo::NomeGiaUsato { nome, id: altro });
    }
    let id = id_libero(host, &nome)?;
    let mut profilo = profilo.clone();
    profilo.nome = nome;
    if !profilo.futuro() {
        profilo.versione = VERSIONE_PROFILO;
    }
    scrivi(host, &id, &profilo)?;
    Ok(id)
}

/// Copia un profilo con un nome nuovo, compreso ciò che questa versione non
/// conosce: è la strada per cambiare un profilo futuro.
pub fn copia(
    host: &mut dyn DataWrite,
    id: &IdProfilo,
    nome: &str,
) -> Result<IdProfilo, ErroreProfilo> {
    let mut profilo = leggi(host, id)?;
    profilo.nome = nome.to_owned();
    crea(host, &profilo)
}

/// Cambia il nome di un profilo. L'id, cioè il file, resta.
pub fn rinomina(host: &mut dyn DataWrite, id: &IdProfilo, nome: &str) -> Result<(), ErroreProfilo> {
    let mut profilo = leggi(host, id)?;
    profilo.nome = nome.to_owned();
    salva(host, id, &profilo)
}

/// Toglie un profilo. Togliere ciò che non c'è riesce.
pub fn elimina(host: &mut dyn DataWrite, id: &IdProfilo) -> Result<(), ErroreProfilo> {
    controlla_id(id)?;
    host.data_remove(&id.percorso())?;
    Ok(())
}

#[cfg(test)]
#[path = "profile_tests.rs"]
mod tests;
