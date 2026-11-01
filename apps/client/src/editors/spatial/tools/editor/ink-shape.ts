// L'editor del disegno: «Rendi forma», i tratti a penna che diventano forme.
// Un pezzo di createDrawEditor (`../editor.ts`): lavora sul contesto che i
// pezzi condividono.

import { plural, t } from "../../strings";
import type { Unit } from "../hit";
import { inkShapeOps, isPenStroke } from "../inkshape";
import type { EditorContext } from "./context";

/// Ciò che «Rendi forma» dà agli altri pezzi dell'editor.
export interface InkShapeContext {
  holdsPenStroke: (unit: Unit) => boolean;
  shapeSelectedInk: () => void;
}

/// Monta «Rendi forma».
export function installInkShape(ctx: EditorContext): void {
  const { currentIndex, newIds, announce, arranging, arrange } = ctx;
  /// Vero se `unit` è un tratto a penna, o ne contiene uno che non è
  /// bloccato.
  function holdsPenStroke(unit: Unit): boolean {
    if (unit.role === "group" || unit.role === "link") return currentIndex().children(unit).some(holdsPenStroke);
    return isPenStroke(unit.node);
  }
  ctx.holdsPenStroke = holdsPenStroke;

  /// «Rendi forma», dal livello Standard: ogni tratto a penna scelto diventa
  /// la forma a cui somiglia, in un passo di annulla. Quelli che non
  /// somigliano a una forma restano inchiostro, e lo si dice.
  function shapeSelectedInk(): void {
    const units = arranging("recognize");
    if (units === null) return;
    const shaped = inkShapeOps(ctx.engine.model!, currentIndex(), units, newIds());
    const refused = shaped.refused === 0 ? "" : ` ${plural(shaped.refused, "draw.shaped.refused.one", "draw.shaped.refused.other")}`;
    if (shaped.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.to_shape", shaped, shaped.extent) !== null) announce(`${plural(shaped.changed, "draw.shaped.one", "draw.shaped.other")}${refused}`);
  }
  ctx.shapeSelectedInk = shapeSelectedInk;
}
