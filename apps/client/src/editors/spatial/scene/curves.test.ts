// Le curve una alla volta: punti, derivate, divisioni e conversioni si
// confrontano con la curva di partenza, campionata.

import { describe, expect, it } from "vitest";
import { arcCenter, arcToCubics, derivativeAt, lineToCubic, pointAt, quadToCubic, reversed, splitAt, tangentAt, type Curve } from "./curves";
import type { Point } from "./matrix";

const SAMPLES = [0, 0.1, 0.25, 0.5, 0.6, 0.75, 0.9, 1];

function near(a: Point, b: Point, within = 1e-9): void {
  expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${JSON.stringify(a)} invece di ${JSON.stringify(b)}`).toBeLessThanOrEqual(within);
}

const FROM: Point = [1, 2];
const CURVES: readonly Curve[] = [
  { kind: "line", to: [11, -3] },
  { kind: "quad", control: [6, 12], to: [11, -3] },
  { kind: "cubic", c1: [3, 10], c2: [9, -8], to: [11, -3] },
  { kind: "arc", radii: [8, 5], rotation: 30, large: false, sweep: true, to: [11, -3] },
  { kind: "arc", radii: [8, 5], rotation: 30, large: true, sweep: false, to: [11, -3] },
];

describe("le curve una alla volta", () => {
  it("partono da `from` e arrivano a `to`, con la derivata dei punti", () => {
    for (const curve of CURVES) {
      near(pointAt(FROM, curve, 0), FROM);
      near(pointAt(FROM, curve, 1), curve.to);
      for (const t of [0.2, 0.5, 0.8]) {
        const h = 1e-6;
        const a = pointAt(FROM, curve, t - h);
        const b = pointAt(FROM, curve, t + h);
        near(derivativeAt(FROM, curve, t), [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)], 1e-4);
      }
    }
  });

  it("mette un arco nella forma col centro, e ingrandisce i raggi che non bastano", () => {
    const half = arcCenter([0, 0], { kind: "arc", radii: [10, 10], rotation: 0, large: false, sweep: true, to: [20, 0] })!;
    near(half.center, [10, 0]);
    expect(half.delta).toBeCloseTo(Math.PI, 12);
    const small = arcCenter([0, 0], { kind: "arc", radii: [1, 1], rotation: 0, large: false, sweep: false, to: [20, 0] })!;
    near(small.radii, [10, 10]);
    expect(small.delta).toBeCloseTo(-Math.PI, 12);
    // Un raggio nullo è una linea, ed estremi uguali non disegnano niente.
    expect(arcCenter([0, 0], { kind: "arc", radii: [0, 4], rotation: 0, large: false, sweep: true, to: [20, 0] })).toBeNull();
    expect(arcCenter([3, 3], { kind: "arc", radii: [4, 4], rotation: 0, large: false, sweep: true, to: [3, 3] })).toBeNull();
    near(pointAt([0, 0], { kind: "arc", radii: [0, 4], rotation: 0, large: false, sweep: true, to: [20, 0] }, 0.25), [5, 0]);
  });

  it("divide ogni curva in due che si vedono come lei", () => {
    for (const curve of CURVES) {
      for (const at of [0.3, 0.5]) {
        const [first, second] = splitAt(FROM, curve, at);
        const middle = pointAt(FROM, curve, at);
        near(first.to, middle);
        near(second.to, curve.to);
        for (const t of SAMPLES) {
          near(pointAt(FROM, first, t), pointAt(FROM, curve, at * t), 1e-9);
          near(pointAt(middle, second, t), pointAt(FROM, curve, at + (1 - at) * t), 1e-9);
        }
      }
    }
  });

  it("divide un arco coi raggi che servono davvero, e il verso giusto per ogni metà", () => {
    const arc: Curve = { kind: "arc", radii: [1, 1], rotation: 0, large: true, sweep: true, to: [20, 0] };
    const [first, second] = splitAt([0, 0], arc, 0.5);
    expect(first).toMatchObject({ kind: "arc", radii: [10, 10], large: false, sweep: true });
    expect(second).toMatchObject({ kind: "arc", radii: [10, 10], large: false, sweep: true, to: [20, 0] });
    near(first.to, [10, -10]);
    // Tre quarti di giro: la prima metà, di 135 gradi, resta corta.
    const wide: Curve = { kind: "arc", radii: [10, 10], rotation: 0, large: true, sweep: true, to: [10, 10] };
    const [a, b] = splitAt([0, 0], wide, 0.8);
    expect([a.kind === "arc" && a.large, b.kind === "arc" && b.large]).toEqual([true, false]);
  });

  it("fa di una linea e di una quadratica le cubiche che sono", () => {
    const line = lineToCubic(FROM, [11, -3]);
    const quad: Extract<Curve, { readonly kind: "quad" }> = { kind: "quad", control: [6, 12], to: [11, -3] };
    for (const t of SAMPLES) {
      near(pointAt(FROM, line, t), pointAt(FROM, CURVES[0]!, t));
      near(pointAt(FROM, quadToCubic(FROM, quad), t), pointAt(FROM, quad, t));
    }
  });

  it("fa di un arco una cubica per quarto di giro, entro tre decimillesimi del raggio", () => {
    const arc: Extract<Curve, { readonly kind: "arc" }> = { kind: "arc", radii: [100, 60], rotation: 20, large: true, sweep: false, to: [150, 40] };
    const center = arcCenter([0, 0], arc)!;
    const cubics = arcToCubics([0, 0], arc);
    expect(cubics).toHaveLength(Math.ceil(Math.abs(center.delta) / (Math.PI / 2)));
    expect(cubics[cubics.length - 1]!.to).toEqual([150, 40]);
    let from: Point = [0, 0];
    for (const cubic of cubics) {
      for (const t of SAMPLES) {
        // La distanza dall'ellisse, misurata nel suo riferimento: il punto
        // portato sul cerchio unitario.
        const [x, y] = pointAt(from, cubic, t);
        const dx = x - center.center[0];
        const dy = y - center.center[1];
        const ex = (center.cos * dx + center.sin * dy) / center.radii[0];
        const ey = (-center.sin * dx + center.cos * dy) / center.radii[1];
        expect(Math.abs(Math.hypot(ex, ey) - 1)).toBeLessThan(3e-4);
      }
      from = cubic.to;
    }
    expect(arcToCubics([0, 0], { ...arc, radii: [0, 5] })).toEqual([{ kind: "line", to: [150, 40] }]);
    expect(arcToCubics([150, 40], arc)).toEqual([]);
  });

  it("dà il verso di partenza e d'arrivo, saltando le maniglie sul nodo", () => {
    const cubic: Curve = { kind: "cubic", c1: [0, 0], c2: [10, 0], to: [10, 10] };
    near(tangentAt([0, 0], cubic, false)!, [1, 0]);
    near(tangentAt([0, 0], cubic, true)!, [0, 1]);
    const retracted: Curve = { kind: "cubic", c1: [0, 0], c2: [10, 10], to: [10, 10] };
    near(tangentAt([0, 0], retracted, false)!, [Math.SQRT1_2, Math.SQRT1_2]);
    near(tangentAt([0, 0], retracted, true)!, [Math.SQRT1_2, Math.SQRT1_2]);
    const arc: Curve = { kind: "arc", radii: [10, 10], rotation: 0, large: false, sweep: true, to: [20, 0] };
    near(tangentAt([0, 0], arc, false)!, [0, -1]);
    near(tangentAt([0, 0], arc, true)!, [0, 1]);
    expect(tangentAt([4, 4], { kind: "cubic", c1: [4, 4], c2: [4, 4], to: [4, 4] }, false)).toBeNull();
  });

  it("percorre ogni curva al contrario", () => {
    for (const curve of CURVES) {
      const back = reversed(FROM, curve);
      expect(back.to).toEqual(FROM);
      for (const t of SAMPLES) near(pointAt(curve.to, back, t), pointAt(FROM, curve, 1 - t), 1e-9);
    }
  });
});
