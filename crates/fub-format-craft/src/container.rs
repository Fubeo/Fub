//! I tre contenitori dei file Craft, letti senza il motore dell'app: il JSON
//! di VectorCraft (a volte gzip, con i blob in coda), lo ZIP di PhotoCraft
//! con `manifest.json` e lo ZIP di FigCraft con `document.json`.
//!
//! Ogni file è input ostile: le misure si controllano prima di leggere, ogni
//! lettura ha un tetto, e nessuna allocazione la decide un numero scritto nel
//! file.
//!
//! [`read_meta`] dà i metadati, il testo e il documento; [`embedded_preview`]
//! l'anteprima che il file porta; [`Png`] e [`png_size`] le misure di un PNG,
//! che usa anche
//! [`PreviewImage::from_png`](crate::contract::PreviewImage::from_png).

use std::io::{Cursor, Read};

use base64::alphabet;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use flate2::read::GzDecoder;
use serde_json::Value;
use zip::result::ZipError;
use zip::ZipArchive;

use crate::apps::CraftApp;
use crate::contract::PreviewSize;

/// Il file più grande che si legge, JSON o ZIP.
pub const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
/// L'anteprima più grande che si prende dal file.
pub const MAX_PREVIEW_BYTES: usize = 8 * 1024 * 1024;
/// Le voci al massimo di uno ZIP.
pub const MAX_ZIP_ENTRIES: usize = 10_000;
/// Il testo per la ricerca, tagliato su un confine di carattere.
pub const MAX_TEXT_BYTES: usize = 64 * 1024;

/// La firma di 8 byte di ogni PNG.
pub const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];

/// Ciò che si legge da un file Craft per il modello del documento.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Contents {
    /// La versione del formato scritta nel file, sempre come stringa.
    pub format_version: Option<String>,
    /// Il titolo, se il file lo dice.
    pub title: Option<String>,
    /// I testi del documento, uno per riga, per la ricerca.
    pub text: String,
    /// Il documento JSON, che [`linked::collect`](crate::linked::collect)
    /// attraversa per i file collegati.
    pub json: Option<serde_json::Value>,
}

/// Perché un contenitore non si legge. Senza testi: la frase per chi guarda
/// la sceglie chi riceve l'errore.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContainerError {
    /// Il file, o una sua voce, supera un limite.
    TooLarge,
    /// Non è uno ZIP leggibile.
    NotZip,
    /// Il documento non è un JSON leggibile.
    NotJson,
    /// Lo gzip di VectorCraft è rotto o troncato.
    BadGzip,
    /// Manca ciò che il formato vuole.
    Missing,
}

/// Un PNG con le misure prese dalla sua intestazione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Png {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl Png {
    /// I byte, se sono un PNG con misure lecite ([`png_size`]).
    pub fn new(bytes: Vec<u8>) -> Option<Png> {
        let (width, height) = png_size(&bytes)?;
        Some(Png {
            bytes,
            width,
            height,
        })
    }
}

/// Larghezza e altezza di un PNG, dall'intestazione: la firma di 8 byte, poi
/// il primo chunk lungo 13 e di tipo `IHDR`, con larghezza e altezza big
/// endian. Misure a zero, o oltre i 2³¹ − 1 che il formato ammette, non sono
/// un PNG.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let rest = bytes.strip_prefix(&PNG_SIGNATURE[..])?;
    let length = u32::from_be_bytes(rest.get(0..4)?.try_into().ok()?);
    if length != 13 || rest.get(4..8)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(rest.get(8..12)?.try_into().ok()?);
    let height = u32::from_be_bytes(rest.get(12..16)?.try_into().ok()?);
    // I 13 byte dell'intestazione ci sono tutti: un IHDR troncato non dà misure.
    rest.get(8..21)?;
    let lawful = |side: u32| side != 0 && side <= i32::MAX as u32;
    (lawful(width) && lawful(height)).then_some((width, height))
}

/// I metadati, il testo e il documento di un file Craft.
///
/// - PhotoCraft: lo ZIP con `manifest.json`; la versione da `format_version`
///   e il titolo da `title` o `name`. Il manifesto è il documento.
/// - FigCraft: lo ZIP con `document.json`; la versione da `format_version` o
///   `version`, il titolo da `title` o `name`, il testo da ogni campo stringa
///   `text`, `content` o `characters`.
/// - VectorCraft: il JSON, scompattato se è gzip e tagliato prima dei blob;
///   versione, titolo e testo come FigCraft.
///
/// Uno ZIP senza il suo JSON dà i contenuti vuoti, non un errore; un JSON
/// valido che non è un oggetto non ha titolo né versione. Un XMP non è un
/// contenitore: i suoi metadati li legge [`xmp`](crate::xmp).
pub fn read_meta(app: CraftApp, bytes: &[u8]) -> Result<Contents, ContainerError> {
    check_file_size(bytes)?;
    match app {
        CraftApp::Xmp => Ok(Contents::default()),
        CraftApp::PhotoCraft => {
            let mut archive = open_zip(bytes)?;
            let Some(manifest) = read_entry(&mut archive, PHOTOCRAFT_MANIFEST, MAX_FILE_BYTES)?
            else {
                return Ok(Contents::default());
            };
            let json = parse_json(&manifest)?;
            Ok(Contents {
                format_version: version_of(&json, &["format_version"]),
                title: title_of(&json),
                text: String::new(),
                json: Some(json),
            })
        }
        CraftApp::FigCraft => {
            let mut archive = open_zip(bytes)?;
            let Some(document) = read_entry(&mut archive, FIGCRAFT_DOCUMENT, MAX_FILE_BYTES)?
            else {
                return Ok(Contents::default());
            };
            Ok(document_contents(parse_json(&document)?))
        }
        CraftApp::VectorCraft => Ok(document_contents(vectorcraft_json(bytes)?)),
    }
}

/// L'anteprima che il file porta per la misura `size`, se c'è ed è un PNG.
///
/// - PhotoCraft: `thumb.png` per [`PreviewSize::Small`] e
///   `composite/preview.png` per [`PreviewSize::Large`], ciascuna con l'altra
///   come riserva.
/// - FigCraft: `thumbnail.png` per le due misure.
/// - VectorCraft: `/preview/data`, in base64 con o senza il prefisso
///   `data:…;base64,`.
///
/// Un'anteprima che non è un PNG, vuota o che non si decodifica è `None`.
/// Una più grande di [`MAX_PREVIEW_BYTES`] è [`ContainerError::TooLarge`], se
/// la riserva non dà un PNG al suo posto.
pub fn embedded_preview(
    app: CraftApp,
    bytes: &[u8],
    size: PreviewSize,
) -> Result<Option<Png>, ContainerError> {
    check_file_size(bytes)?;
    match app {
        CraftApp::Xmp => Ok(None),
        CraftApp::PhotoCraft => {
            let order = match size {
                PreviewSize::Small => [PHOTOCRAFT_THUMB, PHOTOCRAFT_COMPOSITE],
                PreviewSize::Large => [PHOTOCRAFT_COMPOSITE, PHOTOCRAFT_THUMB],
            };
            first_png(&mut open_zip(bytes)?, &order)
        }
        CraftApp::FigCraft => first_png(&mut open_zip(bytes)?, &[FIGCRAFT_THUMBNAIL]),
        CraftApp::VectorCraft => vectorcraft_preview(&vectorcraft_json(bytes)?),
    }
}

/// Il manifesto di un `.pcraft`.
pub const PHOTOCRAFT_MANIFEST: &str = "manifest.json";
/// L'anteprima piccola di un `.pcraft`.
pub const PHOTOCRAFT_THUMB: &str = "thumb.png";
/// L'anteprima grande di un `.pcraft`.
pub const PHOTOCRAFT_COMPOSITE: &str = "composite/preview.png";
/// Il documento di un `.figcraft`.
pub const FIGCRAFT_DOCUMENT: &str = "document.json";
/// L'anteprima di un `.figcraft`, per le due misure.
pub const FIGCRAFT_THUMBNAIL: &str = "thumbnail.png";
/// Il separatore dopo il quale un `.vectorcraft` dalla versione 4 tiene i
/// blob: il JSON finisce prima.
pub const VECTORCRAFT_BLOBS: &[u8] = b"\n\0VCBLOBS\0";
/// Dove sta l'anteprima nel JSON di un `.vectorcraft`.
pub const VECTORCRAFT_PREVIEW_POINTER: &str = "/preview/data";

/// I due byte con cui comincia uno gzip.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
/// La stringa base64 più lunga che [`MAX_PREVIEW_BYTES`] diventano, con il
/// riempimento.
const MAX_PREVIEW_BASE64: usize = MAX_PREVIEW_BYTES.div_ceil(3) * 4;
/// I campi da cui si prende il titolo, nell'ordine.
const TITLE_KEYS: [&str; 2] = ["title", "name"];
/// I campi da cui si prende la versione di un documento, nell'ordine.
const VERSION_KEYS: [&str; 2] = ["format_version", "version"];
/// I campi stringa che sono testo del documento, a ogni profondità.
const TEXT_KEYS: [&str; 3] = ["text", "content", "characters"];

/// La fine della directory centrale di uno ZIP: la firma e i 22 byte fissi.
const EOCD_SIGNATURE: [u8; 4] = [b'P', b'K', 0x05, 0x06];
const EOCD_LEN: usize = 22;
/// Il commento in coda a uno ZIP è lungo al massimo 65 535 byte.
const EOCD_SEARCH: usize = EOCD_LEN + u16::MAX as usize;
/// Il localizzatore ZIP64, nei 20 byte prima della fine della directory.
const ZIP64_LOCATOR_SIGNATURE: [u8; 4] = [b'P', b'K', 0x06, 0x07];
const ZIP64_LOCATOR_LEN: usize = 20;
/// La fine della directory centrale ZIP64.
const ZIP64_EOCD_SIGNATURE: [u8; 4] = [b'P', b'K', 0x06, 0x06];

type Archive<'a> = ZipArchive<Cursor<&'a [u8]>>;

/// Un file oltre [`MAX_FILE_BYTES`] non si apre.
fn check_file_size(bytes: &[u8]) -> Result<(), ContainerError> {
    if bytes.len() > MAX_FILE_BYTES {
        Err(ContainerError::TooLarge)
    } else {
        Ok(())
    }
}

/// Lo ZIP, se le voci che dichiara e quelle che ha non passano
/// [`MAX_ZIP_ENTRIES`]. Il conto dichiarato si guarda prima di aprire, perché
/// aprire legge tutta la directory centrale.
fn open_zip(bytes: &[u8]) -> Result<Archive<'_>, ContainerError> {
    if declared_entries(bytes).is_some_and(|count| count > MAX_ZIP_ENTRIES as u64) {
        return Err(ContainerError::TooLarge);
    }
    let archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| ContainerError::NotZip)?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(ContainerError::TooLarge);
    }
    Ok(archive)
}

/// Il numero di voci più alto che le fini della directory centrale in coda
/// al file dichiarano, ZIP64 compreso: conta solo una fine il cui commento
/// arriva all'ultimo byte. `None` se non se ne trova nessuna: allora decide
/// l'apertura, e dopo il conto delle voci aperte.
fn declared_entries(bytes: &[u8]) -> Option<u64> {
    let from = bytes.len().saturating_sub(EOCD_SEARCH);
    let tail = bytes.get(from..)?;
    let mut highest: Option<u64> = None;
    for (at, window) in tail.windows(EOCD_LEN).enumerate() {
        // Una fine vera arriva, con il suo commento, all'ultimo byte del file.
        let comment = usize::from(u16::from_le_bytes(window.get(20..22)?.try_into().ok()?));
        if window.get(0..4)? != EOCD_SIGNATURE || from + at + EOCD_LEN + comment != bytes.len() {
            continue;
        }
        let total = u64::from(u16::from_le_bytes(window.get(10..12)?.try_into().ok()?));
        let count = if total == u64::from(u16::MAX) {
            zip64_entries(bytes, from + at).unwrap_or(total)
        } else {
            total
        };
        highest = Some(highest.map_or(count, |seen| seen.max(count)));
    }
    highest
}

/// Le voci che la fine della directory ZIP64 dichiara, seguendo il
/// localizzatore che sta subito prima della fine classica in `eocd`.
fn zip64_entries(bytes: &[u8], eocd: usize) -> Option<u64> {
    let locator = bytes.get(eocd.checked_sub(ZIP64_LOCATOR_LEN)?..eocd)?;
    if locator.get(0..4)? != ZIP64_LOCATOR_SIGNATURE {
        return None;
    }
    let offset = u64::from_le_bytes(locator.get(8..16)?.try_into().ok()?);
    let start = usize::try_from(offset).ok()?;
    let record = bytes.get(start..start.checked_add(40)?)?;
    if record.get(0..4)? != ZIP64_EOCD_SIGNATURE {
        return None;
    }
    Some(u64::from_le_bytes(record.get(32..40)?.try_into().ok()?))
}

/// I byte della voce `name`, al massimo `limit`: `None` se la voce non c'è o
/// è una cartella. La misura dichiarata si guarda prima di leggere, e la
/// lettura ha comunque il tetto, perché una voce può dichiararsi piccola e
/// scompattarsi grande. Il nome si confronta così com'è scritto: una voce
/// `../manifest.json` non è il manifesto.
fn read_entry(
    archive: &mut Archive<'_>,
    name: &str,
    limit: usize,
) -> Result<Option<Vec<u8>>, ContainerError> {
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(ZipError::FileNotFound) => return Ok(None),
        Err(_) => return Err(ContainerError::NotZip),
    };
    if entry.is_dir() {
        return Ok(None);
    }
    if entry.size() > limit as u64 {
        return Err(ContainerError::TooLarge);
    }
    let mut out = Vec::new();
    (&mut entry)
        .take(limit as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| ContainerError::NotZip)?;
    if out.len() > limit {
        return Err(ContainerError::TooLarge);
    }
    Ok(Some(out))
}

/// Il primo PNG fra le voci `names`, nell'ordine. Una voce che manca, che non
/// è un PNG o che non si legge passa la mano alla seguente; se nessuna dà un
/// PNG, l'errore della prima che non si è letta, altrimenti `None`.
fn first_png(archive: &mut Archive<'_>, names: &[&str]) -> Result<Option<Png>, ContainerError> {
    let mut failure = None;
    for name in names {
        match read_entry(archive, name, MAX_PREVIEW_BYTES) {
            Ok(Some(bytes)) => {
                if let Some(png) = Png::new(bytes) {
                    return Ok(Some(png));
                }
            }
            Ok(None) => {}
            Err(error) => {
                failure.get_or_insert(error);
            }
        }
    }
    failure.map_or(Ok(None), Err)
}

fn parse_json(bytes: &[u8]) -> Result<Value, ContainerError> {
    serde_json::from_slice(bytes).map_err(|_| ContainerError::NotJson)
}

/// Il JSON di un `.vectorcraft`: scompattato con un tetto se comincia come
/// uno gzip, e tagliato al primo [`VECTORCRAFT_BLOBS`].
fn vectorcraft_json(bytes: &[u8]) -> Result<Value, ContainerError> {
    let inflated;
    let raw = if bytes.starts_with(&GZIP_MAGIC) {
        let mut out = Vec::new();
        GzDecoder::new(bytes)
            .take(MAX_FILE_BYTES as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| ContainerError::BadGzip)?;
        if out.len() > MAX_FILE_BYTES {
            return Err(ContainerError::TooLarge);
        }
        inflated = out;
        inflated.as_slice()
    } else {
        bytes
    };
    let json = match find(raw, VECTORCRAFT_BLOBS) {
        Some(at) => raw.get(..at).unwrap_or_default(),
        None => raw,
    };
    parse_json(json)
}

/// Dove comincia la prima copia di `needle` in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    let first = *needle.first()?;
    let mut from = 0;
    while let Some(rest) = haystack.get(from..) {
        let at = from + rest.iter().position(|byte| *byte == first)?;
        if haystack.get(at..)?.starts_with(needle) {
            return Some(at);
        }
        from = at + 1;
    }
    None
}

/// L'anteprima in `/preview/data` di un `.vectorcraft`.
fn vectorcraft_preview(json: &Value) -> Result<Option<Png>, ContainerError> {
    let Some(data) = json
        .pointer(VECTORCRAFT_PREVIEW_POINTER)
        .and_then(Value::as_str)
    else {
        return Ok(None);
    };
    let Some(encoded) = strip_data_url(data) else {
        return Ok(None);
    };
    // Il tetto si guarda sulla stringa, prima di decodificare: gli spazi
    // contano, così nessuna stringa più lunga del tetto si copia.
    if encoded.len() > MAX_PREVIEW_BASE64 {
        return Err(ContainerError::TooLarge);
    }
    let compact: String = encoded
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    if compact.is_empty() {
        return Ok(None);
    }
    let engine = GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );
    let Ok(decoded) = engine.decode(compact) else {
        return Ok(None);
    };
    // Il tetto della stringa lascia passare un byte in più di
    // [`MAX_PREVIEW_BYTES`], quando la misura giusta ha il riempimento.
    if decoded.len() > MAX_PREVIEW_BYTES {
        return Err(ContainerError::TooLarge);
    }
    Ok(Png::new(decoded))
}

/// Il base64 di `data`: tolto il prefisso `data:…;base64,` se c'è. Un URL
/// `data:` che non è in base64 non dà niente. Il prefisso si confronta così
/// com'è scritto.
fn strip_data_url(data: &str) -> Option<&str> {
    if !data.starts_with("data:") {
        return Some(data);
    }
    let (head, encoded) = data.split_once(',')?;
    head.ends_with(";base64").then_some(encoded)
}

/// Versione, titolo e testo di un documento FigCraft o VectorCraft.
fn document_contents(json: Value) -> Contents {
    Contents {
        format_version: version_of(&json, &VERSION_KEYS),
        title: title_of(&json),
        text: collect_text(&json),
        json: Some(json),
    }
}

/// La versione dal primo dei campi `keys` dell'oggetto in cima che è un
/// numero o una stringa non vuota, sempre come stringa.
fn version_of(json: &Value, keys: &[&str]) -> Option<String> {
    let object = json.as_object()?;
    keys.iter().find_map(|key| match object.get(*key)? {
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        _ => None,
    })
}

/// Il titolo da `title` o `name` dell'oggetto in cima, se è una stringa non
/// vuota.
fn title_of(json: &Value) -> Option<String> {
    let object = json.as_object()?;
    TITLE_KEYS.iter().find_map(|key| match object.get(*key)? {
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        _ => None,
    })
}

/// I testi del documento: ogni campo stringa di [`TEXT_KEYS`], a ogni
/// profondità e nell'ordine del documento, uno per riga, fino a
/// [`MAX_TEXT_BYTES`] tagliati su un confine di carattere. La visita usa una
/// pila e non la ricorsione, e si ferma quando il tetto è passato.
fn collect_text(json: &Value) -> String {
    let mut text = String::new();
    let mut pending: Vec<(Option<&str>, &Value)> = vec![(None, json)];
    while let Some((key, value)) = pending.pop() {
        match value {
            Value::String(found) if key.is_some_and(|key| TEXT_KEYS.contains(&key)) => {
                if found.is_empty() {
                    continue;
                }
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(found);
                if text.len() > MAX_TEXT_BYTES {
                    break;
                }
            }
            Value::Object(map) => pending.extend(
                map.iter()
                    .rev()
                    .map(|(key, child)| (Some(key.as_str()), child)),
            ),
            Value::Array(items) => pending.extend(items.iter().rev().map(|item| (None, item))),
            _ => {}
        }
    }
    if text.len() > MAX_TEXT_BYTES {
        let mut cut = MAX_TEXT_BYTES;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        let kept = text.trim_end_matches('\n').len();
        text.truncate(kept);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un'intestazione PNG di `width` × `height`, fino alla fine di `IHDR`.
    fn header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn le_misure_vengono_dall_intestazione() {
        assert_eq!(png_size(&header(256, 180)), Some((256, 180)));
        let png = Png::new(header(3, 4)).unwrap();
        assert_eq!((png.width, png.height), (3, 4));
    }

    #[test]
    fn un_intestazione_storta_non_dà_misure() {
        assert_eq!(png_size(&[]), None);
        assert_eq!(png_size(&header(0, 10)), None);
        assert_eq!(png_size(&header(10, 0)), None);
        assert_eq!(png_size(&header(u32::MAX, 10)), None);
        let mut short = header(10, 10);
        short.truncate(PNG_SIGNATURE.len() + 8 + 12);
        assert_eq!(png_size(&short), None);
        let mut long = header(10, 10);
        long[PNG_SIGNATURE.len() + 3] = 14;
        assert_eq!(png_size(&long), None);
        let mut other = header(10, 10);
        other[PNG_SIGNATURE.len() + 4..PNG_SIGNATURE.len() + 8].copy_from_slice(b"IDAT");
        assert_eq!(png_size(&other), None);
        let mut jpeg = header(10, 10);
        jpeg[0] = 0xff;
        assert_eq!(png_size(&jpeg), None);
    }
}
