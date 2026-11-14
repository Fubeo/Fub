// La selezione di celle delle tabelle del documento, nel modo «documento»
// della Tabella (`tabella/keys.ts`): il cursore resta nel testo della cella,
// e Maiusc con una freccia che esce dalla cella, o il trascinamento da una
// cella all'altra, sceglie un rettangolo di celle. Su quel rettangolo valgono
// i gesti del foglio (`documentIntent`): Canc svuota, Ctrl+C e Ctrl+X passano
// TSV e una tabella HTML, Invio e Tab fanno girare la cella attiva, Ctrl+D e
// Ctrl+R riempiono, Ctrl+«+» e Ctrl+«−» inseriscono e tolgono righe o
// colonne, Maiusc+F8 aggiunge intervalli; Ctrl+Spazio e Ctrl+Maiusc+Spazio
// scelgono la colonna e la tabella anche senza celle scelte. «Unisci celle»
// unisce una riga.
//
// Taglia non svuota: segna le celle (`is-cell-cut`), e l'incolla che segue le
// sposta in un passo solo; Escape rinuncia, e ogni modifica del documento
// toglie il segno.
//
// Non è una `Selection` di ProseMirror: è uno stato del plugin accanto alla
// selezione di testo, che resta nella cella attiva. I gesti sulle celle le
// tengono scelte, come nei fogli di calcolo; ogni altra modifica del
// documento, ogni selezione nuova dalla tastiera e ogni clic le spengono. Il
// segno del taglio lo spengono soltanto le modifiche. Ogni gesto è una
// transazione sola: Ctrl+Z lo annulla in un passo.
// Il perché di non usare `prosemirror-tables` sta nell'ADR 0225.

import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { TableCaps, TableEdit } from "../../tabella/adapter";
import { clipboardData, cutDestination, cutMoves, type CutMark } from "../../tabella/clipboard";
import { structureEdit } from "../../tabella/commands";
import { documentIntent } from "../../tabella/keys";
import { isMultiCell, nextInRange, type Cell, type Move, type Range, type Shape } from "../../tabella/navigation";
import { fillCopy, rangeBetween, touches, wholeRange, withRange } from "../../tabella/selection";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { richSchema } from "./schema";

const { para, row: rowType, cell: cellType, table: tableType } = richSchema.nodes;

/// Le capacità della tabella del documento per i gesti del foglio: righe e
/// colonne si inseriscono e si tolgono; non c'è una riga d'intestazione.
export const DOCUMENT_TABLE_CAPS: TableCaps = {
  insertRows: true,
  deleteRows: true,
  moveRows: true,
  insertColumns: true,
  deleteColumns: true,
  moveColumns: true,
  sort: false,
  align: false,
  merge: true,
  headerRows: 0,
};

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

/// Le celle scelte: la tabella, l'àncora e l'altro angolo dell'intervallo in
/// cui si lavora (in colonne visive), la cella attiva quando Invio o Tab la
/// fanno girare, gli altri intervalli e se se ne stanno aggiungendo.
interface ChosenCells {
  readonly tablePos: number;
  readonly anchor: Cell;
  readonly head: Cell;
  readonly active?: Cell;
  readonly others: readonly Range[];
  readonly adding: boolean;
}

interface CellState {
  readonly cells: ChosenCells | null;
  /// Le celle tagliate in attesa di un incolla, nella tabella `tablePos`.
  readonly cut: (CutMark & { readonly tablePos: number }) | null;
}

const cellKey = new PluginKey<CellState>("rich-cell-selection");
const NONE: CellState = { cells: null, cut: null };

/// Le celle scelte adesso, se ce ne sono più di una (o più intervalli, o se
/// se ne stanno aggiungendo). `boxes` sono quelle dell'intervallo in cui si
/// lavora; `active` è la cella attiva, dove sta il cursore.
export function selectedCells(state: EditorState): {
  readonly table: PmNode;
  readonly tablePos: number;
  readonly range: Range;
  readonly active: Cell;
  readonly others: readonly Range[];
  readonly boxes: CellBox[];
} | null {
  const cells = cellKey.getState(state)?.cells;
  if (!cells) return null;
  const table = state.doc.nodeAt(cells.tablePos);
  if (table?.type !== tableType) return null;
  const range = rangeBetween(cells.anchor, cells.head);
  const boxes = boxesIn(cellBoxes(table, cells.tablePos), range);
  if (boxes.length <= 1 && cells.others.length === 0 && !cells.adding) return null;
  return { table, tablePos: cells.tablePos, range, active: cells.active ?? cells.anchor, others: cells.others, boxes };
}

/// Le celle segnate dal taglio, o `null`.
export function cutCells(state: EditorState): Range | null {
  return cellKey.getState(state)?.cut?.range ?? null;
}

function boxesIn(boxes: readonly CellBox[], range: Range): CellBox[] {
  return boxes.filter((box) => touches(range, box.row, box.column, box.row, box.column + box.span - 1));
}

/// La cella che copre la colonna `column` della riga `row`.
function boxCovering(boxes: readonly CellBox[], row: number, column: number): CellBox | undefined {
  return boxes.find((box) => box.row === row && column >= box.column && column < box.column + box.span);
}

/// Righe e colonne visive della tabella.
function tableSize(table: PmNode, boxes: readonly CellBox[]): { readonly rows: number; readonly columns: number } {
  return { rows: table.childCount, columns: Math.max(...boxes.map((box) => box.column + box.span)) };
}

/// Le celle scelte diventano `cells`, col cursore nella cella attiva (di
/// solito l'àncora, come nei fogli di calcolo). Il segno del taglio resta,
/// se `tr` non cambia il documento.
function chooseCells(state: EditorState, cells: ChosenCells, tr: Transaction = state.tr): Transaction {
  const table = tr.doc.nodeAt(cells.tablePos)!;
  const active = cells.active ?? cells.anchor;
  const box = boxCovering(cellBoxes(table, cells.tablePos), active.row, active.column);
  const cut = tr.docChanged ? null : cellKey.getState(state)?.cut ?? null;
  tr.setMeta(cellKey, { cells, cut } satisfies CellState);
  if (box) tr.setSelection(TextSelection.near(tr.doc.resolve(box.pos + 1)));
  return tr;
}

/// Un cambio delle celle che tiene le celle scelte (e niente segno).
function keepCells(tr: Transaction, cells: ChosenCells | null): Transaction {
  return tr.setMeta(cellKey, { cells, cut: null } satisfies CellState);
}

/// Riscrive le celle `boxes` con il contenuto che `content` dà a ognuna (o
/// `null` per lasciarla), dalla fine così le posizioni restano buone. Si
/// riscrive l'interno, così le celle e la tabella in `tablePos` restano dove
/// sono; il cursore torna nella cella `cursor`.
function rewriteCells(
  tr: Transaction,
  tablePos: number,
  boxes: readonly CellBox[],
  content: (box: CellBox) => PmNode | null,
  cursor: Cell,
): void {
  for (const box of [...boxes].sort((a, b) => b.pos - a.pos)) {
    const next = content(box);
    if (next) tr.replaceWith(box.pos + 1, box.pos + box.node.nodeSize - 1, next.content);
  }
  const box = boxCovering(cellBoxes(tr.doc.nodeAt(tablePos)!, tablePos), cursor.row, cursor.column);
  if (box) tr.setSelection(TextSelection.near(tr.doc.resolve(box.pos + 1)));
}

/// Una cella come `box`, vuota: un paragrafo vuoto come il suo primo.
function emptied(box: CellBox): PmNode {
  const first = box.node.firstChild;
  return cellType.create(box.node.attrs, para.create(first?.type === para ? first.attrs : null));
}

/// Svuota le celle scelte, in tutti gli intervalli: ognuna resta, con un
/// paragrafo vuoto come il suo primo, e resta scelta.
export function clearCells(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const selected = selectedCells(state);
  if (!selected) return false;
  if (dispatch) {
    const all = cellBoxes(selected.table, selected.tablePos);
    const chosen = all.filter((box) => [selected.range, ...selected.others]
      .some((range) => touches(range, box.row, box.column, box.row, box.column + box.span - 1)));
    const tr = state.tr;
    rewriteCells(tr, selected.tablePos, chosen, emptied, selected.active);
    // Come nei fogli di calcolo le celle restano scelte.
    dispatch(keepCells(tr, cellKey.getState(state)?.cells ?? null).scrollIntoView());
  }
  return true;
}

/// Il testo di una cella, coi blocchi a capo.
function cellText(box: CellBox): string {
  const blocks: string[] = [];
  box.node.forEach((block) => blocks.push(block.textContent));
  return blocks.join("\n");
}

/// Il testo delle celle di `range`, riga per riga: per gli appunti.
function rangeRows(table: PmNode, tablePos: number, range: Range): { input: string; shown: string }[][] {
  const rows: { input: string; shown: string }[][] = [];
  for (const box of boxesIn(cellBoxes(table, tablePos), range)) {
    const line = (rows[box.row - range.r0] ??= []);
    const text = cellText(box);
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

/// I passi fra righe e colonne di una tabella senza nascoste.
function shapeOf(size: { readonly rows: number; readonly columns: number }): Shape {
  return {
    step: (axis, from, step) => {
      const next = from + step;
      return next >= 0 && next < (axis === "row" ? size.rows : size.columns) ? next : from;
    },
    visible: () => true,
  };
}

function onKey(view: EditorView, event: KeyboardEvent): boolean {
  const state = view.state;
  const plugin = cellKey.getState(state) ?? NONE;
  const chosen = plugin.cells;
  if (chosen && (event.key === "Delete" || event.key === "Backspace") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return clearCells(state, view.dispatch);
  }
  const here = cellAt(state.selection.$head);
  if (!here) {
    if (event.key === "Escape" && plugin.cut) {
      view.dispatch(state.tr.setMeta(cellKey, { ...plugin, cut: null } satisfies CellState));
      return true;
    }
    return false;
  }
  const multi = selectedCells(state);
  const intent = documentIntent(event, chosen ? { start: true, end: true } : edges(state, here.box), {
    cells: multi !== null,
    adding: chosen?.adding ?? false,
  });
  if (!intent) return false;
  const boxes = cellBoxes(here.table, here.tablePos);
  const size = tableSize(here.table, boxes);
  const own = chosen && chosen.tablePos === here.tablePos ? chosen : null;
  const current = own ?? { tablePos: here.tablePos, anchor: { row: here.box.row, column: here.box.column }, head: { row: here.box.row, column: here.box.column }, others: [], adding: false };
  const range = rangeBetween(current.anchor, current.head);
  const active = current.active ?? current.anchor;
  const bounds: Range = { r0: 0, c0: 0, r1: size.rows - 1, c1: size.columns - 1 };
  switch (intent.kind) {
    case "leave": {
      // Prima il segno del taglio, poi gli altri intervalli, poi le celle.
      if (plugin.cut) {
        view.dispatch(state.tr.setMeta(cellKey, { ...plugin, cut: null } satisfies CellState));
        return true;
      }
      if (own && (own.others.length > 0 || own.adding)) {
        view.dispatch(chooseCells(state, { ...own, others: [], adding: false }));
        return true;
      }
      if (multi) {
        view.dispatch(state.tr.setMeta(cellKey, { ...plugin, cells: null } satisfies CellState));
        return true;
      }
      return false;
    }
    case "tab":
    case "enter": {
      if (!multi || !isMultiCell(range)) return false;
      const move: Move = intent.kind === "tab" ? (intent.step > 0 ? "right" : "left") : (intent.step > 0 ? "down" : "up");
      view.dispatch(chooseCells(state, { ...current, active: nextInRange(range, active, move, shapeOf(size)) }));
      return true;
    }
    case "whole": {
      const whole = wholeRange(range, intent.which, bounds);
      view.dispatch(chooseCells(state, {
        ...current,
        anchor: { row: whole.r0, column: whole.c0 },
        head: { row: whole.r1, column: whole.c1 },
        active: touches(whole, active.row, active.column) ? active : undefined,
        others: current.adding ? current.others : [],
      }));
      return true;
    }
    case "add-ranges": {
      const adding = !current.adding;
      view.dispatch(chooseCells(state, { ...current, adding, others: adding ? withRange(current.others, range) : current.others }));
      return true;
    }
    case "fill": {
      if (!view.editable || current.others.length > 0) return true;
      const copy = fillCopy(range, intent.direction, 0);
      if (!copy) return true;
      const sourceOf = (box: CellBox) => intent.direction === "down"
        ? boxCovering(boxes, copy.source.r0, box.column)
        : boxCovering(boxes, box.row, copy.source.c0);
      const tr = state.tr;
      rewriteCells(tr, here.tablePos, boxesIn(boxes, copy.target), (box) => {
        const source = sourceOf(box);
        return source && source.pos !== box.pos ? cellType.create(box.node.attrs, source.node.content) : null;
      }, active);
      view.dispatch(keepCells(tr, own).scrollIntoView());
      return true;
    }
    case "structure": {
      if (!view.editable || current.others.length > 0) return true;
      const change = structureEdit({ range, active, size, caps: DOCUMENT_TABLE_CAPS }, intent.change);
      if (!change) return true;
      const tr = state.tr;
      if (!applyStructure(tr, here.table, here.tablePos, change.edit)) return true;
      view.dispatch(chooseCells(state, {
        tablePos: here.tablePos,
        anchor: change.select.anchor,
        head: change.select.focus,
        others: [],
        adding: false,
      }, tr).scrollIntoView());
      return true;
    }
    case "move": {
      const from = intent.extend ? current.head : active;
      const head = { row: from.row + intent.rows, column: from.column + intent.columns };
      if (head.row < 0 || head.row >= size.rows || head.column < 0 || head.column >= size.columns) return own !== null;
      // Una cella unita si attraversa tutta: la colonna dopo è oltre la sua fine.
      const over = boxCovering(boxes, from.row, from.column);
      if (over && intent.columns > 0) head.column = Math.min(size.columns - 1, over.column + over.span);
      if (!boxCovering(boxes, head.row, head.column)) return own !== null;
      view.dispatch(chooseCells(state, intent.extend
        ? { ...current, head, active: undefined }
        : { ...current, anchor: head, head, active: undefined }));
      return true;
    }
    default:
      return false;
  }
}

/// Le righe e le colonne che Ctrl+«+» e Ctrl+«−» inseriscono o tolgono. Le
/// colonne si toccano soltanto dove nessuna cella è unita, come i comandi
/// delle colonne. `false` se il cambio non si può fare.
function applyStructure(tr: Transaction, table: PmNode, tablePos: number, edit: TableEdit): boolean {
  const rows: PmNode[] = [];
  table.forEach((row) => rows.push(row));
  const even = rows.every((row) => row.childCount === rows[0]!.childCount && Array.from({ length: row.childCount }, (_, c) => row.child(c)).every((cell) => cell.attrs.span === 1));
  const emptyCell = (cell: PmNode) => {
    const first = cell.firstChild;
    return cellType.create({ ...cell.attrs, k: null }, para.create(first?.type === para ? first.attrs : null));
  };
  const emptyRow = (like: PmNode) => {
    const cells: PmNode[] = [];
    like.forEach((cell) => cells.push(emptyCell(cell)));
    return rowType.create({ ...like.attrs, k: null }, cells);
  };
  let next: PmNode[];
  switch (edit.kind) {
    case "insert-rows": {
      const like = rows[Math.min(edit.at, rows.length - 1)]!;
      next = [...rows.slice(0, edit.at), ...Array.from({ length: edit.count }, () => emptyRow(like)), ...rows.slice(edit.at)];
      break;
    }
    case "delete-rows":
      next = rows.filter((_, index) => index < edit.from || index > edit.to);
      if (next.length === 0) return false;
      break;
    case "insert-columns": {
      if (!even) return false;
      next = rows.map((row) => {
        const cells: PmNode[] = [];
        row.forEach((cell) => cells.push(cell));
        const like = cells[Math.min(edit.at, cells.length - 1)]!;
        cells.splice(edit.at, 0, ...Array.from({ length: edit.count }, () => emptyCell(like)));
        return rowType.create(row.attrs, cells);
      });
      break;
    }
    case "delete-columns": {
      if (!even || edit.to - edit.from + 1 >= rows[0]!.childCount) return false;
      next = rows.map((row) => {
        const cells: PmNode[] = [];
        row.forEach((cell, _offset, index) => {
          if (index < edit.from || index > edit.to) cells.push(cell);
        });
        return rowType.create(row.attrs, cells);
      });
      break;
    }
    default:
      return false;
  }
  tr.replaceWith(tablePos, tablePos + table.nodeSize, tableType.create(table.attrs, next));
  return true;
}

function copyCells(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const selected = selectedCells(view.state);
  if (!selected || !event.clipboardData) return false;
  event.preventDefault();
  // Come nei fogli di calcolo: più intervalli non si copiano insieme.
  if (selected.others.length > 0) return true;
  const data = clipboardData(rangeRows(selected.table, selected.tablePos, selected.range));
  event.clipboardData.setData("text/plain", data.text);
  event.clipboardData.setData("text/html", data.html);
  const plugin = cellKey.getState(view.state) ?? NONE;
  const mark = cut && view.editable ? { range: selected.range, text: data.text, tablePos: selected.tablePos } : null;
  view.dispatch(view.state.tr.setMeta(cellKey, { ...plugin, cut: mark } satisfies CellState));
  return true;
}

/// L'incolla dopo un taglio: se gli appunti e le celle tagliate dicono
/// ancora il taglio, il loro contenuto va all'angolo della selezione e le
/// celle tagliate che restano fuori si svuotano, in un passo solo. Fuori dalla
/// tabella, o oltre il suo bordo, l'incolla resta quello del testo.
function pasteCut(view: EditorView, event: ClipboardEvent): boolean {
  const state = view.state;
  const mark = cellKey.getState(state)?.cut;
  if (!mark || !event.clipboardData || !view.editable) return false;
  const table = state.doc.nodeAt(mark.tablePos);
  const here = cellAt(state.selection.$head);
  if (table?.type !== tableType || !here || here.tablePos !== mark.tablePos) return false;
  const now = clipboardData(rangeRows(table, mark.tablePos, mark.range)).text;
  if (!cutMoves(mark, event.clipboardData.getData("text/plain"), now)) return false;
  const selected = selectedCells(state);
  const target = selected?.range ?? { r0: here.box.row, c0: here.box.column, r1: here.box.row, c1: here.box.column };
  const destination = cutDestination(mark.range, target);
  const boxes = cellBoxes(table, mark.tablePos);
  const size = tableSize(table, boxes);
  if (destination.r1 >= size.rows || destination.c1 >= size.columns) return false;
  event.preventDefault();
  const sources = boxesIn(boxes, mark.range);
  const content = (box: CellBox): PmNode | null => {
    if (touches(destination, box.row, box.column)) {
      const source = boxCovering(sources, box.row - destination.r0 + mark.range.r0, box.column - destination.c0 + mark.range.c0);
      return source ? cellType.create(box.node.attrs, source.node.content) : emptied(box);
    }
    return touches(mark.range, box.row, box.column) ? emptied(box) : null;
  };
  const tr = state.tr;
  rewriteCells(tr, mark.tablePos, boxes, content, { row: destination.r0, column: destination.c0 });
  view.dispatch(chooseCells(state, {
    tablePos: mark.tablePos,
    anchor: { row: destination.r0, column: destination.c0 },
    head: { row: destination.r1, column: destination.c1 },
    others: [],
    adding: false,
  }, tr).scrollIntoView());
  return true;
}

/// Il trascinamento da una cella all'altra: finché il puntatore resta nella
/// cella di partenza è una selezione di testo; appena passa in un'altra della
/// stessa tabella diventa di celle. Mod+trascina aggiunge un intervallo.
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
    const plugin = cellKey.getState(view.state) ?? NONE;
    const before = selectedCells(view.state);
    const adding = (event.ctrlKey || event.metaKey) && before !== null;
    // Un clic nuovo spegne le celle (non il segno del taglio): le selezioni
    // del puntatore dopo, no.
    if (plugin.cells && !adding) view.dispatch(view.state.tr.setMeta(cellKey, { ...plugin, cells: null } satisfies CellState));
    if (event.button !== 0 || event.shiftKey) return;
    const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const from = at ? cellAt(view.state.doc.resolve(at.pos)) : null;
    if (!from) return;
    const others = adding && before && before.tablePos === from.tablePos ? withRange(before.others, before.range) : [];
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
      if (!celled && to.box.pos === from.box.pos && others.length === 0) return;
      const head = { row: to.box.row, column: to.box.column };
      const current = cellKey.getState(view.state)?.cells;
      if (celled && current && current.head.row === head.row && current.head.column === head.column) return;
      celled = true;
      view.dispatch(chooseCells(view.state, { tablePos: from.tablePos, anchor, head, others, adding: false }));
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
      // Ogni modifica spegne le celle e il segno del taglio. Mentre si
      // trascina il browser allarga la sua selezione di testo: le selezioni
      // del puntatore non spengono le celle, il clic dopo sì.
      if (tr.docChanged) return value === NONE ? value : NONE;
      if (tr.selectionSet && !tr.getMeta("pointer") && value.cells) return { ...value, cells: null };
      return value;
    },
  },
  view: (view) => new CellDrag(view),
  props: {
    handleKeyDown: onKey,
    handleDOMEvents: {
      copy: (view, event) => copyCells(view, event, false),
      cut: (view, event) => copyCells(view, event, true),
      paste: (view, event) => pasteCut(view, event),
    },
    decorations(state) {
      const selected = selectedCells(state);
      const plugin = cellKey.getState(state) ?? NONE;
      const marks: Decoration[] = [];
      if (selected) {
        const all = cellBoxes(selected.table, selected.tablePos);
        marks.push(Decoration.node(selected.tablePos, selected.tablePos + selected.table.nodeSize, { class: "has-cell-selection" }));
        for (const box of all) {
          if ([selected.range, ...selected.others].some((range) => touches(range, box.row, box.column, box.row, box.column + box.span - 1))) {
            marks.push(Decoration.node(box.pos, box.pos + box.node.nodeSize, { class: "is-cell-selected" }));
          }
        }
      }
      const cut = plugin.cut;
      const cutTable = cut ? state.doc.nodeAt(cut.tablePos) : null;
      if (cut && cutTable?.type === tableType) {
        for (const box of boxesIn(cellBoxes(cutTable, cut.tablePos), cut.range)) {
          marks.push(Decoration.node(box.pos, box.pos + box.node.nodeSize, { class: "is-cell-cut" }));
        }
      }
      return marks.length > 0 ? DecorationSet.create(state.doc, marks) : null;
    },
  },
});
