//! La superficie della griglia su una cartella, con il protocollo `grid` a
//! byte ([`fub_abi::grid_bytes`]).
//!
//! Una sessione tiene i byte del file, il modello che ne legge GridCraft e il
//! giornale delle celle cambiate. Le finestre mostrano i valori del file, e
//! per una cella del giornale il valore nuovo; niente si ricalcola, e una
//! formula che legge una cella cambiata, direttamente o attraverso altre
//! formule, mostra il valore del file segnato come **non aggiornato**.
//! Salvare è l'innesto ([`crate::graft`]): i byte del file con le celle del
//! giornale cambiate, e ogni altro byte com'era.
//!
//! Gli id sono stabili e senza stato: un foglio è `s` più il suo `sheetId`,
//! che non cambia quando il foglio cambia nome o posto; una riga è `r` più il
//! suo indice da 0, una colonna `c` più il suo. Il giornale sopravvive così a
//! una rilettura del file. Quando il file ha due fogli con lo stesso
//! `sheetId`, gli id sono `x` più la posizione, e nessuna cella si modifica.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use fub_abi::{
    grid_bytes_revision, grid_journal_match, GridApplyRequest, GridBytesCell, GridBytesProvider,
    GridBytesSession, GridBytesWindow, GridCellKey, GridCellStyle, GridColumn, GridCommit,
    GridHorizontalAlign, GridInvalidation, GridJournal, GridJournalMatch, GridNotice, GridRow,
    GridSheet, GridSourceEdit, GridSurfaceSpec, GridValue, GridWindowRequest, PluginError,
    Revision, MAX_GRID_BYTES_SOURCE, MAX_GRID_INVALIDATED_CELLS, MAX_GRID_SESSION_COLUMNS,
    MAX_GRID_SESSION_ROWS,
};
use gridcraft_calc::recalc::{Calc, Key};
use gridcraft_core::{CellRef, RangeRef, Value as GcValue};
use gridcraft_model::{Sheet, Visibility, Workbook};
use gridcraft_numfmt::{format_value, NumberFormat};

use crate::graft::{graft, CellEdit, GraftError};
use crate::input::{self, InputError, NewValue};
use crate::locks::SheetLocks;
use crate::package::Package;
use crate::projection::{self, Horizontal, NotShown, NoticeKind, ValueKind};
use crate::{guarded, sheet_xml, XlsxError, FORMAT_ID};

/// L'id della superficie.
pub const XLSX_GRID_SURFACE: &str = "fub.grid.xlsx";

/// Le righe vuote che la griglia mostra dopo l'ultima cella, per scriverci.
const ROW_MARGIN: u32 = 100;
/// Le colonne vuote dopo l'ultima.
const COLUMN_MARGIN: u32 = 10;
const MIN_ROWS: u32 = 100;
const MIN_COLUMNS: u32 = 26;
/// Le formule non aggiornate che una sessione conta una per una: oltre, lo
/// sono tutte.
const MAX_STALE: usize = 1_000_000;

/// Il codice di blocco di un foglio che l'innesto non tratta.
const SHEET_SHAPE_LOCK: &str = "sheet-shape";

fn bad(message: impl Into<String>) -> PluginError {
    PluginError::BadArgs(message.into().into())
}

fn stale_revision() -> PluginError {
    PluginError::Conflict("grid revision is stale".into())
}

fn xlsx_error(error: XlsxError) -> PluginError {
    match error {
        XlsxError::Encrypted => PluginError::PermissionDenied(error.to_string().into()),
        XlsxError::Crashed(_) => PluginError::Internal(error.to_string().into()),
        _ => bad(error.to_string()),
    }
}

fn graft_error(error: GraftError) -> PluginError {
    match error {
        GraftError::Locked { .. } => PluginError::PermissionDenied(error.to_string().into()),
        GraftError::Verify(_) | GraftError::Read(XlsxError::Crashed(_)) => {
            PluginError::Internal(error.to_string().into())
        }
        _ => bad(error.to_string()),
    }
}

/// Un foglio della sessione.
struct SheetInfo {
    id: String,
    /// La parte del foglio, quando il pacchetto e il modello si corrispondono.
    part: Option<String>,
    rows: u32,
    columns: u32,
    /// I blocchi, letti alla prima finestra o modifica del foglio.
    shape: Option<Shape>,
}

enum Shape {
    Locks(Box<SheetLocks>),
    /// Il foglio ha una forma che l'innesto non tratta: nessuna cella si
    /// modifica.
    Unsupported,
}

/// Una voce del giornale, letta contro il file.
struct Entry {
    /// Il foglio e la cella; `None` quando la sessione non li ha.
    place: Option<(usize, CellRef)>,
    state: GridJournalMatch,
    value: NewValue,
}

/// Le dipendenze delle formule, lette alla prima modifica.
struct Deps {
    calc: Calc,
    /// Le formule che leggono celle scelte mentre calcolano (`INDIRECT`,
    /// `OFFSET`): possono dipendere da qualunque cella.
    dynamic: Vec<Key>,
}

/// Le formule non aggiornate.
#[derive(Clone, Default, PartialEq)]
enum Stale {
    #[default]
    None,
    Cells {
        keys: HashSet<Key>,
        /// Le aree versate dalle formule non aggiornate.
        areas: Vec<(usize, RangeRef)>,
    },
    All,
}

impl Stale {
    fn has(&self, sheet: usize, cell: CellRef) -> bool {
        match self {
            Stale::None => false,
            Stale::All => true,
            Stale::Cells { keys, areas } => {
                keys.contains(&(sheet, cell))
                    || areas
                        .iter()
                        .any(|(at, range)| *at == sheet && range.contains(cell))
            }
        }
    }
}

struct Instance {
    bytes: Vec<u8>,
    source: Revision,
    workbook: Workbook,
    sheets: Vec<SheetInfo>,
    ids: HashMap<String, usize>,
    /// Le celle si modificano: il pacchetto e il modello si corrispondono.
    editable: bool,
    notices: Vec<GridNotice>,
    journal: GridJournal,
    entries: BTreeMap<GridCellKey, Entry>,
    deps: Option<Deps>,
    stale: Stale,
    revision: Revision,
}

/// Il provider della griglia per le cartelle di Excel.
#[derive(Default)]
pub struct XlsxGridProvider {
    next_instance: u64,
    instances: HashMap<String, Instance>,
}

impl XlsxGridProvider {
    pub fn new() -> Self {
        Self::default()
    }

    fn instance(&mut self, instance: &str) -> Result<&mut Instance, PluginError> {
        self.instances
            .get_mut(instance)
            .ok_or_else(|| PluginError::NotFound(format!("grid instance `{instance}`").into()))
    }

    fn new_instance_id(&mut self) -> String {
        loop {
            self.next_instance = self.next_instance.wrapping_add(1);
            let instance = format!("xlsx-{}", self.next_instance);
            if !self.instances.contains_key(&instance) {
                return instance;
            }
        }
    }
}

impl GridBytesProvider for XlsxGridProvider {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec::bytes(XLSX_GRID_SURFACE, FORMAT_ID)]
    }

    fn open(
        &mut self,
        surface: &str,
        source: &[u8],
        revision: Revision,
        journal: &GridJournal,
    ) -> Result<GridBytesSession, PluginError> {
        if surface != XLSX_GRID_SURFACE {
            return Err(PluginError::NotFound(
                format!("grid surface `{surface}`").into(),
            ));
        }
        if source.len() > MAX_GRID_BYTES_SOURCE {
            return Err(bad("grid source exceeds byte limit"));
        }
        if Revision::of_bytes(source) != revision {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        journal.validate()?;
        let read = crate::read(source).map_err(xlsx_error)?;
        let mut instance = Instance::new(source.to_vec(), revision, read)?;
        instance.set_journal(journal.clone())?;
        let id = self.new_instance_id();
        let summary = instance.summary(&id)?;
        self.instances.insert(id, instance);
        Ok(summary)
    }

    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridBytesWindow, PluginError> {
        request.validate()?;
        let window = self.instance(instance)?.window(&request)?;
        window.validate()?;
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let commit = self.instance(instance)?.apply(&request)?;
        commit.validate()?;
        Ok(commit)
    }

    fn bytes_to_write(
        &mut self,
        instance: &str,
        expected: Revision,
    ) -> Result<Vec<u8>, PluginError> {
        self.instance(instance)?.bytes_to_write(&expected)
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

impl Instance {
    fn new(bytes: Vec<u8>, source: Revision, read: crate::Read) -> Result<Instance, PluginError> {
        let crate::Read { workbook, report } = read;
        let parts = Package::open(&bytes).ok().and_then(|mut package| {
            let workbook = package.workbook_part().ok()?;
            package.worksheets(&workbook).ok()
        });
        let parts = parts.filter(|parts| {
            let ids: HashSet<u32> = parts.iter().map(|sheet| sheet.sheet_id).collect();
            parts.len() == workbook.sheets.len() && ids.len() == parts.len() && !ids.contains(&0)
        });
        let editable = parts.is_some();
        let mut sheets = Vec::with_capacity(workbook.sheets.len());
        for (index, sheet) in workbook.sheets.iter().enumerate() {
            let (id, part) = match &parts {
                Some(parts) => (
                    format!("s{}", parts[index].sheet_id),
                    Some(parts[index].part.clone()),
                ),
                None => (format!("x{index}"), None),
            };
            let (rows, columns) = extent(&workbook, sheet);
            sheets.push(SheetInfo {
                id,
                part,
                rows,
                columns,
                shape: None,
            });
        }
        let ids = sheets
            .iter()
            .enumerate()
            .map(|(index, sheet)| (sheet.id.clone(), index))
            .collect();
        let notices = notices(&workbook, &report);
        let revision = grid_bytes_revision(&source, "");
        Ok(Instance {
            bytes,
            source,
            workbook,
            sheets,
            ids,
            editable,
            notices,
            journal: GridJournal::new(),
            entries: BTreeMap::new(),
            deps: None,
            stale: Stale::None,
            revision,
        })
    }

    fn summary(&self, instance: &str) -> Result<GridBytesSession, PluginError> {
        let summary = GridBytesSession {
            instance: instance.to_owned(),
            revision: self.revision.clone(),
            sheets: self
                .sheets
                .iter()
                .zip(&self.workbook.sheets)
                .map(|(info, sheet)| GridSheet {
                    id: info.id.clone(),
                    name: sheet.name.clone(),
                    row_count: info.rows,
                    column_count: info.columns,
                })
                .collect(),
            active: self.sheets[self
                .workbook
                .active_sheet
                .min(self.sheets.len().saturating_sub(1))]
            .id
            .clone(),
            hidden: self
                .sheets
                .iter()
                .zip(&self.workbook.sheets)
                .filter(|(_, sheet)| sheet.visibility != Visibility::Visible)
                .map(|(info, _)| info.id.clone())
                .collect(),
            notices: self.notices.clone(),
            conflicts: self
                .entries
                .iter()
                .filter(|(_, entry)| entry.state == GridJournalMatch::Conflict)
                .map(|(key, _)| key.clone())
                .collect(),
        };
        summary.validate()?;
        Ok(summary)
    }

    /// Il foglio e la cella di una chiave.
    fn place(&self, key: &GridCellKey) -> Option<(usize, CellRef)> {
        let sheet = *self.ids.get(&key.sheet)?;
        let row = index(&key.row, 'r', MAX_GRID_SESSION_ROWS)?;
        let column = index(&key.column, 'c', MAX_GRID_SESSION_COLUMNS)?;
        Some((sheet, CellRef::new(row, column)))
    }

    fn key(&self, sheet: usize, cell: CellRef) -> GridCellKey {
        GridCellKey {
            sheet: self.sheets[sheet].id.clone(),
            row: format!("r{}", cell.row),
            column: format!("c{}", cell.col),
        }
    }

    /// L'input che la cella ha nel file.
    fn disk_input(&self, sheet: usize, cell: CellRef) -> String {
        let Some(stored) = self.workbook.sheets[sheet].cell(cell) else {
            return String::new();
        };
        if stored.formula.is_some() {
            return stored.bar_text();
        }
        input::constant(&stored.value)
            .map(|value| input::input_of(&value))
            .unwrap_or_default()
    }

    /// Il giornale nuovo, con le voci lette contro il file e le formule non
    /// aggiornate.
    fn set_journal(&mut self, journal: GridJournal) -> Result<(), PluginError> {
        let mut entries = BTreeMap::new();
        for (key, before, after) in journal.entries() {
            let value = input::parse(after).map_err(|error| match error {
                InputError::Formula => bad("grid journal writes a formula"),
                InputError::TooLong => bad("grid journal text is too long"),
            })?;
            let place = self.place(key);
            let state = match place {
                Some((sheet, cell)) => {
                    grid_journal_match(before, after, &self.disk_input(sheet, cell))
                }
                None => GridJournalMatch::Conflict,
            };
            entries.insert(
                key.clone(),
                Entry {
                    place,
                    state,
                    value,
                },
            );
        }
        for entry in entries.values() {
            if let Some((sheet, cell)) = entry.place {
                let info = &mut self.sheets[sheet];
                info.rows = info.rows.max((cell.row + 1).min(MAX_GRID_SESSION_ROWS));
                info.columns = info
                    .columns
                    .max((cell.col + 1).min(MAX_GRID_SESSION_COLUMNS));
            }
        }
        let changed = entries
            .values()
            .any(|entry| entry.place.is_some() && entry.state != GridJournalMatch::Applied);
        if changed && self.deps.is_none() {
            self.deps = Some(deps(&self.workbook).map_err(xlsx_error)?);
        }
        self.stale = match &self.deps {
            Some(deps) if changed => stale(&self.workbook, deps, &entries),
            _ => Stale::None,
        };
        self.revision = grid_bytes_revision(&self.source, &journal.to_text());
        self.journal = journal;
        self.entries = entries;
        Ok(())
    }

    /// I blocchi di un foglio.
    fn shape(&mut self, sheet: usize) -> &Shape {
        if self.sheets[sheet].shape.is_none() {
            let shape = self.read_shape(sheet).unwrap_or(Shape::Unsupported);
            self.sheets[sheet].shape = Some(shape);
        }
        self.sheets[sheet].shape.as_ref().expect("set above")
    }

    fn read_shape(&self, sheet: usize) -> Option<Shape> {
        let part = self.sheets[sheet].part.as_ref()?;
        let xml = Package::open(&self.bytes).ok()?.read(part).ok()??;
        let layout = sheet_xml::scan(&xml, &BTreeSet::new()).ok()?;
        if !layout.facts.ordered {
            return Some(Shape::Unsupported);
        }
        Some(Shape::Locks(Box::new(SheetLocks::new(
            &self.workbook.sheets[sheet],
            &layout.facts,
            &self.workbook.styles,
        ))))
    }

    /// Il codice di blocco di una cella.
    fn lock(&mut self, sheet: usize, cell: CellRef) -> Option<String> {
        if !self.editable {
            return Some(SHEET_SHAPE_LOCK.to_owned());
        }
        self.shape(sheet);
        match self.sheets[sheet].shape.as_ref().expect("read above") {
            Shape::Unsupported => Some(SHEET_SHAPE_LOCK.to_owned()),
            Shape::Locks(locks) => locks
                .at(&self.workbook.sheets[sheet], cell)
                .map(|lock| lock.code().to_owned()),
        }
    }

    fn window(&mut self, request: &GridWindowRequest) -> Result<GridBytesWindow, PluginError> {
        if request.revision != self.revision {
            return Err(stale_revision());
        }
        let sheet = *self.ids.get(&request.sheet).ok_or_else(|| {
            PluginError::NotFound(format!("grid sheet `{}`", request.sheet).into())
        })?;
        let (total_rows, total_columns) = (self.sheets[sheet].rows, self.sheets[sheet].columns);
        let row_end = request
            .row_start
            .saturating_add(request.row_count)
            .min(total_rows);
        let column_end = request
            .column_start
            .saturating_add(request.column_count)
            .min(total_columns);
        let row_start = request.row_start.min(row_end);
        let column_start = request.column_start.min(column_end);
        let model = &self.workbook.sheets[sheet];
        let rows = (row_start..row_end)
            .map(|index| {
                let line = model.rows.get(&index);
                GridRow {
                    id: format!("r{index}"),
                    index,
                    height: Some(line_size(
                        line.and_then(|line| line.size),
                        model.default_row_height,
                        20.0,
                    )),
                    hidden: line.is_some_and(|line| line.hidden),
                }
            })
            .collect();
        let columns = (column_start..column_end)
            .map(|index| {
                let line = model.cols.get(&index);
                GridColumn {
                    id: format!("c{index}"),
                    index,
                    width: Some(line_size(
                        line.and_then(|line| line.size),
                        model.default_col_width,
                        64.0,
                    )),
                    hidden: line.is_some_and(|line| line.hidden),
                }
            })
            .collect();

        let mut positions = BTreeSet::new();
        if row_start < row_end && column_start < column_end {
            let range = RangeRef::new(
                CellRef::new(row_start, column_start),
                CellRef::new(row_end - 1, column_end - 1),
            );
            positions.extend(
                model
                    .cells
                    .iter_range(range)
                    .map(|(at, _)| (at.row, at.col)),
            );
            positions.extend(
                model
                    .spill
                    .range(range.start..=range.end)
                    .map(|(at, _)| *at)
                    .filter(|at| range.contains(*at))
                    .map(|at| (at.row, at.col)),
            );
            positions.extend(
                self.entries
                    .values()
                    .filter_map(|entry| entry.place)
                    .filter(|(at, cell)| *at == sheet && range.contains(*cell))
                    .map(|(_, cell)| (cell.row, cell.col)),
            );
        }
        let mut cells = Vec::with_capacity(positions.len());
        for (row, col) in positions {
            cells.push(self.cell(sheet, CellRef::new(row, col)));
        }
        Ok(GridBytesWindow {
            revision: self.revision.clone(),
            sheet: request.sheet.clone(),
            row_start,
            column_start,
            total_rows,
            total_columns,
            rows,
            columns,
            cells,
        })
    }

    fn cell(&mut self, sheet: usize, at: CellRef) -> GridBytesCell {
        let key = self.key(sheet, at);
        let lock = self.lock(sheet, at);
        let workbook = &self.workbook;
        let model = &workbook.sheets[sheet];
        let entry = self
            .entries
            .get(&key)
            .filter(|entry| entry.state != GridJournalMatch::Applied);
        let (input, value) = match entry {
            Some(entry) => (
                self.journal
                    .get(&key)
                    .map(|(_, after)| after.to_owned())
                    .unwrap_or_default(),
                new_value(&entry.value),
            ),
            None => (
                self.disk_input(sheet, at),
                model.value_ref(at).cloned().unwrap_or(GcValue::Empty),
            ),
        };
        let style = workbook.styles.get(model.style_id(at));
        let formatted = format_value(
            &value,
            &NumberFormat::parse_cached(style.num_fmt.as_str()),
            workbook.date_system,
        );
        let kind = value_kind(&value);
        let projected =
            projection::cell_style(workbook, style, kind, formatted.numeric, formatted.color);
        GridBytesCell {
            key,
            input,
            style: GridCellStyle {
                bold: projected.bold,
                italic: projected.italic,
                text_color: projected.text_color,
                fill_color: projected.fill_color,
                horizontal: projected.horizontal.map(|horizontal| match horizontal {
                    Horizontal::Start => GridHorizontalAlign::Start,
                    Horizontal::Center => GridHorizontalAlign::Center,
                    Horizontal::End => GridHorizontalAlign::End,
                }),
                number_format: None,
            },
            value: grid_value(&value),
            display: formatted.text,
            lock,
            stale: entry.is_none() && self.stale.has(sheet, at),
            conflict: entry.is_some_and(|entry| entry.state == GridJournalMatch::Conflict),
        }
    }

    fn apply(&mut self, request: &GridApplyRequest) -> Result<GridCommit, PluginError> {
        if request.revision != self.revision {
            return Err(stale_revision());
        }
        let mut journal = self.journal.clone();
        let mut changed = Vec::new();
        for patch in &request.patches {
            let (sheet, cell) = self
                .place(&patch.cell)
                .filter(|(sheet, cell)| {
                    cell.row < self.sheets[*sheet].rows && cell.col < self.sheets[*sheet].columns
                })
                .ok_or_else(|| bad("grid patch names a cell the session does not have"))?;
            if let Some(lock) = self.lock(sheet, cell) {
                return Err(PluginError::PermissionDenied(
                    format!("grid cell is locked ({lock})").into(),
                ));
            }
            let shown = match journal.get(&patch.cell) {
                Some((_, after)) => after.to_owned(),
                None => self.disk_input(sheet, cell),
            };
            if patch.before.as_ref().is_some_and(|before| *before != shown) {
                return Err(PluginError::Conflict(
                    "grid patch preimage does not match".into(),
                ));
            }
            let value = input::parse(&patch.after).map_err(|error| match error {
                InputError::Formula => bad("formulas cannot be written to a workbook"),
                InputError::TooLong => bad("grid cell text is too long"),
            })?;
            let after = input::input_of(&value);
            if after == shown {
                continue;
            }
            journal.record(patch.cell.clone(), self.disk_input(sheet, cell), after)?;
            changed.push(patch.cell.clone());
        }
        let before_text = self.journal.to_text();
        let before_stale = self.stale.clone();
        self.set_journal(journal)?;
        let after_text = self.journal.to_text();
        let invalidation = self.invalidation(changed, &before_stale);
        Ok(GridCommit {
            revision: self.revision.clone(),
            edit: text_diff(&before_text, &after_text),
            invalidation,
        })
    }

    /// Le celle da rileggere: quelle cambiate e le formule che hanno cambiato
    /// stato.
    fn invalidation(&self, changed: Vec<GridCellKey>, before: &Stale) -> GridInvalidation {
        let mut cells: BTreeSet<GridCellKey> = changed.into_iter().collect();
        match (before, &self.stale) {
            (Stale::All, _) | (_, Stale::All) => return GridInvalidation::All,
            (Stale::Cells { areas: old, .. }, Stale::Cells { areas: new, .. }) if old != new => {
                return GridInvalidation::All;
            }
            _ => {}
        }
        let keys = |stale: &Stale| match stale {
            Stale::Cells { keys, areas } if areas.is_empty() => Some(keys.clone()),
            Stale::None => Some(HashSet::new()),
            _ => None,
        };
        let (Some(old), Some(new)) = (keys(before), keys(&self.stale)) else {
            return GridInvalidation::All;
        };
        for &(sheet, cell) in old.symmetric_difference(&new) {
            cells.insert(self.key(sheet, cell));
            if cells.len() > MAX_GRID_INVALIDATED_CELLS {
                return GridInvalidation::All;
            }
        }
        GridInvalidation::Cells(cells.into_iter().collect())
    }

    fn bytes_to_write(&mut self, expected: &Revision) -> Result<Vec<u8>, PluginError> {
        if *expected != self.revision {
            return Err(stale_revision());
        }
        let mut edits = Vec::new();
        for (key, entry) in &self.entries {
            if entry.state == GridJournalMatch::Applied {
                continue;
            }
            let (sheet, cell) = entry.place.ok_or_else(|| {
                PluginError::Conflict(format!("grid sheet `{}` is gone", key.sheet).into())
            })?;
            edits.push(CellEdit {
                sheet,
                cell,
                value: entry.value.clone(),
            });
        }
        if edits.is_empty() {
            return Ok(self.bytes.clone());
        }
        for edit in &edits {
            if let Some(lock) = self.lock(edit.sheet, edit.cell) {
                return Err(PluginError::PermissionDenied(
                    format!("grid cell is locked ({lock})").into(),
                ));
            }
        }
        let recalc = match &self.deps {
            Some(deps) => {
                !deps.dynamic.is_empty()
                    || edits.iter().any(|edit| {
                        let mut out = Vec::new();
                        deps.calc.graph.dependents(edit.sheet, edit.cell, &mut out);
                        !out.is_empty()
                    })
            }
            None => true,
        };
        graft(&self.bytes, &self.workbook, &edits, recalc)
            .map(|grafted| grafted.bytes)
            .map_err(graft_error)
    }
}

/// `r12` → 12, entro `limit`; niente zeri in testa.
fn index(id: &str, prefix: char, limit: u32) -> Option<u32> {
    let digits = id.strip_prefix(prefix)?;
    if digits.is_empty()
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
    {
        return None;
    }
    digits.parse::<u32>().ok().filter(|&value| value < limit)
}

/// Le righe e le colonne che un foglio mostra: fin dove arriva ciò che ha, e
/// un margine per scrivere.
fn extent(workbook: &Workbook, sheet: &Sheet) -> (u32, u32) {
    let (mut rows, mut columns) = (0u32, 0u32);
    for (at, cell, value) in projection::entries(sheet) {
        if projection::shows(workbook, sheet, at, cell, value) {
            rows = rows.max(at.row + 1);
            columns = columns.max(at.col + 1);
        }
    }
    (
        rows.saturating_add(ROW_MARGIN)
            .clamp(MIN_ROWS, MAX_GRID_SESSION_ROWS),
        columns
            .saturating_add(COLUMN_MARGIN)
            .clamp(MIN_COLUMNS, MAX_GRID_SESSION_COLUMNS),
    )
}

fn line_size(size: Option<f32>, default: f32, fallback: f32) -> f32 {
    [size.unwrap_or(default), default, fallback]
        .into_iter()
        .find(|size| size.is_finite() && *size > 0.0)
        .unwrap_or(fallback)
}

/// Gli avvisi della cartella, in codici chiusi.
fn notices(workbook: &Workbook, report: &gridcraft_xlsx::ReadReport) -> Vec<GridNotice> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut add = |code: &str| *counts.entry(code.to_owned()).or_default() += 1;
    if workbook.vba_project.is_some() {
        add("macros");
    }
    for warning in &report.warnings {
        match projection::classify(warning) {
            NoticeKind::Macros => {}
            NoticeKind::ExternalLinks => add("external-links"),
            _ => add("incomplete"),
        }
    }
    for part in NotShown::ALL {
        if workbook.sheets.iter().any(|sheet| part.present(sheet)) {
            add(&format!("not-shown-{}", part.id().replace('_', "-")));
        }
    }
    let uncomputed = workbook
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .filter(|(_, cell)| cell.formula.is_some() && cell.value.is_empty())
        .count();
    let mut out: Vec<GridNotice> = counts
        .into_iter()
        .map(|(code, count)| GridNotice { code, count })
        .collect();
    if uncomputed > 0 {
        out.push(GridNotice {
            code: "uncomputed".into(),
            count: u32::try_from(uncomputed).unwrap_or(u32::MAX),
        });
    }
    out
}

/// Le dipendenze delle formule della cartella.
fn deps(workbook: &Workbook) -> Result<Deps, XlsxError> {
    guarded(|| {
        let mut calc = Calc::new();
        calc.rebuild(workbook);
        let mut dynamic = Vec::new();
        for (index, sheet) in workbook.sheets.iter().enumerate() {
            for (at, cell) in sheet.cells.iter() {
                if let Some(expr) = cell.formula.as_ref().and_then(|formula| formula.expr()) {
                    if gridcraft_calc::eval::precedents(workbook, index, &expr).1 {
                        dynamic.push((index, at));
                    }
                }
            }
        }
        Ok(Deps { calc, dynamic })
    })
}

/// Le formule che leggono, direttamente o attraverso altre formule, una cella
/// che il giornale cambia.
fn stale(workbook: &Workbook, deps: &Deps, entries: &BTreeMap<GridCellKey, Entry>) -> Stale {
    let edited: HashSet<Key> = entries
        .values()
        .filter(|entry| entry.state != GridJournalMatch::Applied)
        .filter_map(|entry| entry.place)
        .collect();
    let mut keys: HashSet<Key> = HashSet::new();
    let mut queue: Vec<Key> = edited.iter().copied().collect();
    for &key in &deps.dynamic {
        if !edited.contains(&key) && keys.insert(key) {
            queue.push(key);
        }
    }
    let mut areas = Vec::new();
    let mut out = Vec::new();
    while let Some((sheet, cell)) = queue.pop() {
        out.clear();
        deps.calc.graph.dependents(sheet, cell, &mut out);
        let model = &workbook.sheets[sheet];
        let spilled = model.spill_ranges.get(&cell).copied().or_else(|| {
            model
                .cell(cell)
                .and_then(|stored| stored.formula.as_ref())
                .and_then(|formula| formula.array)
        });
        if let Some(range) = spilled.filter(|_| !edited.contains(&(sheet, cell))) {
            areas.push((sheet, range));
            deps.calc.graph.dependents_of_range(sheet, range, &mut out);
        }
        for &key in &out {
            if !edited.contains(&key) && keys.insert(key) {
                if keys.len() > MAX_STALE {
                    return Stale::All;
                }
                queue.push(key);
            }
        }
    }
    if keys.is_empty() && areas.is_empty() {
        Stale::None
    } else {
        Stale::Cells { keys, areas }
    }
}

fn new_value(value: &NewValue) -> GcValue {
    match value {
        NewValue::Blank => GcValue::Empty,
        NewValue::Number(number) => GcValue::Number(*number),
        NewValue::Text(text) => GcValue::Text(text.as_str().into()),
        NewValue::Bool(flag) => GcValue::Bool(*flag),
        NewValue::Error(error) => GcValue::Error(*error),
    }
}

fn value_kind(value: &GcValue) -> Option<ValueKind> {
    match value {
        GcValue::Empty => None,
        GcValue::Number(_) => Some(ValueKind::Number),
        GcValue::Text(_) => Some(ValueKind::Text),
        GcValue::Bool(_) => Some(ValueKind::Boolean),
        GcValue::Error(_) => Some(ValueKind::Error),
        GcValue::Array(array) => array.data.first().and_then(value_kind),
    }
}

fn grid_value(value: &GcValue) -> GridValue {
    match value {
        GcValue::Empty => GridValue::Blank,
        GcValue::Number(number) => GridValue::Number(*number),
        GcValue::Text(text) => GridValue::Text(text.to_string()),
        GcValue::Bool(flag) => GridValue::Boolean(*flag),
        GcValue::Error(error) => GridValue::Error(error.as_str().to_owned()),
        GcValue::Array(array) => array.data.first().map_or(GridValue::Blank, grid_value),
    }
}

/// Il diff fra due testi: il prefisso e il suffisso comuni restano, su
/// confini di carattere.
fn text_diff(before: &str, after: &str) -> GridSourceEdit {
    let mut start = before
        .bytes()
        .zip(after.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    while !before.is_char_boundary(start) || !after.is_char_boundary(start) {
        start -= 1;
    }
    let room = before.len().min(after.len()) - start;
    let mut suffix = before
        .bytes()
        .rev()
        .zip(after.bytes().rev())
        .take(room)
        .take_while(|(a, b)| a == b)
        .count();
    while !before.is_char_boundary(before.len() - suffix)
        || !after.is_char_boundary(after.len() - suffix)
    {
        suffix -= 1;
    }
    GridSourceEdit {
        from: start as u64,
        to: (before.len() - suffix) as u64,
        deleted: before[start..before.len() - suffix].to_owned(),
        inserted: after[start..after.len() - suffix].to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_diff_tiene_i_caratteri_interi() {
        let edit = text_diff("aéb", "aèb");
        assert_eq!((edit.from, edit.to), (1, 3));
        assert_eq!((edit.deleted.as_str(), edit.inserted.as_str()), ("é", "è"));
        let edit = text_diff("", "abc");
        assert_eq!((edit.from, edit.to, edit.inserted.as_str()), (0, 0, "abc"));
        let edit = text_diff("aaa", "aa");
        assert_eq!((edit.from, edit.to, edit.deleted.as_str()), (2, 3, "a"));
    }

    #[test]
    fn gli_id_hanno_una_sola_forma() {
        assert_eq!(index("r0", 'r', 10), Some(0));
        assert_eq!(index("r9", 'r', 10), Some(9));
        for wrong in ["r10", "r01", "r", "c1", "r-1", "r+1", "r1 "] {
            assert_eq!(index(wrong, 'r', 10), None, "{wrong}");
        }
    }
}
