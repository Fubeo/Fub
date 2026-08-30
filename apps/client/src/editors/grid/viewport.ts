import type { GridSheet } from "./model";

export const DEFAULT_ROW_HEIGHT = 28;
export const DEFAULT_COLUMN_WIDTH = 120;
export const ROW_HEADER_WIDTH = 48;
export const COLUMN_HEADER_HEIGHT = 28;
export const GRID_OVERSCAN = 3;

export interface AxisLayout {
  readonly offsets: readonly number[];
  readonly sizes: readonly number[];
  readonly total: number;
}

export interface GridLayout {
  readonly rows: AxisLayout;
  readonly columns: AxisLayout;
}

export interface VisibleRange {
  readonly start: number;
  readonly end: number;
}

function axisLayout(sizes: readonly number[]): AxisLayout {
  const offsets = new Array<number>(sizes.length);
  let total = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    offsets[index] = total;
    total += sizes[index];
  }
  return { offsets, sizes, total };
}

export function gridLayout(sheet: GridSheet): GridLayout {
  return {
    rows: axisLayout(sheet.rows.map((row) => row.height ?? DEFAULT_ROW_HEIGHT)),
    columns: axisLayout(
      sheet.columns.map((column) => column.width ?? DEFAULT_COLUMN_WIDTH),
    ),
  };
}

function firstIntersecting(layout: AxisLayout, offset: number): number {
  let low = 0;
  let high = layout.sizes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const end = layout.offsets[middle] + layout.sizes[middle];
    if (end <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, layout.sizes.length - 1));
}

export function visibleRange(
  layout: AxisLayout,
  offset: number,
  viewportSize: number,
  overscan = GRID_OVERSCAN,
): VisibleRange {
  if (layout.sizes.length === 0) return { start: 0, end: 0 };
  const first = firstIntersecting(layout, Math.max(0, offset));
  const last = firstIntersecting(layout, Math.max(0, offset + viewportSize));
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(layout.sizes.length, last + overscan + 1),
  };
}

export function visibleGridRange(
  layout: GridLayout,
  scrollLeft: number,
  scrollTop: number,
  width: number,
  height: number,
): { readonly rows: VisibleRange; readonly columns: VisibleRange } {
  return {
    rows: visibleRange(layout.rows, scrollTop, height),
    columns: visibleRange(layout.columns, scrollLeft, width),
  };
}
