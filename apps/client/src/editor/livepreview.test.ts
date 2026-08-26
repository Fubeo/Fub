import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { activeLinesOf, computeDecorations, type LiveDeco, type LiveDecoKind } from "./livepreview";

// La vivi preview si testa qui, headless: la funzione pura riceve un
// EditorState (che porta con sé l'albero Lezer) e le righe attive, e
// restituisce la lista degli intervalli. Nessun EditorView, nessun DOM —
// il guscio ViewPlugin non ha logica da verificare.
//
// `base: markdownLanguage` (GFM) e non il default commonmark: barrato e
// task list esistono solo lì, ed è la stessa base che l'editor deve montare.

function state(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({
    doc,
    selection: selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
}

/// Decorazioni con nessuna riga attiva (il caso "cursore altrove").
function decorate(doc: string, active: number[] = []): LiveDeco[] {
  return computeDecorations(state(doc), new Set(active));
}

function ofKind(ds: LiveDeco[], kind: LiveDecoKind): LiveDeco[] {
  return ds.filter((d) => d.kind === kind);
}

describe("activeLinesOf", () => {
  it("una selezione multi-riga tocca tutte le righe che attraversa", () => {
    const s = state("a\nb\nc", { anchor: 0, head: 4 });
    expect([...activeLinesOf(s)].sort()).toEqual([1, 2]);
  });
});

describe("heading ATX", () => {
  it("fuori dalla riga attiva nasconde `# ` e marca il testo col livello", () => {
    const ds = decorate("# Titolo\ntesto");
    expect(ofKind(ds, "hide")).toContainEqual({ from: 0, to: 2, kind: "hide" });
    expect(ofKind(ds, "h1")).toContainEqual({ from: 2, to: 8, kind: "h1" });
  });

  it("sulla riga attiva il marcatore resta, lo stile pure", () => {
    const ds = decorate("# Titolo\ntesto", [1]);
    expect(ofKind(ds, "hide")).toEqual([]);
    expect(ofKind(ds, "h1")).toContainEqual({ from: 2, to: 8, kind: "h1" });
  });

  it("il livello segue il numero di `#`", () => {
    const ds = decorate("### Tre");
    expect(ofKind(ds, "hide")).toContainEqual({ from: 0, to: 4, kind: "hide" });
    expect(ofKind(ds, "h3")).toContainEqual({ from: 4, to: 7, kind: "h3" });
  });
});

describe("enfasi", () => {
  it("grassetto e corsivo annidati: marcatori nascosti, contenuti marcati", () => {
    // **gras *corsivo* so**
    //  0-2   7-8    15-16  19-21
    const ds = decorate("**gras *corsivo* so**");
    const hides = ofKind(ds, "hide").map((d) => [d.from, d.to]);
    expect(hides).toContainEqual([0, 2]);
    expect(hides).toContainEqual([7, 8]);
    expect(hides).toContainEqual([15, 16]);
    expect(hides).toContainEqual([19, 21]);
    expect(ofKind(ds, "strong")).toContainEqual({ from: 2, to: 19, kind: "strong" });
    expect(ofKind(ds, "em")).toContainEqual({ from: 8, to: 15, kind: "em" });
  });

  it("sulla riga attiva i marcatori restano visibili", () => {
    const ds = decorate("**gras *corsivo* so**", [1]);
    expect(ofKind(ds, "hide")).toEqual([]);
    expect(ofKind(ds, "strong")).toHaveLength(1);
  });

  it("il barrato `~~` è un nodo GFM come gli altri", () => {
    const doc = "un ~~vecchio~~ testo";
    const ds = decorate(doc);
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([
      [3, 5],
      [12, 14],
    ]);
    expect(ofKind(ds, "strike")).toContainEqual({ from: 5, to: 12, kind: "strike" });
  });
});

describe("codice", () => {
  it("inline: backtick nascosti fuori riga attiva, contenuto marcato", () => {
    const doc = "vedi `codice` qui";
    const ds = decorate(doc);
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([
      [5, 6],
      [12, 13],
    ]);
    expect(ofKind(ds, "code")).toContainEqual({ from: 6, to: 12, kind: "code" });
  });

  it("blocchi: sfondo di riga su ogni riga, fence mai nascoste", () => {
    const ds = decorate("```\ncodice\n```");
    expect(ofKind(ds, "codeblock-line")).toHaveLength(3);
    expect(ofKind(ds, "hide")).toEqual([]);
  });
});

describe("citazioni e righello", () => {
  it("la citazione marca il `>` e la riga", () => {
    const ds = decorate("> citazione");
    expect(ofKind(ds, "quote-line")).toEqual([{ from: 0, to: 0, kind: "quote-line" }]);
    expect(ofKind(ds, "quote-mark")).toContainEqual({ from: 0, to: 1, kind: "quote-mark" });
  });

  it("`---` diventa un righello fuori dalla riga attiva, resta sorgente sopra", () => {
    const doc = "testo\n\n---\n\naltro";
    expect(ofKind(decorate(doc), "hr")).toEqual([{ from: 7, to: 10, kind: "hr" }]);
    expect(ofKind(decorate(doc, [3]), "hr")).toEqual([]);
  });
});

describe("link markdown", () => {
  it("fuori dalla riga attiva resta solo il testo, marcato come link", () => {
    const doc = "vedi [testo](https://x.y) qui";
    const ds = decorate(doc);
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([
      [5, 6],
      [11, 25],
    ]);
    expect(ofKind(ds, "link")).toContainEqual({
      from: 6,
      to: 11,
      kind: "link",
      data: "https://x.y",
    });
  });

  it("sulla riga attiva niente hide, il mark resta", () => {
    const ds = decorate("vedi [testo](https://x.y) qui", [1]);
    expect(ofKind(ds, "hide")).toEqual([]);
    expect(ofKind(ds, "link")).toHaveLength(1);
  });
});

describe("wikilink", () => {
  it("con alias e multibyte: gli offset sono in code unit e non slittano", () => {
    const doc = "prima [[Città però|così 🎯]] fine";
    const ds = decorate(doc);
    const start = doc.indexOf("[[");
    const alias = doc.indexOf("così");
    // un solo hide copre `[[Città però|`
    expect(ofKind(ds, "hide")).toContainEqual({ from: start, to: alias, kind: "hide" });
    // il testo mostrato è l'alias, il bersaglio del click la pagina nuda
    const wl = ofKind(ds, "wikilink");
    expect(wl).toEqual([
      { from: alias, to: alias + "così 🎯".length, kind: "wikilink", data: "Città però" },
    ]);
    expect(doc.slice(wl[0].from, wl[0].to)).toBe("così 🎯");
    // e le `]]` finali spariscono
    expect(ofKind(ds, "hide")).toContainEqual({
      from: doc.indexOf("]]"),
      to: doc.indexOf("]]") + 2,
      kind: "hide",
    });
  });

  // Il payload porta il bersaglio **intero**, `#heading` compreso: portava la
  // sola pagina, quindi `Mod-click` su `[[Nota#Sezione]]` apriva la nota in
  // cima mentre lo stesso legame in Lettura arrivava alla sezione (§4.4).
  it("senza alias il bersaglio porta anche il punto che il link nomina", () => {
    const ds = decorate("vedi [[Nota#Sezione]] qui");
    expect(ofKind(ds, "wikilink")).toEqual([
      { from: 7, to: 19, kind: "wikilink", data: "Nota#Sezione" },
    ]);
  });

  it("l'embed `![[..]]` nasconde anche il `!`", () => {
    const ds = decorate("![[Foto]]");
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([
      [0, 3],
      [7, 9],
    ]);
    expect(ofKind(ds, "wikilink")).toEqual([{ from: 3, to: 7, kind: "wikilink", data: "Foto" }]);
  });

  it("sulla riga attiva la sorgente resta ma il link è ancora cliccabile", () => {
    const ds = decorate("vedi [[Nota|N]] qui", [1]);
    expect(ofKind(ds, "hide")).toEqual([]);
    expect(ofKind(ds, "wikilink")).toEqual([
      { from: 7, to: 13, kind: "wikilink", data: "Nota" },
    ]);
  });
});

describe("evidenziazione", () => {
  it("`==testo==` nasconde i marcatori fuori riga attiva e marca il contenuto", () => {
    const ds = decorate("testo ==giallo== qui");
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([
      [6, 8],
      [14, 16],
    ]);
    expect(ofKind(ds, "highlight")).toEqual([{ from: 8, to: 14, kind: "highlight" }]);
  });

  it("sulla riga attiva il mark resta, i marcatori pure", () => {
    const ds = decorate("testo ==giallo== qui", [1]);
    expect(ofKind(ds, "hide")).toEqual([]);
    expect(ofKind(ds, "highlight")).toHaveLength(1);
  });
});

describe("tag", () => {
  it("un tag gerarchico è marcato col nome senza `#`", () => {
    const doc = "vedi #area/lavoro qui";
    expect(ofKind(decorate(doc), "tag")).toEqual([
      { from: 5, to: 17, kind: "tag", data: "area/lavoro" },
    ]);
    // anche sulla riga attiva: i tag non si nascondono mai
    expect(ofKind(decorate(doc, [1]), "tag")).toHaveLength(1);
  });

  it("il `#` di un heading non è un tag", () => {
    expect(ofKind(decorate("# Titolo"), "tag")).toEqual([]);
    expect(ofKind(decorate("## Sotto"), "tag")).toEqual([]);
  });

  it("un `#` in mezzo a una parola non è un tag", () => {
    expect(ofKind(decorate("peso#kg"), "tag")).toEqual([]);
  });

  it("un tag di sole cifre non è un tag", () => {
    expect(ofKind(decorate("anno #2024"), "tag")).toEqual([]);
  });
});

describe("checkbox", () => {
  const doc = "- [ ] cosa\n- [x] fatta";

  it("fuori dalla riga attiva `[ ]`/`[x]` diventano widget, la voce fatta è barrata", () => {
    const ds = decorate(doc);
    expect(ofKind(ds, "checkbox")).toEqual([
      { from: 2, to: 5, kind: "checkbox", data: " " },
      { from: 13, to: 16, kind: "checkbox", data: "x" },
    ]);
    expect(ofKind(ds, "done")).toEqual([{ from: 17, to: 22, kind: "done" }]);
  });

  it("sulla riga attiva il widget sparisce, solo lì", () => {
    const ds = decorate(doc, [1]);
    expect(ofKind(ds, "checkbox")).toEqual([
      { from: 13, to: 16, kind: "checkbox", data: "x" },
    ]);
  });
});

describe("il codice è terreno vietato per la sintassi Obsidian", () => {
  it("niente wikilink/tag dentro il codice inline", () => {
    const ds = decorate("vedi `[[x]] #tag` qui");
    expect(ofKind(ds, "wikilink")).toEqual([]);
    expect(ofKind(ds, "tag")).toEqual([]);
    expect(ofKind(ds, "code")).toHaveLength(1);
  });

  it("niente wikilink/tag/highlight dentro una fence", () => {
    const ds = decorate("```\n[[x]] #tag ==y==\n```");
    expect(ofKind(ds, "wikilink")).toEqual([]);
    expect(ofKind(ds, "tag")).toEqual([]);
    expect(ofKind(ds, "highlight")).toEqual([]);
    expect(ofKind(ds, "codeblock-line")).toHaveLength(3);
  });
});

describe("invarianti dell'output", () => {
  it("ordinato per from, e i replace non si sovrappongono tra loro", () => {
    const doc = [
      "# Però 🎯 titolo",
      "testo **grasso** con [[Città|C]] e ==giallo== e #tag",
      "- [x] còsa fatta",
      "",
      "---",
    ].join("\n");
    const ds = decorate(doc);
    for (let i = 1; i < ds.length; i++) {
      expect(ds[i].from).toBeGreaterThanOrEqual(ds[i - 1].from);
    }
    const replaces = ds
      .filter((d) => d.kind === "hide" || d.kind === "hr" || d.kind === "checkbox")
      .sort((a, b) => a.from - b.from);
    for (let i = 1; i < replaces.length; i++) {
      expect(replaces[i].from).toBeGreaterThanOrEqual(replaces[i - 1].to);
    }
  });
});
