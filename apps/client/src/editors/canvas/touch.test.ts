// La camera del pizzico e la soglia del tocco breve (N4 T14).
import { describe, expect, it } from "vitest";
import { isTap, pinchCamera, TAP_MAX_MS, TAP_SLOP_PX } from "./touch";

const LIMITS = { min: 0.1, max: 4 } as const;

/** Il punto della lavagna sotto il punto `(x, y)` del viewport con la camera `cam`. */
function world(cam: { x: number; y: number; zoom: number }, x: number, y: number): [number, number] {
  return [(x - cam.x) / cam.zoom, (y - cam.y) / cam.zoom];
}

describe("pinchCamera", () => {
  it("le dita ferme lasciano la camera com'era", () => {
    const start = { x: 30, y: -20, zoom: 1.5 };
    const a = { x: 100, y: 100 };
    const b = { x: 200, y: 140 };
    const next = pinchCamera(start, a, b, a, b, LIMITS);
    expect(next.zoom).toBeCloseTo(1.5);
    expect(next.x).toBeCloseTo(30);
    expect(next.y).toBeCloseTo(-20);
  });

  it("le dita che si allontanano del doppio raddoppiano lo zoom attorno al loro centro", () => {
    const start = { x: 0, y: 0, zoom: 1 };
    const next = pinchCamera(start, { x: 150, y: 100 }, { x: 250, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 100 }, LIMITS);
    expect(next.zoom).toBeCloseTo(2);
    // Il centro (200, 100) mostra lo stesso punto della lavagna di prima.
    const [wx, wy] = world(next, 200, 100);
    expect(wx).toBeCloseTo(200);
    expect(wy).toBeCloseTo(100);
  });

  it("il centro che si sposta trascina la lavagna con le dita", () => {
    const start = { x: 10, y: 20, zoom: 0.5 };
    const before = world(start, 150, 100);
    const next = pinchCamera(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 140, y: 160 }, { x: 240, y: 160 }, LIMITS);
    expect(next.zoom).toBeCloseTo(0.5);
    expect(next.x).toBeCloseTo(50);
    expect(next.y).toBeCloseTo(80);
    const after = world(next, 190, 160);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it("si ferma ai limiti dello zoom e tiene sotto le dita il punto di partenza", () => {
    const start = { x: 0, y: 0, zoom: 2 };
    const wide = pinchCamera(start, { x: 190, y: 100 }, { x: 210, y: 100 }, { x: 0, y: 100 }, { x: 400, y: 100 }, LIMITS);
    expect(wide.zoom).toBe(4);
    expect(world(wide, 200, 100)[0]).toBeCloseTo(100);
    const narrow = pinchCamera(start, { x: 0, y: 100 }, { x: 400, y: 100 }, { x: 199, y: 100 }, { x: 201, y: 100 }, LIMITS);
    expect(narrow.zoom).toBe(0.1);
    expect(world(narrow, 200, 100)[0]).toBeCloseTo(100);
  });

  it("due dita sullo stesso punto non danno uno zoom infinito", () => {
    const start = { x: 0, y: 0, zoom: 1 };
    const p = { x: 50, y: 50 };
    const next = pinchCamera(start, p, p, { x: 0, y: 50 }, { x: 100, y: 50 }, LIMITS);
    expect(Number.isFinite(next.zoom)).toBe(true);
    expect(next.zoom).toBe(4);
  });
});

describe("isTap", () => {
  it("vicino e presto è un tocco breve", () => {
    expect(isTap(10, 10, 10, 10, 0)).toBe(true);
    expect(isTap(10, 10, 10 + TAP_SLOP_PX, 10, TAP_MAX_MS)).toBe(true);
  });

  it("oltre la soglia, o troppo a lungo, no", () => {
    expect(isTap(10, 10, 10 + TAP_SLOP_PX + 1, 10, 0)).toBe(false);
    expect(isTap(10, 10, 16, 16, 0)).toBe(false);
    expect(isTap(10, 10, 10, 10, TAP_MAX_MS + 1)).toBe(false);
  });
});
