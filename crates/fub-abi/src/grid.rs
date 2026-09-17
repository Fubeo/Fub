//! Contratto dati fra una famiglia grid posseduta dalla shell e i provider che
//! la alimentano.
//!
//! Il provider non disegna: apre una proiezione derivata del sorgente, risponde
//! per finestre e applica patch a coordinate stabili. DOM, CodeMirror e stato
//! visuale restano nella shell. Il sorgente completo attraversa il confine solo
//! all'apertura o a un reload autorevole; nessuna battuta lo attraversa.

use serde::{Deserialize, Serialize};

use crate::edit::Revision;
use crate::error::PluginError;

pub const GRID_FAMILY: &str = "grid";
pub const GRID_PROTOCOL_VERSION: u32 = 1;
pub const MAX_GRID_SOURCE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_GRID_WINDOW_ROWS: u32 = 256;
pub const MAX_GRID_WINDOW_COLUMNS: u32 = 128;
pub const MAX_GRID_WINDOW_CELLS: usize = 32_768;
pub const MAX_GRID_PATCHES: usize = 16_384;
pub const MAX_GRID_PATCH_INPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_GRID_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_GRID_INVALIDATED_CELLS: usize = 32_768;

/// Binding dichiarato dal provider: il formato sceglie una famiglia e una
/// versione di protocollo, mai una versione simile per tentativi.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSurfaceSpec {
    pub id: String,
    pub format: String,
    pub family: String,
    pub protocol_version: u32,
}

impl GridSurfaceSpec {
    pub fn new(id: impl Into<String>, format: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            format: format.into(),
            family: GRID_FAMILY.to_owned(),
            protocol_version: GRID_PROTOCOL_VERSION,
        }
    }

    pub fn validate(&self) -> Result<(), PluginError> {
        if self.id.is_empty()
            || self.format.is_empty()
            || self.family.is_empty()
            || self.protocol_version == 0
        {
            return Err(PluginError::BadArgs(
                "grid surface has an empty identity".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSession {
    pub instance: String,
    pub revision: Revision,
    pub sheets: Vec<GridSheet>,
}

impl GridSession {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.instance.is_empty()
            || self.revision.0.is_empty()
            || self
                .sheets
                .iter()
                .any(|sheet| sheet.id.is_empty() || sheet.name.is_empty())
        {
            return Err(PluginError::BadArgs(
                "grid session has an empty identity".into(),
            ));
        }
        let encoded = serde_json::to_vec(self)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if encoded.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(PluginError::BadArgs(
                "grid session exceeds byte limit".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSheet {
    pub id: String,
    pub name: String,
    pub row_count: u32,
    pub column_count: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridRow {
    pub id: String,
    pub index: u32,
    pub height: Option<f32>,
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridColumn {
    pub id: String,
    pub index: u32,
    pub width: Option<f32>,
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct GridCellKey {
    pub sheet: String,
    pub row: String,
    pub column: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridHorizontalAlign {
    Start,
    Center,
    End,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCellStyle {
    pub bold: bool,
    pub italic: bool,
    pub text_color: Option<String>,
    pub fill_color: Option<String>,
    pub horizontal: Option<GridHorizontalAlign>,
    pub number_format: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridFormulaError {
    Parse,
    Ref,
    Name,
    Value,
    DivZero,
    Num,
    Cycle,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum GridCellValue {
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(GridFormulaError),
}

/// Cella materializzata nella finestra. `input` e `style` sono persistiti;
/// `value` è sempre derivato dal solo provider autorevole.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridCell {
    pub key: GridCellKey,
    pub input: String,
    pub style: GridCellStyle,
    pub value: GridCellValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridWindowRequest {
    pub revision: Revision,
    pub sheet: String,
    pub row_start: u32,
    pub row_count: u32,
    pub column_start: u32,
    pub column_count: u32,
}

impl GridWindowRequest {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.revision.0.is_empty() || self.sheet.is_empty() {
            return Err(PluginError::BadArgs(
                "grid window has an empty identity".into(),
            ));
        }
        if self.row_count == 0 || self.column_count == 0 {
            return Err(PluginError::BadArgs(
                "grid window dimensions must be non-zero".into(),
            ));
        }
        if self.row_count > MAX_GRID_WINDOW_ROWS || self.column_count > MAX_GRID_WINDOW_COLUMNS {
            return Err(PluginError::BadArgs(
                "grid window exceeds axis limits".into(),
            ));
        }
        let cells = (self.row_count as usize)
            .checked_mul(self.column_count as usize)
            .ok_or_else(|| PluginError::BadArgs("grid window size overflow".into()))?;
        if cells > MAX_GRID_WINDOW_CELLS {
            return Err(PluginError::BadArgs(
                "grid window exceeds cell limit".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridWindow {
    pub revision: Revision,
    pub sheet: String,
    pub row_start: u32,
    pub column_start: u32,
    pub total_rows: u32,
    pub total_columns: u32,
    pub rows: Vec<GridRow>,
    pub columns: Vec<GridColumn>,
    pub cells: Vec<GridCell>,
}

impl GridWindow {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.revision.0.is_empty()
            || self.sheet.is_empty()
            || self.rows.len() > MAX_GRID_WINDOW_ROWS as usize
            || self.columns.len() > MAX_GRID_WINDOW_COLUMNS as usize
            || self.cells.len() > MAX_GRID_WINDOW_CELLS
        {
            return Err(PluginError::BadArgs(
                "grid response exceeds window limits".into(),
            ));
        }
        let encoded = serde_json::to_vec(self)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if encoded.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(PluginError::BadArgs(
                "grid response exceeds byte limit".into(),
            ));
        }
        Ok(())
    }
}

/// Patch atomica e input-only. Lo stile e il valore non sono preimmagini
/// scrivibili: il provider conserva lo stile e ricalcola il valore.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCellPatch {
    pub cell: GridCellKey,
    pub before: Option<String>,
    pub after: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridApplyRequest {
    pub revision: Revision,
    pub patches: Vec<GridCellPatch>,
}

impl GridApplyRequest {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.revision.0.is_empty()
            || self.patches.is_empty()
            || self.patches.len() > MAX_GRID_PATCHES
        {
            return Err(PluginError::BadArgs(
                "grid patch count or revision is outside limits".into(),
            ));
        }
        let mut bytes = 0usize;
        for patch in &self.patches {
            bytes = bytes
                .checked_add(patch.before.as_ref().map_or(0, String::len))
                .and_then(|bytes| bytes.checked_add(patch.after.len()))
                .ok_or_else(|| PluginError::BadArgs("grid patch input size overflow".into()))?;
            if patch.cell.sheet.is_empty()
                || patch.cell.row.is_empty()
                || patch.cell.column.is_empty()
            {
                return Err(PluginError::BadArgs(
                    "grid patch has an empty coordinate".into(),
                ));
            }
        }
        if bytes > MAX_GRID_PATCH_INPUT_BYTES {
            return Err(PluginError::BadArgs(
                "grid patch inputs exceed byte limit".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "cells", rename_all = "snake_case")]
pub enum GridInvalidation {
    Cells(Vec<GridCellKey>),
    All,
}

impl GridInvalidation {
    pub fn validate(&self) -> Result<(), PluginError> {
        if let Self::Cells(cells) = self {
            if cells.len() > MAX_GRID_INVALIDATED_CELLS {
                return Err(PluginError::BadArgs(
                    "grid invalidation exceeds cell limit".into(),
                ));
            }
            if cells
                .iter()
                .any(|cell| cell.sheet.is_empty() || cell.row.is_empty() || cell.column.is_empty())
            {
                return Err(PluginError::BadArgs(
                    "grid invalidation has an empty coordinate".into(),
                ));
            }
        }
        Ok(())
    }
}

/// Diff UTF-8 guardato restituito come conseguenza del commit. Le coordinate
/// della patch restano la semantica primaria della griglia.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSourceEdit {
    pub from: u64,
    pub to: u64,
    pub deleted: String,
    pub inserted: String,
}

impl GridSourceEdit {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.from > self.to {
            return Err(PluginError::BadArgs(
                "grid source diff has inverted bounds".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCommit {
    pub revision: Revision,
    pub edit: GridSourceEdit,
    pub invalidation: GridInvalidation,
}

impl GridCommit {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.revision.0.is_empty() {
            return Err(PluginError::BadArgs(
                "grid commit has an empty revision".into(),
            ));
        }
        self.edit.validate()?;
        self.invalidation.validate()?;
        let encoded = serde_json::to_vec(self)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if encoded.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(PluginError::BadArgs(
                "grid commit exceeds byte limit".into(),
            ));
        }
        Ok(())
    }
}

/// Provider di dati per una superficie grid posseduta dalla shell.
pub trait GridProvider: Send + Sync {
    fn surfaces(&self) -> Vec<GridSurfaceSpec>;
    fn open(
        &mut self,
        surface: &str,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError>;
    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError>;
    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError>;
    fn reload(
        &mut self,
        instance: &str,
        expected: Revision,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError>;
    fn close(&mut self, instance: &str) -> Result<(), PluginError>;
    /// Distrugge tutte le istanze prima che il corpo del plugin venga disattivato.
    fn shutdown(&mut self) -> Result<(), PluginError>;
}

pub fn validate_grid_source(source: &str) -> Result<(), PluginError> {
    if source.len() > MAX_GRID_SOURCE_BYTES {
        return Err(PluginError::BadArgs(
            "grid source exceeds byte limit".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(rows: u32, columns: u32) -> GridWindowRequest {
        GridWindowRequest {
            revision: Revision("r1".into()),
            sheet: "sheet-1".into(),
            row_start: 0,
            row_count: rows,
            column_start: 0,
            column_count: columns,
        }
    }

    fn key() -> GridCellKey {
        GridCellKey {
            sheet: "sheet-1".into(),
            row: "row-1".into(),
            column: "column-1".into(),
        }
    }

    #[test]
    fn a_window_is_rejected_before_allocating_for_its_coordinates() {
        assert!(request(MAX_GRID_WINDOW_ROWS, MAX_GRID_WINDOW_COLUMNS)
            .validate()
            .is_ok());
        assert!(request(MAX_GRID_WINDOW_ROWS + 1, 1).validate().is_err());
        assert!(request(1, MAX_GRID_WINDOW_COLUMNS + 1).validate().is_err());
        assert!(request(0, 1).validate().is_err());
    }

    #[test]
    fn patch_input_limit_counts_only_preimages_and_new_inputs() {
        let oversized_coordinate = "x".repeat(MAX_GRID_PATCH_INPUT_BYTES + 1);

        assert!(GridApplyRequest {
            revision: Revision("r1".into()),
            patches: vec![GridCellPatch {
                cell: GridCellKey {
                    sheet: oversized_coordinate,
                    row: "row-1".into(),
                    column: "column-1".into(),
                },
                before: None,
                after: String::new(),
            }],
        }
        .validate()
        .is_ok());

        let oversized_input = "x".repeat(MAX_GRID_PATCH_INPUT_BYTES + 1);
        assert!(GridApplyRequest {
            revision: Revision("r1".into()),
            patches: vec![GridCellPatch {
                cell: key(),
                before: None,
                after: oversized_input,
            }],
        }
        .validate()
        .is_err());
    }

    #[test]
    fn source_patch_and_invalidation_limits_are_bounded() {
        let source = "x".repeat(MAX_GRID_SOURCE_BYTES);
        assert!(validate_grid_source(&source).is_ok());
        assert!(validate_grid_source(&format!("{source}x")).is_err());

        let patch = GridCellPatch {
            cell: key(),
            before: None,
            after: String::new(),
        };
        let mut request = GridApplyRequest {
            revision: Revision("r1".into()),
            patches: vec![patch; MAX_GRID_PATCHES],
        };
        assert!(request.validate().is_ok());
        request.patches.push(GridCellPatch {
            cell: key(),
            before: None,
            after: String::new(),
        });
        assert!(request.validate().is_err());

        let mut invalidation = GridInvalidation::Cells(vec![key(); MAX_GRID_INVALIDATED_CELLS]);
        assert!(invalidation.validate().is_ok());
        if let GridInvalidation::Cells(cells) = &mut invalidation {
            cells.push(key());
        }
        assert!(invalidation.validate().is_err());
    }

    #[test]
    fn surface_validation_accepts_future_family_versions_for_negotiation() {
        let mut spec = GridSurfaceSpec::new("future.sheet", "future-format");
        spec.family = "future-grid".into();
        spec.protocol_version = 2;
        assert!(spec.validate().is_ok());
    }

    #[test]
    fn patch_does_not_carry_style_or_formula_value() {
        let patch = GridCellPatch {
            cell: key(),
            before: Some("=A1+1".into()),
            after: "=A1+2".into(),
        };
        let json = serde_json::to_value(patch).unwrap();
        assert!(json.get("style").is_none());
        assert!(json.get("value").is_none());
    }
}
