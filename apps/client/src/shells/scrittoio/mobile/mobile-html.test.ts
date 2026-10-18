// @vitest-environment happy-dom
//
// `mobile.html` monta la stessa cornice di `index.html`: un id
// che manca da una parte è un pezzo di shell che su un telefono esce senza fare
// niente. La sola differenza ammessa è quella che la piattaforma giustifica: un
// telefono non ha i controlli della finestra.
import { describe, expect, it } from "vitest";

const desktop = (await import("../../../../index.html?raw")).default;
const mobile = (await import("../../../../mobile.html?raw")).default;

/// I controlli finestra: mobile non ne ha (`nativeWindowControls`).
const DESKTOP_ONLY = ["window-controls", "win-min", "win-max", "win-close"];

function ids(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("[id]")].map((element) => element.id).sort();
}

describe("mobile.html", () => {
  it("ha gli stessi id di index.html, meno i controlli finestra", () => {
    expect(ids(desktop)).toEqual(expect.arrayContaining(DESKTOP_ONLY));
    expect(ids(mobile)).toEqual(ids(desktop).filter((id) => !DESKTOP_ONLY.includes(id)));
  });

  it("carica l'ingresso mobile, e nessun altro", () => {
    const scripts = [...mobile.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
    expect(scripts).toEqual(["/src/entrypoints/mobile-main.ts"]);
  });

  it("chiede lo schermo intero: le aree sicure le dà la struttura", () => {
    expect(mobile).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
  });
});
