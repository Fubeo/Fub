//! L'analisi della scena per l'indice (§9) e i controlli di §12 che non
//! dipendono dalla classificazione.
//!
//! Due parti. [`index`] legge il documento intero, modificabile o estraneo:
//! titolo, descrizione, testi, collegamenti e immagini del vault, con gli
//! span; un disegno di Inkscape si cerca per i suoi testi anche se FubDraw
//! non li modifica. Trova anche S001, S005 e S006. [`Tally`] invece segue la
//! classificazione, che gli passa ogni elemento modificabile con il contesto
//! ereditato dai contenitori: ne escono il riepilogo di `fub.scene.summary` e,
//! con [`Legibility`], i controlli su come il disegno si legge (S009, S012,
//! S013), che riguardano la scena come la modifica FubDraw.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::accessibility::Legibility;
use crate::classify::{board_box, Role, Stroke};
use crate::diagnostics::{Code, Diagnostic};
use crate::geometry::{parse_path, rect_path, Bounds, BoundsBuilder, Matrix};
use crate::text::{Span, Utf16Map};
use crate::values::{
    href, href_id, is_javascript, keyword, length, non_negative_length, opacity, paint,
    paint_reference, points, transform, trim, url_text, wrap_width, Href, Paint, Rgb,
};
use crate::xml::{Document, Element, Kind, NodeId, NS_FUB, NS_NONE, NS_SVG, NS_XHTML, NS_XLINK};
use crate::Status;

/// Quanti byte decodificati può avere un'immagine incorporata (§11).
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// Il contrasto minimo fra un tratto, o un testo grande, e ciò che ha sotto
/// (§12).
pub const MIN_CONTRAST: f64 = 3.0;

/// Il contrasto minimo fra un testo e ciò che ha sotto (§12).
pub const MIN_TEXT_CONTRAST: f64 = 4.5;

/// Da quanti pixel a grandezza naturale un testo è grande, e gli basta
/// [`MIN_CONTRAST`]: 18 punti, come in WCAG.
pub const LARGE_TEXT: f64 = 24.0;

/// Da quanti pixel un testo in grassetto è grande: 14 punti.
pub const LARGE_BOLD_TEXT: f64 = 14.0 * 96.0 / 72.0;

/// La grandezza minima di un testo a grandezza naturale, in pixel (§12).
pub const MIN_TEXT_SIZE: f64 = 12.0;

/// La grandezza di un testo che non la dice, come nei browser.
pub(crate) const DEFAULT_FONT_SIZE: f64 = 16.0;

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
    /// Il valore grezzo di un `xlink:href` che `href` nasconde sullo stesso
    /// elemento, quando porta lo stesso URL. Un lettore SVG 1.1 legge quello,
    /// quindi chi rinomina la destinazione riscrive tutti e due. Non si
    /// serializza: la superficie non riscrive collegamenti.
    #[serde(skip)]
    pub shadowed: Option<Span>,
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
    /// Le tavole modificabili, in ordine, ciascuna col suo nome sullo span del
    /// suo `view` (formato della scena, tavole).
    pub boards: Vec<Excerpt>,
}

/// Quanti oggetti modificabili ha la scena, per tipo.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub strokes: usize,
    /// Frecce, connettori, poligoni regolari, stelle, tracciati, rettangoli,
    /// ellissi, cerchi, linee, polilinee e poligoni; la carta no.
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
    /// I nomi delle tavole, in ordine (formato della scena, tavole).
    pub boards: Vec<String>,
    pub counts: Counts,
    pub ink: InkTotals,
    /// Il rettangolo che contiene gli elementi modificabili visibili, dopo
    /// ogni `transform`; `None` se non ce n'è nessuno.
    pub bbox: Option<BBox>,
}

/// I campioni del documento, per id: il colore di ciascuno (formato della
/// scena, risorse).
pub(crate) type Swatches = HashMap<String, Rgb>;

/// Quello che un contenitore modificabile trasmette ai figli.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Context<'s> {
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
    /// Il `font-size` in vigore, in unità utente; `None` se la radice ne ha
    /// uno che §4 non legge.
    font_size: Option<f64>,
    /// Il `font-weight` in vigore è da grassetto: `bold` o da 700 in su.
    bold: bool,
    /// Un antenato, o l'elemento, ha un ritaglio, una maschera o un filtro
    /// (formato della scena, risorse): i colori che si vedono non si sanno.
    effect: bool,
    /// I campioni del documento, che danno il colore a chi li usa.
    swatches: &'s Swatches,
    /// Il simbolo di cui l'elemento è il contenuto, nelle sue coordinate;
    /// `None` fuori dai simboli (formato della scena, simboli).
    symbol: Option<NodeId>,
    /// Dove si conta il riquadro dell'elemento: il simbolo o l'originale di
    /// una ripetizione più vicini che lo contengono, o lui stesso; `None`
    /// fuori da entrambi.
    scope: Option<NodeId>,
    /// Dalle coordinate del contenitore a quelle della radice: la matrice
    /// prima della `transform` dell'elemento.
    outer: Matrix,
}

/// Gli attributi che cambiano ciò che si vede di un elemento oltre il suo
/// colore (formato della scena, risorse).
const EFFECTS: [&str; 3] = ["clip-path", "mask", "filter"];

impl<'s> Context<'s> {
    /// Il contesto dei figli della radice. Della radice contano solo `fill` e
    /// `fill-opacity`, che si ereditano: le coordinate della radice sono
    /// quelle in cui si misura, e il resto vale anche per la carta.
    pub fn root(root: &Element<'_>, swatches: &'s Swatches) -> Context<'s> {
        Context {
            matrix: Matrix::IDENTITY,
            hidden: false,
            fill: root
                .value(NS_NONE, "fill")
                .map_or(Some(Paint::Color([0, 0, 0])), |fill| {
                    fill_value(fill, swatches)
                }),
            fill_opacity: root
                .value(NS_NONE, "fill-opacity")
                .map_or(Some(1.0), opacity),
            opacity: 1.0,
            font_size: root
                .value(NS_NONE, "font-size")
                .map_or(Some(DEFAULT_FONT_SIZE), non_negative_length),
            bold: root.value(NS_NONE, "font-weight").is_some_and(bold),
            effect: false,
            swatches,
            symbol: None,
            scope: None,
            outer: Matrix::IDENTITY,
        }
    }

    /// Il contesto di `element`, un elemento modificabile: i suoi valori
    /// rispettano già §4.
    pub fn child(&self, element: &Element<'_>) -> Context<'s> {
        let mut context = *self;
        context.outer = self.matrix;
        let value = |name: &str| element.value(NS_NONE, name);
        if let Some(m) = value("transform").and_then(transform) {
            context.matrix = context.matrix.then(m);
        }
        if value("display").is_some_and(|d| trim(d) == "none") {
            context.hidden = true;
        }
        if let Some(fill) = value("fill") {
            context.fill = fill_value(fill, self.swatches);
        }
        if let Some(alpha) = value("fill-opacity") {
            context.fill_opacity = opacity(alpha);
        }
        if let Some(alpha) = value("opacity").and_then(opacity) {
            context.opacity *= alpha;
        }
        if let Some(size) = value("font-size") {
            context.font_size = non_negative_length(size);
        }
        if let Some(weight) = value("font-weight") {
            context.bold = bold(weight);
        }
        if EFFECTS
            .iter()
            .any(|&name| value(name).is_some_and(|used| trim(used) != "none"))
        {
            context.effect = true;
        }
        context
    }

    /// Il contesto di una riga di `text`, un `tspan`: come [`Context::child`],
    /// ma senza `transform`, che SVG non applica a un `tspan`.
    pub fn line(&self, tspan: &Element<'_>) -> Context<'s> {
        Context {
            matrix: self.matrix,
            outer: self.outer,
            ..self.child(tspan)
        }
    }

    /// Il contesto del contenuto del simbolo `symbol`, che ha questo: le sue
    /// coordinate sono quelle del simbolo.
    pub fn within(&self, symbol: NodeId) -> Context<'s> {
        Context {
            symbol: Some(symbol),
            scope: Some(symbol),
            ..*self
        }
    }

    /// Il contesto dell'originale `original` di una ripetizione, che ha
    /// questo: il suo riquadro e quello di ciò che contiene si contano a
    /// parte, perché le copie lo portano dove stanno (formato della scena,
    /// ripetizioni).
    pub fn original(&self, original: NodeId) -> Context<'s> {
        Context {
            scope: Some(original),
            ..*self
        }
    }

    pub fn matrix(&self) -> &Matrix {
        &self.matrix
    }

    pub fn symbol(&self) -> Option<NodeId> {
        self.symbol
    }

    pub fn hidden(&self) -> bool {
        self.hidden
    }

    pub fn font_size(&self) -> Option<f64> {
        self.font_size
    }

    pub fn bold(&self) -> bool {
        self.bold
    }

    /// Il colore del riempimento con la sua opacità totale; `None` se non si
    /// sa o se è `none`.
    pub fn fill(&self) -> Option<(Rgb, f64)> {
        self.fill_paint().flatten()
    }

    /// Il riempimento in vigore, distinguendo ciò che non si sa: `None` se
    /// non si sa, `Some(None)` se è `none`.
    pub fn fill_paint(&self) -> Option<Option<(Rgb, f64)>> {
        if self.effect {
            return None;
        }
        match (self.fill?, self.fill_opacity?) {
            (Paint::Color(rgb), alpha) => Some(Some((rgb, alpha * self.opacity))),
            (Paint::None, _) => Some(None),
        }
    }
}

/// Una tavola com'è scritta (formato della scena, tavole).
struct Board {
    id: String,
    name: String,
    rect: [f64; 4],
    span: Span,
}

/// Una carta: `board` è la sua tavola, `fub:board`, e `rect` la sua
/// geometria.
struct Paper {
    id: Option<String>,
    board: Option<String>,
    rect: [f64; 4],
    span: Span,
}

/// Il nome di una tavola: il testo del suo primo `title`, con gli spazi
/// ridotti come li disegna SVG; senza, o vuoto, il suo id (formato della
/// scena, tavole).
pub(crate) fn board_name(doc: &Document<'_>, element: &Element<'_>) -> String {
    let title = element
        .children
        .iter()
        .copied()
        .find(|&child| doc.element(child).is_some_and(|e| e.is_svg("title")));
    if let Some(title) = title {
        let mut text = String::new();
        text_content(doc, title, &mut text);
        let name = collapse(&text);
        if !name.is_empty() {
            return name;
        }
    }
    element.value(NS_NONE, "id").unwrap_or_default().to_owned()
}

/// L'id a cui rimanda un `use`: in SVG 2 `href` vince su `xlink:href`.
pub(crate) fn use_target(element: &Element<'_>) -> Option<String> {
    element
        .value(NS_NONE, "href")
        .or_else(|| element.value(NS_XLINK, "href"))
        .and_then(href_id)
}

/// Ciò che si conta di un simbolo, o dell'originale di una ripetizione: il
/// riquadro del suo contenuto, nelle coordinate del simbolo o in quelle dove
/// sta l'originale, e ciò che vi si vede attraverso altri, istanze, copie e
/// originali, con l'id e la matrice.
#[derive(Default)]
struct ScopeTally {
    bounds: BoundsBuilder,
    instances: Vec<(String, Matrix)>,
}

/// Aggiunge a `out` i quattro angoli di `bounds` trasformati da `m`.
fn include_box(out: &mut BoundsBuilder, bounds: Option<Bounds>, m: &Matrix) {
    let Some(b) = bounds else {
        return;
    };
    out.include(m.apply([b.min[0], b.min[1]]));
    out.include(m.apply([b.max[0], b.min[1]]));
    out.include(m.apply([b.max[0], b.max[1]]));
    out.include(m.apply([b.min[0], b.max[1]]));
}

/// Il riepilogo che si accumula durante la classificazione.
#[derive(Default)]
pub(crate) struct Tally {
    layers: Vec<String>,
    /// Le tavole e le carte, in ordine di documento.
    boards: Vec<Board>,
    papers: Vec<Paper>,
    counts: Counts,
    ink: InkTotals,
    bounds: BoundsBuilder,
    /// Il colore della prima carta; dentro `None` se non si sa.
    paper: Option<Option<Rgb>>,
    /// I controlli su come il disegno si legge, da chiudere alla fine: la
    /// carta può venire dopo.
    legibility: Legibility,
    /// Il `d` dei tracciati delle risorse, per id: il riquadro di un testo su
    /// tracciato è quello del tracciato (formato della scena, testo).
    paths: HashMap<String, String>,
    /// Per ogni simbolo, il riquadro del suo contenuto nelle sue coordinate e
    /// le istanze che contiene; il riquadro di un'istanza si sa alla fine,
    /// quando si sa quello del suo simbolo (formato della scena, simboli). Lo
    /// stesso per ogni originale di una ripetizione, che le copie portano
    /// dove stanno (formato della scena, ripetizioni).
    scopes: HashMap<String, ScopeTally>,
    /// Ciò che si vede attraverso altri fuori dai simboli e dagli originali:
    /// le istanze, le copie e gli originali, con l'id e la matrice.
    instances: Vec<(String, Matrix)>,
}

impl Tally {
    /// Un conteggio coi tracciati delle risorse `paths`.
    pub fn new(paths: HashMap<String, String>) -> Tally {
        Tally {
            paths,
            ..Tally::default()
        }
    }

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
        context: &Context<'_>,
        span: Span,
        stroke: Option<&Stroke>,
    ) {
        match role {
            // Le risorse e i simboli non si disegnano da soli: contano gli
            // oggetti che li usano (formato della scena, risorse e simboli).
            Role::Defs | Role::Resource | Role::Symbol => return,
            // Un'istanza ha il riquadro del suo simbolo, che si sa alla fine;
            // il contenuto del simbolo si conta e si controlla una volta sola.
            Role::Instance => {
                if context.hidden {
                    return;
                }
                let target = use_target(element).expect("un'istanza ha il suo simbolo");
                if context.symbol.is_none() {
                    self.legibility
                        .instance(target.clone(), context.matrix, span);
                }
                self.instances_of(scope_id(doc, context))
                    .push((target, context.matrix));
                return;
            }
            // Una copia ha il riquadro del suo originale, portato dalla sua
            // `transform` nelle coordinate del gruppo, e non si conta da sé: è
            // l'originale un'altra volta (formato della scena, ripetizioni).
            Role::Copy => {
                let Some(back) = context.outer.invert().filter(|_| !context.hidden) else {
                    return;
                };
                let original = use_target(element).expect("una copia ha il suo originale");
                let m = context.matrix.then(back);
                if context.symbol.is_none() {
                    self.legibility.instance(original.clone(), m, span);
                }
                self.instances_of(scope_id(doc, context))
                    .push((original, m));
                return;
            }
            Role::Layer => self.layers.push(
                element
                    .value(NS_FUB, "layer")
                    .unwrap_or_default()
                    .to_owned(),
            ),
            Role::Board => {
                self.boards.push(Board {
                    id: element.value(NS_NONE, "id").unwrap_or_default().to_owned(),
                    name: board_name(doc, element),
                    rect: board_box(element).expect("una tavola ha il suo rettangolo"),
                    span,
                });
                return;
            }
            Role::Paper => {
                if self.paper.is_none() {
                    self.paper = Some(paper_color(context));
                }
                let at = |name: &str| len(element, name).unwrap_or(0.0);
                self.papers.push(Paper {
                    id: element.value(NS_NONE, "id").map(str::to_owned),
                    board: element.value(NS_FUB, "board").map(str::to_owned),
                    rect: [at("x"), at("y"), at("width"), at("height")],
                    span,
                });
                return;
            }
            Role::Stroke => {
                self.counts.strokes += 1;
                if let Some(stroke) = stroke {
                    self.ink.samples += stroke.samples.unwrap_or(0) as u64;
                    let duration = stroke.duration.unwrap_or(0).max(0);
                    self.ink.duration = self.ink.duration.saturating_add(duration);
                }
            }
            Role::Arrow
            | Role::Connector
            | Role::Ngon
            | Role::Star
            | Role::Width
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
            let out = match scope_id(doc, context) {
                Some(scope) => &mut self.scopes.entry(scope).or_default().bounds,
                None => &mut self.bounds,
            };
            bounds(doc, element, role, &context.matrix, out, &self.paths);
            self.legibility
                .element(doc, element, role, context, span, stroke, &self.paths);
        }
    }

    /// Conta l'originale `id` di una ripetizione, che sta nel gruppo di
    /// contesto `group`: si vede dov'è, col riquadro che si sa alla fine.
    pub fn original(&mut self, doc: &Document<'_>, group: &Context<'_>, id: &str) {
        self.instances_of(scope_id(doc, group))
            .push((id.to_owned(), Matrix::IDENTITY));
    }

    /// Ciò che si vede attraverso altri nel simbolo o nell'originale `scope`,
    /// o fuori da entrambi con `None`.
    fn instances_of(&mut self, scope: Option<String>) -> &mut Vec<(String, Matrix)> {
        match scope {
            Some(scope) => &mut self.scopes.entry(scope).or_default().instances,
            None => &mut self.instances,
        }
    }

    /// Il riquadro del contenuto di ogni simbolo e di ogni originale che il
    /// documento conta, nelle sue coordinate, con quello di ciò che vi si vede
    /// attraverso altri: dai più interni, senza ricorsione.
    fn scope_boxes(scopes: HashMap<String, ScopeTally>) -> HashMap<String, Option<Bounds>> {
        let mut boxes: HashMap<String, Option<Bounds>> = HashMap::new();
        let mut entered: HashSet<&str> = HashSet::new();
        for start in scopes.keys() {
            let mut stack: Vec<(&str, bool)> = vec![(start, false)];
            while let Some((id, ready)) = stack.pop() {
                if boxes.contains_key(id) {
                    continue;
                }
                let Some(tally) = scopes.get(id) else {
                    boxes.insert(id.to_owned(), None);
                    continue;
                };
                if !ready {
                    if !entered.insert(id) {
                        continue;
                    }
                    stack.push((id, true));
                    for (inner, _) in &tally.instances {
                        if !boxes.contains_key(inner.as_str()) && !entered.contains(inner.as_str())
                        {
                            stack.push((inner, false));
                        }
                    }
                    continue;
                }
                let mut out = BoundsBuilder::default();
                include_box(&mut out, tally.bounds.clone().finish(), &Matrix::IDENTITY);
                for (inner, m) in &tally.instances {
                    include_box(&mut out, boxes.get(inner.as_str()).copied().flatten(), m);
                }
                boxes.insert(id.to_owned(), out.finish());
            }
        }
        boxes
    }

    /// Le tavole, in ordine, col loro nome sullo span del `view`: le sezioni
    /// del disegno (formato della scena, tavole).
    pub fn boards(&self) -> Vec<Excerpt> {
        self.boards
            .iter()
            .map(|board| Excerpt {
                text: board.name.clone(),
                span: board.span,
            })
            .collect()
    }

    /// S015: le carte che non vanno con la loro tavola (formato della scena,
    /// tavole).
    fn check_papers(&self, diagnostics: &mut Vec<Diagnostic>) {
        let mut boards: HashMap<&str, &Board> = HashMap::new();
        for board in &self.boards {
            boards.entry(board.id.as_str()).or_insert(board);
        }
        let mut owned: HashSet<&str> = HashSet::new();
        for paper in &self.papers {
            let reason = match paper.board.as_deref() {
                None => (!self.boards.is_empty()).then_some("free"),
                Some(id) => match boards.get(id) {
                    None => Some("board"),
                    Some(_) if !owned.insert(id) => Some("second"),
                    Some(board) => (paper.rect != board.rect).then_some("geometry"),
                },
            };
            if let Some(reason) = reason {
                let detail = match &paper.id {
                    Some(id) => format!("{id} {reason}"),
                    None => reason.to_owned(),
                };
                diagnostics.push(Diagnostic::new(Code::S015, Some(paper.span), Some(detail)));
            }
        }
    }

    /// Chiude il conteggio: il riepilogo, più i controlli su come il disegno
    /// si legge.
    pub fn finish(
        self,
        status: Status,
        version: Option<u32>,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Summary {
        self.check_papers(diagnostics);
        // Il riquadro di un'istanza è quello del suo simbolo, e quello di una
        // copia quello del suo originale, che si sanno adesso.
        let boxes = if self.instances.is_empty() {
            HashMap::new()
        } else {
            Tally::scope_boxes(self.scopes)
        };
        // Senza carta il disegno sta sul bianco della superficie (§12).
        self.legibility
            .finish(self.paper.unwrap_or(Some(WHITE)), &boxes, diagnostics);
        let mut bounds = self.bounds;
        for (symbol, m) in &self.instances {
            include_box(&mut bounds, boxes.get(symbol).copied().flatten(), m);
        }
        Summary {
            version,
            foreign: status == Status::Foreign,
            truncated: false,
            layers: self.layers,
            boards: self.boards.into_iter().map(|board| board.name).collect(),
            counts: self.counts,
            ink: self.ink,
            bbox: bounds.finish().and_then(|b| {
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

/// L'id del simbolo o dell'originale dove si conta il riquadro di un
/// elemento col contesto `context`, o `None` fuori da entrambi.
fn scope_id(doc: &Document<'_>, context: &Context<'_>) -> Option<String> {
    let scope = doc.element(context.scope?)?;
    scope.value(NS_NONE, "id").map(str::to_owned)
}

/// Il riepilogo di un file troncato: della testa si sa solo chi è.
pub(crate) fn truncated_summary(status: Status, version: Option<u32>) -> Summary {
    Summary {
        version,
        foreign: status == Status::Foreign,
        truncated: true,
        layers: Vec::new(),
        boards: Vec::new(),
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

pub(crate) const WHITE: Rgb = [255, 255, 255];

/// Vero per un `font-weight` da grassetto: `bold` o da 700 in su.
fn bold(weight: &str) -> bool {
    keyword("font-weight", weight) && matches!(trim(weight), "bold" | "700" | "800" | "900")
}

/// Un `fill` come lo legge §4. Un campione del documento vale il suo
/// colore, quale che sia il ripiego scritto accanto: è il colore che si vede
/// (formato della scena, risorse). Le altre risorse non si sanno.
fn fill_value(value: &str, swatches: &Swatches) -> Option<Paint> {
    match paint_reference(value) {
        Some(used) => swatches.get(used.id).map(|&rgb| Paint::Color(rgb)),
        None => paint(value),
    }
}

/// Il colore della carta sul bianco della superficie; `None` se non si sa.
fn paper_color(context: &Context<'_>) -> Option<Rgb> {
    if context.hidden {
        return Some(WHITE);
    }
    if context.effect {
        return None;
    }
    match (context.fill?, context.fill_opacity?) {
        (Paint::Color(rgb), alpha) => Some(over(rgb, alpha * context.opacity, WHITE)),
        (Paint::None, _) => Some(WHITE),
    }
}

/// `rgb` con opacità `alpha` composto su `under`, in sRGB come fanno i
/// browser, arrotondato al canale intero.
pub(crate) fn over(rgb: Rgb, alpha: f64, under: Rgb) -> Rgb {
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
pub(crate) fn len(element: &Element<'_>, name: &str) -> Option<f64> {
    element.value(NS_NONE, name).and_then(length)
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
pub(crate) fn radii(element: &Element<'_>) -> [f64; 2] {
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
    paths: &HashMap<String, String>,
) {
    let at = |name: &str| len(element, name).unwrap_or(0.0);
    match role {
        Role::Stroke
        | Role::Arrow
        | Role::Connector
        | Role::Ngon
        | Role::Star
        | Role::Width
        | Role::Path => {
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
            // sono: contano i punti d'inizio delle righe, un `tspan` per riga,
            // o i punti estremi del tracciato che il testo segue.
            if let Some(d) = followed(doc, element, paths) {
                if let Some(segments) = parse_path(d) {
                    out.path(&segments, m);
                }
                return;
            }
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
        Role::Title
        | Role::Desc
        | Role::Paper
        | Role::Layer
        | Role::Group
        | Role::Link
        | Role::Defs
        | Role::Resource
        | Role::Board
        | Role::Symbol
        | Role::Instance
        | Role::Copy => {}
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
pub(crate) fn text_content(doc: &Document<'_>, id: NodeId, out: &mut String) {
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
pub(crate) fn collapse(text: &str) -> String {
    text.split([' ', '\t', '\n', '\r'])
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Il `d` del tracciato che un testo segue, fra quelli di `paths`; `None`
/// per un testo con le righe.
pub(crate) fn followed<'p>(
    doc: &Document<'_>,
    element: &Element<'_>,
    paths: &'p HashMap<String, String>,
) -> Option<&'p str> {
    let text_path = element
        .children
        .iter()
        .find_map(|&child| doc.element(child).filter(|e| e.is_svg("textPath")))?;
    let id = href_attr(text_path).and_then(|attr| href_id(&attr.value))?;
    paths.get(&id).map(String::as_str)
}

/// Il paragrafo di un `text`: ogni figlio elemento è una riga, come i
/// `tspan` di FubDraw e di Inkscape, e i dati di carattere fra due figli ne
/// sono un'altra. Le righe si uniscono con uno spazio, tranne in un testo in
/// area quelle che continuano una parola dopo la prima, con
/// `fub:join="word"`, che si uniscono senza (formato della scena, testo).
pub(crate) fn paragraph(doc: &Document<'_>, id: NodeId) -> String {
    let area = doc
        .element(id)
        .and_then(|text| text.value(NS_FUB, "wrap"))
        .and_then(wrap_width)
        .is_some();
    // Le righe, e se ognuna continua una parola.
    let mut lines = Vec::new();
    let mut run = String::new();
    let mut first = true;
    for &child in doc.children(id) {
        match &doc.nodes[child].kind {
            Kind::Text { value, .. } => run.push_str(value),
            Kind::CData(value) => run.push_str(value),
            Kind::EntityRef(name) => run.push_str(doc.plain_entity(name).unwrap_or_default()),
            Kind::Element(element) if !unrendered(element) => {
                lines.push((collapse(&run), false));
                run.clear();
                let mut line = String::new();
                text_content(doc, child, &mut line);
                let word = area
                    && !first
                    && element.is_svg("tspan")
                    && element.value(NS_FUB, "join") == Some("word");
                lines.push((collapse(&line), word));
                first = false;
            }
            _ => {}
        }
    }
    lines.push((collapse(&run), false));
    let mut out = String::new();
    for (line, word) in lines {
        if line.is_empty() {
            continue;
        }
        if !out.is_empty() && !word {
            out.push(' ');
        }
        out.push_str(&line);
    }
    out
}

/// L'`href` di un elemento: in SVG 2 `href` vince su `xlink:href`.
fn href_attr<'e, 'a>(element: &'e Element<'a>) -> Option<&'e crate::xml::Attr<'a>> {
    element
        .attr(NS_NONE, "href")
        .or_else(|| element.attr(NS_XLINK, "href"))
}

/// L'`xlink:href` che l'`href` scelto da [`href_attr`] nasconde, se dice lo
/// stesso URL. Con due URL diversi quello nascosto non è un riferimento del
/// documento, e chi rinomina non lo tocca.
fn shadowed_xlink<'e, 'a>(
    element: &'e Element<'a>,
    href: &crate::xml::Attr<'a>,
) -> Option<&'e crate::xml::Attr<'a>> {
    if href.ns != NS_NONE {
        return None;
    }
    element
        .attr(NS_XLINK, "href")
        .filter(|xlink| url_text(&xlink.value) == url_text(&href.value))
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

/// Legge l'indice del documento, con S001, S005, S006 e S016. `boards` sono
/// le tavole che la classificazione ha trovato (formato della scena,
/// tavole).
pub(crate) fn index(
    doc: &Document<'_>,
    map: &Utf16Map<'_>,
    diagnostics: &mut Vec<Diagnostic>,
    boards: Vec<Excerpt>,
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
                let shadowed =
                    shadowed_xlink(element, attr).map(|xlink| map.span(xlink.raw.0, xlink.raw.1));
                let reference = |path: String| Reference {
                    path,
                    span: span(id),
                    href: map.span(attr.raw.0, attr.raw.1),
                    shadowed,
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
    // Un nome già del disegno o di una tavola prima: `#nome` mostra quella
    // (S016).
    let mut names: HashSet<&str> = index.title.iter().map(|t| t.text.as_str()).collect();
    for board in &boards {
        if !names.insert(board.text.as_str()) {
            diagnostics.push(Diagnostic::new(
                Code::S016,
                Some(board.span),
                Some(board.text.clone()),
            ));
        }
    }
    index.boards = boards;
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
        // La tavolozza Okabe–Ito di FubDraw sulla carta bianca: tre colori
        // sotto 3:1.
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
