// La tavolozza disegna i colori del tema come li scrive il file: la regola
// delle sfumature di GridCraft (ECMA-376), le righe di Excel, gli stili.
import { describe, expect, it } from "vitest";
import { CELL_STYLE_GROUPS, OFFICE_THEME, cellLook, luminance, resolve, tableLook, themeColors, tinted, tintsFor } from "./palette";

describe("le sfumature", () => {
  it("vanno verso il bianco e verso il nero", () => {
    expect(tinted("#156082", 0)).toBe("#156082");
    expect(tinted("#000000", 0.5)).toBe("#808080");
    expect(tinted("#FFFFFF", -0.5)).toBe("#808080");
    expect(tinted("#156082", 1)).toBe("#FFFFFF");
    expect(tinted("#156082", -1)).toBe("#000000");
    expect(luminance(tinted("#156082", 0.4))).toBeGreaterThan(luminance("#156082"));
    expect(luminance(tinted("#156082", -0.25))).toBeCloseTo(luminance("#156082") * 0.75, 2);
  });

  it("lasciano com'è un colore che non si legge", () => {
    expect(tinted("rosso", 0.5)).toBe("rosso");
  });

  it("scelgono le righe di Excel dalla luminanza", () => {
    expect(tintsFor("#000000")).toEqual([0.5, 0.35, 0.25, 0.15, 0.05]);
    expect(tintsFor("#FFFFFF")).toEqual([-0.05, -0.15, -0.25, -0.35, -0.5]);
    expect(tintsFor("#0E2841")).toEqual([0.9, 0.75, 0.5, 0.25, 0.1]);
    expect(tintsFor("#E8E8E8")).toEqual([-0.1, -0.25, -0.5, -0.75, -0.9]);
    expect(tintsFor("#156082")).toEqual([0.8, 0.6, 0.4, -0.25, -0.5]);
  });
});

describe("il tema della cartella", () => {
  it("si completa con quello di Office", () => {
    expect(themeColors(undefined)).toEqual(OFFICE_THEME);
    const theme = themeColors(["#ffffff", "#111111"]);
    expect(theme[1]).toBe("#111111");
    expect(theme[4]).toBe(OFFICE_THEME[4]);
  });

  it("risolve un colore del tema", () => {
    expect(resolve("#FF0000", OFFICE_THEME)).toBe("#FF0000");
    expect(resolve({ theme: 4, tint: 0 }, OFFICE_THEME)).toBe("#156082");
  });
});

describe("gli stili", () => {
  it("di tabella seguono le famiglie", () => {
    const medium = tableLook("TableStyleMedium2", OFFICE_THEME);
    expect(medium.headerFill).toBe("#156082");
    expect(medium.headerText).toBe("#FFFFFF");
    const light = tableLook("TableStyleLight1", OFFICE_THEME);
    expect(light.headerFill).toBeNull();
    const dark = tableLook("TableStyleDark1", OFFICE_THEME);
    expect(dark.headerFill).toBe("#000000");
  });

  it("di cella hanno tutti un campione", () => {
    for (const { names } of CELL_STYLE_GROUPS) {
      for (const name of names) expect(Object.keys(cellLook(name, OFFICE_THEME)).length, name).toBeGreaterThan(0);
    }
    expect(cellLook("Good", OFFICE_THEME)).toMatchObject({ background: "#C6EFCE", color: "#006100" });
    expect(cellLook("Accent1", OFFICE_THEME)).toMatchObject({ background: "#156082", color: "#FFFFFF" });
  });
});
