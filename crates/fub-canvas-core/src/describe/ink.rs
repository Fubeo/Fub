//! L'inchiostro nelle tre letture della lavagna.
//!
//! I livelli si leggono con le regole di [`crate::ink`], le sole
//! dell'inchiostro; qui si decide soltanto come compaiono:
//! - nell'outline, quanti tratti ha un livello, quanti non si disegnano e il
//!   riquadro di quelli che si disegnano ([`summary`]);
//! - nel codice, i tratti come `add_strokes`, con le stringhe esatte del file,
//!   quando l'operazione ricrea il livello uguale ([`strokes_op`]);
//! - nel JSON, i tratti decodificati, coi punti arrotondati a 0,1 e tagliati a
//!   `max_chars` ([`read_layers_into`]).
//!
//! I punti di un tratto di una scheda sono nelle coordinate della scheda com'è
//! adesso, con 0,0 nell'angolo in alto a sinistra: la misura di riferimento
//! dell'ancora si porta alla misura di adesso come fa la resa («La misura della
//! scheda» in `docs/reference/canvas-ink.md`). Quelli di un tratto libero sono
//! nelle coordinate della lavagna. Le regole stanno in
//! `docs/reference/canvas-ink.md`, «In codice».

use fub_ink_codec::{InkBrush, PEN_KEY};
use serde_json::{Map, Number, Value};

use crate::ink::{DrawnStroke, InkAnchor, InkLayer, LayerRef, StrokeState};
use crate::layout::{card_kind, CardKind};
use crate::model::{CanvasNode, CanvasNodeType, MAX_SAFE_INTEGER};
use crate::ops::CanvasOp;

/// Il campo che dice quanti punti di un tratto il JSON non mostra.
const POINTS_OMITTED: &str = "points_omitted";

/// Il campo che dice perché un tratto non si disegna, nel JSON.
const BAD: &str = "bad";

/// Come i punti dell'ancora vanno nelle coordinate della scheda di adesso:
/// `(dx + s · x, dy + s · y)`.
#[derive(Copy, Clone, Debug, PartialEq)]
struct Fit {
    s: f64,
    dx: f64,
    dy: f64,
}

impl Fit {
    const IDENTITY: Fit = Fit {
        s: 1.0,
        dx: 0.0,
        dy: 0.0,
    };

    /// Il modo della scheda: `scale` per una scheda `file` d'immagine o di PDF,
    /// che scala senza deformarsi e si centra; `fixed` per le altre, che
    /// restano alla misura di riferimento. Un tratto libero non si porta.
    fn of(node: Option<&CanvasNode>, anchor: InkAnchor) -> Fit {
        let (Some(node), InkAnchor::Card { width, height }) = (node, anchor) else {
            return Fit::IDENTITY;
        };
        let scales = node.node_type == CanvasNodeType::File
            && matches!(card_kind(node), CardKind::Image | CardKind::Pdf);
        if !scales {
            return Fit::IDENTITY;
        }
        // Le misure di una scheda sono interi entro ±(2^53−1): il cast è esatto.
        #[allow(clippy::cast_precision_loss)]
        let (w, h) = (node.width as f64, node.height as f64);
        if w < 0.0 || h < 0.0 {
            return Fit {
                s: 0.0,
                dx: 0.0,
                dy: 0.0,
            };
        }
        let s = (w / width).min(h / height);
        Fit {
            s,
            dx: (w - width * s) / 2.0,
            dy: (h - height * s) / 2.0,
        }
    }

    fn point(self, [x, y]: [f64; 2]) -> [f64; 2] {
        [self.dx + self.s * x, self.dy + self.s * y]
    }
}

/// Un riquadro: l'angolo in alto a sinistra, la larghezza e l'altezza.
#[derive(Copy, Clone, Debug, PartialEq)]
struct Box2 {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Box2 {
    /// Il riquadro dei punti, arrotondato a 0,1. Si arrotondano i lati, non la
    /// misura: così il riquadro racchiude i punti arrotondati del JSON. `None`
    /// senza punti.
    fn around(points: impl IntoIterator<Item = [f64; 2]>) -> Option<Box2> {
        let mut points = points.into_iter();
        let [x, y] = points.next()?;
        let (mut left, mut top, mut right, mut bottom) = (x, y, x, y);
        for [x, y] in points {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
        let (left, top) = (tenth(left), tenth(top));
        Some(Box2 {
            x: left,
            y: top,
            width: tenth(tenth(right) - left),
            height: tenth(tenth(bottom) - top),
        })
    }

    /// Il riquadro che racchiude tutti e due.
    fn union(self, other: Box2) -> Box2 {
        let left = self.x.min(other.x);
        let top = self.y.min(other.y);
        let right = (self.x + self.width).max(other.x + other.width);
        let bottom = (self.y + self.height).max(other.y + other.height);
        Box2 {
            x: left,
            y: top,
            width: tenth(right - left),
            height: tenth(bottom - top),
        }
    }

    /// `x y larghezza×altezza`, come la riga dei conti.
    fn line(self) -> String {
        format!("{} {} {}×{}", self.x, self.y, self.width, self.height)
    }

    fn value(self) -> Value {
        let mut map = Map::new();
        map.insert("x".to_owned(), number(self.x));
        map.insert("y".to_owned(), number(self.y));
        map.insert("width".to_owned(), number(self.width));
        map.insert("height".to_owned(), number(self.height));
        Value::Object(map)
    }
}

/// Un tratto che si disegna, decodificato e portato nelle coordinate di chi lo
/// tiene.
struct Decoded {
    id: String,
    color: String,
    /// Lo spessore del pennello, per la scala della scheda.
    size: f64,
    tool: &'static str,
    /// La penna del pennello (`pen=<id>`), se c'è.
    pen: Option<String>,
    bounds: Box2,
    /// I punti, arrotondati a 0,1.
    points: Vec<[f64; 2]>,
}

impl Decoded {
    fn of(id: &str, drawn: &DrawnStroke, node: Option<&CanvasNode>) -> Decoded {
        let fit = Fit::of(node, drawn.anchor);
        let fitted: Vec<[f64; 2]> = (0..drawn.ink.len())
            .map(|i| fit.point(drawn.ink.point(i)))
            .collect();
        // Un inchiostro letto ha sempre almeno un campione.
        let bounds = Box2::around(fitted.iter().copied()).unwrap_or(Box2 {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        });
        let (size, unknown) = match &drawn.brush {
            InkBrush::Pf1(brush) => (brush.size, &brush.unknown),
            InkBrush::Nib1(brush) => (brush.size, &brush.unknown),
        };
        let pen = unknown
            .iter()
            .find(|(key, _)| key == PEN_KEY)
            .map(|(_, value)| value.clone());
        Decoded {
            id: id.to_owned(),
            color: drawn.color.clone(),
            size: hundredth(size * fit.s),
            tool: drawn.tool.as_str(),
            pen,
            bounds,
            points: fitted
                .into_iter()
                .map(|[x, y]| [tenth(x), tenth(y)])
                .collect(),
        }
    }

    /// Il tratto come oggetto JSON, con i primi `shown` punti. Se ne mancano,
    /// `points_omitted` dice quanti.
    fn value(&self, shown: usize) -> Value {
        let shown = shown.min(self.points.len());
        let mut map = Map::new();
        map.insert("id".to_owned(), Value::String(self.id.clone()));
        map.insert("color".to_owned(), Value::String(self.color.clone()));
        map.insert("size".to_owned(), number(self.size));
        map.insert("tool".to_owned(), Value::from(self.tool));
        if let Some(pen) = &self.pen {
            map.insert("pen".to_owned(), Value::String(pen.clone()));
        }
        map.insert("bounds".to_owned(), self.bounds.value());
        map.insert(
            "points".to_owned(),
            Value::Array(
                self.points[..shown]
                    .iter()
                    .map(|p| point_value(*p))
                    .collect(),
            ),
        );
        if shown < self.points.len() {
            map.insert(
                POINTS_OMITTED.to_owned(),
                Value::from(self.points.len() - shown),
            );
        }
        Value::Object(map)
    }
}

/// Il livello come lo dice una riga dell'outline: `N`, poi `bad=M` se M tratti
/// non si disegnano, poi il riquadro dei tratti che si disegnano o `-`. Un
/// livello estraneo è `foreign`.
pub(super) fn summary(value: &Value, layer: &LayerRef, node: Option<&CanvasNode>) -> String {
    let Ok(ink) = InkLayer::from_value(value) else {
        return "foreign".to_owned();
    };
    let mut bad = 0;
    let mut bounds: Option<Box2> = None;
    for stroke in &ink.strokes {
        match stroke.state(layer) {
            StrokeState::Drawn(drawn) => {
                let fit = Fit::of(node, drawn.anchor);
                let around =
                    Box2::around((0..drawn.ink.len()).map(|i| fit.point(drawn.ink.point(i))));
                bounds = match (bounds, around) {
                    (Some(all), Some(one)) => Some(all.union(one)),
                    (all, one) => all.or(one),
                };
            }
            StrokeState::Kept(_) => bad += 1,
        }
    }
    let mut parts = vec![ink.strokes.len().to_string()];
    if bad > 0 {
        parts.push(format!("bad={bad}"));
    }
    parts.push(bounds.map_or_else(|| "-".to_owned(), Box2::line));
    parts.join(" ")
}

/// I tratti del livello come una `add_strokes`, se l'operazione ricrea il
/// livello uguale: un livello valido con `v` scritto `1`, nessun campo in più,
/// almeno un tratto e ogni tratto che si disegna. Ogni tratto va com'è nel
/// file: le stringhe `brush` e `ink` esatte, `at` e i campi sconosciuti. Gli
/// altri livelli restano dove sono (`None`): quello di una scheda nella
/// scheda intera, com'è nel file.
pub(super) fn strokes_op(value: &Value, layer: LayerRef) -> Option<CanvasOp> {
    let ink = InkLayer::from_value(value).ok()?;
    let carried = ink.version().as_u64() == Some(1)
        && ink.extra.is_empty()
        && !ink.strokes.is_empty()
        && ink
            .strokes
            .iter()
            .all(|stroke| stroke.state(&layer).is_drawn());
    if !carried {
        return None;
    }
    let strokes = ink
        .strokes
        .iter()
        .map(|stroke| match stroke.to_value() {
            Value::Object(fields) => fields,
            // Un tratto è sempre un oggetto.
            _ => Map::new(),
        })
        .collect();
    Some(CanvasOp::AddStrokes { layer, strokes })
}

/// Dove sta un livello nel valore JSON della lavagna.
#[derive(Copy, Clone)]
enum Holder {
    /// La scheda in questa posizione di `nodes`.
    Node(usize),
    /// La radice.
    Board,
}

/// Un tratto del livello letto.
enum Read {
    Drawn(Decoded),
    /// Il tratto com'è nel file, con `bad` che dice perché non si disegna.
    Kept(Value),
}

/// Un livello valido, letto.
struct ReadLayer {
    holder: Holder,
    /// `v` com'era scritto e i campi in più del livello, nel loro ordine.
    v: Number,
    extra: Map<String, Value>,
    strokes: Vec<Read>,
}

impl ReadLayer {
    fn of(
        holder: Holder,
        value: &Value,
        layer: &LayerRef,
        node: Option<&CanvasNode>,
    ) -> Option<Self> {
        let ink = InkLayer::from_value(value).ok()?;
        let strokes = ink
            .strokes
            .iter()
            .map(|stroke| match stroke.state(layer) {
                StrokeState::Drawn(drawn) => Read::Drawn(Decoded::of(&stroke.id, &drawn, node)),
                StrokeState::Kept(reason) => {
                    let mut kept = stroke.to_value();
                    if let Value::Object(fields) = &mut kept {
                        fields.insert(BAD.to_owned(), Value::from(reason.as_str()));
                    }
                    Read::Kept(kept)
                }
            })
            .collect();
        Some(ReadLayer {
            holder,
            v: ink.version().clone(),
            extra: ink.extra.clone(),
            strokes,
        })
    }

    /// Il livello come oggetto JSON: `v`, `strokes`, poi i campi in più. `shown`
    /// dà i punti da mostrare per ogni tratto che si disegna, nell'ordine.
    fn value(&self, shown: &mut impl Iterator<Item = usize>) -> Value {
        let strokes = self
            .strokes
            .iter()
            .map(|stroke| match stroke {
                Read::Drawn(decoded) => decoded.value(shown.next().unwrap_or(usize::MAX)),
                Read::Kept(kept) => kept.clone(),
            })
            .collect();
        let mut map = Map::with_capacity(2 + self.extra.len());
        map.insert("v".to_owned(), Value::Number(self.v.clone()));
        map.insert("strokes".to_owned(), Value::Array(strokes));
        for (key, value) in &self.extra {
            map.insert(key.clone(), value.clone());
        }
        Value::Object(map)
    }

    fn drawn(&self) -> impl Iterator<Item = &Decoded> {
        self.strokes.iter().filter_map(|stroke| match stroke {
            Read::Drawn(decoded) => Some(decoded),
            Read::Kept(_) => None,
        })
    }
}

/// Mette nel valore JSON della lavagna, al posto di ogni livello valido, il
/// livello letto: i tratti che si disegnano decodificati, quelli che non si
/// disegnano com'erano con `bad`. Un livello estraneo resta com'è.
///
/// `nodes` sono le schede di `model["nodes"]`, nello stesso ordine; `board` è
/// il livello della radice, se la lettura lo mostra. Con `max_chars`, se il
/// JSON compatto supera quei caratteri si tolgono punti dalla fine, a partire
/// dall'ultimo tratto letto: i tratti restano tutti, col loro riquadro intero, e
/// `points_omitted` dice quanti punti mancano. Il resto del modello non si
/// taglia, e se già da solo supera il limite esce senza punti.
pub(super) fn read_layers_into(
    model: &mut Value,
    nodes: &[&CanvasNode],
    board: Option<&Value>,
    max_chars: Option<usize>,
) {
    let mut layers: Vec<ReadLayer> = nodes
        .iter()
        .enumerate()
        .filter_map(|(position, node)| {
            let value = node.extra.get(crate::ink::INK_KEY)?;
            let layer = LayerRef::Node(node.id.clone());
            ReadLayer::of(Holder::Node(position), value, &layer, Some(node))
        })
        .collect();
    if let Some(value) = board {
        layers.extend(ReadLayer::of(Holder::Board, value, &LayerRef::Board, None));
    }
    if layers.is_empty() {
        return;
    }
    let totals: Vec<usize> = layers
        .iter()
        .flat_map(ReadLayer::drawn)
        .map(|decoded| decoded.points.len())
        .collect();
    write_layers(model, &layers, &totals);
    let Some(limit) = max_chars else {
        return;
    };
    if chars(model) <= limit {
        return;
    }
    let mut shown = vec![0; totals.len()];
    write_layers(model, &layers, &shown);
    let mut budget = limit.saturating_sub(chars(model));
    'fill: for (decoded, shown) in layers.iter().flat_map(ReadLayer::drawn).zip(&mut shown) {
        for (index, point) in decoded.points.iter().enumerate() {
            let comma = usize::from(index > 0);
            let cost = point_value(*point).to_string().len() + comma;
            if cost > budget {
                break 'fill;
            }
            budget -= cost;
            *shown += 1;
        }
    }
    write_layers(model, &layers, &shown);
}

/// Scrive i livelli letti nel modello, coi punti `shown` di ogni tratto che si
/// disegna, nell'ordine dei livelli.
fn write_layers(model: &mut Value, layers: &[ReadLayer], shown: &[usize]) {
    let mut shown = shown.iter().copied();
    for layer in layers {
        let value = layer.value(&mut shown);
        let slot = match layer.holder {
            Holder::Node(position) => model
                .get_mut("nodes")
                .and_then(|nodes| nodes.get_mut(position)),
            Holder::Board => Some(&mut *model),
        };
        if let Some(Value::Object(holder)) = slot {
            holder.insert(crate::ink::INK_KEY.to_owned(), value);
        }
    }
}

/// I caratteri del valore scritto come JSON compatto.
fn chars(value: &Value) -> usize {
    value.to_string().chars().count()
}

fn point_value([x, y]: [f64; 2]) -> Value {
    Value::Array(vec![number(x), number(y)])
}

/// Arrotonda a 0,1, senza `-0`.
fn tenth(value: f64) -> f64 {
    round_to(value, 10.0)
}

/// Arrotonda a 0,01, senza `-0`.
fn hundredth(value: f64) -> f64 {
    round_to(value, 100.0)
}

fn round_to(value: f64, factor: f64) -> f64 {
    let rounded = (value * factor).round() / factor;
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// Un numero JSON: intero se lo è, come lo scriverebbe JavaScript.
fn number(value: f64) -> Value {
    #[allow(clippy::cast_precision_loss)]
    let bound = MAX_SAFE_INTEGER as f64;
    if value.fract() == 0.0 && value.abs() <= bound {
        // Entro ±(2^53−1) e senza parte frazionaria: il cast è esatto.
        #[allow(clippy::cast_possible_truncation)]
        let integer = value as i64;
        Value::from(integer)
    } else {
        Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}
