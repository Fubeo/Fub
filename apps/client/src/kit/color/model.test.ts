import { describe, expect, it } from "vitest";
import { contrastRatio, formatColor, hslToRgb, hsvToRgb, parseColor, parseHex, rgbToHsl, rgbToHsv, toHexText } from "./model";

describe("i conti del colore", () => {
  it("l'esadecimale si legge corto e lungo, con l'alfa, e si scrive minuscolo", () => {
    expect(parseHex("#FFF")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHex("0072b2")).toEqual({ r: 0, g: 114, b: 178, a: 1 });
    expect(parseHex("#00000080")).toEqual({ r: 0, g: 0, b: 0, a: 0.502 });
    expect(parseHex("#12345")).toBeNull();
    expect(toHexText({ r: 213, g: 94, b: 0, a: 1 })).toBe("#d55e00");
    expect(toHexText({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("#00000080");
  });

  it("HSV e HSL vanno e tornano", () => {
    for (const hex of ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9", "#f0e442", "#000000", "#ffffff", "#808080"]) {
      const rgb = parseHex(hex)!;
      expect(toHexText(hsvToRgb(rgbToHsv(rgb)))).toBe(hex);
      const { h, s, l } = rgbToHsl(rgb);
      expect(toHexText(hslToRgb(h, s, l))).toBe(hex);
    }
    // Un grigio tiene la tinta che gli si dà.
    expect(rgbToHsv({ r: 128, g: 128, b: 128, a: 1 }, 200).h).toBe(200);
  });

  it("scrive e rilegge nei quattro modi", () => {
    const blue = parseHex("#0072b2")!;
    expect(formatColor(blue, "hex")).toBe("#0072b2");
    expect(formatColor(blue, "rgb")).toBe("rgb(0 114 178)");
    expect(formatColor({ ...blue, a: 0.5 }, "rgb")).toBe("rgb(0 114 178 / 50%)");
    expect(formatColor(blue, "hsl")).toBe("hsl(202 100% 35%)");
    expect(formatColor(blue, "oklch")).toMatch(/^oklch\(\d+(\.\d+)?% 0\.\d+ \d+(\.\d+)?\)$/);
    for (const format of ["hex", "rgb", "oklch"] as const) {
      expect(toHexText(parseColor(formatColor(blue, format))!)).toBe("#0072b2");
    }
    expect(parseColor("rgba(0, 0, 0, 0.25)")).toEqual({ r: 0, g: 0, b: 0, a: 0.25 });
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("rosso")).toBeNull();
    expect(parseColor("rgb(1 2)")).toBeNull();
  });

  it("il contrasto è quello di WCAG", () => {
    expect(contrastRatio(parseHex("#000")!, parseHex("#fff")!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#f0e442")!, parseHex("#fff")!)).toBeLessThan(3);
  });
});
