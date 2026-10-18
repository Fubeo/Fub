//! I formati che WordCraft importa — OpenDocument, RTF, Word 97-2003 — si
//! leggono come un `.docx`, per la ricerca, l'outline e il correttore, e non si
//! scrivono: l'importatore lascia indietro ciò che non conosce.

mod common;

use common::{sample, styled, text};
use fub_abi::{DocumentSource, FormatProvider, ParseContext};
use fub_format_rich::projection::{Block, Inline, Projection};
use fub_format_rich::{blank, open, save, Codec, ReadOnly, RichError, RichProvider};
use wordcraft_doc::{para_block, CharProps, Document};

fn plain() -> Document {
    let mut d = Document::new();
    d.body = vec![
        para_block(styled("Il titolo", "Heading1")),
        para_block(text("Una prosa semplice.", CharProps::default())),
    ];
    d
}

fn odt(document: &Document) -> Vec<u8> {
    wordcraft_formats::odt::export(document).unwrap()
}

fn rtf(document: &Document) -> Vec<u8> {
    wordcraft_formats::rtf::export(document).into_bytes()
}

fn projection(codec: Codec, bytes: &[u8]) -> (Projection, Option<ReadOnly>) {
    let opened = open(codec, bytes).unwrap();
    (
        Projection::from_json(&opened.projection).unwrap(),
        opened.readonly,
    )
}

fn words(projection: &Projection) -> String {
    let mut out = String::new();
    for block in &projection.blocks {
        if let Block::Para(para) = block {
            for inline in &para.c {
                if let Inline::Text { x, .. } = inline {
                    out.push_str(x);
                }
            }
            out.push('\n');
        }
    }
    out
}

/// Un contenitore OLE con i soli flussi che lo dicono cifrato.
fn encrypted_container() -> Vec<u8> {
    use std::io::Write;
    let mut comp = cfb::CompoundFile::create(std::io::Cursor::new(Vec::new())).unwrap();
    for name in ["/EncryptionInfo", "/EncryptedPackage"] {
        comp.create_stream(name)
            .unwrap()
            .write_all(&[0; 16])
            .unwrap();
    }
    comp.flush().unwrap();
    comp.into_inner().into_inner()
}

#[test]
fn an_odt_opens_readable_and_read_only() {
    let bytes = odt(&sample());
    let (projection, readonly) = projection(Codec::Odt, &bytes);
    assert_eq!(readonly, Some(ReadOnly::Import));
    assert_eq!(projection.readonly, Some(ReadOnly::Import));
    let words = words(&projection);
    for expected in ["Il titolo", "Una prosa forte con un link.", "prima voce"] {
        assert!(words.contains(expected), "manca «{expected}» in {words:?}");
    }
}

#[test]
fn an_odt_is_never_written() {
    let bytes = odt(&plain());
    let opened = open(Codec::Odt, &bytes).unwrap();
    // Anche togliendo il campo dalla proiezione, è il file a dire di no.
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    projection.readonly = None;
    assert_eq!(
        save(Codec::Odt, &bytes, &projection.to_json().unwrap()),
        Err(RichError::ReadOnly(ReadOnly::Import))
    );
    assert_eq!(blank(Codec::Odt), Err(RichError::NoWriter("odt")));
}

#[test]
fn an_rtf_written_by_hand_is_read_only() {
    let bytes = br"{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}\pard Ciao {\b mondo}.\par}";
    let (projection, readonly) = projection(Codec::Rtf, bytes);
    assert_eq!(readonly, Some(ReadOnly::Import));
    assert!(words(&projection).contains("Ciao mondo."));
}

#[test]
fn an_rtf_is_never_written() {
    let bytes = rtf(&plain());
    assert_eq!(projection(Codec::Rtf, &bytes).1, Some(ReadOnly::Import));
    let opened = open(Codec::Rtf, &bytes).unwrap();
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    projection.readonly = None;
    assert_eq!(
        save(Codec::Rtf, &bytes, &projection.to_json().unwrap()),
        Err(RichError::ReadOnly(ReadOnly::Import))
    );
    assert_eq!(blank(Codec::Rtf), Err(RichError::NoWriter("rtf")));
}

#[test]
fn a_doc_is_read_by_its_signature() {
    // Un RTF o un `.docx` rinominati in `.doc` si leggono lo stesso, e in sola
    // lettura: il codec Word 97-2003 non scrive.
    let (projection, readonly) = projection(Codec::Doc, &rtf(&plain()));
    assert_eq!(readonly, Some(ReadOnly::Import));
    assert!(words(&projection).contains("Una prosa semplice."));
    let docx = wordcraft_docx::write(&plain()).unwrap();
    let (projection, readonly) = self::projection(Codec::Doc, &docx);
    assert_eq!(readonly, Some(ReadOnly::Import));
    assert!(words(&projection).contains("Il titolo"));
    assert_eq!(blank(Codec::Doc), Err(RichError::NoWriter("doc")));
}

#[test]
fn a_doc_that_is_not_one_is_a_codec_error() {
    assert!(matches!(
        open(Codec::Doc, b"non sono un documento"),
        Err(RichError::Codec(_))
    ));
}

#[test]
fn an_encrypted_doc_says_so() {
    assert_eq!(
        open(Codec::Doc, &encrypted_container()),
        Err(RichError::Encrypted)
    );
}

#[test]
fn every_codec_has_its_format_and_extensions() {
    for codec in Codec::ALL {
        assert_eq!(Codec::of_format(codec.format_id()), Some(codec));
    }
    let extensions = |codec| RichProvider::new(codec).descriptor().extensions;
    assert_eq!(extensions(Codec::Odt), ["odt"]);
    assert_eq!(extensions(Codec::Rtf), ["rtf"]);
    assert_eq!(extensions(Codec::Doc), ["doc", "dot"]);
}

#[test]
fn an_odt_feeds_the_common_model() {
    let provider = RichProvider::new(Codec::Odt);
    let model = provider
        .parse(
            &DocumentSource::Bytes(odt(&plain())),
            &ParseContext::default(),
        )
        .unwrap();
    assert_eq!(model.outline.len(), 1, "il titolo entra nell'outline");
}
