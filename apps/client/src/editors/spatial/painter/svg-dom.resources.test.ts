// @vitest-environment happy-dom
// Il painter SVG DOM: le risorse, i simboli e le copie vive, e che ogni
// risorsa che apre si chiude quando la sua vita finisce.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import type { ContainerNode } from "../scene/model";
import { doc, HEAD } from "../scene/test-support";
import { PaintBuilder, resourcesFor, symbolsFor, type PaintScene, type PaintShape } from "./paint";
import { createSvgPainter, liveId, paintMiniature } from "./svg-dom";
import { host, LAYER, owner, sceneOf, setUp, tearDown } from "./test-support";

beforeEach(setUp);
afterEach(tearDown);

describe("le risorse vive", () => {
  /// Le risorse del disegno, una per tipo, con ciò che il painter non porta:
  /// titoli, id dei figli, attributi di FubDraw, una sfumatura estranea.
  const RESOURCES: Readonly<Record<string, string>> = {
    g1: '<linearGradient id="g1" fub:role="private" x2="1"><title>Mare</title><stop id="s0" offset="0" stop-color="#0072b2"/>'
      + '<stop offset="1" stop-color="#56b4e9"/></linearGradient>',
    p1: '<pattern id="p1" fub:role="shared" width="20" height="20" patternUnits="userSpaceOnUse">'
      + '<rect id="dentro" width="10" height="10" fill="url(#g1) #0072b2" fub:nota="n"/></pattern>',
    m1: '<marker id="m1" refX="5" refY="5" markerWidth="10" markerHeight="10" orient="auto" viewBox="0 0 10 10"><path d="M0 0 L10 5 L0 10 Z"/></marker>',
    c1: '<clipPath id="c1" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>',
    k1: '<mask id="k1" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="#ffffff"/></mask>',
    f1: '<filter id="f1"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000"/></filter>',
  };
  const OBJECTS: Readonly<Record<string, string>> = {
    a: '<rect id="a" x="0" y="0" width="5" height="5" fill="url(#p1) #4593ce" filter="url(#f1)"/>',
    b: '<path id="b" d="M0 0 L10 0" stroke="#000000" marker-end="url(#m1)"/>',
    g: `<g id="g" clip-path="url(#c1)" mask="url(#k1)"><rect id="c" width="5" height="5" fill="url('#g1')"/></g>`,
    d: '<rect id="d" width="1" height="1"/>',
  };

  /// Il disegno con le risorse e gli oggetti dati, e una radice che dipinge.
  function drawing(resources: readonly string[], objects: readonly string[]): string {
    return `${HEAD.replace(">", ' fill="#123456">')}<defs id="fub-defs">${resources.map((id) => RESOURCES[id]).join("")}`
      + `<linearGradient id="ink" href="#g1"/></defs>${LAYER}${objects.map((id) => OBJECTS[id]).join("")}</g></svg>`;
  }
  const ALL = drawing(Object.keys(RESOURCES), Object.keys(OBJECTS));

  const painterRoot = (box: HTMLElement = host): Element => box.querySelector(".spatial-painter")!;
  const prefixOf = (box: HTMLElement = host): string => {
    const id = box.querySelector("defs > linearGradient")!.id;
    expect(id).toMatch(/^fubdraw\d+-g1$/);
    return id.slice(0, -"g1".length);
  };

  it("stanno in una defs prima degli strati, con gli id e i riferimenti riscritti", () => {
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(ALL), new PaintBuilder()));
    const root = painterRoot();
    expect([...root.children].map((el) => el.getAttribute("class"))).toEqual(["spatial-layer spatial-defs", "spatial-layer"]);
    const defs = root.firstElementChild!.firstElementChild!;
    expect(defs.localName).toBe("defs");
    // Il contenuto delle risorse eredita dalla radice, come nel file.
    expect(defs.getAttribute("fill")).toBe("#123456");
    const prefix = prefixOf();
    expect([...defs.children].map((el) => el.id)).toEqual(Object.keys(RESOURCES).map((id) => prefix + id));
    // Gli unici id del DOM sono quelli vivi delle risorse; niente titoli,
    // niente di FubDraw, niente dell'estraneo.
    expect([...root.querySelectorAll("[id]")].map((el) => el.id)).toEqual(Object.keys(RESOURCES).map((id) => prefix + id));
    expect(root.querySelectorAll("title, desc, [href]")).toHaveLength(0);
    for (const el of root.querySelectorAll("*")) for (const attr of el.attributes) expect(attr.name, el.localName).not.toMatch(/^(fub:|xmlns)/);
    const at = (id: string): Element => root.querySelector(`[data-scene-id="${id}"]`)!;
    expect([at("a").getAttribute("fill"), at("a").getAttribute("filter")]).toEqual([`url(#${prefix}p1) #4593ce`, `url(#${prefix}f1)`]);
    expect(at("b").getAttribute("marker-end")).toBe(`url(#${prefix}m1)`);
    expect([at("g").getAttribute("clip-path"), at("g").getAttribute("mask")]).toEqual([`url(#${prefix}c1)`, `url(#${prefix}k1)`]);
    expect(at("c").getAttribute("fill")).toBe(`url(#${prefix}g1)`);
    expect(defs.querySelector("pattern > rect")!.getAttribute("fill")).toBe(`url(#${prefix}g1) #0072b2`);
    // Le risorse non sono oggetti.
    expect(defs.querySelectorAll("[data-scene-id]")).toHaveLength(0);
    expect([...root.querySelectorAll("[data-scene-id]")].map((el) => el.getAttribute("data-scene-id"))).toEqual(["l1", "a", "b", "g", "c", "d"]);
  });

  it("non lasciano entrare niente che il formato non dice, e nessun riferimento che non riscrivono", () => {
    const painter = createSvgPainter(host, owner);
    const shape: PaintShape = {
      kind: "shape",
      tag: "rect",
      role: "rect",
      id: "a",
      attrs: [["width", "5"], ["fill", "url(https://example.com/x.svg#a)"], ["stroke", "url(#g1) red"], ["mask", "url(#g1) x"], ["clip-path", "url(#c1)"], ["onclick", "x()"]],
      space: null,
    };
    const scene: PaintScene = {
      root: { attrs: [], page: null, units: "px", guides: [] },
      layers: [{ kind: "live", nodes: [shape] }],
      resources: [
        {
          id: "g1",
          tag: "linearGradient",
          attrs: [["x2", "1"], ["href", "#fuori"], ["onload", "x()"], ["style", "fill:red"], ["id", "altro"], ["gradientTransform", "url(#fuori)"]],
          space: null,
          children: [
            { tag: "stop", attrs: [["offset", "0"], ["onclick", "x()"], ["stop-color", "#ff0000"]], space: null, children: ["testo"] },
            { tag: "script", attrs: [], space: null, children: ["parent.rubato = true"] },
            { tag: "rect", attrs: [["width", "1"]], space: null, children: [] },
            "testo fuori",
          ],
        },
        { id: "s1", tag: "script", attrs: [], space: null, children: ["parent.rubato = true"] },
        {
          id: "p1",
          tag: "pattern",
          attrs: [["width", "4"]],
          space: null,
          children: [
            { tag: "rect", attrs: [["id", "dentro"], ["fill", "url(#g1) #000000"], ["filter", "url(#f1)"], ["stroke", "url(https://example.com/x.svg#a)"]], space: null, children: [] },
            { tag: "foreignObject", attrs: [], space: null, children: [] },
            { tag: "image", attrs: [["href", "x.png"]], space: null, children: [] },
            { tag: "text", attrs: [["x", "1"]], space: null, children: ["si legge", { tag: "title", attrs: [], space: null, children: ["no"] }] },
          ],
        },
      ],
      symbols: [],
      originals: new Set(),
    };
    painter.update(scene);
    const root = painterRoot();
    for (const selector of ["script", "foreignObject", "image", "title", "[href]", "[onload]", "[onclick]", "[style]", "[filter]", "#altro", "#dentro"]) {
      expect(root.querySelectorAll(selector), selector).toHaveLength(0);
    }
    const prefix = prefixOf();
    const defs = root.querySelector("defs")!;
    expect([...defs.children].map((el) => el.id)).toEqual([`${prefix}g1`, `${prefix}p1`]);
    const gradient = defs.querySelector("linearGradient")!;
    expect([...gradient.attributes].map((attr) => attr.name).sort()).toEqual(["id", "x2"]);
    expect([...gradient.childNodes].map((node) => node.nodeName.toLowerCase())).toEqual(["stop"]);
    expect([...gradient.firstElementChild!.attributes].map((attr) => attr.name)).toEqual(["offset", "stop-color"]);
    expect(gradient.textContent).toBe("");
    const content = defs.querySelector("pattern > rect")!;
    expect([...content.attributes].map((attr) => [attr.name, attr.value])).toEqual([["fill", `url(#${prefix}g1) #000000`]]);
    expect(defs.querySelector("pattern > text")!.textContent).toBe("si legge");
    const rect = root.querySelector('[data-scene-id="a"]')!;
    expect([...rect.attributes].map((attr) => [attr.name, attr.value])).toEqual([
      ["width", "5"],
      ["stroke", `url(#${prefix}g1) red`],
      ["clip-path", `url(#${prefix}c1)`],
      ["data-scene-id", "a"],
    ]);
  });

  it("si aggiornano una per una, e la defs esce con l'ultima", () => {
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    const engine = SceneEngine.open(ALL);
    painter.update(builder.build(engine));
    const defs = painterRoot().querySelector("defs")!;
    const before = [...defs.children];
    // Un oggetto che cambia non tocca le risorse.
    expect(engine.apply({ op: "set", id: "d", attrs: { x: "1" } }).outcome).toBe("applied");
    painter.update(builder.build(engine));
    [...defs.children].forEach((el, i) => expect(el).toBe(before[i]));
    // Una risorsa che non c'è più esce; le altre restano gli stessi nodi.
    const fewer = SceneEngine.open(drawing(["g1", "p1", "m1", "c1", "f1"], ["a", "b"]));
    painter.update(builder.build(fewer));
    expect(before[4]!.isConnected).toBe(false);
    expect([...defs.children]).toEqual([before[0], before[1], before[2], before[3], before[5]]);
    // Una che cambia si rifà con lo stesso id vivo, e chi la usa la ritrova.
    expect(fewer.apply({ op: "set", id: "g1", attrs: { x2: "0.5" } }).outcome).toBe("applied");
    painter.update(builder.build(fewer));
    const changed = defs.firstElementChild!;
    expect(changed).not.toBe(before[0]);
    expect(before[0]!.isConnected).toBe(false);
    expect([changed.id, changed.getAttribute("x2")]).toEqual([before[0]!.id, "0.5"]);
    expect([...defs.children].slice(1)).toEqual([before[1], before[2], before[3], before[5]]);
    // Senza risorse la defs se ne va, e torna con loro.
    painter.update(builder.build(SceneEngine.open(doc(`${LAYER}<rect id="a" width="5" height="5"/></g>`))));
    expect(painterRoot().querySelector(".spatial-defs, defs")).toBeNull();
    painter.update(builder.build(engine));
    expect(painterRoot().firstElementChild!.getAttribute("class")).toBe("spatial-layer spatial-defs");
    painter.dispose();
    expect(host.querySelector("defs")).toBeNull();
  });

  it("di due superfici nella stessa pagina non si incontrano", () => {
    const other = document.createElement("div");
    document.body.append(other);
    const scene = sceneOf(SceneEngine.open(ALL), new PaintBuilder());
    createSvgPainter(host, owner).update(scene);
    createSvgPainter(other, owner).update(scene);
    expect(prefixOf(host)).not.toBe(prefixOf(other));
    for (const box of [host, other]) {
      const fill = painterRoot(box).querySelector('[data-scene-id="a"]')!.getAttribute("fill")!;
      const target = document.getElementById(/#([^)]+)\)/.exec(fill)![1]!)!;
      expect(target.localName).toBe("pattern");
      expect(painterRoot(box).contains(target)).toBe(true);
    }
  });

  it("hanno id vivi diversi per id diversi, che url(#…) legge senza escape", () => {
    expect(liveId("fubdraw1-", "r1a2b3c4d")).toBe("fubdraw1-r1a2b3c4d");
    expect(liveId("fubdraw1-", "Sfumatura.1é")).toBe("fubdraw1-Sfumatura.2e.1.e9.");
    expect(liveId("fubdraw1-", "a.")).not.toBe(liveId("fubdraw1-", "a.2e."));
    expect(liveId("fubdraw1-", "a b")).toBe("fubdraw1-a.20.b");
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(doc(
      '<defs id="fub-defs"><linearGradient id="mare.1" x2="1"><stop offset="0" stop-color="#0072b2"/></linearGradient></defs>'
        + `${LAYER}<rect id="a" width="5" height="5" fill="url(#mare.1) #0072b2"/></g>`,
    )), new PaintBuilder()));
    const fill = painterRoot().querySelector('[data-scene-id="a"]')!.getAttribute("fill")!;
    expect(fill).toMatch(/^url\(#fubdraw\d+-mare\.2e\.1\) #0072b2$/);
    expect(document.getElementById(/#([^)]+)\)/.exec(fill)![1]!)!.localName).toBe("linearGradient");
  });

  it("hanno il tracciato di un testo, a cui il textPath vivo rimanda", () => {
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(doc(
      '<defs id="fub-defs"><path id="r1" fub:role="private" d="M0 50 L100 50"/></defs>'
        + `${LAYER}<text id="t" font-size="10"><textPath href="#r1" startOffset="50%">a <tspan font-weight="bold">b</tspan></textPath></text></g>`,
    )), new PaintBuilder()));
    const root = painterRoot();
    const path = root.querySelector("defs > path")!;
    expect(path.id).toMatch(/^fubdraw\d+-r1$/);
    expect(path.getAttribute("d")).toBe("M0 50 L100 50");
    const along = root.querySelector('[data-scene-id="t"] > textPath')!;
    expect(along.getAttribute("href")).toBe(`#${path.id}`);
    expect(along.getAttribute("startOffset")).toBe("50%");
    expect(along.textContent).toBe("a b");
    expect(along.querySelector("tspan")!.getAttribute("font-weight")).toBe("bold");
    expect(document.getElementById(path.id)).toBe(path);
  });

  it("vanno nelle miniature, solo quelle che servono, con un prefisso loro", () => {
    const engine = SceneEngine.open(ALL);
    const builder = new PaintBuilder();
    const scene = builder.build(engine);
    const chain = [scene.root.attrs, builder.headInfo(engine.holder("l1") as ContainerNode).attrs];
    const paints = builder.paintsOf(engine.holder("a")!);
    const svg = paintMiniature(paints, chain, { x: 0, y: 0, width: 5, height: 5 }, owner, undefined, resourcesFor(paints, chain, scene.resources));
    const defs = svg.querySelector("defs")!;
    // Dentro il `g` della radice, che il contenuto eredita.
    expect(defs.parentElement).toBe(svg.firstElementChild);
    const ids = [...defs.children].map((el) => el.id);
    const prefix = ids[0]!.slice(0, -"g1".length);
    expect(prefix).toMatch(/^fubthumb\d+-$/);
    expect(ids).toEqual(["g1", "p1", "f1"].map((id) => prefix + id));
    const rect = [...svg.querySelectorAll("rect")].find((el) => el.closest("defs") === null)!;
    expect(rect.getAttribute("fill")).toBe(`url(#${prefix}p1) #4593ce`);
    // Senza risorse, nessuna defs.
    const plain = paintMiniature(builder.paintsOf(engine.holder("b")!), chain, { x: 0, y: 0, width: 10, height: 1 }, owner);
    expect(plain.querySelector("defs")).toBeNull();
  });
});

describe("i simboli vivi", () => {
  const DEFS = '<defs id="fub-defs">'
    + '<linearGradient id="g1" x2="1"><stop offset="0" stop-color="#0072b2"/></linearGradient>'
    + '<symbol id="r1" overflow="visible"><title>Presa</title><circle id="o1" r="20" fill="url(#g1) #0072b2"/>'
    + '<g id="o2" transform="rotate(45)"><line id="o3" x1="-8" y1="0" x2="8" y2="0" stroke="#000000"/></g>'
    + '<image id="o7" href="presa.png" width="4" height="4"/></symbol>'
    + '<symbol id="r2" overflow="visible"><rect id="o4" width="60" height="40"/><use id="o5" transform="translate(30 20)" href="#r1"/></symbol>'
    + '</defs>';
  const SOURCE = doc(`${DEFS}${LAYER}<use id="i1" transform="translate(10 20)" href="#r2"/><use id="i2" href="#r1"/></g>`);

  const prefixOf = (): string => host.querySelector("defs > linearGradient")!.id.slice(0, -"g1".length);

  it("stanno in una seconda defs come symbol, e un'istanza è un use verso l'id vivo", () => {
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(SOURCE), new PaintBuilder()));
    const prefix = prefixOf();
    const [resources, symbols] = [...host.querySelector(".spatial-defs")!.children];
    expect([resources!.localName, symbols!.localName]).toEqual(["defs", "defs"]);
    expect([...symbols!.children].map((el) => [el.localName, el.id, el.getAttribute("overflow"), el.getAttribute("data-scene-id")])).toEqual([
      ["symbol", `${prefix}r1`, "visible", "r1"],
      ["symbol", `${prefix}r2`, "visible", "r2"],
    ]);
    const at = (id: string): Element => host.querySelector(`[data-scene-id="${id}"]`)!;
    // Il contenuto è vivo come quello di uno strato, coi riferimenti riscritti.
    expect(at("o1").closest("symbol")).toBe(symbols!.firstElementChild);
    expect(at("o1").getAttribute("fill")).toBe(`url(#${prefix}g1) #0072b2`);
    expect([at("o2").localName, at("o2").getAttribute("transform"), at("o3").parentElement]).toEqual(["g", "rotate(45)", at("o2")]);
    expect([at("o5").localName, at("o5").getAttribute("href"), at("o5").getAttribute("transform")]).toEqual(["use", `#${prefix}r1`, "translate(30 20)"]);
    expect(symbols!.querySelectorAll("title")).toHaveLength(0);
    // Le istanze stanno negli strati vivi.
    expect([at("i1").localName, at("i1").getAttribute("href"), at("i1").getAttribute("transform")]).toEqual(["use", `#${prefix}r2`, "translate(10 20)"]);
    expect(at("i2").getAttribute("href")).toBe(`#${prefix}r1`);
    expect(at("i1").closest(".spatial-defs")).toBeNull();
  });

  it("si riconciliano per identità, e la defs esce con l'ultimo simbolo", () => {
    const asked: string[] = [];
    const lives: Lifetime[] = [];
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner, {
      images: async (path, life) => {
        asked.push(path);
        lives.push(life);
        return "fub-asset://lease/1";
      },
    });
    const engine = SceneEngine.open(SOURCE);
    painter.update(builder.build(engine));
    const at = (id: string): Element => host.querySelector(`[data-scene-id="${id}"]`)!;
    const before = ["r1", "r2", "o1", "o2", "o3", "o4", "i1"].map(at);
    expect(asked).toEqual(["presa.png"]);
    // Cambia un pezzo del contenuto: il resto, il simbolo e le istanze restano.
    expect(engine.apply({ op: "set", id: "o1", attrs: { fill: "#ff0000" } }).outcome).toBe("applied");
    painter.update(builder.build(engine));
    const after = ["r1", "r2", "o1", "o2", "o3", "o4", "i1"].map(at);
    expect(after[2]).not.toBe(before[2]);
    expect(after[2]!.getAttribute("fill")).toBe("#ff0000");
    for (const i of [0, 1, 3, 4, 5, 6]) expect(after[i], String(i)).toBe(before[i]);
    expect(lives[0]!.closed).toBe(false);
    // Senza simboli né risorse la defs se ne va, e l'immagine del contenuto
    // con lei.
    painter.update(builder.build(SceneEngine.open(doc(`${LAYER}<rect id="a" width="5" height="5"/></g>`))));
    expect(host.querySelector(".spatial-defs")).toBeNull();
    expect(lives[0]!.closed).toBe(true);
    // Con soli simboli la defs torna.
    painter.update(builder.build(SceneEngine.open(doc('<defs id="fub-defs"><symbol id="r9" overflow="visible"><rect id="o9" width="1" height="1"/></symbol></defs>'))));
    expect(host.querySelector(".spatial-defs symbol")!.getAttribute("data-scene-id")).toBe("r9");
    painter.dispose();
    expect(host.querySelector("symbol")).toBeNull();
  });

  it("mostrano l'anteprima del contenuto in ogni istanza", () => {
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    const engine = SceneEngine.open(SOURCE);
    painter.update(builder.build(engine));
    const [paint] = builder.paintsOf(engine.holder("o4")!);
    painter.setDraft({ transforms: new Map([[paint!, "translate(5 0)"]]) });
    expect(host.querySelector('[data-scene-id="o4"]')!.getAttribute("transform")).toBe("translate(5 0)");
    painter.setDraft(null);
    expect(host.querySelector('[data-scene-id="o4"]')!.hasAttribute("transform")).toBe(false);
  });

  it("attenuano le altre istanze, non quella da cui si modifica il simbolo", () => {
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    const engine = SceneEngine.open(SOURCE);
    painter.update(builder.build(engine));
    const [instance] = builder.paintsOf(engine.holder("i1")!);
    painter.setFocus([engine.holder("l1")!, instance!]);
    const node = (id: string): SVGElement => host.querySelector(`[data-scene-id="${id}"]`)!;
    expect(node("i1").style.opacity).toBe("");
    expect(node("i2").style.opacity).toBe("0.4");
    // Il contenuto del simbolo non si attenua: si vede com'è nell'istanza.
    expect(node("o4").style.opacity).toBe("");
    painter.setFocus(null);
    expect(node("i2").style.opacity).toBe("");
  });

  it("vanno nelle miniature delle istanze, coi simboli che usano e un prefisso loro", () => {
    const engine = SceneEngine.open(SOURCE);
    const builder = new PaintBuilder();
    const scene = builder.build(engine);
    const chain = [scene.root.attrs, builder.headInfo(engine.holder("l1") as ContainerNode).attrs];
    const paints = builder.paintsOf(engine.holder("i1")!);
    const symbols = symbolsFor(paints, scene.symbols);
    const used = resourcesFor([...paints, ...symbols], chain, scene.resources);
    const svg = paintMiniature(paints, chain, { x: 0, y: 0, width: 80, height: 60 }, owner, undefined, used, undefined, symbols);
    const defs = svg.querySelector("defs")!;
    const ids = [...defs.children].map((el) => el.id);
    const prefix = ids[0]!.slice(0, -"g1".length);
    expect(prefix).toMatch(/^fubthumb\d+-$/);
    expect(ids).toEqual(["g1", "r1", "r2"].map((id) => prefix + id));
    expect(defs.querySelector("symbol")!.getAttribute("overflow")).toBe("visible");
    const use = [...svg.querySelectorAll("use")].find((el) => el.closest("defs") === null)!;
    expect(use.getAttribute("href")).toBe(`#${prefix}r2`);
    expect(svg.querySelectorAll("[data-scene-id]")).toHaveLength(0);
  });
});

describe("le copie vive", () => {
  const ROW = '<g id="p1" fub:repeat="grid 3 1 20 0"><rect id="a" width="10" height="10"/>'
    + '<use id="c1" transform="translate(20 0)" href="#a"/><use id="c2" transform="translate(40 0)" href="#a"/></g>';
  const SOURCE = doc(`${LAYER}${ROW}<rect id="b" width="1" height="1"/></g>`);
  const at = (id: string): Element => host.querySelector(`[data-scene-id="${id}"]`)!;

  it("sono use verso l'id vivo dell'originale, l'unico che ne ha uno", () => {
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(SOURCE), new PaintBuilder()));
    const live = at("a").id;
    expect(live).toMatch(/^fubdraw\d+-a$/);
    expect([at("c1").localName, at("c1").getAttribute("href"), at("c1").getAttribute("transform")]).toEqual(["use", `#${live}`, "translate(20 0)"]);
    expect(at("c2").getAttribute("href")).toBe(`#${live}`);
    for (const id of ["l1", "p1", "c1", "c2", "b"]) expect(at(id).hasAttribute("id"), id).toBe(false);
  });

  it("l'id vivo arriva e se ne va con le copie, anche su un nodo che resta", () => {
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    const engine = SceneEngine.open(doc(`${LAYER}<g id="p1" fub:repeat="grid 2 1 20 0"><rect id="a" width="10" height="10"/></g></g>`));
    painter.update(builder.build(engine));
    const rect = at("a");
    expect(rect.hasAttribute("id")).toBe(false);
    const copy = { op: "add", parent: "p1", pos: { last: true }, elem: { tag: "use", attrs: { id: "o1a2b3c4d", transform: "translate(20 0)", href: "#a" } } } as const;
    expect(engine.apply(copy).outcome).toBe("applied");
    painter.update(builder.build(engine));
    expect(at("a")).toBe(rect);
    expect(rect.id).toMatch(/^fubdraw\d+-a$/);
    expect(at("o1a2b3c4d").getAttribute("href")).toBe(`#${rect.id}`);
    // Un originale che cambia si rifà, e ha subito il suo id vivo.
    expect(engine.apply({ op: "set", id: "a", attrs: { fill: "#ff0000" } }).outcome).toBe("applied");
    painter.update(builder.build(engine));
    expect(at("a")).not.toBe(rect);
    expect(at("a").id).toBe(rect.id);
    const changed = at("a");
    expect(engine.apply({ op: "remove", target: "o1a2b3c4d" }).outcome).toBe("applied");
    painter.update(builder.build(engine));
    expect(at("a")).toBe(changed);
    expect(changed.hasAttribute("id")).toBe(false);
  });

  it("un gruppo può essere l'originale", () => {
    const painter = createSvgPainter(host, owner);
    const source = doc(`${LAYER}<g id="p1" fub:repeat="radial 4 0 0"><g id="o1"><rect id="a" width="10" height="10"/></g>`
      + '<use id="c1" transform="matrix(0 1 -1 0 0 0)" href="#o1"/></g></g>');
    painter.update(sceneOf(SceneEngine.open(source), new PaintBuilder()));
    expect(at("o1").localName).toBe("g");
    expect(at("c1").getAttribute("href")).toBe(`#${at("o1").id}`);
    expect(at("a").hasAttribute("id")).toBe(false);
  });

  it("seguono l'originale nell'anteprima", () => {
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    const engine = SceneEngine.open(SOURCE);
    painter.update(builder.build(engine));
    const [paint] = builder.paintsOf(engine.holder("a")!);
    painter.setDraft({ transforms: new Map([[paint!, "translate(5 0)"]]) });
    // Il browser disegna ogni copia dall'originale com'è adesso.
    expect(at("a").getAttribute("transform")).toBe("translate(5 0)");
    expect(at("c1").getAttribute("href")).toBe(`#${at("a").id}`);
    painter.setDraft(null);
    expect(at("a").hasAttribute("transform")).toBe(false);
  });

  it("vanno nelle miniature con l'originale, sotto il prefisso della miniatura", () => {
    const engine = SceneEngine.open(SOURCE);
    const builder = new PaintBuilder();
    const scene = builder.build(engine);
    const chain = [scene.root.attrs, builder.headInfo(engine.holder("l1") as ContainerNode).attrs];
    const svg = paintMiniature(builder.paintsOf(engine.holder("p1")!), chain, { x: 0, y: 0, width: 50, height: 10 }, owner);
    const rect = svg.querySelector("rect")!;
    expect(rect.id).toMatch(/^fubthumb\d+-a$/);
    expect([...svg.querySelectorAll("use")].map((use) => use.getAttribute("href"))).toEqual([`#${rect.id}`, `#${rect.id}`]);
    expect(svg.querySelectorAll("[data-scene-id]")).toHaveLength(0);
  });
});
