// I vettori dell'export (`__fixtures__/scene-export/`), condivisi con
// `fub-scene`: oracoli scritti a mano e controllati uno per uno. Il client
// ne legge due (il terzo, `clean.json`, è dell'SVG pulito, che fa soltanto
// l'host):
//
// - `derive.json`: per ogni caso `name`, `description`, il testo `input`,
//   l'ambito `scope` (`{kind: "drawing"}`, `{kind: "board", id}` o
//   `{kind: "selection", ids, box: [x, y, width, height]}`), lo sfondo
//   `background` (`paper` o `none`) e l'esito `expect`: `{text}`, il testo
//   derivato byte per byte, o `{error, id?}`, il rifiuto (`unknown-board`,
//   `unknown-object`, `empty-selection`, `bad-box`, `not-svg`, `malformed`)
//   con l'id che non va per i primi due;
// - `measure.json`: per ogni caso `name`, `description`, la larghezza e
//   l'altezza del rettangolo in unità del disegno (`width`, `height`), la
//   misura chiesta `size` (`{scale}` o `{pixels}`, la larghezza) e l'esito
//   `expect`: `{scale, width, height, reduced}`, con la scala che è un numero
//   a 32 bit scritto per intero.
//
// In più: il testo derivato si rilegge senza errori, e derivarlo di nuovo con
// lo stesso ambito non lo cambia.

import { describe, expect, it } from "vitest";
import derive from "../../../__fixtures__/scene-export/derive.json";
import measure from "../../../__fixtures__/scene-export/measure.json";
import { deriveExport, DeriveError, measureExport, type ExportBackground, type ExportScope, type ExportSize } from "./export";
import { readScene, ReadError } from "./read";

interface DeriveVector {
  readonly name: string;
  readonly input: string;
  readonly scope: ExportScope;
  readonly background: ExportBackground;
  readonly expect: { readonly text?: string; readonly error?: string; readonly id?: string };
}

interface MeasureVector {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly size: ExportSize;
  readonly expect: { readonly scale: number; readonly width: number; readonly height: number; readonly reduced: boolean };
}

/// L'esito di una derivazione nella forma dei vettori.
function outcome(vector: DeriveVector): DeriveVector["expect"] {
  try {
    return { text: deriveExport(vector.input, vector.scope, vector.background) };
  } catch (error) {
    if (error instanceof DeriveError) return error.id === null ? { error: error.refusal } : { error: error.refusal, id: error.id };
    if (error instanceof ReadError) return { error: error.kind };
    throw error;
  }
}

describe("la derivazione dell'export", () => {
  for (const vector of derive as readonly DeriveVector[]) {
    it(vector.name, () => {
      const got = outcome(vector);
      expect(got).toEqual(vector.expect);
      if (got.text === undefined) return;
      expect(() => readScene(got.text!)).not.toThrow();
      expect(deriveExport(got.text, vector.scope, vector.background)).toBe(got.text);
    });
  }

  it("i nomi dei casi sono tutti diversi", () => {
    const names = [...derive, ...measure].map((vector) => vector.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("la misura dell'export", () => {
  for (const vector of measure as readonly MeasureVector[]) {
    it(vector.name, () => {
      const got = measureExport(vector.width, vector.height, vector.size);
      expect(got).toEqual(vector.expect);
      expect(Math.fround(got.scale)).toBe(got.scale);
      expect(got.width).toBeLessThanOrEqual(16_384);
      expect(got.height).toBeLessThanOrEqual(16_384);
      expect(got.width * got.height).toBeLessThanOrEqual(33_554_432);
    });
  }
});
