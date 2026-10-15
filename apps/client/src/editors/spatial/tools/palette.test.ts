// La tavolozza dell'Essenziale: otto colori di Okabe–Ito, ognuno con la sua
// forma, e tre spessori; poi gli spessori dell'evidenziatore e i colori a
// piacere dello Standard.

import { describe, expect, it } from "vitest";
import { contrast } from "../scene/analysis";
import {
  customColor,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  HIGHLIGHTER_COLOR,
  HIGHLIGHTER_WIDTH,
  HIGHLIGHTER_WIDTHS,
  isLight,
  PALETTE,
  swatchOf,
  WIDTHS,
} from "./palette";

const rgb = (hex: string): readonly [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

describe("la tavolozza", () => {
  it("ha gli otto colori di Okabe–Ito, scritti come li scrive il file", () => {
    expect(PALETTE.map((swatch) => swatch.color)).toEqual([
      "#000000", "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9", "#f0e442",
    ]);
    for (const swatch of PALETTE) expect(swatch.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("dà a ogni colore una forma e un nome diversi", () => {
    expect(new Set(PALETTE.map((swatch) => swatch.shape)).size).toBe(PALETTE.length);
    expect(new Set(PALETTE.map((swatch) => swatch.label)).size).toBe(PALETTE.length);
    expect(new Set(PALETTE.map((swatch) => swatch.id)).size).toBe(PALETTE.length);
  });

  it("segna come chiari proprio i colori sotto 3:1 sulla carta bianca", () => {
    for (const swatch of PALETTE) {
      expect(swatch.light, swatch.id).toBe(contrast(rgb(swatch.color), [255, 255, 255]) < 3);
    }
    expect(PALETTE.filter((swatch) => swatch.light).map((swatch) => swatch.id)).toEqual(["orange", "sky", "yellow"]);
  });

  it("parte dal nero e dallo spessore medio", () => {
    expect(DEFAULT_COLOR).toBe("#000000");
    expect(WIDTHS.map((width) => width.value)).toEqual([2, 4, 8]);
    expect(DEFAULT_WIDTH).toBe(4);
  });

  it("dà all'evidenziatore il giallo della tavolozza e spessori suoi, coi nomi della penna", () => {
    expect(swatchOf(HIGHLIGHTER_COLOR)?.id).toBe("yellow");
    expect(HIGHLIGHTER_WIDTHS.map((width) => width.value)).toEqual([8, 16, 24]);
    expect(HIGHLIGHTER_WIDTHS.map((width) => width.label)).toEqual(WIDTHS.map((width) => width.label));
    expect(HIGHLIGHTER_WIDTH).toBe(16);
  });
});

describe("i colori a piacere", () => {
  it("si scrivono come quelli della tavolozza, da un codice o da un nome CSS", () => {
    expect(customColor("#3A7BD5")).toBe("#3a7bd5");
    expect(customColor(" 3a7bd5 ")).toBe("#3a7bd5");
    expect(customColor("#abc")).toBe("#aabbcc");
    expect(customColor("abc")).toBe("#aabbcc");
    expect(customColor("teal")).toBe("#008080");
  });

  it("non valgono `none`, un codice monco o un nome sconosciuto", () => {
    for (const input of ["", "none", "#12345", "1234", "rosso", "rgb(1, 2, 3)", "#ggg", "Teal"]) expect(customColor(input), input).toBeNull();
  });

  it("si dicono chiari sotto 3:1 sulla carta bianca, come la tavolozza", () => {
    for (const swatch of PALETTE) expect(isLight(swatch.color), swatch.id).toBe(swatch.light);
    expect(isLight("#eeeeee")).toBe(true);
    expect(isLight("#3a7bd5")).toBe(false);
  });
});
