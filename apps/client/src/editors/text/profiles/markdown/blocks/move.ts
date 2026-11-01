// Spostare i blocchi (H5): un blocco si sposta con i suoi figli, fra i suoi
// fratelli — le voci sorelle dentro un elenco, i blocchi di primo livello
// fuori. Una transazione sola, un passo di annulla: i byte del blocco restano
// quelli, cambiano soltanto le righe vuote intorno, quanto serve perché il
// Markdown si legga ancora come prima. I numeri delle voci li sistema la
// rinumerazione (D4), che ascolta lo spostamento.
import { EditorSelection, type EditorState, type SelectionRange, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { blockGesture } from "../block-gesture";
import { type Block, type BlockKind } from "./model";
import { modelOf, touchedBlocks } from "./transform";

/// I fratelli di `index`: i blocchi con lo stesso genitore, in ordine.
export function siblingsOf(blocks: readonly Block[], index: number): number[] {
  const parent = blocks[index]!.parent;
  const out: number[] = [];
  for (let i = parent + 1; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.depth < blocks[index]!.depth) break;
    if (block.parent === parent) out.push(i);
  }
  return out;
}

const LISTISH: ReadonlySet<BlockKind> = new Set(["bullet", "ordered", "task"]);

/// Le righe vuote fra due blocchi che diventano vicini. Due voci tengono il
/// passo stretto dell'elenco; un blocco che non è una voce, accanto a un
/// altro, vuole una riga vuota, o il Markdown lo attaccherebbe al vicino.
function gapBetween(left: Block, right: Block, base: string): string {
  if (base.includes("\n\n")) return base;
  return LISTISH.has(left.kind) && LISTISH.has(right.kind) ? base : "\n\n";
}

/// Lo spostamento, con il posto nuovo di un punto dei blocchi spostati:
/// serve a chi deve portarsi dietro qualcosa, come la selezione di blocchi.
export interface MoveSpec extends TransactionSpec {
  follow(pos: number): number | null;
  /// Il contrario di `follow` per tutta la finestra riscritta: da dove viene,
  /// nel documento di prima, un punto del documento nuovo (`null` fuori dalla
  /// finestra). Serve a chi anima lo spostamento (N13).
  origin(pos: number): number | null;
  /// Dove stanno, nel documento nuovo, i blocchi spostati.
  moved: { from: number; to: number };
}

/// La transazione che porta i fratelli `[first, last]` (indici di blocco)
/// davanti al fratello `before`, o in fondo con `before === -1`. `null` se
/// non si muove niente.
export function moveSiblings(
  state: EditorState,
  blocks: readonly Block[],
  first: number,
  last: number,
  before: number,
): MoveSpec | null {
  const sibs = siblingsOf(blocks, first);
  const a = sibs.indexOf(first);
  const b = sibs.indexOf(last);
  const p = before === -1 ? sibs.length : sibs.indexOf(before);
  if (a < 0 || b < a || p < 0 || (p >= a && p <= b + 1)) return null;
  const doc = state.doc;
  const chunk = (k: number) => doc.sliceString(blocks[sibs[k]!]!.from, blocks[sibs[k]!]!.to);
  const gapAfter = (k: number) => (k + 1 < sibs.length ? doc.sliceString(blocks[sibs[k]!]!.to, blocks[sibs[k + 1]!]!.from) : null);
  const gapBefore = (k: number) => (k > 0 ? gapAfter(k - 1) : null);
  // La finestra che cambia: dal primo fratello toccato all'ultimo.
  const lo = Math.min(a, p);
  const hi = Math.max(b, p - 1);
  const order: number[] = [];
  for (let k = lo; k <= hi; k++) {
    if (k === p) for (let m = a; m <= b; m++) order.push(m);
    if (k < a || k > b) order.push(k);
  }
  if (p === hi + 1) for (let m = a; m <= b; m++) order.push(m);
  // I vicini fuori dalla finestra restano dove sono, ma le righe vuote che li
  // separano dalla finestra possono dover cambiare.
  if (lo > 0) order.unshift(lo - 1);
  if (hi + 1 < sibs.length) order.push(hi + 1);
  let text = "";
  let movedFrom = -1;
  // Ogni pezzo del testo nuovo con il suo posto di prima: i blocchi e, dopo
  // ciascuno, le righe vuote che venivano dopo di lui.
  const pieces: { at: number; length: number; old: number }[] = [];
  order.forEach((k, i) => {
    if (i > 0) {
      const prev = order[i - 1]!;
      const gap = prev + 1 === k
        ? gapAfter(prev)!
        : gapBetween(blocks[sibs[prev]!]!, blocks[sibs[k]!]!, gapAfter(prev) ?? gapBefore(prev) ?? gapBefore(k) ?? gapAfter(k) ?? "\n\n");
      pieces.push({ at: text.length, length: gap.length, old: blocks[sibs[prev]!]!.to });
      text += gap;
    }
    if (k === a) movedFrom = text.length;
    pieces.push({ at: text.length, length: chunk(k).length, old: blocks[sibs[k]!]!.from });
    text += chunk(k);
  });
  const from = blocks[sibs[Math.min(...order)]!]!.from;
  const to = blocks[sibs[Math.max(...order)]!]!.to;
  const movedStart = blocks[first]!.from;
  const movedEnd = blocks[last]!.to;
  // Il cursore e la selezione dentro i blocchi spostati li seguono.
  const follow = (pos: number) =>
    pos >= movedStart && pos <= movedEnd ? from + movedFrom + (pos - movedStart) : null;
  const ranges = state.selection.ranges.map((range: SelectionRange) => {
    const anchor = follow(range.anchor);
    const head = follow(range.head);
    return anchor !== null && head !== null ? EditorSelection.range(anchor, head) : null;
  });
  const changes = { from, to, insert: text };
  const selection = ranges.every((range) => range !== null)
    ? EditorSelection.create(ranges as SelectionRange[], state.selection.mainIndex)
    : undefined;
  const origin = (pos: number) => {
    const at = pos - from;
    if (at < 0 || at > text.length) return null;
    // Sul confine fra due pezzi vince quello che comincia lì.
    const piece = pieces.find((each) => at >= each.at && at < each.at + each.length) ??
      pieces.find((each) => at === each.at + each.length);
    return piece ? piece.old + (at - piece.at) : null;
  };
  const moved = { from: from + movedFrom, to: from + movedFrom + (movedEnd - movedStart) };
  // Di serie è uno scambio, come da tastiera; il rilascio lo ridice.
  const annotations = blockGesture.of({ kind: "swap", origin, lead: moved });
  return { changes, selection, userEvent: "move.block", scrollIntoView: true, annotations, follow, origin, moved };
}

/// La tratta di fratelli su cui lavora un comando: quella data, o il blocco
/// del cursore principale.
export type BlockRun = { readonly first: number; readonly last: number };

export function cursorRun(state: EditorState, blocks: readonly Block[]): BlockRun | null {
  const only = mainOnly(state);
  const touched = touchedBlocks(only, blocks);
  if (touched.length === 0) return null;
  return { first: touched[0]!, last: touched[0]! };
}

/// Lo stato con la sola selezione principale: i comandi dei blocchi lavorano
/// su un blocco, quello del cursore principale.
function mainOnly(state: EditorState): EditorState {
  if (state.selection.ranges.length === 1) return state;
  return state.update({ selection: EditorSelection.create([state.selection.main]) }).state;
}

/// Sposta la tratta di un fratello verso l'alto (`-1`) o verso il basso (`1`).
export function moveRun(state: EditorState, blocks: readonly Block[], run: BlockRun, dir: -1 | 1): MoveSpec | null {
  const sibs = siblingsOf(blocks, run.first);
  const a = sibs.indexOf(run.first);
  const b = sibs.indexOf(run.last);
  if (dir === -1) return a > 0 ? moveSiblings(state, blocks, run.first, run.last, sibs[a - 1]!) : null;
  if (b + 1 >= sibs.length) return null;
  return moveSiblings(state, blocks, run.first, run.last, b + 2 < sibs.length ? sibs[b + 2]! : -1);
}

/// `Mod-Shift-↑/↓`: il blocco del cursore, o la tratta che `run` dà, scambia
/// il posto col fratello vicino.
export function moveBlockBy(dir: -1 | 1): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const blocks = modelOf(state);
    const found = cursorRun(state, blocks);
    if (!found) return false;
    const spec = moveRun(state, blocks, found, dir);
    if (!spec) return false;
    dispatch(state.update(spec));
    return true;
  };
}
