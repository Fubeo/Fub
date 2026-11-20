// Le celle di una pagina di draw.io con la loro geometria: i riquadri, i
// punti di un arco e i suoi capi.

import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import type { ElementNode, XmlDocument } from "../../scene/xml";
import { attr, elementsIn, num, type Page } from "./file";
import { type Style, styleOf } from "./style";

export interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly relative: boolean;
  readonly points: readonly Point[];
  readonly source: Point | null;
  readonly target: Point | null;
  /// Lo spostamento dell'etichetta di un arco dal suo punto sulla linea.
  readonly offset: Point | null;
}

/// Una cella del modello, coi campi che si leggono.
export interface Cell {
  readonly id: string;
  readonly parent: string | null;
  readonly value: string;
  readonly style: Style;
  readonly vertex: boolean;
  readonly edge: boolean;
  readonly source: string | null;
  readonly target: string | null;
  readonly geometry: Geometry | null;
  readonly visible: boolean;
  readonly collapsed: boolean;
  /// Gli attributi dell'oggetto che avvolge la cella, per i segnaposto.
  readonly fields: ReadonlyMap<string, string>;
  readonly link: string | null;
}

/// La geometria di una cella.
function geometryOf(doc: XmlDocument, cell: ElementNode): Geometry | null {
  const element = elementsIn(doc, cell).find((child) => child.local === "mxGeometry");
  if (element === undefined) return null;
  const point = (each: ElementNode): Point => [num(attr(each, "x"), 0), num(attr(each, "y"), 0)];
  let points: Point[] = [];
  let source: Point | null = null;
  let target: Point | null = null;
  let offset: Point | null = null;
  for (const child of elementsIn(doc, element)) {
    const as = attr(child, "as");
    if (child.local === "Array" && as === "points") points = elementsIn(doc, child).filter((each) => each.local === "mxPoint").map(point);
    else if (child.local === "mxPoint" && as === "sourcePoint") source = point(child);
    else if (child.local === "mxPoint" && as === "targetPoint") target = point(child);
    else if (child.local === "mxPoint" && as === "offset") offset = point(child);
  }
  return {
    x: num(attr(element, "x"), 0),
    y: num(attr(element, "y"), 0),
    width: Math.max(0, num(attr(element, "width"), 0)),
    height: Math.max(0, num(attr(element, "height"), 0)),
    relative: attr(element, "relative") === "1",
    points,
    source,
    target,
    offset,
  };
}

/// I capi di un arco, come li dà il file.
export interface Ends {
  readonly source: { readonly cell: Cell; readonly box: Bounds } | null;
  readonly target: { readonly cell: Cell; readonly box: Bounds } | null;
  readonly via: readonly Point[];
  readonly startFixed: Point | null;
  readonly endFixed: Point | null;
  readonly startAt: Point;
  readonly endAt: Point;
}

/// La geometria di un'etichetta a metà della sua linea.
export const ON_LINE: Geometry = { x: 0, y: 0, width: 0, height: 0, relative: true, points: [], source: null, target: null, offset: null };

/// Le celle di un modello, nell'ordine del file.
export function cellsOf(page: Page): Cell[] {
  const root = elementsIn(page.doc, page.model).find((child) => child.local === "root");
  if (root === undefined) return [];
  const out: Cell[] = [];
  for (const element of elementsIn(page.doc, root)) {
    let cell: ElementNode | undefined = element;
    let wrapper: ElementNode | null = null;
    if (element.local !== "mxCell") {
      wrapper = element;
      cell = elementsIn(page.doc, element).find((child) => child.local === "mxCell");
    }
    if (cell === undefined) continue;
    const id = attr(wrapper ?? cell, "id") ?? attr(cell, "id");
    if (id === undefined) continue;
    const fields = new Map<string, string>();
    if (wrapper !== null) for (const each of wrapper.attrs) if (each.ns === 0 && each.local !== "id" && each.local !== "label") fields.set(each.local, each.value);
    const edge = attr(cell, "edge") === "1";
    const link = wrapper === null ? null : (attr(wrapper, "link") ?? null);
    out.push({
      id,
      parent: attr(cell, "parent") ?? null,
      value: (wrapper === null ? attr(cell, "value") : attr(wrapper, "label")) ?? "",
      style: styleOf(attr(cell, "style") ?? "", edge),
      vertex: attr(cell, "vertex") === "1",
      edge,
      source: attr(cell, "source") ?? null,
      target: attr(cell, "target") ?? null,
      geometry: geometryOf(page.doc, cell),
      visible: attr(cell, "visible") !== "0",
      collapsed: attr(cell, "collapsed") === "1",
      fields,
      link: link === "" ? null : link,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Le forme.
// ---------------------------------------------------------------------------
