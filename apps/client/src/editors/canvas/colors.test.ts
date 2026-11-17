import { describe, expect, it } from "vitest";
import {
  CANVAS_COLOR_CHOICES,
  JSON_CANVAS_COLORS,
  NOTE_COLORS,
  colorChoiceOf,
  colorCommandLabel,
  colorLook,
  colorMenuLabel,
  colorName,
  colorValueOf,
  writeColor,
} from "./colors";
import { t } from "../../i18n/strings";

describe("i colori della lavagna (T47)", () => {
  it("i sei di JSON Canvas col loro nome", () => {
    expect(JSON_CANVAS_COLORS.map((value) => colorName(value))).toEqual(["Rosso", "Arancione", "Giallo", "Verde", "Azzurro", "Viola"]);
    expect(JSON_CANVAS_COLORS.map((value) => colorMenuLabel(value))).toEqual(["Rosso", "Arancione", "Giallo", "Verde", "Azzurro", "Viola"]);
    for (const value of JSON_CANVAS_COLORS) {
      expect(colorLook(value)).toEqual({ key: value, custom: null });
      expect(colorValueOf(value)).toBe(value);
    }
  });

  it("i nove colori delle note sono gli esadecimali chiari dei Blocchi", () => {
    expect(NOTE_COLORS.map((color) => [color.id, color.hex])).toEqual([
      ["gray", "#5e626b"], ["brown", "#84573e"], ["orange", "#984b00"], ["yellow", "#795f00"], ["green", "#007231"],
      ["blue", "#0064b0"], ["purple", "#7847a6"], ["pink", "#9e366f"], ["red", "#b7191c"],
    ]);
    expect(NOTE_COLORS.map((color) => colorMenuLabel(color.id))).toEqual([
      "Grigio", "Marrone", "Arancione", "Giallo", "Verde", "Blu", "Viola", "Rosa", "Rosso",
    ]);
    // Il nome per chi ascolta non confonde il Rosso delle note con il Rosso dei sei.
    expect(colorName("#b7191c")).toBe("Rosso delle note");
    expect(colorName("1")).toBe("Rosso");
    for (const color of NOTE_COLORS) {
      expect(colorValueOf(color.id)).toBe(color.hex);
      expect(colorLook(color.hex)).toEqual({ key: color.id, custom: null });
      expect(colorChoiceOf(color.hex)).toBe(color.id);
    }
    // Scritti a mano in maiuscolo si riconoscono lo stesso.
    expect(colorLook("#0064B0")).toEqual({ key: "blue", custom: null });
  });

  it("le scelte del menu: nessuno, i sei, i nove, «Altro…»", () => {
    expect(CANVAS_COLOR_CHOICES).toEqual([
      "none", "1", "2", "3", "4", "5", "6",
      "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red", "other",
    ]);
    expect(colorMenuLabel("none")).toBe("Nessuno");
    expect(colorMenuLabel("other")).toBe("Altro…");
    expect(colorValueOf("none")).toBeUndefined();
    expect(colorValueOf("other")).toBeNull();
    // Nella ricerca dei comandi il nome dice di che cosa si parla.
    expect(t(colorCommandLabel("none"))).toBe("Nessun colore");
    expect(t(colorCommandLabel("blue"))).toBe("Blu delle note");
    expect(t(colorCommandLabel("other"))).toBe("Altro colore…");
  });

  it("un colore scelto si scrive in minuscolo #rrggbb", () => {
    expect(writeColor("#AABBCC")).toBe("#aabbcc");
    expect(writeColor("#ABC")).toBe("#aabbcc");
    expect(writeColor(" #7B3FA0 ")).toBe("#7b3fa0");
    expect(writeColor("#7b3fa0ff")).toBe("#7b3fa0");
    // L'opacità resta solo se il colore non è pieno.
    expect(writeColor("#7b3fa080")).toBe("#7b3fa080");
    expect(writeColor("rosso")).toBeNull();
    expect(writeColor("#12")).toBeNull();
  });

  it("un colore letto non si riscrive: si guarda com'è", () => {
    // `#ABC` e `#aabbccdd` si disegnano col valore del file, non uno rifatto.
    expect(colorLook("#ABC")).toEqual({ key: "custom", custom: "#ABC" });
    expect(colorLook("#aabbccdd")).toEqual({ key: "custom", custom: "#aabbccdd" });
    expect(colorChoiceOf("#ABC")).toBe("other");
    expect(colorName("#ABC")).toBe("#abc");
  });

  it("un valore che non è un colore si tiene e si disegna senza colore", () => {
    for (const value of ["7", "rosso", "#ggg", "0"]) {
      expect(colorLook(value)).toBeNull();
      expect(colorChoiceOf(value)).toBeNull();
      expect(colorName(value)).toBe(value);
    }
    expect(colorLook(undefined)).toBeNull();
    expect(colorChoiceOf(undefined)).toBe("none");
    expect(colorName(undefined)).toBe(t("canvas.default"));
  });
});
