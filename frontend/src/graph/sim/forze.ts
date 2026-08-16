// Accumulo delle forze (accelerazioni, vedi nota) e correzioni posizionali di
// collisione. Il motore chiama `accumulaForze` una volta per passo e
// `collisioni` subito dopo l'integrazione.
//
// Nota sui nomi: `fx`/`fy` nella `Struttura` si chiamano «forza» ma
// contengono **accelerazioni** (per unità di massa). Tutte le formule del
// contratto sono già in forma di accelerazione — `a += repulsione·mj/d²`,
// `a += −gravita·p` — e il motore integra `v += fx·dt` senza dividere per la
// massa. Le molle invece nascono come forza (la rigidità è in N/px) e qui
// vengono divise per la massa del nodo: è l'unico punto in cui la massa
// entra, ed è per questo che un hub pesante accelera piano sotto la molla.

import { visita } from "./quadtree";
import type { Quadtree } from "./quadtree";
import type { ConfFisica, Struttura, Tier } from "./tipi";

// ── Stato della callback Barnes-Hut ──────────────────────────────────────
// `accumulaForze` non può passare lo stato per nodo alla callback di `visita`
// senza allocare una closure per ogni nodo. Invece usa questi slot di
// modulo, impostati prima di ogni `visita`: `passo` è sincrono e
// single-threaded, quindi non c'è rischio di reentrancy.
let sForze: Struttura | null = null;
let indiceForze = -1;
let repulsioneForze = 0;

/// Il dt del passo corrente: la molla del puntatore ne ha bisogno per
/// tarare i guadagni (deadbeat: k = 1/dt², c = 1/dt). Il motore la imposta
/// prima di `accumulaForze`; il default 1/60 basta per i test che chiamano
/// `accumulaForze` direttamente senza drag.
let dtForze = 1 / 60;

/// Imposta il dt del passo corrente. Chiamata dal motore prima di
/// `accumulaForze`; esportata perché il contratto di `accumulaForze` non
/// porta il dt (lo gestisce il motore, non la forza).
export function impostaDt(dt: number): void {
  dtForze = dt;
}

/// Callback per la repulsione Barnes-Hut: riceve (dx, dy, d2, massa) dal
/// quadtree e accumula l'accelerazione sul nodo `indiceForze`. I nodi
/// coincidenti (d2 < 1e-4) si saltano: nel ramo BH non si può applicare
/// l'offset deterministico (la callback non sa quale coppia sia), e i nodi
/// coincidenti vengono separati dalla griglia di collisione.
function repulsioneBH(dx: number, dy: number, d2: number, massa: number): void {
  if (d2 < 1e-4) return;
  const s = sForze!;
  // dx,dy puntano dal nodo di query (i) al nodo j (x_j − x_i). La repulsione
  // spinge i LONTANO da j: lungo −(dx,dy), cioè verso (x_i − x_j).
  const f = (repulsioneForze * massa) / (d2 + 64);
  const inv = 1 / Math.sqrt(d2);
  s.fx[indiceForze] -= f * dx * inv;
  s.fy[indiceForze] -= f * dy * inv;
}

/// Azzera `fx`/`fy` e le riempie con repulsione + molle + gravità + molla
/// del puntatore. Per tier 1 (o quadtree assente) la repulsione è esatta
/// O(n²); per tier ≥ 2 usa Barnes-Hut. Zero allocazioni: la callback è una
/// funzione di modulo, non una closure per nodo.
export function accumulaForze(
  s: Struttura,
  conf: ConfFisica,
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
    sForze = s;
    repulsioneForze = conf.repulsione;
    for (let i = 0; i < n; i++) {
      indiceForze = i;
      visita(q, conf.theta, s.x[i], s.y[i], repulsioneBH);
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
        const fi = (conf.repulsione * s.massa[j]) / (d2 + 64);
        const fj = (conf.repulsione * s.massa[i]) / (d2 + 64);
        fx[i] -= fi * dx * inv;
        fy[i] -= fi * dy * inv;
        fx[j] += fj * dx * inv;
        fy[j] += fj * dy * inv;
      }
    }
  }

  // ── Molle con dashpot ─────────────────────────────────────────────────
  const k = conf.rigiditaMolla;
  const L0 = conf.lunghezzaBase;
  const smorz = conf.smorzamentoMolla;
  for (let e = 0; e < s.m; e++) {
    const i = s.da[e];
    const j = s.a[e];
    const mi = s.massa[i];
    const mj = s.massa[j];
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
    const l0e = L0 * (1 + 0.15 * Math.min(8, s.grado[i] + s.grado[j]));
    // Velocità relativa lungo l'asse della molla (positiva = si allontana).
    const vrel = (s.vx[i] - s.vx[j]) * ux + (s.vy[i] - s.vy[j]) * uy;
    // Massa ridotta per lo smorzamento: il dashpot è criticamente smorzato
    // sulla massa ridotta, non su quella del singolo nodo.
    const mrid = mi + mj > 0 ? (mi * mj) / (mi + mj) : 0;
    const cd = smorz * 2 * Math.sqrt(k * mrid);
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
  const g = conf.gravita;
  if (g !== 0) {
    const t = s.trascinato;
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
  const t = s.trascinato;
  if (t >= 0) {
    const kp = 1 / (dtForze * dtForze);
    const cp = 1 / dtForze;
    fx[t] = kp * (s.px[t] - s.x[t]) - cp * s.vx[t];
    fy[t] = kp * (s.py[t] - s.y[t]) - cp * s.vy[t];
  }
}

// ── Collisioni ────────────────────────────────────────────────────────────
// Correzione posizionale su griglia spaziale hash (WeakMap per riusare gli
// array fra frame). O(n) atteso, non O(n²): il contratto `collisioni(s, conf)`
// non porta il quadtree, quindi la griglia è interna. Due iterazioni: la
// prima separa, la seconda assesta (le posizioni cambiano, quindi la griglia
// si ricostruisce).

/// Raggio massimo possibile: `4 + min(9, sqrt(grado)·1.7)` con grado
/// Uint16 → 13. La cella deve contenere la coppia più grande che collide
/// (d < r_i + r_j + 4 ≤ 30), quindi 2·13 + 4 = 30.
const RAGGIO_MAX = 4 + Math.min(9, Math.sqrt(65535) * 1.7);
const DIM_CELLA = 2 * RAGGIO_MAX + 4;

interface Griglia {
  /// Slot della tabella hash: testa della lista concatenata per bucket, −1
  /// se vuoto. Dimensione potenza di 2 ≥ 2n.
  testa: Int32Array;
  /// Lista concatenata: `prossimo[i]` = nodo successivo nello stesso bucket.
  prossimo: Int32Array;
  /// Cella di ogni nodo (per filtrare le collisioni di hash).
  cellaX: Int32Array;
  cellaY: Int32Array;
  dimensione: number;
  mask: number;
}

const griglie = new WeakMap<Struttura, Griglia>();

function creaGriglia(n: number): Griglia {
  let d = 1;
  while (d < 2 * n) d <<= 1;
  if (d < 4) d = 4;
  return {
    testa: new Int32Array(d).fill(-1),
    prossimo: new Int32Array(n),
    cellaX: new Int32Array(n),
    cellaY: new Int32Array(n),
    dimensione: d,
    mask: d - 1,
  };
}

function assicuraGriglia(g: Griglia, n: number): Griglia {
  if (g.dimensione >= 2 * n && g.prossimo.length >= n) return g;
  return creaGriglia(Math.max(n, g.dimensione));
}

/// Offsets delle celle «avanti» da esaminare per ogni nodo: stessa cella
/// (j < i) più (1,0), (0,1), (1,1), (1,−1). Copertura completa e senza
/// duplicati: ogni coppia è vista da un solo lato (l'offset o il suo
/// opposto è sempre «avanti»).
const OFFSET_CELLE: ReadonlyArray<readonly [number, number]> = [
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
export function collisioni(s: Struttura, conf: ConfFisica): void {
  if (!conf.collisioni || s.n < 2) return;
  let g = griglie.get(s);
  if (!g) {
    g = creaGriglia(s.n);
    griglie.set(s, g);
  } else {
    g = assicuraGriglia(g, s.n);
    griglie.set(s, g);
  }
  for (let iter = 0; iter < 2; iter++) sweepCollisioni(s, g);
}

function sweepCollisioni(s: Struttura, g: Griglia): void {
  const n = s.n;
  const testa = g.testa;
  // Svuota la tabella: O(dimensione) ≈ O(n).
  for (let h = 0; h < g.dimensione; h++) testa[h] = -1;
  // Inserisce ogni nodo nella sua cella.
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(s.x[i] / DIM_CELLA);
    const cy = Math.floor(s.y[i] / DIM_CELLA);
    g.cellaX[i] = cx;
    g.cellaY[i] = cy;
    const h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & g.mask;
    g.prossimo[i] = testa[h];
    testa[h] = i;
  }
  // Esamina le coppie: stessa cella (j < i) + 4 celle avanti.
  for (let i = 0; i < n; i++) {
    const cxi = g.cellaX[i];
    const cyi = g.cellaY[i];
    const ri = s.raggio[i];
    const muoviI = s.fisso[i] === 0;
    for (let o = 0; o < OFFSET_CELLE.length; o++) {
      const cx = cxi + OFFSET_CELLE[o][0];
      const cy = cyi + OFFSET_CELLE[o][1];
      const h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & g.mask;
      let j = testa[h];
      while (j >= 0) {
        // Stessa cella: solo j < i (dedupe). Celle avanti: tutte le j.
        if (o === 0 && j >= i) {
          j = g.prossimo[j];
          continue;
        }
        // Verifica cella esatta (collisioni di hash).
        if (g.cellaX[j] !== cx || g.cellaY[j] !== cy) {
          j = g.prossimo[j];
          continue;
        }
        risolviCoppia(s, i, j, ri, muoviI);
        j = g.prossimo[j];
      }
    }
  }
}

function risolviCoppia(
  s: Struttura,
  i: number,
  j: number,
  ri: number,
  muoviI: boolean,
): void {
  const muoviJ = s.fisso[j] === 0;
  if (!muoviI && !muoviJ) return;
  let dx = s.x[i] - s.x[j];
  let dy = s.y[i] - s.y[j];
  let d = Math.sqrt(dx * dx + dy * dy);
  const overlap = ri + s.raggio[j] + 4 - d;
  if (overlap <= 0) return;
  if (d < 1e-9) {
    // Coincidenti: offset deterministico (i, j) per direzione stabile.
    dx = 0.5 + (i % 3) * 0.1;
    dy = 0.5 - (j % 3) * 0.1;
    d = Math.sqrt(dx * dx + dy * dy);
  }
  const ux = dx / d;
  const uy = dy / d;
  const mi = s.massa[i];
  const mj = s.massa[j];
  if (muoviI && muoviJ) {
    // Entrambi liberi: split a metà, inversamente proporzionale alla massa.
    const tot = mi + mj > 0 ? mi + mj : 1;
    const pushI = (overlap * 0.5 * mj) / tot;
    const pushJ = (overlap * 0.5 * mi) / tot;
    s.x[i] += ux * pushI;
    s.y[i] += uy * pushI;
    s.x[j] -= ux * pushJ;
    s.y[j] -= uy * pushJ;
  } else if (muoviI) {
    // j è un muro: i assorbe tutto l'overlap.
    s.x[i] += ux * overlap;
    s.y[i] += uy * overlap;
  } else {
    // i è un muro: j assorbe tutto.
    s.x[j] -= ux * overlap;
    s.y[j] -= uy * overlap;
  }
}