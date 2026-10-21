//! L'innesto: un salvataggio che tocca soltanto il corpo lascia il file com'era
//! fuori dai blocchi toccati, e ogni riferimento del codec diventa quello del
//! file.

mod common;

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use base64::Engine;
use common::PNG;
use fub_format_rich::projection::{AtomKind, Block, Inline, Look, Para, Projection};
use fub_format_rich::{open, save, Codec, RichError, Saved};
use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const W14: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
const MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAIN: &str = "word/document.xml";
const MAIN_RELS: &str = "word/_rels/document.xml.rels";
const TYPES: &str = "[Content_Types].xml";

/// Una parte in più del pacchetto: nome, tipo di contenuto, tipo della
/// relazione dal documento principale e contenuto.
struct Part<'a> {
    name: &'a str,
    content_type: &'a str,
    rel: &'a str,
    xml: String,
}

/// Un `.docx` minimo con il corpo `body`, le dichiarazioni `root` sulla
/// radice e le parti `parts`.
fn package(root: &str, body: &str, parts: &[Part<'_>]) -> Vec<u8> {
    let mut types = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#,
    );
    let mut rels = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (n, part) in parts.iter().enumerate() {
        if !part.content_type.is_empty() {
            types.push_str(&format!(
                r#"<Override PartName="/word/{}" ContentType="{}"/>"#,
                part.name, part.content_type
            ));
        }
        rels.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="{REL}/{}" Target="{}"/>"#,
            n + 10,
            part.rel,
            part.name
        ));
    }
    types.push_str("</Types>");
    rels.push_str("</Relationships>");
    let root_rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}" xmlns:r="{R}"{root}><w:body>{body}<w:sectPr/></w:body></w:document>"#
    );
    let mut entries: Vec<(String, Vec<u8>)> = vec![
        (TYPES.into(), types.into_bytes()),
        ("_rels/.rels".into(), root_rels.as_bytes().to_vec()),
        (MAIN.into(), document.into_bytes()),
        (MAIN_RELS.into(), rels.into_bytes()),
    ];
    for part in parts {
        entries.push((format!("word/{}", part.name), part.xml.clone().into_bytes()));
    }
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// Le voci dello zip, per nome.
fn entries(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = BTreeMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).unwrap();
        let mut data = Vec::new();
        entry.read_to_end(&mut data).unwrap();
        out.insert(entry.name().unwrap().into_owned(), data);
    }
    out
}

fn main_part(bytes: &[u8]) -> String {
    String::from_utf8(entries(bytes).remove(MAIN).unwrap()).unwrap()
}

/// I byte di ogni figlio di `w:body`.
fn body_children(xml: &str) -> Vec<String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let (mut depth, mut start) = (0usize, 0usize);
    let mut out = Vec::new();
    loop {
        let before = reader.buffer_position() as usize;
        match reader.read_event().unwrap() {
            Event::Start(_) => {
                depth += 1;
                if depth == 3 {
                    start = before;
                }
            }
            Event::Empty(_) if depth == 2 => {
                out.push(xml[before..reader.buffer_position() as usize].to_string());
            }
            Event::End(_) => {
                if depth == 3 {
                    out.push(xml[start..reader.buffer_position() as usize].to_string());
                }
                depth -= 1;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// Ogni prefisso del documento principale è dichiarato.
fn prefixes_resolve(xml: &str) {
    let mut reader = NsReader::from_str(xml);
    loop {
        match reader.read_resolved_event().unwrap() {
            (ResolveResult::Unknown(prefix), _) => {
                panic!(
                    "prefisso non dichiarato: {}",
                    String::from_utf8_lossy(&prefix)
                )
            }
            (_, Event::Start(e) | Event::Empty(e)) => {
                for attribute in e.attributes() {
                    let attribute = attribute.unwrap();
                    if let (ResolveResult::Unknown(prefix), _) =
                        reader.resolver().resolve_attribute(attribute.key)
                    {
                        panic!(
                            "prefisso non dichiarato: {}",
                            String::from_utf8_lossy(&prefix)
                        );
                    }
                }
            }
            (_, Event::Eof) => break,
            _ => {}
        }
    }
}

/// Il salvataggio di `out` su `original` è un innesto: le voci diverse dal
/// documento principale, dalle sue relazioni e dai tipi sono gli stessi byte,
/// e i figli del corpo non toccati restano i byte del file, in ordine. Dà i
/// figli del corpo nuovo che non vengono dal file.
fn grafted(original: &[u8], out: &[u8]) -> Vec<String> {
    let (before, after) = (entries(original), entries(out));
    for (name, data) in &before {
        if [MAIN, MAIN_RELS, TYPES].contains(&name.as_str()) {
            continue;
        }
        if let Some(new) = after.get(name) {
            assert_eq!(new, data, "la voce {name} è cambiata");
        }
    }
    for name in after.keys() {
        assert!(
            before.contains_key(name) || name.starts_with("word/media/"),
            "una voce nuova: {name}"
        );
    }
    let (old_xml, new_xml) = (main_part(original), main_part(out));
    prefixes_resolve(&new_xml);
    let (old, new) = (body_children(&old_xml), body_children(&new_xml));
    // I figli del file restano, nello stesso ordine, salvo quelli toccati.
    let mut rest = Vec::new();
    let mut at = 0;
    for child in &new {
        match old[at..].iter().position(|o| o == child) {
            Some(skip) => at += skip + 1,
            None => rest.push(child.clone()),
        }
    }
    libreoffice_agrees(original, out, rest.len());
    rest
}

/// Con `FUB_SOFFICE`, il percorso di `soffice`, LibreOffice legge il file
/// innestato come il file di partenza, salvo al più `touched` paragrafi
/// consecutivi, e mostra il testo cambiato. Senza, non fa niente: la CI
/// principale non ha LibreOffice.
fn libreoffice_agrees(original: &[u8], out: &[u8], touched: usize) {
    let Some(soffice) = std::env::var_os("FUB_SOFFICE") else {
        return;
    };
    static RUN: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let run = RUN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("fub-graft-lo-{}-{run}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("prima.docx"), original).unwrap();
    std::fs::write(dir.join("dopo.docx"), out).unwrap();
    // Prima in OpenDocument, poi in testo: LibreOffice 25.8 non finisce mai
    // di scrivere in testo un .docx che chiude il corpo con una tabella, e
    // riempie il disco; dal suo .odt lo scrive.
    let convert = |to: &str, inputs: [std::path::PathBuf; 2]| {
        let mut child = std::process::Command::new(&soffice)
            .arg("--headless")
            .arg(format!(
                "-env:UserInstallation=file://{}",
                dir.join("profilo").display()
            ))
            .args(["--convert-to", to, "--outdir"])
            .arg(&dir)
            .args(inputs)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let start = std::time::Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if start.elapsed() > std::time::Duration::from_secs(120) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_dir_all(&dir);
                panic!("LibreOffice non ha finito in due minuti ({to})");
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        };
        assert!(status.success(), "LibreOffice: {status}");
    };
    convert("odt", [dir.join("prima.docx"), dir.join("dopo.docx")]);
    convert("txt:Text", [dir.join("prima.odt"), dir.join("dopo.odt")]);
    let lines = |name: &str| -> Vec<String> {
        let text = std::fs::read_to_string(dir.join(name))
            .unwrap_or_else(|error| panic!("LibreOffice non ha letto {name}: {error}"));
        text.trim_start_matches('\u{feff}')
            .lines()
            .map(str::to_string)
            .collect()
    };
    let (before, after) = (lines("prima.txt"), lines("dopo.txt"));
    let _ = std::fs::remove_dir_all(&dir);
    let head = before
        .iter()
        .zip(&after)
        .take_while(|(b, a)| b == a)
        .count();
    let tail = before[head..]
        .iter()
        .rev()
        .zip(after[head..].iter().rev())
        .take_while(|(b, a)| b == a)
        .count();
    let (changed, new) = (
        &before[head..before.len() - tail],
        &after[head..after.len() - tail],
    );
    assert!(
        changed.len() <= touched && new.len() <= touched + 1,
        "LibreOffice legge altro: {changed:#?} → {new:#?}"
    );
    let fub = texts(&projection(out)).concat();
    if fub.contains("cambiato") {
        assert!(new.concat().contains("cambiato"), "{changed:#?} → {new:#?}");
    }
}

fn projection(bytes: &[u8]) -> Projection {
    let opened = open(Codec::Docx, bytes).unwrap();
    assert_eq!(
        opened.readonly, None,
        "il documento deve essere modificabile"
    );
    Projection::from_json(&opened.projection).unwrap()
}

fn saved(bytes: &[u8], projection: &Projection) -> Vec<u8> {
    match save(Codec::Docx, bytes, &projection.to_json().unwrap()).unwrap() {
        Saved::Bytes(out) => out,
        Saved::Unchanged => panic!("il salvataggio non ha scritto niente"),
    }
}

fn para_mut(projection: &mut Projection, index: usize) -> &mut Para {
    match &mut projection.blocks[index] {
        Block::Para(para) => para,
        Block::Table(_) => panic!("il blocco {index} è una tabella"),
    }
}

/// Aggiunge `tail` al primo testo del paragrafo `index`.
fn append(projection: &mut Projection, index: usize, tail: &str) {
    let text = para_mut(projection, index)
        .c
        .iter_mut()
        .find_map(|inline| match inline {
            Inline::Text { x, .. } => Some(x),
            Inline::Atom { .. } => None,
        });
    text.expect("il paragrafo ha un testo").push_str(tail);
}

fn texts(projection: &Projection) -> Vec<String> {
    projection
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Para(para) => Some(
                para.c
                    .iter()
                    .filter_map(|inline| match inline {
                        Inline::Text { x, .. } => Some(x.as_str()),
                        Inline::Atom { .. } => None,
                    })
                    .collect(),
            ),
            Block::Table(_) => None,
        })
        .collect()
}

/// Un attributo `w:name="value"` di ogni elemento `w:tag`, in ordine.
fn values(xml: &str, tag: &str, name: &str) -> Vec<String> {
    let open = format!("<{tag} ");
    let attribute = format!("{name}=\"");
    xml.match_indices(&open)
        .filter_map(|(at, _)| {
            let element = &xml[at..at + xml[at..].find('>').unwrap()];
            let start = element.find(&attribute)? + attribute.len();
            Some(element[start..start + element[start..].find('"').unwrap()].to_string())
        })
        .collect()
}

fn para(text: &str) -> String {
    format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>")
}

/// Ogni documento modificabile del corpus, con un paragrafo cambiato, si
/// salva per innesto e si riapre modificabile con il testo nuovo.
#[test]
fn i_documenti_del_corpus_si_salvano_per_innesto() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/docx");
    let mut tried = 0;
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    names.sort();
    for path in names {
        let file = std::fs::read(&path).unwrap();
        let Ok(opened) = open(Codec::Docx, &file) else {
            continue;
        };
        if opened.readonly.is_some() {
            continue;
        }
        let mut p = Projection::from_json(&opened.projection).unwrap();
        // Il primo paragrafo con un testo che la shell lascia cambiare.
        let Some(index) = p.blocks.iter().position(|block| {
            matches!(block, Block::Para(para) if !para.locked && para.c.iter().any(|i| matches!(i, Inline::Text { x, .. } if !x.trim().is_empty())))
        }) else {
            continue;
        };
        append(&mut p, index, " e poi cambiato");
        let out = saved(&file, &p);
        let rest = grafted(&file, &out);
        assert_eq!(rest.len(), 1, "{}: {rest:#?}", path.display());
        // Niente di nuovo da nominare: le relazioni e i tipi restano i byte
        // del file.
        let (before, after) = (entries(&file), entries(&out));
        for name in [MAIN_RELS, TYPES] {
            assert_eq!(
                before.get(name),
                after.get(name),
                "{}: {name}",
                path.display()
            );
        }
        let reopened = projection(&out);
        assert_eq!(texts(&reopened), texts(&p), "{}", path.display());
        assert_eq!(
            save(Codec::Docx, &out, &p.to_json().unwrap()).unwrap(),
            Saved::Unchanged,
            "{}",
            path.display()
        );
        tried += 1;
    }
    assert!(tried >= 10, "soltanto {tried} documenti modificabili");
}

/// Un elenco toccato tiene il suo `w:numId`, anche quando il file non conta
/// gli elenchi da uno.
#[test]
fn un_elenco_toccato_tiene_il_suo_numero() {
    let numbering = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>"#
    );
    let item = |text: &str| {
        format!(
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    };
    let file = package(
        "",
        &format!("{}{}{}", para("Prima"), item("uno"), item("due")),
        &[Part {
            name: "numbering.xml",
            content_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
            rel: "numbering",
            xml: numbering,
        }],
    );
    let mut p = projection(&file);
    append(&mut p, 2, " cambiato");
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    assert_eq!(values(&rest[0], "w:numId", "w:val"), ["7"], "{}", rest[0]);
    assert_eq!(texts(&projection(&out))[2], "due cambiato");
}

/// Un paragrafo diviso in due non ripete il `w14:paraId` di un altro.
#[test]
fn i_numeri_dei_paragrafi_restano_unici() {
    let root = format!(r#" xmlns:w14="{W14}" xmlns:mc="{MC}" mc:Ignorable="w14""#);
    let numbered = |id: &str, text: &str| {
        format!(
            r#"<w:p w14:paraId="{id}" w14:textId="77777777"><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    };
    let file = package(
        &root,
        &format!(
            "{}{}{}",
            numbered("00000001", "Uno"),
            numbered("00000002", "Due parole"),
            numbered("00000003", "Tre")
        ),
        &[],
    );
    let mut p = projection(&file);
    let Block::Para(second) = p.blocks[1].clone() else {
        panic!()
    };
    let mut first = second.clone();
    if let Inline::Text { x, .. } = &mut first.c[0] {
        *x = "Due".into();
    }
    let mut rest = second;
    if let Inline::Text { x, .. } = &mut rest.c[0] {
        *x = " parole".into();
    }
    p.blocks
        .splice(1..=1, [Block::Para(first), Block::Para(rest)]);
    let out = saved(&file, &p);
    grafted(&file, &out);
    let xml = main_part(&out);
    let ids = values(&xml, "w:p", "w14:paraId");
    let mut unique = ids.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), ids.len(), "{ids:?}");
    for id in &ids {
        let value = u32::from_str_radix(id, 16).unwrap();
        assert!(value < 0x8000_0000 && id.len() == 8, "{id}");
    }
    assert_eq!(texts(&projection(&out)), ["Uno", "Due", " parole", "Tre"]);
}

/// Un segnalibro fra due paragrafi: la fine scritta di nuovo tiene il numero
/// dell'inizio che resta nel file, e il contrario.
#[test]
fn un_segnalibro_a_cavallo_resta_una_coppia() {
    let file = package(
        "",
        r#"<w:p><w:bookmarkStart w:id="5" w:name="segno"/><w:r><w:t>uno</w:t></w:r></w:p><w:p><w:r><w:t>due</w:t></w:r><w:bookmarkEnd w:id="5"/></w:p>"#,
        &[],
    );
    for touched in [0, 1] {
        let mut p = projection(&file);
        append(&mut p, touched, " cambiato");
        let out = saved(&file, &p);
        let rest = grafted(&file, &out);
        assert_eq!(rest.len(), 1, "{rest:#?}");
        let xml = main_part(&out);
        assert_eq!(values(&xml, "w:bookmarkStart", "w:id"), ["5"], "{xml}");
        assert_eq!(values(&xml, "w:bookmarkStart", "w:name"), ["segno"]);
        assert_eq!(values(&xml, "w:bookmarkEnd", "w:id"), ["5"], "{xml}");
    }
}

fn notes(notes: &[(u32, &str)]) -> String {
    let mut xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="{W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>"#
    );
    for (id, text) in notes {
        xml.push_str(&format!(
            r#"<w:footnote w:id="{id}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:footnote>"#
        ));
    }
    xml.push_str("</w:footnotes>");
    xml
}

/// Tre note uguali sono tre note: il paragrafo toccato nomina ognuna col suo
/// numero del file, nell'ordine dei riferimenti, e le note restano i byte del
/// file.
#[test]
fn le_note_si_riconoscono_per_identità_e_non_per_contenuto() {
    let reference = |id: u32| {
        format!(
            r#"<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="{id}"/></w:r>"#
        )
    };
    let body = format!(
        "<w:p><w:r><w:t>Prima</w:t></w:r>{}</w:p><w:p><w:r><w:t>Poi</w:t></w:r>{}<w:r><w:t xml:space=\"preserve\"> e ancora</w:t></w:r>{}</w:p>",
        reference(2),
        reference(3),
        reference(4),
    );
    let file = package(
        "",
        &body,
        &[Part {
            name: "footnotes.xml",
            content_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
            rel: "footnotes",
            xml: notes(&[(2, "Ivi."), (3, "Ivi."), (4, "Ivi.")]),
        }],
    );
    let mut p = projection(&file);
    append(&mut p, 1, " cambiato");
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    assert_eq!(
        values(&rest[0], "w:footnoteReference", "w:id"),
        ["3", "4"],
        "{}",
        rest[0]
    );
    assert_eq!(
        entries(&out)["word/footnotes.xml"],
        entries(&file)["word/footnotes.xml"]
    );
}

/// Un paragrafo toccato che usa uno spazio dei nomi che il codec dice
/// ignorabile lo rende ignorabile anche sulla radice del file, con la
/// dichiarazione della compatibilità se il file non l'ha.
#[test]
fn gli_spazi_dei_nomi_usati_si_dichiarano_sulla_radice() {
    // Il file dichiara `w14` senza dirlo ignorabile.
    let root = format!(r#" xmlns:w14="{W14}""#);
    let body = format!(
        r#"{}<w:p><w:r><w:rPr><w14:ligatures w14:val="standard"/></w:rPr><w:t>Due</w:t></w:r></w:p>"#,
        para("Uno")
    );
    let file = package(&root, &body, &[]);
    let mut p = projection(&file);
    append(&mut p, 1, " cambiato");
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    let xml = main_part(&out);
    let root = &xml[xml.find("<w:document").unwrap()..];
    let root = &root[..root.find('>').unwrap()];
    assert!(rest[0].contains("w14:ligatures"), "{}", rest[0]);
    assert!(root.contains(&format!(r#"xmlns:mc="{MC}""#)), "{root}");
    let at = root.find("mc:Ignorable=\"").expect("w14 è ignorabile") + 14;
    let ignorable = &root[at..at + root[at..].find('"').unwrap()];
    assert!(ignorable.split_whitespace().any(|p| p == "w14"), "{root}");
    for prefix in ignorable.split_whitespace() {
        assert!(root.contains(&format!("xmlns:{prefix}=")), "{root}");
    }
}

/// Un'immagine nuova entra con la sua relazione e il suo tipo di contenuto; un
/// PNG che il file ha già riusa la sua.
#[test]
fn un_immagine_nuova_entra_con_relazione_e_tipo() {
    let file = package("", &format!("{}{}", para("Uno"), para("Due")), &[]);
    let mut p = projection(&file);
    para_mut(&mut p, 1).c.push(Inline::Atom {
        ins: None,
        del: None,
        k: None,
        kind: AtomKind::Image,
        label: "Il logo".into(),
        w: Some(72.0),
        h: Some(36.0),
        data: Some(base64::engine::general_purpose::STANDARD.encode(PNG)),
        note: None,
        end: false,
        toc: None,
        comment: None,
    });
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    let after = entries(&out);
    let media: Vec<_> = after
        .keys()
        .filter(|n| n.starts_with("word/media/"))
        .collect();
    assert_eq!(media.len(), 1, "{media:?}");
    assert_eq!(after[media[0].as_str()], PNG);
    let rels = String::from_utf8(after[MAIN_RELS].clone()).unwrap();
    let id = &values(&rest[0], "a:blip", "r:embed")[0];
    assert!(
        rels.contains(&format!(r#"Id="{id}""#)) && rels.contains(&media[0]["word/".len()..]),
        "{rels}"
    );
    let types = String::from_utf8(after[TYPES].clone()).unwrap();
    assert!(types.contains(r#"Extension="png""#), "{types}");
    let reopened = projection(&out);
    assert!(matches!(
        para_mut(&mut reopened.clone(), 1).c.last(),
        Some(Inline::Atom {
            kind: AtomKind::Image,
            ..
        })
    ));
}

/// Un intervallo di spostamento che comincia in un paragrafo e finisce nel
/// paragrafo toccato non si innesta: il salvataggio riscrive il documento.
/// Un paragrafo fuori dagli intervalli si innesta.
#[test]
fn uno_spostamento_a_cavallo_non_si_innesta() {
    let file = package(
        "",
        r#"<w:p><w:moveFromRangeStart w:id="1" w:name="m" w:author="A" w:date="2026-01-01T00:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>via</w:t></w:r></w:moveFrom></w:p><w:p><w:moveFrom w:id="3" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>ancora</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p><w:p><w:r><w:t>Fisso</w:t></w:r></w:p><w:p><w:moveToRangeStart w:id="4" w:name="m" w:author="A" w:date="2026-01-01T00:00:00Z"/><w:moveTo w:id="5" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>qui</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="4"/></w:p>"#,
        &[],
    );
    let base = projection(&file);
    let mut p = base.clone();
    append(&mut p, 2, " cambiato");
    let out = saved(&file, &p);
    assert_eq!(grafted(&file, &out).len(), 1);

    let mut p = base;
    para_mut(&mut p, 1).c.push(Inline::Text {
        x: " e poi".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
        ins: None,
        del: None,
    });
    let out = saved(&file, &p);
    assert_ne!(
        entries(&out)["_rels/.rels"],
        entries(&file)["_rels/.rels"],
        "il salvataggio ha innestato uno spostamento a cavallo"
    );
    let xml = main_part(&out);
    assert_eq!(
        values(&xml, "w:moveFromRangeStart", "w:id"),
        values(&xml, "w:moveFromRangeEnd", "w:id")
    );
}

/// Un commento che comincia in un paragrafo e finisce in quello toccato tiene
/// il numero del file su entrambi i capi, e i commenti restano i byte del
/// file.
#[test]
fn un_commento_a_cavallo_tiene_il_suo_numero() {
    let comments = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="{W}"><w:comment w:id="0" w:author="A" w:date="2026-01-01T00:00:00Z" w:initials="A"><w:p><w:r><w:t>Uguale</w:t></w:r></w:p></w:comment><w:comment w:id="6" w:author="A" w:date="2026-01-01T00:00:00Z" w:initials="A"><w:p><w:r><w:t>Uguale</w:t></w:r></w:p></w:comment></w:comments>"#
    );
    let file = package(
        "",
        r#"<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>uno</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:commentRangeStart w:id="6"/><w:r><w:t xml:space="preserve"> e</w:t></w:r></w:p><w:p><w:r><w:t>due</w:t></w:r><w:commentRangeEnd w:id="6"/><w:r><w:commentReference w:id="6"/></w:r></w:p>"#,
        &[Part {
            name: "comments.xml",
            content_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
            rel: "comments",
            xml: comments,
        }],
    );
    let mut p = projection(&file);
    append(&mut p, 1, " cambiato");
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    assert_eq!(
        values(&rest[0], "w:commentRangeEnd", "w:id"),
        ["6"],
        "{}",
        rest[0]
    );
    assert_eq!(values(&rest[0], "w:commentReference", "w:id"), ["6"]);
    assert_eq!(
        entries(&out)["word/comments.xml"],
        entries(&file)["word/comments.xml"]
    );
}

/// Un permesso che comincia nel paragrafo toccato e finisce in uno che resta
/// tiene il numero del file.
#[test]
fn un_permesso_a_cavallo_tiene_il_suo_numero() {
    let file = package(
        "",
        r#"<w:p><w:permStart w:id="9" w:edGrp="everyone"/><w:r><w:t>uno</w:t></w:r></w:p><w:p><w:r><w:t>due</w:t></w:r><w:permEnd w:id="9"/></w:p>"#,
        &[],
    );
    let mut p = projection(&file);
    append(&mut p, 0, " cambiato");
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    let xml = main_part(&out);
    assert_eq!(values(&xml, "w:permStart", "w:id"), ["9"], "{xml}");
    assert_eq!(values(&xml, "w:permEnd", "w:id"), ["9"], "{xml}");
}

/// Una revisione del paragrafo toccato prende un numero che nessun'altra
/// storia usa: le note hanno i loro segnalibri.
#[test]
fn i_numeri_nuovi_non_ripetono_quelli_delle_altre_storie() {
    let footnotes = notes(&[(1, "Una nota.")]).replace(
        "<w:t xml:space=\"preserve\"> Una nota.</w:t>",
        "<w:t xml:space=\"preserve\"> Una nota.</w:t></w:r><w:bookmarkStart w:id=\"50\" w:name=\"nota\"/><w:r><w:t>!</w:t></w:r><w:bookmarkEnd w:id=\"50\"/><w:r><w:t></w:t>",
    );
    let file = package(
        "",
        r#"<w:p><w:r><w:t>Uno</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p><w:p><w:r><w:t>Due</w:t></w:r><w:ins w:id="3" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve"> nuovo</w:t></w:r></w:ins></w:p>"#,
        &[Part {
            name: "footnotes.xml",
            content_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
            rel: "footnotes",
            xml: footnotes,
        }],
    );
    let mut p = projection(&file);
    append(&mut p, 1, " cambiato");
    let out = saved(&file, &p);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    let ids = values(&rest[0], "w:ins", "w:id");
    assert_eq!(ids.len(), 1, "{}", rest[0]);
    let id: u64 = ids[0].parse().unwrap();
    assert!(id > 50, "{}", rest[0]);
}

/// Un paragrafo che il codec non riscriverebbe uguale (la lingua dell'Asia
/// orientale di un carattere, storytold/wordcraft#3457) resta chiuso: si
/// salvano gli altri, e lui resta i byte del file.
#[test]
fn un_blocco_chiuso_resta_i_byte_del_file() {
    let closed = r#"<w:p><w:r><w:rPr><w:lang w:val="it-IT" w:eastAsia="ja-JP"/></w:rPr><w:t>chiuso</w:t></w:r></w:p>"#;
    let file = package(
        "",
        &format!("{closed}{}{}", para("Primo"), para("Secondo")),
        &[],
    );
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, None);
    let p = Projection::from_json(&opened.projection).unwrap();
    let locked: Vec<bool> = p
        .blocks
        .iter()
        .map(|block| matches!(block, Block::Para(para) if para.locked))
        .collect();
    assert_eq!(locked, [true, false, false]);
    assert!(p.body_only, "un blocco chiuso vieta la scrittura intera");

    // Un altro paragrafo si salva per innesto.
    let mut edited = p.clone();
    append(&mut edited, 2, " cambiato");
    let out = saved(&file, &edited);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    assert!(body_children(&main_part(&out)).contains(&closed.to_string()));
    let reopened = projection(&out);
    assert_eq!(texts(&reopened), ["chiuso", "Primo", "Secondo cambiato"]);
    assert!(matches!(&reopened.blocks[0], Block::Para(para) if para.locked));

    // Toglierlo, tenerlo senza il segno o cambiarlo non si fa.
    let locked_error = |projection: &Projection| {
        save(Codec::Docx, &file, &projection.to_json().unwrap()).unwrap_err()
    };
    let mut removed = p.clone();
    removed.blocks.remove(0);
    assert_eq!(locked_error(&removed), RichError::Locked(Some(0)));
    let mut unmarked = p.clone();
    para_mut(&mut unmarked, 0).locked = false;
    append(&mut unmarked, 1, " cambiato");
    assert_eq!(locked_error(&unmarked), RichError::Locked(Some(0)));
    let mut changed = p.clone();
    append(&mut changed, 0, " cambiato");
    assert_eq!(locked_error(&changed), RichError::Locked(Some(0)));

    // Spostato in fondo, resta i suoi byte.
    let mut moved = p.clone();
    let block = moved.blocks.remove(0);
    moved.blocks.push(block);
    let out = saved(&file, &moved);
    let children = body_children(&main_part(&out));
    assert_eq!(
        children[children.len() - 2],
        closed,
        "prima della sezione finale"
    );
    assert_eq!(texts(&projection(&out)), ["Primo", "Secondo", "chiuso"]);

    // Ciò che sta fuori dal corpo non si riscrive: la pagina dell'ultima
    // sezione è del documento intero.
    let mut page = p.clone();
    page.page.as_mut().expect("la pagina").left += 36.0;
    assert_eq!(locked_error(&page), RichError::Locked(None));
}

/// Un corpo che finisce con una tabella: il modello la fa seguire da un
/// paragrafo vuoto, che il file non ha. Finché nessuno lo tocca il file resta
/// senza; scritto, entra dopo la tabella.
#[test]
fn il_paragrafo_dopo_la_tabella_finale_si_scrive_soltanto_se_si_tocca() {
    let table = r#"<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>cella</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
    let file = package("", &format!("{}{table}", para("Prima")), &[]);
    let p = projection(&file);
    assert_eq!(p.blocks.len(), 3);
    assert!(matches!(&p.blocks[2], Block::Para(para) if para.c.is_empty()));

    let mut first = p.clone();
    append(&mut first, 0, " e poi cambiato");
    let out = saved(&file, &first);
    assert_eq!(grafted(&file, &out).len(), 1);
    let children = body_children(&main_part(&out));
    // L'ultimo figlio prima della sezione finale.
    assert!(
        children[children.len() - 2].starts_with("<w:tbl"),
        "{children:#?}"
    );

    let mut last = p.clone();
    para_mut(&mut last, 2).c.push(Inline::Text {
        x: "In fondo, cambiato".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
        ins: None,
        del: None,
    });
    let out = saved(&file, &last);
    let rest = grafted(&file, &out);
    assert_eq!(rest.len(), 1, "{rest:#?}");
    assert!(rest[0].contains("In fondo, cambiato"), "{rest:#?}");
    assert_eq!(texts(&projection(&out)), texts(&last));
}
