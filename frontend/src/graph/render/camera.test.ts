// Test della camera: tutto puro, niente DOM. Il round-trip mondo↔schermo è la
// garanzia che il grafo non «scivoli» sotto il puntatore; l'invarianza dello
// zoom al cursore è ciò che rende la rotella utilizzabile; la convergenza
// dell'inseguimento è ciò che spegne il rAF (il pittore ridisegna solo quando
// la camera si muove).

import { describe, expect, it } from "vitest";
import {
  createCameraState,
  createMotionState,
  fit,
  MAX_SCALE,
  MIN_SCALE,
  worldToScreen,
  stepCamera,
  screenToWorld,
  zoomAtPoint,
} from "./camera";

describe("camera", () => {
  it("round-trip screenToWorld(worldToScreen(p)) ≈ p", () => {
    const c = { scale: 2.5, tx: -120, ty: 80 };
    const p = { x: 33.7, y: -12.5 };
    const q = screenToWorld(c, worldToScreen(c, p));
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.y).toBeCloseTo(p.y, 6);
  });

  it("zoomAtPoint tiene fermo il punto sotto il cursore", () => {
    const base = { scale: 1.2, tx: 50, ty: -30 };
    const point = { x: 400, y: 300 };
    const first = screenToWorld(base, point);
    const dopo = zoomAtPoint(base, 1.8, point);
    const m = screenToWorld(dopo, point);
    expect(m.x).toBeCloseTo(first.x, 10);
    expect(m.y).toBeCloseTo(first.y, 10);
  });

  it("zoomAtPoint clampata ai limiti [MIN_SCALE, MAX_SCALE]", () => {
    const c = { scale: 2, tx: 0, ty: 0 };
    expect(zoomAtPoint(c, 1e9, { x: 10, y: 10 }).scale).toBe(MAX_SCALE);
    expect(zoomAtPoint(c, 1e-9, { x: 10, y: 10 }).scale).toBe(MIN_SCALE);
    // anche con scala già al limite, il punto sotto il cursore resta fermo
    const bloccato = zoomAtPoint({ scale: MAX_SCALE, tx: 5, ty: 5 }, 5, { x: 30, y: 40 });
    expect(screenToWorld(bloccato, { x: 30, y: 40 })).toEqual({ x: (30 - 5) / MAX_SCALE, y: (40 - 5) / MAX_SCALE });
  });

  it("fit contiene i bound nel viewport con margine", () => {
    const c = fit({ minX: -500, minY: -300, maxX: 700, maxY: 200 }, { w: 800, h: 600 });
    for (const [mx, my] of [
      [-500, -300],
      [700, -300],
      [-500, 200],
      [700, 200],
    ]) {
      const s = worldToScreen(c, { x: mx, y: my });
      expect(s.x).toBeGreaterThanOrEqual(-1e-9);
      expect(s.x).toBeLessThanOrEqual(800);
      expect(s.y).toBeGreaterThanOrEqual(-1e-9);
      expect(s.y).toBeLessThanOrEqual(600);
    }
    // scala = min(800/1200, 600/500) · (1 − 2·0.08) = 0.6667 · 0.84
    expect(c.scale).toBeCloseTo(0.56, 6);
  });

  it("fit con pad=0 riempie esattamente il lato limitante", () => {
    const c = fit({ minX: 0, minY: 0, maxX: 400, maxY: 100 }, { w: 800, h: 200 }, 0);
    expect(c.scale).toBeCloseTo(Math.min(800 / 400, 200 / 100), 10);
  });

  it("fit con bound degenere (un solo nodo) non produce Infinity", () => {
    const c = fit({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { w: 800, h: 600 });
    expect(Number.isFinite(c.scale)).toBe(true);
    expect(c.scale).toBe(MAX_SCALE);
  });

  it("stepCamera converge ai bersagli", () => {
    let st = { ...createMotionState(), targetScale: 4, targetTx: 500, targetTy: -300 };
    for (let i = 0; i < 400; i++) st = stepCamera(st, 16.7);
    expect(st.scale).toBeCloseTo(4, 2);
    expect(st.tx).toBeCloseTo(500, 1);
    expect(st.ty).toBeCloseTo(-300, 1);
  });

  it("stepCamera fa decadere l'inerzia di 0.9 per frame", () => {
    let st = { ...createMotionState(), tx: 100, ty: 100, targetTx: 100, targetTy: 100, vx: 80, vy: 40 };
    st = stepCamera(st, 16.7);
    expect(st.vx).toBeCloseTo(72, 10);
    expect(st.vy).toBeCloseTo(36, 10);
    for (let i = 0; i < 300; i++) st = stepCamera(st, 16.7);
    expect(Math.abs(st.vx)).toBeLessThan(0.1);
    expect(Math.abs(st.vy)).toBeLessThan(0.1);
  });

  it("stepCamera è pura: non tocca lo stato in ingresso", () => {
    const input = { ...createMotionState(), targetScale: 2, vx: 10 };
    const out = stepCamera(input, 16.7);
    expect(input.scale).toBe(1);
    expect(input.vx).toBe(10); // immutato
    expect(out).not.toBe(input);
  });

  it("createCameraState: pan con inerzia e zoom sul bersaglio", () => {
    const cs = createCameraState();
    expect(cs.ready()).toBe(true);

    cs.pan(30, -10);
    expect(cs.state().tx).toBe(30);
    expect(cs.state().ty).toBe(-10);
    expect(cs.ready()).toBe(false); // inerzia in corso
    // l'inerzia decade e la camera si riassesta sul target
    for (let i = 0; i < 200; i++) cs.step(16.7);
    expect(cs.state().tx).toBeCloseTo(30, 5);
    expect(cs.ready()).toBe(true);
  });

  it("createCameraState: zoom e centraSu convergono, il rAF può spegnersi", () => {
    const cs = createCameraState();
    cs.zoom(2, 400, 300);
    expect(cs.state().scale).toBe(1); // la corrente resta ferma
    expect(cs.ready()).toBe(false);
    let c = cs.state();
    for (let i = 0; i < 400; i++) c = cs.step(16.7);
    expect(c.scale).toBeCloseTo(2, 2);
    expect(cs.ready()).toBe(true);

    cs.centerOn(100, 100, 1.6, { w: 800, h: 600 });
    for (let i = 0; i < 400; i++) cs.step(16.7);
    expect(cs.state().scale).toBeCloseTo(1.6, 3);
    expect(cs.state().tx).toBeCloseTo(400 - 160, 3);
    expect(cs.state().ty).toBeCloseTo(300 - 160, 3);
  });
});
