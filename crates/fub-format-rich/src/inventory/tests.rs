//! Test dell'inventario: pacchetto, conti, normalizzazioni e percorsi.

use super::*;
use std::io::Write;

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
const CT: &str = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
const ROOT: &str = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zw.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(bytes).unwrap();
    }
    zw.finish().unwrap().into_inner()
}

fn docx(document: &str, rels: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut entries: Vec<(&str, &[u8])> = vec![
        ("[Content_Types].xml", CT.as_bytes()),
        ("_rels/.rels", ROOT.as_bytes()),
        ("word/document.xml", document.as_bytes()),
        ("word/_rels/document.xml.rels", rels.as_bytes()),
    ];
    entries.extend_from_slice(extra);
    zip(&entries)
}

fn rels(inner: &str) -> String {
    format!(
        r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{inner}</Relationships>"#
    )
}

fn element(class: &str, name: &str) -> Key {
    Key::Element {
        class: class.into(),
        ns: NS_W.into(),
        name: name.into(),
    }
}

/// L'inventario del documento con questo corpo.
fn body_of(body: &str) -> Inventory {
    let document = format!(
        r#"<w:document {W} xmlns:w14="{NS_W14}"><w:body>{body}<w:sectPr/></w:body></w:document>"#
    );
    inventory(&docx(&document, &rels(""), &[])).unwrap()
}

#[test]
fn un_tipo_senza_xml_si_copia() {
    assert_eq!(class_of(&format!("{WML}printerSettings")), None);
    assert_eq!(class_of(&format!("{WML}document")), None);
    assert_eq!(
        class_of(&format!("{WML}header+xml")).as_deref(),
        Some("header")
    );
}

#[test]
fn il_paragrafo_dopo_una_tabella_finale_conta_come_nella_prova_a_vuoto() {
    let table =
        r#"<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cella</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
    let file = body_of(table);
    let dry = body_of(&format!("{table}<w:p></w:p>"));
    assert_eq!(file.normalized.get(TRAILING_PARAGRAPH), Some(&1));
    assert_eq!(file.body.len(), 2);
    assert_eq!(open_differences(&file, &dry), Vec::new());
    // Non dopo un paragrafo, né dopo una tabella seguita da un segno.
    assert_eq!(
        body_of(&format!("{table}<w:p/>"))
            .normalized
            .get(TRAILING_PARAGRAPH),
        None
    );
    let marked = body_of(&format!(
        r#"{table}<w:bookmarkStart w:id="0" w:name="x"/><w:bookmarkEnd w:id="0"/>"#
    ));
    assert_eq!(marked.normalized.get(TRAILING_PARAGRAPH), None);
}

#[test]
fn un_campo_semplice_conta_come_il_campo_complesso_che_il_codec_scrive() {
    let simple = body_of(
        r#"<w:p><w:fldSimple w:instr=" PAGE  \* MERGEFORMAT " w:dirty="1"><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>"#,
    );
    let complex = |instr: &str, result: &str| {
        body_of(&format!(
            r#"<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="1"/></w:r><w:r><w:instrText xml:space="preserve">{instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>{result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#
        ))
    };
    assert_eq!(simple.normalized.get("w:fldSimple"), Some(&1));
    let same = complex(" PAGE \\* MERGEFORMAT ", "3");
    assert_eq!(open_differences(&simple, &same), Vec::new());
    // L'istruzione, il risultato e gli altri attributi contano ancora.
    for (instr, result) in [(" NUMPAGES ", "3"), (" PAGE \\* MERGEFORMAT ", "4")] {
        assert_ne!(
            open_differences(&simple, &complex(instr, result)),
            Vec::new(),
            "{instr} {result}"
        );
    }
    let undirty = body_of(
        r#"<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE \* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#,
    );
    assert_ne!(open_differences(&simple, &undirty), Vec::new());
}

#[test]
fn un_contenitore_di_proprietà_vuoto_non_conta_e_uno_pieno_sì() {
    let empty = body_of(
        r#"<w:p><w:pPr><w:rPr></w:rPr></w:pPr><w:r><w:rPr/><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:trPr w:rsidR="00AA11BB"></w:trPr><w:tc><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>"#,
    );
    let plain = body_of(
        r#"<w:p><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
    );
    assert_eq!(empty.normalized.get("proprietà vuote"), Some(&5));
    assert_eq!(open_differences(&empty, &plain), Vec::new());
    assert_eq!(empty.body, plain.body);
    // Il contenitore di un contenitore con un figlio conta, tutti e due.
    let full = body_of(
        r#"<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
    );
    assert_eq!(full.normalized.get("proprietà vuote"), None);
    let differences: Vec<String> = open_differences(&full, &plain)
        .into_iter()
        .map(|d| d.key)
        .collect();
    for name in ["}pPr", "}rPr", "}b"] {
        assert!(
            differences.iter().any(|d| d.contains(name)),
            "{name}: {differences:?}"
        );
    }
    // Un attributo che conta lo fa contare.
    let marked = body_of(
        r#"<w:p><w:pPr w:foo="1"/><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
    );
    assert_ne!(open_differences(&marked, &plain), Vec::new());
    // Una `w:tblPr` vuota conta.
    let table = body_of(
        r#"<w:p><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
    );
    assert_ne!(open_differences(&table, &plain), Vec::new());
}

#[test]
fn i_lati_di_iso_29500_contano_come_left_e_right() {
    let iso = body_of(
        r#"<w:p><w:pPr><w:jc w:val="start"/><w:ind w:start="340" w:hanging="0"/><w:tabs><w:tab w:val="end" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblCellMar><w:start w:w="55" w:type="dxa"/><w:end w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
    );
    let transitional = |indent: &str| {
        body_of(&format!(
            r#"<w:p><w:pPr><w:jc w:val="left"/><w:ind w:left="{indent}" w:hanging="0"/><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>Testo</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblCellMar><w:left w:w="55" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>"#
        ))
    };
    assert_eq!(iso.normalized.get("start e end"), Some(&5));
    assert_eq!(open_differences(&iso, &transitional("340")), Vec::new());
    // Il valore conta ancora.
    assert_ne!(open_differences(&iso, &transitional("0")), Vec::new());
    // Fuori dai contenitori dei lati `w:start` resta sé stesso: il primo
    // numero di un elenco.
    let start = body_of(r#"<w:p><w:pPr><w:start w:val="3"/></w:pPr></w:p>"#);
    assert_eq!(start.normalized.get("start e end"), None);
}

#[test]
fn un_interruttore_acceso_e_uno_sporgente_nullo_contano_come_li_scrive_il_codec() {
    let libreoffice = body_of(
        r#"<w:p><w:pPr><w:keepNext w:val="true"/><w:ind w:left="0" w:hanging="0"/></w:pPr><w:r><w:rPr><w:b w:val="1"/><w:i w:val="on"/></w:rPr><w:t>Testo</w:t></w:r></w:p>"#,
    );
    let codec = body_of(
        r#"<w:p><w:pPr><w:keepNext/><w:ind w:left="0" w:firstLine="0"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Testo</w:t></w:r></w:p>"#,
    );
    assert_eq!(libreoffice.normalized.get("vero implicito"), Some(&3));
    assert_eq!(libreoffice.normalized.get("sporgente nullo"), Some(&1));
    assert_eq!(open_differences(&libreoffice, &codec), Vec::new());
    // Un interruttore spento, uno sporgente non nullo e il `w:val` di un
    // elemento che non è un interruttore contano.
    for (file, written) in [
        (
            r#"<w:p><w:pPr><w:keepNext w:val="false"/></w:pPr></w:p>"#,
            r#"<w:p><w:pPr><w:keepNext/></w:pPr></w:p>"#,
        ),
        (
            r#"<w:p><w:pPr><w:ind w:hanging="360"/></w:pPr></w:p>"#,
            r#"<w:p><w:pPr><w:ind w:firstLine="360"/></w:pPr></w:p>"#,
        ),
        (
            r#"<w:p><w:pPr><w:ilvl w:val="1"/></w:pPr></w:p>"#,
            r#"<w:p><w:pPr><w:ilvl/></w:pPr></w:p>"#,
        ),
    ] {
        assert_ne!(
            open_differences(&body_of(file), &body_of(written)),
            Vec::new(),
            "{file}"
        );
    }
}

#[test]
fn le_normalizzazioni_saltano_soltanto_ciò_che_dichiarano() {
    let marked = body_of(
        r#"<w:p w:rsidR="00AA11BB" w14:paraId="1A2B3C4D" w14:textId="0F0F0F0F"><w:proofErr w:type="spellStart"/><w:r w:rsidRPr="00CC22DD"><w:lastRenderedPageBreak/><w:t>Testo</w:t></w:r><w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="5" w:name="Segno"/><w:bookmarkEnd w:id="5"/></w:p>"#,
    );
    let plain = body_of(
        r#"<w:p><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
    );
    assert_eq!(marked.all, plain.all);
    assert_eq!(marked.body, plain.body);
    assert_eq!(marked.normalized.get("w:rsid*"), Some(&2));
    assert_eq!(marked.normalized.get("w:proofErr"), Some(&2));
    assert_eq!(marked.normalized.get("w:lastRenderedPageBreak"), Some(&1));
    assert_eq!(marked.normalized.get("paraId"), Some(&1));
    assert_eq!(marked.normalized.get("w14:textId"), Some(&1));
    assert_eq!(marked.normalized.get("w:id"), Some(&2));

    // Ciò che non è dichiarato conta ancora: il contenuto di un elemento
    // saltato, un altro attributo dello stesso spazio dei nomi, il nome
    // del segnalibro, un id che non è un numero.
    for other in [
        r#"<w:p><w:proofErr w:type="spellStart"><w:smartTagPr/></w:proofErr><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
        r#"<w:p w14:noSpellErr="1"><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
        r#"<w:p><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="0" w:name="Altro"/><w:bookmarkEnd w:id="0"/></w:p>"#,
        r#"<w:p><w:r><w:t>Testo</w:t></w:r><w:bookmarkStart w:id="a" w:name="Segno"/><w:bookmarkEnd w:id="0"/></w:p>"#,
    ] {
        assert_ne!(body_of(other).all, plain.all, "{other}");
    }
}

#[test]
fn i_run_uniti_dal_codec_sono_lo_stesso_paragrafo_e_il_testo_conta() {
    let split = body_of(
        r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>run</w:t></w:r></w:p>"#,
    );
    let joined = body_of(
        r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due run</w:t></w:r></w:p>"#,
    );
    assert_eq!(split.all, joined.all);
    // Un altro testo, o la proprietà che sparisce dal paragrafo, no.
    let other = body_of(
        r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due Run</w:t></w:r></w:p>"#,
    );
    assert_ne!(other.all, joined.all);
    let plain = body_of(r#"<w:p><w:r><w:t xml:space="preserve">Due run</w:t></w:r></w:p>"#);
    assert_ne!(plain.all, joined.all);
    // Le entità sono il carattere che nominano.
    let entity = body_of(
        r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Due&#32;r&#x75;n</w:t></w:r></w:p>"#,
    );
    assert_eq!(entity.all, joined.all);
}

#[test]
fn i_valori_si_confrontano_in_forma_canonica() {
    let lower = body_of(
        r#"<w:p><w:pPr><w:keepNext w:val="true"/></w:pPr><w:r><w:rPr><w:color w:val="c00000"/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
    );
    let upper = body_of(
        r#"<w:p><w:pPr><w:keepNext w:val="1"/></w:pPr><w:r><w:rPr><w:color w:val="C00000"/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
    );
    assert_eq!(lower.all, upper.all);
    let other = body_of(
        r#"<w:p><w:pPr><w:keepNext w:val="1"/></w:pPr><w:r><w:rPr><w:color w:val="C00001"/></w:rPr><w:t>x</w:t></w:r></w:p>"#,
    );
    assert_ne!(other.all, upper.all);
}

#[test]
fn un_riferimento_vale_per_la_relazione_che_nomina() {
    let linked = |id: &str, target: &str| {
        let document = format!(
            r#"<w:document {W}><w:body><w:p><w:hyperlink r:id="{id}"><w:r><w:t>x</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#
        );
        let link = format!(
            r#"<Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{target}" TargetMode="External"/>"#
        );
        inventory(&docx(&document, &rels(&link), &[])).unwrap()
    };
    let first = linked("rId1", "https://a.example");
    // Un altro id per la stessa relazione è la stessa chiave; un'altra
    // destinazione cambia anche il blocco che la nomina.
    assert_eq!(first.all, linked("rId7", "https://a.example").all);
    assert_ne!(first.body, linked("rId7", "https://b.example").body);
}

#[test]
fn prefissi_diversi_per_lo_stesso_spazio_dei_nomi_non_sono_una_perdita() {
    let a = docx(
        &format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#),
        &rels(""),
        &[],
    );
    let b = docx(
        r#"<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p/></x:body></x:document>"#,
        &rels(""),
        &[],
    );
    let (a, b) = (inventory(&a).unwrap(), inventory(&b).unwrap());
    assert_eq!(a.all, b.all);
    assert!(open_differences(&a, &b).is_empty());
    assert_eq!(a.body.len(), 1);
    assert_eq!(a.body[0][&element(DOCUMENT, "p")], 1);
}

#[test]
fn un_elemento_in_meno_è_una_perdita_uno_in_più_no() {
    let one = docx(
        &format!(
            r#"<w:document {W}><w:body><w:p><w:permStart w:id="1"/></w:p></w:body></w:document>"#
        ),
        &rels(""),
        &[],
    );
    let none = docx(
        &format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#),
        &rels(""),
        &[],
    );
    let (one, none) = (inventory(&one).unwrap(), inventory(&none).unwrap());
    let lost = open_differences(&one, &none);
    assert!(lost.iter().any(|d| d.key.contains("permStart")), "{lost:?}");
    assert!(open_differences(&none, &one).is_empty());
}

#[test]
fn una_parte_copiata_conta_per_contenuto_e_una_copia_in_più_è_una_differenza() {
    let image = rels(
        r#"<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/>"#,
    );
    let twice = rels(
        r#"<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/b.png"/>"#,
    );
    let body = format!(
        r#"<w:document {W}><w:body><w:p><w:r><w:drawing r:embed="rId5"/></w:r></w:p></w:body></w:document>"#
    );
    let a = inventory(&docx(&body, &image, &[("word/media/a.png", b"PNG")])).unwrap();
    // La stessa immagine con un altro nome: nessuna differenza.
    let renamed = image.replace("a.png", "c.png");
    let c = inventory(&docx(&body, &renamed, &[("word/media/c.png", b"PNG")])).unwrap();
    assert!(open_differences(&a, &c).is_empty());
    // Duplicata in un'altra parte: differenza.
    let b = inventory(&docx(
        &body,
        &twice,
        &[("word/media/a.png", b"PNG"), ("word/media/b.png", b"PNG")],
    ))
    .unwrap();
    assert!(open_differences(&a, &b)
        .iter()
        .any(|d| d.key.starts_with("part image/png")));
    // Un'altra immagine: differenza, e la relazione punta altrove.
    let other = inventory(&docx(&body, &image, &[("word/media/a.png", b"GIF")])).unwrap();
    let lost = open_differences(&a, &other);
    assert!(
        lost.iter().any(|d| d.key.contains("relationship")),
        "{lost:?}"
    );
}

#[test]
fn una_parte_che_nessuno_nomina_non_conta() {
    let body = format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#);
    let a = inventory(&docx(&body, &rels(""), &[])).unwrap();
    let b = inventory(&docx(&body, &rels(""), &[("word/orfana.png", b"x")])).unwrap();
    assert_eq!(a, b);
}

#[test]
fn un_riferimento_senza_relazione_si_vede() {
    let body = format!(
        r#"<w:document {W}><w:body><w:p><w:r><w:drawing r:embed="rId9"/></w:r></w:p></w:body></w:document>"#
    );
    let a = inventory(&docx(&body, &rels(""), &[])).unwrap();
    assert_eq!(a.dangling.len(), 1);
    let ok = format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#);
    let ok = inventory(&docx(&ok, &rels(""), &[])).unwrap();
    assert!(!open_differences(&ok, &a).is_empty());
}

/// Due voci con lo stesso nome, che l'indice di `zip` riduce a una: il
/// file del corpus è scritto a mano proprio per questo.
#[test]
fn due_voci_omonime_sono_un_errore() {
    let bytes = include_bytes!("../../tests/corpus/docx/ostile-voci-duplicate.docx");
    assert!(matches!(
        inventory(bytes),
        Err(InventoryError::Zip(message)) if message.contains("duplicate entry word/document.xml")
    ));
}

#[test]
fn zip_troncato_xml_malformato_e_limiti_sono_errori() {
    let good = docx(
        &format!(r#"<w:document {W}><w:body><w:p/></w:body></w:document>"#),
        &rels(""),
        &[],
    );
    assert!(matches!(
        inventory(&good[..good.len() / 2]),
        Err(InventoryError::Zip(_))
    ));
    let bad = docx(
        &format!(r#"<w:document {W}><w:body><w:p></w:body></w:document>"#),
        &rels(""),
        &[],
    );
    assert!(matches!(inventory(&bad), Err(InventoryError::Xml { .. })));
    let deep = format!(
        r#"<w:document {W}><w:body>{}{}</w:body></w:document>"#,
        "<w:p>".repeat(20),
        "</w:p>".repeat(20)
    );
    let limits = Limits {
        depth: 10,
        ..LIMITS
    };
    assert_eq!(
        inventory_with(&docx(&deep, &rels(""), &[]), &limits),
        Err(InventoryError::Limit("xml depth"))
    );
    let limits = Limits {
        elements: 2,
        ..LIMITS
    };
    assert_eq!(
        inventory_with(&good, &limits),
        Err(InventoryError::Limit("xml elements"))
    );
    let limits = Limits {
        part_bytes: 8,
        ..LIMITS
    };
    assert_eq!(
        inventory_with(&good, &limits),
        Err(InventoryError::Limit("part size"))
    );
}

#[test]
fn le_destinazioni_relative_si_risolvono_dalla_cartella_della_sorgente() {
    assert_eq!(
        resolve("word/document.xml", "media/a.png"),
        "word/media/a.png"
    );
    assert_eq!(
        resolve("word/document.xml", "../customXml/item1.xml"),
        "customxml/item1.xml"
    );
    assert_eq!(resolve("", "word/document.xml"), "word/document.xml");
    assert_eq!(resolve("word/document.xml", "/word/x.xml"), "word/x.xml");
    assert_eq!(rels_of("word/document.xml"), "word/_rels/document.xml.rels");
    assert_eq!(rels_of(""), "_rels/.rels");
}
