import type { GridSheet } from "./model";

export interface GridPoint {
  readonly row: number;
  readonly column: number;
}

export interface GridSelection {
  readonly anchor: GridPoint;
  readonly focus: GridPoint;
}

export interface GridRectangle {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
}

export function singleCellSelection(point: GridPoint): GridSelection {
  return { anchor: point, focus: point };
}

export function selectionRectangle(selection: GridSelection): GridRectangle {
  return {
    rowStart: Math.min(selection.anchor.row, selection.focus.row),
    rowEnd: Math.max(selection.anchor.row, selection.focus.row),
    columnStart: Math.min(selection.anchor.column, selection.focus.column),
    columnEnd: Math.max(selection.anchor.column, selection.focus.column),
  };
}

export function selectionContains(selection: GridSelection, point: GridPoint): boolean {
  const rectangle = selectionRectangle(selection);
  return (
    point.row >= rectangle.rowStart &&
    point.row <= rectangle.rowEnd &&
    point.column >= rectangle.columnStart &&
    point.column <= rectangle.columnEnd
  );
}

export function clampPoint(sheet: GridSheet, point: GridPoint): GridPoint {
  return {
    row: Math.max(0, Math.min(sheet.rows.length - 1, point.row)),
    column: Math.max(0, Math.min(sheet.columns.length - 1, point.column)),
  };
}

export interface GridNavigation {
  readonly point: GridPoint;
  readonly extend: boolean;
  readonly edit: boolean;
}

export function navigationForKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey">,
  sheet: GridSheet,
  current: GridPoint,
  pageRows: number,
): GridNavigation | null {
  const command = event.ctrlKey || event.metaKey;
  let row = current.row;
  let column = current.column;
  let edit = false;
  switch (event.key) {
    case "ArrowUp":
      row -= 1;
      break;
    case "ArrowDown":
      row += 1;
      break;
    case "ArrowLeft":
      column -= 1;
      break;
    case "ArrowRight":
      column += 1;
      break;
    case "Home":
      if (command) row = 0;
      column = 0;
      break;
    case "End":
      if (command) row = sheet.rows.length - 1;
      column = sheet.columns.length - 1;
      break;
    case "PageUp":
      row -= Math.max(1, pageRows);
      break;
    case "PageDown":
      row += Math.max(1, pageRows);
      break;
    case "Tab":
      column += event.shiftKey ? -1 : 1;
      if (column >= sheet.columns.length) {
        column = 0;
        row += 1;
      } else if (column < 0) {
        column = sheet.columns.length - 1;
        row -= 1;
      }
      break;
    case "Enter":
      if (event.shiftKey) {
        row -= 1;
      } else {
        edit = true;
      }
      break;
    case "F2":
      edit = true;
      break;
    default:
      return null;
  }
  return {
    point: clampPoint(sheet, { row, column }),
    extend: event.shiftKey && event.key !== "Tab" && event.key !== "Enter",
    edit,
  };
}

export function applyNavigation(
  selection: GridSelection,
  navigation: GridNavigation,
): GridSelection {
  return navigation.extend
    ? { anchor: selection.anchor, focus: navigation.point }
    : singleCellSelection(navigation.point);
}
