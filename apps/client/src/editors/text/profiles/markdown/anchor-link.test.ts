import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { anchorAtCursor, writeAnchor } from "./anchor-link";

function state(doc: string, head: number) {
  const s = EditorState.create({ doc, selection: { anchor: head }, extensions: markdown({ base: markdownGrammar }) });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

const fixed = () => 0.5;

describe("anchorAtCursor", () => {
  it("sul titolo dà il suo testo, senza i cancelletti", () => {
    expect(anchorAtCursor(state("## Piano di lavoro ##\n\ntesto", 5))?.anchor).toEqual({ kind: "heading", text: "Piano di lavoro" });
    expect(anchorAtCursor(state("Titolo\n======\n", 2))?.anchor).toEqual({ kind: "heading", text: "Titolo" });
  });

  it("un titolo con un id scritto si collega per l'id", () => {
    expect(anchorAtCursor(state("# Capitolo ^cap1\n", 3))?.anchor).toEqual({ kind: "block", id: "cap1" });
  });

  it("un paragrafo con l'id lo riusa, senza scrivere", () => {
    const found = anchorAtCursor(state("prima riga\nseconda ^esiste\n", 2));
    expect(found).toEqual({ anchor: { kind: "block", id: "esiste" }, insert: null });
  });

  it("a un paragrafo senza id ne dà uno nuovo in coda, anche da una voce di elenco", () => {
    const s = state("- voce uno\n- voce due  \n", 14);
    const found = anchorAtCursor(s, fixed)!;
    expect(found.anchor).toEqual({ kind: "block", id: "ssssss" });
    let next = s;
    writeAnchor(found)({ state: s, dispatch: (tr) => { next = tr.state; } });
    expect(next.doc.toString()).toBe("- voce uno\n- voce due ^ssssss  \n");
  });

  it("non riusa un id che il documento ha già", () => {
    let calls = 0;
    const random = () => (calls++ < 6 ? 0.5 : 0);
    const found = anchorAtCursor(state("vedi [[x#^ssssss]]\n\naltro", 22), random)!;
    expect(found.anchor).toEqual({ kind: "block", id: "aaaaaa" });
  });

  it("dove non c'è un titolo né un paragrafo non c'è un punto", () => {
    expect(anchorAtCursor(state("uno\n\n\n\ndue", 5))).toBeNull();
    expect(anchorAtCursor(state("```\ncodice\n```\n", 6))).toBeNull();
  });
});
