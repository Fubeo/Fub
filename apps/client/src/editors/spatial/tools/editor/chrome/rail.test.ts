// Le caselle della colonna degli strumenti (`railLayout`): il Testo nelle
// forme del disegno, dopo la Freccia; nel PDF non c'è; in una colonna scelta
// non compare finché chi l'ha scelta non lo aggiunge.

import { describe, expect, it } from "vitest";
import { TOOLS, toolsFor } from "../../registry";
import { CASELLE_SALVATE_MAX, caselleCheStanno, PASSO_CASELLA, railLayout } from "./rail";

describe("la colonna che non scorre", () => {
  it("le caselle che stanno in una misura, con «Tutti gli strumenti» che ne occupa una", () => {
    expect(caselleCheStanno(44 * 10, 14)).toBe(9);
    expect(caselleCheStanno(44 * 10 + 43, 14)).toBe(9);
    expect(caselleCheStanno(44 * 30, 14)).toBe(14);
    expect(caselleCheStanno(44, 14)).toBe(0);
  });

  it("una misura che non c'è non toglie caselle", () => {
    expect(caselleCheStanno(0, 14)).toBe(14);
    expect(PASSO_CASELLA).toBe(44);
  });

  it("una colonna salvata con più di quindici caselle ne mostra quindici: le altre vanno nel cassetto", () => {
    // Diciotto strumenti offerti, tutti salvati: la colonna ne mostra i primi quindici.
    const finti = Array.from({ length: 18 }, (_, at) => ({ ...TOOLS[0]!, id: `t${at}` as never }));
    const offerti = [TOOLS[0]!, ...finti];
    const salvati = offerti.map((spec) => spec.id);
    const mostrate = railLayout(offerti, "vector", salvati).flat(2);
    expect(mostrate).toEqual(salvati.slice(0, CASELLE_SALVATE_MAX));
  });

  it("uno strumento sconosciuto nella colonna salvata si salta", () => {
    const tools = toolsFor("full", "vector");
    const mostrate = railLayout(tools, "vector", ["select", "motore:inventato" as never, "pen"]).flat(2);
    expect(mostrate).toEqual(["select", "pen"]);
  });
});

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
