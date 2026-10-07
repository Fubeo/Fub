// La geometria: gli stessi casi dei test di unità di `geometry.rs` in
// `fub-scene`, la grammatica dei path e il rettangolo esatto delle curve
// trasformate.

import { describe, expect, it } from "vitest";
import { BoundsBuilder, ellipsePath, flatten, parsePath, rectPath, Track, winding, type Bounds } from "./geometry";
import { IDENTITY, rotate, translate, type Matrix, type Point } from "./matrix";

function polygons(d: string, m: Matrix): Point[][] {
  return flatten(parsePath(d)!, m);
}

function bounds(d: string, m: Matrix): Bounds {
  const b = new BoundsBuilder();
  b.path(parsePath(d)!, m);
  return b.finish()!;
}

function close(a: Bounds, min: Point, max: Point): void {
  const ok = [0, 1].every((i) => Math.abs(a.min[i]! - min[i]!) < 1e-9 && Math.abs(a.max[i]! - max[i]!) < 1e-9);
  expect(ok, `${JSON.stringify(a)} invece di ${JSON.stringify(min)} ${JSON.stringify(max)}`).toBe(true);
}

describe("la geometria (geometry.rs)", () => {
  it("la grammatica dei path è completa", () => {
    for (const valid of [
      "",
      "  ",
      "M0 0",
      "m10 10 20 20",
      "M1,2L3,4",
      "M0 0 a1 1 0 011 1",
      "M0 0 A1 1 0 1 0 2 2",
      "M0 0 C1 1 2 2 3 3 S4 4 5 5 Q6 6 7 7 T8 8 Z",
      "M0 0 h10 v10 H0 V0 z m5 5 l1 1",
      "M1.5.5L2-3",
      "M0 0 1e2 1E-2",
      "M0 0 Z M1 1 Z",
      "M0 0 L1 1, 2 2",
    ]) {
      expect(parsePath(valid), JSON.stringify(valid)).not.toBeNull();
    }
    for (const invalid of [
      "L0 0",
      "M",
      "M0",
      "M0 0 L",
      "M0 0 Z 1 1",
      "M0 0 X1 1",
      "M0 0 A-1 1 0 0 1 2 2",
      "M0 0 A1 1 0 2 1 2 2",
      "M0 0 A1 1 00 1 2 2",
      "M0 0,",
      "M0 0, L1 1",
      "M,0 0",
      "M0 0 L1.",
      "M0 0 L1e",
    ]) {
      expect(parsePath(invalid), JSON.stringify(invalid)).toBeNull();
    }
  });

  it("i comandi relativi e impliciti diventano assoluti", () => {
    expect(parsePath("m10 10 5 0 v5 z l1 1")).toEqual([
      { kind: "move", to: [10, 10] },
      { kind: "line", to: [15, 10] },
      { kind: "line", to: [15, 15] },
      { kind: "close" },
      { kind: "line", to: [11, 11] },
    ]);
  });

  it("le figure appiattite girano intorno ai punti che contengono", () => {
    const square = "M0 0 L10 0 L10 10 L0 10 Z";
    expect(winding(polygons(square, IDENTITY), [5, 5])).not.toBe(0);
    expect(winding(polygons(square, IDENTITY), [15, 5])).toBe(0);
    // Con `nonzero` un buco disegnato al contrario resta vuoto, uno nello
    // stesso verso si riempie.
    const hole = "M0 0 L10 0 L10 10 L0 10 Z M3 3 L3 7 L7 7 L7 3 Z";
    expect(winding(polygons(hole, IDENTITY), [5, 5])).toBe(0);
    expect(winding(polygons(hole, IDENTITY), [1, 5])).not.toBe(0);
    const same = "M0 0 L10 0 L10 10 L0 10 Z M3 3 L7 3 L7 7 L3 7 Z";
    expect(Math.abs(winding(polygons(same, IDENTITY), [5, 5]))).toBe(2);
    // Gli archi e le curve seguono la loro forma.
    const ellipse = flatten(ellipsePath([0, 0], [10, 5]), IDENTITY);
    expect(winding(ellipse, [9, 0])).not.toBe(0);
    expect(winding(ellipse, [9, 4])).toBe(0);
    const bulge = polygons("M0 0 Q5 10 10 0 Z", IDENTITY);
    expect(winding(bulge, [5, 4])).not.toBe(0);
    expect(winding(bulge, [5, 6])).toBe(0);
    // La matrice sposta i poligoni.
    const moved = polygons(square, translate(100, 0));
    expect(winding(moved, [105, 5])).not.toBe(0);
    expect(winding(moved, [5, 5])).toBe(0);
    // Un sottotracciato aperto si riempie come se fosse chiuso; una linea
    // non ha area.
    expect(winding(polygons("M0 0 L10 0 L10 10", IDENTITY), [8, 2])).not.toBe(0);
    expect(polygons("M0 0 L10 10", IDENTITY)).toEqual([]);
    // Dopo `Z` senza `M` il sottotracciato nuovo riparte dall'inizio.
    const again = polygons("M0 0 L10 0 L10 10 Z L0 10 L-10 10 Z", IDENTITY);
    expect(again).toHaveLength(2);
    expect(again[1]![0]).toEqual([0, 0]);
  });

  it("le curve contribuiscono coi loro estremi, non coi punti di controllo", () => {
    close(bounds("M0 0 Q50 100 100 0", IDENTITY), [0, 0], [100, 50]);
    close(bounds("M0 0 C0 100 100 100 100 0", IDENTITY), [0, 0], [100, 75]);
    // Un semicerchio di raggio 10 sopra l'asse.
    close(bounds("M0 0 A10 10 0 0 1 20 0", IDENTITY), [0, -10], [20, 0]);
    close(bounds("M0 0 A10 10 0 0 0 20 0", IDENTITY), [0, 0], [20, 10]);
    // Raggi troppo piccoli si allargano fino a congiungere gli estremi.
    close(bounds("M0 0 A1 1 0 0 1 20 0", IDENTITY), [0, -10], [20, 0]);
  });

  it("le curve trasformate restano esatte", () => {
    const m = rotate(45);
    close(bounds("M-10 0 A10 10 0 1 1 10 0 A10 10 0 1 1 -10 0", m), [-10, -10], [10, 10]);
    const e = new BoundsBuilder();
    e.ellipse([0, 0], [20, 10], rotate(90));
    close(e.finish()!, [-10, -20], [10, 20]);
    const r = new BoundsBuilder();
    r.path(rectPath(0, 0, 10, 10, 5, 5), rotate(45));
    // Un cerchio di raggio 5 col centro in (5, 5), ruotato intorno all'origine.
    const center = Math.sqrt(50);
    close(r.finish()!, [-5, center - 5], [5, center + 5]);
  });
});

describe("un tracciato da seguire", () => {
  it("dà il punto a una distanza, e la distanza del punto più vicino", () => {
    const track = new Track(parsePath("M 0 0 L 100 0 L 100 50")!);
    expect(track.length).toBeCloseTo(150);
    expect(track.at(120)).toEqual({ at: [100, 20], direction: [0, 1] });
    expect(track.nearest([40, -30])).toBeCloseTo(40);
    expect(track.nearest([130, 30])).toBeCloseTo(130);
    // Prima dell'inizio, l'inizio; oltre la fine, la fine.
    expect(track.nearest([-20, 5])).toBe(0);
    expect(track.nearest([100, 90])).toBeCloseTo(150);
    expect(new Track(parsePath("M 5 5")!).nearest([0, 0])).toBe(0);
  });
});
