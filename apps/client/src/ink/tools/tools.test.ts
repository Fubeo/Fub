import { describe, expect, it } from "vitest";
import { formatInkBrush, isNib1, PF1_DEFAULTS, penOf, withPen } from "../brush";
import { DEFAULT_PEN, penBrush, penLook } from "../pens";
import { ERASER } from "./eraser";
import { HIGHLIGHTER, HIGHLIGHTER_OPACITY } from "./highlighter";
import { PEN } from "./pen";
import { INK_TOOLS, InkToolRegistry, systemInkTools } from "./registry";
import { checkTool, closedAtLimit, joined, type EraseTool, type StrokeTool } from "./tool";

// Gli strumenti da soli: la ricetta del tratto, le capacità, il registro. Un
// tratto già scritto non cambia con le penne: il suo pennello sta nel file.

const fresh = { pressure: true, continued: false };

describe("la penna", () => {
  it("scrive con la Sfera, se non si sceglie un'altra penna, e lo dice nel pennello", () => {
    expect(PEN.pens[0]).toBe(DEFAULT_PEN);
    expect(PEN.brush(4, fresh)).toEqual(penBrush("ballpoint", 4, true));
    expect(formatInkBrush(PEN.brush(4, fresh))).toBe(
      "pf1 size=4 thinning=0.25 smoothing=0.5 streamline=0.5 taperStart=4 taperEnd=16 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    );
  });

  it("senza pressione (mouse, dito) la finge, e il file lo dice con sim=1", () => {
    const brush = PEN.brush(4, { pressure: false, continued: false });
    expect(formatInkBrush(brush)).toContain("sim=1");
    expect(formatInkBrush(PEN.brush(4, fresh))).toContain("sim=0");
  });

  it("ogni sua penna dà il suo pennello; quella di un altro strumento no", () => {
    for (const pen of PEN.pens) expect(penOf(PEN.brush(5, fresh, pen))).toBe(pen);
    expect(PEN.pens).not.toContain("highlighter");
    expect(penOf(PEN.brush(5, fresh, "highlighter"))).toBe(DEFAULT_PEN);
    expect(isNib1(PEN.brush(12, fresh, "calligraphy"))).toBe(true);
  });

  it("copre del tutto, raddrizza con Maiusc e può tenersi ferma per diventare una forma", () => {
    expect(PEN.opacity).toBe(1);
    expect(PEN.capabilities).toEqual({
      pressure: true,
      straightWithModifier: true,
      symmetry: true,
      holdsToShape: true,
      stabilizes: true,
    });
  });
});

describe("l'evidenziatore", () => {
  it("ha lo spessore costante e le punte piatte, qualunque sia il dispositivo", () => {
    const expected = withPen({ ...PF1_DEFAULTS, size: 16, thinning: 0, capStart: false, capEnd: false, sim: false }, "highlighter");
    expect(HIGHLIGHTER.brush(16, fresh)).toEqual(expected);
    expect(HIGHLIGHTER.brush(16, { pressure: false, continued: false })).toEqual(expected);
  });

  it("si vede attraverso a metà e moltiplica: il nero sotto resta nero", () => {
    expect(HIGHLIGHTER.opacity).toBe(0.5);
    expect(HIGHLIGHTER_OPACITY).toBe(0.5);
    expect(penLook(HIGHLIGHTER.brush(16, fresh), "highlighter")).toEqual({ opacity: 0.5, blend: "multiply" });
    expect(HIGHLIGHTER.capabilities.straightWithModifier).toBe(true);
    expect(HIGHLIGHTER.capabilities.pressure).toBe(false);
    expect(HIGHLIGHTER.capabilities.holdsToShape).toBe(false);
  });
});

describe("la gomma", () => {
  it("è più larga col dito, che copre ciò che cancella", () => {
    expect(ERASER.radius("pen")).toBe(8);
    expect(ERASER.radius("mouse")).toBe(8);
    expect(ERASER.radius("touch")).toBe(16);
  });
});

describe("il pennello al limite dei campioni", () => {
  const tapered = { ...PF1_DEFAULTS, taperStart: 12, taperEnd: 12 };

  it("il seguito di un tratto non si assottiglia alla giunzione", () => {
    expect(joined(tapered, { pressure: true, continued: true })).toEqual({ ...tapered, taperStart: 0 });
    expect(joined(tapered, fresh)).toBe(tapered);
  });

  it("il pezzo che si chiude al limite non si assottiglia alla fine", () => {
    expect(closedAtLimit(tapered, true)).toEqual({ ...tapered, taperEnd: 0 });
    expect(closedAtLimit(tapered, false)).toBe(tapered);
  });
});

describe("il registro degli strumenti dell'inchiostro", () => {
  const custom: StrokeTool = {
    kind: "stroke",
    id: "marker-2",
    opacity: 0.8,
    capabilities: { pressure: false, straightWithModifier: false, symmetry: false, holdsToShape: false, stabilizes: false },
    pens: ["marker"],
    brush: (width) => ({ ...PF1_DEFAULTS, size: width }),
  };

  it("i prodotti trovano penna, evidenziatore e gomma già registrati", () => {
    expect(INK_TOOLS.list().map((tool) => tool.id)).toEqual(["pen", "highlighter", "eraser"]);
    expect(INK_TOOLS.stroke("pen")).toBe(PEN);
    expect(INK_TOOLS.stroke("highlighter")).toBe(HIGHLIGHTER);
    expect(INK_TOOLS.erase("eraser")).toBe(ERASER);
    expect(INK_TOOLS.get("pen")).toBe(PEN);
  });

  it("uno strumento che scrive non è una gomma, e viceversa", () => {
    expect(INK_TOOLS.erase("pen")).toBeUndefined();
    expect(INK_TOOLS.stroke("eraser")).toBeUndefined();
    expect(INK_TOOLS.get("lasso")).toBeUndefined();
    expect(INK_TOOLS.stroke("lasso")).toBeUndefined();
  });

  it("registrare uno strumento nuovo lo rende trovabile, e il disposer lo toglie", () => {
    const registry = systemInkTools();
    const dispose = registry.register(custom);
    expect(registry.stroke("marker-2")).toBe(custom);
    expect(registry.list().map((tool) => tool.id)).toEqual(["pen", "highlighter", "eraser", "marker-2"]);
    dispose();
    expect(registry.get("marker-2")).toBeUndefined();
    // Il disposer si può ripetere e non toglie ciò che nel frattempo è arrivato.
    dispose();
    const other = registry.register({ ...custom });
    dispose();
    expect(registry.get("marker-2")).toBeDefined();
    other();
    expect(registry.get("marker-2")).toBeUndefined();
  });

  it("due strumenti con lo stesso id non si sostituiscono di nascosto", () => {
    const registry = systemInkTools();
    expect(() => registry.register(PEN)).toThrow(RangeError);
    expect(registry.stroke("pen")).toBe(PEN);
  });

  it("un id che il file non scriverebbe, o un'opacità fuori scala, si rifiutano alla registrazione", () => {
    const registry = new InkToolRegistry();
    for (const id of ["", "Pen", "2pen", "pen tool", "pen:1", "pen_x"]) {
      expect(() => registry.register({ ...custom, id }), id).toThrow(RangeError);
    }
    for (const opacity of [0, -0.1, 1.01, Number.NaN]) {
      expect(() => registry.register({ ...custom, opacity }), String(opacity)).toThrow(RangeError);
    }
    expect(registry.list()).toEqual([]);
    const eraser: EraseTool = { kind: "erase", id: "Bad Id", radius: () => 1 };
    expect(() => checkTool(eraser)).toThrow(RangeError);
  });

  it("gli strumenti di sistema sono in sola lettura e ogni registro è indipendente", () => {
    const registry = systemInkTools();
    registry.register(custom);
    expect(systemInkTools().get("marker-2")).toBeUndefined();
    expect(INK_TOOLS.get("marker-2")).toBeUndefined();
    expect("register" in INK_TOOLS).toBe(false);
  });
});
