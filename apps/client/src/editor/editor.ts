// Editor markdown basato su CodeMirror 6, con l'esperienza in-editor di
// Obsidian (todo.md §6): comandi e scorciatoie (`editor-commands.ts`),
// autocompletamento di wikilink e tag (`completions.ts`), vivi preview dal
// tree Lezer (`livepreview.ts`). I tre moduli sono autonomi e ricevono i
// collegamenti col mondo (aprire una nota, cercare un tag, le sorgenti dei
// completamenti) da chi crea l'editor: qui si compone, non si decide.
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { currentTheme as getCurrentTheme, type Theme } from "../theme/theme";
import { byteToCharIndex, charToByteIndices } from "../rules/offsets";
import { editingExtensions } from "./editor-commands";
import { editorTheme } from "./theme";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview } from "./livepreview";
import {
  LocalHistory,
  operationFromText,
  tryApplyOperation,
  type HistoryGrouping,
  type SelectionSnapshot,
  type TextEdit,
  type TextOperation,
} from "./local-history";
import type { SyntaxForm } from "../host/contract";

/// Una selezione dell'editor come la capisce il kernel: **byte UTF-8** del
/// buffer, più il testo che ci sta dentro (vuoto = cursore).
export interface EditorRange {
  start: number;
  end: number;
  text: string;
}

/// Tutte le selezioni dell'editor, con la **primaria** distinta.
///
/// La primaria è `state.selection.main`, cioè `ranges[mainIndex]`: non è la
/// prima della lista, ed è di norma l'ultima aggiunta. Pubblicarla come «la
/// prima» sarebbe stata una conversione che la perde, ed è la ragione per cui
/// di là dal confine è un campo (decisione 0093).
///
/// È metà di `ViewContext.selections`; l'altra metà — se le coordinate siano
/// vere anche per il sorgente salvato — la sa solo chi conosce lo stato del
/// buffer, cioè la shell.
export interface EditorSelections {
  primary: EditorRange;
  /// Le altre, in ordine di posizione (CodeMirror tiene `ranges` ordinato).
  secondary: EditorRange[];
}

export type EditorChangeOrigin = "input" | "undo" | "redo";

export interface EditorChange {
  readonly text: string;
  readonly operation: TextOperation;
  readonly origin: EditorChangeOrigin;
}

export interface DocumentUpdate {
  readonly text: string;
  readonly operation: TextOperation | null;
}

export interface Editor {
  /// Aggiorna la dichiarazione sintattica letta dal canale runtime.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  /// Mette nell'editor un testo che **l'utente non ha scritto**: un'altra nota,
  /// il vuoto della chiusura, il file riletto dal disco dopo che qualcun altro
  /// lo ha cambiato.
  ///
  /// Azzera la cronologia di annullamento, e non è un di più (§13.3). Finché
  /// era un `dispatch` di `changes` normali, quelle modifiche entravano nella
  /// history di `basicSetup` come qualunque battuta di tastiera: un Ctrl-Z dopo
  /// un cambio nota **riscriveva nel documento aperto il testo del
  /// precedente**, e il salvataggio automatico lo persisteva. Marcare il solo
  /// dispatch come non annullabile non basterebbe — resterebbero in pila le
  /// modifiche *dell'altra nota*, applicabili a questa.
  ///
  /// La cronologia del testo è per-documento perché il documento è il suo
  /// soggetto: la pila delle **operazioni** è un'altra cosa, sta nel kernel e
  /// non passa di qui (vedi la 0045).
  setDoc(text: string): void;
  /// Porta l'editor su un testo che ha scritto **un altro editor sullo stesso
  /// documento** — la stessa nota aperta in due riquadri (§1.2).
  ///
  /// Non è `setDoc`, e la differenza è tutta nelle due cose che qui non devono
  /// succedere. La prima: il cursore di chi guarda non si muove. `setDoc`
  /// ricostruisce lo stato e riporta il cursore a zero, che su un riquadro in
  /// cui non si sta scrivendo è un salto senza causa visibile; qui si applica la
  /// **modifica minima** — prefisso e suffisso comuni — e CodeMirror rimappa la
  /// selezione da sé, come fa per ogni altra modifica.
  ///
  /// La seconda: la modifica **non entra nella pila di undo** di questo editor.
  /// È la regola della 0045 vista da un'altra angolazione — le pile non si
  /// fondono: un Ctrl-Z qui deve disfare ciò che si è scritto *qui*, non ciò che
  /// ha scritto l'altro riquadro. Chi ha scritto ha la sua pila e se lo disfa da
  /// sé, e la disfatta arriva di qua per questa stessa via.
  ///
  /// Chiamarla con un testo identico a quello che c'è non fa niente: è il caso
  /// normale — l'eco del proprio salvataggio — e costa un confronto.
  syncDoc(update: DocumentUpdate | string): void;
  undo(): boolean;
  redo(): boolean;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento (es. l'inizio
  /// di un heading da `ViewUpdate::Reveal`). Converte al volo byte→code unit.
  revealByteOffset(byteOffset: number): void;
  /// Le selezioni correnti in byte UTF-8 (il ponte inverso, `offsets.ts`).
  selections(): EditorSelections;
  /// Accende o spegne la resa inline: è la differenza fra la modalità Live
  /// Preview e la modalità Sorgente (FEATURES 4.1).
  setLivePreview(on: boolean): void;
  /// Smonta l'editor: la vista di CodeMirror, i suoi ascoltatori, i suoi
  /// osservatori del DOM.
  ///
  /// Serve perché un riquadro **si chiude** (§1.2): `costruisciStruttura` in
  /// `panels/document.ts` toglie dalla mappa i riquadri che il layout non
  /// nomina più e ne stacca la radice dal documento. Togliere il nodo non è
  /// distruggere la vista: un `EditorView` tiene un `MutationObserver` sul
  /// proprio DOM, un `ResizeObserver`, e degli ascoltatori sulla finestra per
  /// sapere quando rimisurarsi — nessuno dei tre se ne va perché un antenato è
  /// stato staccato. Ogni divisione chiusa ne lasciava dietro uno, e il modo
  /// per accorgersene era usare l'app per un pomeriggio.
  ///
  /// Non è la stessa cosa di una `Lifetime` (`ui/lifetime.ts`), ed è la ragione per cui
  /// è un metodo qui: ciò che si perde non è un ascoltatore che questo file ha
  /// registrato, è un oggetto di una libreria che sa smontarsi da sé. Chi ha
  /// una `Lifetime` lo affida a lei con `vita.aggiungi(editor.destroy)`.
  destroy(): void;
  /// Passa all'altra luce (§12.4).
  ///
  /// I **colori** non passano di qui — sono `var(--…)` e li cambia il CSS da
  /// solo, senza che l'editor lo sappia (`editor/theme.ts`). Passa di qui la
  /// sola cosa che il CSS non può dire a CodeMirror: in che luce si trova, che
  /// è un booleano nella sua configurazione.
  setTheme(theme: Theme): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente (non quando impostiamo il
  /// documento a livello di programma).
  onChange(change: EditorChange): void;
  /// Invocato quando cambia la selezione (cursore compreso), anche senza
  /// modifiche al testo: è ciò che la shell pubblica come contesto di sessione.
  onSelectionChange(): void;
  /// Mod-click su un wikilink nella vivi preview: `page` è la pagina nuda,
  /// senza alias né `#heading` (stringa vuota per i legame interni `[[#…]]`).
  onOpenWikilink(page: string, heading: string | null, block: string | null): void;
  /// Click su un `#tag` nella vivi preview: `tag` è il nome senza `#`.
  onSearchTag(tag: string): void;
  /// Da dove arrivano i completamenti di `[[` e `#`: la shell passa l'IPC,
  /// i test passano liste finte.
  completions: CompletionSources;
}

/// Crea l'editor.
export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  type ApplyOrigin = "user" | "sync" | "undo" | "redo" | "replace";

  const preview = new Compartment();
  const theme = new Compartment();
  const originAnnotation = Annotation.define<ApplyOrigin>();
  const localHistory = new LocalHistory();
  let applyOrigin: ApplyOrigin = "user";
  let pendingDecision:
    | { readonly kind: "apply"; readonly token: number; readonly operation: TextOperation }
    | undefined;
  let disposed = false;
  let previewOn = true;
  let syntaxForms: readonly SyntaxForm[] | undefined;
  let currentTheme: Theme = getCurrentTheme();
  let view: EditorView;

  const livePreviewExtension = () =>
    livePreview(
      {
        openWikilink: opts.onOpenWikilink,
        searchTag: opts.onSearchTag,
      },
      syntaxForms,
    );

  const rendered = (state: EditorState = view.state): string =>
    state.doc.sliceString(0, state.doc.length, state.lineBreak);

  const renderedOffset = (pos: number): number =>
    view.state.lineBreak === "\n" ? pos : pos + view.state.doc.lineAt(pos).number - 1;

  const lineSeparator = (text: string): string | null =>
    text.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : null;

  const selectionSnapshot = (selection: EditorSelection): SelectionSnapshot => ({
    ranges: selection.ranges.map((range) => ({ from: range.from, to: range.to })),
    mainIndex: selection.mainIndex,
  });

  const selectionFromSnapshot = (
    selection: SelectionSnapshot,
    documentLength: number,
  ): EditorSelection => {
    const ranges = selection.ranges.map((range) => {
      const from = Math.max(0, Math.min(documentLength, range.from));
      const to = Math.max(0, Math.min(documentLength, range.to));
      return EditorSelection.range(Math.min(from, to), Math.max(from, to));
    });
    if (ranges.length === 0) return EditorSelection.single(0);
    const mainIndex = Math.max(0, Math.min(selection.mainIndex, ranges.length - 1));
    return EditorSelection.create(ranges, mainIndex);
  };

  const operationFromUpdate = (update: {
    readonly changes: { iterChanges: (f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void) => void };
    readonly startState: EditorState;
    readonly state: EditorState;
  }): TextOperation => {
    const edits: TextEdit[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      edits.push({
        from: fromA,
        to: toA,
        deleted: update.startState.doc.sliceString(fromA, toA),
        inserted: inserted.toString(),
      });
    });
    return {
      beforeLength: update.startState.doc.length,
      afterLength: update.state.doc.length,
      edits,
    };
  };

  const groupingFor = (update: { readonly transactions: readonly Transaction[] }): HistoryGrouping => {
    const event = update.transactions
      .map((transaction) => transaction.annotation(Transaction.userEvent))
      .find((value): value is string => value !== undefined);
    if (event?.startsWith("input.type.compose")) return "composition";
    if (event?.startsWith("input.paste")) return "paste";
    if (event?.startsWith("input") || event?.startsWith("delete")) return "input";
    return "command";
  };

  const operationChanges = (
    operation: TextOperation,
    separator: string,
  ): Array<{ readonly from: number; readonly to: number; readonly insert: string }> =>
    operation.edits.map((edit) => ({
      from: edit.from,
      to: edit.to,
      insert: separator === "\n" ? edit.inserted : edit.inserted.split("\n").join(separator),
    }));

  const runHistory = (direction: "undo" | "redo"): boolean => {
    if (disposed) return false;
    const current = view.state.doc.toString();
    const decision = direction === "undo" ? localHistory.undo(current) : localHistory.redo(current);
    if (decision.kind !== "apply") return false;
    pendingDecision = decision;
    applyOrigin = direction;
    try {
      const changes = operationChanges(decision.operation, view.state.lineBreak);
      const selection = decision.selection
        ? selectionFromSnapshot(decision.selection, decision.operation.afterLength)
        : undefined;
      view.dispatch({
        changes,
        ...(selection ? { selection } : {}),
        annotations: originAnnotation.of(direction),
        userEvent: direction,
      });
    } catch {
      pendingDecision = undefined;
      localHistory.cancelPending();
    } finally {
      applyOrigin = "user";
    }
    return true;
  };

  const listener = EditorView.updateListener.of((update) => {
    if (disposed) return;
    if (update.docChanged) {
      const operation = operationFromUpdate(update);
      const transactionOrigin =
        update.transactions
          .map((transaction) => transaction.annotation(originAnnotation))
          .find((value): value is ApplyOrigin => value !== undefined) ?? applyOrigin;

      if (transactionOrigin === "user") {
        localHistory.acceptLocal(
          operation,
          groupingFor(update),
          selectionSnapshot(update.startState.selection),
          selectionSnapshot(update.state.selection),
        );
        opts.onChange({ text: rendered(update.state), operation, origin: "input" });
      } else if (transactionOrigin === "sync") {
        localHistory.acceptExternal(operation);
      } else if (transactionOrigin === "undo" || transactionOrigin === "redo") {
        const decision = pendingDecision;
        pendingDecision = undefined;
        const before = selectionSnapshot(update.startState.selection);
        const after = selectionSnapshot(update.state.selection);
        if (decision) {
          if (!localHistory.commit(decision, before, after, operation)) {
            localHistory.acceptExternal(operation);
          }
          opts.onChange({
            text: rendered(update.state),
            operation,
            origin: transactionOrigin,
          });
        }
      }
    }
    if (update.selectionSet || update.docChanged) opts.onSelectionChange();
  });

  const extensions = (convertLineBreaks: string | null = null): Extension => [
    ...(convertLineBreaks === null ? [] : [EditorState.lineSeparator.of(convertLineBreaks)]),
    editingExtensions(),
    // This is the basic CodeMirror setup copied without `history()` and
    // `historyKeymap`: all document undo is owned by `localHistory`.
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
    Prec.high(
      keymap.of([
        { key: "Mod-z", run: () => runHistory("undo"), preventDefault: true },
        {
          key: "Mod-y",
          mac: "Mod-Shift-z",
          run: () => runHistory("redo"),
          preventDefault: true,
        },
        { linux: "Ctrl-Shift-z", run: () => runHistory("redo"), preventDefault: true },
      ]),
    ),
    keymap.of([indentWithTab]),
    markdown({ base: markdownLanguage }),
    theme.of(editorTheme(currentTheme)),
    EditorView.lineWrapping,
    preview.of(previewOn ? livePreviewExtension() : []),
    markdownCompletions(opts.completions),
    listener,
  ];

  view = new EditorView({ parent, state: EditorState.create({ extensions: extensions() }) });

  return {
    setDoc(text: string) {
      if (disposed) return;
      localHistory.reset();
      applyOrigin = "replace";
      try {
        view.setState(
          EditorState.create({ doc: text, extensions: extensions(lineSeparator(text)) }),
        );
      } finally {
        applyOrigin = "user";
      }
      opts.onSelectionChange();
    },
    syncDoc(update: DocumentUpdate | string) {
      if (disposed) return;
      const requested = typeof update === "string" ? { text: update, operation: null } : update;
      const separator = view.state.lineBreak;
      const normalizedText = requested.text.replace(/\r\n?/g, "\n");
      const current = view.state.doc.toString();
      if (current === normalizedText) return;

      let operation: TextOperation;
      if (requested.operation) {
        const candidate = tryApplyOperation(current, requested.operation);
        operation =
          candidate.kind === "applied" && candidate.text === normalizedText
            ? requested.operation
            : operationFromText(current, normalizedText);
      } else {
        operation = operationFromText(current, normalizedText);
      }
      const applied = tryApplyOperation(current, operation);
      if (applied.kind !== "applied" || applied.text !== normalizedText) return;

      applyOrigin = "sync";
      try {
        view.dispatch({
          changes: operationChanges(operation, separator),
          annotations: originAnnotation.of("sync"),
          userEvent: "sync",
        });
      } finally {
        applyOrigin = "user";
      }
    },
    undo: () => runHistory("undo"),
    redo: () => runHistory("redo"),
    getDoc: () => rendered(),
    focus: () => {
      if (!disposed) view.focus();
    },
    selections() {
      const text = rendered();
      const { ranges, mainIndex } = view.state.selection;
      const endpoints = new Array<number>(ranges.length * 2);
      for (let i = 0; i < ranges.length; i += 1) {
        const range = ranges[i];
        endpoints[2 * i] = renderedOffset(range.from);
        endpoints[2 * i + 1] = renderedOffset(range.to);
      }
      const byte = charToByteIndices(text, endpoints);
      const selections = ranges.map((_, i) => {
        const from = endpoints[2 * i];
        const to = endpoints[2 * i + 1];
        return {
          start: byte[2 * i],
          end: byte[2 * i + 1],
          text: text.slice(from, to),
        };
      });
      return {
        primary: selections[mainIndex],
        secondary: selections.filter((_, i) => i !== mainIndex),
      };
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      pendingDecision = undefined;
      localHistory.dispose();
      view.destroy();
    },
    setLivePreview(on: boolean) {
      if (disposed) return;
      previewOn = on;
      view.dispatch({ effects: preview.reconfigure(on ? livePreviewExtension() : []) });
    },
    setSyntaxForms(forms: readonly SyntaxForm[]) {
      if (disposed) return;
      syntaxForms = forms;
      if (previewOn) view.dispatch({ effects: preview.reconfigure(livePreviewExtension()) });
    },
    setTheme(next: Theme) {
      if (disposed) return;
      currentTheme = next;
      view.dispatch({ effects: theme.reconfigure(editorTheme(next)) });
    },
    revealByteOffset(byteOffset: number) {
      if (disposed) return;
      const text = rendered();
      const renderedPos = byteToCharIndex(text, byteOffset);
      const crlfBefore = text.slice(0, renderedPos + 1).match(/\r\n/g)?.length ?? 0;
      const pos = Math.min(view.state.doc.length, renderedPos - crlfBefore);
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
      view.focus();
    },
  };
}
