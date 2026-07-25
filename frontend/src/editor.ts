// Editor markdown basato su CodeMirror 6, con l'esperienza in-editor di
// Obsidian (todo.md §6): comandi e scorciatoie (`editor-commands.ts`),
// autocompletamento di wikilink e tag (`completions.ts`), live preview dal
// tree Lezer (`livepreview.ts`). I tre moduli sono autonomi e ricevono i
// collegamenti col mondo (aprire una nota, cercare un tag, le sorgenti dei
// completamenti) da chi crea l'editor: qui si compone, non si decide.
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { byteToCharIndex } from "./offsets";
import { editingExtensions } from "./editor-commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview } from "./livepreview";

export interface Editor {
  setDoc(text: string): void;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento (es. l'inizio
  /// di un heading da `ViewUpdate::Reveal`). Converte al volo byte→code unit.
  revealByteOffset(byteOffset: number): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente (non quando impostiamo il
  /// documento a livello di programma).
  onChange(text: string): void;
  /// Mod-click su un wikilink nella live preview: `page` è la pagina nuda,
  /// senza alias né `#heading` (stringa vuota per i link interni `[[#…]]`).
  onOpenWikilink(page: string): void;
  /// Click su un `#tag` nella live preview: `tag` è il nome senza `#`.
  onSearchTag(tag: string): void;
  /// Da dove arrivano i completamenti di `[[` e `#`: la shell passa l'IPC,
  /// i test passano liste finte.
  completions: CompletionSources;
}

/// Crea l'editor.
export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  let programmatic = false;

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !programmatic) {
      opts.onChange(u.state.doc.toString());
    }
  });

  const view = new EditorView({
    parent,
    extensions: [
      // Le scorciatoie di editing sono già in `Prec.high`: l'ordine rispetto
      // a `basicSetup` non conta, ma il popup dei completamenti (precedenza
      // massima) vince comunque su Enter/frecce quando è aperto.
      editingExtensions(),
      basicSetup,
      keymap.of([indentWithTab]),
      // La base GFM non è un dettaglio: senza, il parser non produce i nodi
      // di `~~barrato~~`/tabelle/todo e la live preview degrada in silenzio.
      markdown({ base: markdownLanguage }),
      oneDark,
      EditorView.lineWrapping,
      livePreview({
        openWikilink: opts.onOpenWikilink,
        searchTag: opts.onSearchTag,
      }),
      markdownCompletions(opts.completions),
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
