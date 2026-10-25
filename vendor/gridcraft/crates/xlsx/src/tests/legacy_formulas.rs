//! A formula saved without dynamic-array metadata is evaluated by Excel with implicit
//! intersection. It is read with an `@` where Excel intersects, and saved back as it was.

use gridcraft_core::{CellRef, Value};
use gridcraft_model::{Cell, Formula, Workbook};

use crate::package::Package;
use crate::xml::El;
use crate::{read_xlsx, write_xlsx};

/// (cell, legacy text in the file, the formula as dynamic-array Excel shows it)
const LEGACY: [(&str, &str, &str); 14] = [
    ("E2", "C2+A1:A3", "C2+@A1:A3"),
    ("E3", "A1:A3&\"x\"", "@A1:A3&\"x\""),
    ("E4", "-A1:A3", "-@A1:A3"),
    ("E5", "A1:A3/B1", "@A1:A3/B1"),
    ("E6", "IF(A1:A3>1,1,0)", "IF(@A1:A3>1,1,0)"),
    ("E7", "VLOOKUP(A1:A3,A1:B3,2,FALSE)", "VLOOKUP(@A1:A3,A1:B3,2,FALSE)"),
    ("E8", "INDEX(A1:B3,0,1)", "@INDEX(A1:B3,0,1)"),
    ("E9", "A1:A3", "@A1:A3"),
    ("E10", "SUM(A1:A3*B1:B3)", "SUM(@A1:A3*@B1:B3)"),
    ("E11", "A1:INDEX(A1:A3,2)+1", "@(A1:INDEX(A1:A3,2))+1"),
    ("E12", "SUM(A1:A3)+SUMPRODUCT(A1:A3*B1:B3)", "SUM(A1:A3)+SUMPRODUCT(A1:A3*B1:B3)"),
    ("E13", "CELL(\"row\",A1:A3)", "CELL(\"row\",A1:A3)"),
    ("E14", "COMBIN(A1:C1,2)", "COMBIN(@A1:C1,2)"),
    ("E15", "COMBIN(23,A1:A3)", "COMBIN(23,@A1:A3)"),
];

fn source() -> Vec<u8> {
    let mut rows = String::new();
    for r in 1..=15 {
        rows.push_str(&format!(r#"<row r="{r}">"#));
        if r <= 3 {
            rows.push_str(&format!(r#"<c r="A{r}"><v>{r}</v></c><c r="B{r}"><v>{}</v></c><c r="C{r}"><v>10</v></c>"#, r * 2));
        }
        if let Some((address, text, _)) = LEGACY.iter().find(|(a, _, _)| a[1..] == r.to_string()) {
            rows.push_str(&format!(r#"<c r="{address}"><f>{}</f><v>0</v></c>"#, crate::xml::esc(text)));
        }
        rows.push_str("</row>");
    }
    super::minimal(&format!("<sheetData>{rows}</sheetData>"), &[], "", "")
}

fn at(s: &str) -> CellRef {
    CellRef::parse(s).unwrap()
}

fn cell<'a>(sheet: &'a El, address: &str) -> &'a El {
    sheet.child("sheetData").unwrap().kids("row").flat_map(|r| r.kids("c")).find(|c| c.attr("r") == Some(address)).unwrap()
}

fn formula_text(wb: &Workbook, address: &str) -> String {
    wb.sheet(0).unwrap().cell(at(address)).and_then(|c| c.formula.as_ref()).map(|f| f.text.clone()).unwrap()
}

fn assert_written_legacy(bytes: &[u8]) {
    let mut pkg = Package::open(bytes).unwrap();
    let sheet = pkg.read_xml("xl/worksheets/sheet1.xml").unwrap().unwrap();
    for (address, text, _) in LEGACY {
        let c = cell(&sheet, address);
        assert_eq!(c.attr("cm"), None, "{address} became a dynamic-array formula");
        let f = c.child("f").unwrap();
        assert_eq!((f.attr("t"), f.attr("ref")), (None, None), "{address}");
        assert_eq!(f.text, text, "{address}");
    }
    assert!(pkg.read_xml("xl/metadata.xml").unwrap().is_none(), "no dynamic-array metadata for legacy formulas");
}

#[test]
fn legacy_formulas_read_with_implicit_intersection() {
    let (wb, _) = read_xlsx(&source()).unwrap();
    for (address, _, shown) in LEGACY {
        assert_eq!(formula_text(&wb, address), shown, "{address}");
        let f = wb.sheet(0).unwrap().cell(at(address)).unwrap().formula.as_ref().unwrap();
        assert!(!f.dynamic && f.array.is_none(), "{address}");
    }
    // The values stay those of the file.
    assert_eq!(wb.sheet(0).unwrap().cell(at("E2")).unwrap().value, Value::Number(0.0));
}

#[test]
fn legacy_formulas_are_saved_as_they_were() {
    let (wb, _) = read_xlsx(&source()).unwrap();
    let bytes = write_xlsx(&wb).unwrap();
    assert_written_legacy(&bytes);
    // And again from GridCraft's own file.
    let (back, report) = read_xlsx(&bytes).unwrap();
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    for (address, _, shown) in LEGACY {
        assert_eq!(formula_text(&back, address), shown, "{address}");
    }
    assert_written_legacy(&write_xlsx(&back).unwrap());
}

/// An `@` where a legacy formula would not intersect needs dynamic-array metadata, and an array
/// result still spills.
#[test]
fn only_intersections_a_legacy_formula_makes_are_saved_as_legacy() {
    let mut wb = Workbook::new();
    let s = wb.sheet_mut(0).unwrap();
    for (r, n) in [(0, 1.0), (1, 3.0), (2, 5.0)] {
        s.set_value(CellRef::new(r, 0), Value::Number(n));
    }
    for (address, text) in [("D1", "SUM(@A1:A3)"), ("D2", "@A1:A3*2"), ("D3", "A1:A3*2"), ("D4", "SUMPRODUCT(@A1:A3)")] {
        s.cells.set(at(address), Cell { value: Value::Number(1.0), ..Cell::formula(Formula::new(text)) });
    }
    let bytes = write_xlsx(&wb).unwrap();
    let mut pkg = Package::open(&bytes).unwrap();
    let sheet = pkg.read_xml("xl/worksheets/sheet1.xml").unwrap().unwrap();
    let written = |address: &str| {
        let c = cell(&sheet, address);
        (c.attr("cm").is_some(), c.child("f").unwrap().text.clone())
    };
    assert_eq!(written("D1"), (true, "SUM(_xlfn.SINGLE(A1:A3))".to_string()));
    assert_eq!(written("D2"), (false, "A1:A3*2".to_string()));
    assert_eq!(written("D3"), (true, "A1:A3*2".to_string()));
    assert_eq!(written("D4"), (true, "SUMPRODUCT(_xlfn.SINGLE(A1:A3))".to_string()));
}

/// A legacy formula the analysis cannot read in dynamic-array terms is saved as the file had it.
#[test]
fn a_legacy_formula_not_understood_is_saved_as_it_was() {
    let body = r#"<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>BESSELJ(A1:A3,1)</f><v>0.4</v></c></row></sheetData>"#;
    let (wb, _) = read_xlsx(&super::minimal(body, &[], "", "")).unwrap();
    assert_eq!(formula_text(&wb, "B1"), "BESSELJ(A1:A3,1)");
    let bytes = write_xlsx(&wb).unwrap();
    let sheet = Package::open(&bytes).unwrap().read_xml("xl/worksheets/sheet1.xml").unwrap().unwrap();
    assert_eq!(cell(&sheet, "B1").attr("cm"), None);
    assert_eq!(cell(&sheet, "B1").child("f").unwrap().text, "BESSELJ(A1:A3,1)");
}
