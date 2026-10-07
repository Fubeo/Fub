//! Il livello XML: un albero ben formato con gli span di ogni nodo.
//!
//! `quick-xml` taglia la sorgente in eventi e dice dove finisce ognuno; tutto il
//! resto si controlla qui, sui byte grezzi di ogni evento. La ragione è che
//! `quick-xml` è un lettore indulgente: non valida i nomi né i riferimenti a
//! carattere, lascia passare `<` dentro un attributo e testo fuori dalla radice,
//! e il suo `NsReader` lega i namespace sui valori grezzi, prima di espandere le
//! entità. Un SVG che un browser rifiuta deve essere rifiutato anche qui:
//! altrimenti la superficie mostrerebbe come modificabile un disegno che
//! nessun altro visualizzatore apre.
//!
//! Gli offset sono byte sul file intero, BOM compreso: `quick-xml` salta il BOM
//! iniziale e conta da dopo, e ogni posizione che restituisce si somma a
//! [`bom_len`].

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fmt;

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;

use crate::text::bom_len;

/// L'indice di un nodo nell'arena di [`Document`].
pub(crate) type NodeId = usize;

/// Nessun namespace: gli attributi senza prefisso.
pub(crate) const NS_NONE: usize = 0;
/// `http://www.w3.org/2000/svg`.
pub(crate) const NS_SVG: usize = 1;
/// `https://fubeo.github.io/ns/scene/1`.
pub(crate) const NS_FUB: usize = 2;
/// `http://www.w3.org/1999/xlink`.
pub(crate) const NS_XLINK: usize = 3;
/// `http://www.w3.org/XML/1998/namespace`, legato per definizione a `xml`.
pub(crate) const NS_XML: usize = 4;
/// `http://www.w3.org/2000/xmlns/`, il namespace delle dichiarazioni.
pub(crate) const NS_XMLNS: usize = 5;
/// `http://www.w3.org/1999/xhtml`, l'HTML dentro i `foreignObject`.
pub(crate) const NS_XHTML: usize = 6;

const XML_URI: &str = "http://www.w3.org/XML/1998/namespace";
const XMLNS_URI: &str = "http://www.w3.org/2000/xmlns/";
const XHTML_URI: &str = "http://www.w3.org/1999/xhtml";

/// Quanto può annidarsi l'espansione di un'entità dentro un attributo.
const MAX_ENTITY_DEPTH: usize = 16;
/// Quanti byte possono produrre in tutto le entità espanse negli attributi: il
/// riparo dalla «billion laughs», che con dieci righe di DTD chiede gigabyte.
const MAX_ENTITY_EXPANSION: usize = 1 << 20;

/// Perché una sorgente non è XML ben formato.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum XmlErrorKind {
    /// Un costrutto aperto e mai chiuso: commento, CDATA, istruzione, tag,
    /// valore di attributo.
    UnclosedMarkup,
    /// Un `<!…>` che non è commento, CDATA o `DOCTYPE`, o un tag sintatticamente
    /// rotto.
    InvalidMarkup,
    /// Un carattere che XML 1.0 non ammette, come i controlli C0.
    InvalidChar,
    /// Un nome di elemento, attributo, entità o prefisso non valido.
    InvalidName,
    /// Un `&` che non apre un riferimento valido, o un riferimento a un
    /// carattere vietato.
    InvalidReference,
    /// Un riferimento a un'entità che nessuno ha dichiarato.
    UndeclaredEntity,
    /// Un'entità esterna o non analizzata usata dove non può stare.
    ExternalEntity,
    /// Entità annidate oltre il limite di profondità o di espansione.
    EntityLimit,
    /// Un `<` dentro il valore di un attributo.
    LessThanInAttribute,
    /// `]]>` nel testo.
    CdataEndInText,
    /// Un commento con `--` all'interno o un `-` in fondo.
    InvalidComment,
    /// Un'istruzione di elaborazione con un nome riservato o malformato.
    InvalidProcessingInstruction,
    /// Una dichiarazione `<?xml …?>` malformata.
    InvalidDeclaration,
    /// Una dichiarazione `<?xml …?>` che non sta in testa al file.
    MisplacedDeclaration,
    /// Un `<!DOCTYPE>` malformato.
    InvalidDoctype,
    /// Un `<!DOCTYPE>` dopo la radice, o un secondo.
    MisplacedDoctype,
    /// Lo stesso attributo due volte nello stesso tag.
    DuplicateAttribute,
    /// Un tag di chiusura che non chiude l'elemento aperto.
    MismatchedEndTag,
    /// Un tag di chiusura senza elemento aperto.
    UnmatchedEndTag,
    /// Un elemento aperto alla fine del file.
    UnclosedElement,
    /// Un prefisso che nessuna dichiarazione lega.
    UndeclaredPrefix,
    /// Una dichiarazione di namespace vietata, come `xmlns:p=""`.
    InvalidNamespaceDeclaration,
    /// Testo, CDATA o riferimenti fuori dalla radice.
    ContentOutsideRoot,
    /// Nessun elemento radice.
    MissingRoot,
    /// Un secondo elemento dopo la radice.
    MultipleRoots,
}

impl fmt::Display for XmlErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            XmlErrorKind::UnclosedMarkup => "costrutto non chiuso",
            XmlErrorKind::InvalidMarkup => "marcatura non valida",
            XmlErrorKind::InvalidChar => "carattere non ammesso da XML",
            XmlErrorKind::InvalidName => "nome non valido",
            XmlErrorKind::InvalidReference => "riferimento non valido",
            XmlErrorKind::UndeclaredEntity => "entità non dichiarata",
            XmlErrorKind::ExternalEntity => "entità esterna fuori posto",
            XmlErrorKind::EntityLimit => "entità annidate oltre il limite",
            XmlErrorKind::LessThanInAttribute => "`<` nel valore di un attributo",
            XmlErrorKind::CdataEndInText => "`]]>` nel testo",
            XmlErrorKind::InvalidComment => "commento non valido",
            XmlErrorKind::InvalidProcessingInstruction => "istruzione di elaborazione non valida",
            XmlErrorKind::InvalidDeclaration => "dichiarazione XML non valida",
            XmlErrorKind::MisplacedDeclaration => "dichiarazione XML fuori posto",
            XmlErrorKind::InvalidDoctype => "DOCTYPE non valido",
            XmlErrorKind::MisplacedDoctype => "DOCTYPE fuori posto",
            XmlErrorKind::DuplicateAttribute => "attributo ripetuto",
            XmlErrorKind::MismatchedEndTag => "tag di chiusura diverso da quello aperto",
            XmlErrorKind::UnmatchedEndTag => "tag di chiusura senza apertura",
            XmlErrorKind::UnclosedElement => "elemento non chiuso",
            XmlErrorKind::UndeclaredPrefix => "prefisso non dichiarato",
            XmlErrorKind::InvalidNamespaceDeclaration => "dichiarazione di namespace non valida",
            XmlErrorKind::ContentOutsideRoot => "contenuto fuori dalla radice",
            XmlErrorKind::MissingRoot => "manca l'elemento radice",
            XmlErrorKind::MultipleRoots => "più di un elemento radice",
        })
    }
}

/// Un errore di buona formazione, al byte in cui si vede.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) struct XmlError {
    pub offset: usize,
    pub kind: XmlErrorKind,
}

type Result<T> = std::result::Result<T, XmlError>;

fn fail<T>(offset: usize, kind: XmlErrorKind) -> Result<T> {
    Err(XmlError { offset, kind })
}

/// Un documento XML letto: l'arena dei nodi e i fatti del prologo.
pub(crate) struct Document<'a> {
    pub source: &'a str,
    pub nodes: Vec<Node<'a>>,
    /// I nodi di primo livello in ordine: prologo, radice, epilogo.
    pub top: Vec<NodeId>,
    pub root: NodeId,
    /// La codifica dichiarata da `<?xml … encoding="…"?>`, se c'è.
    pub encoding: Option<&'a str>,
    pub doctype: Option<NodeId>,
    /// Quanti elementi, di qualunque namespace, radice compresa.
    pub elements: usize,
    /// Falso quando la lettura si è fermata dopo la testa (§11).
    pub complete: bool,
    entities: HashMap<&'a str, Entity>,
}

/// Un nodo con i suoi byte `[start, end)`.
pub(crate) struct Node<'a> {
    pub kind: Kind<'a>,
    pub start: usize,
    pub end: usize,
    pub parent: Option<NodeId>,
}

/// Che cosa è un nodo.
pub(crate) enum Kind<'a> {
    Element(Element<'a>),
    /// Dati di carattere, con i riferimenti predefiniti e numerici già risolti
    /// e i terminatori già ridotti a `\n`. `blank` dice se i byte grezzi sono
    /// soltanto spazi XML.
    Text {
        value: Cow<'a, str>,
        blank: bool,
    },
    /// Una sezione CDATA, col suo contenuto.
    CData(Cow<'a, str>),
    Comment,
    Pi,
    Decl,
    Doctype,
    /// Un riferimento a un'entità dichiarata nel `DOCTYPE`, col suo nome.
    EntityRef(&'a str),
}

/// Un elemento: nome, namespace, attributi, figli e dove finisce il suo tag
/// d'apertura.
pub(crate) struct Element<'a> {
    pub name: &'a str,
    pub local: &'a str,
    pub ns: usize,
    pub attrs: Vec<Attr<'a>>,
    pub children: Vec<NodeId>,
    /// Il byte dopo il `>` del tag d'apertura.
    pub open_end: usize,
    /// Il byte del `<` del tag di chiusura; `None` per un tag autochiuso.
    pub close_start: Option<usize>,
}

impl<'a> Element<'a> {
    /// L'attributo `local` nel namespace `ns`.
    pub fn attr(&self, ns: usize, local: &str) -> Option<&Attr<'a>> {
        self.attrs.iter().find(|a| a.ns == ns && a.local == local)
    }

    /// Il valore normalizzato dell'attributo `local` nel namespace `ns`.
    pub fn value(&self, ns: usize, local: &str) -> Option<&str> {
        self.attr(ns, local).map(|a| a.value.as_ref())
    }

    /// Vero se l'elemento è `local` nel namespace SVG.
    pub fn is_svg(&self, local: &str) -> bool {
        self.ns == NS_SVG && self.local == local
    }
}

/// Un attributo: il nome com'è scritto, il namespace risolto e il valore
/// normalizzato come lo vede un parser XML.
pub(crate) struct Attr<'a> {
    pub name: &'a str,
    pub local: &'a str,
    pub ns: usize,
    pub value: Cow<'a, str>,
    /// I byte del valore grezzo, virgolette escluse.
    pub raw: (usize, usize),
}

/// Un'entità generale dichiarata nel sottoinsieme interno del `DOCTYPE`.
#[derive(Clone, Debug)]
enum Entity {
    /// Il testo di sostituzione, coi riferimenti a carattere già espansi.
    Internal(String),
    /// Un'entità esterna analizzata: nessun browser la carica.
    External,
    /// Un'entità esterna non analizzata (`NDATA`).
    Unparsed,
    /// Un valore che usa entità parametriche, che qui non si risolvono.
    Unresolved,
}

impl Document<'_> {
    /// L'elemento `id`, se il nodo è un elemento.
    pub fn element(&self, id: NodeId) -> Option<&Element<'_>> {
        match &self.nodes[id].kind {
            Kind::Element(element) => Some(element),
            _ => None,
        }
    }

    /// I figli di `id`, vuoti se il nodo non è un elemento.
    pub fn children(&self, id: NodeId) -> &[NodeId] {
        self.element(id).map_or(&[], |e| e.children.as_slice())
    }

    /// Il testo di sostituzione di un'entità interna, se è testo semplice:
    /// senza marcatura e senza altri riferimenti. Serve all'indice, che lo
    /// legge come testo; tutto il resto non si espande.
    pub fn plain_entity(&self, name: &str) -> Option<&str> {
        match self.entities.get(name) {
            Some(Entity::Internal(text)) if !text.contains(['<', '&']) => Some(text),
            _ => None,
        }
    }

    /// Il testo di sostituzione di un'entità interna, com'è: con la marcatura
    /// e i riferimenti alle altre entità. `None` per un'entità esterna, che
    /// nessun browser carica. Serve all'SVG pulito, che le espande.
    pub fn internal_entity(&self, name: &str) -> Option<&str> {
        match self.entities.get(name) {
            Some(Entity::Internal(text)) => Some(text),
            _ => None,
        }
    }
}

/// Legge `source` come documento XML con namespace.
///
/// Con `head_only` si ferma al primo figlio della radice che non è `title` o
/// `desc`: è la lettura dei file oltre il limite di §11, che indicizza solo
/// titolo e riepilogo.
pub(crate) fn parse(source: &str, head_only: bool) -> Result<Document<'_>> {
    let bom = bom_len(source);
    let mut reader = Reader::from_str(source);
    let config = reader.config_mut();
    // I nomi di chiusura, i commenti e le entità si controllano qui sotto, sui
    // byte: `quick-xml` serve solo a tagliare gli eventi.
    config.check_end_names = false;
    config.allow_unmatched_ends = true;
    config.check_comments = false;
    config.expand_empty_elements = false;
    config.allow_dangling_amp = false;
    config.trim_text(false);

    let mut parser = Parser::new(source);
    let mut position = bom;
    let mut stop = None;
    loop {
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(error) => {
                let offset = bom + reader.error_position() as usize;
                return fail(offset, kind_of(&error));
            }
        };
        let start = position;
        let end = bom + reader.buffer_position() as usize;
        position = end;
        parser.check_chars(start, end)?;
        match event {
            Event::Eof => break,
            Event::Text(_) => parser.text(start, end)?,
            Event::GeneralRef(_) => parser.reference(start, end)?,
            Event::Start(_) | Event::Empty(_) => {
                let empty = matches!(event, Event::Empty(_));
                let id = parser.open(start, end, empty)?;
                if head_only && parser.leaves_head(id) {
                    parser.retract(id, empty);
                    stop = Some(start);
                    break;
                }
            }
            Event::End(_) => parser.close(start, end)?,
            Event::Comment(_) => parser.comment(start, end)?,
            Event::PI(_) => parser.pi(start, end)?,
            Event::Decl(_) => parser.decl(start, end)?,
            Event::CData(_) => parser.cdata(start, end)?,
            Event::DocType(_) => parser.doctype(start, end)?,
        }
    }
    parser.finish(stop)
}

/// La forma tipizzata di un errore di `quick-xml`.
fn kind_of(error: &quick_xml::Error) -> XmlErrorKind {
    use quick_xml::errors::{IllFormedError, SyntaxError};
    match error {
        quick_xml::Error::Syntax(SyntaxError::InvalidBangMarkup) => XmlErrorKind::InvalidMarkup,
        quick_xml::Error::Syntax(_) => XmlErrorKind::UnclosedMarkup,
        quick_xml::Error::IllFormed(IllFormedError::MissingDoctypeName) => {
            XmlErrorKind::InvalidDoctype
        }
        quick_xml::Error::IllFormed(IllFormedError::MissingDeclVersion(_))
        | quick_xml::Error::IllFormed(IllFormedError::UnknownVersion) => {
            XmlErrorKind::InvalidDeclaration
        }
        quick_xml::Error::IllFormed(IllFormedError::DoubleHyphenInComment) => {
            XmlErrorKind::InvalidComment
        }
        quick_xml::Error::IllFormed(IllFormedError::UnclosedReference) => {
            XmlErrorKind::InvalidReference
        }
        quick_xml::Error::IllFormed(IllFormedError::MismatchedEndTag { .. }) => {
            XmlErrorKind::MismatchedEndTag
        }
        quick_xml::Error::IllFormed(IllFormedError::UnmatchedEndTag(_)) => {
            XmlErrorKind::UnmatchedEndTag
        }
        quick_xml::Error::IllFormed(IllFormedError::MissingEndTag(_)) => {
            XmlErrorKind::UnclosedElement
        }
        _ => XmlErrorKind::InvalidMarkup,
    }
}

/// Il testo in attesa: eventi di testo e riferimenti contigui diventano un
/// solo nodo.
struct PendingText {
    start: usize,
    end: usize,
    /// Il valore, quando non coincide con i byte grezzi.
    owned: Option<String>,
}

struct Parser<'a> {
    source: &'a str,
    bom: usize,
    nodes: Vec<Node<'a>>,
    top: Vec<NodeId>,
    root: Option<NodeId>,
    stack: Vec<NodeId>,
    /// Le associazioni prefisso → namespace in vigore, dalla più vecchia.
    bindings: Vec<(Option<&'a str>, usize)>,
    /// Quante associazioni c'erano all'apertura di ogni elemento della pila.
    marks: Vec<usize>,
    namespaces: Vec<String>,
    entities: HashMap<&'a str, Entity>,
    expanded: usize,
    encoding: Option<&'a str>,
    doctype: Option<NodeId>,
    elements: usize,
    text: Option<PendingText>,
}

impl<'a> Parser<'a> {
    fn new(source: &'a str) -> Self {
        let namespaces = [
            "",
            crate::SVG_NS,
            crate::FUB_NS,
            crate::XLINK_NS,
            XML_URI,
            XMLNS_URI,
            XHTML_URI,
        ];
        Parser {
            source,
            bom: bom_len(source),
            nodes: Vec::new(),
            top: Vec::new(),
            root: None,
            stack: Vec::new(),
            bindings: vec![(Some("xml"), NS_XML)],
            marks: Vec::new(),
            namespaces: namespaces.iter().map(|s| s.to_string()).collect(),
            entities: HashMap::new(),
            expanded: 0,
            encoding: None,
            doctype: None,
            elements: 0,
            text: None,
        }
    }

    /// Rifiuta i caratteri che XML 1.0 non ammette: i controlli C0 salvo
    /// tabulazione e a capo, e `U+FFFE`, `U+FFFF`. I surrogati non arrivano:
    /// la sorgente è già UTF-8 valido.
    fn check_chars(&self, start: usize, end: usize) -> Result<()> {
        let bytes = &self.source.as_bytes()[start..end];
        for (i, &b) in bytes.iter().enumerate() {
            let bad = if b < 0x20 {
                !matches!(b, b'\t' | b'\n' | b'\r')
            } else {
                b == 0xEF
                    && bytes.get(i + 1) == Some(&0xBF)
                    && matches!(bytes.get(i + 2), Some(0xBE | 0xBF))
            };
            if bad {
                return fail(start + i, XmlErrorKind::InvalidChar);
            }
        }
        Ok(())
    }

    fn push(&mut self, kind: Kind<'a>, start: usize, end: usize) -> NodeId {
        let id = self.nodes.len();
        let parent = self.stack.last().copied();
        self.nodes.push(Node {
            kind,
            start,
            end,
            parent,
        });
        match parent {
            Some(parent) => {
                if let Kind::Element(element) = &mut self.nodes[parent].kind {
                    element.children.push(id);
                }
            }
            None => self.top.push(id),
        }
        id
    }

    fn text(&mut self, start: usize, end: usize) -> Result<()> {
        let raw = &self.source[start..end];
        if self.stack.is_empty() {
            if let Some(p) = raw.bytes().position(|b| !is_space(b)) {
                return fail(start + p, XmlErrorKind::ContentOutsideRoot);
            }
        } else if let Some(p) = raw.find("]]>") {
            return fail(start + p, XmlErrorKind::CdataEndInText);
        }
        let decoded = raw.contains('\r').then(|| eol(raw).into_owned());
        self.extend_text(start, end, decoded);
        Ok(())
    }

    /// Accoda `[start, end)` al testo in attesa; `decoded` è il suo valore
    /// quando non coincide con i byte.
    fn extend_text(&mut self, start: usize, end: usize, decoded: Option<String>) {
        if self.text.as_ref().is_some_and(|t| t.end != start) {
            self.flush_text();
        }
        let source = self.source;
        let pending = self.text.get_or_insert(PendingText {
            start,
            end: start,
            owned: None,
        });
        match decoded {
            None if pending.owned.is_none() => {}
            None => pending
                .owned
                .get_or_insert_with(String::new)
                .push_str(&source[start..end]),
            Some(value) => pending
                .owned
                .get_or_insert_with(|| source[pending.start..start].to_owned())
                .push_str(&value),
        }
        pending.end = end;
    }

    fn flush_text(&mut self) {
        let Some(pending) = self.text.take() else {
            return;
        };
        let raw = &self.source[pending.start..pending.end];
        let value = match pending.owned {
            Some(owned) => Cow::Owned(owned),
            None => Cow::Borrowed(raw),
        };
        let blank = raw.bytes().all(is_space);
        self.push(Kind::Text { value, blank }, pending.start, pending.end);
    }

    fn reference(&mut self, start: usize, end: usize) -> Result<()> {
        if self.stack.is_empty() {
            return fail(start, XmlErrorKind::ContentOutsideRoot);
        }
        let raw = &self.source[start..end];
        let Some((reference, len)) = parse_reference(raw) else {
            return fail(start, XmlErrorKind::InvalidReference);
        };
        if len != raw.len() {
            return fail(start, XmlErrorKind::InvalidReference);
        }
        match reference {
            Reference::Char(c) => self.extend_text(start, end, Some(c.to_string())),
            Reference::Named(name) => match predefined(name) {
                Some(c) => self.extend_text(start, end, Some(c.to_string())),
                None => match self.entities.get(name) {
                    Some(Entity::Internal(_) | Entity::External) => {
                        self.flush_text();
                        self.push(Kind::EntityRef(name), start, end);
                    }
                    Some(Entity::Unparsed) => return fail(start, XmlErrorKind::ExternalEntity),
                    Some(Entity::Unresolved) | None => {
                        return fail(start, XmlErrorKind::UndeclaredEntity)
                    }
                },
            },
        }
        Ok(())
    }

    fn open(&mut self, start: usize, end: usize, empty: bool) -> Result<NodeId> {
        self.flush_text();
        if self.stack.is_empty() && self.root.is_some() {
            return fail(start, XmlErrorKind::MultipleRoots);
        }
        let tag = scan_start_tag(self.source, start, end, empty)?;
        let mut attrs = Vec::with_capacity(tag.attrs.len());
        for raw in &tag.attrs {
            let value = self.normalize(raw.value.0, raw.value.1)?;
            attrs.push((raw, value));
        }

        // Prima le dichiarazioni, che valgono anche per il tag che le porta.
        let mark = self.bindings.len();
        for (raw, value) in &attrs {
            let prefix = if raw.name == "xmlns" {
                None
            } else if let Some(prefix) = raw.name.strip_prefix("xmlns:") {
                Some(prefix)
            } else {
                continue;
            };
            let ns = self.declare(prefix, value, raw.start)?;
            self.bindings.push((prefix, ns));
        }

        let (prefix, local) = split_qname(tag.name).ok_or(XmlError {
            offset: start + 1,
            kind: XmlErrorKind::InvalidName,
        })?;
        let Some(ns) = self.resolve(prefix) else {
            return fail(start + 1, XmlErrorKind::UndeclaredPrefix);
        };

        let mut resolved = Vec::with_capacity(attrs.len());
        for (raw, value) in attrs {
            let (prefix, local) = split_qname(raw.name).ok_or(XmlError {
                offset: raw.start,
                kind: XmlErrorKind::InvalidName,
            })?;
            let ns = if raw.name == "xmlns" || prefix == Some("xmlns") {
                NS_XMLNS
            } else if prefix.is_some() {
                self.resolve(prefix).ok_or(XmlError {
                    offset: raw.start,
                    kind: XmlErrorKind::UndeclaredPrefix,
                })?
            } else {
                NS_NONE
            };
            resolved.push((
                raw.start,
                Attr {
                    name: raw.name,
                    local,
                    ns,
                    value,
                    raw: raw.value,
                },
            ));
        }
        check_duplicates(&resolved)?;

        let element = Element {
            name: tag.name,
            local,
            ns,
            attrs: resolved.into_iter().map(|(_, attr)| attr).collect(),
            children: Vec::new(),
            open_end: end,
            close_start: None,
        };
        let id = self.push(Kind::Element(element), start, end);
        if self.root.is_none() {
            self.root = Some(id);
        }
        self.elements += 1;
        if empty {
            self.bindings.truncate(mark);
        } else {
            self.stack.push(id);
            self.marks.push(mark);
        }
        Ok(id)
    }

    /// Il namespace di una dichiarazione `xmlns` o `xmlns:prefix`, con i
    /// vincoli di «Namespaces in XML».
    fn declare(&mut self, prefix: Option<&str>, uri: &str, at: usize) -> Result<usize> {
        let invalid = match prefix {
            Some("xml") => uri != XML_URI,
            Some("xmlns") => true,
            Some(_) => uri.is_empty() || uri == XML_URI || uri == XMLNS_URI,
            None => uri == XML_URI || uri == XMLNS_URI,
        };
        if invalid {
            return fail(at, XmlErrorKind::InvalidNamespaceDeclaration);
        }
        if let Some(prefix) = prefix {
            if !is_ncname(prefix) {
                return fail(at, XmlErrorKind::InvalidName);
            }
        }
        Ok(match self.namespaces.iter().position(|ns| ns == uri) {
            Some(ns) => ns,
            None => {
                self.namespaces.push(uri.to_owned());
                self.namespaces.len() - 1
            }
        })
    }

    fn resolve(&self, prefix: Option<&str>) -> Option<usize> {
        match self.bindings.iter().rev().find(|(p, _)| *p == prefix) {
            Some(&(_, ns)) => Some(ns),
            // Senza dichiarazioni il namespace predefinito è nessuno.
            None if prefix.is_none() => Some(NS_NONE),
            None => None,
        }
    }

    /// Vero se l'elemento `id` esce dalla testa del documento: un figlio della
    /// radice che non è `title` né `desc`.
    fn leaves_head(&self, id: NodeId) -> bool {
        let node = &self.nodes[id];
        if node.parent.is_none() || node.parent != self.root {
            return false;
        }
        match &node.kind {
            Kind::Element(e) => !(e.is_svg("title") || e.is_svg("desc")),
            _ => false,
        }
    }

    /// Toglie l'ultimo elemento aperto, quello che ha chiuso la testa.
    fn retract(&mut self, id: NodeId, empty: bool) {
        if !empty {
            self.stack.pop();
            if let Some(mark) = self.marks.pop() {
                self.bindings.truncate(mark);
            }
        }
        if let Some(parent) = self.nodes[id].parent {
            if let Kind::Element(element) = &mut self.nodes[parent].kind {
                element.children.pop();
            }
        }
        self.nodes.pop();
        self.elements -= 1;
    }

    fn close(&mut self, start: usize, end: usize) -> Result<()> {
        self.flush_text();
        let name = scan_end_tag(self.source, start, end)?;
        let Some(id) = self.stack.pop() else {
            return fail(start, XmlErrorKind::UnmatchedEndTag);
        };
        let node = &mut self.nodes[id];
        let Kind::Element(element) = &mut node.kind else {
            unreachable!("la pila contiene solo elementi");
        };
        if element.name != name {
            return fail(start, XmlErrorKind::MismatchedEndTag);
        }
        element.close_start = Some(start);
        node.end = end;
        if let Some(mark) = self.marks.pop() {
            self.bindings.truncate(mark);
        }
        Ok(())
    }

    fn comment(&mut self, start: usize, end: usize) -> Result<()> {
        self.flush_text();
        let body = &self.source[start + 4..end - 3];
        if let Some(p) = body.find("--") {
            return fail(start + 4 + p, XmlErrorKind::InvalidComment);
        }
        if body.ends_with('-') {
            return fail(end - 4, XmlErrorKind::InvalidComment);
        }
        self.push(Kind::Comment, start, end);
        Ok(())
    }

    fn pi(&mut self, start: usize, end: usize) -> Result<()> {
        self.flush_text();
        let body = &self.source[start + 2..end - 2];
        let target_end = scan_name(body, 0);
        let target = &body[..target_end];
        let rest = &body[target_end..];
        let valid = !target.is_empty()
            && !target.eq_ignore_ascii_case("xml")
            && !target.contains(':')
            && (rest.is_empty() || rest.starts_with(|c: char| c.is_ascii() && is_space(c as u8)));
        if !valid {
            return fail(start, XmlErrorKind::InvalidProcessingInstruction);
        }
        self.push(Kind::Pi, start, end);
        Ok(())
    }

    fn decl(&mut self, start: usize, end: usize) -> Result<()> {
        self.flush_text();
        if start != self.bom || !self.nodes.is_empty() {
            return fail(start, XmlErrorKind::MisplacedDeclaration);
        }
        let Some(encoding) = parse_decl(&self.source[start..end]) else {
            return fail(start, XmlErrorKind::InvalidDeclaration);
        };
        self.encoding = encoding;
        self.push(Kind::Decl, start, end);
        Ok(())
    }

    fn cdata(&mut self, start: usize, end: usize) -> Result<()> {
        self.flush_text();
        if self.stack.is_empty() {
            return fail(start, XmlErrorKind::ContentOutsideRoot);
        }
        let body = &self.source[start + 9..end - 3];
        self.push(Kind::CData(eol(body)), start, end);
        Ok(())
    }

    fn doctype(&mut self, start: usize, end: usize) -> Result<()> {
        self.flush_text();
        if self.root.is_some() || self.doctype.is_some() {
            return fail(start, XmlErrorKind::MisplacedDoctype);
        }
        let entities = parse_doctype(self.source, start, end)?;
        self.entities = entities;
        let id = self.push(Kind::Doctype, start, end);
        self.doctype = Some(id);
        Ok(())
    }

    /// Il valore di un attributo come lo vede un parser XML (§3.3.3): i
    /// riferimenti espansi, tabulazioni e a capo diventati spazi, `\r\n` uno
    /// spazio solo.
    fn normalize(&mut self, from: usize, to: usize) -> Result<Cow<'a, str>> {
        let raw = &self.source[from..to];
        if let Some(p) = raw.find('<') {
            return fail(from + p, XmlErrorKind::LessThanInAttribute);
        }
        if !raw
            .bytes()
            .any(|b| matches!(b, b'&' | b'\t' | b'\n' | b'\r'))
        {
            return Ok(Cow::Borrowed(raw));
        }
        let mut out = String::with_capacity(raw.len());
        self.expand(raw, from, true, &mut out, 0)?;
        Ok(Cow::Owned(out))
    }

    /// Espande `text` dentro `out`. `literal` dice se `text` sta nella
    /// sorgente, così gli errori cadono sul byte giusto; il testo di
    /// un'entità li riporta tutti sul suo riferimento, `at`.
    fn expand(
        &mut self,
        text: &str,
        at: usize,
        literal: bool,
        out: &mut String,
        depth: usize,
    ) -> Result<()> {
        let bytes = text.as_bytes();
        let mut i = 0;
        while i < text.len() {
            let run = bytes[i..]
                .iter()
                .position(|b| matches!(b, b'&' | b'\t' | b'\n' | b'\r'))
                .map_or(text.len(), |p| i + p);
            out.push_str(&text[i..run]);
            i = run;
            if i == text.len() {
                break;
            }
            let here = if literal { at + i } else { at };
            match bytes[i] {
                b'&' => {
                    let Some((reference, len)) = parse_reference(&text[i..]) else {
                        return fail(here, XmlErrorKind::InvalidReference);
                    };
                    match reference {
                        Reference::Char(c) => out.push(c),
                        Reference::Named(name) => match predefined(name) {
                            Some(c) => out.push(c),
                            None => self.expand_entity(name, here, out, depth)?,
                        },
                    }
                    i += len;
                }
                b'\r' if bytes.get(i + 1) == Some(&b'\n') => {
                    out.push(' ');
                    i += 2;
                }
                _ => {
                    out.push(' ');
                    i += 1;
                }
            }
        }
        Ok(())
    }

    fn expand_entity(
        &mut self,
        name: &str,
        at: usize,
        out: &mut String,
        depth: usize,
    ) -> Result<()> {
        let text = match self.entities.get(name) {
            Some(Entity::Internal(text)) => text.clone(),
            Some(Entity::External | Entity::Unparsed) => {
                return fail(at, XmlErrorKind::ExternalEntity)
            }
            Some(Entity::Unresolved) | None => return fail(at, XmlErrorKind::UndeclaredEntity),
        };
        if text.contains('<') {
            return fail(at, XmlErrorKind::LessThanInAttribute);
        }
        self.expanded += text.len();
        if depth >= MAX_ENTITY_DEPTH || self.expanded > MAX_ENTITY_EXPANSION {
            return fail(at, XmlErrorKind::EntityLimit);
        }
        self.expand(&text, at, false, out, depth + 1)
    }

    /// Chiude la lettura; `stop` è il byte a cui si è fermata la lettura della
    /// sola testa.
    fn finish(mut self, stop: Option<usize>) -> Result<Document<'a>> {
        self.flush_text();
        let Some(root) = self.root else {
            return fail(self.source.len(), XmlErrorKind::MissingRoot);
        };
        match stop {
            None => {
                if let Some(&open) = self.stack.last() {
                    return fail(self.nodes[open].start, XmlErrorKind::UnclosedElement);
                }
            }
            // La lettura si è fermata dentro la radice: i nodi aperti finiscono
            // dove è finita la lettura.
            Some(stop) => {
                for &open in &self.stack {
                    self.nodes[open].end = stop;
                }
            }
        }
        let complete = stop.is_none();
        Ok(Document {
            source: self.source,
            nodes: self.nodes,
            top: self.top,
            root,
            encoding: self.encoding,
            doctype: self.doctype,
            elements: self.elements,
            complete,
            entities: self.entities,
        })
    }
}

/// Riduce `\r\n` e `\r` a `\n`, come fa un parser XML col testo (§2.11).
fn eol(raw: &str) -> Cow<'_, str> {
    if raw.contains('\r') {
        Cow::Owned(raw.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(raw)
    }
}

/// Lo spazio di XML: `S ::= (#x20 | #x9 | #xD | #xA)+`.
pub(crate) fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

fn is_name_start(c: char) -> bool {
    matches!(c,
        ':' | 'A'..='Z' | '_' | 'a'..='z'
        | '\u{C0}'..='\u{D6}' | '\u{D8}'..='\u{F6}' | '\u{F8}'..='\u{2FF}'
        | '\u{370}'..='\u{37D}' | '\u{37F}'..='\u{1FFF}' | '\u{200C}'..='\u{200D}'
        | '\u{2070}'..='\u{218F}' | '\u{2C00}'..='\u{2FEF}' | '\u{3001}'..='\u{D7FF}'
        | '\u{F900}'..='\u{FDCF}' | '\u{FDF0}'..='\u{FFFD}' | '\u{10000}'..='\u{EFFFF}')
}

fn is_name_char(c: char) -> bool {
    is_name_start(c)
        || matches!(c, '-' | '.' | '0'..='9' | '\u{B7}' | '\u{300}'..='\u{36F}' | '\u{203F}'..='\u{2040}')
}

/// La fine del `Name` che comincia al byte `from` di `text`; `from` se lì non
/// comincia un nome.
fn scan_name(text: &str, from: usize) -> usize {
    let mut chars = text[from..].char_indices();
    match chars.next() {
        Some((_, c)) if is_name_start(c) => {}
        _ => return from,
    }
    for (i, c) in chars {
        if !is_name_char(c) {
            return from + i;
        }
    }
    text.len()
}

fn is_ncname(name: &str) -> bool {
    !name.is_empty() && !name.contains(':') && scan_name(name, 0) == name.len()
}

/// Prefisso e nome locale di un `QName`; `None` se il nome non è un `QName`.
fn split_qname(name: &str) -> Option<(Option<&str>, &str)> {
    match name.split_once(':') {
        None => is_ncname(name).then_some((None, name)),
        Some((prefix, local)) => {
            (is_ncname(prefix) && is_ncname(local)).then_some((Some(prefix), local))
        }
    }
}

/// Le cinque entità che XML dichiara da sé.
fn predefined(name: &str) -> Option<char> {
    match name {
        "lt" => Some('<'),
        "gt" => Some('>'),
        "amp" => Some('&'),
        "apos" => Some('\''),
        "quot" => Some('"'),
        _ => None,
    }
}

/// Un carattere che XML 1.0 ammette (`Char`).
fn is_xml_char(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..)
}

enum Reference<'t> {
    Char(char),
    Named(&'t str),
}

/// Il riferimento in testa a `text`, che comincia con `&`, e quanti byte
/// occupa.
fn parse_reference(text: &str) -> Option<(Reference<'_>, usize)> {
    let body = text.strip_prefix('&')?;
    if let Some(number) = body.strip_prefix('#') {
        let (digits, radix, skip) = match number.strip_prefix('x') {
            Some(hex) => (hex, 16, 3),
            None => (number, 10, 2),
        };
        let len = digits.bytes().take_while(|b| b.is_ascii_hexdigit()).count();
        let digits = &digits[..len];
        if digits.is_empty()
            || text.as_bytes().get(skip + len) != Some(&b';')
            || (radix == 10 && !digits.bytes().all(|b| b.is_ascii_digit()))
        {
            return None;
        }
        let value = u32::from_str_radix(digits.trim_start_matches('0'), radix)
            .ok()
            .or_else(|| digits.bytes().all(|b| b == b'0').then_some(0))?;
        let c = char::from_u32(value).filter(|&c| is_xml_char(c))?;
        return Some((Reference::Char(c), skip + len + 1));
    }
    let end = scan_name(body, 0);
    if end == 0 || body.as_bytes().get(end) != Some(&b';') {
        return None;
    }
    Some((Reference::Named(&body[..end]), end + 2))
}

/// Un attributo come sta nel tag: nome e byte del valore.
struct RawAttr<'a> {
    start: usize,
    name: &'a str,
    value: (usize, usize),
}

struct StartTag<'a> {
    name: &'a str,
    attrs: Vec<RawAttr<'a>>,
}

/// Legge un tag d'apertura `[start, end)`: nome, attributi e i loro byte.
fn scan_start_tag(source: &str, start: usize, end: usize, empty: bool) -> Result<StartTag<'_>> {
    let tag = &source[..end];
    let bytes = tag.as_bytes();
    let close = if empty { end - 2 } else { end - 1 };
    let name_end = scan_name(tag, start + 1);
    if name_end == start + 1 {
        return fail(start + 1, XmlErrorKind::InvalidName);
    }
    let name = &tag[start + 1..name_end];
    let mut attrs = Vec::new();
    let mut i = name_end;
    loop {
        let spaced = i;
        while i < close && is_space(bytes[i]) {
            i += 1;
        }
        if i == close {
            break;
        }
        if i == spaced {
            return fail(i, XmlErrorKind::InvalidMarkup);
        }
        let attr_start = i;
        i = scan_name(tag, i);
        if i == attr_start {
            return fail(i, XmlErrorKind::InvalidName);
        }
        let attr_name = &tag[attr_start..i];
        while i < close && is_space(bytes[i]) {
            i += 1;
        }
        if i >= close || bytes[i] != b'=' {
            return fail(i, XmlErrorKind::InvalidMarkup);
        }
        i += 1;
        while i < close && is_space(bytes[i]) {
            i += 1;
        }
        let quote = match bytes.get(i) {
            Some(&q @ (b'"' | b'\'')) if i < close => q,
            _ => return fail(i, XmlErrorKind::InvalidMarkup),
        };
        let value_start = i + 1;
        let Some(len) = bytes[value_start..close].iter().position(|&b| b == quote) else {
            return fail(i, XmlErrorKind::UnclosedMarkup);
        };
        attrs.push(RawAttr {
            start: attr_start,
            name: attr_name,
            value: (value_start, value_start + len),
        });
        i = value_start + len + 1;
    }
    Ok(StartTag { name, attrs })
}

/// Il nome di un tag di chiusura `</name S?>`.
fn scan_end_tag(source: &str, start: usize, end: usize) -> Result<&str> {
    let tag = &source[..end];
    let name_end = scan_name(tag, start + 2);
    if name_end == start + 2 {
        return fail(start + 2, XmlErrorKind::InvalidName);
    }
    if !tag.as_bytes()[name_end..end - 1]
        .iter()
        .all(|&b| is_space(b))
    {
        return fail(name_end, XmlErrorKind::InvalidMarkup);
    }
    Ok(&tag[start + 2..name_end])
}

/// Rifiuta due attributi con lo stesso nome, o con lo stesso nome espanso.
fn check_duplicates(attrs: &[(usize, Attr<'_>)]) -> Result<()> {
    let mut names = HashSet::with_capacity(attrs.len());
    let mut expanded = HashSet::with_capacity(attrs.len());
    for (start, attr) in attrs {
        let fresh = names.insert(attr.name)
            && (attr.ns == NS_NONE || expanded.insert((attr.ns, attr.local)));
        if !fresh {
            return fail(*start, XmlErrorKind::DuplicateAttribute);
        }
    }
    Ok(())
}

/// Legge `<?xml version="1.x" encoding="…" standalone="…"?>` e ne restituisce
/// la codifica dichiarata; `None` se la dichiarazione è malformata.
fn parse_decl(raw: &str) -> Option<Option<&str>> {
    let body = raw.strip_prefix("<?xml")?.strip_suffix("?>")?;
    let bytes = body.as_bytes();
    let mut i = 0;
    let mut seen = 0;
    let mut encoding = None;
    loop {
        let spaced = i;
        while i < bytes.len() && is_space(bytes[i]) {
            i += 1;
        }
        if i == bytes.len() {
            break;
        }
        if i == spaced {
            return None;
        }
        let name_end = scan_name(body, i);
        let name = &body[i..name_end];
        i = name_end;
        while i < bytes.len() && is_space(bytes[i]) {
            i += 1;
        }
        if bytes.get(i) != Some(&b'=') {
            return None;
        }
        i += 1;
        while i < bytes.len() && is_space(bytes[i]) {
            i += 1;
        }
        let quote = *bytes.get(i).filter(|&&b| b == b'"' || b == b'\'')?;
        let len = bytes[i + 1..].iter().position(|&b| b == quote)?;
        let value = &body[i + 1..i + 1 + len];
        i += len + 2;
        // L'ordine è fisso: version, encoding, standalone.
        let rank = match name {
            "version" => 1,
            "encoding" => 2,
            "standalone" => 3,
            _ => return None,
        };
        if rank <= seen || (seen == 0 && rank != 1) {
            return None;
        }
        seen = rank;
        let valid = match rank {
            1 => value
                .strip_prefix("1.")
                .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit())),
            2 => {
                encoding = Some(value);
                value.starts_with(|c: char| c.is_ascii_alphabetic())
                    && value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            }
            _ => value == "yes" || value == "no",
        };
        if !valid {
            return None;
        }
    }
    (seen >= 1).then_some(encoding)
}

/// Legge `<!DOCTYPE …>` e restituisce le entità generali del sottoinsieme
/// interno. Le altre dichiarazioni si saltano: un lettore non validante non le
/// usa, e il documento con `DOCTYPE` si apre comunque in sola lettura.
fn parse_doctype(source: &str, start: usize, end: usize) -> Result<HashMap<&str, Entity>> {
    let text = &source[..end - 1];
    let bytes = text.as_bytes();
    let bad = |at: usize| fail(at, XmlErrorKind::InvalidDoctype);
    if !text[start..].starts_with("<!DOCTYPE") {
        return bad(start);
    }
    let mut i = start + 9;
    if !skip_space(bytes, &mut i) {
        return bad(i);
    }
    let name_end = scan_name(text, i);
    if name_end == i || split_qname(&text[i..name_end]).is_none() {
        return bad(i);
    }
    i = name_end;
    let spaced = skip_space(bytes, &mut i);
    if spaced && (text[i..].starts_with("SYSTEM") || text[i..].starts_with("PUBLIC")) {
        i = external_id(text, i).ok_or(XmlError {
            offset: i,
            kind: XmlErrorKind::InvalidDoctype,
        })?;
        skip_space(bytes, &mut i);
    }
    let mut entities = HashMap::new();
    if bytes.get(i) == Some(&b'[') {
        i = internal_subset(text, i + 1, &mut entities)?;
        skip_space(bytes, &mut i);
    }
    if i != text.len() {
        return bad(i);
    }
    Ok(entities)
}

/// Salta gli spazi; vero se ce n'era almeno uno.
fn skip_space(bytes: &[u8], i: &mut usize) -> bool {
    let from = *i;
    while *i < bytes.len() && is_space(bytes[*i]) {
        *i += 1;
    }
    *i > from
}

/// Una stringa fra virgolette che comincia al byte `i`: il contenuto e il byte
/// dopo la virgoletta di chiusura.
fn quoted(text: &str, i: usize) -> Option<(&str, usize)> {
    let quote = *text
        .as_bytes()
        .get(i)
        .filter(|&&b| b == b'"' || b == b'\'')?;
    let len = text.as_bytes()[i + 1..].iter().position(|&b| b == quote)?;
    Some((&text[i + 1..i + 1 + len], i + len + 2))
}

/// `SYSTEM "…"` oppure `PUBLIC "…" "…"`: il byte dopo l'identificatore.
fn external_id(text: &str, mut i: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let public = text[i..].starts_with("PUBLIC");
    i += 6;
    if !skip_space(bytes, &mut i) {
        return None;
    }
    let (_, next) = quoted(text, i)?;
    i = next;
    if public {
        if !skip_space(bytes, &mut i) {
            return None;
        }
        let (_, next) = quoted(text, i)?;
        i = next;
    }
    Some(i)
}

/// Il sottoinsieme interno fino alla sua `]`: raccoglie le entità generali e
/// restituisce il byte dopo la `]`.
fn internal_subset<'a>(
    text: &'a str,
    mut i: usize,
    entities: &mut HashMap<&'a str, Entity>,
) -> Result<usize> {
    let bytes = text.as_bytes();
    let bad = |at: usize| XmlError {
        offset: at,
        kind: XmlErrorKind::InvalidDoctype,
    };
    loop {
        skip_space(bytes, &mut i);
        let rest = &text[i..];
        if rest.starts_with(']') {
            return Ok(i + 1);
        } else if let Some(comment) = rest.strip_prefix("<!--") {
            i += 4 + comment.find("-->").ok_or(bad(i))? + 3;
        } else if let Some(pi) = rest.strip_prefix("<?") {
            i += 2 + pi.find("?>").ok_or(bad(i))? + 2;
        } else if rest.starts_with("<!ENTITY") {
            i = entity_decl(text, i, entities).ok_or(bad(i))?;
        } else if rest.starts_with("<!ELEMENT")
            || rest.starts_with("<!ATTLIST")
            || rest.starts_with("<!NOTATION")
        {
            i = markup_decl_end(text, i).ok_or(bad(i))?;
        } else if rest.starts_with('%') {
            let end = scan_name(text, i + 1);
            if end == i + 1 || bytes.get(end) != Some(&b';') {
                return Err(bad(i));
            }
            i = end + 1;
        } else {
            return Err(bad(i));
        }
    }
}

/// Il byte dopo il `>` di una dichiarazione, saltando le stringhe.
fn markup_decl_end(text: &str, mut i: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    while i < bytes.len() {
        match bytes[i] {
            b'>' => return Some(i + 1),
            b'"' | b'\'' => i = quoted(text, i)?.1,
            _ => i += 1,
        }
    }
    None
}

/// `<!ENTITY …>`: registra le entità generali e restituisce il byte dopo `>`.
fn entity_decl<'a>(
    text: &'a str,
    mut i: usize,
    entities: &mut HashMap<&'a str, Entity>,
) -> Option<usize> {
    let bytes = text.as_bytes();
    i += 8;
    if !skip_space(bytes, &mut i) {
        return None;
    }
    let parameter = bytes.get(i) == Some(&b'%');
    if parameter {
        i += 1;
        if !skip_space(bytes, &mut i) {
            return None;
        }
    }
    let name_end = scan_name(text, i);
    let name = &text[i..name_end];
    if !is_ncname(name) {
        return None;
    }
    i = name_end;
    if !skip_space(bytes, &mut i) {
        return None;
    }
    let entity = if matches!(bytes.get(i), Some(b'"' | b'\'')) {
        let (value, next) = quoted(text, i)?;
        i = next;
        replacement_text(value)?
    } else {
        i = external_id(text, i)?;
        let spaced = skip_space(bytes, &mut i);
        if spaced && text[i..].starts_with("NDATA") {
            if parameter {
                return None;
            }
            i += 5;
            if !skip_space(bytes, &mut i) {
                return None;
            }
            let end = scan_name(text, i);
            if end == i {
                return None;
            }
            i = end;
            skip_space(bytes, &mut i);
            Entity::Unparsed
        } else {
            Entity::External
        }
    };
    if bytes.get(i) != Some(&b'>') {
        return None;
    }
    // La prima dichiarazione vince (§4.2); le predefinite non si ridefiniscono.
    if !parameter && predefined(name).is_none() {
        entities.entry(name).or_insert(entity);
    }
    Some(i + 1)
}

/// Il testo di sostituzione di un `EntityValue`: i riferimenti a carattere si
/// espandono, quelli a entità generali restano com'erano (§4.5).
fn replacement_text(value: &str) -> Option<Entity> {
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < value.len() {
        let rest = &value[i..];
        let c = rest.chars().next()?;
        match c {
            '%' => return Some(Entity::Unresolved),
            '&' => {
                let (reference, len) = parse_reference(rest)?;
                match reference {
                    Reference::Char(c) => out.push(c),
                    Reference::Named(_) => out.push_str(&rest[..len]),
                }
                i += len;
            }
            _ => {
                out.push(c);
                i += c.len_utf8();
            }
        }
    }
    Some(Entity::Internal(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error(source: &str) -> XmlErrorKind {
        match parse(source, false) {
            Ok(_) => panic!("doveva fallire: {source}"),
            Err(error) => error.kind,
        }
    }

    fn root_attr(source: &str, name: &str) -> String {
        let doc = parse(source, false).unwrap();
        let root = doc.element(doc.root).unwrap();
        let attr = root.attrs.iter().find(|a| a.name == name).unwrap();
        attr.value.to_string()
    }

    #[test]
    fn spans_cover_every_node_and_count_the_bom() {
        let source = "\u{feff}<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"><g>a&amp;b</g><!--c--></svg>\n";
        let doc = parse(source, false).unwrap();
        let root = &doc.nodes[doc.root];
        assert_eq!(
            &source[root.start..root.end],
            &source[source.find("<svg").unwrap()..source.len() - 1]
        );
        let g = doc.children(doc.root)[0];
        assert_eq!(
            &source[doc.nodes[g].start..doc.nodes[g].end],
            "<g>a&amp;b</g>"
        );
        let text = doc.children(g)[0];
        match &doc.nodes[text].kind {
            Kind::Text { value, blank } => {
                assert_eq!(value, "a&b");
                assert!(!blank);
            }
            _ => panic!("testo atteso"),
        }
        assert_eq!(doc.top.len(), 4);
        assert_eq!(doc.elements, 2);
    }

    #[test]
    fn attribute_values_are_normalized_like_a_browser_does() {
        let svg = |value: &str| format!("<svg a=\"{value}\"/>");
        assert_eq!(root_attr(&svg("1\r\n2\t3\n4"), "a"), "1 2 3 4");
        assert_eq!(root_attr(&svg("&#10;&#x9;&lt;&amp;"), "a"), "\n\t<&");
        let dtd = "<!DOCTYPE svg [<!ENTITY ns \"http://www.w3.org/2000/svg\"><!ENTITY e \"x&#38;#38;y\">]>";
        assert_eq!(
            root_attr(&format!("{dtd}<svg a=\"&ns;\"/>"), "a"),
            crate::SVG_NS
        );
        assert_eq!(root_attr(&format!("{dtd}<svg a=\"&e;\"/>"), "a"), "x&y");
    }

    #[test]
    fn namespaces_bind_on_expanded_values() {
        let source =
            "<!DOCTYPE svg [<!ENTITY ns \"http://www.w3.org/2000/svg\">]><svg xmlns=\"&ns;\"/>";
        let doc = parse(source, false).unwrap();
        assert_eq!(doc.element(doc.root).unwrap().ns, NS_SVG);
    }

    #[test]
    fn malformed_documents_are_rejected_with_a_kind() {
        use XmlErrorKind as K;
        assert_eq!(error(""), K::MissingRoot);
        assert_eq!(error("<svg>"), K::UnclosedElement);
        assert_eq!(error("<svg></g>"), K::MismatchedEndTag);
        assert_eq!(error("<svg/></svg>"), K::UnmatchedEndTag);
        assert_eq!(error("<svg/><svg/>"), K::MultipleRoots);
        assert_eq!(error("a<svg/>"), K::ContentOutsideRoot);
        assert_eq!(error("<svg/>&#32;"), K::ContentOutsideRoot);
        assert_eq!(error("<svg a=\"1\" a=\"2\"/>"), K::DuplicateAttribute);
        assert_eq!(
            error("<svg xmlns:p=\"u\" xmlns:q=\"u\" p:a=\"1\" q:a=\"2\"/>"),
            K::DuplicateAttribute
        );
        assert_eq!(error("<svg a=\"1\"b=\"2\"/>"), K::InvalidMarkup);
        assert_eq!(error("<svg a=\"<\"/>"), K::LessThanInAttribute);
        assert_eq!(error("<svg a=\"&nope;\"/>"), K::UndeclaredEntity);
        assert_eq!(error("<svg a=\"&#0;\"/>"), K::InvalidReference);
        assert_eq!(error("<svg a=\"&#xD800;\"/>"), K::InvalidReference);
        assert_eq!(error("<svg a=\"& b\"/>"), K::InvalidReference);
        assert_eq!(error("<svg>&#1;</svg>"), K::InvalidReference);
        assert_eq!(error("<svg>\u{1}</svg>"), K::InvalidChar);
        assert_eq!(error("<svg>\u{fffe}</svg>"), K::InvalidChar);
        assert_eq!(error("<svg>]]></svg>"), K::CdataEndInText);
        assert_eq!(error("<svg><!-- a -- b --></svg>"), K::InvalidComment);
        assert_eq!(error("<svg><!-- a ---></svg>"), K::InvalidComment);
        assert_eq!(error("<svg><?xml x?></svg>"), K::MisplacedDeclaration);
        assert_eq!(
            error("<svg><?XML x?></svg>"),
            K::InvalidProcessingInstruction
        );
        assert_eq!(error("<svg><?a:b?></svg>"), K::InvalidProcessingInstruction);
        assert_eq!(
            error(" <?xml version=\"1.0\"?><svg/>"),
            K::MisplacedDeclaration
        );
        assert_eq!(
            error("<?xml encoding=\"UTF-8\"?><svg/>"),
            K::InvalidDeclaration
        );
        assert_eq!(
            error("<?xml version=\"2.0\"?><svg/>"),
            K::InvalidDeclaration
        );
        assert_eq!(error("<svg/><!DOCTYPE svg>"), K::MisplacedDoctype);
        assert_eq!(error("<!doctype svg><svg/>"), K::InvalidDoctype);
        assert_eq!(error("<p:svg/>"), K::UndeclaredPrefix);
        assert_eq!(error("<svg p:a=\"1\"/>"), K::UndeclaredPrefix);
        assert_eq!(error("<svg xmlns:p=\"\"/>"), K::InvalidNamespaceDeclaration);
        assert_eq!(
            error("<svg xmlns:xmlns=\"u\"/>"),
            K::InvalidNamespaceDeclaration
        );
        assert_eq!(
            error("<svg xmlns:xml=\"u\"/>"),
            K::InvalidNamespaceDeclaration
        );
        assert_eq!(error("<svg a:b:c=\"1\"/>"), K::InvalidName);
        assert_eq!(error("<svg 1a=\"1\"/>"), K::InvalidName);
        assert_eq!(error("<svg><![CDATA[x</svg>"), K::UnclosedMarkup);
        assert_eq!(error("<svg/><![CDATA[x]]>"), K::ContentOutsideRoot);
        assert_eq!(error("<svg><!FOO></svg>"), K::InvalidMarkup);
    }

    #[test]
    fn entity_expansion_is_bounded() {
        let mut dtd = String::from("<!DOCTYPE svg [<!ENTITY a0 \"xxxxxxxxxxxxxxxx\">");
        for i in 1..10 {
            let previous = format!("&a{};", i - 1).repeat(10);
            dtd.push_str(&format!("<!ENTITY a{i} \"{previous}\">"));
        }
        dtd.push_str("]>");
        assert_eq!(
            error(&format!("{dtd}<svg a=\"&a9;\"/>")),
            XmlErrorKind::EntityLimit
        );
        let recursive = "<!DOCTYPE svg [<!ENTITY a \"&a;\">]><svg b=\"&a;\"/>";
        assert_eq!(error(recursive), XmlErrorKind::EntityLimit);
    }

    #[test]
    fn content_entities_stay_references() {
        let source = "<!DOCTYPE svg [<!ENTITY who \"Fub\">]><svg>Ciao &who;!</svg>";
        let doc = parse(source, false).unwrap();
        let kinds: Vec<_> = doc
            .children(doc.root)
            .iter()
            .map(|&id| match &doc.nodes[id].kind {
                Kind::Text { value, .. } => value.to_string(),
                Kind::EntityRef(name) => format!("&{name};"),
                _ => String::from("?"),
            })
            .collect();
        assert_eq!(kinds, ["Ciao ", "&who;", "!"]);
    }

    #[test]
    fn the_head_stops_at_the_first_drawing() {
        let source =
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>T</title><g><path/></g></svg>";
        let doc = parse(source, true).unwrap();
        assert!(!doc.complete);
        assert_eq!(doc.children(doc.root).len(), 1);
        assert_eq!(doc.elements, 2);
    }
}
