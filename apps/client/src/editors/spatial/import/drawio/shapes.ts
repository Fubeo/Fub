// Le forme di draw.io in FubDraw: la raccolta, i contorni fatti di lati, le
// punte delle linee, gli agganci e le immagini.

import type { Anchor } from "../../scene/connectors";
import type { Segment } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { TipShape, TipSize } from "../../tools/tips";
import { Notes, type End } from "../diagram";
import { num } from "./file";
import { on, type Style } from "./style";

/// Le forme di draw.io che FubDraw ha nella raccolta.
export const LIBRARY: Readonly<Record<string, string>> = {
  rhombus: "basic-diamond",
  process: "flow-predefined",
  cylinder: "flow-database",
  cylinder3: "flow-database",
  datastore: "flow-database",
  document: "flow-document",
  cloud: "callout-cloud",
  internalStorage: "flow-internal-storage",
  manualInput: "flow-manual-input",
  delay: "flow-delay",
  offPageConnector: "flow-offpage",
  callout: "callout-rectangle",
  "mxgraph.flowchart.decision": "flow-decision",
  "mxgraph.flowchart.data": "flow-data",
  "mxgraph.flowchart.document": "flow-document",
  "mxgraph.flowchart.multi-document": "flow-multidocument",
  "mxgraph.flowchart.terminator": "flow-terminator",
  "mxgraph.flowchart.predefined_process": "flow-predefined",
  "mxgraph.flowchart.internal_storage": "flow-internal-storage",
  "mxgraph.flowchart.manual_input": "flow-manual-input",
  "mxgraph.flowchart.manual_operation": "flow-manual-operation",
  "mxgraph.flowchart.preparation": "flow-preparation",
  "mxgraph.flowchart.delay": "flow-delay",
  "mxgraph.flowchart.off-page_reference": "flow-offpage",
  "mxgraph.flowchart.database": "flow-database",
  "mxgraph.flowchart.stored_data": "flow-data",
  "mxgraph.basic.cloud_callout": "callout-cloud",
};

/// Le forme di draw.io che sono un rettangolo o un'ellisse.
export const RECTS: ReadonlySet<string> = new Set(["", "rect", "rectangle", "label", "mxgraph.flowchart.process", "mxgraph.basic.rect"]);
export const ELLIPSES: ReadonlySet<string> = new Set(["ellipse", "doubleEllipse", "mxgraph.flowchart.on-page_reference", "mxgraph.flowchart.start_1", "mxgraph.flowchart.start_2", "mxgraph.flowchart.or", "mxgraph.flowchart.summing_function"]);

/// Gli archi di draw.io a gomito.
export const ORTHOGONAL: ReadonlySet<string> = new Set(["orthogonalEdgeStyle", "elbowEdgeStyle", "entityRelationEdgeStyle", "segmentEdgeStyle", "sideToSideEdgeStyle", "topToBottomEdgeStyle"]);

/// Gli stili a gomito semplici di draw.io, che fanno una curva sola.
export const SIMPLE_ELBOWS: ReadonlySet<string> = new Set(["elbowEdgeStyle", "sideToSideEdgeStyle", "topToBottomEdgeStyle"]);

/// Il contorno chiuso di punti nel riquadro `w` × `h`, in frazioni.
function polygon(points: readonly Point[], w: number, h: number): Segment[] {
  const at = ([x, y]: Point): Point => [w > 0 ? x / w : 0, h > 0 ? y / h : 0];
  return [{ kind: "move", to: at(points[0]!) }, ...points.slice(1).map((p): Segment => ({ kind: "line", to: at(p) })), { kind: "close" }];
}

/// Il contorno della forma `shape` di draw.io in un riquadro `w` × `h`, in
/// frazioni, prima della direzione; `null` se non è una forma di lati.
export function outlineOf(shape: string, style: Style, w: number, h: number): Segment[] | null {
  const fixed = on(style, "fixedSize");
  /// La misura `size` della forma: una frazione di `side`, o assoluta.
  const size = (fraction: number, absolute: number, side: number): number => {
    const value = num(style.get("size"), fixed ? absolute : fraction);
    return fixed ? Math.min(side, Math.max(0, value)) : side * Math.min(1, Math.max(0, value));
  };
  switch (shape) {
    case "triangle":
      return polygon([[0, 0], [w, h / 2], [0, h]], w, h);
    case "hexagon": {
      const s = size(0.25, 20, w);
      return polygon([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]], w, h);
    }
    case "parallelogram": {
      const s = size(0.2, 20, w);
      return polygon([[0, h], [s, 0], [w, 0], [w - s, h]], w, h);
    }
    case "trapezoid": {
      const s = size(0.2, 20, w);
      return polygon([[0, h], [s, 0], [w - s, 0], [w, h]], w, h);
    }
    case "step": {
      const s = size(0.2, 20, w);
      return polygon([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h], [s, h / 2]], w, h);
    }
    case "card": {
      const s = Math.min(w, h, num(style.get("size"), 30));
      return polygon([[s, 0], [w, 0], [w, h], [0, h], [0, s]], w, h);
    }
    case "note": {
      const s = Math.min(w, h, num(style.get("size"), 30));
      return polygon([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]], w, h);
    }
    case "mxgraph.flowchart.loop_limit": {
      const s = Math.min(w / 2, h / 2, 20);
      return polygon([[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]], w, h);
    }
    case "mxgraph.flowchart.extract_or_measurement":
      return polygon([[w / 2, 0], [w, h], [0, h]], w, h);
    case "mxgraph.flowchart.merge_or_storage":
      return polygon([[0, 0], [w, 0], [w / 2, h]], w, h);
    case "actor": {
      // `mxActor`: la testa e le spalle in quattro cubiche.
      const third = 1 / 3;
      return [
        { kind: "move", to: [0, 1] },
        { kind: "cubic", c1: [0, 0.6], c2: [0, 0.4], to: [0.5, 0.4] },
        { kind: "cubic", c1: [0.5 - third, 0.4], c2: [0.5 - third, 0], to: [0.5, 0] },
        { kind: "cubic", c1: [0.5 + third, 0], c2: [0.5 + third, 0.4], to: [0.5, 0.4] },
        { kind: "cubic", c1: [1, 0.4], c2: [1, 0.6], to: [1, 1] },
        { kind: "close" },
      ];
    }
    default:
      return null;
  }
}

/// `segments` girati per la direzione di draw.io (`east` è quella di
/// partenza) e ribaltati, sempre nel loro riquadro.
export function directed(segments: readonly Segment[], direction: string, flipX: boolean, flipY: boolean): Segment[] {
  const turn = ([u, v]: Point): Point => {
    let p: Point = direction === "south" ? [1 - v, u] : direction === "north" ? [v, 1 - u] : direction === "west" ? [1 - u, 1 - v] : [u, v];
    if (flipX) p = [1 - p[0], p[1]];
    if (flipY) p = [p[0], 1 - p[1]];
    return p;
  };
  return segments.map((segment): Segment => {
    switch (segment.kind) {
      case "move":
      case "line":
        return { kind: segment.kind, to: turn(segment.to) };
      case "cubic":
        return { kind: "cubic", c1: turn(segment.c1), c2: turn(segment.c2), to: turn(segment.to) };
      default:
        return segment;
    }
  });
}

/// La punta di un capo e la nota se FubDraw la disegna diversa.
export function tipOf(name: string | undefined, filled: boolean, size: number, notes: Notes): End | null {
  if (name === undefined || name === "" || name === "none") return null;
  const tipSize: TipSize = size < 5 ? "small" : size <= 8 ? "medium" : "large";
  const tip = (shape: TipShape, hollow = !filled): End => {
    if (hollow) notes.add("tip", name);
    return { shape, size: tipSize };
  };
  switch (name) {
    case "classic":
    case "classicThin":
    case "block":
    case "blockThin":
      return tip("triangle");
    case "open":
    case "openThin":
      return tip("vee", false);
    case "async":
    case "openAsync":
      return tip(name === "async" ? "triangle" : "vee", true);
    case "oval":
    case "circle":
    case "dot":
      return tip("circle", name === "circle" || !filled);
    case "diamond":
    case "diamondThin":
      return tip("diamond");
    case "box":
      return tip("square");
    case "dash":
    case "ERone":
      return tip("bar", false);
    case "ERmandOne":
    case "ERzeroToOne":
      return tip(name === "ERmandOne" ? "bar" : "circle", true);
    default:
      notes.add("tip", name);
      return null;
  }
}

/// Il lato di un aggancio fisso, in frazioni del riquadro: quello su cui
/// sta il punto; `auto` se il punto non è sul bordo.
export function anchorOf(x: string | undefined, y: string | undefined): Anchor {
  if (x === undefined || y === undefined) return "auto";
  const [u, v] = [num(x, 0.5), num(y, 0.5)];
  if (Math.abs(u - 0.5) < 1e-6 && Math.abs(v - 0.5) < 1e-6) return "center";
  if (v <= 0) return "top";
  if (v >= 1) return "bottom";
  if (u <= 0) return "left";
  if (u >= 1) return "right";
  return "auto";
}

/// L'immagine di uno stile come `href`: nello stile il `;` separa le chiavi,
/// e draw.io scrive il base64 di un data URI senza `;base64`.
export function imageHref(value: string): string {
  const data = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+),([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  return data === null ? value.trim() : `data:${data[1]};base64,${data[2]!.replace(/\s+/g, "")}`;
}
