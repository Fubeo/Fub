// La prova comune delle tabelle: gli stessi gesti su ogni adattatore danno la
// stessa tabella, la stessa cella attiva e la stessa selezione, dove il
// formato ha la capacità. I casi sono dati; ogni adattatore li esegue nei suoi
// test con un `ConformanceDriver` che sa premere i tasti sulla sua tabella.
//
// Qui non si importa il banco di prova: `playCase` ridà ciò che si è visto, e
// il confronto lo fa il test.

import type { TableCaps } from "./adapter";
import type { Cell, Range } from "./navigation";

export type ConformanceStep =
  /// Un tasto, dove sta il fuoco adesso (la tabella o la cella aperta).
  | { readonly key: string; readonly shift?: boolean; readonly mod?: boolean }
  /// Un comando del catalogo, per id.
  | { readonly command: string };

export interface ConformanceCase {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  /// Le capacità che il caso chiede: senza, l'adattatore lo salta.
  readonly needs?: readonly (keyof Omit<TableCaps, "headerRows">)[];
  readonly steps: readonly ConformanceStep[];
  readonly cells?: readonly (readonly string[])[];
  readonly active?: Cell;
  readonly range?: Range;
}

/// Ciò che un adattatore offre alla prova.
export interface ConformanceDriver {
  key(name: string, init: { readonly shiftKey: boolean; readonly ctrlKey: boolean }): void;
  command(id: string): void;
  cells(): string[][];
  active(): Cell;
  range(): Range;
}

export interface ConformanceResult {
  readonly cells: string[][];
  readonly active: Cell;
  readonly range: Range;
}

/// Se l'adattatore con `caps` può eseguire il caso.
export function caseApplies(test: ConformanceCase, caps: TableCaps): boolean {
  return (test.needs ?? []).every((need) => caps[need]);
}

export function playCase(test: ConformanceCase, driver: ConformanceDriver): ConformanceResult {
  for (const step of test.steps) {
    if ("command" in step) driver.command(step.command);
    else driver.key(step.key, { shiftKey: step.shift ?? false, ctrlKey: step.mod ?? false });
  }
  return { cells: driver.cells(), active: driver.active(), range: driver.range() };
}

const ROWS = [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]] as const;

export const TABLE_CONFORMANCE: readonly ConformanceCase[] = [
  {
    name: "le frecce muovono la cella attiva, Maiusc allarga",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: "ArrowDown", shift: true }],
    active: { row: 2, column: 1 },
    range: { r0: 1, c0: 0, r1: 2, c1: 1 },
  },
  {
    name: "Ctrl con una freccia va al bordo",
    rows: ROWS,
    steps: [{ key: "ArrowDown", mod: true }, { key: "ArrowRight", mod: true }],
    active: { row: 2, column: 1 },
  },
  {
    name: "un carattere riscrive la cella, Invio conferma e scende",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "Z" }, { key: "Enter" }],
    cells: [["Nome", "Voto"], ["Z", "10"], ["Bea", "9"]],
    active: { row: 2, column: 0 },
  },
  {
    name: "Esc annulla la cella aperta",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "Enter" }, { key: "Escape" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]],
    active: { row: 1, column: 0 },
  },
  {
    name: "Tab conferma la cella e va avanti lungo la riga",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "Q" }, { key: "Tab" }],
    cells: [["Nome", "Voto"], ["Q", "10"], ["Bea", "9"]],
    active: { row: 1, column: 1 },
  },
  {
    name: "Tab dall'ultima cella aggiunge una riga",
    needs: ["insertRows"],
    rows: ROWS,
    steps: [{ key: "End", mod: true }, { key: "Tab" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"], ["", ""]],
    active: { row: 3, column: 0 },
  },
  {
    name: "Canc svuota la selezione",
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { key: "ArrowRight", shift: true }, { key: "Delete" }],
    cells: [["Nome", "Voto"], ["", ""], ["Bea", "9"]],
  },
  {
    name: "una riga sotto, e la selezione ci va",
    needs: ["insertRows"],
    rows: ROWS,
    steps: [{ key: "ArrowDown" }, { command: "markdown.table.row.after" }],
    cells: [["Nome", "Voto"], ["Ada", "10"], ["", ""], ["Bea", "9"]],
    active: { row: 2, column: 0 },
  },
  {
    name: "la riga d'intestazione non si sposta né si ordina",
    needs: ["moveRows", "sort"],
    rows: ROWS,
    steps: [{ command: "markdown.table.row.down" }, { key: "ArrowRight" }, { command: "markdown.table.sort.ascending" }],
    cells: [["Nome", "Voto"], ["Bea", "9"], ["Ada", "10"]],
  },
  {
    name: "una colonna spostata a sinistra porta con sé la selezione",
    needs: ["moveColumns"],
    rows: ROWS,
    steps: [{ key: "ArrowRight" }, { command: "markdown.table.column.left" }],
    cells: [["Voto", "Nome"], ["10", "Ada"], ["9", "Bea"]],
    active: { row: 0, column: 0 },
  },
];
