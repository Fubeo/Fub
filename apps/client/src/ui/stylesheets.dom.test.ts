// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssomStyleChildren } from "./stylesheets";

// La CSP dell'app (`style-src-attr 'none'`) rifiuta `setAttribute("style", …)`
// su un elemento della pagina. Mermaid lo scrive sul `<div>` che monta nel
// contenitore dove misura (`appendDivSvgG`, #473): nel contenitore preparato
// con `cssomStyleChildren` lo stesso stile passa da CSSOM, che la CSP lascia
// valere. Il banco lo prova con la CSP vera (le scene `diagramma-*`).
describe("cssomStyleChildren", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("lo stile scritto come attributo su un figlio diventa CSSOM", () => {
    const container = document.createElement("div");
    document.body.append(container);
    cssomStyleChildren(container);
    // Chi scrive l'attributo `style`: uno script (rifiutato dalla CSP) o
    // CSSOM. happy-dom riflette `cssText` sull'attributo con `setAttribute`:
    // quella scrittura viene da CSSOM, e lì il browser non chiede alla CSP.
    let insideCssom = false;
    const cssText = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, "cssText")!;
    vi.spyOn(CSSStyleDeclaration.prototype, "cssText", "set").mockImplementation(function (this: CSSStyleDeclaration, value: string) {
      insideCssom = true;
      try {
        cssText.set!.call(this, value);
      } finally {
        insideCssom = false;
      }
    });
    const byScript: string[] = [];
    const set = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
      if (!insideCssom) byScript.push(name);
      set.call(this, name, value);
    });
    // Come d3 in Mermaid: prima l'elemento nel contenitore, poi gli attributi.
    const div = container.appendChild(document.createElement("div"));
    div.setAttribute("id", "dprova");
    div.setAttribute("style", "font-family: \"Trebuchet MS\", sans-serif");
    expect(div.id).toBe("dprova");
    expect(div.style.fontFamily).toContain("Trebuchet MS");
    // L'attributo `style` non lo scrive mai uno script.
    expect(byScript).toEqual(["id"]);
  });

  it("vale anche per un figlio SVG, e non tocca il resto della pagina", () => {
    const container = document.createElement("div");
    cssomStyleChildren(container);
    const svg = container.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    svg.setAttribute("STYLE", "fill: red");
    expect(svg.style.fill).toBe("red");
    // Un nipote, un elemento fuori dal contenitore e il prototipo restano com'erano.
    const inner = svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "g"));
    expect(Object.hasOwn(inner, "setAttribute")).toBe(false);
    const outside = document.body.appendChild(document.createElement("div"));
    expect(Object.hasOwn(outside, "setAttribute")).toBe(false);
    expect(Object.hasOwn(document.body, "appendChild")).toBe(false);
  });
});
