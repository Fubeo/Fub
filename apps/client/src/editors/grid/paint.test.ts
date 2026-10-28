// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GRID_STACKED_ROTATION, type GridBytesCell, type GridCellStyle } from "../../host/contract";
import { adapter, type Adapter } from "../../theme/adapt";
import { contrast } from "../../theme/contrast";
import { hasBorders, horizontalOf, iconOf, paintBorders, paintCell, spills } from "./paint";

const NO_BORDERS = { top: null, right: null, bottom: null, left: null, diagonal_down: null, diagonal_up: null };

const PLAIN: GridCellStyle = {
  bold: false,
  italic: false,
  text_color: null,
  fill_color: null,
  horizontal: null,
  number_format: null,
  font: null,
  font_size: null,
  underline: null,
  strike: false,
  script: null,
  vertical: null,
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  borders: NO_BORDERS,
};

function cell(value: GridBytesCell["value"], display = ""): GridBytesCell {
  return {
    key: { sheet: "s1", row: "r0", column: "c0" },
    input: display,
    style: 0,
    value,
    display,
    lock: null,
    stale: false,
    conflict: false,
    data_bar: null,
    icon: null,
    comment: null,
    link: null,
  };
}

function painted(style: GridCellStyle | undefined, bytes?: GridBytesCell, paper: Adapter | null = null) {
  const element = document.createElement("div");
  const text = document.createElement("span");
  paintCell(element, text, style, bytes, "Inter", paper);
  return { element, text };
}

/// Le carte del tema della casa, nelle due luci (`--doc-bg`, `--doc-fg`).
const PAPERS = {
  dark: { bg: "#151a21", ink: "#dbdee3" },
  light: { bg: "#fcfdff", ink: "#22272f" },
} as const;

describe("aspetto delle celle", () => {
  it("allinea come Excel dove il file non lo dice", () => {
    expect(horizontalOf(undefined, { kind: "number", value: 1 })).toBe("end");
    expect(horizontalOf(undefined, { kind: "boolean", value: true })).toBe("center");
    expect(horizontalOf(undefined, { kind: "error", value: "#N/A" })).toBe("center");
    expect(horizontalOf(undefined, { kind: "text", value: "a" })).toBe("start");
    expect(horizontalOf({ ...PLAIN, horizontal: "distributed" }, { kind: "number", value: 1 })).toBe("center");
    expect(horizontalOf({ ...PLAIN, horizontal: "start" }, { kind: "number", value: 1 })).toBe("start");
    // In basso, se il file non lo dice.
    expect(painted(undefined, cell({ kind: "blank" })).element.style.alignContent).toBe("end");
  });

  it("un testo passa nelle celle accanto soltanto se non va a capo, non ruota e non si stringe", () => {
    const text = cell({ kind: "text", value: "lungo" }, "lungo");
    expect(spills(undefined, text)).toBe(true);
    expect(spills(PLAIN, text)).toBe(true);
    expect(spills({ ...PLAIN, wrap: true }, text)).toBe(false);
    expect(spills({ ...PLAIN, shrink: true }, text)).toBe(false);
    expect(spills({ ...PLAIN, rotation: 45 }, text)).toBe(false);
    expect(spills({ ...PLAIN, horizontal: "fill" }, text)).toBe(false);
    expect(spills(PLAIN, cell({ kind: "number", value: 1 }, "1"))).toBe(false);
    expect(spills(PLAIN, cell({ kind: "text", value: "" }))).toBe(false);
  });

  it("disegna carattere, misura, decorazioni, rientro e rotazione", () => {
    const { element, text } = painted({
      ...PLAIN,
      bold: true,
      italic: true,
      font: 'Cam"bria',
      font_size: 16.5,
      text_color: "#123456",
      fill_color: "#ABCDEF",
      underline: "single_accounting",
      strike: true,
      indent: 2,
      vertical: "center",
    }, cell({ kind: "text", value: "x" }, "x"));
    expect(element.style.fontWeight).toBe("700");
    expect(element.style.fontStyle).toBe("italic");
    // Le virgolette del nome non escono dalla stringa CSS.
    expect(element.style.fontFamily.replace(/"/gu, "")).toBe("Cambria, Inter");
    expect(element.style.fontSize).toBe("1.5em");
    expect(element.style.alignContent).toBe("center");
    expect(element.style.paddingInlineStart).toContain("1.30em");
    expect(text.style.textDecorationLine).toBe("underline line-through");
    expect(text.style.textUnderlineOffset).toBe("0.25em");
    // Il carattere di serie di Excel non cambia la misura.
    expect(painted({ ...PLAIN, font_size: 11 }).element.style.fontSize).toBe("");

    expect(painted({ ...PLAIN, rotation: 90 }).text.style.transform).toBe("rotate(-90deg)");
    expect(painted({ ...PLAIN, rotation: GRID_STACKED_ROTATION }).text.style.writingMode).toBe("vertical-lr");
    expect(painted({ ...PLAIN, script: "superscript" }).text.style.top).toBe("-0.45em");
    expect(painted({ ...PLAIN, wrap: true }).element.style.whiteSpace).toBe("pre-wrap");
  });

  // Il riempimento e il testo sono variabili di dato: la regola dell'aspetto
  // in `structure.css` decide quali usare, senza ridisegnare.
  it("nell'aspetto del file porta il riempimento com'è, e il testo automatico resta alla carta", () => {
    const { element } = painted({ ...PLAIN, fill_color: "#fff2cc" });
    expect(element.style.getPropertyValue("--file-fill")).toBe("#fff2cc");
    expect(element.style.getPropertyValue("--file-color")).toBe("");
    expect(element.style.getPropertyValue("--file-fill-a")).toBe("");
    expect(element.style.backgroundColor).toBe("");
    expect(element.style.color).toBe("");
  });

  for (const light of ["dark", "light"] as const) {
    it(`nell'aspetto adattato, in luce ${light}, porta fondo e testo automatico sulla carta in coppia`, () => {
      const paper = PAPERS[light];
      const { element } = painted({ ...PLAIN, fill_color: "#fff2cc" }, undefined, adapter(paper));
      expect(element.style.getPropertyValue("--file-fill")).toBe("#fff2cc");
      const fill = element.style.getPropertyValue("--file-fill-a");
      const text = element.style.getPropertyValue("--file-color-a");
      expect(fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5);
      // Il fondo resta vicino alla carta quanto lo era sul bianco.
      expect(contrast(fill, paper.bg)).toBeCloseTo(contrast("#fff2cc", "#ffffff"), 1);
    });
  }

  it("nell'aspetto adattato un testo senza fondo tiene il contrasto, e la soglia del testo grande", () => {
    const paper = adapter(PAPERS.dark);
    const { element } = painted({ ...PLAIN, text_color: "#00b050" }, undefined, paper);
    expect(element.style.getPropertyValue("--file-fill-a")).toBe("");
    expect(contrast(element.style.getPropertyValue("--file-color-a"), PAPERS.dark.bg)).toBeGreaterThanOrEqual(4.5);
    const large = painted({ ...PLAIN, text_color: "#ff0000", font_size: 18 }, undefined, paper).element;
    expect(large.style.getPropertyValue("--file-color-a")).toBe(paper.color("#ff0000", "large"));
    // Una cella senza colori non porta niente.
    expect(painted(PLAIN, undefined, paper).element.getAttribute("style") ?? "").not.toContain("--file");
  });

  it("disegna i bordi sui fili della griglia e le diagonali come sfumature", () => {
    expect(hasBorders(undefined)).toBe(false);
    expect(hasBorders(NO_BORDERS)).toBe(false);
    const borders = { ...NO_BORDERS, left: { style: "double" as const, color: null }, diagonal_up: { style: "thin" as const, color: "#FF0000" } };
    expect(hasBorders(borders)).toBe(true);
    const element = document.createElement("div");
    paintBorders(element, borders);
    expect(element.style.borderLeft).toContain("double");
    expect(element.style.borderLeft).toContain("3px");
    expect(element.style.borderTop).toBe("");
    expect(element.style.backgroundImage).toContain("linear-gradient");
  });

  it("dà a ogni insieme di icone le sue, dalla più bassa alla più alta", () => {
    expect(iconOf({ set: "3Arrows", index: 0 })).toEqual({ glyph: "⬇", color: "#D9412E" });
    expect(iconOf({ set: "3Arrows", index: 2 })?.glyph).toBe("⬆");
    expect(iconOf({ set: "5ArrowsGray", index: 4 })).toEqual({ glyph: "⬆", color: "#7F7F7F" });
    expect(iconOf({ set: "3Symbols", index: 2 })?.glyph).toBe("✔");
    // Un indice oltre l'insieme prende l'ultima.
    expect(iconOf({ set: "3TrafficLights1", index: 9 })?.color).toBe("#3C9A4E");
    expect(iconOf({ set: "3Ignote", index: 0 })).toBeNull();
  });
});
