// La diagnostica di §12: per ogni codice un caso che la produce e uno che non
// la produce, con la gravità della tabella. Sono i casi di
// `crates/fub-scene/tests/diagnostics.rs`, uno per uno.

import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "./analysis";
import { CODE_MESSAGES, severityOf, type Code, type Diagnostic, type Severity } from "./diagnostics";
import { isEditable, readScene, ReadError, type Scene } from "./read";
import { doc, load, text } from "./test-support";
import type { Span } from "./text";

/// Le diagnostiche di `scene` con il codice `code`.
function of(scene: Scene, code: Code): Diagnostic[] {
  return scene.diagnostics.filter((d) => d.code === code);
}

/// I dettagli delle diagnostiche con il codice `code`.
function details(scene: Scene, code: Code): string[] {
  return of(scene, code).map((d) => d.detail ?? "");
}

/// Lo span di una diagnostica, che deve averlo.
function spanOf(diagnostic: Diagnostic): Span {
  if (diagnostic.bytes === undefined || diagnostic.utf16 === undefined) throw new Error("una diagnostica senza span");
  return { bytes: diagnostic.bytes, utf16: diagnostic.utf16 };
}

/// Un documento FubDraw col titolo, così S001 non c'entra.
function titled(body: string): string {
  return doc(`<title>Prova</title>${body}`);
}

/// Una scena con la carta di colore `paper` e `body` nel livello.
function onPaper(paper: string, body: string): Scene {
  return load(
    titled(`<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="${paper}"/><g fub:layer="A">${body}</g>`),
  );
}

/// Un tratto con lo strumento e gli attributi dati.
function stroke(tool: string, attributes: string): string {
  return `<path fub:tool="${tool}" fub:brush="pf1" fub:ink="1 s10 cxy 0,0" d="M0 0 L1 1 L0 1 Z" ${attributes}/>`;
}

describe("la diagnostica (§12)", () => {
  it("S001: un disegno senza titolo", () => {
    // Senza `title`, con un titolo vuoto o di soli spazi e commenti, con il
    // titolo di un gruppo invece che della radice, o di un altro namespace.
    const cases: Array<[string, boolean]> = [
      ["<rect/>", false],
      ["<title/>", true],
      ["<title> \n\t</title>", true],
      ["<title><!-- da scrivere --></title>", true],
      ['<g fub:layer="A"><title>Livello</title></g>', false],
      ['<x:title xmlns:x="https://example.org">Altro</x:title>', false],
    ];
    for (const [body, onTitle] of cases) {
      const source = doc(body);
      const found = of(load(source), "S001");
      expect(found, body).toHaveLength(1);
      expect(found[0]!.severity).toBe("warning");
      if (found[0]!.bytes !== undefined) {
        expect(onTitle, body).toBe(true);
        expect(text(source, spanOf(found[0]!)).startsWith("<title")).toBe(true);
      } else {
        expect(onTitle, body).toBe(false);
      }
    }
    // Un titolo con del testo, anche in CDATA o con un'entità, e anche dopo
    // altri figli della radice.
    for (const body of [
      "<title>Ciclo dell'acqua</title>",
      "<title><![CDATA[Acqua]]></title>",
      "<title>&amp;</title>",
      "<desc>prima</desc><rect/><title>Dopo</title>",
    ]) {
      expect(of(load(doc(body)), "S001"), body).toEqual([]);
    }
  });

  it("S002: i blocchi estranei", () => {
    const source = titled('<rect/><use href="#a"/><!-- nota -->');
    const found = of(load(source), "S002");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("info");
    expect(text(source, spanOf(found[0]!))).toBe('<use href="#a"/><!-- nota -->');
    expect(of(load(titled("<rect/>")), "S002")).toEqual([]);
  });

  it("S003: id duplicati", () => {
    let scene = load(titled('<rect id="a"/><circle id="a"/>'));
    const found = of(scene, "S003");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.detail).toBe("a");
    expect(isEditable(scene)).toBe(false);
    // Id diversi, o vuoti, non sono duplicati.
    scene = load(titled('<rect id="a"/><circle id="b"/><use id=""/><use id=""/>'));
    expect(of(scene, "S003")).toEqual([]);
  });

  it("S004: inchiostro o pennello che non si leggono", () => {
    const inked = (ink: string): string =>
      titled(`<path fub:tool="pen" fub:brush="pf1" fub:ink="${ink}" d="" fill="#000000"/>`);
    const scene = load(inked("1 s100 cxy 0,0 1"));
    const found = of(scene, "S004");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.detail).toBe("fub:ink arity 1");
    expect(isEditable(scene)).toBe(true);
    expect(of(load(inked("1 s100 cxy 0,0 1,1")), "S004")).toEqual([]);
  });

  it("S005: contenuto attivo", () => {
    const source = titled(
      "<script>alert(1)</script>" +
        '<rect onclick="alert(1)" width="1" height="1"/>' +
        '<a href=" JavaScript:alert(1)"><circle r="1"/></a>' +
        '<image xlink:href="java&#9;script:x"/>' +
        '<a href="note.md"><set attributeName="href" to="javascript:alert(1)"/></a>' +
        '<animate attributeName="xlink:href" values="a.md;javascript:x"/>' +
        '<foreignObject><p xmlns="http://www.w3.org/1999/xhtml" onmouseover="x()">' +
        "<script>x()</script></p></foreignObject>",
    ).replace("<svg ", '<svg onload="init()" ');
    let scene = load(source);
    expect(details(scene, "S005")).toEqual([
      "onload",
      "script",
      "onclick",
      "href",
      "xlink:href",
      "to",
      "values",
      "onmouseover",
      "script",
    ]);
    const found = of(scene, "S005");
    expect(found.every((d) => d.severity === "warning")).toBe(true);
    expect(text(source, spanOf(found[1]!)).startsWith("<script>")).toBe(true);
    // Né un percorso che somiglia allo schema, né un attributo di un altro
    // namespace, né uno `script` che non è HTML o SVG, né un'animazione di
    // un altro attributo, né il testo di un `text`.
    scene = load(
      titled(
        '<a href="javascript.md"><rect fub:onclick="x" width="1" height="1"/></a>' +
          '<x:script xmlns:x="https://example.org">x()</x:script>' +
          '<set attributeName="fill" to="javascript:x"/>' +
          '<text x="0" y="0"><tspan x="0" dy="0">javascript:alert(1)</tspan></text>',
      ),
    );
    expect(of(scene, "S005")).toEqual([]);
  });

  it("S006: un'immagine incorporata oltre il limite", () => {
    // Ogni quattro simboli base64 sono tre byte: `n` simboli più un `=`
    // valgono `n · 3 / 4` byte, arrotondati per difetto.
    const image = (symbols: number): string =>
      titled(`<image width="1" height="1" href="data:image/png;base64,${"A".repeat(symbols)}="/>`);
    const atLimit = Math.floor((MAX_IMAGE_BYTES * 4) / 3) + 1;
    expect(Math.floor((atLimit * 3) / 4)).toBe(MAX_IMAGE_BYTES);
    expect(of(load(image(atLimit)), "S006")).toEqual([]);
    let scene = load(image(atLimit + 4));
    const found = of(scene, "S006");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("warning");
    expect(found[0]!.detail).toBe(String(MAX_IMAGE_BYTES + 3));
    // Un'immagine del vault non è incorporata.
    scene = load(titled('<image width="1" height="1" href="foto.png"/>'));
    expect(of(scene, "S006")).toEqual([]);
  });

  it("S007: un formato più recente", () => {
    const newer = titled("").replace('fub:version="1"', 'fub:version="2"');
    const scene = load(newer);
    const found = of(scene, "S007");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("info");
    expect(isEditable(scene)).toBe(false);
    expect(of(load(titled("")), "S007")).toEqual([]);
  });

  it("S008: un DOCTYPE", () => {
    const source = `<!DOCTYPE svg>${titled("")}`;
    const found = of(load(source), "S008");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("info");
    expect(text(source, spanOf(found[0]!))).toBe("<!DOCTYPE svg>");
    expect(of(load(titled("")), "S008")).toEqual([]);
  });

  it("S009: un tratto di penna che sparisce nella carta", () => {
    // I tre colori di DEC-13 sotto 3:1 sulla carta bianca, il nero quasi
    // trasparente, un'opacità di gruppo, un colore ereditato dal livello e
    // un tratto nero sulla carta nera.
    const fading: Array<[string, string, string]> = [
      ["#ffffff", stroke("pen", 'fill="#f0e442"'), "1.32"],
      ["#ffffff", stroke("pen", 'fill="#e69f00"'), "2.25"],
      ["#ffffff", stroke("pen", 'fill="#56b4e9"'), "2.30"],
      ["#ffffff", stroke("pen", 'fill="#000000" fill-opacity="0.1"'), "1.24"],
      ["#ffffff", `<g opacity="0.2">${stroke("pen", "")}</g>`, "1.60"],
      ["#ffffff", `<g fill="yellow">${stroke("pen", "")}</g>`, "1.07"],
      ["#000000", stroke("pen", ""), "1.00"],
    ];
    for (const [paper, body, detail] of fading) {
      const found = of(onPaper(paper, body), "S009");
      expect(found, body).toHaveLength(1);
      expect(found[0]!.severity).toBe("info");
      expect(found[0]!.detail, body).toBe(detail);
    }
    // I colori scuri della tavolozza, il bianco sulla carta nera,
    // l'evidenziatore giallo, una forma gialla e un tratto senza
    // riempimento: niente S009.
    const visible: Array<[string, string]> = [
      ["#ffffff", stroke("pen", 'fill="#0072b2"')],
      ["#ffffff", stroke("pen", 'fill="#cc79a7"')],
      ["#ffffff", stroke("pen", "")],
      ["#000000", stroke("pen", 'fill="#ffffff"')],
      ["#ffffff", stroke("highlighter", 'fill="#f0e442" fill-opacity="0.4"')],
      ["#ffffff", '<rect width="10" height="10" fill="#f0e442"/>'],
      ["#ffffff", stroke("pen", 'fill="none"')],
    ];
    for (const [paper, body] of visible) {
      expect(of(onPaper(paper, body), "S009"), body).toEqual([]);
    }
    // Senza carta il tratto sta sul bianco.
    expect(details(load(titled(stroke("pen", 'fill="#f0e442"'))), "S009")).toEqual(["1.32"]);
  });

  it("S010: canali d'inchiostro sconosciuti", () => {
    const ink = (channels: string): string =>
      titled(`<path fub:tool="pen" fub:brush="pf1" fub:ink="1 s10 c${channels} 0,0,0" d="" fill="#000000"/>`);
    const found = of(load(ink("xyk")), "S010");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("info");
    expect(found[0]!.detail).toBe("k");
    expect(of(load(ink("xyp")), "S010")).toEqual([]);
  });

  it("ogni codice ha la sua gravità e un messaggio", () => {
    const table: Array<[Code, Severity]> = [
      ["S001", "warning"],
      ["S002", "info"],
      ["S003", "error"],
      ["S004", "error"],
      ["S005", "warning"],
      ["S006", "warning"],
      ["S007", "info"],
      ["S008", "info"],
      ["S009", "info"],
      ["S010", "info"],
    ];
    for (const [code, severity] of table) {
      expect(severityOf(code), code).toBe(severity);
      expect(CODE_MESSAGES[code], code).not.toBe("");
    }
    // Un documento malformato non ha diagnostica: è un errore.
    expect(() => readScene("<svg")).toThrow(ReadError);
  });
});
