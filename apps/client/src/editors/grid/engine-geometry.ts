// Le misure e i gesti della griglia, senza DOM: gli assi delle righe e delle
// colonne, gli intervalli, il riempimento e il rettangolo di un oggetto tirato.
// Le usa `engine.ts`.

import type { GridMerge } from "../../host/contract";
import { GRID_OVERSCAN } from "../core/row-window";
import { fillRange } from "../../tabella/selection";
import type { GridPosition } from "./model";
import { mergeAt, type GridRange } from "./merges";

/// Un rettangolo sullo schermo, nelle coordinate del canvas.
export interface ObjectRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/// Lo spostamento, o la misura, di un oggetto con il puntatore.
export interface ObjectGesture {
  readonly key: string;
  /// La maniglia presa, o `null` per spostare l'oggetto intero.
  readonly handle: string | null;
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  readonly from: ObjectRect;
  to: ObjectRect;
  moved: boolean;
}

/// Il rettangolo `from` con la maniglia `handle` tirata di `dx`×`dy`, o
/// spostato intero se non c'è maniglia. Un lato non passa l'altro, e con
/// `keepRatio` un angolo tiene le proporzioni.
export function gestureRect(from: ObjectRect, handle: string | null, dx: number, dy: number, keepRatio: boolean): ObjectRect {
  if (handle === null) return { ...from, left: from.left + dx, top: from.top + dy };
  let left = from.left;
  let top = from.top;
  let right = from.left + from.width;
  let bottom = from.top + from.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - 1);
  if (handle.includes("e")) right = Math.max(right + dx, left + 1);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + 1);
  if (keepRatio && handle.length === 2 && from.width > 0 && from.height > 0) {
    const ratio = from.width / from.height;
    let width = right - left;
    let height = bottom - top;
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;
    if (handle.includes("w")) left = right - width;
    else right = left + width;
    if (handle.includes("n")) top = bottom - height;
    else bottom = top + height;
  }
  return { left, top, width: right - left, height: bottom - top };
}

export interface AxisLayout {
  readonly offsets: number[];
  readonly sizes: number[];
  readonly total: number;
}

/// Un gesto del puntatore sulle celle. `x` e `y` sono l'ultimo punto, per
/// rifare il gesto quando la griglia scorre sotto un puntatore fermo.
export type CellDrag =
  | { readonly kind: "cells" | "rows" | "columns"; readonly anchor: GridPosition; x: number; y: number }
  | { readonly kind: "fill"; readonly source: GridRange; target: GridRange; x: number; y: number }
  | { readonly kind: "move"; readonly source: GridRange; readonly grab: GridPosition; target: GridRange; x: number; y: number }
  | { readonly kind: "point"; readonly anchor: GridPosition; x: number; y: number }
  /// Una maniglia del tocco lungo tirata: l'angolo opposto (`fixed`) resta.
  | { readonly kind: "handle"; readonly fixed: GridPosition; x: number; y: number };

/// Il riferimento puntato in una formula aperta: dove sta nel testo, che
/// testo c'era dopo averlo scritto, e le celle che dice. Vale finché il testo
/// e il cursore sono quelli.
export interface Pointing {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly anchor: GridPosition;
  readonly focus: GridPosition;
}

/// Un bordo fra due intestazioni preso col puntatore: la colonna (o la riga)
/// `index` che finisce lì, e le linee che si misurano insieme.
export interface ResizeEdge {
  readonly axis: "column" | "row";
  readonly index: number;
}

/// La misura che si tira: `size` all'inizio, `now` adesso, in pixel dello
/// schermo; `from` è dove il puntatore è partito.
export interface ResizeDrag extends ResizeEdge {
  readonly from: number;
  readonly size: number;
  now: number;
}

/// Una misura tirata che il provider non ha ancora confermato (griglia T5):
/// le linee da `first` a `last` del foglio `sheet` sono larghe (o alte)
/// `size`, nell'unità delle misure lette (i pixel della cartella per
/// `WORKBOOK_SCALE`). `ticket` la distingue da un altro gesto sullo stesso
/// bordo.
export interface SizePreview {
  readonly ticket: number;
  readonly sheet: string;
  readonly axis: "column" | "row";
  readonly first: number;
  readonly last: number;
  readonly size: number;
}

/// Le linee `entries` con le misure delle anteprime `previews` di quel
/// verso, nell'ordine: la più nuova vince. Una linea nascosta resta nascosta.
/// Senza anteprime è `entries` stessa.
export function previewSizes<T extends { hidden: boolean; height?: number; width?: number }>(
  entries: readonly T[],
  dimension: "height" | "width",
  previews: readonly SizePreview[],
): readonly T[] {
  if (!previews.length) return entries;
  const out = entries.slice();
  for (const preview of previews) {
    for (let index = preview.first; index <= Math.min(preview.last, out.length - 1); index += 1) {
      out[index] = { ...out[index], [dimension]: preview.size };
    }
  }
  return out;
}

/// Lo spazio fra la guida di un bordo tirato e la sua misura, e fra la misura
/// e il bordo del riquadro (px).
export const RESIZE_LABEL_GAP = 6;

/// Dove comincia la misura di un bordo tirato che sta a `edge` nel riquadro
/// lungo `extent`, larga `size` nel verso del bordo: dopo il bordo, o prima
/// quando dopo non c'è posto; mai fuori dal riquadro.
export function resizeLabelAt(edge: number, size: number, extent: number): number {
  let at = edge + RESIZE_LABEL_GAP;
  if (at + size > extent - RESIZE_LABEL_GAP) at = edge - RESIZE_LABEL_GAP - size;
  return Math.max(RESIZE_LABEL_GAP, Math.min(at, extent - RESIZE_LABEL_GAP - size));
}

/// Quanto vicino al bordo fra due intestazioni il puntatore lo prende.
export const RESIZE_SLOP = 4;
/// Quanto vicino al bordo della selezione il puntatore la prende per
/// spostarla.
export const MOVE_SLOP = 3;

/// I pixel del file in caratteri di Excel, come la sua finestra Larghezza
/// colonne: è l'inverso di `chars_to_points` di GridCraft.
export function pixelsToChars(pixels: number): number {
  if (pixels <= 0) return 0;
  return pixels < 12 ? pixels / 12 : (pixels - 5) / 7;
}

/// Ogni quanto la griglia scorre mentre un gesto esce dal bordo, e di quanto
/// al più per passo.
export const DRAG_SCROLL_MS = 30;
export const DRAG_SCROLL_MAX = 60;

/// Il riempimento che il quadratino porta da `source` verso `position`: la
/// regola della Tabella (`fillRange`); dentro la sorgente resta la sorgente.
export function fillTarget(source: GridRange, position: GridPosition): GridRange {
  const range = fillRange(tableRange(source), position);
  return range ? { rowStart: range.r0, columnStart: range.c0, rowEnd: range.r1, columnEnd: range.c1 } : source;
}

/// Un intervallo della griglia in quello della Tabella.
export function tableRange(range: GridRange): { r0: number; c0: number; r1: number; c1: number } {
  return { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd };
}

export function sameRange(a: GridRange, b: GridRange): boolean {
  return a.rowStart === b.rowStart && a.rowEnd === b.rowEnd && a.columnStart === b.columnStart && a.columnEnd === b.columnEnd;
}

export function axisLayout(
  entries: readonly { hidden: boolean; height?: number; width?: number }[],
  fallback: number,
  dimension: "height" | "width",
  zoom = 1,
): AxisLayout {
  const offsets = new Array<number>(entries.length + 1);
  const sizes = new Array<number>(entries.length);
  offsets[0] = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const declared = entries[index][dimension];
    const size = entries[index].hidden
      ? 0
      : Math.round((typeof declared === "number" && Number.isFinite(declared) && declared > 0 ? declared : fallback) * zoom);
    sizes[index] = size;
    offsets[index + 1] = offsets[index] + size;
  }
  return { offsets, sizes, total: offsets[offsets.length - 1] ?? 0 };
}

export function indexAt(layout: AxisLayout, offset: number): number {
  let low = 0;
  let high = layout.sizes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (layout.offsets[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(layout.sizes.length - 1, low);
}

/// Le righe (o le colonne) da disegnare attorno a ciò che si vede, da
/// `start` per `length` px: un riquadro intero di margine prima e uno dopo.
/// Lo scorrimento veloce arriva prima del disegno, e trova le righe già lì.
/// Mai meno di `GRID_OVERSCAN` righe attorno alla prima: un riquadro non
/// ancora impaginato (misura zero, una scheda appena montata) mostra lo
/// stesso le prime celle.
export function marginWindow(layout: AxisLayout, start: number, length: number) {
  if (!layout.sizes.length) return { start: 0, end: -1 };
  const span = Math.max(0, length);
  const first = indexAt(layout, Math.max(0, start));
  return {
    start: Math.min(indexAt(layout, Math.max(0, start - span)), Math.max(0, first - GRID_OVERSCAN)),
    end: Math.max(indexAt(layout, Math.max(0, start + 2 * span)), Math.min(layout.sizes.length - 1, first + GRID_OVERSCAN)),
  };
}
/// La misura più comune dell'asse, la «di serie» su cui la carta ripete i
/// suoi fili; `fallback` se l'asse è vuoto o tutto nascosto.
export function commonSize(layout: AxisLayout, fallback: number): number {
  const counts = new Map<number, number>();
  let best = fallback;
  let most = 0;
  for (const size of layout.sizes) {
    if (size <= 0) continue;
    const count = (counts.get(size) ?? 0) + 1;
    counts.set(size, count);
    if (count > most) {
      most = count;
      best = size;
    }
  }
  return best;
}
export function viewportRange(
  total: number,
  layout: AxisLayout,
  offset: number,
  extent: number,
  header: number,
  fallback: number,
): { start: number; end: number } | null {
  if (total <= 0) return null;
  const visibleOffset = Math.max(0, offset - header);
  const visibleExtent = Math.max(1, extent);
  const usesLayout = layout.sizes.length === total;
  const first = usesLayout ? indexAt(layout, visibleOffset) : Math.floor(visibleOffset / fallback);
  const last = usesLayout
    ? indexAt(layout, visibleOffset + visibleExtent)
    : Math.floor((visibleOffset + visibleExtent) / fallback);
  return {
    start: Math.max(0, Math.min(total - 1, first - GRID_OVERSCAN)),
    end: Math.max(0, Math.min(total - 1, last + GRID_OVERSCAN)),
  };
}
export function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value));
}

/// Se `range` è esattamente un'unione: una cella sola, per Invio e Tab.
export function mergeCovers(merges: readonly GridMerge[], range: GridRange): boolean {
  const merge = mergeAt(merges, { row: range.rowStart, column: range.columnStart });
  return Boolean(merge)
    && merge!.row === range.rowStart && merge!.column === range.columnStart
    && merge!.row + merge!.rows - 1 === range.rowEnd && merge!.column + merge!.columns - 1 === range.columnEnd;
}

export function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.row === right.row && left.column === right.column;
}

/// Da che parte cresce la cella aperta su un asse: dopo (a destra, in giù) o
/// prima (a sinistra, in su).
export type SpanSide = "after" | "before";

/// I confini che la cella aperta prende su un asse, e se il testo ci sta.
export interface OpenSpan {
  readonly start: number;
  readonly end: number;
  readonly fits: boolean;
}

/// Quanti confini interi la cella aperta prende su un asse (griglia T4): parte
/// dai suoi (`start`, `end`) e cresce, una colonna o una riga intera alla
/// volta, dalle parti di `order`, finché la misura (`edge(end) - edge(start)`,
/// meno il filo) non arriva a `need`. `edge(k)` è il confine `k` sullo
/// schermo, dall'angolo del riquadro. Cresce fin dove il confine si vede:
/// dopo, fino a `high`, saltando i confini nascosti sotto una fascia ferma
/// (sotto `low`); prima, fino a `low`, saltando quelli oltre `high`.
export function openSpan(
  edge: (index: number) => number,
  count: number,
  start: number,
  end: number,
  need: number,
  low: number,
  high: number,
  order: readonly SpanSide[],
): OpenSpan {
  const fits = () => need <= edge(end) - edge(start) - 1;
  if (fits()) return { start, end, fits: true };
  for (const side of order) {
    if (side === "after") {
      for (let index = end + 1; index <= count; index += 1) {
        const at = edge(index);
        if (at < low) continue;
        if (at > high) break;
        end = index;
        if (fits()) return { start, end, fits: true };
      }
    } else {
      for (let index = start - 1; index >= 0; index -= 1) {
        const at = edge(index);
        if (at > high) continue;
        if (at < low) break;
        start = index;
        if (fits()) return { start, end, fits: true };
      }
    }
  }
  return { start, end, fits: false };
}
