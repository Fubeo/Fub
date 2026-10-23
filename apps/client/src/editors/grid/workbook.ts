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
  GridNotice,
} from "../../host/contract";
import type { GridCell, GridCellStyle, GridColumn, GridPosition, GridRow, GridSheet, GridWorkbook } from "./model";

const MAX_SHEETS = 1_024;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_WINDOW_ROWS = 256;
const MAX_WINDOW_COLUMNS = 128;
const MAX_NOTICES = 64;
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
}

export interface WorkbookSheet {
  readonly cells: ReadonlyMap<number, WorkbookCell>;
}

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
  ) {
    throw new Error("malformed grid bytes session");
  }
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
    for (const window of own) {
      const rowIndex = new Map(window.rows.map((row) => [row.id, row.index] as const));
      const columnIndex = new Map(window.columns.map((column) => [column.id, column.index] as const));
      for (const cell of window.cells) {
        const position = { row: rowIndex.get(cell.key.row)!, column: columnIndex.get(cell.key.column)! };
        const cellStyle = style(window.styles[cell.style]);
        const grid: GridCell = {
          row: cell.key.row,
          column: cell.key.column,
          ...(cell.display ? { input: cell.display } : {}),
          ...(cellStyle ? { style: cellStyle } : {}),
        };
        list.push(grid);
        map.set(cellKey(position), { cell: grid, bytes: cell });
      }
    }
    sheets.push({
      id: sessionSheet.id,
      name: sessionSheet.name,
      rows,
      columns,
      ...(list.length ? { cells: list } : {}),
    });
    cells.push({ cells: map });
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
