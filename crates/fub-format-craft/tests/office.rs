//! Le miniature dei documenti d'ufficio (`office.rs`), contro pacchetti
//! costruiti qui con `zip::ZipWriter`: un `.docx` con la miniatura PNG, con
//! una JPEG, con una EMF e senza; un `.odt` con e senza, anche col
//! `mimetype` sbagliato; i pacchetti cattivi (relazioni di 1 MiB o di 10 000
//! voci, bersagli `../../x` e assoluti, una miniatura dichiarata che manca,
//! vuota o oltre il tetto, un documento cifrato che non è uno ZIP); e un
//! lettore che conta i byte, perché si leggano solo le voci che servono.

use std::io::{self, Cursor, Read, Seek, SeekFrom, Write};

use fub_format_craft::container::PNG_SIGNATURE;
use fub_format_craft::office::{
    embedded_thumbnail, is_package_extension, part_name, thumbnail_target, OfficeError,
    MAX_RELATIONSHIPS_BYTES, MAX_THUMBNAIL_BYTES, ODF_THUMBNAIL, OOXML_RELATIONSHIPS,
    OOXML_THUMBNAIL_TYPE,
};
use fub_format_craft::{PreviewImage, JPEG_MEDIA_TYPE, PNG_MEDIA_TYPE};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const STORE: CompressionMethod = CompressionMethod::Stored;
const DEFLATE: CompressionMethod = CompressionMethod::Deflated;

// --- I file finti -------------------------------------------------------------

/// Un PNG minimo di `width` × `height`: firma, `IHDR`, `IEND`.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = PNG_SIGNATURE.to_vec();
    out.extend_from_slice(&13u32.to_be_bytes());
    out.extend_from_slice(b"IHDR");
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
    out.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(b"IEND");
    out.extend_from_slice(&[0, 0, 0, 0]);
    out
}

fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0xFF, marker];
    out.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Un JPEG minimo di `width` × `height`: `SOI`, `SOF0`, una scansione finta,
/// `EOI`.
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

/// L'inizio di un metafile EMF: il record `EMR_HEADER` e la firma ` EMF`.
fn emf() -> Vec<u8> {
    let mut out = 1u32.to_le_bytes().to_vec();
    out.extend_from_slice(&108u32.to_le_bytes());
    out.resize(40, 0);
    out.extend_from_slice(b" EMF");
    out.resize(108, 0);
    out
}

/// Uno ZIP con le voci, nell'ordine.
fn zip_of(entries: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes, method) in entries {
        let options = SimpleFileOptions::default()
            .compression_method(*method)
            .large_file(bytes.len() > u32::MAX as usize);
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// Le relazioni di un pacchetto OOXML: il documento principale, poi le
/// relazioni `extra` così come sono.
fn rels(extra: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
         <Relationship Id=\"rId1\" \
         Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" \
         Target=\"word/document.xml\"/>{extra}</Relationships>"
    )
    .into_bytes()
}

/// Una relazione alla miniatura verso `target`.
fn thumbnail_rel(target: &str) -> String {
    format!("<Relationship Id=\"rId2\" Type=\"{OOXML_THUMBNAIL_TYPE}\" Target=\"{target}\"/>")
}

/// Un `.docx` minimo: le relazioni `relationships`, il documento e le voci
/// `extra`.
fn docx(relationships: &[u8], extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut entries: Vec<(&str, &[u8], CompressionMethod)> = vec![
        ("[Content_Types].xml", b"<Types/>", DEFLATE),
        (OOXML_RELATIONSHIPS, relationships, DEFLATE),
        ("word/document.xml", b"<w:document/>", DEFLATE),
    ];
    entries.extend(extra.iter().map(|(name, bytes)| (*name, *bytes, STORE)));
    zip_of(&entries)
}

/// Un `.odt` minimo col `mimetype` `mimetype` e le voci `extra`.
fn odt(mimetype: &[u8], extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut entries: Vec<(&str, &[u8], CompressionMethod)> = vec![
        ("mimetype", mimetype, STORE),
        ("META-INF/manifest.xml", b"<manifest/>", DEFLATE),
        ("content.xml", b"<office:document-content/>", DEFLATE),
    ];
    entries.extend(extra.iter().map(|(name, bytes)| (*name, *bytes, STORE)));
    zip_of(&entries)
}

const ODT_MIMETYPE: &[u8] = b"application/vnd.oasis.opendocument.text";

fn thumbnail_of(bytes: &[u8]) -> Result<Option<PreviewImage>, OfficeError> {
    embedded_thumbnail(&mut Cursor::new(bytes), bytes.len() as u64)
}

/// Un lettore che conta i byte che dà.
struct Counting<R> {
    inner: R,
    read: u64,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let got = self.inner.read(buf)?;
        self.read += got as u64;
        Ok(got)
    }
}

impl<R: Seek> Seek for Counting<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.inner.seek(pos)
    }
}

// --- OOXML ----------------------------------------------------------------------

#[test]
fn a_docx_gives_its_png_thumbnail() {
    let thumb = png(256, 362);
    let file = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.png")),
        &[("docProps/thumbnail.png", &thumb)],
    );
    let image = thumbnail_of(&file).unwrap().unwrap();
    assert_eq!(image.media_type, PNG_MEDIA_TYPE);
    assert_eq!(
        (image.width, image.height, image.orientation),
        (256, 362, 1)
    );
    assert_eq!(image, PreviewImage::from_png(&thumb).unwrap());
}

#[test]
fn a_docx_gives_its_jpeg_thumbnail_as_it_is() {
    let thumb = jpeg(210, 297);
    let file = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.jpeg")),
        &[("docProps/thumbnail.jpeg", &thumb)],
    );
    let image = thumbnail_of(&file).unwrap().unwrap();
    assert_eq!(image.media_type, JPEG_MEDIA_TYPE);
    assert_eq!(
        (image.width, image.height, image.orientation),
        (210, 297, 1)
    );
    assert_eq!(image, PreviewImage::from_jpeg(&thumb, 1).unwrap());
}

#[test]
fn an_emf_or_wmf_thumbnail_is_absent() {
    let wmf = [0xD7, 0xCD, 0xC6, 0x9A, 0, 0, 0, 0];
    for (name, bytes) in [
        ("docProps/thumbnail.emf", emf()),
        ("docProps/thumbnail.wmf", wmf.to_vec()),
    ] {
        let file = docx(&rels(&thumbnail_rel(name)), &[(name, &bytes)]);
        assert_eq!(thumbnail_of(&file), Ok(None), "{name}");
    }
}

#[test]
fn a_docx_without_a_thumbnail_is_absent() {
    // Nessuna relazione alla miniatura, anche se una voce col nome solito c'è.
    let file = docx(&rels(""), &[("docProps/thumbnail.png", &png(8, 8))]);
    assert_eq!(thumbnail_of(&file), Ok(None));
    // Nessuna relazione affatto.
    let bare = zip_of(&[("word/document.xml", b"<w:document/>", DEFLATE)]);
    assert_eq!(thumbnail_of(&bare), Ok(None));
}

#[test]
fn a_declared_thumbnail_that_is_missing_or_empty_is_absent() {
    let missing = docx(&rels(&thumbnail_rel("docProps/thumbnail.png")), &[]);
    assert_eq!(thumbnail_of(&missing), Ok(None));
    let empty = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.png")),
        &[("docProps/thumbnail.png", b"")],
    );
    assert_eq!(thumbnail_of(&empty), Ok(None));
    // Una PNG con la firma e misure a zero non è un'immagine.
    let zero = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.png")),
        &[("docProps/thumbnail.png", &png(0, 10))],
    );
    assert_eq!(thumbnail_of(&zero), Ok(None));
}

#[test]
fn a_thumbnail_over_eight_mib_is_absent_and_not_read_whole() {
    let mut big = png(64, 64);
    big.resize(MAX_THUMBNAIL_BYTES + 1, 0);
    // Deflate: il file è piccolo, la voce si scompatta oltre il tetto.
    let file = zip_of(&[
        (
            OOXML_RELATIONSHIPS,
            &rels(&thumbnail_rel("docProps/thumbnail.png")),
            DEFLATE,
        ),
        ("docProps/thumbnail.png", &big, DEFLATE),
    ]);
    assert_eq!(thumbnail_of(&file), Ok(None));
    // In STORE la misura dichiarata ferma la lettura prima del primo byte.
    let stored = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.png")),
        &[("docProps/thumbnail.png", &big)],
    );
    let mut counting = Counting {
        inner: Cursor::new(&stored),
        read: 0,
    };
    assert_eq!(
        embedded_thumbnail(&mut counting, stored.len() as u64),
        Ok(None)
    );
    assert!(counting.read < 1024 * 1024, "{}", counting.read);
    // Al tetto esatto si legge.
    let mut fits = png(64, 64);
    fits.resize(MAX_THUMBNAIL_BYTES, 0);
    let file = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.png")),
        &[("docProps/thumbnail.png", &fits)],
    );
    assert!(thumbnail_of(&file).unwrap().is_some());
}

#[test]
fn only_the_needed_entries_are_read() {
    let filler = vec![0x42u8; 4 * 1024 * 1024];
    let file = docx(
        &rels(&thumbnail_rel("docProps/thumbnail.png")),
        &[
            ("word/media/foto.bin", &filler),
            ("docProps/thumbnail.png", &png(32, 32)),
        ],
    );
    let mut counting = Counting {
        inner: Cursor::new(&file),
        read: 0,
    };
    let image = embedded_thumbnail(&mut counting, file.len() as u64)
        .unwrap()
        .unwrap();
    assert_eq!((image.width, image.height), (32, 32));
    assert!(counting.read < 1024 * 1024, "{}", counting.read);
}

#[test]
fn relationships_of_one_mib_are_too_large() {
    let pad = format!("<!--{}-->", "a".repeat(1024 * 1024));
    let mut relationships = rels(&thumbnail_rel("docProps/thumbnail.png"));
    relationships.splice(0..0, pad.into_bytes());
    for method in [STORE, DEFLATE] {
        let file = zip_of(&[
            (OOXML_RELATIONSHIPS, &relationships, method),
            ("docProps/thumbnail.png", &png(8, 8), STORE),
        ]);
        assert_eq!(
            thumbnail_of(&file),
            Err(OfficeError::TooLarge),
            "{method:?}"
        );
    }
    assert_eq!(
        thumbnail_target(&vec![b' '; MAX_RELATIONSHIPS_BYTES + 1]),
        Err(OfficeError::TooLarge)
    );
}

#[test]
fn ten_thousand_relationships_stop_at_the_limit_and_a_thousand_are_read() {
    let many = |count: usize| {
        let mut extra = String::new();
        for i in 0..count {
            extra.push_str(&format!(
                "<Relationship Id=\"r{i}\" Type=\"t\" Target=\"x{i}\"/>"
            ));
        }
        extra.push_str(&thumbnail_rel("docProps/thumbnail.png"));
        rels(&extra)
    };
    let ten_thousand = many(10_000);
    assert!(ten_thousand.len() > MAX_RELATIONSHIPS_BYTES);
    let file = docx(&ten_thousand, &[("docProps/thumbnail.png", &png(8, 8))]);
    assert_eq!(thumbnail_of(&file), Err(OfficeError::TooLarge));

    let thousand = many(1000);
    assert!(thousand.len() <= MAX_RELATIONSHIPS_BYTES);
    let file = docx(&thousand, &[("docProps/thumbnail.png", &png(8, 8))]);
    let image = thumbnail_of(&file).unwrap().unwrap();
    assert_eq!((image.width, image.height), (8, 8));
}

#[test]
fn a_target_out_of_the_package_is_refused_and_a_leading_slash_dropped() {
    // Il bersaglio `../../x` non si segue nemmeno quando lo ZIP ha una voce
    // con quel nome: non è mai un percorso su disco.
    let file = docx(&rels(&thumbnail_rel("../../x")), &[("../../x", &png(8, 8))]);
    assert_eq!(thumbnail_of(&file), Ok(None));
    let file = docx(
        &rels(&thumbnail_rel("/docProps/thumbnail.jpeg")),
        &[("docProps/thumbnail.jpeg", &jpeg(40, 30))],
    );
    let image = thumbnail_of(&file).unwrap().unwrap();
    assert_eq!((image.width, image.height), (40, 30));

    assert_eq!(
        part_name("/docProps/a.png").as_deref(),
        Some("docProps/a.png")
    );
    assert_eq!(
        part_name("docProps/a.png").as_deref(),
        Some("docProps/a.png")
    );
    for refused in [
        "",
        "/",
        "../../x",
        "docProps/../x",
        "docProps/./x",
        "docProps//x",
        "//server/x",
        "docProps\\x",
        "docProps/",
    ] {
        assert_eq!(part_name(refused), None, "{refused}");
    }
}

#[test]
fn an_external_thumbnail_is_not_followed_and_only_the_first_counts() {
    let external = format!(
        "<Relationship Id=\"rId2\" Type=\"{OOXML_THUMBNAIL_TYPE}\" \
         Target=\"docProps/thumbnail.png\" TargetMode=\"External\"/>"
    );
    let file = docx(&rels(&external), &[("docProps/thumbnail.png", &png(8, 8))]);
    assert_eq!(thumbnail_of(&file), Ok(None));
    // La prima relazione alla miniatura non vale: la seconda non si cerca.
    let two = format!(
        "{}{}",
        thumbnail_rel("../fuori.png"),
        thumbnail_rel("docProps/thumbnail.png")
    );
    let file = docx(&rels(&two), &[("docProps/thumbnail.png", &png(8, 8))]);
    assert_eq!(thumbnail_of(&file), Ok(None));
}

#[test]
fn relationships_with_a_bom_and_entities_are_read() {
    let mut relationships = b"\xEF\xBB\xBF".to_vec();
    relationships.extend(rels(&thumbnail_rel("docProps/a&amp;b.png")));
    let file = docx(&relationships, &[("docProps/a&b.png", &png(12, 9))]);
    let image = thumbnail_of(&file).unwrap().unwrap();
    assert_eq!((image.width, image.height), (12, 9));
}

#[test]
fn broken_relationships_are_bad() {
    for broken in [
        b"<Relationships><Relationship Type=\"x\"></Relationships>".to_vec(),
        b"<Relationships><Relationship Type=\"&nope;\"/></Relationships>".to_vec(),
    ] {
        let file = docx(&broken, &[]);
        assert_eq!(
            thumbnail_of(&file),
            Err(OfficeError::BadRelationships),
            "{}",
            String::from_utf8_lossy(&broken)
        );
    }
}

// --- ODF ------------------------------------------------------------------------

#[test]
fn an_odt_gives_its_thumbnail_or_none() {
    let with = odt(ODT_MIMETYPE, &[(ODF_THUMBNAIL, &png(198, 256))]);
    let image = thumbnail_of(&with).unwrap().unwrap();
    assert_eq!(image.media_type, PNG_MEDIA_TYPE);
    assert_eq!((image.width, image.height), (198, 256));
    let without = odt(ODT_MIMETYPE, &[]);
    assert_eq!(thumbnail_of(&without), Ok(None));
    // Una miniatura ODF che non è un PNG si scarta come in OOXML.
    let emf_bytes = emf();
    let foreign = odt(ODT_MIMETYPE, &[(ODF_THUMBNAIL, &emf_bytes)]);
    assert_eq!(thumbnail_of(&foreign), Ok(None));
}

#[test]
fn an_odt_with_the_wrong_mimetype_is_read_all_the_same() {
    for mimetype in [&b"application/zip"[..], b"", b"text/plain"] {
        let file = odt(mimetype, &[(ODF_THUMBNAIL, &png(20, 30))]);
        let image = thumbnail_of(&file).unwrap().unwrap();
        assert_eq!((image.width, image.height), (20, 30));
    }
}

// --- Ciò che non è un pacchetto ---------------------------------------------------

#[test]
fn an_encrypted_docx_or_a_non_zip_is_not_a_zip() {
    // Un `.docx` cifrato è un file composto OLE, come un `.doc`.
    let mut cfb = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    cfb.resize(4096, 0);
    for bytes in [
        cfb,
        b"{\\rtf1 testo}".to_vec(),
        Vec::new(),
        b"PK\x05\x06".to_vec(),
    ] {
        assert_eq!(thumbnail_of(&bytes), Err(OfficeError::NotZip));
    }
}

#[test]
fn the_package_extensions_ignore_ascii_case() {
    for ext in ["docx", "DOCX", "Docx", "odt", "ODT"] {
        assert!(is_package_extension(ext), "{ext}");
    }
    for ext in ["doc", "rtf", "pdf", "docx ", "xlsx", ""] {
        assert!(!is_package_extension(ext), "{ext}");
    }
}
