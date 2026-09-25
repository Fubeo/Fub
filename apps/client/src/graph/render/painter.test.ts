import { describe, expect, it } from "vitest";
import { MIN_NODE_PX, pulseOpacity, screenRadius, trailFade } from "./painter";

describe("pulse dei nodi", () => {
  it("è assente sotto moto ridotto e presente col moto normale", () => {
    expect(pulseOpacity("n0", 100, 1, false)).toBeUndefined();
    expect(pulseOpacity("n0", 100, 1, true)).toBeDefined();
  });
});

describe("screenRadius", () => {
  it("segue lo zoom, come archi e distanze", () => {
    // A raggio fisso i nodi restavano grandi da lontano, e un grafo di
    // migliaia di note diventava una macchia sola.
    expect(screenRadius(6, 1)).toBe(6);
    expect(screenRadius(6, 2)).toBe(12);
    expect(screenRadius(6, 0.5)).toBe(3);
  });

  it("non scende sotto il minimo visibile", () => {
    expect(screenRadius(6, 0.05)).toBe(MIN_NODE_PX);
  });
});

describe("trailFade", () => {
  it("sbiadisce la stessa parte per secondo a ogni refresh", () => {
    expect(trailFade(undefined)).toBeCloseTo(0.25, 10);
    expect(trailFade(1000 / 60)).toBeCloseTo(0.25, 10);
    // quanto resta dopo 100 ms: uguale a 60, 144 e 240 Hz
    const left = (hz: number): number => Math.pow(1 - trailFade(1000 / hz), hz / 10);
    expect(left(144)).toBeCloseTo(left(60), 10);
    expect(left(240)).toBeCloseTo(left(60), 10);
    expect(trailFade(1000 / 144)).toBeLessThan(0.25);
    // una pausa non cancella più di un fotogramma da 100 ms
    expect(trailFade(5000)).toBeCloseTo(trailFade(100), 10);
    expect(trailFade(-3)).toBe(0);
  });
});
