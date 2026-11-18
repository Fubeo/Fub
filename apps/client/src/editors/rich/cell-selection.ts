// La selezione di celle delle tabelle del documento, nel modo «documento»
// della Tabella (`tabella/keys.ts`): il cursore resta nel testo della cella,
// e Maiusc con una freccia che esce dalla cella, o il trascinamento da una
// cella all'altra, sceglie un rettangolo di celle. Su quel rettangolo valgono
// i gesti del foglio (`documentIntent`): Canc svuota, Ctrl+C e Ctrl+X passano
// TSV e una tabella HTML, Invio e Tab fanno girare la cella attiva, Ctrl+D e
// Ctrl+R riempiono, Ctrl+«+» e Ctrl+«−» inseriscono e tolgono righe o
// colonne, Alt con le frecce sposta le righe o le colonne scelte, Maiusc+F8
// aggiunge intervalli; Ctrl+Spazio e Ctrl+Maiusc+Spazio scelgono la colonna e
// la tabella anche senza celle scelte, e Ctrl+; scrive la data di oggi dove
// sta il cursore (con celle scelte, nella cella attiva). «Unisci celle»
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
//
// Una selezione di testo da una cella all'altra della stessa tabella diventa
// di celle (`appendTransaction`); una che esce dalla cella si toglie a pezzi
// (`deleteAcross`), senza unire celle. La guardia che ciò che resta non tolga
// mai una cella da una riga sta in `table-structure.ts` (`tableShapeGuard`).
// Il perché di non usare `prosemirror-tables` sta nell'ADR 0225.

import { Fragment, type Node as PmNode, type ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { TableCaps } from "../../tabella/adapter";
import { clipboardData, cutMoves, cutTarget, tellCutOnce, type CutMark } from "../../tabella/clipboard";
import { structureEdit } from "../../tabella/commands";
import { documentIntent } from "../../tabella/keys";
import { boundedShape, isMultiCell, nextInRange, type Cell, type Move, type Range } from "../../tabella/navigation";
import { fillCopy, rangeBetween, touches, wholeRange, withRange } from "../../tabella/selection";
import { todayText } from "../../tabella/series";
import { resolvedLanguage, t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { richSchema } from "./schema";
import { applyTableEdit } from "./table-structure";

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
  /// Fino a quando (`Date.now()`) le celle scelte col trascinamento restano
  /// anche se la selezione di testo cambia senza il puntatore: il browser
  /// rilegge la sua selezione del trascinamento anche dopo il rilascio, e
  /// a volte con un'àncora sua (IMP-134).
  readonly hold?: number;
}

/// Quanto restano le celle del trascinamento dopo l'ultimo movimento o il
/// rilascio, contro le selezioni che il browser rilegge in ritardo.
const DRAG_HOLD_MS = 400;

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
function chooseCells(state: EditorState, cells: ChosenCells, tr: Transaction = state.tr, hold?: number): Transaction {
  const table = tr.doc.nodeAt(cells.tablePos)!;
  const active = cells.active ?? cells.anchor;
  const box = boxCovering(cellBoxes(table, cells.tablePos), active.row, active.column);
  const cut = tr.docChanged ? null : cellKey.getState(state)?.cut ?? null;
  tr.setMeta(cellKey, { cells, cut, ...(hold === undefined ? {} : { hold }) } satisfies CellState);
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

/// La cella `cell` con la data `text` di Ctrl+;. Una cella di solo testo
/// semplice (un paragrafo, senza stili né oggetti) prende la data al posto
/// del testo, come nella tabella delle note. Una cella più ricca non perde
/// niente: la data va in fondo al suo primo paragrafo, dopo uno spazio, o in
/// un paragrafo nuovo in testa se la cella non comincia con un paragrafo.
function withToday(cell: PmNode, text: string): PmNode {
  const first = cell.firstChild;
  let plain = cell.childCount === 1 && first?.type === para;
  first?.content.forEach((inline) => {
    if (!inline.isText || inline.marks.length > 0) plain = false;
  });
  if (plain) return cellType.create(cell.attrs, para.create(first!.attrs, richSchema.text(text)));
  if (!first?.isTextblock) return cell.copy(Fragment.from(para.create(null, richSchema.text(text))).append(cell.content));
  const space = first.textContent === "" || /\s$/.test(first.textContent) ? "" : " ";
  const dated = first.copy(first.content.append(Fragment.from(richSchema.text(space + text))));
  return cell.copy(cell.content.replaceChild(0, dated));
}

/// Svuota le celle scelte, in tutti gli intervalli: ognuna resta, con un
/// paragrafo vuoto come il suo primo, e resta scelta.
export function clearCells(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const cells = cellKey.getState(state)?.cells;
  if (!cells || !selectedCells(state)) return false;
  if (dispatch) dispatch(emptyChosen(state, cells).scrollIntoView());
  return true;
}

/// La transazione che svuota le celle `cells`, che restano scelte.
function emptyChosen(state: EditorState, cells: ChosenCells): Transaction {
  const table = state.doc.nodeAt(cells.tablePos)!;
  const ranges = [rangeBetween(cells.anchor, cells.head), ...cells.others];
  const chosen = cellBoxes(table, cells.tablePos)
    .filter((box) => ranges.some((range) => touches(range, box.row, box.column, box.row, box.column + box.span - 1)));
  const tr = state.tr;
  rewriteCells(tr, cells.tablePos, chosen, emptied, cells.active ?? cells.anchor);
  // Come nei fogli di calcolo le celle restano scelte.
  return keepCells(tr, cells);
}

/// Una selezione di testo che va da una cella a un'altra della stessa
/// tabella: sono celle scelte, dall'àncora alla testa. Il browser la fa col
/// trascinamento o con Maiusc+clic; Canc, una lettera o un incolla su di lei
/// unirebbero le celle.
function spannedCells(state: EditorState): ChosenCells | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const anchor = cellAt(selection.$anchor);
  const head = cellAt(selection.$head);
  if (!anchor || !head || anchor.tablePos !== head.tablePos || anchor.box.pos === head.box.pos) return null;
  return {
    tablePos: anchor.tablePos,
    anchor: { row: anchor.box.row, column: anchor.box.column },
    head: { row: head.box.row, column: head.box.column },
    others: [],
    adding: false,
  };
}

/// La selezione comincia o finisce in una cella, e l'altro capo sta fuori da
/// lei (fuori dalla tabella, o in un'altra tabella).
function crossesCells(state: EditorState): boolean {
  const { $from, $to, empty } = state.selection;
  if (empty) return false;
  const from = cellAt($from);
  const to = cellAt($to);
  return (from !== null || to !== null) && from?.box.pos !== to?.box.pos;
}

/// I tratti di `[from, to]` che si tolgono senza rompere una tabella: il
/// testo fuori dalle tabelle, le tabelle intere, e dentro una tabella toccata
/// in parte il pezzo scelto di ogni cella. In ordine di documento.
function deletionPieces(doc: PmNode, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let cursor = from;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) return false;
    if (node.type !== tableType) return true;
    const end = pos + node.nodeSize;
    if (from <= pos && end <= to) return false;
    const pieces: { from: number; to: number }[] = [];
    let inside = false;
    for (const box of cellBoxes(node, pos)) {
      const start = box.pos + 1;
      const stop = box.pos + box.node.nodeSize - 1;
      // Tutto dentro una cella: si guarda dentro, come nel documento.
      if (start <= from && to <= stop) inside = true;
      const a = Math.max(from, start);
      const b = Math.min(to, stop);
      if (a < b) pieces.push({ from: a, to: b });
    }
    if (inside) return true;
    if (cursor < pos) out.push({ from: cursor, to: pos });
    for (const piece of pieces) out.push(...deletionPieces(doc, piece.from, piece.to));
    cursor = Math.max(cursor, Math.min(end, to));
    return false;
  });
  if (cursor < to) out.push({ from: cursor, to });
  return out;
}

/// Toglie la selezione che attraversa le celle ([`crossesCells`]) senza
/// toccare la forma delle tabelle: una cella scelta tutta resta, vuota.
function deleteAcross(state: EditorState): Transaction {
  const { from, to } = state.selection;
  const tr = state.tr;
  for (const piece of deletionPieces(state.doc, from, to).reverse()) {
    const $start = state.doc.resolve(piece.from);
    const cell = $start.parent.type === cellType ? $start.parent : null;
    if (cell && piece.from === $start.start() && piece.to === $start.end()) {
      const first = cell.firstChild;
      tr.replaceWith(piece.from, piece.to, para.create(first?.type === para ? first.attrs : null));
    } else {
      tr.delete(piece.from, piece.to);
    }
  }
  return tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(from, -1))));
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

function onKey(view: EditorView, event: KeyboardEvent): boolean {
  const state = view.state;
  const plugin = cellKey.getState(state) ?? NONE;
  const chosen = plugin.cells;
  const erase = (event.key === "Delete" || event.key === "Backspace") && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (chosen && erase) return clearCells(state, view.dispatch);
  // Una selezione di testo da una cella all'altra sono celle scelte: Canc e
  // Backspace le svuotano. Una che esce dalla cella si toglie a pezzi, e le
  // celle restano.
  const spanned = erase ? spannedCells(state) : null;
  if (spanned) {
    if (view.editable) view.dispatch(emptyChosen(state, spanned).scrollIntoView());
    return true;
  }
  if (erase && crossesCells(state)) {
    if (view.editable) view.dispatch(deleteAcross(state).scrollIntoView());
    return true;
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
      view.dispatch(chooseCells(state, { ...current, active: nextInRange(range, active, move, boundedShape(size)) }));
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
      if (!applyTableEdit(tr, here.table, here.tablePos, change.edit)) return true;
      view.dispatch(chooseCells(state, {
        tablePos: here.tablePos,
        anchor: change.select.anchor,
        head: change.select.focus,
        others: [],
        adding: false,
      }, tr).scrollIntoView());
      return true;
    }
    case "shift-lines": {
      // Le righe (o le colonne) delle celle scelte, di un posto, in un passo;
      // le celle scelte vanno con loro.
      if (!view.editable || !multi || current.others.length > 0) return true;
      const rows = intent.axis === "rows";
      const edit = rows
        ? { kind: "move-rows" as const, from: range.r0, to: range.r1, by: intent.by }
        : { kind: "move-columns" as const, from: range.c0, to: range.c1, by: intent.by };
      const tr = state.tr;
      if (!applyTableEdit(tr, here.table, here.tablePos, edit)) return true;
      const shift = (cell: Cell): Cell => (rows ? { row: cell.row + intent.by, column: cell.column } : { row: cell.row, column: cell.column + intent.by });
      view.dispatch(chooseCells(state, {
        ...current,
        anchor: shift(current.anchor),
        head: shift(current.head),
        active: current.active ? shift(current.active) : undefined,
      }, tr).scrollIntoView());
      return true;
    }
    case "today": {
      if (!view.editable) return true;
      const text = todayText(new Date(), resolvedLanguage());
      if (multi) {
        // Con celle scelte la data va nella cella attiva (`withToday`).
        const box = boxCovering(boxes, active.row, active.column);
        if (!box) return true;
        const tr = state.tr;
        rewriteCells(tr, here.tablePos, [box], (cell) => withToday(cell.node, text), active);
        view.dispatch(keepCells(tr, own).scrollIntoView());
        return true;
      }
      view.dispatch(state.tr.insertText(text).scrollIntoView());
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

function copyCells(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const selected = selectedCells(view.state);
  if (!selected || !event.clipboardData) return false;
  event.preventDefault();
  // Come nei fogli di calcolo: più intervalli non si copiano insieme, e lo si
  // dice come la cornice.
  if (selected.others.length > 0) {
    notify(t("grid.multi.refused"), "info");
    return true;
  }
  const data = clipboardData(rangeRows(selected.table, selected.tablePos, selected.range));
  event.clipboardData.setData("text/plain", data.text);
  event.clipboardData.setData("text/html", data.html);
  const plugin = cellKey.getState(view.state) ?? NONE;
  const mark = cut && view.editable ? { range: selected.range, text: data.text, tablePos: selected.tablePos } : null;
  view.dispatch(view.state.tr.setMeta(cellKey, { ...plugin, cut: mark } satisfies CellState));
  if (mark && tellCutOnce()) notify(t("table.cut.marked"), "info");
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
  const boxes = cellBoxes(table, mark.tablePos);
  const destination = cutTarget(mark.range, target, tableSize(table, boxes));
  if (!destination) return false;
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
    const at = event.button === 0 && !event.shiftKey ? view.posAtCoords({ left: event.clientX, top: event.clientY }) : null;
    const from = at ? cellAt(view.state.doc.resolve(at.pos)) : null;
    // Mod+clic aggiunge soltanto su una cella della stessa tabella; altrove è
    // un clic qualunque.
    const adding = (event.ctrlKey || event.metaKey) && before !== null && from !== null && before.tablePos === from.tablePos;
    // Un clic nuovo spegne le celle (non il segno del taglio): le selezioni
    // del puntatore dopo, no.
    if (plugin.cells && !adding) view.dispatch(view.state.tr.setMeta(cellKey, { cells: null, cut: plugin.cut } satisfies CellState));
    if (!from) return;
    const others = adding ? withRange(before.others, before.range) : [];
    this.#drag?.close();
    const drag = openLifetime();
    this.#drag = drag;
    const doc = view.dom.ownerDocument;
    const anchor = { row: from.box.row, column: from.box.column };
    let celled = false;
    let head = anchor;
    /// La cella della stessa tabella sotto il puntatore, oltre la partenza.
    const cellUnder = (event: MouseEvent): Cell | null => {
      const over = view.posAtCoords({ left: event.clientX, top: event.clientY });
      const to = over ? cellAt(view.state.doc.resolve(over.pos)) : null;
      if (!to || to.tablePos !== from.tablePos) return null;
      if (!celled && to.box.pos === from.box.pos && others.length === 0) return null;
      return { row: to.box.row, column: to.box.column };
    };
    // Le celle del trascinamento le decide il puntatore, dalla cella di
    // partenza a quella sotto il puntatore: la selezione di testo che il
    // browser intanto allarga, e che rilegge anche dopo il rilascio, non le
    // cambia.
    const choose = (hold: number) => view.dispatch(chooseCells(view.state, { tablePos: from.tablePos, anchor, head, others, adding: false }, undefined, hold));
    drag.listen(doc, "mousemove", (move) => {
      const to = cellUnder(move);
      if (!to) return;
      const current = cellKey.getState(view.state)?.cells;
      if (celled && current && current.head.row === to.row && current.head.column === to.column) return;
      celled = true;
      head = to;
      choose(Date.now() + DRAG_HOLD_MS);
    });
    drag.listen(doc, "mouseup", (up) => {
      drag.close();
      if (this.#drag === drag) this.#drag = null;
      // Il rilascio dice dove finisce, anche se nessun movimento è arrivato
      // sopra quella cella.
      const to = cellUnder(up);
      if (to) {
        celled = true;
        head = to;
      }
      if (celled) {
        choose(Date.now() + DRAG_HOLD_MS);
        return;
      }
      // Mod+clic su una cella sola, senza trascinare: la cella è un intervallo
      // in più, come nei fogli di calcolo.
      if (adding) view.dispatch(chooseCells(view.state, { tablePos: from.tablePos, anchor, head: anchor, others, adding: false }));
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
      if (tr.selectionSet && !tr.getMeta("pointer") && value.cells) {
        // Appena dopo il trascinamento la selezione che il browser rilegge
        // non spegne le celle che il puntatore ha scelto.
        if (value.hold !== undefined && Date.now() < value.hold) return value;
        return { cells: null, cut: value.cut };
      }
      return value;
    },
  },
  // Una selezione di testo da una cella all'altra della stessa tabella
  // diventa di celle, chiunque l'abbia fatta (il trascinamento del browser,
  // Maiusc+clic): su di lei valgono i gesti delle celle, e nessuna modifica
  // del testo unisce due celle.
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;
    if (cellKey.getState(state)?.cells) return null;
    const spanned = spannedCells(state);
    return spanned ? chooseCells(state, spanned) : null;
  },
  view: (view) => new CellDrag(view),
  props: {
    handleKeyDown: onKey,
    // Una lettera su una selezione che esce da una cella: prima si toglie la
    // selezione a pezzi ([`deleteAcross`]), poi la lettera, in un passo. Il
    // browser non la scrive da sé: unirebbe le celle nel DOM.
    handleKeyPress(view, event) {
      if (event.ctrlKey || event.metaKey || [...event.key].length !== 1 || !crossesCells(view.state)) return false;
      if (!view.editable) return true;
      view.dispatch(deleteAcross(view.state).insertText(event.key).scrollIntoView());
      return true;
    },
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
