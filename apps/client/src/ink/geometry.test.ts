import { describe, expect, it } from "vitest";
import { mappedSamples, straight, STRAIGHT_SNAP, toLocal } from "./geometry";
import { INK_MAX_SAMPLES, quantizeInk, type InkSample } from "./sample";

describe("i campioni portati da una trasformazione", () => {
  it("muovono i punti e tengono pressione e tempo", () => {
    expect(mappedSamples([{ x: 90, y: 20, t: 0, p: 0.5 }, { x: 80, y: 30, t: 16, p: 0.7 }], [-1, 0, 0, 1, 200, 0])).toEqual([
      { x: 110, y: 20, t: 0, p: 0.5 },
      { x: 120, y: 30, t: 16, p: 0.7 },
    ]);
  });

  it("girano l'azimut della penna con loro, e lo specchiano", () => {
    const [turned] = mappedSamples([{ x: 0, y: 0, t: 0, a: 40, z: 30 }], [0, 1, -1, 0, 0, 0]);
    expect(turned!.a).toBe(40);
    expect(turned!.z).toBeCloseTo(120, 9);
    const [mirrored] = mappedSamples([{ x: 0, y: 0, t: 0, a: 40, z: 30 }], [-1, 0, 0, 1, 0, 0]);
    expect(mirrored!.z).toBeCloseTo(150, 9);
    const [flipped] = mappedSamples([{ x: 0, y: 0, t: 0, a: 40, z: 30 }], [1, 0, 0, -1, 0, 0]);
    expect(flipped!.z).toBeCloseTo(330, 9);
  });

  it("una trasformazione che schiaccia l'azimut lo lascia com'è", () => {
    const [flat] = mappedSamples([{ x: 1, y: 1, t: 0, a: 40, z: 30 }], [0, 0, 0, 0, 5, 5]);
    expect(flat).toEqual({ x: 5, y: 5, t: 0, a: 40, z: 30 });
  });

  it("non cambiano i campioni di partenza e danno sempre lo stesso risultato", () => {
    const source: InkSample[] = [{ x: 3, y: 4, t: 0, p: 0.2, a: 50, z: 10 }, { x: 5, y: 7, t: 9, p: 0.6, a: 51, z: 12 }];
    const before = JSON.stringify(source);
    const m = [0.6, 0.8, -0.8, 0.6, 12, -4] as const;
    expect(mappedSamples(source, m)).toEqual(mappedSamples(source, m));
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("la posizione nel livello", () => {
  it("porta il punto e lascia pressione, tempo e inclinazione", () => {
    expect(toLocal({ x: 10, y: 20, t: 5, p: 0.3, a: 60, z: 90 }, [2, 0, 0, 2, 1, 1])).toEqual({ x: 21, y: 41, t: 5, p: 0.3, a: 60, z: 90 });
  });

  it("l'identità non cambia niente", () => {
    const sample = { x: 1.25, y: -3.5, t: 7 };
    expect(toLocal(sample, [1, 0, 0, 1, 0, 0])).toEqual(sample);
  });
});

describe("il tratto dritto", () => {
  it("un campione solo, o nessuno, resta com'è", () => {
    expect(straight([])).toEqual([]);
    const one: InkSample = { x: 1, y: 2, t: 0, p: 0.4 };
    expect(straight([one])).toEqual([one]);
  });

  it("va dal primo all'ultimo campione con un punto ogni unità e mezza", () => {
    const out = straight([{ x: 0, y: 0, t: 0, p: 0.5 }, { x: 5, y: 3, t: 100, p: 0.9 }, { x: 30, y: 0, t: 400, p: 0.2 }]);
    expect(out.length).toBe(21);
    expect(out[0]).toEqual({ x: 0, y: 0, t: 0, p: 0.5 });
    expect(out[out.length - 1]).toMatchObject({ x: 30, y: 0, t: 400 });
    // Il tempo cresce senza buchi e la pressione è quella del primo.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
      expect(out[i]!.p).toBe(0.5);
    }
  });

  it("due campioni nello stesso punto danno comunque un tratto che il formato scrive", () => {
    const out = straight([{ x: 4, y: 4, t: 0 }, { x: 4, y: 4, t: 10 }]);
    expect(out.length).toBe(2);
    expect(() => quantizeInk(out)).not.toThrow();
  });

  it("con il passo, la direzione va al multiplo più vicino e la lunghezza resta", () => {
    const out = straight([{ x: 0, y: 0, t: 0 }, { x: 10, y: 1, t: 50 }], STRAIGHT_SNAP);
    const end = out[out.length - 1]!;
    expect(end.y).toBeCloseTo(0, 9);
    expect(end.x).toBeCloseTo(Math.hypot(10, 1), 9);
    const steep = straight([{ x: 0, y: 0, t: 0 }, { x: 10, y: 9, t: 50 }], STRAIGHT_SNAP);
    const tip = steep[steep.length - 1]!;
    expect((Math.atan2(tip.y, tip.x) * 180) / Math.PI).toBeCloseTo(45, 9);
  });

  it("una distanza enorme non supera il limite dei campioni, ed è deterministica", () => {
    const far: InkSample[] = [{ x: 0, y: 0, t: 0 }, { x: 1e7, y: 0, t: 1000 }];
    const out = straight(far);
    expect(out.length).toBe(INK_MAX_SAMPLES);
    expect(straight(far)).toEqual(out);
    expect(() => quantizeInk(out)).not.toThrow();
  });
});
