// Le forme: rettangolo, ellisse, linea e freccia dell'Essenziale, da due
// punti di un trascinamento, e poligono e stella dello Standard, dal centro
// e da un vertice (formato della scena, §4 e §6).
//
// Gli elementi sono quelli che l'operazione `add` scrive: geometria con al
// più due decimali, contorno del colore scelto, nessun riempimento. La
// freccia, il poligono e la stella sono `path` con `fub:shape` e
// `fub:geom`, e il loro `d` si calcola dalla geometria già arrotondata, così
// chi lo rigenera da `fub:geom` ottiene lo stesso testo.

import { formatNumber } from "../number";
import type { Point } from "../scene/matrix";
import { MAX_COUNT, MIN_COUNT, polygonalAttrs, STAR_RATIO, type Polygonal, type PolygonalShape } from "../scene/parametric";
import { pathData, type Elem } from "../scene/serialize";

export type ShapeTool = "rect" | "ellipse" | "line" | "arrow" | "polygon";

/// Come disegna lo strumento Poligono: la forma, i lati del poligono e le
/// punte della stella, ciascuno il suo, il rapporto interno della stella e
/// il raggio degli angoli.
export interface PolygonTool {
  readonly shape: PolygonalShape;
  readonly sides: number;
  readonly points: number;
  readonly ratio: number;
  readonly corner: number;
}

/// Lo strumento Poligono com'è all'inizio: un esagono, e una stella a cinque
/// punte coi lati in linea a due a due.
export const POLYGON_TOOL: PolygonTool = { shape: "polygon", sides: 6, points: 5, ratio: STAR_RATIO, corner: 0 };

/// Il rapporto interno più piccolo che lo strumento propone: sotto, le punte
/// sono aghi.
export const MIN_RATIO = 0.01;

/// I lati, o le punte, che lo strumento disegna adesso.
export function polygonCount(tool: PolygonTool): number {
  return tool.shape === "star" ? tool.points : tool.sides;
}

/// Lo strumento con `count` lati, o punte, fra 3 e 1000.
export function withCount(tool: PolygonTool, count: number): PolygonTool {
  const value = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(count)));
  return tool.shape === "star" ? { ...tool, points: value } : { ...tool, sides: value };
}

/// Il rapporto interno un passo più su (`step` 1) o più giù (-1): i passi
/// vanno ai multipli di 0,05, fra 0,01 e 1, così da 0,382 si va a 0,4 o a
/// 0,35.
export function stepRatio(ratio: number, step: 1 | -1): number {
  const at = ratio / 0.05;
  const next = step > 0 ? Math.floor(at + 1e-9) + 1 : Math.ceil(at - 1e-9) - 1;
  return Math.min(1, Math.max(MIN_RATIO, Number((next * 0.05).toFixed(2))));
}

export interface ShapeStyle {
  /// `#rrggbb`.
  readonly color: string;
  /// `stroke-width`, in unità della scena.
  readonly width: number;
}

/// L'angolo fra due direzioni a cui si aggancia una linea con Maiusc.
export const SNAP_DEGREES = 15;

/// L'angolo fra ogni lato della punta e l'asta (§6).
const HEAD_DEGREES = 30;

/// Un valore della geometria come lo scrive il file.
function round(value: number): number {
  return Number(formatNumber(value, 2));
}

function text(value: number): string {
  return formatNumber(value, 2);
}

/// La fine del trascinamento con Maiusc: un quadrato o un cerchio per
/// rettangolo ed ellisse, un angolo multiplo di 15° per linea e freccia. Un
/// poligono la lascia dov'è: Maiusc ne tiene diritta la rotazione.
export function constrainEnd(tool: ShapeTool, from: Point, to: Point): Point {
  if (tool === "polygon") return to;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (tool === "rect" || tool === "ellipse") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return [from[0] + (dx < 0 ? -side : side), from[1] + (dy < 0 ? -side : side)];
  }
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const step = (SNAP_DEGREES * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + length * Math.cos(angle), from[1] + length * Math.sin(angle)];
}

/// `d` di una freccia da (`x1`, `y1`) a (`x2`, `y2`): l'asta e la punta
/// aperta, lunga 3 × `strokeWidth` + 6, con i lati a 30° dall'asta (§6).
export function arrowPath(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): string {
  const head = 3 * strokeWidth + 6;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const side = (HEAD_DEGREES * Math.PI) / 180;
  const left: Point = [x2 - head * Math.cos(angle - side), y2 - head * Math.sin(angle - side)];
  const right: Point = [x2 - head * Math.cos(angle + side), y2 - head * Math.sin(angle + side)];
  return pathData([
    { kind: "move", to: [x1, y1] },
    { kind: "line", to: [x2, y2] },
    { kind: "move", to: left },
    { kind: "line", to: [x2, y2] },
    { kind: "line", to: right },
  ]);
}

/// Il poligono, o la stella, trascinato dal centro `center` a `to`: il
/// raggio è la distanza, e il puntatore tiene il vertice, o la punta, più
/// vicino a dove la forma diritta ne ha uno. Così la rotazione è la più
/// piccola, fra mezzo lato indietro e mezzo avanti; `straight` la tiene a 0.
/// `null` se `to` è sul centro.
export function polygonDrag(center: Point, to: Point, tool: PolygonTool, straight: boolean): Polygonal | null {
  const r = Math.hypot(to[0] - center[0], to[1] - center[1]);
  if (!(r > 0)) return null;
  const count = polygonCount(tool);
  const step = 360 / count;
  // Dove la forma diritta ha il vertice 0: a sinistra del lato in basso per
  // un poligono, in alto per la stella (formato della scena, poligoni e
  // stelle, §1 e §2).
  const first = tool.shape === "star" ? 270 : 90 + 180 / count;
  const turned = (Math.atan2(to[1] - center[1], to[0] - center[0]) * 180) / Math.PI - first;
  const rotation = straight ? 0 : turned - step * Math.round(turned / step);
  return {
    shape: tool.shape,
    cx: center[0],
    cy: center[1],
    r,
    count,
    ratio: tool.shape === "star" ? tool.ratio : null,
    rotation: rotation === 0 ? 0 : rotation,
    corner: tool.corner,
  };
}

/// L'elemento di una forma trascinata da `from` a `to`, nelle coordinate del
/// livello che la riceve: per il poligono e la stella `from` è il centro, e
/// `polygon` dice come disegnarli. `null` se è più piccola di `minimum` (un
/// tocco, non un trascinamento) o se, arrotondata, non si disegnerebbe: SVG
/// non disegna un rettangolo o un'ellisse con un lato nullo.
export function shapeElem(
  tool: ShapeTool,
  id: string,
  from: Point,
  to: Point,
  style: ShapeStyle,
  minimum: number,
  polygon: PolygonTool & { readonly straight: boolean } = { ...POLYGON_TOOL, straight: false },
): Elem | null {
  const stroke = { stroke: style.color, "stroke-width": text(style.width) };
  if (tool === "polygon") {
    const shape = polygonDrag(from, to, polygon, polygon.straight);
    if (shape === null || shape.r < minimum) return null;
    const written = polygonalAttrs(shape);
    if (written === null) return null;
    return { tag: "path", attrs: { id, ...written, fill: "none", ...stroke } };
  }
  if (tool === "rect" || tool === "ellipse") {
    const x1 = round(Math.min(from[0], to[0]));
    const y1 = round(Math.min(from[1], to[1]));
    const x2 = round(Math.max(from[0], to[0]));
    const y2 = round(Math.max(from[1], to[1]));
    if (Math.max(x2 - x1, y2 - y1) < minimum) return null;
    if (tool === "rect") {
      const width = round(x2 - x1);
      const height = round(y2 - y1);
      if (width <= 0 || height <= 0) return null;
      return {
        tag: "rect",
        attrs: { id, x: text(x1), y: text(y1), width: text(width), height: text(height), fill: "none", ...stroke },
      };
    }
    const rx = round((x2 - x1) / 2);
    const ry = round((y2 - y1) / 2);
    if (rx <= 0 || ry <= 0) return null;
    return {
      tag: "ellipse",
      attrs: { id, cx: text((x1 + x2) / 2), cy: text((y1 + y2) / 2), rx: text(rx), ry: text(ry), fill: "none", ...stroke },
    };
  }
  const [x1, y1, x2, y2] = [round(from[0]), round(from[1]), round(to[0]), round(to[1])];
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0 || length < minimum) return null;
  if (tool === "line") {
    return {
      tag: "line",
      attrs: { id, x1: text(x1), y1: text(y1), x2: text(x2), y2: text(y2), ...stroke, "stroke-linecap": "round" },
    };
  }
  return {
    tag: "path",
    attrs: {
      id,
      "fub:shape": "arrow",
      "fub:geom": [x1, y1, x2, y2].map(text).join(" "),
      d: arrowPath(x1, y1, x2, y2, style.width),
      fill: "none",
      ...stroke,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
  };
}
