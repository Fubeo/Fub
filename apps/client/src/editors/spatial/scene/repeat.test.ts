import { describe, expect, it } from "vitest";
import { IDENTITY, apply, compose, type Matrix, type Point } from "./matrix";
import { MAX_GRID, MAX_GRID_SIDE, MAX_RADIAL, copyCount, readRepeat, repeatMatrices, writeRepeat, type Repeat } from "./repeat";
import { formatTransform } from "./serialize";
import cases from "../../../__fixtures__/scene-repeat/cases.json";

/// `a` e `b` uguali a meno degli arrotondamenti.
function near(a: Matrix, b: Matrix): void {
  for (let i = 0; i < 6; i++) expect(a[i]).toBeCloseTo(b[i]!, 9);
}

/// `p` e `q` uguali a meno degli arrotondamenti.
function samePoint(p: Point, q: Point): void {
  expect(p[0]).toBeCloseTo(q[0], 9);
  expect(p[1]).toBeCloseTo(q[1], 9);
}

describe("la lettura di fub:repeat", () => {
  it("i casi sono tanti quanti il formato ne chiede", () => {
    const read = cases.read.filter((row) => row.read !== null).length;
    expect(read).toBeGreaterThanOrEqual(12);
    expect(cases.read.length - read).toBeGreaterThanOrEqual(30);
  });

  for (const { text, read } of cases.read) {
    it(`fub:repeat=${JSON.stringify(text)} ${read === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readRepeat(text)).toEqual(read);
    });
  }

  it("i limiti sono quelli del formato", () => {
    expect([MAX_RADIAL, MAX_GRID_SIDE, MAX_GRID]).toEqual([100, 100, 1000]);
    expect(readRepeat(`radial ${MAX_RADIAL} 0 0`)).not.toBeNull();
    expect(readRepeat(`radial ${MAX_RADIAL + 1} 0 0`)).toBeNull();
    expect(readRepeat(`grid ${MAX_GRID_SIDE} 10 1 1`)).not.toBeNull();
    expect(readRepeat(`grid ${MAX_GRID_SIDE + 1} 1 1 1`)).toBeNull();
    expect(readRepeat("grid 40 25 1 1")).not.toBeNull();
    expect(readRepeat("grid 40 26 1 1")).toBeNull();
  });
});

describe("la scrittura di fub:repeat", () => {
  for (const { repeat, text } of cases.write) {
    it(`si scrive ${JSON.stringify(text)}`, () => {
      expect(writeRepeat(repeat as unknown as Repeat)).toBe(text);
      // Scritta a due decimali, la ripetizione si rilegge e si riscrive uguale.
      const again = readRepeat(text)!;
      expect(again.kind).toBe(repeat.kind);
      expect(writeRepeat(again)).toBe(text);
    });
  }
});

describe("le trasformazioni delle copie", () => {
  it("una per copia, l'originale escluso", () => {
    const samples: Repeat[] = [
      { kind: "radial", count: 2, center: [0, 0] },
      { kind: "radial", count: 100, center: [3, 4] },
      { kind: "grid", columns: 1, rows: 2, step: [0, 10] },
      { kind: "grid", columns: 40, rows: 25, step: [1, 1] },
      { kind: "mirror", axis: [[0, 0], [0, 1]] },
    ];
    for (const repeat of samples) expect(repeatMatrices(repeat)).toHaveLength(copyCount(repeat));
    expect(samples.map(copyCount)).toEqual([1, 99, 1, 999, 1]);
  });

  it("radiale: ruota intorno al centro, in senso orario sullo schermo, coi quarti esatti", () => {
    const matrices = repeatMatrices({ kind: "radial", count: 4, center: [10, 20] });
    expect(matrices.map(formatTransform)).toEqual(["matrix(0 1 -1 0 30 10)", "matrix(-1 0 0 -1 20 40)", "matrix(0 -1 1 0 -10 30)"]);
    // A destra del centro, la prima copia va sotto: l'asse y scende.
    samePoint(apply(matrices[0]!, [20, 20]), [10, 30]);
    for (const m of matrices) samePoint(apply(m, [10, 20]), [10, 20]);
  });

  it("radiale: le copie fanno un giro intero", () => {
    const center: Point = [-7.5, 12.25];
    const [first, ...rest] = repeatMatrices({ kind: "radial", count: 7, center });
    let turned: Matrix = IDENTITY;
    for (let k = 0; k < 7; k++) turned = compose(first!, turned);
    near(turned, IDENTITY);
    let step: Matrix = first!;
    for (const m of rest) {
      step = compose(first!, step);
      near(m, step);
      expect(m[0] * m[3] - m[1] * m[2]).toBeCloseTo(1, 12);
      samePoint(apply(m, center), center);
    }
  });

  it("griglia: per righe, poi per colonne, senza la prima cella", () => {
    const matrices = repeatMatrices({ kind: "grid", columns: 3, rows: 2, step: [40, -25] });
    expect(matrices).toEqual([
      [1, 0, 0, 1, 40, 0],
      [1, 0, 0, 1, 80, 0],
      [1, 0, 0, 1, 0, -25],
      [1, 0, 0, 1, 40, -25],
      [1, 0, 0, 1, 80, -25],
    ]);
  });

  it("specchio: la riflessione sull'asse, che tiene fermi i suoi punti", () => {
    expect(repeatMatrices({ kind: "mirror", axis: [[100, 0], [100, 200]] }).map(formatTransform)).toEqual(["matrix(-1 0 0 1 200 0)"]);
    expect(repeatMatrices({ kind: "mirror", axis: [[0, 10], [-10, 10]] }).map(formatTransform)).toEqual(["matrix(1 0 0 -1 0 20)"]);
    expect(repeatMatrices({ kind: "mirror", axis: [[0, 0], [1, 1]] }).map(formatTransform)).toEqual(["matrix(0 1 1 0 0 0)"]);
    const axis: readonly [Point, Point] = [[3, -4], [11.5, 2]];
    const [m] = repeatMatrices({ kind: "mirror", axis });
    near(compose(m!, m!), IDENTITY);
    samePoint(apply(m!, axis[0]), axis[0]);
    samePoint(apply(m!, axis[1]), axis[1]);
    samePoint(apply(m!, [7.25, -1]), [7.25, -1]);
    expect(m![0] * m![3] - m![1] * m![2]).toBeCloseTo(-1, 12);
  });
});
