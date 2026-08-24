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
});
