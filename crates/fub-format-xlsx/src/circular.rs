//! I riferimenti circolari di una cartella appena letta (IMP-028).
//!
//! La griglia apre i valori salvati senza ricalcolare (patch `0004` di
//! GridCraft), e una formula su un giro di riferimenti è salvata con `0`: lo
//! scrive Excel, e lo scrive il codec di GridCraft al posto di `#CIRC!`.
//! Riaperta, la cella mostrerebbe uno `0` muto. Qui si trovano le formule su
//! un giro, perché la griglia le mostri con l'errore del motore e lo dica.
//!
//! Ogni formula di un giro ha `0` nel file: il giro sta tutto fra quelle, e si
//! cerca soltanto lì (le componenti fortemente connesse di Tarjan, sui
//! riferimenti fra formule con valore `0`). Il lavoro ha un tetto: oltre, la
//! cartella resta com'è, senza avviso, come prima.

use std::collections::HashMap;

use gridcraft_calc::eval::precedents;
use gridcraft_calc::recalc::Key;
use gridcraft_core::Value;
use gridcraft_model::Workbook;

/// Quante celle dei riferimenti si guardano al più, in tutto.
const MAX_VISITS: usize = 2_000_000;

/// Le formule della cartella che stanno su un giro di riferimenti, con il
/// testo della formula. Vuoto con il calcolo iterativo, dove un giro è voluto.
pub(crate) fn circular_formulas(workbook: &Workbook) -> HashMap<Key, String> {
    let mut found = HashMap::new();
    if workbook.calc.iterative {
        return found;
    }
    // Le formule con `0` salvato, ognuna con i suoi riferimenti fra loro.
    let mut index: HashMap<Key, usize> = HashMap::new();
    let mut nodes: Vec<(Key, String)> = Vec::new();
    for (sheet_index, sheet) in workbook.sheets.iter().enumerate() {
        for (at, cell) in sheet.cells.iter() {
            if let Some(formula) = &cell.formula {
                if matches!(cell.value, Value::Number(n) if n == 0.0) {
                    index.insert((sheet_index, at), nodes.len());
                    nodes.push(((sheet_index, at), formula.text.clone()));
                }
            }
        }
    }
    if nodes.is_empty() {
        return found;
    }
    let mut visits = 0usize;
    let mut edges: Vec<Vec<usize>> = Vec::with_capacity(nodes.len());
    for ((sheet_index, at), _) in &nodes {
        let mut out = Vec::new();
        let expr = workbook
            .sheet(*sheet_index)
            .and_then(|sheet| sheet.cell(*at))
            .and_then(|cell| cell.formula.as_ref())
            .and_then(|formula| formula.expr());
        if let Some(expr) = expr {
            for area in precedents(workbook, *sheet_index, &expr).0 {
                let Some(sheet) = workbook.sheet(area.sheet) else {
                    continue;
                };
                for (cell, _) in sheet.cells.iter_range(area.range) {
                    visits += 1;
                    if visits > MAX_VISITS {
                        return found;
                    }
                    if let Some(&to) = index.get(&(area.sheet, cell)) {
                        out.push(to);
                    }
                }
            }
        }
        edges.push(out);
    }
    for component in strongly_connected(&edges) {
        let lone = component.len() == 1;
        for &node in &component {
            // Una formula da sola è un giro se legge la sua cella.
            if lone && !edges[node].contains(&node) {
                continue;
            }
            let (key, text) = &nodes[node];
            found.insert(*key, text.clone());
        }
    }
    found
}

/// Le componenti fortemente connesse di un grafo (Tarjan, senza ricorsione:
/// una catena lunga di riferimenti non consuma la pila).
fn strongly_connected(edges: &[Vec<usize>]) -> Vec<Vec<usize>> {
    const UNSEEN: usize = usize::MAX;
    let count = edges.len();
    let mut order = vec![UNSEEN; count];
    let mut low = vec![0usize; count];
    let mut on_stack = vec![false; count];
    let mut stack: Vec<usize> = Vec::new();
    let mut components = Vec::new();
    let mut next = 0usize;
    // (nodo, prossimo arco da guardare)
    let mut work: Vec<(usize, usize)> = Vec::new();
    for root in 0..count {
        if order[root] != UNSEEN {
            continue;
        }
        work.push((root, 0));
        order[root] = next;
        low[root] = next;
        next += 1;
        stack.push(root);
        on_stack[root] = true;
        while let Some(&mut (node, ref mut edge)) = work.last_mut() {
            if let Some(&to) = edges[node].get(*edge) {
                *edge += 1;
                if order[to] == UNSEEN {
                    order[to] = next;
                    low[to] = next;
                    next += 1;
                    stack.push(to);
                    on_stack[to] = true;
                    work.push((to, 0));
                } else if on_stack[to] {
                    low[node] = low[node].min(order[to]);
                }
                continue;
            }
            work.pop();
            if let Some(&(parent, _)) = work.last() {
                low[parent] = low[parent].min(low[node]);
            }
            if low[node] == order[node] {
                let mut component = Vec::new();
                while let Some(member) = stack.pop() {
                    on_stack[member] = false;
                    component.push(member);
                    if member == node {
                        break;
                    }
                }
                components.push(component);
            }
        }
    }
    components
}

#[cfg(test)]
mod tests {
    use super::strongly_connected;

    #[test]
    fn i_giri_sono_le_componenti_con_piu_nodi_o_un_arco_su_se() {
        // 0 → 1 → 2 → 0, 3 → 3, 4 → 0.
        let edges = vec![vec![1], vec![2], vec![0], vec![3], vec![0]];
        let mut components: Vec<Vec<usize>> = strongly_connected(&edges)
            .into_iter()
            .map(|mut component| {
                component.sort_unstable();
                component
            })
            .collect();
        components.sort();
        assert_eq!(components, vec![vec![0, 1, 2], vec![3], vec![4]]);
    }

    #[test]
    fn una_catena_lunga_non_consuma_la_pila() {
        let edges: Vec<Vec<usize>> = (0..200_000)
            .map(|node| vec![(node + 1) % 200_000])
            .collect();
        let components = strongly_connected(&edges);
        assert_eq!(components.len(), 1);
        assert_eq!(components[0].len(), 200_000);
    }
}
