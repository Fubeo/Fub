// L'albero dei riquadri dà esattamente ciò che dà il confronto diretto, per
// ogni riquadro e ogni ricerca, anche quelli strani.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import { BoxTree, group } from "./box-tree";

/// Un generatore pseudocasuale con seme (mulberry32): le prove si ripetono.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Il confronto diretto, lo stesso di `near` nell'indice degli oggetti.
function scan(boxes: readonly (Bounds | null)[], minX: number, minY: number, maxX: number, maxY: number): number[] {
  const found: number[] = [];
  boxes.forEach((box, i) => {
    if (box !== null && maxX >= box.min[0] && minX <= box.max[0] && maxY >= box.min[1] && minY <= box.max[1]) found.push(i);
  });
  return found;
}

/// Riquadri sparsi e di ogni misura, con qualche caso strano: assenti,
/// punti, rovesciati, con una coordinata che non è un numero o infinita.
function boxes(next: () => number, count: number): Array<Bounds | null> {
  return Array.from({ length: count }, (_, i): Bounds | null => {
    const x = next() * 1_000 - 100;
    const y = next() * 1_000 - 100;
    switch (i % 23) {
      case 3:
        return null;
      case 7:
        return { min: [x, y], max: [x, y] };
      case 11:
        return { min: [x + 5, y], max: [x, y + 5] };
      case 13:
        return { min: [x, Number.NaN], max: [x + 1, y + 1] };
      case 17:
        return { min: [-Infinity, y], max: [x, y + 2] };
      case 19:
        return { min: [x, y], max: [x + next() * 900, y + next() * 900] };
      default:
        return { min: [x, y], max: [x + next() * 30, y + next() * 30] };
    }
  });
}

describe("l'albero dei riquadri", () => {
  it("dà i riquadri del confronto diretto, in ordine, a ogni grandezza", () => {
    const next = random(7);
    let found = 0;
    for (const count of [0, 1, 2, 15, 16, 17, 255, 256, 257, 1_000, 4_097]) {
      const all = boxes(next, count);
      const tree = new BoxTree(all);
      for (let q = 0; q < 200; q++) {
        const x = next() * 1_100 - 150;
        const y = next() * 1_100 - 150;
        const w = q % 5 === 0 ? 0 : next() * (q % 2 === 0 ? 20 : 300);
        const h = q % 5 === 0 ? 0 : next() * 40;
        const expected = scan(all, x, y, x + w, y + h);
        expect(tree.search(x, y, x + w, y + h), `${count} riquadri, ricerca ${q}`).toEqual(expected);
        found += expected.length;
      }
    }
    expect(found).toBeGreaterThan(1_000);
  });

  it("ogni riquadro trova sé stesso", () => {
    const all = boxes(random(11), 3_000);
    const tree = new BoxTree(all);
    all.forEach((box, i) => {
      // Uno rovesciato non incontra sé stesso nemmeno nel confronto diretto.
      if (box === null || Number.isNaN(box.min[1]) || box.min[0] > box.max[0]) return;
      expect(tree.search(box.min[0], box.min[1], box.max[0], box.max[1])).toContain(i);
    });
  });

  it("con una ricerca strana fa come il confronto diretto", () => {
    const all = boxes(random(3), 600);
    const tree = new BoxTree(all);
    const strange: Array<[number, number, number, number]> = [
      [Number.NaN, 0, 100, 100],
      [0, 0, Number.NaN, 100],
      [-Infinity, -Infinity, Infinity, Infinity],
      [-Infinity, 400, Infinity, 410],
      [500, 500, 400, 400],
      [1e300, 1e300, 1e301, 1e301],
      [-1e-300, -1e-300, 1e-300, 1e-300],
    ];
    for (const [minX, minY, maxX, maxY] of strange) {
      expect(tree.search(minX, minY, maxX, maxY)).toEqual(scan(all, minX, minY, maxX, maxY));
    }
    expect(tree.search(-Infinity, -Infinity, Infinity, Infinity).length).toBeGreaterThan(500);
  });

  it("divide le posizioni in blocchi ordinati fra loro", () => {
    const next = random(19);
    for (const [count, size, from, to] of [[1_000, 16, 0, 1_000], [1_000, 100, 0, 1_000], [500, 16, 32, 437], [40, 16, 0, 40], [16, 16, 0, 16], [0, 16, 0, 0]] as const) {
      // Chiavi ripetute e infinite, come centri di riquadri uguali o senza fine.
      const keys = Float64Array.from({ length: count }, (_, k) => (k % 9 === 0 ? 7 : k % 31 === 0 ? -Infinity : Math.floor(next() * 50)));
      const order = Uint32Array.from({ length: count }, (_, k) => k);
      group(order, keys, from, to, size);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, k) => k));
      expect([...order.subarray(0, from)]).toEqual(Array.from({ length: from }, (_, k) => k));
      for (let cut = from + size; cut < to; cut += size) {
        const before = Math.max(...[...order.subarray(from, cut)].map((k) => keys[k]!));
        const after = Math.min(...[...order.subarray(cut, to)].map((k) => keys[k]!));
        expect(before, `${count} a blocchi di ${size}, confine ${cut}`).toBeLessThanOrEqual(after);
      }
    }
  });

  it("con riquadri tutti uguali li dà tutti", () => {
    const same: Bounds = { min: [1, 1], max: [2, 2] };
    const tree = new BoxTree(Array.from({ length: 300 }, () => same));
    expect(tree.search(1.5, 1.5, 1.5, 1.5)).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(tree.search(3, 3, 4, 4)).toEqual([]);
  });
});
