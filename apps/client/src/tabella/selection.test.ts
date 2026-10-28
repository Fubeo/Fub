import { describe, expect, it } from "vitest";
import { touches, withRange } from "./selection";

describe("la selezione a più intervalli", () => {
  it("dice se un intervallo tocca una cella o un'unione", () => {
    const range = { r0: 1, c0: 1, r1: 2, c1: 3 };
    expect(touches(range, 1, 1)).toBe(true);
    expect(touches(range, 0, 0)).toBe(false);
    expect(touches(range, 0, 0, 1, 1)).toBe(true);
    expect(touches(range, 3, 3)).toBe(false);
  });

  it("aggiunge in fondo, senza ripetere un intervallo uguale", () => {
    const a = { r0: 0, c0: 0, r1: 0, c1: 0 };
    const b = { r0: 2, c0: 2, r1: 3, c1: 3 };
    expect(withRange([a], b)).toEqual([a, b]);
    expect(withRange([a, b], { ...a })).toEqual([b, a]);
  });
});
