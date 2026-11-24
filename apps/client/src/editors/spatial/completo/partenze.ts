// Le finestre che partono da com'è il disegno (K6, Pittura dinamica): prima di aprirsi leggono
// dal motore e mettono nei campi ciò che l'oggetto scelto ha già, come VectorCraft. Una lettura
// che non risponde lascia i valori di serie: la finestra si apre lo stesso.

import type { ValoreCampo } from "../motore/finestre";

/// La lettura che dà i valori di partenza di una finestra, e i campi che ne escono.
export interface PartenzaLetta {
  /// Il comando del motore che legge (sulla selezione).
  readonly lettura: string;
  /// I campi della finestra dalla lettura; quelli che non ci sono restano di serie.
  readonly campi: (lettura: unknown) => Readonly<Record<string, ValoreCampo>>;
}

/// Le Opzioni spazi vuoti del gruppo scelto (`livePaint.info` → `gapOptions`): rileva, misura
/// (una delle tre, o «personalizzata» coi suoi punti) e colore. «Chiudi gli spazi con tracciati»
/// è un'azione, non un'opzione del gruppo: parte sempre spenta.
function opzioniDegliSpazi(lettura: unknown): Readonly<Record<string, ValoreCampo>> {
  const opzioni = (lettura as { readonly gapOptions?: unknown } | null)?.gapOptions;
  if (typeof opzioni !== "object" || opzioni === null) return { closeGaps: false };
  const { detect, size, points, color } = opzioni as Record<string, unknown>;
  const campi: Record<string, ValoreCampo> = { closeGaps: false };
  if (typeof detect === "boolean") campi["detect"] = detect;
  if (typeof size === "string") campi["size"] = size;
  else if (typeof size === "number") campi["size"] = "custom";
  if (typeof points === "number") campi["points"] = points;
  if (typeof color === "string") campi["color"] = color;
  return campi;
}

/// Le finestre che partono dal disegno, per id del comando.
export const PARTENZE_LETTE: Readonly<Record<string, PartenzaLetta>> = {
  "livePaint.gapOptions": { lettura: "livePaint.info", campi: opzioniDegliSpazi },
};
