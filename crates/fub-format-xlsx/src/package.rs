//! Il pacchetto di una cartella come lo legge l'innesto: le voci dello zip,
//! le relazioni e i fogli di lavoro, con gli stessi limiti e le stesse regole
//! di risoluzione del lettore di GridCraft.
//!
//! I fogli si contano come li conta il lettore: una voce `<sheet>` senza
//! relazione, un foglio grafico o di dialogo non diventano un foglio del
//! modello, e l'`n`-esimo foglio di lavoro qui è l'`n`-esimo foglio del
//! modello.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// La parte più grande che si decomprime: lo stesso limite del lettore.
pub(crate) const MAX_PART: u64 = 512 * 1024 * 1024;
/// Il totale decompresso da un pacchetto.
pub(crate) const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
/// Le voci dello zip.
pub(crate) const MAX_ENTRIES: usize = 200_000;

/// Perché il pacchetto non si legge come serve all'innesto.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PackageError {
    Zip(String),
    Xml(String),
    TooLarge(String),
    /// Manca una parte o una relazione che una cartella deve avere.
    Missing(String),
}

impl std::fmt::Display for PackageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackageError::Zip(what) => write!(f, "zip: {what}"),
            PackageError::Xml(what) => write!(f, "xml: {what}"),
            PackageError::TooLarge(what) => write!(f, "too large: {what}"),
            PackageError::Missing(what) => write!(f, "missing: {what}"),
        }
    }
}

pub(crate) fn xml_error(part: &str, error: impl std::fmt::Display) -> PackageError {
    PackageError::Xml(format!("{part}: {error}"))
}

/// Una relazione, con la destinazione già risolta.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Rel {
    pub id: String,
    /// L'ultimo segmento del tipo (`worksheet`, `calcChain`, …): lo stesso per
    /// lo spazio dei nomi transitorio e per quello stretto.
    pub kind: String,
    pub target: String,
    pub external: bool,
}

/// Un foglio di lavoro della cartella.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Worksheet {
    /// Il nome come lo scrive il file.
    pub name: String,
    /// `sheetId`: stabile anche quando il foglio cambia nome.
    pub sheet_id: u32,
    /// La parte del foglio, normalizzata.
    pub part: String,
}

pub(crate) struct Package<'a> {
    zip: zip::ZipArchive<Cursor<&'a [u8]>>,
    names: HashMap<String, usize>,
    duplicates: bool,
    total: u64,
}

/// Il nome di una parte come lo confronta il pacchetto: senza `/` iniziale e
/// in minuscolo, perché i nomi delle parti OPC non distinguono le maiuscole.
pub(crate) fn normalize(name: &str) -> String {
    name.replace('\\', "/")
        .trim_start_matches('/')
        .to_ascii_lowercase()
}

impl<'a> Package<'a> {
    pub fn open(bytes: &'a [u8]) -> Result<Package<'a>, PackageError> {
        let zip = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| PackageError::Zip(error.to_string()))?;
        if zip.len() > MAX_ENTRIES {
            return Err(PackageError::TooLarge(format!("{} zip entries", zip.len())));
        }
        let mut names = HashMap::new();
        let mut duplicates = false;
        for index in 0..zip.len() {
            match zip.name_for_index(index) {
                Some(Ok(name)) => match names.entry(normalize(&name)) {
                    std::collections::hash_map::Entry::Occupied(_) => duplicates = true,
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        entry.insert(index);
                    }
                },
                Some(Err(error)) => return Err(PackageError::Zip(error.to_string())),
                None => {}
            }
        }
        Ok(Package {
            zip,
            names,
            duplicates,
            total: 0,
        })
    }

    /// Due voci hanno lo stesso nome di parte.
    pub fn has_duplicates(&self) -> bool {
        self.duplicates
    }

    pub fn has(&self, part: &str) -> bool {
        self.names.contains_key(&normalize(part))
    }

    /// I byte di una parte, o `None` se non c'è.
    pub fn read(&mut self, part: &str) -> Result<Option<Vec<u8>>, PackageError> {
        let Some(&index) = self.names.get(&normalize(part)) else {
            return Ok(None);
        };
        let mut file = self
            .zip
            .by_index(index)
            .map_err(|error| PackageError::Zip(format!("{part}: {error}")))?;
        if file.size() > MAX_PART {
            return Err(PackageError::TooLarge(format!(
                "{part} expands to {} bytes",
                file.size()
            )));
        }
        let limit = MAX_PART.min(MAX_TOTAL.saturating_sub(self.total));
        let mut out = Vec::with_capacity(file.size().min(16 * 1024 * 1024) as usize);
        (&mut file)
            .take(limit + 1)
            .read_to_end(&mut out)
            .map_err(|error| PackageError::Zip(format!("{part}: {error}")))?;
        if out.len() as u64 > limit {
            return Err(PackageError::TooLarge(format!(
                "{part} expands past the limit"
            )));
        }
        self.total += out.len() as u64;
        Ok(Some(out))
    }

    /// Le relazioni di una parte; una parte di relazioni assente o rotta dà
    /// l'elenco vuoto, come nel lettore.
    pub fn rels(&mut self, part: &str) -> Result<Vec<Rel>, PackageError> {
        let name = rels_of(part);
        let Some(bytes) = self.read(&name)? else {
            return Ok(Vec::new());
        };
        let (dir, _) = split_dir(part);
        let mut out = Vec::new();
        let parsed = each_start(&bytes, |element| {
            if local(element.name().as_ref()) != b"Relationship" {
                return;
            }
            let (Some(id), Some(target)) = (attr(element, b"Id"), attr(element, b"Target")) else {
                return;
            };
            let kind = attr(element, b"Type")
                .and_then(|kind| kind.rsplit('/').next().map(str::to_string))
                .unwrap_or_default();
            let external = attr(element, b"TargetMode")
                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"));
            let target = if external {
                target
            } else {
                resolve(dir, &target)
            };
            out.push(Rel {
                id,
                kind,
                target,
                external,
            });
        });
        Ok(if parsed.is_ok() { out } else { Vec::new() })
    }

    /// La parte del documento principale (`xl/workbook.xml` di solito).
    pub fn workbook_part(&mut self) -> Result<String, PackageError> {
        let rels = self.rels("")?;
        rels.iter()
            .find(|rel| rel.kind == "officeDocument" && !rel.external)
            .map(|rel| normalize(&rel.target))
            .or_else(|| {
                self.has("xl/workbook.xml")
                    .then(|| "xl/workbook.xml".to_string())
            })
            .ok_or_else(|| PackageError::Missing("workbook part".into()))
    }

    /// I fogli di lavoro nell'ordine del modello.
    pub fn worksheets(&mut self, workbook: &str) -> Result<Vec<Worksheet>, PackageError> {
        let bytes = self
            .read(workbook)?
            .ok_or_else(|| PackageError::Missing(workbook.to_string()))?;
        let rels = self.rels(workbook)?;
        let mut entries = Vec::new();
        let mut in_sheets = false;
        let mut reader = Reader::from_reader(bytes.as_slice());
        loop {
            match reader.read_event() {
                Ok(Event::Start(element)) if local(element.name().as_ref()) == b"sheets" => {
                    in_sheets = true;
                }
                Ok(Event::End(element)) if local(element.name().as_ref()) == b"sheets" => {
                    in_sheets = false;
                }
                Ok(Event::Start(element) | Event::Empty(element))
                    if in_sheets && local(element.name().as_ref()) == b"sheet" =>
                {
                    entries.push((
                        attr(&element, b"name").unwrap_or_default(),
                        attr(&element, b"sheetId")
                            .and_then(|id| id.parse::<u32>().ok())
                            .unwrap_or(0),
                        attr(&element, b"id"),
                    ));
                }
                Ok(Event::Eof) => break,
                Ok(_) => {}
                Err(error) => return Err(xml_error(workbook, error)),
            }
        }
        let mut out = Vec::new();
        for (name, sheet_id, rel_id) in entries {
            let Some(rel) = rel_id.and_then(|id| rels.iter().find(|rel| rel.id == id)) else {
                continue;
            };
            if rel.kind != "worksheet" || rel.external {
                continue;
            }
            out.push(Worksheet {
                name,
                sheet_id,
                part: normalize(&rel.target),
            });
        }
        Ok(out)
    }
}

/// `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`; `""` → `_rels/.rels`.
pub(crate) fn rels_of(part: &str) -> String {
    let (dir, file) = split_dir(part);
    if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    }
}

/// `xl/worksheets/sheet1.xml` → (`xl/worksheets`, `sheet1.xml`).
pub(crate) fn split_dir(part: &str) -> (&str, &str) {
    let part = part.trim_start_matches('/');
    match part.rfind('/') {
        Some(at) => (&part[..at], &part[at + 1..]),
        None => ("", part),
    }
}

/// Risolve la destinazione di una relazione rispetto alla cartella della parte.
pub(crate) fn resolve(dir: &str, target: &str) -> String {
    let target = target.replace('\\', "/");
    let target = target.split('#').next().unwrap_or("");
    let mut segments: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        dir.split('/')
            .filter(|segment| !segment.is_empty())
            .collect()
    };
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            segment => segments.push(segment),
        }
    }
    segments.join("/")
}

/// Il nome locale di un nome qualificato.
pub(crate) fn local(name: &[u8]) -> &[u8] {
    match name.iter().rposition(|&byte| byte == b':') {
        Some(at) => &name[at + 1..],
        None => name,
    }
}

/// Il prefisso di un nome qualificato, se ne ha uno.
pub(crate) fn prefix(name: &[u8]) -> Option<&[u8]> {
    name.iter()
        .rposition(|&byte| byte == b':')
        .map(|at| &name[..at])
}

/// Il valore di un attributo per nome locale, già senza entità.
pub(crate) fn attr(element: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    element
        .attributes()
        .with_checks(false)
        .flatten()
        .find(|attribute| local(attribute.key.as_ref()) == name)
        .and_then(|attribute| {
            attribute
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|value| value.into_owned())
        })
}

/// Chiama `visit` su ogni elemento che si apre.
pub(crate) fn each_start(
    bytes: &[u8],
    mut visit: impl FnMut(&BytesStart<'_>),
) -> Result<(), quick_xml::Error> {
    let mut reader = Reader::from_reader(bytes);
    loop {
        match reader.read_event()? {
            Event::Start(element) | Event::Empty(element) => visit(&element),
            Event::Eof => return Ok(()),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_destinazioni_si_risolvono_come_nel_lettore() {
        assert_eq!(
            resolve("xl", "worksheets/sheet1.xml"),
            "xl/worksheets/sheet1.xml"
        );
        assert_eq!(
            resolve("xl/worksheets", "../tables/t.xml"),
            "xl/tables/t.xml"
        );
        assert_eq!(resolve("xl", "/xl/calcChain.xml"), "xl/calcChain.xml");
        assert_eq!(rels_of(""), "_rels/.rels");
        assert_eq!(rels_of("xl/workbook.xml"), "xl/_rels/workbook.xml.rels");
        assert_eq!(normalize("/XL/Workbook.xml"), "xl/workbook.xml");
        assert_eq!(local(b"x:row"), b"row");
        assert_eq!(prefix(b"x:row"), Some(&b"x"[..]));
        assert_eq!(prefix(b"row"), None);
    }
}
