// I marcatori di un tracciato: su quali vertici SVG li disegna, come li gira
// e come porta il contenuto di un `marker` nelle coordinate della forma che
// lo usa (SVG 2, «Path directionality» e «Rendering markers»). Le punte delle
// linee sono marcatori: da qui la selezione le tocca e i riquadri le
// contengono.
//
// I vertici sono il punto di ogni `M` e la fine di ogni segmento, `Z`
// compreso: il primo prende `marker-start`, l'ultimo `marker-end`, gli altri
// `marker-mid`. Il verso di un vertice è quello del tracciato dove comincia
// o finisce un sottotracciato aperto, e la bisettrice fra il verso con cui
// il tracciato arriva e quello con cui riparte negli altri, anche dove un
// sottotracciato chiuso comincia e finisce. Un segmento lungo zero prende il
// verso del segmento non nullo più vicino prima di lui, o dopo se prima non
// ce n'è; un tracciato tutto lungo zero va lungo l'asse x.

import { tangentAt, type Curve } from "./curves";
import type { Bounds, Segment } from "./geometry";
import { apply, compose, IDENTITY, rotate, translate, type Matrix, type Point } from "./matrix";
import { angle, length, nonNegativeLength, viewBox, viewBoxMatrix } from "./values";

/// Un vertice di un tracciato: dove si disegna un marcatore, e il verso in
/// cui `orient="auto"` lo gira, in gradi dall'asse x nel verso di SVG.
export interface Vertex {
  readonly at: Point;
  readonly angle: number;
}

/// Quale proprietà mette un marcatore su un vertice: `marker-start`,
/// `marker-mid` o `marker-end`.
export type MarkerPlace = "start" | "mid" | "end";

const DEGREES = 180 / Math.PI;

/// Un vertice mentre si leggono i segmenti: il segmento che ci arriva e
/// quello che ne riparte nello stesso sottotracciato, `-1` se non c'è, e per
/// i due capi di un sottotracciato chiuso il suo primo segmento e la `Z`.
interface Corner {
  readonly at: Point;
  readonly before: number;
  after: number;
  loop: { readonly first: number; readonly close: number } | null;
}

/// I vertici di un tracciato in ordine, coi loro versi. Vuoto per un
/// tracciato senza segmenti.
export function vertices(segments: readonly Segment[]): Vertex[] {
  // Il verso con cui ogni segmento parte e quello con cui arriva, lunghi 1;
  // `null` per un segmento lungo zero.
  const outs: (Point | null)[] = [];
  const ins: (Point | null)[] = [];
  const corners: Corner[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  // Il vertice dove comincia il sottotracciato in corso, e il suo primo
  // segmento; `null` dopo una `Z`, finché un altro segmento non ne apre uno.
  let head: Corner | null = null;
  let first = -1;
  const draw = (to: Point, curve: Curve): number => {
    if (head === null) {
      // Dopo una `Z` un segmento apre un sottotracciato dallo stesso punto.
      head = { at: start, before: -1, after: -1, loop: null };
      corners.push(head);
      first = -1;
    }
    const index = outs.length;
    outs.push(tangentAt(current, curve, false));
    ins.push(tangentAt(current, curve, true));
    corners[corners.length - 1]!.after = index;
    if (first === -1) first = index;
    corners.push({ at: to, before: index, after: -1, loop: null });
    current = to;
    return index;
  };
  for (const segment of segments) {
    switch (segment.kind) {
      case "move":
        current = start = segment.to;
        head = { at: segment.to, before: -1, after: -1, loop: null };
        corners.push(head);
        first = -1;
        break;
      case "close": {
        const opened: Corner | null = head;
        const close = draw(start, { kind: "line", to: start });
        const loop = { first, close };
        corners[corners.length - 1]!.loop = loop;
        // `draw` può aver aperto il sottotracciato: allora è lui il capo.
        (opened ?? corners[corners.length - 2]!).loop = loop;
        head = null;
        break;
      }
      default:
        draw(segment.to, segment);
    }
  }
  const n = outs.length;
  // Per ogni segmento, il verso con cui arriva il segmento non nullo più
  // vicino prima di lui, e quello con cui parte il più vicino dopo.
  const earlier: (Point | null)[] = new Array<Point | null>(n);
  const later: (Point | null)[] = new Array<Point | null>(n);
  let seen: Point | null = null;
  for (let i = 0; i < n; i++) {
    earlier[i] = seen;
    seen = ins[i] ?? seen;
  }
  seen = null;
  for (let i = n - 1; i >= 0; i--) {
    later[i] = seen;
    seen = outs[i] ?? seen;
  }
  const leaving = (i: number): number => direction(outs[i] ?? earlier[i] ?? later[i] ?? null);
  const arriving = (i: number): number => direction(ins[i] ?? later[i] ?? earlier[i] ?? null);
  return corners.map(({ at, before, after, loop }) => {
    if (loop !== null) return { at, angle: bisect(arriving(loop.close), leaving(loop.first)) };
    if (before >= 0 && after >= 0) return { at, angle: bisect(arriving(before), leaving(after)) };
    if (after >= 0) return { at, angle: leaving(after) };
    if (before >= 0) return { at, angle: arriving(before) };
    return { at, angle: 0 };
  });
}

/// I vertici di `list` che prendono il marcatore di `place`.
export function placed(list: readonly Vertex[], place: MarkerPlace): readonly Vertex[] {
  if (list.length === 0) return [];
  switch (place) {
    case "start":
      return [list[0]!];
    case "end":
      return [list[list.length - 1]!];
    case "mid":
      return list.slice(1, -1);
  }
}

/// Il verso di `v` in gradi; lungo l'asse x senza verso.
function direction(v: Point | null): number {
  return v === null ? 0 : Math.atan2(v[1], v[0]) * DEGREES;
}

/// Il verso a metà fra quello con cui il tracciato arriva e quello con cui
/// riparte, dalla parte dell'angolo minore.
function bisect(into: number, out: number): number {
  if (Math.abs(into - out) > 180) into += 360;
  return (into + out) / 2;
}

/// Come un `marker` mette il suo contenuto su un vertice, letto dai suoi
/// attributi.
export interface MarkerFit {
  /// Dalle coordinate del contenuto a quelle della finestra del marcatore,
  /// col punto di riferimento (`refX`, `refY`) nell'origine: il `viewBox`
  /// dentro `markerWidth` × `markerHeight`, come vuole
  /// `preserveAspectRatio`.
  readonly content: Matrix;
  /// La finestra nelle coordinate del contenuto: ciò che ne esce non si
  /// vede, perché un marcatore taglia il suo contenuto.
  readonly clip: Bounds;
  /// Vero con `markerUnits="strokeWidth"`, il valore di partenza: il
  /// marcatore cresce con lo spessore del contorno di chi lo usa.
  readonly scaled: boolean;
  /// Il verso: un angolo fisso in gradi, o quello del tracciato.
  readonly orient: number | "auto" | "auto-start-reverse";
}

/// Come disegna il marcatore che ha gli attributi `get`; `null` se non
/// disegna niente, con una finestra o un `viewBox` larghi o alti zero. Un
/// valore che non si legge vale quello di partenza.
export function markerFit(get: (name: string) => string | undefined): MarkerFit | null {
  const width = sized(get("markerWidth"));
  const height = sized(get("markerHeight"));
  if (width === 0 || height === 0) return null;
  const boxValue = get("viewBox");
  const box = boxValue === undefined ? null : viewBox(boxValue);
  if (box !== null && (box[2] === 0 || box[3] === 0)) return null;
  const view = box === null ? IDENTITY : viewBoxMatrix(box, width, height, get("preserveAspectRatio") ?? "");
  const [sx, , , sy, tx, ty] = view;
  if (!(sx > 0 && sy > 0 && Number.isFinite(sx) && Number.isFinite(sy))) return null;
  const ref = apply(view, [offset(get("refX")), offset(get("refY"))]);
  const orient = get("orient")?.trim();
  return {
    content: compose(translate(-ref[0], -ref[1]), view),
    // Con la divisione i lati di un viewBox che riempie la finestra tornano
    // esatti.
    clip: { min: [(0 - tx) / sx, (0 - ty) / sy], max: [(width - tx) / sx, (height - ty) / sy] },
    scaled: get("markerUnits")?.trim() !== "userSpaceOnUse",
    orient: orient === "auto" || orient === "auto-start-reverse" ? orient : orient === undefined ? 0 : angle(orient) ?? 0,
  };
}

/// `markerWidth` o `markerHeight`: 3 se manca o non si legge.
function sized(value: string | undefined): number {
  return (value === undefined ? null : nonNegativeLength(value)) ?? 3;
}

/// `refX` o `refY`: 0 se manca o non si legge.
function offset(value: string | undefined): number {
  return (value === undefined ? null : length(value)) ?? 0;
}

/// La matrice dalle coordinate del contenuto del marcatore `fit` a quelle
/// della forma che lo usa, messo sul vertice `vertex` da `place`, con un
/// contorno spesso `strokeWidth`.
export function markerMatrix(fit: MarkerFit, vertex: Vertex, place: MarkerPlace, strokeWidth: number): Matrix {
  const turn = typeof fit.orient === "number"
    ? fit.orient
    : fit.orient === "auto-start-reverse" && place === "start" ? vertex.angle + 180 : vertex.angle;
  const scale = fit.scaled ? strokeWidth : 1;
  return compose(compose(translate(vertex.at[0], vertex.at[1]), rotate(turn)), compose([scale, 0, 0, scale, 0, 0], fit.content));
}
