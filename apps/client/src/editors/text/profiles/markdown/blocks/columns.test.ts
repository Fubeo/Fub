import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { markdownGrammar } from "../grammar";
import { renderMarkdown } from "../render";
import { blockModel } from "./model";
import { columnCount, columnsRun, dropAsColumn, intoColumns } from "./columns";

// Le colonne coi blocchi (K3): «In colonne» e il blocco lasciato sul bordo
// destro di un altro, a byte esatti; il risultato si legge in griglia.

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), blockModel] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}
const blocksOf = (state: EditorState) => state.field(blockModel).blocks;
const at = (state: EditorState, text: string) => blocksOf(state).findIndex((block) => state.sliceDoc(block.from, block.to).startsWith(text));
const apply = (state: EditorState, spec: TransactionSpec) => state.update(spec).state.doc.toString();
const grid = (doc: string) => /data-columns="(\d)"/.exec(renderMarkdown(doc).html)?.[1] ?? null;

describe("«In colonne»", () => {
  it("un blocco va accanto al fratello che lo segue", () => {
    const state = stateOf("Uno\n\n- a\n- b\n\nTre");
    const one = at(state, "Uno");
    const picked = columnsRun(state, blocksOf(state), { first: one, last: one })!;
    const out = apply(state, intoColumns(state, blocksOf(state), picked));
    expect(out).toBe("> [!columns]\n> > [!column]\n> > Uno\n>\n> > [!column]\n> > - a\n\n- b\n\nTre");
    expect(grid(out)).toBe("2");
  });

  it("una tratta di tre fa tre colonne; oltre quattro, o in fondo, no", () => {
    const state = stateOf("A\n\nB\n\nC\n\nD\n\nE");
    const blocks = blocksOf(state);
    const picked = columnsRun(state, blocks, { first: 0, last: 2 })!;
    expect(grid(apply(state, intoColumns(state, blocks, picked)))).toBe("3");
    expect(columnsRun(state, blocks, { first: 0, last: 4 })).toBeNull();
    expect(columnsRun(state, blocks, { first: 4, last: 4 })).toBeNull();
  });

  it("una voce di un elenco o delle colonne già fatte non si mettono in colonna", () => {
    const state = stateOf("- a\n  - b\n\n> [!columns]\n> > [!column]\n> > x\n>\n> > [!column]\n> > y\n\nZ");
    const blocks = blocksOf(state);
    expect(columnsRun(state, blocks, { first: at(state, "  - b"), last: at(state, "  - b") })).toBeNull();
    const cols = at(state, "> [!columns]");
    expect(columnCount(state, blocks[cols]!)).toBe(2);
    expect(columnsRun(state, blocks, { first: cols, last: cols })).toBeNull();
  });
});

describe("il blocco lasciato sul bordo destro", () => {
  it("accanto a un paragrafo fa due colonne e lascia il suo posto", () => {
    const state = stateOf("Sopra\n\nOspite\n\nMezzo\n\nOspitato\n\nSotto");
    const blocks = blocksOf(state);
    const moving = at(state, "Ospitato");
    const out = apply(state, dropAsColumn(state, blocks, { first: moving, last: moving }, at(state, "Ospite"))!);
    expect(out).toBe("Sopra\n\n> [!columns]\n> > [!column]\n> > Ospite\n>\n> > [!column]\n> > Ospitato\n\nMezzo\n\nSotto");
  });

  it("il primo blocco, lasciato più giù, porta via la riga vuota sotto di sé", () => {
    const state = stateOf("Primo\n\nSecondo");
    const blocks = blocksOf(state);
    const out = apply(state, dropAsColumn(state, blocks, { first: 0, last: 0 }, 1)!);
    expect(out).toBe("> [!columns]\n> > [!column]\n> > Secondo\n>\n> > [!column]\n> > Primo");
  });

  it("delle colonne ne prendono una in fondo, fino a quattro", () => {
    const four = "> [!columns]\n> > [!column]\n> > 1\n>\n> > [!column]\n> > 2\n>\n> > [!column]\n> > 3";
    const state = stateOf(`${four}\n\nQuattro\n\nCinque`);
    const blocks = blocksOf(state);
    const moving = at(state, "Quattro");
    const out = apply(state, dropAsColumn(state, blocks, { first: moving, last: moving }, 0)!);
    expect(out).toBe(`${four}\n>\n> > [!column]\n> > Quattro\n\nCinque`);
    expect(grid(out)).toBe("4");
    const full = stateOf(out);
    const last = at(full, "Cinque");
    expect(dropAsColumn(full, blocksOf(full), { first: last, last }, 0)).toBeNull();
  });

  it("una voce accanto a un'altra voce si stacca dall'elenco con una riga vuota", () => {
    const state = stateOf("- a\n- b\n- c");
    const blocks = blocksOf(state);
    const out = apply(state, dropAsColumn(state, blocks, { first: 2, last: 2 }, 1)!);
    expect(out).toBe("- a\n\n> [!columns]\n> > [!column]\n> > - b\n>\n> > [!column]\n> > - c");
    expect(grid(out)).toBe("2");
  });

  it("un blocco con righe vuote dentro le tiene citate", () => {
    const state = stateOf("Testo\n\n```\na\n\nb\n```");
    const blocks = blocksOf(state);
    const out = apply(state, dropAsColumn(state, blocks, { first: 1, last: 1 }, 0)!);
    expect(out).toBe("> [!columns]\n> > [!column]\n> > Testo\n>\n> > [!column]\n> > ```\n> > a\n> >\n> > b\n> > ```");
  });
});
