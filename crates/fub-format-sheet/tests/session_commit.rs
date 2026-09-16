use fub_format_sheet::session::{
    SheetCellPatch, SheetInvalidation, SheetOperation, SheetSession, SheetSessionError,
    SheetWindowRequest, MAX_OPERATION_INPUT_BYTES, MAX_OPERATION_PATCHES,
};
use fub_format_sheet::{
    Cell, CellKey, CellStyle, CellValue, Column, Row, Sheet, Workbook, MAX_CELL_INPUT_BYTES,
};

fn revision(source: &str) -> u64 {
    source.bytes().fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
        hash.wrapping_mul(0x100_0000_01b3) ^ u64::from(byte)
    })
}

fn key(column: &str) -> CellKey {
    CellKey {
        sheet: "s".into(),
        row: "r0".into(),
        column: column.into(),
    }
}

fn workbook() -> Workbook {
    let mut sheet = Sheet::new("s", "Foglio");
    sheet.rows = vec![
        Row {
            id: "r0".into(),
            height: None,
            hidden: false,
        },
        Row {
            id: "r1".into(),
            height: None,
            hidden: false,
        },
    ];
    sheet.columns = (0..6)
        .map(|index| Column {
            id: format!("c{index}").into(),
            width: None,
            hidden: false,
        })
        .collect();
    sheet.cells = vec![
        Cell {
            row: "r0".into(),
            column: "c0".into(),
            input: "1".into(),
            style: CellStyle {
                bold: true,
                ..CellStyle::default()
            },
        },
        Cell {
            row: "r0".into(),
            column: "c1".into(),
            input: "=A1+1".into(),
            style: CellStyle::default(),
        },
        Cell {
            row: "r0".into(),
            column: "c2".into(),
            input: "=B1+1".into(),
            style: CellStyle::default(),
        },
    ];
    Workbook::new(vec![sheet])
}

fn request(columns: usize) -> SheetWindowRequest {
    SheetWindowRequest {
        row_start: 0,
        column_start: 0,
        row_count: 1,
        column_count: columns,
    }
}

fn operation(patches: Vec<SheetCellPatch>) -> SheetOperation {
    SheetOperation { patches }
}

fn apply_edit(source: &str, edit: &fub_format_sheet::session::SheetSourceEdit) -> String {
    assert_eq!(&source[edit.from..edit.to], edit.deleted);
    let mut bytes = source.as_bytes().to_vec();
    bytes.splice(edit.from..edit.to, edit.inserted.as_bytes().iter().copied());
    String::from_utf8(bytes).unwrap()
}

#[test]
fn commit_invalidates_changed_cells_and_transitive_dependents() {
    let source = workbook().serialize().unwrap();
    let mut session = SheetSession::open(&source, revision).unwrap();
    let before = *session.revision();
    let committed = session
        .commit(
            &before,
            &operation(vec![SheetCellPatch {
                cell: key("c0"),
                before: Some("1".into()),
                after: "2".into(),
            }]),
            revision,
        )
        .unwrap();

    assert_eq!(
        committed.invalidation,
        SheetInvalidation::Cells(vec![key("c0"), key("c1"), key("c2")])
    );
    assert_eq!(apply_edit(&source, &committed.edit), session.source());
    assert_eq!(committed.revision, *session.revision());
    assert_ne!(session.revision(), &before);

    let window = session
        .window(session.revision(), &"s".into(), request(3))
        .unwrap();
    assert_eq!(window.cells[0].value, &CellValue::Number(2.0));
    assert_eq!(window.cells[1].value, &CellValue::Number(3.0));
    assert_eq!(window.cells[2].value, &CellValue::Number(4.0));
    assert!(window.cells[0].cell.style.bold);
}

#[test]
fn every_preimage_is_checked_before_any_mutation() {
    let source = workbook().serialize().unwrap();
    let mut session = SheetSession::open(&source, revision).unwrap();
    let before = *session.revision();
    let result = session.commit(
        &before,
        &operation(vec![
            SheetCellPatch {
                cell: key("c0"),
                before: Some("1".into()),
                after: "2".into(),
            },
            SheetCellPatch {
                cell: key("c1"),
                before: Some("stale".into()),
                after: "=A1+2".into(),
            },
        ]),
        revision,
    );
    assert!(matches!(result, Err(SheetSessionError::PreimageMismatch)));
    assert_eq!(session.source(), source);
    assert_eq!(session.revision(), &before);
    let window = session.window(&before, &"s".into(), request(3)).unwrap();
    assert_eq!(window.cells[0].value, &CellValue::Number(1.0));
    assert_eq!(window.cells[1].value, &CellValue::Number(2.0));
}

#[test]
fn additions_removals_and_styled_empty_cells_preserve_presence_semantics() {
    let source = workbook().serialize().unwrap();
    let mut session = SheetSession::open(&source, revision).unwrap();
    let first = *session.revision();
    session
        .commit(
            &first,
            &operation(vec![SheetCellPatch {
                cell: key("c3"),
                before: None,
                after: "new".into(),
            }]),
            revision,
        )
        .unwrap();
    let second = *session.revision();
    session
        .commit(
            &second,
            &operation(vec![SheetCellPatch {
                cell: key("c3"),
                before: Some("new".into()),
                after: String::new(),
            }]),
            revision,
        )
        .unwrap();
    let window = session
        .window(session.revision(), &"s".into(), request(4))
        .unwrap();
    assert!(window
        .cells
        .iter()
        .all(|entry| entry.cell.column.as_ref() != "c3"));

    let third = *session.revision();
    session
        .commit(
            &third,
            &operation(vec![SheetCellPatch {
                cell: key("c0"),
                before: Some("1".into()),
                after: String::new(),
            }]),
            revision,
        )
        .unwrap();
    let window = session
        .window(session.revision(), &"s".into(), request(1))
        .unwrap();
    assert_eq!(window.cells.len(), 1);
    assert_eq!(window.cells[0].cell.input, "");
    assert!(window.cells[0].cell.style.bold);
    assert_eq!(window.cells[0].value, &CellValue::Blank);
}

#[test]
fn duplicate_unknown_noop_and_stale_operations_leave_the_session_unchanged() {
    let source = workbook().serialize().unwrap();
    let cases = [
        (
            operation(vec![
                SheetCellPatch {
                    cell: key("c0"),
                    before: Some("1".into()),
                    after: "2".into(),
                },
                SheetCellPatch {
                    cell: key("c0"),
                    before: Some("1".into()),
                    after: "3".into(),
                },
            ]),
            "duplicate",
        ),
        (
            operation(vec![SheetCellPatch {
                cell: CellKey {
                    sheet: "s".into(),
                    row: "missing".into(),
                    column: "c0".into(),
                },
                before: None,
                after: "2".into(),
            }]),
            "unknown",
        ),
        (
            operation(vec![SheetCellPatch {
                cell: key("c0"),
                before: Some("1".into()),
                after: "1".into(),
            }]),
            "noop",
        ),
    ];

    for (op, kind) in cases {
        let mut session = SheetSession::open(&source, revision).unwrap();
        let before = *session.revision();
        let error = session.commit(&before, &op, revision).unwrap_err();
        match kind {
            "duplicate" => assert!(matches!(error, SheetSessionError::DuplicatePatch)),
            "unknown" => assert!(matches!(error, SheetSessionError::UnknownCoordinate)),
            "noop" => assert!(matches!(error, SheetSessionError::NoChange)),
            _ => unreachable!(),
        }
        assert_eq!(session.source(), source);
        assert_eq!(session.revision(), &before);
    }

    let mut session = SheetSession::open(&source, revision).unwrap();
    let before = *session.revision();
    let error = session
        .commit(&before.wrapping_add(1), &operation(Vec::new()), |_| {
            panic!("stale commits do not derive a revision")
        })
        .unwrap_err();
    assert!(matches!(error, SheetSessionError::StaleRevision));
    assert_eq!(session.source(), source);
}

#[test]
fn operation_limits_are_checked_before_coordinate_or_duplicate_work() {
    let source = workbook().serialize().unwrap();
    let mut session = SheetSession::open(&source, revision).unwrap();
    let before = *session.revision();
    let repeated = SheetCellPatch {
        cell: key("c0"),
        before: Some("1".into()),
        after: "2".into(),
    };
    let too_many = operation(vec![repeated.clone(); MAX_OPERATION_PATCHES + 1]);
    assert!(matches!(
        session.commit(&before, &too_many, revision),
        Err(SheetSessionError::OperationLimit)
    ));

    let chunk = "x".repeat(MAX_CELL_INPUT_BYTES);
    let oversized = operation(
        (0..5)
            .map(|_| SheetCellPatch {
                cell: key("c0"),
                before: None,
                after: chunk.clone(),
            })
            .collect(),
    );
    assert!(5 * MAX_CELL_INPUT_BYTES > MAX_OPERATION_INPUT_BYTES);
    assert!(matches!(
        session.commit(&before, &oversized, revision),
        Err(SheetSessionError::OperationInputLimit)
    ));
    assert_eq!(session.source(), source);
}

#[test]
fn oversized_commit_responses_fail_atomically_on_first_canonicalization() {
    let canonical = workbook().serialize().unwrap();
    let source = format!("{}{}", " ".repeat(9 * 1024 * 1024), canonical);
    let mut session = SheetSession::open(&source, revision).unwrap();
    let before = *session.revision();
    let result = session.commit(
        &before,
        &operation(vec![SheetCellPatch {
            cell: key("c0"),
            before: Some("1".into()),
            after: "2".into(),
        }]),
        revision,
    );
    assert!(matches!(result, Err(SheetSessionError::ResponseTooLarge)));
    assert_eq!(session.source(), source);
    assert_eq!(session.revision(), &before);
}
