// La penna in simmetria: le trasformazioni delle copie, le guide e i
// campioni portati da una trasformazione.

import { describe, expect, it } from "vitest";
import { apply, type Matrix, type Point } from "../scene/matrix";
import {
  clampSlices,
  DEFAULT_SYMMETRY,
  isSymmetryKind,
  mappedSamples,
  MAX_SLICES,
  MIN_SLICES,
  strokeCount,
  symmetryMatrices,
  symmetryRays,
  type PenSymmetry,
} from "./symmetry";

const at = (symmetry: Partial<PenSymmetry>): PenSymmetry => ({ ...DEFAULT_SYMMETRY, center: [100, 50], ...symmetry });

/// Dove le copie portano `p`.
const images = (matrices: readonly Matrix[], p: Point): Point[] => matrices.map((m) => apply(m, p).map((value) => Math.round(value * 1e6) / 1e6 + 0) as unknown as Point);

describe("le trasformazioni delle copie", () => {
  it("non ce n'è nessuna con la simmetria spenta, o senza centro", () => {
    expect(symmetryMatrices(at({ kind: "none" }))).toEqual([]);
    expect(symmetryMatrices({ ...DEFAULT_SYMMETRY, kind: "radial" })).toEqual([]);
    expect(strokeCount(at({ kind: "none" }))).toBe(1);
  });

  it("un asse verticale riflette da sinistra a destra, uno orizzontale dall'alto in basso", () => {
    expect(symmetryMatrices(at({ kind: "vertical" }))).toEqual([[-1, 0, 0, 1, 200, 0]]);
    expect(symmetryMatrices(at({ kind: "horizontal" }))).toEqual([[1, 0, 0, -1, 0, 100]]);
    expect(images(symmetryMatrices(at({ kind: "vertical" })), [90, 20])).toEqual([[110, 20]]);
  });

  it("una radiale gira di uno spicchio alla volta, in senso orario sullo schermo", () => {
    const four = symmetryMatrices(at({ kind: "radial", slices: 4, mirror: false }));
    expect(four).toEqual([
      [0, 1, -1, 0, 150, -50],
      [-1, 0, 0, -1, 200, 100],
      [0, -1, 1, 0, 50, 150],
    ]);
    // Il punto sopra il centro va a destra, sotto, a sinistra.
    expect(images(four, [100, 0])).toEqual([[150, 50], [100, 100], [50, 50]]);
    expect(strokeCount(at({ kind: "radial", slices: 4, mirror: false }))).toBe(4);
  });

  it("specchiata alterna le immagini e le rotazioni, e due spicchi sono i quattro quadranti", () => {
    const quadrants = symmetryMatrices(at({ kind: "radial", slices: 2, mirror: true }));
    expect(quadrants).toEqual([
      [-1, 0, 0, 1, 200, 0],
      [-1, 0, 0, -1, 200, 100],
      [1, 0, 0, -1, 0, 100],
    ]);
    expect(images(quadrants, [90, 40])).toEqual([[110, 40], [110, 60], [90, 60]]);
    expect(strokeCount(at({ kind: "radial", slices: 8, mirror: true }))).toBe(16);
    expect(strokeCount(at({ kind: "radial", slices: 8, mirror: false }))).toBe(8);
  });

  it("ogni copia di una radiale specchiata sta alla stessa distanza dal centro, su un asse dello specchio se ci stava il tratto", () => {
    const matrices = symmetryMatrices(at({ kind: "radial", slices: 6, mirror: true }));
    expect(matrices).toHaveLength(11);
    // Un punto sull'asse verticale sopra il centro: le sue immagini cadono
    // a due a due sullo stesso punto, sui sei raggi.
    const points = images(matrices, [100, 20]);
    for (const [x, y] of points) expect(Math.hypot(x - 100, y - 50)).toBeCloseTo(30, 5);
    const distinct = new Set(points.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`));
    expect(distinct.size).toBe(6);
    // Le immagini specchiate rovesciano il verso, le rotazioni no.
    const flips = matrices.map(([a, b, c, d]) => a * d - b * c < 0);
    expect(flips).toEqual([true, false, true, false, true, false, true, false, true, false, true]);
  });

  it("gli spicchi stanno fra 2 e 12", () => {
    expect([clampSlices(1), clampSlices(7.4), clampSlices(40)]).toEqual([MIN_SLICES, 7, MAX_SLICES]);
    expect(symmetryMatrices(at({ kind: "radial", slices: 30, mirror: false }))).toHaveLength(MAX_SLICES - 1);
  });

  it("riconosce i tipi", () => {
    expect(["none", "vertical", "horizontal", "radial", "grid", ""].map(isSymmetryKind)).toEqual([true, true, true, true, false, false]);
  });
});

describe("le guide", () => {
  it("un asse sono due direzioni opposte, una radiale un raggio per spicchio, specchiata uno per asse", () => {
    expect(symmetryRays(at({ kind: "none" }))).toEqual([]);
    expect(symmetryRays(at({ kind: "vertical" }))).toEqual([270, 90]);
    expect(symmetryRays(at({ kind: "horizontal" }))).toEqual([0, 180]);
    expect(symmetryRays(at({ kind: "radial", slices: 4, mirror: false }))).toEqual([270, 0, 90, 180]);
    expect(symmetryRays(at({ kind: "radial", slices: 3, mirror: true }))).toEqual([270, 330, 30, 90, 150, 210]);
  });
});

describe("i campioni portati", () => {
  it("muovono i punti e tengono pressione e tempo", () => {
    expect(mappedSamples([{ x: 90, y: 20, t: 0, p: 0.5 }, { x: 80, y: 30, t: 16, p: 0.7 }], [-1, 0, 0, 1, 200, 0])).toEqual([
      { x: 110, y: 20, t: 0, p: 0.5 },
      { x: 120, y: 30, t: 16, p: 0.7 },
    ]);
  });

  it("girano l'azimut della penna con loro, e lo specchiano", () => {
    const [turned] = mappedSamples([{ x: 0, y: 0, t: 0, a: 40, z: 30 }], [0, 1, -1, 0, 0, 0]);
    expect(turned!.a).toBe(40);
    expect(turned!.z).toBeCloseTo(120, 9);
    const [mirrored] = mappedSamples([{ x: 0, y: 0, t: 0, a: 40, z: 30 }], [-1, 0, 0, 1, 0, 0]);
    expect(mirrored!.z).toBeCloseTo(150, 9);
    const [flipped] = mappedSamples([{ x: 0, y: 0, t: 0, a: 40, z: 30 }], [1, 0, 0, -1, 0, 0]);
    expect(flipped!.z).toBeCloseTo(330, 9);
  });
});
