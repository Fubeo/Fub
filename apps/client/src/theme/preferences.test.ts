import { describe, expect, it } from "vitest";

import { SCRITTOIO_SERIES } from "./scrittoio/series";
import { effectiveContrast, preferenceTokens } from "./theme";

describe("quale contrasto vale", () => {
  it("la scelta esplicita vince e il vuoto segue il sistema", () => {
    expect(effectiveContrast("normal", true)).toBe("normal");
    expect(effectiveContrast("high", false)).toBe("high");
    expect(effectiveContrast("", true)).toBe("high");
    expect(effectiveContrast("", false)).toBe("normal");
  });
});

describe("le preferenze restano sopra il tema", () => {
  it("la densità muove la scala ma non nomina la scocca", () => {
    const tokens = preferenceTokens(
      { density: "compact", body: 18, lineHeight: 1.8, measure: 64, font: "system", accent: 210 },
      "dark",
      "high",
    );
    expect(tokens["space-10"]).toBe("36px");
    expect(tokens["text-reading"]).toBe("18px");
    expect(tokens["titlebar-h"]).toBeUndefined();
    expect(tokens["rail-w"]).toBeUndefined();
    expect(tokens["accent"]).toMatch(/^#/);
  });
});

describe("tre caratteri distinti", () => {
  const base = { density: "comfortable" as const, body: 17, lineHeight: 1.65, measure: 68, font: "newsreader", accent: 210 };

  it("lettura, interfaccia e codice si scelgono ognuno per conto suo", () => {
    const tokens = preferenceTokens({ ...base, font: "literata", uiFont: "inter", monoFont: "jetbrains" }, "light", "normal");
    expect(tokens["font-reading"]).toMatch(/^"Literata Variable"/);
    expect(tokens["font-ui"]).toMatch(/^"Inter Variable"/);
    expect(tokens["font-mono"]).toMatch(/^"JetBrains Mono Variable"/);
  });

  it("le scelte di serie sono le pile dei fogli, e una voce ignota ci ricade", () => {
    const sheet = SCRITTOIO_SERIES.sheet("light", "normal");
    const defaults = preferenceTokens(base, "light", "normal");
    expect(sheet).toContain(`--font-ui: ${defaults["font-ui"]};`);
    expect(sheet).toContain(`--font-mono: ${defaults["font-mono"]};`);
    const unknown = preferenceTokens({ ...base, uiFont: "comic", monoFont: "courier" }, "dark", "high");
    expect(unknown["font-ui"]).toBe(defaults["font-ui"]);
    expect(unknown["font-mono"]).toBe(defaults["font-mono"]);
  });
});
