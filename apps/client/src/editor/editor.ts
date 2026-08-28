// Compatibilità per l'editor Markdown corrente: la meccanica vive in
// `TextEngine`, mentre qui resta soltanto la configurazione del profilo.
import { currentTheme as getCurrentTheme, type Theme } from "../theme/theme";
import { createMarkdownProfile } from "../editors/text/profiles/markdown/profile";
import type { CompletionSources } from "./completions";
import { createTextEngine } from "../editors/text/engine";
import type { DocumentUpdate, EditorChange, EditorSelections } from "../editors/text/engine";
import type { SyntaxForm } from "../host/contract";

export type {
  DocumentUpdate,
  EditorChange,
  EditorChangeOrigin,
  EditorRange,
  EditorSelections,
} from "../editors/text/engine";

export interface Editor {
  /// Aggiorna la dichiarazione sintattica letta dal canale runtime.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  /// Mette nell'editor un testo che **l'utente non ha scritto**.
  setDoc(text: string): void;
  /// Porta l'editor su un testo scritto da un'altra superficie.
  syncDoc(update: DocumentUpdate | string): void;
  undo(): boolean;
  redo(): boolean;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento.
  revealByteOffset(byteOffset: number): void;
  /// Le selezioni correnti in byte UTF-8.
  selections(): EditorSelections;
  /// Accende o spegne la resa inline.
  setLivePreview(on: boolean): void;
  /// Accende o spegne il blocco degli input utente senza ricostruire la vista.
  setReadOnly(readOnly: boolean): void;
  /// Smonta l'editor e rilascia la vista e i suoi ascoltatori.
  destroy(): void;
  /// Passa all'altra luce.
  setTheme(theme: Theme): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente.
  onChange(change: EditorChange): void;
  /// Invocato quando cambia la selezione.
  onSelectionChange(): void;
  /// Mod-click su un wikilink nella vivi preview.
  onOpenWikilink(page: string, heading: string | null, block: string | null): void;
  /// Click su un `#tag` nella vivi preview.
  onSearchTag(tag: string): void;
  /// Sorgenti per i completamenti del profilo Markdown.
  completions: CompletionSources;
}

/// Costruisce l'adapter compatibile con i chiamanti esistenti.
export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  const profile = createMarkdownProfile({
    callbacks: {
      openWikilink: opts.onOpenWikilink,
      searchTag: opts.onSearchTag,
    },
    completions: opts.completions,
  });
  const engine = createTextEngine(parent, {
    onChange: opts.onChange,
    onSelectionChange: opts.onSelectionChange,
    theme: getCurrentTheme(),
    extensions: () => profile.extensions(),
  });

  return {
    setSyntaxForms(forms) {
      profile.setSyntaxForms(forms);
      engine.reconfigure();
    },
    setDoc: (text) => engine.setDoc(text),
    syncDoc: (update) => engine.syncDoc(update),
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    getDoc: () => engine.getDoc(),
    focus: () => engine.focus(),
    revealByteOffset: (byteOffset) => engine.revealByteOffset(byteOffset),
    selections: () => engine.selections(),
    setLivePreview(on) {
      profile.setLivePreview(on);
      engine.reconfigure();
    },
    setReadOnly: (readOnly) => engine.setReadOnly(readOnly),
    destroy: () => engine.destroy(),
    setTheme: (theme) => engine.setTheme(theme),
  };
}
