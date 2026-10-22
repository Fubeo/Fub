import { describe, expect, it } from "vitest";
import type { GridCell, GridSheet } from "./model";
import { inverseGridPatches, selectionText, selectionTsv } from "./operation";
import { parseTsv } from "../core/tsv";

/** Un foglio due per due e la sua ricerca di celle per posizione. */
function filled(cells: Array<[string, string, string]>) {
  const sheet: GridSheet = {
    id: "main",
    name: "Main",
    rows: [{ id: "r1", hidden: false }, { id: "r2", hidden: false }],
    columns: [{ id: "c1", hidden: false }, { id: "c2", hidden: false }],
    cells: cells.map(([row, column, input]): GridCell => ({ row, column, input })),
  };
  const lookup = (position: { row: number; column: number }) => sheet.cells?.find((cell) =>
    cell.row === sheet.rows[position.row]?.id && cell.column === sheet.columns[position.column]?.id);
  return { lookup };
}

describe("grid operations", () => {
  it("l'inverso scambia prima e dopo di ogni cella, nello stesso ordine", () => {
    const coordinate = { sheet: "main", row: "r1", column: "c1" };
    const other = { sheet: "main", row: "r2", column: "c1" };
    expect(inverseGridPatches([
      { coordinate, before: { input: "1" }, after: { input: "2" } },
      { coordinate: other, before: null, after: { input: "x" } },
    ])).toEqual([
      { coordinate, before: { input: "2" }, after: { input: "1" } },
      { coordinate: other, before: { input: "x" }, after: null },
    ]);
  });
});

describe("clipboard TSV", () => {
  const tricky = 'prima\nseconda\tterza';

  it("una cella con tab, a capo e virgolette torna com'era, nelle stesse dimensioni", () => {
    const { lookup } = filled([
      ["r1", "c1", tricky],
      ["r1", "c2", '"citata"'],
      ["r2", "c1", 'a"b\r\nc'],
      ["r2", "c2", "\""],
    ]);
    const all = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
    const one = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };

    expect(selectionTsv(one, lookup)).toBe('"prima\nseconda\tterza"\n');
    expect(parseTsv(selectionTsv(one, lookup))).toEqual([[tricky]]);
    expect(parseTsv(selectionTsv(all, lookup))).toEqual([[tricky, '"citata"'], ['a"b\r\nc', '"']]);
    expect(selectionText(one, lookup)).toBe(tricky);
  });

  it("un'ultima riga vuota resta una riga", () => {
    const { lookup } = filled([["r1", "c1", "x"], ["r1", "c2", "y"], ["r2", "c2", "z"]]);
    const column = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } };
    expect(selectionTsv(column, lookup)).toBe("x\n\n");
    expect(parseTsv(selectionTsv(column, lookup))).toEqual([["x"], [""]]);
    expect(parseTsv(selectionTsv({ anchor: { row: 1, column: 0 }, focus: { row: 1, column: 0 } }, lookup))).toEqual([[""]]);
  });
});
