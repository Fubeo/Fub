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
// - **La pagina** del PDF (`scene/print.ts`): la carta, grande quanto il
//   disegno, un formato col nome o su misura; con una carta col suo formato
//   l'orientamento, i margini e se il disegno si adatta alla pagina;
//   l'abbondanza e i segni di taglio e di registro.
//
// Le scelte si ricordano per disegno (`preferences.ts`): la selezione come
// scelta sì, i suoi oggetti no; delle tavole si ricordano quelle tolte, così
// una tavola nuova parte scelta e una che non c'è più si dimentica.

import { SIDE_MAX, type ExportBackground, type ExportBox, type ExportScope, type ExportSize } from "../scene/export";
import {
  BLEED_MAX_MM,
  hasRoom,
  MARGIN_DEFAULT_MM,
  MARGIN_MAX_MM,
  PAPER_MAX_MM,
  PAPER_MIN_MM,
  PAPERS,
  paperNamed,
  type Orientation,
  type PaperName,
  type PrintFit,
  type PrintSetup,
} from "../scene/print";

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

/// La carta del PDF: grande quanto il disegno, un formato col nome, o su
/// misura.
export type ExportPaper = "fit" | PaperName | "custom";

/// La pagina del PDF come la sceglie la finestra, in millimetri.
export interface ExportPrint {
  readonly paper: ExportPaper;
  /// La carta su misura, larghezza e altezza come le ha scritte chi esporta:
  /// dicono anche come si gira.
  readonly custom: readonly [number, number];
  /// Come si gira un formato col nome.
  readonly orientation: Orientation;
  readonly margin: number;
  readonly fit: PrintFit;
  readonly bleed: number;
  readonly crop: boolean;
  readonly registration: boolean;
}

/// La pagina di sempre: grande quanto il disegno, senza abbondanza né segni.
export const PLAIN_PRINT: ExportPrint = {
  paper: "fit",
  custom: [210, 297],
  orientation: "auto",
  margin: MARGIN_DEFAULT_MM,
  fit: "shrink",
  bleed: 0,
  crop: false,
  registration: false,
};

/// Le carte che la finestra offre, nell'ordine dell'elenco.
export const EXPORT_PAPERS: readonly ExportPaper[] = ["fit", ...PAPERS.map(([name]) => name), "custom"];

/// Le scelte della finestra.
export interface ExportState {
  readonly what: ExportWhat;
  /// Le tavole tolte, per id.
  readonly off: ReadonlySet<string>;
  readonly format: ExportFormat;
  readonly size: ExportSize;
  readonly background: ExportBackground;
  readonly print: ExportPrint;
}

/// Ciò che si ricorda di un disegno: le scelte, con le tavole tolte in un
/// elenco.
export interface ExportMemory {
  readonly what: ExportWhat;
  readonly off: readonly string[];
  readonly format: ExportFormat;
  readonly size: ExportSize;
  readonly background: ExportBackground;
  readonly print: ExportPrint;
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
/// memoria, le tavole se il disegno ne ha, il PNG a 2×, con la carta, e per
/// il PDF la pagina di sempre.
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
    print: memory?.print ?? PLAIN_PRINT,
  };
}

/// Ciò che si ricorda di `state`.
export function memoryOf(state: ExportState): ExportMemory {
  return { what: state.what, off: [...state.off], format: state.format, size: state.size, background: state.background, print: state.print };
}

/// La pagina di stampa di `print`, come la legge l'host: la carta su misura
/// col lato corto prima, girata come è scritta.
export function printSetup(print: ExportPrint): PrintSetup {
  const marks = { crop: print.crop, registration: print.registration };
  const common = { margin: print.margin, fit: print.fit, bleed: print.bleed, marks };
  if (print.paper === "fit") return { ...common, paper: null, orientation: "auto" };
  if (print.paper === "custom") {
    const [width, height] = print.custom;
    return { ...common, paper: [Math.min(width, height), Math.max(width, height)], orientation: width > height ? "landscape" : "portrait" };
  }
  return { ...common, paper: paperNamed(print.paper), orientation: print.orientation };
}

/// Perché la pagina di `print` non si esporta: una misura della carta su
/// misura, il margine o l'abbondanza fuori dai limiti, o una carta su cui non
/// resta posto per il disegno.
export type PrintTrouble = "custom" | "margin" | "bleed" | "room";

/// Che cosa impedisce di esportare la pagina `print`; `null` se si può.
/// Margini e orientamento contano soltanto con una carta col suo formato.
export function printTrouble(print: ExportPrint): PrintTrouble | null {
  const within = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;
  if (!within(print.bleed, 0, BLEED_MAX_MM)) return "bleed";
  if (print.paper === "fit") return null;
  if (print.paper === "custom" && !print.custom.every((side) => within(side, PAPER_MIN_MM, PAPER_MAX_MM))) return "custom";
  if (!within(print.margin, 0, MARGIN_MAX_MM)) return "margin";
  return hasRoom(printSetup(print)) ? null : "room";
}

/// Le opzioni della pagina di stampa per l'host: soltanto quelle che non sono
/// quelle di serie, così la pagina di sempre è la richiesta di prima.
export function printOptions(print: ExportPrint): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const setup = printSetup(print);
  if (setup.paper !== null) {
    options.paper = print.paper === "custom" ? [...print.custom] : print.paper;
    if (setup.orientation !== "auto") options.orientation = setup.orientation;
    if (setup.margin !== MARGIN_DEFAULT_MM) options.margin = setup.margin;
    if (setup.fit !== "shrink") options.fit = setup.fit;
  }
  if (setup.bleed > 0) options.bleed = setup.bleed;
  const marks = [...(print.crop ? ["crop"] : []), ...(print.registration ? ["registration"] : [])];
  if (marks.length > 0) options.marks = marks;
  return options;
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

/// Le parole fra parentesi nei nomi dei file, nella lingua di chi esporta:
/// quella della selezione, e quella dell'SVG del disegno intero, che senza si
/// chiamerebbe come il disegno.
export interface ExportWords {
  readonly selection: string;
  readonly exported: string;
}

/// La richiesta per l'host: il bersaglio del bundle `fub.draw` e le sue
/// opzioni.
export function exportRequest(state: ExportState, scene: ExportScene, words: ExportWords): { readonly target: string; readonly options: Record<string, unknown> } {
  const options: Record<string, unknown> = { background: backgroundOf(state) };
  const pieces = exportPieces(state, scene);
  const first = pieces[0]!.scope;
  if (first.kind === "selection") {
    options.scope = "selection";
    options.selection = { ids: [...first.ids], box: [...first.box] };
    options.suffix = words.selection;
  } else if (first.kind === "board") {
    options.scope = "boards";
    options.boards = pieces.map((piece) => (piece.scope as { readonly id: string }).id);
  } else {
    options.scope = "drawing";
    if (state.format === "svg") options.suffix = words.exported;
  }
  if (isRaster(state.format)) {
    if ("pixels" in state.size) options.width = state.size.pixels;
    else options.scale = state.size.scale;
  }
  if (state.format === "pdf") Object.assign(options, printOptions(state.print));
  return { target: `draw.${state.format}`, options };
}

/// Vero se `state` si può esportare: almeno una tavola, una larghezza
/// intera nei limiti, una pagina del PDF che si stampa.
export function ready(state: ExportState, scene: ExportScene): boolean {
  if (!offered(scene, state.what)) return false;
  if (state.what === "boards" && chosenBoards(state, scene).length === 0) return false;
  if (state.format === "pdf" && printTrouble(state.print) !== null) return false;
  return !isRaster(state.format) || !("pixels" in state.size) || validPixels(state.size.pixels);
}

/// Una larghezza in pixel che la finestra accetta.
export function validPixels(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= SIDE_MAX;
}

/// `value` come scelte ricordate, se lo è. Le scelte ricordate prima che ci
/// fosse la pagina del PDF valgono con la pagina di sempre; una pagina che
/// non si legge vale come quella di sempre, senza perdere il resto.
export function exportMemoryOf(value: unknown): ExportMemory | null {
  if (typeof value !== "object" || value === null) return null;
  const { what, off, format, size, background, print } = value as Record<string, unknown>;
  if (what !== "drawing" && what !== "selection" && what !== "boards") return null;
  if (!Array.isArray(off) || !off.every((id) => typeof id === "string")) return null;
  if (!EXPORT_FORMATS.includes(format as ExportFormat)) return null;
  if (background !== "paper" && background !== "none") return null;
  const sized = sizeOf(size);
  if (sized === null) return null;
  return { what, off: off as string[], format: format as ExportFormat, size: sized, background, print: printOf(print) ?? PLAIN_PRINT };
}

function printOf(value: unknown): ExportPrint | null {
  if (typeof value !== "object" || value === null) return null;
  const { paper, custom, orientation, margin, fit, bleed, crop, registration } = value as Record<string, unknown>;
  if (!EXPORT_PAPERS.includes(paper as ExportPaper)) return null;
  if (!Array.isArray(custom) || custom.length !== 2 || !custom.every((side) => typeof side === "number")) return null;
  if (orientation !== "auto" && orientation !== "portrait" && orientation !== "landscape") return null;
  if (fit !== "shrink" && fit !== "page") return null;
  if (typeof margin !== "number" || typeof bleed !== "number" || typeof crop !== "boolean" || typeof registration !== "boolean") return null;
  const print: ExportPrint = { paper: paper as ExportPaper, custom: [custom[0] as number, custom[1] as number], orientation, margin, fit, bleed, crop, registration };
  return printTrouble(print) === null ? print : null;
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
