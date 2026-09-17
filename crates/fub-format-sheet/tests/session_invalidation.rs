use fub_format_sheet::session::{
    SheetCellPatch, SheetInvalidation, SheetOperation, SheetSession, SheetWindowRequest,
};
use fub_format_sheet::{Cell, CellKey, CellStyle, CellValue, Column, Row, Sheet, Workbook};

fn revision(source: &str) -> usize {
    source.len()
}

fn key(column: &str) -> CellKey {
    CellKey {
        sheet: "s".into(),
        row: "r".into(),
        column: column.into(),
    }
}

#[test]
fn materializing_a_previously_absent_reference_invalidates_its_formula() {
    let mut sheet = Sheet::new("s", "Foglio");
    sheet.rows = vec![Row {
        id: "r".into(),
        height: None,
        hidden: false,
    }];
    sheet.columns = (0..4)
        .map(|index| Column {
            id: format!("c{index}").into(),
            width: None,
            hidden: false,
        })
        .collect();
    sheet.cells = vec![Cell {
        row: "r".into(),
        column: "c1".into(),
        input: "=D1+1".into(),
        style: CellStyle::default(),
    }];
    let source = Workbook::new(vec![sheet]).serialize().unwrap();
    let mut session = SheetSession::open(&source, revision).unwrap();
    let before = *session.revision();

    let committed = session
        .commit(
            &before,
            &SheetOperation {
                patches: vec![SheetCellPatch {
                    cell: key("c3"),
                    before: None,
                    after: "2".into(),
                }],
            },
            revision,
        )
        .unwrap();

    assert_eq!(
        committed.invalidation,
        SheetInvalidation::Cells(vec![key("c1"), key("c3")])
    );
    let window = session
        .window(
            session.revision(),
            &"s".into(),
            SheetWindowRequest {
                row_start: 0,
                column_start: 1,
                row_count: 1,
                column_count: 1,
            },
        )
        .unwrap();
    assert_eq!(window.cells[0].value, &CellValue::Number(3.0));
}
