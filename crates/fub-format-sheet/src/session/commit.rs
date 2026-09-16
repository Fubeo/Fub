use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use super::{check_response_size, SheetSession, SheetSessionError};
use crate::{Cell, CellKey, CellStyle, SheetError, Workbook, MAX_SOURCE_BYTES};

pub const MAX_OPERATION_PATCHES: usize = 16_384;
pub const MAX_OPERATION_INPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_INVALIDATED_CELLS: usize = 32_768;

/// Una patch del protocollo grid: identità stabile, preimmagine dell'input e
/// nuovo input. Lo stile persistito della cella resta intatto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SheetCellPatch {
    pub cell: CellKey,
    pub before: Option<String>,
    pub after: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SheetOperation {
    pub patches: Vec<SheetCellPatch>,
}

/// Diff testuale in byte UTF-8 del sorgente autorevole. `deleted` è la
/// preimmagine che permette alla DocumentSession di applicarlo in modo guardato.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SheetSourceEdit {
    pub from: usize,
    pub to: usize,
    pub deleted: String,
    pub inserted: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "cells", rename_all = "snake_case")]
pub enum SheetInvalidation {
    Cells(Vec<CellKey>),
    All,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SheetCommit<R> {
    pub revision: R,
    pub edit: SheetSourceEdit,
    pub invalidation: SheetInvalidation,
}

struct ResolvedPatch<'a> {
    sheet: usize,
    cell_index: Option<usize>,
    cell: &'a CellKey,
    after: &'a str,
}

impl<R: Clone + Eq + Serialize> SheetSession<R> {
    /// Valida tutte le preimmagini prima di toccare il workbook. Qualunque
    /// errore lascia sorgente, revisione, valori e indici della sessione intatti.
    pub fn commit(
        &mut self,
        expected: &R,
        operation: &SheetOperation,
        revision_of: impl FnOnce(&str) -> R,
    ) -> Result<SheetCommit<R>, SheetSessionError> {
        self.check_revision(expected)?;
        let resolved = self.resolve_operation(operation)?;

        let mut workbook = self.workbook.clone();
        apply_resolved(&mut workbook, &resolved);
        let source = workbook.serialize().map_err(SheetSessionError::Source)?;
        if source.len() > MAX_SOURCE_BYTES {
            return Err(SheetSessionError::Source(SheetError::Limit {
                what: "source bytes",
                limit: MAX_SOURCE_BYTES,
            }));
        }

        // `open` rivalida e valuta la nuova sorgente una volta sola. La vecchia
        // sessione resta intatta finché anche invalidazione e risposta passano.
        let replacement = SheetSession::open(&source, revision_of)?;
        let changed: Vec<_> = resolved.iter().map(|patch| patch.cell.clone()).collect();
        let invalidation = invalidation(&changed, &replacement.dependents);
        let result = SheetCommit {
            revision: replacement.revision.clone(),
            edit: source_edit(&self.source, &source),
            invalidation,
        };
        check_response_size(&result)?;
        *self = replacement;
        Ok(result)
    }

    fn resolve_operation<'a>(
        &self,
        operation: &'a SheetOperation,
    ) -> Result<Vec<ResolvedPatch<'a>>, SheetSessionError> {
        if operation.patches.is_empty() {
            return Err(SheetSessionError::EmptyOperation);
        }
        if operation.patches.len() > MAX_OPERATION_PATCHES {
            return Err(SheetSessionError::OperationLimit);
        }

        let mut input_bytes = 0usize;
        for patch in &operation.patches {
            input_bytes = input_bytes
                .checked_add(patch.before.as_ref().map_or(0, String::len))
                .and_then(|bytes| bytes.checked_add(patch.after.len()))
                .ok_or(SheetSessionError::OperationInputLimit)?;
            if input_bytes > MAX_OPERATION_INPUT_BYTES {
                return Err(SheetSessionError::OperationInputLimit);
            }
        }

        let mut seen = HashSet::with_capacity(operation.patches.len());
        let mut resolved = Vec::with_capacity(operation.patches.len());
        for patch in &operation.patches {
            if !seen.insert(&patch.cell) {
                return Err(SheetSessionError::DuplicatePatch);
            }
            let sheet = self
                .sheet_by_id
                .get(&patch.cell.sheet)
                .copied()
                .ok_or(SheetSessionError::UnknownCoordinate)?;
            let row = self.rows_by_id[sheet]
                .get(&patch.cell.row)
                .copied()
                .ok_or(SheetSessionError::UnknownCoordinate)?;
            let column = self.columns_by_id[sheet]
                .get(&patch.cell.column)
                .copied()
                .ok_or(SheetSessionError::UnknownCoordinate)?;
            let cell_index = self.cells_by_position[sheet].get(&(row, column)).copied();
            let current =
                cell_index.map(|index| self.workbook.sheets[sheet].cells[index].input.as_str());
            if patch.before.as_deref() != current {
                return Err(SheetSessionError::PreimageMismatch);
            }
            if current == Some(patch.after.as_str())
                || (current.is_none() && patch.after.is_empty())
            {
                return Err(SheetSessionError::NoChange);
            }
            resolved.push(ResolvedPatch {
                sheet,
                cell_index,
                cell: &patch.cell,
                after: &patch.after,
            });
        }
        Ok(resolved)
    }
}

fn apply_resolved(workbook: &mut Workbook, patches: &[ResolvedPatch<'_>]) {
    let mut removals: HashMap<usize, HashSet<usize>> = HashMap::new();
    for patch in patches {
        let sheet = &mut workbook.sheets[patch.sheet];
        match patch.cell_index {
            Some(index) => {
                let cell = &mut sheet.cells[index];
                if patch.after.is_empty() && cell.style == CellStyle::default() {
                    removals.entry(patch.sheet).or_default().insert(index);
                } else {
                    cell.input.clear();
                    cell.input.push_str(patch.after);
                }
            }
            None => {
                debug_assert!(!patch.after.is_empty());
                sheet.cells.push(Cell {
                    row: patch.cell.row.clone(),
                    column: patch.cell.column.clone(),
                    input: patch.after.to_owned(),
                    style: CellStyle::default(),
                });
            }
        }
    }
    for (sheet, removed) in removals {
        let mut index = 0usize;
        workbook.sheets[sheet].cells.retain(|_| {
            let keep = !removed.contains(&index);
            index += 1;
            keep
        });
    }
}

fn invalidation(
    changed: &[CellKey],
    dependents: &HashMap<CellKey, Vec<CellKey>>,
) -> SheetInvalidation {
    let mut queue: VecDeque<_> = changed.iter().cloned().collect();
    let mut seen = HashSet::with_capacity(changed.len());
    while let Some(cell) = queue.pop_front() {
        if !seen.insert(cell.clone()) {
            continue;
        }
        if seen.len() > MAX_INVALIDATED_CELLS {
            return SheetInvalidation::All;
        }
        if let Some(next) = dependents.get(&cell) {
            queue.extend(next.iter().cloned());
        }
    }
    let mut cells: Vec<_> = seen.into_iter().collect();
    cells.sort();
    SheetInvalidation::Cells(cells)
}

fn source_edit(before: &str, after: &str) -> SheetSourceEdit {
    if before == after {
        return SheetSourceEdit {
            from: before.len(),
            to: before.len(),
            deleted: String::new(),
            inserted: String::new(),
        };
    }

    let before_bytes = before.as_bytes();
    let after_bytes = after.as_bytes();
    let minimum = before_bytes.len().min(after_bytes.len());
    let mut prefix = 0usize;
    while prefix < minimum && before_bytes[prefix] == after_bytes[prefix] {
        prefix += 1;
    }
    while prefix > 0 && (!before.is_char_boundary(prefix) || !after.is_char_boundary(prefix)) {
        prefix -= 1;
    }

    let mut suffix = 0usize;
    while suffix < minimum - prefix
        && before_bytes[before_bytes.len() - 1 - suffix]
            == after_bytes[after_bytes.len() - 1 - suffix]
    {
        suffix += 1;
    }
    while suffix > 0
        && (!before.is_char_boundary(before.len() - suffix)
            || !after.is_char_boundary(after.len() - suffix))
    {
        suffix -= 1;
    }

    let before_end = before.len() - suffix;
    let after_end = after.len() - suffix;
    SheetSourceEdit {
        from: prefix,
        to: before_end,
        deleted: before[prefix..before_end].to_owned(),
        inserted: after[prefix..after_end].to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ColumnId, RowId, SheetId};

    fn key(index: usize) -> CellKey {
        CellKey {
            sheet: SheetId::from("s"),
            row: RowId::from("r"),
            column: ColumnId::from(format!("c{index}")),
        }
    }

    #[test]
    fn utf8_source_edits_never_split_a_character() {
        let edit = source_edit("caffè 😀\n", "caffé 😀!\n");
        assert!("caffè 😀\n".is_char_boundary(edit.from));
        assert!("caffè 😀\n".is_char_boundary(edit.to));
        let mut rebuilt = "caffè 😀\n".as_bytes().to_vec();
        rebuilt.splice(edit.from..edit.to, edit.inserted.as_bytes().iter().copied());
        assert_eq!(String::from_utf8(rebuilt).unwrap(), "caffé 😀!\n");
    }

    #[test]
    fn invalidation_becomes_all_only_after_the_explicit_limit() {
        let root = key(0);
        let exact: Vec<_> = (1..=MAX_INVALIDATED_CELLS - 1).map(key).collect();
        let mut dependents = HashMap::new();
        dependents.insert(root.clone(), exact);
        assert!(matches!(
            invalidation(&[root.clone()], &dependents),
            SheetInvalidation::Cells(cells) if cells.len() == MAX_INVALIDATED_CELLS
        ));
        dependents
            .get_mut(&root)
            .unwrap()
            .push(key(MAX_INVALIDATED_CELLS));
        assert_eq!(invalidation(&[root], &dependents), SheetInvalidation::All);
    }
}
