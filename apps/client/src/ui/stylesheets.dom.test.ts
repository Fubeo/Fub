// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssomStyleDescendants } from "./stylesheets";

const SVG_NS = "http://www.w3.org/2000/svg";

// La CSP dell'app (`style-src-attr 'none'`) rifiuta `setAttribute("style", …)`
// su un elemento della pagina. Mermaid lo scrive sul `<div>` che monta nel
// contenitore dove misura (`appendDivSvgG`, #473) e sui nodi dell'SVG di
// prova (`style A …`, `linkStyle`, #528): nel contenitore preparato con
// `cssomStyleDescendants` lo stesso stile passa da CSSOM, che la CSP lascia
// valere. Il banco lo prova con la CSP vera (le scene `diagramma-*`, e
// `diagramma-09-nodi-con-stile` per gli stili dei nodi).
describe("cssomStyleDescendants", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  /// Gli attributi che uno script scrive con `setAttribute`, fuori da CSSOM.
  /// happy-dom riflette `cssText` sull'attributo con `setAttribute`: quella
  /// scrittura viene da CSSOM, e lì il browser non chiede alla CSP.
  function scriptWrites(): string[] {
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
    return byScript;
  }

  it("lo stile scritto come attributo su un figlio diventa CSSOM", () => {
    const container = document.createElement("div");
    document.body.append(container);
    cssomStyleDescendants(container);
    const byScript = scriptWrites();
    // Come d3 in Mermaid: prima l'elemento nel contenitore, poi gli attributi.
    const div = container.appendChild(document.createElement("div"));
    div.setAttribute("id", "dprova");
    div.setAttribute("style", "font-family: \"Trebuchet MS\", sans-serif");
    expect(div.id).toBe("dprova");
    expect(div.style.fontFamily).toContain("Trebuchet MS");
    // L'attributo `style` non lo scrive mai uno script.
    expect(byScript).toEqual(["id"]);
  });

  it("vale a ogni profondità dell'SVG, come i nodi con uno stile di Mermaid", () => {
    const container = document.createElement("div");
    document.body.append(container);
    cssomStyleDescendants(container);
    const byScript = scriptWrites();
    // `style A fill:#f9f`: d3 appende il gruppo del nodo dentro l'SVG, la
    // forma dentro il gruppo, poi scrive lo stile sulla forma.
    const svg = container.appendChild(document.createElementNS(SVG_NS, "svg"));
    const node = svg.appendChild(document.createElementNS(SVG_NS, "g"));
    const shape = node.appendChild(document.createElementNS(SVG_NS, "rect"));
    shape.setAttribute("style", "fill: #f9f !important; stroke-width: 4px");
    // `insertBefore` è l'altra strada di d3 (`selection.insert`).
    const label = node.insertBefore(document.createElementNS(SVG_NS, "text"), shape);
    label.setAttribute("STYLE", "font-size: 30px");
    // `setAttributeNS` senza spazio dei nomi è lo stesso attributo.
    const edge = svg.appendChild(document.createElementNS(SVG_NS, "path"));
    edge.setAttributeNS(null, "style", "stroke: red");
    expect(shape.style.getPropertyValue("stroke-width")).toBe("4px");
    expect(shape.style.getPropertyPriority("fill")).toBe("important");
    expect(label.style.fontSize).toBe("30px");
    expect(edge.style.stroke).toBe("red");
    expect(byScript).toEqual([]);
  });

  it("riscrive via CSSOM lo stile che un elemento portava già entrando, anche in un frammento", () => {
    const container = document.createElement("div");
    cssomStyleDescendants(container);
    // Costruito fuori, con lo stile già scritto, e montato dopo.
    const group = document.createElementNS(SVG_NS, "g");
    const inner = group.appendChild(document.createElementNS(SVG_NS, "rect"));
    inner.setAttribute("style", "fill: blue");
    const css = vi.spyOn(CSSStyleDeclaration.prototype, "cssText", "set");
    const fragment = document.createDocumentFragment();
    fragment.appendChild(group);
    container.appendChild(fragment);
    expect(css).toHaveBeenCalledWith("fill: blue");
    expect(inner.style.fill).toBe("blue");
    // Il frammento è entrato, e i suoi elementi sono preparati.
    expect(Object.prototype.hasOwnProperty.call(inner, "setAttribute")).toBe(true);
  });

  it("non tocca il resto della pagina né i prototipi", () => {
    const container = document.createElement("div");
    document.body.append(container);
    cssomStyleDescendants(container);
    container.appendChild(document.createElement("div"));
    const outside = document.body.appendChild(document.createElement("div"));
    expect(Object.prototype.hasOwnProperty.call(outside, "setAttribute")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(outside, "appendChild")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(document.body, "appendChild")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Element.prototype, "setAttribute")).toBe(true);
    outside.setAttribute("style", "color: red");
    expect(outside.getAttribute("style")).toBe("color: red");
  });
});
