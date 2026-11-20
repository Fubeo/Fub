import { describe, expect, it } from "vitest";
import { jsonEqual } from "./json-equal";

const fn = () => 1;
const sym = Symbol("s");
const sparse: unknown[] = [1, , 3]; // il buco in mezzo è il caso
const withExtra = Object.assign([1, 2], { extra: "x" });
const inherited = Object.create({ eredita: 1 }) as Record<string, unknown>;
inherited.a = 1;
const same = { lo: "stesso" };

/// La semantica, caso per caso: l'ultima colonna è ciò che direbbe
/// `JSON.stringify(a) === JSON.stringify(b)`, e il test lo controlla anche.
const CASES: Array<[string, unknown, unknown, boolean]> = [
  ["stesso riferimento", same, same, true],
  ["primitivi uguali", "a", "a", true],
  ["primitivi diversi", "a", "b", false],
  ["numero e stringa", 1, "1", false],
  ["vero e falso", true, false, false],
  ["NaN e NaN", NaN, NaN, true],
  ["NaN e null", NaN, null, true],
  ["Infinity e null", Infinity, null, true],
  ["-Infinity e NaN", -Infinity, NaN, true],
  ["-0 e 0", -0, 0, true],
  ["-0 e 0 dentro un oggetto", { x: -0 }, { x: 0 }, true],
  ["in cima undefined e null", undefined, null, false],
  ["in cima undefined e undefined", undefined, undefined, true],
  ["in cima undefined e una funzione", undefined, fn, true],
  ["in cima un simbolo e undefined", sym, undefined, true],
  ["chiave undefined e chiave assente", { a: 1, b: undefined }, { a: 1 }, true],
  ["chiave funzione e chiave assente", { a: 1, f: fn }, { a: 1 }, true],
  ["chiave simbolo e chiave assente", { s: sym, a: 1 }, { a: 1 }, true],
  ["chiave null e chiave assente", { a: 1, b: null }, { a: 1 }, false],
  ["chiave undefined e chiave null", { b: undefined }, { b: null }, false],
  ["chiavi in ordine diverso", { a: 1, b: 2 }, { b: 2, a: 1 }, false],
  ["chiavi in ordine diverso, una mancante in mezzo", { a: 1, x: undefined, b: 2 }, { a: 1, b: 2 }, true],
  ["chiavi numeriche (ordine di Object.keys)", { 2: "b", 1: "a" }, { 1: "a", 2: "b" }, true],
  ["array e oggetto vuoti", [], {}, false],
  ["array e oggetto con gli indici", ["x"], { 0: "x" }, false],
  ["array uguali", [1, [2, { c: 3 }]], [1, [2, { c: 3 }]], true],
  ["array di lunghezza diversa", [1, 2], [1, 2, 3], false],
  ["undefined in un array e null", [undefined], [null], true],
  ["funzione in un array e null", [fn], [null], true],
  ["buco in un array e null", sparse, [1, null, 3], true],
  ["proprietà non indice di un array", withExtra, [1, 2], true],
  ["proprietà ereditata", inherited, { a: 1 }, true],
  ["Map e oggetto vuoto", new Map([["a", 1]]), {}, true],
  ["Set e oggetto vuoto", new Set([1]), {}, true],
  ["Number incartato", new Number(3), 3, true],
  ["String incartata", { s: new String("x") }, { s: "x" }, true],
  ["Boolean incartato", [new Boolean(false)], [false], true],
  ["Number incartato non finito", new Number(NaN), null, true],
  ["Date e la sua stringa", new Date(0), "1970-01-01T00:00:00.000Z", true],
  ["toJSON annidato", { d: { toJSON: () => 5 } }, { d: 5 }, true],
  ["toJSON che non restituisce niente", { a: 1, d: { toJSON: () => undefined } }, { a: 1 }, true],
  ["toJSON che riceve la chiave", { k: { toJSON: (key: string) => key } }, { k: "k" }, true],
  ["toJSON che riceve l'indice", [{ toJSON: (key: string) => key }], ["0"], true],
  ["toJSON in cima", { toJSON: () => "x" }, "x", true],
  ["toJSON diverso",{ d: { toJSON: () => 5 } }, { d: 6 }, false],
  ["oggetti annidati diversi in fondo", { a: { b: { c: [1, 2, 3] } } }, { a: { b: { c: [1, 2, 4] } } }, false],
  ["oggetti annidati uguali, oggetti nuovi", { a: { b: { c: [1, 2, 3] } } }, { a: { b: { c: [1, 2, 3] } } }, true],
  ["null e oggetto vuoto", null, {}, false],
  ["stringa vuota e null", "", null, false],
  ["zero e false", 0, false, false],
];

describe("jsonEqual", () => {
  it.each(CASES)("%s", (_name, a, b, equal) => {
    // Il caso dice quello che direbbe `JSON.stringify`, e lo dice davvero.
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(equal);
    expect(jsonEqual(a, b)).toBe(equal);
    expect(jsonEqual(b, a)).toBe(equal);
  });

  it("su valori casuali risponde come JSON.stringify", () => {
    // Un generatore con seme: valori piccoli che si somigliano, perché le
    // coppie uguali e quasi uguali sono quelle che contano.
    let seed = 0x5eed;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const leaves: unknown[] = [0, -0, 1, NaN, Infinity, null, undefined, "", "a", true, false, fn];
    const keys = ["a", "b", "c"];
    const gen = (depth: number): unknown => {
      const kind = depth > 2 ? 0 : rand(3);
      if (kind === 0) return leaves[rand(leaves.length)];
      if (kind === 1) return Array.from({ length: rand(3) }, () => gen(depth + 1));
      const out: Record<string, unknown> = {};
      for (const key of keys) if (rand(2)) out[key] = gen(depth + 1);
      return out;
    };
    let equalPairs = 0;
    for (let i = 0; i < 5000; i++) {
      const a = gen(0);
      const b = gen(0);
      const expected = JSON.stringify(a) === JSON.stringify(b);
      if (expected) equalPairs++;
      expect(jsonEqual(a, b), `${String(JSON.stringify(a))} / ${String(JSON.stringify(b))}`).toBe(expected);
    }
    // Il giro ha provato anche coppie uguali, non solo diverse.
    expect(equalPairs).toBeGreaterThan(100);
  });
});
