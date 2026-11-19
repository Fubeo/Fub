import { describe, expect, it } from "vitest";
import { defaultProfile } from "../profile";
import { SECTIONS } from "./index";

function summaries(profile = defaultProfile()): Record<string, string> {
  return Object.fromEntries(SECTIONS.map((section) => [section.id, section.summary(profile)]));
}

describe("le dieci sezioni del pannello", () => {
  it("sono dieci, nell'ordine del prototipo, con identità stabili", () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(["tema", "colori", "caratteri", "pagina", "testata", "fronte", "contenuto", "diagrammi", "interruzioni", "uscita"]);
  });

  it("chiuse, dicono ciò che vale col profilo di serie", () => {
    expect(summaries()).toEqual({
      tema: "Fub",
      colori: "Del tema",
      caratteri: "Del tema",
      pagina: "A4 verticale",
      testata: "Titolo, Numero di pagina",
      fronte: "Nessuno",
      contenuto: "Tutta la nota",
      diagrammi: "Come nella nota",
      interruzioni: "Automatiche",
      uscita: "Tutte le pagine",
    });
  });

  it("seguono il profilo cambiato", () => {
    const base = defaultProfile();
    const changed = {
      ...base,
      tema: "rivista",
      colori: { testo: "#000000", titoli: "#111111", "diagramma-fondo": "#ffffff" },
      testo: { sillabazione: true, colonne: 2, carattere_testo: "Literata", corpo: 11 },
      pagina: { ...base.pagina, formato: "A5", orizzontale: true },
      testata: { ...base.testata, posti: {} },
      frontespizio: { ...base.frontespizio, frontespizio: true, indice: true },
      interruzioni: { ...base.interruzioni, ogni_titolo_2: true },
      uscita: { ...base.uscita, pagine: "1-3", pdfa: true },
    };
    const said = summaries(changed);
    expect(said.tema).toBe("Rivista · 2 colori tuoi");
    expect(said.colori).toBe("2 tuoi");
    expect(said.caratteri).toBe("Literata · 11 pt");
    expect(said.pagina).toBe("A5 orizzontale · 2 colonne");
    expect(said.testata).toBe("Vuoti");
    expect(said.fronte).toBe("Frontespizio e indice");
    expect(said.interruzioni).toBe("A ogni Titolo 2");
    expect(said.uscita).toBe("Pagine 1-3 · PDF/A");
    expect(summaries({ ...base, inchiostro: { bianco_e_nero: true, risparmio: false } }).colori).toBe("Bianco e nero");
  });

  it("un tema che questa versione non conosce si mostra come Fub", () => {
    expect(summaries({ ...defaultProfile(), tema: "futuro" }).tema).toBe("Fub");
  });
});
