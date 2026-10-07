// Le scelte della finestra «Esporta», senza il DOM: da dove partono, che
// cosa esce e la richiesta per l'host.

import { describe, expect, it } from "vitest";
import {
  backgroundOf,
  chosenBoards,
  exportBox,
  exportMemoryOf,
  exportPieces,
  exportRequest,
  initialState,
  memoryOf,
  offered,
  ready,
  selectionTrouble,
  validPixels,
  type ExportMemory,
  type ExportScene,
  type ExportState,
} from "./export-plan";

const BOARDS: ExportScene = {
  selection: null,
  boards: [
    { id: "b1", name: "Copertina" },
    { id: "b2", name: "Evaporazione" },
    { id: "b3", name: "Pioggia" },
  ],
};

const SELECTED: ExportScene = {
  selection: { count: 2, ids: ["o2", "o3"], box: [258, 168, 84, 64] },
  boards: [],
};

const WORDS = { selection: "selezione", exported: "esportato" };

const memory = (patch: Partial<ExportMemory> = {}): ExportMemory => ({
  what: "drawing",
  off: [],
  format: "png",
  size: { scale: 2 },
  background: "paper",
  ...patch,
});

const state = (patch: Partial<ExportState> = {}): ExportState => ({
  what: "drawing",
  off: new Set(),
  format: "png",
  size: { scale: 2 },
  background: "paper",
  ...patch,
});

describe("selectionTrouble e offered", () => {
  it("la selezione si esporta se ogni oggetto ha un id e qualcosa si disegna", () => {
    expect(selectionTrouble(SELECTED.selection!)).toBeNull();
    expect(selectionTrouble({ count: 2, ids: ["o2"], box: [0, 0, 1, 1] })).toBe("unnamed");
    expect(selectionTrouble({ count: 1, ids: ["o2"], box: null })).toBe("empty");
    // Senza id conta prima: è la ragione che chi esporta può cambiare.
    expect(selectionTrouble({ count: 2, ids: [], box: null })).toBe("unnamed");
  });

  it("il disegno c'è sempre, la selezione se si esporta, le tavole se ce ne sono", () => {
    expect(offered(BOARDS, "drawing")).toBe(true);
    expect(offered(BOARDS, "selection")).toBe(false);
    expect(offered(BOARDS, "boards")).toBe(true);
    expect(offered(SELECTED, "selection")).toBe(true);
    expect(offered(SELECTED, "boards")).toBe(false);
    expect(offered({ selection: { count: 1, ids: [], box: [0, 0, 1, 1] }, boards: [] }, "selection")).toBe(false);
  });
});

describe("initialState", () => {
  it("senza memoria: le tavole se il disegno ne ha, il PNG a 2×, con la carta", () => {
    expect(initialState(BOARDS, null)).toEqual({ what: "boards", off: new Set(), format: "png", size: { scale: 2 }, background: "paper" });
    expect(initialState(SELECTED, null).what).toBe("drawing");
  });

  it("riprende le scelte ricordate dove valgono ancora", () => {
    const remembered = memory({ what: "boards", off: ["b2"], format: "pdf", size: { pixels: 1200 }, background: "none" });
    expect(initialState(BOARDS, remembered)).toEqual({ what: "boards", off: new Set(["b2"]), format: "pdf", size: { pixels: 1200 }, background: "none" });
  });

  it("la selezione ricordata vale solo se c'è una selezione da esportare", () => {
    expect(initialState(SELECTED, memory({ what: "selection" })).what).toBe("selection");
    expect(initialState(BOARDS, memory({ what: "selection" })).what).toBe("boards");
    expect(initialState({ selection: null, boards: [] }, memory({ what: "boards" })).what).toBe("drawing");
  });

  it("dimentica le tavole che non ci sono più, e se le tolte erano tutte ripartono tutte", () => {
    expect(initialState(BOARDS, memory({ what: "boards", off: ["b9", "b3"] })).off).toEqual(new Set(["b3"]));
    expect(initialState(BOARDS, memory({ what: "boards", off: ["b1", "b2", "b3"] })).off).toEqual(new Set());
  });

  it("memoryOf tiene le scelte, con le tavole tolte in un elenco", () => {
    const now = state({ what: "boards", off: new Set(["b2"]), format: "jpeg", size: { pixels: 800 } });
    expect(memoryOf(now)).toEqual({ what: "boards", off: ["b2"], format: "jpeg", size: { pixels: 800 }, background: "paper" });
    expect(initialState(BOARDS, memoryOf(now))).toEqual(now);
  });
});

describe("ciò che esce", () => {
  it("il JPEG esce sempre con la carta", () => {
    expect(backgroundOf(state({ background: "none" }))).toBe("none");
    expect(backgroundOf(state({ format: "jpeg", background: "none" }))).toBe("paper");
  });

  it("le tavole scelte, nell'ordine del documento", () => {
    expect(chosenBoards(state({ off: new Set(["b2"]) }), BOARDS).map((board) => board.id)).toEqual(["b1", "b3"]);
  });

  it("un pezzo per tavola, uno per il disegno e uno per la selezione", () => {
    expect(exportPieces(state({ what: "boards", off: new Set(["b1"]) }), BOARDS)).toEqual([
      { scope: { kind: "board", id: "b2" }, board: "Evaporazione" },
      { scope: { kind: "board", id: "b3" }, board: "Pioggia" },
    ]);
    expect(exportPieces(state(), BOARDS)).toEqual([{ scope: { kind: "drawing" }, board: null }]);
    expect(exportPieces(state({ what: "selection" }), SELECTED)).toEqual([
      { scope: { kind: "selection", ids: ["o2", "o3"], box: [258, 168, 84, 64] }, board: null },
    ]);
  });

  it("la richiesta del PNG delle tavole porta gli id e la scala", () => {
    expect(exportRequest(state({ what: "boards", off: new Set(["b2"]), size: { scale: 3 } }), BOARDS, WORDS)).toEqual({
      target: "draw.png",
      options: { background: "paper", scope: "boards", boards: ["b1", "b3"], scale: 3 },
    });
  });

  it("la richiesta della selezione porta gli id, il riquadro e la parola del nome del file", () => {
    expect(exportRequest(state({ what: "selection", format: "jpeg", size: { pixels: 1600 }, background: "none" }), SELECTED, WORDS)).toEqual({
      target: "draw.jpeg",
      options: { background: "paper", scope: "selection", selection: { ids: ["o2", "o3"], box: [258, 168, 84, 64] }, suffix: "selezione", width: 1600 },
    });
  });

  it("SVG e PDF non hanno misura in pixel; l'SVG del disegno ha la sua parola, per non chiamarsi come il disegno", () => {
    expect(exportRequest(state({ format: "svg", size: { pixels: 900 }, background: "none" }), BOARDS, WORDS)).toEqual({
      target: "draw.svg",
      options: { background: "none", scope: "drawing", suffix: "esportato" },
    });
    expect(exportRequest(state({ what: "boards", format: "svg" }), BOARDS, WORDS).options).not.toHaveProperty("suffix");
    expect(exportRequest(state({ format: "png" }), BOARDS, WORDS).options).not.toHaveProperty("suffix");
    expect(exportRequest(state({ what: "boards", format: "pdf" }), BOARDS, WORDS).options).toEqual({
      background: "paper",
      scope: "boards",
      boards: ["b1", "b2", "b3"],
    });
  });

  it("si esporta con almeno una tavola e una larghezza intera nei limiti", () => {
    expect(ready(state({ what: "boards" }), BOARDS)).toBe(true);
    expect(ready(state({ what: "boards", off: new Set(["b1", "b2", "b3"]) }), BOARDS)).toBe(false);
    expect(ready(state({ what: "selection" }), BOARDS)).toBe(false);
    expect(ready(state({ size: { pixels: 16384 } }), BOARDS)).toBe(true);
    expect(ready(state({ size: { pixels: 16385 } }), BOARDS)).toBe(false);
    expect(ready(state({ size: { pixels: 12.5 } }), BOARDS)).toBe(false);
    expect(validPixels(0)).toBe(false);
    expect(validPixels(1)).toBe(true);
    expect(validPixels(Number.NaN)).toBe(false);
  });
});

describe("exportMemoryOf", () => {
  it("legge le scelte ricordate", () => {
    const value = { what: "boards", off: ["b2"], format: "pdf", size: { scale: 4 }, background: "none" };
    expect(exportMemoryOf(value)).toEqual(value);
    expect(exportMemoryOf({ ...value, size: { pixels: 640 } })!.size).toEqual({ pixels: 640 });
  });

  it("rifiuta ciò che non lo è", () => {
    const good = { what: "drawing", off: [], format: "png", size: { scale: 2 }, background: "paper" };
    expect(exportMemoryOf(null)).toBeNull();
    expect(exportMemoryOf("png")).toBeNull();
    expect(exportMemoryOf({ ...good, what: "everything" })).toBeNull();
    expect(exportMemoryOf({ ...good, off: [1] })).toBeNull();
    expect(exportMemoryOf({ ...good, format: "gif" })).toBeNull();
    expect(exportMemoryOf({ ...good, background: "white" })).toBeNull();
    expect(exportMemoryOf({ ...good, size: { scale: 5 } })).toBeNull();
    expect(exportMemoryOf({ ...good, size: { pixels: 0 } })).toBeNull();
    expect(exportMemoryOf({ ...good, size: null })).toBeNull();
  });
});

describe("exportBox", () => {
  it("va sui numeri interi verso fuori", () => {
    expect(exportBox([10.2, -3.7], [50.1, 20.0])).toEqual([10, -4, 41, 24]);
    expect(exportBox([0, 0], [100, 50])).toEqual([0, 0, 100, 50]);
  });

  it("è largo e alto almeno un'unità", () => {
    expect(exportBox([5, 5], [5, 5])).toEqual([5, 5, 1, 1]);
  });
});
