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

use serde::Serialize;

use crate::analysis::{Context, Tally};
use crate::brush::{Brush, BrushError};
use crate::diagnostics::{Code, Diagnostic};
use crate::geometry::parse_path;
use crate::ink::{Ink, InkError};
use crate::parametric::{read_polygonal, Polygonal, PolygonalShape};
use crate::text::{Lines, Span, Utf16Map};
use crate::values::{
    dasharray, href, keyword, length, non_negative_length, number_list, opacity, paint, points,
    preserve_aspect_ratio, transform, Href,
};
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
}

impl Role {
    /// Vero per i ruoli i cui figli si classificano uno per uno.
    pub fn is_container(self) -> bool {
        matches!(self, Role::Layer | Role::Group | Role::Link)
    }
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
    /// Il testo del primo `title` figlio di un livello o di un oggetto, coi
    /// riferimenti risolti e gli spazi com'erano: il nome che qualcuno gli ha
    /// dato.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Il testo di un `title` o di un `desc`, coi riferimenti risolti e gli
    /// spazi com'erano: è ciò che l'operazione `meta` sostituisce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Le righe di un `text`, una per `tspan`, coi riferimenti risolti e gli
    /// spazi com'erano: è ciò che l'operazione `text` sostituisce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<String>>,
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
            _ => return None,
        })
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
        }
    }
}

/// Vero se ogni attributo di `element` rientra in §4 per il suo tag.
fn attributes_allowed(element: &Element<'_>, tag: Tag) -> bool {
    element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => !has_url(&attr.value) && svg_attribute(tag, attr.local, &attr.value),
        NS_XLINK => {
            attr.local == "href"
                && matches!(tag, Tag::A | Tag::Image)
                && !has_url(&attr.value)
                && svg_attribute(tag, "href", &attr.value)
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

/// Il giudizio su un attributo SVG senza namespace.
fn svg_attribute(tag: Tag, name: &str, value: &str) -> bool {
    match name {
        "id" => !value.is_empty(),
        "fill" | "stroke" => paint(value).is_some(),
        "fill-opacity" | "stroke-opacity" | "opacity" => opacity(value).is_some(),
        "stroke-width" | "font-size" => non_negative_length(value).is_some(),
        "stroke-linecap" | "stroke-linejoin" | "display" | "font-weight" | "text-anchor" => {
            keyword(name, value)
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

/// Vero se `id` è un `title`, `desc` o, dentro un `text`, un `tspan`
/// modificabile: attributi ammessi e solo testo dentro.
fn allowed_part(doc: &Document<'_>, id: NodeId, inside_text: bool) -> bool {
    let Some(element) = doc.element(id) else {
        return false;
    };
    let allowed = match Tag::of(element) {
        Some(tag @ (Tag::Title | Tag::Desc)) => Some(tag),
        Some(Tag::Tspan) if inside_text => Some(Tag::Tspan),
        _ => None,
    };
    allowed.is_some_and(|tag| attributes_allowed(element, tag) && character_data_only(doc, element))
}

/// Vero se ogni figlio di un'unità è ammesso: spazi, `title`, `desc` e, per
/// `text`, i `tspan`.
fn unit_children_allowed(doc: &Document<'_>, element: &Element<'_>, tag: Tag) -> bool {
    element
        .children
        .iter()
        .all(|&child| match &doc.nodes[child].kind {
            Kind::Text { blank, .. } => *blank,
            Kind::Element(_) => allowed_part(doc, child, tag == Tag::Text),
            _ => false,
        })
}

/// Il ruolo di un figlio di un contenitore, o `None` se è estraneo.
fn classify(doc: &Document<'_>, id: NodeId, under_root: bool) -> Option<(Tag, Role)> {
    let element = doc.element(id)?;
    let tag = Tag::of(element)?;
    if !attributes_allowed(element, tag) {
        return None;
    }
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
            if !unit_children_allowed(doc, element, tag) {
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
                _ => Role::Image,
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

/// Un blocco estraneo in costruzione.
struct Pending {
    start: usize,
    end: usize,
    elements: [usize; 2],
}

/// Un contenitore in visita.
struct Frame {
    node: NodeId,
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
        // titolo, la descrizione o la carta.
        let object = !matches!(role, Role::Title | Role::Desc | Role::Paper);
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
            title: object.then(|| first_title(doc, element)).flatten(),
            text: matches!(role, Role::Title | Role::Desc).then(|| character_data(doc, id)),
            lines: (role == Role::Text).then(|| {
                element
                    .children
                    .iter()
                    .filter(|&&child| doc.element(child).is_some_and(|e| e.is_svg("tspan")))
                    .map(|&child| character_data(doc, child))
                    .collect()
            }),
        };
        self.items.push(Item::Element(Box::new(item)));
    }

    /// Visita la radice e i contenitori modificabili, in ordine di documento.
    fn walk(&mut self, root: NodeId) {
        let doc = self.doc;
        let mut stack = vec![Frame {
            node: root,
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
            let under_root = frame.node == root;
            match &doc.nodes[child].kind {
                Kind::Text { blank: true, .. } => {}
                Kind::Element(_) => {
                    let index = frame.elements;
                    frame.elements += 1;
                    // Un contenitore oltre la profondità massima è un'unità.
                    let depth = frame.path.len() + 1;
                    let class = classify(doc, child, under_root)
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
    let mut builder = Builder {
        doc,
        map,
        lines: Lines::new(doc.source),
        keep,
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
