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
//!   parte; l'attributo con il suo valore in forma canonica
//!   ([`crate::canonical`]), e un riferimento a una relazione (`r:id`) con la
//!   relazione che nomina, non con il suo id;
//! - il testo: di ogni paragrafo l'impronta dei suoi `w:t`, `w:delText`, `m:t`
//!   e delle istruzioni di campo, degli altri elementi il valore canonico;
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
//! restino identici (vedi [`crate::preservation`]). Un contenitore trasparente
//! (`w:customXml`, `w:smartTag`, `w:ins`, `w:moveTo`) conta i suoi figli come
//! blocchi, e un segno fra due blocchi (un segnalibro, l'inizio di un
//! commento, un permesso) va con il blocco che segue. Dentro un paragrafo la
//! forma dei run e le loro proprietà contano una volta: il codec unisce i run
//! uguali, e il testo del paragrafo resta nell'impronta.
//!
//! Le [`NORMALIZATIONS`] sono i soli segni che non si contano: quelli che Word
//! rigenera a ogni salvataggio e i numeri che il codec riassegna. Ciascuna
//! dice che cosa salta e perché, e il resoconto ne dà i totali.
//!
//! Lo zip e l'XML hanno limiti propri, dello stesso ordine di quelli del codec:
//! un limite superato, uno zip illeggibile o un XML malformato sono un
//! [`InventoryError`], e chi chiama fallisce chiuso.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt;
use std::fmt::Write as _;
use std::io::{Cursor, Read};
use std::sync::Arc;

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;
use sha2::{Digest, Sha256};

mod count;
mod normalize;

use count::{add, count_xml, each_element, Context};
pub(crate) use count::{MARKERS, WRAPPERS};
pub(crate) use normalize::{
    empty_properties, equal_differences, equivalent_attribute, open_differences, open_losses,
    renumbered, side_element, simple_field, skipped_attribute, skipped_element, Difference,
    NORMALIZATIONS, TRAILING_PARAGRAPH,
};

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

/// Un nome di una chiave. Un documento grande ripete pochi nomi milioni di
/// volte: le chiavi li condividono ([`Names`]).
pub(crate) type Name = Arc<str>;

/// I nomi già visti da un inventario.
#[derive(Default)]
struct Names {
    seen: HashSet<Name>,
    buf: String,
}

impl Names {
    fn get(&mut self, name: &str) -> Name {
        if let Some(seen) = self.seen.get(name) {
            return Arc::clone(seen);
        }
        let name: Name = Arc::from(name);
        self.seen.insert(Arc::clone(&name));
        name
    }

    /// Il nome espanso `{ns}name`.
    fn expanded(&mut self, ns: &str, name: &str) -> Name {
        let mut buf = std::mem::take(&mut self.buf);
        buf.clear();
        let _ = write!(buf, "{{{ns}}}{name}");
        let out = self.get(&buf);
        self.buf = buf;
        out
    }
}

/// Una cosa che il pacchetto contiene, e che si conta.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Key {
    /// Un elemento, per classe della parte e nome espanso.
    Element { class: Name, ns: Name, name: Name },
    /// Un attributo, per classe, elemento che lo porta, nome espanso e valore
    /// canonico ([`crate::canonical`]). Il valore di un riferimento a una
    /// relazione (`r:id`, `r:embed`) è la relazione stessa, tipo e
    /// destinazione: un codec che rinumera gli id non cambia la chiave, uno
    /// che punta altrove sì.
    Attribute {
        class: Name,
        element: Name,
        ns: Name,
        name: Name,
        value: Name,
    },
    /// Il testo di un paragrafo (`w:p`, i soli `w:t`, `w:delText`, `m:t` e le
    /// istruzioni dei campi), o di un altro elemento che ne ha, per impronta.
    /// Il paragrafo e non il run: il codec unisce i run uguali.
    Text {
        class: Name,
        element: Name,
        sha256: Name,
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
            Key::Element { class, .. } | Key::Attribute { class, .. } | Key::Text { class, .. } => {
                class
            }
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
                value,
            } => write!(f, "{class}: {element} @{{{ns}}}{name}={value:?}"),
            Key::Text {
                class,
                element,
                sha256,
            } => write!(f, "{class}: text of {element} {}", &sha256[..12]),
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

pub(crate) const NS_RELATIONSHIPS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub(crate) const NS_W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
pub(crate) const NS_W14: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
pub(crate) const NS_W15: &str = "http://schemas.microsoft.com/office/word/2012/wordml";
pub(crate) const NS_W16CID: &str = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
pub(crate) const NS_M: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";
pub(crate) const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_EXTENDED: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
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
        // Un tipo senza `+xml` non è XML: le impostazioni della stampante, un
        // documento incorporato. Il codec lo copia.
        return rest.strip_suffix("+xml").map(str::to_string);
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
    /// Quante volte ogni normalizzazione dichiarata ha saltato qualcosa.
    pub normalized: BTreeMap<&'static str, u64>,
}

impl Inventory {
    /// Quante chiavi tiene, corpo compreso.
    pub fn entries(&self) -> usize {
        self.all.len() + self.body.iter().map(BTreeMap::len).sum::<usize>()
    }

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
pub(crate) struct Zip {
    /// Per nome in minuscolo, senza la barra iniziale: in OPC i nomi delle
    /// parti non distinguono maiuscole e minuscole.
    pub parts: BTreeMap<String, Vec<u8>>,
    /// Il nome di ogni voce come lo zip lo scrive, nell'ordine dello zip.
    pub names: Vec<String>,
}

fn zip_error(error: impl fmt::Display) -> InventoryError {
    InventoryError::Zip(error.to_string())
}

impl Zip {
    pub(crate) fn read(bytes: &[u8], limits: &Limits) -> Result<Zip, InventoryError> {
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
        let mut names = Vec::new();
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
            names.push(name);
        }
        Ok(Zip { parts, names })
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
pub(crate) struct ContentTypes {
    pub defaults: BTreeMap<String, String>,
    pub overrides: BTreeMap<String, String>,
}

impl ContentTypes {
    pub(crate) fn read(zip: &Zip, limits: &Limits) -> Result<ContentTypes, InventoryError> {
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

    pub(crate) fn of(&self, part: &str) -> String {
        if let Some(ct) = self.overrides.get(part) {
            return ct.clone();
        }
        let ext = part.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
        self.defaults.get(ext).cloned().unwrap_or_default()
    }
}

/// Una relazione letta da una parte `.rels`.
#[derive(Clone, Debug)]
pub(crate) struct Relationship {
    pub id: String,
    pub kind: String,
    pub target: String,
    pub external: bool,
}

pub(crate) fn rels_of(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None if part.is_empty() => "_rels/.rels".into(),
        None => format!("_rels/{part}.rels"),
    }
}

/// La parte che una destinazione relativa nomina, dalla cartella della sorgente.
pub(crate) fn resolve(source: &str, target: &str) -> String {
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

pub(crate) fn read_rels(
    zip: &Zip,
    part: &str,
    limits: &Limits,
) -> Result<Vec<Relationship>, InventoryError> {
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

/// La destinazione di una relazione di `source` come la chiave la scrive:
/// l'URL se è esterna, la classe se è una parte che il codec riscrive,
/// l'impronta del contenuto se è una parte da copiare.
pub(crate) fn target_of(
    zip: &Zip,
    types: &ContentTypes,
    source: &str,
    rel: &Relationship,
) -> String {
    if rel.external {
        return format!("url:{}", rel.target);
    }
    let path = resolve(source, &rel.target);
    match zip.parts.get(&path) {
        None => format!("missing:{path}"),
        Some(bytes) => match class_of(&types.of(&path)) {
            Some(class) => format!("class:{class}"),
            None => format!("sha256:{}", sha256(bytes)),
        },
    }
}

/// Le relazioni di `part` per id, descritte come le scrive la chiave di un
/// riferimento: tipo e destinazione.
pub(crate) fn described(
    zip: &Zip,
    types: &ContentTypes,
    part: &str,
    rels: &[Relationship],
) -> BTreeMap<String, String> {
    rels.iter()
        .map(|rel| {
            let target = target_of(zip, types, part, rel);
            (rel.id.clone(), format!("{} → {target}", rel.kind))
        })
        .collect()
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
        // La destinazione di ogni relazione, come la chiave la scrive.
        let mut targets = Vec::with_capacity(rels.len());
        for rel in &rels {
            if !rel.external {
                let path = resolve(&part, &rel.target);
                if zip.parts.contains_key(&path) && seen.insert(path.clone()) {
                    todo.push(path);
                }
            }
            targets.push(target_of(&zip, &types, &part, rel));
        }
        let by_id: BTreeMap<&str, String> = rels
            .iter()
            .zip(&targets)
            .map(|(rel, target)| (rel.id.as_str(), format!("{} → {target}", rel.kind)))
            .collect();

        if !part.is_empty() {
            let bytes = zip.parts.get(&part).map(Vec::as_slice).unwrap_or_default();
            match class_of(&types.of(&part)) {
                Some(class) => {
                    let main = class == DOCUMENT && inventory.body.is_empty();
                    let context = Context {
                        part: &part,
                        class: &class,
                        main,
                        rels: &by_id,
                        limits,
                    };
                    let parsed = count_xml(bytes, &context, &mut elements)?;
                    add(&mut inventory.all, &parsed.all);
                    if main {
                        inventory.body = parsed.body;
                    }
                    for (what, n) in parsed.normalized {
                        *inventory.normalized.entry(what).or_default() += n;
                    }
                    for value in parsed.references {
                        if !by_id.contains_key(value.as_str()) {
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

        for (rel, target) in rels.into_iter().zip(targets) {
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

#[cfg(test)]
mod tests;
