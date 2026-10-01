// @vitest-environment happy-dom
// La view immagine: la firma decide, non il nome. Un SVG con il suo prologo
// XML resta un SVG; le misure si leggono dai byte quando ci sono; un formato
// che la webview non decodifica lo dice a parole; il `blob:` si revoca una
// volta sola, anche se l'immagine si rompe prima.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeImage, imageInfo, mountImageView, svgSize, svgStart } from "./image-view";
import type { ResourceDescriptor } from "./media-types";
import { openLifetime } from "../../ui/lifetime";
import { setReducedMotionPreference } from "../../theme/reduced-motion";

function descriptor(id: string, mime: string, len = 0): ResourceDescriptor {
  return { id, mime, len, handle: "1", revision: "1" } as unknown as ResourceDescriptor;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

beforeEach(() => {
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:immagine-${++next}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("dove comincia un SVG", () => {
  it("salta BOM, dichiarazione, commenti e DOCTYPE con sottoinsieme interno", () => {
    expect(svgStart("<svg/>")).toBe(0);
    expect(svgStart("﻿  <svg width='1'>")).toBe(3);
    const prologue = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- licenza: CC0 -->\n'
      + '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" [\n  <!ENTITY ns "http://example.test/>">\n]>\n';
    const text = `${prologue}<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    expect(svgStart(text)).toBe(prologue.length);
    expect(svgStart("<SVG>")).toBe(0);
  });

  it("rifiuta ciò che non è un elemento svg", () => {
    expect(svgStart("<svgx>")).toBeNull();
    expect(svgStart("<html><svg/></html>")).toBeNull();
    expect(svgStart("<!-- non chiuso <svg/>")).toBeNull();
    expect(svgStart("")).toBeNull();
  });
});

describe("le misure di un SVG", () => {
  it("usa width e height in px, poi la viewBox, e non inventa", () => {
    expect(svgSize('<svg width="120" height="40px">')).toEqual({ width: 120, height: 40 });
    expect(svgSize("<svg viewBox='0 0 300 150'>")).toEqual({ width: 300, height: 150 });
    expect(svgSize('<svg width="600" viewBox="0,0,300,150">')).toEqual({ width: 600, height: 300 });
    expect(svgSize('<svg height="75" viewBox="0 0 300 150">')).toEqual({ width: 150, height: 75 });
    expect(svgSize('<svg width="100%" height="2em">')).toBeNull();
    expect(svgSize('<svg viewBox="0 0 0 10">')).toBeNull();
  });
});

describe("decodeImage", () => {
  it("accetta un SVG con prologo e ne legge le misure", () => {
    const image = decodeImage(
      descriptor("logo.svg", "image/svg+xml"),
      utf8('<?xml version="1.0"?>\n<!-- x -->\n<svg viewBox="0 0 64 32"></svg>'),
    );
    expect(image).toMatchObject({ width: 64, height: 32, format: "SVG" });
    expect(image.blob.type).toBe("image/svg+xml");
  });

  it("rifiuta un finto SVG dicendo come comincia", () => {
    expect(() => decodeImage(descriptor("x.svg", "image/svg+xml"), utf8("<html>ciao</html>")))
      .toThrow(/claims SVG but starts with "<html>ciao/);
  });

  it("legge le misure di PNG e GIF dai byte", () => {
    expect(decodeImage(descriptor("a.png", "image/png"), png(640, 480))).toMatchObject({ width: 640, height: 480, format: "PNG" });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00]);
    expect(decodeImage(descriptor("b.gif", "image/gif"), gif)).toMatchObject({ width: 32, height: 16, format: "GIF" });
    // Misure implausibili non si mostrano.
    expect(decodeImage(descriptor("c.png", "image/png"), png(0, 480))).toMatchObject({ width: null, height: null });
  });

  it("riconosce le icone", () => {
    const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
    expect(decodeImage(descriptor("favicon.ico", "image/vnd.microsoft.icon"), ico)).toMatchObject({ format: "ICO" });
    expect(() => decodeImage(descriptor("finta.ico", "image/vnd.microsoft.icon"), new Uint8Array([0, 0, 2, 0])))
      .toThrow(/claims ICO/);
  });

  it("dice a parole che HEIC e TIFF non si mostrano", () => {
    expect(() => decodeImage(descriptor("foto.heic", "image/heic"), new Uint8Array([1, 2, 3])))
      .toThrow(/HEIC/);
    expect(() => decodeImage(descriptor("scan.tiff", "image/tiff"), new Uint8Array([1, 2, 3])))
      .toThrow(/TIFF/);
  });

  it("un file vuoto è un errore, non un riquadro vuoto", () => {
    expect(() => decodeImage(descriptor("vuota.png", "image/png"), new Uint8Array())).toThrow(/empty/);
  });
});

describe("la view montata", () => {
  beforeEach(() => setReducedMotionPreference(true));
  afterEach(() => setReducedMotionPreference(false));

  it("mostra formato, misure e peso", () => {
    const image = decodeImage(descriptor("a.png", "image/png"), png(640, 480));
    expect(imageInfo(image, 640, 480)).toBe("PNG · 640 × 480 px · 24 B");
    expect(imageInfo(image, null, null)).toBe("PNG · 24 B");
    const life = openLifetime();
    const view = mountImageView(image, "a.png", life);
    document.body.append(view.element);
    expect(view.element.className).toBe("media-image");
    expect(view.element.querySelector(".zoom-view")).not.toBeNull();
    expect(view.element.querySelector(".zoom-info")!.textContent).toBe("PNG · 640 × 480 px · 24 B");
    expect(view.element.querySelector(".zoom-view")!.getAttribute("data-backdrop")).toBe("checker");
    life.close();
  });

  it("un'immagine rotta dice quale, e il blob si revoca una volta sola", () => {
    const image = decodeImage(descriptor("rotta.png", "image/png"), png(10, 10));
    const life = openLifetime();
    const view = mountImageView(image, "rotta.png", life);
    document.body.append(view.element);
    view.element.querySelector("img")!.dispatchEvent(new Event("error"));
    const alert = view.element.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("rotta.png");
    view.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(image.url);
    expect(view.element.isConnected).toBe(false);
  });
});
