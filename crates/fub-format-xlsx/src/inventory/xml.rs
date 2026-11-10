//! L'albero XML dell'inventario: nomi brevi dei namespace, `Node` e la
//! lettura con il suo budget.

use super::*;

// --- XML -----------------------------------------------------------------------

const NS_MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_MAIN_STRICT: &str = "http://purl.oclc.org/ooxml/spreadsheetml/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_R_STRICT: &str = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_X14AC: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac";

/// Il prefisso con cui la forma canonica scrive uno spazio dei nomi: lo stesso
/// per le due forme (transitoria e stretta) dello stesso vocabolario.
fn short(ns: &str) -> String {
    match ns {
        "" | NS_MAIN | NS_MAIN_STRICT => String::new(),
        NS_R | NS_R_STRICT => "r:".into(),
        NS_MC => "mc:".into(),
        NS_X14AC => "x14ac:".into(),
        "http://schemas.openxmlformats.org/drawingml/2006/main"
        | "http://purl.oclc.org/ooxml/drawingml/main" => "a:".into(),
        "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
        | "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing" => "xdr:".into(),
        "http://schemas.openxmlformats.org/drawingml/2006/chart"
        | "http://purl.oclc.org/ooxml/drawingml/chart" => "c:".into(),
        "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" => "x14:".into(),
        "http://schemas.microsoft.com/office/excel/2006/main" => "xm:".into(),
        "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" => "cp:".into(),
        "http://purl.org/dc/elements/1.1/" => "dc:".into(),
        "http://purl.org/dc/terms/" => "dcterms:".into(),
        "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" => "ep:".into(),
        other => format!("{{{other}}}"),
    }
}

/// Un elemento letto.
#[derive(Clone, Debug, Default)]
pub(crate) struct Node {
    /// Il prefisso canonico più il nome locale (`a:blip`, `row`).
    pub name: String,
    /// Gli attributi: nome canonico e valore, nell'ordine del file.
    pub attrs: Vec<(String, String)>,
    pub kids: Vec<Node>,
    /// Il testo, soltanto per un elemento senza figli.
    pub text: String,
}

impl Node {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub fn child(&self, name: &str) -> Option<&Node> {
        self.kids.iter().find(|kid| kid.name == name)
    }

    pub fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.kids.iter().filter(move |kid| kid.name == name)
    }
}

fn namespace(result: &ResolveResult<'_>) -> String {
    match result {
        ResolveResult::Bound(ns) => String::from_utf8_lossy(ns.as_ref()).into_owned(),
        ResolveResult::Unbound => String::new(),
        // Un prefisso non dichiarato resta com'è scritto: il confronto lo vede
        // sia prima sia dopo.
        ResolveResult::Unknown(prefix) => format!("?{}", String::from_utf8_lossy(prefix)),
    }
}

/// Il contatore degli elementi letti, per [`Limits::elements`].
pub(super) struct Budget {
    pub(super) elements: u64,
    pub(super) visits: usize,
}

/// Legge una parte XML. I figli della radice di nome `stream` (le righe di
/// `sheetData`, le stringhe di `sst`) non restano nell'albero: appena chiusi
/// vanno a `sink`, perché un foglio grande non stia tutto in memoria.
pub(super) fn parse(
    bytes: &[u8],
    part: &str,
    budget: &mut Budget,
    stream: Option<(&str, &str)>,
    sink: &mut dyn FnMut(Node) -> Result<(), InventoryError>,
) -> Result<Node, InventoryError> {
    let mut reader = NsReader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut stack: Vec<Node> = Vec::new();
    let mut root: Option<Node> = None;
    let mut buf = Vec::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| xml_error(part, error))?;
        let (start, empty) = match &event {
            Event::Start(start) => (Some(start.clone().into_owned()), false),
            Event::Empty(start) => (Some(start.clone().into_owned()), true),
            Event::Text(text) => {
                let text = text
                    .xml_content(quick_xml::XmlVersion::Implicit1_0)
                    .map_err(|error| xml_error(part, error))?;
                if let Some(open) = stack.last_mut() {
                    open.text.push_str(&text);
                }
                (None, false)
            }
            Event::CData(text) => {
                let text = text.decode().map_err(|error| xml_error(part, error))?;
                if let Some(open) = stack.last_mut() {
                    open.text.push_str(&text);
                }
                (None, false)
            }
            Event::GeneralRef(reference) => {
                let resolved = match reference
                    .resolve_char_ref()
                    .map_err(|error| xml_error(part, error))?
                {
                    Some(ch) => ch.to_string(),
                    None => {
                        let name = reference.decode().map_err(|error| xml_error(part, error))?;
                        quick_xml::escape::resolve_xml_entity(&name)
                            .ok_or_else(|| xml_error(part, format!("unknown entity &{name};")))?
                            .to_string()
                    }
                };
                if let Some(open) = stack.last_mut() {
                    open.text.push_str(&resolved);
                }
                (None, false)
            }
            Event::End(_) => {
                let mut node = stack.pop().ok_or_else(|| xml_error(part, "unbalanced"))?;
                close(&mut node);
                attach(&mut stack, &mut root, node, stream, sink, part)?;
                (None, false)
            }
            Event::Eof => break,
            _ => (None, false),
        };
        let Some(start) = start else {
            buf.clear();
            continue;
        };
        budget.elements += 1;
        if budget.elements > LIMITS.elements {
            return Err(InventoryError::Limit("xml elements"));
        }
        if stack.len() >= LIMITS.depth {
            return Err(InventoryError::Limit("xml depth"));
        }
        let (ns, local) = reader.resolver().resolve_element(start.name());
        let name = format!(
            "{}{}",
            short(&namespace(&ns)),
            String::from_utf8_lossy(local.as_ref())
        );
        let mut attrs = Vec::new();
        for attr in start.attributes() {
            let attr = attr.map_err(|error| xml_error(part, error))?;
            let qname = attr.key;
            if qname.as_namespace_binding().is_some() {
                continue;
            }
            let (attr_ns, attr_local) = reader.resolver().resolve_attribute(qname);
            let attr_ns = namespace(&attr_ns);
            let attr_name = String::from_utf8_lossy(attr_local.as_ref()).into_owned();
            if attr_ns == NS_MC && matches!(attr_name.as_str(), "Ignorable" | "MustUnderstand") {
                continue;
            }
            let value = attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(|error| xml_error(part, error))?
                .into_owned();
            attrs.push((format!("{}{attr_name}", short(&attr_ns)), value));
        }
        let node = Node {
            name,
            attrs,
            kids: Vec::new(),
            text: String::new(),
        };
        if empty {
            attach(&mut stack, &mut root, node, stream, sink, part)?;
        } else {
            stack.push(node);
        }
        buf.clear();
    }
    if !stack.is_empty() {
        return Err(xml_error(part, "unclosed elements"));
    }
    root.ok_or_else(|| xml_error(part, "no root element"))
}

/// Il testo fra gli elementi di un elemento che ha figli è soltanto spazio.
fn close(node: &mut Node) {
    if !node.kids.is_empty() && node.text.trim().is_empty() {
        node.text.clear();
    }
}

fn attach(
    stack: &mut [Node],
    root: &mut Option<Node>,
    node: Node,
    stream: Option<(&str, &str)>,
    sink: &mut dyn FnMut(Node) -> Result<(), InventoryError>,
    part: &str,
) -> Result<(), InventoryError> {
    match stack.len() {
        0 => {
            if root.is_some() {
                return Err(xml_error(part, "two root elements"));
            }
            *root = Some(node);
        }
        len => {
            let streamed = stream.is_some_and(|(parent, child)| {
                node.name == child && len >= 1 && stack[len - 1].name == parent && len <= 2
            });
            if streamed {
                sink(node)?;
            } else {
                stack[len - 1].kids.push(node);
            }
        }
    }
    Ok(())
}
