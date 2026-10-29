import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { MARKDOWN_ACTIONS, markdownActionState } from "./actions";
import { emptyPairsExtension } from "./empty-pair";

// I gesti di formato «come in Word» (H11): `|` è il cursore, `‹…›` la
// selezione.

function mk(spec: string, live = false): EditorState {
  const open = spec.indexOf("‹");
  const stripped = spec.replace("‹", "").replace("›", "");
  const selection = open !== -1
    ? EditorSelection.single(open, spec.replace("‹", "").indexOf("›"))
    : EditorSelection.single(spec.indexOf("|"));
  const state = EditorState.create({
    doc: open !== -1 ? stripped : spec.replace("|", ""),
    selection,
    extensions: [markdown({ base: markdownGrammar }), live ? emptyPairsExtension() : []],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

function command(id: string): StateCommand {
  const found = MARKDOWN_ACTIONS.get(id);
  if (!found) throw new Error(`${id} non è nel catalogo`);
  return found.run;
}

function apply(id: string, state: EditorState): EditorState {
  let tr: Transaction | null = null;
  command(id)({ state, dispatch: (transaction) => { tr = transaction; } });
  return tr === null ? state : (tr as Transaction).state;
}

const run = (id: string, spec: string) => show(apply(id, mk(spec)));

describe("col cursore dentro un elemento, il gesto lo toglie tutto", () => {
  it("grassetto, corsivo, barrato, sottolineato, apice e pedice", () => {
    expect(run("markdown.bold", "a **due pa|role** b")).toBe("a ‹due parole› b");
    expect(run("markdown.italic", "a **x *due pa|role* y** b")).toBe("a **x ‹due parole› y** b");
    expect(run("markdown.strikethrough", "~~via d|a~~")).toBe("‹via da›");
    expect(run("markdown.underline", "un <u>tratto so|tto</u>")).toBe("un ‹tratto sotto›");
    expect(run("markdown.superscript", "mc^2|^ e")).toBe("mc‹2› e");
    expect(run("markdown.subscript", "H~2|~O")).toBe("H‹2›O");
    expect(run("markdown.highlight", "==tutto| qui==")).toBe("‹tutto qui›");
  });

  it("fuori dall'elemento il gesto avvolge, come prima", () => {
    expect(run("markdown.bold", "a ‹due parole› b")).toBe("a **‹due parole›** b");
    expect(run("markdown.underline", "un ‹tratto›")).toBe("un <u>‹tratto›</u>");
    expect(run("markdown.superscript", "mc‹2›")).toBe("mc^‹2›^");
    expect(run("markdown.subscript", "H‹2›O")).toBe("H~‹2›~O");
  });

  it("il pedice non scambia un barrato per una tilde", () => {
    expect(run("markdown.subscript", "~~ba|rrato~~")).not.toContain("~barrato~ ");
    expect(run("markdown.subscript", "~~ba|rrato~~")).not.toBe("~barrato~");
  });
});

describe("lo stato della barra", () => {
  it("sottolineato, apice e pedice sono premuti col cursore dentro", () => {
    const pressed = (id: string, spec: string) => markdownActionState(MARKDOWN_ACTIONS.get(id)!, mk(spec)).active;
    expect(pressed("markdown.underline", "<u>so|tto</u>")).toBe(true);
    expect(pressed("markdown.underline", "so|tto")).toBe(false);
    expect(pressed("markdown.superscript", "mc^2|^")).toBe(true);
    expect(pressed("markdown.subscript", "H~2|~O")).toBe(true);
    expect(pressed("markdown.subscript", "~~ba|rrato~~")).toBe(false);
  });
});

describe("la coppia vuota della Live", () => {
  it("se il cursore se ne va senza scrivere, sparisce", () => {
    const opened = apply("markdown.bold", mk("fine. |", true));
    expect(show(opened)).toBe("fine. **|**");
    const left = opened.update({ selection: { anchor: 0 } }).state;
    expect(left.doc.toString()).toBe("fine. ");
    expect(left.selection.main.head).toBe(0);
  });

  it("se si scrive dentro, resta", () => {
    const opened = apply("markdown.bold", mk("fine. |", true));
    const typed = opened.update({ changes: { from: 8, insert: "sì" }, selection: { anchor: 10 } }).state;
    const left = typed.update({ selection: { anchor: 0 } }).state;
    expect(left.doc.toString()).toBe("fine. **sì**");
  });

  it("in Sorgente la coppia resta dov'è", () => {
    const opened = apply("markdown.bold", mk("fine. |"));
    expect(opened.update({ selection: { anchor: 0 } }).state.doc.toString()).toBe("fine. ****");
  });
});
