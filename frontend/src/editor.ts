// Editor markdown basato su CodeMirror 6.
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { byteToCharIndex } from "./offsets";

export interface Editor {
  setDoc(text: string): void;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento (es. l'inizio
  /// di un heading da `ViewUpdate::Reveal`). Converte al volo byte→code unit.
  revealByteOffset(byteOffset: number): void;
}

/// Crea l'editor. `onChange` è invocato a ogni modifica fatta dall'utente
/// (non quando impostiamo il documento a livello di programma).
export function createEditor(
  parent: HTMLElement,
  onChange: (text: string) => void,
): Editor {
  let programmatic = false;

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !programmatic) {
      onChange(u.state.doc.toString());
    }
  });

  const view = new EditorView({
    parent,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      markdown(),
      oneDark,
      EditorView.lineWrapping,
      listener,
    ],
  });

  return {
    setDoc(text: string) {
      programmatic = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
      programmatic = false;
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
    revealByteOffset(byteOffset: number) {
      const pos = Math.min(
        byteToCharIndex(view.state.doc.toString(), byteOffset),
        view.state.doc.length,
      );
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
      view.focus();
    },
  };
}
