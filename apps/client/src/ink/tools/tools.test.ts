import { describe, expect, it } from "vitest";
import { brushForInput, formatBrush, PF1_DEFAULTS } from "../brush";
import { ERASER } from "./eraser";
import { HIGHLIGHTER, HIGHLIGHTER_OPACITY } from "./highlighter";
import { PEN } from "./pen";
import { INK_TOOLS, InkToolRegistry, systemInkTools } from "./registry";
import { checkTool, closedAtLimit, joined, type EraseTool, type StrokeTool } from "./tool";

// Gli strumenti da soli: la ricetta del tratto, le capacità, il registro. Le
// ricette sono quelle che FubDraw aveva dentro l'editor, e i test le fissano
// com'erano: un tratto già scritto non deve cambiare perché lo strumento si è
// spostato.

const fresh = { pressure: true, continued: false };

describe("la penna", () => {
  it("col canale della pressione scrive il pennello di perfect-freehand, a tutto spessore", () => {
    expect(PEN.brush(4, fresh)).toEqual({ ...PF1_DEFAULTS, size: 4, sim: false });
  });

  it("senza pressione (mouse, dito) la finge, e il file lo dice con sim=1", () => {
    const brush = PEN.brush(4, { pressure: false, continued: false });
    expect(brush).toEqual({ ...PF1_DEFAULTS, size: 4, sim: true });
    expect(formatBrush(brush)).toContain("sim=1");
    expect(formatBrush(PEN.brush(4, fresh))).toContain("sim=0");
    expect(brush).toEqual(brushForInput({ ...PF1_DEFAULTS, size: 4, sim: false }, false));
  });

  it("è la ricetta che l'editor aveva scritta due volte: del puntatore e del tratto da tastiera", () => {
    // Del puntatore: `brushForInput({ …PF1_DEFAULTS, size, sim: false }, pressione)`.
    for (const pressure of [true, false]) {
      expect(PEN.brush(7, { pressure, continued: false })).toEqual(brushForInput({ ...PF1_DEFAULTS, size: 7, sim: false }, pressure));
    }
    // Da tastiera, senza dispositivo: `{ …PF1_DEFAULTS, size, sim: true }`.
    expect(PEN.brush(7, { pressure: false, continued: false })).toEqual({ ...PF1_DEFAULTS, size: 7, sim: true });
  });

  it("copre del tutto e può tenersi ferma per diventare una forma", () => {
    expect(PEN.opacity).toBe(1);
    expect(PEN.capabilities).toEqual({
      pressure: true,
      straightWithModifier: false,
      symmetry: true,
      holdsToShape: true,
      stabilizes: true,
    });
  });
});

describe("l'evidenziatore", () => {
  it("ha lo spessore costante e le punte piatte, qualunque sia il dispositivo", () => {
    const expected = { ...PF1_DEFAULTS, size: 16, thinning: 0, capStart: false, capEnd: false, sim: false };
    expect(HIGHLIGHTER.brush(16, fresh)).toEqual(expected);
    expect(HIGHLIGHTER.brush(16, { pressure: false, continued: false })).toEqual(expected);
    // Il pennello che l'editor scriveva a mano per il puntatore e per la tastiera.
    expect(expected).toEqual({ ...PF1_DEFAULTS, size: 16, thinning: 0, capStart: false, capEnd: false, sim: false });
  });

  it("si vede attraverso al 40%, il numero che il file scrive nel riempimento", () => {
    expect(HIGHLIGHTER.opacity).toBe(0.4);
    expect(HIGHLIGHTER_OPACITY).toBe(0.4);
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
