//! Sessione derivata del workbook, riusabile dagli adapter nativi e WASM.
//!
//! Il formato possiede parsing, valutazione, indici e finestre. L'adapter
//! fornisce la derivazione della revisione opaca: qui conta soltanto
//! l'uguaglianza. Nessun tipo dell'host, filesystem o runtime entra nel motore.
//! Questi tipi Rust non sono ancora un contratto ABI/WIT.

use std::collections::HashMap;
use std::fmt;
use std::io::{self, Write};

use serde::Serialize;

use crate::{Cell, CellKey, CellValue, Column, Row, RowId, SheetError, SheetId, Workbook};

mod commit;

pub use commit::{
    SheetCellPatch, SheetCommit, SheetInvalidation, SheetOperation, SheetSourceEdit,
    MAX_INVALIDATED_CELLS, MAX_OPERATION_INPUT_BYTES, MAX_OPERATION_PATCHES,
};

pub const MAX_WINDOW_ROWS: usize = 256;
pub const MAX_WINDOW_COLUMNS: usize = 128;
pub const MAX_WINDOW_CELLS: usize = 32_768;
pub const MAX_WINDOW_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// Indici nell'ordine persistito, inclusi gli assi nascosti. Non è view state.
#[derive(Clone, Copy, Debug)]
pub struct SheetWindowRequest {
    pub row_start: usize,
    pub column_start: usize,
    pub row_count: usize,
    pub column_count: usize,
}

#[derive(Debug, Serialize)]
pub struct SheetWindowCell<'a> {
    pub cell: &'a Cell,
    pub value: &'a CellValue,
}

/// Proiezione presa in prestito: input e valori grandi non vengono clonati.
/// La revisione conserva la forma serializzata scelta dall'adapter.
#[derive(Debug, Serialize)]
pub struct SheetWindow<'a, R> {
    pub revision: &'a R,
    pub sheet: &'a SheetId,
    pub row_start: usize,
    pub column_start: usize,
    pub total_rows: usize,
    pub total_columns: usize,
    pub rows: &'a [Row],
    pub columns: &'a [Column],
    pub cells: Vec<SheetWindowCell<'a>>,
}

#[derive(Debug)]
pub enum SheetSessionError {
    Source(SheetError),
    StaleRevision,
    UnknownSheet,
    WindowLimit,
    WindowRange,
    ResponseTooLarge,
    EvaluationMismatch,
    EmptyOperation,
    OperationLimit,
    OperationInputLimit,
    DuplicatePatch,
    UnknownCoordinate,
    PreimageMismatch,
    NoChange,
    Serialization(serde_json::Error),
}

impl fmt::Display for SheetSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(error) => write!(formatter, "invalid sheet source: {error}"),
            Self::StaleRevision => formatter.write_str("sheet session revision changed"),
            Self::UnknownSheet => formatter.write_str("unknown sheet id"),
            Self::WindowLimit => formatter.write_str("sheet window exceeds its coordinate limits"),
            Self::WindowRange => formatter.write_str("sheet window starts outside its axes"),
            Self::ResponseTooLarge => formatter.write_str("sheet response exceeds 8 MiB"),
            Self::EvaluationMismatch => formatter.write_str("sheet evaluation is incomplete"),
            Self::EmptyOperation => formatter.write_str("sheet operation has no patches"),
            Self::OperationLimit => formatter.write_str("sheet operation exceeds its patch limit"),
            Self::OperationInputLimit => {
                formatter.write_str("sheet operation exceeds its input byte limit")
            }
            Self::DuplicatePatch => formatter.write_str("sheet operation patches one cell twice"),
            Self::UnknownCoordinate => {
                formatter.write_str("sheet patch uses an unknown coordinate")
            }
            Self::PreimageMismatch => formatter.write_str("sheet patch preimage is stale"),
            Self::NoChange => formatter.write_str("sheet patch does not change its cell"),
            Self::Serialization(error) => write!(formatter, "sheet serialization: {error}"),
        }
    }
}

impl std::error::Error for SheetSessionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Source(error) => Some(error),
            Self::Serialization(error) => Some(error),
            _ => None,
        }
    }
}

/// Una sola valutazione per apertura/reload. Le letture successive visitano
/// soltanto le coordinate richieste; non riparsano e non rivalutano il workbook.
/// Tutti i dati sono derivati e posseduti: il drop non lascia risorse esterne.
#[derive(Debug)]
pub struct SheetSession<R> {
    revision: R,
    source: String,
    workbook: Workbook,
    values: HashMap<CellKey, CellValue>,
    dependents: HashMap<CellKey, Vec<CellKey>>,
    sheet_by_id: HashMap<SheetId, usize>,
    rows_by_id: Vec<HashMap<RowId, usize>>,
    columns_by_id: Vec<HashMap<crate::ColumnId, usize>>,
    cells_by_position: Vec<HashMap<(usize, usize), usize>>,
}

impl<R: Eq + Serialize> SheetSession<R> {
    /// La derivazione è chiamata soltanto dopo la validazione della sorgente.
    /// Deve identificare i byte ricevuti, non una serializzazione canonica.
    pub fn open(
        source: &str,
        revision_of: impl FnOnce(&str) -> R,
    ) -> Result<Self, SheetSessionError> {
        let workbook = Workbook::parse(source).map_err(SheetSessionError::Source)?;
        let evaluation = workbook.evaluate().map_err(SheetSessionError::Source)?;
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
        let mut dependents: HashMap<CellKey, Vec<CellKey>> = HashMap::new();
        for dependency in evaluation.dependencies {
            for source in dependency.depends_on {
                dependents
                    .entry(source)
                    .or_default()
                    .push(dependency.cell.clone());
            }
        }
        for cells in dependents.values_mut() {
            cells.sort();
            cells.dedup();
        }

        let mut sheet_by_id = HashMap::with_capacity(workbook.sheets.len());
        let mut rows_by_id = Vec::with_capacity(workbook.sheets.len());
        let mut columns_by_id = Vec::with_capacity(workbook.sheets.len());
        let mut cells_by_position = Vec::with_capacity(workbook.sheets.len());
        for (sheet_index, sheet) in workbook.sheets.iter().enumerate() {
            sheet_by_id.insert(sheet.id.clone(), sheet_index);
            let rows: HashMap<_, _> = sheet
                .rows
                .iter()
                .enumerate()
                .map(|(index, row)| (row.id.clone(), index))
                .collect();
            let columns: HashMap<_, _> = sheet
                .columns
                .iter()
                .enumerate()
                .map(|(index, column)| (column.id.clone(), index))
                .collect();
            let mut positions = HashMap::with_capacity(sheet.cells.len());
            for (index, cell) in sheet.cells.iter().enumerate() {
                let row = rows
                    .get(&cell.row)
                    .ok_or(SheetSessionError::EvaluationMismatch)?;
                let column = columns
                    .get(&cell.column)
                    .ok_or(SheetSessionError::EvaluationMismatch)?;
                positions.insert((*row, *column), index);
            }
            rows_by_id.push(rows);
            columns_by_id.push(columns);
            cells_by_position.push(positions);
        }
        Ok(Self {
            revision: revision_of(source),
            source: source.to_owned(),
            workbook,
            values,
            dependents,
            sheet_by_id,
            rows_by_id,
            columns_by_id,
            cells_by_position,
        })
    }

    pub fn revision(&self) -> &R {
        &self.revision
    }

    /// Sorgente autorevole da cui deriva la sessione corrente.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Compare-and-reload: un errore lascia revisione, assi e valori precedenti.
    pub fn reload(
        &mut self,
        expected: &R,
        source: &str,
        revision_of: impl FnOnce(&str) -> R,
    ) -> Result<(), SheetSessionError> {
        self.check_revision(expected)?;
        let replacement = Self::open(source, revision_of)?;
        *self = replacement;
        Ok(())
    }

    pub fn window(
        &self,
        expected: &R,
        sheet_id: &SheetId,
        request: SheetWindowRequest,
    ) -> Result<SheetWindow<'_, R>, SheetSessionError> {
        self.check_revision(expected)?;
        if request.row_count > MAX_WINDOW_ROWS
            || request.column_count > MAX_WINDOW_COLUMNS
            || request
                .row_count
                .checked_mul(request.column_count)
                .is_none_or(|cells| cells > MAX_WINDOW_CELLS)
        {
            return Err(SheetSessionError::WindowLimit);
        }
        let index = self
            .sheet_by_id
            .get(sheet_id)
            .copied()
            .ok_or(SheetSessionError::UnknownSheet)?;
        let sheet = &self.workbook.sheets[index];
        let row_end = window_end(request.row_start, request.row_count, sheet.rows.len())?;
        let column_end = window_end(
            request.column_start,
            request.column_count,
            sheet.columns.len(),
        )?;
        let mut cells = Vec::new();
        for row in request.row_start..row_end {
            for column in request.column_start..column_end {
                let Some(cell_index) = self.cells_by_position[index].get(&(row, column)) else {
                    continue;
                };
                let cell = &sheet.cells[*cell_index];
                let key = CellKey {
                    sheet: sheet.id.clone(),
                    row: cell.row.clone(),
                    column: cell.column.clone(),
                };
                let value = self
                    .values
                    .get(&key)
                    .ok_or(SheetSessionError::EvaluationMismatch)?;
                cells.push(SheetWindowCell { cell, value });
            }
        }
        let window = SheetWindow {
            revision: &self.revision,
            sheet: &sheet.id,
            row_start: request.row_start,
            column_start: request.column_start,
            total_rows: sheet.rows.len(),
            total_columns: sheet.columns.len(),
            rows: &sheet.rows[request.row_start..row_end],
            columns: &sheet.columns[request.column_start..column_end],
            cells,
        };
        check_response_size(&window)?;
        Ok(window)
    }

    fn check_revision(&self, expected: &R) -> Result<(), SheetSessionError> {
        if expected == &self.revision {
            Ok(())
        } else {
            Err(SheetSessionError::StaleRevision)
        }
    }
}

/// Verifica i byte JSON effettivi prima di materializzare una risposta del foglio.
/// L'adapter passa anche l'envelope del proprio canale, senza clonare i valori.
pub fn check_response_size(value: &impl Serialize) -> Result<(), SheetSessionError> {
    let mut budget = ByteBudget::new(MAX_WINDOW_RESPONSE_BYTES);
    serde_json::to_writer(&mut budget, value).map_err(|error| {
        if budget.exceeded {
            SheetSessionError::ResponseTooLarge
        } else {
            SheetSessionError::Serialization(error)
        }
    })
}

fn window_end(start: usize, count: usize, length: usize) -> Result<usize, SheetSessionError> {
    if start > length {
        return Err(SheetSessionError::WindowRange);
    }
    start
        .checked_add(count)
        .map(|end| end.min(length))
        .ok_or(SheetSessionError::WindowRange)
}

struct ByteBudget {
    remaining: usize,
    exceeded: bool,
}

impl ByteBudget {
    fn new(remaining: usize) -> Self {
        Self {
            remaining,
            exceeded: false,
        }
    }
}

impl Write for ByteBudget {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.remaining {
            self.exceeded = true;
            return Err(io::Error::other("sheet response byte budget exceeded"));
        }
        self.remaining -= bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_budget_accepts_the_boundary_without_accepting_one_more_byte() {
        let mut budget = ByteBudget::new(4);
        budget.write_all(b"1234").unwrap();
        budget.write_all(b"").unwrap();
        assert!(!budget.exceeded);
        assert!(budget.write_all(b"5").is_err());
        assert!(budget.exceeded);
        assert_eq!(budget.remaining, 0);
    }

    #[test]
    fn invalid_sources_do_not_invoke_the_revision_adapter() {
        let result = SheetSession::<String>::open("{}", |_| panic!("invalid source"));
        assert!(matches!(result, Err(SheetSessionError::Source(_))));
    }

    #[test]
    fn stale_reload_does_not_parse_or_derive_a_revision() {
        let source = r#"{"version":1,"sheets":[]}"#;
        let mut session = SheetSession::open(source, |_| "current".to_owned()).unwrap();
        let result = session.reload(&"old".to_owned(), "{}", |_| panic!("stale reload"));
        assert!(matches!(result, Err(SheetSessionError::StaleRevision)));
        assert_eq!(session.revision(), "current");
    }
}
