// Ciò che l'indice legge di una scena (§9): titolo, descrizione, testi,
// collegamenti, immagini del vault e il riepilogo `fub.scene.summary`. Sono i
// casi di `crates/fub-scene/tests/analysis.rs` e i test d'unità di
// `src/analysis.rs` (contrasto, composizione sulla carta, spazi, centesimi).

import { describe, expect, it } from "vitest";
import { collapse, contrast, hundredths, MIN_CONTRAST, over, WHITE, type Summary } from "./analysis";
import { MAX_EDIT_BYTES, MAX_ELEMENTS } from "./read";
import { doc, HEAD, load, text } from "./test-support";
import type { Rgb } from "./values";

/// I testi dell'indice.
function texts(source: string): string[] {
  return load(source).index.texts.map((t) => t.text);
}

/// Il rettangolo del riepilogo come `[x, y, larghezza, altezza]`.
function bbox(body: string): [number, number, number, number] | null {
  const box = load(doc(body)).summary.bbox;
  return box === null ? null : [box.x, box.y, box.width, box.height];
}

/// Un colore da `0xrrggbb`.
function hex(value: number): Rgb {
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

describe("i conti dell'analisi (src/analysis.rs)", () => {
  it("il contrasto segue WCAG", () => {
    expect(contrast(WHITE, [0, 0, 0])).toBe(21);
    expect(contrast(WHITE, WHITE)).toBe(1);
    // La tavolozza Okabe–Ito di FubDraw sulla carta bianca: tre colori sotto
    // 3:1.
    const ratio = (rgb: number): number => contrast(hex(rgb), WHITE);
    for (const below of [0xf0e442, 0xe69f00, 0x56b4e9]) {
      expect(ratio(below) < MIN_CONTRAST, below.toString(16)).toBe(true);
    }
    for (const above of [0x000000, 0x0072b2, 0x009e73, 0xd55e00, 0xcc79a7]) {
      expect(ratio(above) >= MIN_CONTRAST, above.toString(16)).toBe(true);
    }
  });

  it("l'opacità si compone sulla carta", () => {
    expect(over([0, 0, 0], 0.5, WHITE)).toEqual([128, 128, 128]);
    expect(over([0, 0, 0], 0, WHITE)).toEqual(WHITE);
    expect(over([10, 20, 30], 1, WHITE)).toEqual([10, 20, 30]);
  });

  it("il testo si comprime come in SVG", () => {
    expect(collapse("  a \t b\n\nc  ")).toBe("a b c");
    expect(collapse(" \n ")).toBe("");
    // Lo spazio indivisibile non è uno spazio XML.
    expect(collapse("a b")).toBe("a b");
  });

  it("i bordi del rettangolo si arrotondano con la regola di §7", () => {
    // La metà va verso +∞, anche sotto zero.
    expect(hundredths(0.125)).toBe(13);
    expect(hundredths(-0.125)).toBe(-12);
    // In doppia precisione 1,005 × 100 vale 100,4999…: come in §7.
    expect(hundredths(1.005)).toBe(100);
  });
});

describe("l'indice e il riepilogo (§9)", () => {
  it("titolo e descrizione sono i primi della radice", () => {
    const source = doc(
      "<title>\n  Ciclo  dell'acqua\n</title>" +
        "<desc>Dal mare <![CDATA[alle <nuvole>]]> &amp; ritorno</desc>" +
        "<title>Secondo</title>" +
        '<g fub:layer="A"><title>Del livello</title><desc>no</desc></g>',
    );
    const scene = load(source);
    const title = scene.index.title!;
    // Gli spazi come li disegna SVG.
    expect(title.text).toBe("Ciclo dell'acqua");
    expect(text(source, title).startsWith("<title>\n")).toBe(true);
    expect(scene.index.desc!.text).toBe("Dal mare alle <nuvole> & ritorno");
    // Senza titolo, o con un titolo vuoto, l'indice non ne ha.
    expect(load(doc("<rect/>")).index.title).toBeNull();
    expect(load(doc("<title> </title>")).index.title).toBeNull();
  });

  it("le entità di solo testo si leggono", () => {
    const source = `<!DOCTYPE svg [<!ENTITY nome "Giardino"><!ENTITY marca "<b/>">]>${doc("<title>&nome; &marca;fine</title>")}`;
    // Un'entità con marcatura non si espande: non è testo.
    expect(load(source).index.title!.text).toBe("Giardino fine");
  });

  it("ogni testo è un paragrafo con le righe unite", () => {
    const source = doc(
      // Un testo di FubDraw: una riga per `tspan`.
      '<g fub:layer="A"><text x="10" y="20">' +
        '<tspan x="10" dy="0">Evaporazione</tspan>' +
        '<tspan x="10" dy="20">e  condensa</tspan>' +
        // I pezzi di una riga sono parte della parola.
        '<tspan x="10" dy="20">e <tspan font-weight="bold">piog</tspan>gia</tspan></text></g>' +
        // Un testo estraneo, col suo `title` che non si disegna.
        '<text style="fill:red"><title>suggerimento</title>Pioggia <tspan>fitta</tspan></text>' +
        // Un testo vuoto non conta.
        '<text x="0" y="0"> </text>' +
        // Un `text` dentro un altro non si disegna.
        "<text>fuori<text>dentro</text></text>" +
        // Un collegamento dentro un testo è parte del paragrafo.
        '<text>vedi <a href="nota.md">la nota</a></text>',
    );
    expect(texts(source)).toEqual(["Evaporazione e condensa e pioggia", "Pioggia fitta", "fuori", "vedi la nota"]);
    const scene = load(source);
    expect(text(source, scene.index.texts[0]!).startsWith('<text x="10"')).toBe(true);
  });

  it("i collegamenti puntano nel vault", () => {
    const source = doc(
      '<a href="note/acqua.md"><circle r="1"/></a>' +
        '<a xlink:href="/radice.md"><rect/></a>' +
        // `href` vince su `xlink:href`, come in SVG 2.
        '<a href="vince.md" xlink:href="perde.md"/>' +
        // Un valore con un'entità: lo span è quello grezzo.
        '<a href=" a&amp;b.md "/>' +
        // Un `a` estraneo conta lo stesso: il backlink vale per il file.
        '<a href="estraneo.md" target="_blank"/>' +
        // Né siti, né frammenti, né altri schemi, né valori vuoti.
        '<a href="https://example.org"/><a href="#sopra"/><a href="mailto:x@y"/><a href=""/>',
    );
    const scene = load(source);
    const links = scene.index.links.map((l) => [l.path, text(source, l.href)]);
    expect(links).toEqual([
      ["note/acqua.md", "note/acqua.md"],
      ["/radice.md", "/radice.md"],
      ["vince.md", "vince.md"],
      ["a&b.md", " a&amp;b.md "],
      ["estraneo.md", "estraneo.md"],
    ]);
    expect(text(source, scene.index.links[0]!).startsWith("<a href=")).toBe(true);
    expect(text(source, scene.index.links[0]!).endsWith("</a>")).toBe(true);
  });

  it("le immagini del vault sono incorporate, quelle data si contano soltanto", () => {
    const source = doc(
      '<image href="foto/mare.png" width="10" height="10"/>' +
        '<image xlink:href="../schizzo.webp" width="10" height="10"/>' +
        '<image href="data:image/png;base64,AAAA" width="10" height="10"/>' +
        '<image href="https://example.org/a.png" width="10" height="10"/>',
    );
    const scene = load(source);
    expect(scene.index.embeds.map((e) => e.path)).toEqual(["foto/mare.png", "../schizzo.webp"]);
    expect(scene.summary.counts.images).toBe(4);
  });

  it("il riepilogo conta la scena modificabile", () => {
    const source = doc(
      "<title>Riepilogo</title>" +
        '<rect id="fub-paper" fub:role="paper" width="1600" height="1000" fill="#ffffff"/>' +
        '<g fub:layer="Schizzo">' +
        '<path fub:tool="pen" fub:brush="pf1" fub:ink="1 s100 cxypt 0,0,0,0 1,1,1,250 1,1,1,250" d="M0 0 L1 1 Z" fill="#000000"/>' +
        '<path fub:tool="highlighter" fub:brush="pf1" fub:ink="1 s10 cxyt 0,0,0 1,1,40" d="M0 0 L1 1 Z" fill="#f0e442"/>' +
        // Un tratto che non si legge conta, ma non il suo inchiostro.
        '<path fub:tool="pen" fub:brush="pf1" fub:ink="rotto" d="" fill="#000000"/>' +
        "</g>" +
        '<g fub:layer="Forme"><rect width="1" height="1"/><ellipse rx="1" ry="1"/>' +
        '<path fub:shape="arrow" fub:geom="0 0 1 1" d="M0 0 L1 1"/><line/><polygon points="0 0 1 1"/>' +
        '<text x="0" y="0"><tspan x="0" dy="0">a</tspan></text>' +
        '<a href="nota.md"><image width="1" height="1" href="foto.png"/></a>' +
        "<use/></g>" +
        "<!-- fine -->",
    );
    const expected: Summary = {
      version: 1,
      foreign: false,
      truncated: false,
      layers: ["Schizzo", "Forme"],
      boards: [],
      counts: { strokes: 3, shapes: 5, texts: 1, images: 1, links: 1, foreign: 2 },
      ink: { samples: 5, duration: 540 },
      // L'ellisse di raggio 1 intorno all'origine; la carta no.
      bbox: { x: -1, y: -1, width: 2, height: 2 },
    };
    expect(load(source).summary).toEqual(expected);
    // Un documento estraneo non ha versione.
    const foreign = load('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(foreign.summary.version).toBeNull();
    expect(foreign.summary.foreign).toBe(true);
  });

  it("il rettangolo segue le trasformazioni e gli estremi delle curve", () => {
    // Le curve contano per i loro estremi, non per i punti di controllo.
    expect(bbox('<path d="M0 0 Q50 100 100 0"/>')).toEqual([0, 0, 100, 50]);
    expect(bbox('<path d="M0 0 C0 100 100 100 100 0"/>')).toEqual([0, 0, 100, 75]);
    // Un quadrato ruotato di 45° dentro un livello spostato: i bordi si
    // arrotondano ai centesimi, e la larghezza è la differenza dei bordi.
    expect(
      bbox('<g fub:layer="A" transform="translate(100 0)">' + '<rect width="10" height="10" transform="rotate(45)"/></g>'),
    ).toEqual([92.93, 0, 14.14, 14.14]);
    // Un'ellisse ruotata di 90° scambia gli assi.
    expect(bbox('<ellipse cx="0" cy="0" rx="20" ry="10" transform="rotate(90)"/>')).toEqual([-10, -20, 20, 40]);
    // In SVG 2 un raggio assente vale l'altro.
    expect(bbox('<ellipse rx="5"/>')).toEqual([-5, -5, 10, 10]);
    // Le unità assolute si convertono: 1in = 96 unità.
    expect(bbox('<line x1="0" y1="0" x2="1in" y2="2.54cm"/>')).toEqual([0, 0, 96, 96]);
    // Di un testo contano i punti d'inizio delle righe.
    expect(
      bbox('<text x="10" y="20"><tspan x="10" dy="0">a</tspan>' + '<tspan x="30" dy="15">b</tspan></text>'),
    ).toEqual([10, 20, 20, 15]);
  });

  it("il rettangolo ignora la carta, gli estranei e ciò che è nascosto", () => {
    const body =
      '<rect fub:role="paper" width="1600" height="1000"/>' +
      '<rect x="10" y="10" width="5" height="5"/>' +
      '<g fub:layer="Nascosto" display="none"><rect x="500" width="5" height="5"/></g>' +
      '<rect x="-500" width="5" height="5" display="none"/>' +
      '<use x="900"/><rect x="900" width="1" height="1" style="x"/>';
    expect(bbox(body)).toEqual([10, 10, 5, 5]);
    // Senza niente di visibile il rettangolo non c'è.
    expect(bbox('<rect fub:role="paper" width="10" height="10"/><title>t</title>')).toBeNull();
    expect(bbox('<path d=""/>')).toBeNull();
  });

  it("una tavola senza nome si chiama col suo id, e la carta va con lei", () => {
    const body =
      '<rect id="c1" fub:role="paper" fub:board="b1" x="0" y="0" width="10" height="5"/>' +
      '<view id="b1" fub:role="board" viewBox="0 0 10 5"><title> \n </title></view>' +
      '<view id="b2" fub:role="board" viewBox="20 0 10 5"><title/><title>Due</title></view>' +
      '<defs><view id="b3" fub:role="board" viewBox="0 0 1 1"/></defs>';
    const scene = load(doc(body));
    expect(scene.summary.boards).toEqual(["b1", "b2"]);
    expect(scene.index.boards.map((board) => board.text)).toEqual(["b1", "b2"]);
    // La carta di `b1` non ha da dire; la `view` nella `defs` è estranea.
    expect(scene.diagnostics.map((d) => d.code)).toEqual(["S001", "S002"]);
    // Una tavola non entra nel rettangolo del disegno.
    expect(scene.summary.bbox).toBeNull();
  });

  it("un file troncato si riassume dalla sua testa", () => {
    const head = doc('<title>Grande</title><desc>d</desc><g fub:layer="Uno">').slice(0, -"</svg>".length);
    const filler = "<!-- riempitivo -->".repeat(Math.floor(MAX_EDIT_BYTES / 19) + 1);
    const scene = load(`${head}${filler}</g></svg>`);
    expect(scene.truncated).toBe(true);
    expect(scene.index.title!.text).toBe("Grande");
    expect(scene.index.desc!.text).toBe("d");
    const expected: Summary = {
      version: 1,
      foreign: false,
      truncated: true,
      layers: [],
      boards: [],
      counts: { strokes: 0, shapes: 0, texts: 0, images: 0, links: 0, foreign: 0 },
      ink: { samples: 0, duration: 0 },
      bbox: null,
    };
    expect(scene.summary).toEqual(expected);
  });

  it("un documento con troppi elementi si riassume lo stesso", () => {
    const source = doc('<rect width="1" height="1"/>'.repeat(MAX_ELEMENTS));
    const scene = load(source);
    expect(scene.items).toEqual([]);
    expect(scene.summary.counts.shapes).toBe(MAX_ELEMENTS);
    expect(scene.summary.bbox!.width).toBe(1);
    // La radice è ancora quella di sempre.
    expect(source.startsWith(HEAD)).toBe(true);
  });
});
