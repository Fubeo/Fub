//! La proiezione di una cartella: i valori del file formattati come li mostra
//! Excel, anche quelli versati dalle matrici, senza ricalcolare niente,
//! l'aspetto che la griglia disegna, gli avvisi per ciò che non si vede o non
//! si esegue, e i limiti di byte e di righe e colonne.

mod common;

use common::{one_sheet, sheet, Package};
use fub_format_xlsx::projection::{
    classify, Cell, Horizontal, Notice, NoticeKind, Projection, Style, ValueKind, MAX_LINES,
};
use fub_format_xlsx::{open, XlsxError, MAX_PROJECTION_BYTES};

fn project(bytes: &[u8]) -> Projection {
    Projection::from_json(&open(bytes).expect("la cartella si apre")).expect("proiezione")
}

fn cell(p: &Projection, sheet: usize, row: u32, col: u32) -> &Cell {
    p.sheets[sheet]
        .cells
        .iter()
        .find(|cell| cell.row == row && cell.col == col)
        .unwrap_or_else(|| panic!("la cella {row}/{col} del foglio {sheet}"))
}

fn shown(p: &Projection, row: u32, col: u32) -> (ValueKind, &str) {
    let value = cell(p, 0, row, col).value.as_ref().expect("un valore");
    (value.kind, value.text.as_str())
}

fn kinds(p: &Projection) -> Vec<NoticeKind> {
    p.notices.iter().map(|notice| notice.kind).collect()
}

#[test]
fn i_valori_sono_quelli_del_file_con_il_loro_formato() {
    let p = project(&one_sheet(
        r#"<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Voce</t></is></c><c r="B1"><v>1234.5</v></c><c r="C1" s="1"><v>0.25</v></c><c r="D1" s="5"><v>45000</v></c></row>
<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="e"><v>#DIV/0!</v></c><c r="C2" s="6"><v>-3</v></c><c r="D2"><f>B1*2</f><v>99</v></c></row>
</sheetData>"#,
    ));
    assert_eq!(shown(&p, 0, 0), (ValueKind::Text, "Voce"));
    assert_eq!(shown(&p, 0, 1), (ValueKind::Number, "1234.5"));
    assert_eq!(shown(&p, 0, 2), (ValueKind::Number, "25.00%"));
    assert_eq!(shown(&p, 0, 3), (ValueKind::Number, "2023-03-15"));
    assert_eq!(shown(&p, 1, 0), (ValueKind::Boolean, "TRUE"));
    assert_eq!(shown(&p, 1, 1), (ValueKind::Error, "#DIV/0!"));
    assert_eq!(shown(&p, 1, 2), (ValueKind::Number, "-3"));
    // La formula si mostra nella barra; il valore resta quello salvato, anche
    // se il calcolo darebbe altro.
    let formula = cell(&p, 0, 1, 3);
    assert_eq!(formula.formula.as_deref(), Some("=B1*2"));
    assert_eq!(shown(&p, 1, 3), (ValueKind::Number, "99"));
    assert!(p.notices.is_empty(), "{:?}", p.notices);
    // Gli assi arrivano fino all'ultima cella mostrata.
    assert_eq!((p.sheets[0].row_count, p.sheets[0].column_count), (2, 4));
}

#[test]
fn il_sistema_1904_sposta_le_date() {
    let body = r#"<sheetData><row r="1"><c r="A1" s="5"><v>0</v></c></row></sheetData>"#;
    let bytes = Package {
        sheets: vec![sheet("Foglio1", body)],
        workbook_pr: r#"date1904="1""#,
        ..Package::default()
    }
    .bytes();
    assert_eq!(shown(&project(&bytes), 0, 0).1, "1904-01-01");
}

#[test]
fn l_aspetto_segue_il_file_e_il_tema_della_shell() {
    let p = project(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1" s="3" t="inlineStr"><is><t>titolo</t></is></c><c r="B1" s="4" t="inlineStr"><is><t>giallo</t></is></c><c r="C1" s="7" t="inlineStr"><is><t>nero</t></is></c><c r="D1"><v>7</v></c><c r="E1" s="6"><v>-1</v></c><c r="F1" t="b"><v>0</v></c><c r="G1" s="4"/></row></sheetData>"#,
    ));
    let style = |col| cell(&p, 0, 0, col).style.clone().unwrap_or_default();
    assert_eq!(
        style(0),
        Style {
            bold: true,
            italic: true,
            text_color: Some("#FF0000".into()),
            fill_color: None,
            horizontal: Some(Horizontal::Center),
        }
    );
    // Sul riempimento del file il testo automatico è il nero di Excel.
    assert_eq!(
        style(1),
        Style {
            fill_color: Some("#FFFF00".into()),
            text_color: Some("#000000".into()),
            ..Style::default()
        }
    );
    // Il nero del tema senza riempimento è il testo della shell.
    assert_eq!(
        style(2),
        Style {
            horizontal: Some(Horizontal::Start),
            ..Style::default()
        }
    );
    // I numeri vanno a destra, i booleani al centro; il rosso del formato
    // numerico colora il testo.
    assert_eq!(style(3).horizontal, Some(Horizontal::End));
    assert_eq!(style(4).text_color.as_deref(), Some("#FF0000"));
    assert_eq!(style(5).horizontal, Some(Horizontal::Center));
    // Una cella vuota ma riempita si vede.
    assert!(cell(&p, 0, 0, 6).value.is_none());
    assert_eq!(style(6).fill_color.as_deref(), Some("#FFFF00"));
}

#[test]
fn le_celle_versate_hanno_i_valori_del_file_e_niente_si_ricalcola() {
    // Una matrice dinamica (`cm`) e una legacy, con i valori versati in cache;
    // una formula salvata senza valore; un valore casuale salvato.
    let p = project(&one_sheet(
        r#"<sheetData>
<row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f><v>1</v></c><c r="B1"><f t="array" ref="B1:B2">C1:C2*10</f><v>10</v></c><c r="C1"><v>1</v></c><c r="D1"><f>C1+C2</f></c><c r="E1"><f>RAND()</f><v>0.25</v></c></row>
<row r="2"><c r="A2"><v>7</v></c><c r="B2"><v>20</v></c><c r="C2"><v>2</v></c></row>
<row r="3"><c r="A3"><v>9</v></c></row>
</sheetData>"#,
    ));
    let anchor = cell(&p, 0, 0, 0);
    assert_eq!(anchor.formula.as_deref(), Some("=SEQUENCE(3)"));
    // I valori versati sono quelli salvati, anche se la formula darebbe 2 e 3.
    for (row, text) in [(1, "7"), (2, "9")] {
        let spilled = cell(&p, 0, row, 0);
        assert!(spilled.formula.is_none());
        assert_eq!(spilled.value.as_ref().unwrap().text, text, "A{}", row + 1);
    }
    assert_eq!(cell(&p, 0, 0, 1).formula.as_deref(), Some("{=C1:C2*10}"));
    assert_eq!(cell(&p, 0, 1, 1).value.as_ref().unwrap().text, "20");
    let unsaved = cell(&p, 0, 0, 3);
    assert_eq!(unsaved.formula.as_deref(), Some("=C1+C2"));
    assert!(unsaved.value.is_none());
    assert_eq!(shown(&p, 0, 4), (ValueKind::Number, "0.25"));
    assert_eq!(kinds(&p), [NoticeKind::Uncomputed]);
}

#[test]
fn una_formula_che_il_calcolo_non_saprebbe_fermare_si_apre_subito() {
    // Pochi byte che, ricalcolati, verserebbero tutto il foglio.
    let started = std::time::Instant::now();
    let p = project(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1" cm="1"><f t="array" ref="A1">_xlfn.SEQUENCE(1048576,16384)</f></c><c r="B1"><f>B1+1</f></c></row></sheetData>"#,
    ));
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert!(cell(&p, 0, 0, 0).value.is_none());
    assert_eq!((p.sheets[0].row_count, p.sheets[0].column_count), (1, 2));
    assert_eq!(kinds(&p), [NoticeKind::Uncomputed]);
}

#[test]
fn le_macro_e_i_collegamenti_esterni_si_dicono() {
    let body =
        r#"<sheetData><row r="1"><c r="A1"><f>[1]Altro!A1</f><v>7</v></c></row></sheetData>"#;
    let external = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalBook r:id="rId1"><sheetNames><sheetName val="Altro"/></sheetNames><sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1"><v>7</v></cell></row></sheetData></sheetDataSet></externalBook></externalLink>"#;
    let external_rels = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="altro.xlsx" TargetMode="External"/></Relationships>"#;
    let bytes = Package {
        sheets: vec![sheet("Foglio1", body)],
        workbook_tail: r#"<externalReferences><externalReference r:id="rExt"/></externalReferences>"#,
        workbook_rels: vec![
            (
                "rExt",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink",
                "externalLinks/externalLink1.xml",
            ),
            (
                "rVba",
                "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
                "vbaProject.bin",
            ),
        ],
        parts: vec![
            (
                "xl/externalLinks/externalLink1.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml",
                external.to_vec(),
            ),
            (
                "xl/externalLinks/_rels/externalLink1.xml.rels",
                "application/vnd.openxmlformats-package.relationships+xml",
                external_rels.to_vec(),
            ),
            (
                "xl/vbaProject.bin",
                "application/vnd.ms-office.vbaProject",
                b"\xd0\xcf\x11\xe0VBA-di-prova".repeat(8),
            ),
        ],
        main_type: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
        ..Package::default()
    }
    .bytes();
    let p = project(&bytes);
    assert_eq!(kinds(&p), [NoticeKind::Macros, NoticeKind::ExternalLinks]);
    // Il valore resta quello salvato: il collegamento non si segue.
    assert_eq!(shown(&p, 0, 0).1, "7");
}

#[test]
fn ciò_che_la_griglia_non_disegna_si_dice() {
    let p = project(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><conditionalFormatting sqref="A1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>"#,
    ));
    let not_shown: Vec<_> = p
        .notices
        .iter()
        .filter(|notice| notice.kind == NoticeKind::NotShown)
        .map(|notice| notice.detail.as_deref().unwrap())
        .collect();
    assert_eq!(not_shown, ["conditional_formats", "merges"]);
}

#[test]
fn gli_avvisi_della_lettura_hanno_un_tipo() {
    assert_eq!(
        classify("macros (VBA project) were kept but not executed"),
        NoticeKind::Macros
    );
    assert_eq!(
        classify("links to external workbooks were kept; they are not followed or refreshed"),
        NoticeKind::ExternalLinks
    );
    // Ogni altro avviso è qualcosa che la lettura ha lasciato indietro, anche
    // quando dice che il codec lo terrebbe per salvare: da qui non si salva.
    for warning in [
        "links to external workbooks were dropped: bad",
        "chart sheet \"Grafico\" was skipped and is not kept on save",
        "sheet \"A\": embedded objects and form controls are not shown; they are kept for saving",
        "what-if data tables are not supported; kept their values",
    ] {
        assert_eq!(classify(warning), NoticeKind::Incomplete, "{warning}");
    }
}

#[test]
fn un_avviso_della_lettura_porta_il_suo_testo() {
    let p = project(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1" t="s"><v>5</v></c></row></sheetData>"#,
    ));
    assert_eq!(
        p.notices,
        [Notice {
            kind: NoticeKind::Incomplete,
            detail: Some("some cells refer to missing shared strings".into())
        }]
    );
}

#[test]
fn fogli_nascosti_assi_e_dimensioni() {
    let first = r#"<sheetFormatPr defaultRowHeight="18"/><cols><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="9" hidden="1"/></cols><sheetData><row r="2" ht="30" customHeight="1"><c r="C2"><v>1</v></c></row><row r="3" hidden="1"><c r="A3"><v>2</v></c></row></sheetData>"#;
    let bytes = Package {
        sheets: vec![
            sheet("Primo", first),
            common::SheetPart {
                name: "Nascosto",
                body: "<sheetData/>",
                hidden: true,
            },
        ],
        workbook_tail: "",
        ..Package::default()
    }
    .bytes();
    let p = project(&bytes);
    let primo = &p.sheets[0];
    assert_eq!((primo.row_count, primo.column_count), (3, 3));
    assert_eq!(primo.row_height, 24.0);
    assert_eq!(primo.column_width, 64.0);
    assert_eq!(
        primo
            .rows
            .iter()
            .map(|line| (line.index, line.size, line.hidden))
            .collect::<Vec<_>>(),
        [(1, Some(40.0), false), (2, None, true)]
    );
    assert_eq!(
        primo
            .columns
            .iter()
            .map(|line| (line.index, line.hidden))
            .collect::<Vec<_>>(),
        [(1, false), (2, true)]
    );
    assert_eq!(primo.columns[0].size, Some(140.0));
    let nascosto = &p.sheets[1];
    assert!(nascosto.hidden && !primo.hidden);
    assert_eq!(
        (
            nascosto.row_count,
            nascosto.column_count,
            nascosto.cells.len()
        ),
        (1, 1, 0)
    );
}

#[test]
fn oltre_il_limite_le_celle_si_fermano_e_lo_si_dice() {
    // Celle di testo lunghe: ognuna pesa un mezzo kilobyte nella proiezione.
    let text = "x".repeat(500);
    let rows = MAX_PROJECTION_BYTES / 500 + 10;
    let mut body = String::from("<sheetData>");
    for row in 1..=rows {
        body.push_str(&format!(
            r#"<row r="{row}"><c r="A{row}" t="inlineStr"><is><t>{text}</t></is></c></row>"#
        ));
    }
    body.push_str("</sheetData>");
    let json = open(&one_sheet(&body)).expect("si apre lo stesso");
    assert!(json.len() <= MAX_PROJECTION_BYTES);
    let p = Projection::from_json(&json).unwrap();
    assert!(p.sheets[0].cells.len() < rows);
    assert_eq!(
        p.notices,
        [Notice {
            kind: NoticeKind::Truncated,
            detail: Some("Foglio1".into())
        }]
    );
}

#[test]
fn il_contenuto_che_non_è_una_cartella_si_rifiuta() {
    assert_eq!(open(&common::encrypted()), Err(XlsxError::Encrypted));
    assert_eq!(open(b"a,b\n1,2\n"), Err(XlsxError::NotXlsx("csv")));
    assert_eq!(open(b""), Err(XlsxError::NotXlsx("unknown")));
    // Uno zip qualunque: non c'è la cartella.
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file("ciao.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    std::io::Write::write_all(&mut writer, b"ciao").unwrap();
    let zip = writer.finish().unwrap().into_inner();
    assert!(matches!(open(&zip), Err(XlsxError::Codec(_))));
}

#[test]
fn la_proiezione_è_deterministica() {
    let bytes = one_sheet(
        r#"<sheetData><row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f><v>1</v></c><c r="B1" s="3"><v>2</v></c></row></sheetData>"#,
    );
    assert_eq!(open(&bytes).unwrap(), open(&bytes).unwrap());
}

#[test]
fn una_catena_lunga_di_formule_si_legge_senza_calcolarla() {
    let rows = 5000;
    let mut body = String::from(r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row>"#);
    for row in 2..=rows {
        body.push_str(&format!(
            r#"<row r="{row}"><c r="A{row}"><f>A{}+1</f><v>{row}</v></c></row>"#,
            row - 1
        ));
    }
    body.push_str("</sheetData>");
    let p = project(&one_sheet(&body));
    assert_eq!(shown(&p, rows - 1, 0), (ValueKind::Number, "5000"));
    assert!(p.notices.is_empty());
}

#[test]
fn una_cella_in_fondo_al_foglio_non_porta_un_milione_di_righe() {
    // Ogni foglio ha una cella nell'ultima riga e nell'ultima colonna di
    // Excel: la griglia terrebbe una voce per ogni riga e colonna.
    let far = r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="1048576"><c r="XFD1048576"><v>2</v></c></row></sheetData>"#;
    let bytes = Package {
        sheets: vec![sheet("Uno", far), sheet("Due", far), sheet("Tre", far)],
        ..Package::default()
    }
    .bytes();
    let p = project(&bytes);
    let lines: u32 = p
        .sheets
        .iter()
        .map(|sheet| sheet.row_count + sheet.column_count)
        .sum();
    assert!(lines <= MAX_LINES, "{lines} righe e colonne");
    for sheet in &p.sheets {
        assert_eq!(sheet.cells[0].value.as_ref().unwrap().text, "1");
        assert!(sheet
            .cells
            .iter()
            .all(|cell| cell.row < sheet.row_count && cell.col < sheet.column_count));
    }
    assert_eq!(
        p.notices,
        // Gli avvisi sono in ordine, e i fogli per nome.
        ["Due", "Tre", "Uno"].map(|name| Notice {
            kind: NoticeKind::Truncated,
            detail: Some(name.into())
        })
    );
}

#[test]
fn una_cella_senza_niente_da_mostrare_non_allarga_il_foglio() {
    // Uno stile senza riempimento, in fondo al foglio, non si vede.
    let p = project(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="900000"><c r="Z900000" s="3"/></row></sheetData>"#,
    ));
    assert_eq!((p.sheets[0].row_count, p.sheets[0].column_count), (1, 1));
    assert!(p.notices.is_empty());
}

#[test]
fn le_righe_con_un_altezza_loro_contano_nel_limite() {
    // Ogni riga ha un'altezza sua, e le celle da sole riempiono la proiezione:
    // le righe, contate dopo, la porterebbero oltre il limite.
    let rows = 120_000;
    let text = "x".repeat(150);
    let mut body = String::from("<sheetData>");
    for row in 1..=rows {
        body.push_str(&format!(
            r#"<row r="{row}" ht="17.25" customHeight="1" hidden="1"><c r="A{row}" t="inlineStr"><is><t>{text}</t></is></c></row>"#
        ));
    }
    body.push_str("</sheetData>");
    let json = open(&one_sheet(&body)).expect("si apre lo stesso");
    assert!(json.len() <= MAX_PROJECTION_BYTES);
    let p = Projection::from_json(&json).unwrap();
    let sheet = &p.sheets[0];
    assert!(sheet.rows.len() <= sheet.row_count as usize);
    assert_eq!(sheet.rows.last().unwrap().index, sheet.row_count - 1);
    assert_eq!(kinds(&p), [NoticeKind::Truncated]);
}
