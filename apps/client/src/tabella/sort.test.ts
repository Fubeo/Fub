import { describe, expect, it } from "vitest";
import { columnNumbers, sortOrder } from "./sort";

describe("l'ordinamento delle righe", () => {
  it("legge i numeri con la virgola, il punto e il meno tipografico", () => {
    expect(columnNumbers(["3,5", "-2", "−4", "+1", "1e3", "a1", ""], "it")).toEqual([3.5, -2, -4, 1, null, null, null]);
    expect(columnNumbers(["3.5", "0,25"], "en")).toEqual([3.5, 0.25]);
  });

  it("legge i numeri come la somma: all'italiana «1.234» è milleduecentotrentaquattro", () => {
    expect(columnNumbers(["1.234", "999"], "it")).toEqual([1234, 999]);
    expect(columnNumbers(["1.234", "999"], "en")).toEqual([1.234, 999]);
    const values = ["1.234", "999", "2,5"];
    expect(sortOrder(values, 1, "it").map((i) => values[i])).toEqual(["2,5", "999", "1.234"]);
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
