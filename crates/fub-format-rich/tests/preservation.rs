//! Ciò che il codec non sa riscrivere non si perde in silenzio: un `.docx` con
//! markup che il motore salterebbe si apre in sola lettura, e un salvataggio
//! che perderebbe qualcosa non scrive. Le prove guardano i byte del pacchetto,
//! non il modello di WordCraft, perché un oracolo che legge con lo stesso
//! lettore non vede ciò che quel lettore salta.

use std::io::{Read, Write};

use fub_format_rich::projection::{Block, Inline, Projection};
use fub_format_rich::{open, save, Codec, ReadOnly, Saved};

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="html" ContentType="text/html"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

const NO_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#;

pub fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zw.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(bytes).unwrap();
    }
    zw.finish().unwrap().into_inner()
}

fn part(bytes: &[u8], name: &str) -> Option<String> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).unwrap();
    Some(s)
}

/// Un `.docx` minimo con questo corpo e queste relazioni del documento.
fn docx(body: &str, rels: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr/></w:body></w:document>"#
    );
    let mut entries: Vec<(&str, &[u8])> = vec![
        ("[Content_Types].xml", CONTENT_TYPES.as_bytes()),
        ("_rels/.rels", ROOT_RELS.as_bytes()),
        ("word/document.xml", document.as_bytes()),
        ("word/_rels/document.xml.rels", rels.as_bytes()),
    ];
    entries.extend_from_slice(extra);
    zip(&entries)
}

/// Cambia il testo dell'ultimo paragrafo, come farebbe la shell.
fn edit_last(projection: &str) -> String {
    let mut p = Projection::from_json(projection).unwrap();
    let last = p.blocks.len() - 1;
    let Block::Para(para) = &mut p.blocks[last] else {
        panic!("l'ultimo blocco non è un paragrafo")
    };
    let Some(Inline::Text { x, .. }) = para.c.iter_mut().find(|i| matches!(i, Inline::Text { .. }))
    else {
        panic!("niente testo")
    };
    x.push_str(" modificato");
    p.to_json().unwrap()
}

/// Il contenuto importato da un'altra parte (`w:altChunk`, frequente nei file
/// generati da HTML) non si riscrive: il documento si apre in sola lettura.
#[test]
fn un_contenuto_importato_che_il_codec_perderebbe_apre_in_sola_lettura() {
    let rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/></Relationships>"#;
    let chunk: &[u8] = b"<html><body><p>CONTENUTO DEL CHUNK IMPORTATO</p></body></html>";
    let file = docx(
        r#"<w:p><w:r><w:t>Primo paragrafo</w:t></w:r></w:p><w:altChunk r:id="rIdChunk"/><w:p><w:r><w:t>Secondo paragrafo</w:t></w:r></w:p>"#,
        rels,
        &[("word/chunk.html", chunk)],
    );
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Codec));
    // E il salvataggio, anche da una proiezione a cui qualcuno ha tolto il
    // motivo, non scrive.
    let mut p = Projection::from_json(&edit_last(&opened.projection)).unwrap();
    p.readonly = None;
    assert!(save(Codec::Docx, &file, &p.to_json().unwrap()).is_err());
}

/// Una proprietà del tratto che il motore può non conoscere
/// (`w:eastAsianLayout`): la prova vale con ogni versione del motore. Se il
/// documento si apre modificabile, dopo una modifica e un salvataggio la
/// proprietà c'è ancora.
#[test]
fn una_proprietà_sconosciuta_o_si_conserva_o_apre_in_sola_lettura() {
    let file = docx(
        r#"<w:p><w:r><w:rPr><w:eastAsianLayout w:id="1" w:combine="1"/></w:rPr><w:t>Primo paragrafo</w:t></w:r></w:p><w:p><w:permStart w:id="7" w:edGrp="everyone"/><w:r><w:t>Secondo paragrafo</w:t></w:r><w:permEnd w:id="7"/></w:p>"#,
        NO_RELS,
        &[],
    );
    let opened = open(Codec::Docx, &file).unwrap();
    if opened.readonly.is_some() {
        assert_eq!(opened.readonly, Some(ReadOnly::Codec));
        return;
    }
    let out = match save(Codec::Docx, &file, &edit_last(&opened.projection)).unwrap() {
        Saved::Bytes(out) => out,
        Saved::Unchanged => panic!("la modifica non ha scritto"),
    };
    let document = part(&out, "word/document.xml").unwrap();
    for needle in ["eastAsianLayout", "permStart", "permEnd", "modificato"] {
        assert!(document.contains(needle), "{needle} perso:\n{document}");
    }
}

const IMAGE_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/foto.png"/></Relationships>"#;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n byte di una foto";

/// Un paragrafo con un'immagine in riga, che il modello tiene come oggetto.
fn image_paragraph() -> &'static str {
    r#"<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="foto.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
}

fn image_docx() -> Vec<u8> {
    let types = CONTENT_TYPES.replace(
        r#"<Default Extension="xml""#,
        r#"<Default Extension="png" ContentType="image/png"/><Default Extension="xml""#,
    );
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{}<w:p><w:r><w:t>Un altro paragrafo</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#,
        image_paragraph()
    );
    zip(&[
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", ROOT_RELS.as_bytes()),
        ("word/document.xml", document.as_bytes()),
        ("word/_rels/document.xml.rels", IMAGE_RELS.as_bytes()),
        ("word/media/foto.png", PNG),
    ])
}

fn entry(bytes: &[u8], wanted: &[u8]) -> bool {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    (0..z.len()).any(|i| {
        let mut f = z.by_index(i).unwrap();
        let mut out = Vec::new();
        f.read_to_end(&mut out).unwrap();
        out == wanted
    })
}

/// Un oggetto che l'utente non tocca resta, byte per byte, quando si modifica
/// un altro paragrafo; quando l'utente lo cancella, il salvataggio scrive
/// senza.
#[test]
fn un_oggetto_resta_finché_l_utente_non_lo_cancella() {
    let file = image_docx();
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, None);

    let Saved::Bytes(out) = save(Codec::Docx, &file, &edit_last(&opened.projection)).unwrap()
    else {
        panic!("la modifica non ha scritto")
    };
    assert!(entry(&out, PNG), "l'immagine non c'è più");
    assert!(part(&out, "word/document.xml").unwrap().contains("a:blip"));

    let mut p = Projection::from_json(&opened.projection).unwrap();
    p.blocks.remove(0);
    let Saved::Bytes(out) = save(Codec::Docx, &file, &p.to_json().unwrap()).unwrap() else {
        panic!("la cancellazione non ha scritto")
    };
    assert!(!entry(&out, PNG), "l'immagine cancellata è rimasta");
    assert!(!part(&out, "word/document.xml").unwrap().contains("a:blip"));
}
