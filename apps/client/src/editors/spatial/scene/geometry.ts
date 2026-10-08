// Geometria: la grammatica dei path di SVG 2 e il rettangolo che contiene una
// figura dopo le sue trasformazioni (formato della scena, §9).
//
// È `geometry.rs` di `fub-scene` con le stesse operazioni nello stesso ordine,
// perché il riepilogo della scena (`bbox`) deve uscire uguale al centesimo
// dai due lati. Il rettangolo è esatto: una curva di Bézier trasformata da una
// matrice affine resta una curva di Bézier con i punti di controllo
// trasformati, e i suoi estremi si trovano annullando la derivata; un arco
// ellittico trasformato resta un arco, e i suoi estremi si trovano in forma
// chiusa. Nessun punto di controllo entra nel rettangolo se la curva non ci
// passa.
//
// Dove Rust e JavaScript non coincidono da soli, qui si imita Rust:
// `f64::max` e `f64::min` ignorano un `NaN`, `copysign` guarda anche il segno
// di `-0`, `rem_euclid` porta il resto nel positivo. Restano le funzioni
// trascendenti (`sin`, `cos`, `atan2`), che ECMAScript lascia approssimare al
// motore: possono differire da quelle di Rust nell'ultima cifra binaria, che i
// centesimi del riepilogo assorbono salvo un valore a un soffio da un mezzo
// centesimo.

import { apply, compose, toRadians, type Matrix, type Point } from "./matrix";
import { scanNumber } from "./values";

/// Un segmento di path in coordinate assolute.
export type Segment =
  | { readonly kind: "move"; readonly to: Point }
  | { readonly kind: "line"; readonly to: Point }
  | { readonly kind: "quad"; readonly control: Point; readonly to: Point }
  | { readonly kind: "cubic"; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | {
    readonly kind: "arc";
    readonly radii: Point;
    readonly rotation: number;
    readonly large: boolean;
    readonly sweep: boolean;
    readonly to: Point;
  }
  | { readonly kind: "close" };

const TAU = 2 * Math.PI;

/// `f64::max`: un `NaN` perde contro un numero.
export function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a > b ? a : b;
}

/// `f64::min`: un `NaN` perde contro un numero.
export function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a < b ? a : b;
}

/// `f64::copysign`: il modulo di `magnitude` con il segno di `sign`, `-0`
/// compreso.
function copysign(magnitude: number, sign: number): number {
  const negative = sign < 0 || Object.is(sign, -0);
  return negative ? -Math.abs(magnitude) : Math.abs(magnitude);
}

/// `f64::rem_euclid`: il resto di `a / b` portato in `[0, |b|)`.
export function remEuclid(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + Math.abs(b) : r;
}

function isWsp(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;
}

function isAsciiLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/// Il lettore della grammatica dei path di SVG 2.
class PathParser {
  i = 0;

  constructor(readonly text: string) {}

  at(): number {
    return this.i < this.text.length ? this.text.charCodeAt(this.i) : -1;
  }

  skipWsp(): void {
    while (this.i < this.text.length && isWsp(this.text.charCodeAt(this.i))) this.i++;
  }

  /// `comma_wsp?`: vero se c'era una virgola.
  skipSeparator(): boolean {
    this.skipWsp();
    const comma = this.at() === 0x2c;
    if (comma) {
      this.i++;
      this.skipWsp();
    }
    return comma;
  }

  /// `comma_wsp` obbligatorio: almeno uno spazio o una virgola.
  requireSeparator(): boolean {
    const from = this.i;
    this.skipSeparator();
    return this.i > from;
  }

  number(): number | null {
    const scanned = scanNumber(this.text, this.i);
    if (scanned === null) return null;
    this.i = scanned[1];
    return scanned[0];
  }

  /// Un numero senza segno, come i raggi di un arco.
  unsigned(): number | null {
    const c = this.at();
    return c === 0x2b || c === 0x2d ? null : this.number();
  }

  flag(): boolean | null {
    const c = this.at();
    if (c !== 0x30 && c !== 0x31) return null;
    this.i++;
    return c === 0x31;
  }

  pair(): Point | null {
    const x = this.number();
    if (x === null) return null;
    this.skipSeparator();
    const y = this.number();
    return y === null ? null : [x, y];
  }

  startsNumber(): boolean {
    const c = this.at();
    return (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e;
  }
}

/// Il riflesso di un punto di controllo intorno al punto corrente; il punto
/// corrente stesso se il segmento precedente non era della stessa famiglia.
function reflect(control: Point | null, current: Point): Point {
  return control === null ? current : [2 * current[0] - control[0], 2 * current[1] - control[1]];
}

/// Legge un attributo `d` con la grammatica completa di SVG 2: comandi
/// assoluti e relativi, comandi impliciti, flag degli archi attaccati, numeri
/// compatti. Un `d` vuoto è valido e non disegna niente; un `d` malformato è
/// `null`, perché un browser lo disegna solo fino al primo errore.
export function parsePath(d: string): Segment[] | null {
  const p = new PathParser(d);
  const segments: Segment[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  // L'ultimo punto di controllo di una cubica o di una quadratica, per i
  // comandi `S` e `T` che lo riflettono.
  let lastCubic: Point | null = null;
  let lastQuad: Point | null = null;
  let previous: number | null = null;
  p.skipWsp();
  if (p.i === d.length) return segments;
  if (p.at() !== 0x4d && p.at() !== 0x6d) return null;
  while (p.i < d.length) {
    let command: number;
    if (isAsciiLetter(p.at())) {
      command = p.at();
      p.i++;
      p.skipWsp();
    } else if (p.startsNumber()) {
      if (previous === 0x4d) command = 0x4c;
      else if (previous === 0x6d) command = 0x6c;
      else if (previous === null || previous === 0x5a || previous === 0x7a) return null;
      else command = previous;
    } else {
      return null;
    }
    const relative = command >= 0x61;
    const base: Point = relative ? current : [0, 0];
    const at = (q: Point): Point => [base[0] + q[0], base[1] + q[1]];
    let cubic: Point | null = null;
    let quad: Point | null = null;
    switch (relative ? command - 0x20 : command) {
      case 0x4d: {
        const q = p.pair();
        if (q === null) return null;
        current = at(q);
        start = current;
        segments.push({ kind: "move", to: current });
        break;
      }
      case 0x4c: {
        const q = p.pair();
        if (q === null) return null;
        current = at(q);
        segments.push({ kind: "line", to: current });
        break;
      }
      case 0x48: {
        const n = p.number();
        if (n === null) return null;
        current = [base[0] + n, current[1]];
        segments.push({ kind: "line", to: current });
        break;
      }
      case 0x56: {
        const n = p.number();
        if (n === null) return null;
        current = [current[0], base[1] + n];
        segments.push({ kind: "line", to: current });
        break;
      }
      case 0x43: {
        const q1 = p.pair();
        if (q1 === null) return null;
        const c1 = at(q1);
        p.skipSeparator();
        const q2 = p.pair();
        if (q2 === null) return null;
        const c2 = at(q2);
        p.skipSeparator();
        const q3 = p.pair();
        if (q3 === null) return null;
        current = at(q3);
        segments.push({ kind: "cubic", c1, c2, to: current });
        cubic = c2;
        break;
      }
      case 0x53: {
        const c1 = reflect(lastCubic, current);
        const q2 = p.pair();
        if (q2 === null) return null;
        const c2 = at(q2);
        p.skipSeparator();
        const q3 = p.pair();
        if (q3 === null) return null;
        current = at(q3);
        segments.push({ kind: "cubic", c1, c2, to: current });
        cubic = c2;
        break;
      }
      case 0x51: {
        const q1 = p.pair();
        if (q1 === null) return null;
        const c = at(q1);
        p.skipSeparator();
        const q2 = p.pair();
        if (q2 === null) return null;
        current = at(q2);
        segments.push({ kind: "quad", control: c, to: current });
        quad = c;
        break;
      }
      case 0x54: {
        const c = reflect(lastQuad, current);
        const q = p.pair();
        if (q === null) return null;
        current = at(q);
        segments.push({ kind: "quad", control: c, to: current });
        quad = c;
        break;
      }
      case 0x41: {
        const rx = p.unsigned();
        if (rx === null) return null;
        p.skipSeparator();
        const ry = p.unsigned();
        if (ry === null) return null;
        p.skipSeparator();
        const rotation = p.number();
        if (rotation === null || !p.requireSeparator()) return null;
        const large = p.flag();
        if (large === null) return null;
        p.skipSeparator();
        const sweep = p.flag();
        if (sweep === null) return null;
        p.skipSeparator();
        const q = p.pair();
        if (q === null) return null;
        current = at(q);
        segments.push({ kind: "arc", radii: [rx, ry], rotation, large, sweep, to: current });
        break;
      }
      case 0x5a:
        current = start;
        segments.push({ kind: "close" });
        break;
      default:
        return null;
    }
    lastCubic = cubic;
    lastQuad = quad;
    previous = command;
    if (command === 0x5a || command === 0x7a) {
      p.skipWsp();
    } else if (p.skipSeparator() && !p.startsNumber()) {
      // Una virgola chiude un argomento solo se ne segue un altro.
      return null;
    }
  }
  return segments;
}

/// Il rettangolo minimo che contiene un insieme di punti.
export interface Bounds {
  readonly min: Point;
  readonly max: Point;
}

/// Le radici reali di `a·t² + b·t + c`, anche quando l'equazione degenera in
/// una lineare. La forma è quella stabile: `q = −(b + segno(b)·√Δ) / 2`,
/// radici `q / a` e `c / q`.
function quadraticRoots(a: number, b: number, c: number): number[] {
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const q = -0.5 * (b + copysign(Math.sqrt(discriminant), b));
  // b = 0 e c = 0: la sola radice è 0, doppia.
  if (q === 0) return [0];
  return [q / a, c / q];
}

/// Un accumulatore di [`Bounds`]. I punti non finiti si scartano: vengono da
/// valori enormi moltiplicati fra loro, e un rettangolo infinito non dice
/// niente.
export class BoundsBuilder {
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private maxY = 0;
  private empty = true;

  include([x, y]: Point): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.empty) {
      this.minX = this.maxX = x;
      this.minY = this.maxY = y;
      this.empty = false;
      return;
    }
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  finish(): Bounds | null {
    return this.empty ? null : { min: [this.minX, this.minY], max: [this.maxX, this.maxY] };
  }

  /// Aggiunge i segmenti di un path trasformati da `m`.
  path(segments: readonly Segment[], m: Matrix): void {
    let current: Point = [0, 0];
    let start: Point = [0, 0];
    for (const segment of segments) {
      switch (segment.kind) {
        case "move":
          current = segment.to;
          start = segment.to;
          break;
        case "line":
          this.include(apply(m, current));
          this.include(apply(m, segment.to));
          current = segment.to;
          break;
        case "quad":
          this.quad(apply(m, current), apply(m, segment.control), apply(m, segment.to));
          current = segment.to;
          break;
        case "cubic":
          this.cubic(apply(m, current), apply(m, segment.c1), apply(m, segment.c2), apply(m, segment.to));
          current = segment.to;
          break;
        case "arc":
          this.arc(current, segment.radii, segment.rotation, segment.large, segment.sweep, segment.to, m);
          current = segment.to;
          break;
        case "close":
          this.include(apply(m, current));
          this.include(apply(m, start));
          current = start;
          break;
      }
    }
  }

  private quad(p0: Point, p1: Point, p2: Point): void {
    this.include(p0);
    this.include(p2);
    for (const axis of [0, 1] as const) {
      // B'(t) = 0 per t = (p0 − p1) / (p0 − 2·p1 + p2).
      const denominator = p0[axis] - 2 * p1[axis] + p2[axis];
      if (denominator !== 0) {
        const t = (p0[axis] - p1[axis]) / denominator;
        if (t > 0 && t < 1) {
          const u = 1 - t;
          this.include([
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
          ]);
        }
      }
    }
  }

  private cubic(p0: Point, p1: Point, p2: Point, p3: Point): void {
    this.include(p0);
    this.include(p3);
    const point = (t: number): Point => {
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      return [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      ];
    };
    for (const axis of [0, 1] as const) {
      // B'(t)/3 = a·t² + b·t + c.
      const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
      const b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
      const c = p1[axis] - p0[axis];
      for (const t of quadraticRoots(a, b, c)) {
        if (t > 0 && t < 1) this.include(point(t));
      }
    }
  }

  /// Un arco ellittico da `from` a `to`, con la conversione al centro delle
  /// note d'implementazione di SVG (F.6.5) e gli estremi in forma chiusa.
  private arc(
    from: Point,
    radii: Point,
    rotation: number,
    large: boolean,
    sweep: boolean,
    to: Point,
    m: Matrix,
  ): void {
    // Estremi uguali: l'arco non si disegna (F.6.2).
    if (from[0] === to[0] && from[1] === to[1]) return;
    const arc = centerArc(from, radii, rotation, large, sweep, to);
    if (arc === null) {
      this.include(apply(m, from));
      this.include(apply(m, to));
      return;
    }
    const { center, radii: [rx, ry], sin, cos, theta1, delta } = arc;
    // P(θ) = M·c + A·(cos θ, sin θ), con A = lineare(M) · R(φ) · diag(rx, ry).
    const [a, b, c, d] = m;
    const linear = compose(compose([a, b, c, d, 0, 0], [cos, sin, -sin, cos, 0, 0]), [rx, 0, 0, ry, 0, 0]);
    const [a11, a21, a12, a22] = linear;
    const origin = apply(m, center);
    const point = (theta: number): Point => {
      const s = Math.sin(theta);
      const co = Math.cos(theta);
      return [origin[0] + a11 * co + a12 * s, origin[1] + a21 * co + a22 * s];
    };
    this.include(apply(m, from));
    this.include(apply(m, to));
    for (const base of [Math.atan2(a12, a11), Math.atan2(a22, a21)]) {
      for (const theta of [base, base + Math.PI]) {
        const offset = delta >= 0 ? remEuclid(theta - theta1, TAU) : -remEuclid(theta1 - theta, TAU);
        if (Math.abs(offset) <= Math.abs(delta)) this.include(point(theta));
      }
    }
  }

  /// Un'ellisse di centro `center` e raggi `radii`, trasformata da `m`.
  ellipse(center: Point, [rx, ry]: Point, m: Matrix): void {
    const [a, b, c, d] = m;
    const half: Point = [
      Math.sqrt((a * rx) * (a * rx) + (c * ry) * (c * ry)),
      Math.sqrt((b * rx) * (b * rx) + (d * ry) * (d * ry)),
    ];
    const o = apply(m, center);
    this.include([o[0] - half[0], o[1] - half[1]]);
    this.include([o[0] + half[0], o[1] + half[1]]);
  }
}

/// Un arco ellittico in forma di centro, con la conversione delle note
/// d'implementazione di SVG (F.6.5): i raggi già ingranditi se non bastavano a
/// unire gli estremi, la rotazione dell'asse x, l'angolo d'inizio e l'ampiezza
/// con il segno del verso.
export interface CenterArc {
  readonly center: Point;
  readonly radii: Point;
  readonly sin: number;
  readonly cos: number;
  readonly theta1: number;
  readonly delta: number;
}

/// L'arco da `from` a `to`; `null` se un raggio è nullo, e allora l'arco è il
/// segmento fra gli estremi (F.6.2). Gli estremi uguali, per cui l'arco non si
/// disegna, li esclude chi chiama.
export function centerArc(
  from: Point,
  radii: Point,
  rotation: number,
  large: boolean,
  sweep: boolean,
  to: Point,
): CenterArc | null {
  let rx = Math.abs(radii[0]);
  let ry = Math.abs(radii[1]);
  if (rx === 0 || ry === 0) return null;
  const radians = toRadians(rotation);
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coefficient = Math.sqrt(fmax(numerator / denominator, 0));
  if (large === sweep) coefficient = -coefficient;
  const cx1 = (coefficient * rx * y1) / ry;
  const cy1 = (-coefficient * ry * x1) / rx;
  const center: Point = [
    cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2,
    sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2,
  ];
  const theta1 = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  const theta2 = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx);
  let delta = remEuclid(theta2 - theta1, TAU);
  if (!sweep && delta > 0) delta -= TAU;
  return { center, radii: [rx, ry], sin, cos, theta1, delta };
}

/// Il punto dell'arco all'angolo `theta`, nelle coordinate del path.
export function arcPoint(arc: CenterArc, theta: number): Point {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const [rx, ry] = arc.radii;
  return [
    arc.center[0] + arc.cos * rx * c - arc.sin * ry * s,
    arc.center[1] + arc.sin * rx * c + arc.cos * ry * s,
  ];
}

/// In quante corde [`flatten`] divide una curva o un arco.
export const CURVE_STEPS = 16;

/// I sottotracciati di un path come poligoni, nelle coordinate di `m`: ogni
/// curva e ogni arco diventano [`CURVE_STEPS`] corde. Un poligono si intende
/// chiuso, come un sottotracciato quando lo si riempie. Serve a dire se un
/// punto sta dentro una figura piena, non a disegnarla: la corda di un quarto
/// d'ellisse in sedici parti si scosta dall'arco di meno di due millesimi del
/// raggio.
export function flatten(segments: readonly Segment[], m: Matrix): Point[][] {
  const polygons: Point[][] = [];
  let polygon: Point[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  const close = (): void => {
    if (polygon.length > 2) polygons.push(polygon);
    polygon = [];
  };
  const steps: number[] = [];
  for (let k = 1; k <= CURVE_STEPS; k++) steps.push(k / CURVE_STEPS);
  for (const segment of segments) {
    if (polygon.length === 0 && segment.kind !== "move") polygon.push(apply(m, current));
    switch (segment.kind) {
      case "move":
        close();
        polygon.push(apply(m, segment.to));
        current = segment.to;
        start = segment.to;
        break;
      case "line":
        polygon.push(apply(m, segment.to));
        current = segment.to;
        break;
      case "quad": {
        const [c, p] = [segment.control, segment.to];
        for (const t of steps) {
          const u = 1 - t;
          polygon.push(apply(m, [
            u * u * current[0] + 2 * u * t * c[0] + t * t * p[0],
            u * u * current[1] + 2 * u * t * c[1] + t * t * p[1],
          ]));
        }
        current = p;
        break;
      }
      case "cubic": {
        const { c1, c2, to: p } = segment;
        for (const t of steps) {
          const u = 1 - t;
          const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          polygon.push(apply(m, [
            a * current[0] + b * c1[0] + c * c2[0] + d * p[0],
            a * current[1] + b * c1[1] + c * c2[1] + d * p[1],
          ]));
        }
        current = p;
        break;
      }
      case "arc": {
        const to = segment.to;
        if (current[0] !== to[0] || current[1] !== to[1]) {
          const arc = centerArc(current, segment.radii, segment.rotation, segment.large, segment.sweep, to);
          if (arc === null) {
            polygon.push(apply(m, to));
          } else {
            for (const t of steps) polygon.push(apply(m, arcPoint(arc, arc.theta1 + arc.delta * t)));
          }
        }
        current = to;
        break;
      }
      case "close":
        close();
        current = start;
        break;
    }
  }
  close();
  return polygons;
}

/// Le corde di un tracciato come lo segue un testo (formato della scena,
/// testo): i sottotracciati uno dopo l'altro, con le curve e gli archi in
/// [`CURVE_STEPS`] corde come in [`flatten`], e `Z` che torna all'inizio del
/// sottotracciato. Gli spostamenti non sono corde.
export function chords(segments: readonly Segment[]): Array<[Point, Point]> {
  const out: Array<[Point, Point]> = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  const to = (p: Point): void => {
    if (p[0] !== current[0] || p[1] !== current[1]) out.push([current, p]);
    current = p;
  };
  const steps: number[] = [];
  for (let k = 1; k <= CURVE_STEPS; k++) steps.push(k / CURVE_STEPS);
  for (const segment of segments) {
    switch (segment.kind) {
      case "move":
        current = segment.to;
        start = segment.to;
        break;
      case "line":
        to(segment.to);
        break;
      case "quad": {
        const [from, c, p] = [current, segment.control, segment.to];
        for (const t of steps) {
          const u = 1 - t;
          to([u * u * from[0] + 2 * u * t * c[0] + t * t * p[0], u * u * from[1] + 2 * u * t * c[1] + t * t * p[1]]);
        }
        break;
      }
      case "cubic": {
        const [from, { c1, c2, to: p }] = [current, segment];
        for (const t of steps) {
          const u = 1 - t;
          const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          to([a * from[0] + b * c1[0] + c * c2[0] + d * p[0], a * from[1] + b * c1[1] + c * c2[1] + d * p[1]]);
        }
        break;
      }
      case "arc": {
        // Un arco fra due punti uguali non si disegna.
        if (current[0] === segment.to[0] && current[1] === segment.to[1]) break;
        const arc = centerArc(current, segment.radii, segment.rotation, segment.large, segment.sweep, segment.to);
        if (arc === null) to(segment.to);
        else for (const t of steps) to(arcPoint(arc, arc.theta1 + arc.delta * t));
        // L'ultimo punto dell'arco è `to` a meno dell'arrotondamento.
        current = segment.to;
        break;
      }
      case "close":
        to(start);
        break;
    }
  }
  return out;
}

/// Un punto lungo un tracciato e la direzione, lunga 1, in cui il tracciato
/// va lì.
export interface Along {
  readonly at: Point;
  readonly direction: Point;
}

/// Il punto di un tracciato a `distance` dal suo inizio, misurata lungo le
/// corde, e la sua direzione: dove un testo su tracciato tiene il punto di
/// `startOffset` (formato della scena, testo). Con `share` la distanza è una
/// frazione della lunghezza del tracciato; fuori dal tracciato si ferma al suo
/// estremo. `null` per un tracciato lungo zero.
export function along(segments: readonly Segment[], distance: number, share: boolean): Along | null {
  const track = new Track(segments);
  return track.at(share ? distance * track.length : distance);
}

/// Un tracciato misurato lungo le corde, come lo segue un testo: la sua
/// lunghezza e il punto a ogni distanza dall'inizio.
export class Track {
  private readonly parts: Array<[Point, Point]> = [];
  private readonly lengths: number[] = [];
  readonly length: number = 0;

  constructor(segments: readonly Segment[]) {
    for (const [a, b] of chords(segments)) {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l = Math.sqrt(dx * dx + dy * dy);
      if (!(l > 0)) continue;
      this.parts.push([a, b]);
      this.lengths.push(l);
      this.length += l;
    }
  }

  /// Il punto a `distance` dall'inizio e la sua direzione; fuori dal
  /// tracciato si ferma al suo estremo. `null` per un tracciato lungo zero.
  at(distance: number): Along | null {
    const parts = this.parts;
    if (parts.length === 0) return null;
    let left = Math.min(Math.max(distance, 0), this.length);
    for (let i = 0; i < parts.length; i++) {
      const l = this.lengths[i]!;
      if (left > l && i < parts.length - 1) {
        left -= l;
        continue;
      }
      const [a, b] = parts[i]!;
      const t = Math.min(left / l, 1);
      return {
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        direction: [(b[0] - a[0]) / l, (b[1] - a[1]) / l],
      };
    }
    return null;
  }

  /// La distanza dall'inizio del punto del tracciato più vicino a `p`: il
  /// primo, se due sono vicini uguali. 0 per un tracciato lungo zero.
  nearest(p: Point): number {
    let best = Infinity;
    let found = 0;
    let before = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const [a, b] = this.parts[i]!;
      const l = this.lengths[i]!;
      const t = Math.min(Math.max(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l), 0), 1);
      const dx = a[0] + (b[0] - a[0]) * t - p[0];
      const dy = a[1] + (b[1] - a[1]) * t - p[1];
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        found = before + t * l;
      }
      before += l;
    }
    return found;
  }
}

/// Il numero di avvolgimento di `p` intorno ai poligoni: diverso da zero se
/// `p` sta dentro con la regola `nonzero`, quella di SVG quando `fill-rule`
/// manca, e §4 non lo ammette. Un lato conta se attraversa l'orizzontale di
/// `p` salendo o scendendo, con l'estremo basso compreso e l'alto escluso:
/// così un vertice sull'orizzontale conta una volta sola.
export function winding(polygons: readonly (readonly Point[])[], p: Point): number {
  let winding = 0;
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && side > 0) winding++;
      } else if (b[1] <= p[1] && side < 0) {
        winding--;
      }
    }
  }
  return winding;
}

/// I segmenti di un'ellisse di centro `center` e raggi `radii`: quattro archi
/// a partire dal punto a destra del centro, nel verso di SVG.
export function ellipsePath([cx, cy]: Point, [rx, ry]: Point): Segment[] {
  const arc = (to: Point): Segment => ({ kind: "arc", radii: [rx, ry], rotation: 0, large: false, sweep: true, to });
  return [
    { kind: "move", to: [cx + rx, cy] },
    arc([cx, cy + ry]),
    arc([cx - rx, cy]),
    arc([cx, cy - ry]),
    arc([cx + rx, cy]),
    { kind: "close" },
  ];
}

/// I segmenti di un poligono o di una polilinea: SVG riempie anche la
/// polilinea, come se fosse chiusa.
export function pointsPath(points: readonly Point[]): Segment[] {
  const segments: Segment[] = points.map((to, i) => ({ kind: i === 0 ? "move" : "line", to }));
  if (segments.length > 0) segments.push({ kind: "close" });
  return segments;
}

/// I segmenti di un rettangolo, con gli angoli arrotondati da `rx` e `ry`
/// già ridotti come vuole SVG.
export function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): Segment[] {
  rx = fmin(rx, w / 2);
  ry = fmin(ry, h / 2);
  if (rx <= 0 || ry <= 0) {
    return [
      { kind: "move", to: [x, y] },
      { kind: "line", to: [x + w, y] },
      { kind: "line", to: [x + w, y + h] },
      { kind: "line", to: [x, y + h] },
      { kind: "close" },
    ];
  }
  const arc = (to: Point): Segment => ({ kind: "arc", radii: [rx, ry], rotation: 0, large: false, sweep: true, to });
  return [
    { kind: "move", to: [x + rx, y] },
    { kind: "line", to: [x + w - rx, y] },
    arc([x + w, y + ry]),
    { kind: "line", to: [x + w, y + h - ry] },
    arc([x + w - rx, y + h]),
    { kind: "line", to: [x + rx, y + h] },
    arc([x, y + h - ry]),
    { kind: "line", to: [x, y + ry] },
    arc([x + rx, y]),
    { kind: "close" },
  ];
}
