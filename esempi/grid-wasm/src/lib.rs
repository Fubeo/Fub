wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:grid/grid",
    generate_all,
});

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

use exports::fub::abi::grid::{
    Guest as GridGuest, GridApplyRequest, GridCell, GridCellKey, GridCellSnapshot, GridCellStyle,
    GridCellValue, GridColumn, GridCommit, GridInvalidation, GridRow, GridSession, GridSheet,
    GridSurfaceSpec, GridWindow, GridWindowRequest,
};
use exports::fub::abi::plugin::{Guest as PluginGuest, PluginManifest, PluginPermissions};
use fub::abi::edit::{EditRequest, TextEdit};
use fub::abi::errors::PluginError;
use fub::abi::model::Span;
use fub::abi::text::Text;

const PLUGIN_ID: &str = "example.grid";
const SURFACE_ID: &str = "example.grid:sheet";
const SHEET_ID: &str = "sheet-1";
const ROW_ID: &str = "row-1";
const COLUMN_ID: &str = "column-1";

struct OpenGrid {
    source: String,
    revision: String,
}

thread_local! {
    static NEXT_INSTANCE: Cell<u32> = const { Cell::new(1) };
    static OPEN: RefCell<BTreeMap<String, OpenGrid>> = RefCell::new(BTreeMap::new());
}

struct Component;

fn bad(message: impl Into<String>) -> PluginError {
    PluginError::BadArgs(Text::Literal(message.into()))
}

fn snapshot(input: String) -> GridCellSnapshot {
    GridCellSnapshot {
        input,
        style: GridCellStyle {
            bold: false,
            italic: false,
            text_color: None,
            fill_color: None,
            horizontal: None,
            number_format: None,
        },
    }
}

fn key() -> GridCellKey {
    GridCellKey {
        sheet: SHEET_ID.to_string(),
        row: ROW_ID.to_string(),
        column: COLUMN_ID.to_string(),
    }
}

fn session(instance: String) -> GridSession {
    GridSession {
        instance,
        sheets: vec![GridSheet {
            id: SHEET_ID.to_string(),
            name: "Sheet 1".to_string(),
            row_count: 1,
            column_count: 1,
        }],
    }
}

impl PluginGuest for Component {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: PLUGIN_ID.to_string(),
            name: "Example Grid".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.1.2".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
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
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        Err(PluginError::UnknownJob(Text::Literal(job)))
    }
}

impl GridGuest for Component {
    fn surfaces() -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec {
            id: SURFACE_ID.to_string(),
            format: "fubsheet".to_string(),
            protocol_version: 1,
        }]
    }

    fn open(
        surface: String,
        source: String,
        revision: String,
    ) -> Result<GridSession, PluginError> {
        if surface != SURFACE_ID {
            return Err(bad("unknown grid surface"));
        }
        let expected = ::fub_abi::edit::Revision::of(&source);
        if revision != expected.as_str() {
            return Err(PluginError::Conflict(Text::Literal(
                "source revision does not match".to_string(),
            )));
        }
        let instance = NEXT_INSTANCE.with(|next| {
            let value = next.get();
            next.set(value + 1);
            format!("grid-{value}")
        });
        OPEN.with(|open| {
            open.borrow_mut().insert(
                instance.clone(),
                OpenGrid {
                    source,
                    revision,
                },
            );
        });
        Ok(session(instance))
    }

    fn window(
        instance: String,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        if request.sheet != SHEET_ID {
            return Err(bad("unknown sheet"));
        }
        OPEN.with(|open| {
            let open = open.borrow();
            let state = open.get(&instance).ok_or_else(|| bad("unknown grid instance"))?;
            let contains_cell = request.row_start == 0
                && request.row_count > 0
                && request.column_start == 0
                && request.column_count > 0;
            Ok(GridWindow {
                sheet: SHEET_ID.to_string(),
                rows: contains_cell.then(|| GridRow {
                    id: ROW_ID.to_string(),
                    index: 0,
                    height: None,
                    hidden: false,
                }).into_iter().collect(),
                columns: contains_cell.then(|| GridColumn {
                    id: COLUMN_ID.to_string(),
                    index: 0,
                    width: None,
                    hidden: false,
                }).into_iter().collect(),
                cells: contains_cell.then(|| GridCell {
                    key: key(),
                    snapshot: snapshot(state.source.clone()),
                    value: GridCellValue::Text(state.source.clone()),
                }).into_iter().collect(),
            })
        })
    }

    fn apply(
        instance: String,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        OPEN.with(|open| {
            let mut open = open.borrow_mut();
            let state = open.get_mut(&instance).ok_or_else(|| bad("unknown grid instance"))?;
            if request.patches.len() != 1 {
                return Err(bad("example accepts one patch for its only cell"));
            }
            let coordinate = &request.patches[0].cell;
            if coordinate.sheet != SHEET_ID
                || coordinate.row != ROW_ID
                || coordinate.column != COLUMN_ID
            {
                return Err(bad("example accepts one patch for its only cell"));
            }
            let patch = &request.patches[0];
            let before = patch.before.as_ref().ok_or_else(|| bad("missing preimage"))?;
            if before.input != state.source {
                return Err(PluginError::Conflict(Text::Literal(
                    "cell preimage does not match".to_string(),
                )));
            }
            let after = patch.after.as_ref().ok_or_else(|| bad("missing new value"))?;
            let previous = std::mem::replace(&mut state.source, after.input.clone());
            let base = std::mem::replace(
                &mut state.revision,
                ::fub_abi::edit::Revision::of(&state.source).as_str().to_string(),
            );
            Ok(GridCommit {
                edit: EditRequest {
                    base,
                    edits: vec![TextEdit {
                        span: Span {
                            start: 0,
                            end: previous.len() as u64,
                        },
                        text: state.source.clone(),
                    }],
                },
                invalidation: GridInvalidation::Cells(vec![key()]),
            })
        })
    }

    fn reload(
        instance: String,
        source: String,
        revision: String,
    ) -> Result<GridSession, PluginError> {
        OPEN.with(|open| {
            let mut open = open.borrow_mut();
            let state = open.get_mut(&instance).ok_or_else(|| bad("unknown grid instance"))?;
            state.source = source;
            state.revision = revision;
            Ok(session(instance))
        })
    }

    fn close(instance: String) -> Result<(), PluginError> {
        OPEN.with(|open| {
            open.borrow_mut()
                .remove(&instance)
                .map(|_| ())
                .ok_or_else(|| bad("unknown grid instance"))
        })
    }

    fn shutdown() -> Result<(), PluginError> {
        OPEN.with(|open| open.borrow_mut().clear());
        Ok(())
    }
}

export!(Component);
