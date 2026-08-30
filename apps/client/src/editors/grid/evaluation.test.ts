import { describe, expect, it } from "vitest";
import { displayCellValue, evaluateSheet, evaluatedCell } from "./evaluation";
import { DEFAULT_CELL_STYLE, type GridSheet } from "./model";

function sheet(inputs: readonly string[]): GridSheet {
  return {
    id: "sheet-1",
    name: "Foglio 1",
    metadata: {},
    rows: inputs.map((_, index) => ({ id: `row-${index + 1}` })),
    columns: [
      { id: "column-1" },
      { id: "column-2" },
      { id: "column-3" },
      { id: "column-4" },
    ],
    cells: inputs.map((input, index) => ({
      row: `row-${index + 1}`,
      column: "column-1",
      input,
      style: DEFAULT_CELL_STYLE,
    })),
  };
}

function displays(value: GridSheet): string[] {
  const evaluation = evaluateSheet(value);
  return value.cells.map((cell) =>
    displayCellValue(evaluatedCell(evaluation, cell)!.value),
  );
}

describe("evaluator fubsheet frontend", () => {
  it("valuta numeri, stringhe, operatori, riferimenti, intervalli e funzioni", () => {
    expect(
      displays(
        sheet([
          "2",
          "=A1^3+4/2",
          '=A2&" celle"',
          "=SUM(A1:A2)",
          "=AVERAGE(A1:A2)",
          "=MIN(A1:A2)",
          "=MAX(A1:A2)",
          '=IF(A2>5,"alto","basso")',
          '="café ""vero"""',
        ]),
      ),
    ).toEqual(["2", "10", "10 celle", "12", "6", "2", "10", "alto", 'café "vero"']);
  });

  it("propaga errori tipizzati e rileva cicli senza ricorsione infinita", () => {
    expect(
      displays(
        sheet([
          "=A2",
          "=A1",
          "=1/0",
          "=MISSING(1)",
          "=Z99",
          "=1+\"testo\"",
          "=(1+",
        ]),
      ),
    ).toEqual(["#CYCLE!", "#CYCLE!", "#DIV/0!", "#NAME?", "#REF!", "#VALUE!", "#PARSE!"]);
  });

  it("accetta separatori locali e riferimenti assoluti come il codec Rust", () => {
    expect(displays(sheet(["3", "=$A$1+2", "=SUM(A1;A2)"]))).toEqual(["3", "5", "8"]);
  });
});
