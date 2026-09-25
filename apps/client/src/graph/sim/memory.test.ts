// Test della memoria del layout: cosa si ritrova dopo uno smontaggio, e
// quando invece il grafo è troppo diverso e va rifatto da capo.

import { describe, expect, it } from "vitest";
import { RESTORE_OVERLAP, restoreLayout, snapshotLayout } from "./memory";
import { createStructure, organicConfig, seedOf, type GraphData } from "./types";

function graph(nodes: string[], edges: [string, string][] = []): GraphData {
  return { nodes, edges: edges.map(([from, to]) => ({ from, to })) };
}

function seeded(data: GraphData) {
  return createStructure(data, organicConfig(), seedOf(data));
}

describe("snapshotLayout", () => {
  it("fotografa posizioni e pin per id", () => {
    const s = seeded(graph(["a", "b", "c"]));
    s.x[1] = 40;
    s.y[1] = -12;
    s.fixed[2] = 1;
    // il nodo trascinato (2) non è un pin dell'utente
    s.fixed[0] = 2;
    const saved = snapshotLayout(s, 0.4, { scale: 1.5, centerX: 3, centerY: 4 }, false);
    expect(saved.positions.get("b")).toEqual([40, -12]);
    expect([...saved.pinned]).toEqual(["c"]);
    expect(saved.alpha).toBe(0.4);
    expect(saved.camera).toEqual({ scale: 1.5, centerX: 3, centerY: 4 });
    expect(saved.following).toBe(false);
  });
});

describe("restoreLayout", () => {
  it("rimette posizioni e pin dello stesso grafo e non aggiunge nulla", () => {
    const data = graph(["a", "b", "c"], [["a", "b"]]);
    const before = seeded(data);
    before.x.set([10, 20, 30]);
    before.y.set([-1, -2, -3]);
    before.fixed[1] = 1;
    const saved = snapshotLayout(before, 0, null, false);

    const after = seeded(data);
    expect(restoreLayout(after, saved, 30)).toBe(0);
    expect(Array.from(after.x)).toEqual([10, 20, 30]);
    expect(Array.from(after.y)).toEqual([-1, -2, -3]);
    expect(Array.from(after.fixed)).toEqual([0, 1, 0]);
  });

  it("rifiuta un grafo che coincide troppo poco e lascia la semina", () => {
    const whole = seeded(graph(Array.from({ length: 10 }, (_, i) => "n" + i)));
    const saved = snapshotLayout(whole, 0, null, false);
    // il grafo locale di una nota: tutti noti, ma sono 3 su 10 ricordati
    const local = seeded(graph(["n0", "n1", "n2"]));
    const x = Array.from(local.x);
    expect(3 / 10).toBeLessThan(RESTORE_OVERLAP);
    expect(restoreLayout(local, saved, 30)).toBeNull();
    expect(Array.from(local.x)).toEqual(x);
    // e un grafo di nodi quasi tutti nuovi
    const other = seeded(graph(["n0", "x1", "x2", "x3"]));
    expect(restoreLayout(other, saved, 30)).toBeNull();
    expect(restoreLayout(seeded(graph(["z"])), saved, 30)).toBeNull();
  });

  it("fa nascere un nodo nuovo accanto ai vicini già piazzati", () => {
    const names = Array.from({ length: 8 }, (_, i) => "n" + i);
    const before = seeded(graph(names));
    for (let i = 0; i < before.n; i++) {
      before.x[i] = i * 100;
      before.y[i] = 0;
    }
    const saved = snapshotLayout(before, 0, null, false);

    const after = seeded(graph([...names, "nuovo"], [["n3", "nuovo"], ["nuovo", "n4"]]));
    expect(restoreLayout(after, saved, 30)).toBe(1);
    const k = after.id.indexOf("nuovo");
    // il baricentro dei vicini è (350, 0): a mezza molla di distanza
    expect(Math.hypot(after.x[k] - 350, after.y[k])).toBeCloseTo(15, 3);
  });

  it("mette un nodo nuovo senza vicini noti appena fuori dal grafo", () => {
    const names = Array.from({ length: 8 }, (_, i) => "n" + i);
    const before = seeded(graph(names));
    for (let i = 0; i < before.n; i++) {
      const angle = (i / before.n) * Math.PI * 2;
      before.x[i] = 100 * Math.cos(angle);
      before.y[i] = 100 * Math.sin(angle);
    }
    const saved = snapshotLayout(before, 0, null, false);

    const after = seeded(graph([...names, "isolato"]));
    expect(restoreLayout(after, saved, 30)).toBe(1);
    const k = after.id.indexOf("isolato");
    expect(Math.hypot(after.x[k], after.y[k])).toBeCloseTo(130, 2);
  });
});
