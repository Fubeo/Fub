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
    parse_within(bytes, part, budget, stream, sink, LIMITS.retained_bytes)
}

/// [`parse`] con il tetto dei byte tenuti in memoria
/// ([`Limits::retained_bytes`]).
fn parse_within(
    bytes: &[u8],
    part: &str,
    budget: &mut Budget,
    stream: Option<(&str, &str)>,
    sink: &mut dyn FnMut(Node) -> Result<(), InventoryError>,
    retained: u64,
) -> Result<Node, InventoryError> {
    // I byte vivi sono quelli aggiunti all'albero (nodi aperti, testi) meno
    // quelli andati al flusso o tolti da `close`.
    let mut added = 0u64;
    let freed = std::cell::Cell::new(0u64);
    let mut counted = |node: Node| {
        freed.set(freed.get().saturating_add(subtree(&node)));
        sink(node)
    };
    let over = |added: u64, freed: u64| added.saturating_sub(freed) > retained;
    let sink: &mut dyn FnMut(Node) -> Result<(), InventoryError> = &mut counted;
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
                    added = added.saturating_add(push_text(open, &text));
                }
                (None, false)
            }
            Event::CData(text) => {
                let text = text.decode().map_err(|error| xml_error(part, error))?;
                if let Some(open) = stack.last_mut() {
                    added = added.saturating_add(push_text(open, &text));
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
                    added = added.saturating_add(push_text(open, &resolved));
                }
                (None, false)
            }
            Event::End(_) => {
                let mut node = stack.pop().ok_or_else(|| xml_error(part, "unbalanced"))?;
                let cleared = close(&mut node);
                freed.set(freed.get().saturating_add(cleared));
                attach(&mut stack, &mut root, node, stream, sink, part)?;
                (None, false)
            }
            Event::Eof => break,
            _ => (None, false),
        };
        if over(added, freed.get()) {
            return Err(InventoryError::Limit("xml nodes in memory"));
        }
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
        // Il primo `push` riserva quattro coppie: un elemento con un solo
        // attributo (il caso comune dei record) ne terrebbe tre vuote.
        attrs.shrink_to_fit();
        let node = Node {
            name,
            attrs,
            kids: Vec::new(),
            text: String::new(),
        };
        added = added.saturating_add(cost(&node));
        if over(added, freed.get()) {
            return Err(InventoryError::Limit("xml nodes in memory"));
        }
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

/// Il posto di un nodo nel vettore dei figli di suo padre, contato due volte:
/// un vettore che cresce raddoppiando può tenere fino a metà posti vuoti.
const SLOT: u64 = 2 * std::mem::size_of::<Node>() as u64;

/// I byte che l'allocatore impegna per un blocco di `capacity` byte, per
/// eccesso: un'intestazione di 8 byte, l'arrotondamento a 16 e un blocco
/// minimo di 32 (malloc di glibc). Un blocco vuoto non è allocato.
fn heap(capacity: usize) -> u64 {
    if capacity == 0 {
        return 0;
    }
    (capacity as u64)
        .saturating_add(8)
        .next_multiple_of(16)
        .max(32)
}

/// I byte stimati, per eccesso, di un nodo senza i suoi figli: il suo posto
/// nel padre, il nome, il vettore degli attributi con le loro stringhe e il
/// testo, ognuno con la capacità che ha davvero. È uguale quando il nodo
/// entra nell'albero (più i testi aggiunti, vedi [`push_text`]) e quando ne
/// esce.
fn cost(node: &Node) -> u64 {
    let pair = std::mem::size_of::<(String, String)>();
    let strings: u64 = node
        .attrs
        .iter()
        .map(|(key, value)| heap(key.capacity()) + heap(value.capacity()))
        .sum();
    SLOT + heap(node.name.capacity())
        + heap(node.attrs.capacity() * pair)
        + strings
        + heap(node.text.capacity())
}

/// Aggiunge `text` al testo di `open`, e torna di quanti byte stimati è
/// cresciuto: la differenza fra il blocco di prima e quello di adesso.
fn push_text(open: &mut Node, text: &str) -> u64 {
    let before = heap(open.text.capacity());
    open.text.push_str(text);
    heap(open.text.capacity()).saturating_sub(before)
}

/// I byte stimati di un sotto albero, lui compreso.
fn subtree(node: &Node) -> u64 {
    let mut bytes = 0u64;
    let mut todo = vec![node];
    while let Some(next) = todo.pop() {
        bytes = bytes.saturating_add(cost(next));
        todo.extend(next.kids.iter());
    }
    bytes
}

/// Il testo fra gli elementi di un elemento che ha figli è soltanto spazio:
/// si toglie, col suo blocco, e torna quanti byte stimati ha liberato.
fn close(node: &mut Node) -> u64 {
    if !node.kids.is_empty() && node.text.trim().is_empty() {
        let cleared = heap(node.text.capacity());
        node.text = String::new();
        return cleared;
    }
    0
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

#[cfg(test)]
mod tests {
    use super::*;

    fn budget() -> Budget {
        Budget {
            elements: 0,
            visits: 0,
        }
    }

    /// Un nodo `<a/>` senza attributi né testo, per la stima: il suo posto e
    /// il blocco minimo del nome.
    const BARE: u64 = SLOT + 32;

    /// I nodi che restano nell'albero hanno un tetto; quelli che vanno al
    /// flusso non contano, perché se ne vanno appena chiusi.
    #[test]
    fn i_nodi_tenuti_in_memoria_hanno_un_tetto() {
        let flat = format!("<r>{}</r>", "<a/>".repeat(10));
        let kept = parse_within(
            flat.as_bytes(),
            "p",
            &mut budget(),
            None,
            &mut |_| Ok(()),
            8 * BARE,
        );
        assert_eq!(
            kept.unwrap_err(),
            InventoryError::Limit("xml nodes in memory")
        );
        let mut rows = 0;
        let streamed = parse_within(
            flat.as_bytes(),
            "p",
            &mut budget(),
            Some(("r", "a")),
            &mut |_| {
                rows += 1;
                Ok(())
            },
            8 * BARE,
        );
        assert!(streamed.is_ok());
        assert_eq!(rows, 10);
        let nested = format!("<r>{}</r>", "<a><b/><c/></a>".repeat(10));
        let streamed = parse_within(
            nested.as_bytes(),
            "p",
            &mut budget(),
            Some(("r", "a")),
            &mut |_| Ok(()),
            8 * BARE,
        );
        assert!(streamed.is_ok());
        assert!(parse_within(
            flat.as_bytes(),
            "p",
            &mut budget(),
            None,
            &mut |_| Ok(()),
            11 * BARE
        )
        .is_ok());
    }

    /// Una parte onesta e grande che non va al flusso, come i record della
    /// cache di una tabella pivot di un milione di righe: più di quattro
    /// milioni di elementi piccoli si leggono con i limiti veri.
    #[test]
    fn una_parte_grande_e_onesta_si_legge() {
        let rows = 1_050_000;
        let mut xml = String::with_capacity(rows * 40 + 64);
        xml.push_str("<pivotCacheRecords>");
        for _ in 0..rows {
            xml.push_str(r#"<r><n v="1"/><s v="ab"/><x v="3"/></r>"#);
        }
        xml.push_str("</pivotCacheRecords>");
        let root = parse(xml.as_bytes(), "p", &mut budget(), None, &mut |_| Ok(()))
            .expect("una parte onesta si legge");
        assert_eq!(root.kids.len(), rows);
        // La stima che il tetto ha visto: sta sotto il tetto con margine, e
        // sopra la memoria vera misurata per la stessa parte.
        let estimated = subtree(&root);
        assert!(estimated < LIMITS.retained_bytes, "{estimated}");
        assert!(estimated > 1_000 << 20, "{estimated}");
    }

    /// Il tetto conta anche attributi e testi: pochi nodi grossi lo passano
    /// come molti piccoli, e lo spazio tolto da `close` torna libero.
    #[test]
    fn il_tetto_conta_attributi_e_testi() {
        let fat = format!("<r><a v=\"{}\"/></r>", "x".repeat(10_000));
        let kept = parse_within(
            fat.as_bytes(),
            "p",
            &mut budget(),
            None,
            &mut |_| Ok(()),
            5_000,
        );
        assert_eq!(
            kept.unwrap_err(),
            InventoryError::Limit("xml nodes in memory")
        );
        let text = format!("<r><a>{}</a></r>", "x".repeat(10_000));
        let kept = parse_within(
            text.as_bytes(),
            "p",
            &mut budget(),
            None,
            &mut |_| Ok(()),
            5_000,
        );
        assert_eq!(
            kept.unwrap_err(),
            InventoryError::Limit("xml nodes in memory")
        );
        // Lo spazio fra i figli si toglie alla chiusura e non resta in conto.
        let spaced = format!("<r>{}</r>", "<b>\n  <a/>\n</b>".repeat(100));
        let mut streamed = 0;
        assert!(parse_within(
            spaced.as_bytes(),
            "p",
            &mut budget(),
            Some(("r", "b")),
            &mut |_| {
                streamed += 1;
                Ok(())
            },
            4 * BARE + 16,
        )
        .is_ok());
        assert_eq!(streamed, 100);
        // Il limite vero: i cinquanta milioni di elementi di
        // `Limits::elements`, se restano tutti, sono ben oltre il tetto.
        const { assert!(LIMITS.elements * BARE > LIMITS.retained_bytes) };
    }
}
