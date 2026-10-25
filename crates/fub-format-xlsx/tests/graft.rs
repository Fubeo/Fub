//! L'innesto dei valori: i byte non toccati restano i byte del file, le celle
//! bloccate si rifiutano, e il risultato si rilegge.

mod common;

use std::collections::BTreeMap;
use std::io::{Cursor, Read};

use common::{one_sheet, sheet, soffice, Package};
use fub_format_xlsx::graft::{graft, CellEdit, GraftError, Grafted};
use fub_format_xlsx::input::NewValue;
use fub_format_xlsx::locks::Lock;
use gridcraft_core::{CellRef, Value};

const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

fn cell(a1: &str) -> CellRef {
    CellRef::parse(a1).unwrap()
}

fn edit(a1: &str, value: NewValue) -> CellEdit {
    CellEdit {
        sheet: 0,
        cell: cell(a1),
        value,
    }
}

fn number(n: f64) -> NewValue {
    NewValue::Number(n)
}

fn text(t: &str) -> NewValue {
    NewValue::Text(t.to_string())
}

/// Le voci dello zip: il nome, i byte compressi e il CRC.
fn raw_entries(bytes: &[u8]) -> Vec<(String, Vec<u8>, u32)> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..archive.len())
        .map(|index| {
            let mut file = archive.by_index_raw(index).unwrap();
            let name = file.name().unwrap().to_string();
            let crc = file.crc32();
            let mut raw = Vec::new();
            file.read_to_end(&mut raw).unwrap();
            (name, raw, crc)
        })
        .collect()
}

fn part(bytes: &[u8], name: &str) -> Option<String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut file = archive.by_name(name).ok()?;
    let mut text = String::new();
    file.read_to_string(&mut text).unwrap();
    Some(text)
}

fn sheet_xml(bytes: &[u8]) -> String {
    part(bytes, "xl/worksheets/sheet1.xml").unwrap()
}

fn run(original: &[u8], edits: &[CellEdit], recalc: bool) -> Result<Grafted, GraftError> {
    let model = fub_format_xlsx::read(original).unwrap().workbook;
    graft(original, &model, edits, recalc)
}

fn value(bytes: &[u8], a1: &str) -> Value {
    let read = fub_format_xlsx::read(bytes).unwrap();
    read.workbook.sheets[0].value(cell(a1))
}

/// Le voci che non sono `changed` restano i byte compressi del file.
fn assert_untouched_except(before: &[u8], after: &[u8], changed: &[&str]) {
    let before = raw_entries(before);
    let after: BTreeMap<_, _> = raw_entries(after)
        .into_iter()
        .map(|(name, raw, crc)| (name, (raw, crc)))
        .collect();
    for (name, raw, crc) in before {
        if changed.contains(&name.as_str()) {
            continue;
        }
        let (raw_after, crc_after) = after.get(&name).unwrap_or_else(|| panic!("{name} is gone"));
        assert_eq!((raw_after, *crc_after), (&raw, crc), "{name} changed");
    }
}

const BODY: &str = r#"<dimension ref="A1:B3"/><sheetData><row r="1" spans="1:2"><c r="A1" s="3"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2" spans="1:2"><c r="A2" s="1"><v>0.5</v></c><c r="B2"><f>A2*2</f><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>tre</t></is></c></row></sheetData>"#;

#[test]
fn le_righe_e_le_voci_non_toccate_restano_i_loro_byte() {
    let original = one_sheet(BODY);
    let grafted = run(
        &original,
        &[edit("A1", number(42.0)), edit("A3", text("nuovo & <x>"))],
        false,
    )
    .unwrap();
    assert!(!grafted.recalc && !grafted.calc_chain_removed);
    assert_untouched_except(&original, &grafted.bytes, &["xl/worksheets/sheet1.xml"]);
    let xml = sheet_xml(&grafted.bytes);
    assert!(xml.contains(r#"<row r="2" spans="1:2"><c r="A2" s="1"><v>0.5</v></c><c r="B2"><f>A2*2</f><v>1</v></c></row>"#), "{xml}");
    assert!(
        xml.contains(
            r#"<row r="1" spans="1:2"><c r="A1" s="3"><v>42</v></c><c r="B1"><v>2</v></c></row>"#
        ),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<c r="A3" t="inlineStr"><is><t>nuovo &amp; &lt;x&gt;</t></is></c>"#),
        "{xml}"
    );
    assert_eq!(value(&grafted.bytes, "A1"), Value::Number(42.0));
    assert_eq!(value(&grafted.bytes, "A3"), Value::text("nuovo & <x>"));
    // Il valore salvato della dipendente non si ricalcola.
    assert_eq!(value(&grafted.bytes, "B2"), Value::Number(1.0));
}

#[test]
fn una_cella_nuova_prende_lo_stile_della_riga_o_della_colonna() {
    let original = one_sheet(
        r#"<dimension ref="A1:B2"/><cols><col min="4" max="4" style="4" width="9"/></cols><sheetData><row r="1" spans="1:2"><c r="A1"><v>1</v></c></row><row r="2" s="5" customFormat="1"><c r="A2"><v>2</v></c></row></sheetData>"#,
    );
    let grafted = run(
        &original,
        &[
            edit("C1", number(3.0)),
            edit("D1", number(4.0)),
            edit("B2", number(5.0)),
            edit("D5", text("giù")),
        ],
        false,
    )
    .unwrap();
    let xml = sheet_xml(&grafted.bytes);
    // `spans` non copre più la riga e se ne va; la colonna D dà lo stile 4.
    assert!(xml.contains(r#"<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c><c r="D1" s="4"><v>4</v></c></row>"#), "{xml}");
    assert!(
        xml.contains(r#"<c r="B2" s="5"><v>5</v></c></row>"#),
        "{xml}"
    );
    assert!(xml.contains(r#"</row><row r="5"><c r="D5" s="4" t="inlineStr"><is><t>giù</t></is></c></row></sheetData>"#), "{xml}");
    assert!(xml.contains(r#"<dimension ref="A1:D5"/>"#), "{xml}");
}

#[test]
fn le_coordinate_implicite_restano_le_stesse() {
    let original = one_sheet(
        r#"<sheetData><row><c><v>1</v></c><c><v>2</v></c></row><row><c><v>3</v></c></row><row r="5"><c><v>5</v></c></row></sheetData>"#,
    );
    // A1 esce (vuota e senza stile), e B1 prende la sua coordinata; la riga
    // nuova entra fra la seconda riga implicita e la quinta.
    let grafted = run(
        &original,
        &[edit("A1", NewValue::Blank), edit("A4", number(4.0))],
        false,
    )
    .unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(xml.contains(r#"<row><c r="B1"><v>2</v></c></row><row><c><v>3</v></c></row><row r="4"><c r="A4"><v>4</v></c></row><row r="5">"#), "{xml}");
    let read = fub_format_xlsx::read(&grafted.bytes).unwrap().workbook;
    let sheet = &read.sheets[0];
    assert_eq!(sheet.value(cell("A1")), Value::Empty);
    assert_eq!(sheet.value(cell("B1")), Value::Number(2.0));
    assert_eq!(sheet.value(cell("A2")), Value::Number(3.0));
    assert_eq!(sheet.value(cell("A4")), Value::Number(4.0));
    assert_eq!(sheet.value(cell("A5")), Value::Number(5.0));
}

#[test]
fn una_riga_nuova_prima_di_una_implicita_le_da_la_sua_coordinata() {
    let original = one_sheet(
        r#"<sheetData><row r="3"><c r="A3"><v>3</v></c></row><row><c><v>4</v></c></row></sheetData>"#,
    );
    let grafted = run(&original, &[edit("A1", number(1.0))], false).unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(
        xml.contains(r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="3">"#),
        "{xml}"
    );
    assert_eq!(value(&grafted.bytes, "A4"), Value::Number(4.0));
}

#[test]
fn una_cella_inserita_prima_di_una_implicita_le_da_la_sua_coordinata() {
    let original = one_sheet(
        r#"<sheetData><row r="1"><c r="C1"><v>3</v></c><c><v>4</v></c></row></sheetData>"#,
    );
    // Togliere C1 sposterebbe la cella implicita D1 in C1.
    let grafted = run(&original, &[edit("C1", NewValue::Blank)], false).unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(
        xml.contains(r#"<row r="1"><c r="D1"><v>4</v></c></row>"#),
        "{xml}"
    );
    assert_eq!(value(&grafted.bytes, "D1"), Value::Number(4.0));
}

#[test]
fn la_cella_vuota_con_uno_stile_resta_e_senza_esce() {
    let original = one_sheet(BODY);
    let grafted = run(
        &original,
        &[edit("A1", NewValue::Blank), edit("B1", NewValue::Blank)],
        false,
    )
    .unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(
        xml.contains(r#"<row r="1" spans="1:2"><c r="A1" s="3"/></row>"#),
        "{xml}"
    );
    // Vuotare una cella vuota non scrive niente: la cella non c'è.
    let again = run(&grafted.bytes, &[edit("C9", NewValue::Blank)], false).unwrap();
    assert_eq!(again.bytes.len(), grafted.bytes.len());
    assert_eq!(sheet_xml(&again.bytes), xml);
}

#[test]
fn ogni_tipo_di_valore_si_scrive_e_si_rilegge() {
    let original = one_sheet(BODY);
    let values = [
        ("A1", number(-1.5e-7)),
        ("B1", NewValue::Bool(true)),
        ("A2", NewValue::Error(gridcraft_core::CellError::NA)),
        ("C1", text("  spazi\ne a capo ")),
        ("C2", text("_x0041_ \u{1} fine")),
        ("C3", number(1e16)),
    ];
    let edits: Vec<_> = values.iter().map(|(a1, v)| edit(a1, v.clone())).collect();
    let grafted = run(&original, &edits, false).unwrap();
    let read = fub_format_xlsx::read(&grafted.bytes).unwrap().workbook;
    let sheet = &read.sheets[0];
    assert_eq!(sheet.value(cell("A1")), Value::Number(-1.5e-7));
    assert_eq!(sheet.value(cell("B1")), Value::Bool(true));
    assert_eq!(
        sheet.value(cell("A2")),
        Value::Error(gridcraft_core::CellError::NA)
    );
    assert_eq!(sheet.value(cell("C1")), Value::text("  spazi\ne a capo "));
    assert_eq!(sheet.value(cell("C2")), Value::text("_x0041_ \u{1} fine"));
    assert_eq!(sheet.value(cell("C3")), Value::Number(1e16));
    let xml = sheet_xml(&grafted.bytes);
    assert!(xml.contains(r#"<t xml:space="preserve">  spazi"#), "{xml}");
    assert!(xml.contains("_x005F_x0041_ _x0001_ fine"), "{xml}");
}

#[test]
fn togliere_una_formula_toglie_la_catena_e_chiede_il_ricalcolo() {
    let kind = format!("{R}/calcChain");
    let chain = br#"<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B2" i="1"/></calcChain>"#.to_vec();
    let original = Package {
        sheets: vec![sheet("Foglio1", BODY)],
        workbook_tail: r#"<calcPr calcId="191029"/>"#,
        parts: vec![(
            "xl/calcChain.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml",
            chain,
        )],
        workbook_rels: vec![("rChain", kind.as_str(), "calcChain.xml")],
        ..Package::default()
    }
    .bytes();
    let grafted = run(&original, &[edit("B2", number(7.0))], false).unwrap();
    assert!(grafted.recalc && grafted.calc_chain_removed);
    assert!(part(&grafted.bytes, "xl/calcChain.xml").is_none());
    let rels = part(&grafted.bytes, "xl/_rels/workbook.xml.rels").unwrap();
    assert!(!rels.contains("calcChain"), "{rels}");
    let types = part(&grafted.bytes, "[Content_Types].xml").unwrap();
    assert!(!types.contains("calcChain"), "{types}");
    let workbook = part(&grafted.bytes, "xl/workbook.xml").unwrap();
    assert!(
        workbook.contains(r#"<calcPr fullCalcOnLoad="1" calcId="191029"/>"#),
        "{workbook}"
    );
    assert_untouched_except(
        &original,
        &grafted.bytes,
        &[
            "xl/worksheets/sheet1.xml",
            "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels",
            "[Content_Types].xml",
            "xl/calcChain.xml",
        ],
    );
    assert_eq!(value(&grafted.bytes, "B2"), Value::Number(7.0));
}

#[test]
fn una_dipendente_chiede_il_ricalcolo_e_la_catena_resta() {
    let original = Package {
        sheets: vec![sheet("Foglio1", BODY)],
        workbook_tail: r#"<definedNames><definedName name="x">Foglio1!$A$1</definedName></definedNames><extLst/>"#,
        ..Package::default()
    }
    .bytes();
    let grafted = run(&original, &[edit("A2", number(3.0))], true).unwrap();
    assert!(grafted.recalc && !grafted.calc_chain_removed);
    let workbook = part(&grafted.bytes, "xl/workbook.xml").unwrap();
    assert!(
        workbook.contains(r#"</definedNames><calcPr fullCalcOnLoad="1"/><extLst/>"#),
        "{workbook}"
    );
}

#[test]
fn un_foglio_vuoto_riceve_la_sua_prima_riga() {
    let original = one_sheet(r#"<dimension ref="A1"/><sheetData/>"#);
    let grafted = run(&original, &[edit("B2", number(1.0))], false).unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(xml.contains(r#"<dimension ref="A1:B2"/><sheetData><row r="2"><c r="B2"><v>1</v></c></row></sheetData>"#), "{xml}");
}

#[test]
fn il_prefisso_del_foglio_resta_quello_del_file() {
    let original = Package {
        sheets: vec![sheet("Foglio1", "")],
        ..Package::default()
    }
    .bytes();
    // Il foglio di prova si riscrive con un prefisso.
    let prefixed = rewrite_part(
        &original,
        "xl/worksheets/sheet1.xml",
        r#"<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>"#,
    );
    let grafted = run(
        &prefixed,
        &[edit("B1", text("b")), edit("A1", number(2.0))],
        false,
    )
    .unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(xml.contains(r#"<x:row r="1"><x:c r="A1"><x:v>2</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>b</x:t></x:is></x:c></x:row>"#), "{xml}");
    assert_eq!(value(&grafted.bytes, "B1"), Value::text("b"));
}

#[test]
fn la_voce_innestata_tiene_il_sistema_e_gli_attributi_del_file() {
    use std::io::Write;
    // Una cartella scritta su Windows: senza copiarli, il crate scriverebbe il
    // sistema e gli attributi della macchina che innesta.
    let original = one_sheet(BODY);
    let mut archive = zip::ZipArchive::new(Cursor::new(&original)).unwrap();
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).unwrap();
        let entry = file.name().unwrap().to_string();
        let mut content = Vec::new();
        file.read_to_end(&mut content).unwrap();
        let options = zip::write::SimpleFileOptions::default()
            .system(zip::System::Dos)
            .external_attributes(0x20);
        out.start_file(entry.as_str(), options).unwrap();
        out.write_all(&content).unwrap();
    }
    let dos = out.finish().unwrap().into_inner();
    let grafted = run(&dos, &[edit("A1", number(42.0))], false).unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(&grafted.bytes)).unwrap();
    let file = archive.by_name("xl/worksheets/sheet1.xml").unwrap();
    assert_eq!(
        (file.system(), file.external_attributes()),
        (zip::System::Dos, 0x20)
    );
}

fn rewrite_part(bytes: &[u8], name: &str, xml: &str) -> Vec<u8> {
    use std::io::Write;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).unwrap();
        let entry = file.name().unwrap().to_string();
        let mut content = Vec::new();
        file.read_to_end(&mut content).unwrap();
        out.start_file(entry.as_str(), zip::write::SimpleFileOptions::default())
            .unwrap();
        if entry == name {
            out.write_all(xml.as_bytes()).unwrap();
        } else {
            out.write_all(&content).unwrap();
        }
    }
    out.finish().unwrap().into_inner()
}

#[test]
fn le_celle_bloccate_si_rifiutano() {
    let body = r#"<sheetData><row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">B1</f><v>0</v></c><c r="B1"><v>1</v></c><c r="C1"><f t="array" ref="C1:C2">B1:B2</f><v>1</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>0</v></c><c r="C2"><v>2</v></c><c r="E2"><v>9</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="E2:F3"/></mergeCells>"#;
    let original = one_sheet(body);
    for (a1, lock) in [
        ("A1", Lock::SharedFormula),
        ("C1", Lock::Array),
        ("C2", Lock::Array),
        ("F2", Lock::Merged),
        ("E3", Lock::Merged),
    ] {
        match run(&original, &[edit(a1, number(5.0))], false) {
            Err(GraftError::Locked {
                cell: at,
                lock: got,
                ..
            }) => {
                assert_eq!((at, got), (cell(a1), lock), "{a1}")
            }
            other => panic!("{a1}: {other:?}"),
        }
    }
    // Una cella figlia della formula condivisa e la prima cella unita si
    // cambiano; la figlia perde la formula e la cartella chiede il ricalcolo.
    let grafted = run(
        &original,
        &[edit("A2", number(5.0)), edit("E2", number(6.0))],
        false,
    )
    .unwrap();
    assert!(grafted.recalc);
    assert_eq!(value(&grafted.bytes, "A2"), Value::Number(5.0));
}

#[test]
fn le_tabelle_di_dati_e_i_fogli_protetti_bloccano() {
    let original = one_sheet(
        r#"<sheetData><row r="1"><c r="A1"><f t="dataTable" ref="A1:B2" dt2D="0" dtr="0" r1="D1"/><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="B2"><v>3</v></c><c r="C2" s="4"><v>4</v></c></row></sheetData>"#,
    );
    match run(&original, &[edit("B2", number(5.0))], false) {
        Err(GraftError::Locked {
            lock: Lock::DataTable,
            ..
        }) => {}
        other => panic!("{other:?}"),
    }
    let protected = one_sheet(
        r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="1"/>"#,
    );
    match run(&protected, &[edit("A1", number(5.0))], false) {
        Err(GraftError::Locked {
            lock: Lock::Protected,
            ..
        }) => {}
        other => panic!("{other:?}"),
    }
}

#[test]
fn le_forme_che_l_innesto_non_tratta_si_rifiutano() {
    let disordered = one_sheet(
        r#"<sheetData><row r="2"><c r="A2"><v>2</v></c></row><row r="1"><c r="A1"><v>1</v></c></row></sheetData>"#,
    );
    assert!(matches!(
        run(&disordered, &[edit("A1", number(5.0))], false),
        Err(GraftError::Shape(_))
    ));
    let original = one_sheet(BODY);
    assert!(matches!(
        run(
            &original,
            &[edit("A1", number(1.0)), edit("A1", number(2.0))],
            false
        ),
        Err(GraftError::Edit(_))
    ));
    assert!(matches!(
        run(&original, &[edit("A1", number(f64::NAN))], false),
        Err(GraftError::Edit(_))
    ));
    assert!(matches!(
        run(
            &original,
            &[CellEdit {
                sheet: 3,
                cell: cell("A1"),
                value: number(1.0)
            }],
            false
        ),
        Err(GraftError::NoSheet(3))
    ));
}

#[test]
fn senza_modifiche_i_byte_sono_quelli() {
    let original = one_sheet(BODY);
    let grafted = run(&original, &[], false).unwrap();
    assert_eq!(grafted.bytes, original);
}

#[test]
fn i_fogli_non_toccati_restano_i_loro_byte() {
    let original = Package {
        sheets: vec![sheet("Uno", BODY), sheet("Due", BODY)],
        ..Package::default()
    }
    .bytes();
    let grafted = run(
        &original,
        &[CellEdit {
            sheet: 1,
            cell: cell("B1"),
            value: number(8.0),
        }],
        false,
    )
    .unwrap();
    assert_untouched_except(&original, &grafted.bytes, &["xl/worksheets/sheet2.xml"]);
    let read = fub_format_xlsx::read(&grafted.bytes).unwrap().workbook;
    assert_eq!(read.sheets[1].value(cell("B1")), Value::Number(8.0));
    assert_eq!(read.sheets[0].value(cell("B1")), Value::Number(2.0));
}

/// Con `FUB_SOFFICE`, il percorso di `soffice`: una cartella scritta da
/// LibreOffice si innesta, e LibreOffice la rilegge con i valori nuovi e ogni
/// altro valore com'era. Le dipendenti tengono il valore salvato: LibreOffice
/// non ricalcola all'apertura una cartella di Excel se l'utente non lo chiede
/// (`fullCalcOnLoad` lo legge Excel). Senza `FUB_SOFFICE` non fa niente: la
/// CI principale non ha LibreOffice.
#[test]
fn libreoffice_rilegge_la_cartella_innestata() {
    let Some(program) = std::env::var_os("FUB_SOFFICE") else {
        return;
    };
    let dir = std::env::temp_dir().join(format!("fub-xlsx-lo-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("prima.fods"),
        include_str!("fixtures/libreoffice.fods"),
    )
    .unwrap();
    soffice(&program, &dir, "xlsx", &[dir.join("prima.fods")]);
    let original = std::fs::read(dir.join("prima.xlsx")).unwrap();
    let edits = [
        edit("A1", number(5.0)),
        edit("B2", text("nuovo")),
        CellEdit {
            sheet: 1,
            cell: cell("B1"),
            value: number(7.0),
        },
    ];
    let grafted = run(&original, &edits, true).unwrap();
    std::fs::write(dir.join("dopo.xlsx"), &grafted.bytes).unwrap();
    soffice(
        &program,
        &dir,
        "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1",
        &[dir.join("prima.xlsx"), dir.join("dopo.xlsx")],
    );
    let csv = |name: &str| {
        std::fs::read_to_string(dir.join(name))
            .unwrap_or_else(|error| panic!("LibreOffice non ha scritto {name}: {error}"))
    };
    let (before, after) = (csv("prima-Dati.csv"), csv("dopo-Dati.csv"));
    let (other_before, other_after) = (csv("prima-Altro.csv"), csv("dopo-Altro.csv"));
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(before, "1,uno,unita\n2,due,\n3,30,\n");
    assert_eq!(after, "5,uno,unita\n2,nuovo,\n3,30,\n");
    assert_eq!(other_before, "101,fermo\n");
    assert_eq!(other_after, "101,7\n");
}

#[test]
fn un_attributo_fra_apici_resta_i_suoi_byte() {
    let original = one_sheet(
        r#"<sheetData><row r="1" spans="1:1" xmlns:x="urn:prova" x:nota='dice "ciao"'><c r="A1"><v>1</v></c></row></sheetData>"#,
    );
    let grafted = run(&original, &[edit("C1", number(3.0))], false).unwrap();
    let xml = sheet_xml(&grafted.bytes);
    assert!(xml.contains(r#"x:nota='dice "ciao"'"#), "{xml}");
    assert!(!xml.contains("spans="), "{xml}");
    assert_eq!(value(&grafted.bytes, "C1"), Value::Number(3.0));
}
