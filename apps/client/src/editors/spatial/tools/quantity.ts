// I numeri dei campi del disegno. Come si legge ciò che si scrive sta nel kit
// (`kit/quantity.ts`), perché lo usa anche il campo numerico del kit; qui ci
// sono le unità che sanno del documento.

import { UNIT_SIZE, UNITS, type LengthUnit } from "../scene/rulers";

export * from "../../../kit/quantity";

/// Le unità di una lunghezza mostrata in `unit`: le cinque del documento.
export function lengthUnits(unit: LengthUnit): Readonly<Record<string, number>> {
  return Object.fromEntries(UNITS.map((other) => [other, UNIT_SIZE[other] / UNIT_SIZE[unit]]));
}
