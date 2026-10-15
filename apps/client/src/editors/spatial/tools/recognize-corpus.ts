// Il corpus delle forme dal tratto (`src/__fixtures__/ink-shapes/`): disegni
// FubDraw coi tratti a penna e, nel nome di ciascun tratto, il suo `title`,
// il risultato atteso, scritto a mano: «linea», «freccia», «rettangolo»,
// «ellisse», «cerchio», «triangolo», «quadrilatero», «pentagono»,
// «esagono», «stella», «nessuna» per un tratto che non è una forma, e
// «scrittura» per un tratto di scrittura, che tenuto fermo alla fine non
// diventa niente.
//
// I file `sintetico-*.svg` vengono da qui. Il generatore imita una mano,
// sempre allo stesso modo da un seme: la penna accelera e rallenta come un
// gesto a strappo minimo, si ferma negli spigoli e li arrotonda, deriva di
// lato e trema, chiude i giri un po' prima o un po' dopo l'inizio, ha la
// pressione che sale all'appoggio e oscilla. Il mouse ha meno campioni,
// coordinate intere e niente pressione. `vitest -u` li riscrive.
//
// I tratti finiscono all'ultimo movimento, come quelli di chi disegna e
// alza: la tenuta, i campioni fermi alla fine, la aggiunge il test.
//
// Un tratto registrato davvero si aggiunge disegnandolo in FubDraw, con
// «Forme dal tratto» spento, e dandogli per nome il risultato atteso: il
// disegno salvato va nella cartella col suo nome, che non comincia con
// `sintetico-`.

import { formatBrush, brushForInput, PF1_DEFAULTS } from "../ink/brush";
import { encodeInk, inkFromSamples } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { quantizeInk, type InkSample } from "../ink/sample";
import type { Point } from "../scene/matrix";
import { FUB_NS, SVG_NS } from "../scene/xml";
import { El, Mulberry32 } from "../scene/test-support";

/// Ciò che un tratto del corpus deve dare.
export type Expected =
  | "linea"
  | "freccia"
  | "rettangolo"
  | "ellisse"
  | "cerchio"
  | "triangolo"
  | "quadrilatero"
  | "pentagono"
  | "esagono"
  | "stella"
  | "nessuna"
  | "scrittura";

export const EXPECTED: readonly Expected[] = [
  "linea",
  "freccia",
  "rettangolo",
  "ellisse",
  "cerchio",
  "triangolo",
  "quadrilatero",
  "pentagono",
  "esagono",
  "stella",
  "nessuna",
  "scrittura",
];

// ---------------------------------------------------------------------------
// I percorsi.

/// Un percorso da seguire: denso, un punto almeno ogni pixel, e gli indici
/// dove la mano si ferma, gli spigoli.
interface Gesture {
  readonly path: readonly Point[];
  readonly stops: readonly number[];
}

const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/// L'angolo di cui gira la spezzata in `b`, in gradi.
function turnAt(a: Point, b: Point, c: Point): number {
  const u = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs(((v - u) * 180) / Math.PI) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/// La spezzata da `points`, con gli spigoli arrotondati: ogni spigolo che
/// gira più di 20° diventa una curva che comincia e finisce a `rounding`
/// della metà del lato più corto. La mano si ferma negli spigoli che girano
/// più di 45°.
function polyline(given: readonly Point[], rounding = 0.1): Gesture {
  // Due punti uguali di fila sono uno.
  const points = given.filter((p, i) => i === 0 || distance(given[i - 1]!, p) > 0);
  const path: Point[] = [points[0]!];
  const stops: number[] = [];
  const toward = (from: Point, to: Point): void => {
    const steps = Math.max(1, Math.ceil(distance(from, to)));
    for (let s = 1; s <= steps; s++) path.push([from[0] + ((to[0] - from[0]) * s) / steps, from[1] + ((to[1] - from[1]) * s) / steps]);
  };
  let at = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const corner = points[i]!;
    const next = points[i + 1];
    if (next === undefined) {
      toward(at, corner);
      break;
    }
    const angle = turnAt(points[i - 1]!, corner, next);
    if (angle <= 20) {
      toward(at, corner);
      at = corner;
      continue;
    }
    const r = (rounding * Math.min(distance(points[i - 1]!, corner), distance(corner, next))) / 2;
    const into: Point = [corner[0] + ((points[i - 1]![0] - corner[0]) * r) / distance(points[i - 1]!, corner), corner[1] + ((points[i - 1]![1] - corner[1]) * r) / distance(points[i - 1]!, corner)];
    const out: Point = [corner[0] + ((next[0] - corner[0]) * r) / distance(corner, next), corner[1] + ((next[1] - corner[1]) * r) / distance(corner, next)];
    toward(at, into);
    const steps = Math.max(2, Math.ceil(2 * r));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      path.push([
        (1 - t) ** 2 * into[0] + 2 * (1 - t) * t * corner[0] + t * t * out[0],
        (1 - t) ** 2 * into[1] + 2 * (1 - t) * t * corner[1] + t * t * out[1],
      ]);
      if (s === Math.floor(steps / 2) && angle > 45) stops.push(path.length - 1);
    }
    at = out;
  }
  return { path, stops };
}

/// Un arco d'ellisse dal centro `center`, coi semiassi `rx` e `ry`, girata
/// di `angle` gradi: da `start` gradi per `sweep` gradi, negativo in senso
/// antiorario.
function arc(center: Point, rx: number, ry: number, angle: number, start: number, sweep: number): Gesture {
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const steps = Math.ceil((Math.abs(sweep) / 360) * 2 * Math.PI * Math.max(rx, ry));
  const path: Point[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = ((start + (sweep * s) / steps) * Math.PI) / 180;
    const u = rx * Math.cos(t);
    const v = ry * Math.sin(t);
    path.push([center[0] + u * cos - v * sin, center[1] + u * sin + v * cos]);
  }
  return { path, stops: [] };
}

/// Una curva qualunque, da `f` fra 0 e 1, in `steps` passi.
function curve(f: (t: number) => Point, steps: number): Gesture {
  const path: Point[] = [];
  for (let s = 0; s <= steps; s++) path.push(f(s / steps));
  return { path, stops: [] };
}

/// Più gesti di fila, come un tratto solo: la mano si ferma fra l'uno e
/// l'altro.
function chain(...gestures: Gesture[]): Gesture {
  const path: Point[] = [];
  const stops: number[] = [];
  for (const gesture of gestures) {
    if (path.length > 0) stops.push(path.length - 1);
    const offset = path.length;
    path.push(...(path.length > 0 ? gesture.path.slice(1) : gesture.path));
    for (const stop of gesture.stops) stops.push(stop + offset - (offset > 0 ? 1 : 0));
  }
  return { path, stops };
}

// ---------------------------------------------------------------------------
// La mano.

interface Manner {
  readonly device: "pen" | "mouse";
  /// I campioni al secondo.
  readonly rate: number;
  /// Lo scarto del tremore, in pixel.
  readonly tremor: number;
  /// La deriva lenta di lato, in parti della diagonale del tratto.
  readonly drift: number;
  /// Più lenta sopra 1, più svelta sotto.
  readonly pace: number;
}

const PEN: Manner = { device: "pen", rate: 120, tremor: 0.3, drift: 0.008, pace: 1 };
const FAST_PEN: Manner = { ...PEN, rate: 240 };
const MOUSE: Manner = { device: "mouse", rate: 60, tremor: 0, drift: 0.01, pace: 1.3 };

class Hand {
  private readonly rng: Mulberry32;

  constructor(seed: number) {
    this.rng = new Mulberry32(seed);
  }

  /// Uniforme in [0, 1).
  uniform(): number {
    return this.rng.next() / 2 ** 32;
  }

  /// Normale, media 0 e scarto 1 (Box–Muller).
  gauss(): number {
    const u = Math.max(this.uniform(), 1e-12);
    const v = this.uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /// I campioni di chi segue `gesture` nel modo `manner`.
  perform(gesture: Gesture, manner: Manner): InkSample[] {
    const path = gesture.path;
    const along = [0];
    for (let i = 1; i < path.length; i++) along.push(along[i - 1]! + distance(path[i - 1]!, path[i]!));
    const total = along[along.length - 1]!;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of path) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const size = Math.hypot(maxX - minX, maxY - minY);

    // I pezzi fra uno spigolo e l'altro, ciascuno a strappo minimo, con una
    // sosta nello spigolo.
    const marks = [0, ...[...gesture.stops].sort((a, b) => a - b), path.length - 1];
    const pieces: { t0: number; t1: number; s0: number; s1: number }[] = [];
    let clock = 0;
    for (let k = 1; k < marks.length; k++) {
      const s0 = along[marks[k - 1]!]!;
      const s1 = along[marks[k]!]!;
      if (s1 <= s0) continue;
      const duration = manner.pace * (110 + 3.2 * (s1 - s0) ** 0.75) * (0.85 + 0.3 * this.uniform());
      pieces.push({ t0: clock, t1: clock + duration, s0, s1 });
      clock += duration;
      if (k < marks.length - 1) clock += 15 + 25 * this.uniform();
    }
    const end = clock;
    if (!(end > 0 && Number.isFinite(end))) throw new Error("un gesto senza durata");

    // La deriva: tre onde lente lungo il tratto.
    const waves = [0.6, 0.3, 0.1].map((weight, k) => ({
      weight,
      frequency: [0.7, 1.6, 3.1][k]! * (0.8 + 0.4 * this.uniform()),
      phase: 2 * Math.PI * this.uniform(),
    }));
    const drift = (s: number): number =>
      size * manner.drift * waves.reduce((sum, w) => sum + w.weight * Math.sin((2 * Math.PI * w.frequency * s) / total + w.phase), 0);
    const pointAt = (s: number): { at: Point; normal: Point } => {
      let lo = 0;
      let hi = along.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (along[mid]! <= s) lo = mid;
        else hi = mid;
      }
      const a = path[lo]!;
      const b = path[hi]!;
      const span = along[hi]! - along[lo]!;
      const t = span > 0 ? (s - along[lo]!) / span : 0;
      const length = distance(a, b) || 1;
      return { at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], normal: [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] };
    };
    const progress = (t: number): number => {
      for (const piece of pieces) {
        if (t < piece.t0) return piece.s0;
        if (t <= piece.t1) {
          const tau = (t - piece.t0) / (piece.t1 - piece.t0);
          return piece.s0 + (piece.s1 - piece.s0) * (10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5);
        }
      }
      return total;
    };

    const pen = manner.device === "pen";
    const step = 1000 / manner.rate;
    const phase = 2 * Math.PI * this.uniform();
    const samples: InkSample[] = [];
    let shakeX = 0;
    let shakeY = 0;
    let previous: InkSample | null = null;
    for (let i = 0; ; i++) {
      const t = i === 0 ? 0 : Math.min(end, i * step + (this.uniform() - 0.5) * (pen ? 0.4 : 3));
      // Il tremore passa dal filtro del digitalizzatore: lento, e piccolo.
      shakeX = 0.8 * shakeX + 0.6 * manner.tremor * this.gauss();
      shakeY = 0.8 * shakeY + 0.6 * manner.tremor * this.gauss();
      const s = progress(t);
      const { at, normal } = pointAt(s);
      let x = at[0] + normal[0] * drift(s) + shakeX;
      let y = at[1] + normal[1] * drift(s) + shakeY;
      if (!pen) {
        x = Math.round(x);
        y = Math.round(y);
      }
      const p = pen
        ? Math.min(1, Math.max(0.05, 0.12 + 0.48 * (1 - Math.exp(-t / 30)) + 0.07 * Math.sin((2 * Math.PI * t) / 310 + phase) + 0.015 * this.gauss()))
        : undefined;
      const sample: InkSample = p === undefined ? { x, y, t } : { x, y, p, t };
      // Il mouse fermo non manda niente, e due campioni uguali sono uno.
      if (previous === null || previous.x !== x || previous.y !== y || (pen && previous.p !== p)) {
        if (previous === null || t > previous.t) samples.push(sample);
        previous = sample;
      }
      if (t >= end) break;
    }
    return samples;
  }
}

// ---------------------------------------------------------------------------
// Il corpus.

interface Entry {
  readonly expected: Expected;
  readonly gesture: Gesture;
  readonly manner?: Manner;
}

type Sheet = (hand: Hand) => Entry[];

/// I punti di un poligono regolare di `count` lati, dal centro `center`
/// col raggio `r`, girato di `angle` gradi.
function ngon(center: Point, r: number, count: number, angle: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = ((angle + (360 * i) / count - 90) * Math.PI) / 180;
    out.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]);
  }
  return out;
}

/// Un giro di `corners` che parte da `start` (fra uno spigolo e il
/// successivo, in parti del lato) e finisce oltre l'inizio di `over` parti
/// del primo lato, o prima, se è negativo.
function around(corners: readonly Point[], start: number, over: number): Point[] {
  const k = corners.length;
  const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const begin = lerp(corners[0]!, corners[1 % k]!, start);
  const out: Point[] = [begin];
  for (let i = 1; i <= k; i++) out.push(corners[i % k]!);
  if (over >= 0) {
    out.push(lerp(corners[0]!, corners[1 % k]!, Math.min(1, start + over)));
  } else {
    // Il giro si ferma prima dell'inizio: sull'ultimo lato, o sul primo.
    const back = start + over;
    if (back >= 0) out.push(lerp(corners[0]!, corners[1 % k]!, back));
    else out[out.length - 1] = lerp(corners[k - 1]!, corners[0]!, 1 + back);
  }
  return out;
}

/// Una freccia da `tail` a `tip`: i lati della punta lunghi `barb` volte
/// l'asta, a `left` e `right` gradi dall'asta. `closed` disegna la punta
/// come un triangolo, altrimenti un lato, ritorno alla cima, l'altro.
function arrowGesture(tail: Point, tip: Point, barb: number, left: number, right: number, closed = false): Gesture {
  const length = distance(tail, tip);
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
  const side = (degrees: number): Point => {
    const a = angle + Math.PI + (degrees * Math.PI) / 180;
    return [tip[0] + barb * length * Math.cos(a), tip[1] + barb * length * Math.sin(a)];
  };
  const one = side(-left);
  const two = side(right);
  return polyline(closed ? [tail, tip, one, two, tip] : [tail, tip, one, tip, two], 0.05);
}

const SHEETS: Readonly<Record<string, readonly [title: string, sheet: Sheet]>> = {
  linee: [
    "Linee",
    () => [
      { expected: "linea", gesture: polyline([[100, 100], [500, 104]]) },
      { expected: "linea", gesture: polyline([[650, 80], [650, 380]]) },
      { expected: "linea", gesture: polyline([[800, 350], [1000, 150]]) },
      // Un ricciolo all'appoggio e uno all'alzata.
      { expected: "linea", gesture: polyline([[1092, 140], [1100, 120], [1500, 300]], 0.4) },
      { expected: "linea", gesture: polyline([[500, 520], [150, 460], [158, 470]], 0.4) },
      { expected: "linea", gesture: polyline([[700, 500], [790, 470]]) },
      { expected: "linea", gesture: polyline([[900, 900], [1200, 380]]), manner: { ...PEN, drift: 0.015 } },
      { expected: "linea", gesture: polyline([[150, 700], [450, 716]]), manner: MOUSE },
      { expected: "linea", gesture: curve((t) => [150 + 500 * t, 850 - 12 * Math.sin(Math.PI * t)], 500), manner: { ...PEN, pace: 1.6 } },
      { expected: "linea", gesture: polyline([[1300, 600], [1550, 920]]), manner: { ...PEN, tremor: 0.8 } },
    ],
  ],
  frecce: [
    "Frecce",
    () => [
      { expected: "freccia", gesture: arrowGesture([100, 150], [450, 150], 0.18, 30, 30) },
      { expected: "freccia", gesture: arrowGesture([600, 80], [600, 400], 0.2, 35, 35) },
      { expected: "freccia", gesture: arrowGesture([800, 420], [1050, 170], 0.22, 25, 28) },
      { expected: "freccia", gesture: arrowGesture([1500, 250], [1150, 260], 0.16, 30, 30, true) },
      { expected: "freccia", gesture: arrowGesture([150, 550], [450, 700], 0.33, 42, 45) },
      { expected: "freccia", gesture: arrowGesture([600, 600], [760, 560], 0.25, 32, 30) },
      { expected: "freccia", gesture: arrowGesture([900, 850], [1250, 800], 0.15, 20, 40) },
      { expected: "freccia", gesture: arrowGesture([1350, 900], [1450, 550], 0.2, 30, 30), manner: MOUSE },
    ],
  ],
  rettangoli: [
    "Rettangoli",
    () => {
      const rect = (x: number, y: number, w: number, h: number): Point[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const turned = (corners: Point[], degrees: number): Point[] => {
        const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length;
        const cy = corners.reduce((s, p) => s + p[1], 0) / corners.length;
        const a = (degrees * Math.PI) / 180;
        return corners.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
      };
      return [
        { expected: "rettangolo", gesture: polyline(around(rect(100, 100, 300, 180), 0, -0.03)) },
        { expected: "rettangolo", gesture: polyline(around(rect(500, 80, 250, 240), 0.5, 0.25)) },
        { expected: "rettangolo", gesture: polyline(around(rect(850, 100, 400, 120).reverse(), 0.2, 0.05), 0.4) },
        { expected: "rettangolo", gesture: polyline(around(turned(rect(1300, 120, 230, 150), 30), 0.1, 0.1)) },
        { expected: "rettangolo", gesture: polyline(around(turned(rect(120, 420, 320, 200), 4), 0.6, -0.05)) },
        { expected: "rettangolo", gesture: polyline(around(rect(550, 480, 380, 60), 0.3, 0.1), 0.3) },
        { expected: "rettangolo", gesture: polyline(around(rect(1050, 400, 300, 200), 0, 0.02)), manner: MOUSE },
        { expected: "rettangolo", gesture: polyline(around(rect(200, 700, 700, 260), 0.4, 0.15), 0.5), manner: { ...PEN, drift: 0.015 } },
      ];
    },
  ],
  ellissi: [
    "Ellissi e cerchi",
    () => [
      { expected: "cerchio", gesture: arc([200, 200], 100, 100, 0, -90, 360 + 54) },
      { expected: "cerchio", gesture: arc([450, 180], 62, 58, 0, 200, -340) },
      { expected: "cerchio", gesture: arc([750, 220], 150, 140, 20, 10, 360 + 90) },
      { expected: "ellisse", gesture: arc([1150, 200], 200, 100, 0, 180, 370) },
      { expected: "ellisse", gesture: arc([1400, 520], 125, 40, 0, -90, -380) },
      { expected: "ellisse", gesture: arc([300, 550], 110, 220, 35, 0, 365), manner: { ...PEN, drift: 0.012 } },
      { expected: "ellisse", gesture: arc([750, 560], 70, 150, 0, 90, 345) },
      { expected: "ellisse", gesture: arc([1050, 600], 180, 110, 5, 0, 375) },
      { expected: "cerchio", gesture: arc([300, 860], 90, 92, 0, 0, 365), manner: MOUSE },
      { expected: "ellisse", gesture: arc([900, 880], 230, 90, -3, 120, 380), manner: MOUSE },
    ],
  ],
  triangoli: [
    "Triangoli",
    () => [
      { expected: "triangolo", gesture: polyline(around(ngon([250, 220], 150, 3, 0), 0, 0.05)) },
      { expected: "triangolo", gesture: polyline(around([[550, 100], [550, 400], [850, 400]], 0, -0.04)) },
      { expected: "triangolo", gesture: polyline(around([[950, 380], [1500, 380], [1100, 250]], 0.3, 0.1), 0.2) },
      { expected: "triangolo", gesture: polyline(around([[300, 450], [400, 900], [200, 900]], 0, 0.08)) },
      { expected: "triangolo", gesture: polyline(around(ngon([700, 700], 160, 3, 40), 0.5, 0.15), 0.3), manner: { ...PEN, drift: 0.012 } },
      { expected: "triangolo", gesture: polyline(around([[950, 550], [1450, 640], [1000, 760]], 0, 0.06)) },
      { expected: "triangolo", gesture: polyline(around(ngon([1300, 870], 110, 3, 180), 0, 0.03)), manner: MOUSE },
    ],
  ],
  poligoni: [
    "Poligoni",
    () => [
      { expected: "quadrilatero", gesture: polyline(around([[100, 300], [180, 100], [420, 100], [500, 300]], 0, 0.05)) },
      { expected: "quadrilatero", gesture: polyline(around([[600, 300], [700, 100], [1000, 100], [900, 300]], 0.5, 0.1)) },
      { expected: "quadrilatero", gesture: polyline(around([[1250, 80], [1400, 200], [1250, 320], [1100, 200]], 0, 0.05)) },
      { expected: "pentagono", gesture: polyline(around(ngon([250, 600], 160, 5, 0), 0, 0.06)) },
      { expected: "pentagono", gesture: polyline(around([[550, 750], [550, 550], [700, 430], [850, 550], [850, 750]], 0, -0.03)) },
      { expected: "esagono", gesture: polyline(around(ngon([1100, 600], 170, 6, 30), 0.3, 0.1)) },
      { expected: "esagono", gesture: polyline(around(ngon([1350, 870], 110, 6, 0), 0, 0.05)), manner: { ...PEN, drift: 0.012 } },
    ],
  ],
  stelle: [
    "Stelle",
    () => {
      // Una stella {n/m} senza staccare: i vertici di un poligono regolare,
      // di `m` in `m`, fino a tornare al primo.
      const star = (center: Point, r: number, count: number, step: number, angle: number): Point[] => {
        const corners = ngon(center, r, count, angle);
        return [...corners.map((_, i) => corners[(step * i) % count]!), corners[0]!];
      };
      return [
        { expected: "stella", gesture: polyline(star([250, 250], 170, 5, 2, 0), 0.05) },
        { expected: "stella", gesture: polyline(star([700, 260], 150, 5, 2, 12), 0.05), manner: { ...PEN, drift: 0.01 } },
        { expected: "stella", gesture: polyline(star([1150, 260], 170, 7, 3, 0), 0.04) },
        { expected: "stella", gesture: polyline(star([450, 700], 180, 7, 2, 0), 0.05) },
        { expected: "stella", gesture: polyline(star([1000, 720], 160, 5, 2, 180), 0.05), manner: MOUSE },
      ];
    },
  ],
  nessuna: [
    "Nessuna forma",
    () => [
      // Un arco, una S, uno zig-zag, una L, una V e una U.
      { expected: "nessuna", gesture: arc([250, 250], 150, 150, 0, 180, 180) },
      { expected: "nessuna", gesture: curve((t) => [500 + 300 * t, 250 + 90 * Math.sin(2 * Math.PI * t)], 400) },
      { expected: "nessuna", gesture: polyline([[900, 300], [980, 120], [1060, 300], [1140, 120], [1220, 300]], 0.1) },
      { expected: "nessuna", gesture: polyline([[1350, 80], [1350, 380], [1550, 380]]) },
      { expected: "nessuna", gesture: polyline([[100, 450], [250, 750], [400, 450]]) },
      { expected: "nessuna", gesture: chain(polyline([[500, 450], [500, 650]]), arc([600, 650], 100, 100, 0, 180, -180), polyline([[700, 650], [700, 450]])) },
      // Una spirale, un'onda, una C molto aperta, un fiocco che si incrocia,
      // un otto e uno scarabocchio.
      { expected: "nessuna", gesture: curve((t) => [950 + (20 + 130 * t) * Math.cos(4 * Math.PI * t), 600 + (20 + 130 * t) * Math.sin(4 * Math.PI * t)], 900) },
      { expected: "nessuna", gesture: curve((t) => [1200 + 350 * t, 600 + 40 * Math.sin(6 * Math.PI * t)], 600) },
      { expected: "nessuna", gesture: arc([250, 880], 100, 100, 0, -40, 260) },
      { expected: "nessuna", gesture: polyline([[500, 800], [800, 960], [800, 800], [500, 960], [500, 800]], 0.05) },
      { expected: "nessuna", gesture: curve((t) => [1000 + 110 * Math.sin(2 * Math.PI * t), 880 + 90 * Math.sin(4 * Math.PI * t)], 600) },
      { expected: "nessuna", gesture: curve((t) => [1250 + 150 * t + 50 * Math.sin(23 * t), 880 + 60 * Math.sin(17 * t) * Math.cos(5 * t)], 700) },
    ],
  ],
  scrittura: [
    "Scrittura",
    () => {
      const at = (x: number, y: number, points: readonly Point[]): Point[] => points.map(([u, v]) => [x + u, y + v]);
      const letter = (x: number, y: number, points: readonly Point[]): Gesture => polyline(at(x, y, points), 0.3);
      /// Una parola in corsivo, alta 14 pixel sopra la riga e 33 con le
      /// aste, da sinistra a destra con le lettere legate.
      const word = (x: number, y: number, text: string): Gesture => {
        const points: Point[] = [];
        let advance = 0;
        for (const c of text) {
          const glyph = CURSIVE[c]!;
          for (const [u, v] of glyph.points) points.push([x + advance + u, y + v]);
          advance += glyph.advance;
        }
        // La mano che scrive non si ferma negli spigoli delle lettere.
        return { path: polyline(points, 0.6).path, stops: [] };
      };
      return [
        // Lettere e cifre staccate, alte quanto la scrittura.
        { expected: "scrittura", gesture: letter(100, 100, [[2, 0], [0, 30]]) },
        { expected: "scrittura", gesture: letter(150, 100, [[-6, 8], [0, 0], [0, 30]]) },
        { expected: "scrittura", gesture: arc([220, 120], 8, 10, 0, -80, 375) },
        { expected: "scrittura", gesture: arc([270, 115], 10, 17, 0, -90, 370) },
        { expected: "scrittura", gesture: arc([320, 120], 9, 10, 0, -40, -280) },
        { expected: "scrittura", gesture: chain(arc([370, 120], 9, 10, 0, -20, -340), polyline([[379, 115], [380, 131]])) },
        { expected: "scrittura", gesture: chain(polyline([[410, 120], [428, 120]]), arc([419, 120], 9, 10, 0, 0, -300)) },
        { expected: "scrittura", gesture: letter(470, 100, [[0, 0], [18, 0], [6, 30]]) },
        { expected: "scrittura", gesture: letter(520, 100, [[12, 0], [0, 20], [20, 20]]) },
        { expected: "scrittura", gesture: letter(570, 100, [[0, 0], [0, 34], [22, 34]]) },
        { expected: "scrittura", gesture: letter(620, 100, [[0, 0], [20, 0], [0, 26], [20, 26]]) },
        { expected: "scrittura", gesture: letter(670, 110, [[0, 10], [8, 20], [26, 0]]) },
        { expected: "scrittura", gesture: letter(720, 115, [[0, 0], [16, 1]]) },
        { expected: "scrittura", gesture: arc([800, 118], 15, 18, 0, -90, 368) },
        { expected: "scrittura", gesture: letter(860, 100, [[0, 8], [10, 0], [18, 6], [0, 30], [20, 30]]) },
        // Parole in corsivo.
        { expected: "scrittura", gesture: word(100, 330, "mare") },
        { expected: "scrittura", gesture: word(250, 330, "ciao") },
        { expected: "scrittura", gesture: word(400, 330, "lumaca") },
        { expected: "scrittura", gesture: word(600, 330, "camino") },
        { expected: "scrittura", gesture: word(800, 330, "ancora"), manner: FAST_PEN },
        { expected: "scrittura", gesture: word(1000, 330, "nuo"), manner: MOUSE },
        { expected: "scrittura", gesture: word(100, 480, "lunaria") },
        { expected: "scrittura", gesture: word(350, 480, "mammina") },
      ];
    },
  ],
};

/// I nomi dei file sintetici, senza `sintetico-` e senza `.svg`.
export const SYNTHETIC: readonly string[] = Object.keys(SHEETS);

/// Le lettere del corsivo: i punti, dalla fine della lettera prima, e quanto
/// avanza la penna. La riga è a 0, l'altezza delle minuscole a -14.
const CURSIVE: Readonly<Record<string, { readonly points: readonly Point[]; readonly advance: number }>> = {
  a: { points: [[9, -11], [5, -14], [1, -11], [0, -4], [3, 0], [8, -5], [9, -14], [9, -3], [11, 0]], advance: 12 },
  c: { points: [[9, -12], [5, -14], [1, -10], [0, -4], [3, 0], [8, -1], [11, -3]], advance: 11 },
  e: { points: [[0, -4], [9, -8], [8, -14], [3, -13], [0, -6], [2, -1], [7, 0], [11, -3]], advance: 11 },
  i: { points: [[0, 0], [2, -14], [2, -2], [4, 0], [6, -2]], advance: 7 },
  l: { points: [[0, 0], [8, -20], [9, -32], [5, -33], [3, -25], [4, -8], [7, 0], [11, -3]], advance: 11 },
  m: { points: [[0, 0], [2, -14], [3, 0], [5, -13], [8, -13], [9, 0], [11, -13], [14, -13], [15, 0]], advance: 16 },
  n: { points: [[0, 0], [2, -14], [3, 0], [6, -13], [10, -13], [11, 0]], advance: 12 },
  o: { points: [[4, -14], [0, -8], [1, -1], [6, 0], [9, -6], [8, -13], [4, -14], [10, -13]], advance: 11 },
  r: { points: [[0, 0], [2, -14], [3, -9], [6, -13], [9, -12], [8, -6], [10, 0]], advance: 10 },
  u: { points: [[0, -14], [1, -2], [5, 0], [9, -14], [9, -2], [11, 0]], advance: 11 },
};

/// Il seme di un foglio: lo stesso foglio dà sempre gli stessi tratti.
function seedOf(name: string): number {
  let hash = 0x20261006;
  for (const c of name) hash = Math.imul(hash ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

/// Il disegno `sintetico-<name>.svg`, come lo scriverebbe FubDraw: la
/// carta, un livello, e un tratto a penna per voce, col risultato atteso
/// per nome.
export function synthesize(name: string): string {
  const [title, sheet] = SHEETS[name]!;
  const hand = new Hand(seedOf(name));
  const entries = sheet(hand);
  let layer = new El("g").a("id", "l00000001").a("fub:layer", "Livello 1");
  entries.forEach((entry, i) => {
    const manner = entry.manner ?? PEN;
    const samples = hand.perform(entry.gesture, manner);
    const pressure = manner.device === "pen";
    const brush = brushForInput({ ...PF1_DEFAULTS, size: 4, sim: false }, pressure);
    const ink = quantizeInk(samples);
    const id = `o${String(i + 1).padStart(8, "0")}`;
    const at = new Date(Date.UTC(2026, 9, 6, 9, 0, 2 * i)).toISOString();
    layer = layer.child(
      new El("path")
        .a("id", id)
        .a("fub:tool", "pen")
        .a("fub:at", at)
        .a("fub:brush", formatBrush(brush))
        .a("d", pf1(ink, brush))
        .a("fill", "#1f1f1f")
        .a("fub:ink", encodeInk(inkFromSamples(samples, 100)))
        .child(new El("title").text(entry.expected)),
    );
  });
  const root = new El("svg")
    .a("xmlns", SVG_NS)
    .a("xmlns:fub", FUB_NS)
    .a("fub:version", 1)
    .a("viewBox", "0 0 1600 1000")
    .a("width", 1600)
    .a("height", 1000)
    .child(new El("title").text(`Forme dal tratto: ${title.toLowerCase()}`))
    .child(new El("rect").a("id", "fub-paper").a("fub:role", "paper").a("x", 0).a("y", 0).a("width", 1600).a("height", 1000).a("fill", "#ffffff"))
    .child(layer);
  const out: string[] = [];
  root.write(0, "\n", out);
  return out.join("");
}
