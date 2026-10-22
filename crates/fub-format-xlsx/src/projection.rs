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
//!   ciò che la griglia non mostra, le formule senza un valore salvato e le
//!   celle che non entrano nei limiti.
//!
//! Nessun valore si calcola: ogni valore è quello che il file ha salvato,
//! comprese le celle versate dalle matrici. Una formula senza valore salvato
//! mostra la formula e una cella vuota.
//!
//! Due limiti tengono la proiezione piccola per la shell, che la legge in una
//! volta: i byte ([`MAX_PROJECTION_BYTES`]) e le righe e colonne di tutti i
//! fogli insieme ([`MAX_LINES`]), perché la griglia tiene una voce per ogni
//! riga e colonna fino all'ultima cella. I fogli li prendono in ordine, e
//! quello dove una cella resta fuori lo dice.
//!
//! I colori seguono il tema chiaro e scuro della shell: il testo «automatico»
//! (o il nero del tema) su una cella senza riempimento non porta un colore, e
//! prende quello della shell; su una cella riempita resta quello del file, nero
//! se automatico, perché il riempimento è del file.

use std::collections::{BTreeMap, BTreeSet};

use gridcraft_core::{CellRef, Value as GcValue};
use gridcraft_model::style::{Color, HAlign, PatternType, Style as GcStyle};
use gridcraft_model::{Sheet as GcSheet, Visibility, Workbook};
use gridcraft_numfmt::{format_value, FormatColor, NumberFormat};
use gridcraft_xlsx::ReadReport;
use serde::{Deserialize, Serialize};

use crate::{XlsxError, MAX_PROJECTION_BYTES};

/// La versione dello schema.
pub const VERSION: u32 = 1;

/// Le righe e le colonne di tutti i fogli insieme: la griglia ne tiene una
/// voce ciascuna, e un foglio che arriva all'ultima cella di Excel ne
/// avrebbe più di un milione.
pub const MAX_LINES: u32 = 262_144;
/// Le colonne che un foglio prende al più dalle righe e colonne che restano:
/// le righe, che sono di più, si prendono il resto.
const COLUMN_SHARE: u32 = 4;

/// Lo spazio che la proiezione tiene per gli avvisi aggiunti dopo le celle.
const NOTICE_HEADROOM: usize = 64 * 1024;
/// Lo spazio di un foglio senza le righe, le colonne e le celle: il nome è a
/// parte.
const SHEET_OVERHEAD: usize = 256;

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
    /// Alcune formule non hanno un valore salvato nel file: Fub non le
    /// calcola, e la cella resta vuota.
    Uncomputed,
    /// Le celle oltre i limiti della proiezione non ci sono.
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

    let mut budget = Budget {
        bytes: MAX_PROJECTION_BYTES - NOTICE_HEADROOM,
        lines: MAX_LINES,
    };
    let mut sheets = Vec::with_capacity(workbook.sheets.len());
    for sheet in &workbook.sheets {
        let projected = project_sheet(workbook, sheet, &mut budget);
        if projected.truncated {
            notices.insert((NoticeKind::Truncated, Some(sheet.name.clone())));
        }
        if projected.uncomputed {
            notices.insert((NoticeKind::Uncomputed, None));
        }
        sheets.push(projected.sheet);
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

/// Ciò che resta da spendere ai fogli che seguono.
struct Budget {
    bytes: usize,
    lines: u32,
}

/// Un foglio proiettato, con ciò che gli avvisi devono dire.
struct Projected {
    sheet: Sheet,
    /// Una cella non c'è: è fuori dalle righe e colonne o dai byte rimasti.
    truncated: bool,
    /// Una formula non ha un valore salvato.
    uncomputed: bool,
}

/// Un foglio, con le righe, le colonne e le celle che entrano in `budget`.
fn project_sheet(workbook: &Workbook, sheet: &GcSheet, budget: &mut Budget) -> Projected {
    // Fin dove arriva ciò che il foglio mostra.
    let (mut rows, mut columns) = (0u32, 0u32);
    for (at, cell, value) in entries(sheet) {
        if shows(workbook, sheet, at, cell, value) {
            rows = rows.max(at.row + 1);
            columns = columns.max(at.col + 1);
        }
    }
    let columns = columns.min(budget.lines / COLUMN_SHARE).max(1);
    let rows = rows.min(budget.lines.saturating_sub(columns)).max(1);
    let mut truncated = false;
    let lines = |map: &BTreeMap<u32, gridcraft_model::LineInfo>, count: u32| -> Vec<Line> {
        map.range(..count)
            .map(|(index, info)| Line {
                index: *index,
                size: info.size.filter(|size| size.is_finite() && *size > 0.0),
                hidden: info.hidden,
            })
            .filter(|line| line.size.is_some() || line.hidden)
            .collect()
    };
    // Le righe e le colonne con una misura loro si pagano prima delle celle,
    // le colonne per prime: una che non entra ferma il foglio prima di lei.
    let mut room = budget
        .bytes
        .saturating_sub(SHEET_OVERHEAD + json_len(&sheet.name));
    let mut column_lines = lines(&sheet.cols, columns);
    let columns = paid(&mut column_lines, columns, &mut room, &mut truncated);
    let mut row_lines = lines(&sheet.rows, rows);
    let rows = paid(&mut row_lines, rows, &mut room, &mut truncated);
    budget.bytes = room;

    let mut cells = Vec::new();
    let mut uncomputed = false;
    for (at, cell, value) in entries(sheet) {
        if !shows(workbook, sheet, at, cell, value) {
            continue;
        }
        if at.row >= rows || at.col >= columns {
            truncated = true;
            continue;
        }
        let cell = project_cell(
            workbook,
            sheet,
            at,
            cell,
            value.cloned().unwrap_or(GcValue::Empty),
        );
        uncomputed |= cell.formula.is_some() && cell.value.is_none();
        let size = json_len(&cell) + 1;
        if size > budget.bytes {
            truncated = true;
            break;
        }
        budget.bytes -= size;
        cells.push(cell);
    }

    let row_count = cells.iter().map(|cell| cell.row + 1).max().unwrap_or(1);
    let column_count = cells.iter().map(|cell| cell.col + 1).max().unwrap_or(1);
    budget.lines = budget.lines.saturating_sub(row_count + column_count);
    // Le linee oltre l'ultima cella non vanno nella proiezione, e il loro
    // spazio torna ai fogli che seguono.
    for (lines, count) in [
        (&mut row_lines, row_count),
        (&mut column_lines, column_count),
    ] {
        let kept = lines.partition_point(|line| line.index < count);
        budget.bytes += lines[kept..]
            .iter()
            .map(|line| json_len(line) + 1)
            .sum::<usize>();
        lines.truncate(kept);
    }
    Projected {
        sheet: Sheet {
            name: sheet.name.clone(),
            hidden: sheet.visibility != Visibility::Visible,
            row_count,
            column_count,
            row_height: positive(sheet.default_row_height, 20.0),
            column_width: positive(sheet.default_col_width, 64.0),
            rows: row_lines,
            columns: column_lines,
            cells,
        },
        truncated,
        uncomputed,
    }
}

/// Le celle del foglio e i valori versati dalle matrici, che il lettore tiene
/// a parte, insieme in ordine di riga e di colonna, ciascuna con il valore
/// che mostra.
fn entries(
    sheet: &GcSheet,
) -> impl Iterator<Item = (CellRef, Option<&gridcraft_model::Cell>, Option<&GcValue>)> {
    let order = |at: &CellRef| (at.row, at.col);
    let mut stored = sheet.cells.iter().peekable();
    let mut spilled = sheet.spill.iter().peekable();
    std::iter::from_fn(move || {
        let take_spilled = match (stored.peek(), spilled.peek()) {
            (None, None) => return None,
            (Some((at, _)), Some((other, _))) => {
                if order(other) == order(at) {
                    // La cella del file vince: il valore versato non si vede.
                    spilled.next();
                    false
                } else {
                    order(other) < order(at)
                }
            }
            (None, Some(_)) => true,
            (Some(_), None) => false,
        };
        Some(if take_spilled {
            let (at, value) = spilled.next().expect("peeked");
            (*at, None, Some(value))
        } else {
            let (at, cell) = stored.next().expect("peeked");
            (at, Some(cell), sheet.value_ref(at))
        })
    })
}

/// Se una cella ha qualcosa da far vedere: una formula, un valore o un
/// riempimento. Le altre non vanno nella proiezione.
fn shows(
    workbook: &Workbook,
    sheet: &GcSheet,
    at: CellRef,
    cell: Option<&gridcraft_model::Cell>,
    value: Option<&GcValue>,
) -> bool {
    if cell.is_some_and(|cell| cell.formula.is_some())
        || value.is_some_and(|value| !value.is_empty())
    {
        return true;
    }
    let style = workbook.styles.get(sheet.style_id(at));
    style.fill.pattern == PatternType::Solid && style.fill.fg.hex(&workbook.theme).is_some()
}

/// Paga le `lines` di un asse da `room`, in ordine. La prima che non entra
/// ferma l'asse prima di lei, insieme alle linee che seguono: il conto che
/// resta è quello delle linee pagate.
fn paid(lines: &mut Vec<Line>, count: u32, room: &mut usize, truncated: &mut bool) -> u32 {
    for (at, line) in lines.iter().enumerate() {
        let size = json_len(line) + 1;
        if size > *room {
            let end = line.index.max(1);
            lines.truncate(at);
            *truncated = true;
            return end;
        }
        *room -= size;
    }
    count
}

/// Quanti byte pesa `value` nel JSON della proiezione.
fn json_len(value: &impl Serialize) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX / 2, |json| json.len())
}

fn positive(size: f32, fallback: f32) -> f32 {
    if size.is_finite() && size > 0.0 {
        size
    } else {
        fallback
    }
}

/// Una cella da mostrare, che [`shows`] ha scelto.
fn project_cell(
    workbook: &Workbook,
    sheet: &GcSheet,
    at: CellRef,
    stored: Option<&gridcraft_model::Cell>,
    value: GcValue,
) -> Cell {
    let formula = stored
        .filter(|cell| cell.formula.is_some())
        .map(|cell| cell.bar_text());
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
    Cell {
        row: at.row,
        col: at.col,
        formula,
        value,
        style: (style != Style::default()).then_some(style),
    }
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
