// Spostare i blocchi (H5): un blocco si sposta con i suoi figli, fra i suoi
// fratelli — le voci sorelle dentro un elenco, i blocchi di primo livello
// fuori. Una transazione sola, un passo di annulla: i byte del blocco restano
// quelli, cambiano soltanto le righe vuote intorno, quanto serve perché il
// Markdown si legga ancora come prima. I numeri delle voci li sistema la
// rinumerazione (D4), che ascolta lo spostamento.
import { EditorSelection, type EditorState, type SelectionRange, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { blockGesture } from "../block-gesture";
import { withLineBreaks } from "../../../line-breaks";
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

/// Il frontmatter resta sempre il primo blocco della nota: se il primo fratello
/// è lui, nessun blocco gli passa davanti e lui non si sposta.
export function pinnedFirst(blocks: readonly Block[], sibs: readonly number[]): boolean {
  return sibs.length > 0 && blocks[sibs[0]!]!.kind === "frontmatter";
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
  // Il frontmatter non si muove, e niente gli passa davanti: `p === 0` è il posto prima di lui.
  if (pinnedFirst(blocks, sibs) && (a === 0 || p === 0)) return null;
  // Il testo nuovo si compone con "\n" (come `sliceString`): le sue
  // lunghezze sono posizioni del documento; gli a capo della nota li mette
  // `withLineBreaks` alla fine.
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
  const changes = { from, to, insert: withLineBreaks(state, text) };
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

// ── Annidare e portare fuori, dal trascinamento ─────────────────────────────

/// Le voci d'elenco: soltanto loro si annidano col gesto di lato.
export function isListItem(block: Block | undefined): boolean {
  return !!block && LISTISH.has(block.kind);
}

/// Il rientro di una riga: gli spazi e le tabulazioni in testa.
const leading = (line: string): string => /^[ \t]*/.exec(line)![0];

/// Il rientro dei figli di una voce: quello del primo figlio se ne ha, se no
/// quanto il segno della voce e il suo spazio («- », «1. »).
function childIndent(state: EditorState, blocks: readonly Block[], item: number): string | null {
  const child = blocks.findIndex((block) => block.parent === item);
  if (child >= 0) return leading(state.doc.lineAt(blocks[child]!.from).text);
  const head = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/.exec(state.doc.lineAt(blocks[item]!.from).text);
  return head ? head[1]! + " ".repeat(head[2]!.length + Math.min(4, head[3]!.length)) : null;
}

/// Il testo con il rientro `from` di ogni riga sostituito da `to`. Le righe
/// vuote restano vuote; una riga meno rientrata (una continuazione pigra)
/// prende comunque il rientro nuovo.
export function reindent(text: string, from: string, to: string): string {
  return text.split("\n").map((line) => {
    if (line.trim() === "") return line;
    return to + (line.startsWith(from) ? line.slice(from.length) : line.trimStart());
  }).join("\n");
}

/// Dove sparisce la tratta di fratelli, con le righe vuote che la staccavano
/// dal vicino sopra, o da quello sotto se è la prima. Se la tratta è tutte le
/// sorelle (i soli figli di una voce) se ne va anche l'a capo prima di lei:
/// la sua riga non resta lì vuota, a fare largo un elenco stretto.
function removalOf(state: EditorState, blocks: readonly Block[], run: BlockRun): { from: number; to: number } {
  const sibs = siblingsOf(blocks, run.first);
  const a = sibs.indexOf(run.first);
  const b = sibs.indexOf(run.last);
  if (a > 0) return { from: blocks[sibs[a - 1]!]!.to, to: blocks[run.last]!.to };
  const start = blocks[run.first]!.from;
  if (b + 1 >= sibs.length) {
    return { from: start > 0 ? state.doc.lineAt(start - 1).to : start, to: blocks[run.last]!.to };
  }
  return { from: start, to: Math.max(blocks[sibs[b + 1]!]!.from, blocks[run.last]!.to) };
}

/// Una modifica sola che toglie `gone` e mette `insert` (righe divise da
/// "\n") in `at`, fuori da `gone`; con dove comincia, nel documento nuovo, il
/// testo messo.
function relocate(state: EditorState, gone: { from: number; to: number }, at: number, insert: string): { changes: { from: number; to: number; insert: string }; placed: number } | null {
  const doc = state.doc;
  if (at > gone.from && at < gone.to) return null;
  if (at <= gone.from) {
    return { changes: { from: at, to: gone.to, insert: withLineBreaks(state, insert + doc.sliceString(at, gone.from)) }, placed: at };
  }
  const between = doc.sliceString(gone.to, at);
  return { changes: { from: gone.from, to: at, insert: withLineBreaks(state, between + insert) }, placed: gone.from + between.length };
}

/// Le righe della tratta sono tutte voci (i figli possono essere altro).
function allItems(blocks: readonly Block[], run: BlockRun): boolean {
  const parent = blocks[run.first]!.parent;
  for (let i = run.first; i <= run.last; i++) if (blocks[i]!.parent === parent && !isListItem(blocks[i])) return false;
  return true;
}

/// Il rilascio che annida la tratta `run` di voci sotto la voce sorella
/// `under`, in fondo ai suoi figli, col rientro dei figli. Un passo
/// d'annullamento. `null` se non si può.
export function nestRun(state: EditorState, blocks: readonly Block[], run: BlockRun, under: number): MoveSpec | null {
  const sibs = siblingsOf(blocks, run.first);
  if (!sibs.includes(under) || (under >= run.first && under <= run.last)) return null;
  if (!allItems(blocks, run) || !isListItem(blocks[under])) return null;
  const indent = childIndent(state, blocks, under);
  if (indent === null) return null;
  const moving = state.doc.sliceString(blocks[run.first]!.from, blocks[run.last]!.to);
  const base = leading(state.doc.lineAt(blocks[run.first]!.from).text);
  return relocated(state, blocks, run, blocks[under]!.to, reindent(moving, base, indent));
}

/// Il rilascio che porta fuori la tratta `run` di voci annidate: va subito
/// dopo la voce che la conteneva, col suo rientro. `null` se non si può.
export function outdentRun(state: EditorState, blocks: readonly Block[], run: BlockRun): MoveSpec | null {
  const parent = blocks[run.first]!.parent;
  if (parent < 0 || !isListItem(blocks[parent]) || !allItems(blocks, run)) return null;
  const moving = state.doc.sliceString(blocks[run.first]!.from, blocks[run.last]!.to);
  const base = leading(state.doc.lineAt(blocks[run.first]!.from).text);
  const indent = leading(state.doc.lineAt(blocks[parent]!.from).text);
  return relocated(state, blocks, run, blocks[parent]!.to, reindent(moving, base, indent));
}

function relocated(state: EditorState, blocks: readonly Block[], run: BlockRun, at: number, text: string): MoveSpec | null {
  const done = relocate(state, removalOf(state, blocks, run), at, "\n" + text);
  if (!done) return null;
  // Un a capo è una posizione, qualunque sia il separatore della nota.
  const movedFrom = done.placed + 1;
  const moved = { from: movedFrom, to: movedFrom + text.length };
  const start = blocks[run.first]!.from;
  const end = blocks[run.last]!.to;
  // Il cursore dentro la tratta va all'inizio della tratta nel posto nuovo.
  const follow = (pos: number) => (pos >= start && pos <= end ? movedFrom : null);
  const head = follow(state.selection.main.head);
  return {
    changes: done.changes,
    ...(head !== null ? { selection: EditorSelection.cursor(head) } : {}),
    userEvent: "move.drop",
    scrollIntoView: true,
    annotations: blockGesture.of({ kind: "drop", lead: moved }),
    follow,
    // Le righe riscritte non hanno un posto vecchio da dire: il moto le
    // ritrova riportando le posizioni attraverso la modifica.
    origin: () => null,
    moved,
  };
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

/// Il titolo di un blocco titolo, senza i segni.
export function headingText(state: EditorState, block: Block): string {
  return state.doc.lineAt(block.from).text.replace(/^\s*#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
}

/// Il titolo della sezione in cui cade `pos`: l'ultimo titolo prima di lui,
/// saltando la tratta `skip` (quella in mano, o quella appena spostata). `null` prima del primo titolo.
export function sectionAt(state: EditorState, blocks: readonly Block[], pos: number, skip: { from: number; to: number }): string | null {
  let found: string | null = null;
  for (const block of blocks) {
    if (block.from >= pos) break;
    if (block.kind !== "heading" || (block.from >= skip.from && block.from <= skip.to)) continue;
    found = headingText(state, block);
  }
  return found;
}
