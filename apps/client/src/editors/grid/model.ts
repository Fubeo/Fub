export interface GridRow {
  id: string;
  height?: number;
  hidden: boolean;
}

export interface GridColumn {
  id: string;
  width?: number;
  hidden: boolean;
}

export interface GridCellStyle {
  bold?: boolean;
  italic?: boolean;
  text_color?: string;
  fill_color?: string;
  horizontal?: "start" | "center" | "end";
  number_format?: string;
}

export interface GridCell {
  row: string;
  column: string;
  input?: string;
  style?: GridCellStyle;
}

export interface GridSheet {
  id: string;
  name: string;
  rows: GridRow[];
  columns: GridColumn[];
  cells?: GridCell[];
  properties?: Record<string, unknown>;
}

export interface GridWorkbook {
  version: number;
  properties?: Record<string, unknown>;
  sheets: GridSheet[];
}

export interface GridCoordinate {
  readonly sheet: string;
  readonly row: string;
  readonly column: string;
}

export interface GridPosition {
  readonly row: number;
  readonly column: number;
}

export interface GridSelection {
  readonly anchor: GridPosition;
  readonly focus: GridPosition;
}

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} non è un oggetto`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}: campo sconosciuto ${key}`);
  }
}

function id(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (new TextEncoder().encode(parsed).length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(parsed)) {
    throw new TypeError(`${label} non è valido`);
  }
  return parsed;
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new TypeError(`${label} non è booleano`);
  return value;
}

function optionalDimension(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || value <= 0 || !Number.isFinite(value)) {
    throw new TypeError(`${label} non valida`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} non è una stringa`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} non è una lista`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} non è valido`);
  return value;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  return value === undefined ? undefined : record(value, label);
}

function parseRows(value: unknown): GridRow[] {
  return array(value, "rows").map((entry, index) => {
    const row = record(entry, `row ${index + 1}`);
    exactKeys(row, ["id", "height", "hidden"], `row ${index + 1}`);
    const height = optionalDimension(row.height, `altezza riga ${index + 1}`);
    return {
      id: id(row.id, `id riga ${index + 1}`),
      ...(height === undefined ? {} : { height }),
      hidden: optionalBoolean(row.hidden, `visibilità riga ${index + 1}`),
    };
  });
}

function parseColumns(value: unknown): GridColumn[] {
  return array(value, "columns").map((entry, index) => {
    const column = record(entry, `column ${index + 1}`);
    exactKeys(column, ["id", "width", "hidden"], `column ${index + 1}`);
    const width = optionalDimension(column.width, `larghezza colonna ${index + 1}`);
    return {
      id: id(column.id, `id colonna ${index + 1}`),
      ...(width === undefined ? {} : { width }),
      hidden: optionalBoolean(column.hidden, `visibilità colonna ${index + 1}`),
    };
  });
}

function parseStyle(value: unknown): GridCellStyle | undefined {
  if (value === undefined) return undefined;
  const style = record(value, "stile cella");
  exactKeys(style, ["bold", "italic", "text_color", "fill_color", "horizontal", "number_format"], "stile cella");
  const textColor = optionalString(style.text_color, "colore testo");
  const fillColor = optionalString(style.fill_color, "colore riempimento");
  const numberFormat = optionalString(style.number_format, "formato numero");
  if (style.horizontal !== undefined && style.horizontal !== null && style.horizontal !== "start" && style.horizontal !== "center" && style.horizontal !== "end") {
    throw new TypeError("allineamento cella non valido");
  }
  const bold = optionalBoolean(style.bold, "grassetto cella");
  const italic = optionalBoolean(style.italic, "corsivo cella");
  return {
    ...(bold ? { bold } : {}),
    ...(italic ? { italic } : {}),
    ...(textColor === undefined ? {} : { text_color: textColor }),
    ...(fillColor === undefined ? {} : { fill_color: fillColor }),
    ...(style.horizontal === undefined || style.horizontal === null ? {} : { horizontal: style.horizontal }),
    ...(numberFormat === undefined ? {} : { number_format: numberFormat }),
  };
}

function parseCells(value: unknown, rows: Set<string>, columns: Set<string>): GridCell[] {
  if (value === undefined) return [];
  const occupied = new Set<string>();
  return array(value, "cells").map((entry, index) => {
    const cell = record(entry, `cella ${index + 1}`);
    exactKeys(cell, ["row", "column", "input", "style"], `cella ${index + 1}`);
    const row = id(cell.row, `riga cella ${index + 1}`);
    const column = id(cell.column, `colonna cella ${index + 1}`);
    if (!rows.has(row) || !columns.has(column)) throw new TypeError(`coordinate cella ${index + 1} sconosciute`);
    const key = `${row}\u0000${column}`;
    if (occupied.has(key)) throw new TypeError(`cella duplicata ${row}/${column}`);
    occupied.add(key);
    if (cell.input !== undefined && typeof cell.input !== "string") {
      throw new TypeError(`input cella ${index + 1} non valido`);
    }
    const style = parseStyle(cell.style);
    return {
      row,
      column,
      ...(cell.input ? { input: cell.input } : {}),
      ...(style && Object.keys(style).length ? { style } : {}),
    };
  });
}

export function parseWorkbook(source: string): GridWorkbook {
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    throw new RangeError("workbook oltre il limite di 16 MiB");
  }
  const root = record(JSON.parse(source), "workbook");
  exactKeys(root, ["version", "properties", "sheets"], "workbook");
  if (root.version !== 1) throw new RangeError(`versione workbook non supportata: ${String(root.version)}`);
  const sheets = array(root.sheets, "sheets").map((entry, index): GridSheet => {
    const sheet = record(entry, `sheet ${index + 1}`);
    exactKeys(sheet, ["id", "name", "rows", "columns", "cells", "properties"], `sheet ${index + 1}`);
    const rows = parseRows(sheet.rows);
    const columns = parseColumns(sheet.columns);
    const rowIds = new Set(rows.map((row) => row.id));
    const columnIds = new Set(columns.map((column) => column.id));
    if (rowIds.size !== rows.length || columnIds.size !== columns.length) {
      throw new TypeError(`assi duplicati nello sheet ${index + 1}`);
    }
    const cells = parseCells(sheet.cells, rowIds, columnIds);
    return {
      id: id(sheet.id, `id sheet ${index + 1}`),
      name: text(sheet.name, `nome sheet ${index + 1}`),
      rows,
      columns,
      ...(cells.length ? { cells } : {}),
      ...(optionalRecord(sheet.properties, "proprietà sheet") ? { properties: sheet.properties as Record<string, unknown> } : {}),
    };
  });
  const sheetIds = new Set(sheets.map((sheet) => sheet.id));
  const sheetNames = new Set(sheets.map((sheet) => sheet.name));
  if (sheetIds.size !== sheets.length || sheetNames.size !== sheets.length || sheets.some((sheet) => !sheet.name.trim())) {
    throw new TypeError("id o nomi sheet duplicati/non validi");
  }
  return {
    version: 1,
    ...(optionalRecord(root.properties, "proprietà workbook") ? { properties: root.properties as Record<string, unknown> } : {}),
    sheets,
  };
}

export function serializeWorkbook(workbook: GridWorkbook): string {
  return `${JSON.stringify(workbook, null, 2)}\n`;
}

export function cellAt(sheet: GridSheet, position: GridPosition): GridCell | undefined {
  const row = sheet.rows[position.row]?.id;
  const column = sheet.columns[position.column]?.id;
  if (!row || !column) return undefined;
  return sheet.cells?.find((cell) => cell.row === row && cell.column === column);
}

export function coordinateAt(sheet: GridSheet, position: GridPosition): GridCoordinate | undefined {
  const row = sheet.rows[position.row]?.id;
  const column = sheet.columns[position.column]?.id;
  return row && column ? { sheet: sheet.id, row, column } : undefined;
}

export function positionOf(sheet: GridSheet, coordinate: GridCoordinate): GridPosition | undefined {
  if (coordinate.sheet !== sheet.id) return undefined;
  const row = sheet.rows.findIndex((candidate) => candidate.id === coordinate.row);
  const column = sheet.columns.findIndex((candidate) => candidate.id === coordinate.column);
  return row < 0 || column < 0 ? undefined : { row, column };
}

export function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function normalizedSelection(selection: GridSelection) {
  return {
    rowStart: Math.min(selection.anchor.row, selection.focus.row),
    rowEnd: Math.max(selection.anchor.row, selection.focus.row),
    columnStart: Math.min(selection.anchor.column, selection.focus.column),
    columnEnd: Math.max(selection.anchor.column, selection.focus.column),
  };
}
