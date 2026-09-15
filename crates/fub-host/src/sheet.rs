//! Motore workbook consumato dagli host concreti senza dipendere da Tauri.
//!
//! `SheetSession` è un adapter nativo interno: non pubblica ancora un contratto
//! ABI/WIT e non sostituisce la porta IPC provvisoria della vertical slice.

use std::collections::HashMap;
use std::fmt;
use std::io::{self, Write};

use fub_abi::{PluginError, Revision};
use fub_format_sheet::{Cell, CellKey, CellValue, Column, Row, SheetError, SheetId, Workbook};
use serde::Serialize;

pub use fub_format_sheet::WorkbookEvaluation;

pub const MAX_WINDOW_ROWS: usize = 256;
pub const MAX_WINDOW_COLUMNS: usize = 128;
pub const MAX_WINDOW_CELLS: usize = 32_768;
pub const MAX_WINDOW_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// Parses, validates and evaluates one authoritative `.fubsheet` source.
pub fn evaluate(source: &str) -> Result<WorkbookEvaluation, PluginError> {
    Workbook::parse(source)
        .and_then(|workbook| workbook.evaluate())
        .map_err(|error| PluginError::BadArgs(error.to_string().into()))
}

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
/// La revisione usa la forma serializzata già definita dal contratto comune.
#[derive(Debug, Serialize)]
pub struct SheetWindow<'a> {
    pub revision: &'a Revision,
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
            Self::ResponseTooLarge => formatter.write_str("sheet window response exceeds 8 MiB"),
            Self::EvaluationMismatch => formatter.write_str("sheet evaluation is incomplete"),
            Self::Serialization(error) => write!(formatter, "sheet window serialization: {error}"),
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
pub struct SheetSession {
    revision: Revision,
    workbook: Workbook,
    values: HashMap<CellKey, CellValue>,
    cells_by_position: Vec<HashMap<(usize, usize), usize>>,
}

impl SheetSession {
    pub fn open(source: &str) -> Result<Self, SheetSessionError> {
        // Il parser verifica MAX_SOURCE_BYTES prima di deserializzare il JSON.
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
        let mut cells_by_position = Vec::with_capacity(workbook.sheets.len());
        for sheet in &workbook.sheets {
            let rows: HashMap<_, _> = sheet
                .rows
                .iter()
                .enumerate()
                .map(|(index, row)| (&row.id, index))
                .collect();
            let columns: HashMap<_, _> = sheet
                .columns
                .iter()
                .enumerate()
                .map(|(index, column)| (&column.id, index))
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
            cells_by_position.push(positions);
        }
        Ok(Self {
            revision: Revision::of(source),
            workbook,
            values,
            cells_by_position,
        })
    }

    pub fn revision(&self) -> &Revision {
        &self.revision
    }

    /// Compare-and-reload: un errore lascia revisione, assi e valori precedenti.
    /// La revisione identifica i byte effettivi, non la serializzazione canonica.
    pub fn reload(&mut self, expected: &Revision, source: &str) -> Result<(), SheetSessionError> {
        self.check_revision(expected)?;
        let replacement = Self::open(source)?;
        *self = replacement;
        Ok(())
    }

    pub fn window(
        &self,
        expected: &Revision,
        sheet_id: &SheetId,
        request: SheetWindowRequest,
    ) -> Result<SheetWindow<'_>, SheetSessionError> {
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
            .workbook
            .sheets
            .iter()
            .position(|sheet| &sheet.id == sheet_id)
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
        // Conta la forma JSON reale (UTF-8 ed escaping inclusi), senza prima
        // allocare una risposta eventualmente oltre limite.
        let mut budget = ByteBudget::new(MAX_WINDOW_RESPONSE_BYTES);
        if let Err(error) = serde_json::to_writer(&mut budget, &window) {
            return Err(if budget.exceeded {
                SheetSessionError::ResponseTooLarge
            } else {
                SheetSessionError::Serialization(error)
            });
        }
        Ok(window)
    }

    fn check_revision(&self, expected: &Revision) -> Result<(), SheetSessionError> {
        if expected == &self.revision {
            Ok(())
        } else {
            Err(SheetSessionError::StaleRevision)
        }
    }
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
    fn malformed_workbooks_are_bad_arguments() {
        let error = evaluate("{}").unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
    }

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
}
