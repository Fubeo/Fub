import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { markdownGrammar } from "../grammar";
import { blockAt, blockModel, buildBlocks, type Block } from "./model";
import corpus from "../../../../../__fixtures__/corpus-syntax.json";

// Il modello dei blocchi (H2): la regola sul corpus e la parità fra il modello
// che segue le modifiche e quello rifatto da capo.

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), blockModel] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

const shape = (blocks: readonly Block[]) => blocks.map((b) => `${b.kind}${b.level || ""}@${b.depth}:${b.from}-${b.to}^${b.parent}`);

/// La regola: ogni byte sta al più in un blocco di primo livello, e fra due
/// blocchi di primo livello ci sono soltanto righe vuote.
function checkRule(doc: string, blocks: readonly Block[]): void {
  const top = blocks.filter((b) => b.depth === 0);
  for (let i = 0; i < top.length; i++) {
    const block = top[i]!;
    expect(block.from).toBeLessThanOrEqual(block.to);
    if (i > 0) {
      const gap = doc.slice(top[i - 1]!.to, block.from);
      expect(top[i - 1]!.to).toBeLessThan(block.from);
      expect(gap.trim(), `fra due blocchi: ${JSON.stringify(gap)}`).toBe("");
    }
  }
  blocks.forEach((block, i) => {
    if (block.parent === -1) return expect(block.depth).toBe(0);
    const parent = blocks[block.parent]!;
    expect(block.parent).toBeLessThan(i);
    expect(parent.depth).toBe(block.depth - 1);
    expect(parent.from).toBeLessThanOrEqual(block.from);
    expect(parent.to).toBeGreaterThanOrEqual(block.to);
  });
}

describe("la regola", () => {
  it("vale su ogni testo del corpus", () => {
    for (const { source } of corpus as { source: string }[]) {
      const state = stateOf(source);
      checkRule(state.doc.toString(), state.field(blockModel).blocks);
    }
  });

  it("legge specie, livelli, voci con sottovoci, callout e `<details>`", () => {
    const doc = [
      "---", "titolo: x", "---", "",
      "# Uno", "",
      "Testo", "su due righe", "",
      "- a", "  - a1", "- [ ] b", "",
      "1. primo", "",
      "> [!note] Nota", "> corpo", "",
      "> citazione", "",
      "```js", "x", "```", "",
      "<details>", "<summary>Apri</summary>", "", "Dentro", "", "</details>", "",
      "---",
    ].join("\n");
    const blocks = stateOf(doc).field(blockModel).blocks;
    expect(blocks.map((b) => `${b.kind}${b.level || ""}@${b.depth}`)).toEqual([
      "frontmatter@0", "heading1@0", "paragraph@0", "bullet@0", "bullet@1", "task@0", "ordered@0",
      "callout@0", "quote@0", "code@0", "details@0", "paragraph@1", "rule@0",
    ]);
    expect(doc.slice(blocks[2]!.from, blocks[2]!.to)).toBe("Testo\nsu due righe");
    expect(blocks[4]!.parent).toBe(3);
    // Il sommario sta nella riga HTML d'apertura: il figlio è il paragrafo.
    expect(blocks[11]!.parent).toBe(10);
    expect(doc.slice(blocks[11]!.from, blocks[11]!.to)).toBe("Dentro");
    checkRule(doc, blocks);
  });

  it("un `<details>` senza chiusura resta un blocco HTML", () => {
    const blocks = stateOf("<details>\n\nDentro\n").field(blockModel).blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["html", "paragraph"]);
  });

  it("un `^id` su una riga sua è del blocco sopra, non un paragrafo", () => {
    const doc = "| a |\n| - |\n| 1 |\n\n^tab\n\nDopo";
    const blocks = stateOf(doc).field(blockModel).blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["table", "paragraph"]);
    expect(doc.slice(blocks[0]!.from, blocks[0]!.to)).toBe("| a |\n| - |\n| 1 |\n\n^tab");
    // In cima alla nota resta un paragrafo: non c'è un blocco sopra.
    expect(stateOf("^solo").field(blockModel).blocks.map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("le righe vuote fra due blocchi non sono di nessuno", () => {
    const state = stateOf("Uno\n\n\nDue");
    expect(blockAt(state, 1)).toBe(0);
    expect(blockAt(state, 4)).toBe(-1);
    expect(blockAt(state, 7)).toBe(1);
  });
});

describe("le modifiche", () => {
  const base = [
    "# Titolo", "", "Primo paragrafo.", "", "- a", "  - a1", "- b", "", "> citazione", "",
    "```", "codice", "```", "", "| x | y |", "| - | - |", "| 1 | 2 |", "", "Ultimo.",
  ].join("\n");

  // Modifiche scelte per toccare i confini: scrivere, unire, aprire un recinto
  // che inghiotte il resto, togliere un prefisso, una voce nuova.
  const edits: { name: string; at: (doc: string) => { from: number; to?: number; insert: string } }[] = [
    { name: "una lettera nel paragrafo", at: (d) => ({ from: d.indexOf("Primo") + 2, insert: "x" }) },
    { name: "un a capo che spezza il paragrafo", at: (d) => ({ from: d.indexOf("paragrafo"), insert: "\n\n" }) },
    { name: "una riga che si attacca sotto", at: (d) => ({ from: d.indexOf("paragrafo.") + 10, insert: "\naltro" }) },
    { name: "una voce nuova", at: (d) => ({ from: d.indexOf("- b") + 3, insert: "\n- c" }) },
    { name: "una sottovoce rientrata", at: (d) => ({ from: d.indexOf("- b") + 3, insert: "\n  - b1" }) },
    { name: "un recinto aperto che inghiotte il resto", at: (d) => ({ from: d.indexOf("> citazione"), insert: "```\n" }) },
    { name: "il recinto chiuso tolto", at: (d) => ({ from: d.lastIndexOf("```"), to: d.lastIndexOf("```") + 3, insert: "" }) },
    { name: "il prefisso del titolo tolto", at: () => ({ from: 0, to: 2, insert: "" }) },
    { name: "la riga vuota fra due blocchi tolta", at: (d) => ({ from: d.indexOf("\n\n> cit"), to: d.indexOf("\n\n> cit") + 1, insert: "" }) },
    { name: "un `<details>` aperto", at: (d) => ({ from: d.indexOf("Ultimo"), insert: "<details>\n\n" }) },
    { name: "in fondo", at: (d) => ({ from: d.length, insert: "\n\n- fine" }) },
    { name: "tutto via", at: (d) => ({ from: 0, to: d.length, insert: "" }) },
  ];

  for (const edit of edits) {
    it(`segue «${edit.name}» come il modello rifatto`, () => {
      const state = stateOf(base);
      const next = state.update({ changes: edit.at(base) }).state;
      ensureSyntaxTree(next, next.doc.length, 5000);
      // Un passo vuoto prende l'albero finito, se l'analisi era rimasta a metà.
      const settled = next.update({}).state;
      expect(shape(settled.field(blockModel).blocks)).toEqual(shape(buildBlocks(settled).blocks));
      checkRule(settled.doc.toString(), settled.field(blockModel).blocks);
    });
  }

  it("una battuta dopo l'altra, in punti a caso, resta uguale al modello rifatto", () => {
    let state = stateOf(base);
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pieces = ["a", " ", "\n", "\n\n", "- ", "# ", "> ", "```", "1. ", "  - ", "|", "<details>\n", "\n\n^id1\n\n", "^x"];
    for (let step = 0; step < 300; step++) {
      const length = state.doc.length;
      const from = Math.floor(random() * (length + 1));
      const remove = random() < 0.3 ? Math.min(length - from, Math.floor(random() * 4)) : 0;
      const insert = remove > 0 && random() < 0.5 ? "" : pieces[Math.floor(random() * pieces.length)]!;
      state = state.update({ changes: { from, to: from + remove, insert } }).state;
      ensureSyntaxTree(state, state.doc.length, 5000);
      state = state.update({}).state;
      expect(shape(state.field(blockModel).blocks), `passo ${step}`).toEqual(shape(buildBlocks(state).blocks));
    }
  });
});
