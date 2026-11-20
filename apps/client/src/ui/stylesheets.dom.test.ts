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
    const setNS = Element.prototype.setAttributeNS;
    vi.spyOn(Element.prototype, "setAttributeNS").mockImplementation(function (this: Element, namespace: string | null, name: string, value: string) {
      if (!insideCssom) byScript.push(name);
      setNS.call(this, namespace, name, value);
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
    // Per il DOM uno spazio dei nomi vuoto è nessuno spazio dei nomi.
    const other = svg.appendChild(document.createElementNS(SVG_NS, "path"));
    other.setAttributeNS("", "style", "stroke: blue");
    expect(other.style.stroke).toBe("blue");
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

  it("lo stile nel markup scritto con innerHTML diventa CSSOM, come le etichette HTML di Mermaid", () => {
    const container = document.createElement("div");
    document.body.append(container);
    cssomStyleDescendants(container);
    // `addHtmlSpan`: d3 appende lo span, poi `.html(etichetta)` gli scrive
    // dentro il markup di chi ha fatto il diagramma.
    const span = container.appendChild(document.createElement("span"));
    const css = vi.spyOn(CSSStyleDeclaration.prototype, "cssText", "set");
    span.innerHTML = "<b style=\"color: red\">Rosso <i style=\"font-size: 30px\">grande</i></b>";
    expect(css).toHaveBeenCalledWith("color: red");
    expect(css).toHaveBeenCalledWith("font-size: 30px");
    const big = span.querySelector("i")!;
    expect(big.style.fontSize).toBe("30px");
    // I nodi nuovi sono preparati: uno stile scritto dopo passa da CSSOM.
    expect(Object.prototype.hasOwnProperty.call(big, "setAttribute")).toBe(true);
    // Leggere `innerHTML` resta quello di sempre.
    expect(span.innerHTML).toContain("grande");
  });

  it("tutti gli elementi preparati condividono le stesse funzioni", () => {
    const container = document.createElement("div");
    cssomStyleDescendants(container);
    const svg = container.appendChild(document.createElementNS(SVG_NS, "svg"));
    const rect = svg.appendChild(document.createElementNS(SVG_NS, "rect"));
    for (const name of ["setAttribute", "setAttributeNS", "appendChild", "insertBefore"] as const) {
      expect(Object.prototype.hasOwnProperty.call(rect, name), name).toBe(true);
      expect(rect[name], name).toBe(svg[name]);
    }
  });

  it("l'attributo, che Mermaid serializza nel disegno, tiene ogni dichiarazione valida", () => {
    const container = document.createElement("div");
    cssomStyleDescendants(container);
    const svg = container.appendChild(document.createElementNS(SVG_NS, "svg"));
    const shape = svg.appendChild(document.createElementNS(SVG_NS, "rect"));
    // `style A …` e `linkStyle` di Mermaid, coi doppioni che scrive.
    shape.setAttribute("style", "fill:#f9f !important;stroke-dasharray:5 5;stroke-width:2;;;stroke-width:2");
    const written = shape.getAttribute("style") ?? "";
    for (const property of ["fill", "stroke-dasharray", "stroke-width"]) expect(written, property).toContain(property);
    expect(shape.style.getPropertyPriority("fill")).toBe("important");
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
