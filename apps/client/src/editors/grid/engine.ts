import type {
  GridApplyRequest,
  GridCommit,
  GridInvalidation,
  GridSession,
  GridSurfaceSpec,
  GridWindow,
  GridWindowRequest,
  SheetCellValue,
} from "../../host/contract";
import type { EditorChangeOrigin, TextOperation } from "../core/text-operation";
import type { Theme } from "../../theme/theme";
import { t, onLanguage } from "../../i18n/strings";
import { createTextEngine, type TextEngine } from "../text/engine";
import { createFormulaProfile } from "../text/profiles/formula";
import {
  cellAt,
  columnLabel,
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
  selectionTsv,
  type GridCellPatch,
  type GridOperation,
} from "./operation";

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

export interface GridHost {
  readonly listGridSurfaces: () => Promise<readonly GridSurfaceSpec[]>;
  readonly openGrid: (surface: string, source: string, revision: string) => Promise<GridSession>;
  readonly gridWindow: (surface: string, instance: string, request: GridWindowRequest) => Promise<GridWindow>;
  readonly applyGrid: (surface: string, instance: string, request: GridApplyRequest) => Promise<GridCommit>;
  readonly reloadGrid: (surface: string, instance: string, source: string, revision: string) => Promise<GridSession>;
  readonly closeGrid: (surface: string, instance: string) => Promise<void>;
}

export interface GridChange {
  readonly text: string;
  readonly operation: GridOperation;
  readonly origin: EditorChangeOrigin;
}

export interface GridEngineOptions {
  readonly surfaceId: string;
  readonly formatId?: string | null;
  readonly revision?: string;
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

function utf16Offset(source: string, rawByteOffset: number): number {
  const bytes = new TextEncoder().encode(source);
  const offset = byteOffset(rawByteOffset);
  if (offset > bytes.length || !safeSourceBoundary(bytes, offset)) {
    throw new Error("grid source diff splits UTF-8 or CRLF");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, offset)).length;
  } catch {
    throw new Error("grid source diff splits UTF-8 or CRLF");
  }
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

function operationFromCommit(source: string, commit: GridCommit, patches: readonly GridCellPatch[]): GridOperation {
  const after = applySourceEdit(source, commit.edit);
  const edit = {
    from: utf16Offset(source, commit.edit.from),
    to: utf16Offset(source, commit.edit.to),
    deleted: commit.edit.deleted,
    inserted: commit.edit.inserted,
  };
  const operation: TextOperation = {
    beforeLength: source.length,
    afterLength: after.length,
    edits: [edit],
  };
  return { ...operation, kind: "grid", patches };
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
  readonly #formulaEditor: TextEngine;
  readonly #cellEditor: TextEngine;
  readonly #options: GridEngineOptions;
  readonly #stopLanguage: () => void;
  readonly #abort = new AbortController();
  #workbook: GridWorkbook | null = null;
  #sourceWorkbook: GridWorkbook | null = null;
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
  #protocolGeneration = 0;
  #undo: GridCellPatch[][] = [];
  #redo: GridCellPatch[][] = [];
  #pointerAnchor: GridPosition | null = null;

  constructor(parent: HTMLElement, options: GridEngineOptions) {
    const signal = this.#abort.signal;
    this.#options = options;
    this.#root = document.createElement("div");
    this.#root.className = "grid-surface";

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
    this.#root.append(formula, this.#viewport);
    parent.replaceChildren(this.#root);
    this.#stopLanguage = onLanguage(() => {
      this.#viewport.setAttribute("aria-label", t("grid.surface"));
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
    this.#viewport.addEventListener("keydown", (event) => this.#keydown(event), { signal });
    this.#viewport.addEventListener("pointerdown", (event) => this.#pointerDown(event), { signal });
    this.#viewport.addEventListener("pointermove", (event) => this.#pointerMove(event), { signal });
    this.#viewport.addEventListener("pointerup", () => { this.#pointerAnchor = null; }, { signal });
    this.#viewport.addEventListener("copy", (event) => this.#copy(event), { signal });
    this.#viewport.addEventListener("cut", (event) => this.#cut(event), { signal });
    this.#viewport.addEventListener("paste", (event) => this.#paste(event), { signal });
    this.#viewport.addEventListener("dblclick", (event) => {
      const position = this.#eventPosition(event);
      if (position) this.#beginEditing("cell", position);
    }, { signal });
    this.#formulaHost.addEventListener("focusin", () => this.#beginEditing("formula", this.#selection.focus), { signal });
    this.#formulaHost.addEventListener("focusout", () => this.#commitAfterBlur("formula"), { signal });
  }
  setDoc(source: string): void {
    if (this.#destroyed) return;
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
    if (this.#provider) {
      this.#source = source;
      this.#sourceWorkbook = null;
      void this.#reloadProtocol(source);
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

  getDoc(): string { return this.#source; }
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

  /** The selected range as the text a copy would give (TSV), or `null` past the cap. */
  selectedText(): { primary: string; secondary: string[] } | null {
    if (this.#destroyed || !this.#workbook) return null;
    const range = normalizedSelection(this.#selection);
    const cells = (range.rowEnd - range.rowStart + 1) * (range.columnEnd - range.columnStart + 1);
    if (cells > SELECTED_TEXT_CELLS) return null;
    return { primary: selectionTsv(this.#sheet(), this.#selection), secondary: [] };
  }

  setReadOnly(readOnly: boolean): void {
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
    this.#instance = null;
    this.#surface = null;
    this.#formulaEditor.destroy();
    this.#cellEditor.destroy();
    this.#root.remove();
  }

  #sheet(): GridSheet {
    return this.#workbook?.sheets[this.#sheetIndex] ?? EMPTY_SHEET;
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
        const persisted = cellAt(sheet, position);
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
    this.#formulaEditor.setDoc(cellAt(this.#sheet(), this.#selection.focus)?.input ?? "");
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
    const current = cellAt(this.#sheet(), position)?.input ?? "";
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
      this.#cellEditor.focus();
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
      const patch = inputPatch(this.#sheet(), editing.position, editing.draft);
      if (patch) this.#commit([patch], origin, true);
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
    if (this.#provider && this.#instance && this.#surface && this.#options.grid) {
      const instance = this.#instance;
      const surface = this.#surface;
      const generation = this.#protocolGeneration;
      const queuedPatches = patches.map((patch) => ({
        coordinate: { ...patch.coordinate },
        before: patch.before
          ? { input: patch.before.input, style: patch.before.style ? { ...patch.before.style } : undefined }
          : null,
        after: patch.after
          ? { input: patch.after.input, style: patch.after.style ? { ...patch.after.style } : undefined }
          : null,
      }));
      this.#providerCommitTail = this.#providerCommitTail
        .catch(() => {})
        .then(() => this.#applyProvider(beforeSource, queuedPatches, origin, generation, instance, surface))
        .catch(() => {});
    } else {
      this.#options.onChange({ text: committed.source, operation: committed.operation, origin });
    }
    return true;
  }

  #clearSelection(): void {
    if (this.#readOnly) return;
    const range = normalizedSelection(this.#selection);
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
    event.clipboardData.setData("text/plain", selectionTsv(this.#sheet(), this.#selection));
  }

  #cut(event: ClipboardEvent): void {
    if (this.#readOnly) return;
    this.#copy(event);
    this.#clearSelection();
  }

  #paste(event: ClipboardEvent): void {
    if (this.#readOnly || !event.clipboardData) return;
    event.preventDefault();
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
      this.#revision = session.revision;
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

  async #reloadProtocol(source: string): Promise<void> {
    const host = this.#options.grid;
    const instance = this.#instance;
    const surface = this.#surface;
    if (!host || !instance || !surface || !this.#revision) return;
    const generation = ++this.#protocolGeneration;
    try {
      const session = await host.reloadGrid(surface, instance, source, this.#revision);
      validateGridSession(session);
      if (session.instance !== instance) throw new Error("grid reload changed its instance");
      const windows = await this.#readWindows(surface, session);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#revision = session.revision;
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
      this.#sourceWorkbook = parseWorkbook(source);
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

  async #applyProvider(
    beforeSource: string,
    patches: readonly GridCellPatch[],
    origin: EditorChangeOrigin,
    generation: number,
    instance: string,
    surface: string,
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
    let committedSource: string | null = null;
    try {
      const commit = await host.applyGrid(surface, instance, request);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      const source = applySourceEdit(beforeSource, commit.edit);
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#revision = commit.revision;
      this.#session = this.#session ? { ...this.#session, revision: commit.revision } : null;
      this.#source = source;
      committedSource = source;
      this.#options.onChange({
        text: source,
        operation: operationFromCommit(beforeSource, commit, patches),
        origin,
      });
      await this.#readInvalidation(commit.invalidation, generation, instance, surface);
    } catch {
      if (!this.#protocolIsCurrent(generation, instance, surface)) return;
      this.#provider = false;
      this.#instance = null;
      this.#surface = null;
      this.#session = null;
      await host.closeGrid(surface, instance).catch(() => {});
      if (this.#destroyed) return;
      this.#source = committedSource ?? beforeSource;
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

