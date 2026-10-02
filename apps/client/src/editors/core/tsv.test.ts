import { describe, expect, it } from "vitest";
import { parseTsv, tsvRows } from "./tsv";

describe("il TSV dei fogli", () => {
  it("legge il TSV degli altri fogli e lascia com'è la prosa con virgolette", () => {
    // Excel: CRLF fra le righe e in coda, LF dentro le celle fra virgolette.
    expect(parseTsv('uno\t"due\nrighe"\r\ntre\t"con ""virgolette"""\r\n')).toEqual([
      ["uno", "due\nrighe"],
      ["tre", 'con "virgolette"'],
    ]);
    // Google Sheets: niente a capo in coda.
    expect(parseTsv('a\t"b\nc"\nd\te')).toEqual([["a", "b\nc"], ["d", "e"]]);
    expect(parseTsv("A\tB\rC\tD")).toEqual([["A", "B"], ["C", "D"]]);
    expect(parseTsv('"Ciao", disse\tx')).toEqual([['"Ciao", disse', "x"]]);
    expect(parseTsv('"aperta\nriga')).toEqual([['"aperta'], ["riga"]]);
    expect(parseTsv('"\t""')).toEqual([['"', ""]]);
    expect(parseTsv("a\t")).toEqual([["a", ""]]);
    expect(parseTsv("\n")).toEqual([[""]]);
    expect(parseTsv("")).toEqual([]);
  });

  it("mette fra virgolette soltanto le celle che lo chiedono", () => {
    expect(tsvRows([["a", "b\tc"], ['"x', 'y"z']])).toBe('a\t"b\tc"\n"""x"\ty"z\n');
    expect(tsvRows([["riga\r\nnuova"]])).toBe('"riga\r\nnuova"\n');
    expect(tsvRows([[""], [""]])).toBe("\n\n");
    expect(parseTsv(tsvRows([["a", "b\tc"], ['"x', 'y"z']]))).toEqual([["a", "b\tc"], ['"x', 'y"z']]);
  });
});
