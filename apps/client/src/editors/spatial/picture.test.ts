// @vitest-environment happy-dom
// Il disegno come immagine che si vede da sola: i caratteri dell'app dentro
// la copia che va nell'immagine, letti una volta, col loro tetto.

import { describe, expect, it, vi } from "vitest";
import { IMAGE_PLACEHOLDER } from "./painter/paint";
import { FONT_FILES } from "./tools/text";

/// I file veri dei caratteri, come data URI.
const FILES = import.meta.glob<string>("../../../public/fonts/*.woff2", { query: "?inline", import: "default", eager: true });

/// I byte del carattere `url` dell'app.
function fontFile(url: string): Blob {
  const uri = Object.entries(FILES).find(([path]) => path.endsWith(url))![1];
  const bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  return new Blob([bytes as BlobPart]);
}

describe("i caratteri dentro l'SVG", () => {
  it("entrano solo quelli che un testo nomina, coi file come data URI, letti una volta", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const read = vi.fn(async (url: string) => new Blob([url.includes("literata") ? "L" : "I"]));
    const svg = '<svg><text font-family="Literata, serif">A</text><text style="font-family: \'Inter\'">B</text></svg>';
    const css = await fontFaces(svg, read);
    expect(css).toContain('@font-face{font-family:"Literata";src:url(data:font/woff2;base64,TA==) format("woff2");font-weight:200 900;unicode-range:U+0000-00FF');
    expect(css).toContain('font-family:"Inter";src:url(data:font/woff2;base64,SQ==)');
    expect(css).not.toContain("JetBrains Mono");
    await fontFaces(svg, read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await fontFaces("<svg><text>Inter</text></svg>", read)).toBe("");
  });

  it("il corsivo di un carattere entra soltanto se un testo lo chiede", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const read = vi.fn(async (url: string) => new Blob([url.includes("italic") ? "C" : "T"]));
    const upright = await fontFaces('<svg><text font-family="Inter">a</text></svg>', read);
    expect(upright.match(/@font-face/g)).toHaveLength(1);
    expect(upright).not.toContain("font-style");
    const slanted = await fontFaces('<svg><text font-family="Inter"><tspan font-style="italic">a</tspan></text></svg>', read);
    expect(slanted).toContain('font-family:"Inter";src:url(data:font/woff2;base64,Qw==) format("woff2");font-weight:100 900;font-style:italic;unicode-range:');
    expect(slanted).not.toContain("Literata");
    expect(await fontFaces('<svg><text style="font-family: Literata; font-style: oblique">a</text></svg>', read)).toContain("font-style:italic");
    expect(read.mock.calls.map(([url]) => url)).toEqual([
      "/fonts/inter-latin-wght-normal.woff2",
      "/fonts/inter-latin-wght-italic.woff2",
      "/fonts/literata-latin-wght-normal.woff2",
      "/fonts/literata-latin-wght-italic.woff2",
    ]);
  });

  it("un file che non si legge non entra, e si riprova la volta dopo", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const svg = '<svg><text font-family="JetBrains Mono">x</text></svg>';
    expect(await fontFaces(svg, async () => null)).toBe("");
    expect(await fontFaces(svg, async () => new Blob(["J"]))).toContain('font-family:"JetBrains Mono"');
  });

  it("subito, soltanto quando i caratteri nominati sono tutti già letti", async () => {
    vi.resetModules();
    const { fontFaces, fontFacesNow } = await import("./picture");
    const inter = '<svg><text font-family="Inter">a</text></svg>';
    const both = '<svg><text font-family="Inter">a</text><text font-family="Literata">b</text></svg>';
    expect(fontFacesNow("<svg><text>Inter</text></svg>")).toBe("");
    expect(fontFacesNow(inter)).toBeNull();
    const css = await fontFaces(inter, async () => new Blob(["I"]));
    expect(fontFacesNow(inter)).toBe(css);
    // Literata manca ancora: il foglio non è completo.
    expect(fontFacesNow(both)).toBeNull();
  });

  it("vanno in uno stile, primo figlio della radice, anche con un prefisso", async () => {
    const { withStyle } = await import("./picture");
    expect(withStyle('<svg xmlns="http://www.w3.org/2000/svg" a=">"><g/></svg>', "@font-face{}")).toBe('<svg xmlns="http://www.w3.org/2000/svg" a=">"><style>@font-face{}</style><g/></svg>');
    expect(withStyle('<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g/></s:svg>', "x{}")).toBe('<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:style>x{}</s:style><s:g/></s:svg>');
    expect(withStyle("<svg/>", "x{}")).toBe("<svg/>");
    expect(withStyle("<svg", "x{}")).toBe("<svg");
  });

  it("tutti e tre i caratteri veri, in tondo e in corsivo, stanno sotto il tetto di ogni immagine", async () => {
    vi.resetModules();
    const { fontFaces, MAX_FONT_SHEET_BYTES } = await import("./picture");
    const svg = `<svg>${FONT_FILES.map(([family, , , style]) => `<text font-family="${family}" font-style="${style}">a</text>`).join("")}</svg>`;
    const css = await fontFaces(svg, async (url) => fontFile(url));
    expect(css.match(/@font-face/g)).toHaveLength(6);
    expect(fontFile(FONT_FILES[0]![1]).size).toBeGreaterThan(40_000);
    expect(css.length).toBeLessThanOrEqual(MAX_FONT_SHEET_BYTES);
    // Il tetto non è largo per niente: i file veri ci arrivano vicino.
    expect(css.length).toBeGreaterThan(MAX_FONT_SHEET_BYTES * 0.9);
  });
});

describe("un disegno che si vede da solo, in un colpo", () => {
  it("porta le immagini del vault finché stanno nel tetto, e i caratteri che nomina", async () => {
    const { selfContained } = await import("./picture");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="a.png"/><image href="b.png"/><image href="a.png"/><text font-family="Inter">x</text></svg>';
    const limits: number[] = [];
    const read = async (path: string, limit: number): Promise<Blob> => {
      limits.push(limit);
      return new Blob([path === "a.png" ? "AAAA" : "BBBBBB"], { type: "image/png" });
    };
    const fonts = { now: () => null, load: async () => "@font-face{}" };
    const shown = await selfContained(svg, read, 8, fonts);
    // La stessa immagine si legge una volta; la seconda non ci sta più.
    expect(limits).toEqual([8, 4]);
    expect(shown).toBe('<svg xmlns="http://www.w3.org/2000/svg"><style>@font-face{}</style>'
      + `<image href="data:image/png;base64,QUFBQQ=="/><image href="${IMAGE_PLACEHOLDER}"/><image href="data:image/png;base64,QUFBQQ=="/>`
      + '<text font-family="Inter">x</text></svg>');
  });
});

describe("la sezione di un disegno", () => {
  const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"';
  const BOARDS = '<title>Storia</title>'
    + '<view id="b00000001" fub:role="board" viewBox="0 0 600 400"><title>Copertina</title></view>'
    + '<view id="b00000002" fub:role="board" viewBox="700,0,600,400"><title>  Due\n  tavole </title><desc>La seconda</desc></view>'
    + '<view id="b00000003" fub:role="board" viewBox="0 500 300 200.5"/>'
    + '<view id="b00000004" fub:role="board" viewBox="700 500 600 400"><title>Copertina</title></view>'
    + '<view id="b00000005" fub:role="board" viewBox="0 1000 600 400"><title>Storia</title></view>'
    + '<view id="v1" viewBox="0 0 10 10"><title>Vista</title></view>'
    + '<rect x="0" y="0" width="10" height="10"/></svg>';
  const DRAWING = `${HEAD} viewBox="0 0 1300 1400" width="1300" height="1400">${BOARDS}`;

  it("il titolo è il disegno intero, anche se una tavola si chiama come lui", async () => {
    const { section } = await import("./picture");
    expect(section(DRAWING, "Storia")).toBe(DRAWING);
  });

  it("una tavola è il disegno con la radice sul suo rettangolo, e conta la prima con quel nome", async () => {
    const { section } = await import("./picture");
    const body = DRAWING.slice(DRAWING.indexOf(">") + 1);
    expect(section(DRAWING, "Copertina")).toBe(`${HEAD} viewBox="0 0 600 400" width="600" height="400">${body}`);
    // Il nome è quello dell'indice: spazi ridotti, e l'id se manca il titolo.
    expect(section(DRAWING, "Due tavole")).toBe(`${HEAD} viewBox="700 0 600 400" width="600" height="400">${body}`);
    expect(section(DRAWING, "b00000003")).toBe(`${HEAD} viewBox="0 500 300 200.5" width="300" height="200.5">${body}`);
  });

  it("gli attributi che la radice non ha si aggiungono in fondo al tag d'apertura", async () => {
    const { section } = await import("./picture");
    const bare = `${HEAD} height='9mm'\n>${BOARDS}`;
    expect(section(bare, "Copertina")).toBe(`${HEAD} height='400'\n viewBox="0 0 600 400" width="600">${BOARDS}`);
  });

  it("trova la tavola anche dopo un BOM, righe CRLF e caratteri fuori dall'ASCII", async () => {
    const { section } = await import("./picture");
    const source = `\u{feff}${HEAD} viewBox="0 0 10 10">\r\n<title>Città 𝄞</title>\r\n`
      + '<view id="b00000001" fub:role="board" viewBox="1 2 3 4"><title>Più è</title></view>\r\n'
      + '<view id="b00000002" fub:role="board" viewBox="5 6 7 8"><title>Già</title></view></svg>';
    expect(section(source, "Già")).toBe(source.replace('viewBox="0 0 10 10">', 'viewBox="5 6 7 8" width="7" height="8">'));
  });

  it("un altro nome non è una sezione, e un file che non è una scena non ne ha", async () => {
    const { section } = await import("./picture");
    for (const name of ["Retro", "copertina", "Due  tavole", "Vista", "v1", "La seconda", ""]) {
      expect(section(DRAWING, name), name).toBeNull();
    }
    expect(section(`${HEAD}><title>Storia</title><g></svg>`, "Storia")).toBeNull();
    expect(section('<html xmlns="http://www.w3.org/1999/xhtml"><title>Storia</title></html>', "Storia")).toBeNull();
  });
});
