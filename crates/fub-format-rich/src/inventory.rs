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
    /// Quante volte ogni normalizzazione ha saltato qualcosa.
    normalized: BTreeMap<&'static str, u64>,
}

/// Ciò che [`count_xml`] sa della parte che conta.
struct Context<'a> {
    part: &'a str,
    class: &'a str,
    /// Il documento principale: si tiene a parte ogni blocco del corpo.
    main: bool,
    /// Le relazioni della parte per id, come la chiave le scrive.
    rels: &'a BTreeMap<&'a str, String>,
    limits: &'a Limits,
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
fn count_xml(
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

/// Ciò che una normalizzazione salta, ai due lati del confronto.
pub(crate) enum Skip {
    /// Gli elementi con questi nomi, con i loro attributi e il loro testo;
    /// non gli elementi che contengono, che contano.
    Elements {
        ns: &'static str,
        names: &'static [&'static str],
    },
    /// Gli attributi di questi spazi dei nomi il cui nome locale comincia
    /// così.
    Attributes {
        ns: &'static [&'static str],
        prefix: &'static str,
    },
    /// Il valore intero di questo attributo: l'attributo conta, il numero no.
    Number {
        ns: &'static str,
        name: &'static str,
    },
    /// Il numero in fondo al valore `stem` seguito da un intero di questo
    /// attributo di questo elemento (`{ns}element`).
    Numbered {
        element: &'static str,
        name: &'static str,
        stem: &'static str,
    },
    /// La forma semplice di un campo (`w:fldSimple`), che conta come la forma
    /// complessa in cui il codec la riscrive: l'istruzione va con quelle del
    /// paragrafo, gli altri attributi con l'inizio del campo (`w:fldChar`), i
    /// figli (il risultato) contano come sempre.
    Field {
        ns: &'static str,
        name: &'static str,
    },
    /// Il paragrafo vuoto dopo una tabella che chiude il corpo: nel file si
    /// conta come se ci fosse.
    TrailingParagraph,
    /// I nomi dei lati di ISO 29500 (`start`, `end`), che contano come i nomi
    /// che il codec scrive (`left`, `right`): gli elementi di questi
    /// contenitori, gli attributi di questi elementi, il valore `w:val` di
    /// questi altri.
    Sides {
        boxes: &'static [&'static str],
        attributes: &'static [&'static str],
        values: &'static [&'static str],
    },
    /// Questi contenitori di proprietà quando sono vuoti, senza attributi né
    /// figli: non contano. Con un figlio contano come sempre.
    EmptyProperties {
        ns: &'static str,
        names: &'static [&'static str],
    },
    /// Il `w:val` vero (`true`, `1`, `on`) di questi interruttori di
    /// WordprocessingML (`CT_OnOff`): conta come la sua assenza.
    ImplicitTrue { elements: &'static [&'static str] },
    /// Lo sporgente nullo (`w:hanging="0"`) di `w:ind`: conta come la prima
    /// riga nulla (`w:firstLine="0"`).
    ZeroHanging,
}

/// Il nome della normalizzazione del paragrafo dopo una tabella finale.
pub(crate) const TRAILING_PARAGRAPH: &str = "paragrafo dopo la tabella finale";

/// Una differenza che il codec produce senza perdere niente, con la ragione e
/// il test che lo dimostra. Una voce entra soltanto se Word stesso la
/// rigenera, se perderla non cambia contenuto, aspetto o comportamento, e se un
/// test lo prova.
pub(crate) struct Normalization {
    pub what: &'static str,
    /// Perché perderla non perde niente.
    pub why: &'static str,
    pub skip: Skip,
}

/// Le normalizzazioni dichiarate. Ciascuna ha il suo test qui sotto (il primo è
/// `le_normalizzazioni_saltano_soltanto_ciò_che_dichiarano`), e i file del
/// corpus le portano: `docx/segni-di-word.docx` i segni di Word, e si apre
/// modificabile; `docx/falsi-allarmi.docx` e `docx/libreoffice.docx` le forme
/// della norma e di LibreOffice.
pub(crate) const NORMALIZATIONS: &[Normalization] = &[
    Normalization {
        what: "w:id",
        why: "il numero che appaia due segni dentro il pacchetto (inizio e fine \
              di un segnalibro, di un commento, di un permesso; una nota e il suo \
              richiamo; una revisione): Word li rinumera a ogni salvataggio, e \
              l'appaiamento lo prova la rilettura del modello",
        skip: Skip::Number {
            ns: NS_W,
            name: "id",
        },
    },
    Normalization {
        what: "id dei disegni",
        why: "il numero di un disegno o di una forma (`wp:docPr`, `pic:cNvPr`), \
              unico nel documento: Word lo rinumera quando serve, e nessuna \
              parte lo nomina",
        skip: Skip::Number { ns: "", name: "id" },
    },
    Normalization {
        what: "nomi numerati delle immagini",
        why: "«Picture N» è il nome che Word dà a un'immagine inserita senza \
              nome, e che il codec ricava dall'id del disegno: si rinumera con \
              l'id. Un altro nome conta per intero",
        skip: Skip::Numbered {
            element:
                "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr",
            name: "name",
            stem: "Picture ",
        },
    },
    Normalization {
        what: "w:rsid*",
        why: "gli identificativi delle sessioni di modifica servono soltanto a \
              Confronta e Combina; Word ne aggiunge di nuovi a ogni salvataggio e, \
              con l'opzione «Memorizza numero casuale» spenta, li scrive senza",
        skip: Skip::Attributes {
            ns: &[NS_W],
            prefix: "rsid",
        },
    },
    Normalization {
        what: TRAILING_PARAGRAPH,
        why: "un corpo che finisce con una tabella: Word la fa sempre seguire \
              da un paragrafo, e il modello anche; il paragrafo vuoto in più \
              è un blocco anche nel file, e l'innesto non lo scrive finché \
              nessuno lo tocca",
        skip: Skip::TrailingParagraph,
    },
    Normalization {
        what: "start e end",
        why: "i nomi dei lati di ISO 29500 (`w:start`, `w:end`, `w:startChars`, \
              `jc=\"start\"`), che LibreOffice scrive: Word li legge come \
              `left` e `right`, che in un paragrafo da destra a sinistra \
              indicano già l'inizio e la fine, e il codec li riscrive così. Il \
              valore resta, e conta",
        skip: Skip::Sides {
            boxes: &["tblCellMar", "tcMar", "tblBorders", "tcBorders", "pBdr"],
            attributes: &["ind"],
            values: &["jc", "lvlJc", "tab"],
        },
    },
    Normalization {
        what: "proprietà vuote",
        why: "un contenitore di proprietà senza attributi né figli (`<w:rPr/>`, \
              `<w:pPr></w:pPr>`) dice soltanto che non c'è niente da dire: il \
              run, il paragrafo, la riga o la cella hanno le proprietà che \
              avrebbero senza. LibreOffice li scrive, il codec no. \
              `w:sectPr` e `w:tblPr` non ci sono: la loro assenza conta",
        skip: Skip::EmptyProperties {
            ns: NS_W,
            names: &["rPr", "pPr", "trPr", "tcPr"],
        },
    },
    Normalization {
        what: "vero implicito",
        why: "un interruttore di WordprocessingML (`CT_OnOff`) senza `w:val` è \
              acceso: `<w:keepNext w:val=\"true\"/>`, che LibreOffice scrive, \
              e `<w:keepNext/>`, che scrive il codec, dicono la stessa cosa. Un \
              valore spento conta, e un `w:val` di un altro elemento anche",
        skip: Skip::ImplicitTrue { elements: ON_OFF },
    },
    Normalization {
        what: "sporgente nullo",
        why: "un rientro della prima riga nullo, scritto come sporgente \
              (`w:hanging=\"0\"`, come fa LibreOffice) o come prima riga \
              (`w:firstLine=\"0\"`, come fa il codec): nei due casi la prima \
              riga non sporge e non rientra, e annulla quello dello stile. Uno \
              sporgente non nullo conta",
        skip: Skip::ZeroHanging,
    },
    Normalization {
        what: "w:fldSimple",
        why: "un campo scritto nella forma semplice: il codec lo riscrive nella \
              forma complessa (inizio, istruzione, separatore, risultato, fine), \
              che Word legge e scrive allo stesso modo; l'istruzione, gli \
              attributi e il risultato contano ancora",
        skip: Skip::Field {
            ns: NS_W,
            name: "fldSimple",
        },
    },
    Normalization {
        what: "w:proofErr",
        why: "segna dove il controllo ortografico di Word aveva trovato un \
              errore; Word lo ricalcola dal testo",
        skip: Skip::Elements {
            ns: NS_W,
            names: &["proofErr"],
        },
    },
    Normalization {
        what: "w:lastRenderedPageBreak",
        why: "dove cadeva una pagina nell'ultima impaginazione di Word: una \
              cache, che Word ricalcola",
        skip: Skip::Elements {
            ns: NS_W,
            names: &["lastRenderedPageBreak"],
        },
    },
    Normalization {
        what: "statistiche di app.xml",
        why: "il programma che ha salvato il file, la sua versione e i conteggi \
              (pagine, parole, caratteri, righe, paragrafi, minuti di modifica): \
              descrivono l'ultimo salvataggio, e Word li ricalcola a ogni \
              salvataggio",
        skip: Skip::Elements {
            ns: NS_EXTENDED,
            names: &[
                "Application",
                "AppVersion",
                "Pages",
                "Words",
                "Characters",
                "CharactersWithSpaces",
                "Lines",
                "Paragraphs",
                "TotalTime",
            ],
        },
    },
    Normalization {
        what: "paraId",
        why: "l'identificativo di un paragrafo (`w14:paraId`) e i rimandi a quelli \
              dei commenti (`w15:paraId`, `w15:paraIdParent`, `w16cid:paraId`): \
              Word li rigenera, e il codec li rinumera insieme; la risposta a un \
              commento la prova la rilettura del modello",
        skip: Skip::Attributes {
            ns: &[NS_W14, NS_W15, NS_W16CID],
            prefix: "paraId",
        },
    },
    Normalization {
        what: "w14:textId",
        why: "l'impronta di una versione del testo di un paragrafo, che Word \
              rigenera e nessuna parte nomina",
        skip: Skip::Attributes {
            ns: &[NS_W14],
            prefix: "textId",
        },
    },
];

/// La normalizzazione che conta questo elemento come un campo complesso, se
/// c'è.
pub(crate) fn simple_field(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Field {
            ns: n_ns,
            name: n_name,
        } if ns == n_ns && name == n_name => Some(n.what),
        _ => None,
    })
}

/// Il nome che il codec scrive per un lato di ISO 29500.
fn side(name: &str) -> Option<&'static str> {
    match name {
        "start" => Some("left"),
        "end" => Some("right"),
        "startChars" => Some("leftChars"),
        "endChars" => Some("rightChars"),
        _ => None,
    }
}

/// Il nome con cui conta l'elemento `name` di WordprocessingML dentro
/// `parent`, con la normalizzazione, se è un lato.
pub(crate) fn side_element(parent: &str, name: &str) -> Option<(&'static str, &'static str)> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Sides { boxes, .. } if boxes.contains(&parent) && matches!(name, "start" | "end") => {
            side(name).map(|left| (n.what, left))
        }
        _ => None,
    })
}

/// Gli interruttori di WordprocessingML (`CT_OnOff` di ECMA-376): un `w:val`
/// che manca vale vero.
const ON_OFF: &[&str] = &[
    // Il carattere.
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "rtl",
    "cs",
    "specVanish",
    "oMath",
    // Il paragrafo.
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "widowControl",
    "suppressLineNumbers",
    "suppressAutoHyphens",
    "kinsoku",
    "wordWrap",
    "overflowPunct",
    "topLinePunct",
    "autoSpaceDE",
    "autoSpaceDN",
    "bidi",
    "adjustRightInd",
    "contextualSpacing",
    "mirrorIndents",
    "suppressOverlap",
    // La sezione, la tabella, la riga, la cella.
    "titlePg",
    "noEndnote",
    "rtlGutter",
    "formProt",
    "bidiVisual",
    "cantSplit",
    "tblHeader",
    "hidden",
    "noWrap",
    "tcFitText",
    "hideMark",
    // Lo stile, la numerazione, il controllo del contenuto.
    "semiHidden",
    "unhideWhenUsed",
    "qFormat",
    "locked",
    "autoRedefine",
    "personal",
    "personalCompose",
    "personalReply",
    "isLgl",
    "temporary",
    "showingPlcHdr",
    // Le impostazioni.
    "autoHyphenation",
    "doNotHyphenateCaps",
    "evenAndOddHeaders",
    "mirrorMargins",
    "gutterAtTop",
    "trackRevisions",
    "doNotTrackMoves",
    "doNotTrackFormatting",
    "updateFields",
    "embedTrueTypeFonts",
    "embedSystemFonts",
    "saveSubsetFonts",
    "hideSpellingErrors",
    "hideGrammaticalErrors",
    "bordersDoNotSurroundHeader",
    "bordersDoNotSurroundFooter",
    "alignBordersAndEdges",
    "linkStyles",
    "removePersonalInformation",
    "removeDateAndTime",
    "doNotShadeFormData",
    "printTwoOnOne",
    "bookFoldPrinting",
    "bookFoldRevPrinting",
    "strictFirstAndLastChars",
    "noPunctuationKerning",
    "savePreviewPicture",
    "doNotIncludeSubdocsInStats",
    "doNotAutoCompressPictures",
    "styleLockTheme",
    "styleLockQFSet",
    "formsDesign",
    "autoFormatOverride",
    "displayBackgroundShape",
    "doNotDisplayPageBoundaries",
    "printFormsData",
    "saveFormsData",
    "printPostScriptOverText",
    "printFractionalCharacterWidth",
    "showEnvelope",
    "alwaysShowPlaceholderText",
    "alwaysMergeEmptyNamespace",
    "forceUpgrade",
];

/// Come conta un attributo dell'elemento `element` di WordprocessingML (`w`)
/// per una normalizzazione: con il nome e il valore dati, o (`None`) per
/// niente. `None` fuori se l'attributo conta com'è.
pub(crate) fn equivalent_attribute(
    w: bool,
    element: &str,
    ns: &str,
    name: &str,
    value: &str,
) -> Option<(&'static str, Option<(String, String)>)> {
    if !w || ns != NS_W {
        return None;
    }
    if let Some((what, name, value)) = side_attribute(element, name, value) {
        return Some((what, Some((name, value))));
    }
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::ImplicitTrue { elements }
            if name == "val"
                && elements.contains(&element)
                && matches!(value.trim(), "true" | "1" | "on") =>
        {
            Some((n.what, None))
        }
        Skip::ZeroHanging
            if element == "ind"
                && name == "hanging"
                && crate::canonical::value(NS_W, value) == "0" =>
        {
            Some((n.what, Some(("firstLine".to_string(), value.to_string()))))
        }
        _ => None,
    })
}

/// Il nome e il valore con cui conta un attributo dell'elemento `element` di
/// WordprocessingML, con la normalizzazione, se nomina un lato.
fn side_attribute(
    element: &str,
    name: &str,
    value: &str,
) -> Option<(&'static str, String, String)> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Sides {
            attributes, values, ..
        } => {
            if attributes.contains(&element) {
                side(name).map(|left| (n.what, left.to_string(), value.to_string()))
            } else if values.contains(&element) && name == "val" && matches!(value, "start" | "end")
            {
                side(value).map(|left| (n.what, name.to_string(), left.to_string()))
            } else {
                None
            }
        }
        _ => None,
    })
}

/// La normalizzazione che non conta questo contenitore di proprietà quando è
/// vuoto, se c'è.
pub(crate) fn empty_properties(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::EmptyProperties { ns: n_ns, names } if ns == n_ns && names.contains(&name) => {
            Some(n.what)
        }
        _ => None,
    })
}

/// La normalizzazione che salta questo elemento, se c'è.
pub(crate) fn skipped_element(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Elements { ns: n_ns, names } if ns == n_ns && names.contains(&name) => Some(n.what),
        _ => None,
    })
}

fn integer(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// La normalizzazione che toglie il numero al valore di questo attributo di
/// `element`, se c'è, con il valore che resta.
pub(crate) fn renumbered(
    element: &str,
    ns: &str,
    name: &str,
    value: &str,
) -> Option<(&'static str, String)> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Number {
            ns: n_ns,
            name: n_name,
        } if ns == n_ns && name == n_name && integer(value.trim()) => {
            Some((n.what, "#".to_string()))
        }
        Skip::Numbered {
            element: n_element,
            name: n_name,
            stem,
        } if ns.is_empty()
            && element == n_element
            && name == n_name
            && value.strip_prefix(stem).is_some_and(integer) =>
        {
            Some((n.what, format!("{stem}#")))
        }
        _ => None,
    })
}

/// La normalizzazione che salta questo attributo, se c'è.
pub(crate) fn skipped_attribute(ns: &str, name: &str) -> Option<&'static str> {
    NORMALIZATIONS.iter().find_map(|n| match n.skip {
        Skip::Attributes { ns: n_ns, prefix } if n_ns.contains(&ns) && name.starts_with(prefix) => {
            Some(n.what)
        }
        _ => None,
    })
}

/// La regola all'apertura: `original` sono i byte del file, `dry` quelli di una
/// prova a vuoto del codec (scrivere il documento letto, senza modificarlo).
///
/// Nessuna chiave può diminuire: le normalizzazioni dichiarate non si contano
/// nemmeno. Nelle classi riscritte un aumento è ammesso (il codec aggiunge
/// valori predefiniti); fra le parti copiate anche un aumento è una
/// differenza. La stessa regola vale blocco per blocco del corpo: senza
/// modifiche il modello tiene i blocchi nello stesso ordine, e una differenza
/// dice quale blocco perderebbe che cosa.
pub(crate) fn open_differences(original: &Inventory, dry: &Inventory) -> Vec<Difference> {
    let mut out = losses(&original.all, &dry.all, "");
    if original.body.len() == dry.body.len() {
        for (at, (before, after)) in original.body.iter().zip(&dry.body).enumerate() {
            out.extend(losses(before, after, &format!("block {at}: ")));
        }
    } else {
        out.push(Difference {
            key: "body blocks".into(),
            before: original.body.len() as u64,
            after: dry.body.len() as u64,
        });
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

/// Le differenze della regola all'apertura ([`open_differences`]), divise fra
/// i blocchi del corpo e il resto del pacchetto.
pub(crate) struct Losses {
    /// Fuori dal corpo del documento principale, con i riferimenti che
    /// resterebbero senza la loro relazione.
    pub outside: Vec<Difference>,
    /// Blocco per blocco del corpo, nell'ordine.
    pub blocks: Vec<Vec<Difference>>,
}

/// La regola all'apertura divisa per luogo: `None` se la prova a vuoto non ha
/// i blocchi del file.
pub(crate) fn open_losses(original: &Inventory, dry: &Inventory) -> Option<Losses> {
    if original.body.len() != dry.body.len() {
        return None;
    }
    let mut outside = losses(&original.outside_body(), &dry.outside_body(), "");
    for dangling in dry.dangling.difference(&original.dangling) {
        outside.push(Difference {
            key: format!("dangling reference {dangling}"),
            before: 0,
            after: 1,
        });
    }
    let blocks = original
        .body
        .iter()
        .zip(&dry.body)
        .enumerate()
        .map(|(at, (before, after))| losses(before, after, &format!("block {at}: ")))
        .collect();
    Some(Losses { outside, blocks })
}

/// Le chiavi che diminuiscono, e le parti copiate che cambiano numero.
fn losses(before: &Counts, after: &Counts, at: &str) -> Vec<Difference> {
    let keys: BTreeSet<&Key> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
        .filter_map(|key| {
            let b = before.get(key).copied().unwrap_or(0);
            let a = after.get(key).copied().unwrap_or(0);
            let copied = matches!(key, Key::Part { .. });
            (a < b || (copied && a > b)).then(|| Difference {
                key: format!("{at}{key}"),
                before: b,
                after: a,
            })
        })
        .collect()
}

/// Le differenze fra due insiemi di conteggi che devono essere uguali.
pub(crate) fn equal_differences(before: &Counts, after: &Counts, at: &str) -> Vec<Difference> {
    let keys: BTreeSet<&Key> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
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

    /// L'inventario del documento con questo corpo.
    fn body_of(body: &str) -> Inventory {
        let document = format!(
            r#"<w:document {W} xmlns:w14="{NS_W14}"><w:body>{body}<w:sectPr/></w:body></w:document>"#
        );
        inventory(&docx(&document, &rels(""), &[])).unwrap()
    }

    #[test]
    fn un_tipo_senza_xml_si_copia() {
        assert_eq!(class_of(&format!("{WML}printerSettings")), None);
        assert_eq!(class_of(&format!("{WML}document")), None);
        assert_eq!(
            class_of(&format!("{WML}header+xml")).as_deref(),
            Some("header")
        );
    }

    #[test]
    fn il_paragrafo_dopo_una_tabella_finale_conta_come_nella_prova_a_vuoto() {
        let table =
            r#"<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cella</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
        let file = body_of(table);
        let dry = body_of(&format!("{table}<w:p></w:p>"));
        assert_eq!(file.normalized.get(TRAILING_PARAGRAPH), Some(&1));
        assert_eq!(file.body.len(), 2);
        assert_eq!(open_differences(&file, &dry), Vec::new());
        // Non dopo un paragrafo, né dopo una tabella seguita da un segno.
        assert_eq!(
            body_of(&format!("{table}<w:p/>"))
                .normalized
                .get(TRAILING_PARAGRAPH),
            None
        );
        let marked = body_of(&format!(
            r#"{table}<w:bookmarkStart w:id="0" w:name="x"/><w:bookmarkEnd w:id="0"/>"#
        ));
        assert_eq!(marked.normalized.get(TRAILING_PARAGRAPH), None);
    }

    #[test]
    fn un_campo_semplice_conta_come_il_campo_complesso_che_il_codec_scrive() {
        let simple = body_of(
            r#"<w:p><w:fldSimple w:instr=" PAGE  \* MERGEFORMAT " w:dirty="1"><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>"#,
        );
        let complex = |instr: &str, result: &str| {
            body_of(&format!(
                r#"<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="1"/></w:r><w:r><w:instrText xml:space="preserve">{instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>{result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#
            ))
        };
        assert_eq!(simple.normalized.get("w:fldSimple"), Some(&1));
        let same = complex(" PAGE \\* MERGEFORMAT ", "3");
        assert_eq!(open_differences(&simple, &same), Vec::new());
        // L'istruzione, il risultato e gli altri attributi contano ancora.
        for (instr, result) in [(" NUMPAGES ", "3"), (" PAGE \\* MERGEFORMAT ", "4")] {
            assert_ne!(
                open_differences(&simple, &complex(instr, result)),
                Vec::new(),
                "{instr} {result}"
            );
        }
        let undirty = body_of(
            r#"<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE \* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#,
        );
        assert_ne!(open_differences(&simple, &undirty), Vec::new());
    }

    #[test]
    fn un_contenitore_di_proprietà_vuoto_non_conta_e_uno_pieno_sì() {
        let empty = body_of(
            r#"<w:p><w:pPr><w:rPr></w:rPr></w:pPr><w:r><w:rPr/><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:trPr w:rsidR="00AA11BB"></w:trPr><w:tc><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>"#,
        );
        let plain = body_of(
            r#"<w:p><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
        );
        assert_eq!(empty.normalized.get("proprietà vuote"), Some(&5));
        assert_eq!(open_differences(&empty, &plain), Vec::new());
        assert_eq!(empty.body, plain.body);
        // Il contenitore di un contenitore con un figlio conta, tutti e due.
        let full = body_of(
            r#"<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
        );
        assert_eq!(full.normalized.get("proprietà vuote"), None);
        let differences: Vec<String> = open_differences(&full, &plain)
            .into_iter()
            .map(|d| d.key)
            .collect();
        for name in ["}pPr", "}rPr", "}b"] {
            assert!(
                differences.iter().any(|d| d.contains(name)),
                "{name}: {differences:?}"
            );
        }
        // Un attributo che conta lo fa contare.
        let marked = body_of(
            r#"<w:p><w:pPr w:foo="1"/><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
        );
        assert_ne!(open_differences(&marked, &plain), Vec::new());
        // Una `w:tblPr` vuota conta.
        let table = body_of(
            r#"<w:p><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
        );
        assert_ne!(open_differences(&table, &plain), Vec::new());
    }

    #[test]
    fn i_lati_di_iso_29500_contano_come_left_e_right() {
        let iso = body_of(
            r#"<w:p><w:pPr><w:jc w:val="start"/><w:ind w:start="340" w:hanging="0"/><w:tabs><w:tab w:val="end" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblCellMar><w:start w:w="55" w:type="dxa"/><w:end w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
        );
        let transitional = |indent: &str| {
            body_of(&format!(
                r#"<w:p><w:pPr><w:jc w:val="left"/><w:ind w:left="{indent}" w:hanging="0"/><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblCellMar><w:left w:w="55" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#
            ))
        };
        assert_eq!(iso.normalized.get("start e end"), Some(&5));
        assert_eq!(open_differences(&iso, &transitional("340")), Vec::new());
        // Il valore conta ancora.
        assert_ne!(open_differences(&iso, &transitional("0")), Vec::new());
        // Fuori dai contenitori dei lati `w:start` resta sé stesso: il primo
        // numero di un elenco.
        let start = body_of(r#"<w:p><w:pPr><w:start w:val="3"/></w:pPr></w:p>"#);
        assert_eq!(start.normalized.get("start e end"), None);
    }

    #[test]
    fn un_interruttore_acceso_e_uno_sporgente_nullo_contano_come_li_scrive_il_codec() {
        let libreoffice = body_of(
            r#"<w:p><w:pPr><w:keepNext w:val="true"/><w:ind w:left="0" w:hanging="0"/></w:pPr><w:r><w:rPr><w:b w:val="1"/><w:i w:val="on"/></w:rPr><w:t>Testo</w:t></w:r></w:p>"#,
        );
        let codec = body_of(
            r#"<w:p><w:pPr><w:keepNext/><w:ind w:left="0" w:firstLine="0"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Testo</w:t></w:r></w:p>"#,
        );
        assert_eq!(libreoffice.normalized.get("vero implicito"), Some(&3));
        assert_eq!(libreoffice.normalized.get("sporgente nullo"), Some(&1));
        assert_eq!(open_differences(&libreoffice, &codec), Vec::new());
        // Un interruttore spento, uno sporgente non nullo e il `w:val` di un
        // elemento che non è un interruttore contano.
        for (file, written) in [
            (
                r#"<w:p><w:pPr><w:keepNext w:val="false"/></w:pPr></w:p>"#,
                r#"<w:p><w:pPr><w:keepNext/></w:pPr></w:p>"#,
            ),
            (
                r#"<w:p><w:pPr><w:ind w:hanging="360"/></w:pPr></w:p>"#,
                r#"<w:p><w:pPr><w:ind w:firstLine="360"/></w:pPr></w:p>"#,
            ),
            (
                r#"<w:p><w:pPr><w:ilvl w:val="1"/></w:pPr></w:p>"#,
                r#"<w:p><w:pPr><w:ilvl/></w:pPr></w:p>"#,
            ),
        ] {
            assert_ne!(
                open_differences(&body_of(file), &body_of(written)),
                Vec::new(),
                "{file}"
            );
        }
    }

    #[test]
    fn le_normalizzazioni_saltano_soltanto_ciò_che_dichiarano() {
        let marked = body_of(
            r#"<w:p w:rsidR="00AA11BB" w14:paraId="1A2B3C4D" w14:textId="0F0F0F0F"><w:proofErr w:type="spellStart"/><w:r w:rsidRPr="00CC22DD"><w:lastRenderedPageBreak/><w:t>Testo</w:t></w:r><w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="5" w:name="Segno"/><w:bookmarkEnd w:id="5"/></w:p>"#,
        );
        let plain = body_of(
            r#"<w:p><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
        );
        assert_eq!(marked.all, plain.all);
        assert_eq!(marked.body, plain.body);
        assert_eq!(marked.normalized.get("w:rsid*"), Some(&2));
        assert_eq!(marked.normalized.get("w:proofErr"), Some(&2));
        assert_eq!(marked.normalized.get("w:lastRenderedPageBreak"), Some(&1));
        assert_eq!(marked.normalized.get("paraId"), Some(&1));
        assert_eq!(marked.normalized.get("w14:textId"), Some(&1));
        assert_eq!(marked.normalized.get("w:id"), Some(&2));

        // Ciò che non è dichiarato conta ancora: il contenuto di un elemento
        // saltato, un altro attributo dello stesso spazio dei nomi, il nome
        // del segnalibro, un id che non è un numero.
        for other in [
            r#"<w:p><w:proofErr w:type="spellStart"><w:smartTagPr/></w:proofErr><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
            r#"<w:p w14:noSpellErr="1"><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
            r#"<w:p><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Altro"/><w:bookmarkEnd w:id="0"/></w:p>"#,
            r#"<w:p><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="a" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
        ] {
            assert_ne!(body_of(other).all, plain.all, "{other}");
        }
    }

    #[test]
    fn i_run_uniti_dal_codec_sono_lo_stesso_paragrafo_e_il_testo_conta() {
        let split = body_of(
            r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>run</w:t></w:r></w:p>"#,
        );
        let joined = body_of(
            r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due run</w:t></w:r></w:p>"#,
        );
        assert_eq!(split.all, joined.all);
        // Un altro testo, o la proprietà che sparisce dal paragrafo, no.
        let other = body_of(
            r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due Run</w:t></w:r></w:p>"#,
        );
        assert_ne!(other.all, joined.all);
        let plain = body_of(r#"<w:p><w:r><w:t xml:space="preserve">Due run</w:t></w:r></w:p>"#);
        assert_ne!(plain.all, joined.all);
        // Le entità sono il carattere che nominano.
        let entity = body_of(
            r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due&#32;r&#x75;n</w:t></w:r></w:p>"#,
        );
        assert_eq!(entity.all, joined.all);
    }

    #[test]
    fn i_valori_si_confrontano_in_forma_canonica() {
        let lower = body_of(
            r#"<w:p><w:pPr><w:keepNext w:val="true"/></w:pPr><w:r><w:rPr><w:color w:val="c00000"/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
        );
        let upper = body_of(
            r#"<w:p><w:pPr><w:keepNext w:val="1"/></w:pPr><w:r><w:rPr><w:color w:val="C00000"/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
        );
        assert_eq!(lower.all, upper.all);
        let other = body_of(
            r#"<w:p><w:pPr><w:keepNext w:val="1"/></w:pPr><w:r><w:rPr><w:color w:val="C00001"/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
        );
        assert_ne!(other.all, upper.all);
    }

    #[test]
    fn un_riferimento_vale_per_la_relazione_che_nomina() {
        let linked = |id: &str, target: &str| {
            let document = format!(
                r#"<w:document {W}><w:body><w:p><w:hyperlink r:id="{id}"><w:r><w:t>x</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#
            );
            let link = format!(
                r#"<Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{target}" TargetMode="External"/>"#
            );
            inventory(&docx(&document, &rels(&link), &[])).unwrap()
        };
        let first = linked("rId1", "https://a.example");
        // Un altro id per la stessa relazione è la stessa chiave; un'altra
        // destinazione cambia anche il blocco che la nomina.
        assert_eq!(first.all, linked("rId7", "https://a.example").all);
        assert_ne!(first.body, linked("rId7", "https://b.example").body);
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
