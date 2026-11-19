//! Le parti di una cartella che una nota incorpora (T43): la `#…` di
//! `![[Conti.xlsx#Budget!A1:E7]]`, letta come la legge Excel.
//!
//! Una parte è un foglio intero (`Budget`), un intervallo (`Budget!A1:E7`,
//! `'Conti 2025'!B2:D9`, o `A1:E7` sul foglio attivo), un nome definito che
//! nomina un intervallo (`Totali`), una tabella del file (`Spese`) o un
//! grafico col suo titolo (`Grafico spese`, T54: [`crate::objects`]); senza
//! parte, il foglio attivo. Un foglio intero, e il foglio attivo senza parte,
//! valgono dalla prima all'ultima cella che mostra qualcosa: la scheda
//! comincia dove comincia il foglio, non dall'A1 vuoto.
//!
//! Si cerca in quest'ordine: l'intervallo col foglio davanti, il nome di un
//! foglio, un nome definito (prima quello della cartella, poi quello di un
//! foglio), una tabella, un grafico, l'intervallo senza foglio. I nomi si confrontano
//! senza badare alle maiuscole, come in Excel. Un nome che non nomina un solo
//! rettangolo (una costante, una formula, più aree) non è una parte.
//!
//! L'intervallo scritto resta quello: se la tabella del file cresce, la parte
//! la segue soltanto quando nomina il nome o la tabella, che il file sposta
//! con lei. La lettura non ricalcola niente e non cambia la cartella.

use gridcraft_core::{CellRef, RangeRef, MAX_COLS, MAX_ROWS};
use gridcraft_model::{Sheet, Visibility, Workbook};
use serde_json::{json, Value as Json};

use crate::display;

/// Di quante parti al più si dà l'elenco quando la parte non c'è: quelle che
/// «Scegli di nuovo» propone.
pub const MAX_LISTED_PARTS: usize = 64;

/// Che cosa la parte nomina.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PartKind {
    /// Nessuna parte: il foglio attivo, dalla prima cella usata.
    Active,
    /// Un foglio intero, dalla prima cella usata.
    Sheet,
    /// Un intervallo scritto.
    Range,
    /// Un nome definito che nomina un intervallo.
    Name,
    /// Una tabella del file.
    Table,
    /// Un grafico, per titolo: il rettangolo sono le celle che copre.
    Chart,
}

impl PartKind {
    /// Il nome della specie nel risultato del comando.
    pub fn id(self) -> &'static str {
        match self {
            PartKind::Active => "active",
            PartKind::Sheet => "sheet",
            PartKind::Range => "range",
            PartKind::Name => "name",
            PartKind::Table => "table",
            PartKind::Chart => "chart",
        }
    }
}

/// Una parte trovata: il foglio (l'indice nella cartella) e il rettangolo;
/// per un grafico anche il suo id nel file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Part {
    pub sheet: usize,
    pub range: RangeRef,
    pub kind: PartKind,
    pub chart: Option<u32>,
}

/// La parte `text` della cartella, o `None` se la cartella non la ha.
pub fn resolve(workbook: &Workbook, text: &str) -> Option<Part> {
    let text = text.trim();
    if workbook.sheets.is_empty() {
        return None;
    }
    if text.is_empty() {
        let sheet = active_sheet(workbook);
        return Some(Part {
            sheet,
            range: used_range(workbook, sheet),
            kind: PartKind::Active,
            chart: None,
        });
    }
    if let Some((sheet, range)) = sheet_range(workbook, text, None) {
        return Some(Part {
            sheet,
            range,
            kind: PartKind::Range,
            chart: None,
        });
    }
    if let Some(sheet) = sheet_named(workbook, text) {
        return Some(Part {
            sheet,
            range: used_range(workbook, sheet),
            kind: PartKind::Sheet,
            chart: None,
        });
    }
    if let Some((sheet, range)) = defined_name(workbook, text) {
        return Some(Part {
            sheet,
            range,
            kind: PartKind::Name,
            chart: None,
        });
    }
    if let Some((sheet, range)) = table_named(workbook, text) {
        return Some(Part {
            sheet,
            range,
            kind: PartKind::Table,
            chart: None,
        });
    }
    if let Some(chart) = crate::objects::chart_named(workbook, text) {
        return Some(Part {
            sheet: chart.sheet,
            range: chart.range,
            kind: PartKind::Chart,
            chart: Some(chart.id),
        });
    }
    let sheet = active_sheet(workbook);
    let range = RangeRef::parse(text)?;
    Some(Part {
        sheet,
        range: bounded(workbook, sheet, range),
        kind: PartKind::Range,
        chart: None,
    })
}

/// Le parti che la cartella ha, per sceglierne un'altra: i fogli visibili, i
/// nomi definiti che nominano un intervallo, le tabelle, i grafici col
/// titolo. Al più
/// [`MAX_LISTED_PARTS`], in quest'ordine.
pub fn listed(workbook: &Workbook) -> Vec<(PartKind, String)> {
    let sheets = workbook
        .sheets
        .iter()
        .filter(|sheet| sheet.visibility == Visibility::Visible)
        .map(|sheet| (PartKind::Sheet, sheet.name.clone()));
    let names = workbook
        .names
        .iter()
        .filter(|name| shown_name(&name.name, name.hidden))
        .filter(|name| reference(workbook, &name.formula, name.scope).is_some())
        .map(|name| (PartKind::Name, name.name.clone()));
    let tables = workbook
        .sheets
        .iter()
        .flat_map(|sheet| sheet.tables.iter())
        .map(|table| (PartKind::Table, table.name.clone()));
    let charts = crate::objects::chart_names(workbook).map(|name| (PartKind::Chart, name));
    let mut seen = std::collections::HashSet::new();
    sheets
        .chain(names)
        .chain(tables)
        .chain(charts)
        .filter(|(kind, name)| !name.is_empty() && seen.insert((*kind, name_key(name))))
        .take(MAX_LISTED_PARTS)
        .collect()
}

/// La risposta del comando della parte: dove sta, col nome che la sessione dà
/// al foglio (`sheet_id`) e, per un grafico, il suo id nel file (`chart`), o
/// l'elenco delle parti che ci sono.
pub fn answer(workbook: &Workbook, text: &str, sheet_id: impl Fn(usize) -> Option<String>) -> Json {
    if let Some(part) = resolve(workbook, text) {
        if let Some(sheet) = sheet_id(part.sheet) {
            let mut found = json!({
                "found": true,
                "kind": part.kind.id(),
                "sheet": sheet,
                "range": part.range.a1(),
            });
            if let Some(chart) = part.chart {
                found["chart"] = json!(chart);
            }
            return found;
        }
    }
    let parts: Vec<Json> = listed(workbook)
        .into_iter()
        .map(|(kind, name)| json!({ "kind": kind.id(), "name": name }))
        .collect();
    json!({ "found": false, "parts": parts })
}

/// Il foglio attivo, o il primo visibile se quello è nascosto.
fn active_sheet(workbook: &Workbook) -> usize {
    let active = workbook.active_sheet.min(workbook.sheets.len() - 1);
    if workbook.sheets[active].visibility == Visibility::Visible {
        return active;
    }
    workbook
        .sheets
        .iter()
        .position(|sheet| sheet.visibility == Visibility::Visible)
        .unwrap_or(active)
}

/// Dalla prima all'ultima cella che il foglio mostra; l'A1 se è vuoto.
pub fn used_range(workbook: &Workbook, index: usize) -> RangeRef {
    let sheet: &Sheet = &workbook.sheets[index];
    let mut found: Option<RangeRef> = None;
    for (at, cell, value) in display::entries(sheet) {
        if !display::shows(workbook, sheet, at, cell, value) {
            continue;
        }
        let here = RangeRef::cell(at);
        found = Some(found.map_or(here, |range| range.union(&here)));
    }
    found.unwrap_or_else(|| RangeRef::cell(CellRef::new(0, 0)))
}

/// Un intervallo di colonne intere (`A:C`) o di righe intere (`2:5`) vale
/// fin dove il foglio ha qualcosa: la scheda non chiede un milione di righe.
fn bounded(workbook: &Workbook, sheet: usize, range: RangeRef) -> RangeRef {
    if !range.is_full_rows() && !range.is_full_cols() {
        return range;
    }
    let used = used_range(workbook, sheet);
    let rows = if range.is_full_cols() {
        (
            range.start.row.max(used.start.row).min(used.end.row),
            used.end.row,
        )
    } else {
        (range.start.row, range.end.row)
    };
    let cols = if range.is_full_rows() {
        (
            range.start.col.max(used.start.col).min(used.end.col),
            used.end.col,
        )
    } else {
        (range.start.col, range.end.col)
    };
    RangeRef::new(CellRef::new(rows.0, cols.0), CellRef::new(rows.1, cols.1))
}

/// La chiave con cui due nomi della cartella (fogli, nomi definiti, tabelle)
/// sono lo stesso: Excel li confronta senza badare alle maiuscole, anche
/// fuori dall'ASCII («Città» e «CITTÀ» sono un foglio solo). Anche i titoli
/// dei grafici (`objects::chart_named`) si confrontano con questa.
pub(crate) fn name_key(name: &str) -> String {
    name.to_lowercase()
}

/// Il foglio di nome `name`, senza badare alle maiuscole.
fn sheet_named(workbook: &Workbook, name: &str) -> Option<usize> {
    let wanted = name_key(name);
    workbook
        .sheets
        .iter()
        .position(|sheet| name_key(&sheet.name) == wanted)
}

/// `Foglio!A1:B2` (o `'Il foglio'!$A$1`): il foglio e il rettangolo. Senza
/// `!`, il rettangolo sul foglio `fallback` se c'è.
fn sheet_range(
    workbook: &Workbook,
    text: &str,
    fallback: Option<usize>,
) -> Option<(usize, RangeRef)> {
    let (sheet, range) = match text.rfind('!') {
        Some(bang) => {
            let name = unquote(text[..bang].trim())?;
            (sheet_named(workbook, &name)?, &text[bang + 1..])
        }
        None => (fallback?, text),
    };
    let range = RangeRef::parse(range)?;
    if range.end.row >= MAX_ROWS || range.end.col >= MAX_COLS {
        return None;
    }
    Some((sheet, bounded(workbook, sheet, range)))
}

/// Il nome di un foglio com'è scritto in un riferimento: fra apici, con gli
/// apici raddoppiati, o com'è. `None` se gli apici non si chiudono.
fn unquote(text: &str) -> Option<String> {
    match text.strip_prefix('\'') {
        Some(inner) => inner
            .strip_suffix('\'')
            .map(|inner| inner.replace("''", "'")),
        None if text.is_empty() => None,
        None => Some(text.to_owned()),
    }
}

/// Un nome che una persona vede: né nascosto né di Excel (`_xlnm.`).
fn shown_name(name: &str, hidden: bool) -> bool {
    !hidden && !name.is_empty() && !name.starts_with("_xlnm.")
}

/// Il rettangolo che la formula di un nome nomina, se è uno solo.
fn reference(
    workbook: &Workbook,
    formula: &str,
    scope: Option<usize>,
) -> Option<(usize, RangeRef)> {
    let formula = formula.trim().trim_start_matches('=');
    // Più aree, una funzione, una costante: non è un rettangolo.
    if formula.contains(',') || formula.contains('(') || formula.contains('"') {
        return None;
    }
    let fallback = scope.filter(|index| *index < workbook.sheets.len());
    sheet_range(workbook, formula, fallback)
}

/// Il nome definito `name`: prima quello della cartella, poi quello di un
/// foglio.
fn defined_name(workbook: &Workbook, name: &str) -> Option<(usize, RangeRef)> {
    let wanted = name_key(name);
    let mut candidates: Vec<_> = workbook
        .names
        .iter()
        .filter(|defined| {
            shown_name(&defined.name, defined.hidden) && name_key(&defined.name) == wanted
        })
        .collect();
    candidates.sort_by_key(|defined| defined.scope.is_some());
    candidates
        .into_iter()
        .find_map(|defined| reference(workbook, &defined.formula, defined.scope))
}

/// La tabella `name` del file e il suo foglio.
fn table_named(workbook: &Workbook, name: &str) -> Option<(usize, RangeRef)> {
    let wanted = name_key(name);
    workbook
        .sheets
        .iter()
        .enumerate()
        .find_map(|(index, sheet)| {
            sheet
                .tables
                .iter()
                .find(|table| name_key(&table.name) == wanted)
                .map(|table| (index, table.range))
        })
}
