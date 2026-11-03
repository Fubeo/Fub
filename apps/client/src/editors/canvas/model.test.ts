// Le regole di lettura della lavagna (R1–R8 del piano N3): il TypeScript legge
// come leggerà il nucleo Rust, così ogni vettore ha un solo esito giusto. I
// casi vengono dalla prova 2 del piano, dove le due letture divergevano.
import { describe, expect, it } from "vitest";
import { parseCanvas, serializeCanvas } from "./model";

const node = (fields: string): string =>
  `{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"t"${fields}}`;
const board = (nodes: string, rest = ""): string => `{"nodes":[${nodes}]${rest}}`;

describe("R1 · vuoto è un BOM facoltativo più spazi JSON", () => {
  it.each([
    ["niente", ""],
    ["solo spazi JSON", " \t\r\n"],
    ["solo il BOM", "﻿"],
    ["il BOM seguito da CRLF", "﻿\r\n"],
    ["il BOM seguito da spazi JSON", "﻿ \t\n"],
  ])("%s è una lavagna vuota", (_name, source) => {
    expect(parseCanvas(source)).toEqual({ nodes: [], edges: [] });
  });

  it.each([
    ["uno spazio non JSON (U+00A0)", " "],
    ["U+0085", "\u0085"],
    ["un separatore di riga (U+2028)", "\n "],
    ["un BOM dopo uno spazio", " ﻿"],
    ["due BOM", "﻿﻿"],
  ])("%s non è vuoto ed è un errore", (_name, source) => {
    expect(() => parseCanvas(source)).toThrow();
  });

  it("un BOM seguito da CRLF prima di una lavagna vera si salta", () => {
    expect(parseCanvas(`﻿\r\n${board(node(""))}\r\n`).nodes).toHaveLength(1);
  });
});

describe("R2 · x, y, width e height sono interi sicuri", () => {
  it.each([
    ["1.0", "1.0", 1],
    ["1e2", "1e2", 100],
    ["il massimo intero sicuro", "9007199254740991", 9007199254740991],
    ["il minimo intero sicuro", "-9007199254740991", -9007199254740991],
  ])("%s va bene", (_name, text, value) => {
    const source = board(`{"id":"a","type":"text","x":${text},"y":${text},"width":10,"height":10,"text":"t"}`);
    const [parsed] = parseCanvas(source).nodes;
    expect(parsed!.x).toBe(value);
    expect(parsed!.y).toBe(value);
  });

  it("-0 va bene e si riscrive 0", () => {
    const doc = parseCanvas(board(`{"id":"a","type":"text","x":-0,"y":0,"width":10,"height":10,"text":"t"}`));
    expect(doc.nodes[0]!.x).toBe(0);
    expect(serializeCanvas(doc)).toContain('"x": 0,');
  });

  it.each([
    ["2^53", "9007199254740992"],
    ["-2^53", "-9007199254740992"],
    ["1e300", "1e300"],
    ["una frazione vera", "1.5"],
  ])("%s è un errore su ogni campo", (_name, text) => {
    for (const field of ["x", "y", "width", "height"]) {
      const fields: Record<string, string> = { x: "0", y: "0", width: "10", height: "10", [field]: text };
      const source = board(`{"id":"a","type":"text","x":${fields.x},"y":${fields.y},"width":${fields.width},"height":${fields.height},"text":"t"}`);
      expect(() => parseCanvas(source), field).toThrow();
    }
  });

  it("width e height restano almeno 1", () => {
    expect(() => parseCanvas(board(`{"id":"a","type":"text","x":0,"y":0,"width":0,"height":10,"text":"t"}`))).toThrow();
  });
});

describe("R3 · chiavi doppie", () => {
  it.each([
    ["sulla radice", '{"nodes":[],"nodes":[]}'],
    ["sulla radice anche per edges", '{"nodes":[],"edges":[],"edges":[]}'],
    ["in una scheda", board(node(',"x":5'))],
    ["in una scheda anche se facoltativa", board(node(',"color":"1","color":"2"'))],
    ["in un arco", board(node(""), ',"edges":[{"id":"e","fromNode":"a","toNode":"a","label":"u","label":"d"}]')],
  ])("una chiave nota doppia %s è un errore", (_name, source) => {
    expect(() => parseCanvas(source)).toThrow(/doppia/);
  });

  it("una chiave sconosciuta doppia tiene l'ultimo valore nella posizione della prima", () => {
    const doc = parseCanvas(`{"z":1,"nodes":[${node(',"k":1,"q":0,"k":2')}],"q":3,"z":2}`);
    expect(Object.keys(doc).filter((key) => key !== "nodes" && key !== "edges")).toEqual(["z", "q"]);
    expect(doc.z).toBe(2);
    const card = doc.nodes[0]!;
    expect(card.k).toBe(2);
    expect(Object.keys(card).indexOf("k")).toBeLessThan(Object.keys(card).indexOf("q"));
  });

  it("una chiave nota doppia dentro un campo sconosciuto va bene", () => {
    const doc = parseCanvas(`{"meta":{"nodes":1,"nodes":2},"nodes":[${node(',"extra":{"x":1,"x":2,"id":"u","id":"v"}')}],`
      + '"edges":[{"id":"e","fromNode":"a","toNode":"a","fub":[{"label":1,"label":2}]}]}');
    expect(doc.meta).toEqual({ nodes: 2 });
    expect(doc.nodes[0]!.extra).toEqual({ x: 2, id: "v" });
    expect(doc.edges[0]!.fub).toEqual([{ label: 2 }]);
  });
});

describe("R4 · un surrogato spaiato è un errore", () => {
  it.each([
    ["alto scritto con escape in un valore", board(node(',"label":"\\ud800"'))],
    ["basso scritto con escape in un valore", board(node(',"label":"x\\udc00"'))],
    ["scritto con escape in una chiave sconosciuta", board(node(',"\\ud83dk":1'))],
    ["dentro un campo sconosciuto", '{"meta":["\\udfff"],"nodes":[]}'],
    ["crudo nel sorgente", board(node(',"label":"\uD800"'))],
    ["in coda a una coppia", board(node(',"label":"\\ud83d\\ude00\\ude00"'))],
  ])("%s", (_name, source) => {
    expect(() => parseCanvas(source)).toThrow();
  });

  it("una coppia di surrogati, con escape o cruda, va bene", () => {
    const doc = parseCanvas(board(node(',"label":"\\ud83d\\ude00 😀","😀":1')));
    expect(doc.nodes[0]!.label).toBe("😀 😀");
    expect(doc.nodes[0]!["😀"]).toBe(1);
  });
});

describe("R7 · null su un campo noto facoltativo vuol dire assente", () => {
  it("nodes ed edges null sono liste vuote", () => {
    expect(parseCanvas('{"nodes":null,"edges":null}')).toEqual({ nodes: [], edges: [] });
  });

  it("i campi facoltativi di una scheda a null spariscono", () => {
    const fields = ["color", "file", "subpath", "url", "label", "background", "backgroundStyle"];
    const doc = parseCanvas(board(node(fields.map((field) => `,"${field}":null`).join(""))));
    expect(Object.keys(doc.nodes[0]!)).toEqual(["id", "type", "x", "y", "width", "height", "text"]);
  });

  it("i campi facoltativi di un arco a null spariscono", () => {
    const fields = ["fromSide", "fromEnd", "toSide", "toEnd", "color", "label"];
    const doc = parseCanvas(board(node(""), `,"edges":[{"id":"e","fromNode":"a","toNode":"a"${fields.map((field) => `,"${field}":null`).join("")}}]`));
    expect(Object.keys(doc.edges[0]!)).toEqual(["id", "fromNode", "toNode"]);
  });

  it("null su un campo che il tipo vuole è come mancante, quindi un errore", () => {
    expect(() => parseCanvas(board(node(',"text":null').replace('"text":"t",', "")))).toThrow();
    expect(() => parseCanvas(board('{"id":"a","type":"file","x":0,"y":0,"width":10,"height":10,"file":null}'))).toThrow();
    expect(() => parseCanvas(board('{"id":"a","type":"text","x":null,"y":0,"width":10,"height":10,"text":"t"}'))).toThrow();
  });

  it("null su un campo sconosciuto resta com'è", () => {
    expect(parseCanvas(board(node(',"fub":null'))).nodes[0]!.fub).toBeNull();
  });
});

describe("R8 · backgroundStyle accetta qualunque stringa", () => {
  it.each(["cover", "ratio", "repeat", "tile", "", "Cover"])("%j si conserva", (style) => {
    const doc = parseCanvas(board(`{"id":"g","type":"group","x":0,"y":0,"width":10,"height":10,"backgroundStyle":${JSON.stringify(style)}}`));
    expect(doc.nodes[0]!.backgroundStyle).toBe(style);
    expect(serializeCanvas(doc)).toContain(`"backgroundStyle": ${JSON.stringify(style)}`);
  });

  it("un valore che non è una stringa resta un errore", () => {
    expect(() => parseCanvas(board('{"id":"g","type":"group","x":0,"y":0,"width":10,"height":10,"backgroundStyle":3}'))).toThrow();
  });
});
