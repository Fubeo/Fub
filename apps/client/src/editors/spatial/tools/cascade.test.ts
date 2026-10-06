// La cascata dei fogli di stile: quale dichiarazione vince, che cosa si
// eredita, come si risolvono colori, misure e variabili.

import { describe, expect, it } from "vitest";
import { Cascade, cssTransform, expandFont, normal, renders, same, type CascadeNode } from "./cascade";
import { readSheet } from "./selectors";

const SVG = "http://www.w3.org/2000/svg";

interface Made extends CascadeNode {
  parent: Made | null;
  children: Made[];
}

/// Un elemento SVG coi suoi attributi e figli.
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

/// Chi è un elemento: il suo `id`, o il nome.
const named = (node: CascadeNode): string => node.attrs.find((attr) => attr.local === "id")?.value ?? node.local;

/// La cascata di `css` sull'albero di `root`.
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

/// La chiave di `p` su `node`, in un albero con il foglio `css`.
function key(css: string, root: Made, node: Made, p: string): string {
  return cascade(css, root).value(node, p).key;
}

describe("quale dichiarazione vince", () => {
  it("style importante, regola importante, style, regola, attributo", () => {
    const tree = (style: string): [Made, Made] => {
      const rect = el("rect", { id: "a", fill: "green", ...(style === "" ? {} : { style }) });
      return [el("svg", {}, [rect]), rect];
    };
    let [root, rect] = tree("");
    expect(key("", root, rect, "fill")).toBe("#008000");
    expect(key("rect { fill: red }", root, rect, "fill")).toBe("#ff0000");
    [root, rect] = tree("fill: blue");
    expect(key("rect { fill: red }", root, rect, "fill")).toBe("#0000ff");
    expect(key("rect { fill: red !important }", root, rect, "fill")).toBe("#ff0000");
    [root, rect] = tree("fill: blue !important");
    expect(key("rect { fill: red !important }", root, rect, "fill")).toBe("#0000ff");
  });

  it("fra le regole, la più specifica, poi l'ultima", () => {
    const rect = el("rect", { id: "a", class: "c" });
    const root = el("svg", {}, [rect]);
    expect(key("#a { fill: red } .c { fill: blue } rect { fill: lime }", root, rect, "fill")).toBe("#ff0000");
    expect(key("rect { fill: red } rect { fill: blue }", root, rect, "fill")).toBe("#0000ff");
    expect(key("rect { fill: red; fill: blue }", root, rect, "fill")).toBe("#0000ff");
    expect(key("rect { fill: red !important; fill: blue }", root, rect, "fill")).toBe("#ff0000");
  });

  it("@layer: vince l'ultimo livello, e fuori dai livelli più di tutti; con !important al contrario", () => {
    const rect = el("rect", { id: "a" });
    const root = el("svg", {}, [rect]);
    expect(key("@layer a, b; @layer b { rect { fill: red } } @layer a { #a { fill: blue } }", root, rect, "fill")).toBe("#ff0000");
    expect(key("@layer a { #a { fill: blue } } rect { fill: red }", root, rect, "fill")).toBe("#ff0000");
    expect(key("@layer a, b; @layer a { rect { fill: red !important } } @layer b { rect { fill: blue !important } }", root, rect, "fill")).toBe("#ff0000");
    expect(key("@layer a { rect { fill: red !important } } rect { fill: blue !important }", root, rect, "fill")).toBe("#ff0000");
  });

  it("un attributo che non è di presentazione non conta", () => {
    const g = el("g", { id: "g", "font-size": "20" });
    const rect = el("rect", { id: "r", x: "3" });
    const root = el("svg", {}, [g, rect]);
    expect(key("", root, g, "font-size")).toBe("20");
    // `x` è geometria di `rect`, non di `g`.
    const other = el("g", { x: "3" });
    expect(key("", el("svg", {}, [other]), other, "x")).toBe("initial");
  });
});

describe("eredità e valori iniziali", () => {
  it("fill si eredita dal gruppo, opacity no", () => {
    const rect = el("rect", { id: "r" });
    const g = el("g", { id: "g", fill: "red", opacity: "0.5" }, [rect]);
    const root = el("svg", {}, [g]);
    const c = cascade("", root);
    expect(c.value(rect, "fill")).toMatchObject({ key: "#ff0000", own: false });
    expect(c.value(rect, "opacity").key).toBe("1");
    expect(c.value(g, "opacity")).toMatchObject({ key: "0.5", own: true });
  });

  it("inherit, initial, unset e all", () => {
    const rect = el("rect", { id: "r" });
    const g = el("g", { id: "g", fill: "red", opacity: "0.5" }, [rect]);
    const root = el("svg", {}, [g]);
    expect(key("rect { opacity: inherit }", root, rect, "opacity")).toBe("0.5");
    expect(key("rect { fill: initial }", root, rect, "fill")).toBe("#000000");
    expect(key("rect { fill: unset }", root, rect, "fill")).toBe("#ff0000");
    expect(key("rect { all: initial }", root, rect, "fill")).toBe("#000000");
  });

  it("i valori iniziali: 16px, normale, e quelli che non si conoscono", () => {
    const rect = el("rect", { id: "r" });
    const root = el("svg", {}, [rect]);
    const c = cascade("", root);
    expect(c.value(rect, "font-size")).toMatchObject({ key: "16", text: "16px", number: 16 });
    expect(c.value(rect, "font-weight")).toMatchObject({ key: "400", text: "normal", number: 400 });
    expect(c.value(rect, "fill").key).toBe("#000000");
    expect(c.value(rect, "-x-sconosciuta").key).toBe("initial");
  });
});

describe("valori che dipendono da altro", () => {
  it("currentColor prende il colore, anche quando viene dal genitore", () => {
    const rect = el("rect", { id: "r", fill: "currentColor" });
    const g = el("g", { id: "g", color: "blue" }, [rect]);
    const root = el("svg", {}, [g]);
    const c = cascade("", root);
    expect(c.value(rect, "fill")).toMatchObject({ key: "#0000ff", text: "blue", attr: true });
    expect(key("rect { color: red }", root, rect, "fill")).toBe("#ff0000");
    expect(key("rect { color: currentColor }", root, rect, "color")).toBe("#0000ff");
  });

  it("em e rem diventano pixel; le altre unità relative restano legate al carattere", () => {
    const rect = el("rect", { id: "r", "stroke-width": "0.5em" });
    const g = el("g", { id: "g", "font-size": "20px" }, [rect]);
    const root = el("svg", { "font-size": "10px" }, [g]);
    const c = cascade("", root);
    expect(c.value(rect, "stroke-width")).toMatchObject({ key: "10", text: "10px" });
    expect(key("rect { stroke-width: 2rem }", root, rect, "stroke-width")).toBe("20");
    const ex = cascade("rect { stroke-width: 1ex }", root).value(rect, "stroke-width");
    expect(ex).toMatchObject({ key: "1ex|fs=20", text: null });
  });

  it("la dimensione del carattere: parole, percentuali, em del genitore", () => {
    const text = el("text", { id: "t" });
    const g = el("g", { id: "g", "font-size": "20px" }, [text]);
    const root = el("svg", {}, [g]);
    expect(key("text { font-size: 150% }", root, text, "font-size")).toBe("30");
    expect(key("text { font-size: 2em }", root, text, "font-size")).toBe("40");
    expect(key("text { font-size: large }", root, text, "font-size")).toBe("18");
    expect(key("text { font-size: 12pt }", root, text, "font-size")).toBe("16");
    expect(key("text { font-weight: bolder }", root, text, "font-weight")).toBe("700");
  });

  it("var() con l'alternativa, e un cerchio di variabili che non vale", () => {
    const rect = el("rect", { id: "r" });
    const g = el("g", { id: "g", fill: "lime" }, [rect]);
    const root = el("svg", {}, [g]);
    expect(key(":root { --c: red } rect { fill: var(--c) }", root, rect, "fill")).toBe("#ff0000");
    expect(key("rect { fill: var(--x, blue) }", root, rect, "fill")).toBe("#0000ff");
    expect(key("rect { fill: var(--x, var(--y, navy)) }", root, rect, "fill")).toBe("#000080");
    // Una variabile che manca, senza alternativa: come `unset`.
    expect(key("rect { fill: var(--x) }", root, rect, "fill")).toBe("#00ff00");
    expect(key("rect { --a: var(--b); --b: var(--a); fill: var(--a, teal) }", root, rect, "fill")).toBe("#008080");
    // Il valore con var() si scrive solo risolto.
    const c = cascade(":root { --c: red } rect { fill: var(--c) }", root);
    expect(c.value(rect, "fill")).toMatchObject({ text: "red", attr: true });
  });

  it("font si scioglie in tutte le sue proprietà, anche quelle che non nomina", () => {
    const text = el("text", { id: "t" });
    const g = el("g", { id: "g", "font-variant": "small-caps" }, [text]);
    const root = el("svg", {}, [g]);
    const c = cascade("text { font: italic bold 12px/2 'Fira Sans', serif }", root);
    expect(c.value(text, "font-style").key).toBe("italic");
    expect(c.value(text, "font-weight").key).toBe("700");
    expect(c.value(text, "font-size").key).toBe("12");
    expect(c.value(text, "line-height").key).toBe("2");
    expect(c.value(text, "font-family").key).toBe('"Fira Sans",serif');
    expect(c.value(text, "font-variant").key).toBe("normal");
    expect(expandFont("12px")).toBeNull();
    expect(expandFont("caption")?.get("font-size")).toBe("-fub-system(caption)");
  });

  it("le chiavi: colori, numeri e spazi in una forma sola", () => {
    expect(normal("RGB(255, 0, 0)")).toBe("#ff0000");
    expect(normal("#F00")).toBe("#ff0000");
    expect(normal("rgba(0,0,0,0.5)")).toBe("#00000080");
    expect(normal("1.0px")).toBe("1");
    expect(normal("url( 'a.svg#x' )")).toBe("url(a.svg#x)");
    expect(normal("Arial ,  'Fira Sans'")).toBe('arial,"Fira Sans"');
  });
});

describe("i dubbi", () => {
  it("una condizione dà un dubbio che si confronta fra due alberi", () => {
    const css = "rect { fill: blue } @media (min-width: 400px) { rect { fill: red } }";
    const make = (): [Made, Made] => {
      const rect = el("rect", { id: "r" });
      return [el("svg", {}, [rect]), rect];
    };
    const [a, ra] = make();
    const [b, rb] = make();
    const one = cascade(css, a).value(ra, "fill");
    const two = cascade(css, b).value(rb, "fill");
    expect(one.key).toMatch(/^c[\d:]+=#ff0000;#0000ff$/);
    expect(one.key).toBe(two.key);
    expect(one.doubt).toEqual({ kind: "condition", text: "@media (min-width: 400px)" });
    // Una regola senza condizione che viene dopo la copre: nessun dubbio.
    expect(cascade("@media (min-width: 400px) { rect { fill: red } } rect { fill: blue }", a).value(ra, "fill").key).toBe("#0000ff");
  });

  it("un selettore che non si legge dà un dubbio unico", () => {
    const css = "rect:frobnicate { fill: red }";
    const make = (): [Made, Made] => {
      const rect = el("rect", { id: "r" });
      return [el("svg", {}, [rect]), rect];
    };
    const [a, ra] = make();
    const [b, rb] = make();
    const one = cascade(css, a).value(ra, "fill");
    const two = cascade(css, b).value(rb, "fill");
    expect(one.key).toMatch(/^s\d+;#000000$/);
    expect(one.key).not.toBe(two.key);
    expect(one.doubt).toEqual({ kind: "selector", text: "rect:frobnicate" });
  });

  it(":hover non sceglie mai: il disegno è fermo", () => {
    const rect = el("rect", { id: "r" });
    const root = el("svg", {}, [rect]);
    const value = cascade("rect:hover { fill: red }", root).value(rect, "fill");
    expect(value).toMatchObject({ key: "#000000", doubt: null });
  });
});

describe("trasformazioni e opacità accumulate", () => {
  it("si compongono dalla radice, e si confrontano", () => {
    const rect = el("rect", { id: "r", transform: "scale(2)", opacity: "0.5" });
    const g = el("g", { id: "g", transform: "translate(10 0)", opacity: "50%" }, [rect]);
    const root = el("svg", {}, [g]);
    const c = cascade("", root);
    expect(same(c.world(rect).m, [2, 0, 0, 2, 10, 0])).toBe(true);
    expect(c.world(rect).sym).toBe("");
    expect(c.alpha(rect)).toEqual({ a: 0.25, sym: "" });
  });

  it("una trasformazione di CSS vince sull'attributo; con un'origine diversa non si calcola", () => {
    const rect = el("rect", { id: "r", transform: "translate(5 5)" });
    const root = el("svg", {}, [rect]);
    const c = cascade("rect { transform: rotate(90deg) }", root);
    expect(same(c.world(rect).m, [0, 1, -1, 0, 0, 0])).toBe(true);
    expect(c.own(rect).css).toBe(true);
    const centered = cascade("rect { transform: rotate(90deg); transform-origin: center }", root);
    expect(centered.own(rect).m).toBeNull();
    expect(centered.world(rect).sym).not.toBe("");
    expect(cssTransform("translate(10%)")).toBeNull();
    expect(cssTransform("none")).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("un'opacità che dipende da una condizione resta un simbolo", () => {
    const rect = el("rect", { id: "r" });
    const root = el("svg", {}, [rect]);
    const alpha = cascade("@media (min-width: 400px) { rect { opacity: .5 } }", root).alpha(rect);
    expect(alpha.a).toBe(1);
    expect(alpha.sym).toMatch(/^\|1\*r:c[\d:]+=0\.5;1$/);
  });
});

describe("dove una proprietà si vede", () => {
  it("il riempimento sulle forme e sui testi, il carattere sui testi, gli effetti dovunque", () => {
    const rect = el("rect");
    const text = el("text");
    const g = el("g", {}, [rect, text]);
    const title = el("title");
    el("svg", {}, [g, title]);
    expect(renders(rect, "fill")).toBe(true);
    expect(renders(g, "fill")).toBe(false);
    expect(renders(rect, "font-size")).toBe(false);
    expect(renders(text, "font-size")).toBe(true);
    expect(renders(g, "opacity")).toBe(true);
    expect(renders(title, "opacity")).toBe(false);
    expect(renders(el("use"), "fill")).toBe(true);
    expect(renders({ ...el("div"), uri: "http://www.w3.org/1999/xhtml" }, "fill")).toBe(true);
  });
});
