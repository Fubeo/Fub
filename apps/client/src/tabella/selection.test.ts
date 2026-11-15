import { describe, expect, it } from "vitest";
import { covers, fillCopy, selectedCells, selectsSeveral, touches, wholeRange, withRange } from "./selection";

describe("la selezione a più intervalli", () => {
  it("dice se un intervallo tocca una cella o un'unione", () => {
    const range = { r0: 1, c0: 1, r1: 2, c1: 3 };
    expect(touches(range, 1, 1)).toBe(true);
    expect(touches(range, 0, 0)).toBe(false);
    expect(touches(range, 0, 0, 1, 1)).toBe(true);
    expect(touches(range, 3, 3)).toBe(false);
  });

  it("aggiunge in fondo, senza ripetere un intervallo uguale", () => {
    const a = { r0: 0, c0: 0, r1: 0, c1: 0 };
    const b = { r0: 2, c0: 2, r1: 3, c1: 3 };
    expect(withRange([a], b)).toEqual([a, b]);
    expect(withRange([a, b], { ...a })).toEqual([b, a]);
  });
});

describe("righe e colonne intere", () => {
  const table = { r0: 0, c0: 0, r1: 3, c1: 2 };

  it("Maiusc+Spazio la riga, Ctrl+Spazio la colonna, tutti e due la tabella", () => {
    const range = { r0: 1, c0: 1, r1: 2, c1: 1 };
    expect(wholeRange(range, "row", table)).toEqual({ r0: 1, c0: 0, r1: 2, c1: 2 });
    expect(wholeRange(range, "column", table)).toEqual({ r0: 0, c0: 1, r1: 3, c1: 1 });
    expect(wholeRange(range, "table", table)).toEqual(table);
  });

  it("sa se una selezione prende righe o colonne intere", () => {
    expect(covers({ r0: 1, c0: 0, r1: 1, c1: 2 }, table)).toEqual({ wholeRows: true, wholeColumns: false });
    expect(covers({ r0: 0, c0: 1, r1: 3, c1: 1 }, table)).toEqual({ wholeRows: false, wholeColumns: true });
    expect(covers(table, table)).toEqual({ wholeRows: true, wholeColumns: true });
  });
});

describe("Ctrl+D e Ctrl+R", () => {
  it("con più righe la prima si copia nelle altre", () => {
    expect(fillCopy({ r0: 1, c0: 0, r1: 3, c1: 1 }, "down")).toEqual({ source: { r0: 1, c0: 0, r1: 1, c1: 1 }, target: { r0: 2, c0: 0, r1: 3, c1: 1 } });
    expect(fillCopy({ r0: 1, c0: 0, r1: 1, c1: 2 }, "right")).toEqual({ source: { r0: 1, c0: 0, r1: 1, c1: 0 }, target: { r0: 1, c0: 1, r1: 1, c1: 2 } });
  });

  it("con una sola si copia quella sopra o a sinistra, mai l'intestazione nel corpo", () => {
    expect(fillCopy({ r0: 2, c0: 1, r1: 2, c1: 1 }, "down", 1)).toEqual({ source: { r0: 1, c0: 1, r1: 1, c1: 1 }, target: { r0: 2, c0: 1, r1: 2, c1: 1 } });
    expect(fillCopy({ r0: 1, c0: 1, r1: 1, c1: 1 }, "down", 1)).toBeNull();
    expect(fillCopy({ r0: 1, c0: 0, r1: 1, c1: 0 }, "right")).toBeNull();
  });

  it("con più righe a partire dall'intestazione la prima del corpo scende, l'intestazione no", () => {
    // Ctrl+Spazio su una colonna di quattro righe, poi Ctrl+D.
    expect(fillCopy({ r0: 0, c0: 1, r1: 3, c1: 1 }, "down", 1)).toEqual({ source: { r0: 1, c0: 1, r1: 1, c1: 1 }, target: { r0: 2, c0: 1, r1: 3, c1: 1 } });
    // L'intestazione e una riga sola del corpo: sopra c'è soltanto l'intestazione.
    expect(fillCopy({ r0: 0, c0: 0, r1: 1, c1: 1 }, "down", 1)).toBeNull();
  });
});

describe("le celle scelte per la somma della banda", () => {
  it("dà ogni cella una volta, senza l'intestazione, anche dove due intervalli si toccano", () => {
    const a = { r0: 0, c0: 1, r1: 2, c1: 1 };
    const b = { r0: 2, c0: 1, r1: 3, c1: 2 };
    expect([...selectedCells([a, b], 1)]).toEqual([
      { row: 1, column: 1 }, { row: 2, column: 1 },
      { row: 2, column: 2 }, { row: 3, column: 1 }, { row: 3, column: 2 },
    ]);
  });

  it("un intervallo tutto nell'intestazione non dà niente", () => {
    expect([...selectedCells([{ r0: 0, c0: 0, r1: 0, c1: 3 }], 1)]).toEqual([]);
  });

  it("diecimila celle in un giro solo, senza confronti fra gli intervalli", () => {
    const column = { r0: 0, c0: 2, r1: 10_000, c1: 2 };
    let count = 0;
    for (const _ of selectedCells([column], 1)) count++;
    expect(count).toBe(10_000);
  });

  it("una cella sola non è una selezione da sommare; due intervalli sì", () => {
    const one = { r0: 1, c0: 1, r1: 1, c1: 1 };
    expect(selectsSeveral([])).toBe(false);
    expect(selectsSeveral([one])).toBe(false);
    expect(selectsSeveral([{ ...one, r1: 2 }])).toBe(true);
    expect(selectsSeveral([one, { r0: 3, c0: 1, r1: 3, c1: 1 }])).toBe(true);
  });
});
