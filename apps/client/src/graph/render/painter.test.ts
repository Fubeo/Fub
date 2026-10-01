import { describe, expect, it } from "vitest";
import { MIN_NODE_PX, labelFade, labelReach, pulseOpacity, screenRadius, trailFade } from "./painter";
import { createStructure, organicConfig } from "../sim/types";

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

describe("labelReach", () => {
  /// Due nodi in orizzontale, raggio 6: «a» a sinistra con un'etichetta
  /// lunga, «b» sul bordo destro con una corta.
  function pair() {
    const s = createStructure({ nodes: ["a", "b"], edges: [] }, organicConfig(), 1);
    s.x[0] = 0;
    s.x[1] = 100;
    s.radius[0] = 6;
    s.radius[1] = 6;
    return s;
  }
  const widths = [200, 40];

  it("misura quanto l'etichetta più sporgente esce dal bordo destro", () => {
    // a: 6 + 5 + 200 − 100 = 111; b: 6 + 5 + 40 − 0 = 51. Vince «a».
    expect(labelReach(pair(), 1, 100, (i) => widths[i])).toBeCloseTo(111, 10);
    // Più zoom, più distanza fra i nodi: «a» rientra, «b» resta sul bordo.
    expect(labelReach(pair(), 4, 100, (i) => widths[i])).toBeCloseTo(24 + 5 + 40, 10);
  });

  it("dove le etichette non si disegnano non sporge niente", () => {
    expect(labelFade(0.5)).toBe(0);
    expect(labelReach(pair(), 0.5, 100, (i) => widths[i])).toBe(0);
  });
});
