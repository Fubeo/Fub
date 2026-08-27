import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  completionStatus,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language";
import { EditorSelection, EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type FormulaTokenKind =
  | "operator"
  | "number"
  | "string"
  | "reference"
  | "function"
  | "identifier"
  | "punctuation"
  | "unknown";

export interface FormulaToken {
  readonly kind: FormulaTokenKind;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*/;
const NUMBER_PATTERN = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;
const REFERENCE_PATTERN =
  /^(?:(?:'[^']*(?:''[^']*)*'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?(?![A-Za-z0-9_])/;
const OPERATOR_PATTERN = /^(?:<=|>=|<>|==|!=|&&|\|\||[+\-*/^%=<>&])/;
const PUNCTUATION_PATTERN = /^(?:[(),;:{}\[\]]|!)/;

function identifierIsFunction(input: string, end: number): boolean {
  return /^\s*\(/.test(input.slice(end));
}

function consumeString(input: string, start: number): number {
  let index = start + 1;
  while (index < input.length) {
    if (input[index] !== '"') {
      index += 1;
      continue;
    }
    if (input[index + 1] === '"') {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return index;
}

function token(kind: FormulaTokenKind, input: string, from: number, to: number): FormulaToken {
  return { kind, from, to, text: input.slice(from, to) };
}

/** Tokenizes the formula lexicon without evaluating or resolving any value. */
export function tokenizeFormula(input: string): readonly FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '"') {
      const end = consumeString(input, index);
      tokens.push(token("string", input, index, end));
      index = end;
      continue;
    }

    const reference = input.slice(index).match(REFERENCE_PATTERN)?.[0];
    if (reference) {
      const end = index + reference.length;
      tokens.push(token("reference", input, index, end));
      index = end;
      continue;
    }

    const number = input.slice(index).match(NUMBER_PATTERN)?.[0];
    if (number) {
      const end = index + number.length;
      tokens.push(token("number", input, index, end));
      index = end;
      continue;
    }

    const operator = input.slice(index).match(OPERATOR_PATTERN)?.[0];
    if (operator) {
      const end = index + operator.length;
      tokens.push(token("operator", input, index, end));
      index = end;
      continue;
    }

    const identifier = input.slice(index).match(IDENTIFIER_PATTERN)?.[0];
    if (identifier) {
      const end = index + identifier.length;
      tokens.push(token(identifierIsFunction(input, end) ? "function" : "identifier", input, index, end));
      index = end;
      continue;
    }

    const punctuation = input.slice(index).match(PUNCTUATION_PATTERN)?.[0];
    if (punctuation) {
      const end = index + punctuation.length;
      tokens.push(token("punctuation", input, index, end));
      index = end;
      continue;
    }

    tokens.push(token("unknown", input, index, index + 1));
    index += 1;
  }

  return tokens;
}

export interface FormulaParserState {
  inString: boolean;
}

function streamString(stream: StringStream, state: FormulaParserState): string {
  state.inString = true;
  stream.next();
  while (!stream.eol()) {
    const character = stream.next();
    if (character !== '"') continue;
    if (stream.peek() === '"') {
      stream.next();
      continue;
    }
    state.inString = false;
    break;
  }
  return "formulaString";
}

const formulaParser: StreamParser<FormulaParserState> = {
  name: "fub-formula",
  startState: () => ({ inString: false }),
  copyState: (state) => ({ inString: state.inString }),
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) {
        const character = stream.next();
        if (character !== '"') continue;
        if (stream.peek() === '"') {
          stream.next();
          continue;
        }
        state.inString = false;
        break;
      }
      return "formulaString";
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === '"') return streamString(stream, state);
    if (stream.match(REFERENCE_PATTERN)) return "formulaReference";
    if (stream.match(NUMBER_PATTERN)) return "formulaNumber";
    if (stream.match(OPERATOR_PATTERN)) return "formulaOperator";

    const identifier = stream.match(IDENTIFIER_PATTERN);
    if (identifier) return stream.match(/^\s*\(/, false) ? "formulaFunction" : "formulaIdentifier";
    if (stream.match(PUNCTUATION_PATTERN)) return "formulaPunctuation";

    stream.next();
    return "formulaUnknown";
  },
  tokenTable: {
    formulaOperator: tags.operator,
    formulaNumber: tags.number,
    formulaString: tags.string,
    formulaReference: tags.variableName,
    formulaFunction: tags.function(tags.variableName),
    formulaIdentifier: tags.variableName,
    formulaPunctuation: tags.punctuation,
    formulaUnknown: tags.invalid,
  },
};

/** The non-authoritative lexical language mounted by FormulaProfile. */
export const formulaLanguage = StreamLanguage.define(formulaParser);

export interface FormulaCompletionItem {
  readonly label: string;
  readonly detail?: string;
}

export type FormulaCompletionValues = readonly (string | FormulaCompletionItem)[];
export type FormulaCompletionProvider = (
  prefix: string,
) => FormulaCompletionValues | Promise<FormulaCompletionValues>;
export type FormulaCompletionSource = FormulaCompletionValues | FormulaCompletionProvider;

export interface FormulaCompletionSources {
  readonly functions?: FormulaCompletionSource;
  readonly sheets?: FormulaCompletionSource;
  readonly names?: FormulaCompletionSource;
}

function completionValues(
  source: FormulaCompletionSource | undefined,
  prefix: string,
): Promise<FormulaCompletionValues> {
  if (!source) return Promise.resolve([]);
  return Promise.resolve(typeof source === "function" ? source(prefix) : source);
}

function completionOptions(
  values: FormulaCompletionValues,
  type: "function" | "sheet" | "name",
): Completion[] {
  return values.map((value) => {
    const item = typeof value === "string" ? { label: value } : value;
    return {
      label: item.label,
      ...(item.detail ? { detail: item.detail } : {}),
      type: type === "function" ? "function" : "variable",
    };
  });
}

function insideString(text: string): boolean {
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue;
    if (text[index + 1] === '"') {
      index += 1;
      continue;
    }
    inString = !inString;
  }
  return inString;
}

function completionContext(context: CompletionContext): { from: number; query: string } | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  if (insideString(before)) return null;

  const match = before.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
  if (!match) {
    return context.explicit ? { from: context.pos, query: "" } : null;
  }
  return { from: context.pos - match[0].length, query: match[0] };
}

/** Completion source for injected function, sheet, and name values. */
export function formulaCompletionSource(sources: FormulaCompletionSources): CompletionSource {
  return async (context): Promise<CompletionResult | null> => {
    const match = completionContext(context);
    if (!match) return null;

    const [functions, sheets, names] = await Promise.all([
      completionValues(sources.functions, match.query),
      completionValues(sources.sheets, match.query),
      completionValues(sources.names, match.query),
    ]);
    const options = [
      ...completionOptions(functions, "function"),
      ...completionOptions(sheets, "sheet"),
      ...completionOptions(names, "name"),
    ];
    if (options.length === 0) return null;
    return {
      from: match.from,
      to: context.pos,
      options,
      validFor: /^[A-Za-z_][A-Za-z0-9_.]*$/,
    };
  };
}

/** Mounts the profile-local completion source, without a workbook or host dependency. */
export function formulaCompletions(sources: FormulaCompletionSources = {}): Extension {
  return autocompletion({
    override: [formulaCompletionSource(sources)],
    activateOnTyping: true,
    defaultKeymap: false,
  });
}

function withoutLineBreaks(text: string): string {
  return text.replace(/\r\n?|\n/g, "");
}

function withoutLineBreaksOffset(text: string, offset: number): number {
  return withoutLineBreaks(text.slice(0, offset)).length;
}

function singleLineExtension(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    const next = transaction.newDoc.toString();
    if (!/[\r\n]/.test(next)) return transaction;
    const sanitized = withoutLineBreaks(next);
    const selection = transaction.newSelection;
    const ranges = selection.ranges.map((range) =>
      EditorSelection.range(
        withoutLineBreaksOffset(next, range.from),
        withoutLineBreaksOffset(next, range.to),
      ),
    );
    const userEvent = transaction.annotation(Transaction.userEvent);
    return {
      changes: { from: 0, to: transaction.startState.doc.length, insert: sanitized },
      selection: EditorSelection.create(ranges, selection.mainIndex),
      ...(userEvent ? { annotations: Transaction.userEvent.of(userEvent) } : {}),
      filter: false,
    };
  });
}

export interface FormulaProfileCallbacks {
  readonly commit?: (value: string) => void;
  readonly cancel?: (value: string) => void;
}

export interface FormulaProfileOptions {
  readonly singleLine?: boolean;
  readonly completions?: FormulaCompletionSources;
  readonly callbacks?: FormulaProfileCallbacks;
  readonly onCommit?: (value: string) => void;
  readonly onCancel?: (value: string) => void;
}

export interface FormulaProfile {
  /** Produces the complete formula extension for the TextEngine profile seam. */
  extensions(): Extension;
}

const formulaCompletionKeymap = completionKeymap.filter(
  ({ key }) => key !== "Enter" && key !== "Escape",
);

function formulaKeyBindings(options: FormulaProfileOptions): readonly KeyBinding[] {
  const commit = options.callbacks?.commit ?? options.onCommit;
  const cancel = options.callbacks?.cancel ?? options.onCancel;
  return [
    {
      key: "Enter",
      run: (view) => {
        if (completionStatus(view.state) === "active") {
          acceptCompletion(view);
          return true;
        }
        commit?.(view.state.doc.toString());
        return true;
      },
    },
    {
      key: "Shift-Enter",
      run: (view) => {
        closeCompletion(view);
        commit?.(view.state.doc.toString());
        return true;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        closeCompletion(view);
        cancel?.(view.state.doc.toString());
        return true;
      },
    },
    {
      key: "Tab",
      run: (view) => {
        if (completionStatus(view.state) !== "active") return false;
        acceptCompletion(view);
        return true;
      },
    },
    ...formulaCompletionKeymap,
  ];
}

function formulaKeymap(options: FormulaProfileOptions): Extension {
  return Prec.highest(keymap.of(formulaKeyBindings(options)));
}

/**
 * Creates a formula profile. It owns only formula syntax, local completions,
 * and explicit editing decisions; document state and history remain in TextEngine.
 */
export function createFormulaProfile(options: FormulaProfileOptions = {}): FormulaProfile {
  const singleLine = options.singleLine ?? true;
  return {
    extensions() {
      return [
        formulaLanguage,
        formulaCompletions(options.completions),
        formulaKeymap(options),
        ...(singleLine ? [singleLineExtension()] : []),
      ];
    },
  };
}
