// Quadtree per la repulsione di Barnes-Hut (tier ≥ 2): trasforma il costo
// della repulsione a coppie da O(n²) a O(n·log n) senza cambiare la fisica
// percepita — a distanza grande un gruppo di nodi pesa come il suo centro
// di massa, ed è proprio ciò che l'occhio non distingue. Per tier 1 il
// motore non lo usa: la forza esatta a coppie è più economica sotto i ~400
// nodi.
//
// La struttura è SoA come la `Structure`: array paralleli per i nodi
// dell'albero (bbox implicita: centro + semi-lato) e un allocatore a
// contatore che riusa gli slot a ogni costruzione. Il pool cresce solo quando
// il grafo cresce: dentro il frame, `build` non alloca mai — è questo il
// contratto col motore, che ricostruisce l'albero a ogni passo.
//
// Le foglie tengono fino a `LEAF_CAPACITY` indici; oltre, splittano in 4
// figli a metà cella. I nodi esattamente coincidenti non si separerebbero
// mai, quindi a profondità massima la foglia trabocca in una lista
// concatenata di overflow (difensivo: li separa la griglia di collisione).

import type { Structure } from "./types";

/// Quante foglie con capacità piena servono prima di splittare. 8 è un buon
/// compromesso fra altezza dell'albero (≈ log₄ n) e costo di visita delle
/// foglie: sotto le 8 foglie sono più i nodi che le celle.
export const LEAF_CAPACITY = 8;

/// Profondità massima dell'albero. Con celle che si dimezzano, 24 livelli
/// portano il lato minimo a ~1/16M di quello iniziale: per i grafi reali non
/// si raggiunge mai, e il limite esiste solo per fermare lo split dei nodi
/// coincidenti (che altrimenti splittano all'infinito senza separarsi).
export const MAX_DEPTH = 24;

/// Tipo della callback di `visit`: riceve la componente della distanza dal
/// punto di query al centro di massa (o al nodo, nelle foglie), la distanza
/// al quadrato e la massa totale della cella. Non deve allocare.
export type VisitFn = (dx: number, dy: number, d2: number, mass: number) => void;

/// La forma che il motore vede: i campi pubblici del pool. `build`
/// riempie un pool e lo restituisce come `Quadtree`; `visit` e `nearest` lo
/// leggono. L'interfaccia non ha metodi: la logica sta nelle funzioni
/// module-level, il pool è solo contenitore riusabile.
export interface Quadtree {
  /// La struttura su cui è stato costruito l'ultimo albero: serve alla
  /// La `visit` per leggere posizioni e masse dei nodi nelle foglie.
  s: Structure | null;
  // Nodi dell'albero: centro (cx, cy), semi-lato `meta` (bbox implicita),
  // centro di massa cumulato (cmx, cmy) e massa totale. Float64: le celle si
  // dimezzano fino a 2^-24 e il confronto col bordo non deve perdere bit.
  cx: Float64Array;
  cy: Float64Array;
  halfSize: Float64Array;
  cmx: Float64Array;
  cmy: Float64Array;
  mass: Float64Array;
  /// Figli: 4 slot contigui per nodo, −1 = assente. `children[4i] ≥ 0` ⟺ interno.
  children: Int32Array;
  /// Contenuto delle foglie: `LEAF_CAPACITY` slot per nodo.
  contents: Int32Array;
  contentCount: Int32Array;
  /// Overflow delle foglie a profondità massima: lista concatenata per nodo.
  overflowHead: Int32Array;
  overflowNext: Int32Array;
  /// Stack riusato dalla DFS di `nearest`.
  stack: Int32Array;
  /// Contatore di allocazione: a ogni costruzione riparte da 0 e gli slot
  /// vecchi vengono sovrascritti in ordine — mai azzerare tutto il pool.
  used: number;
}

/// Il pool: implementa `Quadtree` e si riusa. I campi sono pubblici ( fanno
/// parte dell'interfaccia); i metodi privati servono solo a `rebuild`.
export class QuadtreePool implements Quadtree {
  s: Structure | null = null;
  cx = new Float64Array(0);
  cy = new Float64Array(0);
  halfSize = new Float64Array(0);
  cmx = new Float64Array(0);
  cmy = new Float64Array(0);
  mass = new Float64Array(0);
  children = new Int32Array(0);
  contents = new Int32Array(0);
  contentCount = new Int32Array(0);
  overflowHead = new Int32Array(0);
  overflowNext = new Int32Array(0);
  stack = new Int32Array(0);
  used = 0;

  /// `children` ha stride 4, quindi la capacità del pool è la sua lunghezza / 4.
  /// Il nome spiega la formula magica (lo stride) che l'espressione inline
  /// nasconderebbe; usata in 3+ punti in lockstep.
  private capacity(): number {
    return this.children.length / 4;
  }

  /// Allarga tutti gli array (solo nei primi frame o quando il grafo
  /// cresce). Crescita geometrica: poche riallocazioni, nessuna dentro il
  /// frame a regime. Le copie sono esplicite per tipo — niente cast generici.
  private ensureCapacity(requested: number): void {
    if (requested <= this.capacity()) return;
    const newCapacity = Math.max(16, this.capacity() * 2, requested);
    const cx = new Float64Array(newCapacity);
    cx.set(this.cx);
    this.cx = cx;
    const cy = new Float64Array(newCapacity);
    cy.set(this.cy);
    this.cy = cy;
    const halfSize = new Float64Array(newCapacity);
    halfSize.set(this.halfSize);
    this.halfSize = halfSize;
    const cmx = new Float64Array(newCapacity);
    cmx.set(this.cmx);
    this.cmx = cmx;
    const cmy = new Float64Array(newCapacity);
    cmy.set(this.cmy);
    this.cmy = cmy;
    const mass = new Float64Array(newCapacity);
    mass.set(this.mass);
    this.mass = mass;
    const children = new Int32Array(newCapacity * 4);
    children.set(this.children);
    this.children = children;
    const contents = new Int32Array(newCapacity * LEAF_CAPACITY);
    contents.set(this.contents);
    this.contents = contents;
    const contentCount = new Int32Array(newCapacity);
    contentCount.set(this.contentCount);
    this.contentCount = contentCount;
    const overflowHead = new Int32Array(newCapacity);
    overflowHead.set(this.overflowHead);
    this.overflowHead = overflowHead;
    const overflowNext = new Int32Array(newCapacity);
    overflowNext.set(this.overflowNext);
    this.overflowNext = overflowNext;
    const stack = new Int32Array(newCapacity);
    stack.set(this.stack);
    this.stack = stack;
  }

  private newNode(): number {
    const i = this.used++;
    if (i >= this.capacity()) this.ensureCapacity(i + 16);
    // Slot riusato: azzerare i puntatori è obbligatorio, il resto viene
    // scritto dal chiamante prima dell'uso.
    const b = i * 4;
    this.children[b] = -1;
    this.children[b + 1] = -1;
    this.children[b + 2] = -1;
    this.children[b + 3] = -1;
    this.contentCount[i] = 0;
    this.overflowHead[i] = -1;
    this.mass[i] = 0;
    this.cmx[i] = 0;
    this.cmy[i] = 0;
    return i;
  }

  /// Ricostruisce l'albero sulla struttura. O(n·profondità), zero
  /// allocazioni quando la capacità del pool basta.
  rebuild(s: Structure): void {
    this.s = s;
    this.used = 0;
    const n = s.n;
    if (n === 0) return;
    this.ensureCapacity(n * 2 + 16);
    // Bbox dei punti → radice quadrata centrata. L'epsilon evita s = 0 per
    // nodi tutti coincidenti (in quel caso l'albero degenera in una catena
    // verso il basso, fermata da MAX_DEPTH e dall'overflow).
    let minx = s.x[0];
    let maxx = s.x[0];
    let miny = s.y[0];
    let maxy = s.y[0];
    for (let i = 1; i < n; i++) {
      const x = s.x[i];
      const y = s.y[i];
      if (x < minx) minx = x;
      else if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      else if (y > maxy) maxy = y;
    }
    const root = this.newNode();
    this.cx[root] = (minx + maxx) / 2;
    this.cy[root] = (miny + maxy) / 2;
    this.halfSize[root] = Math.max(maxx - minx, maxy - miny) / 2 + 1e-9;
    for (let i = 0; i < n; i++) {
      this.insert(root, i, s.x[i], s.y[i], s.mass[i], 0);
    }
  }

  /// Inserimento ricorsivo: aggiorna il centro di massa lungo il percorso e
  /// scende nel figlio giusto; se la foglia è piena, splitta in 4. L'indice
  /// del figlio è `bit0 = destra (x ≥ cx) | bit1 = sotto (y ≥ cy)`: la stessa
  /// formula in `insert` e `visit`, così il punto di query scende sempre nel
  /// figlio che contiene il nodo stesso.
  private insert(i: number, j: number, x: number, y: number, m: number, depth: number): void {
    this.mass[i] += m;
    this.cmx[i] += m * x;
    this.cmy[i] += m * y;
    if (this.children[i * 4] >= 0) {
      const k = (x >= this.cx[i] ? 1 : 0) | (y >= this.cy[i] ? 2 : 0);
      this.insert(this.children[i * 4 + k], j, x, y, m, depth + 1);
      return;
    }
    const c = i * LEAF_CAPACITY;
    const nc = this.contentCount[i];
    if (nc < LEAF_CAPACITY) {
      this.contents[c + nc] = j;
      this.contentCount[i] = nc + 1;
      return;
    }
    if (depth >= MAX_DEPTH) {
      // Nodi coincidenti: la cella non li separa più. Lista di overflow —
      // difensivo, il caso normale non arriva qui.
      this.overflowNext[j] = this.overflowHead[i];
      this.overflowHead[i] = j;
      return;
    }
    // Split: la foglia diventa interna (massa e centro di massa restano
    // corretti: sono la somma di tutti i discendenti), i 4 figli partono
    // vuoti e ricevono il contenuto esistente più il nuovo nodo.
    const b = i * 4;
    for (let k = 0; k < 4; k++) this.children[b + k] = this.newNode();
    // Semi-lato del figlio = metà del padre; i centri sono a ±meta/2 dal
    // centro del padre, così i 4 bbox dei figli coprono esattamente i 4
    // quadranti della cella padre (niente buchi: il pruning di `nearest`
    // non può perdere il nodo più vicino).
    const hsm = this.halfSize[i] / 2;
    for (let k = 0; k < 4; k++) {
      const f = this.children[b + k];
      this.cx[f] = this.cx[i] + (k & 1 ? hsm : -hsm);
      this.cy[f] = this.cy[i] + (k & 2 ? hsm : -hsm);
      this.halfSize[f] = hsm;
    }
    // Ridistribuisce il contenuto esistente: ogni nodo va nel figlio giusto
    // secondo la sua posizione, non in un figlio fisso.
    const s = this.s!;
    for (let k = 0; k < nc; k++) {
      const jj = this.contents[c + k];
      const xj = s.x[jj];
      const yj = s.y[jj];
      const kf = (xj >= this.cx[i] ? 1 : 0) | (yj >= this.cy[i] ? 2 : 0);
      this.insert(this.children[b + kf], jj, xj, yj, s.mass[jj], depth + 1);
    }
    const kf = (x >= this.cx[i] ? 1 : 0) | (y >= this.cy[i] ? 2 : 0);
    this.insert(this.children[b + kf], j, x, y, m, depth + 1);
  }
}

/// Costruisce (o ricostruisce) l'albero della struttura dentro il pool
/// riusato. Dopo il primo frame non alloca: è il contratto col motore.
export function build(s: Structure, pool: QuadtreePool): Quadtree {
  pool.rebuild(s);
  return pool;
}

/// Visita l'albero col criterio di apertura di Barnes-Hut. Per ogni cella
/// vista dal punto (x, y): se il suo semi-lato s soddisfa s/d < theta con
/// d = distanza al centro di massa, chiama `f` una volta sola con massa
/// totale e centro di massa della cella; altrimenti scende nei figli. Il
/// figlio che contiene (x, y) si scende **sempre**: approssimarlo
/// includerebbe il nodo stesso nella sua repulsione. Nelle foglie `f`
/// riceve (dx, dy, d2, massa) per ogni nodo, tranne quello con posizione
/// esattamente uguale a (x, y) — è il nodo su cui si sta calcolando la
/// forza. Con theta → 0 si scende sempre: il risultato replica l'O(n²).
export function visit(q: Quadtree, theta: number, x: number, y: number, f: VisitFn): void {
  if (q.used === 0 || q.s === null) return;
  const t2 = theta * theta;
  visitNode(q, 0, t2, x, y, f);
}

function visitNode(q: Quadtree, i: number, t2: number, x: number, y: number, f: VisitFn): void {
  const s = q.s!;
  if (q.children[i * 4] < 0) {
    // Foglia: forza esatta per ogni nodo, tranne il punto di query (la
    // posizione Float32 coincide solo con il nodo stesso; i nodi
    // coincidenti sono esclusi anche loro — li separa la collisione).
    const c = i * LEAF_CAPACITY;
    const nc = q.contentCount[i];
    for (let k = 0; k < nc; k++) {
      const j = q.contents[c + k];
      if (s.x[j] === x && s.y[j] === y) continue;
      const dx = s.x[j] - x;
      const dy = s.y[j] - y;
      f(dx, dy, dx * dx + dy * dy, s.mass[j]);
    }
    let o = q.overflowHead[i];
    while (o >= 0) {
      if (!(s.x[o] === x && s.y[o] === y)) {
        const dx = s.x[o] - x;
        const dy = s.y[o] - y;
        f(dx, dy, dx * dx + dy * dy, s.mass[o]);
      }
      o = q.overflowNext[o];
    }
    return;
  }
  // Interno: il figlio che contiene il punto di query si scende sempre;
  // gli altri si approssimano se s/d < theta (in quadrato: s² < theta²·d²).
  const kq = (x >= q.cx[i] ? 1 : 0) | (y >= q.cy[i] ? 2 : 0);
  const b = i * 4;
  for (let k = 0; k < 4; k++) {
    const fk = q.children[b + k];
    if (fk < 0) continue;
    if (k === kq) {
      visitNode(q, fk, t2, x, y, f);
      continue;
    }
    const dx = q.cmx[fk] - x;
    const dy = q.cmy[fk] - y;
    const d2 = dx * dx + dy * dy;
    const sm = q.halfSize[fk];
    if (sm * sm < t2 * d2) {
      f(dx, dy, d2, q.mass[fk]);
    } else {
      visitNode(q, fk, t2, x, y, f);
    }
  }
}

/// Indice del nodo più vicino a (x, y) con distanza ≤ r, −1 se nessuno.
/// Query geometrica pura, per l'hit-test: non esclude il nodo su cui si sta
/// puntando (se (x, y) è la posizione di un nodo, restituisce quello). DFS
/// con pruning per cella: una cella si salta se la sua distanza minima dal
/// punto supera il miglior raggio trovato finora. Deterministico: stessa
/// struttura, stessa risposta.
export function nearest(q: Quadtree, x: number, y: number, r: number): number {
  if (q.used === 0 || q.s === null || r < 0) return -1;
  const s = q.s;
  const r2 = r * r;
  let best = -1;
  let bestD2 = r2;
  let sp = 0;
  q.stack[sp++] = 0;
  while (sp > 0) {
    const i = q.stack[--sp];
    const b = i * 4;
    if (q.children[b] < 0) {
      const c = i * LEAF_CAPACITY;
      const nc = q.contentCount[i];
      for (let k = 0; k < nc; k++) {
        const j = q.contents[c + k];
        const dx = s.x[j] - x;
        const dy = s.y[j] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = j;
        }
      }
      let o = q.overflowHead[i];
      while (o >= 0) {
        const dx = s.x[o] - x;
        const dy = s.y[o] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = o;
        }
        o = q.overflowNext[o];
      }
    } else {
      for (let k = 3; k >= 0; k--) {
        const fk = q.children[b + k];
        if (fk < 0) continue;
        // Distanza minima dal punto alla cella (0 se dentro).
        const ddx = Math.abs(x - q.cx[fk]) - q.halfSize[fk];
        const ddy = Math.abs(y - q.cy[fk]) - q.halfSize[fk];
        const dmin2 = (ddx > 0 ? ddx * ddx : 0) + (ddy > 0 ? ddy * ddy : 0);
        if (dmin2 <= bestD2) q.stack[sp++] = fk;
      }
    }
  }
  return best;
}