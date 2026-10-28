import type {
  GridApplyRequest,
  GridCommand,
  GridBytesCell,
  GridBytesSession,
  GridBytesWindow,
  GridCellPatch as GridRequestPatch,
  GridCellStyle as GridBytesStyle,
  GridCommandOutcome,
  GridCommandRequest,
  GridCommandState,
  GridCommit,
  GridDialog,
  GridBook,
  GridMerge,
  GridObject,
  GridSelection as GridCommandSelection,
  GridSheetView,
  GridTable,
  GridSurfaceSpec,
  GridWindowRequest,
} from "../../host/contract";
import { GRID_BYTES_PROTOCOL_VERSION } from "../../host/contract";
import { errorText, isErrorKind } from "../../host/errors";
import { operationFromText, type EditorChangeOrigin, type TextOperation } from "../core/text-operation";
import {
  gridJournalEntry,
  gridJournalText,
  parseGridJournal,
  recordGridJournal,
  type GridJournal,
} from "../../state/grid-journal";
import { adapter, type Adapter, type Paper } from "../../theme/adapt";
import type { Theme } from "../../theme/theme";
import type { PdfEngineLoader } from "../media/pdf-view";
import { t, onLanguage, plural, resolvedLanguage, type Key } from "../../i18n/strings";
import { createTabs, textButton, type TabsHandle } from "../../kit";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { createTextEngine, type TextEngine } from "../text/engine";
import { createFormulaProfile, formulaReferences, operandSlot, type FormulaMove } from "../text/profiles/formula";
import { isMultiCell, nextCell, nextInRange, type Move, type Shape } from "../../tabella/navigation";
import { clipboardData, clipboardRows, pasteTargets, type ClipboardCell } from "../../tabella/clipboard";
import { fillRange, touches, withRange } from "../../tabella/selection";
import {
  columnLabel,
  coordinateAt,
  normalizedSelection,
  positionOf,
  type GridPosition,
  type GridSelection,
  type GridSheet,
  type GridWorkbook,
  type GridCell,
} from "./model";
import {
  inverseGridPatches,
  selectionText,
  selectionTsv,
  type GridCellPatch,
} from "./operation";
import {
  cellA1,
  expandToMerges,
  mergeAt,
  mergesIn,
  parseCellA1,
  parseRangeA1,
  rangeA1,
  type GridRange,
} from "./merges";
import { attachCommentCards, commentDescription } from "./comment-card";
import { drawObject, GridMediaCache, objectLabel } from "./objects";
import { hasBorders, horizontalOf, iconOf, paintBorders, paintCell, spills } from "./paint";
import { currencyFormat, shortcutCommand, shortcutDialog } from "./shortcuts";
import {
  cellKey,
  decimalSeparator,
  DEFAULT_SHEET_VIEW,
  keyPosition,
  fileInput,
  localInput,
  objectKey,
  validateBytesSession,
  validateBytesWindow,
  workbookView,
  WORKBOOK_SCALE,
  type WorkbookCell,
  type WorkbookView,
} from "./workbook";

/// Oltre queste celle un intervallo non viaggia nel contesto: rifarne il
/// testo a ogni movimento della selezione costerebbe quanto copiarlo.
const SELECTED_TEXT_CELLS = 10_000;

const DEFAULT_ROW_HEIGHT = 28;
const DEFAULT_COLUMN_WIDTH = 120;
const ROW_HEADER_WIDTH = 52;
const COLUMN_HEADER_HEIGHT = 28;
const EMPTY_SHEET: GridSheet = { id: "", name: "", rows: [], columns: [] };
export const GRID_OVERSCAN = 2;
export const GRID_WINDOW_ROWS = 256;
export const GRID_WINDOW_COLUMNS = 128;
export const MAX_GRID_SESSION_WINDOWS = 256;
/// Le parti di una cartella che la griglia non disegna, per codice d'avviso
/// di `fub-format-xlsx` (`not-shown-…`).
const NOT_SHOWN_KEYS: Readonly<Record<string, Key>> = {
  "not-shown-slicers": "grid.workbook.part.slicers",
};
/// Il comando con cui una formula, o un input, entra in una sessione a comandi.
const SET_VALUES = "range.setValues";
/// Copia o sposta un intervallo della cartella in un passo solo, con
/// formule, formati e unioni (comando composto di `fub-format-xlsx`).
const PASTE_FROM = "fub.pasteFrom";

/// Un intervallo copiato, o tagliato (`move`), dalla cartella.
interface Copied {
  readonly sheet: string;
  readonly range: GridRange;
  readonly text: string;
  readonly move: boolean;
}
/// I comandi del catalogo che soltanto leggono, e che `query` può chiedere.
const QUERIES: ReadonlySet<string> = new Set([
  "formulas.functions",
  "formulas.recentlyUsed",
  "formulas.nameManager",
  "formulas.evaluate",
  "cell.get",
  "home.manageRules",
  // Senza parametri, Imposta pagina rende le impostazioni del foglio e non
  // cambia niente (`query` lo chiede soltanto così).
  "pageLayout.pageSetup",
  // L'anteprima e il PDF senza percorso leggono la cartella com'è adesso.
  "file.printPreview",
  "file.exportPdf",
]);
/// I comandi di `QUERIES` che leggono soltanto senza parametri.
const READ_WITHOUT_PARAMS: ReadonlySet<string> = new Set(["pageLayout.pageSetup"]);
const UNDO = "edit.undo";
const REDO = "edit.redo";
/// Perché una cella non si modifica, per codice di blocco.
const LOCK_KEYS: Readonly<Record<string, Key>> = {
  array: "grid.workbook.lock.array",
  spill: "grid.workbook.lock.spill",
  "shared-formula": "grid.workbook.lock.shared_formula",
  "data-table": "grid.workbook.lock.data_table",
  "table-header": "grid.workbook.lock.table_header",
  "table-totals": "grid.workbook.lock.table_totals",
  merged: "grid.workbook.lock.merged",
  pivot: "grid.workbook.lock.pivot",
  "rich-value": "grid.workbook.lock.rich_value",
  protected: "grid.workbook.lock.protected",
  "sheet-shape": "grid.workbook.lock.sheet_shape",
};
/// Le finestre lette che la griglia tiene, per non rileggerle a ogni
/// scorrimento: poco più di quelle di uno schermo.
const MAX_KEPT_WINDOWS = 16;
const PLAIN_STYLE: GridBytesStyle = {
  bold: false,
  italic: false,
  text_color: null,
  fill_color: null,
  horizontal: null,
  number_format: null,
  font: null,
  font_size: null,
  underline: null,
  strike: false,
  script: null,
  vertical: null,
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  borders: { top: null, right: null, bottom: null, left: null, diagonal_down: null, diagonal_up: null },
};

/// Il foglio con le misure in pixel della griglia: righe e colonne bloccate,
/// intestazioni e zoom.
interface SheetFrame {
  readonly view: GridSheetView;
  readonly zoom: number;
  readonly rowHeader: number;
  readonly columnHeader: number;
  readonly frozenRows: number;
  readonly frozenColumns: number;
  readonly frozenHeight: number;
  readonly frozenWidth: number;
}

/// Gli oggetti che si spostano e si misurano: quelli che galleggiano sulle
/// celle, con il nome del tipo che i comandi di GridCraft vogliono.
const MOVABLE: Readonly<Partial<Record<GridObject["kind"], string>>> = { chart: "chart", image: "image", shape: "shape" };
/// Le maniglie di un oggetto selezionato: dove stanno e che lati muovono.
const HANDLES: readonly { readonly id: string; readonly x: number; readonly y: number }[] = [
  { id: "nw", x: 0, y: 0 }, { id: "n", x: 0.5, y: 0 }, { id: "ne", x: 1, y: 0 },
  { id: "e", x: 1, y: 0.5 }, { id: "se", x: 1, y: 1 }, { id: "s", x: 0.5, y: 1 },
  { id: "sw", x: 0, y: 1 }, { id: "w", x: 0, y: 0.5 },
];
/// Sotto questa distanza in pixel un clic su un oggetto non lo sposta.
const DRAG_SLOP = 3;
/// Gli oggetti che l'elenco per chi non vede nomina, al più.
const SUMMARY_OBJECTS = 50;

/// Un rettangolo sullo schermo, nelle coordinate del canvas.
interface ObjectRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/// Lo spostamento, o la misura, di un oggetto con il puntatore.
interface ObjectGesture {
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

/// La chiave dell'oggetto che un comando di inserimento dice di aver fatto
/// (`{"chart": 3}`), o `null`.
function insertedObject(result: string | null): string | null {
  if (result === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(result);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const kind of ["chart", "image", "shape"] as const) {
    const id = (value as Record<string, unknown>)[kind];
    if (typeof id === "number" && Number.isInteger(id) && id >= 0) return `${kind}:${id}`;
  }
  return null;
}

/// L'oggetto sta dove stava: la stessa cella, lo stesso scarto e la stessa
/// misura.
function sameObjectPlace(left: GridObject, right: GridObject): boolean {
  return left.row === right.row && left.column === right.column && left.dx === right.dx
    && left.dy === right.dy && left.width === right.width && left.height === right.height;
}

/// La sessione della versione 2 aperta su una cartella.
interface BytesState {
  readonly surface: string;
  readonly instance: string;
  session: GridBytesSession;
}

/// Una cella da scrivere: dove, e l'input che il file deve avere.
interface CellWrite {
  readonly position: GridPosition;
  readonly after: string;
}

function sameWindow(left: GridBytesWindow, right: GridBytesWindow): boolean {
  return left.sheet === right.sheet && left.row_start === right.row_start && left.column_start === right.column_start;
}

/// Le finestre da tenere dopo una lettura: quelle nuove, e le vecchie ancora
/// della revisione `revision` che le nuove non sostituiscono.
function keptWindows(kept: readonly GridBytesWindow[], fresh: readonly GridBytesWindow[], revision: string): GridBytesWindow[] {
  const old = kept.filter((window) => window.revision === revision && !fresh.some((candidate) => sameWindow(candidate, window)));
  return [...old, ...fresh].slice(-MAX_KEPT_WINDOWS);
}

export interface GridHost {
  readonly listGridSurfaces: () => Promise<readonly GridSurfaceSpec[]>;
  readonly openGridBytes: (surface: string, doc: string, journal: string, base: string) => Promise<GridBytesSession>;
  readonly gridBytesWindow: (surface: string, instance: string, request: GridWindowRequest) => Promise<GridBytesWindow>;
  readonly applyGridBytes: (surface: string, instance: string, request: GridApplyRequest) => Promise<GridCommit>;
  readonly gridBytesCommands: (surface: string, instance: string, selection: GridCommandSelection) => Promise<readonly GridCommandState[]>;
  readonly gridBytesCommand: (surface: string, instance: string, request: GridCommandRequest) => Promise<GridCommandOutcome>;
  readonly closeGridBytes: (surface: string, instance: string) => Promise<void>;
}

export interface GridChange {
  readonly text: string;
  /**
   * Una conferma del provider che riscrive i byte di un commit già pubblicato
   * non ha patch di celle da dare: porta un'operazione di solo testo, e chi la
   * riceve rilegge il sorgente.
   */
  readonly operation: TextOperation;
  readonly origin: EditorChangeOrigin;
}

/// Come è andato un comando dato con `GridEngine.run`: il risultato come
/// testo JSON, o la ragione del rifiuto (`null`: non è arrivato).
export type GridRun =
  | { readonly ok: true; readonly result: string | null }
  | { readonly ok: false; readonly error: string | null };

/**
 * La griglia di una cartella di Excel: il testo della sessione è il giornale
 * delle sue celle cambiate, e la griglia si apre sui byte con la versione 2
 * del protocollo (`editors/grid/workbook.ts`).
 */
export interface GridEngineOptions {
  readonly surfaceId: string;
  readonly formatId?: string | null;
  readonly revision?: string;
  /// Il documento, per aprire la versione 2 sui suoi byte.
  readonly documentId?: string;
  /// La revisione dei byte da cui il giornale discende adesso: cambia a ogni
  /// salvataggio. Senza, si usa `revision`.
  readonly base?: () => string | null;
  readonly onChange: (change: GridChange) => void;
  readonly onSelectionChange: () => void;
  /// Il catalogo dei comandi è cambiato (`GridEngine.commands`).
  readonly onCommands?: () => void;
  /// Un comando chiede una finestra di dialogo alla shell.
  readonly onDialog?: (dialog: GridDialog) => void;
  /// La cartella mostrata è cambiata: vista del foglio, tabelle o libro.
  readonly onView?: () => void;
  /// Il modo della cella è cambiato (`GridEngine.editMode`).
  readonly onEditMode?: () => void;
  readonly grid?: GridHost;
  readonly theme?: Theme;
  /// Il lettore dei PDF della shell: l'anteprima di stampa ci disegna le
  /// pagine.
  readonly pdf?: PdfEngineLoader;
  /// L'esportazione in PDF della cartella, con l'export dell'host: se si può
  /// adesso, e come si chiede.
  readonly exportPdf?: { readonly available: () => boolean; readonly run: () => void };
}
interface AxisLayout {
  readonly offsets: number[];
  readonly sizes: number[];
  readonly total: number;
}

/// Un gesto del puntatore sulle celle. `x` e `y` sono l'ultimo punto, per
/// rifare il gesto quando la griglia scorre sotto un puntatore fermo.
type CellDrag =
  | { readonly kind: "cells" | "rows" | "columns"; readonly anchor: GridPosition; x: number; y: number }
  | { readonly kind: "fill"; readonly source: GridRange; target: GridRange; x: number; y: number }
  | { readonly kind: "move"; readonly source: GridRange; readonly grab: GridPosition; target: GridRange; x: number; y: number }
  | { readonly kind: "point"; readonly anchor: GridPosition; x: number; y: number };

/// Il riferimento puntato in una formula aperta: dove sta nel testo, che
/// testo c'era dopo averlo scritto, e le celle che dice. Vale finché il testo
/// e il cursore sono quelli.
interface Pointing {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly anchor: GridPosition;
  readonly focus: GridPosition;
}

/// Un bordo fra due intestazioni preso col puntatore: la colonna (o la riga)
/// `index` che finisce lì, e le linee che si misurano insieme.
interface ResizeEdge {
  readonly axis: "column" | "row";
  readonly index: number;
}

/// La misura che si tira: `size` all'inizio, `now` adesso, in pixel dello
/// schermo; `from` è dove il puntatore è partito.
interface ResizeDrag extends ResizeEdge {
  readonly from: number;
  readonly size: number;
  now: number;
}

/// Quanto vicino al bordo fra due intestazioni il puntatore lo prende.
const RESIZE_SLOP = 4;
/// Quanto vicino al bordo della selezione il puntatore la prende per
/// spostarla.
const MOVE_SLOP = 3;

/// I pixel del file in caratteri di Excel, come la sua finestra Larghezza
/// colonne: è l'inverso di `chars_to_points` di GridCraft.
export function pixelsToChars(pixels: number): number {
  if (pixels <= 0) return 0;
  return pixels < 12 ? pixels / 12 : (pixels - 5) / 7;
}

/// Ogni quanto la griglia scorre mentre un gesto esce dal bordo, e di quanto
/// al più per passo.
const DRAG_SCROLL_MS = 30;
const DRAG_SCROLL_MAX = 60;

/// Il riempimento che il quadratino porta da `source` verso `position`: la
/// regola della Tabella (`fillRange`); dentro la sorgente resta la sorgente.
export function fillTarget(source: GridRange, position: GridPosition): GridRange {
  const range = fillRange(tableRange(source), position);
  return range ? { rowStart: range.r0, columnStart: range.c0, rowEnd: range.r1, columnEnd: range.c1 } : source;
}

/// Un intervallo della griglia in quello della Tabella.
function tableRange(range: GridRange): { r0: number; c0: number; r1: number; c1: number } {
  return { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd };
}

function sameRange(a: GridRange, b: GridRange): boolean {
  return a.rowStart === b.rowStart && a.rowEnd === b.rowEnd && a.columnStart === b.columnStart && a.columnEnd === b.columnEnd;
}

interface EditingState {
  readonly position: GridPosition;
  /// L'input della cella quando si è aperta: confermare scrive soltanto se
  /// la bozza è diversa.
  original: string;
  draft: string;
  readonly owner: "cell" | "formula";
  /// «Inserisci», aperta da una battuta: le frecce confermano e spostano.
  /// «Modifica», aperta con F2 o il doppio clic: le frecce muovono il
  /// cursore. F2 alterna.
  mode: GridEditMode;
  /// L'input che la cella ha preso sotto la bozza, da un salvataggio o da un
  /// altro riquadro, finché non si sceglie quale tenere.
  theirs: string | null;
}

/// Il modo della cella aperta, come lo dice la banda di stato.
export type GridEditMode = "ready" | "insert" | "edit";

/// Che cosa fa una battuta su una cella scelta. Un tasto vero (`isTrusted`)
/// stampabile, morto o di composizione (`Process`, `isComposing`) apre la
/// cella e lascia che il browser ci scriva: così passano tasti morti e IME.
/// Un evento sintetico non scrive niente da sé, e la cella si apre col suo
/// carattere. Le scorciatoie (Ctrl, Cmd, Alt senza AltGr) non aprono.
export function typingOpens(event: KeyboardEvent): "browser" | "seed" | null {
  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  if (event.ctrlKey && !altGraph) return null;
  if (event.metaKey || (event.altKey && !altGraph)) return null;
  const composing = event.isComposing || event.key === "Process" || event.key === "Dead";
  if (event.isTrusted && (composing || event.key.length === 1)) return "browser";
  return !composing && event.key.length === 1 ? "seed" : null;
}

function axisLayout(
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

function indexAt(layout: AxisLayout, offset: number): number {
  let low = 0;
  let high = layout.sizes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (layout.offsets[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(layout.sizes.length - 1, low);
}

function boundedWindow(layout: AxisLayout, start: number, length: number) {
  if (!layout.sizes.length) return { start: 0, end: -1 };
  const first = indexAt(layout, Math.max(0, start));
  const last = indexAt(layout, Math.max(0, start + length));
  return {
    start: Math.max(0, first - GRID_OVERSCAN),
    end: Math.min(layout.sizes.length - 1, last + GRID_OVERSCAN),
  };
}
function viewportRange(
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
/** Shared, read-only fixed-row window for query-backed tables. It reuses the
 * Grid overscan geometry but never opens a mutative workbook session. */
export function uniformRowRange(total: number, scrollTop: number, viewportHeight: number, rowHeight: number): { start: number; end: number } | null {
  return viewportRange(total, { offsets: [], sizes: [], total: 0 }, scrollTop, viewportHeight, 0, rowHeight);
}
function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value));
}
/// Gli elementi che `#render` disegna direttamente nella griglia.
const DRAWN = ".grid-row, .grid-freeze, .grid-object, .grid-selection, .grid-fill-handle, .grid-fill-preview, .grid-cut-mark, .grid-resize-guide, .grid-resize-label, .grid-move-preview, .grid-formula-ref";

/// Dà a `target` gli attributi di `source`, e toglie quelli che lui non ha.
function syncAttributes(target: Element, source: Element): void {
  for (const attribute of [...target.attributes]) {
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  }
  for (const attribute of source.attributes) {
    if (target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
  }
}

/// Se `range` è esattamente un'unione: una cella sola, per Invio e Tab.
function mergeCovers(merges: readonly GridMerge[], range: GridRange): boolean {
  const merge = mergeAt(merges, { row: range.rowStart, column: range.columnStart });
  return Boolean(merge)
    && merge!.row === range.rowStart && merge!.column === range.columnStart
    && merge!.row + merge!.rows - 1 === range.rowEnd && merge!.column + merge!.columns - 1 === range.columnEnd;
}

function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.row === right.row && left.column === right.column;
}

function byteOffset(value: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("grid source diff offset is not a safe integer");
  }
  return value;
}

function safeSourceBoundary(bytes: Uint8Array, at: number): boolean {
  return at >= 0
    && at <= bytes.length
    && !(at > 0 && at < bytes.length && bytes[at - 1] === 0x0d && bytes[at] === 0x0a);
}

function applySourceEdit(source: string, edit: GridCommit["edit"]): string {
  if (typeof edit.deleted !== "string" || typeof edit.inserted !== "string") {
    throw new Error("grid source diff has invalid text");
  }
  const bytes = new TextEncoder().encode(source);
  const from = byteOffset(edit.from);
  const to = byteOffset(edit.to);
  if (from > to || to > bytes.length || !safeSourceBoundary(bytes, from) || !safeSourceBoundary(bytes, to)) {
    throw new Error("grid source diff splits UTF-8 or CRLF");
  }
  let deleted: string;
  try {
    deleted = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(from, to));
  } catch {
    throw new Error("grid source diff splits UTF-8 or CRLF");
  }
  if (deleted !== edit.deleted) throw new Error("grid source diff preimage mismatch");
  const inserted = new TextEncoder().encode(edit.inserted);
  const resultLength = from + inserted.length + bytes.length - to;
  if (!Number.isSafeInteger(resultLength)) throw new Error("grid source diff result is too large");
  const result = new Uint8Array(resultLength);
  result.set(bytes.slice(0, from), 0);
  result.set(inserted, from);
  result.set(bytes.slice(to), from + inserted.length);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(result);
  } catch {
    throw new Error("grid source diff has invalid UTF-8");
  }
}

export class GridEngine {
  readonly #root: HTMLElement;
  readonly #formulaHost: HTMLElement;
  readonly #viewport: HTMLElement;
  readonly #canvas: HTMLElement;
  readonly #corner: HTMLElement;
  readonly #cellEditorHost: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #ribbonHost: HTMLElement;
  readonly #sheetBar: HTMLElement;
  readonly #formulaEditor: TextEngine;
  readonly #cellEditor: TextEngine;
  readonly #options: GridEngineOptions;
  readonly #stopLanguage: () => void;
  readonly #abort = new AbortController();
  #workbook: GridWorkbook | null = null;
  /// La cartella di Excel che la griglia mostra.
  #view: WorkbookView | null = null;
  /// La sessione aperta; `null` mentre si apre o se non si è aperta.
  #bytes: BytesState | null = null;
  #bytesOpening = false;
  /// L'ultima sessione mostrata e le finestre lette: restano mentre la
  /// cartella si riapre, così la griglia non si svuota.
  #shownSession: GridBytesSession | null = null;
  #windows: GridBytesWindow[] = [];
  /// La revisione dei byte su cui la sessione è aperta.
  #bytesBase: string | null = null;
  /// Il giornale pubblicato alla sessione, e quello che il provider tiene.
  #journal = "";
  #confirmedJournal = "";
  /// Cresce a ogni apertura: un passo in coda di prima non vale più.
  #bytesEpoch = 0;
  /// Cresce quando una modifica non entra: quelle in coda partivano da lei.
  #editEpoch = 0;
  #bytesTickets = 0;
  #bytesConflicts = 0;
  /// L'ultima frase di un gesto rifiutato o di un guasto, sotto gli avvisi.
  #bytesMessage: string | null = null;
  #decimal: "." | "," = decimalSeparator(resolvedLanguage());
  #sheetTabs: { readonly handle: TabsHandle; readonly names: string; readonly lifetime: Lifetime } | null = null;
  #sheetIndex = 0;
  #viewportLoad: Promise<void> | null = null;
  #viewportLoadQueued = false;
  #selection: GridSelection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
  #rows: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  #columns: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  #editing: EditingState | null = null;
  #pointing: Pointing | null = null;
  /// Ciò che si è tagliato e non ancora incollato: le formiche attorno
  /// all'intervallo, e il testo che l'incolla riconosce per spostarlo.
  #cutMark: { readonly sheet: string; readonly range: GridRange; readonly text: string } | null = null;
  /// Ciò che copia o taglia hanno preso dalla cartella: l'incolla che trova
  /// lo stesso testo negli appunti lo rifà con `fub.pasteFrom`.
  #copied: Copied | null = null;
  /// La colonna dove una serie di Tab è cominciata: Invio ci torna.
  #tabStart: number | null = null;
  /// Il disegno chiesto dallo scorrimento, uno per fotogramma.
  #renderFrame: number | null = null;
  /// Ciò che ogni elemento disegnato era quando è nato, senza la selezione:
  /// un elemento uguale a quello nuovo resta al suo posto (`#reconcile`).
  readonly #drawn = new WeakMap<Element, string>();
  #readOnly = false;
  #destroyed = false;
  #providerCommitTail: Promise<void> = Promise.resolve();
  #undo: GridCellPatch[][] = [];
  #redo: GridCellPatch[][] = [];
  /// Il gesto del puntatore sulle celle: una selezione che si allarga
  /// (celle, righe o colonne intere) o il quadratino di riempimento tirato.
  #drag: CellDrag | null = null;
  #resize: ResizeDrag | null = null;
  /// Gli altri intervalli di una selezione a più intervalli, sul foglio
  /// mostrato; quello in cui si lavora è `#selection`.
  #others: GridRange[] = [];
  /// Maiusc+F8: i movimenti tengono gli intervalli già scelti.
  #adding = false;
  /// Lo scorrimento mentre il gesto esce dal bordo della griglia.
  #dragScroll: ReturnType<typeof setInterval> | null = null;
  /// Il catalogo dei comandi sulla selezione, come il provider l'ha dato.
  #commands: GridCommandState[] = [];
  #commandsLoad: Promise<void> | null = null;
  #commandsQueued = false;
  /// Il giornale confermato è di comandi: annulla e ripeti sono del provider.
  #confirmedCommands = false;
  /// Le richieste in coda che porteranno la sessione ai comandi.
  #pendingCommandMode = 0;
  #frame: SheetFrame = {
    view: DEFAULT_SHEET_VIEW,
    zoom: 1,
    rowHeader: ROW_HEADER_WIDTH,
    columnHeader: COLUMN_HEADER_HEIGHT,
    frozenRows: 0,
    frozenColumns: 0,
    frozenHeight: 0,
    frozenWidth: 0,
  };
  /// La famiglia di caratteri della griglia, per un carattere del file che manca.
  #fallbackFont: string | null = null;
  /// La carta su cui i colori del file si portano, nell'aspetto adattato.
  #paper: Adapter | null = null;
  /// Le immagini lette, per impronta: restano fra una finestra e l'altra, e
  /// l'host non le rimanda.
  readonly #media = new GridMediaCache();
  /// Le finestre lette hanno portato immagini nuove: quelle a cui ne
  /// mancano si possono richiedere.
  #mediaAdded = false;
  /// L'elenco degli oggetti del foglio, per chi non li vede.
  readonly #objectsSummary: HTMLElement;
  /// L'oggetto selezionato (`objectKey`): la tastiera è sua finché c'è.
  #selectedObject: string | null = null;
  #objectGesture: ObjectGesture | null = null;
  /// Dove un oggetto spostato si mostra finché la finestra riletta non lo
  /// porta lì: vale finché l'oggetto è ancora quello di prima.
  #placed: { readonly key: string; readonly before: GridObject; readonly rect: ObjectRect } | null = null;
  /// Il testo di una casella di testo che si scrive.
  #objectText: { readonly key: string; readonly field: HTMLTextAreaElement; readonly original: string } | null = null;
  /// Ciò che si dice a chi non vede quando un oggetto si seleziona.
  readonly #objectsAnnounce: HTMLElement;
  /// L'avviso di una bozza la cui cella è cambiata sotto, con i due pulsanti.
  readonly #draftNotice: HTMLElement;
  readonly #draftText: HTMLElement;
  /// Ciò che vive quanto la griglia e si toglie con una vita: la scheda delle
  /// note e dei commenti.
  readonly #life: Lifetime = openLifetime();

  constructor(parent: HTMLElement, options: GridEngineOptions) {
    const signal = this.#abort.signal;
    this.#options = options;
    this.#root = document.createElement("div");
    this.#root.className = "grid-surface";
    this.#notice = document.createElement("p");
    this.#notice.className = "grid-notice";
    this.#notice.setAttribute("role", "status");
    this.#notice.hidden = true;
    this.#draftNotice = document.createElement("div");
    this.#draftNotice.className = "grid-draft-notice";
    this.#draftNotice.setAttribute("role", "alert");
    this.#draftNotice.hidden = true;
    this.#draftText = document.createElement("p");
    this.#draftNotice.append(
      this.#draftText,
      textButton({ label: t("grid.draft.keep"), kind: "primary", onPress: () => this.#keepDraft() }),
      textButton({ label: t("grid.draft.take"), onPress: () => this.#takeTheirs() }),
    );
    this.#ribbonHost = document.createElement("div");
    this.#ribbonHost.className = "grid-ribbon-host";
    this.#sheetBar = document.createElement("div");
    this.#sheetBar.className = "grid-sheets";
    this.#sheetBar.hidden = true;

    const formula = document.createElement("div");
    formula.className = "grid-formula-bar";
    const name = document.createElement("span");
    name.className = "grid-cell-name";
    name.setAttribute("aria-hidden", "true");
    this.#formulaHost = document.createElement("div");
    this.#formulaHost.className = "grid-formula-editor";
    formula.append(name, this.#formulaHost);

    this.#viewport = document.createElement("div");
    this.#viewport.className = "grid-viewport";
    this.#viewport.tabIndex = 0;
    this.#viewport.setAttribute("role", "grid");
    this.#viewport.setAttribute("aria-label", t("grid.surface"));
    this.#canvas = document.createElement("div");
    this.#canvas.className = "grid-canvas";
    this.#canvas.setAttribute("role", "presentation");
    this.#corner = document.createElement("div");
    this.#corner.className = "grid-corner";
    this.#cellEditorHost = document.createElement("div");
    this.#cellEditorHost.className = "grid-cell-editor";
    this.#cellEditorHost.hidden = true;
    this.#cellEditorHost.setAttribute("aria-hidden", "true");
    this.#canvas.append(this.#cellEditorHost);
    this.#viewport.append(this.#canvas);
    this.#objectsSummary = document.createElement("p");
    this.#objectsSummary.className = "grid-objects-summary sr-only";
    this.#objectsSummary.id = `grid-${options.surfaceId}-objects`;
    this.#objectsAnnounce = document.createElement("p");
    this.#objectsAnnounce.className = "grid-objects-announce sr-only";
    this.#objectsAnnounce.setAttribute("role", "status");
    this.#root.append(this.#ribbonHost, this.#notice, this.#draftNotice, formula, this.#viewport, this.#objectsSummary, this.#objectsAnnounce, this.#sheetBar);
    parent.replaceChildren(this.#root);
    this.#stopLanguage = onLanguage(() => {
      this.#viewport.setAttribute("aria-label", t("grid.surface"));
      this.#decimal = decimalSeparator(resolvedLanguage());
      this.#showNotice();
      this.#sheetBar.querySelector(".kit-tabs")?.setAttribute("aria-label", t("grid.workbook.sheets"));
      if (!this.#editing) this.#syncFormulaBar();
      this.#render();
    });

    // La barra della formula è sempre in «Modifica»: le frecce muovono il
    // cursore, Invio e Tab confermano e spostano come nella cella.
    const formulaProfile = createFormulaProfile({
      singleLine: false,
      callbacks: {
        commit: (_value, move, arrow) => this.#commitAndMove(move, arrow),
        cancel: () => this.#finishEditing(false, "input"),
      },
    });
    this.#formulaEditor = createTextEngine(this.#formulaHost, {
      onChange: (change) => this.#draftFromEditor("formula", change.text),
      onSelectionChange: () => {},
      theme: options.theme,
      field: true,
      extensions: () => formulaProfile.extensions(),
    });
    const cellProfile = createFormulaProfile({
      singleLine: false,
      callbacks: {
        commit: (_value, move, arrow) => this.#commitAndMove(move, arrow),
        cancel: () => this.#finishEditing(false, "input"),
        arrowsCommit: () => this.#editing?.mode === "insert",
        toggleMode: () => this.#toggleEditMode(),
        point: (move, extend) => this.#pointByKey(move, extend),
      },
    });
    this.#cellEditor = createTextEngine(this.#cellEditorHost, {
      onChange: (change) => this.#draftFromEditor("cell", change.text),
      onSelectionChange: () => {},
      theme: options.theme,
      field: true,
      extensions: () => cellProfile.extensions(),
    });

    this.#viewport.addEventListener("scroll", () => {
      this.#scheduleRender();
      void this.#loadViewport();
    }, { signal });
    // L'editor della cella sta dentro la griglia, e i suoi eventi salgono fin
    // qui: battute, clic per spostare il cursore, appunti. Sono suoi, e la
    // griglia non li legge come gesti sulle celle (riaprirebbe la cella, la
    // chiuderebbe, o taglierebbe la selezione invece del testo).
    const grid = <E extends Event>(handler: (event: E) => void) => (event: E) => {
      if (event.target instanceof Node && this.#cellEditorHost.contains(event.target)) return;
      handler(event);
    };
    this.#viewport.addEventListener("keydown", grid((event) => this.#keydown(event)), { signal });
    this.#viewport.addEventListener("pointerdown", grid((event) => this.#pointerDown(event)), { signal });
    this.#viewport.addEventListener("pointermove", grid((event) => this.#pointerMove(event)), { signal });
    this.#viewport.addEventListener("pointerup", (event) => {
      this.#endResize(true);
      this.#endDrag(true, event.ctrlKey || event.metaKey);
      this.#endObjectGesture(event, true);
    }, { signal });
    this.#viewport.addEventListener("pointercancel", (event) => {
      this.#endResize(false);
      this.#endDrag(false, false);
      this.#endObjectGesture(event, false);
    }, { signal });
    this.#life.add(() => this.#stopDragScroll());
    this.#viewport.addEventListener("copy", grid((event) => this.#copy(event)), { signal });
    this.#viewport.addEventListener("cut", grid((event) => this.#cut(event)), { signal });
    this.#viewport.addEventListener("paste", grid((event) => this.#paste(event)), { signal });
    this.#viewport.addEventListener("dblclick", grid((event) => {
      // Sul bordo di un'intestazione il doppio clic adatta la misura.
      const edge = this.#resizeEdge(event.clientX, event.clientY);
      if (edge) {
        const id = edge.axis === "column" ? "home.autofitColumnWidth" : "home.autofitRowHeight";
        const lines = this.#resizeLines(edge);
        if (this.#serves(id)) this.command(id, JSON.stringify(edge.axis === "column" ? { cols: lines } : { rows: lines }));
        return;
      }
      // Il puntatore è catturato dalla griglia dal `pointerdown`: il browser
      // dà il doppio clic a lei, e ciò che c'era sotto lo dice il punto.
      // Due clic che puntano una formula non aprono un'altra cella.
      if (this.#pointing) return;
      const target = event.target === this.#viewport
        ? document.elementFromPoint?.(event.clientX, event.clientY) ?? null
        : event.target instanceof Element ? event.target : null;
      if (!target || !this.#viewport.contains(target)) return;
      if (target.closest(".grid-object-text-editor")) return;
      if (target.closest(".grid-fill-handle")) {
        this.#fillToNeighbour();
        return;
      }
      const object = target.closest<HTMLElement>(".grid-object");
      if (object) {
        if (object.dataset.object) this.#beginObjectText(object.dataset.object);
        return;
      }
      const cell = target.closest<HTMLElement>(".grid-cell");
      const position = cell ? this.#positionOf(cell) : null;
      if (position) this.#beginEditing("cell", position, undefined, "edit");
    }), { signal });
    this.#formulaHost.addEventListener("focusin", () => {
      // Dalla cella aperta alla barra la bozza passa con lei.
      if (this.#editing?.owner === "cell") {
        const draft = this.#editing.draft;
        this.#finishEditing(false, "input", false);
        this.#beginEditing("formula", this.#active(), draft, "edit");
        return;
      }
      this.#beginEditing("formula", this.#active());
    }, { signal });
    this.#formulaHost.addEventListener("focusout", () => this.#commitAfterBlur("formula"), { signal });
    // Un clic altrove, o il fuoco che se ne va, conferma la cella, come la
    // barra della formula; non quando il fuoco passa alla barra.
    this.#cellEditorHost.addEventListener("focusout", (event) => {
      if (
        event.relatedTarget instanceof Node
        && (this.#formulaHost.contains(event.relatedTarget) || this.#draftNotice.contains(event.relatedTarget))
      ) return;
      this.#commitAfterBlur("cell");
    }, { signal });
    attachCommentCards({
      root: this.#viewport,
      lifetime: this.#life,
      comment: (cell) => {
        const position = this.#positionOf(cell);
        return position ? this.#workbookCell(position)?.bytes?.comment ?? null : null;
      },
      address: (cell) => {
        const position = this.#positionOf(cell);
        return position ? cellA1(position) : "";
      },
      serves: (id) => this.commandable() && this.#commands.some((command) => command.id === id && command.enabled),
      run: (id, params) => this.run(id, JSON.stringify(params)),
      edit: (cell) => {
        const position = this.#positionOf(cell);
        if (!position) return;
        this.#select(position, false);
        this.focus();
        const threaded = cell.dataset.comment === "thread";
        this.openDialog(threaded ? "comment" : "note", JSON.stringify({ threaded }));
      },
    });
  }
  setDoc(source: string): void {
    if (this.#destroyed) return;
    this.#openWorkbook(source, true);
  }

  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this.#destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    // Il giornale che la griglia ha già, sugli stessi byte: niente da fare.
    // Altrimenti è cambiato altrove (un altro riquadro, un salvataggio che
    // l'ha messo nei byte, una ricarica) e la griglia si riapre.
    if (source === this.#journal && this.#currentBase() === this.#bytesBase) return;
    this.#openWorkbook(source, false);
  }

  getDoc(): string { return this.#journal; }
  selection(): GridSelection {
    const { anchor, focus, active } = this.#selection;
    return active
      ? { anchor: { ...anchor }, focus: { ...focus }, active: { ...active } }
      : { anchor: { ...anchor }, focus: { ...focus } };
  }

  /// Il modo della cella: «Pronto», «Inserisci» o «Modifica».
  editMode(): GridEditMode {
    return this.#editing?.mode ?? "ready";
  }

  renderedCellCount(): number {
    return this.#viewport.querySelectorAll(".grid-cell").length;
  }

  focus(): void {
    if (this.#destroyed) return;
    // Una cella aperta (Inserisci funzione l'ha appena cominciata) tiene il
    // fuoco nel suo campo: la griglia lo prenderebbe chiudendola.
    if (this.#editing) (this.#editing.owner === "cell" ? this.#cellEditor : this.#formulaEditor).focus();
    else this.#viewport.focus();
  }

  /** Il testo della selezione da leggere ([`selectionText`]), o `null` oltre il tetto. */
  selectedText(): { primary: string; secondary: string[] } | null {
    if (this.#destroyed || !this.#workbook) return null;
    const range = normalizedSelection(this.#selection);
    const cells = (range.rowEnd - range.rowStart + 1) * (range.columnEnd - range.columnStart + 1);
    if (cells > SELECTED_TEXT_CELLS) return null;
    return { primary: selectionText(this.#selection, (position) => this.#cellAt(position)), secondary: [] };
  }

  setReadOnly(requested: boolean): void {
    const readOnly = requested;
    this.#readOnly = readOnly;
    this.#formulaEditor.setReadOnly(readOnly);
    this.#cellEditor.setReadOnly(readOnly);
    this.#root.dataset.readOnly = String(readOnly);
    if (readOnly) this.#finishEditing(false, "input");
  }

  setTheme(theme: Theme): void {
    this.#formulaEditor.setTheme(theme);
    this.#cellEditor.setTheme(theme);
    this.#root.dataset.theme = theme;
  }

  /// La carta del tema nell'aspetto adattato, o `null` negli altri: le celle
  /// si ridipingono soltanto se cambia.
  setPaper(paper: Paper | null): void {
    const next = paper ? adapter(paper) : null;
    if (next === this.#paper) return;
    this.#paper = next;
    this.#render();
  }

  undo(): boolean {
    if (this.#commandMode()) return this.#documentHistory(UNDO);
    const patches = this.#undo.pop();
    if (!patches) return false;
    if (!this.#commit(inverseGridPatches(patches), "undo", false)) {
      this.#undo.push(patches);
      return false;
    }
    this.#redo.push(patches);
    return true;
  }

  redo(): boolean {
    if (this.#commandMode()) return this.#documentHistory(REDO);
    const patches = this.#redo.pop();
    if (!patches) return false;
    if (!this.#commit(patches, "redo", false)) {
      this.#redo.push(patches);
      return false;
    }
    this.#undo.push(patches);
    return true;
  }

  /// Il catalogo dei comandi sulla selezione: vuoto se la sessione non ne
  /// serve.
  commands(): readonly GridCommandState[] {
    return this.#commands;
  }

  /// Lo stile della cella attiva, per lo stato dei controlli della barra.
  activeStyle(): GridBytesStyle | undefined {
    return this.#workbookCell(this.#active())?.style;
  }

  /// Dove la barra multifunzione si monta, sopra la barra della formula.
  ribbonHost(): HTMLElement {
    return this.#ribbonHost;
  }

  /// La vista del foglio mostrato.
  sheetView(): GridSheetView {
    return this.#sheetView();
  }

  /// Il lettore dei PDF per l'anteprima di stampa, se la shell ne ha uno.
  pdfLoader(): PdfEngineLoader | null {
    return this.#options.pdf ?? null;
  }

  /// L'esportazione in PDF, se la shell la offre adesso.
  pdfExport(): (() => void) | null {
    const exporting = this.#options.exportPdf;
    if (!exporting || !this.#bytes || !exporting.available()) return null;
    return () => {
      this.#finishEditing(true, "input", false);
      exporting.run();
    };
  }

  /// L'oggetto selezionato, per le schede che lo cambiano.
  selectedObject(): GridObject | null {
    return this.#objects().find((object) => objectKey(object) === this.#selectedObject) ?? null;
  }

  /// Le tabelle lette del foglio mostrato.
  tables(): readonly GridTable[] {
    return this.#view?.sheets[this.#sheetIndex]?.tables ?? [];
  }

  /// Ciò che vale per la cartella; `null` finché nessuna sessione è mostrata.
  book(): GridBook | null {
    return this.#shownSession?.book ?? null;
  }

  /// I fogli nascosti della cartella, per scoprirli.
  hiddenSheets(): readonly { id: string; name: string }[] {
    const session = this.#shownSession;
    if (!session) return [];
    return session.sheets
      .filter((sheet) => session.hidden.includes(sheet.id))
      .map((sheet) => ({ id: sheet.id, name: sheet.name }));
  }

  /// Se i comandi si possono dare adesso: una sessione che ne serve, e un
  /// documento che si modifica.
  commandable(): boolean {
    return !this.#destroyed && this.#bytes !== null && !this.#readOnly && this.#commands.length > 0;
  }

  /// La misura della parte della griglia che si vede, in pixel CSS.
  viewportSize(): { width: number; height: number } {
    return { width: this.#viewport.clientWidth, height: this.#viewport.clientHeight };
  }

  /// Scrive `text` dove si sta scrivendo una cella, al cursore; senza una
  /// cella aperta, apre la cella attiva con `=` e `text`: una funzione da
  /// cominciare (`SOMMA(`) o un nome definito.
  writeFormula(text: string): boolean {
    if (this.#destroyed || this.#readOnly || !this.#workbook) return false;
    if (this.#editing) {
      const editor = this.#editing.owner === "cell" ? this.#cellEditor : this.#formulaEditor;
      const written = editor.insertAtCursor(text);
      editor.focus();
      return written;
    }
    this.#beginEditing("cell", this.#active(), `=${text}`);
    if (!this.#editing) return false;
    this.#cellEditor.focus();
    return true;
  }

  /// Chiede al provider un comando che soltanto legge, come l'elenco delle
  /// funzioni: il risultato come testo JSON, o `null` se non arriva. La
  /// cartella, la selezione e la cronologia restano come sono.
  query(id: string, params = "{}"): Promise<string | null> {
    if (!QUERIES.has(id) || !this.#bytes || !this.#serves(id)) return Promise.resolve(null);
    if (READ_WITHOUT_PARAMS.has(id) && params.trim() !== "{}") return Promise.resolve(null);
    const command: GridCommand = { id, params, ...this.#commandSelection() };
    const epoch = this.#bytesEpoch;
    return new Promise((resolve) => {
      this.#enqueueProtocol(async () => {
        const host = this.#options.grid;
        const state = this.#bytes;
        if (!host || !state || this.#destroyed || epoch !== this.#bytesEpoch) {
          resolve(null);
          return;
        }
        try {
          const outcome = await host.gridBytesCommand(state.surface, state.instance, { revision: state.session.revision, command });
          const edit = outcome.commit.edit;
          resolve(edit.from === edit.to && !edit.inserted ? outcome.result : null);
        } catch {
          resolve(null);
        }
      });
    });
  }

  /// Dà il comando `id` del catalogo sulla selezione, con i parametri come
  /// testo di un oggetto JSON. Falso se il catalogo non lo serve acceso.
  command(id: string, params = "{}"): boolean {
    const state = this.#commands.find((command) => command.id === id);
    if (!this.#bytes || this.#readOnly || !state) return false;
    if (!state.enabled) {
      if (state.reason) this.#refuse(t("grid.workbook.command_off", { reason: state.reason }));
      return false;
    }
    this.#finishEditing(true, "input", false);
    this.#give(id, params, false);
    return true;
  }

  /// Dà il comando `id` come `command`, e rende come è andato: il risultato
  /// del provider, o la ragione per cui non l'ha dato. Per le finestre di
  /// dialogo, che dicono il rifiuto dentro di sé e non in un avviso della
  /// griglia. `error: null` vuol dire che il comando non è arrivato: la
  /// cartella è cambiata sotto, o la griglia è stata smontata.
  run(id: string, params = "{}"): Promise<GridRun> {
    const state = this.#commands.find((command) => command.id === id);
    if (!this.#bytes || this.#readOnly || !state) return Promise.resolve({ ok: false, error: null });
    if (!state.enabled) return Promise.resolve({ ok: false, error: state.reason ?? null });
    this.#finishEditing(true, "input", false);
    return new Promise((resolve) => this.#give(id, params, false, resolve));
  }

  /// Chiede alla shell la finestra `id` (`onDialog`), come la chiederebbe
  /// un comando: per le finestre che nessun comando del catalogo apre da sé.
  openDialog(id: string, params = "{}"): boolean {
    if (!this.commandable() || !this.#options.onDialog) return false;
    this.#finishEditing(true, "input", false);
    this.#options.onDialog({ id, params });
    return true;
  }

  /// Il tasto destro nel punto `x`, `y` della finestra, come in Excel: su un
  /// oggetto lo seleziona; sulla linguetta di un foglio lo mostra; su una
  /// cella, una riga o una colonna fuori dalla selezione la sceglie, dentro
  /// la lascia com'è. Torna su cosa si è premuto, o `null` fuori dalla griglia.
  pointAt(x: number, y: number): "cell" | "row" | "column" | "corner" | "sheet" | "object" | null {
    if (this.#destroyed || !this.#workbook) return null;
    const element = document.elementFromPoint(x, y);
    if (!element || !this.#root.contains(element)) return null;
    const tab = this.#sheetBar.contains(element) ? element.closest<HTMLElement>("[data-tab]") : null;
    if (tab) {
      const index = this.#workbook.sheets.findIndex((sheet) => sheet.id === tab.dataset.tab);
      if (index < 0) return null;
      this.#showSheetAt(index);
      return "sheet";
    }
    const object = element.closest<HTMLElement>(".grid-object");
    const key = object?.dataset.object ?? null;
    if (key && this.#objectByKey(key)) {
      this.#finishEditing(true, "input", false);
      this.#selectObject(key);
      return "object";
    }
    if (!this.#viewport.contains(element)) return null;
    const cell = this.#eventPosition({ target: element } as unknown as Event);
    const hit = cell ?? this.#hit(x, y, false);
    if (!hit) return null;
    if (this.#selectedObject !== null) this.#selectObject(null);
    const sheet = this.#sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    const range = normalizedSelection(this.#selection);
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    let next: GridSelection | null = null;
    if (kind === "all") {
      next = { anchor: { row: lastRow, column: lastColumn }, focus: { row: 0, column: 0 } };
    } else {
      const position = { row: hit.row ?? 0, column: hit.column ?? 0 };
      const whole = kind === "rows"
        ? range.columnStart === 0 && range.columnEnd === lastColumn
        : kind === "columns" ? range.rowStart === 0 && range.rowEnd === lastRow : true;
      const inside = whole
        && (kind === "columns" || (position.row >= range.rowStart && position.row <= range.rowEnd))
        && (kind === "rows" || (position.column >= range.columnStart && position.column <= range.columnEnd));
      if (!inside) {
        const anchor = this.#anchorOf(position);
        next = kind === "cells" ? { anchor, focus: anchor } : this.#dragSelection(kind, anchor, position);
      }
    }
    if (next) {
      this.#finishEditing(true, "input", false);
      this.#others = [];
      this.#selection = next;
      this.#syncFormulaBar();
      this.#render();
      this.#selectionChanged();
    }
    return kind === "all" ? "corner" : kind === "rows" ? "row" : kind === "columns" ? "column" : "cell";
  }

  /// Il riquadro della cella attiva nella finestra, per aprire il menu dalla
  /// tastiera.
  activeCellBox(): { left: number; top: number; right: number; bottom: number } | null {
    const cell = this.#viewport.querySelector<HTMLElement>(".grid-cell.active");
    const box = (cell ?? this.#viewport).getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }

  /// Si scrive nelle celle: una cartella letta e un documento non in sola
  /// lettura.
  writable(): boolean {
    return !this.#destroyed && !this.#readOnly && this.#workbook !== null;
  }

  /// Sceglie tutto il foglio, come l'angolo delle intestazioni.
  selectAll(): void {
    if (this.#destroyed || !this.#workbook) return;
    const sheet = this.#sheet();
    if (this.#selectedObject !== null) this.#selectObject(null);
    this.#others = [];
    this.#selection = {
      anchor: { row: Math.max(0, sheet.rows.length - 1), column: Math.max(0, sheet.columns.length - 1) },
      focus: { row: 0, column: 0 },
      active: { row: this.#edgeVisible("row", false), column: this.#edgeVisible("column", false) },
    };
    this.#syncFormulaBar();
    this.#render();
    this.#selectionChanged();
  }

  /// La selezione come la copia Mod-c: testo separato da tabulazioni.
  selectionTsv(): string {
    return selectionTsv(this.#selection, (position) => this.#cellAt(position));
  }

  /// Incolla `text` (righe e tabulazioni) dalla cella attiva, come Mod-v.
  pasteText(text: string): void {
    if (this.#readOnly || this.#destroyed) return;
    this.#pasteTsv(text);
  }

  /// Svuota le celle scelte, come Canc.
  clearCells(): void {
    this.#clearSelection();
  }

  /// La selezione come la scrive una formula: il nome del foglio,
  /// l'intervallo e la cella attiva in A1.
  selectionRefs(): { readonly sheet: string; readonly range: string; readonly active: string } {
    return {
      sheet: this.#sheet().name,
      range: rangeA1(this.#selectedRange()),
      active: cellA1(this.#active()),
    };
  }

  /// I nomi dei fogli della cartella, nell'ordine.
  sheetNames(): readonly string[] {
    return this.#shownSession?.sheets.map((sheet) => sheet.name) ?? [];
  }

  /// L'altezza della riga o la larghezza della colonna `index` del foglio
  /// mostrato, nei pixel della cartella; `null` se non è letta.
  lineSize(axis: "row" | "column", index: number): number | null {
    const sheet = this.#sheet();
    const size = axis === "row" ? sheet.rows[index]?.height : sheet.columns[index]?.width;
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null;
  }

  /// Annulla o ripeti del documento, nella sessione a comandi.
  #documentHistory(id: typeof UNDO | typeof REDO): boolean {
    if (!this.#bytes || this.#readOnly || !this.#serves(id)) return false;
    this.#finishEditing(false, "input", false);
    this.#give(id, "{}", true);
    return true;
  }

  /// Mette in coda il comando `id`: da qui annulla e ripeti sono del
  /// provider, anche prima che risponda.
  #give(id: string, params: string, history: boolean, done?: (run: GridRun) => void): void {
    const selection = this.#commandSelection();
    const command: GridCommand = { id, params, ...selection };
    // Un comando cambia la cartella sotto ciò che si è copiato.
    if (id !== PASTE_FROM) this.#copied = null;
    this.#undo = [];
    this.#redo = [];
    this.#pendingCommandMode += 1;
    const epoch = this.#bytesEpoch;
    const edits = this.#editEpoch;
    const ticket = ++this.#bytesTickets;
    let settled = false;
    const finish = (run: GridRun): void => {
      if (settled) return;
      settled = true;
      done?.(run);
    };
    this.#enqueueProtocol(async () => {
      try {
        await this.#giveNow(command, history, epoch, edits, ticket, done ? finish : undefined);
      } finally {
        if (epoch === this.#bytesEpoch) this.#pendingCommandMode = Math.max(0, this.#pendingCommandMode - 1);
        finish({ ok: false, error: null });
      }
    });
  }

  /// Con `done`, il rifiuto va a chi aspetta invece che nell'avviso.
  async #giveNow(
    command: GridCommand,
    history: boolean,
    epoch: number,
    edits: number,
    ticket: number,
    done?: (run: GridRun) => void,
  ): Promise<void> {
    const host = this.#options.grid;
    const state = this.#bytes;
    const current = () => !this.#destroyed && epoch === this.#bytesEpoch && edits === this.#editEpoch && this.#bytes === state;
    if (!host || !state || !current()) return;
    let outcome: GridCommandOutcome;
    let session: GridBytesSession;
    try {
      outcome = await host.gridBytesCommand(state.surface, state.instance, { revision: state.session.revision, command });
      if (!current()) return;
      session = {
        ...state.session,
        revision: outcome.commit.revision,
        sheets: outcome.sheets,
        hidden: outcome.hidden,
        active: outcome.selection.sheet,
        commands: outcome.commands,
        book: outcome.book,
      };
      validateBytesSession(session);
      this.#confirm(applySourceEdit(this.#confirmedJournal, outcome.commit.edit));
    } catch (error) {
      if (!current()) return;
      // Niente da annullare o da ripetere non è un errore da dire.
      if (history && isErrorKind(error, "bad_args")) return;
      if (done) {
        done({ ok: false, error: errorText(error) });
        return;
      }
      this.#refuse(t("grid.workbook.command_failed", { error: errorText(error) }));
      // La transazione del provider non ha cambiato niente: le celle
      // mostrate in anticipo dalle modifiche in coda restano le sue.
      return;
    }
    state.session = session;
    this.#shownSession = session;
    this.#commands = outcome.commands;
    this.#bytesMessage = null;
    this.#options.onCommands?.();
    const last = ticket === this.#bytesTickets;
    if (last) this.#publishJournal(this.#confirmedJournal, "input");
    if (last) this.#adoptSelection(outcome.selection);
    // Un oggetto appena inserito resta selezionato, come in Excel.
    const inserted = last && command.id.startsWith("insert.") ? insertedObject(outcome.result) : null;
    done?.({ ok: true, result: outcome.result });
    if (outcome.dialog) this.#options.onDialog?.(outcome.dialog);
    if (outcome.commit.edit.from === outcome.commit.edit.to && !outcome.commit.edit.inserted) {
      this.#showView(this.#sheet().id, false);
      return;
    }
    await this.#refreshBytes(state, epoch);
    if (inserted && current() && this.#objectByKey(inserted)) this.#selectObject(inserted);
  }

  /// La selezione che un comando ha lasciato: il foglio, l'intervallo che
  /// contiene la cella attiva e la cella attiva, che è l'àncora quando è un
  /// angolo dell'intervallo.
  #adoptSelection(selection: GridCommandSelection): void {
    const index = this.#workbook?.sheets.findIndex((sheet) => sheet.id === selection.sheet) ?? -1;
    const active = parseCellA1(selection.active);
    if (index < 0 || !active) return;
    const areas = selection.selection.split(",").map(parseRangeA1).filter((area): area is GridRange => area !== null);
    const area = areas.find((candidate) =>
      active.row >= candidate.rowStart && active.row <= candidate.rowEnd
      && active.column >= candidate.columnStart && active.column <= candidate.columnEnd);
    // Gli altri intervalli restano scelti, come li ha lasciati il comando.
    this.#others = areas.filter((candidate) => candidate !== area);
    let next: GridSelection = { anchor: active, focus: active };
    if (area) {
      const row = active.row === area.rowStart ? area.rowEnd : area.rowStart;
      const column = active.column === area.columnStart ? area.columnEnd : area.columnStart;
      const corner = (active.row === area.rowStart || active.row === area.rowEnd)
        && (active.column === area.columnStart || active.column === area.columnEnd);
      next = corner
        ? { anchor: active, focus: { row, column } }
        : { anchor: { row: area.rowStart, column: area.columnStart }, focus: { row: area.rowEnd, column: area.columnEnd }, active };
    }
    const sameSheet = index === this.#sheetIndex;
    if (
      sameSheet
      && samePosition(next.anchor, this.#selection.anchor)
      && samePosition(next.focus, this.#selection.focus)
      && samePosition(next.active ?? next.anchor, this.#active())
    ) return;
    if (!sameSheet) {
      this.#finishEditing(false, "input", false);
      this.#sheetIndex = index;
      this.#selection = next;
      this.#showSheet(true);
      this.#sheetTabs?.handle.select(selection.sheet);
      void this.#loadViewport();
    }
    this.#selection = this.#clampedSelection(next);
    this.#ensureVisible(this.#selection.focus);
    if (!this.#editing) this.#syncFormulaBar();
    this.#render();
    this.#options.onSelectionChange();
  }

  /// Rilegge il catalogo sulla selezione, una richiesta alla volta: chi
  /// arriva mentre una è in volo la rifà dopo.
  #loadCommands(): Promise<void> {
    const state = this.#bytes;
    if (!state || !this.#commands.length || !this.#options.onCommands || this.#destroyed) return Promise.resolve();
    if (this.#commandsLoad) {
      this.#commandsQueued = true;
      return this.#commandsLoad;
    }
    const epoch = this.#bytesEpoch;
    const load = (async () => {
      try {
        const commands = await this.#options.grid!.gridBytesCommands(state.surface, state.instance, this.#commandSelection());
        if (this.#destroyed || epoch !== this.#bytesEpoch || this.#bytes !== state) return;
        this.#commands = [...commands];
        this.#options.onCommands?.();
      } catch {
        // Un catalogo che non si rilegge resta quello di prima.
      }
    })().finally(() => {
      this.#commandsLoad = null;
      if (this.#commandsQueued) {
        this.#commandsQueued = false;
        void this.#loadCommands();
      }
    });
    this.#commandsLoad = load;
    return load;
  }


  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#stopLanguage();
    this.#abort.abort();
    if (this.#renderFrame !== null) cancelAnimationFrame(this.#renderFrame);
    this.#renderFrame = null;
    this.#bytesEpoch++;
    this.#closeBytes();
    this.#sheetTabs?.lifetime.close();
    this.#sheetTabs = null;
    this.#formulaEditor.destroy();
    this.#cellEditor.destroy();
    this.#media.clear();
    this.#life.close();
    this.#root.remove();
  }

  #sheet(): GridSheet {
    return this.#workbook?.sheets[this.#sheetIndex] ?? EMPTY_SHEET;
  }

  /// La cella in `position` del foglio mostrato. Le celle della cartella sono
  /// indicizzate: cercarle in lista a ogni cella disegnata costerebbe quanto
  /// il foglio intero.
  #cellAt(position: GridPosition): GridCell | undefined {
    return this.#workbookCell(position)?.cell;
  }

  #workbookCell(position: GridPosition): WorkbookCell | undefined {
    return this.#view?.sheets[this.#sheetIndex]?.cells.get(cellKey(position));
  }

  #currentBase(): string | null {
    return this.#options.base?.() ?? this.#options.revision ?? null;
  }

  /// Apre la cartella sul giornale `journal` e sui byte della base di
  /// adesso. `reset` è un documento nuovo: si parte dal foglio attivo nel
  /// file, in alto a sinistra; altrimenti foglio, selezione e scorrimento
  /// restano dove sono. L'apertura va in coda alle modifiche già partite, e
  /// quelle scritte mentre si apre partono dopo di lei.
  #openWorkbook(journal: string, reset: boolean): void {
    const epoch = ++this.#bytesEpoch;
    this.#journal = journal;
    this.#bytesOpening = true;
    this.#root.dataset.gridProfile = "workbook";
    // Una bozza aperta resta: la riapertura dopo un salvataggio, proprio o di
    // un altro riquadro, non la butta. Se la sua cella è cambiata sotto, si
    // chiede quale tenere (`#checkDraft`). Un documento nuovo la chiude.
    if (reset) this.#finishEditing(false, "input", false);
    if (reset) {
      this.#undo = [];
      this.#redo = [];
    }
    this.#enqueueProtocol(() => this.#openBytes(journal, reset, epoch));
  }

  async #openBytes(journal: string, reset: boolean, epoch: number): Promise<void> {
    if (this.#destroyed || epoch !== this.#bytesEpoch) return;
    const host = this.#options.grid;
    const doc = this.#options.documentId;
    const base = this.#currentBase();
    this.#closeBytes();
    let opened: { readonly surface: string; readonly instance: string } | null = null;
    try {
      const surface = host && doc && base
        ? (await host.listGridSurfaces()).find((candidate) =>
          candidate.family === "grid"
          && candidate.protocol_version === GRID_BYTES_PROTOCOL_VERSION
          && candidate.format === this.#options.formatId)
        : undefined;
      if (!host || !doc || !base || !surface) {
        if (!this.#destroyed && epoch === this.#bytesEpoch) this.#openFailed(journal, t("grid.workbook.unavailable"));
        return;
      }
      const session = await host.openGridBytes(surface.id, doc, journal, base);
      opened = { surface: surface.id, instance: session.instance };
      validateBytesSession(session);
      if (this.#destroyed || epoch !== this.#bytesEpoch) return;
      const hidden = new Set(session.hidden);
      const kept = reset ? undefined : this.#workbook?.sheets[this.#sheetIndex]?.id;
      const visible = session.sheets.filter((sheet) => !hidden.has(sheet.id));
      const sheet = visible.find((candidate) => candidate.id === kept)
        ?? visible.find((candidate) => candidate.id === session.active)
        ?? visible[0];
      const top = sheet.id !== kept;
      if (top) {
        this.#viewport.scrollTop = 0;
        this.#viewport.scrollLeft = 0;
      }
      const state: BytesState = { surface: surface.id, instance: session.instance, session };
      const windows = await this.#readBytesWindows(state, sheet.id, !top, []);
      if (this.#destroyed || epoch !== this.#bytesEpoch) return;
      this.#confirm(journal);
      opened = null;
      this.#bytes = state;
      this.#shownSession = session;
      this.#windows = windows;
      this.#bytesBase = base;
      this.#pendingCommandMode = 0;
      this.#commands = session.commands;
      this.#options.onCommands?.();
      this.#bytesConflicts = session.conflicts.length;
      this.#bytesMessage = null;
      this.#root.dataset.gridProtocol = "v2";
      this.#showView(sheet.id, top);
      this.#checkDraft(top);
      this.#followMedia();
    } catch (error) {
      if (this.#destroyed || epoch !== this.#bytesEpoch) return;
      this.#openFailed(journal, isErrorKind(error, "conflict")
        ? t("grid.workbook.changed")
        : t("grid.workbook.open_failed", { error: errorText(error) }));
    } finally {
      if (opened && host) void host.closeGridBytes(opened.surface, opened.instance).catch(() => {});
      if (epoch === this.#bytesEpoch) this.#bytesOpening = false;
    }
  }

  #openFailed(journal: string, message: string): void {
    this.#bytesMessage = message;
    this.#commands = [];
    this.#options.onCommands?.();
    this.#root.dataset.gridProtocol = "unavailable";
    // Una modifica scritta mentre si apriva non ha chi la controlli: il
    // giornale torna quello aperto.
    this.#publishJournal(journal, "input");
    this.#undo = [];
    this.#redo = [];
    this.#showNotice();
  }

  #closeBytes(): void {
    const state = this.#bytes;
    this.#bytes = null;
    if (state && this.#options.grid) void this.#options.grid.closeGridBytes(state.surface, state.instance).catch(() => {});
  }

  #publishJournal(text: string, origin: EditorChangeOrigin): void {
    const published = this.#journal;
    if (text === published) return;
    this.#journal = text;
    this.#options.onChange({ text, operation: operationFromText(published, text), origin });
  }

  /// Le finestre del foglio `sheetId` che lo schermo mostra e che `kept` non
  /// ha già alla revisione della sessione. `layout` usa le misure del foglio
  /// mostrato, che è quello.
  async #readBytesWindows(
    state: BytesState,
    sheetId: string,
    layout: boolean,
    kept: readonly GridBytesWindow[],
  ): Promise<GridBytesWindow[]> {
    const host = this.#options.grid;
    const session = state.session;
    const sheet = session.sheets.find((candidate) => candidate.id === sheetId);
    if (!host || !sheet) return [];
    const none: AxisLayout = { offsets: [], sizes: [], total: 0 };
    const frame = layout ? this.#frame : null;
    const zoom = frame?.zoom ?? 1;
    const rowRange = viewportRange(
      sheet.row_count,
      layout ? this.#rows : none,
      this.#viewport.scrollTop,
      this.#viewport.clientHeight,
      frame?.columnHeader ?? COLUMN_HEADER_HEIGHT,
      DEFAULT_ROW_HEIGHT * zoom,
    );
    const columnRange = viewportRange(
      sheet.column_count,
      layout ? this.#columns : none,
      this.#viewport.scrollLeft,
      this.#viewport.clientWidth,
      frame?.rowHeader ?? ROW_HEADER_WIDTH,
      DEFAULT_COLUMN_WIDTH * zoom,
    );
    if (!rowRange || !columnRange) return [];
    // I blocchi dello schermo, e quelli delle righe e colonne bloccate, che
    // si vedono anche quando lo schermo è lontano.
    const blocks = (range: { start: number; end: number }, frozen: number, size: number): number[] => {
      const out = new Set<number>();
      for (let start = 0; start < frozen; start += size) out.add(start);
      for (let start = Math.floor(range.start / size) * size; start <= range.end; start += size) out.add(start);
      return [...out].sort((left, right) => left - right);
    };
    const requests: GridWindowRequest[] = [];
    for (const row of blocks(rowRange, frame?.frozenRows ?? 0, GRID_WINDOW_ROWS)) {
      for (const column of blocks(columnRange, frame?.frozenColumns ?? 0, GRID_WINDOW_COLUMNS)) {
        if (kept.some((window) =>
          window.revision === session.revision
          && window.sheet === sheet.id
          && window.row_start === row
          && window.column_start === column)) continue;
        requests.push({
          revision: session.revision,
          sheet: sheet.id,
          row_start: row,
          row_count: Math.min(GRID_WINDOW_ROWS, sheet.row_count - row),
          column_start: column,
          column_count: Math.min(GRID_WINDOW_COLUMNS, sheet.column_count - column),
          known_media: this.#media.known(),
        });
      }
    }
    if (requests.length > MAX_GRID_SESSION_WINDOWS) throw new Error("grid viewport requests exceed limit");
    return Promise.all(requests.map(async (request) => {
      const window = await host.gridBytesWindow(state.surface, state.instance, request);
      validateBytesWindow(window, session);
      if (this.#media.remember(window.objects)) this.#mediaAdded = true;
      return window;
    }));
  }

  /// Ridisegna la cartella dalla sessione mostrata e dalle finestre lette.
  #showView(sheetId: string, top: boolean): void {
    const session = this.#shownSession;
    if (!session) return;
    const view = workbookView(session, this.#windows, this.#view);
    this.#view = view;
    this.#workbook = view.workbook;
    const index = view.workbook.sheets.findIndex((sheet) => sheet.id === sheetId);
    this.#sheetIndex = index >= 0 ? index : view.active;
    if (top) {
      this.#selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
      this.#others = [];
    }
    this.#showNotice();
    this.#showSheetTabs();
    this.#showSheet(top);
    this.#options.onView?.();
  }

  #loadViewport(): Promise<void> {
    const state = this.#bytes;
    if (!state || this.#destroyed) return Promise.resolve();
    if (this.#viewportLoad) {
      this.#viewportLoadQueued = true;
      return this.#viewportLoad;
    }
    const epoch = this.#bytesEpoch;
    const sheetId = this.#sheet().id;
    const revision = state.session.revision;
    const current = () => !this.#destroyed && epoch === this.#bytesEpoch && this.#bytes === state && state.session.revision === revision;
    const load = (async () => {
      try {
        const fresh = await this.#readBytesWindows(state, sheetId, true, this.#windows);
        // Una modifica confermata nel frattempo rilegge lo schermo da sé.
        if (!current() || !fresh.length) return;
        this.#windows = keptWindows(this.#windows, fresh, revision);
        this.#showView(this.#sheet().id, false);
        this.#followMedia();
      } catch (error) {
        if (!current()) return;
        this.#refuse(t("grid.workbook.read_failed", { error: errorText(error) }));
      }
    })().finally(() => {
      this.#viewportLoad = null;
      if (this.#viewportLoadQueued) {
        this.#viewportLoadQueued = false;
        void this.#loadViewport();
      }
    });
    this.#viewportLoad = load;
    return load;
  }

  /// Rilegge lo schermo dopo una modifica confermata, o dopo una rifiutata.
  async #refreshBytes(state: BytesState, epoch: number): Promise<void> {
    const revision = state.session.revision;
    try {
      const fresh = await this.#readBytesWindows(state, this.#sheet().id, true, []);
      if (this.#destroyed || epoch !== this.#bytesEpoch || this.#bytes !== state || state.session.revision !== revision) return;
      this.#windows = keptWindows(this.#windows, fresh, revision);
      this.#showView(this.#sheet().id, false);
      this.#followMedia();
    } catch (error) {
      if (this.#destroyed || epoch !== this.#bytesEpoch || this.#bytes !== state || state.session.revision !== revision) return;
      this.#refuse(t("grid.workbook.read_failed", { error: errorText(error) }));
    }
  }

  /// Una finestra a cui l'host non ha dato i byte di un'immagine, perché
  /// non ci stavano, si richiede: adesso la shell ha le immagini delle altre,
  /// e l'host le salta. Soltanto dopo una lettura che ne ha portate di
  /// nuove, così la richiesta finisce.
  #followMedia(): void {
    const added = this.#mediaAdded;
    this.#mediaAdded = false;
    if (!added) return;
    const sheet = this.#sheet().id;
    const short = this.#windows.filter((window) => window.sheet === sheet && this.#media.missing(window.objects));
    if (!short.length) return;
    this.#windows = this.#windows.filter((window) => !short.includes(window));
    void this.#loadViewport();
  }

  #refuse(message: string): void {
    this.#bytesMessage = message;
    this.#showNotice();
  }

  /// La finestra letta che contiene `position` del foglio mostrato.
  #windowAt(position: GridPosition): GridBytesWindow | undefined {
    const sheet = this.#sheet().id;
    return this.#windows.find((window) =>
      window.sheet === sheet
      && position.row >= window.row_start
      && position.row < window.row_start + window.rows.length
      && position.column >= window.column_start
      && position.column < window.column_start + window.columns.length);
  }

  /// Ogni cella dell'intervallo è in una finestra letta: le finestre si
  /// chiedono allineate, e basta guardare i loro angoli.
  #rangeRead(range: ReturnType<typeof normalizedSelection>): boolean {
    const sheet = this.#sheet().id;
    for (let row = Math.floor(range.rowStart / GRID_WINDOW_ROWS) * GRID_WINDOW_ROWS; row <= range.rowEnd; row += GRID_WINDOW_ROWS) {
      for (let column = Math.floor(range.columnStart / GRID_WINDOW_COLUMNS) * GRID_WINDOW_COLUMNS; column <= range.columnEnd; column += GRID_WINDOW_COLUMNS) {
        if (!this.#windows.some((window) => window.sheet === sheet && window.row_start === row && window.column_start === column)) return false;
      }
    }
    return true;
  }

  /// Perché la cella in `position` non si scrive, o `null`.
  #writeRefusal(position: GridPosition): string | null {
    if (!this.#view || (!this.#bytes && !this.#bytesOpening)) return t("grid.workbook.unavailable");
    if (!this.#windowAt(position)) return t("grid.workbook.not_loaded");
    const lock = this.#workbookCell(position)?.bytes.lock;
    return lock ? t("grid.workbook.locked", { reason: t(LOCK_KEYS[lock] ?? "grid.workbook.lock.other") }) : null;
  }

  /// La cella come la griglia la mostra finché il provider non la rilegge.
  #showWritten(position: GridPosition, input: string): void {
    const window = this.#windowAt(position);
    const key = coordinateAt(this.#sheet(), position);
    if (!window || !key) return;
    const same = (cell: GridBytesCell) => cell.key.row === key.row && cell.key.column === key.column;
    const previous = window.cells.find(same);
    const display = input.startsWith("'") ? input.slice(1) : localInput(input, this.#decimal);
    // Una cella nuova prende lo stile di serie, che la finestra può non avere.
    let style = previous?.style;
    if (style === undefined) {
      style = window.styles.length;
      window.styles = [...window.styles, PLAIN_STYLE];
    }
    window.cells = [...window.cells.filter((cell) => !same(cell)), {
      key: { sheet: key.sheet, row: key.row, column: key.column },
      input,
      style,
      value: input ? { kind: "text", value: display } : { kind: "blank" },
      display,
      lock: null,
      stale: false,
      conflict: false,
      data_bar: null,
      icon: null,
      comment: null,
      link: null,
    }];
  }

  /// Scrive le celle nel giornale. La sessione del documento lo riceve
  /// subito, come i commit del foglio di Fub; il provider lo controlla dopo,
  /// in coda, e la sua risposta corregge il giornale e la history.
  #commitCells(writes: readonly CellWrite[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    if (!this.#view || this.#readOnly || !writes.length) return false;
    // Scrivere toglie le formiche di un taglio e ciò che si è copiato, come
    // nei fogli di calcolo.
    this.#cutMark = null;
    this.#copied = null;
    let journal: GridJournal;
    try {
      journal = parseGridJournal(this.#journal);
    } catch {
      this.#refuse(t("grid.workbook.journal_invalid"));
      return false;
    }
    const sheet = this.#sheet();
    const request: GridRequestPatch[] = [];
    const history: GridCellPatch[] = [];
    const disks: string[] = [];
    const written: CellWrite[] = [];
    // Su una sessione a comandi il giornale lo scrive il provider: la griglia
    // mostra subito le celle e pubblica il giornale che lui conferma.
    let commanding = this.#commandMode();
    for (const write of writes) {
      const refusal = this.#writeRefusal(write.position);
      if (refusal) {
        this.#refuse(refusal);
        return false;
      }
      const coordinate = coordinateAt(sheet, write.position)!;
      const current = this.#workbookCell(write.position)?.bytes.input ?? "";
      if (write.after === current) continue;
      const entry = commanding ? undefined : gridJournalEntry(journal, coordinate);
      // Una formula entra come comando, dove la sessione ne serve; altrimenti
      // si riscrive soltanto per tornare a quella del file.
      if (write.after.startsWith("=") && (commanding || entry?.before !== write.after)) {
        if (!this.#serves(SET_VALUES)) {
          this.#refuse(t("grid.workbook.formula"));
          return false;
        }
        commanding = true;
      }
      if (!commanding) {
        try {
          journal = recordGridJournal(journal, coordinate, current, write.after);
        } catch {
          this.#refuse(t("grid.workbook.too_many"));
          return false;
        }
      }
      request.push({ cell: { ...coordinate }, before: current, after: write.after });
      history.push({ coordinate, before: { input: current }, after: { input: write.after } });
      disks.push(entry?.before ?? current);
      written.push(write);
    }
    if (!request.length) return false;
    for (const write of written) this.#showWritten(write.position, write.after);
    if (commanding) {
      // Annulla e ripeti sono del documento, cioè del provider.
      this.#undo = [];
      this.#redo = [];
      this.#pendingCommandMode += 1;
    } else if (recordHistory) {
      this.#undo.push(history);
      this.#redo = [];
    }
    this.#bytesMessage = null;
    this.#showView(sheet.id, false);
    if (!commanding) this.#publishJournal(gridJournalText(journal), origin);
    const epoch = this.#bytesEpoch;
    const edits = this.#editEpoch;
    const ticket = ++this.#bytesTickets;
    this.#enqueueProtocol(() => this.#applyBytes(request, history, disks, origin, epoch, edits, ticket, commanding));
    return true;
  }

  /// Se la sessione è a comandi, o lo sarà quando la coda arriva al provider.
  #commandMode(): boolean {
    return this.#confirmedCommands || this.#pendingCommandMode > 0;
  }

  /// Se il catalogo serve il comando `id`.
  #serves(id: string): boolean {
    return this.#commands.some((command) => command.id === id);
  }

  /// Il giornale confermato è `text`.
  #confirm(text: string): GridJournal {
    const journal = parseGridJournal(text);
    this.#confirmedJournal = text;
    this.#confirmedCommands = journal.commands.length > 0;
    return journal;
  }

  async #applyBytes(
    patches: GridRequestPatch[],
    history: GridCellPatch[],
    disks: readonly string[],
    origin: EditorChangeOrigin,
    epoch: number,
    edits: number,
    ticket: number,
    commanding: boolean,
  ): Promise<void> {
    try {
      await this.#applyBytesNow(patches, history, disks, origin, epoch, edits, ticket, commanding);
    } finally {
      if (commanding && epoch === this.#bytesEpoch) this.#pendingCommandMode = Math.max(0, this.#pendingCommandMode - 1);
    }
  }

  async #applyBytesNow(
    patches: GridRequestPatch[],
    history: GridCellPatch[],
    disks: readonly string[],
    origin: EditorChangeOrigin,
    epoch: number,
    edits: number,
    ticket: number,
    commanding: boolean,
  ): Promise<void> {
    const host = this.#options.grid;
    const state = this.#bytes;
    const current = () => !this.#destroyed && epoch === this.#bytesEpoch && edits === this.#editEpoch && this.#bytes === state;
    // Senza sessione l'apertura è fallita, e ha già riportato il giornale.
    if (!host || !state || !current()) return;
    let confirmed: GridJournal;
    try {
      const commit = await host.applyGridBytes(state.surface, state.instance, { revision: state.session.revision, patches });
      if (!current()) return;
      confirmed = this.#confirm(applySourceEdit(this.#confirmedJournal, commit.edit));
      state.session = { ...state.session, revision: commit.revision };
    } catch (error) {
      if (!current()) return;
      // Le modifiche in coda partivano da questa: non entrano neanche loro.
      this.#editEpoch++;
      // Una cella che il provider dice bloccata lo era in una finestra che la
      // shell non aveva ancora riletto: lo dice come il blocco che si vede.
      this.#bytesMessage = isErrorKind(error, "permission_denied")
        ? t("grid.workbook.locked", { reason: t("grid.workbook.lock.other") })
        : t("grid.workbook.apply_failed", { error: errorText(error) });
      this.#publishJournal(this.#confirmedJournal, origin);
      this.#undo = [];
      this.#redo = [];
      this.#windows = [];
      this.#showNotice();
      await this.#refreshBytes(state, epoch);
      return;
    }
    // La history tiene l'input che il provider ha scritto (`0.250` è `0.25`):
    // annullare parte da quello.
    if (!commanding) {
      history.forEach((patch, index) => {
        history[index] = { ...patch, after: { input: gridJournalEntry(confirmed, patch.coordinate)?.after ?? disks[index] } };
      });
    }
    // Il giornale ottimistico si corregge soltanto quando non resta niente in
    // coda: prima, la conferma non contiene ancora le modifiche che seguono.
    if (ticket === this.#bytesTickets) this.#publishJournal(this.#confirmedJournal, origin);
    await this.#refreshBytes(state, epoch);
  }

  #showNotice(): void {
    const lines: string[] = [];
    const parts: string[] = [];
    let other = false;
    for (const notice of this.#view?.notices ?? []) {
      const part = NOT_SHOWN_KEYS[notice.code];
      if (part) {
        parts.push(t(part));
        continue;
      }
      switch (notice.code) {
        case "macros": lines.push(t("grid.workbook.macros")); break;
        case "external-links": lines.push(t("grid.workbook.external_links")); break;
        case "uncomputed": lines.push(t("grid.workbook.uncomputed")); break;
        case "incomplete": lines.push(plural(notice.count, "grid.workbook.incomplete_one", "grid.workbook.incomplete")); break;
        default: other = true;
      }
    }
    if (parts.length) {
      const list = new Intl.ListFormat(resolvedLanguage(), { type: "conjunction" }).format(parts);
      lines.push(t("grid.workbook.not_shown", { parts: list }));
    }
    if (other) lines.push(t("grid.workbook.notice_other"));
    if (this.#bytesConflicts) lines.push(plural(this.#bytesConflicts, "grid.workbook.conflicts_one", "grid.workbook.conflicts"));
    if (this.#view?.sheets.some((sheet) => [...sheet.cells.values()].some((cell) => cell.bytes.stale))) {
      lines.push(t("grid.workbook.stale"));
    }
    if (this.#bytesMessage) lines.push(this.#bytesMessage);
    this.#notice.textContent = lines.join(" ");
    this.#notice.hidden = lines.length === 0;
  }

  /// Ridisegna il foglio `#sheetIndex`; `top` lo riporta in cima.
  #showSheet(top: boolean): void {
    this.#selection = this.#clampedSelection(this.#selection);
    this.#rebuildLayout();
    this.#selection = this.#visibleSelection(this.#selection);
    if (top) {
      this.#viewport.scrollTop = 0;
      this.#viewport.scrollLeft = 0;
    }
    if (!this.#editing) this.#syncFormulaBar();
    this.#render();
  }

  /// Le schede dei fogli, quando ce n'è più di uno da mostrare. Si rifanno
  /// soltanto se i fogli cambiano.
  #showSheetTabs(): void {
    const sheets = this.#workbook?.sheets ?? [];
    const names = JSON.stringify(sheets.map((sheet) => [sheet.id, sheet.name]));
    if (sheets.length < 2) {
      this.#sheetTabs?.lifetime.close();
      this.#sheetTabs = null;
      this.#sheetBar.replaceChildren();
      this.#sheetBar.hidden = true;
      return;
    }
    const selected = sheets[this.#sheetIndex]?.id;
    if (this.#sheetTabs?.names === names) {
      if (selected !== undefined) this.#sheetTabs.handle.select(selected);
      return;
    }
    this.#sheetTabs?.lifetime.close();
    const lifetime = openLifetime();
    const tablist = document.createElement("div");
    this.#sheetBar.replaceChildren(tablist);
    this.#sheetBar.hidden = false;
    const handle = createTabs({
      tablist,
      tabs: sheets.map((sheet) => ({ id: sheet.id, label: sheet.name })),
      selected,
      label: t("grid.workbook.sheets"),
      lifetime,
      onSelect: (id) => {
        const index = this.#workbook?.sheets.findIndex((sheet) => sheet.id === id) ?? -1;
        if (index >= 0) this.#showSheetAt(index);
      },
    });
    lifetime.add(() => tablist.remove());
    this.#sheetTabs = { handle, names, lifetime };
  }

  /// La vista del foglio mostrato, come l'ultima finestra letta la dà.
  #sheetView(): GridSheetView {
    return this.#view?.sheets[this.#sheetIndex]?.view ?? DEFAULT_SHEET_VIEW;
  }

  /// Le unioni lette del foglio mostrato.
  #merges(): readonly GridMerge[] {
    return this.#view?.sheets[this.#sheetIndex]?.merges ?? [];
  }

  /// Mostra il foglio `index`, dalla sua prima cella.
  #showSheetAt(index: number): void {
    if (index === this.#sheetIndex) return;
    this.#finishEditing(false, "input", false);
    this.#finishObjectText(false);
    this.#selectedObject = null;
    this.#sheetIndex = index;
    this.#selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
    this.#others = [];
    this.#adding = false;
    this.#showSheet(true);
    this.#sheetTabs?.handle.select(this.#sheet().id);
    void this.#loadViewport();
    this.#selectionChanged();
  }

  #selectionChanged(): void {
    this.#options.onSelectionChange();
    void this.#loadCommands();
  }

  #rebuildLayout(): void {
    const sheet = this.#sheet();
    const view = this.#sheetView();
    const zoom = view.zoom / 100;
    this.#rows = axisLayout(sheet.rows, DEFAULT_ROW_HEIGHT, "height", zoom);
    this.#columns = axisLayout(sheet.columns, DEFAULT_COLUMN_WIDTH, "width", zoom);
    const frozenRows = Math.min(view.frozen_rows, this.#rows.sizes.length);
    const frozenColumns = Math.min(view.frozen_columns, this.#columns.sizes.length);
    this.#frame = {
      view,
      zoom,
      rowHeader: view.headings ? Math.round(ROW_HEADER_WIDTH * zoom) : 0,
      columnHeader: view.headings ? Math.round(COLUMN_HEADER_HEIGHT * zoom) : 0,
      frozenRows,
      frozenColumns,
      frozenHeight: this.#rows.offsets[frozenRows] ?? 0,
      frozenWidth: this.#columns.offsets[frozenColumns] ?? 0,
    };
    this.#canvas.style.width = `${this.#frame.rowHeader + this.#columns.total}px`;
    this.#canvas.style.height = `${this.#frame.columnHeader + this.#rows.total}px`;
    this.#canvas.style.fontSize = zoom === 1 ? "" : `${(zoom * 100).toFixed(1)}%`;
    this.#viewport.classList.toggle("no-gridlines", !view.gridlines);
    this.#viewport.setAttribute("aria-rowcount", String(sheet.rows.length + 1));
    this.#viewport.setAttribute("aria-colcount", String(sheet.columns.length + 1));
  }

  /// La famiglia di caratteri della griglia, letta una volta.
  #gridFont(): string {
    this.#fallbackFont ??= getComputedStyle(this.#viewport).fontFamily ?? "";
    return this.#fallbackFont;
  }

  /// Le righe (o le colonne) da disegnare: quelle bloccate, quelle dello
  /// schermo e quella della cella che si scrive.
  #renderedIndices(layout: AxisLayout, frozen: number, frozenSize: number, scroll: number, extent: number, editing: number | null): number[] {
    const window = boundedWindow(layout, scroll + frozenSize, Math.max(0, extent - frozenSize));
    const out: number[] = [];
    for (let index = 0; index < frozen; index += 1) out.push(index);
    for (let index = Math.max(frozen, window.start); index <= window.end; index += 1) out.push(index);
    if (editing !== null && editing >= 0 && editing < layout.sizes.length && !out.includes(editing)) {
      out.push(editing);
      out.sort((left, right) => left - right);
    }
    return out;
  }

  /// La sinistra di una colonna nel canvas: una colonna bloccata resta ferma.
  #columnLeft(column: number): number {
    const left = this.#frame.rowHeader + this.#columns.offsets[column];
    return column < this.#frame.frozenColumns ? left + this.#viewport.scrollLeft : left;
  }

  #render(): void {
    if (!this.#workbook) return;
    const frame = this.#frame;
    const scrollTop = this.#viewport.scrollTop;
    const scrollLeft = this.#viewport.scrollLeft;
    const editingPosition = this.#editing?.owner === "cell" ? this.#editing.position : null;
    const renderedRows = this.#renderedIndices(
      this.#rows, frame.frozenRows, frame.frozenHeight, scrollTop,
      this.#viewport.clientHeight - frame.columnHeader, editingPosition?.row ?? null,
    );
    const renderedColumns = this.#renderedIndices(
      this.#columns, frame.frozenColumns, frame.frozenWidth, scrollLeft,
      this.#viewport.clientWidth - frame.rowHeader, editingPosition?.column ?? null,
    );
    const range = this.#selectedRange();
    const merges = this.#merges();
    const firstRow = renderedRows[0] ?? 0;
    const lastRow = renderedRows[renderedRows.length - 1] ?? -1;
    const firstColumn = renderedColumns[0] ?? 0;
    const lastColumn = renderedColumns[renderedColumns.length - 1] ?? -1;
    // Le unioni sullo schermo: ognuna si disegna una volta, nella prima riga
    // disegnata che copre, e le celle che copre non si disegnano.
    const visibleMerges = mergesIn(merges, { rowStart: firstRow, rowEnd: lastRow, columnStart: firstColumn, columnEnd: lastColumn });
    const covered = new Set<number>();
    const anchorsByRow = new Map<number, GridMerge[]>();
    for (const merge of visibleMerges) {
      for (let row = Math.max(merge.row, firstRow); row <= Math.min(merge.row + merge.rows - 1, lastRow); row += 1) {
        for (let column = Math.max(merge.column, firstColumn); column <= Math.min(merge.column + merge.columns - 1, lastColumn); column += 1) {
          covered.add(cellKey({ row, column }));
        }
      }
      const host = renderedRows.find((row) => row >= merge.row && this.#rows.sizes[row] > 0);
      if (host !== undefined && host < merge.row + merge.rows) {
        anchorsByRow.set(host, [...(anchorsByRow.get(host) ?? []), merge]);
      }
    }
    const rows: HTMLElement[] = [];
    const measures: HTMLElement[] = [];

    if (frame.columnHeader > 0) rows.push(this.#columnHeaders(renderedColumns, range));
    for (const row of renderedRows) {
      if (this.#rows.sizes[row] === 0) continue;
      const frozen = row < frame.frozenRows;
      const rowElement = document.createElement("div");
      rowElement.className = frozen ? "grid-row frozen" : "grid-row";
      rowElement.dataset.row = String(row);
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", String(row + 2));
      // Una riga bloccata sta ferma da sé (`#stick`), le altre scorrono.
      if (frozen) {
        this.#stick(rowElement, frame.columnHeader + this.#rows.offsets[row], frame.rowHeader + this.#columns.total, this.#rows.sizes[row]);
      } else {
        this.#place(rowElement, 0, frame.columnHeader + this.#rows.offsets[row], frame.rowHeader + this.#columns.total, this.#rows.sizes[row]);
      }
      if (frame.rowHeader > 0) {
        const header = document.createElement("div");
        header.className = "grid-header grid-row-header";
        if ([range, ...this.#others].some((area) => row >= area.rowStart && row <= area.rowEnd)) header.classList.add("selected");
        if (row > 0 && this.#rows.sizes[row - 1] === 0) header.classList.add("after-hidden");
        header.setAttribute("role", "rowheader");
        header.setAttribute("aria-rowindex", String(row + 2));
        header.setAttribute("aria-colindex", "1");
        header.textContent = String(row + 1);
        header.style.pointerEvents = "none";
        if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
        this.#stickLeft(header, frame.rowHeader, this.#rows.sizes[row]);
        rowElement.append(header);
      }
      const borders: HTMLElement[] = [];
      for (const column of renderedColumns) {
        if (this.#columns.sizes[column] === 0 || covered.has(cellKey({ row, column }))) continue;
        const element = this.#cellElement({ row, column }, range, null, row);
        if (!element) continue;
        rowElement.append(element.cell);
        if (element.border) borders.push(element.border);
        if (element.measure) measures.push(element.cell);
      }
      for (const merge of anchorsByRow.get(row) ?? []) {
        const element = this.#cellElement({ row: merge.row, column: merge.column }, range, merge, row);
        if (!element) continue;
        rowElement.append(element.cell);
        if (element.border) borders.push(element.border);
      }
      rowElement.append(...borders);
      rows.push(rowElement);
    }
    rows.push(...this.#objectElements());
    rows.push(...this.#freezeLines());
    rows.push(...this.#selectionMarks(range));
    rows.push(...this.#fillMarks(range));
    rows.push(...this.#cutMarks());
    rows.push(...this.#resizeMarks());
    rows.push(...this.#moveMarks());
    rows.push(...this.#referenceMarks());
    this.#viewport.classList.toggle("filling", this.#drag?.kind === "fill");
    this.#viewport.classList.toggle("moving", this.#drag?.kind === "move");
    this.#viewport.classList.toggle("ranged", !this.#lone(range) || this.#others.length > 0);

    // Ciò che non cambia resta: la cella sotto il puntatore riceve il clic e
    // il doppio clic, e l'editor aperto non perde il fuoco.
    const focused = this.#cellEditorHost.contains(document.activeElement);
    const drawn = [...this.#viewport.children].filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element.matches(DRAWN));
    // Tutto va prima del canvas: ciò che sta fermo da sé è nel flusso, e
    // davanti al canvas la sua posizione naturale è in cima, dove `sticky`
    // lo tiene.
    this.#reconcile(this.#viewport, drawn, rows, this.#canvas);
    this.#fitCells(measures.filter((cell) => cell.isConnected));
    const editing = this.#editing?.owner === "cell" ? this.#editing : null;
    if (editing) {
      const cell = this.#findCell(editing.position);
      if (cell && this.#isVisiblePosition(editing.position)) {
        if (this.#cellEditorHost.parentElement !== cell) {
          cell.append(this.#cellEditorHost);
          if (focused) this.#cellEditor.focus();
        }
        this.#cellEditorHost.hidden = false;
        this.#cellEditorHost.removeAttribute("aria-hidden");
        this.#positionEditor(editing.position);
      } else {
        this.#editing = null;
        this.#cellEditorHost.hidden = true;
        this.#cellEditorHost.setAttribute("aria-hidden", "true");
        this.#canvas.append(this.#cellEditorHost);
      }
    }
    const active = this.#active();
    if (this.#isVisiblePosition(active) && this.#findCell(active)) {
      this.#viewport.setAttribute("aria-activedescendant", this.#cellId(active));
    } else {
      this.#viewport.removeAttribute("aria-activedescendant");
    }
    const name = this.#root.querySelector<HTMLElement>(".grid-cell-name");
    if (name) {
      name.textContent = this.#isVisiblePosition(active) ? cellA1(active) : "";
    }
  }

  /// Mette in `parent` gli elementi `fresh`, nell'ordine, al posto dei
  /// `drawn`. Un elemento disegnato uguale a quello nuovo resta dov'è: una
  /// riga con la stessa chiave prende gli attributi nuovi e si riconcilia
  /// dentro, una cella uguale (`#drawn`) prende soltanto la selezione, il
  /// resto si confronta per intero. Gli oggetti si rifanno sempre.
  #reconcile(parent: HTMLElement, drawn: readonly HTMLElement[], fresh: readonly HTMLElement[], end: ChildNode | null = null): void {
    const key = (element: HTMLElement): string | null => {
      if (element.classList.contains("grid-object")) return null;
      if (element.classList.contains("grid-cell")) return `cell:${element.dataset.row}:${element.dataset.column}`;
      if (element.classList.contains("grid-column-header-row")) return "headers";
      if (element.classList.contains("grid-row")) return `row:${element.dataset.row}`;
      return `html:${element.outerHTML}`;
    };
    const old = new Map<string, HTMLElement>();
    for (const element of drawn) {
      const name = key(element);
      if (name !== null && !old.has(name)) old.set(name, element);
    }
    const kept = new Set<HTMLElement>();
    const placed = fresh.map((element) => {
      const name = key(element);
      const before = name === null ? undefined : old.get(name);
      if (!before) return element;
      if (element.classList.contains("grid-cell")) {
        if (this.#drawn.get(before) !== this.#drawn.get(element)) return element;
        before.className = element.className;
        before.setAttribute("aria-selected", element.getAttribute("aria-selected") ?? "false");
      } else if (element.classList.contains("grid-row")) {
        syncAttributes(before, element);
        this.#reconcile(before, [...before.children] as HTMLElement[], [...element.children] as HTMLElement[]);
      }
      old.delete(name!);
      kept.add(before);
      return before;
    });
    for (const element of drawn) if (!kept.has(element)) element.remove();
    // Dal fondo: un elemento già al suo posto non si muove.
    let next: ChildNode | null = end;
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const element = placed[index];
      if (element.parentNode !== parent || element.nextSibling !== next) parent.insertBefore(element, next);
      next = element;
    }
  }

  /// Se la selezione è la sola cella attiva, o l'unione che la contiene.
  #lone(range: GridRange): boolean {
    const active = this.#active();
    const merge = mergeAt(this.#merges(), active);
    const cell = merge
      ? { rowStart: merge.row, rowEnd: merge.row + merge.rows - 1, columnStart: merge.column, columnEnd: merge.column + merge.columns - 1 }
      : { rowStart: active.row, rowEnd: active.row, columnStart: active.column, columnEnd: active.column };
    return sameRange(range, cell);
  }

  /// Il rettangolo dell'intervallo scelto, uno solo e non cella per cella:
  /// con una cella sola il bordo è quello della cella attiva, su un taglio
  /// sono le formiche.
  #selectionMarks(range: GridRange): HTMLElement[] {
    const marks = this.#others.flatMap((area) => this.#rangeMark(area));
    if (this.#lone(range) && !marks.length) return [];
    // Sulle formiche di un taglio il bordo pieno le coprirebbe.
    const cut = this.#cutMark;
    if (cut && cut.sheet === this.#sheet().id && sameRange(cut.range, range)) return marks;
    return [...marks, ...this.#rangeMark(range)];
  }

  #rangeMark(range: GridRange): HTMLElement[] {
    const box = this.#rangeBox(range);
    if (!box) return [];
    const element = document.createElement("div");
    element.className = "grid-selection";
    element.setAttribute("aria-hidden", "true");
    this.#place(element, box.left, box.top, box.width, box.height);
    return [element];
  }

  /// Il quadratino di riempimento all'angolo della selezione e, mentre lo si
  /// tira, il contorno di ciò che riempirà. Sono gesti del puntatore: dalla
  /// tastiera gli stessi riempimenti sono Ctrl+D, Ctrl+R e Serie.
  #fillMarks(range: GridRange): HTMLElement[] {
    if (!this.#fillServed()) return [];
    const drag = this.#drag?.kind === "fill" ? this.#drag : null;
    const marks: HTMLElement[] = [];
    if (drag && !sameRange(drag.source, drag.target)) {
      const box = this.#rangeBox(drag.target);
      if (box) {
        const preview = document.createElement("div");
        preview.className = "grid-fill-preview";
        preview.setAttribute("aria-hidden", "true");
        this.#place(preview, box.left, box.top, box.width, box.height);
        marks.push(preview);
      }
    }
    const box = this.#rangeBox(drag?.target ?? range);
    if (box) {
      const handle = document.createElement("div");
      handle.className = "grid-fill-handle";
      handle.setAttribute("aria-hidden", "true");
      handle.title = t("grid.fill.handle");
      this.#place(handle, box.left + box.width - 4, box.top + box.height - 4, 8, 8);
      marks.push(handle);
    }
    return marks;
  }

  /// Mentre si tira il bordo di un'intestazione: la guida dove cadrà e la
  /// misura, nelle unità di Excel e in pixel del file.
  #resizeMarks(): HTMLElement[] {
    const resize = this.#resize;
    if (!resize) return [];
    const frame = this.#frame;
    const guide = document.createElement("div");
    guide.className = "grid-resize-guide";
    guide.setAttribute("aria-hidden", "true");
    const label = document.createElement("div");
    label.className = "grid-resize-label";
    label.setAttribute("aria-hidden", "true");
    const pixels = Math.round(resize.now / (WORKBOOK_SCALE * frame.zoom));
    const number = (value: number) => new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: 2 }).format(value);
    const left = this.#viewport.scrollLeft;
    const top = this.#viewport.scrollTop;
    if (resize.axis === "column") {
      const x = this.#columnLeft(resize.index) + resize.now;
      this.#place(guide, x - 1, top, 2, this.#viewport.clientHeight);
      label.textContent = t("grid.resize.width", { chars: number(pixelsToChars(pixels)), px: String(pixels) });
      label.style.position = "absolute";
      label.style.left = `${x + 6}px`;
      label.style.top = `${top + frame.columnHeader + 4}px`;
    } else {
      const offset = frame.columnHeader + this.#rows.offsets[resize.index] + (resize.index < frame.frozenRows ? top : 0);
      const y = offset + resize.now;
      this.#place(guide, left, y - 1, this.#viewport.clientWidth, 2);
      label.textContent = t("grid.resize.height", { points: number(pixels * 0.75), px: String(pixels) });
      label.style.position = "absolute";
      label.style.left = `${left + frame.rowHeader + 4}px`;
      label.style.top = `${y + 6}px`;
    }
    return [guide, label];
  }

  /// Il bordo fra due intestazioni sotto il punto, se si può misurare: un
  /// bordo è preso a `RESIZE_SLOP` pixel, e senza il comando servito non c'è.
  #resizeEdge(x: number, y: number): ResizeEdge | null {
    if (!this.commandable() || this.#editing || this.#selectedObject !== null) return null;
    const frame = this.#frame;
    const rect = this.#viewport.getBoundingClientRect();
    const px = x - rect.left - this.#viewport.clientLeft;
    const py = y - rect.top - this.#viewport.clientTop;
    const nearest = (point: number, header: number, frozen: number, scroll: number, layout: AxisLayout): number | null => {
      const inside = point - header;
      const offset = inside < frozen ? inside : inside + scroll;
      let best: number | null = null;
      let distance = RESIZE_SLOP + 1;
      for (let index = 0; index < layout.sizes.length; index += 1) {
        if (layout.sizes[index] === 0) continue;
        const gap = Math.abs(layout.offsets[index + 1] - offset);
        if (gap <= distance) {
          best = index;
          distance = gap;
        }
        if (layout.offsets[index] > offset + RESIZE_SLOP) break;
      }
      return best;
    };
    if (py >= 0 && py < frame.columnHeader && px >= frame.rowHeader && px < this.#viewport.clientWidth) {
      if (!this.#serves("home.columnWidth")) return null;
      const index = nearest(px, frame.rowHeader, frame.frozenWidth, this.#viewport.scrollLeft, this.#columns);
      return index === null ? null : { axis: "column", index };
    }
    if (px >= 0 && px < frame.rowHeader && py >= frame.columnHeader && py < this.#viewport.clientHeight) {
      if (!this.#serves("home.rowHeight")) return null;
      const index = nearest(py, frame.columnHeader, frame.frozenHeight, this.#viewport.scrollTop, this.#rows);
      return index === null ? null : { axis: "row", index };
    }
    return null;
  }

  /// Le linee che una misura tocca: tutte quelle scelte intere, se `index` è
  /// fra loro, come in Excel; altrimenti `index` sola. In A1 per GridCraft.
  #resizeLines(edge: ResizeEdge): string {
    const range = this.#selectedRange();
    const sheet = this.#sheet();
    if (edge.axis === "column") {
      const whole = range.rowStart === 0 && range.rowEnd >= sheet.rows.length - 1;
      const [a, b] = whole && edge.index >= range.columnStart && edge.index <= range.columnEnd
        ? [range.columnStart, range.columnEnd]
        : [edge.index, edge.index];
      return `${columnLabel(a)}:${columnLabel(b)}`;
    }
    const whole = range.columnStart === 0 && range.columnEnd >= sheet.columns.length - 1;
    const [a, b] = whole && edge.index >= range.rowStart && edge.index <= range.rowEnd
      ? [range.rowStart, range.rowEnd]
      : [edge.index, edge.index];
    return `${a + 1}:${b + 1}`;
  }

  #endResize(commit: boolean): void {
    const resize = this.#resize;
    if (!resize) return;
    this.#resize = null;
    this.#render();
    if (!commit || Math.round(resize.now) === Math.round(resize.size)) return;
    const pixels = Math.round(resize.now / (WORKBOOK_SCALE * this.#frame.zoom));
    const lines = this.#resizeLines(resize);
    if (resize.axis === "column") this.command("home.columnWidth", JSON.stringify({ cols: lines, width: pixels }));
    else this.command("home.rowHeight", JSON.stringify({ rows: lines, height: pixels }));
  }

  /// Mentre si tira il bordo della selezione: il contorno di dove andrà.
  #moveMarks(): HTMLElement[] {
    const drag = this.#drag?.kind === "move" ? this.#drag : null;
    if (!drag || sameRange(drag.source, drag.target)) return [];
    const box = this.#rangeBox(drag.target);
    if (!box) return [];
    const element = document.createElement("div");
    element.className = "grid-move-preview";
    element.setAttribute("aria-hidden", "true");
    this.#place(element, box.left, box.top, box.width, box.height);
    return [element];
  }

  /// Se il punto sta sul bordo della selezione, a `MOVE_SLOP` pixel, e la
  /// selezione si può spostare: un intervallo solo, di celle, con
  /// `fub.pasteFrom` servito. L'angolo del quadratino resta al riempimento.
  #onSelectionEdge(x: number, y: number): boolean {
    if (!this.commandable() || !this.#serves(PASTE_FROM) || this.#editing || this.#selectedObject !== null || this.#others.length) return false;
    const range = this.#selectedRange();
    const sheet = this.#sheet();
    const whole = (range.rowStart === 0 && range.rowEnd >= sheet.rows.length - 1)
      || (range.columnStart === 0 && range.columnEnd >= sheet.columns.length - 1);
    const box = whole ? null : this.#rangeBox(range);
    if (!box) return false;
    const rect = this.#viewport.getBoundingClientRect();
    const left = rect.left + this.#viewport.clientLeft + box.left - this.#viewport.scrollLeft;
    const top = rect.top + this.#viewport.clientTop + box.top - this.#viewport.scrollTop;
    const right = left + box.width;
    const bottom = top + box.height;
    const outside = x < left - MOVE_SLOP || x > right + MOVE_SLOP || y < top - MOVE_SLOP || y > bottom + MOVE_SLOP;
    const inside = x > left + MOVE_SLOP && x < right - MOVE_SLOP && y > top + MOVE_SLOP && y < bottom - MOVE_SLOP;
    const handle = this.#fillServed() && x >= right - 6 && y >= bottom - 6;
    return !outside && !inside && !handle;
  }

  /// Lo spostamento (o con `copy` la copia) di `source` in `target`, con
  /// `fub.pasteFrom`; dopo, la selezione è dove si è lasciato.
  #moveRange(source: GridRange, target: GridRange, copy: boolean): void {
    const sheet = this.#sheet().id;
    this.#others = [];
    this.#selection = {
      anchor: { row: target.rowStart, column: target.columnStart },
      focus: { row: target.rowEnd, column: target.columnEnd },
    };
    this.#syncFormulaBar();
    this.#render();
    this.#selectionChanged();
    this.command(PASTE_FROM, JSON.stringify({ source: rangeA1(source), sourceSheet: sheet, move: !copy }));
  }

  /// Le formiche attorno a ciò che si è tagliato, sul suo foglio.
  #cutMarks(): HTMLElement[] {
    const mark = this.#cutMark;
    if (!mark || mark.sheet !== this.#sheet().id) return [];
    const box = this.#rangeBox(mark.range);
    if (!box) return [];
    const element = document.createElement("div");
    element.className = "grid-cut-mark";
    element.setAttribute("aria-hidden", "true");
    this.#place(element, box.left, box.top, box.width, box.height);
    return [element];
  }

  /// Il rettangolo di `range` nella griglia, come lo disegnano le celle.
  #rangeBox(range: GridRange): { left: number; top: number; width: number; height: number } | null {
    const frame = this.#frame;
    const width = (this.#columns.offsets[range.columnEnd + 1] ?? 0) - (this.#columns.offsets[range.columnStart] ?? 0);
    const height = (this.#rows.offsets[range.rowEnd + 1] ?? 0) - (this.#rows.offsets[range.rowStart] ?? 0);
    if (!(width > 0 && height > 0)) return null;
    const top = frame.columnHeader + this.#rows.offsets[range.rowStart] + (range.rowStart < frame.frozenRows ? this.#viewport.scrollTop : 0);
    return { left: this.#columnLeft(range.columnStart), top, width, height };
  }

  /// La riga delle intestazioni di colonna, con l'angolo.
  #columnHeaders(columns: readonly number[], range: GridRange): HTMLElement {
    const frame = this.#frame;
    const row = document.createElement("div");
    row.className = "grid-row grid-column-header-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", "1");
    this.#stick(row, 0, frame.rowHeader + this.#columns.total, frame.columnHeader);
    this.#corner.className = "grid-corner";
    this.#corner.setAttribute("role", "presentation");
    this.#corner.textContent = "";
    this.#corner.style.pointerEvents = "none";
    this.#stickLeft(this.#corner, frame.rowHeader, frame.columnHeader);
    row.append(this.#corner);
    for (const column of columns) {
      if (this.#columns.sizes[column] === 0) continue;
      const header = document.createElement("div");
      header.className = column < frame.frozenColumns ? "grid-header grid-column-header frozen" : "grid-header grid-column-header";
      if ([range, ...this.#others].some((area) => column >= area.columnStart && column <= area.columnEnd)) header.classList.add("selected");
      if (column > 0 && this.#columns.sizes[column - 1] === 0) header.classList.add("after-hidden");
      header.setAttribute("role", "columnheader");
      header.setAttribute("aria-rowindex", "1");
      header.setAttribute("aria-colindex", String(column + 2));
      header.textContent = columnLabel(column);
      header.style.pointerEvents = "none";
      if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
      this.#place(header, this.#columnLeft(column), 0, this.#columns.sizes[column], frame.columnHeader);
      row.append(header);
    }
    return row;
  }

  /// I fili sotto le righe bloccate e a destra delle colonne bloccate.
  #freezeLines(): HTMLElement[] {
    const frame = this.#frame;
    const lines: HTMLElement[] = [];
    if (frame.frozenRows > 0) {
      const line = document.createElement("div");
      line.className = "grid-freeze grid-freeze-rows";
      line.setAttribute("aria-hidden", "true");
      this.#place(line, this.#viewport.scrollLeft, this.#viewport.scrollTop + frame.columnHeader + frame.frozenHeight - 1, this.#viewport.clientWidth, 1);
      lines.push(line);
    }
    if (frame.frozenColumns > 0) {
      const line = document.createElement("div");
      line.className = "grid-freeze grid-freeze-columns";
      line.setAttribute("aria-hidden", "true");
      this.#place(line, this.#viewport.scrollLeft + frame.rowHeader + frame.frozenWidth - 1, this.#viewport.scrollTop, 1, this.#viewport.clientHeight);
      lines.push(line);
    }
    return lines;
  }

  /// Gli oggetti letti del foglio mostrato, nell'ordine in cui si disegnano.
  #objects(): readonly GridObject[] {
    return this.#view?.sheets[this.#sheetIndex]?.objects ?? [];
  }

  #objectByKey(key: string | null): GridObject | undefined {
    return key === null ? undefined : this.#objects().find((object) => objectKey(object) === key);
  }

  /// Dove l'oggetto sta sul canvas: la sua cella e lo scarto da lei, nei
  /// pixel del file portati a quelli dello schermo. Un grafico sparkline e
  /// un'immagine nella cella prendono la misura della cella di Fub.
  #objectRect(object: GridObject): ObjectRect | null {
    const rows = this.#rows;
    const columns = this.#columns;
    if (object.row >= rows.sizes.length || object.column >= columns.sizes.length) return null;
    const placed = this.#placed;
    if (placed && placed.key === objectKey(object)) {
      if (sameObjectPlace(placed.before, object)) return placed.rect;
      this.#placed = null;
    }
    const frame = this.#frame;
    const scale = WORKBOOK_SCALE * frame.zoom;
    const left = this.#columnLeft(object.column);
    const top = frame.columnHeader + rows.offsets[object.row] + (object.row < frame.frozenRows ? this.#viewport.scrollTop : 0);
    if (object.kind === "sparkline" || object.kind === "cell_picture") {
      const merge = mergeAt(this.#merges(), { row: object.row, column: object.column });
      const lastRow = merge ? merge.row + merge.rows - 1 : object.row;
      const lastColumn = merge ? merge.column + merge.columns - 1 : object.column;
      return {
        left,
        top,
        width: columns.offsets[lastColumn + 1] - columns.offsets[object.column],
        height: rows.offsets[lastRow + 1] - rows.offsets[object.row],
      };
    }
    return { left: left + object.dx * scale, top: top + object.dy * scale, width: object.width * scale, height: object.height * scale };
  }

  /// Gli oggetti che si vedono, sopra le celle.
  #objectElements(): HTMLElement[] {
    const objects = this.#objects();
    this.#showObjectsSummary(objects);
    if (this.#selectedObject !== null && !this.#objectByKey(this.#selectedObject)) {
      this.#selectedObject = null;
      this.#finishObjectText(false);
    }
    const left = this.#viewport.scrollLeft;
    const top = this.#viewport.scrollTop;
    const right = left + this.#viewport.clientWidth;
    const bottom = top + this.#viewport.clientHeight;
    const out: HTMLElement[] = [];
    for (const object of objects) {
      const key = objectKey(object);
      const rect = this.#objectGesture?.key === key ? this.#objectGesture.to : this.#objectRect(object);
      if (!rect || rect.left > right || rect.left + rect.width < left || rect.top > bottom || rect.top + rect.height < top) continue;
      const element = document.createElement("div");
      element.className = MOVABLE[object.kind] ? "grid-object movable" : "grid-object in-cell";
      element.dataset.object = key;
      element.setAttribute("aria-hidden", "true");
      element.title = objectLabel(object);
      if (key === this.#selectedObject) element.classList.add("selected");
      if (object.row < this.#frame.frozenRows || object.column < this.#frame.frozenColumns) element.classList.add("frozen");
      this.#place(element, rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
      this.#drawObjectInto(element, object, rect);
      out.push(element);
    }
    return out;
  }

  /// Il contenuto dell'oggetto a misura di `rect`, con le maniglie se è
  /// selezionato e si può cambiare, e il campo del suo testo se si scrive.
  #drawObjectInto(element: HTMLElement, object: GridObject, rect: ObjectRect): void {
    const key = objectKey(object);
    element.replaceChildren(drawObject(object, rect.width, rect.height, WORKBOOK_SCALE * this.#frame.zoom, this.#media, this.#gridFont()));
    if (key !== this.#selectedObject) return;
    if (this.#objectText?.key === key) {
      element.append(this.#objectText.field);
      return;
    }
    if (!this.commandable()) return;
    for (const handle of HANDLES) {
      const grip = document.createElement("div");
      grip.className = `grid-object-handle ${handle.id}`;
      grip.dataset.handle = handle.id;
      grip.style.left = `${handle.x * 100}%`;
      grip.style.top = `${handle.y * 100}%`;
      element.append(grip);
    }
  }

  /// L'elenco degli oggetti, che la griglia nomina come sua descrizione.
  #showObjectsSummary(objects: readonly GridObject[]): void {
    const names = objects.filter((object) => MOVABLE[object.kind]).slice(0, SUMMARY_OBJECTS).map(objectLabel);
    const text = names.length ? t("grid.objects.summary", { list: names.join(", ") }) : "";
    if (this.#objectsSummary.textContent !== text) this.#objectsSummary.textContent = text;
    if (text) this.#viewport.setAttribute("aria-describedby", this.#objectsSummary.id);
    else this.#viewport.removeAttribute("aria-describedby");
  }

  /// Seleziona l'oggetto `key`, o torna alle celle con `null`.
  #selectObject(key: string | null): void {
    if (this.#selectedObject === key) return;
    this.#finishObjectText(true);
    this.#selectedObject = key;
    const object = this.#objectByKey(key);
    this.#objectsAnnounce.textContent = object ? t("grid.object.selected", { name: objectLabel(object) }) : "";
    if (object) {
      const rect = this.#objectRect(object);
      if (rect) this.#revealRect(rect);
    }
    this.#render();
    this.#options.onSelectionChange();
  }

  /// Scorre perché l'angolo dell'oggetto si veda.
  #revealRect(rect: ObjectRect): void {
    const frame = this.#frame;
    const viewport = this.#viewport;
    const before = { x: frame.rowHeader + frame.frozenWidth, y: frame.columnHeader + frame.frozenHeight };
    if (rect.left < viewport.scrollLeft + before.x || rect.left > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = Math.max(0, rect.left - before.x);
    }
    if (rect.top < viewport.scrollTop + before.y || rect.top > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = Math.max(0, rect.top - before.y);
    }
  }

  /// Il passo di Tab fra gli oggetti che si spostano.
  #stepObject(step: 1 | -1): void {
    const keys = this.#objects().filter((object) => MOVABLE[object.kind]).map(objectKey);
    if (!keys.length) return;
    const at = this.#selectedObject === null ? -1 : keys.indexOf(this.#selectedObject);
    const next = at < 0 ? (step > 0 ? 0 : keys.length - 1) : (at + step + keys.length) % keys.length;
    this.#selectObject(keys[next] ?? null);
  }

  /// I tasti di un oggetto selezionato. Vero se il tasto è suo.
  #objectKeydown(event: KeyboardEvent): boolean {
    const object = this.#objectByKey(this.#selectedObject);
    if (!object) return false;
    const kind = MOVABLE[object.kind];
    switch (event.key) {
      case "Escape":
        this.#selectObject(null);
        return true;
      case "Tab":
        this.#stepObject(event.shiftKey ? -1 : 1);
        return true;
      case "Delete":
      case "Backspace":
        if (kind && this.commandable()) {
          this.#selectObject(null);
          this.command("object.delete", JSON.stringify({ kind, id: object.id }));
        }
        return true;
      case "Enter":
      case "F2":
        this.#beginObjectText(objectKey(object));
        return true;
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        const rect = this.#objectRect(object);
        if (!kind || !rect || !this.commandable()) return true;
        const step = (event.shiftKey ? 10 : 1) * WORKBOOK_SCALE * this.#frame.zoom;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        this.#placeObject(objectKey(object), gestureRect(rect, null, dx, dy, false));
        return true;
      }
      default:
        // Le altre battute non aprono la cella sotto l'oggetto.
        return !(event.ctrlKey || event.metaKey || event.altKey);
    }
  }

  /// Prende l'oggetto sotto il puntatore: lo seleziona e comincia a
  /// spostarlo, o a misurarlo se ha preso una maniglia. Falso se l'oggetto
  /// non si prende, e il clic va alla cella.
  #objectPointerDown(event: PointerEvent, element: HTMLElement): boolean {
    const key = element.dataset.object ?? null;
    const object = this.#objectByKey(key);
    if (!key || !object || !MOVABLE[object.kind]) return false;
    if (event.target instanceof Element && event.target.closest(".grid-object-text-editor")) return true;
    event.preventDefault();
    this.#finishEditing(true, "input", false);
    this.#viewport.focus();
    this.#selectObject(key);
    const rect = this.#objectRect(object);
    if (!rect || !this.commandable() || event.button !== 0) return true;
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-object-handle")?.dataset.handle ?? null : null;
    this.#objectGesture = { key, handle, pointer: event.pointerId, x: event.clientX, y: event.clientY, from: rect, to: rect, moved: false };
    this.#viewport.setPointerCapture?.(event.pointerId);
    return true;
  }

  #objectPointerMove(event: PointerEvent, gesture: ObjectGesture): void {
    if (event.pointerId !== gesture.pointer) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    gesture.moved = true;
    gesture.to = gestureRect(gesture.from, gesture.handle, dx, dy, event.shiftKey);
    const object = this.#objectByKey(gesture.key);
    const element = [...this.#viewport.querySelectorAll<HTMLElement>(".grid-object")].find((candidate) => candidate.dataset.object === gesture.key);
    if (!object || !element) return;
    const rect = gesture.to;
    this.#place(element, rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
    this.#drawObjectInto(element, object, rect);
  }

  #endObjectGesture(event: PointerEvent, commit: boolean): void {
    const gesture = this.#objectGesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    this.#objectGesture = null;
    if (commit && gesture.moved) this.#placeObject(gesture.key, gesture.to);
    else this.#render();
  }

  /// Ancora l'oggetto a `rect`: la cella sotto il suo angolo in alto a
  /// sinistra e lo scarto da lei, con la misura, nei pixel del file. Si
  /// mostra lì subito; se il comando non entra, torna dov'era.
  #placeObject(key: string, rect: ObjectRect): void {
    const object = this.#objectByKey(key);
    const kind = object ? MOVABLE[object.kind] : undefined;
    if (!object || !kind) return;
    const frame = this.#frame;
    const scale = WORKBOOK_SCALE * frame.zoom;
    // Sopra le righe o le colonne bloccate un punto del canvas sta fermo con
    // lo scorrimento.
    const screenX = rect.left - this.#viewport.scrollLeft - frame.rowHeader;
    const screenY = rect.top - this.#viewport.scrollTop - frame.columnHeader;
    const x = Math.max(0, frame.frozenColumns > 0 && screenX < frame.frozenWidth ? screenX : rect.left - frame.rowHeader);
    const y = Math.max(0, frame.frozenRows > 0 && screenY < frame.frozenHeight ? screenY : rect.top - frame.columnHeader);
    // Sulla stessa linea di una riga o di una colonna nascosta l'ancora resta
    // quella del file.
    const near = (sizes: AxisLayout, at: number, own: number) => {
      const index = indexAt(sizes, at);
      return own < sizes.sizes.length && sizes.offsets[own] === sizes.offsets[index] ? own : index;
    };
    const column = near(this.#columns, x, object.column);
    const row = near(this.#rows, y, object.row);
    if (column < 0 || row < 0) return;
    const round = (value: number) => Math.round(value * 100) / 100;
    const params = {
      kind,
      id: object.id,
      at: cellA1({ row, column }),
      dx: round((x - this.#columns.offsets[column]) / scale),
      dy: round((y - this.#rows.offsets[row]) / scale),
      width: round(rect.width / scale),
      height: round(rect.height / scale),
    };
    const placed = { key, before: object, rect: { ...rect, left: frame.rowHeader + x, top: frame.columnHeader + y } };
    this.#placed = placed;
    this.#render();
    void this.run("object.move", JSON.stringify(params)).then((run) => {
      if (run.ok || this.#placed !== placed) return;
      this.#placed = null;
      if (run.error) this.#refuse(t("grid.workbook.command_failed", { error: run.error }));
      this.#render();
    });
  }

  /// Apre il testo di una forma sul posto: Invio con Ctrl, o uscire, lo
  /// scrive; Esc lo lascia com'era.
  #beginObjectText(key: string): void {
    const object = this.#objectByKey(key);
    if (!object?.shape || object.shape.kind !== "text_box" || !this.commandable()) return;
    if (this.#objectText?.key === key) {
      this.#objectText.field.focus();
      return;
    }
    this.#finishObjectText(true);
    this.#selectedObject = key;
    const field = document.createElement("textarea");
    field.className = "grid-object-text-editor";
    field.value = object.shape.text;
    field.setAttribute("aria-label", objectLabel(object));
    field.style.fontSize = `${(object.shape.font_size * (96 / 72) * WORKBOOK_SCALE * this.#frame.zoom).toFixed(2)}px`;
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.#finishObjectText(false);
        this.#viewport.focus();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.#finishObjectText(true);
        this.#viewport.focus();
      }
    }, { signal: this.#abort.signal });
    field.addEventListener("blur", () => queueMicrotask(() => {
      if (this.#objectText?.field === field) this.#finishObjectText(true);
    }), { signal: this.#abort.signal });
    for (const type of ["pointerdown", "copy", "cut", "paste"] as const) {
      field.addEventListener(type, (event) => event.stopPropagation(), { signal: this.#abort.signal });
    }
    this.#objectText = { key, field, original: object.shape.text };
    this.#render();
    field.focus();
  }

  #finishObjectText(commit: boolean): void {
    const editing = this.#objectText;
    if (!editing) return;
    this.#objectText = null;
    editing.field.remove();
    const object = this.#objectByKey(editing.key);
    if (commit && object && editing.field.value !== editing.original) {
      this.command("shape.setText", JSON.stringify({ id: object.id, text: editing.field.value }));
    }
    this.#render();
  }

  /// L'elemento della cella in `position`, disegnato nella riga `hostRow`
  /// (un'unione può cominciare sopra la prima riga disegnata), con i suoi
  /// bordi. `measure` chiede di misurarla dopo: si stringe, o è un numero
  /// che potrebbe non entrare.
  #cellElement(
    position: GridPosition,
    range: GridRange,
    merge: GridMerge | null,
    hostRow: number,
  ): { cell: HTMLElement; border: HTMLElement | null; measure: boolean } | null {
    const { row, column } = position;
    const frame = this.#frame;
    const workbookCell = this.#workbookCell(position);
    const bytes = workbookCell?.bytes;
    const style = workbookCell?.style;
    const lastRow = merge ? merge.row + merge.rows - 1 : row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : column;
    const width = this.#columns.offsets[lastColumn + 1] - this.#columns.offsets[column];
    const height = this.#rows.offsets[lastRow + 1] - this.#rows.offsets[row];
    if (width <= 0 || height <= 0) return null;
    const frozenColumn = column < frame.frozenColumns;
    const element = document.createElement("div");
    element.className = frozenColumn ? "grid-cell frozen" : "grid-cell";
    element.dataset.row = String(row);
    element.dataset.column = String(column);
    element.id = this.#cellId(position);
    element.setAttribute("role", "gridcell");
    element.setAttribute("aria-rowindex", String(row + 2));
    element.setAttribute("aria-colindex", String(column + 2));
    if (merge) {
      element.classList.add("merged");
      element.setAttribute("aria-rowspan", String(merge.rows));
      element.setAttribute("aria-colspan", String(merge.columns));
    }
    const selected = this.#inSelection(range, row, column, lastRow, lastColumn);
    const text = document.createElement("span");
    text.className = "grid-cell-text";
    text.textContent = workbookCell?.cell.input ?? "";
    paintCell(element, text, style, bytes, this.#gridFont(), this.#paper);
    if (bytes?.data_bar) {
      const bar = document.createElement("div");
      bar.className = "grid-data-bar";
      bar.setAttribute("aria-hidden", "true");
      bar.style.width = `calc((100% - 4px) * ${bytes.data_bar.fraction})`;
      bar.style.background = bytes.data_bar.gradient
        ? `linear-gradient(to right, ${bytes.data_bar.color}, color-mix(in srgb, ${bytes.data_bar.color} 15%, white))`
        : bytes.data_bar.color;
      element.append(bar);
    }
    if (bytes?.icon) {
      const icon = iconOf(bytes.icon);
      if (icon) {
        const mark = document.createElement("span");
        mark.className = "grid-icon";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = icon.glyph;
        mark.style.color = icon.color;
        element.append(mark);
        if (horizontalOf(style, bytes.value) === "start") element.style.paddingInlineStart = "calc(0.45rem + 1.3em)";
      }
    }
    element.append(text);
    if (bytes?.comment) {
      // Il thread lo mostra la scheda al passaggio (`comment-card.ts`), e a
      // chi non vede lo dice la cella quando diventa attiva.
      const mark = document.createElement("span");
      mark.className = bytes.comment.threaded ? "grid-comment-mark threaded" : "grid-comment-mark";
      if (bytes.comment.threaded && bytes.comment.resolved) mark.classList.add("resolved");
      mark.setAttribute("aria-hidden", "true");
      element.append(mark);
      element.dataset.comment = bytes.comment.threaded ? "thread" : "note";
      element.setAttribute("aria-description", commentDescription(bytes.comment));
    } else if (bytes?.link) {
      element.title = bytes.link.tooltip ?? bytes.link.target;
    }
    if (bytes?.stale) element.classList.add("stale");
    if (bytes?.conflict) {
      element.classList.add("conflict");
      element.setAttribute("aria-invalid", "true");
    }
    if (bytes?.lock) element.setAttribute("aria-readonly", "true");
    // Un testo che non va a capo passa nelle celle vuote accanto, fino alla
    // prima che ha un valore.
    if (style?.shrink) element.dataset.shrink = "true";
    let measure = Boolean(style?.shrink) || bytes?.value.kind === "number";
    if (!merge && bytes && spills(style, bytes)) {
      const reach = this.#spillReach(position, horizontalOf(style, bytes.value));
      if (reach > 0) {
        const align = horizontalOf(style, bytes.value);
        element.classList.add("spill");
        text.style.maxWidth = `calc(${width + reach}px - 0.9rem)`;
        text.style.justifySelf = align === "end" ? "unsafe end" : align === "center" ? "unsafe center" : "start";
        measure = false;
      }
    }
    const top = this.#rows.offsets[row] - this.#rows.offsets[hostRow];
    this.#place(element, this.#columnLeft(column), top, width, height);
    let border: HTMLElement | null = null;
    const borders = this.#cellBorders(position, lastRow, lastColumn);
    if (borders) {
      border = document.createElement("div");
      border.className = frozenColumn ? "grid-border frozen" : "grid-border";
      border.setAttribute("aria-hidden", "true");
      paintBorders(border, borders);
      this.#place(border, this.#columnLeft(column) - 1, top - 1, width + 1, height + 1);
    }
    // Ciò che la cella è senza la selezione: `#reconcile` tiene quella
    // disegnata se è uguale.
    this.#drawn.set(element, element.outerHTML);
    element.setAttribute("aria-selected", String(selected));
    if (selected) element.classList.add("selected");
    if (samePosition(position, this.#active())) element.classList.add("active");
    return { cell: element, border, measure };
  }

  /// I bordi da disegnare attorno alla cella, o all'unione che finisce in
  /// `lastRow` e `lastColumn`: sopra e a sinistra quelli della prima cella,
  /// sotto e a destra quelli delle celle che stanno lì.
  #cellBorders(position: GridPosition, lastRow: number, lastColumn: number) {
    const own = this.#workbookCell(position)?.style?.borders;
    if (lastRow === position.row && lastColumn === position.column) return hasBorders(own) ? own : null;
    const right = this.#workbookCell({ row: position.row, column: lastColumn })?.style?.borders ?? own;
    const bottom = this.#workbookCell({ row: lastRow, column: position.column })?.style?.borders ?? own;
    const borders = {
      top: own?.top ?? null,
      left: own?.left ?? null,
      right: right?.right ?? null,
      bottom: bottom?.bottom ?? null,
      diagonal_down: own?.diagonal_down ?? null,
      diagonal_up: own?.diagonal_up ?? null,
    };
    return hasBorders(borders) ? borders : null;
  }

  /// Quanti pixel accanto il testo di `position` può prendere: le celle
  /// vuote verso dove si allinea, fino alla prima con un valore, a
  /// un'unione o al bordo delle colonne disegnabili.
  #spillReach(position: GridPosition, align: "start" | "center" | "end" | "justify"): number {
    const free = (step: 1 | -1): number => {
      let reach = 0;
      for (let column = position.column + step, seen = 0; column >= 0 && column < this.#columns.sizes.length && seen < 64; column += step, seen += 1) {
        if (column < this.#frame.frozenColumns !== position.column < this.#frame.frozenColumns) break;
        const at = { row: position.row, column };
        if (this.#workbookCell(at)?.cell.input || mergeAt(this.#merges(), at)) break;
        reach += this.#columns.sizes[column];
      }
      return reach;
    };
    switch (align) {
      case "start": return free(1);
      case "end": return free(-1);
      case "center": return 2 * Math.min(free(1), free(-1));
      default: return 0;
    }
  }

  /// Misura le celle che si stringono e i numeri: un testo che si stringe
  /// cala il carattere finché entra, un numero che non entra si mostra con
  /// i cancelletti, come in Excel. Prima si legge tutto, poi si scrive.
  #fitCells(cells: readonly HTMLElement[]): void {
    const fits: { text: HTMLElement; shrink: boolean; ratio: number }[] = [];
    for (const cell of cells) {
      const text = cell.querySelector<HTMLElement>(".grid-cell-text");
      if (!text) continue;
      const computed = getComputedStyle(cell);
      const room = cell.clientWidth - (parseFloat(computed.paddingLeft) || 0) - (parseFloat(computed.paddingRight) || 0);
      const needed = text.scrollWidth;
      if (room > 0 && needed > room) fits.push({ text, shrink: cell.style.whiteSpace !== "pre-wrap" && cell.dataset.shrink === "true", ratio: room / needed });
    }
    for (const { text, shrink, ratio } of fits) {
      if (shrink) {
        text.style.fontSize = `${Math.max(0.3, ratio).toFixed(3)}em`;
      } else {
        const length = text.textContent?.length ?? 0;
        text.textContent = "#".repeat(Math.max(1, Math.floor(length * ratio)));
      }
    }
  }

  /// Un elemento che sta fermo in alto mentre la griglia scorre: è nel
  /// flusso, con la posizione naturale in cima (il margine negativo non gli
  /// fa occupare posto), e `sticky` lo tiene a `top` dal bordo del riquadro.
  /// Lo fa il compositore, nello stesso fotogramma dello scorrimento.
  #stick(element: HTMLElement, top: number, width: number, height: number): void {
    element.style.position = "sticky";
    element.style.left = "";
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.marginBottom = `${-height}px`;
  }

  /// Un elemento che sta fermo a sinistra dentro la sua riga: il primo figlio
  /// nel flusso, `sticky` al bordo sinistro del riquadro.
  #stickLeft(element: HTMLElement, width: number, height: number): void {
    element.style.position = "sticky";
    element.style.left = "0px";
    element.style.top = "";
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }

  #place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
    element.style.position = "absolute";
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }
  #findCell(position: GridPosition): HTMLElement | null {
    for (const cell of this.#viewport.querySelectorAll<HTMLElement>(".grid-cell")) {
      if (cell.dataset.row === String(position.row) && cell.dataset.column === String(position.column)) return cell;
    }
    return null;
  }

  #detachCellEditor(): void {
    if (this.#cellEditorHost.parentElement !== this.#canvas) this.#canvas.append(this.#cellEditorHost);
  }

  /// La cella che l'elemento disegna, dai suoi `data-row`/`data-column`.
  #positionOf(cell: HTMLElement): GridPosition | null {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  #cellId(position: GridPosition): string {
    return `grid-${this.#options.surfaceId}-${position.row}-${position.column}`;
  }

  #syncFormulaBar(): void {
    if (!this.#workbook) return;
    const bytes = this.#workbookCell(this.#active())?.bytes;
    this.#formulaEditor.setReadOnly(this.#readOnly || Boolean(bytes?.lock));
    this.#formulaEditor.setDoc(localInput(bytes?.input ?? "", this.#decimal));
  }

  /// La selezione da disegnare e da dare ai comandi: con le unioni intere.
  #selectedRange(): GridRange {
    return expandToMerges(normalizedSelection(this.#selection), this.#merges());
  }

  /// La selezione come la nomina un comando.
  #commandSelection(): GridCommandSelection {
    return {
      sheet: this.#sheet().id,
      selection: [...this.#others, this.#selectedRange()].map(rangeA1).join(","),
      active: cellA1(this.#active()),
    };
  }

  /// Gli intervalli della Tabella in quelli della griglia.
  #rangesOf(ranges: readonly { r0: number; c0: number; r1: number; c1: number }[]): GridRange[] {
    return ranges.map((range) => ({ rowStart: range.r0, columnStart: range.c0, rowEnd: range.r1, columnEnd: range.c1 }));
  }

  /// Se `position` (o l'unione da lì a `last`) sta in un intervallo scelto.
  #inSelection(range: GridRange, row: number, column: number, lastRow = row, lastColumn = column): boolean {
    return [range, ...this.#others].some((area) => touches(tableRange(area), row, column, lastRow, lastColumn));
  }

  #select(position: GridPosition, extend: boolean): void {
    const clamped = this.#clampedPosition(position);
    const merge = mergeAt(this.#merges(), clamped);
    const focus = merge && !extend ? { row: merge.row, column: merge.column } : clamped;
    const active = this.#selection.active;
    if (!extend && !this.#adding) this.#others = [];
    this.#selection = extend
      ? (active ? { anchor: this.#selection.anchor, focus, active } : { anchor: this.#selection.anchor, focus })
      : { anchor: focus, focus };
    this.#tabStart = null;
    if (!this.#editing) this.#syncFormulaBar();
    this.#ensureVisible(focus);
    this.#render();
    this.#selectionChanged();
  }

  #clampedPosition(position: GridPosition): GridPosition {
    const sheet = this.#sheet();
    return {
      row: clamp(position.row, Math.max(0, sheet.rows.length - 1)),
      column: clamp(position.column, Math.max(0, sheet.columns.length - 1)),
    };
  }

  #clampedSelection(selection: GridSelection): GridSelection {
    const clamped = {
      anchor: this.#clampedPosition(selection.anchor),
      focus: this.#clampedPosition(selection.focus),
    };
    return selection.active ? { ...clamped, active: this.#clampedPosition(selection.active) } : clamped;
  }

  /// La cella attiva: dove si scrive, che la barra della formula mostra.
  /// Estendere la selezione muove l'altro capo, e la cella attiva resta
  /// all'àncora, come nei fogli di calcolo.
  #active(): GridPosition {
    return this.#selection.active ?? this.#selection.anchor;
  }

  #isVisiblePosition(position: GridPosition): boolean {
    return this.#rows.sizes[position.row] > 0 && this.#columns.sizes[position.column] > 0;
  }

  #nearestVisible(axis: "row" | "column", from: number): number {
    const sizes = axis === "row" ? this.#rows.sizes : this.#columns.sizes;
    if (sizes.length === 0) return 0;
    const start = clamp(from, sizes.length - 1);
    if (sizes[start] !== 0) return start;
    for (let distance = 1; distance < sizes.length; distance += 1) {
      if (start + distance < sizes.length && sizes[start + distance] !== 0) return start + distance;
      if (start - distance >= 0 && sizes[start - distance] !== 0) return start - distance;
    }
    return start;
  }

  #visibleSelection(selection: GridSelection): GridSelection {
    const visible = (position: GridPosition): GridPosition => ({
      row: this.#nearestVisible("row", position.row),
      column: this.#nearestVisible("column", position.column),
    });
    const shown = { anchor: visible(selection.anchor), focus: visible(selection.focus) };
    return selection.active ? { ...shown, active: visible(selection.active) } : shown;
  }

  #nextVisible(axis: "row" | "column", from: number, step: number): number {
    const sizes = axis === "row" ? this.#rows.sizes : this.#columns.sizes;
    if (sizes.length === 0 || step === 0) return from;
    const direction = Math.sign(step);
    const target = clamp(from + step, sizes.length - 1);
    for (let index = target; index >= 0 && index < sizes.length; index += direction) {
      if (sizes[index] !== 0) return index;
    }
    for (let index = target - direction; index >= 0 && index < sizes.length; index -= direction) {
      if (sizes[index] !== 0 && (direction > 0 ? index >= from : index <= from)) return index;
    }
    return from;
  }

  #edgeVisible(axis: "row" | "column", last: boolean): number {
    const sizes = axis === "row" ? this.#rows.sizes : this.#columns.sizes;
    for (
      let index = last ? sizes.length - 1 : 0;
      index >= 0 && index < sizes.length;
      index += last ? -1 : 1
    ) {
      if (sizes[index] !== 0) return index;
    }
    return 0;
  }

  /// Un passo del cursore. Da un'unione si parte dal suo bordo, e in
  /// un'unione si arriva nella sua cella in alto a sinistra.
  /// Senza Maiusc si parte dalla cella attiva; con Maiusc si muove l'altro
  /// capo della selezione.
  #move(rowStep: number, columnStep: number, extend: boolean): void {
    const focus = extend ? this.#selection.focus : this.#active();
    const merge = mergeAt(this.#merges(), focus);
    const row = merge && rowStep > 0 ? merge.row + merge.rows - 1 : focus.row;
    const column = merge && columnStep > 0 ? merge.column + merge.columns - 1 : focus.column;
    this.#select({
      row: rowStep === 0 ? focus.row : this.#nextVisible("row", row, rowStep),
      column: columnStep === 0 ? focus.column : this.#nextVisible("column", column, columnStep),
    }, extend);
  }

  #filled(position: GridPosition): boolean {
    return Boolean(this.#workbookCell(position)?.cell.input);
  }

  /// Ctrl+freccia: fino al bordo dei dati, come in Excel. Da una cella piena
  /// accanto a un'altra piena si va all'ultima del blocco; altrimenti alla
  /// prima piena, o al bordo del foglio. Contano le celle lette.
  #jump(rowStep: -1 | 0 | 1, columnStep: -1 | 0 | 1, extend: boolean): void {
    const axis = rowStep ? "row" : "column";
    const step = rowStep || columnStep;
    const from = extend ? this.#selection.focus : this.#active();
    const at = (index: number): GridPosition => axis === "row"
      ? { row: index, column: from.column }
      : { row: from.row, column: index };
    let index = axis === "row" ? from.row : from.column;
    let next = this.#nextVisible(axis, index, step);
    if (next === index) return;
    if (this.#filled(at(index)) && this.#filled(at(next))) {
      while (next !== index && this.#filled(at(next))) {
        index = next;
        next = this.#nextVisible(axis, index, step);
      }
    } else {
      index = next;
      while (!this.#filled(at(index))) {
        next = this.#nextVisible(axis, index, step);
        if (next === index) break;
        index = next;
      }
    }
    this.#select(at(index), extend);
  }

  /// PagSu e PagGiù (con Alt, PagSu e PagGiù di lato): una schermata di
  /// righe vere, con le loro altezze; la vista scorre di tanto quanto la
  /// cella si sposta, così la cella resta allo stesso punto dello schermo.
  #page(axis: "row" | "column", step: -1 | 1, extend: boolean): void {
    const layout = axis === "row" ? this.#rows : this.#columns;
    if (!layout.sizes.length) return;
    const frame = this.#frame;
    const extent = axis === "row"
      ? this.#viewport.clientHeight - frame.columnHeader - frame.frozenHeight
      : this.#viewport.clientWidth - frame.rowHeader - frame.frozenWidth;
    const from = extend ? this.#selection.focus : this.#active();
    const index = axis === "row" ? from.row : from.column;
    // Le righe intere che una schermata contiene, contate dalla cella verso
    // dove si va: su e giù fanno lo stesso numero di passi.
    let landed = index;
    let used = 0;
    for (;;) {
      const next = this.#nextVisible(axis, landed, step);
      if (next === landed) break;
      used += layout.sizes[step > 0 ? landed : next] ?? 0;
      if (used > extent && landed !== index) break;
      landed = next;
    }
    if (landed === index) return;
    const delta = (layout.offsets[landed] ?? 0) - (layout.offsets[index] ?? 0);
    if (axis === "row") this.#viewport.scrollTop = Math.max(0, this.#viewport.scrollTop + delta);
    else this.#viewport.scrollLeft = Math.max(0, this.#viewport.scrollLeft + delta);
    this.#select(axis === "row" ? { row: landed, column: from.column } : { row: from.row, column: landed }, extend);
  }

  /// Seleziona le righe (o le colonne) intere della selezione.
  #selectWhole(axis: "row" | "column"): void {
    const range = this.#selectedRange();
    this.#others = [];
    this.#selection = axis === "row"
      ? {
        anchor: { row: range.rowStart, column: this.#edgeVisible("column", false) },
        focus: { row: range.rowEnd, column: this.#edgeVisible("column", true) },
      }
      : {
        anchor: { row: this.#edgeVisible("row", false), column: range.columnStart },
        focus: { row: this.#edgeVisible("row", true), column: range.columnEnd },
      };
    this.#render();
    this.#selectionChanged();
  }

  /// Passa al foglio visibile accanto: Ctrl+PagGiù e Ctrl+PagSu.
  #stepSheet(step: -1 | 1): void {
    const sheets = this.#workbook?.sheets ?? [];
    const index = this.#sheetIndex + step;
    if (index < 0 || index >= sheets.length) return;
    this.#showSheetAt(index);
  }

  #tab(step: -1 | 1): boolean {
    const focus = this.#selection.focus;
    const column = this.#nextVisible("column", focus.column, step);
    if (column !== focus.column) {
      this.#select({ row: focus.row, column }, false);
      return true;
    }
    const row = this.#nextVisible("row", focus.row, step);
    if (row !== focus.row) {
      this.#select({ row, column: this.#edgeVisible("column", step < 0) }, false);
      return true;
    }
    return false;
  }

  #keydown(event: KeyboardEvent): void {
    if (!this.#workbook || event.defaultPrevented) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (this.#objectKeydown(event)) {
      event.preventDefault();
      return;
    }
    // Ctrl+Alt+5, come in Excel: dalle celle al primo oggetto del foglio.
    if (modifier && event.altKey && event.code === "Digit5") {
      event.preventDefault();
      this.#stepObject(1);
      return;
    }
    if (this.#commands.length && !this.#readOnly) {
      const range = this.#selectedRange();
      const context = {
        wholeRows: range.columnStart === this.#edgeVisible("column", false) && range.columnEnd === this.#edgeVisible("column", true),
        wholeColumns: range.rowStart === this.#edgeVisible("row", false) && range.rowEnd === this.#edgeVisible("row", true),
        currency: currencyFormat(resolvedLanguage()),
      };
      const shortcut = shortcutCommand(event, context);
      if (shortcut) {
        event.preventDefault();
        this.command(shortcut.id, shortcut.params);
        return;
      }
      const asked = this.#options.onDialog ? shortcutDialog(event, context) : null;
      if (asked) {
        event.preventDefault();
        this.openDialog(asked.dialog, asked.params);
        return;
      }
    }
    if (modifier && (event.key === "PageDown" || event.key === "PageUp")) {
      event.preventDefault();
      this.#stepSheet(event.key === "PageDown" ? 1 : -1);
      return;
    }
    if (event.key === " " && (event.shiftKey || modifier) && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey && modifier) this.#selectAll();
      else this.#selectWhole(event.shiftKey ? "row" : "column");
      return;
    }
    if (modifier && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const steps: Record<string, readonly [-1 | 0 | 1, -1 | 0 | 1]> = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      };
      const [rowStep, columnStep] = steps[event.key] ?? [0, 0];
      if (rowStep || columnStep) this.#jump(rowStep, columnStep, event.shiftKey);
      return;
    }
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.#selectAll();
      return;
    }
    if (modifier && event.key === "Backspace") {
      event.preventDefault();
      this.#ensureVisible(this.#active());
      return;
    }
    const extend = event.shiftKey;
    switch (event.key) {
      case "ArrowUp": this.#move(-1, 0, extend); break;
      case "ArrowDown": this.#move(1, 0, extend); break;
      case "ArrowLeft": this.#move(0, -1, extend); break;
      case "ArrowRight": this.#move(0, 1, extend); break;
      // Invio e Tab spostano la cella attiva, dentro la selezione se è più
      // di una cella; Tab sull'ultima colonna va a capo, e oltre l'ultima
      // cella lascia andare il fuoco.
      case "Tab": if (!this.#advance(extend ? "left" : "right") && !this.#tab(extend ? -1 : 1)) return; break;
      case "Enter": if (!event.altKey && !modifier) this.#advance(extend ? "up" : "down"); break;
      case "F2": this.#beginEditing("cell", this.#active(), undefined, "edit"); break;
      // Maiusc+F8 aggiunge alla selezione: ciò che è scelto resta, e ci si
      // sposta per scegliere un altro intervallo; di nuovo, o Esc, smette.
      case "F8":
        if (!extend) return;
        this.#adding = !this.#adding;
        if (this.#adding) {
          this.#others = this.#rangesOf(withRange(this.#others.map(tableRange), tableRange(this.#selectedRange())));
        }
        this.#render();
        break;
      case "Home": this.#select({
        row: modifier ? this.#edgeVisible("row", false) : (extend ? this.#selection.focus : this.#active()).row,
        column: this.#edgeVisible("column", false),
      }, extend); break;
      case "End": this.#select({
        row: modifier ? this.#edgeVisible("row", true) : (extend ? this.#selection.focus : this.#active()).row,
        column: this.#edgeVisible("column", true),
      }, extend); break;
      case "PageUp": this.#page(event.altKey ? "column" : "row", -1, extend); break;
      case "PageDown": this.#page(event.altKey ? "column" : "row", 1, extend); break;
      case "Delete":
      case "Backspace": this.#clearSelection(); break;
      case "Escape":
        this.#copied = null;
        if (!this.#cutMark && !this.#adding) return;
        this.#cutMark = null;
        this.#adding = false;
        this.#render();
        break;
      default: {
        const typing = this.#readOnly ? null : typingOpens(event);
        if (typing === "browser") {
          // Il fuoco va nel campo durante il keydown e il tasto non si
          // ferma: il carattere, il tasto morto o la composizione arrivano al
          // campo dal browser, come li manda il sistema.
          this.#beginEditing("cell", this.#active(), "");
          if (this.#editing?.owner === "cell") this.#cellEditor.focus();
          return;
        }
        if (typing === "seed") {
          this.#beginEditing("cell", this.#active(), event.key);
          break;
        }
        return;
      }
    }
    event.preventDefault();
  }

  #selectAll(): void {
    this.#others = [];
    this.#selection = {
      anchor: {
        row: this.#edgeVisible("row", false),
        column: this.#edgeVisible("column", false),
      },
      focus: {
        row: this.#edgeVisible("row", true),
        column: this.#edgeVisible("column", true),
      },
    };
    this.#render();
    this.#selectionChanged();
  }

  /// Apre la cella (o la barra della formula) su `position`. Una battuta
  /// (`initial`) apre in «Inserisci», F2 e il doppio clic in «Modifica».
  #beginEditing(
    owner: "cell" | "formula",
    position: GridPosition,
    initial?: string,
    mode: "insert" | "edit" = initial === undefined ? "edit" : "insert",
  ): void {
    if (this.#readOnly || !this.#workbook || !this.#isVisiblePosition(position)) return;
    const refusal = this.#writeRefusal(position);
    if (refusal) {
      this.#refuse(refusal);
      return;
    }
    const current = localInput(this.#workbookCell(position)?.bytes.input ?? "", this.#decimal);
    if (this.#editing && (!samePosition(this.#editing.position, position) || this.#editing.owner !== owner)) {
      this.#finishEditing(true, "input", false);
    }
    this.#editing = { position, original: current, draft: initial ?? current, owner, mode, theirs: null };
    if (owner === "cell") {
      const cell = this.#findCell(position);
      if (!cell) {
        this.#editing = null;
        return;
      }
      cell.append(this.#cellEditorHost);
      this.#cellEditorHost.hidden = false;
      this.#cellEditorHost.removeAttribute("aria-hidden");
      this.#positionEditor(position);
      this.#cellEditor.setDoc(this.#editing.draft);
      // Il cursore va in fondo, come nei fogli di calcolo: la battuta che ha
      // aperto la cella è già scritta, e le altre la seguono.
      this.#cellEditor.revealByteOffset(new TextEncoder().encode(this.#editing.draft).length);
    } else {
      this.#formulaEditor.setDoc(this.#editing.draft);
    }
    this.#options.onEditMode?.();
  }

  /// Lo scorrimento chiede un disegno: uno per fotogramma.
  #scheduleRender(): void {
    if (this.#renderFrame !== null) return;
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = null;
      if (!this.#destroyed) this.#render();
    });
  }

  /// F2 nella cella aperta: «Inserisci» ⇄ «Modifica».
  #toggleEditMode(): void {
    const editing = this.#editing;
    if (editing?.owner !== "cell") return;
    editing.mode = editing.mode === "insert" ? "edit" : "insert";
    this.#options.onEditMode?.();
  }

  /// Invio, Tab o una freccia nella cella aperta: conferma e si sposta.
  /// Ctrl+Invio scrive la bozza in tutta la selezione e resta.
  #commitAndMove(move: FormulaMove, arrow = false): void {
    const editing = this.#editing;
    if (!editing) return;
    if (move === "fill") {
      this.#fillDraft(editing);
      return;
    }
    this.#finishEditing(true, "input");
    this.#advance(move);
    // Soltanto Tab comincia una serie: una freccia la chiude.
    if (arrow) this.#tabStart = null;
  }

  /// La bozza in ogni cella visibile della selezione.
  #fillDraft(editing: EditingState): void {
    const range = this.#selectedRange();
    const inside = editing.position.row >= range.rowStart && editing.position.row <= range.rowEnd
      && editing.position.column >= range.columnStart && editing.position.column <= range.columnEnd;
    if (!inside) {
      this.#finishEditing(true, "input");
      return;
    }
    this.#finishEditing(false, "input");
    if (!this.#rangeRead(range)) {
      this.#refuse(t("grid.workbook.not_loaded"));
      return;
    }
    const after = fileInput(editing.draft, this.#decimal);
    const writes: CellWrite[] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const position = { row, column };
        if (!this.#isVisiblePosition(position)) continue;
        const merge = mergeAt(this.#merges(), position);
        if (merge && (merge.row !== row || merge.column !== column)) continue;
        writes.push({ position, after });
      }
    }
    this.#commitCells(writes, "input", true);
  }

  /// Sposta la cella attiva di un passo di Invio o di Tab: dentro la
  /// selezione se è più di una cella, altrimenti accanto (Invio torna alla
  /// colonna dove una serie di Tab era cominciata). Falso se oltre non c'è
  /// niente.
  #advance(move: Move): boolean {
    const shape: Shape = {
      step: (axis, from, step) => this.#nextVisible(axis, from, step),
      visible: (axis, index) => ((axis === "row" ? this.#rows.sizes : this.#columns.sizes)[index] ?? 0) > 0,
    };
    const range = this.#selectedRange();
    const active = this.#active();
    const bounds = { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd };
    if (isMultiCell(bounds) && !mergeCovers(this.#merges(), range)) {
      const cell = nextInRange(bounds, active, move, shape);
      this.#selection = { ...this.#selection, active: cell };
      this.#ensureVisible(cell);
      this.#syncFormulaBar();
      this.#render();
      this.#selectionChanged();
      return true;
    }
    // Da un'unione si parte dal suo bordo.
    const merge = mergeAt(this.#merges(), active);
    const from = merge
      ? {
        row: move === "down" ? merge.row + merge.rows - 1 : active.row,
        column: move === "right" ? merge.column + merge.columns - 1 : active.column,
      }
      : active;
    const step = nextCell(from, move, this.#tabStart, shape);
    if (!step) return false;
    this.#select(step.cell, false);
    this.#tabStart = step.tabStart;
    return true;
  }

  #draftFromEditor(owner: "cell" | "formula", draft: string): void {
    const editing = this.#editing;
    if (editing?.owner !== owner) return;
    // I contorni dei riferimenti seguono la formula.
    const formula = draft.startsWith("=") || editing.draft.startsWith("=");
    editing.draft = draft;
    if (formula) this.#scheduleRender();
  }

  /// Il campo della formula aperta.
  #openEditor(): TextEngine | null {
    const editing = this.#editing;
    if (!editing) return null;
    return editing.owner === "cell" ? this.#cellEditor : this.#formulaEditor;
  }

  /// Dove un riferimento puntato andrebbe adesso: quello appena puntato, se
  /// il cursore è ancora alla sua fine, o un posto dove la formula aspetta un
  /// operando.
  #pointSlot(): { readonly from: number; readonly to: number } | null {
    const editor = this.#openEditor();
    if (!editor) return null;
    const text = editor.getDoc();
    const head = editor.cursorContext().head;
    const pointing = this.#pointing;
    if (pointing && pointing.text === text && head === pointing.to) return { from: pointing.from, to: pointing.to };
    this.#pointing = null;
    return operandSlot(text, head);
  }

  /// Scrive al posto di `slot` il riferimento da `anchor` a `focus`, con il
  /// cursore dopo, come una battuta.
  #writeReference(slot: { readonly from: number; readonly to: number }, anchor: GridPosition, focus: GridPosition): void {
    const editor = this.#openEditor();
    if (!editor) return;
    const reference = rangeA1({
      rowStart: Math.min(anchor.row, focus.row),
      rowEnd: Math.max(anchor.row, focus.row),
      columnStart: Math.min(anchor.column, focus.column),
      columnEnd: Math.max(anchor.column, focus.column),
    });
    if (!editor.applyUserEdit(slot.from, slot.to, reference)) return;
    editor.placeCursor(slot.from + reference.length);
    this.#pointing = { from: slot.from, to: slot.from + reference.length, text: editor.getDoc(), anchor, focus };
    this.#scheduleRender();
  }

  /// Un clic (o l'inizio di un trascinamento) su una cella mentre la formula
  /// aspetta un operando scrive il riferimento, e la cella resta aperta.
  #pointerReference(event: PointerEvent): boolean {
    const slot = this.#pointSlot();
    if (!slot) return false;
    const hit = this.#eventPosition(event) ?? this.#hit(event.clientX, event.clientY, false);
    if (!hit || hit.row === null || hit.column === null) return false;
    // Il fuoco resta nel campo della formula.
    event.preventDefault();
    const position = { row: hit.row, column: hit.column };
    this.#writeReference(slot, position, position);
    this.#drag = { kind: "point", anchor: position, x: event.clientX, y: event.clientY };
    this.#viewport.setPointerCapture?.(event.pointerId);
    return true;
  }

  /// Le frecce nel modo «Inserisci» dove la formula aspetta un operando:
  /// muovono il riferimento puntato (dalla cella aperta, la prima volta), e
  /// con Maiuscolo lo allargano.
  #pointByKey(move: "down" | "up" | "right" | "left", extend: boolean): boolean {
    const editing = this.#editing;
    if (!editing || editing.owner !== "cell") return false;
    const slot = this.#pointSlot();
    if (!slot) return false;
    const pointing = this.#pointing;
    const focus = this.#stepPosition(pointing?.focus ?? editing.position, move);
    this.#writeReference(slot, extend && pointing ? pointing.anchor : focus, focus);
    return true;
  }

  /// La cella accanto a `from` verso `move`, oltre righe e colonne nascoste.
  #stepPosition(from: GridPosition, move: "down" | "up" | "right" | "left"): GridPosition {
    const rows = move === "down" ? 1 : move === "up" ? -1 : 0;
    const columns = move === "right" ? 1 : move === "left" ? -1 : 0;
    let { row, column } = from;
    do {
      row += rows;
      column += columns;
    } while (
      row >= 0 && column >= 0 && row < this.#rows.sizes.length && column < this.#columns.sizes.length
      && (this.#rows.sizes[row] === 0 || this.#columns.sizes[column] === 0)
    );
    return this.#clampedPosition({ row, column });
  }

  /// Il contorno di ogni riferimento della formula aperta che sta sul foglio
  /// mostrato, del colore che ha nel testo.
  #referenceMarks(): HTMLElement[] {
    const draft = this.#editing?.draft ?? "";
    if (!draft.startsWith("=")) return [];
    const name = this.#sheet().name.toLowerCase();
    return formulaReferences(draft).flatMap((reference) => {
      const bang = reference.text.lastIndexOf("!");
      if (bang >= 0) {
        const sheet = reference.text.slice(0, bang).replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
        if (sheet.toLowerCase() !== name) return [];
      }
      const range = parseRangeA1(reference.text.slice(bang + 1).toUpperCase());
      const box = range ? this.#rangeBox(range) : null;
      if (!box) return [];
      const element = document.createElement("div");
      element.className = `grid-formula-ref grid-formula-ref-${reference.color + 1}`;
      element.setAttribute("aria-hidden", "true");
      this.#place(element, box.left, box.top, box.width, box.height);
      return [element];
    });
  }

  #commitAfterBlur(owner: "cell" | "formula"): void {
    queueMicrotask(() => {
      if (this.#destroyed || this.#editing?.owner !== owner) return;
      // Un clic che punta un riferimento può portare via il fuoco: torna al
      // campo della formula, che resta aperto.
      if (this.#drag?.kind === "point") {
        this.#openEditor()?.focus();
        return;
      }
      const host = owner === "cell" ? this.#cellEditorHost : this.#formulaHost;
      // Il fuoco è andato altrove di sua volontà: la cella si conferma e il
      // fuoco resta dove è andato.
      if (!host.contains(document.activeElement)) this.#finishEditing(true, "input", false);
    });
  }

  #finishEditing(commit: boolean, origin: EditorChangeOrigin, restoreFocus = true): void {
    const editing = this.#editing;
    if (!editing) return;
    this.#editing = null;
    this.#pointing = null;
    this.#draftNotice.hidden = true;
    this.#detachCellEditor();
    this.#cellEditorHost.hidden = true;
    this.#cellEditorHost.setAttribute("aria-hidden", "true");
    this.#options.onEditMode?.();
    if (commit && editing.draft !== editing.original) {
      this.#commitCells([{ position: editing.position, after: fileInput(editing.draft, this.#decimal) }], origin, true);
    }
    this.#syncFormulaBar();
    this.#render();
    // Il fuoco torna alla griglia, se nel frattempo non si è aperta un'altra
    // cella: le toglierebbe il fuoco, e la confermerebbe.
    if (restoreFocus) queueMicrotask(() => {
      if (!this.#destroyed && !this.#editing) this.#viewport.focus();
    });
  }

  /// Dopo una riapertura: una bozza la cui cella è cambiata sotto resta, e
  /// si chiede quale tenere; su un foglio che non c'è più si chiude, e lo si
  /// dice. Niente si perde in silenzio.
  #checkDraft(top: boolean): void {
    const editing = this.#editing;
    if (!editing) return;
    if (top) {
      this.#finishEditing(false, "input", false);
      if (editing.draft !== editing.original) this.#refuse(t("grid.draft.gone", { draft: editing.draft }));
      return;
    }
    if (!this.#windowAt(editing.position)) return;
    const now = localInput(this.#workbookCell(editing.position)?.bytes.input ?? "", this.#decimal);
    if (now === editing.original || now === editing.theirs) return;
    if (now === editing.draft) {
      editing.original = now;
      editing.theirs = null;
      this.#draftNotice.hidden = true;
      return;
    }
    editing.theirs = now;
    this.#draftText.textContent = t("grid.draft.changed", { cell: cellA1(editing.position), theirs: now });
    this.#draftNotice.hidden = false;
  }

  /// «Tieni la tua»: la bozza resta, e confermata scrive sopra la cella nuova.
  #keepDraft(): void {
    const editing = this.#editing;
    if (!editing || editing.theirs === null) return;
    editing.original = editing.theirs;
    editing.theirs = null;
    this.#draftNotice.hidden = true;
    (editing.owner === "cell" ? this.#cellEditor : this.#formulaEditor).focus();
  }

  /// «Prendi quella nuova»: la bozza si chiude e la cella mostra ciò che c'è.
  #takeTheirs(): void {
    if (this.#editing?.theirs === null) return;
    this.#finishEditing(false, "input");
  }

  #positionEditor(position: GridPosition): void {
    const inCell = this.#cellEditorHost.parentElement?.classList.contains("grid-cell") ?? false;
    const merge = mergeAt(this.#merges(), position);
    const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
    this.#place(
      this.#cellEditorHost,
      inCell ? 0 : this.#columnLeft(position.column),
      inCell ? 0 : this.#frame.columnHeader + this.#rows.offsets[position.row],
      this.#columns.offsets[lastColumn + 1] - this.#columns.offsets[position.column],
      this.#rows.offsets[lastRow + 1] - this.#rows.offsets[position.row],
    );
  }

  /// Riscrive le celle di `patches` della history: annullare e rifare.
  #commit(patches: readonly GridCellPatch[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    const sheet = this.#sheet();
    const writes: CellWrite[] = [];
    for (const patch of patches) {
      const position = positionOf(sheet, patch.coordinate);
      if (!position) {
        this.#refuse(t("grid.workbook.not_loaded"));
        return false;
      }
      writes.push({ position, after: patch.after?.input ?? "" });
    }
    return this.#commitCells(writes, origin, recordHistory);
  }

  #clearSelection(): void {
    if (this.#readOnly) return;
    const range = normalizedSelection(this.#selection);
    if (![range, ...this.#others].every((area) => this.#rangeRead(area))) {
      this.#refuse(t("grid.workbook.not_loaded"));
      return;
    }
    const writes: CellWrite[] = [];
    for (const [key, cell] of this.#view?.sheets[this.#sheetIndex]?.cells ?? []) {
      const position = keyPosition(key);
      if (cell.bytes.input !== "" && this.#inSelection(range, position.row, position.column)) writes.push({ position, after: "" });
    }
    this.#commitCells(writes, "input", true);
  }

  /// Copia scrive il TSV degli input e una tabella HTML di ciò che si
  /// vede, come i fogli di calcolo; toglie le formiche di un taglio.
  #copy(event: ClipboardEvent): void {
    if (!event.clipboardData) return;
    event.preventDefault();
    // Come in Excel: più intervalli non si copiano insieme.
    if (this.#others.length) {
      this.#refuse(t("grid.multi.refused"));
      return;
    }
    const { text, html } = this.#clipboard();
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    this.#copied = { sheet: this.#sheet().id, range: this.#selectedRange(), text, move: false };
    if (this.#cutMark) {
      this.#cutMark = null;
      this.#render();
    }
  }

  /// Taglia non svuota subito: segna l'intervallo con le formiche, e
  /// l'incolla che segue lo sposta. Esc toglie il segno.
  #cut(event: ClipboardEvent): void {
    if (this.#readOnly || !event.clipboardData) return;
    this.#copy(event);
    if (this.#others.length) return;
    this.#cutMark = { sheet: this.#sheet().id, range: this.#selectedRange(), text: this.#clipboard().text };
    this.#copied = { ...this.#cutMark, move: true };
    this.#render();
  }

  #paste(event: ClipboardEvent): void {
    if (this.#readOnly || !event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const copied = this.#copied;
    if (copied && copied.text === text && this.#pasteFrom(copied)) return;
    const mark = this.#cutMark;
    if (mark && mark.text === text && mark.sheet === this.#sheet().id) {
      this.#pasteCut(mark);
      return;
    }
    this.#pasteRows(clipboardRows(text, event.clipboardData.getData("text/html")));
  }

  /// L'incolla di ciò che si è copiato dalla cartella, quando il catalogo
  /// serve `fub.pasteFrom`: dall'angolo della selezione, ripetuto dove la
  /// selezione ne contiene più copie. Un taglio si incolla una volta.
  #pasteFrom(copied: Copied): boolean {
    if (!this.commandable() || !this.#serves(PASTE_FROM) || this.#others.length) return false;
    const params = { source: rangeA1(copied.range), sourceSheet: copied.sheet, move: copied.move };
    if (!this.command(PASTE_FROM, JSON.stringify(params))) return false;
    if (copied.move) {
      this.#copied = null;
      this.#cutMark = null;
      this.#render();
    }
    return true;
  }

  #clipboard(): { readonly text: string; readonly html: string } {
    const range = this.#selectedRange();
    const rows: ClipboardCell[][] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      const cells: ClipboardCell[] = [];
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const bytes = this.#workbookCell({ row, column })?.bytes;
        const input = this.#cellAt({ row, column })?.input ?? "";
        cells.push({ input, shown: bytes?.display || input });
      }
      rows.push(cells);
    }
    return clipboardData(rows);
  }

  #pasteTsv(text: string): void {
    this.#pasteRows(clipboardRows(text, ""));
  }

  /// Incolla dall'angolo in alto a sinistra della selezione. Un valore, o un
  /// blocco che la selezione contiene un numero intero di volte, la riempie.
  /// Dopo, la selezione è ciò che si è scritto.
  #pasteRows(values: readonly (readonly string[])[]): void {
    const block = { rows: values.length, columns: Math.max(0, ...values.map((row) => row.length)) };
    const range = this.#selectedRange();
    const targets = pasteTargets(
      { r0: range.rowStart, c0: range.columnStart, r1: range.rowEnd, c1: range.columnEnd },
      block,
    );
    if (!targets.length) return;
    const writes = new Map<string, CellWrite>();
    for (const target of targets) {
      values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
        const position = { row: target.r0 + rowOffset, column: target.c0 + columnOffset };
        writes.set(`${position.row}:${position.column}`, { position, after: fileInput(value, this.#decimal) });
      }));
    }
    const last = targets[targets.length - 1];
    this.#writePasted([...writes.values()], { rowStart: targets[0].r0, columnStart: targets[0].c0, rowEnd: last.r1, columnEnd: last.c1 });
  }

  /// L'incolla dopo un taglio: gli input vanno all'angolo della selezione e
  /// le celle tagliate che restano fuori si svuotano, in un passo solo.
  #pasteCut(mark: { readonly range: GridRange; readonly text: string }): void {
    const target = this.#selectedRange();
    const rows = mark.range.rowEnd - mark.range.rowStart;
    const columns = mark.range.columnEnd - mark.range.columnStart;
    const to: GridRange = {
      rowStart: target.rowStart,
      columnStart: target.columnStart,
      rowEnd: target.rowStart + rows,
      columnEnd: target.columnStart + columns,
    };
    const inside = (range: GridRange, row: number, column: number) =>
      row >= range.rowStart && row <= range.rowEnd && column >= range.columnStart && column <= range.columnEnd;
    const writes: CellWrite[] = [];
    for (let row = mark.range.rowStart; row <= mark.range.rowEnd; row += 1) {
      for (let column = mark.range.columnStart; column <= mark.range.columnEnd; column += 1) {
        const input = this.#cellAt({ row, column })?.input ?? "";
        const moved = { row: row - mark.range.rowStart + to.rowStart, column: column - mark.range.columnStart + to.columnStart };
        if (!inside(to, row, column) && input !== "") writes.push({ position: { row, column }, after: "" });
        writes.push({ position: moved, after: input });
      }
    }
    this.#cutMark = null;
    this.#writePasted(writes, to);
  }

  #writePasted(writes: readonly CellWrite[], range: GridRange): void {
    const sheet = this.#sheet();
    const fits = writes.filter(({ position }) => position.row < sheet.rows.length && position.column < sheet.columns.length);
    if (!this.#commitCells(fits, "input", true)) {
      this.#render();
      return;
    }
    const anchor = { row: range.rowStart, column: range.columnStart };
    const focus = this.#clampedPosition({ row: range.rowEnd, column: range.columnEnd });
    this.#others = [];
    this.#selection = { anchor, focus };
    this.#syncFormulaBar();
    this.#render();
    this.#selectionChanged();
  }

  #pointerDown(event: PointerEvent): void {
    // Solo il tasto principale; un evento senza tasto vale come quello.
    if (event.button > 0) return;
    // Una formula aperta che aspetta un operando prende il riferimento.
    if (this.#editing && this.#pointerReference(event)) return;
    // La cella aperta si conferma prima di scegliere altro, come in un foglio
    // di calcolo; il disegno che segue tiene la cella sotto il puntatore.
    if (this.#editing?.owner === "cell") this.#finishEditing(true, "input", false);
    const object = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-object") : null;
    if (object && this.#objectPointerDown(event, object)) return;
    const edge = this.#resizeEdge(event.clientX, event.clientY);
    if (edge) {
      event.preventDefault();
      const size = (edge.axis === "column" ? this.#columns : this.#rows).sizes[edge.index];
      this.#resize = { ...edge, from: edge.axis === "column" ? event.clientX : event.clientY, size, now: size };
      this.#viewport.setPointerCapture?.(event.pointerId);
      this.#viewport.focus();
      this.#render();
      return;
    }
    if (this.#onSelectionEdge(event.clientX, event.clientY)) {
      const hit = this.#hit(event.clientX, event.clientY, true);
      if (hit && hit.row !== null && hit.column !== null) {
        event.preventDefault();
        const source = this.#selectedRange();
        // La cella presa dentro la selezione, più vicina al punto.
        const grab = {
          row: Math.min(source.rowEnd, Math.max(source.rowStart, hit.row)) - source.rowStart,
          column: Math.min(source.columnEnd, Math.max(source.columnStart, hit.column)) - source.columnStart,
        };
        this.#drag = { kind: "move", source, grab, target: source, x: event.clientX, y: event.clientY };
        this.#viewport.setPointerCapture?.(event.pointerId);
        this.#viewport.focus();
        this.#render();
        return;
      }
    }
    const handle = event.target instanceof Element && event.target.closest(".grid-fill-handle");
    if (handle && this.#fillServed()) {
      event.preventDefault();
      const source = this.#selectedRange();
      this.#drag = { kind: "fill", source, target: source, x: event.clientX, y: event.clientY };
      this.#viewport.setPointerCapture?.(event.pointerId);
      this.#viewport.focus();
      this.#render();
      return;
    }
    // Su una cella vale la cella; fuori (le intestazioni non prendono il
    // puntatore) vale il punto.
    const cell = this.#eventPosition(event);
    const hit = cell ?? this.#hit(event.clientX, event.clientY, false);
    if (!hit) return;
    event.preventDefault();
    if (this.#selectedObject !== null) this.#selectObject(null);
    const sheet = this.#sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    // Sull'intestazione di una colonna si prende la colonna intera, su quella
    // di una riga la riga, sull'angolo il foglio, come in Excel.
    const kind = hit.row === null && hit.column === null ? "all" : hit.row === null ? "columns" : hit.column === null ? "rows" : "cells";
    // Ctrl+clic (e Ctrl+trascina) aggiunge un intervallo a quelli scelti;
    // Maiuscolo estende l'ultimo; un clic semplice ricomincia.
    const adding = (event.ctrlKey || event.metaKey) && !event.shiftKey && kind !== "all";
    if (adding) this.#others = this.#rangesOf(withRange(this.#others.map(tableRange), tableRange(this.#selectedRange())));
    else if (!event.shiftKey && !this.#adding) this.#others = [];
    if (kind === "all") {
      this.#others = [];
      this.#selection = {
        anchor: { row: lastRow, column: lastColumn },
        focus: { row: 0, column: 0 },
        active: { row: this.#edgeVisible("row", false), column: this.#edgeVisible("column", false) },
      };
    } else {
      const position = this.#anchorOf({ row: hit.row ?? 0, column: hit.column ?? 0 });
      const anchor = event.shiftKey ? this.#selection.anchor : position;
      this.#tabStart = null;
      this.#drag = { kind, anchor, x: event.clientX, y: event.clientY };
      this.#selection = this.#dragSelection(kind, anchor, position);
    }
    this.#viewport.setPointerCapture?.(event.pointerId);
    this.#viewport.focus();
    this.#syncFormulaBar();
    this.#render();
    this.#selectionChanged();
  }

  #pointerMove(event: PointerEvent): void {
    if (this.#objectGesture) {
      this.#objectPointerMove(event, this.#objectGesture);
      return;
    }
    const resize = this.#resize;
    if (resize) {
      if (event.buttons === 0) {
        this.#endResize(false);
        return;
      }
      const point = resize.axis === "column" ? event.clientX : event.clientY;
      // Fino a zero, che nasconde, come in Excel.
      resize.now = Math.max(0, resize.size + point - resize.from);
      this.#render();
      return;
    }
    const drag = this.#drag;
    if (!drag) {
      const edge = this.#resizeEdge(event.clientX, event.clientY);
      this.#viewport.classList.toggle("resize-column", edge?.axis === "column");
      this.#viewport.classList.toggle("resize-row", edge?.axis === "row");
      this.#viewport.classList.toggle("move-selection", !edge && this.#onSelectionEdge(event.clientX, event.clientY));
      return;
    }
    if (event.buttons === 0) {
      this.#endDrag(false, false);
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    this.#dragTo(drag);
    this.#dragScrollIfOutside(drag);
  }

  /// Porta il gesto al punto `drag.x`, `drag.y`: fuori dalla griglia vale il
  /// bordo, perché il gesto continua mentre la griglia scorre.
  #dragTo(drag: CellDrag): void {
    const hit = this.#hit(drag.x, drag.y, true);
    if (!hit) return;
    const position = { row: hit.row ?? 0, column: hit.column ?? 0 };
    if (drag.kind === "point") {
      const pointing = this.#pointing;
      if (!pointing || samePosition(pointing.focus, position)) return;
      this.#writeReference({ from: pointing.from, to: pointing.to }, drag.anchor, position);
      return;
    }
    if (drag.kind === "move") {
      const sheet = this.#sheet();
      const rows = drag.source.rowEnd - drag.source.rowStart;
      const columns = drag.source.columnEnd - drag.source.columnStart;
      const rowStart = Math.max(0, Math.min(Math.max(0, sheet.rows.length - 1 - rows), position.row - drag.grab.row));
      const columnStart = Math.max(0, Math.min(Math.max(0, sheet.columns.length - 1 - columns), position.column - drag.grab.column));
      const target = { rowStart, columnStart, rowEnd: rowStart + rows, columnEnd: columnStart + columns };
      if (sameRange(target, drag.target)) return;
      drag.target = target;
      this.#render();
      return;
    }
    if (drag.kind === "fill") {
      const target = fillTarget(drag.source, position);
      if (sameRange(target, drag.target)) return;
      drag.target = target;
      this.#render();
      return;
    }
    const next = this.#dragSelection(drag.kind, drag.anchor, position);
    if (samePosition(next.focus, this.#selection.focus) && samePosition(next.anchor, this.#selection.anchor)) return;
    this.#selection = next;
    this.#syncFormulaBar();
    this.#render();
    this.#selectionChanged();
  }

  /// La selezione di un gesto da `anchor` a `position`: righe e colonne
  /// intere vanno da un capo all'altro del foglio, con la cella attiva (il
  /// fuoco) sulla prima colonna o sulla prima riga, come in Excel.
  #dragSelection(kind: "cells" | "rows" | "columns", anchor: GridPosition, position: GridPosition): GridSelection {
    const sheet = this.#sheet();
    const lastRow = Math.max(0, sheet.rows.length - 1);
    const lastColumn = Math.max(0, sheet.columns.length - 1);
    // Righe e colonne intere: la cella attiva è la prima visibile di quella
    // da cui si è partiti.
    if (kind === "rows") {
      return {
        anchor: { row: anchor.row, column: lastColumn },
        focus: { row: position.row, column: 0 },
        active: { row: anchor.row, column: this.#edgeVisible("column", false) },
      };
    }
    if (kind === "columns") {
      return {
        anchor: { row: lastRow, column: anchor.column },
        focus: { row: 0, column: position.column },
        active: { row: this.#edgeVisible("row", false), column: anchor.column },
      };
    }
    return { anchor, focus: position };
  }

  /// Fuori dal bordo la griglia scorre da sé verso il puntatore, più svelta
  /// quanto più è lontano, finché il gesto finisce o il puntatore rientra.
  #dragScrollIfOutside(drag: CellDrag): void {
    const step = this.#dragScrollStep(drag);
    if (!step) {
      this.#stopDragScroll();
      return;
    }
    if (this.#dragScroll !== null) return;
    this.#dragScroll = setInterval(() => {
      const current = this.#drag;
      const next = current ? this.#dragScrollStep(current) : null;
      if (!current || !next) {
        this.#stopDragScroll();
        return;
      }
      this.#viewport.scrollBy(next.x, next.y);
      this.#dragTo(current);
    }, DRAG_SCROLL_MS);
  }

  #dragScrollStep(drag: CellDrag): { x: number; y: number } | null {
    const rect = this.#viewport.getBoundingClientRect();
    const frame = this.#frame;
    const left = rect.left + this.#viewport.clientLeft + frame.rowHeader;
    const top = rect.top + this.#viewport.clientTop + frame.columnHeader;
    const right = rect.left + this.#viewport.clientLeft + this.#viewport.clientWidth;
    const bottom = rect.top + this.#viewport.clientTop + this.#viewport.clientHeight;
    const speed = (distance: number) => Math.min(DRAG_SCROLL_MAX, Math.max(4, Math.round(distance / 2)));
    // Righe intere non scorrono di lato, colonne intere non scorrono in giù.
    const x = drag.kind === "rows" ? 0 : drag.x > right ? speed(drag.x - right) : drag.x < left ? -speed(left - drag.x) : 0;
    const y = drag.kind === "columns" ? 0 : drag.y > bottom ? speed(drag.y - bottom) : drag.y < top ? -speed(top - drag.y) : 0;
    return x === 0 && y === 0 ? null : { x, y };
  }

  #stopDragScroll(): void {
    if (this.#dragScroll === null) return;
    clearInterval(this.#dragScroll);
    this.#dragScroll = null;
  }

  /// Chiude il gesto. Il riempimento tirato fuori dalla sorgente dà
  /// `edit.autoFill`; con Ctrl tirato, il modo alternato di Excel (un numero
  /// solo conta, una serie si copia).
  #endDrag(commit: boolean, alternate: boolean): void {
    const drag = this.#drag;
    this.#stopDragScroll();
    if (!drag) return;
    this.#drag = null;
    if (drag.kind === "move") {
      if (commit && !sameRange(drag.source, drag.target)) this.#moveRange(drag.source, drag.target, alternate);
      else this.#render();
      return;
    }
    if (drag.kind !== "fill") return;
    if (commit && !sameRange(drag.source, drag.target)) this.#autoFill(drag.source, drag.target, alternate);
    else this.#render();
  }

  #autoFill(source: GridRange, target: GridRange, alternate: boolean): void {
    // La cella attiva resta al primo angolo, il riempimento è selezionato.
    this.#others = [];
    this.#selection = {
      anchor: { row: target.rowStart, column: target.columnStart },
      focus: { row: target.rowEnd, column: target.columnEnd },
    };
    this.#syncFormulaBar();
    this.#render();
    this.#selectionChanged();
    const params: Record<string, string> = { source: rangeA1(source), target: rangeA1(target) };
    if (alternate) params.mode = "alternate";
    this.command("edit.autoFill", JSON.stringify(params));
  }

  /// Il doppio clic sul quadratino, come in Excel: riempie in giù fin dove
  /// arriva la colonna accanto (quella a sinistra, o se è vuota quella a
  /// destra), nelle righe che la griglia ha letto.
  #fillToNeighbour(): void {
    if (!this.#fillServed()) return;
    const source = this.#selectedRange();
    const filled = (column: number, row: number) => column >= 0 && (this.#workbookCell({ row, column })?.cell.input ?? "") !== "";
    const reach = (column: number): number => {
      let row = source.rowEnd;
      while (row + 1 < this.#sheet().rows.length && filled(column, row + 1)) row += 1;
      return row;
    };
    const last = Math.max(reach(source.columnStart - 1), reach(source.columnEnd + 1));
    if (last <= source.rowEnd) return;
    this.#autoFill(source, { ...source, rowEnd: last }, false);
  }

  /// Se il quadratino di riempimento si può tirare: una sessione a comandi che
  /// serve `edit.autoFill`, nessuna cella aperta, nessun oggetto scelto.
  #fillServed(): boolean {
    return this.commandable() && this.#serves("edit.autoFill") && !this.#editing && this.#selectedObject === null && !this.#others.length;
  }

  /// La cella che comanda in `position`: l'angolo dell'unione che la copre.
  #anchorOf(position: GridPosition): GridPosition {
    const clamped = this.#clampedPosition(position);
    const merge = mergeAt(this.#merges(), clamped);
    return merge ? { row: merge.row, column: merge.column } : clamped;
  }

  /// La riga e la colonna sotto il punto `x`, `y` dello schermo; `null` dove
  /// c'è un'intestazione (la riga sull'intestazione delle colonne, la colonna
  /// su quella delle righe). Fuori dalla griglia, o sulle sue barre di
  /// scorrimento, niente; con `clampToGrid` vale il bordo più vicino, e le
  /// intestazioni contano come la prima riga o colonna che si vede.
  #hit(x: number, y: number, clampToGrid: boolean): { row: number | null; column: number | null } | null {
    const frame = this.#frame;
    const rect = this.#viewport.getBoundingClientRect();
    let px = x - rect.left - this.#viewport.clientLeft;
    let py = y - rect.top - this.#viewport.clientTop;
    const width = this.#viewport.clientWidth;
    const height = this.#viewport.clientHeight;
    if (clampToGrid) {
      px = Math.min(Math.max(px, frame.rowHeader), width - 1);
      py = Math.min(Math.max(py, frame.columnHeader), height - 1);
    } else if (px < 0 || py < 0 || px >= width || py >= height) {
      return null;
    }
    const axis = (point: number, header: number, frozen: number, scroll: number, layout: AxisLayout): number | null => {
      if (point < header) return null;
      const inside = point - header;
      const offset = inside < frozen ? inside : inside + scroll;
      if (!layout.sizes.length || offset >= layout.total) return clampToGrid ? Math.max(0, layout.sizes.length - 1) : null;
      return indexAt(layout, offset);
    };
    const column = axis(px, frame.rowHeader, frame.frozenWidth, this.#viewport.scrollLeft, this.#columns);
    const row = axis(py, frame.columnHeader, frame.frozenHeight, this.#viewport.scrollTop, this.#rows);
    // Oltre l'ultima riga o colonna del foglio non c'è niente da prendere.
    if (!clampToGrid && ((px >= frame.rowHeader && column === null) || (py >= frame.columnHeader && row === null))) return null;
    return { row, column };
  }

  #eventPosition(event: Event): GridPosition | null {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-cell") : null;
    if (!target) return null;
    const row = Number(target.dataset.row);
    const column = Number(target.dataset.column);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  /// Scorre fino a `position`. Una riga o una colonna bloccata si vede
  /// sempre; le altre devono uscire da sotto quelle bloccate.
  #ensureVisible(position: GridPosition): void {
    const frame = this.#frame;
    const merge = mergeAt(this.#merges(), position);
    const lastRow = merge ? merge.row + merge.rows - 1 : position.row;
    const lastColumn = merge ? merge.column + merge.columns - 1 : position.column;
    if (position.column >= frame.frozenColumns) {
      const before = frame.rowHeader + frame.frozenWidth;
      const left = frame.rowHeader + this.#columns.offsets[position.column];
      const right = frame.rowHeader + this.#columns.offsets[lastColumn + 1];
      if (left < this.#viewport.scrollLeft + before) this.#viewport.scrollLeft = Math.max(0, left - before);
      else if (right > this.#viewport.scrollLeft + this.#viewport.clientWidth) this.#viewport.scrollLeft = Math.min(left - before, right - this.#viewport.clientWidth);
    }
    if (position.row >= frame.frozenRows) {
      const before = frame.columnHeader + frame.frozenHeight;
      const top = frame.columnHeader + this.#rows.offsets[position.row];
      const bottom = frame.columnHeader + this.#rows.offsets[lastRow + 1];
      if (top < this.#viewport.scrollTop + before) this.#viewport.scrollTop = Math.max(0, top - before);
      else if (bottom > this.#viewport.scrollTop + this.#viewport.clientHeight) this.#viewport.scrollTop = Math.min(top - before, bottom - this.#viewport.clientHeight);
    }
  }

  /// Le richieste che cambiano lo stato del provider, una dopo l'altra:
  /// ognuna parte da ciò che ha lasciato la precedente, ed è ciò che rende
  /// [`#confirmedJournal`] la base giusta del diff successivo.
  #enqueueProtocol(step: () => Promise<void>): void {
    this.#providerCommitTail = this.#providerCommitTail
      .catch(() => {})
      .then(step)
      .catch(() => {});
  }
}
