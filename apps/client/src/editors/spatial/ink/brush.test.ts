import { describe, expect, it } from "vitest";
import { BrushError, brushForInput, checkBrush, formatBrush, parseBrush, PF1_DEFAULTS, type Pf1Brush } from "./brush";

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
    const brush = parseBrush("  pf1\tsize=1e1\n thinning=-.25\r\nsmoothing=+0.75  streamline=1.0 capEnd=0.0 ");
    expect(brush.size).toBe(10);
    expect(brush.thinning).toBe(-0.25);
    expect(brush.smoothing).toBe(0.75);
    expect(brush.streamline).toBe(1);
    expect(brush.capEnd).toBe(false);
    expect(formatBrush({ ...brush, size: 1.5e-7 })).toContain("size=0.00000015 ");
  });

  it("un pennello che non si legge è S004, con l'errore di fub-scene come dettaglio", () => {
    const failure = (text: string): string => {
      try {
        parseBrush(text);
      } catch (error) {
        expect(error).toBeInstanceOf(BrushError);
        return (error as BrushError).detail;
      }
      throw new Error(`${text} si legge`);
    };
    expect(failure("")).toBe("fub:brush algorithm");
    expect(failure("pf2 size=4")).toBe("fub:brush algorithm");
    expect(failure("size=4 pf1")).toBe("fub:brush algorithm");
    expect(failure("pf1 size")).toBe("fub:brush entry");
    expect(failure("pf1 =4")).toBe("fub:brush entry");
    expect(failure("pf1 size=")).toBe("fub:brush entry");
    expect(failure("pf1 size=4 size=5")).toBe("fub:brush repeated size");
    expect(failure("pf1 size=0x10")).toBe("fub:brush number size");
    expect(failure("pf1 streamline=1.")).toBe("fub:brush number streamline");
    expect(failure("pf1 size=-1.e3")).toBe("fub:brush number size");
    expect(parseBrush("pf1 size=.5e1 thinning=-.25").size).toBe(5);
    expect(failure("pf1 size=Infinity")).toBe("fub:brush number size");
    expect(failure("pf1 size=4px")).toBe("fub:brush number size");
    // Nella grammatica ma non in un double: per `brush.rs` non è un numero.
    expect(failure("pf1 size=1e400")).toBe("fub:brush number size");
    expect(failure("pf1 size=0")).toBe("fub:brush range size");
    expect(failure("pf1 size=-2")).toBe("fub:brush range size");
    expect(failure("pf1 thinning=1.5")).toBe("fub:brush range thinning");
    expect(failure("pf1 thinning=-1.01")).toBe("fub:brush range thinning");
    expect(failure("pf1 smoothing=-0.1")).toBe("fub:brush range smoothing");
    expect(failure("pf1 streamline=2")).toBe("fub:brush range streamline");
    expect(failure("pf1 taperStart=-1")).toBe("fub:brush range taperStart");
    expect(failure("pf1 capStart=2")).toBe("fub:brush range capStart");
    expect(failure("pf1 sim=0.5")).toBe("fub:brush range sim");
    expect(parseBrush("pf1 thinning=-1").thinning).toBe(-1);
    expect(parseBrush("pf1 taperEnd=1000").taperEnd).toBe(1000);
  });

  it("il primo errore è quello di brush.rs: voci in ordine, poi chiave per chiave", () => {
    const detail = (text: string): string => {
      try {
        parseBrush(text);
        return "ok";
      } catch (error) {
        return (error as BrushError).detail;
      }
    };
    // Le voci si leggono tutte prima dei numeri.
    expect(detail("pf1 size=x size=4")).toBe("fub:brush repeated size");
    expect(detail("pf1 size=x junk")).toBe("fub:brush entry");
    expect(detail("pf1 size=4 size=5 junk")).toBe("fub:brush repeated size");
    // Ogni chiave controlla il numero e subito dopo l'intervallo, in ordine.
    expect(detail("pf1 size=0 thinning=x")).toBe("fub:brush range size");
    expect(detail("pf1 thinning=x size=0")).toBe("fub:brush range size");
    expect(detail("pf1 thinning=2 smoothing=x")).toBe("fub:brush range thinning");
    expect(detail("pf1 sim=x taperEnd=-1")).toBe("fub:brush range taperEnd");
    expect(detail("pf1 capEnd=x capStart=2")).toBe("fub:brush range capStart");
    expect(new BrushError("missing").detail).toBe("fub:brush missing");
    expect(new BrushError("range", "size").message).toBe("size di fub:brush è fuori dall'intervallo");
  });

  it("ogni pennello malformato ha l'errore di tests/ink.rs", () => {
    const cases: [string, string][] = [
      ["", "algorithm"],
      ["pf2 size=4", "algorithm"],
      ["PF1", "algorithm"],
      ["size=4 pf1", "algorithm"],
      ["pf1size=4", "algorithm"],
      ["pf1 size", "entry"],
      ["pf1 =4", "entry"],
      ["pf1 size=", "entry"],
      ["pf1 future=", "entry"],
      ["pf1 size=4 size=5", "repeated size"],
      ["pf1 streamline=1.", "number streamline"],
      ["pf1 sim=1 future=1 sim=1", "repeated sim"],
      ["pf1 size=0x10", "number size"],
      ["pf1 size=Infinity", "number size"],
      ["pf1 size=4px", "number size"],
      ["pf1 size=1e400", "number size"],
      ["pf1 thinning=.", "number thinning"],
      ["pf1 taperStart=1e", "number taperStart"],
      ["pf1 capEnd=true", "number capEnd"],
      ["pf1 size=0", "range size"],
      ["pf1 size=-2", "range size"],
      ["pf1 thinning=1.5", "range thinning"],
      ["pf1 thinning=-1.01", "range thinning"],
      ["pf1 smoothing=-0.1", "range smoothing"],
      ["pf1 streamline=2", "range streamline"],
      ["pf1 taperStart=-1", "range taperStart"],
      ["pf1 taperEnd=-0.5", "range taperEnd"],
      ["pf1 capStart=2", "range capStart"],
      ["pf1 sim=0.5", "range sim"],
    ];
    for (const [text, detail] of cases) {
      expect(() => parseBrush(text), text).toThrow(BrushError);
      try {
        parseBrush(text);
      } catch (error) {
        expect((error as BrushError).detail, text).toBe(`fub:brush ${detail}`);
      }
    }
    expect(() => parseBrush("pf1 capStart=1e0 sim=-0")).not.toThrow();
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
