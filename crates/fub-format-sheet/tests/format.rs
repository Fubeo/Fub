use fub_abi::format::{DocumentSource, ParseContext, RenderOptions, SourceKind};
use fub_abi::model::DocId;
use fub_abi::{FormatError, FormatProvider};
use fub_format_sheet::{
    parse, serialize, Cell, CellAlignment, CellFormat, CellKey, CellStyle, Column, ColumnId, Row,
    RowId, Sheet, SheetError, SheetId, SheetProvider, ValidationError, Workbook, WorkbookId,
    SCHEMA_VERSION,
};
use serde_json::{json, Map};

fn workbook() -> Workbook {
    let mut metadata = Map::new();
    metadata.insert("owner".into(), json!("Bilancio"));
    let mut sheet_metadata = Map::new();
    sheet_metadata.insert("period".into(), json!(2026));
    Workbook {
        id: WorkbookId::from("workbook-1"),
        metadata,
        sheets: vec![Sheet {
            id: SheetId::from("sheet-1"),
            name: "Foglio <1>".into(),
            metadata: sheet_metadata,
            rows: vec![
                Row {
                    id: RowId::from("row-1"),
                    height: Some(24),
                },
                Row {
                    id: RowId::from("row-2"),
                    height: None,
                },
            ],
            columns: vec![
                Column {
                    id: ColumnId::from("column-1"),
                    width: Some(120),
                },
                Column {
                    id: ColumnId::from("column-2"),
                    width: None,
                },
            ],
            cells: vec![
                Cell {
                    row: RowId::from("row-1"),
                    column: ColumnId::from("column-1"),
                    input: "10<&".into(),
                    style: CellStyle {
                        format: CellFormat::Currency,
                        alignment: CellAlignment::End,
                        bold: true,
                        italic: false,
                    },
                },
                Cell {
                    row: RowId::from("row-1"),
                    column: ColumnId::from("column-2"),
                    input: "=A1*2".into(),
                    style: CellStyle::default(),
                },
            ],
        }],
    }
}

#[test]
fn authoritative_fields_round_trip_without_derived_state() {
    let workbook = workbook();

    let source = serialize(&workbook).expect("valid workbook serializes");
    let decoded = parse(&source).expect("serialized workbook parses");

    assert_eq!(decoded, workbook);
    assert!(source.contains("\"schema\": 1"));
    assert!(source.contains("\"row\": \"row-1\""));
    assert!(source.contains("\"column\": \"column-1\""));
    for forbidden in [
        "\"a1\"",
        "\"ast\"",
        "\"value\"",
        "\"dependencies\"",
        "\"cache\"",
        "\"error\"",
    ] {
        assert!(
            !source.contains(forbidden),
            "derived field persisted: {forbidden}"
        );
    }
}

#[test]
fn future_schema_is_refused_before_interpreting_its_workbook() {
    let source = r#"{"schema":2,"workbook":{"future_shape":true}}"#;

    assert_eq!(
        parse(source),
        Err(SheetError::UnsupportedSchema {
            found: SCHEMA_VERSION.next(),
            supported: SCHEMA_VERSION,
        })
    );
}

#[test]
fn missing_schema_and_unknown_fields_are_not_silently_accepted() {
    let without_schema = r#"{"workbook":{}}"#;
    assert_eq!(parse(without_schema), Err(SheetError::MissingSchema));

    let source = serialize(&workbook()).expect("fixture serializes");
    let with_unknown = source.replacen(
        "\"input\": \"10<&\"",
        "\"input\": \"10<&\", \"computed_value\": 10",
        1,
    );
    assert!(matches!(
        parse(&with_unknown),
        Err(SheetError::InvalidJson(_))
    ));
}

#[test]
fn validation_rejects_duplicate_cells_and_dangling_coordinates() {
    let mut duplicate = workbook();
    let repeated = duplicate.sheets[0].cells[0].clone();
    duplicate.sheets[0].cells.push(repeated);
    assert!(matches!(
        duplicate.validate(),
        Err(ValidationError::DuplicateCell { .. })
    ));

    let mut dangling = workbook();
    dangling.sheets[0].cells[0].row = RowId::from("missing-row");
    assert!(matches!(
        dangling.validate(),
        Err(ValidationError::UnknownRow { .. })
    ));
}

#[test]
fn identity_and_dimensions_are_validated_before_serialization() {
    let mut duplicate_row = workbook();
    duplicate_row.sheets[0].rows[1].id = RowId::from("row-1");
    assert!(matches!(
        duplicate_row.validate(),
        Err(ValidationError::DuplicateRow { .. })
    ));

    let mut unsafe_id = workbook();
    unsafe_id.sheets[0].id = SheetId::from("sheet:one");
    assert!(matches!(
        unsafe_id.validate(),
        Err(ValidationError::InvalidId { .. })
    ));

    let mut zero_width = workbook();
    zero_width.sheets[0].columns[0].width = Some(0);
    assert!(matches!(
        zero_width.validate(),
        Err(ValidationError::InvalidDimension { .. })
    ));
    assert!(matches!(
        serialize(&zero_width),
        Err(SheetError::InvalidWorkbook(
            ValidationError::InvalidDimension { .. }
        ))
    ));
}

#[test]
fn a1_is_a_projection_of_order_not_persistent_identity() {
    let mut workbook = workbook();
    let key = CellKey {
        row: RowId::from("row-2"),
        column: ColumnId::from("column-1"),
    };

    assert_eq!(workbook.sheets[0].a1(&key).as_deref(), Some("A2"));
    workbook.sheets[0].rows.swap(0, 1);
    assert_eq!(workbook.sheets[0].a1(&key).as_deref(), Some("A1"));
    assert_eq!(key.row, RowId::from("row-2"));
    assert_eq!(key.column, ColumnId::from("column-1"));
}

#[test]
fn document_model_is_only_outline_search_and_properties_projection() {
    let model = workbook().project(DocId::new("conti.fubsheet"));

    assert_eq!(model.id, DocId::new("conti.fubsheet"));
    assert_eq!(model.outline.len(), 1);
    assert_eq!(model.outline[0].text, "Foglio <1>");
    assert_eq!(model.outline[0].slug, "sheet-1");
    assert_eq!(model.frontmatter.get("owner"), Some(&json!("Bilancio")));
    assert!(model.text.contains("Foglio <1>"));
    assert!(model.text.contains("2026"));
    assert!(model.text.contains("10<&"));
    assert!(model.text.contains("=A1*2"));
    assert!(
        model.body.is_empty(),
        "workbook authority must not enter DocumentModel"
    );
}

#[test]
fn provider_claims_only_fubsheet_and_escapes_its_projection() {
    let provider = SheetProvider::new();
    let descriptor = provider.descriptor();
    assert_eq!(descriptor.id, "fubsheet");
    assert_eq!(descriptor.extensions, vec!["fubsheet"]);

    let source = serialize(&workbook()).expect("fixture serializes");
    let model = provider
        .parse(
            &DocumentSource::Text(source),
            &ParseContext::bare("conti.fubsheet"),
        )
        .expect("provider parses its text source");
    let html = provider
        .render_html(&model, &RenderOptions::default())
        .expect("projection renders");
    assert!(html.contains("Foglio &lt;1&gt;"));
    assert!(html.contains("10&lt;&amp;"));
    assert!(!html.contains("Foglio <1>"));

    assert_eq!(
        provider.parse(
            &DocumentSource::Bytes(vec![0, 1]),
            &ParseContext::bare("conti.fubsheet"),
        ),
        Err(FormatError::Unsupported {
            format: "fubsheet".into(),
            got: SourceKind::Bytes,
        })
    );
    assert!(matches!(
        provider.serialize(&model),
        Err(FormatError::Serialize(_))
    ));
}
