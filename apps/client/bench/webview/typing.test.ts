// Il valore dello scenario S1 dai suoi giri (`s1Values` in `typing.mjs`): il
// p95 del tasto a schermo è la mediana dei giri, così un giro con due intoppi
// del runner non fa cadere la soglia (#293), mentre un editor più lento in
// ogni giro sì.
import { describe, expect, it } from "vitest";

import { S1_ROUNDS, S1_TYPED, s1Note, s1Values, type TypingReport } from "./typing.mjs";
import budgets from "./budgets.json";

/// Un giro col p95 e i campioni dati.
const round = (p95: number, count = 36): TypingReport => ({ input: { key: { count, p50: Math.round(p95 / 2), p95, max: p95 + 20 } } });

const ci: Record<string, number> = budgets.ci;

describe("il valore di S1 dai giri", () => {
  it("fa un numero dispari di giri, perché la mediana sia un giro vero", () => {
    expect(S1_ROUNDS).toBeGreaterThanOrEqual(3);
    expect(S1_ROUNDS % 2).toBe(1);
  });

  it("scrive i 200 caratteri di sempre in ogni giro", () => {
    expect(S1_TYPED).toHaveLength(200);
  });

  it("un giro storto non fa cadere la soglia (#293)", () => {
    // Il giro della corsa 44013591428 su main (403 ms, 33 campioni), poi giri
    // ai valori di sempre del runner dello stesso giorno, il rilancio
    // compreso (182 ms, 39 campioni).
    const values = s1Values([round(403, 33), round(182, 39), round(111, 34), round(138, 41), round(142, 44)]);
    expect(values["S1.keyToPaint.p95"]).toBe(142);
    expect(values["S1.keyToPaint.p95"]).toBeLessThanOrEqual(ci["S1.keyToPaint.p95"]);
  });

  it("un editor più lento in ogni giro passa la soglia", () => {
    // I p95 dei job di un ramo che aveva rallentato davvero la scrittura
    // (piano/scrittoio-2, 9–11 novembre 2026, un giro per job).
    const values = s1Values([round(487, 31), round(532, 27), round(474, 28), round(540, 26), round(522, 33)]);
    expect(values["S1.keyToPaint.p95"]).toBe(522);
    expect(values["S1.keyToPaint.p95"]).toBeGreaterThan(ci["S1.keyToPaint.p95"]);
  });

  it("un giro senza tasti misurati toglie il valore invece di ignorare il giro", () => {
    const values = s1Values([round(120), round(0, 0), round(130)]);
    expect(values["S1.keyToPaint.p95"]).toBeNull();
  });

  it("senza giri è un errore del banco, non un valore", () => {
    expect(() => s1Values([])).toThrow();
  });

  it("il referto dice p95 e campioni di ogni giro", () => {
    expect(s1Note([round(403, 33), round(182, 39), round(111, 34)])).toBe("giri: p95 403/182/111 ms, campioni 33/39/34");
  });

  it("dà ogni chiave di S1 che le soglie della CI conoscono", () => {
    const values = s1Values([round(120)]);
    for (const key of Object.keys(ci).filter((k) => k.startsWith("S1."))) {
      expect(values, key).toHaveProperty(key);
    }
  });
});
