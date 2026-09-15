import { describe, expect, it } from "vitest";
import { cellAt, parseWorkbook } from "./model";
import {
  applyGridPatches,
  commitGridPatches,
  inputPatch,
  inverseGridPatches,
  pastePatches,
} from "./operation";

function source(input = "1"): string {
  return JSON.stringify({
    version: 1,
    sheets: [{
      id: "main",
      name: "Main",
      rows: [{ id: "r1", hidden: false }, { id: "r2", hidden: false }],
      columns: [{ id: "c1", hidden: false }, { id: "c2", hidden: false }],
      cells: input ? [{ row: "r1", column: "c1", input }] : [],
    }],
  });
}

describe("grid workbook contract", () => {
  it("rifiuta campi e tipi che serde deny_unknown_fields rifiuta", () => {
    const unknown = JSON.parse(source()) as Record<string, unknown>;
    unknown.extra = true;
    expect(() => parseWorkbook(JSON.stringify(unknown))).toThrow(/campo sconosciuto extra/);

    const wrongBoolean = JSON.parse(source()) as { sheets: Array<{ rows: Array<Record<string, unknown>> }> };
    wrongBoolean.sheets[0].rows[0].hidden = "false";
    expect(() => parseWorkbook(JSON.stringify(wrongBoolean))).toThrow(/non è booleano/);
  });

  it("rifiuta identità e nomi sheet duplicati", () => {
    const workbook = JSON.parse(source()) as { sheets: unknown[] };
    workbook.sheets.push(JSON.parse(source()).sheets[0]);
    expect(() => parseWorkbook(JSON.stringify(workbook))).toThrow(/duplicati/);
  });
});

describe("grid operations", () => {
  it("valida tutte le preimmagini prima di mutare una singola cella", () => {
    const workbook = parseWorkbook(source());
    const sheet = workbook.sheets[0];
    const valid = inputPatch(sheet, { row: 0, column: 0 }, "2")!;
    const stale = {
      ...inputPatch(sheet, { row: 0, column: 1 }, "3")!,
      before: { input: "modificata altrove" },
    };

    expect(applyGridPatches(workbook, [valid, stale])).toBe(false);
    expect(cellAt(sheet, { row: 0, column: 0 })?.input).toBe("1");
    expect(cellAt(sheet, { row: 0, column: 1 })).toBeUndefined();
  });

  it("incolla TSV e lo annulla come una sola operazione workbook", () => {
    const before = source();
    const workbook = parseWorkbook(before);
    const patches = pastePatches(workbook.sheets[0], { row: 0, column: 0 }, "A\tB\nC\tD");
    const committed = commitGridPatches(workbook, before, patches)!;

    expect(committed.operation.kind).toBe("grid");
    expect(committed.operation.patches).toHaveLength(4);
    expect(cellAt(workbook.sheets[0], { row: 1, column: 1 })?.input).toBe("D");
    expect(applyGridPatches(workbook, inverseGridPatches(patches))).toBe(true);
    expect(cellAt(workbook.sheets[0], { row: 0, column: 0 })?.input).toBe("1");
    expect(cellAt(workbook.sheets[0], { row: 1, column: 1 })).toBeUndefined();
  });
});
