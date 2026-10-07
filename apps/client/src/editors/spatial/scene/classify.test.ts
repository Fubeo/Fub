// La regola di classificazione del formato della scena (§4), una regola alla
// volta, nei due versi: che cosa resta modificabile e che cosa diventa
// estraneo. Sono i casi di `crates/fub-scene/tests/classify.rs`, uno per uno,
// letti da questo lettore invece che da quello di Rust; quelli di poligoni e
// stelle stanno in `__fixtures__/scene-shapes/cases.json`, per tutti e due.

import { describe, expect, it } from "vitest";
import type { Role } from "./analysis";
import { MAX_DEPTH } from "./classify";
import { at, doc, elements, first, foreign, load, role, text } from "./test-support";
import shapes from "../../../__fixtures__/scene-shapes/cases.json";
import widths from "../../../__fixtures__/scene-width/cases.json";

describe("la classificazione (§4)", () => {
  it("ogni tag della tabella è modificabile", () => {
    const cases: Array<[string, Role]> = [
      ['<path d="M0 0 L10 10"/>', "path"],
      ['<rect x="1" y="2" width="3" height="4" rx="1" ry="1"/>', "rect"],
      ['<ellipse cx="5" cy="5" rx="4" ry="2"/>', "ellipse"],
      ['<circle cx="5" cy="5" r="4"/>', "circle"],
      ['<line x1="0" y1="0" x2="10" y2="10"/>', "line"],
      ['<polyline points="0,0 10,10 20,0"/>', "polyline"],
      ['<polygon points="0 0 10 10 20 0"/>', "polygon"],
      ['<text x="1" y="2"><tspan x="1" dy="0">a</tspan></text>', "text"],
      ['<image x="0" y="0" width="1" height="1" href="foto.png"/>', "image"],
      ["<g></g>", "group"],
      ['<a href="note.md"></a>', "link"],
      ["<title>Titolo</title>", "title"],
      ["<desc>Descrizione</desc>", "desc"],
    ];
    for (const [body, expected] of cases) expect(first(body), body).toBe(expected);
  });

  it("un tag fuori dalla tabella è estraneo", () => {
    for (const body of [
      '<use href="#a"/>',
      "<defs></defs>",
      "<style>rect{}</style>",
      "<script>alert(1)</script>",
      "<foreignObject></foreignObject>",
      "<symbol></symbol>",
      "<switch></switch>",
      "<svg></svg>",
      "<linearGradient></linearGradient>",
      "<clipPath></clipPath>",
      "<metadata></metadata>",
      "<tspan>fuori da un testo</tspan>",
      "<marker></marker>",
      "<animate/>",
    ]) {
      expect(first(body), body).toBeNull();
    }
  });

  it("i tag si riconoscono dal namespace, non dal prefisso", () => {
    // Un prefisso qualunque legato al namespace SVG è SVG.
    expect(first('<s:rect xmlns:s="http://www.w3.org/2000/svg" width="1" height="1"/>')).toBe("rect");
    // Lo stesso nome locale in un altro namespace non lo è.
    expect(first('<x:rect xmlns:x="https://example.org/x" width="1"/>')).toBeNull();
    // Un `rect` che ridichiara il namespace di default fuori da SVG.
    expect(first('<rect xmlns="https://example.org/x"/>')).toBeNull();
    // Il namespace di `fub` vale per URI: un altro prefisso funziona.
    const source = doc('<g xmlns:f="https://fubeo.github.io/ns/scene/1" f:layer="Uno"></g>');
    expect(role(load(source), [0])).toBe("layer");
  });

  it("ogni attributo dell'elenco è ammesso", () => {
    const presentation =
      'id="o1" fill="#ff0000" fill-opacity="0.5" stroke="none" stroke-width="2" ' +
      'stroke-opacity="1" stroke-linecap="round" stroke-linejoin="bevel" ' +
      'stroke-dasharray="4 2" opacity="0" display="inline" transform="rotate(45)" ' +
      'font-family="Inter, sans-serif" font-size="12" font-weight="bold" font-style="italic" ' +
      'letter-spacing="-0.5" text-anchor="middle"';
    expect(first(`<rect ${presentation} x="0" y="0" width="1" height="1"/>`)).toBe("rect");
    expect(first(`<g ${presentation}></g>`)).toBe("group");
  });

  it("un attributo fuori dall'elenco rende estraneo l'elemento", () => {
    for (const attribute of [
      'class="a"',
      'style="fill:red"',
      'onclick="alert(1)"',
      'stroke-miterlimit="4"',
      'filter="none"',
      'data-x="1"',
      'aria-label="x"',
      'role="img"',
      'visibility="hidden"',
      'cx="1"',
    ]) {
      const body = `<rect width="1" height="1" ${attribute}/>`;
      expect(first(body), body).toBeNull();
    }
    // Un attributo nel namespace SVG non è un attributo SVG.
    expect(first('<rect xmlns:s="http://www.w3.org/2000/svg" s:fill="red"/>')).toBeNull();
  });

  it("gli attributi di geometria appartengono al loro tag", () => {
    expect(first('<circle r="1"/>')).toBe("circle");
    expect(first('<ellipse r="1"/>')).toBeNull();
    expect(first('<rect r="1"/>')).toBeNull();
    expect(first('<line x="1"/>')).toBeNull();
    expect(first('<path points="0 0"/>')).toBeNull();
    expect(first('<polygon d="M0 0"/>')).toBeNull();
    expect(first('<text dx="1"></text>')).toBeNull();
    expect(first('<image href="a.png" rx="1"/>')).toBeNull();
    expect(first('<image href="a.png" preserveAspectRatio="xMidYMid slice"/>')).toBe("image");
    expect(first('<rect preserveAspectRatio="none"/>')).toBeNull();
    expect(first('<g x="1"></g>')).toBeNull();
    // `href` vale solo su `a` e `image`.
    expect(first('<rect href="a.md"/>')).toBeNull();
  });

  it("le lunghezze prendono solo unità assolute", () => {
    for (const value of ["1", "-1.5", ".5", "1e3", "+2", " 3 ", "1px", "1in", "2.54cm", "10mm", "4Q", "12pt", "1pc"]) {
      const body = `<rect x="${value}"/>`;
      expect(first(body), body).toBe("rect");
    }
    for (const value of [
      "",
      "1%",
      "1em",
      "1ex",
      "1rem",
      "1ch",
      "1vw",
      "1vh",
      "calc(1px)",
      "auto",
      "1PX",
      "1 px",
      "1.",
      "e3",
      "1e",
      "inherit",
    ]) {
      const body = `<rect x="${value}"/>`;
      expect(first(body), body).toBeNull();
    }
  });

  it("una dimensione negativa rende estraneo l'elemento", () => {
    for (const attribute of [
      'width="-1"',
      'height="-1"',
      'rx="-1"',
      'ry="-0.5"',
      'stroke-width="-1"',
      'font-size="-1"',
    ]) {
      expect(first(`<rect ${attribute}/>`), attribute).toBeNull();
    }
    expect(first('<circle r="-1"/>')).toBeNull();
    expect(first('<rect width="0" height="0" x="-5" y="-5"/>')).toBe("rect");
    expect(first('<circle r="0"/>')).toBe("circle");
  });

  it("i dati di un path seguono la grammatica di SVG 2", () => {
    for (const d of [
      "",
      "M0 0",
      "m1.5.5l2-3",
      "M0 0 a1 1 0 011 1",
      "M0,0 C1,1 2,2 3,3 S4 4 5 5 z",
      "M0 0 Q1 1 2 2 T3 3 H4 V5 Z",
    ]) {
      expect(first(`<path d="${d}"/>`), d).toBe("path");
    }
    for (const d of ["L0 0", "M0", "M0 0 L", "M0 0 Z 1 1", "M0 0 A1 1 0 2 1 2 2", "M0 0 X1 1", "M0 0,"]) {
      expect(first(`<path d="${d}"/>`), d).toBeNull();
    }
  });

  it("i punti vanno a coppie", () => {
    expect(first('<polyline points="0,0 1,1"/>')).toBe("polyline");
    expect(first('<polygon points=""/>')).toBe("polygon");
    expect(first('<polyline points="0,0 1"/>')).toBeNull();
    expect(first('<polygon points="0,0,"/>')).toBeNull();
    expect(first('<polygon points="0px 0"/>')).toBeNull();
  });

  it("il tratteggio è none o lunghezze non negative", () => {
    for (const value of ["none", "4", "4 2", "4,2,1", "1mm 2px", "0"]) {
      expect(first(`<line stroke-dasharray="${value}"/>`), value).toBe("line");
    }
    for (const value of ["", "-1", "4 -2", "1%", "4,", "inherit"]) {
      expect(first(`<line stroke-dasharray="${value}"/>`), value).toBeNull();
    }
  });

  it("i colori sono esadecimali, nomi o none", () => {
    for (const value of ["none", "#ff0000", "#F00", "#AbCdEf", "red", "rebeccapurple", " #fff "]) {
      expect(first(`<rect fill="${value}"/>`), value).toBe("rect");
    }
    for (const value of [
      "",
      "rgb(0,0,0)",
      "hsl(0 0% 0%)",
      "currentColor",
      "currentcolor",
      "transparent",
      "inherit",
      "#ff00",
      "#ff00ff00",
      "Red",
      "url(#g)",
      "#ggg",
    ]) {
      expect(first(`<rect fill="${value}"/>`), value).toBeNull();
      expect(first(`<rect stroke="${value}"/>`), value).toBeNull();
    }
  });

  it("l'opacità è un numero da zero a uno", () => {
    for (const value of ["0", "1", "0.25", ".5", "1e-1"]) {
      expect(first(`<rect opacity="${value}"/>`), value).toBe("rect");
    }
    for (const value of ["1.5", "-0.1", "50%", "", "inherit"]) {
      expect(first(`<rect fill-opacity="${value}"/>`), value).toBeNull();
    }
  });

  it("le parole chiave prendono i loro valori elencati", () => {
    for (const attribute of [
      'display="none"',
      'display="inline"',
      'stroke-linecap="butt"',
      'stroke-linecap="square"',
      'stroke-linejoin="miter"',
      'stroke-linejoin="round"',
      'font-weight="normal"',
      'font-weight="100"',
      'font-weight="900"',
      'text-anchor="start"',
      'text-anchor="end"',
    ]) {
      expect(first(`<rect ${attribute}/>`), attribute).toBe("rect");
    }
    for (const attribute of [
      'display="block"',
      'display="inherit"',
      'stroke-linecap="Round"',
      'stroke-linejoin="arcs"',
      'font-weight="bolder"',
      'font-weight="550"',
      'font-weight="1000"',
      'text-anchor="inherit"',
    ]) {
      expect(first(`<rect ${attribute}/>`), attribute).toBeNull();
    }
    for (const value of ["none", "xMidYMid", "xMinYMax meet", "xMaxYMin slice"]) {
      expect(first(`<image href="a.png" preserveAspectRatio="${value}"/>`), value).toBe("image");
    }
    for (const value of ["", "xMidYmid", "none slice meet", "defer xMidYMid", "inherit"]) {
      expect(first(`<image href="a.png" preserveAspectRatio="${value}"/>`), value).toBeNull();
    }
  });

  it("le trasformazioni sono elenchi di funzioni SVG", () => {
    for (const value of [
      "",
      "matrix(1 0 0 1 10 20)",
      "translate(10)",
      "translate(10,20) scale(2)",
      "rotate(45 50 50),skewX(10) skewY(-5)",
      "scale(1 2)translate(3 4)",
    ]) {
      expect(first(`<g transform="${value}"></g>`), value).toBe("group");
    }
    for (const value of [
      "translate(10px)",
      "rotate(45deg)",
      "matrix(1 0 0 1 10)",
      "Translate(1)",
      "translate(1),",
      "scale()",
      "translate(1 2 3)",
    ]) {
      expect(first(`<g transform="${value}"></g>`), value).toBeNull();
    }
  });

  it("la tipografia prende i suoi valori", () => {
    for (const attribute of [
      'font-style="normal"',
      'font-style="italic"',
      'font-style="oblique"',
      'letter-spacing="normal"',
      'letter-spacing="0"',
      'letter-spacing="-1.5"',
      'letter-spacing="2px"',
      'letter-spacing="0.1in"',
    ]) {
      expect(first(`<g ${attribute}></g>`), attribute).toBe("group");
    }
    for (const attribute of [
      'font-style="Italic"',
      'font-style="oblique 10deg"',
      'font-style="inherit"',
      'letter-spacing="10%"',
      'letter-spacing="0.1em"',
      'letter-spacing="wide"',
      'letter-spacing=""',
    ]) {
      expect(first(`<g ${attribute}></g>`), attribute).toBeNull();
    }
    for (const value of ["none", "underline", "line-through underline", "underline overline line-through"]) {
      expect(first(`<text text-decoration="${value}"><tspan text-decoration="${value}">a</tspan></text>`), value).toBe("text");
    }
    for (const value of ["", "underline underline", "none underline", "blink", "Underline", "underline red"]) {
      expect(first(`<text text-decoration="${value}"></text>`), value).toBeNull();
    }
    // Non si eredita: su un gruppo o una forma non vuol dire niente.
    expect(first('<g text-decoration="underline"></g>')).toBeNull();
    expect(first('<rect text-decoration="none"/>')).toBeNull();
  });

  it("font-family accetta qualunque valore", () => {
    expect(first(`<text font-family="'Comic Sans MS', cursive"></text>`)).toBe("text");
    expect(first('<text font-family=""></text>')).toBe("text");
  });

  it("un valore con url( rende estraneo l'elemento", () => {
    for (const body of [
      '<rect fill="url(#g)"/>',
      '<rect stroke="URL(#g)"/>',
      '<text font-family="url(x)"></text>',
      '<image href="url(a.png)"/>',
      '<a xlink:href="url(a.md)"></a>',
    ]) {
      expect(first(body), body).toBeNull();
    }
    // Un attributo che il browser non legge non riferisce niente: lì `url(`
    // è testo come un altro.
    expect(first('<rect fub:nota="url(x)"/>')).toBe("rect");
    expect(first('<rect xmlns:i="https://example.org/i" i:fill="url(#g)"/>')).toBe("rect");
  });

  it("gli href dei collegamenti puntano nel vault", () => {
    for (const value of ["note.md", "../altro/nota.md", "/radice.md", "nota.md#sezione", "una nota.md"]) {
      expect(first(`<a href="${value}"></a>`), value).toBe("link");
      expect(first(`<a xlink:href="${value}"></a>`), value).toBe("link");
    }
    for (const value of [
      "https://example.org",
      "mailto:a@b.c",
      "javascript:alert(1)",
      "#frag",
      "",
      "//host/a.md",
      "data:text/plain,a",
    ]) {
      expect(first(`<a href="${value}"></a>`), value).toBeNull();
    }
    // Un `a` senza `href` è un collegamento ancora da scrivere.
    expect(first("<a></a>")).toBe("link");
  });

  it("gli href delle immagini sono data raster, percorsi del vault o remoti", () => {
    for (const value of [
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/jpeg;base64,/9j/",
      "data:image/webp;base64,UklGRg==",
      "data:image/gif;base64,R0lGOD",
      "foto.png",
      "/media/foto.jpg",
      "https://example.org/foto.png",
    ]) {
      expect(first(`<image href="${value}"/>`), value).toBe("image");
      expect(first(`<image xlink:href="${value}"/>`), value).toBe("image");
    }
    for (const value of [
      "data:image/svg+xml,%3Csvg%2F%3E",
      "data:text/html,x",
      "#frag",
      "javascript:x",
      "ftp://host/a.png",
      "",
    ]) {
      expect(first(`<image href="${value}"/>`), value).toBeNull();
    }
  });

  it("di xlink vale solo href, e solo su collegamenti e immagini", () => {
    expect(first('<rect xlink:href="a.md"/>')).toBeNull();
    expect(first('<a xlink:title="Nota"></a>')).toBeNull();
    expect(first('<image xlink:show="embed" href="a.png"/>')).toBeNull();
  });

  it("gruppi e collegamenti giudicano ogni figlio da sé", () => {
    const source = doc(
      '<g fub:layer="Uno" id="l1">' +
        '<rect width="1"/><use href="#x"/><circle r="1"/>' +
        '<a href="n.md"><rect style="x"/><ellipse rx="1"/></a>' +
        "</g>",
    );
    const scene = load(source);
    expect(role(scene, [0])).toBe("layer");
    expect(role(scene, [0, 0])).toBe("rect");
    expect(role(scene, [0, 1])).toBeNull();
    expect(role(scene, [0, 2])).toBe("circle");
    expect(role(scene, [0, 3])).toBe("link");
    expect(role(scene, [0, 3, 0])).toBeNull();
    expect(role(scene, [0, 3, 1])).toBe("ellipse");
  });

  it("gli altri elementi sono unità coi loro figli", () => {
    for (const body of [
      '<rect width="1"><animate attributeName="x"/></rect>',
      '<rect width="1">testo</rect>',
      '<rect width="1"><!-- nota --></rect>',
      '<rect width="1"><?pi x?></rect>',
      '<rect width="1"><![CDATA[ ]]></rect>',
      '<rect width="1"><title class="x">a</title></rect>',
      '<path d=""><desc><b xmlns="https://example.org">a</b></desc></path>',
      '<circle r="1"><g></g></circle>',
    ]) {
      expect(first(body), body).toBeNull();
    }
    for (const body of [
      '<rect width="1">\n  \t\r\n</rect>',
      '<rect width="1"><title>Porta</title><desc>d\'ingresso</desc></rect>',
      '<circle r="1"> <title id="t1">a &amp; b</title> </circle>',
    ]) {
      expect(first(body), body).not.toBeNull();
    }
  });

  it("un testo è modificabile solo con i tspan ammessi", () => {
    for (const body of [
      "<text></text>",
      '<text x="0" y="10"><tspan x="0" dy="0">uno</tspan><tspan x="0" dy="1.2">due</tspan></text>',
      "<text>\n  <tspan>uno</tspan>\n</text>",
      "<text><title>t</title><tspan>a</tspan></text>",
      '<text><tspan id="r1" fill="red" font-weight="bold">a &#x2014; b</tspan></text>',
      "<text><tspan></tspan></text>",
      "<text><tspan>a<tspan>b</tspan></tspan></text>",
      '<text><tspan x="0" dy="0">a <tspan font-weight="bold" font-style="italic">b</tspan> c<tspan fill="#ff0000" letter-spacing="-0.5" text-decoration="underline line-through"></tspan></tspan></text>',
      '<text><tspan><tspan font-size="20" xml:space="preserve"> b </tspan></tspan></text>',
      '<text><tspan><tspan xmlns:x="https://example.org" x:y="1">b</tspan></tspan></text>',
    ]) {
      expect(first(body), body).toBe("text");
    }
    for (const body of [
      "<text>senza tspan</text>",
      '<text><tspan y="3">a</tspan></text>',
      '<text><tspan dx="3">a</tspan></text>',
      "<text><tspan>a<tspan>b<tspan>c</tspan></tspan></tspan></text>",
      "<text><tspan>a<tspan>b<!-- c --></tspan></tspan></text>",
      '<text><tspan><tspan id="p1">b</tspan></tspan></text>',
      '<text><tspan><tspan x="0">b</tspan></tspan></text>',
      '<text><tspan><tspan dy="1">b</tspan></tspan></text>',
      '<text><tspan><tspan text-anchor="end">b</tspan></tspan></text>',
      '<text><tspan><tspan display="none">b</tspan></tspan></text>',
      '<text><tspan><tspan opacity="0.5">b</tspan></tspan></text>',
      '<text><tspan><tspan transform="scale(2)">b</tspan></tspan></text>',
      '<text><tspan><tspan class="x">b</tspan></tspan></text>',
      "<text><tspan><title>t</title>b</tspan></text>",
      "<text><tspan>a<!-- c --></tspan></text>",
      "<text><tspan>a</tspan>b</text>",
      '<text><textPath href="#p">a</textPath></text>',
      '<text><tspan class="x">a</tspan></text>',
      '<text><tspan dy="1em">a</tspan></text>',
    ]) {
      expect(first(body), body).toBeNull();
    }
  });

  it("righe di testo e titoli portano il contenuto decodificato", () => {
    const source = doc(
      "<title>Gatti &amp; cani &#233;</title>" +
        "<desc>  spazi  </desc>" +
        "<text><tspan>a &lt; b</tspan> <tspan>  due  </tspan></text>" +
        '<text><tspan>a <tspan font-weight="bold">b</tspan><tspan> c</tspan>!</tspan></text>',
    );
    const scene = load(source);
    expect(at(scene, [0])!.text).toBe("Gatti & cani é");
    expect(at(scene, [1])!.text).toBe("  spazi  ");
    expect(at(scene, [2])!.lines).toEqual(["a < b", "  due  "]);
    expect(at(scene, [2])!.text).toBeUndefined();
    // I pezzi di una riga sono la riga intera.
    expect(at(scene, [3])!.lines).toEqual(["a b c!"]);
  });

  it("title e desc contengono soltanto dati di carattere", () => {
    expect(first("<title></title>")).toBe("title");
    expect(first("<title>a<tspan>b</tspan></title>")).toBeNull();
    expect(first("<title>a<!-- b --></title>")).toBeNull();
    expect(first("<desc><![CDATA[a]]></desc>")).toBeNull();
    expect(first('<desc style="x">a</desc>')).toBeNull();
    // Fuori da un'unità, dentro un livello, valgono da sé.
    const source = doc('<g fub:layer="Uno"><title>Livello</title><desc>a<b xmlns="https://example.org"/></desc></g>');
    const scene = load(source);
    expect(role(scene, [0, 0])).toBe("title");
    expect(role(scene, [0, 1])).toBeNull();
  });

  it("lo spazio fra gli elementi non è di nessuno", () => {
    let source = doc('\n  <g>\n    <rect width="1"/>\r\n\t</g>\n');
    let scene = load(source);
    expect(foreign(scene)).toEqual([]);
    expect(elements(scene)).toHaveLength(2);
    // Il testo non vuoto in un contenitore è estraneo.
    source = doc("<g> parole </g>");
    scene = load(source);
    const blocks = foreign(scene);
    expect(blocks).toHaveLength(1);
    expect(text(source, blocks[0]!)).toBe("parole");
    expect(blocks[0]!.parentPath).toEqual([0]);
    expect(blocks[0]!.elements).toEqual([0, 0]);
  });

  it("gli attributi di altri namespace restano e non decidono niente", () => {
    const body =
      '<rect xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
      'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
      'inkscape:label="Porta" sodipodi:insensitive="true" xml:space="preserve" ' +
      'fub:sconosciuto="1" width="1"/>';
    expect(first(body)).toBe("rect");
  });

  it("la radice non si classifica", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" class="x" style="background:url(#a)" ' +
      'onload="alert(1)" data-x="1" width="100%">' +
      '<rect width="1"/></svg>';
    const scene = load(source);
    expect(scene.items[0]!.kind).toBe("root");
    expect(role(scene, [0])).toBe("rect");
  });

  it("i livelli sono gruppi con fub:layer sotto la radice", () => {
    const source = doc(
      '<g id="l1" fub:layer="Primo piano" fub:locked="true" display="none">' +
        '<g fub:layer="Annidato"></g>' +
        "</g>" +
        '<g fub:layer="" fub:locked="false"/>' +
        "<g></g>",
    );
    const scene = load(source);
    const layer = at(scene, [0])!;
    expect(layer.role).toBe("layer");
    const info = layer.layer!;
    expect(info.name).toBe("Primo piano");
    expect(info.locked && info.hidden).toBe(true);
    expect(role(scene, [0, 0])).toBe("group");
    const empty = at(scene, [1])!;
    expect(empty.role).toBe("layer");
    expect(empty.layer!.locked).toBe(false);
    expect(empty.tags!.close).toBeNull();
    expect(role(scene, [2])).toBe("group");
    expect(at(scene, [2])!.layer).toBeUndefined();
  });

  it("la carta è un rect con fub:role=paper sotto la radice", () => {
    const source = doc(
      '<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#ffffff"/>' +
        '<g fub:layer="Uno"><rect fub:role="paper" width="1"/></g>' +
        '<rect fub:role="carta" width="1"/>',
    );
    const scene = load(source);
    expect(role(scene, [0])).toBe("paper");
    expect(role(scene, [1, 0])).toBe("rect");
    expect(role(scene, [2])).toBe("rect");
  });

  it("i tratti sono path con uno strumento noto", () => {
    const source = doc(
      '<path fub:tool="pen" d="M0 0"/>' +
        '<path fub:tool="highlighter" d="M0 0"/>' +
        '<path fub:tool="pennello" d="M0 0"/>' +
        '<rect fub:tool="pen"/>',
    );
    const scene = load(source);
    expect(at(scene, [0])!.stroke!.tool).toBe("pen");
    expect(at(scene, [1])!.stroke!.tool).toBe("highlighter");
    expect(role(scene, [2])).toBe("path");
    expect(at(scene, [2])!.stroke).toBeUndefined();
    expect(role(scene, [3])).toBe("rect");
  });

  it("una freccia vuole quattro numeri, e le forme sconosciute sono path", () => {
    const source = doc(
      '<path fub:shape="arrow" fub:geom="10 20, 30 -4.5" d="M10 20 L30 -4.5"/>' +
        '<path fub:shape="arrow" fub:geom="10 20 30" d="M0 0"/>' +
        '<path fub:shape="arrow" fub:geom="1 2 3 4 5" d="M0 0"/>' +
        '<path fub:shape="arrow" fub:geom="1 2 3 4px" d="M0 0"/>' +
        '<path fub:shape="hexagon" fub:geom="1 2 3 4" d="M0 0"/>' +
        '<path fub:shape="arrow" d="M0 0"/>',
    );
    const scene = load(source);
    const arrow = at(scene, [0])!;
    expect(arrow.role).toBe("arrow");
    expect(arrow.arrow).toEqual([10, 20, 30, -4.5]);
    for (let index = 1; index < 6; index++) {
      expect(role(scene, [index]), String(index)).toBe("path");
      expect(at(scene, [index])!.arrow, String(index)).toBeUndefined();
    }
  });

  it("un poligono e una stella vogliono la loro grammatica intera, altrimenti sono path", () => {
    for (const { shape, geom, polygonal } of shapes.read) {
      const item = at(load(doc(`<path fub:shape="${shape}" fub:geom="${geom}" d="M0 0 L10 0 L5 5 Z"/>`)), [0])!;
      if (polygonal === null) {
        expect(item.role, geom).toBe("path");
        expect(item.polygonal, geom).toBeUndefined();
      } else {
        expect(item.role, geom).toBe(shape === "star" ? "star" : "ngon");
        expect(item.polygonal, geom).toEqual({ shape, ...polygonal });
      }
    }
  });

  it("uno spessore variabile vuole la sua grammatica intera, altrimenti è un path", () => {
    for (const { geom, varwidth } of widths.read) {
      const written = geom.replace(/\t/g, "&#9;").replace(/\n/g, "&#10;");
      const item = at(load(doc(`<path fub:shape="width" fub:geom="${written}" d="M0 0 L10 0 L5 5 Z"/>`)), [0])!;
      if (varwidth === null) {
        expect(item.role, geom).toBe("path");
        expect(item.varwidth, geom).toBeUndefined();
      } else {
        expect(item.role, geom).toBe("width");
        expect(item.varwidth, geom).toEqual(varwidth);
      }
    }
    expect(role(load(doc('<path fub:shape="star" fub:geom="round round 0 1 1 1 1 1 M0 0 L1 0" d="M0 0"/>')), [0])).toBe("path");
  });

  it("i nodi estranei contigui fanno un blocco solo", () => {
    const source = doc(
      '\n  <rect width="1"/>' +
        '\n  <!-- a -->\n  <use href="#x"/>\n  <?pi x?>\n  <style>s</style>' +
        '\n  <circle r="1"/>' +
        "\n  <defs/>" +
        "\n",
    );
    const scene = load(source);
    const blocks = foreign(scene);
    expect(blocks).toHaveLength(2);
    expect(text(source, blocks[0]!)).toBe('<!-- a -->\n  <use href="#x"/>\n  <?pi x?>\n  <style>s</style>');
    expect(blocks[0]!.elements).toEqual([1, 3]);
    expect(blocks[0]!.indent).toBe("  ");
    expect(blocks[0]!.parentPath).toEqual([]);
    expect(text(source, blocks[1]!)).toBe("<defs/>");
    expect(blocks[1]!.elements).toEqual([4, 5]);
    // L'indice di un elemento conta anche gli estranei che lo precedono.
    expect(role(scene, [3])).toBe("circle");
  });

  it("un blocco senza elementi indica l'elemento che lo segue", () => {
    const scene = load(doc('<rect/><!-- a --><circle r="1"/>'));
    expect(foreign(scene)[0]!.elements).toEqual([1, 1]);
  });

  it("prologo ed epilogo sono blocchi del documento", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- prologo -->\n${doc("<rect/>")}\n<!-- epilogo --><?fine?>\n`;
    const scene = load(source);
    const blocks = foreign(scene);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.parentPath).toBeNull();
    expect(text(source, blocks[0]!)).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<!-- prologo -->');
    expect(blocks[0]!.elements).toEqual([0, 0]);
    expect(blocks[1]!.parentPath).toBeNull();
    expect(text(source, blocks[1]!)).toBe("<!-- epilogo --><?fine?>");
    expect(blocks[1]!.elements).toEqual([1, 1]);
    expect(scene.items[1]!.kind).toBe("root");
  });

  it("CDATA e riferimenti a entità sono nodi estranei", () => {
    const source =
      '<!DOCTYPE svg [<!ENTITY nome "Fub">]>' +
      '<svg xmlns="http://www.w3.org/2000/svg"><g><![CDATA[<x>]]>&nome;<rect/></g>' +
      "<title>&nome;</title></svg>";
    const scene = load(source);
    const blocks = foreign(scene);
    expect(text(source, blocks[1]!)).toBe("<![CDATA[<x>]]>&nome;");
    expect(blocks[1]!.parentPath).toEqual([0]);
    expect(role(scene, [0, 0])).toBe("rect");
    // Un titolo con un'entità non si può riscrivere: è estraneo.
    expect(role(scene, [1])).toBeNull();
  });

  it("i contenitori portano i loro tag, e le voci il loro rientro", () => {
    let source = doc('\n  <g id="g1">\n    <a href="n.md">\n\t\t<rect/>\n    </a>\n  </g>\n');
    const scene = load(source);
    const group = at(scene, [0])!;
    const tags = group.tags!;
    expect(text(source, tags.open)).toBe('<g id="g1">');
    expect(text(source, tags.close!)).toBe("</g>");
    expect(group.indent).toBe("  ");
    expect(group.id).toBe("g1");
    const link = at(scene, [0, 0])!;
    expect(text(source, link.tags!.open)).toBe('<a href="n.md">');
    expect(link.indent).toBe("    ");
    const rect = at(scene, [0, 0, 0])!;
    expect(rect.indent).toBe("\t\t");
    expect(rect.tags).toBeUndefined();
    expect(rect.id).toBeNull();
    // Un elemento che non comincia la riga prende il rientro della riga.
    source = doc('\n    <rect/><circle r="1"/>');
    expect(at(load(source), [1])!.indent).toBe("    ");
  });

  it("un id vuoto rende estraneo l'elemento", () => {
    expect(first('<rect id=""/>')).toBeNull();
    expect(first('<rect id="x"/>')).toBe("rect");
  });

  it("i contenitori oltre il limite di profondità sono estranei", () => {
    const nest = (depth: number): string => doc(`${"<g>".repeat(depth)}<rect/>${"</g>".repeat(depth)}`);
    let scene = load(nest(MAX_DEPTH));
    expect(foreign(scene)).toEqual([]);
    const deepest = elements(scene)[elements(scene).length - 1]!.path;
    expect(deepest).toEqual(new Array<number>(MAX_DEPTH + 1).fill(0));

    // Diecimila livelli: i primi `MAX_DEPTH` sono gruppi, il resto è un
    // blocco solo, e né la lettura né la visita esauriscono lo stack.
    scene = load(nest(10_000));
    expect(elements(scene)).toHaveLength(MAX_DEPTH);
    const block = foreign(scene)[0]!;
    expect(block.parentPath).toEqual(new Array<number>(MAX_DEPTH).fill(0));
    expect(block.elements).toEqual([0, 1]);
  });

  it("un documento oltre il limite di elementi non ha voci", () => {
    // Centomila livelli annidati: oltre il limite di elementi, la lettura
    // regge e la scena non costruisce voci.
    const depth = 100_000;
    const scene = load(doc(`${"<g>".repeat(depth)}${"</g>".repeat(depth)}`));
    expect(scene.readOnly).toEqual(["too-many-elements"]);
    expect(scene.items).toEqual([]);
  });
});
