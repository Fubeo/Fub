// Il confronto di «Rendi modificabile»: quando due stili scritti in modo
// diverso disegnano la stessa cosa.

import { describe, expect, it } from "vitest";
import { Cascade, type CascadeNode } from "./cascade";
import { readSheet } from "./selectors";
import { ambiguousSpace, dashesOf, difference, evenOddSafe, paintOf, shapeFacts, type ShapeFacts } from "./editable-look";
import { parsePath } from "../scene/geometry";

const SVG = "http://www.w3.org/2000/svg";

interface Made extends CascadeNode {
  parent: Made | null;
  children: Made[];
}

function el(local: string, attrs: Record<string, string> = {}, children: Made[] = []): Made {
  const node: Made = {
    uri: SVG,
    local,
    attrs: Object.entries(attrs).map(([name, value]) => ({ uri: "", local: name, value })),
    parent: null,
    children,
    text: false,
  };
  for (const child of children) child.parent = node;
  return node;
}

const named = (node: CascadeNode): string => node.attrs.find((attr) => attr.local === "id")?.value ?? node.local;

function cascade(css: string, root: Made): Cascade {
  const inline = new Set<string>();
  const stack: Made[] = [root];
  while (stack.length > 0) {
    const at = stack.pop()!;
    const style = at.attrs.find((attr) => attr.local === "style")?.value;
    if (style !== undefined) for (const part of style.split(";")) if (part.includes(":")) inline.add(part.split(":")[0]!.trim());
    stack.push(...at.children);
  }
  return new Cascade(readSheet(css), root, named, inline);
}

/// I fatti della forma di `node`, come li calcola «Rendi modificabile».
function factsOf(node: Made, texts: string[] = []): () => ShapeFacts {
  return () => ({
    ...shapeFacts(node.local, (name) => node.attrs.find((attr) => attr.local === name)?.value ?? null),
    ambiguousSpace: node.local === "text" ? ambiguousSpace(texts) : null,
    wraps: false,
    viewport: [100, 100],
  });
}

/// La differenza fra un elemento `local` con gli attributi `before` sotto
/// il foglio `css`, e lo stesso con gli attributi `after` senza fogli.
function compare(local: string, before: Record<string, string>, after: Record<string, string>, css = "", texts: string[] = []): string | null {
  const was = el(local, { id: "a", ...before });
  const now = el(local, { id: "a", ...after });
  const wasRoot = el("svg", {}, [was]);
  const nowRoot = el("svg", {}, [now]);
  const props = new Set([...Object.keys(before), ...Object.keys(after), "fill", "stroke"]);
  for (const part of (before.style ?? "").split(";")) if (part.includes(":")) props.add(part.split(":")[0]!.trim());
  const found = difference({ cascade: cascade(css, wasRoot), node: was }, { cascade: cascade("", nowRoot), node: now }, props, factsOf(was, texts));
  return found?.property ?? null;
}

const SQUARE = "M0 0 H10 V10 H0 Z";

describe("i colori", () => {
  it("si leggono i colori scritti dalla cascata", () => {
    expect(paintOf("none")).toEqual({ kind: "none" });
    expect(paintOf("url(#g) red")).toEqual({ kind: "url", id: "g", fallback: "red" });
    expect(paintOf("url('#g')")).toEqual({ kind: "url", id: "g", fallback: null });
    expect(paintOf("#FF0000")).toEqual({ kind: "color", color: { r: 255, g: 0, b: 0, a: 1 } });
    expect(paintOf("context-fill")).toBeNull();
  });

  it("il colore conta per la sua opacità", () => {
    expect(compare("rect", { style: "fill: rgba(255, 0, 0, .5)" }, { fill: "#ff0000", "fill-opacity": "0.5" })).toBeNull();
    expect(compare("rect", { style: "fill: hsl(0 100% 50% / 50%); fill-opacity: .5" }, { fill: "#ff0000", "fill-opacity": "0.25" })).toBeNull();
    expect(compare("rect", { style: "fill: rgba(255, 0, 0, .5)" }, { fill: "#ff0000" })).toBe("fill");
    expect(compare("rect", { style: "fill: red" }, { fill: "#0000ff" })).toBe("fill");
  });

  it("trasparenza zero è come niente", () => {
    expect(compare("rect", { style: "fill: transparent" }, { fill: "none" })).toBeNull();
    expect(compare("rect", { style: "stroke: blue; stroke-opacity: 0; stroke-width: 4" }, { stroke: "none" })).toBeNull();
    expect(compare("rect", { fill: "#fff", "fill-opacity": "0" }, { fill: "none" })).toBeNull();
    expect(compare("rect", { style: "fill: url(#g); fill-opacity: 0" }, { fill: "none" })).toBeNull();
  });

  it("una risorsa conta col suo nome e l'opacità", () => {
    expect(compare("rect", { style: "fill: url(#g)" }, { fill: "url(#g)" })).toBeNull();
    expect(compare("rect", { style: "fill: url(#g)" }, { fill: "url(#h)" })).toBe("fill");
  });
});

describe("ciò che non si vede non conta", () => {
  it("i dettagli di un contorno che non c'è", () => {
    expect(compare("path", { d: SQUARE, style: "stroke-width: 3; stroke-linejoin: round; stroke-dasharray: 2" }, { d: SQUARE })).toBeNull();
    expect(compare("path", { d: SQUARE, style: "stroke: red; stroke-width: 3" }, { d: SQUARE, stroke: "#ff0000" })).toBe("stroke-width");
  });

  it("le punte di una forma chiusa senza tratteggio", () => {
    expect(compare("rect", { style: "stroke: red; stroke-linecap: round" }, { stroke: "#ff0000" })).toBeNull();
    expect(compare("path", { d: SQUARE, style: "stroke: red; stroke-linecap: square" }, { d: SQUARE, stroke: "#ff0000" })).toBeNull();
    expect(compare("line", { style: "stroke: red; stroke-linecap: round" }, { stroke: "#ff0000" })).toBe("stroke-linecap");
    expect(compare("rect", { style: "stroke: red; stroke-linecap: round; stroke-dasharray: 4 2" }, { stroke: "#ff0000", "stroke-dasharray": "4 2" })).toBe("stroke-linecap");
  });

  it("i giunti di un cerchio e di una linea", () => {
    expect(compare("circle", { style: "stroke: red; stroke-linejoin: bevel" }, { stroke: "#ff0000" })).toBeNull();
    expect(compare("line", { style: "stroke: red; stroke-linejoin: bevel" }, { stroke: "#ff0000" })).toBeNull();
    expect(compare("rect", { style: "stroke: red; stroke-linejoin: bevel" }, { stroke: "#ff0000" })).toBe("stroke-linejoin");
  });

  it("l'ordine di riempimento e contorno quando se ne vede uno solo", () => {
    expect(compare("rect", { style: "paint-order: stroke" }, {})).toBeNull();
    expect(compare("rect", { style: "paint-order: stroke; stroke: red" }, { stroke: "#ff0000" })).toBe("paint-order");
    expect(compare("rect", { style: "paint-order: fill stroke; stroke: red" }, { stroke: "#ff0000" })).toBeNull();
  });

  it("un elemento nascosto", () => {
    expect(compare("rect", { style: "display: none; fill: red" }, { display: "none" })).toBeNull();
    expect(compare("rect", { style: "visibility: hidden; fill: red" }, { visibility: "hidden" })).toBeNull();
    expect(compare("rect", { style: "display: none" }, {})).toBe("display");
  });
});

describe("il limite dei giunti a spigolo", () => {
  it("i giunti di un rettangolo restano a spigolo con ogni limite da √2 in su", () => {
    expect(compare("rect", { style: "stroke: red; stroke-miterlimit: 10" }, { stroke: "#ff0000" })).toBeNull();
    expect(compare("rect", { style: "stroke: red; stroke-miterlimit: 1.2" }, { stroke: "#ff0000" })).toBe("stroke-miterlimit");
    expect(compare("rect", { rx: "2", style: "stroke: red; stroke-miterlimit: 1" }, { rx: "2", stroke: "#ff0000" })).toBeNull();
  });

  it("un giunto acuto resta smussato con tutti e due i limiti, o no", () => {
    // Un angolo di circa 5,7°: il rapporto è circa 20.
    const d = "M0 0 L10 0 L0 1";
    expect(compare("path", { d, style: "stroke: red; stroke-miterlimit: 10" }, { d, stroke: "#ff0000" })).toBeNull();
    expect(compare("path", { d, style: "stroke: red; stroke-miterlimit: 30" }, { d, stroke: "#ff0000" })).toBe("stroke-miterlimit");
  });

  it("un limite qualunque basta coi giunti arrotondati", () => {
    expect(compare("rect", { style: "stroke: red; stroke-linejoin: round; stroke-miterlimit: 1" }, { stroke: "#ff0000", "stroke-linejoin": "round" })).toBeNull();
  });
});

describe("la regola di riempimento", () => {
  const safe = (d: string): boolean => evenOddSafe(parsePath(d)!);

  it("una forma sola che non si incrocia", () => {
    expect(safe(SQUARE)).toBe(true);
    expect(safe("M0 0 C10 0 10 10 0 10 Z")).toBe(true);
  });

  it("un buco che gira al contrario sì, nello stesso verso no", () => {
    expect(safe("M0 0 H10 V10 H0 Z M2 2 V8 H8 V2 Z")).toBe(true);
    expect(safe("M0 0 H10 V10 H0 Z M2 2 H8 V8 H2 Z")).toBe(false);
  });

  it("un'isola nel buco, in un verso o nell'altro, e il buco dell'isola al contrario", () => {
    expect(safe("M0 0 H10 V10 H0 Z M2 2 V8 H8 V2 Z M4 4 H6 V6 H4 Z")).toBe(true);
    expect(safe("M0 0 H10 V10 H0 Z M2 2 V8 H8 V2 Z M4 4 V6 H6 V4 Z")).toBe(true);
    expect(safe("M0 0 H10 V10 H0 Z M2 2 V8 H8 V2 Z M3 3 V7 H7 V3 Z M4 4 H6 V6 H4 Z")).toBe(true);
    expect(safe("M0 0 H10 V10 H0 Z M2 2 V8 H8 V2 Z M3 3 V7 H7 V3 Z M4 4 V6 H6 V4 Z")).toBe(false);
  });

  it("due forme accanto, ognuna nel suo verso", () => {
    expect(safe("M0 0 H4 V4 H0 Z M6 0 V4 H10 V0 Z")).toBe(true);
  });

  it("una stella che si incrocia, o due forme che si toccano, no", () => {
    expect(safe("M5 0 L8 10 L0 4 H10 L2 10 Z")).toBe(false);
    expect(safe("M0 0 H4 V4 H0 Z M4 0 H8 V4 H4 Z")).toBe(false);
  });

  it("nel confronto vale solo dove si vede il riempimento", () => {
    const d = "M0 0 H10 V10 H0 Z M2 2 V8 H8 V2 Z";
    expect(compare("path", { d, style: "fill-rule: evenodd" }, { d })).toBeNull();
    const same = "M0 0 H10 V10 H0 Z M2 2 H8 V8 H2 Z";
    expect(compare("path", { d: same, style: "fill-rule: evenodd" }, { d: same })).toBe("fill-rule");
    expect(compare("path", { d: same, style: "fill-rule: evenodd; fill: none; stroke: red" }, { d: same, fill: "none", stroke: "#ff0000" })).toBeNull();
    expect(compare("rect", { style: "fill-rule: evenodd" }, {})).toBeNull();
  });
});

describe("i valori iniziali e il testo", () => {
  it("una proprietà col valore iniziale è come non scritta", () => {
    expect(compare("text", { style: "letter-spacing: normal; font-stretch: 100%; font-kerning: auto; writing-mode: lr-tb" }, {})).toBeNull();
    expect(compare("text", { style: "letter-spacing: 0px" }, {})).toBeNull();
    expect(compare("text", { style: "word-spacing: 2px" }, {})).toBe("word-spacing");
  });

  it("la dimensione e il peso contano per il numero", () => {
    expect(compare("text", { style: "font-size: 12pt; font-weight: bold" }, { "font-size": "16", "font-weight": "700" })).toBeNull();
    expect(compare("text", { style: "font-size: 12pt" }, { "font-size": "15" })).toBe("font-size");
  });

  it("l'interlinea e l'allineamento non contano senza un riquadro", () => {
    expect(compare("text", { style: "line-height: 1.25; text-align: center" }, {})).toBeNull();
  });

  it("lo spazio bianco conta solo dove il testo ne ha di ambiguo", () => {
    expect(compare("text", { style: "white-space: pre" }, {}, "", ["Ciao mondo"])).toBeNull();
    expect(compare("text", { style: "white-space: pre" }, {}, "", ["Ciao  mondo"])).toBe("white-space");
    expect(ambiguousSpace(["a ", "b"])).toBe(true);
    expect(ambiguousSpace(["a", "\n"])).toBe(true);
    expect(ambiguousSpace(["uno due"])).toBe(false);
  });
});

describe("trasformazione, opacità e regole con una condizione", () => {
  it("una trasformazione CSS conta per la matrice", () => {
    expect(compare("rect", { style: "transform: translate(10px, 20px) rotate(90deg)" }, { transform: "matrix(0 1 -1 0 10 20)" })).toBeNull();
    expect(compare("rect", { style: "transform: translate(10px, 20px)" }, { transform: "translate(10 21)" })).toBe("transform");
  });

  it("la geometria conta per la misura, anche in percentuale della finestra", () => {
    expect(compare("rect", { x: "10%", width: "2pt" }, { x: "10", width: "2.6667" })).toBeNull();
    expect(compare("rect", { x: "10%" }, { x: "11" })).toBe("x");
    expect(compare("circle", { r: "10%" }, { r: "10" })).toBeNull();
  });

  it("il colore di un punto di sfumatura conta per la sua opacità", () => {
    expect(compare("stop", { style: "stop-color: rgba(0, 0, 255, .5)" }, { "stop-color": "#0000ff", "stop-opacity": "0.5" })).toBeNull();
    expect(compare("stop", { style: "stop-color: blue" }, { "stop-color": "#0000fe" })).toBe("stop-color");
  });

  it("un'opacità in percentuale conta per il numero", () => {
    expect(compare("rect", { style: "opacity: 50%" }, { opacity: "0.5" })).toBeNull();
  });

  it("due valori dalla stessa regola con una condizione sono uguali", () => {
    const css = "@media (prefers-color-scheme: dark) { .x { fill: white } }";
    const make = (): [Made, Made] => {
      const rect = el("rect", { id: "a", class: "x", fill: "black" });
      return [el("svg", {}, [rect]), rect];
    };
    const [wasRoot, was] = make();
    const [nowRoot, now] = make();
    const props = new Set(["fill"]);
    expect(difference({ cascade: cascade(css, wasRoot), node: was }, { cascade: cascade(css, nowRoot), node: now }, props, factsOf(was))).toBeNull();
    // Senza il foglio, la condizione non c'è più.
    const found = difference({ cascade: cascade(css, wasRoot), node: was }, { cascade: cascade("", nowRoot), node: now }, props, factsOf(was));
    expect(found?.property).toBe("fill");
    expect(found?.doubt?.kind).toBe("condition");
  });

  it("il tratteggio si legge in pixel, ripetuto se dispari", () => {
    expect(dashesOf("none")).toEqual([]);
    expect(dashesOf("0 0")).toEqual([]);
    expect(dashesOf("1, 2, 3")).toEqual([1, 2, 3, 1, 2, 3]);
    expect(dashesOf("1pt 2")).toEqual([96 / 72, 2]);
    expect(dashesOf("1em")).toBeNull();
    expect(dashesOf("10%", [30, 40])).toEqual([Math.sqrt(1250) / 10, Math.sqrt(1250) / 10]);
  });
});
