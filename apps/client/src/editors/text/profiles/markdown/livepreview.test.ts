import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { activeLinesOf, computeDecorations, type LiveDeco, type LiveDecoKind } from "./livepreview";

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
  it("un commento sparisce intero fuori dalla riga attiva e con lui ciò che contiene", () => {
    const doc = "a %%[[Nota]] #tag%% b";
    const hidden = ofKind(decorate(doc), "hide");
    expect(hidden).toContainEqual({ from: 2, to: 19, kind: "hide" });
    expect(ofKind(decorate(doc), "wikilink")).toEqual([]);
    expect(ofKind(decorate(doc), "tag")).toEqual([]);
    const active = decorate(doc, [1]);
    expect(ofKind(active, "hide")).toEqual([]);
    expect(ofKind(active, "highlight")).toContainEqual({ from: 2, to: 19, kind: "highlight", data: "comment" });
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

  it("chi apre prima di una formula e la attraversa la perde; un evidenziato che la contiene no", () => {
    expect(ofKind(decorate("==a $b== c$ y"), "math")).toEqual([]);
    expect(ofKind(decorate("==a $b== c$ y"), "highlight")).toEqual([{ from: 2, to: 6, kind: "highlight" }]);
    expect(decorate("%%a $b$ c%% y")).toEqual([{ from: 0, to: 11, kind: "hide" }]);
    const contained = decorate("==a $b$ c== y");
    expect(ofKind(contained, "highlight")).toEqual([{ from: 2, to: 9, kind: "highlight" }]);
    expect(ofKind(contained, "math")).toEqual([{ from: 4, to: 7, kind: "math", data: "b" }]);
    // Un wikilink e un'immagine non leggono la formula che racchiudono.
    expect(ofKind(decorate("[[a $b$ c]] y"), "math")).toEqual([]);
    expect(ofKind(decorate("![a $b$](x.png) y"), "math")).toEqual([]);
    // Non la perde chi apre nel codice o dentro un'altra formula.
    expect(ofKind(decorate("`==a` $b== c$ y"), "math").map((d) => d.data)).toEqual(["b== c"]);
    expect(ofKind(decorate("$a ==b$ c $d== e$ y"), "math").map((d) => d.data)).toEqual(["a ==b", "d== e"]);
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
    expect(ofKind(decorate("x ![a](https://e.test/a.png) y"), "image")).toEqual([]);
    expect(ofKind(decorate("x ![a](data:image/png;base64,AA) y"), "image")).toEqual([]);
    expect(ofKind(decorate("x ![a][ref] y\n\n[ref]: a.png"), "image")).toEqual([]);
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
