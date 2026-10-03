import { describe, expect, it } from "vitest";
import { formatLeft, formatMs, LatencyWindow } from "./stats";

describe("le latenze della sessione live", () => {
  it("dà mediana e 95° delle ultime misure", () => {
    const window = new LatencyWindow();
    expect(window.quantile(0.5)).toBeNull();
    for (let ms = 1; ms <= 100; ms++) window.add(ms);
    expect(window.quantile(0.5)).toBe(50);
    expect(window.quantile(0.95)).toBe(95);
  });

  it("vale zero sotto zero, ignora ciò che non è un numero e dimentica le più vecchie", () => {
    const window = new LatencyWindow();
    window.add(-4);
    window.add(Number.NaN);
    expect(window.count).toBe(1);
    expect(window.quantile(0.5)).toBe(0);
    for (let i = 0; i < 512; i++) window.add(200);
    expect(window.count).toBe(512);
    expect(window.quantile(0)).toBe(200);
  });

  it("scrive il tempo che resta come un orologio, e i millisecondi con l'unità", () => {
    expect(formatLeft(245_000)).toBe("4:05");
    expect(formatLeft(41_200)).toBe("0:42");
    expect(formatLeft(-5)).toBe("0:00");
    expect(formatMs(23.6, "it")).toMatch(/^24\s?ms$/);
  });
});
