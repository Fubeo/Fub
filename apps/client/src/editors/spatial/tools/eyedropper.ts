// Il contagocce (livello Standard): che cosa vede e che cosa prende nel
// punto della scena sotto il puntatore. Senza DOM: i pixel di un'immagine li
// legge l'editor, e questo modulo dice quale.
//
// - **Dove guarda.** L'oggetto più in alto che si vede nel punto, anche in
//   un livello bloccato, che si legge senza cambiare; dentro un gruppo la
//   forma sotto il puntatore, non la prima del gruppo. Un punto dentro una
//   forma vince su uno vicino al bordo di un'altra più in alto: la
//   tolleranza del puntatore vale soltanto dove non si tocca niente. Un
//   blocco estraneo, ciò che FubDraw mostra ma non modifica, si vede ma non
//   si legge: copre ciò che sta sotto, e il contagocce lo dice.
// - **Che cosa prende.** Col clic l'aspetto, come «Incolla stile» (`look.ts`)
//   ma della forma sotto il puntatore: il riempimento, il contorno col suo
//   spessore, il tratteggio, gli estremi e gli angoli, l'opacità
//   dell'oggetto e il carattere. Con Maiusc il solo colore che si vede nel
//   punto, il contorno dove sta sopra il riempimento: di una sfumatura il
//   colore in quel punto, di un campione del documento il campione, di un
//   motivo il motivo, che un colore solo non ce l'ha. Di un'immagine il
//   colore del pixel, sempre; uno trasparente non dà niente.

import type { Bounds } from "../scene/geometry";
import { apply, invert, type Point } from "../scene/matrix";
import type { DocumentModel } from "../scene/model";
import { paintReference, trim, viewBoxMatrix } from "../scene/values";
import { elemOf } from "./arrange";
import { geometryBox, type ForeignBlock, type Sampled, type Unit } from "./hit";
import { styleOf, type Style } from "./look";
import { customColor } from "./palette";
import { gradientColor, gradientOf, paintCode, resourcesOf } from "./resources";
import { traceSource, type TraceSource } from "./trace-ops";

/// Ciò che il contagocce vede in un punto della scena.
export type Sight =
  /// Una forma che si legge: l'oggetto e ciò che di lui si vede nel punto.
  | { readonly kind: "shape"; readonly unit: Unit; readonly sampled: Sampled }
  /// Un'immagine: l'oggetto, ciò che di lui si vede, l'immagine e il punto
  /// nelle sue coordinate.
  | { readonly kind: "image"; readonly unit: Unit; readonly sampled: Sampled; readonly source: TraceSource; readonly local: Point }
  /// Qualcosa che si vede ma non si legge: un blocco estraneo.
  | { readonly kind: "foreign" };

export type ShapeSight = Extract<Sight, { readonly kind: "shape" }>;
export type ImageSight = Extract<Sight, { readonly kind: "image" }>;

const FOREIGN: Sight = { kind: "foreign" };

/// Ciò che si vede nel punto `p` della scena fra gli oggetti `units` e i
/// blocchi estranei `blocks`, ciascuno in ordine di documento: il più in
/// alto che lo copre; altrimenti, il più in alto che ci passa entro
/// `tolerance`. `null` se non si vede niente.
export function sightAt(units: readonly Unit[], blocks: readonly ForeignBlock[], p: Point, tolerance: number): Sight | null {
  for (const reach of tolerance > 0 ? [0, tolerance] : [0]) {
    let block: ForeignBlock | null = null;
    for (let i = blocks.length - 1; i >= 0 && block === null; i--) if (blocks[i]!.covers(p, reach)) block = blocks[i]!;
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!;
      const sampled = unit.sampleAt(p, reach);
      if (sampled === null) continue;
      return block !== null && after(block.path, unit.path) ? FOREIGN : sightOf(unit, sampled, p);
    }
    if (block !== null) return FOREIGN;
  }
  return null;
}

/// Vero se il percorso `a` viene dopo `b` nel documento: sta più in alto.
function after(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return a.length > b.length;
}

function sightOf(unit: Unit, sampled: Sampled, p: Point): Sight {
  const role = sampled.leaf.details?.role;
  if (role === undefined) return FOREIGN;
  if (role !== "image") return { kind: "shape", unit, sampled };
  const source = traceSource(sampled.leaf);
  const back = invert(sampled.matrix);
  if (source === null || back === null) return FOREIGN;
  return { kind: "image", unit, sampled, source, local: apply(back, p) };
}

/// L'aspetto che il clic prende da `sight`: quello della forma sotto il
/// puntatore, con l'opacità dell'oggetto. `null` se non ne ha uno.
export function sightStyle(model: DocumentModel, sight: ShapeSight): Style | null {
  return styleOf(model, sight.unit, sight.sampled.leaf);
}

/// Il colore che si vede nel punto `p` di `sight`, come lo scrive il file:
/// `#rrggbb` minuscolo, o un campione del documento o un motivo come sono
/// scritti, ripiego compreso. Una risorsa che non c'è dà il suo ripiego.
/// `null` se lì non si vede un colore: `none`, o un valore come
/// `currentColor`.
export function paintAt(model: DocumentModel, sight: ShapeSight, p: Point, style: Style | null = sightStyle(model, sight)): string | null {
  if (style === null) return null;
  // Un tratto a penna è tutto riempimento, e il suo colore è quello del
  // contorno.
  const value = sight.sampled.on === "stroke" ? style.stroke : (style.fill ?? style.stroke);
  if (value === null) return null;
  const text = trim(value);
  const used = paintReference(text);
  if (used === null) return customColor(text);
  const fallback = used.fallback === null || used.fallback === "none" ? null : paintCode(used.fallback);
  const node = resourcesOf(model).get(used.id);
  if (node === undefined) return fallback;
  if (node.details?.lifecycle === "swatch" && node.details.swatch !== undefined) return text;
  if (node.facts.local === "pattern") return text;
  const gradient = gradientOf(node);
  if (gradient === null) return fallback;
  const back = invert(sight.sampled.matrix);
  if (back === null) return fallback;
  const color = gradientColor(gradient, apply(back, p), leafBox(sight.sampled));
  return color === null ? null : paintCode(color);
}

/// Il riquadro della geometria della forma `sampled`, nelle sue coordinate:
/// quello su cui si misura una sfumatura nel riquadro di chi la usa.
function leafBox(sampled: Sampled): Bounds | null {
  const elem = elemOf(sampled.leaf);
  return elem === null ? null : geometryBox(elem);
}

/// Il pixel dell'immagine di `sight`, grande `natural` pixel, che si vede
/// nel punto: colonna e riga. Un punto appena fuori dal riquadro, preso con
/// la tolleranza, legge il pixel del bordo. `null` dove il riquadro non
/// mostra l'immagine, ai lati di una che ci sta intera.
export function imagePixel(sight: ImageSight, natural: readonly [number, number]): readonly [number, number] | null {
  const { box, aspect } = sight.source;
  const [width, height] = natural;
  const w = box.max[0] - box.min[0];
  const h = box.max[1] - box.min[1];
  if (!(width > 0 && height > 0 && w > 0 && h > 0)) return null;
  const [sx, , , sy, tx, ty] = viewBoxMatrix([0, 0, width, height], w, h, aspect);
  const x = Math.min(box.max[0], Math.max(box.min[0], sight.local[0])) - box.min[0];
  const y = Math.min(box.max[1], Math.max(box.min[1], sight.local[1])) - box.min[1];
  const column = (x - tx) / sx;
  const row = (y - ty) / sy;
  if (!(column >= 0 && column <= width && row >= 0 && row <= height)) return null;
  return [Math.min(width - 1, Math.floor(column)), Math.min(height - 1, Math.floor(row))];
}

/// Il colore del primo pixel di `data`, RGBA: `#rrggbb` minuscolo, senza
/// l'opacità; `null` se è del tutto trasparente.
export function pixelColor(data: ArrayLike<number>): string | null {
  if (data.length < 4 || data[3] === 0) return null;
  return paintCode([data[0]!, data[1]!, data[2]!]);
}
