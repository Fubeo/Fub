//! La copia in Excel di un `.fubsheet`: ciò che porta, e ciò che non porta
//! detto con il numero.

mod common;

use common::soffice;
use fub_format_sheet::Workbook as SheetWorkbook;
use fub_format_xlsx::fubsheet::{copy, Copy, Note};
use gridcraft_core::{CellRef, Value};
use gridcraft_model::{Color, HAlign, Workbook};

fn sheet(json: serde_json::Value) -> SheetWorkbook {
    SheetWorkbook::parse(&json.to_string()).unwrap()
}

fn read(copy: &Copy) -> Workbook {
    gridcraft_xlsx::read_xlsx(&copy.bytes).unwrap().0
}

fn at(a1: &str) -> CellRef {
    CellRef::parse(a1).unwrap()
}

fn warnings(copy: &Copy) -> Vec<&str> {
    copy.notes
        .iter()
        .filter(|note| note.warning)
        .map(|note| note.text.as_str())
        .collect()
}

fn rows(n: usize) -> Vec<serde_json::Value> {
    (0..n)
        .map(|i| serde_json::json!({ "id": format!("r{i}") }))
        .collect()
}

fn columns(n: usize) -> Vec<serde_json::Value> {
    (0..n)
        .map(|i| serde_json::json!({ "id": format!("c{i}") }))
        .collect()
}

fn cell(row: usize, column: usize, input: &str) -> serde_json::Value {
    serde_json::json!({ "row": format!("r{row}"), "column": format!("c{column}"), "input": input })
}

#[test]
fn la_copia_porta_valori_formule_stili_e_dimensioni() {
    let source = sheet(serde_json::json!({
        "version": 1,
        "sheets": [
            {
                "id": "s1",
                "name": "Conti",
                // L'ordine delle righe e delle colonne è quello che le formule
                // nominano, non quello degli id.
                "rows": [
                    { "id": "z" },
                    { "id": "a", "height": 40.0 },
                    { "id": "m", "hidden": true }
                ],
                "columns": [
                    { "id": "y", "width": 120.0 },
                    { "id": "b" },
                    { "id": "q", "hidden": true }
                ],
                "cells": [
                    { "row": "z", "column": "y", "input": "Voce",
                      "style": { "bold": true, "italic": true, "text_color": "#c00",
                                 "fill_color": "#FFEE00", "horizontal": "center",
                                 "number_format": "0.00%" } },
                    { "row": "z", "column": "b", "input": "12.5" },
                    { "row": "a", "column": "b", "input": "=B1*2" },
                    { "row": "a", "column": "y", "input": "true" },
                    { "row": "m", "column": "b", "input": "=SUM(B1:B2; Altro!A1)" },
                    { "row": "m", "column": "y", "input": "=2^3^2" },
                    { "row": "m", "column": "q", "input": "", "style": { "bold": true } }
                ]
            },
            {
                "id": "s2",
                "name": "Altro",
                "rows": [{ "id": "r" }],
                "columns": [{ "id": "c" }],
                "cells": [{ "row": "r", "column": "c", "input": "=-(2^2)" }]
            }
        ]
    }));
    let copy = copy(&source).unwrap();
    assert_eq!(warnings(&copy), Vec::<&str>::new());
    let workbook = read(&copy);
    assert_eq!(workbook.sheets.len(), 2);
    let conti = &workbook.sheets[0];
    assert_eq!(conti.name, "Conti");
    assert_eq!(conti.value(at("A1")), Value::text("Voce"));
    assert_eq!(conti.value(at("B1")), Value::Number(12.5));
    assert_eq!(conti.value(at("A2")), Value::Bool(true));
    assert_eq!(conti.input_text(at("B2")), "=B1*2");
    assert_eq!(conti.value(at("B2")), Value::Number(25.0));
    assert_eq!(conti.input_text(at("B3")), "=SUM(B1:B2,Altro!A1)");
    assert_eq!(conti.value(at("B3")), Value::Number(33.5));
    assert_eq!(conti.input_text(at("A3")), "=2^(3^2)");
    assert_eq!(conti.value(at("A3")), Value::Number(512.0));
    assert_eq!(workbook.sheets[1].value(at("A1")), Value::Number(-4.0));

    let style = workbook.styles.get(conti.style_id(at("A1")));
    assert!(style.font.bold && style.font.italic);
    assert_eq!(style.font.color, Color::Rgb(0xCC0000));
    assert_eq!(style.fill.fg, Color::Rgb(0xFFEE00));
    assert_eq!(style.align.h, HAlign::Center);
    assert_eq!(style.num_fmt.as_str(), "0.00%");
    assert!(workbook.styles.get(conti.style_id(at("C3"))).font.bold);

    assert!((conti.row_height(1) - 40.0).abs() <= 0.5);
    assert!((conti.col_width(0) - 120.0).abs() <= 0.5);
    assert!(conti.is_row_hidden(2));
    assert!(conti.is_col_hidden(2));

    let xml = part(&copy.bytes, "xl/workbook.xml");
    assert!(xml.contains(r#"fullCalcOnLoad="1""#), "{xml}");
    assert!(copy
        .notes
        .iter()
        .any(|note| !note.warning && note.text.contains("id stabili")));
}

#[test]
fn un_nome_che_excel_non_ammette_cambia_anche_nelle_formule() {
    let source = sheet(serde_json::json!({
        "version": 1,
        "sheets": [
            { "id": "a", "name": "Conti: 2024", "rows": rows(1), "columns": columns(1),
              "cells": [cell(0, 0, "7")] },
            { "id": "b", "name": "conti_ 2024", "rows": rows(1), "columns": columns(1) },
            { "id": "c", "name": "Somma", "rows": rows(1), "columns": columns(1),
              "cells": [cell(0, 0, "='Conti: 2024'!A1*2")] },
            { "id": "d", "name": "'history'", "rows": rows(1), "columns": columns(1) },
            { "id": "e", "name": "Un nome davvero molto lungo per Excel", "rows": rows(1), "columns": columns(1) }
        ]
    }));
    let copy = copy(&source).unwrap();
    let workbook = read(&copy);
    let names: Vec<&str> = workbook.sheets.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Conti_ 2024 (2)",
            "conti_ 2024",
            "Somma",
            "history (2)",
            "Un nome davvero molto lungo per"
        ]
    );
    assert_eq!(workbook.sheets[2].value(at("A1")), Value::Number(14.0));
    let warnings = warnings(&copy);
    assert_eq!(warnings.len(), 3, "{warnings:?}");
    assert!(warnings[0].contains("«Conti: 2024» si chiama «Conti_ 2024 (2)»"));
}

#[test]
fn dove_excel_calcola_diverso_la_copia_lo_dice_con_le_celle() {
    let source = sheet(serde_json::json!({
        "version": 1,
        "sheets": [{
            "id": "s", "name": "F", "rows": rows(3), "columns": columns(2),
            "cells": [
                cell(0, 0, "=CONCAT(\"a\";\"b\")"),
                cell(1, 0, "=\"a\"=\"A\""),
                cell(2, 0, "=A3+1"),
                cell(2, 1, "=1+1")
            ]
        }]
    }));
    let copy = copy(&source).unwrap();
    let workbook = read(&copy);
    assert_eq!(workbook.sheets[0].value(at("A1")), Value::text("ab"));
    let warnings = warnings(&copy);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].starts_with("3 celle hanno"), "{warnings:?}");
    assert!(
        warnings[0].contains("F!A1 (Fub #NAME?, la copia «ab»)"),
        "{warnings:?}"
    );
    assert!(
        warnings[0].contains("F!A2 (Fub FALSE, la copia TRUE)"),
        "{warnings:?}"
    );
    assert!(warnings[0].contains("F!A3 (Fub #CYCLE!"), "{warnings:?}");
}

#[test]
fn una_formula_che_excel_non_legge_resta_testo_e_lo_dice() {
    let source = sheet(serde_json::json!({
        "version": 1,
        "sheets": [{
            "id": "s", "name": "F", "rows": rows(2), "columns": columns(1),
            "cells": [cell(0, 0, "=SUM("), cell(1, 0, "=$A$1")]
        }]
    }));
    let copy = copy(&source).unwrap();
    let workbook = read(&copy);
    assert_eq!(workbook.sheets[0].value(at("A1")), Value::text("=SUM("));
    assert!(workbook.sheets[0].cell(at("A1")).unwrap().formula.is_none());
    let warnings = warnings(&copy);
    assert!(
        warnings.contains(&"la copia non porta: 2 formule"),
        "{warnings:?}"
    );
    assert!(
        warnings
            .contains(&"2 formule che Excel non sa leggere restano testo nella copia: F!A1, F!A2"),
        "{warnings:?}"
    );
}

#[test]
fn colori_proprieta_e_numeri_che_excel_non_ha_si_contano() {
    let source = sheet(serde_json::json!({
        "version": 1,
        "properties": { "autore": "io" },
        "sheets": [{
            "id": "s", "name": "F", "rows": rows(2), "columns": columns(1),
            "properties": { "colore": "blu" },
            "cells": [
                { "row": "r0", "column": "c0", "input": "x",
                  "style": { "text_color": "red", "fill_color": "#11223344" } },
                cell(1, 0, "inf")
            ]
        }]
    }));
    let copy = copy(&source).unwrap();
    let warnings = warnings(&copy);
    assert!(
        warnings.contains(&"la copia non porta: 1 colore del testo, 1 colore di riempimento"),
        "{warnings:?}"
    );
    assert!(
        warnings.contains(&"2 proprietà del .fubsheet non entrano nella copia: una cartella di Excel non ha dove tenerle"),
        "{warnings:?}"
    );
    // `inf` è `#NUM!` per Fub, e nella copia resta il testo scritto.
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("F!A2 (Fub #NUM!, la copia «inf»)")),
        "{warnings:?}"
    );
}

#[test]
fn un_foglio_senza_fogli_diventa_una_cartella_con_un_foglio_vuoto() {
    let source = sheet(serde_json::json!({ "version": 1, "sheets": [] }));
    let copy = copy(&source).unwrap();
    assert_eq!(read(&copy).sheets.len(), 1);
    assert!(warnings(&copy).is_empty());
}

#[test]
fn un_testo_oltre_il_limite_di_excel_si_accorcia_e_lo_dice() {
    let long = "x".repeat(40_000);
    let source = sheet(serde_json::json!({
        "version": 1,
        "sheets": [{ "id": "s", "name": "F", "rows": rows(1), "columns": columns(1),
                     "cells": [cell(0, 0, &long)] }]
    }));
    let copy = copy(&source).unwrap();
    let workbook = read(&copy);
    let Value::Text(text) = workbook.sheets[0].value(at("A1")) else {
        panic!("not text");
    };
    assert_eq!(text.chars().count(), 32_767);
    let warnings = warnings(&copy);
    assert!(
        warnings[0].starts_with("1 testo oltre 32767 caratteri"),
        "{warnings:?}"
    );
}

#[test]
fn le_note_non_sono_vuote() {
    let source = sheet(serde_json::json!({ "version": 1, "sheets": [] }));
    let copy = copy(&source).unwrap();
    assert!(copy.notes.iter().all(|Note { text, .. }| !text.is_empty()));
}

/// Con `FUB_SOFFICE`, il percorso di `soffice`: LibreOffice apre la copia, e
/// ogni foglio ha i valori, le formule calcolate e il nome che la copia dice.
/// Senza `FUB_SOFFICE` non fa niente: la CI principale non ha LibreOffice.
#[test]
fn libreoffice_apre_la_copia() {
    let Some(program) = std::env::var_os("FUB_SOFFICE") else {
        return;
    };
    let source = sheet(serde_json::json!({
        "version": 1,
        "sheets": [
            { "id": "a", "name": "Entrate", "rows": rows(3), "columns": columns(2),
              "cells": [cell(0, 0, "Mese"), cell(0, 1, "800"), cell(1, 1, "=B1*2"),
                        cell(2, 1, "=SUM(B1:B2; 'Conti: 2024'!A1)")] },
            { "id": "b", "name": "Conti: 2024", "rows": rows(1), "columns": columns(1),
              "cells": [cell(0, 0, "=2^3^2")] }
        ]
    }));
    let copy = copy(&source).unwrap();
    let dir = std::env::temp_dir().join(format!("fub-fubsheet-lo-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("copia.xlsx"), &copy.bytes).unwrap();
    soffice(
        &program,
        &dir,
        "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1",
        &[dir.join("copia.xlsx")],
    );
    let csv = |name: &str| {
        std::fs::read_to_string(dir.join(name))
            .unwrap_or_else(|error| panic!("LibreOffice non ha scritto {name}: {error}"))
    };
    let (entrate, conti) = (csv("copia-Entrate.csv"), csv("copia-Conti_ 2024.csv"));
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(
        entrate.lines().collect::<Vec<_>>(),
        ["Mese,800", ",1600", ",2912"]
    );
    assert_eq!(conti.trim_end(), "512");
}

fn part(bytes: &[u8], name: &str) -> String {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut text = String::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    text
}
