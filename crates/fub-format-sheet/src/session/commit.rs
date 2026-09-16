use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, Write};

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

#[derive(Clone, Copy)]
struct SourceEditBounds {
    from: usize,
    to: usize,
    after_from: usize,
    after_to: usize,
}

#[derive(Serialize)]
struct BorrowedSourceEdit<'a> {
    from: usize,
    to: usize,
    deleted: &'a str,
    inserted: &'a str,
}

#[derive(Serialize)]
struct BorrowedCommit<'a, R> {
    revision: &'a R,
    edit: BorrowedSourceEdit<'a>,
    invalidation: &'a SheetInvalidation,
}

impl SourceEditBounds {
    fn borrowed<'a>(self, before: &'a str, after: &'a str) -> BorrowedSourceEdit<'a> {
        BorrowedSourceEdit {
            from: self.from,
            to: self.to,
            deleted: &before[self.from..self.to],
            inserted: &after[self.after_from..self.after_to],
        }
    }

    fn owned(self, before: &str, after: &str) -> SheetSourceEdit {
        let borrowed = self.borrowed(before, after);
        SheetSourceEdit {
            from: borrowed.from,
            to: borrowed.to,
            deleted: borrowed.deleted.to_owned(),
            inserted: borrowed.inserted.to_owned(),
        }
    }
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
        let source = serialize_workbook(&workbook)?;

        // `open` rivalida e valuta la nuova sorgente una volta sola. La vecchia
        // sessione resta intatta finché anche invalidazione e risposta passano.
        let replacement = SheetSession::open(&source, revision_of)?;
        let changed: Vec<_> = resolved.iter().map(|patch| patch.cell.clone()).collect();
        let mut invalidation = invalidation(&changed, &replacement.dependents);
        let edit = source_edit_bounds(&self.source, &source);

        // La preview ha esattamente la forma JSON della risposta finale, ma
        // prende in prestito le due fette di sorgente: escaping UTF-8 e byte
        // effettivi vengono contati prima di allocare `deleted` e `inserted`.
        // Se il solo elenco esplicito rende la risposta troppo grande, `all`
        // conserva la semantica di invalidazione senza rifiutare il commit.
        fit_commit_response(
            &replacement.revision,
            &self.source,
            &source,
            edit,
            &mut invalidation,
        )?;

        let result = SheetCommit {
            revision: replacement.revision.clone(),
            edit: edit.owned(&self.source, &source),
            invalidation,
        };
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

fn serialize_workbook(workbook: &Workbook) -> Result<String, SheetSessionError> {
    serialize_workbook_with_limit(workbook, MAX_SOURCE_BYTES)
}

fn serialize_workbook_with_limit(
    workbook: &Workbook,
    limit: usize,
) -> Result<String, SheetSessionError> {
    workbook.validate().map_err(SheetSessionError::Source)?;
    let mut output = SourceBudget::new(limit);
    if let Err(error) = serde_json::to_writer_pretty(&mut output, workbook) {
        return Err(if output.exceeded {
            SheetSessionError::Source(SheetError::Limit {
                what: "source bytes",
                limit,
            })
        } else {
            SheetSessionError::Source(SheetError::Json(error))
        });
    }
    if output.write_all(b"\n").is_err() {
        return Err(SheetSessionError::Source(SheetError::Limit {
            what: "source bytes",
            limit,
        }));
    }
    Ok(String::from_utf8(output.bytes).expect("serde_json writes UTF-8"))
}

struct SourceBudget {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl SourceBudget {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
            exceeded: false,
        }
    }
}

impl Write for SourceBudget {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let Some(next) = self.bytes.len().checked_add(bytes.len()) else {
            self.exceeded = true;
            return Err(io::Error::other("sheet source byte budget exceeded"));
        };
        if next > self.limit {
            self.exceeded = true;
            return Err(io::Error::other("sheet source byte budget exceeded"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn fit_commit_response<R: Serialize>(
    revision: &R,
    before: &str,
    after: &str,
    edit: SourceEditBounds,
    invalidation: &mut SheetInvalidation,
) -> Result<(), SheetSessionError> {
    let check = |current: &SheetInvalidation| {
        check_response_size(&BorrowedCommit {
            revision,
            edit: edit.borrowed(before, after),
            invalidation: current,
        })
    };
    match check(invalidation) {
        Err(SheetSessionError::ResponseTooLarge)
            if matches!(invalidation, SheetInvalidation::Cells(_)) =>
        {
            *invalidation = SheetInvalidation::All;
            check(invalidation)
        }
        result => result,
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

fn source_edit_bounds(before: &str, after: &str) -> SourceEditBounds {
    if before == after {
        return SourceEditBounds {
            from: before.len(),
            to: before.len(),
            after_from: after.len(),
            after_to: after.len(),
        };
    }

    let before_bytes = before.as_bytes();
    let after_bytes = after.as_bytes();
    let minimum = before_bytes.len().min(after_bytes.len());
    let mut prefix = 0usize;
    while prefix < minimum && before_bytes[prefix] == after_bytes[prefix] {
        prefix += 1;
    }
    // Il confine testuale condiviso tratta CRLF come un solo terminatore. Qui
    // non si ridefinisce la policy: si estende il diff quando il massimo
    // prefisso/suffisso cadrebbe dentro la coppia, così l'edit che attraversa
    // DocumentSession rispetta la stessa disciplina senza normalizzare il file.
    while prefix > 0
        && (!safe_edit_boundary(before, prefix) || !safe_edit_boundary(after, prefix))
    {
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
        && (!safe_edit_boundary(before, before.len() - suffix)
            || !safe_edit_boundary(after, after.len() - suffix))
    {
        suffix -= 1;
    }

    SourceEditBounds {
        from: prefix,
        to: before.len() - suffix,
        after_from: prefix,
        after_to: after.len() - suffix,
    }
}

fn safe_edit_boundary(source: &str, at: usize) -> bool {
    if !source.is_char_boundary(at) {
        return false;
    }
    let bytes = source.as_bytes();
    !(at > 0 && at < bytes.len() && bytes[at - 1] == b'\r' && bytes[at] == b'\n')
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

    fn padded_id(prefix: char, index: usize) -> String {
        let suffix = index.to_string();
        let fill = 128 - prefix.len_utf8() - suffix.len();
        format!("{prefix}{}{suffix}", "x".repeat(fill))
    }

    #[test]
    fn utf8_source_edits_never_split_a_character() {
        let before = "caffè 😀\n";
        let after = "caffé 😀!\n";
        let bounds = source_edit_bounds(before, after);
        let edit = bounds.owned(before, after);
        assert!(safe_edit_boundary(before, edit.from));
        assert!(safe_edit_boundary(before, edit.to));
        let mut rebuilt = before.as_bytes().to_vec();
        rebuilt.splice(edit.from..edit.to, edit.inserted.as_bytes().iter().copied());
        assert_eq!(String::from_utf8(rebuilt).unwrap(), after);
    }

    #[test]
    fn source_edits_never_split_crlf_when_canonicalizing_line_endings() {
        let before = "{\r\n  \"version\": 1\r\n}\r\n";
        let after = "{\n  \"version\": 2\n}\n";
        let bounds = source_edit_bounds(before, after);
        let edit = bounds.owned(before, after);
        assert!(safe_edit_boundary(before, edit.from));
        assert!(safe_edit_boundary(before, edit.to));
        assert_eq!(&before[edit.from..edit.to], edit.deleted);
        let mut rebuilt = before.as_bytes().to_vec();
        rebuilt.splice(edit.from..edit.to, edit.inserted.as_bytes().iter().copied());
        assert_eq!(String::from_utf8(rebuilt).unwrap(), after);
    }

    #[test]
    fn borrowed_and_owned_edits_serialize_identically() {
        let before = "{\"a\":1}";
        let after = "{\"a\":2}";
        let bounds = source_edit_bounds(before, after);
        assert_eq!(
            serde_json::to_value(bounds.borrowed(before, after)).unwrap(),
            serde_json::to_value(bounds.owned(before, after)).unwrap()
        );
    }

    #[test]
    fn source_serialization_stops_at_the_limit_instead_of_building_past_it() {
        let workbook = Workbook::new(Vec::new());
        let canonical = workbook.serialize().unwrap();
        let result = serialize_workbook_with_limit(&workbook, canonical.len() - 1);
        assert!(matches!(
            result,
            Err(SheetSessionError::Source(SheetError::Limit { .. }))
        ));
    }

    #[test]
    fn long_valid_ids_degrade_explicit_invalidation_before_the_response_overflows() {
        let sheet = SheetId::from("s".repeat(128));
        let column = ColumnId::from("c".repeat(128));
        let cells = (0..25_000)
            .map(|index| CellKey {
                sheet: sheet.clone(),
                row: RowId::from(padded_id('r', index)),
                column: column.clone(),
            })
            .collect();
        let mut invalidation = SheetInvalidation::Cells(cells);
        let before = "{}";
        let after = "{}";
        fit_commit_response(
            &0u64,
            before,
            after,
            source_edit_bounds(before, after),
            &mut invalidation,
        )
        .unwrap();
        assert_eq!(invalidation, SheetInvalidation::All);
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
