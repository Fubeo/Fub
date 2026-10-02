//! L'analisi della scena per l'indice (§9) e i controlli di §12 che non
//! dipendono dalla classificazione.
//!
//! Due parti. [`index`] legge il documento intero, modificabile o estraneo:
//! titolo, descrizione, testi, collegamenti e immagini del vault, con gli
//! span; un disegno di Inkscape si cerca per i suoi testi anche se FubDraw
//! non li modifica. Trova anche S001, S005 e S006. [`Tally`] invece segue la
//! classificazione, che gli passa ogni elemento modificabile con il contesto
//! ereditato dai contenitori: ne escono il riepilogo di `fub.scene.summary` e
//! S009, che riguardano la scena come la modifica FubDraw.

use serde::Serialize;

use crate::classify::{Role, Stroke, Tool};
use crate::diagnostics::{Code, Diagnostic};
use crate::geometry::{parse_path, rect_path, BoundsBuilder, Matrix};
use crate::text::{Span, Utf16Map};
use crate::values::{
    href, is_javascript, length, opacity, paint, points, transform, trim, Href, Paint, Rgb,
};
use crate::xml::{Document, Element, Kind, NodeId, NS_FUB, NS_NONE, NS_SVG, NS_XHTML, NS_XLINK};
use crate::Status;

/// Quanti byte decodificati può avere un'immagine incorporata (§11).
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// Il contrasto minimo fra un tratto e la carta (§12, DEC-13).
pub const MIN_CONTRAST: f64 = 3.0;

/// Un testo della scena e l'elemento da cui viene.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Excerpt {
    /// Il testo con gli spazi come li disegna SVG: ogni sequenza di spazi XML
    /// ridotta a uno, niente spazi ai bordi.
    pub text: String,
    #[serde(flatten)]
    pub span: Span,
}

/// Un riferimento a un documento del vault: un collegamento o un'immagine.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Reference {
    /// Il percorso com'è scritto, ripulito come lo legge un URL: relativo al
    /// disegno, o dalla radice del vault se comincia con `/`.
    pub path: String,
    /// L'elemento `a` o `image`.
    #[serde(flatten)]
    pub span: Span,
    /// Il valore grezzo dell'attributo, virgolette escluse: è ciò che si
    /// riscrive quando la destinazione cambia nome.
    pub href: Span,
}

/// Ciò che l'indice legge di una scena (§9).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Index {
    /// Il primo `title` figlio della radice, se ha del testo.
    pub title: Option<Excerpt>,
    /// Il primo `desc` figlio della radice, se ha del testo.
    pub desc: Option<Excerpt>,
    /// Ogni `text` con del testo, in ordine di documento: un paragrafo con le
    /// righe unite da uno spazio.
    pub texts: Vec<Excerpt>,
    /// Ogni `a` con un `href` verso il vault.
    pub links: Vec<Reference>,
    /// Ogni `image` con un percorso del vault: un riferimento d'embed. Le
    /// immagini in data URI non ci sono; il riepilogo le conta.
    pub embeds: Vec<Reference>,
}

/// Quanti oggetti modificabili ha la scena, per tipo.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub strokes: usize,
    /// Frecce, tracciati, rettangoli, ellissi, cerchi, linee, polilinee e
    /// poligoni; la carta no.
    pub shapes: usize,
    pub texts: usize,
    pub images: usize,
    pub links: usize,
    /// I blocchi estranei, anche quelli fuori dalla radice.
    pub foreign: usize,
}

/// L'inchiostro dei tratti che si leggono.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct InkTotals {
    pub samples: u64,
    /// La somma delle durate dei tratti, in millisecondi.
    pub duration: i64,
}

/// Un rettangolo in coordinate della radice, coi bordi arrotondati ai
/// centesimi con la regola di §7.
#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Gli `attrs` del `block-custom` `fub.scene.summary` (§9).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Summary {
    /// `fub:version`, se è un intero valido.
    pub version: Option<u32>,
    /// Vero per un documento senza `fub:version`.
    pub foreign: bool,
    /// Vero se il file supera il limite di §11: titolo e descrizione vengono
    /// dalla testa, e tutto il resto è vuoto.
    pub truncated: bool,
    /// I nomi dei livelli, in ordine di documento.
    pub layers: Vec<String>,
    pub counts: Counts,
    pub ink: InkTotals,
    /// Il rettangolo che contiene gli elementi modificabili visibili, dopo
    /// ogni `transform`; `None` se non ce n'è nessuno.
    pub bbox: Option<BBox>,
}

/// Quello che un contenitore modificabile trasmette ai figli.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Context {
    /// Dalle coordinate locali a quelle della radice.
    matrix: Matrix,
    /// Un antenato ha `display="none"`.
    hidden: bool,
    /// Il `fill` in vigore; `None` se la radice ne ha uno che §4 non legge.
    fill: Option<Paint>,
    /// Il `fill-opacity` in vigore, come `fill`.
    fill_opacity: Option<f64>,
    /// Il prodotto delle `opacity` dei contenitori: l'opacità di gruppo
    /// compone come una moltiplicazione.
    opacity: f64,
}

impl Context {
    /// Il contesto dei figli della radice. Della radice contano solo `fill` e
    /// `fill-opacity`, che si ereditano: le coordinate della radice sono
    /// quelle in cui si misura, e il resto vale anche per la carta.
    pub fn root(root: &Element<'_>) -> Context {
        Context {
            matrix: Matrix::IDENTITY,
            hidden: false,
            fill: root
                .value(NS_NONE, "fill")
                .map_or(Some(Paint::Color([0, 0, 0])), paint),
            fill_opacity: root
                .value(NS_NONE, "fill-opacity")
                .map_or(Some(1.0), opacity),
            opacity: 1.0,
        }
    }

    /// Il contesto di `element`, un elemento modificabile: i suoi valori
    /// rispettano già §4.
    pub fn child(&self, element: &Element<'_>) -> Context {
        let mut context = *self;
        let value = |name: &str| element.value(NS_NONE, name);
        if let Some(m) = value("transform").and_then(transform) {
            context.matrix = context.matrix.then(m);
        }
        if value("display").is_some_and(|d| trim(d) == "none") {
            context.hidden = true;
        }
        if let Some(fill) = value("fill") {
            context.fill = paint(fill);
        }
        if let Some(alpha) = value("fill-opacity") {
            context.fill_opacity = opacity(alpha);
        }
        if let Some(alpha) = value("opacity").and_then(opacity) {
            context.opacity *= alpha;
        }
        context
    }

    /// Il colore del riempimento con la sua opacità totale; `None` se non si
    /// sa o se è `none`.
    fn fill(&self) -> Option<(Rgb, f64)> {
        match (self.fill?, self.fill_opacity?) {
            (Paint::Color(rgb), alpha) => Some((rgb, alpha * self.opacity)),
            (Paint::None, _) => None,
        }
    }
}

/// Il riepilogo che si accumula durante la classificazione.
#[derive(Default)]
pub(crate) struct Tally {
    layers: Vec<String>,
    counts: Counts,
    ink: InkTotals,
    bounds: BoundsBuilder,
    /// Il colore della prima carta; dentro `None` se non si sa.
    paper: Option<Option<Rgb>>,
    /// I tratti a penna col loro colore, da confrontare con la carta alla
    /// fine: la carta può venire dopo.
    pens: Vec<(Span, (Rgb, f64))>,
}

impl Tally {
    /// Conta un blocco estraneo.
    pub fn foreign(&mut self) {
        self.counts.foreign += 1;
    }

    /// Conta un elemento modificabile. `context` è quello dell'elemento, con
    /// i suoi attributi già applicati.
    pub fn element(
        &mut self,
        doc: &Document<'_>,
        element: &Element<'_>,
        role: Role,
        context: &Context,
        span: Span,
        stroke: Option<&Stroke>,
    ) {
        match role {
            Role::Layer => self.layers.push(
                element
                    .value(NS_FUB, "layer")
                    .unwrap_or_default()
                    .to_owned(),
            ),
            Role::Paper => {
                if self.paper.is_none() {
                    self.paper = Some(paper_color(context));
                }
                return;
            }
            Role::Stroke => {
                self.counts.strokes += 1;
                if let Some(stroke) = stroke {
                    self.ink.samples += stroke.samples.unwrap_or(0) as u64;
                    let duration = stroke.duration.unwrap_or(0).max(0);
                    self.ink.duration = self.ink.duration.saturating_add(duration);
                    if stroke.tool == Tool::Pen {
                        if let Some(fill) = context.fill() {
                            self.pens.push((span, fill));
                        }
                    }
                }
            }
            Role::Arrow
            | Role::Path
            | Role::Rect
            | Role::Ellipse
            | Role::Circle
            | Role::Line
            | Role::Polyline
            | Role::Polygon => self.counts.shapes += 1,
            Role::Text => self.counts.texts += 1,
            Role::Image => self.counts.images += 1,
            Role::Link => self.counts.links += 1,
            Role::Title | Role::Desc | Role::Group => {}
        }
        if !context.hidden {
            bounds(doc, element, role, &context.matrix, &mut self.bounds);
        }
    }

    /// Chiude il conteggio: il riepilogo, più S009 per ogni tratto a penna
    /// che contrasta poco con la carta.
    pub fn finish(
        self,
        status: Status,
        version: Option<u32>,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Summary {
        // Senza carta il disegno sta sul bianco della superficie (DEC-13).
        if let Some(paper) = self.paper.unwrap_or(Some(WHITE)) {
            for (span, (rgb, alpha)) in self.pens {
                let ratio = contrast(over(rgb, alpha, paper), paper);
                if ratio < MIN_CONTRAST {
                    // Troncato, non arrotondato: 2,996 non deve leggersi «3.00».
                    let shown = (ratio * 100.0).floor() / 100.0;
                    diagnostics.push(Diagnostic::new(
                        Code::S009,
                        Some(span),
                        Some(format!("{shown:.2}")),
                    ));
                }
            }
        }
        Summary {
            version,
            foreign: status == Status::Foreign,
            truncated: false,
            layers: self.layers,
            counts: self.counts,
            ink: self.ink,
            bbox: self.bounds.finish().and_then(|b| {
                let [x1, y1, x2, y2] = [b.min[0], b.min[1], b.max[0], b.max[1]].map(hundredths);
                let bbox = BBox {
                    x: x1 / 100.0,
                    y: y1 / 100.0,
                    width: (x2 - x1) / 100.0,
                    height: (y2 - y1) / 100.0,
                };
                [bbox.x, bbox.y, bbox.width, bbox.height]
                    .iter()
                    .all(|v| v.is_finite())
                    .then_some(bbox)
            }),
        }
    }
}

/// Il riepilogo di un file troncato: della testa si sa solo chi è.
pub(crate) fn truncated_summary(status: Status, version: Option<u32>) -> Summary {
    Summary {
        version,
        foreign: status == Status::Foreign,
        truncated: true,
        layers: Vec::new(),
        counts: Counts::default(),
        ink: InkTotals::default(),
        bbox: None,
    }
}

/// `floor(v × 100 + 0,5)`: i centesimi di `v`, interi, con la regola di §7.
/// Il rettangolo li divide per 100 solo alla fine, così `width` è la
/// differenza esatta di due bordi arrotondati.
fn hundredths(v: f64) -> f64 {
    (v * 100.0 + 0.5).floor()
}

const WHITE: Rgb = [255, 255, 255];

/// Il colore della carta sul bianco della superficie; `None` se non si sa.
fn paper_color(context: &Context) -> Option<Rgb> {
    if context.hidden {
        return Some(WHITE);
    }
    match (context.fill?, context.fill_opacity?) {
        (Paint::Color(rgb), alpha) => Some(over(rgb, alpha * context.opacity, WHITE)),
        (Paint::None, _) => Some(WHITE),
    }
}

/// `rgb` con opacità `alpha` composto su `under`, in sRGB come fanno i
/// browser, arrotondato al canale intero.
fn over(rgb: Rgb, alpha: f64, under: Rgb) -> Rgb {
    let mix = |i: usize| {
        let v = alpha * f64::from(rgb[i]) + (1.0 - alpha) * f64::from(under[i]);
        v.round().clamp(0.0, 255.0) as u8
    };
    [mix(0), mix(1), mix(2)]
}

/// La luminanza relativa di WCAG, con la soglia di sRGB.
fn luminance(rgb: Rgb) -> f64 {
    let linear = |c: u8| {
        let s = f64::from(c) / 255.0;
        if s <= 0.04045 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/// Il rapporto di contrasto di WCAG fra due colori, da 1 a 21.
pub(crate) fn contrast(a: Rgb, b: Rgb) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// Una lunghezza di `element`, già validata da §4.
fn len(element: &Element<'_>, name: &str) -> Option<f64> {
    element.value(NS_NONE, name).and_then(length)
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
fn radii(element: &Element<'_>) -> [f64; 2] {
    match (len(element, "rx"), len(element, "ry")) {
        (Some(rx), Some(ry)) => [rx, ry],
        (Some(r), None) | (None, Some(r)) => [r, r],
        (None, None) => [0.0, 0.0],
    }
}

/// Aggiunge a `out` la geometria di `element` trasformata da `m`: quella che
/// `getBBox` misura, senza lo spessore del contorno.
fn bounds(
    doc: &Document<'_>,
    element: &Element<'_>,
    role: Role,
    m: &Matrix,
    out: &mut BoundsBuilder,
) {
    let at = |name: &str| len(element, name).unwrap_or(0.0);
    match role {
        Role::Stroke | Role::Arrow | Role::Path => {
            if let Some(segments) = element.value(NS_NONE, "d").and_then(parse_path) {
                out.path(&segments, m);
            }
        }
        Role::Rect => {
            let [rx, ry] = radii(element);
            let r = rect_path(at("x"), at("y"), at("width"), at("height"), rx, ry);
            out.path(&r, m);
        }
        Role::Image => {
            // Senza `width` e `height` l'immagine prende le sue dimensioni,
            // che qui non si conoscono: conta il suo angolo.
            let r = rect_path(at("x"), at("y"), at("width"), at("height"), 0.0, 0.0);
            out.path(&r, m);
        }
        Role::Ellipse => out.ellipse([at("cx"), at("cy")], radii(element), m),
        Role::Circle => out.ellipse([at("cx"), at("cy")], [at("r"), at("r")], m),
        Role::Line => {
            out.include(m.apply([at("x1"), at("y1")]));
            out.include(m.apply([at("x2"), at("y2")]));
        }
        Role::Polyline | Role::Polygon => {
            for p in element
                .value(NS_NONE, "points")
                .and_then(points)
                .unwrap_or_default()
            {
                out.include(m.apply(p));
            }
        }
        Role::Text => {
            // L'ingombro di un testo dipende dai caratteri, che qui non ci
            // sono: contano i punti d'inizio delle righe, un `tspan` per riga.
            let x = at("x");
            let mut y = at("y");
            out.include(m.apply([x, y]));
            for &child in &element.children {
                let Some(tspan) = doc.element(child).filter(|e| e.is_svg("tspan")) else {
                    continue;
                };
                y += len(tspan, "dy").unwrap_or(0.0);
                out.include(m.apply([len(tspan, "x").unwrap_or(x), y]));
            }
        }
        Role::Title | Role::Desc | Role::Paper | Role::Layer | Role::Group | Role::Link => {}
    }
}

/// Vero per gli elementi SVG che dentro un testo non si disegnano: i
/// metadati e un `text` annidato. Le loro parole non sono del paragrafo.
fn unrendered(element: &Element<'_>) -> bool {
    element.ns == NS_SVG && matches!(element.local, "title" | "desc" | "metadata" | "text")
}

/// Accoda a `out` il testo di `id` e dei suoi discendenti, in ordine:
/// dati di carattere, CDATA e le entità che sono testo semplice. Una pila,
/// non la ricorsione: un `tspan` può annidarne centomila.
fn text_content(doc: &Document<'_>, id: NodeId, out: &mut String) {
    let mut stack = vec![(id, 0)];
    while let Some((node, next)) = stack.last_mut() {
        let children = doc.children(*node);
        let Some(&child) = children.get(*next) else {
            stack.pop();
            continue;
        };
        *next += 1;
        match &doc.nodes[child].kind {
            Kind::Text { value, .. } => out.push_str(value),
            Kind::CData(value) => out.push_str(value),
            Kind::EntityRef(name) => out.push_str(doc.plain_entity(name).unwrap_or_default()),
            Kind::Element(element) if !unrendered(element) => stack.push((child, 0)),
            _ => {}
        }
    }
}

/// Riduce ogni sequenza di spazi XML a uno spazio e toglie quelli ai bordi.
fn collapse(text: &str) -> String {
    text.split([' ', '\t', '\n', '\r'])
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Il paragrafo di un `text`: ogni figlio elemento è una riga, come i
/// `tspan` di FubDraw e di Inkscape, e i dati di carattere fra due figli ne
/// sono un'altra. Le righe si uniscono con uno spazio.
fn paragraph(doc: &Document<'_>, id: NodeId) -> String {
    let mut lines = Vec::new();
    let mut run = String::new();
    for &child in doc.children(id) {
        match &doc.nodes[child].kind {
            Kind::Text { value, .. } => run.push_str(value),
            Kind::CData(value) => run.push_str(value),
            Kind::EntityRef(name) => run.push_str(doc.plain_entity(name).unwrap_or_default()),
            Kind::Element(element) if !unrendered(element) => {
                lines.push(collapse(&run));
                run.clear();
                let mut line = String::new();
                text_content(doc, child, &mut line);
                lines.push(collapse(&line));
            }
            _ => {}
        }
    }
    lines.push(collapse(&run));
    lines.retain(|line| !line.is_empty());
    lines.join(" ")
}

/// L'`href` di un elemento: in SVG 2 `href` vince su `xlink:href`.
fn href_attr<'e, 'a>(element: &'e Element<'a>) -> Option<&'e crate::xml::Attr<'a>> {
    element
        .attr(NS_NONE, "href")
        .or_else(|| element.attr(NS_XLINK, "href"))
}

/// Il contenuto attivo di un elemento (S005): il nome del motivo per ognuno.
fn active_content(element: &Element<'_>) -> Vec<String> {
    let mut found = Vec::new();
    if element.local == "script" && matches!(element.ns, NS_SVG | NS_XHTML) {
        found.push("script".to_owned());
    }
    // Un'animazione che porta `href` su `javascript:` vale l'`href` stesso.
    let animates_href = element.ns == NS_SVG
        && matches!(element.local, "set" | "animate")
        && element
            .value(NS_NONE, "attributeName")
            .is_some_and(|name| matches!(trim(name), "href" | "xlink:href"));
    for attr in &element.attrs {
        let handler = attr.ns == NS_NONE
            && attr.local.len() > 2
            && attr.local.as_bytes()[..2].eq_ignore_ascii_case(b"on");
        let javascript = match (attr.ns, attr.local) {
            (NS_NONE | NS_XLINK, "href") => is_javascript(&attr.value),
            (NS_NONE, "to" | "from" | "by") if animates_href => is_javascript(&attr.value),
            (NS_NONE, "values") if animates_href => attr.value.split(';').any(is_javascript),
            _ => false,
        };
        if handler || javascript {
            found.push(attr.name.to_owned());
        }
    }
    found
}

/// Legge l'indice del documento, con S001, S005 e S006.
pub(crate) fn index(
    doc: &Document<'_>,
    map: &Utf16Map<'_>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Index {
    let mut index = Index::default();
    let span = |id: NodeId| map.span(doc.nodes[id].start, doc.nodes[id].end);
    let excerpt = |id: NodeId| {
        let mut text = String::new();
        text_content(doc, id, &mut text);
        Excerpt {
            text: collapse(&text),
            span: span(id),
        }
    };

    // Il titolo e la descrizione: i primi figli della radice con quel nome.
    let first = |local: &str| {
        doc.children(doc.root)
            .iter()
            .copied()
            .find(|&child| doc.element(child).is_some_and(|e| e.is_svg(local)))
    };
    let title = first("title").map(excerpt);
    match &title {
        Some(title) if !title.text.is_empty() => {}
        // Un titolo vuoto non descrive niente: S001 lo indica.
        _ => diagnostics.push(Diagnostic::new(
            Code::S001,
            title.as_ref().map(|t| t.span),
            None,
        )),
    }
    index.title = title.filter(|t| !t.text.is_empty());
    index.desc = first("desc").map(excerpt).filter(|d| !d.text.is_empty());

    // Il resto in ordine di documento, che è l'ordine dell'arena. Un `text`
    // dentro un altro non si disegna: `inside` è la fine dell'ultimo letto.
    let mut inside = 0;
    for (id, node) in doc.nodes.iter().enumerate() {
        let Kind::Element(element) = &node.kind else {
            continue;
        };
        for reason in active_content(element) {
            diagnostics.push(Diagnostic::new(Code::S005, Some(span(id)), Some(reason)));
        }
        if element.ns != NS_SVG {
            continue;
        }
        match element.local {
            "text" if node.start >= inside => {
                inside = node.end;
                let text = paragraph(doc, id);
                if !text.is_empty() {
                    index.texts.push(Excerpt {
                        text,
                        span: span(id),
                    });
                }
            }
            "a" | "image" => {
                let Some(attr) = href_attr(element) else {
                    continue;
                };
                let reference = |path: String| Reference {
                    path,
                    span: span(id),
                    href: map.span(attr.raw.0, attr.raw.1),
                };
                match (element.local, href(&attr.value)) {
                    ("a", Href::Vault(path)) => index.links.push(reference(path)),
                    ("image", Href::Vault(path)) => index.embeds.push(reference(path)),
                    ("image", Href::Data { bytes, .. }) if bytes > MAX_IMAGE_BYTES => {
                        diagnostics.push(Diagnostic::new(
                            Code::S006,
                            Some(span(id)),
                            Some(bytes.to_string()),
                        ));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: u32) -> Rgb {
        [(value >> 16) as u8, (value >> 8) as u8, value as u8]
    }

    #[test]
    fn contrast_follows_wcag() {
        assert_eq!(contrast(WHITE, [0, 0, 0]), 21.0);
        assert_eq!(contrast(WHITE, WHITE), 1.0);
        // La tavolozza di DEC-13 sulla carta bianca: tre colori sotto 3:1.
        let ratio = |rgb: u32| contrast(hex(rgb), WHITE);
        for below in [0xf0e442, 0xe69f00, 0x56b4e9] {
            assert!(ratio(below) < MIN_CONTRAST, "{below:06x}");
        }
        for above in [0x000000, 0x0072b2, 0x009e73, 0xd55e00, 0xcc79a7] {
            assert!(ratio(above) >= MIN_CONTRAST, "{above:06x}");
        }
    }

    #[test]
    fn opacity_composites_over_the_paper() {
        assert_eq!(over([0, 0, 0], 0.5, WHITE), [128, 128, 128]);
        assert_eq!(over([0, 0, 0], 0.0, WHITE), WHITE);
        assert_eq!(over([10, 20, 30], 1.0, WHITE), [10, 20, 30]);
    }

    #[test]
    fn text_collapses_like_svg() {
        assert_eq!(collapse("  a \t b\n\nc  "), "a b c");
        assert_eq!(collapse(" \n "), "");
        // Lo spazio indivisibile non è uno spazio XML.
        assert_eq!(collapse("a\u{a0}b"), "a\u{a0}b");
    }

    #[test]
    fn bbox_edges_round_with_the_rule_of_section_7() {
        // La metà va verso +∞, anche sotto zero.
        assert_eq!(hundredths(0.125), 13.0);
        assert_eq!(hundredths(-0.125), -12.0);
        // In doppia precisione 1,005 × 100 vale 100,4999…: come in §7.
        assert_eq!(hundredths(1.005), 100.0);
    }
}
