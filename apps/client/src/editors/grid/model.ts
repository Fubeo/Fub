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
