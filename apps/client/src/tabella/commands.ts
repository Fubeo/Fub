// Il catalogo dei comandi della Tabella, con gli id pubblici di oggi: la
// barra, la scheda «Tabella» e il menu col tasto destro li nominano, e un
// comando esiste in una tabella soltanto se il formato ne ha la capacità.
//
// Ogni comando dice, per la selezione e la forma di adesso, se vale, il
// cambio che chiede e dove va la selezione dopo. Lo esegue la cornice.

import type { Key } from "../i18n/strings";
import type { TableAlign, TableCaps, TableEdit, TableSize } from "./adapter";
import type { Range } from "./navigation";

/// Dove va la selezione dopo un comando: l'àncora e la cella attiva.
export interface TableTarget {
  readonly anchor: { readonly row: number; readonly column: number };
  readonly focus: { readonly row: number; readonly column: number };
}

export interface TableCommandContext {
  readonly range: Range;
  readonly active: { readonly row: number; readonly column: number };
  readonly size: TableSize;
  readonly caps: TableCaps;
}

export interface TableCommand {
  readonly id: string;
  readonly label: Key;
  readonly needs: keyof Omit<TableCaps, "headerRows">;
  /// Comincia un gruppo nel menu.
  readonly group?: boolean;
  applicable(context: TableCommandContext): boolean;
  edit(context: TableCommandContext): { readonly edit: TableEdit; readonly select?: TableTarget };
}

const rows = (context: TableCommandContext, top: number, bottom: number): TableTarget => ({
  anchor: { row: top, column: context.range.c0 },
  focus: { row: bottom, column: context.range.c1 },
});
const columns = (context: TableCommandContext, left: number, right: number): TableTarget => ({
  anchor: { row: context.range.r0, column: left },
  focus: { row: context.range.r1, column: right },
});
const one = (row: number, column: number): TableTarget => ({ anchor: { row, column }, focus: { row, column } });

export const TABLE_COMMANDS: readonly TableCommand[] = [
  {
    id: "markdown.table.row.before",
    label: "table.menu.row_above",
    needs: "insertRows",
    group: true,
    applicable: ({ range, caps }) => range.r0 >= caps.headerRows,
    edit: (context) => ({ edit: { kind: "insert-rows", at: context.range.r0, count: 1 }, select: rows(context, context.range.r0, context.range.r0) }),
  },
  {
    id: "markdown.table.row.after",
    label: "table.menu.row_below",
    needs: "insertRows",
    applicable: () => true,
    edit: (context) => ({ edit: { kind: "insert-rows", at: context.range.r1 + 1, count: 1 }, select: rows(context, context.range.r1 + 1, context.range.r1 + 1) }),
  },
  {
    id: "markdown.table.column.before",
    label: "table.menu.column_left",
    needs: "insertColumns",
    applicable: () => true,
    edit: (context) => ({ edit: { kind: "insert-columns", at: context.range.c0, count: 1 }, select: columns(context, context.range.c0, context.range.c0) }),
  },
  {
    id: "markdown.table.column.after",
    label: "table.menu.column_right",
    needs: "insertColumns",
    applicable: () => true,
    edit: (context) => ({ edit: { kind: "insert-columns", at: context.range.c1 + 1, count: 1 }, select: columns(context, context.range.c1 + 1, context.range.c1 + 1) }),
  },
  {
    id: "markdown.table.row.up",
    label: "table.menu.row_up",
    needs: "moveRows",
    group: true,
    applicable: ({ range, caps }) => range.r0 > caps.headerRows,
    edit: (context) => ({
      edit: { kind: "move-rows", from: context.range.r0, to: context.range.r1, by: -1 },
      select: rows(context, context.range.r0 - 1, context.range.r1 - 1),
    }),
  },
  {
    id: "markdown.table.row.down",
    label: "table.menu.row_down",
    needs: "moveRows",
    applicable: ({ range, caps, size }) => range.r0 >= caps.headerRows && range.r1 < size.rows - 1,
    edit: (context) => ({
      edit: { kind: "move-rows", from: context.range.r0, to: context.range.r1, by: 1 },
      select: rows(context, context.range.r0 + 1, context.range.r1 + 1),
    }),
  },
  {
    id: "markdown.table.column.left",
    label: "table.menu.column_move_left",
    needs: "moveColumns",
    applicable: ({ range }) => range.c0 > 0,
    edit: (context) => ({
      edit: { kind: "move-columns", from: context.range.c0, to: context.range.c1, by: -1 },
      select: columns(context, context.range.c0 - 1, context.range.c1 - 1),
    }),
  },
  {
    id: "markdown.table.column.right",
    label: "table.menu.column_move_right",
    needs: "moveColumns",
    applicable: ({ range, size }) => range.c1 < size.columns - 1,
    edit: (context) => ({
      edit: { kind: "move-columns", from: context.range.c0, to: context.range.c1, by: 1 },
      select: columns(context, context.range.c0 + 1, context.range.c1 + 1),
    }),
  },
  {
    id: "markdown.table.row.delete",
    label: "table.menu.delete_rows",
    needs: "deleteRows",
    group: true,
    applicable: ({ range, caps, size }) => range.r1 >= caps.headerRows && size.rows - (range.r1 - Math.max(caps.headerRows, range.r0) + 1) >= 1,
    edit: (context) => {
      const top = Math.max(context.caps.headerRows, context.range.r0);
      const left = context.size.rows - 1 - (context.range.r1 - top + 1);
      const row = Math.max(0, Math.min(top, left));
      return { edit: { kind: "delete-rows", from: top, to: context.range.r1 }, select: rows(context, row, row) };
    },
  },
  {
    id: "markdown.table.column.delete",
    label: "table.menu.delete_columns",
    needs: "deleteColumns",
    applicable: ({ range, size }) => range.c1 - range.c0 + 1 < size.columns,
    edit: (context) => {
      const column = Math.min(context.range.c0, context.size.columns - 1 - (context.range.c1 - context.range.c0 + 1));
      return { edit: { kind: "delete-columns", from: context.range.c0, to: context.range.c1 }, select: columns(context, column, column) };
    },
  },
  {
    id: "markdown.table.sort.ascending",
    label: "table.menu.sort_ascending",
    needs: "sort",
    group: true,
    applicable: ({ size, caps }) => size.rows - caps.headerRows > 1,
    edit: (context) => ({ edit: { kind: "sort", column: context.active.column, direction: 1 } }),
  },
  {
    id: "markdown.table.sort.descending",
    label: "table.menu.sort_descending",
    needs: "sort",
    applicable: ({ size, caps }) => size.rows - caps.headerRows > 1,
    edit: (context) => ({ edit: { kind: "sort", column: context.active.column, direction: -1 } }),
  },
  {
    id: "rich.table.merge",
    label: "table.menu.merge",
    needs: "merge",
    group: true,
    applicable: ({ range }) => range.r0 === range.r1 && range.c1 > range.c0,
    edit: (context) => ({ edit: { kind: "merge", range: context.range }, select: one(context.range.r0, context.range.c0) }),
  },
  {
    id: "rich.table.split",
    label: "table.menu.split",
    needs: "merge",
    applicable: () => true,
    edit: (context) => ({ edit: { kind: "split", row: context.active.row, column: context.active.column } }),
  },
];

/// Gli allineamenti delle colonne scelte, nell'ordine del menu.
export const TABLE_ALIGNS: readonly { readonly label: Key; readonly align: TableAlign }[] = [
  { label: "table.menu.align_left", align: "left" },
  { label: "table.menu.align_center", align: "center" },
  { label: "table.menu.align_right", align: "right" },
  { label: "table.menu.align_default", align: null },
];

/// Il comando con quell'id, se il formato ne ha la capacità.
export function tableCommand(id: string, caps: TableCaps): TableCommand | null {
  const found = TABLE_COMMANDS.find((command) => command.id === id);
  return found && caps[found.needs] ? found : null;
}
