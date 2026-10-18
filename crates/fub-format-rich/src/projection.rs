//! La proiezione modificabile, versione 1: il documento come lo vede e lo
//! scrive la superficie ricca della shell.
//!
//! È JSON chiuso (`deny_unknown_fields`) e versionato. Mostra in chiaro ciò che
//! la superficie modifica — testo, enfasi, aspetto del carattere, link, ruolo
//! dei paragrafi — e porta tutto il resto come dati opachi (vedi `blob`). I
//! campi `align`, l'aspetto `f` di un paragrafo, `label`, `w` e `h` sono
//! soltanto suggerimenti di resa: il ritorno al documento li ignora.
//!
//! Il testo di un tratto è quello del modello di WordCraft: `\n` è un a-capo
//! nel paragrafo, `\t` una tabulazione, U+000C un salto pagina e U+000E un
//! salto colonna. U+FFFC non compare mai nel testo: un oggetto è un [`Inline::Atom`].

use serde::{Deserialize, Serialize};
use wordcraft_doc::para::OBJ;
use wordcraft_doc::props::{Highlight, TextColor, Underline, VertAlign};
use wordcraft_doc::{
    Align as WcAlign, Block as WcBlock, CharProps, Document, InlineObject, ParaProps, Paragraph,
    StyleSheet, Table as WcTable,
};

use crate::blob;
use crate::RichError;

/// Il nome del formato della proiezione.
pub const FORMAT: &str = "fub-rich";
/// La versione che questo crate scrive e legge.
pub const VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Projection {
    pub format: String,
    pub version: u32,
    /// Perché il documento non si modifica, quando non si modifica.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readonly: Option<crate::ReadOnly>,
    /// La lingua predefinita del documento, per il correttore.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    pub blocks: Vec<Block>,
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
    /// Suggerimento: l'allineamento risolto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    /// Proprietà del paragrafo e del suo segno di fine, opache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k: Option<String>,
    /// La sezione che il paragrafo chiude, opaca.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sect: Option<String>,
    /// Suggerimento: il carattere e la dimensione del testo che non ne
    /// sceglie altri, come li dà lo stile del paragrafo.
    #[serde(default, skip_serializing_if = "Look::is_plain")]
    pub f: Look,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub c: Vec<Inline>,
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
    },
    Atom {
        /// Le proprietà del carattere e l'oggetto, opachi.
        k: String,
        kind: AtomKind,
        /// Suggerimento: ciò che l'oggetto mostra o descrive.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        label: String,
        /// Suggerimento: dimensioni in punti, per ciò che occupa spazio.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        w: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        h: Option<f32>,
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
    /// La tabella senza righe, opaca.
    pub k: String,
    pub rows: Vec<Row>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    /// La riga senza celle, opaca.
    pub k: String,
    pub cells: Vec<Cell>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    /// La cella senza contenuto, opaca.
    pub k: String,
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

/// Un oggetto opaco: le proprietà del suo carattere e l'oggetto.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct AtomKeep {
    pub props: CharProps,
    pub object: InlineObject,
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
        if projection.version != VERSION {
            return Err(RichError::Version(projection.version));
        }
        Ok(projection)
    }

    pub fn to_json(&self) -> Result<String, RichError> {
        serde_json::to_string(self).map_err(|error| RichError::Codec(error.to_string()))
    }
}

/// Proietta un documento. `document` ha già i tratti normalizzati
/// (`Document::normalize_runs`): due tratti uguali vicini sono uno solo, come
/// la superficie li mostra.
pub(crate) fn project(document: &Document) -> Result<Projection, RichError> {
    Ok(Projection {
        format: FORMAT.to_string(),
        version: VERSION,
        readonly: None,
        lang: document.styles.default_chr.lang.clone(),
        blocks: blocks(document, &document.body)?,
    })
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
                        k: blob::encode(&bare)?,
                        blocks: blocks(document, &cell.blocks)?,
                    })
                })
                .collect::<Result<_, RichError>>()?;
            Ok(Row {
                k: blob::encode(&bare)?,
                cells,
            })
        })
        .collect::<Result<_, RichError>>()?;
    Ok(Table {
        k: blob::encode(&bare)?,
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
                c.push(atom(props, object)?);
            }
            if !piece.is_empty() {
                c.push(Inline::Text {
                    x: piece.to_string(),
                    k: Some(k.clone()),
                    m: m.clone(),
                    href: href.clone(),
                    f: f.clone(),
                });
            }
        }
    }
    let empty = ParaKeep::default() == keep;
    Ok(Para {
        role: role(document, &paragraph.props),
        align: align(styles, &paragraph.props),
        k: if empty {
            None
        } else {
            Some(blob::encode(&keep)?)
        },
        sect: paragraph.section.as_deref().map(blob::encode).transpose()?,
        f: base(styles, style),
        c,
    })
}

fn atom(props: &CharProps, object: &InlineObject) -> Result<Inline, RichError> {
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
        k: blob::encode(&AtomKeep {
            props: props.clone(),
            object: object.clone(),
        })?,
        kind,
        label,
        w: size.map(|(w, _)| w),
        h: size.map(|(_, h)| h),
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

fn align(styles: &StyleSheet, props: &ParaProps) -> Option<Align> {
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
