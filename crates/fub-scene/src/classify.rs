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
//! Le risorse del disegno (formato della scena, risorse) si leggono in due
//! passi: prima l'indice delle risorse modificabili nelle `defs` della radice,
//! poi la visita, in cui un riferimento vale se porta a una risorsa dell'indice
//! del tipo giusto. Così chi usa una sfumatura scritta dopo di lui si legge
//! come chi la usa prima. Il tracciato di un testo su tracciato è anch'esso
//! una risorsa, un `path` nelle `defs` della radice (formato della scena,
//! testo).

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::analysis::{use_target, Context, Swatches, Tally};
use crate::brush::{BrushError, InkBrush};
use crate::connectors::{
    read_connector_end, read_connector_geom, read_label_place, ConnectorEnd, ConnectorGeom,
    LabelPlace,
};
use crate::diagnostics::{Code, Diagnostic};
use crate::geometry::parse_path;
use crate::ink::{Ink, InkError};
use crate::labels::read_inside;
use crate::parametric::{read_polygonal, Polygonal, PolygonalShape};
use crate::repeat::{read_repeat, Repeat};
use crate::text::{Lines, Span, Utf16Map};
use crate::values::{
    angle, blend_style, dasharray, fraction, href, href_id, is_wsp, keyword, leading, length,
    letter_spacing, non_negative_length, number, number_list, one_or_two, opacity, paint,
    paint_reference, points, preserve_aspect_ratio, reference, start_offset, text_decoration,
    transform, trim, url_ids, view_box, wrap_width, Href, Paint,
};
use crate::varwidth::{read_var_width, VarWidth};
use crate::xml::{Document, Element, Kind, NodeId, NS_FUB, NS_NONE, NS_SVG, NS_XLINK};
use crate::MAX_DEPTH;

mod builder;
mod items;
mod resources;
mod symbols;

use builder::classify_child;
pub(crate) use builder::{board_box, boards, classify_document};
pub(crate) use items::ResourceKind;
use items::{
    claims_style, motif_of, no_resources, style_allowed, style_of, swatch_of, Place, Resolve,
};
pub use items::{
    ConnectorFacts, ElementItem, ForeignItem, Item, Layer, Lifecycle, Motif, Role, RootItem,
    Stroke, StyleFacts, StyleKind, Swatch, Tags, Tool, STYLE_GRAPHIC_POINTS,
};
use resources::{blank_or_meta, defs_allowed, path_resource_allowed, resource_allowed};
pub(crate) use symbols::repeat_of;
use symbols::{
    acyclic_symbols, originals_of, symbol_allowed, use_allowed, with_originals, COPY_ATTRIBUTES,
    INSTANCE_ATTRIBUTES,
};

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
    TextPath,
    Image,
    Defs,
    View,
    Symbol,
    Use,
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
            "textPath" => Tag::TextPath,
            "image" => Tag::Image,
            "defs" => Tag::Defs,
            "view" => Tag::View,
            "symbol" => Tag::Symbol,
            "use" => Tag::Use,
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
        self.is_shape() || matches!(self, Tag::Text | Tag::Image | Tag::G | Tag::A | Tag::Use)
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
            Tag::TextPath => "textPath",
            Tag::Image => "image",
            Tag::Defs => "defs",
            Tag::View => "view",
            Tag::Symbol => "symbol",
            Tag::Use => "use",
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

/// Gli attributi che possono rimandare a una risorsa con `url(` (formato della
/// scena, risorse).
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
/// risorse risolti da `resolve` (formato della scena, risorse).
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
        // La fusione, e l'isolamento di un contenitore.
        "style" => tag.is_drawn() && blend_style(value, matches!(tag, Tag::G | Tag::A)).is_some(),
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

/// Per ogni riga di un testo in area, se continua una parola della riga
/// prima (`fub:join="word"`, dopo la prima); `None` se nessuna lo fa, o se il
/// testo non è in area.
fn glued_lines(doc: &Document<'_>, element: &Element<'_>) -> Option<Vec<bool>> {
    element.value(NS_FUB, "wrap").and_then(wrap_width)?;
    let glued: Vec<bool> = element
        .children
        .iter()
        .filter_map(|&child| doc.element(child).filter(|e| e.is_svg("tspan")))
        .enumerate()
        .map(|(at, tspan)| at > 0 && tspan.value(NS_FUB, "join") == Some("word"))
        .collect();
    glued.contains(&true).then_some(glued)
}

/// Vero se `element` è il tracciato di un testo modificabile (formato della
/// scena, testo): un `textPath` con `href` o `xlink:href`, uno solo, verso un
/// tracciato delle risorse, `startOffset` facoltativo, e dentro dati di
/// carattere e pezzi.
fn allowed_text_path(doc: &Document<'_>, element: &Element<'_>, resolve: Resolve<'_>) -> bool {
    let mut hrefs = 0;
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE | NS_XLINK if attr.local == "href" => {
            hrefs += 1;
            href_id(&attr.value).is_some_and(|id| resolve(&id) == Some(ResourceKind::Path))
        }
        NS_NONE => attr.local == "startOffset" && start_offset(&attr.value).is_some(),
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    attributes
        && hrefs == 1
        && element
            .children
            .iter()
            .all(|&child| match doc.nodes[child].kind {
                Kind::Text { .. } => true,
                Kind::Element(_) => allowed_piece(doc, child, resolve),
                _ => false,
            })
}

/// Il `textPath` figlio di un `text`, se ne ha uno.
fn text_path_of<'d>(
    doc: &'d Document<'_>,
    element: &Element<'_>,
) -> Option<(NodeId, &'d Element<'d>)> {
    element.children.iter().find_map(|&child| {
        doc.element(child)
            .filter(|e| e.is_svg("textPath"))
            .map(|e| (child, e))
    })
}

/// L'id del tracciato a cui rimanda un `textPath`: in SVG 2 `href` vince su
/// `xlink:href`.
fn text_path_target(element: &Element<'_>) -> Option<String> {
    element
        .value(NS_NONE, "href")
        .or_else(|| element.value(NS_XLINK, "href"))
        .and_then(href_id)
}

/// Vero se ogni figlio di un'unità è ammesso: spazi, `title`, `desc` e, per
/// `text`, i `tspan` o un `textPath`. Un testo ha le righe o il tracciato,
/// non tutti e due, e col tracciato non ha `x` e `y`, che i lettori
/// applicano lungo il tracciato in modi diversi.
fn unit_children_allowed(
    doc: &Document<'_>,
    element: &Element<'_>,
    tag: Tag,
    resolve: Resolve<'_>,
) -> bool {
    let (mut lines, mut paths) = (0, 0);
    let children = element
        .children
        .iter()
        .all(|&child| match &doc.nodes[child].kind {
            Kind::Text { blank, .. } => *blank,
            Kind::Element(inner) => match Tag::of(inner) {
                Some(Tag::TextPath) if tag == Tag::Text => {
                    paths += 1;
                    allowed_text_path(doc, inner, resolve)
                }
                found => {
                    if found == Some(Tag::Tspan) {
                        lines += 1;
                    }
                    allowed_part(doc, child, tag == Tag::Text, resolve)
                }
            },
            _ => false,
        });
    if !children || paths == 0 {
        return children;
    }
    paths == 1
        && lines == 0
        && element.value(NS_NONE, "x").is_none()
        && element.value(NS_NONE, "y").is_none()
}
