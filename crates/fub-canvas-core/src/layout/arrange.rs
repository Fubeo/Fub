//! Allineare, distribuire, griglia, riga, colonna e albero: le posizioni di un
//! gruppo di schede.
//!
//! Sono le regole che la barra di `engine.ts` (`#layoutSelection`) usa già per
//! allineare e distribuire, più quelle che `layout` e l'import useranno per
//! mettere in griglia, in riga, in colonna o ad albero: una volta sola, pure e
//! provate. Ogni funzione dà solo le posizioni, nell'ordine dato, e non tocca la
//! lavagna: a scrivere è chi chiama. Come nel resto del nucleo, niente DOM,
//! niente font, niente orologio, niente caso.

use std::collections::BTreeMap;

use super::{snap, Rect};

/// Lo spazio fra uno strato di un albero e quello dopo: dal fondo della scheda
/// più alta di uno strato alla cima dello strato successivo (in orizzontale,
/// dal bordo destro della più larga alla sinistra del successivo).
const LAYER_GAP: f64 = 96.0;

/// Il lato a cui allineare un gruppo di schede: i sei bottoni della barra.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    /// Il bordo sinistro comune.
    Left,
    /// Il centro orizzontale comune.
    Center,
    /// Il bordo destro comune.
    Right,
    /// Il bordo alto comune.
    Top,
    /// Il centro verticale comune.
    Middle,
    /// Il bordo basso comune.
    Bottom,
}

/// L'asse lungo cui si distribuiscono i centri delle schede.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis {
    /// I centri si distribuiscono da sinistra a destra (`distribute-x`).
    Horizontal,
    /// I centri si distribuiscono dall'alto in basso (`distribute-y`).
    Vertical,
}

/// Il verso di un albero: il lato da cui parte la radice, e verso cui crescono
/// gli strati. Di serie è `Down`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// La radice in alto, gli strati scendono.
    Down,
    /// La radice in basso, gli strati salgono.
    Up,
    /// La radice a sinistra, gli strati vanno a destra.
    Right,
    /// La radice a destra, gli strati vanno a sinistra.
    Left,
}

/// Allinea le schede al lato indicato, come i bottoni di `engine.ts`: il bordo
/// comune è quello più esterno del gruppo, e ogni posizione passa dall'aggancio
/// alla griglia di 8, anche quella già allineata.
///
/// Con meno di due schede non si sposta niente. Dà la posizione `(x, y)` di
/// ogni scheda nell'ordine dato: la coordinata che l'allineamento non tocca
/// resta com'è.
pub fn align(rects: &[Rect], to: Align) -> Vec<(f64, f64)> {
    if rects.len() < 2 {
        return rects.iter().map(|rect| (rect.x, rect.y)).collect();
    }
    let min_x = rects
        .iter()
        .map(|rect| rect.x)
        .fold(f64::INFINITY, f64::min);
    let max_x = rects
        .iter()
        .map(|rect| rect.right())
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = rects
        .iter()
        .map(|rect| rect.y)
        .fold(f64::INFINITY, f64::min);
    let max_y = rects
        .iter()
        .map(|rect| rect.bottom())
        .fold(f64::NEG_INFINITY, f64::max);
    rects
        .iter()
        .map(|rect| match to {
            Align::Left => (snap(min_x), rect.y),
            Align::Center => (snap((min_x + max_x - rect.width) / 2.0), rect.y),
            Align::Right => (snap(max_x - rect.width), rect.y),
            Align::Top => (rect.x, snap(min_y)),
            Align::Middle => (rect.x, snap((min_y + max_y - rect.height) / 2.0)),
            Align::Bottom => (rect.x, snap(max_y - rect.height)),
        })
        .collect()
}

/// Distribuisce le schede lungo un asse, come `distribute-x` e `distribute-y`
/// di `engine.ts`: le due schede estreme restano dove sono, e quelle di mezzo
/// hanno il centro a passi uguali fra i due estremi, agganciato alla griglia.
///
/// Le schede si ordinano per centro (a parità vale l'ordine dato). Con meno di
/// tre schede non si sposta niente. Rettangoli uguali nello stesso punto non si
/// muovono, e nemmeno quelli già in fila a passo uguale su posizioni in griglia.
/// Una posizione fuori griglia viene agganciata, come nella GUI: anche se la fila
/// è già regolare, il passo che ne esce può cadere fuori griglia.
pub fn distribute(rects: &[Rect], axis: Axis) -> Vec<(f64, f64)> {
    let mut positions: Vec<(f64, f64)> = rects.iter().map(|rect| (rect.x, rect.y)).collect();
    if rects.len() < 3 {
        return positions;
    }
    let centre = |rect: &Rect| match axis {
        Axis::Horizontal => rect.x + rect.width / 2.0,
        Axis::Vertical => rect.y + rect.height / 2.0,
    };
    let mut order: Vec<usize> = (0..rects.len()).collect();
    order.sort_by(|&a, &b| centre(&rects[a]).total_cmp(&centre(&rects[b])));
    let start = centre(&rects[order[0]]);
    let end = centre(&rects[order[order.len() - 1]]);
    let steps = (order.len() - 1) as f64;
    for (index, &at) in order.iter().enumerate().skip(1).take(order.len() - 2) {
        let rect = &rects[at];
        let spot = start + (end - start) * index as f64 / steps;
        match axis {
            Axis::Horizontal => positions[at].0 = snap(spot - rect.width / 2.0),
            Axis::Vertical => positions[at].1 = snap(spot - rect.height / 2.0),
        }
    }
    positions
}

/// La griglia di schede di misure `sizes` (larghezza, altezza): `ceil(√n)`
/// colonne, ciascuna larga quanto la sua scheda più larga, ciascuna riga alta
/// quanto la sua più alta, con `gap` fra colonne e fra righe. Le schede si
/// riempiono per righe, da sinistra a destra, e stanno in cima alla propria
/// cella; la prima sta in `origin`. Di serie `gap` vale 24.
pub fn grid(sizes: &[(f64, f64)], gap: f64, origin: (f64, f64)) -> Vec<(f64, f64)> {
    let count = sizes.len();
    let root = count.isqrt();
    let columns = if root * root == count { root } else { root + 1 };
    lattice(sizes, columns, gap, origin)
}

/// Una riga di schede, affiancate nell'ordine dato, tutte in cima alla riga.
/// Di serie `gap` vale 24.
pub fn row(sizes: &[(f64, f64)], gap: f64, origin: (f64, f64)) -> Vec<(f64, f64)> {
    lattice(sizes, sizes.len(), gap, origin)
}

/// Una colonna di schede, una sotto l'altra nell'ordine dato, tutte a sinistra.
/// Di serie `gap` vale 24.
pub fn column(sizes: &[(f64, f64)], gap: f64, origin: (f64, f64)) -> Vec<(f64, f64)> {
    lattice(sizes, 1, gap, origin)
}

/// Le schede in `columns` colonne, riempite per righe. Una colonna è larga
/// quanto la sua scheda più larga, una riga alta quanto la sua più alta.
fn lattice(sizes: &[(f64, f64)], columns: usize, gap: f64, origin: (f64, f64)) -> Vec<(f64, f64)> {
    if sizes.is_empty() || columns == 0 {
        return Vec::new();
    }
    let rows = sizes.len().div_ceil(columns);
    let mut widths = vec![0.0_f64; columns];
    let mut heights = vec![0.0_f64; rows];
    for (index, &(width, height)) in sizes.iter().enumerate() {
        let column = index % columns;
        let row = index / columns;
        widths[column] = widths[column].max(width);
        heights[row] = heights[row].max(height);
    }
    let lefts = running_starts(origin.0, &widths, gap);
    let tops = running_starts(origin.1, &heights, gap);
    (0..sizes.len())
        .map(|index| (lefts[index % columns], tops[index / columns]))
        .collect()
}

/// Dove comincia ciascuna di `lengths`, partendo da `start` e con `gap` fra
/// l'una e la successiva.
fn running_starts(start: f64, lengths: &[f64], gap: f64) -> Vec<f64> {
    let mut at = start;
    lengths
        .iter()
        .map(|&length| {
            let here = at;
            at += length + gap;
            here
        })
        .collect()
}

/// Un albero a strati, con gli archi `edges` (da, a) fra le schede di misure
/// `sizes`. Dà la posizione `(x, y)` di ogni scheda nell'ordine dato, con il
/// rettangolo che le racchiude nell'angolo (0, 0): chi chiama aggiunge l'origine.
///
/// Le radici sono le schede senza arco in arrivo, nell'ordine dato. Un ciclo si
/// spezza sull'arco che torna indietro nella visita in profondità, che parte
/// dalle radici e poi dalle altre schede nell'ordine dato; così uno schema senza
/// radici, come `a→b→c→a`, ha la sua radice. Uno strato è la distanza più lunga
/// da una radice sugli archi rimasti. Un figlio è del primo genitore che lo
/// nomina negli archi rimasti. I figli di un genitore stanno centrati sotto di
/// lui, e i sottoalberi non si sovrappongono: strato per strato, il metodo
/// «tidy». Fra due strati ci sono 96, fra due fratelli `gap` (di serie 24).
/// Gli archi con un estremo fuori dall'elenco, e i cappi, non contano.
pub fn tree(
    sizes: &[(f64, f64)],
    edges: &[(usize, usize)],
    direction: Direction,
    gap: f64,
) -> Vec<(f64, f64)> {
    let count = sizes.len();
    if count == 0 {
        return Vec::new();
    }
    let vertical = matches!(direction, Direction::Down | Direction::Up);
    let flipped = matches!(direction, Direction::Up | Direction::Left);
    // Gli strati crescono lungo l'asse «principale»; i fratelli si mettono in
    // fila sull'altro, che qui chiamiamo «trasversale».
    let (main, cross): (Vec<f64>, Vec<f64>) = sizes
        .iter()
        .map(|&(width, height)| {
            if vertical {
                (height, width)
            } else {
                (width, height)
            }
        })
        .unzip();
    let forest = Forest::new(count, edges);

    // Dalle foglie alla radice: ogni genitore trova i contorni già pronti dei figli.
    let mut contours: Vec<Option<Contour>> = (0..count).map(|_| None).collect();
    let mut offset_in_parent = vec![0.0_f64; count];
    for &node in forest.order.iter().rev() {
        let children = &forest.children[node];
        let contour = if children.is_empty() {
            let mut own = Contour::default();
            own.include(forest.layer[node], 0.0, cross[node]);
            own
        } else {
            let (group, offsets) = place_group(children, &mut contours, &cross, gap);
            let first = offsets.iter().copied().fold(f64::INFINITY, f64::min);
            let last = children
                .iter()
                .zip(&offsets)
                .map(|(&child, &offset)| offset + cross[child])
                .fold(f64::NEG_INFINITY, f64::max);
            let left = (first + last) / 2.0 - cross[node] / 2.0;
            for (&child, &offset) in children.iter().zip(&offsets) {
                offset_in_parent[child] = offset - left;
            }
            let mut own = group.shifted(-left);
            own.include(forest.layer[node], 0.0, cross[node]);
            own
        };
        contours[node] = Some(contour);
    }

    // Le radici si mettono in fila come fratelli, dall'origine.
    let (_, root_offsets) = place_group(&forest.roots, &mut contours, &cross, gap);
    let mut left = vec![0.0_f64; count];
    for (&root, &offset) in forest.roots.iter().zip(&root_offsets) {
        left[root] = offset;
    }
    for &node in &forest.order {
        if let Some(parent) = forest.parent[node] {
            left[node] = left[parent] + offset_in_parent[node];
        }
    }

    // Ogni strato parte dove finisce il precedente, più 96.
    let layers = forest
        .layer
        .iter()
        .copied()
        .max()
        .map_or(0, |deepest| deepest + 1);
    let mut thickest = vec![0.0_f64; layers];
    for (node, &size) in main.iter().enumerate() {
        let layer = forest.layer[node];
        thickest[layer] = thickest[layer].max(size);
    }
    let mut tops = Vec::with_capacity(layers);
    let mut top = 0.0_f64;
    for &thick in &thickest {
        tops.push(top);
        top += thick + LAYER_GAP;
    }

    let mut positions: Vec<(f64, f64)> = (0..count)
        .map(|node| {
            let top = tops[forest.layer[node]];
            let along = if flipped { -(top + main[node]) } else { top };
            if vertical {
                (left[node], along)
            } else {
                (along, left[node])
            }
        })
        .collect();
    let min_x = positions
        .iter()
        .map(|&(x, _)| x)
        .fold(f64::INFINITY, f64::min);
    let min_y = positions
        .iter()
        .map(|&(_, y)| y)
        .fold(f64::INFINITY, f64::min);
    for (x, y) in &mut positions {
        *x -= min_x;
        *y -= min_y;
    }
    positions
}

/// La foresta che gli archi definiscono: il genitore di ogni scheda, i suoi
/// figli, le radici, lo strato e un ordine in cui il genitore viene prima dei figli.
struct Forest {
    /// Il genitore di ogni scheda: quello del primo arco rimasto che la nomina.
    parent: Vec<Option<usize>>,
    /// I figli di ogni scheda, nell'ordine degli archi.
    children: Vec<Vec<usize>>,
    /// Le radici, cioè le schede senza genitore, nell'ordine dato.
    roots: Vec<usize>,
    /// Lo strato di ogni scheda: la distanza più lunga da una radice.
    layer: Vec<usize>,
    /// Tutte le schede, con ogni genitore prima dei suoi figli.
    order: Vec<usize>,
}

impl Forest {
    fn new(count: usize, edges: &[(usize, usize)]) -> Self {
        let edges: Vec<(usize, usize)> = edges
            .iter()
            .copied()
            .filter(|&(from, to)| from < count && to < count)
            .collect();
        let mut outgoing = vec![Vec::new(); count];
        let mut has_incoming = vec![false; count];
        for (index, &(from, to)) in edges.iter().enumerate() {
            outgoing[from].push(index);
            has_incoming[to] = true;
        }
        let kept = kept_edges(count, &edges, &outgoing, &has_incoming);

        let mut parent_edge: Vec<Option<usize>> = vec![None; count];
        for (index, &(_, to)) in edges.iter().enumerate() {
            if kept[index] && parent_edge[to].is_none() {
                parent_edge[to] = Some(index);
            }
        }
        let parent: Vec<Option<usize>> = parent_edge
            .iter()
            .map(|&edge| edge.map(|index| edges[index].0))
            .collect();
        let mut children = vec![Vec::new(); count];
        for (index, &(from, to)) in edges.iter().enumerate() {
            if parent_edge[to] == Some(index) {
                children[from].push(to);
            }
        }
        let roots: Vec<usize> = (0..count).filter(|&node| parent[node].is_none()).collect();

        // Lo strato è il cammino più lungo fino a una scheda, sugli archi
        // rimasti: si visita in ordine topologico (Kahn), e il grafo è senza cicli.
        let mut pending = vec![0_usize; count];
        for (index, &(_, to)) in edges.iter().enumerate() {
            if kept[index] {
                pending[to] += 1;
            }
        }
        let mut layer = vec![0_usize; count];
        let mut ready: Vec<usize> = (0..count).filter(|&node| pending[node] == 0).collect();
        while let Some(node) = ready.pop() {
            for &index in &outgoing[node] {
                if !kept[index] {
                    continue;
                }
                let to = edges[index].1;
                layer[to] = layer[to].max(layer[node] + 1);
                pending[to] = pending[to].saturating_sub(1);
                if pending[to] == 0 {
                    ready.push(to);
                }
            }
        }

        // Visita in profondità anticipata, figli nell'ordine dato: il genitore prima.
        let mut order = Vec::with_capacity(count);
        let mut stack: Vec<usize> = roots.iter().rev().copied().collect();
        while let Some(node) = stack.pop() {
            order.push(node);
            stack.extend(children[node].iter().rev().copied());
        }

        Self {
            parent,
            children,
            roots,
            layer,
            order,
        }
    }
}

/// Quali archi restano, visitando il grafo in profondità: le radici prima, poi
/// le altre schede nell'ordine dato. Un arco verso una scheda ancora aperta
/// nella visita torna indietro, chiude un ciclo, e non resta. Quel che resta non
/// ha cicli.
fn kept_edges(
    count: usize,
    edges: &[(usize, usize)],
    outgoing: &[Vec<usize>],
    has_incoming: &[bool],
) -> Vec<bool> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Visit {
        Fresh,
        Open,
        Done,
    }

    let mut state = vec![Visit::Fresh; count];
    let mut kept = vec![false; edges.len()];
    let starts = (0..count)
        .filter(|&node| !has_incoming[node])
        .chain((0..count).filter(|&node| has_incoming[node]));
    for start in starts {
        if state[start] != Visit::Fresh {
            continue;
        }
        state[start] = Visit::Open;
        // La pila tiene ogni scheda aperta e quanti dei suoi archi ha già guardato.
        let mut stack: Vec<(usize, usize)> = vec![(start, 0)];
        while let Some((node, seen)) = stack.last().copied() {
            let Some(&index) = outgoing[node].get(seen) else {
                state[node] = Visit::Done;
                stack.pop();
                continue;
            };
            if let Some(top) = stack.last_mut() {
                top.1 += 1;
            }
            let to = edges[index].1;
            match state[to] {
                Visit::Fresh => {
                    kept[index] = true;
                    state[to] = Visit::Open;
                    stack.push((to, 0));
                }
                Visit::Open => {}
                Visit::Done => kept[index] = true,
            }
        }
    }
    kept
}

/// Il contorno di un fascio di schede: per ogni strato, dove stanno la scheda
/// più a sinistra e quella più a destra. Ogni misura vera è quella memorizzata
/// più `shift`: così spostare il fascio intero costa un'addizione, e un fascio
/// piccolo si unisce a uno grande senza ricopiarlo.
#[derive(Default)]
struct Contour {
    /// Per strato: il bordo sinistro e il destro, memorizzati senza `shift`.
    layers: BTreeMap<usize, (f64, f64)>,
    /// Quanto va aggiunto a ogni valore memorizzato.
    shift: f64,
}

impl Contour {
    /// Include una scheda dello strato `layer`, con i bordi veri `left` e `right`.
    fn include(&mut self, layer: usize, left: f64, right: f64) {
        let (left, right) = (left - self.shift, right - self.shift);
        self.layers
            .entry(layer)
            .and_modify(|span| {
                span.0 = span.0.min(left);
                span.1 = span.1.max(right);
            })
            .or_insert((left, right));
    }

    /// Lo stesso fascio, spostato di `delta`.
    fn shifted(mut self, delta: f64) -> Self {
        self.shift += delta;
        self
    }

    /// Quanto va spostato a destra `other`, dal suo bordo sinistro, perché nessuno
    /// strato in comune con `self` si tocchi a meno di `gap`. `None` se non
    /// hanno strati in comune.
    fn clearance(&self, other: &Contour, gap: f64) -> Option<f64> {
        let mut needed: Option<f64> = None;
        if self.layers.len() <= other.layers.len() {
            for (layer, &(_, right)) in &self.layers {
                if let Some(&(left, _)) = other.layers.get(layer) {
                    needed = Some(largest(needed, right + self.shift - (left + other.shift)));
                }
            }
        } else {
            for (layer, &(left, _)) in &other.layers {
                if let Some(&(_, right)) = self.layers.get(layer) {
                    needed = Some(largest(needed, right + self.shift - (left + other.shift)));
                }
            }
        }
        needed.map(|distance| distance + gap)
    }

    /// Il fascio `self` con `other` accanto, spostato di `offset`: negli strati in
    /// comune vince il bordo più esterno. Tiene la memoria del fascio più grande,
    /// così il costo è quello del più piccolo.
    fn absorb(self, other: Contour, offset: f64) -> Contour {
        let (mut base, small, small_offset) = if self.layers.len() >= other.layers.len() {
            (self, other, offset)
        } else {
            (other.shifted(offset), self, 0.0)
        };
        let moved = small.shift + small_offset;
        for (&layer, &(left, right)) in &small.layers {
            base.include(layer, left + moved, right + moved);
        }
        base
    }
}

/// Il più grande fra un valore già visto (se c'è) e uno nuovo.
fn largest(seen: Option<f64>, value: f64) -> f64 {
    seen.map_or(value, |best| best.max(value))
}

/// Mette in fila `group` (figli di uno stesso genitore, o le radici) da sinistra
/// a destra. Dà il contorno del fascio intero, e il bordo sinistro di ogni
/// scheda nel fascio, con la prima a 0.
///
/// Ogni scheda sta a destra della precedente di almeno `gap`, e a `gap` da
/// tutto ciò che è già messo e ha uno strato in comune con lei: così i
/// sottoalberi non si sovrappongono. Chi ha già preso il suo contorno lo lascia
/// (`take`): ogni contorno si usa una volta sola.
fn place_group(
    group: &[usize],
    contours: &mut [Option<Contour>],
    cross: &[f64],
    gap: f64,
) -> (Contour, Vec<f64>) {
    let mut offsets = Vec::with_capacity(group.len());
    let mut joined: Option<Contour> = None;
    // Il bordo sinistro e la larghezza della scheda messa per ultima.
    let mut previous = (0.0_f64, 0.0_f64);
    for &node in group {
        let contour = contours[node].take().unwrap_or_default();
        let offset = match &joined {
            None => 0.0,
            Some(so_far) => {
                let beside = previous.0 + previous.1 + gap;
                match so_far.clearance(&contour, gap) {
                    Some(clear) => clear.max(beside),
                    None => beside,
                }
            }
        };
        joined = Some(match joined {
            None => contour,
            Some(so_far) => so_far.absorb(contour, offset),
        });
        offsets.push(offset);
        previous = (offset, cross[node]);
    }
    (joined.unwrap_or_default(), offsets)
}
