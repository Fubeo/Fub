// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { createTextEngine } from "../../engine";
import { createMarkdownProfile } from "./profile";
import { markdownGrammar } from "./grammar";
import { linkAt } from "./open-link";

const state = (doc: string) =>
  EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) });

describe("linkAt", () => {
  it("trova il wikilink con sezione e blocco sotto il cursore", () => {
    const s = state("vedi [[Nota#Sezione|alias]] e [[Altra^b1]]");
    expect(linkAt(s, 8)).toEqual({ kind: "wikilink", page: "Nota", heading: "Sezione", block: null });
    expect(linkAt(s, 34)).toEqual({ kind: "wikilink", page: "Altra", heading: null, block: "b1" });
    expect(linkAt(s, 2)).toBeNull();
  });

  it("trova link Markdown, autolink e indirizzi nudi, senza la punteggiatura della frase", () => {
    expect(linkAt(state("un [sito](https://a.it/x) qui"), 5)).toEqual({ kind: "url", href: "https://a.it/x" });
    expect(linkAt(state("<https://b.it>"), 3)).toEqual({ kind: "url", href: "https://b.it" });
    expect(linkAt(state("vai su https://c.it/p."), 12)).toEqual({ kind: "url", href: "https://c.it/p" });
  });

  it("dentro il codice non c'è link da aprire", () => {
    expect(linkAt(state("`[[Nota]]`"), 4)).toBeNull();
    expect(linkAt(state("```\nhttps://a.it\n```"), 8)).toBeNull();
  });
});

describe("Alt-Invio", () => {
  function editor(doc: string, cursor: number) {
    const host = document.createElement("div");
    document.body.append(host);
    const openWikilink = vi.fn();
    const profile = createMarkdownProfile({
      callbacks: { openWikilink, searchTag: () => {} },
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
    const engine = createTextEngine(host, {
      onChange: () => {},
      onSelectionChange: () => {},
      extensions: () => profile.extensions(),
    });
    engine.setDoc(doc);
    const view = EditorView.findFromDOM(host)!;
    view.dispatch({ selection: { anchor: cursor } });
    const press = () =>
      runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter", altKey: true }), "editor");
    return { view, openWikilink, press, dispose: () => { engine.destroy(); host.remove(); } };
  }

  it("apre il wikilink con il punto che nomina", () => {
    const e = editor("vedi [[Nota#Sezione]]", 9);
    expect(e.press()).toBe(true);
    expect(e.openWikilink).toHaveBeenCalledWith("Nota", "Sezione", null);
    expect(e.view.state.doc.toString()).toBe("vedi [[Nota#Sezione]]");
    e.dispose();
  });

  it("apre un indirizzo permesso e lascia stare quelli vietati", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const ok = editor("[a](https://a.it)", 1);
    expect(ok.press()).toBe(true);
    expect(open).toHaveBeenCalledWith("https://a.it", "_blank", "noopener,noreferrer");
    ok.dispose();
    open.mockClear();
    const bad = editor("[a](javascript:alert(1))", 1);
    bad.press();
    expect(open).not.toHaveBeenCalled();
    bad.dispose();
    open.mockRestore();
  });

  it("fuori da un link non fa nulla", () => {
    const e = editor("testo semplice", 3);
    e.press();
    expect(e.openWikilink).not.toHaveBeenCalled();
    e.dispose();
  });
});
