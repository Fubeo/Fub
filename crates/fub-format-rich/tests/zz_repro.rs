use std::io::{Read, Write};
use fub_format_rich::projection::{Block, Inline, Projection};
use fub_format_rich::{open, save, Codec, Saved};
const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
const CT: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
const RR: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (n, b) in entries { zw.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap(); zw.write_all(b).unwrap(); }
    zw.finish().unwrap().into_inner()
}
#[test]
fn repro() {
    let doc = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body><w:p><w:r><w:rPr><w:eastAsianLayout w:id="1" w:combine="1"/></w:rPr><w:t>Primo paragrafo</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#);
    let file = zip(&[("[Content_Types].xml", CT.as_bytes()), ("_rels/.rels", RR.as_bytes()), ("word/document.xml", doc.as_bytes())]);
    let opened = open(Codec::Docx, &file).unwrap();
    println!("readonly {:?}", opened.readonly);
    let mut p = Projection::from_json(&opened.projection).unwrap();
    let Block::Para(para) = &mut p.blocks[0] else { panic!() };
    let Some(Inline::Text { x, k, .. }) = para.c.iter_mut().next() else { panic!() };
    x.push_str(" modificato"); *k = None;
    match save(Codec::Docx, &file, &p.to_json().unwrap()) {
        Ok(Saved::Bytes(out)) => {
            let mut z = zip::ZipArchive::new(std::io::Cursor::new(&out)).unwrap();
            let mut s = String::new(); z.by_name("word/document.xml").unwrap().read_to_string(&mut s).unwrap();
            println!("SAVED, eastAsianLayout present: {}", s.contains("eastAsianLayout"));
        }
        other => println!("result {other:?}"),
    }
}
