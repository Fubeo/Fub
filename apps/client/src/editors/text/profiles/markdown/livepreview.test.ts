import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import {
  activeLinesOf,
  computeDecorations,
  footnoteLabelsField,
  pillLabel,
  revealOf,
  firstFootnoteReference,
  type LiveDeco,
  type LiveDecoKind,
} from "./livepreview";
import type { RevealPolicy } from "../../live-reveal";

// La vivi preview si testa qui, headless: la funzione pura riceve un
// EditorState (che porta con sé l'albero Lezer) e le righe attive, e
// restituisce la lista degli intervalli. Nessun EditorView, nessun DOM —
// il guscio ViewPlugin non ha logica da verificare.
//
// `base: markdownGrammar` (GFM con le definizioni di nota) e non il default
// commonmark: barrato e task list esistono solo lì, ed è la stessa base che
// l'editor monta.

function state(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({
    doc,
    selection: selection,
    extensions: [markdown({ base: markdownGrammar })],
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
describe("heading Setext", () => {
  it("nasconde solo il marcatore e marca il titolo Unicode col livello", () => {
    const doc = "Titolo 🎯\n======";
    const ds = decorate(doc);
    expect(ofKind(ds, "hide")).toEqual([{ from: 10, to: 16, kind: "hide" }]);
    expect(ofKind(ds, "h1")).toEqual([{ from: 0, to: 9, kind: "h1" }]);
  });

  it("sulla riga del marcatore lascia visibile la sorgente", () => {
    const doc = "Sotto\n------";
    expect(ofKind(decorate(doc, [2]), "hide")).toEqual([]);
    expect(ofKind(decorate(doc, [2]), "h2")).toEqual([{ from: 0, to: 5, kind: "h2" }]);
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

describe("apici, pedici, elenchi e note", () => {
  it("`^apice^` e `~pedice~` come in Lettura: segni nascosti, contenuto marcato", () => {
    const doc = "x^2^ e H~2~O";
    const ds = decorate(doc);
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([[1, 2], [3, 4], [8, 9], [10, 11]]);
    expect(ofKind(ds, "sup")).toEqual([{ from: 2, to: 3, kind: "sup" }]);
    expect(ofKind(ds, "sub")).toEqual([{ from: 9, to: 10, kind: "sub" }]);
    const active = decorate(doc, [1]);
    expect(ofKind(active, "hide")).toEqual([]);
    expect(ofKind(active, "sup")).toHaveLength(1);
  });

  it("il segno di una voce puntata diventa un pallino fuori dalla riga attiva", () => {
    const doc = "- uno\n* due\n1. tre\n- [ ] cosa";
    expect(ofKind(decorate(doc), "list-bullet")).toEqual([
      { from: 0, to: 1, kind: "list-bullet" },
      { from: 6, to: 7, kind: "list-bullet" },
      { from: 19, to: 20, kind: "list-bullet", data: "task" },
    ]);
    expect(ofKind(decorate(doc, [1, 4]), "list-bullet")).toEqual([
      { from: 6, to: 7, kind: "list-bullet" },
    ]);
  });

  it("il rimando a una nota definita diventa il suo apice; senza definizione resta testo", () => {
    const doc = "Vedi[^uno] e[^due].\n\n[^uno]: la nota";
    const ds = decorate(doc);
    expect(ofKind(ds, "sup")).toEqual([{ from: 6, to: 9, kind: "sup" }]);
    // [21, 23] è il `[^` della definizione, che diventa etichetta e ↩ (D5).
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([[4, 6], [9, 10], [21, 23]]);
    expect(ofKind(ds, "link")).toEqual([]);
    expect(ofKind(decorate(doc, [1]), "sup")).toEqual([]);
  });

  it("le etichette delle note si rileggono soltanto quando cambia una riga con `[^`", () => {
    const doc = "Vedi[^uno].\n\nProsa.\n\n[^uno]: la nota";
    let current = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), footnoteLabelsField] });
    const sups = () => ofKind(computeDecorations(current, new Set()), "sup").length;
    expect(sups()).toBe(1);
    const first = current.field(footnoteLabelsField).labels;
    expect(first).toEqual(new Set(["UNO"]));
    // Una battuta nella prosa: le stesse etichette, senza scorrere il file.
    current = current.update({ changes: { from: doc.indexOf("Prosa") + 5, insert: "x" } }).state;
    expect(sups()).toBe(1);
    expect(current.field(footnoteLabelsField).labels).toBe(first);
    // La definizione cambia etichetta: si rilegge, e il rimando resta testo.
    current = current.update({ changes: { from: current.doc.toString().indexOf("uno]:") + 3, insert: "x" } }).state;
    expect(sups()).toBe(0);
    expect(current.field(footnoteLabelsField).labels).toEqual(new Set(["UNOX"]));
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
  it("sulla riga attiva la citazione marca il `>` e la riga", () => {
    const ds = decorate("> citazione", [1]);
    expect(ofKind(ds, "quote-line")).toEqual([{ from: 0, to: 0, kind: "quote-line" }]);
    expect(ofKind(ds, "quote-mark")).toContainEqual({ from: 0, to: 1, kind: "quote-mark" });
    expect(ofKind(ds, "hide")).toEqual([]);
  });

  it("fuori dalla riga attiva il `>` sparisce con il suo spazio, il filo resta", () => {
    const ds = decorate("> citazione\n>stretta");
    expect(ofKind(ds, "quote-line")).toHaveLength(2);
    expect(ofKind(ds, "quote-mark")).toEqual([]);
    expect(ofKind(ds, "hide").map((d) => [d.from, d.to])).toEqual([[0, 2], [12, 13]]);
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
      "[[x]](https://example.test) e [==testo==](nota.md)",
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

describe("link markdown: la destinazione segue il parser", () => {
  it("la destinazione fra `<…>` arriva senza parentesi, come la vede Lettura", () => {
    const ds = decorate("vedi [t](<nota(1).md>) qui");
    expect(ofKind(ds, "link")).toEqual([{ from: 6, to: 7, kind: "link", data: "nota(1).md" }]);
  });
});

describe("il markup letterale non è sintassi Obsidian", () => {
  it("`[[ ]]` non nomina niente e non si decora", () => {
    expect(ofKind(decorate("[[ ]]"), "wikilink")).toEqual([]);
    expect(ofKind(decorate("[[ ]]"), "hide")).toEqual([]);
    expect(ofKind(decorate("[[]]"), "wikilink")).toEqual([]);
  });

  it("dentro un commento HTML non ci sono tag né wikilink né highlight", () => {
    const ds = decorate("<!-- #tag [[x]] ==y== -->");
    expect(ofKind(ds, "tag")).toEqual([]);
    expect(ofKind(ds, "wikilink")).toEqual([]);
    expect(ofKind(ds, "highlight")).toEqual([]);
  });

  it("un `#` dentro un tag HTML non è un tag", () => {
    expect(ofKind(decorate('un <a href="#frag">t</a> qui'), "tag")).toEqual([]);
  });
});

describe("commenti, formule in riga, ID di blocco ed embed dimensionati", () => {
  it("un commento sparisce intero fuori dalla riga attiva, e su quella attiva resta attenuato", () => {
    const doc = "a %%segreto qui%% b";
    expect(decorate(doc)).toEqual([{ from: 2, to: 17, kind: "hide" }]);
    expect(decorate(doc, [1])).toEqual([{ from: 2, to: 17, kind: "highlight", data: "comment" }]);
  });

  it("un commento non contiene un wikilink o un tag: come nel provider, non c'è", () => {
    const doc = "a %%[[Nota]] #tag%% b";
    expect(ofKind(decorate(doc), "hide").map((d) => [d.from, d.to])).toEqual([[4, 6], [10, 12]]);
    expect(ofKind(decorate(doc), "wikilink").map((d) => [d.from, d.to])).toEqual([[6, 10]]);
    expect(ofKind(decorate(doc), "tag").map((d) => [d.from, d.to])).toEqual([[13, 17]]);
    expect(ofKind(decorate(doc, [1]), "highlight")).toEqual([]);
  });

  it("una formula in riga diventa widget fuori dalla riga attiva, non dentro il codice", () => {
    const math = ofKind(decorate("x $e^{i\\pi}$ e `$no$`"), "math");
    expect(math).toEqual([{ from: 2, to: 12, kind: "math", data: "e^{i\\pi}" }]);
    expect(ofKind(decorate("x $a$", [1]), "math")).toEqual([]);
  });

  it("le formule si leggono per paragrafo, e diventano widget quelle su una riga", () => {
    // `$a…b$` va a capo e resta sorgente; `$5` non si chiude sul `$` dopo.
    const math = ofKind(decorate("$a\nb$ e $c$, costa $5 e\n$d$"), "math");
    expect(math.map((d) => [d.from, d.to, d.data])).toEqual([[8, 11, "c"], [24, 27, "d"]]);
    expect(ofKind(decorate("dopo $$x$$ qui"), "math").map((d) => [d.from, d.to, d.data])).toEqual([[5, 10, "x"]]);
  });

  it("la formula che è tutto un paragrafo del documento la mostra il blocco, quella citata no", () => {
    expect(ofKind(decorate("$$x$$"), "math")).toEqual([]);
    expect(ofKind(decorate("$$x$$ ^abc"), "math")).toEqual([]);
    expect(ofKind(decorate("> $$x$$"), "math").map((d) => [d.from, d.to, d.data])).toEqual([[2, 7, "x"]]);
    expect(ofKind(decorate("# $$x$$"), "math").map((d) => [d.from, d.to, d.data])).toEqual([[2, 7, "x"]]);
  });

  it("dentro una formula non c'è un tag, su ogni riga e in ogni forma; dentro una formula persa sì", () => {
    // L'ultima formula si giudica dove apre: il wikilink della riga dopo non la
    // perde, e il suo `#s` resta fuori dai tag.
    const doc = "$a #b$ e #c\n\nla $u\n#v$ fine\n\n$$x #y$$\n\n[[a$]] b #t$\n\nla $w\n[[p]] #s$";
    for (const active of [[], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]) {
      const ds = decorate(doc, active);
      expect(ofKind(ds, "tag").map((d) => [d.data, d.from, d.to]), String(active)).toEqual([["c", 9, 11], ["t", 48, 50]]);
      expect(ofKind(ds, "math").map((d) => [d.from, d.to]), String(active)).toEqual(active.length ? [] : [[0, 6]]);
    }
  });

  it("ciò che apre dentro una formula non è sintassi, su ogni sua riga, e la formula resta", () => {
    const inner = ["[[b]]", "![[b]]", "==b==", "%%b%%", "<b>", "https://e.it", "<https://e.it>", "*b*", "[t](u)"];
    for (const piece of inner) {
      const doc = `x $a ${piece} c$ y`;
      expect(decorate(doc).map((d) => [d.kind, d.from, d.to]), piece).toEqual([["math", 2, doc.length - 2]]);
      expect(decorate(doc, [1]), piece).toEqual([]);
    }
    // Su una formula di più righe non c'è un widget, e la riga dopo è ancora
    // la formula.
    expect(decorate("la $w\n[[p]] ==q== %%r%% #s$")).toEqual([]);
  });

  it("un nodo che attraversa una formula non si decora, e i suoi marcatori restano", () => {
    expect(decorate("*a $b* c$ y")).toEqual([{ from: 3, to: 9, kind: "math", data: "b* c" }]);
    expect(decorate("[a $b](u) c$ y")).toEqual([{ from: 3, to: 12, kind: "math", data: "b](u) c" }]);
    expect(decorate("https://e.it/$x c$ y")).toEqual([{ from: 13, to: 18, kind: "math", data: "x c" }]);
  });

  it("un wikilink aperto prima vince sulla formula; un evidenziato o un commento non la attraversano", () => {
    // Come nel provider: evidenziato e commento stanno in un testo del
    // modello, e la formula non lo è.
    expect(decorate("==a $b== c$ y")).toEqual([{ from: 4, to: 11, kind: "math", data: "b== c" }]);
    expect(decorate("%%a $b$ c%% y")).toEqual([{ from: 4, to: 7, kind: "math", data: "b" }]);
    expect(decorate("==a $b$ c== y")).toEqual([{ from: 4, to: 7, kind: "math", data: "b" }]);
    expect(decorate("$a ==b$ c $d== e$ y").map((d) => [d.kind, d.data])).toEqual([["math", "a ==b"], ["math", "d== e"]]);
    // Un wikilink e un'immagine non leggono la formula che racchiudono.
    expect(ofKind(decorate("[[a $b$ c]] y"), "math")).toEqual([]);
    expect(ofKind(decorate("![a $b$](x.png) y"), "math")).toEqual([]);
    // Il dollaro che un wikilink ha preso non apre: la formula dopo c'è, e
    // l'enfasi non attraversa più nessuna formula.
    expect(ofKind(decorate("[[a$]] b$c$ y"), "math").map((d) => [d.from, d.to, d.data])).toEqual([[8, 11, "c"]]);
    expect(ofKind(decorate("[[a$]] *b$ c* y"), "em").map((d) => [d.from, d.to])).toEqual([[8, 12]]);
    expect(ofKind(decorate("[[a$]] ==b$ c== y"), "highlight").map((d) => [d.from, d.to])).toEqual([[9, 13]]);
    // Non vince il wikilink che apre nel codice o dentro una formula.
    expect(ofKind(decorate("`[[a` $b]] c$ y"), "math").map((d) => d.data)).toEqual(["b]] c"]);
    expect(ofKind(decorate("$a [[b$ c]] d$ y"), "math").map((d) => d.data)).toEqual(["a [[b"]);
  });

  it("evidenziato e commento non attraversano un inline del provider, come in Lettura", () => {
    // Il primo paragrafo fuori dalla riga attiva, scritto in chiaro: ciò che si
    // nasconde sparisce, `=(…)=` un evidenziato, `*…*` un'enfasi, `[…]` un
    // link, `[[…]]` un wikilink e `$…$` una formula. Sono i casi della Lettura
    // (`render.test.ts`), con l'esito del provider; qui escape, entità, rimandi
    // e note in riga restano sorgente.
    const wrap: Partial<Record<LiveDecoKind, [string, string]>> = {
      em: ["*", "*"], strong: ["**", "**"], highlight: ["=(", ")="], wikilink: ["[[", "]]"], link: ["[", "]"],
      sup: ["^(", ")^"],
    };
    const written = (source: string) => {
      const hidden = new Set<number>();
      const before = Array.from({ length: source.length + 1 }, () => "");
      for (const d of decorate(source)) {
        const marks = wrap[d.kind];
        if (d.kind === "hide" || d.kind === "math") for (let at = d.from; at < d.to; at++) hidden.add(at);
        if (d.kind === "math") before[d.from] += `$${d.data}$`;
        if (marks) {
          before[d.from] += marks[0];
          before[d.to] = marks[1] + before[d.to];
        }
      }
      let out = "";
      for (let at = 0; at <= source.length; at++) out += before[at] + (hidden.has(at) ? "" : source.charAt(at));
      return out.split("\n\n")[0];
    };
    for (const [source, expected] of [
      ["==a *b* c== z", "==a *b* c== z"],
      ["*a ==b* c== z", "*a ==b* c== z"],
      ["==a *b== c* z", "==a *b== c* z"],
      ["**a ==b c** d== z", "**a ==b c** d== z"],
      ["==a $b$ c== z", "==a $b$ c== z"],
      ["==a #b c== z", "==a #b c== z"],
      ["==a [l](u) c== z", "==a [l] c== z"],
      ["==a <b>x</b> c== z", "==a <b>x</b> c== z"],
      ["==a [^1] c== z\n\n[^1]: n", "==a ^(1)^ c== z"],
      ["==a [^no] c== z", "==a [^no] c== z"],
      ["%%a *b* c%% z", "%%a *b* c%% z"],
      ["*a %%b* c%% z", "*a %%b* c%% z"],
      ["%%a *b%% c* z", "%%a *b%% c* z"],
      ["%%a [[b]] c%% z", "%%a [[b]] c%% z"],
      ["[[a %%b]] c%% z", "[[a %%b]] c%% z"],
      ["%%a [[b%% c]] z", "%%a [[b%% c]] z"],
      ["%%a $b$ c%% z", "%%a $b$ c%% z"],
      ["%%a #b c%% z", "%%a #b c%% z"],
      ["^[a $b] c$ z", "^[a $b] c$ z"],
      ["^[a](u) z", "^[a] z"],
      ["==a ^[b== c] z", "==a ^[b== c] z"],
      ["^[a ==b] c== z", "^[a ==b] c== z"],
      ["%%a ^[b%% c] z", "%%a ^[b%% c] z"],
      ["^[a %%b] c%% z", "^[a %%b] c%% z"],
      ["==a \\* c== z", "=(a \\* c)= z"],
      ["==a https://e.it c== z", "=(a https://e.it c)= z"],
      ["*a ==b== c* z", "*a =(b)= c* z"],
      ["[==a==](u) z", "[=(a)=] z"],
      ["==a *b* c== d== z", "==a *b* c=( d)= z"],
      ["==a\nb== c== z", "==a\nb=( c)= z"],
      ["==a %%b%% c== z", "=(a %%b%% c)= z"],
      ["%%a ==b== c%% z", "%%a =(b)= c%% z"],
      ["==a %%b== c%% z", "=(a %%b)= c%% z"],
      ["[[a$]] ==b$ c== z", "[[a$]] =(b$ c)= z"],
      ["*a ==b `c` d== e* z", "*a ==b c d== e* z"],
      ["==a *b== $c* d$ z", "=(a *b)= $c* d$ z"],
      ["*a ^[b] c* z", "*a ^[b] c* z"],
      ["*a ==b ^[c] d== e* z", "*a ==b ^[c] d== e* z"],
      ["==a [[ ]] b== z", "==a [[ ]] b== z"],
      ["==a [b] c== z", "=(a [b] c)= z"],
      ["==a ^[b== $c] d$ z", "=(a ^[b)= $c] d$ z"],
      // Il testo alternativo di un'immagine non è un testo del modello.
      ["![==b==](https://e.it/x.png) z", "![==b==](https://e.it/x.png) z"],
    ] as const) {
      expect(written(source), source).toBe(expected);
    }
    // La nota in riga che regge spezza il testo, e il suo contenuto è un testo
    // a sé, dove la Lettura conserva la formattazione.
    expect(written("==a ^[b] c== z ^[d ==e== f]")).toBe("==a ^[b] c== z ^[d =(e)= f]");
  });

  it("l'ID di blocco si nasconde solo dove un blocco finisce", () => {
    const doc = "riga ^mezzo\nfine ^id\n\naltro";
    const hidden = ofKind(decorate(doc), "hide");
    expect(hidden).toContainEqual({ from: 17, to: 20, kind: "hide" });
    expect(hidden.some((d) => d.from === 5)).toBe(false);
  });

  it("un embed con dimensione mostra il bersaglio e nasconde la misura", () => {
    const ds = decorate("![[video.mp4|320]]");
    expect(ofKind(ds, "wikilink").map((d) => [d.from, d.to])).toEqual([[3, 12]]);
    expect(ofKind(ds, "hide")).toContainEqual({ from: 12, to: 18, kind: "hide" });
  });
});

describe("immagini in mezzo al testo", () => {
  it("fuori dalla riga attiva un'immagine del vault diventa il suo HTML di Lettura", () => {
    const doc = 'Il logo ![Marchio|120](../Risorse/logo.png "Il nostro") in riga';
    expect(ofKind(decorate(doc), "image")).toEqual([{
      from: 8,
      to: 55,
      kind: "image",
      data: '<img src="../Risorse/logo.png" alt="Marchio" title="Il nostro" width="120">',
    }]);
    // Il testo alternativo non è sintassi: né tag né enfasi dentro il widget.
    const tagged = decorate("vedi ![#tag *x*](a.png) qui");
    expect(ofKind(tagged, "tag")).toEqual([]);
    expect(ofKind(tagged, "hide")).toEqual([]);
  });

  it("sulla riga attiva resta sorgente", () => {
    expect(ofKind(decorate("vedi ![a](a.png) qui", [1]), "image")).toEqual([]);
  });

  it("gli URL, i riferimenti e le destinazioni fra `<…>` seguono la regola del vault", () => {
    // Un'immagine remota diventa il segnaposto della Lettura, che non la
    // carica (L04); un altro schema resta sorgente.
    expect(ofKind(decorate("x ![a](https://e.test/a.png) y"), "image").map((d) => d.data))
      .toEqual(['<img src="https://e.test/a.png" alt="a">']);
    expect(ofKind(decorate("x ![a](data:image/png;base64,AA) y"), "image")).toEqual([]);
    // Un riferimento si risolve come in Lettura (L02), e la destinazione
    // della definizione segue la stessa regola.
    expect(ofKind(decorate("x ![a][ref] y\n\n[ref]: a.png \"t\""), "image").map((d) => d.data))
      .toEqual(['<img src="a.png" alt="a" title="t">']);
    expect(ofKind(decorate("x ![porto] y\n\n[Porto]: <foto/porto.png>"), "image").map((d) => d.data))
      .toEqual(['<img src="foto/porto.png" alt="porto">']);
    expect(ofKind(decorate("x ![a][ref] y\n\n[ref]: https://e.test/a.png"), "image").map((d) => d.data))
      .toEqual(['<img src="https://e.test/a.png" alt="a">']);
    expect(ofKind(decorate("x ![a][nessuno] y"), "image")).toEqual([]);
    expect(ofKind(decorate("x ![**gatto**](g.png) y"), "image").map((d) => d.data))
      .toEqual(['<img src="g.png" alt="gatto">']);
    expect(ofKind(decorate("x ![a](<foto 1.png>) y"), "image").map((d) => d.data))
      .toEqual(['<img src="foto 1.png" alt="a">']);
  });

  it("un embed d'immagine ha l'HTML dell'embed reso, dimensione compresa", () => {
    expect(ofKind(decorate("prima ![[foto.png|200x100]] dopo"), "image")).toEqual([{
      from: 6,
      to: 27,
      kind: "image",
      data: '<span class="embed" data-embed-page="foto.png" data-embed-size="200x100">foto.png</span>',
    }]);
    // Una nota, un video, un punto dentro l'immagine: restano come prima.
    expect(ofKind(decorate("a ![[Nota]] b"), "image")).toEqual([]);
    expect(ofKind(decorate("a ![[film.mp4]] b"), "image")).toEqual([]);
    expect(ofKind(decorate("a ![[foto.png#x]] b"), "image")).toEqual([]);
    expect(ofKind(decorate("a ![[foto.png]] b", [1]), "image")).toEqual([]);
  });

  it("i replace restano disgiunti con immagini, link e marcatori sulla stessa riga", () => {
    const ds = decorate("**x** [![a](a.png)](https://e.test) e ![[b.png]] e [[c]]");
    const replaces = ds
      .filter((d) => d.kind === "hide" || d.kind === "image")
      .sort((a, b) => a.from - b.from);
    expect(ofKind(ds, "image")).toHaveLength(2);
    for (let i = 1; i < replaces.length; i++) {
      expect(replaces[i].from).toBeGreaterThanOrEqual(replaces[i - 1].to);
    }
  });
});

describe("la politica di rivelazione", () => {
  /// Le decorazioni col cursore a `at`, per la politica data.
  const at = (doc: string, cursor: number, policy: RevealPolicy) => {
    const current = state(doc, { anchor: cursor });
    return computeDecorations(current, revealOf(current, policy));
  };
  const hidden = (doc: string, cursor: number, policy: RevealPolicy, from: number, to: number) =>
    at(doc, cursor, policy).some((d) => d.kind === "hide" && d.from === from && d.to === to);

  // Ogni riga della tabella della sezione 06: un elemento in riga, il suo segno
  // d'apertura e i quattro punti del cursore (inizio, in mezzo, fine e subito
  // dopo l'elemento, una lettera più in là).
  const inline: readonly { name: string; doc: string; sign: [number, number]; element: [number, number] }[] = [
    { name: "grassetto", doc: "a **bo** z q", sign: [2, 4], element: [2, 8] },
    { name: "corsivo", doc: "a *bo* z q", sign: [2, 3], element: [2, 6] },
    { name: "barrato", doc: "a ~~bo~~ z q", sign: [2, 4], element: [2, 8] },
    { name: "apice", doc: "a ^bo^ z q", sign: [2, 3], element: [2, 6] },
    { name: "pedice", doc: "a ~bo~ z q", sign: [2, 3], element: [2, 6] },
    { name: "codice", doc: "a `bo` z q", sign: [2, 3], element: [2, 6] },
    { name: "evidenziato", doc: "a ==bo== z q", sign: [2, 4], element: [2, 8] },
  ];
  for (const { name, doc, sign, element } of inline) {
    const [start, end] = element;
    const points = [start, start + 2, end, end + 2];
    it(`${name}: «riga» rivela su tutta la riga, «elemento» dentro l'elemento, «mai» mai`, () => {
      expect(points.map((p) => hidden(doc, p, "riga", ...sign))).toEqual([false, false, false, false]);
      expect(points.map((p) => hidden(doc, p, "elemento", ...sign))).toEqual([false, false, false, true]);
      expect(points.map((p) => hidden(doc, p, "mai", ...sign))).toEqual([true, true, true, true]);
    });
  }

  it("titolo: il prefisso si rivela con «elemento» soltanto col cursore nel prefisso", () => {
    const doc = "## Titolo\naltro";
    const points = [0, 5, 9, 12];
    expect(points.map((p) => hidden(doc, p, "riga", 0, 3))).toEqual([false, false, false, true]);
    expect(points.map((p) => hidden(doc, p, "elemento", 0, 3))).toEqual([false, true, true, true]);
    expect(points.map((p) => hidden(doc, p, "mai", 0, 3))).toEqual([true, true, true, true]);
    expect(hidden(doc, 3, "elemento", 0, 3)).toBe(true);
  });

  it("un segno rivelato è attenuato (A5): con «elemento» e «riga», mai con «mai»", () => {
    const near = (doc: string, cursor: number, policy: RevealPolicy) =>
      at(doc, cursor, policy).filter((d) => d.kind === "near").map((d) => [d.from, d.to]);
    expect(near("a **bo** z", 4, "elemento")).toEqual([[2, 4], [6, 8]]);
    expect(near("a **bo** z", 4, "riga")).toEqual([[2, 4], [6, 8]]);
    expect(near("a **bo** z", 4, "mai")).toEqual([]);
    expect(near("a `bo` z", 4, "elemento")).toEqual([[2, 3], [5, 6]]);
    expect(near("## Titolo ##", 1, "elemento")).toEqual([[0, 2], [10, 12]]);
    expect(near("## Titolo", 1, "mai")).toEqual([]);
  });

  it("la definizione di una nota: l'etichetta resta, «]:» diventa ↩ (D5)", () => {
    const doc = "uno[^a] due[^a]\n\n[^a]: la nota";
    const def = doc.indexOf("[^a]:");
    const kinds = (p: number, policy: RevealPolicy) => at(doc, p, policy)
      .filter((d) => d.from >= def && (d.kind === "hide" || d.kind.startsWith("footnote")))
      .map((d) => [d.kind, doc.slice(d.from, d.to)]);
    const rendered = [["hide", "[^"], ["footnote-label", "a"], ["footnote-back", "]: "]];
    expect(kinds(0, "mai")).toEqual(rendered);
    expect(kinds(def + 2, "mai")).toEqual(rendered);
    expect(kinds(def + 2, "elemento")).toEqual([]);
    expect(kinds(def + 8, "elemento")).toEqual(rendered);
    expect(kinds(def + 8, "riga")).toEqual([]);
    expect(firstFootnoteReference(state(doc).doc, "a")).toBe(7);
    expect(firstFootnoteReference(state("[^a]: sola").doc, "a")).toBeNull();
  });

  it("la punteggiatura dopo un pezzo sostituito non va a capo da sola (E2)", () => {
    const glued = (doc: string, cursor: number, policy: RevealPolicy) =>
      at(doc, cursor, policy).filter((d) => d.kind === "nobreak").map((d) => doc.slice(d.from, d.to));
    // Uno stile che finisce sulla lettera non si taglia: il fondo e il
    // margine del codice o dell'evidenziato si vedrebbero due volte.
    expect(glued("x **bo**, poi", 12, "mai")).toEqual(["**,"]);
    expect(glued("vedi [sito](https://x.it). Poi", 0, "mai")).toEqual(["](https://x.it)."]);
    expect(glued("da ==ricordare==, poi", 0, "mai")).toEqual(["==,"]);
    expect(glued("vale $x$; poi", 0, "mai")).toEqual(["$x$;"]);
    expect(glued("x **bo** poi", 12, "mai")).toEqual([]);
  });

  it("citazione: il segno come il prefisso di un titolo", () => {
    const doc = "> testo\naltro";
    expect([0, 4, 7, 10].map((p) => hidden(doc, p, "elemento", 0, 2))).toEqual([false, true, true, true]);
    expect([0, 4, 7, 10].map((p) => hidden(doc, p, "mai", 0, 2))).toEqual([true, true, true, true]);
  });

  it("voce puntata e casella: con «mai» il pallino e la casella restano col cursore sulla riga", () => {
    const bullet = (doc: string, p: number, policy: RevealPolicy) => ofKind(at(doc, p, policy), "list-bullet").length;
    expect([0, 3, 6].map((p) => bullet("- voce\nx", p, "mai"))).toEqual([1, 1, 1]);
    expect([0, 3, 6].map((p) => bullet("- voce\nx", p, "elemento"))).toEqual([0, 1, 1]);
    expect([0, 3, 6].map((p) => bullet("- voce\nx", p, "riga"))).toEqual([0, 0, 0]);
    const box = (p: number, policy: RevealPolicy) => ofKind(at("- [ ] fare\nx", p, policy), "checkbox").length;
    expect([2, 3, 7].map((p) => box(p, "mai"))).toEqual([1, 1, 1]);
    expect([2, 3, 7].map((p) => box(p, "elemento"))).toEqual([0, 0, 1]);
    expect([2, 3, 7].map((p) => box(p, "riga"))).toEqual([0, 0, 0]);
  });

  it("rimando a una nota: con «mai» resta apice col cursore dentro", () => {
    const doc = "nota[^1] qui\n\n[^1]: testo";
    expect([4, 6, 8, 10].map((p) => hidden(doc, p, "mai", 4, 6))).toEqual([true, true, true, true]);
    expect([4, 6, 8, 10].map((p) => hidden(doc, p, "elemento", 4, 6))).toEqual([false, false, false, true]);
  });

  it("con «mai» un link non mostra mai l'indirizzo: col cursore dentro c'è la pastiglia (A4)", () => {
    const link = "vedi [t](https://www.esempio.it/a) qui";
    const end = link.indexOf(" qui");
    for (const p of [5, 7, end, end + 3]) {
      expect(hidden(link, p, "mai", 5, 6), `«[» con il cursore in ${p}`).toBe(true);
    }
    expect(ofKind(at(link, 7, "mai"), "link-pill")).toEqual([{ from: 7, to: end, kind: "link-pill", data: "https://www.esempio.it/a" }]);
    expect(ofKind(at(link, end + 3, "mai"), "link-pill")).toEqual([]);
    expect(hidden(link, end + 3, "mai", 7, end)).toBe(true);
    // Con `elemento` il link col cursore torna sorgente, con `riga` sulla riga.
    expect(hidden(link, 7, "elemento", 5, 6)).toBe(false);
    expect(hidden(link, 14, "riga", 5, 6)).toBe(false);
    expect(pillLabel("https://www.esempio.it/a")).toBe("esempio.it");
    expect(pillLabel("mailto:a@b.it")).toBe("a@b.it");
    expect(pillLabel("[[Viaggio#Lisbona]]")).toBe("Viaggio › Lisbona");
    expect(pillLabel("../capitoli/Uno%20due.md")).toBe("../capitoli/Uno due.md");
  });

  it("di un wikilink con alias, col cursore dentro, la pastiglia dice la nota", () => {
    const doc = "a [[Viaggio#Lisbona|il viaggio]] b";
    const close = doc.indexOf("]]");
    expect(ofKind(at(doc, 22, "mai"), "link-pill")).toEqual([{ from: close, to: close + 2, kind: "link-pill", data: "[[Viaggio#Lisbona]]" }]);
    expect(ofKind(at(doc, 0, "mai"), "link-pill")).toEqual([]);
    // Senza alias il testo è già la nota.
    expect(ofKind(at("a [[Viaggio]] b", 5, "mai"), "link-pill")).toEqual([]);
    expect(hidden("a [[Viaggio]] b", 5, "mai", 2, 4)).toBe(true);
  });

  it("con `mai` la formula resta resa col cursore dentro; con `elemento` torna sorgente e porta il TeX (C6)", () => {
    const math = (p: number, policy: RevealPolicy) => ofKind(at("x $a+b$ y z", p, policy), "math").length;
    expect([2, 4, 7, 9].map((p) => math(p, "mai"))).toEqual([1, 1, 1, 1]);
    expect([2, 4, 7, 9].map((p) => math(p, "elemento"))).toEqual([0, 0, 0, 1]);
    expect(ofKind(at("x $a+b$ y z", 4, "elemento"), "math-source").map((d) => d.data)).toEqual(["a+b"]);
  });

  it("una coppia di tag ammessi nasconde i tag e dà l'elemento al contenuto (D6)", () => {
    const doc = "Premi <kbd>Ctrl</kbd> e <u>qui</u>, non <b>qui</b> né <u>aperto";
    const hides = (p: number, policy: RevealPolicy) => ofKind(at(doc, p, policy), "hide").map((d) => doc.slice(d.from, d.to));
    expect(hides(0, "mai")).toEqual(["<kbd>", "</kbd>", "<u>", "</u>"]);
    expect(ofKind(at(doc, 0, "mai"), "html").map((d) => [doc.slice(d.from, d.to), d.data])).toEqual([["Ctrl", "kbd"], ["qui", "u"]]);
    // Col cursore dentro, `mai` non li mostra; `elemento` sì, attenuati.
    expect(hides(13, "mai")).toEqual(["<kbd>", "</kbd>", "<u>", "</u>"]);
    expect(hides(13, "elemento")).toEqual(["<u>", "</u>"]);
    expect(ofKind(at(doc, 13, "elemento"), "near").map((d) => doc.slice(d.from, d.to))).toEqual(["<kbd>", "</kbd>"]);
  });

  it("riga orizzontale e commento si rivelano sulla riga del cursore in ogni politica", () => {
    for (const policy of ["mai", "elemento", "riga"] as const) {
      expect(ofKind(at("a\n\n---\n\nb", 3, policy), "hr")).toEqual([]);
      expect(ofKind(at("a\n\n---\n\nb", 0, policy), "hr")).toHaveLength(1);
      expect(at("x %%nota%% y", 0, policy).some((d) => d.kind === "hide")).toBe(false);
    }
  });

  it("con più cursori ognuno rivela il suo elemento", () => {
    const doc = "**a** e *b* e `c`";
    const current = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(15)]),
      extensions: [markdown({ base: markdownGrammar }), EditorState.allowMultipleSelections.of(true)],
    });
    const hides = computeDecorations(current, revealOf(current, "elemento")).filter((d) => d.kind === "hide");
    expect(hides.map((d) => doc.slice(d.from, d.to))).toEqual(["*", "*"]);
  });

  it("una selezione con «elemento» rivela gli elementi di cui attraversa i segni", () => {
    const doc = "a **b** c *d* e";
    const current = state(doc, { anchor: 0, head: 9 });
    const hides = computeDecorations(current, revealOf(current, "elemento")).filter((d) => d.kind === "hide");
    expect(hides.map((d) => d.from)).toEqual([10, 12]);
  });
});
