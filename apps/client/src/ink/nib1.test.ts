import { describe, expect, it } from "vitest";
import { BrushError, formatInkBrush, NIB1_DEFAULTS, parseInkBrush, type Nib1Brush } from "./brush";
import { nib1, nib1Outline } from "./nib1";
import type { QuantizedSample } from "./sample";

// La punta piatta: la geometria del nastro e la grammatica del pennello.

const brush = (patch: Partial<Nib1Brush> = {}): Nib1Brush => ({ ...NIB1_DEFAULTS, tilt: false, smoothing: 0, streamline: 0, ...patch });
const line = (samples: QuantizedSample[]) => ({ scale: 100 as const, samples });
const across = line([{ x: 0, y: 0, t: 0 }, { x: 1000, y: 0, t: 10 }, { x: 2000, y: 0, t: 20 }]);

/// L'altezza del nastro a metà del tratto.
function thickness(outline: readonly (readonly [number, number])[]): number {
  const ys = outline.map(([, y]) => y);
  return Math.max(...ys) - Math.min(...ys);
}

describe("nib1, la geometria", () => {
  it("con l'angolo fisso la larghezza dipende dalla direzione: piena di traverso, minima lungo la punta", () => {
    const upright = nib1Outline(across, brush({ angle: 90, size: 12, tip: 1 }));
    expect(thickness(upright)).toBeCloseTo(13, 5);
    const along = nib1Outline(across, brush({ angle: 0, size: 12, tip: 1 }));
    expect(thickness(along)).toBeCloseTo(1, 5);
  });

  it("la punta minima tiene il tratto visibile anche lungo la punta", () => {
    const thin = nib1Outline(across, brush({ angle: 0, tip: 0.5 }));
    expect(thickness(thin)).toBeCloseTo(0.5, 5);
  });

  it("con l'inclinazione l'angolo viene dall'azimut, più 90°", () => {
    const tilted = line([{ x: 0, y: 0, t: 0, a: 45, z: 0 }, { x: 2000, y: 0, t: 20, a: 45, z: 0 }]);
    const outline = nib1Outline(tilted, brush({ tilt: true, angle: 0, size: 10, tip: 0 }));
    expect(thickness(outline)).toBeCloseTo(10, 5);
    // Senza `tilt` vale l'angolo del pennello.
    expect(thickness(nib1Outline(tilted, brush({ tilt: false, angle: 0, size: 10, tip: 0 })))).toBeCloseTo(0, 5);
  });

  it("la pressione assottiglia, sim=1 la ignora", () => {
    const light = line([{ x: 0, y: 0, p: 0, t: 0 }, { x: 2000, y: 0, p: 0, t: 20 }]);
    expect(thickness(nib1Outline(light, brush({ angle: 90, size: 10, tip: 0, thinning: 0.5 })))).toBeCloseTo(5, 5);
    expect(thickness(nib1Outline(light, brush({ angle: 90, size: 10, tip: 0, thinning: 0.5, sim: true })))).toBeCloseTo(10, 5);
  });

  it("un tratto di un punto è la punta ferma, e un tratto vuoto non disegna", () => {
    const dot = nib1Outline(line([{ x: 500, y: 500, t: 0 }]), brush({ angle: 90, size: 8, tip: 2 }));
    expect(dot).toHaveLength(4);
    expect(thickness(dot)).toBeCloseTo(8, 5);
    expect(nib1Outline(line([]), brush())).toEqual([]);
    expect(nib1(line([]), brush())).toBe("");
  });

  it("d è chiuso con le curve di pf1, e lo stesso per gli stessi campioni", () => {
    const d = nib1(across, brush());
    expect(d).toMatch(/^M[-\d. ]+ Q.* Z$/);
    expect(nib1(across, brush())).toBe(d);
  });

  it("rifiuta un pennello fuori dagli intervalli e campioni non quantizzati", () => {
    expect(() => nib1Outline(across, brush({ angle: 200 }))).toThrow(RangeError);
    expect(() => nib1Outline(line([{ x: 0.5, y: 0, t: 0 }]), brush())).toThrow(RangeError);
  });
});

describe("nib1, il pennello", () => {
  it("si legge e si riscrive canonico, con le chiavi sconosciute nell'ordine", () => {
    const read = parseInkBrush("nib1 angle=20 future=x size=6");
    expect(read).toEqual({ ...NIB1_DEFAULTS, angle: 20, size: 6, unknown: [["future", "x"]] });
    expect(formatInkBrush(read)).toBe("nib1 size=6 tip=1 angle=20 fixation=0.9 thinning=0.3 tilt=1 smoothing=0.6 streamline=0.5 sim=0 future=x");
  });

  it("dà gli errori di S004 come pf1", () => {
    const cases: [string, string][] = [
      ["nib1 size=0", "fub:brush range size"],
      ["nib1 angle=181", "fub:brush range angle"],
      ["nib1 tilt=2", "fub:brush range tilt"],
      ["nib1 tip=x", "fub:brush number tip"],
      ["nib1 tip=1 tip=2", "fub:brush repeated tip"],
      ["nib1 tip", "fub:brush entry"],
      ["nib2 size=1", "fub:brush algorithm"],
    ];
    for (const [text, detail] of cases) {
      try {
        parseInkBrush(text);
        throw new Error(`accettato: ${text}`);
      } catch (error) {
        expect(error, text).toBeInstanceOf(BrushError);
        expect((error as BrushError).detail, text).toBe(detail);
      }
    }
  });
});
