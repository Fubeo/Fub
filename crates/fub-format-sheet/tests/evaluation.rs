use fub_format_sheet::{
    evaluate_workbook, Cell, CellKey, CellStyle, CellValue, Column, ColumnId, FormulaError, Row,
    RowId, Sheet, SheetId, Workbook, WorkbookId,
};
use serde_json::Map;

fn key(row: usize, column: usize) -> CellKey {
    CellKey {
        row: RowId::from(format!("row-{row}")),
        column: ColumnId::from(format!("column-{column}")),
    }
}

fn workbook(inputs: &[(&str, &str, &str)]) -> Workbook {
    Workbook {
        id: WorkbookId::from("workbook"),
        metadata: Map::new(),
        sheets: vec![Sheet {
            id: SheetId::from("sheet"),
            name: "Foglio".into(),
            metadata: Map::new(),
            rows: (1..=4)
                .map(|index| Row {
                    id: RowId::from(format!("row-{index}")),
                    height: None,
                })
                .collect(),
            columns: (1..=3)
                .map(|index| Column {
                    id: ColumnId::from(format!("column-{index}")),
                    width: None,
                })
                .collect(),
            cells: inputs
                .iter()
                .map(|(row, column, input)| Cell {
                    row: RowId::from(*row),
                    column: ColumnId::from(*column),
                    input: (*input).into(),
                    style: CellStyle::default(),
                })
                .collect(),
        }],
    }
}

fn value(
    evaluation: &fub_format_sheet::WorkbookEvaluation,
    row: usize,
    column: usize,
) -> &CellValue {
    &evaluation
        .sheet(&SheetId::from("sheet"))
        .expect("sheet evaluated")
        .cell(&key(row, column))
        .expect("cell evaluated")
        .value
}

#[test]
fn numbers_strings_operators_ranges_and_functions_are_evaluated_in_rust() {
    let workbook = workbook(&[
        ("row-1", "column-1", "10"),
        ("row-2", "column-1", "20"),
        ("row-1", "column-2", "=SUM(A1:A2)"),
        ("row-2", "column-2", "=AVERAGE(A1:A2)"),
        ("row-1", "column-3", "=IF(B1>=30,\"ok\",\"no\")"),
        ("row-2", "column-3", "=MIN(A1:A2)+MAX(A1:A2)"),
        ("row-3", "column-3", "=(2+3)*4^2"),
        ("row-4", "column-3", "=\"fub\"&\"sheet\""),
        ("row-4", "column-2", "=\"café \"\"vero\"\"\""),
    ]);

    let evaluation = evaluate_workbook(&workbook);
    assert_eq!(value(&evaluation, 1, 2), &CellValue::Number(30.0));
    assert_eq!(value(&evaluation, 2, 2), &CellValue::Number(15.0));
    assert_eq!(value(&evaluation, 1, 3), &CellValue::Text("ok".into()));
    assert_eq!(value(&evaluation, 2, 3), &CellValue::Number(30.0));
    assert_eq!(value(&evaluation, 3, 3), &CellValue::Number(80.0));
    assert_eq!(
        value(&evaluation, 4, 3),
        &CellValue::Text("fubsheet".into())
    );
    assert_eq!(
        value(&evaluation, 4, 2),
        &CellValue::Text("café \"vero\"".into())
    );

    let dependencies = &evaluation
        .sheet(&SheetId::from("sheet"))
        .unwrap()
        .cell(&key(1, 2))
        .unwrap()
        .dependencies;
    assert_eq!(dependencies, &[key(1, 1), key(2, 1)]);
}

#[test]
fn formula_failures_are_typed_and_cycles_do_not_recurse_forever() {
    let workbook = workbook(&[
        ("row-1", "column-1", "=1/0"),
        ("row-1", "column-2", "=MISSING(1)"),
        ("row-2", "column-1", "=Z99"),
        ("row-2", "column-2", "=1+"),
        ("row-4", "column-1", "=B4"),
        ("row-4", "column-2", "=A4"),
    ]);

    let evaluation = evaluate_workbook(&workbook);
    assert_eq!(
        value(&evaluation, 1, 1),
        &CellValue::Error(FormulaError::DivisionByZero)
    );
    assert_eq!(
        value(&evaluation, 1, 2),
        &CellValue::Error(FormulaError::Name)
    );
    assert_eq!(
        value(&evaluation, 2, 1),
        &CellValue::Error(FormulaError::Reference)
    );
    assert_eq!(
        value(&evaluation, 2, 2),
        &CellValue::Error(FormulaError::Parse)
    );
    assert_eq!(
        value(&evaluation, 4, 1),
        &CellValue::Error(FormulaError::Cycle)
    );
    assert_eq!(
        value(&evaluation, 4, 2),
        &CellValue::Error(FormulaError::Cycle)
    );
}
