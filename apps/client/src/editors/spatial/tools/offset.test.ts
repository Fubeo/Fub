// Il contorno in tracciato e lo scostamento: i casi esatti di linee, cerchi,
// giunti, estremi, tratteggi e punti, e sulle curve la proprietà che li
// riassume tutti: con giunti ed estremi tondi, il contorno è l'insieme dei
// punti a distanza al più metà larghezza dal tracciato, e il suo bordo sta a
// quella distanza.

import { describe, expect, it } from "vitest";
import { pointAt } from "../scene/curves";
import { parsePath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { widthSpans, type WidthPoint } from "../scene/varwidth";
import { profileArea, type ProfileStyle } from "./offset";

/// I sottotracciati di `segments` come spezzate fitte, chiuse se `closed`
/// (un'area), aperte com'erano altrimenti (un tracciato da misurare).
function polylines(segments: readonly Segment[], closed: boolean, spacing = 0.05): Point[][] {
  const out: Point[][] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  let line: Point[] = [];
  const finish = (): void => {
    if (line.length > 0) {
      if (closed) line.push(start);
      out.push(line);
    }
    line = [];
  };
  for (const segment of segments) {
    if (segment.kind === "move") {
      finish();
      start = current = segment.to;
      line = [current];
    } else if (segment.kind === "close") {
      line.push(start);
      current = start;
    } else {
      let length = 0;
      let p = current;
      for (let k = 1; k <= 32; k++) {
        const q = pointAt(current, segment, k / 32);
        length += Math.hypot(q[0] - p[0], q[1] - p[1]);
        p = q;
      }
      const steps = Math.max(64, Math.ceil(length / spacing));
      for (let k = 1; k <= steps; k++) line.push(pointAt(current, segment, k / steps));
      current = segment.to;
    }
  }
  finish();
  return out;
}

/// L'area con la regola nonzero: gli anelli del risultato girano in un verso
/// e i buchi nell'altro.
function area(segments: readonly Segment[]): number {
  let sum = 0;
  for (const ring of polylines(segments, true, 0.02)) {
    for (let i = 0; i + 1 < ring.length; i++) sum += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return Math.abs(sum / 2);
}

/// L'avvolgimento di `rings` attorno a `p`.
function winding(rings: readonly Point[][], p: Point): number {
  let w = 0;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i]!, ring[i + 1]!];
      const side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= p[1] && b[1] > p[1] && side > 0) w++;
      else if (a[1] > p[1] && b[1] <= p[1] && side < 0) w--;
    }
  }
  return w;
}

const boundsOf = (segments: readonly Segment[]): [number, number, number, number] => {
  const points = polylines(segments, true, 0.5).flat();
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
};

/// Un generatore ripetibile.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
describe("lo spessore variabile", () => {
  function profiled(d: string, profile: readonly WidthPoint[], more: Partial<ProfileStyle> = {}): Segment[] {
    const out = profileArea(parsePath(d)!, widthSpans(profile), { cap: "butt", join: "miter", ...more });
    if (typeof out === "string") throw new Error(`contorno non riuscito: ${out}`);
    return out;
  }

  const expectBounds = (segments: readonly Segment[], expected: readonly number[]): void => {
    boundsOf(segments).forEach((value, i) => expect(value, `lato ${i}`).toBeCloseTo(expected[i]!, 2));
  };

  it("una linea che si assottiglia è un triangolo, senza estremi dove non è larga", () => {
    const out = profiled("M0 0 L100 0", [
      [0, 0, 0],
      [1, 5, 5],
    ], { cap: "round" });
    expect(area(out)).toBeCloseTo(500 + (25 * Math.PI) / 2, 1);
    expectBounds(out, [0, -5, 105, 5]);
  });

  it("la destra di chi percorre la linea è in basso sullo schermo, e i lati sono indipendenti", () => {
    expectBounds(profiled("M0 0 L100 0", [
      [0, 0, 4],
      [1, 0, 4],
    ]), [0, 0, 100, 4]);
    expectBounds(profiled("M0 0 L100 0", [
      [0, 3, 0],
      [1, 3, 0],
    ]), [0, -3, 100, 0]);
    expectBounds(profiled("M100 0 L0 0", [
      [0, 3, 0],
      [1, 3, 0],
    ]), [0, 0, 100, 3]);
  });

  it("un salto di larghezza è un gradino", () => {
    const out = profiled("M0 0 L100 0", [
      [0, 2, 2],
      [0.5, 2, 2],
      [0.5, 6, 6],
      [1, 6, 6],
    ]);
    expect(area(out)).toBeCloseTo(800, 1);
    expectBounds(out, [0, -6, 100, 6]);
  });

  it("gli estremi tondi e quadrati stanno sul segmento fra i due lati", () => {
    const profile: WidthPoint[] = [
      [0, 2, 6],
      [1, 2, 6],
    ];
    const round = profiled("M0 0 L100 0", profile, { cap: "round" });
    expect(area(round)).toBeCloseTo(800 + 16 * Math.PI, 1);
    expectBounds(round, [-4, -2, 104, 6]);
    const square = profiled("M0 0 L100 0", profile, { cap: "square" });
    expect(area(square)).toBeCloseTo(864, 1);
  });

  it("il giunto prende la larghezza maggiore dove la linea gira", () => {
    const out = profiled("M0 0 L100 0 L100 100", [
      [0, 2, 2],
      [0.5, 2, 2],
      [0.5, 6, 6],
      [1, 6, 6],
    ]);
    expectBounds(out, [0, -6, 106, 100]);
  });

  it("una curva più stretta della larghezza e una cuspide si riempiono", () => {
    const out = profiled("M0 0 C100 0 100 60 0 60", [
      [0, 1, 1],
      [0.5, 40, 40],
      [1, 1, 1],
    ]);
    // In mezzo la curva passa da (75, 30) verso il basso, e la sua destra
    // guarda dentro la U, più vicina della larghezza.
    const rings = polylines(out, true, 0.2);
    for (const x of [40, 60, 110]) expect(winding(rings, [x, 30]), `${x}`).not.toBe(0);
    for (const x of [30, 120]) expect(winding(rings, [x, 30]), `${x}`).toBe(0);
    expect(profiled("M0 0 C100 50 -50 50 50 0", [
      [0, 1, 1],
      [0.5, 8, 8],
      [1, 1, 1],
    ]).length).toBeGreaterThan(0);
  });

  it("duecento curve con un profilo irregolare, in poco tempo", () => {
    const next = random(5);
    let d = "M0 0";
    let [x, y] = [0, 0];
    for (let i = 0; i < 200; i++) {
      const [nx, ny] = [x + 10 + next() * 20, y + (next() - 0.5) * 30];
      d += ` C${x + 5} ${y + (next() - 0.5) * 20} ${nx - 5} ${ny + (next() - 0.5) * 20} ${nx} ${ny}`;
      [x, y] = [nx, ny];
    }
    const profile: WidthPoint[] = [[0, 0, 0]];
    for (let k = 1; k < 40; k++) profile.push([k / 40, 2 + next() * 10, 2 + next() * 10]);
    profile.push([1, 0, 0]);
    const begin = performance.now();
    expect(profiled(d, profile, { cap: "round", join: "round" }).length).toBeGreaterThan(0);
    expect(performance.now() - begin).toBeLessThan(4000);
  });
});
