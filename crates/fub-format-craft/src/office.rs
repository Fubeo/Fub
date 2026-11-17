//! L'anteprima che un documento d'ufficio porta dentro di sé: la miniatura
//! di un pacchetto OOXML (`.docx`) o ODF (`.odt`), letta a pezzi come quella
//! di un `.pcraft`.
//!
//! Un pacchetto è uno ZIP. [`embedded_thumbnail`] ne guarda la coda e la
//! directory centrale con gli stessi tetti di
//! [`embedded_preview_from`](crate::container::embedded_preview_from) e legge
//! al più tre voci:
//!
//! - OOXML: le relazioni del pacchetto, [`OOXML_RELATIONSHIPS`] (al più
//!   [`MAX_RELATIONSHIPS_BYTES`]), e la voce della prima relazione di tipo
//!   [`OOXML_THUMBNAIL_TYPE`];
//! - ODF: [`ODF_THUMBNAIL`].
//!
//! Il tipo di pacchetto non si decide dall'estensione né dal `mimetype`:
//! contano le voci che ci sono. Una miniatura vale solo se è un PNG o un JPEG
//! (un `.emf` o un `.wmf` si scarta: la WebView non li mostra), di al più
//! [`MAX_THUMBNAIL_BYTES`], con le misure prese dalla sua intestazione.
//!
//! Il bersaglio della relazione è solo il nome di una voce dello ZIP, mai un
//! percorso su disco: si toglie una `/` in testa e si rifiuta un nome con un
//! segmento `..`, `.` o vuoto, o con una `\` ([`part_name`]).

use std::io::{Read, Seek};

use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use zip::read::{ArchiveOffset, Config};
use zip::ZipArchive;

use crate::container::zip_tail::{self, Budget, Budgeted};
use crate::container::{
    over_budget, read_entry, ContainerError, ENTRY_SLACK, MAX_PREVIEW_BYTES, MAX_ZIP_ENTRIES,
    OPEN_SLACK, PNG_SIGNATURE,
};
use crate::contract::PreviewImage;

/// Le relazioni del pacchetto OOXML.
pub const OOXML_RELATIONSHIPS: &str = "_rels/.rels";
/// Il tipo della relazione che porta alla miniatura di un pacchetto OOXML.
pub const OOXML_THUMBNAIL_TYPE: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";
/// La miniatura di un pacchetto ODF.
pub const ODF_THUMBNAIL: &str = "Thumbnails/thumbnail.png";
/// Le relazioni del pacchetto più lunghe che si leggono, scompattate.
pub const MAX_RELATIONSHIPS_BYTES: usize = 64 * 1024;
/// La miniatura più grande che si legge, scompattata.
pub const MAX_THUMBNAIL_BYTES: usize = MAX_PREVIEW_BYTES;

/// Le estensioni dei documenti che sono un pacchetto ZIP, senza il punto.
const PACKAGE_EXTENSIONS: [&str; 2] = ["docx", "odt"];
/// I byte con cui comincia un JPEG (`SOI` e il marcatore dopo).
const JPEG_START: [u8; 3] = [0xFF, 0xD8, 0xFF];
/// Il BOM UTF-8 che a volte precede le relazioni.
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// Perché un pacchetto non dà la sua miniatura. Senza testi: la frase per chi
/// guarda la sceglie chi riceve l'errore.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OfficeError {
    /// Non è uno ZIP leggibile (un documento cifrato, un `.doc` rinominato).
    NotZip,
    /// La directory centrale, o le relazioni, superano il loro tetto.
    TooLarge,
    /// Le relazioni non sono un XML leggibile.
    BadRelationships,
}

impl From<ContainerError> for OfficeError {
    fn from(error: ContainerError) -> Self {
        match error {
            ContainerError::TooLarge | ContainerError::OverLimit => OfficeError::TooLarge,
            _ => OfficeError::NotZip,
        }
    }
}

/// Dice se un documento con l'estensione `ext`, senza il punto, è un
/// pacchetto ZIP che può portare una miniatura (`.docx`, `.odt`). Come
/// [`PreviewSubject::of_extension`](crate::contract::PreviewSubject::of_extension),
/// senza badare al maiuscolo ASCII (`RELAZIONE.DOCX`).
pub fn is_package_extension(ext: &str) -> bool {
    PACKAGE_EXTENSIONS
        .iter()
        .any(|known| known.eq_ignore_ascii_case(ext))
}

/// La miniatura del pacchetto lungo `len` byte, letta da `reader` a pezzi:
/// la coda, la directory centrale e le voci che servono, qualunque sia il
/// peso del file.
///
/// `Ok(None)` quando il pacchetto non ne porta una che si possa mostrare: la
/// relazione o la voce mancano, la voce è vuota, non è un PNG o un JPEG, non
/// si legge o supera [`MAX_THUMBNAIL_BYTES`], il bersaglio è rifiutato. Un
/// file che non è uno ZIP è [`OfficeError::NotZip`]; relazioni oltre
/// [`MAX_RELATIONSHIPS_BYTES`] sono [`OfficeError::TooLarge`], e rotte
/// [`OfficeError::BadRelationships`]. Un errore di `reader` diventa un errore
/// del pacchetto: chi legge da un file che può cambiare guarda i suoi errori
/// di lettura prima del risultato.
pub fn embedded_thumbnail<R: Read + Seek>(
    reader: &mut R,
    len: u64,
) -> Result<Option<PreviewImage>, OfficeError> {
    let mut package = Package::open(reader, len)?;
    let relationships = package.entry(OOXML_RELATIONSHIPS, MAX_RELATIONSHIPS_BYTES)?;
    if let Some(relationships) = relationships {
        if let Some(target) = thumbnail_target(&relationships)? {
            if let Some(image) = package.thumbnail(&target) {
                return Ok(Some(image));
            }
        }
    }
    Ok(package.thumbnail(ODF_THUMBNAIL))
}

/// Il nome della voce della prima relazione di tipo [`OOXML_THUMBNAIL_TYPE`]
/// nelle relazioni `bytes`, se è interna e il bersaglio è accettato
/// ([`part_name`]). Solo la prima: un pacchetto ne ha al più una, e quando la
/// prima non vale non se ne cerca un'altra.
pub fn thumbnail_target(bytes: &[u8]) -> Result<Option<String>, OfficeError> {
    if bytes.len() > MAX_RELATIONSHIPS_BYTES {
        return Err(OfficeError::TooLarge);
    }
    let bytes = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    loop {
        let event = reader
            .read_event()
            .map_err(|_| OfficeError::BadRelationships)?;
        match event {
            Event::Start(start) | Event::Empty(start)
                if start.local_name().as_ref() == b"Relationship" =>
            {
                let relationship = relationship_of(&start)?;
                if relationship.kind.as_deref() == Some(OOXML_THUMBNAIL_TYPE) {
                    if relationship.external {
                        return Ok(None);
                    }
                    return Ok(relationship.target.as_deref().and_then(part_name));
                }
            }
            Event::Eof => return Ok(None),
            _ => {}
        }
    }
}

/// Il nome di voce di un bersaglio di relazione: senza la `/` in testa, e
/// `None` per un nome vuoto, con una `\`, o con un segmento vuoto, `.` o
/// `..`. È solo il nome di una voce dello ZIP, che si cerca così com'è.
pub fn part_name(target: &str) -> Option<String> {
    let name = target.strip_prefix('/').unwrap_or(target);
    if name.is_empty() || name.contains('\\') {
        return None;
    }
    if name
        .split('/')
        .any(|segment| matches!(segment, "" | "." | ".."))
    {
        return None;
    }
    Some(name.to_owned())
}

/// Ciò che serve di una relazione.
struct Relationship {
    kind: Option<String>,
    target: Option<String>,
    external: bool,
}

/// Il tipo, il bersaglio e il modo di una `Relationship`, coi valori
/// normalizzati come vuole XML e le sole entità predefinite.
fn relationship_of(start: &BytesStart<'_>) -> Result<Relationship, OfficeError> {
    let mut relationship = Relationship {
        kind: None,
        target: None,
        external: false,
    };
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| OfficeError::BadRelationships)?;
        let key = attribute.key.local_name();
        if !matches!(key.as_ref(), b"Type" | b"Target" | b"TargetMode") {
            continue;
        }
        let value = attribute
            .normalized_value_with(XmlVersion::Implicit1_0, 1, resolve_predefined_entity)
            .map_err(|_| OfficeError::BadRelationships)?
            .into_owned();
        match key.as_ref() {
            b"Type" => relationship.kind = Some(value),
            b"Target" => relationship.target = Some(value),
            _ => relationship.external = value == "External",
        }
    }
    Ok(relationship)
}

/// L'immagine dei byte di una miniatura, se sono un PNG o un JPEG con misure
/// lecite. Un JPEG si mostra così com'è (orientamento 1): un pacchetto non ne
/// dichiara un altro.
fn image_of(bytes: &[u8]) -> Option<PreviewImage> {
    if bytes.starts_with(&PNG_SIGNATURE) {
        PreviewImage::from_png(bytes)
    } else if bytes.starts_with(&JPEG_START) {
        PreviewImage::from_jpeg(bytes, 1)
    } else {
        None
    }
}

/// Un pacchetto aperto a pezzi, con il tetto sui byte che `zip` legge.
struct Package<R> {
    archive: ZipArchive<Budgeted<R>>,
    budget: Budget,
}

impl<R: Read + Seek> Package<R> {
    /// La coda guardata, poi l'archivio aperto con il tetto della directory
    /// dichiarata, come lo ZIP di un file Craft.
    fn open(mut reader: R, len: u64) -> Result<Self, OfficeError> {
        let tail = zip_tail::check(&mut reader, len)?;
        let budget = Budget::default();
        let open = tail
            .central_directory
            .checked_add(OPEN_SLACK)
            .ok_or(OfficeError::TooLarge)?;
        budget.arm(open);
        // `Known(0)`: senza, `zip` cerca l'inizio dell'archivio leggendo il
        // file dall'inizio alla directory.
        let config = Config {
            archive_offset: ArchiveOffset::Known(0),
        };
        let archive = ZipArchive::with_config(config, Budgeted::new(reader, budget.clone()))
            .map_err(|_| OfficeError::from(over_budget(&budget, ContainerError::NotZip)))?;
        if archive.len() > MAX_ZIP_ENTRIES {
            return Err(OfficeError::TooLarge);
        }
        Ok(Package { archive, budget })
    }

    /// I byte della voce `name`, al più `limit`, con il tetto riarmato.
    fn entry(&mut self, name: &str, limit: usize) -> Result<Option<Vec<u8>>, ContainerError> {
        self.budget
            .arm((limit as u64).saturating_mul(2).saturating_add(ENTRY_SLACK));
        read_entry(&mut self.archive, name, limit).map_err(|error| over_budget(&self.budget, error))
    }

    /// La miniatura nella voce `name`, se si legge ed è un'immagine.
    fn thumbnail(&mut self, name: &str) -> Option<PreviewImage> {
        let bytes = self.entry(name, MAX_THUMBNAIL_BYTES).ok()??;
        image_of(&bytes)
    }
}
