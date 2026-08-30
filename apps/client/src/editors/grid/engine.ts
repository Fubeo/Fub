import { operationFromText } from "../../editor/text-operation";
import type { Theme } from "../../theme/theme";
import { createTextEngine, type EditorChange, type TextEngine } from "../text/engine";
import { createFormulaProfile } from "../text/profiles/formula";
import { parseWorkbookSource, serializeWorkbook } from "./codec";
import { selectionAsTsv, tsvUpdates } from "./clipboard";
import {
  displayCellValue,
  evaluateSheet,
  evaluatedCell,
  type SheetEvaluation,
} from "./evaluation";
import {
  a1Address,
  applyGridOperation,
  cellAt,
  cellInput,
  columnLabel,
  operationForInputs,
  type CellKey,
  type GridOperation,
  type GridSheet,
  type GridWorkbook,
} from "./model";
import {
  applyNavigation,
  navigationForKey,
  selectionContains,
  selectionRectangle,
  singleCellSelection,
  type GridPoint,
  type GridSelection,
} from "./selection";
import {
  COLUMN_HEADER_HEIGHT,
  DEFAULT_ROW_HEIGHT,
  ROW_HEADER_WIDTH,
  gridLayout,
  visibleGridRange,
  type GridLayout,
} from "./viewport";

export interface GridDocumentChange {
  readonly operation: GridOperation;
  readonly edit: EditorChange;
}
export interface GridEngineViewState {
  readonly sheet: string;
  readonly selection: GridSelection;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}


export interface GridEngineOptions {
  readonly onChange: (change: GridDocumentChange) => void;
  readonly onSelectionChange?: () => void;
  readonly theme?: Theme;
}

interface EditingState {
  readonly owner: "cell" | "formula";
  readonly key: CellKey;
  readonly original: string;
}

const UTF8 = new TextEncoder();

interface HistoryEntry {
  readonly operation: GridOperation;
}

let nextGridEngineId = 1;

export class GridEngine {
  readonly id = `grid-engine-${nextGridEngineId++}`;

  private readonly root: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly address: HTMLSpanElement;
  private readonly formulaHost: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly canvas: HTMLDivElement;
  private readonly cellsLayer: HTMLDivElement;
  private readonly columnHeadersLayer: HTMLDivElement;
  private readonly corner: HTMLDivElement;
  private readonly cellEditorHost: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly formulaEditor: TextEngine;
  private readonly cellEditor: TextEngine;
  private readonly options: GridEngineOptions;
  private readonly abort = new AbortController();
  private readonly resizeObserver: ResizeObserver;

  private workbook: GridWorkbook | null = null;
  private source = "";
  private activeSheetId = "";
  private selection: GridSelection = singleCellSelection({ row: 0, column: 0 });
  private layout: GridLayout | null = null;
  private editing: EditingState | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pointerAnchor: GridPoint | null = null;
  private readOnly = false;
  private suspended = false;
  private evaluation: SheetEvaluation | null = null;
  private destroyed = false;

  constructor(parent: HTMLElement, options: GridEngineOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "grid-surface";
    this.root.dataset.theme = options.theme ?? "dark";

    this.tabs = document.createElement("div");
    this.tabs.className = "grid-sheet-tabs";
    this.tabs.setAttribute("role", "tablist");
    this.tabs.setAttribute("aria-label", "Fogli");

    const formula = document.createElement("div");
    formula.className = "grid-formula-bar";
    this.address = document.createElement("span");
    this.address.className = "grid-address";
    this.address.setAttribute("aria-hidden", "true");
    this.formulaHost = document.createElement("div");
    this.formulaHost.className = "grid-formula-editor";
    this.formulaHost.setAttribute("aria-label", "Formula o valore della cella attiva");
    formula.append(this.address, this.formulaHost);

    this.viewport = document.createElement("div");
    this.viewport.className = "grid-viewport";
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute("role", "grid");
    this.viewport.setAttribute("aria-label", "Foglio di calcolo");
    this.viewport.setAttribute("aria-multiselectable", "true");
    this.canvas = document.createElement("div");
    this.canvas.className = "grid-canvas";
    this.cellsLayer = document.createElement("div");
    this.cellsLayer.className = "grid-cells";
    this.cellsLayer.setAttribute("role", "rowgroup");
    this.columnHeadersLayer = document.createElement("div");
    this.columnHeadersLayer.className = "grid-column-headers";
    this.columnHeadersLayer.setAttribute("role", "row");
    this.corner = document.createElement("div");
    this.corner.className = "grid-corner";
    this.corner.setAttribute("role", "presentation");
    this.cellEditorHost = document.createElement("div");
    this.cellEditorHost.className = "grid-cell-editor";
    this.cellEditorHost.hidden = true;
    this.canvas.append(
      this.cellsLayer,
      this.columnHeadersLayer,
      this.corner,
      this.cellEditorHost,
    );
    this.viewport.append(this.canvas);

    this.status = document.createElement("div");
    this.status.className = "grid-status-visually-hidden";
    this.status.setAttribute("aria-live", "polite");
    this.root.append(this.tabs, formula, this.viewport, this.status);
    parent.append(this.root);

    const formulaProfile = createFormulaProfile({
      singleLine: true,
      completions: { functions: ["SUM", "AVERAGE", "MIN", "MAX", "IF"] },
      callbacks: {
        commit: (value) => this.commitEditor("formula", value),
        cancel: () => this.cancelEditor("formula"),
      },
    });
    this.formulaEditor = createTextEngine(this.formulaHost, {
      onChange: () => {},
      onSelectionChange: () => {},
      extensions: () => formulaProfile.extensions(),
      theme: options.theme,
    });

    const cellProfile = createFormulaProfile({
      singleLine: true,
      completions: { functions: ["SUM", "AVERAGE", "MIN", "MAX", "IF"] },
      callbacks: {
        commit: (value) => this.commitEditor("cell", value),
        cancel: () => this.cancelEditor("cell"),
      },
    });
    this.cellEditor = createTextEngine(this.cellEditorHost, {
      onChange: () => {},
      onSelectionChange: () => {},
      extensions: () => cellProfile.extensions(),
      theme: options.theme,
    });

    const signal = this.abort.signal;
    this.viewport.addEventListener("scroll", () => this.renderViewport(), { signal });
    this.viewport.addEventListener("keydown", (event) => this.handleKeyDown(event), { signal });
    this.viewport.addEventListener("copy", (event) => this.copy(event), { signal });
    this.viewport.addEventListener("paste", (event) => this.paste(event), { signal });
    this.viewport.addEventListener("pointerdown", (event) => this.pointerDown(event), { signal });
    this.viewport.addEventListener("pointermove", (event) => this.pointerMove(event), { signal });
    this.viewport.addEventListener("pointerup", () => this.pointerUp(), { signal });
    this.viewport.addEventListener("dblclick", (event) => this.doubleClick(event), { signal });
    this.formulaHost.addEventListener("focusin", () => this.beginFormulaEdit(), { signal });
    this.formulaHost.addEventListener("focusout", (event) => this.blurEditor("formula", event), {
      signal,
    });
    this.cellEditorHost.addEventListener("focusout", (event) => this.blurEditor("cell", event), {
      signal,
    });
    this.tabs.addEventListener("click", (event) => this.selectSheetFromEvent(event), { signal });

    this.resizeObserver = new ResizeObserver(() => this.renderViewport());
    this.resizeObserver.observe(this.viewport);
  }

  setDocument(source: string): void {
    if (this.destroyed) return;
    this.source = source;
    try {
      const workbook = parseWorkbookSource(source);
      this.workbook = workbook;
      if (!workbook.sheets.some((sheet) => sheet.id === this.activeSheetId)) {
        this.activeSheetId = workbook.sheets[0].id;
      }
      this.evaluation = evaluateSheet(this.sheet()!);
      this.selection = this.clampedSelection(this.selection);
      this.undoStack = [];
      this.redoStack = [];
      this.editing = null;
      this.cellEditorHost.hidden = true;
      this.viewport.removeAttribute("aria-invalid");
      this.viewport.removeAttribute("aria-errormessage");
      this.render();
    } catch (error) {
      this.workbook = null;
      this.layout = null;
      this.evaluation = null;
      this.cellsLayer.replaceChildren();
      this.columnHeadersLayer.replaceChildren();
      this.tabs.replaceChildren();
      this.viewport.setAttribute("aria-invalid", "true");
      this.status.textContent = error instanceof Error ? error.message : String(error);
      this.viewport.setAttribute("aria-errormessage", this.statusId());
    }
  }

  synchronizeDocument(source: string): void {
    if (source === this.source) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.setDocument(source);
    if (hadFocus) this.focus();
  }

  currentSource(): string {
    return this.source;
  }

  focus(): void {
    if (this.destroyed || this.suspended) return;
    this.ensureActiveVisible();
    this.viewport.focus();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.root.classList.toggle("grid-read-only", readOnly);
    this.viewport.setAttribute("aria-readonly", String(readOnly));
    this.formulaEditor.setReadOnly(readOnly);
    this.cellEditor.setReadOnly(readOnly);
    if (readOnly) this.cancelEditor();
  }

  setTheme(theme: Theme): void {
    this.root.dataset.theme = theme;
    this.formulaEditor.setTheme(theme);
    this.cellEditor.setTheme(theme);
  }

  captureViewState(): GridEngineViewState {
    return {
      sheet: this.activeSheetId,
      selection: this.selection,
      scrollLeft: this.viewport.scrollLeft,
      scrollTop: this.viewport.scrollTop,
    };
  }

  restoreViewState(state: unknown): void {
    if (typeof state !== "object" || state === null) return;
    const candidate = state as Partial<GridEngineViewState>;
    if (
      typeof candidate.sheet === "string" &&
      this.workbook?.sheets.some((sheet) => sheet.id === candidate.sheet)
    ) {
      this.activeSheetId = candidate.sheet;
      this.evaluation = evaluateSheet(this.sheet()!);
    }
    if (candidate.selection) this.selection = this.clampedSelection(candidate.selection);
    this.render();
    if (typeof candidate.scrollLeft === "number") this.viewport.scrollLeft = candidate.scrollLeft;
    if (typeof candidate.scrollTop === "number") this.viewport.scrollTop = candidate.scrollTop;
    this.renderViewport();
  }

  suspend(): void {
    this.suspended = true;
    this.root.hidden = true;
  }

  resume(): void {
    this.suspended = false;
    this.root.hidden = false;
    this.renderViewport();
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry || !this.workbook) return false;
    const applied = applyGridOperation(this.workbook, entry.operation);
    this.redoStack.push({ operation: applied.inverse });
    this.acceptApplied(entry.operation, applied.workbook, false);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry || !this.workbook) return false;
    const applied = applyGridOperation(this.workbook, entry.operation);
    this.undoStack.push({ operation: applied.inverse });
    this.acceptApplied(entry.operation, applied.workbook, false);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.formulaEditor.destroy();
    this.cellEditor.destroy();
    this.root.remove();
  }

  private sheet(): GridSheet | null {
    return this.workbook?.sheets.find((sheet) => sheet.id === this.activeSheetId) ?? null;
  }

  private activePoint(): GridPoint {
    return this.selection.focus;
  }

  private activeKey(): CellKey | null {
    const sheet = this.sheet();
    const point = this.activePoint();
    if (!sheet?.rows[point.row] || !sheet.columns[point.column]) return null;
    return { row: sheet.rows[point.row].id, column: sheet.columns[point.column].id };
  }

  private clampedSelection(selection: GridSelection): GridSelection {
    const sheet = this.sheet();
    if (!sheet) return singleCellSelection({ row: 0, column: 0 });
    const row = Math.max(0, Math.min(sheet.rows.length - 1, selection.focus.row));
    const column = Math.max(0, Math.min(sheet.columns.length - 1, selection.focus.column));
    const anchorRow = Math.max(0, Math.min(sheet.rows.length - 1, selection.anchor.row));
    const anchorColumn = Math.max(0, Math.min(sheet.columns.length - 1, selection.anchor.column));
    return { anchor: { row: anchorRow, column: anchorColumn }, focus: { row, column } };
  }

  private render(): void {
    const workbook = this.workbook;
    const sheet = this.sheet();
    if (!workbook || !sheet) return;
    this.layout = gridLayout(sheet);
    this.viewport.setAttribute("aria-rowcount", String(sheet.rows.length));
    this.viewport.setAttribute("aria-colcount", String(sheet.columns.length));
    this.canvas.style.width = `${ROW_HEADER_WIDTH + this.layout.columns.total}px`;
    this.canvas.style.height = `${COLUMN_HEADER_HEIGHT + this.layout.rows.total}px`;
    this.tabs.replaceChildren(
      ...workbook.sheets.map((candidate) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "grid-sheet-tab";
        tab.dataset.sheet = candidate.id;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(candidate.id === sheet.id));
        tab.tabIndex = candidate.id === sheet.id ? 0 : -1;
        tab.textContent = candidate.name;
        return tab;
      }),
    );
    this.renderViewport();
    this.updateFormulaBar();
  }

  private renderViewport(): void {
    const sheet = this.sheet();
    const layout = this.layout;
    if (!sheet || !layout || this.suspended) return;
    const visible = visibleGridRange(
      layout,
      this.viewport.scrollLeft,
      this.viewport.scrollTop,
      this.viewport.clientWidth,
      this.viewport.clientHeight,
    );
    const rows: HTMLElement[] = [];
    for (let row = visible.rows.start; row < visible.rows.end; row += 1) {
      const rowElement = document.createElement("div");
      rowElement.className = "grid-row";
      rowElement.setAttribute("role", "row");
      rowElement.setAttribute("aria-rowindex", String(row + 1));
      const header = document.createElement("div");
      header.className = "grid-row-header";
      header.id = this.rowHeaderId(row);
      header.setAttribute("role", "rowheader");
      header.style.top = `${COLUMN_HEADER_HEIGHT + layout.rows.offsets[row]}px`;
      header.style.left = `${this.viewport.scrollLeft}px`;
      header.style.height = `${layout.rows.sizes[row]}px`;
      header.textContent = String(row + 1);
      rowElement.append(header);
      for (let column = visible.columns.start; column < visible.columns.end; column += 1) {
        rowElement.append(this.cellElement(sheet, row, column));
      }
      rows.push(rowElement);
    }
    this.cellsLayer.replaceChildren(...rows);

    const columnHeaders: HTMLElement[] = [];
    for (let column = visible.columns.start; column < visible.columns.end; column += 1) {
      const header = document.createElement("div");
      header.className = "grid-column-header";
      header.setAttribute("role", "columnheader");
      header.id = this.columnHeaderId(column);
      header.setAttribute("aria-colindex", String(column + 1));
      header.style.left = `${ROW_HEADER_WIDTH + layout.columns.offsets[column]}px`;
      header.style.top = `${this.viewport.scrollTop}px`;
      header.style.width = `${layout.columns.sizes[column]}px`;
      header.textContent = columnLabel(column + 1);
      columnHeaders.push(header);
    }
    this.columnHeadersLayer.replaceChildren(...columnHeaders);
    this.corner.style.left = `${this.viewport.scrollLeft}px`;
    this.corner.style.top = `${this.viewport.scrollTop}px`;
    this.positionEditor();
    this.updateActiveDescendant();
  }

  private cellElement(sheet: GridSheet, row: number, column: number): HTMLDivElement {
    const layout = this.layout!;
    const point = { row, column };
    const key = { row: sheet.rows[row].id, column: sheet.columns[column].id };
    const cell = cellAt(sheet, key);
    const element = document.createElement("div");
    element.className = "grid-cell";
    element.id = this.cellId(point);
    element.dataset.row = String(row);
    element.setAttribute(
      "aria-labelledby",
      `${this.rowHeaderId(row)} ${this.columnHeaderId(column)}`,
    );
    element.dataset.column = String(column);
    element.setAttribute("role", "gridcell");
    element.setAttribute("aria-rowindex", String(row + 1));
    element.setAttribute("aria-colindex", String(column + 1));
    element.setAttribute("aria-selected", String(selectionContains(this.selection, point)));
    element.classList.toggle("grid-cell-active", this.selection.focus.row === row && this.selection.focus.column === column);
    element.style.left = `${ROW_HEADER_WIDTH + layout.columns.offsets[column]}px`;
    element.style.top = `${COLUMN_HEADER_HEIGHT + layout.rows.offsets[row]}px`;
    element.style.width = `${layout.columns.sizes[column]}px`;
    element.style.height = `${layout.rows.sizes[row]}px`;
    element.style.fontWeight = cell?.style.bold ? "700" : "";
    element.style.fontStyle = cell?.style.italic ? "italic" : "";
    element.style.textAlign = cell?.style.alignment ?? "start";
    element.textContent = this.evaluation
      ? displayCellValue(evaluatedCell(this.evaluation, key)?.value ?? { kind: "blank" })
      : "";
    return element;
  }

  private select(point: GridPoint, extend: boolean): void {
    const sheet = this.sheet();
    if (!sheet) return;
    const navigation = {
      point: {
        row: Math.max(0, Math.min(sheet.rows.length - 1, point.row)),
        column: Math.max(0, Math.min(sheet.columns.length - 1, point.column)),
      },
      extend,
      edit: false,
    };
    this.selection = applyNavigation(this.selection, navigation);
    this.ensureActiveVisible();
    this.renderViewport();
    this.updateFormulaBar();
    this.options.onSelectionChange?.();
  }
  private handleKeyDown(event: KeyboardEvent): void {
    if (
      (event.target instanceof Node && this.cellEditorHost.contains(event.target)) ||
      event.defaultPrevented ||
      !this.workbook ||
      !this.sheet() ||
      this.editing
    ) {
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && !this.readOnly) {
      event.preventDefault();
      this.clearSelection();
      return;
    }
    const sheet = this.sheet()!;
    const navigation = navigationForKey(
      event,
      sheet,
      this.activePoint(),
      Math.floor(this.viewport.clientHeight / DEFAULT_ROW_HEIGHT),
    );
    if (navigation) {
      event.preventDefault();
      if (navigation.edit && !this.readOnly) this.beginCellEdit();
      else this.selection = applyNavigation(this.selection, navigation);
      this.ensureActiveVisible();
      this.renderViewport();
      this.updateFormulaBar();
      this.options.onSelectionChange?.();
      return;
    }
    if (!this.readOnly && !command && event.key.length === 1) {
      event.preventDefault();
      this.beginCellEdit(event.key);
    }
  }

  private pointerDown(event: PointerEvent): void {
    const point = this.pointFromTarget(event.target);
    if (!point) return;
    event.preventDefault();
    this.pointerAnchor = event.shiftKey ? this.selection.anchor : point;
    this.selection = {
      anchor: this.pointerAnchor,
      focus: point,
    };
    this.viewport.setPointerCapture(event.pointerId);
    this.renderViewport();
    this.updateFormulaBar();
    this.viewport.focus();
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.pointerAnchor || event.buttons === 0) return;
    const point = this.pointFromCoordinates(event.clientX, event.clientY);
    if (!point) return;
    this.selection = { anchor: this.pointerAnchor, focus: point };
    this.renderViewport();
    this.updateFormulaBar();
  }

  private pointerUp(): void {
    if (!this.pointerAnchor) return;
    this.pointerAnchor = null;
    this.options.onSelectionChange?.();
  }

  private doubleClick(event: MouseEvent): void {
    const point = this.pointFromTarget(event.target);
    if (!point || this.readOnly) return;
    this.select(point, false);
    this.beginCellEdit();
  }

  private pointFromTarget(target: EventTarget | null): GridPoint | null {
    const element = target instanceof Element ? target.closest<HTMLElement>(".grid-cell") : null;
    if (!element) return null;
    const row = Number(element.dataset.row);
    const column = Number(element.dataset.column);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  private pointFromCoordinates(clientX: number, clientY: number): GridPoint | null {
    return this.pointFromTarget(document.elementFromPoint(clientX, clientY));
  }


  private beginCellEdit(replacement?: string): void {
    const key = this.activeKey();
    const sheet = this.sheet();
    if (!key || !sheet || this.readOnly) return;
    const original = cellInput(sheet, key);
    this.editing = { owner: "cell", key, original };
    const text = replacement ?? original;
    this.cellEditor.setDoc(text);
    this.cellEditorHost.hidden = false;
    this.positionEditor();
    this.cellEditor.revealByteOffset(UTF8.encode(text).length);
  }

  private beginFormulaEdit(): void {
    const key = this.activeKey();
    const sheet = this.sheet();
    if (!key || !sheet || this.readOnly || this.editing?.owner === "cell") return;
    this.editing = { owner: "formula", key, original: cellInput(sheet, key) };
  }

  private commitEditor(owner: "cell" | "formula", value: string): void {
    if (this.editing?.owner !== owner || this.readOnly) return;
    const editing = this.editing;
    this.editing = null;
    this.cellEditorHost.hidden = true;
    this.commitInputs([{ ...editing.key, input: value }]);
    this.focus();
  }

  private cancelEditor(owner?: "cell" | "formula"): void {
    if (!this.editing || (owner && this.editing.owner !== owner)) return;
    const editing = this.editing;
    this.editing = null;
    this.cellEditorHost.hidden = true;
    if (editing.owner === "formula") this.formulaEditor.setDoc(editing.original);
    this.focus();
  }

  private blurEditor(owner: "cell" | "formula", event: FocusEvent): void {
    if (this.editing?.owner !== owner) return;
    const host = owner === "cell" ? this.cellEditorHost : this.formulaHost;
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
    const editor = owner === "cell" ? this.cellEditor : this.formulaEditor;
    this.commitEditor(owner, editor.getDoc());
  }

  private commitInputs(updates: readonly (CellKey & { readonly input: string })[]): void {
    if (!this.workbook || this.readOnly) return;
    const operation = operationForInputs(this.workbook, this.activeSheetId, updates);
    if (operation.changes.length === 0) {
      this.updateFormulaBar();
      return;
    }
    const applied = applyGridOperation(this.workbook, operation);
    this.undoStack.push({ operation: applied.inverse });
    this.redoStack = [];
    this.acceptApplied(operation, applied.workbook, true);
  }

  private acceptApplied(operation: GridOperation, workbook: GridWorkbook, resetRedo: boolean): void {
    const before = this.source;
    const source = serializeWorkbook(workbook);
    this.workbook = workbook;
    this.source = source;
    this.evaluation = evaluateSheet(this.sheet()!);
    if (resetRedo) this.redoStack = [];
    this.layout = gridLayout(this.sheet()!);
    this.renderViewport();
    this.updateFormulaBar();
    this.options.onChange({
      operation,
      edit: {
        text: source,
        operation: operationFromText(before, source),
        origin: "input",
      },
    });
  }

  private clearSelection(): void {
    const sheet = this.sheet();
    if (!sheet) return;
    const rectangle = selectionRectangle(this.selection);
    const updates: (CellKey & { input: string })[] = [];
    for (let row = rectangle.rowStart; row <= rectangle.rowEnd; row += 1) {
      for (let column = rectangle.columnStart; column <= rectangle.columnEnd; column += 1) {
        updates.push({ row: sheet.rows[row].id, column: sheet.columns[column].id, input: "" });
      }
    }
    this.commitInputs(updates);
  }

  private copy(event: ClipboardEvent): void {
    const sheet = this.sheet();
    if (event.defaultPrevented || this.editing || !sheet || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionAsTsv(sheet, this.selection));
  }

  private paste(event: ClipboardEvent): void {
    const sheet = this.sheet();
    if (event.defaultPrevented || this.editing || !sheet || !event.clipboardData || this.readOnly) {
      return;
    }
    event.preventDefault();
    const updates = tsvUpdates(sheet, this.activePoint(), event.clipboardData.getData("text/plain"));
    this.commitInputs(updates);
  }

  private updateFormulaBar(): void {
    const sheet = this.sheet();
    const key = this.activeKey();
    if (!sheet || !key) return;
    this.address.textContent = a1Address(sheet, key) ?? "";
    if (this.editing?.owner !== "formula") this.formulaEditor.setDoc(cellInput(sheet, key));
    const rectangle = selectionRectangle(this.selection);
    this.status.id = this.statusId();
    this.status.textContent =
      rectangle.rowStart === rectangle.rowEnd && rectangle.columnStart === rectangle.columnEnd
        ? `Cella ${this.address.textContent}`
        : `Selezione da ${columnLabel(rectangle.columnStart + 1)}${rectangle.rowStart + 1} a ${columnLabel(rectangle.columnEnd + 1)}${rectangle.rowEnd + 1}`;
  }

  private positionEditor(): void {
    if (this.cellEditorHost.hidden || !this.layout) return;
    const point = this.activePoint();
    this.cellEditorHost.style.left = `${ROW_HEADER_WIDTH + this.layout.columns.offsets[point.column]}px`;
    this.cellEditorHost.style.top = `${COLUMN_HEADER_HEIGHT + this.layout.rows.offsets[point.row]}px`;
    this.cellEditorHost.style.width = `${this.layout.columns.sizes[point.column]}px`;
    this.cellEditorHost.style.height = `${this.layout.rows.sizes[point.row]}px`;
  }

  private ensureActiveVisible(): void {
    if (!this.layout) return;
    const point = this.activePoint();
    const left = this.layout.columns.offsets[point.column];
    const right = left + this.layout.columns.sizes[point.column];
    const top = this.layout.rows.offsets[point.row];
    const bottom = top + this.layout.rows.sizes[point.row];
    if (left < this.viewport.scrollLeft) this.viewport.scrollLeft = left;
    else if (right > this.viewport.scrollLeft + this.viewport.clientWidth - ROW_HEADER_WIDTH) {
      this.viewport.scrollLeft = right - this.viewport.clientWidth + ROW_HEADER_WIDTH;
    }
    if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
    else if (bottom > this.viewport.scrollTop + this.viewport.clientHeight - COLUMN_HEADER_HEIGHT) {
      this.viewport.scrollTop = bottom - this.viewport.clientHeight + COLUMN_HEADER_HEIGHT;
    }
  }
  private rowHeaderId(row: number): string {
    return `${this.id}-row-${row + 1}`;
  }

  private columnHeaderId(column: number): string {
    return `${this.id}-column-${column + 1}`;
  }


  private updateActiveDescendant(): void {
    const id = this.cellId(this.activePoint());
    if (document.getElementById(id)) this.viewport.setAttribute("aria-activedescendant", id);
    else this.viewport.removeAttribute("aria-activedescendant");
  }

  private cellId(point: GridPoint): string {
    return `${this.id}-r${point.row + 1}-c${point.column + 1}`;
  }

  private statusId(): string {
    return `${this.id}-status`;
  }

  private selectSheetFromEvent(event: MouseEvent): void {
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-sheet]") : null;
    const sheetId = tab?.dataset.sheet;
    if (!sheetId || !this.workbook?.sheets.some((sheet) => sheet.id === sheetId)) return;
    this.activeSheetId = sheetId;
    this.evaluation = evaluateSheet(this.sheet()!);
    this.selection = singleCellSelection({ row: 0, column: 0 });
    this.viewport.scrollTo(0, 0);
    this.render();
    this.focus();
  }
}
