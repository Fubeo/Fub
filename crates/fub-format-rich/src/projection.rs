//! La proiezione modificabile, versione 2: il documento come lo vede e lo
//! scrive la superficie ricca della shell.
//!
//! È JSON chiuso (`deny_unknown_fields`) e versionato. Mostra in chiaro ciò che
//! la superficie modifica — testo, enfasi, aspetto del carattere, link, ruolo
//! dei paragrafi, allineamento, rientri, spaziature, interlinea e stile — e
//! porta tutto il resto come dati opachi (vedi `blob`). L'aspetto `f` di un
//! paragrafo e del documento, gli stili proposti, `label`, `w` e `h` sono
//! soltanto suggerimenti di resa: il ritorno al documento li ignora.
//!
//! Il testo di un tratto è quello del modello di WordCraft: `\n` è un a-capo
//! nel paragrafo, `\t` una tabulazione, U+000C un salto pagina e U+000E un
//! salto colonna. U+FFFC non compare mai nel testo: un oggetto è un [`Inline::Atom`].
//!
//! La versione 2 dichiara lo schema dei dati opachi (`opaque_schema`, vedi
//! [`OPAQUE_SCHEMA`]); la versione 1, quella delle bozze di prima, ha le
//! stesse chiavi senza lo schema, e i suoi dati opachi sono dello schema 0.
//! Ciò che l'host produce è sempre la versione 2 con lo schema corrente; ciò
//! che la shell rimanda ha la versione e lo schema che aveva ricevuto.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use wordcraft_doc::para::OBJ;

use wordcraft_doc::props::{Highlight, LineSpacing, TextColor, Underline, VertAlign};
use wordcraft_doc::{
    Align as WcAlign, Block as WcBlock, CharProps, Comment, Document, InlineObject, ParaProps,
    Paragraph, Part, SectionProps, StyleKind, StyleSheet, Table as WcTable,
};

use crate::RichError;
use crate::{blob, running, stories};

/// Il nome del formato della proiezione.
pub const FORMAT: &str = "fub-rich";
/// La versione che questo crate scrive. Legge anche la 1.
pub const VERSION: u32 = 2;
pub use crate::blob::OPAQUE_SCHEMA;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Projection {
    pub format: String,
    pub version: u32,
    /// Lo schema dei dati opachi: c'è nella versione 2, non nella 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opaque_schema: Option<u32>,
    /// Perché il documento non si modifica, quando non si modifica.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readonly: Option<crate::ReadOnly>,
    /// I blocchi, per indice in `blocks`, che si mostrano e non si modificano:
    /// il codec non li riscriverebbe identici, e un salvataggio che li tocca
    /// non si fa. Il resto del documento si modifica.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locked: Vec<u32>,
    /// Registra le modifiche: ciò che si scrive diventa una revisione
    /// tracciata, e la shell la scrive come tale.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub track: bool,
    /// La lingua predefinita del documento, per il correttore.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// Suggerimento: il carattere e la dimensione di un paragrafo senza stile.
    #[serde(default, skip_serializing_if = "Look::is_plain")]
    pub f: Look,
    /// Suggerimento: gli stili di paragrafo da proporre oltre ai ruoli, nel
    /// loro ordine.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub styles: Vec<ParaStyle>,
    /// La pagina dell'ultima sezione, quella che nessun paragrafo chiude.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<Page>,
    /// L'intestazione e il piè di pagina dell'ultima sezione.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<RunningText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<RunningText>,
    /// I commenti del documento, per id: le risposte nominano il commento a
    /// cui rispondono, l'intervallo lo segnano due oggetti del testo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<CommentView>,
    pub blocks: Vec<Block>,
}

/// La pagina di una sezione, in punti: i lati (già scambiati se è
/// orizzontale), i margini e le colonne, di uguale larghezza quando la shell
/// ne cambia il numero.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    pub w: f32,
    pub h: f32,
    pub top: f32,
    pub bottom: f32,
    pub left: f32,
    pub right: f32,
    #[serde(default = "one_column", skip_serializing_if = "is_one_column")]
    pub cols: u32,
}

fn one_column() -> u32 {
    1
}

fn is_one_column(cols: &u32) -> bool {
    *cols == 1
}

/// Il lato più piccolo e il più grande di una pagina, come in Word (0,1" e
/// 22"), e lo spazio che i margini lasciano al testo, in ogni verso.
pub const MIN_PAGE_SIDE: f32 = 7.2;
pub const MAX_PAGE_SIDE: f32 = 1584.0;
pub const MIN_TEXT_ROOM: f32 = 36.0;
/// Le colonne di una sezione, al più.
pub const MAX_COLUMNS: u32 = 12;

impl Page {
    pub(crate) fn of(section: &SectionProps) -> Page {
        Page {
            w: section.page_w,
            h: section.page_h,
            top: section.margin_top,
            bottom: section.margin_bottom,
            left: section.margin_left,
            right: section.margin_right,
            cols: section.columns.count.max(1),
        }
    }

    /// Scrive la pagina nella sezione, se è cambiata. I margini devono
    /// lasciare spazio al testo, rilegatura compresa, come in WordCraft.
    pub(crate) fn apply(&self, section: &mut SectionProps) -> Result<(), RichError> {
        let page = self.in_twips();
        if page == Page::of(section) {
            return Ok(());
        }
        page.write(section)
    }

    /// Le misure come le tiene un `.docx`, in ventesimi di punto: un A4 di
    /// 595,28 × 841,89 punti si rilegge 595,3 × 841,9.
    fn in_twips(&self) -> Page {
        let twips = |n: f32| (n * 20.0).round() / 20.0;
        Page {
            w: twips(self.w),
            h: twips(self.h),
            top: twips(self.top),
            bottom: twips(self.bottom),
            left: twips(self.left),
            right: twips(self.right),
            cols: self.cols,
        }
    }

    fn write(&self, section: &mut SectionProps) -> Result<(), RichError> {
        let bad = |what: &str| Err(RichError::Malformed(format!("page: {what}")));
        let sides = [self.w, self.h];
        let margins = [self.top, self.bottom, self.left, self.right];
        if sides.iter().chain(&margins).any(|n| !n.is_finite()) {
            return bad("not a finite number");
        }
        if sides
            .iter()
            .any(|n| !(MIN_PAGE_SIDE..=MAX_PAGE_SIDE).contains(n))
        {
            return bad("a side out of range");
        }
        if margins.iter().any(|n| *n < 0.0)
            || self.left + self.right + section.gutter > self.w - MIN_TEXT_ROOM.min(self.w)
            || self.top + self.bottom > self.h - MIN_TEXT_ROOM.min(self.h)
        {
            return bad("the margins leave no room for text");
        }
        if !(1..=MAX_COLUMNS).contains(&self.cols) {
            return bad("columns out of range");
        }
        section.page_w = self.w;
        section.page_h = self.h;
        if self.w != self.h {
            section.landscape = self.w > self.h;
        }
        section.margin_top = self.top;
        section.margin_bottom = self.bottom;
        section.margin_left = self.left;
        section.margin_right = self.right;
        if self.cols != section.columns.count.max(1) {
            section.columns.count = self.cols;
            section.columns.widths.clear();
        }
        Ok(())
    }
}

/// L'intestazione o il piè di pagina di una sezione, quello delle pagine che
/// non ne hanno uno proprio (la prima e le pari possono averlo): una riga per
/// paragrafo, con il testo e i numeri di pagina. Assente, la sezione mostra
/// quello della sezione prima, come in Word. Uno `locked` ha qualcosa che le
/// righe non dicono (un'immagine, una tabella, un altro campo, aspetti
/// diversi): si mostra, ma non si cambia.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunningText {
    pub lines: Vec<Vec<Piece>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub locked: bool,
}

/// Un pezzo di riga: testo, o un numero che Word calcola.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Piece {
    Text(String),
    Field { field: PageField },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageField {
    /// Il numero della pagina (`PAGE`).
    Page,
    /// Il numero delle pagine (`NUMPAGES`).
    Pages,
}

/// Un commento. Senza `k` è nuovo: il formato lo scrive con autore, data e
/// testo, una riga per paragrafo. Di uno che c'è già, autore, data e testo
/// sono suggerimenti: si cambia soltanto se è risolto.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentView {
    /// L'id del commento nel documento: lo stesso nel file riletto.
    pub id: u32,
    /// Il commento e la sua storia, opachi.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub by: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub at: String,
    /// Il commento a cui risponde.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<u32>,
    /// Risolto.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub done: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
}

/// Il segno di inizio (o di fine, `end`) dell'intervallo di un commento.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Anchor {
    pub id: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub end: bool,
}

/// Uno stile di paragrafo che chi scrive può scegliere.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParaStyle {
    pub id: String,
    /// Il nome che il documento gli dà.
    pub name: String,
    /// Il carattere e la dimensione del suo testo.
    #[serde(default, skip_serializing_if = "Look::is_plain")]
    pub f: Look,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case", deny_unknown_fields)]
pub enum Block {
    Para(Para),
    Table(Table),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Para {
    pub role: Role,
    /// L'allineamento risolto, stile compreso; assente a sinistra.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    /// Proprietà del paragrafo e del suo segno di fine, opache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<String>,
    /// La sezione che il paragrafo chiude, opaca.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sect: Option<Box<str>>,
    /// La pagina della sezione che il paragrafo chiude.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<Box<Page>>,
    /// L'intestazione e il piè di pagina della sezione che il paragrafo chiude.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<Box<RunningText>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<Box<RunningText>>,
    /// Rientri, spaziature e interlinea dove differiscono da quelli dello stile.
    #[serde(default, skip_serializing_if = "Layout::is_plain")]
    pub p: Layout,
    /// Lo stile di un paragrafo di corpo, quando non è quello predefinito: gli
    /// altri ruoli hanno lo stile che il ruolo dice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<Box<str>>,
    /// Suggerimento: il carattere e la dimensione del testo che non ne
    /// sceglie altri, come li dà lo stile del paragrafo. In una scatola, come
    /// gli altri campi rari, perché un paragrafo resti piccolo.
    #[serde(default, skip_serializing_if = "Look::is_plain")]
    pub f: Box<Look>,
    /// Il segno di fine del paragrafo inserito o eliminato con le revisioni
    /// tracciate: accettarlo o rifiutarlo unisce il paragrafo al seguente.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ins: Option<Box<Rev>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub del: Option<Box<Rev>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub c: Vec<Inline>,
}

/// Una revisione tracciata: chi l'ha fatta e quando. Un inserimento e
/// un'eliminazione con lo stesso autore, la stessa data e lo stesso
/// spostamento sono la stessa revisione: il ritorno la ritrova così, non per
/// indice, perché il file riletto rinumera le revisioni.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rev {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub by: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub at: String,
    /// Il nome dello spostamento di cui è un capo: l'eliminazione è da dove
    /// il testo parte, l'inserimento dove arriva.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mv: Option<String>,
}

/// L'aspetto di un carattere che non è un'enfasi, **risolto**. In un tratto
/// ogni campo c'è soltanto dove differisce da quello del paragrafo
/// ([`Para::f`] per carattere e dimensione, il colore automatico e il giallo
/// per i colori): un tratto senza `f` si scrive come il suo paragrafo.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Look {
    /// La famiglia del carattere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// La dimensione, in punti.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f32>,
    /// Il colore del testo, `#rrggbb` minuscolo, o `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Il colore dell'evidenziatore, `#rrggbb`, quando il tratto è
    /// evidenziato ([`Mark::H`]) e non in giallo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hl: Option<String>,
}

impl Look {
    pub fn is_plain(&self) -> bool {
        *self == Look::default()
    }
}

/// La disposizione di un paragrafo, **risolta**, dove differisce da quella
/// del suo stile: ogni campo c'è soltanto dove la formattazione diretta la
/// cambia. Le lunghezze sono in punti.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    /// Il rientro sinistro.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<f32>,
    /// La prima riga, rispetto al rientro sinistro: negativa se sporge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first: Option<f32>,
    /// Lo spazio prima del paragrafo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Line>,
}

impl Layout {
    pub fn is_plain(&self) -> bool {
        *self == Layout::default()
    }
}

/// L'interlinea.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Line {
    /// Un multiplo della riga singola.
    Multiple(f32),
    /// Almeno tanti punti.
    AtLeast(f32),
    /// Esattamente tanti punti.
    Exactly(f32),
}

impl Line {
    /// La stessa interlinea, a meno di ciò che chi legge non distingue.
    pub(crate) fn same(self, other: Line) -> bool {
        match (self, other) {
            (Line::Multiple(a), Line::Multiple(b))
            | (Line::AtLeast(a), Line::AtLeast(b))
            | (Line::Exactly(a), Line::Exactly(b)) => same_size(a, b),
            _ => false,
        }
    }

    pub(crate) fn of(spacing: LineSpacing) -> Line {
        match spacing {
            LineSpacing::Multiple(m) => Line::Multiple(m),
            LineSpacing::AtLeast(pt) => Line::AtLeast(pt),
            LineSpacing::Exactly(pt) => Line::Exactly(pt),
        }
    }

    pub(crate) fn spacing(self) -> LineSpacing {
        match self {
            Line::Multiple(m) => LineSpacing::Multiple(m),
            Line::AtLeast(pt) => LineSpacing::AtLeast(pt),
            Line::Exactly(pt) => LineSpacing::Exactly(pt),
        }
    }
}

/// Il giallo dell'evidenziatore, che un tratto evidenziato senza `hl` porta.
pub const HIGHLIGHT_DEFAULT: &str = "#ffff00";
/// Il colore del testo che segue lo sfondo.
pub const COLOR_AUTO: &str = "auto";

/// Due dimensioni che chi legge non distingue.
pub(crate) fn same_size(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.01
}

/// Che cosa è un paragrafo per chi scrive. Il ritorno al documento cambia lo
/// stile o l'elenco soltanto quando il ruolo cambia.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Role {
    Body,
    /// Livello da 1 a 9, come i titoli di Word.
    Heading {
        level: u8,
    },
    /// Livello da 0 a 8.
    List {
        ordered: bool,
        level: u8,
    },
    Quote,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case", deny_unknown_fields)]
pub enum Inline {
    Text {
        x: String,
        /// Le proprietà del tratto, opache. Assenti in un testo nuovo che non
        /// ne ha ereditate: prende quelle del segno di fine paragrafo.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        k: Option<String>,
        /// L'enfasi **risolta** (stili compresi), in ordine canonico.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        m: Vec<Mark>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        href: Option<String>,
        /// L'aspetto del carattere dove differisce da quello del paragrafo.
        #[serde(default, skip_serializing_if = "Look::is_plain")]
        f: Look,
        /// Testo inserito o eliminato con le revisioni tracciate.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ins: Option<Rev>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        del: Option<Rev>,
    },
    Atom {
        /// Le proprietà del carattere e l'oggetto, opachi. Assenti in un
        /// oggetto nuovo: un'immagine con i suoi byte (`data`), una nota con
        /// il suo testo (`note`) o un sommario (`toc`), che il formato scrive
        /// alla sua maniera.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        k: Option<String>,
        kind: AtomKind,
        /// Suggerimento: ciò che l'oggetto mostra o descrive. In un'immagine
        /// nuova è il testo alternativo.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        label: String,
        /// Suggerimento: dimensioni in punti, per ciò che occupa spazio. In
        /// un'immagine nuova sono la sua misura.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        w: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        h: Option<f32>,
        /// I byte di un'immagine nuova (PNG, JPEG o GIF), in base64.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<String>,
        /// Il testo di una nota nuova.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
        /// Una nota nuova di chiusura, invece che a piè di pagina.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        end: bool,
        /// Un sommario nuovo (`field`) dei titoli fino a quel livello, da 1 a
        /// 9: sta in fondo al paragrafo del titolo del sommario, prima delle
        /// sue voci, e Word ne rifà voci e pagine aprendo il file.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        toc: Option<u8>,
        /// Il segno di un commento: in un oggetto nuovo (`marker`) è tutto
        /// ciò che lo descrive, in uno che c'è già è un suggerimento.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        comment: Option<Anchor>,
        /// Un oggetto inserito o eliminato con le revisioni tracciate.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ins: Option<Rev>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        del: Option<Rev>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mark {
    /// Grassetto.
    B,
    /// Corsivo.
    I,
    /// Sottolineato.
    U,
    /// Barrato.
    S,
    /// Evidenziato.
    H,
    Sup,
    Sub,
    /// Tutto maiuscolo, senza cambiare il testo.
    Caps,
    /// Maiuscoletto.
    SmallCaps,
}

/// La specie di un oggetto, perché la superficie sappia come mostrarlo. I
/// segni (inizio e fine di commenti, segnalibri, campi, controlli, intervalli
/// modificabili) non occupano spazio.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AtomKind {
    Image,
    Graphic,
    Shape,
    Group,
    Field,
    Note,
    Equation,
    Ruby,
    Opaque,
    Marker,
}

impl AtomKind {
    pub fn is_marker(self) -> bool {
        matches!(self, AtomKind::Marker)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Table {
    /// La tabella senza righe, opaca. Assente in una tabella nuova, che il
    /// formato scrive con le sue proprietà predefinite.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<String>,
    pub rows: Vec<Row>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    /// La riga senza celle, opaca; assente in una riga nuova.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<String>,
    pub cells: Vec<Cell>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    /// La cella senza contenuto, opaca; assente in una cella nuova.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<String>,
    /// Le colonne che la cella copre quando sono più di una: celle unite in
    /// larghezza.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span: Option<u32>,
    pub blocks: Vec<Block>,
}

/// Le proprietà opache di un paragrafo: le sue e quelle del segno di fine.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ParaKeep {
    #[serde(default)]
    pub props: ParaProps,
    #[serde(default)]
    pub mark: CharProps,
}

/// Un oggetto opaco: le proprietà del suo carattere, l'oggetto e le storie
/// che mostra (vedi [`crate::stories`]). Un dato di prima delle storie non le
/// ha, e il suo oggetto nomina le parti soltanto per id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct AtomKeep {
    pub props: CharProps,
    pub object: InlineObject,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub parts: BTreeMap<u32, Part>,
}

/// Un commento con la sua storia (e quelle che questa mostra).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CommentKeep {
    pub comment: Comment,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub parts: BTreeMap<u32, Part>,
}

/// La fine di una sezione, con le sue intestazioni e i suoi piè di pagina.
/// Un dato di prima delle storie è soltanto la sezione.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SectKeep {
    pub section: SectionProps,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub parts: BTreeMap<u32, Part>,
}

impl SectKeep {
    pub(crate) fn decode(blob: &str) -> Result<SectKeep, RichError> {
        blob::decode::<SectKeep>(blob).or_else(|_| {
            blob::decode::<SectionProps>(blob).map(|section| SectKeep {
                section,
                parts: BTreeMap::new(),
            })
        })
    }
}

impl Projection {
    /// Legge una proiezione dal JSON della shell.
    pub fn from_json(json: &str) -> Result<Projection, RichError> {
        let projection: Projection =
            serde_json::from_str(json).map_err(|error| RichError::Malformed(error.to_string()))?;
        if projection.format != FORMAT {
            return Err(RichError::Malformed(format!(
                "format {:?}",
                projection.format
            )));
        }
        let schema = match (projection.version, projection.opaque_schema) {
            (1, None) => 0,
            (1, Some(_)) => return Err(RichError::Malformed("opaque_schema in version 1".into())),
            (2, Some(schema)) => schema,
            (2, None) => return Err(RichError::Malformed("missing opaque_schema".into())),
            (version, _) => return Err(RichError::Version(version)),
        };
        if !blob::readable(schema) {
            return Err(RichError::OpaqueSchema(schema));
        }
        Ok(projection)
    }

    /// Lo schema dei dati opachi di una proiezione già letta.
    pub fn schema(&self) -> u32 {
        self.opaque_schema.unwrap_or(0)
    }

    pub fn to_json(&self) -> Result<String, RichError> {
        serde_json::to_string(self).map_err(|error| RichError::Codec(error.to_string()))
    }
}

/// Proietta un documento. `document` ha già i tratti normalizzati
/// (`Document::normalize_runs`): due tratti uguali vicini sono uno solo, come
/// la superficie li mostra.
pub(crate) fn project(document: &Document) -> Result<Projection, RichError> {
    let blocks = blocks(document, &document.body)?;
    let mut used = BTreeSet::new();
    used_styles(&blocks, &mut used);
    Ok(Projection {
        format: FORMAT.to_string(),
        version: VERSION,
        opaque_schema: Some(OPAQUE_SCHEMA),
        readonly: None,
        locked: Vec::new(),
        track: document.settings.track_changes,
        lang: document.styles.default_chr.lang.clone(),
        f: base(&document.styles, None),
        styles: gallery(document, &used),
        page: Some(Page::of(&document.last_section)),
        header: running::of(document, document.last_section.headers.default),
        footer: running::of(document, document.last_section.footers.default),
        comments: comments(document)?,
        blocks,
    })
}

/// I commenti del documento, nell'ordine dei loro id.
fn comments(document: &Document) -> Result<Vec<CommentView>, RichError> {
    document
        .comments
        .iter()
        .map(|(id, comment)| {
            let text = document
                .parts
                .get(&comment.part)
                .map(|part| {
                    part.blocks
                        .iter()
                        .filter_map(|block| block.as_para())
                        .map(|paragraph| paragraph.plain_text().to_string())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();
            Ok(CommentView {
                id: *id,
                k: Some(blob::encode(&CommentKeep {
                    comment: comment.clone(),
                    parts: stories::closure(document, vec![comment.part]),
                })?),
                by: comment.author.clone(),
                at: comment.date.clone(),
                parent: comment.parent,
                done: comment.resolved,
                text,
            })
        })
        .collect()
}

/// Gli stili che i paragrafi di corpo portano.
pub(crate) fn used_styles(blocks: &[Block], out: &mut BTreeSet<String>) {
    for block in blocks {
        match block {
            Block::Para(para) => out.extend(para.s.as_deref().map(str::to_string)),
            Block::Table(table) => {
                for cell in table.rows.iter().flat_map(|row| &row.cells) {
                    used_styles(&cell.blocks, out);
                }
            }
        }
    }
}

/// Gli stili di paragrafo da proporre: quelli della galleria di Word e quelli
/// in uso, tranne il predefinito e quelli che un ruolo già dice (titoli,
/// citazioni, voci d'elenco).
fn gallery(document: &Document, used: &BTreeSet<String>) -> Vec<ParaStyle> {
    let styles = &document.styles;
    let mut found: Vec<_> = styles
        .styles
        .iter()
        .filter(|s| (s.quick && !s.hidden) || used.contains(&s.id))
        .filter(|s| plain_style(document, &s.id))
        .collect();
    found.sort_by(|a, b| {
        (a.priority.unwrap_or(u32::MAX), &a.name).cmp(&(b.priority.unwrap_or(u32::MAX), &b.name))
    });
    found
        .into_iter()
        .map(|s| ParaStyle {
            id: s.id.clone(),
            name: if s.name.is_empty() {
                s.id.clone()
            } else {
                s.name.clone()
            },
            f: base(styles, Some(&s.id)),
        })
        .collect()
}

/// Uno stile che un paragrafo di corpo può avere: non il predefinito, e
/// nessuno che ne faccia un titolo, una citazione o una voce d'elenco.
fn plain_style(document: &Document, id: &str) -> bool {
    let Some(style) = document.styles.get(id) else {
        return false;
    };
    let props = ParaProps {
        style: Some(id.to_string()),
        ..ParaProps::default()
    };
    style.kind == StyleKind::Paragraph
        && !style.default
        && id != "Normal"
        && id != "ListParagraph"
        && role(document, &props) == Role::Body
}

/// Lo stile di un paragrafo di corpo, se non è quello predefinito.
pub(crate) fn style_of(document: &Document, props: &ParaProps) -> Option<String> {
    props
        .style
        .as_deref()
        .filter(|id| plain_style(document, id))
        .map(str::to_string)
}

fn blocks(document: &Document, body: &[std::sync::Arc<WcBlock>]) -> Result<Vec<Block>, RichError> {
    body.iter()
        .map(|block| match &**block {
            WcBlock::Para(paragraph) => para(document, paragraph).map(Block::Para),
            WcBlock::Table(table) => self::table(document, table).map(Block::Table),
        })
        .collect()
}

fn table(document: &Document, table: &WcTable) -> Result<Table, RichError> {
    let bare = WcTable {
        rows: Vec::new(),
        ..table.clone()
    };
    let rows = table
        .rows
        .iter()
        .map(|row| {
            let bare = wordcraft_doc::Row {
                cells: Vec::new(),
                ..row.clone()
            };
            let cells = row
                .cells
                .iter()
                .map(|cell| {
                    let bare = wordcraft_doc::Cell {
                        blocks: Vec::new(),
                        ..cell.clone()
                    };
                    Ok(Cell {
                        k: Some(blob::encode(&bare)?),
                        span: (cell.span() > 1).then_some(cell.span() as u32),
                        blocks: blocks(document, &cell.blocks)?,
                    })
                })
                .collect::<Result<_, RichError>>()?;
            Ok(Row {
                k: Some(blob::encode(&bare)?),
                cells,
            })
        })
        .collect::<Result<_, RichError>>()?;
    Ok(Table {
        k: Some(blob::encode(&bare)?),
        rows,
    })
}

fn para(document: &Document, paragraph: &Paragraph) -> Result<Para, RichError> {
    let styles = &document.styles;
    let keep = ParaKeep {
        props: paragraph.props.clone(),
        mark: paragraph.mark.clone(),
    };
    let style = paragraph.props.style.as_deref();
    let mut c = Vec::new();
    let mut objects = paragraph.objects.iter();
    for (range, props) in paragraph.run_ranges() {
        let text = &paragraph.text[range];
        let k = blob::encode(props)?;
        let (m, href) = (marks(styles, style, props), props.link.clone());
        let f = look(styles, style, props);
        for (i, piece) in text.split(OBJ).enumerate() {
            if i > 0 {
                let object = objects.next().ok_or_else(|| {
                    RichError::Codec("paragraph has fewer objects than markers".into())
                })?;
                c.push(atom(document, props, object)?);
            }
            if !piece.is_empty() {
                c.push(Inline::Text {
                    x: piece.to_string(),
                    k: Some(k.clone()),
                    m: m.clone(),
                    href: href.clone(),
                    f: f.clone(),
                    ins: rev(document, props.ins),
                    del: rev(document, props.del),
                });
            }
        }
    }
    let empty = ParaKeep::default() == keep;
    let role = role(document, &paragraph.props);
    Ok(Para {
        role,
        align: align(styles, &paragraph.props),
        k: if empty {
            None
        } else {
            Some(blob::encode(&keep)?)
        },
        sect: paragraph
            .section
            .as_deref()
            .map(|section| {
                blob::encode(&SectKeep {
                    section: section.clone(),
                    parts: stories::of_section(document, section),
                })
                .map(String::into_boxed_str)
            })
            .transpose()?,
        page: paragraph
            .section
            .as_deref()
            .map(|section| Box::new(Page::of(section))),
        header: paragraph
            .section
            .as_deref()
            .and_then(|section| running::of(document, section.headers.default))
            .map(Box::new),
        footer: paragraph
            .section
            .as_deref()
            .and_then(|section| running::of(document, section.footers.default))
            .map(Box::new),
        p: layout(styles, &paragraph.props),
        s: (role == Role::Body)
            .then(|| style_of(document, &paragraph.props))
            .flatten()
            .map(String::into_boxed_str),
        f: Box::new(base(styles, style)),
        ins: rev(document, paragraph.mark.ins).map(Box::new),
        del: rev(document, paragraph.mark.del).map(Box::new),
        c,
    })
}

/// La revisione `index` del documento, come la proiezione la mostra.
fn rev(document: &Document, index: Option<u32>) -> Option<Rev> {
    let revision = document.revisions.get(index? as usize)?;
    Some(Rev {
        by: revision.author.clone(),
        at: revision.date.clone(),
        mv: revision.move_name.clone(),
    })
}

fn atom(
    document: &Document,
    props: &CharProps,
    object: &InlineObject,
) -> Result<Inline, RichError> {
    let (kind, label, size) = match object {
        InlineObject::Image { w, h, alt, .. } => (AtomKind::Image, alt.clone(), Some((*w, *h))),
        InlineObject::Graphic { w, h, alt, .. } => (AtomKind::Graphic, alt.clone(), Some((*w, *h))),
        InlineObject::Shape { w, h, .. } => (AtomKind::Shape, String::new(), Some((*w, *h))),
        InlineObject::Group { w, h, .. } => (AtomKind::Group, String::new(), Some((*w, *h))),
        InlineObject::Field { result, .. } => (AtomKind::Field, result.clone(), None),
        InlineObject::NoteRef { custom, .. } => (AtomKind::Note, custom.clone(), None),
        InlineObject::Equation { linear, .. } => (AtomKind::Equation, linear.clone(), None),
        InlineObject::Ruby { base, .. } => (AtomKind::Ruby, base.clone(), None),
        InlineObject::Opaque { text, .. } => (AtomKind::Opaque, text.clone(), None),
        other if other.is_marker() => (AtomKind::Marker, String::new(), None),
        _ => (AtomKind::Opaque, object.plain_text().to_string(), None),
    };
    Ok(Inline::Atom {
        k: Some(blob::encode(&AtomKeep {
            props: props.clone(),
            object: object.clone(),
            parts: stories::of_object(document, object),
        })?),
        kind,
        label,
        w: size.map(|(w, _)| w),
        h: size.map(|(_, h)| h),
        data: None,
        note: None,
        end: false,
        toc: None,
        comment: match object {
            InlineObject::CommentStart { id } => Some(Anchor {
                id: *id,
                end: false,
            }),
            InlineObject::CommentEnd { id } => Some(Anchor { id: *id, end: true }),
            _ => None,
        },
        ins: rev(document, props.ins),
        del: rev(document, props.del),
    })
}

/// L'enfasi che chi legge vede, stili compresi.
pub(crate) fn marks(styles: &StyleSheet, para_style: Option<&str>, props: &CharProps) -> Vec<Mark> {
    let resolved = styles.resolve_char(para_style, props);
    let mut out = Vec::new();
    if resolved.bold {
        out.push(Mark::B);
    }
    if resolved.italic {
        out.push(Mark::I);
    }
    if resolved.underline != Underline::None {
        out.push(Mark::U);
    }
    if resolved.strike || resolved.double_strike {
        out.push(Mark::S);
    }
    if resolved.highlight.is_some() {
        out.push(Mark::H);
    }
    match resolved.vert_align {
        VertAlign::Superscript => out.push(Mark::Sup),
        VertAlign::Subscript => out.push(Mark::Sub),
        VertAlign::Baseline => {}
    }
    if resolved.caps {
        out.push(Mark::Caps);
    }
    if resolved.small_caps {
        out.push(Mark::SmallCaps);
    }
    out
}

/// Il carattere e la dimensione del testo di un paragrafo con questo stile.
pub(crate) fn base(styles: &StyleSheet, para_style: Option<&str>) -> Look {
    let resolved = styles.resolve_char(para_style, &CharProps::default());
    Look {
        font: Some(resolved.font).filter(|font| !font.is_empty()),
        size: Some(resolved.size),
        ..Look::default()
    }
}

/// L'aspetto che chi legge vede, dove differisce da quello del paragrafo.
pub(crate) fn look(styles: &StyleSheet, para_style: Option<&str>, props: &CharProps) -> Look {
    let plain = styles.resolve_char(para_style, &CharProps::default());
    let resolved = styles.resolve_char(para_style, props);
    Look {
        font: (resolved.font != plain.font && !resolved.font.is_empty())
            .then(|| resolved.font.clone()),
        size: (!same_size(resolved.size, plain.size)).then_some(resolved.size),
        color: (resolved.color != plain.color).then(|| color_name(resolved.color)),
        hl: resolved
            .highlight
            .map(|rgb| format!("#{}", rgb.hex().to_ascii_lowercase()))
            .filter(|hex| hex != HIGHLIGHT_DEFAULT),
    }
}

/// Un colore del testo come lo scrive la proiezione.
pub(crate) fn color_name(color: TextColor) -> String {
    match color {
        TextColor::Auto => COLOR_AUTO.to_string(),
        TextColor::Rgb(rgb) => format!("#{}", rgb.hex().to_ascii_lowercase()),
    }
}

/// Il colore del testo di un nome della proiezione; `None` se non si legge.
pub(crate) fn color_of(name: &str) -> Option<TextColor> {
    if name == COLOR_AUTO {
        return Some(TextColor::Auto);
    }
    parse_hex(name).map(TextColor::Rgb)
}

/// L'evidenziatore di Word col colore dato; `None` se Word non lo ha.
pub(crate) fn highlight_of(name: &str) -> Option<Highlight> {
    let rgb = parse_hex(name)?;
    Highlight::ALL.into_iter().find(|h| h.rgb() == Some(rgb))
}

fn parse_hex(name: &str) -> Option<wordcraft_doc::props::Rgb> {
    name.strip_prefix('#')?;
    wordcraft_doc::props::Rgb::parse(name)
}

/// Le proprietà del paragrafo senza la sua disposizione diretta.
pub(crate) fn bare_layout(props: &ParaProps) -> ParaProps {
    ParaProps {
        indent_left: None,
        indent_right: None,
        indent_first: None,
        indent_left_chars: None,
        indent_right_chars: None,
        indent_first_chars: None,
        space_before: None,
        space_after: None,
        space_before_auto: None,
        space_after_auto: None,
        line_spacing: None,
        ..props.clone()
    }
}

/// La disposizione che chi legge vede, dove differisce da quella dello stile.
pub(crate) fn layout(styles: &StyleSheet, props: &ParaProps) -> Layout {
    let full = styles.resolve_para(props);
    let plain = styles.resolve_para(&bare_layout(props));
    let length = |a: f32, b: f32| (!same_size(a, b)).then_some(a);
    let (line, plain_line) = (Line::of(full.line_spacing), Line::of(plain.line_spacing));
    Layout {
        left: length(full.indent_left, plain.indent_left),
        right: length(full.indent_right, plain.indent_right),
        first: length(full.indent_first, plain.indent_first),
        before: length(full.space_before, plain.space_before),
        after: length(full.space_after, plain.space_after),
        line: (!line.same(plain_line)).then_some(line),
    }
}

pub(crate) fn align(styles: &StyleSheet, props: &ParaProps) -> Option<Align> {
    match styles.resolve_para(props).align {
        WcAlign::Center => Some(Align::Center),
        WcAlign::Right => Some(Align::Right),
        WcAlign::Justify => Some(Align::Justify),
        _ => None,
    }
}

/// Il ruolo di un paragrafo con queste proprietà, nel documento dato.
pub(crate) fn role(document: &Document, props: &ParaProps) -> Role {
    let resolved = document.styles.resolve_para(props);
    if let Some(level) = resolved.outline_level.filter(|level| *level < 9) {
        return Role::Heading { level: level + 1 };
    }
    if let Some(numbering) = resolved.numbering.filter(|n| n.num != 0) {
        if let Some(level) = document.numbering.level(numbering.num, numbering.level) {
            match level.format {
                wordcraft_doc::section::NumFormat::None => {}
                wordcraft_doc::section::NumFormat::Bullet => {
                    return Role::List {
                        ordered: false,
                        level: numbering.level.min(8),
                    }
                }
                _ => {
                    return Role::List {
                        ordered: true,
                        level: numbering.level.min(8),
                    }
                }
            }
        }
    }
    if is_quote(&document.styles, props.style.as_deref()) {
        return Role::Quote;
    }
    Role::Body
}

/// Uno stile di citazione, o uno che ne eredita. Word scrive i nomi degli stili
/// predefiniti sempre in inglese, anche quando l'id è tradotto: il nome basta
/// così com'è, senza regole di maiuscole.
pub(crate) fn is_quote(styles: &StyleSheet, style: Option<&str>) -> bool {
    style.is_some_and(|id| {
        styles.chain(id).iter().any(|s| {
            matches!(s.id.as_str(), "Quote" | "IntenseQuote")
                || matches!(s.name.as_str(), "Quote" | "Intense Quote")
        })
    })
}
