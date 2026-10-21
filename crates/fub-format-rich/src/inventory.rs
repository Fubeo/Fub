//! L'inventario di un pacchetto Word, calcolato da Fub senza il modello di
//! WordCraft.
//!
//! I controlli di [`crate::fidelity`] confrontano un modello di WordCraft con un
//! altro: dimostrano che il modello è stabile, non che descrive il file. Il
//! lettore del codec salta il markup che non conosce, quindi un oracolo che
//! rilegge con lo stesso lettore non vede ciò che quel lettore salta. Questo
//! modulo legge lo zip e l'XML per conto suo e conta ciò che il pacchetto
//! contiene:
//!
//! - ogni elemento e ogni attributo, per nome espanso (lo spazio dei nomi più il
//!   nome locale: il prefisso può cambiare senza perdita) e per **classe** della
//!   parte;
//! - ogni relazione, con il suo tipo e la sua destinazione: l'URL se è esterna,
//!   l'impronta del contenuto se la parte puntata si copia così com'è, la
//!   classe se è una parte che il codec riscrive;
//! - ogni parte da copiare, per tipo di contenuto e impronta `sha256`.
//!
//! La **classe** di una parte viene dal suo tipo di contenuto. Le parti di
//! WordprocessingML (le storie, gli stili, la numerazione, le impostazioni), il
//! tema e le proprietà del documento il codec le **riscrive** dal modello;
//! tutte le altre (immagini, custom XML, oggetti incorporati, grafici, macro)
//! le **copia**, e lì contano i byte. Raggruppare per classe, e non per nome,
//! tiene fuori le parti che il codec rinumera (`header1.xml` che diventa
//! `header3.xml`).
//!
//! Le parti contano soltanto se una relazione le raggiunge dalla radice del
//! pacchetto: una voce dello zip che nessuno nomina non fa parte del
//! documento (OPC, ECMA-376 parte 2).
//!
//! Il corpo del documento principale ha in più un inventario per ogni figlio di
//! `w:body`: il salvataggio pretende che i blocchi che l'utente non ha toccato
//! restino identici (vedi [`crate::preservation`]).
//!
//! Lo zip e l'XML hanno limiti propri, dello stesso ordine di quelli del codec:
//! un limite superato, uno zip illeggibile o un XML malformato sono un
//! [`InventoryError`], e chi chiama fallisce chiuso.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;
use sha2::{Digest, Sha256};

/// I limiti della lettura, indipendenti da quelli del codec.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    /// Voci dello zip.
    pub entries: usize,
    /// Byte decompressi di una parte.
    pub part_bytes: u64,
    /// Byte decompressi di tutte le parti lette.
    pub total_bytes: u64,
    /// Profondità di un albero XML.
    pub depth: usize,
    /// Elementi di tutte le parti XML.
    pub elements: u64,
}

/// Gli stessi ordini di grandezza del codec (`MAX_PART`, `MAX_TOTAL`,
/// `MAX_ENTRIES` del pacchetto di WordCraft).
pub(crate) const LIMITS: Limits = Limits {
    entries: 20_000,
    part_bytes: 256 * 1024 * 1024,
    total_bytes: 512 * 1024 * 1024,
    depth: 512,
    elements: 20_000_000,
};

/// Perché un pacchetto non si inventaria.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InventoryError {
    /// Lo zip non si legge, o ha due voci con lo stesso nome.
    Zip(String),
    /// Un XML non è ben formato.
    Xml { part: String, error: String },
    /// Un limite di [`Limits`] è superato.
    Limit(&'static str),
    /// Manca una parte che il pacchetto deve avere.
    Missing(&'static str),
}

impl fmt::Display for InventoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InventoryError::Zip(error) => write!(f, "zip: {error}"),
            InventoryError::Xml { part, error } => write!(f, "xml of {part}: {error}"),
            InventoryError::Limit(what) => write!(f, "limit exceeded: {what}"),
            InventoryError::Missing(what) => write!(f, "missing {what}"),
        }
    }
}

/// Una cosa che il pacchetto contiene, e che si conta.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Key {
    /// Un elemento, per classe della parte e nome espanso.
    Element {
        class: String,
        ns: String,
        name: String,
    },
    /// Un attributo, per classe, elemento che lo porta e nome espanso.
    Attribute {
        class: String,
        element: String,
        ns: String,
        name: String,
    },
    /// Una relazione, per classe della sorgente, tipo e destinazione.
    Relationship {
        source: String,
        kind: String,
        target: String,
    },
    /// Una parte da copiare così com'è, per tipo di contenuto e impronta.
    Part {
        content_type: String,
        sha256: String,
    },
}

impl Key {
    /// La classe a cui la chiave appartiene: la parte, o la sorgente di una
    /// relazione.
    pub fn class(&self) -> &str {
        match self {
            Key::Element { class, .. } | Key::Attribute { class, .. } => class,
            Key::Relationship { source, .. } => source,
            Key::Part { .. } => COPIED,
        }
    }
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Key::Element { class, ns, name } => write!(f, "{class}: <{{{ns}}}{name}>"),
            Key::Attribute {
                class,
                element,
                ns,
                name,
            } => write!(f, "{class}: {element} @{{{ns}}}{name}"),
            Key::Relationship {
                source,
                kind,
                target,
            } => write!(f, "{source}: relationship {kind} → {target}"),
            Key::Part {
                content_type,
                sha256,
            } => write!(f, "part {content_type} {sha256}"),
        }
    }
}

/// Le chiavi con il numero delle loro occorrenze.
pub(crate) type Counts = BTreeMap<Key, u64>;

/// La classe delle parti che si copiano: la chiave è il loro contenuto, non la
/// loro classe.
pub(crate) const COPIED: &str = "copied";
/// La classe della radice del pacchetto, sorgente delle prime relazioni.
pub(crate) const PACKAGE: &str = "package";
/// La classe del documento principale.
pub(crate) const DOCUMENT: &str = "document";

const NS_RELATIONSHIPS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WML: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.";

/// La classe di una parte dal suo tipo di contenuto: `None` se il codec la
/// copia.
pub(crate) fn class_of(content_type: &str) -> Option<String> {
    let content_type = content_type.trim().to_ascii_lowercase();
    let main = [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
        "application/vnd.ms-word.document.macroenabled.main+xml",
        "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
    ];
    if main.contains(&content_type.as_str()) {
        return Some(DOCUMENT.into());
    }
    if let Some(rest) = content_type.strip_prefix(WML) {
        return Some(rest.trim_end_matches("+xml").to_string());
    }
    let regenerated = [
        (
            "application/vnd.openxmlformats-officedocument.theme+xml",
            "theme",
        ),
        (
            "application/vnd.openxmlformats-package.core-properties+xml",
            "core-properties",
        ),
        (
            "application/vnd.openxmlformats-officedocument.extended-properties+xml",
            "extended-properties",
        ),
        (
            "application/vnd.openxmlformats-officedocument.custom-properties+xml",
            "custom-properties",
        ),
    ];
    regenerated
        .iter()
        .find(|(ct, _)| *ct == content_type)
        .map(|(_, class)| class.to_string())
}

/// L'inventario di un pacchetto.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Inventory {
    /// Tutto il pacchetto, corpo compreso.
    pub all: Counts,
    /// Ogni figlio di `w:body` del documento principale, in ordine.
    pub body: Vec<Counts>,
    /// I riferimenti a una relazione (`r:id`, `r:embed`…) che la propria parte
    /// non ha, per parte e valore.
    pub dangling: BTreeSet<String>,
}

impl Inventory {
    /// Le chiavi del pacchetto fuori dal corpo del documento principale.
    pub fn outside_body(&self) -> Counts {
        let mut out = self.all.clone();
        for block in &self.body {
            for (key, n) in block {
                if let Some(count) = out.get_mut(key) {
                    *count -= n;
                }
            }
        }
        out.retain(|_, n| *n > 0);
        out
    }
}

/// Le parti di uno zip, lette nei limiti.
struct Zip {
    /// Per nome in minuscolo, senza la barra iniziale: in OPC i nomi delle
    /// parti non distinguono maiuscole e minuscole.
    parts: BTreeMap<String, Vec<u8>>,
}

fn zip_error(error: impl fmt::Display) -> InventoryError {
    InventoryError::Zip(error.to_string())
}

impl Zip {
    fn read(bytes: &[u8], limits: &Limits) -> Result<Zip, InventoryError> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(zip_error)?;
        if archive.len() > limits.entries {
            return Err(InventoryError::Limit("zip entries"));
        }
        // `zip` indicizza le voci per nome e di due omonime ne tiene una:
        // quale valga dipenderebbe dal lettore, quindi si contano le voci
        // della directory centrale.
        let listed = central_names(bytes, limits)?;
        let mut seen = BTreeSet::new();
        for name in &listed {
            if !seen.insert(name.trim_start_matches('/').to_ascii_lowercase()) {
                return Err(InventoryError::Zip(format!("duplicate entry {name}")));
            }
        }
        let mut parts = BTreeMap::new();
        let mut total = 0u64;
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(zip_error)?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().map_err(zip_error)?.to_string();
            if file.size() > limits.part_bytes {
                return Err(InventoryError::Limit("part size"));
            }
            let mut out = Vec::new();
            // Il limite vale anche per ciò che l'intestazione non dichiara.
            (&mut file)
                .take(limits.part_bytes + 1)
                .read_to_end(&mut out)
                .map_err(zip_error)?;
            if out.len() as u64 > limits.part_bytes {
                return Err(InventoryError::Limit("part size"));
            }
            total += out.len() as u64;
            if total > limits.total_bytes {
                return Err(InventoryError::Limit("package size"));
            }
            let key = name.trim_start_matches('/').to_ascii_lowercase();
            if parts.insert(key, out).is_some() {
                return Err(InventoryError::Zip(format!("duplicate entry {name}")));
            }
        }
        Ok(Zip { parts })
    }
}

fn le16(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?).into())
}

fn le32(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?).into())
}

fn le64(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
}

/// I nomi della directory centrale, nell'ordine, letti dai byte senza
/// passare dall'indice di `zip` (APPNOTE 4.3.12, 4.3.14–16).
fn central_names(bytes: &[u8], limits: &Limits) -> Result<Vec<String>, InventoryError> {
    let broken = |what: &str| InventoryError::Zip(format!("central directory: {what}"));
    // La fine della directory centrale sta negli ultimi 22 + 65 535 byte.
    let floor = bytes.len().saturating_sub(22 + 0xffff);
    let eocd = (floor..=bytes.len().saturating_sub(22))
        .rev()
        .find(|at| bytes[*at..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or_else(|| broken("no end record"))?;
    let mut count = le16(bytes, eocd + 10).ok_or_else(|| broken("short end record"))?;
    let mut offset = le32(bytes, eocd + 16).ok_or_else(|| broken("short end record"))?;
    if count == 0xffff || offset == 0xffff_ffff {
        // ZIP64: il localizzatore precede la fine classica.
        let locator = eocd
            .checked_sub(20)
            .filter(|at| bytes[*at..].starts_with(&[0x50, 0x4b, 0x06, 0x07]))
            .ok_or_else(|| broken("no zip64 locator"))?;
        let record =
            le64(bytes, locator + 8).ok_or_else(|| broken("short zip64 locator"))? as usize;
        if !bytes
            .get(record..)
            .is_some_and(|b| b.starts_with(&[0x50, 0x4b, 0x06, 0x06]))
        {
            return Err(broken("no zip64 end record"));
        }
        count = le64(bytes, record + 32).ok_or_else(|| broken("short zip64 end record"))?;
        offset = le64(bytes, record + 48).ok_or_else(|| broken("short zip64 end record"))?;
    }
    if count > limits.entries as u64 {
        return Err(InventoryError::Limit("zip entries"));
    }
    let mut at = usize::try_from(offset).map_err(|_| broken("offset"))?;
    let mut names = Vec::new();
    for _ in 0..count {
        if !bytes
            .get(at..)
            .is_some_and(|b| b.starts_with(&[0x50, 0x4b, 0x01, 0x02]))
        {
            return Err(broken("entry signature"));
        }
        let lengths = (
            le16(bytes, at + 28),
            le16(bytes, at + 30),
            le16(bytes, at + 32),
        );
        let (Some(name), Some(extra), Some(comment)) = lengths else {
            return Err(broken("short entry"));
        };
        let (name, extra, comment) = (name as usize, extra as usize, comment as usize);
        let raw = bytes
            .get(at + 46..at + 46 + name)
            .ok_or_else(|| broken("short entry"))?;
        names.push(String::from_utf8_lossy(raw).into_owned());
        at += 46 + name + extra + comment;
    }
    Ok(names)
}

/// I tipi di contenuto del pacchetto (`[Content_Types].xml`).
struct ContentTypes {
    defaults: BTreeMap<String, String>,
    overrides: BTreeMap<String, String>,
}

impl ContentTypes {
    fn read(zip: &Zip, limits: &Limits) -> Result<ContentTypes, InventoryError> {
        let bytes = zip
            .parts
            .get("[content_types].xml")
            .ok_or(InventoryError::Missing("[Content_Types].xml"))?;
        let mut types = ContentTypes {
            defaults: BTreeMap::new(),
            overrides: BTreeMap::new(),
        };
        each_element(
            bytes,
            "[Content_Types].xml",
            limits,
            |_, local, attrs| match local {
                "Default" => {
                    if let (Some(ext), Some(ct)) =
                        (attrs.get("Extension"), attrs.get("ContentType"))
                    {
                        types.defaults.insert(ext.to_ascii_lowercase(), ct.clone());
                    }
                }
                "Override" => {
                    if let (Some(part), Some(ct)) =
                        (attrs.get("PartName"), attrs.get("ContentType"))
                    {
                        let part = part.trim_start_matches('/').to_ascii_lowercase();
                        types.overrides.insert(part, ct.clone());
                    }
                }
                _ => {}
            },
        )?;
        Ok(types)
    }

    fn of(&self, part: &str) -> String {
        if let Some(ct) = self.overrides.get(part) {
            return ct.clone();
        }
        let ext = part.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
        self.defaults.get(ext).cloned().unwrap_or_default()
    }
}

/// Una relazione letta da una parte `.rels`.
struct Relationship {
    id: String,
    kind: String,
    target: String,
    external: bool,
}

fn rels_of(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None if part.is_empty() => "_rels/.rels".into(),
        None => format!("_rels/{part}.rels"),
    }
}

/// La parte che una destinazione relativa nomina, dalla cartella della sorgente.
fn resolve(source: &str, target: &str) -> String {
    let target = target.split('#').next().unwrap_or_default();
    let mut path: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        match source.rsplit_once('/') {
            Some((dir, _)) => dir.split('/').collect(),
            None => Vec::new(),
        }
    };
    for piece in target.split('/') {
        match piece {
            "" | "." => {}
            ".." => {
                path.pop();
            }
            piece => path.push(piece),
        }
    }
    path.join("/").to_ascii_lowercase()
}

fn read_rels(zip: &Zip, part: &str, limits: &Limits) -> Result<Vec<Relationship>, InventoryError> {
    let name = rels_of(part);
    let Some(bytes) = zip.parts.get(&name) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    each_element(bytes, &name, limits, |_, local, attrs| {
        if local == "Relationship" {
            out.push(Relationship {
                id: attrs.get("Id").cloned().unwrap_or_default(),
                kind: attrs.get("Type").cloned().unwrap_or_default(),
                target: attrs.get("Target").cloned().unwrap_or_default(),
                external: attrs
                    .get("TargetMode")
                    .is_some_and(|m| m.eq_ignore_ascii_case("External")),
            });
        }
    })?;
    Ok(out)
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// L'inventario di un pacchetto `.docx`.
pub(crate) fn inventory(bytes: &[u8]) -> Result<Inventory, InventoryError> {
    inventory_with(bytes, &LIMITS)
}

pub(crate) fn inventory_with(bytes: &[u8], limits: &Limits) -> Result<Inventory, InventoryError> {
    let zip = Zip::read(bytes, limits)?;
    let types = ContentTypes::read(&zip, limits)?;
    let mut inventory = Inventory::default();
    let mut elements = 0u64;

    // In largo dalla radice: ogni parte una volta, anche se più relazioni la
    // nominano.
    let mut seen = BTreeSet::from([String::new()]);
    let mut todo = vec![String::new()];
    while let Some(part) = todo.pop() {
        let source_class = if part.is_empty() {
            PACKAGE.to_string()
        } else {
            class_of(&types.of(&part)).unwrap_or_else(|| COPIED.into())
        };
        let rels = read_rels(&zip, &part, limits)?;
        let ids: BTreeSet<&str> = rels.iter().map(|r| r.id.as_str()).collect();

        if !part.is_empty() {
            let bytes = zip.parts.get(&part).map(Vec::as_slice).unwrap_or_default();
            match class_of(&types.of(&part)) {
                Some(class) => {
                    let main = class == DOCUMENT && inventory.body.is_empty();
                    let parsed = count_xml(bytes, &part, &class, main, limits, &mut elements)?;
                    add(&mut inventory.all, &parsed.all);
                    if main {
                        inventory.body = parsed.body;
                    }
                    for value in parsed.references {
                        if !ids.contains(value.as_str()) {
                            inventory.dangling.insert(format!("{class}: {value}"));
                        }
                    }
                }
                None => {
                    *inventory
                        .all
                        .entry(Key::Part {
                            content_type: types.of(&part),
                            sha256: sha256(bytes),
                        })
                        .or_default() += 1;
                }
            }
        }

        for rel in rels {
            let target = if rel.external {
                format!("url:{}", rel.target)
            } else {
                let path = resolve(&part, &rel.target);
                match zip.parts.get(&path) {
                    None => format!("missing:{path}"),
                    Some(bytes) => {
                        if seen.insert(path.clone()) {
                            todo.push(path.clone());
                        }
                        match class_of(&types.of(&path)) {
                            Some(class) => format!("class:{class}"),
                            None => format!("sha256:{}", sha256(bytes)),
                        }
                    }
                }
            };
            *inventory
                .all
                .entry(Key::Relationship {
                    source: source_class.clone(),
                    kind: rel.kind,
                    target,
                })
                .or_default() += 1;
        }
    }
    Ok(inventory)
}

fn add(into: &mut Counts, from: &Counts) {
    for (key, n) in from {
        *into.entry(key.clone()).or_default() += n;
    }
}

struct Parsed {
    all: Counts,
    body: Vec<Counts>,
    /// I valori degli attributi nello spazio dei nomi delle relazioni.
    references: Vec<String>,
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

/// Dove [`count_xml`] mette i conteggi di un elemento.
#[derive(Clone, Copy)]
enum Target {
    /// Il resto del documento, fuori dai blocchi.
    Outside,
    /// L'ultimo blocco del corpo.
    Block,
    /// L'involucro di un content control, che va con il blocco che segue.
    Pending,
}

/// Conta elementi e attributi di una parte XML riscritta dal codec. Con `main`,
/// tiene a parte ogni blocco del corpo: i figli di `w:body` e, dentro un
/// content control di blocco, i figli del suo `w:sdtContent`.
fn count_xml(
    bytes: &[u8],
    part: &str,
    class: &str,
    main: bool,
    limits: &Limits,
    elements: &mut u64,
) -> Result<Parsed, InventoryError> {
    let mut reader = NsReader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut parsed = Parsed {
        all: Counts::new(),
        body: Vec::new(),
        references: Vec::new(),
    };
    // La pila dei nomi espansi aperti.
    let mut stack: Vec<(String, String)> = Vec::new();
    let mut buf = Vec::new();
    let mut root = false;
    // Dove vanno i conteggi dell'elemento corrente e dei suoi discendenti.
    let mut target = Target::Outside;
    // Le profondità i cui figli sono blocchi, dentro `w:sdtContent` di un
    // content control di blocco; e le profondità dei content control aperti.
    let mut block_levels: Vec<usize> = Vec::new();
    let mut sdt_levels: Vec<usize> = Vec::new();
    // L'involucro di un content control prima del suo primo blocco.
    let mut pending = Counts::new();
    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|error| xml_error(part, error))?;
        let (start, empty) = match &event {
            Event::Start(start) => (Some(start.clone().into_owned()), false),
            Event::Empty(start) => (Some(start.clone().into_owned()), true),
            Event::End(_) => {
                stack.pop();
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
            let ns = namespace(&ns);
            let name = String::from_utf8_lossy(local.as_ref()).into_owned();
            // Un figlio di `w:body`: document (0) → body (1) → blocco (2).
            // L'ultima `w:sectPr`, la sezione che nessun paragrafo chiude, non
            // è un blocco: resta con il resto del documento.
            let level = stack.len();
            let top = main
                && level == 2
                && stack[1].0 == NS_W
                && stack[1].1 == "body"
                && stack[0].1 == "document";
            let w = ns == NS_W;
            if top || block_levels.last() == Some(&level) {
                if w && name == "sdt" {
                    // Un content control di blocco (un sommario, un campo di
                    // un modulo) raggruppa più blocchi del modello: i blocchi
                    // sono i figli del suo `w:sdtContent`, e l'involucro va
                    // con il primo.
                    target = Target::Pending;
                    if !empty {
                        sdt_levels.push(level);
                    }
                } else if top && w && name == "sectPr" {
                    target = Target::Outside;
                } else {
                    parsed.body.push(std::mem::take(&mut pending));
                    target = Target::Block;
                }
            } else if level > 0 && sdt_levels.last() == Some(&(level - 1)) {
                if w && name == "sdtContent" {
                    target = Target::Pending;
                    if !empty {
                        block_levels.push(level + 1);
                    }
                } else if w && name == "sdtEndPr" && !parsed.body.is_empty() {
                    target = Target::Block;
                } else {
                    target = Target::Pending;
                }
            }
            let mut keys = vec![Key::Element {
                class: class.to_string(),
                ns: ns.clone(),
                name: name.clone(),
            }];
            for attr in start.attributes() {
                let attr = attr.map_err(|error| xml_error(part, error))?;
                let qname = attr.key;
                if qname.as_namespace_binding().is_some() {
                    continue;
                }
                let (attr_ns, attr_local) = reader.resolver().resolve_attribute(qname);
                let attr_ns = namespace(&attr_ns);
                if attr_ns == NS_RELATIONSHIPS {
                    let value = attr
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .map_err(|error| xml_error(part, error))?;
                    parsed.references.push(value.into_owned());
                }
                keys.push(Key::Attribute {
                    class: class.to_string(),
                    element: format!("{{{ns}}}{name}"),
                    ns: attr_ns,
                    name: String::from_utf8_lossy(attr_local.as_ref()).into_owned(),
                });
            }
            for key in keys {
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
            if !empty {
                stack.push((ns, name));
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
fn each_element(
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

/// Una chiave che il confronto trova diversa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Difference {
    pub key: String,
    pub before: u64,
    pub after: u64,
}

impl fmt::Display for Difference {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {} → {}", self.key, self.before, self.after)
    }
}

/// Una differenza che il codec produce senza perdere niente, con la ragione e
/// il test che lo dimostra. Una voce entra soltanto se Word stesso la
/// rigenera, se perderla non cambia contenuto, aspetto o comportamento, e se un
/// test lo prova.
pub(crate) struct Normalization {
    pub what: &'static str,
    pub matches: fn(&Key) -> bool,
}

/// Le normalizzazioni dichiarate. Vuota finché il corpus non ne dimostra una.
pub(crate) const NORMALIZATIONS: &[Normalization] = &[];

fn normalized(key: &Key) -> bool {
    NORMALIZATIONS.iter().any(|n| (n.matches)(key))
}

/// La regola all'apertura: `original` sono i byte del file, `dry` quelli di una
/// prova a vuoto del codec (scrivere il documento letto, senza modificarlo).
///
/// Nessuna chiave può diminuire, salvo le normalizzazioni dichiarate. Nelle
/// classi riscritte un aumento è ammesso (il codec aggiunge valori
/// predefiniti); fra le parti copiate anche un aumento è una differenza.
pub(crate) fn open_differences(original: &Inventory, dry: &Inventory) -> Vec<Difference> {
    let mut out = Vec::new();
    let keys: BTreeSet<&Key> = original.all.keys().chain(dry.all.keys()).collect();
    for key in keys {
        if normalized(key) {
            continue;
        }
        let before = original.all.get(key).copied().unwrap_or(0);
        let after = dry.all.get(key).copied().unwrap_or(0);
        let copied = matches!(key, Key::Part { .. });
        if after < before || (copied && after > before) {
            out.push(Difference {
                key: key.to_string(),
                before,
                after,
            });
        }
    }
    for dangling in dry.dangling.difference(&original.dangling) {
        out.push(Difference {
            key: format!("dangling reference {dangling}"),
            before: 0,
            after: 1,
        });
    }
    out
}

/// Le differenze fra due insiemi di conteggi che devono essere uguali.
pub(crate) fn equal_differences(before: &Counts, after: &Counts, at: &str) -> Vec<Difference> {
    let keys: BTreeSet<&Key> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
        .filter(|key| !normalized(key))
        .filter_map(|key| {
            let b = before.get(key).copied().unwrap_or(0);
            let a = after.get(key).copied().unwrap_or(0);
            (a != b).then(|| Difference {
                key: format!("{at}{key}"),
                before: b,
                after: a,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
    const CT: &str = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    const ROOT: &str = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zw.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zw.write_all(bytes).unwrap();
        }
        zw.finish().unwrap().into_inner()
    }

    fn docx(document: &str, rels: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut entries: Vec<(&str, &[u8])> = vec![
            ("[Content_Types].xml", CT.as_bytes()),
            ("_rels/.rels", ROOT.as_bytes()),
            ("word/document.xml", document.as_bytes()),
            ("word/_rels/document.xml.rels", rels.as_bytes()),
        ];
        entries.extend_from_slice(extra);
        zip(&entries)
    }

    fn rels(inner: &str) -> String {
        format!(
            r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{inner}</Relationships>"#
        )
    }

    fn element(class: &str, name: &str) -> Key {
        Key::Element {
            class: class.into(),
            ns: NS_W.into(),
            name: name.into(),
        }
    }

    #[test]
    fn prefissi_diversi_per_lo_stesso_spazio_dei_nomi_non_sono_una_perdita() {
        let a = docx(
            &format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#),
            &rels(""),
            &[],
        );
        let b = docx(
            r#"<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p/></x:body></x:document>"#,
            &rels(""),
            &[],
        );
        let (a, b) = (inventory(&a).unwrap(), inventory(&b).unwrap());
        assert_eq!(a.all, b.all);
        assert!(open_differences(&a, &b).is_empty());
        assert_eq!(a.body.len(), 1);
        assert_eq!(a.body[0][&element(DOCUMENT, "p")], 1);
    }

    #[test]
    fn un_elemento_in_meno_è_una_perdita_uno_in_più_no() {
        let one = docx(
            &format!(
                r#"<w:document {W}><w:body><w:p><w:permStart w:id="1"/></w:p></w:body></w:document>"#
            ),
            &rels(""),
            &[],
        );
        let none = docx(
            &format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#),
            &rels(""),
            &[],
        );
        let (one, none) = (inventory(&one).unwrap(), inventory(&none).unwrap());
        let lost = open_differences(&one, &none);
        assert!(lost.iter().any(|d| d.key.contains("permStart")), "{lost:?}");
        assert!(open_differences(&none, &one).is_empty());
    }

    #[test]
    fn una_parte_copiata_conta_per_contenuto_e_una_copia_in_più_è_una_differenza() {
        let image = rels(
            r#"<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/>"#,
        );
        let twice = rels(
            r#"<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/b.png"/>"#,
        );
        let body = format!(
            r#"<w:document {W}><w:body><w:p><w:r><w:drawing r:embed="rId5"/></w:r></w:p></w:body></w:document>"#
        );
        let a = inventory(&docx(&body, &image, &[("word/media/a.png", b"PNG")])).unwrap();
        // La stessa immagine con un altro nome: nessuna differenza.
        let renamed = image.replace("a.png", "c.png");
        let c = inventory(&docx(&body, &renamed, &[("word/media/c.png", b"PNG")])).unwrap();
        assert!(open_differences(&a, &c).is_empty());
        // Duplicata in un'altra parte: differenza.
        let b = inventory(&docx(
            &body,
            &twice,
            &[("word/media/a.png", b"PNG"), ("word/media/b.png", b"PNG")],
        ))
        .unwrap();
        assert!(open_differences(&a, &b)
            .iter()
            .any(|d| d.key.starts_with("part image/png")));
        // Un'altra immagine: differenza, e la relazione punta altrove.
        let other = inventory(&docx(&body, &image, &[("word/media/a.png", b"GIF")])).unwrap();
        let lost = open_differences(&a, &other);
        assert!(
            lost.iter().any(|d| d.key.contains("relationship")),
            "{lost:?}"
        );
    }

    #[test]
    fn una_parte_che_nessuno_nomina_non_conta() {
        let body = format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#);
        let a = inventory(&docx(&body, &rels(""), &[])).unwrap();
        let b = inventory(&docx(&body, &rels(""), &[("word/orfana.png", b"x")])).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn un_riferimento_senza_relazione_si_vede() {
        let body = format!(
            r#"<w:document {W}><w:body><w:p><w:r><w:drawing r:embed="rId9"/></w:r></w:p></w:body></w:document>"#
        );
        let a = inventory(&docx(&body, &rels(""), &[])).unwrap();
        assert_eq!(a.dangling.len(), 1);
        let ok = format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#);
        let ok = inventory(&docx(&ok, &rels(""), &[])).unwrap();
        assert!(!open_differences(&ok, &a).is_empty());
    }

    /// Due voci con lo stesso nome, che l'indice di `zip` riduce a una: il
    /// file del corpus è scritto a mano proprio per questo.
    #[test]
    fn due_voci_omonime_sono_un_errore() {
        let bytes = include_bytes!("../tests/corpus/docx/ostile-voci-duplicate.docx");
        assert!(matches!(
            inventory(bytes),
            Err(InventoryError::Zip(message)) if message.contains("duplicate entry word/document.xml")
        ));
    }

    #[test]
    fn zip_troncato_xml_malformato_e_limiti_sono_errori() {
        let good = docx(
            &format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#),
            &rels(""),
            &[],
        );
        assert!(matches!(
            inventory(&good[..good.len() / 2]),
            Err(InventoryError::Zip(_))
        ));
        let bad = docx(
            &format!(r#"<w:document {W}><w:body><w:p></w:body></w:document>"#),
            &rels(""),
            &[],
        );
        assert!(matches!(inventory(&bad), Err(InventoryError::Xml { .. })));
        let deep = format!(
            r#"<w:document {W}><w:body>{}{}</w:body></w:document>"#,
            "<w:p>".repeat(20),
            "</w:p>".repeat(20)
        );
        let limits = Limits {
            depth: 10,
            ..LIMITS
        };
        assert_eq!(
            inventory_with(&docx(&deep, &rels(""), &[]), &limits),
            Err(InventoryError::Limit("xml depth"))
        );
        let limits = Limits {
            elements: 2,
            ..LIMITS
        };
        assert_eq!(
            inventory_with(&good, &limits),
            Err(InventoryError::Limit("xml elements"))
        );
        let limits = Limits {
            part_bytes: 8,
            ..LIMITS
        };
        assert_eq!(
            inventory_with(&good, &limits),
            Err(InventoryError::Limit("part size"))
        );
    }

    #[test]
    fn le_destinazioni_relative_si_risolvono_dalla_cartella_della_sorgente() {
        assert_eq!(
            resolve("word/document.xml", "media/a.png"),
            "word/media/a.png"
        );
        assert_eq!(
            resolve("word/document.xml", "../customXml/item1.xml"),
            "customxml/item1.xml"
        );
        assert_eq!(resolve("", "word/document.xml"), "word/document.xml");
        assert_eq!(resolve("word/document.xml", "/word/x.xml"), "word/x.xml");
        assert_eq!(rels_of("word/document.xml"), "word/_rels/document.xml.rels");
        assert_eq!(rels_of(""), "_rels/.rels");
    }
}
