import { describe, expect, it } from "vitest";
import { type ChangeSpec, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { detailsLive, detailsOf, detailsVisited } from "./details-live";
import { pairDetails, type TopBlock } from "./details";

// I ripiegabili si seguono battuta per battuta: una modifica rilegge i nodi
// di primo livello vicini, non tutta la nota, e il risultato è quello di una
// lettura da capo dello stesso albero.

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), detailsLive()] });
  ensureSyntaxTree(state, doc.length, 10_000);
  // Una transazione porta l'albero finito nello stato.
  return state.update({}).state;
}

/// La lettura da capo: tutti i blocchi HTML di primo livello dell'albero.
function scanned(state: EditorState) {
  const tops: TopBlock[] = [];
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "HTMLBlock") tops.push({ from: node.from, to: node.to, html: state.sliceDoc(node.from, node.to) });
  }
  return pairDetails(tops);
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const SECTION = (i: number) =>
  `## Sezione ${i}\n\nTesto ${i}.\n\n<details>\n<summary>Apri ${i}</summary>\n\nDentro ${i}.\n\n</details>\n\n- voce ${i}\n`;

describe("i ripiegabili a ogni battuta", () => {
  it("una battuta in un paragrafo guarda soltanto i nodi vicini", () => {
    const text = Array.from({ length: 200 }, (_, i) => SECTION(i)).join("\n");
    let state = stateOf(text);
    expect(detailsVisited(state)).toBeGreaterThan(800);
    let checked = 0;
    // Una battuta col parser che arriva in fondo nel suo tempo, come in un
    // editor libero; su una macchina carica può non arrivarci, e allora il
    // campo rilegge da capo quando l'albero è finito: quella battuta non si
    // conta.
    const type = (from: number, insert: string, label: string) => {
      state = state.update({ changes: { from, insert }, userEvent: "input.type" }).state;
      if (syntaxTree(state).length === state.doc.length) {
        expect(detailsVisited(state), label).toBeLessThanOrEqual(6);
        checked++;
      } else {
        ensureSyntaxTree(state, state.doc.length, 10_000);
        state = state.update({}).state;
      }
    };
    let at = text.indexOf("Testo 100.") + "Testo".length;
    for (const insert of ["a", "b", " ", "\n", "c"]) {
      type(at, insert, JSON.stringify(insert));
      at += insert.length;
    }
    // Dentro un ripiegabile, e nel suo sommario.
    for (const needle of ["Dentro 150.", "Apri 60<"]) type(state.doc.toString().indexOf(needle) + 3, "x", needle);
    expect(checked).toBeGreaterThan(0);
    expect(detailsOf(state)).toEqual(scanned(state));
    expect(detailsOf(state).pairs).toHaveLength(200);
  });

  it("dopo modifiche a caso sono quelli di una lettura da capo", () => {
    const base = Array.from({ length: 6 }, (_, i) => SECTION(i)).join("\n");
    const pieces = ["a", "\n", "\n\n", "<details>\n", "</details>\n", "<summary>s</summary>", "```\n", "- ", "> ", "<div>\n", " "];
    let steps = 0;
    let patched = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const next = random(seed);
      let state = stateOf(base);
      for (let step = 0; step < 80; step++) {
        const length = state.doc.length;
        const points = Array.from({ length: 1 + Math.floor(next() * 2) }, () => Math.floor(next() * (length + 1))).sort((a, b) => a - b);
        const changes: ChangeSpec[] = [];
        let floor = 0;
        for (const point of points) {
          if (point < floor) continue;
          const remove = next() < 0.3 ? Math.min(length - point, Math.floor(next() * 6)) : 0;
          changes.push({ from: point, to: point + remove, insert: pieces[Math.floor(next() * pieces.length)]! });
          floor = point + remove + 1;
        }
        state = state.update({ changes }).state;
        // Su una macchina carica il parser può non finire nel suo tempo: si
        // finisce l'albero, e il campo lo rilegge da capo.
        if (syntaxTree(state).length !== state.doc.length) {
          ensureSyntaxTree(state, state.doc.length, 10_000);
          state = state.update({}).state;
        }
        expect(detailsOf(state), `seme ${seed}, passo ${step}`).toEqual(scanned(state));
        steps++;
        let nodes = 0;
        for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) nodes++;
        if (detailsVisited(state)! < nodes) patched++;
      }
    }
    // La prova vale per la lettura che segue la modifica, non soltanto per
    // quella da capo che la sostituisce.
    expect(patched / steps).toBeGreaterThan(0.5);
  });
});
