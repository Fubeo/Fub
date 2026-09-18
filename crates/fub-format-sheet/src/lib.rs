//! Formato testuale e versionato per workbook `.fubsheet`.
//!
//! Questo crate possiede il modello persistito, le proiezioni e le sessioni derivate.
//! Valori, AST delle formule, dipendenze, cache ed errori sono dati derivati e
//! non entrano nel file. Il workbook resta intenzionalmente separato da
//! `DocumentModel`: una griglia non è un albero Markdown travestito.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

mod formula;
pub mod session;

pub use formula::{CellDependency, CellValue, EvaluatedCell, FormulaErrorCode, WorkbookEvaluation};

pub const FORMAT_ID: &str = "fubsheet";
pub const SCHEMA_VERSION: u32 = 1;
pub const JSON_SCHEMA: &str = include_str!("../schema/fubsheet-v1.schema.json");

pub const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_SHEETS: usize = 1_024;
pub const MAX_ROWS_PER_SHEET: usize = 1_048_576;
pub const MAX_COLUMNS_PER_SHEET: usize = 16_384;
pub const MAX_CELLS_PER_SHEET: usize = 4_000_000;
pub const MAX_CELL_INPUT_BYTES: usize = 1_048_576;

macro_rules! opaque_id {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }
    };
}

opaque_id!(SheetId);
opaque_id!(RowId);
opaque_id!(ColumnId);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workbook {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub properties: Map<String, Value>,
    pub sheets: Vec<Sheet>,
}

impl Workbook {
    pub fn new(sheets: Vec<Sheet>) -> Self {
        Self {
            version: SCHEMA_VERSION,
            properties: Map::new(),
            sheets,
        }
    }

    pub fn parse(source: &str) -> Result<Self, SheetError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(SheetError::Limit {
                what: "source bytes",
                limit: MAX_SOURCE_BYTES,
            });
        }
        let value: Value = serde_json::from_str(source)?;
        let version = value
            .get("version")
            .and_then(Value::as_u64)
            .ok_or(SheetError::MissingVersion)?;
        if version != u64::from(SCHEMA_VERSION) {
            return Err(SheetError::UnsupportedVersion(version));
        }
        let workbook: Self = serde_json::from_value(value)?;
        workbook.validate()?;
        Ok(workbook)
    }

    pub fn serialize(&self) -> Result<String, SheetError> {
        self.validate()?;
        let mut source = serde_json::to_string_pretty(self)?;
        source.push('\n');
        Ok(source)
    }

    pub fn validate(&self) -> Result<(), SheetError> {
        if self.version != SCHEMA_VERSION {
            return Err(SheetError::UnsupportedVersion(u64::from(self.version)));
        }
        limit("sheets", self.sheets.len(), MAX_SHEETS)?;

        let mut sheet_ids = HashSet::new();
        let mut sheet_names = HashSet::new();
        for sheet in &self.sheets {
            validate_id("sheet", sheet.id.as_ref())?;
            if !sheet_ids.insert(&sheet.id) {
                return Err(SheetError::DuplicateId {
                    kind: "sheet",
                    id: sheet.id.as_ref().to_owned(),
                });
            }
            if sheet.name.trim().is_empty() {
                return Err(SheetError::EmptySheetName);
            }
            if !sheet_names.insert(sheet.name.as_str()) {
                return Err(SheetError::DuplicateSheetName(sheet.name.clone()));
            }
            sheet.validate()?;
        }
        Ok(())
    }

    pub fn a1(&self, key: &CellKey) -> Option<A1Address> {
        let sheet = self.sheets.iter().find(|sheet| sheet.id == key.sheet)?;
        let row = sheet.rows.iter().position(|entry| entry.id == key.row)?;
        let column = sheet
            .columns
            .iter()
            .position(|entry| entry.id == key.column)?;
        Some(A1Address {
            sheet: sheet.name.clone(),
            address: format!("{}{}", column_name(column), row + 1),
        })
    }

    pub fn outline(&self) -> Vec<OutlineEntry> {
        self.sheets
            .iter()
            .map(|sheet| OutlineEntry {
                sheet: sheet.id.clone(),
                title: sheet.name.clone(),
            })
            .collect()
    }

    pub fn search(&self, query: &str) -> Vec<SearchEntry> {
        if query.is_empty() {
            return Vec::new();
        }
        let needle = query.to_lowercase();
        let mut hits = Vec::new();
        for sheet in &self.sheets {
            let rows: HashMap<&RowId, usize> = sheet
                .rows
                .iter()
                .enumerate()
                .map(|(index, row)| (&row.id, index))
                .collect();
            let columns: HashMap<&ColumnId, usize> = sheet
                .columns
                .iter()
                .enumerate()
                .map(|(index, column)| (&column.id, index))
                .collect();
            for cell in &sheet.cells {
                if !cell.input.to_lowercase().contains(&needle) {
                    continue;
                }
                let (Some(row), Some(column)) = (rows.get(&cell.row), columns.get(&cell.column))
                else {
                    continue;
                };
                hits.push(SearchEntry {
                    key: CellKey {
                        sheet: sheet.id.clone(),
                        row: cell.row.clone(),
                        column: cell.column.clone(),
                    },
                    a1: A1Address {
                        sheet: sheet.name.clone(),
                        address: format!("{}{}", column_name(*column), row + 1),
                    },
                    input: cell.input.clone(),
                });
            }
        }
        hits
    }

    pub fn projected_properties(&self) -> WorkbookProperties {
        WorkbookProperties {
            version: self.version,
            sheet_count: self.sheets.len(),
            non_empty_cell_count: self
                .sheets
                .iter()
                .map(|sheet| {
                    sheet
                        .cells
                        .iter()
                        .filter(|cell| !cell.input.is_empty())
                        .count()
                })
                .sum(),
            custom: self.properties.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sheet {
    pub id: SheetId,
    pub name: String,
    pub rows: Vec<Row>,
    pub columns: Vec<Column>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cells: Vec<Cell>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub properties: Map<String, Value>,
}

impl Sheet {
    pub fn new(id: impl Into<SheetId>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            rows: Vec::new(),
            columns: Vec::new(),
            cells: Vec::new(),
            properties: Map::new(),
        }
    }

    fn validate(&self) -> Result<(), SheetError> {
        limit("rows per sheet", self.rows.len(), MAX_ROWS_PER_SHEET)?;
        limit(
            "columns per sheet",
            self.columns.len(),
            MAX_COLUMNS_PER_SHEET,
        )?;
        limit("cells per sheet", self.cells.len(), MAX_CELLS_PER_SHEET)?;

        let row_ids = unique_ids("row", self.rows.iter().map(|row| row.id.as_ref()))?;
        let column_ids = unique_ids(
            "column",
            self.columns.iter().map(|column| column.id.as_ref()),
        )?;
        for row in &self.rows {
            validate_dimension("row height", row.height)?;
        }
        for column in &self.columns {
            validate_dimension("column width", column.width)?;
        }
        let mut coordinates = HashSet::new();
        for cell in &self.cells {
            if cell.input.len() > MAX_CELL_INPUT_BYTES {
                return Err(SheetError::Limit {
                    what: "cell input bytes",
                    limit: MAX_CELL_INPUT_BYTES,
                });
            }
            if !row_ids.contains(cell.row.as_ref()) {
                return Err(SheetError::UnknownCoordinate {
                    axis: "row",
                    id: cell.row.as_ref().to_owned(),
                });
            }
            if !column_ids.contains(cell.column.as_ref()) {
                return Err(SheetError::UnknownCoordinate {
                    axis: "column",
                    id: cell.column.as_ref().to_owned(),
                });
            }
            if !coordinates.insert((&cell.row, &cell.column)) {
                return Err(SheetError::DuplicateCell {
                    row: cell.row.as_ref().to_owned(),
                    column: cell.column.as_ref().to_owned(),
                });
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub id: RowId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f32>,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Column {
    pub id: ColumnId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub row: RowId,
    pub column: ColumnId,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub input: String,
    #[serde(default, skip_serializing_if = "CellStyle::is_default")]
    pub style: CellStyle,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellStyle {
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<HorizontalAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

impl CellStyle {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HorizontalAlign {
    Start,
    Center,
    End,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CellKey {
    pub sheet: SheetId,
    pub row: RowId,
    pub column: ColumnId,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct A1Address {
    pub sheet: String,
    pub address: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutlineEntry {
    pub sheet: SheetId,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchEntry {
    pub key: CellKey,
    pub a1: A1Address,
    pub input: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkbookProperties {
    pub version: u32,
    pub sheet_count: usize,
    pub non_empty_cell_count: usize,
    pub custom: Map<String, Value>,
}

#[derive(Debug, Error)]
pub enum SheetError {
    #[error(".fubsheet source exceeds the {limit}-byte {what} limit")]
    Limit { what: &'static str, limit: usize },
    #[error(".fubsheet has no numeric version")]
    MissingVersion,
    #[error("unsupported .fubsheet version {0}")]
    UnsupportedVersion(u64),
    #[error("{kind} id must be non-empty, at most 128 bytes, and contain no control characters")]
    InvalidId { kind: &'static str },
    #[error("duplicate {kind} id {id}")]
    DuplicateId { kind: &'static str, id: String },
    #[error("sheet name must not be empty")]
    EmptySheetName,
    #[error("duplicate sheet name {0}")]
    DuplicateSheetName(String),
    #[error("{what} must be finite and greater than zero")]
    InvalidDimension { what: &'static str },
    #[error("cell refers to unknown {axis} id {id}")]
    UnknownCoordinate { axis: &'static str, id: String },
    #[error("duplicate cell at row {row}, column {column}")]
    DuplicateCell { row: String, column: String },
    #[error("invalid .fubsheet JSON: {0}")]
    Json(#[from] serde_json::Error),
}

fn validate_id(kind: &'static str, id: &str) -> Result<(), SheetError> {
    if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
        return Err(SheetError::InvalidId { kind });
    }
    Ok(())
}

fn unique_ids<'a>(
    kind: &'static str,
    ids: impl Iterator<Item = &'a str>,
) -> Result<HashSet<&'a str>, SheetError> {
    let mut seen = HashSet::new();
    for id in ids {
        validate_id(kind, id)?;
        if !seen.insert(id) {
            return Err(SheetError::DuplicateId {
                kind,
                id: id.to_owned(),
            });
        }
    }
    Ok(seen)
}

fn validate_dimension(what: &'static str, value: Option<f32>) -> Result<(), SheetError> {
    if value.is_some_and(|value| !value.is_finite() || value <= 0.0) {
        return Err(SheetError::InvalidDimension { what });
    }
    Ok(())
}

fn limit(what: &'static str, count: usize, maximum: usize) -> Result<(), SheetError> {
    if count > maximum {
        return Err(SheetError::Limit {
            what,
            limit: maximum,
        });
    }
    Ok(())
}

fn column_name(mut index: usize) -> String {
    let mut reversed = Vec::with_capacity(3);
    loop {
        reversed.push(b'A' + (index % 26) as u8);
        index /= 26;
        if index == 0 {
            break;
        }
        index -= 1;
    }
    reversed.reverse();
    String::from_utf8(reversed).expect("A1 columns are ASCII")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workbook() -> Workbook {
        let mut sheet = Sheet::new("sheet-main", "Budget");
        sheet.rows = vec![
            Row {
                id: "row-income".into(),
                height: Some(24.0),
                hidden: false,
            },
            Row {
                id: "row-total".into(),
                height: None,
                hidden: false,
            },
        ];
        sheet.columns = vec![
            Column {
                id: "column-label".into(),
                width: Some(180.0),
                hidden: false,
            },
            Column {
                id: "column-value".into(),
                width: Some(120.0),
                hidden: false,
            },
        ];
        sheet.cells = vec![
            Cell {
                row: "row-income".into(),
                column: "column-label".into(),
                input: "Income".into(),
                style: CellStyle {
                    bold: true,
                    ..CellStyle::default()
                },
            },
            Cell {
                row: "row-total".into(),
                column: "column-value".into(),
                input: "=SUM(B1:B1)".into(),
                style: CellStyle::default(),
            },
        ];
        Workbook::new(vec![sheet])
    }

    #[test]
    fn round_trip_preserves_only_authoritative_input_and_layout() {
        let workbook = workbook();
        let source = workbook.serialize().unwrap();
        let reparsed = Workbook::parse(&source).unwrap();
        assert_eq!(reparsed, workbook);
        assert!(source.ends_with('\n'));
    }

    #[test]
    fn a1_is_a_projection_of_current_order_not_cell_identity() {
        let mut workbook = workbook();
        let key = CellKey {
            sheet: "sheet-main".into(),
            row: "row-income".into(),
            column: "column-label".into(),
        };
        assert_eq!(workbook.a1(&key).unwrap().address, "A1");

        workbook.sheets[0].rows.swap(0, 1);
        workbook.sheets[0].columns.swap(0, 1);
        assert_eq!(workbook.a1(&key).unwrap().address, "B2");
        assert_eq!(key.row, RowId::from("row-income"));
        assert_eq!(key.column, ColumnId::from("column-label"));
    }

    #[test]
    fn projections_expose_outline_search_and_properties() {
        let mut workbook = workbook();
        workbook.properties.insert("owner".into(), "Ada".into());

        assert_eq!(
            workbook.outline(),
            vec![OutlineEntry {
                sheet: "sheet-main".into(),
                title: "Budget".into(),
            }]
        );
        let hits = workbook.search("sum");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].a1.address, "B2");
        assert_eq!(hits[0].key.row, RowId::from("row-total"));

        let properties = workbook.projected_properties();
        assert_eq!(properties.version, SCHEMA_VERSION);
        assert_eq!(properties.sheet_count, 1);
        assert_eq!(properties.non_empty_cell_count, 2);
        assert_eq!(properties.custom["owner"], "Ada");
    }

    #[test]
    fn rejects_ambiguous_and_dangling_coordinates() {
        let mut duplicate = workbook();
        let cell = duplicate.sheets[0].cells[0].clone();
        duplicate.sheets[0].cells.push(cell);
        assert!(matches!(
            duplicate.validate(),
            Err(SheetError::DuplicateCell { .. })
        ));

        let mut dangling = workbook();
        dangling.sheets[0].cells[0].row = "missing".into();
        assert!(matches!(
            dangling.validate(),
            Err(SheetError::UnknownCoordinate { axis: "row", .. })
        ));
    }

    #[test]
    fn rejects_non_positive_or_non_finite_dimensions() {
        let mut zero_height = workbook();
        zero_height.sheets[0].rows[0].height = Some(0.0);
        assert!(matches!(
            zero_height.validate(),
            Err(SheetError::InvalidDimension { what: "row height" })
        ));

        let mut negative_width = workbook();
        negative_width.sheets[0].columns[0].width = Some(-1.0);
        assert!(matches!(
            negative_width.validate(),
            Err(SheetError::InvalidDimension {
                what: "column width"
            })
        ));

        let mut non_finite_height = workbook();
        non_finite_height.sheets[0].rows[0].height = Some(f32::NAN);
        assert!(matches!(
            non_finite_height.validate(),
            Err(SheetError::InvalidDimension { what: "row height" })
        ));
    }

    #[test]
    fn rejects_unknown_fields_and_versions_instead_of_losing_them_on_rewrite() {
        let unknown = r#"{"version":1,"sheets":[],"future":true}"#;
        assert!(matches!(Workbook::parse(unknown), Err(SheetError::Json(_))));

        let missing_axes = r#"{"version":1,"sheets":[{"id":"s1","name":"Sheet"}]}"#;
        assert!(matches!(
            Workbook::parse(missing_axes),
            Err(SheetError::Json(_))
        ));

        let future = r#"{"version":2,"sheets":[]}"#;
        assert!(matches!(
            Workbook::parse(future),
            Err(SheetError::UnsupportedVersion(2))
        ));
    }

    #[test]
    fn a1_column_projection_reaches_schema_boundary() {
        assert_eq!(column_name(0), "A");
        assert_eq!(column_name(25), "Z");
        assert_eq!(column_name(26), "AA");
        assert_eq!(column_name(MAX_COLUMNS_PER_SHEET - 1), "XFD");
    }

    #[test]
    fn bundled_schema_is_valid_json_and_names_version_one() {
        let schema: Value = serde_json::from_str(JSON_SCHEMA).unwrap();
        assert_eq!(schema["$id"], "https://fub.app/schema/fubsheet-v1.json");
        assert_eq!(schema["properties"]["version"]["const"], 1);
    }
}
