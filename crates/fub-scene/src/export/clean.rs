//! L'SVG pulito per il web: il testo derivato senza ciò che serve solo agli
//! editor, con i numeri della geometria ai decimali che si vedono.
//!
//! I cambi sono sul testo, come quelli della derivazione, e con la stessa
//! regola per togliere un nodo: ogni byte che nessuna regola tocca resta
//! uguale. Si toglie:
//!
//! - ciò che sta fuori dalla radice (dichiarazione XML, DOCTYPE, BOM, commenti
//!   e istruzioni di elaborazione), e dentro i commenti e le istruzioni;
//! - gli attributi di un namespace che non è quello vuoto, XLink o XML, e le
//!   dichiarazioni dei prefissi che nessun elemento rimasto usa;
//! - gli elementi di un altro namespace fuori da un `foreignObject`, i
//!   `metadata` e, tranne nel disegno intero, i `view` delle tavole;
//! - gli elementi nascosti fuori da `defs`, e dentro `defs` gli elementi che
//!   nessuno riferisce, quando niente al loro interno è riferito da ciò che
//!   resta; poi un `defs` rimasto vuoto.
//!
//! Le entità di un DOCTYPE si espandono prima: senza DOCTYPE un riferimento
//! a un'entità non si leggerebbe più.

use std::collections::{HashMap, HashSet};

use super::{format_number, format_units, read_whole, removal, Edit, Scope, POWERS_OF_TEN};
use crate::classify;
use crate::geometry::Matrix;
use crate::ink::round_half_up;
use crate::values::{href_id, is_wsp, scan_number, transform, trim, url_ids};
use crate::xml::{
    is_space, Document, Element, Kind, NodeId, XmlErrorKind, NS_NONE, NS_SVG, NS_XLINK, NS_XML,
    NS_XMLNS,
};
use crate::ReadError;

const XLINK_URI: &str = "http://www.w3.org/1999/xlink";

/// I decimali dei numeri dove l'ingrandimento è 1 o meno, quelli della
/// geometria, e il massimo.
const MIN_DECIMALS: usize = 2;
const MAX_DECIMALS: usize = 6;

/// Quante entità annidate si espandono, e quanti byte in tutto: gli stessi
/// limiti della lettura degli attributi.
const ENTITY_DEPTH: usize = 16;
const ENTITY_BYTES: usize = 1 << 20;

/// Le entità predefinite di XML, che restano come sono.
const PREDEFINED: [&str; 5] = ["lt", "gt", "amp", "apos", "quot"];

/// Gli elementi dove l'ingrandimento non si legge dai `transform` sopra:
/// il loro contenuto si disegna dove lo usa qualcun altro, o in unità del
/// riquadro di un oggetto. Lì i numeri prendono tutti i decimali.
const ELSEWHERE: [&str; 6] = ["clipPath", "defs", "marker", "mask", "pattern", "symbol"];

/// L'SVG pulito di `derived`, un testo derivato con l'ambito `scope`. Ripulire
/// il risultato non lo cambia più. `Err` se `derived` non è un SVG, o se le
/// entità del suo DOCTYPE espanse non fanno un XML ben formato.
pub fn clean(derived: &str, scope: &Scope) -> Result<String, ReadError> {
    let whole = matches!(scope, Scope::Drawing);
    let doc = read_whole(derived)?;
    let Some((expanded, pieces)) = expand_entities(&doc)? else {
        return Ok(clean_document(&doc, whole));
    };
    let doc = read_whole(&expanded).map_err(|error| relocate(error, &pieces))?;
    Ok(clean_document(&doc, whole))
}

/// `svg` con il riferimento di ogni `image` che `embed` sa sostituire.
/// `embed` riceve il valore letto di `href` o di `xlink:href`, con le entità
/// risolte, e dà ciò che va al suo posto, di solito un URI `data:`; con `None`
/// il riferimento resta. Ogni altro byte resta uguale. `Err` se `svg` non è
/// un SVG.
pub fn embed_images(
    svg: &str,
    mut embed: impl FnMut(&str) -> Option<String>,
) -> Result<String, ReadError> {
    let doc = read_whole(svg)?;
    let mut edits = Vec::new();
    for node in 0..doc.nodes.len() {
        let Some(element) = doc.element(node) else {
            continue;
        };
        if !element.is_svg("image") {
            continue;
        }
        for attr in &element.attrs {
            if !(matches!(attr.ns, NS_NONE | NS_XLINK) && attr.local == "href") {
                continue;
            }
            if let Some(value) = embed(&attr.value) {
                edits.push(Edit {
                    start: attr.raw.0,
                    end: attr.raw.1,
                    text: escape_attribute(&value),
                });
            }
        }
    }
    Ok(super::apply(doc.source, edits))
}

// ---------------------------------------------------------------------------
// Le entità
// ---------------------------------------------------------------------------

/// Un tratto del testo espanso: comincia al byte `to` del testo nuovo e viene
/// dal byte `from` del vecchio, uguale se `copied`.
struct Piece {
    to: usize,
    from: usize,
    copied: bool,
}

/// Il testo con le entità del DOCTYPE espanse, o `None` se non ne usa: un
/// attributo che le usa si riscrive dal suo valore, un riferimento nel
/// contenuto diventa il testo di sostituzione, marcatura compresa, e quello di
/// un'entità esterna sparisce, come in un browser.
fn expand_entities(doc: &Document<'_>) -> Result<Option<(String, Vec<Piece>)>, ReadError> {
    let mut edits = Vec::new();
    let mut budget = ENTITY_BYTES;
    for node in &doc.nodes {
        match &node.kind {
            Kind::Element(element) => {
                for attr in &element.attrs {
                    if uses_entity(&doc.source[attr.raw.0..attr.raw.1]) {
                        edits.push(Edit {
                            start: attr.raw.0,
                            end: attr.raw.1,
                            text: escape_attribute(&attr.value),
                        });
                    }
                }
            }
            Kind::EntityRef(name) => {
                let mut text = String::new();
                expand_entity(doc, name, 0, &mut budget, &mut text).ok_or(
                    ReadError::Malformed {
                        offset: node.start,
                        kind: XmlErrorKind::EntityLimit,
                    },
                )?;
                edits.push(Edit {
                    start: node.start,
                    end: node.end,
                    text,
                });
            }
            _ => {}
        }
    }
    if edits.is_empty() {
        return Ok(None);
    }
    edits.sort_by_key(|edit| (edit.start, edit.end));
    let source = doc.source;
    let mut out = String::with_capacity(source.len());
    let mut pieces = Vec::with_capacity(edits.len() * 2 + 1);
    let mut at = 0;
    for edit in edits {
        pieces.push(Piece {
            to: out.len(),
            from: at,
            copied: true,
        });
        out.push_str(&source[at..edit.start]);
        pieces.push(Piece {
            to: out.len(),
            from: edit.start,
            copied: false,
        });
        out.push_str(&edit.text);
        at = edit.end;
    }
    pieces.push(Piece {
        to: out.len(),
        from: at,
        copied: true,
    });
    out.push_str(&source[at..]);
    Ok(Some((out, pieces)))
}

/// Vero se il valore grezzo di un attributo nomina un'entità del DOCTYPE.
fn uses_entity(raw: &str) -> bool {
    raw.match_indices('&').any(|(i, _)| {
        let rest = &raw[i + 1..];
        !rest.starts_with('#')
            && rest
                .find(';')
                .is_some_and(|end| !PREDEFINED.contains(&&rest[..end]))
    })
}

/// Un valore normalizzato scritto di nuovo fra virgolette. I caratteri che
/// chiuderebbero il valore o che sarebbero markup li scrive la tabella di
/// `quick-xml`, la libreria con cui il lettore legge il disegno; gli spazi
/// che la normalizzazione degli attributi cambierebbe in uno spazio si
/// scrivono come riferimenti.
fn escape_attribute(value: &str) -> String {
    let escaped = quick_xml::escape::escape(value);
    let mut out = String::with_capacity(escaped.len());
    for c in escaped.chars() {
        match c {
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
    out
}

/// Il testo di sostituzione dell'entità `name` dentro `out`, con le entità che
/// nomina espanse a loro volta. `None` oltre i limiti.
fn expand_entity(
    doc: &Document<'_>,
    name: &str,
    depth: usize,
    budget: &mut usize,
    out: &mut String,
) -> Option<()> {
    if depth >= ENTITY_DEPTH {
        return None;
    }
    // Un'entità esterna non si carica: non resta niente.
    let Some(text) = doc.internal_entity(name) else {
        return Some(());
    };
    *budget = budget.checked_sub(text.len())?;
    let mut i = 0;
    'text: while i < text.len() {
        let rest = &text[i..];
        // Dove `&` non è un riferimento.
        for (open, close) in [("<!--", "-->"), ("<![CDATA[", "]]>"), ("<?", "?>")] {
            if let Some(body) = rest.strip_prefix(open) {
                let end = body
                    .find(close)
                    .map_or(rest.len(), |p| open.len() + p + close.len());
                out.push_str(&rest[..end]);
                i += end;
                continue 'text;
            }
        }
        if let Some(after) = rest.strip_prefix('&').filter(|r| !r.starts_with('#')) {
            if let Some(end) = after.find(';') {
                let inner = &after[..end];
                if !PREDEFINED.contains(&inner) {
                    expand_entity(doc, inner, depth + 1, budget, out)?;
                    i += end + 2;
                    continue;
                }
            }
        }
        let c = rest.chars().next()?;
        out.push(c);
        i += c.len_utf8();
    }
    Some(())
}

/// Un errore del testo espanso, riportato sul testo di partenza: dentro un
/// tratto uguale sul byte corrispondente, dentro un'espansione sul suo inizio.
fn relocate(error: ReadError, pieces: &[Piece]) -> ReadError {
    let back = |offset: usize| {
        let at = pieces.partition_point(|piece| piece.to <= offset);
        match at.checked_sub(1).map(|i| &pieces[i]) {
            Some(piece) if piece.copied => piece.from + (offset - piece.to),
            Some(piece) => piece.from,
            None => offset,
        }
    };
    match error {
        ReadError::Malformed { offset, kind } => ReadError::Malformed {
            offset: back(offset),
            kind,
        },
        ReadError::NotSvg { offset } => ReadError::NotSvg {
            offset: back(offset),
        },
    }
}

// ---------------------------------------------------------------------------
// Che cosa resta
// ---------------------------------------------------------------------------

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum State {
    Kept,
    /// Se ne va comunque, col suo contenuto.
    Removed,
    /// Se ne va se niente al suo interno è riferito da ciò che resta: un
    /// elemento nascosto, o un figlio di `defs`.
    Unless,
}

/// Il documento pulito.
fn clean_document(doc: &Document<'_>, whole: bool) -> String {
    let mut state = judge(doc, whole);
    let needed = sweep(doc, &state);
    let is_gone = |state: &[State], node: NodeId| match state[node] {
        State::Kept => false,
        State::Removed => true,
        State::Unless => !needed[node],
    };
    // Un `defs` rimasto vuoto: i figli vengono dopo il padre nell'arena,
    // quindi all'indietro un `defs` dentro un altro si giudica prima.
    for node in (0..doc.nodes.len()).rev() {
        let Some(element) = doc.element(node) else {
            continue;
        };
        if element.is_svg("defs")
            && !is_gone(&state, node)
            && element.children.iter().all(|&child| {
                is_gone(&state, child)
                    || matches!(doc.nodes[child].kind, Kind::Text { blank: true, .. })
            })
        {
            state[node] = State::Removed;
        }
    }
    let gone = |node: NodeId| is_gone(&state, node);

    // Che cosa usano gli elementi che restano: i prefissi dei loro nomi, e gli
    // id a cui rimanda un `use`, che si disegnano dove lo dice lui.
    let mut prefixes = HashSet::new();
    let mut used = HashSet::new();
    walk_alive(doc, &gone, |node| {
        let element = doc.element(node).expect("si visitano elementi");
        if let Some((prefix, _)) = element.name.split_once(':') {
            prefixes.insert(prefix);
        }
        if element.is_svg("use") {
            used.extend(
                element
                    .attrs
                    .iter()
                    .filter(|attr| matches!(attr.ns, NS_NONE | NS_XLINK) && attr.local == "href")
                    .filter_map(|attr| href_id(&attr.value)),
            );
        }
    });

    let source = doc.source;
    let root = &doc.nodes[doc.root];
    let mut edits = vec![
        Edit {
            start: 0,
            end: root.start,
            text: String::new(),
        },
        Edit {
            start: root.end,
            end: source.len(),
            text: "\n".to_owned(),
        },
    ];
    let mut declarations = Vec::new();
    let mut context = vec![Context::ROOT];
    // Una pila esplicita, col contesto di ogni elemento.
    let mut stack = vec![(doc.root, 0usize)];
    while let Some((node, parent)) = stack.pop() {
        let element = doc.element(node).expect("si visitano elementi");
        let here = context[parent].enter(element, node == doc.root, &used);
        for attr in &element.attrs {
            match attr.ns {
                NS_NONE | NS_XLINK | NS_XML => {}
                NS_XMLNS => {
                    if attr.name != "xmlns" && attr.value != XLINK_URI {
                        declarations.push((attr.local, attribute_span(source, attr)));
                    }
                }
                _ => {
                    let (start, end) = attribute_span(source, attr);
                    edits.push(Edit {
                        start,
                        end,
                        text: String::new(),
                    });
                }
            }
        }
        if node != doc.root {
            numbers(doc, element, here.decimals, &mut edits);
        }
        let index = context.len();
        context.push(here.inside(element, node == doc.root));
        let children = &element.children;
        for (at, &child) in children.iter().enumerate() {
            if gone(child) {
                edits.push(removal(doc, children, at));
            } else if doc.element(child).is_some() {
                stack.push((child, index));
            }
        }
    }
    for (prefix, (start, end)) in declarations {
        if !prefixes.contains(prefix) {
            edits.push(Edit {
                start,
                end,
                text: String::new(),
            });
        }
    }
    super::apply(source, edits)
}

/// Lo stato di ogni nodo, prima di contare i riferimenti.
fn judge(doc: &Document<'_>, whole: bool) -> Vec<State> {
    let boards: HashSet<NodeId> = if whole {
        HashSet::new()
    } else {
        classify::boards(doc)
            .into_iter()
            .map(|(node, _)| node)
            .collect()
    };
    let may_hide = hiding_is_final(doc);
    let mut state = vec![State::Kept; doc.nodes.len()];
    // L'elemento, se sta in un `foreignObject` e se sta in una `defs`.
    let mut stack = vec![(doc.root, false, false)];
    while let Some((node, foreign, defs)) = stack.pop() {
        let element = doc.element(node).expect("si visitano elementi");
        let foreign = foreign || element.is_svg("foreignObject");
        let in_defs = defs || element.is_svg("defs");
        for &child in &element.children {
            let inner = match &doc.nodes[child].kind {
                Kind::Comment | Kind::Pi => {
                    state[child] = State::Removed;
                    continue;
                }
                Kind::Element(inner) => inner,
                _ => continue,
            };
            if (inner.ns != NS_SVG && !foreign)
                || inner.is_svg("metadata")
                || boards.contains(&child)
            {
                state[child] = State::Removed;
                continue;
            }
            // Un figlio di `defs` che non è uno `style`, o un elemento nascosto
            // fuori da `defs`.
            let unless = if element.is_svg("defs") {
                !inner.is_svg("style")
            } else {
                !in_defs && may_hide && hidden(inner)
            };
            if unless {
                state[child] = State::Unless;
            }
            stack.push((child, foreign, in_defs));
        }
    }
    state
}

/// Vero se un elemento nascosto resta nascosto: nessun foglio di stile parla
/// di `display`, nessuna animazione lo cambia e nessuno script può farlo.
fn hiding_is_final(doc: &Document<'_>) -> bool {
    doc.nodes.iter().all(|node| {
        let Kind::Element(element) = &node.kind else {
            return true;
        };
        if element.ns != NS_SVG {
            return true;
        }
        match element.local {
            "script" => false,
            "set" | "animate" => element.value(NS_NONE, "attributeName") != Some("display"),
            "style" => !element
                .children
                .iter()
                .any(|&child| match &doc.nodes[child].kind {
                    Kind::Text { value, .. } | Kind::CData(value) => {
                        value.to_ascii_lowercase().contains("display")
                    }
                    _ => false,
                }),
            _ => true,
        }
    })
}

/// Vero se `element` non si disegna: `display: none` nel suo `style`, o
/// l'attributo `display="none"` se lo `style` non dice niente. Uno `style`
/// che non si legge con certezza, con un commento o con valori diversi, lo
/// lascia dov'è.
fn hidden(element: &Element<'_>) -> bool {
    if let Some(style) = element.value(NS_NONE, "style") {
        if style.contains("/*") {
            return false;
        }
        let values: Vec<&str> = style
            .split(';')
            .filter_map(|declaration| {
                let (property, value) = declaration.split_once(':')?;
                trim(property)
                    .eq_ignore_ascii_case("display")
                    .then(|| trim(value))
            })
            .collect();
        if !values.is_empty() {
            return values.iter().all(|value| {
                let value = value.strip_suffix("!important").map_or(*value, trim);
                value == "none"
            });
        }
    }
    element.value(NS_NONE, "display").map(trim) == Some("none")
}

/// Quali elementi «se ne va se» restano: quelli dove arriva un riferimento da
/// ciò che resta, e chi li contiene. Uno `style` e uno `script` restano
/// sempre, perché valgono anche nascosti.
fn sweep(doc: &Document<'_>, state: &[State]) -> Vec<bool> {
    let mut ids: HashMap<&str, Vec<NodeId>> = HashMap::new();
    let mut pinned = Vec::new();
    walk_alive(doc, &|node| state[node] == State::Removed, |node| {
        let element = doc.element(node).expect("si visitano elementi");
        if let Some(id) = element.value(NS_NONE, "id") {
            ids.entry(id).or_default().push(node);
        }
        if element.is_svg("style") || element.is_svg("script") {
            pinned.push(node);
        }
    });

    let mut needed = vec![false; doc.nodes.len()];
    let mut seen = HashSet::new();
    let mut queue = Vec::new();
    let skip = |needed: &[bool], node: NodeId| match state[node] {
        State::Kept => false,
        State::Removed => true,
        State::Unless => !needed[node],
    };
    let collect =
        |from: NodeId, needed: &[bool], seen: &mut HashSet<String>, queue: &mut Vec<String>| {
            let mut stack = vec![from];
            while let Some(node) = stack.pop() {
                let element = doc.element(node).expect("si visitano elementi");
                for id in references(doc, element) {
                    if seen.insert(id.clone()) {
                        queue.push(id);
                    }
                }
                stack.extend(
                    element
                        .children
                        .iter()
                        .copied()
                        .filter(|&child| doc.element(child).is_some() && !skip(needed, child)),
                );
            }
        };
    // Tiene `target` e ciò che lo contiene; il contenuto che così resta
    // aggiunge i suoi riferimenti.
    let keep = |target: NodeId,
                needed: &mut Vec<bool>,
                seen: &mut HashSet<String>,
                queue: &mut Vec<String>| {
        let mut outermost = None;
        let mut at = Some(target);
        while let Some(node) = at {
            if state[node] == State::Unless && !needed[node] {
                needed[node] = true;
                outermost = Some(node);
            }
            at = doc.nodes[node].parent;
        }
        if let Some(node) = outermost {
            collect(node, needed.as_slice(), seen, queue);
        }
    };
    collect(doc.root, &needed, &mut seen, &mut queue);
    for node in pinned {
        keep(node, &mut needed, &mut seen, &mut queue);
    }
    while let Some(id) = queue.pop() {
        for &target in ids.get(id.as_str()).into_iter().flatten() {
            keep(target, &mut needed, &mut seen, &mut queue);
        }
    }
    needed
}

/// Gli id a cui `element` rimanda: `href` e `xlink:href` con `#id`, `url(#id)`
/// negli attributi e, per uno `style`, nel testo.
fn references(doc: &Document<'_>, element: &Element<'_>) -> Vec<String> {
    let mut found = Vec::new();
    for attr in &element.attrs {
        if !matches!(attr.ns, NS_NONE | NS_XLINK) {
            continue;
        }
        if attr.local == "href" {
            found.extend(href_id(&attr.value));
        }
        found.extend(url_ids(&attr.value).into_iter().map(str::to_owned));
    }
    if element.is_svg("style") {
        for &child in &element.children {
            if let Kind::Text { value, .. } | Kind::CData(value) = &doc.nodes[child].kind {
                found.extend(url_ids(value).into_iter().map(str::to_owned));
            }
        }
    }
    found
}

/// Visita gli elementi dalla radice in giù, senza entrare in quelli per cui
/// `gone` è vero.
fn walk_alive(doc: &Document<'_>, gone: &dyn Fn(NodeId) -> bool, mut visit: impl FnMut(NodeId)) {
    let mut stack = vec![doc.root];
    while let Some(node) = stack.pop() {
        visit(node);
        stack.extend(
            doc.children(node)
                .iter()
                .rev()
                .copied()
                .filter(|&child| doc.element(child).is_some() && !gone(child)),
        );
    }
}

/// I byte di un attributo da togliere: dallo spazio prima del nome alla
/// virgoletta che chiude il valore.
fn attribute_span(source: &str, attr: &crate::xml::Attr<'_>) -> (usize, usize) {
    let bytes = source.as_bytes();
    // Prima della virgoletta d'apertura: spazi, `=`, spazi, il nome.
    let mut i = attr.raw.0 - 1;
    while is_space(bytes[i - 1]) {
        i -= 1;
    }
    debug_assert_eq!(bytes[i - 1], b'=');
    i -= 1;
    while is_space(bytes[i - 1]) {
        i -= 1;
    }
    i -= attr.name.len();
    debug_assert_eq!(&source[i..i + attr.name.len()], attr.name);
    while is_space(bytes[i - 1]) {
        i -= 1;
    }
    (i, attr.raw.1 + 1)
}

// ---------------------------------------------------------------------------
// I numeri
// ---------------------------------------------------------------------------

/// Dove sta un elemento: la matrice dei `transform` sopra di lui, e se i suoi
/// numeri prendono tutti i decimali.
#[derive(Copy, Clone)]
struct Context {
    matrix: Matrix,
    elsewhere: bool,
}

/// Ciò che vale per un elemento: la sua matrice e i decimali dei suoi numeri.
struct Here {
    matrix: Matrix,
    elsewhere: bool,
    decimals: usize,
}

impl Context {
    const ROOT: Context = Context {
        matrix: Matrix::IDENTITY,
        elsewhere: false,
    };

    /// L'elemento `element` in questo contesto. Un `transform` che non si
    /// legge non vale, come nei browser.
    fn enter(&self, element: &Element<'_>, root: bool, used: &HashSet<String>) -> Here {
        let own = element
            .value(NS_NONE, "transform")
            .and_then(transform)
            .unwrap_or(Matrix::IDENTITY);
        let matrix = self.matrix.then(own);
        let elsewhere = self.elsewhere
            || (!root
                && element
                    .value(NS_NONE, "id")
                    .is_some_and(|id| used.contains(id)));
        Here {
            matrix,
            elsewhere,
            decimals: if elsewhere {
                MAX_DECIMALS
            } else {
                decimals(&matrix)
            },
        }
    }
}

impl Here {
    /// Il contesto dei figli.
    fn inside(&self, element: &Element<'_>, root: bool) -> Context {
        let nested_view =
            element.is_svg("svg") && !root && element.attr(NS_NONE, "viewBox").is_some();
        let elsewhere = self.elsewhere
            || nested_view
            || element.is_svg("foreignObject")
            || (element.ns == NS_SVG && ELSEWHERE.contains(&element.local));
        Context {
            matrix: self.matrix,
            elsewhere,
        }
    }
}

/// I decimali dove la matrice ingrandisce come `matrix`: 2, più uno per ogni
/// potenza di 10 del suo valore singolare più grande, fino a 6.
fn decimals(matrix: &Matrix) -> usize {
    let [a, b, c, d, _, _] = matrix.0;
    let sum = a * a + b * b + c * c + d * d;
    let det = a * d - b * c;
    let largest = ((sum + (sum * sum - 4.0 * det * det).max(0.0).sqrt()) / 2.0).sqrt();
    if !largest.is_finite() {
        return MAX_DECIMALS;
    }
    let mut decimals = MIN_DECIMALS;
    let mut power = 10.0;
    // Un ingrandimento di 10 calcolato come 9,999999… vale 10.
    while decimals < MAX_DECIMALS && largest >= power * (1.0 - 1e-9) {
        decimals += 1;
        power *= 10.0;
    }
    decimals
}

/// Gli attributi di lunghezze e coordinate di ciascun elemento.
fn geometry(local: &str, name: &str) -> bool {
    match local {
        "rect" => matches!(name, "x" | "y" | "width" | "height" | "rx" | "ry"),
        "circle" => matches!(name, "cx" | "cy" | "r"),
        "ellipse" => matches!(name, "cx" | "cy" | "rx" | "ry"),
        "line" => matches!(name, "x1" | "y1" | "x2" | "y2"),
        "text" | "tspan" => matches!(name, "x" | "y" | "dy"),
        "image" | "foreignObject" | "use" | "svg" => {
            matches!(name, "x" | "y" | "width" | "height")
        }
        _ => false,
    }
}

/// I cambi che riscrivono i numeri di `element` a `decimals` decimali.
fn numbers(doc: &Document<'_>, element: &Element<'_>, decimals: usize, edits: &mut Vec<Edit>) {
    if element.ns != NS_SVG {
        return;
    }
    for attr in &element.attrs {
        if attr.ns != NS_NONE {
            continue;
        }
        let raw = &doc.source[attr.raw.0..attr.raw.1];
        // Un riferimento nel valore grezzo: si lascia com'è.
        if raw.contains('&') {
            continue;
        }
        let rewritten = match (element.local, attr.local) {
            (_, "stroke-width" | "font-size" | "stroke-dasharray") => number_list(raw, decimals),
            ("path", "d") => path_data(raw, decimals),
            ("polyline" | "polygon", "points") => number_list(raw, decimals),
            (local, name) if geometry(local, name) => number_list(raw, decimals),
            _ => None,
        };
        if let Some(text) = rewritten.filter(|text| text != raw) {
            edits.push(Edit {
                start: attr.raw.0,
                end: attr.raw.1,
                text,
            });
        }
    }
}

/// I separatori di una lista di numeri o di un `d`: spazi e virgole.
fn separators(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && (is_wsp(bytes[i]) || bytes[i] == b',') {
        i += 1;
    }
    i
}

/// Una lista di numeri senza unità, separati da spazi o virgole, riscritta a
/// `decimals` decimali con gli stessi separatori. `None` se c'è altro, come
/// un'unità o una parola chiave: il valore resta com'è.
fn number_list(raw: &str, decimals: usize) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let mut touching = false;
    loop {
        let from = i;
        i = separators(bytes, i);
        out.push_str(&raw[from..i]);
        if i == bytes.len() {
            break;
        }
        let (value, next) = scan_number(raw, i)?;
        let after = bytes.get(next).copied();
        if after.is_some_and(|b| !(is_wsp(b) || matches!(b, b',' | b'+' | b'-' | b'.'))) {
            return None;
        }
        if touching && i == from {
            out.push(' ');
        }
        out.push_str(&format_number(value, decimals));
        touching = true;
        i = next;
    }
    Some(out)
}

/// Quanti numeri prende ogni comando di un path.
fn arity(command: u8) -> usize {
    match command {
        b'M' | b'L' | b'T' => 2,
        b'H' | b'V' => 1,
        b'C' => 6,
        b'S' | b'Q' => 4,
        b'A' => 7,
        _ => 0,
    }
}

/// L'asse del numero `at` di un comando, se è una coordinata: 0 per x, 1 per
/// y. I raggi e la rotazione di un arco non lo sono.
fn axis(command: u8, at: usize) -> Option<usize> {
    match command {
        b'H' => Some(0),
        b'V' => Some(1),
        b'A' => match at {
            5 => Some(0),
            6 => Some(1),
            _ => None,
        },
        _ => Some(at % 2),
    }
}

/// Un `d` riscritto a `decimals` decimali, con gli stessi comandi, separatori
/// e bandierine degli archi. `None` se non segue la grammatica fino in fondo:
/// il valore resta com'è.
///
/// Una coordinata relativa si arrotonda da sola finché il punto che fa resta
/// entro mezzo decimale da dov'era; quando gli arrotondamenti di prima lo
/// porterebbero più in là, si arrotonda dal punto già scritto. Così l'errore
/// non si somma lungo il tracciato.
fn path_data(raw: &str, decimals: usize) -> Option<String> {
    let bytes = raw.as_bytes();
    let factor = POWERS_OF_TEN[decimals];
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let mut command: Option<u8> = None;
    let mut count = 0;
    let mut touching = false;
    // Il punto corrente com'era e com'è scritto, l'inizio del sottotracciato,
    // e la fine del segmento in corso.
    let (mut exact, mut written) = ([0.0f64; 2], [0.0f64; 2]);
    let (mut start_exact, mut start_written) = ([0.0f64; 2], [0.0f64; 2]);
    let (mut end_exact, mut end_written) = ([0.0f64; 2], [0.0f64; 2]);
    let complete = |command: Option<u8>, count: usize| match command {
        None => true,
        Some(c) => match arity(c.to_ascii_uppercase()) {
            0 => count == 0,
            n => count > 0 && count % n == 0,
        },
    };
    loop {
        let from = i;
        i = separators(bytes, i);
        out.push_str(&raw[from..i]);
        if i == bytes.len() {
            break;
        }
        let b = bytes[i];
        if b.is_ascii_alphabetic() {
            if !b"MmZzLlHhVvCcSsQqTtAa".contains(&b)
                || !complete(command, count)
                || (command.is_none() && !matches!(b, b'M' | b'm'))
            {
                return None;
            }
            if matches!(b, b'Z' | b'z') {
                exact = start_exact;
                written = start_written;
            }
            out.push(b as char);
            command = Some(b);
            count = 0;
            touching = false;
            i += 1;
            continue;
        }
        let c = command?;
        let upper = c.to_ascii_uppercase();
        let n = arity(upper);
        if n == 0 {
            return None;
        }
        let at = count % n;
        if upper == b'A' && (at == 3 || at == 4) {
            if !matches!(b, b'0' | b'1') {
                return None;
            }
            out.push(b as char);
            touching = false;
            i += 1;
        } else {
            let (value, next) = scan_number(raw, i)?;
            if touching && i == from {
                out.push(' ');
            }
            match axis(upper, at) {
                None => out.push_str(&format_number(value, decimals)),
                Some(k) => {
                    let (target, base) = if c.is_ascii_lowercase() {
                        (exact[k] + value, written[k])
                    } else {
                        (value, 0.0)
                    };
                    let mut units = round_half_up(value, factor);
                    // Mezzo decimale, e un margine per l'aritmetica dei double.
                    if (base + units / factor - target).abs() > 0.5 / factor * (1.0 + 1e-9) {
                        units = round_half_up(target - base, factor);
                    }
                    end_exact[k] = target;
                    end_written[k] = base + units / factor;
                    out.push_str(&format_units(units, decimals));
                }
            }
            touching = true;
            i = next;
        }
        count += 1;
        if count % n == 0 {
            match upper {
                b'H' => (exact[0], written[0]) = (end_exact[0], end_written[0]),
                b'V' => (exact[1], written[1]) = (end_exact[1], end_written[1]),
                _ => (exact, written) = (end_exact, end_written),
            }
            if upper == b'M' && count == n {
                (start_exact, start_written) = (exact, written);
            }
        }
    }
    complete(command, count).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svg(body: &str) -> String {
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 100 100\" width=\"100\" height=\"100\">{body}</svg>\n"
        )
    }

    fn cleaned(text: &str) -> String {
        let once = clean(text, &Scope::Drawing).unwrap();
        assert_eq!(
            clean(&once, &Scope::Drawing).unwrap(),
            once,
            "ripulire due volte"
        );
        once
    }

    #[test]
    fn number_lists_keep_their_separators() {
        assert_eq!(number_list("1.234, 5.678", 2).unwrap(), "1.23, 5.68");
        assert_eq!(number_list(" 10-5.5.5 ", 2).unwrap(), " 10 -5.5 0.5 ");
        assert_eq!(number_list("1e2", 2).unwrap(), "100");
        assert_eq!(number_list("12px", 2), None);
        assert_eq!(number_list("50%", 2), None);
        assert_eq!(number_list("none", 2), None);
    }

    #[test]
    fn a_path_keeps_its_commands_and_flags() {
        assert_eq!(
            path_data("M10.123,20.456L30.789-40.001", 2).unwrap(),
            "M10.12,20.46L30.79 -40"
        );
        assert_eq!(
            path_data("M0 0a10.5 10.5 0 0110.555.5z", 2).unwrap(),
            "M0 0a10.5 10.5 0 0110.56 0.5z"
        );
        assert_eq!(path_data("M0 0 L", 2), None);
        assert_eq!(path_data("L0 0", 2), None);
        assert_eq!(path_data("M0 0 Z 1 1", 2), None);
        assert_eq!(path_data("", 2).unwrap(), "");
    }

    #[test]
    fn relative_coordinates_do_not_drift() {
        let d = format!("m0 0{}", " l0.004 0".repeat(1000));
        let rewritten = path_data(&d, 2).unwrap();
        let mut x = 0.0;
        for step in rewritten.split(" l").skip(1) {
            x += step.split(' ').next().unwrap().parse::<f64>().unwrap();
        }
        assert!((x - 4.0).abs() < 0.006, "{x}");
    }

    #[test]
    fn decimals_grow_with_the_magnification() {
        let m = |s: f64| Matrix([s, 0.0, 0.0, s, 0.0, 0.0]);
        assert_eq!(decimals(&m(1.0)), 2);
        assert_eq!(decimals(&m(0.01)), 2);
        assert_eq!(decimals(&m(10.0)), 3);
        assert_eq!(decimals(&m(99.0)), 3);
        assert_eq!(decimals(&m(1e9)), 6);
        assert_eq!(decimals(&Matrix([1.0, 0.0, 50.0, 1.0, 0.0, 0.0])), 3);
    }

    #[test]
    fn what_only_editors_need_goes_away() {
        let text = format!(
            "<?xml version=\"1.0\"?>\n<!-- prima -->\n{}",
            svg("<metadata>m</metadata><!-- c --><?pi x?><g fub:layer=\"L\" id=\"g\"><rect width=\"1.006\" height=\"2\" fub:ink=\"x\"/></g>")
        );
        assert_eq!(
            cleaned(&text),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" width=\"100\" height=\"100\"><g id=\"g\"><rect width=\"1.01\" height=\"2\"/></g></svg>\n"
        );
    }

    #[test]
    fn hidden_things_stay_when_something_uses_them() {
        let text = svg(concat!(
            "<g display=\"none\"><path id=\"p\" d=\"M0 0\"/></g>",
            "<g style=\"display:none\"><path id=\"q\" d=\"M0 0\"/></g>",
            "<g display=\"none\" style=\"display: inline\"/>",
            "<use href=\"#p\"/>"
        ));
        assert_eq!(
            cleaned(&text),
            svg(concat!(
                "<g display=\"none\"><path id=\"p\" d=\"M0 0\"/></g>",
                "<g display=\"none\" style=\"display: inline\"/>",
                "<use href=\"#p\"/>"
            ))
            .replace(
                " xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\"",
                ""
            )
        );
    }

    #[test]
    fn a_resource_used_only_by_what_goes_away_goes_too() {
        let text = svg(concat!(
            "\n  <defs>\n    <linearGradient id=\"a\"/>\n    <linearGradient id=\"b\" href=\"#a\"/>\n",
            "    <linearGradient id=\"c\"/>\n    <style>.x{fill:url(#c)}</style>\n  </defs>\n",
            "  <g display=\"none\"><rect fill=\"url(#b)\"/></g>\n"
        ));
        let out = cleaned(&text);
        assert!(
            !out.contains("id=\"a\"") && !out.contains("id=\"b\""),
            "{out}"
        );
        assert!(out.contains("id=\"c\"") && out.contains("<style>"), "{out}");
        let empty = cleaned(&svg(
            "\n  <defs>\n    <linearGradient id=\"a\"/>\n  </defs>\n  <rect/>\n",
        ));
        assert!(!empty.contains("defs"), "{empty}");
    }

    #[test]
    fn entities_are_expanded_before_the_doctype_goes() {
        let text = concat!(
            "<?xml version=\"1.0\"?>\n<!DOCTYPE svg [\n<!ENTITY ns \"http://www.w3.org/2000/svg\">\n",
            "<!ENTITY dot \"<circle r='1'/>\">\n<!ENTITY far SYSTEM \"x.ent\">\n]>\n",
            "<svg xmlns=\"&ns;\" width=\"10\" height=\"10\">&dot;&far;<text>a&amp;b</text></svg>\n"
        );
        assert_eq!(
            cleaned(text),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><circle r='1'/><text>a&amp;b</text></svg>\n"
        );
    }

    #[test]
    fn boards_go_away_outside_the_whole_drawing() {
        let text = svg("<view id=\"b\" fub:role=\"board\" viewBox=\"0 0 10 10\"/><rect/>");
        assert!(clean(&text, &Scope::Drawing).unwrap().contains("<view"));
        let board = clean(&text, &Scope::Board("b".into())).unwrap();
        assert!(!board.contains("<view"), "{board}");
    }

    #[test]
    fn prefixes_still_in_use_keep_their_declaration() {
        let text = concat!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:x=\"urn:x\" xmlns:y=\"urn:y\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
            "<foreignObject><x:p y:q=\"1\"/></foreignObject><y:r/></svg>"
        );
        assert_eq!(
            cleaned(text),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:x=\"urn:x\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><foreignObject><x:p/></foreignObject></svg>\n"
        );
    }

    #[test]
    fn embedding_replaces_only_the_references_of_images() {
        let text = concat!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
            "<image href=\"foto/a&amp;b.png\" width=\"4\"/>",
            "<image xlink:href='foto/c.png'/>",
            "<image href=\"https://example.org/d.png\"/>",
            "<use href=\"foto/a&amp;b.png\"/><a href=\"foto/c.png\"/></svg>"
        );
        let mut asked = Vec::new();
        let out = embed_images(text, |href| {
            asked.push(href.to_owned());
            (!href.starts_with("https:"))
                .then(|| format!("data:image/png;base64,{}\"&", href.len()))
        })
        .unwrap();
        // Il valore letto, con l'entità risolta, e soltanto quello delle
        // immagini; ciò che si scrive al suo posto è un valore d'attributo.
        assert_eq!(
            asked,
            ["foto/a&b.png", "foto/c.png", "https://example.org/d.png"]
        );
        assert_eq!(
            out,
            concat!(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
                "<image href=\"data:image/png;base64,12&quot;&amp;\" width=\"4\"/>",
                "<image xlink:href='data:image/png;base64,10&quot;&amp;'/>",
                "<image href=\"https://example.org/d.png\"/>",
                "<use href=\"foto/a&amp;b.png\"/><a href=\"foto/c.png\"/></svg>"
            )
        );
        // Senza niente da sostituire, il testo è quello di prima.
        assert_eq!(embed_images(text, |_| None).unwrap(), text);
        assert!(embed_images("<html/>", |_| None).is_err());
    }
}
