// Il PNG della selezione copiata: la misura, che il canvas di ogni browser
// tiene; la densità scritta nel file; i caratteri dell'app dentro l'SVG che
// il browser disegna.

import { describe, expect, it, vi } from "vitest";
import { fontFaces, MAX_PNG_AREA, MAX_PNG_SIDE, pngSize, withDensity, withStyle } from "./png";

/// Un PNG di un pixel, coi chunk senza dati veri: basta a contare i byte.
function tinyPng(extra: readonly string[] = []): Uint8Array {
  const chunk = (type: string, length: number): number[] => [0, 0, 0, length, ...[...type].map((c) => c.charCodeAt(0)), ...new Array<number>(length).fill(0), 0, 0, 0, 0];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", 13),
    ...extra.flatMap((type) => chunk(type, type === "pHYs" ? 9 : 0)),
    ...chunk("IDAT", 2),
    ...chunk("IEND", 0),
  ]);
}

const text = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));

describe("la misura del PNG", () => {
  it("ha due pixel per pixel CSS", () => {
    expect(pngSize(300, 150)).toEqual({ width: 600, height: 300, scale: 2 });
  });

  it("scende quanto serve per il lato e per l'area del canvas", () => {
    const long = pngSize(20000, 100)!;
    expect(long.width).toBe(MAX_PNG_SIDE);
    expect(long.scale).toBeCloseTo(MAX_PNG_SIDE / 20000);
    const large = pngSize(8000, 8000)!;
    expect(large.width * large.height).toBeLessThanOrEqual(MAX_PNG_AREA);
    expect(large.width).toBe(Math.floor(Math.sqrt(MAX_PNG_AREA)));
  });

  it("non c'è per un disegno senza misura", () => {
    expect(pngSize(0, 10)).toBeNull();
    expect(pngSize(Number.NaN, 10)).toBeNull();
  });
});

describe("la densità del PNG", () => {
  it("si scrive in un pHYs dopo IHDR, in pixel per metro, col suo CRC", () => {
    const png = withDensity(tinyPng(), 2);
    expect(png.length).toBe(tinyPng().length + 21);
    expect(text(png, 37, 41)).toBe("pHYs");
    const view = new DataView(png.buffer);
    expect(view.getUint32(33)).toBe(9);
    // 192 dpi.
    expect(view.getUint32(41)).toBe(7559);
    expect(view.getUint32(45)).toBe(7559);
    expect(png[49]).toBe(1);
    // Il CRC-32 di «pHYs», dei due 7559 e del metro, come lo dà zlib.
    expect(view.getUint32(50)).toBe(0x8fe5f165);
    expect(text(png, 58, 62)).toBe("IDAT");
  });

  it("resta quella che il PNG dice già, e un file che non è un PNG resta com'è", () => {
    const said = tinyPng(["pHYs"]);
    expect(withDensity(said, 2)).toBe(said);
    const other = new Uint8Array([1, 2, 3]);
    expect(withDensity(other, 2)).toBe(other);
  });
});

describe("i caratteri dentro l'SVG", () => {
  it("entrano solo quelli che un testo nomina, coi file come data URI, letti una volta", async () => {
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

  it("un file che non si legge non entra, e si riprova la volta dopo", async () => {
    const svg = '<svg><text font-family="JetBrains Mono">x</text></svg>';
    expect(await fontFaces(svg, async () => null)).toBe("");
    expect(await fontFaces(svg, async () => new Blob(["J"]))).toContain('font-family:"JetBrains Mono"');
  });

  it("vanno in uno stile, primo figlio della radice, anche con un prefisso", () => {
    expect(withStyle('<svg xmlns="http://www.w3.org/2000/svg" a=">"><g/></svg>', "@font-face{}")).toBe('<svg xmlns="http://www.w3.org/2000/svg" a=">"><style>@font-face{}</style><g/></svg>');
    expect(withStyle('<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g/></s:svg>', "x{}")).toBe('<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:style>x{}</s:style><s:g/></s:svg>');
    expect(withStyle("<svg/>", "x{}")).toBe("<svg/>");
    expect(withStyle("<svg", "x{}")).toBe("<svg");
  });
});
