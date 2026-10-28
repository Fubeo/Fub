// La selezione di celle delle tabelle del documento, nel modo «documento»
// della Tabella (`tabella/keys.ts`): il cursore resta nel testo della cella,
// e Maiusc con una freccia che esce dalla cella, o il trascinamento da una
// cella all'altra, sceglie un rettangolo di celle. Su quel rettangolo Canc
// svuota, Ctrl+C e Ctrl+X passano TSV e una tabella HTML, e «Unisci celle»
// unisce una riga.
//
// Non è una `Selection` di ProseMirror: è uno stato del plugin accanto alla
// selezione di testo, che resta nella cella attiva. Ogni modifica del
// documento, ogni selezione nuova dalla tastiera e ogni clic lo spengono.
// Il perché di non usare `prosemirror-tables` sta nell'ADR 0225.

import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { clipboardData } from "../../tabella/clipboard";
import { documentIntent } from "../../tabella/keys";
import type { Cell, Range } from "../../tabella/navigation";
import { rangeBetween, touches } from "../../tabella/selection";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { richSchema } from "./schema";

const { para, row: rowType, cell: cellType, table: tableType } = richSchema.nodes;

/// Una cella con la sua colonna visiva: una cella unita copre `span` colonne.
export interface CellBox {
  readonly row: number;
  readonly index: number;
  readonly column: number;
  readonly span: number;
  readonly pos: number;
  readonly node: PmNode;
}

/// Le celle di una tabella, riga per riga.
export function cellBoxes(table: PmNode, tablePos: number): CellBox[] {
  const boxes: CellBox[] = [];
  let rowPos = tablePos + 1;
  table.forEach((row, _offset, r) => {
    let pos = rowPos + 1;
    let column = 0;
    row.forEach((node, _cellOffset, index) => {
      const span = (node.attrs.span as number | undefined) ?? 1;
      boxes.push({ row: r, index, column, span, pos, node });
      column += span;
      pos += node.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return boxes;
}

/// La cella di `$pos`, con la sua tabella.
export function cellAt($pos: ResolvedPos): { readonly table: PmNode; readonly tablePos: number; readonly box: CellBox } | null {
  for (let depth = $pos.depth; depth > 1; depth -= 1) {
    if ($pos.node(depth).type !== cellType || $pos.node(depth - 1).type !== rowType || $pos.node(depth - 2).type !== tableType) continue;
    const table = $pos.node(depth - 2);
    const tablePos = $pos.before(depth - 2);
    const cellPos = $pos.before(depth);
    const box = cellBoxes(table, tablePos).find((candidate) => candidate.pos === cellPos);
    return box ? { table, tablePos, box } : null;
  }
  return null;
}

interface CellState {
  /// La tabella, l'àncora e la cella attiva, in colonne visive.
  readonly cells: { readonly tablePos: number; readonly anchor: Cell; readonly head: Cell } | null;
}

const cellKey = new PluginKey<CellState>("rich-cell-selection");
const NONE: CellState = { cells: null };

/// Le celle scelte adesso, se ce ne sono più di una.
export function selectedCells(state: EditorState): { readonly table: PmNode; readonly tablePos: number; readonly range: Range; readonly boxes: CellBox[] } | null {
  const cells = cellKey.getState(state)?.cells;
  if (!cells) return null;
  const table = state.doc.nodeAt(cells.tablePos);
  if (table?.type !== tableType) return null;
  const range = rangeBetween(cells.anchor, cells.head);
  const boxes = cellBoxes(table, cells.tablePos).filter((box) => touches(range, box.row, box.column, box.row, box.column + box.span - 1));
  return boxes.length > 1 ? { table, tablePos: cells.tablePos, range, boxes } : null;
}

/// La cella che copre la colonna `column` della riga `row`.
function boxCovering(boxes: readonly CellBox[], row: number, column: number): CellBox | undefined {
  return boxes.find((box) => box.row === row && column >= box.column && column < box.column + box.span);
}

/// Sceglie le celle da `anchor` a `head` nella tabella in `tablePos`, col
/// cursore nella cella attiva.
function selectCells(state: EditorState, tablePos: number, anchor: Cell, head: Cell): Transaction {
  const table = state.doc.nodeAt(tablePos)!;
  const box = boxCovering(cellBoxes(table, tablePos), head.row, head.column);
  const tr = state.tr.setMeta(cellKey, { cells: { tablePos, anchor, head } } satisfies CellState);
  if (box) tr.setSelection(TextSelection.near(tr.doc.resolve(box.pos + 1)));
  return tr;
}

/// Svuota le celle scelte: ognuna resta, con un paragrafo vuoto come il suo
/// primo.
export function clearCells(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const selected = selectedCells(state);
  if (!selected) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const box of [...selected.boxes].reverse()) {
      const first = box.node.firstChild;
      const empty = para.create(first?.type === para ? first.attrs : null);
      tr.replaceWith(box.pos + 1, box.pos + box.node.nodeSize - 1, empty);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/// Il testo delle celle scelte, riga per riga: per gli appunti.
function selectedRows(state: EditorState): { input: string; shown: string }[][] {
  const selected = selectedCells(state);
  if (!selected) return [];
  const rows: { input: string; shown: string }[][] = [];
  for (const box of selected.boxes) {
    const line = (rows[box.row - selected.range.r0] ??= []);
    const blocks: string[] = [];
    box.node.forEach((block) => blocks.push(block.textContent));
    const text = blocks.join("\n");
    line.push({ input: text, shown: text });
  }
  return rows.filter((line) => line !== undefined);
}

/// Se il cursore sta all'inizio o alla fine del testo della sua cella.
function edges(state: EditorState, box: CellBox): { start: boolean; end: boolean } {
  const { from, to } = state.selection;
  const start = TextSelection.near(state.doc.resolve(box.pos + 1)).from;
  const end = TextSelection.near(state.doc.resolve(box.pos + box.node.nodeSize - 1), -1).to;
  return { start: from <= start, end: to >= end };
}

function onKey(view: EditorView, event: KeyboardEvent): boolean {
  const state = view.state;
  const active = cellKey.getState(state)?.cells ?? null;
  if (active && (event.key === "Delete" || event.key === "Backspace") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return clearCells(state, view.dispatch);
  }
  if (event.key === "Tab") return false;
  const here = cellAt(state.selection.$head);
  if (!here) return false;
  const intent = documentIntent(event, active ? { start: true, end: true } : edges(state, here.box));
  if (intent?.kind !== "move") return false;
  const boxes = cellBoxes(here.table, here.tablePos);
  const rows = here.table.childCount;
  const columns = Math.max(...boxes.map((box) => box.column + box.span));
  const anchor = active ?? { tablePos: here.tablePos, anchor: { row: here.box.row, column: here.box.column }, head: { row: here.box.row, column: here.box.column } };
  const head = { row: anchor.head.row + intent.rows, column: anchor.head.column + intent.columns };
  if (head.row < 0 || head.row >= rows || head.column < 0 || head.column >= columns) return active !== null;
  // Una cella unita si attraversa tutta: la colonna dopo è oltre la sua fine.
  const over = boxCovering(boxes, anchor.head.row, anchor.head.column);
  if (over && intent.columns > 0) head.column = Math.min(columns - 1, over.column + over.span);
  if (!boxCovering(boxes, head.row, head.column)) return active !== null;
  view.dispatch(selectCells(state, anchor.tablePos, anchor.anchor, head));
  return true;
}

function copyCells(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const rows = selectedRows(view.state);
  if (rows.length === 0 || !event.clipboardData) return false;
  event.preventDefault();
  const data = clipboardData(rows);
  event.clipboardData.setData("text/plain", data.text);
  event.clipboardData.setData("text/html", data.html);
  if (cut && view.editable) clearCells(view.state, view.dispatch);
  return true;
}

/// Il trascinamento da una cella all'altra: finché il puntatore resta nella
/// cella di partenza è una selezione di testo; appena passa in un'altra della
/// stessa tabella diventa di celle.
class CellDrag {
  readonly #view: EditorView;
  readonly #life: Lifetime;
  #drag: Lifetime | null = null;

  constructor(view: EditorView) {
    this.#view = view;
    this.#life = openLifetime();
    this.#life.listen(view.dom, "mousedown", (event) => this.#start(event));
  }

  #start(event: MouseEvent): void {
    const view = this.#view;
    // Un clic nuovo spegne le celle: le selezioni del puntatore dopo, no.
    if (cellKey.getState(view.state)?.cells) view.dispatch(view.state.tr.setMeta(cellKey, NONE));
    if (event.button !== 0 || event.shiftKey) return;
    const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const from = at ? cellAt(view.state.doc.resolve(at.pos)) : null;
    if (!from) return;
    this.#drag?.close();
    const drag = openLifetime();
    this.#drag = drag;
    const doc = view.dom.ownerDocument;
    const anchor = { row: from.box.row, column: from.box.column };
    let celled = false;
    drag.listen(doc, "mousemove", (move) => {
      const over = view.posAtCoords({ left: move.clientX, top: move.clientY });
      const to = over ? cellAt(view.state.doc.resolve(over.pos)) : null;
      if (!to || to.tablePos !== from.tablePos) return;
      if (!celled && to.box.pos === from.box.pos) return;
      const head = { row: to.box.row, column: to.box.column };
      const current = cellKey.getState(view.state)?.cells;
      if (current && current.head.row === head.row && current.head.column === head.column) return;
      celled = true;
      view.dispatch(selectCells(view.state, from.tablePos, anchor, head));
    });
    drag.listen(doc, "mouseup", () => {
      drag.close();
      if (this.#drag === drag) this.#drag = null;
    });
  }

  destroy(): void {
    this.#drag?.close();
    this.#life.close();
  }
}

export const cellSelectionPlugin = new Plugin<CellState>({
  key: cellKey,
  state: {
    init: () => NONE,
    apply(tr, value) {
      const meta = tr.getMeta(cellKey) as CellState | undefined;
      if (meta) return meta;
      // Mentre si trascina il browser allarga la sua selezione di testo: le
      // selezioni del puntatore non spengono le celle, il clic dopo sì.
      if (tr.docChanged || (tr.selectionSet && !tr.getMeta("pointer"))) return value.cells ? NONE : value;
      return value;
    },
  },
  view: (view) => new CellDrag(view),
  props: {
    handleKeyDown: onKey,
    handleDOMEvents: {
      copy: (view, event) => copyCells(view, event, false),
      cut: (view, event) => copyCells(view, event, true),
    },
    decorations(state) {
      const selected = selectedCells(state);
      if (!selected) return null;
      return DecorationSet.create(state.doc, [
        Decoration.node(selected.tablePos, selected.tablePos + selected.table.nodeSize, { class: "has-cell-selection" }),
        ...selected.boxes.map((box) => Decoration.node(box.pos, box.pos + box.node.nodeSize, { class: "is-cell-selected" })),
      ]);
    },
  },
});
