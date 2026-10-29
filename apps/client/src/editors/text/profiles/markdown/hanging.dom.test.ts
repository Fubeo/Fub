// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { listPrefixes } from "./hanging";

// Il rientro sospeso (D2): la larghezza si misura nel browser (banco); qui si
// prova dove finisce il prefisso di ogni voce.

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });

describe("il prefisso delle voci", () => {
  it("comprende rientro, segno, casella e spazi; non entra nel codice", () => {
    const doc = "- uno\n  - due\n1. tre\n- [ ] quattro\n-\n\n```\n- no\n```";
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) }) });
    views.push(view);
    ensureSyntaxTree(view.state, doc.length, 1000);
    const found = listPrefixes(view).map(({ line, end }) => doc.slice(line, end));
    expect(found).toEqual(["- ", "  - ", "1. ", "- [ ] "]);
  });
});
