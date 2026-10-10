// I vettori della pagina di stampa (`__fixtures__/scene-export/print.json`),
// condivisi con `fub-scene`: per ogni caso `name`, `description`, la misura
// del disegno in pixel (`width`, `height`), le scelte già lette `setup` e
// l'esito `expect`, la pagina `sheet` in punti e i segni, `lines` e
// `circles`, calcolati da un oracolo scritto a parte. I numeri si confrontano
// a meno di un miliardesimo di punto.

import { describe, expect, it } from "vitest";
import print from "../../../__fixtures__/scene-export/print.json";
import { hasRoom, markShapes, paperNamed, PLAIN_SETUP, printLayout, PT_PER_MM, type PrintSetup } from "./print";

interface PrintVector {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly setup: PrintSetup;
  readonly expect: {
    readonly sheet: { width: number; height: number; trim: number[]; bleed: number; scale: number; landscape: boolean };
    readonly lines: number[][];
    readonly circles: number[][];
  };
}

function near(got: readonly number[], want: readonly number[]): void {
  expect(got.length).toBe(want.length);
  got.forEach((n, at) => expect(Math.abs(n - want[at]!)).toBeLessThan(1e-9));
}

describe("la pagina di stampa", () => {
  for (const vector of print as unknown as readonly PrintVector[]) {
    it(vector.name, () => {
      expect(hasRoom(vector.setup)).toBe(true);
      const sheet = printLayout(vector.width, vector.height, vector.setup);
      const want = vector.expect.sheet;
      near([sheet.width, sheet.height, sheet.bleed, sheet.scale], [want.width, want.height, want.bleed, want.scale]);
      near(sheet.trim, want.trim);
      expect(sheet.landscape).toBe(want.landscape);
      const shapes = markShapes(sheet, vector.setup.marks);
      expect(shapes.lines.length).toBe(vector.expect.lines.length);
      shapes.lines.forEach((line, at) => near(line, vector.expect.lines[at]!));
      expect(shapes.circles.length).toBe(vector.expect.circles.length);
      shapes.circles.forEach((circle, at) => near(circle, vector.expect.circles[at]!));
    });
  }

  it("i nomi dei casi sono tutti diversi", () => {
    const names = (print as unknown as readonly PrintVector[]).map((vector) => vector.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("margini, abbondanza e segni possono non lasciare posto", () => {
    const setup: PrintSetup = { ...PLAIN_SETUP, paper: paperNamed("a6"), margin: 40, bleed: 5, marks: { crop: true, registration: false } };
    expect(hasRoom(setup)).toBe(false);
    expect(hasRoom({ ...setup, margin: 39 })).toBe(true);
  });

  it("un A4 misura 210 × 297 mm in punti", () => {
    const sheet = printLayout(100, 100, { ...PLAIN_SETUP, paper: paperNamed("a4") });
    expect(sheet.width / PT_PER_MM).toBeCloseTo(210, 9);
    expect(sheet.height / PT_PER_MM).toBeCloseTo(297, 9);
  });
});
