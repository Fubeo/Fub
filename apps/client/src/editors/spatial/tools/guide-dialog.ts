// La finestra «Guide»: le guide del documento coi numeri, per chi non usa
// il puntatore e per chi vuole una posizione esatta. Una riga per guida, con
// la direzione, la posizione nell'unità del documento, il blocco e
// l'eliminazione; sotto, le guide nuove e «Elimina tutte le guide». Si
// scrive tutto insieme, con la conferma, in un passo di annulla solo.

import { type LengthUnit, type RulerGuide } from "../scene/rulers";

/// Quanto lontano dall'origine sta una guida, al più, in unità della scena:
/// oltre, un numero non si scriverebbe più a due decimali.
export const GUIDE_LIMIT = 1_000_000;

export interface GuideDialogOptions {
  /// Le guide del documento; `null` se quelle scritte non si leggono, e
  /// allora la finestra parte vuota e lo dice.
  readonly guides: readonly RulerGuide[] | null;
  readonly unit: LengthUnit;
  /// Dove va una guida nuova, nella scena: il centro di ciò che si vede.
  readonly center: readonly [number, number];
  /// La guida su cui parte il fuoco; senza, la prima.
  readonly focus?: number | null;
}

/// La sigla dell'unità, accanto al nome di un campo: niente per i pixel,
/// che sono le unità della scena.
export function unitSuffix(label: string, unit: LengthUnit): string {
  return unit === "px" ? label : `${label} (${unit})`;
}
