// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { listPrefixes, widthsHold } from "./hanging";

class Box extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement("div");
  }
}

// Il rientro sospeso (D2): la larghezza si misura nel browser (banco); qui si
// prova dove finisce il prefisso di ogni voce.

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });

describe("il prefisso delle voci", () => {
  it("comprende rientro, segno, casella e spazi; non entra nel codice", () => {
    const doc = "- uno\n  - due\n1. tre\n- [ ] quattro\n-\n\n```\n- no\n```";
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) }) });
    views.push(view);
    // L'albero della vista, non soltanto quello dello stato: sotto carico il
    // primo esame si ferma prima della fine.
    forceParsing(view, doc.length, 10_000);
    const found = listPrefixes(view).map(({ line, end }) => doc.slice(line, end));
    expect(found).toEqual(["- ", "  - ", "1. ", "- [ ] "]);
  });
});

describe("le righe che continuano una voce", () => {
  it("partono dal testo della voce, col loro rientro scritto da togliere", () => {
    const doc = "- [ ] Spedire i cataloghi\n  📅 2026-11-17\nsenza rientro\n\n- altra\n\n  paragrafo dopo una riga vuota\n> - in citazione\n>   che segue";
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) }) });
    views.push(view);
    forceParsing(view, doc.length, 10_000);
    const found = listPrefixes(view).map(({ line, end, of }) => [doc.slice(line, end), of === undefined ? null : doc.slice(of, doc.indexOf("\n", of))]);
    expect(found).toEqual([
      ["- [ ] ", null],
      ["  ", "- [ ] Spedire i cataloghi"],
      ["", "- [ ] Spedire i cataloghi"],
      ["- ", null],
      ["> - ", null],
      [">   ", "> - in citazione"],
    ]);
  });
});

describe("il prefisso delle voci nelle citazioni", () => {
  it("trova le voci di una citazione e quelle annidate, non i paragrafi", () => {
    const doc = "Testo con - un trattino.\n\n> - in citazione\n>   1. annidata\n\n| - | no |\n| --- | --- |";
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) }) });
    views.push(view);
    forceParsing(view, doc.length, 10_000);
    expect(listPrefixes(view).map(({ line, end }) => doc.slice(line, end))).toEqual(["> - ", ">   1. "]);
  });
});

describe("il prefisso delle voci sotto i blocchi resi", () => {
  it("una voce coperta da un blocco reso resta fuori, quelle prima e dopo no", () => {
    const doc = "- uno\n\n> - due, una voce lunga\n> - tre, anche questa\n\n- quattro";
    const from = doc.indexOf("> - due");
    const to = doc.indexOf("- quattro") - 1;
    const hidden = StateField.define<DecorationSet>({
      create: () => Decoration.set(Decoration.replace({ widget: new Box(), block: true }).range(from, to)),
      update: (value, tr) => value.map(tr.changes),
      provide: (field) => EditorView.decorations.from(field),
    });
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar }), hidden] }) });
    views.push(view);
    forceParsing(view, doc.length, 10_000);
    expect(view.visibleRanges.length).toBe(2);
    expect(listPrefixes(view).map(({ line }) => line)).toEqual([0, doc.indexOf("- quattro")]);
  });
});

describe("le larghezze dei prefissi dopo una battuta", () => {
  const doc = "Testo qui.\n\n- uno\n- [ ] due\n";
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) });
  const uno = doc.indexOf("- uno");
  const due = doc.indexOf("- [ ] due");
  const prefixes = [{ line: uno, end: uno + 2 }, { line: due, end: due + 6 }];
  const widths = new Map([[uno, 14], [due, 40]]);
  const after = (changes: { from: number; to?: number; insert?: string }) => {
    const set = state.changes(changes);
    const moved = new Map([...widths].map(([at, width]) => [set.mapPos(at), width]));
    const shifted = prefixes.map(({ line, end }) => ({ line: set.mapPos(line), end: set.mapPos(end) }));
    return widthsHold(moved, shifted, set);
  };

  it("valgono ancora dopo una battuta nel testo o in fondo a una voce", () => {
    expect(after({ from: 2, insert: "x" })).toBe(true);
    expect(after({ from: uno + 5, insert: "y" })).toBe(true);
  });

  it("si rimisurano se la battuta cade nel prefisso o se una voce non ha larghezza", () => {
    expect(after({ from: due + 3, to: due + 4, insert: "x" })).toBe(false);
    expect(after({ from: uno, insert: "  " })).toBe(false);
    const set = state.changes({ from: 2, insert: "x" });
    expect(widthsHold(new Map(), prefixes.map(({ line, end }) => ({ line: set.mapPos(line), end: set.mapPos(end) })), set)).toBe(false);
  });
});

