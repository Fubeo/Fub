import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { propertyBlock } from "../properties";
import { FEATURED_LIMIT, featuredProperties } from "./featured";

// Quali proprietà stanno in evidenza nella testata (T6, E3).

const block = (yaml: string) => propertyBlock(EditorState.create({ doc: `---\n${yaml}\n---\nTesto` }))!;
const keys = (yaml: string) => {
  const split = featuredProperties(block(yaml).entries);
  return { featured: split.featured.map((entry) => entry.key), rest: split.rest.map((entry) => entry.key) };
};

describe("le proprietà in evidenza", () => {
  it("senza tipo, le prime quattro del frontmatter, nell'ordine del file", () => {
    expect(keys("tipo: Progetto\nstato: In corso\nscadenza: 2027-03-20\npersone: [Anna, Luca]\nluogo: Biblioteca\nbudget: 12000"))
      .toEqual({ featured: ["tipo", "stato", "scadenza", "persone"], rest: ["luogo", "budget"] });
  });

  it("icona, copertina, posizione e classi le disegna la testata: non sono righe", () => {
    expect(keys("icon: 🌱\ncover: img/mare.png\ncover-y: 30\ncssclasses: [wide]\nstato: Fatto"))
      .toEqual({ featured: ["stato"], rest: [] });
  });

  it("le etichette stanno nella riga dei dati: vengono dopo quelle in evidenza", () => {
    expect(keys("tags: [mostra]\nstato: In corso\naliases: [Mostra]"))
      .toEqual({ featured: ["stato", "aliases"], rest: ["tags"] });
  });

  it("trenta proprietà: quattro in evidenza, ventisei dietro «Altre»", () => {
    const yaml = Array.from({ length: 30 }, (_, index) => `voce${index + 1}: ${index + 1}`).join("\n");
    const split = keys(yaml);
    expect(split.featured).toHaveLength(FEATURED_LIMIT);
    expect(split.rest).toHaveLength(26);
    expect(split.rest[0]).toBe("voce5");
  });

  it("un nome lunghissimo resta intero: lo taglia soltanto la pelle", () => {
    const name = "una-proprietà-dal-nome-lunghissimo-che-non-sta-in-nessuna-colonna-della-testata";
    expect(keys(`${name}: sì`).featured).toEqual([name]);
  });
});

describe("il frontmatter che non si legge", () => {
  it("una riga di primo livello che non è una chiave lo rende illeggibile", () => {
    expect(block("titolo senza due punti\nstato: aperto").unreadable).toBe(true);
  });

  it("commenti, righe vuote, elenchi e testi su più righe si leggono", () => {
    expect(block("# un commento\n\ntags:\n  - a\n  - b\ndescrizione: |\n  due\n  righe\nstato: aperto").unreadable).toBe(false);
  });
});
