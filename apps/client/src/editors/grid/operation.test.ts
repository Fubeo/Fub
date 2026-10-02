import { describe, expect, it } from "vitest";
import { cellAt, parseWorkbook, serializeWorkbook } from "./model";
import {
  applyGridPatches,
  commitGridPatches,
  inputPatch,
  inverseGridPatches,
  pastePatches,
  selectionText,
  selectionTsv,
} from "./operation";
import { parseTsv } from "../core/tsv";

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

describe("clipboard TSV", () => {
  const tricky = 'prima\nseconda\tterza';
  function filled(cells: Array<[string, string, string]>): string {
    return JSON.stringify({
      version: 1,
      sheets: [{
        id: "main",
        name: "Main",
        rows: [{ id: "r1", hidden: false }, { id: "r2", hidden: false }],
        columns: [{ id: "c1", hidden: false }, { id: "c2", hidden: false }],
        cells: cells.map(([row, column, input]) => ({ row, column, input })),
      }],
    });
  }

  it("una cella con tab, a capo e virgolette torna com'era, nelle stesse dimensioni", () => {
    const sheet = parseWorkbook(filled([
      ["r1", "c1", tricky],
      ["r1", "c2", '"citata"'],
      ["r2", "c1", 'a"b\r\nc'],
      ["r2", "c2", "\""],
    ])).sheets[0];
    const all = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
    const one = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };

    expect(selectionTsv(sheet, one)).toBe('"prima\nseconda\tterza"\n');
    expect(parseTsv(selectionTsv(sheet, one))).toEqual([[tricky]]);
    expect(pastePatches(sheet, { row: 0, column: 0 }, selectionTsv(sheet, one))).toEqual([]);
    expect(parseTsv(selectionTsv(sheet, all))).toEqual([[tricky, '"citata"'], ['a"b\r\nc', '"']]);
    expect(pastePatches(sheet, { row: 0, column: 0 }, selectionTsv(sheet, all))).toEqual([]);
    expect(selectionText(sheet, one)).toBe(tricky);
  });

  it("un'ultima riga vuota resta una riga e svuota dove si incolla", () => {
    const sheet = parseWorkbook(filled([["r1", "c1", "x"], ["r1", "c2", "y"], ["r2", "c2", "z"]])).sheets[0];
    const column = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } };
    expect(selectionTsv(sheet, column)).toBe("x\n\n");

    const patches = pastePatches(sheet, { row: 0, column: 1 }, selectionTsv(sheet, column));
    expect(patches.map((patch) => [patch.coordinate.row, patch.after?.input ?? null])).toEqual([["r1", "x"], ["r2", null]]);
    expect(parseTsv(selectionTsv(sheet, { anchor: { row: 1, column: 0 }, focus: { row: 1, column: 0 } }))).toEqual([[""]]);
  });
});

describe("valori JSON che il foglio non tocca", () => {
  // Interi oltre la precisione di `Number`, che `serde_json` conserva: il
  // formato li ammette nelle proprietà, e una modifica di cella non li tocca.
  const big = "9007199254740993";
  function withProperties(): string {
    return `{"version":1,"properties":{"numero":${big},"annidato":[1.0,{"negativo":-${big}}]},`
      + `"sheets":[{"id":"main","name":"Main","rows":[{"id":"r1","hidden":false}],`
      + `"columns":[{"id":"c1","hidden":false}],"cells":[{"row":"r1","column":"c1","input":"1"}],`
      + `"properties":{"limite":${big}}}]}`;
  }

  it("una modifica di cella conserva i numeri delle proprietà come erano scritti", () => {
    const before = withProperties();
    const workbook = parseWorkbook(before);
    const patch = inputPatch(workbook.sheets[0], { row: 0, column: 0 }, "2")!;
    const committed = commitGridPatches(workbook, before, [patch])!;

    expect(committed.source).toContain(`"numero": ${big}`);
    expect(committed.source).toContain(`"negativo": -${big}`);
    expect(committed.source).toContain(`"limite": ${big}`);
    expect(committed.source).toMatch(/\[\s*1\.0,/);
    expect(cellAt(parseWorkbook(committed.source).sheets[0], { row: 0, column: 0 })?.input).toBe("2");
    expect(serializeWorkbook(parseWorkbook(committed.source))).toBe(committed.source);
  });

  it("scrive come JSON.stringify con due spazi", () => {
    const before = withProperties().replaceAll(big, "7").replace("1.0", "1.5");
    expect(serializeWorkbook(parseWorkbook(before))).toBe(`${JSON.stringify(JSON.parse(before), null, 2)}\n`);
  });

  it("legge come JSON.parse, chiavi speciali e duplicate comprese", () => {
    const before = withProperties().replace(
      `"numero":${big}`,
      `"__proto__":{"x":1},"doppia":1,"doppia":2,"testo":"\\u00e9\\n\\ud83d\\ude00"`,
    );
    const properties = parseWorkbook(before).properties!;
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
    expect(Object.keys(properties)).toEqual(["__proto__", "doppia", "testo", "annidato"]);
    expect(serializeWorkbook(parseWorkbook(before))).toContain('"doppia": 2,');
    expect(properties.testo).toBe("\u00e9\n\u{1F600}");
    for (const malformed of ['{"version":1,"sheets":[]', '{"version":01,"sheets":[]}', '{"version":1,"sheets":[],}', '{"version":1 "sheets":[]}']) {
      expect(() => parseWorkbook(malformed)).toThrow();
    }
  });

  it("le proprietà restano un oggetto anche quando i loro numeri non si leggono", () => {
    expect(() => parseWorkbook('{"version":1,"properties":5,"sheets":[]}')).toThrow("proprietà workbook non è un oggetto");
    expect(() => parseWorkbook(withProperties().replace(`{"limite":${big}}`, big))).toThrow("proprietà sheet non è un oggetto");
  });
});
