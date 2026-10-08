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

/// Un testo di una riga, con gli attributi dati sul `text`.
function label(attributes: string, line: string): string {
  return `<text x="20" y="50" ${attributes}><tspan x="20" dy="0">${line}</tspan></text>`;
}

/// Le risorse dei casi di S017: una sfumatura, un motivo, un ritaglio, un
/// filtro, una maschera e un campione verde.
const KEY_RESOURCES =
  '<defs id="fub-defs">' +
  '<linearGradient id="r00000001" fub:role="private"><stop offset="0" stop-color="#a6cee3"/><stop offset="1" stop-color="#b2df8a"/></linearGradient>' +
  '<pattern id="r00000002" fub:role="shared" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="8" height="4" fill="#000000"/></pattern>' +
  '<clipPath id="r00000003" fub:role="private" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>' +
  '<filter id="r00000004" fub:role="shared"><feDropShadow dx="0" dy="2" stdDeviation="2"/></filter>' +
  '<linearGradient id="r00000005" fub:role="swatch" fub:name="Verde" gradientUnits="userSpaceOnUse"><stop stop-color="#b2df8a"/></linearGradient>' +
  '<mask id="r00000006" fub:role="private" maskContentUnits="objectBoundingBox"><rect x="0" y="0" width="1" height="1" fill="#ffffff"/></mask>' +
  "</defs>";

/// Un disegno con la carta di colore `paper`, le risorse di S017 e `body` nel
/// livello.
function key(paper: string, body: string): string {
  return titled(
    `${KEY_RESOURCES}<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="${paper}"/><g fub:layer="A">${body}</g>`,
  );
}

/// Un riquadro pieno, con gli attributi dati.
function tile(x: number, attributes: string): string {
  return `<rect x="${x}" y="0" width="10" height="10" ${attributes}/>`;
}

/// Un riquadro pieno del colore `color`.
function tint(x: number, color: string): string {
  return tile(x, `fill="${color}"`);
}

/// Riquadri pieni dei colori dati, uno ogni 20 unità.
function tints(colors: readonly string[]): string {
  return colors.map((color, at) => tint(at * 20, color)).join("");
}

/// Quanti rettangoli modificabili ha `scene`: i casi che non devono contare
/// come aree lo sono lo stesso, e non mancano per un riferimento rotto.
function rects(scene: Scene): number {
  return scene.items.filter((item) => item.kind === "element" && item.role === "rect").length;
}

/// I dettagli di S017 su `body` sulla carta bianca.
function confusions(body: string): string[] {
  return details(load(key("#ffffff", body)), "S017");
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
    // I tre colori chiari della tavolozza sotto 3:1 sulla carta bianca, il
    // nero quasi trasparente, un'opacità di gruppo, un colore ereditato dal
    // livello e un tratto nero sulla carta nera.
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

  it("S009: un testo che sparisce in ciò che ha sotto", () => {
    // Un testo normale vuole 4,5:1: il verde della tavolozza ne ha 3,42
    // sul bianco, il nero sul blu 4,04. Il fondo è la carta con sopra le
    // forme piene che coprono l'inizio della riga, composte con le loro
    // opacità, e un testo bianco sul bianco non si legge.
    const blackBox = '<rect x="0" y="0" width="100" height="100" fill="#000000"/>';
    const blueBox = '<rect x="0" y="0" width="100" height="100" fill="#0072b2"/>';
    const fading: Array<[string, string]> = [
      [label('fill="#f0e442"', "Sole"), "1.32"],
      [label('fill="#009e73"', "Prato"), "3.42"],
      [`${blueBox}${label("", "Mare")}`, "4.04"],
      [label('fill="#ffffff"', "Neve"), "1.00"],
      // Un rettangolo nero a metà: il fondo è grigio, e il bianco ci sta
      // sotto 4,5:1.
      [`<rect width="100" height="100" fill="#000000" opacity="0.5"/>${label('fill="#ffffff"', "Nebbia")}`, "3.94"],
      // Una forma dipinta dopo il testo gli sta sopra, non sotto.
      [`${label('fill="#ffffff"', "Sotto")}${blackBox}`, "1.00"],
      // Il colore di una riga vince su quello del testo; conta la riga
      // peggiore.
      [
        '<text x="20" y="50"><tspan x="20" dy="0">Uno</tspan><tspan x="20" dy="20" fill="#f0e442">Due</tspan></text>',
        "1.32",
      ],
      // Così un pezzo della riga col suo colore; uno vuoto non si legge.
      [
        '<text x="20" y="50"><tspan x="20" dy="0">Uno <tspan fill="#f0e442">due</tspan><tspan fill="#ffffff"> </tspan></tspan></text>',
        "1.32",
      ],
      // Il verde vuole 4,5:1 nel pezzo piccolo, anche se la riga è grande.
      [
        '<text x="20" y="50" fill="#009e73"><tspan x="20" dy="0" font-size="30">Grande <tspan font-size="12">piccolo</tspan></tspan></text>',
        "3.42",
      ],
      // Fuori dall'ellisse, anche se dentro il suo rettangolo.
      [
        '<ellipse cx="60" cy="60" rx="60" ry="60" fill="#000000"/>'
        + '<text x="5" y="10" fill="#ffffff"><tspan x="5" dy="0">Angolo</tspan></text>',
        "1.00",
      ],
    ];
    for (const [body, detail] of fading) {
      const found = of(onPaper("#ffffff", body), "S009");
      expect(found, body).toHaveLength(1);
      expect(found[0]!.severity).toBe("info");
      expect(found[0]!.detail, body).toBe(detail);
    }
    for (const body of [
      // Il nero sul bianco, il blu della tavolozza (5,19:1), il bianco sul
      // nero di un rettangolo, di un'ellisse, di un poligono, di un
      // tracciato con le curve e di un rettangolo arrotondato.
      label("", "Nero"),
      label('fill="#0072b2"', "Blu"),
      `${blackBox}${label('fill="#ffffff"', "Notte")}`,
      `<ellipse cx="50" cy="50" rx="45" ry="30" fill="#000000"/>${label('fill="#ffffff"', "Uovo")}`,
      '<polygon points="0 0 100 0 100 100" fill="#000000"/><text x="80" y="40" fill="#ffffff"><tspan x="80" dy="0">Vela</tspan></text>',
      '<path d="M0 0 C50 -20 150 20 100 0 Q120 50 100 100 A50 50 0 0 1 0 100 Z" fill="#000000"/>'
      + label('fill="#ffffff"', "Onda"),
      `<rect width="100" height="100" rx="30" fill="#000000"/>${label('fill="#ffffff"', "Tondo")}`,
      // Un testo grande vuole 3:1: 24 px, 19 px in grassetto, 12 px in un
      // gruppo che raddoppia.
      label('fill="#009e73" font-size="24"', "Titolo"),
      label('fill="#009e73" font-size="19" font-weight="bold"', "Forte"),
      `<g transform="scale(2)" font-size="12">${label('fill="#009e73"', "Grande")}</g>`,
      // Sopra un'immagine il fondo non si sa, finché una forma opaca non la
      // copre.
      `<image x="0" y="0" width="100" height="100" href="foto.png" aria-hidden="true"/>${label('fill="#ffffff"', "Foto")}`,
      // Nascosto, senza riempimento, o di righe vuote: non si legge.
      label('fill="#ffffff" display="none"', "Via"),
      label('fill="none"', "Vuoto"),
      label('fill="#ffffff"', " "),
      // Un pezzo grande, o in grassetto e abbastanza grande, vuole 3:1.
      label("", 'Nero <tspan fill="#009e73" font-size="24">titolo</tspan><tspan fill="#009e73" font-size="19" font-weight="bold">forte</tspan>'),
      // Un pezzo nascosto o senza riempimento non si legge.
      label("", 'Nero <tspan fill="#ffffff" display="none">via</tspan><tspan fill="none">vuoto</tspan>'),
    ]) {
      expect(of(onPaper("#ffffff", body), "S009"), body).toEqual([]);
    }
    // Un'immagine coperta da una forma opaca: il fondo torna a sapersi.
    const covered = onPaper(
      "#ffffff",
      `<image x="0" y="0" width="100" height="100" href="foto.png" aria-hidden="true"/>${blackBox}`
        + label('fill="#000000"', "Buio"),
    );
    expect(details(covered, "S009")).toEqual(["1.00"]);
    // Il grassetto a 18 px non è ancora grande.
    const almost = onPaper("#ffffff", label('fill="#009e73" font-size="18" font-weight="700"', "Quasi"));
    expect(details(almost, "S009")).toEqual(["3.42"]);
  });

  it("S009 e S013: un testo su tracciato si guarda dove comincia, dalla parte dei caratteri", () => {
    // Il tracciato va da sinistra a destra a metà altezza, o al contrario; il
    // rettangolo nero copre la metà di sopra.
    const scene = (d: string, attributes: string, offset = "50%"): Scene =>
      load(
        titled(
          `<defs><path id="r1" d="${d}"/></defs><rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#ffffff"/>`
            + `<g fub:layer="A"><rect width="100" height="50" fill="#000000"/>`
            + `<text ${attributes}><textPath href="#r1" startOffset="${offset}">Onda</textPath></text></g>`,
        ),
      );
    const right = "M0 50 L100 50";
    const left = "M100 50 L0 50";
    expect(details(scene(right, 'fill="#ffffff"'), "S009")).toEqual([]);
    expect(details(scene(left, 'fill="#ffffff"'), "S009")).toEqual(["1.00"]);
    expect(details(scene(left, 'fill="#000000"'), "S009")).toEqual([]);
    expect(details(scene(right, 'fill="#000000"'), "S009")).toEqual(["1.00"]);
    // Una curva: a metà va verso destra, e il punto sta sopra.
    expect(details(scene("M0 60 Q50 40 100 60", 'fill="#ffffff"'), "S009")).toEqual([]);
    // Oltre la fine si ferma all'estremo; un tracciato lungo zero non si
    // guarda.
    expect(details(scene("M0 50 L60 50", 'fill="#ffffff"', "500"), "S009")).toEqual([]);
    expect(details(scene("M0 50 L60 50 L60 100", 'fill="#ffffff"', "500"), "S009")).toEqual(["1.00"]);
    expect(details(scene("M50 50 L50 50", 'fill="#ffffff"'), "S009")).toEqual([]);
    // Il corpo conta come per le righe.
    expect(details(scene(right, 'fill="#ffffff" font-size="9"'), "S013")).toEqual(["9.00"]);
    expect(details(scene(right, 'fill="#ffffff" font-size="12"'), "S013")).toEqual([]);
  });

  it("S009: un tratto di penna si misura su ciò che ha sotto", () => {
    // Il bianco su un rettangolo nero si legge; a cavallo del bordo conta il
    // contrasto mediano, quello della parte più lunga.
    const pen = (d: string): string =>
      `<path fub:tool="pen" fub:brush="pf1" fub:ink="1 s10 cxy 0,0" d="${d}" fill="#ffffff"/>`;
    const blackBox = '<rect x="0" y="0" width="50" height="100" fill="#000000"/>';
    expect(of(onPaper("#ffffff", blackBox + pen("M10 10 L20 20 L10 20 Z")), "S009")).toEqual([]);
    // Tre vertici su cinque fuori dal rettangolo: la mediana sta sul bianco.
    const across = onPaper("#ffffff", blackBox + pen("M40 10 L60 10 L70 20 L80 30 L40 30 Z"));
    expect(details(across, "S009")).toEqual(["1.00"]);
    // Tre su cinque dentro: la mediana sta sul nero.
    expect(of(onPaper("#ffffff", blackBox + pen("M10 10 L20 10 L30 20 L80 30 L60 30 Z")), "S009")).toEqual([]);
    // Un tratto senza geometria non si vede, e non si misura.
    expect(of(onPaper("#ffffff", pen("")), "S009")).toEqual([]);
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

  it("S011: unità o guide fuori grammatica", () => {
    const root = (attributes: string): string => titled("").replace('fub:version="1"', `fub:version="1" ${attributes}`);
    const scene = load(root('fub:guides="x 1;" fub:units="MM"'));
    const found = of(scene, "S011");
    expect(found).toHaveLength(2);
    expect(found.every((d) => d.severity === "info" && d.bytes === undefined)).toBe(true);
    // Prima l'unità, poi le guide, come in Rust.
    expect(details(scene, "S011")).toEqual(["fub:units", "fub:guides"]);
    // Il documento resta modificabile: si ignorano soltanto.
    expect(isEditable(scene)).toBe(true);
    for (const valid of ['fub:units="mm" fub:guides="x 1; y 2 locked"', 'fub:guides=""', ""]) {
      expect(of(load(root(valid)), "S011"), valid).toEqual([]);
    }
  });

  it("S012: un'immagine senza descrizione", () => {
    const image = (attributes: string, children: string): string => {
      const tag = '<image x="0" y="0" width="10" height="10" href="foto.png"';
      return titled(children === "" ? `${tag} ${attributes}/>` : `${tag} ${attributes}>${children}</image>`);
    };
    for (const source of [
      image("", ""),
      image("", "<title> </title>"),
      image('aria-hidden="false"', ""),
      // Anche un'immagine incorporata.
      titled('<image width="1" height="1" href="data:image/png;base64,iVBORw0KGgo="/>'),
    ]) {
      const found = of(load(source), "S012");
      expect(found, source).toHaveLength(1);
      expect(found[0]!.severity).toBe("warning");
      expect(text(source, spanOf(found[0]!)).startsWith("<image"), source).toBe(true);
    }
    for (const source of [
      image("", "<title>Il porto</title>"),
      image("", "<desc>Barche ormeggiate al tramonto</desc>"),
      image('aria-hidden="true"', ""),
      image('display="none"', ""),
    ]) {
      expect(of(load(source), "S012"), source).toEqual([]);
    }
    // `aria-hidden` vale solo `true` o `false`: altrimenti l'immagine è
    // estranea, e la superficie non la descrive.
    const scene = load(image('aria-hidden="forse"', ""));
    expect(of(scene, "S012")).toEqual([]);
    expect(of(scene, "S002")).toHaveLength(1);
  });

  it("S013: un testo troppo piccolo a grandezza naturale", () => {
    const small: Array<[string, string]> = [
      [label('font-size="11"', "Nota"), "11.00"],
      [label('font-size="8pt"', "Punti"), "10.66"],
      [`<g font-size="10">${label("", "Eredita")}</g>`, "10.00"],
      [`<g transform="scale(0.5)">${label('font-size="20"', "Ridotto")}</g>`, "10.00"],
      // Conta l'altezza: schiacciato in verticale si legge piccolo.
      [`<g transform="scale(1 0.5)">${label('font-size="20"', "Schiacciato")}</g>`, "10.00"],
      // La riga più piccola.
      [
        '<text x="0" y="20"><tspan x="0" dy="0">Grande</tspan><tspan x="0" dy="20" font-size="9">piccolo</tspan></text>',
        "9.00",
      ],
      // E il pezzo più piccolo di una riga.
      [label('font-size="20"', 'Grande <tspan font-size="10.5">piccolo</tspan>'), "10.50"],
    ];
    for (const [body, detail] of small) {
      const found = of(load(titled(body)), "S013");
      expect(found, body).toHaveLength(1);
      expect(found[0]!.severity).toBe("info");
      expect(found[0]!.detail, body).toBe(detail);
    }
    for (const body of [
      label('font-size="12"', "Giusto"),
      label("", "Di serie"),
      `<g transform="rotate(90)">${label('font-size="16"', "Ruotato")}</g>`,
      `<g transform="scale(2)">${label('font-size="8"', "Ingrandito")}</g>`,
      label('font-size="9" display="none"', "Nascosto"),
      label('font-size="9"', "  "),
      // Un pezzo piccolo nascosto o vuoto non conta.
      label("", 'Testo <tspan font-size="9" display="none">via</tspan><tspan font-size="9"> </tspan>'),
    ]) {
      expect(of(load(titled(body)), "S013"), body).toEqual([]);
    }
    // Una grandezza della radice che §4 non legge non dice niente.
    const source = titled(label("", "Em")).replace('fub:version="1"', 'fub:version="1" font-size="0.5em"');
    expect(of(load(source), "S013")).toEqual([]);
  });

  it("S014: un riferimento locale a un id che manca", () => {
    const source = titled(
      '<defs><linearGradient id="r1"/></defs>' +
        '<rect fill="url(#r1)" stroke="url(#r2) #000000"/>' +
        '<g filter="url(#r3)" style="fill: url(#r4); stroke: url(\'#r4\')"><use href="#r5" xlink:href="#r5"/></g>' +
        '<a href="#r6"><circle r="1" clip-path="url(#r7)" mask="url(#r7)"/></a>' +
        '<rect fub:nota="url(#r8)"/>',
    );
    const scene = load(source);
    const found = of(scene, "S014");
    expect(found.every((d) => d.severity === "warning")).toBe(true);
    // Una per id e per attributo, in ordine di elemento e di attributo; un
    // `href` su un collegamento è un'ancora, e gli altri namespace non
    // rimandano a niente.
    expect(details(scene, "S014")).toEqual(["stroke #r2", "filter #r3", "style #r4", "href #r5", "xlink:href #r5", "clip-path #r7", "mask #r7"]);
    expect(text(source, spanOf(found[0]!))).toBe('<rect fill="url(#r1)" stroke="url(#r2) #000000"/>');
    expect(text(source, spanOf(found[4]!)).startsWith("<use")).toBe(true);
    // Il documento resta modificabile: gli elementi col riferimento rotto
    // sono estranei.
    expect(isEditable(scene)).toBe(true);
    for (const body of [
      '<defs><linearGradient id="r1"/></defs><rect fill="url(#r1)"/>',
      '<rect id="r2" fill="url(#r2)"/>',
      '<a href="#sezione"></a>',
      '<image href="a.png#x"/>',
      '<rect fill="url(a.svg#r1)"/>',
    ]) {
      expect(of(load(titled(body)), "S014"), body).toEqual([]);
    }
  });

  it("S017: due colori di codice che si distinguono soltanto per la tinta", () => {
    // Il blu e il verde chiari, usati due volte l'uno: due S017, ciascuna sulla
    // prima area del suo colore, col compagno e il contrasto fra loro.
    const [blue, green] = ["#a6cee3", "#b2df8a"];
    const source = key("#ffffff", tint(0, blue) + tint(20, green) + tint(40, blue) + tint(60, green));
    const scene = load(source);
    const found = of(scene, "S017");
    expect(found).toHaveLength(2);
    expect(found.every((d) => d.severity === "info")).toBe(true);
    expect(details(scene, "S017")).toEqual(["#a6cee3 #b2df8a 1.10", "#b2df8a #a6cee3 1.10"]);
    expect(text(source, spanOf(found[0]!))).toBe(tint(0, blue));
    expect(text(source, spanOf(found[1]!))).toBe(tint(20, green));
    // Un colore usato una volta sola è un ornamento: niente.
    expect(confusions(tints([blue, green, green]))).toEqual([]);
    expect(confusions(tints([blue, green]))).toEqual([]);
    // Il blu scuro e il giallo chiaro, due volte l'uno, hanno 3,92:1: si
    // distinguono anche in grigio.
    expect(confusions(tints(["#0072b2", "#f0e442", "#0072b2", "#f0e442"]))).toEqual([]);
    // Il giallo sul bianco ha 1,14:1 col verde chiaro, e il blu scuro ne ha
    // 3,41: la S017 del giallo nomina il verde, e il blu non c'entra.
    expect(confusions(tints(["#f0e442", "#b2df8a", "#0072b2", "#f0e442", "#b2df8a", "#0072b2"]))).toEqual([
      "#f0e442 #b2df8a 1.14",
      "#b2df8a #f0e442 1.14",
    ]);
  });

  it("S017: il compagno è quello col contrasto più basso", () => {
    // Tre colori di codice, ciascuno due volte. Il verde acqua ha 2,25:1 col
    // verde chiaro e 2,04:1 col blu chiaro, che viene dopo nel documento: il
    // compagno è quello col contrasto più basso, non il primo.
    expect(confusions(tints(["#009e73", "#b2df8a", "#a6cee3", "#009e73", "#b2df8a", "#a6cee3"]))).toEqual([
      "#009e73 #a6cee3 2.04",
      "#b2df8a #a6cee3 1.10",
      "#a6cee3 #b2df8a 1.10",
    ]);
  });

  it("S017: il colore si compone con la sua opacità sulla carta soltanto", () => {
    // Il blu al 50% sulla carta #f0f0f0 è #88b4d2, lo stesso colore di un
    // riquadro opaco di quel colore e di un gruppo al 50%: tre aree, un
    // codice. Il contrasto col blu chiaro, usato due volte, è 1,32.
    const translucent = tile(0, 'fill="#1f78b4" fill-opacity="0.5"');
    const opaque = tint(20, "#88b4d2");
    const group = `<g opacity="0.5">${tint(40, "#1f78b4")}</g>`; // dentro il gruppo
    const body = translucent + opaque + group + tint(60, "#a6cee3") + tint(80, "#a6cee3");
    const source = key("#f0f0f0", body);
    const scene = load(source);
    expect(details(scene, "S017")).toEqual(["#88b4d2 #a6cee3 1.32", "#a6cee3 #88b4d2 1.32"]);
    expect(text(source, spanOf(of(scene, "S017")[0]!))).toBe(translucent);
    // Sul bianco la stessa opacità dà #8fbcda: non è più il colore del
    // riquadro opaco, e ogni colore è usato meno di due volte.
    expect(confusions(translucent + opaque + tint(60, "#a6cee3") + tint(80, "#b2df8a"))).toEqual([]);
    // Il colore si compone sulla carta soltanto, non sulle figure che ha
    // sotto: due riquadri chiari sopra uno scuro restano chiari.
    const covered = `<rect x="0" y="0" width="200" height="20" fill="#000000"/>${tints(["#a6cee3", "#b2df8a", "#a6cee3", "#b2df8a"])}`;
    expect(confusions(covered)).toEqual(["#a6cee3 #b2df8a 1.10", "#b2df8a #a6cee3 1.10"]);
    // Le opacità si moltiplicano: 0.5 del gruppo per 0.5 del riquadro dà il
    // 25% di #1f78b4 sul bianco, #c7ddec, il colore del riquadro opaco.
    const nested = `<g opacity="0.5">${tile(0, 'fill="#1f78b4" fill-opacity="0.5"')}</g>${tint(20, "#c7ddec")}${tint(40, "#a6cee3")}${tint(60, "#a6cee3")}`;
    expect(confusions(nested)).toEqual(["#c7ddec #a6cee3 1.19", "#a6cee3 #c7ddec 1.19"]);
    // Una carta che non si sa non dà il colore di un'area non opaca, ma
    // un'area opaca ha il suo.
    const unknown = titled(
      `${KEY_RESOURCES}<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#f0f0f0" filter="url(#r00000004)"/><g fub:layer="A">` +
        `${tints(["#a6cee3", "#b2df8a", "#a6cee3", "#b2df8a"])}${tile(100, 'fill="#1f78b4" fill-opacity="0.5"')}${tile(120, 'fill="#1f78b4" fill-opacity="0.5"')}</g>`,
    );
    expect(details(load(unknown), "S017")).toEqual(["#a6cee3 #b2df8a 1.10", "#b2df8a #a6cee3 1.10"]);
    // Senza carta il disegno sta sul bianco.
    const bare = titled(tints(["#a6cee3", "#b2df8a", "#a6cee3", "#b2df8a"]));
    expect(details(load(bare), "S017")).toEqual(["#a6cee3 #b2df8a 1.10", "#b2df8a #a6cee3 1.10"]);
  });

  it("S017: contano soltanto le forme piene di cui il colore si sa", () => {
    const [blue, green] = ["#a6cee3", "#b2df8a"];
    const pair = tints([green, blue, green]);
    // Con due riquadri blu, che mancano, si avrebbero due S017: il blu è
    // usato una volta sola nei casi che seguono.
    const both = (blues: string): string => pair + blues;
    // Una campitura, una sfumatura, un colore che decide una risorsa: il
    // colore non si sa, e ripiegare sul colore scritto accanto sarebbe
    // sbagliato.
    const unknown = tile(100, 'fill="url(#r00000002) #a6cee3"') + tile(120, 'fill="url(#r00000001) #a6cee3"');
    let scene = load(key("#ffffff", both(unknown)));
    expect(rects(scene)).toBe(5);
    expect(of(scene, "S017")).toEqual([]);
    // Un campione del documento ha il colore del campione, quale che sia il
    // ripiego accanto: due aree verdi chiare come le altre due.
    const swatches = tile(100, 'fill="url(#r00000005) #000000"') + tile(120, 'fill="url(#r00000005) #ff0000"');
    expect(confusions(tint(0, blue) + tint(20, blue) + swatches)).toEqual(["#a6cee3 #b2df8a 1.10", "#b2df8a #a6cee3 1.10"]);
    // Sotto un ritaglio, una maschera o un filtro, dell'elemento o di un
    // contenitore, i colori che si vedono non si sanno.
    const effects =
      tile(100, 'fill="#a6cee3" clip-path="url(#r00000003)"') +
      `<g clip-path="url(#r00000003)">${tint(120, blue)}</g>` +
      `<g mask="url(#r00000006)"><g>${tint(140, blue)}</g></g>` +
      tile(160, 'fill="#a6cee3" filter="url(#r00000004)"');
    scene = load(key("#ffffff", both(effects)));
    expect(rects(scene)).toBe(7);
    expect(of(scene, "S017")).toEqual([]);
    // Una figura il cui riquadro non ha larghezza o non ha altezza non è
    // un'area, e nemmeno un tracciato lungo una linea.
    const flat =
      '<rect x="100" y="0" width="10" height="0" fill="#a6cee3"/>' +
      '<rect x="120" y="0" width="0" height="10" fill="#a6cee3"/>' +
      '<path d="M140 0 L200 0" fill="#a6cee3"/>' +
      '<ellipse cx="220" cy="5" rx="10" ry="0" fill="#a6cee3"/>';
    scene = load(key("#ffffff", both(flat)));
    expect(rects(scene)).toBe(5);
    expect(of(scene, "S017")).toEqual([]);
    // Un'area vera della stessa dimensione, invece, conta.
    expect(confusions(both(tint(100, blue) + tint(120, blue)))).toEqual(["#b2df8a #a6cee3 1.10", "#a6cee3 #b2df8a 1.10"]);
    // I tratti a penna e l'evidenziatore sono sottili: non sono aree. I
    // testi e le immagini nemmeno, e una forma senza riempimento o del tutto
    // trasparente neanche.
    const others =
      stroke("pen", 'fill="#a6cee3"') +
      stroke("pen", 'fill="#a6cee3"') +
      stroke("highlighter", 'fill="#a6cee3" fill-opacity="0.4"') +
      label('fill="#a6cee3"', "Uno") +
      label('fill="#a6cee3"', "Due") +
      '<image x="0" y="0" width="5" height="5" href="a.png" fill="#a6cee3"/>' +
      tile(100, 'fill="none"') +
      tile(120, 'fill="none"') +
      tile(140, 'fill="#a6cee3" fill-opacity="0"') +
      tile(160, 'fill="#a6cee3" opacity="0"');
    expect(confusions(both(others))).toEqual([]);
    // Una figura nascosta, o dentro un contenitore nascosto, non si guarda.
    const hidden = tile(100, 'fill="#a6cee3" display="none"') + `<g display="none">${tint(120, blue)}</g>`;
    scene = load(key("#ffffff", both(hidden)));
    expect(rects(scene)).toBe(5);
    expect(of(scene, "S017")).toEqual([]);
  });

  it("S017: con più di dodici colori di codice tace", () => {
    // Tredici rosati vicini, due riquadri ciascuno: un'illustrazione, non un
    // codice. Con dodici, S017 parla.
    const colors = Array.from({ length: 13 }, (_, k) => `#${(0xc8 + k * 3).toString(16).padStart(2, "0")}c8c8`);
    const twice = (count: number): string => tints([...colors.slice(0, count), ...colors.slice(0, count)]);
    expect(confusions(twice(12))).toHaveLength(12);
    expect(confusions(twice(13))).toEqual([]);
    // Un colore usato una volta non fa numero: dodici di codice e un
    // tredicesimo, ornamento, e S017 parla ancora.
    expect(confusions(twice(12) + tint(1000, colors[12]!))).toHaveLength(12);
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
      ["S011", "info"],
      ["S012", "warning"],
      ["S013", "info"],
      ["S014", "warning"],
      ["S017", "info"],
    ];
    for (const [code, severity] of table) {
      expect(severityOf(code), code).toBe(severity);
      expect(CODE_MESSAGES[code], code).not.toBe("");
    }
    // Un documento malformato non ha diagnostica: è un errore.
    expect(() => readScene("<svg")).toThrow(ReadError);
  });
});
