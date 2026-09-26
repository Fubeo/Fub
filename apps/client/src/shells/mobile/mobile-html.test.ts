// @vitest-environment happy-dom
//
// `mobile.html` monta la stessa shell di `index.html`: un id che manca da una
// parte è un pezzo di shell che su mobile esce senza fare niente (era il caso
// di `#pane-status`, e con lui di `chrome.status.visible`). Le sole differenze
// ammesse sono quelle che la piattaforma giustifica.
import { describe, expect, it } from "vitest";

const desktop = (await import("../../../index.html?raw")).default;
const mobile = (await import("../../../mobile.html?raw")).default;

/// I controlli finestra: mobile non ne ha (`nativeWindowControls`).
const DESKTOP_ONLY = ["window-controls", "win-min", "win-max", "win-close"];

function ids(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("[id]")].map((element) => element.id).sort();
}

describe("mobile.html", () => {
  it("ha gli stessi id di index.html, meno i controlli finestra", () => {
    expect(ids(mobile)).toEqual(ids(desktop).filter((id) => !DESKTOP_ONLY.includes(id)));
  });

  it("carica l'entry mobile", () => {
    expect(mobile).toContain('src="/src/entrypoints/mobile-main.ts"');
    expect(mobile).not.toContain('src="/src/main.ts"');
  });
});
