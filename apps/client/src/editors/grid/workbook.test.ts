import { describe, expect, it } from "vitest";
import fixture from "../../__fixtures__/xlsx-projection.json";
import { cellKey, parseWorkbookProjection, WORKBOOK_SCALE } from "./workbook";

/// La proiezione della fixture come oggetto, da cambiare in un test.
function projection(): Record<string, any> {
  return JSON.parse(fixture.source);
}

function parsed(change: (root: Record<string, any>) => void) {
  const root = projection();
  change(root);
  return () => parseWorkbookProjection(JSON.stringify(root));
}

describe("la proiezione di una cartella di Excel", () => {
  it("legge la fixture del codec: fogli visibili, assi, celle e avvisi", () => {
    const view = parseWorkbookProjection(fixture.source);
    // Il foglio nascosto non è fra quelli da mostrare.
    expect(view.workbook.sheets.map((sheet) => sheet.name)).toEqual(["Conti", "Note"]);
    expect(view.active).toBe(0);
    expect(view.notices).toEqual([{ kind: "not_shown", detail: "merges" }, { kind: "recalculated" }]);

    const conti = view.workbook.sheets[0];
    expect(conti.rows.map((row) => row.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(conti.columns.map((column) => column.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(conti.rows[0].height).toBeCloseTo(20 * WORKBOOK_SCALE);
    expect(conti.rows[3].height).toBeCloseTo(32 * WORKBOOK_SCALE);
    expect(conti.rows[5].hidden).toBe(true);
    expect(conti.columns[0].width).toBeCloseTo(140 * WORKBOOK_SCALE);
    expect(conti.columns[3].hidden).toBe(true);

    const cell = (row: number, column: number) => view.sheets[0].cells.get(cellKey({ row, column }));
    expect(cell(0, 0)?.cell).toEqual({
      row: "1",
      column: "A",
      input: "Voce",
      style: { bold: true, italic: true, text_color: "#FF0000", horizontal: "center" },
    });
    expect(cell(1, 2)?.cell.input).toBe("50.00%");
    expect(cell(2, 2)).toMatchObject({ formula: "=B3/B4", derived: false, cell: { input: "-15.00%" } });
    expect(cell(3, 1)?.cell.style).toEqual({ text_color: "#000000", fill_color: "#FFFF00", horizontal: "end" });
    expect(cell(3, 2)?.cell.input).toBe("#DIV/0!");
    expect(cell(4, 5)).toMatchObject({ derived: true, cell: { input: "2" } });
    expect(cell(0, 1)?.derived).toBe(false);
    // Le celle sono anche nella lista del foglio, per chi le cerca lì.
    expect(conti.cells).toHaveLength(view.sheets[0].cells.size);
  });

  it("parte dal primo foglio visibile quando quello attivo è nascosto", () => {
    const view = parseWorkbookProjection(JSON.stringify({ ...projection(), active: 2 }));
    expect(view.active).toBe(0);
    const second = parseWorkbookProjection(JSON.stringify({ ...projection(), active: 1 }));
    expect(second.workbook.sheets[second.active].name).toBe("Note");
  });

  it("rifiuta una forma che non è quella del codec", () => {
    expect(parsed((root) => { root.version = 2; })).toThrow(RangeError);
    expect(parsed((root) => { root.extra = true; })).toThrow(/campo sconosciuto extra/u);
    expect(parsed((root) => { root.sheets[0].cells[0].note = "x"; })).toThrow(/campo sconosciuto note/u);
    expect(parsed((root) => { root.sheets[0].cells[0].style.underline = true; })).toThrow(/campo sconosciuto/u);
    expect(parsed((root) => { root.notices.push({ kind: "magic" }); })).toThrow(/tipo di avviso/u);
    expect(parsed((root) => { root.notices[0].detail = "tables"; })).toThrow(/parte non mostrata/u);
    expect(parsed((root) => { root.sheets[0].cells[0].row = 6; })).toThrow(/fuori dal foglio/u);
    expect(parsed((root) => { root.sheets[0].cells.push({ ...root.sheets[0].cells[0] }); })).toThrow(/ripetuta/u);
    expect(parsed((root) => { root.sheets[0].cells[0].style.text_color = "red; background: url(x)"; })).toThrow(/colore/u);
    expect(parsed((root) => { root.sheets[0].cells[0].value.kind = "date"; })).toThrow(/sconosciuto/u);
    expect(parsed((root) => { root.sheets[0].rows[0].size = 0; })).toThrow(/dimensione/u);
    expect(parsed((root) => { root.sheets[0].row_count = 1_048_577; })).toThrow(/righe/u);
    expect(parsed((root) => { root.sheets[1].name = "Conti"; })).toThrow(/ripetuti/u);
    expect(parsed((root) => { root.active = 3; })).toThrow(/foglio attivo/u);
    expect(() => parseWorkbookProjection("x".repeat(16 * 1024 * 1024 + 1))).toThrow(RangeError);
  });
});
