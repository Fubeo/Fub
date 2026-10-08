// I valori degli attributi: gli stessi casi dei test di unità di `values.rs`
// in `fub-scene`. La tabella dei colori con nome di Rust è un array ordinato
// per la ricerca binaria; qui è una `Map`, e il controllo corrispondente è che
// abbia gli stessi 148 nomi, tutti in minuscolo, senza `transparent` e
// `currentcolor`.

import { describe, expect, it } from "vitest";
import { IDENTITY } from "./matrix";
import {
  angle,
  blendStyle,
  dasharray,
  fraction,
  href,
  hrefId,
  isJavascript,
  keyword,
  length,
  NAMED_COLORS,
  nonNegativeLength,
  number,
  oneOrTwo,
  paint,
  paintReference,
  percentage,
  points,
  preserveAspectRatio,
  reference,
  startOffset,
  transform,
  urlIds,
  viewBox,
  wrapWidth,
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

  it("lo style del formato dice soltanto la fusione e l'isolamento", () => {
    const multiply = { blend: "multiply", isolate: null };
    expect(blendStyle("mix-blend-mode: multiply", false)).toEqual(multiply);
    expect(blendStyle(" mix-blend-mode:multiply ; ", false)).toEqual(multiply);
    expect(blendStyle("isolation: isolate; mix-blend-mode: screen", true)).toEqual({
      blend: "screen",
      isolate: true,
    });
    expect(blendStyle("isolation: auto", true)).toEqual({ blend: null, isolate: false });
    // Soltanto un contenitore isola.
    expect(blendStyle("isolation: isolate", false)).toBeNull();
    for (const wrong of [
      "",
      ";",
      "mix-blend-mode",
      "mix-blend-mode: Multiply",
      "MIX-BLEND-MODE: multiply",
      "mix-blend-mode: plus-lighter",
      "mix-blend-mode: multiply !important",
      "mix-blend-mode: multiply; mix-blend-mode: screen",
      "mix-blend-mode: multiply;; isolation: isolate",
      "mix-blend-mode: /* x */ multiply",
      "fill: red",
      "mix-blend-mode: multiply; fill: red",
    ]) {
      expect(blendStyle(wrong, true), wrong).toBeNull();
    }
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

  it("i riferimenti locali hanno una forma sola, con spazi e virgolette", () => {
    for (const value of ["url(#r1)", " url( #r1 ) ", 'url("#r1")', "url('#r1')", "URL(#r1)", "uRl( '#r1')", "url(#r1)\n"]) {
      expect(reference(value), value).toBe("r1");
    }
    for (const value of ["url(r1)", "url(#)", "url(# r1)", "url(#r1", "url (#r1)", "url(#r1')", `url("#r1')`, "url(#r(1))", "url(#r\\31)", "url(a.svg#r1)", "url(#r1) x", "url(#r1)url(#r2)"]) {
      expect(reference(value), value).toBeNull();
    }
    // Gli id con caratteri che non sono ASCII restano interi.
    expect(reference("url(#sfumatura-è)")).toBe("sfumatura-è");
  });

  it("fill e stroke con una risorsa e il ripiego", () => {
    expect(paintReference("url(#r1)")).toEqual({ id: "r1", fallback: null });
    expect(paintReference("url(#r1) ")).toEqual({ id: "r1", fallback: null });
    expect(paintReference("url(#r1) #ff0000")).toEqual({ id: "r1", fallback: [255, 0, 0] });
    expect(paintReference(" url(#r1)\tnone ")).toEqual({ id: "r1", fallback: "none" });
    expect(paintReference("url(#r1) red")).toEqual({ id: "r1", fallback: [255, 0, 0] });
    for (const value of ["url(#r1)#ff0000", "url(#r1) currentColor", "url(#r1) url(#r2)", "url(#r1) red blue", "#ff0000", "none"]) {
      expect(paintReference(value), value).toBeNull();
    }
  });

  it("i riferimenti dentro un valore qualunque", () => {
    expect(urlIds("url(#a) url(#b)")).toEqual(["a", "b"]);
    expect(urlIds("fill: url('#a'); stroke: URL( #b )")).toEqual(["a", "b"]);
    expect(urlIds("url(a.png) url(#)")).toEqual([]);
    expect(urlIds("nourl(#a)")).toEqual(["a"]);
    expect(hrefId("#r1")).toBe("r1");
    expect(hrefId(" #r1\n")).toBe("r1");
    expect(hrefId("#")).toBeNull();
    expect(hrefId("a.svg#r1")).toBeNull();
  });

  it("frazioni, angoli, scatole e coppie", () => {
    expect(percentage("50%")).toBe(0.5);
    expect(percentage(" -10% ")).toBe(-0.1);
    expect(percentage("50")).toBeNull();
    expect(percentage("50 %")).toBeNull();
    expect(percentage("%")).toBeNull();
    expect(fraction("0.25")).toBe(0.25);
    expect(fraction("25%")).toBe(0.25);
    expect(fraction("25px")).toBeNull();
    expect(wrapWidth("320")).toBe(320);
    expect(wrapWidth(" 0.5 ")).toBe(0.5);
    for (const value of ["0", "-1", "320px", "", "1e40"]) expect(wrapWidth(value), value).toBeNull();
    expect(startOffset("12")).toEqual({ value: 12, share: false });
    expect(startOffset("1in")).toEqual({ value: 96, share: false });
    expect(startOffset("-5")).toEqual({ value: -5, share: false });
    expect(startOffset("50%")).toEqual({ value: 0.5, share: true });
    for (const value of ["", "%", "50 %", "1em", "auto"]) expect(startOffset(value), value).toBeNull();
    expect(angle("90")).toBe(90);
    expect(angle("90deg")).toBe(90);
    expect(angle("100grad")).toBe(90);
    expect(angle(`${Math.PI}rad`)).toBeCloseTo(180, 10);
    for (const value of ["", "deg", "90 deg", "90DEG", "1turn", "90degs"]) expect(angle(value), value).toBeNull();
    expect(viewBox("0 0 10 20")).toEqual([0, 0, 10, 20]);
    expect(viewBox("-5,-5,10,10")).toEqual([-5, -5, 10, 10]);
    expect(viewBox("0 0 10")).toBeNull();
    expect(viewBox("0 0 -1 10")).toBeNull();
    expect(oneOrTwo("2")).toEqual([2]);
    expect(oneOrTwo("2, 3")).toEqual([2, 3]);
    expect(oneOrTwo("")).toBeNull();
    expect(oneOrTwo("1 2 3")).toBeNull();
    expect(oneOrTwo("-1")).toBeNull();
  });
});
