//! Gli oggetti di un foglio che toccano una finestra: i grafici e i grafici
//! sparkline come li disegna GridCraft, in SVG; le immagini con i loro byte,
//! che la finestra non riporta quando la shell li ha già; le forme con il loro
//! aspetto, che disegna la shell.
//!
//! Le misure sono quelle del foglio di GridCraft, in pixel a 96 dpi e a zoom
//! 100: le stesse delle righe e delle colonne della finestra.

use std::collections::HashSet;

use base64::Engine as _;
use fub_abi::{
    GridMedia, GridObject, GridObjectKind, GridObjectMissing, GridShape, GridShapeAlign,
    GridShapeAnchor, GridShapeKind, GRID_MEDIA_TYPES, MAX_GRID_MEDIA_BYTES,
    MAX_GRID_OBJECT_SVG_BYTES, MAX_GRID_SHAPE_TEXT_BYTES, MAX_GRID_WINDOW_OBJECTS,
};
use gridcraft_core::{CellRef, RangeRef, Value as GcValue};
use gridcraft_model::{Anchor, Color, ShapeKind, ShapeTextAlign, ShapeTextAnchor, Sheet, Workbook};
use sha2::{Digest, Sha256};

/// Il disegno dei grafici che una finestra porta, al più.
const WINDOW_SVG_BYTES: usize = 2 * 1024 * 1024;
/// I byte delle immagini che una finestra porta, al più, in base64. Quelli
/// che non ci stanno arrivano con una finestra dopo.
const WINDOW_MEDIA_BYTES: usize = 4 * 1024 * 1024;
/// Il colore di un grafico sparkline senza colore, quello di Excel.
const SPARKLINE_COLOR: [u8; 3] = [0x15, 0x60, 0x82];
/// I valori che un grafico sparkline disegna, al più.
const SPARKLINE_VALUES: usize = 10_000;

/// Un rettangolo del foglio in pixel.
#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn of(sheet: &Sheet, anchor: &Anchor) -> Rect {
        Rect {
            x: sheet.col_left(anchor.cell.col) + f64::from(anchor.dx),
            y: sheet.row_top(anchor.cell.row) + f64::from(anchor.dy),
            width: f64::from(anchor.width.max(0.0)),
            height: f64::from(anchor.height.max(0.0)),
        }
    }

    /// Una linea orizzontale o verticale ha una misura nulla e tocca lo
    /// stesso.
    fn touches(&self, other: &Rect) -> bool {
        (self.width > 0.0 || self.height > 0.0)
            && self.x <= other.x + other.width
            && self.x + self.width >= other.x
            && self.y <= other.y + other.height
            && self.y + self.height >= other.y
    }
}

/// Ciò che una finestra può ancora portare.
struct Budget {
    svg: usize,
    media: usize,
}

/// Gli oggetti del foglio `sheet` che toccano `range`, nell'ordine in cui si
/// disegnano: le immagini nelle celle e i grafici sparkline, poi le immagini,
/// le forme e i grafici. `known` sono le chiavi delle immagini che la shell
/// ha già. Un oggetto ancorato fuori dagli assi della sessione non c'è.
pub(crate) fn objects(
    workbook: &Workbook,
    sheet: usize,
    range: RangeRef,
    (rows, columns): (u32, u32),
    known: &HashSet<&str>,
) -> Vec<GridObject> {
    let model = &workbook.sheets[sheet];
    let area = Rect {
        x: model.col_left(range.start.col),
        y: model.row_top(range.start.row),
        width: model.col_left(range.end.col.saturating_add(1)) - model.col_left(range.start.col),
        height: model.row_top(range.end.row.saturating_add(1)) - model.row_top(range.start.row),
    };
    let inside = |cell: CellRef| cell.row < rows && cell.col < columns;
    let mut budget = Budget {
        svg: WINDOW_SVG_BYTES,
        media: WINDOW_MEDIA_BYTES,
    };
    let mut out = Vec::new();

    for (index, (cell, picture)) in model.cell_pictures.iter().enumerate() {
        if !range.contains(*cell) || !inside(*cell) {
            continue;
        }
        let (width, height) = cell_size(model, *cell);
        let mut object = placed(GridObjectKind::CellPicture, index, *cell, width, height);
        object.alt = text(&picture.alt);
        media(
            &mut object,
            &picture.mime,
            &picture.data,
            known,
            &mut budget,
        );
        out.push(object);
    }
    for (index, sparkline) in model.sparklines.iter().enumerate() {
        if !range.contains(sparkline.cell) || !inside(sparkline.cell) {
            continue;
        }
        let (width, height) = cell_size(model, sparkline.cell);
        let values: Vec<Option<f64>> =
            match gridcraft_calc::evaluate(workbook, sheet, sparkline.cell, &sparkline.source) {
                GcValue::Array(array) => array
                    .iter()
                    .take(SPARKLINE_VALUES)
                    .map(GcValue::as_f64)
                    .collect(),
                value => vec![value.as_f64()],
            };
        let [r, g, b] = sparkline
            .color
            .resolve(&workbook.theme)
            .unwrap_or(SPARKLINE_COLOR);
        let prims = gridcraft_chart::render_sparkline(
            sparkline.kind,
            &values,
            [r, g, b, 255],
            sparkline.markers,
            width,
            height,
        );
        if prims.is_empty() {
            continue;
        }
        let mut object = placed(
            GridObjectKind::Sparkline,
            index,
            sparkline.cell,
            width,
            height,
        );
        drawing(
            &mut object,
            gridcraft_engine::chart_svg::prims_svg(&prims, width, height, ""),
            &mut budget,
        );
        out.push(object);
    }
    for image in &model.images {
        if !inside(image.anchor.cell) || !Rect::of(model, &image.anchor).touches(&area) {
            continue;
        }
        let mut object = anchored(GridObjectKind::Image, image.id, &image.anchor);
        object.alt = text(&image.alt);
        media(&mut object, &image.mime, &image.data, known, &mut budget);
        out.push(object);
    }
    for shape in &model.shapes {
        if !inside(shape.anchor.cell) || !Rect::of(model, &shape.anchor).touches(&area) {
            continue;
        }
        let mut object = anchored(GridObjectKind::Shape, shape.id, &shape.anchor);
        object.shape = Some(look(workbook, shape));
        out.push(object);
    }
    for chart in &model.charts {
        if !inside(chart.anchor.cell) || !Rect::of(model, &chart.anchor).touches(&area) {
            continue;
        }
        let Some(svg) = gridcraft_engine::chart_svg::chart_svg(workbook, sheet, chart, "") else {
            continue;
        };
        let mut object = anchored(GridObjectKind::Chart, chart.id, &chart.anchor);
        object.alt = text(chart.title.as_deref().unwrap_or(""));
        drawing(&mut object, svg, &mut budget);
        out.push(object);
    }
    out.truncate(MAX_GRID_WINDOW_OBJECTS);
    out
}

fn placed(
    kind: GridObjectKind,
    index: usize,
    cell: CellRef,
    width: f32,
    height: f32,
) -> GridObject {
    GridObject {
        kind,
        id: u32::try_from(index).unwrap_or(u32::MAX),
        row: cell.row,
        column: cell.col,
        dx: 0.0,
        dy: 0.0,
        width,
        height,
        alt: String::new(),
        svg: None,
        media: None,
        shape: None,
        missing: None,
    }
}

fn anchored(kind: GridObjectKind, id: u32, anchor: &Anchor) -> GridObject {
    let finite = |value: f32| {
        if value.is_finite() {
            value.clamp(-1e6, 1e6)
        } else {
            0.0
        }
    };
    let mut object = placed(
        kind,
        0,
        anchor.cell,
        finite(anchor.width).max(0.0),
        finite(anchor.height).max(0.0),
    );
    object.id = id;
    object.dx = finite(anchor.dx);
    object.dy = finite(anchor.dy);
    object
}

/// La misura di una cella, o dell'unione che comincia lì.
fn cell_size(sheet: &Sheet, cell: CellRef) -> (f32, f32) {
    let area = sheet
        .merge_at(cell)
        .filter(|merge| merge.start == cell)
        .unwrap_or_else(|| RangeRef::cell(cell));
    let width = sheet.col_left(area.end.col.saturating_add(1)) - sheet.col_left(area.start.col);
    let height = sheet.row_top(area.end.row.saturating_add(1)) - sheet.row_top(area.start.row);
    (width as f32, height as f32)
}

/// Un testo entro la misura del contratto, tagliato su un carattere.
fn text(value: &str) -> String {
    if value.len() <= MAX_GRID_SHAPE_TEXT_BYTES {
        return value.to_owned();
    }
    let mut end = MAX_GRID_SHAPE_TEXT_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn drawing(object: &mut GridObject, svg: String, budget: &mut Budget) {
    if svg.len() > MAX_GRID_OBJECT_SVG_BYTES || svg.len() > budget.svg {
        object.missing = Some(GridObjectMissing::TooLarge);
        return;
    }
    budget.svg -= svg.len();
    object.svg = Some(svg);
}

/// I byte di un'immagine: la chiave è la loro impronta, e i byte mancano se
/// la shell li ha già o se la finestra non ne porta più.
fn media(
    object: &mut GridObject,
    mime: &str,
    data: &[u8],
    known: &HashSet<&str>,
    budget: &mut Budget,
) {
    let mime = mime.trim().to_ascii_lowercase();
    let mime = if mime == "image/jpg" {
        "image/jpeg".to_owned()
    } else {
        mime
    };
    if !GRID_MEDIA_TYPES.contains(&mime.as_str()) {
        object.missing = Some(GridObjectMissing::Unsupported);
        return;
    }
    if data.len().div_ceil(3) * 4 > MAX_GRID_MEDIA_BYTES {
        object.missing = Some(GridObjectMissing::TooLarge);
        return;
    }
    let digest = Sha256::digest(data);
    let key: String = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let encoded = (!known.contains(key.as_str()))
        .then(|| base64::engine::general_purpose::STANDARD.encode(data))
        .filter(|encoded| encoded.len() <= budget.media);
    if let Some(encoded) = &encoded {
        budget.media -= encoded.len();
    }
    object.media = Some(GridMedia {
        mime,
        key,
        data: encoded,
    });
}

fn hex(color: Color, workbook: &Workbook) -> Option<String> {
    color
        .resolve(&workbook.theme)
        .map(|[r, g, b]| format!("#{r:02X}{g:02X}{b:02X}"))
}

/// Una forma con i predefiniti di GridCraft: il testo a sinistra e in alto in
/// una casella di testo, al centro nelle altre forme; nero, a 11 punti.
fn look(workbook: &Workbook, shape: &gridcraft_model::Shape) -> GridShape {
    let format = &shape.format;
    let text_box = shape.kind == ShapeKind::TextBox;
    GridShape {
        kind: match shape.kind {
            ShapeKind::Rectangle => GridShapeKind::Rectangle,
            ShapeKind::RoundedRectangle => GridShapeKind::RoundedRectangle,
            ShapeKind::Ellipse => GridShapeKind::Ellipse,
            ShapeKind::Triangle => GridShapeKind::Triangle,
            ShapeKind::Line => GridShapeKind::Line,
            ShapeKind::Arrow => GridShapeKind::Arrow,
            ShapeKind::TextBox => GridShapeKind::TextBox,
            ShapeKind::Icon => GridShapeKind::Icon,
            ShapeKind::Ink => GridShapeKind::Ink,
        },
        fill: hex(shape.fill, workbook),
        line: hex(shape.line, workbook).filter(|_| !format.no_line),
        text: text(&shape.text),
        font: format
            .font
            .clone()
            .filter(|font| !font.is_empty() && font.len() <= fub_abi::MAX_GRID_FONT_BYTES),
        font_size: format
            .font_size
            .filter(|size| size.is_finite())
            .unwrap_or(11.0)
            .clamp(1.0, 4_000.0),
        bold: format.bold,
        italic: format.italic,
        text_color: format
            .text_color
            .and_then(|color| hex(color, workbook))
            .unwrap_or_else(|| "#000000".to_owned()),
        align: match format.align.unwrap_or(if text_box {
            ShapeTextAlign::Left
        } else {
            ShapeTextAlign::Center
        }) {
            ShapeTextAlign::Left => GridShapeAlign::Left,
            ShapeTextAlign::Center => GridShapeAlign::Center,
            ShapeTextAlign::Right => GridShapeAlign::Right,
        },
        anchor: match format.anchor.unwrap_or(if text_box {
            ShapeTextAnchor::Top
        } else {
            ShapeTextAnchor::Middle
        }) {
            ShapeTextAnchor::Top => GridShapeAnchor::Top,
            ShapeTextAnchor::Middle => GridShapeAnchor::Middle,
            ShapeTextAnchor::Bottom => GridShapeAnchor::Bottom,
        },
        right_to_left: format.rtl,
    }
}
