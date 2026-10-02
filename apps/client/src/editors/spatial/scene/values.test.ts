// I valori degli attributi: gli stessi casi dei test di unità di `values.rs`
// in `fub-scene`. La tabella dei colori con nome di Rust è un array ordinato
// per la ricerca binaria; qui è una `Map`, e il controllo corrispondente è che
// abbia gli stessi 148 nomi, tutti in minuscolo, senza `transparent` e
// `currentcolor`.

import { describe, expect, it } from "vitest";
import { IDENTITY } from "./matrix";
import {
  dasharray,
  href,
  isJavascript,
  keyword,
  length,
  NAMED_COLORS,
  nonNegativeLength,
  number,
  paint,
  points,
  preserveAspectRatio,
  transform,
} from "./values";

describe("i valori degli attributi (values.rs)", () => {
  it("i numeri seguono i browser", () => {
    expect(number("-1.5")).toBe(-1.5);
    expect(number(".5")).toBe(0.5);
    expect(number("+1e3")).toBe(1000);
    expect(number(" 2 ")).toBe(2);
    expect(number("1.")).toBeNull();
    expect(number("1e")).toBeNull();
    expect(number("1e+")).toBeNull();
    expect(number(".")).toBeNull();
    expect(number("")).toBeNull();
    expect(number("1e39")).toBeNull();
    expect(number("1 2")).toBeNull();
    expect(number("0x10")).toBeNull();
  });

  it("le lunghezze convertono solo le unità assolute", () => {
    expect(length("10")).toBe(10);
    expect(length("10px")).toBe(10);
    expect(length("1in")).toBe(96);
    expect(length("72pt")).toBe(96);
    expect(length("6pc")).toBe(96);
    expect(Math.abs(length("2.54cm")! - 96)).toBeLessThan(1e-9);
    expect(Math.abs(length("25.4mm")! - 96)).toBeLessThan(1e-9);
    expect(Math.abs(length("101.6Q")! - 96)).toBeLessThan(1e-9);
    expect(length("1e2px")).toBe(100);
    for (const relative of ["10%", "1em", "1ex", "2rem", "3ch", "1vw", "1vh", "auto", "10PX", "1q", "calc(1px)"]) {
      expect(length(relative), relative).toBeNull();
    }
    expect(nonNegativeLength("-1")).toBeNull();
    expect(nonNegativeLength("0")).toBe(0);
  });

  it("i colori sono le forme elencate", () => {
    expect(paint("none")).toBe("none");
    expect(paint("#0072b2")).toEqual([0, 0x72, 0xb2]);
    expect(paint("#FFF")).toEqual([255, 255, 255]);
    expect(paint("rebeccapurple")).toEqual([0x66, 0x33, 0x99]);
    for (const bad of ["Red", "currentColor", "transparent", "inherit", "rgb(0,0,0)", "#ffff", "#12345g", "", "url(#g)"]) {
      expect(paint(bad), bad).toBeNull();
    }
    // La tabella di Rust: 148 nomi, in minuscolo, senza le due parole chiave.
    expect(NAMED_COLORS.size).toBe(148);
    for (const [name, rgb] of NAMED_COLORS) {
      expect(/^[a-z]+$/.test(name), name).toBe(true);
      expect(rgb >= 0 && rgb <= 0xffffff, name).toBe(true);
    }
    expect(NAMED_COLORS.has("transparent") || NAMED_COLORS.has("currentcolor")).toBe(false);
  });

  it("parole chiave e liste", () => {
    expect(keyword("display", "none")).toBe(true);
    expect(keyword("display", "NONE")).toBe(false);
    expect(keyword("display", "inherit")).toBe(false);
    expect(keyword("font-weight", "700")).toBe(true);
    expect(keyword("font-weight", "750")).toBe(false);
    expect(dasharray("none")).toBe(true);
    expect(dasharray("5, 3 2mm")).toBe(true);
    expect(dasharray("5,,3")).toBe(false);
    expect(dasharray("-1")).toBe(false);
    expect(dasharray("10%")).toBe(false);
    expect(dasharray("")).toBe(false);
    expect(preserveAspectRatio("xMidYMid meet")).toBe(true);
    expect(preserveAspectRatio("none")).toBe(true);
    expect(preserveAspectRatio("xmidymid")).toBe(false);
    expect(preserveAspectRatio("xMidYMid meet slice")).toBe(false);
    expect(points("0,0 10-20 1.5.5")).toEqual([
      [0, 0],
      [10, -20],
      [1.5, 0.5],
    ]);
    expect(points("")).toEqual([]);
    expect(points("1 2 3")).toBeNull();
    expect(points("1,2,")).toBeNull();
    expect(points(",1 2")).toBeNull();
  });

  it("le trasformazioni si compongono da sinistra a destra", () => {
    const expected = [2, 0, 0, 2, 10, 20];
    expect(transform("translate(10 20) scale(2)")).toEqual(expected);
    expect(transform("translate(10,20)scale(2)")).toEqual(expected);
    const [a, b, c, d, e, f] = transform("rotate(90 10 10)")!;
    const rotated = [a * 20 + c * 10 + e, b * 20 + d * 10 + f];
    expect(Math.abs(rotated[0]! - 10) < 1e-9 && Math.abs(rotated[1]! - 20) < 1e-9).toBe(true);
    expect(transform("")).toEqual(IDENTITY);
    expect(transform("matrix(1 0 0 1 0 0)")).not.toBeNull();
    for (const bad of [
      "translate(1,)",
      "translate(1),",
      "Translate(1)",
      "rotate(45deg)",
      "scale()",
      "rotate(1 2)",
      "skewX(1 2)",
      "matrix(1 2 3 4 5)",
      "translate 1",
    ]) {
      expect(transform(bad), bad).toBeNull();
    }
  });

  it("gli href si classificano come URL", () => {
    expect(href("note.md")).toEqual({ kind: "vault", url: "note.md" });
    expect(href(" /a/b.md#x ")).toEqual({ kind: "vault", url: "/a/b.md#x" });
    expect(href("#frag")).toEqual({ kind: "other" });
    expect(href("")).toEqual({ kind: "other" });
    expect(href("//host/a.png")).toEqual({ kind: "other" });
    expect(href("https://example.org/a.png")).toEqual({ kind: "remote" });
    expect(href("mailto:a@b")).toEqual({ kind: "other" });
    expect(href("data:image/png;base64,AAAA")).toEqual({ kind: "data", raster: true, bytes: 3 });
    expect(href("data:image/svg+xml,%3Csvg%2F%3E")).toEqual({ kind: "data", raster: false, bytes: 6 });
    expect(isJavascript("java\tscript:alert(1)")).toBe(true);
    expect(isJavascript(" JavaScript:x")).toBe(true);
    expect(isJavascript("javascript.md")).toBe(false);
    expect(isJavascript("note/javascript:x")).toBe(false);
  });
});
