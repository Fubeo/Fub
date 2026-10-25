//! Ciò che la griglia mostra di una cartella: i valori del file formattati
//! come li mostra Excel, anche quelli versati dalle matrici, senza ricalcolare
//! niente, l'aspetto che la griglia disegna, le misure delle righe e delle
//! colonne, e gli avvisi per ciò che non si vede o non si esegue.

mod common;

use common::{one_sheet, sheet, Package};
use fub_abi::{
    GridBytesCell, GridBytesProvider, GridBytesSession, GridBytesWindow, GridCellStyle,
    GridHorizontalAlign, GridJournal, GridValue, GridWindowRequest, PluginError, Revision,
    MAX_GRID_SESSION_COLUMNS, MAX_GRID_SESSION_ROWS,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};

struct Opened {
    provider: XlsxGridProvider,
    session: GridBytesSession,
}

fn open(bytes: &[u8]) -> Result<Opened, PluginError> {
    let mut provider = XlsxGridProvider::new();
    let session = provider.open(
        XLSX_GRID_SURFACE,
        bytes,
        Revision::of_bytes(bytes),
        &GridJournal::new(),
    )?;
    Ok(Opened { provider, session })
}

impl Opened {
    fn window(&mut self, sheet: usize, rows: (u32, u32), columns: (u32, u32)) -> GridBytesWindow {
        self.provider
            .window(
                &self.session.instance,
                GridWindowRequest {
                    revision: self.session.revision.clone(),
                    sheet: self.session.sheets[sheet].id.clone(),
                    row_start: rows.0,
                    row_count: rows.1,
                    column_start: columns.0,
                    column_count: columns.1,
                    known_media: Vec::new(),
                },
            )
            .expect("window")
    }

    /// La cella in `row`/`column` del primo foglio.
    fn cell(&mut self, row: u32, column: u32) -> GridBytesCell {
        let window = self.window(0, (row, 1), (column, 1));
        window
            .cells
            .into_iter()
            .next()
            .unwrap_or_else(|| panic!("la cella {row}/{column} non c'è"))
    }

    /// Lo stile della cella, dalla tavola degli stili della sua finestra.
    fn style(&mut self, row: u32, column: u32) -> GridCellStyle {
        let window = self.window(0, (row, 1), (column, 1));
        let cell = window
            .cells
            .first()
            .unwrap_or_else(|| panic!("la cella {row}/{column} non c'è"));
        window.styles[cell.style as usize].clone()
    }

    fn notices(&self) -> Vec<(&str, u32)> {
        self.session
            .notices
            .iter()
            .map(|notice| (notice.code.as_str(), notice.count))
            .collect()
    }
}

fn opened(bytes: &[u8]) -> Opened {
    open(bytes).expect("la cartella si apre")
}

#[test]
fn i_valori_sono_quelli_del_file_con_il_loro_formato() {
    let mut p = opened(&one_sheet(
        r#"<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Voce</t></is></c><c r="B1"><v>1234.5</v></c><c r="C1" s="1"><v>0.25</v></c><c r="D1" s="5"><v>45000</v></c></row>
<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="e"><v>#DIV/0!</v></c><c r="C2" s="6"><v>-3</v></c><c r="D2"><f>B1*2</f><v>99</v></c></row>
</sheetData>"#,
    ));
    let shown = |p: &mut Opened, row, column| {
        let cell = p.cell(row, column);
        (cell.value, cell.display)
    };
    assert_eq!(
        shown(&mut p, 0, 0),
        (GridValue::Text("Voce".into()), "Voce".into())
    );
    assert_eq!(
        shown(&mut p, 0, 1),
        (GridValue::Number(1234.5), "1234.5".into())
    );
    assert_eq!(
        shown(&mut p, 0, 2),
        (GridValue::Number(0.25), "25.00%".into())
    );
    assert_eq!(shown(&mut p, 0, 3).1, "2023-03-15");
    assert_eq!(
        shown(&mut p, 1, 0),
        (GridValue::Boolean(true), "TRUE".into())
    );
    assert_eq!(
        shown(&mut p, 1, 1),
        (GridValue::Error("#DIV/0!".into()), "#DIV/0!".into())
    );
    assert_eq!(shown(&mut p, 1, 2).1, "-3");
    // La formula è l'input; il valore resta quello salvato, anche se il
    // calcolo darebbe altro.
    let formula = p.cell(1, 3);
    assert_eq!(formula.input, "=B1*2");
    assert_eq!(formula.display, "99");
    // L'input di un numero è quello del file, non il suo formato.
    assert_eq!(p.cell(0, 2).input, "0.25");
    assert!(p.session.notices.is_empty(), "{:?}", p.session.notices);
    // Il foglio arriva fino all'ultima cella mostrata, più un margine per
    // scrivere.
    let sheet = &p.session.sheets[0];
    assert_eq!((sheet.row_count, sheet.column_count), (102, 26));
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
    assert_eq!(opened(&bytes).cell(0, 0).display, "1904-01-01");
}

#[test]
fn l_aspetto_segue_il_file_e_il_tema_della_shell() {
    let mut p = opened(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1" s="3" t="inlineStr"><is><t>titolo</t></is></c><c r="B1" s="4" t="inlineStr"><is><t>giallo</t></is></c><c r="C1" s="7" t="inlineStr"><is><t>nero</t></is></c><c r="D1"><v>7</v></c><c r="E1" s="6"><v>-1</v></c><c r="F1" t="b"><v>0</v></c><c r="G1" s="4"/></row></sheetData>"#,
    ));
    let plain = GridCellStyle::default();
    assert_eq!(
        p.style(0, 0),
        GridCellStyle {
            bold: true,
            italic: true,
            text_color: Some("#FF0000".into()),
            horizontal: Some(GridHorizontalAlign::Center),
            ..plain.clone()
        }
    );
    // Sul riempimento del file il testo automatico è il nero di Excel.
    assert_eq!(
        p.style(0, 1),
        GridCellStyle {
            fill_color: Some("#FFFF00".into()),
            text_color: Some("#000000".into()),
            ..plain.clone()
        }
    );
    // Il nero del tema senza riempimento è il testo della shell.
    assert_eq!(
        p.style(0, 2),
        GridCellStyle {
            horizontal: Some(GridHorizontalAlign::Start),
            ..plain
        }
    );
    // I numeri vanno a destra, i booleani al centro; il rosso del formato
    // numerico colora il testo.
    assert_eq!(p.style(0, 3).horizontal, Some(GridHorizontalAlign::End));
    assert_eq!(p.style(0, 4).text_color.as_deref(), Some("#FF0000"));
    assert_eq!(p.style(0, 5).horizontal, Some(GridHorizontalAlign::Center));
    // Una cella vuota ma riempita si vede.
    let filled = p.cell(0, 6);
    assert_eq!(
        (filled.value, filled.display.as_str()),
        (GridValue::Blank, "")
    );
    assert_eq!(p.style(0, 6).fill_color.as_deref(), Some("#FFFF00"));
}

#[test]
fn le_celle_versate_hanno_i_valori_del_file_e_niente_si_ricalcola() {
    // Una matrice dinamica (`cm`) e una legacy, con i valori versati in cache;
    // una formula salvata senza valore; un valore casuale salvato.
    let mut p = opened(&one_sheet(
        r#"<sheetData>
<row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f><v>1</v></c><c r="B1"><f t="array" ref="B1:B2">C1:C2*10</f><v>10</v></c><c r="C1"><v>1</v></c><c r="D1"><f>C1+C2</f></c><c r="E1"><f>RAND()</f><v>0.25</v></c></row>
<row r="2"><c r="A2"><v>7</v></c><c r="B2"><v>20</v></c><c r="C2"><v>2</v></c></row>
<row r="3"><c r="A3"><v>9</v></c></row>
</sheetData>"#,
    ));
    assert_eq!(p.cell(0, 0).input, "=SEQUENCE(3)");
    // I valori versati sono quelli salvati, anche se la formula darebbe 2 e
    // 3; la cella versata non ha un input suo, e non si scrive.
    for (row, text) in [(1, "7"), (2, "9")] {
        let spilled = p.cell(row, 0);
        assert_eq!(spilled.input, "", "A{}", row + 1);
        assert_eq!(spilled.display, text, "A{}", row + 1);
        assert!(spilled.lock.is_some(), "A{}", row + 1);
    }
    assert_eq!(p.cell(0, 1).input, "{=C1:C2*10}");
    assert_eq!(p.cell(1, 1).display, "20");
    let unsaved = p.cell(0, 3);
    assert_eq!(unsaved.input, "=C1+C2");
    assert_eq!(
        (unsaved.value, unsaved.display.as_str()),
        (GridValue::Blank, "")
    );
    assert_eq!(p.cell(0, 4).display, "0.25");
    assert_eq!(p.notices(), [("uncomputed", 1)]);
}

#[test]
fn una_formula_che_il_calcolo_non_saprebbe_fermare_si_apre_subito() {
    // Pochi byte che, ricalcolati, verserebbero tutto il foglio.
    let started = std::time::Instant::now();
    let mut p = opened(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1" cm="1"><f t="array" ref="A1">_xlfn.SEQUENCE(1048576,16384)</f></c><c r="B1"><f>B1+1</f></c></row></sheetData>"#,
    ));
    assert!(p.cell(0, 0).display.is_empty());
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    let sheet = &p.session.sheets[0];
    assert_eq!((sheet.row_count, sheet.column_count), (101, 26));
    assert_eq!(p.notices(), [("uncomputed", 2)]);
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
    let mut p = opened(&bytes);
    assert_eq!(p.notices(), [("external-links", 1), ("macros", 1)]);
    // Il valore resta quello salvato: il collegamento non si segue.
    assert_eq!(p.cell(0, 0).display, "7");
}

#[test]
fn le_unioni_e_la_formattazione_condizionale_si_disegnano_e_non_si_dicono() {
    let p = opened(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><conditionalFormatting sqref="A1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>"#,
    ));
    assert!(p.notices().is_empty(), "{:?}", p.notices());
}

#[test]
fn ciò_che_la_lettura_lascia_indietro_si_dice() {
    let p = opened(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1" t="s"><v>5</v></c></row></sheetData>"#,
    ));
    assert_eq!(p.notices(), [("incomplete", 1)]);
}

#[test]
fn fogli_nascosti_righe_e_colonne_con_le_loro_misure() {
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
        ..Package::default()
    }
    .bytes();
    let mut p = opened(&bytes);
    assert_eq!(p.session.hidden, [p.session.sheets[1].id.clone()]);
    let window = p.window(0, (0, 4), (0, 4));
    // Le misure sono in pixel: la riga di serie di 18 punti è di 24.
    assert_eq!(
        window
            .rows
            .iter()
            .map(|row| (row.height, row.hidden))
            .collect::<Vec<_>>(),
        [
            (Some(24.0), false),
            (Some(40.0), false),
            (Some(24.0), true),
            (Some(24.0), false)
        ]
    );
    assert_eq!(
        window
            .columns
            .iter()
            .map(|column| (column.width, column.hidden))
            .collect::<Vec<_>>(),
        [
            (Some(64.0), false),
            (Some(140.0), false),
            (Some(63.0), true),
            (Some(64.0), false)
        ]
    );
    // Un foglio nascosto si apre lo stesso, vuoto.
    let hidden = p.window(1, (0, 4), (0, 4));
    assert!(hidden.cells.is_empty());
    let sheet = &p.session.sheets[1];
    assert_eq!((sheet.row_count, sheet.column_count), (100, 26));
}

#[test]
fn una_cella_in_fondo_al_foglio_si_vede_con_una_finestra_laggiù() {
    // Ogni foglio ha una cella nell'ultima riga e nell'ultima colonna di
    // Excel: la sessione dice tutto il foglio, e una finestra ne legge una
    // parte sola.
    let far = r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="1048576"><c r="XFD1048576"><v>2</v></c></row></sheetData>"#;
    let bytes = Package {
        sheets: vec![sheet("Uno", far), sheet("Due", far)],
        ..Package::default()
    }
    .bytes();
    let mut p = opened(&bytes);
    for (index, sheet) in p.session.sheets.clone().iter().enumerate() {
        assert_eq!(
            (sheet.row_count, sheet.column_count),
            (MAX_GRID_SESSION_ROWS, MAX_GRID_SESSION_COLUMNS)
        );
        let corner = p.window(
            index,
            (MAX_GRID_SESSION_ROWS - 2, 2),
            (MAX_GRID_SESSION_COLUMNS - 2, 2),
        );
        assert_eq!(corner.cells.len(), 1);
        assert_eq!(corner.cells[0].display, "2");
    }
    assert!(p.session.notices.is_empty());
}

#[test]
fn il_contenuto_che_non_è_una_cartella_si_rifiuta() {
    assert!(matches!(
        open(&common::encrypted()),
        Err(PluginError::PermissionDenied(_))
    ));
    assert!(matches!(
        open(b"a,b\n1,2\n"),
        Err(PluginError::BadArgs(message)) if message.to_string().contains("csv")
    ));
    assert!(matches!(open(b""), Err(PluginError::BadArgs(_))));
    // Uno zip qualunque: non c'è la cartella.
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file("ciao.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    std::io::Write::write_all(&mut writer, b"ciao").unwrap();
    let zip = writer.finish().unwrap().into_inner();
    assert!(matches!(open(&zip), Err(PluginError::BadArgs(_))));
}

#[test]
fn la_stessa_cartella_si_mostra_sempre_uguale() {
    let bytes = one_sheet(
        r#"<sheetData><row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f><v>1</v></c><c r="B1" s="3"><v>2</v></c></row></sheetData>"#,
    );
    let (mut one, mut two) = (opened(&bytes), opened(&bytes));
    assert_eq!(
        (one.session.revision.clone(), one.session.sheets.clone()),
        (two.session.revision.clone(), two.session.sheets.clone())
    );
    assert_eq!(
        one.window(0, (0, 10), (0, 10)),
        two.window(0, (0, 10), (0, 10))
    );
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
    let mut p = opened(&one_sheet(&body));
    assert_eq!(p.cell(rows - 1, 0).value, GridValue::Number(5000.0));
    assert!(p.session.notices.is_empty());
}

#[test]
fn una_cella_senza_niente_da_mostrare_non_allarga_il_foglio() {
    // Uno stile senza riempimento, in fondo al foglio, non si vede.
    let p = opened(&one_sheet(
        r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="900000"><c r="Z900000" s="3"/></row></sheetData>"#,
    ));
    let sheet = &p.session.sheets[0];
    assert_eq!((sheet.row_count, sheet.column_count), (101, 26));
    assert!(p.session.notices.is_empty());
}
