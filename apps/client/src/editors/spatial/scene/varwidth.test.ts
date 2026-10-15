// Lo spessore variabile nel formato della scena (§6): la grammatica di
// `fub:geom`, la scrittura che si rilegge, e le larghezze lungo la linea. I
// casi stanno in `__fixtures__/scene-width/cases.json` e valgono anche per la
// lettura di Rust; i vettori dei profili vengono dalle formule di `pchip`
// calcolate con frazioni esatte, fuori da questo codice.

import { describe, expect, it } from "vitest";
import { parsePath } from "./geometry";
import { readVarWidth, spanAt, spanSlopes, spanWidths, widthsAt, widthSpans, writeVarWidth, writtenProfile, type WidthPoint } from "./varwidth";
import cases from "../../../__fixtures__/scene-width/cases.json";

describe("la grammatica di fub:geom", () => {
  for (const { geom, varwidth } of cases.read) {
    it(`${JSON.stringify(geom)} ${varwidth === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readVarWidth(geom)).toEqual(varwidth);
    });
  }
});

describe("le larghezze lungo la linea", () => {
  for (const { name, profile, widths } of cases.profiles) {
    it(`il profilo «${name}»`, () => {
      const points = profile as unknown as WidthPoint[];
      for (const [u, left, right] of widths) {
        const [l, r] = widthsAt(points, u!);
        expect(l, `${name} a ${u}`).toBeCloseTo(left!, 9);
        expect(r, `${name} a ${u}`).toBeCloseTo(right!, 9);
      }
    });
  }

  it("la pendenza è la derivata della larghezza", () => {
    const points: WidthPoint[] = [[0, 1, 0.5], [0.1, 3, 0.5], [0.7, 2, 6], [1, 4, 1]];
    const spans = widthSpans(points);
    for (const u of [0.03, 0.1, 0.35, 0.69, 0.71, 0.95]) {
      const span = spans[spanAt(spans, u)]!;
      const [dl, dr] = spanSlopes(span, u);
      const step = 1e-6;
      const [a, b] = [spanWidths(span, Math.max(span.t0, u - step)), spanWidths(span, Math.min(span.t1, u + step))];
      const width = Math.min(span.t1, u + step) - Math.max(span.t0, u - step);
      expect(dl).toBeCloseTo((b[0] - a[0]) / width, 4);
      expect(dr).toBeCloseTo((b[1] - a[1]) / width, 4);
    }
  });

  it("uno scalino vale dopo, e i tratti non hanno lunghezza zero", () => {
    const points: WidthPoint[] = [[0, 2, 2], [0.5, 2, 2], [0.5, 8, 8], [1, 8, 8]];
    expect(widthSpans(points).map((span) => [span.t0, span.t1])).toEqual([[0, 0.5], [0.5, 1]]);
    expect(widthsAt(points, 0.4999)).toEqual([2, 2]);
    expect(widthsAt(points, 0.5)).toEqual([8, 8]);
    expect(widthsAt(points, 1)).toEqual([8, 8]);
  });
});

describe("la scrittura", () => {
  const line = parsePath("M0 0 L100.004 0")!;

  it("scrive gli estremi, gli angoli, il profilo e la linea coi numeri del formato", () => {
    const profile: WidthPoint[] = [[0, 2.004, 2], [0.333333, 6.126, 0], [1, 0, 1.5]];
    expect(writeVarWidth("round", "bevel", profile, line)).toBe("round bevel 0 2 2 0.3333 6.13 0 1 0 1.5 M0 0 L100 0");
  });

  it("i punti restano in ordine, fra i capi e senza tre uguali di fila", () => {
    expect(writtenProfile([[0, 1, 1], [0.00001, 2, 2], [0.5, 3, 3], [0.49999, 4, 4], [0.5, 5, 5], [0.99999, 6, 6], [1, 7, 7]])).toEqual([
      [0, 1, 1],
      [0.5, 3, 3],
      [0.5, 5, 5],
      [1, 7, 7],
    ]);
    expect(writtenProfile([[0.2, 1, 1], [1.5, 2, 2]])).toEqual([[0, 1, 1], [1, 2, 2]]);
  });

  it("rifiuta un profilo senza larghezza e una linea che non disegna", () => {
    expect(writeVarWidth("round", "round", [[0, 0.001, 0], [1, 0, 0.004]], line)).toBeNull();
    expect(writeVarWidth("round", "round", [[0, 1, 1], [1, 1, 1]], parsePath("M0 0 L0.001 0")!)).toBeNull();
    expect(writeVarWidth("round", "round", [[0, 1, 1]], line)).toBeNull();
  });

  it("ciò che scrive si rilegge uguale", () => {
    const geom = writeVarWidth("square", "miter", [[0, 0, 0], [0.25, 3, 1], [0.25, 1, 3], [1, 0, 0]], parsePath("M0 0 C10 -10 20 10 30 0 Z")!)!;
    expect(geom).toBe("square miter 0 0 0 0.25 3 1 0.25 1 3 1 0 0 M0 0 C10 -10 20 10 30 0 Z");
    expect(readVarWidth(geom)!.profile).toEqual([[0, 0, 0], [0.25, 3, 1], [0.25, 1, 3], [1, 0, 0]]);
  });
});
