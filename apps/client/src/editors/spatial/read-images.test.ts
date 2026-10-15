// @vitest-environment happy-dom
// Le immagini della Lettura: quali `href` non si vedrebbero in un `<img>`, e il
// testo che le mostra.

import { describe, expect, it } from "vitest";
import { IMAGE_PLACEHOLDER } from "./painter/paint";
import { imageDataUri, imageRefs, withImages } from "./read-images";

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">';
const svg = (body: string): string => `${HEAD}${body}</svg>`;
const PNG_DATA = "data:image/png;base64,iVBORw0KGgo=";

/// Il testo che ogni riferimento copre.
const covered = (text: string): (readonly [string, string | null])[] => imageRefs(text).map((ref) => [text.slice(ref.start, ref.end), ref.path] as const);

describe("imageRefs", () => {
  it("trova gli href del vault, in ordine di testo, ripuliti come un URL", () => {
    const text = svg(
      `<image href=" sotto/b.png " width="10" height="10"/>`
        + `<g><image xlink:href="/radice/a.jpg" width="10" height="10"/></g>`
        + `<image href="c&amp;d.png" width="10" height="10"/>`,
    );
    expect(covered(text)).toEqual([
      [" sotto/b.png ", "sotto/b.png"],
      ["/radice/a.jpg", "/radice/a.jpg"],
      // Il valore si sostituisce com'è scritto, entità comprese.
      ["c&amp;d.png", "c&d.png"],
    ]);
  });

  it("lascia stare i data URI raster, e segna senza percorso i remoti e gli altri", () => {
    const text = svg(
      `<image href="${PNG_DATA}" width="10" height="10"/>`
        + `<image href="https://example.com/a.png" width="10" height="10"/>`
        + `<image href="data:image/svg+xml;base64,PHN2Zy8+" width="10" height="10"/>`
        + `<image href="//altro/a.png" width="10" height="10"/>`,
    );
    expect(covered(text)).toEqual([
      ["https://example.com/a.png", null],
      ["data:image/svg+xml;base64,PHN2Zy8+", null],
      ["//altro/a.png", null],
    ]);
  });

  it("guarda solo le immagini SVG, e i loro href", () => {
    const text = svg(
      `<a href="nota.md"><rect width="10" height="10"/></a>`
        + `<image src="a.png" width="10" height="10"/>`
        + `<foreignObject width="10" height="10"><image xmlns="urn:altro" href="b.png"/></foreignObject>`,
    );
    expect(imageRefs(text)).toEqual([]);
  });

  it("un testo che non si legge, o senza immagini, non ne ha", () => {
    expect(imageRefs("<svg><image href='a.png'")).toEqual([]);
    expect(imageRefs(svg(`<rect width="10" height="10"/>`))).toEqual([]);
  });
});

describe("withImages", () => {
  it("mette al posto di ogni href il data URI del suo percorso, o il segnaposto", () => {
    const text = svg(
      `<image href="a.png" width="10" height="10"/>`
        + `<image href="https://example.com/b.png" width="10" height="10"/>`
        + `<image xlink:href="manca.png" width="10" height="10"/>`
        + `<image href="a.png" width="10" height="10"/>`,
    );
    const shown = withImages(text, imageRefs(text), new Map([["a.png", PNG_DATA]]));
    expect(shown).toBe(
      svg(
        `<image href="${PNG_DATA}" width="10" height="10"/>`
          + `<image href="${IMAGE_PLACEHOLDER}" width="10" height="10"/>`
          + `<image xlink:href="${IMAGE_PLACEHOLDER}" width="10" height="10"/>`
          + `<image href="${PNG_DATA}" width="10" height="10"/>`,
      ),
    );
    // Il testo si legge ancora, e vi restano soltanto i segnaposti.
    expect(covered(shown)).toEqual([
      [IMAGE_PLACEHOLDER, null],
      [IMAGE_PLACEHOLDER, null],
    ]);
  });

  it("senza riferimenti il testo resta lo stesso", () => {
    const text = svg(`<rect width="10" height="10"/>`);
    expect(withImages(text, [], new Map())).toBe(text);
  });
});

describe("imageDataUri", () => {
  it("dà il data URI dei byte di un'immagine", async () => {
    const blob = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    expect(await imageDataUri(blob)).toBe("data:image/png;base64,iVBORw==");
  });

  it("rifiuta i byte che non si dicono un'immagine", async () => {
    expect(await imageDataUri(new Blob(["ciao"], { type: "text/plain" }))).toBeNull();
    expect(await imageDataUri(new Blob(["ciao"]))).toBeNull();
    // Un tipo con parametri o spazi non si scrive in un data URI così com'è.
    expect(await imageDataUri(new Blob(["ciao"], { type: "image/png; x=1" }))).toBeNull();
  });
});
