//! L'inchiostro nelle tre letture della lavagna.
//!
//! I livelli si leggono con le regole di [`crate::ink`], le sole
//! dell'inchiostro; qui si decide soltanto come compaiono:
//! - nell'outline, quanti tratti ha un livello, quanti non si disegnano e il
//!   riquadro di quelli che si disegnano ([`summary`]);
//! - nel codice, i tratti come `add_strokes`, con le stringhe esatte del file,
//!   quando l'operazione ricrea il livello uguale ([`strokes_op`]);
//! - nella lettura dell'inchiostro, accanto al modello, i tratti
//!   decodificati, coi punti arrotondati a 0,1 e tagliati a `max_chars`
//!   ([`read_layers`]). Il modello tiene `fub:ink` com'è nel file: una scheda
//!   letta e rimandata con `set` non perde l'inchiostro.
//!
//! I punti di un tratto di una scheda sono nelle coordinate della scheda com'è
//! adesso, con 0,0 nell'angolo in alto a sinistra: la misura di riferimento
//! dell'ancora si porta alla misura di adesso come fa la resa («La misura della
//! scheda» in `docs/reference/canvas-ink.md`). Quelli di un tratto libero sono
//! nelle coordinate della lavagna. Le regole stanno in
//! `docs/reference/canvas-ink-code.md`.

use fub_ink_codec::{InkBrush, PEN_KEY};
use serde_json::{Map, Number, Value};

use crate::ink::{DrawnStroke, InkAnchor, InkFit as Fit, InkLayer, LayerRef, StrokeState};
use crate::model::{CanvasNode, MAX_SAFE_INTEGER};
use crate::ops::CanvasOp;

/// Il campo che dice quanti punti di un tratto il JSON non mostra.
const POINTS_OMITTED: &str = "points_omitted";

/// Il campo che dice perché un tratto non si disegna, nel JSON.
const BAD: &str = "bad";

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
    /// L'ancora di pagina o di cella, senza la misura: i punti, il riquadro
    /// e lo spessore sono nelle sue unità, perché il nucleo non sa dove la
    /// pagina o la cella sta nella scheda ([`Fit::of`]). `None` per gli altri
    /// tratti.
    anchor: Option<Value>,
}

impl Decoded {
    fn of(id: &str, drawn: &DrawnStroke, node: Option<&CanvasNode>) -> Decoded {
        // La lettura non sa la proporzione del contenuto della scheda (la sa
        // la resa): la misura è quella di N4, senza `aspect`.
        let placed = Fit::of(node, &drawn.anchor, None);
        let fit = placed.unwrap_or(Fit::IDENTITY);
        let anchor = placed.is_none().then(|| content_anchor(&drawn.anchor));
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
            anchor,
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
        if let Some(anchor) = &self.anchor {
            map.insert("anchor".to_owned(), anchor.clone());
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

/// L'ancora di pagina (`{"kind": "page", "page", "width", "height"}`) o di cella (`{"kind":
/// "cell", "sheet", "cell"}`) di un tratto, per la lettura dell'inchiostro.
fn content_anchor(anchor: &InkAnchor) -> Value {
    let mut map = Map::new();
    match anchor {
        InkAnchor::Page {
            page,
            width,
            height,
        } => {
            map.insert("kind".to_owned(), Value::from("page"));
            map.insert("page".to_owned(), Value::from(*page));
            // La misura della pagina quando il tratto si è scritto: i punti
            // sono in quella scala. Con il PDF sostituito da una pagina di
            // un'altra misura, chi li ripassa a `erase_along` sa come portarli.
            map.insert("width".to_owned(), number(*width));
            map.insert("height".to_owned(), number(*height));
        }
        InkAnchor::Cell { sheet, cell } => {
            map.insert("kind".to_owned(), Value::from("cell"));
            map.insert("sheet".to_owned(), Value::String(sheet.clone()));
            map.insert("cell".to_owned(), Value::String(cell.to_string()));
        }
        InkAnchor::Card { .. } | InkAnchor::Free => {}
    }
    Value::Object(map)
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
                // Un tratto di pagina o di cella conta, ma il nucleo non sa
                // dove sta nella scheda: non entra nel riquadro.
                let Some(fit) = Fit::of(node, &drawn.anchor, None) else {
                    continue;
                };
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
/// livello uguale, chiavi nello stesso ordine: un livello valido con `v`
/// scritto `1`, nessun campo in più, scritto nell'ordine in cui lo scrive Fub,
/// almeno un tratto e ogni tratto che si disegna. Ogni tratto va com'è nel
/// file: le stringhe `brush` e `ink` esatte, `at` e i campi sconosciuti. Gli
/// altri livelli restano dove sono (`None`): quello di una scheda nella
/// scheda intera, com'è nel file.
pub(super) fn strokes_op(value: &Value, layer: LayerRef) -> Option<CanvasOp> {
    let ink = InkLayer::from_value(value).ok()?;
    // `add_strokes` scrive il livello `{"v": 1, "strokes": [...]}` e ogni
    // tratto nell'ordine di `InkStroke::to_value`: il livello del file deve
    // essere già scritto così, byte per byte, o il giro ne cambia l'ordine. Si
    // confronta il testo: l'uguaglianza dei valori ignora l'ordine delle chiavi.
    let (written, read) = (ink.to_value().to_string(), value.to_string());
    let carried = ink.version().as_u64() == Some(1)
        && ink.extra.is_empty()
        && written == read
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

/// Un tratto letto.
enum Read {
    Drawn(Decoded),
    /// Un tratto che non si disegna: l'id e la ragione.
    Kept {
        id: String,
        reason: &'static str,
    },
}

/// Un livello letto: dove sta e, se è valido, i suoi tratti; `None` se è
/// estraneo.
struct ReadLayer {
    layer: LayerRef,
    strokes: Option<Vec<Read>>,
}

impl ReadLayer {
    fn of(value: &Value, layer: LayerRef, node: Option<&CanvasNode>) -> Self {
        let strokes = InkLayer::from_value(value).ok().map(|ink| {
            ink.strokes
                .iter()
                .map(|stroke| match stroke.state(&layer) {
                    StrokeState::Drawn(drawn) => Read::Drawn(Decoded::of(&stroke.id, &drawn, node)),
                    StrokeState::Kept(reason) => Read::Kept {
                        id: stroke.id.clone(),
                        reason: reason.as_str(),
                    },
                })
                .collect()
        });
        ReadLayer { layer, strokes }
    }

    /// Il livello letto come oggetto JSON: `layer`, `state` (`ok` o
    /// `foreign`) e `strokes`. `shown` dà i punti da mostrare per ogni tratto
    /// che si disegna, nell'ordine.
    fn value(&self, shown: &mut impl Iterator<Item = usize>) -> Value {
        let strokes: Vec<Value> = self
            .strokes
            .iter()
            .flatten()
            .map(|stroke| match stroke {
                Read::Drawn(decoded) => decoded.value(shown.next().unwrap_or(usize::MAX)),
                Read::Kept { id, reason } => {
                    let mut map = Map::new();
                    map.insert("id".to_owned(), Value::String(id.clone()));
                    map.insert(BAD.to_owned(), Value::from(*reason));
                    Value::Object(map)
                }
            })
            .collect();
        let state = if self.strokes.is_some() {
            "ok"
        } else {
            "foreign"
        };
        let mut map = Map::new();
        map.insert(
            "layer".to_owned(),
            serde_json::to_value(&self.layer).unwrap_or(Value::Null),
        );
        map.insert("state".to_owned(), Value::from(state));
        map.insert("strokes".to_owned(), Value::Array(strokes));
        Value::Object(map)
    }

    fn drawn(&self) -> impl Iterator<Item = &Decoded> {
        self.strokes
            .iter()
            .flatten()
            .filter_map(|stroke| match stroke {
                Read::Drawn(decoded) => Some(decoded),
                Read::Kept { .. } => None,
            })
    }
}

/// La lettura dei livelli d'inchiostro: un oggetto per livello, quelli delle
/// schede `nodes` nel loro ordine, poi `board` (il livello della radice) se la
/// lettura lo mostra. È solo da leggere: il modello tiene `fub:ink` com'è nel
/// file.
///
/// Con `max_chars`, se la lettura scritta come JSON compatto supera quei
/// caratteri si mostrano i primi punti nell'ordine dei tratti finché ci
/// stanno: i tratti restano tutti, col loro riquadro intero, e
/// `points_omitted` dice quanti punti mancano. Se la lettura senza punti
/// supera già il limite, esce senza punti.
pub(super) fn read_layers(
    nodes: &[&CanvasNode],
    board: Option<&Value>,
    max_chars: Option<usize>,
) -> Value {
    let mut layers: Vec<ReadLayer> = nodes
        .iter()
        .filter_map(|node| {
            let value = node.extra.get(crate::ink::INK_KEY)?;
            Some(ReadLayer::of(
                value,
                LayerRef::Node(node.id.clone()),
                Some(node),
            ))
        })
        .collect();
    if let Some(value) = board {
        layers.push(ReadLayer::of(value, LayerRef::Board, None));
    }
    let totals: Vec<usize> = layers
        .iter()
        .flat_map(ReadLayer::drawn)
        .map(|decoded| decoded.points.len())
        .collect();
    let whole = layers_value(&layers, &totals);
    let Some(limit) = max_chars else {
        return whole;
    };
    if chars(&whole) <= limit {
        return whole;
    }
    let mut shown = vec![0; totals.len()];
    let mut budget = limit.saturating_sub(chars(&layers_value(&layers, &shown)));
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
    layers_value(&layers, &shown)
}

/// I livelli letti come array JSON, coi punti `shown` di ogni tratto che si
/// disegna, nell'ordine dei livelli.
fn layers_value(layers: &[ReadLayer], shown: &[usize]) -> Value {
    let mut shown = shown.iter().copied();
    Value::Array(layers.iter().map(|layer| layer.value(&mut shown)).collect())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::{scales, InkAnchor};
    use std::path::PathBuf;

    /// I vettori di `canvas-ink-fit/`, la prova di `ink-fit.ts` della resa:
    /// `Fit` deve dare lo stesso modo, lo stesso fattore, lo stesso spostamento
    /// e gli stessi punti.
    #[test]
    fn fit_follows_the_vectors_of_the_render() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/src/__fixtures__/canvas-ink-fit");
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        files.sort();
        assert!(files.len() >= 23, "{} vettori", files.len());
        for path in files {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let vector: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let mut card = vector["card"].as_object().unwrap().clone();
            card.insert("id".to_owned(), Value::from("c"));
            card.insert("x".to_owned(), Value::from(0));
            card.insert("y".to_owned(), Value::from(0));
            card.insert("width".to_owned(), vector["size"]["width"].clone());
            card.insert("height".to_owned(), vector["size"]["height"].clone());
            let node: CanvasNode = serde_json::from_value(Value::Object(card))
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            let anchor = InkAnchor::Card {
                width: vector["ref"]["width"].as_f64().unwrap(),
                height: vector["ref"]["height"].as_f64().unwrap(),
            };
            let fit = Fit::of(Some(&node), &anchor, None).expect("un'ancora card");
            let expect = &vector["expect"];
            let mode = if scales(&node) { "scale" } else { "fixed" };
            assert_eq!(mode, expect["mode"], "{name}");
            assert_eq!(fit.s, expect["s"].as_f64().unwrap(), "{name}: s");
            assert_eq!(fit.dx, expect["x"].as_f64().unwrap(), "{name}: x");
            assert_eq!(fit.dy, expect["y"].as_f64().unwrap(), "{name}: y");
            for case in expect["points"].as_array().into_iter().flatten() {
                let from = [
                    case["from"][0].as_f64().unwrap(),
                    case["from"][1].as_f64().unwrap(),
                ];
                let to = [
                    case["to"][0].as_f64().unwrap(),
                    case["to"][1].as_f64().unwrap(),
                ];
                assert_eq!(fit.point(from), to, "{name}: {from:?}");
            }
        }
    }

    /// Il `#` nel campo `file` non taglia il nome, come `extOf` della resa: la
    /// specie della scheda (`card_kind`) lo taglia, il modo dell'inchiostro no.
    #[test]
    fn a_hash_in_the_file_name_does_not_cut_the_extension() {
        let node = |file: &str| -> CanvasNode {
            serde_json::from_value(serde_json::json!({"id": "c", "type": "file", "file": file,
                "x": 0, "y": 0, "width": 10, "height": 10}))
            .unwrap()
        };
        assert!(scales(&node("Foto/foto#1.png")));
        assert!(!scales(&node("Foto/foto.png#1")));
        assert!(scales(&node("Foto/.a.png")));
        assert!(!scales(&node("Foto/.png")));
        assert!(!scales(&node("Foto/foto.")));
    }

    /// Un tratto di pagina o di cella conta nella riga dell'outline ma non
    /// entra nel riquadro, e nella lettura porta la sua ancora coi punti nelle
    /// sue unità: il nucleo non sa dove la pagina o la cella sta nella scheda.
    #[test]
    fn a_page_or_cell_stroke_keeps_its_own_units() {
        for (file, anchor, expect) in [
            (
                "carta.pdf",
                serde_json::json!({"kind": "page", "page": 2, "width": 595, "height": 842}),
                serde_json::json!({"kind": "page", "page": 2, "width": 595, "height": 842}),
            ),
            // La misura scritta torna com'è, decimali compresi: i punti sono
            // in quella scala anche se il PDF ora ne ha un'altra.
            (
                "carta.pdf",
                serde_json::json!({"kind": "page", "page": 3, "width": 595.276, "height": 841.89}),
                serde_json::json!({"kind": "page", "page": 3, "width": 595.276, "height": 841.89}),
            ),
            (
                "conti.xlsx",
                serde_json::json!({"kind": "cell", "sheet": "Foglio 1", "cell": "B3"}),
                serde_json::json!({"kind": "cell", "sheet": "Foglio 1", "cell": "B3"}),
            ),
        ] {
            let node: CanvasNode = serde_json::from_value(serde_json::json!({
                "id": "p", "type": "file", "file": file,
                "x": 0, "y": 0, "width": 300, "height": 400,
                "fub:ink": {"v": 1, "strokes": [{"id": "s1", "tool": "pen",
                    "brush": "pf1 size=3", "color": "#0072b2", "anchor": anchor,
                    "ink": "1 s100 cxy 1000,2000 100,0"}]}
            }))
            .unwrap();
            let value = &node.extra[crate::ink::INK_KEY];
            let layer = LayerRef::Node("p".to_owned());
            assert_eq!(summary(value, &layer, Some(&node)), "1 -", "{file}");
            let read = read_layers(&[&node], None, None);
            let stroke = &read[0]["strokes"][0];
            assert_eq!(stroke["anchor"], expect, "{file}");
            assert_eq!(stroke["points"][0], serde_json::json!([10, 20]), "{file}");
            assert_eq!(stroke["size"], serde_json::json!(3), "{file}");
        }
    }
}
