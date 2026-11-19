import { describe, expect, it } from "vitest";
import { parseTable } from "./table-model";
import type { CellReading, CellValuePort } from "./cell-value";
import { cellsOrigin, FUB_CELLS_TYPE, rememberCellsCopy } from "./cells-clipboard";
import {
  cellsEmbed,
  detachedTable,
  localizedShown,
  proposesSheet,
  quotedSheet,
  rangeCells,
  readNumberLook,
  sheetCells,
  splitSheetPart,
  tableOfShown,
  tsvTable,
  type SheetCell,
} from "./table-sheet";

/// Ciò che il foglio mostra di una cella scritta dal comando: il formato di
/// GridCraft, coi separatori all'inglese (lo provano i test di
/// `fub_format_xlsx::values`: «1,240.50 €», «12.5%», «(1,234)»).
function sheetShows(cell: SheetCell): string {
  if (typeof cell === "string") return cell;
  const value = cell.percent ? cell.number * 100 : cell.number;
  let text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: cell.decimals,
    maximumFractionDigits: cell.decimals,
    useGrouping: cell.grouped,
  }).format(Math.abs(value));
  if (cell.percent) text += "%";
  if (cell.currency) {
    const space = cell.currency_spaced ? " " : "";
    text = cell.currency_after ? `${text}${space}${cell.currency}` : `${cell.currency}${space}${text}`;
  }
  if (value < 0) text = cell.parens ? `(${text})` : `-${text}`;
  return text;
}

describe("readNumberLook", () => {
  it("legge un numero all'italiana col suo aspetto", () => {
    expect(readNumberLook("1.240,50 €", "it")).toEqual({
      number: 1240.5,
      decimals: 2,
      grouped: true,
      percent: false,
      parens: false,
      currency: "€",
      currency_after: true,
      currency_spaced: true,
    });
    expect(readNumberLook("12,5%", "it")).toEqual({ number: 0.125, decimals: 1, grouped: false, percent: true, parens: false });
    expect(readNumberLook("(1.234)", "it")).toMatchObject({ number: -1234, grouped: true, parens: true, decimals: 0 });
    expect(readNumberLook("$12", "en")).toMatchObject({ number: 12, currency: "$", currency_after: false, currency_spaced: false });
  });

  it("lascia testo ciò che non è un numero", () => {
    expect(readNumberLook("Affitto", "it")).toBeNull();
    expect(readNumberLook("15.11", "it")).toBeNull();
    expect(readNumberLook("", "it")).toBeNull();
  });
});

describe("sheetCells", () => {
  it("tiene l'intestazione testo e legge il corpo nella lingua della nota", () => {
    const parsed = parseTable("| Voce | 2025 |\n| --- | ---: |\n| **Luce \\| gas** | 1.240,50 |\n| A<br>capo |  |")!;
    expect(sheetCells(parsed.rows, 2, "it")).toEqual([
      ["Voce", "2025"],
      ["Luce | gas", { number: 1240.5, decimals: 2, grouped: true, percent: false, parens: false }],
      ["A\ncapo", ""],
    ]);
  });
});

describe("andata e ritorno", () => {
  it("tabella, foglio, tabella: gli stessi valori", () => {
    const source = "| Voce | Importo | Quota |\n| --- | ---: | ---: |\n| Affitto | 1.240,50 € | 12,5% |\n| Rimborso | (1.234) | 3% |\n| Luce | 98 | 0,5% |";
    const parsed = parseTable(source)!;
    const cells = sheetCells(parsed.rows, 3, "it");
    const shown = cells.map((row) => row.map(sheetShows));
    expect(shown[1]).toEqual(["Affitto", "1,240.50 €", "12.5%"]);
    const back = parseTable(tableOfShown(shown, "it")!)!;
    expect(back.rows).toEqual(parsed.rows);
    expect(back.aligns).toEqual([null, "right", "right"]);
  });
});

describe("localizedShown", () => {
  it("riscrive i separatori di un numero, non quelli di un testo", () => {
    expect(localizedShown("1,240.50 €", "it")).toBe("1.240,50 €");
    expect(localizedShown("1,240.50 €", "en")).toBe("1,240.50 €");
    expect(localizedShown("11/19/2026", "it")).toBe("11/19/2026");
    expect(localizedShown("Via Roma, 3.", "it")).toBe("Via Roma, 3.");
  });
});

describe("proposesSheet", () => {
  it("propone il foglio oltre 200 righe o 30 colonne", () => {
    expect(proposesSheet(200, 30)).toBe(false);
    expect(proposesSheet(201, 2)).toBe(true);
    expect(proposesSheet(3, 31)).toBe(true);
  });
});

describe("le parti", () => {
  it("divide foglio e intervallo, e conta le celle", () => {
    expect(splitSheetPart("Budget!A1:B2")).toEqual({ sheet: "Budget", range: "A1:B2" });
    expect(splitSheetPart("'Conti 2025'!B2")).toEqual({ sheet: "Conti 2025", range: "B2" });
    expect(splitSheetPart("Grafico spese")).toBeNull();
    expect(rangeCells("A1:B2")).toEqual([["A1", "B1"], ["A2", "B2"]]);
    expect(rangeCells("Z1:AA1")).toEqual([["Z1", "AA1"]]);
    expect(rangeCells("A1:A100000")).toBeNull();
    expect(quotedSheet("Foglio1")).toBe("Foglio1");
    expect(quotedSheet("Conti 2025")).toBe("'Conti 2025'");
    expect(quotedSheet("A1")).toBe("'A1'");
  });
});

describe("incollare celle", () => {
  it("fa del testo a tabulazioni una tabella", () => {
    expect(tsvTable("Voce\tImporto\nLuce | gas\t98\n")).toBe("| Voce        | Importo |\n| ----------- | ------- |\n| Luce \\| gas | 98      |");
    expect(tsvTable("solo testo")).toBeNull();
    expect(tsvTable("a\tb\nc")).toBeNull();
    // Un testo rientrato a tabulazioni non è una griglia.
    expect(tsvTable("\tuno\n\tdue")).toBeNull();
  });

  it("ritrova da dove vengono le celle, e ne scrive l'embed", () => {
    const origin = { doc: "Progetti/Conti.xlsx", sheet: "Conti 2025", range: "A1:B2" };
    const declared = new Map([[FUB_CELLS_TYPE, JSON.stringify(origin)], ["text/plain", "a\tb"]]);
    expect(cellsOrigin({ getData: (type) => declared.get(type) ?? "" })).toEqual(origin);
    rememberCellsCopy("a\tb\r\nc\td\r\n", origin);
    expect(cellsOrigin({ getData: (type) => (type === "text/plain" ? "a\tb\nc\td" : "") })).toEqual(origin);
    expect(cellsOrigin({ getData: (type) => (type === "text/plain" ? "altro" : "") })).toBeNull();
    expect(cellsEmbed(origin)).toBe("![[Progetti/Conti.xlsx#'Conti 2025'!A1:B2]]");
    expect(cellsEmbed({ ...origin, doc: "Strano [1].xlsx" })).toBeNull();
  });
});

describe("detachedTable", () => {
  const readings = new Map<string, CellReading>([
    ["'Conti 2025'!A1", { state: "value", text: "Voce", error: false, stale: false }],
    ["'Conti 2025'!B1", { state: "value", text: "Importo", error: false, stale: false }],
    ["'Conti 2025'!A2", { state: "value", text: "Affitto", error: false, stale: false }],
    ["'Conti 2025'!B2", { state: "value", text: "1,240.50 €", error: false, stale: false }],
    ["'Conti 2025'!A3", { state: "empty" }],
    ["'Conti 2025'!B3", { state: "value", text: "98", error: false, stale: false }],
  ]);
  const port = (path: string | null, lost = false): CellValuePort => ({
    load: async () => ({ read: async (_path, parts) => new Map(parts.map((part) => [part, lost ? { state: "lost" } : readings.get(part)!])) }),
    resolve: async () => path,
    watch: () => () => {},
    open: () => {},
  });

  it("scrive i valori mostrati, coi separatori della nota", async () => {
    const result = await detachedTable(port("Conti.xlsx"), "Conti", "Nota.md", "'Conti 2025'!A1:B3", "it");
    expect(result).toEqual({ table: "| Voce    |    Importo |\n| ------- | ---------: |\n| Affitto | 1.240,50 € |\n|         |         98 |" });
  });

  it("dice perché no, senza scrivere", async () => {
    expect(await detachedTable(port(null), "Conti", "Nota.md", "A1:B2", "it")).toEqual({ failed: expect.stringContaining("non è nel vault") });
    expect(await detachedTable(port("Conti.xlsx", true), "Conti", "Nota.md", "A1:B2", "it")).toEqual({ failed: expect.stringContaining("non ha più") });
    expect(await detachedTable(port("Conti.xlsx"), "Conti", "Nota.md", "Grafico", "it")).toEqual({ failed: expect.stringContaining("intervallo") });
  });
});
