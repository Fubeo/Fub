// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// La prova del rinvio di `selectionchange` in `src/test-setup.ts`: senza, happy-dom
// manda l'evento dentro l'update di una vista CodeMirror a fuoco, e la vista
// rientra nel suo update (PR #421).

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("selectionchange nel banco di prova", () => {
  it("arriva dopo il codice che ha cambiato la selezione, una volta sola", async () => {
    const text = document.createElement("p");
    text.textContent = "abc";
    document.body.append(text);
    let seen = 0;
    const count = () => (seen += 1);
    document.addEventListener("selectionchange", count);
    try {
      document.getSelection()!.collapse(text.firstChild, 1);
      document.getSelection()!.collapse(text.firstChild, 2);
      expect(seen).toBe(0);
      await Promise.resolve();
      expect(seen).toBe(1);
    } finally {
      document.removeEventListener("selectionchange", count);
    }
  });

  it("una vista a fuoco che sposta la selezione non rientra nel suo update", async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
    window.addEventListener("error", onError);
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "Il testo della nota." }), parent });
    views.push(view);
    try {
      view.focus();
      expect(view.hasFocus).toBe(true);
      expect(() => view.dispatch({ selection: { anchor: 3 } })).not.toThrow();
      expect(() => view.dispatch({ selection: { anchor: 8, head: 12 } })).not.toThrow();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(errors).toEqual([]);
      expect(view.state.selection.main.anchor).toBe(8);
      expect(view.state.selection.main.head).toBe(12);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});
