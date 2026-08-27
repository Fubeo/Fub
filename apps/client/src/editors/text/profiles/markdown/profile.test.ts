// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createTextEngine, type TextEngine } from "../../engine";
import { createMarkdownProfile, type MarkdownProfile } from "./profile";

function mounted(profile: MarkdownProfile): { engine: TextEngine; view: () => EditorView } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const engine = createTextEngine(parent, {
    onChange: () => {},
    onSelectionChange: () => {},
    extensions: () => profile.extensions(),
  });
  return {
    engine,
    view: () => {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

function decorationCount(view: EditorView): number {
  return view.dom.querySelectorAll("[class*='cm-fub-']").length;
}

function hasNode(state: EditorState, name: string): boolean {
  let found = false;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) found = true;
    },
  });
  return found;
}

function profile(searchNotes = async (_prefix: string) => [] as string[]): MarkdownProfile {
  return createMarkdownProfile({
    callbacks: { openWikilink: () => {}, searchTag: () => {} },
    completions: { searchNotes, listTags: async () => [] },
  });
}

describe("MarkdownProfile", () => {
  it("composes Markdown, live preview, commands, and completions", async () => {
    const searchNotes = vi.fn(async () => ["Alpha.md"]);
    const markdown = profile(searchNotes);
    const { engine, view } = mounted(markdown);
    const initial = view();

    engine.setDoc("**titolo**\n[[Al");
    initial.dispatch({ selection: EditorSelection.cursor(initial.state.doc.length) });
    expect(hasNode(initial.state, "StrongEmphasis")).toBe(true);

    const bold = initial.state
      .facet(keymap)
      .flat()
      .find((binding) => binding.key === "Mod-b");
    expect(bold).toBeDefined();
    if (!bold?.run) throw new Error("il comando grassetto non è montato");
    const runBold = bold.run;

    engine.setDoc("titolo");
    initial.dispatch({ selection: EditorSelection.range(0, 6) });
    expect(runBold(initial)).toBe(true);
    expect(engine.getDoc()).toBe("**titolo**");

    engine.setDoc("**titolo**\ncorpo");
    initial.dispatch({ selection: EditorSelection.cursor(initial.state.doc.length) });
    expect(decorationCount(initial)).toBeGreaterThan(0);

    initial.dispatch({
      changes: { from: initial.state.doc.length, insert: "!" },
      userEvent: "input.type",
    });
    const edited = engine.getDoc();
    markdown.setLivePreview(false);
    engine.reconfigure();

    expect(view()).toBe(initial);
    expect(engine.getDoc()).toBe(edited);
    expect(decorationCount(initial)).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe("**titolo**\ncorpo");

    engine.setDoc("[[Al");
    initial.dispatch({ selection: EditorSelection.cursor(initial.state.doc.length) });
    expect(startCompletion(initial)).toBe(true);
    await vi.waitFor(() => {
      expect(searchNotes).toHaveBeenCalledWith("Al");
      expect(currentCompletions(initial.state).map((option) => option.label)).toContain("Alpha");
    });

    engine.destroy();
  });

  it("reconfigures declared syntax without replacing document or history", () => {
    const markdown = profile();
    const { engine, view } = mounted(markdown);
    const initial = view();
    const customForm = {
      name: "fub:custom-highlight",
      trigger: { inline: { open: "@@", close: "@@" } },
    } as const;

    engine.setDoc("@@evidenza@@\ncorpo");
    initial.dispatch({ selection: EditorSelection.cursor(initial.state.doc.length) });
    expect(decorationCount(initial)).toBe(0);

    initial.dispatch({
      changes: { from: initial.state.doc.length, insert: "!" },
      userEvent: "input.type",
    });
    const documentBefore = initial.state.doc;

    markdown.setSyntaxForms([customForm]);
    engine.reconfigure();

    expect(view()).toBe(initial);
    expect(initial.state.doc).toBe(documentBefore);
    expect(decorationCount(initial)).toBeGreaterThan(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe("@@evidenza@@\ncorpo");

    engine.destroy();
  });
});
