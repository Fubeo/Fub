//! Grid v2 over the document bytes: every line of a UTF-8 source is a cell of
//! one column. The cells a user changes live in the journal, and
//! `bytes-to-write` grafts them into the lines; the other lines keep their
//! bytes.
//!
//! The surface declares the `markdown` format because it is the line-based
//! format every vault has. It exists to prove the `grid-bytes` crossing, not
//! to edit notes.
//!
//! Three test features break the component on purpose: `incompatible-grid`
//! declares a family the host does not know, `trap-on-window` traps and
//! `malformed-window` answers for another sheet.

use std::collections::HashMap;

use fub_abi::edit::Revision;
use fub_abi::grid::GridCellKey as AbiKey;
use fub_abi::{grid_bytes_revision, grid_journal_match, GridJournal, GridJournalMatch};

use crate::exports::fub::abi::grid_bytes::{
    GridBytesCell, GridBytesSession, GridBytesWindow, GridCommandOutcome, GridCommandRequest,
    GridCommandState, GridNotice, GridSelection, GridSheetView, GridValue, Guest as GridBytesGuest,
};
use crate::fub::abi::grid::{
    GridApplyRequest, GridBorders, GridCellKey, GridCellStyle, GridColumn, GridCommit,
    GridInvalidation, GridRow, GridSheet, GridSourceEdit, GridSurfaceSpec, GridWindowRequest,
};
use crate::{bad, conflict, not_found, Component, PluginError};

pub(crate) const SURFACE_ID: &str = "example.grid:lines";
const SHEET: &str = "lines";
/// Empty rows after the last line, where a user may write.
const MARGIN: u32 = 10;

struct Lines {
    source: Revision,
    lines: Vec<String>,
    journal: GridJournal,
}

impl Lines {
    fn revision(&self) -> Revision {
        grid_bytes_revision(&self.source, &self.journal.to_text())
    }

    fn rows(&self) -> u32 {
        self.lines.len() as u32 + MARGIN
    }

    fn disk(&self, row: u32) -> &str {
        self.lines.get(row as usize).map_or("", String::as_str)
    }

    fn conflicts(&self) -> Vec<GridCellKey> {
        self.journal
            .entries()
            .filter(|(key, before, after)| {
                let current = row_of(key).map_or("", |row| self.disk(row));
                grid_journal_match(before, after, current) == GridJournalMatch::Conflict
            })
            .map(|(key, _, _)| wit_key(key))
            .collect()
    }
}

#[derive(Default)]
struct State {
    next_instance: u64,
    sessions: HashMap<String, Lines>,
}

static mut STATE: Option<State> = None;

fn state() -> &'static mut State {
    // A component instance has one linear memory and is not concurrently called.
    unsafe { STATE.get_or_insert_with(State::default) }
}

pub(crate) fn reset() {
    unsafe {
        STATE = None;
    }
}

fn session(instance: &str) -> Result<&'static mut Lines, PluginError> {
    state()
        .sessions
        .get_mut(instance)
        .ok_or_else(|| not_found(format!("grid instance `{instance}`")))
}

fn row_of(key: &AbiKey) -> Option<u32> {
    if key.sheet != SHEET || key.column != "c0" {
        return None;
    }
    key.row.strip_prefix('r')?.parse().ok()
}

fn wit_key(key: &AbiKey) -> GridCellKey {
    GridCellKey {
        sheet: key.sheet.clone(),
        row: key.row.clone(),
        column: key.column.clone(),
    }
}

fn abi_key(key: &GridCellKey) -> AbiKey {
    AbiKey {
        sheet: key.sheet.clone(),
        row: key.row.clone(),
        column: key.column.clone(),
    }
}

fn plain() -> GridCellStyle {
    GridCellStyle {
        bold: false,
        italic: false,
        text_color: None,
        fill_color: None,
        horizontal: None,
        number_format: None,
        font: None,
        font_size: None,
        underline: None,
        strike: false,
        script: None,
        vertical: None,
        wrap: false,
        shrink: false,
        indent: 0,
        rotation: 0,
        borders: GridBorders {
            top: None,
            right: None,
            bottom: None,
            left: None,
            diagonal_down: None,
            diagonal_up: None,
        },
    }
}

impl GridBytesGuest for Component {
    fn surfaces() -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec {
            id: SURFACE_ID.to_owned(),
            format: "markdown".to_owned(),
            family: if cfg!(feature = "incompatible-grid") {
                "future-grid".to_owned()
            } else {
                "grid".to_owned()
            },
            protocol_version: if cfg!(feature = "incompatible-grid") {
                99
            } else {
                fub_abi::GRID_BYTES_PROTOCOL_VERSION
            },
        }]
    }

    fn open(
        surface: String,
        source: Vec<u8>,
        revision: String,
        journal: String,
    ) -> Result<GridBytesSession, PluginError> {
        if cfg!(feature = "incompatible-grid") {
            panic!("incompatible grid open must not be called");
        }
        if surface != SURFACE_ID {
            return Err(not_found(format!("grid surface `{surface}`")));
        }
        let derived = Revision::of_bytes(&source);
        if derived.0 != revision {
            return Err(conflict("grid source does not match its declared revision"));
        }
        let text = String::from_utf8(source).map_err(|_| bad("the source is not UTF-8"))?;
        let journal = GridJournal::parse(&journal).map_err(|_| bad("malformed journal"))?;
        // L'esempio non serve comandi: un giornale di comandi non si legge
        // come vuoto.
        if !journal.commands().is_empty() {
            return Err(bad("the journal carries commands"));
        }
        if journal.entries().any(|(key, _, _)| row_of(key).is_none()) {
            return Err(bad("the journal names a cell outside the lines"));
        }
        let lines = Lines {
            source: derived,
            lines: text.split('\n').map(str::to_owned).collect(),
            journal,
        };
        let state = state();
        state.next_instance = state.next_instance.wrapping_add(1);
        let instance = format!("lines-{}", state.next_instance);
        let result = GridBytesSession {
            instance: instance.clone(),
            revision: lines.revision().0,
            sheets: vec![GridSheet {
                id: SHEET.to_owned(),
                name: "Lines".to_owned(),
                row_count: lines.rows(),
                column_count: 1,
            }],
            active: SHEET.to_owned(),
            hidden: vec![],
            notices: vec![GridNotice {
                code: "lines".to_owned(),
                count: lines.lines.len() as u32,
            }],
            conflicts: lines.conflicts(),
            commands: Vec::new(),
        };
        state.sessions.insert(instance, lines);
        Ok(result)
    }

    fn window(
        instance: String,
        request: GridWindowRequest,
    ) -> Result<GridBytesWindow, PluginError> {
        if cfg!(feature = "trap-on-window") {
            panic!("grid window trap requested by test component");
        }
        let lines = session(&instance)?;
        if request.revision != lines.revision().0 {
            return Err(conflict("stale grid revision"));
        }
        let row_end = request.row_start.saturating_add(request.row_count);
        let column_end = request.column_start.saturating_add(request.column_count);
        if request.sheet != SHEET || row_end > lines.rows() || column_end > 1 {
            return Err(bad("the window lies outside the lines"));
        }
        let rows: Vec<_> = (request.row_start..row_end)
            .map(|index| GridRow {
                id: format!("r{index}"),
                index,
                height: None,
                hidden: false,
            })
            .collect();
        let columns = (request.column_start..column_end)
            .map(|index| GridColumn {
                id: format!("c{index}"),
                index,
                width: None,
                hidden: false,
            })
            .collect();
        let cells = if column_end == 0 {
            vec![]
        } else {
            (request.row_start..row_end)
                .filter_map(|row| {
                    let key = AbiKey {
                        sheet: SHEET.to_owned(),
                        row: format!("r{row}"),
                        column: "c0".to_owned(),
                    };
                    let input = lines
                        .journal
                        .get(&key)
                        .map_or(lines.disk(row), |(_, after)| after)
                        .to_owned();
                    if input.is_empty() {
                        return None;
                    }
                    let conflict = lines.journal.get(&key).is_some_and(|(before, after)| {
                        grid_journal_match(before, after, lines.disk(row))
                            == GridJournalMatch::Conflict
                    });
                    Some(GridBytesCell {
                        conflict,
                        key: wit_key(&key),
                        display: input.clone(),
                        value: GridValue::Text(input.clone()),
                        input,
                        style: 0,
                        lock: None,
                        stale: false,
                        data_bar: None,
                        icon: None,
                        comment: None,
                        link: None,
                    })
                })
                .collect()
        };
        let sheet = if cfg!(feature = "malformed-window") {
            "wrong-sheet".to_owned()
        } else {
            request.sheet
        };
        Ok(GridBytesWindow {
            revision: request.revision,
            sheet,
            row_start: request.row_start,
            column_start: request.column_start,
            total_rows: lines.rows(),
            total_columns: 1,
            rows,
            columns,
            cells,
            styles: vec![plain()],
            merges: Vec::new(),
            view: GridSheetView {
                frozen_rows: 0,
                frozen_columns: 0,
                gridlines: true,
                headings: true,
                zoom: 100,
                right_to_left: false,
            },
        })
    }

    fn apply(instance: String, request: GridApplyRequest) -> Result<GridCommit, PluginError> {
        let lines = session(&instance)?;
        if request.revision != lines.revision().0 {
            return Err(conflict("stale grid revision"));
        }
        let mut journal = lines.journal.clone();
        let mut changed = Vec::new();
        for patch in &request.patches {
            let key = abi_key(&patch.cell);
            let row = row_of(&key)
                .filter(|row| *row < lines.rows())
                .ok_or_else(|| bad("the patch names a cell outside the lines"))?;
            if patch.after.contains('\n') {
                return Err(bad("a line cannot hold a line break"));
            }
            let disk = lines.disk(row).to_owned();
            let current = journal.get(&key).map_or(disk.as_str(), |(_, after)| after);
            if patch
                .before
                .as_ref()
                .is_some_and(|before| before != current)
            {
                return Err(conflict("the cell changed in the meantime"));
            }
            let before = journal
                .get(&key)
                .map_or(disk.clone(), |(before, _)| before.to_owned());
            journal
                .record(key, before, patch.after.clone())
                .map_err(|_| bad("the journal is full"))?;
            changed.push(patch.cell.clone());
        }
        let deleted = lines.journal.to_text();
        let inserted = journal.to_text();
        lines.journal = journal;
        Ok(GridCommit {
            revision: lines.revision().0,
            edit: GridSourceEdit {
                from: 0,
                to: deleted.len() as u64,
                deleted,
                inserted,
            },
            invalidation: GridInvalidation::Cells(changed),
        })
    }

    /// L'esempio modifica soltanto con le patch: il catalogo è vuoto.
    fn commands(
        instance: String,
        _selection: GridSelection,
    ) -> Result<Vec<GridCommandState>, PluginError> {
        session(&instance)?;
        Ok(Vec::new())
    }

    fn command(
        instance: String,
        request: GridCommandRequest,
    ) -> Result<GridCommandOutcome, PluginError> {
        session(&instance)?;
        Err(bad(format!(
            "grid command `{}` is not served",
            request.command.id
        )))
    }

    fn bytes_to_write(instance: String, expected: String) -> Result<Vec<u8>, PluginError> {
        let lines = session(&instance)?;
        if expected != lines.revision().0 {
            return Err(conflict("stale grid revision"));
        }
        let mut out = lines.lines.clone();
        for (key, _, after) in lines.journal.entries() {
            let row = row_of(key).expect("checked at open and apply") as usize;
            if out.len() <= row {
                out.resize(row + 1, String::new());
            }
            out[row] = after.to_owned();
        }
        Ok(out.join("\n").into_bytes())
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
