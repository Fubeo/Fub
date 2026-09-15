//! Motore workbook consumato dagli host concreti senza dipendere da Tauri.

use std::collections::{HashMap, HashSet, VecDeque};

use fub_abi::grid::{
    validate_grid_source, GridApplyRequest, GridCell as AbiCell, GridCellKey, GridCellSnapshot,
    GridCellStyle, GridCellValue, GridColumn, GridCommit, GridFormulaError, GridHorizontalAlign,
    GridInvalidation, GridProvider, GridRow, GridSession, GridSheet, GridSurfaceSpec, GridWindow,
    GridWindowRequest, MAX_GRID_INVALIDATED_CELLS, MAX_GRID_RESPONSE_BYTES, MAX_GRID_WINDOW_CELLS,
};
use fub_abi::{EditRequest, PluginError, Revision, Span, TextEdit};
pub use fub_format_sheet::WorkbookEvaluation;
use fub_format_sheet::{
    Cell, CellDependency, CellKey, CellStyle, CellValue, ColumnId, FormulaErrorCode,
    HorizontalAlign, RowId, SheetId, Workbook,
};

pub const SHEET_GRID_SURFACE: &str = "fub.grid.sheet";

/// Parses, validates and evaluates one authoritative `.fubsheet` source.
pub fn evaluate(source: &str) -> Result<WorkbookEvaluation, PluginError> {
    Workbook::parse(source)
        .and_then(|workbook| workbook.evaluate())
        .map_err(sheet_error)
}

#[derive(Clone)]
struct OpenSheet {
    source: String,
    revision: Revision,
    workbook: Workbook,
    values: HashMap<CellKey, CellValue>,
    dependencies: Vec<CellDependency>,
}

impl OpenSheet {
    fn parse(source: &str, revision: Revision) -> Result<Self, PluginError> {
        validate_grid_source(source)?;
        if !revision.matches(source) {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        let workbook = Workbook::parse(source).map_err(sheet_error)?;
        let evaluation = workbook.evaluate().map_err(sheet_error)?;
        let values = evaluation
            .cells
            .into_iter()
            .map(|cell| {
                (
                    CellKey {
                        sheet: cell.sheet,
                        row: cell.row,
                        column: cell.column,
                    },
                    cell.value,
                )
            })
            .collect();
        Ok(Self {
            source: source.to_owned(),
            revision,
            workbook,
            values,
            dependencies: evaluation.dependencies,
        })
    }

    fn summary(&self, instance: String) -> Result<GridSession, PluginError> {
        let sheets = self
            .workbook
            .sheets
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
            .collect::<Result<_, PluginError>>()?;
        Ok(GridSession { instance, sheets })
    }
}

#[derive(Default)]
pub struct SheetGridProvider {
    next_instance: u64,
    instances: HashMap<String, OpenSheet>,
}

impl SheetGridProvider {
    pub fn new() -> Self {
        Self::default()
    }

    fn instance(&self, id: &str) -> Result<&OpenSheet, PluginError> {
        self.instances
            .get(id)
            .ok_or_else(|| PluginError::NotFound(format!("grid instance `{id}`").into()))
    }
}

impl GridProvider for SheetGridProvider {
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
    ) -> Result<GridSession, PluginError> {
        if surface != SHEET_GRID_SURFACE {
            return Err(PluginError::NotFound(
                format!("grid surface `{surface}`").into(),
            ));
        }
        let open = OpenSheet::parse(source, revision)?;
        self.next_instance = self.next_instance.wrapping_add(1);
        let instance = format!("sheet-{}", self.next_instance);
        let summary = open.summary(instance.clone())?;
        self.instances.insert(instance, open);
        Ok(summary)
    }

    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        request.validate()?;
        let open = self.instance(instance)?;
        let sheet = open
            .workbook
            .sheets
            .iter()
            .find(|sheet| sheet.id.as_ref() == request.sheet)
            .ok_or_else(|| {
                PluginError::NotFound(format!("grid sheet `{}`", request.sheet).into())
            })?;
        let row_start = request.row_start as usize;
        let column_start = request.column_start as usize;
        let row_end = row_start
            .checked_add(request.row_count as usize)
            .filter(|end| *end <= sheet.rows.len())
            .ok_or_else(|| PluginError::BadArgs("grid row window is outside the sheet".into()))?;
        let column_end = column_start
            .checked_add(request.column_count as usize)
            .filter(|end| *end <= sheet.columns.len())
            .ok_or_else(|| {
                PluginError::BadArgs("grid column window is outside the sheet".into())
            })?;
        let rows = sheet.rows[row_start..row_end]
            .iter()
            .enumerate()
            .map(|(offset, row)| GridRow {
                id: row.id.as_ref().to_owned(),
                index: request.row_start + offset as u32,
                height: row.height,
                hidden: row.hidden,
            })
            .collect::<Vec<_>>();
        let columns = sheet.columns[column_start..column_end]
            .iter()
            .enumerate()
            .map(|(offset, column)| GridColumn {
                id: column.id.as_ref().to_owned(),
                index: request.column_start + offset as u32,
                width: column.width,
                hidden: column.hidden,
            })
            .collect::<Vec<_>>();
        let row_ids = rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<HashSet<_>>();
        let column_ids = columns
            .iter()
            .map(|column| column.id.as_str())
            .collect::<HashSet<_>>();
        let mut cells = Vec::new();
        for cell in &sheet.cells {
            if !row_ids.contains(cell.row.as_ref()) || !column_ids.contains(cell.column.as_ref()) {
                continue;
            }
            if cells.len() >= MAX_GRID_WINDOW_CELLS {
                return Err(PluginError::BadArgs(
                    "grid window exceeds cell limit".into(),
                ));
            }
            let key = CellKey {
                sheet: sheet.id.clone(),
                row: cell.row.clone(),
                column: cell.column.clone(),
            };
            cells.push(AbiCell {
                key: to_grid_key(&key),
                snapshot: snapshot(cell),
                value: open
                    .values
                    .get(&key)
                    .cloned()
                    .map(to_grid_value)
                    .unwrap_or(GridCellValue::Blank),
            });
        }
        let window = GridWindow {
            sheet: request.sheet,
            rows,
            columns,
            cells,
        };
        window.validate()?;
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let current = self.instance(instance)?.clone();
        let mut workbook = current.workbook.clone();
        let mut seen = HashSet::with_capacity(request.patches.len());

        for patch in &request.patches {
            if !seen.insert(&patch.cell) {
                return Err(PluginError::BadArgs(
                    "grid commit contains duplicate coordinates".into(),
                ));
            }
            let sheet = workbook
                .sheets
                .iter()
                .find(|sheet| sheet.id.as_ref() == patch.cell.sheet)
                .ok_or_else(|| PluginError::BadArgs("grid patch names an unknown sheet".into()))?;
            if !sheet
                .rows
                .iter()
                .any(|row| row.id.as_ref() == patch.cell.row)
                || !sheet
                    .columns
                    .iter()
                    .any(|column| column.id.as_ref() == patch.cell.column)
            {
                return Err(PluginError::BadArgs(
                    "grid patch names an unknown coordinate".into(),
                ));
            }
            let before = sheet
                .cells
                .iter()
                .find(|cell| {
                    cell.row.as_ref() == patch.cell.row && cell.column.as_ref() == patch.cell.column
                })
                .map(snapshot);
            if before != patch.before {
                return Err(PluginError::Conflict(
                    "grid patch preimage does not match the open session".into(),
                ));
            }
        }

        for patch in &request.patches {
            let sheet = workbook
                .sheets
                .iter_mut()
                .find(|sheet| sheet.id.as_ref() == patch.cell.sheet)
                .expect("coordinates validated before mutation");
            let at = sheet.cells.iter().position(|cell| {
                cell.row.as_ref() == patch.cell.row && cell.column.as_ref() == patch.cell.column
            });
            match (&patch.after, at) {
                (None, Some(at)) => {
                    sheet.cells.remove(at);
                }
                (None, None) => {}
                (Some(after), Some(at)) => {
                    sheet.cells[at] = from_snapshot(&patch.cell, after);
                }
                (Some(after), None) => sheet.cells.push(from_snapshot(&patch.cell, after)),
            }
        }

        let source = workbook.serialize().map_err(sheet_error)?;
        let next = OpenSheet::parse(&source, Revision::of(&source))?;
        let edit = diff_request(&current.source, &source, current.revision.clone());
        let invalidation = invalidation_for(&request, &next.dependencies);
        let commit = GridCommit { edit, invalidation };
        let response = serde_json::to_vec(&commit)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if response.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(PluginError::BadArgs(
                "grid commit response exceeds byte limit".into(),
            ));
        }
        self.instances.insert(instance.to_owned(), next);
        Ok(commit)
    }

    fn reload(
        &mut self,
        instance: &str,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        if !self.instances.contains_key(instance) {
            return Err(PluginError::NotFound(
                format!("grid instance `{instance}`").into(),
            ));
        }
        let open = OpenSheet::parse(source, revision)?;
        let summary = open.summary(instance.to_owned())?;
        self.instances.insert(instance.to_owned(), open);
        Ok(summary)
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

fn sheet_error(error: fub_format_sheet::SheetError) -> PluginError {
    PluginError::BadArgs(error.to_string().into())
}

fn to_grid_key(key: &CellKey) -> GridCellKey {
    GridCellKey {
        sheet: key.sheet.as_ref().to_owned(),
        row: key.row.as_ref().to_owned(),
        column: key.column.as_ref().to_owned(),
    }
}

fn to_cell_key(key: &GridCellKey) -> CellKey {
    CellKey {
        sheet: SheetId::from(key.sheet.clone()),
        row: RowId::from(key.row.clone()),
        column: ColumnId::from(key.column.clone()),
    }
}

fn snapshot(cell: &Cell) -> GridCellSnapshot {
    GridCellSnapshot {
        input: cell.input.clone(),
        style: GridCellStyle {
            bold: cell.style.bold,
            italic: cell.style.italic,
            text_color: cell.style.text_color.clone(),
            fill_color: cell.style.fill_color.clone(),
            horizontal: cell.style.horizontal.map(|align| match align {
                HorizontalAlign::Start => GridHorizontalAlign::Start,
                HorizontalAlign::Center => GridHorizontalAlign::Center,
                HorizontalAlign::End => GridHorizontalAlign::End,
            }),
            number_format: cell.style.number_format.clone(),
        },
    }
}

fn from_snapshot(key: &GridCellKey, value: &GridCellSnapshot) -> Cell {
    Cell {
        row: RowId::from(key.row.clone()),
        column: ColumnId::from(key.column.clone()),
        input: value.input.clone(),
        style: CellStyle {
            bold: value.style.bold,
            italic: value.style.italic,
            text_color: value.style.text_color.clone(),
            fill_color: value.style.fill_color.clone(),
            horizontal: value.style.horizontal.map(|align| match align {
                GridHorizontalAlign::Start => HorizontalAlign::Start,
                GridHorizontalAlign::Center => HorizontalAlign::Center,
                GridHorizontalAlign::End => HorizontalAlign::End,
            }),
            number_format: value.style.number_format.clone(),
        },
    }
}

fn to_grid_value(value: CellValue) -> GridCellValue {
    match value {
        CellValue::Blank => GridCellValue::Blank,
        CellValue::Number(value) => GridCellValue::Number(value),
        CellValue::Text(value) => GridCellValue::Text(value),
        CellValue::Boolean(value) => GridCellValue::Boolean(value),
        CellValue::Error(error) => GridCellValue::Error(match error {
            FormulaErrorCode::Parse => GridFormulaError::Parse,
            FormulaErrorCode::Ref => GridFormulaError::Ref,
            FormulaErrorCode::Name => GridFormulaError::Name,
            FormulaErrorCode::Value => GridFormulaError::Value,
            FormulaErrorCode::DivZero => GridFormulaError::DivZero,
            FormulaErrorCode::Num => GridFormulaError::Num,
            FormulaErrorCode::Cycle => GridFormulaError::Cycle,
        }),
    }
}

fn splits_crlf(source: &str, at: usize) -> bool {
    at > 0
        && at < source.len()
        && source.as_bytes()[at - 1] == b'\r'
        && source.as_bytes()[at] == b'\n'
}

fn diff_request(before: &str, after: &str, base: Revision) -> EditRequest {
    let mut start = before
        .bytes()
        .zip(after.bytes())
        .take_while(|(left, right)| left == right)
        .count();
    while !before.is_char_boundary(start)
        || !after.is_char_boundary(start)
        || splits_crlf(before, start)
        || splits_crlf(after, start)
    {
        start -= 1;
    }
    let max_suffix = before.len().min(after.len()) - start;
    let mut suffix = before
        .bytes()
        .rev()
        .zip(after.bytes().rev())
        .take(max_suffix)
        .take_while(|(left, right)| left == right)
        .count();
    while !before.is_char_boundary(before.len() - suffix)
        || !after.is_char_boundary(after.len() - suffix)
        || splits_crlf(before, before.len() - suffix)
        || splits_crlf(after, after.len() - suffix)
    {
        suffix -= 1;
    }
    EditRequest::new(
        base,
        vec![TextEdit::replace(
            Span::new(start, before.len() - suffix),
            &after[start..after.len() - suffix],
        )],
    )
}

fn invalidation_for(
    request: &GridApplyRequest,
    dependencies: &[CellDependency],
) -> GridInvalidation {
    let mut reverse: HashMap<CellKey, Vec<&CellKey>> = HashMap::new();
    for dependency in dependencies {
        for prerequisite in &dependency.depends_on {
            reverse
                .entry(prerequisite.clone())
                .or_default()
                .push(&dependency.cell);
        }
    }
    let mut reached = request
        .patches
        .iter()
        .map(|patch| to_cell_key(&patch.cell))
        .collect::<HashSet<_>>();
    let mut queue = reached.iter().cloned().collect::<VecDeque<_>>();
    while let Some(cell) = queue.pop_front() {
        if let Some(dependents) = reverse.get(&cell) {
            for dependent in dependents {
                if reached.insert((*dependent).clone()) {
                    if reached.len() > MAX_GRID_INVALIDATED_CELLS {
                        return GridInvalidation::All;
                    }
                    queue.push_back((*dependent).clone());
                }
            }
        }
    }
    let mut cells = reached.iter().map(to_grid_key).collect::<Vec<_>>();
    cells.sort();
    GridInvalidation::Cells(cells)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::grid::GridCellPatch;
    use fub_sdk::testing::conformance::{a_grid_supports_the_lifecycle, GridLifecycleFixture};

    fn workbook() -> String {
        r#"{
  "version": 1,
  "sheets": [
    {
      "id": "sheet-1",
      "name": "Sheet 1",
      "rows": [{ "id": "row-1" }],
      "columns": [{ "id": "column-a" }, { "id": "column-b" }],
      "cells": [
        { "row": "row-1", "column": "column-a", "input": "2" },
        { "row": "row-1", "column": "column-b", "input": "=A1*3" }
      ]
    }
  ]
}
"#
        .to_owned()
    }

    fn one_row() -> GridWindowRequest {
        GridWindowRequest {
            sheet: "sheet-1".into(),
            row_start: 0,
            row_count: 1,
            column_start: 0,
            column_count: 2,
        }
    }

    #[test]
    fn diff_never_splits_utf8_or_crlf_boundaries() {
        for (before, after) in [
            ("🙂a\r\nb", "🙂a\rxb"),
            ("🙂aX\r\nb", "🙂aY\nb"),
            ("🙂 café\r\n", "🙂 caffè\n"),
        ] {
            let edit = diff_request(before, after, Revision::of(before));
            let (applied, _) = edit.apply_to(before).expect("valid guarded edit");
            assert_eq!(applied, after);
        }
    }

    #[test]
    fn native_sheet_provider_passes_the_shared_grid_lifecycle() {
        fn committed_cell_is_seven(source: &str) -> bool {
            serde_json::from_str::<serde_json::Value>(source)
                .ok()
                .and_then(|value| value.pointer("/sheets/0/cells/0/input").cloned())
                == Some(serde_json::Value::String("7".into()))
        }

        let source = workbook();
        let mut provider = SheetGridProvider::new();
        a_grid_supports_the_lifecycle(
            &mut provider,
            GridLifecycleFixture {
                surface: SHEET_GRID_SURFACE,
                source: &source,
                input: "2",
                replacement: "7",
                cell: GridCellKey {
                    sheet: "sheet-1".into(),
                    row: "row-1".into(),
                    column: "column-a".into(),
                },
                serialized_matches: committed_cell_is_seven,
            },
        );
    }

    #[test]
    fn malformed_workbooks_are_bad_arguments() {
        let error = evaluate("{}").unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
    }

    #[test]
    fn a_coordinate_commit_is_guarded_and_invalidates_transitive_dependents() {
        let source = workbook();
        let mut provider = SheetGridProvider::new();
        let session = provider
            .open(SHEET_GRID_SURFACE, &source, Revision::of(&source))
            .unwrap();
        let commit = provider
            .apply(
                &session.instance,
                GridApplyRequest {
                    patches: vec![GridCellPatch {
                        cell: GridCellKey {
                            sheet: "sheet-1".into(),
                            row: "row-1".into(),
                            column: "column-a".into(),
                        },
                        before: Some(GridCellSnapshot {
                            input: "2".into(),
                            style: GridCellStyle::default(),
                        }),
                        after: Some(GridCellSnapshot {
                            input: "7".into(),
                            style: GridCellStyle::default(),
                        }),
                    }],
                },
            )
            .unwrap();
        let (changed, _) = commit.edit.apply_to(&source).unwrap();
        assert!(matches!(
            &commit.invalidation,
            GridInvalidation::Cells(cells) if cells.len() == 2
        ));
        let window = provider.window(&session.instance, one_row()).unwrap();
        assert_eq!(window.cells[0].value, GridCellValue::Number(7.0));
        assert_eq!(window.cells[1].value, GridCellValue::Number(21.0));
        assert_eq!(
            Revision::of(&changed),
            provider.instance(&session.instance).unwrap().revision
        );
    }

    #[test]
    fn window_rejects_matching_cells_beyond_limit() {
        let row_id = RowId::from("row-1");
        let column_id = ColumnId::from("column-a");
        let mut sheet = fub_format_sheet::Sheet::new("sheet-1", "Sheet 1");
        sheet.rows = vec![fub_format_sheet::Row {
            id: row_id.clone(),
            height: None,
            hidden: false,
        }];
        sheet.columns = vec![fub_format_sheet::Column {
            id: column_id.clone(),
            width: None,
            hidden: false,
        }];
        sheet.cells = (0..=MAX_GRID_WINDOW_CELLS)
            .map(|_| Cell {
                row: row_id.clone(),
                column: column_id.clone(),
                input: String::new(),
                style: CellStyle::default(),
            })
            .collect();

        let mut provider = SheetGridProvider::new();
        provider.instances.insert(
            "test-instance".into(),
            OpenSheet {
                source: String::new(),
                revision: Revision::of(""),
                workbook: Workbook::new(vec![sheet]),
                values: HashMap::new(),
                dependencies: Vec::new(),
            },
        );
        let error = provider
            .window(
                "test-instance",
                GridWindowRequest {
                    sheet: "sheet-1".into(),
                    row_start: 0,
                    row_count: 1,
                    column_start: 0,
                    column_count: 1,
                },
            )
            .unwrap_err();

        assert!(matches!(error, PluginError::BadArgs(_)));
    }

    #[test]
    fn a_stale_preimage_changes_nothing() {
        let source = workbook();
        let mut provider = SheetGridProvider::new();
        let session = provider
            .open(SHEET_GRID_SURFACE, &source, Revision::of(&source))
            .unwrap();
        let error = provider
            .apply(
                &session.instance,
                GridApplyRequest {
                    patches: vec![GridCellPatch {
                        cell: GridCellKey {
                            sheet: "sheet-1".into(),
                            row: "row-1".into(),
                            column: "column-a".into(),
                        },
                        before: None,
                        after: Some(GridCellSnapshot {
                            input: "7".into(),
                            style: GridCellStyle::default(),
                        }),
                    }],
                },
            )
            .unwrap_err();
        assert!(matches!(error, PluginError::Conflict(_)));
        assert_eq!(provider.instance(&session.instance).unwrap().source, source);
    }

    #[test]
    fn close_retires_the_instance() {
        let source = workbook();
        let mut provider = SheetGridProvider::new();
        let session = provider
            .open(SHEET_GRID_SURFACE, &source, Revision::of(&source))
            .unwrap();
        provider.close(&session.instance).unwrap();
        assert!(provider.window(&session.instance, one_row()).is_err());
    }
}
