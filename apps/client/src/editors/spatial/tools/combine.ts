// Le operazioni booleane (livello Esperto) sugli oggetti scelti: unione,
// differenza, intersezione, esclusione e divisione, come nel menu Tracciato
// di Inkscape. Il comando diventa un `batch` solo.
//
// - **Gli operandi sono forme**: tracciati, rettangoli, ellissi, cerchi,
//   linee, spezzate, poligoni, frecce e tratti, con l'area che riempiono.
//   Un gruppo, un collegamento, un testo o un'immagine fermano il comando,
//   che lo dice.
// - **La forma più in basso resta lei.** Diventa il tracciato del
//   risultato, come in «Oggetto in tracciato»: stesso id, stesso posto,
//   stessi colori, stessa trasformazione e stessi figli. Le altre forme se
//   ne vanno. Il risultato si scrive nelle sue coordinate, dove le altre
//   arrivano con le loro trasformazioni.
// - **La divisione** taglia la forma più in basso lungo i contorni delle
//   altre. Il primo pezzo prende il suo posto; gli altri le stanno sopra,
//   con id nuovi e i suoi attributi.
// - **Un risultato vuoto non cambia niente**, e nemmeno una divisione che
//   non divide: le forme restano, e il comando lo dice.

import { parsePath } from "../scene/geometry";
import { compose, invert, type Matrix } from "../scene/matrix";
import type { DocumentModel } from "../scene/model";
import { pathData } from "../scene/serialize";
import { nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { combine, mapped, type BooleanKind, type Shape } from "./boolean";
import type { NewIds } from "./edit";
import { shapeSegments, type Unit } from "./hit";
import { GEOMETRY, replaceWithPath, syntheticNulls } from "./topath";

/// I ruoli delle forme su cui le operazioni lavorano.
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "arrow", "ngon", "star", "stroke"]);

/// Un'operazione booleana pronta: le operazioni, e quanti tracciati ne
/// escono.
export interface Combined extends Arranged {
  readonly pieces: number;
}

/// Perché un'operazione non si fa:
/// - `few`, meno di due forme, o nessuna per l'unione;
/// - `not_shapes`, `count` oggetti scelti che non sono forme;
/// - `empty`, il risultato sarebbe vuoto;
/// - `whole`, la divisione lascerebbe la forma intera;
/// - `foreign`, la forma più in basso ha parti che un'operazione non sa
///   riscrivere;
/// - `failed`, la geometria non si risolve.
export type Refused =
  | { readonly reason: "few" | "empty" | "whole" | "foreign" | "failed" }
  | { readonly reason: "not_shapes"; readonly count: number };

/// Vero se `unit` è una forma per le operazioni booleane.
export const isShape = (unit: Unit): boolean => SHAPES.has(unit.role);

const sameMatrix = (a: Matrix, b: Matrix): boolean => a.every((v, i) => v === b[i]);

/// Le operazioni di `kind` su `units`, in ordine di documento: la prima è la
/// forma più in basso. Dopo è scelto il risultato, o i pezzi della divisione.
export function combineOps(model: DocumentModel, units: readonly Unit[], kind: BooleanKind, ids: NewIds): Combined | Refused {
  const others = units.filter((unit) => !isShape(unit)).length;
  if (others > 0) return { reason: "not_shapes", count: others };
  if (units.length < (kind === "union" ? 1 : 2)) return { reason: "few" };
  const bottom = units[0]!;
  const into = invert(bottom.matrix);
  if (into === null) return { reason: "failed" };
  const nodes = units.map((unit) => nodeOf(model, unit));
  const shapes = units.map((unit, at): Shape => {
    const segments = shapeSegments(nodes[at]!.details!.tag, [...plainAttributes(nodes[at]!)]);
    // Il formato della scena non ha `fill-rule`: ogni forma si riempie con
    // nonzero, come la dipinge il painter.
    if (sameMatrix(unit.matrix, bottom.matrix)) return { segments, evenOdd: false, written: true };
    return { segments: mapped(segments, compose(into, unit.matrix)), evenOdd: false, written: false };
  });
  const result = combine(kind, shapes);
  if (result === null) return { reason: "failed" };
  if (result.length === 0) return { reason: "empty" };
  if (kind === "division" && result.length === 1) return { reason: "whole" };
  const written = result.map(pathData);
  // Il `d` scritto si rilegge: uno che no, con numeri fuori dal formato, non
  // si scrive.
  if (written.some((d) => parsePath(d) === null)) return { reason: "failed" };

  const plan = new Plan(model, ids);
  const node = nodes[0]!;
  const tag = node.details!.tag;
  const id = plan.idOf(node);
  if (tag === "path") {
    // Un tracciato che resta com'era non si riscrive.
    const attrs: Record<string, string | null> = syntheticNulls(node);
    if (plainAttributes(node).get("d") !== written[0]) attrs.d = written[0]!;
    if (Object.keys(attrs).length > 0) plan.ops.push({ op: "set", id, attrs });
  } else if (!replaceWithPath(plan, node, written[0]!)) {
    return { reason: "foreign" };
  }
  // Gli altri pezzi della divisione, ciascuno sopra il precedente, con gli
  // attributi della forma più in basso, senza la sua geometria: l'id e il
  // `d` sono i loro.
  const keys = [id];
  const skipped = new Set(GEOMETRY[tag] ?? []);
  const look: Record<string, string> = {};
  for (const [name, value] of plainAttributes(node)) if (!skipped.has(name)) look[name] = value;
  for (const d of written.slice(1)) {
    const piece = plan.ids.next("object");
    plan.ops.push({ op: "add", parent: plan.parentOf(node), pos: { after: keys[keys.length - 1]! }, elem: { tag: "path", attrs: { ...look, id: piece, d } } });
    keys.push(piece);
  }
  for (const other of nodes.slice(1)) plan.ops.push({ op: "remove", target: plan.idOf(other) });
  return { ...plan.finish(keys), pieces: written.length };
}
