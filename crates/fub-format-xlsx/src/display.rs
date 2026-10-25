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

use fub_abi::{
    GridBorder, GridBorderStyle, GridBorders, GridCellStyle, GridHorizontalAlign, GridScript,
    GridUnderline, GridVerticalAlign,
};
use gridcraft_core::{CellRef, Value as GcValue};
use gridcraft_engine::cf::{CfCache, CfLook};
use gridcraft_model::style::{
    BorderLine, BorderStyle, Color, HAlign, PatternType, Style as GcStyle, StyleId, Underline,
    VAlign, VertAlign,
};
use gridcraft_model::{Sheet as GcSheet, Workbook};
use gridcraft_numfmt::FormatColor;

/// Le parti di una cartella che la griglia non disegna. Le unioni, le note, la
/// formattazione condizionale e gli oggetti (grafici, grafici sparkline,
/// immagini e forme) arrivano nella finestra, e si disegnano.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum NotShown {
    Slicers,
}

impl NotShown {
    pub const ALL: [NotShown; 1] = [NotShown::Slicers];

    pub fn id(self) -> &'static str {
        match self {
            NotShown::Slicers => "slicers",
        }
    }

    pub(crate) fn present(self, sheet: &GcSheet) -> bool {
        match self {
            NotShown::Slicers => !sheet.slicers.is_empty(),
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

/// L'aspetto che una cella ha davvero: il suo stile, o quello della tabella
/// in cui sta, con sopra la formattazione condizionale. È la regola della
/// stampa di GridCraft (`cell_look` in `engine/src/cmd/print.rs`), che non è
/// pubblica.
pub(crate) struct Look {
    pub style: GcStyle,
    /// Il riempimento di una scala di colori, che vince sullo stile.
    pub scale_fill: Option<[u8; 3]>,
    pub cf: Option<CfLook>,
}

pub(crate) fn look(
    workbook: &Workbook,
    index: usize,
    sheet: &GcSheet,
    at: CellRef,
    cache: &mut CfCache,
) -> Look {
    let mut style = match sheet.table_at(at) {
        Some(table) => gridcraft_engine::tables::table_cell_style(workbook, index, table, at),
        None => workbook.styles.get(sheet.style_id(at)).clone(),
    };
    let cf = if sheet.cond_formats.is_empty() {
        None
    } else {
        cache.look(workbook, index, at)
    };
    if let Some(own) = cf.as_ref().and_then(|look| look.style.as_ref()) {
        if own.fill.pattern != PatternType::None {
            style.fill = own.fill;
        }
        if own.font.color != Color::Auto {
            style.font.color = own.font.color;
        }
        style.font.bold |= own.font.bold;
        style.font.italic |= own.font.italic;
        style.font.strike |= own.font.strike;
        if own.font.underline != Underline::None {
            style.font.underline = own.font.underline;
        }
        // In uno stile differenziale «General» vuol dire «non detto».
        if own.num_fmt.as_str() != "General" {
            style.num_fmt = own.num_fmt.clone();
        }
        for (side, from) in [
            (&mut style.borders.left, own.borders.left),
            (&mut style.borders.right, own.borders.right),
            (&mut style.borders.top, own.borders.top),
            (&mut style.borders.bottom, own.borders.bottom),
        ] {
            if !from.is_none() {
                *side = from;
            }
        }
    }
    Look {
        style,
        scale_fill: cf.as_ref().and_then(|look| look.scale_fill),
        cf,
    }
}

/// Se l'aspetto di una cella vuota si vede: un riempimento, un bordo o una
/// formattazione condizionale che dà qualcosa.
pub(crate) fn visible(look: &Look) -> bool {
    let borders = &look.style.borders;
    look.style.fill.pattern != PatternType::None
        || look.scale_fill.is_some()
        || look
            .cf
            .as_ref()
            .is_some_and(|cf| cf.bar.is_some() || cf.icon.is_some())
        || [
            borders.left,
            borders.right,
            borders.top,
            borders.bottom,
            borders.diag_down,
            borders.diag_up,
        ]
        .iter()
        .any(|line| !line.is_none())
}

fn hex([r, g, b]: [u8; 3]) -> String {
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Il riempimento come un colore solo: un motivo si disegna come la stampa
/// di GridCraft, un quarto del primo piano su tre quarti dello sfondo.
fn fill_hex(workbook: &Workbook, look: &Look) -> Option<String> {
    if let Some(rgb) = look.scale_fill {
        return Some(hex(rgb));
    }
    let theme = &workbook.theme;
    let fill = &look.style.fill;
    match fill.pattern {
        PatternType::None => None,
        PatternType::Solid => fill.fg.hex(theme),
        _ => {
            let fg = fill.fg.resolve(theme).unwrap_or([0, 0, 0]);
            let bg = fill.bg.resolve(theme).unwrap_or([255, 255, 255]);
            Some(hex([0, 1, 2].map(|i| {
                ((u16::from(fg[i]) + u16::from(bg[i]) * 3) / 4) as u8
            })))
        }
    }
}

fn border(workbook: &Workbook, line: BorderLine) -> Option<GridBorder> {
    let style = match line.style {
        BorderStyle::None => return None,
        BorderStyle::Thin => GridBorderStyle::Thin,
        BorderStyle::Medium => GridBorderStyle::Medium,
        BorderStyle::Thick => GridBorderStyle::Thick,
        BorderStyle::Dashed => GridBorderStyle::Dashed,
        BorderStyle::Dotted => GridBorderStyle::Dotted,
        BorderStyle::Double => GridBorderStyle::Double,
        BorderStyle::Hair => GridBorderStyle::Hair,
        BorderStyle::MediumDashed => GridBorderStyle::MediumDashed,
        BorderStyle::DashDot => GridBorderStyle::DashDot,
        BorderStyle::MediumDashDot => GridBorderStyle::MediumDashDot,
        BorderStyle::DashDotDot => GridBorderStyle::DashDotDot,
        BorderStyle::MediumDashDotDot => GridBorderStyle::MediumDashDotDot,
        BorderStyle::SlantDashDot => GridBorderStyle::SlantDashDot,
    };
    Some(GridBorder {
        style,
        color: line.color.hex(&workbook.theme),
    })
}

/// L'aspetto di una cella che mostra `value`, formattato con `numeric` e il
/// colore del formato numerico `format_color`.
pub(crate) fn cell_style(
    workbook: &Workbook,
    look: &Look,
    value: &GcValue,
    numeric: bool,
    format_color: Option<FormatColor>,
) -> GridCellStyle {
    let theme = &workbook.theme;
    let style = &look.style;
    let fill_color = fill_hex(workbook, look);
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
        HAlign::Fill => Some(GridHorizontalAlign::Fill),
        HAlign::Justify => Some(GridHorizontalAlign::Justify),
        HAlign::Distributed => Some(GridHorizontalAlign::Distributed),
        // Come in Excel: i numeri a destra, i booleani e gli errori al centro.
        HAlign::General => match shown(value) {
            Some(GcValue::Number(_)) if numeric => Some(GridHorizontalAlign::End),
            Some(GcValue::Bool(_) | GcValue::Error(_)) => Some(GridHorizontalAlign::Center),
            _ => None,
        },
    };
    let lines = &style.borders;
    let normal = &workbook.styles.get(StyleId::DEFAULT).font;
    GridCellStyle {
        bold: style.font.bold,
        italic: style.font.italic,
        text_color,
        fill_color,
        horizontal,
        number_format: None,
        // Il carattere dello stile Normale è quello di serie: assente.
        font: (!style.font.name.is_empty() && style.font.name != normal.name)
            .then(|| style.font.name.clone()),
        font_size: (style.font.size.is_finite()
            && style.font.size > 0.0
            && style.font.size != normal.size)
            .then_some(style.font.size.min(409.0)),
        underline: match style.font.underline {
            Underline::None => None,
            Underline::Single => Some(GridUnderline::Single),
            Underline::Double => Some(GridUnderline::Double),
            Underline::SingleAccounting => Some(GridUnderline::SingleAccounting),
            Underline::DoubleAccounting => Some(GridUnderline::DoubleAccounting),
        },
        strike: style.font.strike,
        script: match style.font.vert {
            VertAlign::Baseline => None,
            VertAlign::Superscript => Some(GridScript::Superscript),
            VertAlign::Subscript => Some(GridScript::Subscript),
        },
        vertical: match style.align.v {
            VAlign::Bottom => None,
            VAlign::Top => Some(GridVerticalAlign::Top),
            VAlign::Center => Some(GridVerticalAlign::Center),
            VAlign::Justify => Some(GridVerticalAlign::Justify),
            VAlign::Distributed => Some(GridVerticalAlign::Distributed),
        },
        wrap: style.align.wrap,
        shrink: style.align.shrink,
        indent: style.align.indent,
        rotation: match style.align.rotation {
            rotation @ -90..=90 => rotation,
            fub_abi::GRID_STACKED_ROTATION => fub_abi::GRID_STACKED_ROTATION,
            _ => 0,
        },
        borders: GridBorders {
            top: border(workbook, lines.top),
            right: border(workbook, lines.right),
            bottom: border(workbook, lines.bottom),
            left: border(workbook, lines.left),
            diagonal_down: border(workbook, lines.diag_down),
            diagonal_up: border(workbook, lines.diag_up),
        },
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
