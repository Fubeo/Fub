//! `draw`: un tratto d'inchiostro scritto dal codice, con i punti o con una
//! forma, la penna e il colore per nome. Il nucleo fa ciò che la GUI fa quando
//! la penna si alza: decide a chi va il tratto (la regola dell'ancora, in
//! `ops/anchor.rs`), porta i punti nelle unità dell'ancora, li quantizza e li
//! codifica con `fub-ink-codec`, col pennello della penna (`pen_brush`, la
//! stessa ricetta di `pens.ts`). Il tratto entra poi come farebbe
//! `add_strokes`: lo stesso livello, lo stesso ordine dei campi, gli stessi
//! controlli. Le regole stanno in `docs/reference/canvas-ink-code.md`.
//!
//! Lo strumento del tratto (`pen` o `highlighter`) lo dà la penna: la parola
//! del file viene da [`fub_ink_codec::PenTool::as_str`], e il solo che la
//! rilegge come [`crate::ink::InkTool`] è il controllo di `add_strokes`. Non
//! c'è una seconda conversione fra i due tipi.
//!
//! Il nucleo non ha orologio: il tempo dei campioni è sintetico (8 ms l'uno, a
//! partire da 0), e il tratto non ha `at`.

use std::f64::consts::PI;

use fub_ink_codec::{
    clamp_size, ink_color, pen, pen_brush, Ink, PenSpec, PenTool, Sample, Scale, DEFAULT_PEN,
    MAX_PEN_SIZE, MIN_PEN_SIZE,
};
use serde::{de, Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use super::anchor::{anchor_at, stroke_bounds};
use super::color::parse_hex;
use super::{refuse, saturating_integer, Compiler, OpError};
use crate::ink::{InkAnchor, InkLayer, LayerRef, INK_KEY};
use crate::layout::Rect;
use crate::patch::CanvasPatch;

/// Quanti punti al più ha un tratto di `draw`, dati o fatti da una forma: il
/// limite dei campioni di un tratto (§5 del formato della scena).
pub const MAX_DRAW_POINTS: usize = fub_ink_codec::ink::INK_MAX_SAMPLES;

/// `on` di serie: il tratto va alla scheda come quando si scrive.
pub const ON_AUTO: &str = "auto";
/// `on` per un tratto libero sulla lavagna, come la penna con Alt.
pub const ON_BOARD: &str = "board";

/// Il passo dei campioni di una forma, in unità della lavagna o della scheda.
const SHAPE_STEP: f64 = 4.0;
/// I millisecondi fra due campioni.
const SAMPLE_MS: f64 = 8.0;
/// La pressione di un punto che non la dice, e dei punti delle forme.
const DEFAULT_PRESSURE: f64 = 0.5;
/// Quanti campioni almeno ha un'ellisse.
const ELLIPSE_MIN_SAMPLES: usize = 64;
/// L'angolo fra l'asta e ogni ala della punta di una freccia.
const ARROW_HEAD_DEGREES: f64 = 30.0;
/// La lunghezza più piccola di un'ala della punta.
const ARROW_HEAD_MIN: f64 = 12.0;
/// La lunghezza di un'ala per unità di misura della penna.
const ARROW_HEAD_PER_SIZE: f64 = 3.0;
/// Il raggio dei vertici interni di una stella, rispetto alle punte.
const STAR_INNER: f64 = 0.5;
/// Quante punte almeno ha una stella.
const MIN_STAR_TIPS: i64 = 3;
/// Quanti vertici almeno ha un poligono.
const MIN_POLYGON_POINTS: usize = 3;

/// Gli argomenti di `draw`: dove (`on`), che cosa (`points` o `shape`, uno
/// solo) e come (`pen`, `size`, `color`). `id` è facoltativo: senza, lo dà il
/// seme.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DrawArgs {
    /// `"auto"` (di serie), `"board"` o l'id di una scheda: di chi è il tratto
    /// e in che coordinate sono i punti.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
    /// I punti, `[x, y]` o `[x, y, pressione]` con la pressione da 0 a 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Vec<f64>>>,
    /// Una forma, che diventa punti.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<DrawShape>,
    /// Una delle sette penne di sistema; di serie [`DEFAULT_PEN`].
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "pen_name"
    )]
    pub pen: Option<String>,
    /// La misura, da [`MIN_PEN_SIZE`] a [`MAX_PEN_SIZE`]; di serie quella
    /// della penna.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "pen_size"
    )]
    pub size: Option<f64>,
    /// Un colore della tavolozza dell'inchiostro per nome, o `#rrggbb`; di
    /// serie il blu per la penna e il giallo per l'evidenziatore, come la GUI.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "ink_color_name"
    )]
    pub color: Option<String>,
    /// L'id del tratto, unico nel suo livello.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// Le forme di `draw`. Le coordinate sono quelle di `on`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DrawShape {
    /// Una riga dritta da `(x1, y1)` a `(x2, y2)`.
    Line { x1: f64, y1: f64, x2: f64, y2: f64 },
    /// Una freccia da `(x1, y1)` alla punta in `(x2, y2)`, in un tratto solo.
    Arrow { x1: f64, y1: f64, x2: f64, y2: f64 },
    /// Il contorno chiuso di un rettangolo.
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    /// L'ellisse dentro il rettangolo, chiusa.
    Ellipse {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    /// Il contorno chiuso dei vertici `points`, `[[x, y], …]`.
    Polygon { points: Vec<Vec<f64>> },
    /// Una stella di centro `(cx, cy)`, con `tips` punte a distanza `r`.
    Star {
        cx: f64,
        cy: f64,
        r: f64,
        #[serde(deserialize_with = "saturating_integer")]
        tips: i64,
    },
}

/// Se `name` è una penna di sistema, come la legge `draw`.
pub fn is_pen_name(name: &str) -> bool {
    pen(name).is_some()
}

/// Se `size` è una misura che `draw` accetta.
pub fn is_pen_size(size: f64) -> bool {
    (MIN_PEN_SIZE..=MAX_PEN_SIZE).contains(&size)
}

/// Il colore `#rrggbb` minuscolo di un nome della tavolozza o di un
/// `#rrggbb` (anche maiuscolo), o `None`. L'esadecimale si legge come i
/// colori delle schede, con `color::parse_hex`.
pub fn ink_hex(text: &str) -> Option<String> {
    if let Some(color) = ink_color(text) {
        return Some(color.to_owned());
    }
    parse_hex(text)
}

/// Un campo facoltativo con un controllo: `null` vale come assente, un valore
/// che il controllo non accetta è un errore di lettura (come per `validate`).
fn checked<'de, D, T>(
    deserializer: D,
    accepts: impl Fn(&T) -> bool,
    expected: &'static str,
) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + std::fmt::Debug,
{
    match Option::<T>::deserialize(deserializer)? {
        Some(value) if !accepts(&value) => Err(de::Error::custom(format_args!(
            "{value:?} is not {expected}"
        ))),
        value => Ok(value),
    }
}

fn pen_name<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    checked(deserializer, |name: &String| is_pen_name(name), "a pen")
}

fn pen_size<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    checked(
        deserializer,
        |size: &f64| is_pen_size(*size),
        "a size from 0.25 to 200",
    )
}

fn ink_color_name<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    checked(
        deserializer,
        |text: &String| ink_hex(text).is_some(),
        "an ink color",
    )
}

/// Un punto del tratto: dove, e con che pressione.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Point {
    x: f64,
    y: f64,
    p: f64,
}

impl Compiler {
    /// `draw`: i punti, l'ancora, il pennello, poi `add_strokes` con un tratto.
    pub(super) fn draw(
        &mut self,
        index: usize,
        args: &DrawArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let name = args.pen.as_deref().unwrap_or(DEFAULT_PEN);
        let spec = pen(name).ok_or_else(|| refuse(index, format!("there is no pen {name:?}")))?;
        let size = clamp_size(spec, args.size.unwrap_or(spec.size));
        let color = match &args.color {
            Some(text) => ink_hex(text)
                .ok_or_else(|| refuse(index, format!("{text:?} is not an ink color")))?,
            None => default_color(spec).to_owned(),
        };
        let points = match (&args.points, &args.shape) {
            (Some(points), None) => given_points(index, points)?,
            (None, Some(shape)) => shape_points(index, shape, size)?,
            (Some(_), Some(_)) => return Err(refuse(index, "give `points` or `shape`, not both")),
            (None, None) => return Err(refuse(index, "give `points` or `shape`")),
        };
        let (layer, anchor, origin) = self.draw_target(index, args.on.as_deref(), &points, size)?;
        let samples: Vec<Sample> = (0_u32..)
            .zip(&points)
            .map(|(i, point)| Sample {
                x: point.x - origin.0,
                y: point.y - origin.1,
                p: Some(point.p),
                t: f64::from(i) * SAMPLE_MS,
                tilt: None,
            })
            .collect();
        let ink = Ink::quantize(&samples, Scale::S100)
            .map_err(|error| refuse(index, format!("the points do not make a stroke ({error})")))?;
        // I campioni portano sempre la pressione: il pennello non la simula.
        let brush = pen_brush(spec, size, true)
            .encode()
            .map_err(|error| refuse(index, format!("the pen brush does not encode ({error})")))?;
        let mut stroke = Map::new();
        stroke.insert(
            "id".to_owned(),
            args.id.clone().map_or(Value::Null, Value::String),
        );
        stroke.insert("tool".to_owned(), Value::from(spec.tool.as_str()));
        stroke.insert("brush".to_owned(), Value::String(brush));
        stroke.insert("color".to_owned(), Value::String(color));
        stroke.insert("anchor".to_owned(), anchor.to_value());
        stroke.insert("ink".to_owned(), Value::String(ink.encode()));
        self.add_strokes(index, &layer, &[stroke])
    }

    /// Il livello, l'ancora e l'origine delle coordinate del tratto, da `on`.
    /// I punti di una scheda sono già nelle sue unità; con `auto` sono della
    /// lavagna, e vanno alla scheda che li prende (togliendo il suo angolo) o
    /// restano liberi.
    fn draw_target(
        &self,
        index: usize,
        on: Option<&str>,
        points: &[Point],
        size: f64,
    ) -> Result<(LayerRef, InkAnchor, (f64, f64)), OpError> {
        match on.unwrap_or(ON_AUTO) {
            ON_BOARD => Ok((LayerRef::Board, InkAnchor::Free, (0.0, 0.0))),
            ON_AUTO => {
                let nodes = &self.working.nodes;
                let cards: Vec<Rect> = nodes.iter().map(Rect::of_node).collect();
                let bounds = stroke_bounds(points.iter().map(|point| (point.x, point.y)), size);
                // Come la tela: una scheda col livello estraneo non prende il
                // tratto.
                let holder = anchor_at(&cards, bounds, |at| {
                    nodes[at]
                        .extra
                        .get(INK_KEY)
                        .is_none_or(|value| InkLayer::from_value(value).is_ok())
                });
                Ok(match holder {
                    Some(at) => {
                        let node = &nodes[at];
                        (
                            LayerRef::Node(node.id.clone()),
                            InkAnchor::card_of(node),
                            (cards[at].x, cards[at].y),
                        )
                    }
                    None => (LayerRef::Board, InkAnchor::Free, (0.0, 0.0)),
                })
            }
            id => {
                let node = self.node(index, id)?;
                Ok((
                    LayerRef::Node(node.id.clone()),
                    InkAnchor::card_of(node),
                    (0.0, 0.0),
                ))
            }
        }
    }
}

/// Il colore di serie dello strumento della penna, come la GUI: la penna blu,
/// l'evidenziatore giallo.
fn default_color(spec: &PenSpec) -> &'static str {
    let name = match spec.tool {
        PenTool::Pen => "blue",
        PenTool::Highlighter => "yellow",
    };
    ink_color(name).unwrap_or("#000000")
}

fn too_many(index: usize) -> OpError {
    OpError::TooMany {
        index,
        what: "points in a stroke",
        limit: MAX_DRAW_POINTS,
    }
}

/// I punti dati: `[x, y]` o `[x, y, pressione]`, almeno uno, al più
/// [`MAX_DRAW_POINTS`].
fn given_points(index: usize, points: &[Vec<f64>]) -> Result<Vec<Point>, OpError> {
    if points.is_empty() {
        return Err(refuse(index, "`points` is empty"));
    }
    if points.len() > MAX_DRAW_POINTS {
        return Err(too_many(index));
    }
    points
        .iter()
        .enumerate()
        .map(|(at, point)| match point.as_slice() {
            [x, y] => Ok(Point {
                x: *x,
                y: *y,
                p: DEFAULT_PRESSURE,
            }),
            [x, y, p] if (0.0..=1.0).contains(p) => Ok(Point {
                x: *x,
                y: *y,
                p: *p,
            }),
            [_, _, _] => Err(refuse(
                index,
                format!("point {at}: the pressure goes from 0 to 1"),
            )),
            _ => Err(refuse(
                index,
                format!("point {at}: a point is [x, y] or [x, y, pressure]"),
            )),
        })
        .collect()
}

/// I punti di una forma, col passo [`SHAPE_STEP`] e la pressione di serie.
fn shape_points(index: usize, shape: &DrawShape, size: f64) -> Result<Vec<Point>, OpError> {
    let corners = match *shape {
        DrawShape::Line { x1, y1, x2, y2 } => vec![(x1, y1), (x2, y2)],
        DrawShape::Arrow { x1, y1, x2, y2 } => arrow(index, (x1, y1), (x2, y2), size)?,
        DrawShape::Rect {
            x,
            y,
            width,
            height,
        } => {
            sides(index, width, height)?;
            vec![
                (x, y),
                (x + width, y),
                (x + width, y + height),
                (x, y + height),
                (x, y),
            ]
        }
        DrawShape::Ellipse {
            x,
            y,
            width,
            height,
        } => {
            sides(index, width, height)?;
            return ellipse(index, x, y, width, height);
        }
        DrawShape::Polygon { ref points } => polygon(index, points)?,
        DrawShape::Star { cx, cy, r, tips } => star(index, cx, cy, r, tips)?,
    };
    polyline(index, &corners)
}

/// Le misure di un rettangolo o di un'ellisse: non negative.
fn sides(index: usize, width: f64, height: f64) -> Result<(), OpError> {
    if width < 0.0 || height < 0.0 {
        return Err(refuse(index, "`width` and `height` cannot be negative"));
    }
    Ok(())
}

/// L'asta, poi le due ali della punta, ognuna fino in fondo e indietro alla
/// cima: un tratto solo.
fn arrow(
    index: usize,
    from: (f64, f64),
    tip: (f64, f64),
    size: f64,
) -> Result<Vec<(f64, f64)>, OpError> {
    let (dx, dy) = (from.0 - tip.0, from.1 - tip.1);
    let length = dx.hypot(dy);
    if length == 0.0 || !length.is_finite() {
        return Err(refuse(index, "an arrow needs two different, finite ends"));
    }
    let head = ARROW_HEAD_MIN.max(ARROW_HEAD_PER_SIZE * size);
    let (ux, uy) = (dx / length, dy / length);
    let (sin, cos) = ARROW_HEAD_DEGREES.to_radians().sin_cos();
    let wing = |sin: f64| {
        (
            tip.0 + head * (ux * cos - uy * sin),
            tip.1 + head * (ux * sin + uy * cos),
        )
    };
    Ok(vec![from, tip, wing(sin), tip, wing(-sin), tip])
}

/// I vertici di un poligono, chiuso: almeno [`MIN_POLYGON_POINTS`], ognuno
/// `[x, y]`.
fn polygon(index: usize, points: &[Vec<f64>]) -> Result<Vec<(f64, f64)>, OpError> {
    if points.len() < MIN_POLYGON_POINTS {
        return Err(refuse(index, "a polygon has at least 3 points"));
    }
    if points.len() > MAX_DRAW_POINTS {
        return Err(too_many(index));
    }
    let mut corners = points
        .iter()
        .enumerate()
        .map(|(at, point)| match point.as_slice() {
            [x, y] => Ok((*x, *y)),
            _ => Err(refuse(
                index,
                format!("polygon point {at}: a point is [x, y]"),
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    corners.push(corners[0]);
    Ok(corners)
}

/// I vertici di una stella, chiusa: una punta in alto, poi un vertice interno
/// e una punta, in senso orario.
fn star(index: usize, cx: f64, cy: f64, r: f64, tips: i64) -> Result<Vec<(f64, f64)>, OpError> {
    if tips < MIN_STAR_TIPS {
        return Err(refuse(index, "a star has at least 3 tips"));
    }
    if r.is_nan() || r <= 0.0 {
        return Err(refuse(
            index,
            "the radius of a star must be greater than zero",
        ));
    }
    let Ok(tips) = u32::try_from(tips) else {
        return Err(too_many(index));
    };
    if usize::try_from(tips).map_or(true, |tips| tips > MAX_DRAW_POINTS) {
        return Err(too_many(index));
    }
    let count = 2 * tips;
    let mut corners: Vec<(f64, f64)> = (0..count)
        .map(|k| {
            let radius = if k % 2 == 0 { r } else { r * STAR_INNER };
            let angle = -PI / 2.0 + PI * f64::from(k) / f64::from(tips);
            (cx + radius * angle.cos(), cy + radius * angle.sin())
        })
        .collect();
    corners.push(corners[0]);
    Ok(corners)
}

/// I campioni della spezzata `corners`: il primo vertice, poi ogni lato in
/// parti uguali non più lunghe di [`SHAPE_STEP`]. Un lato lungo zero non
/// aggiunge niente. Il conto si fa prima di scrivere un campione: una forma
/// che passerebbe [`MAX_DRAW_POINTS`] è `TooMany`.
fn polyline(index: usize, corners: &[(f64, f64)]) -> Result<Vec<Point>, OpError> {
    let parts: Vec<f64> = corners
        .windows(2)
        .map(|pair| {
            let length = (pair[1].0 - pair[0].0).hypot(pair[1].1 - pair[0].1);
            (length / SHAPE_STEP).ceil()
        })
        .collect();
    let total = 1.0 + parts.iter().sum::<f64>();
    // Anche un lato infinito o `NaN` è troppo.
    if total.is_nan() || total > MAX_DRAW_POINTS as f64 {
        return Err(too_many(index));
    }
    let mut points = Vec::with_capacity(total as usize);
    let at = |(x, y): (f64, f64)| Point {
        x,
        y,
        p: DEFAULT_PRESSURE,
    };
    if let Some(&first) = corners.first() {
        points.push(at(first));
    }
    for (pair, &parts) in corners.windows(2).zip(&parts) {
        // Al più MAX_DRAW_POINTS: il cast è esatto.
        let n = parts as u32;
        for k in 1..=n {
            let share = f64::from(k) / f64::from(n);
            let point = if k == n {
                pair[1]
            } else {
                (
                    pair[0].0 + (pair[1].0 - pair[0].0) * share,
                    pair[0].1 + (pair[1].1 - pair[0].1) * share,
                )
            };
            points.push(at(point));
        }
    }
    Ok(points)
}

/// I campioni dell'ellisse dentro il rettangolo: almeno
/// [`ELLIPSE_MIN_SAMPLES`] parti, non più lunghe di [`SHAPE_STEP`] (sulla
/// circonferenza di Ramanujan), dall'alto in senso orario, e l'ultimo uguale
/// al primo.
fn ellipse(index: usize, x: f64, y: f64, width: f64, height: f64) -> Result<Vec<Point>, OpError> {
    let (a, b) = (width / 2.0, height / 2.0);
    let (cx, cy) = (x + a, y + b);
    // Ramanujan nella forma con `h`, che non trabocca dove trabocca `a · b`.
    let perimeter = if a + b > 0.0 {
        let h = ((a - b) / (a + b)).powi(2);
        PI * (a + b) * (1.0 + 3.0 * h / (10.0 + (4.0 - 3.0 * h).sqrt()))
    } else {
        0.0
    };
    let parts = (perimeter / SHAPE_STEP)
        .ceil()
        .max(ELLIPSE_MIN_SAMPLES as f64);
    if parts.is_nan() || parts >= MAX_DRAW_POINTS as f64 || !cx.is_finite() || !cy.is_finite() {
        return Err(too_many(index));
    }
    // Al più MAX_DRAW_POINTS: il cast è esatto.
    let n = parts as u32;
    let mut points: Vec<Point> = (0..n)
        .map(|k| {
            let angle = -PI / 2.0 + 2.0 * PI * f64::from(k) / f64::from(n);
            Point {
                x: cx + a * angle.cos(),
                y: cy + b * angle.sin(),
                p: DEFAULT_PRESSURE,
            }
        })
        .collect();
    points.push(points[0]);
    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::InkTool;
    use fub_ink_codec::PENS;

    #[test]
    fn lo_strumento_di_ogni_penna_e_una_parola_che_il_tratto_legge() {
        for spec in &PENS {
            let word = spec.tool.as_str();
            let read = match spec.tool {
                PenTool::Pen => InkTool::Pen,
                PenTool::Highlighter => InkTool::Highlighter,
            };
            assert_eq!(word, read.as_str(), "{}", spec.id);
        }
    }

    #[test]
    fn i_colori_si_leggono_per_nome_o_esadecimali() {
        assert_eq!(ink_hex("vermilion").as_deref(), Some("#d55e00"));
        assert_eq!(ink_hex("#D55E00").as_deref(), Some("#d55e00"));
        assert_eq!(ink_hex("Blue"), None);
        assert_eq!(ink_hex("cyan"), None);
        assert_eq!(ink_hex("#07b"), None);
        assert_eq!(ink_hex("#0072b2ff"), None);
    }

    #[test]
    fn una_riga_ha_un_campione_ogni_quattro_unita() {
        let points = shape_points(
            0,
            &DrawShape::Line {
                x1: 0.0,
                y1: 0.0,
                x2: 10.0,
                y2: 0.0,
            },
            2.0,
        )
        .expect("una riga");
        let xs: Vec<f64> = points.iter().map(|point| point.x).collect();
        let want = [0.0, 10.0 / 3.0, 20.0 / 3.0, 10.0];
        assert_eq!(xs.len(), want.len());
        assert!(
            xs.iter().zip(want).all(|(x, w)| (x - w).abs() < 1e-12),
            "{xs:?}"
        );
        assert_eq!(xs[3], 10.0, "l'ultimo campione è la fine esatta");
        assert!(points.iter().all(|point| point.p == DEFAULT_PRESSURE));
    }

    #[test]
    fn rettangolo_ellisse_poligono_e_stella_sono_chiusi() {
        let shapes = [
            DrawShape::Rect {
                x: 0.0,
                y: 0.0,
                width: 40.0,
                height: 20.0,
            },
            DrawShape::Ellipse {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            },
            DrawShape::Polygon {
                points: vec![vec![0.0, 0.0], vec![30.0, 0.0], vec![0.0, 30.0]],
            },
            DrawShape::Star {
                cx: 0.0,
                cy: 0.0,
                r: 40.0,
                tips: 5,
            },
        ];
        for shape in &shapes {
            let points = shape_points(0, shape, 2.0).expect("una forma");
            assert_eq!(points.first(), points.last(), "{shape:?}");
        }
    }

    #[test]
    fn un_ellisse_piccola_ha_almeno_64_parti() {
        let points = ellipse(0, 0.0, 0.0, 4.0, 4.0).expect("un'ellisse");
        assert_eq!(points.len(), ELLIPSE_MIN_SAMPLES + 1);
        assert_eq!(
            points[0],
            Point {
                x: 2.0,
                y: 0.0,
                p: DEFAULT_PRESSURE
            }
        );
    }

    #[test]
    fn la_punta_della_freccia_e_lunga_almeno_dodici_e_torna_alla_cima() {
        let corners = arrow(0, (0.0, 0.0), (100.0, 0.0), 2.0).expect("una freccia");
        assert_eq!(corners.len(), 6);
        assert_eq!(corners[1], (100.0, 0.0));
        assert_eq!(corners[3], (100.0, 0.0));
        assert_eq!(corners[5], (100.0, 0.0));
        let wing = (corners[2].0 - 100.0).hypot(corners[2].1);
        assert!((wing - 12.0).abs() < 1e-9);
        let big = arrow(0, (0.0, 0.0), (100.0, 0.0), 10.0).expect("una freccia");
        assert!(((big[2].0 - 100.0).hypot(big[2].1) - 30.0).abs() < 1e-9);
        // Le ali stanno dietro la cima, ai due lati dell'asta.
        assert!(corners[2].0 < 100.0 && corners[4].0 < 100.0);
        assert!(corners[2].1 * corners[4].1 < 0.0);
        assert!(arrow(0, (5.0, 5.0), (5.0, 5.0), 2.0).is_err());
    }

    #[test]
    fn una_forma_enorme_e_troppa_prima_di_scrivere_i_campioni() {
        let huge = DrawShape::Rect {
            x: 0.0,
            y: 0.0,
            width: 1e300,
            height: 1e300,
        };
        assert!(matches!(
            shape_points(0, &huge, 2.0),
            Err(OpError::TooMany { .. })
        ));
        let wide = DrawShape::Line {
            x1: -1e308,
            y1: 0.0,
            x2: 1e308,
            y2: 0.0,
        };
        assert!(matches!(
            shape_points(0, &wide, 2.0),
            Err(OpError::TooMany { .. })
        ));
        assert!(matches!(
            star(0, 0.0, 0.0, 10.0, i64::MAX),
            Err(OpError::TooMany { .. })
        ));
        assert!(matches!(
            ellipse(0, 0.0, 0.0, 1e300, 1.0),
            Err(OpError::TooMany { .. })
        ));
    }
}
