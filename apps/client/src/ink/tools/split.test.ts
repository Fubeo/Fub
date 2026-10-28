import { describe, expect, it } from "vitest";
import { parseInkBrush, parseBrush } from "../brush";
import type { InkSample } from "../sample";
import { cutBrush, splitInk } from "./split";

// La gomma precisa: i pezzi che restano di un tratto, coi loro campioni.

/// Un tratto dritto da (0, 0) a (100, 0), un campione ogni 10 unità e 10 ms.
const line: InkSample[] = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0, t: i * 10, p: 0.5 }));

describe("splitInk", () => {
  it("un cammino che non tocca il tratto lo lascia com'è", () => {
    expect(splitInk(line, [[50, 30], [60, 30]], 5)).toBeNull();
    expect(splitInk(line, [], 5)).toBeNull();
  });

  it("un taglio fa due pezzi, coi bordi dove passa il cerchio", () => {
    const pieces = splitInk(line, [[50, -20], [50, 20]], 5)!;
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces as [NonNullable<typeof pieces>[0], NonNullable<typeof pieces>[0]];
    expect(left.cutStart).toBe(false);
    expect(left.cutEnd).toBe(true);
    expect(left.samples[left.samples.length - 1]!.x).toBeCloseTo(45, 3);
    expect(right.cutStart).toBe(true);
    expect(right.cutEnd).toBe(false);
    expect(right.samples[0]!.x).toBeCloseTo(55, 3);
    // Il tempo riparte da zero, e `offset` dice da dove.
    expect(left.offset).toBe(0);
    expect(right.samples[0]!.t).toBe(0);
    expect(right.offset).toBeCloseTo(55, 3);
    expect(right.samples[right.samples.length - 1]!.t).toBeCloseTo(45, 3);
    // La pressione si interpola, i campioni lontani restano quelli.
    expect(right.samples[0]!.p).toBeCloseTo(0.5, 9);
    expect(right.samples.slice(1).map((s) => s.x)).toEqual([60, 70, 80, 90, 100]);
  });

  it("due tagli fanno tre pezzi", () => {
    const pieces = splitInk(line, [[25, -20], [25, 20], [75, 20], [75, -20]], 3)!;
    expect(pieces.map((piece) => [piece.cutStart, piece.cutEnd])).toEqual([[false, true], [true, true], [true, false]]);
  });

  it("taglia anche fra due campioni lontani", () => {
    const sparse: InkSample[] = [{ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 100 }];
    const pieces = splitInk(sparse, [[50, 0]], 4)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.samples.map((s) => s.x)[1]).toBeCloseTo(46, 3);
    expect(pieces[1]!.samples[0]!.x).toBeCloseTo(54, 3);
  });

  it("un tratto tutto dentro sparisce, e così un capo tagliato fino al bordo", () => {
    expect(splitInk(line, [[0, 0], [100, 0]], 5)).toEqual([]);
    const pieces = splitInk(line, [[100, 0]], 25)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.cutEnd).toBe(true);
    expect(pieces[0]!.samples[pieces[0]!.samples.length - 1]!.x).toBeCloseTo(75, 3);
  });

  it("un tratto di un punto resta o sparisce intero", () => {
    const dot: InkSample[] = [{ x: 10, y: 10, t: 0 }];
    expect(splitInk(dot, [[10, 12]], 5)).toEqual([]);
    expect(splitInk(dot, [[30, 30]], 5)).toBeNull();
  });

  it("l'inclinazione e l'azimut vengono dal campione più vicino", () => {
    const tilted: InkSample[] = [{ x: 0, y: 0, t: 0, a: 40, z: 10 }, { x: 100, y: 0, t: 100, a: 60, z: 90 }];
    const [, right] = splitInk(tilted, [[30, 0]], 5)!;
    expect(right!.samples[0]).toMatchObject({ a: 40, z: 10 });
  });
});

describe("cutBrush", () => {
  it("ai tagli niente rastremazione, ai capi veri resta", () => {
    const brush = parseBrush("pf1 size=4 taperStart=8 taperEnd=12");
    expect(cutBrush(brush, { cutStart: true, cutEnd: false })).toMatchObject({ taperStart: 0, taperEnd: 12 });
    expect(cutBrush(brush, { cutStart: false, cutEnd: true })).toMatchObject({ taperStart: 8, taperEnd: 0 });
    const nib = parseInkBrush("nib1 size=10");
    expect(cutBrush(nib, { cutStart: true, cutEnd: true })).toBe(nib);
  });
});
