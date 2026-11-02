import { describe, expect, it } from "vitest";
import { parseCanvas } from "./model";
import { inspectCanvasJson, canvasNodeAt, isBlankCanvasSource, patchCanvasSource } from "./source-edit";

describe("canvasNodeAt", () => {
  it("trova la carta il cui oggetto sorgente contiene l'offset", () => {
    const source = '{"edges":[],"nodes":[{"id":"a"},\n  {"id":"b","text":"x"}],"extra":1}';
    const first = source.indexOf('{"id":"a"}');
    const second = source.indexOf('{"id":"b"');
    expect(canvasNodeAt(source, first)).toBe(0);
    expect(canvasNodeAt(source, first + '{"id":"a"}'.length - 1)).toBe(0);
    // La virgola e lo spazio fra due carte non sono di nessuna.
    expect(canvasNodeAt(source, first + '{"id":"a"}'.length)).toBeNull();
    expect(canvasNodeAt(source, second + 5)).toBe(1);
    expect(canvasNodeAt(source, source.indexOf('"extra"'))).toBeNull();
  });

  it("non inventa una carta in una sorgente senza nodi o illeggibile", () => {
    expect(canvasNodeAt('{"edges":[]}', 3)).toBeNull();
    expect(canvasNodeAt('{"nodes":[', 9)).toBeNull();
  });
});

describe("isBlankCanvasSource", () => {
  it("vuoto è un BOM facoltativo più spazi JSON, non trim()", () => {
    for (const blank of ["", " \t\r\n", "\uFEFF", "\uFEFF\r\n"]) expect(isBlankCanvasSource(blank), JSON.stringify(blank)).toBe(true);
    for (const full of ["\u00A0", "\u0085", "\u2028", " \uFEFF", "\uFEFF\uFEFF", "{}"]) {
      expect(isBlankCanvasSource(full), JSON.stringify(full)).toBe(false);
    }
  });
});

describe("inspectCanvasJson", () => {
  it("rifiuta un surrogato spaiato e un numero oltre un f64, non il resto", () => {
    for (const bad of ['{"a":"\\ud800"}', '{"\\udc00":1}', '["x\uDBFF"]', '[1e400]', '{"a":[-1e999]}']) {
      expect(() => inspectCanvasJson(bad), bad).toThrow();
    }
    for (const good of ['{"a":"\\ud83d\\ude00"}', '["😀","\\n\\u0041"]', '[1e308,-0,true,null]']) {
      expect(inspectCanvasJson(good), good).toEqual([]);
    }
  });


  it("dice dove sta ogni chiave doppia, a qualunque profondità", () => {
    const source = '{"a":1,"nodes":[{"id":"x","k":{"q":1,"q":2},"id":"y"}],"a":2}';
    expect(inspectCanvasJson(source)).toEqual([
      { path: ["nodes", 0, "k"], key: "q", offset: source.indexOf('"q":2') },
      { path: ["nodes", 0], key: "id", offset: source.indexOf('"id":"y"') },
      { path: [], key: "a", offset: source.lastIndexOf('"a"') },
    ]);
  });

  it("confronta le chiavi decodificate e salta il BOM iniziale", () => {
    const source = '\uFEFF {"\\u0061":1,"a":2}';
    expect(inspectCanvasJson(source)).toEqual([{ path: [], key: "a", offset: source.indexOf('"a"') }]);
    expect(inspectCanvasJson('{"a":{"b":1},"c":[{"b":2}]}')).toEqual([]);
  });
});

describe("lo scanner del riscrittore", () => {
  const card = '{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"t"}';

  it("rifiuta ancora una chiave doppia qualunque, anche sconosciuta", () => {
    const source = `{"nodes":[${card}],"meta":{"z":1,"z":2}}`;
    const before = parseCanvas(source);
    const after = { ...before, nodes: [{ ...before.nodes[0]!, x: 5 }] };
    expect(() => patchCanvasSource(source, before, after)).toThrow(/duplicate canvas JSON key/);
  });

  it("conta come spazio solo gli spazi JSON", () => {
    expect(canvasNodeAt(`{"nodes":[ ${card}]}`, 11)).toBe(0);
    expect(canvasNodeAt(`{"nodes":[\u00A0${card}]}`, 11)).toBeNull();
  });

  it("tiene il BOM fuori dalla radice", () => {
    const source = `\uFEFF{"nodes":[${card}],"edges":[]}`;
    const before = parseCanvas(source);
    const after = { ...before, nodes: [{ ...before.nodes[0]!, x: 5 }] };
    expect(patchCanvasSource(source, before, after)).toBe(source.replace('"x":0', '"x":5'));
  });

  it("una lavagna di BOM e CRLF tiene BOM e CRLF quando si riempie", () => {
    const after = parseCanvas(`{"nodes":[${card}]}`);
    const written = patchCanvasSource("\uFEFF\r\n", parseCanvas("\uFEFF\r\n"), after);
    expect(written.startsWith("\uFEFF{\r\n")).toBe(true);
    expect(written.endsWith("}\r\n")).toBe(true);
    expect(written.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("il null di un campo noto sparisce quando si riscrive la scheda, e resta altrove", () => {
    const source = `{"nodes":[${card.replace("}", ',"color":null}')},${card.replace('"a"', '"b"').replace("}", ',"label":null}')}],"edges":null}`;
    const before = parseCanvas(source);
    const after = { ...before, nodes: [{ ...before.nodes[0]!, x: 5 }, before.nodes[1]!] };
    const written = patchCanvasSource(source, before, after);
    expect(written).not.toContain('"color":null');
    expect(written).toContain('"label":null');
    expect(written).toContain('"edges":null');
    expect(parseCanvas(written)).toEqual(after);
  });
});
