//! Adapter workbook dell'host, senza dipendere da Tauri.
//!
//! Il motore della sessione vive nel formato ed è compilabile anche per WASM.
//! Questo adapter conserva l'API nativa e la derivazione comune `Revision::of`.
//! La valutazione della vertical slice usa il canale dati del bundle `fub.sheet`.
//! Le finestre grid sono proiezioni possedute dall'ABI, mentre tutta la mutazione
//! resta in [`fub_format_sheet::session::SheetSession`].

mod index;

pub(crate) use index::{SheetIndex, SHEET_ID};

use std::collections::HashMap;

use fub_abi::grid::{
    validate_grid_source, GridApplyRequest, GridCell, GridCellKey, GridCellStyle, GridCellValue,
    GridColumn, GridCommit, GridFormulaError, GridHorizontalAlign, GridInvalidation,
    GridRow, GridSession as AbiGridSession, GridSheet, GridSourceEdit, GridSurfaceSpec, GridWindow,
    GridWindowRequest as AbiGridWindowRequest,
};
use fub_abi::{PluginError, Revision};
use fub_format_sheet::{CellKey, CellStyle, CellValue, SheetId, Workbook};

pub use fub_format_sheet::session::{
    SheetCellPatch, SheetInvalidation, SheetOperation, SheetSessionError, SheetSourceEdit,
    SheetWindowCell, SheetWindowRequest, MAX_INVALIDATED_CELLS, MAX_OPERATION_INPUT_BYTES,
    MAX_OPERATION_PATCHES, MAX_WINDOW_CELLS, MAX_WINDOW_COLUMNS, MAX_WINDOW_RESPONSE_BYTES,
    MAX_WINDOW_ROWS,
};
pub use fub_format_sheet::WorkbookEvaluation;

pub type SheetWindow<'a> = fub_format_sheet::session::SheetWindow<'a, Revision>;
pub type SheetCommit = fub_format_sheet::session::SheetCommit<Revision>;

pub const SHEET_GRID_SURFACE: &str = "fub.grid.sheet";

/// Parses, validates and evaluates one authoritative `.fubsheet` source.
pub fn evaluate(source: &str) -> Result<WorkbookEvaluation, PluginError> {
    Workbook::parse(source)
        .and_then(|workbook| workbook.evaluate())
        .map_err(|error| PluginError::BadArgs(error.to_string().into()))
}

#[derive(Debug)]
pub struct SheetSession {
    inner: fub_format_sheet::session::SheetSession<Revision>,
}

impl SheetSession {
    pub fn open(source: &str) -> Result<Self, SheetSessionError> {
        Ok(Self {
            inner: fub_format_sheet::session::SheetSession::open(source, Revision::of)?,
        })
    }

    pub fn sheets(&self) -> &[fub_format_sheet::Sheet] {
        self.inner.sheets()
    }

    pub fn revision(&self) -> &Revision {
        self.inner.revision()
    }

    pub fn reload(&mut self, expected: &Revision, source: &str) -> Result<(), SheetSessionError> {
        self.inner.reload(expected, source, Revision::of)
    }
    pub fn source(&self) -> &str {
        self.inner.source()
    }

    pub fn window(
        &self,
        expected: &Revision,
        sheet_id: &SheetId,
        request: SheetWindowRequest,
    ) -> Result<SheetWindow<'_>, SheetSessionError> {
        self.inner.window(expected, sheet_id, request)
    }

    pub fn commit(
        &mut self,
        expected: &Revision,
        operation: &SheetOperation,
    ) -> Result<SheetCommit, SheetSessionError> {
        self.inner.commit(expected, operation, Revision::of)
    }
}

#[derive(Default)]
pub struct SheetGridProvider {
    next_instance: u64,
    instances: HashMap<String, SheetSession>,
}

impl SheetGridProvider {
    pub fn new() -> Self {
        Self::default()
    }

    fn instance(&self, instance: &str) -> Result<&SheetSession, PluginError> {
        self.instances.get(instance).ok_or_else(|| {
            PluginError::NotFound(format!("grid instance `{instance}`").into())
        })
    }

    fn instance_mut(&mut self, instance: &str) -> Result<&mut SheetSession, PluginError> {
        self.instances.get_mut(instance).ok_or_else(|| {
            PluginError::NotFound(format!("grid instance `{instance}`").into())
        })
    }
}

impl fub_abi::grid::GridProvider for SheetGridProvider {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec::new(
            SHEET_GRID_SURFACE,
            fub_format_sheet::FORMAT_ID,
        )]
    }

    fn open(
        &mut self,
        surface: &str,
        source: &str,
        revision: Revision,
    ) -> Result<AbiGridSession, PluginError> {
        if surface != SHEET_GRID_SURFACE {
            return Err(PluginError::NotFound(
                format!("grid surface `{surface}`").into(),
            ));
        }
        validate_grid_source(source)?;
        let session = SheetSession::open(source).map_err(sheet_session_error)?;
        if session.revision() != &revision {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        let instance = self.new_instance_id();
        let summary = grid_session(&session, instance.clone())?;
        self.instances.insert(instance, session);
        Ok(summary)
    }

    fn window(
        &mut self,
        instance: &str,
        request: AbiGridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        request.validate()?;
        let session = self.instance(instance)?;
        let source_window = session
            .window(
                &request.revision,
                &SheetId::from(request.sheet.clone()),
                SheetWindowRequest {
                    row_start: request.row_start as usize,
                    row_count: request.row_count as usize,
                    column_start: request.column_start as usize,
                    column_count: request.column_count as usize,
                },
            )
            .map_err(sheet_session_error)?;
        let window = grid_window(source_window)?;
        window.validate()?;
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let operation = SheetOperation {
            patches: request
                .patches
                .iter()
                .map(|patch| SheetCellPatch {
                    cell: CellKey {
                        sheet: SheetId::from(patch.cell.sheet.clone()),
                        row: fub_format_sheet::RowId::from(patch.cell.row.clone()),
                        column: fub_format_sheet::ColumnId::from(patch.cell.column.clone()),
                    },
                    before: patch.before.clone(),
                    after: patch.after.clone(),
                })
                .collect(),
        };
        let session = self.instance_mut(instance)?;
        let committed = session
            .commit(&request.revision, &operation)
            .map_err(sheet_session_error)?;
        let result = grid_commit(committed)?;
        result.validate()?;
        Ok(result)
    }

    fn reload(
        &mut self,
        instance: &str,
        expected: Revision,
        source: &str,
        revision: Revision,
    ) -> Result<AbiGridSession, PluginError> {
        validate_grid_source(source)?;
        if Revision::of(source) != revision {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        let session = self.instance_mut(instance)?;
        session
            .reload(&expected, source)
            .map_err(sheet_session_error)?;
        grid_session(session, instance.to_owned())
    }

    fn close(&mut self, instance: &str) -> Result<(), PluginError> {
        self.instances
            .remove(instance)
            .map(|_| ())
            .ok_or_else(|| PluginError::NotFound(format!("grid instance `{instance}`").into()))
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.instances.clear();
        Ok(())
    }
}

impl SheetGridProvider {
    fn new_instance_id(&mut self) -> String {
        loop {
            self.next_instance = self.next_instance.wrapping_add(1);
            let instance = format!("sheet-{}", self.next_instance);
            if !self.instances.contains_key(&instance) {
                return instance;
            }
        }
    }
}

fn grid_session(session: &SheetSession, instance: String) -> Result<AbiGridSession, PluginError> {
    let sheets = session
        .sheets()
        .iter()
        .map(|sheet| {
            Ok(GridSheet {
                id: sheet.id.as_ref().to_owned(),
                name: sheet.name.clone(),
                row_count: u32::try_from(sheet.rows.len())
                    .map_err(|_| PluginError::BadArgs("too many grid rows".into()))?,
                column_count: u32::try_from(sheet.columns.len())
                    .map_err(|_| PluginError::BadArgs("too many grid columns".into()))?,
            })
        })
        .collect::<Result<Vec<_>, PluginError>>()?;
    let result = AbiGridSession {
        instance,
        revision: session.revision().clone(),
        sheets,
    };
    result.validate()?;
    Ok(result)
}

fn grid_window(window: SheetWindow<'_>) -> Result<GridWindow, PluginError> {
    let rows = window
        .rows
        .iter()
        .enumerate()
        .map(|(offset, row)| GridRow {
            id: row.id.as_ref().to_owned(),
            index: (window.row_start + offset) as u32,
            height: row.height,
            hidden: row.hidden,
        })
        .collect();
    let columns = window
        .columns
        .iter()
        .enumerate()
        .map(|(offset, column)| GridColumn {
            id: column.id.as_ref().to_owned(),
            index: (window.column_start + offset) as u32,
            width: column.width,
            hidden: column.hidden,
        })
        .collect();
    let sheet = window.sheet.as_ref().to_owned();
    let cells = window
        .cells
        .iter()
        .map(|entry| GridCell {
            key: GridCellKey {
                sheet: sheet.clone(),
                row: entry.cell.row.as_ref().to_owned(),
                column: entry.cell.column.as_ref().to_owned(),
            },
            input: entry.cell.input.clone(),
            style: grid_style(&entry.cell.style),
            value: grid_value(entry.value),
        })
        .collect::<Vec<_>>();
    Ok(GridWindow {
        revision: window.revision.clone(),
        sheet: window.sheet.as_ref().to_owned(),
        row_start: window.row_start as u32,
        column_start: window.column_start as u32,
        total_rows: window.total_rows as u32,
        total_columns: window.total_columns as u32,
        rows,
        columns,
        cells,
    })
}

fn grid_commit(commit: SheetCommit) -> Result<GridCommit, PluginError> {
    let edit = GridSourceEdit {
        from: u64::try_from(commit.edit.from)
            .map_err(|_| PluginError::Internal("grid diff offset overflows ABI".into()))?,
        to: u64::try_from(commit.edit.to)
            .map_err(|_| PluginError::Internal("grid diff offset overflows ABI".into()))?,
        deleted: commit.edit.deleted,
        inserted: commit.edit.inserted,
    };
    let invalidation = match commit.invalidation {
        SheetInvalidation::All => GridInvalidation::All,
        SheetInvalidation::Cells(cells) => GridInvalidation::Cells(
            cells.into_iter().map(|cell| grid_key(&cell)).collect(),
        ),
    };
    Ok(GridCommit {
        revision: commit.revision,
        edit,
        invalidation,
    })
}

fn grid_key(key: &CellKey) -> GridCellKey {
    GridCellKey {
        sheet: key.sheet.as_ref().to_owned(),
        row: key.row.as_ref().to_owned(),
        column: key.column.as_ref().to_owned(),
    }
}

fn grid_style(style: &CellStyle) -> GridCellStyle {
    GridCellStyle {
        bold: style.bold,
        italic: style.italic,
        text_color: style.text_color.clone(),
        fill_color: style.fill_color.clone(),
        horizontal: style.horizontal.map(|horizontal| match horizontal {
            fub_format_sheet::HorizontalAlign::Start => GridHorizontalAlign::Start,
            fub_format_sheet::HorizontalAlign::Center => GridHorizontalAlign::Center,
            fub_format_sheet::HorizontalAlign::End => GridHorizontalAlign::End,
        }),
        number_format: style.number_format.clone(),
    }
}

fn grid_value(value: &CellValue) -> GridCellValue {
    match value {
        CellValue::Blank => GridCellValue::Blank,
        CellValue::Number(value) => GridCellValue::Number(*value),
        CellValue::Text(value) => GridCellValue::Text(value.clone()),
        CellValue::Boolean(value) => GridCellValue::Boolean(*value),
        CellValue::Error(error) => GridCellValue::Error(match error {
            fub_format_sheet::FormulaErrorCode::Parse => GridFormulaError::Parse,
            fub_format_sheet::FormulaErrorCode::Ref => GridFormulaError::Ref,
            fub_format_sheet::FormulaErrorCode::Name => GridFormulaError::Name,
            fub_format_sheet::FormulaErrorCode::Value => GridFormulaError::Value,
            fub_format_sheet::FormulaErrorCode::DivZero => GridFormulaError::DivZero,
            fub_format_sheet::FormulaErrorCode::Num => GridFormulaError::Num,
            fub_format_sheet::FormulaErrorCode::Cycle => GridFormulaError::Cycle,
        }),
    }
}

fn sheet_session_error(error: SheetSessionError) -> PluginError {
    match error {
        SheetSessionError::StaleRevision | SheetSessionError::PreimageMismatch => {
            PluginError::Conflict(error.to_string().into())
        }
        SheetSessionError::Serialization(_) => PluginError::Internal(error.to_string().into()),
        _ => PluginError::BadArgs(error.to_string().into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_format_sheet::CellKey;

    #[test]
    fn malformed_workbooks_are_bad_arguments() {
        let error = evaluate("{}").unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
    }

    #[test]
    fn native_adapter_derives_the_new_revision_after_an_atomic_patch() {
        let source = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r"}],"columns":[{"id":"c"}],"cells":[{"row":"r","column":"c","input":"1"}]}]}"#;
        let mut session = SheetSession::open(source).unwrap();
        let before = session.revision().clone();
        let committed = session
            .commit(
                &before,
                &SheetOperation {
                    patches: vec![SheetCellPatch {
                        cell: CellKey {
                            sheet: "s".into(),
                            row: "r".into(),
                            column: "c".into(),
                        },
                        before: Some("1".into()),
                        after: "2".into(),
                    }],
                },
            )
            .unwrap();
        assert_eq!(&committed.revision, session.revision());
        assert_ne!(session.revision(), &before);
        assert!(session.source().contains("\"input\": \"2\""));
    }

    #[test]
    fn native_grid_provider_owns_lifecycle_and_delegates_to_sheet_session() {
        use fub_abi::grid::{GridCellPatch, GridProvider};

        let source = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r"}],"columns":[{"id":"c"}],"cells":[{"row":"r","column":"c","input":"1"}]}]}"#;
        let replacement = r#"{"version":1,"sheets":[{"id":"s","name":"Foglio","rows":[{"id":"r"}],"columns":[{"id":"c"}],"cells":[{"row":"r","column":"c","input":"3"}]}]}"#;
        let mut provider = SheetGridProvider::new();
        let opened = provider
            .open(SHEET_GRID_SURFACE, source, Revision::of(source))
            .unwrap();
        assert_eq!(opened.sheets[0].id, "s");
        let instance = opened.instance.clone();
        let window = provider
            .window(
                &instance,
                fub_abi::grid::GridWindowRequest {
                    revision: opened.revision.clone(),
                    sheet: "s".into(),
                    row_start: 0,
                    row_count: 1,
                    column_start: 0,
                    column_count: 1,
                },
            )
            .unwrap();
        assert_eq!(window.cells[0].input, "1");

        let commit = provider
            .apply(
                &instance,
                GridApplyRequest {
                    revision: opened.revision.clone(),
                    patches: vec![GridCellPatch {
                        cell: GridCellKey {
                            sheet: "s".into(),
                            row: "r".into(),
                            column: "c".into(),
                        },
                        before: Some("1".into()),
                        after: "2".into(),
                    }],
                },
            )
            .unwrap();
        assert!(commit.edit.deleted.contains("\"input\":\"1\""));
        assert!(commit.edit.inserted.contains("\"input\": \"2\""));
        assert_ne!(commit.revision, opened.revision);

        let stale = provider.apply(
            &instance,
            GridApplyRequest {
                revision: opened.revision,
                patches: vec![GridCellPatch {
                    cell: GridCellKey {
                        sheet: "s".into(),
                        row: "r".into(),
                        column: "c".into(),
                    },
                    before: Some("2".into()),
                    after: "4".into(),
                }],
            },
        );
        assert!(matches!(stale, Err(PluginError::Conflict(_))));

        let reload_stale = provider.reload(
            &instance,
            Revision::of(source),
            replacement,
            Revision::of(replacement),
        );
        assert!(matches!(reload_stale, Err(PluginError::Conflict(_))));
        let reloaded = provider
            .reload(
                &instance,
                commit.revision,
                replacement,
                Revision::of(replacement),
            )
            .unwrap();
        assert_eq!(reloaded.revision, Revision::of(replacement));

        provider.close(&instance).unwrap();
        assert!(matches!(
            provider.close(&instance),
            Err(PluginError::NotFound(_))
        ));
        provider.shutdown().unwrap();
    }
}
