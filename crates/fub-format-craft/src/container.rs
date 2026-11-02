//! I tre contenitori dei file Craft, letti senza il motore dell'app: il JSON
//! di VectorCraft (a volte gzip, con i blob in coda), lo ZIP di PhotoCraft
//! con `manifest.json` e lo ZIP di FigCraft con `document.json`.
//!
//! Ogni file è input ostile: le misure si controllano prima di leggere, ogni
//! lettura ha un tetto, e nessuna allocazione la decide un numero scritto nel
//! file.
//!
//! [`read_meta`] ed [`embedded_preview`] sono ancora scheletri che danno il
//! valore vuoto; [`Png`] e [`png_size`] sono già veri, perché li usa
//! [`PreviewImage::from_png`](crate::contract::PreviewImage::from_png).

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
/// Scheletro: dà i contenuti vuoti.
pub fn read_meta(app: CraftApp, bytes: &[u8]) -> Result<Contents, ContainerError> {
    let _ = (app, bytes);
    Ok(Contents::default())
}

/// L'anteprima che il file porta per la misura `size`, se c'è ed è un PNG.
///
/// Scheletro: non ne trova nessuna.
pub fn embedded_preview(
    app: CraftApp,
    bytes: &[u8],
    size: PreviewSize,
) -> Result<Option<Png>, ContainerError> {
    let _ = (app, bytes, size);
    Ok(None)
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
