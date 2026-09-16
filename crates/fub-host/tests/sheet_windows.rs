//! Confine nativo della sessione derivata, prima della promozione ABI/WIT.

use fub_format_sheet::{Cell, CellStyle, CellValue, Column, Row, Sheet, Workbook};
use fub_host::sheet::{
    SheetSession, SheetSessionError, SheetWindowRequest, MAX_WINDOW_COLUMNS,
    MAX_WINDOW_RESPONSE_BYTES, MAX_WINDOW_ROWS,
};

fn workbook(rows: usize, columns: usize) -> Workbook {
    let mut sheet = Sheet::new("s", "Foglio");
    sheet.rows = (0..rows)
        .map(|index| Row {
            id: format!("r{index}").into(),
            height: None,
            hidden: false,
        })
        .collect();
    sheet.columns = (0..columns)
        .map(|index| Column {
            id: format!("c{index}").into(),
            width: None,
            hidden: false,
        })
        .collect();
    Workbook::new(vec![sheet])
}

fn cell(row: usize, column: usize, input: &str) -> Cell {
    Cell {
        row: format!("r{row}").into(),
        column: format!("c{column}").into(),
        input: input.to_owned(),
        style: CellStyle::default(),
    }
}

fn request(row: usize, column: usize, rows: usize, columns: usize) -> SheetWindowRequest {
    SheetWindowRequest {
        row_start: row,
        column_start: column,
        row_count: rows,
        column_count: columns,
    }
}

fn formula_source(input: &str) -> String {
    let mut book = workbook(120, 60);
    // L'ordine persistito delle celle non coincide con quello della viewport.
    book.sheets[0].cells = vec![cell(0, 1, "=A1+1"), cell(0, 0, input)];
    book.serialize().unwrap()
}

#[test]
fn a_window_keeps_dependencies_outside_the_viewport_out_of_the_response() {
    let session = SheetSession::open(&formula_source("2")).unwrap();
    let view = session
        .window(session.revision(), &"s".into(), request(0, 1, 1, 1))
        .unwrap();
    assert_eq!(view.total_rows, 120);
    assert_eq!(view.total_columns, 60);
    assert_eq!(view.rows[0].id.as_ref(), "r0");
    assert_eq!(view.columns[0].id.as_ref(), "c1");
    assert_eq!(view.cells.len(), 1);
    assert_eq!(view.cells[0].cell.input, "=A1+1");
    assert_eq!(view.cells[0].value, &CellValue::Number(3.0));
    let json = serde_json::to_value(&view).unwrap();
    assert!(json["revision"].is_string());
    assert!(json.get("dependencies").is_none());
}

#[test]
fn repeated_reads_borrow_the_same_cached_value() {
    let session = SheetSession::open(&formula_source("2")).unwrap();
    let first = session
        .window(session.revision(), &"s".into(), request(0, 1, 1, 1))
        .unwrap();
    let second = session
        .window(session.revision(), &"s".into(), request(0, 0, 2, 2))
        .unwrap();
    assert!(std::ptr::eq(first.cells[0].value, second.cells[1].value));
}

#[test]
fn dense_workbooks_return_only_materialized_cells_in_the_requested_window() {
    let mut book = workbook(120, 60);
    for row in 0..120 {
        for column in 0..60 {
            book.sheets[0].cells.push(cell(row, column, "1"));
        }
    }
    let session = SheetSession::open(&book.serialize().unwrap()).unwrap();
    let view = session
        .window(session.revision(), &"s".into(), request(20, 10, 15, 26))
        .unwrap();
    assert_eq!(view.cells.len(), 390);
    assert_eq!(view.rows.len(), 15);
    assert_eq!(view.columns.len(), 26);
    assert_eq!(view.cells[0].cell.row.as_ref(), "r20");
    assert_eq!(view.cells[0].cell.column.as_ref(), "c10");
    assert!(serde_json::to_vec(&view).unwrap().len() < MAX_WINDOW_RESPONSE_BYTES);
}

#[test]
fn window_limits_are_checked_before_clamping_or_allocating() {
    let session = SheetSession::open(&formula_source("2")).unwrap();
    for shape in [
        request(0, 0, MAX_WINDOW_ROWS + 1, 1),
        request(0, 0, 1, MAX_WINDOW_COLUMNS + 1),
        request(0, 0, usize::MAX, usize::MAX),
        request(0, 0, usize::MAX, 0),
    ] {
        assert!(matches!(
            session.window(session.revision(), &"s".into(), shape),
            Err(SheetSessionError::WindowLimit)
        ));
    }
    let boundary = session
        .window(
            session.revision(),
            &"s".into(),
            request(0, 0, MAX_WINDOW_ROWS, MAX_WINDOW_COLUMNS),
        )
        .unwrap();
    assert_eq!(boundary.rows.len(), 120);
    assert_eq!(boundary.columns.len(), 60);
}

#[test]
fn the_last_window_clamps_but_an_outside_start_is_rejected() {
    let session = SheetSession::open(&formula_source("2")).unwrap();
    let edge = session
        .window(session.revision(), &"s".into(), request(119, 59, 10, 10))
        .unwrap();
    assert_eq!((edge.rows.len(), edge.columns.len()), (1, 1));
    assert!(edge.cells.is_empty());
    let empty = session
        .window(session.revision(), &"s".into(), request(120, 60, 1, 1))
        .unwrap();
    assert!(empty.rows.is_empty() && empty.columns.is_empty() && empty.cells.is_empty());
    for shape in [request(121, 0, 1, 1), request(0, usize::MAX, 1, 1)] {
        assert!(matches!(
            session.window(session.revision(), &"s".into(), shape),
            Err(SheetSessionError::WindowRange)
        ));
    }
}

#[test]
fn an_empty_sheet_and_an_unknown_sheet_are_different() {
    let session = SheetSession::open(&workbook(0, 0).serialize().unwrap()).unwrap();
    assert!(session
        .window(session.revision(), &"s".into(), request(0, 0, 1, 1))
        .unwrap()
        .cells
        .is_empty());
    assert!(matches!(
        session.window(session.revision(), &"missing".into(), request(0, 0, 1, 1)),
        Err(SheetSessionError::UnknownSheet)
    ));
}

#[test]
fn axis_order_hidden_flags_dimensions_and_style_survive_the_projection() {
    let mut book = workbook(2, 2);
    book.sheets[0].rows.swap(0, 1);
    book.sheets[0].rows[0].hidden = true;
    book.sheets[0].rows[0].height = Some(32.0);
    book.sheets[0].columns.swap(0, 1);
    book.sheets[0].columns[0].width = Some(150.0);
    let mut styled = cell(1, 1, "preserved");
    styled.style.bold = true;
    book.sheets[0].cells.push(styled);
    let session = SheetSession::open(&book.serialize().unwrap()).unwrap();
    let view = session
        .window(session.revision(), &"s".into(), request(0, 0, 1, 1))
        .unwrap();
    assert_eq!(view.rows[0].id.as_ref(), "r1");
    assert!(view.rows[0].hidden);
    assert_eq!(view.rows[0].height, Some(32.0));
    assert_eq!(view.columns[0].id.as_ref(), "c1");
    assert_eq!(view.columns[0].width, Some(150.0));
    assert!(view.cells[0].cell.style.bold);
}

#[test]
fn equal_row_and_column_ids_in_different_sheets_do_not_collide() {
    let mut book = workbook(1, 1);
    book.sheets[0].cells.push(cell(0, 0, "first"));
    let mut other = book.sheets[0].clone();
    other.id = "other".into();
    other.name = "Altro".to_owned();
    other.cells[0].input = "second".to_owned();
    book.sheets.push(other);
    let session = SheetSession::open(&book.serialize().unwrap()).unwrap();
    let view = session
        .window(session.revision(), &"other".into(), request(0, 0, 1, 1))
        .unwrap();
    assert_eq!(view.cells[0].value, &CellValue::Text("second".to_owned()));
}

#[test]
fn a_failed_reload_preserves_the_previous_revision_and_values() {
    let mut session = SheetSession::open(&formula_source("2")).unwrap();
    let revision = session.revision().clone();
    assert!(matches!(
        session.reload(&revision, "{}"),
        Err(SheetSessionError::Source(_))
    ));
    assert_eq!(session.revision(), &revision);
    let view = session
        .window(&revision, &"s".into(), request(0, 1, 1, 1))
        .unwrap();
    assert_eq!(view.cells[0].value, &CellValue::Number(3.0));
}

#[test]
fn a_successful_reload_rejects_stale_reads_and_stale_reloads() {
    let mut session = SheetSession::open(&formula_source("2")).unwrap();
    let old = session.revision().clone();
    session.reload(&old, &formula_source("4")).unwrap();
    assert_ne!(session.revision(), &old);
    assert!(matches!(
        session.window(&old, &"s".into(), request(0, 0, 1, 1)),
        Err(SheetSessionError::StaleRevision)
    ));
    assert!(matches!(
        session.reload(&old, &formula_source("99")),
        Err(SheetSessionError::StaleRevision)
    ));
    let view = session
        .window(session.revision(), &"s".into(), request(0, 1, 1, 1))
        .unwrap();
    assert_eq!(view.cells[0].value, &CellValue::Number(5.0));
}

#[test]
fn response_limits_count_json_escaping_without_allocating_the_response() {
    let mut book = workbook(1, 2);
    // Sorgente < 16 MiB; input + valore, con escaping JSON, superano 8 MiB.
    let input = "\u{0001}".repeat(fub_format_sheet::MAX_CELL_INPUT_BYTES);
    book.sheets[0].cells.push(cell(0, 0, &input));
    let source = book.serialize().unwrap();
    assert!(source.len() < fub_format_sheet::MAX_SOURCE_BYTES);
    let session = SheetSession::open(&source).unwrap();
    assert!(matches!(
        session.window(session.revision(), &"s".into(), request(0, 0, 1, 1)),
        Err(SheetSessionError::ResponseTooLarge)
    ));
    // La cella enorme non contamina una finestra che non la contiene.
    let outside = session
        .window(session.revision(), &"s".into(), request(0, 1, 1, 1))
        .unwrap();
    assert!(outside.cells.is_empty());
}

#[test]
fn oversized_sources_are_rejected_by_the_existing_format_limit() {
    let source = " ".repeat(fub_format_sheet::MAX_SOURCE_BYTES + 1);
    assert!(matches!(
        SheetSession::open(&source),
        Err(SheetSessionError::Source(
            fub_format_sheet::SheetError::Limit { .. }
        ))
    ));
}
