import { cellInput, type GridSheet } from "./model";
import { selectionRectangle, type GridSelection } from "./selection";

export function parseTsv(source: string): readonly (readonly string[])[] {
  const normalized = source.replace(/\r\n?/g, "\n");
  const withoutFinalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutFinalNewline.split("\n").map((row) => row.split("\t"));
}

export function selectionAsTsv(sheet: GridSheet, selection: GridSelection): string {
  const rectangle = selectionRectangle(selection);
  const rows: string[] = [];
  for (let row = rectangle.rowStart; row <= rectangle.rowEnd; row += 1) {
    const values: string[] = [];
    for (let column = rectangle.columnStart; column <= rectangle.columnEnd; column += 1) {
      values.push(
        cellInput(sheet, {
          row: sheet.rows[row].id,
          column: sheet.columns[column].id,
        }),
      );
    }
    rows.push(values.join("\t"));
  }
  return rows.join("\n");
}

export function tsvUpdates(
  sheet: GridSheet,
  start: { readonly row: number; readonly column: number },
  source: string,
): readonly { readonly row: string; readonly column: string; readonly input: string }[] {
  const updates: { row: string; column: string; input: string }[] = [];
  for (const [rowOffset, values] of parseTsv(source).entries()) {
    const row = sheet.rows[start.row + rowOffset];
    if (!row) break;
    for (const [columnOffset, input] of values.entries()) {
      const column = sheet.columns[start.column + columnOffset];
      if (!column) break;
      updates.push({ row: row.id, column: column.id, input });
    }
  }
  return updates;
}
