// La spina di un tratto a penna: pochi nodi lungo i campioni, e
// l'inchiostro che la segue quando i nodi cambiano, con pressione, tempo e
// tremolio della mano.

import { describe, expect, it } from "vitest";
import { createInk, inkChannel, inkLength, inkPoint, type Ink } from "../ink/codec";
import { pointAt } from "../scene/curves";
import type { Point } from "../scene/matrix";
import { curveAt, deleteNodes, insertNode, moveNodes, inferred, type Subpath } from "./nodes";
import { fitSpine, followedInk, movedPlaces, placePoint, spineMoves, spineTolerance, type Spine } from "./spine";

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
const column = (ink: Ink, letter: string): number[] => {
  const j = inkChannel(ink, letter)!;
  return Array.from({ length: inkLength(ink) }, (_, i) => ink.values[i * ink.channels.length + j]!);
};

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

describe("l'inchiostro che segue la spina", () => {
  const sparse = { dense: false, gap: 1 } as const;
  const dense = { dense: true, gap: 1 } as const;

  it("resta com'è se la spina non cambia", () => {
    for (const points of [shaky(), arc(), vee()]) {
      const ink = inkOf(points);
      const spine = spineOf(ink);
      expect(followedInk(ink, spine, spine.sub, null, dense)!.ink).toEqual(ink);
    }
  });

  it("resta com'è quando un nodo nuovo divide un segmento", () => {
    const ink = inkOf(arc());
    const spine = spineOf(ink, 0.5);
    const edited = insertNode([spine.sub], 0, 0, 0.4);
    const out = followedInk(ink, spine, edited.subs[0]!, spineMoves(edited.moved), dense)!;
    expect(out.ink).toEqual(ink);
    expect(out.spine.sub.nodes).toHaveLength(spine.sub.nodes.length + 1);
  });

  it("porta i campioni col nodo spostato, con il tremolio, la pressione e il tempo", () => {
    const ink = inkOf(shaky());
    const spine = spineOf(ink);
    const moved = moveNodes([spine.sub], new Set(["0:1"]), [0, 100], inferred([spine.sub]));
    const out = followedInk(ink, spine, moved[0]!, null, sparse)!;
    expect(column(out.ink, "p")).toEqual(column(ink, "p"));
    expect(column(out.ink, "t")).toEqual(column(ink, "t"));
    // La linea va ora da (0, 0,3) a (100, 100,3), girata di 45 gradi: il
    // tremolio le resta di traverso.
    const k = 0.6 * Math.SQRT1_2;
    pointsOf(out.ink).forEach(([x, y], i) => {
      const odd = i % 2 === 1;
      expect(x).toBeCloseTo(i + (odd ? k : 0), 1);
      expect(y).toBeCloseTo(0.3 + i - (odd ? k : 0), 1);
    });
  });

  it("gira l'azimut quanto gira la spina", () => {
    const ink = inkOf(shaky(), 10);
    const spine = spineOf(ink);
    // La fine da (100, 0,3) a (-100, 100,3): la linea gira di 135 gradi.
    const moved = moveNodes([spine.sub], new Set(["0:1"]), [-200, 100], inferred([spine.sub]));
    const out = followedInk(ink, spine, moved[0]!, null, sparse)!;
    expect(new Set(column(out.ink, "z"))).toEqual(new Set([145]));
    expect(new Set(column(out.ink, "a"))).toEqual(new Set([60]));
  });

  it("riceve campioni in mezzo dove la spina si allunga, coi valori di mezzo", () => {
    const ink = inkOf(vee());
    const spine = spineOf(ink);
    // L'ultimo nodo va lontano: il secondo segmento si allunga quattro volte.
    const far: Point = [50 + 4 * 50, 80 - 4 * 80];
    const moved = moveNodes([spine.sub], new Set(["0:2"]), [far[0] - 100, far[1]], inferred([spine.sub]));
    const out = followedInk(ink, spine, moved[0]!, null, dense)!;
    expect(inkLength(out.ink)).toBeGreaterThan(inkLength(ink) + 100);
    const points = pointsOf(out.ink);
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])).toBeLessThan(2 * 1.9);
    }
    // Il tempo e la pressione crescono senza salti all'indietro.
    const times = column(out.ink, "t");
    const pressures = column(out.ink, "p");
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
      expect(pressures[i]!).toBeGreaterThanOrEqual(pressures[i - 1]!);
    }
    expect(points[points.length - 1]![0]).toBeCloseTo(far[0], 1);
    expect(points[points.length - 1]![1]).toBeCloseTo(far[1], 1);
    // E la spina nuova sa dove sta ciascuno.
    expect(out.spine.places).toHaveLength(inkLength(out.ink));
  });

  it("senza campioni in mezzo, quando la pressione è simulata", () => {
    const ink = inkOf(vee());
    const spine = spineOf(ink);
    const moved = moveNodes([spine.sub], new Set(["0:2"]), [100, -240], inferred([spine.sub]));
    expect(inkLength(followedInk(ink, spine, moved[0]!, null, sparse)!.ink)).toBe(inkLength(ink));
  });

  it("perde i campioni oltre un capo eliminato, e il tempo riparte da zero", () => {
    const ink = inkOf(vee());
    const spine = spineOf(ink);
    const edited = deleteNodes([spine.sub], new Set(["0:0"]));
    const out = followedInk(ink, spine, edited.subs[0]!, spineMoves(edited.moved), dense)!;
    // Restano i campioni dello spigolo in poi.
    expect(inkLength(out.ink)).toBe(51);
    expect(pointsOf(out.ink)[0]).toEqual([50, 80]);
    expect(column(out.ink, "t")[0]).toBe(0);
    expect(column(out.ink, "p")[0]).toBe(90);
  });

  it("porta i campioni di due segmenti uniti in proporzione alla lunghezza", () => {
    const spine = spineOf(inkOf(vee()));
    const edited = deleteNodes([spine.sub], new Set(["0:1"]));
    const places = movedPlaces(spine.sub, edited.subs[0]!, spineMoves(edited.moved), spine.places);
    expect(places[0]).toEqual({ link: 0, t: 0 });
    expect(places[100]!.link).toBe(0);
    expect(places[100]!.t).toBeCloseTo(1, 9);
    // Lo spigolo era a metà della lunghezza.
    expect(places[50]!.t).toBeCloseTo(0.5, 9);
    for (let i = 1; i < places.length; i++) expect(places[i]!.t).toBeGreaterThan(places[i - 1]!.t);
  });
});
