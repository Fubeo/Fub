// La gomma precisa nel disegno: i tratti che il suo cammino attraversa si
// tagliano dove passa il cerchio, e i pezzi restano tratti
// (`ink/tools/split.ts`).
//
// Il cammino è nella scena; ogni tratto lo porta nelle sue coordinate, prima
// del suo `transform`. Il cerchio taglia dove tocca l'inchiostro, non soltanto
// la linea di mezzo: il raggio cresce di metà della misura del pennello. Il
// primo pezzo prende il posto del tratto, col suo id; gli altri gli vanno
// subito sopra, con un id nuovo. Ogni pezzo tiene gli attributi del tratto,
// il suo pennello senza rastremazione ai tagli, e `fub:at` spostato del tempo
// tagliato davanti. Un tratto che non si ridisegna (S004, S010), o i cui pezzi
// non si scrivono, si cancella intero come con l'altra gomma.

import { formatInkBrush, parseInkBrush, type InkBrush } from "../../../ink/brush";
import { inkPath } from "../../../ink/outline";
import { dequantizeSample, quantizeInk, type InkScale, type QuantizedInk } from "../../../ink/sample";
import { cutBrush, splitInk, type InkPiece } from "../../../ink/tools/split";
import { decodeInk, encodeInk, inkFromQuantized, inkToQuantized } from "../ink/codec";
import { apply, invert, type Point } from "../scene/matrix";
import type { DocumentModel } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { elemOf, fubAttributes, nodeOf, Plan, type Arranged } from "./arrange";
import { removeOps, type NewIds } from "./edit";
import type { Unit } from "./hit";
import { replaceElem } from "./topath";

/// Un tratto tagliato: i pezzi che restano, già scritti.
export interface StrokeCut {
  readonly unit: Unit;
  /// I pezzi, ognuno col suo inchiostro e il suo pennello; vuoto se il
  /// cammino lo cancella tutto.
  readonly pieces: readonly CutPiece[];
}

export interface CutPiece {
  readonly ink: QuantizedInk;
  readonly brush: InkBrush;
  /// Di quanti millisecondi comincia dopo il tratto.
  readonly offset: number;
}

/// Vero se `unit` è un tratto che la gomma precisa sa tagliare.
export function cuttable(unit: Unit): boolean {
  return unit.node.details?.role === "stroke" && unit.node.details.stroke?.redrawable === true && unit.paints.length === 1;
}

/// Il taglio del cammino `path` della scena, largo `radius` unità della
/// scena, sul tratto `unit`: `null` se non lo tocca, `"whole"` se il tratto
/// si cancella intero perché non si sa tagliare.
export function cutStroke(unit: Unit, path: readonly Point[], radius: number): StrokeCut | "whole" | null {
  if (!cuttable(unit)) return "whole";
  const matrix = unit.matrix;
  const inverse = invert(matrix);
  if (inverse === null) return "whole";
  try {
    const fub = fubAttributes(unit.node);
    const decoded = inkToQuantized(decodeInk(fub.get("ink") ?? ""));
    const brush = parseInkBrush(fub.get("brush") ?? "");
    const scale = decoded.scale as InkScale;
    const samples = decoded.samples.map((sample) => dequantizeSample(sample, scale));
    // Le unità del tratto per un'unità della scena.
    const k = 1 / Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
    const local = path.map((p) => apply(inverse, p));
    const pieces = splitInk(samples, local, radius * k + brush.size / 2);
    if (pieces === null) return null;
    return { unit, pieces: pieces.map((piece) => written(piece, brush, scale)) };
  } catch {
    return "whole";
  }
}

function written(piece: InkPiece, brush: InkBrush, scale: InkScale): CutPiece {
  return { ink: quantizeInk(piece.samples, scale), brush: cutBrush(brush, piece), offset: piece.offset };
}

/// `d` dei pezzi di `cut`, nelle coordinate del tratto: l'anteprima.
export function cutPath(cut: StrokeCut): string {
  return cut.pieces.map((piece) => inkPath(piece.ink, piece.brush)).filter((d) => d !== "").join(" ");
}

/// `fub:at` spostato di `offset` millisecondi; com'era se non si legge.
function shiftedAt(at: string, offset: number): string {
  const time = Date.parse(at);
  if (Number.isNaN(time) || offset === 0) return at;
  return new Date(time + Math.round(offset)).toISOString();
}

/// L'elemento del pezzo `piece` di un tratto scritto come `elem`.
function pieceElem(elem: Elem, piece: CutPiece): Elem {
  const attrs: Record<string, string> = { ...elem.attrs };
  delete attrs.id;
  delete attrs.d;
  attrs["fub:ink"] = encodeInk(inkFromQuantized(piece.ink));
  attrs["fub:brush"] = formatInkBrush(piece.brush);
  if (attrs["fub:at"] !== undefined) attrs["fub:at"] = shiftedAt(attrs["fub:at"], piece.offset);
  return { ...elem, attrs };
}

/// Le operazioni della gomma precisa: i tratti di `cuts` diventano i loro
/// pezzi, e `whole` si cancellano interi. Un tratto i cui pezzi non si
/// scrivono si cancella intero.
///
/// Prima si tolgono gli oggetti interi, come la gomma di sempre; poi si
/// tagliano i tratti dall'ultimo al primo, così i pezzi aggiunti sopra un
/// tratto non spostano quelli prima. Il percorso di ogni tratto tiene conto
/// dei fratelli tolti davanti a lui.
export function preciseEraseOps(model: DocumentModel, cuts: readonly StrokeCut[], whole: readonly Unit[], ids: NewIds): Arranged & { readonly cut: number } {
  const plan = new Plan(model, ids);
  const gone = [...whole];
  const kept: Array<{ readonly cut: StrokeCut; readonly elem: Elem }> = [];
  for (const each of cuts) {
    const elem = each.pieces.length === 0 ? null : elemOf(nodeOf(model, each.unit));
    if (elem === null) gone.push(each.unit);
    else kept.push({ cut: each, elem });
  }
  kept.sort((a, b) => comparePaths(b.cut.unit.path, a.cut.unit.path));
  const removed = removeOps(gone);
  const shifted = (path: readonly number[]): number[] => {
    const out = [...path];
    for (const unit of gone) {
      const r = unit.path;
      if (r.length > out.length) continue;
      const depth = r.length - 1;
      if (r.slice(0, depth).every((step, i) => step === path[i]) && r[depth]! < path[depth]!) out[depth]! -= 1;
    }
    return out;
  };
  let cut = 0;
  const cutOps: typeof plan.ops = [];
  for (const { cut: each, elem } of kept) {
    const node = nodeOf(model, each.unit);
    const [first, ...rest] = each.pieces.map((piece) => pieceElem(elem, piece));
    const before = plan.ops.length;
    if (!replaceElem(plan, node, first!, shifted(each.unit.path))) {
      // Non si riscrive: si toglie intero, prima degli altri tagli.
      removed.push(...removeOps([each.unit]));
      continue;
    }
    cut++;
    const parent = plan.parentOf(node);
    let after = plan.idOf(node);
    for (const piece of rest) {
      const id = ids.next("object");
      plan.ops.push({ op: "add", parent, pos: { after }, elem: { ...piece, attrs: { ...piece.attrs, id } } });
      after = id;
    }
    cutOps.push(...plan.ops.splice(before));
  }
  plan.ops.push(...removed, ...cutOps);
  return { ...plan.finish([]), cut };
}

/// L'ordine dei percorsi nel documento.
function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
