// Che cosa sceglie la finestra «Esporta», senza il DOM: lo stato delle sue
// scelte, da dove parte, i file che ne escono e la richiesta per l'host.
//
// - **Che cosa:** il disegno intero, la selezione (gli oggetti scelti, per
//   id, ritagliati sul riquadro che li contiene) o le tavole, ognuna con la
//   sua casella.
// - **Il formato:** PNG, JPEG, SVG o PDF. Il JPEG non ha la trasparenza: il
//   suo sfondo è sempre la carta, e sotto c'è il bianco.
// - **La misura** di PNG e JPEG: una scala, da 1× a 4×, o una larghezza in
//   pixel.
// - **Lo sfondo:** le carte del disegno, o niente.
//
// Le scelte si ricordano per disegno (`preferences.ts`): la selezione come
// scelta sì, i suoi oggetti no; delle tavole si ricordano quelle tolte, così
// una tavola nuova parte scelta e una che non c'è più si dimentica.

import { SIDE_MAX, type ExportBackground, type ExportBox, type ExportScope, type ExportSize } from "../scene/export";

export type ExportWhat = "drawing" | "selection" | "boards";

export type ExportFormat = "png" | "jpeg" | "svg" | "pdf";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["png", "jpeg", "svg", "pdf"];

/// Le scale che la finestra offre.
export const EXPORT_SCALES: readonly number[] = [1, 2, 3, 4];

/// I formati raster, quelli che hanno una misura in pixel.
export function isRaster(format: ExportFormat): boolean {
  return format === "png" || format === "jpeg";
}

/// Gli oggetti scelti nel disegno.
export interface ExportSelection {
  /// Quanti sono.
  readonly count: number;
  /// I loro id, in ordine di documento; quelli senza id non ci sono.
  readonly ids: readonly string[];
  /// Il riquadro che li contiene, contorno compreso, sui numeri interi
  /// verso fuori; `null` se nessuno disegna niente.
  readonly box: ExportBox | null;
}

export interface ExportBoard {
  readonly id: string;
  /// Il nome che l'elenco «Tavole» mostra.
  readonly name: string;
}

/// Ciò che la finestra chiede al disegno.
export interface ExportScene {
  /// `null` se niente è scelto.
  readonly selection: ExportSelection | null;
  /// Nell'ordine del documento.
  readonly boards: readonly ExportBoard[];
}

/// Le scelte della finestra.
export interface ExportState {
  readonly what: ExportWhat;
  /// Le tavole tolte, per id.
  readonly off: ReadonlySet<string>;
  readonly format: ExportFormat;
  readonly size: ExportSize;
  readonly background: ExportBackground;
}

/// Ciò che si ricorda di un disegno: le scelte, con le tavole tolte in un
/// elenco.
export interface ExportMemory {
  readonly what: ExportWhat;
  readonly off: readonly string[];
  readonly format: ExportFormat;
  readonly size: ExportSize;
  readonly background: ExportBackground;
}

/// Perché la selezione non si esporta: un oggetto senza id, che la
/// richiesta non sa nominare, o niente che disegni.
export type SelectionTrouble = "unnamed" | "empty";

/// Che cosa impedisce di esportare la selezione; `null` se si può.
export function selectionTrouble(selection: ExportSelection): SelectionTrouble | null {
  if (selection.ids.length < selection.count) return "unnamed";
  return selection.box === null ? "empty" : null;
}

/// Vero se `what` si può scegliere nel disegno `scene`.
export function offered(scene: ExportScene, what: ExportWhat): boolean {
  if (what === "selection") return scene.selection !== null && selectionTrouble(scene.selection) === null;
  if (what === "boards") return scene.boards.length > 0;
  return true;
}

/// Lo stato di partenza: le scelte ricordate, dove valgono ancora. Senza
/// memoria, le tavole se il disegno ne ha, il PNG a 2×, con la carta.
export function initialState(scene: ExportScene, memory: ExportMemory | null): ExportState {
  const boards = new Set(scene.boards.map((board) => board.id));
  const off = new Set((memory?.off ?? []).filter((id) => boards.has(id)));
  // Tutte tolte non è una scelta che si può esportare: ripartono tutte.
  if (off.size === boards.size) off.clear();
  const fallback: ExportWhat = scene.boards.length > 0 ? "boards" : "drawing";
  const what = memory !== null && offered(scene, memory.what) ? memory.what : fallback;
  return {
    what,
    off,
    format: memory?.format ?? "png",
    size: memory?.size ?? { scale: 2 },
    background: memory?.background ?? "paper",
  };
}

/// Ciò che si ricorda di `state`.
export function memoryOf(state: ExportState): ExportMemory {
  return { what: state.what, off: [...state.off], format: state.format, size: state.size, background: state.background };
}

/// Lo sfondo che esce davvero: il JPEG ha sempre la carta.
export function backgroundOf(state: ExportState): ExportBackground {
  return state.format === "jpeg" ? "paper" : state.background;
}

/// Le tavole che escono, nell'ordine del documento.
export function chosenBoards(state: ExportState, scene: ExportScene): readonly ExportBoard[] {
  return scene.boards.filter((board) => !state.off.has(board.id));
}

/// Un pezzo di ciò che esce: un file, o una pagina del PDF delle tavole.
export interface ExportPiece {
  readonly scope: ExportScope;
  /// Il nome della tavola; `null` per il disegno e la selezione.
  readonly board: string | null;
}

/// I pezzi che escono con `state`, nell'ordine in cui l'host li scrive.
export function exportPieces(state: ExportState, scene: ExportScene): readonly ExportPiece[] {
  if (state.what === "selection" && scene.selection !== null && scene.selection.box !== null) {
    return [{ scope: { kind: "selection", ids: scene.selection.ids, box: scene.selection.box }, board: null }];
  }
  if (state.what === "boards") {
    return chosenBoards(state, scene).map((board) => ({ scope: { kind: "board", id: board.id }, board: board.name }));
  }
  return [{ scope: { kind: "drawing" }, board: null }];
}

/// La richiesta per l'host: il bersaglio del bundle `fub.draw` e le sue
/// opzioni. `suffix` è la parola fra parentesi nel nome del file della
/// selezione, nella lingua di chi esporta.
export function exportRequest(state: ExportState, scene: ExportScene, suffix: string): { readonly target: string; readonly options: Record<string, unknown> } {
  const options: Record<string, unknown> = { background: backgroundOf(state) };
  const pieces = exportPieces(state, scene);
  const first = pieces[0]!.scope;
  if (first.kind === "selection") {
    options.scope = "selection";
    options.selection = { ids: [...first.ids], box: [...first.box] };
    options.suffix = suffix;
  } else if (first.kind === "board") {
    options.scope = "boards";
    options.boards = pieces.map((piece) => (piece.scope as { readonly id: string }).id);
  } else {
    options.scope = "drawing";
  }
  if (isRaster(state.format)) {
    if ("pixels" in state.size) options.width = state.size.pixels;
    else options.scale = state.size.scale;
  }
  return { target: `draw.${state.format}`, options };
}

/// Vero se `state` si può esportare: almeno una tavola, una larghezza
/// intera nei limiti.
export function ready(state: ExportState, scene: ExportScene): boolean {
  if (!offered(scene, state.what)) return false;
  if (state.what === "boards" && chosenBoards(state, scene).length === 0) return false;
  return !("pixels" in state.size) || validPixels(state.size.pixels);
}

/// Una larghezza in pixel che la finestra accetta.
export function validPixels(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= SIDE_MAX;
}

/// `value` come scelte ricordate, se lo è.
export function exportMemoryOf(value: unknown): ExportMemory | null {
  if (typeof value !== "object" || value === null) return null;
  const { what, off, format, size, background } = value as Record<string, unknown>;
  if (what !== "drawing" && what !== "selection" && what !== "boards") return null;
  if (!Array.isArray(off) || !off.every((id) => typeof id === "string")) return null;
  if (!EXPORT_FORMATS.includes(format as ExportFormat)) return null;
  if (background !== "paper" && background !== "none") return null;
  const sized = sizeOf(size);
  if (sized === null) return null;
  return { what, off: off as string[], format: format as ExportFormat, size: sized, background };
}

function sizeOf(value: unknown): ExportSize | null {
  if (typeof value !== "object" || value === null) return null;
  const { scale, pixels } = value as Record<string, unknown>;
  if (typeof scale === "number" && EXPORT_SCALES.includes(scale)) return { scale };
  if (typeof pixels === "number" && validPixels(pixels)) return { pixels };
  return null;
}

/// Il riquadro di export di `min`–`max`: sui numeri interi verso fuori, così
/// i bordi dell'immagine cadono sui pixel della scala intera e niente del
/// contorno resta tagliato, largo e alto almeno un'unità.
export function exportBox(min: readonly [number, number], max: readonly [number, number]): ExportBox {
  const x = Math.floor(min[0]);
  const y = Math.floor(min[1]);
  return [x, y, Math.max(1, Math.ceil(max[0]) - x), Math.max(1, Math.ceil(max[1]) - y)];
}
