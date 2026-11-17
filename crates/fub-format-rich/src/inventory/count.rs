//! Il conto di una parte XML: elementi e attributi per nome espanso, testo
//! dei paragrafi, istruzioni e forma delle corse.

use super::*;

pub(super) fn add(into: &mut Counts, from: &Counts) {
    for (key, n) in from {
        *into.entry(key.clone()).or_default() += n;
    }
}

pub(super) struct Parsed {
    pub(super) all: Counts,
    pub(super) body: Vec<Counts>,
    /// I valori degli attributi nello spazio dei nomi delle relazioni.
    pub(super) references: Vec<String>,
    /// Quante volte ogni normalizzazione ha saltato qualcosa.
    pub(super) normalized: BTreeMap<&'static str, u64>,
}

/// Ciò che [`count_xml`] sa della parte che conta.
pub(super) struct Context<'a> {
    pub(super) part: &'a str,
    pub(super) class: &'a str,
    /// Il documento principale: si tiene a parte ogni blocco del corpo.
    pub(super) main: bool,
    /// Le relazioni della parte per id, come la chiave le scrive.
    pub(super) rels: &'a BTreeMap<&'a str, String>,
    pub(super) limits: &'a Limits,
}

fn xml_error(part: &str, error: impl fmt::Display) -> InventoryError {
    InventoryError::Xml {
        part: part.to_string(),
        error: error.to_string(),
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

/// Lo spazio dei nomi di [`namespace`], fra i nomi già visti.
fn namespace_in(names: &mut Names, result: &ResolveResult<'_>) -> Name {
    match result {
        ResolveResult::Bound(ns) => match std::str::from_utf8(ns.as_ref()) {
            Ok(ns) => names.get(ns),
            Err(_) => names.get(&namespace(result)),
        },
        ResolveResult::Unbound => names.get(""),
        ResolveResult::Unknown(_) => names.get(&namespace(result)),
    }
}

/// Il nome locale, fra i nomi già visti.
fn local_in(names: &mut Names, local: &[u8]) -> Name {
    match std::str::from_utf8(local) {
        Ok(local) => names.get(local),
        Err(_) => names.get(&String::from_utf8_lossy(local)),
    }
}

/// Dove [`count_xml`] mette i conteggi di un elemento.
#[derive(Clone, Copy)]
enum Target {
    /// Il resto del documento, fuori dai blocchi.
    Outside,
    /// L'ultimo blocco del corpo.
    Block,
    /// Ciò che va con il blocco che segue: l'involucro di un content control,
    /// un segnalibro fra due blocchi.
    Pending,
}

/// Gli elementi il cui testo è il testo del paragrafo che li contiene.
const PARAGRAPH_TEXT: &[(&str, &str)] = &[(NS_W, "t"), (NS_W, "delText"), (NS_M, "t")];
/// Le istruzioni dei campi: il codec può spezzarle o unirle in un altro modo,
/// e contano a meno degli spazi.
const INSTRUCTIONS: &[(&str, &str)] = &[(NS_W, "instrText"), (NS_W, "delInstrText")];
/// I contenitori di blocchi trasparenti: i loro figli sono blocchi del
/// modello, e le loro proprietà vanno con il primo.
pub(crate) const WRAPPERS: &[&str] = &["customXml", "smartTag", "ins", "moveTo"];
/// I segni fra due blocchi, che il modello mette nel paragrafo che segue.
pub(crate) const MARKERS: &[&str] = &[
    "bookmarkStart",
    "bookmarkEnd",
    "commentRangeStart",
    "commentRangeEnd",
    "permStart",
    "permEnd",
    "moveFromRangeStart",
    "moveFromRangeEnd",
    "moveToRangeStart",
    "moveToRangeEnd",
];

/// Un elemento aperto.
struct Open {
    ns: Name,
    name: Name,
    /// Il suo testo diretto.
    text: String,
    /// Una normalizzazione lo salta: il suo testo non conta.
    skipped: bool,
    /// Un contenitore di proprietà ancora senza figli: la sua chiave conta
    /// soltanto al primo figlio.
    deferred: Option<Key>,
}

/// Gli elementi della forma dei run. Il codec unisce i run uguali e le loro
/// istruzioni: dentro un paragrafo questi elementi, le proprietà dei run e i
/// loro attributi contano una volta sola, e il testo conta con l'impronta del
/// paragrafo.
const RUN_SHAPE: &[&str] = &["r", "t", "delText", "instrText", "delInstrText"];

/// Un paragrafo aperto: la profondità del suo `w:p`, il testo, le istruzioni
/// e le chiavi della forma dei suoi run.
struct Paragraph {
    level: usize,
    text: String,
    instructions: String,
    runs: BTreeSet<Key>,
}

fn put(parsed: &mut Parsed, pending: &mut Counts, target: Target, key: Key) {
    match target {
        Target::Block => {
            if let Some(region) = parsed.body.last_mut() {
                *region.entry(key.clone()).or_default() += 1;
            }
        }
        Target::Pending => *pending.entry(key.clone()).or_default() += 1,
        Target::Outside => {}
    }
    *parsed.all.entry(key).or_default() += 1;
}

/// Conta elementi, attributi e testi di una parte XML riscritta dal codec.
/// Con `main`, tiene a parte ogni blocco del corpo: i figli di `w:body` e,
/// dentro un content control di blocco o un contenitore trasparente, i suoi
/// blocchi.
pub(super) fn count_xml(
    bytes: &[u8],
    context: &Context<'_>,
    elements: &mut u64,
) -> Result<Parsed, InventoryError> {
    let (part, limits) = (context.part, context.limits);
    let mut names = Names::default();
    let class = names.get(context.class);
    let mut reader = NsReader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut parsed = Parsed {
        all: Counts::new(),
        body: Vec::new(),
        references: Vec::new(),
        normalized: BTreeMap::new(),
    };
    // Gli elementi aperti.
    let mut stack: Vec<Open> = Vec::new();
    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut buf = Vec::new();
    let mut root = false;
    // Dove vanno i conteggi dell'elemento corrente e dei suoi discendenti.
    let mut target = Target::Outside;
    // Le profondità i cui figli sono blocchi, dentro `w:sdtContent` di un
    // content control di blocco o dentro un contenitore trasparente; e le
    // profondità dei content control e dei contenitori aperti.
    let mut block_levels: Vec<usize> = Vec::new();
    let mut sdt_levels: Vec<usize> = Vec::new();
    let mut wrapper_levels: Vec<usize> = Vec::new();
    // L'involucro di un content control prima del suo primo blocco.
    let mut pending = Counts::new();
    // La profondità delle proprietà del run aperto, `w:r/w:rPr`.
    let mut run_props: Option<usize> = None;
    // L'ultimo blocco del corpo è una tabella.
    let mut table = false;
    // Quanti elementi aperti hanno la chiave rinviata (`Open::deferred`).
    let mut deferred = 0usize;
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| xml_error(part, error))?;
        let (start, empty) = match &event {
            Event::Start(start) => (Some(start), false),
            Event::Empty(start) => (Some(start), true),
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
                let Some(mut open) = stack.pop() else {
                    return Err(xml_error(part, "unbalanced end"));
                };
                if let Some(key) = open.deferred.take() {
                    deferred -= 1;
                    if open.text.trim().is_empty() {
                        if let Some(what) = empty_properties(&open.ns, &open.name) {
                            *parsed.normalized.entry(what).or_default() += 1;
                        }
                    } else {
                        // Un testo lo riempie: conta, con il testo.
                        put(&mut parsed, &mut pending, target, key);
                    }
                }
                let pair = (&*open.ns, &*open.name);
                if context.main
                    && pair == (NS_W, "body")
                    && stack.len() == 1
                    && table
                    && pending.is_empty()
                {
                    // Il paragrafo vuoto che il modello mette dopo una tabella
                    // finale: un blocco, come nella prova a vuoto.
                    *parsed.normalized.entry(TRAILING_PARAGRAPH).or_default() += 1;
                    parsed.body.push(Counts::new());
                    for key in [
                        Key::Element {
                            class: Arc::clone(&class),
                            ns: names.get(NS_W),
                            name: names.get("p"),
                        },
                        Key::Text {
                            class: Arc::clone(&class),
                            element: names.expanded(NS_W, "p"),
                            sha256: sha256("\u{0}".as_bytes()).into(),
                        },
                    ] {
                        put(&mut parsed, &mut pending, Target::Block, key);
                    }
                }
                let inside = paragraphs.last_mut().filter(|p| p.level < stack.len());
                if PARAGRAPH_TEXT.contains(&pair) && inside.is_some() {
                    if let Some(paragraph) = inside {
                        paragraph.text.push_str(&open.text);
                    }
                } else if INSTRUCTIONS.contains(&pair) && inside.is_some() {
                    if let Some(paragraph) = inside {
                        paragraph.instructions.push_str(&open.text);
                        paragraph.instructions.push(' ');
                    }
                } else if pair == (NS_W, "p")
                    && paragraphs.last().is_some_and(|p| p.level == stack.len())
                {
                    let paragraph = paragraphs.pop().unwrap_or_else(|| unreachable!());
                    for key in paragraph.runs {
                        put(&mut parsed, &mut pending, target, key);
                    }
                    let instructions: Vec<&str> =
                        paragraph.instructions.split_whitespace().collect();
                    let content = format!("{}\u{0}{}", paragraph.text, instructions.join(" "));
                    let key = Key::Text {
                        class: Arc::clone(&class),
                        element: names.expanded(&open.ns, &open.name),
                        sha256: sha256(content.as_bytes()).into(),
                    };
                    put(&mut parsed, &mut pending, target, key);
                } else if !open.skipped && !open.text.trim().is_empty() {
                    let value = crate::canonical::value(&open.ns, &open.text);
                    let key = Key::Text {
                        class: Arc::clone(&class),
                        element: names.expanded(&open.ns, &open.name),
                        sha256: sha256(value.as_bytes()).into(),
                    };
                    put(&mut parsed, &mut pending, target, key);
                }
                if run_props == Some(stack.len()) {
                    run_props = None;
                }
                while block_levels
                    .last()
                    .is_some_and(|level| *level > stack.len())
                {
                    block_levels.pop();
                }
                while sdt_levels.last().is_some_and(|level| *level >= stack.len()) {
                    sdt_levels.pop();
                    // Un involucro senza blocchi resta con il resto del documento.
                    pending.clear();
                }
                while wrapper_levels
                    .last()
                    .is_some_and(|level| *level >= stack.len())
                {
                    wrapper_levels.pop();
                    pending.clear();
                }
                (None, false)
            }
            Event::Eof => break,
            _ => (None, false),
        };
        if let Some(start) = start {
            *elements += 1;
            if *elements > limits.elements {
                return Err(InventoryError::Limit("xml elements"));
            }
            if stack.len() >= limits.depth {
                return Err(InventoryError::Limit("xml depth"));
            }
            if stack.is_empty() {
                if root {
                    return Err(xml_error(part, "two root elements"));
                }
                root = true;
            }
            let (ns, local) = reader.resolver().resolve_element(start.name());
            let ns = namespace_in(&mut names, &ns);
            let mut name = local_in(&mut names, local.as_ref());
            let w = &*ns == NS_W;
            if let Some((what, left)) = stack
                .last()
                .filter(|parent| w && &*parent.ns == NS_W)
                .and_then(|parent| side_element(&parent.name, &name))
            {
                *parsed.normalized.entry(what).or_default() += 1;
                name = names.get(left);
            }
            let mut attributes = Vec::new();
            for attr in start.attributes() {
                let attr = attr.map_err(|error| xml_error(part, error))?;
                let qname = attr.key;
                if qname.as_namespace_binding().is_some() {
                    continue;
                }
                let (attr_ns, attr_local) = reader.resolver().resolve_attribute(qname);
                let (attr_ns, attr_name) = (
                    namespace_in(&mut names, &attr_ns),
                    local_in(&mut names, attr_local.as_ref()),
                );
                let value = attr
                    .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                    .map_err(|error| xml_error(part, error))?
                    .into_owned();
                if &*attr_ns == NS_MC && matches!(&*attr_name, "Ignorable" | "MustUnderstand") {
                    // Un elenco di prefissi: conta lo spazio dei nomi di
                    // ognuno, perché il prefisso può cambiare e l'elenco può
                    // crescere senza perdita.
                    for prefix in value.split_whitespace() {
                        let probe = format!("{prefix}:x");
                        let (ns, _) = reader
                            .resolver()
                            .resolve_element(quick_xml::name::QName(probe.as_bytes()));
                        attributes.push((attr_ns.clone(), attr_name.clone(), namespace(&ns)));
                    }
                    continue;
                }
                if let Some((what, equivalent)) =
                    equivalent_attribute(w, &name, &attr_ns, &attr_name, &value)
                {
                    *parsed.normalized.entry(what).or_default() += 1;
                    if let Some((attr_name, value)) = equivalent {
                        attributes.push((attr_ns, names.get(&attr_name), value));
                    }
                    continue;
                }
                attributes.push((attr_ns, attr_name, value));
            }
            let level = stack.len();
            if !empty {
                stack.push(Open {
                    ns: ns.clone(),
                    name: name.clone(),
                    text: String::new(),
                    skipped: false,
                    deferred: None,
                });
            }
            if let (Some(what), Some(paragraph)) = (simple_field(&ns, &name), paragraphs.last_mut())
            {
                *parsed.normalized.entry(what).or_default() += 1;
                for (attr_ns, attr_name, value) in attributes {
                    if let Some(what) = skipped_attribute(&attr_ns, &attr_name) {
                        *parsed.normalized.entry(what).or_default() += 1;
                    } else if &*attr_ns == NS_W && &*attr_name == "instr" {
                        paragraph.instructions.push_str(&value);
                        paragraph.instructions.push(' ');
                    } else {
                        let value = crate::canonical::value(&attr_ns, &value);
                        let key = Key::Attribute {
                            class: Arc::clone(&class),
                            element: names.expanded(NS_W, "fldChar"),
                            ns: names.get(&attr_ns),
                            name: names.get(&attr_name),
                            value: names.get(&value),
                        };
                        put(&mut parsed, &mut pending, target, key);
                    }
                }
                if let (false, Some(open)) = (empty, stack.last_mut()) {
                    open.skipped = true;
                }
                buf.clear();
                continue;
            }
            if let Some(what) = skipped_element(&ns, &name) {
                *parsed.normalized.entry(what).or_default() += 1;
                if let (false, Some(open)) = (empty, stack.last_mut()) {
                    open.skipped = true;
                }
                buf.clear();
                continue;
            }
            if w && &*name == "p" && !empty {
                paragraphs.push(Paragraph {
                    level,
                    text: String::new(),
                    instructions: String::new(),
                    runs: BTreeSet::new(),
                });
            }
            // Un figlio di `w:body`: document (0) → body (1) → blocco (2).
            // L'ultima `w:sectPr`, la sezione che nessun paragrafo chiude, non
            // è un blocco: resta con il resto del documento.
            let top = context.main
                && level == 2
                && &*stack[1].ns == NS_W
                && &*stack[1].name == "body"
                && &*stack[0].name == "document";
            if top || block_levels.last() == Some(&level) {
                if w && &*name == "sdt" {
                    // Un content control di blocco (un sommario, un campo di
                    // un modulo) raggruppa più blocchi del modello: i blocchi
                    // sono i figli del suo `w:sdtContent`, e l'involucro va
                    // con il primo.
                    target = Target::Pending;
                    if !empty {
                        sdt_levels.push(level);
                    }
                } else if w && WRAPPERS.contains(&&*name) {
                    // Lo stesso per un contenitore trasparente: i suoi figli
                    // sono blocchi.
                    target = Target::Pending;
                    if !empty {
                        wrapper_levels.push(level);
                        block_levels.push(level + 1);
                    }
                } else if w
                    && (MARKERS.contains(&&*name)
                        || (!top && matches!(&*name, "customXmlPr" | "smartTagPr")))
                {
                    target = Target::Pending;
                } else if top && w && &*name == "sectPr" {
                    target = Target::Outside;
                } else {
                    parsed.body.push(std::mem::take(&mut pending));
                    target = Target::Block;
                }
                if top && !(w && (MARKERS.contains(&&*name) || &*name == "sectPr")) {
                    table = w && &*name == "tbl";
                }
            } else if level > 0 && sdt_levels.last() == Some(&(level - 1)) {
                if w && &*name == "sdtContent" {
                    target = Target::Pending;
                    if !empty {
                        block_levels.push(level + 1);
                    }
                } else if w && &*name == "sdtEndPr" && !parsed.body.is_empty() {
                    target = Target::Block;
                } else {
                    target = Target::Pending;
                }
            }
            let element = names.expanded(&ns, &name);
            if w && &*name == "rPr" && !empty && level > 0 {
                let parent = &stack[level - 1];
                if &*parent.ns == NS_W && &*parent.name == "r" {
                    run_props = Some(level);
                }
            }
            let run_shape = paragraphs.last().is_some()
                && ((w && RUN_SHAPE.contains(&&*name)) || run_props.is_some());
            let mut emit = |parsed: &mut Parsed, pending: &mut Counts, key: Key| match paragraphs
                .last_mut()
                .filter(|_| run_shape)
            {
                Some(paragraph) => {
                    paragraph.runs.insert(key);
                }
                None => put(parsed, pending, target, key),
            };
            // Un contenitore di proprietà vuoto non conta: la sua chiave
            // aspetta il primo figlio, e con lei quelle dei contenitori vuoti
            // che lo contengono.
            let bare = empty_properties(&ns, &name).filter(|_| {
                attributes
                    .iter()
                    .all(|(attr_ns, attr_name, _)| skipped_attribute(attr_ns, attr_name).is_some())
            });
            let key = Key::Element {
                class: Arc::clone(&class),
                ns: names.get(&ns),
                name: names.get(&name),
            };
            match bare {
                None => {
                    if deferred > 0 {
                        for open in &mut stack[..level] {
                            if let Some(key) = open.deferred.take() {
                                emit(&mut parsed, &mut pending, key);
                                deferred -= 1;
                            }
                        }
                    }
                    emit(&mut parsed, &mut pending, key);
                }
                Some(what) if empty => *parsed.normalized.entry(what).or_default() += 1,
                Some(_) => {
                    if let Some(open) = stack.last_mut() {
                        open.deferred = Some(key);
                        deferred += 1;
                    }
                }
            }
            for (attr_ns, attr_name, value) in attributes {
                if let Some(what) = skipped_attribute(&attr_ns, &attr_name) {
                    *parsed.normalized.entry(what).or_default() += 1;
                    continue;
                }
                let value = if let Some((what, kept)) =
                    renumbered(&element, &attr_ns, &attr_name, &value)
                {
                    *parsed.normalized.entry(what).or_default() += 1;
                    kept
                } else if &*attr_ns == NS_RELATIONSHIPS {
                    let described = context
                        .rels
                        .get(value.as_str())
                        .cloned()
                        .unwrap_or_else(|| "dangling".into());
                    parsed.references.push(value);
                    described
                } else {
                    crate::canonical::value(&attr_ns, &value)
                };
                let key = Key::Attribute {
                    class: Arc::clone(&class),
                    element: Arc::clone(&element),
                    ns: names.get(&attr_ns),
                    name: names.get(&attr_name),
                    value: names.get(&value),
                };
                emit(&mut parsed, &mut pending, key);
            }
        }
        buf.clear();
    }
    if !root {
        return Err(xml_error(part, "no root element"));
    }
    if !stack.is_empty() {
        return Err(xml_error(part, "unclosed element"));
    }
    Ok(parsed)
}

/// Visita gli elementi di una parte di servizio (tipi di contenuto, relazioni)
/// con i loro attributi per nome locale.
pub(super) fn each_element(
    bytes: &[u8],
    part: &str,
    limits: &Limits,
    mut f: impl FnMut(usize, &str, &BTreeMap<String, String>),
) -> Result<(), InventoryError> {
    let mut reader = NsReader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut buf = Vec::new();
    let mut depth = 0usize;
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| xml_error(part, error))?;
        match &event {
            Event::Start(start) | Event::Empty(start) => {
                if depth >= limits.depth {
                    return Err(InventoryError::Limit("xml depth"));
                }
                let attrs = local_attrs(start, part)?;
                let local = String::from_utf8_lossy(start.local_name().as_ref()).into_owned();
                f(depth, &local, &attrs);
                if matches!(event, Event::Start(_)) {
                    depth += 1;
                }
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(())
}

fn local_attrs(
    start: &BytesStart<'_>,
    part: &str,
) -> Result<BTreeMap<String, String>, InventoryError> {
    let mut out = BTreeMap::new();
    for attr in start.attributes() {
        let attr = attr.map_err(|error| xml_error(part, error))?;
        let value = attr
            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
            .map_err(|error| xml_error(part, error))?
            .into_owned();
        out.insert(
            String::from_utf8_lossy(attr.key.local_name().as_ref()).into_owned(),
            value,
        );
    }
    Ok(out)
}
