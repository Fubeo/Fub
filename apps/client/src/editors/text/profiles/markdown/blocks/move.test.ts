import { describe, expect, it } from "vitest";
import { history, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { markdownGrammar } from "../grammar";
import { blockModel } from "./model";
import { moveBlockBy, moveRun, moveSiblings } from "./move";
import { blockAnchor } from "./anchor";
import { mergeUpChange } from "./keys";
import { deleteRun, duplicateRun } from "./selection";

// Spostare, duplicare ed eliminare blocchi (H5, H7, H8), a byte esatti.

function stateOf(doc: string, cursor = 0): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownGrammar }), blockModel, history()],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

const blocksOf = (state: EditorState) => state.field(blockModel).blocks;
const indexAt = (state: EditorState, text: string) => blocksOf(state).findIndex((block) => state.sliceDoc(block.from, block.to).startsWith(text));

function moveBy(doc: string, at: string, dir: -1 | 1): string {
  const state = stateOf(doc, doc.indexOf(at));
  let next = state;
  moveBlockBy(dir)({ state, dispatch: (tr) => { next = tr.state; } });
  return next.doc.toString();
}

describe("spostare", () => {
  it("scambia due paragrafi e tiene le righe vuote", () => {
    expect(moveBy("Uno\n\nDue\n\nTre", "Due", -1)).toBe("Due\n\nUno\n\nTre");
    expect(moveBy("Uno\n\nDue\n\nTre", "Due", 1)).toBe("Uno\n\nTre\n\nDue");
  });

  it("il primo non sale e l'ultimo non scende", () => {
    expect(moveBy("Uno\n\nDue", "Uno", -1)).toBe("Uno\n\nDue");
    expect(moveBy("Uno\n\nDue", "Due", 1)).toBe("Uno\n\nDue");
  });

  it("il frontmatter resta il primo: niente gli passa davanti e lui non scende", () => {
    const doc = "---\nicon: 🌿\n---\nUno\n\nDue";
    // Il primo testo non sale sopra il frontmatter, né con la tastiera né con la tratta.
    expect(moveBy(doc, "Uno", -1)).toBe(doc);
    const state = stateOf(doc);
    const blocks = blocksOf(state);
    expect(blocks[0]!.kind).toBe("frontmatter");
    expect(moveSiblings(state, blocks, indexAt(state, "Due"), indexAt(state, "Due"), 0)).toBeNull();
    // Il frontmatter non scende, nemmeno col cursore dentro di lui.
    expect(moveBy(doc, "icon", 1)).toBe(doc);
    expect(moveSiblings(state, blocks, 0, 0, indexAt(state, "Uno"))).toBeNull();
  });

  it("un file senza a capo finale resta senza", () => {
    expect(moveBy("# Titolo\n\nTesto", "Testo", -1)).toBe("Testo\n\n# Titolo");
  });

  it("un file con l'a capo finale lo tiene in fondo", () => {
    expect(moveBy("Uno\n\nDue\n", "Uno", 1)).toBe("Due\n\nUno\n");
  });

  it("un file CRLF si sposta come uno LF", () => {
    expect(moveBy("Uno\r\n\r\nDue", "Due", -1)).toBe("Due\n\nUno");
  });

  it("una voce si porta dietro le sue sottovoci, fra le sorelle", () => {
    const doc = "- a\n  - a1\n  - a2\n- b\n- c";
    expect(moveBy(doc, "- b", -1)).toBe("- b\n- a\n  - a1\n  - a2\n- c");
    expect(moveBy(doc, "- a", 1)).toBe("- b\n- a\n  - a1\n  - a2\n- c");
  });

  it("una sottovoce resta dentro la sua voce", () => {
    const doc = "- a\n  - a1\n  - a2\n- b";
    expect(moveBy(doc, "a2", -1)).toBe("- a\n  - a2\n  - a1\n- b");
    // La prima sottovoce non esce dal genitore.
    expect(moveBy(doc, "a1", -1)).toBe(doc);
  });

  it("un paragrafo accanto a una voce vuole una riga vuota", () => {
    const state = stateOf("- a\n- b\n\nTesto");
    const spec = moveSiblings(state, blocksOf(state), indexAt(state, "Testo"), indexAt(state, "Testo"), indexAt(state, "- b"))!;
    expect(state.update(spec).state.doc.toString()).toBe("- a\n\nTesto\n\n- b");
  });

  it("le voci numerate si rinumerano dopo lo spostamento", async () => {
    const { renumberLists } = await import("../renumber");
    const { smartLists } = await import("../../../smart-lists");
    const state = EditorState.create({
      doc: "1. uno\n2. due\n3. tre",
      selection: { anchor: 14 },
      extensions: [markdown({ base: markdownGrammar }), blockModel, renumberLists, smartLists.of(true)],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    let next = state;
    moveBlockBy(-1)({ state, dispatch: (tr) => { next = tr.state; } });
    expect(next.doc.toString()).toBe("1. uno\n2. tre\n3. due");
  });

  it("il cursore segue il blocco, e un annulla torna indietro in un passo", () => {
    const doc = "Uno\n\nDue";
    const state = stateOf(doc, doc.indexOf("ue"));
    let next = state;
    moveBlockBy(-1)({ state, dispatch: (tr) => { next = tr.state; } });
    expect(next.sliceDoc(next.selection.main.head, next.selection.main.head + 2)).toBe("ue");
    let back = next;
    undo({ state: next, dispatch: (tr) => { back = tr.state; } });
    expect(back.doc.toString()).toBe(doc);
  });

  it("davanti a sé o subito dopo di sé non si sposta niente", () => {
    const state = stateOf("Uno\n\nDue\n\nTre");
    const due = indexAt(state, "Due");
    expect(moveSiblings(state, blocksOf(state), due, due, due)).toBeNull();
    expect(moveSiblings(state, blocksOf(state), due, due, indexAt(state, "Tre"))).toBeNull();
    // In fondo, invece, sì.
    expect(state.update(moveSiblings(state, blocksOf(state), due, due, -1)!).state.doc.toString()).toBe("Uno\n\nTre\n\nDue");
  });

  it("un `^id` su una riga sua si sposta col suo blocco", () => {
    expect(moveBy("```\nx\n```\n\n^cod\n\nDopo", "Dopo", -1)).toBe("Dopo\n\n```\nx\n```\n\n^cod");
  });
});

describe("il frontmatter resta il primo", () => {
  const step = (state: EditorState, cmd: StateCommand): EditorState => {
    let next = state;
    cmd({ state, dispatch: (tr) => { next = tr.state; } });
    return next;
  };

  it("senza frontmatter il primo blocco si sposta come sempre", () => {
    expect(moveBy("Uno\n\nDue", "Due", -1)).toBe("Due\n\nUno");
    // Un `---` senza chiusura non è un frontmatter: è una riga orizzontale, e non blocca niente.
    expect(moveBy("---\n\nUno\n\nDue", "Uno", -1)).toBe("Uno\n\n---\n\nDue");
  });

  it("un frontmatter vuoto (`---` e `---`) è il primo blocco come gli altri", () => {
    const doc = "---\n---\nUno\n\nDue";
    const state = stateOf(doc);
    expect(blocksOf(state)[0]!.kind).toBe("frontmatter");
    expect(moveBy(doc, "Uno", -1)).toBe(doc);
    expect(moveBy(doc, "---", 1)).toBe(doc);
    // Un blocco che sale fin lì finisce subito dopo di lui.
    expect(moveBy(doc, "Due", -1)).toBe("---\n---\n\nDue\n\nUno");
  });

  it("un blocco portato sopra il frontmatter finisce subito dopo di lui", () => {
    const doc = "---\nicon: 🌿\n---\nUno\n\nDue";
    const state = stateOf(doc);
    const blocks = blocksOf(state);
    const due = indexAt(state, "Due");
    const uno = indexAt(state, "Uno");
    expect(moveSiblings(state, blocks, due, due, 0)).toBeNull();
    expect(moveSiblings(state, blocks, uno, due, 0)).toBeNull();
    const spec = moveSiblings(state, blocks, due, due, uno)!;
    expect(state.update(spec).state.doc.toString()).toBe("---\nicon: 🌿\n---\n\nDue\n\nUno");
  });

  it("il frontmatter non si sposta, né in su né in giù, né da solo né in una tratta", () => {
    const state = stateOf("---\nicon: 🌿\n---\nUno\n\nDue");
    const blocks = blocksOf(state);
    expect(moveRun(state, blocks, { first: 0, last: 0 }, 1)).toBeNull();
    expect(moveRun(state, blocks, { first: 0, last: 0 }, -1)).toBeNull();
    expect(moveRun(state, blocks, { first: 0, last: 1 }, 1)).toBeNull();
    expect(moveRun(state, blocks, { first: 0, last: 1 }, -1)).toBeNull();
    expect(moveRun(state, blocks, { first: 1, last: 1 }, -1)).toBeNull();
  });

  it("annulla e ripeti: il frontmatter resta primo a ogni passo", () => {
    const doc = "---\nicon: 🌿\n---\nUno\n\nDue";
    const start = stateOf(doc, doc.indexOf("Due"));
    const moved = step(start, moveBlockBy(-1));
    expect(moved.doc.toString()).toBe("---\nicon: 🌿\n---\n\nDue\n\nUno");
    expect(blocksOf(moved)[0]!.kind).toBe("frontmatter");
    // Un altro passo verso l'alto non trova più posto: non cambia niente.
    expect(step(moved, moveBlockBy(-1))).toBe(moved);
    const back = step(moved, undo);
    expect(back.doc.toString()).toBe(doc);
    expect(blocksOf(back)[0]!.kind).toBe("frontmatter");
    const again = step(back, redo);
    expect(again.doc.toString()).toBe(moved.doc.toString());
    expect(blocksOf(again)[0]!.kind).toBe("frontmatter");
  });
});

describe("eliminare e duplicare", () => {
  it("elimina un blocco con le sue righe vuote", () => {
    const state = stateOf("Uno\n\nDue\n\nTre");
    const i = indexAt(state, "Due");
    expect(state.update(deleteRun(state, blocksOf(state), { first: i, last: i })).state.doc.toString()).toBe("Uno\n\nTre");
    const last = indexAt(state, "Tre");
    expect(state.update(deleteRun(state, blocksOf(state), { first: last, last })).state.doc.toString()).toBe("Uno\n\nDue");
  });

  it("elimina una sottovoce unica senza lasciare righe", () => {
    const state = stateOf("- a\n  - a1\n- b");
    const i = indexAt(state, "  - a1");
    expect(state.update(deleteRun(state, blocksOf(state), { first: i, last: i })).state.doc.toString()).toBe("- a\n- b");
  });

  it("duplica una voce col passo stretto e un paragrafo con la riga vuota", () => {
    const list = stateOf("- a\n- b");
    const a = indexAt(list, "- a");
    expect(list.update(duplicateRun(list, blocksOf(list), { first: a, last: a })).state.doc.toString()).toBe("- a\n- a\n- b");
    const text = stateOf("Uno");
    expect(text.update(duplicateRun(text, blocksOf(text), { first: 0, last: 0 })).state.doc.toString()).toBe("Uno\n\nUno");
  });
});

describe("Backspace all'inizio di un testo", () => {
  it("lo unisce al testo sopra togliendo la riga vuota", () => {
    const doc = "Uno\n\nDue";
    const state = stateOf(doc, doc.indexOf("Due"));
    const range = mergeUpChange(state, blocksOf(state))!;
    expect(state.update({ changes: range }).state.doc.toString()).toBe("UnoDue");
  });

  it("sotto un blocco di codice resta il Backspace di sempre", () => {
    const doc = "```\nx\n```\n\nDue";
    const state = stateOf(doc, doc.indexOf("Due"));
    expect(mergeUpChange(state, blocksOf(state))).toBeNull();
  });

  it("a metà riga o col cursore dentro non fa niente", () => {
    const doc = "Uno\n\nDue";
    expect(mergeUpChange(stateOf(doc, doc.indexOf("ue")), blocksOf(stateOf(doc)))).toBeNull();
  });
});

describe("il link al blocco", () => {
  const random = () => 0.5;

  it("un paragrafo prende un id in coda", () => {
    const state = stateOf("Un testo\n\nAltro");
    const anchor = blockAnchor(state, blocksOf(state), 0, random);
    expect(anchor.fragment).toMatch(/^\^[0-9a-z]{6}$/);
    expect(state.update({ changes: anchor.changes! }).state.doc.toString()).toBe(`Un testo ${anchor.fragment}\n\nAltro`);
  });

  it("un id che c'è già si riusa", () => {
    const state = stateOf("Un testo ^mio-id");
    expect(blockAnchor(state, blocksOf(state), 0, random)).toEqual({ fragment: "^mio-id", changes: null });
  });

  it("un titolo si indirizza col suo testo", () => {
    const state = stateOf("## Cose da fare");
    expect(blockAnchor(state, blocksOf(state), 0, random)).toEqual({ fragment: "Cose da fare", changes: null });
  });

  it("un blocco di codice prende l'id su una riga sua, e lo ritrova", () => {
    const state = stateOf("```\nx\n```\n\nDopo");
    const anchor = blockAnchor(state, blocksOf(state), 0, random);
    const next = state.update({ changes: anchor.changes! }).state;
    ensureSyntaxTree(next, next.doc.length, 5000);
    expect(next.doc.toString()).toBe(`\`\`\`\nx\n\`\`\`\n\n${anchor.fragment}\n\nDopo`);
    const settled = next.update({}).state;
    expect(blocksOf(settled).map((block) => block.kind)).toEqual(["code", "paragraph"]);
    expect(blockAnchor(settled, blocksOf(settled), 0, random)).toEqual({ fragment: anchor.fragment, changes: null });
  });

  it("una voce con sottovoci prende l'id sulla sua riga", () => {
    const state = stateOf("- padre\n  - figlio");
    const anchor = blockAnchor(state, blocksOf(state), 0, random);
    expect(state.update({ changes: anchor.changes! }).state.doc.toString()).toBe(`- padre ${anchor.fragment}\n  - figlio`);
  });
});

describe("la selezione segue lo spostamento", () => {
  it("una tratta di due blocchi si sposta intera", () => {
    const state = stateOf("Uno\n\nDue\n\nTre");
    const due = indexAt(state, "Due");
    const tre = indexAt(state, "Tre");
    const selected = state.update({ selection: EditorSelection.single(blocksOf(state)[due]!.from, blocksOf(state)[tre]!.to) }).state;
    const spec = moveSiblings(selected, blocksOf(selected), due, tre, 0)!;
    const next = selected.update(spec).state;
    expect(next.doc.toString()).toBe("Due\n\nTre\n\nUno");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("Due\n\nTre");
  });
});
