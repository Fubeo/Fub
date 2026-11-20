import { describe, expect, it } from "vitest";
import { moveColumn, parseOrder, parseSort, sameColumns, sortBy, sortValue, sortedBy, toggleColumn, withoutSort } from "./sort";

describe("l'ordinamento di una vista", () => {
  it("legge le chiavi del piano e rifiuta quelle malformate", () => {
    expect(parseSort([{ key: "consegna", descending: true }, { key: "titolo" }])).toEqual([
      { key: "consegna", descending: true }, { key: "titolo", descending: false },
    ]);
    expect(parseSort(null)).toEqual([]);
    expect(() => parseSort([{ key: "" }])).toThrow();
    expect(() => parseSort([{ key: "a", descending: "sì" }])).toThrow();
  });

  it("ordinare per una chiave la porta in testa e lascia le altre dove erano", () => {
    const sort = [{ key: "prop.stato", descending: false }, { key: "titolo", descending: false }];
    expect(sortBy(sort, "titolo", true)).toEqual([{ key: "titolo", descending: true }, { key: "prop.stato", descending: false }]);
    // Chi l'aveva scritta come `prop.stato` la ritrova scritta così.
    expect(sortBy(sort, "stato", true)[0]).toEqual({ key: "prop.stato", descending: true });
    expect(sortedBy(sort, "stato")).toEqual({ key: "prop.stato", descending: false });
  });

  it("togliere l'ultima chiave toglie `sort` dal file", () => {
    expect(withoutSort([{ key: "stato", descending: false }], "prop.stato")).toEqual([]);
    expect(sortValue([])).toBeNull();
  });
});

describe("le colonne di una vista", () => {
  it("una colonna mostrata va in fondo, una nascosta esce", () => {
    expect(toggleColumn(["titolo", "stato"], "artista", true)).toEqual(["titolo", "stato", "artista"]);
    expect(toggleColumn(["titolo", "stato"], "prop.stato", false)).toEqual(["titolo"]);
    expect(toggleColumn(["titolo"], "titolo", true)).toEqual(["titolo"]);
  });

  it("trascinare sposta una colonna e lascia le altre nel loro ordine", () => {
    expect(moveColumn(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveColumn(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(sameColumns(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameColumns(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("legge `order` dal piano e rifiuta una colonna senza nome", () => {
    expect(parseOrder(["titolo", "file.name"])).toEqual(["titolo", "file.name"]);
    expect(parseOrder(null)).toEqual([]);
    expect(() => parseOrder(["titolo", ""])).toThrow();
  });
});
