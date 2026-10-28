// Il contorno di un tratto per il suo pennello: `pf1` o la punta piatta
// `nib1`. Chi ridisegna un tratto passa da qui e non sceglie l'algoritmo.

import { isNib1, type InkBrush } from "./brush";
import { nib1Outline } from "./nib1";
import { outlinePath, pf1Outline, type OutlinePoint, type Pf1Options } from "./pf1";
import type { QuantizedInk } from "./sample";

/// Il poligono del contorno, non arrotondato.
export function inkOutline(ink: QuantizedInk, brush: InkBrush, options: Pf1Options = {}): OutlinePoint[] {
  return isNib1(brush) ? nib1Outline(ink, brush, options) : pf1Outline(ink, brush, options);
}

/// `d` di un tratto. Lancia `RangeError` come `pf1`.
export function inkPath(ink: QuantizedInk, brush: InkBrush, options: Pf1Options = {}): string {
  return outlinePath(inkOutline(ink, brush, options));
}
