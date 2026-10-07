// Il contorno di un tracciato come area, e una forma allargata o ristretta:
// la geometria di «Contorno in tracciato» e di «Scostamento» (livello
// Esperto). Senza DOM e senza documento: segmenti in entrata e tracciati in
// uscita, nelle stesse coordinate.
//
// - **Il contorno è l'unione di anelli**, come lo definisce SVG 2: per ogni
//   curva, l'area che spazza il segmento perpendicolare a lei, centrato su
//   di lei e lungo quanto il contorno è largo; fra due curve, il giunto; ai
//   capi di un sottotracciato aperto, gli estremi; e per un sottotracciato
//   lungo zero, un punto tondo o quadrato.
// - **I lati degli anelli sono curve.** Una cubica si spezza nei flessi,
//   dove il raggio di curvatura vale metà contorno, e dove gira più di un
//   angolo retto. Su ogni pezzo il suo scostamento è una cubica con le
//   derivate giuste ai capi (Hermite), che si divide finché sta a mezzo
//   centesimo da quello vero. Un arco di cerchio resta un arco, con un altro
//   raggio; un arco d'ellisse diventa cubiche abbastanza fitte.
// - **I pezzi di fila fanno un anello solo**, finché non c'è un giunto: le
//   normali fra due pezzi, percorse una volta per verso, si annullano.
// - **Dove la curva è più stretta di metà contorno**, dalla parte interna lo
//   scostamento torna indietro. Il pezzo diventa due spicchi che si toccano
//   dove le normali ai capi si incrociano, più il triangolo fra quel punto e
//   i centri di curvatura ai capi.
// - **Giunti ed estremi** sono anelli anch'essi: triangolo, quadrilatero o
//   spicchio con un arco vero; rettangolo o mezzo cerchio.
// - **Tutti gli anelli girano in verso positivo**, e un solo arrangiamento
//   delle operazioni booleane ne fa l'unione, con le curve.
// - **Lo scostamento** di una forma è la sua unione con la fascia larga il
//   doppio della distanza attorno al bordo, o la differenza se la distanza è
//   negativa.

import { arcCenter, reversed, type Curve } from "../scene/curves";
import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { combine } from "./boolean";

/// Come si uniscono due curve, e come finisce un sottotracciato aperto.
export type Join = "miter" | "round" | "bevel";
export type Cap = "butt" | "round" | "square";

/// Un contorno: la larghezza, i giunti, gli estremi, il limite degli
/// spigoli e il tratteggio. Il tratteggio ha un numero pari di lunghezze non
/// negative con la somma positiva, o nessuna per un contorno pieno.
export interface StrokeStyle {
  readonly width: number;
  readonly join: Join;
  readonly cap: Cap;
  readonly miterLimit: number;
  readonly dashes: readonly number[];
}

/// Quanto lo scostamento di una curva può stare da quello vero: mezzo
/// centesimo, perché scritto al centesimo resti entro un centesimo.
export const OFFSET_ERROR = 0.005;
/// I tratti al più di un tratteggio: oltre, il contorno è troppo fitto per
/// diventare un tracciato.
export const MAX_DASHES = 10_000;
/// I pezzi al più delle spezzate dell'unione: oltre, il calcolo terrebbe
/// fermo l'editor per secondi.
const MAX_PIECES = 250_000;
/// Quante volte al più si divide un pezzo.
const MAX_DEPTH = 16;
const QUARTER = Math.PI / 2;
const TAU = 2 * Math.PI;

const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const norm = (a: Point): number => Math.hypot(a[0], a[1]);
const unit = (a: Point): Point => times(a, 1 / norm(a));
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const same = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];
/// La normale di un verso: il verso girato di un angolo retto, da x verso y.
const normal = (d: Point): Point => [-d[1], d[0]];
/// L'angolo, col segno, di cui si gira andando dal verso `d0` al verso `d1`.
const turnBetween = (d0: Point, d1: Point): number => Math.atan2(cross(d0, d1), dot(d0, d1));

// ---------------------------------------------------------------------------
// Le cubiche.
// ---------------------------------------------------------------------------

/// Una cubica coi suoi quattro punti.
type Bez = readonly [Point, Point, Point, Point];

function bezPoint([p0, p1, p2, p3]: Bez, t: number): Point {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function bezFirst([p0, p1, p2, p3]: Bez, t: number): Point {
  const u = 1 - t;
  const [a, b, c] = [3 * u * u, 6 * u * t, 3 * t * t];
  return [a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]), a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1])];
}

function bezSecond([p0, p1, p2, p3]: Bez, t: number): Point {
  const u = 1 - t;
  return [6 * u * (p2[0] - 2 * p1[0] + p0[0]) + 6 * t * (p3[0] - 2 * p2[0] + p1[0]), 6 * u * (p2[1] - 2 * p1[1] + p0[1]) + 6 * t * (p3[1] - 2 * p2[1] + p1[1])];
}

const bezThird = ([p0, p1, p2, p3]: Bez): Point => [6 * (p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0]), 6 * (p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1])];

/// La lunghezza della poligonale dei punti: la misura di una cubica.
const legs = ([p0, p1, p2, p3]: Bez): number => norm(minus(p1, p0)) + norm(minus(p2, p1)) + norm(minus(p3, p2));

/// La parte di `b` fra `t0` e `t1`, dalla forma polare.
function bezPart(b: Bez, t0: number, t1: number): Bez {
  const blossom = (u: number, v: number, w: number): Point => {
    const [q0, q1, q2] = [lerp(b[0], b[1], u), lerp(b[1], b[2], u), lerp(b[2], b[3], u)];
    return lerp(lerp(q0, q1, v), lerp(q1, q2, v), w);
  };
  return [t0 === 0 ? b[0] : blossom(t0, t0, t0), blossom(t0, t0, t1), blossom(t0, t1, t1), t1 === 1 ? b[3] : blossom(t1, t1, t1)];
}

/// Il verso, lungo 1, in cui `b` va in `t`: da `t` in avanti con `side` 1,
/// arrivando in `t` con -1. Dove la derivata si annulla vale quella dopo.
function directionAt(b: Bez, t: number, side: 1 | -1, scale: number): Point {
  const d = bezFirst(b, t);
  if (norm(d) > 1e-9 * scale) return unit(d);
  const dd = bezSecond(b, t);
  if (norm(dd) > 1e-9 * scale) return unit(times(dd, side));
  return unit(bezThird(b));
}

/// Il centro di curvatura di `b` in `t`; il punto stesso dove la derivata
/// si annulla.
function centerAt(b: Bez, t: number, scale: number): Point | null {
  const [p, d] = [bezPoint(b, t), bezFirst(b, t)];
  if (norm(d) <= 1e-9 * scale) return p;
  const bend = cross(d, bezSecond(b, t));
  return bend === 0 ? null : plus(p, times(normal(d), dot(d, d) / bend));
}

/// Le radici reali di a·t² + b·t + c.
function quadraticRoots(a: number, b: number, c: number): number[] {
  const size = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (size === 0) return [];
  if (Math.abs(a) <= 1e-12 * size) return Math.abs(b) <= 1e-12 * size ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(disc)) / 2;
  return q === 0 ? [0] : [q / a, c / q];
}

const within = (t: number): boolean => t > 1e-9 && t < 1 - 1e-9;

/// I coefficienti di B′/3 = a·t² + b·t + c.
function firstCoefficients([p0, p1, p2, p3]: Bez): [Point, Point, Point] {
  const c = minus(p1, p0);
  const b = times(plus(minus(p2, times(p1, 2)), p0), 2);
  const a = minus(plus(minus(p3, times(p2, 3)), times(p1, 3)), p0);
  return [a, b, c];
}

/// I flessi di `b`, dove B′ × B″ cambia segno: un polinomio di secondo
/// grado.
function inflectionsOf(b: Bez): number[] {
  const [a, bb, c] = firstCoefficients(b);
  return quadraticRoots(-cross(a, bb), 2 * cross(c, a), cross(c, bb)).filter(within);
}

/// Le cuspidi di `b`, dove la derivata si annulla dentro la curva.
function cuspsOf(b: Bez, scale: number): number[] {
  const [a, bb, c] = firstCoefficients(b);
  const out: number[] = [];
  for (const axis of [0, 1]) {
    for (const t of quadraticRoots(a[axis]!, bb[axis]!, c[axis]!)) {
      if (within(t) && norm(bezFirst(b, t)) <= 1e-7 * scale && !out.some((u) => Math.abs(u - t) < 1e-9)) out.push(t);
    }
  }
  return out;
}

/// Dove si cercano i cambi di segno: più fitto vicino ai capi, dove una
/// maniglia corta piega la curva in poco spazio.
const FRACTIONS: readonly number[] = (() => {
  const near = [1e-6, 1e-5, 1e-4, 1e-3, 0.004, 0.01];
  const middle = Array.from({ length: 47 }, (_, i) => (i + 1) / 48);
  return [...near, ...middle, ...near.map((u) => 1 - u)].sort((m, n) => m - n);
})();

/// Gli zeri di `f` fra `ta` e `tb` dove cambia segno.
function rootsOf(f: (t: number) => number, ta: number, tb: number): number[] {
  const out: number[] = [];
  let [t0, v0] = [ta, f(ta)];
  for (const u of [...FRACTIONS, 1]) {
    const t1 = u === 1 ? tb : ta + (tb - ta) * u;
    const v1 = f(t1);
    if (v0 !== 0 && v1 !== 0 && v0 < 0 !== v1 < 0) {
      let [lo, hi, low] = [t0, t1, v0];
      for (let k = 0; k < 64 && hi - lo > 1e-15; k++) {
        const m = (lo + hi) / 2;
        const fm = f(m);
        if (fm < 0 === low < 0) [lo, low] = [m, fm];
        else hi = m;
      }
      out.push((lo + hi) / 2);
    }
    if (v1 !== 0) [t0, v0] = [t1, v1];
  }
  return out;
}

const GAUSS_3: ReadonlyArray<readonly [number, number]> = [
  [-0.7745966692414834, 5 / 9],
  [0, 8 / 9],
  [0.7745966692414834, 5 / 9],
];
const GAUSS_8: ReadonlyArray<readonly [number, number]> = [
  [-0.9602898564975363, 0.1012285362903763],
  [-0.7966664774136267, 0.2223810344533745],
  [-0.525532409916329, 0.3137066458778873],
  [-0.1834346424956498, 0.362683783378362],
  [0.1834346424956498, 0.362683783378362],
  [0.525532409916329, 0.3137066458778873],
  [0.7966664774136267, 0.2223810344533745],
  [0.9602898564975363, 0.1012285362903763],
];

/// La lunghezza di `b` fra `t0` e `t1`.
function lengthBetween(b: Bez, t0: number, t1: number): number {
  const [half, middle] = [(t1 - t0) / 2, (t0 + t1) / 2];
  let sum = 0;
  for (const [x, w] of GAUSS_8) sum += w * norm(bezFirst(b, middle + half * x));
  return sum * half;
}

// ---------------------------------------------------------------------------
// I sottotracciati.
// ---------------------------------------------------------------------------

/// Un pezzo di un sottotracciato che disegna qualcosa: una linea, una
/// cubica con la sua misura, o un arco di cerchio col centro, il raggio,
/// l'angolo di partenza e quanto gira, col segno.
type Element =
  | { readonly kind: "line"; readonly from: Point; readonly to: Point }
  | { readonly kind: "cubic"; readonly bez: Bez; readonly scale: number }
  | {
      readonly kind: "circle";
      readonly from: Point;
      readonly to: Point;
      readonly center: Point;
      readonly radius: number;
      readonly start: number;
      readonly delta: number;
    };

/// Un sottotracciato: i suoi pezzi, se si chiude, e per uno lungo zero il
/// punto dove sta e il verso del suo quadrato.
interface Subpath {
  readonly elements: readonly Element[];
  readonly closed: boolean;
  readonly at: Point;
  readonly direction: Point;
}

/// Più vicini di così, due punti sono lo stesso: un pezzo così corto non
/// disegna niente.
const STILL = 1e-9;

const startOf = (e: Element): Point => (e.kind === "cubic" ? e.bez[0] : e.from);
const endOf = (e: Element): Point => (e.kind === "cubic" ? e.bez[3] : e.to);
const onCircle = (center: Point, radius: number, angle: number): Point => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
/// Il verso di un arco di cerchio all'angolo `angle`.
const circleDirection = (angle: number, delta: number): Point => (delta > 0 ? [-Math.sin(angle), Math.cos(angle)] : [Math.sin(angle), -Math.cos(angle)]);

function startDirection(e: Element): Point {
  switch (e.kind) {
    case "line":
      return unit(minus(e.to, e.from));
    case "cubic":
      return directionAt(e.bez, 0, 1, e.scale);
    case "circle":
      return circleDirection(e.start, e.delta);
  }
}

function endDirection(e: Element): Point {
  switch (e.kind) {
    case "line":
      return unit(minus(e.to, e.from));
    case "cubic":
      return directionAt(e.bez, 1, -1, e.scale);
    case "circle":
      return circleDirection(e.start + e.delta, e.delta);
  }
}

function pushCubic(bez: Bez, out: Element[]): void {
  const scale = legs(bez);
  if (scale > STILL) out.push({ kind: "cubic", bez, scale });
}

/// Le cubiche di un arco d'ellisse, abbastanza fitte da starle a meno di
/// metà di `OFFSET_ERROR`: una cubica che copre l'angolo θ di un cerchio di
/// raggio r se ne scosta al più di r · 4/27 · sin⁶(θ/4) / cos²(θ/4).
function ellipseCubics(from: Point, to: Point, arc: NonNullable<ReturnType<typeof arcCenter>>, out: Element[]): void {
  const r = Math.max(arc.radii[0], arc.radii[1]);
  const error = (theta: number): number => (r * 4 * Math.sin(theta / 4) ** 6) / (27 * Math.cos(theta / 4) ** 2);
  let pieces = Math.max(1, Math.ceil(Math.abs(arc.delta) / QUARTER - 1e-9));
  while (pieces < 1024 && error(Math.abs(arc.delta) / pieces) > OFFSET_ERROR / 2) pieces++;
  const step = arc.delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (theta: number): Point => {
    const [ex, ey] = [arc.radii[0] * Math.cos(theta), arc.radii[1] * Math.sin(theta)];
    return [arc.center[0] + arc.cos * ex - arc.sin * ey, arc.center[1] + arc.sin * ex + arc.cos * ey];
  };
  const along = (theta: number): Point => {
    const [ex, ey] = [-arc.radii[0] * Math.sin(theta), arc.radii[1] * Math.cos(theta)];
    return [arc.cos * ex - arc.sin * ey, arc.sin * ex + arc.cos * ey];
  };
  for (let i = 0; i < pieces; i++) {
    const [a, b] = [arc.start + step * i, arc.start + step * (i + 1)];
    const p0 = i === 0 ? from : at(a);
    const p3 = i === pieces - 1 ? to : at(b);
    pushCubic([p0, plus(p0, times(along(a), k)), minus(p3, times(along(b), k)), p3], out);
  }
}

/// I pezzi di `curve` da `from`, aggiunti a `out`; niente per una curva
/// che resta in un punto.
function elementsOf(from: Point, curve: Curve, out: Element[]): void {
  switch (curve.kind) {
    case "line":
      if (norm(minus(curve.to, from)) > STILL) out.push({ kind: "line", from, to: curve.to });
      return;
    case "quad":
      pushCubic([from, lerp(from, curve.control, 2 / 3), lerp(curve.to, curve.control, 2 / 3), curve.to], out);
      return;
    case "cubic":
      pushCubic([from, curve.c1, curve.c2, curve.to], out);
      return;
    case "arc": {
      const arc = arcCenter(from, curve);
      if (arc === null) {
        elementsOf(from, { kind: "line", to: curve.to }, out);
      } else if (Math.abs(arc.radii[0] - arc.radii[1]) <= 1e-9 * arc.radii[0]) {
        const start = arc.start + Math.atan2(arc.sin, arc.cos);
        out.push({ kind: "circle", from, to: curve.to, center: arc.center, radius: arc.radii[0], start, delta: arc.delta });
      } else {
        ellipseCubics(from, curve.to, arc, out);
      }
      return;
    }
  }
}

/// I sottotracciati di `segments`. Uno fatto solo di `M` non disegna
/// niente; uno che resta in un punto, come `M Z`, è un punto.
function subpathsOf(segments: readonly Segment[]): Subpath[] {
  const out: Subpath[] = [];
  let elements: Element[] = [];
  let start: Point = [0, 0];
  let current: Point = [0, 0];
  let drawn = false;
  const finish = (closed: boolean): void => {
    if (drawn) out.push({ elements, closed, at: start, direction: [1, 0] });
    elements = [];
    drawn = false;
  };
  for (const segment of segments) {
    if (segment.kind === "move") {
      finish(false);
      start = current = segment.to;
    } else if (segment.kind === "close") {
      drawn = true;
      elementsOf(current, { kind: "line", to: start }, elements);
      finish(true);
      current = start;
    } else {
      drawn = true;
      elementsOf(current, segment, elements);
      current = segment.to;
    }
  }
  finish(false);
  return out;
}

// ---------------------------------------------------------------------------
// Il tratteggio.
// ---------------------------------------------------------------------------

/// Quanto è lungo un pezzo, e il suo parametro a una lunghezza
/// dall'inizio.
interface Measure {
  readonly total: number;
  param(s: number): number;
}

/// Le parti in cui si misura una cubica prima di cercare un parametro.
const MEASURE_PARTS = 16;

function measureOf(e: Element): Measure {
  if (e.kind !== "cubic") {
    const total = e.kind === "line" ? norm(minus(e.to, e.from)) : e.radius * Math.abs(e.delta);
    return { total, param: (s) => Math.min(1, Math.max(0, s / total)) };
  }
  const b = e.bez;
  const sums = [0];
  for (let i = 0; i < MEASURE_PARTS; i++) sums.push(sums[i]! + lengthBetween(b, i / MEASURE_PARTS, (i + 1) / MEASURE_PARTS));
  const total = sums[MEASURE_PARTS]!;
  return {
    total,
    param(s) {
      if (s <= 0) return 0;
      if (s >= total) return 1;
      let i = 0;
      while (i < MEASURE_PARTS - 1 && sums[i + 1]! < s) i++;
      const base = i / MEASURE_PARTS;
      const [target, part] = [s - sums[i]!, sums[i + 1]! - sums[i]!];
      if (!(part > 0)) return base;
      // Newton, che resta fra i capi della parte.
      let [lo, hi] = [base, (i + 1) / MEASURE_PARTS];
      let t = base + (hi - base) * (target / part);
      for (let k = 0; k < 40 && hi - lo > 1e-15; k++) {
        const f = lengthBetween(b, base, t) - target;
        if (Math.abs(f) <= 1e-12 * Math.max(1, total)) break;
        if (f > 0) hi = t;
        else lo = t;
        const speed = norm(bezFirst(b, t));
        const next = speed > 0 ? t - f / speed : (lo + hi) / 2;
        t = next > lo && next < hi ? next : (lo + hi) / 2;
      }
      return t;
    },
  };
}

/// La parte di `e` fra i parametri `t0` e `t1`.
function partOf(e: Element, t0: number, t1: number): Element {
  switch (e.kind) {
    case "line":
      return { kind: "line", from: t0 === 0 ? e.from : lerp(e.from, e.to, t0), to: t1 === 1 ? e.to : lerp(e.from, e.to, t1) };
    case "cubic": {
      const bez = bezPart(e.bez, t0, t1);
      return { kind: "cubic", bez, scale: legs(bez) };
    }
    case "circle": {
      const [start, delta] = [e.start + e.delta * t0, e.delta * (t1 - t0)];
      const from = t0 === 0 ? e.from : onCircle(e.center, e.radius, start);
      const to = t1 === 1 ? e.to : onCircle(e.center, e.radius, start + delta);
      return { ...e, from, to, start, delta };
    }
  }
}

/// Il punto di `e` al parametro `t`, e il suo verso.
function placeOn(e: Element, t: number): { readonly at: Point; readonly direction: Point } {
  switch (e.kind) {
    case "line":
      return { at: lerp(e.from, e.to, t), direction: unit(minus(e.to, e.from)) };
    case "cubic":
      return { at: bezPoint(e.bez, t), direction: directionAt(e.bez, t, 1, e.scale) };
    case "circle": {
      const angle = e.start + e.delta * t;
      return { at: onCircle(e.center, e.radius, angle), direction: circleDirection(angle, e.delta) };
    }
  }
}

/// I tratti di `sub` col tratteggio `dashes`, che comincia dove comincia il
/// sottotracciato: sottotracciati aperti, e quelli lunghi zero come punti
/// col verso del tracciato. In un sottotracciato chiuso il primo e l'ultimo
/// tratto, se si toccano nel punto di partenza, sono un tratto solo, col
/// giunto. `null` se sono più di `room`.
function dashed(sub: Subpath, dashes: readonly number[], room: number): Subpath[] | null {
  const { elements } = sub;
  const measures = elements.map(measureOf);
  const offsets: number[] = [];
  let total = 0;
  for (const measure of measures) {
    offsets.push(total);
    total += measure.total;
  }
  let cursor = 0;
  /// Il pezzo dove sta la lunghezza `s`: le lunghezze crescono, e il
  /// cursore va avanti con loro.
  const locate = (s: number): number => {
    while (cursor < elements.length - 1 && offsets[cursor + 1]! <= s) cursor++;
    return cursor;
  };
  const point = (s: number): Subpath => {
    const i = locate(s);
    const { at, direction } = placeOn(elements[i]!, measures[i]!.param(s - offsets[i]!));
    return { elements: [], closed: false, at, direction };
  };
  const extract = (s0: number, s1: number): Subpath => {
    const parts: Element[] = [];
    for (let i = locate(s0); i < elements.length && offsets[i]! < s1; i++) {
      const [offset, measure] = [offsets[i]!, measures[i]!];
      const [a, b] = [Math.max(s0, offset), Math.min(s1, offset + measure.total)];
      if (b - a <= STILL) continue;
      const t0 = a <= offset ? 0 : measure.param(a - offset);
      const t1 = b >= offset + measure.total ? 1 : measure.param(b - offset);
      parts.push(t0 === 0 && t1 === 1 ? elements[i]! : partOf(elements[i]!, t0, t1));
    }
    return parts.length === 0 ? point(s0) : { elements: parts, closed: false, at: startOf(parts[0]!), direction: [1, 0] };
  };

  const out: Subpath[] = [];
  let last = 0;
  let s = 0;
  for (let k = 0; s < total; k++) {
    const length = dashes[k % dashes.length]!;
    if (k % 2 === 0) {
      if (out.length >= room) return null;
      last = Math.min(s + length, total);
      out.push(length === 0 ? point(s) : extract(s, last));
    }
    s += length;
  }
  if (sub.closed && out.length > 0 && last >= total && out[out.length - 1]!.elements.length > 0) {
    if (out.length === 1) return [sub];
    const [first, end] = [out[0]!, out[out.length - 1]!];
    if (first.elements.length > 0) {
      out[0] = { ...end, elements: [...end.elements, ...first.elements] };
      out.pop();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gli anelli.
// ---------------------------------------------------------------------------

/// Un anello: dove comincia, e le curve, che tornano all'inizio con una
/// linea.
interface Loop {
  readonly start: Point;
  readonly curves: readonly Curve[];
}

/// ½∫(x dy − y dx) lungo `curve` da `from`: la sua parte dell'area con
/// segno. Gli archi degli anelli sono di cerchio.
function swept(from: Point, curve: Curve): number {
  switch (curve.kind) {
    case "line":
      return (from[0] * curve.to[1] - curve.to[0] * from[1]) / 2;
    case "quad":
      return swept(from, { kind: "cubic", c1: lerp(from, curve.control, 2 / 3), c2: lerp(curve.to, curve.control, 2 / 3), to: curve.to });
    case "cubic": {
      // x·y′ − y·x′ ha grado 5: tre punti di Gauss bastano.
      const b: Bez = [from, curve.c1, curve.c2, curve.to];
      let sum = 0;
      for (const [x, w] of GAUSS_3) {
        const t = (1 + x) / 2;
        sum += w * cross(bezPoint(b, t), bezFirst(b, t));
      }
      return sum / 4;
    }
    case "arc": {
      const arc = arcCenter(from, curve);
      if (arc === null) return swept(from, { kind: "line", to: curve.to });
      const [r, [cx, cy], a0] = [arc.radii[0], arc.center, arc.start];
      const a1 = a0 + arc.delta;
      return (r * r * arc.delta + cx * r * (Math.sin(a1) - Math.sin(a0)) - cy * r * (Math.cos(a1) - Math.cos(a0))) / 2;
    }
  }
}

function areaOf(start: Point, curves: readonly Curve[]): number {
  let sum = 0;
  let from = start;
  for (const curve of curves) {
    sum += swept(from, curve);
    from = curve.to;
  }
  return sum + (from[0] * start[1] - start[0] * from[1]) / 2;
}

/// `curves` da `start` percorse al contrario, dalla fine.
function reversedCurves(start: Point, curves: readonly Curve[]): Curve[] {
  const out: Curve[] = [];
  let from = start;
  for (const curve of curves) {
    out.push(reversed(from, curve));
    from = curve.to;
  }
  return out.reverse();
}

/// Aggiunge a `out` l'anello da `start`, girato in verso positivo; niente
/// se non racchiude niente.
function pushLoop(out: Loop[], start: Point, curves: readonly Curve[]): void {
  const area = areaOf(start, curves);
  if (!(Math.abs(area) > 1e-12)) return;
  if (area > 0) out.push({ start, curves });
  else out.push({ start: curves[curves.length - 1]!.to, curves: reversedCurves(start, curves) });
}

const line = (to: Point): Curve => ({ kind: "line", to });

/// Gli archi da `from` attorno a `center`, di `angle` in tutto, a pezzi di
/// un angolo retto al più; l'ultimo finisce in `to`.
function arcsAround(center: Point, radius: number, from: Point, angle: number, to: Point): Curve[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(angle) / QUARTER - 1e-9));
  const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
  const out: Curve[] = [];
  for (let k = 1; k <= pieces; k++) {
    const end = k === pieces ? to : onCircle(center, radius, start + (angle * k) / pieces);
    out.push({ kind: "arc", radii: [radius, radius], rotation: 0, large: false, sweep: angle > 0, to: end });
  }
  return out;
}

/// Lo scostamento di un pezzo da una parte, nel verso del pezzo.
interface Side {
  readonly start: Point;
  readonly curves: readonly Curve[];
  readonly end: Point;
}

/// I pezzi di fila che fanno un anello: lo scostamento dalla parte della
/// normale e quello dall'altra, in avanti. Le normali fra due pezzi non
/// servono: l'anello dell'uno le percorre in un verso, quello dell'altro
/// nell'altro.
class Chain {
  private readonly ahead: Curve[] = [];
  private readonly behind: Curve[] = [];
  private first: readonly [Point, Point] | null = null;
  private last: readonly [Point, Point] = [
    [0, 0],
    [0, 0],
  ];

  constructor(private readonly out: Loop[]) {}

  /// Aggiunge un pezzo: `toward` dalla parte della normale, `away`
  /// dall'altra. Dove non continua il pezzo prima, per poco, una linea li
  /// unisce.
  add(toward: Side, away: Side): void {
    if (this.first === null) {
      this.first = [toward.start, away.start];
    } else {
      if (!same(this.last[0], toward.start)) this.behind.push(line(toward.start));
      if (!same(this.last[1], away.start)) this.ahead.push(line(away.start));
    }
    for (const curve of toward.curves) this.behind.push(curve);
    for (const curve of away.curves) this.ahead.push(curve);
    this.last = [toward.end, away.end];
  }

  /// Chiude l'anello dei pezzi aggiunti: dalla parte della normale
  /// all'altra, avanti, di nuovo dalla parte della normale, e indietro. Gira
  /// in verso positivo.
  flush(): void {
    if (this.first === null) return;
    const [start, other] = this.first;
    const curves = [line(other), ...this.ahead, line(this.last[0]), ...reversedCurves(start, this.behind)];
    pushLoop(this.out, start, curves);
    this.first = null;
    this.ahead.length = 0;
    this.behind.length = 0;
  }
}

const straight = (from: Point, to: Point): Side => ({ start: from, curves: [line(to)], end: to });

/// Il disco di raggio `h` attorno a `p`: un punto tondo, e una cuspide.
function pushDisk(out: Loop[], p: Point, h: number): void {
  const from = plus(p, [h, 0]);
  pushLoop(out, from, arcsAround(p, h, from, TAU, from));
}

// ---------------------------------------------------------------------------
// I pezzi.
// ---------------------------------------------------------------------------

/// Lo scostamento di `b` fra `ta` e `tb` di `s`, verso la normale se è
/// positivo: cubiche con la derivata vera ai capi, B′ · (1 − s·κ), divise a
/// metà finché stanno a `OFFSET_ERROR` dallo scostamento vero nei punti di
/// controllo.
function offsetCubic(b: Bez, scale: number, ta: number, tb: number, s: number): Side {
  const point = (t: number, side: 1 | -1): Point => plus(bezPoint(b, t), times(normal(directionAt(b, t, side, scale)), s));
  const derivative = (t: number, side: 1 | -1): Point => {
    const d = bezFirst(b, t);
    const squared = dot(d, d);
    if (squared > (1e-9 * scale) ** 2) return times(d, 1 - (s * cross(d, bezSecond(b, t))) / (squared * Math.sqrt(squared)));
    // Dove la derivata si annulla, lo scostamento ne ha una finita: si
    // misura accanto.
    const step = 1e-7 * side;
    return times(minus(point(t + step, side), point(t, side)), 1 / step);
  };
  const curves: Curve[] = [];
  const visit = (t0: number, p0: Point, d0: Point, t1: number, p1: Point, d1: Point, depth: number): void => {
    const k = (t1 - t0) / 3;
    const [c1, c2] = [plus(p0, times(d0, k)), minus(p1, times(d1, k))];
    const guess: Bez = [p0, c1, c2, p1];
    const fits = SAMPLES.every((u) => norm(minus(bezPoint(guess, u), point(t0 + (t1 - t0) * u, 1))) <= OFFSET_ERROR);
    if (fits || depth >= MAX_DEPTH) {
      curves.push({ kind: "cubic", c1, c2, to: p1 });
      return;
    }
    const tm = (t0 + t1) / 2;
    const [pm, dm] = [point(tm, 1), derivative(tm, 1)];
    visit(t0, p0, d0, tm, pm, dm, depth + 1);
    visit(tm, pm, dm, t1, p1, d1, depth + 1);
  };
  const [start, end] = [point(ta, 1), point(tb, -1)];
  visit(ta, start, derivative(ta, 1), tb, end, derivative(tb, -1), 0);
  return { start, curves, end };
}

/// Dove si confronta lo scostamento calcolato con quello vero.
const SAMPLES = [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];

/// Di quanto gira `b` fra `ta` e `tb`, dove la curvatura ha il segno
/// `sign`: senza flessi, meno di un giro.
function turnOf(b: Bez, scale: number, ta: number, tb: number, sign: number): number {
  let angle = turnBetween(directionAt(b, ta, 1, scale), directionAt(b, tb, -1, scale));
  if (sign > 0 && angle < -1e-9) angle += TAU;
  else if (sign < 0 && angle > 1e-9) angle -= TAU;
  return Math.abs(angle);
}

/// Un pezzo di cubica fra `ta` e `tb` senza flessi, dove la curvatura ha il
/// segno `sign`; `folded` se lì il raggio di curvatura è minore di `h`. Si
/// divide finché gira al più di un angolo retto.
function sweepPiece(b: Bez, scale: number, ta: number, tb: number, h: number, sign: number, folded: boolean, chain: Chain, out: Loop[], depth: number): void {
  if (depth < MAX_DEPTH && turnOf(b, scale, ta, tb, sign) > QUARTER + 1e-9) {
    const tm = (ta + tb) / 2;
    sweepPiece(b, scale, ta, tm, h, sign, folded, chain, out, depth + 1);
    sweepPiece(b, scale, tm, tb, h, sign, folded, chain, out, depth + 1);
    return;
  }
  if (folded && sign !== 0 && sweepFolded(b, scale, ta, tb, h, sign, chain, out, depth)) return;
  chain.add(offsetCubic(b, scale, ta, tb, h), offsetCubic(b, scale, ta, tb, -h));
}

/// Un pezzo più stretto di `h` dalla parte della normale se `sign` è
/// positivo, dall'altra se è negativo. Lì le normali si incrociano in un
/// punto X prima di arrivare allo scostamento: il pezzo spazza lo spicchio
/// fra lo scostamento di fuori e X, quello opposto fra X e lo scostamento
/// di dentro, che torna indietro, e il triangolo fra X e i centri di
/// curvatura ai capi, dove le normali toccano l'evoluta. Falso se le
/// normali non si incrociano dove serve nemmeno dividendo il pezzo.
function sweepFolded(b: Bez, scale: number, ta: number, tb: number, h: number, sign: number, chain: Chain, out: Loop[], depth: number): boolean {
  const s = h * sign;
  const [pa, pb] = [bezPoint(b, ta), bezPoint(b, tb)];
  const [na, nb] = [normal(directionAt(b, ta, 1, scale)), normal(directionAt(b, tb, -1, scale))];
  const across = cross(na, nb);
  const gap = minus(pb, pa);
  const [la, lb] = [cross(gap, nb) / across, cross(gap, na) / across];
  if (!(la / s > 0 && la / s < 1 && lb / s > 0 && lb / s < 1)) {
    if (depth >= MAX_DEPTH) return false;
    const tm = (ta + tb) / 2;
    sweepPiece(b, scale, ta, tm, h, sign, true, chain, out, depth + 1);
    sweepPiece(b, scale, tm, tb, h, sign, true, chain, out, depth + 1);
    return true;
  }
  const x = plus(pa, times(na, la));
  chain.flush();
  const outer = offsetCubic(b, scale, ta, tb, -s);
  const inner = offsetCubic(b, scale, ta, tb, s);
  pushLoop(out, outer.start, [...outer.curves, line(x)]);
  pushLoop(out, x, [line(inner.start), ...inner.curves]);
  const [ea, eb] = [centerAt(b, ta, scale), centerAt(b, tb, scale)];
  if (ea !== null && eb !== null) pushLoop(out, x, [line(ea), line(eb)]);
  return true;
}

/// Una cubica: si spezza nelle cuspidi, dove gira all'indietro e il
/// contorno fa un disco, e nei flessi; ogni tratto senza flessi nei punti
/// dove il raggio di curvatura vale `h`.
function sweepCubic(b: Bez, scale: number, h: number, chain: Chain, out: Loop[]): void {
  const cusps = cuspsOf(b, scale);
  const cuts = [0, ...cusps, ...inflectionsOf(b), 1].sort((m, n) => m - n);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [ta, tb] = [cuts[i]!, cuts[i + 1]!];
    if (tb - ta > 1e-12) {
      const middle = (ta + tb) / 2;
      const sign = Math.sign(cross(bezFirst(b, middle), bezSecond(b, middle)));
      const f = (t: number): number => {
        const d = bezFirst(b, t);
        return norm(d) ** 3 - h * Math.abs(cross(d, bezSecond(b, t)));
      };
      const bounds = [ta, ...(sign === 0 ? [] : rootsOf(f, ta, tb)), tb];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const [t0, t1] = [bounds[k]!, bounds[k + 1]!];
        if (t1 - t0 > 1e-12) sweepPiece(b, scale, t0, t1, h, sign, f((t0 + t1) / 2) < 0, chain, out, 0);
      }
    }
    if (i + 2 < cuts.length && cusps.includes(tb)) {
      chain.flush();
      pushDisk(out, bezPoint(b, tb), h);
    }
  }
}

/// Un arco di cerchio, a pezzi di un angolo retto al più. Con un raggio
/// maggiore di `h` gli scostamenti sono archi; altrimenti ogni pezzo spazza
/// lo spicchio fino al raggio r + h e quello opposto fino a h − r.
function sweepCircle(e: Extract<Element, { readonly kind: "circle" }>, h: number, chain: Chain, out: Loop[]): void {
  const { center, radius: r, start, delta } = e;
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / QUARTER - 1e-9));
  const forward = delta > 0;
  const arc = (to: Point, radius: number): Curve => ({ kind: "arc", radii: [radius, radius], rotation: 0, large: false, sweep: forward, to });
  const side = (a0: number, a1: number, radius: number): Side => {
    const [from, to] = [onCircle(center, radius, a0), onCircle(center, radius, a1)];
    return { start: from, curves: [arc(to, radius)], end: to };
  };
  for (let k = 0; k < pieces; k++) {
    const [a0, a1] = [start + (delta * k) / pieces, start + (delta * (k + 1)) / pieces];
    if (h < r) {
      // La normale guarda il centro quando l'arco gira in verso positivo.
      const [near, far] = [side(a0, a1, r - h), side(a0, a1, r + h)];
      chain.add(forward ? near : far, forward ? far : near);
      continue;
    }
    chain.flush();
    pushLoop(out, center, [line(onCircle(center, r + h, a0)), arc(onCircle(center, r + h, a1), r + h)]);
    if (h > r) pushLoop(out, center, [line(onCircle(center, h - r, a0 + Math.PI)), arc(onCircle(center, h - r, a1 + Math.PI), h - r)]);
  }
}

function sweep(e: Element, h: number, chain: Chain, out: Loop[]): void {
  switch (e.kind) {
    case "line": {
      const n = times(normal(unit(minus(e.to, e.from))), h);
      chain.add(straight(plus(e.from, n), plus(e.to, n)), straight(minus(e.from, n), minus(e.to, n)));
      return;
    }
    case "cubic":
      sweepCubic(e.bez, e.scale, h, chain, out);
      return;
    case "circle":
      sweepCircle(e, h, chain, out);
      return;
  }
}

// ---------------------------------------------------------------------------
// Giunti, estremi e punti.
// ---------------------------------------------------------------------------

/// Vero se fra i versi `d0` e `d1` non serve un giunto: lo spazio fra gli
/// scostamenti dei due pezzi non arriva a `OFFSET_ERROR`.
const smooth = (d0: Point, d1: Point, h: number): boolean => Math.abs(turnBetween(d0, d1)) * h <= OFFSET_ERROR;

/// Il giunto in `p` fra una curva che arriva col verso `d0` e una che parte
/// col verso `d1`, dalla parte esterna della svolta. Lo spigolo arriva a
/// h / cos(θ/2) da `p`, se il rapporto con h non passa il limite;
/// altrimenti il giunto è smussato.
function joinAt(p: Point, d0: Point, d1: Point, h: number, style: StrokeStyle, out: Loop[]): void {
  const turn = turnBetween(d0, d1);
  // Una curva che gira verso la normale ha il giunto dall'altra parte.
  const reach = turn > 0 ? -h : h;
  const [n0, n1] = [normal(d0), normal(d1)];
  const [a, b] = [plus(p, times(n0, reach)), plus(p, times(n1, reach))];
  if (style.join === "round") {
    pushLoop(out, p, [line(a), ...arcsAround(p, h, a, turn, b)]);
    return;
  }
  const half = Math.abs(turn) / 2;
  if (style.join === "miter" && 1 / Math.cos(half) <= style.miterLimit) {
    pushLoop(out, p, [line(a), line(plus(p, times(unit(plus(n0, n1)), reach / Math.cos(half)))), line(b)]);
    return;
  }
  pushLoop(out, p, [line(a), line(b)]);
}

/// L'estremo in `p` di un sottotracciato aperto, verso `e`, fuori dal
/// tracciato.
function capAt(p: Point, e: Point, h: number, cap: Cap, out: Loop[]): void {
  const n = times(normal(e), h);
  const [a, b] = [plus(p, n), minus(p, n)];
  if (cap === "square") {
    const f = times(e, h);
    pushLoop(out, a, [line(plus(a, f)), line(plus(b, f)), line(b)]);
  } else if (cap === "round") {
    pushLoop(out, a, arcsAround(p, h, a, -Math.PI, b));
  }
}

/// Un sottotracciato o un tratto lunghi zero: un disco con gli estremi
/// tondi, un quadrato col verso `e` con quelli quadrati, niente con quelli
/// netti.
function dotAt(p: Point, e: Point, h: number, cap: Cap, out: Loop[]): void {
  if (cap === "round") {
    pushDisk(out, p, h);
  } else if (cap === "square") {
    const [f, n] = [times(e, h), times(normal(e), h)];
    const start = plus(plus(p, f), n);
    pushLoop(out, start, [line(plus(minus(p, f), n)), line(minus(minus(p, f), n)), line(minus(plus(p, f), n))]);
  }
}

/// Gli anelli di un sottotracciato. Uno chiuso comincia dal primo giunto
/// vero, perché i pezzi di fila prima e dopo il punto di partenza facciano
/// un anello solo.
function strokeSubpath(sub: Subpath, style: StrokeStyle, h: number, out: Loop[]): void {
  const { elements } = sub;
  const count = elements.length;
  if (count === 0) {
    dotAt(sub.at, sub.direction, h, style.cap, out);
    return;
  }
  let order = elements;
  let closing = false;
  if (sub.closed) {
    const k = elements.findIndex((e, i) => !smooth(endDirection(elements[(i + count - 1) % count]!), startDirection(e), h));
    if (k >= 0) {
      order = [...elements.slice(k), ...elements.slice(0, k)];
      closing = true;
    }
  }
  const chain = new Chain(out);
  const join = (before: Element, after: Element): void => {
    const [d0, d1] = [endDirection(before), startDirection(after)];
    if (smooth(d0, d1, h)) return;
    chain.flush();
    joinAt(startOf(after), d0, d1, h, style, out);
  };
  order.forEach((e, i) => {
    if (i > 0) join(order[i - 1]!, e);
    sweep(e, h, chain, out);
  });
  if (closing) join(order[count - 1]!, order[0]!);
  chain.flush();
  if (!sub.closed) {
    capAt(startOf(order[0]!), times(startDirection(order[0]!), -1), h, style.cap, out);
    capAt(endOf(order[count - 1]!), endDirection(order[count - 1]!), h, style.cap, out);
  }
}

// ---------------------------------------------------------------------------
// Il contorno e lo scostamento.
// ---------------------------------------------------------------------------

const loopSegments = (loop: Loop): Segment[] => [{ kind: "move", to: loop.start }, ...loop.curves, { kind: "close" }];

/// Gli anelli del contorno di `segments` disegnato con `style`, tutti in
/// verso positivo, come sottotracciati: la loro unione è l'area che il
/// contorno dipinge. `"dense"` se il tratteggio ha più di `MAX_DASHES`
/// tratti.
export function strokeLoops(segments: readonly Segment[], style: StrokeStyle): Segment[] | "dense" {
  const h = style.width / 2;
  if (!(h > 0)) return [];
  const loops: Loop[] = [];
  let room = MAX_DASHES;
  for (const sub of subpathsOf(segments)) {
    let parts: readonly Subpath[] = [sub];
    if (style.dashes.length > 0 && sub.elements.length > 0) {
      const cut = dashed(sub, style.dashes, room);
      if (cut === null) return "dense";
      room -= cut.length;
      parts = cut;
    }
    for (const part of parts) strokeSubpath(part, style, h, loops);
  }
  return loops.flatMap(loopSegments);
}

/// Perché un contorno o uno scostamento non diventano un tracciato: il
/// tratteggio è troppo fitto, la geometria troppo intricata, o il calcolo
/// non riesce.
export type Refusal = "dense" | "complex" | "failed";

/// Il primo tracciato di un'operazione booleana, o perché non c'è.
const first = (result: Segment[][] | "complex" | null): Segment[] | Refusal => (result === null ? "failed" : result === "complex" ? result : (result[0] ?? []));

/// L'area che dipinge il contorno di `segments` disegnato con `style`, come
/// tracciato; nessun segmento se non dipinge niente.
export function strokeArea(segments: readonly Segment[], style: StrokeStyle): Segment[] | Refusal {
  const loops = strokeLoops(segments, style);
  if (loops === "dense" || loops.length === 0) return loops;
  return first(combine("union", [{ segments: loops, evenOdd: false, written: false, built: true }], MAX_PIECES));
}

/// Gli spigoli di uno scostamento: i giunti della fascia attorno al bordo,
/// e il loro limite.
export interface OffsetStyle {
  readonly join: Join;
  readonly miterLimit: number;
}

/// L'area di `segments` allargata di `distance`, o ristretta se è negativa,
/// con gli spigoli di `style`: un tracciato, nessun segmento se non resta
/// niente. Una forma aperta che non racchiude niente, senza riempimento
/// (`filled` falso) o con un riempimento senza area come una linea, si
/// allarga attorno alle sue curve, coi capi tondi se i giunti sono tondi e
/// quadrati altrimenti, e non si restringe.
export function offsetArea(segments: readonly Segment[], distance: number, style: OffsetStyle, filled: boolean): Segment[] | Refusal {
  const open = !subpathsOf(segments).some((sub) => sub.closed);
  const strip = (): Segment[] | Refusal =>
    distance > 0 ? strokeArea(segments, { width: 2 * distance, join: style.join, cap: style.join === "round" ? "round" : "square", miterLimit: style.miterLimit, dashes: [] }) : [];
  if (!filled && open) return strip();
  const boundary = first(combine("union", [{ segments, evenOdd: false, written: false, built: true }], MAX_PIECES));
  if (typeof boundary === "string") return boundary;
  // Un riempimento senza area, come quello di una linea, si scosta come la
  // sua striscia.
  if (boundary.length === 0 && open) return strip();
  if (boundary.length === 0 || distance === 0) return boundary;
  // Un bordo pulito non ha tratteggio: la sua fascia non è mai troppo fitta.
  const band = strokeLoops(boundary, { width: 2 * Math.abs(distance), join: style.join, cap: "butt", miterLimit: style.miterLimit, dashes: [] }) as Segment[];
  const shapes = [
    { segments: boundary, evenOdd: false, written: false, built: true },
    { segments: band, evenOdd: false, written: false, built: true },
  ];
  return first(combine(distance > 0 ? "union" : "difference", shapes, MAX_PIECES));
}
