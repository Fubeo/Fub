//! Il **flusso** di ogni blocco del corpo di un `.docx`: il suo XML come
//! sequenza di caratteri, oggetti e strutture, ciascuno con la formattazione
//! che lo riguarda. Lo calcola Fub dai byte, senza il modello di WordCraft.
//!
//! L'inventario di [`crate::inventory`] conta: dentro un paragrafo dice *che
//! cosa* c'è, non *dove*. Un segnalibro spostato di tre caratteri, un
//! grassetto esteso alla parola dopo o una proprietà del carattere passata da
//! un tratto all'altro lasciano gli stessi conteggi. Il flusso li vede:
//!
//! - un **carattere** di `w:t` (o di `w:delText`) porta le proprietà del suo
//!   run e gli involucri che lo contengono (link, content control, campi
//!   semplici, revisioni). I run spariscono: due run uguali e uno lungo danno
//!   lo stesso flusso;
//! - un **oggetto** è ogni altro figlio di un run o di un paragrafo (un
//!   disegno, una tabulazione, un richiamo di nota, un segnalibro, un'equazione)
//!   in forma canonica, con il contesto del run;
//! - un **campo** è il suo inizio, con l'istruzione a meno degli spazi, e la
//!   sua fine: `w:fldSimple` e `w:fldChar` con `w:instrText` danno lo stesso
//!   flusso, comunque l'istruzione sia spezzata;
//! - un **paragrafo** finisce con le sue proprietà; una tabella, una riga, una
//!   cella e un contenitore di blocchi si aprono con le loro e si chiudono.
//!
//! Ogni proprietà è un insieme di **voci** canoniche: il percorso
//! dell'elemento, un attributo con il suo valore in forma canonica
//! ([`crate::canonical`]), un testo. Valgono le normalizzazioni di
//! [`crate::inventory`] (gli `rsid`, i numeri che il codec riassegna, il
//! controllo ortografico), e un riferimento a una relazione vale per la
//! relazione che nomina.
//!
//! Ogni voce ha anche una seconda lettura, **opaca**: ciò che la proiezione
//! della shell non mostra e non scrive ([`expressible`]). Il grassetto e il
//! carattere si cambiano dalla superficie; la disposizione asiatica o la
//! lingua no, e chi modifica un paragrafo non deve perderle.
//!
//! Il flusso divide anche il corpo in **unità**: i figli di `w:body`, con i
//! segni che li precedono, nell'ordine e con i loro byte. Un'unità contiene i
//! blocchi del modello che le stanno dentro (un content control di blocco ne
//! contiene più d'uno). È la misura con cui [`crate::graft`] riscrive soltanto
//! ciò che l'utente ha toccato.

use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::ops::Range;
use std::sync::Arc;

use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;

use crate::inventory::{
    described, read_rels, renumbered, resolve, skipped_attribute, skipped_element, ContentTypes,
    InventoryError, Limits, Relationship, Zip, MARKERS, NS_MC, NS_RELATIONSHIPS, NS_W, WRAPPERS,
};

/// Le voci di una proprietà o di un contesto, ordinate: tutte, e quelle che
/// la proiezione non porta.
#[derive(Debug, Default, PartialEq, Eq, Hash)]
pub(crate) struct Sig {
    pub full: Vec<String>,
    pub opaque: Vec<String>,
}

impl Sig {
    fn of(mut items: Vec<String>) -> Sig {
        items.sort_unstable();
        let opaque = items
            .iter()
            .filter(|item| !expressible(item))
            .cloned()
            .collect();
        Sig {
            full: items,
            opaque,
        }
    }
}

/// Che specie di oggetto.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum ObjKind {
    /// Un segno senza spazio fra i caratteri: segnalibri, inizio e fine di un
    /// commento, permessi, intervalli di uno spostamento.
    Marker,
    /// L'inizio di un campo, con la sua istruzione.
    Field,
    /// La fine di un campo.
    FieldEnd,
    Other,
}

/// Un oggetto in forma canonica.
#[derive(Debug, PartialEq, Eq, Hash)]
pub(crate) struct Obj {
    pub kind: ObjKind,
    pub name: String,
    /// Le voci del sottoalbero, ordinate.
    pub items: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Token {
    Char(char, Arc<Sig>),
    Obj(Arc<Obj>, Arc<Sig>),
    /// La fine di un paragrafo, con le proprietà del paragrafo.
    Para(Arc<Sig>),
    /// L'apertura di una tabella, una riga, una cella o un contenitore di
    /// blocchi, con le sue proprietà.
    Open(Arc<str>, Arc<Sig>),
    Close(Arc<str>),
}

/// Ciò su cui due flussi si allineano: il carattere, la specie e il nome
/// dell'oggetto, la specie di struttura. Le proprietà e le voci dell'oggetto
/// si confrontano dopo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Key {
    Char(char),
    Obj(u64),
    Para,
    Open(u64),
    Close(u64),
}

fn hash_of<T: Hash + ?Sized>(value: &T) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

impl Token {
    pub(crate) fn key(&self) -> Key {
        match self {
            Token::Char(c, _) => Key::Char(*c),
            Token::Obj(obj, _) => Key::Obj(hash_of(&(obj.kind, &obj.name))),
            Token::Para(_) => Key::Para,
            Token::Open(name, _) => Key::Open(hash_of(&**name)),
            Token::Close(name) => Key::Close(hash_of(&**name)),
        }
    }

    /// Le voci del token: le proprietà o il contesto.
    fn sig(&self) -> Option<&Sig> {
        match self {
            Token::Char(_, sig) | Token::Obj(_, sig) | Token::Para(sig) | Token::Open(_, sig) => {
                Some(sig)
            }
            Token::Close(_) => None,
        }
    }

    fn describe(&self) -> String {
        match self {
            Token::Char(c, _) => format!("{c:?}"),
            Token::Obj(obj, _) => format!("<{}>", obj.name),
            Token::Para(_) => "fine del paragrafo".into(),
            Token::Open(name, _) => format!("<{name}>"),
            Token::Close(name) => format!("</{name}>"),
        }
    }
}

/// Un figlio di `w:body` con i segni che lo precedono: i suoi byte e i
/// blocchi del modello che contiene.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Unit {
    pub bytes: Range<usize>,
    pub blocks: Range<usize>,
}

/// Il corpo del documento principale, letto.
#[derive(Debug)]
pub(crate) struct Scan {
    /// Il tag di apertura di `w:document`, con le dichiarazioni degli spazi
    /// dei nomi.
    pub root: Range<usize>,
    /// Dove finisce l'apertura di `w:body`: i byte prima sono il prologo.
    pub head: usize,
    pub units: Vec<Unit>,
    /// La sezione finale, `w:sectPr` figlio di `w:body`; vuota, alla fine del
    /// corpo, se non c'è.
    pub sect: Range<usize>,
    /// Il flusso di ogni blocco, come i blocchi del modello e dell'inventario.
    pub blocks: Vec<Vec<Token>>,
}

/// Perché il corpo non si legge come flusso.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ScanError {
    Inventory(InventoryError),
    /// Una forma che il flusso non sa dividere in unità: chi chiama non
    /// innesta.
    Shape(&'static str),
}

impl From<InventoryError> for ScanError {
    fn from(error: InventoryError) -> ScanError {
        ScanError::Inventory(error)
    }
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScanError::Inventory(error) => write!(f, "{error}"),
            ScanError::Shape(what) => write!(f, "body shape: {what}"),
        }
    }
}

/// Le voci che la proiezione della shell mostra e scrive, per percorso. Una
/// voce lo è se è uguale a una di queste o se ne è un discendente (`/`), un
/// attributo (`@`, `=`) o un testo (`#`).
const SHOWN: &[&str] = &[
    "w:rStyle",
    "w:b",
    "w:i",
    "w:caps",
    "w:smallCaps",
    "w:strike",
    "w:dstrike",
    "w:vertAlign",
    "w:highlight",
    "w:sz",
    "w:color",
    "w:ins",
    "w:del",
    "w:rFonts@w:ascii",
    "w:rFonts@w:hAnsi",
    "w:rFonts@w:asciiTheme",
    "w:rFonts@w:hAnsiTheme",
    "w:u@w:val",
];
/// Le voci che la proiezione scrive soltanto in sé, senza i loro attributi:
/// un `w:rFonts` può nascere o sparire con il carattere, la sua
/// `w:eastAsia` no.
const SHOWN_EXACT: &[&str] = &["w:rFonts", "w:u"];
/// Le stesse, fuori dalle proprietà del carattere.
const SHOWN_ELSEWHERE: &[&str] = &[
    "ctx/w:hyperlink@r:id",
    "ctx/w:hyperlink@w:anchor",
    "ctx/w:ins",
    "ctx/w:del",
    "ctx/w:moveFrom",
    "ctx/w:moveTo",
    "w:pPr/w:pStyle",
    "w:pPr/w:jc",
    "w:pPr/w:ind",
    "w:pPr/w:spacing",
    "w:pPr/w:numPr",
    "w:pPr/w:sectPr/w:pgSz",
    "w:pPr/w:sectPr/w:pgMar",
    "w:pPr/w:sectPr/w:cols",
    "w:pPr/w:sectPr/w:headerReference",
    "w:pPr/w:sectPr/w:footerReference",
    "w:tcPr/w:gridSpan",
    "w:tcPr/w:tcW",
    "w:tcPr/w:hMerge",
    "w:tblGrid",
];

fn under(item: &str, entry: &str) -> bool {
    item.strip_prefix(entry)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(['/', '@', '#', '=']))
}

/// Se la proiezione mostra e scrive questa voce.
pub(crate) fn expressible(item: &str) -> bool {
    if SHOWN_ELSEWHERE.iter().any(|entry| under(item, entry)) {
        return true;
    }
    // Le proprietà di un run e quelle del segno di fine di un paragrafo.
    let Some(rest) = item
        .strip_prefix("w:rPr/")
        .or_else(|| item.strip_prefix("w:pPr/w:rPr/"))
    else {
        return false;
    };
    SHOWN.iter().any(|entry| under(rest, entry)) || SHOWN_EXACT.contains(&rest)
}

/// Il prefisso breve degli spazi dei nomi noti; gli altri restano interi.
fn short(ns: &str) -> String {
    let known = [
        (NS_W, "w"),
        (NS_RELATIONSHIPS, "r"),
        (NS_MC, "mc"),
        (crate::inventory::NS_M, "m"),
        (crate::inventory::NS_W14, "w14"),
        (crate::inventory::NS_W15, "w15"),
        (
            "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
            "wp",
        ),
        ("http://schemas.openxmlformats.org/drawingml/2006/main", "a"),
        (
            "http://schemas.openxmlformats.org/drawingml/2006/picture",
            "pic",
        ),
        (
            "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
            "wps",
        ),
        ("urn:schemas-microsoft-com:vml", "v"),
        ("urn:schemas-microsoft-com:office:office", "o"),
        ("http://www.w3.org/XML/1998/namespace", "xml"),
    ];
    match known.iter().find(|(uri, _)| *uri == ns) {
        Some((_, prefix)) => prefix.to_string(),
        None if ns.is_empty() => String::new(),
        None => format!("{{{ns}}}"),
    }
}

fn qualified(ns: &str, local: &str) -> String {
    match short(ns) {
        prefix if prefix.is_empty() => local.to_string(),
        prefix => format!("{prefix}:{local}"),
    }
}

/// Un attributo letto, con lo spazio dei nomi risolto.
struct Attr {
    ns: String,
    local: String,
    value: String,
}

/// Un elemento aperto.
struct El {
    ns: String,
    local: String,
    attrs: Vec<Attr>,
    /// Dove comincia il suo tag.
    start: usize,
}

impl El {
    fn is_w(&self, local: &str) -> bool {
        self.ns == NS_W && self.local == local
    }

    fn name(&self) -> String {
        qualified(&self.ns, &self.local)
    }

    fn attr(&self, ns: &str, local: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|a| a.ns == ns && a.local == local)
            .map(|a| a.value.as_str())
    }
}

enum Ev {
    Start(El),
    Empty(El),
    End,
    Text(String),
    Eof,
}

/// Un sottoalbero catturato in forma canonica.
struct Node {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<Node>,
    text: String,
}

impl Node {
    /// Le voci del nodo sotto `path`, nodo compreso.
    fn items(&self, path: &str, out: &mut Vec<String>) {
        out.push(path.to_string());
        self.inner_items(path, out);
    }

    /// Le voci dei suoi attributi, del suo testo e dei suoi figli.
    fn inner_items(&self, path: &str, out: &mut Vec<String>) {
        for (name, value) in &self.attrs {
            out.push(format!("{path}@{name}={value}"));
        }
        let text = self.text.trim();
        if !text.is_empty() {
            out.push(format!("{path}#{}", crate::canonical::value("", text)));
        }
        for child in &self.children {
            child.items(&format!("{path}/{}", child.name), out);
        }
    }
}

/// Un campo aperto.
struct Field {
    instr: String,
    items: Vec<String>,
    /// Dopo il `separate`: ciò che segue è il risultato, nel flusso.
    result: bool,
    /// L'inizio è già nel flusso.
    emitted: bool,
}

struct Scanner<'a> {
    reader: NsReader<&'a [u8]>,
    buf: Vec<u8>,
    rels: &'a BTreeMap<String, String>,
    limits: &'a Limits,
    elements: u64,
    depth: usize,
    blocks: Vec<Vec<Token>>,
    /// Ciò che va con il blocco che segue: segni fra due blocchi, l'apertura
    /// di un contenitore di blocchi.
    pending: Vec<Token>,
    /// Il contesto degli involucri in riga aperti.
    context: Vec<Vec<String>>,
    fields: Vec<Field>,
}

fn xml_error(error: impl std::fmt::Display) -> ScanError {
    ScanError::Inventory(InventoryError::Xml {
        part: "document".into(),
        error: error.to_string(),
    })
}

fn namespace(result: &ResolveResult<'_>) -> String {
    match result {
        ResolveResult::Bound(ns) => String::from_utf8_lossy(ns.as_ref()).into_owned(),
        ResolveResult::Unbound => String::new(),
        ResolveResult::Unknown(prefix) => format!("?{}", String::from_utf8_lossy(prefix)),
    }
}

/// Legge il corpo del documento principale. `rels` descrive le relazioni
/// della parte per id, come le scrive l'inventario.
pub(crate) fn scan(
    xml: &[u8],
    rels: &BTreeMap<String, String>,
    limits: &Limits,
) -> Result<Scan, ScanError> {
    let mut reader = NsReader::from_reader(xml);
    reader.config_mut().check_end_names = true;
    let mut scanner = Scanner {
        reader,
        buf: Vec::new(),
        rels,
        limits,
        elements: 0,
        depth: 0,
        blocks: Vec::new(),
        pending: Vec::new(),
        context: Vec::new(),
        fields: Vec::new(),
    };
    scanner.document(xml.len())
}

impl<'a> Scanner<'a> {
    fn position(&self) -> usize {
        self.reader.buffer_position() as usize
    }

    fn next(&mut self) -> Result<Ev, ScanError> {
        loop {
            let start = self.position();
            self.buf.clear();
            let event = self
                .reader
                .read_event_into(&mut self.buf)
                .map_err(xml_error)?;
            let (element, empty) = match &event {
                Event::Start(e) => (e.clone().into_owned(), false),
                Event::Empty(e) => (e.clone().into_owned(), true),
                Event::End(_) => {
                    self.depth = self.depth.saturating_sub(1);
                    return Ok(Ev::End);
                }
                Event::Text(text) => {
                    let text = text
                        .xml_content(quick_xml::XmlVersion::Implicit1_0)
                        .map_err(xml_error)?;
                    return Ok(Ev::Text(text.into_owned()));
                }
                Event::CData(text) => {
                    return Ok(Ev::Text(text.decode().map_err(xml_error)?.into_owned()));
                }
                Event::GeneralRef(reference) => {
                    let resolved = match reference.resolve_char_ref().map_err(xml_error)? {
                        Some(ch) => ch.to_string(),
                        None => {
                            let name = reference.decode().map_err(xml_error)?;
                            quick_xml::escape::resolve_xml_entity(&name)
                                .ok_or_else(|| xml_error(format!("unknown entity &{name};")))?
                                .to_string()
                        }
                    };
                    return Ok(Ev::Text(resolved));
                }
                Event::Eof => return Ok(Ev::Eof),
                _ => continue,
            };
            self.elements += 1;
            if self.elements > self.limits.elements {
                return Err(InventoryError::Limit("xml elements").into());
            }
            if self.depth >= self.limits.depth {
                return Err(InventoryError::Limit("xml depth").into());
            }
            let (ns, local) = self.reader.resolver().resolve_element(element.name());
            let ns = namespace(&ns);
            let local = String::from_utf8_lossy(local.as_ref()).into_owned();
            let mut attrs = Vec::new();
            for attr in element.attributes() {
                let attr = attr.map_err(xml_error)?;
                if attr.key.as_namespace_binding().is_some() {
                    continue;
                }
                let (attr_ns, attr_local) = self.reader.resolver().resolve_attribute(attr.key);
                let value = attr
                    .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                    .map_err(xml_error)?
                    .into_owned();
                attrs.push(Attr {
                    ns: namespace(&attr_ns),
                    local: String::from_utf8_lossy(attr_local.as_ref()).into_owned(),
                    value,
                });
            }
            let el = El {
                ns,
                local,
                attrs,
                start,
            };
            if empty {
                return Ok(Ev::Empty(el));
            }
            self.depth += 1;
            return Ok(Ev::Start(el));
        }
    }

    /// Le voci canoniche degli attributi di `el`, con le normalizzazioni.
    fn attrs(&self, el: &El) -> Vec<(String, String)> {
        let element = format!("{{{}}}{}", el.ns, el.local);
        let mut out = Vec::new();
        for attr in &el.attrs {
            if skipped_attribute(&attr.ns, &attr.local).is_some() {
                continue;
            }
            if attr.ns == NS_MC
                || (attr.ns == "http://www.w3.org/XML/1998/namespace" && attr.local == "space")
            {
                // Indicazioni per chi legge (`mc:Ignorable`, `xml:space`):
                // non portano contenuto.
                continue;
            }
            let value = if let Some((_, kept)) =
                renumbered(&element, &attr.ns, &attr.local, &attr.value)
            {
                kept
            } else if attr.ns == NS_RELATIONSHIPS {
                self.rels
                    .get(attr.value.as_str())
                    .cloned()
                    .unwrap_or_else(|| "dangling".into())
            } else {
                crate::canonical::value(&attr.ns, &attr.value)
            };
            out.push((qualified(&attr.ns, &attr.local), value));
        }
        out.sort();
        out
    }

    /// Cattura il sottoalbero di `el`.
    fn capture(&mut self, el: El, empty: bool) -> Result<Node, ScanError> {
        let mut node = Node {
            name: el.name(),
            attrs: self.attrs(&el),
            children: Vec::new(),
            text: String::new(),
        };
        if empty {
            return Ok(node);
        }
        loop {
            match self.next()? {
                Ev::Start(child) => {
                    let skip = skipped_element(&child.ns, &child.local).is_some();
                    let child = self.capture(child, false)?;
                    if !skip {
                        node.children.push(child);
                    }
                }
                Ev::Empty(child) => {
                    if skipped_element(&child.ns, &child.local).is_none() {
                        let child = self.capture(child, true)?;
                        node.children.push(child);
                    }
                }
                Ev::Text(text) => node.text.push_str(&text),
                Ev::End => return Ok(node),
                Ev::Eof => return Err(xml_error("unclosed element")),
            }
        }
    }

    /// Salta il resto di un elemento.
    fn skip(&mut self, empty: bool) -> Result<(), ScanError> {
        if empty {
            return Ok(());
        }
        let mut depth = 1usize;
        while depth > 0 {
            match self.next()? {
                Ev::Start(_) => depth += 1,
                Ev::End => depth -= 1,
                Ev::Eof => return Err(xml_error("unclosed element")),
                _ => {}
            }
        }
        Ok(())
    }

    fn document(&mut self, len: usize) -> Result<Scan, ScanError> {
        // L'elemento radice.
        let root = loop {
            match self.next()? {
                Ev::Start(el) if el.is_w("document") => break el,
                Ev::Start(_) | Ev::Empty(_) => return Err(ScanError::Shape("root")),
                Ev::Eof => return Err(xml_error("no root element")),
                _ => {}
            }
        };
        let root = root.start..self.position();
        let mut scan = None;
        loop {
            match self.next()? {
                Ev::Start(el) if el.is_w("body") && scan.is_none() => {
                    scan = Some(self.body(root.clone())?);
                }
                Ev::Start(_) => self.skip(false)?,
                Ev::Empty(el) if el.is_w("body") && scan.is_none() => {
                    let head = self.position();
                    scan = Some(Scan {
                        root: root.clone(),
                        head,
                        units: Vec::new(),
                        sect: head..head,
                        blocks: Vec::new(),
                    });
                }
                Ev::End => break,
                Ev::Eof => return Err(xml_error("unclosed element")),
                _ => {}
            }
        }
        loop {
            match self.next()? {
                Ev::Eof => break,
                Ev::Start(_) | Ev::Empty(_) => return Err(xml_error("two root elements")),
                _ => {}
            }
        }
        let scan = scan.ok_or(ScanError::Shape("no body"))?;
        if scan.sect.end > len {
            return Err(ScanError::Shape("past the end"));
        }
        Ok(scan)
    }

    fn body(&mut self, root: Range<usize>) -> Result<Scan, ScanError> {
        let head = self.position();
        let mut units: Vec<Unit> = Vec::new();
        let (mut unit_start, mut unit_block) = (head, 0usize);
        let mut sect: Option<Range<usize>> = None;
        // Un segno dopo l'ultima unità.
        let mut trailing = false;
        let end = loop {
            let at = self.position();
            let (el, empty) = match self.next()? {
                Ev::Start(el) => (el, false),
                Ev::Empty(el) => (el, true),
                Ev::Text(_) => continue,
                Ev::End => break at,
                Ev::Eof => return Err(xml_error("unclosed element")),
            };
            if sect.is_some() {
                return Err(ScanError::Shape("content after the last section"));
            }
            if el.is_w("sectPr") {
                let start = el.start;
                self.skip(empty)?;
                sect = Some(start..self.position());
                continue;
            }
            let marker = el.ns == NS_W && MARKERS.contains(&el.local.as_str());
            self.block_level(el, empty)?;
            if marker {
                trailing = true;
                continue;
            }
            if trailing && self.blocks.len() == unit_block {
                // I segni sono nei byte di questa unità, ma andrebbero con il
                // blocco di un'altra.
                return Err(ScanError::Shape("markers before an empty unit"));
            }
            units.push(Unit {
                bytes: unit_start..self.position(),
                blocks: unit_block..self.blocks.len(),
            });
            (unit_start, unit_block, trailing) = (self.position(), self.blocks.len(), false);
        };
        let sect = sect.unwrap_or(end..end);
        // I segni dopo l'ultimo blocco: con l'ultima unità, e nel flusso
        // dell'ultimo blocco.
        if trailing {
            let tokens = std::mem::take(&mut self.pending);
            match (units.last_mut(), self.blocks.last_mut()) {
                (Some(unit), Some(block)) if unit.blocks.end == unit_block => {
                    if unit.blocks.is_empty() {
                        return Err(ScanError::Shape("markers after an empty unit"));
                    }
                    unit.bytes.end = sect.start;
                    block.extend(tokens);
                }
                (None, None) => units.push(Unit {
                    bytes: unit_start..sect.start,
                    blocks: 0..0,
                }),
                _ => return Err(ScanError::Shape("markers after the last block")),
            }
        }
        Ok(Scan {
            root,
            head,
            units,
            sect,
            blocks: std::mem::take(&mut self.blocks),
        })
    }

    /// Dove va un token di un blocco: nel blocco corrente.
    fn push(&mut self, token: Token) {
        if let Some(block) = self.blocks.last_mut() {
            block.push(token);
        } else {
            self.pending.push(token);
        }
    }

    fn new_block(&mut self) {
        let pending = std::mem::take(&mut self.pending);
        self.blocks.push(pending);
    }

    /// Un elemento al livello dei blocchi: un figlio di `w:body`, del
    /// contenuto di un content control di blocco o di un contenitore
    /// trasparente.
    fn block_level(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        let w = el.ns == NS_W;
        if w && el.local == "sdt" {
            return self.block_sdt(empty);
        }
        if w && WRAPPERS.contains(&el.local.as_str()) {
            return self.block_wrapper(el, empty);
        }
        if w && MARKERS.contains(&el.local.as_str()) {
            let token = self.object(el, empty, ObjKind::Marker, Arc::default())?;
            self.pending.push(token);
            return Ok(());
        }
        self.new_block();
        self.inner_block(el, empty)
    }

    /// Un content control di blocco: il suo contenuto sono blocchi, e le sue
    /// proprietà aprono il primo.
    fn block_sdt(&mut self, empty: bool) -> Result<(), ScanError> {
        let mut props = Vec::new();
        let (first, mark) = (self.blocks.len(), self.pending.len());
        let mut opened = false;
        if !empty {
            loop {
                let (child, child_empty) = match self.next()? {
                    Ev::Start(child) => (child, false),
                    Ev::Empty(child) => (child, true),
                    Ev::Text(_) => continue,
                    Ev::End => break,
                    Ev::Eof => return Err(xml_error("unclosed element")),
                };
                if child.is_w("sdtContent") && !opened {
                    self.pending.push(Token::Open(
                        Arc::from("w:sdt"),
                        Arc::new(Sig::of(std::mem::take(&mut props))),
                    ));
                    opened = true;
                    if !child_empty {
                        self.block_children()?;
                    }
                    continue;
                }
                let name = child.name();
                let node = self.capture(child, child_empty)?;
                if opened {
                    // Dopo il contenuto (`w:sdtEndPr` in un file che non
                    // segue l'ordine dello schema): con l'ultimo blocco.
                    let mut items = Vec::new();
                    node.inner_items(&name, &mut items);
                    if self.blocks.len() > first {
                        self.push_obj(&name, items);
                    }
                } else {
                    node.items(&name, &mut props);
                }
            }
        }
        self.close_wrapper(first, mark, opened, "w:sdt");
        Ok(())
    }

    /// La chiusura di un contenitore di blocchi: con l'ultimo dei suoi
    /// blocchi, con i segni rimasti. Senza blocchi l'involucro e ciò che
    /// contiene non vanno con nessuno, come per l'inventario; restano i segni
    /// che lo precedono (`mark`).
    fn close_wrapper(&mut self, first: usize, mark: usize, opened: bool, name: &str) {
        if self.blocks.len() > first {
            let pending = std::mem::take(&mut self.pending);
            if let Some(block) = self.blocks.last_mut() {
                block.extend(pending);
                if opened {
                    block.push(Token::Close(Arc::from(name)));
                }
            }
        } else {
            self.pending.truncate(mark);
        }
    }

    /// I figli di un elemento i cui figli sono blocchi.
    fn block_children(&mut self) -> Result<(), ScanError> {
        loop {
            match self.next()? {
                Ev::Start(child) => self.block_level(child, false)?,
                Ev::Empty(child) => self.block_level(child, true)?,
                Ev::Text(_) => {}
                Ev::End => return Ok(()),
                Ev::Eof => return Err(xml_error("unclosed element")),
            }
        }
    }

    /// Un contenitore trasparente di blocchi (`w:customXml`, `w:smartTag`,
    /// `w:ins`, `w:moveTo`): le sue proprietà aprono il primo blocco.
    fn block_wrapper(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        let name = el.name();
        let mut props: Vec<String> = self
            .attrs(&el)
            .into_iter()
            .map(|(k, v)| format!("{name}@{k}={v}"))
            .collect();
        let (first, mark) = (self.blocks.len(), self.pending.len());
        let mut opened = false;
        if !empty {
            loop {
                let (child, child_empty) = match self.next()? {
                    Ev::Start(child) => (child, false),
                    Ev::Empty(child) => (child, true),
                    Ev::Text(_) => continue,
                    Ev::End => break,
                    Ev::Eof => return Err(xml_error("unclosed element")),
                };
                if !opened && child.ns == NS_W && child.local.ends_with("Pr") {
                    let child_name = child.name();
                    let node = self.capture(child, child_empty)?;
                    node.items(&format!("{name}/{child_name}"), &mut props);
                    continue;
                }
                if !opened {
                    self.pending.push(Token::Open(
                        Arc::from(name.as_str()),
                        Arc::new(Sig::of(std::mem::take(&mut props))),
                    ));
                    opened = true;
                }
                self.block_level(child, child_empty)?;
            }
        }
        self.close_wrapper(first, mark, opened, &name);
        Ok(())
    }

    /// Un elemento dentro un blocco che contiene blocchi: un paragrafo, una
    /// tabella, un contenitore; ogni altro è un oggetto.
    fn inner_block(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        if el.ns == NS_W {
            match el.local.as_str() {
                "p" => return self.paragraph(el, empty),
                "tbl" => return self.structure(el, empty, &["tblPr", "tblGrid"]),
                "tr" => return self.structure(el, empty, &["trPr", "tblPrEx"]),
                "tc" => return self.structure(el, empty, &["tcPr"]),
                "sdt" => return self.structure(el, empty, &["sdtPr", "sdtEndPr"]),
                "sdtContent" => return self.structure(el, empty, &[]),
                local if WRAPPERS.contains(&local) || matches!(local, "del" | "moveFrom") => {
                    return self.structure(el, empty, &["customXmlPr", "smartTagPr"]);
                }
                local if MARKERS.contains(&local) => {
                    let token = self.object(el, empty, ObjKind::Marker, Arc::default())?;
                    self.push(token);
                    return Ok(());
                }
                _ => {}
            }
        }
        let token = self.object(el, empty, ObjKind::Other, Arc::default())?;
        self.push(token);
        Ok(())
    }

    /// Una struttura con le sue proprietà (`props`, i nomi locali dei figli
    /// che lo sono): si apre con quelle, poi i suoi figli, poi si chiude.
    fn structure(&mut self, el: El, empty: bool, props: &[&str]) -> Result<(), ScanError> {
        let name = el.name();
        let mut items: Vec<String> = self
            .attrs(&el)
            .into_iter()
            .map(|(k, v)| format!("{name}@{k}={v}"))
            .collect();
        let mut opened = false;
        if !empty {
            loop {
                let (child, child_empty) = match self.next()? {
                    Ev::Start(child) => (child, false),
                    Ev::Empty(child) => (child, true),
                    Ev::Text(_) => continue,
                    Ev::End => break,
                    Ev::Eof => return Err(xml_error("unclosed element")),
                };
                if child.ns == NS_W && props.contains(&child.local.as_str()) {
                    let child_name = child.name();
                    let node = self.capture(child, child_empty)?;
                    if opened {
                        // Proprietà dopo il contenuto (`w:sdtEndPr`): un
                        // oggetto dove si trovano.
                        let mut obj = Vec::new();
                        node.inner_items(&child_name, &mut obj);
                        self.push_obj(&child_name, obj);
                    } else {
                        node.inner_items(&child_name, &mut items);
                    }
                    continue;
                }
                if !opened {
                    self.push(Token::Open(
                        Arc::from(name.as_str()),
                        Arc::new(Sig::of(std::mem::take(&mut items))),
                    ));
                    opened = true;
                }
                self.inner_block(child, child_empty)?;
            }
        }
        if !opened {
            self.push(Token::Open(Arc::from(name.as_str()), Arc::new(Sig::of(items))));
        }
        self.push(Token::Close(Arc::from(name.as_str())));
        Ok(())
    }

    fn push_obj(&mut self, name: &str, mut items: Vec<String>) {
        items.sort_unstable();
        let obj = Obj {
            kind: ObjKind::Other,
            name: name.to_string(),
            items,
        };
        self.emit(Token::Obj(Arc::new(obj), Arc::default()));
    }

    /// Un oggetto catturato intero.
    fn object(
        &mut self,
        el: El,
        empty: bool,
        kind: ObjKind,
        context: Arc<Sig>,
    ) -> Result<Token, ScanError> {
        let name = el.name();
        let node = self.capture(el, empty)?;
        let mut items = Vec::new();
        node.inner_items(&name, &mut items);
        items.sort_unstable();
        Ok(Token::Obj(Arc::new(Obj { kind, name, items }), context))
    }

    fn paragraph(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        let mut items: Vec<String> = self
            .attrs(&el)
            .into_iter()
            .map(|(k, v)| format!("w:p@{k}={v}"))
            .collect();
        if !empty {
            loop {
                let (child, child_empty) = match self.next()? {
                    Ev::Start(child) => (child, false),
                    Ev::Empty(child) => (child, true),
                    Ev::Text(_) => continue,
                    Ev::End => break,
                    Ev::Eof => return Err(xml_error("unclosed element")),
                };
                if child.is_w("pPr") {
                    let node = self.capture(child, child_empty)?;
                    node.inner_items("w:pPr", &mut items);
                    continue;
                }
                self.inline(child, child_empty)?;
            }
        }
        self.push(Token::Para(Arc::new(Sig::of(items))));
        Ok(())
    }

    /// Le voci del contesto degli involucri aperti.
    fn context_items(&self) -> Vec<String> {
        self.context.iter().flatten().cloned().collect()
    }

    /// Un figlio del contenuto di un paragrafo.
    fn inline(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        if skipped_element(&el.ns, &el.local).is_some() {
            return self.skip(empty);
        }
        if el.ns == NS_W {
            match el.local.as_str() {
                "r" => return self.run(empty),
                "fldSimple" => return self.simple_field(el, empty),
                "hyperlink" | "smartTag" | "customXml" | "ins" | "del" | "moveFrom" | "moveTo"
                | "dir" | "bdo" => return self.inline_wrapper(el, empty),
                "sdt" => return self.inline_sdt(empty),
                local if MARKERS.contains(&local) => {
                    let token = self.object(el, empty, ObjKind::Marker, Arc::default())?;
                    self.emit(token);
                    return Ok(());
                }
                _ => {}
            }
        }
        let context = Arc::new(Sig::of(self.context_items()));
        let token = self.object(el, empty, ObjKind::Other, context)?;
        self.emit(token);
        Ok(())
    }

    fn inline_wrapper(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        let name = format!("ctx/{}", el.name());
        let mut items: Vec<String> = vec![name.clone()];
        items.extend(
            self.attrs(&el)
                .into_iter()
                .map(|(k, v)| format!("{name}@{k}={v}")),
        );
        if empty {
            return Ok(());
        }
        self.context.push(items);
        let result = self.inline_children(&name);
        self.context.pop();
        result
    }

    /// I figli di un involucro in riga; le sue proprietà (`w:smartTagPr`,
    /// `w:customXmlPr`) entrano nel contesto.
    fn inline_children(&mut self, name: &str) -> Result<(), ScanError> {
        loop {
            let (child, child_empty) = match self.next()? {
                Ev::Start(child) => (child, false),
                Ev::Empty(child) => (child, true),
                Ev::Text(_) => continue,
                Ev::End => return Ok(()),
                Ev::Eof => return Err(xml_error("unclosed element")),
            };
            if child.is_w("smartTagPr") || child.is_w("customXmlPr") {
                let child_name = child.name();
                let node = self.capture(child, child_empty)?;
                if let Some(context) = self.context.last_mut() {
                    node.inner_items(&format!("{name}/{child_name}"), context);
                }
                continue;
            }
            self.inline(child, child_empty)?;
        }
    }

    /// Un content control in riga: le sue proprietà sono contesto dei
    /// caratteri del suo contenuto.
    fn inline_sdt(&mut self, empty: bool) -> Result<(), ScanError> {
        if empty {
            return Ok(());
        }
        let mut items = vec!["ctx/w:sdt".to_string()];
        loop {
            let (child, child_empty) = match self.next()? {
                Ev::Start(child) => (child, false),
                Ev::Empty(child) => (child, true),
                Ev::Text(_) => continue,
                Ev::End => return Ok(()),
                Ev::Eof => return Err(xml_error("unclosed element")),
            };
            if child.is_w("sdtContent") {
                self.context.push(std::mem::take(&mut items));
                let result = if child_empty {
                    Ok(())
                } else {
                    self.inline_children("ctx/w:sdt")
                };
                self.context.pop();
                result?;
                continue;
            }
            let child_name = child.name();
            let node = self.capture(child, child_empty)?;
            if child_name == "w:sdtEndPr" {
                let mut obj = Vec::new();
                node.inner_items(&child_name, &mut obj);
                self.push_obj(&child_name, obj);
            } else {
                node.items(&format!("ctx/w:sdt/{child_name}"), &mut items);
            }
        }
    }

    /// Un campo semplice: lo stesso flusso di un campo con `w:fldChar`.
    fn simple_field(&mut self, el: El, empty: bool) -> Result<(), ScanError> {
        let instr = el.attr(NS_W, "instr").unwrap_or_default().to_string();
        let mut items: Vec<String> = self
            .attrs(&el)
            .into_iter()
            .filter(|(k, _)| k != "w:instr")
            .map(|(k, v)| format!("field@{k}={v}"))
            .collect();
        let mut result = Vec::new();
        if !empty {
            // `w:fldData` è il dato del campo; il resto è il risultato.
            loop {
                let (child, child_empty) = match self.next()? {
                    Ev::Start(child) => (child, false),
                    Ev::Empty(child) => (child, true),
                    Ev::Text(_) => continue,
                    Ev::End => break,
                    Ev::Eof => return Err(xml_error("unclosed element")),
                };
                if child.is_w("fldData") {
                    let node = self.capture(child, child_empty)?;
                    node.items("field/w:fldData", &mut items);
                    continue;
                }
                if result.is_empty() {
                    result.push(());
                    self.begin_field(instr.clone(), std::mem::take(&mut items));
                    self.separate_field();
                }
                self.inline(child, child_empty)?;
            }
        }
        if result.is_empty() {
            self.begin_field(instr, items);
            self.separate_field();
        }
        self.end_field();
        Ok(())
    }

    fn begin_field(&mut self, instr: String, items: Vec<String>) {
        self.fields.push(Field {
            instr,
            items,
            result: false,
            emitted: false,
        });
    }

    /// Se ciò che segue va nell'istruzione di un campo aperto, e non nel
    /// flusso.
    fn in_instructions(&self) -> bool {
        self.fields.iter().any(|field| !field.result)
    }

    /// Il campo aperto più interno che legge ancora l'istruzione.
    fn instructions(&mut self) -> Option<&mut Field> {
        self.fields.iter_mut().rev().find(|field| !field.result)
    }

    fn field_token(field: &Field) -> Token {
        let instr: Vec<&str> = field.instr.split_whitespace().collect();
        let mut items = field.items.clone();
        items.push(format!("field#{}", instr.join(" ")));
        items.sort_unstable();
        Token::Obj(
            Arc::new(Obj {
                kind: ObjKind::Field,
                name: "field".into(),
                items,
            }),
            Arc::default(),
        )
    }

    /// La fine dell'istruzione: il campo entra nel flusso, se non è dentro
    /// l'istruzione di un altro.
    fn separate_field(&mut self) {
        let Some(field) = self.fields.last_mut() else {
            return;
        };
        if field.result {
            return;
        }
        field.result = true;
        if !self.in_instructions() {
            if let Some(field) = self.fields.last_mut() {
                field.emitted = true;
                let token = Self::field_token(field);
                self.push(token);
            }
        }
    }

    fn end_field(&mut self) {
        let Some(field) = self.fields.pop() else {
            // Una fine senza inizio: un oggetto come un altro.
            self.emit(Token::Obj(
                Arc::new(Obj {
                    kind: ObjKind::FieldEnd,
                    name: "/field".into(),
                    items: vec!["unopened".into()],
                }),
                Arc::default(),
            ));
            return;
        };
        if let Some(outer) = self.instructions() {
            // Un campo dentro l'istruzione di un altro: ne è una parte.
            let instr: Vec<&str> = field.instr.split_whitespace().collect();
            outer.instr.push_str(&format!(" {{{}}} ", instr.join(" ")));
            return;
        }
        if !field.emitted {
            self.push(Self::field_token(&field));
        }
        self.push(Token::Obj(
            Arc::new(Obj {
                kind: ObjKind::FieldEnd,
                name: "/field".into(),
                items: Vec::new(),
            }),
            Arc::default(),
        ));
    }

    /// Un token del contenuto di un paragrafo: nell'istruzione del campo
    /// aperto, o nel blocco.
    fn emit(&mut self, token: Token) {
        if let Some(field) = self.instructions() {
            match &token {
                Token::Char(c, _) => field.instr.push(*c),
                other => field.instr.push_str(&format!(" {} ", other.describe())),
            }
            return;
        }
        self.push(token);
    }

    fn run(&mut self, empty: bool) -> Result<(), ScanError> {
        if empty {
            return Ok(());
        }
        let mut pieces: Vec<Piece> = Vec::new();
        let mut props: Vec<String> = Vec::new();
        loop {
            let (child, child_empty) = match self.next()? {
                Ev::Start(child) => (child, false),
                Ev::Empty(child) => (child, true),
                Ev::Text(_) => continue,
                Ev::End => break,
                Ev::Eof => return Err(xml_error("unclosed element")),
            };
            if skipped_element(&child.ns, &child.local).is_some() {
                self.skip(child_empty)?;
                continue;
            }
            let local = if child.ns == NS_W {
                child.local.clone()
            } else {
                String::new()
            };
            match local.as_str() {
                "rPr" => {
                    let node = self.capture(child, child_empty)?;
                    node.inner_items("w:rPr", &mut props);
                }
                "t" | "delText" => {
                    let node = self.capture(child, child_empty)?;
                    pieces.extend(node.text.chars().map(Piece::Char));
                }
                "instrText" | "delInstrText" => {
                    let node = self.capture(child, child_empty)?;
                    pieces.push(Piece::Instr(node.text));
                }
                "noBreakHyphen" => {
                    self.skip(child_empty)?;
                    pieces.push(Piece::Char('\u{2011}'));
                }
                "softHyphen" => {
                    self.skip(child_empty)?;
                    pieces.push(Piece::Char('\u{00AD}'));
                }
                "fldChar" => {
                    // I pezzi prima vanno nel flusso prima dello stato del
                    // campo.
                    let kind = child
                        .attr(NS_W, "fldCharType")
                        .unwrap_or_default()
                        .to_string();
                    let node = self.capture(child, child_empty)?;
                    let mut items = Vec::new();
                    node.inner_items("field", &mut items);
                    items.retain(|item| !item.starts_with("field@w:fldCharType="));
                    self.flush(&mut pieces, &props);
                    match kind.as_str() {
                        "begin" => self.begin_field(String::new(), items),
                        "separate" => self.separate_field(),
                        "end" => self.end_field(),
                        _ => {}
                    }
                }
                "cr" => {
                    // Un a capo, come `w:br` senza tipo.
                    self.skip(child_empty)?;
                    pieces.push(Piece::Obj(Arc::new(Obj {
                        kind: ObjKind::Other,
                        name: "w:br".into(),
                        items: Vec::new(),
                    })));
                }
                _ => {
                    let name = child.name();
                    let node = self.capture(child, child_empty)?;
                    let mut items = Vec::new();
                    node.inner_items(&name, &mut items);
                    items.sort_unstable();
                    pieces.push(Piece::Obj(Arc::new(Obj {
                        kind: ObjKind::Other,
                        name,
                        items,
                    })));
                }
            }
        }
        self.flush(&mut pieces, &props);
        Ok(())
    }

    /// I pezzi raccolti di un run, con le sue proprietà e il contesto.
    fn flush(&mut self, pieces: &mut Vec<Piece>, props: &[String]) {
        if pieces.is_empty() {
            return;
        }
        let mut items = props.to_vec();
        items.extend(self.context_items());
        let sig = Arc::new(Sig::of(items));
        for piece in pieces.drain(..) {
            match piece {
                Piece::Char(c) => self.emit(Token::Char(c, sig.clone())),
                Piece::Obj(obj) => self.emit(Token::Obj(obj, sig.clone())),
                Piece::Instr(text) => match self.instructions() {
                    Some(field) => {
                        field.instr.push_str(&text);
                        field.instr.push(' ');
                    }
                    None => {
                        let items = vec![format!("w:instrText#{}", text.trim())];
                        let obj = Obj {
                            kind: ObjKind::Other,
                            name: "w:instrText".into(),
                            items,
                        };
                        self.emit(Token::Obj(Arc::new(obj), sig.clone()));
                    }
                },
            }
        }
    }
}

/// Ciò che un run contiene, prima di conoscerne tutte le proprietà.
enum Piece {
    Char(char),
    Obj(Arc<Obj>),
    /// Un pezzo dell'istruzione di un campo.
    Instr(String),
}

/// Il documento principale di un pacchetto: la parte, i suoi byte letti e il
/// suo corpo come flusso.
pub(crate) struct Main {
    pub zip: Zip,
    pub types: ContentTypes,
    pub part: String,
    pub rels: Vec<Relationship>,
    pub scan: Scan,
}

const OFFICE_DOCUMENT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/// Legge il pacchetto e il corpo del suo documento principale.
pub(crate) fn main_of(bytes: &[u8], limits: &Limits) -> Result<Main, ScanError> {
    let zip = Zip::read(bytes, limits)?;
    let types = ContentTypes::read(&zip, limits)?;
    let root = read_rels(&zip, "", limits)?;
    let part = root
        .iter()
        .find(|rel| rel.kind == OFFICE_DOCUMENT && !rel.external)
        .map(|rel| resolve("", &rel.target))
        .ok_or(ScanError::Shape("no main document"))?;
    let xml = zip
        .parts
        .get(&part)
        .ok_or(ScanError::Shape("no main document"))?;
    let rels = read_rels(&zip, &part, limits)?;
    let by_id = described(&zip, &types, &part, &rels);
    let scan = scan(xml, &by_id, limits)?;
    Ok(Main {
        zip,
        types,
        part,
        rels,
        scan,
    })
}

/// Le voci di `before` che `after` non ha; le due liste sono ordinate.
fn missing<'a>(before: &'a [String], after: &[String]) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut j = 0;
    for item in before {
        while j < after.len() && after[j] < *item {
            j += 1;
        }
        if j < after.len() && after[j] == *item {
            j += 1;
        } else {
            out.push(item.as_str());
        }
    }
    out
}

/// Gli indici allineati di due flussi, per chiave.
fn aligned(before: &[Token], after: &[Token]) -> Vec<(usize, usize)> {
    let a: Vec<Key> = before.iter().map(Token::key).collect();
    let b: Vec<Key> = after.iter().map(Token::key).collect();
    crate::diff::common(&a, &b)
}

fn describe_at(tokens: &[Token], at: usize) -> String {
    let start = at.saturating_sub(8);
    let around: String = tokens[start..(at + 8).min(tokens.len())]
        .iter()
        .map(|token| match token {
            Token::Char(c, _) => c.to_string(),
            _ => "·".into(),
        })
        .collect();
    format!("{} at {at} ({around:?})", tokens[at].describe())
}

/// La regola all'apertura, per un blocco: la prova a vuoto `after` porta ogni
/// token di `before` nello stesso ordine e, per ciascuno, ogni sua voce. Il
/// codec può aggiungere, non togliere né spostare.
pub(crate) fn carries(before: &[Token], after: &[Token]) -> Result<(), String> {
    let pairs = aligned(before, after);
    let mut next = 0;
    for (i, j) in pairs {
        if i > next {
            return Err(format!("lost {}", describe_at(before, next)));
        }
        next = i + 1;
        if let (Token::Obj(b, _), Token::Obj(a, _)) = (&before[i], &after[j]) {
            if let Some(item) = missing(&b.items, &a.items).first() {
                return Err(format!("{}: lost {item}", describe_at(before, i)));
            }
        }
        if let (Some(b), Some(a)) = (before[i].sig(), after[j].sig()) {
            if let Some(item) = missing(&b.full, &a.full).first() {
                return Err(format!("{}: lost {item}", describe_at(before, i)));
            }
        }
    }
    if next < before.len() {
        return Err(format!("lost {}", describe_at(before, next)));
    }
    Ok(())
}

/// La regola al salvataggio, sul tratto che l'utente ha toccato: ogni token
/// che resta tiene le voci che la proiezione non porta, e nessun segno
/// invisibile sparisce fra due token che restano vicini.
pub(crate) fn keeps(before: &[Token], after: &[Token]) -> Result<(), String> {
    let pairs = aligned(before, after);
    // Dove va ogni token di `before`, se resta.
    let mut to = vec![None; before.len()];
    for &(i, j) in &pairs {
        to[i] = Some(j);
        // Un segno o un campo non si modifica dalla superficie: resta intero.
        if let (Token::Obj(b, _), Token::Obj(a, _)) = (&before[i], &after[j]) {
            if b.kind != ObjKind::Other {
                if let Some(item) = missing(&b.items, &a.items).first() {
                    return Err(format!("{}: lost {item}", describe_at(before, i)));
                }
            }
        }
        if let (Some(b), Some(a)) = (before[i].sig(), after[j].sig()) {
            if let Some(item) = missing(&b.opaque, &a.opaque).first() {
                return Err(format!("{}: lost {item}", describe_at(before, i)));
            }
        }
    }
    for (i, token) in before.iter().enumerate() {
        if to[i].is_some() {
            continue;
        }
        let Token::Obj(obj, _) = token else {
            continue;
        };
        if obj.kind != ObjKind::Marker {
            continue;
        }
        // Il token precedente e quello successivo che restano: se fra i due
        // non c'erano che segni e restano vicini, nessuno ha tolto il testo
        // intorno.
        let prev = (0..i).rev().find_map(|k| to[k].map(|j| (k, j)));
        let next = (i + 1..before.len()).find_map(|k| to[k].map(|j| (k, j)));
        let from = prev.map_or(0, |(k, _)| k + 1);
        let until = next.map_or(before.len(), |(k, _)| k);
        let only_markers = before[from..until].iter().all(|token| {
            matches!(token, Token::Obj(obj, _) if obj.kind == ObjKind::Marker)
        });
        let adjacent = match (prev, next) {
            (Some((_, pj)), Some((_, nj))) => nj == pj + 1,
            (None, Some((_, nj))) => nj == 0,
            (Some((_, pj)), None) => pj + 1 == after.len(),
            (None, None) => after.is_empty(),
        };
        let close = only_markers && adjacent;
        if close {
            return Err(format!("dropped {}", describe_at(before, i)));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

    fn blocks(body: &str) -> Vec<Vec<Token>> {
        let xml = format!(r#"<w:document {W}><w:body>{body}</w:body></w:document>"#);
        scan(xml.as_bytes(), &BTreeMap::new(), &crate::inventory::LIMITS)
            .expect("scan")
            .blocks
    }

    fn one(body: &str) -> Vec<Token> {
        let mut all = blocks(body);
        assert_eq!(all.len(), 1, "{body}");
        all.remove(0)
    }

    fn text(tokens: &[Token]) -> String {
        tokens
            .iter()
            .map(|token| match token {
                Token::Char(c, _) => c.to_string(),
                Token::Obj(obj, _) => format!("<{}>", obj.name),
                Token::Para(_) => "¶".into(),
                Token::Open(name, _) => format!("[{name}"),
                Token::Close(name) => format!("{name}]"),
            })
            .collect()
    }

    #[test]
    fn i_run_spariscono_e_le_proprietà_restano_sui_caratteri() {
        let a = one(r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>c</w:t></w:r></w:p>"#);
        let b = one(r#"<w:p w:rsidR="00AB"><w:r><w:rPr><w:b/></w:rPr><w:t>abc</w:t></w:r></w:p>"#);
        assert_eq!(a, b);
        assert_eq!(text(&a), "abc¶");
        let Token::Char(_, sig) = &a[0] else { panic!() };
        assert_eq!(sig.full, vec!["w:rPr/w:b".to_string()]);
        assert!(sig.opaque.is_empty());
    }

    #[test]
    fn un_grassetto_esteso_o_un_segnalibro_spostato_si_vedono() {
        let before = one(r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="x"/><w:r><w:t>cd</w:t></w:r></w:p>"#);
        let wider = one(r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>abc</w:t></w:r><w:bookmarkStart w:id="0" w:name="x"/><w:r><w:t>d</w:t></w:r></w:p>"#);
        let moved = one(r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ab</w:t></w:r><w:r><w:t>c</w:t></w:r><w:bookmarkStart w:id="0" w:name="x"/><w:r><w:t>d</w:t></w:r></w:p>"#);
        assert!(carries(&before, &before).is_ok());
        // Il grassetto in più sul carattere è un'aggiunta; il segnalibro
        // dopo la «c» invece che prima è una perdita.
        assert!(carries(&before, &wider).is_err());
        assert!(carries(&wider, &before).is_err());
        assert!(carries(&before, &moved).is_err());
    }

    #[test]
    fn campi_semplici_e_complessi_sono_lo_stesso_flusso() {
        let simple = one(r#"<w:p><w:fldSimple w:instr=" PAGE  \* MERGEFORMAT "><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>"#);
        let complex = one(r#"<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:instrText>\* MERGEFORMAT</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#);
        assert_eq!(text(&simple), "<field>3</field>¶");
        assert_eq!(simple, complex);
    }

    #[test]
    fn la_disposizione_asiatica_è_opaca_e_il_grassetto_no() {
        let tokens = one(r#"<w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="A" w:eastAsia="B"/><w:lang w:eastAsia="ja-JP"/><w:eastAsianLayout w:combine="1"/></w:rPr><w:t>x</w:t></w:r></w:p>"#);
        let Token::Char(_, sig) = &tokens[0] else { panic!() };
        assert_eq!(
            sig.opaque,
            vec![
                "w:rPr/w:eastAsianLayout".to_string(),
                "w:rPr/w:eastAsianLayout@w:combine=1".into(),
                "w:rPr/w:lang".into(),
                "w:rPr/w:lang@w:eastAsia=ja-JP".into(),
                "w:rPr/w:rFonts@w:eastAsia=B".into(),
            ]
        );
        let plain = one(r#"<w:p><w:r><w:rPr><w:b/><w:i/><w:rFonts w:ascii="C"/></w:rPr><w:t>x</w:t></w:r></w:p>"#);
        let lost = keeps(&tokens, &plain).expect_err("perdita");
        assert!(lost.contains("eastAsianLayout"), "{lost}");
        // Cambiare ciò che la proiezione scrive non è una perdita.
        let edited = one(r#"<w:p><w:r><w:rPr><w:i/><w:rFonts w:ascii="C" w:eastAsia="B"/><w:lang w:eastAsia="ja-JP"/><w:eastAsianLayout w:combine="1"/></w:rPr><w:t>xy</w:t></w:r></w:p>"#);
        assert!(keeps(&tokens, &edited).is_ok());
    }

    #[test]
    fn un_segno_sparito_fra_due_caratteri_che_restano_è_una_perdita() {
        let before = one(r#"<w:p><w:r><w:t>ab</w:t></w:r><w:bookmarkStart w:id="0" w:name="x"/><w:r><w:t>cd</w:t></w:r></w:p>"#);
        let dropped = one(r#"<w:p><w:r><w:t>abcd</w:t></w:r></w:p>"#);
        let with_text = one(r#"<w:p><w:r><w:t>abd</w:t></w:r></w:p>"#);
        assert!(keeps(&before, &dropped).is_err());
        // Con il testo intorno, l'ha tolto chi ha tolto il testo.
        assert!(keeps(&before, &with_text).is_ok());
    }

    #[test]
    fn i_blocchi_sono_quelli_dell_inventario() {
        let all = blocks(concat!(
            r#"<w:bookmarkStart w:id="1" w:name="a"/><w:p><w:r><w:t>uno</w:t></w:r></w:p>"#,
            r#"<w:sdt><w:sdtPr><w:alias w:val="s"/></w:sdtPr><w:sdtContent><w:p/><w:p/></w:sdtContent></w:sdt>"#,
            r#"<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
            r#"<w:bookmarkEnd w:id="1"/><w:sectPr/>"#,
        ));
        assert_eq!(all.len(), 4);
        assert_eq!(text(&all[0]), "<w:bookmarkStart>uno¶");
        assert_eq!(text(&all[1]), "[w:sdt¶");
        assert_eq!(text(&all[2]), "¶w:sdt]");
        assert_eq!(text(&all[3]), "[w:tbl[w:tr[w:tc¶w:tc]w:tr]w:tbl]<w:bookmarkEnd>");
    }

    #[test]
    fn le_unità_coprono_il_corpo() {
        let body = concat!(
            r#"<w:bookmarkStart w:id="1" w:name="a"/><w:p><w:r><w:t>uno</w:t></w:r></w:p>"#,
            r#"<w:sdt><w:sdtContent><w:p/><w:p/></w:sdtContent></w:sdt>"#,
            r#"<w:p/><w:bookmarkEnd w:id="1"/>"#,
            r#"<w:sectPr><w:pgSz w:w="11906"/></w:sectPr>"#,
        );
        let xml = format!(r#"<w:document {W}><w:body>{body}</w:body></w:document>"#);
        let scan = scan(xml.as_bytes(), &BTreeMap::new(), &crate::inventory::LIMITS).unwrap();
        let pieces: Vec<&str> = scan.units.iter().map(|u| &xml[u.bytes.clone()]).collect();
        assert_eq!(
            pieces,
            vec![
                r#"<w:bookmarkStart w:id="1" w:name="a"/><w:p><w:r><w:t>uno</w:t></w:r></w:p>"#,
                r#"<w:sdt><w:sdtContent><w:p/><w:p/></w:sdtContent></w:sdt>"#,
                r#"<w:p/><w:bookmarkEnd w:id="1"/>"#,
            ]
        );
        let blocks: Vec<_> = scan.units.iter().map(|u| u.blocks.clone()).collect();
        assert_eq!(blocks, vec![0..1, 1..3, 3..4]);
        assert_eq!(&xml[scan.sect.clone()], r#"<w:sectPr><w:pgSz w:w="11906"/></w:sectPr>"#);
        assert_eq!(&xml[..scan.head], &xml[..xml.find("<w:body>").unwrap() + 8]);
        assert!(xml[scan.root.clone()].starts_with("<w:document "));
    }

    /// Il resoconto sul corpus: `cargo test -p fub-format-rich --lib
    /// flow::tests::corpus -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn corpus() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/docx");
        let mut names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "docx"))
            .collect();
        names.sort();
        for path in names {
            let bytes = std::fs::read(&path).unwrap();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let mut document = match crate::Codec::Docx.read(&bytes) {
                Ok(document) => document,
                Err(error) => {
                    println!("{name}: unreadable {error:?}");
                    continue;
                }
            };
            document.normalize_runs();
            let dry = crate::Codec::Docx.write(&document).unwrap();
            let (o, d) = match (main_of(&bytes, &crate::inventory::LIMITS), main_of(&dry, &crate::inventory::LIMITS)) {
                (Ok(o), Ok(d)) => (o, d),
                (o, d) => {
                    println!("{name}: scan {:?} / {:?}", o.err(), d.err());
                    continue;
                }
            };
            let (ob, db, mb) = (o.scan.blocks.len(), d.scan.blocks.len(), document.body.len());
            let mut lossy = Vec::new();
            if ob == db {
                for (at, (b, a)) in o.scan.blocks.iter().zip(&d.scan.blocks).enumerate() {
                    if let Err(why) = carries(b, a) {
                        lossy.push(format!("{at}: {why}"));
                    }
                }
            }
            println!("{name}: blocks {ob}/{db}/model {mb}, lossy {}", lossy.len());
            for line in lossy.iter().take(6) {
                println!("    {line}");
            }
            if ob == db && std::env::var("FLOW_DETAIL").is_ok() {
                for (b, a) in o.scan.blocks.iter().zip(&d.scan.blocks) {
                    let objs = |t: &[Token]| -> Vec<Arc<Obj>> {
                        t.iter().filter_map(|t| match t { Token::Obj(o, _) => Some(o.clone()), _ => None }).collect()
                    };
                    let (bo, ao) = (objs(b), objs(a));
                    for x in &bo {
                        if ao.contains(x) { continue; }
                        if let Some(y) = ao.iter().find(|y| y.name == x.name && !bo.contains(y)) {
                            println!("    obj {}:", x.name);
                            for i in &x.items { if !y.items.contains(i) { println!("      - {i}"); } }
                            for i in &y.items { if !x.items.contains(i) { println!("      + {i}"); } }
                        }
                    }
                }
            }
        }
    }
}
