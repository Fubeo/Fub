import type {
  GridApplyRequest,
  GridCommit,
  GridInvalidation,
  GridSession,
  GridSurfaceSpec,
  GridWindow,
  GridWindowRequest,
  SheetCellValue,
  SheetEvaluation,
} from "../../host/contract";
import type { TextOperation } from "../../editor/text-operation";
import type { Theme } from "../../theme/theme";
import { createTextEngine, type EditorChangeOrigin, type TextEngine } from "../text/engine";
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

const DEFAULT_ROW_HEIGHT = 28;
const DEFAULT_COLUMN_WIDTH = 120;
const ROW_HEADER_WIDTH = 52;
const COLUMN_HEADER_HEIGHT = 28;
const EMPTY_SHEET: GridSheet = { id: "", name: "", rows: [], columns: [] };
export const GRID_OVERSCAN = 2;

export interface GridHost {
  readonly listGridSurfaces: () => Promise<readonly GridSurfaceSpec[]>;
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
  /** Kept for isolated legacy engine tests; production uses the GridHost. */
  readonly evaluate?: (source: string) => Promise<SheetEvaluation>;
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

function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.row === right.row && left.column === right.column;
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value));
}
function utf16Offset(source: string, byteOffset: number): number {
  const bytes = new TextEncoder().encode(source);
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > bytes.length) {
    throw new Error("grid source diff offset is out of bounds");
  }
  return new TextDecoder().decode(bytes.slice(0, byteOffset)).length;
}

function applySourceEdit(source: string, edit: GridCommit["edit"]): string {
  const bytes = new TextEncoder().encode(source);
  if (edit.from > edit.to || edit.to > bytes.length) throw new Error("grid source diff is out of bounds");
  const deleted = new TextDecoder().decode(bytes.slice(Number(edit.from), Number(edit.to)));
  if (deleted !== edit.deleted) throw new Error("grid source diff preimage mismatch");
  const inserted = new TextEncoder().encode(edit.inserted);
  const result = new Uint8Array(Number(edit.from) + inserted.length + bytes.length - Number(edit.to));
  result.set(bytes.slice(0, Number(edit.from)), 0);
  result.set(inserted, Number(edit.from));
  result.set(bytes.slice(Number(edit.to)), Number(edit.from) + inserted.length);
  return new TextDecoder().decode(result);
}

function operationFromCommit(source: string, commit: GridCommit, patches: readonly GridCellPatch[]): GridOperation {
  const after = applySourceEdit(source, commit.edit);
  const edit = {
    from: utf16Offset(source, Number(commit.edit.from)),
    to: utf16Offset(source, Number(commit.edit.to)),
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
): GridWorkbook {
  const sheets = session.sheets.map((sheet) => {
    const sheetWindows = windows.filter((window) => window.sheet === sheet.id);
    const rows = [...new Map(sheetWindows.flatMap((window) => window.rows.map((row) => [row.index, row]))).values()]
      .sort((left, right) => left.index - right.index)
      .map(rowFromProtocol);
    const columns = [...new Map(sheetWindows.flatMap((window) => window.columns.map((column) => [column.index, column]))).values()]
      .sort((left, right) => left.index - right.index)
      .map(columnFromProtocol);
    const cells = sheetWindows.flatMap((window) => window.cells.map((cell): GridCell => ({
      row: cell.key.row,
      column: cell.key.column,
      input: cell.input,
      style: {
        bold: cell.style.bold,
        italic: cell.style.italic,
        text_color: cell.style.text_color ?? undefined,
        fill_color: cell.style.fill_color ?? undefined,
        horizontal: cell.style.horizontal ?? undefined,
        number_format: cell.style.number_format ?? undefined,
      },
    })));
    return { id: sheet.id, name: sheet.name, rows, columns, cells };
  });
  return { version: 1, sheets };
}

function valuesFromWindows(windows: readonly GridWindow[]): Map<string, SheetCellValue> {
  return new Map(
    windows.flatMap((window) => window.cells.map((cell) => [key(cell.key.sheet, cell.key.row, cell.key.column), cell.value] as const)),
  );
}
export class GridEngine {
  readonly #root: HTMLElement;
  readonly #formulaHost: HTMLElement;
  readonly #viewport: HTMLElement;
  readonly #canvas: HTMLElement;
  readonly #cells: HTMLElement;
  readonly #columnHeaders: HTMLElement;
  readonly #rowHeaders: HTMLElement;
  readonly #corner: HTMLElement;
  readonly #cellEditorHost: HTMLElement;
  readonly #formulaEditor: TextEngine;
  readonly #cellEditor: TextEngine;
  readonly #options: GridEngineOptions;
  readonly #abort = new AbortController();
  #workbook: GridWorkbook | null = null;
  #sheetIndex = 0;
  #source = "";
  #revision = "";
  #instance: string | null = null;
  #surface: string | null = null;
  #provider = false;
  #selection: GridSelection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
  #values = new Map<string, SheetCellValue>();
  #rows: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  #columns: AxisLayout = { offsets: [0], sizes: [], total: 0 };
  #editing: EditingState | null = null;
  #readOnly = false;
  #destroyed = false;
  #evaluationGeneration = 0;
  #protocolGeneration = 0;
  #undo: GridCellPatch[][] = [];
  #redo: GridCellPatch[][] = [];
  #pointerAnchor: GridPosition | null = null;

  constructor(parent: HTMLElement, options: GridEngineOptions) {
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
    this.#viewport.setAttribute("aria-label", "Foglio di calcolo");
    this.#canvas = document.createElement("div");
    this.#canvas.className = "grid-canvas";
    this.#cells = document.createElement("div");
    this.#cells.className = "grid-cells";
    this.#columnHeaders = document.createElement("div");
    this.#columnHeaders.className = "grid-column-headers";
    this.#rowHeaders = document.createElement("div");
    this.#rowHeaders.className = "grid-row-headers";
    this.#corner = document.createElement("div");
    this.#corner.className = "grid-corner";
    this.#corner.setAttribute("role", "presentation");
    this.#cellEditorHost = document.createElement("div");
    this.#cellEditorHost.className = "grid-cell-editor";
    this.#cellEditorHost.hidden = true;
    this.#canvas.append(this.#cells, this.#columnHeaders, this.#rowHeaders, this.#corner, this.#cellEditorHost);
    this.#viewport.append(this.#canvas);
    this.#root.append(formula, this.#viewport);
    parent.replaceChildren(this.#root);

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
      extensions: () => cellProfile.extensions(),
    });

    const signal = this.#abort.signal;
    this.#viewport.addEventListener("scroll", () => this.#render(), { signal });
    this.#viewport.addEventListener("keydown", (event) => this.#keydown(event), { signal });
    this.#viewport.addEventListener("pointerdown", (event) => this.#pointerDown(event), { signal });
    this.#viewport.addEventListener("pointermove", (event) => this.#pointerMove(event), { signal });
    this.#viewport.addEventListener("pointerup", () => { this.#pointerAnchor = null; }, { signal });
    this.#viewport.addEventListener("copy", (event) => this.#copy(event), { signal });
    this.#viewport.addEventListener("cut", (event) => this.#cut(event), { signal });
    this.#viewport.addEventListener("paste", (event) => this.#paste(event), { signal });
    this.#cells.addEventListener("dblclick", (event) => {
      const position = this.#eventPosition(event);
      if (position) this.#beginEditing("cell", position);
    }, { signal });
    this.#formulaHost.addEventListener("focusin", () => this.#beginEditing("formula", this.#selection.focus), { signal });
    this.#formulaHost.addEventListener("focusout", () => this.#commitAfterBlur("formula"), { signal });
    this.#cellEditorHost.addEventListener("focusout", () => this.#commitAfterBlur("cell"), { signal });
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
    this.#source = source;
    this.#revision = this.#options.revision ?? "";
    this.#workbook = parseWorkbook(source);
    this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
    this.#selection = this.#clampedSelection(this.#selection);
    this.#undo = [];
    this.#redo = [];
    this.#rebuildLayout();
    this.#selection = this.#visibleSelection(this.#selection);
    this.#syncFormulaBar();
    this.#render();
    if (this.#options.grid) void this.#openProtocol(source);
    else void this.#evaluateLegacy();
  }

  syncDoc(update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this.#destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    const operation = typeof update === "string" ? null : update.operation;
    if (this.#provider) {
      this.#source = source;
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
    if (reloaded && this.#editing) {
      this.#editing = null;
      this.#cellEditorHost.hidden = true;
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
    if (!this.#options.grid) void this.#evaluateLegacy();
  }

  getDoc(): string { return this.#source; }

  focus(): void {
    if (!this.#destroyed) this.#viewport.focus();
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

  renderedCellCount(): number {
    return this.#cells.childElementCount;
  }

  selection(): GridSelection { return this.#selection; }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
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
    const cells: HTMLElement[] = [];
    const rowHeaders: HTMLElement[] = [];
    const columnHeaders: HTMLElement[] = [];
    for (let column = columnWindow.start; column <= columnWindow.end; column += 1) {
      if (this.#columns.sizes[column] === 0) continue;
      const header = document.createElement("div");
      header.className = "grid-header grid-column-header";
      header.setAttribute("role", "columnheader");
      header.setAttribute("aria-colindex", String(column + 2));
      header.textContent = columnLabel(column);
      this.#place(header, ROW_HEADER_WIDTH + this.#columns.offsets[column], this.#viewport.scrollTop, this.#columns.sizes[column], COLUMN_HEADER_HEIGHT);
      columnHeaders.push(header);
    }
    for (let row = rowWindow.start; row <= rowWindow.end; row += 1) {
      if (this.#rows.sizes[row] === 0) continue;
      const header = document.createElement("div");
      header.className = "grid-header grid-row-header";
      header.setAttribute("role", "rowheader");
      header.setAttribute("aria-rowindex", String(row + 2));
      header.textContent = String(row + 1);
      this.#place(header, this.#viewport.scrollLeft, COLUMN_HEADER_HEIGHT + this.#rows.offsets[row], ROW_HEADER_WIDTH, this.#rows.sizes[row]);
      rowHeaders.push(header);
      for (let column = columnWindow.start; column <= columnWindow.end; column += 1) {
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
        this.#place(element, ROW_HEADER_WIDTH + this.#columns.offsets[column], COLUMN_HEADER_HEIGHT + this.#rows.offsets[row], this.#columns.sizes[column], this.#rows.sizes[row]);
        cells.push(element);
      }
    }
    this.#cells.replaceChildren(...cells);
    this.#rowHeaders.replaceChildren(...rowHeaders);
    this.#columnHeaders.replaceChildren(...columnHeaders);
    this.#place(this.#corner, this.#viewport.scrollLeft, this.#viewport.scrollTop, ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT);
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
    if (this.#editing?.owner === "cell") this.#positionEditor(this.#editing.position);
  }

  #place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
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

  #tab(step: -1 | 1): void {
    const focus = this.#selection.focus;
    const column = this.#nextVisible("column", focus.column, step);
    if (column !== focus.column) {
      this.#select({ row: focus.row, column }, false);
      return;
    }
    const row = this.#nextVisible("row", focus.row, step);
    if (row !== focus.row) {
      this.#select({ row, column: this.#edgeVisible("column", step < 0) }, false);
    }
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
      case "Tab": this.#tab(extend ? -1 : 1); break;
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
      this.#cellEditorHost.hidden = false;
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
    this.#cellEditorHost.hidden = true;
    if (commit && editing.draft !== editing.original) {
      const patch = inputPatch(this.#sheet(), editing.position, editing.draft);
      if (patch) this.#commit([patch], origin, true);
    }
    this.#syncFormulaBar();
    this.#render();
    if (restoreFocus) queueMicrotask(() => this.#viewport.focus());
  }

  #positionEditor(position: GridPosition): void {
    this.#place(
      this.#cellEditorHost,
      ROW_HEADER_WIDTH + this.#columns.offsets[position.column],
      COLUMN_HEADER_HEIGHT + this.#rows.offsets[position.row],
      this.#columns.sizes[position.column],
      this.#rows.sizes[position.row],
    );
  }

  #commit(patches: readonly GridCellPatch[], origin: EditorChangeOrigin, recordHistory: boolean): boolean {
    if (!this.#workbook || this.#readOnly) return false;
    const beforeSource = this.#source;
    const committed = commitGridPatches(this.#workbook, this.#source, patches);
    if (!committed) return false;
    this.#source = committed.source;
    if (recordHistory) {
      this.#undo.push([...patches]);
      this.#redo = [];
    }
    this.#render();
    if (this.#provider && this.#instance && this.#options.grid) {
      const request: GridApplyRequest = {
        revision: this.#revision,
        patches: patches.map((patch) => ({
          cell: patch.coordinate,
          before: patch.before?.input ?? null,
          after: patch.after?.input ?? "",
        })),
      };
      void this.#applyProvider(request, beforeSource, patches, origin, this.#protocolGeneration);
    } else {
      this.#options.onChange({ text: committed.source, operation: committed.operation, origin });
      void this.#evaluateLegacy();
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
  async #evaluateLegacy(): Promise<void> {
    if (!this.#options.evaluate) return;
    const generation = ++this.#evaluationGeneration;
    const source = this.#source;
    try {
      const evaluation = await this.#options.evaluate(source);
      if (generation !== this.#evaluationGeneration || this.#destroyed || source !== this.#source) return;
      this.#values = new Map(evaluation.cells.map((cell) => [key(cell.sheet, cell.row, cell.column), cell.value]));
      delete this.#root.dataset.evaluation;
      this.#render();
    } catch {
      if (generation !== this.#evaluationGeneration || this.#destroyed) return;
      this.#values.clear();
      this.#root.dataset.evaluation = "unavailable";
      this.#render();
    }
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
      this.#provider = true;
      this.#values = valuesFromWindows(windows);
      this.#workbook = workbookFromWindows(session, windows);
      this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
      this.#selection = this.#visibleSelection(this.#clampedSelection(this.#selection));
      this.#rebuildLayout();
      this.#syncFormulaBar();
      delete this.#root.dataset.evaluation;
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
      this.#root.dataset.evaluation = "unavailable";
      this.#root.dataset.gridProtocol = "fallback";
      this.#render();
    }
  }

  async #readWindows(surface: string, session: GridSession): Promise<GridWindow[]> {
    const host = this.#options.grid;
    if (!host) return [];
    const windows: GridWindow[] = [];
    for (const sheet of session.sheets) {
      for (let row = 0; row < sheet.row_count; row += 256) {
        for (let column = 0; column < sheet.column_count; column += 128) {
          windows.push(await host.gridWindow(surface, session.instance, {
            revision: session.revision,
            sheet: sheet.id,
            row_start: row,
            row_count: Math.min(256, sheet.row_count - row),
            column_start: column,
            column_count: Math.min(128, sheet.column_count - column),
          }));
        }
      }
    }
    return windows;
  }

  async #reloadProtocol(source: string): Promise<void> {
    const host = this.#options.grid;
    const instance = this.#instance;
    const surface = this.#surface;
    if (!host || !instance || !surface || !this.#revision) return;
    const generation = ++this.#protocolGeneration;
    try {
      const session = await host.reloadGrid(surface, instance, source, this.#revision);
      const windows = await this.#readWindows(surface, session);
      if (generation !== this.#protocolGeneration || this.#destroyed) return;
      this.#revision = session.revision;
      this.#values = valuesFromWindows(windows);
      this.#workbook = workbookFromWindows(session, windows);
      this.#sheetIndex = Math.max(0, Math.min(this.#sheetIndex, this.#workbook.sheets.length - 1));
      this.#selection = this.#visibleSelection(this.#clampedSelection(this.#selection));
      this.#provider = true;
      this.#rebuildLayout();
      this.#syncFormulaBar();
      this.#render();
    } catch {
      if (generation !== this.#protocolGeneration || this.#destroyed) return;
      const stale = this.#instance;
      this.#provider = false;
      this.#instance = null;
      this.#surface = null;
      if (stale) await host.closeGrid(surface, stale).catch(() => {});
      this.#workbook = parseWorkbook(source);
      this.#values.clear();
      this.#selection = this.#clampedSelection(this.#selection);
      this.#rebuildLayout();
      this.#selection = this.#visibleSelection(this.#selection);
      this.#syncFormulaBar();
      this.#root.dataset.evaluation = "unavailable";
      this.#root.dataset.gridProtocol = "fallback";
      this.#render();
      void this.#evaluateLegacy();
    }
  }

  async #applyProvider(
    request: GridApplyRequest,
    beforeSource: string,
    patches: readonly GridCellPatch[],
    origin: EditorChangeOrigin,
    generation: number,
  ): Promise<void> {
    const host = this.#options.grid;
    const instance = this.#instance;
    const surface = this.#surface;
    if (!host || !instance || !surface) return;
    let committedSource: string | null = null;
    try {
      const commit = await host.applyGrid(surface, instance, request);
      if (generation !== this.#protocolGeneration || this.#destroyed) return;
      const source = applySourceEdit(beforeSource, commit.edit);
      this.#revision = commit.revision;
      this.#source = source;
      committedSource = source;
      this.#options.onChange({
        text: source,
        operation: operationFromCommit(beforeSource, commit, patches),
        origin,
      });
      await this.#readInvalidation(commit.invalidation, generation);
    } catch {
      const stale = this.#instance;
      this.#protocolGeneration++;
      this.#provider = false;
      this.#instance = null;
      this.#surface = null;
      if (stale) await host.closeGrid(surface, stale).catch(() => {});
      this.#source = committedSource ?? beforeSource;
      this.#values.clear();
      this.#workbook = parseWorkbook(this.#source);
      this.#root.dataset.evaluation = "unavailable";
      this.#root.dataset.gridProtocol = "fallback";
      this.#rebuildLayout();
      this.#render();
      void this.#evaluateLegacy();
    }
  }

  async #readInvalidation(invalidation: GridInvalidation, generation: number): Promise<void> {
    const host = this.#options.grid;
    const instance = this.#instance;
    const surface = this.#surface;
    if (!host || !instance || !surface || !this.#workbook) return;
    if (invalidation.kind === "all") {
      const session: GridSession = {
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
      if (generation !== this.#protocolGeneration || this.#destroyed) return;
      this.#values = valuesFromWindows(windows);
      this.#workbook = workbookFromWindows(session, windows);
    } else {
      const requests = invalidation.cells.map((cell) => {
        const sheet = this.#workbook!.sheets.find((candidate) => candidate.id === cell.sheet);
        const row = Math.max(0, sheet?.rows.findIndex((candidate) => candidate.id === cell.row) ?? 0);
        const column = Math.max(0, sheet?.columns.findIndex((candidate) => candidate.id === cell.column) ?? 0);
        const rowStart = Math.floor(row / 256) * 256;
        const columnStart = Math.floor(column / 128) * 128;
        return host.gridWindow(surface, instance, {
          revision: this.#revision,
          sheet: cell.sheet,
          row_start: rowStart,
          row_count: Math.min(256, Math.max(1, (sheet?.rows.length ?? 1) - rowStart)),
          column_start: columnStart,
          column_count: Math.min(128, Math.max(1, (sheet?.columns.length ?? 1) - columnStart)),
        });
      });
      const windows = await Promise.all(requests);
      if (generation !== this.#protocolGeneration || this.#destroyed) return;
      for (const window of windows) {
        const sheet = this.#workbook.sheets.find((candidate) => candidate.id === window.sheet);
        if (!sheet) continue;
        for (const cell of window.cells) {
          this.#values.set(key(cell.key.sheet, cell.key.row, cell.key.column), cell.value);
          const existing = cellAt(sheet, {
            row: window.rows.findIndex((row) => row.id === cell.key.row),
            column: window.columns.findIndex((column) => column.id === cell.key.column),
          });
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
    this.#render();
  }
}

