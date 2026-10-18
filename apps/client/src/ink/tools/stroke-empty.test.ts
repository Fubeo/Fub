import { describe, expect, it, vi } from "vitest";
import { PF1_DEFAULTS } from "../brush";
import { buildStroke } from "./stroke";

// `pf1Outline` può dare un contorno vuoto (perfect-freehand non lo fa con
// inchiostro valido, ma il contratto di `pf1Outline` non lo esclude): il tratto
// allora non si scrive, e non è un errore dei campioni.
vi.mock("../pf1", async (importActual) => {
  const actual = await importActual<typeof import("../pf1")>();
  return { ...actual, pf1Outline: vi.fn(() => []) };
});

describe("un tratto senza contorno", () => {
  it("non si scrive, e lo dice diverso da un tratto che l'inchiostro rifiuta", () => {
    const samples = [{ x: 0, y: 0, t: 0 }, { x: 4, y: 4, t: 8 }];
    expect(buildStroke(samples, PF1_DEFAULTS, [])).toEqual({ ok: false, reason: "empty" });
    expect(buildStroke([{ x: Number.NaN, y: 0, t: 0 }], PF1_DEFAULTS, [])).toEqual({ ok: false, reason: "failed" });
  });
});
