// Dai campioni al tratto: le due cose che ogni strumento che scrive deve fare
// con gli stessi risultati, per qualunque prodotto.
//
// - `previewOutline`: il contorno del tratto **in corso**. È la definizione:
//   rifà tutto il contorno e non lancia. `StrokePreview` dà lo stesso contorno
//   rifacendo a ogni chiamata soltanto la coda, ed è ciò che un prodotto usa
//   mentre il tratto cresce; i test lo confrontano con `previewOutline`.
// - `buildStroke`: il tratto **finito**, pronto da scrivere: inchiostro
//   quantizzato, contorno e le copie portate da altre trasformazioni (la
//   simmetria). È ciò che il prodotto mette nel suo formato e nel suo annulla.
//
// Non sanno dove finirà il tratto, quale livello lo riceve né come si
// annulla; lo sa il prodotto.

import type { Pf1Brush } from "../brush";
import { mappedSamples, straight, type Affine } from "../geometry";
import { pf1Input, pf1Outline, type OutlinePoint } from "../pf1";
import { Pf1Live, type Pf1Input } from "../pf1-live";
import {
  checkInkStep,
  DEFAULT_INK_SCALE,
  INK_MAX_SAMPLES,
  quantizeInk,
  quantizeInkSample,
  type InkSample,
  type QuantizedInk,
  type QuantizedSample,
} from "../sample";

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

/// L'anteprima di un tratto in corso col pennello `brush`: per gli stessi
/// argomenti, `outline` dà ciò che dà `previewOutline`. Quantizza ogni campione
/// una volta sola e congela il contorno che nessun campione futuro cambia
/// (`Pf1Live`), così una chiamata costa la coda e non il tratto.
///
/// `local` può soltanto crescere in coda da una chiamata all'altra, come i
/// campioni di un tratto. Se si accorcia, o se cambia l'ultimo campione già
/// letto, l'anteprima ricomincia da capo; i campioni più indietro non si
/// ricontrollano, e chi ne cambia uno usa un'anteprima nuova. Il contorno dato
/// resta valido fino alla chiamata dopo, che può riscriverlo.
export class StrokePreview {
  private live: Pf1Live | null = null;
  /// I campioni di `local` già letti, e l'ultimo di loro.
  private fed = 0;
  private seen: InkSample | null = null;
  private first: InkSample | null = null;
  private previous: QuantizedSample | null = null;
  /// Un campione letto non si scrive, o il pennello non vale: il contorno è
  /// vuoto finché il tratto non ricomincia.
  private failed = false;

  constructor(private readonly brush: Pf1Brush) {}

  outline(local: readonly InkSample[], predicted: readonly InkSample[], straightened: boolean): OutlinePoint[] {
    if (straightened || local.length === 0 || local.length > INK_MAX_SAMPLES) {
      return previewOutline(local, predicted, this.brush, straightened);
    }
    if (local.length < this.fed || (this.fed > 0 && local[this.fed - 1] !== this.seen)) this.restart();
    for (; this.fed < local.length; this.fed++) {
      const sample = local[this.fed]!;
      this.seen = sample;
      if (this.failed) continue;
      const input = this.quantized(sample, this.fed);
      if (input === null) this.failed = true;
      else this.live!.push(input);
    }
    if (this.failed) return [];
    if (local.length + predicted.length > INK_MAX_SAMPLES) return this.live!.outline([]);
    const tail: Pf1Input[] = [];
    let previous = this.previous;
    try {
      for (let k = 0; k < predicted.length; k++) {
        const quantized = quantizeInkSample(predicted[k]!, local.length + k, this.first!, DEFAULT_INK_SCALE);
        checkInkStep(quantized, previous!, local.length + k);
        tail.push(pf1Input(quantized, DEFAULT_INK_SCALE));
        previous = quantized;
      }
    } catch {
      return [];
    }
    return this.live!.outline(tail);
  }

  private restart(): void {
    this.live = null;
    this.fed = 0;
    this.seen = null;
    this.first = null;
    this.previous = null;
    this.failed = false;
  }

  /// Il campione `i` di `local` nel formato di `getStroke`, `null` se il tratto
  /// non si scriverebbe.
  private quantized(sample: InkSample, i: number): Pf1Input | null {
    try {
      if (i === 0) {
        if (sample.t !== 0) return null;
        this.first = sample;
        this.live = new Pf1Live(this.brush);
      }
      const quantized = quantizeInkSample(sample, i, this.first!, DEFAULT_INK_SCALE);
      if (this.previous !== null) checkInkStep(quantized, this.previous, i);
      this.previous = quantized;
      return pf1Input(quantized, DEFAULT_INK_SCALE);
    } catch {
      return null;
    }
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
