// Le regole pure delle finestre dei fogli: riferimenti, conversioni, letture
// dei risultati del provider e i codici di Formato celle.
import { describe, expect, it } from "vitest";
import { charsToPixels, moveTarget, pixelsToChars, pixelsToPoints } from "./cells";
import { colorHex, modelColor } from "./colors";
import { columnList } from "./data";
import { decimalsOf, fillOf, fillValues, formatCode, numberCode, numberValues, stylePatch, styleValues } from "./format-cells";
import { filterFunctions, functionInfos } from "./function";
import { definedNames } from "./names";
import { absolute, cellName, columnIndex, columnLetters, parseArea, quoteSheet } from "./refs";
import { readResult, resultList } from "./result";
import { listedRules } from "./rules";
import { boundLabels } from "./validation";

describe("i riferimenti", () => {
  it("leggono e scrivono le lettere delle colonne", () => {
    expect([0, 25, 26, 701, 702, 16383].map(columnLetters)).toEqual(["A", "Z", "AA", "ZZ", "AAA", "XFD"]);
    expect(["A", "z", "AA", "XFD"].map(columnIndex)).toEqual([0, 25, 26, 16383]);
    expect(columnIndex("A1")).toBeNull();
    expect(columnIndex("ABCD")).toBeNull();
  });

  it("leggono un'area semplice, in qualunque verso", () => {
    expect(parseArea("B2")).toEqual({ row: 1, column: 1, lastRow: 1, lastColumn: 1 });
    expect(parseArea("$D$10:b2")).toEqual({ row: 1, column: 1, lastRow: 9, lastColumn: 3 });
    expect(parseArea("A:A")).toBeNull();
    expect(parseArea("A1:B2:C3")).toBeNull();
    expect(parseArea("Foglio1!A1")).toBeNull();
  });

  it("scrivono celle, aree assolute e fogli fra apici", () => {
    expect(cellName(0, 0)).toBe("A1");
    expect(absolute({ row: 1, column: 1, lastRow: 9, lastColumn: 3 })).toBe("$B$2:$D$10");
    expect(absolute({ row: 0, column: 0, lastRow: 0, lastColumn: 0 })).toBe("$A$1");
    expect(quoteSheet("Foglio1")).toBe("Foglio1");
    expect(quoteSheet("Il mio foglio")).toBe("'Il mio foglio'");
    expect(quoteSheet("L'anno")).toBe("'L''anno'");
    // Un nome che si legge come una cella va fra apici.
    expect(quoteSheet("AB12")).toBe("'AB12'");
  });
});

describe("le misure di righe e colonne", () => {
  it("convertono come GridCraft", () => {
    expect(pixelsToPoints(20)).toBe(15);
    expect(pixelsToChars(64)).toBe(8.43);
    expect(charsToPixels(8.43)).toBe(64);
    expect(pixelsToChars(6)).toBe(0.5);
    expect(charsToPixels(0.5)).toBe(6);
  });

  it("danno a `sheet.move` l'indice dopo che il foglio si è tolto", () => {
    // Tre fogli; il primo prima del terzo finisce al posto 1.
    expect(moveTarget(0, 2, 3, false)).toBe(1);
    expect(moveTarget(2, 0, 3, false)).toBe(0);
    expect(moveTarget(0, null, 3, false)).toBe(2);
    expect(moveTarget(0, 2, 3, true)).toBe(2);
    expect(moveTarget(0, null, 3, true)).toBe(3);
  });
});

describe("i risultati del provider", () => {
  it("si leggono dal testo JSON, con gli elenchi anche in `{value}`", () => {
    expect(readResult(null)).toBeNull();
    expect(readResult("non json")).toBeNull();
    expect(readResult('{"a":1}')).toEqual({ a: 1 });
    expect(resultList([1, 2])).toEqual([1, 2]);
    expect(resultList({ value: ["x"] })).toEqual(["x"]);
    expect(resultList({ other: [] })).toBeNull();
  });

  it("danno i nomi definiti, con l'ambito della cartella per ripiego", () => {
    const names = definedNames({
      value: [
        { name: "Tasso", value: 0.05, refersTo: "=Foglio1!$B$1", scope: "Foglio1", comment: "" },
        { name: "Errore", value: { error: "#REF!" }, refersTo: "=#REF!" },
        { value: 3 },
      ],
    });
    expect(names).toEqual([
      { name: "Tasso", value: "0.05", refersTo: "=Foglio1!$B$1", scope: "Foglio1", comment: "" },
      { name: "Errore", value: "#REF!", refersTo: "=#REF!", scope: "Workbook", comment: "" },
    ]);
  });

  it("danno le regole di formattazione nell'ordine in cui valgono", () => {
    const rules = listedRules({
      rules: [
        { ranges: ["A1:A10"], rule: { Expression: { formula: "A1>0" } } },
        { ranges: ["B1:B5", "D1"], rule: "UniqueValues" },
      ],
    });
    expect(rules.map((rule) => rule.index)).toEqual([0, 1]);
    expect(rules[0]!.label).toContain("=A1>0");
    expect(rules[0]!.label).toContain("A1:A10");
    expect(rules[1]!.label).toContain("B1:B5, D1");
    expect(listedRules(null)).toEqual([]);
  });

  it("filtrano le funzioni per categoria, recenti o ricerca", () => {
    const all = functionInfos({
      value: [
        { name: "SUM", category: "MathTrig", signature: "SUM(number1, …)", description: "Adds numbers" },
        { name: "VLOOKUP", category: "Lookup", signature: "VLOOKUP(…)", description: "Looks up a value" },
        { category: "Text" },
      ],
    });
    expect(all.map((each) => each.name)).toEqual(["SUM", "VLOOKUP"]);
    expect(filterFunctions(all, [], "Lookup", "").map((each) => each.name)).toEqual(["VLOOKUP"]);
    expect(filterFunctions(all, ["vlookup", "MISSING"], "recent", "").map((each) => each.name)).toEqual(["VLOOKUP"]);
    expect(filterFunctions(all, [], "all", "").length).toBe(2);
    // La ricerca guarda anche la descrizione, e la categoria non conta.
    expect(filterFunctions(all, [], "Lookup", "adds").map((each) => each.name)).toEqual(["SUM"]);
  });
});

describe("le colonne scritte a lettere", () => {
  it("si leggono, o danno la ragione", () => {
    expect(columnList("a, C;d  E", "Colonne:")).toEqual(["A", "C", "D", "E"]);
    expect(typeof columnList("A, 1", "Colonne:")).toBe("string");
  });
});

describe("i limiti della convalida", () => {
  it("si chiamano come l'operatore e il tipo dicono", () => {
    const [low, high] = boundLabels("date", "between");
    expect(low).not.toBe(high);
    const [one, same] = boundLabels("whole", "equal");
    expect(one).toBe(same);
  });
});

describe("i colori del modello", () => {
  it("si leggono da JSON e si disegnano", () => {
    expect(modelColor({ Rgb: 0xff0000 })).toEqual({ Rgb: 0xff0000 });
    expect(modelColor({ Theme: [4, 400] })).toEqual({ Theme: [4, 400] });
    expect(modelColor("rosso")).toBe("Auto");
    expect(colorHex({ Rgb: 0xff }, [])).toBe("#0000FF");
    expect(colorHex("Auto", [])).toBeNull();
    expect(colorHex({ Theme: [1, 0] }, ["#FFFFFF", "#123456"])).toBe("#123456");
  });
});

describe("i codici della scheda Numero", () => {
  it("contano i decimali della prima sezione", () => {
    expect(decimalsOf("0.00")).toBe(2);
    expect(decimalsOf('#,##0.000 "kg"')).toBe(3);
    expect(decimalsOf("0")).toBe(0);
  });

  it("scrivono i negativi come Excel", () => {
    expect(numberCode(2, true, "minus")).toBe("#,##0.00");
    expect(numberCode(1, false, "red")).toBe("0.0;[Red]0.0");
    expect(numberCode(0, true, "parentheses")).toBe("#,##0_);(#,##0)");
    expect(numberCode(2, false, "redParentheses", "[$$-409]")).toBe("[$$-409]0.00_);[Red]([$$-409]0.00)");
  });

  it("scrivono ogni categoria", () => {
    const base = { decimals: 2, thousands: false, negative: "minus", symbol: "none", type: "", code: "" };
    expect(formatCode({ ...base, category: "general" })).toBe("General");
    expect(formatCode({ ...base, category: "percentage", decimals: 1 })).toBe("0.0%");
    expect(formatCode({ ...base, category: "scientific" })).toBe("0.00E+00");
    expect(formatCode({ ...base, category: "text" })).toBe("@");
    expect(formatCode({ ...base, category: "currency", symbol: "eur" })).toBe("#,##0.00 [$€-410]");
    expect(formatCode({ ...base, category: "accounting", symbol: "none" })).toBe('_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-');
    expect(formatCode({ ...base, category: "accounting", symbol: "gbp" })).toBe(
      '_-[$£-809]* #,##0.00_-;-[$£-809]* #,##0.00_-;_-[$£-809]* "-"??_-;_-@_-',
    );
    expect(formatCode({ ...base, category: "date", type: "yyyy-mm-dd" })).toBe("yyyy-mm-dd");
    expect(formatCode({ ...base, category: "custom", code: '0 "pz"' })).toBe('0 "pz"');
  });

  it("riconoscono un codice e lo rifanno uguale", () => {
    for (const code of ["General", "@", "0.00", "#,##0", "0.0%", "0.00E+00", "#,##0.00;[Red]#,##0.00", "dd/mm/yyyy", "h:mm", "# ?/?"]) {
      const values = numberValues(code);
      expect(values.category, code).not.toBe("custom");
      expect(formatCode(values), code).toBe(code);
    }
  });

  it("lasciano Personalizzato ciò che una categoria non rifà uguale", () => {
    for (const code of ['0.00 "kg"', "[Blue]0", "dd mmmm"]) {
      const values = numberValues(code);
      expect(values.category, code).toBe("custom");
      expect(formatCode(values)).toBe(code);
    }
  });
});

describe("il riempimento", () => {
  it("va e torna fra modello e scheda", () => {
    expect(fillValues({ pattern: "None" })).toEqual({ background: "Auto", pattern: "None", patternColor: "Auto" });
    const solid = fillValues({ pattern: "Solid", fg: { Rgb: 0xffff00 }, bg: "Auto" });
    expect(solid.background).toEqual({ Rgb: 0xffff00 });
    expect(fillOf(solid)).toEqual({ pattern: "Solid", fg: { Rgb: 0xffff00 }, bg: "Auto" });
    const hatched = { pattern: "LightGrid", fg: { Rgb: 1 }, bg: { Rgb: 2 } };
    expect(fillOf(fillValues(hatched))).toEqual(hatched);
    expect(fillOf({ background: "Auto", pattern: "None", patternColor: "Auto" })).toEqual({ pattern: "None", fg: "Auto", bg: "Auto" });
  });
});

describe("la patch di Formato celle", () => {
  const style = {
    num_fmt: "0.00",
    font: { name: "Calibri", size: 11, bold: true, italic: false, color: "Auto", underline: "None", strike: false, vert: "Baseline" },
    align: { h: "General", v: "Bottom", wrap: false, indent: 0, rotation: 0, shrink: false },
    borders: { top: { style: "Thin", color: "Auto" }, bottom: { style: "None", color: "Auto" } },
    fill: { pattern: "None", fg: "Auto", bg: "Auto" },
    protection: { locked: true, hidden: false },
  };

  it("parte dallo stile della cella", () => {
    const values = styleValues(style);
    expect(values.category).toBe("number");
    expect(values.decimals).toBe(2);
    expect(values.fontStyle).toBe("bold");
    expect(values.top).toBe(true);
    expect(values.bottom).toBe(false);
    expect(values.locked).toBe(true);
    expect(styleValues({ align: { rotation: 255 } }).stacked).toBe(true);
  });

  it("è vuota se non si cambia niente", () => {
    const start = styleValues(style);
    expect(stylePatch(start, { ...start })).toEqual({});
  });

  it("dà soltanto i gruppi e i campi cambiati", () => {
    const start = styleValues(style);
    const patch = stylePatch(start, { ...start, fontStyle: "boldItalic", wrap: true, background: { Rgb: 0xff0000 } });
    expect(patch).toEqual({
      font: { bold: true, italic: true },
      align: { wrap: true },
      fill: { pattern: "Solid", fg: { Rgb: 0xff0000 }, bg: "Auto" },
    });
  });

  it("scrive il formato numero e il testo in verticale", () => {
    const start = styleValues(style);
    expect(stylePatch(start, { ...start, decimals: 3 })).toEqual({ numFmt: "0.000" });
    expect(stylePatch(start, { ...start, stacked: true })).toEqual({ align: { rotation: 255 } });
  });

  it("dà ai bordi accesi la linea scelta e spegne quelli tolti", () => {
    const start = styleValues(style);
    expect(stylePatch(start, { ...start, top: false, left: true, line: "Thick" }).borders).toEqual({
      top: { style: "None", color: "Auto" },
      left: { style: "Thick", color: "Auto" },
    });
    // Cambiare soltanto la linea ridisegna i bordi già accesi.
    expect(stylePatch(start, { ...start, line: "Double" }).borders).toEqual({ top: { style: "Double", color: "Auto" } });
  });

  it("tiene apice e pedice nello stesso campo del modello", () => {
    const start = styleValues(style);
    expect(stylePatch(start, { ...start, superscript: true })).toEqual({ font: { vert: "Superscript" } });
  });
});
