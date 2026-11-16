import { closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab, undoDepth } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { obsidianKeymap } from "./profiles/markdown/commands";

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

/// Le viste testuali che si vedono nella shell, nell'ordine del DOM: quelle
/// delle schede messe da parte (`.pane-editor-riposo`, vedi `ParkedSurface` in
/// `state/document-controller.ts`) sono montate ma nascoste, e non contano.
export function mountedTextEditors(): EditorView[] {
  return shownEditorShells()
    .map((shell) => (shell.parentElement ? findTextEditor(shell.parentElement) : null))
    .filter((view): view is EditorView => view !== null);
}

function shownEditorShells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".cm-editor")].filter((shell) => !shell.closest(".pane-editor-riposo"));
}

/// Appende testo alla prima superficie testuale che si vede.
export function appendToTextEditor(text: string): void {
  const shell = shownEditorShells()[0];
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

/// La luce che la vista ha ricevuto per ultima: `true` se scura.
export function isDarkTheme(view: EditorView): boolean {
  return view.state.facet(EditorView.darkTheme);
}
