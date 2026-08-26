import { describe, expect, it } from "vitest";

import structure from "./structure.css?raw";

describe("il pavimento dei colori forzati", () => {
  it("usa colori di sistema per fuoco, controlli e stato scelto", () => {
    expect(structure).toContain("@media (forced-colors: active)");
    expect(structure).toContain("solid Highlight");
    expect(structure).toContain("solid ButtonText");
    expect(structure).toContain('[aria-checked="true"]');
  });
});
