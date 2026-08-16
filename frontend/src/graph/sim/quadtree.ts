// Quadtree per la repulsione di Barnes-Hut (tier ≥ 2): trasforma il costo
// della repulsione a coppie da O(n²) a O(n·log n) senza cambiare la fisica
// percepita — a distanza grande un gruppo di nodi pesa come il suo centro
// di massa, ed è proprio ciò che l'occhio non distingue. Per tier 1 il
// motore non lo usa: la forza esatta a coppie è più economica sotto i ~400
// nodi.
//
// La struttura è SoA come la `Struttura`: array paralleli per i nodi
// dell'albero (bbox implicita: centro + semi-lato) e un allocatore a
// contatore che riusa gli slot a ogni costruzione. Il pool cresce solo quando
// il grafo cresce: dentro il frame, `costruisci` non alloca mai — è questo il
// contratto col motore, che ricostruisce l'albero a ogni passo.
//
// Le foglie tengono fino a `CAPACITA_FOGLIA` indici; oltre, splittano in 4
// figli a metà cella. I nodi esattamente coincidenti non si separerebbero
// mai, quindi a profondità massima la foglia trabocca in una lista
// concatenata di overflow (difensivo: li separa la griglia di collisione).

import type { Struttura } from "./tipi";

/// Quante foglie con capacità piena servono prima di splittare. 8 è un buon
/// compromesso fra altezza dell'albero (≈ log₄ n) e costo di visita delle
/// foglie: sotto le 8 foglie sono più i nodi che le celle.
export const CAPACITA_FOGLIA = 8;

/// Profondità massima dell'albero. Con celle che si dimezzano, 24 livelli
/// portano il lato minimo a ~1/16M di quello iniziale: per i grafi reali non
/// si raggiunge mai, e il limite esiste solo per fermare lo split dei nodi
/// coincidenti (che altrimenti splittano all'infinito senza separarsi).
export const PROFONDITA_MAX = 24;

/// Tipo della callback di `visita`: riceve la componente della distanza dal
/// punto di query al centro di massa (o al nodo, nelle foglie), la distanza
/// al quadrato e la massa totale della cella. Non deve allocare.
export type FnVisita = (dx: number, dy: number, d2: number, massa: number) => void;

/// La forma che il motore vede: i campi pubblici del pool. `costruisci`
/// riempie un pool e lo restituisce come `Quadtree`; `visita` e `vicino` lo
/// leggono. L'interfaccia non ha metodi: la logica sta nelle funzioni
/// module-level, il pool è solo contenitore riusabile.
export interface Quadtree {
  /// La struttura su cui è stato costruito l'ultimo albero: serve alla
  /// visita per leggere posizioni e masse dei nodi nelle foglie.
  s: Struttura | null;
  // Nodi dell'albero: centro (cx, cy), semi-lato `meta` (bbox implicita),
  // centro di massa cumulato (cmx, cmy) e massa totale. Float64: le celle si
  // dimezzano fino a 2^-24 e il confronto col bordo non deve perdere bit.
  cx: Float64Array;
  cy: Float64Array;
  meta: Float64Array;
  cmx: Float64Array;
  cmy: Float64Array;
  massa: Float64Array;
  /// Figli: 4 slot contigui per nodo, −1 = assente. `figli[4i] ≥ 0` ⟺ interno.
  figli: Int32Array;
  /// Contenuto delle foglie: `CAPACITA_FOGLIA` slot per nodo.
  contenuto: Int32Array;
  nContenuto: Int32Array;
  /// Overflow delle foglie a profondità massima: lista concatenata per nodo.
  ovfTesta: Int32Array;
  ovfProssimo: Int32Array;
  /// Stack riusato dalla DFS di `vicino`.
  stack: Int32Array;
  /// Contatore di allocazione: a ogni costruzione riparte da 0 e gli slot
  /// vecchi vengono sovrascritti in ordine — mai azzerare tutto il pool.
  usati: number;
}

/// Il pool: implementa `Quadtree` e si riusa. I campi sono pubblici ( fanno
/// parte dell'interfaccia); i metodi privati servono solo a `ricostruisci`.
export class PoolQuad implements Quadtree {
  s: Struttura | null = null;
  cx = new Float64Array(0);
  cy = new Float64Array(0);
  meta = new Float64Array(0);
  cmx = new Float64Array(0);
  cmy = new Float64Array(0);
  massa = new Float64Array(0);
  figli = new Int32Array(0);
  contenuto = new Int32Array(0);
  nContenuto = new Int32Array(0);
  ovfTesta = new Int32Array(0);
  ovfProssimo = new Int32Array(0);
  stack = new Int32Array(0);
  usati = 0;

  /// `figli` ha stride 4, quindi la capacità del pool è la sua lunghezza / 4.
  /// Il nome spiega la formula magica (lo stride) che l'espressione inline
  /// nasconderebbe; usata in 3+ punti in lockstep.
  private capacita(): number {
    return this.figli.length / 4;
  }

  /// Allarga tutti gli array (solo nei primi frame o quando il grafo
  /// cresce). Crescita geometrica: poche riallocazioni, nessuna dentro il
  /// frame a regime. Le copie sono esplicite per tipo — niente cast generici.
  private assicura(richiesta: number): void {
    if (richiesta <= this.capacita()) return;
    const nuova = Math.max(16, this.capacita() * 2, richiesta);
    const cx = new Float64Array(nuova);
    cx.set(this.cx);
    this.cx = cx;
    const cy = new Float64Array(nuova);
    cy.set(this.cy);
    this.cy = cy;
    const meta = new Float64Array(nuova);
    meta.set(this.meta);
    this.meta = meta;
    const cmx = new Float64Array(nuova);
    cmx.set(this.cmx);
    this.cmx = cmx;
    const cmy = new Float64Array(nuova);
    cmy.set(this.cmy);
    this.cmy = cmy;
    const massa = new Float64Array(nuova);
    massa.set(this.massa);
    this.massa = massa;
    const figli = new Int32Array(nuova * 4);
    figli.set(this.figli);
    this.figli = figli;
    const contenuto = new Int32Array(nuova * CAPACITA_FOGLIA);
    contenuto.set(this.contenuto);
    this.contenuto = contenuto;
    const nContenuto = new Int32Array(nuova);
    nContenuto.set(this.nContenuto);
    this.nContenuto = nContenuto;
    const ovfTesta = new Int32Array(nuova);
    ovfTesta.set(this.ovfTesta);
    this.ovfTesta = ovfTesta;
    const ovfProssimo = new Int32Array(nuova);
    ovfProssimo.set(this.ovfProssimo);
    this.ovfProssimo = ovfProssimo;
    const stack = new Int32Array(nuova);
    stack.set(this.stack);
    this.stack = stack;
  }

  private nuovoNodo(): number {
    const i = this.usati++;
    if (i >= this.capacita()) this.assicura(i + 16);
    // Slot riusato: azzerare i puntatori è obbligatorio, il resto viene
    // scritto dal chiamante prima dell'uso.
    const b = i * 4;
    this.figli[b] = -1;
    this.figli[b + 1] = -1;
    this.figli[b + 2] = -1;
    this.figli[b + 3] = -1;
    this.nContenuto[i] = 0;
    this.ovfTesta[i] = -1;
    this.massa[i] = 0;
    this.cmx[i] = 0;
    this.cmy[i] = 0;
    return i;
  }

  /// Ricostruisce l'albero sulla struttura. O(n·profondità), zero
  /// allocazioni quando la capacità del pool basta.
  ricostruisci(s: Struttura): void {
    this.s = s;
    this.usati = 0;
    const n = s.n;
    if (n === 0) return;
    this.assicura(n * 2 + 16);
    // Bbox dei punti → radice quadrata centrata. L'epsilon evita s = 0 per
    // nodi tutti coincidenti (in quel caso l'albero degenera in una catena
    // verso il basso, fermata da PROFONDITA_MAX e dall'overflow).
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
    const radice = this.nuovoNodo();
    this.cx[radice] = (minx + maxx) / 2;
    this.cy[radice] = (miny + maxy) / 2;
    this.meta[radice] = Math.max(maxx - minx, maxy - miny) / 2 + 1e-9;
    for (let i = 0; i < n; i++) {
      this.inserisci(radice, i, s.x[i], s.y[i], s.massa[i], 0);
    }
  }

  /// Inserimento ricorsivo: aggiorna il centro di massa lungo il percorso e
  /// scende nel figlio giusto; se la foglia è piena, splitta in 4. L'indice
  /// del figlio è `bit0 = destra (x ≥ cx) | bit1 = sotto (y ≥ cy)`: la stessa
  /// formula in inserisci e visita, così il punto di query scende sempre nel
  /// figlio che contiene il nodo stesso.
  private inserisci(i: number, j: number, x: number, y: number, m: number, prof: number): void {
    this.massa[i] += m;
    this.cmx[i] += m * x;
    this.cmy[i] += m * y;
    if (this.figli[i * 4] >= 0) {
      const k = (x >= this.cx[i] ? 1 : 0) | (y >= this.cy[i] ? 2 : 0);
      this.inserisci(this.figli[i * 4 + k], j, x, y, m, prof + 1);
      return;
    }
    const c = i * CAPACITA_FOGLIA;
    const nc = this.nContenuto[i];
    if (nc < CAPACITA_FOGLIA) {
      this.contenuto[c + nc] = j;
      this.nContenuto[i] = nc + 1;
      return;
    }
    if (prof >= PROFONDITA_MAX) {
      // Nodi coincidenti: la cella non li separa più. Lista di overflow —
      // difensivo, il caso normale non arriva qui.
      this.ovfProssimo[j] = this.ovfTesta[i];
      this.ovfTesta[i] = j;
      return;
    }
    // Split: la foglia diventa interna (massa e centro di massa restano
    // corretti: sono la somma di tutti i discendenti), i 4 figli partono
    // vuoti e ricevono il contenuto esistente più il nuovo nodo.
    const b = i * 4;
    for (let k = 0; k < 4; k++) this.figli[b + k] = this.nuovoNodo();
    // Semi-lato del figlio = metà del padre; i centri sono a ±meta/2 dal
    // centro del padre, così i 4 bbox dei figli coprono esattamente i 4
    // quadranti della cella padre (niente buchi: il pruning di `vicino`
    // non può perdere il nodo più vicino).
    const hsm = this.meta[i] / 2;
    for (let k = 0; k < 4; k++) {
      const f = this.figli[b + k];
      this.cx[f] = this.cx[i] + (k & 1 ? hsm : -hsm);
      this.cy[f] = this.cy[i] + (k & 2 ? hsm : -hsm);
      this.meta[f] = hsm;
    }
    // Ridistribuisce il contenuto esistente: ogni nodo va nel figlio giusto
    // secondo la sua posizione, non in un figlio fisso.
    const s = this.s!;
    for (let k = 0; k < nc; k++) {
      const jj = this.contenuto[c + k];
      const xj = s.x[jj];
      const yj = s.y[jj];
      const kf = (xj >= this.cx[i] ? 1 : 0) | (yj >= this.cy[i] ? 2 : 0);
      this.inserisci(this.figli[b + kf], jj, xj, yj, s.massa[jj], prof + 1);
    }
    const kf = (x >= this.cx[i] ? 1 : 0) | (y >= this.cy[i] ? 2 : 0);
    this.inserisci(this.figli[b + kf], j, x, y, m, prof + 1);
  }
}

/// Costruisce (o ricostruisce) l'albero della struttura dentro il pool
/// riusato. Dopo il primo frame non alloca: è il contratto col motore.
export function costruisci(s: Struttura, pool: PoolQuad): Quadtree {
  pool.ricostruisci(s);
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
export function visita(q: Quadtree, theta: number, x: number, y: number, f: FnVisita): void {
  if (q.usati === 0 || q.s === null) return;
  const t2 = theta * theta;
  visitaNodo(q, 0, t2, x, y, f);
}

function visitaNodo(q: Quadtree, i: number, t2: number, x: number, y: number, f: FnVisita): void {
  const s = q.s!;
  if (q.figli[i * 4] < 0) {
    // Foglia: forza esatta per ogni nodo, tranne il punto di query (la
    // posizione Float32 coincide solo con il nodo stesso; i nodi
    // coincidenti sono esclusi anche loro — li separa la collisione).
    const c = i * CAPACITA_FOGLIA;
    const nc = q.nContenuto[i];
    for (let k = 0; k < nc; k++) {
      const j = q.contenuto[c + k];
      if (s.x[j] === x && s.y[j] === y) continue;
      const dx = s.x[j] - x;
      const dy = s.y[j] - y;
      f(dx, dy, dx * dx + dy * dy, s.massa[j]);
    }
    let o = q.ovfTesta[i];
    while (o >= 0) {
      if (!(s.x[o] === x && s.y[o] === y)) {
        const dx = s.x[o] - x;
        const dy = s.y[o] - y;
        f(dx, dy, dx * dx + dy * dy, s.massa[o]);
      }
      o = q.ovfProssimo[o];
    }
    return;
  }
  // Interno: il figlio che contiene il punto di query si scende sempre;
  // gli altri si approssimano se s/d < theta (in quadrato: s² < theta²·d²).
  const kq = (x >= q.cx[i] ? 1 : 0) | (y >= q.cy[i] ? 2 : 0);
  const b = i * 4;
  for (let k = 0; k < 4; k++) {
    const fk = q.figli[b + k];
    if (fk < 0) continue;
    if (k === kq) {
      visitaNodo(q, fk, t2, x, y, f);
      continue;
    }
    const dx = q.cmx[fk] - x;
    const dy = q.cmy[fk] - y;
    const d2 = dx * dx + dy * dy;
    const sm = q.meta[fk];
    if (sm * sm < t2 * d2) {
      f(dx, dy, d2, q.massa[fk]);
    } else {
      visitaNodo(q, fk, t2, x, y, f);
    }
  }
}

/// Indice del nodo più vicino a (x, y) con distanza ≤ r, −1 se nessuno.
/// Query geometrica pura, per l'hit-test: non esclude il nodo su cui si sta
/// puntando (se (x, y) è la posizione di un nodo, restituisce quello). DFS
/// con pruning per cella: una cella si salta se la sua distanza minima dal
/// punto supera il miglior raggio trovato finora. Deterministico: stessa
/// struttura, stessa risposta.
export function vicino(q: Quadtree, x: number, y: number, r: number): number {
  if (q.usati === 0 || q.s === null || r < 0) return -1;
  const s = q.s;
  const r2 = r * r;
  let migliore = -1;
  let miglioreD2 = r2;
  let sp = 0;
  q.stack[sp++] = 0;
  while (sp > 0) {
    const i = q.stack[--sp];
    const b = i * 4;
    if (q.figli[b] < 0) {
      const c = i * CAPACITA_FOGLIA;
      const nc = q.nContenuto[i];
      for (let k = 0; k < nc; k++) {
        const j = q.contenuto[c + k];
        const dx = s.x[j] - x;
        const dy = s.y[j] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= miglioreD2) {
          miglioreD2 = d2;
          migliore = j;
        }
      }
      let o = q.ovfTesta[i];
      while (o >= 0) {
        const dx = s.x[o] - x;
        const dy = s.y[o] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= miglioreD2) {
          miglioreD2 = d2;
          migliore = o;
        }
        o = q.ovfProssimo[o];
      }
    } else {
      for (let k = 3; k >= 0; k--) {
        const fk = q.figli[b + k];
        if (fk < 0) continue;
        // Distanza minima dal punto alla cella (0 se dentro).
        const ddx = Math.abs(x - q.cx[fk]) - q.meta[fk];
        const ddy = Math.abs(y - q.cy[fk]) - q.meta[fk];
        const dmin2 = (ddx > 0 ? ddx * ddx : 0) + (ddy > 0 ? ddy * ddy : 0);
        if (dmin2 <= miglioreD2) q.stack[sp++] = fk;
      }
    }
  }
  return migliore;
}