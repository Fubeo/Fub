//! L'anteprima di un PDF o di un documento di testo.
//!
//! Un `.docx` o un `.odt` è un pacchetto ZIP che spesso porta la sua
//! miniatura (`office::embedded_thumbnail`): si legge a pezzi da
//! [`read_from`], come un `.pcraft`. Un PDF, un `.rtf` o un `.doc` non ne
//! portano una che Fub sappia leggere: sono `missing: absent`, e la fa l'app
//! esterna.

use std::io::{self, Read, Seek};

use fub_abi::model::DocId;
use fub_format_craft::office::{embedded_thumbnail, is_package_extension};
use fub_format_craft::{CraftPreview, Missing, PreviewOrigin};

use super::craft_files::Watched;

/// Completa `preview` di un PDF o di un documento quando non se ne possono
/// leggere i pezzi: il file non porta un'anteprima.
pub(super) fn read(preview: &mut CraftPreview) {
    preview.missing = Some(Missing::Absent);
}

/// Dice se `doc` è un pacchetto (`.docx`, `.odt`) da leggere con
/// [`read_from`]; l'estensione viene dal nome, come il soggetto.
pub(super) fn is_package(doc: &DocId) -> bool {
    let name = doc.as_str().rsplit('/').next().unwrap_or_default();
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => is_package_extension(ext),
        _ => false,
    }
}

/// Completa `preview` di un pacchetto lungo `len` leggendo da `reader` solo
/// la coda, la directory centrale, le relazioni e la miniatura. La revisione
/// resta `None`: senza tutti i byte non se ne sa l'impronta. Un file che non
/// è uno ZIP (un documento cifrato) o con le relazioni rotte è `missing:
/// unreadable`; uno senza una miniatura che si possa mostrare resta
/// `absent`. Il primo errore di `reader` torna a chi chiama, che sa se il
/// file è cambiato nel frattempo.
pub(super) fn read_from<R: Read + Seek>(
    preview: &mut CraftPreview,
    reader: &mut R,
    len: u64,
) -> io::Result<()> {
    preview.revision = None;
    let mut watched = Watched::new(reader);
    let found = embedded_thumbnail(&mut watched, len);
    if let Some(error) = watched.into_error() {
        return Err(error);
    }
    preview.image = None;
    preview.origin = PreviewOrigin::None;
    match found {
        Ok(Some(image)) => {
            preview.image = Some(image);
            preview.origin = PreviewOrigin::File;
            preview.missing = None;
        }
        Ok(None) => preview.missing = Some(Missing::Absent),
        Err(_) => preview.missing = Some(Missing::Unreadable),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, SeekFrom, Write};

    use fub_format_craft::{PreviewSize, PreviewSubject};

    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut png = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0, 0, 0, 0]);
        png
    }

    fn odt(thumbnail: Option<&[u8]>) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/vnd.oasis.opendocument.text")
            .unwrap();
        if let Some(thumbnail) = thumbnail {
            zip.start_file("Thumbnails/thumbnail.png", stored).unwrap();
            zip.write_all(thumbnail).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn blank(doc: &str) -> CraftPreview {
        super::super::empty(
            &DocId::new(doc),
            None,
            PreviewSize::Small,
            PreviewSubject::Document,
            0,
        )
    }

    #[test]
    fn a_package_gives_its_thumbnail_or_says_absent_or_unreadable() {
        let with = odt(Some(&png(30, 40)));
        let mut preview = blank("a.odt");
        read_from(&mut preview, &mut Cursor::new(&with), with.len() as u64).unwrap();
        let image = preview.image.as_ref().unwrap();
        assert_eq!((image.width, image.height), (30, 40));
        assert_eq!(preview.origin, PreviewOrigin::File);
        assert_eq!(preview.missing, None);
        assert_eq!(preview.revision, None);
        assert_eq!(preview.info.editor, "WordCraft");

        let without = odt(None);
        let mut preview = blank("a.odt");
        read_from(
            &mut preview,
            &mut Cursor::new(&without),
            without.len() as u64,
        )
        .unwrap();
        assert_eq!(preview.missing, Some(Missing::Absent));
        assert!(preview.image.is_none());

        let cfb = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0];
        let mut preview = blank("cifrato.docx");
        read_from(&mut preview, &mut Cursor::new(&cfb), cfb.len() as u64).unwrap();
        assert_eq!(preview.missing, Some(Missing::Unreadable));
        assert_eq!(preview.origin, PreviewOrigin::None);
    }

    #[test]
    fn only_docx_and_odt_are_packages() {
        for doc in ["a.docx", "Cartella/RELAZIONE.DOCX", "b.Odt"] {
            assert!(is_package(&DocId::new(doc)), "{doc}");
        }
        for doc in ["a.doc", "a.rtf", "a.pdf", ".docx", "Cartella/.odt", "docx"] {
            assert!(!is_package(&DocId::new(doc)), "{doc}");
        }
    }

    /// Un lettore che si rompe: l'errore torna a chi chiama, che decide.
    struct Broken;

    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("rotto"))
        }
    }

    impl Seek for Broken {
        fn seek(&mut self, _: SeekFrom) -> io::Result<u64> {
            Ok(0)
        }
    }

    #[test]
    fn a_read_error_goes_back_to_the_caller() {
        let mut preview = blank("a.docx");
        let error = read_from(&mut preview, &mut Broken, 1000).unwrap_err();
        assert_eq!(error.to_string(), "rotto");
    }
}
