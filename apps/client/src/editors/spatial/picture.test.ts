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

/// Un SVG coi testi `body`.
const SVG = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

describe("i caratteri dentro l'SVG", () => {
  it("entrano solo quelli che un testo usa, coi file come data URI, letti una volta", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const read = vi.fn(async (url: string) => new Blob([url.includes("literata") ? "L" : "I"]));
    const svg = SVG('<text font-family="Literata, serif">A</text><text style="font-family: \'Inter\'">B</text>');
    const css = await fontFaces(svg, read);
    expect(css).toContain('@font-face{font-family:"Literata";src:url(data:font/woff2;base64,TA==) format("woff2");font-weight:200 900;}');
    expect(css).toContain('@font-face{font-family:"Inter";src:url(data:font/woff2;base64,SQ==) format("woff2");font-weight:100 900;}');
    expect(css).not.toContain('"JetBrains Mono";src');
    await fontFaces(svg, read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await fontFaces(SVG('<rect width="1" height="1"/>'), read)).toBe("");
    // Un testo fuori dal namespace di SVG non è un testo.
    expect(await fontFaces("<svg><text>Inter</text></svg>", read)).toBe("");
  });

  it("il corsivo di un carattere entra soltanto se un testo lo chiede", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const read = vi.fn(async (url: string) => new Blob([url.includes("italic") ? "C" : "T"]));
    const upright = await fontFaces(SVG('<text font-family="Inter">a</text>'), read);
    expect(upright.match(/@font-face/g)).toHaveLength(1);
    expect(upright).not.toContain("font-style");
    const slanted = await fontFaces(SVG('<text font-family="Inter"><tspan font-style="italic">a</tspan></text>'), read);
    expect(slanted).toContain('font-family:"Inter";src:url(data:font/woff2;base64,Qw==) format("woff2");font-weight:100 900;font-style:italic;}');
    expect(slanted.match(/@font-face/g)).toHaveLength(1);
    expect(await fontFaces(SVG('<text style="font-family: Literata; font-style: oblique">a</text>'), read)).toContain('"Literata";src:url(data:font/woff2;base64,Qw==) format("woff2");font-weight:200 900;font-style:italic;}');
    expect(read.mock.calls.map(([url]) => url)).toEqual([
      "/fonts/inter-latin-wght-normal.woff2",
      "/fonts/inter-latin-wght-italic.woff2",
      "/fonts/literata-latin-wght-italic.woff2",
    ]);
  });

  it("dà a ogni font-family la famiglia dell'export, senza caratteri del sistema, e Literata dove nessuno la dice", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const read = vi.fn(async (_url: string) => new Blob(["F"]));
    const css = await fontFaces(SVG('<text font-family="Arial, sans-serif">a</text><text>b</text><g font-family="monospace"><text>c</text></g>'), read);
    expect(css).toContain(':root{font-synthesis:none}:where(:root:not([font-family])){font-family:Literata, Inter, "JetBrains Mono"}');
    expect(css).toContain(':where([font-family="Arial, sans-serif"]){font-family:Inter, Literata, "JetBrains Mono"}');
    expect(css).toContain(':where([font-family="monospace"]){font-family:"JetBrains Mono", Literata, Inter}');
    // Ogni testo trova la sua prima famiglia di Fub: Inter al posto di
    // Arial, Literata dove nessuno la dice, JetBrains Mono dal gruppo.
    expect(read.mock.calls.map(([url]) => url)).toEqual([
      "/fonts/inter-latin-wght-normal.woff2",
      "/fonts/literata-latin-wght-normal.woff2",
      "/fonts/jetbrains-mono-latin-wght-normal.woff2",
    ]);
  });

  it("una misura col carattere porta il carattere anche senza testi", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const css = await fontFaces(SVG('<rect width="3ex" height="3ex"/>'), async () => new Blob(["L"]));
    expect(css).toContain(':where(:root:not([font-family])){font-family:Literata, Inter, "JetBrains Mono"}');
    expect(css).toContain('@font-face{font-family:"Literata";src:url(data:font/woff2;base64,TA==)');
  });

  it("uno style dice la famiglia dell'export, e vince come lo style", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const css = await fontFaces(SVG('<text font-family="Inter" style="font-size:12px;font-family:sans-serif">a</text><text style="font-family: \'Un &lt;nome&gt;\'">b</text>'), async () => new Blob(["F"]));
    expect(css).toContain('[style="font-size:12px;font-family:sans-serif"]{font-family:Inter, Literata, "JetBrains Mono"!important}');
    expect(css).toContain('[style="font-family: \'Un \\3c nome\\3e \'"]{font-family:Literata, Inter, "JetBrains Mono"!important}');
    expect(css).not.toMatch(/[<>&]/);
  });

  it("i caratteri dei fogli di stile entrano, e un nome che il browser cercherebbe nel sistema prende la faccia dell'export", async () => {
    vi.resetModules();
    const { fontFaces, fontSheets, FUB_PICTURE_FAMILIES } = await import("./picture");
    const read = vi.fn(async (url: string) => new Blob([url.includes("inter") ? (url.includes("italic") ? "C" : "I") : "L"]));
    const css = await fontFaces(
      SVG('<style>.m text{font-family:"trebuchet ms", verdana, arial, sans-serif}.c{font-family:Helvetica, Inter}.g{font-family:sans-serif}.f{font-family:Inter}</style><g class="m"><text>Inizio</text><text font-style="italic">b</text></g>'),
      read,
    );
    expect(css).toContain('@font-face{font-family:"Inter";src:url(data:font/woff2;base64,SQ==) format("woff2");font-weight:100 900;}');
    expect(css).toContain('@font-face{font-family:"trebuchet ms";src:url(data:font/woff2;base64,SQ==) format("woff2");font-weight:100 900;}');
    expect(css).toContain('@font-face{font-family:"trebuchet ms";src:url(data:font/woff2;base64,Qw==) format("woff2");font-weight:100 900;font-style:italic;}');
    expect(css).toContain('@font-face{font-family:"Helvetica";src:url(data:font/woff2;base64,SQ==) format("woff2");font-weight:100 900;}');
    expect(css).toContain('@font-face{font-family:"Helvetica";src:url(data:font/woff2;base64,Qw==) format("woff2");font-weight:100 900;font-style:italic;}');
    // Una generica resta del browser, una famiglia di Fub ha già la sua faccia.
    expect(css.match(/@font-face/g)).toHaveLength(8);
    // Una famiglia del vault che viene prima del carattere di Fub tiene il posto.
    const families = { ...FUB_PICTURE_FAMILIES, picture: (value: string) => (value === "Avenir, Roboto, sans-serif" ? 'Roboto, Inter, Literata, "JetBrains Mono"' : FUB_PICTURE_FAMILIES.picture(value)) };
    const vault = await fontSheets(families, read).load(SVG('<style>text{font-family:Avenir, Roboto, sans-serif}</style><text>e</text>'));
    expect(vault).not.toContain('"Avenir"');
  });

  it("i nomi che prendono una faccia di Fub stanno sotto il loro tetto", async () => {
    vi.resetModules();
    const { fontFaces, MAX_FONT_SHEET_BYTES } = await import("./picture");
    const big = new Blob([new Uint8Array(100 * 1024)]);
    const rules = ["Uno", "Due", "Tre", "Quattro"].map((name, i) => `.n${i}{font-family:${name}}`).join("");
    const css = await fontFaces(SVG(`<style>${rules}</style><text>x</text>`), async () => big);
    expect(css).toContain('@font-face{font-family:"Uno";');
    expect(css).toContain('@font-face{font-family:"Due";');
    expect(css).not.toContain('@font-face{font-family:"Tre";');
    expect(css.length).toBeLessThanOrEqual(2 * MAX_FONT_SHEET_BYTES);
  });

  it("un nome con le virgolette o coi segni del markup resta dentro lo stile", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const css = await fontFaces(SVG('<text font-family=\'Un "&lt;nome&gt;" &amp; altro\'>a</text>'), async () => new Blob(["F"]));
    expect(css).toContain(':where([font-family="Un \\"\\3c nome\\3e \\" \\26  altro"]){font-family:Literata, Inter, "JetBrains Mono"}');
    expect(css).not.toMatch(/[<>&]/);
  });

  it("un file che non si legge non entra, e si riprova la volta dopo", async () => {
    vi.resetModules();
    const { fontFaces } = await import("./picture");
    const svg = SVG('<text font-family="JetBrains Mono">x</text>');
    expect(await fontFaces(svg, async () => null)).not.toContain("@font-face");
    expect(await fontFaces(svg, async () => new Blob(["J"]))).toContain('font-family:"JetBrains Mono";src');
  });

  it("subito, soltanto quando i caratteri che servono sono tutti già letti", async () => {
    vi.resetModules();
    const { fontFaces, fontFacesNow } = await import("./picture");
    const inter = SVG('<text font-family="Inter">a</text>');
    const both = SVG('<text font-family="Inter">a</text><text font-family="Literata">b</text>');
    expect(fontFacesNow(SVG("<rect/>"))).toBe("");
    expect(fontFacesNow(inter)).toBeNull();
    const css = await fontFaces(inter, async () => new Blob(["I"]));
    expect(fontFacesNow(inter)).toBe(css);
    // Literata manca ancora: il foglio non è completo.
    expect(fontFacesNow(both)).toBeNull();
  });

  it("porta le facce del vault che il disegno dà, e aspetta quelle che arrivano", async () => {
    vi.resetModules();
    const { fontSheets, FUB_PICTURE_FAMILIES } = await import("./picture");
    let arrived = false;
    const ready = vi.fn(async () => {
      arrived = true;
    });
    const families = {
      picture: (value: string) => (value === "Roboto, sans-serif" ? 'Roboto, Inter, Literata, "JetBrains Mono"' : FUB_PICTURE_FAMILIES.picture(value)),
      faces: (_fonts: unknown, strict: boolean) => (arrived ? '@font-face{font-family:"Roboto";src:url(data:application/octet-stream;base64,Ug==);font-weight:400;font-style:normal}' : strict ? null : ""),
      ready,
    };
    const sheets = fontSheets(families, async () => new Blob(["I"]));
    const svg = SVG('<text font-family="Roboto, sans-serif" font-weight="bold">a</text>');
    expect(sheets.now(svg)).toBeNull();
    const css = await sheets.load(svg);
    expect(ready).toHaveBeenCalledWith([expect.objectContaining({ family: "Roboto, sans-serif", weight: 700, style: "normal" })]);
    expect(css).toContain(':where([font-family="Roboto, sans-serif"]){font-family:Roboto, Inter, Literata, "JetBrains Mono"}');
    expect(css).toContain('@font-face{font-family:"Roboto";src:url(data:application/octet-stream;base64,Ug==)');
    // Il ripiego di Fub entra comunque: Inter, la generica di Roboto.
    expect(css).toContain('@font-face{font-family:"Inter";src:');
    expect(sheets.now(svg)).toBe(css);
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
    const svg = SVG(FONT_FILES.map(([family, , , style]) => `<text font-family="${family}" font-style="${style}">a</text>`).join(""));
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

describe("un disegno su un rettangolo", () => {
  const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"';

  it("mette la radice sul rettangolo, come la sezione di una tavola", async () => {
    const { framed, section } = await import("./picture");
    const svg = `${HEAD} viewBox="0 0 1300 400" width="1300" height="400"><view id="b00000001" fub:role="board" viewBox="700 0 600 400"><title>Copertina</title></view><rect width="9" height="9"/></svg>`;
    expect(framed(svg, [700, 0, 600, 400])).toBe(section(svg, "Copertina"));
    expect(framed(svg, [-12.5, 3, 80, 40.25])).toBe(svg.replace('viewBox="0 0 1300 400" width="1300" height="400"', 'viewBox="-12.5 3 80 40.25" width="80" height="40.25"'));
  });

  it("aggiunge gli attributi anche a una radice autochiusa, prima della barra", async () => {
    const { framed } = await import("./picture");
    expect(framed(`${HEAD}/>`, [0, 0, 210, 297])).toBe(`${HEAD} viewBox="0 0 210 297" width="210" height="297"/>`);
    expect(framed(`${HEAD} width="5" />`, [1, 2, 3, 4])).toBe(`${HEAD} width="3"  viewBox="1 2 3 4" height="4"/>`);
  });

  it("un testo che non si legge non ha rettangolo", async () => {
    const { framed } = await import("./picture");
    expect(framed(`${HEAD}><g></svg>`, [0, 0, 1, 1])).toBeNull();
  });
});

describe("le immagini del vault come data URI", () => {
  it("legge ogni percorso una volta, nel tetto che resta, e lascia fuori quelle che non si leggono", async () => {
    const { vaultSources } = await import("./picture");
    const { imageRefs } = await import("./read-images");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="a.png"/><image href="b.png"/><image href="c.png"/><image href="a.png"/><image href="data:image/png;base64,AA=="/></svg>';
    const limits: [string, number][] = [];
    const read = async (path: string, limit: number): Promise<Blob | null> => {
      limits.push([path, limit]);
      if (path === "b.png") return null;
      return new Blob([path === "a.png" ? "AAAA" : "CCCCCC"], { type: "image/png" });
    };
    const sources = await vaultSources(imageRefs(svg), read, 8);
    expect(limits).toEqual([["a.png", 8], ["b.png", 4], ["c.png", 4]]);
    expect([...sources]).toEqual([["a.png", "data:image/png;base64,QUFBQQ=="]]);
  });
});
