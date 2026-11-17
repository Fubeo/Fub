// I valori dello scenario L1 dai suoi giri (`l1Values` in `canvas.mjs`): i p95
// e l'istanza sono la mediana dei giri, così un giro con due intoppi del
// runner, o una prima compilazione lenta, non fa cadere la soglia (#388,
// #434), mentre un nucleo più lento in ogni giro sì.
import { describe, expect, it } from "vitest";

import { L1_ROUNDS, l1Values, type CanvasReport } from "./canvas.mjs";
import budgets from "./budgets.json";

const stats = (p95: number) => ({ count: 20, p50: 1, p95, max: p95 + 1 });

/// Un giro coi p95 dati per la lavagna piccola e la grande; `cold` si somma
/// all'istanza, alla prima apertura e al primo commit.
function round(open50: number, open2000 = 18, commit50 = 1, commit2000 = 6, cold = 0, instance = 10): CanvasReport {
  return {
    instanceMs: instance + cold,
    boards: [
      { size: 50, textBytes: 16_348, firstOpenMs: 9 + cold, open: stats(open50), firstCommitMs: 3 + cold, commit: stats(commit50) },
      { size: 2000, textBytes: 678_692, firstOpenMs: 25 + cold, open: stats(open2000), firstCommitMs: 7 + cold, commit: stats(commit2000) },
    ],
  };
}

const ci: Record<string, number> = budgets.ci;

describe("i valori di L1 dai giri", () => {
  it("fa un numero dispari di giri, perché la mediana sia un giro vero", () => {
    expect(L1_ROUNDS).toBeGreaterThanOrEqual(3);
    expect(L1_ROUNDS % 2).toBe(1);
  });

  it("un giro storto non sposta il p95 della lavagna piccola", () => {
    // Un giro con due intoppi lunghi, gli altri ai 2–5 ms di sempre del runner.
    const values = l1Values([round(30), round(3), round(5), round(2), round(4)]);
    expect(values["L1.open.50.p95"]).toBe(4);
    expect(values["L1.open.50.p95"]).toBeLessThanOrEqual(ci["L1.open.50.p95"]);
  });

  it("un nucleo più lento in ogni giro passa la soglia", () => {
    const slow = [24, 23, 26, 25, 30].map((ms) => round(ms));
    const values = l1Values(slow);
    expect(values["L1.open.50.p95"]).toBe(25);
    expect(values["L1.open.50.p95"]).toBeGreaterThan(ci["L1.open.50.p95"]);
  });

  it("i p95 di open e commit sono la mediana dei giri, per ogni lavagna", () => {
    const values = l1Values([round(1, 30, 9, 20), round(2, 10, 1, 4), round(3, 20, 2, 5)]);
    expect(values).toMatchObject({
      "L1.open.50.p95": 2,
      "L1.open.2000.p95": 20,
      "L1.commit.50.p95": 2,
      "L1.commit.2000.p95": 5,
    });
  });

  it("prima istanza, prima apertura e primo commit sono del primo giro, il solo a freddo", () => {
    const values = l1Values([round(2, 18, 1, 6, 20), round(2), round(2)]);
    expect(values).toMatchObject({
      "L1.istanza.prima": 30,
      "L1.open.50.prima": 29,
      "L1.commit.50.primo": 23,
      "L1.open.2000.prima": 45,
      "L1.commit.2000.primo": 27,
    });
  });

  it("una prima compilazione lenta non fa cadere l'istanza (#434)", () => {
    // I giri del job 43989623414: la prima compilazione a 90 ms, gli altri
    // ai 13–24 ms di sempre del runner.
    const values = l1Values([90, 24, 22, 16, 13].map((ms) => round(2, 18, 1, 6, 0, ms)));
    expect(values["L1.istanza"]).toBe(22);
    expect(values["L1.istanza"]).toBeLessThanOrEqual(ci["L1.istanza"]);
    expect(values["L1.istanza.prima"]).toBe(90);
    // La prima compilazione resta nel referto, senza soglia.
    expect(ci["L1.istanza.prima"]).toBeUndefined();
  });

  it("un modulo che compila tre volte più lento in ogni giro fa cadere l'istanza", () => {
    // Tre volte i giri di un job mediano del runner (mediana 14 ms).
    const values = l1Values([17, 13, 14, 12, 15].map((ms) => round(2, 18, 1, 6, 0, ms * 3)));
    expect(values["L1.istanza"]).toBe(42);
    expect(values["L1.istanza"]).toBeGreaterThan(ci["L1.istanza"]);
  });

  it("dà ogni chiave di L1 che le soglie della CI conoscono", () => {
    const values = l1Values([round(2)]);
    for (const key of Object.keys(ci).filter((k) => k.startsWith("L1."))) {
      expect(typeof values[key], key).toBe("number");
    }
  });

  it("senza giri, o con un giro senza una lavagna, si ferma", () => {
    expect(() => l1Values([])).toThrow();
    const partial: CanvasReport = { instanceMs: 10, boards: [round(2).boards[0]] };
    expect(() => l1Values([round(2), partial])).toThrow(/2000 schede/);
  });
});
