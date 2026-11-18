// Le righe e le colonne di una tabella del documento, una volta sola per i
// comandi della barra e del menu (`commands.ts`) e per i gesti della Tabella
// sulle celle scelte (`cell-selection.ts`, Ctrl+«+», Ctrl+«−» e Alt con le
// frecce). Qui non c'è
// cursore né selezione: chi chiama sa dove rimetterli. In fondo, la guardia
// che nessuna modifica lasci una riga con meno colonne delle altre.

import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { isHistoryTransaction } from "prosemirror-history";
import { Plugin, type Transaction } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import type { TableEdit } from "../../tabella/adapter";
import { BODY, type Layout } from "./projection";
import { richSchema } from "./schema";

const { para, row: rowType, cell: cellType, table: tableType } = richSchema.nodes;

/// La disposizione dei paragrafi di una tabella nuova: spazio dopo 0 e
/// interlinea singola, quella che lo stile «Griglia tabella» di Word dà alle
/// celle. È formattazione del paragrafo come le altre: si vede, si salva e si
/// rilegge in ogni formato; dove lo stile del documento la dà già, il formato
/// non la scrive.
export const NEW_CELL_LAYOUT: Layout = Object.freeze({ after: 0, line: Object.freeze({ multiple: 1 }) });

/// Una cella di una tabella nuova: un paragrafo vuoto con la disposizione
/// della griglia. Righe e colonne aggiunte dopo copiano la cella accanto
/// (`emptyCellLike`), e la tengono.
export function newCell(): PmNode {
  return cellType.create(null, para.create({ p: NEW_CELL_LAYOUT }));
}

/// Una cella vuota come `cell`: stesse proprietà di cella e del paragrafo,
/// con il ruolo del testo normale.
export function emptyCellLike(cell: PmNode): PmNode {
  const first = cell.firstChild;
  const attrs = first?.type === para ? { ...first.attrs, role: BODY } : undefined;
  return cellType.create(cell.attrs, para.create(attrs));
}

/// Una riga nuova come `row`: stesse proprietà di riga e di cella (come
/// «Inserisci riga» di Word), celle vuote.
export function emptyRowLike(row: PmNode): PmNode {
  const cells: PmNode[] = [];
  row.forEach((cell) => cells.push(emptyCellLike(cell)));
  return rowType.create(row.attrs, cells);
}

/// Le colonne si toccano soltanto dove ogni riga ha le stesse celle, nessuna
/// unita: con celle unite in larghezza non si sa di quale colonna sia una
/// cella.
export function evenColumns(table: PmNode): boolean {
  const width = table.firstChild?.childCount ?? 0;
  let even = true;
  table.forEach((row) => {
    even &&= row.childCount === width;
    row.forEach((cell) => {
      even &&= cell.attrs.span === 1;
    });
  });
  return even;
}

/// Rifà in `tr` la tabella a `tablePos` con le righe o le colonne di `edit`
/// inserite, tolte o spostate. Le righe e le colonne nuove copiano le proprietà di
/// quella che spostano. `false`, e `tr` intatta, se il cambio non si può
/// fare: colonne con celle unite, o una tabella che resterebbe senza righe o
/// senza colonne.
export function applyTableEdit(tr: Transaction, table: PmNode, tablePos: number, edit: TableEdit): boolean {
  const rows: PmNode[] = [];
  table.forEach((row) => rows.push(row));
  const cellsOf = (row: PmNode): PmNode[] => {
    const cells: PmNode[] = [];
    row.forEach((cell) => cells.push(cell));
    return cells;
  };
  let next: PmNode[];
  switch (edit.kind) {
    case "insert-rows": {
      const like = rows[Math.min(edit.at, rows.length - 1)]!;
      next = [...rows.slice(0, edit.at), ...Array.from({ length: edit.count }, () => emptyRowLike(like)), ...rows.slice(edit.at)];
      break;
    }
    case "delete-rows":
      next = rows.filter((_, index) => index < edit.from || index > edit.to);
      if (next.length === 0) return false;
      break;
    case "insert-columns":
      if (!evenColumns(table)) return false;
      next = rows.map((row) => {
        const cells = cellsOf(row);
        const like = cells[Math.min(edit.at, cells.length - 1)]!;
        cells.splice(edit.at, 0, ...Array.from({ length: edit.count }, () => emptyCellLike(like)));
        return rowType.create(row.attrs, cells);
      });
      break;
    case "delete-columns":
      if (!evenColumns(table) || edit.to - edit.from + 1 >= rows[0]!.childCount) return false;
      next = rows.map((row) => rowType.create(row.attrs, cellsOf(row).filter((_, index) => index < edit.from || index > edit.to)));
      break;
    case "move-rows":
      next = shifted(rows, edit.from, edit.to, edit.by);
      if (next === rows) return false;
      break;
    case "move-columns": {
      if (!evenColumns(table)) return false;
      const first = cellsOf(rows[0]!);
      if (shifted(first, edit.from, edit.to, edit.by) === first) return false;
      next = rows.map((row) => rowType.create(row.attrs, shifted(cellsOf(row), edit.from, edit.to, edit.by)));
      break;
    }
    default:
      return false;
  }
  tr.replaceWith(tablePos, tablePos + table.nodeSize, tableType.create(table.attrs, next));
  return true;
}

/// `items` con quelli da `from` a `to` spostati di `by` posti; lo stesso
/// elenco (`items`) se lo spostamento esce dall'elenco o non sposta niente.
function shifted<T>(items: readonly T[], from: number, to: number, by: number): T[] {
  if (by === 0 || !Number.isInteger(by) || from > to || from + by < 0 || to + by >= items.length) return items as T[];
  const next = [...items];
  const block = next.splice(from, to - from + 1);
  next.splice(from + by, 0, ...block);
  return next;
}

// ── La forma delle tabelle ───────────────────────────────────────────────────

/// Il segno di una transazione che cambia la forma delle tabelle senza
/// passare dalla guardia ([`tableShapeGuard`]): il documento riletto dal
/// disco, che vale com'è.
export const SHAPE_FREE = "rich-table-shape-free";

/// La cella più interna che contiene `$pos`, come posizione; -1 fuori da ogni
/// cella.
function innerCell($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === cellType) return $pos.before(depth);
  }
  return -1;
}

/// Un passo di `tr` toglie o sostituisce un tratto che comincia in una cella
/// e finisce fuori da lei: ProseMirror unirebbe le due celle (o la cella e il
/// paragrafo dopo la tabella), e la riga resterebbe con una cella in meno.
/// Sostituire celle, righe o tabelle intere si può: i loro capi stanno fuori
/// dalle celle.
export function splitsCells(tr: Transaction): boolean {
  return tr.steps.some((step, index) => {
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false;
    const { from, to } = step as unknown as { from: number; to: number };
    if (from === to) return false;
    const doc = tr.docs[index]!;
    return innerCell(doc.resolve(from)) !== innerCell(doc.resolve(to));
  });
}

/// Le righe di `table` non coprono tutte le stesse colonne: una cella unita
/// conta per le colonne che copre.
function ragged(table: PmNode): boolean {
  let width = -1;
  let even = true;
  table.forEach((row) => {
    let columns = 0;
    row.forEach((cell) => {
      columns += (cell.attrs.span as number | undefined) ?? 1;
    });
    if (width < 0) width = columns;
    even &&= columns === width;
  });
  return !even;
}

/// Quante tabelle di `doc` hanno righe di larghezze diverse.
function raggedTables(doc: PmNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type === tableType && ragged(node)) count += 1;
    return !node.isTextblock;
  });
  return count;
}

/// Una tabella che `tr` ha toccato ha righe di larghezze diverse. Guarda
/// soltanto dove la transazione ha cambiato qualcosa, e le tabelle intorno:
/// un tasto in un documento lungo non rilegge tutto il documento.
function touchesRagged(tr: Transaction): boolean {
  const doc = tr.doc;
  const size = doc.content.size;
  let found = false;
  const check = (node: PmNode) => {
    if (!found && node.type === tableType && ragged(node)) found = true;
  };
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (found) return;
      const from = Math.min(after.map(newStart, -1), size);
      const to = Math.min(Math.max(after.map(newEnd, 1), from), size);
      const $from = doc.resolve(from);
      for (let depth = $from.depth; depth > 0; depth -= 1) check($from.node(depth));
      doc.nodesBetween(from, to, (node) => {
        check(node);
        return !found && !node.isTextblock;
      });
    });
  });
  return found;
}

/// La guardia della forma delle tabelle: una modifica non lascia mai una
/// riga con meno colonne delle altre. Rifiuta i passi che unirebbero celle
/// ([`splitsCells`]) e le modifiche dopo cui le tabelle con righe di
/// larghezze diverse sono più di prima (una tabella di un file che le ha già
/// così resta com'è). I gesti delle tabelle non la toccano: Canc sulle celle
/// scelte le svuota, «Unisci celle» allarga la prima, righe e colonne si
/// rifanno intere. La cronologia passa sempre (Ctrl+Z rimette ciò che
/// c'era), e così il documento riletto dal disco ([`SHAPE_FREE`]).
export const tableShapeGuard = new Plugin({
  filterTransaction(tr, state) {
    if (!tr.docChanged || tr.getMeta(SHAPE_FREE) || isHistoryTransaction(tr)) return true;
    if (splitsCells(tr)) return false;
    return !touchesRagged(tr) || raggedTables(tr.doc) <= raggedTables(state.doc);
  },
});
