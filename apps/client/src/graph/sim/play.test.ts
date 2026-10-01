// Test degli impulsi di gioco: funzioni pure sulle velocità.

import { describe, expect, it } from "vitest";
import { createStructure, mulberry32, organicConfig, type GraphData, type Structure } from "./types";
import { shake, shockwave, slosh } from "./play";

const DATA: GraphData = { nodes: ["a", "b", "c", "d"], edges: [{ from: "a", to: "b" }] };

/// Quattro nodi su una retta: a(0,0) b(100,0) c(300,0) d(−100,0).
function line(): Structure {
  const s = createStructure(DATA, organicConfig(), 1);
  const xs = [0, 100, 300, -100];
  for (let i = 0; i < s.n; i++) {
    s.x[i] = xs[i]!;
    s.y[i] = 0;
    s.vx[i] = 0;
    s.vy[i] = 0;
  }
  return s;
}

describe("giochi — onda d'urto", () => {
  it("allontana dal centro e cala con la distanza; il nodo al centro resta", () => {
    const s = line();
    shockwave(s, 0, 0, 100, 1000);
    expect(s.vx[0]).toBe(0);
    expect(s.vx[1]).toBeGreaterThan(0); // a destra del centro, spinto a destra
    expect(s.vx[3]).toBeLessThan(0); // a sinistra, spinto a sinistra
    expect(s.vx[2]).toBeGreaterThan(0);
    expect(s.vx[2]).toBeLessThan(s.vx[1]); // più lontano, meno spinta
    expect(s.vx[1]).toBeCloseTo(1000 * Math.exp(-1), 3);
  });

  it("non tocca i nodi bloccati né quello trascinato", () => {
    const s = line();
    s.fixed[1] = 1;
    s.fixed[3] = 2;
    shockwave(s, 0, 0, 100, 1000);
    expect(s.vx[1]).toBe(0);
    expect(s.vx[3]).toBe(0);
    expect(s.vx[2]).toBeGreaterThan(0);
  });
});

describe("giochi — scossa", () => {
  it("è deterministica a parità di seme e cambia col seme", () => {
    const a = line();
    const b = line();
    const c = line();
    shake(a, mulberry32(7), 300);
    shake(b, mulberry32(7), 300);
    shake(c, mulberry32(8), 300);
    expect([...a.vx]).toEqual([...b.vx]);
    expect([...a.vy]).toEqual([...b.vy]);
    expect([...a.vx]).not.toEqual([...c.vx]);
  });

  it("dà a ogni nodo libero fra metà e intera velocità, meno agli hub", () => {
    const s = line();
    s.fixed[2] = 1;
    shake(s, mulberry32(3), 300);
    expect(s.vx[2]).toBe(0);
    expect(s.vy[2]).toBe(0);
    for (const i of [0, 1, 3]) {
      const v = Math.hypot(s.vx[i], s.vy[i]) * Math.sqrt(s.mass[i]);
      expect(v).toBeGreaterThanOrEqual(150 - 1e-3);
      expect(v).toBeLessThanOrEqual(300 + 1e-3);
    }
  });

  it("un nodo bloccato non cambia la scossa degli altri", () => {
    const free = line();
    const pinned = line();
    pinned.fixed[1] = 1;
    shake(free, mulberry32(5), 300);
    shake(pinned, mulberry32(5), 300);
    expect(pinned.vx[2]).toBe(free.vx[2]);
  });
});

describe("giochi — sfera di neve", () => {
  it("i nodi restano indietro rispetto alla vista, gli hub di meno", () => {
    const s = line();
    s.fixed[3] = 1;
    slosh(s, 400, 0);
    expect(s.vx[2]).toBeLessThan(0);
    expect(s.vx[3]).toBe(0);
    // a e b hanno grado 1 (massa > 1), c e d grado 0 (massa 1): c più di a.
    expect(Math.abs(s.vx[2])).toBeGreaterThan(Math.abs(s.vx[0]));
  });
});
