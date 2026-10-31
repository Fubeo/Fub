// Il prefisso di un blocco in Live: i `#` di un titolo, i `>` di una
// citazione, il segno di una voce e la sua casella. Con la politica `mai` non
// si vede e il cursore non ci entra, come in Word: Home va all'inizio del
// testo, Backspace all'inizio del testo toglie l'ultimo pezzo del prefisso (il
// titolo e la voce tornano paragrafo), e subito dopo una scorciatoia scritta a
// mano (`# `, `- `, `> `, `1. `, `[ ] `) la riporta testo, con l'escape che il
// Markdown dà ai segni da leggere come lettere. Con `elemento` la prima Home va
// all'inizio del testo e la seconda nel prefisso, che lì si rivela.
import {
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
  Prec,
  StateField,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { listItem } from "../../../../rules/syntax";
import { liveReveal } from "../../live-reveal";
import { frontmatterRange } from "./render";

export interface BlockPrefix {
  /// Dove comincia il testo del blocco.
  textFrom: number;
  /// Dove comincia l'ultimo pezzo del prefisso, quello che Backspace toglie.
  lastFrom: number;
  /// Dove sta il segno di ciascun pezzo, dal primo all'ultimo: è lì che
  /// l'escape lo rende testo.
  marks: readonly number[];
}

const OPAQUE = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);
const HEADING = /^(#{1,6})(?:[ \t]+|$)/;
const MAYBE_PREFIX = /^\s*(?:[#>*+-]|\d{1,9}[.)])/;

/// Il prefisso della riga, se ne ha uno che l'albero conferma: un `- ` in un
/// recinto di codice o nel frontmatter è testo.
export function blockPrefixAt(state: EditorState, line: Line): BlockPrefix | null {
  // Prima il testo, che costa poco: senza un segno d'inizio riga non c'è
  // prefisso, e l'albero non si guarda. Una battuta in un paragrafo passa di qui.
  if (!MAYBE_PREFIX.test(line.text)) return null;
  const yaml = frontmatterRange(state.doc);
  if (yaml && line.from < yaml.to) return null;
  const tree = syntaxTree(state);
  for (let node = tree.resolveInner(line.from, 1); node; node = node.parent!) {
    if (OPAQUE.has(node.name)) return null;
    if (!node.parent) break;
  }
  const names = new Set<string>();
  const marksAt = new Map<string, number[]>();
  tree.iterate({
    from: line.from,
    to: Math.min(line.to, line.from + 256),
    enter(node) {
      if (node.from < line.from || node.from > line.to) return;
      if (node.name === "QuoteMark" || node.name === "ListMark" || node.name === "HeaderMark" || node.name === "TaskMarker") {
        names.add(node.name);
        const list = marksAt.get(node.name) ?? [];
        list.push(node.from);
        marksAt.set(node.name, list);
      }
    },
  });
  const { text } = line;
  let textFrom = line.from;
  let lastFrom = line.from;
  const marks: number[] = [];
  const entry = listItem(text);
  if (entry) {
    const quoted = entry.quote !== "";
    if (quoted && !names.has("QuoteMark")) return null;
    if (entry.kind !== "quote" && !names.has("ListMark")) return null;
    if (quoted) {
      for (const at of marksAt.get("QuoteMark") ?? []) if (at < line.from + entry.quote.length) marks.push(at);
    }
    if (entry.kind === "quote") {
      lastFrom = line.from + entry.quote.lastIndexOf(">");
    } else {
      // Il rientro resta: una sottovoce senza segno resta dentro la sua voce.
      lastFrom = line.from + entry.quote.length + entry.indent.length;
      const listMark = (marksAt.get("ListMark") ?? []).find((at) => at >= lastFrom);
      if (listMark === undefined) return null;
      // L'escape di una numerata va sul punto: `1\.` è testo, `\1.` no.
      marks.push(entry.kind === "ordered" ? listMark + String(entry.number ?? "").length : listMark);
      if (entry.boxFrom >= 0) marks.push(line.from + entry.boxFrom);
    }
    textFrom = line.from + entry.markerEnd;
  }
  const heading = HEADING.exec(text.slice(textFrom - line.from));
  if (heading && (marksAt.get("HeaderMark") ?? []).includes(textFrom)) {
    lastFrom = textFrom;
    marks.push(textFrom);
    textFrom += heading[0].length;
  }
  if (textFrom === line.from) return null;
  return { textFrom, lastFrom, marks };
}

/// La scorciatoia appena scritta: il cursore alla fine di un prefisso nuovo, e
/// il segno da rendere testo. Vale per la transazione che l'ha scritta e
/// nessun'altra.
interface Shortcut {
  head: number;
  mark: number;
}

const typedShortcut = StateField.define<Shortcut | null>({
  create: () => null,
  update(_value, transaction) {
    if (!transaction.docChanged || !transaction.isUserEvent("input.type")) return null;
    const { state, startState } = transaction;
    const { head } = state.selection.main;
    const line = state.doc.lineAt(head);
    const prefix = blockPrefixAt(state, line);
    if (!prefix || prefix.textFrom !== head || line.to !== head) return null;
    const before = startState.doc.lineAt(startState.selection.main.head);
    const old = transaction.changes.mapPos(before.from, -1) === line.from ? blockPrefixAt(startState, before) : null;
    // Il pezzo nuovo è quello che comincia dove finiva il prefisso di prima.
    const start = old ? transaction.changes.mapPos(old.textFrom, -1) : line.from;
    if (start === head) return null;
    // `#` da solo è già un titolo vuoto: lo spazio che lo segue lo completa.
    const mark = prefix.marks.find((at) => at >= start)
      ?? (old && old.textFrom === before.to ? prefix.marks[prefix.marks.length - 1] : undefined);
    return mark === undefined ? null : { head, mark };
  },
});

/// Backspace all'inizio del testo, con il prefisso nascosto: subito dopo una
/// scorciatoia la rende testo, altrimenti toglie l'ultimo pezzo del prefisso.
export function prefixBackspace(state: EditorState): TransactionSpec | null {
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  const { head } = state.selection.main;
  const shortcut = state.field(typedShortcut, false);
  if (shortcut && shortcut.head === head) {
    return {
      changes: { from: shortcut.mark, insert: "\\" },
      selection: EditorSelection.cursor(head + 1),
      userEvent: "delete.backward",
      scrollIntoView: true,
    };
  }
  const prefix = blockPrefixAt(state, state.doc.lineAt(head));
  if (!prefix || prefix.textFrom !== head) return null;
  return {
    changes: { from: prefix.lastFrom, to: prefix.textFrom },
    selection: EditorSelection.cursor(prefix.lastFrom),
    userEvent: "delete.backward",
    scrollIntoView: true,
  };
}

/// Il cursore che finisce in un prefisso nascosto torna all'inizio del testo;
/// da lì una freccia a sinistra va alla riga prima, perché il prefisso non è
/// un posto dove stare. Il clic, che può cadere prima del pallino, va al testo.
function outOfPrefix(transaction: Transaction): Transaction | readonly [Transaction, TransactionSpec] {
  if (!transaction.selection) return transaction;
  const { state, startState } = transaction;
  if (state.facet(liveReveal) !== "mai") return transaction;
  const keyboard = transaction.isUserEvent("select") && !transaction.isUserEvent("select.pointer");
  let moved = false;
  const ranges = state.selection.ranges.map((range, index) => {
    const line = state.doc.lineAt(range.head);
    if (range.head >= line.from + 512) return range;
    const prefix = blockPrefixAt(state, line);
    if (!prefix || range.head >= prefix.textFrom) return range;
    let head = prefix.textFrom;
    const before = startState.selection.ranges[index]?.head;
    if (keyboard && !transaction.docChanged && before === prefix.textFrom && line.from > 0) head = line.from - 1;
    moved = true;
    return range.empty ? EditorSelection.cursor(head) : EditorSelection.range(range.anchor, head);
  });
  if (!moved) return transaction;
  return [transaction, { selection: EditorSelection.create(ranges, state.selection.mainIndex), sequential: true }];
}

/// Home: all'inizio del testo; con `elemento`, da lì, nel prefisso.
function home(extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const policy = state.facet(liveReveal);
    if (policy === "riga") return false;
    let handled = false;
    const selection = EditorSelection.create(state.selection.ranges.map((range) => {
      const line = state.doc.lineAt(range.head);
      // Una riga che va a capo nella vista ha più inizi: decide CodeMirror.
      if (view.lineWrapping && view.moveToLineBoundary(range, false).head !== line.from) return range;
      const prefix = blockPrefixAt(state, line);
      if (!prefix) return range;
      handled = true;
      const head = policy === "elemento" && range.head === prefix.textFrom ? line.from : prefix.textFrom;
      return extend ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    }), state.selection.mainIndex);
    if (!handled) return false;
    view.dispatch({ selection, scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

function backspace(view: EditorView): boolean {
  if (view.state.facet(liveReveal) === "riga" || view.state.readOnly) return false;
  const plan = prefixBackspace(view.state);
  if (!plan) return false;
  view.dispatch(plan);
  return true;
}

/// Le estensioni del prefisso, per la Live.
export function blockPrefixes(): Extension {
  return [
    typedShortcut,
    EditorState.transactionFilter.of(outOfPrefix),
    Prec.highest(keymap.of([
      { key: "Home", run: home(false), shift: home(true) },
      { key: "Backspace", run: backspace },
    ])),
  ];
}
