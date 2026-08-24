import { describe, expect, it } from "vitest";

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
