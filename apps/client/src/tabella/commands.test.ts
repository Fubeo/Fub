import { describe, expect, it } from "vitest";
import type { TableCaps } from "./adapter";
import { TABLE_COMMANDS, tableCommand, type TableCommandContext } from "./commands";

const caps: TableCaps = { insertRows: true, deleteRows: true, moveRows: true, insertColumns: true, deleteColumns: true, moveColumns: true, sort: true, align: true, merge: true, headerRows: 1 };
const at = (r0: number, c0: number, r1 = r0, c1 = c0): TableCommandContext => ({
  range: { r0, c0, r1, c1 },
  active: { row: r1, column: c1 },
  size: { rows: 4, columns: 3 },
  caps,
});

describe("il catalogo dei comandi della Tabella", () => {
  it("tiene gli id pubblici di oggi, una volta sola", () => {
    const ids = TABLE_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("markdown.table.row.before");
    expect(ids).toContain("rich.table.merge");
  });

  it("un comando senza la capacità del formato non c'è", () => {
    expect(tableCommand("rich.table.merge", { ...caps, merge: false })).toBeNull();
    expect(tableCommand("markdown.table.sort.ascending", caps)).not.toBeNull();
    expect(tableCommand("sconosciuto", caps)).toBeNull();
  });

  it("l'intestazione non si sposta, non si cancella e non riceve righe sopra", () => {
    const head = at(0, 0);
    expect(tableCommand("markdown.table.row.before", caps)!.applicable(head)).toBe(false);
    expect(tableCommand("markdown.table.row.up", caps)!.applicable(at(1, 0))).toBe(false);
    expect(tableCommand("markdown.table.row.delete", caps)!.applicable(head)).toBe(false);
    expect(tableCommand("markdown.table.row.delete", caps)!.edit(at(0, 0, 2, 0)).edit).toEqual({ kind: "delete-rows", from: 1, to: 2 });
  });

  it("dice dove va la selezione dopo", () => {
    expect(tableCommand("markdown.table.column.right", caps)!.edit(at(1, 0, 2, 1)))
      .toEqual({ edit: { kind: "move-columns", from: 0, to: 1, by: 1 }, select: { anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } } });
    expect(tableCommand("markdown.table.column.right", caps)!.applicable(at(1, 2))).toBe(false);
    expect(tableCommand("rich.table.merge", caps)!.applicable(at(1, 0, 1, 2))).toBe(true);
    expect(tableCommand("rich.table.merge", caps)!.applicable(at(1, 0, 2, 0))).toBe(false);
  });
});
