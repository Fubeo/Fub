import { describe, expect, it } from "vitest";
import {
  cellAtOffset,
  cellContentStart,
  clearFormatting,
  columnName,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  isWrapped,
  moveRows,
  parseTable,
  parseTsv,
  pasteMatrix,
  rangeTsv,
  serializeTable,
  setAlign,
  setCell,
  sortRows,
  tableChanges,
  toggleWrap,
  type ParsedTable,
  type TableData,
} from "./table-model";

function parsed(source: string): ParsedTable {
  const table = parseTable(source);
  if (!table) throw new Error("non è una tabella");
  return table;
}

/// Applica le modifiche alla sorgente, dall'ultima alla prima.
function apply(source: string, next: TableData): string {
  const changes = tableChanges(parsed(source), next);
  let out = source;
  for (const change of [...changes].reverse()) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

describe("la lettura di una tabella", () => {
  it("legge celle e allineamenti, con o senza pipe di bordo", () => {
    expect(parsed("| a | b |\n| :-- | --: |\n| 1 | 2 |")).toMatchObject({
      rows: [["a", "b"], ["1", "2"]],
      aligns: ["left", "right"],
    });
    expect(parsed("a | b\n--- | :-:\n1 | 2")).toMatchObject({
      rows: [["a", "b"], ["1", "2"]],
      aligns: [null, "center"],
    });
  });

  it("una pipe protetta è un dato, e una riga corta si completa", () => {
    expect(parsed("| a \\| b | c |\n| --- | --- |\n| 1 |").rows).toEqual([["a | b", "c"], ["1", ""]]);
    expect(parsed("| a |\n| --- |\n| 1 | 2 |")).toMatchObject({ rows: [["a", ""], ["1", "2"]], aligns: [null, null] });
    expect(parsed("|  |  |\n| --- | --- |").rows).toEqual([["", ""]]);
  });

  it("senza riga di delimitatori non è una tabella", () => {
    expect(parseTable("| a |\n| x |")).toBeNull();
    expect(parseTable("| a |")).toBeNull();
  });

  it("sa dove comincia il testo di una cella e quale cella contiene un punto", () => {
    const table = parsed("| a | bb |\n| --- | --- |\n|  | 2 |");
    expect(cellContentStart(table, 0, 1)).toBe(6);
    expect(cellContentStart(table, 1, 0)).toBeNull();
    expect(cellAtOffset(table, 7)).toEqual({ row: 0, col: 1 });
    expect(cellAtOffset(table, table.source.length - 2)).toEqual({ row: 1, col: 1 });
  });
});

describe("la scrittura", () => {
  it("una cella cambiata tocca soltanto la sua cella", () => {
    const source = "|a|b|\n|---|---|\n|1|2|";
    expect(apply(source, setCell(parsed(source), 1, 1, "due"))).toBe("|a|b|\n|---|---|\n|1| due |");
    const spaced = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(apply(spaced, setCell(parsed(spaced), 1, 0, "uno"))).toBe("| a | b |\n| --- | --- |\n| uno | 2 |");
    expect(apply(spaced, setCell(parsed(spaced), 1, 0, ""))).toBe("| a | b |\n| --- | --- |\n| | 2 |");
    expect(apply(spaced, setCell(parsed(spaced), 0, 0, "x|y"))).toBe("| x\\|y | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("una riga corta si riscrive per intero quando le si dà la cella che le manca", () => {
    const source = "| a | b |\n| --- | --- |\n| 1 |";
    expect(apply(source, setCell(parsed(source), 1, 1, "2"))).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("cambiare la forma riscrive la tabella in forma canonica", () => {
    const source = "|a|b|\n|:-|-:|\n|1|2|";
    expect(apply(source, insertRows(parsed(source), 2))).toBe("| a | b |\n| :--- | ---: |\n| 1 | 2 |\n|  |  |");
    expect(apply(source, setAlign(parsed(source), 0, 1, "center"))).toBe("| a | b |\n| :---: | :---: |\n| 1 | 2 |");
    expect(serializeTable({ rows: [["a"]], aligns: [null] })).toBe("| a |\n| --- |");
  });

  it("nessuna modifica, nessun cambiamento", () => {
    const source = "| a |\n| --- |\n| 1 |";
    expect(tableChanges(parsed(source), parsed(source))).toEqual([]);
  });
});

describe("righe e colonne", () => {
  const data: TableData = { rows: [["h1", "h2"], ["a", "b"], ["c", "d"]], aligns: ["left", null] };

  it("le righe nuove nascono nel corpo, mai sopra l'intestazione", () => {
    expect(insertRows(data, 0).rows).toEqual([["h1", "h2"], ["", ""], ["a", "b"], ["c", "d"]]);
    expect(deleteRows(data, 0, 0)).toBe(data);
    expect(deleteRows(data, 0, 1).rows).toEqual([["h1", "h2"], ["c", "d"]]);
  });

  it("le colonne portano con sé l'allineamento, e l'ultima non si toglie", () => {
    expect(insertColumns(data, 1)).toEqual({
      rows: [["h1", "", "h2"], ["a", "", "b"], ["c", "", "d"]],
      aligns: ["left", null, null],
    });
    expect(deleteColumns(data, 0, 0)).toEqual({ rows: [["h2"], ["b"], ["d"]], aligns: [null] });
    expect(deleteColumns(data, 0, 1)).toBe(data);
  });

  it("gli spostamenti restano nel corpo", () => {
    expect(moveRows(data, 1, 1, 1).rows).toEqual([["h1", "h2"], ["c", "d"], ["a", "b"]]);
    expect(moveRows(data, 1, 1, -1)).toBe(data);
  });

  it("l'ordinamento legge i numeri come numeri e tiene l'intestazione", () => {
    const numbers: TableData = { rows: [["n"], ["10"], ["9"], ["1"]], aligns: [null] };
    expect(sortRows(numbers, 0, 1).rows).toEqual([["n"], ["1"], ["9"], ["10"]]);
    expect(sortRows(numbers, 0, -1).rows).toEqual([["n"], ["10"], ["9"], ["1"]]);
  });
});

describe("gli appunti", () => {
  it("incollare oltre il bordo allarga la tabella", () => {
    const data: TableData = { rows: [["a", "b"], ["1", "2"]], aligns: [null, null] };
    expect(pasteMatrix(data, { row: 1, col: 1 }, [["x", "y"], ["z", "w"]]).rows).toEqual([
      ["a", "b", ""],
      ["1", "x", "y"],
      ["", "z", "w"],
    ]);
  });

  it("tabulazioni e a capo, nei due versi", () => {
    expect(parseTsv("a\tb\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv("solo")).toEqual([["solo"]]);
    expect(parseTsv(" a \t b")).toEqual([["a", "b"]]);
    const data: TableData = { rows: [["a", "b"], ["1", "2"]], aligns: [null, null] };
    expect(rangeTsv(data, { top: 0, left: 0, bottom: 1, right: 1 })).toBe("a\tb\n1\t2\n");
  });

  it("una cella multilinea di un foglio è una cella, e si scrive su una riga", () => {
    expect(parseTsv('"prima\nseconda\tterza"\tx\r\ny\r\n')).toEqual([["prima\nseconda\tterza", "x"], ["y"]]);
    const data: TableData = { rows: [["a", "b"], ["1", "2"]], aligns: [null, null] };
    const pasted = pasteMatrix(data, { row: 1, col: 0 }, parseTsv('"prima\nseconda"\n'));
    expect(serializeTable(pasted)).toBe("| a | b |\n| --- | --- |\n| prima seconda | 2 |");
  });
});

describe("la formattazione delle celle", () => {
  it("il corsivo si distingue dal grassetto per la parità dei marcatori", () => {
    expect(isWrapped("**b**", "*", "*")).toBe(false);
    expect(isWrapped("*i*", "*", "*")).toBe(true);
    expect(isWrapped("***x***", "*", "*")).toBe(true);
    expect(isWrapped("**b**", "**", "**")).toBe(true);
  });

  it("avvolge le celle che non lo sono, e le libera quando lo sono tutte", () => {
    const data: TableData = { rows: [["a", "**b**", ""]], aligns: [null, null, null] };
    const range = { top: 0, left: 0, bottom: 0, right: 2 };
    const bold = toggleWrap(data, range, "**");
    expect(bold.rows).toEqual([["**a**", "**b**", ""]]);
    expect(toggleWrap(bold, range, "**").rows).toEqual([["a", "b", ""]]);
  });

  it("cancellare la formattazione toglie i marcatori che avvolgono la cella", () => {
    const data: TableData = { rows: [["**_a_**", "`x`", "a **b**"]], aligns: [null, null, null] };
    expect(clearFormatting(data, { top: 0, left: 0, bottom: 0, right: 2 }).rows).toEqual([["a", "x", "a **b**"]]);
  });
});

describe("i nomi delle colonne", () => {
  it("sono quelli di un foglio di calcolo", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});
