// **Il presidio dei passi ripetuti del banco delle scene grandi**: la mediana
// lascia passare un campione storto e non una lentezza vera.
//
// Il banco vero (`large.mjs`) apre un browser e non gira qui; qui gira il suo
// giudizio, `large-rules.mjs`. I numeri imitano la CI: il tasto V a 49 900
// elementi costa meno di 60 ms, e un giro con tre compiti lunghi del runner
// nella finestra lo ha portato a 184.
import { describe, expect, it } from "vitest";
import { REPEATS, judgeSamples, median } from "./large-rules.mjs";

describe("i passi ripetuti del banco delle scene grandi", () => {
  it("si ripetono un numero dispari di volte", () => {
    expect(REPEATS).toBeGreaterThanOrEqual(3);
    expect(REPEATS % 2).toBe(1);
  });

  it("un campione storto su tre non fa rosso", () => {
    const judged = judgeSamples([60, 184, 58], 100);
    expect(judged.pass).toBe(true);
    expect(judged.medianMs).toBe(60);
    expect(judged.samplesMs).toEqual([60, 184, 58]);
  });

  it("tre campioni lenti fanno rosso", () => {
    const judged = judgeSamples([140, 150, 135], 100);
    expect(judged.pass).toBe(false);
    expect(judged.medianMs).toBe(140);
  });

  it("due lenti su tre fanno rosso", () => {
    expect(judgeSamples([60, 184, 101], 100).pass).toBe(false);
  });

  it("la soglia stessa passa, un campione solo si giudica da sé", () => {
    expect(judgeSamples([100, 100, 100], 100).pass).toBe(true);
    expect(judgeSamples([105.2], 100).pass).toBe(false);
    expect(judgeSamples([99], 100).pass).toBe(true);
  });

  it("con soglie diverse giudica lo scarto di ciascun campione", () => {
    // Il secondo giro ridisegna la vista, e ha la soglia dell'assestamento.
    expect(judgeSamples([90, 250, 95], [100, 300, 100]).pass).toBe(true);
    expect(judgeSamples([120, 250, 130], [100, 300, 100]).pass).toBe(false);
    expect(() => judgeSamples([1, 2], [100])).toThrow(RangeError);
  });

  it("la mediana", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
    expect(() => median([Number.NaN])).toThrow(RangeError);
  });
});
