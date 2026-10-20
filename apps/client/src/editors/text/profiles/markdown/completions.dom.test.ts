// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { markdownCompletions } from "./completions";
import { markdownGrammar } from "./grammar";

function editor() {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      markdownCompletions({
        searchNotes: async () => [],
        listTags: async () => [{ name: "progetti/fub/alfa", count: 1 }],
      }),
    ],
  });
  const view = EditorView.findFromDOM(parent)!;
  return { engine, view };
}

function tab(view: EditorView): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
}

async function popup(view: EditorView): Promise<void> {
  startCompletion(view);
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
}

describe("Tab nel completamento dei tag", () => {
  it("completa un segmento alla volta e tiene aperto il popup; senza popup rientra", async () => {
    const { engine, view } = editor();
    try {
      engine.setDoc("nota #pro");
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      await popup(view);
      tab(view);
      expect(engine.getDoc()).toBe("nota #progetti/");
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
      tab(view);
      expect(engine.getDoc()).toBe("nota #progetti/fub/");
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      tab(view);
      expect(engine.getDoc()).toBe("nota #progetti/fub/alfa");
      expect(completionStatus(view.state)).toBeNull();
      engine.setDoc("riga");
      view.dispatch({ selection: EditorSelection.cursor(0) });
      tab(view);
      expect(engine.getDoc()).not.toBe("riga");
      expect(engine.getDoc().trim()).toBe("riga");
    } finally {
      engine.destroy();
    }
  });
});
