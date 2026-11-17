//! L'anteprima di una foto RAW: il JPEG che la fotocamera ha messo dentro il
//! file, letto a pezzi.

use std::io::{self, Read, Seek};

use fub_format_craft::raw::{embedded_jpegs, read_jpeg, RawError};
use fub_format_craft::{CraftPreview, Missing, PreviewImage, PreviewOrigin, PreviewSize};

/// Completa `preview` di una foto RAW quando non se ne possono leggere i
/// pezzi: il file non porta un'anteprima.
pub(super) fn read(preview: &mut CraftPreview) {
    preview.missing = Some(Missing::Absent);
}

/// Completa `preview` di una foto RAW lunga `len` leggendo da `reader` solo
/// le strutture del file e il JPEG scelto per `size`. La revisione resta
/// `None`: senza tutti i byte non se ne sa l'impronta. Un errore di lettura
/// torna a chi chiama, che sa se il file è cambiato nel frattempo.
pub(super) fn read_from<R: Read + Seek>(
    preview: &mut CraftPreview,
    reader: &mut R,
    len: u64,
    size: PreviewSize,
) -> io::Result<()> {
    preview.revision = None;
    let found = match embedded_jpegs(reader, len) {
        Ok(found) => found,
        Err(RawError::Io(error)) => return Err(error),
        Err(_) => {
            unreadable(preview);
            return Ok(());
        }
    };
    let Some(range) = found.pick(size) else {
        preview.image = None;
        preview.origin = PreviewOrigin::None;
        preview.missing = Some(Missing::Absent);
        return Ok(());
    };
    let bytes = match read_jpeg(reader, &range) {
        Ok(bytes) => bytes,
        Err(RawError::Io(error)) => return Err(error),
        Err(_) => {
            unreadable(preview);
            return Ok(());
        }
    };
    match PreviewImage::from_jpeg(&bytes, found.orientation) {
        Some(image) => {
            preview.image = Some(image);
            preview.origin = PreviewOrigin::File;
            preview.missing = None;
        }
        None => unreadable(preview),
    }
    Ok(())
}

fn unreadable(preview: &mut CraftPreview) {
    preview.image = None;
    preview.origin = PreviewOrigin::None;
    preview.missing = Some(Missing::Unreadable);
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, SeekFrom};

    use fub_abi::model::DocId;
    use fub_format_craft::PreviewSubject;

    use super::*;

    fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![0xFF, marker];
        out.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    fn jpeg(width: u16, height: u16) -> Vec<u8> {
        let mut sof = vec![8];
        sof.extend_from_slice(&height.to_be_bytes());
        sof.extend_from_slice(&width.to_be_bytes());
        sof.extend_from_slice(&[1, 1, 0x11, 0]);
        let mut out = vec![0xFF, 0xD8];
        out.extend_from_slice(&segment(0xC0, &sof));
        out.extend_from_slice(&segment(0xDA, &[1, 1, 0, 0, 63, 0]));
        out.extend_from_slice(&[0x55; 16]);
        out.extend_from_slice(&[0xFF, 0xD9]);
        out
    }

    /// Un TIFF `II` con IFD0 (orientamento 6, il JPEG grande) e IFD1 (la
    /// miniatura).
    fn nef() -> (Vec<u8>, Vec<u8>) {
        let big = jpeg(1620, 1080);
        let small = jpeg(160, 120);
        let entry = |tag: u16, kind: u16, value: u32| {
            let mut out = tag.to_le_bytes().to_vec();
            out.extend_from_slice(&kind.to_le_bytes());
            out.extend_from_slice(&1u32.to_le_bytes());
            out.extend_from_slice(&value.to_le_bytes());
            out
        };
        let mut bytes = b"II\x2a\0\x08\0\0\0".to_vec();
        bytes.extend_from_slice(&3u16.to_le_bytes());
        bytes.extend(entry(0x0112, 3, 6));
        bytes.extend(entry(0x0201, 4, 200));
        bytes.extend(entry(0x0202, 4, big.len() as u32));
        bytes.extend_from_slice(&100u32.to_le_bytes());
        bytes.resize(100, 0);
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend(entry(0x0201, 4, 400));
        bytes.extend(entry(0x0202, 4, small.len() as u32));
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.resize(200, 0);
        bytes.extend_from_slice(&big);
        bytes.resize(400, 0);
        bytes.extend_from_slice(&small);
        (bytes, big)
    }

    fn blank() -> CraftPreview {
        super::super::empty(
            &DocId::new("Foto/a.NEF"),
            None,
            PreviewSize::Small,
            PreviewSubject::Raw,
            0,
        )
    }

    #[test]
    fn a_raw_gives_the_jpeg_inside_it_with_its_orientation() {
        let (bytes, big) = nef();
        for size in [PreviewSize::Small, PreviewSize::Large] {
            let mut preview = blank();
            read_from(
                &mut preview,
                &mut Cursor::new(&bytes),
                bytes.len() as u64,
                size,
            )
            .unwrap();
            let image = preview.image.unwrap();
            assert_eq!(image.media_type, "image/jpeg");
            assert_eq!(
                (image.width, image.height, image.orientation),
                (1620, 1080, 6)
            );
            assert_eq!(
                image.data,
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &big)
            );
            assert_eq!(preview.origin, PreviewOrigin::File);
            assert_eq!(preview.missing, None);
            assert_eq!(preview.revision, None);
        }
    }

    #[test]
    fn a_raw_without_a_jpeg_is_absent_and_a_broken_one_unreadable() {
        let empty = b"II\x2a\0\x08\0\0\0\0\0\0\0\0\0".to_vec();
        let mut preview = blank();
        read_from(
            &mut preview,
            &mut Cursor::new(&empty),
            empty.len() as u64,
            PreviewSize::Small,
        )
        .unwrap();
        assert_eq!(preview.missing, Some(Missing::Absent));
        assert!(preview.image.is_none());
        for broken in [b"RAW finto".to_vec(), b"II\x2a\0\x08\0\0\0\x08\0".to_vec()] {
            let mut preview = blank();
            read_from(
                &mut preview,
                &mut Cursor::new(&broken),
                broken.len() as u64,
                PreviewSize::Small,
            )
            .unwrap();
            assert_eq!(preview.missing, Some(Missing::Unreadable));
            assert_eq!(preview.origin, PreviewOrigin::None);
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
        let mut preview = blank();
        let error = read_from(&mut preview, &mut Broken, 1000, PreviewSize::Large).unwrap_err();
        assert_eq!(error.to_string(), "rotto");
    }
}
