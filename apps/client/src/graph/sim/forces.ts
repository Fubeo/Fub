// Accumulo delle forze (accelerazioni, vedi nota) e correzioni posizionali di
// collisione. Il motore chiama `accumulateForces` una volta per passo e
// `collisions` subito dopo l'integrazione.
//
// Nota sui nomi: `fx`/`fy` nella `Structure` si chiamano «forza» ma
// contengono **accelerazioni** (per unità di massa). Tutte le formule del
// contratto sono già in forma di accelerazione — `a += repulsion·mj/d²`,
// `a += −gravity·p` — e il motore integra `v += fx·dt` senza dividere per la
// massa. Le molle invece nascono come forza (la rigidità è in N/px) e qui
// vengono divise per la massa del nodo: è l'unico punto in cui la massa
// entra, ed è per questo che un hub pesante accelera piano sotto la molla.

import { visit } from "./quadtree";
import type { Quadtree } from "./quadtree";
import type { PhysicsConfig, Structure, Tier } from "./types";

// ── Stato della callback Barnes-Hut ──────────────────────────────────────
// `accumulateForces` non può passare lo stato per nodo alla callback di `visit`
// senza allocare una closure per ogni nodo. Invece usa questi slot di
// modulo, impostati prima di ogni `visit`: `step` è sincrono e
// single-threaded, quindi non c'è rischio di reentrancy.
let forceStructure: Structure | null = null;
let forceIndex = -1;
let forceRepulsion = 0;

/// Il dt del passo corrente: la molla del puntatore ne ha bisogno per
/// tarare i guadagni (deadbeat: k = 1/dt², c = 1/dt). Il motore la imposta
/// prima di `accumulateForces`; il default 1/60 basta per i test che chiamano
/// `accumulateForces` direttamente senza drag.
let forceDt = 1 / 60;

/// Imposta il dt del passo corrente. Chiamata dal motore prima di
/// `accumulateForces`; esportata perché il contratto di `accumulateForces` non
/// porta il dt (lo gestisce il motore, non la forza).
export function setDt(dt: number): void {
  forceDt = dt;
}

/// Callback per la repulsione Barnes-Hut: riceve (dx, dy, d2, massa) dal
/// quadtree e accumula l'accelerazione sul nodo `indiceForze`. I nodi
/// coincidenti (d2 < 1e-4) si saltano: nel ramo BH non si può applicare
/// l'offset deterministico (la callback non sa quale coppia sia), e i nodi
/// coincidenti vengono separati dalla griglia di collisione.
function bhRepulsion(dx: number, dy: number, d2: number, mass: number): void {
  if (d2 < 1e-4) return;
  const s = forceStructure!;
  // dx,dy puntano dal nodo di query (i) al nodo j (x_j − x_i). La repulsione
  // spinge i LONTANO da j: lungo −(dx,dy), cioè verso (x_i − x_j).
  const f = (forceRepulsion * mass) / (d2 + 64);
  const inv = 1 / Math.sqrt(d2);
  s.fx[forceIndex] -= f * dx * inv;
  s.fy[forceIndex] -= f * dy * inv;
}

/// Azzera `fx`/`fy` e le riempie con repulsione + molle + gravità + molla
/// del puntatore. Per tier 1 (o quadtree assente) la repulsione è esatta
/// O(n²); per tier ≥ 2 usa Barnes-Hut. Zero allocazioni: la callback è una
/// funzione di modulo, non una closure per nodo.
export function accumulateForces(
  s: Structure,
  config: PhysicsConfig,
  q: Quadtree | null,
  tier: Tier,
): void {
  const n = s.n;
  const fx = s.fx;
  const fy = s.fy;
  for (let i = 0; i < n; i++) {
    fx[i] = 0;
    fy[i] = 0;
  }

  // ── Repulsione ────────────────────────────────────────────────────────
  if (q !== null && tier >= 2) {
    forceStructure = s;
    forceRepulsion = config.repulsion;
    for (let i = 0; i < n; i++) {
      forceIndex = i;
      visit(q, config.theta, s.x[i], s.y[i], bhRepulsion);
    }
  } else {
    // O(n²) esatta. Loop j > i con contributo a entrambi: metà del costo,
    // simmetria esatta (le masse uguali danno momento zero al bit).
    for (let i = 0; i < n; i++) {
      const xi = s.x[i];
      const yi = s.y[i];
      for (let j = i + 1; j < n; j++) {
        let dx = s.x[j] - xi;
        let dy = s.y[j] - yi;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) {
          // Nodi coincidenti: offset deterministico dal vecchio codice —
          // separazione monotona, niente jitter casuale, e stabile perché
          // la spinta ha direzione fissa finché restano sovrapposti.
          dx = 0.5 + (i % 3) * 0.1;
          dy = 0.5 - (j % 3) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        const inv = 1 / Math.sqrt(d2);
        // dx,dy = x_j − x_i (da i a j). Repulsione: i si allontana da j
        // (lungo −û), j si allontana da i (lungo +û). La massa del vicino
        // entra: un hub respinge di più.
        const fi = (config.repulsion * s.mass[j]) / (d2 + 64);
        const fj = (config.repulsion * s.mass[i]) / (d2 + 64);
        fx[i] -= fi * dx * inv;
        fy[i] -= fi * dy * inv;
        fx[j] += fj * dx * inv;
        fy[j] += fj * dy * inv;
      }
    }
  }

  // ── Molle con dashpot ─────────────────────────────────────────────────
  const k = config.springStiffness;
  const L0 = config.baseLength;
  const damping = config.springDamping;
  for (let e = 0; e < s.m; e++) {
    const i = s.from[e];
    const j = s.to[e];
    const mi = s.mass[i];
    const mj = s.mass[j];
    let dx = s.x[i] - s.x[j];
    let dy = s.y[i] - s.y[j];
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-9) {
      // Nodi coincidenti legati da un arco: versore indefinito. Offset
      // deterministico (come la repulsione), basato sull'indice dell'arco.
      dx = 0.5 + (e % 3) * 0.1;
      dy = 0.5 - (e % 3) * 0.1;
      d = Math.sqrt(dx * dx + dy * dy);
    }
    const ux = dx / d;
    const uy = dy / d;
    // Lunghezza di riposo effettiva: cresce col grado dei due estremi, così
    // gli hub non si scontrano coi loro vicini. Capped a 8 per non esplodere.
    const l0e = L0 * (1 + 0.15 * Math.min(8, s.degree[i] + s.degree[j]));
    // Velocità relativa lungo l'asse della molla (positiva = si allontana).
    const vrel = (s.vx[i] - s.vx[j]) * ux + (s.vy[i] - s.vy[j]) * uy;
    // Massa ridotta per lo smorzamento: il dashpot è criticamente smorzato
    // sulla massa ridotta, non su quella del singolo nodo.
    const mrid = mi + mj > 0 ? (mi * mj) / (mi + mj) : 0;
    const cd = damping * 2 * Math.sqrt(k * mrid);
    // fmod = k·(d − L0) + c_d·vrel. Forza su i = −fmod·û, su j = +fmod·û.
    // d > L0 → fmod > 0 → a_i = −fmod·û (verso j): attrattiva. ✓
    const fmod = k * (d - l0e) + cd * vrel;
    if (mi > 0) {
      fx[i] -= (fmod * ux) / mi;
      fy[i] -= (fmod * uy) / mi;
    }
    if (mj > 0) {
      fx[j] += (fmod * ux) / mj;
      fy[j] += (fmod * uy) / mj;
    }
  }

  // ── Gravità ───────────────────────────────────────────────────────────
  // Richiamo verso l'origine, per unità di massa. Il nodo trascinato è
  // esentato: la molla del puntatore lo governa.
  const g = config.gravity;
  if (g !== 0) {
    const t = s.dragged;
    for (let i = 0; i < n; i++) {
      if (i === t) continue;
      fx[i] += -g * s.x[i];
      fy[i] += -g * s.y[i];
    }
  }

  // ── Molla del puntatore (drag) ────────────────────────────────────────
  // Deadbeat: k = 1/dt², c = 1/dt. Con Euler semi-implicito il nodo raggiunge
  // il bersaglio in un passo e si ferma al successivo, a ogni dt ≤ 1/30, e
  // l'accelerazione è indipendente dalla massa. Si sovrascrive (non si
  // somma): il drag è un controllo, non una forza fisica — il nodo segue il
  // mouse esattamente, e le collisioni spingono gli altri fuori strada.
  const t = s.dragged;
  if (t >= 0) {
    const kp = 1 / (forceDt * forceDt);
    const cp = 1 / forceDt;
    fx[t] = kp * (s.px[t] - s.x[t]) - cp * s.vx[t];
    fy[t] = kp * (s.py[t] - s.y[t]) - cp * s.vy[t];
  }
}

// ── Collisioni ────────────────────────────────────────────────────────────
// Correzione posizionale su griglia spaziale hash (WeakMap per riusare gli
// array fra frame). O(n) atteso, non O(n²): il contratto `collisions(s, config)`
// non porta il quadtree, quindi la griglia è interna. Due iterazioni: la
// prima separa, la seconda assesta (le posizioni cambiano, quindi la griglia
// si ricostruisce).

/// Raggio massimo possibile: `4 + min(9, sqrt(degree)·1.7)` con grado
/// Uint16 → 13. La cella deve contenere la coppia più grande che collide
/// (d < r_i + r_j + 4 ≤ 30), quindi 2·13 + 4 = 30.
const MAX_RADIUS = 4 + Math.min(9, Math.sqrt(65535) * 1.7);
const CELL_SIZE = 2 * MAX_RADIUS + 4;

interface Grid {
  /// Slot della tabella hash: testa della lista concatenata per bucket, −1
  /// se vuoto. Dimensione potenza di 2 ≥ 2n.
  head: Int32Array;
  /// Lista concatenata: `next[i]` = nodo successivo nello stesso bucket.
  next: Int32Array;
  /// Cella di ogni nodo (per filtrare le collisioni di hash).
  cellX: Int32Array;
  cellY: Int32Array;
  size: number;
  mask: number;
}

const grids = new WeakMap<Structure, Grid>();

function createGrid(n: number): Grid {
  let d = 1;
  while (d < 2 * n) d <<= 1;
  if (d < 4) d = 4;
  return {
    head: new Int32Array(d).fill(-1),
    next: new Int32Array(n),
    cellX: new Int32Array(n),
    cellY: new Int32Array(n),
    size: d,
    mask: d - 1,
  };
}

function ensureGrid(g: Grid, n: number): Grid {
  if (g.size >= 2 * n && g.next.length >= n) return g;
  return createGrid(Math.max(n, g.size));
}

/// Offsets delle celle «avanti» da esaminare per ogni nodo: stessa cella
/// (j < i) più (1,0), (0,1), (1,1), (1,−1). Copertura completa e senza
/// duplicati: ogni coppia è vista da un solo lato (l'offset o il suo
/// opposto è sempre «avanti»).
const CELL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/// Due iterazioni posizionali. I nodi bloccati (fisso 1) e trascinati
/// (fisso 2) non si muovono: fanno da muro, e il nodo libero assorbe tutto
/// l'overlap. La spinta è inversamente proporzionale alla massa (il leggero
/// si muove di più), divisa a metà quando entrambi sono liberi.
export function collisions(s: Structure, config: PhysicsConfig): void {
  if (!config.collisions || s.n < 2) return;
  let g = grids.get(s);
  if (!g) {
    g = createGrid(s.n);
    grids.set(s, g);
  } else {
    g = ensureGrid(g, s.n);
    grids.set(s, g);
  }
  for (let iter = 0; iter < 2; iter++) sweepCollisions(s, g);
}

function sweepCollisions(s: Structure, g: Grid): void {
  const n = s.n;
  const head = g.head;
  // Svuota la tabella: O(dimensione) ≈ O(n).
  for (let h = 0; h < g.size; h++) head[h] = -1;
  // Inserisce ogni nodo nella sua cella.
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(s.x[i] / CELL_SIZE);
    const cy = Math.floor(s.y[i] / CELL_SIZE);
    g.cellX[i] = cx;
    g.cellY[i] = cy;
    const h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & g.mask;
    g.next[i] = head[h];
    head[h] = i;
  }
  // Esamina le coppie: stessa cella (j < i) + 4 celle avanti.
  for (let i = 0; i < n; i++) {
    const cxi = g.cellX[i];
    const cyi = g.cellY[i];
    const ri = s.radius[i];
    const movesI = s.fixed[i] === 0;
    for (let o = 0; o < CELL_OFFSETS.length; o++) {
      const cx = cxi + CELL_OFFSETS[o][0];
      const cy = cyi + CELL_OFFSETS[o][1];
      const h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & g.mask;
      let j = head[h];
      while (j >= 0) {
        // Stessa cella: solo j < i (dedupe). Celle avanti: tutte le j.
        if (o === 0 && j >= i) {
          j = g.next[j];
          continue;
        }
        // Verifica cella esatta (collisioni di hash).
        if (g.cellX[j] !== cx || g.cellY[j] !== cy) {
          j = g.next[j];
          continue;
        }
        resolvePair(s, i, j, ri, movesI);
        j = g.next[j];
      }
    }
  }
}

function resolvePair(
  s: Structure,
  i: number,
  j: number,
  ri: number,
  movesI: boolean,
): void {
  const movesJ = s.fixed[j] === 0;
  if (!movesI && !movesJ) return;
  let dx = s.x[i] - s.x[j];
  let dy = s.y[i] - s.y[j];
  let d = Math.sqrt(dx * dx + dy * dy);
  const overlap = ri + s.radius[j] + 4 - d;
  if (overlap <= 0) return;
  if (d < 1e-9) {
    // Coincidenti: offset deterministico (i, j) per direzione stabile.
    dx = 0.5 + (i % 3) * 0.1;
    dy = 0.5 - (j % 3) * 0.1;
    d = Math.sqrt(dx * dx + dy * dy);
  }
  const ux = dx / d;
  const uy = dy / d;
  const mi = s.mass[i];
  const mj = s.mass[j];
  if (movesI && movesJ) {
    // Entrambi liberi: split a metà, inversamente proporzionale alla massa.
    const tot = mi + mj > 0 ? mi + mj : 1;
    const pushI = (overlap * 0.5 * mj) / tot;
    const pushJ = (overlap * 0.5 * mi) / tot;
    s.x[i] += ux * pushI;
    s.y[i] += uy * pushI;
    s.x[j] -= ux * pushJ;
    s.y[j] -= uy * pushJ;
  } else if (movesI) {
    // j è un muro: i assorbe tutto l'overlap.
    s.x[i] += ux * overlap;
    s.y[i] += uy * overlap;
  } else {
    // i è un muro: j assorbe tutto.
    s.x[j] -= ux * overlap;
    s.y[j] -= uy * overlap;
  }
}