import { describe, expect, it } from "vitest";
import { brushForInput, checkBrush, formatBrush, parseBrush, PF1_DEFAULTS, type Pf1Brush } from "./brush";

const PEN = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

describe("il pennello pf1 (§5)", () => {
  it("legge e riscrive il pennello canonico identico", () => {
    const brush = parseBrush(PEN);
    expect(brush).toEqual({
      size: 4,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
      sim: false,
      unknown: [],
    });
    expect(formatBrush(brush)).toBe(PEN);
  });

  it("una chiave che manca vale l'opzione omessa di getStroke, e la scrittura le mette tutte", () => {
    expect(parseBrush("pf1")).toEqual(PF1_DEFAULTS);
    expect(PF1_DEFAULTS.size).toBe(16);
    expect(formatBrush(parseBrush("pf1 size=2.5 sim=0"))).toBe(
      "pf1 size=2.5 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0",
    );
  });

  it("conserva le chiavi sconosciute nell'ordine, anche ripetute, dopo quelle note", () => {
    const brush = parseBrush("pf1 future=x size=3 other=1=2 future=y");
    expect(brush.unknown).toEqual([["future", "x"], ["other", "1=2"], ["future", "y"]]);
    expect(formatBrush(brush)).toBe(
      "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=1"
        + " future=x other=1=2 future=y",
    );
    expect(parseBrush(formatBrush(brush))).toEqual(brush);
  });

  it("accetta gli spazi di XML fra le voci e i numeri SVG, e riscrive senza esponente", () => {
    const brush = parseBrush("  pf1\tsize=1e1\n thinning=-.25\r\nsmoothing=+0.75  streamline=1. capEnd=0.0 ");
    expect(brush.size).toBe(10);
    expect(brush.thinning).toBe(-0.25);
    expect(brush.smoothing).toBe(0.75);
    expect(brush.streamline).toBe(1);
    expect(brush.capEnd).toBe(false);
    expect(formatBrush({ ...brush, size: 1.5e-7 })).toContain("size=0.00000015 ");
  });

  it("un pennello che non si legge è S004: grammatica con TypeError, intervalli con RangeError", () => {
    expect(() => parseBrush("")).toThrow(TypeError);
    expect(() => parseBrush("pf2 size=4")).toThrow(TypeError);
    expect(() => parseBrush("size=4 pf1")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size")).toThrow(TypeError);
    expect(() => parseBrush("pf1 =4")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size=")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size=4 size=5")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size=0x10")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size=Infinity")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size=4px")).toThrow(TypeError);
    expect(() => parseBrush("pf1 size=1e400")).toThrow(RangeError);
    expect(() => parseBrush("pf1 size=0")).toThrow(RangeError);
    expect(() => parseBrush("pf1 size=-2")).toThrow(RangeError);
    expect(() => parseBrush("pf1 thinning=1.5")).toThrow(RangeError);
    expect(() => parseBrush("pf1 thinning=-1.01")).toThrow(RangeError);
    expect(() => parseBrush("pf1 smoothing=-0.1")).toThrow(RangeError);
    expect(() => parseBrush("pf1 streamline=2")).toThrow(RangeError);
    expect(() => parseBrush("pf1 taperStart=-1")).toThrow(RangeError);
    expect(() => parseBrush("pf1 capStart=2")).toThrow(RangeError);
    expect(() => parseBrush("pf1 sim=0.5")).toThrow(RangeError);
    expect(parseBrush("pf1 thinning=-1").thinning).toBe(-1);
    expect(parseBrush("pf1 taperEnd=1000").taperEnd).toBe(1000);
  });

  it("non scrive un pennello che non si potrebbe rileggere", () => {
    const base: Pf1Brush = { ...PF1_DEFAULTS };
    expect(() => formatBrush({ ...base, size: Number.NaN })).toThrow(RangeError);
    expect(() => formatBrush({ ...base, unknown: [["size", "4"]] })).toThrow(RangeError);
    expect(() => formatBrush({ ...base, unknown: [["a b", "4"]] })).toThrow(RangeError);
    expect(() => formatBrush({ ...base, unknown: [["a=b", "4"]] })).toThrow(RangeError);
    expect(() => formatBrush({ ...base, unknown: [["key", "a b"]] })).toThrow(RangeError);
    expect(() => formatBrush({ ...base, unknown: [["key", ""]] })).toThrow(RangeError);
    expect(() => checkBrush({ ...base, sim: 1 as unknown as boolean })).toThrow(RangeError);
  });

  it("senza canale di pressione il pennello simula la pressione", () => {
    const brush = parseBrush(PEN);
    expect(brushForInput(brush, true)).toBe(brush);
    expect(brushForInput(brush, false)).toEqual({ ...brush, sim: true });
    const simulated = { ...brush, sim: true };
    expect(brushForInput(simulated, false)).toBe(simulated);
  });
});
