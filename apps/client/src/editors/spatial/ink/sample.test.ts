import { describe, expect, it } from "vitest";
import {
  dequantizeSample,
  INK_MAX_SAMPLES,
  type InkSample,
  quantizeAltitude,
  quantizeAzimuth,
  quantizeCoordinate,
  quantizeInk,
  quantizePressure,
  quantizeSample,
  quantizeTime,
} from "./sample";

describe("quantizzazione dell'inchiostro (§5)", () => {
  it("le coordinate sono floor(v × scala + 0,5), con s100 e s10", () => {
    expect(quantizeCoordinate(120.5, 100)).toBe(12050);
    expect(quantizeCoordinate(120.505, 100)).toBe(12051);
    expect(quantizeCoordinate(-0.005, 100)).toBe(0);
    expect(quantizeCoordinate(-0.015, 100)).toBe(-1);
    expect(quantizeCoordinate(-3.25, 10)).toBe(-32);
    expect(quantizeCoordinate(3.25, 10)).toBe(33);
    expect(Object.is(quantizeCoordinate(-0.04, 10), 0)).toBe(true);
  });

  it("la pressione è round(p × 255), portata in 0…255", () => {
    expect(quantizePressure(0)).toBe(0);
    expect(quantizePressure(1)).toBe(255);
    expect(quantizePressure(0.5)).toBe(128);
    expect(quantizePressure(0.51)).toBe(130);
    expect(quantizePressure(1.2)).toBe(255);
    expect(quantizePressure(-0.1)).toBe(0);
  });

  it("tempo, altitudine e azimut sono interi; l'azimut gira in 0…359", () => {
    expect(quantizeTime(8.4)).toBe(8);
    expect(quantizeTime(8.5)).toBe(9);
    expect(quantizeAltitude(45.5)).toBe(46);
    expect(quantizeAltitude(95)).toBe(90);
    expect(quantizeAltitude(-3)).toBe(0);
    expect(quantizeAzimuth(359.4)).toBe(359);
    expect(quantizeAzimuth(359.5)).toBe(0);
    expect(quantizeAzimuth(360)).toBe(0);
    expect(quantizeAzimuth(725)).toBe(5);
    expect(quantizeAzimuth(-90)).toBe(270);
    expect(Object.is(quantizeAzimuth(-360), 0)).toBe(true);
  });

  it("un campione conserva i suoi canali e rifiuta un valore non finito", () => {
    expect(quantizeSample({ x: 1.234, y: -5.678, t: 0 }, 100)).toEqual({ x: 123, y: -568, t: 0 });
    expect(quantizeSample({ x: 1, y: 2, p: 0.25, t: 16.6, a: 52.4, z: 181.6 }, 10))
      .toEqual({ x: 10, y: 20, p: 64, t: 17, a: 52, z: 182 });
    expect(Object.keys(quantizeSample({ x: 1, y: 2, t: 0 }, 100))).toEqual(["x", "y", "t"]);
    expect(() => quantizeSample({ x: Number.NaN, y: 0, t: 0 }, 100)).toThrow(RangeError);
    expect(() => quantizeSample({ x: 0, y: 0, p: Number.POSITIVE_INFINITY, t: 0 }, 100)).toThrow(RangeError);
    expect(() => quantizeSample({ x: 0, y: 0, t: 0, a: 10, z: Number.NaN }, 100)).toThrow(RangeError);
  });

  it("quantizzare ciò che si è dequantizzato restituisce gli stessi interi", () => {
    const samples: InkSample[] = [];
    for (let i = 0; i < 500; i++) {
      // Valori qualunque, anche negativi e con molte cifre.
      const x = Math.sin(i * 1.7) * 4321.123456;
      const y = Math.cos(i * 0.3) * -987.654321;
      samples.push({ x, y, p: (i % 97) / 96, t: i * 7.31, a: (i * 13) % 91, z: (i * 37.7) % 360 });
    }
    for (const scale of [10, 100] as const) {
      const ink = quantizeInk(samples.map((sample, i) => (i === 0 ? { ...sample, t: 0 } : sample)), scale);
      const again = quantizeInk(ink.samples.map((sample) => dequantizeSample(sample, scale)), scale);
      expect(again).toEqual(ink);
    }
  });

  it("un tratto ha da 1 a 10 000 campioni, il primo a t = 0, e gli stessi canali in tutti", () => {
    expect(() => quantizeInk([])).toThrow(RangeError);
    expect(() => quantizeInk([{ x: 0, y: 0, t: 3 }])).toThrow(RangeError);
    expect(() => quantizeInk([{ x: 0, y: 0, p: 0.5, t: 0 }, { x: 1, y: 1, t: 8 }])).toThrow(RangeError);
    expect(() => quantizeInk([{ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 8, a: 40, z: 10 }])).toThrow(RangeError);
    const full = Array.from({ length: INK_MAX_SAMPLES }, (_, i): InkSample => ({ x: i, y: 0, t: i }));
    expect(quantizeInk(full).samples).toHaveLength(INK_MAX_SAMPLES);
    expect(() => quantizeInk([...full, { x: 0, y: 0, t: INK_MAX_SAMPLES }])).toThrow(RangeError);
    expect(quantizeInk([{ x: 1.5, y: 2.5, t: 0 }])).toEqual({ scale: 100, samples: [{ x: 150, y: 250, t: 0 }] });
  });
});
