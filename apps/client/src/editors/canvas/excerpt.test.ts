// @vitest-environment happy-dom
// La scheda-estratto (T75): quali sezioni mostra una scheda, come si leggono
// nella testata, dove porta ↗, e la testata messa e tolta nella riga del
// titolo senza toccare il DOM quando niente cambia.
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { excerptPartsLabel, excerptSections, excerptSourcePath, noteExcerptOf, noteSectionsText, sectionHeading, sectionLabel, syncExcerptHead } from "./excerpt";
import type { CanvasNode } from "./model";
import type { PartsHeading } from "./parts-picker";

function card(extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id: "e", type: "file", x: 0, y: 0, width: 280, height: 220, file: "Fisica/Relazione.md", ...extra };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("le sezioni di un estratto", () => {
  it("il titolo che una chiave cerca è il più interno; un blocco o niente non sono sezioni", () => {
    expect(sectionHeading("Varianza")).toBe("Varianza");
    expect(sectionHeading("#Capitolo#Varianza")).toBe("Varianza");
    expect(sectionHeading(" 1.2 Media ")).toBe("1.2 Media");
    expect(sectionHeading("^blocco")).toBeNull();
    expect(sectionHeading("#")).toBeNull();
    expect(sectionLabel("Capitolo#Varianza")).toBe("§ Varianza");
  });

  it("`fub:parts` dice le sezioni; sennò il `subpath` di un titolo; niente per la nota intera o un blocco", () => {
    expect(excerptSections({ kind: "sections", sections: ["Misure", "Calcoli"], extra: {} }, "#Misure")).toEqual(["Misure", "Calcoli"]);
    expect(excerptSections(null, "#Capitolo#Misure")).toEqual(["Capitolo#Misure"]);
    expect(excerptSections(null, "#^abc")).toEqual([]);
    expect(excerptSections(null, null)).toEqual([]);
    expect(excerptSections({ kind: "pages", pages: [3], layout: null, extra: {} }, null)).toEqual([]);
  });

  it("una scheda di nota con sezioni è un estratto; la nota intera, un PDF, un testo no", () => {
    expect(noteExcerptOf(card({ subpath: "#Misure", "fub:parts": { kind: "sections", sections: ["Misure", "Calcoli"] } })))
      .toEqual({ kind: "sections", sections: ["Misure", "Calcoli"] });
    expect(noteExcerptOf(card({ subpath: "#Misure" }))).toEqual({ kind: "sections", sections: ["Misure"] });
    // Un `fub:parts` che il `subpath` smentisce si conserva e non si mostra: vale il `subpath`.
    expect(noteExcerptOf(card({ subpath: "#Scopo", "fub:parts": { kind: "sections", sections: ["Misure", "Calcoli"] } })))
      .toEqual({ kind: "sections", sections: ["Scopo"] });
    expect(noteExcerptOf(card())).toBeNull();
    expect(noteExcerptOf(card({ subpath: "#^abc" }))).toBeNull();
    expect(noteExcerptOf(card({ file: "Dispense.pdf", subpath: "#page=3" }))).toBeNull();
    expect(noteExcerptOf({ id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "#Misure" })).toBeNull();
  });

  it("le parti si leggono «§ Varianza · § Media», e ↗ porta alla prima sezione", () => {
    const excerpt = { kind: "sections", sections: ["Varianza", "Capitolo#Media"] } as const;
    expect(excerptPartsLabel(excerpt)).toBe("§ Varianza · § Media");
    expect(excerptSourcePath("Statistica/Varianza.md", excerpt)).toBe("/Statistica/Varianza.md#Varianza");
    expect(excerptSourcePath("/Statistica/Varianza.md", { kind: "sections", sections: ["Capitolo#Media"] })).toBe("/Statistica/Varianza.md#Capitolo#Media");
  });
});

describe("la testata dell'estratto", () => {
  function handle(): { article: HTMLElement; head: HTMLElement; connect: HTMLElement } {
    const article = document.createElement("article");
    const head = document.createElement("div");
    head.className = "canvas-node-handle";
    const title = document.createElement("span");
    title.className = "canvas-node-title";
    const connect = document.createElement("button");
    connect.className = "canvas-connect";
    head.append(title, connect);
    article.append(head);
    document.body.append(article);
    return { article, head, connect };
  }

  it("mette le parti e ↗ fra il nome e →, coi loro nomi, e le toglie quando la scheda torna intera", () => {
    const { article, head, connect } = handle();
    const excerpt = { kind: "sections", sections: ["Misure", "Calcoli"] } as const;
    syncExcerptHead(article, head, connect, "Fisica/Relazione - il pendolo.md", excerpt);
    expect([...head.children].map((one) => one.className)).toEqual(["canvas-node-title", "canvas-excerpt-parts", "canvas-excerpt-open", "canvas-connect"]);
    expect(article.dataset.cardExcerpt).toBe("sections");
    const parts = head.querySelector(".canvas-excerpt-parts")!;
    expect(parts.textContent).toBe("§ Misure · § Calcoli");
    expect(parts.getAttribute("aria-label")).toBe(t("canvas.excerpt.parts", { parts: "§ Misure · § Calcoli" }));
    const open = head.querySelector<HTMLButtonElement>(".canvas-excerpt-open")!;
    expect(open.type).toBe("button");
    expect(open.textContent).toBe("↗");
    expect(open.hasAttribute("data-excerpt-open")).toBe(true);
    expect(open.getAttribute("aria-label")).toBe(t("canvas.excerpt.open", { name: "Relazione - il pendolo" }));

    // Di nuovo uguale: gli stessi elementi, niente spostato.
    syncExcerptHead(article, head, connect, "Fisica/Relazione - il pendolo.md", excerpt);
    expect(head.querySelector(".canvas-excerpt-parts")).toBe(parts);
    expect(head.querySelector(".canvas-excerpt-open")).toBe(open);
    expect(head.children).toHaveLength(4);

    // Una sezione in meno: le parti si aggiornano sul posto.
    syncExcerptHead(article, head, connect, "Fisica/Relazione - il pendolo.md", { kind: "sections", sections: ["Misure"] });
    expect(parts.textContent).toBe("§ Misure");

    syncExcerptHead(article, head, connect, "Fisica/Relazione - il pendolo.md", null);
    expect([...head.children].map((one) => one.className)).toEqual(["canvas-node-title", "canvas-connect"]);
    expect(article.hasAttribute("data-card-excerpt")).toBe(false);
  });
});

describe("il testo delle sezioni di una nota (T99)", () => {
  /// I titoli finti come li dà il sommario del provider: il livello, il testo
  /// e il byte (UTF-8) dove comincia la riga, cercato qui nel testo.
  function outline(text: string, titles: readonly (readonly [level: number, title: string, line: string])[]): PartsHeading[] {
    const bytes = new TextEncoder();
    return titles.map(([level, title, line]) => {
      const at = text.indexOf(line);
      if (at < 0) throw new Error(`nessuna riga ${line}`);
      return { level, text: title, start: bytes.encode(text.slice(0, at)).length };
    });
  }

  // Lettere non ASCII prima delle sezioni: il byte non è l'unità UTF-16.
  const note = [
    "# Statistica è così",
    "perché — città",
    "",
    "## Varianza",
    "La varianza misura.",
    "### Stimatore",
    "con n − 1",
    "",
    "Media",
    "-----",
    "La media.",
    "",
    "# Esercizi",
    "## Varianza",
    "esercizio",
    "",
  ].join("\n");
  const headings = outline(note, [
    [1, "Statistica è così", "# Statistica"],
    [2, "Varianza", "## Varianza\nLa"],
    [3, "Stimatore", "### Stimatore"],
    // Un titolo col trattino sotto (setext): lo sa il provider, non una scansione dei `#`.
    [2, "Media", "Media\n---"],
    [1, "Esercizi", "# Esercizi"],
    [2, "Varianza", "## Varianza\nesercizio"],
  ]);

  it("una sezione va dal suo titolo al titolo dopo di livello uguale o più alto, coi sottotitoli, tagliata in byte", () => {
    expect(noteSectionsText(note, headings, ["Statistica è così#Varianza"])).toEqual({
      text: "## Varianza\nLa varianza misura.\n### Stimatore\ncon n − 1",
      missing: [],
    });
    expect(noteSectionsText(note, headings, ["Media"])).toEqual({ text: "Media\n-----\nLa media.", missing: [] });
    expect(noteSectionsText(note, headings, ["Esercizi"])).toEqual({ text: "# Esercizi\n## Varianza\nesercizio", missing: [] });
  });

  it("le chiavi con la regola del selettore: due «Varianza» vogliono il capitolo; più sezioni nell'ordine dato; le sparite non si copiano e si dicono", () => {
    // `Varianza` da sola non è una chiave del selettore (il testo è doppio), e il titolo non è unico.
    expect(noteSectionsText(note, headings, ["Varianza"])).toEqual({ text: "", missing: ["Varianza"] });
    expect(noteSectionsText(note, headings, ["Media", "Sparita", "Esercizi#Varianza"])).toEqual({
      text: "Media\n-----\nLa media.\n\n## Varianza\nesercizio",
      missing: ["Sparita"],
    });
    // Un titolo unico si trova anche col capitolo sbagliato, come in «Fonti».
    expect(noteSectionsText(note, headings, ["Altro#Stimatore"])?.text).toBe("### Stimatore\ncon n − 1");
    expect(noteSectionsText(note, headings, ["^blocco"])).toEqual({ text: "", missing: ["^blocco"] });
  });

  it("senza il byte dei titoli, o con un sommario che non combacia col testo, null: chi copia prende la nota intera", () => {
    expect(noteSectionsText(note, headings.map(({ level, text }) => ({ level, text })), ["Media"])).toBeNull();
    // Il testo è cambiato dopo il sommario: il byte non cade più sul titolo.
    expect(noteSectionsText(`riga nuova\n${note}`, headings, ["Media"])).toBeNull();
    expect(noteSectionsText(note.slice(0, 20), headings, ["Esercizi"])).toBeNull();
  });
});
