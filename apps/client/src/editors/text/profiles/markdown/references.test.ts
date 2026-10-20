import { describe, expect, it } from "vitest";
import { markdownReference } from "./references";

const attachment = (link: string) => markdownReference({ kind: "attachment", link });

describe("il Markdown di un rimando", () => {
  it("incorpora ciò che la lettura sa mostrare e collega il resto col suo nome", () => {
    expect(attachment("allegati/foto.png")).toBe("![](allegati/foto.png)");
    expect(attachment("allegati/voce.mp3")).toBe("![](allegati/voce.mp3)");
    expect(attachment("allegati/relazione.pdf")).toBe("![](allegati/relazione.pdf)");
    expect(attachment("allegati/dati%20grezzi.zip")).toBe("[dati grezzi.zip](allegati/dati%20grezzi.zip)");
    expect(attachment("allegati/[bozza].docx")).toBe("[\\[bozza\\].docx](allegati/[bozza].docx)");
  });

  it("scrive una nota come wikilink col nome che la risolve", () => {
    expect(markdownReference({ kind: "note", name: "Progetti/Alpha" })).toBe("[[Progetti/Alpha]]");
  });

  it("scrive una nota come link Markdown col titolo quando il vault vuole i percorsi", () => {
    expect(markdownReference({ kind: "note", name: "Alpha [v2]", link: "../Progetti/Alpha%20%5Bv2%5D.md" }))
      .toBe("[Alpha \\[v2\\]](../Progetti/Alpha%20%5Bv2%5D.md)");
  });

  it("scrive una pagina web come link col titolo, e chiude fra <> un indirizzo con spazi o parentesi", () => {
    expect(markdownReference({ kind: "web", title: "Sito [beta]", url: "https://example.org/a" })).toBe("[Sito \\[beta\\]](https://example.org/a)");
    expect(markdownReference({ kind: "web", title: "W", url: "https://it.wikipedia.org/wiki/Fub_(app)" })).toBe("[W](<https://it.wikipedia.org/wiki/Fub_(app)>)");
  });
});
