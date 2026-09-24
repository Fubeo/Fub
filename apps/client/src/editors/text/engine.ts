import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  Text,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate,
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
import {
  defaultKeymap,
  history as nativeHistory,
  historyKeymap,
  indentWithTab,
  redo as nativeRedo,
  undo as nativeUndo,
  undoDepth,
  redoDepth,
} from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { lintKeymap } from "@codemirror/lint";
import { currentTheme as getCurrentTheme, type Theme } from "../../theme/theme";
import { byteToNormalizedCharIndices, charToByteIndices } from "../../rules/offsets";
import { onLanguage, t } from "../../i18n/strings";
import { settings } from "../../host/query";
import { onEvent } from "../../state/kernel";
import type { Teardown } from "../../ui/lifetime";
import { editorTheme } from "./theme";
import { HistoryFootprints } from "./history-footprints";
import {
  operationFromText,
  tryApplyOperation,
  type TextEdit,
  type TextOperation,
} from "../../editor/text-operation";

export interface EditorRange {
  start: number;
  end: number;
  text: string;
}

export interface EditorSelections {
  primary: EditorRange;
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

/// Ancoraggio di scroll che non tocca selezione né cronologia.
export interface ScrollAnchor {
  readonly offset: number;
  readonly top: number;
}

export interface TextEngineOptions {
  onChange(change: EditorChange): void;
  onSelectionChange(): void;
  readonly extensions?: () => Extension;
  readonly theme?: Theme;
}
// Mirrors the core machine settings read by every mounted text surface.
export const EDITOR_SPELLCHECK_KEY = "editor.spellcheck";
export const EDITOR_VIM_KEY = "editor.vim";

type ApplyOrigin = "user" | "sync" | "undo" | "redo" | "replace";

export class TextEngine {
  private readonly profile = new Compartment();
  private readonly theme = new Compartment();
  private readonly readOnly = new Compartment();
  private readonly historyCompartment = new Compartment();
  private readonly vimCompartment = new Compartment();
  private readonly spellcheckCompartment = new Compartment();
  private readonly nativeHistoryExtension = nativeHistory({
    minDepth: 100,
    newGroupDelay: 500,
  });
  private readonly originAnnotation = Annotation.define<ApplyOrigin>();
  private readonly footprints = new HistoryFootprints();
  private readonly options: TextEngineOptions;
  private readonly listener: Extension;
  private readonly stopLanguage: Teardown;
  private readonly stopSettings: Teardown;
  private settingsGeneration = 0;
  private vimEnabled = false;
  private spellcheckEnabled = true;
  private appliedVim = false;
  private appliedSpellcheck = true;
  private pendingInput = false;
  private applyOrigin: ApplyOrigin = "user";
  private readOnlyEnabled = false;
  private disposed = false;
  private scrollFrame: number | null = null;
  private scrollEpoch = 0;
  private currentTheme: Theme;
  private view: EditorView;

  public constructor(parent: HTMLElement, options: TextEngineOptions) {
    this.options = options;
    this.currentTheme = options.theme ?? getCurrentTheme();
    this.listener = EditorView.updateListener.of((update) => this.handleUpdate(update));
    this.view = new EditorView({
      parent,
      state: EditorState.create({ extensions: this.extensions() }),
    });
    // Il solo controllo da raggiungere con Tab è lo scroller, mentre il
    // contenteditable interno resta la destinazione per il fuoco dell'editor.
    this.view.contentDOM.tabIndex = -1;
    this.view.scrollDOM.tabIndex = 0;
    this.view.scrollDOM.setAttribute("role", "document");
    this.stopSettings = onEvent("setting_changed", (event) => {
      if (event.key === EDITOR_VIM_KEY || event.key === EDITOR_SPELLCHECK_KEY) {
        void this.loadInputPreferences();
      }
    });
    void this.loadInputPreferences();
    this.stopLanguage = onLanguage(() => this.updateAccessibleLabels());
    this.updateAccessibleLabels();
  }
  public setDoc(text: string): void {
    if (this.disposed) return;
    this.applyOrigin = "replace";
    try {
      this.view.setState(
        EditorState.create({ doc: text, extensions: this.extensions(this.lineSeparator(text)) }),
      );
      this.footprints.reset();
    } finally {
      this.applyOrigin = "user";
    }
    this.options.onSelectionChange();
  }

  public syncDoc(update: DocumentUpdate | string): void {
    if (this.disposed) return;
    const requested = typeof update === "string" ? { text: update, operation: null } : update;
    const separator = this.view.state.lineBreak;
    const normalizedText = requested.text.replace(/\r\n?/g, "\n");
    const current = this.view.state.doc.toString();
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

    const spec = {
      changes: this.operationChanges(operation, separator),
      annotations: [
        this.originAnnotation.of("sync"),
        Transaction.addToHistory.of(false),
        Transaction.remote.of(true),
      ],
      userEvent: "sync",
      // Profile filters shape local input, not the session's authoritative text.
      filter: false,
    };
    let transaction: Transaction;
    try {
      transaction = this.view.state.update(spec);
    } catch {
      this.footprints.markUnknown();
      return;
    }
    if (!this.isAuthoritativeSync(transaction, normalizedText)) {
      this.footprints.markUnknown();
      return;
    }

    const unsafe = this.footprints.unknown || this.footprints.overlaps(transaction.changes);
    if (unsafe && !this.resetNativeHistory()) return;
    if (unsafe) {
      try {
        transaction = this.view.state.update(spec);
      } catch {
        this.footprints.markUnknown();
        return;
      }
      if (!this.isAuthoritativeSync(transaction, normalizedText)) {
        this.footprints.markUnknown();
        return;
      }
    }

    this.applyOrigin = "sync";
    try {
      this.view.dispatch(transaction);
    } catch {
      this.footprints.markUnknown();
    } finally {
      this.applyOrigin = "user";
    }
  }

  public undo(): boolean {
    return this.runHistory("undo");
  }

  public redo(): boolean {
    return this.runHistory("redo");
  }

  public getDoc(): string {
    return this.rendered();
  }

  public focus(): void {
    if (!this.disposed) this.view.focus();
  }

  public revealByteOffset(byteOffset: number): void {
    if (this.disposed) return;
    const text = this.rendered();
    const pos = byteToNormalizedCharIndices(text, [byteOffset])[0];
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "start" }),
    });
    this.view.focus();
  }

  public selections(): EditorSelections {
    const text = this.rendered();
    const { ranges, mainIndex } = this.view.state.selection;
    const endpoints = new Array<number>(ranges.length * 2);
    for (let i = 0; i < ranges.length; i += 1) {
      const range = ranges[i];
      endpoints[2 * i] = this.renderedOffset(range.from);
      endpoints[2 * i + 1] = this.renderedOffset(range.to);
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
  }

  public destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scrollEpoch += 1;
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.settingsGeneration += 1;
    this.stopSettings();
    this.stopLanguage();
    this.footprints.reset();
    this.view.destroy();
  }

  public setTheme(theme: Theme): void {
    if (this.disposed) return;
    this.currentTheme = theme;
    this.view.dispatch({ effects: this.theme.reconfigure(editorTheme(theme)) });
  }

  public setReadOnly(readOnly: boolean): void {
    if (this.disposed || this.readOnlyEnabled === readOnly) return;
    this.readOnlyEnabled = readOnly;
    this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(readOnly)) });
  }

  public setVim(enabled: boolean): void {
    if (this.disposed || this.vimEnabled === enabled) return;
    this.vimEnabled = enabled;
    this.reconfigureInput();
  }

  public setSpellcheck(enabled: boolean): void {
    if (this.disposed || this.spellcheckEnabled === enabled) return;
    this.spellcheckEnabled = enabled;
    this.reconfigureInput();
  }

  private reconfigureInput(): void {
    if (this.view.compositionStarted) {
      this.pendingInput = true;
      return;
    }
    this.pendingInput = false;
    if (this.appliedVim !== this.vimEnabled) {
      this.appliedVim = this.vimEnabled;
      this.view.dispatch({ effects: this.vimCompartment.reconfigure(this.vimEnabled ? vim() : []) });
    }
    if (this.appliedSpellcheck !== this.spellcheckEnabled) {
      this.appliedSpellcheck = this.spellcheckEnabled;
      this.view.dispatch({
        effects: this.spellcheckCompartment.reconfigure(EditorView.contentAttributes.of({
          spellcheck: String(this.spellcheckEnabled),
          dir: "auto",
        })),
      });
    }
  }

  private async loadInputPreferences(): Promise<void> {
    const generation = ++this.settingsGeneration;
    try {
      const entries = await settings();
      if (this.disposed || generation !== this.settingsGeneration) return;
      const spellcheck = entries.find((entry) => entry.spec.key === EDITOR_SPELLCHECK_KEY);
      const vimSetting = entries.find((entry) => entry.spec.key === EDITOR_VIM_KEY);
      this.setSpellcheck(spellcheck?.value !== false);
      this.setVim(vimSetting?.value === true);
    } catch {
      // Defaults remain available before a vault is open or when settings fail.
    }
  }


  /// Scrittura chirurgica di una superficie resa (checkbox dei task in Lettura).
  /// Gli offset sono code unit UTF-16 del documento normalizzato LF, come
  /// `EditorState.doc`; il testo originale con CRLF resta a `getDoc`/sessione.
  /// Rispetta i limiti e la sola lettura, passa da `userEvent: "input"` così
  /// resta annullabile dalla cronologia locale e diffusa come ogni battuta.
  public applyUserEdit(from: number, to: number, insert: string): boolean {
    if (this.disposed || this.readOnlyEnabled) return false;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || typeof insert !== "string") return false;
    const length = this.view.state.doc.length;
    if (from < 0 || to < from || to > length) return false;
    if (insert.includes("\r")) return false;
    this.view.dispatch({ changes: { from, to, insert: Text.of(insert.split("\n")) }, userEvent: "input" });
    return true;
  }

  /// Inserisce testo al cursore principale come battuta dell'utente: stessa
  /// via di `applyUserEdit` (storia locale, sessione, CRLF interno), senza
  /// esporre `EditorView` oltre il confine del package.
  public insertAtCursor(text: string): boolean {
    if (this.disposed || this.readOnlyEnabled) return false;
    if (typeof text !== "string" || text.length === 0 || text.includes("\r")) return false;
    const { from, to } = this.view.state.selection.main;
    return this.applyUserEdit(from, to, text);
  }

  /// Il blocco visibile in cima, senza toccare selezione né cronologia.
  /// `top` è la distanza in pixel fra la cima del blocco e quella della vista.
  public getScrollAnchor(): ScrollAnchor {
    if (this.disposed) return { offset: 0, top: 0 };
    const top = this.view.scrollDOM.getBoundingClientRect().top;
    const block = this.view.lineBlockAtHeight(Math.max(0, top - this.view.documentTop));
    return { offset: block.from, top: this.view.documentTop + block.top - top };
  }

  /// Rimette la vista sull'ancoraggio: solo scorrimento, mai selezione o testo.
  public restoreScrollAnchor(anchor: ScrollAnchor): void {
    if (this.disposed || !Number.isSafeInteger(anchor.offset) || !Number.isFinite(anchor.top)) return;
    const doc = this.view.state.doc;
    const offset = Math.max(0, Math.min(doc.length, anchor.offset));
    const epoch = ++this.scrollEpoch;
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.view.dispatch({ effects: EditorView.scrollIntoView(offset, { y: "start", yMargin: 0 }) });
    // CodeMirror applica scrollIntoView dopo le richieste di misura del frame.
    // La correzione in pixel deve quindi avvenire nel frame successivo.
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      if (this.disposed || epoch !== this.scrollEpoch) return;
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          if (this.disposed || epoch !== this.scrollEpoch || view.state.doc !== doc || !view.dom.getClientRects().length) return null;
          const block = view.lineBlockAt(offset);
          return view.documentTop + block.top - view.scrollDOM.getBoundingClientRect().top;
        },
        write: (top, view) => {
          if (top !== null && !this.disposed && epoch === this.scrollEpoch && view.state.doc === doc) {
            view.scrollDOM.scrollTop += top - anchor.top;
          }
        },
      });
    });
  }

  /// Rimpiazza soltanto l'estensione del profilo: la stessa vista conserva
  /// documento, selezione, tema e cronologia locale.
  public reconfigure(): void {
    if (this.disposed) return;
    this.view.dispatch({ effects: this.profile.reconfigure(this.profileExtensions()) });
  }

  private profileExtensions(): Extension {
    return this.options.extensions?.() ?? [];
  }
  private updateAccessibleLabels(): void {
    for (const element of [this.view.contentDOM, this.view.scrollDOM]) {
      element.dataset.i18nLabel = "editor.document";
      element.setAttribute("aria-label", t("editor.document"));
    }
    for (const checkbox of this.view.contentDOM.querySelectorAll<HTMLInputElement>(".cm-fub-checkbox")) {
      checkbox.setAttribute(
        "aria-label",
        t(checkbox.checked ? "editor.task.completed" : "editor.task.pending"),
      );
    }
  }

  private rendered(state: EditorState = this.view.state): string {
    return state.doc.sliceString(0, state.doc.length, state.lineBreak);
  }

  private renderedOffset(pos: number): number {
    return this.view.state.lineBreak === "\n"
      ? pos
      : pos + this.view.state.doc.lineAt(pos).number - 1;
  }

  private lineSeparator(text: string): string | null {
    return text.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : null;
  }

  private operationFromUpdate(update: ViewUpdate): TextOperation {
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
  }

  private updateOrigin(update: ViewUpdate): ApplyOrigin {
    const annotated = update.transactions
      .map((transaction) => transaction.annotation(this.originAnnotation))
      .find((value): value is ApplyOrigin => value !== undefined);
    if (annotated) return annotated;
    if (update.transactions.some((transaction) => transaction.isUserEvent("sync"))) return "sync";
    if (update.transactions.some((transaction) => transaction.isUserEvent("undo"))) return "undo";
    if (update.transactions.some((transaction) => transaction.isUserEvent("redo"))) return "redo";
    return this.applyOrigin;
  }

  private isHistoryableLocal(update: ViewUpdate): boolean {
    return update.transactions.some(
      (transaction) =>
        transaction.docChanged &&
        transaction.annotation(Transaction.addToHistory) !== false &&
        transaction.annotation(Transaction.remote) !== true,
    );
  }

  private isAuthoritativeSync(transaction: Transaction, expectedText: string): boolean {
    return transaction.docChanged &&
      transaction.newDoc.toString() === expectedText &&
      transaction.annotation(this.originAnnotation) === "sync" &&
      transaction.isUserEvent("sync") &&
      transaction.annotation(Transaction.remote) === true &&
      transaction.annotation(Transaction.addToHistory) === false;
  }

  private clearFootprintsWithoutHistory(): void {
    this.footprints.clearIfNoHistory(undoDepth(this.view.state), redoDepth(this.view.state));
  }

  private resetNativeHistory(): boolean {
    if (undoDepth(this.view.state) === 0 && redoDepth(this.view.state) === 0) {
      this.footprints.reset();
      return true;
    }
    try {
      this.view.dispatch({ effects: this.historyCompartment.reconfigure([]) });
      this.view.dispatch({ effects: this.historyCompartment.reconfigure(this.nativeHistoryExtension) });
      return true;
    } catch {
      this.footprints.markUnknown();
      return false;
    }
  }

  private operationChanges(
    operation: TextOperation,
    separator: string,
  ): Array<{ readonly from: number; readonly to: number; readonly insert: string }> {
    return operation.edits.map((edit) => ({
      from: edit.from,
      to: edit.to,
      insert: separator === "\n" ? edit.inserted : edit.inserted.split("\n").join(separator),
    }));
  }

  private runHistory(direction: "undo" | "redo"): boolean {
    if (this.disposed) return false;
    const command = direction === "undo" ? nativeUndo : nativeRedo;
    this.applyOrigin = direction;
    try {
      return command({
        state: this.view.state,
        dispatch: (transaction) => this.view.dispatch(transaction),
      });
    } catch {
      return false;
    } finally {
      this.applyOrigin = "user";
    }
  }

  private handleUpdate(update: ViewUpdate): void {
    if (this.disposed) return;
    const origin = this.updateOrigin(update);
    if (update.docChanged) {
      const operation = this.operationFromUpdate(update);
      this.footprints.advance(update.changes, origin === "user" && this.isHistoryableLocal(update));
      if (origin === "user") {
        this.options.onChange({ text: this.rendered(update.state), operation, origin: "input" });
      } else if (origin === "undo" || origin === "redo") {
        this.options.onChange({
          text: this.rendered(update.state),
          operation,
          origin,
        });
      }
    }
    this.clearFootprintsWithoutHistory();
    if (update.selectionSet || update.docChanged) this.options.onSelectionChange();
  }

  private extensions(convertLineBreaks: string | null = null): Extension {
    return [
      ...(convertLineBreaks === null ? [] : [EditorState.lineSeparator.of(convertLineBreaks)]),
      this.profile.of(this.profileExtensions()),
      this.vimCompartment.of(this.vimEnabled ? vim() : []),
      this.spellcheckCompartment.of(EditorView.contentAttributes.of({
        spellcheck: String(this.spellcheckEnabled),
        dir: "auto",
      })),
      EditorView.perLineTextDirection.of(true),
      EditorView.domEventHandlers({
        compositionend: () => {
          if (!this.pendingInput) return;
          queueMicrotask(() => {
            if (!this.disposed && this.pendingInput) this.reconfigureInput();
          });
        },
      }),
      this.readOnly.of(EditorState.readOnly.of(this.readOnlyEnabled)),
      this.historyCompartment.of(this.nativeHistoryExtension),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      foldGutter({ openText: "↓" }),
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
      // La riga attiva è una `lineDecoration`: sta sopra il layer di
      // selezione in paint order e copre il rettangolo quando la selezione
      // è sulla stessa riga del cursore (1.3:1 fra `#222` e riga attiva).
      // Questo plugin spegne la riga attiva solo sulle righe che hanno una
      // selezione non vuota: altrove resta `--doc-active-line` del tema.
      // `Prec.highest` perché deve vincere sul tema dell'editor.
      Prec.highest(
        ViewPlugin.fromClass(
          class {
            decorations = Decoration.none;
            update(update: ViewUpdate): void {
              this.decorations = selectionHidesActiveLine(update.view);
            }
          },
          { decorations: (v) => v.decorations },
        ),
      ),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
      keymap.of([indentWithTab]),
      this.theme.of(editorTheme(this.currentTheme)),
      EditorView.lineWrapping,
      this.listener,
    ];
  }
}

/// Le righe con una selezione non vuota perdono la classe `cm-activeLine`:
/// la riga attiva è una `lineDecoration` e in paint order copre il rettangolo
/// di selezione, che sta su un layer a z-index negativo. Senza selezione la
/// riga del cursore resta evidenziata come prima.
function selectionHidesActiveLine(view: EditorView): DecorationSet {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    lines.add(view.state.doc.lineAt(range.from).number);
    lines.add(view.state.doc.lineAt(range.to).number);
  }
  if (lines.size === 0) return Decoration.none;
  const hide = Decoration.line({ class: "cm-fub-no-active-line" });
  return Decoration.set(
    [...lines].map((n) => hide.range(view.state.doc.line(n).from)),
    true,
  );
}

export function createTextEngine(parent: HTMLElement, options: TextEngineOptions): TextEngine {
  return new TextEngine(parent, options);
}
