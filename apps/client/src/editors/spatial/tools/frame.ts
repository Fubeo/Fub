// La cornice di trasformazione: le maniglie attorno agli oggetti scelti con
// lo strumento Selezione, che li ridimensionano e li ruotano col puntatore.
//
// - **La cornice di un oggetto solo è la sua**, e ruota con lui: il riquadro
//   nelle sue coordinate, contorno compreso, portato nella scena dalla sua
//   matrice. Le maniglie lo scalano lungo i suoi assi, così un oggetto
//   ruotato cambia misura senza inclinarsi. Più oggetti hanno il riquadro
//   comune nella scena, che una rotazione porta con sé finché la selezione
//   resta quella.
// - **Otto maniglie ridimensionano**: gli angoli, e i lati che sullo schermo
//   sono abbastanza lunghi. Un asse che misura zero, come l'altezza di una
//   linea orizzontale, non scala: non ha i lati suoi né gli angoli.
// - **Una maniglia tonda, sopra il lato in alto, ruota** attorno al centro
//   della cornice. Il gambo segue il lato in alto anche a cornice ruotata.
// - **Prendere una maniglia** è più facile fuori dalla cornice, dove non c'è
//   altro da prendere: col dito l'area è larga quanto un polpastrello. Dentro
//   la cornice vince l'oggetto, e su una cornice piccola sullo schermo lo
//   si prende sempre.
// - **Ridimensionare** tira un bordo, o due da un angolo, e tiene fermo
//   quello opposto, o il centro. Gli angoli possono tenere le proporzioni,
//   proiettando il puntatore sulla diagonale. Un lato non scende sotto una
//   misura minima e non passa oltre quello opposto: ribaltare è un'altra
//   cosa. A cornice dritta, il bordo tirato va sulla riga della griglia più
//   vicina, o sul bersaglio delle guide intelligenti, se è più vicino.
// - **Ruotare** segue l'angolo del puntatore attorno al centro, al decimo
//   di grado. A passi fissi, l'angolo dell'oggetto va sui loro multipli; se
//   no, vicino a un angolo retto ci si ferma lì, come una calamita leggera.
//
// Il modulo non sa niente del documento: dà posizioni, matrici e angoli, e
// l'editor li scrive come scrive uno spostamento.

import type { InkPointerType } from "../pen/pen-input";
import type { Bounds } from "../scene/geometry";
import { apply, compose, invert, type Matrix, type Point } from "../scene/matrix";
import { boxMatrix } from "./edit";
import { lineBeyond, snapValue } from "./grid";
import { nearer, type GuideIndex } from "./guides";
import { numericMatrix, UNCHANGED } from "./transform";

/// Una maniglia che ridimensiona, coi punti cardinali della cornice: `n` è
/// il lato in alto nelle coordinate della cornice.
export type ResizeGrip = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/// Una maniglia della cornice.
export type Grip = ResizeGrip | "rotate";

/// Un asse della cornice: 0 orizzontale, 1 verticale.
export type Axis = 0 | 1;

/// La cornice degli oggetti scelti.
export interface Frame {
  /// Dalle coordinate della cornice a quelle della scena.
  readonly matrix: Matrix;
  /// Il riquadro, contorno compreso, nelle coordinate della cornice.
  readonly box: Bounds;
  /// Il riquadro della geometria, senza contorno: quello che la griglia
  /// aggancia, e che dice se un asse misura zero.
  readonly geometry: Bounds;
}

/// Una maniglia dove si vede, nella scena.
export interface GripSpot {
  readonly grip: Grip;
  readonly at: Point;
}

/// La cornice come si vede a una certa scala.
export interface FrameView {
  readonly frame: Frame;
  /// Il riquadro col margine, nelle coordinate della cornice: quello che si
  /// disegna, perché il bordo non copra il contorno dell'oggetto.
  readonly padded: Bounds;
  readonly spots: readonly GripSpot[];
  /// Il punto del lato in alto da cui parte il gambo della maniglia che
  /// ruota.
  readonly stem: Point;
  /// I lati della cornice sullo schermo, in pixel.
  readonly size: readonly [number, number];
}

/// Il margine fra il riquadro e la cornice che si disegna, in pixel.
export const FRAME_PX = 4;

/// La distanza del centro della maniglia che ruota dal lato in alto, in
/// pixel.
export const ROTATE_PX = 24;

/// Sotto questa lunghezza sullo schermo, in pixel, un lato non mostra la sua
/// maniglia di mezzo: gli angoli bastano, e non si affollano.
export const SIDE_PX = 32;

/// Sotto questa misura sullo schermo, in pixel, la cornice è piccola: dentro
/// vince sempre l'oggetto.
export const SMALL_PX = 24;

/// Il raggio entro cui si prende una maniglia dentro la cornice, in pixel:
/// quanto la maniglia che si vede, e poco più.
export const INSIDE_PX = 6;

/// Il raggio entro cui si prende una maniglia fuori dalla cornice, in pixel,
/// per tipo di puntatore: col dito, un bersaglio di 44 pixel.
export const OUTSIDE_PX: Readonly<Record<InkPointerType, number>> = { mouse: 8, pen: 10, touch: 22 };

/// L'angolo che una rotazione libera raggiunge da sola vicino a un angolo
/// retto, in gradi.
export const MAGNET_DEGREES = 1.5;

/// La misura più piccola a cui le frecce, la cornice o un campo riducono un
/// lato della selezione, in unità della scena.
export const MIN_SIZE = 1;

const RESIZE_GRIPS: readonly ResizeGrip[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/// Il verso in cui una maniglia tira un asse: -1 il bordo più piccolo, 1
/// quello più grande, 0 nessuno.
export function pull(grip: ResizeGrip, axis: Axis): -1 | 0 | 1 {
  if (axis === 0) return grip.includes("w") ? -1 : grip.includes("e") ? 1 : 0;
  return grip.startsWith("n") ? -1 : grip.startsWith("s") ? 1 : 0;
}

/// Vero se la maniglia sta in un angolo.
export function isCorner(grip: Grip): grip is "nw" | "ne" | "se" | "sw" {
  return grip.length === 2;
}

/// La lunghezza, nella scena, di un'unità della cornice lungo `axis`.
function unitLength(m: Matrix, axis: Axis): number {
  return axis === 0 ? Math.hypot(m[0], m[1]) : Math.hypot(m[2], m[3]);
}

function center(box: Bounds): Point {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
}

function extent(box: Bounds, axis: Axis): number {
  return box.max[axis] - box.min[axis];
}

/// Il centro della cornice, nella scena: quello attorno a cui ruota.
export function frameCenter(frame: Frame): Point {
  return apply(frame.matrix, center(frame.box));
}

/// Le misure della cornice nella scena, lungo i suoi assi, contorno
/// compreso.
export function frameSize(frame: Frame): [number, number] {
  return [extent(frame.box, 0) * unitLength(frame.matrix, 0), extent(frame.box, 1) * unitLength(frame.matrix, 1)];
}

/// La cornice dopo `m`, una trasformazione della scena.
export function movedFrame(frame: Frame, m: Matrix): Frame {
  return { ...frame, matrix: compose(m, frame.matrix) };
}

/// Vero se un asse della cornice misura più di zero e scala.
export function scales(frame: Frame, axis: Axis): boolean {
  return extent(frame.geometry, axis) > 1e-9 && extent(frame.box, axis) > 1e-9;
}

/// Vero se la cornice ha gli assi su quelli della scena: la griglia la
/// aggancia solo così.
export function upright(m: Matrix): boolean {
  return Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
}

/// L'angolo dell'asse orizzontale della cornice, in gradi in senso orario,
/// fra -180 escluso e 180.
export function angleOf(m: Matrix): number {
  return normalized((Math.atan2(m[1], m[0]) * 180) / Math.PI);
}

/// `degrees` fra -180 escluso e 180, senza `-0`.
export function normalized(degrees: number): number {
  const turned = degrees - 360 * Math.floor((degrees + 180) / 360);
  return (turned === -180 ? 180 : turned) || 0;
}

/// La cornice vista a `scale` pixel per unità della scena: le maniglie e il
/// riquadro col margine. `null` se la cornice schiaccia il piano.
export function frameView(frame: Frame, scale: number): FrameView | null {
  const m = frame.matrix;
  const lx = unitLength(m, 0);
  const ly = unitLength(m, 1);
  if (!(scale > 0) || lx === 0 || ly === 0 || m[0] * m[3] - m[1] * m[2] === 0) return null;
  const padX = FRAME_PX / (lx * scale);
  const padY = FRAME_PX / (ly * scale);
  const padded: Bounds = {
    min: [frame.box.min[0] - padX, frame.box.min[1] - padY],
    max: [frame.box.max[0] + padX, frame.box.max[1] + padY],
  };
  const size: [number, number] = [extent(padded, 0) * lx * scale, extent(padded, 1) * ly * scale];
  const sx = scales(frame, 0);
  const sy = scales(frame, 1);
  const corners = sx && sy;
  const [cx, cy] = center(padded);
  const spot = (grip: ResizeGrip): Point => {
    const x = pull(grip, 0) < 0 ? padded.min[0] : pull(grip, 0) > 0 ? padded.max[0] : cx;
    const y = pull(grip, 1) < 0 ? padded.min[1] : pull(grip, 1) > 0 ? padded.max[1] : cy;
    return apply(m, [x, y]);
  };
  const spots: GripSpot[] = [];
  for (const grip of RESIZE_GRIPS) {
    if (isCorner(grip)) {
      if (corners) spots.push({ grip, at: spot(grip) });
    } else if (pull(grip, 0) !== 0) {
      // I lati destro e sinistro stanno sui lati verticali: se sono corti,
      // gli angoli bastano. Senza angoli restano, anche corti.
      if (sx && (!corners || size[1] >= SIDE_PX)) spots.push({ grip, at: spot(grip) });
    } else if (sy && (!corners || size[0] >= SIDE_PX)) {
      spots.push({ grip, at: spot(grip) });
    }
  }
  const stem = apply(m, [cx, padded.min[1]]);
  // Fuori dal lato in alto, perpendicolare a lui: lontano dal centro.
  const edge: Point = [m[0] / lx, m[1] / lx];
  let normal: Point = [edge[1], -edge[0]];
  const middle = apply(m, [cx, cy]);
  if (normal[0] * (stem[0] - middle[0]) + normal[1] * (stem[1] - middle[1]) < 0) normal = [-normal[0], -normal[1]];
  const reach = ROTATE_PX / scale;
  spots.push({ grip: "rotate", at: [stem[0] + normal[0] * reach, stem[1] + normal[1] * reach] });
  return { frame, padded, spots, stem, size };
}

/// La maniglia sotto il punto `p` della scena, o `null`: la più vicina fra
/// quelle a portata del puntatore.
export function gripAt(view: FrameView, p: Point, scale: number, pointer: InkPointerType): Grip | null {
  const inverse = invert(view.frame.matrix);
  if (inverse === null) return null;
  const [x, y] = apply(inverse, p);
  const { min, max } = view.padded;
  const inside = x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1];
  const small = view.size[0] < SMALL_PX || view.size[1] < SMALL_PX;
  let best: Grip | null = null;
  let nearest = Infinity;
  for (const { grip, at } of view.spots) {
    const reach = inside && grip !== "rotate" ? (small ? 0 : INSIDE_PX) : OUTSIDE_PX[pointer];
    const distance = Math.hypot(at[0] - p[0], at[1] - p[1]) * scale;
    if (distance <= reach && distance < nearest) {
      best = grip;
      nearest = distance;
    }
  }
  return best;
}

/// Il cursore di una maniglia: la direzione in cui tira sullo schermo, a
/// passi di 45°, o la rotazione.
export type GripCursor = "ew" | "ns" | "nwse" | "nesw" | "rotate";

/// Il cursore che tira lungo la direzione `degrees` dello schermo, in senso
/// orario dall'asse x: il più vicino dei quattro.
export function directionCursor(degrees: number): Exclude<GripCursor, "rotate"> {
  const turn = ((degrees % 180) + 180) % 180;
  return (["ew", "nwse", "ns", "nesw"] as const)[Math.round(turn / 45) % 4]!;
}

/// Il cursore della maniglia `grip` di `frame`, su un foglio girato di
/// `turn` gradi.
export function gripCursor(frame: Frame, grip: Grip, turn = 0): GripCursor {
  if (grip === "rotate") return "rotate";
  const m = frame.matrix;
  const lx = unitLength(m, 0) || 1;
  const ly = unitLength(m, 1) || 1;
  // Gli assi della cornice nella scena, di lunghezza uno: un angolo tira
  // lungo la loro somma anche in una cornice lunga e stretta.
  const px = pull(grip, 0);
  const py = pull(grip, 1);
  const dx = (px * m[0]) / lx + (py * m[2]) / ly;
  const dy = (px * m[1]) / lx + (py * m[3]) / ly;
  return directionCursor((Math.atan2(dy, dx) * 180) / Math.PI + turn);
}

/// La griglia vista dalla cornice: porta un bordo, in unità della cornice,
/// sulla riga più vicina, o sulla prima oltre un valore.
export interface FrameSnap {
  near(axis: Axis, value: number): number;
  beyond(axis: Axis, value: number, direction: 1 | -1): number;
}

/// Le guide intelligenti lungo gli assi della cornice.
export interface FrameGuides {
  /// Il bersaglio più vicino a `value` lungo `axis`, entro la soglia;
  /// `null` se non ce n'è.
  near(axis: Axis, value: number): number | null;
  /// Quanti pixel dello schermo misura un'unità della cornice lungo `axis`.
  pixels(axis: Axis): number;
}

/// La griglia di passo `step` per la cornice di matrice `m`; `null` se la
/// cornice è ruotata o inclinata, e i suoi bordi non stanno sulle righe.
export function gridSnap(m: Matrix, step: number): FrameSnap | null {
  if (!upright(m) || m[0] === 0 || m[3] === 0) return null;
  const scale = (axis: Axis): number => (axis === 0 ? m[0] : m[3]);
  const offset = (axis: Axis): number => (axis === 0 ? m[4] : m[5]);
  return {
    near: (axis, value) => (snapValue(scale(axis) * value + offset(axis), step) - offset(axis)) / scale(axis),
    beyond: (axis, value, direction) => {
      const s = scale(axis);
      const line = lineBeyond(s * value + offset(axis), step, s > 0 ? direction : direction > 0 ? -1 : 1, 1);
      return (line - offset(axis)) / s;
    },
  };
}

/// Le guide della cornice di matrice `m`, coi bersagli di `index` entro
/// `px` pixel dello schermo alla scala `scale`: `null` se la cornice è
/// ruotata o inclinata, e i suoi bordi non corrono lungo gli assi.
export function frameGuides(index: GuideIndex, m: Matrix, px: number, scale: number): FrameGuides | null {
  if (!upright(m) || m[0] === 0 || m[3] === 0 || !(scale > 0)) return null;
  const factor = (axis: Axis): number => (axis === 0 ? m[0] : m[3]);
  const offset = (axis: Axis): number => (axis === 0 ? m[4] : m[5]);
  return {
    near: (axis, value) => {
      const target = index.nearest(axis, factor(axis) * value + offset(axis), px / scale);
      return target === null ? null : (target - offset(axis)) / factor(axis);
    },
    pixels: (axis) => Math.abs(factor(axis)) * scale,
  };
}

/// Come si ridimensiona.
export interface ResizeOptions {
  /// Un angolo tiene le proporzioni.
  readonly ratio: boolean;
  /// Fermo il centro, invece del bordo opposto.
  readonly fromCenter: boolean;
  /// La misura più piccola di ciascun asse, in unità della cornice: un lato
  /// già più corto non cala, ma può crescere.
  readonly minimum: readonly [number, number];
  /// La griglia, o `null`.
  readonly snap: FrameSnap | null;
  /// Le guide, o `null`. Fra un bersaglio e la riga vince il più vicino al
  /// puntatore, a pari distanza il bersaglio.
  readonly guides?: FrameGuides | null;
}

/// Il riquadro `box` dopo aver tirato la maniglia `grip` di `delta`, tutto
/// nelle unità della cornice.
export function resized(box: Bounds, grip: ResizeGrip, delta: Point, options: ResizeOptions): Bounds {
  const anchor: [number, number] = [0, 0];
  const edge: [number, number] = [0, 0];
  const factor: [number, number] = [1, 1];
  const floor: [number, number] = [0, 0];
  const live: Axis[] = [];
  for (const axis of [0, 1] as const) {
    const direction = pull(grip, axis);
    const size = extent(box, axis);
    anchor[axis] = options.fromCenter ? center(box)[axis] : direction > 0 ? box.min[axis] : box.max[axis];
    edge[axis] = direction > 0 ? box.max[axis] : box.min[axis];
    if (direction === 0 || !(size > 0)) continue;
    live.push(axis);
    floor[axis] = Math.min(1, options.minimum[axis] / size);
    const pointed = edge[axis] + delta[axis];
    let line: number | null = null;
    if (options.snap !== null) {
      line = options.snap.near(axis, pointed);
      // Sul punto fermo o oltre: la prima riga dopo di lui.
      if ((line - anchor[axis]) * direction <= 0) line = options.snap.beyond(axis, anchor[axis], direction);
    }
    // Un bersaglio sul punto fermo o oltre ribalterebbe: non vale.
    const guide = options.guides?.near(axis, pointed) ?? null;
    const target = nearer(pointed, guide !== null && (guide - anchor[axis]) * direction > 0 ? guide : null, line);
    factor[axis] = (target - anchor[axis]) / (edge[axis] - anchor[axis]);
  }
  if (options.ratio && live.length === 2) {
    // Il puntatore proiettato sulla diagonale; con la griglia il bordo
    // dell'asse più lungo va sulla riga, e l'altro lo segue.
    const ux = edge[0] - anchor[0];
    const uy = edge[1] - anchor[1];
    let f = ((edge[0] + delta[0] - anchor[0]) * ux + (edge[1] + delta[1] - anchor[1]) * uy) / (ux * ux + uy * uy);
    // Il bordo che si ferma: quello della riga, o quello di uno dei due assi
    // più vicino a un bersaglio, misurato sullo schermo.
    let best: { readonly f: number; readonly px: number } | null = null;
    const guides = options.guides ?? null;
    if (guides !== null) {
      for (const axis of [0, 1] as const) {
        const at = anchor[axis] + f * (edge[axis] - anchor[axis]);
        const target = guides.near(axis, at);
        if (target === null || (target - anchor[axis]) * pull(grip, axis) <= 0) continue;
        const px = Math.abs(target - at) * guides.pixels(axis);
        if (best === null || px < best.px) best = { f: (target - anchor[axis]) / (edge[axis] - anchor[axis]), px };
      }
    }
    if (options.snap !== null) {
      const axis: Axis = extent(box, 0) >= extent(box, 1) ? 0 : 1;
      const direction = pull(grip, axis) as 1 | -1;
      const at = anchor[axis] + f * (edge[axis] - anchor[axis]);
      let target = options.snap.near(axis, at);
      if ((target - anchor[axis]) * direction <= 0) target = options.snap.beyond(axis, anchor[axis], direction);
      const px = guides === null ? 0 : Math.abs(target - at) * guides.pixels(axis);
      if (best === null || px < best.px) best = { f: (target - anchor[axis]) / (edge[axis] - anchor[axis]), px };
    }
    if (best !== null) f = best.f;
    f = Math.max(f, floor[0], floor[1]);
    factor[0] = f;
    factor[1] = f;
  } else {
    for (const axis of live) factor[axis] = Math.max(factor[axis], floor[axis]);
  }
  const side = (axis: Axis, value: number): number => anchor[axis] + factor[axis] * (value - anchor[axis]);
  return {
    min: [side(0, box.min[0]), side(1, box.min[1])],
    max: [side(0, box.max[0]), side(1, box.max[1])],
  };
}

/// La trasformazione della scena che porta il riquadro `from` della cornice
/// in `to`: scala lungo gli assi della cornice, senza inclinare.
export function resizeMatrix(frame: Frame, from: Bounds, to: Bounds): Matrix | null {
  const inverse = invert(frame.matrix);
  if (inverse === null) return null;
  return compose(frame.matrix, compose(boxMatrix(from, to), inverse));
}

/// Come si ruota.
export interface RotateOptions {
  /// A passi di tanti gradi, o `null`.
  readonly step: number | null;
  /// Vicino a un angolo retto ci si ferma lì, entro tanti gradi; 0 per mai.
  readonly magnet: number;
}

/// I gradi in senso orario, fra -180 escluso e 180, di cui ruotare attorno
/// a `pivot` perché il punto preso `from` vada verso `to`. `base` è l'angolo
/// che la cornice ha già: i passi e la calamita valgono per l'angolo che
/// avrà.
export function rotation(pivot: Point, from: Point, to: Point, base: number, options: RotateOptions): number {
  if ((from[0] === pivot[0] && from[1] === pivot[1]) || (to[0] === pivot[0] && to[1] === pivot[1])) return 0;
  const a = Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);
  const b = Math.atan2(to[1] - pivot[1], to[0] - pivot[0]);
  const raw = ((b - a) * 180) / Math.PI;
  const angle = normalized(base + raw);
  let target: number;
  if (options.step !== null && options.step > 0) {
    target = Math.round(angle / options.step) * options.step;
  } else {
    const right = Math.round(angle / 90) * 90;
    target = Math.abs(angle - right) <= options.magnet ? right : Math.round(angle * 10) / 10;
  }
  return normalized(target - base);
}

/// La rotazione di `degrees` in senso orario attorno a `pivot`.
export function rotationMatrix(pivot: Point, degrees: number): Matrix {
  return numericMatrix({ ...UNCHANGED, rotate: degrees }, pivot);
}
