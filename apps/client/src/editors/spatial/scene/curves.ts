// Le curve di un tracciato una alla volta: il punto e la direzione a un
// parametro, la divisione in due, l'arco nella forma col centro, e le
// conversioni fra tipi che si vedono uguali. Le usano i nodi del livello
// Esperto.
//
// Un segmento si legge sempre col punto da cui parte, `from`, perché un
// `Segment` porta solo il suo punto d'arrivo. Il parametro `t` va da 0 a 1;
// per un arco è proporzionale all'angolo, come lo descrivono le note
// d'implementazione di SVG (F.6.5).

import { remEuclid, type Segment } from "./geometry";
import { toRadians, type Point } from "./matrix";

/// Un segmento che disegna qualcosa da un punto all'altro.
export type Curve = Exclude<Segment, { readonly kind: "move" } | { readonly kind: "close" }>;

const TAU = 2 * Math.PI;

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const zero = (v: Point): boolean => v[0] === 0 && v[1] === 0;

/// Un arco ellittico nella forma col centro (F.6.5), coi raggi già
/// ingranditi quando non bastano a unire gli estremi (F.6.6).
export interface ArcCenter {
  readonly center: Point;
  readonly radii: Point;
  /// Coseno e seno della rotazione dell'ellisse.
  readonly cos: number;
  readonly sin: number;
  /// L'angolo di partenza e quanto gira, col segno del verso.
  readonly start: number;
  readonly delta: number;
}

/// L'arco da `from` della curva `arc` nella forma col centro; `null` se SVG
/// non lo disegna come arco: estremi uguali, o un raggio nullo, che fa una
/// linea.
export function arcCenter(from: Point, arc: Extract<Curve, { readonly kind: "arc" }>): ArcCenter | null {
  const to = arc.to;
  if (from[0] === to[0] && from[1] === to[1]) return null;
  let rx = Math.abs(arc.radii[0]);
  let ry = Math.abs(arc.radii[1]);
  if (rx === 0 || ry === 0) return null;
  const radians = toRadians(arc.rotation);
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
  let coefficient = Math.sqrt(Math.max(numerator / denominator, 0));
  if (arc.large === arc.sweep) coefficient = -coefficient;
  const cx1 = (coefficient * rx * y1) / ry;
  const cy1 = (-coefficient * ry * x1) / rx;
  const center: Point = [cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2, sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2];
  const start = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  const end = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx);
  let delta = remEuclid(end - start, TAU);
  if (!arc.sweep && delta > 0) delta -= TAU;
  return { center, radii: [rx, ry], cos, sin, start, delta };
}

/// Il punto dell'ellisse di `arc` all'angolo `theta`.
export function onEllipse(arc: ArcCenter, theta: number): Point {
  const ex = arc.radii[0] * Math.cos(theta);
  const ey = arc.radii[1] * Math.sin(theta);
  return [arc.center[0] + arc.cos * ex - arc.sin * ey, arc.center[1] + arc.sin * ex + arc.cos * ey];
}

/// La derivata dell'ellisse di `arc` rispetto all'angolo, in `theta`.
function alongEllipse(arc: ArcCenter, theta: number): Point {
  const ex = -arc.radii[0] * Math.sin(theta);
  const ey = arc.radii[1] * Math.cos(theta);
  return [arc.cos * ex - arc.sin * ey, arc.sin * ex + arc.cos * ey];
}

/// Il punto di `curve`, da `from`, al parametro `t`.
export function pointAt(from: Point, curve: Curve, t: number): Point {
  const u = 1 - t;
  switch (curve.kind) {
    case "line":
      return lerp(from, curve.to, t);
    case "quad": {
      const [c, to] = [curve.control, curve.to];
      return [u * u * from[0] + 2 * u * t * c[0] + t * t * to[0], u * u * from[1] + 2 * u * t * c[1] + t * t * to[1]];
    }
    case "cubic": {
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const { c1, c2, to } = curve;
      return [a * from[0] + b * c1[0] + c * c2[0] + d * to[0], a * from[1] + b * c1[1] + c * c2[1] + d * to[1]];
    }
    case "arc": {
      const arc = arcCenter(from, curve);
      if (arc === null) return lerp(from, curve.to, t);
      if (t === 1) return curve.to;
      return t === 0 ? from : onEllipse(arc, arc.start + arc.delta * t);
    }
  }
}

/// La derivata di `curve` rispetto a `t`: il verso in cui va, lunga quanto
/// corre. Può essere nulla, dove una maniglia coincide col suo nodo.
export function derivativeAt(from: Point, curve: Curve, t: number): Point {
  const u = 1 - t;
  switch (curve.kind) {
    case "line":
      return minus(curve.to, from);
    case "quad": {
      const [c, to] = [curve.control, curve.to];
      return [2 * u * (c[0] - from[0]) + 2 * t * (to[0] - c[0]), 2 * u * (c[1] - from[1]) + 2 * t * (to[1] - c[1])];
    }
    case "cubic": {
      const { c1, c2, to } = curve;
      const [a, b, c] = [3 * u * u, 6 * u * t, 3 * t * t];
      return [
        a * (c1[0] - from[0]) + b * (c2[0] - c1[0]) + c * (to[0] - c2[0]),
        a * (c1[1] - from[1]) + b * (c2[1] - c1[1]) + c * (to[1] - c2[1]),
      ];
    }
    case "arc": {
      const arc = arcCenter(from, curve);
      if (arc === null) return minus(curve.to, from);
      const [x, y] = alongEllipse(arc, arc.start + arc.delta * t);
      return [x * arc.delta, y * arc.delta];
    }
  }
}

/// Il verso, lungo 1, in cui `curve` parte da `from` (`end` falso) o arriva
/// alla fine (`end` vero). Dove una maniglia coincide col nodo vale quella
/// dopo, come per i marcatori di SVG; `null` se la curva sta in un punto.
export function tangentAt(from: Point, curve: Curve, end: boolean): Point | null {
  const candidates: Point[] = [];
  switch (curve.kind) {
    case "line":
      candidates.push(minus(curve.to, from));
      break;
    case "quad":
      candidates.push(end ? minus(curve.to, curve.control) : minus(curve.control, from), minus(curve.to, from));
      break;
    case "cubic":
      candidates.push(
        end ? minus(curve.to, curve.c2) : minus(curve.c1, from),
        end ? minus(curve.to, curve.c1) : minus(curve.c2, from),
        minus(curve.to, from),
      );
      break;
    case "arc":
      candidates.push(derivativeAt(from, curve, end ? 1 : 0), minus(curve.to, from));
      break;
  }
  for (const v of candidates) {
    if (zero(v)) continue;
    const length = Math.hypot(v[0], v[1]);
    if (length > 0 && Number.isFinite(length)) return [v[0] / length, v[1] / length];
  }
  return null;
}

/// `curve` divisa al parametro `t` in due curve dello stesso tipo, che
/// insieme si vedono come lei.
export function splitAt(from: Point, curve: Curve, t: number): [Curve, Curve] {
  switch (curve.kind) {
    case "line":
      return [{ kind: "line", to: lerp(from, curve.to, t) }, curve];
    case "quad": {
      const a = lerp(from, curve.control, t);
      const b = lerp(curve.control, curve.to, t);
      return [{ kind: "quad", control: a, to: lerp(a, b, t) }, { kind: "quad", control: b, to: curve.to }];
    }
    case "cubic": {
      const ab = lerp(from, curve.c1, t);
      const bc = lerp(curve.c1, curve.c2, t);
      const cd = lerp(curve.c2, curve.to, t);
      const abc = lerp(ab, bc, t);
      const bcd = lerp(bc, cd, t);
      return [{ kind: "cubic", c1: ab, c2: abc, to: lerp(abc, bcd, t) }, { kind: "cubic", c1: bcd, c2: cd, to: curve.to }];
    }
    case "arc": {
      const arc = arcCenter(from, curve);
      if (arc === null) return [{ ...curve, to: lerp(from, curve.to, t) }, curve];
      const middle = onEllipse(arc, arc.start + arc.delta * t);
      // Ognuna delle due metà coi raggi che servono davvero: quelli scritti
      // possono essere più piccoli, e SVG li ingrandisce per l'arco intero.
      const first = { ...curve, radii: arc.radii, large: Math.abs(arc.delta * t) > Math.PI, to: middle };
      const second = { ...curve, radii: arc.radii, large: Math.abs(arc.delta * (1 - t)) > Math.PI };
      return [first, second];
    }
  }
}

/// Una linea come cubica dritta, con le maniglie a un terzo: si vede uguale.
export function lineToCubic(from: Point, to: Point): Curve {
  return { kind: "cubic", c1: lerp(from, to, 1 / 3), c2: lerp(from, to, 2 / 3), to };
}

/// Una quadratica come la cubica che è (elevazione del grado).
export function quadToCubic(from: Point, quad: Extract<Curve, { readonly kind: "quad" }>): Curve {
  const { control, to } = quad;
  return { kind: "cubic", c1: lerp(from, control, 2 / 3), c2: lerp(to, control, 2 / 3), to };
}

/// Un arco come cubiche, una per ogni quarto di giro o meno, come fanno i
/// programmi di disegno: si scostano dall'ellisse per meno di tre
/// decimillesimi del raggio. Un arco che SVG disegna come linea resta una
/// linea, e uno che non disegna niente sparisce.
export function arcToCubics(from: Point, curve: Extract<Curve, { readonly kind: "arc" }>): Curve[] {
  const arc = arcCenter(from, curve);
  if (arc === null) return from[0] === curve.to[0] && from[1] === curve.to[1] ? [] : [{ kind: "line", to: curve.to }];
  const pieces = Math.max(1, Math.ceil(Math.abs(arc.delta) / (Math.PI / 2) - 1e-9));
  const step = arc.delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Curve[] = [];
  for (let i = 0; i < pieces; i++) {
    const a = arc.start + step * i;
    const b = a + step;
    const p0 = i === 0 ? from : onEllipse(arc, a);
    const p3 = i === pieces - 1 ? curve.to : onEllipse(arc, b);
    const d0 = alongEllipse(arc, a);
    const d3 = alongEllipse(arc, b);
    out.push({ kind: "cubic", c1: [p0[0] + k * d0[0], p0[1] + k * d0[1]], c2: [p3[0] - k * d3[0], p3[1] - k * d3[1]], to: p3 });
  }
  return out;
}

/// `curve` percorsa al contrario: da `to` a `from`.
export function reversed(from: Point, curve: Curve): Curve {
  switch (curve.kind) {
    case "line":
      return { kind: "line", to: from };
    case "quad":
      return { kind: "quad", control: curve.control, to: from };
    case "cubic":
      return { kind: "cubic", c1: curve.c2, c2: curve.c1, to: from };
    case "arc":
      return { ...curve, sweep: !curve.sweep, to: from };
  }
}
