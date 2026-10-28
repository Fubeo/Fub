import { describe, expect, it } from "vitest";
import { fillSeries } from "./series";

describe("il riempimento di serie", () => {
  it("continua i numeri col passo degli ultimi due, virgola e decimali compresi", () => {
    expect(fillSeries(["1", "3"], 3)).toEqual(["5", "7", "9"]);
    expect(fillSeries(["0,5", "1,0"], 2)).toEqual(["1,5", "2,0"]);
    expect(fillSeries(["7"], 2)).toEqual(["8", "9"]);
  });

  it("all'indietro la serie scende", () => {
    expect(fillSeries(["3", "4"], 2, true)).toEqual(["2", "1"]);
  });

  it("un testo con un numero in fondo cresce, con gli zeri davanti", () => {
    expect(fillSeries(["Voce 08"], 3)).toEqual(["Voce 09", "Voce 10", "Voce 11"]);
  });

  it("il resto si ripete in ciclo", () => {
    expect(fillSeries(["sì", "no"], 3)).toEqual(["sì", "no", "sì"]);
    expect(fillSeries([], 3)).toEqual([]);
  });
});
