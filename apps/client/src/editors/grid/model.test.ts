import { describe, expect, it } from "vitest";
import { parseWorkbookSource, serializeWorkbook } from "./codec";
import {
  DEFAULT_CELL_STYLE,
  GridOperationConflict,
  a1Address,
  applyGridOperation,
  cellInput,
  operationForInputs,
  type GridWorkbook,
} from "./model";

function workbook(): GridWorkbook {
  return {
    id: "workbook-1",
    metadata: { owner: "Bilancio" },
    sheets: [
      {
        id: "sheet-1",
        name: "Preventivo",
        metadata: {},
        rows: [{ id: "row-1", height: 24 }, { id: "row-2" }],
        columns: [{ id: "column-1", width: 120 }, { id: "column-2" }],
        cells: [
          {
            row: "row-1",
            column: "column-1",
            input: "10",
            style: DEFAULT_CELL_STYLE,
          },
        ],
      },
    ],
  };
}

describe("modello interno GridEngine", () => {
  it("applica una GridOperation atomica e produce l'inversa per l'undo del workbook", () => {
    const initial = workbook();
    const operation = operationForInputs(initial, "sheet-1", [
      { row: "row-1", column: "column-1", input: "20" },
      { row: "row-2", column: "column-2", input: "=A1*2" },
    ]);

    const applied = applyGridOperation(initial, operation);
    expect(cellInput(applied.workbook.sheets[0], { row: "row-1", column: "column-1" })).toBe("20");
    expect(cellInput(applied.workbook.sheets[0], { row: "row-2", column: "column-2" })).toBe("=A1*2");
    expect(applied.inverse.changes).toHaveLength(2);
    expect(applyGridOperation(applied.workbook, applied.inverse).workbook).toEqual(initial);
  });

  it("rifiuta un'operazione stantia invece di coprire una cella più nuova", () => {
    const initial = workbook();
    const stale = operationForInputs(initial, "sheet-1", [
      { row: "row-1", column: "column-1", input: "20" },
    ]);
    const newer = applyGridOperation(
      initial,
      operationForInputs(initial, "sheet-1", [
        { row: "row-1", column: "column-1", input: "30" },
      ]),
    ).workbook;

    expect(() => applyGridOperation(newer, stale)).toThrow(GridOperationConflict);
  });

  it("deriva A1 dall'ordine senza cambiare le identità persistenti", () => {
    const initial = workbook();
    const sheet = initial.sheets[0];
    const key = { row: "row-2", column: "column-1" };
    expect(a1Address(sheet, key)).toBe("A2");
    expect(a1Address({ ...sheet, rows: [...sheet.rows].reverse() }, key)).toBe("A1");
    expect(key).toEqual({ row: "row-2", column: "column-1" });
  });
});

describe("codec frontend fubsheet", () => {
  it("legge e riscrive tutti i campi autorevoli senza introdurre stato derivato", () => {
    const initial = workbook();
    const source = serializeWorkbook(initial);

    expect(source.endsWith("\n")).toBe(true);
    expect(parseWorkbookSource(source)).toEqual(initial);
    for (const forbidden of ["\"a1\"", "\"ast\"", "\"value\"", "\"dependencies\"", "\"cache\""]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("rifiuta schema e coordinate che il codec Rust rifiuta", () => {
    expect(() => parseWorkbookSource('{"schema":2,"workbook":{}}')).toThrow(
      "unsupported fubsheet schema",
    );
    expect(() => parseWorkbookSource('{"workbook":{}}')).toThrow("no schema version");

    const unknown = serializeWorkbook(workbook()).replace(
      '"input": "10"',
      '"input": "10", "value": 10',
    );
    expect(() => parseWorkbookSource(unknown)).toThrow("unknown field value");

    const initial = workbook();
    const dangling: GridWorkbook = {
      ...initial,
      sheets: [
        {
          ...initial.sheets[0],
          cells: [{ ...initial.sheets[0].cells[0], row: "missing" }],
        },
      ],
    };
    expect(() => serializeWorkbook(dangling)).toThrow("dangling coordinate");
  });
});
