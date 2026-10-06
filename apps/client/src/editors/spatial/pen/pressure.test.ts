import { describe, expect, it } from "vitest";
import { curvePath, DEFAULT_CURVE, isDefaultCurve, pressureCurve, validCurve } from "./pressure";

describe("la curva della pressione", () => {
  it("di serie lascia la pressione com'è", () => {
    const apply = pressureCurve(DEFAULT_CURVE);
    for (const p of [0, 0.1, 0.5, 0.93, 1]) expect(apply(p)).toBeCloseTo(p, 12);
    expect(isDefaultCurve(DEFAULT_CURVE)).toBe(true);
    expect(isDefaultCurve({ ...DEFAULT_CURVE, soft: 0.2 })).toBe(false);
  });

  it("morbida dà molto a una pressione leggera, dura ne chiede di più", () => {
    const soft = pressureCurve({ soft: 1, min: 0, full: 1 });
    const hard = pressureCurve({ soft: -1, min: 0, full: 1 });
    expect(soft(0.125)).toBeCloseTo(0.5, 12);
    expect(hard(0.5)).toBeCloseTo(0.125, 12);
    expect(soft(1)).toBe(1);
    expect(hard(1)).toBe(1);
  });

  it("il minimo tiene il tocco leggero, il pieno arriva prima della fine della corsa", () => {
    const apply = pressureCurve({ soft: 0, min: 0.2, full: 0.8 });
    expect(apply(0)).toBeCloseTo(0.2, 12);
    expect(apply(0.4)).toBeCloseTo(0.6, 12);
    expect(apply(0.8)).toBe(1);
    expect(apply(1)).toBe(1);
  });

  it("cresce sempre, e resta fra 0 e 1 anche fuori dall'intervallo", () => {
    const apply = pressureCurve({ soft: -0.6, min: 0.1, full: 0.7 });
    let last = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const value = apply(i / 100);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    expect(apply(-1)).toBeCloseTo(0.1, 12);
    expect(apply(2)).toBe(1);
  });

  it("accetta solo tre numeri nei loro intervalli", () => {
    expect(validCurve({ soft: 0.5, min: 0.1, full: 0.9 })).toEqual({ soft: 0.5, min: 0.1, full: 0.9 });
    expect(validCurve({ soft: 2, min: 0, full: 1 })).toBeNull();
    expect(validCurve({ soft: 0, min: 0.6, full: 1 })).toBeNull();
    expect(validCurve({ soft: 0, min: 0, full: 0.4 })).toBeNull();
    expect(validCurve({ soft: Number.NaN, min: 0, full: 1 })).toBeNull();
    expect(validCurve({ soft: 0, min: 0 })).toBeNull();
    expect(validCurve(null)).toBeNull();
    expect(validCurve("morbida")).toBeNull();
  });

  it("si disegna come un tracciato nel riquadro, dal basso a sinistra", () => {
    expect(curvePath(DEFAULT_CURVE, 100, 50, 2)).toBe("M0 50L50 25L100 0");
    expect(curvePath({ soft: 0, min: 0.5, full: 0.5 }, 100, 50, 2)).toBe("M0 25L50 0L100 0");
  });
});
