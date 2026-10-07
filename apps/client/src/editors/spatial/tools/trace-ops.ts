// «Ricalca immagine» (livello Esperto) nel disegno: le forme che il ricalco
// trova nei pixel di un'immagine (`trace.ts`, nel suo worker) diventano
// tracciati pieni, in un gruppo subito sopra l'immagine. Senza DOM.
//
// - **Dove si vede l'immagine.** Il riquadro dell'immagine e il suo
//   `preserveAspectRatio` dicono quali pixel si vedono e dove: si ricalcano
//   quelli, e ogni forma va dove sono i suoi pixel. Con `slice` si ricalca
//   la parte che il riquadro mostra, coi pixel interi che la coprono.
// - **Il gruppo** ha la trasformazione dell'immagine, la sua opacità e il
//   suo titolo: chi legge il disegno con un lettore di schermo trova lo
//   stesso nome. Ogni
//   forma è un `path` pieno del suo colore, senza contorno anche dove il
//   livello ne dà uno, nell'ordine in cui il ricalco le dipinge.
// - **L'immagine resta**, nascosta, sotto il gruppo: il pannello degli
//   oggetti la mostra di nuovo. I suoi pixel non si riscrivono.
// - **Un passo di annulla**, e dopo è scelto il gruppo. Ogni tracciato entra
//   con la sua operazione: il ricalco di una foto pesa più di quanto ne
//   porta una.

import type { Bounds, Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import { pathData, type Elem } from "../scene/serialize";
import { utf8Length } from "../scene/text";
import { length, viewBoxMatrix } from "../scene/values";
import { hrefOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Traced } from "./trace";

/// Un rettangolo di pixel interi.
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Ciò che il ricalco legge di un'immagine: l'`href` com'è scritto, il
/// riquadro e il `preserveAspectRatio`.
export interface TraceSource {
  readonly href: string;
  readonly box: Bounds;
  readonly aspect: string;
}

/// Ciò che il ricalco legge di `image`; `null` senza `href` o con un
/// riquadro vuoto, che non mostra niente.
export function traceSource(image: ElementPart): TraceSource | null {
  const attrs = plainAttributes(image);
  const href = hrefOf(image);
  const at = (name: string): number => length(attrs.get(name) ?? "0") ?? 0;
  const [x, y, width, height] = [at("x"), at("y"), at("width"), at("height")];
  if (href === null || !(width > 0 && height > 0)) return null;
  return { href, box: { min: [x, y], max: [x + width, y + height] }, aspect: attrs.get("preserveAspectRatio") ?? "" };
}

/// Ciò che si vede di un'immagine di `natural` pixel nel riquadro `box`
/// col `preserveAspectRatio` `aspect`: i pixel interi che lo coprono, e il
/// rettangolo dove vanno, nelle coordinate dell'immagine. `null` se non se
/// ne vede niente.
export function imageWindow(box: Bounds, aspect: string, natural: readonly [number, number]): { readonly pixels: PixelRect; readonly target: Bounds } | null {
  const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
  const [width, height] = natural;
  if (!(w > 0 && h > 0 && width > 0 && height > 0)) return null;
  const [sx, , , sy, tx, ty] = viewBoxMatrix([0, 0, width, height], w, h, aspect);
  // Il riquadro riportato nei pixel, dentro l'immagine.
  const x0 = Math.max(0, -tx / sx);
  const x1 = Math.min(width, (w - tx) / sx);
  const y0 = Math.max(0, -ty / sy);
  const y1 = Math.min(height, (h - ty) / sy);
  if (!(x1 > x0 && y1 > y0)) return null;
  // I pixel interi più vicini, almeno uno: si stirano di meno di un pixel
  // per lato sul rettangolo che si vede.
  const left = Math.min(width - 1, Math.round(x0));
  const top = Math.min(height - 1, Math.round(y0));
  const right = Math.max(left + 1, Math.min(width, Math.round(x1)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round(y1)));
  return {
    pixels: { x: left, y: top, width: right - left, height: bottom - top },
    target: {
      min: [box.min[0] + tx + x0 * sx, box.min[1] + ty + y0 * sy],
      max: [box.min[0] + tx + x1 * sx, box.min[1] + ty + y1 * sy],
    },
  };
}

/// Il valore di `name` che `node` riceve da chi lo contiene, se qualcuno lo
/// scrive; la radice no, come per le altre forme.
function inherited(node: ElementPart, name: string): string | undefined {
  for (let at = node.parent; at !== null && at.parent !== null; at = at.parent) {
    const value = plainAttributes(at).get(name)?.trim();
    if (value !== undefined && value !== "inherit") return value;
  }
  return undefined;
}

const hex = (value: number): string => Math.round(value).toString(16).padStart(2, "0");

/// Il gruppo del ricalco `traced` dell'immagine `image`, coi pixel di lavoro
/// portati in `target`: la trasformazione e il titolo dell'immagine, e un
/// `path` pieno per forma. Con `ids`, ogni elemento ha il suo id, come
/// vuole un'operazione; senza, è l'anteprima.
export function tracedGroup(image: ElementPart, traced: Traced, target: Bounds, ids: NewIds | null): Elem {
  const kx = (target.max[0] - target.min[0]) / traced.width;
  const ky = (target.max[1] - target.min[1]) / traced.height;
  const at = ([x, y]: Point): Point => [target.min[0] + x * kx, target.min[1] + y * ky];
  const moved = (segment: Segment): Segment => {
    switch (segment.kind) {
      case "move":
      case "line":
        return { ...segment, to: at(segment.to) };
      case "cubic":
        return { kind: "cubic", c1: at(segment.c1), c2: at(segment.c2), to: at(segment.to) };
      default:
        return segment;
    }
  };
  const named = (attrs: Record<string, string>): Record<string, string> => (ids === null ? attrs : { id: ids.next("object"), ...attrs });
  const attrs: Record<string, string> = {};
  const own = plainAttributes(image);
  for (const name of ["transform", "opacity"]) {
    const value = own.get(name);
    if (value !== undefined) attrs[name] = value;
  }
  // Le forme sono solo il loro colore.
  const stroke = inherited(image, "stroke");
  if (stroke !== undefined && stroke !== "none") attrs.stroke = "none";
  const opacity = inherited(image, "fill-opacity");
  if (opacity !== undefined && Number(opacity) !== 1) attrs["fill-opacity"] = "1";
  const children: Elem[] = [];
  const title = image.details?.title;
  if (title !== undefined && title !== "") children.push({ tag: "title", attrs: {}, text: title });
  for (const shape of traced.shapes) {
    const [r, g, b] = shape.color;
    children.push({ tag: "path", attrs: named({ d: pathData(shape.segments.map(moved)), fill: `#${hex(r)}${hex(g)}${hex(b)}` }) });
  }
  return { tag: "g", attrs: named(attrs), children };
}

/// Ciò che un elemento aggiunge al testo oltre al nome, agli attributi e
/// al testo, in byte, più o meno: la riga rientrata, i segni e un id.
const LINE_BYTES = 40;

/// Quanto pesa il gruppo `group` nel disegno: i byte di cui cresce il
/// testo, più o meno, con ogni elemento sulla sua riga e col suo id; gli
/// elementi; e il valore più lungo, in byte.
export function weightOf(group: Elem): { readonly bytes: number; readonly elements: number; readonly longest: number } {
  let bytes = 0;
  let elements = 0;
  let longest = 0;
  const visit = (elem: Elem): void => {
    elements++;
    bytes += utf8Length(elem.tag) + LINE_BYTES + utf8Length(elem.text ?? "");
    for (const [name, value] of Object.entries(elem.attrs)) {
      const size = utf8Length(value);
      bytes += utf8Length(name) + size + 4;
      longest = Math.max(longest, size);
    }
    for (const child of elem.children ?? []) visit(child);
  };
  visit(group);
  return { bytes, elements, longest };
}

/// Le operazioni del ricalco `traced` dell'immagine `image`, coi pixel di
/// lavoro portati in `target`: il gruppo di [`tracedGroup`] subito sopra
/// l'immagine, e l'immagine nascosta. Dopo è scelto il gruppo.
export function traceOps(model: DocumentModel, image: ElementPart, traced: Traced, target: Bounds, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const id = plan.idOf(image);
  const group = tracedGroup(image, traced, target, ids);
  const groupId = group.attrs.id!;
  const children = group.children ?? [];
  plan.ops.push({ op: "add", parent: plan.parentOf(image), pos: { after: id }, elem: { ...group, children: children.filter((child) => child.tag === "title") } });
  for (const child of children) if (child.tag !== "title") plan.ops.push({ op: "add", parent: groupId, pos: { last: true }, elem: child });
  plan.ops.push({ op: "set", id, attrs: { display: "none" } });
  return plan.finish([groupId]);
}
