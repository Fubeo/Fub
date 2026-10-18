// Lo scanner XML: gli stessi casi dei test di unità di `xml.rs` in
// `fub-scene`. Gli indici dei nodi qui sono unità UTF-16 grezze della
// stringa, e non byte come in Rust: gli span si confrontano col testo, che è
// lo stesso nelle due coordinate. L'offset di un errore è in byte UTF-8 come
// in Rust.

import { describe, expect, it } from "vitest";
import { SourceText } from "./text";
import { NS_SVG, parseXml, SVG_NS, XmlError, type XmlDocument, type XmlErrorKind } from "./xml";

function parse(source: string, headOnly = false): XmlDocument {
  return parseXml(new SourceText(source), headOnly);
}

/// Il tipo dell'errore di una sorgente che deve fallire.
function error(source: string): XmlErrorKind {
  try {
    parse(source);
  } catch (e) {
    if (e instanceof XmlError) return e.kind;
    throw e;
  }
  throw new Error(`doveva fallire: ${source}`);
}

/// Il valore normalizzato dell'attributo `name` della radice.
function rootAttr(source: string, name: string): string {
  const doc = parse(source);
  const attr = doc.element(doc.root)!.attrs.find((a) => a.name === name);
  if (attr === undefined) throw new Error(`manca ${name}`);
  return attr.value;
}

describe("lo scanner XML (xml.rs)", () => {
  it("gli span coprono ogni nodo e contano il BOM", () => {
    const source =
      '﻿<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><g>a&amp;b</g><!--c--></svg>\n';
    const doc = parse(source);
    const root = doc.nodes[doc.root]!;
    expect(source.slice(root.start, root.end)).toBe(source.slice(source.indexOf("<svg"), source.length - 1));
    const g = doc.children(doc.root)[0]!;
    expect(source.slice(doc.nodes[g]!.start, doc.nodes[g]!.end)).toBe("<g>a&amp;b</g>");
    const text = doc.nodes[doc.children(g)[0]!]!;
    if (text.kind !== "text") throw new Error("testo atteso");
    expect(text.value).toBe("a&b");
    expect(text.blank).toBe(false);
    expect(doc.top.length).toBe(4);
    expect(doc.elements).toBe(2);
  });

  it("i valori degli attributi si normalizzano come in un browser", () => {
    const svg = (value: string): string => `<svg a="${value}"/>`;
    expect(rootAttr(svg("1\r\n2\t3\n4"), "a")).toBe("1 2 3 4");
    expect(rootAttr(svg("&#10;&#x9;&lt;&amp;"), "a")).toBe("\n\t<&");
    const dtd = '<!DOCTYPE svg [<!ENTITY ns "http://www.w3.org/2000/svg"><!ENTITY e "x&#38;#38;y">]>';
    expect(rootAttr(`${dtd}<svg a="&ns;"/>`, "a")).toBe(SVG_NS);
    expect(rootAttr(`${dtd}<svg a="&e;"/>`, "a")).toBe("x&y");
  });

  it("i namespace si legano sui valori espansi", () => {
    const source = '<!DOCTYPE svg [<!ENTITY ns "http://www.w3.org/2000/svg">]><svg xmlns="&ns;"/>';
    const doc = parse(source);
    expect(doc.element(doc.root)!.ns).toBe(NS_SVG);
  });

  it("un documento malformato si rifiuta con il suo tipo", () => {
    const cases: Array<[string, XmlErrorKind]> = [
      ["", "missing-root"],
      ["<svg>", "unclosed-element"],
      ["<svg></g>", "mismatched-end-tag"],
      ["<svg/></svg>", "unmatched-end-tag"],
      ["<svg/><svg/>", "multiple-roots"],
      ["a<svg/>", "content-outside-root"],
      ["<svg/>&#32;", "content-outside-root"],
      ['<svg a="1" a="2"/>', "duplicate-attribute"],
      ['<svg xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/>', "duplicate-attribute"],
      ['<svg a="1"b="2"/>', "invalid-markup"],
      ['<svg a="<"/>', "less-than-in-attribute"],
      ['<svg a="&nope;"/>', "undeclared-entity"],
      ['<svg a="&#0;"/>', "invalid-reference"],
      ['<svg a="&#xD800;"/>', "invalid-reference"],
      ['<svg a="& b"/>', "invalid-reference"],
      ["<svg>&#1;</svg>", "invalid-reference"],
      ["<svg>\u0001</svg>", "invalid-char"],
      ["<svg>￾</svg>", "invalid-char"],
      ["<svg>]]></svg>", "cdata-end-in-text"],
      ["<svg><!-- a -- b --></svg>", "invalid-comment"],
      ["<svg><!-- a ---></svg>", "invalid-comment"],
      ["<svg><?xml x?></svg>", "misplaced-declaration"],
      ["<svg><?XML x?></svg>", "invalid-processing-instruction"],
      ["<svg><?a:b?></svg>", "invalid-processing-instruction"],
      [' <?xml version="1.0"?><svg/>', "misplaced-declaration"],
      ['<?xml encoding="UTF-8"?><svg/>', "invalid-declaration"],
      ['<?xml version="2.0"?><svg/>', "invalid-declaration"],
      ["<svg/><!DOCTYPE svg>", "misplaced-doctype"],
      ["<!doctype svg><svg/>", "invalid-doctype"],
      ["<p:svg/>", "undeclared-prefix"],
      ['<svg p:a="1"/>', "undeclared-prefix"],
      ['<svg xmlns:p=""/>', "invalid-namespace-declaration"],
      ['<svg xmlns:xmlns="u"/>', "invalid-namespace-declaration"],
      ['<svg xmlns:xml="u"/>', "invalid-namespace-declaration"],
      ['<svg a:b:c="1"/>', "invalid-name"],
      ['<svg 1a="1"/>', "invalid-name"],
      ["<svg><![CDATA[x</svg>", "unclosed-markup"],
      ["<svg/><![CDATA[x]]>", "content-outside-root"],
      ["<svg><!FOO></svg>", "invalid-markup"],
    ];
    for (const [source, kind] of cases) expect(error(source), JSON.stringify(source)).toBe(kind);
  });

  it("l'espansione delle entità ha un limite", () => {
    let dtd = '<!DOCTYPE svg [<!ENTITY a0 "xxxxxxxxxxxxxxxx">';
    for (let i = 1; i < 10; i++) dtd += `<!ENTITY a${i} "${`&a${i - 1};`.repeat(10)}">`;
    dtd += "]>";
    expect(error(`${dtd}<svg a="&a9;"/>`)).toBe("entity-limit");
    const recursive = '<!DOCTYPE svg [<!ENTITY a "&a;">]><svg b="&a;"/>';
    expect(error(recursive)).toBe("entity-limit");
  });

  it("le entità nel contenuto restano riferimenti", () => {
    const source = '<!DOCTYPE svg [<!ENTITY who "Fub">]><svg>Ciao &who;!</svg>';
    const doc = parse(source);
    const kinds = doc.children(doc.root).map((id) => {
      const node = doc.nodes[id]!;
      if (node.kind === "text") return node.value;
      if (node.kind === "entity-ref") return `&${node.name};`;
      return "?";
    });
    expect(kinds).toEqual(["Ciao ", "&who;", "!"]);
  });

  it("la testa si ferma al primo disegno", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><title>T</title><g><path/></g></svg>';
    const doc = parse(source, true);
    expect(doc.complete).toBe(false);
    expect(doc.children(doc.root).length).toBe(1);
    expect(doc.elements).toBe(2);
  });
});
