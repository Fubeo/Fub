import {
  DEFAULT_CELL_STYLE,
  type CellAlignment,
  type CellFormat,
  type GridCell,
  type GridCellStyle,
  type GridColumn,
  type GridRow,
  type GridSheet,
  type GridWorkbook,
} from "./model";

export const FUBSHEET_SCHEMA_VERSION = 1;
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SHEETS = 256;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_CELLS = 4_000_000;
const MAX_ID_BYTES = 256;
const MAX_SHEET_NAME_BYTES = 1_024;
const MAX_CELL_INPUT_BYTES = 1_048_576;
const MAX_DIMENSION = 1_000_000;
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const FORMATS = new Set<CellFormat>(["general", "text", "number", "percent", "currency", "date"]);
const ALIGNMENTS = new Set<CellAlignment>(["start", "center", "end"]);
const encoder = new TextEncoder();

export class GridCodecError extends Error {
  constructor(
    readonly kind:
      | "source_too_large"
      | "invalid_json"
      | "missing_schema"
      | "unsupported_schema"
      | "invalid_workbook"
      | "serialize",
    message: string,
    readonly actual?: number,
  ) {
    super(message);
    this.name = "GridCodecError";
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GridCodecError("invalid_workbook", `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown !== undefined) {
    throw new GridCodecError("invalid_workbook", `${path} contains unknown field ${unknown}`);
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new GridCodecError("invalid_workbook", `${path} must be a string`);
  }
  return value;
}

function id(value: unknown, path: string): string {
  const parsed = string(value, path);
  const bytes = encoder.encode(parsed).length;
  if (bytes === 0 || bytes > MAX_ID_BYTES || !ID_PATTERN.test(parsed)) {
    throw new GridCodecError("invalid_workbook", `${path} is not a valid stable id`);
  }
  return parsed;
}

function optionalDimension(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_DIMENSION) {
    throw new GridCodecError("invalid_workbook", `${path} is outside the dimension limit`);
  }
  return value as number;
}

function metadata(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === undefined) return {};
  return record(value, path);
}

function row(value: unknown, path: string): GridRow {
  const source = record(value, path);
  exactKeys(source, ["id", "height"], path);
  const height = optionalDimension(source.height, `${path}.height`);
  return { id: id(source.id, `${path}.id`), ...(height === undefined ? {} : { height }) };
}

function column(value: unknown, path: string): GridColumn {
  const source = record(value, path);
  exactKeys(source, ["id", "width"], path);
  const width = optionalDimension(source.width, `${path}.width`);
  return { id: id(source.id, `${path}.id`), ...(width === undefined ? {} : { width }) };
}

function style(value: unknown, path: string): GridCellStyle {
  if (value === undefined) return DEFAULT_CELL_STYLE;
  const source = record(value, path);
  exactKeys(source, ["format", "alignment", "bold", "italic"], path);
  const format = source.format === undefined ? "general" : string(source.format, `${path}.format`);
  const alignment =
    source.alignment === undefined ? "start" : string(source.alignment, `${path}.alignment`);
  if (!FORMATS.has(format as CellFormat) || !ALIGNMENTS.has(alignment as CellAlignment)) {
    throw new GridCodecError("invalid_workbook", `${path} contains an unsupported style`);
  }
  if (source.bold !== undefined && typeof source.bold !== "boolean") {
    throw new GridCodecError("invalid_workbook", `${path}.bold must be boolean`);
  }
  if (source.italic !== undefined && typeof source.italic !== "boolean") {
    throw new GridCodecError("invalid_workbook", `${path}.italic must be boolean`);
  }
  return {
    format: format as CellFormat,
    alignment: alignment as CellAlignment,
    bold: source.bold ?? false,
    italic: source.italic ?? false,
  };
}

function cell(value: unknown, path: string): GridCell {
  const source = record(value, path);
  exactKeys(source, ["row", "column", "input", "style"], path);
  const input = string(source.input, `${path}.input`);
  if (encoder.encode(input).length > MAX_CELL_INPUT_BYTES) {
    throw new GridCodecError("invalid_workbook", `${path}.input exceeds the cell input limit`);
  }
  return {
    row: id(source.row, `${path}.row`),
    column: id(source.column, `${path}.column`),
    input,
    style: style(source.style, `${path}.style`),
  };
}

function uniqueIds(values: readonly { readonly id: string }[], path: string): Set<string> {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new GridCodecError("invalid_workbook", `${path} contains duplicate id ${value.id}`);
    }
    seen.add(value.id);
  }
  return seen;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new GridCodecError("invalid_workbook", `${path} must be an array`);
  }
  return value;
}

function sheet(value: unknown, path: string): GridSheet {
  const source = record(value, path);
  exactKeys(source, ["id", "name", "metadata", "rows", "columns", "cells"], path);
  const sheetId = id(source.id, `${path}.id`);
  const name = string(source.name, `${path}.name`);
  const nameBytes = encoder.encode(name).length;
  if (nameBytes === 0 || nameBytes > MAX_SHEET_NAME_BYTES) {
    throw new GridCodecError("invalid_workbook", `${path}.name is outside the sheet name limit`);
  }

  const rowValues = array(source.rows, `${path}.rows`);
  const columnValues = array(source.columns, `${path}.columns`);
  const cellValues = source.cells === undefined ? [] : array(source.cells, `${path}.cells`);
  if (rowValues.length === 0 || rowValues.length > MAX_ROWS) {
    throw new GridCodecError("invalid_workbook", `${path}.rows is outside the row limit`);
  }
  if (columnValues.length === 0 || columnValues.length > MAX_COLUMNS) {
    throw new GridCodecError("invalid_workbook", `${path}.columns is outside the column limit`);
  }
  if (cellValues.length > MAX_CELLS) {
    throw new GridCodecError("invalid_workbook", `${path}.cells exceeds the cell limit`);
  }

  const rows = rowValues.map((item, index) => row(item, `${path}.rows[${index}]`));
  const columns = columnValues.map((item, index) => column(item, `${path}.columns[${index}]`));
  const cells = cellValues.map((item, index) => cell(item, `${path}.cells[${index}]`));
  const rowIds = uniqueIds(rows, `${path}.rows`);
  const columnIds = uniqueIds(columns, `${path}.columns`);
  const cellKeys = new Set<string>();
  for (const parsed of cells) {
    if (!rowIds.has(parsed.row) || !columnIds.has(parsed.column)) {
      throw new GridCodecError(
        "invalid_workbook",
        `${path}.cells contains dangling coordinate ${parsed.row}/${parsed.column}`,
      );
    }
    const key = `${parsed.row}\u0000${parsed.column}`;
    if (cellKeys.has(key)) {
      throw new GridCodecError(
        "invalid_workbook",
        `${path}.cells contains duplicate coordinate ${parsed.row}/${parsed.column}`,
      );
    }
    cellKeys.add(key);
  }

  return {
    id: sheetId,
    name,
    metadata: metadata(source.metadata, `${path}.metadata`),
    rows,
    columns,
    cells,
  };
}

function workbook(value: unknown): GridWorkbook {
  const source = record(value, "workbook");
  exactKeys(source, ["id", "metadata", "sheets"], "workbook");
  const sheetValues = array(source.sheets, "workbook.sheets");
  if (sheetValues.length === 0 || sheetValues.length > MAX_SHEETS) {
    throw new GridCodecError("invalid_workbook", "workbook.sheets is outside the sheet limit");
  }
  const sheets = sheetValues.map((item, index) => sheet(item, `workbook.sheets[${index}]`));
  uniqueIds(sheets, "workbook.sheets");
  return {
    id: id(source.id, "workbook.id"),
    metadata: metadata(source.metadata, "workbook.metadata"),
    sheets,
  };
}

export function parseWorkbookSource(source: string): GridWorkbook {
  const actual = encoder.encode(source).length;
  if (actual > MAX_SOURCE_BYTES) {
    throw new GridCodecError(
      "source_too_large",
      `fubsheet source contains ${actual} bytes, limit is ${MAX_SOURCE_BYTES}`,
      actual,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new GridCodecError("invalid_json", error instanceof Error ? error.message : String(error));
  }
  const envelope = record(value, "source");
  exactKeys(envelope, ["schema", "workbook"], "source");
  if (envelope.schema === undefined) {
    throw new GridCodecError("missing_schema", "fubsheet source has no schema version");
  }
  if (envelope.schema !== FUBSHEET_SCHEMA_VERSION) {
    throw new GridCodecError(
      "unsupported_schema",
      `unsupported fubsheet schema ${String(envelope.schema)}`,
    );
  }
  return workbook(envelope.workbook);
}

function encodedStyle(value: GridCellStyle): Record<string, unknown> | undefined {
  const output: Record<string, unknown> = {};
  if (value.format !== "general") output.format = value.format;
  if (value.alignment !== "start") output.alignment = value.alignment;
  if (value.bold) output.bold = true;
  if (value.italic) output.italic = true;
  return Object.keys(output).length === 0 ? undefined : output;
}

export function serializeWorkbook(workbookValue: GridWorkbook): string {
  const validated = workbook({
    id: workbookValue.id,
    metadata: workbookValue.metadata,
    sheets: workbookValue.sheets.map((sheetValue) => ({
      id: sheetValue.id,
      name: sheetValue.name,
      metadata: sheetValue.metadata,
      rows: sheetValue.rows,
      columns: sheetValue.columns,
      cells: sheetValue.cells.map((cellValue) => ({
        row: cellValue.row,
        column: cellValue.column,
        input: cellValue.input,
        style: cellValue.style,
      })),
    })),
  });
  const envelope = {
    schema: FUBSHEET_SCHEMA_VERSION,
    workbook: {
      id: validated.id,
      ...(Object.keys(validated.metadata).length === 0 ? {} : { metadata: validated.metadata }),
      sheets: validated.sheets.map((sheetValue) => ({
        id: sheetValue.id,
        name: sheetValue.name,
        ...(Object.keys(sheetValue.metadata).length === 0
          ? {}
          : { metadata: sheetValue.metadata }),
        rows: sheetValue.rows,
        columns: sheetValue.columns,
        ...(sheetValue.cells.length === 0
          ? {}
          : {
              cells: sheetValue.cells.map((cellValue) => {
                const encoded = encodedStyle(cellValue.style);
                return {
                  row: cellValue.row,
                  column: cellValue.column,
                  input: cellValue.input,
                  ...(encoded === undefined ? {} : { style: encoded }),
                };
              }),
            }),
      })),
    },
  };

  let source: string;
  try {
    source = `${JSON.stringify(envelope, null, 2)}\n`;
  } catch (error) {
    throw new GridCodecError("serialize", error instanceof Error ? error.message : String(error));
  }
  const actual = encoder.encode(source).length;
  if (actual > MAX_SOURCE_BYTES) {
    throw new GridCodecError(
      "source_too_large",
      `fubsheet source contains ${actual} bytes, limit is ${MAX_SOURCE_BYTES}`,
      actual,
    );
  }
  return source;
}
