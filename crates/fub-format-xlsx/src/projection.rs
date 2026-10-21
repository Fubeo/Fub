//! La proiezione di una cartella per la superficie della griglia.
//!
//! È JSON chiuso e versionato ([`VERSION`]): la shell lo legge con un parser
//! che rifiuta i campi sconosciuti, e la fixture
//! `apps/client/src/__fixtures__/xlsx-projection.json` lega le due parti.
//!
//! Che cosa porta:
//!
//! - per ogni foglio, il nome, se è nascosto, quante righe e colonne mostrare
//!   (fino all'ultima cella con un valore o un riempimento), le dimensioni di
//!   riga e colonna del foglio e quelle delle linee che ne hanno una sua, in
//!   pixel;
//! - per ogni cella da mostrare, la formula così come la scrive Excel nella
//!   barra, il valore già formattato con il formato numerico della cella, il
//!   suo tipo e l'aspetto che la griglia sa disegnare (grassetto, corsivo,
//!   colori, allineamento);
//! - gli avvisi: le macro che non si eseguono, i collegamenti ad altre
//!   cartelle che non si aggiornano, ciò che la lettura ha lasciato indietro,
//!   ciò che la griglia non mostra, i valori ricalcolati e le celle che non
//!   entrano nel limite.
//!
//! I colori seguono il tema chiaro e scuro della shell: il testo «automatico»
//! (o il nero del tema) su una cella senza riempimento non porta un colore, e
//! prende quello della shell; su una cella riempita resta quello del file, nero
//! se automatico, perché il riempimento è del file.

use std::collections::{BTreeMap, BTreeSet};

use gridcraft_calc::Calc;
use gridcraft_core::{CellRef, Value as GcValue};
use gridcraft_model::style::{Color, HAlign, PatternType, Style as GcStyle};
use gridcraft_model::{Sheet as GcSheet, Visibility, Workbook};
use gridcraft_numfmt::{format_value, FormatColor, NumberFormat};
use gridcraft_xlsx::ReadReport;
use serde::{Deserialize, Serialize};

use crate::{XlsxError, MAX_PROJECTION_BYTES};

/// La versione dello schema.
pub const VERSION: u32 = 1;

/// Lo spazio che la proiezione tiene per gli avvisi aggiunti dopo le celle.
const NOTICE_HEADROOM: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Projection {
    pub version: u32,
    /// L'indice del foglio attivo nel file.
    pub active: usize,
    pub notices: Vec<Notice>,
    pub sheets: Vec<Sheet>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Notice {
    pub kind: NoticeKind,
    /// Per [`NoticeKind::Incomplete`], l'avviso del codec (in inglese, come lo
    /// scrive GridCraft); per [`NoticeKind::NotShown`], la parte non mostrata
    /// ([`NotShown`]); per [`NoticeKind::Truncated`], il foglio dove la
    /// proiezione si ferma.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    /// La cartella ha macro VBA: non si eseguono.
    Macros,
    /// La cartella prende valori da altre cartelle: non si aggiornano.
    ExternalLinks,
    /// La lettura ha lasciato indietro o riparato qualcosa.
    Incomplete,
    /// La griglia non mostra una parte della cartella.
    NotShown,
    /// Alcuni valori non sono del file: li ha calcolati Fub.
    Recalculated,
    /// Le celle oltre il limite della proiezione non ci sono.
    Truncated,
}

/// Le parti di una cartella che la griglia non disegna.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum NotShown {
    Merges,
    Charts,
    Images,
    Shapes,
    Comments,
    ConditionalFormats,
    Sparklines,
}

impl NotShown {
    pub const ALL: [NotShown; 7] = [
        NotShown::Merges,
        NotShown::Charts,
        NotShown::Images,
        NotShown::Shapes,
        NotShown::Comments,
        NotShown::ConditionalFormats,
        NotShown::Sparklines,
    ];

    pub fn id(self) -> &'static str {
        match self {
            NotShown::Merges => "merges",
            NotShown::Charts => "charts",
            NotShown::Images => "images",
            NotShown::Shapes => "shapes",
            NotShown::Comments => "comments",
            NotShown::ConditionalFormats => "conditional_formats",
            NotShown::Sparklines => "sparklines",
        }
    }

    fn present(self, sheet: &GcSheet) -> bool {
        match self {
            NotShown::Merges => !sheet.merges.is_empty(),
            NotShown::Charts => !sheet.charts.is_empty(),
            NotShown::Images => !sheet.images.is_empty() || !sheet.cell_pictures.is_empty(),
            NotShown::Shapes => !sheet.shapes.is_empty() || !sheet.slicers.is_empty(),
            NotShown::Comments => !sheet.comments.is_empty(),
            NotShown::ConditionalFormats => !sheet.cond_formats.is_empty(),
            NotShown::Sparklines => !sheet.sparklines.is_empty(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sheet {
    pub name: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    pub row_count: u32,
    pub column_count: u32,
    /// L'altezza di una riga senza la sua, in pixel.
    pub row_height: f32,
    /// La larghezza di una colonna senza la sua, in pixel.
    pub column_width: f32,
    /// Le righe con un'altezza loro o nascoste, entro `row_count`.
    pub rows: Vec<Line>,
    /// Le colonne con una larghezza loro o nascoste, entro `column_count`.
    pub columns: Vec<Line>,
    /// Le celle in ordine di riga e di colonna.
    pub cells: Vec<Cell>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    /// La posizione, da 0.
    pub index: u32,
    /// In pixel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f32>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    /// La riga, da 0.
    pub row: u32,
    /// La colonna, da 0.
    pub col: u32,
    /// La formula come la mostra la barra: `=…`, o `{=…}` per una matrice
    /// legacy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<Style>,
    /// Il valore non è nel file: l'ha calcolato Fub.
    #[serde(default, skip_serializing_if = "is_false")]
    pub derived: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Value {
    pub kind: ValueKind,
    /// Il valore come lo mostra la cella, con il suo formato numerico.
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValueKind {
    Number,
    Text,
    Boolean,
    Error,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Style {
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    /// `#RRGGBB`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    /// `#RRGGBB`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<Horizontal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Horizontal {
    Start,
    Center,
    End,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl Projection {
    /// Il JSON della proiezione, entro [`MAX_PROJECTION_BYTES`].
    pub fn to_json(&self) -> Result<String, XlsxError> {
        let json = serde_json::to_string(self)
            .map_err(|error| XlsxError::Crashed(format!("projection: {error}")))?;
        if json.len() > MAX_PROJECTION_BYTES {
            return Err(XlsxError::TooLarge(json.len()));
        }
        Ok(json)
    }

    pub fn from_json(json: &str) -> Result<Projection, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// La proiezione di una cartella letta.
pub fn project(workbook: &Workbook, report: &ReadReport) -> Projection {
    let mut notices: BTreeSet<(NoticeKind, Option<String>)> = BTreeSet::new();
    if workbook.vba_project.is_some() {
        notices.insert((NoticeKind::Macros, None));
    }
    for warning in &report.warnings {
        let kind = classify(warning);
        let detail = (kind == NoticeKind::Incomplete).then(|| warning.clone());
        if kind != NoticeKind::Macros || workbook.vba_project.is_some() {
            notices.insert((kind, detail));
        }
    }
    for part in NotShown::ALL {
        if workbook.sheets.iter().any(|sheet| part.present(sheet)) {
            notices.insert((NoticeKind::NotShown, Some(part.id().to_string())));
        }
    }

    let derived = derived_values(workbook, &mut notices);
    let mut budget = MAX_PROJECTION_BYTES - NOTICE_HEADROOM;
    let mut sheets = Vec::with_capacity(workbook.sheets.len());
    for (index, sheet) in workbook.sheets.iter().enumerate() {
        let empty = BTreeMap::new();
        let derived = derived.get(index).unwrap_or(&empty);
        let (projected, truncated) = project_sheet(workbook, sheet, derived, &mut budget);
        if truncated {
            notices.insert((NoticeKind::Truncated, Some(sheet.name.clone())));
        }
        sheets.push(projected);
    }
    if derived.iter().any(|cells| !cells.is_empty()) {
        notices.insert((NoticeKind::Recalculated, None));
    }
    Projection {
        version: VERSION,
        active: workbook
            .active_sheet
            .min(workbook.sheets.len().saturating_sub(1)),
        notices: notices
            .into_iter()
            .map(|(kind, detail)| Notice { kind, detail })
            .collect(),
        sheets,
    }
}

/// Il tipo di avviso di un messaggio della lettura di GridCraft.
pub fn classify(warning: &str) -> NoticeKind {
    if warning.starts_with("macros (VBA project) were kept") {
        // Le macro ci sono e non si eseguono: lo dice già il progetto VBA.
        NoticeKind::Macros
    } else if warning.starts_with("links to external workbooks were kept") {
        NoticeKind::ExternalLinks
    } else {
        NoticeKind::Incomplete
    }
}

/// I valori che il file non ha e che le formule danno: le celle versate dalle
/// matrici, che il lettore scarta, e le formule salvate senza un valore. Il
/// calcolo gira su una copia; ogni altro valore resta quello del file.
fn derived_values(
    workbook: &Workbook,
    notices: &mut BTreeSet<(NoticeKind, Option<String>)>,
) -> Vec<BTreeMap<CellRef, GcValue>> {
    let has_formulas = workbook
        .sheets
        .iter()
        .any(|sheet| sheet.cells.iter().any(|(_, cell)| cell.formula.is_some()));
    if !has_formulas {
        return Vec::new();
    }
    let mut copy = workbook.clone();
    let recalculated = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        Calc::new().recalc_all(&mut copy);
    }));
    if let Err(panic) = recalculated {
        notices.insert((
            NoticeKind::Incomplete,
            Some(format!(
                "array results could not be recalculated: {}",
                crate::panic_message(panic.as_ref())
            )),
        ));
        return Vec::new();
    }
    workbook
        .sheets
        .iter()
        .zip(&copy.sheets)
        .map(|(original, computed)| {
            let mut cells = BTreeMap::new();
            for (at, value) in &computed.spill {
                if original.value(*at).is_empty() && !value.is_empty() {
                    cells.insert(*at, value.clone());
                }
            }
            for (at, cell) in original.cells.iter() {
                if cell.formula.is_some() && cell.value.is_empty() {
                    let value = computed.value(at);
                    if !value.is_empty() {
                        cells.insert(at, value);
                    }
                }
            }
            cells
        })
        .collect()
}

/// Un foglio, con le celle che entrano in `budget` byte. Dice se si è fermato
/// prima della fine.
fn project_sheet(
    workbook: &Workbook,
    sheet: &GcSheet,
    derived: &BTreeMap<CellRef, GcValue>,
    budget: &mut usize,
) -> (Sheet, bool) {
    let mut cells = Vec::new();
    let mut truncated = false;
    let mut stored = sheet.cells.iter().peekable();
    let mut computed = derived.iter().peekable();
    loop {
        // Le celle del file e quelle calcolate, insieme in ordine di riga e
        // di colonna; una cella calcolata vuota nel file ha il valore nuovo.
        let order = |at: &CellRef| (at.row, at.col);
        let next = match (stored.peek(), computed.peek()) {
            (None, None) => break,
            (Some((at, _)), Some((other, _))) if order(other) < order(at) => {
                let (at, value) = computed.next().expect("peeked");
                project_cell(workbook, sheet, *at, None, Some(value))
            }
            (Some((at, _)), Some((other, _))) if order(other) == order(at) => {
                let (at, cell) = stored.next().expect("peeked");
                let (_, value) = computed.next().expect("peeked");
                project_cell(workbook, sheet, at, Some(cell), Some(value))
            }
            (Some(_), _) => {
                let (at, cell) = stored.next().expect("peeked");
                project_cell(workbook, sheet, at, Some(cell), None)
            }
            (None, Some(_)) => {
                let (at, value) = computed.next().expect("peeked");
                project_cell(workbook, sheet, *at, None, Some(value))
            }
        };
        let Some(cell) = next else { continue };
        let size = serde_json::to_vec(&cell).map_or(usize::MAX, |json| json.len() + 1);
        if size > *budget {
            truncated = true;
            break;
        }
        *budget -= size;
        cells.push(cell);
    }

    let row_count = cells.iter().map(|cell| cell.row + 1).max().unwrap_or(1);
    let column_count = cells.iter().map(|cell| cell.col + 1).max().unwrap_or(1);
    let lines = |map: &BTreeMap<u32, gridcraft_model::LineInfo>, count: u32| -> Vec<Line> {
        map.range(..count)
            .filter(|(_, info)| info.size.is_some() || info.hidden)
            .map(|(index, info)| Line {
                index: *index,
                size: info.size.filter(|size| size.is_finite() && *size > 0.0),
                hidden: info.hidden,
            })
            .filter(|line| line.size.is_some() || line.hidden)
            .collect()
    };
    let projected = Sheet {
        name: sheet.name.clone(),
        hidden: sheet.visibility != Visibility::Visible,
        row_count,
        column_count,
        row_height: positive(sheet.default_row_height, 20.0),
        column_width: positive(sheet.default_col_width, 64.0),
        rows: lines(&sheet.rows, row_count),
        columns: lines(&sheet.cols, column_count),
        cells,
    };
    (projected, truncated)
}

fn positive(size: f32, fallback: f32) -> f32 {
    if size.is_finite() && size > 0.0 {
        size
    } else {
        fallback
    }
}

/// Una cella da mostrare, o `None` se non ha niente da far vedere: né
/// formula, né valore, né riempimento.
fn project_cell(
    workbook: &Workbook,
    sheet: &GcSheet,
    at: CellRef,
    stored: Option<&gridcraft_model::Cell>,
    computed: Option<&GcValue>,
) -> Option<Cell> {
    let formula = stored
        .filter(|cell| cell.formula.is_some())
        .map(|cell| cell.bar_text());
    let (value, derived) = match (stored.map(|cell| &cell.value), computed) {
        (Some(value), _) if !value.is_empty() => (value.clone(), false),
        (_, Some(value)) => (value.clone(), true),
        _ => (GcValue::Empty, false),
    };
    let style = workbook.styles.get(sheet.style_id(at));
    let formatted = format_value(
        &value,
        &NumberFormat::parse_cached(style.num_fmt.as_str()),
        workbook.date_system,
    );
    let kind = match &value {
        GcValue::Empty => None,
        GcValue::Number(_) => Some(ValueKind::Number),
        GcValue::Text(_) => Some(ValueKind::Text),
        GcValue::Bool(_) => Some(ValueKind::Boolean),
        GcValue::Error(_) => Some(ValueKind::Error),
        GcValue::Array(array) => match array.data.first() {
            Some(GcValue::Number(_)) => Some(ValueKind::Number),
            Some(GcValue::Bool(_)) => Some(ValueKind::Boolean),
            Some(GcValue::Error(_)) => Some(ValueKind::Error),
            Some(GcValue::Text(_)) => Some(ValueKind::Text),
            _ => None,
        },
    };
    let value = kind.map(|kind| Value {
        kind,
        text: formatted.text.clone(),
    });
    let style = cell_style(workbook, style, kind, formatted.numeric, formatted.color);
    if formula.is_none() && value.is_none() && style.fill_color.is_none() {
        return None;
    }
    Some(Cell {
        row: at.row,
        col: at.col,
        formula,
        value,
        style: (style != Style::default()).then_some(style),
        derived,
    })
}

fn cell_style(
    workbook: &Workbook,
    style: &GcStyle,
    kind: Option<ValueKind>,
    numeric: bool,
    format_color: Option<FormatColor>,
) -> Style {
    let theme = &workbook.theme;
    let fill_color = (style.fill.pattern == PatternType::Solid)
        .then(|| style.fill.fg.hex(theme))
        .flatten();
    let text_color = match format_color {
        Some(color) => Some(format_color_hex(color)),
        None => {
            let automatic = match style.font.color {
                Color::Auto => true,
                Color::Theme(1, 0) => true,
                ref color => color.hex(theme).as_deref() == Some("#000000"),
            };
            if fill_color.is_some() {
                // Il riempimento è del file, e il testo che ci sta sopra
                // anche: il nero di Excel, non il colore della shell.
                style
                    .font
                    .color
                    .hex(theme)
                    .or_else(|| Some("#000000".to_string()))
            } else if automatic {
                None
            } else {
                style.font.color.hex(theme)
            }
        }
    };
    let horizontal = match style.align.h {
        HAlign::Left => Some(Horizontal::Start),
        HAlign::Center | HAlign::CenterAcross => Some(Horizontal::Center),
        HAlign::Right => Some(Horizontal::End),
        HAlign::General => match kind {
            Some(ValueKind::Number) if numeric => Some(Horizontal::End),
            Some(ValueKind::Boolean | ValueKind::Error) => Some(Horizontal::Center),
            _ => None,
        },
        HAlign::Fill | HAlign::Justify | HAlign::Distributed => None,
    };
    Style {
        bold: style.font.bold,
        italic: style.font.italic,
        text_color,
        fill_color,
        horizontal,
    }
}

/// I colori dei formati numerici (`[Red]`, `[Color10]`), come li disegna
/// Excel.
fn format_color_hex(color: FormatColor) -> String {
    let rgb = match color {
        FormatColor::Black => 0x000000,
        FormatColor::Blue => 0x0000FF,
        FormatColor::Cyan => 0x00FFFF,
        FormatColor::Green => 0x00FF00,
        FormatColor::Magenta => 0xFF00FF,
        FormatColor::Red => 0xFF0000,
        FormatColor::White => 0xFFFFFF,
        FormatColor::Yellow => 0xFFFF00,
        // `[ColorN]` è la voce N della tavolozza a 56 colori, che comincia
        // dall'ottava voce di quella indicizzata.
        FormatColor::Indexed(n) => INDEXED_PALETTE
            .get(usize::from(n).saturating_sub(1))
            .copied()
            .unwrap_or(0),
    };
    format!("#{rgb:06X}")
}

/// Le 56 voci della tavolozza legacy di Excel (indici 8–63 della tavolozza
/// indicizzata di SpreadsheetML).
const INDEXED_PALETTE: [u32; 56] = [
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, 0x800000,
    0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080, 0x9999FF, 0x993366,
    0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF, 0x000080, 0xFF00FF, 0xFFFF00,
    0x00FFFF, 0x800080, 0x800000, 0x008080, 0x0000FF, 0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99,
    0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99, 0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00, 0xFF9900,
    0xFF6600, 0x666699, 0x969696, 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366,
    0x333399, 0x333333,
];
