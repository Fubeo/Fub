import { describe, expect, it } from "vitest";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { freshBlocks, PREFIX_RENDER_FROM, renderMarkdown, renderMarkdownState, renderMarkdownStatePrefix } from "./render";
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

// Un documento grande appena aperto si rende fin dove il parser arriva in
// fretta: la prima schermata non aspetta la lettura di tutto il file.
describe("resa dell'inizio di un documento grande", () => {
  /// Una nota ben oltre `PREFIX_RENDER_FROM`, con una tabella in cima e una
  /// definizione di link in fondo.
  function largeNote(): string {
    const paragraphs = Array.from({ length: 2_000 }, (_, i) => `Paragrafo ${i + 1}: una riga di prosa senza segni, lunga quanto basta.`);
    return `Vedi [la guida][g].\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n${paragraphs.join("\n\n")}\n\n[g]: /guida\n`;
  }

  it("un documento piccolo si rende tutto, come renderMarkdownState", () => {
    const state = stateOf(CORPUS);
    const { document, complete } = renderMarkdownStatePrefix(state);
    expect(complete).toBe(true);
    expect(shape(document)).toEqual(shape(renderMarkdownState(stateOf(CORPUS))));
  });

  it("un documento grande si ferma a un blocco chiuso, senza leggere tutto il file", () => {
    const text = largeNote();
    expect(text.length).toBeGreaterThan(PREFIX_RENDER_FROM * 4);
    const state = stateOf(text);
    const { document, complete } = renderMarkdownStatePrefix(state);
    expect(complete).toBe(false);
    // L'albero dello stato non è stato portato in fondo.
    expect(syntaxTreeAvailable(state, text.length)).toBe(false);
    expect(document.source.length).toBeGreaterThanOrEqual(PREFIX_RENDER_FROM / 2);
    expect(document.source.length).toBeLessThan(PREFIX_RENDER_FROM * 2);
    expect(text.startsWith(document.source)).toBe(true);
    // I blocchi resi sono quelli della resa completa, uno per uno; la
    // definizione in fondo non c'è ancora.
    const full = renderMarkdownState(stateOf(text));
    const last = document.blocks.at(-1)!;
    expect(last.to).toBeLessThanOrEqual(document.source.length);
    expect(document.blocks.map((block) => [block.from, block.to, block.kind]))
      .toEqual(full.blocks.slice(0, document.blocks.length).map((block) => [block.from, block.to, block.kind]));
    expect(document.blocks[1]!.kind).toBe(full.blocks[1]!.kind);
    expect(document.blocks[0]!.html).not.toContain('href="/guida"');
    expect(full.blocks[0]!.html).toContain('href="/guida"');
  });

  it("con l'albero in fondo la resa è completa e uguale a quella da capo", () => {
    const text = largeNote();
    const state = stateOf(text);
    const partial = renderMarkdownStatePrefix(state);
    expect(ensureSyntaxTree(state, text.length, 10_000)).not.toBeNull();
    const { document, complete } = renderMarkdownStatePrefix(state, undefined, { document: partial.document, changes: state.changes() });
    expect(complete).toBe(true);
    expect(shape(document)).toEqual(shape(renderMarkdownState(stateOf(text))));
  });
});
