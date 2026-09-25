import { describe, expect, it } from "vitest";

import { contrast } from "./contrast";
import { PAIRS } from "./contrast-fixture";
import { LIGHTS, palette } from "./serie/recipe";

describe.each(LIGHTS)("alto contrasto %s", (light) => {
  const colors = palette(light, "high");

  it.each(PAIRS)("%s sopra %s usa la soglia alta", (ink, background, threshold) => {
    const required = threshold >= 4.5 ? 7 : 4.5;
    expect(contrast(colors.get(ink)!, colors.get(background)!)).toBeGreaterThanOrEqual(required);
  });

  // Il filetto è anche il contorno dei campi: in alto contrasto regge 3:1 su
  // ogni superficie (WCAG 1.4.11), mentre nel foglio normale resta un gradino.
  it.each(["bg", "bg-chrome", "bg-elev", "bg-panel", "bg-input", "bg-hover", "bg-active"])(
    "il bordo regge 3:1 sopra %s",
    (surface) => {
      expect(contrast(colors.get("border")!, colors.get(surface)!)).toBeGreaterThanOrEqual(3);
    },
  );
});
