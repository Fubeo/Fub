// Come l'inchiostro di una scheda segue la sua misura (D-9, A17): la regola
// della resa, pura, che un altro programma deve poter rifare uguale. La dice
// `docs/reference/canvas-ink.md` («Come si disegna»), con i vettori scritti a
// mano in `src/__fixtures__/canvas-ink-fit/`.
//
// Su un'immagine o un PDF l'inchiostro scala con la scheda senza deformarsi:
// lo stesso fattore nei due sensi, il minore, centrato nel riquadro (come
// `preserveAspectRatio="xMidYMid meet"`). Se si sa la proporzione del
// contenuto (`aspect`, T39: l'immagine o la pagina mostrata), l'inchiostro
// segue il contenuto: il riquadro del contenuto nella scheda di allora va sul
// riquadro del contenuto nella scheda di adesso, e il contenuto sta sempre
// intero nella scheda, al centro (`contentBox`). Su tutte le altre schede
// resta alla misura in cui è stato scritto, fermo nell'angolo in alto a
// sinistra. Il file non cambia mai: è solo resa.
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

/// Un rettangolo in unità della scheda, dall'angolo in alto a sinistra.
export interface InkBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// Una proporzione del contenuto che vale: un numero finito maggiore di zero.
export function validAspect(aspect: number | null | undefined): aspect is number {
  return typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0;
}

/// Il riquadro del contenuto di proporzione `aspect` (larghezza su altezza)
/// in una scheda di misura `size`: il più grande che ci sta intero, al centro
/// (come `object-fit: contain`).
///
/// `width = min(w, h·aspect)`, `height = width / aspect`,
/// `x = (w − width) / 2`, `y = (h − height) / 2`. `null` se `aspect` non è un
/// numero finito maggiore di zero, o se la misura non è finita o è negativa.
export function contentBox(size: InkSize, aspect: number): InkBox | null {
  const { width: w, height: h } = size;
  if (!validAspect(aspect)) return null;
  if (!(Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0)) return null;
  const width = Math.min(w, h * aspect);
  const height = width / aspect;
  if (!(Number.isFinite(width) && Number.isFinite(height))) return null;
  return { x: (w - width) / 2, y: (h - height) / 2, width, height };
}

/// Il fattore e lo spostamento che portano un tratto scritto alla misura `ref`
/// sulla scheda di misura `size`.
///
/// - `scale`: `s = min(w / W, h / H)`, `x = (w − W·s) / 2`, `y = (h − H·s) / 2`.
/// - `scale` con `aspect` (T39), la proporzione del contenuto di adesso: il
///   riquadro del contenuto in `ref` (`C = contentBox(ref, aspect)`) va sul
///   riquadro del contenuto in `size` (`D = contentBox(size, aspect)`):
///   `s = D.width / C.width`, `x = D.x − s·C.x`, `y = D.y − s·C.y`. Con
///   `aspect = W / H` è la regola senza `aspect`. Un `aspect` assente, `null`,
///   non finito o non positivo dà la regola senza `aspect`.
/// - `fixed`: `s = 1`, `x = y = 0`, qualunque siano la misura e `aspect`.
///
/// Non dà mai `NaN`: con `scale`, una misura non finita o negativa, o una
/// misura di riferimento non finita o non positiva, dà `s = 0` in
/// `(0, 0)`, cioè un tratto che non si vede. Una scheda larga o alta zero dà
/// `s = 0` per la formula.
export function inkFit(mode: InkFitMode, ref: InkRef, size: InkSize, aspect?: number | null): InkFit {
  if (mode === "fixed") return { s: 1, x: 0, y: 0 };
  const { width: W, height: H } = ref;
  const { width: w, height: h } = size;
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0)) return HIDDEN;
  if (!(Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0)) return HIDDEN;
  if (validAspect(aspect)) {
    const from = contentBox(ref, aspect);
    const to = contentBox(size, aspect);
    if (!from || !to || !(from.width > 0)) return HIDDEN;
    const s = to.width / from.width;
    return Number.isFinite(s) ? { s, x: to.x - s * from.x, y: to.y - s * from.y } : HIDDEN;
  }
  const s = Math.min(w / W, h / H);
  return { s, x: (w - W * s) / 2, y: (h - H * s) / 2 };
}

/// Un punto in unità dell'ancora portato nella scheda di adesso.
export function fitPoint(fit: InkFit, px: number, py: number): readonly [number, number] {
  return [fit.x + fit.s * px, fit.y + fit.s * py];
}
