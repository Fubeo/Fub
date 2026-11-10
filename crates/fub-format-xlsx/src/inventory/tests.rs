//! Test dell'inventario di una cartella: parti, celle, formule, stili e
//! normalizzazioni.

use super::*;

const COMMENTS: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Una cartella con ciò che una riscrittura deve portare: valori, formule,
/// stili, unioni, regole (anche di Excel 2010), convalide, collegamenti con
/// il loro testo, testo formattato, note con il loro disegno.
fn rich() -> Vec<u8> {
    let sheet = r#"<sheetFormatPr defaultRowHeight="15"/><cols><col min="2" max="3" width="20.7109375" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>0.25</v></c><c r="C1" s="3" t="inlineStr"><is><r><rPr><b/></rPr><t>Uno</t></r><r><t xml:space="preserve"> due</t></r></is></c></row><row r="2" ht="30" customHeight="1"><c r="A2"><f>SUM(B1:B3)</f><v>0.25</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" s="5"><v>45000</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="D1:E2"/></mergeCells><conditionalFormatting sqref="B1:B3"><cfRule type="cellIs" dxfId="0" priority="2" operator="greaterThan"><formula>0</formula></cfRule><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:id>{9B4F274F-F774-40EE-9C50-A8B810847010}</x14:id></ext></extLst></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="list" sqref="C3"><formula1>"sì,no"</formula1></dataValidation></dataValidations><hyperlinks><hyperlink ref="A1" location="Foglio1!C2" display="Alla data"/></hyperlinks><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><legacyDrawing r:id="rVml"/><extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{9B4F274F-F774-40EE-9C50-A8B810847010}"><x14:dataBar minLength="0" maxLength="100" border="1"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:borderColor rgb="FF638EC6"/></x14:dataBar></x14:cfRule><xm:sqref>B1:B3</xm:sqref></x14:conditionalFormatting><x14:conditionalFormatting><x14:cfRule type="iconSet" priority="1" id="{23404A22-2791-4FFE-B3BF-645D3DA783FE}"><x14:iconSet iconSet="3Stars"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>67</xm:f></x14:cfvo></x14:iconSet></x14:cfRule><xm:sqref>C1:C3</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>"#;
    let strings = r#"<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><r><rPr><i/><sz val="11"/><rFont val="Calibri"/></rPr><t>Titolo</t></r></si></sst>"#;
    let comments = r#"<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Anna</author></authors><commentList><comment ref="B2" authorId="0"><text><r><rPr><b/><sz val="9"/><rFont val="Tahoma"/></rPr><t>Anna:</t></r><r><rPr><sz val="9"/><rFont val="Tahoma"/></rPr><t xml:space="preserve">
da rivedere</t></r></text></comment></commentList></comments>"#;
    let vml = "<xml xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"><o:shapelayout v:ext=\"edit\"><o:idmap v:ext=\"edit\" data=\"1\"/></o:shapelayout><v:shape id=\"_x0000_s1025\" type=\"#_x0000_t202\" style=\"position:absolute;width:96pt;height:55.5pt;visibility:hidden;mso-wrap-style:tight\" fillcolor=\"infoBackground [80]\"><x:ClientData ObjectType=\"Note\"><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>";
    let sheet_rels = format!(
        r#"<Relationship Id="rComments" Type="{R}/comments" Target="../comments1.xml"/><Relationship Id="rVml" Type="{R}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>"#
    );
    common::Package {
        sheets: vec![common::sheet("Foglio1", sheet)],
        workbook_tail: r#"<definedNames><definedName name="Totale">Foglio1!$A$2</definedName></definedNames>"#,
        parts: vec![
            ("xl/sharedStrings.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml", strings.as_bytes().to_vec()),
            ("xl/comments1.xml", COMMENTS, comments.as_bytes().to_vec()),
            ("xl/drawings/vmlDrawing1.vml", "application/vnd.openxmlformats-officedocument.vmlDrawing", vml.as_bytes().to_vec()),
        ],
        workbook_rels: vec![("rStrings", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings", "sharedStrings.xml")],
        sheet_rels: vec![(0, sheet_rels)],
        ..common::Package::default()
    }
    .bytes()
}

fn rewritten(bytes: &[u8], edit: impl FnOnce(&mut gridcraft_model::Workbook)) -> Vec<u8> {
    let (mut wb, _) = gridcraft_xlsx::read_xlsx(bytes).unwrap();
    edit(&mut wb);
    gridcraft_xlsx::write_xlsx(&wb).unwrap()
}

fn all_differences(before: &[u8], after: &[u8]) -> Vec<String> {
    let (before, after) = (inventory(before).unwrap(), inventory(after).unwrap());
    differences(&before, &after, |_| true)
        .iter()
        .map(ToString::to_string)
        .collect()
}

/// Se una chiave dell'inventario porta `mark` nella sua forma intera.
fn holds(inventory: &Inventory, mark: &str) -> bool {
    inventory.items.keys().any(|k| k.value.contains(mark))
}

#[test]
fn una_cartella_riscritta_senza_modifiche_non_perde_niente() {
    let file = rich();
    let (before, after) = (
        inventory(&file).unwrap(),
        inventory(&rewritten(&file, |_| {})).unwrap(),
    );
    for mark in [
        "x14:conditionalFormattings",
        "Alla data",
        "Titolo",
        "Anna:",
        "idmap",
        "D1:E2",
        "sì,no",
        "Totale",
    ] {
        assert!(holds(&before, mark), "{mark}");
    }
    let found = differences(&before, &after, |_| true);
    let lost: Vec<String> = found
        .iter()
        .filter(|d| d.after < d.before)
        .map(ToString::to_string)
        .collect();
    assert_eq!(lost, Vec::<String>::new());
    // Ciò che si aggiunge sono le parti che GridCraft scrive sempre e
    // che questa cartella, fatta a mano, non aveva.
    let added: Vec<String> = found.iter().map(ToString::to_string).collect();
    let written = [
        "rel:core-properties",
        "rel:extended-properties",
        "calcPr",
        "rel:theme",
        "workbookView",
        "sheetView",
    ];
    assert!(
        added
            .iter()
            .all(|d| d.starts_with("0 → 1: ") && written.iter().any(|w| d.contains(w))),
        "{added:#?}"
    );
}

#[test]
fn un_grafico_e_un_immagine_si_contano_e_restano() {
    use gridcraft_model::{Anchor, Chart, ChartKind, Image, LegendPos, Series};
    let data = common::one_sheet(
        r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nord</t></is></c><c r="B1"><v>3</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Sud</t></is></c><c r="B2"><v>5</v></c></row></sheetData>"#,
    );
    let at = |cell| Anchor {
        cell: gridcraft_core::CellRef::parse(cell).unwrap(),
        width: 320.0,
        height: 200.0,
        ..Anchor::default()
    };
    let file = rewritten(&data, |wb| {
        let sheet = wb.sheet_mut(0).unwrap();
        sheet.charts.push(Chart {
            id: 1,
            kind: ChartKind::ColumnClustered,
            anchor: at("D2"),
            title: Some("Vendite".into()),
            series: vec![Series {
                categories: Some("Foglio1!$A$1:$A$2".into()),
                values: "Foglio1!$B$1:$B$2".into(),
                ..Series::default()
            }],
            legend: LegendPos::Bottom,
            data_labels: false,
            gridlines: true,
            style: 2,
            x_title: None,
            y_title: None,
            source: None,
            by_rows: false,
            pivot: None,
        });
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend([7; 64]);
        sheet.images.push(Image {
            id: 2,
            anchor: at("D20"),
            data: png.into(),
            mime: "image/png".into(),
            alt: "Logo".into(),
        });
    });
    let counted = inventory(&file).unwrap();
    for mark in ["Vendite", "Logo"] {
        assert!(holds(&counted, mark), "{mark}");
    }
    assert_eq!(
        all_differences(&file, &rewritten(&file, |_| {})),
        Vec::<String>::new()
    );
    let without = rewritten(&file, |wb| wb.sheet_mut(0).unwrap().charts.clear());
    let lost = differences(&counted, &inventory(&without).unwrap(), |_| true);
    assert!(
        lost.iter()
            .any(|d| d.after < d.before && d.key.value.contains("Vendite")),
        "{lost:#?}"
    );
}

#[test]
fn una_perdita_della_riscrittura_si_conta() {
    let file = rich();
    let b2 = gridcraft_core::CellRef::new(1, 1);
    let lost = rewritten(&file, |wb| {
        let sheet = wb.sheet_mut(0).unwrap();
        sheet.comments.remove(&b2);
        sheet.hyperlinks.clear();
    });
    let found = all_differences(&file, &lost);
    assert!(found.iter().any(|d| d.contains("hyperlink")), "{found:#?}");
    assert!(
        found.iter().any(|d| d.contains("da rivedere")),
        "{found:#?}"
    );
}

#[test]
fn cio_che_excel_ricava_non_si_conta() {
    let base = r#"<sheetFormatPr defaultColWidth="9" defaultRowHeight="15"/><cols><col min="1" max="1" width="12" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1"><v>1.0</v></c></row></sheetData>"#;
    let same = r#"<dimension ref="A1:B1"/><sheetFormatPr defaultColWidth="9.0" defaultRowHeight="15"/><cols><col min="1" max="1" width="12.0" bestFit="1"/><col min="2" max="9" width="9"/></cols><sheetData><row r="1" spans="1:2"><c r="A1" t="b"><v>true</v></c><c r="B1"><v>1</v></c></row></sheetData>"#;
    let saved_in = r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x15"><x15ac:absPath xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac" url="C:\Utenti\Anna\"/></mc:Choice></mc:AlternateContent>"#;
    let a = common::one_sheet(base);
    let b = common::Package {
        sheets: vec![common::sheet("Foglio1", same)],
        workbook_tail: Box::leak(saved_in.to_string().into_boxed_str()),
        ..common::Package::default()
    }
    .bytes();
    assert_eq!(all_differences(&a, &b), Vec::<String>::new());
    // Una colonna più larga della predefinita conta.
    let wider = common::one_sheet(&base.replace(
        r#"<col min="1" max="1" width="12" customWidth="1"/>"#,
        r#"<col min="1" max="2" width="12"/>"#,
    ));
    assert_eq!(
        all_differences(&a, &wider),
        ["0 → 1: sheet 1 col (0,1): width=12"]
    );
}

#[test]
fn gli_elementi_vuoti_valgono_i_predefiniti() {
    let data = r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>"#;
    let empty =
        format!(r#"<sheetPr><pageSetUpPr/></sheetPr>{data}<printOptions gridLinesSet="1"/>"#);
    let a = common::one_sheet(data);
    let b = common::Package {
        sheets: vec![common::sheet("Foglio1", &empty)],
        workbook_tail: "<workbookProtection/>",
        ..common::Package::default()
    }
    .bytes();
    assert_eq!(all_differences(&a, &b), Vec::<String>::new());
    // La griglia stampata conta.
    let printed = common::one_sheet(&format!(r#"{data}<printOptions gridLines="1"/>"#));
    assert_eq!(
        all_differences(&a, &printed),
        [r#"0 → 1: sheet 1 printOptions: <printOptions gridLines="1"></>"#]
    );
}

#[test]
fn un_xml_rotto_non_si_inventaria() {
    let broken =
        common::one_sheet("<sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></row></sheetData>");
    assert!(
        matches!(inventory(&broken), Err(InventoryError::Xml { .. })),
        "{:?}",
        inventory(&broken).err()
    );
    assert!(matches!(
        inventory(b"non un pacchetto"),
        Err(InventoryError::Package(_))
    ));
}

#[test]
fn le_formule_condivise_si_spostano_come_in_excel() {
    assert_eq!(shift_formula("A1+$B$1+B$2+$C3", 2, 1), "B3+$B$1+C$2+$C5");
    assert_eq!(shift_formula("SUM(A1:A3)", 1, 0), "SUM(A2:A4)");
    assert_eq!(
        shift_formula("\"A1\"&'Q1 data'!A1", 1, 1),
        "\"A1\"&'Q1 data'!B2"
    );
    assert_eq!(shift_formula("LOG10(A1)", 1, 0), "LOG10(A2)");
    assert_eq!(
        shift_formula("Tabella1[Colonna1]+A1", 0, 1),
        "Tabella1[Colonna1]+B1"
    );
    assert_eq!(
        shift_formula("SUM(A:A)+SUM(1:1)", 1, 1),
        "SUM(B:B)+SUM(2:2)"
    );
    assert_eq!(shift_formula("A1", -1, 0), "#REF!");
    assert_eq!(shift_formula("Sheet2!A1*2.5E+3", 1, 0), "Sheet2!A2*2.5E+3");
}

#[test]
fn i_numeri_e_i_booleani_hanno_una_forma_sola() {
    assert_eq!(number("1.0"), "1");
    assert_eq!(number("0.10"), "0.1");
    assert_eq!(number("-0"), "0");
    assert_eq!(number("007a"), "007a");
    assert_eq!(boolean("true"), Some(true));
    assert_eq!(cell_ref("$B$12"), Some((11, 1)));
    assert_eq!(cell_ref("XFE1"), None);
}
