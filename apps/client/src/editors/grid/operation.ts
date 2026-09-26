import {
  invertOperation,
  operationFromText,
  type TextOperation,
} from "../core/text-operation";
import {
  cellAt,
  coordinateAt,
  normalizedSelection,
  serializeWorkbook,
  type GridCell,
  type GridCellStyle,
  type GridCoordinate,
  type GridPosition,
  type GridSelection,
  type GridSheet,
  type GridWorkbook,
} from "./model";

export interface GridCellSnapshot {
  readonly input: string;
  readonly style?: GridCellStyle;
}

export interface GridCellPatch {
  readonly coordinate: GridCoordinate;
  readonly before: GridCellSnapshot | null;
  readonly after: GridCellSnapshot | null;
}

export interface GridOperation extends TextOperation {
  readonly kind: "grid";
  readonly patches: readonly GridCellPatch[];
}

export function isGridOperation(operation: TextOperation | null): operation is GridOperation {
  return operation !== null && "kind" in operation && operation.kind === "grid";
}

function clonedStyle(style: GridCellStyle | undefined): GridCellStyle | undefined {
  return style ? { ...style } : undefined;
}

function snapshot(cell: GridCell | undefined): GridCellSnapshot | null {
  if (!cell) return null;
  return {
    input: cell.input ?? "",
    ...(cell.style ? { style: clonedStyle(cell.style) } : {}),
  };
}

function snapshotsEqual(left: GridCellSnapshot | null, right: GridCellSnapshot | null): boolean {
  if (left === null || right === null) return left === right;
  return left.input === right.input && JSON.stringify(left.style ?? {}) === JSON.stringify(right.style ?? {});
}

function cellFor(sheet: GridSheet, coordinate: GridCoordinate): GridCell | undefined {
  if (coordinate.sheet !== sheet.id) return undefined;
  return sheet.cells?.find(
    (cell) => cell.row === coordinate.row && cell.column === coordinate.column,
  );
}

function isEmpty(snapshot: GridCellSnapshot): boolean {
  return snapshot.input === "" && Object.keys(snapshot.style ?? {}).length === 0;
}

function replaceCell(sheet: GridSheet, coordinate: GridCoordinate, value: GridCellSnapshot | null): void {
  const cells = sheet.cells ?? [];
  const index = cells.findIndex(
    (cell) => cell.row === coordinate.row && cell.column === coordinate.column,
  );
  if (value === null || isEmpty(value)) {
    if (index >= 0) cells.splice(index, 1);
  } else {
    const cell: GridCell = {
      row: coordinate.row,
      column: coordinate.column,
      ...(value.input ? { input: value.input } : {}),
      ...(value.style && Object.keys(value.style).length ? { style: clonedStyle(value.style) } : {}),
    };
    if (index >= 0) cells[index] = cell;
    else cells.push(cell);
  }
  if (cells.length) sheet.cells = cells;
  else delete sheet.cells;
}

/** Applies all cell preimages before mutating, so a stale operation is atomic. */
export function applyGridPatches(workbook: GridWorkbook, patches: readonly GridCellPatch[]): boolean {
  const sheets = new Map(workbook.sheets.map((sheet) => [sheet.id, sheet]));
  for (const patch of patches) {
    const sheet = sheets.get(patch.coordinate.sheet);
    if (!sheet || !snapshotsEqual(snapshot(cellFor(sheet, patch.coordinate)), patch.before)) {
      return false;
    }
  }
  for (const patch of patches) {
    replaceCell(sheets.get(patch.coordinate.sheet)!, patch.coordinate, patch.after);
  }
  return true;
}

export function commitGridPatches(
  workbook: GridWorkbook,
  beforeSource: string,
  patches: readonly GridCellPatch[],
): { readonly source: string; readonly operation: GridOperation } | null {
  if (!patches.length || !applyGridPatches(workbook, patches)) return null;
  const source = serializeWorkbook(workbook);
  return {
    source,
    operation: {
      kind: "grid",
      patches,
      ...operationFromText(beforeSource, source),
    },
  };
}

export function inverseGridPatches(patches: readonly GridCellPatch[]): GridCellPatch[] {
  return patches.map((patch) => ({
    coordinate: patch.coordinate,
    before: patch.after,
    after: patch.before,
  }));
}

export function invertGridOperation(operation: GridOperation): GridOperation {
  return {
    kind: "grid",
    patches: inverseGridPatches(operation.patches),
    ...invertOperation(operation),
  };
}

export function inputPatch(
  sheet: GridSheet,
  position: GridPosition,
  input: string,
): GridCellPatch | null {
  const coordinate = coordinateAt(sheet, position);
  if (!coordinate) return null;
  const before = snapshot(cellAt(sheet, position));
  const after = input || before?.style
    ? { input, ...(before?.style ? { style: before.style } : {}) }
    : null;
  return snapshotsEqual(before, after) ? null : { coordinate, before, after };
}

export function parseTsv(source: string): string[][] {
  const rows = source.replace(/\r\n?/g, "\n").split("\n");
  if (rows[rows.length - 1] === "") rows.pop();
  return rows.map((row) => row.split("\t"));
}

export function pastePatches(
  sheet: GridSheet,
  start: GridPosition,
  source: string,
): GridCellPatch[] {
  const values = parseTsv(source);
  const patches: GridCellPatch[] = [];
  for (let row = 0; row < values.length; row += 1) {
    for (let column = 0; column < values[row].length; column += 1) {
      const patch = inputPatch(
        sheet,
        { row: start.row + row, column: start.column + column },
        values[row][column],
      );
      if (patch) patches.push(patch);
    }
  }
  return patches;
}

export function selectionTsv(sheet: GridSheet, selection: GridSelection): string {
  const range = normalizedSelection(selection);
  const rows: string[] = [];
  for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
    const values: string[] = [];
    for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
      values.push(cellAt(sheet, { row, column })?.input ?? "");
    }
    rows.push(values.join("\t"));
  }
  return rows.join("\n");
}
