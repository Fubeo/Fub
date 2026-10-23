// Una cartella di Excel nella griglia, sulla versione 2 del protocollo
// (ADR 0216, `fub_abi::grid_bytes`).
//
// L'host apre la superficie sui byte del documento e la shell non li vede:
// riceve una sessione (i fogli, quello attivo, quelli nascosti, gli avvisi) e
// le finestre che mostra. Qui le finestre diventano il `GridWorkbook` che il
// motore disegna. L'`input` di una cella del modello è il testo che mostra,
// già formattato dal provider, così copiare e leggere la selezione danno i
// valori; ciò che si scrive sta a parte, nella cella della cartella, con il
// blocco, il valore non ricalcolato e il conflitto.
//
// Le forme si controllano strette come quelle della versione 1 (`engine.ts`):
// una risposta fuori dai limiti o incoerente con la sessione non si disegna.
import type {
  GridBytesCell,
  GridBytesSession,
  GridBytesWindow,
  GridCellStyle as GridBytesStyle,
  GridHorizontalAlign,
  GridMerge,
  GridNotice,
  GridSheetView,
  GridTable,
} from "../../host/contract";
import { GRID_THEME_COLORS } from "../../host/contract";
import type { GridCell, GridCellStyle, GridColumn, GridPosition, GridRow, GridSheet, GridWorkbook } from "./model";

const MAX_SHEETS = 1_024;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_WINDOW_ROWS = 256;
const MAX_WINDOW_COLUMNS = 128;
const MAX_NOTICES = 64;
const MAX_BOOK_NAMES = 4_096;
const MAX_NAME_BYTES = 255;
const MAX_FONT_BYTES = 256;
const MAX_WINDOW_TABLES = 1_024;
const VIEW_MODES: ReadonlySet<string> = new Set(["normal", "page_layout", "page_break_preview"]);
const CALCULATIONS: ReadonlySet<string> = new Set(["automatic", "automatic_except_tables", "manual"]);
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/u;
/// Le misure di Excel sono per il suo carattere a 11 punti; la griglia usa
/// quello dell'interfaccia, più grande. La riga di serie di Excel (20 px)
/// diventa così quella del foglio di Fub (28 px), e il resto in proporzione.
export const WORKBOOK_SCALE = 1.4;

/// Una cella della cartella: quella che il motore disegna, con ciò che la
/// griglia del foglio di Fub non ha.
export interface WorkbookCell {
  readonly cell: GridCell;
  /// La cella come la dà il provider: l'input da scrivere, il blocco, il
  /// valore del file non ricalcolato, il conflitto.
  readonly bytes: GridBytesCell;
  /// L'aspetto intero della cella, come la finestra lo dà.
  readonly style: GridBytesStyle | undefined;
}

export interface WorkbookSheet {
  readonly cells: ReadonlyMap<number, WorkbookCell>;
  /// Le unioni che le finestre lette toccano, ognuna una volta.
  readonly merges: readonly GridMerge[];
  /// Le tabelle che le finestre lette toccano, ognuna una volta.
  readonly tables: readonly GridTable[];
  /// Come il foglio si guarda; quello di serie finché nessuna finestra è letta.
  readonly view: GridSheetView;
}

/// La vista di un foglio di cui non si è letta ancora nessuna finestra.
export const DEFAULT_SHEET_VIEW: GridSheetView = {
  frozen_rows: 0,
  frozen_columns: 0,
  gridlines: true,
  headings: true,
  zoom: 100,
  right_to_left: false,
  mode: "normal",
  formulas: false,
  protected: false,
  print_gridlines: false,
  print_headings: false,
};

export interface WorkbookView {
  /// I fogli visibili, nell'ordine della sessione.
  readonly workbook: GridWorkbook;
  /// Le celle lette di ogni foglio di `workbook`, per posizione ([`cellKey`]).
  readonly sheets: readonly WorkbookSheet[];
  /// L'indice in `workbook.sheets` del foglio attivo nel file, o del primo
  /// visibile se quello è nascosto.
  readonly active: number;
  readonly notices: readonly GridNotice[];
}

/// La chiave di una posizione nelle mappe di [`WorkbookSheet`].
export function cellKey(position: GridPosition): number {
  return position.row * MAX_COLUMNS + position.column;
}

/// La posizione di una chiave di [`cellKey`].
export function keyPosition(key: number): GridPosition {
  return { row: Math.floor(key / MAX_COLUMNS), column: key % MAX_COLUMNS };
}

function count(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/// Un nome della cartella: non vuoto e nei byte di `MAX_NAME_BYTES`.
function bookName(value: unknown): value is string {
  return id(value) && new TextEncoder().encode(value).length <= MAX_NAME_BYTES;
}

/// Controlla una sessione della versione 2; lancia se non si può disegnare.
export function validateBytesSession(session: GridBytesSession): void {
  if (
    !session
    || !id(session.instance)
    || !id(session.revision)
    || !Array.isArray(session.sheets)
    || session.sheets.length === 0
    || session.sheets.length > MAX_SHEETS
    || !Array.isArray(session.hidden)
    || !Array.isArray(session.notices)
    || session.notices.length > MAX_NOTICES
    || !Array.isArray(session.conflicts)
    || !Array.isArray(session.commands)
    || session.commands.some((command) =>
      !id(command?.id)
      || typeof command.enabled !== "boolean"
      || (command.reason !== null && typeof command.reason !== "string"))
  ) {
    throw new Error("malformed grid bytes session");
  }
  validateBook(session.book);
  const sheets = new Set<string>();
  for (const sheet of session.sheets) {
    if (
      !id(sheet.id)
      || typeof sheet.name !== "string"
      || sheets.has(sheet.id)
      || !count(sheet.row_count, MAX_ROWS)
      || !count(sheet.column_count, MAX_COLUMNS)
    ) {
      throw new Error("malformed grid bytes sheets");
    }
    sheets.add(sheet.id);
  }
  if (!sheets.has(session.active) || session.hidden.some((hidden) => !sheets.has(hidden))) {
    throw new Error("grid bytes session names a sheet it does not have");
  }
  if (new Set(session.hidden).size >= session.sheets.length) throw new Error("grid bytes session hides every sheet");
  for (const notice of session.notices) {
    if (!id(notice.code) || !count(notice.count, 0xffff_ffff)) throw new Error("malformed grid notice");
  }
}

/// Controlla ciò che vale per tutta la cartella (`GridBook`).
export function validateBook(book: GridBytesSession["book"]): void {
  if (
    !book
    || !Array.isArray(book.theme_colors)
    || book.theme_colors.length !== GRID_THEME_COLORS
    || book.theme_colors.some((color) => typeof color !== "string" || !HEX_COLOR.test(color))
    || !Array.isArray(book.names)
    || book.names.length > MAX_BOOK_NAMES
    || !book.names.every(bookName)
    || !CALCULATIONS.has(book.calculation)
    || typeof book.protected !== "boolean"
    || typeof book.font !== "string"
    || book.font === ""
    || new TextEncoder().encode(book.font).length > MAX_FONT_BYTES
    || typeof book.font_size !== "number"
    || !Number.isFinite(book.font_size)
    || book.font_size <= 0
    || book.font_size > 409
  ) {
    throw new Error("malformed grid book");
  }
}

/// Controlla una finestra della sessione.
export function validateBytesWindow(window: GridBytesWindow, session: GridBytesSession): void {
  const sheet = session.sheets.find((candidate) => candidate.id === window.sheet);
  if (
    !sheet
    || window.revision !== session.revision
    || !count(window.row_start, MAX_ROWS)
    || !count(window.column_start, MAX_COLUMNS)
    || window.total_rows !== sheet.row_count
    || window.total_columns !== sheet.column_count
    || !Array.isArray(window.rows)
    || !Array.isArray(window.columns)
    || !Array.isArray(window.cells)
    || window.rows.length > MAX_WINDOW_ROWS
    || window.columns.length > MAX_WINDOW_COLUMNS
    || window.cells.length > MAX_WINDOW_ROWS * MAX_WINDOW_COLUMNS
    || window.row_start + window.rows.length > sheet.row_count
    || window.column_start + window.columns.length > sheet.column_count
    || window.rows.some((row, at) => row.index !== window.row_start + at || !id(row.id))
    || window.columns.some((column, at) => column.index !== window.column_start + at || !id(column.id))
  ) {
    throw new Error("malformed grid bytes window");
  }
  if (!Array.isArray(window.styles) || window.styles.length > Math.max(window.cells.length, 1) || !Array.isArray(window.merges)) {
    throw new Error("malformed grid bytes window");
  }
  for (const merge of window.merges) {
    if (
      !count(merge.row, MAX_ROWS)
      || !count(merge.column, MAX_COLUMNS)
      || !count(merge.rows, MAX_ROWS)
      || !count(merge.columns, MAX_COLUMNS)
      || merge.rows === 0
      || merge.columns === 0
      || merge.rows * merge.columns < 2
      || merge.row + merge.rows > sheet.row_count
      || merge.column + merge.columns > sheet.column_count
    ) {
      throw new Error("malformed grid bytes merge");
    }
  }
  if (!Array.isArray(window.tables) || window.tables.length > MAX_WINDOW_TABLES) throw new Error("malformed grid bytes window");
  for (const table of window.tables) {
    if (
      !bookName(table.name)
      || typeof table.style !== "string"
      || new TextEncoder().encode(table.style).length > MAX_NAME_BYTES
      || !count(table.row, MAX_ROWS)
      || !count(table.column, MAX_COLUMNS)
      || !count(table.rows, MAX_ROWS)
      || !count(table.columns, MAX_COLUMNS)
      || table.rows === 0
      || table.columns === 0
      || table.row + table.rows > sheet.row_count
      || table.column + table.columns > sheet.column_count
      || ![
        table.header_row,
        table.totals_row,
        table.banded_rows,
        table.banded_columns,
        table.first_column,
        table.last_column,
        table.filter_button,
      ].every((flag) => typeof flag === "boolean")
    ) {
      throw new Error("malformed grid bytes table");
    }
  }
  const view = window.view;
  if (
    !view
    || !count(view.frozen_rows, sheet.row_count)
    || !count(view.frozen_columns, sheet.column_count)
    || typeof view.gridlines !== "boolean"
    || typeof view.headings !== "boolean"
    || typeof view.right_to_left !== "boolean"
    || !VIEW_MODES.has(view.mode)
    || typeof view.formulas !== "boolean"
    || typeof view.protected !== "boolean"
    || typeof view.print_gridlines !== "boolean"
    || typeof view.print_headings !== "boolean"
    || !Number.isInteger(view.zoom)
    || view.zoom < 10
    || view.zoom > 400
  ) {
    throw new Error("malformed grid bytes view");
  }
  const rows = new Set(window.rows.map((row) => row.id));
  const columns = new Set(window.columns.map((column) => column.id));
  for (const cell of window.cells) {
    if (
      cell.key.sheet !== window.sheet
      || !rows.has(cell.key.row)
      || !columns.has(cell.key.column)
      || typeof cell.input !== "string"
      || typeof cell.display !== "string"
      || !Number.isInteger(cell.style)
      || cell.style < 0
      || cell.style >= window.styles.length
    ) {
      throw new Error("grid bytes window has a cell outside it");
    }
  }
}

function size(value: number | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value * WORKBOOK_SCALE : undefined;
}

/// Gli allineamenti che la griglia non disegna ancora tornano al più vicino:
/// riempi e giustifica partono dall'inizio, distribuito sta al centro.
const HORIZONTAL: Record<GridHorizontalAlign, "start" | "center" | "end"> = {
  start: "start",
  center: "center",
  end: "end",
  fill: "start",
  justify: "start",
  distributed: "center",
};

function style(from: GridBytesStyle | undefined): GridCellStyle | undefined {
  if (!from) return undefined;
  const out: GridCellStyle = {
    ...(from.bold ? { bold: true } : {}),
    ...(from.italic ? { italic: true } : {}),
    ...(from.text_color === null ? {} : { text_color: from.text_color }),
    ...(from.fill_color === null ? {} : { fill_color: from.fill_color }),
    ...(from.horizontal === null ? {} : { horizontal: HORIZONTAL[from.horizontal] }),
  };
  return Object.keys(out).length ? out : undefined;
}

function earlierIndex(previous: WorkbookView, sheet: string): number {
  return previous.workbook.sheets.findIndex((candidate) => candidate.id === sheet);
}

/// La cartella da disegnare: i fogli visibili della sessione, con le righe,
/// le colonne e le celle delle finestre lette. Una riga che nessuna finestra
/// ha portato tiene la misura che aveva in `previous`, o quella di serie.
export function workbookView(
  session: GridBytesSession,
  windows: readonly GridBytesWindow[],
  previous: WorkbookView | null,
): WorkbookView {
  const hidden = new Set(session.hidden);
  const visible = session.sheets.filter((sheet) => !hidden.has(sheet.id));
  const earlier = new Map((previous?.workbook.sheets ?? []).map((sheet) => [sheet.id, sheet]));
  const sheets: GridSheet[] = [];
  const cells: WorkbookSheet[] = [];
  for (const sessionSheet of visible) {
    const prior = earlier.get(sessionSheet.id);
    const own = windows.filter((window) => window.sheet === sessionSheet.id);
    const loadedRows = new Map(own.flatMap((window) => window.rows.map((row) => [row.index, row] as const)));
    const loadedColumns = new Map(own.flatMap((window) => window.columns.map((column) => [column.index, column] as const)));
    const rows: GridRow[] = Array.from({ length: sessionSheet.row_count }, (_, index) => {
      const row = loadedRows.get(index);
      if (row) return { id: row.id, height: size(row.height), hidden: row.hidden };
      const kept = prior?.rows[index];
      return kept ? { ...kept } : { id: `__grid_row_${sessionSheet.id}_${index}`, hidden: false };
    });
    const columns: GridColumn[] = Array.from({ length: sessionSheet.column_count }, (_, index) => {
      const column = loadedColumns.get(index);
      if (column) return { id: column.id, width: size(column.width), hidden: column.hidden };
      const kept = prior?.columns[index];
      return kept ? { ...kept } : { id: `__grid_column_${sessionSheet.id}_${index}`, hidden: false };
    });
    const map = new Map<number, WorkbookCell>();
    const list: GridCell[] = [];
    const merges = new Map<string, GridMerge>();
    const tables = new Map<string, GridTable>();
    for (const window of own) {
      for (const merge of window.merges) merges.set(`${merge.row}:${merge.column}`, merge);
      for (const table of window.tables) tables.set(table.name, table);
      const rowIndex = new Map(window.rows.map((row) => [row.id, row.index] as const));
      const columnIndex = new Map(window.columns.map((column) => [column.id, column.index] as const));
      for (const cell of window.cells) {
        const position = { row: rowIndex.get(cell.key.row)!, column: columnIndex.get(cell.key.column)! };
        const full = window.styles[cell.style];
        const cellStyle = style(full);
        const grid: GridCell = {
          row: cell.key.row,
          column: cell.key.column,
          ...(cell.display ? { input: cell.display } : {}),
          ...(cellStyle ? { style: cellStyle } : {}),
        };
        list.push(grid);
        map.set(cellKey(position), { cell: grid, bytes: cell, style: full });
      }
    }
    sheets.push({
      id: sessionSheet.id,
      name: sessionSheet.name,
      rows,
      columns,
      ...(list.length ? { cells: list } : {}),
    });
    cells.push({
      cells: map,
      merges: [...merges.values()],
      tables: [...tables.values()],
      view: own[own.length - 1]?.view ?? previous?.sheets[earlierIndex(previous, sessionSheet.id)]?.view ?? DEFAULT_SHEET_VIEW,
    });
  }
  return {
    workbook: { version: 1, sheets },
    sheets: cells,
    active: Math.max(0, visible.findIndex((sheet) => sheet.id === session.active)),
    notices: session.notices,
  };
}

/// Il numero come lo scrive il file: `[+-]cifre[.cifre][e[+-]cifre]`, la
/// regola di `fub-format-xlsx/src/input.rs`.
const FILE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const LOCAL_NUMBER = /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/u;

/// Il separatore decimale di `language`.
export function decimalSeparator(language: string): "." | "," {
  const part = new Intl.NumberFormat(language).formatToParts(1.5).find((candidate) => candidate.type === "decimal");
  return part?.value === "," ? "," : ".";
}

/// L'input del file come lo si legge e lo si scrive nella lingua: un numero
/// prende la virgola dove la lingua la usa. Tutto il resto resta com'è.
export function localInput(input: string, decimal: "." | ","): string {
  return decimal === "," && FILE_NUMBER.test(input) ? input.replace(".", ",") : input;
}

/// Ciò che l'utente ha scritto, come lo vuole il file. Con la virgola
/// decimale un numero con la virgola diventa col punto; uno col punto non si
/// indovina (`1.500` è mille e cinquecento, in italiano) e resta il testo
/// scritto, con l'apostrofo che lo dice.
export function fileInput(draft: string, decimal: "." | ","): string {
  if (decimal !== ",") return draft;
  if (LOCAL_NUMBER.test(draft)) return draft.replace(",", ".");
  if (FILE_NUMBER.test(draft) && draft.includes(".")) return `'${draft}`;
  return draft;
}
