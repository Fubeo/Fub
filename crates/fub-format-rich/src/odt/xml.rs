//! Un albero XML che ricorda da quali byte viene ogni nodo.
//!
//! Il codec OpenDocument riscrive soltanto ciò che cambia: un paragrafo
//! modificato prende il posto dei byte del vecchio, e tutto il resto del file
//! resta com'era, carattere per carattere. Per questo ogni nodo porta
//! l'intervallo dei propri byte nel sorgente, e ogni elemento quello del suo
//! tag d'apertura.
//!
//! Il testo è decodificato (entità e riferimenti a carattere risolti); commenti,
//! istruzioni di elaborazione e dichiarazioni non diventano nodi, ma restano
//! dentro l'intervallo del loro genitore.

use std::ops::Range;

use quick_xml::events::{BytesStart, Event};

use crate::RichError;

/// L'indice di un nodo in [`Tree::nodes`].
pub(crate) type NodeId = usize;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Tree {
    pub source: Vec<u8>,
    pub nodes: Vec<Node>,
    pub root: NodeId,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Node {
    /// I byte del nodo intero nel sorgente.
    pub span: Range<usize>,
    pub parent: Option<NodeId>,
    pub kind: Kind,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Kind {
    Element(Element),
    Text(String),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Element {
    /// Il nome qualificato com'è scritto (`text:p`).
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<NodeId>,
    /// I byte del tag d'apertura (per un elemento vuoto, l'elemento intero).
    pub open: Range<usize>,
}

impl Element {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

impl Tree {
    /// Legge un documento XML ben formato. Un errore di sintassi, un tag di
    /// chiusura che non corrisponde o un documento senza radice sono
    /// [`RichError::Codec`]: il file non si riscrive da un albero indovinato.
    pub fn parse(source: Vec<u8>) -> Result<Tree, RichError> {
        let nodes = build(&source)?;
        let root = nodes
            .iter()
            .position(|node| node.parent.is_none() && matches!(node.kind, Kind::Element(_)))
            .ok_or_else(|| RichError::Codec("xml without a root element".into()))?;
        Ok(Tree {
            source,
            nodes,
            root,
        })
    }

    pub fn element(&self, id: NodeId) -> Option<&Element> {
        match &self.nodes[id].kind {
            Kind::Element(element) => Some(element),
            Kind::Text(_) => None,
        }
    }

    /// Il nome dell'elemento `id`, o `""` per un testo.
    pub fn name(&self, id: NodeId) -> &str {
        self.element(id).map_or("", |e| e.name.as_str())
    }

    pub fn children(&self, id: NodeId) -> &[NodeId] {
        self.element(id).map_or(&[], |e| e.children.as_slice())
    }

    /// I figli elemento di `id`.
    pub fn elements(&self, id: NodeId) -> impl Iterator<Item = (NodeId, &Element)> + '_ {
        self.children(id)
            .iter()
            .filter_map(|&child| self.element(child).map(|e| (child, e)))
    }

    /// Il primo figlio elemento di `id` con questo nome.
    pub fn child(&self, id: NodeId, name: &str) -> Option<NodeId> {
        self.elements(id)
            .find(|(_, e)| e.name == name)
            .map(|(child, _)| child)
    }

    /// I byte del nodo nel sorgente.
    #[cfg(test)]
    pub fn bytes(&self, id: NodeId) -> &[u8] {
        &self.source[self.nodes[id].span.clone()]
    }

    /// I byte del tag d'apertura di un elemento.
    pub fn open_tag(&self, id: NodeId) -> &[u8] {
        match &self.nodes[id].kind {
            Kind::Element(e) => &self.source[e.open.clone()],
            Kind::Text(_) => &[],
        }
    }

    /// Il primo discendente di `id`, `id` compreso, con questo nome.
    pub fn find(&self, id: NodeId, name: &str) -> Option<NodeId> {
        let mut todo = vec![id];
        while let Some(next) = todo.pop() {
            if self.name(next) == name {
                return Some(next);
            }
            todo.extend(self.children(next).iter().rev());
        }
        None
    }
}

/// Lo stesso albero di [`Tree::parse`], per i byte di un solo elemento: il
/// tag d'apertura di un paragrafo, l'XML di un oggetto. `None` se non sono un
/// solo elemento ben formato.
pub(crate) fn single_element(source: &[u8]) -> Option<Tree> {
    let tree = Tree::parse(source.to_vec()).ok()?;
    let root = &tree.nodes[tree.root];
    let alone = tree
        .nodes
        .iter()
        .filter(|node| node.parent.is_none())
        .count()
        == 1;
    (alone && root.span == (0..source.len())).then_some(tree)
}

fn codec(error: impl std::fmt::Display) -> RichError {
    RichError::Codec(format!("xml: {error}"))
}

fn build(source: &[u8]) -> Result<Vec<Node>, RichError> {
    let mut reader = quick_xml::Reader::from_reader(source);
    let config = reader.config_mut();
    config.trim_text(false);
    config.check_end_names = true;
    config.expand_empty_elements = false;

    let mut nodes: Vec<Node> = Vec::new();
    let mut open: Vec<NodeId> = Vec::new();
    loop {
        let start = position(&reader)?;
        let event = reader.read_event().map_err(codec)?;
        let end = position(&reader)?;
        match event {
            Event::Start(tag) => {
                let id = push_element(&mut nodes, &open, &tag, start..end)?;
                open.push(id);
            }
            Event::Empty(tag) => {
                push_element(&mut nodes, &open, &tag, start..end)?;
            }
            Event::End(_) => {
                let id = open
                    .pop()
                    .ok_or_else(|| RichError::Codec("xml: unmatched end tag".into()))?;
                nodes[id].span.end = end;
            }
            Event::Text(text) => {
                let text = text.decode().map_err(codec)?;
                push_text(&mut nodes, &open, &text, start..end);
            }
            Event::CData(data) => {
                let text = data.decode().map_err(codec)?;
                push_text(&mut nodes, &open, &text, start..end);
            }
            Event::GeneralRef(reference) => {
                let text = match reference.decode().map_err(codec)?.as_ref() {
                    "amp" => "&".to_string(),
                    "lt" => "<".to_string(),
                    "gt" => ">".to_string(),
                    "quot" => "\"".to_string(),
                    "apos" => "'".to_string(),
                    other => reference
                        .resolve_char_ref()
                        .map_err(codec)?
                        .map(String::from)
                        .ok_or_else(|| RichError::Codec(format!("xml: unknown entity {other}")))?,
                };
                push_text(&mut nodes, &open, &text, start..end);
            }
            Event::Eof => break,
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
        }
    }
    if !open.is_empty() {
        return Err(RichError::Codec("xml: unclosed element".into()));
    }
    Ok(nodes)
}

fn position(reader: &quick_xml::Reader<&[u8]>) -> Result<usize, RichError> {
    usize::try_from(reader.buffer_position()).map_err(codec)
}

fn push_element(
    nodes: &mut Vec<Node>,
    open: &[NodeId],
    tag: &BytesStart<'_>,
    span: Range<usize>,
) -> Result<NodeId, RichError> {
    let name = String::from_utf8(tag.name().as_ref().to_vec()).map_err(codec)?;
    let mut attrs = Vec::new();
    for attr in tag.attributes() {
        let attr = attr.map_err(codec)?;
        let key = String::from_utf8(attr.key.as_ref().to_vec()).map_err(codec)?;
        let value = attr
            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
            .map_err(codec)?
            .into_owned();
        attrs.push((key, value));
    }
    let id = nodes.len();
    let parent = open.last().copied();
    nodes.push(Node {
        span: span.clone(),
        parent,
        kind: Kind::Element(Element {
            name,
            attrs,
            children: Vec::new(),
            open: span,
        }),
    });
    if let Some(parent) = parent {
        if let Kind::Element(e) = &mut nodes[parent].kind {
            e.children.push(id);
        }
    }
    Ok(id)
}

/// Un testo, unito al testo che lo precede subito: `a &amp; b` è un nodo solo.
fn push_text(nodes: &mut Vec<Node>, open: &[NodeId], text: &str, span: Range<usize>) {
    let parent = open.last().copied();
    let last = parent.and_then(|p| match &nodes[p].kind {
        Kind::Element(e) => e.children.last().copied(),
        Kind::Text(_) => None,
    });
    if let Some(last) = last {
        if nodes[last].span.end == span.start {
            if let Kind::Text(previous) = &mut nodes[last].kind {
                previous.push_str(text);
                nodes[last].span.end = span.end;
                return;
            }
        }
    }
    let id = nodes.len();
    nodes.push(Node {
        span,
        parent,
        kind: Kind::Text(text.to_string()),
    });
    if let Some(parent) = parent {
        if let Kind::Element(e) = &mut nodes[parent].kind {
            e.children.push(id);
        }
    }
}

/// Il testo per un nodo di testo XML, con la tabella di `fub_abi::html`:
/// virgolette e apici come entità sono XML valido e si rileggono uguali.
pub(crate) fn escape_text(text: &str, out: &mut String) {
    out.push_str(&fub_abi::html::escape(text));
}

/// Il valore di un attributo fra virgolette doppie. Tabulazione e a capo
/// restano riferimenti numerici: letterali, chi legge l'XML li normalizza in
/// spazi, e quella tabella non li conosce perché in HTML non serve.
pub(crate) fn escape_attr(value: &str, out: &mut String) {
    for c in fub_abi::html::escape(value).chars() {
        match c {
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
}

/// Un tag d'apertura con questi attributi, nell'ordine dato.
pub(crate) fn open_tag(name: &str, attrs: &[(String, String)], empty: bool) -> String {
    let mut out = String::new();
    out.push('<');
    out.push_str(name);
    for (key, value) in attrs {
        out.push(' ');
        out.push_str(key);
        out.push_str("=\"");
        escape_attr(value, &mut out);
        out.push('"');
    }
    out.push_str(if empty { "/>" } else { ">" });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(xml: &str) -> Tree {
        Tree::parse(xml.as_bytes().to_vec()).unwrap()
    }

    #[test]
    fn ogni_nodo_sa_da_quali_byte_viene() {
        let xml = "<?xml version=\"1.0\"?><a x=\"1\"><!-- c --><b>uno &amp; due</b><c/></a>";
        let t = tree(xml);
        assert_eq!(t.name(t.root), "a");
        assert_eq!(t.bytes(t.root), &xml.as_bytes()[21..]);
        let b = t.child(t.root, "b").unwrap();
        assert_eq!(t.bytes(b), b"<b>uno &amp; due</b>");
        assert_eq!(t.open_tag(b), b"<b>");
        let text = t.children(b)[0];
        assert_eq!(t.nodes[text].kind, Kind::Text("uno & due".into()));
        let c = t.child(t.root, "c").unwrap();
        assert_eq!(t.bytes(c), b"<c/>");
        assert_eq!(t.element(t.root).unwrap().attr("x"), Some("1"));
    }

    #[test]
    fn un_xml_rotto_è_un_errore_del_codec() {
        for bad in ["<a><b></a>", "<a>", "<a>&nope;</a>", "testo"] {
            assert!(
                matches!(
                    Tree::parse(bad.as_bytes().to_vec()),
                    Err(RichError::Codec(_))
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn i_riferimenti_a_carattere_si_risolvono() {
        let t = tree("<a>&#233;&#x41;</a>");
        let text = t.children(t.root)[0];
        assert_eq!(t.nodes[text].kind, Kind::Text("éA".into()));
    }

    #[test]
    fn un_solo_elemento() {
        assert!(single_element(b"<text:note text:id=\"n1\"><x/></text:note>").is_some());
        assert!(single_element(b"<a/><b/>").is_none());
        assert!(single_element(b"<a>").is_none());
        assert!(single_element(b"testo").is_none());
    }

    #[test]
    fn i_tag_riscritti_si_rileggono_uguali() {
        let attrs = vec![("text:style-name".to_string(), "P\"1 & <2>\n".to_string())];
        let tag = open_tag("text:p", &attrs, true);
        let t = tree(&tag);
        assert_eq!(t.element(t.root).unwrap().attrs, attrs);
        let mut text = String::new();
        escape_text("a < b & c > d", &mut text);
        let t = tree(&format!("<a>{text}</a>"));
        assert_eq!(
            t.nodes[t.children(t.root)[0]].kind,
            Kind::Text("a < b & c > d".into())
        );
    }
}
