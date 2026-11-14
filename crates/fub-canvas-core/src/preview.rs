//! L'anteprima di una lavagna: un disegno schematico della sua forma, che chi
//! scrive guarda per vedere ciò che la lettura non mostra, una freccia storta o
//! due schede una sopra l'altra. Il disegno è un SVG; il PNG lo fa
//! `fub-features` con `draw`, coi caratteri che `draw` incorpora.
//!
//! Le schede sono rettangoli coi loro colori, i gruppi recinti tratteggiati con
//! la loro etichetta, gli archi linee con le punte: vanno dal centro del lato
//! (o dal centro della scheda) fino al bordo della scheda d'arrivo. Il testo è
//! quello vero (D5 (b)): le righe della scheda, tolti i segni del Markdown,
//! spezzate con la stima di [`crate::layout`] (`cpl` caratteri per riga,
//! altezza di riga) e tagliate al bordo con «…».
//!
//! Il nucleo non misura il font. Un carattere più largo della stima esce dalla
//! scheda, e un `clipPath` lo taglia; la scheda che taglia per l'altezza lo dice
//! in [`SketchCard::clipped`], così chi legge sa che è troppo piccola. Niente
//! caratteri di sistema, niente orologio, niente caso: la stessa lavagna dà lo
//! stesso SVG su ogni macchina. Le regole stanno in
//! `docs/reference/canvas-operations.md`, «Comandi».

use std::collections::HashMap;

use serde_json::Value;

use crate::check::{self, Code, Problem};
use crate::describe;
use crate::layout::{card_kind, CardKind};
use crate::model::{
    Canvas, CanvasColor, CanvasEdge, CanvasEdgeEnd, CanvasEdgeSide, CanvasNode, CanvasNodeType,
    PresetColor,
};
use crate::ops::{self, CanvasOp};
use crate::patch;

/// Il lato lungo più piccolo, e quello più grande, in pixel. Anche il lato
/// corto non scende sotto il più piccolo.
pub const MIN_SIDE: u32 = 64;
pub const MAX_SIDE: u32 = 2048;
/// Il lato lungo di serie.
pub const DEFAULT_SIDE: u32 = 1024;
/// Quante schede al più elenca [`Sketch::outline`]. Le altre si contano in
/// [`Sketch::outline_omitted`].
pub const MAX_OUTLINE: usize = 2000;

/// Il margine attorno al contenuto, per lato, in unità della lavagna.
const MARGIN: f64 = 16.0;
/// Il riempimento del testo nella scheda: `TEXT_PAD` di `layout` è 32, in tutto.
const PAD: f64 = 16.0;
/// L'altezza di riga e la larghezza di un carattere, come in `layout`.
const LINE: f64 = 24.0;
const CHAR: f64 = 8.0;
/// Il minimo di caratteri per riga, come `MIN_CHARS_PER_LINE` di `layout`.
const MIN_CHARS: f64 = 8.0;
/// La linea di base della prima riga, sotto il riempimento.
const BASELINE: f64 = 15.0;
/// Sotto questa altezza in pixel una scheda non mostra testo né numero.
const LEGIBLE_PX: f64 = 12.0;
/// Quanti caratteri al più di un'etichetta d'arco.
const LABEL_CHARS: usize = 60;
/// Quanti caratteri al più cerca un collegamento Markdown prima di rinunciare.
const LINK_SPAN: usize = 256;

const SANS: &str = "Inter";
const CODE: &str = "JetBrains Mono";
const TEXT_SIZE: f64 = 14.0;
const CODE_SIZE: f64 = 13.0;
const LABEL_SIZE: f64 = 13.0;
const NUMBER_SIZE: f64 = 10.0;

const INK: &str = "#1f2328";
const CARD_FILL: &str = "#eef0f3";
const CARD_STROKE: &str = "#9aa1ab";
const GROUP_STROKE: &str = "#7d848f";
const EDGE_STROKE: &str = "#6b717b";

/// Due misure in pixel: lo spessore del tratto e la lunghezza della punta.
const STROKE_PX: f64 = 1.5;
const EDGE_PX: f64 = 2.0;
const HEAD_PX: f64 = 12.0;
/// La metà della base della punta, rispetto alla sua lunghezza.
const HEAD_HALF: f64 = 0.45;
/// Il tratto e lo spazio del recinto tratteggiato, in pixel.
const DASH_PX: f64 = 8.0;
const GAP_PX: f64 = 6.0;

/// Come si disegna la lavagna.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SketchOptions {
    /// Il lato lungo in pixel. Fuori da [`MIN_SIDE`]..=[`MAX_SIDE`] si stringe.
    pub size: u32,
    /// Se le schede portano il loro numero d'ordine, quello di [`Sketch::outline`].
    pub ordinals: bool,
}

impl Default for SketchOptions {
    fn default() -> Self {
        Self {
            size: DEFAULT_SIDE,
            ordinals: true,
        }
    }
}

/// Una scheda nell'anteprima: il suo numero, che è quello della lettura, e se il
/// suo testo non si vede per intero.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SketchCard {
    /// La posizione nel modello, da uno: il numero che la scheda porta nel disegno.
    pub number: usize,
    pub id: String,
    /// La specie, con i nomi di `describe::outline` (`text`, `note`, `group`…).
    pub kind: &'static str,
    /// Il testo non c'è tutto: o taglia l'altezza, o la scheda è troppo piccola
    /// per mostrarlo.
    pub clipped: bool,
}

/// Il disegno di una lavagna: l'SVG, la sua misura in pixel e le schede.
#[derive(Clone, Debug, PartialEq)]
pub struct Sketch {
    pub svg: String,
    pub width: u32,
    pub height: u32,
    /// Le schede in ordine di modello, fino a [`MAX_OUTLINE`].
    pub outline: Vec<SketchCard>,
    /// Quante schede non entrano in `outline`.
    pub outline_omitted: usize,
}

/// Il disegno come testo SVG: [`sketch`] senza il resto.
pub fn sketch_svg(canvas: &Canvas, options: &SketchOptions) -> String {
    sketch(canvas, options).svg
}

/// Disegna la lavagna. Senza schede è un riquadro vuoto di [`MIN_SIDE`] per lato.
pub fn sketch(canvas: &Canvas, options: &SketchOptions) -> Sketch {
    let side = f64::from(options.size.clamp(MIN_SIDE, MAX_SIDE));
    let frame = Frame::of(canvas, side);
    let mut painter = Painter::new(frame);
    let rects: Vec<Rect> = canvas.nodes.iter().map(Rect::of).collect();
    let index: HashMap<&str, usize> = canvas
        .nodes
        .iter()
        .enumerate()
        .map(|(position, node)| (node.id.as_str(), position))
        .collect();

    let mut outline = Vec::new();
    let mut outline_omitted = 0;
    for (position, (node, &rect)) in canvas.nodes.iter().zip(&rects).enumerate() {
        let shows = frame.in_px(rect.h) >= LEGIBLE_PX;
        let clipped = if node.node_type == CanvasNodeType::Group {
            painter.group(position, node, rect, shows, options.ordinals)
        } else {
            painter.card(position, node, rect, shows, options.ordinals)
        };
        if outline.len() < MAX_OUTLINE {
            outline.push(SketchCard {
                number: position + 1,
                id: node.id.clone(),
                kind: kind_name(card_kind(node)),
                clipped,
            });
        } else {
            outline_omitted += 1;
        }
    }
    for edge in &canvas.edges {
        let (Some(&from), Some(&to)) = (
            index.get(edge.from_node.as_str()),
            index.get(edge.to_node.as_str()),
        ) else {
            continue;
        };
        painter.edge(edge, rects[from], rects[to]);
    }

    Sketch {
        svg: painter.finish(),
        width: frame.px_width,
        height: frame.px_height,
        outline,
        outline_omitted,
    }
}

/// La lavagna com'è dopo la lista `list` di operazioni, senza scriverla. Se la
/// lista non si scrive, dà i suoi problemi: gli stessi di [`check::check`], che
/// è la porta di questa funzione.
pub fn after_ops(canvas: &Canvas, list: &Value, seed: u64) -> Result<Canvas, Vec<Problem>> {
    let report = check::check(canvas, list, seed);
    if !report.ok {
        return Err(report.problems);
    }
    let fail = |message: String| {
        vec![Problem {
            code: Code::Invalid,
            index: None,
            path: String::new(),
            message,
            suggestion: None,
            fix: None,
        }]
    };
    let ops: Vec<CanvasOp> =
        serde_json::from_value(list.clone()).map_err(|error| fail(error.to_string()))?;
    let compiled = ops::compile(canvas, &ops, seed).map_err(|error| fail(error.to_string()))?;
    patch::draft(canvas, &compiled.patches).map_err(|error| fail(error.to_string()))
}

/// Il riquadro del disegno: la finestra in unità della lavagna, la misura in
/// pixel e quanti pixel vale un'unità.
#[derive(Clone, Copy, Debug)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    px_width: u32,
    px_height: u32,
    scale: f64,
}

impl Frame {
    /// Il riquadro di `canvas` col lato lungo `side`: il contenuto più il margine,
    /// con la stessa scala sui due lati, e il lato corto portato a [`MIN_SIDE`]
    /// pixel con la lavagna al centro.
    fn of(canvas: &Canvas, side: f64) -> Self {
        let Some((left, top, right, bottom)) = bounds(canvas) else {
            let min = f64::from(MIN_SIDE);
            return Self {
                x: 0.0,
                y: 0.0,
                width: min,
                height: min,
                px_width: MIN_SIDE,
                px_height: MIN_SIDE,
                scale: 1.0,
            };
        };
        let (x, y) = (left - MARGIN, top - MARGIN);
        let (width, height) = (right - left + 2.0 * MARGIN, bottom - top + 2.0 * MARGIN);
        let scale = side / width.max(height);
        let min = f64::from(MIN_SIDE);
        let px_width = (width * scale).round().max(min) as u32;
        let px_height = (height * scale).round().max(min) as u32;
        let view_width = f64::from(px_width) / scale;
        let view_height = f64::from(px_height) / scale;
        Self {
            x: x + width / 2.0 - view_width / 2.0,
            y: y + height / 2.0 - view_height / 2.0,
            width: view_width,
            height: view_height,
            px_width,
            px_height,
            scale,
        }
    }

    /// Una misura in pixel di `units` unità della lavagna.
    fn in_px(&self, units: f64) -> f64 {
        units * self.scale
    }

    /// Una misura in unità della lavagna, che in pixel vale `pixels`.
    fn px(&self, pixels: f64) -> f64 {
        pixels / self.scale
    }
}

/// Il riquadro che racchiude le schede: sinistra, alto, destra e basso.
fn bounds(canvas: &Canvas) -> Option<(f64, f64, f64, f64)> {
    let mut rects = canvas.nodes.iter().map(Rect::of);
    let first = rects.next()?;
    Some(rects.fold(
        (first.x, first.y, first.x + first.w, first.y + first.h),
        |(left, top, right, bottom), rect| {
            (
                left.min(rect.x),
                top.min(rect.y),
                right.max(rect.x + rect.w),
                bottom.max(rect.y + rect.h),
            )
        },
    ))
}

/// Un rettangolo della lavagna, in unità.
#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn of(node: &CanvasNode) -> Self {
        Self {
            x: node.x as f64,
            y: node.y as f64,
            w: node.width as f64,
            h: node.height as f64,
        }
    }

    fn centre(self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Il punto di un lato, al suo centro; senza lato, il centro della scheda.
    fn anchor(self, side: Option<CanvasEdgeSide>) -> (f64, f64) {
        match side {
            None => self.centre(),
            Some(CanvasEdgeSide::Top) => (self.x + self.w / 2.0, self.y),
            Some(CanvasEdgeSide::Right) => (self.x + self.w, self.y + self.h / 2.0),
            Some(CanvasEdgeSide::Bottom) => (self.x + self.w / 2.0, self.y + self.h),
            Some(CanvasEdgeSide::Left) => (self.x, self.y + self.h / 2.0),
        }
    }
}

/// Il punto dove la semiretta dal centro di `rect` verso `toward` esce dal suo
/// bordo. Se `toward` è il centro, dà il centro.
fn exit(rect: Rect, toward: (f64, f64)) -> (f64, f64) {
    let (cx, cy) = rect.centre();
    let (dx, dy) = (toward.0 - cx, toward.1 - cy);
    let mut t = f64::INFINITY;
    if dx > 0.0 {
        t = t.min((rect.x + rect.w - cx) / dx);
    } else if dx < 0.0 {
        t = t.min((rect.x - cx) / dx);
    }
    if dy > 0.0 {
        t = t.min((rect.y + rect.h - cy) / dy);
    } else if dy < 0.0 {
        t = t.min((rect.y - cy) / dy);
    }
    if t.is_finite() {
        (cx + dx * t, cy + dy * t)
    } else {
        (cx, cy)
    }
}

/// Il disegno, in quattro strati: i gruppi sotto, poi gli archi, le schede e
/// infine le etichette degli archi, che stanno sopra a tutto.
struct Painter {
    frame: Frame,
    back: String,
    middle: String,
    front: String,
    labels: String,
    defs: String,
}

impl Painter {
    fn new(frame: Frame) -> Self {
        Self {
            frame,
            back: String::new(),
            middle: String::new(),
            front: String::new(),
            labels: String::new(),
            defs: String::new(),
        }
    }

    /// Il recinto di un gruppo, col nome in alto a sinistra e il numero prima
    /// del nome. Ritorna se il nome non si vede per intero.
    fn group(
        &mut self,
        position: usize,
        node: &CanvasNode,
        rect: Rect,
        shows: bool,
        ordinals: bool,
    ) -> bool {
        let stroke = stroke_of(node.color.as_ref(), GROUP_STROKE);
        let frame = self.frame;
        self.back.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"8\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"{}\" stroke-dasharray=\"{} {}\"/>",
            num(rect.x),
            num(rect.y),
            num(rect.w),
            num(rect.h),
            num(frame.px(STROKE_PX)),
            num(frame.px(DASH_PX)),
            num(frame.px(GAP_PX)),
        ));
        let numbered = ordinals && shows;
        // Il nome si sposta a destra della targhetta, che sta in alto a sinistra.
        let indent = if numbered {
            number_width(position + 1) + 10.0
        } else {
            0.0
        };
        let words = words(node, rect, shows, 1);
        for row in words.rows.iter().filter(|row| !row.trim().is_empty()) {
            self.back.push_str(&format!(
                "<text x=\"{}\" y=\"{}\" font-family=\"{SANS}\" font-size=\"{LABEL_SIZE}\" font-weight=\"700\" fill=\"{stroke}\">{}</text>",
                num(rect.x + 12.0 + indent),
                num(rect.y + PAD + BASELINE),
                character_data(row),
            ));
        }
        if numbered {
            push_badge(&mut self.back, position + 1, rect);
        }
        words.clipped
    }

    /// Una scheda: il rettangolo col suo colore, il testo tagliato al bordo e il
    /// numero d'ordine. Ritorna se il testo non si vede per intero.
    fn card(
        &mut self,
        position: usize,
        node: &CanvasNode,
        rect: Rect,
        shows: bool,
        ordinals: bool,
    ) -> bool {
        let tint = card_tint(node.color.as_ref());
        let opacity = tint
            .opacity
            .map(|alpha| format!(" fill-opacity=\"{}\"", num(alpha)))
            .unwrap_or_default();
        let frame = self.frame;
        self.front.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"8\" fill=\"{}\"{opacity} stroke=\"{}\" stroke-width=\"{}\"/>",
            num(rect.x),
            num(rect.y),
            num(rect.w),
            num(rect.h),
            tint.fill,
            tint.stroke,
            num(frame.px(STROKE_PX)),
        ));

        let fit = fit_rows(rect.h);
        let words = words(node, rect, shows, fit);
        if !words.rows.is_empty() {
            let (family, size) = font(node);
            self.defs.push_str(&format!(
                "<clipPath id=\"t{position}\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"8\"/></clipPath>",
                num(rect.x),
                num(rect.y),
                num(rect.w),
                num(rect.h),
            ));
            self.front
                .push_str(&format!("<g clip-path=\"url(#t{position})\">"));
            for (row, line) in words.rows.iter().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                self.front.push_str(&format!(
                    "<text x=\"{}\" y=\"{}\" font-family=\"{family}\" font-size=\"{size}\" fill=\"{}\">{}</text>",
                    num(rect.x + PAD),
                    num(rect.y + PAD + BASELINE + LINE * row as f64),
                    tint.ink,
                    character_data(line),
                ));
            }
            self.front.push_str("</g>");
        }

        if ordinals && shows {
            push_badge(&mut self.front, position + 1, rect);
        }
        words.clipped
    }

    /// Un arco: la linea dal lato o dal centro di una scheda all'altra, con le
    /// punte sul bordo, e l'etichetta a metà.
    fn edge(&mut self, edge: &CanvasEdge, from: Rect, to: Rect) {
        let anchor_from = from.anchor(edge.from_side);
        let anchor_to = to.anchor(edge.to_side);
        let start = if edge.from_side.is_some() {
            anchor_from
        } else {
            exit(from, anchor_to)
        };
        let end = if edge.to_side.is_some() {
            anchor_to
        } else {
            exit(to, start)
        };
        let (dx, dy) = (end.0 - start.0, end.1 - start.1);
        let length = dx.hypot(dy);
        if length <= 0.0 {
            return;
        }
        let unit = (dx / length, dy / length);
        let head = self.frame.px(HEAD_PX).min(length / 2.0);
        let from_arrow = edge.from_end == Some(CanvasEdgeEnd::Arrow);
        let to_arrow = edge.to_end != Some(CanvasEdgeEnd::None);
        let colour = stroke_of(edge.color.as_ref(), EDGE_STROKE);

        let begin = if from_arrow {
            point_along(start, unit, head)
        } else {
            start
        };
        let finish = if to_arrow {
            point_along(end, unit, -head)
        } else {
            end
        };
        self.middle.push_str(&format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{colour}\" stroke-width=\"{}\" stroke-linecap=\"round\"/>",
            num(begin.0),
            num(begin.1),
            num(finish.0),
            num(finish.1),
            num(self.frame.px(EDGE_PX)),
        ));
        if from_arrow {
            let base = point_along(start, unit, head);
            self.arrow(start, base, head, &colour);
        }
        if to_arrow {
            let base = point_along(end, unit, -head);
            self.arrow(end, base, head, &colour);
        }

        if let Some(label) = edge.label.as_deref() {
            let text = shorten(&one_line(&plain(label)), LABEL_CHARS);
            if text.trim().is_empty() {
                return;
            }
            let (mx, my) = ((start.0 + end.0) / 2.0, (start.1 + end.1) / 2.0);
            let width = CHAR * text.chars().count() as f64 + 16.0;
            let height = 22.0;
            self.labels.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"4\" fill=\"#ffffff\" stroke=\"{colour}\" stroke-width=\"{}\"/>",
                num(mx - width / 2.0),
                num(my - height / 2.0),
                num(width),
                num(height),
                num(self.frame.px(1.0)),
            ));
            self.labels.push_str(&format!(
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-family=\"{SANS}\" font-size=\"{LABEL_SIZE}\" fill=\"{INK}\">{}</text>",
                num(mx),
                num(my + 4.5),
                character_data(&text),
            ));
        }
    }

    /// Una punta: il vertice `tip`, la base a `head` da lui.
    fn arrow(&mut self, tip: (f64, f64), base: (f64, f64), head: f64, colour: &str) {
        let (dx, dy) = (tip.0 - base.0, tip.1 - base.1);
        let length = dx.hypot(dy);
        if length <= 0.0 {
            return;
        }
        let normal = (-dy / length, dx / length);
        let half = head * HEAD_HALF;
        let left = (base.0 + normal.0 * half, base.1 + normal.1 * half);
        let right = (base.0 - normal.0 * half, base.1 - normal.1 * half);
        self.middle.push_str(&format!(
            "<polygon points=\"{},{} {},{} {},{}\" fill=\"{colour}\"/>",
            num(tip.0),
            num(tip.1),
            num(left.0),
            num(left.1),
            num(right.0),
            num(right.1),
        ));
    }

    fn finish(self) -> String {
        let frame = self.frame;
        let mut svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"{} {} {} {}\">",
            frame.px_width,
            frame.px_height,
            num(frame.x),
            num(frame.y),
            num(frame.width),
            num(frame.height),
        );
        svg.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"#ffffff\"/>",
            num(frame.x),
            num(frame.y),
            num(frame.width),
            num(frame.height),
        ));
        if !self.defs.is_empty() {
            svg.push_str("<defs>");
            svg.push_str(&self.defs);
            svg.push_str("</defs>");
        }
        svg.push_str(&self.back);
        svg.push_str(&self.middle);
        svg.push_str(&self.front);
        svg.push_str(&self.labels);
        svg.push_str("</svg>");
        svg
    }
}

/// La larghezza della targhetta di un numero d'ordine, in unità.
fn number_width(number: usize) -> f64 {
    6.0 * number.to_string().len() as f64 + 8.0
}

/// Il numero d'ordine in una targhetta piccola, in alto a sinistra della scheda.
fn push_badge(out: &mut String, number: usize, rect: Rect) {
    let width = number_width(number);
    let height = 14.0;
    let (x, y) = (rect.x + 4.0, rect.y + 4.0);
    out.push_str(&format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"3\" fill=\"#ffffff\" stroke=\"{EDGE_STROKE}\" stroke-width=\"1\"/>",
        num(x),
        num(y),
        num(width),
        num(height),
    ));
    out.push_str(&format!(
        "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-family=\"{SANS}\" font-size=\"{NUMBER_SIZE}\" font-weight=\"700\" fill=\"{INK}\">{number}</text>",
        num(x + width / 2.0),
        num(y + height - 4.0),
    ));
}

/// Il punto a `distance` dal `from` nella direzione `unit` (negativa: indietro).
fn point_along(from: (f64, f64), unit: (f64, f64), distance: f64) -> (f64, f64) {
    (from.0 + unit.0 * distance, from.1 + unit.1 * distance)
}

/// Il testo di una scheda che si vede: le sue righe, e se non sta tutto.
struct Words {
    rows: Vec<String>,
    clipped: bool,
}

impl Words {
    fn none() -> Self {
        Self {
            rows: Vec::new(),
            clipped: false,
        }
    }
}

/// Il testo che la scheda mostra, spezzato nelle sue righe. Un testo vuoto, o
/// fatto solo di spazi, non è un testo che manca; un testo che non si vede
/// (scheda troppo piccola) è tagliato.
fn words(node: &CanvasNode, rect: Rect, shows: bool, fit: usize) -> Words {
    let Some(raw) = source(node) else {
        return Words::none();
    };
    let text = match node.node_type {
        CanvasNodeType::Text | CanvasNodeType::Group => plain(&raw),
        CanvasNodeType::File | CanvasNodeType::Link => raw,
    };
    if text.chars().all(char::is_whitespace) {
        return Words::none();
    }
    if !shows {
        return Words {
            rows: Vec::new(),
            clipped: true,
        };
    }
    let (rows, clipped) = wrap(&text, per_line(rect.w), fit);
    Words { rows, clipped }
}

/// Il testo di una scheda com'è nel file: il testo, l'etichetta, il nome di un
/// file (senza cartelle, col suo `#sottopercorso`) o l'indirizzo di un link.
fn source(node: &CanvasNode) -> Option<String> {
    match node.node_type {
        CanvasNodeType::File => node.file.as_deref().map(|path| {
            let name = path.rsplit('/').next().unwrap_or(path);
            format!("{name}{}", node.subpath.as_deref().unwrap_or(""))
        }),
        _ => describe::card_text(node),
    }
}

/// Il carattere di una scheda: il codice per i file e i link, il testo per il resto.
fn font(node: &CanvasNode) -> (&'static str, f64) {
    match node.node_type {
        CanvasNodeType::File | CanvasNodeType::Link => (CODE, CODE_SIZE),
        CanvasNodeType::Text | CanvasNodeType::Group => (SANS, TEXT_SIZE),
    }
}

/// Quanti caratteri per riga in una scheda larga `width`: la stima di `layout`.
fn per_line(width: f64) -> usize {
    ((width - 2.0 * PAD) / CHAR).floor().max(MIN_CHARS) as usize
}

/// Quante righe stanno in una scheda alta `height`: la stessa stima di
/// `layout`, per cui una scheda alta `estimate_text_height` ne tiene tutte le
/// righe. Una riga sta sempre, anche in una scheda più bassa.
fn fit_rows(height: f64) -> usize {
    ((height - 2.0 * PAD) / LINE).floor().max(1.0) as usize
}

/// Le righe di `text` spezzate a `per` caratteri, al più `fit`. Una riga vuota è
/// una riga, come nella stima. Se ne avanzano, `more` è vero e l'ultima riga che
/// si vede finisce con «…». Si ferma appena ha abbastanza righe: un testo di
/// duemila righe non rallenta.
fn wrap(text: &str, per: usize, fit: usize) -> (Vec<String>, bool) {
    let mut rows: Vec<String> = Vec::new();
    let mut more = false;
    'lines: for line in text.split('\n') {
        let mut rest = line.strip_suffix('\r').unwrap_or(line).chars().peekable();
        loop {
            if rows.len() == fit {
                more = true;
                break 'lines;
            }
            rows.push(rest.by_ref().take(per).collect());
            if rest.peek().is_none() {
                break;
            }
        }
    }
    if more {
        if let Some(last) = rows.last_mut() {
            let kept: String = last.chars().take(per - 1).collect();
            *last = format!("{kept}…");
        }
    }
    (rows, more)
}

/// Il testo come si legge, senza i segni del Markdown. Non è un parser: sono i
/// segni che un'anteprima non deve mostrare, cioè i titoli, le citazioni, le
/// liste, le caselle, i recinti del codice, i collegamenti `[[…]]` e `[…](…)`,
/// e l'enfasi (gli asterischi, i trattini bassi e gli apici inversi). Un
/// trattino basso o un asterisco fra due lettere è testo, come in `snake_case`.
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut fenced = false;
    for (position, line) in text.split('\n').enumerate() {
        if position > 0 {
            out.push('\n');
        }
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            out.push_str(line);
        } else if !is_rule(trimmed) {
            out.push_str(&inline(block(trimmed)));
        }
    }
    out
}

/// Il segno di blocco in testa a una riga: un titolo, una citazione, un elemento
/// di lista, una lista numerata o una casella.
fn block(line: &str) -> &str {
    let mut rest = line;
    let body = rest.trim_start_matches('#');
    let marks = rest.len() - body.len();
    if (1..=6).contains(&marks) && (body.is_empty() || body.starts_with(' ')) {
        rest = body.trim_start();
    }
    while let Some(after) = rest.strip_prefix('>') {
        rest = after.trim_start();
    }
    for marker in ["- ", "* ", "+ "] {
        if let Some(after) = rest.strip_prefix(marker) {
            rest = after;
            break;
        }
    }
    if let Some(after) = ordered(rest) {
        rest = after;
    }
    for task in ["[ ] ", "[x] ", "[X] "] {
        if let Some(after) = rest.strip_prefix(task) {
            rest = after;
            break;
        }
    }
    rest
}

/// La parte dopo `1. ` o `1) `, se la riga è una lista numerata.
fn ordered(line: &str) -> Option<&str> {
    let digits = line.len() - line.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 {
        return None;
    }
    let rest = &line[digits..];
    rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") "))
}

/// Una riga che è un separatore (`---`, `***`, `___`).
fn is_rule(line: &str) -> bool {
    let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    compact.len() >= 3
        && (compact.chars().all(|c| c == '-')
            || compact.chars().all(|c| c == '*')
            || compact.chars().all(|c| c == '_'))
}

/// L'enfasi e i collegamenti di una riga. Gli apici inversi e le tilde si tolgono
/// sempre; gli asterischi e i trattini bassi solo al bordo di una parola.
fn inline(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while at < chars.len() {
        if let Some((shown, next)) = link(&chars, at) {
            out.push_str(&shown);
            at = next;
            continue;
        }
        let c = chars[at];
        let inside_word = |index: Option<usize>| {
            index
                .and_then(|i| chars.get(i))
                .is_some_and(|c| c.is_alphanumeric())
        };
        let marker = match c {
            '`' | '~' => true,
            '*' | '_' => !(inside_word(at.checked_sub(1)) && inside_word(Some(at + 1))),
            _ => false,
        };
        if !marker {
            out.push(c);
        }
        at += 1;
    }
    out
}

/// Un collegamento che comincia in `at`: `[[nota|nome]]` e `![[file]]` danno il
/// nome, `[testo](url)` e `![alt](url)` il testo. Con la posizione dopo, o `None`
/// se non è un collegamento chiuso entro [`LINK_SPAN`] caratteri.
fn link(chars: &[char], at: usize) -> Option<(String, usize)> {
    let window = &chars[at..chars.len().min(at + LINK_SPAN)];
    let wiki = if window.starts_with(&['!', '[', '[']) {
        3
    } else if window.starts_with(&['[', '[']) {
        2
    } else {
        0
    };
    if wiki > 0 {
        let close = (wiki..window.len().saturating_sub(1))
            .find(|&i| window[i] == ']' && window[i + 1] == ']')?;
        let inner: String = window[wiki..close].iter().collect();
        let shown = match inner.rsplit_once('|') {
            Some((_, alias)) => alias.to_owned(),
            None => inner,
        };
        return Some((shown, at + close + 2));
    }
    let text_from = if window.starts_with(&['!', '[']) {
        2
    } else if window.first() == Some(&'[') {
        1
    } else {
        return None;
    };
    let close = (text_from..window.len()).find(|&i| window[i] == ']')?;
    if window.get(close + 1) != Some(&'(') {
        return None;
    }
    let end = (close + 2..window.len()).find(|&i| window[i] == ')')?;
    let shown: String = window[text_from..close].iter().collect();
    Some((shown, at + end + 1))
}

/// Un'etichetta su una riga, con gli a capo come spazi.
fn one_line(text: &str) -> String {
    text.split('\n')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Accorcia a `max` caratteri, il `…` compreso.
fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut short: String = text.chars().take(max - 1).collect();
    short.push('…');
    short
}

/// Il testo come contenuto di un elemento SVG, in una sezione CDATA: dentro, `&`,
/// `<`, `>` e le virgolette sono testo così come sono, e non serve nessuna
/// entità (il nucleo non ne scrive: la tabella sta in `fub-abi`). Solo `]]>` si
/// spezza fra due sezioni. I caratteri che XML non ammette diventano il segno
/// sostitutivo, a capo e tabulazioni uno spazio.
fn character_data(text: &str) -> String {
    let clean: String = text
        .chars()
        .map(|c| match c {
            '\t' | '\n' | '\r' => ' ',
            c if xml_char(c) => c,
            _ => '\u{FFFD}',
        })
        .collect();
    format!("<![CDATA[{}]]>", clean.replace("]]>", "]]]]><![CDATA[>"))
}

fn xml_char(c: char) -> bool {
    matches!(
        c,
        '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..='\u{10FFFF}'
    )
}

/// Un numero per l'SVG: due decimali, senza zeri in coda e senza `-0`.
fn num(value: f64) -> String {
    let text = format!("{value:.2}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" {
        "0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Il colore di una scheda: il riempimento, il tratto, l'opacità del riempimento
/// se il colore la porta, e il colore del testo sopra.
struct Tint {
    fill: String,
    opacity: Option<f64>,
    stroke: String,
    ink: &'static str,
}

fn grey() -> Tint {
    Tint {
        fill: CARD_FILL.to_owned(),
        opacity: None,
        stroke: CARD_STROKE.to_owned(),
        ink: INK,
    }
}

fn card_tint(color: Option<&CanvasColor>) -> Tint {
    match color {
        Some(CanvasColor::Preset(preset)) => {
            let (fill, stroke) = preset_colours(*preset);
            Tint {
                fill: fill.to_owned(),
                opacity: None,
                stroke: stroke.to_owned(),
                ink: INK,
            }
        }
        Some(CanvasColor::Hex(value)) => match hex(value) {
            Some(hex) => Tint {
                ink: ink_on(&hex.rgb),
                fill: hex.rgb.clone(),
                opacity: hex.alpha,
                stroke: hex.rgb,
            },
            None => grey(),
        },
        None => grey(),
    }
}

/// Il colore di un tratto (recinto o arco), col suo ripiego.
fn stroke_of(color: Option<&CanvasColor>, fallback: &str) -> String {
    match color {
        Some(CanvasColor::Preset(preset)) => preset_colours(*preset).1.to_owned(),
        Some(CanvasColor::Hex(value)) => hex(value).map_or_else(|| fallback.to_owned(), |h| h.rgb),
        None => fallback.to_owned(),
    }
}

/// I sei colori di serie, con valori fissi: un tono leggero per il riempimento,
/// uno pieno per il tratto. Sono le tinte della lavagna, non del tema.
fn preset_colours(preset: PresetColor) -> (&'static str, &'static str) {
    match preset {
        PresetColor::Red => ("#fbe1e1", "#d6453d"),
        PresetColor::Orange => ("#fdebd0", "#d9822b"),
        PresetColor::Yellow => ("#fbf6c3", "#b8a200"),
        PresetColor::Green => ("#d9f3e1", "#2f9e5a"),
        PresetColor::Cyan => ("#d5f2f2", "#1d9ba3"),
        PresetColor::Purple => ("#eae1fa", "#7b52c7"),
    }
}

/// Un colore esadecimale: il suo `#rrggbb` com'è scritto, e l'alfa se ne ha una.
struct Hex {
    rgb: String,
    alpha: Option<f64>,
}

/// Un `#rgb`, `#rgba`, `#rrggbb` o `#rrggbbaa`. Altro è `None`, e chi lo chiama
/// usa il colore di serie.
fn hex(value: &str) -> Option<Hex> {
    let digits = value.strip_prefix('#')?;
    if !digits.is_ascii() || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let (rgb, alpha) = match digits.len() {
        3 => (expand(&digits[..3]), None),
        4 => (expand(&digits[..3]), Some(expand(&digits[3..]))),
        6 => (digits[..6].to_owned(), None),
        8 => (digits[..6].to_owned(), Some(digits[6..].to_owned())),
        _ => return None,
    };
    let alpha = alpha
        .and_then(|digits| u8::from_str_radix(&digits, 16).ok())
        .map(|value| f64::from(value) / 255.0);
    Some(Hex {
        rgb: format!("#{rgb}"),
        alpha,
    })
}

/// Da `abc` ad `aabbcc`.
fn expand(short: &str) -> String {
    short.chars().flat_map(|c| [c, c]).collect()
}

/// Il testo nero su un fondo chiaro, bianco su uno scuro.
fn ink_on(rgb: &str) -> &'static str {
    let channel =
        |range: std::ops::Range<usize>| u8::from_str_radix(&rgb[range], 16).map_or(0.0, f64::from);
    let luma = 0.299 * channel(1..3) + 0.587 * channel(3..5) + 0.114 * channel(5..7);
    if luma < 128.0 {
        "#ffffff"
    } else {
        INK
    }
}

/// Il nome della specie nell'anteprima: gli stessi di `describe::outline`.
fn kind_name(kind: CardKind) -> &'static str {
    match kind {
        CardKind::Text => "text",
        CardKind::Note => "note",
        CardKind::Document => "document",
        CardKind::Sheet => "sheet",
        CardKind::Pdf => "pdf",
        CardKind::Image => "image",
        CardKind::Web => "web",
        CardKind::Craft => "craft",
        CardKind::File => "file",
        CardKind::Group => "group",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn la_freccia_esce_dal_bordo_e_non_dal_centro() {
        // Dal centro di una scheda 0..100 × 0..50 verso destra: il bordo a x = 100.
        let r = rect(0.0, 0.0, 100.0, 50.0);
        assert_eq!(exit(r, (500.0, 25.0)), (100.0, 25.0));
        // Verso l'angolo (100, 100): dal centro (50, 25) il primo bordo che si
        // incontra è quello di sotto, a y = 50, con x = 50 + 50 · 25/75.
        let (x, y) = exit(r, (100.0, 100.0));
        assert!(
            (y - 50.0).abs() < 1e-9 && (x - 200.0 / 3.0).abs() < 1e-9,
            "{x} {y}"
        );
        // Verso il centro stesso: il centro.
        assert_eq!(exit(r, (50.0, 25.0)), (50.0, 25.0));
    }

    #[test]
    fn un_numero_non_ha_zeri_in_coda_ne_meno_zero() {
        assert_eq!(num(12.0), "12");
        assert_eq!(num(12.5), "12.5");
        assert_eq!(num(-0.001), "0");
        assert_eq!(num(-3.25), "-3.25");
    }

    #[test]
    fn il_markdown_si_toglie_senza_toccare_le_parole() {
        assert_eq!(plain("## Titolo"), "Titolo");
        assert_eq!(plain("> citazione"), "citazione");
        assert_eq!(plain("- [ ] da fare"), "da fare");
        assert_eq!(plain("1. primo"), "primo");
        assert_eq!(plain("**forte** e *corsivo*"), "forte e corsivo");
        assert_eq!(plain("snake_case e 2*3"), "snake_case e 2*3");
        assert_eq!(
            plain("[[Nota|il nome]] e [testo](https://x.it)"),
            "il nome e testo"
        );
        assert_eq!(plain("![[immagine.png]]"), "immagine.png");
        assert_eq!(plain("---"), "");
        assert_eq!(plain("```\n*non*\n```"), "\n*non*\n");
        assert_eq!(plain("#tag resta"), "#tag resta");
    }

    #[test]
    fn un_collegamento_senza_chiusura_resta_com_e() {
        let chars: Vec<char> = "[[ senza fine".chars().collect();
        assert_eq!(link(&chars, 0), None);
        let chars: Vec<char> = "[solo testo] senza url".chars().collect();
        assert_eq!(link(&chars, 0), None);
        assert_eq!(inline("[solo testo] senza url"), "[solo testo] senza url");
    }

    #[test]
    fn le_righe_si_spezzano_con_la_stima_e_finiscono_con_i_puntini() {
        // Con 8 caratteri per riga, una riga di 20 caratteri fa 3 righe.
        let (rows, more) = wrap("abcdefghijklmnopqrst", 8, 5);
        assert_eq!(rows, vec!["abcdefgh", "ijklmnop", "qrst"]);
        assert!(!more);
        // Due righe in tutto, una sola che sta: la prima finisce con «…».
        let (rows, more) = wrap("uno\ndue", 8, 1);
        assert_eq!(rows, vec!["uno…"]);
        assert!(more);
        // Una riga vuota è una riga.
        assert_eq!(wrap("a\n\nb", 8, 9).0, vec!["a", "", "b"]);
    }

    #[test]
    fn un_colore_esadecimale_si_legge_in_tutte_le_sue_forme() {
        assert_eq!(hex("#ABC").map(|h| h.rgb), Some("#AABBCC".to_owned()));
        assert_eq!(hex("#112233").map(|h| h.rgb), Some("#112233".to_owned()));
        let with_alpha = hex("#11223380").expect("otto cifre");
        assert_eq!(with_alpha.rgb, "#112233");
        assert!(with_alpha
            .alpha
            .is_some_and(|a| (a - 128.0 / 255.0).abs() < 1e-9));
        assert!(hex("#zz0000").is_none());
        assert!(hex("112233").is_none());
        // Un testo non ASCII non fa andare fuori dal bordo una sottostringa.
        assert!(hex("#àbc").is_none());
    }

    #[test]
    fn il_testo_scuro_vuole_l_inchiostro_chiaro() {
        assert_eq!(ink_on("#000000"), "#ffffff");
        assert_eq!(ink_on("#ffffff"), INK);
    }

    #[test]
    fn la_cornice_di_una_lavagna_vuota_e_64_per_64() {
        let frame = Frame::of(&Canvas::default(), 2048.0);
        assert_eq!((frame.px_width, frame.px_height), (64, 64));
    }

    #[test]
    fn il_lato_corto_non_scende_sotto_il_minimo() {
        let mut canvas = Canvas::default();
        canvas.nodes.push(CanvasNode {
            id: "a".into(),
            node_type: CanvasNodeType::Text,
            x: 0,
            y: 0,
            width: 100_000,
            height: 10,
            color: None,
            text: Some("x".into()),
            file: None,
            subpath: None,
            url: None,
            label: None,
            background: None,
            background_style: None,
            extra: serde_json::Map::new(),
        });
        let frame = Frame::of(&canvas, 1024.0);
        assert_eq!((frame.px_width, frame.px_height), (1024, 64));
        assert!((frame.width * frame.scale - 1024.0).abs() < 1e-6);
    }
}
