// Le trasformazioni numeriche: la matrice delle scelte nel loro ordine, ciò
// che il file sa scrivere, e le operazioni, che il motore accetta così come
// sono e che un annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { apply, type Matrix, type Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";
import { boundsAfter, numericMatrix, numericOps, UNCHANGED, writable, type NumericTransform } from "./transform";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const moved = (m: Matrix, p: Point): number[] => apply(m, p).map((value) => Number(value.toFixed(9)) + 0);

const choice = (change: Partial<NumericTransform>): NumericTransform => ({ ...UNCHANGED, ...change });

describe("la matrice di «Trasforma»", () => {
  it("non cambia niente coi valori con cui si apre", () => {
    expect(moved(numericMatrix(UNCHANGED, [30, 40]), [7, 9])).toEqual([7, 9]);
  });

  it("gira in senso orario sullo schermo, attorno al centro", () => {
    // L'asse y scende: un quarto di giro porta la destra in basso.
    const m = numericMatrix(choice({ rotate: 90 }), [10, 10]);
    expect(moved(m, [20, 10])).toEqual([10, 20]);
    expect(moved(m, [10, 10])).toEqual([10, 10]);
  });

  it("scala dal centro, e con una scala negativa rispecchia", () => {
    expect(moved(numericMatrix(choice({ scaleX: 2, scaleY: 0.5 }), [10, 10]), [20, 20])).toEqual([30, 15]);
    expect(moved(numericMatrix(choice({ scaleX: -1 }), [10, 10]), [20, 20])).toEqual([0, 20]);
  });

  it("inclina come skewX e skewY di SVG", () => {
    expect(moved(numericMatrix(choice({ skewX: 45 }), [0, 0]), [0, 10])).toEqual([10, 10]);
    expect(moved(numericMatrix(choice({ skewY: 45 }), [0, 0]), [10, 0])).toEqual([10, 10]);
  });

  it("scala, poi inclina in orizzontale e in verticale, poi ruota", () => {
    // Al contrario, il punto finirebbe in (0, 1).
    expect(moved(numericMatrix(choice({ scaleX: 2, rotate: 90 }), [0, 0]), [1, 0])).toEqual([0, 2]);
    // Al contrario, in (1, 1).
    expect(moved(numericMatrix(choice({ skewX: 45, skewY: 45 }), [0, 0]), [0, 1])).toEqual([1, 2]);
  });
});

describe("ciò che il file sa scrivere", () => {
  it("è una matrice che con quattro decimali resta sé stessa entro l'uno per cento", () => {
    expect(writable([1, 0, 0, 1, 0, 0])).toBe(true);
    expect(writable([0.8660254, 0.5, -0.5, 0.8660254, 1234.56789, 0])).toBe(true);
    // Un centesimo si scrive esatto; poco più di un centesimo quasi.
    expect(writable([0.01, 0, 0, 0.01, 0, 0])).toBe(true);
    expect(writable([0.0123456, 0, 0, 0.0123456, 0, 0])).toBe(true);
    // Un millesimo ruotato perde troppe cifre, e un centomillesimo sparisce.
    expect(writable([0.000866, 0.0005, -0.0005, 0.000866, 0, 0])).toBe(false);
    expect(writable([0.00001, 0, 0, 0.00001, 0, 0])).toBe(false);
  });

  it("non schiaccia il piano e non ha valori infiniti", () => {
    expect(writable([1, 2, 2, 4, 0, 0])).toBe(false);
    expect(writable([Infinity, 0, 0, 1, 0, 0])).toBe(false);
    expect(writable([1, 0, 0, 1, Number.NaN, 0])).toBe(false);
  });
});

describe("le operazioni di «Trasforma»", () => {
  const SOURCE = doc(
    `${LAYER}<rect id="r" x="0" y="0" width="20" height="10" fill="#000000"/>`
      + '<rect x="40" y="0" width="10" height="10" fill="#000000"/>'
      + '<g id="g" transform="translate(100 0)"><rect id="gr" x="0" y="0" width="10" height="10" fill="#000000"/></g>'
      + '<rect id="turned" x="0" y="50" width="10" height="10" fill="#000000" transform="rotate(30 5 55)"/></g>',
  );

  it("danno a ogni oggetto la stessa trasformazione della scena, e un id a chi non ce l'ha", () => {
    const opened = open(SOURCE);
    const before = opened.engine.text;
    const units = opened.index.units.filter((unit) => unit.key !== "turned");
    const m = numericMatrix(choice({ rotate: 90 }), [0, 0]);
    const out = numericOps(units, m, ids(opened))!;
    expect(out.changed).toBe(3);
    const outcome = opened.engine.apply(gesture(out.ops)!);
    if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
    const text = opened.engine.text;
    expect(text).toContain('<rect id="r" x="0" y="0" width="20" height="10" fill="#000000" transform="matrix(0 1 -1 0 0 0)"/>');
    // Il rettangolo senza id lo riceve, e la selezione lo segue.
    const named = out.keys[1]!;
    expect(named).toMatch(/^o/);
    expect(text).toContain(`<rect id="${named}" x="40" y="0" width="10" height="10" fill="#000000" transform="matrix(0 1 -1 0 0 0)"/>`);
    expect(out.keys).toEqual(["r", named, "g"]);
    // Il gruppo riceve la rotazione nelle coordinate del suo genitore.
    expect(text).toContain('<g id="g" transform="matrix(0 1 -1 0 0 100)">');
    // Dove finiscono, nella scena: ciò che l'indice dirà dopo.
    const after = opened.reindex();
    const expected = boundsAfter(after.units.filter((unit) => unit.key !== "turned"), [1, 0, 0, 1, 0, 0])!;
    const actual = boundsAfter(units, m)!;
    expect(expected).toEqual({ min: [-10, 0], max: [0, 110] });
    [...actual.min, ...actual.max].forEach((value, at) => expect(value).toBeCloseTo([...expected.min, ...expected.max][at]!, 9));
    expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
  });

  it("compongono la trasformazione nuova con quella che l'oggetto aveva", () => {
    const opened = open(SOURCE);
    const unit = opened.index.get("turned")!;
    const m = numericMatrix(choice({ rotate: -30 }), [5, 55]);
    const out = numericOps([unit], m, ids(opened))!;
    // Ruotato indietro dei suoi 30°: niente da scrivere, e l'attributo va.
    expect(out.ops).toEqual([{ op: "set", id: "turned", attrs: { transform: null } }]);
  });

  it("non cambiano un oggetto che resterebbe scritto com'è", () => {
    const opened = open(SOURCE);
    const units = opened.index.units;
    expect(numericOps(units, numericMatrix(UNCHANGED, [0, 0]), ids(opened))).toEqual({ ops: [], keys: units.map((unit) => unit.key), changed: 0 });
    // Un giro intero torna dov'era, anche se il seno di 360° non è zero.
    const turned = opened.index.get("turned")!;
    expect(numericOps([turned], numericMatrix(choice({ rotate: 360 }), [3, 3]), ids(opened))!.changed).toBe(0);
  });

  it("non partono se il file non saprebbe scrivere un oggetto trasformato", () => {
    const opened = open(SOURCE);
    const m = numericMatrix(choice({ scaleX: 0.001, scaleY: 0.001, rotate: 30 }), [0, 0]);
    expect(numericOps(opened.index.units, m, ids(opened))).toBeNull();
  });
});
