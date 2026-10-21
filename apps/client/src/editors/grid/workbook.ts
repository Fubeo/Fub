// La proiezione di una cartella di Excel, come la legge la griglia.
//
// L'host non apre il protocollo dei fogli per una cartella: `read_document` dà
// la sua proiezione (`crates/fub-format-xlsx/src/projection.rs`), JSON chiuso
// con i valori già nel formato numerico di ogni cella. Qui diventa il
// `GridWorkbook` che il motore disegna, in sola lettura: l'`input` di una
// cella è il testo che mostra, così copiare e leggere la selezione danno i
// valori, e la formula sta a parte, per la barra.
//
// La forma si controlla stretta come quella del foglio di Fub (`model.ts`):
// un campo che qui non si conosce rende la proiezione illeggibile, e lo dice.
// Le liste chiuse sotto le confronta con quelle del codec
// `crates/fub-format-xlsx/tests/ts_projection.rs`.
import {
  columnLabel,
  type GridCell,
  type GridCellStyle,
  type GridColumn,
  type GridPosition,
  type GridRow,
  type GridSheet,
  type GridWorkbook,
} from "./model";

/// I tipi di avviso, nell'ordine del codec.
export const WORKBOOK_NOTICES = ["macros", "external_links", "incomplete", "not_shown", "recalculated", "truncated"] as const;
/// Le parti di una cartella che la griglia non disegna, nell'ordine del codec.
export const WORKBOOK_NOT_SHOWN = ["merges", "charts", "images", "shapes", "comments", "conditional_formats", "sparklines"] as const;

export type WorkbookNoticeKind = (typeof WORKBOOK_NOTICES)[number];
export type WorkbookNotShown = (typeof WORKBOOK_NOT_SHOWN)[number];

export interface WorkbookNotice {
  readonly kind: WorkbookNoticeKind;
  readonly detail?: string;
}

/// Una cella della cartella: quella che il motore disegna, con ciò che la
/// griglia del foglio di Fub non ha.
export interface WorkbookCell {
  readonly cell: GridCell;
  /// Il testo della barra, `=…` o `{=…}`.
  readonly formula?: string;
  /// Il valore non è del file: l'ha calcolato Fub.
  readonly derived: boolean;
}

export interface WorkbookSheet {
  readonly cells: ReadonlyMap<number, WorkbookCell>;
}

export interface WorkbookView {
  /// I fogli visibili, nell'ordine del file.
  readonly workbook: GridWorkbook;
  /// Le celle di ogni foglio di `workbook`, per posizione ([`cellKey`]).
  readonly sheets: readonly WorkbookSheet[];
  /// L'indice in `workbook.sheets` del foglio attivo nel file, o del primo
  /// visibile se quello è nascosto.
  readonly active: number;
  readonly notices: readonly WorkbookNotice[];
}

const VERSION = 1;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
/// Le misure di Excel sono per il suo carattere a 11 punti; la griglia usa
/// quello dell'interfaccia, più grande. La riga di serie di Excel (20 px)
/// diventa così quella del foglio di Fub (28 px), e il resto in proporzione.
export const WORKBOOK_SCALE = 1.4;
const COLOR = /^#[0-9A-Fa-f]{6}$/u;

/// La chiave di una posizione nelle mappe di [`WorkbookSheet`].
export function cellKey(position: GridPosition): number {
  return position.row * MAX_COLUMNS + position.column;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} non è un oggetto`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}: campo sconosciuto ${key}`);
  }
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} non è una lista`);
  return value;
}

function index(value: unknown, below: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= below) {
    throw new TypeError(`${label} fuori dal foglio`);
  }
  return value as number;
}

function count(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${label} non valido`);
  }
  return value as number;
}

function size(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${label} non valida`);
  return value;
}

function flag(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new TypeError(`${label} non è booleano`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} non è una stringa`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

function color(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = string(value, label);
  if (!COLOR.test(parsed)) throw new TypeError(`${label} non è un colore`);
  return parsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(`${label} sconosciuto: ${String(value)}`);
  return value as T;
}

function parseNotice(value: unknown, at: number): WorkbookNotice {
  const notice = record(value, `avviso ${at + 1}`);
  exactKeys(notice, ["kind", "detail"], `avviso ${at + 1}`);
  const kind = oneOf(notice.kind, WORKBOOK_NOTICES, "tipo di avviso");
  const detail = optionalString(notice.detail, `dettaglio dell'avviso ${at + 1}`);
  if (kind === "not_shown") oneOf(detail, WORKBOOK_NOT_SHOWN, "parte non mostrata");
  return detail === undefined ? { kind } : { kind, detail };
}

/// Le linee di un asse: tutte, con la dimensione del foglio dove il file non
/// ne dà una sua.
function parseLines(value: unknown, total: number, fallback: number, label: string): { size: number; hidden: boolean }[] {
  const lines = Array.from({ length: total }, () => ({ size: fallback, hidden: false }));
  const seen = new Set<number>();
  for (const [at, entry] of array(value, label).entries()) {
    const line = record(entry, `${label} ${at + 1}`);
    exactKeys(line, ["index", "size", "hidden"], `${label} ${at + 1}`);
    const position = index(line.index, total, `${label} ${at + 1}`);
    if (seen.has(position)) throw new TypeError(`${label} ${position} ripetuta`);
    seen.add(position);
    lines[position] = {
      size: line.size === undefined ? fallback : size(line.size, `dimensione ${label} ${at + 1}`),
      hidden: flag(line.hidden, `visibilità ${label} ${at + 1}`),
    };
  }
  return lines;
}

function parseStyle(value: unknown, label: string): GridCellStyle | undefined {
  if (value === undefined) return undefined;
  const style = record(value, label);
  exactKeys(style, ["bold", "italic", "text_color", "fill_color", "horizontal"], label);
  const textColor = color(style.text_color, `colore del testo di ${label}`);
  const fillColor = color(style.fill_color, `riempimento di ${label}`);
  const horizontal = style.horizontal === undefined
    ? undefined
    : oneOf(style.horizontal, ["start", "center", "end"] as const, `allineamento di ${label}`);
  return {
    ...(flag(style.bold, `grassetto di ${label}`) ? { bold: true } : {}),
    ...(flag(style.italic, `corsivo di ${label}`) ? { italic: true } : {}),
    ...(textColor === undefined ? {} : { text_color: textColor }),
    ...(fillColor === undefined ? {} : { fill_color: fillColor }),
    ...(horizontal === undefined ? {} : { horizontal }),
  };
}

function parseValue(value: unknown, label: string): string {
  if (value === undefined) return "";
  const parsed = record(value, label);
  exactKeys(parsed, ["kind", "text"], label);
  oneOf(parsed.kind, ["number", "text", "boolean", "error"] as const, `tipo di ${label}`);
  return string(parsed.text, `testo di ${label}`);
}

interface ParsedSheet {
  readonly name: string;
  readonly hidden: boolean;
  readonly sheet: GridSheet;
  readonly cells: Map<number, WorkbookCell>;
}

function parseSheet(value: unknown, at: number): ParsedSheet {
  const label = `foglio ${at + 1}`;
  const raw = record(value, label);
  exactKeys(raw, ["name", "hidden", "row_count", "column_count", "row_height", "column_width", "rows", "columns", "cells"], label);
  const name = string(raw.name, `nome del ${label}`);
  if (!name.trim()) throw new TypeError(`nome del ${label} vuoto`);
  const rowCount = count(raw.row_count, MAX_ROWS, `righe del ${label}`);
  const columnCount = count(raw.column_count, MAX_COLUMNS, `colonne del ${label}`);
  const rowHeight = size(raw.row_height, `altezza di riga del ${label}`);
  const columnWidth = size(raw.column_width, `larghezza di colonna del ${label}`);
  const rows: GridRow[] = parseLines(raw.rows, rowCount, rowHeight, "riga").map((line, row) => ({
    id: String(row + 1),
    height: line.size * WORKBOOK_SCALE,
    hidden: line.hidden,
  }));
  const columns: GridColumn[] = parseLines(raw.columns, columnCount, columnWidth, "colonna").map((line, column) => ({
    id: columnLabel(column),
    width: line.size * WORKBOOK_SCALE,
    hidden: line.hidden,
  }));
  const cells = new Map<number, WorkbookCell>();
  const list: GridCell[] = [];
  for (const [position, entry] of array(raw.cells, `celle del ${label}`).entries()) {
    const cellLabel = `cella ${position + 1} del ${label}`;
    const cell = record(entry, cellLabel);
    exactKeys(cell, ["row", "col", "formula", "value", "style", "derived"], cellLabel);
    const row = index(cell.row, rowCount, cellLabel);
    const column = index(cell.col, columnCount, cellLabel);
    const key = cellKey({ row, column });
    if (cells.has(key)) throw new TypeError(`${cellLabel} ripetuta`);
    const formula = optionalString(cell.formula, `formula della ${cellLabel}`);
    const input = parseValue(cell.value, `valore della ${cellLabel}`);
    const style = parseStyle(cell.style, `stile della ${cellLabel}`);
    const grid: GridCell = {
      row: rows[row].id,
      column: columns[column].id,
      ...(input ? { input } : {}),
      ...(style && Object.keys(style).length ? { style } : {}),
    };
    list.push(grid);
    cells.set(key, {
      cell: grid,
      ...(formula === undefined ? {} : { formula }),
      derived: flag(cell.derived, `origine della ${cellLabel}`),
    });
  }
  return {
    name,
    hidden: flag(raw.hidden, `visibilità del ${label}`),
    sheet: { id: String(at), name, rows, columns, ...(list.length ? { cells: list } : {}) },
    cells,
  };
}

/// Legge la proiezione di una cartella. Lancia se la forma non è quella del
/// codec, come `parseWorkbook` per il foglio di Fub.
export function parseWorkbookProjection(source: string): WorkbookView {
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    throw new RangeError("proiezione oltre il limite di 16 MiB");
  }
  const root = record(JSON.parse(source), "proiezione");
  exactKeys(root, ["version", "active", "notices", "sheets"], "proiezione");
  if (root.version !== VERSION) throw new RangeError(`versione della proiezione non supportata: ${String(root.version)}`);
  const parsed = array(root.sheets, "fogli").map(parseSheet);
  const active = parsed.length ? index(root.active, parsed.length, "foglio attivo") : 0;
  const names = new Set(parsed.map((sheet) => sheet.name));
  if (names.size !== parsed.length) throw new TypeError("nomi dei fogli ripetuti");
  const visible = parsed.filter((sheet) => !sheet.hidden);
  const shown = visible.indexOf(parsed[active]);
  return {
    workbook: { version: 1, sheets: visible.map((sheet) => sheet.sheet) },
    sheets: visible.map((sheet) => ({ cells: sheet.cells })),
    active: Math.max(0, shown),
    notices: array(root.notices, "avvisi").map(parseNotice),
  };
}
