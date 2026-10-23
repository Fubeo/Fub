// Le celle unite di un foglio e i riferimenti A1 della selezione.
//
// Una cella unita si disegna come la sua cella in alto a sinistra, grande
// quanto l'unione; le altre non si disegnano. La selezione che tocca
// un'unione la prende tutta, come in Excel, e il cursore la salta.
import type { GridMerge } from "../../host/contract";
import { columnLabel, type GridPosition } from "./model";

export interface GridRange {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
}

/// L'unione che contiene `position`, o `undefined`.
export function mergeAt(merges: readonly GridMerge[], position: GridPosition): GridMerge | undefined {
  return merges.find((merge) =>
    position.row >= merge.row && position.row < merge.row + merge.rows
    && position.column >= merge.column && position.column < merge.column + merge.columns);
}

/// La posizione da cui si legge e si scrive `position`: la cella in alto a
/// sinistra della sua unione, o lei stessa.
export function mergeAnchor(merges: readonly GridMerge[], position: GridPosition): GridPosition {
  const merge = mergeAt(merges, position);
  return merge ? { row: merge.row, column: merge.column } : position;
}

function overlaps(range: GridRange, merge: GridMerge): boolean {
  return merge.row <= range.rowEnd && merge.row + merge.rows - 1 >= range.rowStart
    && merge.column <= range.columnEnd && merge.column + merge.columns - 1 >= range.columnStart;
}

/// L'intervallo allargato finché ogni unione che tocca è dentro.
export function expandToMerges(range: GridRange, merges: readonly GridMerge[]): GridRange {
  let out = range;
  for (let changed = true; changed;) {
    changed = false;
    for (const merge of merges) {
      if (!overlaps(out, merge)) continue;
      const next = {
        rowStart: Math.min(out.rowStart, merge.row),
        rowEnd: Math.max(out.rowEnd, merge.row + merge.rows - 1),
        columnStart: Math.min(out.columnStart, merge.column),
        columnEnd: Math.max(out.columnEnd, merge.column + merge.columns - 1),
      };
      if (next.rowStart !== out.rowStart || next.rowEnd !== out.rowEnd || next.columnStart !== out.columnStart || next.columnEnd !== out.columnEnd) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

/// Le unioni che toccano `range`.
export function mergesIn(merges: readonly GridMerge[], range: GridRange): GridMerge[] {
  return merges.filter((merge) => overlaps(range, merge));
}

/// La cella in A1: `B3`.
export function cellA1(position: GridPosition): string {
  return `${columnLabel(position.column)}${position.row + 1}`;
}

/// L'intervallo in A1: `B3`, o `B3:D7`.
export function rangeA1(range: GridRange): string {
  const start = cellA1({ row: range.rowStart, column: range.columnStart });
  return range.rowStart === range.rowEnd && range.columnStart === range.columnEnd
    ? start
    : `${start}:${cellA1({ row: range.rowEnd, column: range.columnEnd })}`;
}

const CELL = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/u;

/// La cella di un riferimento A1, o `null`.
export function parseCellA1(text: string): GridPosition | null {
  const match = CELL.exec(text);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]!) column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

/// L'intervallo di un riferimento A1 (`B3`, `B3:D7`), o `null`.
export function parseRangeA1(text: string): GridRange | null {
  const [first, second, extra] = text.split(":");
  if (extra !== undefined || first === undefined) return null;
  const start = parseCellA1(first);
  const end = second === undefined ? start : parseCellA1(second);
  if (!start || !end) return null;
  return {
    rowStart: Math.min(start.row, end.row),
    rowEnd: Math.max(start.row, end.row),
    columnStart: Math.min(start.column, end.column),
    columnEnd: Math.max(start.column, end.column),
  };
}
