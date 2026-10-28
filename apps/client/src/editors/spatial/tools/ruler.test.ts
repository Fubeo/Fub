// Il righello (P13): un tratto che comincia vicino a un bordo lo segue, uno
// lontano no; si gira a decimi di grado o a passi di 15°.

import { describe, expect, it } from "vitest";
import { alongEdge, onRuler, onRulerBody, rulerDegrees, rulerEdge, steppedRuler, turnedRuler, type Ruler } from "./ruler";

const FLAT: Ruler = { center: [0, 0], angle: 0 };

describe("il righello", () => {
  it("un punto vicino a un bordo, dentro o fuori, dà la retta del bordo scostata di mezza punta verso fuori", () => {
    expect(rulerEdge(FLAT, [10, 38], 36, 8, 2)).toEqual({ origin: [0, 38], direction: [1, 0] });
    expect(rulerEdge(FLAT, [10, 30], 36, 8, 2)).toEqual({ origin: [0, 38], direction: [1, 0] });
    expect(rulerEdge(FLAT, [10, -40], 36, 8, 2)).toEqual({ origin: [0, -38], direction: [1, 0] });
    // In mezzo, o lontano, niente bordo.
    expect(rulerEdge(FLAT, [10, 0], 36, 8, 2)).toBeNull();
    expect(rulerEdge(FLAT, [10, 60], 36, 8, 2)).toBeNull();
  });

  it("i campioni vanno sul bordo e tengono pressione e tempo", () => {
    const edge = rulerEdge({ center: [0, 0], angle: 90 }, [37, 5], 36, 8, 0)!;
    const sample = alongEdge({ x: 40, y: 25, t: 16, p: 0.4 }, edge);
    expect(sample.x).toBeCloseTo(36);
    expect(sample.y).toBeCloseTo(25);
    expect([sample.t, sample.p]).toEqual([16, 0.4]);
  });

  it("il corpo si prende lontano dai bordi; la rotella prende anche i bordi", () => {
    expect(onRulerBody(FLAT, [0, 20], 36, 8)).toBe(true);
    expect(onRulerBody(FLAT, [0, 30], 36, 8)).toBe(false);
    expect(onRuler(FLAT, [0, 30], 36)).toBe(true);
    expect(onRuler(FLAT, [0, 40], 36)).toBe(false);
  });

  it("si gira a decimi di grado, a passi di 15° e si legge fra 0 e 180", () => {
    expect(turnedRuler(FLAT, 5.04).angle).toBe(5);
    expect(turnedRuler({ center: [0, 0], angle: 178 }, 5).angle).toBe(-177);
    expect(steppedRuler({ center: [0, 0], angle: 7 }, 1).angle).toBe(15);
    expect(steppedRuler({ center: [0, 0], angle: 7 }, -1).angle).toBe(0);
    expect(steppedRuler({ center: [0, 0], angle: 15 }, 1).angle).toBe(30);
    expect(steppedRuler({ center: [0, 0], angle: 15 }, -1).angle).toBe(0);
    expect(rulerDegrees({ center: [0, 0], angle: -30 })).toBe(150);
  });
});
