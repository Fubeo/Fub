// Le righe e le colonne di una tabella del documento, una volta sola per i
// comandi della barra e del menu (`commands.ts`) e per i gesti della Tabella
// sulle celle scelte (`cell-selection.ts`, Ctrl+«+» e Ctrl+«−»). Qui non c'è
// cursore né selezione: chi chiama sa dove rimetterli.

import type { Node as PmNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import type { TableEdit } from "../../tabella/adapter";
import { BODY } from "./projection";
import { richSchema } from "./schema";

const { para, row: rowType, cell: cellType, table: tableType } = richSchema.nodes;

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
/// inserite o tolte. Le righe e le colonne nuove copiano le proprietà di
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
    default:
      return false;
  }
  tr.replaceWith(tablePos, tablePos + table.nodeSize, tableType.create(table.attrs, next));
  return true;
}
