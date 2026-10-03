// La lettura di un documento: gli stessi casi di
// `crates/fub-scene/tests/read.rs`. Stato, versione, ragioni della sola
// lettura, limiti, errori, BOM e terminatori di riga, e la forma JSON della
// scena.

import { describe, expect, it } from "vitest";
import type { RootItem } from "./classify";
import type { Diagnostic } from "./diagnostics";
import { isEditable, MAX_EDIT_BYTES, MAX_ELEMENTS, readScene, ReadError } from "./read";
import { at, doc, findings, foreign, HEAD, load, text, utf16Prefix } from "./test-support";
import { utf8Length, type Span } from "./text";
import type { XmlErrorKind } from "./xml";

const FUB = "https://fubeo.github.io/ns/scene/1";

function root(attributes: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect/></svg>`;
}

/// Lo span di una diagnostica, che deve averlo.
function spanOf(diagnostic: Diagnostic): Span {
  expect(diagnostic.bytes).toBeDefined();
  return { bytes: diagnostic.bytes!, utf16: diagnostic.utf16! };
}

/// Le due coordinate di uno span, senza gli altri campi della voce.
function coordinates(span: Span): Span {
  return { bytes: span.bytes, utf16: span.utf16 };
}

/// L'errore di lettura di `source`, che deve fallire.
function readError(source: string): ReadError {
  try {
    readScene(source);
  } catch (e) {
    if (e instanceof ReadError) return e;
    throw e;
  }
  throw new Error(`doveva fallire: ${JSON.stringify(source)}`);
}

describe("la lettura di un documento (read.rs)", () => {
  it("una radice senza fub:version è estranea", () => {
    const scene = load(root(""));
    expect(scene.status).toBe("foreign");
    expect(scene.version).toBeNull();
    expect(scene.readOnly).toEqual([]);
    expect(isEditable(scene)).toBe(false);
    // Il documento estraneo si classifica comunque: «Modifica» lo adotta.
    expect(at(scene, [0])!.role).toBe("rect");
  });

  it("fub:version 1 è modificabile", () => {
    const scene = load(doc("<rect/>"));
    expect(scene.status).toBe("fubdraw");
    expect(scene.version).toBe(1);
    expect(isEditable(scene)).toBe(true);
    expect(findings(scene)).toEqual([]);
  });

  it("fub:version si trova per namespace", () => {
    expect(load(root(`xmlns:f="${FUB}" f:version="1"`)).status).toBe("fubdraw");
    // `fub:` legato a un altro URI non è FubDraw.
    expect(load(root('xmlns:fub="https://example.org/fub" fub:version="1"')).status).toBe("foreign");
    // Né lo è un `version` senza namespace.
    expect(load(root('version="1"')).status).toBe("foreign");
  });

  it("una versione futura è in sola lettura con S007", () => {
    for (const [value, detail] of [
      ["2", "2"],
      ["002", "2"],
      ["4294967296", "4294967296"],
    ] as const) {
      const scene = load(root(`xmlns:fub="${FUB}" fub:version="${value}"`));
      expect(scene.status).toBe("fubdraw");
      expect(scene.readOnly, value).toEqual(["future-version"]);
      const found = findings(scene);
      expect(found.length).toBe(1);
      const diagnostic = found[0]!;
      expect(diagnostic.code).toBe("S007");
      expect(diagnostic.severity).toBe("info");
      expect(diagnostic.bytes).toBeUndefined();
      expect(diagnostic.utf16).toBeUndefined();
      expect(diagnostic.detail).toBe(detail);
    }
  });

  it("una versione non valida è in sola lettura", () => {
    for (const value of ["", "0", "000", "1.0", " 1", "1 ", "+1", "-1", "uno", "1e0"]) {
      const scene = load(root(`xmlns:fub="${FUB}" fub:version="${value}"`));
      expect(scene.status, JSON.stringify(value)).toBe("fubdraw");
      expect(scene.readOnly, JSON.stringify(value)).toEqual(["invalid-version"]);
      expect(scene.version).toBeNull();
      expect(findings(scene)).toEqual([]);
    }
    const scene = load(root(`xmlns:fub="${FUB}" fub:version="01"`));
    expect(scene.version).toBe(1);
    expect(isEditable(scene)).toBe(true);
  });

  it("un DOCTYPE è in sola lettura con S008", () => {
    const source = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${doc("<rect/>")}`;
    const scene = load(source);
    expect(scene.readOnly).toEqual(["doctype"]);
    const s008 = scene.diagnostics.filter((d) => d.code === "S008");
    expect(s008.length).toBe(1);
    const span = spanOf(s008[0]!);
    expect(text(source, span).startsWith("<!DOCTYPE svg")).toBe(true);
    expect(text(source, span).endsWith('svg11.dtd">')).toBe(true);
    // Il DOCTYPE è anche un blocco estraneo del prologo.
    expect(coordinates(foreign(scene)[0]!)).toEqual(span);
    expect(scene.diagnostics.filter((d) => d.code === "S002").length).toBe(1);
  });

  it("una codifica dichiarata diversa da UTF-8 è in sola lettura", () => {
    for (const [encoding, readOnly] of [
      ["UTF-8", false],
      ["utf-8", false],
      ["ISO-8859-1", true],
      ["UTF-16", true],
      ["windows-1252", true],
    ] as const) {
      const source = `<?xml version="1.0" encoding="${encoding}"?>${doc("<rect/>")}`;
      const scene = load(source);
      expect(scene.readOnly.includes("encoding"), encoding).toBe(readOnly);
    }
    // Senza dichiarazione, o senza codifica, è UTF-8.
    const scene = load(`<?xml version="1.0"?>${doc("")}`);
    expect(isEditable(scene)).toBe(true);
  });

  it("gli id ripetuti sono in sola lettura con S003", () => {
    const source = doc(
      '<rect id="a"/><g id="b"><circle id="a" r="1"/></g>' +
        '<use id="b" href="x.svg"/><x:e xmlns:x="https://example.org" id="a"/>' +
        '<rect id=""/><rect id=""/><rect x:id="c" xmlns:x="https://example.org"/><rect id="c"/>',
    );
    const scene = load(source);
    expect(scene.readOnly).toEqual(["duplicate-id"]);
    const s003 = scene.diagnostics.filter((d) => d.code === "S003");
    const found = s003.map((d) => [d.detail, text(source, spanOf(d))]);
    expect(found).toEqual([
      ["a", '<circle id="a" r="1"/>'],
      ["b", '<use id="b" href="x.svg"/>'],
      ["a", '<x:e xmlns:x="https://example.org" id="a"/>'],
    ]);
    expect(s003.every((d) => d.severity === "error")).toBe(true);
  });

  it("il limite degli elementi è incluso", () => {
    // La radice conta: `MAX_ELEMENTS` elementi in tutto sono ancora
    // modificabili, uno in più no.
    const fill = (n: number): string => doc("<rect/>".repeat(n - 1));
    expect(isEditable(load(fill(MAX_ELEMENTS)))).toBe(true);
    const scene = load(fill(MAX_ELEMENTS + 1));
    expect(scene.readOnly).toEqual(["too-many-elements"]);
    expect(scene.items).toEqual([]);
  }, 60_000);

  it("di un file oltre il limite di dimensione si legge solo la testa", () => {
    const whole = doc('<title>Grande</title><desc>d</desc><g fub:layer="Uno">');
    expect(whole.endsWith("</svg>")).toBe(true);
    const head = whole.slice(0, -"</svg>".length);
    // Dopo la testa, contenuto che non si guarda: anche malformato.
    const filler = "<!-- riempitivo -->".repeat(Math.floor(MAX_EDIT_BYTES / 19) + 1);
    const source = `${head}${filler}<rect></g></svg>`;
    expect(utf8Length(source)).toBeGreaterThan(MAX_EDIT_BYTES);
    const scene = load(source);
    expect(scene.truncated).toBe(true);
    expect(scene.readOnly).toEqual(["too-large"]);
    expect(scene.items).toEqual([]);
    expect(scene.status).toBe("fubdraw");
    // Una testa malformata resta un errore.
    const malformed = `<svg xmlns="http://www.w3.org/2000/svg"><title>a</titolo>${filler}</svg>`;
    expect(readError(malformed).kind).toBe("malformed");
  }, 60_000);

  it("un file al limite di dimensione si legge intero", () => {
    const empty = doc("");
    const source = `${HEAD}${" ".repeat(MAX_EDIT_BYTES - utf8Length(empty))}</svg>`;
    expect(utf8Length(source)).toBe(MAX_EDIT_BYTES);
    const scene = load(source);
    expect(scene.truncated).toBe(false);
    expect(isEditable(scene)).toBe(true);
  }, 60_000);

  it("una radice che non è svg è un errore", () => {
    for (const [source, offset] of [
      ["<html/>", 0],
      ["<svg/>", 0],
      ['﻿<?xml version="1.0"?>\n<svg xmlns="https://example.org"/>', 25],
    ] as const) {
      const error = readError(source);
      expect(error.kind, source).toBe("not-svg");
      expect(error.offset, source).toBe(offset);
      expect(error.xml).toBeNull();
    }
    // Un prefisso legato a SVG è SVG.
    const scene = readScene('<s:svg xmlns:s="http://www.w3.org/2000/svg"/>');
    expect(scene.status).toBe("foreign");
  });

  it("l'XML malformato è un errore al byte giusto", () => {
    const cases: Array<[string, number, XmlErrorKind]> = [
      ["", 0, "missing-root"],
      ['<svg xmlns="http://www.w3.org/2000/svg">', 0, "unclosed-element"],
      ['﻿<svg xmlns="http://www.w3.org/2000/svg">', 3, "unclosed-element"],
      ["<svg><g></svg>", 8, "mismatched-end-tag"],
      ["<svg/><svg/>", 6, "multiple-roots"],
      ['<svg a="1" a="2"/>', 11, "duplicate-attribute"],
      ['<svg a="<"/>', 8, "less-than-in-attribute"],
      ["<svg>&nessuna;</svg>", 5, "undeclared-entity"],
      ["<svg><p:g/></svg>", 6, "undeclared-prefix"],
      ["﻿<svg><!-- a -- b --></svg>", 15, "invalid-comment"],
      ["<svg/>testo", 6, "content-outside-root"],
      [' <?xml version="1.0"?><svg/>', 1, "misplaced-declaration"],
      ["<svg>]]></svg>", 5, "cdata-end-in-text"],
    ];
    for (const [source, offset, kind] of cases) {
      const error = readError(source);
      expect([error.kind, error.offset, error.xml], JSON.stringify(source)).toEqual(["malformed", offset, kind]);
    }
  });

  it("il BOM resta e conta", () => {
    const source = `﻿${doc("\n  <rect/>")}`;
    const scene = load(source);
    expect(scene.bom).toBe(true);
    const first = scene.items[0]!;
    expect(first.kind, "la prima voce è la radice").toBe("root");
    const rootItem = first as RootItem;
    expect(rootItem.bytes[0]).toBe(3);
    expect(rootItem.utf16[0]).toBe(1);
    const rect = at(scene, [0])!;
    expect(text(source, rect)).toBe("<rect/>");
    expect(rect.indent).toBe("  ");
    // Il BOM vale una unità UTF-16, come nel testo che la sessione valida.
    expect(rect.utf16[0]).toBe(rect.bytes[0] - 2);
  });

  it("gli span UTF-16 saltano i ritorni a capo dei CRLF", () => {
    const source = `${HEAD}\r\n  <title>è 🎨</title>\r\n  <rect/>\r</svg>`;
    const scene = load(source);
    expect(scene.lineEnding).toBe("mixed");
    expect(scene.lineBreak).toBe("crlf");
    const prefix = utf16Prefix(source);
    const rect = at(scene, [1])!;
    expect(rect.utf16[0]).toBe(prefix[rect.bytes[0]]);
    // `è` è un'unità e due byte, 🎨 due unità e quattro byte, e ogni CRLF
    // conta una unità.
    const title = at(scene, [0])!;
    const length = title.bytes[1] - title.bytes[0];
    expect(title.utf16[1] - title.utf16[0]).toBe(length - 1 - 2);
  });

  it("i terminatori di riga si riportano", () => {
    for (const [source, ending, lineBreak] of [
      [doc("\n<rect/>\n"), "lf", "lf"],
      [doc("\r\n<rect/>\r\n"), "crlf", "crlf"],
      [doc("\r<rect/>\r"), "cr", "cr"],
      [doc("<rect/>"), "lf", "lf"],
      [doc("\r\n<rect/>\n\n"), "mixed", "lf"],
      [doc("\r\n<rect/>\n"), "mixed", "crlf"],
    ] as const) {
      const scene = load(source);
      expect([scene.lineEnding, scene.lineBreak], JSON.stringify(source)).toEqual([ending, lineBreak]);
    }
  });

  it("ogni blocco estraneo è un S002", () => {
    const source = `<!-- a -->${doc("<rect/><use/><circle/><!-- b -->")}`;
    const scene = load(source);
    const blocks = foreign(scene);
    expect(blocks.length).toBe(3);
    const s002 = scene.diagnostics.filter((d) => d.code === "S002");
    expect(s002.length).toBe(3);
    s002.forEach((diagnostic, i) => {
      expect(spanOf(diagnostic)).toEqual(coordinates(blocks[i]!));
      expect(diagnostic.severity).toBe("info");
    });
    expect(findings(load(doc("<rect/>")))).toEqual([]);
  });

  it("le ragioni della sola lettura e la diagnostica sono in ordine", () => {
    const source =
      '<?xml version="1.0" encoding="latin1"?><!DOCTYPE svg>' +
      root(`xmlns:fub="${FUB}" fub:version="3" id="a"><g id="a"/><rect id="a"/`);
    const scene = load(source);
    expect(scene.readOnly).toEqual(["doctype", "encoding", "future-version", "duplicate-id"]);
    expect(scene.diagnostics.map((d) => d.code)).toEqual(["S001", "S002", "S003", "S003", "S007", "S008"]);
  });

  it("la scena si serializza nella forma documentata", () => {
    const source = `﻿${doc('<g fub:layer="Uno" id="l1"><use/></g>')}`;
    const value = JSON.parse(JSON.stringify(load(source)));
    expect(value.status).toBe("fubdraw");
    expect(value.readOnly).toEqual([]);
    expect(value.version).toBe(1);
    expect(value.bom).toBe(true);
    expect(value.lineEnding).toBe("lf");
    expect(value.lineBreak).toBe("lf");
    expect(value.truncated).toBe(false);
    const items = value.items;
    expect(items[0].kind).toBe("root");
    expect(Array.isArray(items[0].bytes) && Array.isArray(items[0].utf16)).toBe(true);
    expect(Array.isArray(items[0].tags.open.bytes)).toBe(true);
    const layer = items[1];
    expect(layer.kind).toBe("element");
    expect(layer.path).toEqual([0]);
    expect(layer.tag).toBe("g");
    expect(layer.role).toBe("layer");
    expect(layer.id).toBe("l1");
    expect(layer.layer).toEqual({ name: "Uno", locked: false, hidden: false });
    expect(layer.indent).toBe("");
    expect("stroke" in layer || "lines" in layer).toBe(false);
    const block = items[2];
    expect(block.kind).toBe("foreign");
    expect(block.parentPath).toEqual([0]);
    expect(block.elements).toEqual([0, 1]);
    // S001 riguarda il documento intero: niente span.
    let diagnostic = value.diagnostics[0];
    expect(diagnostic.code).toBe("S001");
    expect(diagnostic.severity).toBe("warning");
    expect("bytes" in diagnostic || "utf16" in diagnostic).toBe(false);
    diagnostic = value.diagnostics[1];
    expect(diagnostic.code).toBe("S002");
    expect(diagnostic.severity).toBe("info");
    expect(diagnostic.bytes).toEqual(block.bytes);
    expect("detail" in diagnostic).toBe(false);
    expect(value.index).toEqual({ title: null, desc: null, texts: [], links: [], embeds: [] });
    expect(value.summary).toEqual({
      version: 1,
      foreign: false,
      truncated: false,
      layers: ["Uno"],
      counts: { strokes: 0, shapes: 0, texts: 0, images: 0, links: 0, foreign: 1 },
      ink: { samples: 0, duration: 0 },
      bbox: null,
    });
  });

  it("i documenti in sola lettura si classificano comunque", () => {
    const source = `<!DOCTYPE svg>${doc("<rect/><use/>")}`;
    const scene = load(source);
    expect(isEditable(scene)).toBe(false);
    expect(at(scene, [0])!.role).toBe("rect");
    expect(foreign(scene).length).toBe(2);
  });
});
