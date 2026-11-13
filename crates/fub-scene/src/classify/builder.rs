//! La visita: l'indice delle risorse, la classificazione di ogni figlio, le
//! tavole, le geometrie e il `Builder` che produce la scena classificata.

use super::*;

/// Le risorse modificabili di un documento: il tipo di ognuna, il `d` dei
/// tracciati, il colore dei campioni e il tipo degli stili.
struct Resources {
    kinds: HashMap<String, ResourceKind>,
    paths: HashMap<String, String>,
    swatches: Swatches,
    styles: HashMap<String, StyleKind>,
}

/// L'indice delle risorse modificabili del documento: per ogni id, il tipo
/// della risorsa (formato della scena, risorse), il `d` dei tracciati e il
/// colore dei campioni. Prima le sfumature e i tracciati, che non rimandano a
/// niente, poi le altre, che nel contenuto possono usare le sfumature, e per
/// ultimi gli stili, che possono usare tutte le altre. Di due risorse con lo
/// stesso id vale la prima, in quest'ordine: il documento è comunque in sola
/// lettura (S003).
fn resource_index(doc: &Document<'_>) -> Resources {
    let mut found = HashMap::new();
    let mut paths = HashMap::new();
    let mut swatches = HashMap::new();
    let mut styles = HashMap::new();
    let mut others = Vec::new();
    let mut prototypes = Vec::new();
    let mut symbols = Vec::new();
    let judge = |found: &mut HashMap<String, ResourceKind>,
                 element: &Element<'_>,
                 tag: Tag,
                 resolve: Resolve<'_>| {
        let Some(id) = element.value(NS_NONE, "id") else {
            return false;
        };
        let allowed = if tag == Tag::Path {
            path_resource_allowed(doc, element)
        } else {
            resource_allowed(doc, element, tag, resolve)
        };
        if found.contains_key(id) || !allowed {
            return false;
        }
        let kind = tag.resource_kind().unwrap_or(ResourceKind::Path);
        found.insert(id.to_owned(), kind);
        true
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
            let Some(tag) = Tag::of(element) else {
                continue;
            };
            if claims_style(element, tag) {
                prototypes.push((element, tag));
            }
            if tag == Tag::Symbol {
                symbols.push(element);
            }
            if tag != Tag::Path && tag.resource_kind().is_none() {
                continue;
            }
            match tag {
                Tag::LinearGradient | Tag::RadialGradient => {
                    let swatch = (judge(&mut found, element, tag, &no_resources)
                        && element.value(NS_FUB, "role") == Some("swatch"))
                    .then(|| swatch_of(doc, element))
                    .flatten();
                    if let Some(Paint::Color(rgb)) = swatch.and_then(|swatch| paint(&swatch.color))
                    {
                        let id = element.value(NS_NONE, "id").unwrap_or_default();
                        swatches.insert(id.to_owned(), rgb);
                    }
                }
                Tag::Path => {
                    if judge(&mut found, element, tag, &no_resources) {
                        let d = element.value(NS_NONE, "d").unwrap_or_default();
                        paths.insert(
                            element.value(NS_NONE, "id").unwrap_or_default().to_owned(),
                            d.to_owned(),
                        );
                    }
                }
                _ => others.push((element, tag)),
            }
        }
    }
    let first = found.clone();
    let resolve = |id: &str| first.get(id).copied();
    for (element, tag) in others {
        judge(&mut found, element, tag, &resolve);
    }
    // I simboli dopo le altre risorse, che il loro contenuto usa: un id già
    // preso resta della risorsa.
    for id in acyclic_symbols(doc, &symbols, &|id| found.contains_key(id)) {
        found.insert(id, ResourceKind::Symbol);
    }
    // Gli stili per ultimi: usano ogni altra risorsa, e nessuno li usa.
    let resolve = |id: &str| found.get(id).copied();
    for (element, tag) in prototypes {
        let Some(id) = element.value(NS_NONE, "id") else {
            continue;
        };
        if found.contains_key(id)
            || styles.contains_key(id)
            || !style_allowed(doc, element, tag, &resolve)
        {
            continue;
        }
        styles.insert(
            id.to_owned(),
            StyleKind::of(tag).expect("un prototipo ha un tipo"),
        );
    }
    Resources {
        kinds: found,
        paths,
        swatches,
        styles,
    }
}

/// Come [`classify`], per un figlio a profondità `depth`: un contenitore oltre
/// la profondità massima è un'unità.
pub(super) fn classify_child(
    doc: &Document<'_>,
    id: NodeId,
    place: Place,
    depth: usize,
    resolve: Resolve<'_>,
) -> Option<(Tag, Role)> {
    classify(doc, id, place, resolve)
        .filter(|&(_, role)| !role.is_container() || depth <= MAX_DEPTH)
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
    // Un `path` in una `defs` è il tracciato di un testo (formato della scena,
    // testo).
    if tag == Tag::Path && place == Place::Defs {
        return path_resource_allowed(doc, element).then_some((tag, Role::Resource));
    }
    // Un `text` o una `polyline` con `fub:role="style"` in una `defs` è uno
    // stile (formato della scena, stili).
    if place == Place::Defs && claims_style(element, tag) {
        return style_allowed(doc, element, tag, resolve).then_some((tag, Role::Resource));
    }
    // Un simbolo sta in una `defs` della radice, e l'indice delle risorse sa
    // se contiene sé stesso (formato della scena, simboli).
    if tag == Tag::Symbol {
        let symbol = element.value(NS_NONE, "id");
        return (place == Place::Defs
            && symbol.is_some_and(|symbol| resolve(symbol) == Some(ResourceKind::Symbol))
            && symbol_allowed(element))
        .then_some((tag, Role::Symbol));
    }
    // In una `defs` stanno solo risorse, stili, simboli, titolo e
    // descrizione.
    if place == Place::Defs && !matches!(tag, Tag::Title | Tag::Desc) {
        return None;
    }
    // Una tavola è un `view` della radice (formato della scena, tavole).
    if tag == Tag::View {
        return (place == Place::Root && board_allowed(doc, element, resolve))
            .then_some((tag, Role::Board));
    }
    if tag == Tag::Use {
        if use_allowed(
            doc,
            element,
            resolve,
            ResourceKind::Symbol,
            &INSTANCE_ATTRIBUTES,
        ) {
            return Some((tag, Role::Instance));
        }
        // Una copia sta fra i figli di una ripetizione, dove `resolve` conosce
        // gli originali (formato della scena, ripetizioni).
        return use_allowed(
            doc,
            element,
            resolve,
            ResourceKind::Original,
            &COPY_ATTRIBUTES,
        )
        .then_some((tag, Role::Copy));
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
        Tag::Tspan | Tag::TextPath => return None,
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

/// Vero se `element`, un `view` della radice, è una tavola (formato della
/// scena, tavole): `fub:role="board"`, un id, un `viewBox` largo e alto più di
/// zero, nessun altro attributo SVG e per figli soltanto titoli e
/// descrizioni.
fn board_allowed(doc: &Document<'_>, element: &Element<'_>, resolve: Resolve<'_>) -> bool {
    if element.value(NS_FUB, "role") != Some("board")
        || element.value(NS_NONE, "id").is_none_or(str::is_empty)
        || board_box(element).is_none()
    {
        return false;
    }
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => matches!(attr.local, "id" | "viewBox"),
        NS_SVG | NS_XLINK => false,
        _ => true,
    });
    attributes
        && element
            .children
            .iter()
            .all(|&child| match doc.nodes[child].kind {
                Kind::Text { blank, .. } => blank,
                Kind::Element(_) => allowed_part(doc, child, false, resolve),
                _ => false,
            })
}

/// Le tavole del documento, in ordine di documento: i `view` della radice che
/// la scena legge come tavole, col loro rettangolo. Di due con lo stesso id
/// vale la prima.
pub(crate) fn boards(doc: &Document<'_>) -> Vec<(NodeId, [f64; 4])> {
    let kinds = resource_index(doc).kinds;
    let resolve = |id: &str| kinds.get(id).copied();
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for &child in doc.children(doc.root) {
        let Some(element) = doc.element(child) else {
            continue;
        };
        if !element.is_svg("view") {
            continue;
        }
        let Some(id) = element.value(NS_NONE, "id") else {
            continue;
        };
        if seen.contains(id) {
            continue;
        }
        if classify(doc, child, Place::Root, &resolve).is_some_and(|(_, role)| role == Role::Board)
        {
            if let Some(rect) = board_box(element) {
                seen.insert(id);
                found.push((child, rect));
            }
        }
    }
    found
}

/// Il rettangolo di una tavola, dal suo `viewBox`, se è largo e alto più di
/// zero.
pub(crate) fn board_box(element: &Element<'_>) -> Option<[f64; 4]> {
    element
        .value(NS_NONE, "viewBox")
        .and_then(view_box)
        .filter(|b| b[2] > 0.0 && b[3] > 0.0)
}

/// Il ruolo di un `path`: tratto, freccia, connettore, forma sintetica o
/// tracciato.
fn path_role(element: &Element<'_>) -> Role {
    if matches!(element.value(NS_FUB, "tool"), Some("pen" | "highlighter")) {
        return Role::Stroke;
    }
    // Uno strumento sconosciuto, o una forma sconosciuta, lasciano un
    // tracciato: la geometria si legge da `d` (§6).
    match element.value(NS_FUB, "shape") {
        Some("arrow") if arrow_geometry(element).is_some() => Role::Arrow,
        Some("connector") if connector_geometry(element).is_some() => Role::Connector,
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

/// `fub:geom` di un connettore, se si legge.
fn connector_geometry(element: &Element<'_>) -> Option<ConnectorGeom> {
    read_connector_geom(element.value(NS_FUB, "geom")?)
}

/// Un capo di un connettore, `fub:from` o `fub:to`, se si legge.
fn connector_end(element: &Element<'_>, name: &str) -> Option<ConnectorEnd> {
    read_connector_end(element.value(NS_FUB, name)?)
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
struct Frame<'s> {
    node: NodeId,
    /// Dove stanno i suoi figli.
    place: Place,
    path: Vec<usize>,
    next: usize,
    elements: usize,
    pending: Option<Pending>,
    context: Context<'s>,
    /// Gli originali dei figli, in una ripetizione.
    originals: Option<HashSet<String>>,
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
    /// I campioni del documento, col loro colore.
    swatches: &'d Swatches,
    /// Gli stili del documento, col loro tipo.
    styles: &'d HashMap<String, StyleKind>,
    items: Vec<Item>,
    diagnostics: Vec<Diagnostic>,
    tally: Tally,
}

/// Ciò che la classificazione trova.
pub(crate) struct Classified {
    pub items: Vec<Item>,
    /// S002, S004, S010 e S018.
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
            .map_or(Err(BrushError::Missing), InkBrush::parse);
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
        context: &Context<'_>,
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
        // titolo, la descrizione, la carta, le tavole o le risorse; queste, le
        // tavole e la `defs` hanno però un nome.
        let object = !matches!(
            role,
            Role::Title | Role::Desc | Role::Paper | Role::Defs | Role::Resource | Role::Board
        );
        let named = object || matches!(role, Role::Defs | Role::Resource | Role::Board);
        let followed = StyleKind::followed_by(role);
        let follows = followed
            .and_then(|_| element.value(NS_FUB, "style"))
            .map(str::to_owned);
        // S018: segue uno stile che non c'è, o uno dell'altro tipo.
        if let Some(target) = &follows {
            if self.styles.get(target.as_str()).copied() != followed {
                self.diagnostics.push(Diagnostic::new(
                    Code::S018,
                    Some(span),
                    Some(target.clone()),
                ));
            }
        }
        self.tally
            .element(doc, element, role, context, span, stroke.as_ref());
        if !self.keep {
            return;
        }
        let text_path = (role == Role::Text)
            .then(|| text_path_of(doc, element))
            .flatten();
        let swatch = (role == Role::Resource && element.value(NS_FUB, "role") == Some("swatch"))
            .then(|| swatch_of(doc, element))
            .flatten();
        let motif = (role == Role::Resource && element.value(NS_FUB, "role") == Some("swatch"))
            .then(|| motif_of(element))
            .flatten();
        // Un `text` o una `polyline` con `fub:role="style"` è una risorsa
        // soltanto con la forma di uno stile; un'altra risorsa con quel ruolo
        // resta senza ciclo di vita.
        let style = (role == Role::Resource && element.value(NS_FUB, "role") == Some("style"))
            .then(|| style_of(doc, element))
            .flatten();
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
            connector: (role == Role::Connector)
                .then(|| connector_geometry(element))
                .flatten()
                .map(|geom| ConnectorFacts {
                    geom,
                    from: connector_end(element, "from"),
                    to: connector_end(element, "to"),
                }),
            polygonal: matches!(role, Role::Ngon | Role::Star)
                .then(|| polygonal_geometry(element))
                .flatten(),
            varwidth: (role == Role::Width)
                .then(|| width_geometry(element))
                .flatten(),
            title: named.then(|| first_title(doc, element)).flatten(),
            text: matches!(role, Role::Title | Role::Desc).then(|| character_data(doc, id)),
            lines: (role == Role::Text).then(|| match &text_path {
                Some((path, _)) => vec![line_text(doc, *path)],
                None => element
                    .children
                    .iter()
                    .filter(|&&child| doc.element(child).is_some_and(|e| e.is_svg("tspan")))
                    .map(|&child| line_text(doc, child))
                    .collect(),
            }),
            wrap: (role == Role::Text && text_path.is_none())
                .then(|| element.value(NS_FUB, "wrap").and_then(wrap_width))
                .flatten(),
            glued: (role == Role::Text && text_path.is_none())
                .then(|| glued_lines(doc, element))
                .flatten(),
            text_path: text_path.and_then(|(_, path)| text_path_target(path)),
            along: (role == Role::Text)
                .then(|| element.value(NS_FUB, "along").and_then(read_label_place))
                .flatten(),
            inside: (role == Role::Text)
                .then(|| element.value(NS_FUB, "inside").and_then(read_inside))
                .flatten(),
            lifecycle: (role == Role::Resource)
                .then(|| match element.value(NS_FUB, "role") {
                    Some("private") => Some(Lifecycle::Private),
                    Some("shared") => Some(Lifecycle::Shared),
                    Some("swatch") => {
                        (swatch.is_some() || motif.is_some()).then_some(Lifecycle::Swatch)
                    }
                    Some("style") => style.is_some().then_some(Lifecycle::Style),
                    _ => None,
                })
                .flatten(),
            swatch,
            motif,
            style,
            follows,
            board_box: (role == Role::Board).then(|| board_box(element)).flatten(),
            board: (role == Role::Paper)
                .then(|| element.value(NS_FUB, "board").map(str::to_owned))
                .flatten(),
            symbol: (role == Role::Instance)
                .then(|| use_target(element))
                .flatten(),
            source: (role == Role::Symbol)
                .then(|| element.value(NS_FUB, "source").map(str::to_owned))
                .flatten(),
            repeat: (role == Role::Group).then(|| repeat_of(element)).flatten(),
            original: (role == Role::Copy).then(|| use_target(element)).flatten(),
        };
        self.items.push(Item::Element(Box::new(item)));
    }

    /// Visita la radice e i contenitori modificabili, in ordine di documento.
    fn walk(&mut self, root: NodeId) {
        let doc = self.doc;
        let resolve = self.resolve;
        let mut stack = vec![Frame {
            node: root,
            place: Place::Root,
            path: Vec::new(),
            next: 0,
            elements: 0,
            pending: None,
            context: Context::root(
                doc.element(root).expect("la radice è un elemento"),
                self.swatches,
            ),
            originals: None,
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
                    let depth = frame.path.len() + 1;
                    let originals = frame.originals.as_ref();
                    let within = |id: &str| with_originals(resolve, originals, id);
                    match classify_child(doc, child, frame.place, depth, &within) {
                        Some((tag, role)) => {
                            let pending = frame.pending.take();
                            let element = doc.element(child).expect("una voce è un elemento");
                            let mut context = frame.context.child(element);
                            // Un originale ha il suo riquadro, che le copie
                            // portano dove stanno.
                            let id = element.value(NS_NONE, "id");
                            if let Some(id) = id.filter(|&id| {
                                role != Role::Copy
                                    && frame
                                        .originals
                                        .as_ref()
                                        .is_some_and(|originals| originals.contains(id))
                            }) {
                                self.tally.original(doc, &frame.context, id);
                                context = context.original(child);
                            }
                            let mut path = frame.path.clone();
                            self.flush(pending, Some(&path));
                            path.push(index);
                            if role.is_container() {
                                self.element_item(child, tag, role, path.clone(), &context);
                                // Il contenuto di un simbolo sta nelle
                                // coordinate del simbolo.
                                let context = if role == Role::Symbol {
                                    context.within(child)
                                } else {
                                    context
                                };
                                let originals = (role == Role::Group
                                    && repeat_of(element).is_some())
                                .then(|| originals_of(doc, child, path.len() + 1, resolve));
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
                                    originals,
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
    let Resources {
        kinds,
        paths,
        swatches,
        styles,
    } = resource_index(doc);
    let resolve = |id: &str| kinds.get(id).copied();
    let mut builder = Builder {
        doc,
        map,
        lines: Lines::new(doc.source),
        keep,
        resolve: &resolve,
        swatches: &swatches,
        styles: &styles,
        items: Vec::new(),
        diagnostics: Vec::new(),
        tally: Tally::new(paths),
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
