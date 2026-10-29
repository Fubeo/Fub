import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { liveReveal } from "../../live-reveal";
import { markdownGrammar } from "./grammar";
import { blockIdMarks } from "./block-id";

// Gli id di blocco si ricalcolano soltanto sulle righe toccate: il risultato
// deve essere quello di un calcolo da capo, dopo ogni modifica.

function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownGrammar }), Prec.highest(liveReveal.of("mai")), blockIdMarks],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function ranges(state: EditorState): [number, number][] {
  const out: [number, number][] = [];
  for (const source of state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? null : source;
    set?.between(0, state.doc.length, (from, to) => { out.push([from, to]); });
  }
  return out;
}

describe("gli id di blocco, a pezzi", () => {
  it("dopo ogni modifica valgono come un calcolo da capo", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pieces = ["Testo ^abc", "\n\n^id1\n\n", "\n", "x", "```\n", "^x", " ^fine", "\n\n", "- voce ^v1\n"];
    let state = stateOf("Uno ^a\n\nDue\n\n^b\n\n```\n^c\n```\n");
    // L'id in coda e quello su una riga sua; quello nel codice no.
    expect(ranges(state)).toHaveLength(2);
    for (let step = 0; step < 300; step++) {
      const at = Math.floor(random() * (state.doc.length + 1));
      const change = random() < 0.6
        ? { from: at, insert: pieces[Math.floor(random() * pieces.length)]! }
        : { from: at, to: Math.min(state.doc.length, at + 1 + Math.floor(random() * 6)) };
      state = state.update({ changes: change }).state;
      ensureSyntaxTree(state, state.doc.length, 5000);
      state = state.update({}).state;
      expect(ranges(state), `passo ${step}: ${JSON.stringify(state.doc.toString())}`).toEqual(ranges(stateOf(state.doc.toString())));
    }
  });
});
