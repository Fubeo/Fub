//! Formato testuale autorevole e versionato per i workbook Fub.
//!
//! Il workbook conserva soltanto identità e input persistenti. Indirizzi A1,
//! proiezione `DocumentModel`, valori, dipendenze, cache ed errori restano dati
//! derivati. Il provider espone al kernel la proiezione comune senza trasformarla
//! in una seconda autorità serializzabile.

mod codec;
mod model;
mod provider;

pub use codec::{parse, serialize, SheetError, MAX_SOURCE_BYTES, SCHEMA_VERSION};
pub use model::{
    Axis, Cell, CellAlignment, CellFormat, CellKey, CellStyle, Column, ColumnId, Row, RowId, Sheet,
    SheetId, ValidationError, Workbook, WorkbookId, MAX_CELLS, MAX_CELL_INPUT_BYTES, MAX_COLUMNS,
    MAX_DIMENSION, MAX_ID_BYTES, MAX_ROWS, MAX_SHEETS, MAX_SHEET_NAME_BYTES,
};
pub use provider::SheetProvider;
