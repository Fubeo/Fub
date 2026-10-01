// Test della forma del grafo: dove nascono i nodi e dove si fermano. Le
// misure sono quelle che si vedono — archi che si incrociano, foglie lontane
// dal loro nodo, nodi addosso ad altri nodi o ad archi non loro — e il grafo
// si assesta come nel grafico: alpha da 1 alla soglia d'arresto, a 60 Hz.

import { describe, expect, it } from "vitest";
import { accumulateForces, CLEARANCE_ALPHA, EDGE_CLEARANCE, PERSONAL_SPACE } from "./forces";
import { DT, step, type EngineState } from "./engine";
import { LEAF_REST, createStructure, crowdRadius, organicConfig, restLengths, seedOf, type GraphData, type Structure } from "./types";

const L0 = organicConfig().baseLength;

/// Quattro hub con 12, 7, 4 e 2 foglie, legati fra loro, e tre note isolate.
function stars(): GraphData {
  const nodes: string[] = [];
  const edges: { from: string; to: string }[] = [];
  for (const [hub, leaves] of [["A", 12], ["B", 7], ["C", 4], ["D", 2]] as const) {
    nodes.push(hub);
    for (let i = 0; i < leaves; i++) {
      nodes.push(`${hub}${i}`);
      edges.push({ from: `${hub}${i}`, to: hub });
    }
  }
  edges.push({ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "D" }, { from: "A", to: "C" });
  nodes.push("isolata1", "isolata2", "isolata3");
  return { nodes, edges };
}

/// Il grafo del banco visivo: una catena con due foglie in fondo e una in cima.
const BENCH: GraphData = {
  nodes: ["Benvenuto", "Sintassi", "Frammenti", "Diario", "Banco", "Idea"],
  edges: [
    { from: "Benvenuto", to: "Sintassi" },
    { from: "Benvenuto", to: "Frammenti" },
    { from: "Banco", to: "Sintassi" },
    { from: "Diario", to: "Banco" },
    { from: "Idea", to: "Banco" },
  ],
};

function settle(data: GraphData): Structure {
  const config = organicConfig();
  const s = createStructure(data, config, seedOf(data));
  const state: EngineState = { alpha: 1, quietSince: 0 };
  while (state.alpha > 0.02) step(s, config, state, null, DT);
  return s;
}

function crossings(s: Structure): number {
  const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  let count = 0;
  for (let a = 0; a < s.m; a++) {
    for (let b = a + 1; b < s.m; b++) {
      const [p, q, r, t] = [s.from[a], s.to[a], s.from[b], s.to[b]];
      if (p === r || p === t || q === r || q === t) continue;
      const one = side(s.x[p], s.y[p], s.x[q], s.y[q], s.x[r], s.y[r]) * side(s.x[p], s.y[p], s.x[q], s.y[q], s.x[t], s.y[t]);
      const two = side(s.x[r], s.y[r], s.x[t], s.y[t], s.x[p], s.y[p]) * side(s.x[r], s.y[r], s.x[t], s.y[t], s.x[q], s.y[q]);
      if (one < 0 && two < 0) count++;
    }
  }
  return count;
}

/// La distanza più piccola fra un nodo e un arco che non è suo.
function closestToForeignEdge(s: Structure): number {
  let best = Infinity;
  for (let i = 0; i < s.n; i++) {
    for (let e = 0; e < s.m; e++) {
      const a = s.from[e];
      const b = s.to[e];
      if (a === i || b === i) continue;
      const vx = s.x[b] - s.x[a];
      const vy = s.y[b] - s.y[a];
      const t = Math.max(0, Math.min(1, ((s.x[i] - s.x[a]) * vx + (s.y[i] - s.y[a]) * vy) / (vx * vx + vy * vy)));
      best = Math.min(best, Math.hypot(s.x[i] - s.x[a] - t * vx, s.y[i] - s.y[a] - t * vy));
    }
  }
  return best;
}

function closestPair(s: Structure): number {
  let best = Infinity;
  for (let i = 0; i < s.n; i++) {
    for (let j = i + 1; j < s.n; j++) best = Math.min(best, Math.hypot(s.x[i] - s.x[j], s.y[i] - s.y[j]));
  }
  return best;
}

/// Il nodo di ogni foglia, −1 per chi non è una foglia.
function parents(s: Structure): Int32Array {
  const parent = new Int32Array(s.n).fill(-1);
  for (let e = 0; e < s.m; e++) {
    if (s.degree[s.from[e]] === 1) parent[s.from[e]] = s.to[e];
    if (s.degree[s.to[e]] === 1) parent[s.to[e]] = s.from[e];
  }
  return parent;
}

describe("layout — lunghezze di riposo", () => {
  it("una foglia sta sul ventaglio del suo nodo, che cresce coi vicini e poi rallenta", () => {
    expect(crowdRadius(1)).toBe(LEAF_REST);
    expect(crowdRadius(4)).toBe(LEAF_REST);
    // Lineare fino a dodici vicini, poi con la radice: sessanta foglie non
    // fanno un anello cinque volte più largo di dodici.
    expect(crowdRadius(12)).toBeGreaterThan(crowdRadius(8));
    expect(crowdRadius(48) / crowdRadius(12)).toBeCloseTo(2, 5);
  });

  it("foglia, hub e coppie: ognuno la sua lunghezza, mai una foglia oltre il ventaglio", () => {
    const s = createStructure(stars(), organicConfig(), 1);
    const rest = restLengths(s);
    const index = (id: string): number => s.id.indexOf(id);
    for (let e = 0; e < s.m; e++) {
      const [i, j] = [s.from[e], s.to[e]];
      const leaf = s.degree[i] === 1 ? i : s.degree[j] === 1 ? j : -1;
      if (leaf >= 0) {
        const hub = leaf === i ? j : i;
        expect(rest[e]).toBeCloseTo(crowdRadius(s.degree[hub]), 5);
      } else {
        expect(rest[e]).toBeGreaterThanOrEqual(1);
        expect(rest[e]).toBeCloseTo(Math.max(1, crowdRadius(s.degree[i]), crowdRadius(s.degree[j])), 5);
      }
    }
    // Le foglie di A (tredici vicini) stanno più lontane di quelle di D (tre).
    const leafEdge = (hub: string): number => {
      for (let e = 0; e < s.m; e++) if (s.to[e] === index(hub) && s.degree[s.from[e]] === 1) return e;
      return -1;
    };
    expect(rest[leafEdge("A")]).toBeGreaterThan(rest[leafEdge("D")]);
  });
});

describe("layout — semina", () => {
  it("le foglie nascono attorno al loro nodo, dalla parte opposta al resto", () => {
    const s = createStructure(stars(), organicConfig(), 1);
    const rest = restLengths(s);
    const parent = parents(s);
    for (let e = 0; e < s.m; e++) {
      const leaf = s.degree[s.from[e]] === 1 ? s.from[e] : s.degree[s.to[e]] === 1 ? s.to[e] : -1;
      if (leaf < 0) continue;
      const hub = parent[leaf];
      const d = Math.hypot(s.x[leaf] - s.x[hub], s.y[leaf] - s.y[hub]);
      // Alla lunghezza di riposo, a meno del jitter.
      expect(Math.abs(d / (rest[e] * L0) - 1)).toBeLessThan(0.1);
    }
    // Le note isolate partono fuori dal gruppo, non in mezzo.
    let reach = 0;
    for (let i = 0; i < s.n; i++) if (s.degree[i] > 0) reach = Math.max(reach, Math.hypot(s.x[i], s.y[i]));
    for (let i = 0; i < s.n; i++) if (s.degree[i] === 0) expect(Math.hypot(s.x[i], s.y[i])).toBeGreaterThan(reach);
  });

  it("è deterministica: stesso grafo, stesse posizioni", () => {
    const a = createStructure(stars(), organicConfig(), seedOf(stars()));
    const b = createStructure(stars(), organicConfig(), seedOf(stars()));
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
  });

  it("col jitter a zero una catena parte dritta, col jitter serpeggia", () => {
    const chain: GraphData = { nodes: ["a", "b", "c", "d", "e"], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "e" }] };
    /// Distanza fra i due capi sulla lunghezza del cammino, in media su più
    /// semi: 1 è una riga dritta.
    const straightness = (jitter: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = createStructure(chain, { ...organicConfig(), jitter }, seed);
        let path = 0;
        for (let e = 0; e < s.m; e++) path += Math.hypot(s.x[s.to[e]] - s.x[s.from[e]], s.y[s.to[e]] - s.y[s.from[e]]);
        const [a, e] = [s.id.indexOf("a"), s.id.indexOf("e")];
        sum += Math.hypot(s.x[a] - s.x[e], s.y[a] - s.y[e]) / path;
      }
      return sum / 6;
    };
    expect(straightness(0)).toBeCloseTo(1, 3);
    expect(straightness(0.6)).toBeLessThan(0.97);
  });
});

describe("layout — forze a corto raggio", () => {
  it("lo spazio personale separa due nodi vicini e non tocca quelli lontani", () => {
    const data: GraphData = { nodes: ["a", "b", "c"], edges: [] };
    const config = { ...organicConfig(), repulsion: 200, gravity: 0 };
    const s = createStructure(data, config, 1);
    s.x.set([0, 20, 20 + PERSONAL_SPACE * L0 + 10]);
    s.y.set([0, 0, 0]);
    accumulateForces(s, { ...config, repulsion: 200 }, null, 1);
    const repulsionOnly = createStructure(data, config, 1);
    repulsionOnly.x.set([0, 20, 20 + PERSONAL_SPACE * L0 + 10]);
    repulsionOnly.y.set([0, 0, 0]);
    accumulateForces(repulsionOnly, config, null, 3);
    // Al tier 3 lo spazio personale è spento: la differenza è tutta sua.
    expect(s.fx[0] - repulsionOnly.fx[0]).toBeLessThan(-1000);
    expect(s.fx[1] - repulsionOnly.fx[1]).toBeGreaterThan(1000);
    expect(s.fx[2] - repulsionOnly.fx[2]).toBeCloseTo(0, 3);
  });

  it("un nodo appoggiato su un arco non suo ne viene spinto via, solo a grafo freddo", () => {
    const data: GraphData = { nodes: ["a", "b", "c"], edges: [{ from: "a", to: "b" }] };
    const config = { ...organicConfig(), repulsion: 200, gravity: 0, springStiffness: 0.01 };
    const place = (s: Structure): void => {
      s.x.set([-100, 100, 0]);
      s.y.set([0, 0, EDGE_CLEARANCE * L0 * 0.5]);
      s.vx.fill(0);
      s.vy.fill(0);
    };
    const hot = createStructure(data, config, 1);
    place(hot);
    accumulateForces(hot, config, null, 1, null, CLEARANCE_ALPHA);
    const cold = createStructure(data, config, 1);
    place(cold);
    accumulateForces(cold, config, null, 1, null, 0);
    const c = cold.id.indexOf("c");
    const a = cold.id.indexOf("a");
    const b = cold.id.indexOf("b");
    // Via dall'arco, lungo la perpendicolare.
    expect(cold.fy[c] - hot.fy[c]).toBeGreaterThan(1000);
    // Gli estremi ricevono la spinta opposta, metà per uno: niente moto netto.
    const push = cold.fy[c] - hot.fy[c];
    expect(cold.fy[a] - hot.fy[a] + cold.fy[b] - hot.fy[b]).toBeCloseTo(-push, 0);
  });
});

describe("layout — il grafo assestato", () => {
  it("le stelle: nessun incrocio, foglie vicine al loro nodo, nessuno addosso a nessuno", () => {
    const s = settle(stars());
    expect(crossings(s)).toBe(0);
    const rest = restLengths(s);
    const parent = parents(s);
    for (let e = 0; e < s.m; e++) {
      const leaf = s.degree[s.from[e]] === 1 ? s.from[e] : s.degree[s.to[e]] === 1 ? s.to[e] : -1;
      if (leaf < 0) continue;
      const hub = parent[leaf];
      expect(Math.hypot(s.x[leaf] - s.x[hub], s.y[leaf] - s.y[hub])).toBeLessThan(1.5 * rest[e] * L0);
    }
    expect(closestPair(s)).toBeGreaterThan(0.35 * L0);
    expect(closestToForeignEdge(s)).toBeGreaterThan(0.2 * L0);
  });

  it("le note isolate restano attorno al grafo, fuori dal nucleo", () => {
    const s = settle(stars());
    let cx = 0;
    let cy = 0;
    let k = 0;
    for (let i = 0; i < s.n; i++) {
      if (s.degree[i] === 0) continue;
      cx += s.x[i];
      cy += s.y[i];
      k++;
    }
    cx /= k;
    cy /= k;
    const connected: number[] = [];
    for (let i = 0; i < s.n; i++) if (s.degree[i] > 0) connected.push(Math.hypot(s.x[i] - cx, s.y[i] - cy));
    connected.sort((a, b) => a - b);
    const median = connected[connected.length >> 1]!;
    const far = connected[connected.length - 1]!;
    for (let i = 0; i < s.n; i++) {
      if (s.degree[i] !== 0) continue;
      const d = Math.hypot(s.x[i] - cx, s.y[i] - cy);
      expect(d).toBeGreaterThan(median);
      expect(d).toBeLessThan(2 * far);
    }
  });

  it("il grafo del banco: le foglie stanno col loro nodo, e nessun arco ne attraversa un altro", () => {
    const s = settle(BENCH);
    expect(crossings(s)).toBe(0);
    const banco = s.id.indexOf("Banco");
    for (const leaf of ["Diario", "Idea"]) {
      const i = s.id.indexOf(leaf);
      expect(Math.hypot(s.x[i] - s.x[banco], s.y[i] - s.y[banco])).toBeLessThan(1.2 * L0);
    }
    expect(closestToForeignEdge(s)).toBeGreaterThan(0.25 * L0);
  });
});
