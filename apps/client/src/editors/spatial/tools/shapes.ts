// Le forme: rettangolo, ellisse, linea e freccia, da due punti di un
// trascinamento (formato della scena, §4 e §6), e la copertura delle
// annotazioni, un rettangolo opaco senza contorno.
//
// Gli elementi sono quelli che l'operazione `add` scrive: geometria con al
// più due decimali, contorno del colore scelto, nessun riempimento. La
// freccia è un `path` con `fub:shape="arrow"` e `fub:geom`, e il suo `d` si
// calcola dalla geometria già arrotondata, così chi lo rigenera da
// `fub:geom` ottiene lo stesso testo.

import { formatNumber } from "../number";
import type { Point } from "../scene/matrix";
import { pathData, type Elem } from "../scene/serialize";

export type ShapeTool = "rect" | "ellipse" | "line" | "arrow" | "cover";

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
/// rettangolo ed ellisse, un angolo multiplo di 15° per linea e freccia.
export function constrainEnd(tool: ShapeTool, from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (tool === "rect" || tool === "ellipse" || tool === "cover") {
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

/// L'elemento di una forma trascinata da `from` a `to`, nelle coordinate del
/// livello che la riceve. `null` se è più piccola di `minimum` (un tocco, non
/// un trascinamento) o se, arrotondata, non si disegnerebbe: SVG non disegna
/// un rettangolo o un'ellisse con un lato nullo. La copertura è riempita del
/// colore e opaca: nasconde alla vista, e non toglie niente dal PDF.
export function shapeElem(
  tool: ShapeTool,
  id: string,
  from: Point,
  to: Point,
  style: ShapeStyle,
  minimum: number,
): Elem | null {
  const stroke = { stroke: style.color, "stroke-width": text(style.width) };
  if (tool === "rect" || tool === "ellipse" || tool === "cover") {
    const x1 = round(Math.min(from[0], to[0]));
    const y1 = round(Math.min(from[1], to[1]));
    const x2 = round(Math.max(from[0], to[0]));
    const y2 = round(Math.max(from[1], to[1]));
    if (Math.max(x2 - x1, y2 - y1) < minimum) return null;
    if (tool === "rect" || tool === "cover") {
      const width = round(x2 - x1);
      const height = round(y2 - y1);
      if (width <= 0 || height <= 0) return null;
      if (tool === "cover") {
        return { tag: "rect", attrs: { id, x: text(x1), y: text(y1), width: text(width), height: text(height), fill: style.color } };
      }
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
