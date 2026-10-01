// La gelatina: nodi che si allungano e si schiacciano, archi che vibrano come
// elastici pizzicati. È uno strato di sola resa sopra la simulazione: legge le
// velocità della `Structure` e non tocca mai posizioni né velocità, così il
// layout, il determinismo del motore e i suoi test non se ne accorgono.
//
// Ogni nodo porta un oscillatore smorzato della sua deformazione, un tensore a
// traccia nulla (e1, e2): (1, 0) è «allungato in orizzontale», (−1, 0)
// «allungato in verticale», (0, ±1) le diagonali. Il bersaglio è la velocità
// del nodo sullo schermo: in volo il nodo si allunga lungo il moto, e quando la
// velocità cade di colpo — un urto, il rilascio del drag — l'oscillatore
// sottosmorzato supera lo zero, il nodo si schiaccia sulla direzione in cui
// andava e ondeggia. È lo squash & stretch dei cartoni, e nasce da solo.
//
// Ogni arco porta un oscillatore della sua curvatura: il bersaglio è la
// velocità media degli estremi di traverso all'arco, cambiata di segno — il
// centro dell'elastico resta indietro rispetto a chi lo tira — e quando il
// moto si ferma l'arco vibra e si riassesta.
//
// Zero allocazioni dopo `createWobble`: tutto è in `Float32Array` fratelli,
// come la `Structure`.

import type { Structure } from "./types";

export interface Wobble {
  n: number;
  m: number;
  /// Deformazione di ogni nodo e la sua velocità.
  e1: Float32Array;
  e2: Float32Array;
  v1: Float32Array;
  v2: Float32Array;
  /// Velocità di schermo filtrata di ogni nodo: il nodo trascinato ha la
  /// velocità del deadbeat (Δ/dt), che a ogni evento del puntatore salta.
  sx: Float32Array;
  sy: Float32Array;
  /// Curvatura aggiuntiva di ogni arco, in frazione della sua lunghezza, e
  /// la sua velocità.
  bend: Float32Array;
  bendV: Float32Array;
  /// Qualcosa si muove ancora: il grafico tiene acceso il loop.
  moving: boolean;
}

/// Pulsazione e smorzamento dei nodi (≈4 Hz, ζ 0.2): ogni rimbalzo è circa
/// metà del precedente, e in meno di un secondo il nodo è di nuovo tondo.
const NODE_OMEGA = 2 * Math.PI * 4;
const NODE_ZETA = 0.2;
/// Gli archi vibrano un po' più in fretta: un elastico teso, non una gelatina.
const EDGE_OMEGA = 2 * Math.PI * 5;
const EDGE_ZETA = 0.15;
/// La deformazione massima a intensità 1: un nodo lanciato si allunga di un
/// terzo, non diventa un sigaro. La curvatura massima di un arco, in
/// frazione della sua lunghezza.
export const NODE_CAP = 0.4;
export const EDGE_CAP = 0.3;
/// La velocità di schermo (px/s) a cui la deformazione arriva a tre quarti del
/// massimo: un grafo che si distende a qualche decina di px/s resta quasi
/// tondo, un lancio si vede.
const NODE_SPEED = 1500;
const EDGE_SPEED = 1200;
/// Costante di tempo del filtro sulla velocità, in secondi.
const SPEED_TAU = 0.03;
/// Il sotto-passo massimo: la resa è la stessa a 30, 60 o 144 Hz.
const SUBSTEP = 1 / 120;
/// Sotto queste ampiezze (spostamento più velocità/ω) tutto torna a zero e il
/// loop può dormire.
const NODE_REST = 0.004;
const EDGE_REST = 0.002;

export function createWobble(s: Structure): Wobble {
  return {
    n: s.n,
    m: s.m,
    e1: new Float32Array(s.n),
    e2: new Float32Array(s.n),
    v1: new Float32Array(s.n),
    v2: new Float32Array(s.n),
    sx: new Float32Array(s.n),
    sy: new Float32Array(s.n),
    bend: new Float32Array(s.m),
    bendV: new Float32Array(s.m),
    moving: false,
  };
}

/// Riporta tutto a riposo: gelatina spenta o moto ridotto.
export function resetWobble(w: Wobble): void {
  if (!w.moving) return;
  w.e1.fill(0);
  w.e2.fill(0);
  w.v1.fill(0);
  w.v2.fill(0);
  w.sx.fill(0);
  w.sy.fill(0);
  w.bend.fill(0);
  w.bendV.fill(0);
  w.moving = false;
}

/// Avanza la gelatina di `dt` secondi. `intensity` (0..1) scala bersagli e
/// massimi — a 0 tutto torna a riposo —, `scale` porta le velocità di mondo
/// sullo schermo: la deformazione segue la velocità **che si vede**, così un
/// grafo inquadrato da lontano non si allunga per moti che a occhio sono
/// piccoli. È la scala della camera quando la sim ha fatto il passo, 0 quando
/// è ferma: le velocità restano scritte nella struttura anche a loop spento,
/// ma i nodi non si muovono, e la gelatina deve potersi assestare. `edges`
/// spegne gli archi (grafi enormi). Ritorna `true` finché qualcosa si muove.
export function stepWobble(w: Wobble, s: Structure, dt: number, intensity: number, scale: number, edges = true): boolean {
  if (intensity <= 0 || w.n !== s.n || w.m !== s.m) {
    resetWobble(w);
    return false;
  }
  if (!(dt > 0)) return w.moving;
  const substeps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / substeps;
  const follow = 1 - Math.exp(-dt / SPEED_TAU);
  const nodeCap = NODE_CAP * intensity;
  const edgeCap = EDGE_CAP * intensity;
  let moving = false;

  // Nodi: bersaglio dalla velocità di schermo filtrata, poi l'oscillatore.
  for (let i = 0; i < w.n; i++) {
    const sxi = w.sx[i] + (s.vx[i] * scale - w.sx[i]) * follow;
    const syi = w.sy[i] + (s.vy[i] * scale - w.sy[i]) * follow;
    w.sx[i] = sxi;
    w.sy[i] = syi;
    const speed2 = sxi * sxi + syi * syi;
    let t1 = 0;
    let t2 = 0;
    if (speed2 > 1) {
      // (cos 2θ, sin 2θ)·|v| = (vx² − vy², 2·vx·vy)/|v|: l'asse, senza atan2.
      const speed = Math.sqrt(speed2);
      const amount = nodeCap * Math.tanh(speed / NODE_SPEED);
      t1 = (amount * (sxi * sxi - syi * syi)) / speed2;
      t2 = (amount * 2 * sxi * syi) / speed2;
    }
    let e1 = w.e1[i];
    let e2 = w.e2[i];
    let v1 = w.v1[i];
    let v2 = w.v2[i];
    for (let k = 0; k < substeps; k++) {
      v1 += (-NODE_OMEGA * NODE_OMEGA * (e1 - t1) - 2 * NODE_ZETA * NODE_OMEGA * v1) * h;
      v2 += (-NODE_OMEGA * NODE_OMEGA * (e2 - t2) - 2 * NODE_ZETA * NODE_OMEGA * v2) * h;
      e1 += v1 * h;
      e2 += v2 * h;
    }
    const size = Math.abs(e1) + Math.abs(e2) + (Math.abs(v1) + Math.abs(v2)) / NODE_OMEGA + Math.abs(t1) + Math.abs(t2);
    if (size < NODE_REST) {
      e1 = 0;
      e2 = 0;
      v1 = 0;
      v2 = 0;
    } else moving = true;
    w.e1[i] = e1;
    w.e2[i] = e2;
    w.v1[i] = v1;
    w.v2[i] = v2;
  }

  if (!edges) {
    if (w.m > 0) {
      w.bend.fill(0);
      w.bendV.fill(0);
    }
    w.moving = moving;
    return moving;
  }

  // Archi: la velocità media degli estremi di traverso all'arco. La normale è
  // quella del pittore, (−dy, dx)/L: la curvatura si somma alla sua.
  for (let e = 0; e < w.m; e++) {
    const a = s.from[e];
    const b = s.to[e];
    const dx = s.x[b] - s.x[a];
    const dy = s.y[b] - s.y[a];
    const L = Math.sqrt(dx * dx + dy * dy);
    let target = 0;
    if (L > 1e-3) {
      const perp = ((w.sx[a] + w.sx[b]) * -dy + (w.sy[a] + w.sy[b]) * dx) / (2 * L);
      target = -edgeCap * Math.tanh(perp / EDGE_SPEED);
    }
    let bend = w.bend[e];
    let v = w.bendV[e];
    for (let k = 0; k < substeps; k++) {
      v += (-EDGE_OMEGA * EDGE_OMEGA * (bend - target) - 2 * EDGE_ZETA * EDGE_OMEGA * v) * h;
      bend += v * h;
    }
    if (Math.abs(bend) + Math.abs(v) / EDGE_OMEGA + Math.abs(target) < EDGE_REST) {
      bend = 0;
      v = 0;
    } else moving = true;
    w.bend[e] = bend;
    w.bendV[e] = v;
  }
  w.moving = moving;
  return moving;
}

/// Una scossa di gelatina al nodo `i`: allunga per primo lungo `angle`
/// (radianti) di circa `amount`, poi ondeggia. È una spinta alla velocità
/// dell'oscillatore, non un salto della forma: il nodo ci arriva morbido.
/// Presa, pin, apertura, hover e urti la usano con ampiezze diverse.
export function kick(w: Wobble, i: number, amount: number, angle = 0): void {
  if (i < 0 || i >= w.n || amount === 0) return;
  const impulse = amount * NODE_OMEGA * 1.4;
  w.v1[i] += impulse * Math.cos(2 * angle);
  w.v2[i] += impulse * Math.sin(2 * angle);
  w.moving = true;
}

/// La forma di un nodo per il pittore: l'asse di allungamento (radianti) e il
/// fattore lungo l'asse, ≥ 1. Di traverso il pittore usa 1/fattore, così
/// l'area resta quella del nodo. Scrive in `out` (niente allocazioni).
export function deformationOf(w: Wobble, i: number, out: { angle: number; stretch: number }): void {
  const e1 = w.e1[i];
  const e2 = w.e2[i];
  const size = Math.sqrt(e1 * e1 + e2 * e2);
  if (size < 1e-4) {
    out.angle = 0;
    out.stretch = 1;
    return;
  }
  out.angle = Math.atan2(e2, e1) / 2;
  out.stretch = 1 + Math.min(size, 0.6);
}
