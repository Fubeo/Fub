//! Ciò che la griglia mostra di una cartella: quali celle hanno qualcosa da
//! far vedere, il loro aspetto, e le parti e gli avvisi che la griglia non
//! disegna ma dice.
//!
//! Nessun valore si calcola: ogni valore è quello che il file ha salvato,
//! comprese le celle versate dalle matrici, che il lettore tiene a parte.
//!
//! I colori seguono il tema chiaro e scuro della shell: il testo «automatico»
//! (o il nero del tema) su una cella senza riempimento non porta un colore, e
//! prende quello della shell; su una cella riempita resta quello del file, nero
//! se automatico, perché il riempimento è del file.

use fub_abi::{GridCellStyle, GridHorizontalAlign};
use gridcraft_core::{CellRef, Value as GcValue};
use gridcraft_model::style::{Color, HAlign, PatternType, Style as GcStyle};
use gridcraft_model::{Sheet as GcSheet, Workbook};
use gridcraft_numfmt::FormatColor;

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

    pub(crate) fn present(self, sheet: &GcSheet) -> bool {
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

/// Che cosa dice un messaggio della lettura di GridCraft.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Warning {
    /// La cartella ha macro VBA: lo dice già il progetto VBA.
    Macros,
    /// La cartella prende valori da altre cartelle: non si aggiornano.
    ExternalLinks,
    /// La lettura ha lasciato indietro o riparato qualcosa.
    Incomplete,
}

/// Il tipo di un messaggio della lettura. Ogni messaggio che non dice macro o
/// collegamenti tenuti è qualcosa che la lettura ha lasciato indietro, anche
/// quando dice che il codec lo terrebbe per salvare: l'innesto non salva con
/// il codec.
pub(crate) fn classify(warning: &str) -> Warning {
    if warning.starts_with("macros (VBA project) were kept") {
        Warning::Macros
    } else if warning.starts_with("links to external workbooks were kept") {
        Warning::ExternalLinks
    } else {
        Warning::Incomplete
    }
}

/// Le celle del foglio e i valori versati dalle matrici, che il lettore tiene
/// a parte, insieme in ordine di riga e di colonna, ciascuna con il valore
/// che mostra.
pub(crate) fn entries(
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
/// riempimento. Le altre non allargano il foglio.
pub(crate) fn shows(
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

/// L'aspetto di una cella che mostra `value`, formattato con `numeric` e il
/// colore del formato numerico `format_color`.
pub(crate) fn cell_style(
    workbook: &Workbook,
    style: &GcStyle,
    value: &GcValue,
    numeric: bool,
    format_color: Option<FormatColor>,
) -> GridCellStyle {
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
        HAlign::Left => Some(GridHorizontalAlign::Start),
        HAlign::Center | HAlign::CenterAcross => Some(GridHorizontalAlign::Center),
        HAlign::Right => Some(GridHorizontalAlign::End),
        // Come in Excel: i numeri a destra, i booleani e gli errori al centro.
        HAlign::General => match shown(value) {
            Some(GcValue::Number(_)) if numeric => Some(GridHorizontalAlign::End),
            Some(GcValue::Bool(_) | GcValue::Error(_)) => Some(GridHorizontalAlign::Center),
            _ => None,
        },
        HAlign::Fill | HAlign::Justify | HAlign::Distributed => None,
    };
    GridCellStyle {
        bold: style.font.bold,
        italic: style.font.italic,
        text_color,
        fill_color,
        horizontal,
        number_format: None,
    }
}

/// Il valore che la cella mostra: di una matrice, il primo.
pub(crate) fn shown(value: &GcValue) -> Option<&GcValue> {
    match value {
        GcValue::Empty => None,
        GcValue::Array(array) => array.data.first().and_then(shown),
        value => Some(value),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gli_avvisi_della_lettura_hanno_un_tipo() {
        assert_eq!(
            classify("macros (VBA project) were kept but not executed"),
            Warning::Macros
        );
        assert_eq!(
            classify("links to external workbooks were kept; they are not followed or refreshed"),
            Warning::ExternalLinks
        );
        for warning in [
            "links to external workbooks were dropped: bad",
            "chart sheet \"Grafico\" was skipped and is not kept on save",
            "sheet \"A\": embedded objects and form controls are not shown; they are kept for saving",
            "what-if data tables are not supported; kept their values",
        ] {
            assert_eq!(classify(warning), Warning::Incomplete, "{warning}");
        }
    }

    #[test]
    fn i_colori_dei_formati_sono_quelli_di_excel() {
        assert_eq!(format_color_hex(FormatColor::Red), "#FF0000");
        assert_eq!(format_color_hex(FormatColor::Indexed(10)), "#008000");
        assert_eq!(format_color_hex(FormatColor::Indexed(200)), "#000000");
    }
}
