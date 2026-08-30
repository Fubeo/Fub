export type WorkbookId = string;
export type SheetId = string;
export type RowId = string;
export type ColumnId = string;

export type CellFormat = "general" | "text" | "number" | "percent" | "currency" | "date";
export type CellAlignment = "start" | "center" | "end";

export interface GridCellStyle {
  readonly format: CellFormat;
  readonly alignment: CellAlignment;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface GridRow {
  readonly id: RowId;
  readonly height?: number;
}

export interface GridColumn {
  readonly id: ColumnId;
  readonly width?: number;
}

export interface GridCell {
  readonly row: RowId;
  readonly column: ColumnId;
  readonly input: string;
  readonly style: GridCellStyle;
}

export interface GridSheet {
  readonly id: SheetId;
  readonly name: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly rows: readonly GridRow[];
  readonly columns: readonly GridColumn[];
  readonly cells: readonly GridCell[];
}

export interface GridWorkbook {
  readonly id: WorkbookId;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sheets: readonly GridSheet[];
}

export interface CellKey {
  readonly row: RowId;
  readonly column: ColumnId;
}

export interface CellInputChange extends CellKey {
  readonly before: string;
  readonly after: string;
  readonly beforePresent: boolean;
  readonly afterPresent: boolean;
}

/** One workbook-level mutation and therefore one undo entry. */
export interface GridOperation {
  readonly kind: "set_cells";
  readonly sheet: SheetId;
  readonly changes: readonly CellInputChange[];
}

export interface AppliedGridOperation {
  readonly workbook: GridWorkbook;
  readonly inverse: GridOperation;
}

export const DEFAULT_CELL_STYLE: GridCellStyle = Object.freeze({
  format: "general",
  alignment: "start",
  bold: false,
  italic: false,
});

export class GridOperationConflict extends Error {
  constructor(
    readonly key: CellKey,
    readonly expected: string,
    readonly actual: string,
    readonly expectedPresent: boolean,
    readonly actualPresent: boolean,
  ) {
    super(
      `cell (${key.row}, ${key.column}) changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    this.name = "GridOperationConflict";
  }
}

function cellIdentity(key: CellKey): string {
  return `${key.row}\u0000${key.column}`;
}

export function cellAt(sheet: GridSheet, key: CellKey): GridCell | undefined {
  return sheet.cells.find((cell) => cell.row === key.row && cell.column === key.column);
}

export function cellInput(sheet: GridSheet, key: CellKey): string {
  return cellAt(sheet, key)?.input ?? "";
}

export function a1Address(sheet: GridSheet, key: CellKey): string | null {
  const row = sheet.rows.findIndex((candidate) => candidate.id === key.row);
  const column = sheet.columns.findIndex((candidate) => candidate.id === key.column);
  if (row < 0 || column < 0) return null;
  return `${columnLabel(column + 1)}${row + 1}`;
}

export function columnLabel(oneBasedColumn: number): string {
  if (!Number.isInteger(oneBasedColumn) || oneBasedColumn < 1) return "";
  let column = oneBasedColumn;
  let label = "";
  while (column > 0) {
    column -= 1;
    label = String.fromCharCode(65 + (column % 26)) + label;
    column = Math.floor(column / 26);
  }
  return label;
}

export function operationForInputs(
  workbook: GridWorkbook,
  sheetId: SheetId,
  updates: readonly (CellKey & { readonly input: string })[],
): GridOperation {
  const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) throw new Error(`unknown sheet: ${sheetId}`);
  const seen = new Set<string>();
  const changes: CellInputChange[] = [];
  for (const update of updates) {
    const identity = cellIdentity(update);
    if (seen.has(identity)) throw new Error(`duplicate cell update: ${update.row}/${update.column}`);
    seen.add(identity);
    const existing = cellAt(sheet, update);
    const before = existing?.input ?? "";
    if (before === update.input) continue;
    const beforePresent = existing !== undefined;
    const styled = existing !== undefined && existing.style !== DEFAULT_CELL_STYLE;
    changes.push({
      row: update.row,
      column: update.column,
      before,
      after: update.input,
      beforePresent,
      afterPresent: update.input !== "" || styled,
    });
  }
  return { kind: "set_cells", sheet: sheetId, changes };
}

export function applyGridOperation(
  workbook: GridWorkbook,
  operation: GridOperation,
): AppliedGridOperation {
  const sheetIndex = workbook.sheets.findIndex((sheet) => sheet.id === operation.sheet);
  if (sheetIndex < 0) throw new Error(`unknown sheet: ${operation.sheet}`);
  const sheet = workbook.sheets[sheetIndex];
  const rowIds = new Set(sheet.rows.map((row) => row.id));
  const columnIds = new Set(sheet.columns.map((column) => column.id));
  const cellIndexes = new Map<string, number>();
  sheet.cells.forEach((cell, index) => cellIndexes.set(cellIdentity(cell), index));

  const seen = new Set<string>();
  for (const change of operation.changes) {
    const identity = cellIdentity(change);
    if (seen.has(identity)) throw new Error(`duplicate cell change: ${change.row}/${change.column}`);
    seen.add(identity);
    if (!rowIds.has(change.row) || !columnIds.has(change.column)) {
      throw new Error(`dangling cell change: ${change.row}/${change.column}`);
    }
    const index = cellIndexes.get(identity);
    const actualPresent = index !== undefined;
    const actual = actualPresent ? sheet.cells[index].input : "";
    if (actual !== change.before || actualPresent !== change.beforePresent) {
      throw new GridOperationConflict(
        change,
        change.before,
        actual,
        change.beforePresent,
        actualPresent,
      );
    }
  }

  if (operation.changes.length === 0) {
    return {
      workbook,
      inverse: { ...operation, changes: [] },
    };
  }

  const changes = new Map(operation.changes.map((change) => [cellIdentity(change), change]));
  const cells = sheet.cells.flatMap((cell) => {
    const change = changes.get(cellIdentity(cell));
    if (!change) return [cell];
    return change.afterPresent ? [{ ...cell, input: change.after }] : [];
  });
  for (const change of operation.changes) {
    if (change.beforePresent || !change.afterPresent) continue;
    cells.push({
      row: change.row,
      column: change.column,
      input: change.after,
      style: DEFAULT_CELL_STYLE,
    });
  }

  const sheets = [...workbook.sheets];
  sheets[sheetIndex] = { ...sheet, cells };
  return {
    workbook: { ...workbook, sheets },
    inverse: {
      kind: "set_cells",
      sheet: operation.sheet,
      changes: operation.changes.map((change) => ({
        row: change.row,
        column: change.column,
        before: change.after,
        after: change.before,
        beforePresent: change.afterPresent,
        afterPresent: change.beforePresent,
      })),
    },
  };
}
