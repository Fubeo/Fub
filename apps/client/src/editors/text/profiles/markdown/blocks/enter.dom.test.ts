// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { blocksMode, plainMode } from "./index";
import { parsedView } from "../test-support";

// Invio coi blocchi: dentro un paragrafo ne apre uno nuovo, così Esc e
// Backspace toccano un paragrafo solo e non tutte le righe scritte (IMP-6106).

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, anchor = 0, notify = vi.fn(), extra: Extension = []): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [history(), markdown({ base: markdownGrammar }), blocksMode({ page: () => "Nota", notify }), extra],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string, extra: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...extra }), "editor");


describe("Invio coi blocchi (IMP-6106)", () => {
  const chosen = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

  it("Invio in fondo a un paragrafo ne apre uno nuovo: Esc e Backspace lì toccano solo lui, Ctrl+Z lo riporta", () => {
    const view = mount("Paragrafo uno.", 14);
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("Paragrafo uno.\n\n");
    view.dispatch(view.state.replaceSelection("Paragrafo due da cancellare."));
    expect(press(view, "Escape")).toBe(true);
    expect(chosen(view)).toBe("Paragrafo due da cancellare.");
    press(view, "Backspace");
    expect(view.state.doc.toString()).toBe("Paragrafo uno.");
    undo(view);
    expect(view.state.doc.toString()).toBe("Paragrafo uno.\n\nParagrafo due da cancellare.");
  });

  it("in mezzo al testo spezza il paragrafo in due, e Backspace all'inizio del secondo li riunisce", () => {
    const view = mount("Primo\n\nUnodue\n\nUltimo", 10);
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("Primo\n\nUno\n\ndue\n\nUltimo");
    expect(view.state.selection.main.head).toBe(12);
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe("Primo\n\nUnodue\n\nUltimo");
    expect(view.state.selection.main.head).toBe(10);
  });

  it("Backspace subito dopo Invio torna in fondo al paragrafo, in un passo", () => {
    const view = mount("Uno\n\nDue", 3);
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("Uno\n\n\n\nDue");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe("Uno\n\nDue");
    expect(view.state.selection.main.head).toBe(3);
  });

  it("Maiusc+Invio resta un a capo nel paragrafo, ed Esc ne sceglie tutte le righe", () => {
    const view = mount("Riga uno", 8);
    expect(press(view, "Enter", { shiftKey: true })).toBe(false);
    const lines = mount("Riga uno\nRiga due", 17);
    expect(press(lines, "Escape")).toBe(true);
    expect(chosen(lines)).toBe("Riga uno\nRiga due");
  });

  it("fuori da un paragrafo, o con un a capo voluto, Invio resta quello di sempre", () => {
    for (const [doc, at] of [
      ["| a | b |", 9],
      ["- voce", 6],
      ["```js\ncodice", 12],
      ["# Titolo", 8],
      ["> citazione", 11],
      ["riga forzata\\", 13],
      ["riga forzata  ", 14],
      ["Uno\n\n", 5],
    ] as const) {
      // Elenchi e citazioni hanno il loro Invio (`smartListEnter` e simili):
      // qui conta soltanto che non sia lo stacco di paragrafo dei blocchi.
      const view = mount(doc, at);
      press(view, "Enter");
      expect(view.state.doc.toString(), doc).not.toBe(`${doc.slice(0, at)}\n\n${doc.slice(at)}`);
    }
    const many = mount("Uno\n\nDue", 3, vi.fn(), EditorState.allowMultipleSelections.of(true));
    many.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(8)]) });
    expect(press(many, "Enter")).toBe(false);
    const ranged = mount("Uno due", 0);
    ranged.dispatch({ selection: EditorSelection.single(0, 3) });
    expect(press(ranged, "Enter")).toBe(false);
  });

  it("coi blocchi spenti Invio è l'a capo dell'editor di testo", () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "Uno", selection: { anchor: 3 }, extensions: [markdown({ base: markdownGrammar }), plainMode()] }),
    });
    views.push(view);
    expect(press(view, "Enter")).toBe(false);
  });
});
