// Il lettore dei valori di cella nel testo (T53) con un `GridHost` finto: una
// sessione per file e per lettura, chiusa sempre; la parte trovata con
// `fub.part` o, senza il comando, per nome; una finestra di una cella sola;
// la cella vuota, l'errore di formula, il valore non ricalcolato, l'unione,
// la cella persa, il file mancante e la superficie che manca. Non scrive mai.
import { describe, expect, it } from "vitest";
import fixture from "../../__fixtures__/xlsx-grid.json";
import type { GridBytesCell, GridBytesSession, GridBytesWindow, GridMerge, GridWindowRequest, PluginError } from "../../host/contract";
import { readingOf, sheetCellReader, type CellReaderPort } from "./cell-reader";
import type { GridHost } from "./engine";

const BOOK = (fixture.session as GridBytesSession).book;
const PLAIN = (fixture.windows[0] as GridBytesWindow).styles[0]!;
const VIEW = (fixture.windows[0] as GridBytesWindow).view;

type Value = GridBytesCell["value"];

interface FakeOptions {
  /// I valori per «foglio!A1»; il resto è vuoto.
  readonly cells: Readonly<Record<string, { value: Value; display: string; stale?: boolean }>>;
  /// Con il comando `fub.part`: la risposta al testo della parte.
  readonly part?: (text: string) => unknown;
  readonly merges?: GridMerge[];
  readonly surfaces?: boolean;
  readonly conflictOnce?: boolean;
}

interface Fake extends GridHost {
  readonly opens: string[];
  readonly closes: string[];
  readonly windows: GridWindowRequest[];
  readonly parts: string[];
  writes: number;
}

const SHEETS = [{ id: "s1", name: "Budget" }, { id: "s2", name: "Conti 2025" }];

function columnLetters(column: number): string {
  let label = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}

function fake(options: FakeOptions): Fake {
  let counter = 0;
  let conflicted = false;
  const host: Fake = {
    opens: [],
    closes: [],
    windows: [],
    parts: [],
    writes: 0,
    async listGridSurfaces() {
      return options.surfaces === false ? [] : [{ id: "xlsx-grid", format: "xlsx", family: "grid", protocol_version: 2 }];
    },
    async openGridBytes(_surface, doc) {
      host.opens.push(doc);
      if (options.conflictOnce && !conflicted) {
        conflicted = true;
        throw { kind: "conflict", message: "stale" } satisfies PluginError;
      }
      return {
        instance: `i${++counter}`,
        revision: "rev-1",
        sheets: SHEETS.map((sheet) => ({ id: sheet.id, name: sheet.name, row_count: 100, column_count: 26 })),
        active: "s1",
        hidden: [],
        notices: [],
        conflicts: [],
        commands: options.part ? [{ id: "fub.part", enabled: true, reason: null }] : [],
        book: BOOK,
      };
    },
    async gridBytesWindow(_surface, _instance, request) {
      host.windows.push(request);
      const sheet = SHEETS.find((each) => each.id === request.sheet)!;
      const rows = [{ id: `r${request.row_start}`, index: request.row_start, height: null, hidden: false }];
      const columns = [{ id: `c${request.column_start}`, index: request.column_start, width: null, hidden: false }];
      const name = `${sheet.name}!${columnLetters(request.column_start)}${request.row_start + 1}`;
      const own = options.cells[name];
      const cells: GridBytesCell[] = own ? [{
        key: { sheet: sheet.id, row: rows[0]!.id, column: columns[0]!.id },
        input: own.display,
        style: 0,
        value: own.value,
        display: own.display,
        lock: null,
        stale: own.stale ?? false,
        conflict: false,
        data_bar: null,
        icon: null,
        comment: null,
        link: null,
      }] : [];
      const merges = (options.merges ?? []).filter((merge) =>
        merge.row <= request.row_start && merge.row + merge.rows > request.row_start
        && merge.column <= request.column_start && merge.column + merge.columns > request.column_start);
      return {
        revision: request.revision,
        sheet: sheet.id,
        row_start: request.row_start,
        column_start: request.column_start,
        total_rows: 100,
        total_columns: 26,
        rows,
        columns,
        cells,
        styles: [PLAIN],
        merges,
        view: VIEW,
        tables: [],
        objects: [],
      };
    },
    async applyGridBytes() {
      host.writes += 1;
      throw new Error("the cell reader never writes");
    },
    async gridBytesCommands() {
      return [];
    },
    async gridBytesCommand(_surface, _instance, request) {
      if (request.command.id !== "fub.part" || !options.part) {
        host.writes += 1;
        throw new Error("the cell reader runs no other command");
      }
      const text = (JSON.parse(request.command.params) as { part: string }).part;
      host.parts.push(text);
      return { result: JSON.stringify(options.part(text)) } as never;
    },
    async closeGridBytes(_surface, instance) {
      host.closes.push(instance);
    },
  };
  return host;
}

function port(host: GridHost, present = true): CellReaderPort {
  return {
    host,
    source: async () => (present ? { journal: "", base: "b1", format: "xlsx" } : null),
  };
}

const number = (value: number): Value => ({ kind: "number", value });

describe("il lettore dei valori di cella", () => {
  it("legge più celle dello stesso file in una sessione sola, e la chiude", async () => {
    const host = fake({
      cells: {
        "Budget!C7": { value: number(2520), display: "2.520 €" },
        "Conti 2025!B2": { value: { kind: "text", value: "affitto" }, display: "affitto" },
      },
    });
    const answers = await sheetCellReader(port(host)).read("Conti.xlsx", ["Budget!C7", "'Conti 2025'!$B$2", "C7"]);
    expect(answers.get("Budget!C7")).toEqual({ state: "value", text: "2.520 €", error: false, stale: false });
    expect(answers.get("'Conti 2025'!$B$2")).toEqual({ state: "value", text: "affitto", error: false, stale: false });
    // Senza foglio vale il foglio attivo, Budget.
    expect(answers.get("C7")).toEqual({ state: "value", text: "2.520 €", error: false, stale: false });
    expect(host.opens).toEqual(["Conti.xlsx"]);
    expect(host.closes).toEqual(["i1"]);
    expect(host.windows.every((window) => window.row_count === 1 && window.column_count === 1)).toBe(true);
    expect(host.writes).toBe(0);
  });

  it("chiede la parte al provider con fub.part, quando la sessione lo serve", async () => {
    const host = fake({
      cells: { "Budget!D4": { value: number(3), display: "3" } },
      part: (text) => (text === "Budget!C7" ? { found: true, kind: "range", sheet: "s1", range: "D4" } : { found: false, parts: [] }),
    });
    const answers = await sheetCellReader(port(host)).read("Conti.xlsx", ["Budget!C7", "Spese!A1"]);
    expect(host.parts).toEqual(["Budget!C7", "Spese!A1"]);
    expect(answers.get("Budget!C7")).toEqual({ state: "value", text: "3", error: false, stale: false });
    expect(answers.get("Spese!A1")).toEqual({ state: "lost" });
    expect(host.writes).toBe(0);
  });

  it("dice la cella vuota, l'errore di formula e il valore non ricalcolato", async () => {
    const host = fake({
      cells: {
        "Budget!A1": { value: { kind: "error", value: "#DIV/0!" }, display: "#DIV/0!" },
        "Budget!A2": { value: number(5), display: "5", stale: true },
      },
    });
    const answers = await sheetCellReader(port(host)).read("Conti.xlsx", ["Budget!A1", "Budget!A2", "Budget!A3"]);
    expect(answers.get("Budget!A1")).toEqual({ state: "value", text: "#DIV/0!", error: true, stale: false });
    expect(answers.get("Budget!A2")).toEqual({ state: "value", text: "5", error: false, stale: true });
    expect(answers.get("Budget!A3")).toEqual({ state: "empty" });
  });

  it("una cella dentro un'unione vale per l'unione", async () => {
    const host = fake({
      cells: { "Budget!A1": { value: number(9), display: "9" } },
      merges: [{ row: 0, column: 0, rows: 2, columns: 2 }],
    });
    const answers = await sheetCellReader(port(host)).read("Conti.xlsx", ["Budget!B2"]);
    expect(answers.get("Budget!B2")).toEqual({ state: "value", text: "9", error: false, stale: false });
  });

  it("un foglio che non c'è o una cella oltre il foglio sono persi", async () => {
    const host = fake({ cells: {} });
    const answers = await sheetCellReader(port(host)).read("Conti.xlsx", ["Spese!A1", "Budget!Z200"]);
    expect(answers.get("Spese!A1")).toEqual({ state: "lost" });
    expect(answers.get("Budget!Z200")).toEqual({ state: "lost" });
  });

  it("il file mancante e la superficie che manca", async () => {
    const missing = fake({ cells: {} });
    expect((await sheetCellReader(port(missing, false)).read("Conti.xlsx", ["A1"])).get("A1")).toEqual({ state: "missing" });
    expect(missing.opens).toEqual([]);
    const none = fake({ cells: {}, surfaces: false });
    expect((await sheetCellReader(port(none)).read("Conti.xlsx", ["A1"])).get("A1")).toEqual({ state: "unavailable" });
  });

  it("una base vecchia si riprova una volta", async () => {
    const host = fake({ cells: { "Budget!A1": { value: number(1), display: "1" } }, conflictOnce: true });
    const answers = await sheetCellReader(port(host)).read("Conti.xlsx", ["A1"]);
    expect(answers.get("A1")).toEqual({ state: "value", text: "1", error: false, stale: false });
    expect(host.opens).toHaveLength(2);
    expect(host.closes).toEqual(["i1"]);
  });

  it("readingOf: una cella senza niente è vuota", () => {
    expect(readingOf(undefined)).toEqual({ state: "empty" });
  });
});
