// L'adattamento di cubiche a una fila di punti coi minimi quadrati di
// Schneider («An Algorithm for Automatically Fitting Digitized Curves»,
// Graphics Gems, 1990): la spina di un tratto a penna e «Semplifica», al
// livello Esperto. Senza DOM.
//
// - **Una cubica per una fila di punti**, coi versi ai capi dati e le
//   maniglie lunghe quanto i minimi quadrati chiedono per i parametri dei
//   punti, che il metodo di Newton avvicina alla curva.
// - **Dove una non basta**, la fila si divide nel punto più lontano, e le due
//   cubiche vi passano lisce, nel verso della fila lì.
// - **Il verso della fila** in un punto si legge fra i punti lontani una
//   distanza data prima e dopo: il tremolio della mano, o il rumore di un
//   tracciato, non lo cambia.

import type { Curve } from "../scene/curves";
import type { Point } from "../scene/matrix";

/// Quanti punti si guardano, al più, per sapere dove va la fila.
export const AWAY_SAMPLES = 512;

/// Le prove di Newton dei parametri, prima di dividere un pezzo.
export const REFINE_ROUNDS = 4;

/// Quanto si scostano dai punti, in media quadratica, le cubiche rifinite,
/// al più, in tolleranze: una cubica che resta tutta da una parte, anche
/// entro la tolleranza, ingrassa o assottiglia un tratto.
export const SPREAD = 0.5;

type Cubic = Extract<Curve, { readonly kind: "cubic" }>;

const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/// Il verso, lungo 1, di `a`; `null` se `a` è nullo.
export function unit(a: Point): Point | null {
  const l = Math.hypot(a[0], a[1]);
  return l > 0 && Number.isFinite(l) ? [a[0] / l, a[1] / l] : null;
}

/// La lunghezza della spezzata `points` fino a ogni punto.
export function cumulative(points: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + distance(points[i - 1]!, points[i]!));
  return out;
}

/// Il primo punto dopo `at` nel verso `step`, fino a `end`, lontano almeno
/// `reach` da lui in linea d'aria: il tremolio della mano allunga il tratto
/// senza portarlo da nessuna parte. Se il tratto finisce prima, `end`
/// quando è lontano almeno metà; altrimenti, o dopo [`AWAY_SAMPLES`]
/// campioni, `null`.
export function away(points: readonly Point[], at: number, step: 1 | -1, end: number, reach: number): number | null {
  let m = at;
  for (let count = 0; m !== end && count < AWAY_SAMPLES; count++) {
    m += step;
    if (distance(points[m]!, points[at]!) >= reach) return m;
  }
  return m === end && distance(points[end]!, points[at]!) >= reach / 2 ? end : null;
}

/// Il verso in cui il tratto passa per il capo `from` del pezzo che va fino
/// a `to`: verso il primo punto lontano almeno `reach`, o verso l'altro capo.
export function endDirection(points: readonly Point[], from: number, to: number, reach: number): Point {
  const step = to > from ? 1 : -1;
  const k = away(points, from, step, to, reach) ?? to;
  const toward = unit(minus(points[k]!, points[from]!)) ?? unit(minus(points[to]!, points[from]!)) ?? [1, 0];
  return step > 0 ? toward : times(toward, -1);
}

/// Il verso in cui il tratto passa per il punto `at`, dentro il pezzo da
/// `first` a `last`: da un punto lontano `reach` prima a uno dopo.
export function throughDirection(points: readonly Point[], at: number, first: number, last: number, reach: number): Point {
  const a = away(points, at, -1, first, reach) ?? first;
  const b = away(points, at, 1, last, reach) ?? last;
  return unit(minus(points[b]!, points[a]!)) ?? unit(minus(points[last]!, points[first]!)) ?? [1, 0];
}

/// La cubica da `points[first]` a `points[last]` che parte nel verso `t1` e
/// arriva nel verso `t2`, con le maniglie lunghe quanto i minimi quadrati
/// chiedono per i parametri `u`. Una maniglia che verrebbe nulla o rovescia
/// diventa un terzo della corda, come in Schneider.
function generate(points: readonly Point[], first: number, last: number, u: readonly number[], t1: Point, t2: Point): Cubic {
  const from = points[first]!;
  const to = points[last]!;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  let x1 = 0;
  let x2 = 0;
  // Coi numeri uno per uno, senza vettori: è il ciclo che costa.
  for (let i = first; i <= last; i++) {
    const t = u[i - first]!;
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    const a1x = t1[0] * b1;
    const a1y = t1[1] * b1;
    const a2x = t2[0] * -b2;
    const a2y = t2[1] * -b2;
    const p = points[i]!;
    const rx = p[0] - (from[0] * (b0 + b1) + to[0] * (b2 + b3));
    const ry = p[1] - (from[1] * (b0 + b1) + to[1] * (b2 + b3));
    c11 += a1x * a1x + a1y * a1y;
    c12 += a1x * a2x + a1y * a2y;
    c22 += a2x * a2x + a2y * a2y;
    x1 += a1x * rx + a1y * ry;
    x2 += a2x * rx + a2y * ry;
  }
  const chord = distance(from, to);
  const det = c11 * c22 - c12 * c12;
  let l1 = Math.abs(det) < 1e-12 ? 0 : (x1 * c22 - x2 * c12) / det;
  let l2 = Math.abs(det) < 1e-12 ? 0 : (c11 * x2 - c12 * x1) / det;
  const floor = chord * 1e-6;
  if (!(l1 > floor) || !(l2 > floor)) l1 = l2 = chord / 3;
  return { kind: "cubic", c1: plus(from, times(t1, l1)), c2: minus(to, times(t2, l2)), to };
}

/// Il parametro di `p` sulla cubica, un passo di Newton più vicino.
export function closer(from: Point, curve: Cubic, p: Point, t: number): number {
  const { c1, c2, to } = curve;
  const s = 1 - t;
  const b0 = s * s * s;
  const b1 = 3 * s * s * t;
  const b2 = 3 * s * t * t;
  const b3 = t * t * t;
  const dx = b0 * from[0] + b1 * c1[0] + b2 * c2[0] + b3 * to[0] - p[0];
  const dy = b0 * from[1] + b1 * c1[1] + b2 * c2[1] + b3 * to[1] - p[1];
  const e0 = 3 * s * s;
  const e1 = 6 * s * t;
  const e2 = 3 * t * t;
  const d1x = e0 * (c1[0] - from[0]) + e1 * (c2[0] - c1[0]) + e2 * (to[0] - c2[0]);
  const d1y = e0 * (c1[1] - from[1]) + e1 * (c2[1] - c1[1]) + e2 * (to[1] - c2[1]);
  const d2x = (c2[0] - 2 * c1[0] + from[0]) * 6 * s + (to[0] - 2 * c2[0] + c1[0]) * 6 * t;
  const d2y = (c2[1] - 2 * c1[1] + from[1]) * 6 * s + (to[1] - 2 * c2[1] + c1[1]) * 6 * t;
  const denominator = d1x * d1x + d1y * d1y + (dx * d2x + dy * d2y);
  return denominator === 0 ? t : Math.min(1, Math.max(0, t - (dx * d1x + dy * d1y) / denominator));
}

/// Il punto più lontano dalla cubica fra quelli in mezzo, quanto, e quanto
/// se ne scostano tutti in media quadratica.
function worst(points: readonly Point[], first: number, last: number, u: readonly number[], curve: Cubic): { readonly error: number; readonly at: number; readonly spread: number } {
  const from = points[first]!;
  const { c1, c2, to } = curve;
  let squared = 0;
  let sum = 0;
  let at = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const t = u[i - first]!;
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    const p = points[i]!;
    const dx = b0 * from[0] + b1 * c1[0] + b2 * c2[0] + b3 * to[0] - p[0];
    const dy = b0 * from[1] + b1 * c1[1] + b2 * c2[1] + b3 * to[1] - p[1];
    const d = dx * dx + dy * dy;
    sum += d;
    if (d > squared) {
      squared = d;
      at = i;
    }
  }
  return { error: Math.sqrt(squared), at, spread: last - first > 1 ? Math.sqrt(sum / (last - first - 1)) : 0 };
}

/// Un pezzo adattato: la curva dal punto `first` al punto `last`, e il
/// parametro di ciascuno dei punti fra loro.
export interface Fitted {
  readonly first: number;
  readonly last: number;
  readonly curve: Curve;
  readonly u: readonly number[];
}

/// Le cubiche che passano entro `tolerance` dai punti da `first` a `last`,
/// partendo nel verso `t1` e arrivando nel verso `t2`: una sola se basta,
/// altrimenti divise al punto più lontano, lisce lì. Con `polish`, anche
/// una cubica che sta già entro `tolerance` fa le prove di Newton, finché
/// ci resta: i parametri per la lunghezza della corda la tirano verso
/// l'interno delle curve, e la rifinitura la riporta sui punti; e basta
/// solo se in media quadratica sta entro [`SPREAD`] tolleranze.
export function fitCubics(points: readonly Point[], lengths: readonly number[], first: number, last: number, t1: Point, t2: Point, tolerance: number, out: Fitted[], polish = false): void {
  const span = lengths[last]! - lengths[first]!;
  let u = points.slice(first, last + 1).map((_, i) => (span > 0 ? (lengths[first + i]! - lengths[first]!) / span : i / (last - first)));
  let curve = generate(points, first, last, u, t1, t2);
  const fits = (w: { readonly error: number; readonly spread: number }): boolean => w.error <= tolerance && (!polish || w.spread <= SPREAD * tolerance);
  let found = worst(points, first, last, u, curve);
  if (fits(found) || last - first < 2) {
    for (let round = 0; polish && last - first >= 2 && round < REFINE_ROUNDS; round++) {
      const now = curve;
      const tried = u.map((t, i) => (i === 0 || i === last - first ? t : closer(points[first]!, now, points[first + i]!, t)));
      const better = generate(points, first, last, tried, t1, t2);
      if (!fits(worst(points, first, last, tried, better))) break;
      [u, curve] = [tried, better];
    }
    out.push({ first, last, curve, u });
    return;
  }
  if (found.error <= tolerance * 4) {
    for (let round = 0; round < REFINE_ROUNDS; round++) {
      const now = curve;
      // I capi restano ai capi.
      u = u.map((t, i) => (i === 0 || i === last - first ? t : closer(points[first]!, now, points[first + i]!, t)));
      curve = generate(points, first, last, u, t1, t2);
      found = worst(points, first, last, u, curve);
      if (fits(found)) {
        out.push({ first, last, curve, u });
        return;
      }
    }
  }
  const { at } = found;
  const through = throughDirection(points, at, first, last, tolerance);
  fitCubics(points, lengths, first, at, t1, through, tolerance, out, polish);
  fitCubics(points, lengths, at, last, through, t2, tolerance, out, polish);
}

/// Vero se i punti da `first` a `last` stanno tutti entro `tolerance` dalla
/// corda fra i due.
export function straight(points: readonly Point[], first: number, last: number, tolerance: number): boolean {
  const a = points[first]!;
  const along = unit(minus(points[last]!, a));
  if (along === null) return false;
  for (let i = first + 1; i < last; i++) {
    const d = minus(points[i]!, a);
    if (Math.abs(d[0] * along[1] - d[1] * along[0]) > tolerance) return false;
  }
  return true;
}

/// Il parametro di `p` sulla linea da `a` a `b`, fra 0 e 1.
export function onLine(a: Point, b: Point, p: Point): number {
  const d = minus(b, a);
  const l = dot(d, d);
  return l === 0 ? 0 : Math.min(1, Math.max(0, dot(minus(p, a), d) / l));
}
