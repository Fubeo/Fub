import { tsvRows } from "../core/tsv";
import {
  normalizedSelection,
  type GridCell,
  type GridCellStyle,
  type GridCoordinate,
  type GridPosition,
  type GridSelection,
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

export function inverseGridPatches(patches: readonly GridCellPatch[]): GridCellPatch[] {
  return patches.map((patch) => ({
    coordinate: patch.coordinate,
    before: patch.after,
    after: patch.before,
  }));
}

/// La cella di una posizione: la griglia le tiene indicizzate.
export type GridCellLookup = (position: GridPosition) => GridCell | undefined;

function selectionInputs(selection: GridSelection, lookup: GridCellLookup): string[][] {
  const range = normalizedSelection(selection);
  const rows: string[][] = [];
  for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
    const values: string[] = [];
    for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
      values.push(lookup({ row, column })?.input ?? "");
    }
    rows.push(values);
  }
  return rows;
}

/// La selezione per la clipboard, nel TSV dei fogli ([`tsvRows`]).
export function selectionTsv(selection: GridSelection, lookup: GridCellLookup): string {
  return tsvRows(selectionInputs(selection, lookup));
}

/// La selezione come testo da leggere, per il contesto dei comandi: tab fra le
/// celle, a capo fra le righe, e gli input così come sono.
export function selectionText(selection: GridSelection, lookup: GridCellLookup): string {
  return selectionInputs(selection, lookup).map((row) => row.join("\t")).join("\n");
}
