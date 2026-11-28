// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { computeDecorations, livePreview, revealOf } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { parsed, parsedView } from "./test-support";

// UX-102: in Scrittura le entità HTML (`&amp;`, `&lt;`, `&#39;`) fuori dal
// codice e dall'HTML grezzo si leggono risolte, come in Lettura; il testo del
// file non cambia, e col cursore sulla riga (o accanto, con `elemento` e
// `mai`) torna la sorgente.

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

const LINE = "Testo &amp; fine, &lt;segni&gt; e l&#39;apostrofo.";

function entities(doc: string, cursor: number, policy: RevealPolicy = "riga") {
  const state = parsed(EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownGrammar })] }));
  return computeDecorations(state, revealOf(state, policy))
    .filter((d) => d.kind === "entity")
    .map((d) => [doc.slice(d.from, d.to), d.data]);
}

describe("le entità HTML nella Scrittura", () => {
  const away = `${LINE}\n\naltro`;
  const end = away.length;

  it("fuori dalla riga del cursore si leggono risolte", () => {
    expect(entities(away, end)).toEqual([["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&#39;", "'"]]);
  });

  it("sulla riga del cursore resta la sorgente; con «elemento» e «mai» solo accanto all'entità", () => {
    expect(entities(away, 0, "riga")).toEqual([]);
    const amp = LINE.indexOf("&amp;");
    for (const policy of ["elemento", "mai"] as const) {
      expect(entities(away, 0, policy)).toHaveLength(4);
      expect(entities(away, amp + 2, policy).map(([raw]) => raw)).toEqual(["&lt;", "&gt;", "&#39;"]);
    }
  });

  it("il codice, l'HTML grezzo, i wikilink e gli indirizzi restano come sono scritti", () => {
    const doc = [
      "`a &amp; b`",
      "",
      "```",
      "x &lt; y",
      "```",
      "",
      "<div title=\"&amp;\">&amp;</div>",
      "",
      "[[A &amp; B]] e <https://e.it/?a=1&amp;b=2>",
      "",
      "fine",
    ].join("\n");
    expect(entities(doc, doc.length)).toEqual([]);
  });

  it("un'entità che non nomina niente resta testo", () => {
    expect(entities("a &nonesiste; b\n\nc", 18)).toEqual([]);
  });
});

describe("il testo del file non cambia", () => {
  function liveView(doc: string, anchor: number): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(anchor),
        extensions: [markdown({ base: markdownGrammar }), Prec.highest(liveReveal.of("riga")), livePreview({ openWikilink() {}, searchTag() {} })],
      }),
    });
    views.push(view);
    parsedView(view);
    return view;
  }

  it("la riga si vede risolta, il documento tiene le entità, e col cursore le ridà", () => {
    const doc = `${LINE}\n\naltro`;
    const view = liveView(doc, doc.length);
    const line = () => view.contentDOM.querySelector(".cm-line")!.textContent;
    expect(line()).toBe("Testo & fine, <segni> e l'apostrofo.");
    expect(view.state.doc.toString()).toBe(doc);

    view.dispatch({ selection: EditorSelection.single(3) });
    expect(line()).toBe(LINE);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
