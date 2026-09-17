//! Grid WASM component backed by the canonical `fub-format-sheet` session.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:grid/grid",
    generate_all,
});

use std::collections::HashMap;

use exports::fub::abi::grid::{
    GridApplyRequest, GridCell, GridCellKey, GridCellStyle, GridCellValue, GridColumn, GridCommit,
    GridFormulaError, GridHorizontalAlign, GridInvalidation, GridRow, GridSession, GridSheet,
    GridSourceEdit, GridSurfaceSpec, GridWindow, GridWindowRequest, Guest as GridGuest,
};
use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::text::Text;
use fub_abi::edit::Revision;
use fub_format_sheet::session::{
    SheetCellPatch, SheetCommit, SheetInvalidation, SheetOperation, SheetSession,
    SheetSessionError, SheetWindowRequest,
};
use fub_format_sheet::{CellKey, CellValue, HorizontalAlign};

const PLUGIN_ID: &str = "example.grid";
const SURFACE_ID: &str = "fub.grid.sheet";
const FORMAT_ID: &str = "fubsheet";

struct State {
    next_instance: u64,
    sessions: HashMap<String, SheetSession<Revision>>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            next_instance: 0,
            sessions: HashMap::new(),
        }
    }
}

static mut STATE: Option<State> = None;

fn state() -> &'static mut State {
    // A component instance has one linear memory and is not concurrently called.
    unsafe { STATE.get_or_insert_with(State::default) }
}

fn literal(value: impl Into<String>) -> Text {
    Text::Literal(value.into())
}

fn bad(error: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(literal(error.to_string()))
}

fn conflict(error: impl std::fmt::Display) -> PluginError {
    PluginError::Conflict(literal(error.to_string()))
}

fn not_found(error: impl std::fmt::Display) -> PluginError {
    PluginError::NotFound(literal(error.to_string()))
}

fn session_error(error: SheetSessionError) -> PluginError {
    match error {
        SheetSessionError::StaleRevision | SheetSessionError::PreimageMismatch => {
            conflict(error)
        }
        other => bad(other),
    }
}

fn next_instance(state: &mut State) -> String {
    loop {
        state.next_instance = state.next_instance.wrapping_add(1);
        let instance = format!("sheet-{}", state.next_instance);
        if !state.sessions.contains_key(&instance) {
            return instance;
        }
    }
}

fn key(key: &CellKey) -> GridCellKey {
    GridCellKey {
        sheet: key.sheet.as_ref().to_owned(),
        row: key.row.as_ref().to_owned(),
        column: key.column.as_ref().to_owned(),
    }
}

fn style(style: &fub_format_sheet::CellStyle) -> GridCellStyle {
    GridCellStyle {
        bold: style.bold,
        italic: style.italic,
        text_color: style.text_color.clone(),
        fill_color: style.fill_color.clone(),
        horizontal: style.horizontal.map(|value| match value {
            HorizontalAlign::Start => GridHorizontalAlign::Start,
            HorizontalAlign::Center => GridHorizontalAlign::Center,
            HorizontalAlign::End => GridHorizontalAlign::End,
        }),
        number_format: style.number_format.clone(),
    }
}

fn value(value: &CellValue) -> GridCellValue {
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

fn summary(session: &SheetSession<Revision>, instance: String) -> Result<GridSession, PluginError> {
    let sheets = session
        .sheets()
        .iter()
        .map(|sheet| {
            Ok(GridSheet {
                id: sheet.id.as_ref().to_owned(),
                name: sheet.name.clone(),
                row_count: u32::try_from(sheet.rows.len()).map_err(|_| bad("too many grid rows"))?,
                column_count: u32::try_from(sheet.columns.len())
                    .map_err(|_| bad("too many grid columns"))?,
            })
        })
        .collect::<Result<Vec<_>, PluginError>>()?;
    Ok(GridSession {
        instance,
        revision: session.revision().0.clone(),
        sheets,
    })
}

fn window(
    source: fub_format_sheet::session::SheetWindow<'_, Revision>,
) -> GridWindow {
    let rows = source
        .rows
        .iter()
        .enumerate()
        .map(|(offset, row)| GridRow {
            id: row.id.as_ref().to_owned(),
            index: (source.row_start + offset) as u32,
            height: row.height,
            hidden: row.hidden,
        })
        .collect();
    let columns = source
        .columns
        .iter()
        .enumerate()
        .map(|(offset, column)| GridColumn {
            id: column.id.as_ref().to_owned(),
            index: (source.column_start + offset) as u32,
            width: column.width,
            hidden: column.hidden,
        })
        .collect();
    let sheet = source.sheet.as_ref().to_owned();
    let cells = source
        .cells
        .iter()
        .map(|entry| GridCell {
            key: GridCellKey {
                sheet: sheet.clone(),
                row: entry.cell.row.as_ref().to_owned(),
                column: entry.cell.column.as_ref().to_owned(),
            },
            input: entry.cell.input.clone(),
            style: style(&entry.cell.style),
            value: value(entry.value),
        })
        .collect();
    GridWindow {
        revision: source.revision.0.clone(),
        sheet,
        row_start: source.row_start as u32,
        column_start: source.column_start as u32,
        total_rows: source.total_rows as u32,
        total_columns: source.total_columns as u32,
        rows,
        columns,
        cells,
    }
}

fn commit(source: SheetCommit<Revision>) -> GridCommit {
    let edit = GridSourceEdit {
        from: source.edit.from as u64,
        to: source.edit.to as u64,
        deleted: source.edit.deleted,
        inserted: source.edit.inserted,
    };
    let invalidation = match source.invalidation {
        SheetInvalidation::All => GridInvalidation::All,
        SheetInvalidation::Cells(cells) => {
            GridInvalidation::Cells(cells.iter().map(key).collect())
        }
    };
    GridCommit {
        revision: source.revision.0,
        edit,
        invalidation,
    }
}

struct Component;

impl PluginGuest for Component {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: PLUGIN_ID.to_owned(),
            name: "Canonical grid component".to_owned(),
            version: "0.1.0".to_owned(),
            abi_version: "0.1.1".to_owned(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec!["grid".to_owned()],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: String::new(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        unsafe {
            STATE = None;
        }
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(literal(job)))
    }
}

impl GridGuest for Component {
    fn surfaces() -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec {
            id: SURFACE_ID.to_owned(),
            format: FORMAT_ID.to_owned(),
            family: if cfg!(feature = "incompatible-grid") {
                "future-grid".to_owned()
            } else {
                "grid".to_owned()
            },
            protocol_version: if cfg!(feature = "incompatible-grid") {
                99
            } else {
                1
            },
        }]
    }

    fn open(
        surface: String,
        source: String,
        revision: String,
    ) -> Result<GridSession, PluginError> {
        if cfg!(feature = "incompatible-grid") {
            panic!("incompatible grid open must not be called");
        }
        if surface != SURFACE_ID {
            return Err(not_found(format!("grid surface `{surface}`")));
        }
        let expected = Revision::of(&source);
        if expected.0 != revision {
            return Err(conflict("grid source does not match its declared revision"));
        }
        let session = SheetSession::open(&source, Revision::of).map_err(session_error)?;
        let state = state();
        let instance = next_instance(state);
        let result = summary(&session, instance.clone())?;
        state.sessions.insert(instance, session);
        Ok(result)
    }

    fn window(
        instance: String,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        if cfg!(feature = "trap-on-window") {
            panic!("grid window trap requested by test component");
        }
        let state = state();
        let session = state
            .sessions
            .get(&instance)
            .ok_or_else(|| not_found(format!("grid instance `{instance}`")))?;
        let source = session
            .window(
                &Revision(request.revision),
                &request.sheet.into(),
                SheetWindowRequest {
                    row_start: request.row_start as usize,
                    row_count: request.row_count as usize,
                    column_start: request.column_start as usize,
                    column_count: request.column_count as usize,
                },
            )
            .map_err(session_error)?;
        let mut result = window(source);
        if cfg!(feature = "malformed-window") {
            result.sheet = "wrong-sheet".to_owned();
        }
        Ok(result)
    }

    fn apply(
        instance: String,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        let operation = SheetOperation {
            patches: request
                .patches
                .iter()
                .map(|patch| SheetCellPatch {
                    cell: CellKey {
                        sheet: patch.cell.sheet.clone().into(),
                        row: patch.cell.row.clone().into(),
                        column: patch.cell.column.clone().into(),
                    },
                    before: patch.before.clone(),
                    after: patch.after.clone(),
                })
                .collect(),
        };
        let state = state();
        let session = state
            .sessions
            .get_mut(&instance)
            .ok_or_else(|| not_found(format!("grid instance `{instance}`")))?;
        let source = session
            .commit(&Revision(request.revision), &operation, Revision::of)
            .map_err(session_error)?;
        Ok(commit(source))
    }

    fn reload(
        instance: String,
        expected: String,
        source: String,
        revision: String,
    ) -> Result<GridSession, PluginError> {
        let derived = Revision::of(&source);
        if derived.0 != revision {
            return Err(conflict("grid source does not match its declared revision"));
        }
        let state = state();
        let session = state
            .sessions
            .get_mut(&instance)
            .ok_or_else(|| not_found(format!("grid instance `{instance}`")))?;
        session
            .reload(&Revision(expected), &source, Revision::of)
            .map_err(session_error)?;
        summary(session, instance)
    }

    fn close(instance: String) -> Result<(), PluginError> {
        state()
            .sessions
            .remove(&instance)
            .map(|_| ())
            .ok_or_else(|| not_found(format!("grid instance `{instance}`")))
    }

    fn shutdown() -> Result<(), PluginError> {
        state().sessions.clear();
        Ok(())
    }
}

export!(Component);
