// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditor, type Editor } from "./editor";

interface TestEditor {
  ed: Editor;
  view: () => EditorView;
}

function editor(): TestEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = createEditor(parent, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  return {
    ed,
    view: () => {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

describe("adapter dell'editor Markdown", () => {
  it("conserva la configurazione del profilo quando cambia documento", () => {
    // Lo stato nuovo si costruisce da capo, quindi la configurazione del
    // profilo deve ripartire da ciò che vale **adesso** e non dal default:
    // cambiare nota non deve riaccendere la resa inline.
    const { ed, view } = editor();
    ed.setLivePreview(false);
    const withoutPreview = view().state.facet(EditorView.decorations).length;
    ed.setDoc("altra nota");
    expect(view().state.facet(EditorView.decorations).length).toBe(withoutPreview);
    ed.setSyntaxForms([]);
    ed.setLivePreview(true);
    ed.destroy();
  });
});
