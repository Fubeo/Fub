// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { cursorCharLeft } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { livePreview } from "./livepreview";
import { blockPrefixAt } from "./block-prefix";
import { liveReveal, type RevealPolicy } from "../../live-reveal";

function mount(doc: string, cursor: number, policy: RevealPolicy = "mai") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      Prec.highest(liveReveal.of(policy)),
      livePreview({ openWikilink() {}, searchTag() {} }),
    ],
  });
  engine.setDoc(doc);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  view.dispatch({ selection: { anchor: cursor } });
  const press = (key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
  const type = (text: string) => {
    const { head } = view.state.selection.main;
    view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length }, userEvent: "input.type" });
  };
  return { view, press, type, head: () => view.state.selection.main.head, cleanup: () => { engine.destroy(); parent.remove(); } };
}

function prefixOf(doc: string, line = 1) {
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const prefix = blockPrefixAt(state, state.doc.line(line));
  return prefix && { text: prefix.textFrom - state.doc.line(line).from, last: prefix.lastFrom - state.doc.line(line).from };
}

describe("il prefisso di un blocco", () => {
  it("si legge per titoli, citazioni, voci e caselle, anche annidati", () => {
    expect(prefixOf("## Titolo")).toEqual({ text: 3, last: 0 });
    expect(prefixOf("> citata")).toEqual({ text: 2, last: 0 });
    expect(prefixOf("> > dentro")).toEqual({ text: 4, last: 2 });
    expect(prefixOf("- voce")).toEqual({ text: 2, last: 0 });
    expect(prefixOf("1. prima")).toEqual({ text: 3, last: 0 });
    expect(prefixOf("- [ ] fare")).toEqual({ text: 6, last: 0 });
    expect(prefixOf("> - voce")).toEqual({ text: 4, last: 2 });
    expect(prefixOf("- a\n  - sotto", 2)).toEqual({ text: 4, last: 2 });
    expect(prefixOf("- # titolo")).toEqual({ text: 4, last: 2 });
  });

  it("non c'è nel codice, nel frontmatter né nella prosa", () => {
    expect(prefixOf("```\n- non è una voce\n```", 2), "codice").toBeNull();
    expect(prefixOf("---\nlista:\n- a\n---\n", 3), "frontmatter").toBeNull();
    expect(prefixOf("testo")).toBeNull();
    expect(prefixOf("#hashtag")).toBeNull();
  });
});

describe("con «mai», il cursore non entra nel prefisso", () => {
  it("un clic o una freccia che ci cadono portano all'inizio del testo", () => {
    const { view, head, cleanup } = mount("prima\n## Titolo", 0);
    try {
      view.dispatch({ selection: { anchor: 6 }, userEvent: "select" });
      expect(head()).toBe(9);
      view.dispatch({ selection: { anchor: 6 }, userEvent: "select.pointer" });
      expect(head()).toBe(9);
    } finally { cleanup(); }
  });

  it("← all'inizio del testo va alla riga prima, Home all'inizio del testo", () => {
    const { view, press, head, cleanup } = mount("prima\n- voce", 10);
    try {
      expect(press("Home")).toBe(true);
      expect(head()).toBe(8);
      cursorCharLeft(view);
      expect(head()).toBe(5);
    } finally { cleanup(); }
  });

  it("Backspace all'inizio del testo toglie il prefisso in una volta", () => {
    for (const [doc, at, after, cursor] of [
      ["## Titolo", 3, "Titolo", 0],
      ["- [ ] fare", 6, "fare", 0],
      ["> - voce", 4, "> voce", 2],
      ["1. prima", 3, "prima", 0],
    ] as const) {
      const { view, press, head, cleanup } = mount(doc, at);
      try {
        expect(press("Backspace")).toBe(true);
        expect(view.state.doc.toString()).toBe(after);
        expect(head()).toBe(cursor);
      } finally { cleanup(); }
    }
  });

  it("subito dopo una scorciatoia, Backspace la rende testo", () => {
    const { view, press, type, cleanup } = mount("", 0);
    try {
      type("#");
      type(" ");
      expect(press("Backspace")).toBe(true);
      expect(view.state.doc.toString()).toBe("\\# ");
      expect(view.state.selection.main.head).toBe(3);
    } finally { cleanup(); }
  });

  it("la scorciatoia di una casella dentro una voce rende testo soltanto la casella", () => {
    const { view, press, type, cleanup } = mount("- ", 2);
    try {
      type("[ ] ");
      expect(press("Backspace")).toBe(true);
      expect(view.state.doc.toString()).toBe("- \\[ ] ");
    } finally { cleanup(); }
  });

  it("in un file CRLF il prefisso si toglie allo stesso modo", () => {
    const { view, press, cleanup } = mount("a\r\n## Titolo", 5);
    try {
      expect(view.state.doc.line(2).text).toBe("## Titolo");
      expect(press("Backspace")).toBe(true);
      expect(view.state.doc.line(2).text).toBe("Titolo");
    } finally { cleanup(); }
  });
});

describe("con «elemento», la seconda Home entra nel prefisso", () => {
  it("prima l'inizio del testo, poi l'inizio della riga", () => {
    const { press, head, cleanup } = mount("## Titolo", 6, "elemento");
    try {
      press("Home");
      expect(head()).toBe(3);
      press("Home");
      expect(head()).toBe(0);
    } finally { cleanup(); }
  });
});
