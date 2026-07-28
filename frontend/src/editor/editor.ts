// Editor markdown basato su CodeMirror 6, con l'esperienza in-editor di
// Obsidian (todo.md §6): comandi e scorciatoie (`editor-commands.ts`),
// autocompletamento di wikilink e tag (`completions.ts`), live preview dal
// tree Lezer (`livepreview.ts`). I tre moduli sono autonomi e ricevono i
// collegamenti col mondo (aprire una nota, cercare un tag, le sorgenti dei
// completamenti) da chi crea l'editor: qui si compone, non si decide.
import { EditorView, keymap } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { temaEditor } from "./theme";
import { temaCorrente, type Tema } from "../theme/theme";
import { byteToCharIndex, charToByteIndex } from "../rules/offsets";
import { editingExtensions } from "./editor-commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview } from "./livepreview";

/// La selezione dell'editor come la capisce il kernel: **byte UTF-8** del
/// buffer, più il testo che ci sta dentro (vuoto = cursore). È metà di
/// `ViewContext.selection`; l'altra metà — se lo span sia vero anche per il
/// sorgente salvato — la sa solo chi conosce lo stato del buffer, cioè la shell.
export interface EditorSelection {
  start: number;
  end: number;
  text: string;
}

export interface Editor {
  setDoc(text: string): void;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento (es. l'inizio
  /// di un heading da `ViewUpdate::Reveal`). Converte al volo byte→code unit.
  revealByteOffset(byteOffset: number): void;
  /// La selezione corrente in byte UTF-8 (il ponte inverso, `offsets.ts`).
  selection(): EditorSelection;
  /// Accende o spegne la resa inline: è la differenza fra la modalità Live
  /// Preview e la modalità Sorgente (FEATURES 4.1).
  setLivePreview(on: boolean): void;
  /// Passa all'altra luce (§12.4).
  ///
  /// I **colori** non passano di qui — sono `var(--…)` e li cambia il CSS da
  /// solo, senza che l'editor lo sappia (`editor/theme.ts`). Passa di qui la
  /// sola cosa che il CSS non può dire a CodeMirror: in che luce si trova, che
  /// è un booleano nella sua configurazione.
  setTheme(tema: Tema): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente (non quando impostiamo il
  /// documento a livello di programma).
  onChange(text: string): void;
  /// Invocato quando cambia la selezione (cursore compreso), anche senza
  /// modifiche al testo: è ciò che la shell pubblica come contesto di sessione.
  onSelectionChange(): void;
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

  // La resa inline sta in un compartment perché la modalità Sorgente è
  // esattamente "quella stessa configurazione, senza questa estensione": si
  // riconfigura a caldo, senza ricostruire l'editor e senza perdere né
  // documento né cronologia di undo.
  const preview = new Compartment();

  // Il tema sta in un compartment per la stessa ragione della resa inline: si
  // cambia luce a caldo, senza ricostruire l'editor e quindi senza perdere né
  // il documento né la cronologia di undo. Il tema nasce con quello che la
  // pagina sta già portando — `theme/theme.ts` lo scrive sulla radice prima che
  // questa funzione venga chiamata — e non con un default cablato, che sarebbe
  // un lampo di scuro a ogni nota aperta in tema chiaro.
  const tema = new Compartment();

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !programmatic) {
      opts.onChange(u.state.doc.toString());
    }
    // Anche una modifica sposta il cursore: chi ascolta vuole saperlo in
    // entrambi i casi, e un `setDoc` a livello di programma rimappa la
    // selezione, quindi conta pure lui.
    if (u.selectionSet || u.docChanged) {
      opts.onSelectionChange();
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
      tema.of(temaEditor(temaCorrente())),
      EditorView.lineWrapping,
      preview.of(
        livePreview({
          openWikilink: opts.onOpenWikilink,
          searchTag: opts.onSearchTag,
        }),
      ),
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
    selection() {
      const text = view.state.doc.toString();
      const { from, to } = view.state.selection.main;
      return {
        start: charToByteIndex(text, from),
        end: charToByteIndex(text, to),
        text: text.slice(from, to),
      };
    },
    setLivePreview(on: boolean) {
      view.dispatch({
        effects: preview.reconfigure(
          on
            ? livePreview({
                openWikilink: opts.onOpenWikilink,
                searchTag: opts.onSearchTag,
              })
            : [],
        ),
      });
    },
    setTheme(next: Tema) {
      view.dispatch({ effects: tema.reconfigure(temaEditor(next)) });
    },
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
