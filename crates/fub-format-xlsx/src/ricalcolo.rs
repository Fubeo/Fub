//! Il ricalcolo delle formule con il motore di GridCraft
//! (`gridcraft_calc::recalc`), come in Excel: dopo un cambio, ogni formula che
//! legge una cella cambiata, direttamente o attraverso altre formule, ha il
//! valore nuovo; all'apertura, una formula che il file ha salvato senza valore
//! si calcola.
//!
//! Il ricalcolo non tocca la cartella del file: calcola su una copia (i fogli
//! sono condivisi, si copia soltanto quello che cambia) e dà i valori nuovi.
//! Chi lo chiama li mostra, e l'innesto ([`crate::graft`]) li scrive come
//! valori salvati delle formule.
//!
//! Una formula che il motore non sa calcolare tiene il valore che il file ha
//! salvato e resta **non aggiornata**, con ogni formula che la legge:
//!
//! - una funzione che il motore non conosce (il motore darebbe `#NAME?` dove
//!   il file ha un altro valore);
//! - un riferimento a un'altra cartella o a un foglio che non c'è;
//! - una formula matrice, o una che versa i suoi valori in altre celle;
//! - un riferimento circolare;
//! - un risultato che una cella non salva (una matrice, un numero non finito).
//!
//! Con il calcolo manuale della cartella niente si ricalcola, come in Excel: le
//! formule toccate restano non aggiornate.

use std::collections::{HashMap, HashSet};

use gridcraft_calc::recalc::{Calc, Key};
use gridcraft_core::{CellError, RangeRef, Value};
use gridcraft_formula::ast::{Expr, SheetSel};
use gridcraft_model::{CalcMode, Workbook};

use crate::{guarded, XlsxError};

/// Ciò che il ricalcolo dà.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Ricalcolo {
    /// Il valore calcolato di ogni formula toccata che il motore sa
    /// calcolare, anche quando è quello del file.
    pub valori: HashMap<Key, Value>,
    /// Le formule toccate che tengono il valore del file: il motore non le
    /// sa calcolare, o ne leggono una.
    pub vecchie: HashSet<Key>,
}

/// Le formule senza valore salvato che il ricalcolo prova a calcolare:
/// quelle che il file scrive con `<f>` e senza `<v>`, tranne le matrici, che
/// non si calcolano comunque (e una matrice grande costerebbe l'apertura).
pub(crate) fn senza_valore(workbook: &Workbook) -> Vec<Key> {
    workbook
        .sheets
        .iter()
        .enumerate()
        .flat_map(|(index, sheet)| {
            sheet
                .cells
                .iter()
                .filter(|(_, cell)| {
                    cell.value.is_empty()
                        && cell
                            .formula
                            .as_ref()
                            .is_some_and(|formula| formula.array.is_none() && !formula.dynamic)
                })
                .map(move |(at, _)| (index, at))
        })
        .collect()
}

/// Ricalcola le formule `toccate` della cartella `workbook`, dopo che le celle
/// di `cambi` hanno preso il loro valore costante. `calc` è il grafo delle
/// dipendenze della cartella del file; `semi` sono le formule da calcolare
/// anche se niente di ciò che leggono cambia (quelle senza valore salvato).
/// `toccate` è la chiusura delle formule che leggono `cambi` e `semi`;
/// `dinamiche` le formule che leggono celle scelte mentre calcolano;
/// `bloccate` le formule il cui valore salvato l'innesto non riscrive (una
/// tabella di dati, un valore ricco): restano vecchie anche loro.
pub(crate) fn ricalcola(
    workbook: &Workbook,
    calc: &Calc,
    dinamiche: &[Key],
    cambi: &[(Key, Value)],
    semi: &[Key],
    toccate: &HashSet<Key>,
    bloccate: &HashSet<Key>,
) -> Result<Ricalcolo, XlsxError> {
    if toccate.is_empty() {
        return Ok(Ricalcolo::default());
    }
    if workbook.calc.mode == CalcMode::Manual {
        return Ok(Ricalcolo {
            valori: HashMap::new(),
            vecchie: toccate.clone(),
        });
    }
    guarded(|| {
        let mut copia = workbook.clone();
        for ((sheet, at), value) in cambi {
            if let Some(model) = copia.sheet_mut(*sheet) {
                model.set_value(*at, value.clone());
            }
        }
        let mut motore = calc.clone();
        let mut cambiate: Vec<Key> = cambi.iter().map(|(key, _)| *key).collect();
        cambiate.extend(semi.iter().copied());
        motore.cells_changed(&mut copia, &cambiate);
        let circolari: HashSet<Key> = motore.circular.iter().copied().collect();

        let editate: HashSet<Key> = cambi.iter().map(|(key, _)| *key).collect();
        let mut vecchie: Vec<Key> = Vec::new();
        for &key in toccate {
            if editate.contains(&key) {
                continue;
            }
            if bloccate.contains(&key) || !calcolabile(workbook, &copia, &circolari, key) {
                vecchie.push(key);
            }
        }
        let vecchie = con_chi_le_legge(workbook, calc, dinamiche, vecchie, toccate);
        let valori = toccate
            .iter()
            .filter(|key| !editate.contains(key) && !vecchie.contains(key))
            .filter_map(|&(sheet, at)| {
                let cell = copia.sheet(sheet)?.cell(at)?;
                cell.formula.as_ref()?;
                Some(((sheet, at), cell.value.clone()))
            })
            .collect();
        Ok(Ricalcolo { valori, vecchie })
    })
}

/// Se il valore che il motore ha dato alla formula `key` è quello che la
/// formula ha davvero.
fn calcolabile(prima: &Workbook, dopo: &Workbook, circolari: &HashSet<Key>, key: Key) -> bool {
    let (sheet, at) = key;
    let (Some(before), Some(after)) = (prima.sheet(sheet), dopo.sheet(sheet)) else {
        return false;
    };
    let Some(cell) = after.cell(at) else {
        return false;
    };
    let Some(formula) = cell.formula.as_ref() else {
        // La formula è uscita: non c'è un valore di formula da scrivere.
        return true;
    };
    if formula.array.is_some()
        || formula.dynamic
        || before.spill_ranges.contains_key(&at)
        || after.spill_ranges.contains_key(&at)
        || circolari.contains(&key)
    {
        return false;
    }
    let Some(expr) = formula.expr() else {
        return false;
    };
    if fuori_dalla_cartella(prima, &expr) {
        return false;
    }
    let old = before.value_ref(at).unwrap_or(&Value::Empty);
    match &cell.value {
        Value::Error(error @ (CellError::Name | CellError::Spill)) => {
            matches!(old, Value::Error(was) if was == error)
        }
        Value::Number(number) => number.is_finite(),
        Value::Array(_) => false,
        Value::Empty | Value::Text(_) | Value::Bool(_) | Value::Error(_) => true,
    }
}

/// Se l'espressione legge un foglio che la cartella non ha: un'altra cartella
/// (`[1]Foglio!A1`) o un foglio che non c'è più.
fn fuori_dalla_cartella(workbook: &Workbook, expr: &Expr) -> bool {
    let mut fuori = false;
    expr.walk(&mut |node| {
        if let Expr::Ref(reference) = node {
            let manca = |name: &str| workbook.sheet_index(name).is_none();
            fuori |= match &reference.sheet {
                SheetSel::Current => false,
                SheetSel::Named(name) => manca(name),
                SheetSel::Span(first, last) => manca(first) || manca(last),
            };
        }
    });
    fuori
}

/// Le formule `vecchie` e quelle fra le `toccate` che ne leggono una,
/// direttamente o attraverso altre. Una formula che legge celle scelte mentre
/// calcola (`INDIRECT`, un nome) può leggerne una: con una formula vecchia,
/// anche quella resta vecchia.
fn con_chi_le_legge(
    workbook: &Workbook,
    calc: &Calc,
    dinamiche: &[Key],
    vecchie: Vec<Key>,
    toccate: &HashSet<Key>,
) -> HashSet<Key> {
    let mut seen: HashSet<Key> = vecchie.iter().copied().collect();
    if seen.is_empty() {
        return seen;
    }
    for &key in dinamiche {
        if toccate.contains(&key) {
            seen.insert(key);
        }
    }
    let mut queue: Vec<Key> = seen.iter().copied().collect();
    let mut out = Vec::new();
    while let Some((sheet, at)) = queue.pop() {
        out.clear();
        calc.graph.dependents(sheet, at, &mut out);
        let spilled: Option<RangeRef> = workbook.sheet(sheet).and_then(|model| {
            model.spill_ranges.get(&at).copied().or_else(|| {
                model
                    .cell(at)
                    .and_then(|cell| cell.formula.as_ref())
                    .and_then(|formula| formula.array)
            })
        });
        if let Some(range) = spilled {
            calc.graph.dependents_of_range(sheet, range, &mut out);
        }
        for &key in &out {
            if toccate.contains(&key) && seen.insert(key) {
                queue.push(key);
            }
        }
    }
    seen
}
