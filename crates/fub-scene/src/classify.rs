//! La regola di classificazione di §4: che cosa della scena è modificabile e
//! che cosa è estraneo.
//!
//! Si parte dalla radice, che non si classifica, e si scende solo dentro i
//! contenitori modificabili (`g` e `a`), dove ogni figlio si giudica da sé. Un
//! elemento di qualunque altro tag è un'unità con i suoi figli: o è tutto
//! modificabile o è tutto estraneo. I nodi estranei contigui, con gli spazi fra
//! loro, diventano un solo blocco, che la superficie disegna come uno strato
//! inerte; gli spazi fra un elemento modificabile e un blocco non sono di
//! nessuno.
//!
//! La visita usa una pila esplicita, non la ricorsione: un SVG con centomila
//! gruppi annidati è un file valido, e non deve esaurire lo stack.
//!
//! Le risorse (§15) si leggono in due passi: prima l'indice delle risorse
//! modificabili nelle `defs` della radice, poi la visita, in cui un
//! riferimento vale se porta a una risorsa dell'indice del tipo giusto. Così
//! chi usa una sfumatura scritta dopo di lui si legge come chi la usa prima.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::analysis::{Context, Tally};
use crate::brush::{Brush, BrushError};
use crate::diagnostics::{Code, Diagnostic};
use crate::geometry::parse_path;
use crate::ink::{Ink, InkError};
use crate::parametric::{read_polygonal, Polygonal, PolygonalShape};
use crate::text::{Lines, Span, Utf16Map};
use crate::values::{
    angle, dasharray, fraction, href, is_wsp, keyword, length, letter_spacing,
    non_negative_length, number, number_list, one_or_two, opacity, paint, paint_reference,
    points, preserve_aspect_ratio, reference, text_decoration, transform, trim, view_box, Href,
    Paint,
};
use crate::varwidth::{read_var_width, VarWidth};
use crate::xml::{Document, Element, Kind, NodeId, NS_FUB, NS_NONE, NS_SVG, NS_XLINK};
use crate::MAX_DEPTH;

/// Che cosa rappresenta un elemento modificabile.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Un `title` fuori da un'unità: della radice, di un livello, di un gruppo.
    Title,
    /// Un `desc` fuori da un'unità.
    Desc,
    /// La carta: il `rect` figlio della radice con `fub:role="paper"`.
    Paper,
    /// Un `g` figlio della radice con `fub:layer`.
    Layer,
    /// Ogni altro `g`.
    Group,
    /// Un `a`.
    Link,
    /// Un `path` con `fub:tool` `pen` o `highlighter` (§5).
    Stroke,
    /// Un `path` con `fub:shape="arrow"` e un `fub:geom` di quattro numeri (§6).
    Arrow,
    /// Un `path` con `fub:shape="polygon"` e un `fub:geom` che si legge: il
    /// poligono regolare sintetico (§6). `Polygon` è l'elemento `polygon`.
    Ngon,
    /// Un `path` con `fub:shape="star"` e un `fub:geom` che si legge (§6).
    Star,
    /// Un `path` con `fub:shape="width"` e un `fub:geom` che si legge: il
    /// contorno a spessore variabile (§6).
    Width,
    /// Ogni altro `path`.
    Path,
    Rect,
    Ellipse,
    Circle,
    Line,
    Polyline,
    Polygon,
    Text,
    Image,
    /// Una `defs` della radice: tiene le risorse.
    Defs,
    /// Una risorsa modificabile in una `defs` della radice (§15).
    Resource,
}

impl Role {
    /// Vero per i ruoli i cui figli si classificano uno per uno.
    pub fn is_container(self) -> bool {
        matches!(self, Role::Layer | Role::Group | Role::Link | Role::Defs)
    }
}

/// Come vive una risorsa, da `fub:role` (§15): `private` è di un oggetto e
/// duplicarlo la copia, `shared` è di chi usa la stessa cosa; tutte e due se
/// ne vanno col loro ultimo riferimento. Senza, la risorsa resta.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    Private,
    Shared,
}

/// Che cosa è una risorsa per chi la usa (§15): `fill` e `stroke` usano
/// sfumature e motivi, `marker-*` i marcatori, `clip-path`, `mask` e
/// `filter` ritagli, maschere e filtri.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum ResourceKind {
    Gradient,
    Pattern,
    Marker,
    Clip,
    Mask,
    Filter,
}

/// Il tipo della risorsa modificabile che porta un id, o `None` se nessuna
/// risorsa modificabile lo porta.
type Resolve<'r> = &'r dyn Fn(&str) -> Option<ResourceKind>;

/// Un documento senza risorse.
fn no_resources(_: &str) -> Option<ResourceKind> {
    None
}

/// Dove sta un elemento: figlio della radice, di una `defs` della radice, o
/// di un altro contenitore modificabile.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Place {
    Root,
    Defs,
    Inside,
}

/// Lo strumento di un tratto.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Pen,
    Highlighter,
}

/// I tag d'apertura e di chiusura di un contenitore. `close` manca quando il
/// contenitore è autochiuso (`<g/>`): allora `open` è l'elemento intero.
#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
pub struct Tags {
    pub open: Span,
    pub close: Option<Span>,
}

/// Il nome e lo stato di un livello (§3).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Layer {
    pub name: String,
    /// `fub:locked="true"`.
    pub locked: bool,
    /// `display="none"`.
    pub hidden: bool,
}

/// Un tratto a mano libera.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Stroke {
    pub tool: Tool,
    /// Vero se `fub:ink` e `fub:brush` si leggono e l'inchiostro non ha
    /// canali sconosciuti: la superficie può ricalcolare `d`. Altrimenti il
    /// tratto si sposta, si trasforma, si ricolora e si elimina, e `d` resta
    /// com'è (S004, S010).
    pub redrawable: bool,
    /// I campioni di `fub:ink`, se si legge.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<usize>,
    /// La durata in millisecondi, se `fub:ink` si legge e ha il canale `t`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
}

/// La radice `<svg>`: è il documento, e non si classifica.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RootItem {
    #[serde(flatten)]
    pub span: Span,
    pub tags: Tags,
}

/// Un elemento modificabile.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementItem {
    /// Gli indici dei figli elemento dalla radice: è il modo in cui le
    /// operazioni della superficie indicano il loro bersaglio. La radice è
    /// `[]`.
    pub path: Vec<usize>,
    pub tag: &'static str,
    pub role: Role,
    pub id: Option<String>,
    #[serde(flatten)]
    pub span: Span,
    /// Il rientro della riga su cui l'elemento comincia.
    pub indent: String,
    /// I tag di livelli, gruppi e collegamenti.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Tags>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer: Option<Layer>,
    /// `fub:locked="true"` su un livello, un gruppo, un collegamento o una
    /// forma (§3): non si sceglie sul foglio, e ciò che contiene non cambia.
    /// Su un livello ripete `layer`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub locked: bool,
    /// `display="none"` su un livello, un gruppo, un collegamento o una
    /// forma: non si vede. Su un livello ripete `layer`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    /// `x1 y1 x2 y2` di una freccia.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrow: Option<[f64; 4]>,
    /// La geometria di un poligono regolare o di una stella: `fub:geom` letto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub polygonal: Option<Polygonal>,
    /// La geometria di un contorno a spessore variabile: `fub:geom` letto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub varwidth: Option<VarWidth>,
    /// Il testo del primo `title` figlio di un livello o di un oggetto, coi
    /// riferimenti risolti e gli spazi com'erano: il nome che qualcuno gli ha
    /// dato.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Il testo di un `title` o di un `desc`, coi riferimenti risolti e gli
    /// spazi com'erano: è ciò che l'operazione `meta` sostituisce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Le righe di un `text`, una per `tspan` coi suoi pezzi, coi riferimenti
    /// risolti e gli spazi com'erano: è il testo che l'operazione `text`
    /// sostituisce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<String>>,
    /// Il ciclo di vita di una risorsa, se `fub:role` lo dice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<Lifecycle>,
}

/// Una sequenza contigua di nodi estranei (§8).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignItem {
    /// Il percorso del contenitore; `None` per il prologo e l'epilogo del
    /// documento, fuori dalla radice.
    pub parent_path: Option<Vec<usize>>,
    #[serde(flatten)]
    pub span: Span,
    /// Gli indici `[da, a)` dei figli elemento del contenitore che il blocco
    /// comprende: un elemento estraneo senza id si indirizza con
    /// `parent_path` più il suo indice. Un blocco senza elementi ha `da = a`,
    /// l'indice del primo elemento che lo segue; nel documento la radice è
    /// l'elemento 0.
    pub elements: [usize; 2],
    pub indent: String,
}

/// Una voce della scena, in ordine di documento.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Root(RootItem),
    Element(Box<ElementItem>),
    Foreign(ForeignItem),
}

/// I tag di §4.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Tag {
    Title,
    Desc,
    G,
    A,
    Path,
    Rect,
    Ellipse,
    Circle,
    Line,
    Polyline,
    Polygon,
    Text,
    Tspan,
    Image,
    Defs,
    LinearGradient,
    RadialGradient,
    Pattern,
    Marker,
    ClipPath,
    Mask,
    Filter,
}

impl Tag {
    fn of(element: &Element<'_>) -> Option<Tag> {
        if element.ns != NS_SVG {
            return None;
        }
        Some(match element.local {
            "title" => Tag::Title,
            "desc" => Tag::Desc,
            "g" => Tag::G,
            "a" => Tag::A,
            "path" => Tag::Path,
            "rect" => Tag::Rect,
            "ellipse" => Tag::Ellipse,
            "circle" => Tag::Circle,
            "line" => Tag::Line,
            "polyline" => Tag::Polyline,
            "polygon" => Tag::Polygon,
            "text" => Tag::Text,
            "tspan" => Tag::Tspan,
            "image" => Tag::Image,
            "defs" => Tag::Defs,
            "linearGradient" => Tag::LinearGradient,
            "radialGradient" => Tag::RadialGradient,
            "pattern" => Tag::Pattern,
            "marker" => Tag::Marker,
            "clipPath" => Tag::ClipPath,
            "mask" => Tag::Mask,
            "filter" => Tag::Filter,
            _ => return None,
        })
    }

    /// Il tipo della risorsa, per i tag delle risorse.
    fn resource_kind(self) -> Option<ResourceKind> {
        Some(match self {
            Tag::LinearGradient | Tag::RadialGradient => ResourceKind::Gradient,
            Tag::Pattern => ResourceKind::Pattern,
            Tag::Marker => ResourceKind::Marker,
            Tag::ClipPath => ResourceKind::Clip,
            Tag::Mask => ResourceKind::Mask,
            Tag::Filter => ResourceKind::Filter,
            _ => return None,
        })
    }

    /// Vero per le forme di §4, che possono stare nel contenuto di ogni
    /// risorsa.
    fn is_shape(self) -> bool {
        use Tag::*;
        matches!(
            self,
            Path | Rect | Ellipse | Circle | Line | Polyline | Polygon
        )
    }

    /// Vero per i tag su cui valgono i riferimenti di `fill` e `stroke`,
    /// `clip-path`, `mask` e `filter`: non le righe e i pezzi di un testo, il
    /// cui riquadro i lettori non misurano tutti allo stesso modo.
    fn is_drawn(self) -> bool {
        self.is_shape() || matches!(self, Tag::Text | Tag::Image | Tag::G | Tag::A)
    }

    /// Vero per i tag su cui i browser disegnano i marcatori.
    fn is_marked(self) -> bool {
        matches!(self, Tag::Path | Tag::Line | Tag::Polyline | Tag::Polygon)
    }

    fn name(self) -> &'static str {
        match self {
            Tag::Title => "title",
            Tag::Desc => "desc",
            Tag::G => "g",
            Tag::A => "a",
            Tag::Path => "path",
            Tag::Rect => "rect",
            Tag::Ellipse => "ellipse",
            Tag::Circle => "circle",
            Tag::Line => "line",
            Tag::Polyline => "polyline",
            Tag::Polygon => "polygon",
            Tag::Text => "text",
            Tag::Tspan => "tspan",
            Tag::Image => "image",
            Tag::Defs => "defs",
            Tag::LinearGradient => "linearGradient",
            Tag::RadialGradient => "radialGradient",
            Tag::Pattern => "pattern",
            Tag::Marker => "marker",
            Tag::ClipPath => "clipPath",
            Tag::Mask => "mask",
            Tag::Filter => "filter",
        }
    }
}

/// Gli attributi che possono rimandare a una risorsa con `url(` (§15).
const REFERENCES: [&str; 8] = [
    "fill",
    "stroke",
    "marker-start",
    "marker-mid",
    "marker-end",
    "clip-path",
    "mask",
    "filter",
];

/// Vero se ogni attributo di `element` rientra in §4 per il suo tag, coi
/// riferimenti risolti da `resolve`. Con `clip` l'elemento sta in un
/// ritaglio, dove vale anche `clip-rule`.
fn attributes_allowed(element: &Element<'_>, tag: Tag, resolve: Resolve<'_>, clip: bool) -> bool {
    element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => {
            if clip && attr.local == "clip-rule" {
                return keyword("clip-rule", &attr.value);
            }
            (REFERENCES.contains(&attr.local) || !has_url(&attr.value))
                && svg_attribute(tag, attr.local, &attr.value, resolve)
        }
        NS_XLINK => {
            attr.local == "href"
                && matches!(tag, Tag::A | Tag::Image)
                && !has_url(&attr.value)
                && svg_attribute(tag, "href", &attr.value, &no_resources)
        }
        // Un attributo nel namespace SVG non è un attributo SVG: quelli non
        // hanno namespace.
        NS_SVG => false,
        // `fub:*`, `xml:*`, le dichiarazioni e ogni altro namespace si
        // conservano e non decidono niente.
        _ => true,
    })
}

/// Vero se un valore contiene `url(`, in qualunque combinazione di maiuscole.
fn has_url(value: &str) -> bool {
    value
        .as_bytes()
        .windows(4)
        .any(|w| w.eq_ignore_ascii_case(b"url("))
}

/// Vero se `value` è `none` o un `url(#id)` di una risorsa di tipo `kind`.
fn resource_or_none(value: &str, kind: ResourceKind, resolve: Resolve<'_>) -> bool {
    trim(value) == "none" || reference(value).is_some_and(|id| resolve(id) == Some(kind))
}

/// Il giudizio su un attributo SVG senza namespace, coi riferimenti alle
/// risorse risolti da `resolve` (§15).
fn svg_attribute(tag: Tag, name: &str, value: &str, resolve: Resolve<'_>) -> bool {
    match name {
        "id" => !value.is_empty(),
        "fill" | "stroke" => {
            paint(value).is_some()
                || (tag.is_drawn()
                    && paint_reference(value)
                        .and_then(|used| resolve(used.id))
                        .is_some_and(|kind| {
                            matches!(kind, ResourceKind::Gradient | ResourceKind::Pattern)
                        }))
        }
        "marker-start" | "marker-mid" | "marker-end" => {
            tag.is_marked() && resource_or_none(value, ResourceKind::Marker, resolve)
        }
        "clip-path" => tag.is_drawn() && resource_or_none(value, ResourceKind::Clip, resolve),
        "mask" => tag.is_drawn() && resource_or_none(value, ResourceKind::Mask, resolve),
        "filter" => tag.is_drawn() && resource_or_none(value, ResourceKind::Filter, resolve),
        "fill-opacity" | "stroke-opacity" | "opacity" => opacity(value).is_some(),
        "stroke-width" | "font-size" => non_negative_length(value).is_some(),
        "stroke-linecap" | "stroke-linejoin" | "display" | "font-weight" | "font-style"
        | "text-anchor" => keyword(name, value),
        "letter-spacing" => letter_spacing(value).is_some(),
        // Non si eredita: vale soltanto dove si scrive il testo.
        "text-decoration" => {
            matches!(tag, Tag::Text | Tag::Tspan) && text_decoration(value).is_some()
        }
        "stroke-dasharray" => dasharray(value),
        "transform" => transform(value).is_some(),
        "font-family" => true,
        _ => geometry_attribute(tag, name, value),
    }
}

/// Il giudizio sugli attributi di geometria, che dipendono dal tag.
fn geometry_attribute(tag: Tag, name: &str, value: &str) -> bool {
    use Tag::*;
    match (tag, name) {
        (Rect | Image | Text, "x" | "y")
        | (Tspan, "x" | "dy")
        | (Ellipse | Circle, "cx" | "cy")
        | (Line, "x1" | "y1" | "x2" | "y2") => length(value).is_some(),
        (Rect | Image, "width" | "height") | (Circle, "r") | (Rect | Ellipse, "rx" | "ry") => {
            non_negative_length(value).is_some()
        }
        (Polyline | Polygon, "points") => points(value).is_some(),
        (Path, "d") => parse_path(value).is_some(),
        (Image, "preserveAspectRatio") => preserve_aspect_ratio(value),
        // Un'immagine decorativa: S012 non la chiede descritta.
        (Image, "aria-hidden") => matches!(crate::values::trim(value), "true" | "false"),
        (A, "href") => matches!(href(value), Href::Vault(_)),
        (Image, "href") => matches!(
            href(value),
            Href::Vault(_) | Href::Remote | Href::Data { raster: true, .. }
        ),
        _ => false,
    }
}

/// Vero se `element` contiene solo dati di carattere: testo e riferimenti a
/// carattere, niente elementi, commenti, CDATA o entità.
fn character_data_only(doc: &Document<'_>, element: &Element<'_>) -> bool {
    element
        .children
        .iter()
        .all(|&child| matches!(doc.nodes[child].kind, Kind::Text { .. }))
}

/// Il testo di un elemento che contiene solo dati di carattere.
fn character_data(doc: &Document<'_>, id: NodeId) -> String {
    doc.children(id)
        .iter()
        .filter_map(|&child| match &doc.nodes[child].kind {
            Kind::Text { value, .. } => Some(value.as_ref()),
            _ => None,
        })
        .collect()
}

/// Il testo del primo `title` figlio di `element`; `None` se non ne ha.
fn first_title(doc: &Document<'_>, element: &Element<'_>) -> Option<String> {
    element
        .children
        .iter()
        .find(|&&child| doc.element(child).is_some_and(|e| e.is_svg("title")))
        .map(|&child| character_data(doc, child))
}

/// Gli attributi che un pezzo di riga non ha: un pezzo continua la riga,
/// non la sposta, non la nasconde e non ha un nome suo. SVG non dà a un
/// `tspan` né opacità né trasformazione.
const NOT_IN_PIECE: [&str; 7] = [
    "id",
    "x",
    "dy",
    "text-anchor",
    "display",
    "opacity",
    "transform",
];

/// Vero se `id` è un pezzo di riga modificabile: un `tspan` con attributi da
/// pezzo e solo testo dentro.
fn allowed_piece(doc: &Document<'_>, id: NodeId, resolve: Resolve<'_>) -> bool {
    let Some(element) = doc.element(id).filter(|e| Tag::of(e) == Some(Tag::Tspan)) else {
        return false;
    };
    let placed = element
        .attrs
        .iter()
        .any(|attr| attr.ns == NS_NONE && NOT_IN_PIECE.contains(&attr.local));
    !placed
        && attributes_allowed(element, Tag::Tspan, resolve, false)
        && character_data_only(doc, element)
}

/// Vero se `id` è un `title`, `desc` o, dentro un `text`, una riga
/// modificabile: attributi ammessi e dentro solo testo, e per una riga anche
/// pezzi.
fn allowed_part(doc: &Document<'_>, id: NodeId, inside_text: bool, resolve: Resolve<'_>) -> bool {
    let Some(element) = doc.element(id) else {
        return false;
    };
    let allowed = match Tag::of(element) {
        Some(tag @ (Tag::Title | Tag::Desc)) => Some(tag),
        Some(Tag::Tspan) if inside_text => Some(Tag::Tspan),
        _ => None,
    };
    let Some(tag) = allowed.filter(|&tag| attributes_allowed(element, tag, resolve, false)) else {
        return false;
    };
    if tag != Tag::Tspan {
        return character_data_only(doc, element);
    }
    element
        .children
        .iter()
        .all(|&child| match doc.nodes[child].kind {
            Kind::Text { .. } => true,
            Kind::Element(_) => allowed_piece(doc, child, resolve),
            _ => false,
        })
}

/// Il testo di una riga modificabile, coi suoi pezzi.
fn line_text(doc: &Document<'_>, id: NodeId) -> String {
    doc.children(id)
        .iter()
        .map(|&child| match &doc.nodes[child].kind {
            Kind::Text { value, .. } => value.to_string(),
            Kind::Element(_) => character_data(doc, child),
            _ => String::new(),
        })
        .collect()
}

/// Vero se ogni figlio di un'unità è ammesso: spazi, `title`, `desc` e, per
/// `text`, i `tspan`.
fn unit_children_allowed(
    doc: &Document<'_>,
    element: &Element<'_>,
    tag: Tag,
    resolve: Resolve<'_>,
) -> bool {
    element
        .children
        .iter()
        .all(|&child| match &doc.nodes[child].kind {
            Kind::Text { blank, .. } => *blank,
            Kind::Element(_) => allowed_part(doc, child, tag == Tag::Text, resolve),
            _ => false,
        })
}

// ---------------------------------------------------------------------------
// Le risorse (§15).
// ---------------------------------------------------------------------------

/// Quanti punti ha al più una sfumatura (§11).
pub(crate) const MAX_STOPS: usize = 256;

/// Quante primitive ha al più un filtro, coi `feMergeNode` (§11).
pub(crate) const MAX_PRIMITIVES: usize = 64;

/// Quanti `g` si annidano al più nel contenuto di una risorsa.
pub(crate) const MAX_CONTENT_DEPTH: usize = 32;

/// Le primitive dei filtri (§15): un elenco chiuso, quelle di SVG 1.1 che
/// ogni lettore disegna allo stesso modo e l'ombra di Filter Effects.
const PRIMITIVES: [&str; 9] = [
    "feGaussianBlur",
    "feOffset",
    "feFlood",
    "feDropShadow",
    "feColorMatrix",
    "feComposite",
    "feBlend",
    "feMorphology",
    "feMerge",
];

/// Vero se `element` è una `defs` della radice modificabile: solo `id` fra
/// gli attributi SVG.
fn defs_allowed(element: &Element<'_>) -> bool {
    element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => attr.local == "id" && !attr.value.is_empty(),
        NS_XLINK | NS_SVG => false,
        _ => true,
    })
}

/// Vero se `value`, una coordinata di una risorsa, rientra nelle sue unità:
/// nel riquadro (`in_box`) un numero o una percentuale, altrimenti una
/// lunghezza.
fn coordinate(value: &str, in_box: bool, non_negative: bool) -> bool {
    let n = if in_box { fraction(value) } else { length(value) };
    n.is_some_and(|n| !non_negative || n >= 0.0)
}

/// Le coordinate di ogni risorsa, nelle sue unità.
fn coordinates(tag: Tag) -> &'static [&'static str] {
    match tag {
        Tag::LinearGradient => &["x1", "y1", "x2", "y2"],
        Tag::RadialGradient => &["cx", "cy", "r", "fx", "fy"],
        Tag::Pattern | Tag::Mask | Tag::Filter => &["x", "y", "width", "height"],
        _ => &[],
    }
}

/// Le coordinate che in `userSpaceOnUse` vanno scritte: mancando, SVG le
/// prenderebbe in percentuale del viewport.
fn required(tag: Tag) -> &'static [&'static str] {
    match tag {
        Tag::LinearGradient => &["x2"],
        Tag::RadialGradient => &["cx", "cy", "r"],
        Tag::Mask | Tag::Filter => &["x", "y", "width", "height"],
        _ => &[],
    }
}

/// L'attributo delle unità delle coordinate di ogni risorsa.
fn units(tag: Tag) -> Option<&'static str> {
    match tag {
        Tag::LinearGradient | Tag::RadialGradient => Some("gradientUnits"),
        Tag::Pattern => Some("patternUnits"),
        Tag::Mask => Some("maskUnits"),
        Tag::Filter => Some("filterUnits"),
        _ => None,
    }
}

/// Il giudizio su un attributo SVG senza namespace di una risorsa, con le
/// coordinate nel riquadro se `in_box`.
fn resource_attribute(tag: Tag, name: &str, value: &str, in_box: bool) -> bool {
    use Tag::*;
    if name == "id" {
        return !value.is_empty();
    }
    if coordinates(tag).contains(&name) {
        return coordinate(value, in_box, matches!(name, "r" | "width" | "height"));
    }
    let gradient = matches!(tag, LinearGradient | RadialGradient);
    match name {
        "gradientUnits" | "spreadMethod" => gradient && keyword(name, value),
        "gradientTransform" => gradient && transform(value).is_some(),
        "patternUnits" | "patternContentUnits" => tag == Pattern && keyword(name, value),
        "patternTransform" => tag == Pattern && transform(value).is_some(),
        "viewBox" => matches!(tag, Pattern | Marker) && view_box(value).is_some(),
        "preserveAspectRatio" => matches!(tag, Pattern | Marker) && preserve_aspect_ratio(value),
        "markerUnits" => tag == Marker && keyword(name, value),
        "refX" | "refY" => tag == Marker && length(value).is_some(),
        "markerWidth" | "markerHeight" => tag == Marker && non_negative_length(value).is_some(),
        "orient" => {
            tag == Marker
                && (matches!(trim(value), "auto" | "auto-start-reverse") || angle(value).is_some())
        }
        "clipPathUnits" | "clip-rule" => tag == ClipPath && keyword(name, value),
        "transform" => tag == ClipPath && transform(value).is_some(),
        "maskUnits" | "maskContentUnits" => tag == Mask && keyword(name, value),
        "filterUnits" | "primitiveUnits" | "color-interpolation-filters" => {
            tag == Filter && keyword(name, value)
        }
        _ => false,
    }
}

/// Vero se `element`, una risorsa di tag `tag` in una `defs` della radice, è
/// modificabile: attributi, figli e riferimenti del suo contenuto.
fn resource_allowed(
    doc: &Document<'_>,
    element: &Element<'_>,
    tag: Tag,
    resolve: Resolve<'_>,
) -> bool {
    if element.value(NS_NONE, "id").is_none_or(str::is_empty) {
        return false;
    }
    let in_box = units(tag)
        .and_then(|name| element.value(NS_NONE, name))
        .is_none_or(|units| trim(units) != "userSpaceOnUse");
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => !has_url(&attr.value) && resource_attribute(tag, attr.local, &attr.value, in_box),
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    if !attributes {
        return false;
    }
    if !in_box
        && required(tag)
            .iter()
            .any(|name| element.value(NS_NONE, name).is_none())
    {
        return false;
    }
    match tag {
        Tag::LinearGradient | Tag::RadialGradient => stops_allowed(doc, element),
        Tag::Filter => primitives_allowed(doc, element),
        _ => {
            // Il contenuto rimanda soltanto alle sfumature: così le risorse
            // non si rimandano in cerchio.
            let gradients = |id: &str| resolve(id).filter(|&kind| kind == ResourceKind::Gradient);
            let clip = tag == Tag::ClipPath;
            element
                .children
                .iter()
                .all(|&child| content_allowed(doc, child, clip, &gradients, 1))
        }
    }
}

/// Vero se un nodo è spazio, `title` o `desc` ammessi: i figli che ogni
/// risorsa può avere. `None` per un altro elemento.
fn blank_or_meta(doc: &Document<'_>, child: NodeId) -> Option<bool> {
    match &doc.nodes[child].kind {
        Kind::Text { blank, .. } => Some(*blank),
        Kind::Element(_) => {
            let element = doc.element(child).expect("un nodo elemento è un elemento");
            matches!(Tag::of(element), Some(Tag::Title | Tag::Desc))
                .then(|| allowed_part(doc, child, false, &no_resources))
        }
        _ => Some(false),
    }
}

/// Vero se i figli di una sfumatura sono ammessi: `stop`, al più
/// [`MAX_STOPS`], ognuno con `offset`, `stop-color` e `stop-opacity`.
fn stops_allowed(doc: &Document<'_>, element: &Element<'_>) -> bool {
    let mut stops = 0;
    for &child in &element.children {
        if let Some(plain) = blank_or_meta(doc, child) {
            if !plain {
                return false;
            }
            continue;
        }
        let stop = doc.element(child).expect("un nodo elemento è un elemento");
        stops += 1;
        if !stop.is_svg("stop") || stops > MAX_STOPS {
            return false;
        }
        let attributes = stop.attrs.iter().all(|attr| match attr.ns {
            NS_NONE => match attr.local {
                "id" => !attr.value.is_empty(),
                "offset" => fraction(&attr.value).is_some(),
                "stop-color" => paint(&attr.value).is_some_and(|color| color != Paint::None),
                "stop-opacity" => opacity(&attr.value).is_some(),
                _ => false,
            },
            NS_XLINK | NS_SVG => false,
            _ => true,
        });
        let empty = stop
            .children
            .iter()
            .all(|&inner| matches!(doc.nodes[inner].kind, Kind::Text { blank: true, .. }));
        if !attributes || !empty {
            return false;
        }
    }
    true
}

/// Vero se `id`, nel contenuto di una risorsa, è ammesso: spazi, `title`,
/// `desc`, una forma, un testo e, fuori da un ritaglio, un `g` che ne
/// contiene, fino a [`MAX_CONTENT_DEPTH`] livelli.
fn content_allowed(
    doc: &Document<'_>,
    id: NodeId,
    clip: bool,
    resolve: Resolve<'_>,
    depth: usize,
) -> bool {
    if let Some(plain) = blank_or_meta(doc, id) {
        return plain;
    }
    let element = doc.element(id).expect("un nodo elemento è un elemento");
    let Some(tag) = Tag::of(element) else {
        return false;
    };
    if tag.is_shape() || tag == Tag::Text {
        return attributes_allowed(element, tag, resolve, clip)
            && unit_children_allowed(doc, element, tag, resolve);
    }
    if tag != Tag::G || clip || depth > MAX_CONTENT_DEPTH {
        return false;
    }
    attributes_allowed(element, tag, resolve, false)
        && element
            .children
            .iter()
            .all(|&child| content_allowed(doc, child, clip, resolve, depth + 1))
}

/// Vero se `value`, un `result`, è un nome senza spazi.
fn result_name(value: &str) -> bool {
    !value.is_empty() && !value.bytes().any(is_wsp)
}

/// Quanti numeri vuole `values` per ogni tipo di `feColorMatrix`.
fn matrix_values(kind: &str) -> Option<usize> {
    match kind {
        "matrix" => Some(20),
        "saturate" | "hueRotate" => Some(1),
        "luminanceToAlpha" => Some(0),
        _ => None,
    }
}

/// Il giudizio su un attributo senza namespace della primitiva `local`;
/// `input` dice se un ingresso è ammesso.
fn primitive_attribute(local: &str, name: &str, value: &str, input: &dyn Fn(&str) -> bool) -> bool {
    let shadow = local == "feDropShadow";
    match name {
        "id" => !value.is_empty(),
        "result" => local != "feMergeNode" && result_name(value),
        "color-interpolation-filters" => local != "feMergeNode" && keyword(name, value),
        "x" | "y" => local != "feMergeNode" && length(value).is_some(),
        "width" | "height" => local != "feMergeNode" && non_negative_length(value).is_some(),
        "in" => local != "feFlood" && local != "feMerge" && input(value),
        "in2" => matches!(local, "feComposite" | "feBlend") && input(value),
        "stdDeviation" => (local == "feGaussianBlur" || shadow) && one_or_two(value).is_some(),
        "dx" | "dy" => (local == "feOffset" || shadow) && number(value).is_some(),
        "flood-color" => {
            (local == "feFlood" || shadow) && paint(value).is_some_and(|color| color != Paint::None)
        }
        "flood-opacity" => (local == "feFlood" || shadow) && opacity(value).is_some(),
        "type" => local == "feColorMatrix" && matrix_values(value).is_some(),
        // Il numero lo controlla chi conosce il tipo.
        "values" => local == "feColorMatrix" && number_list(value).is_some(),
        "operator" => match local {
            "feComposite" => matches!(value, "over" | "in" | "out" | "atop" | "xor" | "arithmetic"),
            "feMorphology" => matches!(value, "erode" | "dilate"),
            _ => false,
        },
        "k1" | "k2" | "k3" | "k4" => local == "feComposite" && number(value).is_some(),
        "mode" => {
            local == "feBlend"
                && matches!(value, "normal" | "multiply" | "screen" | "darken" | "lighten")
        }
        "radius" => local == "feMorphology" && one_or_two(value).is_some(),
        _ => false,
    }
}

/// Vero se la primitiva `element` è ammessa, con gli ingressi che rimandano
/// a `results`, i nomi delle primitive che la precedono.
fn primitive_allowed(doc: &Document<'_>, element: &Element<'_>, results: &HashSet<&str>) -> bool {
    let input =
        |value: &str| value == "SourceGraphic" || value == "SourceAlpha" || results.contains(value);
    let local = element.local;
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => {
            !has_url(&attr.value) && primitive_attribute(local, attr.local, &attr.value, &input)
        }
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    if !attributes {
        return false;
    }
    if matches!(local, "feComposite" | "feBlend") && element.value(NS_NONE, "in2").is_none() {
        return false;
    }
    if local == "feColorMatrix" {
        let kind = element.value(NS_NONE, "type").unwrap_or("matrix");
        let wanted = matrix_values(kind).expect("il tipo è già controllato");
        if let Some(values) = element.value(NS_NONE, "values") {
            let numbers = number_list(values).expect("i valori sono già controllati");
            if numbers.len() != wanted || (kind == "saturate" && numbers[0] < 0.0) {
                return false;
            }
        }
    }
    element
        .children
        .iter()
        .all(|&child| match &doc.nodes[child].kind {
            Kind::Text { blank, .. } => *blank,
            Kind::Element(_) => {
                let node = doc.element(child).expect("un nodo elemento è un elemento");
                local == "feMerge" && node.is_svg("feMergeNode") && primitive_allowed(doc, node, results)
            }
            _ => false,
        })
}

/// Vero se i figli di un filtro sono ammessi: primitive dell'elenco, al più
/// [`MAX_PRIMITIVES`] coi `feMergeNode`, ognuna con ingressi che vengono
/// prima.
fn primitives_allowed(doc: &Document<'_>, element: &Element<'_>) -> bool {
    let mut results = HashSet::new();
    let mut count = 0;
    for &child in &element.children {
        if let Some(plain) = blank_or_meta(doc, child) {
            if !plain {
                return false;
            }
            continue;
        }
        let primitive = doc.element(child).expect("un nodo elemento è un elemento");
        if primitive.ns != NS_SVG || !PRIMITIVES.contains(&primitive.local) {
            return false;
        }
        count += 1 + primitive
            .children
            .iter()
            .filter(|&&inner| doc.element(inner).is_some())
            .count();
        if count > MAX_PRIMITIVES || !primitive_allowed(doc, primitive, &results) {
            return false;
        }
        if let Some(result) = primitive.value(NS_NONE, "result") {
            results.insert(result);
        }
    }
    true
}

/// L'indice delle risorse modificabili del documento: per ogni id, il tipo
/// della risorsa (§15). Prima le sfumature, che non rimandano a niente, poi
/// le altre, che nel contenuto possono usare le sfumature. Di due risorse
/// con lo stesso id vale la prima, in quest'ordine: il documento è comunque
/// in sola lettura (S003).
fn resource_index(doc: &Document<'_>) -> HashMap<String, ResourceKind> {
    let mut found = HashMap::new();
    let mut others = Vec::new();
    let judge = |found: &mut HashMap<String, ResourceKind>,
                 element: &Element<'_>,
                 tag: Tag,
                 resolve: Resolve<'_>| {
        let Some(id) = element.value(NS_NONE, "id") else {
            return;
        };
        if found.contains_key(id) || !resource_allowed(doc, element, tag, resolve) {
            return;
        }
        let kind = tag.resource_kind().expect("è una risorsa");
        found.insert(id.to_owned(), kind);
    };
    for &child in doc.children(doc.root) {
        let Some(defs) = doc.element(child) else {
            continue;
        };
        if Tag::of(defs) != Some(Tag::Defs) || !defs_allowed(defs) {
            continue;
        }
        for &inner in &defs.children {
            let Some(element) = doc.element(inner) else {
                continue;
            };
            let Some(tag) = Tag::of(element).filter(|tag| tag.resource_kind().is_some()) else {
                continue;
            };
            if matches!(tag, Tag::LinearGradient | Tag::RadialGradient) {
                judge(&mut found, element, tag, &no_resources);
            } else {
                others.push((element, tag));
            }
        }
    }
    let gradients = found.clone();
    let resolve = |id: &str| gradients.get(id).copied();
    for (element, tag) in others {
        judge(&mut found, element, tag, &resolve);
    }
    found
}

/// Il ruolo di un figlio di un contenitore, o `None` se è estraneo. `place`
/// dice dov'è il contenitore: la radice decide livelli, carta e `defs`, una
/// `defs` della radice le risorse. `resolve` dice che cosa è la risorsa di
/// ogni id a cui l'elemento rimanda.
fn classify(
    doc: &Document<'_>,
    id: NodeId,
    place: Place,
    resolve: Resolve<'_>,
) -> Option<(Tag, Role)> {
    let element = doc.element(id)?;
    let tag = Tag::of(element)?;
    if tag == Tag::Defs {
        return (place == Place::Root && defs_allowed(element)).then_some((tag, Role::Defs));
    }
    if tag.resource_kind().is_some() {
        return (place == Place::Defs && resource_allowed(doc, element, tag, resolve))
            .then_some((tag, Role::Resource));
    }
    // In una `defs` stanno solo risorse, titolo e descrizione.
    if place == Place::Defs && !matches!(tag, Tag::Title | Tag::Desc) {
        return None;
    }
    if !attributes_allowed(element, tag, resolve, false) {
        return None;
    }
    let under_root = place == Place::Root;
    let role = match tag {
        Tag::G if under_root && element.attr(NS_FUB, "layer").is_some() => Role::Layer,
        Tag::G => Role::Group,
        Tag::A => Role::Link,
        Tag::Title | Tag::Desc => {
            if !character_data_only(doc, element) {
                return None;
            }
            if tag == Tag::Title {
                Role::Title
            } else {
                Role::Desc
            }
        }
        Tag::Tspan => return None,
        _ => {
            if !unit_children_allowed(doc, element, tag, resolve) {
                return None;
            }
            match tag {
                Tag::Path => path_role(element),
                Tag::Rect if under_root && element.value(NS_FUB, "role") == Some("paper") => {
                    Role::Paper
                }
                Tag::Rect => Role::Rect,
                Tag::Ellipse => Role::Ellipse,
                Tag::Circle => Role::Circle,
                Tag::Line => Role::Line,
                Tag::Polyline => Role::Polyline,
                Tag::Polygon => Role::Polygon,
                Tag::Text => Role::Text,
                Tag::Image => Role::Image,
                _ => unreachable!("defs e risorse sono già giudicate"),
            }
        }
    };
    Some((tag, role))
}

/// Il ruolo di un `path`: tratto, freccia o tracciato.
fn path_role(element: &Element<'_>) -> Role {
    if matches!(element.value(NS_FUB, "tool"), Some("pen" | "highlighter")) {
        return Role::Stroke;
    }
    // Uno strumento sconosciuto, o una forma sconosciuta, lasciano un
    // tracciato: la geometria si legge da `d` (§6).
    match element.value(NS_FUB, "shape") {
        Some("arrow") if arrow_geometry(element).is_some() => Role::Arrow,
        Some("polygon") if polygonal_geometry(element).is_some() => Role::Ngon,
        Some("star") if polygonal_geometry(element).is_some() => Role::Star,
        Some("width") if width_geometry(element).is_some() => Role::Width,
        _ => Role::Path,
    }
}

/// `fub:geom` di una freccia: quattro numeri SVG.
fn arrow_geometry(element: &Element<'_>) -> Option<[f64; 4]> {
    let numbers = number_list(element.value(NS_FUB, "geom")?)?;
    <[f64; 4]>::try_from(numbers.as_slice()).ok()
}

/// `fub:geom` di un poligono regolare o di una stella, se si legge.
fn polygonal_geometry(element: &Element<'_>) -> Option<Polygonal> {
    let shape = PolygonalShape::parse(element.value(NS_FUB, "shape")?)?;
    read_polygonal(shape, element.value(NS_FUB, "geom")?)
}

/// `fub:geom` di un contorno a spessore variabile, se si legge.
fn width_geometry(element: &Element<'_>) -> Option<VarWidth> {
    read_var_width(element.value(NS_FUB, "geom")?)
}

/// Un blocco estraneo in costruzione.
struct Pending {
    start: usize,
    end: usize,
    elements: [usize; 2],
}

/// Un contenitore in visita.
struct Frame {
    node: NodeId,
    /// Dove stanno i suoi figli.
    place: Place,
    path: Vec<usize>,
    next: usize,
    elements: usize,
    pending: Option<Pending>,
    context: Context,
}

struct Builder<'d, 'a> {
    doc: &'d Document<'a>,
    map: &'d Utf16Map<'a>,
    lines: Lines<'a>,
    /// Falso per un documento oltre [`crate::MAX_ELEMENTS`]: le voci si
    /// contano e si scartano, e restano solo riepilogo e diagnostica.
    keep: bool,
    /// Le risorse modificabili del documento.
    resolve: Resolve<'d>,
    items: Vec<Item>,
    diagnostics: Vec<Diagnostic>,
    tally: Tally,
}

/// Ciò che la classificazione trova.
pub(crate) struct Classified {
    pub items: Vec<Item>,
    /// S002, S004 e S010.
    pub diagnostics: Vec<Diagnostic>,
    pub tally: Tally,
}

impl Builder<'_, '_> {
    /// Allunga il blocco in attesa fino a `id`; `element` è l'indice del nodo
    /// fra i figli elemento, se è un elemento.
    ///
    /// Un blocco comincia e finisce su un byte che non è spazio: gli spazi ai
    /// bordi di un testo estraneo stanno fra due voci, come gli altri.
    fn extend(
        &mut self,
        pending: &mut Option<Pending>,
        id: NodeId,
        element: Option<usize>,
        next: usize,
    ) {
        let node = &self.doc.nodes[id];
        let (mut start, mut end) = (node.start, node.end);
        if let Kind::Text { .. } = node.kind {
            let spaces = [' ', '\t', '\n', '\r'];
            let trimmed = self.doc.source[start..end].trim_start_matches(spaces);
            start = end - trimmed.len();
            end = start + trimmed.trim_end_matches(spaces).len();
        }
        let block = pending.get_or_insert(Pending {
            start,
            end,
            elements: [element.unwrap_or(next), element.unwrap_or(next)],
        });
        block.end = end;
        if let Some(index) = element {
            block.elements[1] = index + 1;
        }
    }

    fn flush(&mut self, pending: Option<Pending>, parent_path: Option<&[usize]>) {
        if let Some(block) = pending {
            let span = self.map.span(block.start, block.end);
            if self.keep {
                self.items.push(Item::Foreign(ForeignItem {
                    parent_path: parent_path.map(<[usize]>::to_vec),
                    span,
                    elements: block.elements,
                    indent: self.lines.indent(block.start).to_owned(),
                }));
            }
            self.tally.foreign();
            self.diagnostics
                .push(Diagnostic::new(Code::S002, Some(span), None));
        }
    }

    fn tags(&self, id: NodeId) -> Tags {
        let node = &self.doc.nodes[id];
        let element = self.doc.element(id).expect("un contenitore è un elemento");
        Tags {
            open: self.map.span(node.start, element.open_end),
            close: element
                .close_start
                .map(|start| self.map.span(start, node.end)),
        }
    }

    /// Legge inchiostro e pennello di un tratto, con S004 per ognuno che non
    /// si legge e S010 per i canali sconosciuti.
    fn stroke(&mut self, element: &Element<'_>, span: Span) -> Stroke {
        let tool = match element.value(NS_FUB, "tool") {
            Some("highlighter") => Tool::Highlighter,
            _ => Tool::Pen,
        };
        let ink = element
            .value(NS_FUB, "ink")
            .map_or(Err(InkError::Missing), Ink::decode);
        let brush = element
            .value(NS_FUB, "brush")
            .map_or(Err(BrushError::Missing), Brush::parse);
        let mut problems = Vec::new();
        if let Err(error) = &ink {
            let mut detail = format!("fub:ink {}", error.kind());
            if let Some(sample) = error.sample() {
                detail.push_str(&format!(" {sample}"));
            }
            if let InkError::Range { channel, .. } = error {
                detail.push_str(&format!(" {channel}"));
            }
            problems.push((Code::S004, detail));
        }
        if let Err(error) = &brush {
            let mut detail = format!("fub:brush {}", error.kind());
            if let Some(key) = error.key() {
                detail.push_str(&format!(" {key}"));
            }
            problems.push((Code::S004, detail));
        }
        if let Ok(ink) = &ink {
            let unknown = ink.unknown_channels();
            if !unknown.is_empty() {
                problems.push((Code::S010, unknown));
            }
        }
        let redrawable = problems.is_empty();
        for (code, detail) in problems {
            self.diagnostics
                .push(Diagnostic::new(code, Some(span), Some(detail)));
        }
        let ink = ink.ok();
        Stroke {
            tool,
            redrawable,
            samples: ink.as_ref().map(Ink::len),
            duration: ink.as_ref().and_then(Ink::duration),
        }
    }

    fn element_item(
        &mut self,
        id: NodeId,
        tag: Tag,
        role: Role,
        path: Vec<usize>,
        context: &Context,
    ) {
        let doc = self.doc;
        let node = &doc.nodes[id];
        let element = doc.element(id).expect("una voce è un elemento");
        let layer = (role == Role::Layer).then(|| Layer {
            name: element
                .value(NS_FUB, "layer")
                .unwrap_or_default()
                .to_owned(),
            locked: element.value(NS_FUB, "locked") == Some("true"),
            hidden: element
                .value(NS_NONE, "display")
                .is_some_and(|d| crate::values::trim(d) == "none"),
        });
        let span = self.map.span(node.start, node.end);
        let stroke = (role == Role::Stroke).then(|| self.stroke(element, span));
        // Si bloccano e si nascondono i livelli e ciò che si disegna, non il
        // titolo, la descrizione, la carta o le risorse; queste e la `defs`
        // hanno però un nome.
        let object = !matches!(
            role,
            Role::Title | Role::Desc | Role::Paper | Role::Defs | Role::Resource
        );
        let named = object || matches!(role, Role::Defs | Role::Resource);
        self.tally
            .element(doc, element, role, context, span, stroke.as_ref());
        if !self.keep {
            return;
        }
        let item = ElementItem {
            path,
            tag: tag.name(),
            role,
            id: element.value(NS_NONE, "id").map(str::to_owned),
            span,
            indent: self.lines.indent(node.start).to_owned(),
            tags: role.is_container().then(|| self.tags(id)),
            layer,
            locked: object && element.value(NS_FUB, "locked") == Some("true"),
            hidden: object
                && element
                    .value(NS_NONE, "display")
                    .is_some_and(|d| crate::values::trim(d) == "none"),
            stroke,
            arrow: (role == Role::Arrow)
                .then(|| arrow_geometry(element))
                .flatten(),
            polygonal: matches!(role, Role::Ngon | Role::Star)
                .then(|| polygonal_geometry(element))
                .flatten(),
            varwidth: (role == Role::Width)
                .then(|| width_geometry(element))
                .flatten(),
            title: named.then(|| first_title(doc, element)).flatten(),
            text: matches!(role, Role::Title | Role::Desc).then(|| character_data(doc, id)),
            lines: (role == Role::Text).then(|| {
                element
                    .children
                    .iter()
                    .filter(|&&child| doc.element(child).is_some_and(|e| e.is_svg("tspan")))
                    .map(|&child| line_text(doc, child))
                    .collect()
            }),
            lifecycle: (role == Role::Resource)
                .then(|| match element.value(NS_FUB, "role") {
                    Some("private") => Some(Lifecycle::Private),
                    Some("shared") => Some(Lifecycle::Shared),
                    _ => None,
                })
                .flatten(),
        };
        self.items.push(Item::Element(Box::new(item)));
    }

    /// Visita la radice e i contenitori modificabili, in ordine di documento.
    fn walk(&mut self, root: NodeId) {
        let doc = self.doc;
        let mut stack = vec![Frame {
            node: root,
            place: Place::Root,
            path: Vec::new(),
            next: 0,
            elements: 0,
            pending: None,
            context: Context::root(doc.element(root).expect("la radice è un elemento")),
        }];
        while let Some(frame) = stack.last_mut() {
            let children = doc.children(frame.node);
            let Some(&child) = children.get(frame.next) else {
                let frame = stack.pop().expect("la pila non è vuota");
                self.flush(frame.pending, Some(&frame.path));
                continue;
            };
            frame.next += 1;
            match &doc.nodes[child].kind {
                Kind::Text { blank: true, .. } => {}
                Kind::Element(_) => {
                    let index = frame.elements;
                    frame.elements += 1;
                    // Un contenitore oltre la profondità massima è un'unità.
                    let depth = frame.path.len() + 1;
                    let class = classify(doc, child, frame.place, self.resolve)
                        .filter(|&(_, role)| !role.is_container() || depth <= MAX_DEPTH);
                    match class {
                        Some((tag, role)) => {
                            let pending = frame.pending.take();
                            let context = frame
                                .context
                                .child(doc.element(child).expect("una voce è un elemento"));
                            let mut path = frame.path.clone();
                            self.flush(pending, Some(&path));
                            path.push(index);
                            if role.is_container() {
                                self.element_item(child, tag, role, path.clone(), &context);
                                stack.push(Frame {
                                    node: child,
                                    place: if role == Role::Defs {
                                        Place::Defs
                                    } else {
                                        Place::Inside
                                    },
                                    path,
                                    next: 0,
                                    elements: 0,
                                    pending: None,
                                    context,
                                });
                            } else {
                                self.element_item(child, tag, role, path, &context);
                            }
                        }
                        None => {
                            let next = frame.elements;
                            self.extend(&mut frame.pending, child, Some(index), next);
                        }
                    }
                }
                _ => {
                    let next = frame.elements;
                    self.extend(&mut frame.pending, child, None, next);
                }
            }
        }
    }
}

/// Classifica un documento letto per intero. Con `keep` falso le voci non
/// si conservano: un documento oltre il limite di elementi ne avrebbe troppe,
/// e serve solo il suo riepilogo.
pub(crate) fn classify_document<'a>(
    doc: &Document<'a>,
    map: &Utf16Map<'a>,
    keep: bool,
) -> Classified {
    let resources = resource_index(doc);
    let resolve = |id: &str| resources.get(id).copied();
    let mut builder = Builder {
        doc,
        map,
        lines: Lines::new(doc.source),
        keep,
        resolve: &resolve,
        items: Vec::new(),
        diagnostics: Vec::new(),
        tally: Tally::default(),
    };
    let mut pending = None;
    // Per il documento la radice è l'elemento 0: l'epilogo comincia da 1.
    let mut next = 0;
    for &id in &doc.top {
        match &doc.nodes[id].kind {
            Kind::Text { .. } => {}
            Kind::Element(_) => {
                builder.flush(pending.take(), None);
                let node = &doc.nodes[id];
                let root = RootItem {
                    span: map.span(node.start, node.end),
                    tags: builder.tags(id),
                };
                if keep {
                    builder.items.push(Item::Root(root));
                }
                builder.walk(id);
                next = 1;
            }
            _ => builder.extend(&mut pending, id, None, next),
        }
    }
    builder.flush(pending, None);
    Classified {
        items: builder.items,
        diagnostics: builder.diagnostics,
        tally: builder.tally,
    }
}
