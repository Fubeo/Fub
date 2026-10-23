//! Le forme comuni della famiglia `grid`: la superficie dichiarata, gli assi,
//! le chiavi stabili delle celle, l'aspetto, la richiesta di una finestra e
//! la patch con il suo commit.
//!
//! Il provider non disegna: risponde per finestre e applica patch a coordinate
//! stabili. DOM, CodeMirror e stato visuale restano nella shell. L'unico
//! protocollo è quello a byte, in [`crate::grid_bytes`].

use serde::{Deserialize, Serialize};

use crate::edit::Revision;
use crate::error::PluginError;

pub const GRID_FAMILY: &str = "grid";
pub const MAX_GRID_WINDOW_ROWS: u32 = 256;
pub const MAX_GRID_WINDOW_COLUMNS: u32 = 128;
pub const MAX_GRID_WINDOW_CELLS: usize = 32_768;
pub const MAX_GRID_PATCHES: usize = 16_384;
pub const MAX_GRID_PATCH_INPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_GRID_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_GRID_INVALIDATED_CELLS: usize = 32_768;
/// Upper bounds for a session summary.  They are deliberately stricter than
/// the wire `u32` width: a client must be able to inspect a session without
/// first allocating one request per possible coordinate.
pub const MAX_GRID_SESSION_SHEETS: usize = 1_024;
pub const MAX_GRID_SESSION_ROWS: u32 = 1_048_576;
pub const MAX_GRID_SESSION_COLUMNS: u32 = 16_384;
pub const MAX_GRID_SESSION_CELLS: u64 = 4_000_000;
pub const MAX_GRID_SESSION_WINDOWS: usize = 256;

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
    /// Ripete il testo fino a riempire la cella.
    Fill,
    Justify,
    Distributed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridVerticalAlign {
    Top,
    Center,
    Bottom,
    Justify,
    Distributed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridUnderline {
    Single,
    Double,
    SingleAccounting,
    DoubleAccounting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridScript {
    Superscript,
    Subscript,
}

/// I tratti di un bordo, quelli di Excel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridBorderStyle {
    Thin,
    Medium,
    Thick,
    Dashed,
    Dotted,
    Double,
    Hair,
    MediumDashed,
    DashDot,
    MediumDashDot,
    DashDotDot,
    MediumDashDotDot,
    SlantDashDot,
}

/// Un lato del bordo; `color` assente è il colore automatico.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridBorder {
    pub style: GridBorderStyle,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridBorders {
    pub top: Option<GridBorder>,
    pub right: Option<GridBorder>,
    pub bottom: Option<GridBorder>,
    pub left: Option<GridBorder>,
    pub diagonal_down: Option<GridBorder>,
    pub diagonal_up: Option<GridBorder>,
}

/// L'aspetto di una cella, già risolto dal provider: il tema, lo stile di
/// una tabella e la formattazione condizionale sono dentro. Un campo assente
/// è il valore di serie del formato (carattere, dimensione, allineamento
/// verticale in basso).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GridCellStyle {
    pub bold: bool,
    pub italic: bool,
    pub text_color: Option<String>,
    pub fill_color: Option<String>,
    pub horizontal: Option<GridHorizontalAlign>,
    pub number_format: Option<String>,
    pub font: Option<String>,
    /// In punti.
    pub font_size: Option<f32>,
    pub underline: Option<GridUnderline>,
    pub strike: bool,
    pub script: Option<GridScript>,
    pub vertical: Option<GridVerticalAlign>,
    pub wrap: bool,
    pub shrink: bool,
    /// Livelli di rientro, come in Excel.
    pub indent: u8,
    /// Gradi in senso antiorario, da -90 a 90; 255 è il testo in colonna.
    pub rotation: i16,
    pub borders: GridBorders,
}

pub const GRID_STACKED_ROTATION: i16 = 255;
pub const MAX_GRID_FONT_BYTES: usize = 256;
pub const MAX_GRID_COLOR_BYTES: usize = 32;

impl GridCellStyle {
    pub fn validate(&self) -> Result<(), PluginError> {
        let color = |value: &Option<String>| {
            value
                .as_ref()
                .is_some_and(|c| c.len() > MAX_GRID_COLOR_BYTES)
        };
        let borders = &self.borders;
        let border = |side: &Option<GridBorder>| side.as_ref().is_some_and(|b| color(&b.color));
        if color(&self.text_color)
            || color(&self.fill_color)
            || [
                &borders.top,
                &borders.right,
                &borders.bottom,
                &borders.left,
                &borders.diagonal_down,
                &borders.diagonal_up,
            ]
            .into_iter()
            .any(border)
        {
            return Err(PluginError::BadArgs("grid style color is too long".into()));
        }
        if self
            .font
            .as_ref()
            .is_some_and(|font| font.is_empty() || font.len() > MAX_GRID_FONT_BYTES)
            || self
                .font_size
                .is_some_and(|size| !size.is_finite() || size <= 0.0 || size > 409.0)
            || !((-90..=90).contains(&self.rotation) || self.rotation == GRID_STACKED_ROTATION)
        {
            return Err(PluginError::BadArgs(
                "grid style is outside its limits".into(),
            ));
        }
        Ok(())
    }
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

    /// Validates the byte range and deleted preimage before a caller mutates
    /// the authoritative source.  Offsets are UTF-8 byte offsets, never
    /// JavaScript/UTF-16 positions.
    pub fn validate_against(&self, source: &str) -> Result<(), PluginError> {
        self.validate()?;
        let from = usize::try_from(self.from)
            .map_err(|_| PluginError::BadArgs("grid source diff offset overflows usize".into()))?;
        let to = usize::try_from(self.to)
            .map_err(|_| PluginError::BadArgs("grid source diff offset overflows usize".into()))?;
        if to > source.len() || from > to {
            return Err(PluginError::BadArgs(
                "grid source diff is outside its source".into(),
            ));
        }
        if !safe_source_boundary(source, from) || !safe_source_boundary(source, to) {
            return Err(PluginError::BadArgs(
                "grid source diff splits UTF-8 or CRLF".into(),
            ));
        }
        if source[from..to] != self.deleted {
            return Err(PluginError::BadArgs(
                "grid source diff preimage mismatch".into(),
            ));
        }
        Ok(())
    }
}

fn safe_source_boundary(source: &str, at: usize) -> bool {
    if !source.is_char_boundary(at) {
        return false;
    }
    let bytes = source.as_bytes();
    !(at > 0 && at < bytes.len() && bytes[at - 1] == b'\r' && bytes[at] == b'\n')
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
    fn patch_and_invalidation_limits_are_bounded() {
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
        let mut spec = GridSurfaceSpec::bytes("future.sheet", "future-format");
        spec.family = "future-grid".into();
        spec.protocol_version = 3;
        assert!(spec.validate().is_ok());
    }

    #[test]
    fn source_edit_checks_utf8_crlf_boundaries_and_deleted_preimage() {
        let source = "😀\r\nvalue";
        let split_utf8 = GridSourceEdit {
            from: 1,
            to: 4,
            deleted: "�".into(),
            inserted: String::new(),
        };
        assert!(split_utf8.validate_against(source).is_err());

        let split_crlf = GridSourceEdit {
            from: "😀\r".len() as u64,
            to: "😀\r".len() as u64,
            deleted: String::new(),
            inserted: String::new(),
        };
        assert!(split_crlf.validate_against(source).is_err());

        let mismatch = GridSourceEdit {
            from: "😀".len() as u64,
            to: "😀\r\n".len() as u64,
            deleted: "\n".into(),
            inserted: String::new(),
        };
        assert!(mismatch.validate_against(source).is_err());

        let valid = GridSourceEdit {
            from: "😀\r\n".len() as u64,
            to: source.len() as u64,
            deleted: "value".into(),
            inserted: "test".into(),
        };
        assert!(valid.validate_against(source).is_ok());
    }

    #[test]
    fn source_edit_rejects_u64_offsets_that_do_not_fit_or_reach_source() {
        let edit = GridSourceEdit {
            from: u64::MAX,
            to: u64::MAX,
            deleted: String::new(),
            inserted: String::new(),
        };
        assert!(edit.validate_against("source").is_err());
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
