import { describe, expect, it } from "vitest";
import { cellNumber, sortOrder } from "./sort";

describe("l'ordinamento delle righe", () => {
  it("legge i numeri con la virgola, il punto e il meno tipografico", () => {
    expect(["3,5", "-2", "−4", "+1", "1e3", "a1"].map(cellNumber)).toEqual([3.5, -2, -4, 1, null, null]);
  });

  it("mette i numeri prima del testo e le vuote in fondo, anche al contrario", () => {
    const values = ["b", "", "10", "file 10", "2", "file 2"];
    expect(sortOrder(values, 1, "it").map((i) => values[i])).toEqual(["2", "10", "b", "file 2", "file 10", ""]);
    expect(sortOrder(values, -1, "it").map((i) => values[i])).toEqual(["file 10", "file 2", "b", "10", "2", ""]);
  });

  it("è stabile", () => {
    expect(sortOrder(["x", "a", "x", "a"], 1, "it")).toEqual([1, 3, 0, 2]);
  });
});
