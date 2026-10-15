// Le curve dei diagrammi importati: la curva liscia che passa per dei punti,
// come la disegnano Excalidraw e draw.io, e la cubica sola che le somiglia di
// più, perché il connettore curvo di FubDraw è una cubica.

import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";

/// Una curva liscia che passa per `points`: ogni tratto è una cubica con le
/// tangenti di Catmull-Rom, e ai capi la tangente va verso il punto vicino.
/// Chiusa, gira e torna al primo punto.
export function smoothSegments(points: readonly Point[], closed: boolean): Segment[] {
  const count = points.length;
  const at = (i: number): Point => (closed ? points[((i % count) + count) % count]! : points[Math.min(count - 1, Math.max(0, i))]!);
  const out: Segment[] = [{ kind: "move", to: points[0]! }];
  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    out.push({ kind: "cubic", c1, c2, to: p2 });
  }
  if (closed) out.push({ kind: "close" });
  return out;
}

/// Il punto della cubica `p0 c1 c2 p3` a `t`.
function cubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const s = 1 - t;
  const [a, b, c, d] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

/// I punti di una linea fatta di tratti dritti e cubici, `steps` per tratto;
/// per ogni tratto, l'indice del suo ultimo punto.
export function sampled(segments: readonly Segment[], steps = 24): { readonly points: Point[]; readonly ends: number[] } {
  const points: Point[] = [];
  const ends: number[] = [];
  let at: Point | null = null;
  for (const segment of segments) {
    if (segment.kind === "move") {
      at = segment.to;
      points.push(at);
      continue;
    }
    if (at === null) continue;
    if (segment.kind === "cubic") {
      for (let i = 1; i <= steps; i++) points.push(cubicAt(at, segment.c1, segment.c2, segment.to, i / steps));
      at = segment.to;
    } else if (segment.kind === "line") {
      const from: Point = at;
      for (let i = 1; i <= steps; i++) points.push([from[0] + ((segment.to[0] - from[0]) * i) / steps, from[1] + ((segment.to[1] - from[1]) * i) / steps]);
      at = segment.to;
    } else {
      continue;
    }
    ends.push(points.length - 1);
  }
  return { points, ends };
}

/// Le lunghezze di `points` dall'inizio, punto per punto.
export function runningLengths(points: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  return out;
}

/// La cubica che meglio somiglia a una linea: i quattro punti di Bézier, dal
/// primo campione all'ultimo, e lo scarto più grande fra lei e i campioni.
export interface Fitted {
  readonly points: readonly [Point, Point, Point, Point];
  readonly error: number;
}

/// Al più quante volte si ricalcolano i parametri dei campioni sulla cubica
/// trovata: ogni passo di Newton la avvicina di poco, e su una linea che una
/// cubica segue davvero ne servono qualche decina.
const FIT_ROUNDS = 64;

/// Lo scarto sotto cui la cubica basta: un centesimo di unità.
const FIT_ENOUGH = 0.01;

/// La cubica da `samples[0]` all'ultimo campione che passa più vicino agli
/// altri, ai minimi quadrati, col parametro di ogni campione affinato col
/// metodo di Newton (Schneider, «An Algorithm for Automatically Fitting
/// Digitized Curves», 1990).
export function fitCubic(samples: readonly Point[]): Fitted {
  const points = samples.filter((p, i) => i === 0 || p[0] !== samples[i - 1]![0] || p[1] !== samples[i - 1]![1]);
  const p0 = points[0]!;
  const p3 = points[points.length - 1]!;
  const third = (k: number): Point => [p0[0] + ((p3[0] - p0[0]) * k) / 3, p0[1] + ((p3[1] - p0[1]) * k) / 3];
  if (points.length < 3) return { points: [p0, third(1), third(2), p3], error: 0 };
  const lengths = runningLengths(points);
  const total = lengths[lengths.length - 1]!;
  const u = lengths.map((length) => length / total);
  let best: Fitted | null = null;
  for (let round = 0; round <= FIT_ROUNDS; round++) {
    let [a11, a12, a22] = [0, 0, 0];
    let [x1, y1, x2, y2] = [0, 0, 0, 0];
    for (let i = 0; i < points.length; i++) {
      const t = u[i]!;
      const s = 1 - t;
      const [b0, b1, b2, b3] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
      const rx = points[i]![0] - (b0 + b1) * p0[0] - (b2 + b3) * p3[0];
      const ry = points[i]![1] - (b0 + b1) * p0[1] - (b2 + b3) * p3[1];
      a11 += b1 * b1;
      a12 += b1 * b2;
      a22 += b2 * b2;
      x1 += b1 * rx;
      y1 += b1 * ry;
      x2 += b2 * rx;
      y2 += b2 * ry;
    }
    const det = a11 * a22 - a12 * a12;
    // Il sistema risolve lo scarto dai punti a un terzo della corda: le
    // incognite sono quanto i punti di controllo se ne allontanano.
    let c1 = third(1);
    let c2 = third(2);
    if (Math.abs(det) > 1e-12) {
      const d1: Point = [(a22 * x1 - a12 * x2) / det, (a22 * y1 - a12 * y2) / det];
      const d2: Point = [(a11 * x2 - a12 * x1) / det, (a11 * y2 - a12 * y1) / det];
      c1 = [p0[0] + d1[0], p0[1] + d1[1]];
      c2 = [p3[0] + d2[0], p3[1] + d2[1]];
    }
    let error = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y] = cubicAt(p0, c1, c2, p3, u[i]!);
      error = Math.max(error, Math.hypot(x - points[i]![0], y - points[i]![1]));
    }
    if (best === null || error < best.error) best = { points: [p0, c1, c2, p3], error };
    if (best.error <= FIT_ENOUGH) break;
    // Il parametro di ogni campione va al punto della cubica più vicino.
    for (let i = 1; i < points.length - 1; i++) u[i] = newton(p0, c1, c2, p3, points[i]!, u[i]!);
  }
  return best!;
}

/// Un passo di Newton verso il parametro del punto di `p0 c1 c2 p3` più
/// vicino a `p`, da `t`.
function newton(p0: Point, c1: Point, c2: Point, p3: Point, p: Point, t: number): number {
  const s = 1 - t;
  const [x, y] = cubicAt(p0, c1, c2, p3, t);
  const d1x = 3 * (s * s * (c1[0] - p0[0]) + 2 * s * t * (c2[0] - c1[0]) + t * t * (p3[0] - c2[0]));
  const d1y = 3 * (s * s * (c1[1] - p0[1]) + 2 * s * t * (c2[1] - c1[1]) + t * t * (p3[1] - c2[1]));
  const d2x = 6 * (s * (c2[0] - 2 * c1[0] + p0[0]) + t * (p3[0] - 2 * c2[0] + c1[0]));
  const d2y = 6 * (s * (c2[1] - 2 * c1[1] + p0[1]) + t * (p3[1] - 2 * c2[1] + c1[1]));
  const f = (x - p[0]) * d1x + (y - p[1]) * d1y;
  const df = d1x * d1x + d1y * d1y + (x - p[0]) * d2x + (y - p[1]) * d2y;
  if (Math.abs(df) < 1e-12) return t;
  return Math.min(1, Math.max(0, t - f / df));
}

/// Vero se ogni tratto di `points` è orizzontale o verticale, a meno di
/// `tolerance` unità.
export function orthogonal(points: readonly Point[], tolerance = 0.5): boolean {
  for (let i = 1; i < points.length; i++) {
    const [dx, dy] = [Math.abs(points[i]![0] - points[i - 1]![0]), Math.abs(points[i]![1] - points[i - 1]![1])];
    if (dx > tolerance && dy > tolerance) return false;
  }
  return true;
}
