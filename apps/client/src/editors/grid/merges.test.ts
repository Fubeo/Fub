import { describe, expect, it } from "vitest";
import {
  cellA1,
  expandToMerges,
  mergeAnchor,
  mergeAt,
  mergesIn,
  parseCellA1,
  parseRangeA1,
  rangeA1,
} from "./merges";

const MERGES = [
  { row: 0, column: 1, rows: 2, columns: 2 },
  { row: 2, column: 2, rows: 1, columns: 3 },
];

describe("unioni e riferimenti A1", () => {
  it("trova l'unione di una cella e la sua cella in alto a sinistra", () => {
    expect(mergeAt(MERGES, { row: 1, column: 2 })).toBe(MERGES[0]);
    expect(mergeAt(MERGES, { row: 1, column: 3 })).toBeUndefined();
    expect(mergeAnchor(MERGES, { row: 1, column: 2 })).toEqual({ row: 0, column: 1 });
    expect(mergeAnchor(MERGES, { row: 5, column: 5 })).toEqual({ row: 5, column: 5 });
  });

  it("allarga un intervallo finché ogni unione che tocca è dentro, anche a catena", () => {
    // B2 tocca B1:C2, che tocca C3:E3 soltanto dopo l'allargamento in basso.
    expect(expandToMerges({ rowStart: 1, rowEnd: 2, columnStart: 1, columnEnd: 1 }, MERGES))
      .toEqual({ rowStart: 0, rowEnd: 2, columnStart: 1, columnEnd: 4 });
    const plain = { rowStart: 5, rowEnd: 6, columnStart: 0, columnEnd: 0 };
    expect(expandToMerges(plain, MERGES)).toBe(plain);
    expect(mergesIn(MERGES, { rowStart: 2, rowEnd: 2, columnStart: 4, columnEnd: 9 })).toEqual([MERGES[1]]);
  });

  it("scrive e legge i riferimenti A1", () => {
    expect(cellA1({ row: 2, column: 1 })).toBe("B3");
    expect(cellA1({ row: 0, column: 26 })).toBe("AA1");
    expect(rangeA1({ rowStart: 2, rowEnd: 2, columnStart: 1, columnEnd: 1 })).toBe("B3");
    expect(rangeA1({ rowStart: 2, rowEnd: 6, columnStart: 1, columnEnd: 3 })).toBe("B3:D7");
    expect(parseCellA1("$AA$10")).toEqual({ row: 9, column: 26 });
    expect(parseCellA1("A0")).toBeNull();
    expect(parseCellA1("b3")).toBeNull();
    expect(parseRangeA1("D7:B3")).toEqual({ rowStart: 2, rowEnd: 6, columnStart: 1, columnEnd: 3 });
    expect(parseRangeA1("B3")).toEqual({ rowStart: 2, rowEnd: 2, columnStart: 1, columnEnd: 1 });
    expect(parseRangeA1("A1:B2:C3")).toBeNull();
    expect(parseRangeA1("A1:")).toBeNull();
  });
});
