// I tratti a penna che diventano forme (livello Standard, parte «Forme dal
// tratto»): tenuti fermi alla fine mentre si disegnano, o scelti e passati a
// «Rendi forma». La forma viene dal riconoscimento (`recognize.ts`); qui si
// scrive al posto del tratto. Il comando diventa un `batch` solo, come
// quelli di «Disponi».
//
// - **La forma come si vede.** Il tratto si riconosce nella scena, così un
//   cerchio è un cerchio sullo schermo anche dentro un gruppo girato o
//   scalato; poi torna nelle coordinate del tratto. Dentro un gruppo che
//   deforma, che schiaccia un cerchio in un'ellisse, il tratto si riconosce
//   nelle sue coordinate.
// - **L'oggetto resta lui.** Stesso id, stesso posto fra i fratelli, stessa
//   trasformazione, stessi titolo e descrizione, stessi attributi tranne
//   quelli dell'inchiostro. Il colore del tratto diventa il contorno, lo
//   spessore del pennello il suo spessore, e la forma non si riempie, come
//   quelle degli strumenti.
// - **Il comando non ha soglie.** Chi sceglie un tratto piccolo e chiede la
//   forma, la vuole: la misura della scrittura protegge soltanto la tenuta
//   ferma.
// - **Un gruppo o un collegamento** passano il comando alle parti, tranne
//   quelle bloccate. L'evidenziatore, le forme, i testi e le immagini
//   restano come sono, e non si contano. Un tratto a penna che non somiglia
//   a una forma resta inchiostro, e il comando lo conta.

import { parseBrush } from "../ink/brush";
import { decodeInk, inkLength, inkPoint } from "../ink/codec";
import { BoundsBuilder, type Bounds } from "../scene/geometry";
import { apply, compose, IDENTITY, invert, type Matrix, type Point } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { transform } from "../scene/values";
import { elemOf, fubAttributes, nodeOf, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import { elemBounds, type SceneIndex, type Unit } from "./hit";
import { mapped, recognize, shapeOfRecognized, type Recognized } from "./recognize";
import { replaceElem } from "./topath";

/// Gli attributi del tratto che la forma non tiene: l'inchiostro, il
/// pennello e il contorno pieno che il tratto riempiva. Il `transform` lo
/// riscrive la forma.
const INK: ReadonlySet<string> = new Set(["id", "d", "fill", "transform", "fub:tool", "fub:ink", "fub:brush", "fub:at"]);

/// «Rendi forma» pronto: le operazioni, quanti tratti diventano forme e
/// quanti restano inchiostro, e dove stanno le forme nella scena.
export interface InkShaped extends Arranged {
  readonly changed: number;
  readonly refused: number;
  readonly extent: Bounds | null;
}

/// Vero se `node` è un tratto a penna.
export function isPenStroke(node: ElementPart): boolean {
  return node.details?.role === "stroke" && node.details.stroke?.tool === "pen";
}

/// I punti del tratto `node`, dal suo inchiostro, nelle sue coordinate:
/// prima del suo `transform`. `null` se l'inchiostro non si legge.
export function strokePoints(node: ElementPart): Point[] | null {
  try {
    const ink = decodeInk(fubAttributes(node).get("ink") ?? "");
    const points: Point[] = [];
    for (let i = 0; i < inkLength(ink); i++) points.push(inkPoint(ink, i));
    return points;
  } catch {
    return null;
  }
}

/// La forma del tratto `unit`, nelle sue coordinate; `null` se non somiglia
/// a una forma, o se l'inchiostro non si legge.
export function strokeShape(unit: Unit): Recognized | null {
  const points = strokePoints(unit.node);
  if (points === null) return null;
  const matrix = unit.matrix;
  const seen = recognize(points.map((p) => apply(matrix, p)));
  if (seen === null) return null;
  const back = invert(matrix);
  return (back === null ? null : mapped(seen, back)) ?? recognize(points);
}

/// L'elemento che prende il posto del tratto `node` con la forma `shape`,
/// nelle coordinate del tratto prima del suo `transform` `frame`. `null` se
/// la forma non si disegna, o se il pennello non si legge.
export function strokeShapeElem(node: ElementPart, shape: Recognized, frame: Matrix): Elem | null {
  const before = elemOf(node);
  if (before === null) return null;
  let width: number;
  try {
    width = parseBrush(fubAttributes(node).get("brush") ?? "").size;
  } catch {
    return null;
  }
  const elem = shapeOfRecognized(shape, "", { color: before.attrs.fill ?? "#000000", width }, frame);
  if (elem === null) return null;
  const attrs: Record<string, string> = { ...elem.attrs };
  for (const [name, value] of Object.entries(before.attrs)) if (!INK.has(name) && !(name in attrs)) attrs[name] = value;
  return before.children === undefined ? { tag: elem.tag, attrs } : { tag: elem.tag, attrs, children: before.children };
}

/// Il riquadro nella scena di `elem`, col suo `transform`, in un genitore
/// che porta nella scena con `parent`.
function placedBounds(elem: Elem, parent: Matrix): Bounds | null {
  const own = elem.attrs.transform === undefined ? IDENTITY : (transform(elem.attrs.transform) ?? IDENTITY);
  return elemBounds(elem, compose(parent, own));
}

/// Le operazioni che fanno di ogni tratto a penna fra `units`, e dentro i
/// gruppi e i collegamenti fra loro, la sua forma. La selezione resta la
/// stessa.
export function inkShapeOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], ids: NewIds): InkShaped {
  const plan = new Plan(model, ids);
  const extent = new BoundsBuilder();
  let changed = 0;
  let refused = 0;
  let drawn = false;

  const visit = (unit: Unit): void => {
    if (unit.role === "group" || unit.role === "link") {
      for (const child of index.children(unit)) visit(child);
      return;
    }
    if (!isPenStroke(unit.node)) return;
    const shape = strokeShape(unit);
    const elem = shape === null ? null : strokeShapeElem(unit.node, shape, unit.transform);
    if (elem === null || !replaceElem(plan, unit.node, elem)) {
      refused++;
      return;
    }
    changed++;
    const bounds = placedBounds(elem, unit.parent);
    if (bounds !== null) {
      extent.include(bounds.min);
      extent.include(bounds.max);
      drawn = true;
    }
  };

  for (const unit of units) visit(unit);
  const keys = units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key));
  return { ...plan.finish(keys), changed, refused, extent: drawn ? extent.finish() : null };
}

/// Un tratto appena disegnato e la forma che prende il suo posto, nelle
/// coordinate del suo livello.
export interface HeldShape {
  readonly unit: Unit;
  readonly shape: Recognized;
}

/// Le operazioni che mettono la forma `shape` al posto del tratto `unit`
/// appena disegnato, nelle coordinate del suo livello, e quelle di `copies`
/// al posto delle sue copie in simmetria. `null` se la forma non si
/// disegna; una copia la cui forma non si disegna resta inchiostro, e
/// `refused` la conta.
export function heldShapeOps(model: DocumentModel, unit: Unit, shape: Recognized, ids: NewIds, copies: readonly HeldShape[] = []): (InkShaped & { readonly elem: Elem }) | null {
  const plan = new Plan(model, ids);
  const elem = strokeShapeElem(unit.node, shape, IDENTITY);
  if (elem === null || !replaceElem(plan, unit.node, elem)) return null;
  const extent = new BoundsBuilder();
  let drawn = false;
  const include = (bounds: Bounds | null): void => {
    if (bounds === null) return;
    extent.include(bounds.min);
    extent.include(bounds.max);
    drawn = true;
  };
  include(placedBounds(elem, unit.parent));
  let changed = 1;
  let refused = 0;
  for (const copy of copies) {
    const copied = strokeShapeElem(copy.unit.node, copy.shape, IDENTITY);
    if (copied === null || !replaceElem(plan, copy.unit.node, copied)) {
      refused++;
      continue;
    }
    changed++;
    include(placedBounds(copied, copy.unit.parent));
  }
  return { ...plan.finish([unit.key]), changed, refused, extent: drawn ? extent.finish() : null, elem };
}
