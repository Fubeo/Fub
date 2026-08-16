// Test del quadtree Barnes-Hut: convergenza a theta→0 (replica l'O(n²)) e
// `vicino` rispetta il raggio e trova il più vicino. Niente Canvas2D, niente
// performance.now: tutto deterministico.

import { describe, expect, it } from "vitest";
import { costruisci, PoolQuad, visita, vicino, type Quadtree } from "./quadtree";
import { confOrganica, creaStruttura, type DatiGrafo, type Struttura } from "./tipi";

/// Un grafo a forma di stella deterministica: n nodi su spirale di girasole
/// con jitter fisso, masse crescenti per grado (qualche arco). Abbastanza
/// nodi da far splittare l'albero, non così tanti da rendere l'O(n²) lento
/// nel test.
function grafoTest(n: number, archi: number): Struttura {
  const nodes: string[] = [];
  for (let i = 0; i < n; i++) nodes.push("n" + i);
  const edges: { from: string; to: string }[] = [];
  // Archi a catena + qualche lungo: dà gradi variabili (masse diverse).
  for (let i = 0; i < archi; i++) {
    const da = i % n;
    const a = (i * 7 + 3) % n;
    if (da !== a) edges.push({ from: "n" + da, to: "n" + a });
  }
  const dati: DatiGrafo = { nodes, edges };
  return creaStruttura(dati, confOrganica(), 42);
}

/// Repulsione esatta O(n²) per un nodo, in Float64 (riferimento di precisione).
function repulsioneEsatta(s: Struttura, i: number, rep: number): [number, number] {
  let fx = 0;
  let fy = 0;
  for (let j = 0; j < s.n; j++) {
    if (j === i) continue;
    const dx = s.x[j] - s.x[i];
    const dy = s.y[j] - s.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-4) continue;
    const inv = 1 / Math.sqrt(d2);
    const f = (rep * s.massa[j]) / (d2 + 64);
    fx -= f * dx * inv;
    fy -= f * dy * inv;
  }
  return [fx, fy];
}

/// Repulsione Barnes-Hut per un nodo, accumulando in Float64.
function repulsioneBH(q: Quadtree, s: Struttura, i: number, theta: number, rep: number): [number, number] {
  let fx = 0;
  let fy = 0;
  visita(q, theta, s.x[i], s.y[i], (dx, dy, d2, massa) => {
    if (d2 < 1e-4) return;
    const inv = 1 / Math.sqrt(d2);
    const f = (rep * massa) / (d2 + 64);
    fx -= f * dx * inv;
    fy -= f * dy * inv;
  });
  return [fx, fy];
}

describe("quadtree — Barnes-Hut", () => {
  it("a theta → 0 replica la repulsione O(n²) entro 1e-3 relativo", () => {
    const s = grafoTest(50, 40);
    const pool = new PoolQuad();
    const q = costruisci(s, pool);
    const rep = confOrganica().repulsione;
    let maxRel = 0;
    for (let i = 0; i < s.n; i++) {
      const [fxo, fyo] = repulsioneEsatta(s, i, rep);
      const [fxb, fyb] = repulsioneBH(q, s, i, 0, rep);
      const rel = Math.hypot(fxb - fxo, fyb - fyo) / Math.max(1, Math.hypot(fxo, fyo));
      if (rel > maxRel) maxRel = rel;
    }
    // Con theta = 0 si scende sempre: nessuna approssimazione, solo
    // differenze di ordine di somma (Float64 qui dentro) → ~1e-15.
    expect(maxRel).toBeLessThan(1e-3);
  });

  it("a theta = 0.9 la repulsione è vicina ma non esatta (approssimazione)", () => {
    const s = grafoTest(50, 40);
    const pool = new PoolQuad();
    const q = costruisci(s, pool);
    const rep = confOrganica().repulsione;
    let maxRel = 0;
    for (let i = 0; i < s.n; i++) {
      const [fxo, fyo] = repulsioneEsatta(s, i, rep);
      const [fxb, fyb] = repulsioneBH(q, s, i, 0.9, rep);
      const rel = Math.hypot(fxb - fxo, fyb - fyo) / Math.max(1, Math.hypot(fxo, fyo));
      if (rel > maxRel) maxRel = rel;
    }
    // L'approssimazione BH con theta 0.9 introduce errore, ma contenuto:
    // la fisica percepita non cambia. Verifica solo che non diverge.
    expect(maxRel).toBeLessThan(1);
  });

  it("il pool si riusa senza allocare: due costruzioni danno lo stesso albero", () => {
    const s = grafoTest(30, 20);
    const pool = new PoolQuad();
    costruisci(s, pool);
    const usati1 = pool.usati;
    // Sposta un nodo e ricostruisce: stesso pool, capacità riusata.
    s.x[0] += 5;
    costruisci(s, pool);
    const usati2 = pool.usati;
    // Stesso numero di nodi dell'albero (la forma del grafo non è cambiata).
    expect(usati2).toBe(usati1);
    // La visita torna coerente.
    const rep = confOrganica().repulsione;
    const [fxo, fyo] = repulsioneEsatta(s, 0, rep);
    const [fxb, fyb] = repulsioneBH(pool, s, 0, 0, rep);
    expect(Math.hypot(fxb - fxo, fyb - fyo) / Math.max(1, Math.hypot(fxo, fyo))).toBeLessThan(1e-3);
  });
});

describe("quadtree — vicino", () => {
  it("su un nodo con r > 0 trova il nodo stesso (d2 = 0)", () => {
    const s = grafoTest(30, 20);
    const pool = new PoolQuad();
    const q = costruisci(s, pool);
    for (let i = 0; i < s.n; i++) {
      expect(vicino(q, s.x[i], s.y[i], 1)).toBe(i);
    }
  });

  it("rispetta il raggio: −1 se nessun nodo entro r", () => {
    const s = grafoTest(20, 10);
    const pool = new PoolQuad();
    const q = costruisci(s, pool);
    // Punto lontano da tutti i nodi: nessuno entro r piccolo.
    expect(vicino(q, 1e6, 1e6, 1)).toBe(-1);
    expect(vicino(q, 1e6, 1e6, 0)).toBe(-1);
  });

  it("trova il più vicino come la forza bruta (300 query casuali)", () => {
    const s = grafoTest(40, 30);
    const pool = new PoolQuad();
    const q = costruisci(s, pool);
    // RNG deterministico (mulberry32, seme 7).
    let a = 7 >>> 0;
    const rng = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let p = 0; p < 300; p++) {
      const x = (rng() - 0.5) * 600;
      const y = (rng() - 0.5) * 600;
      const r = rng() * 120 + 5;
      // Forza bruta: min d2 ≤ r², primo in ordine di indice sui tie.
      let bestB = -1;
      let bestD2 = r * r;
      for (let j = 0; j < s.n; j++) {
        const dx = s.x[j] - x;
        const dy = s.y[j] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          bestB = j;
        }
      }
      const res = vicino(q, x, y, r);
      if (bestB === -1) {
        expect(res).toBe(-1);
      } else {
        expect(res).not.toBe(-1);
        const dx = s.x[res] - x;
        const dy = s.y[res] - y;
        const d2 = dx * dx + dy * dy;
        // Stessa distanza minima (gli indici possono differire solo su tie,
        // che con posizioni generiche non accade).
        expect(d2).toBeCloseTo(bestD2, 5);
      }
    }
  });
});