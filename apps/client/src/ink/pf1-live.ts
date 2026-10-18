// `pf1` di un tratto che cresce: lo stesso contorno di `getStroke`, senza
// rifarlo da capo a ogni movimento.
//
// L'anteprima di un tratto in corso chiede il contorno a ogni evento. Rifatto
// con `getStroke` costa quanto il tratto intero, e il tratto intero cresce:
// un tratto lungo paga a ogni movimento tutti i campioni che ha già. Qui il
// contorno è diviso in due:
//
// - il **prefisso congelato**, che nessun campione futuro può più cambiare: si
//   calcola una volta, quando il campione arriva, e si tiene;
// - la **coda volatile**, che si rifà a ogni chiamata: l'ultimo campione
//   stabile, i campioni predetti, i punti abbastanza vicini alla fine da
//   sentire lo scarto del rumore o l'assottigliamento finale, e le due
//   estremità.
//
// Una chiamata costa la coda più la copia del poligono, non il tratto. La
// copia va in un vettore che si riusa: un vettore nuovo di qualche migliaio di
// vertici a ogni movimento costa più di tutto il resto, perché il motore lo
// alloca fra gli oggetti grandi.
//
// Perché il prefisso non cambia. `getStroke` fa due passate:
//
// 1. i punti del tratto (`getStrokePoints`): ognuno è un'interpolazione fra il
//    punto precedente e il campione, e l'unica eccezione è l'ultimo, ammesso
//    anche prima della lunghezza minima. I campioni stabili tranne l'ultimo
//    danno quindi punti che non cambiano più;
// 2. il contorno (`getStrokeOutlinePoints`): ogni punto legge il precedente e
//    il successivo, la pressione iniziale è la media dei primi dieci punti, e
//    la lunghezza totale decide soltanto lo scarto degli ultimi 3 di rumore e
//    l'assottigliamento finale. Un punto con il successivo congelato, dopo i
//    primi dieci e a più di `max(3, taperEnd)` dalla fine del prefisso non
//    cambia più, perché la lunghezza totale può soltanto crescere.
//
// L'uguaglianza è esatta, numero per numero: le operazioni sono quelle della
// libreria, nello stesso ordine (anche gli argomenti di `Math.hypot`), e
// `pf1-live.test.ts` confronta questo modulo con `getStroke` a ogni prefisso di
// tratti costruiti per toccare ogni ramo. Quando il prefisso non c'è ancora, o
// i campioni sono meno di tre (dove la libreria ha i suoi casi speciali), si
// chiama la libreria stessa. Serve solo all'anteprima, quindi sempre con
// `last: false`; il tratto finito si calcola con `pf1`.
//
// Derivato da perfect-freehand 1.2.3, Copyright (c) 2021 Stephen Ruiz Ltd,
// sotto licenza MIT: il testo è in `THIRD_PARTY_NOTICES.md`, alla radice.

import { getStroke, getStrokeOutlinePoints, type StrokeOptions, type StrokePoint } from "perfect-freehand";
import { checkBrush, type Pf1Brush } from "./brush";
import { strokeOptions, type OutlinePoint } from "./pf1";

/// Un campione nel formato di `getStroke`: `[x, y]` o `[x, y, pressione]`, con
/// la pressione in 0…1.
export type Pf1Input = readonly number[];

type Vec = [number, number];

// Le costanti di perfect-freehand 1.2.3 (`constants.ts`).
const MIN_STREAMLINE_T = 0.15;
const STREAMLINE_T_RANGE = 0.85;
const DEFAULT_FIRST_PRESSURE = 0.25;
const DEFAULT_PRESSURE = 0.5;
const END_NOISE_THRESHOLD = 3;
const MIN_RADIUS = 0.01;
const FIXED_PI = Math.PI + 0.0001;
const START_CAP_SEGMENTS = 13;
const END_CAP_SEGMENTS = 29;
const CORNER_CAP_SEGMENTS = 13;
const RATE_OF_PRESSURE_CHANGE = 0.275;
/// I punti da cui si media la pressione iniziale.
const INITIAL_POINTS = 10;

/// Dove è arrivata la prima passata: l'ultimo punto del tratto, la lunghezza
/// percorsa e se ha già superato la lunghezza minima.
interface Cursor {
  prev: StrokePoint;
  running: number;
  reached: boolean;
}

/// Ciò che il punto seguente del contorno legge del precedente.
interface Edge {
  prevPressure: number;
  prevVector: Vec;
  prevLeft: Vec;
  prevRight: Vec;
  /// Il punto precedente era uno spigolo.
  sharp: boolean;
}

function validPressure(pressure: number | undefined): pressure is number {
  return pressure != null && pressure >= 0;
}

function simulatePressure(prevPressure: number, distance: number, size: number): number {
  const sp = Math.min(1, distance / size);
  const rp = Math.min(1, 1 - sp);
  return Math.min(1, prevPressure + (rp - prevPressure) * (sp * RATE_OF_PRESSURE_CHANGE));
}

/// `rotAround`: `(ax, ay)` girato di `r` attorno a `c`.
function rotate(ax: number, ay: number, c: Vec, r: number): Vec {
  const s = Math.sin(r);
  const k = Math.cos(r);
  const px = ax - c[0];
  const py = ay - c[1];
  return [px * k - py * s + c[0], px * s + py * k + c[1]];
}

function dist2(a: Vec, b: Vec): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export class Pf1Live {
  private readonly options: StrokeOptions;
  private readonly size: number;
  private readonly thinning: number;
  private readonly sim: boolean;
  private readonly taperStart: number;
  private readonly taperEnd: number;
  private readonly capStart: boolean;
  private readonly capEnd: boolean;
  /// L'interpolazione dello `streamline`.
  private readonly lerp: number;
  private readonly minDistance: number;
  /// Quanto un punto deve stare prima della fine del prefisso per non sentire
  /// più né il rumore né l'assottigliamento finale.
  private readonly settle: number;

  /// I campioni stabili.
  private readonly inputs: Pf1Input[] = [];
  /// I punti del tratto dei campioni stabili tranne l'ultimo.
  private readonly points: StrokePoint[] = [];
  private cursor: Cursor | null = null;

  /// Il contorno congelato: i lati dei primi `done` punti, lo stato che il
  /// punto `done` legge e l'estremità iniziale.
  private readonly left: Vec[] = [];
  private readonly right: Vec[] = [];
  private done = 0;
  private edge: Edge | null = null;
  private startCap: Vec[] | null = null;
  /// Il poligono dell'ultima chiamata, riscritto da quella dopo.
  private readonly polygon: OutlinePoint[] = [];

  /// Lancia `RangeError` se il pennello non è valido.
  constructor(brush: Pf1Brush) {
    checkBrush(brush);
    this.options = strokeOptions(brush, false);
    this.size = brush.size;
    this.thinning = brush.thinning;
    this.sim = brush.sim;
    this.taperStart = brush.taperStart;
    this.taperEnd = brush.taperEnd;
    this.capStart = brush.capStart;
    this.capEnd = brush.capEnd;
    this.lerp = MIN_STREAMLINE_T + (1 - brush.streamline) * STREAMLINE_T_RANGE;
    // La stessa espressione della libreria, perché ogni motore la calcoli uguale.
    this.minDistance = (brush.size * brush.smoothing) ** 2;
    this.settle = Math.max(END_NOISE_THRESHOLD, brush.taperEnd);
  }

  /// I campioni stabili ricevuti.
  get length(): number {
    return this.inputs.length;
  }

  /// I punti del tratto il cui contorno è congelato: lo leggono i test, per
  /// sapere che il prefisso c'è davvero.
  get frozen(): number {
    return this.done;
  }

  /// Aggiunge un campione stabile: resta nel tratto fino alla fine.
  push(input: Pf1Input): void {
    const before = this.inputs[this.inputs.length - 1];
    this.inputs.push(input);
    if (before === undefined) return;
    // Il campione che era l'ultimo non lo è più: il suo punto si congela.
    if (this.cursor === null) {
      const first: StrokePoint = {
        point: [before[0]!, before[1]!],
        pressure: validPressure(before[2]) ? before[2] : DEFAULT_FIRST_PRESSURE,
        vector: [1, 1],
        distance: 0,
        runningLength: 0,
      };
      this.points.push(first);
      this.cursor = { prev: first, running: 0, reached: false };
    } else {
      const point = this.step(this.cursor, before, false);
      if (point === null) return;
      this.points.push(point);
      if (this.points.length === 2) this.points[0]!.vector = point.vector;
    }
    this.freeze();
  }

  /// Il contorno dei campioni stabili seguiti da `tail`, che vale per questa
  /// chiamata soltanto: uguale a `getStroke([...stabili, ...tail], { last: false })`.
  /// Resta valido fino alla chiamata dopo, che può riscriverlo: chi lo vuole
  /// tenere ne fa una copia.
  outline(tail: readonly Pf1Input[]): OutlinePoint[] {
    const count = this.inputs.length + tail.length;
    if (count === 0) return [];
    if (this.cursor === null || count < 3) return getStroke([...this.inputs, ...tail] as number[][], this.options);

    // La prima passata, dall'ultimo campione stabile in poi.
    const cursor: Cursor = { ...this.cursor };
    const fresh: StrokePoint[] = [];
    const last = this.inputs[this.inputs.length - 1]!;
    const take = (input: Pf1Input, final: boolean): void => {
      const point = this.step(cursor, input, final);
      if (point !== null) fresh.push(point);
    };
    take(last, tail.length === 0);
    for (let k = 0; k < tail.length; k++) take(tail[k]!, k === tail.length - 1);

    const frozen = this.points;
    const m = frozen.length + fresh.length;
    const at = (i: number): StrokePoint => (i < frozen.length ? frozen[i]! : fresh[i - frozen.length]!);
    if (this.edge === null || this.done === 0) {
      const all = frozen.length === 1
        ? [{ ...frozen[0]!, vector: fresh[0]?.vector ?? [0, 0] }, ...fresh]
        : [...frozen, ...fresh];
      return getStrokeOutlinePoints(all, this.options);
    }

    // La seconda passata, dal primo punto non congelato.
    const edge: Edge = { ...this.edge };
    const total = at(m - 1).runningLength;
    const left: Vec[] = [];
    const right: Vec[] = [];
    let radius = 0;
    for (let i = this.done; i < m; i++) {
      const r = this.visit(edge, i, at(i), i + 1 < m ? at(i + 1) : null, total, left, right);
      if (r !== null) radius = r;
    }

    const end = at(m - 1);
    const lastPoint: Vec = [end.point[0], end.point[1]];
    const endCap = this.endCap(lastPoint, end.vector, radius);
    const startCap = this.startCap!;
    const out = this.polygon;
    out.length = this.left.length + left.length + endCap.length + this.right.length + right.length + startCap.length;
    let o = 0;
    for (const p of this.left) out[o++] = p;
    for (const p of left) out[o++] = p;
    for (const p of endCap) out[o++] = p;
    for (let i = right.length - 1; i >= 0; i--) out[o++] = right[i]!;
    for (let i = this.right.length - 1; i >= 0; i--) out[o++] = this.right[i]!;
    for (const p of startCap) out[o++] = p;
    return out;
  }

  /// Il passo di `getStrokePoints` per `input`; `final` se è l'ultimo campione
  /// della chiamata. `null` se il campione non fa un punto.
  private step(cursor: Cursor, input: Pf1Input, final: boolean): StrokePoint | null {
    const a = cursor.prev.point;
    const point: Vec = [a[0] + (input[0]! - a[0]) * this.lerp, a[1] + (input[1]! - a[1]) * this.lerp];
    if (a[0] === point[0] && a[1] === point[1]) return null;
    const distance = Math.hypot(point[1] - a[1], point[0] - a[0]);
    cursor.running += distance;
    if (!final && !cursor.reached) {
      if (cursor.running < this.size) return null;
      cursor.reached = true;
    }
    const dx = a[0] - point[0];
    const dy = a[1] - point[1];
    const length = Math.hypot(dx, dy);
    const next: StrokePoint = {
      point,
      pressure: validPressure(input[2]) ? input[2] : DEFAULT_PRESSURE,
      vector: [dx / length, dy / length],
      distance,
      runningLength: cursor.running,
    };
    cursor.prev = next;
    return next;
  }

  /// Congela i punti del contorno che nessun campione futuro può cambiare.
  private freeze(): void {
    const points = this.points;
    if (this.edge === null) {
      if (points.length < INITIAL_POINTS) return;
      const first = points[0]!;
      let pressure = first.pressure;
      for (let i = 0; i < INITIAL_POINTS; i++) {
        const curr = points[i]!;
        pressure = (pressure + (this.sim ? simulatePressure(pressure, curr.distance, this.size) : curr.pressure)) / 2;
      }
      this.edge = { prevPressure: pressure, prevVector: first.vector as Vec, prevLeft: first.point as Vec, prevRight: first.point as Vec, sharp: false };
    }
    const end = points[points.length - 1]!.runningLength;
    while (this.done + 1 < points.length && end - points[this.done]!.runningLength >= this.settle) {
      this.visit(this.edge, this.done, points[this.done]!, points[this.done + 1]!, end, this.left, this.right);
      this.done++;
    }
    if (this.startCap === null && this.done > 0) {
      this.startCap = this.taperStart ? [] : this.capStart
        ? this.roundStartCap(points[0]!.point as Vec, this.right[0]!)
        : this.flatStartCap(points[0]!.point as Vec, this.left[0]!, this.right[0]!);
    }
  }

  /// Il corpo del ciclo di `getStrokeOutlinePoints` per il punto `i`: aggiunge
  /// ai lati e aggiorna `edge`. Dà il raggio del punto, `null` se è scartato
  /// come rumore.
  private visit(edge: Edge, i: number, current: StrokePoint, next: StrokePoint | null, total: number, left: Vec[], right: Vec[]): number | null {
    const { point, vector, distance, runningLength } = current;
    const isLast = next === null;
    if (!isLast && total - runningLength < END_NOISE_THRESHOLD) return null;
    let { pressure } = current;
    let radius: number;
    if (this.thinning) {
      if (this.sim) pressure = simulatePressure(edge.prevPressure, distance, this.size);
      radius = this.size * (0.5 - this.thinning * (0.5 - pressure));
    } else {
      radius = this.size / 2;
    }
    const startStrength = runningLength < this.taperStart ? startEase(runningLength / this.taperStart) : 1;
    const endStrength = total - runningLength < this.taperEnd ? endEase((total - runningLength) / this.taperEnd) : 1;
    radius = Math.max(MIN_RADIUS, radius * Math.min(startStrength, endStrength));

    const nextVector = (isLast ? current : next).vector;
    const nextDpr = isLast ? 1.0 : vector[0] * nextVector[0] + vector[1] * nextVector[1];
    const prevDpr = vector[0] * edge.prevVector[0] + vector[1] * edge.prevVector[1];
    const sharpHere = prevDpr < 0 && !edge.sharp;
    const sharpNext = nextDpr < 0;

    if (sharpHere || sharpNext) {
      // Uno spigolo: un mezzo giro attorno al punto, e si passa oltre.
      const ox = edge.prevVector[1] * radius;
      const oy = -edge.prevVector[0] * radius;
      const step = 1 / CORNER_CAP_SEGMENTS;
      let l = edge.prevLeft;
      let r = edge.prevRight;
      for (let t = 0; t <= 1; t += step) {
        l = rotate(point[0] - ox, point[1] - oy, point, FIXED_PI * t);
        left.push(l);
        r = rotate(point[0] + ox, point[1] + oy, point, FIXED_PI * -t);
        right.push(r);
      }
      edge.prevLeft = l;
      edge.prevRight = r;
      if (sharpNext) edge.sharp = true;
      return radius;
    }
    edge.sharp = false;

    if (isLast) {
      const ox = vector[1] * radius;
      const oy = -vector[0] * radius;
      left.push([point[0] - ox, point[1] - oy]);
      right.push([point[0] + ox, point[1] + oy]);
      return radius;
    }

    const lx = nextVector[0] + (vector[0] - nextVector[0]) * nextDpr;
    const ly = nextVector[1] + (vector[1] - nextVector[1]) * nextDpr;
    const ox = ly * radius;
    const oy = -lx * radius;
    const l: Vec = [point[0] - ox, point[1] - oy];
    if (i <= 1 || dist2(edge.prevLeft, l) > this.minDistance) {
      left.push(l);
      edge.prevLeft = l;
    }
    const r: Vec = [point[0] + ox, point[1] + oy];
    if (i <= 1 || dist2(edge.prevRight, r) > this.minDistance) {
      right.push(r);
      edge.prevRight = r;
    }
    edge.prevPressure = pressure;
    edge.prevVector = vector as Vec;
    return radius;
  }

  private roundStartCap(center: Vec, rightPoint: Vec): Vec[] {
    const cap: Vec[] = [];
    const step = 1 / START_CAP_SEGMENTS;
    for (let t = step; t <= 1; t += step) cap.push(rotate(rightPoint[0], rightPoint[1], center, FIXED_PI * t));
    return cap;
  }

  private flatStartCap(center: Vec, leftPoint: Vec, rightPoint: Vec): Vec[] {
    const cx = leftPoint[0] - rightPoint[0];
    const cy = leftPoint[1] - rightPoint[1];
    const ax = cx * 0.5;
    const ay = cy * 0.5;
    const bx = cx * 0.51;
    const by = cy * 0.51;
    return [[center[0] - ax, center[1] - ay], [center[0] - bx, center[1] - by], [center[0] + bx, center[1] + by], [center[0] + ax, center[1] + ay]];
  }

  /// L'estremità finale, per un tratto di almeno due punti.
  private endCap(center: Vec, vector: Vec, radius: number): Vec[] {
    if (this.taperEnd) return [center];
    // `per(neg(vector))`.
    const nx = -vector[0];
    const ny = -vector[1];
    const dx = ny;
    const dy = -nx;
    if (this.capEnd) {
      const sx = center[0] + dx * radius;
      const sy = center[1] + dy * radius;
      const cap: Vec[] = [];
      const step = 1 / END_CAP_SEGMENTS;
      for (let t = step; t < 1; t += step) cap.push(rotate(sx, sy, center, FIXED_PI * 3 * t));
      return cap;
    }
    const near = radius * 0.99;
    return [
      [center[0] + dx * radius, center[1] + dy * radius],
      [center[0] + dx * near, center[1] + dy * near],
      [center[0] - dx * near, center[1] - dy * near],
      [center[0] - dx * radius, center[1] - dy * radius],
    ];
  }
}

function startEase(t: number): number {
  return t * (2 - t);
}

function endEase(t: number): number {
  const u = t - 1;
  return u * u * u + 1;
}
