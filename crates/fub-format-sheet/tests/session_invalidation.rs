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

fn commit(
    session: &mut SheetSession<usize>,
    cell: &str,
    before: Option<&str>,
    after: &str,
) -> SheetInvalidation {
    let expected = *session.revision();
    session
        .commit(
            &expected,
            &SheetOperation {
                patches: vec![SheetCellPatch {
                    cell: key(cell),
                    before: before.map(str::to_owned),
                    after: after.into(),
                }],
            },
            revision,
        )
        .unwrap()
        .invalidation
}

/// Un intervallo è un rettangolo di posizioni, anche vuote: riempirne una o
/// svuotarla invalida la formula che lo somma e chi dipende da lei, mentre
/// una cella fuori dal rettangolo non tocca nessuno.
#[test]
fn a_range_invalidates_its_formula_for_every_position_it_covers() {
    let mut sheet = Sheet::new("s", "Foglio");
    sheet.rows = vec![Row {
        id: "r".into(),
        height: None,
        hidden: false,
    }];
    sheet.columns = (0..7)
        .map(|index| Column {
            id: format!("c{index}").into(),
            width: None,
            hidden: false,
        })
        .collect();
    let cell = |column: &str, input: &str| Cell {
        row: "r".into(),
        column: column.into(),
        input: input.into(),
        style: CellStyle::default(),
    };
    // A1 e C1 dentro l'intervallo A1:D1 (B1 e D1 vuote), E1 la somma, F1 chi
    // la legge, G1 fuori da tutto.
    sheet.cells = vec![
        cell("c0", "1"),
        cell("c2", "2"),
        cell("c4", "=SUM(A1:D1)"),
        cell("c5", "=E1*10"),
    ];
    let source = Workbook::new(vec![sheet]).serialize().unwrap();
    let mut session = SheetSession::open(&source, revision).unwrap();

    assert_eq!(
        commit(&mut session, "c3", None, "4"),
        SheetInvalidation::Cells(vec![key("c3"), key("c4"), key("c5")])
    );
    assert_eq!(
        commit(&mut session, "c0", Some("1"), ""),
        SheetInvalidation::Cells(vec![key("c0"), key("c4"), key("c5")])
    );
    assert_eq!(
        commit(&mut session, "c6", None, "9"),
        SheetInvalidation::Cells(vec![key("c6")])
    );
    let window = session
        .window(
            session.revision(),
            &"s".into(),
            SheetWindowRequest {
                row_start: 0,
                column_start: 5,
                row_count: 1,
                column_count: 1,
            },
        )
        .unwrap();
    assert_eq!(window.cells[0].value, &CellValue::Number(60.0));
}
