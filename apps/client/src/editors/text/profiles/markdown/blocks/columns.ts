// Le colonne fatte coi blocchi (K3): «In colonne» nel menu del blocco, e un
// blocco lasciato sul bordo destro di un altro. Il file resta Markdown: un
// callout `[!columns]` con un `[!column]` annidato per colonna, da due a
// quattro, la stessa forma che la Lettura rende in griglia (`render.ts`).
import { ChangeSet, type ChangeSpec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { type Block } from "./model";
import { type BlockRun, siblingsOf } from "./move";

export const MAX_COLUMNS = 4;

const COLUMNS_HEAD = /^>[ \t]?\[!columns\][ \t]*$/i;
const COLUMN_HEAD = /^>[ \t]?>[ \t]?\[!column\][ \t]*$/i;

/// Quante colonne ha un blocco `[!columns]`; `null` se non lo è.
export function columnCount(state: EditorState, block: Block): number | null {
  if (block.kind !== "callout") return null;
  const lines = state.doc.sliceString(block.from, block.to).split(/\r?\n/);
  if (!COLUMNS_HEAD.test(lines[0] ?? "")) return null;
  return lines.filter((line) => COLUMN_HEAD.test(line)).length;
}

/// Un blocco che può diventare una colonna: di primo livello, non il
/// frontmatter e non a sua volta delle colonne.
function columnable(state: EditorState, block: Block): boolean {
  return block.parent === -1 && block.kind !== "frontmatter" && columnCount(state, block) === null;
}

/// Il testo di una colonna: il suo `[!column]` e le righe date, citate due volte.
function column(text: string, nl: string): string {
  const body = text.split(/\r?\n/).map((line) => (line === "" ? "> >" : `> > ${line}`));
  return [`> > [!column]`, ...body].join(nl);
}

const between = (nl: string) => `${nl}>${nl}`;

/// Le modifiche, più le righe vuote che staccano le colonne scritte in
/// `[from, to)` dai vicini: una voce accanto, attaccata, si leggerebbe dentro
/// il callout o lo chiuderebbe a metà.
function detached(state: EditorState, changes: ChangeSpec, from: number, to: number): ChangeSet {
  const set = state.changes(changes);
  const doc = set.apply(state.doc);
  const start = set.mapPos(from, -1);
  const end = set.mapPos(to, 1);
  const nl = state.lineBreak;
  const extra: { from: number; insert: string }[] = [];
  const first = doc.lineAt(start);
  if (first.number > 1 && doc.line(first.number - 1).text.trim() !== "") extra.push({ from: start, insert: nl });
  const last = doc.lineAt(end);
  if (last.number < doc.lines && doc.line(last.number + 1).text.trim() !== "") extra.push({ from: end, insert: nl });
  return set.compose(ChangeSet.of(extra, doc.length, nl));
}

/// I blocchi che «In colonne» mette uno per colonna: la tratta, se ha da due
/// a quattro blocchi; un blocco solo va accanto al fratello che lo segue.
/// `null` se non si può.
export function columnsRun(state: EditorState, blocks: readonly Block[], run: BlockRun): number[] | null {
  const sibs = siblingsOf(blocks, run.first);
  const a = sibs.indexOf(run.first);
  const b = sibs.indexOf(run.last);
  if (a < 0 || b < a) return null;
  const picked = a === b ? sibs.slice(a, a + 2) : sibs.slice(a, b + 1);
  if (picked.length < 2 || picked.length > MAX_COLUMNS) return null;
  return picked.every((index) => columnable(state, blocks[index]!)) ? picked : null;
}

/// «In colonne»: i fratelli dati (da `columnsRun`) diventano un `[!columns]`
/// con una colonna per blocco, al loro posto.
export function intoColumns(state: EditorState, blocks: readonly Block[], picked: readonly number[]): TransactionSpec {
  const nl = state.lineBreak;
  const doc = state.doc;
  const from = blocks[picked[0]!]!.from;
  const to = blocks[picked[picked.length - 1]!]!.to;
  const text = [`> [!columns]`, picked.map((i) => column(doc.sliceString(blocks[i]!.from, blocks[i]!.to), nl)).join(between(nl))].join(nl);
  return { changes: detached(state, { from, to, insert: text }, from, to), scrollIntoView: true, userEvent: "input.columns" };
}

/// Lasciare la tratta `run` sul bordo destro del blocco `target` (H5, K3): la
/// tratta diventa una colonna a destra del blocco. Un blocco qualunque fa col
/// lasciato due colonne; delle colonne con meno di quattro ne prendono una in
/// fondo. La tratta lascia il suo posto. `null` se non si può.
export function dropAsColumn(state: EditorState, blocks: readonly Block[], run: BlockRun, target: number): TransactionSpec | null {
  if (target >= run.first && target <= run.last) return null;
  const host = blocks[target];
  if (!host || host.parent !== -1 || host.kind === "frontmatter") return null;
  const sibs = siblingsOf(blocks, run.first);
  const a = sibs.indexOf(run.first);
  const b = sibs.indexOf(run.last);
  if (a < 0 || b < a || !sibs.includes(target)) return null;
  for (let k = a; k <= b; k++) if (!columnable(state, blocks[sibs[k]!]!)) return null;
  const count = columnCount(state, host);
  if (count !== null && count >= MAX_COLUMNS) return null;
  const nl = state.lineBreak;
  const doc = state.doc;
  const moving = doc.sliceString(blocks[run.first]!.from, blocks[run.last]!.to);
  const added = column(moving, nl);
  const insert = count === null
    ? [`> [!columns]`, [column(doc.sliceString(host.from, host.to), nl), added].join(between(nl))].join(nl)
    : doc.sliceString(host.from, host.to) + between(nl) + added;
  // La tratta se ne va con le righe vuote che la separavano dal vicino sopra,
  // o da quello sotto se è la prima.
  const gone = a > 0
    ? { from: blocks[sibs[a - 1]!]!.to, to: blocks[run.last]!.to }
    : { from: blocks[run.first]!.from, to: b + 1 < sibs.length ? blocks[sibs[b + 1]!]!.from : blocks[run.last]!.to };
  return {
    changes: detached(state, [gone, { from: host.from, to: host.to, insert }], host.from, host.to),
    scrollIntoView: true,
    userEvent: "move.drop",
  };
}
