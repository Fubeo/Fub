// La griglia dei vicini: celle quadrate in una tabella hash, una lista
// concatenata di nodi per cella, tutto in `Int32Array` riusati fra i passi.
// O(n) atteso per trovare le coppie vicine, invece di O(n²).
//
// Collisioni, spazio personale e distanza dagli archi la riempiono ciascuna
// col suo lato di cella, una dopo l'altra dentro lo stesso passo sincrono:
// basta una griglia per struttura, tenuta in una `WeakMap` perché il
// contratto delle forze non la porta.

import type { Structure } from "./types";

export interface Grid {
  /// Testa della lista di ogni slot della tabella, −1 se vuoto. Potenza di
  /// 2 ≥ 2n.
  head: Int32Array;
  /// Lista concatenata: `next[i]` è il nodo successivo nello stesso slot.
  next: Int32Array;
  /// La cella di ogni nodo: filtra le collisioni di hash.
  cellX: Int32Array;
  cellY: Int32Array;
  size: number;
  mask: number;
  /// Il lato di cella dell'ultimo riempimento.
  cell: number;
}

/// Le celle «avanti» da esaminare per ogni nodo: la sua (solo j < i) più
/// (1,0), (0,1), (1,1), (1,−1). Ogni coppia di celle adiacenti è vista da un
/// lato solo, perché l'offset o il suo opposto è sempre «avanti».
export const FORWARD_CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const grids = new WeakMap<Structure, Grid>();

function createGrid(n: number): Grid {
  let d = 4;
  while (d < 2 * n) d <<= 1;
  return {
    head: new Int32Array(d).fill(-1),
    next: new Int32Array(n),
    cellX: new Int32Array(n),
    cellY: new Int32Array(n),
    size: d,
    mask: d - 1,
    cell: 0,
  };
}

/// La griglia della struttura, abbastanza grande per i suoi nodi.
export function gridOf(s: Structure): Grid {
  let g = grids.get(s);
  if (!g || g.size < 2 * s.n || g.next.length < s.n) {
    g = createGrid(Math.max(s.n, g ? g.next.length : 0));
    grids.set(s, g);
  }
  return g;
}

export function hashCell(g: Grid, cx: number, cy: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & g.mask;
}

/// Svuota la griglia e ci mette ogni nodo nella sua cella di lato `cell`.
export function fillGrid(g: Grid, s: Structure, cell: number): void {
  const head = g.head;
  for (let h = 0; h < g.size; h++) head[h] = -1;
  g.cell = cell;
  for (let i = 0; i < s.n; i++) {
    const cx = Math.floor(s.x[i] / cell);
    const cy = Math.floor(s.y[i] / cell);
    g.cellX[i] = cx;
    g.cellY[i] = cy;
    const h = hashCell(g, cx, cy);
    g.next[i] = head[h];
    head[h] = i;
  }
}
