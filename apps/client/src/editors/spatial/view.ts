// La vista del disegno: come la scena finisce sullo schermo. Un punto `p`
// della scena va in `R(angle) · p · scale + (tx, ty)`, dove `R` gira di
// `angle` gradi in senso orario, come `rotate()` di SVG: il foglio ruota come
// un quaderno sul tavolo, e lo zoom, il fit e lo scorrimento sono variazioni
// di questi quattro numeri.
//
// La camera del grafo (`spatial/camera.ts`) non gira: l'angolo è solo del
// disegno, e non entra mai nel file. Ad angolo zero le funzioni di qui fanno
// gli stessi conti di quella camera, così la vista diritta resta identica al
// bit.
//
// Le maniglie, le scritte e i cursori stanno sullo schermo e restano diritti;
// ciò che è della scena, compresi la griglia e le guide, gira con il foglio.

import { fit, zoomAtPoint, type ScaleLimits } from "../../spatial/camera";
import type { Bounds } from "./scene/geometry";
import type { Matrix, Point } from "./scene/matrix";

export interface View {
  readonly scale: number;
  /// Gradi in senso orario, in (−180, 180]: 0 è il foglio diritto.
  readonly angle: number;
  readonly tx: number;
  readonly ty: number;
}

/// Un rettangolo dello schermo, in pixel CSS dall'angolo della superficie.
export interface ScreenArea {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/// Il passo dei comandi che girano la vista, in gradi.
export const TURN_STEP = 15;

/// `degrees` in (−180, 180], senza `-0`.
export function normalTurn(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  let out = degrees % 360;
  if (out > 180) out -= 360;
  else if (out <= -180) out += 360;
  return out === 0 ? 0 : out;
}

/// Il coseno e il seno di `degrees`, esatti sugli angoli retti: un foglio
/// girato di 90° resta sui pixel interi.
function cosSin(degrees: number): readonly [number, number] {
  const turn = normalTurn(degrees);
  if (turn === 0) return [1, 0];
  if (turn === 90) return [0, 1];
  if (turn === 180) return [-1, 0];
  if (turn === -90) return [0, -1];
  const radians = (turn * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

/// La vista come matrice `[a b c d e f]` di SVG: dalla scena allo schermo.
export function viewMatrix(view: View): Matrix {
  const [cos, sin] = cosSin(view.angle);
  const { scale: s, tx, ty } = view;
  if (sin === 0) return [s * cos, 0, 0, s * cos, tx, ty];
  if (cos === 0) return [0, s * sin, -s * sin, 0, tx, ty];
  return [s * cos, s * sin, -s * sin, s * cos, tx, ty];
}

/// Un punto della scena sullo schermo.
export function toScreen(view: View, [x, y]: Point): Point {
  if (view.angle === 0) return [x * view.scale + view.tx, y * view.scale + view.ty];
  const [a, b, c, d, e, f] = viewMatrix(view);
  return [a * x + c * y + e, b * x + d * y + f];
}

/// Un punto dello schermo nella scena.
export function toScene(view: View, [x, y]: Point): Point {
  const u = (x - view.tx) / view.scale;
  const v = (y - view.ty) / view.scale;
  if (view.angle === 0) return [u, v];
  const [cos, sin] = cosSin(view.angle);
  return [cos * u + sin * v, cos * v - sin * u];
}

/// Una direzione della scena sullo schermo, senza la scala: dove punta,
/// girata con il foglio.
export function screenDirection(view: View, [x, y]: Point): Point {
  const [cos, sin] = cosSin(view.angle);
  return [cos * x - sin * y, sin * x + cos * y];
}

/// La direzione della scena che lo schermo vede andare verso `[dx, dy]`:
/// l'asse della scena, col suo verso, più vicino. Le frecce spostano lungo
/// gli assi del disegno, a passi interi, nella direzione in cui si vede
/// andare: su un foglio girato di 90° la freccia a destra va dove il foglio
/// mostra la destra.
export function sceneArrow(view: View, [dx, dy]: Point): Point {
  if (view.angle === 0) return [dx, dy];
  const [cos, sin] = cosSin(view.angle);
  // La direzione dello schermo portata nella scena.
  const x = cos * dx + sin * dy;
  const y = cos * dy - sin * dx;
  if (Math.abs(x) >= Math.abs(y)) return [Math.sign(x) * Math.hypot(dx, dy), 0];
  return [0, Math.sign(y) * Math.hypot(dx, dy)];
}

/// Il riquadro dello schermo che copre `bounds` della scena.
export function screenBox(view: View, bounds: Bounds): Bounds {
  if (view.angle === 0) return { min: toScreen(view, bounds.min), max: toScreen(view, bounds.max) };
  return boxOf([
    toScreen(view, bounds.min),
    toScreen(view, [bounds.max[0], bounds.min[1]]),
    toScreen(view, bounds.max),
    toScreen(view, [bounds.min[0], bounds.max[1]]),
  ]);
}

/// Il riquadro della scena che copre il rettangolo `area` dello schermo.
export function sceneBox(view: View, area: ScreenArea): Bounds {
  const corners = sceneCorners(view, area);
  if (view.angle === 0) return { min: corners[0], max: corners[2] };
  return boxOf(corners);
}

/// I quattro angoli del rettangolo `area` dello schermo nella scena, in
/// giro: in alto a sinistra, in alto a destra, in basso a destra, in basso
/// a sinistra.
export function sceneCorners(view: View, area: ScreenArea): readonly [Point, Point, Point, Point] {
  return [
    toScene(view, [area.x, area.y]),
    toScene(view, [area.x + area.w, area.y]),
    toScene(view, [area.x + area.w, area.y + area.h]),
    toScene(view, [area.x, area.y + area.h]),
  ];
}

/// Il riquadro della scena più grande coi lati lungo i suoi assi che si vede
/// tutto nel rettangolo `area` dello schermo, attorno al suo centro. Sul
/// foglio dritto o girato di un angolo retto è `area` nella scena; di
/// traverso, il riquadro con le proporzioni di `area` come si vede, il lato
/// lungo dove il foglio mostra il lato lungo, che ci sta dentro.
export function seenBox(view: View, area: ScreenArea): Bounds {
  if (view.angle % 90 === 0) return sceneBox(view, area);
  const [cos, sin] = cosSin(view.angle);
  const c = Math.abs(cos);
  const s = Math.abs(sin);
  // Le proporzioni lungo gli assi della scena: scambiate oltre i 45°.
  const [w, h] = c >= s ? [area.w, area.h] : [area.h, area.w];
  const k = Math.min(area.w / (w * c + h * s), area.h / (w * s + h * c));
  const [cx, cy] = toScene(view, [area.x + area.w / 2, area.y + area.h / 2]);
  const hw = (k * w) / 2 / view.scale;
  const hh = (k * h) / 2 / view.scale;
  return { min: [cx - hw, cy - hh], max: [cx + hw, cy + hh] };
}

function boxOf(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

/// La vista che porta il punto `p` della scena nel punto `at` dello schermo,
/// con la scala e l'angolo di `view`.
export function placedAt(view: View, p: Point, at: Point): View {
  if (view.angle === 0) return { ...view, tx: at[0] - view.scale * p[0], ty: at[1] - view.scale * p[1] };
  const [a, b, c, d] = viewMatrix(view);
  return { ...view, tx: at[0] - (a * p[0] + c * p[1]), ty: at[1] - (b * p[0] + d * p[1]) };
}

/// Lo zoom di `factor` attorno al punto `at` dello schermo, che resta
/// fermo: il punto della scena sotto il puntatore non scivola.
export function zoomAt(view: View, factor: number, at: Point, limits: ScaleLimits): View {
  if (view.angle === 0) return { ...zoomAtPoint(view, factor, { x: at[0], y: at[1] }, limits), angle: 0 };
  const p = toScene(view, at);
  const scale = Math.min(limits.max, Math.max(limits.min, view.scale * factor));
  return placedAt({ ...view, scale }, p, at);
}

/// La vista girata fino all'angolo `angle` attorno al punto `at` dello
/// schermo, che resta fermo.
export function turnTo(view: View, angle: number, at: Point): View {
  const next = normalTurn(angle);
  if (next === view.angle) return view;
  return placedAt({ ...view, angle: next }, toScene(view, at), at);
}

/// La vista girata di `degrees` attorno al punto `at` dello schermo.
export function turnBy(view: View, degrees: number, at: Point): View {
  return turnTo(view, view.angle + degrees, at);
}

/// Il prossimo multiplo di `step` gradi nel verso di `direction` (1 orario,
/// −1 antiorario): da 20° si va a 30° o a 15°, da 30° a 45° o a 15°.
export function nextTurn(angle: number, direction: 1 | -1, step = TURN_STEP): number {
  // Un angolo a un soffio da un multiplo conta come il multiplo.
  const at = angle / step;
  const near = Math.round(at);
  const base = Math.abs(at - near) < 1e-6 ? near : direction > 0 ? Math.floor(at) : Math.ceil(at);
  return normalTurn((base + direction) * step);
}

/// La vista che inquadra `bounds` nel rettangolo `area` dello schermo, con
/// il margine `pad` (in parti del lato) e l'angolo `angle`: la scala più
/// grande che lo contiene girato, e il centro al centro.
export function fitView(bounds: Bounds, area: ScreenArea, pad: number, angle: number, limits: ScaleLimits): View {
  const turn = normalTurn(angle);
  if (turn === 0) {
    const world = { minX: bounds.min[0], minY: bounds.min[1], maxX: bounds.max[0], maxY: bounds.max[1] };
    const view = fit(world, { w: area.w, h: area.h }, pad, 0, limits);
    return { scale: view.scale, angle: 0, tx: view.tx + area.x, ty: view.ty + area.y };
  }
  const [cos, sin] = cosSin(turn);
  const bw = Math.max(1e-6, bounds.max[0] - bounds.min[0]);
  const bh = Math.max(1e-6, bounds.max[1] - bounds.min[1]);
  // Il riquadro dello schermo di `bounds` girato, a scala uno.
  const w = Math.abs(cos) * bw + Math.abs(sin) * bh;
  const h = Math.abs(sin) * bw + Math.abs(cos) * bh;
  const scale = Math.min(limits.max, Math.max(limits.min, Math.min(area.w / w, area.h / h) * (1 - 2 * pad)));
  const center: Point = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
  return placedAt({ scale, angle: turn, tx: 0, ty: 0 }, center, [area.x + area.w / 2, area.y + area.h / 2]);
}

/// La vista spostata di `dx`, `dy` pixel dello schermo.
export function panned(view: View, dx: number, dy: number): View {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy };
}

/// `matrix(…)` della vista, per un `transform` di SVG o di CSS.
export function viewTransform(view: View, css = false): string {
  const [a, b, c, d, e, f] = viewMatrix(view);
  return css ? `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})` : `matrix(${a} ${b} ${c} ${d} ${e} ${f})`;
}
