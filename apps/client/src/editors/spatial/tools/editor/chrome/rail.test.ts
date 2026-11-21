// @vitest-environment happy-dom
// Le caselle della colonna degli strumenti (`railLayout`): il Testo nelle
// forme del disegno, dopo la Freccia; nel PDF non c'è; in una colonna scelta
// non compare finché chi l'ha scelta non lo aggiunge.

import { describe, expect, it } from "vitest";
import { TOOLS, toolsFor } from "../../registry";
import { CASELLE_SALVATE_MAX, caselleCheStanno, misureColonna, MISURE_DI_SERIE, PASSO_CASELLA, railLayout, spazioCaselle, type MisureColonna } from "./rail";

/// Misure senza fili né cornice: un bersaglio di 44 px per casella.
const PIATTE: MisureColonna = { lato: 44, filoCasella: 0, filoGruppo: 0, respiroGruppo: 0, cornice: 0 };

/// Misure con fili, padding e cornice: la colonna vera del disegno.
const VERE: MisureColonna = { lato: 44, filoCasella: 4, filoGruppo: 8, respiroGruppo: 4, cornice: 16 };

describe("la colonna che non scorre", () => {
  it("le caselle che stanno in una misura, con «Tutti gli strumenti» che ne occupa una", () => {
    expect(caselleCheStanno(44 * 10, [14], PIATTE)).toBe(9);
    expect(caselleCheStanno(44 * 10 + 43, [14], PIATTE)).toBe(9);
    expect(caselleCheStanno(44 * 30, [14], PIATTE)).toBe(14);
    expect(caselleCheStanno(44, [14], PIATTE)).toBe(0);
  });

  it("i fili fra le caselle e fra i gruppi contano: la casella che sta con i fili è quella che sta davvero", () => {
    const gruppi = [3, 4, 4, 2, 1, 1];
    const tutta = spazioCaselle([...gruppi, 1], VERE);
    expect(caselleCheStanno(tutta, gruppi, VERE)).toBe(15);
    expect(caselleCheStanno(tutta - 1, gruppi, VERE)).toBe(14);
  });

  it("una misura che non c'è non toglie caselle", () => {
    expect(caselleCheStanno(0, [14], PIATTE)).toBe(14);
    expect(caselleCheStanno(0, [14], MISURE_DI_SERIE)).toBe(14);
    expect(PASSO_CASELLA).toBe(44);
  });

  it("misura il contenitore della colonna: con l'altezza della sola colonna (44 px) non ci sta nessuna casella", () => {
    // Il difetto di K6 T8: la colonna è alta quanto le sue caselle, e leggere
    // quella misura mandava tutto nel cassetto. Col contenitore, 604 px stanno.
    const contenitore = document.createElement("div");
    contenitore.className = "draw-rail";
    Object.defineProperty(contenitore, "clientHeight", { value: 604 });
    const colonna = document.createElement("div");
    colonna.className = "kit-rail";
    colonna.dataset.orientation = "vertical";
    Object.defineProperty(colonna, "offsetHeight", { value: 44 });
    const casella = document.createElement("button");
    casella.className = "kit-rail-slot";
    Object.defineProperty(casella, "offsetHeight", { value: 44 });
    colonna.append(casella);
    contenitore.append(colonna);
    document.body.append(contenitore);
    const { lunghezza, misure } = misureColonna(colonna);
    contenitore.remove();
    expect(lunghezza).toBe(604);
    expect(misure.lato).toBe(44);
    expect(caselleCheStanno(lunghezza, [14], misure)).toBe(12);
    expect(caselleCheStanno(44, [14], misure)).toBe(0);
  });

  it("una colonna orizzontale (700 px) misura la sua larghezza", () => {
    const contenitore = document.createElement("div");
    contenitore.className = "draw-rail";
    Object.defineProperty(contenitore, "clientWidth", { value: 660 });
    const colonna = document.createElement("div");
    colonna.className = "kit-rail";
    colonna.dataset.orientation = "horizontal";
    contenitore.append(colonna);
    document.body.append(contenitore);
    const { lunghezza } = misureColonna(colonna);
    contenitore.remove();
    expect(lunghezza).toBe(660);
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
