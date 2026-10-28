import { describe, expect, it } from "vitest";
import { nextCell, nextInRange, type Shape } from "./navigation";

/// Una tabella di `rows` × `columns` con alcune righe e colonne nascoste.
function shape(rows: number, columns: number, hidden: { rows?: number[]; columns?: number[] } = {}): Shape {
  const visible = (axis: "row" | "column", index: number) =>
    !(axis === "row" ? hidden.rows : hidden.columns)?.includes(index);
  return {
    visible,
    step(axis, from, step) {
      const size = axis === "row" ? rows : columns;
      for (let index = from + step; index >= 0 && index < size; index += step) if (visible(axis, index)) return index;
      return from;
    },
  };
}

describe("nextCell", () => {
  it("Invio scende, Maiusc+Invio sale, Tab va di lato", () => {
    const table = shape(5, 5);
    expect(nextCell({ row: 1, column: 1 }, "down", null, table)).toEqual({ cell: { row: 2, column: 1 }, tabStart: null });
    expect(nextCell({ row: 1, column: 1 }, "up", null, table)).toEqual({ cell: { row: 0, column: 1 }, tabStart: null });
    expect(nextCell({ row: 1, column: 1 }, "right", null, table)).toEqual({ cell: { row: 1, column: 2 }, tabStart: 1 });
    expect(nextCell({ row: 1, column: 1 }, "left", null, table)).toEqual({ cell: { row: 1, column: 0 }, tabStart: 1 });
  });

  it("Invio dopo una serie di Tab torna alla colonna di partenza", () => {
    const table = shape(5, 5);
    let step = nextCell({ row: 1, column: 1 }, "right", null, table)!;
    step = nextCell(step.cell, "right", step.tabStart, table)!;
    expect(step).toEqual({ cell: { row: 1, column: 3 }, tabStart: 1 });
    expect(nextCell(step.cell, "down", step.tabStart, table)).toEqual({ cell: { row: 2, column: 1 }, tabStart: null });
  });

  it("salta i nascosti e si ferma al bordo", () => {
    const table = shape(4, 4, { rows: [2], columns: [1] });
    expect(nextCell({ row: 1, column: 0 }, "down", null, table)?.cell).toEqual({ row: 3, column: 0 });
    expect(nextCell({ row: 0, column: 0 }, "right", null, table)?.cell).toEqual({ row: 0, column: 2 });
    expect(nextCell({ row: 3, column: 0 }, "down", null, table)).toBeNull();
    expect(nextCell({ row: 0, column: 3 }, "right", null, table)).toBeNull();
  });
});

describe("nextInRange", () => {
  const range = { r0: 1, c0: 1, r1: 2, c1: 3 };

  it("Invio percorre le colonne, Tab le righe, e dall'ultima si torna alla prima", () => {
    const table = shape(10, 10);
    expect(nextInRange(range, { row: 1, column: 1 }, "down", table)).toEqual({ row: 2, column: 1 });
    expect(nextInRange(range, { row: 2, column: 1 }, "down", table)).toEqual({ row: 1, column: 2 });
    expect(nextInRange(range, { row: 2, column: 3 }, "down", table)).toEqual({ row: 1, column: 1 });
    expect(nextInRange(range, { row: 1, column: 3 }, "right", table)).toEqual({ row: 2, column: 1 });
    expect(nextInRange(range, { row: 2, column: 3 }, "right", table)).toEqual({ row: 1, column: 1 });
  });

  it("Maiusc va all'indietro", () => {
    const table = shape(10, 10);
    expect(nextInRange(range, { row: 1, column: 1 }, "up", table)).toEqual({ row: 2, column: 3 });
    expect(nextInRange(range, { row: 1, column: 2 }, "up", table)).toEqual({ row: 2, column: 1 });
    expect(nextInRange(range, { row: 2, column: 1 }, "left", table)).toEqual({ row: 1, column: 3 });
  });

  it("non si ferma su righe e colonne nascoste", () => {
    const table = shape(10, 10, { rows: [1], columns: [2] });
    expect(nextInRange(range, { row: 2, column: 1 }, "right", table)).toEqual({ row: 2, column: 3 });
    expect(nextInRange(range, { row: 2, column: 3 }, "right", table)).toEqual({ row: 2, column: 1 });
    expect(nextInRange(range, { row: 2, column: 1 }, "down", table)).toEqual({ row: 2, column: 3 });
  });
});
