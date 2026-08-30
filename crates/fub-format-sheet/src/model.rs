use std::collections::HashSet;
use std::fmt;

use fub_abi::model::{DocId, DocumentModel, Frontmatter, Heading, Span};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

pub const MAX_SHEETS: usize = 256;
pub const MAX_ROWS: usize = 1_048_576;
pub const MAX_COLUMNS: usize = 16_384;
pub const MAX_CELLS: usize = 4_000_000;
pub const MAX_ID_BYTES: usize = 256;
pub const MAX_SHEET_NAME_BYTES: usize = 1_024;
pub const MAX_CELL_INPUT_BYTES: usize = 1_048_576;
pub const MAX_DIMENSION: u32 = 1_000_000;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::new(value)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::new(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(WorkbookId);
id_type!(SheetId);
id_type!(RowId);
id_type!(ColumnId);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workbook {
    pub id: WorkbookId,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub metadata: Map<String, Value>,
    pub sheets: Vec<Sheet>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sheet {
    pub id: SheetId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub metadata: Map<String, Value>,
    pub rows: Vec<Row>,
    pub columns: Vec<Column>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cells: Vec<Cell>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub id: RowId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Column {
    pub id: ColumnId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellKey {
    pub row: RowId,
    pub column: ColumnId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub row: RowId,
    pub column: ColumnId,
    pub input: String,
    #[serde(default, skip_serializing_if = "CellStyle::is_default")]
    pub style: CellStyle,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellStyle {
    #[serde(default, skip_serializing_if = "CellFormat::is_general")]
    pub format: CellFormat,
    #[serde(default, skip_serializing_if = "CellAlignment::is_start")]
    pub alignment: CellAlignment,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
}

impl CellStyle {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellFormat {
    #[default]
    General,
    Text,
    Number,
    Percent,
    Currency,
    Date,
}

impl CellFormat {
    fn is_general(&self) -> bool {
        *self == Self::General
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellAlignment {
    #[default]
    Start,
    Center,
    End,
}

impl CellAlignment {
    fn is_start(&self) -> bool {
        *self == Self::Start
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum Axis {
    #[error("row")]
    Row,
    #[error("column")]
    Column,
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ValidationError {
    #[error("{kind} id is empty")]
    EmptyId { kind: &'static str },
    #[error("{kind} id exceeds {MAX_ID_BYTES} bytes: {id}")]
    IdTooLong { kind: &'static str, id: String },
    #[error("{kind} id contains unsupported characters: {id}")]
    InvalidId { kind: &'static str, id: String },
    #[error("workbook contains no sheets")]
    NoSheets,
    #[error("workbook contains {actual} sheets, limit is {MAX_SHEETS}")]
    TooManySheets { actual: usize },
    #[error("duplicate sheet id: {id}")]
    DuplicateSheet { id: SheetId },
    #[error("sheet {sheet} has an empty name")]
    EmptySheetName { sheet: SheetId },
    #[error("sheet {sheet} name exceeds {MAX_SHEET_NAME_BYTES} bytes")]
    SheetNameTooLong { sheet: SheetId },
    #[error("sheet {sheet} contains no {axis}s")]
    EmptyAxis { sheet: SheetId, axis: Axis },
    #[error("sheet {sheet} contains {actual} {axis}s, limit is {limit}")]
    TooManyAxisItems {
        sheet: SheetId,
        axis: Axis,
        actual: usize,
        limit: usize,
    },
    #[error("duplicate row id {id} in sheet {sheet}")]
    DuplicateRow { sheet: SheetId, id: RowId },
    #[error("duplicate column id {id} in sheet {sheet}")]
    DuplicateColumn { sheet: SheetId, id: ColumnId },
    #[error("{axis} {id} in sheet {sheet} has invalid dimension {value}")]
    InvalidDimension {
        sheet: SheetId,
        axis: Axis,
        id: String,
        value: u32,
    },
    #[error("sheet {sheet} contains {actual} cells, limit is {MAX_CELLS}")]
    TooManyCells { sheet: SheetId, actual: usize },
    #[error("duplicate cell ({row}, {column}) in sheet {sheet}")]
    DuplicateCell {
        sheet: SheetId,
        row: RowId,
        column: ColumnId,
    },
    #[error("cell ({row}, {column}) in sheet {sheet} refers to an unknown row")]
    UnknownRow {
        sheet: SheetId,
        row: RowId,
        column: ColumnId,
    },
    #[error("cell ({row}, {column}) in sheet {sheet} refers to an unknown column")]
    UnknownColumn {
        sheet: SheetId,
        row: RowId,
        column: ColumnId,
    },
    #[error("cell ({row}, {column}) in sheet {sheet} exceeds the input limit")]
    CellInputTooLong {
        sheet: SheetId,
        row: RowId,
        column: ColumnId,
    },
}

impl Workbook {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_id("workbook", self.id.as_str())?;
        if self.sheets.is_empty() {
            return Err(ValidationError::NoSheets);
        }
        if self.sheets.len() > MAX_SHEETS {
            return Err(ValidationError::TooManySheets {
                actual: self.sheets.len(),
            });
        }

        let mut sheet_ids = HashSet::with_capacity(self.sheets.len());
        for sheet in &self.sheets {
            validate_id("sheet", sheet.id.as_str())?;
            if !sheet_ids.insert(&sheet.id) {
                return Err(ValidationError::DuplicateSheet {
                    id: sheet.id.clone(),
                });
            }
            sheet.validate()?;
        }
        Ok(())
    }

    pub fn project(&self, id: DocId) -> DocumentModel {
        let mut model = DocumentModel::empty(id);
        model.frontmatter = Frontmatter(self.metadata.clone());
        model.frontmatter_present = !model.frontmatter.is_empty();

        let mut text = String::new();
        for (key, value) in &self.metadata {
            push_search_text(&mut text, key);
            push_json_search_text(&mut text, value);
        }
        for sheet in &self.sheets {
            model.outline.push(Heading {
                level: 1,
                text: sheet.name.clone(),
                slug: sheet.id.to_string(),
                span: Span::new(0, 0),
                explicit_anchor: Some(sheet.id.to_string()),
            });
            push_search_text(&mut text, &sheet.name);
            for (key, value) in &sheet.metadata {
                push_search_text(&mut text, key);
                push_json_search_text(&mut text, value);
            }
            for cell in &sheet.cells {
                push_search_text(&mut text, &cell.input);
            }
        }
        if text.ends_with('\n') {
            text.pop();
        }
        model.text = text;
        model
    }
}

impl Sheet {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.name.is_empty() {
            return Err(ValidationError::EmptySheetName {
                sheet: self.id.clone(),
            });
        }
        if self.name.len() > MAX_SHEET_NAME_BYTES {
            return Err(ValidationError::SheetNameTooLong {
                sheet: self.id.clone(),
            });
        }
        validate_axis_count(self, Axis::Row, self.rows.len(), MAX_ROWS)?;
        validate_axis_count(self, Axis::Column, self.columns.len(), MAX_COLUMNS)?;

        let mut rows = HashSet::with_capacity(self.rows.len());
        for row in &self.rows {
            validate_id("row", row.id.as_str())?;
            if !rows.insert(&row.id) {
                return Err(ValidationError::DuplicateRow {
                    sheet: self.id.clone(),
                    id: row.id.clone(),
                });
            }
            validate_dimension(self, Axis::Row, row.id.as_str(), row.height)?;
        }

        let mut columns = HashSet::with_capacity(self.columns.len());
        for column in &self.columns {
            validate_id("column", column.id.as_str())?;
            if !columns.insert(&column.id) {
                return Err(ValidationError::DuplicateColumn {
                    sheet: self.id.clone(),
                    id: column.id.clone(),
                });
            }
            validate_dimension(self, Axis::Column, column.id.as_str(), column.width)?;
        }

        if self.cells.len() > MAX_CELLS {
            return Err(ValidationError::TooManyCells {
                sheet: self.id.clone(),
                actual: self.cells.len(),
            });
        }
        let mut cells = HashSet::with_capacity(self.cells.len());
        for cell in &self.cells {
            if !rows.contains(&cell.row) {
                return Err(ValidationError::UnknownRow {
                    sheet: self.id.clone(),
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                });
            }
            if !columns.contains(&cell.column) {
                return Err(ValidationError::UnknownColumn {
                    sheet: self.id.clone(),
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                });
            }
            if cell.input.len() > MAX_CELL_INPUT_BYTES {
                return Err(ValidationError::CellInputTooLong {
                    sheet: self.id.clone(),
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                });
            }
            if !cells.insert((&cell.row, &cell.column)) {
                return Err(ValidationError::DuplicateCell {
                    sheet: self.id.clone(),
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                });
            }
        }
        Ok(())
    }

    pub fn a1(&self, key: &CellKey) -> Option<String> {
        let row = self
            .rows
            .iter()
            .position(|candidate| candidate.id == key.row)?
            + 1;
        let column = self
            .columns
            .iter()
            .position(|candidate| candidate.id == key.column)?
            + 1;
        Some(format!("{}{row}", column_label(column)))
    }
}

fn validate_id(kind: &'static str, id: &str) -> Result<(), ValidationError> {
    if id.is_empty() {
        return Err(ValidationError::EmptyId { kind });
    }
    if id.len() > MAX_ID_BYTES {
        return Err(ValidationError::IdTooLong {
            kind,
            id: id.to_string(),
        });
    }
    if !id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(ValidationError::InvalidId {
            kind,
            id: id.to_string(),
        });
    }
    Ok(())
}

fn validate_axis_count(
    sheet: &Sheet,
    axis: Axis,
    actual: usize,
    limit: usize,
) -> Result<(), ValidationError> {
    if actual == 0 {
        return Err(ValidationError::EmptyAxis {
            sheet: sheet.id.clone(),
            axis,
        });
    }
    if actual > limit {
        return Err(ValidationError::TooManyAxisItems {
            sheet: sheet.id.clone(),
            axis,
            actual,
            limit,
        });
    }
    Ok(())
}

fn validate_dimension(
    sheet: &Sheet,
    axis: Axis,
    id: &str,
    value: Option<u32>,
) -> Result<(), ValidationError> {
    if let Some(value) = value {
        if value == 0 || value > MAX_DIMENSION {
            return Err(ValidationError::InvalidDimension {
                sheet: sheet.id.clone(),
                axis,
                id: id.to_string(),
                value,
            });
        }
    }
    Ok(())
}

fn column_label(mut column: usize) -> String {
    let mut bytes = [0_u8; 16];
    let mut cursor = bytes.len();
    while column > 0 {
        column -= 1;
        cursor -= 1;
        bytes[cursor] = b'A' + (column % 26) as u8;
        column /= 26;
    }
    String::from_utf8(bytes[cursor..].to_vec()).expect("ASCII column label")
}

fn push_search_text(text: &mut String, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    text.push_str(value);
    text.push('\n');
}

fn push_json_search_text(text: &mut String, value: &Value) {
    match value {
        Value::Null => {}
        Value::Bool(value) => push_search_text(text, if *value { "true" } else { "false" }),
        Value::Number(value) => push_search_text(text, &value.to_string()),
        Value::String(value) => push_search_text(text, value),
        Value::Array(values) => {
            for value in values {
                push_json_search_text(text, value);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                push_search_text(text, key);
                push_json_search_text(text, value);
            }
        }
    }
}
