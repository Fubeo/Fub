// Le caselle della colonna degli strumenti (`railLayout`): il Testo nelle
// forme del disegno, dopo la Freccia; nel PDF non c'è; in una colonna scelta
// non compare finché chi l'ha scelta non lo aggiunge.

import { describe, expect, it } from "vitest";
import { toolsFor } from "../../registry";
import { railLayout } from "./rail";

describe("la colonna degli strumenti", () => {
  it("il disegno ha il Testo nel gruppo delle forme, in una casella sua dopo le forme", () => {
    for (const space of ["full", "simple"] as const) {
      expect(railLayout(toolsFor(space, "vector"), "vector")).toEqual([
        [["select"], ["hand", "zoom"]],
        [["pen", "highlighter"], ["eraser"]],
        [["rect", "ellipse", "line", "arrow"], ["text"]],
      ]);
    }
  });

  it("il PDF non ha il Testo", () => {
    expect(railLayout(toolsFor("full", "pdf"), "pdf").flat(2)).not.toContain("text");
  });

  it("una colonna scelta in «Personalizza la barra…» non prende il Testo da sé, e lo tiene se lo si aggiunge", () => {
    const tools = toolsFor("full", "vector");
    expect(railLayout(tools, "vector", ["select", "pen", "rect"]).flat(2)).not.toContain("text");
    expect(railLayout(tools, "vector", ["select", "pen", "text"])).toEqual([[["select"]], [["pen"]], [["text"]]]);
  });
});
