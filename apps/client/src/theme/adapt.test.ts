// I numeri dell'aspetto adattato, quelli della tabella del piano: la carta
// scura `#1c2129` con l'inchiostro `#e3e6eb`.

import { describe, expect, test } from "vitest";
import { adapt, adapter } from "./adapt";
import { contrast } from "./contrast";
import { fromHex } from "./oklch";

const PAPER = { bg: "#1c2129", ink: "#e3e6eb" };
const on = (color: string) => contrast(color, PAPER.bg);
const hue = (a: string, b: string) => {
  const turn = Math.abs(fromHex(a).h - fromHex(b).h) % 360;
  return Math.min(turn, 360 - turn);
};

describe("l'adattamento di un colore", () => {
  const paper = adapter(PAPER);

  test("il collegamento tiene il contrasto che aveva sul bianco e la sua tinta", () => {
    const moved = paper.color("#467886");
    expect(moved).toBe("#6395a4");
    expect(on(moved)).toBeCloseTo(contrast("#467886", "#ffffff"), 1);
    expect(hue(moved, "#467886")).toBeLessThan(1);
  });

  test("un titolo grande sopra la soglia di 3:1 resta al suo contrasto", () => {
    const moved = paper.color("#ff0000", "large");
    expect(moved).toBe("#fe0000");
    expect(on(moved)).toBeGreaterThanOrEqual(4);
    expect(on(moved)).toBeLessThan(4.1);
  });

  test("un colore che sul bianco non si leggeva sale alla soglia", () => {
    expect(contrast("#00b050", "#ffffff")).toBeLessThan(3);
    const moved = paper.color("#00b050");
    expect(moved).toBe("#009d46");
    expect(on(moved)).toBeGreaterThanOrEqual(4.5);
    expect(hue(moved, "#00b050")).toBeLessThan(1);
  });

  test("il grigio cambia la chiarezza, non che grigio è", () => {
    const moved = paper.color("#6b6f76");
    expect(moved).toBe("#8c9098");
    expect(on(moved)).toBeGreaterThanOrEqual(contrast("#6b6f76", "#ffffff") - 0.05);
  });

  test("il nero si ferma all'inchiostro della carta", () => {
    const moved = paper.color("#000000");
    expect(moved).toBe("#e6e6e6");
    expect(on(moved)).toBeLessThan(on(PAPER.ink) + 0.1);
    expect(on(moved)).toBeGreaterThanOrEqual(on(PAPER.ink));
  });

  test("una cella si porta in coppia: prima il fondo, poi il testo sul fondo nuovo", () => {
    const cell = paper.pair("#fff2cc", "#22272f");
    expect(cell).toEqual({ fill: "#332906", text: "#e0e7f1" });
    expect(contrast(cell.text, cell.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(cell.text, cell.fill)).toBeLessThanOrEqual(contrast(PAPER.ink, cell.fill) + 0.1);
  });

  test("ciò che non è un colore pieno resta com'è", () => {
    expect(paper.color("auto")).toBe("auto");
    expect(paper.color("rgb(0 0 0 / 0.5)")).toBe("rgb(0 0 0 / 0.5)");
    expect(paper.color("var(--doc-fg)")).toBe("var(--doc-fg)");
  });

  test("la stessa carta dà lo stesso adattatore, e la forma corta conta come la lunga", () => {
    expect(adapter({ bg: "#1C2129", ink: "#e3e6eb" })).toBe(paper);
    expect(paper.color("#000")).toBe(paper.color("#000000"));
  });

  test("su una carta chiara il colore va verso il buio", () => {
    const moved = adapt("#ffff00", "#000000", "#ffffff", "#1a1a1a");
    expect(contrast(moved, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(hue(moved, "#ffff00")).toBeLessThan(3);
  });
});
