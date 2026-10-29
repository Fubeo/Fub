// La selezione di blocchi (H7): Esc seleziona il blocco del cursore, Shift-↑/↓
// allarga ai fratelli, ↑/↓ passano al blocco vicino, Canc e Backspace
// eliminano, Mod-d duplica, Invio ed Esc tornano al testo. È della superficie,
// come la selezione di testo: un altro riquadro sulla stessa nota non la vede.
// Sotto c'è una selezione di CodeMirror che copre i blocchi interi, così
// copiare, tagliare e incollare lavorano sul loro Markdown senza un ramo a
// parte; il campo dice soltanto che quella selezione è «di blocchi».
import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { liveStrings } from "../strings";
import { blockModel, type Block } from "./model";
import { type BlockRun, siblingsOf } from "./move";
import { modelOf } from "./transform";

/// I due capi della selezione, come inizio del blocco e profondità: si
/// spostano con le modifiche e si ritrovano nel modello nuovo.
export interface BlockSelection {
  readonly anchor: number;
  readonly head: number;
  readonly depth: number;
}

export const setBlockSelection = StateEffect.define<BlockSelection | null>();

/// Il blocco che comincia in `pos` alla profondità `depth`.
function blockStartingAt(blocks: readonly Block[], pos: number, depth: number): number {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.from > pos) break;
    if (block.from === pos && block.depth === depth) return i;
  }
  return -1;
}

/// La tratta di fratelli della selezione, in ordine di documento.
export function runOfSelection(blocks: readonly Block[], selection: BlockSelection): (BlockRun & { anchor: number; head: number }) | null {
  const anchor = blockStartingAt(blocks, selection.anchor, selection.depth);
  const head = blockStartingAt(blocks, selection.head, selection.depth);
  if (anchor < 0 || head < 0 || blocks[anchor]!.parent !== blocks[head]!.parent) return null;
  return { first: Math.min(anchor, head), last: Math.max(anchor, head), anchor, head };
}

/// I byte che la tratta copre.
export function spanOf(blocks: readonly Block[], run: BlockRun): { from: number; to: number } {
  return { from: blocks[run.first]!.from, to: blocks[run.last]!.to };
}

function stillCovers(state: EditorState, selection: BlockSelection): boolean {
  const blocks = state.field(blockModel).blocks;
  const run = runOfSelection(blocks, selection);
  if (!run) return false;
  const span = spanOf(blocks, run);
  const { ranges, main } = state.selection;
  return ranges.length === 1 && main.from === span.from && main.to === span.to;
}

export const blockSelection = StateField.define<BlockSelection | null>({
  create: () => null,
  update(value, tr: Transaction) {
    for (const effect of tr.effects) if (effect.is(setBlockSelection)) return effect.value;
    if (!value || (!tr.docChanged && !tr.selection)) return value;
    const mapped = {
      anchor: tr.changes.mapPos(value.anchor, 1),
      head: tr.changes.mapPos(value.head, 1),
      depth: value.depth,
    };
    // Resta finché la selezione sotto copre ancora quei blocchi: una battuta,
    // un clic o un incolla la fanno tornare testo.
    return stillCovers(tr.state, mapped) ? mapped : null;
  },
});

/// La transazione che seleziona la tratta `[anchor, head]` di fratelli.
export function selectBlocks(_state: EditorState, blocks: readonly Block[], anchor: number, head: number): TransactionSpec {
  const run = { first: Math.min(anchor, head), last: Math.max(anchor, head) };
  const span = spanOf(blocks, run);
  const count = siblingsOf(blocks, anchor).filter((i) => i >= run.first && i <= run.last).length;
  const value: BlockSelection = { anchor: blocks[anchor]!.from, head: blocks[head]!.from, depth: blocks[anchor]!.depth };
  return {
    selection: EditorSelection.single(span.from, span.to),
    effects: [setBlockSelection.of(value), EditorView.announce.of(selectedText(count))],
    scrollIntoView: true,
  };
}

function selectedText(count: number): string {
  return count === 1 ? liveStrings.t("blocks.selected.one") : liveStrings.t("blocks.selected.many", { count: String(count) });
}

/// Il blocco più interno sotto il cursore principale.
export function cursorBlock(state: EditorState, blocks: readonly Block[]): number {
  const head = state.selection.main.head;
  let found = -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.from > head) break;
    if (head <= block.to) found = i;
  }
  return found;
}

/// Le righe vuote che vanno via con la tratta: quelle dopo, o, se è
/// l'ultima dei fratelli, quelle prima.
function removalRange(state: EditorState, blocks: readonly Block[], run: BlockRun): { from: number; to: number } {
  const sibs = siblingsOf(blocks, run.first);
  const a = sibs.indexOf(run.first);
  const b = sibs.indexOf(run.last);
  const span = spanOf(blocks, run);
  if (b + 1 < sibs.length) return { from: span.from, to: blocks[sibs[b + 1]!]!.from };
  if (a > 0) return { from: blocks[sibs[a - 1]!]!.to, to: span.to };
  // L'unico figlio: via anche l'a capo che lo legava al genitore.
  if (blocks[run.first]!.parent >= 0) {
    const line = state.doc.lineAt(span.from);
    return { from: Math.max(0, line.from - 1), to: span.to };
  }
  return span;
}

/// Toglie la tratta con le sue righe vuote, in una transazione.
export function deleteRun(state: EditorState, blocks: readonly Block[], run: BlockRun): TransactionSpec {
  const range = removalRange(state, blocks, run);
  const count = siblingsOf(blocks, run.first).filter((i) => i >= run.first && i <= run.last).length;
  const text = count === 1 ? liveStrings.t("blocks.deleted.one") : liveStrings.t("blocks.deleted.many", { count: String(count) });
  return {
    changes: range,
    selection: EditorSelection.cursor(range.from),
    effects: [setBlockSelection.of(null), EditorView.announce.of(text)],
    userEvent: "delete.block",
    scrollIntoView: true,
  };
}

/// Mette una copia della tratta subito dopo, con le stesse righe vuote che la
/// separano dal fratello vicino, e seleziona la copia.
export function duplicateRun(state: EditorState, blocks: readonly Block[], run: BlockRun): TransactionSpec {
  const sibs = siblingsOf(blocks, run.first);
  const a = sibs.indexOf(run.first);
  const b = sibs.indexOf(run.last);
  const span = spanOf(blocks, run);
  const gap = b + 1 < sibs.length
    ? state.sliceDoc(span.to, blocks[sibs[b + 1]!]!.from)
    : a > 0 ? state.sliceDoc(blocks[sibs[a - 1]!]!.to, span.from) : blocks[run.first]!.parent >= 0 ? "\n" : "\n\n";
  const text = state.sliceDoc(span.from, span.to);
  const from = span.to + gap.length;
  const value: BlockSelection = { anchor: from, head: from + (blocks[run.last]!.from - span.from), depth: blocks[run.first]!.depth };
  return {
    changes: { from: span.to, insert: gap + text },
    selection: EditorSelection.single(from, from + text.length),
    effects: setBlockSelection.of(value),
    userEvent: "input.duplicate",
    scrollIntoView: true,
  };
}

type Command = (view: EditorView) => boolean;

/// Un comando che vale soltanto con una selezione di blocchi.
function whenSelected(run: (view: EditorView, blocks: readonly Block[], selected: ReturnType<typeof runOfSelection> & object) => boolean): Command {
  return (view) => {
    const value = view.state.field(blockSelection, false);
    if (!value) return false;
    const blocks = modelOf(view.state);
    const selected = runOfSelection(blocks, value);
    if (!selected) return false;
    return run(view, blocks, selected);
  };
}

/// Esc: seleziona il blocco del cursore. Con Vim acceso Esc è di Vim.
export const selectCursorBlock: Command = (view) => {
  if (view.composing || view.state.field(blockSelection, false) || vimOn(view)) return false;
  const blocks = modelOf(view.state);
  const index = cursorBlock(view.state, blocks);
  if (index < 0) return false;
  view.dispatch(selectBlocks(view.state, blocks, index, index));
  return true;
};

/// Vim acceso sull'editor, in qualunque modo. (La classe `cm-vimMode` non
/// basta: Vim la toglie nel modo inserimento.)
export function vimOn(view: EditorView): boolean {
  return getCM(view) != null;
}

/// Torna al testo, col cursore in fondo al blocco della testa.
const leave = whenSelected((view, blocks, selected) => {
  view.dispatch({ selection: EditorSelection.cursor(blocks[selected.head]!.to), effects: setBlockSelection.of(null), scrollIntoView: true });
  return true;
});

function step(dir: -1 | 1, extend: boolean): Command {
  return whenSelected((view, blocks, selected) => {
    const sibs = siblingsOf(blocks, selected.head);
    const at = sibs.indexOf(selected.head) + dir;
    if (at < 0 || at >= sibs.length) return true;
    const head = sibs[at]!;
    view.dispatch(selectBlocks(view.state, blocks, extend ? selected.anchor : head, head));
    return true;
  });
}

const remove = whenSelected((view, blocks, selected) => {
  if (view.state.readOnly) return false;
  view.dispatch(deleteRun(view.state, blocks, selected));
  return true;
});

const duplicate = whenSelected((view, blocks, selected) => {
  if (view.state.readOnly) return false;
  view.dispatch(duplicateRun(view.state, blocks, selected));
  return true;
});

export const blockSelectionKeys: readonly KeyBinding[] = [
  { key: "Escape", run: (view) => leave(view) || selectCursorBlock(view) },
  { key: "Enter", run: leave },
  { key: "ArrowUp", run: step(-1, false) },
  { key: "ArrowDown", run: step(1, false) },
  { key: "Shift-ArrowUp", run: step(-1, true) },
  { key: "Shift-ArrowDown", run: step(1, true) },
  { key: "Delete", run: remove },
  { key: "Backspace", run: remove },
  { key: "Mod-d", run: duplicate },
];

const selectedLine = Decoration.line({ class: "cm-fub-block-selected" });

const selectionDecorations = EditorView.decorations.compute([blockSelection, "doc"], (state): DecorationSet => {
  const value = state.field(blockSelection);
  if (!value) return Decoration.none;
  const blocks = state.field(blockModel).blocks;
  const run = runOfSelection(blocks, value);
  if (!run) return Decoration.none;
  const span = spanOf(blocks, run);
  const out = [];
  for (let n = state.doc.lineAt(span.from).number; n <= state.doc.lineAt(span.to).number; n++) {
    out.push(selectedLine.range(state.doc.line(n).from));
  }
  return Decoration.set(out);
});

/// Tagliare toglie anche le righe vuote che restavano; copiare scrive il
/// Markdown dei blocchi interi, che è già la selezione sotto.
const clipboard = EditorView.domEventHandlers({
  cut(event, view) {
    const value = view.state.field(blockSelection, false);
    if (!value || view.state.readOnly || !event.clipboardData) return false;
    const blocks = modelOf(view.state);
    const selected = runOfSelection(blocks, value);
    if (!selected) return false;
    const span = spanOf(blocks, selected);
    event.preventDefault();
    event.clipboardData.setData("text/plain", view.state.sliceDoc(span.from, span.to));
    view.dispatch({ ...deleteRun(view.state, blocks, selected), userEvent: "delete.cut" });
    return true;
  },
});

const attributes = EditorView.editorAttributes.compute([blockSelection], (state): Record<string, string> =>
  state.field(blockSelection) ? { class: "cm-fub-blocks-selecting" } : {});

export const blockSelectionExtension: Extension = [
  blockSelection,
  selectionDecorations,
  attributes,
  clipboard,
  Prec.high(keymap.of(blockSelectionKeys)),
];
