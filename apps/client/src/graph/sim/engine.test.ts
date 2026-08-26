// Test del motore e delle forze. Niente Canvas2D, niente performance.now:
// il dt è passato a mano a `step`. Le posizioni iniziali sono impostate
// esplicitamente (non si rely sulla semina: l'attrito rende la dinamica
// lenta e una coppia fuori banda non la rientra in 200 passi).

import { describe, expect, it } from "vitest";
import { accumulateForces } from "./forces";
import { DT, calculateTier, energy, step, type EngineState } from "./engine";
import { build, QuadtreePool } from "./quadtree";
import { organicConfig, createStructure, type PhysicsConfig, type GraphData, type Structure } from "./types";

/// Costruisce una `Structure` a mano con n nodi e m archi, tutto zero tranne
/// massa/raggio (di default 1 e 4). I test la personalizzano dopo.
function structure(n: number, m: number): Structure {
  return {
    x: new Float32Array(n),
    y: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    fx: new Float32Array(n),
    fy: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    mass: new Float32Array(n).fill(1),
    radius: new Float32Array(n).fill(4),
    degree: new Uint16Array(n),
    fixed: new Uint8Array(n),
    dragged: -1,
    id: Array.from({ length: n }, (_, i) => "n" + i),
    from: new Uint32Array(m),
    to: new Uint32Array(m),
    curvature: new Float32Array(m),
    n,
    m,
  };
}

/// Conf organica con override (copia, non muta il preset).
function config(over: Partial<PhysicsConfig> = {}): PhysicsConfig {
  return { ...organicConfig(), ...over };
}

function newState(): EngineState {
  return { alpha: 1, quietSince: 0 };
}

/// Coppia isolata: 2 nodi, 1 arco, grado 0 → L0_e = 120, massa 1.
function pair(L: number): Structure {
  const s = structure(2, 1);
  s.x[0] = -L / 2;
  s.x[1] = L / 2;
  s.from[0] = 0;
  s.to[0] = 1;
  return s;
}

describe("forze — repulsion", () => {
  it("è simmetrica: il momento totale è ~0 con masse uguali", () => {
    const s = structure(3, 0);
    s.x[0] = 0;
    s.y[0] = 0;
    s.x[1] = 10;
    s.y[1] = 5;
    s.x[2] = -7;
    s.y[2] = 8;
    accumulateForces(s, config({ gravity: 0 }), null, 1);
    // Momento = Σ m·a, con m = 1: Σ fx, Σ fy. Le coppie sono simmetriche al
    // bit (stesso prodotto con segni opposti), quindi la somma è 0 esatto.
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < 3; i++) {
      sx += s.fx[i];
      sy += s.fy[i];
    }
    expect(Math.abs(sx)).toBeLessThan(1e-5);
    expect(Math.abs(sy)).toBeLessThan(1e-5);
  });

  it("allontana: due nodi vicini si respingono lungo l'asse", () => {
    const s = structure(2, 0);
    s.x[0] = -5;
    s.x[1] = 5;
    accumulateForces(s, config({ gravity: 0 }), null, 1);
    // Nodo 0 a sinistra: la repulsione lo spinge a sinistra (−x).
    expect(s.fx[0]).toBeLessThan(0);
    expect(s.fx[1]).toBeGreaterThan(0);
  });
});

describe("forze — molle", () => {
  it("attrae quando la lunghezza supera il riposo (L > L0_e)", () => {
    const s = pair(140); // L0_e = 120, L = 140 > 120
    accumulateForces(s, config({ repulsion: 0, gravity: 0 }), null, 1);
    // Nodo 0 a sinistra: la molla lo tira verso destra (+x, verso il nodo 1).
    expect(s.fx[0]).toBeGreaterThan(0);
    expect(s.fx[1]).toBeLessThan(0);
  });

  it("respinge quando la lunghezza è sotto il riposo (L < L0_e)", () => {
    const s = pair(100); // L = 100 < 120
    accumulateForces(s, config({ repulsion: 0, gravity: 0 }), null, 1);
    // Nodo 0 a sinistra: la molla lo spinge a sinistra (−x, lontano).
    expect(s.fx[0]).toBeLessThan(0);
    expect(s.fx[1]).toBeGreaterThan(0);
  });
});

describe("motore — coppia isolata", () => {
  it("da L = 130 resta nella banda ±15% e si avvicina all'equilibrio", () => {
    const s = pair(130);
    const c = config({ gravity: 0, collisions: false });
    const state = newState();
    const L0 = 130;
    const Lstar = 121.4; // equilibrio repulsione + molla (grado 0, m = 1)
    for (let p = 0; p < 200; p++) step(s, c, state, null, DT);
    const L = s.x[1] - s.x[0];
    // Resta nella banda ±15% di lunghezzaBase (120): [102, 138].
    expect(L).toBeGreaterThanOrEqual(102);
    expect(L).toBeLessThanOrEqual(138);
    // Si avvicina all'equilibrio (la dinamica è lenta: ~0.3 px in 200 passi).
    expect(Math.abs(L - Lstar)).toBeLessThan(Math.abs(L0 - Lstar));
  });

  it("da L = L0_e (120) deriva verso l'equilibrio (> 120) restando in banda", () => {
    const s = pair(120);
    const c = config({ gravity: 0, collisions: false });
    const state = newState();
    for (let p = 0; p < 200; p++) step(s, c, state, null, DT);
    const L = s.x[1] - s.x[0];
    expect(L).toBeGreaterThan(120);
    expect(L).toBeLessThanOrEqual(138);
  });
});

describe("motore — determinismo", () => {
  it("stesso seed e config → posizioni identiche dopo 100 passi (Float32Array)", () => {
    const data: GraphData = {
      nodes: Array.from({ length: 20 }, (_, i) => "n" + i),
      edges: Array.from({ length: 25 }, (_, i) => ({
        from: "n" + (i % 20),
        to: "n" + ((i * 7 + 3) % 20),
      })).filter((e) => e.from !== e.to),
    };
    const c = config();
    const s1 = createStructure(data, c, 99);
    const s2 = createStructure(data, c, 99);
    const pool1 = new QuadtreePool();
    const pool2 = new QuadtreePool();
    const st1 = newState();
    const st2 = newState();
    for (let p = 0; p < 100; p++) {
      const q1 = build(s1, pool1);
      const q2 = build(s2, pool2);
      step(s1, c, st1, q1, DT);
      step(s2, c, st2, q2, DT);
    }
    // Snapshot esatti: stessi bit nei Float32Array.
    for (let i = 0; i < s1.n; i++) {
      expect(s1.x[i]).toBe(s2.x[i]);
      expect(s1.y[i]).toBe(s2.y[i]);
      expect(s1.vx[i]).toBe(s2.vx[i]);
      expect(s1.vy[i]).toBe(s2.vy[i]);
    }
  });
});

describe("motore — tetto di velocità", () => {
  it("|v| non supera mai maxSpeed (50 nodi, 300 passi)", () => {
    const data: GraphData = {
      nodes: Array.from({ length: 50 }, (_, i) => "n" + i),
      edges: Array.from({ length: 60 }, (_, i) => ({
        from: "n" + (i % 50),
        to: "n" + ((i * 11 + 5) % 50),
      })).filter((e) => e.from !== e.to),
    };
    const c = config();
    const s = createStructure(data, c, 3);
    const pool = new QuadtreePool();
    const state = newState();
    const maxV = c.maxSpeed;
    for (let p = 0; p < 300; p++) {
      const q = build(s, pool);
      step(s, c, state, q, DT);
      for (let i = 0; i < s.n; i++) {
        const v = Math.hypot(s.vx[i], s.vy[i]);
        // Tolleranza Float32 per il prodotto di clamp.
        expect(v).toBeLessThanOrEqual(maxV * 1.0001);
      }
    }
  });
});

describe("motore — alpha e dt", () => {
  it("alpha decade monotonicamente", () => {
    const s = structure(1, 0);
    const c = config({ gravity: 0 });
    const state = newState();
    let prev = state.alpha;
    for (let p = 0; p < 100; p++) {
      step(s, c, state, null, DT);
      expect(state.alpha).toBeLessThan(prev);
      prev = state.alpha;
    }
  });

  it("dt è clampano a 1/30: un passo dt=0.5 == due passi dt=1/60 sull'alpha", () => {
    const s1 = structure(1, 0);
    const s2 = structure(1, 0);
    const c = config({ gravity: 0 });
    const st1 = newState();
    const st2 = newState();
    step(s1, c, st1, null, 0.5);
    step(s2, c, st2, null, DT);
    step(s2, c, st2, null, DT);
    // raffreddamento^(1/30·60) = raffreddamento² = due volte raffreddamento^(1/60·60).
    expect(st1.alpha).toBeCloseTo(st2.alpha, 10);
  });
});

describe("motore — energia e quiete", () => {
  it("l'energia decade monotonicamente su un sistema che si assesta", () => {
    const s = structure(1, 0);
    s.vx[0] = 2;
    const c = config({ gravity: 0, repulsion: 0 });
    const state = newState();
    let prev = energy(s);
    for (let p = 0; p < 30; p++) {
      step(s, c, state, null, DT);
      const e = energy(s);
      expect(e).toBeLessThan(prev);
      prev = e;
    }
  });

  it("quietaDa conta i passi sotto soglia e resetta al kick", () => {
    const s = structure(1, 0);
    s.vx[0] = 2;
    const c = config({ gravity: 0, repulsion: 0 });
    const state = newState();
    // E_0 = 2; E_k = 2·0.86^(2k). Sotto 0.25 (~0.242) al passo ~6-7.
    for (let p = 0; p < 5; p++) step(s, c, state, null, DT);
    expect(state.quietSince).toBe(0);
    for (let p = 0; p < 10; p++) step(s, c, state, null, DT);
    expect(state.quietSince).toBeGreaterThan(0);
    // Kick: velocità alta → energia > soglia → quietaDa si azzera.
    s.vx[0] = 10;
    step(s, c, state, null, DT);
    expect(state.quietSince).toBe(0);
  });
});

describe("motore — drag (molla del puntatore)", () => {
  it("il nodo dragged raggiunge il bersaglio in ≤ 4 passi senza oscillare", () => {
    const s = structure(1, 0);
    s.x[0] = 100;
    s.y[0] = 50;
    s.px[0] = -200;
    s.py[0] = 300;
    s.dragged = 0;
    s.fixed[0] = 2; // trascinato: niente attrito, niente clamp
    const c = config({ gravity: 0.02 }); // la gravità è skip sul trascinato
    const state = newState();
    let prevDist = Math.hypot(s.x[0] - s.px[0], s.y[0] - s.py[0]);
    for (let p = 0; p < 4; p++) {
      step(s, c, state, null, DT);
      const dist = Math.hypot(s.x[0] - s.px[0], s.y[0] - s.py[0]);
      // Deadbeat: raggiunge in 1 passo, poi resta. Monotono non crescente.
      expect(dist).toBeLessThanOrEqual(prevDist + 1e-3);
      prevDist = dist;
    }
    // A 4 passi è sul bersaglio.
    expect(prevDist).toBeLessThan(1);
  });

  it("il drag converge anche con dt grande (clamp a 1/30)", () => {
    const s = structure(1, 0);
    s.x[0] = 100;
    s.y[0] = 50;
    s.px[0] = -200;
    s.py[0] = 300;
    s.dragged = 0;
    s.fixed[0] = 2;
    const c = config({ gravity: 0 });
    const state = newState();
    step(s, c, state, null, 0.5); // dtEff = 1/30
    const dist = Math.hypot(s.x[0] - s.px[0], s.y[0] - s.py[0]);
    expect(dist).toBeLessThan(1);
  });
});

describe("motore — casi limite", () => {
  it("n = 1 non esplode (gravità attiva)", () => {
    const s = structure(1, 0);
    s.x[0] = 5000;
    const c = config(); // gravita 0.02
    const state = newState();
    for (let p = 0; p < 200; p++) step(s, c, state, null, DT);
    expect(Number.isFinite(s.x[0])).toBe(true);
    expect(Number.isFinite(s.y[0])).toBe(true);
    expect(Number.isFinite(s.vx[0])).toBe(true);
    expect(Math.hypot(s.vx[0], s.vy[0])).toBeLessThanOrEqual(c.maxSpeed * 1.0001);
  });

  it("n = 2 senza archi non esplode (repulsion pura)", () => {
    const s = structure(2, 0);
    s.x[0] = -5;
    s.x[1] = 5;
    const c = config({ gravity: 0 });
    const state = newState();
    for (let p = 0; p < 200; p++) step(s, c, state, null, DT);
    for (let i = 0; i < 2; i++) {
      expect(Number.isFinite(s.x[i])).toBe(true);
      expect(Number.isFinite(s.y[i])).toBe(true);
      expect(Number.isFinite(s.vx[i])).toBe(true);
    }
  });

  it("mass 0 con un arco non esplode (guard mi > 0)", () => {
    const s = pair(50);
    s.mass[0] = 0;
    const c = config({ gravity: 0, repulsion: 0 });
    const state = newState();
    for (let p = 0; p < 100; p++) step(s, c, state, null, DT);
    for (let i = 0; i < 2; i++) {
      expect(Number.isFinite(s.x[i])).toBe(true);
      expect(Number.isFinite(s.y[i])).toBe(true);
      expect(Number.isFinite(s.vx[i])).toBe(true);
      expect(Number.isNaN(s.fx[i])).toBe(false);
    }
  });
});

describe("motore — livelli", () => {
  it("base: n ≤ 400 → 1, ≤ 2000 → 2, oltre → 3", () => {
    expect(calculateTier(100, 15)).toBe(1);
    expect(calculateTier(400, 15)).toBe(1);
    expect(calculateTier(401, 15)).toBe(2);
    expect(calculateTier(2000, 15)).toBe(2);
    expect(calculateTier(2001, 15)).toBe(3);
  });

  it("frame lenti (ema > 22) degradano, frame veloci (ema < 12) migliorano", () => {
    expect(calculateTier(100, 30)).toBe(2); // base 1 + 1
    expect(calculateTier(500, 30)).toBe(3); // base 2 + 1
    expect(calculateTier(500, 10)).toBe(1); // base 2 − 1
    expect(calculateTier(3000, 5)).toBe(2); // base 3 − 1
  });

  it("clampa a [1, 3]", () => {
    expect(calculateTier(100, 100)).toBe(2); // base 1 + 1 = 2 (non 3)
    expect(calculateTier(3000, 0)).toBe(2); // base 3 − 1 = 2 (non 1)
  });
});

describe("motore — collisions", () => {
  it("due nodi sovrapposti si separano alla distanza di riposo", () => {
    const s = structure(2, 0);
    s.x[0] = 0;
    s.x[1] = 5; // d = 5 < r0 + r1 + 4 = 12
    const c = config({ gravity: 0, repulsion: 0, collisions: true });
    const state = newState();
    for (let p = 0; p < 5; p++) step(s, c, state, null, DT);
    const d = Math.hypot(s.x[1] - s.x[0], s.y[1] - s.y[0]);
    // Dopo le correzioni posizionali la distanza ≥ riposo (− margine).
    expect(d).toBeGreaterThanOrEqual(11.5);
  });

  it("il centro di mass è conservato (spinte simmetriche)", () => {
    const s = structure(2, 0);
    s.x[0] = 0;
    s.x[1] = 5;
    const cm0 = (s.x[0] + s.x[1]) / 2;
    const c = config({ gravity: 0, repulsion: 0, collisions: true });
    const state = newState();
    for (let p = 0; p < 5; p++) step(s, c, state, null, DT);
    const cm1 = (s.x[0] + s.x[1]) / 2;
    expect(cm1).toBeCloseTo(cm0, 5);
  });

  it("un nodo bloccato (pin) fa da muro: non si muove", () => {
    const s = structure(2, 0);
    s.x[0] = 0;
    s.x[1] = 5;
    s.fixed[1] = 1; // bloccato
    const c = config({ gravity: 0, repulsion: 0, collisions: true });
    const state = newState();
    const x1fixed = s.x[1];
    for (let p = 0; p < 5; p++) step(s, c, state, null, DT);
    expect(s.x[1]).toBe(x1fixed);
    // Il nodo libero (0) assorbe tutto l'overlap: si allontana da 1.
    expect(s.x[0]).toBeLessThan(0);
  });
});