// La scrittura canonica di §7: escape, ordine degli attributi, righe e
// rientri, prefissi, copia dei valori non toccati e numeri della geometria.

import { describe, expect, it } from "vitest";
import {
  attributeKey,
  canonicalOrder,
  elementToOut,
  elemToOut,
  ElemError,
  escapeAttribute,
  escapeText,
  formatTransform,
  isXmlText,
  NamespaceScope,
  pathData,
  rootOrder,
  writeElement,
  type Elem,
  type OutAttr,
  type OutElement,
} from "./serialize";
import { SourceText } from "./text";
import { FUB_NS, parseXml, SVG_NS, XLINK_NS, XML_URI, XMLNS_URI, type XmlDocument } from "./xml";

const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

/// Lo scope di un documento FubDraw: SVG predefinito, `fub` e `xlink`.
const FUBDRAW = NamespaceScope.EMPTY.declare([
  [null, SVG_NS],
  ["fub", FUB_NS],
  ["xlink", XLINK_NS],
  ["inkscape", INKSCAPE],
]);

function attr(name: string, text = "1"): OutAttr {
  const colon = name.indexOf(":");
  const prefix = colon < 0 ? null : name.slice(0, colon);
  const local = colon < 0 ? name : name.slice(colon + 1);
  const uris: Record<string, string> = { fub: FUB_NS, xlink: XLINK_NS, inkscape: INKSCAPE, xmlns: XMLNS_URI };
  if (name === "xmlns") return { name, uri: XMLNS_URI, local: "xmlns", text };
  return { name, uri: prefix === null ? "" : uris[prefix]!, local, text };
}

function written(elem: Elem, scope = FUBDRAW, indent = ""): string {
  return writeElement(elemToOut(elem, scope), indent);
}

function rejection(elem: unknown, scope = FUBDRAW): string {
  try {
    elemToOut(elem as Elem, scope);
  } catch (error) {
    if (error instanceof ElemError) return error.detail;
    throw error;
  }
  throw new Error("l'elemento è stato accettato");
}

function parse(text: string): XmlDocument {
  return parseXml(new SourceText(text), false);
}

/// Il primo elemento di `doc` che si chiama `name`.
function find(doc: XmlDocument, name: string): number {
  const id = doc.nodes.findIndex((node) => node.kind === "element" && node.name === name);
  if (id < 0) throw new Error(`manca ${name}`);
  return id;
}

describe("escape (§7, punto 5)", () => {
  it("negli attributi: i cinque riferimenti, tabulazioni e a capo", () => {
    expect(escapeAttribute("a&b<c>\"d'\te\nf\rg")).toBe("a&amp;b&lt;c&gt;&quot;d'&#9;e&#10;f&#13;g");
  });

  it("nel testo: &, < e >; un \\r diventa un riferimento", () => {
    expect(escapeText("a&b<c>\"d'\te\nf\rg")).toBe("a&amp;b&lt;c&gt;\"d'\te\nf&#13;g");
  });

  it("riconosce i caratteri che XML 1.0 non ammette", () => {
    for (const ok of ["", "ok\t\n\r", "\u0085", "😀", "😀", "�", "\u{10FFFF}"]) {
      expect(isXmlText(ok), JSON.stringify(ok)).toBe(true);
    }
    for (const bad of ["\u0000", "a\u0008", "\u001F", "￾", "￿", "\uD800", "x\uDC00y"]) {
      expect(isXmlText(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("ordine degli attributi (§7, punto 2)", () => {
  it("id, fub noti, geometria, presentazione, transform e href, altri, fub:ink", () => {
    const input = [
      "fub:ink",
      "inkscape:label",
      "transform",
      "fill",
      "d",
      "fub:brush",
      "fub:zzz",
      "fub:tool",
      "id",
      "foo",
      "xlink:href",
      "href",
      "stroke",
    ].map((name) => attr(name));
    expect(canonicalOrder(input).map((a) => a.name)).toEqual([
      "id",
      "fub:tool",
      "fub:brush",
      "d",
      "fill",
      "stroke",
      "transform",
      "href",
      "xlink:href",
      "inkscape:label",
      "fub:zzz",
      "foo",
      "fub:ink",
    ]);
  });

  it("ogni gruppo nell'ordine della specifica", () => {
    const fub = ["layer", "role", "tool", "shape", "geom", "locked", "at", "brush"].map((n) => `fub:${n}`);
    const geometry = ["x", "y", "dy", "cx", "cy", "r", "width", "height", "rx", "ry", "x1", "y1", "x2", "y2", "points", "d"];
    const presentation = [
      "fill",
      "fill-opacity",
      "stroke",
      "stroke-width",
      "stroke-opacity",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-dasharray",
      "opacity",
      "display",
      "font-family",
      "font-size",
      "font-weight",
      "text-anchor",
      "preserveAspectRatio",
    ];
    const all = ["id", ...fub, ...geometry, ...presentation, "transform", "href"];
    const shuffled = [...all].reverse().map((name) => attr(name));
    expect(canonicalOrder(shuffled).map((a) => a.name)).toEqual(all);
  });

  it("la radice: dichiarazioni, versione, viewBox, width, height, poi gli altri", () => {
    const input = [
      "width",
      "fub:version",
      "xmlns:fub",
      "id",
      "xmlns",
      "viewBox",
      "height",
      "inkscape:version",
      "xmlns:inkscape",
    ].map((name) => (name.startsWith("xmlns:") ? { ...attr(name), uri: XMLNS_URI } : attr(name)));
    expect(rootOrder(input).map((a) => a.name)).toEqual([
      "xmlns",
      "xmlns:fub",
      "xmlns:inkscape",
      "fub:version",
      "viewBox",
      "width",
      "height",
      "id",
      "inkscape:version",
    ]);
  });
});

describe("righe e rientri (§7, punto 1)", () => {
  const rect: OutElement = { name: "rect", group: false, attrs: [attr("x", "1")], children: [], text: null };

  it("un elemento senza figli si chiude con />", () => {
    expect(writeElement(rect, "  ")).toBe('<rect x="1"/>');
  });

  it("gruppi e livelli vuoti restano aperti, su due righe", () => {
    const layer: OutElement = { name: "g", group: true, attrs: [attr("id", "l1")], children: [], text: null };
    expect(writeElement(layer, "  ")).toBe('<g id="l1">\n  </g>');
  });

  it("i figli due spazi più dentro, il testo sulla riga del tag", () => {
    const tspan = (text: string): OutElement => ({ name: "tspan", group: false, attrs: [attr("dy", "0")], children: [], text });
    const text: OutElement = { name: "text", group: false, attrs: [attr("x", "1")], children: [tspan("a"), tspan("")], text: null };
    expect(writeElement(text, "    ")).toBe('<text x="1">\n      <tspan dy="0">a</tspan>\n      <tspan dy="0"/>\n    </text>');
  });

  it("un gruppo con figli annidati", () => {
    const inner: OutElement = { name: "g", group: true, attrs: [], children: [rect], text: null };
    const outer: OutElement = { name: "g", group: true, attrs: [attr("id", "o1")], children: [inner, rect], text: null };
    expect(writeElement(outer, "")).toBe('<g id="o1">\n  <g>\n    <rect x="1"/>\n  </g>\n  <rect x="1"/>\n</g>');
  });
});

describe("dall'elemento di un'operazione alla forma canonica", () => {
  it("un tratto, con gli attributi in ordine", () => {
    const elem: Elem = {
      tag: "path",
      attrs: { "fub:ink": "1 s100 cxy 0,0", id: "o12345678", fill: "#000000", "fub:tool": "pen" },
    };
    expect(written(elem)).toBe('<path id="o12345678" fub:tool="pen" fill="#000000" fub:ink="1 s100 cxy 0,0"/>');
  });

  it("i valori nuovi passano dall'escape", () => {
    expect(written({ tag: "rect", attrs: { "inkscape:label": "a\"b\n<c>" } })).toBe('<rect inkscape:label="a&quot;b&#10;&lt;c&gt;"/>');
  });

  it("testo e figli", () => {
    const elem: Elem = {
      tag: "text",
      attrs: { id: "o1", x: "10" },
      children: [
        { tag: "title", attrs: {}, text: "Nota" },
        { tag: "tspan", attrs: { x: "10", dy: "0" }, text: "a < b & c" },
        { tag: "tspan", attrs: { x: "10", dy: "19.2" }, text: null },
      ],
    };
    expect(written(elem, FUBDRAW, "  ")).toBe(
      '<text id="o1" x="10">\n    <title>Nota</title>\n    <tspan x="10" dy="0">a &lt; b &amp; c</tspan>\n    <tspan x="10" dy="19.2"/>\n  </text>',
    );
  });

  it("un titolo vuoto si chiude da sé", () => {
    expect(written({ tag: "title", attrs: {}, text: "" })).toBe("<title/>");
  });

  it("i prefissi sono quelli del documento", () => {
    const scope = NamespaceScope.EMPTY.declare([
      ["svg", SVG_NS],
      ["f", FUB_NS],
      ["xl", XLINK_NS],
    ]);
    expect(written({ tag: "rect", attrs: { "fub:role": "x" } }, scope)).toBe('<svg:rect f:role="x"/>');
    expect(written({ tag: "image", attrs: { "xlink:href": "a.png" } }, scope)).toBe('<svg:image xl:href="a.png"/>');
  });

  it("fub: è sempre il namespace di FubDraw, anche se il documento usa il prefisso per altro", () => {
    const scope = NamespaceScope.EMPTY.declare([
      [null, SVG_NS],
      ["fub", "urn:altro"],
      ["fub1", FUB_NS],
    ]);
    expect(written({ tag: "path", attrs: { "fub:tool": "pen" } }, scope)).toBe('<path fub1:tool="pen"/>');
  });

  it("xml: è sempre legato", () => {
    expect(written({ tag: "text", attrs: { "xml:space": "preserve" } })).toBe('<text xml:space="preserve"/>');
  });

  it("rifiuta le forme sbagliate", () => {
    expect(rejection(null)).toMatch(/assente/);
    expect(rejection({ tag: "script", attrs: {} })).toMatch(/tag fuori dal formato/);
    expect(rejection({ tag: "rect" })).toMatch(/attributi assenti/);
    expect(rejection({ tag: "tspan", attrs: {} })).toMatch(/tspan sta solo dentro un text/);
    expect(rejection({ tag: "path", attrs: {}, children: [{ tag: "rect", attrs: {} }] })).toMatch(/rect non può stare dentro path/);
    expect(rejection({ tag: "text", attrs: {}, children: [{ tag: "g", attrs: {} }] })).toMatch(/g non può stare dentro text/);
    expect(rejection({ tag: "g", attrs: {}, children: [{ tag: "tspan", attrs: {} }] })).toMatch(/tspan sta solo dentro un text/);
    expect(rejection({ tag: "tspan", attrs: {}, children: [] })).toMatch(/tspan/);
    expect(rejection({ tag: "title", attrs: {}, children: [{ tag: "desc", attrs: {} }] })).toMatch(/non ha figli/);
    expect(rejection({ tag: "rect", attrs: {}, text: "x" })).toMatch(/rect non ha testo/);
    expect(rejection({ tag: "g", attrs: {}, children: {} })).toMatch(/figli non validi/);
    expect(rejection({ tag: "rect", attrs: { x: 1 } })).toMatch(/non stringa/);
    expect(rejection({ tag: "rect", attrs: { "1x": "1" } })).toMatch(/nome di attributo non valido/);
    expect(rejection({ tag: "rect", attrs: { "foo:bar": "1" } })).toMatch(/prefisso non dichiarato/);
    expect(rejection({ tag: "rect", attrs: { xmlns: SVG_NS } })).toMatch(/non dichiara namespace/);
    expect(rejection({ tag: "rect", attrs: { "xmlns:foo": "urn:foo" } })).toMatch(/non dichiara namespace/);
    expect(rejection({ tag: "rect", attrs: { x: "\u0001" } })).toMatch(/carattere non ammesso/);
    expect(rejection({ tag: "title", attrs: {}, text: "￿" })).toMatch(/carattere non ammesso/);
    const both = NamespaceScope.EMPTY.declare([
      [null, SVG_NS],
      ["fub", FUB_NS],
      ["fub1", FUB_NS],
    ]);
    expect(rejection({ tag: "rect", attrs: { "fub:x": "1", "fub1:x": "2" } }, both)).toMatch(/attributo ripetuto/);
    const noXlink = NamespaceScope.EMPTY.declare([[null, SVG_NS]]);
    expect(rejection({ tag: "image", attrs: { "xlink:href": "a.png" } }, noXlink)).toMatch(/non dichiara il namespace/);
    expect(rejection({ tag: "rect", attrs: {} }, NamespaceScope.EMPTY)).toMatch(/namespace SVG/);
  });
});

describe("la copia di un elemento letto", () => {
  it("valori come sono scritti, figli col rientro canonico", () => {
    const doc = parse(
      `<svg xmlns="${SVG_NS}"><text fill="#000" x='1"2'\r\n  ><tspan dy="0">a &amp; b</tspan>\r\n  <tspan>c&#10;</tspan></text></svg>`,
    );
    expect(writeElement(elementToOut(doc, find(doc, "text")), "")).toBe(
      '<text x="1&quot;2" fill="#000">\n  <tspan dy="0">a &amp; b</tspan>\n  <tspan>c&#10;</tspan>\n</text>',
    );
  });

  it("un a capo grezzo in un valore si porta a LF", () => {
    const doc = parse(`<svg xmlns="${SVG_NS}"><rect fill="a\r\nb\rc"/></svg>`);
    expect(writeElement(elementToOut(doc, find(doc, "rect")), "")).toBe('<rect fill="a\nb\nc"/>');
  });

  it("un tspan vuoto e un gruppo autochiuso", () => {
    const doc = parse(`<svg xmlns="${SVG_NS}"><g id="a"/><text><tspan></tspan></text></svg>`);
    expect(writeElement(elementToOut(doc, find(doc, "g")), "  ")).toBe('<g id="a">\n  </g>');
    expect(writeElement(elementToOut(doc, find(doc, "text")), "")).toBe("<text>\n  <tspan/>\n</text>");
  });
});

describe("chiavi e scope", () => {
  it("la chiave di un attributo usa il prefisso convenzionale", () => {
    expect(attributeKey({ name: "f:ink", uri: FUB_NS, local: "ink" })).toBe("fub:ink");
    expect(attributeKey({ name: "xl:href", uri: XLINK_NS, local: "href" })).toBe("xlink:href");
    expect(attributeKey({ name: "xml:space", uri: XML_URI, local: "space" })).toBe("xml:space");
    expect(attributeKey({ name: "inkscape:label", uri: INKSCAPE, local: "label" })).toBe("inkscape:label");
    expect(attributeKey({ name: "fill", uri: "", local: "fill" })).toBe("fill");
  });

  it("risolve prefissi e sceglie quello con cui scrivere", () => {
    expect(NamespaceScope.EMPTY.uri(null)).toBe("");
    expect(NamespaceScope.EMPTY.uri("xml")).toBe(XML_URI);
    expect(NamespaceScope.EMPTY.uri("nope")).toBeNull();
    const scope = NamespaceScope.EMPTY.declare([
      ["z", FUB_NS],
      ["a", FUB_NS],
      ["s", SVG_NS],
    ]);
    expect(scope.attributePrefix(FUB_NS)).toBe("a");
    expect(scope.declare([["fub", FUB_NS]]).attributePrefix(FUB_NS)).toBe("fub");
    expect(scope.svgName("rect")).toBe("s:rect");
    expect(scope.declare([[null, SVG_NS]]).svgName("rect")).toBe("rect");
    expect(NamespaceScope.EMPTY.svgName("rect")).toBeNull();
    expect(scope.attributePrefix(XLINK_NS)).toBeNull();
  });
});

describe("numeri della geometria (§7, punti 3 e 4)", () => {
  it("d: comandi assoluti attaccati alle coordinate, due decimali", () => {
    expect(
      pathData([
        { kind: "move", to: [10, 20] },
        { kind: "line", to: [30.125, -0.004] },
        { kind: "quad", control: [1, 2], to: [3, 4] },
        { kind: "cubic", c1: [1, 2], c2: [3, 4], to: [5, 6] },
        { kind: "arc", radii: [5, 5], rotation: 30, large: true, sweep: false, to: [1.5, -2.25] },
        { kind: "close" },
      ]),
    ).toBe("M10 20 L30.13 0 Q1 2 3 4 C1 2 3 4 5 6 A5 5 30 1 0 1.5 -2.25 Z");
  });

  it("transform: una matrix con quattro decimali", () => {
    expect(formatTransform([0.70710678, 0.70710678, -0.70710678, 0.70710678, 12.34567, 0])).toBe(
      "matrix(0.7071 0.7071 -0.7071 0.7071 12.3457 0)",
    );
  });
});
