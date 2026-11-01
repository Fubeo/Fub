// La spina di un tratto a penna: pochi nodi lungo i campioni, e
// l'inchiostro che la segue quando i nodi cambiano, con pressione, tempo e
// tremolio della mano.

import { describe, expect, it } from "vitest";
import { createInk, inkLength, inkPoint, type Ink } from "../ink/codec";
import { pointAt } from "../scene/curves";
import type { Point } from "../scene/matrix";
import { curveAt, type Subpath } from "./nodes";
import { fitSpine, placePoint, spineTolerance, type Spine } from "./spine";

/// Un inchiostro coi punti `points`, la pressione che sale e il tempo a
/// passi di 8 ms; con `tilt`, anche altitudine e azimut.
function inkOf(points: readonly Point[], tilt: number | null = null): Ink {
  const channels = tilt === null ? "xypt" : "xyptaz";
  const values: number[] = [];
  points.forEach(([x, y], i) => {
    values.push(Math.round(x * 100), Math.round(y * 100), Math.min(255, 40 + i), i * 8);
    if (tilt !== null) values.push(60, tilt);
  });
  return createInk(100, channels, values);
}

const pointsOf = (ink: Ink): Point[] => Array.from({ length: inkLength(ink) }, (_, i) => inkPoint(ink, i));
const spineOf = (ink: Ink, tolerance = 1): Spine => fitSpine(pointsOf(ink), tolerance);

/// La distanza di `p` dalla spina, sulla spezzata fitta.
function off(sub: Subpath, p: Point): number {
  let best = Infinity;
  sub.links.forEach((_, i) => {
    const { from, curve } = curveAt(sub, i);
    for (let k = 0; k <= 400; k++) {
      const q = pointAt(from, curve, k / 400);
      best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
  });
  return best;
}

/// Una linea da (0, 0) a (100, 0) con la mano che trema di ±0,3.
const shaky = (): Point[] => Array.from({ length: 101 }, (_, i) => [i, i % 2 === 0 ? 0.3 : -0.3]);

/// Un quarto di cerchio di raggio 100.
const arc = (): Point[] => Array.from({ length: 181 }, (_, i) => {
  const a = (i / 180) * (Math.PI / 2);
  return [100 * Math.cos(a), 100 * Math.sin(a)];
});

/// Una V: giù da (0, 0) a (50, 80), su fino a (100, 0).
const vee = (): Point[] => [
  ...Array.from({ length: 50 }, (_, i): Point => [i, i * 1.6]),
  ...Array.from({ length: 51 }, (_, i): Point => [50 + i, 80 - i * 1.6]),
];

describe("la spina dai campioni", () => {
  it("di un tratto dritto è una linea fra i capi", () => {
    const spine = spineOf(inkOf(shaky()));
    expect(spine.sub.links).toEqual([{ kind: "line" }]);
    expect(spine.sub.nodes).toEqual([[0, 0.3], [100, 0.3]]);
    expect(spine.sub.closed).toBe(false);
  });

  it("di una curva liscia ha pochi nodi, e i campioni le stanno vicini", () => {
    const ink = inkOf(arc());
    const spine = spineOf(ink, 0.5);
    expect(spine.sub.nodes.length).toBeLessThanOrEqual(3);
    expect(spine.sub.links.every((link) => link.kind === "cubic")).toBe(true);
    for (const p of pointsOf(ink)) expect(off(spine.sub, p)).toBeLessThanOrEqual(0.5);
  });

  it("dove la mano gira di colpo ha uno spigolo, e linee dritte ai lati", () => {
    const spine = spineOf(inkOf(vee()), 1);
    expect(spine.sub.nodes).toEqual([[0, 0], [50, 80], [100, 0]]);
    expect(spine.sub.links).toEqual([{ kind: "line" }, { kind: "line" }]);
  });

  it("non vede spigoli nel tremolio fitto della mano", () => {
    // Un'onda di 300 unità in 3000 campioni, ciascuno spostato a caso fino
    // a 0,4 per verso: il tremolio è dieci volte il passo.
    let seed = 7;
    const shake = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.8;
    };
    const points = Array.from({ length: 3000 }, (_, i): Point => {
      const x = i / 10;
      return [x + shake(), 30 * Math.sin(x / 30) + shake()];
    });
    const spine = fitSpine(points, 2);
    expect(spine.sub.nodes.length).toBeLessThanOrEqual(8);
    expect(spine.sub.links.every((link) => link.kind === "cubic")).toBe(true);
    for (const p of points) expect(off(spine.sub, p)).toBeLessThanOrEqual(2.05);
  });

  it("dà a ogni campione un posto e lo scarto da lì", () => {
    const ink = inkOf(shaky());
    const spine = spineOf(ink);
    expect(spine.places).toHaveLength(101);
    pointsOf(ink).forEach((p, i) => {
      const at = placePoint(spine.sub, spine.places[i]!);
      expect(at[0] + spine.offsets[i]![0]).toBeCloseTo(p[0], 9);
      expect(at[1] + spine.offsets[i]![1]).toBeCloseTo(p[1], 9);
    });
    expect(spine.places[0]).toEqual({ link: 0, t: 0 });
    expect(spine.places[100]).toEqual({ link: 0, t: 1 });
  });

  it("di un punto solo è quel nodo", () => {
    const spine = fitSpine([[5, 5], [5, 5]], 1);
    expect(spine.sub).toEqual({ nodes: [[5, 5]], links: [], closed: false });
    expect(spine.places).toEqual([{ link: 0, t: 0 }, { link: 0, t: 0 }]);
  });

  it("è la stessa per lo stesso inchiostro", () => {
    const ink = inkOf(arc());
    expect(spineOf(ink, 0.5)).toEqual(spineOf(ink, 0.5));
  });

  it("si scosta di metà dello spessore del pennello, e mai meno di mezza unità", () => {
    expect(spineTolerance(16)).toBe(8);
    expect(spineTolerance(0.4)).toBe(0.5);
  });
});
