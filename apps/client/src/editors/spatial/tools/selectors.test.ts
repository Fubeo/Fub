// I selettori dei fogli di stile: che cosa si legge, e che cosa scelgono.

import { describe, expect, it } from "vitest";
import { Matcher, readSheet, type Maybe, type StyleNode } from "./selectors";

const SVG = "http://www.w3.org/2000/svg";
const XML = "http://www.w3.org/XML/1998/namespace";

interface Made extends StyleNode {
  parent: Made | null;
  children: Made[];
}

/// Un elemento SVG coi suoi attributi e figli.
function el(local: string, attrs: Record<string, string> = {}, children: Made[] = [], text = false): Made {
  const node: Made = {
    uri: SVG,
    local,
    attrs: Object.entries(attrs).map(([name, value]) => (name.startsWith("xml:") ? { uri: XML, local: name.slice(4), value } : { uri: "", local: name, value })),
    parent: null,
    children,
    text,
  };
  for (const child of children) child.parent = node;
  return node;
}

/// Se il primo selettore di `css` sceglie `node`.
function selects(css: string, node: StyleNode): Maybe {
  const sheet = readSheet(`${css}{fill:red}`);
  expect(sheet.selectors).toHaveLength(1);
  return new Matcher().selects(sheet.selectors[0]!, node);
}

describe("leggere un foglio", () => {
  it("prende ogni selettore di ogni regola, anche dentro @media e @supports", () => {
    const sheet = readSheet("a, b {x:1} @media print { c {x:1} } @supports (display:grid) { d, e {x:1} } @font-face { font-family: X } @keyframes k { from {x:1} }");
    expect(sheet.selectors).toHaveLength(5);
    expect(sheet.deep).toBe(false);
  });

  it("legge le dichiarazioni, con !important, e la specificità di ogni selettore", () => {
    const sheet = readSheet("#a .b rect, :where(#a) rect, rect::before, :is(#a, .b) {fill: red !important; stroke : blue; /* nota */ --Var: 1}");
    expect(sheet.rules.map((rule) => rule.specificity)).toEqual([1_001_001, 1, 2, 1_000_000]);
    expect(sheet.rules[0]!.declarations).toEqual([
      { property: "fill", value: "red", important: true },
      { property: "stroke", value: "blue", important: false },
      { property: "--Var", value: "1", important: false },
    ]);
  });

  it("le regole annidate valgono come :is() del genitore", () => {
    const b = el("rect", { class: "b" });
    const both = el("rect", { class: "a b" });
    el("g", { class: "a" }, [b]);
    const sheet = readSheet(".a { fill: red; .b { x: 1 } &.b { x: 2 } }");
    expect(sheet.rules.map((rule) => rule.text)).toEqual([".a", ".b", "&.b"]);
    expect(sheet.selectors.map((selector) => new Matcher().selects(selector, b))).toEqual([false, true, false]);
    expect(new Matcher().selects(sheet.selectors[2]!, both)).toBe(true);
  });

  it("ordina i livelli di @layer come un browser: per primo dichiarato, e fuori da ogni livello per ultimi", () => {
    const sheet = readSheet("@layer a, b; @layer b { x {y:1} } @layer a { x {y:2} @layer c { x {y:3} } } x {y:4}");
    const [b, a, c, none] = sheet.rules.map((rule) => rule.layer);
    expect(c! < a!).toBe(true);
    expect(a! < b!).toBe(true);
    expect(b! < none!).toBe(true);
  });

  it("dice quando una regola vale secondo dove si guarda il disegno", () => {
    const sheet = readSheet("@media screen { a {x:1} } @media print { b {x:1} } @media (min-width: 400px) { c {x:1} } @supports (display: grid) { d {x:1} } @container (width > 1px) { e {x:1} } @media speech { f {x:1} } @starting-style { g {x:1} }");
    expect(sheet.rules.map((rule) => [rule.text, rule.condition, rule.at, rule.placed])).toEqual([
      ["a", true, null, false],
      ["b", null, "@media print", false],
      ["c", null, "@media (min-width: 400px)", false],
      ["d", null, "@supports (display: grid)", false],
      ["e", null, "@container (width > 1px)", true],
    ]);
  });

  it("tiene gli indirizzi dei fogli importati", () => {
    expect(readSheet('@import url("a.css"); @import "b.css" screen; a {x:1}').imports).toEqual(["a.css", "b.css"]);
  });

  it("lascia fuori le regole vuote e quelle coi selettori che un browser non accetta", () => {
    expect(readSheet("a {} b { /* niente */ }").selectors).toHaveLength(0);
    expect(readSheet("a, b!c {x:1}").selectors).toHaveLength(0);
    expect(readSheet("svg|rect {x:1}").selectors).toHaveLength(0);
  });

  it("non sa che cosa scelgono le regole di @scope, e un & senza genitore", () => {
    expect(readSheet("@scope (.a) { .b { x: 1 } }").selectors).toEqual([null]);
    expect(readSheet("& .a { x: 1 }").selectors).toEqual([null]);
  });

  it("riconosce :has(), che guarda dentro gli elementi", () => {
    expect(readSheet("g:has(> rect) {x:1}").deep).toBe(true);
    expect(readSheet(":is(g:has(rect)) {x:1}").deep).toBe(true);
  });

  it("usa i namespace di @namespace", () => {
    const rect = el("rect");
    const sheet = readSheet(`@namespace s url(${SVG}); @namespace h "http://www.w3.org/1999/xhtml"; s|rect {x:1} h|rect {x:1} *|rect {x:1} |rect {x:1}`);
    expect(sheet.selectors.map((selector) => new Matcher().selects(selector, rect))).toEqual([true, false, true, false]);
  });

  it("col namespace predefinito, un composto senza tipo vale per i suoi elementi", () => {
    const sheet = readSheet(`@namespace url(http://www.w3.org/1999/xhtml); .a {x:1}`);
    expect(new Matcher().selects(sheet.selectors[0]!, el("rect", { class: "a" }))).toBe(false);
  });
});

describe("scegliere", () => {
  it("tipo, universale, id e classi, con le maiuscole come sono scritte", () => {
    const rect = el("rect", { id: "r1", class: "node  big" });
    expect(selects("rect", rect)).toBe(true);
    expect(selects("RECT", rect)).toBe(false);
    expect(selects("*", rect)).toBe(true);
    expect(selects("#r1", rect)).toBe(true);
    expect(selects("#R1", rect)).toBe(false);
    expect(selects(".node.big", rect)).toBe(true);
    expect(selects(".node.small", rect)).toBe(false);
    expect(selects("rect#r1.big", rect)).toBe(true);
  });

  it("gli attributi, con ogni operatore e il modificatore i", () => {
    const path = el("path", { d: "M0 0", "data-k": "alfa beta", lang: "it-IT", fill: "Red" });
    expect(selects("[d]", path)).toBe(true);
    expect(selects("[stroke]", path)).toBe(false);
    expect(selects('[d="M0 0"]', path)).toBe(true);
    expect(selects("[data-k~=beta]", path)).toBe(true);
    expect(selects("[data-k~=bet]", path)).toBe(false);
    expect(selects("[lang|=it]", path)).toBe(true);
    expect(selects("[data-k^=al]", path)).toBe(true);
    expect(selects("[data-k$=ta]", path)).toBe(true);
    expect(selects("[data-k*='a b']", path)).toBe(true);
    expect(selects("[fill=red]", path)).toBe(false);
    expect(selects("[fill=red i]", path)).toBe(true);
    expect(selects("[data-k^='']", path)).toBe(false);
  });

  it("i combinatori: discendente, figlio, fratello vicino e fratelli dopo", () => {
    const a = el("rect", { id: "a" });
    const b = el("circle", { id: "b" });
    const c = el("rect", { id: "c" });
    const inner = el("g", { id: "inner" }, [a, b, c]);
    const outer = el("g", { id: "outer" }, [inner]);
    el("svg", {}, [outer]);
    expect(selects("#outer rect", a)).toBe(true);
    expect(selects("#outer > rect", a)).toBe(false);
    expect(selects("#inner > rect", a)).toBe(true);
    expect(selects("#a + circle", b)).toBe(true);
    expect(selects("#a + rect", c)).toBe(false);
    expect(selects("#a ~ rect", c)).toBe(true);
    expect(selects("svg g g rect", c)).toBe(true);
    expect(selects("svg > g > rect", c)).toBe(false);
  });

  it("le pseudo-classi strutturali", () => {
    const kids = [el("rect"), el("circle"), el("rect"), el("rect")];
    const parent = el("g", {}, kids);
    el("svg", {}, [parent]);
    expect(kids.map((kid) => selects(":first-child", kid))).toEqual([true, false, false, false]);
    expect(kids.map((kid) => selects(":last-child", kid))).toEqual([false, false, false, true]);
    expect(kids.map((kid) => selects(":nth-child(2n+1)", kid))).toEqual([true, false, true, false]);
    expect(kids.map((kid) => selects(":nth-child(even)", kid))).toEqual([false, true, false, true]);
    expect(kids.map((kid) => selects(":nth-child(-n+2)", kid))).toEqual([true, true, false, false]);
    expect(kids.map((kid) => selects(":nth-last-child(1)", kid))).toEqual([false, false, false, true]);
    expect(kids.map((kid) => selects("rect:nth-of-type(2)", kid))).toEqual([false, false, true, false]);
    expect(kids.map((kid) => selects(":last-of-type", kid))).toEqual([false, true, false, true]);
    expect(kids.map((kid) => selects(":only-of-type", kid))).toEqual([false, true, false, false]);
    expect(kids.map((kid) => selects(":nth-child(2 of rect)", kid))).toEqual([false, false, true, false]);
    expect(selects(":only-child", parent)).toBe(true);
  });

  it(":root, :empty, :not, :is e :where", () => {
    const empty = el("rect");
    const spaced = el("text", {}, [], true);
    const root = el("svg", {}, [el("g", {}, [empty, spaced])]);
    expect(selects(":root", root)).toBe(true);
    expect(selects(":root", empty)).toBe(false);
    expect(selects("rect:empty", empty)).toBe(true);
    expect(selects(":empty", spaced)).toBe(false);
    expect(selects("rect:not(.a, text)", empty)).toBe(true);
    expect(selects(":not(rect)", empty)).toBe(false);
    expect(selects(":is(circle, rect)", empty)).toBe(true);
    expect(selects(":where(svg) rect", empty)).toBe(true);
    // Una lista che perdona lascia fuori ciò che non vale.
    expect(selects(":is(rect, !nope)", empty)).toBe(true);
  });

  it(":lang() dalla lingua dell'elemento o del primo antenato che la dice", () => {
    const text = el("text");
    el("svg", { "xml:lang": "it-IT" }, [el("g", {}, [text])]);
    expect(selects(":lang(it)", text)).toBe(true);
    expect(selects(":lang(en)", text)).toBe(false);
  });

  it("le pseudo-classi d'interazione e gli pseudo-elementi non scelgono niente", () => {
    const rect = el("rect");
    el("svg", {}, [rect]);
    expect(selects("rect:hover", rect)).toBe(false);
    expect(selects("rect:not(:hover)", rect)).toBe(true);
    expect(selects("rect::before", rect)).toBe(false);
    expect(selects("rect:after", rect)).toBe(false);
  });

  it("non sa, e lo dice, per :has() e per le pseudo-classi che non conosce", () => {
    const rect = el("rect", { class: "a" });
    el("svg", {}, [rect]);
    expect(selects("rect:has(circle)", rect)).toBe(null);
    expect(selects(".a:frobnicate", rect)).toBe(null);
    // Se il resto già esclude l'elemento, il dubbio non conta.
    expect(selects(".b:has(circle)", rect)).toBe(false);
    expect(selects(":not(:has(circle))", rect)).toBe(null);
  });

  it("legge gli escape nei nomi e nelle stringhe", () => {
    const rect = el("rect", { id: "1a", class: "a:b", title: "x\"y" });
    expect(selects("#\\31 a", rect)).toBe(true);
    expect(selects(".a\\:b", rect)).toBe(true);
    expect(selects('[title="x\\"y"]', rect)).toBe(true);
  });
});
