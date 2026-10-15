import { describe, expect, it } from "vitest";
import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { fitCubic, orthogonal, runningLengths, sampled, smoothSegments } from "./curves";

/// Il punto della cubica a `t`, per controllare dove passa.
function cubicAt([p0, c1, c2, p3]: readonly [Point, Point, Point, Point], t: number): Point {
  const s = 1 - t;
  const [a, b, c, d] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

describe("smoothSegments", () => {
  it("passa per i punti, con le tangenti verso i vicini e ai capi verso il punto accanto", () => {
    const segments = smoothSegments([[0, 0], [10, 0], [20, 10]], false);
    expect(segments.map((segment) => segment.kind)).toEqual(["move", "cubic", "cubic"]);
    const [, first, second] = segments as [Segment, Extract<Segment, { kind: "cubic" }>, Extract<Segment, { kind: "cubic" }>];
    expect(first.to).toEqual([10, 0]);
    expect(second.to).toEqual([20, 10]);
    // Al primo capo la tangente va verso il secondo punto.
    expect(first.c1).toEqual([10 / 6, 0]);
    // Nel punto di mezzo le due tangenti sono la stessa, parallela alla
    // corda fra i vicini: la curva non fa spigoli.
    expect(first.c2[0] - 10).toBeCloseTo(-(second.c1[0] - 10));
    expect(first.c2[1]).toBeCloseTo(-second.c1[1]);
    expect(second.c1[0] - 10).toBeCloseTo(20 / 6);
    expect(second.c1[1]).toBeCloseTo(10 / 6);
  });

  it("su punti allineati resta una linea dritta", () => {
    const segments = smoothSegments([[0, 0], [10, 10], [30, 30]], false);
    for (const segment of segments) {
      if (segment.kind !== "cubic") continue;
      expect(segment.c1[0]).toBeCloseTo(segment.c1[1]);
      expect(segment.c2[0]).toBeCloseTo(segment.c2[1]);
    }
  });

  it("chiusa, gira attorno e torna al primo punto", () => {
    const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const segments = smoothSegments(square, true);
    expect(segments.map((segment) => segment.kind)).toEqual(["move", "cubic", "cubic", "cubic", "cubic", "close"]);
    expect(segments[4]!.kind === "cubic" && segments[4]!.to).toEqual([0, 0]);
    // Il primo tratto parte con la tangente dall'ultimo punto al secondo.
    expect(segments[1]!.kind === "cubic" && segments[1]!.c1).toEqual([10 / 6, -10 / 6]);
  });
});

describe("sampled", () => {
  it("dà i punti di ogni tratto e dove ognuno finisce", () => {
    const { points, ends } = sampled(
      [
        { kind: "move", to: [0, 0] },
        { kind: "line", to: [8, 0] },
        { kind: "cubic", c1: [8, 4], c2: [8, 4], to: [8, 8] },
        { kind: "close" },
      ],
      4,
    );
    expect(points.slice(0, 5)).toEqual([[0, 0], [2, 0], [4, 0], [6, 0], [8, 0]]);
    expect(points).toHaveLength(9);
    expect(points[8]).toEqual([8, 8]);
    expect(ends).toEqual([4, 8]);
  });

  it("salta i tratti prima di un punto di partenza", () => {
    const { points, ends } = sampled([{ kind: "line", to: [5, 5] }, { kind: "move", to: [1, 1] }, { kind: "line", to: [3, 1] }], 2);
    expect(points).toEqual([[1, 1], [2, 1], [3, 1]]);
    expect(ends).toEqual([2]);
  });
});

describe("runningLengths", () => {
  it("somma le lunghezze dall'inizio", () => {
    expect(runningLengths([[0, 0], [3, 4], [3, 10]])).toEqual([0, 5, 11]);
    expect(runningLengths([[7, 7]])).toEqual([0]);
  });
});

describe("fitCubic", () => {
  it("ritrova la cubica da cui vengono i campioni", () => {
    const cubic: [Point, Point, Point, Point] = [[0, 0], [30, 80], [90, 80], [120, 0]];
    const samples = Array.from({ length: 41 }, (_, i) => cubicAt(cubic, i / 40));
    const fitted = fitCubic(samples);
    expect(fitted.error).toBeLessThanOrEqual(0.01);
    expect(fitted.points[0]).toEqual([0, 0]);
    expect(fitted.points[3]).toEqual([120, 0]);
    for (let i = 1; i < 3; i++) {
      expect(fitted.points[i]![0]).toBeCloseTo(cubic[i]![0], 1);
      expect(fitted.points[i]![1]).toBeCloseTo(cubic[i]![1], 1);
    }
  });

  it("dice quanto sbaglia quando una cubica sola non basta", () => {
    // Un'onda con due gobbe: una cubica sola non la segue.
    const samples = Array.from({ length: 61 }, (_, i): Point => [i * 2, 20 * Math.sin((i / 60) * 4 * Math.PI)]);
    expect(fitCubic(samples).error).toBeGreaterThan(5);
  });

  it("con meno di tre punti diversi dà la linea dritta", () => {
    expect(fitCubic([[0, 0], [0, 0], [30, 60]])).toEqual({ points: [[0, 0], [10, 20], [20, 40], [30, 60]], error: 0 });
  });
});

describe("orthogonal", () => {
  it("riconosce i tratti orizzontali e verticali, a meno della tolleranza", () => {
    expect(orthogonal([[0, 0], [50, 0.4], [50, 80]])).toBe(true);
    expect(orthogonal([[0, 0], [50, 1], [50, 80]])).toBe(false);
    expect(orthogonal([[0, 0], [50, 1], [50, 80]], 2)).toBe(true);
    expect(orthogonal([[0, 0]])).toBe(true);
  });
});
