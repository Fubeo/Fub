// @vitest-environment happy-dom
import {
  closeCompletion,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { bootstrapSurfaceRegistry } from "../bootstrap";
import type { MarkdownEditorSurface } from "./factories";

function mountContext(parent: HTMLElement = document.createElement("section")) {
  return { paneId: "pane-1", documentId: "document-1", parent };
}

describe("bootstrap del registro delle superfici", () => {
  it("consegna alla factory Markdown configurata i servizi della composizione", async () => {
    const openWikilink = vi.fn();
    const searchTag = vi.fn();
    const searchNotes = vi.fn(async () => ["Alpha.md"]);
    const listTags = vi.fn(async () => [{ name: "beta", count: 1 }]);
    const surfaces = bootstrapSurfaceRegistry({
      markdown: {
        callbacks: { openWikilink, searchTag },
        completions: { searchNotes, listTags },
      },
    });
    const parent = document.createElement("section");

    try {
      const markdown = surfaces.registry.mount(
        { formatKey: "md" },
        mountContext(parent),
      ).surface as MarkdownEditorSurface;
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("la superficie Markdown non è montata");

      markdown.setDoc("[[Al");
      view.dispatch({ selection: EditorSelection.cursor(markdown.currentText().length) });
      expect(startCompletion(view)).toBe(true);
      await vi.waitFor(() => {
        expect(searchNotes).toHaveBeenCalledWith("Al");
        expect(currentCompletions(view.state).map((option) => option.label)).toContain("Alpha");
      });
      closeCompletion(view);

      markdown.setDoc("nota #be");
      view.dispatch({ selection: EditorSelection.cursor(markdown.currentText().length) });
      expect(startCompletion(view)).toBe(true);
      await vi.waitFor(() => {
        expect(listTags).toHaveBeenCalled();
        expect(currentCompletions(view.state).map((option) => option.label)).toContain("#beta");
      });

      markdown.setDoc("[[Alpha]] #beta\ncursor");
      view.dispatch({ selection: EditorSelection.cursor(markdown.currentText().length) });
      const wikilink = parent.querySelector<HTMLElement>(".cm-fub-wikilink");
      const tag = parent.querySelector<HTMLElement>(".cm-fub-tag");
      expect(wikilink).not.toBeNull();
      expect(tag).not.toBeNull();
      wikilink?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: true }),
      );
      tag?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      expect(openWikilink).toHaveBeenCalledWith("Alpha", null, null);
      expect(searchTag).toHaveBeenCalledWith("beta");
    } finally {
      surfaces.dispose();
    }
  });
});
