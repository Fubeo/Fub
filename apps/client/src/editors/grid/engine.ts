import type {
  GridApplyRequest,
  GridBytesCell,
  GridBytesSession,
  GridBytesWindow,
  GridCellPatch as GridRequestPatch,
  GridCellStyle as GridBytesStyle,
  GridCommit,
  GridInvalidation,
  GridSession,
  GridSurfaceSpec,
  GridWindow,
  GridWindowRequest,
  SheetCellValue,
} from "../../host/contract";
import { GRID_BYTES_PROTOCOL_VERSION } from "../../host/contract";
import { errorText, isErrorKind } from "../../host/errors";
import { operationFromText, type EditorChangeOrigin, type TextOperation } from "../core/text-operation";
import { parseTsv } from "../core/tsv";
import {
  gridJournalEntry,
  gridJournalText,
  parseGridJournal,
  recordGridJournal,
  type GridJournal,
} from "../../state/grid-journal";
import type { Theme } from "../../theme/theme";
import { t, onLanguage, plural, resolvedLanguage, type Key } from "../../i18n/strings";
import { createTabs, type TabsHandle } from "../../kit";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { createTextEngine, type TextEngine } from "../text/engine";
import { createFormulaProfile } from "../text/profiles/formula";
import {
  cellAt,
  columnLabel,
  coordinateAt,
  normalizedSelection,
  parseWorkbook,
  positionOf,
  type GridPosition,
  type GridSelection,
  type GridSheet,
  type GridWorkbook,
  type GridCell,
} from "./model";
import {
  applyGridPatches,
  commitGridPatches,
  inputPatch,
  inverseGridPatches,
  isGridOperation,
  pastePatches,
  selectionText,
  selectionTsv,
  type GridCellPatch,
  type GridOperation,
} from "./operation";
import {
  cellKey,
  decimalSeparator,
  keyPosition,
  fileInput,
  localInput,
  validateBytesSession,
  validateBytesWindow,
  workbookView,
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
export const MAX_GRID_SESSION_SHEETS = 1_024;
export const MAX_GRID_SESSION_ROWS = 1_048_576;
export const MAX_GRID_SESSION_COLUMNS = 16_384;
export const MAX_GRID_SESSION_WINDOWS = 256;
export const MAX_GRID_INVALIDATED_CELLS = 32_768;
/// Le parti di una cartella che la griglia non disegna, per codice d'avviso
/// di `fub-format-xlsx` (`not-shown-…`).
const NOT_SHOWN_KEYS: Readonly<Record<string, Key>> = {
  "not-shown-merges": "grid.workbook.part.merges",
  "not-shown-charts": "grid.workbook.part.charts",
  "not-shown-images": "grid.workbook.part.images",
  "not-shown-shapes": "grid.workbook.part.shapes",
  "not-shown-comments": "grid.workbook.part.comments",
  "not-shown-conditional-formats": "grid.workbook.part.conditional_formats",
  "not-shown-sparklines": "grid.workbook.part.sparklines",
};
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
};

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
  readonly closeGridBytes: (surface: string, instance: string) => Promise<void>;
  readonly openGrid: (surface: string, source: string, revision: string) => Promise<GridSession>;
  readonly gridWindow: (surface: string, instance: string, request: GridWindowRequest) => Promise<GridWindow>;
  readonly applyGrid: (surface: string, instance: string, request: GridApplyRequest) => Promise<GridCommit>;
  readonly reloadGrid: (surface: string, instance: string, source: string, revision: string) => Promise<GridSession>;
  readonly closeGrid: (surface: string, instance: string) => Promise<void>;
}

export interface GridChange {
  readonly text: string;
  /**
   * Una conferma del provider che riscrive i byte di un commit già pubblicato
   * non ha patch di celle da dare: porta un'operazione di solo testo, e chi la
   * riceve rilegge il sorgente.
   */
  readonly operation: GridOperation | TextOperation;
  readonly origin: EditorChangeOrigin;
}

export interface GridEngineOptions {
  readonly surfaceId: string;
  /**
   * `sheet` (di serie) è il foglio di Fub, il cui testo è il sorgente; con
   * `workbook` il testo è il giornale delle celle di una cartella di Excel, e
   * la griglia si apre sui byte con la versione 2 del protocollo
   * (`editors/grid/workbook.ts`).
   */
  readonly profile?: "sheet" | "workbook";
  readonly formatId?: string | null;
  readonly revision?: string;
  /// Il documento, per aprire la versione 2 sui suoi byte.
  readonly documentId?: string;
  /// La revisione dei byte da cui il giornale discende adesso: cambia a ogni
  /// salvataggio. Senza, si usa `revision`.
  readonly base?: () => string | null;
  readonly onChange: (change: GridChange) => void;
  readonly onSelectionChange: () => void;
  readonly grid?: GridHost;
  readonly theme?: Theme;
}
interface AxisLayout {
  readonly offsets: number[];
  readonly sizes: number[];
  readonly total: number;
}

interface EditingState {
  readonly position: GridPosition;
  readonly original: string;
  draft: string;
  readonly owner: "cell" | "formula";
}

function axisLayout(entries: readonly { hidden: boolean; height?: number; width?: number }[], fallback: number, dimension: "height" | "width"): AxisLayout {
  const offsets = new Array<number>(entries.length + 1);
  const sizes = new Array<number>(entries.length);
  offsets[0] = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const declared = entries[index][dimension];
    const size = entries[index].hidden
      ? 0
      : typeof declared === "number" && Number.isFinite(declared) && declared > 0
        ? declared
        : fallback;
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
function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.row === right.row && left.column === right.column;
}

function key(sheet: string, row: string, column: string): string {
  return `${sheet}\u0000${row}\u0000${column}`;
}

function displayValue(value: SheetCellValue | undefined, fallback: string): string {
  if (!value) return fallback;
  switch (value.kind) {
    case "blank": return "";
    case "number": return String(value.value);
    case "text": return value.value;
    case "boolean": return value.value ? "TRUE" : "FALSE";
    case "error": {
      const errors: Readonly<Record<typeof value.value, string>> = {
        parse: "#PARSE!",
        ref: "#REF!",
        name: "#NAME?",
        value: "#VALUE!",
        div_zero: "#DIV/0!",
        num: "#NUM!",
        cycle: "#CYCLE!",
      };
      return errors[value.value];
    }
  }
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

function rowFromProtocol(row: { id: string; index: number; height: number | null; hidden: boolean }) {
  return { id: row.id, height: row.height ?? undefined, hidden: row.hidden };
}

function columnFromProtocol(column: { id: string; index: number; width: number | null; hidden: boolean }) {
  return { id: column.id, width: column.width ?? undefined, hidden: column.hidden };
}



function workbookFromWindows(
  session: GridSession,
  windows: readonly GridWindow[],
  base: GridWorkbook | null = null,
  activeIdOverride?: string,
): GridWorkbook {
  const baseSheets = new Map((base?.sheets ?? []).map((sheet) => [sheet.id, sheet]));
  const activeId = activeIdOverride ?? base?.sheets[0]?.id ?? session.sheets[0]?.id;
  const sheets = session.sheets.map((sessionSheet) => {
    const baseSheet = baseSheets.get(sessionSheet.id);
    if (sessionSheet.id !== activeId) {
      return {
        id: sessionSheet.id,
        name: sessionSheet.name,
        rows: baseSheet?.rows ?? [],
        columns: baseSheet?.columns ?? [],
        ...(baseSheet?.cells ? { cells: [...baseSheet.cells] } : {}),
      };
    }
    const sheetWindows = windows.filter((window) => window.sheet === sessionSheet.id);
    const loadedRows = new Map(sheetWindows.flatMap((window) => window.rows.map((row) => [row.index, row] as const)));
    const loadedColumns = new Map(sheetWindows.flatMap((window) => window.columns.map((column) => [column.index, column] as const)));
    const rows = Array.from({ length: sessionSheet.row_count }, (_, index) => {
      const row = loadedRows.get(index);
      if (row) return rowFromProtocol(row);
      const prior = baseSheet?.rows[index];
      return prior ? { ...prior } : { id: `__grid_row_${sessionSheet.id}_${index}`, hidden: false };
    });
    const columns = Array.from({ length: sessionSheet.column_count }, (_, index) => {
      const column = loadedColumns.get(index);
      if (column) return columnFromProtocol(column);
      const prior = baseSheet?.columns[index];
      return prior ? { ...prior } : { id: `__grid_column_${sessionSheet.id}_${index}`, hidden: false };
    });
    const loadedRowsById = new Set([...loadedRows.values()].map((row) => row.id));
    const loadedColumnsById = new Set([...loadedColumns.values()].map((column) => column.id));
    const cells = new Map<string, GridCell>();
    for (const cell of baseSheet?.cells ?? []) {
      if (loadedRowsById.has(cell.row) && loadedColumnsById.has(cell.column)) {
        cells.set(`${cell.row}\u0000${cell.column}`, { ...cell, style: cell.style ? { ...cell.style } : undefined });
      }
    }
    for (const window of sheetWindows) {
      for (const cell of window.cells) {
        const style = {
          ...(cell.style.bold ? { bold: true } : {}),
          ...(cell.style.italic ? { italic: true } : {}),
          ...(cell.style.text_color === null ? {} : { text_color: cell.style.text_color }),
          ...(cell.style.fill_color === null ? {} : { fill_color: cell.style.fill_color }),
          ...(cell.style.horizontal === null ? {} : { horizontal: cell.style.horizontal }),
          ...(cell.style.number_format === null ? {} : { number_format: cell.style.number_format }),
        };
        cells.set(`${cell.key.row}\u0000${cell.key.column}`, {
          row: cell.key.row,
          column: cell.key.column,
          input: cell.input,
          ...(Object.keys(style).length ? { style } : {}),
        });
      }
    }
    return { id: sessionSheet.id, name: sessionSheet.name, rows, columns, cells: [...cells.values()] };
  });
  return { version: 1, sheets };
}

function valuesFromWindows(windows: readonly GridWindow[]): Map<string, SheetCellValue> {
  return new Map(
    windows.flatMap((window) => window.cells.map((cell) => [key(cell.key.sheet, cell.key.row, cell.key.column), cell.value] as const)),
  );
}

function validateGridSession(session: GridSession): void {
  if (
    !session
    || typeof session.instance !== "string"
    || session.instance.length === 0
    || typeof session.revision !== "string"
    || session.revision.length === 0
    || !Array.isArray(session.sheets)
    || session.sheets.length > MAX_GRID_SESSION_SHEETS
  ) {
    throw new Error("malformed grid session");
  }
  const ids = new Set<string>();
  for (const sheet of session.sheets) {
    if (
      typeof sheet.id !== "string"
      || sheet.id.length === 0
      || typeof sheet.name !== "string"
      || sheet.name.length === 0
      || ids.has(sheet.id)
      || !Number.isSafeInteger(sheet.row_count)
      || !Number.isSafeInteger(sheet.column_count)
      || sheet.row_count < 0
      || sheet.column_count < 0
      || sheet.row_count > MAX_GRID_SESSION_ROWS
      || sheet.column_count > MAX_GRID_SESSION_COLUMNS
    ) {
      throw new Error("malformed grid session axes");
    }
    ids.add(sheet.id);
  }
}
function validateGridWindow(window: GridWindow, session: GridSession): void {
  const sheet = session.sheets.find((candidate) => candidate.id === window.sheet);
  if (
    !sheet
    || window.revision !== session.revision
    || !Number.isSafeInteger(window.row_start)
    || !Number.isSafeInteger(window.column_start)
    || window.row_start < 0
    || window.column_start < 0
    || window.total_rows !== sheet.row_count
    || window.total_columns !== sheet.column_count
    || !Array.isArray(window.rows)
    || !Array.isArray(window.columns)
    || !Array.isArray(window.cells)
    || window.rows.length > GRID_WINDOW_ROWS
    || window.columns.length > GRID_WINDOW_COLUMNS
    || window.cells.length > GRID_WINDOW_ROWS * GRID_WINDOW_COLUMNS
    || window.row_start + window.rows.length > sheet.row_count
    || window.column_start + window.columns.length > sheet.column_count
  ) {
    throw new Error("malformed grid window");
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
  readonly #sheetBar: HTMLElement;
  readonly #formulaEditor: TextEngine;
  readonly #cellEditor: TextEngine;
  readonly #options: GridEngineOptions;
  readonly #stopLanguage: () => void;
  readonly #abort = new AbortController();
  #workbook: GridWorkbook | null = null;
  #sourceWorkbook: GridWorkbook | null = null;
  /// La cartella di Excel che il profilo `workbook` mostra.
  #view: WorkbookView | null = null;
  readonly #workbookProfile: boolean;
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
  #source = "";
  #revision = "";
  #instance: string | null = null;
  #surface: string | null = null;
  #provider = false;
  #session: GridSession | null = null;
  #viewportLoad: Promise<void> | null = null;
  #viewportLoadQueued = false;
  #selection: GridSelection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
  #values = new Map<string, SheetCellValue>();
  #rows: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  #columns: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  #editing: EditingState | null = null;
  #readOnly = false;
  #destroyed = false;
  #providerCommitTail: Promise<void> = Promise.resolve();
  /// Il sorgente come lo tiene il provider, dopo l'ultima risposta: il diff di
  /// un commit accodato parte da qui, non dal testo ottimistico.
  #confirmedSource = "";
  /// Quanti commit sono partiti verso il provider: la risposta dell'ultimo è
  /// l'unica che può correggere il testo pubblicato.
  #providerTickets = 0;
  #protocolGeneration = 0;
  #undo: GridCellPatch[][] = [];
  #redo: GridCellPatch[][] = [];
  #pointerAnchor: GridPosition | null = null;

  constructor(parent: HTMLElement, options: GridEngineOptions) {
    const signal = this.#abort.signal;
    this.#options = options;
    this.#workbookProfile = options.profile === "workbook";
    this.#root = document.createElement("div");
    this.#root.className = "grid-surface";
    this.#notice = document.createElement("p");
    this.#notice.className = "grid-notice";
    this.#notice.setAttribute("role", "status");
    this.#notice.hidden = true;
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
    this.#root.append(this.#notice, formula, this.#viewport, this.#sheetBar);
    parent.replaceChildren(this.#root);
    this.#stopLanguage = onLanguage(() => {
      this.#viewport.setAttribute("aria-label", t("grid.surface"));
      if (this.#workbookProfile) {
        this.#decimal = decimalSeparator(resolvedLanguage());
        this.#showNotice();
        this.#sheetBar.querySelector(".kit-tabs")?.setAttribute("aria-label", t("grid.workbook.sheets"));
        if (!this.#editing) this.#syncFormulaBar();
        this.#render();
      }
    });

    const formulaProfile = createFormulaProfile({
      callbacks: {
        commit: () => this.#finishEditing(true, "input"),
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
      callbacks: {
        commit: () => this.#finishEditing(true, "input"),
        cancel: () => this.#finishEditing(false, "input"),
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
      this.#render();
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
    this.#viewport.addEventListener("pointerup", () => { this.#pointerAnchor = null; }, { signal });
    this.#viewport.addEventListener("copy", grid((event) => this.#copy(event)), { signal });
    this.#viewport.addEventListener("cut", grid((event) => this.#cut(event)), { signal });
    this.#viewport.addEventListener("paste", grid((event) => this.#paste(event)), { signal });
    this.#viewport.addEventListener("dblclick", grid((event) => {
      const position = this.#eventPosition(event);
      if (position) this.#beginEditing("cell", position);
    }), { signal });
    this.#formulaHost.addEventListener("focusin", () => this.#beginEditing("formula", this.#selection.focus), { signal });
    this.#formulaHost.addEventListener("focusout", () => this.#commitAfterBlur("formula"), { signal });
  }
  setDoc(source: string): void {
    if (this.#destroyed) return;
    if (this.#workbookProfile) {
      void this.#openWorkbook(source, true);
      return;
    }
    this.#protocolGeneration++;
    const previousInstance = this.#instance;
    const previousSurface = this.#surface;
    if (previousInstance && previousSurface && this.#options.grid) {
      void this.#options.grid.closeGrid(previousSurface, previousInstance).catch(() => {});
    }
    this.#instance = null;
    this.#surface = null;
    this.#provider = false;
    this.#session = null;
    this.#source = source;
    this.#revision = this.#options.revision ?? "";
    this.#sourceWorkbook = parseWorkbook(source);
    this.#workbook = this.#sourceWorkbook;
    this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
    this.#selection = this.#clampedSelection(this.#selection);
    this.#undo = [];
    this.#redo = [];
    this.#rebuildLayout();
    this.#selection = this.#visibleSelection(this.#selection);
    this.#syncFormulaBar();
    this.#render();
    if (this.#options.grid) void this.#openProtocol(source);
  }

  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this.#destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    const operation = typeof update === "string" ? null : update.operation;
    if (this.#workbookProfile) {
      // Il giornale che la griglia ha già, sugli stessi byte: niente da fare.
      // Altrimenti è cambiato altrove (un altro riquadro, un salvataggio che
      // l'ha messo nei byte, una ricarica) e la griglia si riapre.
      if (source === this.#journal && this.#currentBase() === this.#bytesBase) return;
      void this.#openWorkbook(source, false);
      return;
    }
    if (this.#provider) {
      this.#source = source;
      this.#sourceWorkbook = null;
      this.#reloadProtocol(source);
      return;
    }
    const stable = this.#activeCoordinate();
    let reloaded = false;
    if (operation && isGridOperation(operation) && this.#workbook) {
      if (applyGridPatches(this.#workbook, operation.patches)) this.#source = source;
      else {
        this.#workbook = parseWorkbook(source);
        this.#source = source;
        reloaded = true;
      }
    } else {
      this.#workbook = parseWorkbook(source);
      this.#source = source;
      reloaded = true;
    }
    this.#sourceWorkbook = this.#workbook;
    if (reloaded && this.#editing) {
      this.#detachCellEditor();
      this.#editing = null;
      this.#cellEditorHost.hidden = true;
      this.#cellEditorHost.setAttribute("aria-hidden", "true");
    }
    if (stable) {
      const position = positionOf(this.#sheet(), stable);
      if (position) this.#selection = { anchor: position, focus: position };
    }
    this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, (this.#workbook?.sheets.length ?? 0) - 1));
    this.#selection = this.#clampedSelection(this.#selection);
    this.#rebuildLayout();
    this.#selection = this.#visibleSelection(this.#selection);
    if (!this.#editing) this.#syncFormulaBar();
    this.#render();
  }

  getDoc(): string { return this.#workbookProfile ? this.#journal : this.#source; }
  selection(): GridSelection {
    return {
      anchor: { ...this.#selection.anchor },
      focus: { ...this.#selection.focus },
    };
  }

  renderedCellCount(): number {
    return this.#viewport.querySelectorAll(".grid-cell").length;
  }

  focus(): void {
    if (!this.#destroyed) this.#viewport.focus();
  }

  /** Il testo della selezione da leggere ([`selectionText`]), o `null` oltre il tetto. */
  selectedText(): { primary: string; secondary: string[] } | null {
    if (this.#destroyed || !this.#workbook) return null;
    const range = normalizedSelection(this.#selection);
    const cells = (range.rowEnd - range.rowStart + 1) * (range.columnEnd - range.columnStart + 1);
    if (cells > SELECTED_TEXT_CELLS) return null;
    return { primary: selectionText(this.#sheet(), this.#selection, (position) => this.#cellAt(position)), secondary: [] };
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

  undo(): boolean {
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
    const patches = this.#redo.pop();
    if (!patches) return false;
    if (!this.#commit(patches, "redo", false)) {
      this.#redo.push(patches);
      return false;
    }
    this.#undo.push(patches);
    return true;
  }


  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#stopLanguage();
    this.#protocolGeneration++;
    this.#abort.abort();
    const instance = this.#instance;
    const surface = this.#surface;
    if (instance && surface && this.#options.grid) {
      void this.#options.grid.closeGrid(surface, instance).catch(() => {});
    }
    this.#bytesEpoch++;
    this.#closeBytes();
    this.#instance = null;
    this.#surface = null;
    this.#sheetTabs?.lifetime.close();
    this.#sheetTabs = null;
    this.#formulaEditor.destroy();
    this.#cellEditor.destroy();
    this.#root.remove();
  }

  #sheet(): GridSheet {
    return this.#workbook?.sheets[this.#sheetIndex] ?? EMPTY_SHEET;
  }

  /// La cella in `position` del foglio mostrato. Una cartella ha le sue celle
  /// indicizzate: cercarle in lista a ogni cella disegnata costerebbe quanto
  /// il foglio intero.
  #cellAt(position: GridPosition): GridCell | undefined {
    return this.#view ? this.#workbookCell(position)?.cell : cellAt(this.#sheet(), position);
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
      opened = null;
      this.#bytes = state;
      this.#shownSession = session;
      this.#windows = windows;
      this.#bytesBase = base;
      this.#confirmedJournal = journal;
      this.#bytesConflicts = session.conflicts.length;
      this.#bytesMessage = null;
      this.#root.dataset.gridProtocol = "v2";
      this.#showView(sheet.id, top);
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
    const rowRange = viewportRange(
      sheet.row_count,
      layout ? this.#rows : none,
      this.#viewport.scrollTop,
      this.#viewport.clientHeight,
      COLUMN_HEADER_HEIGHT,
      DEFAULT_ROW_HEIGHT,
    );
    const columnRange = viewportRange(
      sheet.column_count,
      layout ? this.#columns : none,
      this.#viewport.scrollLeft,
      this.#viewport.clientWidth,
      ROW_HEADER_WIDTH,
      DEFAULT_COLUMN_WIDTH,
    );
    if (!rowRange || !columnRange) return [];
    const requests: GridWindowRequest[] = [];
    for (let row = Math.floor(rowRange.start / GRID_WINDOW_ROWS) * GRID_WINDOW_ROWS; row <= rowRange.end; row += GRID_WINDOW_ROWS) {
      for (let column = Math.floor(columnRange.start / GRID_WINDOW_COLUMNS) * GRID_WINDOW_COLUMNS; column <= columnRange.end; column += GRID_WINDOW_COLUMNS) {
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
        });
      }
    }
    if (requests.length > MAX_GRID_SESSION_WINDOWS) throw new Error("grid viewport requests exceed limit");
    return Promise.all(requests.map(async (request) => {
      const window = await host.gridBytesWindow(state.surface, state.instance, request);
      validateBytesWindow(window, session);
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
    this.#sourceWorkbook = null;
    const index = view.workbook.sheets.findIndex((sheet) => sheet.id === sheetId);
    this.#sheetIndex = index >= 0 ? index : view.active;
    if (top) this.#selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
    this.#showNotice();
    this.#showSheetTabs();
    this.#showSheet(top);
  }

  #loadBytesViewport(): Promise<void> {
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
    } catch (error) {
      if (this.#destroyed || epoch !== this.#bytesEpoch || this.#bytes !== state || state.session.revision !== revision) return;
      this.#refuse(t("grid.workbook.read_failed", { error: errorText(error) }));
    }
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
    window.cells = [...window.cells.filter((cell) => !same(cell)), {
      key: { sheet: key.sheet, row: key.row, column: key.column },
      input,
      style: previous?.style ?? PLAIN_STYLE,
      value: input ? { kind: "text", value: display } : { kind: "blank" },
      display,
      lock: null,
      stale: false,
      conflict: false,
    }];
  }

  /// Scrive le celle nel giornale. La sessione del documento lo riceve
  /// subito, come i commit del foglio di Fub; il provider lo controlla dopo,
  /// in coda, e la sua risposta corregge il giornale e la history.
  #commitCells(writes: readonly CellWrite[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    if (!this.#view || this.#readOnly || !writes.length) return false;
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
    for (const write of writes) {
      const refusal = this.#writeRefusal(write.position);
      if (refusal) {
        this.#refuse(refusal);
        return false;
      }
      const coordinate = coordinateAt(sheet, write.position)!;
      const current = this.#workbookCell(write.position)?.bytes.input ?? "";
      if (write.after === current) continue;
      const entry = gridJournalEntry(journal, coordinate);
      // Una formula si riscrive soltanto per tornare a quella del file.
      if (write.after.startsWith("=") && entry?.before !== write.after) {
        this.#refuse(t("grid.workbook.formula"));
        return false;
      }
      try {
        journal = recordGridJournal(journal, coordinate, current, write.after);
      } catch {
        this.#refuse(t("grid.workbook.too_many"));
        return false;
      }
      request.push({ cell: { ...coordinate }, before: current, after: write.after });
      history.push({ coordinate, before: { input: current }, after: { input: write.after } });
      disks.push(entry?.before ?? current);
      written.push(write);
    }
    if (!request.length) return false;
    for (const write of written) this.#showWritten(write.position, write.after);
    if (recordHistory) {
      this.#undo.push(history);
      this.#redo = [];
    }
    this.#bytesMessage = null;
    this.#showView(sheet.id, false);
    this.#publishJournal(gridJournalText(journal), origin);
    const epoch = this.#bytesEpoch;
    const edits = this.#editEpoch;
    const ticket = ++this.#bytesTickets;
    this.#enqueueProtocol(() => this.#applyBytes(request, history, disks, origin, epoch, edits, ticket));
    return true;
  }

  async #applyBytes(
    patches: GridRequestPatch[],
    history: GridCellPatch[],
    disks: readonly string[],
    origin: EditorChangeOrigin,
    epoch: number,
    edits: number,
    ticket: number,
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
      const text = applySourceEdit(this.#confirmedJournal, commit.edit);
      confirmed = parseGridJournal(text);
      this.#confirmedJournal = text;
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
    history.forEach((patch, index) => {
      history[index] = { ...patch, after: { input: gridJournalEntry(confirmed, patch.coordinate)?.after ?? disks[index] } };
    });
    // Il giornale ottimistico si corregge soltanto quando non resta niente in
    // coda: prima, la conferma non contiene ancora le modifiche che seguono.
    if (ticket === this.#bytesTickets) this.#publishJournal(this.#confirmedJournal, origin);
    await this.#refreshBytes(state, epoch);
  }

  #showNotice(): void {
    if (!this.#workbookProfile) return;
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
        if (index < 0 || index === this.#sheetIndex) return;
        this.#finishEditing(false, "input", false);
        this.#sheetIndex = index;
        this.#selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
        this.#showSheet(true);
        if (this.#workbookProfile) void this.#loadViewport();
        this.#options.onSelectionChange();
      },
    });
    lifetime.add(() => tablist.remove());
    this.#sheetTabs = { handle, names, lifetime };
  }

  #rebuildLayout(): void {
    const sheet = this.#sheet();
    this.#rows = axisLayout(sheet.rows, DEFAULT_ROW_HEIGHT, "height");
    this.#columns = axisLayout(sheet.columns, DEFAULT_COLUMN_WIDTH, "width");
    this.#canvas.style.width = `${ROW_HEADER_WIDTH + this.#columns.total}px`;
    this.#canvas.style.height = `${COLUMN_HEADER_HEIGHT + this.#rows.total}px`;
    this.#viewport.setAttribute("aria-rowcount", String(sheet.rows.length + 1));
    this.#viewport.setAttribute("aria-colcount", String(sheet.columns.length + 1));
  }

  #render(): void {
    if (!this.#workbook) return;
    const sheet = this.#sheet();
    const rowWindow = boundedWindow(
      this.#rows,
      Math.max(0, this.#viewport.scrollTop - COLUMN_HEADER_HEIGHT),
      this.#viewport.clientHeight,
    );
    const columnWindow = boundedWindow(
      this.#columns,
      Math.max(0, this.#viewport.scrollLeft - ROW_HEADER_WIDTH),
      this.#viewport.clientWidth,
    );
    const range = normalizedSelection(this.#selection);
    const editingPosition = this.#editing?.owner === "cell" ? this.#editing.position : null;
    const renderedRows: number[] = [];
    for (let row = rowWindow.start; row <= rowWindow.end; row += 1) renderedRows.push(row);
    if (
      editingPosition
      && editingPosition.row >= 0
      && editingPosition.row < this.#rows.sizes.length
      && (editingPosition.row < rowWindow.start || editingPosition.row > rowWindow.end)
    ) {
      renderedRows.push(editingPosition.row);
      renderedRows.sort((left, right) => left - right);
    }
    const renderedColumns: number[] = [];
    for (let column = columnWindow.start; column <= columnWindow.end; column += 1) renderedColumns.push(column);
    if (
      editingPosition
      && editingPosition.column >= 0
      && editingPosition.column < this.#columns.sizes.length
      && (editingPosition.column < columnWindow.start || editingPosition.column > columnWindow.end)
    ) {
      renderedColumns.push(editingPosition.column);
      renderedColumns.sort((left, right) => left - right);
    }
    const rows: HTMLElement[] = [];

    const columnHeaderRow = document.createElement("div");
    columnHeaderRow.className = "grid-row grid-column-header-row";
    columnHeaderRow.setAttribute("role", "row");
    columnHeaderRow.setAttribute("aria-rowindex", "1");
    this.#place(
      columnHeaderRow,
      0,
      this.#viewport.scrollTop,
      ROW_HEADER_WIDTH + this.#columns.total,
      COLUMN_HEADER_HEIGHT,
    );
    this.#corner.className = "grid-corner";
    this.#corner.setAttribute("role", "presentation");
    this.#corner.textContent = "";
    this.#corner.style.pointerEvents = "none";
    this.#place(this.#corner, this.#viewport.scrollLeft, 0, ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT);
    columnHeaderRow.append(this.#corner);
    for (let column = columnWindow.start; column <= columnWindow.end; column += 1) {
      if (this.#columns.sizes[column] === 0) continue;
      const header = document.createElement("div");
      header.className = "grid-header grid-column-header";
      header.setAttribute("role", "columnheader");
      header.setAttribute("aria-rowindex", "1");
      header.setAttribute("aria-colindex", String(column + 2));
      header.textContent = columnLabel(column);
      header.style.pointerEvents = "none";
      this.#place(header, ROW_HEADER_WIDTH + this.#columns.offsets[column], 0, this.#columns.sizes[column], COLUMN_HEADER_HEIGHT);
      columnHeaderRow.append(header);
    }
    rows.push(columnHeaderRow);

    for (const row of renderedRows) {
      if (this.#rows.sizes[row] === 0) continue;
      const rowElement = document.createElement("div");
      rowElement.className = "grid-row";
      rowElement.dataset.row = String(row);
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", String(row + 2));
      this.#place(
        rowElement,
        0,
        COLUMN_HEADER_HEIGHT + this.#rows.offsets[row],
        ROW_HEADER_WIDTH + this.#columns.total,
        this.#rows.sizes[row],
      );

      const header = document.createElement("div");
      header.className = "grid-header grid-row-header";
      header.setAttribute("role", "rowheader");
      header.setAttribute("aria-rowindex", String(row + 2));
      header.setAttribute("aria-colindex", "1");
      header.textContent = String(row + 1);
      header.style.pointerEvents = "none";
      this.#place(header, this.#viewport.scrollLeft, 0, ROW_HEADER_WIDTH, this.#rows.sizes[row]);
      rowElement.append(header);

      for (const column of renderedColumns) {
        if (this.#columns.sizes[column] === 0) continue;
        const position = { row, column };
        const persisted = this.#cellAt(position);
        const element = document.createElement("div");
        element.className = "grid-cell";
        element.dataset.row = String(row);
        element.dataset.column = String(column);
        element.id = this.#cellId(position);
        element.setAttribute("role", "gridcell");
        element.setAttribute("aria-rowindex", String(row + 2));
        element.setAttribute("aria-colindex", String(column + 2));
        const selected = row >= range.rowStart && row <= range.rowEnd && column >= range.columnStart && column <= range.columnEnd;
        element.setAttribute("aria-selected", String(selected));
        if (selected) element.classList.add("selected");
        if (samePosition(position, this.#selection.focus)) element.classList.add("active");
        if (persisted?.style?.bold) element.style.fontWeight = "700";
        if (persisted?.style?.italic) element.style.fontStyle = "italic";
        if (persisted?.style?.text_color) element.style.color = persisted.style.text_color;
        if (persisted?.style?.fill_color) element.style.backgroundColor = persisted.style.fill_color;
        if (persisted?.style?.horizontal) element.style.textAlign = persisted.style.horizontal;
        const bytes = this.#view ? this.#workbookCell(position)?.bytes : undefined;
        if (bytes?.stale) element.classList.add("stale");
        if (bytes?.conflict) {
          element.classList.add("conflict");
          element.setAttribute("aria-invalid", "true");
        }
        if (bytes?.lock) element.setAttribute("aria-readonly", "true");
        const value = persisted
          ? this.#values.get(key(sheet.id, persisted.row, persisted.column))
          : undefined;
        element.textContent = displayValue(value, persisted?.input ?? "");
        this.#place(element, ROW_HEADER_WIDTH + this.#columns.offsets[column], 0, this.#columns.sizes[column], this.#rows.sizes[row]);
        rowElement.append(element);
      }
      rows.push(rowElement);
    }

    this.#detachCellEditor();
    for (const row of this.#viewport.querySelectorAll<HTMLElement>(".grid-row")) row.remove();
    this.#viewport.append(...rows);
    const editing = this.#editing?.owner === "cell" ? this.#editing : null;
    if (editing) {
      const cell = this.#findCell(editing.position);
      if (cell && this.#isVisiblePosition(editing.position)) {
        cell.append(this.#cellEditorHost);
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
    if (this.#isVisiblePosition(this.#selection.focus)) {
      this.#viewport.setAttribute("aria-activedescendant", this.#cellId(this.#selection.focus));
    } else {
      this.#viewport.removeAttribute("aria-activedescendant");
    }
    const name = this.#root.querySelector<HTMLElement>(".grid-cell-name");
    if (name) {
      name.textContent = this.#isVisiblePosition(this.#selection.focus)
        ? `${columnLabel(this.#selection.focus.column)}${this.#selection.focus.row + 1}`
        : "";
    }
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

  #cellId(position: GridPosition): string {
    return `grid-${this.#options.surfaceId}-${position.row}-${position.column}`;
  }

  #activeCoordinate() {
    const sheet = this.#workbook ? this.#sheet() : null;
    if (!sheet) return undefined;
    const row = sheet.rows[this.#selection.focus.row]?.id;
    const column = sheet.columns[this.#selection.focus.column]?.id;
    return row && column ? { sheet: sheet.id, row, column } : undefined;
  }

  #syncFormulaBar(): void {
    if (!this.#workbook) return;
    const focus = this.#selection.focus;
    if (this.#workbookProfile) {
      const bytes = this.#workbookCell(focus)?.bytes;
      this.#formulaEditor.setReadOnly(this.#readOnly || Boolean(bytes?.lock));
      this.#formulaEditor.setDoc(localInput(bytes?.input ?? "", this.#decimal));
      return;
    }
    this.#formulaEditor.setDoc(this.#cellAt(focus)?.input ?? "");
  }

  #select(position: GridPosition, extend: boolean): void {
    const focus = this.#clampedPosition(position);
    this.#selection = extend
      ? { anchor: this.#selection.anchor, focus }
      : { anchor: focus, focus };
    if (!this.#editing) this.#syncFormulaBar();
    this.#ensureVisible(focus);
    this.#render();
    this.#options.onSelectionChange();
  }

  #clampedPosition(position: GridPosition): GridPosition {
    const sheet = this.#sheet();
    return {
      row: clamp(position.row, Math.max(0, sheet.rows.length - 1)),
      column: clamp(position.column, Math.max(0, sheet.columns.length - 1)),
    };
  }

  #clampedSelection(selection: GridSelection): GridSelection {
    return {
      anchor: this.#clampedPosition(selection.anchor),
      focus: this.#clampedPosition(selection.focus),
    };
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
    return { anchor: visible(selection.anchor), focus: visible(selection.focus) };
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

  #move(rowStep: number, columnStep: number, extend: boolean): void {
    const focus = this.#selection.focus;
    this.#select({
      row: rowStep === 0 ? focus.row : this.#nextVisible("row", focus.row, rowStep),
      column: columnStep === 0 ? focus.column : this.#nextVisible("column", focus.column, columnStep),
    }, extend);
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
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
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
      this.#options.onSelectionChange();
      return;
    }
    const extend = event.shiftKey;
    switch (event.key) {
      case "ArrowUp": this.#move(-1, 0, extend); break;
      case "ArrowDown": this.#move(1, 0, extend); break;
      case "ArrowLeft": this.#move(0, -1, extend); break;
      case "ArrowRight": this.#move(0, 1, extend); break;
      case "Tab": if (!this.#tab(extend ? -1 : 1)) return; break;
      case "Enter":
      case "F2": this.#beginEditing("cell", this.#selection.focus); break;
      case "Home": this.#select({
        row: modifier ? this.#edgeVisible("row", false) : this.#selection.focus.row,
        column: this.#edgeVisible("column", false),
      }, extend); break;
      case "End": this.#select({
        row: modifier ? this.#edgeVisible("row", true) : this.#selection.focus.row,
        column: this.#edgeVisible("column", true),
      }, extend); break;
      case "PageUp": this.#move(-Math.max(1, Math.floor(this.#viewport.clientHeight / DEFAULT_ROW_HEIGHT)), 0, extend); break;
      case "PageDown": this.#move(Math.max(1, Math.floor(this.#viewport.clientHeight / DEFAULT_ROW_HEIGHT)), 0, extend); break;
      case "Delete":
      case "Backspace": this.#clearSelection(); break;
      default:
        if (!modifier && !event.altKey && event.key.length === 1 && !this.#readOnly) {
          this.#beginEditing("cell", this.#selection.focus, event.key);
        } else {
          return;
        }
    }
    event.preventDefault();
  }

  #beginEditing(owner: "cell" | "formula", position: GridPosition, initial?: string): void {
    if (this.#readOnly || !this.#workbook || !this.#isVisiblePosition(position)) return;
    let current: string;
    if (this.#workbookProfile) {
      const refusal = this.#writeRefusal(position);
      if (refusal) {
        this.#refuse(refusal);
        return;
      }
      current = localInput(this.#workbookCell(position)?.bytes.input ?? "", this.#decimal);
    } else {
      current = this.#cellAt(position)?.input ?? "";
    }
    if (this.#editing && (!samePosition(this.#editing.position, position) || this.#editing.owner !== owner)) {
      this.#finishEditing(true, "input", false);
    }
    this.#editing = { position, original: current, draft: initial ?? current, owner };
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
  }

  #draftFromEditor(owner: "cell" | "formula", draft: string): void {
    if (this.#editing?.owner === owner) this.#editing.draft = draft;
  }

  #commitAfterBlur(owner: "cell" | "formula"): void {
    queueMicrotask(() => {
      if (this.#destroyed || this.#editing?.owner !== owner) return;
      const host = owner === "cell" ? this.#cellEditorHost : this.#formulaHost;
      if (!host.contains(document.activeElement)) this.#finishEditing(true, "input");
    });
  }

  #finishEditing(commit: boolean, origin: EditorChangeOrigin, restoreFocus = true): void {
    const editing = this.#editing;
    if (!editing) return;
    this.#editing = null;
    this.#detachCellEditor();
    this.#cellEditorHost.hidden = true;
    this.#cellEditorHost.setAttribute("aria-hidden", "true");
    if (commit && editing.draft !== editing.original) {
      if (this.#workbookProfile) {
        this.#commitCells([{ position: editing.position, after: fileInput(editing.draft, this.#decimal) }], origin, true);
      } else {
        const patch = inputPatch(this.#sheet(), editing.position, editing.draft);
        if (patch) this.#commit([patch], origin, true);
      }
    }
    this.#syncFormulaBar();
    this.#render();
    if (restoreFocus) queueMicrotask(() => this.#viewport.focus());
  }

  #positionEditor(position: GridPosition): void {
    const inCell = this.#cellEditorHost.parentElement?.classList.contains("grid-cell") ?? false;
    this.#place(
      this.#cellEditorHost,
      inCell ? 0 : ROW_HEADER_WIDTH + this.#columns.offsets[position.column],
      inCell ? 0 : COLUMN_HEADER_HEIGHT + this.#rows.offsets[position.row],
      this.#columns.sizes[position.column],
      this.#rows.sizes[position.row],
    );
  }

  #commit(patches: readonly GridCellPatch[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    if (this.#workbookProfile) {
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
    if (!this.#workbook || this.#readOnly) return false;
    const beforeSource = this.#source;
    const sourceWorkbook = this.#sourceWorkbook ?? parseWorkbook(beforeSource);
    const committed = commitGridPatches(sourceWorkbook, beforeSource, patches);
    if (!committed) return false;
    this.#sourceWorkbook = sourceWorkbook;
    if (this.#workbook !== sourceWorkbook && !applyGridPatches(this.#workbook, patches)) return false;
    this.#source = committed.source;
    if (recordHistory) {
      this.#undo.push([...patches]);
      this.#redo = [];
    }
    this.#render();
    // La sessione riceve il commit **all'invio**, col sorgente scritto qui.
    // Aspettare la risposta del provider lasciava pulito il documento per
    // tutto il viaggio: chi chiudeva la linguetta in quell'intervallo non
    // salvava né metteva in bozza niente, e il teardown buttava la risposta.
    this.#options.onChange({ text: committed.source, operation: committed.operation, origin });
    if (this.#provider && this.#instance && this.#surface && this.#options.grid) {
      const instance = this.#instance;
      const surface = this.#surface;
      const generation = this.#protocolGeneration;
      const ticket = ++this.#providerTickets;
      const queuedPatches = patches.map((patch) => ({
        coordinate: { ...patch.coordinate },
        before: patch.before
          ? { input: patch.before.input, style: patch.before.style ? { ...patch.before.style } : undefined }
          : null,
        after: patch.after
          ? { input: patch.after.input, style: patch.after.style ? { ...patch.after.style } : undefined }
          : null,
      }));
      this.#enqueueProtocol(() => this.#applyProvider(queuedPatches, origin, generation, instance, surface, ticket));
    }
    return true;
  }

  #clearSelection(): void {
    if (this.#readOnly) return;
    const range = normalizedSelection(this.#selection);
    if (this.#workbookProfile) {
      if (!this.#rangeRead(range)) {
        this.#refuse(t("grid.workbook.not_loaded"));
        return;
      }
      const writes: CellWrite[] = [];
      for (const [key, cell] of this.#view?.sheets[this.#sheetIndex]?.cells ?? []) {
        const position = keyPosition(key);
        if (
          cell.bytes.input !== ""
          && position.row >= range.rowStart && position.row <= range.rowEnd
          && position.column >= range.columnStart && position.column <= range.columnEnd
        ) writes.push({ position, after: "" });
      }
      this.#commitCells(writes, "input", true);
      return;
    }
    const patches: GridCellPatch[] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        const patch = inputPatch(this.#sheet(), { row, column }, "");
        if (patch) patches.push(patch);
      }
    }
    this.#commit(patches, "input", true);
  }

  #copy(event: ClipboardEvent): void {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionTsv(this.#sheet(), this.#selection, (position) => this.#cellAt(position)));
  }

  #cut(event: ClipboardEvent): void {
    if (this.#readOnly) return;
    this.#copy(event);
    this.#clearSelection();
  }

  #paste(event: ClipboardEvent): void {
    if (this.#readOnly || !event.clipboardData) return;
    event.preventDefault();
    if (this.#workbookProfile) {
      const sheet = this.#sheet();
      const focus = this.#selection.focus;
      const writes: CellWrite[] = [];
      parseTsv(event.clipboardData.getData("text/plain")).forEach((values, row) => values.forEach((value, column) => {
        const position = { row: focus.row + row, column: focus.column + column };
        if (position.row < sheet.rows.length && position.column < sheet.columns.length) {
          writes.push({ position, after: fileInput(value, this.#decimal) });
        }
      }));
      this.#commitCells(writes, "input", true);
      return;
    }
    const patches = pastePatches(this.#sheet(), this.#selection.focus, event.clipboardData.getData("text/plain"));
    this.#commit(patches, "input", true);
  }

  #pointerDown(event: PointerEvent): void {
    const position = this.#eventPosition(event);
    if (!position) return;
    event.preventDefault();
    this.#pointerAnchor = position;
    this.#selection = event.shiftKey
      ? { anchor: this.#selection.anchor, focus: position }
      : { anchor: position, focus: position };
    this.#viewport.setPointerCapture?.(event.pointerId);
    this.#viewport.focus();
    this.#syncFormulaBar();
    this.#render();
    this.#options.onSelectionChange();
  }

  #pointerMove(event: PointerEvent): void {
    if (!this.#pointerAnchor || event.buttons === 0) return;
    const position = this.#eventPosition(event);
    if (!position) return;
    this.#selection = { anchor: this.#pointerAnchor, focus: position };
    this.#render();
    this.#options.onSelectionChange();
  }

  #eventPosition(event: Event): GridPosition | null {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-cell") : null;
    if (!target) return null;
    const row = Number(target.dataset.row);
    const column = Number(target.dataset.column);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  #ensureVisible(position: GridPosition): void {
    const left = ROW_HEADER_WIDTH + this.#columns.offsets[position.column];
    const right = left + this.#columns.sizes[position.column];
    const top = COLUMN_HEADER_HEIGHT + this.#rows.offsets[position.row];
    const bottom = top + this.#rows.sizes[position.row];
    if (left < this.#viewport.scrollLeft + ROW_HEADER_WIDTH) this.#viewport.scrollLeft = Math.max(0, left - ROW_HEADER_WIDTH);
    else if (right > this.#viewport.scrollLeft + this.#viewport.clientWidth) this.#viewport.scrollLeft = right - this.#viewport.clientWidth;
    if (top < this.#viewport.scrollTop + COLUMN_HEADER_HEIGHT) this.#viewport.scrollTop = Math.max(0, top - COLUMN_HEADER_HEIGHT);
    else if (bottom > this.#viewport.scrollTop + this.#viewport.clientHeight) this.#viewport.scrollTop = bottom - this.#viewport.clientHeight;
  }

  #protocolIsCurrent(generation: number, instance: string, surface: string): boolean {
    return !this.#destroyed
      && generation === this.#protocolGeneration
      && this.#instance === instance
      && this.#surface === surface;
  }

  async #openProtocol(source: string): Promise<void> {
    const host = this.#options.grid;
    if (!host || !this.#options.revision) return;
    const generation = ++this.#protocolGeneration;
    let opened: GridSession | null = null;
    let openedSurface: string | null = null;
    try {
      const surfaces = await host.listGridSurfaces();
      const surface = surfaces.find((candidate) =>
        candidate.family === "grid"
        && candidate.protocol_version === 1
        && (this.#options.formatId == null || candidate.format === this.#options.formatId),
      );
      if (!surface) throw new Error("grid provider unavailable or incompatible");
      const session = await host.openGrid(surface.id, source, this.#options.revision);
      opened = session;
      openedSurface = surface.id;
      validateGridSession(session);
      if (generation !== this.#protocolGeneration || this.#destroyed) {
        await host.closeGrid(surface.id, session.instance).catch(() => {});
        opened = null;
        openedSurface = null;
        return;
      }
      const windows = await this.#readWindows(surface.id, session);
      if (generation !== this.#protocolGeneration || this.#destroyed) {
        await host.closeGrid(surface.id, session.instance).catch(() => {});
        opened = null;
        openedSurface = null;
        return;
      }
      // Un commit in fallback durante l'apertura ha cambiato il testo, e il
      // provider ha aperto quello di prima: i suoi diff partirebbero da lì, e
      // la prima conferma toglierebbe quel commit. Si riapre col testo di ora.
      if (this.#source !== source) {
        await host.closeGrid(surface.id, session.instance).catch(() => {});
        opened = null;
        openedSurface = null;
        if (generation === this.#protocolGeneration && !this.#destroyed) void this.#openProtocol(this.#source);
        return;
      }
      this.#revision = session.revision;
      this.#confirmedSource = source;
      this.#instance = session.instance;
      this.#surface = surface.id;
      this.#session = session;
      this.#provider = true;
      this.#values = valuesFromWindows(windows);
      this.#workbook = workbookFromWindows(
        session,
        windows,
        this.#sourceWorkbook,
        this.#workbook?.sheets[this.#sheetIndex]?.id,
      );
      this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
      this.#selection = this.#visibleSelection(this.#clampedSelection(this.#selection));
      this.#rebuildLayout();
      this.#syncFormulaBar();
      this.#root.dataset.gridProtocol = "v1";
      this.#render();
      opened = null;
      openedSurface = null;
    } catch {
      if (opened && openedSurface) {
        await host.closeGrid(openedSurface, opened.instance).catch(() => {});
      }
      if (generation !== this.#protocolGeneration || this.#destroyed) return;
      this.#provider = false;
      this.#instance = null;
      this.#session = null;
      this.#surface = null;
      this.#root.dataset.gridProtocol = "fallback";
      this.#render();
    }
  }

  async #readWindows(surface: string, session: GridSession): Promise<GridWindow[]> {
    const host = this.#options.grid;
    if (!host) return [];
    validateGridSession(session);
    const activeId = this.#workbook?.sheets[this.#sheetIndex]?.id;
    const sheet = session.sheets.find((candidate) => candidate.id === activeId) ?? session.sheets[0];
    if (!sheet) return [];
    const rowRange = viewportRange(
      sheet.row_count,
      this.#rows,
      this.#viewport.scrollTop,
      this.#viewport.clientHeight,
      COLUMN_HEADER_HEIGHT,
      DEFAULT_ROW_HEIGHT,
    );
    const columnRange = viewportRange(
      sheet.column_count,
      this.#columns,
      this.#viewport.scrollLeft,
      this.#viewport.clientWidth,
      ROW_HEADER_WIDTH,
      DEFAULT_COLUMN_WIDTH,
    );
    if (!rowRange || !columnRange) return [];
    const requests: GridWindowRequest[] = [];
    const firstRowWindow = Math.floor(rowRange.start / GRID_WINDOW_ROWS) * GRID_WINDOW_ROWS;
    const lastRowWindow = Math.floor(rowRange.end / GRID_WINDOW_ROWS) * GRID_WINDOW_ROWS;
    const firstColumnWindow = Math.floor(columnRange.start / GRID_WINDOW_COLUMNS) * GRID_WINDOW_COLUMNS;
    const lastColumnWindow = Math.floor(columnRange.end / GRID_WINDOW_COLUMNS) * GRID_WINDOW_COLUMNS;
    for (let row = firstRowWindow; row <= lastRowWindow; row += GRID_WINDOW_ROWS) {
      for (let column = firstColumnWindow; column <= lastColumnWindow; column += GRID_WINDOW_COLUMNS) {
        requests.push({
          revision: session.revision,
          sheet: sheet.id,
          row_start: row,
          row_count: Math.min(GRID_WINDOW_ROWS, sheet.row_count - row),
          column_start: column,
          column_count: Math.min(GRID_WINDOW_COLUMNS, sheet.column_count - column),
        });
      }
    }
    if (requests.length > MAX_GRID_SESSION_WINDOWS) {
      throw new Error("grid viewport requests exceed limit");
    }
    const windows = await Promise.all(requests.map(async (request) => {
      const window = await host.gridWindow(surface, session.instance, request);
      validateGridWindow(window, session);
      return window;
    }));
    return windows;
  }
  #loadViewport(): Promise<void> {
    if (this.#workbookProfile) return this.#loadBytesViewport();
    const host = this.#options.grid;
    const session = this.#session;
    const instance = this.#instance;
    const surface = this.#surface;
    if (!host || !session || !instance || !surface || !this.#provider || this.#destroyed) {
      return Promise.resolve();
    }
    if (this.#viewportLoad) {
      this.#viewportLoadQueued = true;
      return this.#viewportLoad;
    }
    const generation = this.#protocolGeneration;
    const load = (async () => {
      try {
        const windows = await this.#readWindows(surface, session);
        if (!this.#protocolIsCurrent(generation, instance, surface) || this.#session !== session) return;
        this.#values = valuesFromWindows(windows);
        this.#workbook = workbookFromWindows(
          session,
          windows,
          this.#sourceWorkbook,
          this.#workbook?.sheets[this.#sheetIndex]?.id,
        );
        this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
        this.#selection = this.#visibleSelection(this.#clampedSelection(this.#selection));
        this.#rebuildLayout();
        this.#syncFormulaBar();
        this.#render();
      } catch {
        if (!this.#protocolIsCurrent(generation, instance, surface)) return;
        this.#protocolGeneration++;
        this.#provider = false;
        this.#instance = null;
        this.#surface = null;
        this.#session = null;
        await host.closeGrid(surface, instance).catch(() => {});
        if (this.#destroyed) return;
        this.#sourceWorkbook = parseWorkbook(this.#source);
        this.#workbook = this.#sourceWorkbook;
        this.#values.clear();
        this.#selection = this.#clampedSelection(this.#selection);
        this.#rebuildLayout();
        this.#selection = this.#visibleSelection(this.#selection);
        this.#syncFormulaBar();
        this.#root.dataset.gridProtocol = "fallback";
        this.#render();
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

  #reloadProtocol(source: string): void {
    const host = this.#options.grid;
    const instance = this.#instance;
    const surface = this.#surface;
    if (!host || !instance || !surface || !this.#revision) return;
    const generation = ++this.#protocolGeneration;
    // In coda come i commit: un `apply` ancora in volo cambierebbe il
    // sorgente del provider sotto la ricarica, e i commit che seguono la
    // ricarica devono partire da ciò che lei ha lasciato.
    this.#enqueueProtocol(() => this.#reloadNow(host, source, generation, instance, surface));
  }

  async #reloadNow(host: GridHost, source: string, generation: number, instance: string, surface: string): Promise<void> {
    if (!this.#protocolIsCurrent(generation, instance, surface)) return;
    try {
      const session = await host.reloadGrid(surface, instance, source, this.#revision);
      validateGridSession(session);
      if (session.instance !== instance) throw new Error("grid reload changed its instance");
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#revision = session.revision;
      this.#confirmedSource = source;
      const windows = await this.#readWindows(surface, session);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#session = session;
      this.#values = valuesFromWindows(windows);
      this.#workbook = workbookFromWindows(
        session,
        windows,
        this.#sourceWorkbook,
        this.#workbook?.sheets[this.#sheetIndex]?.id,
      );
      this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
      this.#selection = this.#visibleSelection(this.#clampedSelection(this.#selection));
      this.#provider = true;
      this.#rebuildLayout();
      this.#syncFormulaBar();
      this.#render();
    } catch {
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#provider = false;
      this.#instance = null;
      this.#surface = null;
      this.#session = null;
      await host.closeGrid(surface, instance).catch(() => {});
      if (this.#destroyed) return;
      // Il testo della sessione, con i commit pubblicati dopo la ricarica.
      this.#sourceWorkbook = parseWorkbook(this.#source);
      this.#workbook = this.#sourceWorkbook;
      this.#values.clear();
      this.#selection = this.#clampedSelection(this.#selection);
      this.#rebuildLayout();
      this.#selection = this.#visibleSelection(this.#selection);
      this.#syncFormulaBar();
      this.#root.dataset.gridProtocol = "fallback";
      this.#render();
    }
  }

  /// Le richieste che cambiano il sorgente del provider, una dopo l'altra:
  /// ognuna parte dallo stato lasciato dalla precedente, ed è ciò che rende
  /// [`#confirmedSource`] la base giusta del diff successivo.
  #enqueueProtocol(step: () => Promise<void>): void {
    this.#providerCommitTail = this.#providerCommitTail
      .catch(() => {})
      .then(step)
      .catch(() => {});
  }

  async #applyProvider(
    patches: readonly GridCellPatch[],
    origin: EditorChangeOrigin,
    generation: number,
    instance: string,
    surface: string,
    ticket: number,
  ): Promise<void> {
    const host = this.#options.grid;
    if (!host || !this.#protocolIsCurrent(generation, instance, surface)) return;
    const request: GridApplyRequest = {
      revision: this.#revision,
      patches: patches.map((patch) => ({
        cell: patch.coordinate,
        before: patch.before?.input ?? null,
        after: patch.after?.input ?? "",
      })),
    };
    try {
      const commit = await host.applyGrid(surface, instance, request);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      // Il diff parte dal sorgente del provider, non da quello ottimistico che
      // la sessione ha già: con un altro commit in coda i due possono
      // differire, e applicarlo alla base sbagliata pubblicava quella.
      const confirmed = applySourceEdit(this.#confirmedSource, commit.edit);
      this.#confirmedSource = confirmed;
      this.#revision = commit.revision;
      this.#session = this.#session ? { ...this.#session, revision: commit.revision } : null;
      // Il testo ottimistico si corregge soltanto quando non resta niente in
      // coda: prima, la conferma non contiene ancora i commit che seguono.
      if (ticket === this.#providerTickets && confirmed !== this.#source) {
        const published = this.#source;
        this.#source = confirmed;
        this.#sourceWorkbook = null;
        this.#options.onChange({ text: confirmed, operation: operationFromText(published, confirmed), origin });
      }
      await this.#readInvalidation(commit.invalidation, generation, instance, surface);
    } catch {
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#provider = false;
      this.#instance = null;
      this.#surface = null;
      this.#session = null;
      await host.closeGrid(surface, instance).catch(() => {});
      if (this.#destroyed) return;
      // Il fallback riparte dal testo che la sessione ha già, commit
      // compreso: tornare a quello di prima lo toglieva dalla vista.
      this.#sourceWorkbook = parseWorkbook(this.#source);
      this.#values.clear();
      this.#workbook = this.#sourceWorkbook;
      this.#root.dataset.gridProtocol = "fallback";
      this.#rebuildLayout();
      this.#render();
    }
  }

  async #readInvalidation(
    invalidation: GridInvalidation,
    generation: number,
    instance: string,
    surface: string,
  ): Promise<void> {
    const host = this.#options.grid;
    if (!host || !this.#protocolIsCurrent(generation, instance, surface) || !this.#workbook) return;
    if (invalidation.kind === "all") {
      const session = this.#session
        ? { ...this.#session, instance, revision: this.#revision }
        : {
            instance,
            revision: this.#revision,
            sheets: this.#workbook.sheets.map((sheet) => ({
              id: sheet.id,
              name: sheet.name,
              row_count: sheet.rows.length,
              column_count: sheet.columns.length,
            })),
          };
      const windows = await this.#readWindows(surface, session);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#values = valuesFromWindows(windows);
      this.#workbook = workbookFromWindows(
        session,
        windows,
        this.#sourceWorkbook,
        this.#workbook?.sheets[this.#sheetIndex]?.id,
      );
    } else {
      const session = this.#session ?? {
        instance,
        revision: this.#revision,
        sheets: this.#workbook.sheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          row_count: sheet.rows.length,
          column_count: sheet.columns.length,
        })),
      };
      const requests = invalidation.cells.flatMap((cell) => {
        const sourceSheet = (this.#sourceWorkbook ?? this.#workbook)?.sheets.find((candidate) => candidate.id === cell.sheet);
        const sessionSheet = session.sheets.find((candidate) => candidate.id === cell.sheet);
        if (!sourceSheet || !sessionSheet) return [];
        const row = sourceSheet.rows.findIndex((candidate) => candidate.id === cell.row);
        const column = sourceSheet.columns.findIndex((candidate) => candidate.id === cell.column);
        if (
          row < 0
          || column < 0
          || row >= sessionSheet.row_count
          || column >= sessionSheet.column_count
        ) {
          return [];
        }
        const rowStart = Math.floor(row / GRID_WINDOW_ROWS) * GRID_WINDOW_ROWS;
        const columnStart = Math.floor(column / GRID_WINDOW_COLUMNS) * GRID_WINDOW_COLUMNS;
        const request = {
          revision: session.revision,
          sheet: cell.sheet,
          row_start: rowStart,
          row_count: Math.min(GRID_WINDOW_ROWS, sessionSheet.row_count - rowStart),
          column_start: columnStart,
          column_count: Math.min(GRID_WINDOW_COLUMNS, sessionSheet.column_count - columnStart),
        };
        return [host.gridWindow(surface, instance, request).then((window) => {
          validateGridWindow(window, session);
          return window;
        })];
      });
      const windows = await Promise.all(requests);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      for (const window of windows) {
        const sheet = this.#workbook.sheets.find((candidate) => candidate.id === window.sheet);
        if (!sheet) continue;
        for (const cell of window.cells) {
          this.#values.set(key(cell.key.sheet, cell.key.row, cell.key.column), cell.value);
          const row = window.rows.find((candidate) => candidate.id === cell.key.row);
          const column = window.columns.find((candidate) => candidate.id === cell.key.column);
          if (
            !row
            || !column
            || row.index < 0
            || column.index < 0
            || sheet.rows[row.index]?.id !== row.id
            || sheet.columns[column.index]?.id !== column.id
          ) continue;
          const existing = cellAt(sheet, { row: row.index, column: column.index });
          if (existing) {
            existing.input = cell.input;
            existing.style = {
              bold: cell.style.bold,
              italic: cell.style.italic,
              text_color: cell.style.text_color ?? undefined,
              fill_color: cell.style.fill_color ?? undefined,
              horizontal: cell.style.horizontal ?? undefined,
              number_format: cell.style.number_format ?? undefined,
            };
          }
        }
      }
    }
    if (this.#protocolIsCurrent(generation, instance, surface)) this.#render();
  }
}

