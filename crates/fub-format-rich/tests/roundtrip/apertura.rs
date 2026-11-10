//! Apertura e salvataggio: le modifiche di testo, e ciò che la proiezione non
//! porta e non deve perdere.

use super::*;

#[test]
fn si_apre_con_ruoli_enfasi_e_oggetti() {
    let p = projection(&bytes(&sample()));
    let roles: Vec<Role> = p
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Para(para) => Some(para.role),
            Block::Table(_) => None,
        })
        .collect();
    assert_eq!(
        roles,
        [
            Role::Heading { level: 1 },
            Role::Body,
            Role::List {
                ordered: false,
                level: 0
            },
            Role::List {
                ordered: false,
                level: 0
            },
            Role::Body,
        ]
    );
    let Block::Para(prose) = &p.blocks[1] else {
        panic!()
    };
    let strong = prose.c.iter().find_map(|i| match i {
        Inline::Text { x, m, .. } if x == "forte" => Some(m.clone()),
        _ => None,
    });
    assert_eq!(strong, Some(vec![Mark::B]));
    assert!(prose.c.iter().any(|i| matches!(i, Inline::Text { x, href: Some(h), .. } if x == "link" && h == "https://fub.app")));
    let Block::Para(figure) = &p.blocks[5] else {
        panic!()
    };
    assert!(matches!(&figure.c[0], Inline::Atom { label, .. } if label == "Un pixel"));
    assert!(matches!(figure.c.last(), Some(Inline::Atom { .. })));
}

#[test]
fn una_proiezione_non_toccata_non_scrive() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(
        save(Codec::Docx, &file, &opened.projection),
        Ok(Saved::Unchanged)
    );
}

#[test]
fn cambiare_una_parola_lascia_il_resto_com_era() {
    let file = bytes(&sample());
    let before = read(&file);
    let mut p = projection(&file);
    let para = para_mut(&mut p, 1);
    let Inline::Text { x, .. } = &mut para.c[0] else {
        panic!()
    };
    *x = "Una prosa nuova ".into();

    let after = read(&saved(&file, &p));
    let changed = paragraph(&after, 1);
    assert_eq!(changed.plain_text(), "Una prosa nuova forte con un link.");
    let original = paragraph(&before, 1);
    assert_eq!(
        changed.props, original.props,
        "le proprietà del paragrafo restano"
    );
    assert_eq!(
        changed.runs[0].props, original.runs[0].props,
        "il tratto tiene font e corpo"
    );
    assert_eq!(changed.runs.len(), original.runs.len());
    for i in [0, 2, 3, 4] {
        assert_eq!(after.body[i], before.body[i], "il blocco {i} non cambia");
    }
    assert_eq!(after.styles, before.styles);
    assert_eq!(after.parts, before.parts);
    assert_eq!(after.media, before.media);
}

/// Un `.docx` scritto a mano, con il solo documento principale.
fn package(body: &str) -> Vec<u8> {
    use std::io::Write;
    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
    let types = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr/></w:body></w:document>"#
    );
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in [
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", rels.as_bytes()),
        ("word/document.xml", document.as_bytes()),
    ] {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// La parte principale di un `.docx`, come testo.
fn main_part(bytes: &[u8]) -> String {
    use std::io::Read;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut out = String::new();
    zip.by_name("word/document.xml")
        .unwrap()
        .read_to_string(&mut out)
        .unwrap();
    out
}

/// La disposizione asiatica di un tratto non passa dalla proiezione: resta
/// con le proprietà opache del tratto che l'utente ha cambiato. Un testo che
/// arriva senza quelle proprietà la perderebbe, e il salvataggio si rifiuta
/// invece di perderla.
#[test]
fn ciò_che_la_proiezione_non_porta_non_si_perde_nel_paragrafo_cambiato() {
    let file = package(
        r#"<w:p><w:r><w:rPr><w:eastAsianLayout w:id="1" w:combine="1"/></w:rPr><w:t>Primo paragrafo</w:t></w:r></w:p>"#,
    );
    let mut p = projection(&file);
    let Some(Inline::Text { x, .. }) = para_mut(&mut p, 0).c.first_mut() else {
        panic!("il paragrafo comincia col testo")
    };
    x.push_str(" modificato");
    let out = saved(&file, &p);
    let xml = main_part(&out);
    assert!(xml.contains("Primo paragrafo modificato"), "{xml}");
    assert!(xml.contains(r#"w:combine="1""#), "{xml}");

    let Some(Inline::Text { k, .. }) = para_mut(&mut p, 0).c.first_mut() else {
        panic!("il paragrafo comincia col testo")
    };
    *k = None;
    assert_eq!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Err(RichError::Fidelity)
    );
}
