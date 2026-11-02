//! Gli XMP che LightCraft scrive accanto a una foto: voto, etichetta, scelta e
//! parole chiave, letti per diventare proprietà e tag di Fub.
//!
//! Le regolazioni (`crs:*`, `lc:settings`) non si leggono mai, e Fub non
//! scrive mai un XMP.
//!
//! Le funzioni sono ancora scheletri che danno il valore vuoto.

use fub_abi::model::{DocId, DocumentModel};
use fub_abi::ParseContext;
use serde::{Deserialize, Serialize};

/// L'XMP più grande che si legge.
pub const MAX_XMP_BYTES: usize = 8 * 1024 * 1024;
/// Le parole chiave al massimo di un XMP.
pub const MAX_KEYWORDS: usize = 500;

/// Ciò che un XMP dice della sua foto.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PhotoMeta {
    /// Il voto, da -1 (scartata) a 5.
    pub rating: Option<i8>,
    /// L'etichetta di colore, non vuota.
    pub label: Option<String>,
    /// La scelta; `lc:flag="none"` è `None`.
    pub flag: Option<Flag>,
    /// Le parole chiave di `dc:subject`, senza doppioni, nell'ordine del file.
    pub keywords: Vec<String>,
}

/// La scelta di una foto. In JSON `"pick"` o `"reject"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Flag {
    Pick,
    Reject,
}

/// Perché un XMP non si legge. Senza testi.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum XmpError {
    /// Non è un XML leggibile.
    NotXml,
    /// Supera [`MAX_XMP_BYTES`].
    TooLarge,
}

/// La foto a cui un XMP appartiene, detta dal suo nome: chi guarda il vault
/// sceglie fra i file che ci sono.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PhotoMatch {
    /// `IMG_0001.CR3.xmp`: la foto è esattamente `IMG_0001.CR3`.
    Exact(String),
    /// `IMG_0001.xmp`: la foto è un file accanto che si chiama
    /// `IMG_0001.<ext>`, con un'estensione diversa da quella dell'XMP.
    Stem(String),
}

/// Legge voto, etichetta, scelta e parole chiave.
///
/// Scheletro: dà i metadati vuoti.
pub fn read(bytes: &[u8]) -> Result<PhotoMeta, XmpError> {
    let _ = bytes;
    Ok(PhotoMeta::default())
}

/// Il modello del documento di un XMP: proprietà, tag e testo. Un XMP rotto dà
/// il modello vuoto.
///
/// Scheletro: dà il modello vuoto.
pub fn document_model(ctx: &ParseContext, bytes: &[u8]) -> DocumentModel {
    let _ = bytes;
    DocumentModel::empty(DocId::new(ctx.doc_id.clone()))
}

/// La foto che il nome dell'XMP indica.
///
/// Scheletro: dà un gambo vuoto, che non nomina nessun file.
pub fn photo_candidates(xmp_name: &str) -> PhotoMatch {
    let _ = xmp_name;
    PhotoMatch::Stem(String::new())
}

/// Il nome della copia che PhotoCraft crea con «Modifica in PhotoCraft»:
/// `IMG_0001.CR3` → `IMG_0001-Edit.psd`.
///
/// Scheletro: dà il nome vuoto.
pub fn edit_copy_of(photo: &str) -> String {
    let _ = photo;
    String::new()
}
