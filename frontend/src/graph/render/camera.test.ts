// Test della camera: tutto puro, niente DOM. Il round-trip mondo↔schermo è la
// garanzia che il grafo non «scivoli» sotto il puntatore; l'invarianza dello
// zoom al cursore è ciò che rende la rotella utilizzabile; la convergenza
// dell'inseguimento è ciò che spegne il rAF (il pittore ridisegna solo quando
// la camera si muove).

import { describe, expect, it } from "vitest";
import {
  creaCameraStato,
  creaStatoCamera,
  inquadra,
  MAX_SCALA,
  MIN_SCALA,
  mondoInSchermo,
  passoCamera,
  schermoInMondo,
  zoomAlPunto,
} from "./camera";

describe("camera", () => {
  it("round-trip schermoInMondo(mondoInSchermo(p)) ≈ p", () => {
    const c = { scala: 2.5, tx: -120, ty: 80 };
    const p = { x: 33.7, y: -12.5 };
    const q = schermoInMondo(c, mondoInSchermo(c, p));
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.y).toBeCloseTo(p.y, 6);
  });

  it("zoomAlPunto tiene fermo il punto sotto il cursore", () => {
    const base = { scala: 1.2, tx: 50, ty: -30 };
    const punto = { x: 400, y: 300 };
    const prima = schermoInMondo(base, punto);
    const dopo = zoomAlPunto(base, 1.8, punto);
    const m = schermoInMondo(dopo, punto);
    expect(m.x).toBeCloseTo(prima.x, 10);
    expect(m.y).toBeCloseTo(prima.y, 10);
  });

  it("zoomAlPunto clampata ai limiti [MIN_SCALA, MAX_SCALA]", () => {
    const c = { scala: 2, tx: 0, ty: 0 };
    expect(zoomAlPunto(c, 1e9, { x: 10, y: 10 }).scala).toBe(MAX_SCALA);
    expect(zoomAlPunto(c, 1e-9, { x: 10, y: 10 }).scala).toBe(MIN_SCALA);
    // anche con scala già al limite, il punto sotto il cursore resta fermo
    const bloccato = zoomAlPunto({ scala: MAX_SCALA, tx: 5, ty: 5 }, 5, { x: 30, y: 40 });
    expect(schermoInMondo(bloccato, { x: 30, y: 40 })).toEqual({ x: (30 - 5) / MAX_SCALA, y: (40 - 5) / MAX_SCALA });
  });

  it("inquadra contiene i bound nel viewport con margine", () => {
    const c = inquadra({ minX: -500, minY: -300, maxX: 700, maxY: 200 }, { w: 800, h: 600 });
    for (const [mx, my] of [
      [-500, -300],
      [700, -300],
      [-500, 200],
      [700, 200],
    ]) {
      const s = mondoInSchermo(c, { x: mx, y: my });
      expect(s.x).toBeGreaterThanOrEqual(-1e-9);
      expect(s.x).toBeLessThanOrEqual(800);
      expect(s.y).toBeGreaterThanOrEqual(-1e-9);
      expect(s.y).toBeLessThanOrEqual(600);
    }
    // scala = min(800/1200, 600/500) · (1 − 2·0.08) = 0.6667 · 0.84
    expect(c.scala).toBeCloseTo(0.56, 6);
  });

  it("inquadra con pad=0 riempie esattamente il lato limitante", () => {
    const c = inquadra({ minX: 0, minY: 0, maxX: 400, maxY: 100 }, { w: 800, h: 200 }, 0);
    expect(c.scala).toBeCloseTo(Math.min(800 / 400, 200 / 100), 10);
  });

  it("inquadra con bound degenere (un solo nodo) non produce Infinity", () => {
    const c = inquadra({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { w: 800, h: 600 });
    expect(Number.isFinite(c.scala)).toBe(true);
    expect(c.scala).toBe(MAX_SCALA);
  });

  it("passoCamera converge ai bersagli", () => {
    let st = { ...creaStatoCamera(), targetScala: 4, targetTx: 500, targetTy: -300 };
    for (let i = 0; i < 400; i++) st = passoCamera(st, 16.7);
    expect(st.scala).toBeCloseTo(4, 2);
    expect(st.tx).toBeCloseTo(500, 1);
    expect(st.ty).toBeCloseTo(-300, 1);
  });

  it("passoCamera fa decadere l'inerzia di 0.9 per frame", () => {
    let st = { ...creaStatoCamera(), tx: 100, ty: 100, targetTx: 100, targetTy: 100, vx: 80, vy: 40 };
    st = passoCamera(st, 16.7);
    expect(st.vx).toBeCloseTo(72, 10);
    expect(st.vy).toBeCloseTo(36, 10);
    for (let i = 0; i < 300; i++) st = passoCamera(st, 16.7);
    expect(Math.abs(st.vx)).toBeLessThan(0.1);
    expect(Math.abs(st.vy)).toBeLessThan(0.1);
  });

  it("passoCamera è pura: non tocca lo stato in ingresso", () => {
    const input = { ...creaStatoCamera(), targetScala: 2, vx: 10 };
    const out = passoCamera(input, 16.7);
    expect(input.scala).toBe(1);
    expect(input.vx).toBe(10); // immutato
    expect(out).not.toBe(input);
  });

  it("creaCameraStato: pan con inerzia e zoom sul bersaglio", () => {
    const cs = creaCameraStato();
    expect(cs.pronto()).toBe(true);

    cs.pan(30, -10);
    expect(cs.stato().tx).toBe(30);
    expect(cs.stato().ty).toBe(-10);
    expect(cs.pronto()).toBe(false); // inerzia in corso
    // l'inerzia decade e la camera si riassesta sul target
    for (let i = 0; i < 200; i++) cs.passo(16.7);
    expect(cs.stato().tx).toBeCloseTo(30, 5);
    expect(cs.pronto()).toBe(true);
  });

  it("creaCameraStato: zoom e centraSu convergono, il rAF può spegnersi", () => {
    const cs = creaCameraStato();
    cs.zoom(2, 400, 300);
    expect(cs.stato().scala).toBe(1); // la corrente resta ferma
    expect(cs.pronto()).toBe(false);
    let c = cs.stato();
    for (let i = 0; i < 400; i++) c = cs.passo(16.7);
    expect(c.scala).toBeCloseTo(2, 2);
    expect(cs.pronto()).toBe(true);

    cs.centraSu(100, 100, 1.6, { w: 800, h: 600 });
    for (let i = 0; i < 400; i++) cs.passo(16.7);
    expect(cs.stato().scala).toBeCloseTo(1.6, 3);
    expect(cs.stato().tx).toBeCloseTo(400 - 160, 3);
    expect(cs.stato().ty).toBeCloseTo(300 - 160, 3);
  });
});
