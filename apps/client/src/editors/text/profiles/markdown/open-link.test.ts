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

  it("legge parentesi bilanciate, riferimenti e destinazioni fra parentesi angolari (D14)", () => {
    expect(linkAt(state("[wiki](https://en.wikipedia.org/wiki/Function_(mathematics))"), 2))
      .toEqual({ kind: "url", href: "https://en.wikipedia.org/wiki/Function_(mathematics)" });
    expect(linkAt(state("[Guida][g]\n\n[g]: https://example.com"), 2)).toEqual({ kind: "url", href: "https://example.com" });
    expect(linkAt(state("[g]\n\n[G]: <https://example.com/b> \"t\""), 1)).toEqual({ kind: "url", href: "https://example.com/b" });
    expect(linkAt(state("[Documento](<La mia nota.md>)"), 3)).toEqual({ kind: "url", href: "La mia nota.md" });
    expect(linkAt(state("![alt](img/a\\(1\\).png \"t\")"), 3)).toEqual({ kind: "url", href: "img/a(1).png" });
    expect(linkAt(state("[senza][nessuno]"), 2)).toBeNull();
    expect(linkAt(state("nota[^1]\n\n[^1]: testo"), 6)).toBeNull();
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
    const openPath = vi.fn();
    const profile = createMarkdownProfile({
      callbacks: { openWikilink, searchTag: () => {}, openPath },
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
    return { view, openWikilink, openPath, press, dispose: () => { engine.destroy(); host.remove(); } };
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

  it("un'ancora porta il cursore al titolo, un percorso relativo apre il documento (D15)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const anchor = editor("[Vai](#seconda-parte)\n\n# Prima\n\n# Seconda parte\n", 2);
    expect(anchor.press()).toBe(true);
    // Con «mai» il cursore non sta nei `#`: arriva al testo del titolo.
    expect(anchor.view.state.selection.main.head).toBe(anchor.view.state.doc.toString().indexOf("Seconda parte"));
    anchor.dispose();
    const missing = editor("[Vai](#altrove)\n\n# Prima\n", 2);
    expect(missing.press()).toBe(false);
    missing.dispose();
    const relative = editor("[Capitolo](../capitoli/Uno%20due.md)", 2);
    expect(relative.press()).toBe(true);
    expect(relative.openPath).toHaveBeenCalledWith("../capitoli/Uno due.md");
    relative.dispose();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("fuori da un link non fa nulla", () => {
    const e = editor("testo semplice", 3);
    e.press();
    expect(e.openWikilink).not.toHaveBeenCalled();
    e.dispose();
  });
});
