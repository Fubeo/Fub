import { describe, expect, it } from "vitest";

import { JsonNumber, parseJson, stringifyJson, type JsonPath } from "./json";

const never = () => false;

/// Testi che `JSON.parse` legge e `JSON.stringify` riscrive: il lettore e lo
/// scrittore senza perdita devono dare lo stesso risultato.
const corpus = [
  "0",
  "-0",
  "1e5",
  "-2.5E-3",
  "0.1",
  "true",
  "null",
  '"semplice"',
  '"\\"citata\\" e \\\\ barra"',
  '"\\\\"',
  '"\\u00e9\\n\\t\\ud83d\\ude00 \\ud800"',
  "[]",
  "{}",
  " [ 1 , [ ] , { } , [ [ 2 ] ] ] ",
  '{"a":{"b":[1,{"c":null}],"vuoto":{}},"\\u0041\\"chiave":"valore","x":false}',
  '{"__proto__":{"y":1},"constructor":2,"doppia":1,"z":3,"doppia":4}',
  `\t\r\n{"spazi" :\n[ 1 ,2 ]\r\n}\n`,
];

/// Testi che `JSON.parse` rifiuta.
const malformed = [
  "",
  "   ",
  "[1,]",
  '{"a":1,}',
  "01",
  "-01",
  "1.",
  ".5",
  "+1",
  "-",
  "1e",
  "1e+",
  "tru",
  "nul",
  "[1 2]",
  '{"a" 1}',
  "{a:1}",
  '"aperta',
  '"\\"',
  '"\u0001"',
  '"\\x41"',
  " 1",
  "1 2",
  "[",
  '{"a":',
  "]",
];

describe("JSON senza perdita", () => {
  it("legge e scrive come JSON.parse e JSON.stringify", () => {
    for (const text of corpus) {
      const expected = JSON.parse(text) as unknown;
      expect(parseJson(text, never), text).toEqual(expected);
      expect(stringifyJson(expected), text).toBe(JSON.stringify(expected, null, 2));
    }
    const special = corpus[corpus.length - 2];
    const read = parseJson(special, never) as Record<string, unknown>;
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(Object.keys(read)).toEqual(Object.keys(JSON.parse(special) as object));
    expect(stringifyJson({ a: undefined, b: [undefined, () => 1], c: Number.NaN })).toBe(
      JSON.stringify({ a: undefined, b: [undefined, () => 1], c: Number.NaN }, null, 2),
    );
  });

  it("rifiuta quello che JSON.parse rifiuta", () => {
    for (const text of malformed) {
      expect(() => JSON.parse(text), text).toThrow(SyntaxError);
      expect(() => parseJson(text, never), text).toThrow(SyntaxError);
    }
  });

  it("conserva il lessema dei numeri soltanto sotto i membri scelti", () => {
    const text = '{"esatti":{"n":9007199254740993,"lista":[1.0,-0,2E3]},"altro":9007199254740993}';
    const paths: string[] = [];
    const read = parseJson(text, (path: JsonPath) => {
      paths.push(path.join("/"));
      return path.length === 1 && path[0] === "esatti";
    }) as { esatti: { n: unknown; lista: unknown[] }; altro: unknown };

    expect(paths).toEqual(["esatti", "altro"]);
    expect(read.esatti.n).toEqual(new JsonNumber("9007199254740993"));
    expect(read.esatti.lista).toEqual([new JsonNumber("1.0"), new JsonNumber("-0"), new JsonNumber("2E3")]);
    expect(read.altro).toBe(9007199254740992);
    expect(stringifyJson(read)).toBe(
      '{\n  "esatti": {\n    "n": 9007199254740993,\n    "lista": [\n      1.0,\n      -0,\n      2E3\n    ]\n  },\n'
        + '  "altro": 9007199254740992\n}',
    );
    expect(JSON.stringify(read.esatti.lista)).toBe("[1,0,2000]");
  });

  it("apre gli annidamenti che apre serde_json e rifiuta il successivo", () => {
    const nested = (depth: number) => `${"[".repeat(depth)}${"]".repeat(depth)}`;
    expect(() => parseJson(nested(127), never)).not.toThrow();
    expect(() => parseJson(nested(128), never)).toThrow(SyntaxError);
    expect(() => parseJson(`${'{"a":'.repeat(128)}1${"}".repeat(128)}`, never)).toThrow(SyntaxError);
  });
});
