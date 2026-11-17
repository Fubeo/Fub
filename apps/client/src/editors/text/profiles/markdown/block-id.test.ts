import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { type ChangeSpec, EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { liveReveal } from "../../live-reveal";
import { markdownGrammar } from "./grammar";
import { blockIdMarks } from "./block-id";

// Gli id di blocco si ricalcolano soltanto sulle righe toccate: il risultato
// deve essere quello di un calcolo da capo, dopo ogni modifica.
//
// Il parser di CodeMirror lavora a tempo (20 ms per transazione): sotto
// carico l'albero di uno stato appena creato può restare a metà, con il
// codice in fondo non ancora riconosciuto. Il campo si ricalcola quando
// l'albero nuovo arriva; il confronto quindi si fa sempre su stati con
// l'albero completo e già consegnato al campo, mai su uno stato appena creato.

/// Finisce l'analisi e la consegna ai campi con una transazione vuota, come
/// fa l'editor vero quando il parser in sottofondo avanza.
function parsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000);
  const next = state.update({}).state;
  expect(syntaxTreeAvailable(next), "l'albero deve coprire tutto il documento").toBe(true);
  return next;
}

function stateOf(doc: string): EditorState {
  return parsed(EditorState.create({
    doc,
    extensions: [markdown({ base: markdownGrammar }), Prec.highest(liveReveal.of("mai")), blockIdMarks],
  }));
}

function ranges(state: EditorState): [number, number][] {
  const out: [number, number][] = [];
  for (const source of state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? null : source;
    set?.between(0, state.doc.length, (from, to) => { out.push([from, to]); });
  }
  return out;
}

/// Trecento modifiche a caso, sempre le stesse (seme fisso).
function walk(): void {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pieces = ["Testo ^abc", "\n\n^id1\n\n", "\n", "x", "```\n", "^x", " ^fine", "\n\n", "- voce ^v1\n"];
  let state = stateOf("Uno ^a\n\nDue\n\n^b\n\n```\n^c\n```\n");
  // L'id in coda e quello su una riga sua; quello nel codice no.
  expect(ranges(state)).toHaveLength(2);
  for (let step = 0; step < 300; step++) {
    const at = Math.floor(random() * (state.doc.length + 1));
    const change: ChangeSpec = random() < 0.6
      ? { from: at, insert: pieces[Math.floor(random() * pieces.length)]! }
      : { from: at, to: Math.min(state.doc.length, at + 1 + Math.floor(random() * 6)) };
    state = parsed(state.update({ changes: change }).state);
    expect(ranges(state), `passo ${step}: ${JSON.stringify(state.doc.toString())}`).toEqual(ranges(stateOf(state.doc.toString())));
  }
}

describe("gli id di blocco, a pezzi", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("dopo ogni modifica valgono come un calcolo da capo", () => {
    walk();
  });

  it("anche quando il parser si ferma a ogni passo, come su una macchina carica", () => {
    // Ogni lettura dell'orologio salta 25 ms: il budget di 20 ms di una
    // transazione finisce dopo un solo passo del parser, e l'albero resta a
    // metà finché `ensureSyntaxTree` non lo completa.
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 25));
    walk();
  });
});
