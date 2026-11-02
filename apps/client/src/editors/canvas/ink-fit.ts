// Come l'inchiostro di una scheda segue la sua misura (D-9, A17): la regola
// della resa, pura, che un altro programma deve poter rifare uguale. La dice
// `docs/reference/canvas-ink.md` («Come si disegna»), con i vettori scritti a
// mano in `src/__fixtures__/canvas-ink-fit/`.
//
// Su un'immagine o un PDF l'inchiostro scala con la scheda senza deformarsi:
// lo stesso fattore nei due sensi, il minore, centrato nel riquadro (come
// `preserveAspectRatio="xMidYMid meet"`). Su tutte le altre schede resta alla
// misura in cui è stato scritto, fermo nell'angolo in alto a sinistra. Il
// file non cambia mai: è solo resa.
//
// Niente DOM qui: `ink-paint.ts` traduce il modo in attributi SVG.

import { mediaKindOfId } from "../media/media-types";
import type { InkRef } from "./ink-paint";
import type { CanvasNode } from "./model";

/// `scale`: l'inchiostro scala senza deformarsi e si centra; `fixed`: resta
/// alla misura in cui è stato scritto, in alto a sinistra.
export type InkFitMode = "scale" | "fixed";

/// La misura di adesso di una scheda, in unità della lavagna.
export interface InkSize {
  readonly width: number;
  readonly height: number;
}

/// Da unità dell'ancora a unità della scheda di adesso: il punto `(px, py)`
/// va a `(x + s·px, y + s·py)`, e lo spessore si moltiplica per `s`.
export interface InkFit {
  readonly s: number;
  readonly x: number;
  readonly y: number;
}

/// Il tratto che non si vede: misure senza senso non danno mai `NaN`.
const HIDDEN: InkFit = Object.freeze({ s: 0, x: 0, y: 0 });

/// Il modo di una scheda: `scale` per una scheda `file` il cui file è
/// un'immagine o un PDF secondo `mediaKindOfId` (l'estensione, senza
/// distinguere maiuscole; `subpath` non conta), `fixed` per tutte le altre,
/// gruppi compresi. Dipende dal nome del file: rinominarlo cambia il modo, non
/// i tratti.
export function inkFitMode(node: Pick<CanvasNode, "type" | "file">): InkFitMode {
  if (node.type !== "file" || typeof node.file !== "string") return "fixed";
  const kind = mediaKindOfId(node.file);
  return kind === "image" || kind === "pdf" ? "scale" : "fixed";
}

/// Il fattore e lo spostamento che portano un tratto scritto alla misura `ref`
/// sulla scheda di misura `size`.
///
/// - `scale`: `s = min(w / W, h / H)`, `x = (w − W·s) / 2`, `y = (h − H·s) / 2`.
/// - `fixed`: `s = 1`, `x = y = 0`, qualunque sia la misura.
///
/// Non dà mai `NaN`: con `scale`, una misura non finita o negativa, o una
/// misura di riferimento non finita o non positiva, dà `s = 0` in
/// `(0, 0)`, cioè un tratto che non si vede. Una scheda larga o alta zero dà
/// `s = 0` per la formula.
export function inkFit(mode: InkFitMode, ref: InkRef, size: InkSize): InkFit {
  if (mode === "fixed") return { s: 1, x: 0, y: 0 };
  const { width: W, height: H } = ref;
  const { width: w, height: h } = size;
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0)) return HIDDEN;
  if (!(Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0)) return HIDDEN;
  const s = Math.min(w / W, h / H);
  return { s, x: (w - W * s) / 2, y: (h - H * s) / 2 };
}

/// Un punto in unità dell'ancora portato nella scheda di adesso.
export function fitPoint(fit: InkFit, px: number, py: number): readonly [number, number] {
  return [fit.x + fit.s * px, fit.y + fit.s * py];
}
