// «Semplifica»: su un corpus di tracciati, lo scarto fra prima e dopo,
// misurato nei due versi, sta entro la tolleranza; i nodi calano, gli
// spigoli e le linee lunghe restano, e niente ha più nodi di prima.

import { describe, expect, it } from "vitest";
import { outlinePath } from "../ink/pf1";
import { pointAt } from "../scene/curves";
import { parsePath, rectPath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { shapeSegments } from "./hit";
import { kindOf, readNodes } from "./nodes";
import { nodeCount, simplified } from "./simplify";

/// I sottotracciati di `segments` come spezzate fitte.
function polylines(segments: readonly Segment[], spacing: number): Point[][] {
  const out: Point[][] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  let line: Point[] = [];
  const finish = (): void => {
    if (line.length > 0) out.push(line);
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
      const steps = Math.max(segment.kind === "line" ? 1 : 64, Math.ceil(length / spacing));
      for (let k = 1; k <= steps; k++) line.push(pointAt(current, segment, k / steps));
      current = segment.to;
    }
  }
  finish();
  return out;
}

/// La distanza dalle spezzate `lines`, fino a `limit`: i pezzi si cercano in
/// una griglia di celle larghe `limit`.
function distances(lines: readonly Point[][], limit: number): (p: Point) => number {
  const cells = new Map<string, [Point, Point][]>();
  const key = (x: number, y: number): string => `${x},${y}`;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i]!, line[i + 1]!];
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

/// Lo scarto massimo fra `a` e `b`, nei due versi; oltre 2, 2.
function deviation(a: readonly Segment[], b: readonly Segment[], spacing = 0.25): number {
  const [pa, pb] = [polylines(a, spacing), polylines(b, spacing)];
  const [toA, toB] = [distances(pa, 2), distances(pb, 2)];
  let worst = 0;
  for (const p of pa.flat()) worst = Math.max(worst, toB(p));
  for (const p of pb.flat()) worst = Math.max(worst, toA(p));
  return worst;
}

const path = (d: string): Segment[] => parsePath(d)!;

/// `simplified`, scritto e riletto come lo scrive il formato.
function simple(segments: readonly Segment[], tolerance: number): Segment[] {
  return parsePath(pathData(simplified(segments, tolerance)))!;
}

/// Un generatore ripetibile.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/// Un poligono regolare di `n` lati, con i vertici spostati fino a `noise`.
function polygon(n: number, r: number, noise = 0, seed = 1): Segment[] {
  const next = random(seed);
  const points = Array.from({ length: n }, (_, i): Point => {
    const a = (2 * Math.PI * i) / n;
    const s = r + (next() * 2 - 1) * noise;
    return [200 + s * Math.cos(a), 200 + s * Math.sin(a)];
  });
  return [{ kind: "move", to: points[0]! }, ...points.slice(1).map((to): Segment => ({ kind: "line", to })), { kind: "close" }];
}

const lines = (segments: readonly Segment[]): number => segments.filter((s) => s.kind === "line").length;

describe("semplifica", () => {
  it("un rettangolo resta lui", () => {
    const rect = path("M0 0 H100 V60 H0 Z");
    expect(pathData(simplified(rect, 1))).toBe(pathData(rect));
  });

  it("una stella tiene le punte", () => {
    const points = Array.from({ length: 10 }, (_, i): Point => {
      const a = (Math.PI * i) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? 100 : 40;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const star = shapeSegments("polygon", [["points", points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")]]);
    expect(pathData(simplified(star, 2))).toBe(pathData(star));
  });

  it("niente ha più nodi di prima: un cerchio d'archi resta d'archi", () => {
    const circle = shapeSegments("circle", [["cx", "50"], ["cy", "50"], ["r", "40"]]);
    expect(pathData(simplified(circle, 0.5))).toBe(pathData(circle));
  });

  it("un rettangolo arrotondato tiene i lati dritti", () => {
    const rounded = rectPath(0, 0, 200, 120, 30, 30);
    const out = simple(rounded, 0.5);
    expect(lines(out)).toBe(4);
    expect(nodeCount(out)).toBeLessThanOrEqual(nodeCount(rounded));
    expect(deviation(rounded, out)).toBeLessThan(0.55);
  });

  it("un poligono fitto diventa una curva liscia", () => {
    const many = polygon(96, 100);
    const out = simple(many, 0.5);
    expect(nodeCount(out)).toBeLessThanOrEqual(8);
    expect(deviation(many, out)).toBeLessThan(0.55);
    const [sub] = readNodes(out);
    // Liscia ovunque, anche dove comincia.
    for (let k = 0; k < sub!.nodes.length; k++) expect(kindOf(sub!, k)).not.toBe("corner");
  });

  it("un cerchio tremolante si liscia entro la tolleranza", () => {
    const shaky = polygon(300, 80, 0.3, 7);
    const out = simple(shaky, 1);
    expect(nodeCount(out)).toBeLessThanOrEqual(12);
    expect(deviation(shaky, out)).toBeLessThan(1.05);
  });

  it("un'onda aperta: meno nodi, gli stessi capi", () => {
    const points = Array.from({ length: 401 }, (_, i): Point => [i, 30 * Math.sin(i / 40)]);
    const wave: Segment[] = [{ kind: "move", to: points[0]! }, ...points.slice(1).map((to): Segment => ({ kind: "line", to }))];
    const out = simple(wave, 0.25);
    expect(nodeCount(out)).toBeLessThanOrEqual(16);
    expect(deviation(wave, out)).toBeLessThan(0.3);
    const [sub] = readNodes(out);
    expect(sub!.closed).toBe(false);
    expect(sub!.nodes[0]).toEqual(points[0]);
    expect(sub!.nodes[sub!.nodes.length - 1]).toEqual([400, Number((30 * Math.sin(10)).toFixed(2))]);
  });

  it("le linee di fila su una retta diventano una; un'inversione resta", () => {
    expect(pathData(simplified(path("M0 0 L50 0 L100 0 L100 50"), 1))).toBe("M0 0 L100 0 L100 50");
    expect(pathData(simplified(path("M0 0 L100 0 L50 0"), 1))).toBe("M0 0 L100 0 L50 0");
  });

  it("una linea lunga che prosegue liscia dà il verso alla curva accanto", () => {
    // Uno stadio fatto di tante linee: i lati lunghi restano, le curve
    // fitte diventano poche cubiche che vi arrivano lisce.
    const arc = (cx: number, from: number): Point[] =>
      Array.from({ length: 33 }, (_, i): Point => {
        const a = from + (Math.PI * i) / 32;
        return [cx + 50 * Math.cos(a), 50 + 50 * Math.sin(a)];
      });
    const points = [...arc(200, -Math.PI / 2), ...arc(0, Math.PI / 2)];
    const stadium: Segment[] = [{ kind: "move", to: points[0]! }, ...points.slice(1).map((to): Segment => ({ kind: "line", to })), { kind: "close" }];
    const out = simple(stadium, 0.5);
    expect(nodeCount(out)).toBeLessThanOrEqual(10);
    expect(deviation(stadium, out)).toBeLessThan(0.55);
  });

  it("un anello resta di due sottotracciati", () => {
    const ring = [...polygon(80, 100), ...polygon(40, 50)];
    const out = simple(ring, 0.5);
    expect(readNodes(out)).toHaveLength(2);
    expect(nodeCount(out)).toBeLessThanOrEqual(16);
    expect(deviation(ring, out)).toBeLessThan(0.55);
  });

  it("un contorno di penna perde i nodi che non si vedono", () => {
    // Un nastro attorno a un'onda, largo da 2 a 6, come lo scrive la penna:
    // una quadratica per vertice.
    const side = (sign: number): Point[] =>
      Array.from({ length: 200 }, (_, i): Point => {
        const x = i * 2;
        const y = 40 * Math.sin(x / 50);
        const slope = (40 / 50) * Math.cos(x / 50);
        const l = Math.hypot(1, slope);
        const w = 1 + 2 * Math.sin((Math.PI * i) / 199);
        return [x - (sign * w * slope) / l, y + (sign * w) / l];
      });
    const outline = path(outlinePath([...side(1), ...side(-1).reverse()]));
    const out = simple(outline, 0.05);
    expect(nodeCount(out) * 4).toBeLessThan(nodeCount(outline));
    expect(deviation(outline, out, 0.05)).toBeLessThan(0.06);
  });

  it("senza tolleranza o senza nodi da togliere non cambia niente", () => {
    const wave = path("M0 0 C10 10 20 10 30 0 S50 -10 60 0");
    expect(simplified(wave, 0)).toEqual(wave);
    expect(simplified(wave, Number.NaN)).toEqual(wave);
    expect(simplified(path("M5 5"), 1)).toEqual(path("M5 5"));
    expect(pathData(simplified(path("M0 0 L10 0"), 1))).toBe("M0 0 L10 0");
  });

  it("cinquecento nodi in meno di un fotogramma", () => {
    const shaky = polygon(500, 150, 0.5, 3);
    simplified(shaky, 0.5);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      simplified(shaky, 0.5);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    expect(runs[2]).toBeLessThan(16);
  });
});
