// La vista del disegno: andata e ritorno fra scena e schermo a ogni angolo,
// il punto fermo dello zoom e della rotazione, gli angoli retti esatti, e la
// vista diritta uguale al bit a quella della camera del grafo.

import { describe, expect, it } from "vitest";
import { fit as cameraFit, zoomAtPoint } from "../../spatial/camera";
import type { Point } from "./scene/matrix";
import {
  fitView,
  nextTurn,
  normalTurn,
  sceneArrow,
  sceneBox,
  screenBox,
  seenBox,
  toScene,
  toScreen,
  turnBy,
  turnTo,
  viewMatrix,
  viewTransform,
  zoomAt,
  type View,
} from "./view";

const LIMITS = { min: 0.1, max: 32 };

const near = (a: Point, b: Point, within = 1e-9): void => {
  expect(Math.abs(a[0] - b[0]), `${a} ≉ ${b}`).toBeLessThanOrEqual(within);
  expect(Math.abs(a[1] - b[1]), `${a} ≉ ${b}`).toBeLessThanOrEqual(within);
};

describe("la vista del disegno", () => {
  it("va e torna fra scena e schermo a ogni angolo", () => {
    for (const angle of [0, 15, 30, 45, 90, 135, 180, -90, -15, -179.5]) {
      const view: View = { scale: 2.5, angle, tx: 40, ty: -12 };
      for (const p of [[0, 0], [10, 0], [0, 10], [-37.5, 81.25]] as Point[]) near(toScene(view, toScreen(view, p)), p);
    }
  });

  it("gira in senso orario, come rotate() di SVG", () => {
    const view: View = { scale: 1, angle: 90, tx: 0, ty: 0 };
    // L'asse x della scena guarda in giù sullo schermo.
    expect(toScreen(view, [10, 0])).toEqual([0, 10]);
    expect(toScreen(view, [0, 10])).toEqual([-10, 0]);
  });

  it("scrive gli angoli retti esatti, e la vista diritta come prima", () => {
    expect(viewMatrix({ scale: 2, angle: 90, tx: 1, ty: 2 })).toEqual([0, 2, -2, 0, 1, 2]);
    expect(viewMatrix({ scale: 2, angle: 180, tx: 1, ty: 2 })).toEqual([-2, 0, 0, -2, 1, 2]);
    expect(viewMatrix({ scale: 2, angle: -90, tx: 1, ty: 2 })).toEqual([0, -2, 2, 0, 1, 2]);
    expect(viewTransform({ scale: 1.5, angle: 0, tx: 30, ty: -110 })).toBe("matrix(1.5 0 0 1.5 30 -110)");
    expect(viewTransform({ scale: 1, angle: 0, tx: 3, ty: 4 }, true)).toBe("matrix(1, 0, 0, 1, 3, 4)");
  });

  it("tiene gli angoli fra −180 escluso e 180", () => {
    expect(normalTurn(195)).toBe(-165);
    expect(normalTurn(-180)).toBe(180);
    expect(normalTurn(540)).toBe(180);
    expect(normalTurn(-360)).toBe(0);
    expect(Object.is(normalTurn(-0), 0)).toBe(true);
    expect(normalTurn(Number.NaN)).toBe(0);
  });

  it("lascia fermo il punto dello zoom e quello della rotazione", () => {
    const view: View = { scale: 1.5, angle: 30, tx: 100, ty: 50 };
    const at: Point = [320, 240];
    const under = toScene(view, at);
    near(toScene(zoomAt(view, 2, at, LIMITS), at), under);
    near(toScene(turnBy(view, 45, at), at), under);
    expect(turnBy(view, 45, at).angle).toBe(75);
    expect(turnTo(view, 0, at).angle).toBe(0);
    // Lo zoom resta nei limiti.
    expect(zoomAt(view, 1000, at, LIMITS).scale).toBe(32);
  });

  it("diritta, fa gli stessi conti della camera del grafo", () => {
    const view: View = { scale: 1.25, angle: 0, tx: 17.3, ty: -4.1 };
    const camera = zoomAtPoint(view, 1.7, { x: 211.7, y: 93.2 }, LIMITS);
    expect(zoomAt(view, 1.7, [211.7, 93.2], LIMITS)).toEqual({ ...camera, angle: 0 });
    const bounds = { min: [3, 7] as Point, max: [403, 207] as Point };
    const fitted = cameraFit({ minX: 3, minY: 7, maxX: 403, maxY: 207 }, { w: 800, h: 600 }, 0.05, 0, LIMITS);
    expect(fitView(bounds, { x: 24, y: 24, w: 800, h: 600 }, 0.05, 0, LIMITS)).toEqual({
      scale: fitted.scale,
      angle: 0,
      tx: fitted.tx + 24,
      ty: fitted.ty + 24,
    });
  });

  it("inquadra un disegno girato dentro il rettangolo, al centro", () => {
    const bounds = { min: [0, 0] as Point, max: [400, 200] as Point };
    const area = { x: 0, y: 0, w: 300, h: 500 };
    // Girato di 90°, il disegno è alto 400 e largo 200: entra in altezza.
    const view = fitView(bounds, area, 0, 90, LIMITS);
    expect(view.scale).toBeCloseTo(1.25, 12);
    const box = screenBox(view, bounds);
    near(box.min, [25, 0], 1e-9);
    near(box.max, [275, 500], 1e-9);
  });

  it("dà il riquadro della scena che lo schermo mostra, anche girato", () => {
    const view: View = { scale: 2, angle: 90, tx: 100, ty: 0 };
    const box = sceneBox(view, { x: 0, y: 0, w: 100, h: 40 });
    near(box.min, [0, 0]);
    near(box.max, [20, 50]);
    expect(sceneBox({ scale: 2, angle: 0, tx: 10, ty: 20 }, { x: 10, y: 20, w: 100, h: 40 })).toEqual({ min: [0, 0], max: [50, 20] });
  });

  it("dà il riquadro dritto della scena che si vede tutto, anche di traverso", () => {
    const area = { x: 0, y: 0, w: 100, h: 40 };
    const straight: View = { scale: 2, angle: 0, tx: 10, ty: 20 };
    expect(seenBox(straight, area)).toEqual(sceneBox(straight, area));
    const square: View = { scale: 2, angle: 90, tx: 100, ty: 0 };
    expect(seenBox(square, area)).toEqual(sceneBox(square, area));
    for (const angle of [30, -60, 135]) {
      const view: View = { scale: 2, angle, tx: 37, ty: -12 };
      const box = seenBox(view, area);
      // Gli angoli si vedono, e almeno uno tocca il bordo.
      const seen = [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]].map((p) => toScreen(view, p as Point));
      for (const [x, y] of seen) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(100 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(40 + 1e-9);
      }
      const edge = Math.min(...seen.flatMap(([x, y]) => [x, 100 - x, y, 40 - y]));
      expect(edge).toBeCloseTo(0, 9);
      near(toScreen(view, [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]), [50, 20]);
    }
    // Oltre i 45° il lato lungo dello schermo è il y della scena.
    const steep = seenBox({ scale: 1, angle: 60, tx: 0, ty: 0 }, area);
    expect(steep.max[1] - steep.min[1]).toBeGreaterThan(steep.max[0] - steep.min[0]);
  });

  it("manda le frecce lungo l'asse della scena che si vede andare da quella parte", () => {
    expect(sceneArrow({ scale: 1, angle: 0, tx: 0, ty: 0 }, [10, 0])).toEqual([10, 0]);
    // Girato di 90° orario, la destra dello schermo è il −y della scena.
    expect(sceneArrow({ scale: 1, angle: 90, tx: 0, ty: 0 }, [10, 0])).toEqual([0, -10]);
    expect(sceneArrow({ scale: 1, angle: 90, tx: 0, ty: 0 }, [0, 10])).toEqual([10, 0]);
    // A 30° la destra resta vicina all'asse x.
    expect(sceneArrow({ scale: 1, angle: 30, tx: 0, ty: 0 }, [-1, 0])).toEqual([-1, 0]);
    expect(sceneArrow({ scale: 1, angle: 180, tx: 0, ty: 0 }, [0, 1])).toEqual([0, -1]);
  });

  it("gira a passi di 15° fino al prossimo multiplo", () => {
    expect(nextTurn(0, 1)).toBe(15);
    expect(nextTurn(0, -1)).toBe(-15);
    expect(nextTurn(20, 1)).toBe(30);
    expect(nextTurn(20, -1)).toBe(15);
    expect(nextTurn(30, -1)).toBe(15);
    expect(nextTurn(180, 1)).toBe(-165);
    expect(nextTurn(-165, -1)).toBe(180);
  });
});
