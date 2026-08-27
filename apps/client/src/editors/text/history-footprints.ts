import type { ChangeDesc } from "@codemirror/state";

/** Maximum number of disjoint ranges and deletion anchors retained. */
export const MAX_FOOTPRINTS = 512;

export interface FootprintRange {
  readonly from: number;
  readonly to: number;
}

export interface FootprintState {
  readonly ranges: readonly FootprintRange[];
  readonly anchors: readonly number[];
  readonly unknown: boolean;
}

export const emptyFootprints: FootprintState = {
  ranges: [],
  anchors: [],
  unknown: false,
};

function unknownFootprints(): FootprintState {
  return { ranges: [], anchors: [], unknown: true };
}

function normalizedRanges(ranges: readonly FootprintRange[]): FootprintRange[] {
  const ordered = ranges
    .filter((range) => range.from < range.to)
    .map((range) => ({ from: range.from, to: range.to }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const result: FootprintRange[] = [];
  for (const range of ordered) {
    const previous = result[result.length - 1];
    if (previous && range.from <= previous.to) {
      result[result.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) };
    } else {
      result.push(range);
    }
  }
  return result;
}

function normalizedAnchors(anchors: readonly number[]): number[] {
  const ordered = anchors.filter(Number.isInteger).sort((a, b) => a - b);
  const result: number[] = [];
  for (const anchor of ordered) {
    if (result[result.length - 1] !== anchor) result.push(anchor);
  }
  return result;
}

function boundedState(
  ranges: readonly FootprintRange[],
  anchors: readonly number[],
): FootprintState {
  if (
    ranges.some(
      (range) =>
        !Number.isInteger(range.from) ||
        !Number.isInteger(range.to) ||
        range.from < 0 ||
        range.from >= range.to,
    ) ||
    anchors.some((anchor) => !Number.isInteger(anchor) || anchor < 0)
  ) {
    return unknownFootprints();
  }
  const normalized = normalizedRanges(ranges);
  const uniqueAnchors = normalizedAnchors(anchors);
  if (normalized.length + uniqueAnchors.length > MAX_FOOTPRINTS) return unknownFootprints();
  return { ranges: normalized, anchors: uniqueAnchors, unknown: false };
}

/** Maps all retained coordinates through a public CodeMirror change descriptor. */
export function mapFootprints(state: FootprintState, changes: ChangeDesc): FootprintState {
  if (state.unknown || changes.empty) return state;
  const ranges: FootprintRange[] = [];
  const anchors: number[] = [];
  try {
    for (const range of state.ranges) {
      if (
        !Number.isInteger(range.from) ||
        !Number.isInteger(range.to) ||
        range.from < 0 ||
        range.from > range.to ||
        range.to > changes.length
      ) {
        return unknownFootprints();
      }
      const from = changes.mapPos(range.from, 1);
      const to = changes.mapPos(range.to, -1);
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < 0 ||
        from > changes.newLength ||
        to > changes.newLength
      ) {
        return unknownFootprints();
      }
      if (from === to) {
        anchors.push(from);
      } else {
        ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
      }
    }
    for (const anchor of state.anchors) {
      if (!Number.isInteger(anchor) || anchor < 0 || anchor > changes.length) {
        return unknownFootprints();
      }
      const mapped = changes.mapPos(anchor, 1);
      if (
        !Number.isInteger(mapped) ||
        mapped < 0 ||
        mapped > changes.newLength
      ) {
        return unknownFootprints();
      }
      anchors.push(mapped);
    }
  } catch {
    return unknownFootprints();
  }
  return boundedState(ranges, anchors);
}

/** Adds the output ranges (or deletion anchors) of one local transaction. */
export function addFootprints(state: FootprintState, changes: ChangeDesc): FootprintState {
  if (state.unknown || changes.empty) return state;
  const ranges = [...state.ranges];
  const anchors = [...state.anchors];
  let invalid = false;
  try {
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      if (
        fromA < 0 ||
        toA < fromA ||
        toA > changes.length ||
        fromB < 0 ||
        toB < fromB ||
        toB > changes.newLength
      ) {
        invalid = true;
        return;
      }
      if (fromB === toB) anchors.push(fromB);
      else ranges.push({ from: fromB, to: toB });
    }, true);
  } catch {
    return unknownFootprints();
  }
  if (invalid) return unknownFootprints();
  return boundedState(ranges, anchors);
}

/** Maps existing metadata and optionally records a local historyable change. */
export function advanceFootprints(
  state: FootprintState,
  changes: ChangeDesc,
  addLocal: boolean,
): FootprintState {
  const mapped = mapFootprints(state, changes);
  return addLocal ? addFootprints(mapped, changes) : mapped;
}

/** Checks whether a source-side change can touch any retained local footprint. */
export function footprintsOverlap(state: FootprintState, changes: ChangeDesc): boolean {
  if (changes.empty) return false;
  if (state.unknown) return true;
  let overlap = false;
  try {
    changes.iterChangedRanges((fromA, toA) => {
      if (overlap) return;
      if (fromA === toA) {
        overlap = state.ranges.some((range) => range.from < fromA && fromA < range.to);
        if (!overlap) overlap = state.anchors.some((anchor) => anchor === fromA);
      } else {
        overlap = state.ranges.some((range) => range.from < toA && fromA < range.to);
        if (!overlap) {
          overlap = state.anchors.some((anchor) => fromA <= anchor && anchor <= toA);
        }
      }
    }, true);
  } catch {
    return true;
  }
  return overlap;
}

/** Small mutable owner used by TextEngine; it retains metadata, never text. */
export class HistoryFootprints {
  private value: FootprintState = emptyFootprints;

  public get state(): FootprintState {
    return this.value;
  }

  public get unknown(): boolean {
    return this.value.unknown;
  }

  public reset(): void {
    this.value = emptyFootprints;
  }

  public markUnknown(): void {
    this.value = unknownFootprints();
  }

  public advance(changes: ChangeDesc, addLocal: boolean): void {
    this.value = advanceFootprints(this.value, changes, addLocal);
  }

  public overlaps(changes: ChangeDesc): boolean {
    return footprintsOverlap(this.value, changes);
  }

  public clearIfNoHistory(undoDepth: number, redoDepth: number): void {
    if (undoDepth === 0 && redoDepth === 0) this.reset();
  }
}
