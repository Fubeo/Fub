// La scheda di foglio della lavagna (N6 T7): un `.xlsx` mostra le celle del
// suo foglio attivo, in lettura, con le intestazioni di righe e colonne.
//
// La scheda apre la superficie del foglio come il foglio vero
// (`engine.ts`, `#openBytes`): la superficie della famiglia `grid`, della
// versione 2 del protocollo e del formato del file; poi `openGridBytes` sul
// giornale e sulla base che dà la porta (`SheetCardPort.source`), e chiede
// con `gridBytesWindow` solo le righe e le colonne che la scheda mostra. Ogni
// cella si disegna con la stessa `paintCell` della griglia, sulle stesse
// classi (`grid-cell`, `grid-header`…), dentro `look-file` o, se la porta dà
// una carta, `look-adattato`.
//
// I modi:
//
// - **viva**: la sessione è aperta. Entrati nella scheda (`enter`) la
//   rotella scorre il foglio e chiede le finestre nuove, il trascinamento
//   sceglie un rettangolo di celle, Ctrl+C lo copia come testo a
//   tabulazioni. `leave` toglie la selezione e lascia lo scorrimento.
// - **ferma**: la sessione si chiude (`closeGridBytes`); restano le celle
//   disegnate, `inert`. Una scheda mai stata viva mostra la specie e il
//   percorso, il segnaposto di oggi.
//
// La scheda non scrive mai: non chiama `applyGridBytes` né i comandi (A-4,
// D-7). Ogni sessione aperta si chiude una volta sola, anche se l'apertura
// risponde dopo un cambio di modo o dopo `destroy`: un contatore di
// generazione scarta le risposte tardive, e chi le riceve chiude ciò che
// hanno aperto.

import type { GridBytesCell, GridBytesSession, GridBytesWindow, GridCellStyle, GridMerge, GridWindowRequest } from "../../host/contract";
import { GRID_BYTES_PROTOCOL_VERSION, GRID_FAMILY } from "../../host/contract";
import { isErrorKind } from "../../host/errors";
import { t } from "../../i18n/strings";
import { writeClipboardText } from "../../platform/clipboard";
import { adapter, type Adapter, type Paper } from "../../theme/adapt";
import { markLook } from "../../theme/content-look";
import { formatKindOf, formatNameOf } from "../../ui/format-kind";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { CardContext, CardMode, CardRenderer, CardView } from "../canvas/cards";
import type { CanvasNode } from "../canvas/model";
import { tsvRows } from "../core/tsv";
import type { GridHost } from "./engine";
import { expandToMerges, mergeAt, type GridRange } from "./merges";
import { columnLabel, type GridPosition } from "./model";
import { hasBorders, paintBorders, paintCell } from "./paint";
import { cellKey, validateBytesSession, validateBytesWindow, WORKBOOK_SCALE } from "./workbook";

/// Ciò che la scheda di foglio chiede a chi la monta.
export interface SheetCardPort {
  /// Le chiamate della superficie del foglio; la scheda non usa
  /// `applyGridBytes` né i comandi.
  readonly host: GridHost;
  /// Il giornale e la base da aprire, e il formato del file: quelli della
  /// sessione aperta del documento se c'è (A-9), sennò il giornale vuoto e
  /// la revisione dei byte su disco. `null`: il file non c'è.
  source(path: string): Promise<{ journal: string; base: string; format: string | null } | null>;
  /// La carta del tema su cui portare i colori del file (l'aspetto
  /// adattato); senza, le celle stanno sulla carta del file.
  paper(): Paper | undefined;
  /// Avvisa quando il file cambia; restituisce come smettere.
  watch(path: string, changed: () => void): () => void;
  /// Apre il file, per «Apri»; senza, il pulsante non c'è.
  open?(path: string, subpath: string | null): void;
}

/// Che cosa mostra la scheda adesso; sta in `data-card-state` della radice.
export type SheetCardState = "placeholder" | "loading" | "content" | "unavailable" | "missing";

/// La riga e la colonna di serie e le intestazioni, in unità della lavagna:
/// quelle del foglio aperto (`engine.ts`).
export const SHEET_CARD_ROW_HEIGHT = 28;
export const SHEET_CARD_COLUMN_WIDTH = 120;
export const SHEET_CARD_ROW_HEADER = 52;
export const SHEET_CARD_COLUMN_HEADER = 28;
/// Una finestra chiede al più queste righe e colonne: i limiti di
/// `validateBytesWindow`.
const MAX_WINDOW_ROWS = 256;
const MAX_WINDOW_COLUMNS = 128;
/// Le finestre tenute dopo lo scorrimento. Quelle che la selezione tocca si
/// tengono prima delle altre, fino a `MAX_PINNED_WINDOWS`: la copia legge
/// solo celle lette, e una selezione che perde le sue si toglie.
const MAX_KEPT_WINDOWS = 8;
const MAX_PINNED_WINDOWS = 32;
/// Quante letture al più per coprire la vista: una riga alta o nascosta
/// cambia quante righe servono, e la lettura dopo lo sa.
const MAX_WINDOW_PASSES = 4;

/// Il renderer delle schede di foglio.
export function sheetCardRenderer(port: SheetCardPort): CardRenderer {
  return {
    kinds: ["sheet"],
    mount(_node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView {
      return new SheetCard(port, host, mode, context);
    },
  };
}

/// Una sessione aperta: chi la chiude per primo la segna chiusa.
interface OpenSession {
  readonly surface: string;
  readonly instance: string;
  readonly session: GridBytesSession;
  closed: boolean;
}

/// Le righe (o le colonne) che la scheda mostra: indice, posizione e misura.
interface AxisSlot {
  readonly index: number;
  readonly offset: number;
  readonly size: number;
}

interface Selection {
  anchor: GridPosition;
  focus: GridPosition;
}

/// La porta dice che il file non c'è.
class SheetMissing extends Error {}

class SheetCard implements CardView {
  readonly #port: SheetCardPort;
  readonly #context: CardContext;
  readonly #root: HTMLElement;
  #mode: CardMode;
  #state: SheetCardState = "placeholder";
  #destroyed = false;
  #entered = false;
  /// Cresce a ogni apertura, chiusura e cambio di modo: risponde solo l'ultima.
  #generation = 0;
  #open: OpenSession | null = null;
  /// Il foglio mostrato e le finestre lette della sua revisione.
  #sheet: string | null = null;
  #windows: GridBytesWindow[] = [];
  /// La prima riga e la prima colonna in vista.
  #top = 0;
  #left = 0;
  #selection: Selection | null = null;
  #dragging = false;
  /// Le celle disegnate: restano, ferme, quando la scheda si ferma.
  #grid: HTMLElement | null = null;
  #rows: AxisSlot[] = [];
  #columns: AxisSlot[] = [];
  #loading: Promise<void> | null = null;
  #loadQueued = false;
  #stateLife: Lifetime | null = null;
  #unwatch: (() => void) | null;
  #paper: Adapter | null = null;

  constructor(port: SheetCardPort, host: HTMLElement, mode: CardMode, context: CardContext) {
    this.#port = port;
    this.#context = context;
    this.#mode = mode;
    this.#root = document.createElement("div");
    this.#root.className = "canvas-card-sheet";
    this.#root.dataset.cardKind = "sheet";
    this.#root.style.position = "relative";
    this.#root.style.overflow = "hidden";
    this.#root.style.width = "100%";
    this.#root.style.height = "100%";
    host.append(this.#root);
    this.#unwatch = port.watch(context.path, () => this.#changed());
    const life = context.lifetime;
    life.listen(this.#root, "wheel", (event) => this.#wheel(event), { passive: false });
    life.listen(this.#root, "pointerdown", (event) => this.#pointerDown(event));
    life.listen(this.#root, "pointermove", (event) => this.#pointerMove(event));
    life.listen(this.#root.ownerDocument, "pointerup", () => {
      this.#dragging = false;
    });
    life.add(() => this.destroy());
    this.#setState("placeholder", [this.#placeholder()]);
    if (mode === "live") void this.#start();
    else this.#root.inert = true;
  }

  setMode(mode: CardMode): void {
    if (this.#destroyed || mode === this.#mode) return;
    this.#mode = mode;
    if (mode === "live") {
      this.#root.inert = false;
      void this.#start();
      return;
    }
    this.#freeze();
  }

  resize(): void {
    if (this.#destroyed) return;
    if (this.#mode === "live" && this.#open) void this.#load();
  }

  enter(): boolean {
    if (this.#destroyed || this.#mode !== "live" || this.#state !== "content" || !this.#open) return false;
    this.#entered = true;
    this.#root.dataset.cardEntered = "true";
    return true;
  }

  leave(): void {
    this.#entered = false;
    this.#dragging = false;
    delete this.#root.dataset.cardEntered;
    if (this.#selection) {
      this.#selection = null;
      this.#paint();
    }
  }

  key(event: KeyboardEvent): boolean {
    if (!this.#entered || this.#destroyed || this.#mode !== "live") return false;
    const copy = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c";
    if (!copy || !this.#selection) return false;
    // Gli appunti della webview si scrivono solo dentro il gesto: la copia
    // non aspetta l'host, quindi porta solo celle lette. Una selezione con
    // celle non lette non c'è (`#pointerMove`, `#keep`); se ci fosse, non si
    // copia niente piuttosto che celle vuote al posto di quelle vere.
    const text = this.#selectionTsv();
    if (text !== null) void writeClipboardText(text).catch(() => {});
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#entered = false;
    this.#generation += 1;
    this.#closeSession();
    this.#stateLife?.close();
    this.#stateLife = null;
    const unwatch = this.#unwatch;
    this.#unwatch = null;
    unwatch?.();
    this.#root.remove();
  }

  // ── Apertura e chiusura ────────────────────────────────────────────────

  async #start(): Promise<void> {
    this.#closeSession();
    const generation = ++this.#generation;
    if (this.#grid === null) this.#setState("loading", [this.#message(t("canvas.card.loading"), "canvas-card-loading")]);
    const current = () => !this.#destroyed && generation === this.#generation && this.#mode === "live";
    let opened: OpenSession;
    try {
      const found = await this.#openSession(current);
      if (found === null) return;
      opened = found;
    } catch (error) {
      if (!current()) return;
      if (error instanceof SheetMissing || isErrorKind(error, "not_found")) {
        this.#showMissing();
      } else {
        this.#showUnavailable();
      }
      return;
    }
    this.#open = opened;
    this.#paper = (() => {
      const paper = this.#port.paper();
      return paper ? adapter(paper) : null;
    })();
    const session = opened.session;
    const hidden = new Set(session.hidden);
    const visible = session.sheets.filter((sheet) => !hidden.has(sheet.id));
    const sheet = visible.find((candidate) => candidate.id === session.active) ?? visible[0]!;
    if (sheet.id !== this.#sheet) {
      this.#top = 0;
      this.#left = 0;
      this.#selection = null;
    }
    this.#sheet = sheet.id;
    this.#top = Math.min(this.#top, Math.max(0, sheet.row_count - 1));
    this.#left = Math.min(this.#left, Math.max(0, sheet.column_count - 1));
    // Le finestre di prima sono di un'altra sessione: la selezione, che ne
    // copierebbe le celle, si toglie con loro.
    this.#windows = [];
    this.#selection = null;
    await this.#load();
  }

  /// Apre la sessione: la porta, la superficie, `openGridBytes`. Una base
  /// vecchia (`conflict`, lo `Stale` dell'host) si riprova una volta con il
  /// giornale e la base di adesso. `null` se nel frattempo non serve più.
  async #openSession(current: () => boolean): Promise<OpenSession | null> {
    const host = this.#port.host;
    const path = this.#context.path;
    for (let attempt = 0; ; attempt++) {
      const source = await this.#port.source(path);
      if (!current()) return null;
      if (source === null) throw new SheetMissing();
      const surface = (await host.listGridSurfaces()).find((candidate) =>
        candidate.family === GRID_FAMILY
        && candidate.protocol_version === GRID_BYTES_PROTOCOL_VERSION
        && candidate.format === source.format);
      if (!current()) return null;
      if (!surface) throw new Error("no grid surface for the sheet card");
      let session: GridBytesSession;
      try {
        session = await host.openGridBytes(surface.id, path, source.journal, source.base);
      } catch (error) {
        if (attempt === 0 && isErrorKind(error, "conflict") && current()) continue;
        throw error;
      }
      const opened: OpenSession = { surface: surface.id, instance: session.instance, session, closed: false };
      if (!current()) {
        this.#close(opened);
        return null;
      }
      try {
        validateBytesSession(session);
      } catch (error) {
        this.#close(opened);
        throw error;
      }
      return opened;
    }
  }

  #close(opened: OpenSession): void {
    if (opened.closed) return;
    opened.closed = true;
    try {
      void this.#port.host.closeGridBytes(opened.surface, opened.instance).catch(() => {});
    } catch {
      // Una chiusura che lancia subito non cambia niente: la sessione è
      // segnata chiusa e non si richiude.
    }
  }

  #closeSession(): void {
    const opened = this.#open;
    this.#open = null;
    if (opened) this.#close(opened);
  }

  #freeze(): void {
    this.#generation += 1;
    this.#closeSession();
    this.#entered = false;
    this.#dragging = false;
    delete this.#root.dataset.cardEntered;
    this.#root.inert = true;
    if (this.#selection) {
      this.#selection = null;
      if (this.#grid) this.#paint();
    }
    // Una scheda che non ha ancora celle torna al segnaposto.
    if (this.#state === "loading") this.#setState("placeholder", [this.#placeholder()]);
    else if (this.#state === "content") this.#stateLife?.close();
  }

  #changed(): void {
    if (this.#destroyed) return;
    if (this.#mode === "live") {
      void this.#start();
      return;
    }
    // Da ferma si segna soltanto: l'accensione dopo riapre dal file.
    this.#root.dataset.cardStale = "true";
  }

  // ── Le finestre ─────────────────────────────────────────────────────────

  /// Legge le finestre che servono alla vista e la ridisegna. Una lettura
  /// alla volta: chi arriva mentre una è in volo ne chiede un'altra dopo.
  #load(): Promise<void> {
    if (this.#loading) {
      this.#loadQueued = true;
      return this.#loading;
    }
    const load = this.#readWindows().finally(() => {
      this.#loading = null;
      if (this.#loadQueued) {
        this.#loadQueued = false;
        void this.#load();
      }
    });
    this.#loading = load;
    return load;
  }

  async #readWindows(): Promise<void> {
    const opened = this.#open;
    const sheetId = this.#sheet;
    if (!opened || opened.closed || sheetId === null) return;
    const generation = this.#generation;
    const current = () => !this.#destroyed && generation === this.#generation && this.#open === opened;
    const sheet = opened.session.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) return;
    try {
      for (let pass = 0; pass < MAX_WINDOW_PASSES; pass++) {
        this.#layout();
        const range = this.#visibleRange();
        if (range === null || this.#covered(range)) break;
        const request: GridWindowRequest = {
          revision: opened.session.revision,
          sheet: sheet.id,
          row_start: range.rowStart,
          row_count: Math.min(MAX_WINDOW_ROWS, range.rowEnd - range.rowStart + 1),
          column_start: range.columnStart,
          column_count: Math.min(MAX_WINDOW_COLUMNS, range.columnEnd - range.columnStart + 1),
          known_media: [],
        };
        const window = await this.#port.host.gridBytesWindow(opened.surface, opened.instance, request);
        if (!current()) return;
        validateBytesWindow(window, opened.session);
        this.#keep(window);
      }
    } catch {
      if (!current()) return;
      this.#closeSession();
      this.#showUnavailable();
      return;
    }
    if (!current()) return;
    delete this.#root.dataset.cardStale;
    this.#layout();
    this.#paint();
  }

  /// Tiene la finestra nuova. Si lasciano prima le più vecchie che la
  /// selezione non tocca (mentre si trascina, nessuna); oltre `MAX_PINNED_WINDOWS` anche le sue, e allora
  /// una selezione con celle non più lette si toglie.
  #keep(window: GridBytesWindow): void {
    const kept = [...this.#windows.filter((each) => each.revision === window.revision && each.sheet === window.sheet), window];
    const selected = this.#selectionRange(this.#cells().merges);
    // Mentre si trascina, la selezione può arrivare su ogni finestra letta
    // dall'ancora in qua: si tengono tutte, fino al limite.
    const touches = (each: GridBytesWindow) => selected !== null && (this.#dragging
      || each.row_start <= selected.rowEnd && each.row_start + each.rows.length - 1 >= selected.rowStart
      && each.column_start <= selected.columnEnd && each.column_start + each.columns.length - 1 >= selected.columnStart);
    while (kept.length > MAX_KEPT_WINDOWS) {
      // La finestra appena letta resta sempre: è la vista.
      const free = kept.findIndex((each, at) => at < kept.length - 1 && !touches(each));
      if (free >= 0) kept.splice(free, 1);
      else if (kept.length > MAX_PINNED_WINDOWS) kept.shift();
      else break;
    }
    this.#windows = kept;
    if (this.#selection) {
      const range = this.#selectionRange(this.#cells().merges);
      if (!range || !this.#read(range)) this.#selection = null;
    }
  }

  /// Vera se ogni cella di `range` è in una finestra letta (anche in più
  /// finestre insieme), riga per riga.
  #read(range: GridRange): boolean {
    const own = this.#windows.filter((window) => window.sheet === this.#sheet);
    for (let row = range.rowStart; row <= range.rowEnd; row++) {
      const spans = own
        .filter((window) => window.row_start <= row && row < window.row_start + window.rows.length)
        .map((window) => [window.column_start, window.column_start + window.columns.length - 1] as const)
        .sort((a, b) => a[0] - b[0]);
      let reached = range.columnStart - 1;
      for (const [start, end] of spans) {
        if (start > reached + 1) break;
        reached = Math.max(reached, end);
      }
      if (reached < range.columnEnd) return false;
    }
    return true;
  }

  /// Vera se una finestra letta copre tutto `range`.
  #covered(range: GridRange): boolean {
    return this.#windows.some((window) =>
      window.sheet === this.#sheet
      && window.row_start <= range.rowStart
      && window.row_start + window.rows.length > range.rowEnd
      && window.column_start <= range.columnStart
      && window.column_start + window.columns.length > range.columnEnd);
  }

  #sheetSize(): { rows: number; columns: number } | null {
    const sheet = this.#open?.session.sheets.find((candidate) => candidate.id === this.#sheet);
    return sheet ? { rows: sheet.row_count, columns: sheet.column_count } : null;
  }

  /// Le righe e le colonne in vista, dalla prima in alto a sinistra fino a
  /// riempire la scheda, con le misure delle finestre lette o quelle di serie.
  #layout(): void {
    const size = this.#sheetSize();
    if (!size) {
      this.#rows = [];
      this.#columns = [];
      return;
    }
    const card = this.#context.size();
    const heights = new Map<number, { readonly size: number | null; readonly hidden: boolean }>();
    const widths = new Map<number, { readonly size: number | null; readonly hidden: boolean }>();
    for (const window of this.#windows) {
      if (window.sheet !== this.#sheet) continue;
      for (const row of window.rows) heights.set(row.index, { size: row.height, hidden: row.hidden });
      for (const column of window.columns) widths.set(column.index, { size: column.width, hidden: column.hidden });
    }
    this.#rows = axisSlots(this.#top, size.rows, card.height - SHEET_CARD_COLUMN_HEADER, SHEET_CARD_COLUMN_HEADER, heights, SHEET_CARD_ROW_HEIGHT, MAX_WINDOW_ROWS);
    this.#columns = axisSlots(this.#left, size.columns, card.width - SHEET_CARD_ROW_HEADER, SHEET_CARD_ROW_HEADER, widths, SHEET_CARD_COLUMN_WIDTH, MAX_WINDOW_COLUMNS);
  }

  /// Le righe e le colonne che la vista mostra, nascoste comprese; `null`
  /// per un foglio senza righe o senza colonne.
  #visibleRange(): GridRange | null {
    const size = this.#sheetSize();
    if (!size || size.rows === 0 || size.columns === 0) return null;
    const lastRow = this.#rows[this.#rows.length - 1]?.index ?? this.#top;
    const lastColumn = this.#columns[this.#columns.length - 1]?.index ?? this.#left;
    return {
      rowStart: this.#top,
      rowEnd: Math.min(size.rows - 1, Math.max(this.#top, lastRow)),
      columnStart: this.#left,
      columnEnd: Math.min(size.columns - 1, Math.max(this.#left, lastColumn)),
    };
  }

  // ── Il disegno ─────────────────────────────────────────────────────────

  #cells(): { readonly cells: Map<number, { readonly cell: GridBytesCell; readonly style: GridCellStyle | undefined }>; readonly merges: GridMerge[] } {
    const cells = new Map<number, { readonly cell: GridBytesCell; readonly style: GridCellStyle | undefined }>();
    const merges = new Map<string, GridMerge>();
    for (const window of this.#windows) {
      if (window.sheet !== this.#sheet) continue;
      const rows = new Map(window.rows.map((row) => [row.id, row.index] as const));
      const columns = new Map(window.columns.map((column) => [column.id, column.index] as const));
      for (const merge of window.merges) merges.set(`${merge.row}:${merge.column}`, merge);
      for (const cell of window.cells) {
        const row = rows.get(cell.key.row);
        const column = columns.get(cell.key.column);
        if (row === undefined || column === undefined) continue;
        cells.set(cellKey({ row, column }), { cell, style: window.styles[cell.style] });
      }
    }
    return { cells, merges: [...merges.values()] };
  }

  #gridlines(): boolean {
    const own = this.#windows.filter((window) => window.sheet === this.#sheet);
    return own[own.length - 1]?.view.gridlines ?? true;
  }

  #paint(): void {
    const grid = document.createElement("div");
    grid.className = this.#gridlines() ? "canvas-card-sheet-grid" : "canvas-card-sheet-grid no-gridlines";
    grid.setAttribute("role", "grid");
    grid.style.position = "absolute";
    grid.style.inset = "0";
    const font = getComputedStyle(this.#root).fontFamily ?? "";
    const { cells, merges } = this.#cells();
    const rows = this.#rows;
    const columns = this.#columns;
    const range = this.#selectionRange(merges);

    const corner = document.createElement("div");
    corner.className = "grid-corner";
    place(corner, 0, 0, SHEET_CARD_ROW_HEADER, SHEET_CARD_COLUMN_HEADER);
    grid.append(corner);
    for (const column of columns) {
      const header = this.#header("grid-header grid-column-header", columnLabel(column.index), font);
      header.dataset.column = String(column.index);
      if (range && column.index >= range.columnStart && column.index <= range.columnEnd) header.classList.add("selected");
      place(header, column.offset, 0, column.size, SHEET_CARD_COLUMN_HEADER);
      grid.append(header);
    }
    for (const row of rows) {
      const header = this.#header("grid-header grid-row-header", String(row.index + 1), font);
      header.dataset.row = String(row.index);
      if (range && row.index >= range.rowStart && row.index <= range.rowEnd) header.classList.add("selected");
      place(header, 0, row.offset, SHEET_CARD_ROW_HEADER, row.size);
      grid.append(header);
    }

    const rowAt = new Map(rows.map((slot, at) => [slot.index, at] as const));
    const columnAt = new Map(columns.map((slot, at) => [slot.index, at] as const));
    const firstRow = rows[0]?.index ?? 0;
    const firstColumn = columns[0]?.index ?? 0;
    for (const row of rows) {
      for (const column of columns) {
        const merge = mergeAt(merges, { row: row.index, column: column.index });
        let lastRow = row;
        let lastColumn = column;
        let source: GridPosition = { row: row.index, column: column.index };
        if (merge) {
          // Un'unione si disegna una volta, dalla sua prima cella in vista,
          // con il contenuto e l'aspetto della sua cella in alto a sinistra.
          const top = Math.max(merge.row, firstRow);
          const left = Math.max(merge.column, firstColumn);
          if (row.index !== top || column.index !== left) continue;
          source = { row: merge.row, column: merge.column };
          lastRow = lastSlot(rows, rowAt, merge.row + merge.rows - 1) ?? row;
          lastColumn = lastSlot(columns, columnAt, merge.column + merge.columns - 1) ?? column;
        }
        const width = lastColumn.offset + lastColumn.size - column.offset;
        const height = lastRow.offset + lastRow.size - row.offset;
        if (width <= 0 || height <= 0) continue;
        const known = cells.get(cellKey(source));
        const element = document.createElement("div");
        element.className = merge ? "grid-cell merged" : "grid-cell";
        element.dataset.row = String(row.index);
        element.dataset.column = String(column.index);
        element.setAttribute("role", "gridcell");
        const text = document.createElement("span");
        text.className = "grid-cell-text";
        text.textContent = known?.cell.display ?? "";
        paintCell(element, text, known?.style, known?.cell, font, this.#paper);
        element.append(text);
        place(element, column.offset, row.offset, width, height);
        grid.append(element);
        const borders = known?.style?.borders;
        if (hasBorders(borders)) {
          const border = document.createElement("div");
          border.className = "grid-border";
          border.setAttribute("aria-hidden", "true");
          paintBorders(border, borders);
          place(border, column.offset - 1, row.offset - 1, width + 1, height + 1);
          grid.append(border);
        }
      }
    }

    if (range) {
      const top = rows.find((slot) => slot.index >= range.rowStart && slot.index <= range.rowEnd);
      const bottom = [...rows].reverse().find((slot) => slot.index >= range.rowStart && slot.index <= range.rowEnd);
      const left = columns.find((slot) => slot.index >= range.columnStart && slot.index <= range.columnEnd);
      const right = [...columns].reverse().find((slot) => slot.index >= range.columnStart && slot.index <= range.columnEnd);
      if (top && bottom && left && right) {
        const outline = document.createElement("div");
        outline.className = "grid-selection";
        outline.setAttribute("aria-hidden", "true");
        place(outline, left.offset, top.offset, right.offset + right.size - left.offset, bottom.offset + bottom.size - top.offset);
        grid.append(outline);
      }
    }

    this.#grid = grid;
    markLook(this.#root, this.#paper ? "adattato" : "file");
    this.#setState("content", [grid]);
  }

  #header(className: string, label: string, font: string): HTMLElement {
    const header = document.createElement("div");
    header.className = className;
    header.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "grid-cell-text";
    text.textContent = label;
    paintCell(header, text, undefined, undefined, font, null);
    header.style.textAlign = "center";
    header.style.alignContent = "center";
    header.append(text);
    return header;
  }

  // ── Scorrimento, selezione e copia ─────────────────────────────────────

  #wheel(event: WheelEvent): void {
    // Fuori da una scheda attiva la rotella è della lavagna (A-11).
    if (!this.#entered || this.#mode !== "live" || !this.#open) return;
    event.preventDefault();
    event.stopPropagation();
    const size = this.#sheetSize();
    if (!size) return;
    const steps = (delta: number, unit: number) =>
      delta === 0 ? 0 : Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / unit));
    const unit = event.deltaMode === 0 /* DOM_DELTA_PIXEL */ ? SHEET_CARD_ROW_HEIGHT : 1;
    const vertical = event.shiftKey ? 0 : event.deltaY;
    const horizontal = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    const top = clamp(this.#top + steps(vertical, unit), 0, Math.max(0, size.rows - 1));
    const left = clamp(this.#left + steps(horizontal, unit === 1 ? 1 : SHEET_CARD_COLUMN_WIDTH), 0, Math.max(0, size.columns - 1));
    if (top === this.#top && left === this.#left) return;
    this.#top = top;
    this.#left = left;
    void this.#load();
  }

  #cellOf(event: Event): GridPosition | null {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-cell[data-row][data-column]") : null;
    if (!target || !this.#root.contains(target)) return null;
    return { row: Number(target.dataset.row), column: Number(target.dataset.column) };
  }

  #pointerDown(event: PointerEvent): void {
    if (!this.#entered || this.#mode !== "live" || event.button !== 0) return;
    const cell = this.#cellOf(event);
    if (!cell) return;
    event.stopPropagation();
    event.preventDefault();
    const next: Selection = { anchor: cell, focus: cell };
    // Un'unione che comincia fuori dalle celle lette non si sceglie.
    const range = this.#selectionRange(this.#cells().merges, next);
    if (!range || !this.#read(range)) return;
    this.#dragging = true;
    this.#selection = next;
    this.#paint();
  }

  #pointerMove(event: PointerEvent): void {
    if (!this.#dragging || !this.#entered || !this.#selection) return;
    if ((event.buttons & 1) === 0) {
      this.#dragging = false;
      return;
    }
    const cell = this.#cellOf(event);
    if (!cell) return;
    event.stopPropagation();
    const focus = this.#selection.focus;
    if (focus.row === cell.row && focus.column === cell.column) return;
    const next: Selection = { anchor: this.#selection.anchor, focus: cell };
    // La selezione non va oltre le celle lette: ciò che si copia è sempre
    // ciò che il file ha, mai una cella vuota al posto di una non letta.
    const range = this.#selectionRange(this.#cells().merges, next);
    if (!range || !this.#read(range)) return;
    this.#selection = next;
    this.#paint();
  }

  /// La selezione come rettangolo, allargato alle unioni che tocca.
  #selectionRange(merges: readonly GridMerge[], selection: Selection | null = this.#selection): GridRange | null {
    if (!selection) return null;
    return expandToMerges({
      rowStart: Math.min(selection.anchor.row, selection.focus.row),
      rowEnd: Math.max(selection.anchor.row, selection.focus.row),
      columnStart: Math.min(selection.anchor.column, selection.focus.column),
      columnEnd: Math.max(selection.anchor.column, selection.focus.column),
    }, merges);
  }

  /// Il testo delle celle scelte, come lo mostra il foglio, a tabulazioni.
  /// Una cella coperta da un'unione è vuota, come in Excel.
  #selectionTsv(): string | null {
    const { cells, merges } = this.#cells();
    const range = this.#selectionRange(merges);
    if (!range || !this.#read(range)) return null;
    const rows: string[][] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row++) {
      const line: string[] = [];
      for (let column = range.columnStart; column <= range.columnEnd; column++) {
        const merge = mergeAt(merges, { row, column });
        const covered = merge !== undefined && (merge.row !== row || merge.column !== column);
        line.push(covered ? "" : cells.get(cellKey({ row, column }))?.cell.display ?? "");
      }
      rows.push(line);
    }
    return tsvRows(rows);
  }

  // ── Gli stati ──────────────────────────────────────────────────────────

  #setState(state: SheetCardState, children: readonly Node[], life: Lifetime | null = null): void {
    this.#stateLife?.close();
    this.#stateLife = life;
    this.#state = state;
    this.#root.dataset.cardState = state;
    this.#root.replaceChildren(...children);
  }

  #showMissing(): void {
    this.#grid = null;
    this.#windows = [];
    this.#setState("missing", [this.#placeholder()]);
    this.#context.missing();
  }

  /// Senza superficie o con un errore: il perché e «Apri».
  #showUnavailable(): void {
    this.#grid = null;
    this.#windows = [];
    this.#entered = false;
    delete this.#root.dataset.cardEntered;
    const children: Node[] = [this.#placeholder(), this.#message(t("canvas.card.sheet_unavailable"), "canvas-card-message")];
    const open = this.#port.open;
    let life: Lifetime | null = null;
    if (open !== undefined) {
      life = openLifetime();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "canvas-file-link internal-path";
      button.textContent = t("canvas.card.open");
      const path = this.#context.path;
      const subpath = this.#context.subpath;
      life.listen(button, "click", (event) => {
        event.stopPropagation();
        open.call(this.#port, path, subpath);
      });
      children.push(button);
    }
    this.#setState("unavailable", children, life);
  }

  #placeholder(): HTMLElement {
    const kind = formatKindOf(this.#context.path) ?? "sheet";
    return this.#message(`${formatNameOf(kind)} · ${this.#context.path}`, "canvas-media-placeholder");
  }

  #message(text: string, className: string): HTMLElement {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }
}

/// Le righe (o colonne) da `first` che riempiono `extent`, dopo `start`
/// (l'intestazione). Una nascosta non c'è; una senza misura ha quella di serie.
function axisSlots(
  first: number,
  count: number,
  extent: number,
  start: number,
  known: ReadonlyMap<number, { readonly size: number | null; readonly hidden: boolean }>,
  fallback: number,
  most: number,
): AxisSlot[] {
  const slots: AxisSlot[] = [];
  let offset = start;
  const end = start + Math.max(0, extent);
  for (let index = first; index < count && offset < end; index++) {
    const metric = known.get(index);
    if (metric?.hidden) continue;
    const size = metric?.size !== null && metric?.size !== undefined && Number.isFinite(metric.size) && metric.size > 0
      ? metric.size * WORKBOOK_SCALE
      : fallback;
    slots.push({ index, offset, size });
    offset += size;
    // Mai più righe (o colonne) di quante una finestra ne porti.
    if (slots.length >= most) break;
  }
  return slots;
}

/// L'ultima riga (o colonna) in vista fino a `index` compreso.
function lastSlot(slots: readonly AxisSlot[], at: ReadonlyMap<number, number>, index: number): AxisSlot | undefined {
  const exact = at.get(index);
  if (exact !== undefined) return slots[exact];
  let found: AxisSlot | undefined;
  for (const slot of slots) if (slot.index <= index) found = slot;
  return found;
}

function place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
