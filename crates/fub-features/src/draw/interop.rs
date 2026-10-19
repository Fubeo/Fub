//! L'export verso Excalidraw (`.excalidraw`) e draw.io (`.drawio`): il
//! disegno esce in forme che i due programmi sanno modificare, e ciò che non
//! ha una forma loro esce come immagine, uguale a come si vede.
//!
//! La pagina si legge due volte. La scena (`fub_scene::read`) dice che cosa è
//! ogni oggetto: un rettangolo, un'ellisse, una linea, una freccia, un
//! connettore coi suoi capi, un testo e la forma o la linea di cui è
//! l'etichetta, un'immagine, un gruppo, un livello. L'albero di `usvg`, lo
//! stesso degli altri formati, dice dove sta e di che colore è: la posizione,
//! la misura e la rotazione, nelle unità del disegno, vengono dalla
//! trasformazione intera dell'oggetto, e una trasformazione che inclina o
//! specchia non è una forma dei due programmi.
//!
//! Ciò che non ha una forma loro, cioè un tratto a mano libera, un tracciato
//! con curve, un riempimento sfumato o a motivo, un effetto, un'istanza di un
//! simbolo, un testo su un tracciato, esce come SVG incorporato: la
//! derivazione della selezione di quel solo oggetto, ripulita come l'export
//! SVG e con le immagini del vault dentro. Si vede uguale e non si modifica
//! come una forma, e il rapporto dice quanti sono.
//!
//! Il rapporto dice anche ciò che cambia: gli oggetti e i livelli nascosti,
//! che restano fuori; in Excalidraw i livelli fusi, i caratteri sostituiti, i
//! tratteggi e le punte avvicinati; in draw.io i gruppi sciolti e le tavole
//! del disegno intero su una pagina sola. Due export dello stesso disegno
//! danno gli stessi byte: niente date, e i numeri casuali di Excalidraw
//! vengono dall'id dell'oggetto.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use fub_abi::error::PluginError;
use fub_abi::transfer::{ArtifactSink, ExportReport, TransferNote};
use fub_scene::connectors::{Anchor, ConnectorEnd, ConnectorKind};
use fub_scene::export::{clean, embed_images, Background, Scope, Source};
use fub_scene::{ConnectorFacts, Item, Role};
use resvg::tiny_skia::{PathSegment, Rect, Transform};
use resvg::usvg::{self, roxmltree, FontFamily, FontStyle, Node, Paint, TextAnchor};
use serde_json::{json, Map, Value};

use super::{data_uri, not_utf8, unreadable, Drawing, File, Outcome, Page, CHUNK};

/// Il namespace degli attributi di FubDraw.
const FUB_NS: &str = "https://fubeo.github.io/ns/scene/1";
const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";
/// Quanti punti prende una curva quando diventa una linea spezzata.
const CURVE_STEPS: usize = 8;
/// Quanto si allarga per lato il riquadro di un oggetto che esce come
/// immagine, perché il bordo sfumato del tratto non resti tagliato.
const PICTURE_MARGIN: f64 = 1.0;

/// Il programma di destinazione.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Target {
    Excalidraw,
    Drawio,
}

impl Target {
    fn name(self) -> &'static str {
        match self {
            Target::Excalidraw => "Excalidraw",
            Target::Drawio => "draw.io",
        }
    }
}

// ---------------------------------------------------------------------------
// Ciò che si legge da una pagina
// ---------------------------------------------------------------------------

/// Un riquadro posato: l'angolo in alto a sinistra del riquadro non ruotato,
/// la misura, e la rotazione in radianti attorno al centro, in senso orario
/// come sullo schermo. Nelle unità del disegno.
#[derive(Clone, Copy, Debug)]
struct Placed {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    angle: f64,
}

impl Placed {
    fn center(&self) -> [f64; 2] {
        [self.x + self.w / 2.0, self.y + self.h / 2.0]
    }
}

/// Un colore con la sua opacità.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rgba {
    rgb: [u8; 3],
    alpha: f64,
}

impl Rgba {
    fn hex(&self) -> String {
        let [r, g, b] = self.rgb;
        format!("#{r:02x}{g:02x}{b:02x}")
    }

    /// Il colore CSS con l'opacità dentro, se non è piena.
    fn css(&self) -> String {
        match self.alpha < 1.0 {
            true => format!("{}{:02x}", self.hex(), (self.alpha * 255.0).round() as u8),
            false => self.hex(),
        }
    }
}

/// Il tratto e il riempimento di una forma.
#[derive(Clone, Debug, Default)]
struct Look {
    stroke: Option<Rgba>,
    fill: Option<Rgba>,
    width: f64,
    /// Il tratteggio, nelle unità del disegno.
    dash: Option<Vec<f64>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Align {
    Left,
    Center,
    Right,
}

/// Il testo di un oggetto testo o di un'etichetta.
#[derive(Clone, Debug)]
struct Words {
    lines: Vec<String>,
    size: f64,
    color: Rgba,
    family: String,
    mono: bool,
    bold: bool,
    italic: bool,
    align: Align,
}

/// Le punte di FubDraw (`fub:marker`); `Other` è una punta disegnata a mano.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tip {
    Triangle,
    Vee,
    Circle,
    Square,
    Diamond,
    Bar,
    Other,
}

/// Il capo di un connettore agganciato: l'oggetto e, se il capo sta al
/// centro di un lato, il punto del riquadro, da 0 a 1.
#[derive(Clone, Debug)]
struct End {
    id: String,
    anchor: Option<[f64; 2]>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum BoxShape {
    Rect { round: f64 },
    Ellipse,
    Diamond,
}

#[derive(Clone, Debug)]
enum Kind {
    Box {
        shape: BoxShape,
        at: Placed,
        look: Look,
    },
    Line {
        points: Vec<[f64; 2]>,
        closed: bool,
        curved: bool,
        look: Look,
        tips: [Option<Tip>; 2],
        ends: [Option<End>; 2],
        arrow: bool,
    },
    Text {
        at: Placed,
        words: Words,
    },
    Picture {
        at: Placed,
        uri: String,
    },
}

/// Un'etichetta presa dal testo che la porta: il suo id, il testo e dove
/// stava.
#[derive(Clone, Debug)]
struct Label {
    id: String,
    words: Words,
    at: Placed,
}

#[derive(Clone, Debug)]
struct Shape {
    id: String,
    layer: Option<usize>,
    /// I gruppi che lo contengono, dal più interno.
    groups: Vec<String>,
    locked: bool,
    link: Option<String>,
    /// L'opacità dei gruppi che lo contengono.
    opacity: f64,
    kind: Kind,
    /// La forma (`fub:inside`) o la linea (`fub:along`) di cui un testo è
    /// l'etichetta.
    label_of: Option<String>,
    label: Option<Label>,
}

#[derive(Clone, Debug)]
struct LayerOut {
    id: String,
    name: String,
    locked: bool,
}

#[derive(Clone, Debug)]
struct Frame {
    id: String,
    name: String,
    rect: [f64; 4],
}

/// Una pagina letta.
struct Read {
    shapes: Vec<Shape>,
    layers: Vec<LayerOut>,
    frames: Vec<Frame>,
    background: Option<Rgba>,
    /// La misura della pagina nelle unità del disegno.
    size: [f64; 2],
}

/// Ciò che cambia passando all'altro programma, contato per il rapporto.
#[derive(Default)]
struct Losses {
    pictures: usize,
    hidden: usize,
    no_id: usize,
    empty: usize,
    foreign: usize,
    text_styles: usize,
    fonts: usize,
    dashes: usize,
    tips: usize,
    layers: usize,
    groups: BTreeSet<String>,
    boards: usize,
}

impl Losses {
    fn notes(&self, target: Target) -> Vec<String> {
        let name = target.name();
        let count = |n: usize, one: &str, many: &str| {
            (n > 0).then(|| match n {
                1 => one.to_string(),
                n => many.replace("{n}", &n.to_string()),
            })
        };
        [
            count(
                self.pictures,
                "1 object (a freehand stroke, a curved path, an effect or a symbol) became a \
                 picture: it looks the same, but is no longer an editable shape",
                "{n} objects (freehand strokes, curved paths, effects or symbols) became \
                 pictures: they look the same, but are no longer editable shapes",
            ),
            count(
                self.hidden,
                "1 hidden object or layer was left out",
                "{n} hidden objects or layers were left out",
            ),
            count(
                self.no_id,
                "1 object without an id was left out",
                "{n} objects without an id were left out",
            ),
            count(
                self.empty,
                "1 object draws nothing and was left out",
                "{n} objects draw nothing and were left out",
            ),
            count(
                self.foreign,
                "1 piece of SVG that Fub does not edit was left out",
                "{n} pieces of SVG that Fub does not edit were left out",
            ),
            count(
                self.text_styles,
                &format!(
                    "1 text with mixed sizes, colours or weights took the style of its first \
                     part, as {name} has one style per text"
                ),
                &format!(
                    "{{n}} texts with mixed sizes, colours or weights took the style of their \
                     first part, as {name} has one style per text"
                ),
            ),
            count(
                self.fonts,
                "1 text uses Excalidraw's Helvetica or Cascadia instead of its own font",
                "{n} texts use Excalidraw's Helvetica or Cascadia instead of their own fonts",
            ),
            count(
                self.dashes,
                "1 dash pattern became Excalidraw's dashed or dotted line",
                "{n} dash patterns became Excalidraw's dashed or dotted line",
            ),
            count(
                self.tips,
                &format!("1 line tip became the nearest one {name} has"),
                &format!("{{n}} line tips became the nearest one {name} has"),
            ),
            count(
                self.layers,
                "",
                "the {n} layers were merged into one, as Excalidraw has no layers",
            ),
            count(
                self.groups.len(),
                "1 group was dissolved: its objects are exported one by one",
                "{n} groups were dissolved: their objects are exported one by one",
            ),
            count(
                self.boards,
                "the board is not a page of its own: export the boards to get one page each",
                "the {n} boards are on one page: export the boards to get one page each",
            ),
        ]
        .into_iter()
        .flatten()
        .filter(|note| !note.is_empty())
        .collect()
    }
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

fn apply(t: &Transform, x: f64, y: f64) -> [f64; 2] {
    [
        t.sx as f64 * x + t.kx as f64 * y + t.tx as f64,
        t.ky as f64 * x + t.sy as f64 * y + t.ty as f64,
    ]
}

/// Il riquadro `r` sotto `t`, se `t` ruota e scala senza inclinare né
/// specchiare: il riquadro posato e la scala media, per gli spessori.
fn placed(t: &Transform, r: Rect) -> Option<(Placed, f64)> {
    let (sx, kx, ky, sy) = (t.sx as f64, t.kx as f64, t.ky as f64, t.sy as f64);
    let a = sx.hypot(ky);
    let det = sx * sy - kx * ky;
    if a < 1e-9 || det <= 1e-12 {
        return None;
    }
    let b = det / a;
    if (sx * kx + ky * sy).abs() > 1e-4 * (a * a + b * b) {
        return None;
    }
    let (w, h) = (r.width() as f64, r.height() as f64);
    let [cx, cy] = apply(t, r.x() as f64 + w / 2.0, r.y() as f64 + h / 2.0);
    let (w, h) = (w * a, h * b);
    Some((
        Placed {
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
            angle: ky.atan2(sx),
        },
        (a * b).sqrt(),
    ))
}

/// Il riquadro dritto che contiene `r` sotto `t`.
fn bounds(t: &Transform, r: Rect) -> [f64; 4] {
    let (x0, y0, x1, y1) = (
        r.left() as f64,
        r.top() as f64,
        r.right() as f64,
        r.bottom() as f64,
    );
    let corners = [
        apply(t, x0, y0),
        apply(t, x1, y0),
        apply(t, x0, y1),
        apply(t, x1, y1),
    ];
    let min_x = corners.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
    let min_y = corners.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    let max_x = corners
        .iter()
        .map(|p| p[0])
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = corners
        .iter()
        .map(|p| p[1])
        .fold(f64::NEG_INFINITY, f64::max);
    [min_x, min_y, max_x - min_x, max_y - min_y]
}

/// I punti del tracciato `path` sotto `t`, se ha un solo sottotracciato: le
/// curve diventano [`CURVE_STEPS`] punti. Con i punti, se si chiude e se
/// aveva curve.
fn points(path: &resvg::tiny_skia::Path, t: &Transform) -> Option<(Vec<[f64; 2]>, bool, bool)> {
    let mut out: Vec<[f64; 2]> = Vec::new();
    let mut closed = false;
    let mut curved = false;
    let mut last = [0.0f64; 2];
    let at = |x: f32, y: f32| apply(t, x as f64, y as f64);
    for segment in path.segments() {
        if closed {
            return None;
        }
        match segment {
            PathSegment::MoveTo(p) => {
                if !out.is_empty() {
                    return None;
                }
                last = [p.x as f64, p.y as f64];
                out.push(at(p.x, p.y));
            }
            PathSegment::LineTo(p) => {
                last = [p.x as f64, p.y as f64];
                out.push(at(p.x, p.y));
            }
            PathSegment::QuadTo(c, p) => {
                curved = true;
                for step in 1..=CURVE_STEPS {
                    let s = step as f64 / CURVE_STEPS as f64;
                    let u = 1.0 - s;
                    let x = u * u * last[0] + 2.0 * u * s * c.x as f64 + s * s * p.x as f64;
                    let y = u * u * last[1] + 2.0 * u * s * c.y as f64 + s * s * p.y as f64;
                    out.push(apply(t, x, y));
                }
                last = [p.x as f64, p.y as f64];
            }
            PathSegment::CubicTo(c1, c2, p) => {
                curved = true;
                for step in 1..=CURVE_STEPS {
                    let s = step as f64 / CURVE_STEPS as f64;
                    let u = 1.0 - s;
                    let (a, b, c, d) = (u * u * u, 3.0 * u * u * s, 3.0 * u * s * s, s * s * s);
                    let x = a * last[0] + b * c1.x as f64 + c * c2.x as f64 + d * p.x as f64;
                    let y = a * last[1] + b * c1.y as f64 + c * c2.y as f64 + d * p.y as f64;
                    out.push(apply(t, x, y));
                }
                last = [p.x as f64, p.y as f64];
            }
            PathSegment::Close => closed = true,
        }
    }
    (out.len() >= 2).then_some((out, closed, curved))
}

/// Vero se il tracciato è un rombo: quattro vertici, uno a metà di ogni lato
/// del suo riquadro.
fn is_rhombus(path: &resvg::tiny_skia::Path) -> bool {
    let Some((points, closed, false)) = points(path, &Transform::identity()) else {
        return false;
    };
    let mut points = points;
    if points.len() == 5 && near(points[0], points[4]) {
        points.pop();
    }
    if !closed || points.len() != 4 {
        return false;
    }
    let r = path.bounds();
    let (x0, y0, x1, y1) = (
        r.left() as f64,
        r.top() as f64,
        r.right() as f64,
        r.bottom() as f64,
    );
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let sides = [[cx, y0], [x1, cy], [cx, y1], [x0, cy]];
    sides
        .iter()
        .all(|side| points.iter().any(|p| near(*p, *side)))
}

fn near(a: [f64; 2], b: [f64; 2]) -> bool {
    (a[0] - b[0]).abs() < 0.01 && (a[1] - b[1]).abs() < 0.01
}

/// La trasformazione dalle unità del disegno ai pixel dell'albero: quella
/// del `viewBox` della radice sulla sua misura, come la fa `usvg`.
fn view_transform(root: roxmltree::Node<'_, '_>, size: usvg::Size) -> Transform {
    let numbers: Vec<f64> = root
        .attribute("viewBox")
        .unwrap_or_default()
        .split(|c: char| c.is_ascii_whitespace() || c == ',')
        .filter(|word| !word.is_empty())
        .filter_map(|word| word.parse().ok())
        .collect();
    let [x, y, w, h] = match numbers[..] {
        [x, y, w, h] if w > 0.0 && h > 0.0 => [x, y, w, h],
        _ => return Transform::identity(),
    };
    let (width, height) = (size.width() as f64, size.height() as f64);
    let aspect = root.attribute("preserveAspectRatio").unwrap_or_default();
    let (sx, sy) = if aspect.trim_start().starts_with("none") {
        (width / w, height / h)
    } else {
        let s = match aspect.contains("slice") {
            true => (width / w).max(height / h),
            false => (width / w).min(height / h),
        };
        (s, s)
    };
    let along = |min: &str, max: &str| match (aspect.contains(min), aspect.contains(max)) {
        (true, _) => 0.0,
        (_, true) => 1.0,
        _ => 0.5,
    };
    let tx = (width - w * sx) * along("xMin", "xMax") - x * sx;
    let ty = (height - h * sy) * along("YMin", "YMax") - y * sy;
    Transform::from_row(sx as f32, 0.0, 0.0, sy as f32, tx as f32, ty as f32)
}

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

/// Il contesto che un contenitore dà ai suoi figli.
#[derive(Clone, Default)]
struct Context {
    layer: Option<usize>,
    groups: Vec<String>,
    locked: bool,
    link: Option<String>,
    opacity: f64,
    /// I figli non si leggono: appartengono a un oggetto già letto, o a
    /// qualcosa che non si esporta.
    closed: bool,
}

/// Ciò che la scena dice di un oggetto: per un elemento estraneo, il ruolo
/// che il suo tag avrebbe.
struct Facts<'i> {
    role: Role,
    id: &'i str,
    arrow: Option<[f64; 4]>,
    connector: Option<&'i ConnectorFacts>,
    text_path: bool,
    lines: Option<Vec<String>>,
}

/// Il ruolo di un elemento estraneo dal suo tag; un gruppo e ciò che non è
/// una forma escono come immagine.
fn role_of(tag: &str) -> Role {
    match tag {
        "rect" => Role::Rect,
        "ellipse" => Role::Ellipse,
        "circle" => Role::Circle,
        "line" => Role::Line,
        "polyline" => Role::Polyline,
        "polygon" => Role::Polygon,
        "path" => Role::Path,
        "text" => Role::Text,
        "image" => Role::Image,
        _ => Role::Instance,
    }
}

/// Ciò che serve a leggere gli oggetti di una pagina.
struct Reader<'x> {
    /// Dalle unità dei pixel dell'albero a quelle del disegno.
    inv: Transform,
    xml: HashMap<&'x str, roxmltree::Node<'x, 'x>>,
    target: Target,
}

impl Reader<'_> {
    fn attr(&self, id: &str, name: &str) -> Option<&str> {
        self.xml.get(id).and_then(|node| node.attribute(name))
    }

    fn href(&self, id: &str) -> Option<String> {
        let node = self.xml.get(id)?;
        node.attribute("href")
            .or_else(|| node.attribute((XLINK_NS, "href")))
            .map(str::to_string)
    }

    /// La punta che il marcatore `name` (`marker-start`, `marker-end`)
    /// dell'oggetto mette.
    fn tip(&self, id: &str, name: &str) -> Option<Tip> {
        let value = self.attr(id, name).or_else(|| {
            let style = self.attr(id, "style")?;
            style.split(';').find_map(|rule| {
                let (key, value) = rule.split_once(':')?;
                (key.trim() == name).then_some(value.trim())
            })
        })?;
        let marker = value
            .trim()
            .strip_prefix("url(")?
            .trim_end_matches(')')
            .trim()
            .trim_matches(['"', '\''])
            .strip_prefix('#')?;
        let shape = self
            .xml
            .get(marker)
            .and_then(|node| node.attribute((FUB_NS, "marker")))
            .and_then(|value| value.split_whitespace().next());
        Some(match shape {
            Some("triangle") => Tip::Triangle,
            Some("vee") => Tip::Vee,
            Some("circle") => Tip::Circle,
            Some("square") => Tip::Square,
            Some("diamond") => Tip::Diamond,
            Some("bar") => Tip::Bar,
            _ => Tip::Other,
        })
    }

    fn color(paint: &Paint, opacity: f32) -> Option<Rgba> {
        match paint {
            Paint::Color(c) => Some(Rgba {
                rgb: [c.red, c.green, c.blue],
                alpha: opacity as f64,
            }),
            _ => None,
        }
    }

    /// Il tratto e il riempimento di un tracciato, se sono colori pieni, con
    /// gli spessori a scala `scale`. `None` per uno sfumato o un motivo.
    fn look(path: &usvg::Path, scale: f64) -> Option<Look> {
        let fill = match path.fill() {
            Some(fill) => Some(Self::color(fill.paint(), fill.opacity().get())?),
            None => None,
        };
        let (stroke, width, dash) = match path.stroke() {
            Some(stroke) => (
                Some(Self::color(stroke.paint(), stroke.opacity().get())?),
                stroke.width().get() as f64 * scale,
                stroke
                    .dasharray()
                    .map(|dash| dash.iter().map(|n| *n as f64 * scale).collect()),
            ),
            None => (None, 0.0, None),
        };
        Some(Look {
            stroke,
            fill,
            width,
            dash,
        })
    }

    /// La forma di un oggetto, se ne ha una nel programma; `None` vuol dire
    /// che esce come immagine.
    fn kind(&self, item: &Facts<'_>, node: &Node, losses: &mut Losses) -> Option<Kind> {
        let excalidraw = self.target == Target::Excalidraw;
        let id = item.id;
        match (item.role, node) {
            (Role::Rect | Role::Ellipse | Role::Circle, Node::Path(path)) => {
                let t = self.inv.pre_concat(path.abs_transform());
                let (at, scale) = placed(&t, path.data().bounds())?;
                let shape = match item.role {
                    Role::Rect => {
                        let rx = self.attr(id, "rx").or_else(|| self.attr(id, "ry"));
                        let round = rx.and_then(|r| r.trim().parse::<f64>().ok()).unwrap_or(0.0);
                        BoxShape::Rect {
                            round: round.max(0.0) * scale,
                        }
                    }
                    _ => BoxShape::Ellipse,
                };
                Some(Kind::Box {
                    shape,
                    at,
                    look: Self::look(path, scale)?,
                })
            }
            (
                Role::Path | Role::Polygon | Role::Ngon | Role::Star | Role::Polyline | Role::Line,
                Node::Path(path),
            ) => {
                let t = self.inv.pre_concat(path.abs_transform());
                let open_line = matches!(item.role, Role::Polyline | Role::Line);
                if !open_line && is_rhombus(path.data()) {
                    let (at, scale) = placed(&t, path.data().bounds())?;
                    return Some(Kind::Box {
                        shape: BoxShape::Diamond,
                        at,
                        look: Self::look(path, scale)?,
                    });
                }
                // draw.io non ha un poligono libero: esce come immagine.
                if !open_line && !excalidraw {
                    return None;
                }
                let (points, closed, curved) = points(path.data(), &t)?;
                if curved && !open_line {
                    return None;
                }
                let (_, scale) = placed(&t, path.data().bounds()).unwrap_or((
                    Placed {
                        x: 0.0,
                        y: 0.0,
                        w: 0.0,
                        h: 0.0,
                        angle: 0.0,
                    },
                    1.0,
                ));
                let look = Self::look(path, scale)?;
                // Una linea aperta col riempimento lo disegna: in Excalidraw
                // il riempimento è soltanto delle linee chiuse.
                if look.stroke.is_none() || (look.fill.is_some() && !closed) {
                    return None;
                }
                Some(self.line(id, points, closed, curved, look, losses, false))
            }
            (Role::Arrow, Node::Path(path)) => {
                let [x1, y1, x2, y2] = item.arrow?;
                let t = self.inv.pre_concat(path.abs_transform());
                let points = vec![apply(&t, x1, y1), apply(&t, x2, y2)];
                let scale = placed(&t, path.data().bounds()).map_or(1.0, |(_, s)| s);
                let mut look = Self::look(path, scale)?;
                look.stroke?;
                look.fill = None;
                let mut kind = self.line(id, points, false, false, look, losses, true);
                if let Kind::Line { tips, .. } = &mut kind {
                    tips[1] = Some(Tip::Vee);
                }
                Some(kind)
            }
            (Role::Connector, Node::Path(path)) => {
                let facts = item.connector?;
                let t = self.inv.pre_concat(path.abs_transform());
                let (points, _, _) = points(path.data(), &t)?;
                let scale = placed(&t, path.data().bounds()).map_or(1.0, |(_, s)| s);
                let mut look = Self::look(path, scale)?;
                look.stroke?;
                look.fill = None;
                let curved = facts.geom.kind == ConnectorKind::Curved;
                let mut kind = self.line(id, points, false, curved, look, losses, true);
                if let Kind::Line { ends, .. } = &mut kind {
                    let end = |end: &Option<ConnectorEnd>| {
                        end.as_ref().map(|end| End {
                            id: end.id.clone(),
                            anchor: anchor(end.anchor),
                        })
                    };
                    *ends = [end(&facts.from), end(&facts.to)];
                }
                Some(kind)
            }
            (Role::Text, Node::Text(text)) => {
                if item.text_path {
                    return None;
                }
                // Un testo estraneo: una riga per pezzo che va a capo.
                let lines = item.lines.clone().unwrap_or_else(|| {
                    text.chunks()
                        .iter()
                        .map(|chunk| chunk.text().to_string())
                        .collect()
                });
                let t = self.inv.pre_concat(text.abs_transform());
                let (at, scale) = placed(&t, text.bounding_box())?;
                let words = words(text, lines, scale, self.target, losses)?;
                Some(Kind::Text { at, words })
            }
            // `usvg` mette l'immagine in un gruppo che porta l'id, e la
            // ritaglia con un altro se la taglia: quella esce come immagine
            // del disegno.
            (Role::Image, Node::Group(group)) => {
                let [Node::Image(image)] = group.children() else {
                    return None;
                };
                if group.clip_path().is_some()
                    || group.mask().is_some()
                    || !group.filters().is_empty()
                {
                    return None;
                }
                let uri = data_uri(image.kind())?;
                let t = self.inv.pre_concat(image.abs_transform());
                let size = image.size();
                let (at, _) = placed(&t, Rect::from_xywh(0.0, 0.0, size.width(), size.height())?)?;
                Some(Kind::Picture { at, uri })
            }
            _ => None,
        }
    }

    /// Una linea, con le punte dei suoi marcatori.
    #[allow(clippy::too_many_arguments)]
    fn line(
        &self,
        id: &str,
        points: Vec<[f64; 2]>,
        closed: bool,
        curved: bool,
        look: Look,
        losses: &mut Losses,
        arrow: bool,
    ) -> Kind {
        let tips = [self.tip(id, "marker-start"), self.tip(id, "marker-end")];
        losses.tips += tips
            .iter()
            .flatten()
            .filter(|tip| !native_tip(**tip, self.target))
            .count();
        Kind::Line {
            points,
            closed,
            curved,
            look,
            tips,
            ends: [None, None],
            arrow,
        }
    }
}

/// Il punto del riquadro di un capo agganciato al centro di un lato.
fn anchor(anchor: Anchor) -> Option<[f64; 2]> {
    match anchor {
        Anchor::Top => Some([0.5, 0.0]),
        Anchor::Right => Some([1.0, 0.5]),
        Anchor::Bottom => Some([0.5, 1.0]),
        Anchor::Left => Some([0.0, 0.5]),
        Anchor::Auto | Anchor::Center => None,
    }
}

/// Vero se la punta ha la sua uguale nel programma.
fn native_tip(tip: Tip, target: Target) -> bool {
    match target {
        Target::Excalidraw => !matches!(tip, Tip::Square | Tip::Other),
        Target::Drawio => tip != Tip::Other,
    }
}

/// Il testo di un `text`: lo stile del primo pezzo, e il conto se gli altri
/// ne hanno un altro.
fn words(
    text: &usvg::Text,
    lines: Vec<String>,
    scale: f64,
    target: Target,
    losses: &mut Losses,
) -> Option<Words> {
    let chunk = text.chunks().first()?;
    let span = chunk.spans().first()?;
    let color = span
        .fill()
        .and_then(|fill| Reader::color(fill.paint(), fill.opacity().get()))?;
    let font = span.font();
    let families = font.families();
    let mono = families.iter().any(|family| match family {
        FontFamily::Monospace => true,
        FontFamily::Named(name) => {
            let name = name.to_ascii_lowercase();
            name.contains("mono") || name.contains("code") || name.contains("courier")
        }
        _ => false,
    });
    let family = families
        .iter()
        .find_map(|family| match family {
            FontFamily::Named(name) => Some(name.clone()),
            _ => None,
        })
        .unwrap_or_else(|| {
            match mono {
                true => "Courier New",
                false => "Helvetica",
            }
            .to_string()
        });
    let bold = font.weight() >= 600;
    let italic = font.style() != FontStyle::Normal;
    let style = |span: &usvg::TextSpan| {
        (
            span.font_size().get(),
            span.fill()
                .and_then(|fill| Reader::color(fill.paint(), fill.opacity().get())),
            span.font().weight() >= 600,
            span.font().style() != FontStyle::Normal,
        )
    };
    let first = style(span);
    let mixed = text
        .chunks()
        .iter()
        .flat_map(|chunk| chunk.spans())
        .any(|span| style(span) != first);
    if mixed || (target == Target::Excalidraw && (bold || italic)) {
        losses.text_styles += 1;
    }
    if target == Target::Excalidraw {
        losses.fonts += 1;
    }
    let align = match chunk.anchor() {
        TextAnchor::Start => Align::Left,
        TextAnchor::Middle => Align::Center,
        TextAnchor::End => Align::Right,
    };
    Some(Words {
        lines,
        size: span.font_size().get() as f64 * scale,
        color,
        family,
        mono,
        bold,
        italic,
        align,
    })
}

/// Legge una pagina per `target`.
fn read_page(
    drawing: &mut Drawing<'_>,
    page: &Page<'_>,
    target: Target,
    losses: &mut Losses,
) -> Result<Read, String> {
    let text = std::str::from_utf8(&page.text).map_err(|_| not_utf8())?;
    let scene = fub_scene::read(text).map_err(|error| unreadable(&error))?;
    if scene.truncated
        || (scene.items.len() <= 1 && {
            let counts = &scene.summary.counts;
            counts.strokes + counts.shapes + counts.texts + counts.images > 0
        })
    {
        return Err(format!(
            "the drawing is too large to become {} shapes",
            target.name()
        ));
    }
    let tree = drawing.tree(&page.text)?;
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..roxmltree::ParsingOptions::default()
    };
    let xml = roxmltree::Document::parse_with_options(text, options)
        .map_err(|error| format!("not a readable SVG drawing: {error}"))?;
    let view = view_transform(xml.root_element(), tree.size());
    let inv = view.invert().unwrap_or_default();
    let reader = Reader {
        inv,
        xml: xml
            .descendants()
            .filter_map(|node| node.attribute("id").map(|id| (id, node)))
            .collect(),
        target,
    };
    let source = Source::read(text).map_err(|error| unreadable(&error))?;
    let page_view = {
        let r = Rect::from_xywh(0.0, 0.0, tree.size().width(), tree.size().height());
        r.map(|r| bounds(&inv, r)).unwrap_or([0.0, 0.0, 0.0, 0.0])
    };
    let mut read = Read {
        shapes: Vec::new(),
        layers: Vec::new(),
        frames: Vec::new(),
        background: None,
        size: [page_view[2], page_view[3]],
    };
    if page.board.is_none() && matches!(page.scope, Scope::Drawing) {
        read.frames = source
            .boards()
            .into_iter()
            .map(|board| Frame {
                id: board.id,
                name: board.name,
                rect: board.rect,
            })
            .collect();
    }
    let mut contexts: HashMap<Vec<usize>, Context> = HashMap::new();
    contexts.insert(
        Vec::new(),
        Context {
            opacity: 1.0,
            ..Context::default()
        },
    );
    // Ciò che le immagini possono ancora occupare: il file intero si misura
    // alla fine, contro ciò che l'export tiene ancora.
    let mut room = drawing.room;
    for entry in &scene.items {
        let item = match entry {
            Item::Element(item) => item,
            Item::Foreign(foreign) => {
                let Some(path) = &foreign.parent_path else {
                    continue;
                };
                let Some(parent) = contexts
                    .get(path)
                    .filter(|context| !context.closed)
                    .cloned()
                else {
                    continue;
                };
                // Gli elementi estranei che si vedono escono come gli altri,
                // dal loro tag; ciò che non si vede o non ha un id resta
                // fuori, e si conta.
                let elements: Vec<roxmltree::Node<'_, '_>> = element_at(xml.root_element(), path)
                    .map(|container| container.children().filter(|n| n.is_element()).collect())
                    .unwrap_or_default();
                for at in foreign.elements[0]..foreign.elements[1] {
                    let element = elements.get(at);
                    let svg = element.filter(|e| e.tag_name().namespace() == Some(SVG_NS));
                    let id = svg.and_then(|e| e.attribute("id"));
                    let node = id.and_then(|id| tree.node_by_id(id));
                    let (Some(element), Some(id), Some(node)) = (svg, id, node) else {
                        losses.foreign += 1;
                        continue;
                    };
                    let facts = Facts {
                        role: role_of(element.tag_name().name()),
                        id,
                        arrow: None,
                        connector: None,
                        text_path: element
                            .descendants()
                            .any(|n| n.has_tag_name((SVG_NS, "textPath"))),
                        lines: None,
                    };
                    let Some(kind) =
                        object(&reader, &source, drawing, &facts, node, &mut room, losses)
                    else {
                        continue;
                    };
                    read.shapes.push(Shape {
                        id: id.to_string(),
                        layer: parent.layer,
                        groups: parent.groups.clone(),
                        locked: parent.locked,
                        link: parent.link.clone(),
                        opacity: parent.opacity,
                        kind,
                        label_of: None,
                        label: None,
                    });
                }
                continue;
            }
            Item::Root(_) => continue,
        };
        if item.path.is_empty() {
            continue;
        }
        let parent = contexts.get(&item.path[..item.path.len() - 1]).cloned();
        let Some(parent) = parent.filter(|parent| !parent.closed) else {
            contexts.insert(
                item.path.clone(),
                Context {
                    closed: true,
                    ..Context::default()
                },
            );
            continue;
        };
        let closed = Context {
            closed: true,
            ..Context::default()
        };
        match item.role {
            Role::Title | Role::Desc | Role::Defs | Role::Resource | Role::Symbol | Role::Board => {
                contexts.insert(item.path.clone(), closed);
                continue;
            }
            Role::Paper => {
                let paint = item
                    .id
                    .as_deref()
                    .and_then(|id| tree.node_by_id(id))
                    .and_then(|node| match node {
                        Node::Path(path) => path.fill(),
                        _ => None,
                    })
                    .and_then(|fill| Reader::color(fill.paint(), fill.opacity().get()));
                read.background = read.background.or(paint);
                contexts.insert(item.path.clone(), closed);
                continue;
            }
            Role::Layer => {
                if item.hidden {
                    losses.hidden += 1;
                    contexts.insert(item.path.clone(), closed);
                    continue;
                }
                let index = read.layers.len();
                read.layers.push(LayerOut {
                    id: item
                        .id
                        .clone()
                        .unwrap_or_else(|| format!("fub-layer-{index}")),
                    name: item
                        .layer
                        .as_ref()
                        .map(|layer| layer.name.clone())
                        .unwrap_or_default(),
                    locked: item.locked,
                });
                contexts.insert(
                    item.path.clone(),
                    Context {
                        layer: Some(index),
                        locked: item.locked,
                        ..parent
                    },
                );
                continue;
            }
            Role::Group | Role::Link if !item.hidden => {
                let node = item.id.as_deref().and_then(|id| tree.node_by_id(id));
                let effects = matches!(node, Some(Node::Group(group))
                    if !group.filters().is_empty() || group.mask().is_some() || group.clip_path().is_some());
                if !effects {
                    let opacity = match node {
                        Some(Node::Group(group)) => group.opacity().get() as f64,
                        _ => 1.0,
                    };
                    let mut context = parent.clone();
                    context.opacity *= opacity;
                    context.locked |= item.locked;
                    if item.role == Role::Group {
                        let id = item.id.clone().unwrap_or_else(|| {
                            let path: Vec<String> =
                                item.path.iter().map(usize::to_string).collect();
                            format!("fub-group-{}", path.join("-"))
                        });
                        context.groups.insert(0, id);
                    } else if let Some(href) = item.id.as_deref().and_then(|id| reader.href(id)) {
                        context.link = Some(href);
                    }
                    contexts.insert(item.path.clone(), context);
                    continue;
                }
            }
            _ => {}
        }
        // Un oggetto: ciò che contiene è suo.
        contexts.insert(item.path.clone(), closed);
        if item.hidden {
            losses.hidden += 1;
            continue;
        }
        let Some(id) = item.id.clone() else {
            losses.no_id += 1;
            continue;
        };
        let Some(node) = tree.node_by_id(&id) else {
            losses.empty += 1;
            continue;
        };
        let facts = Facts {
            role: item.role,
            id: &id,
            arrow: item.arrow,
            connector: item.connector.as_ref(),
            text_path: item.text_path.is_some(),
            lines: item.lines.clone(),
        };
        let Some(kind) = object(&reader, &source, drawing, &facts, node, &mut room, losses) else {
            continue;
        };
        read.shapes.push(Shape {
            id,
            layer: parent.layer,
            groups: parent.groups.clone(),
            locked: parent.locked || item.locked,
            link: parent.link.clone(),
            opacity: parent.opacity,
            kind,
            label_of: item
                .inside
                .clone()
                .or_else(|| item.along.as_ref().map(|along| along.id.clone())),
            label: None,
        });
    }
    attach_labels(&mut read.shapes);
    Ok(read)
}

/// La forma di un oggetto o, se non ne ha una, la sua immagine; `None` per
/// un oggetto che non disegna niente, che si conta.
fn object(
    reader: &Reader<'_>,
    source: &Source<'_>,
    drawing: &mut Drawing<'_>,
    facts: &Facts<'_>,
    node: &Node,
    room: &mut usize,
    losses: &mut Losses,
) -> Option<Kind> {
    if let Some(kind) = reader.kind(facts, node, losses) {
        return Some(kind);
    }
    match picture(source, drawing, facts.id, node, &reader.inv, room) {
        Some(kind) => {
            losses.pictures += 1;
            Some(kind)
        }
        None => {
            losses.empty += 1;
            None
        }
    }
}

/// L'elemento a `path`, gli indici dei figli elemento dalla radice.
fn element_at<'a, 'i>(
    root: roxmltree::Node<'a, 'i>,
    path: &[usize],
) -> Option<roxmltree::Node<'a, 'i>> {
    path.iter().try_fold(root, |node, &at| {
        node.children().filter(|n| n.is_element()).nth(at)
    })
}

/// L'oggetto come immagine: la derivazione della selezione del solo
/// oggetto, ripulita, con le immagini del vault dentro finché ci stanno.
fn picture(
    source: &Source<'_>,
    drawing: &mut Drawing<'_>,
    id: &str,
    node: &Node,
    inv: &Transform,
    room: &mut usize,
) -> Option<Kind> {
    let seen = match node {
        Node::Group(group) => group.abs_layer_bounding_box().to_rect(),
        node => node.abs_stroke_bounding_box(),
    };
    let [x, y, w, h] = bounds(inv, seen);
    let rect = [
        x - PICTURE_MARGIN,
        y - PICTURE_MARGIN,
        w + 2.0 * PICTURE_MARGIN,
        h + 2.0 * PICTURE_MARGIN,
    ];
    let scope = Scope::Selection {
        ids: vec![id.to_string()],
        rect,
    };
    let derived = source.derive(&scope, Background::None).ok()?;
    let cleaned = clean(&derived, &scope).ok()?;
    let embedded = embed_images(&cleaned, |href| drawing.embed(href, room)).ok()?;
    let uri = format!(
        "data:image/svg+xml;base64,{}",
        BASE64.encode(embedded.as_bytes())
    );
    *room = room.saturating_sub(uri.len());
    Some(Kind::Picture {
        at: Placed {
            x: rect[0],
            y: rect[1],
            w: rect[2],
            h: rect[3],
            angle: 0.0,
        },
        uri,
    })
}

/// Un testo che è l'etichetta di una forma o di una linea della pagina
/// diventa l'etichetta di quella: in Excalidraw il testo legato, in draw.io
/// il valore della cella.
fn attach_labels(shapes: &mut Vec<Shape>) {
    let mut taken: Vec<usize> = Vec::new();
    for at in 0..shapes.len() {
        let (Some(target), Kind::Text { at: placed, words }) =
            (shapes[at].label_of.clone(), &shapes[at].kind)
        else {
            continue;
        };
        let label = Label {
            id: shapes[at].id.clone(),
            words: words.clone(),
            at: *placed,
        };
        let host = shapes.iter().position(|shape| {
            shape.id == target
                && shape.label.is_none()
                && matches!(shape.kind, Kind::Box { .. } | Kind::Line { .. })
        });
        if let Some(host) = host {
            shapes[host].label = Some(label);
            taken.push(at);
        }
    }
    for at in taken.into_iter().rev() {
        shapes.remove(at);
    }
}

/// L'oggetto a cui si aggancia un capo che nomina `id`: l'oggetto stesso, o
/// per un gruppo la sua forma con l'etichetta, o la prima.
fn bound_to<'s>(shapes: &'s [Shape], id: &str) -> Option<&'s Shape> {
    let bindable = |shape: &&Shape| !matches!(shape.kind, Kind::Line { .. });
    shapes
        .iter()
        .filter(bindable)
        .find(|shape| shape.id == id)
        .or_else(|| {
            let members = || {
                shapes
                    .iter()
                    .filter(bindable)
                    .filter(|shape| shape.groups.iter().any(|group| group == id))
            };
            members()
                .find(|shape| shape.label.is_some())
                .or_else(|| members().next())
        })
}

/// Un numero dato dall'id: i semi di Excalidraw, gli stessi a ogni export.
fn seed(id: &str, salt: u32) -> u32 {
    let mut hash: u32 = 0x811c_9dc5 ^ salt;
    for byte in id.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash & 0x7fff_ffff
}

/// Un numero per il file, a due decimali, senza `-0`.
fn num(n: f64) -> f64 {
    let rounded = (n * 100.0).round() / 100.0;
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

// ---------------------------------------------------------------------------
// Excalidraw
// ---------------------------------------------------------------------------

fn tip_name(tip: Tip) -> &'static str {
    match tip {
        Tip::Triangle => "triangle",
        Tip::Vee | Tip::Other => "arrow",
        Tip::Circle => "circle",
        Tip::Square | Tip::Bar => "bar",
        Tip::Diamond => "diamond",
    }
}

fn family_number(words: &Words) -> u8 {
    match words.mono {
        true => 3,
        false => 2,
    }
}

fn align_name(align: Align) -> &'static str {
    match align {
        Align::Left => "left",
        Align::Center => "center",
        Align::Right => "right",
    }
}

/// Le proprietà che ogni elemento di Excalidraw ha.
fn element(
    id: &str,
    kind: &str,
    at: &Placed,
    shape: &Shape,
    frame: Option<&str>,
) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("id".into(), json!(id));
    map.insert("type".into(), json!(kind));
    map.insert("x".into(), json!(num(at.x)));
    map.insert("y".into(), json!(num(at.y)));
    map.insert("width".into(), json!(num(at.w)));
    map.insert("height".into(), json!(num(at.h)));
    map.insert("angle".into(), json!((at.angle * 1e6).round() / 1e6));
    map.insert("strokeColor".into(), json!("transparent"));
    map.insert("backgroundColor".into(), json!("transparent"));
    map.insert("fillStyle".into(), json!("solid"));
    map.insert("strokeWidth".into(), json!(1));
    map.insert("strokeStyle".into(), json!("solid"));
    map.insert("roughness".into(), json!(0));
    map.insert("opacity".into(), json!((shape.opacity * 100.0).round()));
    map.insert("groupIds".into(), json!(shape.groups));
    map.insert("frameId".into(), json!(frame));
    map.insert("roundness".into(), Value::Null);
    map.insert("seed".into(), json!(seed(id, 0)));
    map.insert("version".into(), json!(1));
    map.insert("versionNonce".into(), json!(seed(id, 1)));
    map.insert("isDeleted".into(), json!(false));
    map.insert("boundElements".into(), Value::Null);
    map.insert("updated".into(), json!(1));
    map.insert("link".into(), json!(shape.link));
    map.insert("locked".into(), json!(shape.locked));
    map
}

fn put_look(map: &mut Map<String, Value>, look: &Look) {
    if let Some(stroke) = look.stroke {
        map.insert("strokeColor".into(), json!(stroke.css()));
        map.insert("strokeWidth".into(), json!(num(look.width.max(0.5))));
    }
    if let Some(fill) = look.fill {
        map.insert("backgroundColor".into(), json!(fill.css()));
    }
    if let Some(dash) = &look.dash {
        let dotted = dash.first().is_some_and(|first| *first <= look.width * 1.5);
        map.insert(
            "strokeStyle".into(),
            json!(if dotted { "dotted" } else { "dashed" }),
        );
    }
}

fn put_words(map: &mut Map<String, Value>, words: &Words, container: Option<&str>) {
    let text = words.lines.join("\n");
    map.insert("strokeColor".into(), json!(words.color.css()));
    map.insert("text".into(), json!(text));
    map.insert("originalText".into(), json!(text));
    map.insert("fontSize".into(), json!(num(words.size)));
    map.insert("fontFamily".into(), json!(family_number(words)));
    map.insert("textAlign".into(), json!(align_name(words.align)));
    map.insert(
        "verticalAlign".into(),
        json!(if container.is_some() { "middle" } else { "top" }),
    );
    map.insert("containerId".into(), json!(container));
    map.insert("autoResize".into(), json!(true));
    map.insert("lineHeight".into(), json!(1.25));
}

/// Il file di Excalidraw di una pagina.
fn excalidraw(read: &Read, losses: &mut Losses) -> Value {
    if read.layers.len() > 1 {
        losses.layers = read.layers.len();
    }
    let frame_of = |center: [f64; 2]| {
        read.frames
            .iter()
            .find(|frame| {
                let [x, y, w, h] = frame.rect;
                center[0] >= x && center[0] <= x + w && center[1] >= y && center[1] <= y + h
            })
            .map(|frame| frame.id.as_str())
    };
    // Chi è legato a chi: le etichette e le frecce agganciate.
    let mut bound: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut bindings: HashMap<(String, usize), String> = HashMap::new();
    for shape in &read.shapes {
        if let Some(label) = &shape.label {
            bound
                .entry(shape.id.clone())
                .or_default()
                .push(json!({ "type": "text", "id": label.id }));
        }
        if let Kind::Line { ends, .. } = &shape.kind {
            for (at, end) in ends.iter().enumerate() {
                let Some(target) = end.as_ref().and_then(|end| bound_to(&read.shapes, &end.id))
                else {
                    continue;
                };
                bound
                    .entry(target.id.clone())
                    .or_default()
                    .push(json!({ "type": "arrow", "id": shape.id }));
                bindings.insert((shape.id.clone(), at), target.id.clone());
            }
        }
    }
    let mut elements: Vec<Value> = Vec::new();
    let mut files = Map::new();
    for frame in &read.frames {
        let [x, y, w, h] = frame.rect;
        let at = Placed {
            x,
            y,
            w,
            h,
            angle: 0.0,
        };
        let holder = Shape {
            id: frame.id.clone(),
            layer: None,
            groups: Vec::new(),
            locked: false,
            link: None,
            opacity: 1.0,
            kind: Kind::Picture {
                at,
                uri: String::new(),
            },
            label_of: None,
            label: None,
        };
        let mut map = element(&frame.id, "frame", &at, &holder, None);
        map.insert("name".into(), json!(frame.name));
        map.insert("strokeColor".into(), json!("#bbbbbb"));
        elements.push(Value::Object(map));
    }
    for shape in &read.shapes {
        let mut shape = shape.clone();
        if shape.layer.is_some_and(|layer| read.layers[layer].locked) {
            shape.locked = true;
        }
        let bound_elements = bound.get(&shape.id).cloned();
        if let Kind::Box { look, .. } | Kind::Line { look, .. } = &shape.kind {
            losses.dashes += look.dash.is_some() as usize;
        }
        let mut map = match &shape.kind {
            Kind::Box {
                shape: form,
                at,
                look,
            } => {
                let kind = match form {
                    BoxShape::Rect { .. } => "rectangle",
                    BoxShape::Ellipse => "ellipse",
                    BoxShape::Diamond => "diamond",
                };
                let mut map = element(&shape.id, kind, at, &shape, frame_of(at.center()));
                put_look(&mut map, look);
                if let BoxShape::Rect { round } = form {
                    if *round > 0.0 {
                        map.insert(
                            "roundness".into(),
                            json!({ "type": 3, "value": num(*round) }),
                        );
                    }
                }
                map
            }
            Kind::Line {
                points,
                closed,
                curved,
                look,
                tips,
                arrow,
                ..
            } => {
                let first = points[0];
                let min_x = points.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
                let min_y = points.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
                let max_x = points
                    .iter()
                    .map(|p| p[0])
                    .fold(f64::NEG_INFINITY, f64::max);
                let max_y = points
                    .iter()
                    .map(|p| p[1])
                    .fold(f64::NEG_INFINITY, f64::max);
                let at = Placed {
                    x: first[0],
                    y: first[1],
                    w: max_x - min_x,
                    h: max_y - min_y,
                    angle: 0.0,
                };
                let center = [(min_x + max_x) / 2.0, (min_y + max_y) / 2.0];
                let kind = if *arrow { "arrow" } else { "line" };
                let mut map = element(&shape.id, kind, &at, &shape, frame_of(center));
                put_look(&mut map, look);
                let mut relative: Vec<Value> = points
                    .iter()
                    .map(|p| json!([num(p[0] - first[0]), num(p[1] - first[1])]))
                    .collect();
                if *closed && !near(points[0], points[points.len() - 1]) {
                    relative.push(json!([0, 0]));
                }
                map.insert("points".into(), Value::Array(relative));
                map.insert("lastCommittedPoint".into(), Value::Null);
                map.insert("startArrowhead".into(), json!(tips[0].map(tip_name)));
                map.insert("endArrowhead".into(), json!(tips[1].map(tip_name)));
                for (at, key) in ["startBinding", "endBinding"].iter().enumerate() {
                    let binding = bindings
                        .get(&(shape.id.clone(), at))
                        .map(|target| json!({ "elementId": target, "focus": 0, "gap": 1 }));
                    map.insert((*key).into(), json!(binding));
                }
                if *curved {
                    map.insert("roundness".into(), json!({ "type": 2 }));
                }
                if *closed {
                    map.insert("polygon".into(), json!(true));
                }
                if *arrow {
                    map.insert("elbowed".into(), json!(false));
                }
                map
            }
            Kind::Text { at, words } => {
                let mut map = element(&shape.id, "text", at, &shape, frame_of(at.center()));
                put_words(&mut map, words, None);
                map
            }
            Kind::Picture { at, uri } => {
                let mut map = element(&shape.id, "image", at, &shape, frame_of(at.center()));
                let file = format!("{:08x}{:08x}", seed(uri, 2), seed(uri, 3));
                let mime = uri
                    .strip_prefix("data:")
                    .and_then(|rest| rest.split([';', ',']).next())
                    .unwrap_or("image/png");
                files.insert(
                    file.clone(),
                    json!({ "mimeType": mime, "id": file, "dataURL": uri, "created": 1 }),
                );
                map.insert("fileId".into(), json!(file));
                map.insert("status".into(), json!("saved"));
                map.insert("scale".into(), json!([1, 1]));
                map.insert("crop".into(), Value::Null);
                map
            }
        };
        if let Some(bound_elements) = bound_elements {
            map.insert("boundElements".into(), Value::Array(bound_elements));
        }
        let frame = map.get("frameId").cloned().unwrap_or(Value::Null);
        elements.push(Value::Object(map));
        if let Some(label) = &shape.label {
            let mut text = element(&label.id, "text", &label.at, &shape, None);
            text.insert("frameId".into(), frame);
            put_words(&mut text, &label.words, Some(&shape.id));
            elements.push(Value::Object(text));
        }
    }
    let background = read
        .background
        .map_or_else(|| "transparent".to_string(), |color| color.css());
    json!({
        "type": "excalidraw",
        "version": 2,
        "source": "https://fubeo.github.io",
        "elements": elements,
        "appState": { "viewBackgroundColor": background, "gridSize": null },
        "files": files,
    })
}

// ---------------------------------------------------------------------------
// draw.io
// ---------------------------------------------------------------------------

/// Un valore per un attributo XML: la tabella di [`fub_abi::html::escape`],
/// e gli a capo e le tabulazioni come riferimenti numerici, perché un
/// attributo li normalizzerebbe in spazi. Gli altri caratteri di controllo,
/// che XML 1.0 non ammette, cadono.
fn xml_attr(value: &str) -> String {
    let clean: String = value
        .chars()
        .filter(|c| (*c as u32) >= 0x20 || matches!(c, '\n' | '\r' | '\t'))
        .collect();
    fub_abi::html::escape(&clean)
        .replace('\n', "&#10;")
        .replace('\r', "&#13;")
        .replace('\t', "&#9;")
}

/// Le righe come HTML di draw.io: `html=1` le legge così.
fn html_lines(lines: &[String]) -> String {
    lines
        .iter()
        .map(|line| fub_abi::html::escape(line))
        .collect::<Vec<_>>()
        .join("<br>")
}

/// Il nome di una punta in draw.io, e se è piena.
fn drawio_tip(tip: Option<Tip>) -> (&'static str, bool) {
    match tip {
        None => ("none", false),
        Some(Tip::Triangle) => ("block", true),
        Some(Tip::Vee | Tip::Other) => ("open", false),
        Some(Tip::Circle) => ("oval", true),
        Some(Tip::Square) => ("box", true),
        Some(Tip::Diamond) => ("diamond", true),
        Some(Tip::Bar) => ("dash", false),
    }
}

fn style_look(style: &mut String, look: &Look) {
    match look.fill {
        Some(fill) => {
            let _ = write!(style, "fillColor={};", fill.hex());
            if fill.alpha < 1.0 {
                let _ = write!(style, "fillOpacity={};", (fill.alpha * 100.0).round());
            }
        }
        None => style.push_str("fillColor=none;"),
    }
    match look.stroke {
        Some(stroke) => {
            let _ = write!(
                style,
                "strokeColor={};strokeWidth={};",
                stroke.hex(),
                num(look.width)
            );
            if stroke.alpha < 1.0 {
                let _ = write!(style, "strokeOpacity={};", (stroke.alpha * 100.0).round());
            }
        }
        None => style.push_str("strokeColor=none;"),
    }
    if let Some(dash) = &look.dash {
        let width = look.width.max(0.01);
        let pattern: Vec<String> = dash.iter().map(|n| num(n / width).to_string()).collect();
        let _ = write!(style, "dashed=1;dashPattern={};", pattern.join(" "));
    }
}

fn style_words(style: &mut String, words: &Words) {
    let font_style = words.bold as u8 | (words.italic as u8) << 1;
    let _ = write!(
        style,
        "fontSize={};fontColor={};fontFamily={};fontStyle={};align={};",
        num(words.size),
        words.color.hex(),
        words.family.replace(';', ""),
        font_style,
        align_name(words.align),
    );
}

fn style_common(style: &mut String, shape: &Shape, angle: f64) {
    if shape.opacity < 1.0 {
        let _ = write!(style, "opacity={};", (shape.opacity * 100.0).round());
    }
    let degrees = num(angle.to_degrees());
    if degrees != 0.0 {
        let _ = write!(style, "rotation={degrees};");
    }
    if shape.locked {
        style.push_str("movable=0;resizable=0;rotatable=0;deletable=0;editable=0;locked=1;");
    }
}

/// Una cella, dentro un `UserObject` se ha un collegamento.
fn cell(out: &mut String, shape: &Shape, value: &str, attrs: &str, geometry: &str) {
    match &shape.link {
        Some(link) => {
            let _ = write!(
                out,
                "<UserObject label=\"{}\" link=\"{}\" id=\"{}\"><mxCell {attrs}>{geometry}</mxCell></UserObject>",
                xml_attr(value),
                xml_attr(link),
                xml_attr(&shape.id),
            );
        }
        None => {
            let _ = write!(
                out,
                "<mxCell id=\"{}\" value=\"{}\" {attrs}>{geometry}</mxCell>",
                xml_attr(&shape.id),
                xml_attr(value),
            );
        }
    }
}

fn geometry(at: &Placed) -> String {
    format!(
        "<mxGeometry x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" as=\"geometry\"/>",
        num(at.x),
        num(at.y),
        num(at.w),
        num(at.h)
    )
}

/// Una pagina di draw.io, `<diagram>` compreso.
fn drawio_page(read: &Read, name: &str, number: usize, losses: &mut Losses, out: &mut String) {
    for shape in &read.shapes {
        losses.groups.extend(shape.groups.iter().cloned());
    }
    let background = read.background.map_or("none".to_string(), |c| c.hex());
    let _ = write!(
        out,
        "<diagram id=\"page-{number}\" name=\"{}\"><mxGraphModel dx=\"0\" dy=\"0\" grid=\"0\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"{}\" pageHeight=\"{}\" background=\"{background}\" math=\"0\" shadow=\"0\"><root><mxCell id=\"0\"/>",
        xml_attr(name),
        num(read.size[0]),
        num(read.size[1]),
    );
    let taken: BTreeSet<&str> = read.shapes.iter().map(|shape| shape.id.as_str()).collect();
    let mut loose = "1".to_string();
    while taken.contains(loose.as_str()) || read.layers.iter().any(|layer| layer.id == loose) {
        loose.push('_');
    }
    if read.layers.is_empty() || read.shapes.iter().any(|shape| shape.layer.is_none()) {
        let _ = write!(out, "<mxCell id=\"{}\" parent=\"0\"/>", xml_attr(&loose));
    }
    for layer in &read.layers {
        let style = if layer.locked {
            " style=\"locked=1;\""
        } else {
            ""
        };
        let _ = write!(
            out,
            "<mxCell id=\"{}\" value=\"{}\"{style} parent=\"0\"/>",
            xml_attr(&layer.id),
            xml_attr(&layer.name),
        );
    }
    for shape in &read.shapes {
        let parent = shape
            .layer
            .map_or(loose.as_str(), |layer| read.layers[layer].id.as_str());
        let parent = xml_attr(parent);
        let label = shape
            .label
            .as_ref()
            .map(|label| html_lines(&label.words.lines));
        match &shape.kind {
            Kind::Box {
                shape: form,
                at,
                look,
            } => {
                let mut style = match form {
                    BoxShape::Rect { round } if *round > 0.0 => {
                        format!("rounded=1;absoluteArcSize=1;arcSize={};", num(round * 2.0))
                    }
                    BoxShape::Rect { .. } => "rounded=0;".to_string(),
                    BoxShape::Ellipse => "ellipse;".to_string(),
                    BoxShape::Diamond => "rhombus;".to_string(),
                };
                style.push_str("whiteSpace=wrap;html=1;");
                style_look(&mut style, look);
                if let Some(label) = &shape.label {
                    style_words(&mut style, &label.words);
                }
                style_common(&mut style, shape, at.angle);
                cell(
                    out,
                    shape,
                    label.as_deref().unwrap_or_default(),
                    &format!(
                        "style=\"{}\" vertex=\"1\" parent=\"{parent}\"",
                        xml_attr(&style)
                    ),
                    &geometry(at),
                );
            }
            Kind::Text { at, words } => {
                let mut style =
                    "text;html=1;whiteSpace=nowrap;verticalAlign=top;spacing=0;overflow=visible;"
                        .to_string();
                style_words(&mut style, words);
                style_common(&mut style, shape, at.angle);
                cell(
                    out,
                    shape,
                    &html_lines(&words.lines),
                    &format!(
                        "style=\"{}\" vertex=\"1\" parent=\"{parent}\"",
                        xml_attr(&style)
                    ),
                    &geometry(at),
                );
            }
            Kind::Picture { at, uri } => {
                // Il `;` separa le voci dello stile: draw.io scrive il
                // `data:` senza `;base64`.
                let image = uri.replacen(";base64,", ",", 1);
                let mut style = format!("shape=image;html=1;imageAspect=0;image={image};");
                style_common(&mut style, shape, at.angle);
                cell(
                    out,
                    shape,
                    "",
                    &format!(
                        "style=\"{}\" vertex=\"1\" parent=\"{parent}\"",
                        xml_attr(&style)
                    ),
                    &geometry(at),
                );
            }
            Kind::Line {
                points,
                curved,
                look,
                tips,
                ends,
                ..
            } => {
                let (start, start_fill) = drawio_tip(tips[0]);
                let (end, end_fill) = drawio_tip(tips[1]);
                let mut style = format!(
                    "html=1;rounded=0;startArrow={start};startFill={};endArrow={end};endFill={};",
                    start_fill as u8, end_fill as u8
                );
                if *curved {
                    style.push_str("curved=1;");
                }
                style_look(&mut style, look);
                if let Some(label) = &shape.label {
                    style_words(&mut style, &label.words);
                }
                style_common(&mut style, shape, 0.0);
                let mut attrs = String::new();
                for (at, (key, x, y)) in
                    [("source", "exitX", "exitY"), ("target", "entryX", "entryY")]
                        .iter()
                        .enumerate()
                {
                    let Some(end) = &ends[at] else { continue };
                    let Some(other) = bound_to(&read.shapes, &end.id) else {
                        continue;
                    };
                    let _ = write!(attrs, " {key}=\"{}\"", xml_attr(&other.id));
                    if let Some([ax, ay]) = end.anchor {
                        let _ = write!(style, "{x}={ax};{y}={ay};");
                    }
                }
                let first = points[0];
                let last = points[points.len() - 1];
                let mut geometry = format!(
                    "<mxGeometry relative=\"1\" as=\"geometry\"><mxPoint x=\"{}\" y=\"{}\" as=\"sourcePoint\"/><mxPoint x=\"{}\" y=\"{}\" as=\"targetPoint\"/>",
                    num(first[0]),
                    num(first[1]),
                    num(last[0]),
                    num(last[1])
                );
                if points.len() > 2 {
                    geometry.push_str("<Array as=\"points\">");
                    for p in &points[1..points.len() - 1] {
                        let _ = write!(
                            geometry,
                            "<mxPoint x=\"{}\" y=\"{}\"/>",
                            num(p[0]),
                            num(p[1])
                        );
                    }
                    geometry.push_str("</Array>");
                }
                geometry.push_str("</mxGeometry>");
                cell(
                    out,
                    shape,
                    label.as_deref().unwrap_or_default(),
                    &format!(
                        "style=\"{}\" edge=\"1\" parent=\"{parent}\"{attrs}",
                        xml_attr(&style)
                    ),
                    &geometry,
                );
            }
        }
    }
    out.push_str("</root></mxGraphModel></diagram>");
}

// ---------------------------------------------------------------------------
// La scrittura
// ---------------------------------------------------------------------------

/// Scrive `file` per `target`: Excalidraw una pagina, draw.io una pagina per
/// pagina del file.
pub(super) fn write(
    target: Target,
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let mut losses = Losses::default();
    let mut reads = Vec::with_capacity(file.pages.len());
    for page in &file.pages {
        match read_page(drawing, page, target, &mut losses) {
            Ok(read) => reads.push(read),
            Err(reason) => return Ok(Outcome::Failed(reason)),
        }
    }
    let (bytes, media_type) = match target {
        Target::Excalidraw => {
            let value = excalidraw(&reads[0], &mut losses);
            let bytes = match serde_json::to_vec_pretty(&value) {
                Ok(bytes) => bytes,
                Err(error) => return Ok(Outcome::Failed(error.to_string())),
            };
            (bytes, "application/vnd.excalidraw+json")
        }
        Target::Drawio => {
            let mut text = String::from("<mxfile host=\"Fub\" agent=\"Fub\">");
            for (number, (read, page)) in reads.iter().zip(&file.pages).enumerate() {
                if page.board.is_none() && !read.frames.is_empty() {
                    losses.boards += read.frames.len();
                }
                let name = page.board.clone().unwrap_or_else(|| drawing.title.clone());
                drawio_page(read, &name, number + 1, &mut losses, &mut text);
            }
            text.push_str("</mxfile>\n");
            (text.into_bytes(), "application/vnd.jgraph.mxfile")
        }
    };
    if bytes.len() > drawing.room {
        return Ok(Outcome::Failed(format!(
            "the {} file would be larger than the export can hold",
            target.name()
        )));
    }
    let handle = out.open_artifact(&file.path, media_type)?;
    for piece in bytes.chunks(CHUNK) {
        out.write_artifact(handle, piece)?;
    }
    report.artifacts.push(out.close_artifact(handle)?);
    drawing.room = drawing.room.saturating_sub(bytes.len());
    let about = file.about();
    for note in losses.notes(target) {
        report
            .log
            .push(TransferNote::warning(format!("{about}{note}")).about(drawing.doc.to_string()));
    }
    Ok(Outcome::Done)
}
