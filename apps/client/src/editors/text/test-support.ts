import { closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab, undoDepth } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { obsidianKeymap } from "../../editor/editor-commands";

/// Recupera la vista montata nel contenitore di una superficie testuale.
export function findTextEditor(parent: HTMLElement): EditorView | null {
  return EditorView.findFromDOM(parent);
}

/// Recupera la vista montata o fallisce con lo stesso errore dei test esistenti.
export function findTextEditorOrThrow(parent: HTMLElement): EditorView {
  const view = findTextEditor(parent);
  if (!view) throw new Error("l'editor non è montato");
  return view;
}

/// Restituisce le viste testuali presenti nella shell, nell'ordine del DOM.
export function mountedTextEditors(): EditorView[] {
  return [...document.querySelectorAll<HTMLElement>(".cm-editor")]
    .map((shell) => (shell.parentElement ? findTextEditor(shell.parentElement) : null))
    .filter((view): view is EditorView => view !== null);
}

/// Appende testo alla prima superficie testuale montata.
export function appendToTextEditor(text: string): void {
  const shell = document.querySelector<HTMLElement>(".cm-editor");
  const view = shell?.parentElement ? findTextEditor(shell.parentElement) : null;
  if (!view) throw new Error("l'editor non è montato");
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
}

/// Keymap montata dal motore testuale, esposta ai banchi che verificano la
/// precedenza fra accordi della shell e accordi dell'editor.
export const editorKeymap: readonly KeyBinding[] = [
  ...obsidianKeymap,
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...searchKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...completionKeymap,
  ...lintKeymap,
  indentWithTab,
];

/// Espone ai test della shell la profondità della cronologia senza far
/// attraversare il confine CodeMirror al codice della shell.
export { undoDepth };
