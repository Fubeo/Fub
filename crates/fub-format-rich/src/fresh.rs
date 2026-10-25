//! Gli oggetti nuovi della proiezione: un'immagine con i suoi byte e una nota
//! con il suo testo. Le regole che li accettano sono le stesse per ogni
//! formato; come si scrivono lo decide il formato.
//!
//! Finché la shell tiene il proprio buffer, un oggetto nuovo resta nuovo e
//! ogni salvataggio lo scrive di nuovo: per questo il nome di un'immagine
//! nuova viene dai suoi byte, e la stessa immagine non si scrive due volte.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::RichError;

/// L'immagine nuova più pesante che si accetta.
pub const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
/// Il lato più lungo di un'immagine nuova, in punti: 22 pollici, la pagina
/// più grande di Word.
pub const MAX_IMAGE_PT: f32 = 1584.0;
/// Il testo più lungo di una nota nuova, in byte.
pub const MAX_NOTE_BYTES: usize = 64 * 1024;

/// Un'immagine nuova, già controllata.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Image {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub mime: &'static str,
    /// La misura, in punti.
    pub w: f32,
    pub h: f32,
}

impl Image {
    /// Il nome del file nel pacchetto, dai byte: la stessa immagine ha sempre
    /// lo stesso nome. L'impronta è l'FNV-1a di `fub_abi`, stabile fra le
    /// versioni come serve a un nome su disco.
    pub fn name(&self) -> String {
        format!(
            "fub-{:016x}.{}",
            fub_abi::Fnv1a::hash(&self.bytes),
            self.ext
        )
    }
}

/// L'immagine nuova di un oggetto della proiezione.
pub(crate) fn image(data: &str, w: Option<f32>, h: Option<f32>) -> Result<Image, RichError> {
    // Il base64 pesa quattro terzi dei byte: oltre, non serve decodificarlo.
    if data.len() > MAX_IMAGE_BYTES / 3 * 4 + 4 {
        return Err(RichError::Malformed("a new image too large".into()));
    }
    let bytes = STANDARD
        .decode(data)
        .map_err(|error| RichError::Malformed(format!("a new image: {error}")))?;
    let (ext, mime) = sniff(&bytes)
        .ok_or_else(|| RichError::Malformed("a new image that is not PNG, JPEG or GIF".into()))?;
    let size = |v: Option<f32>| v.filter(|v| v.is_finite() && *v > 0.0 && *v <= MAX_IMAGE_PT);
    let (Some(w), Some(h)) = (size(w), size(h)) else {
        return Err(RichError::Malformed("a new image without a size".into()));
    };
    Ok(Image {
        bytes,
        ext,
        mime,
        w,
        h,
    })
}

/// Il testo di una nota nuova: una riga di testo, senza caratteri di
/// controllo che il paragrafo leggerebbe come salti o oggetti.
pub(crate) fn note(text: &str) -> Result<&str, RichError> {
    if text.len() > MAX_NOTE_BYTES {
        return Err(RichError::Malformed("a new note too long".into()));
    }
    if text
        .chars()
        .any(|c| c.is_control() || c == wordcraft_doc::para::OBJ)
    {
        return Err(RichError::Malformed(
            "a new note with control characters".into(),
        ));
    }
    Ok(text)
}

/// Il testo di un commento nuovo, una riga per paragrafo, con le stesse
/// regole di una nota.
pub(crate) fn comment(text: &str) -> Result<impl Iterator<Item = &str>, RichError> {
    if text.len() > MAX_NOTE_BYTES {
        return Err(RichError::Malformed("a new comment too long".into()));
    }
    if text
        .chars()
        .any(|c| (c.is_control() && c != '\n') || c == wordcraft_doc::para::OBJ)
    {
        return Err(RichError::Malformed(
            "a new comment with control characters".into(),
        ));
    }
    Ok(text.split('\n'))
}

/// Il tipo di un'immagine dai suoi primi byte: PNG, JPEG o GIF.
pub(crate) fn sniff(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("jpeg", "image/jpeg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn un_immagine_nuova_si_riconosce_dai_byte() {
        let data = STANDARD.encode(PNG);
        let got = image(&data, Some(72.0), Some(36.0)).unwrap();
        assert_eq!((got.ext, got.mime), ("png", "image/png"));
        assert_eq!(
            got.name(),
            image(&data, Some(1.0), Some(1.0)).unwrap().name()
        );
        assert!(got.name().starts_with("fub-") && got.name().ends_with(".png"));
        assert!(image(&STANDARD.encode(b"<svg/>"), Some(1.0), Some(1.0)).is_err());
        assert!(image(&data, None, Some(1.0)).is_err());
        assert!(image(&data, Some(f32::NAN), Some(1.0)).is_err());
        assert!(image(&data, Some(MAX_IMAGE_PT + 1.0), Some(1.0)).is_err());
        assert!(image("non è base64", Some(1.0), Some(1.0)).is_err());
    }

    #[test]
    fn il_testo_di_una_nota_nuova_è_una_riga() {
        assert_eq!(note("Vedi sopra.").unwrap(), "Vedi sopra.");
        assert!(note("a\nb").is_err());
        assert!(note("a\u{c}b").is_err());
        assert!(note(&"x".repeat(MAX_NOTE_BYTES + 1)).is_err());
    }
}
