// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncAttributes } from "./dom-sync";

afterEach(() => {
  vi.restoreAllMocks();
});

/// Come la CSP della WebView (`style-src-attr 'none'`): l'attributo `style`
/// scritto con `setAttribute` non arriva. Il CSSOM di happy-dom passa a sua
/// volta da `setAttribute`: quelle chiamate, che nella WebView non sono
/// attributi in linea, si riconoscono dalla pila.
function withoutInlineStyleAttribute(): void {
  const original = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
    if (name.toLowerCase() === "style" && !new Error().stack?.includes("CSSStyleDeclaration")) return;
    original.call(this, name, value);
  });
}

function row(top: number, height: number, extra: Record<string, string> = {}): HTMLElement {
  const element = document.createElement("div");
  element.style.position = "absolute";
  element.style.top = `${top}px`;
  element.style.height = `${height}px`;
  for (const [name, value] of Object.entries(extra)) element.setAttribute(name, value);
  return element;
}

describe("syncAttributes", () => {
  it("sposta una riga riusata anche quando la CSP scarta l'attributo style (IMP-030)", () => {
    withoutInlineStyleAttribute();
    const drawn = row(28, 28, { "data-row": "1", "aria-rowindex": "3" });
    syncAttributes(drawn, row(58, 28, { "data-row": "1", "aria-rowindex": "3" }));
    expect(drawn.style.top).toBe("58px");
    expect(drawn.style.height).toBe("28px");
  });

  it("copia e toglie gli altri attributi", () => {
    const drawn = row(0, 28, { "data-row": "1", "aria-selected": "true" });
    syncAttributes(drawn, row(0, 28, { "data-row": "1", role: "row" }));
    expect(drawn.getAttribute("role")).toBe("row");
    expect(drawn.hasAttribute("aria-selected")).toBe(false);
  });

  it("toglie lo stile che la riga nuova non ha", () => {
    const drawn = row(0, 28);
    syncAttributes(drawn, document.createElement("div"));
    expect(drawn.style.cssText).toBe("");
  });
});
