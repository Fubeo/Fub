import { describe, expect, it } from "vitest";
import { EDGE_PX, edgeDepth, edgeScroll, edgeSpeed, RAMP_MS, TOP_SPEED } from "./autoscroll";

// Lo scorrimento al bordo (E2): soglia, curva, tetto e rampa, senza DOM.

/// I px scorsi in `ms` a fotogrammi di 16 ms con il puntatore a `depth`.
function run(depth: number, ms: number, frame = 16): number {
  const scroll = edgeScroll();
  let total = 0;
  for (let t = 0; t < ms; t += frame) total += scroll.step(depth, frame);
  return total;
}

describe("la soglia", () => {
  it("scorre soltanto entro 72 px dal bordo, in su in alto e in giù in basso", () => {
    // Il foglio va da 100 a 900.
    expect(edgeDepth(500, 100, 900)).toBe(0);
    expect(edgeDepth(100 + EDGE_PX, 100, 900), "sul confine della fascia, ancora fermo").toBe(0);
    expect(edgeDepth(100 + EDGE_PX - 1, 100, 900)).toBe(-1);
    expect(edgeDepth(900 - EDGE_PX + 10, 100, 900)).toBe(10);
    expect(edgeDepth(110, 100, 900)).toBe(-62);
  });

  it("oltre il bordo vale la fascia intera", () => {
    expect(edgeDepth(40, 100, 900)).toBe(-EDGE_PX);
    expect(edgeDepth(2000, 100, 900)).toBe(EDGE_PX);
  });

  it("su un foglio basso la fascia si stringe: il mezzo non scorre mai", () => {
    // 120 px di foglio: la fascia è di 40 px, e il mezzo resta fermo.
    expect(edgeDepth(160, 100, 220)).toBe(0);
    expect(edgeDepth(100, 100, 220)).toBe(-EDGE_PX);
    expect(edgeDepth(220, 100, 220)).toBe(EDGE_PX);
  });

  it("un foglio senza altezza non scorre", () => {
    expect(edgeDepth(10, 0, 0)).toBe(0);
  });
});

describe("la curva e il tetto", () => {
  it("la velocità cresce col quadrato della profondità", () => {
    expect(edgeSpeed(0)).toBe(0);
    expect(edgeSpeed(EDGE_PX / 2)).toBeCloseTo(TOP_SPEED / 4);
    expect(edgeSpeed(-EDGE_PX / 2)).toBeCloseTo(-TOP_SPEED / 4);
    expect(edgeSpeed(EDGE_PX)).toBe(TOP_SPEED);
  });

  it("non supera il tetto, nemmeno oltre la fascia", () => {
    expect(edgeSpeed(EDGE_PX * 3)).toBe(TOP_SPEED);
    expect(TOP_SPEED).toBe(800);
  });
});

describe("la rampa", () => {
  it("la velocità piena arriva in mezzo secondo", () => {
    expect(RAMP_MS).toBe(500);
    const scroll = edgeScroll();
    // Dopo mezzo secondo un fotogramma di 100 ms scorre 80 px (800 px/s).
    for (let t = 0; t < RAMP_MS; t += 10) scroll.step(EDGE_PX, 10);
    expect(scroll.step(EDGE_PX, 100)).toBe(80);
  });

  it("nel primo mezzo secondo scorre la metà di quanto farebbe a velocità piena", () => {
    expect(run(EDGE_PX, 496)).toBeGreaterThan(190);
    expect(run(EDGE_PX, 496)).toBeLessThan(210);
  });

  it("sfiorare il bordo non fa partire la pagina", () => {
    expect(run(6, 300), "300 ms a 6 px dal bordo").toBe(0);
    expect(run(-4, 1000), "un secondo a 4 px dal bordo alto").toBeLessThanOrEqual(0);
    expect(run(-4, 1000)).toBeGreaterThan(-4);
  });

  it("uscire dalla fascia, o passare all'altro bordo, ricomincia la rampa", () => {
    const scroll = edgeScroll();
    for (let t = 0; t < 1000; t += 16) scroll.step(EDGE_PX, 16);
    expect(scroll.step(0, 16)).toBe(0);
    expect(scroll.step(EDGE_PX, 16), "di nuovo dentro: si riparte piano").toBeLessThanOrEqual(1);
    for (let t = 0; t < 1000; t += 16) scroll.step(EDGE_PX, 16);
    expect(scroll.step(-EDGE_PX, 16), "l'altro bordo: si riparte piano").toBeGreaterThanOrEqual(-1);
  });

  it("restituisce px interi e tiene il resto", () => {
    const scroll = edgeScroll();
    const steps = Array.from({ length: 200 }, () => scroll.step(30, 16));
    expect(steps.every(Number.isInteger)).toBe(true);
    // 30 px di profondità: (30/72)² × 800 ≈ 139 px/s a velocità piena.
    const total = steps.reduce((a, b) => a + b, 0);
    const expected = edgeSpeed(30) * (3.2 - RAMP_MS / 2000);
    expect(Math.abs(total - expected)).toBeLessThan(2);
  });
});
