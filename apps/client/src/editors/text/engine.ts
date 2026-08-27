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
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { currentTheme as getCurrentTheme, type Theme } from "../../theme/theme";
import { byteToCharIndex, charToByteIndices } from "../../rules/offsets";
import { editorTheme } from "./theme";
import {
  LocalHistory,
  operationFromText,
  tryApplyOperation,
  type HistoryGrouping,
  type SelectionSnapshot,
  type TextEdit,
  type TextOperation,
} from "../../editor/local-history";

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

export interface TextEngineOptions {
  onChange(change: EditorChange): void;
  onSelectionChange(): void;
  readonly extensions?: () => Extension;
  readonly theme?: Theme;
}

type ApplyOrigin = "user" | "sync" | "undo" | "redo" | "replace";

type PendingDecision =
  | { readonly kind: "apply"; readonly token: number; readonly operation: TextOperation }
  | undefined;

export class TextEngine {
  private readonly profile = new Compartment();
  private readonly theme = new Compartment();
  private readonly originAnnotation = Annotation.define<ApplyOrigin>();
  private readonly localHistory = new LocalHistory();
  private readonly options: TextEngineOptions;
  private readonly listener: Extension;
  private applyOrigin: ApplyOrigin = "user";
  private pendingDecision: PendingDecision;
  private disposed = false;
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
  }

  public setDoc(text: string): void {
    if (this.disposed) return;
    this.localHistory.reset();
    this.applyOrigin = "replace";
    try {
      this.view.setState(
        EditorState.create({ doc: text, extensions: this.extensions(this.lineSeparator(text)) }),
      );
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

    this.applyOrigin = "sync";
    try {
      this.view.dispatch({
        changes: this.operationChanges(operation, separator),
        annotations: this.originAnnotation.of("sync"),
        userEvent: "sync",
      });
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
    const renderedPos = byteToCharIndex(text, byteOffset);
    const crlfBefore = text.slice(0, renderedPos + 1).match(/\r\n/g)?.length ?? 0;
    const pos = Math.min(this.view.state.doc.length, renderedPos - crlfBefore);
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
    this.pendingDecision = undefined;
    this.localHistory.dispose();
    this.view.destroy();
  }

  public setTheme(theme: Theme): void {
    if (this.disposed) return;
    this.currentTheme = theme;
    this.view.dispatch({ effects: this.theme.reconfigure(editorTheme(theme)) });
  }

  public reconfigure(): void {
    if (this.disposed) return;
    this.view.dispatch({ effects: this.profile.reconfigure(this.profileExtensions()) });
  }

  private profileExtensions(): Extension {
    return this.options.extensions?.() ?? [];
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

  private selectionSnapshot(selection: EditorSelection): SelectionSnapshot {
    return {
      ranges: selection.ranges.map((range) => ({ from: range.from, to: range.to })),
      mainIndex: selection.mainIndex,
    };
  }

  private selectionFromSnapshot(
    selection: SelectionSnapshot,
    documentLength: number,
  ): EditorSelection {
    const ranges = selection.ranges.map((range) => {
      const from = Math.max(0, Math.min(documentLength, range.from));
      const to = Math.max(0, Math.min(documentLength, range.to));
      return EditorSelection.range(Math.min(from, to), Math.max(from, to));
    });
    if (ranges.length === 0) return EditorSelection.single(0);
    const mainIndex = Math.max(0, Math.min(selection.mainIndex, ranges.length - 1));
    return EditorSelection.create(ranges, mainIndex);
  }

  private operationFromUpdate(update: {
    readonly changes: {
      iterChanges: (
        f: (
          fromA: number,
          toA: number,
          fromB: number,
          toB: number,
          inserted: { toString(): string },
        ) => void,
      ) => void;
    };
    readonly startState: EditorState;
    readonly state: EditorState;
  }): TextOperation {
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

  private groupingFor(update: { readonly transactions: readonly Transaction[] }): HistoryGrouping {
    const event = update.transactions
      .map((transaction) => transaction.annotation(Transaction.userEvent))
      .find((value): value is string => value !== undefined);
    if (event?.startsWith("input.type.compose")) return "composition";
    if (event?.startsWith("input.paste")) return "paste";
    if (event?.startsWith("input") || event?.startsWith("delete")) return "input";
    return "command";
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
    const current = this.view.state.doc.toString();
    const decision = direction === "undo" ? this.localHistory.undo(current) : this.localHistory.redo(current);
    if (decision.kind !== "apply") return false;
    this.pendingDecision = decision;
    this.applyOrigin = direction;
    try {
      const changes = this.operationChanges(decision.operation, this.view.state.lineBreak);
      const selection = decision.selection
        ? this.selectionFromSnapshot(decision.selection, decision.operation.afterLength)
        : undefined;
      this.view.dispatch({
        changes,
        ...(selection ? { selection } : {}),
        annotations: this.originAnnotation.of(direction),
        userEvent: direction,
      });
    } catch {
      this.pendingDecision = undefined;
      this.localHistory.cancelPending();
    } finally {
      this.applyOrigin = "user";
    }
    return true;
  }

  private handleUpdate(update: ViewUpdate): void {
    if (this.disposed) return;
    if (update.docChanged) {
      const operation = this.operationFromUpdate(update);
      const transactionOrigin =
        update.transactions
          .map((transaction) => transaction.annotation(this.originAnnotation))
          .find((value): value is ApplyOrigin => value !== undefined) ?? this.applyOrigin;

      if (transactionOrigin === "user") {
        this.localHistory.acceptLocal(
          operation,
          this.groupingFor(update),
          this.selectionSnapshot(update.startState.selection),
          this.selectionSnapshot(update.state.selection),
        );
        this.options.onChange({ text: this.rendered(update.state), operation, origin: "input" });
      } else if (transactionOrigin === "sync") {
        this.localHistory.acceptExternal(operation);
      } else if (transactionOrigin === "undo" || transactionOrigin === "redo") {
        const decision = this.pendingDecision;
        this.pendingDecision = undefined;
        const before = this.selectionSnapshot(update.startState.selection);
        const after = this.selectionSnapshot(update.state.selection);
        if (decision) {
          if (!this.localHistory.commit(decision, before, after, operation)) {
            this.localHistory.acceptExternal(operation);
          }
          this.options.onChange({
            text: this.rendered(update.state),
            operation,
            origin: transactionOrigin,
          });
        }
      }
    }
    if (update.selectionSet || update.docChanged) this.options.onSelectionChange();
  }

  private extensions(convertLineBreaks: string | null = null): Extension {
    return [
      ...(convertLineBreaks === null ? [] : [EditorState.lineSeparator.of(convertLineBreaks)]),
      this.profile.of(this.profileExtensions()),
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
          { key: "Mod-z", run: () => this.runHistory("undo"), preventDefault: true },
          {
            key: "Mod-y",
            mac: "Mod-Shift-z",
            run: () => this.runHistory("redo"),
            preventDefault: true,
          },
          { linux: "Ctrl-Shift-z", run: () => this.runHistory("redo"), preventDefault: true },
        ]),
      ),
      keymap.of([indentWithTab]),
      this.theme.of(editorTheme(this.currentTheme)),
      EditorView.lineWrapping,
      this.listener,
    ];
  }
}

export function createTextEngine(parent: HTMLElement, options: TextEngineOptions): TextEngine {
  return new TextEngine(parent, options);
}
