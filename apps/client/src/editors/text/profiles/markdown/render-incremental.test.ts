import { describe, expect, it } from "vitest";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { freshBlocks, renderMarkdown, renderMarkdownState } from "./render";
import type { MarkdownDocument } from "./render-types";

// La Live rende di nuovo soltanto i blocchi che una modifica tocca: gli altri
// tornano dalla resa di prima, spostati. Qui si prova che il risultato è quello
// di una resa da capo, e che il lavoro di una battuta è un blocco.

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] });
}

/// Una resa come dati confrontabili.
function shape(document: MarkdownDocument) {
  return {
    blocks: document.blocks.map((block) => ({
      from: block.from,
      to: block.to,
      kind: block.kind,
      source: block.source,
      html: block.html,
      cells: block.cells ? [...block.cells] : null,
    })),
    anchors: [...document.anchors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    dependencies: document.dependencies,
    html: document.html,
  };
}

const CORPUS = [
  "---",
  "titolo: Prova",
  "---",
  "",
  "# Viaggio ^inizio",
  "",
  "Il **treno** parte alle *otto*[^1], vedi [la guida][guida] e [[Itinerario]] #viaggio.",
  "",
  "## Cose da fare",
  "",
  "- [ ] Prenotare",
  "- [x] Comprare[^2]",
  "  - dettaglio",
  "",
  "> [!tip] Consiglio",
  "> Il tram 28[^1].",
  "",
  "Un paragrafo con un ID a parte.",
  "",
  "^isolato",
  "",
  "```js",
  "const giorni = 3;",
  "```",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "## Cose da fare",
  "",
  "[guida]: https://example.com \"Guida\"",
  "",
  "[^1]: Una nota.",
  "",
  "[^2]: Un'altra **nota**.",
  "",
  "Fine.",
].join("\n");

/// Un generatore pseudo-casuale con un seme: la stessa serie a ogni giro.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const INSERTS = ["a", " ", "\n", "\n\n", "**", "[^1]", "[^3]", "# ", "## ", "```", "> ", "- ", "|", "^id", "$$", "---", "[guida]", "[x]: /y"];

describe("la resa incrementale della Live", () => {
  it("senza resa di prima è la resa da capo", () => {
    expect(shape(renderMarkdownState(stateOf(CORPUS)))).toEqual(shape(renderMarkdown(CORPUS)));
  });

  it("dopo ogni modifica, qualunque, è uguale alla resa da capo", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const next = random(seed);
      let state = stateOf(CORPUS);
      let document = renderMarkdownState(state);
      for (let step = 0; step < 60; step++) {
        const length = state.doc.length;
        const at = Math.floor(next() * (length + 1));
        const changes: ChangeSpec = next() < 0.7
          ? { from: at, insert: INSERTS[Math.floor(next() * INSERTS.length)]! }
          : { from: at, to: Math.min(length, at + 1 + Math.floor(next() * 6)) };
        const transaction = state.update({ changes });
        state = transaction.state;
        document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
        const source = state.doc.toString();
        expect(shape(document), `seme ${seed}, passo ${step}`).toEqual(shape(renderMarkdown(source)));
      }
    }
  });

  it("una battuta in un paragrafo rende quel paragrafo e basta", () => {
    const sections = Array.from({ length: 200 }, (_, i) =>
      `## Sezione ${i}\n\nTesto **forte** ${i}[^1].\n\n> [!note] Nota ${i}\n> corpo\n\n| a | b |\n| --- | --- |\n| ${i} | x |\n`);
    const text = `${sections.join("\n")}\n[^1]: La nota.\n`;
    let state = stateOf(text);
    let document = renderMarkdownState(state);
    const at = text.indexOf("Testo **forte** 100") + "Testo".length;
    for (const letter of "abc") {
      const transaction = state.update({ changes: { from: at, insert: letter } });
      state = transaction.state;
      document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
      expect(freshBlocks(document)).toBe(1);
    }
    expect(document.blocks.length).toBeGreaterThan(800);
  });

  it("una definizione che cambia rifà tutti i blocchi, che potrebbero leggerla", () => {
    const text = "Vedi [la guida][g].\n\nAltro.\n\n[g]: /uno\n";
    let state = stateOf(text);
    const document = renderMarkdownState(state);
    const at = text.indexOf("/uno") + 1;
    const transaction = state.update({ changes: { from: at, to: at + 3, insert: "due" } });
    state = transaction.state;
    const next = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
    expect(freshBlocks(next)).toBe(next.blocks.length);
    expect(next.blocks[0]!.html).toContain('href="/due"');
  });
});
