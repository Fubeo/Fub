//! Le celle che la modifica dei valori non tocca, e perché.
//!
//! Una cella è bloccata quando cambiarne il valore romperebbe una struttura
//! che l'innesto non riscrive: una matrice, una formula condivisa, una tabella
//! di dati, l'intestazione o il totale di una tabella, una cella unita che non
//! è la prima, l'uscita di una pivot, un'immagine nella cella, un foglio
//! protetto. Il blocco si vede già nella finestra, e l'innesto lo ricontrolla.

use std::collections::{HashMap, HashSet};

use gridcraft_core::{CellRef, RangeRef};
use gridcraft_model::{Sheet, StyleTable};

use crate::sheet_xml::SheetFacts;

/// Perché una cella è bloccata. I codici sono chiusi: la shell li traduce.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Lock {
    /// Una cella di una formula a matrice.
    Array,
    /// Una cella di un'area versata da una formula dinamica.
    Spill,
    /// La cella d'origine di una formula condivisa.
    SharedFormula,
    /// Una cella di una tabella di dati (analisi di simulazione).
    DataTable,
    /// L'intestazione di una tabella.
    TableHeader,
    /// La riga dei totali di una tabella.
    TableTotals,
    /// Una cella unita che non è la prima.
    Merged,
    /// L'uscita di una tabella pivot.
    Pivot,
    /// Un'immagine o un valore ricco nella cella.
    RichValue,
    /// Una cella bloccata di un foglio protetto.
    Protected,
}

impl Lock {
    /// Ogni blocco, una volta.
    pub const ALL: [Lock; 10] = [
        Lock::Array,
        Lock::Spill,
        Lock::SharedFormula,
        Lock::DataTable,
        Lock::TableHeader,
        Lock::TableTotals,
        Lock::Merged,
        Lock::Pivot,
        Lock::RichValue,
        Lock::Protected,
    ];

    /// Il codice stabile del blocco.
    pub fn code(self) -> &'static str {
        match self {
            Lock::Array => "array",
            Lock::Spill => "spill",
            Lock::SharedFormula => "shared-formula",
            Lock::DataTable => "data-table",
            Lock::TableHeader => "table-header",
            Lock::TableTotals => "table-totals",
            Lock::Merged => "merged",
            Lock::Pivot => "pivot",
            Lock::RichValue => "rich-value",
            Lock::Protected => "protected",
        }
    }
}

/// Un'area alta fino a questo numero di righe sta nell'indice per riga; una
/// più alta si scorre a parte.
const BUCKET_ROWS: u32 = 1024;

/// I blocchi di un foglio, con un indice per riga: una finestra li chiede cella
/// per cella.
#[derive(Clone, Debug, Default)]
pub(crate) struct SheetLocks {
    areas: Vec<(RangeRef, Lock)>,
    by_row: HashMap<u32, Vec<usize>>,
    tall: Vec<usize>,
    cells: HashMap<CellRef, Lock>,
    /// Le celle bloccate per stile, quando il foglio è protetto.
    protected: bool,
    unlocked_styles: HashSet<u32>,
}

impl SheetLocks {
    pub fn new(sheet: &Sheet, facts: &SheetFacts, styles: &StyleTable) -> SheetLocks {
        let mut locks = SheetLocks::default();
        let area = |range: RangeRef, lock: Lock, locks: &mut SheetLocks| {
            let index = locks.areas.len();
            locks.areas.push((range, lock));
            if range.end.row - range.start.row < BUCKET_ROWS {
                for row in range.start.row..=range.end.row {
                    locks.by_row.entry(row).or_default().push(index);
                }
            } else {
                locks.tall.push(index);
            }
        };
        for (pos, cell) in sheet.cells.iter() {
            if let Some(range) = cell.formula.as_ref().and_then(|formula| formula.array) {
                area(range, Lock::Array, &mut locks);
            } else if cell.formula.is_none()
                && matches!(cell.value, gridcraft_core::Value::Array(_))
            {
                locks.cells.insert(pos, Lock::Array);
            }
        }
        for range in sheet.spill_ranges.values() {
            area(*range, Lock::Spill, &mut locks);
        }
        for range in &facts.data_tables {
            area(*range, Lock::DataTable, &mut locks);
        }
        for table in &sheet.tables {
            let range = table.range;
            if table.header_row {
                let row = RangeRef::new(range.start, CellRef::new(range.start.row, range.end.col));
                area(row, Lock::TableHeader, &mut locks);
            }
            if table.totals_row {
                let row = RangeRef::new(CellRef::new(range.end.row, range.start.col), range.end);
                area(row, Lock::TableTotals, &mut locks);
            }
        }
        for pivot in &sheet.pivots {
            if let Some(range) = pivot.last_range {
                area(range, Lock::Pivot, &mut locks);
            }
        }
        for range in &sheet.merges {
            if !range.is_single() {
                area(*range, Lock::Merged, &mut locks);
            }
        }
        for &pos in &facts.shared_masters {
            locks.cells.entry(pos).or_insert(Lock::SharedFormula);
        }
        for &pos in sheet.cell_pictures.keys().chain(&facts.rich) {
            locks.cells.entry(pos).or_insert(Lock::RichValue);
        }
        if sheet.is_protected() {
            locks.protected = true;
            locks.unlocked_styles = styles
                .iter()
                .filter(|(_, style)| !style.protection.locked)
                .map(|(id, _)| id.0)
                .collect();
        }
        locks
    }

    /// Le celle di `range` bloccate da un'area (una matrice, un'area
    /// versata, una tabella, una pivot, delle celle unite), anche vuote: la
    /// finestra le mostra col loro blocco, così la shell non ci scrive. Le
    /// celle bloccate una per una hanno già un contenuto, e quelle di un
    /// foglio protetto si dicono all'`apply`.
    pub fn area_cells(&self, range: RangeRef) -> impl Iterator<Item = CellRef> + '_ {
        self.areas.iter().flat_map(move |&(area, lock)| {
            let rows = area.start.row.max(range.start.row)..=area.end.row.min(range.end.row);
            let columns = area.start.col.max(range.start.col)..=area.end.col.min(range.end.col);
            rows.flat_map(move |row| columns.clone().map(move |col| CellRef::new(row, col)))
                .filter(move |&cell| !(lock == Lock::Merged && cell == area.start))
        })
    }

    /// Il blocco di una cella, se ne ha uno.
    pub fn at(&self, sheet: &Sheet, cell: CellRef) -> Option<Lock> {
        if let Some(lock) = self.cells.get(&cell) {
            return Some(*lock);
        }
        let hit = |&index: &usize| {
            let (range, lock) = self.areas[index];
            (range.contains(cell) && !(lock == Lock::Merged && range.start == cell)).then_some(lock)
        };
        if let Some(lock) = self
            .by_row
            .get(&cell.row)
            .and_then(|indices| indices.iter().find_map(hit))
            .or_else(|| self.tall.iter().find_map(hit))
        {
            return Some(lock);
        }
        if self.protected && !self.unlocked_styles.contains(&sheet.style_id(cell).0) {
            return Some(Lock::Protected);
        }
        None
    }
}
