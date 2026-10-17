// Dai campioni al tratto: le due cose che ogni strumento che scrive deve fare
// con gli stessi risultati, per qualunque prodotto.
//
// - `previewOutline`: il contorno del tratto **in corso**, a ogni movimento. È
//   il cammino caldo del disegno: gira a ogni evento e non deve allocare più
//   del necessario né lanciare.
// - `buildStroke`: il tratto **finito**, pronto da scrivere: inchiostro
//   quantizzato, contorno e le copie portate da altre trasformazioni (la
//   simmetria). È ciò che il prodotto mette nel suo formato e nel suo annulla.
//
// Sono funzioni pure sui campioni: non sanno dove finirà il tratto, quale
// livello lo riceve né come si annulla; lo sa il prodotto.

import type { Pf1Brush } from "../brush";
import { mappedSamples, straight, type Affine } from "../geometry";
import { pf1Outline, type OutlinePoint } from "../pf1";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample, type QuantizedInk } from "../sample";

/// Il contorno del tratto in corso: i campioni `local`, più quelli
/// `predicted` se ci stanno ancora, o dritto dal primo all'ultimo se
/// `straightened`. Vuoto se non c'è niente da disegnare o i campioni non si
/// scrivono: l'anteprima non lancia mai.
export function previewOutline(
  local: readonly InkSample[],
  predicted: readonly InkSample[],
  brush: Pf1Brush,
  straightened: boolean,
): OutlinePoint[] {
  const samples = straightened
    ? straight(local)
    : local.length + predicted.length <= INK_MAX_SAMPLES
      ? [...local, ...predicted]
      : local;
  if (samples.length === 0) return [];
  try {
    return pf1Outline(quantizeInk(samples), brush, { last: false });
  } catch {
    return [];
  }
}

/// Una copia del tratto portata da una trasformazione.
export interface BuiltCopy {
  readonly matrix: Affine;
  readonly ink: QuantizedInk;
  readonly outline: OutlinePoint[];
}

/// Perché un tratto non si scrive: `failed` se i campioni escono dai numeri
/// dell'inchiostro, `empty` se non fanno nessun contorno.
export type StrokeFailure = "failed" | "empty";

export type BuiltStroke =
  | {
      readonly ok: true;
      readonly ink: QuantizedInk;
      readonly outline: OutlinePoint[];
      /// Le copie che si scrivono, nell'ordine di `matrices`.
      readonly copies: readonly BuiltCopy[];
    }
  | { readonly ok: false; readonly reason: StrokeFailure };

/// Il tratto finito dei campioni `samples` col pennello `brush`, e le sue
/// copie portate da ognuna delle `matrices`. Una copia che uscirebbe dai
/// numeri dell'inchiostro, o che non fa contorno, non c'è: le altre sì.
export function buildStroke(samples: readonly InkSample[], brush: Pf1Brush, matrices: readonly Affine[]): BuiltStroke {
  let ink: QuantizedInk;
  let outline: OutlinePoint[];
  try {
    ink = quantizeInk(samples);
    outline = pf1Outline(ink, brush);
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (outline.length === 0) return { ok: false, reason: "empty" };
  const copies: BuiltCopy[] = [];
  for (const matrix of matrices) {
    try {
      const copyInk = quantizeInk(mappedSamples(samples, matrix));
      const copyOutline = pf1Outline(copyInk, brush);
      if (copyOutline.length > 0) copies.push({ matrix, ink: copyInk, outline: copyOutline });
    } catch {
      continue;
    }
  }
  return { ok: true, ink, outline, copies };
}
