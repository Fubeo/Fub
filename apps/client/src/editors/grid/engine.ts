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
  GridSelection as GridCommandSelection,
  GridSheetView,
  GridTable,
  GridSurfaceSpec,
  GridWindowRequest,
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
import { hasBorders, horizontalOf, iconOf, paintBorders, paintCell, spills } from "./paint";
import { currencyFormat, shortcutCommand } from "./shortcuts";
import {
  cellKey,
  decimalSeparator,
  DEFAULT_SHEET_VIEW,
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
export const MAX_GRID_SESSION_WINDOWS = 256;
/// Le parti di una cartella che la griglia non disegna, per codice d'avviso
/// di `fub-format-xlsx` (`not-shown-…`).
const NOT_SHOWN_KEYS: Readonly<Record<string, Key>> = {
  "not-shown-charts": "grid.workbook.part.charts",
  "not-shown-images": "grid.workbook.part.images",
  "not-shown-shapes": "grid.workbook.part.shapes",
  "not-shown-sparklines": "grid.workbook.part.sparklines",
};
/// Il comando con cui una formula, o un input, entra in una sessione a comandi.
const SET_VALUES = "range.setValues";
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
  #readOnly = false;
  #destroyed = false;
  #providerCommitTail: Promise<void> = Promise.resolve();
  #undo: GridCellPatch[][] = [];
  #redo: GridCellPatch[][] = [];
  #pointerAnchor: GridPosition | null = null;
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

  constructor(parent: HTMLElement, options: GridEngineOptions) {
    const signal = this.#abort.signal;
    this.#options = options;
    this.#root = document.createElement("div");
    this.#root.className = "grid-surface";
    this.#notice = document.createElement("p");
    this.#notice.className = "grid-notice";
    this.#notice.setAttribute("role", "status");
    this.#notice.hidden = true;
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
    this.#root.append(this.#ribbonHost, this.#notice, formula, this.#viewport, this.#sheetBar);
    parent.replaceChildren(this.#root);
    this.#stopLanguage = onLanguage(() => {
      this.#viewport.setAttribute("aria-label", t("grid.surface"));
      this.#decimal = decimalSeparator(resolvedLanguage());
      this.#showNotice();
      this.#sheetBar.querySelector(".kit-tabs")?.setAttribute("aria-label", t("grid.workbook.sheets"));
      if (!this.#editing) this.#syncFormulaBar();
      this.#render();
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
    return this.#workbookCell(this.#selection.focus)?.style;
  }

  /// Dove la barra multifunzione si monta, sopra la barra della formula.
  ribbonHost(): HTMLElement {
    return this.#ribbonHost;
  }

  /// La vista del foglio mostrato.
  sheetView(): GridSheetView {
    return this.#sheetView();
  }

  /// Le tabelle lette del foglio mostrato.
  tables(): readonly GridTable[] {
    return this.#view?.sheets[this.#sheetIndex]?.tables ?? [];
  }

  /// Ciò che vale per la cartella; `null` finché nessuna sessione è mostrata.
  book(): GridBook | null {
    return this.#shownSession?.book ?? null;
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

  /// Annulla o ripeti del documento, nella sessione a comandi.
  #documentHistory(id: typeof UNDO | typeof REDO): boolean {
    if (!this.#bytes || this.#readOnly || !this.#serves(id)) return false;
    this.#finishEditing(false, "input", false);
    this.#give(id, "{}", true);
    return true;
  }

  /// Mette in coda il comando `id`: da qui annulla e ripeti sono del
  /// provider, anche prima che risponda.
  #give(id: string, params: string, history: boolean): void {
    const selection = this.#commandSelection();
    const command: GridCommand = { id, params, ...selection };
    this.#undo = [];
    this.#redo = [];
    this.#pendingCommandMode += 1;
    const epoch = this.#bytesEpoch;
    const edits = this.#editEpoch;
    const ticket = ++this.#bytesTickets;
    this.#enqueueProtocol(async () => {
      try {
        await this.#giveNow(command, history, epoch, edits, ticket);
      } finally {
        if (epoch === this.#bytesEpoch) this.#pendingCommandMode = Math.max(0, this.#pendingCommandMode - 1);
      }
    });
  }

  async #giveNow(command: GridCommand, history: boolean, epoch: number, edits: number, ticket: number): Promise<void> {
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
    if (outcome.dialog) this.#options.onDialog?.(outcome.dialog);
    if (outcome.commit.edit.from === outcome.commit.edit.to && !outcome.commit.edit.inserted) {
      this.#showView(this.#sheet().id, false);
      return;
    }
    await this.#refreshBytes(state, epoch);
  }

  /// La selezione che un comando ha lasciato: il foglio, l'intervallo che
  /// contiene la cella attiva e la cella attiva, che resta il fuoco quando è
  /// un angolo dell'intervallo.
  #adoptSelection(selection: GridCommandSelection): void {
    const index = this.#workbook?.sheets.findIndex((sheet) => sheet.id === selection.sheet) ?? -1;
    const active = parseCellA1(selection.active);
    if (index < 0 || !active) return;
    const areas = selection.selection.split(",").map(parseRangeA1).filter((area): area is GridRange => area !== null);
    const area = areas.find((candidate) =>
      active.row >= candidate.rowStart && active.row <= candidate.rowEnd
      && active.column >= candidate.columnStart && active.column <= candidate.columnEnd);
    let next: GridSelection = { anchor: active, focus: active };
    if (area) {
      const row = active.row === area.rowStart ? area.rowEnd : area.rowStart;
      const column = active.column === area.columnStart ? area.columnEnd : area.columnStart;
      const corner = (active.row === area.rowStart || active.row === area.rowEnd)
        && (active.column === area.columnStart || active.column === area.columnEnd);
      next = corner
        ? { anchor: { row, column }, focus: active }
        : { anchor: { row: area.rowStart, column: area.columnStart }, focus: { row: area.rowEnd, column: area.columnEnd } };
    }
    const sameSheet = index === this.#sheetIndex;
    if (sameSheet && samePosition(next.anchor, this.#selection.anchor) && samePosition(next.focus, this.#selection.focus)) return;
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
    this.#bytesEpoch++;
    this.#closeBytes();
    this.#sheetTabs?.lifetime.close();
    this.#sheetTabs = null;
    this.#formulaEditor.destroy();
    this.#cellEditor.destroy();
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
    // Una bozza aperta parte dall'input di prima: confermata sul giornale
    // nuovo coprirebbe ciò che l'altro riquadro ha scritto.
    this.#finishEditing(false, "input", false);
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
    const index = view.workbook.sheets.findIndex((sheet) => sheet.id === sheetId);
    this.#sheetIndex = index >= 0 ? index : view.active;
    if (top) this.#selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
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
    this.#sheetIndex = index;
    this.#selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
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
      this.#place(
        rowElement,
        0,
        frame.columnHeader + this.#rows.offsets[row] + (frozen ? scrollTop : 0),
        frame.rowHeader + this.#columns.total,
        this.#rows.sizes[row],
      );
      if (frame.rowHeader > 0) {
        const header = document.createElement("div");
        header.className = "grid-header grid-row-header";
        if (row >= range.rowStart && row <= range.rowEnd) header.classList.add("selected");
        header.setAttribute("role", "rowheader");
        header.setAttribute("aria-rowindex", String(row + 2));
        header.setAttribute("aria-colindex", "1");
        header.textContent = String(row + 1);
        header.style.pointerEvents = "none";
        if (frame.zoom !== 1) header.style.fontSize = `calc(var(--text-sm) * ${frame.zoom})`;
        this.#place(header, scrollLeft, 0, frame.rowHeader, this.#rows.sizes[row]);
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
    rows.push(...this.#freezeLines());

    this.#detachCellEditor();
    for (const row of this.#viewport.querySelectorAll<HTMLElement>(".grid-row, .grid-freeze")) row.remove();
    this.#viewport.append(...rows);
    this.#fitCells(measures);
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
    if (this.#isVisiblePosition(this.#selection.focus) && this.#findCell(this.#selection.focus)) {
      this.#viewport.setAttribute("aria-activedescendant", this.#cellId(this.#selection.focus));
    } else {
      this.#viewport.removeAttribute("aria-activedescendant");
    }
    const name = this.#root.querySelector<HTMLElement>(".grid-cell-name");
    if (name) {
      name.textContent = this.#isVisiblePosition(this.#selection.focus) ? cellA1(this.#selection.focus) : "";
    }
  }

  /// La riga delle intestazioni di colonna, con l'angolo.
  #columnHeaders(columns: readonly number[], range: GridRange): HTMLElement {
    const frame = this.#frame;
    const row = document.createElement("div");
    row.className = "grid-row grid-column-header-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", "1");
    this.#place(row, 0, this.#viewport.scrollTop, frame.rowHeader + this.#columns.total, frame.columnHeader);
    this.#corner.className = "grid-corner";
    this.#corner.setAttribute("role", "presentation");
    this.#corner.textContent = "";
    this.#corner.style.pointerEvents = "none";
    this.#place(this.#corner, this.#viewport.scrollLeft, 0, frame.rowHeader, frame.columnHeader);
    row.append(this.#corner);
    for (const column of columns) {
      if (this.#columns.sizes[column] === 0) continue;
      const header = document.createElement("div");
      header.className = column < frame.frozenColumns ? "grid-header grid-column-header frozen" : "grid-header grid-column-header";
      if (column >= range.columnStart && column <= range.columnEnd) header.classList.add("selected");
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
    const selected = row <= range.rowEnd && lastRow >= range.rowStart && column <= range.columnEnd && lastColumn >= range.columnStart;
    element.setAttribute("aria-selected", String(selected));
    if (selected) element.classList.add("selected");
    if (samePosition(position, this.#selection.focus)) element.classList.add("active");
    const text = document.createElement("span");
    text.className = "grid-cell-text";
    text.textContent = workbookCell?.cell.input ?? "";
    paintCell(element, text, style, bytes, this.#gridFont());
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
      const mark = document.createElement("span");
      mark.className = bytes.comment.threaded ? "grid-comment-mark threaded" : "grid-comment-mark";
      mark.setAttribute("aria-hidden", "true");
      element.append(mark);
      const thread = [bytes.comment, ...bytes.comment.replies].map((note) => note.author ? `${note.author}: ${note.text}` : note.text);
      element.title = thread.join("\n");
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

  #syncFormulaBar(): void {
    if (!this.#workbook) return;
    const bytes = this.#workbookCell(this.#selection.focus)?.bytes;
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
      selection: rangeA1(this.#selectedRange()),
      active: cellA1(this.#selection.focus),
    };
  }

  #select(position: GridPosition, extend: boolean): void {
    const clamped = this.#clampedPosition(position);
    const merge = mergeAt(this.#merges(), clamped);
    const focus = merge && !extend ? { row: merge.row, column: merge.column } : clamped;
    this.#selection = extend
      ? { anchor: this.#selection.anchor, focus }
      : { anchor: focus, focus };
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

  /// Un passo del cursore. Da un'unione si parte dal suo bordo, e in
  /// un'unione si arriva nella sua cella in alto a sinistra.
  #move(rowStep: number, columnStep: number, extend: boolean): void {
    const focus = this.#selection.focus;
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
    const at = (index: number): GridPosition => axis === "row"
      ? { row: index, column: this.#selection.focus.column }
      : { row: this.#selection.focus.row, column: index };
    let index = axis === "row" ? this.#selection.focus.row : this.#selection.focus.column;
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

  /// Le righe di una pagina, per PagSu e PagGiù.
  #pageRows(): number {
    return Math.max(1, Math.floor((this.#viewport.clientHeight - this.#frame.columnHeader - this.#frame.frozenHeight) / (DEFAULT_ROW_HEIGHT * this.#frame.zoom)));
  }

  /// Seleziona le righe (o le colonne) intere della selezione.
  #selectWhole(axis: "row" | "column"): void {
    const range = this.#selectedRange();
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
    if (this.#commands.length && !this.#readOnly) {
      const range = this.#selectedRange();
      const shortcut = shortcutCommand(event, {
        wholeRows: range.columnStart === this.#edgeVisible("column", false) && range.columnEnd === this.#edgeVisible("column", true),
        wholeColumns: range.rowStart === this.#edgeVisible("row", false) && range.rowEnd === this.#edgeVisible("row", true),
        currency: currencyFormat(resolvedLanguage()),
      });
      if (shortcut) {
        event.preventDefault();
        this.command(shortcut.id, shortcut.params);
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
      case "PageUp": this.#move(-this.#pageRows(), 0, extend); break;
      case "PageDown": this.#move(this.#pageRows(), 0, extend); break;
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

  #selectAll(): void {
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

  #beginEditing(owner: "cell" | "formula", position: GridPosition, initial?: string): void {
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
      this.#commitCells([{ position: editing.position, after: fileInput(editing.draft, this.#decimal) }], origin, true);
    }
    this.#syncFormulaBar();
    this.#render();
    if (restoreFocus) queueMicrotask(() => this.#viewport.focus());
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
  }

  #copy(event: ClipboardEvent): void {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionTsv(this.#selection, (position) => this.#cellAt(position)));
  }

  #cut(event: ClipboardEvent): void {
    if (this.#readOnly) return;
    this.#copy(event);
    this.#clearSelection();
  }

  #paste(event: ClipboardEvent): void {
    if (this.#readOnly || !event.clipboardData) return;
    event.preventDefault();
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
    this.#selectionChanged();
  }

  #pointerMove(event: PointerEvent): void {
    if (!this.#pointerAnchor || event.buttons === 0) return;
    const position = this.#eventPosition(event);
    if (!position) return;
    this.#selection = { anchor: this.#pointerAnchor, focus: position };
    this.#render();
    this.#selectionChanged();
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
