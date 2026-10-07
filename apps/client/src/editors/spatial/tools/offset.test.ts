// Il contorno in tracciato e lo scostamento: i casi esatti di linee, cerchi,
// giunti, estremi, tratteggi e punti, e sulle curve la proprietà che li
// riassume tutti: con giunti ed estremi tondi, il contorno è l'insieme dei
// punti a distanza al più metà larghezza dal tracciato, e il suo bordo sta a
// quella distanza.

import { describe, expect, it } from "vitest";
import { pointAt } from "../scene/curves";
import { parsePath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { offsetArea, strokeArea, strokeLoops, type StrokeStyle } from "./offset";

const style = (width: number, more: Partial<StrokeStyle> = {}): StrokeStyle => ({ width, join: "miter", cap: "butt", miterLimit: 4, dashes: [], ...more });

function stroke(d: string, given: StrokeStyle): Segment[] {
  const out = strokeArea(parsePath(d)!, given);
  if (typeof out === "string") throw new Error(`contorno non riuscito: ${out}`);
  return out;
}

function offset(d: string, distance: number, join: StrokeStyle["join"] = "miter", filled = true): Segment[] {
  const out = offsetArea(parsePath(d)!, distance, { join, miterLimit: 4 }, filled);
  if (typeof out === "string") throw new Error(`scostamento non riuscito: ${out}`);
  return out;
}

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

/// La distanza dalle spezzate `lines`, fino a `limit`: i pezzi si cercano in
/// una griglia di celle larghe `limit`.
function distances(lines: readonly Point[][], limit: number): (p: Point) => number {
  const cells = new Map<string, [Point, Point][]>();
  const key = (x: number, y: number): string => `${x},${y}`;
  for (const line of lines) {
    const pieces: [Point, Point][] = line.length === 1 ? [[line[0]!, line[0]!]] : line.slice(1).map((b, i) => [line[i]!, b]);
    for (const [a, b] of pieces) {
      for (let x = Math.floor(Math.min(a[0], b[0]) / limit); x <= Math.floor(Math.max(a[0], b[0]) / limit); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / limit); y <= Math.floor(Math.max(a[1], b[1]) / limit); y++) {
          const list = cells.get(key(x, y)) ?? [];
          list.push([a, b]);
          cells.set(key(x, y), list);
        }
      }
    }
  }
  return (p) => {
    let best = limit;
    const [cx, cy] = [Math.floor(p[0] / limit), Math.floor(p[1] / limit)];
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const [a, b] of cells.get(key(x, y)) ?? []) {
          const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
          const squared = dx * dx + dy * dy;
          const u = squared === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared));
          best = Math.min(best, Math.hypot(a[0] + u * dx - p[0], a[1] + u * dy - p[1]));
        }
      }
    }
    return best;
  };
}

const boundsOf = (segments: readonly Segment[]): [number, number, number, number] => {
  const points = polylines(segments, true, 0.5).flat();
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
};

const subpaths = (segments: readonly Segment[]): number => segments.filter((segment) => segment.kind === "move").length;

/// Un generatore ripetibile.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/// Con giunti ed estremi tondi, il contorno di `d` largo `2h`: ogni punto del
/// bordo sta a h dal tracciato, entro due centesimi; e un punto più vicino di
/// h − 0,05 sta dentro, uno più lontano di h + 0,05 fuori.
function expectMinkowski(d: string, h: number): void {
  const result = stroke(d, style(2 * h, { join: "round", cap: "round" }));
  const path = polylines(parsePath(d)!, false, 0.02);
  const distanceTo = distances(path, h + 1);
  const rings = polylines(result, true, 0.2);
  const boundary = rings.flat();
  const every = Math.max(1, Math.floor(boundary.length / 1500));
  let worst = 0;
  for (let i = 0; i < boundary.length; i += every) worst = Math.max(worst, Math.abs(distanceTo(boundary[i]!) - h));
  expect(worst).toBeLessThan(0.02);
  const [x0, y0, x1, y1] = boundsOf(parsePath(d)!);
  const next = random(7);
  for (let k = 0; k < 400; k++) {
    const p: Point = [x0 - h - 2 + (x1 - x0 + 2 * h + 4) * next(), y0 - h - 2 + (y1 - y0 + 2 * h + 4) * next()];
    const gap = distanceTo(p);
    if (gap < h - 0.05) expect(winding(rings, p), `dentro: ${p}`).not.toBe(0);
    else if (gap > h + 0.05) expect(winding(rings, p), `fuori: ${p}`).toBe(0);
  }
}

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx + r} ${cy} A${r} ${r} 0 0 1 ${cx} ${cy + r} A${r} ${r} 0 0 1 ${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;

describe("le linee", () => {
  it("con gli estremi netti, un rettangolo", () => {
    const out = stroke("M0 0 L100 0", style(10));
    expect(area(out)).toBeCloseTo(1000, 1);
    expect(boundsOf(out)).toEqual([0, -5, 100, 5]);
  });

  it("con gli estremi quadrati, allungato di metà larghezza", () => {
    expect(boundsOf(stroke("M0 0 L100 0", style(10, { cap: "square" })))).toEqual([-5, -5, 105, 5]);
  });

  it("con gli estremi tondi, due mezzi cerchi veri", () => {
    const out = stroke("M0 0 L100 0", style(10, { cap: "round" }));
    expect(area(out)).toBeCloseTo(1000 + 25 * Math.PI, 1);
    expect(out.filter((segment) => segment.kind === "arc").length).toBe(4);
  });

  it("una linea obliqua", () => {
    expect(area(stroke("M0 0 L30 40", style(4, { cap: "square" })))).toBeCloseTo(54 * 4, 1);
  });
});

describe("i giunti", () => {
  const ELL = "M0 0 L100 0 L100 100";

  it("lo spigolo, smussato e tondo", () => {
    expect(area(stroke(ELL, style(10)))).toBeCloseTo(2000, 1);
    expect(boundsOf(stroke(ELL, style(10)))).toEqual([0, -5, 105, 100]);
    expect(area(stroke(ELL, style(10, { join: "bevel" })))).toBeCloseTo(1987.5, 1);
    expect(area(stroke(ELL, style(10, { join: "round" })))).toBeCloseTo(1975 + (25 * Math.PI) / 4, 1);
  });

  it("oltre il limite lo spigolo diventa smussato", () => {
    const sharp = "M0 0 L100 0 L0 20";
    expect(boundsOf(stroke(sharp, style(10)))[2]).toBeLessThan(106);
    expect(boundsOf(stroke(sharp, style(10, { miterLimit: 11 })))[2]).toBeGreaterThan(140);
  });

  it("un poligono chiuso ha i giunti anche nel punto di partenza", () => {
    const out = stroke("M0 0 L100 0 L100 100 L0 100 Z", style(10));
    expect(area(out)).toBeCloseTo(110 * 110 - 90 * 90, 1);
    expect(subpaths(out)).toBe(2);
  });

  it("un tracciato che torna indietro", () => {
    expect(area(stroke("M0 0 L100 0 L50 0", style(10, { join: "round" })))).toBeCloseTo(1000 + (25 * Math.PI) / 2, 1);
  });
});

describe("le curve", () => {
  it("un cerchio fa un anello di due cerchi, con gli archi", () => {
    const out = stroke(circle(0, 0, 50), style(10));
    expect(area(out)).toBeCloseTo(Math.PI * (55 * 55 - 45 * 45), 0);
    expect(subpaths(out)).toBe(2);
    expect(out.every((segment) => segment.kind !== "cubic")).toBe(true);
  });

  it("un cerchio più piccolo di metà contorno diventa un disco", () => {
    expect(area(stroke(circle(0, 0, 4), style(10)))).toBeCloseTo(81 * Math.PI, 0);
  });

  it("una curva a esse, sottile e più larga delle sue anse", () => {
    expectMinkowski("M0 0 C50 -80 100 80 150 0", 10);
    expectMinkowski("M0 0 C50 -80 100 80 150 0", 40);
  });

  it("un'inversione a U più stretta del contorno", () => {
    expectMinkowski("M0 0 C100 0 100 100 0 100", 30);
    expectMinkowski("M0 0 C120 0 120 10 0 10", 12);
  });

  it("una cuspide, un cappio e una maniglia sul suo nodo", () => {
    expectMinkowski("M0 0 C30 30 0 30 30 0", 6);
    expectMinkowski("M0 0 C100 100 0 100 100 0", 8);
    expectMinkowski("M0 0 C0 0 50 100 100 100", 15);
  });

  it("archi d'ellisse e di cerchio stretti", () => {
    expectMinkowski("M0 0 A80 30 20 0 1 100 50", 10);
    expectMinkowski("M0 0 A5 5 0 0 1 10 0 A5 5 0 0 1 20 0", 12);
  });

  it("una spezzata e un tracciato di più curve", () => {
    expectMinkowski("M0 0 L20 40 L40 0 L60 40", 8);
    expectMinkowski("M0 0 C20 -30 40 30 60 0 S100 -40 120 0 Q140 40 160 0 T200 0", 7);
    expectMinkowski("M10 10 C60 -20 90 60 40 50 C0 40 20 0 60 20 Z", 9);
  });
});

describe("il tratteggio", () => {
  it("una linea in tratti", () => {
    const out = stroke("M0 0 L100 0", style(4, { dashes: [10, 10] }));
    expect(subpaths(out)).toBe(5);
    expect(area(out)).toBeCloseTo(200, 1);
  });

  it("i tratti lunghi zero sono punti", () => {
    const out = stroke("M0 0 L100 0", style(4, { dashes: [0, 10], cap: "round" }));
    expect(subpaths(out)).toBe(10);
    expect(area(out)).toBeCloseTo(40 * Math.PI, 0);
    expect(stroke("M0 0 L100 0", style(4, { dashes: [0, 10] }))).toEqual([]);
  });

  it("in un sottotracciato chiuso il primo e l'ultimo tratto si uniscono col giunto", () => {
    const rings = (out: Segment[]): Point[][] => polylines(out, true, 0.2);
    const joined = stroke("M0 0 L100 0 L100 100 L0 100 Z", style(10, { dashes: [60, 30] }));
    expect(subpaths(joined)).toBe(4);
    expect(winding(rings(joined), [-4.5, -4.5])).not.toBe(0);
    const apart = stroke("M0 0 L100 0 L100 100 L0 100 Z", style(10, { dashes: [60, 20] }));
    expect(winding(rings(apart), [-4.5, -4.5])).toBe(0);
  });

  it("un tratto che copre tutto lascia il sottotracciato chiuso", () => {
    expect(area(stroke("M0 0 L100 0 L100 100 L0 100 Z", style(10, { dashes: [500, 10] })))).toBeCloseTo(110 * 110 - 90 * 90, 1);
  });

  it("un tratteggio troppo fitto si rifiuta", () => {
    expect(strokeLoops(parsePath("M0 0 L100000 0")!, style(1, { dashes: [1, 1] }))).toBe("dense");
  });
});

describe("i punti", () => {
  it("un sottotracciato lungo zero", () => {
    expect(area(stroke("M10 10 Z", style(6, { cap: "round" })))).toBeCloseTo(9 * Math.PI, 1);
    expect(area(stroke("M10 10 L10 10", style(6, { cap: "square" })))).toBeCloseTo(36, 1);
    expect(stroke("M10 10 Z", style(6))).toEqual([]);
    expect(stroke("M10 10", style(6, { cap: "round" }))).toEqual([]);
  });
});

describe("lo scostamento", () => {
  const SQUARE = "M0 0 L100 0 L100 100 L0 100 Z";

  it("allarga un quadrato con gli spigoli, smussati o tondi", () => {
    expect(area(offset(SQUARE, 10))).toBeCloseTo(14400, 1);
    expect(area(offset(SQUARE, 10, "bevel"))).toBeCloseTo(14200, 1);
    expect(area(offset(SQUARE, 10, "round"))).toBeCloseTo(14000 + 100 * Math.PI, 1);
  });

  it("restringe, fino a niente", () => {
    expect(area(offset(SQUARE, -10))).toBeCloseTo(6400, 1);
    expect(offset(SQUARE, -60)).toEqual([]);
  });

  it("un cerchio resta un cerchio", () => {
    expect(area(offset(circle(0, 0, 50), 10))).toBeCloseTo(3600 * Math.PI, 0);
    expect(area(offset(circle(0, 0, 50), -10))).toBeCloseTo(1600 * Math.PI, 0);
  });

  it("un buco si stringe quando la forma si allarga", () => {
    const ring = `${SQUARE} M30 30 L30 70 L70 70 L70 30 Z`;
    expect(area(offset(ring, 5))).toBeCloseTo(110 * 110 - 30 * 30, 1);
  });

  it("una linea senza riempimento si allarga attorno a sé", () => {
    expect(area(offset("M0 0 L100 0", 5, "round", false))).toBeCloseTo(1000 + 25 * Math.PI, 1);
    expect(area(offset("M0 0 L100 0", 5, "miter", false))).toBeCloseTo(1100, 1);
    expect(offset("M0 0 L100 0", -5, "miter", false)).toEqual([]);
  });
});

describe("il tempo e i limiti", () => {
  /// Duecento curve di fila, ciascuna con lo spigolo sulla precedente.
  function wandering(): string {
    const next = random(11);
    let d = "M0 0";
    let [x, y] = [0, 0];
    for (let i = 0; i < 200; i++) {
      const [nx, ny] = [x + 10 + next() * 20, y + (next() - 0.5) * 30];
      d += ` C${x + 5} ${y + (next() - 0.5) * 20} ${nx - 5} ${ny + (next() - 0.5) * 20} ${nx} ${ny}`;
      [x, y] = [nx, ny];
    }
    return d;
  }

  it("il contorno di duecento curve, largo più delle curve", () => {
    const begin = performance.now();
    expect(stroke(wandering(), style(20, { join: "round", cap: "round" })).length).toBeGreaterThan(0);
    expect(performance.now() - begin).toBeLessThan(4000);
  });

  it("un groviglio troppo intricato si rifiuta", () => {
    const next = random(11);
    let d = "M0 0";
    for (let i = 0; i < 200; i++) d += ` C${next() * 400} ${next() * 400} ${next() * 400} ${next() * 400} ${next() * 400} ${next() * 400}`;
    expect(strokeArea(parsePath(d)!, style(20, { join: "round", cap: "round" }))).toBe("complex");
  }, 30000);
});
