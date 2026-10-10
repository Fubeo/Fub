// La scena di un painter (`paint.ts`): quali strati, con che cosa dentro, e
// che cosa resta lo stesso oggetto fra una modifica e l'altra.

import { describe, expect, it } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import RESOURCES from "../../../__fixtures__/scene/resources.svg?raw";
import { SceneEngine } from "../scene/engine";
import { doc, HEAD } from "../scene/test-support";
import { SourceText } from "../scene/text";
import { NS_NONE, NS_SVG, parseXml, type NodeId } from "../scene/xml";
import {
  IMAGE_PLACEHOLDER,
  imageDocument,
  MAX_IMAGE_LAYERS,
  PaintBuilder,
  resourcesFor,
  symbolsFor,
  wholeDocumentLayer,
  type ImageLayer,
  type LiveLayer,
  type PaintDef,
  type PaintGroup,
  type PaintScene,
  type PaintShape,
} from "./paint";

const LAYER = '<g id="l1" fub:layer="Livello 1">';
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function sceneOf(source: string, builder = new PaintBuilder()): PaintScene {
  return builder.build(SceneEngine.open(source));
}

function kinds(scene: PaintScene): string[] {
  return scene.layers.map((layer) => layer.kind);
}

function live(scene: PaintScene, index: number): LiveLayer {
  const layer = scene.layers[index]!;
  if (layer.kind !== "live") throw new Error(`lo strato ${index} è ${layer.kind}`);
  return layer;
}

function image(scene: PaintScene, index: number): ImageLayer {
  const layer = scene.layers[index]!;
  if (layer.kind !== "image") throw new Error(`lo strato ${index} è ${layer.kind}`);
  return layer;
}

describe("gli strati vivi", () => {
  it("portano forme e gruppi coi soli attributi dipinti", () => {
    const scene = sceneOf(doc(
      `<title>T</title>${LAYER}<rect id="r1" x="1" y="2" width="3" height="4" fill="#ff0000" fub:note="n"/>`
        + '<a href="Note/altra.md"><circle id="c1" cx="5" cy="5" r="2"/></a></g>',
    ));
    expect(kinds(scene)).toEqual(["live"]);
    const [layer] = live(scene, 0).nodes as [PaintGroup];
    expect(layer).toMatchObject({ kind: "group", role: "layer", id: "l1", attrs: [] });
    const [rect, link] = layer.children as [PaintShape, PaintGroup];
    expect(rect).toMatchObject({ kind: "shape", tag: "rect", id: "r1" });
    expect(rect.attrs).toEqual([["x", "1"], ["y", "2"], ["width", "3"], ["height", "4"], ["fill", "#ff0000"]]);
    // Un collegamento è un gruppo: niente `href` vivo.
    expect(link).toMatchObject({ kind: "group", attrs: [] });
    expect((link.children[0] as PaintShape).tag).toBe("circle");
  });

  it("tengono le righe di un testo e gli spazi fra loro", () => {
    const scene = sceneOf(doc(
      `${LAYER}<text id="t1" x="10" y="20" font-size="12" xml:space="preserve"><title>x</title>`
        + '<tspan x="10" dy="0">uno &amp; due</tspan>\n  <tspan x="10" dy="14">tre</tspan></text></g>',
    ));
    const text = (live(scene, 0).nodes[0] as PaintGroup).children[0] as PaintShape;
    expect(text).toMatchObject({ tag: "text", space: "preserve" });
    expect(text.runs).toEqual([
      { kind: "span", attrs: [["x", "10"], ["dy", "0"]], space: null, text: "uno & due" },
      { kind: "space", text: "\n  " },
      { kind: "span", attrs: [["x", "10"], ["dy", "14"]], space: null, text: "tre" },
    ]);
  });

  it("tengono i pezzi di una riga, ciascuno coi suoi attributi dipinti", () => {
    const scene = sceneOf(doc(
      `${LAYER}<text id="t1" x="10" y="20" font-style="italic">`
        + '<tspan x="10" dy="0" letter-spacing="1">a <tspan font-weight="bold" text-decoration="underline" fub:nota="n">b &amp; c</tspan>!</tspan>'
        + '<tspan x="10" dy="14">d</tspan></text></g>',
    ));
    const text = (live(scene, 0).nodes[0] as PaintGroup).children[0] as PaintShape;
    expect(text.attrs).toEqual([["x", "10"], ["y", "20"], ["font-style", "italic"]]);
    expect(text.runs).toEqual([
      {
        kind: "span",
        attrs: [["x", "10"], ["dy", "0"], ["letter-spacing", "1"]],
        space: null,
        text: "a b & c!",
        parts: ["a ", { attrs: [["font-weight", "bold"], ["text-decoration", "underline"]], space: null, text: "b & c" }, "!"],
      },
      // Una riga senza pezzi resta testo.
      { kind: "span", attrs: [["x", "10"], ["dy", "14"]], space: null, text: "d" },
    ]);
  });

  it("dicono da dove viene un'immagine, senza caricarla", () => {
    const scene = sceneOf(doc(
      `${LAYER}<image id="i1" href="${PNG}" width="4" height="4"/>`
        + '<image id="i2" href="Risorse/foto%20mare.png" width="4" height="4" preserveAspectRatio="xMidYMid slice"/>'
        + '<image id="i3" href="https://esempio.it/x.png" width="4" height="4"/></g>',
    ));
    const [a, b, c] = (live(scene, 0).nodes[0] as PaintGroup).children as PaintShape[];
    expect(a!.image).toEqual({ kind: "data", url: PNG });
    expect(b!.image).toEqual({ kind: "vault", path: "Risorse/foto%20mare.png" });
    expect(b!.attrs).toContainEqual(["preserveAspectRatio", "xMidYMid slice"]);
    expect(c!.image).toEqual({ kind: "remote" });
    for (const shape of [a!, b!, c!]) expect(shape.attrs.some(([name]) => name === "href" || name === "id")).toBe(false);
  });

  it("ereditano dalla radice solo ciò che varrebbe su un gruppo", () => {
    const source = `${HEAD.replace(">", ' fill="#0072b2" stroke="url(#g)" font-size="14" width="200" height="100">')}`
      + `${LAYER}<rect width="1" height="1"/></g></svg>`;
    const scene = sceneOf(source);
    expect(scene.root.attrs).toEqual([["fill", "#0072b2"], ["font-size", "14"]]);
    expect(scene.root.page).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("leggono dalla radice l'unità e le guide dei righelli; quelle fuori grammatica non si leggono", () => {
    const body = `${LAYER}<rect width="1" height="1"/></g></svg>`;
    const plain = sceneOf(`${HEAD}${body}`);
    expect(plain.root.units).toBe("px");
    expect(plain.root.guides).toEqual([]);
    const ruled = sceneOf(`${HEAD.replace(">", ' fub:units="mm" fub:guides="x 10; y 20.5 locked">')}${body}`);
    expect(ruled.root.units).toBe("mm");
    expect(ruled.root.guides).toEqual([
      { axis: "x", at: 10, locked: false },
      { axis: "y", at: 20.5, locked: true },
    ]);
    // Un'unità sconosciuta vale i pixel; guide illeggibili restano scritte,
    // ma l'editor non le tocca.
    const odd = sceneOf(`${HEAD.replace(">", ' fub:units="furlong" fub:guides="z 10">')}${body}`);
    expect(odd.root.units).toBe("px");
    expect(odd.root.guides).toBeNull();
  });
});

describe("gli strati immagine", () => {
  it("separano i vivi dove c'è un blocco estraneo che disegna", () => {
    const scene = sceneOf(doc(
      `${LAYER}<rect id="a" width="1" height="1"/><use href="#a" x="5"/><foreignObject width="9" height="9"><p xmlns="http://www.w3.org/1999/xhtml">x</p></foreignObject>`
        + '<rect id="b" width="1" height="1"/></g>',
    ));
    expect(kinds(scene)).toEqual(["live", "image", "live"]);
    const before = live(scene, 0).nodes[0] as PaintGroup;
    const after = live(scene, 2).nodes[0] as PaintGroup;
    // Lo stesso livello, spezzato in due pezzi con la stessa chiave.
    expect(before.key).toBe(after.key);
    expect(before).not.toBe(after);
    const body = image(scene, 1).body;
    expect(body).toContain('<g id="l1" fub:layer="Livello 1"><use href="#a" x="5"/><foreignObject');
    expect(body.endsWith("</g></svg>")).toBe(true);
    expect(image(scene, 1).transparent).toBe(true);
  });

  it("sanno quali contenitori le racchiudono tutte", () => {
    const engine = SceneEngine.open(doc(
      `<use href="#a"/>${LAYER}<g id="g"><rect id="a" width="1" height="1"/><use href="#a"/></g><use href="#a" x="2"/></g>`,
    ));
    const scene = new PaintBuilder().build(engine);
    expect(kinds(scene)).toEqual(["image", "live", "image", "image"]);
    const [layer, group] = [engine.holder("l1"), engine.holder("g")];
    expect(image(scene, 0).containers).toHaveLength(0);
    expect(image(scene, 2).containers).toHaveLength(2);
    expect(image(scene, 2).containers[0]).toBe(layer);
    expect(image(scene, 2).containers[1]).toBe(group);
    // È la chiave dei gruppi che il painter ritrova.
    expect(image(scene, 2).containers[1]).toBe(((live(scene, 1).nodes[0] as PaintGroup).children[0] as PaintGroup).key);
    expect(image(scene, 3).containers).toHaveLength(1);
    expect(image(scene, 3).containers[0]).toBe(layer);
  });

  it("unite oltre il limite, le racchiude solo chi le contiene tutte e due", () => {
    let body = `${LAYER}<g id="g"><use href="#a"/></g><use href="#a"/>`;
    for (let i = 0; i < MAX_IMAGE_LAYERS + 2; i++) body += `<rect id="r${i}" width="1" height="1"/><use href="#a"/>`;
    const engine = SceneEngine.open(doc(`${body}</g>`));
    const scene = new PaintBuilder().build(engine);
    // Fra la sequenza nel gruppo e quella dopo non c'è niente di vivo: si
    // uniscono per prime.
    const first = image(scene, 0);
    expect(first.body).toContain('<g id="g"><use href="#a"/></g><use href="#a"/>');
    expect(first.containers).toHaveLength(1);
    expect(first.containers[0]).toBe(engine.holder("l1"));
  });

  it("non nascono per ciò che da solo non disegna", () => {
    const scene = sceneOf(doc(
      '<defs><linearGradient id="g"/></defs><metadata>m</metadata><!-- nota --><fub:extra/>'
        + `${LAYER}<rect width="1" height="1"/></g><g id="l2" fub:layer="Nascosto" display="none"><use href="#g"/></g>`,
    ));
    expect(kinds(scene)).toEqual(["live"]);
  });

  it("portano nei defs ciò a cui rimandano, a cascata, e i fogli di stile", () => {
    const scene = sceneOf(doc(
      '<defs><linearGradient id="g0"><stop offset="0"/></linearGradient><linearGradient id="g" href="#g0"/>'
        + '<linearGradient id="inutile"/></defs><style>.x{fill:red}</style>'
        + `${LAYER}<rect width="1" height="1"/><rect class="x" width="2" height="2" fill="url(#g)"/></g>`,
    ));
    expect(kinds(scene)).toEqual(["live", "image"]);
    const body = image(scene, 1).body;
    expect(body.startsWith("<defs>")).toBe(true);
    const defs = body.slice(0, body.indexOf("</defs>"));
    expect(defs).toContain("<style>.x{fill:red}</style>");
    // Il gradiente sta dentro il suo `defs`, che è un'unità: entra intero,
    // col gradiente a cui rimanda.
    expect(defs).toContain('<linearGradient id="g" href="#g0"/>');
    expect(defs).toContain('<linearGradient id="g0">');
    expect(body).toContain('fill="url(#g)"');
  });

  it("mettono il segnaposto al posto di ogni immagine che non è un raster in linea", () => {
    const scene = sceneOf(doc(
      // Un gruppo con un ritaglio è estraneo, e lo sono le immagini che porta.
      `${LAYER}<rect width="1" height="1"/><g clip-path="url(#nessuno)"><image href="foto.png" width="5" height="5"/>`
        + `<image xlink:href="https://esempio.it/a.png" width="5" height="5"/><image href="${PNG}" width="5" height="5"/>`
        + "</g></g>",
    ));
    const body = image(scene, 1).body;
    expect(body).not.toContain("foto.png");
    expect(body).not.toContain("esempio.it");
    expect(body.split(IMAGE_PLACEHOLDER).length - 1).toBe(2);
    expect(body).toContain(PNG);
  });

  it(`sono al più ${MAX_IMAGE_LAYERS}: si uniscono dove ci sono meno elementi vivi`, () => {
    let body = LAYER;
    for (let i = 0; i < 12; i++) {
      body += `<use href="#r${i}"/>`;
      // Fra la terza e la quarta sequenza estranea ci sono cinque elementi vivi.
      const between = i === 2 ? 5 : 1;
      for (let j = 0; j < between; j++) body += `<rect id="r${i}x${j}" width="1" height="1"/>`;
    }
    const scene = sceneOf(doc(`${body}</g>`));
    const images = scene.layers.filter((layer) => layer.kind === "image");
    expect(images).toHaveLength(MAX_IMAGE_LAYERS);
    // I cinque elementi fra la terza e la quarta restano vivi.
    const lives = scene.layers.filter((layer): layer is LiveLayer => layer.kind === "live");
    const ids = lives.flatMap((layer) => (layer.nodes[0] as PaintGroup).children.map((node) => node.id));
    for (let j = 0; j < 5; j++) expect(ids).toContain(`r2x${j}`);
    // Gli altri uniti stanno nell'immagine, nel loro ordine.
    const merged = images.map((layer) => (layer as ImageLayer).body).join("");
    expect(merged).toMatch(/<use href="#r3"\/><rect id="r3x0" width="1" height="1"\/><use href="#r4"\/>/);
  });

  it("ricostruiscono la radice per la vista e tolgono lo sfondo", () => {
    const source = HEAD.replace(">", ' width="10cm" style="background:#000" preserveAspectRatio="none" fill="red">')
      + `${LAYER}<use href="#x"/></g></svg>`;
    const scene = sceneOf(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- licenza -->\n${source}`);
    const text = imageDocument(image(scene, 0), { x: -5, y: 10, width: 50, height: 25, pixelWidth: 200, pixelHeight: 100 });
    expect(text.startsWith("\n<!-- licenza -->\n<svg")).toBe(true);
    const open = text.slice(0, text.indexOf(">", text.indexOf("<svg")) + 1);
    expect(open).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(open).toContain('xmlns:fub="https://fubeo.github.io/ns/scene/1"');
    expect(open).toContain('fill="red"');
    expect(open).not.toContain("10cm");
    expect(open).not.toContain("0 0 100 100");
    expect(open).toContain('width="200" height="100" viewBox="-5 10 50 25" preserveAspectRatio="none"');
    expect(open).toContain('style="background:#000;background:none!important"');
  });

  it("portano un foglio di stile come primo figlio dell'svg più esterno", () => {
    const scene = sceneOf(HEAD + `${LAYER}<use href="#x"/></g></svg>`);
    const flat = imageDocument(image(scene, 0), { x: 0, y: 0, width: 100, height: 50, pixelWidth: 200, pixelHeight: 100 }, "@font-face{}");
    expect(flat).toMatch(/^<svg [^>]*><style>@font-face\{\}<\/style>/);
    const turned = imageDocument(image(scene, 0), { x: 0, y: 0, width: 100, height: 50, pixelWidth: 200, pixelHeight: 100, angle: 30 }, "@font-face{}");
    expect(turned).toMatch(/^<svg [^>]*><style>@font-face\{\}<\/style><g transform="rotate\(30\)/);
    expect(turned.match(/<style>/g)).toHaveLength(1);
    for (const text of [flat, turned]) {
      const parsed = parseXml(new SourceText(text), false);
      expect(parsed.element(parsed.root)?.ns).toBe(NS_SVG);
    }
    expect(imageDocument(image(scene, 0), { x: 0, y: 0, width: 100, height: 50, pixelWidth: 200, pixelHeight: 100 })).not.toContain("<style>");
  });

  it("girate, annidano la radice in un svg che le gira, allineato ai pixel", () => {
    const source = HEAD.replace(">", ' style="background:#000" fill="red">') + `${LAYER}<use href="#x"/></g></svg>`;
    const scene = sceneOf(source);
    const text = imageDocument(image(scene, 0), { x: 0, y: 0, width: 100, height: 50, pixelWidth: 200, pixelHeight: 100, angle: 90 });
    const outer = text.slice(text.indexOf("<svg"), text.indexOf(">", text.indexOf("<svg")) + 1);
    expect(outer).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 50" preserveAspectRatio="none" style="background:#000;background:none!important">');
    expect(text).toContain('<g transform="rotate(90) translate(0 0)"><svg');
    // La vista annidata copre il rettangolo girato, con due pixel in più per
    // lato: a destra sullo schermo è in su nella scena.
    expect(text).toContain('x="-1" y="-101" width="52" height="102" viewBox="-1 -101 52 102"');
    expect(text).toContain('fill="red"');
    expect(text.endsWith("</svg></g></svg>")).toBe(true);
    // Un documento ben formato, con la radice esterna nel namespace di SVG.
    const parsed = parseXml(new SourceText(text), false);
    expect(parsed.element(parsed.root)?.ns).toBe(NS_SVG);
  });
});

describe("una scena dopo l'altra", () => {
  const SOURCE = doc(
    `${LAYER}<rect id="a" width="1" height="1"/><use href="#a"/><rect id="b" width="1" height="1"/></g>`
      + '<g id="l2" fub:layer="Livello 2"><circle id="c" r="1"/></g>',
  );

  it("riusa ciò che un'operazione non tocca", () => {
    const engine = SceneEngine.open(SOURCE);
    const builder = new PaintBuilder();
    const first = builder.build(engine);
    expect(builder.build(engine).layers).toEqual(first.layers);
    for (const [i, layer] of builder.build(engine).layers.entries()) expect(layer).toBe(first.layers[i]);

    expect(engine.apply({ op: "set", id: "b", attrs: { fill: "#00ff00" } }).outcome).toBe("applied");
    const second = builder.build(engine);
    // Prima del blocco estraneo niente cambia; l'immagine è la stessa.
    expect(second.layers[0]).toBe(first.layers[0]);
    expect(second.layers[1]).toBe(first.layers[1]);
    const [l1, l2] = live(second, 2).nodes as [PaintGroup, PaintGroup];
    const [oldL1, oldL2] = live(first, 2).nodes as [PaintGroup, PaintGroup];
    expect(l1).not.toBe(oldL1);
    expect(l1.key).toBe(oldL1.key);
    expect(l1.children[0]).toMatchObject({ id: "b", attrs: expect.arrayContaining([["fill", "#00ff00"]]) });
    expect(l2).toBe(oldL2);
  });

  it("cambia l'immagine quando cambia ciò che porta", () => {
    const engine = SceneEngine.open(SOURCE);
    const builder = new PaintBuilder();
    const first = builder.build(engine);
    // `c` non sta nell'immagine e l'immagine non lo nomina: resta la stessa.
    expect(engine.apply({ op: "set", id: "c", attrs: { fill: "#00ff00" } }).outcome).toBe("applied");
    const second = builder.build(engine);
    expect(second.layers[1]).toBe(first.layers[1]);
    // `a` è vivo, ma il `use` dell'immagine lo disegna dai suoi `defs`.
    expect(image(first, 1).body).toContain('<defs><rect id="a" width="1" height="1"/></defs>');
    expect(engine.apply({ op: "set", id: "a", attrs: { fill: "#00ff00" } }).outcome).toBe("applied");
    const third = builder.build(engine);
    expect(third.layers[1]).not.toBe(first.layers[1]);
    expect(image(third, 1).body).toContain('<defs><rect id="a" width="1" height="1" fill="#00ff00"/></defs>');
  });

  it("ritrova le forme in un motore riaperto sullo stesso testo", () => {
    const builder = new PaintBuilder();
    const first = sceneOf(SOURCE, builder);
    const second = sceneOf(SOURCE, builder);
    const shapes = (scene: PaintScene): unknown[] => scene.layers
      .filter((layer): layer is LiveLayer => layer.kind === "live")
      .flatMap((layer) => layer.nodes.flatMap((node) => (node as PaintGroup).children));
    const before = shapes(first);
    const after = shapes(second);
    expect(after).toHaveLength(before.length);
    for (const [i, shape] of after.entries()) expect(shape).toBe(before[i]);
  });
});

/// Una risorsa per tipo, con dentro ciò che il painter non porta: titoli, id
/// dei figli, attributi di FubDraw, e una sfumatura estranea accanto.
const DEFS = '<defs id="fub-defs">'
  + '<linearGradient id="g1" fub:role="private" x1="0" y1="0" x2="1" y2="0"><title>Mare</title>'
  + '<stop id="s0" offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#56b4e9" stop-opacity="0.5"/></linearGradient>'
  + '<pattern id="p1" fub:role="shared" width="20" height="20" patternUnits="userSpaceOnUse">'
  + '<rect id="dentro" width="10" height="10" fill="url(#g1) #0072b2" fub:nota="n"/>'
  + '<text x="1" y="9" font-size="8" xml:space="preserve"><tspan x="1" dy="0">a</tspan></text></pattern>'
  + '<filter id="f1" x="-0.2" y="-0.2" width="1.4" height="1.4"><feDropShadow id="ombra" dx="0" dy="2" stdDeviation="2" flood-color="#000000"/></filter>'
  + '<linearGradient id="ink" href="#g1"/>'
  + '</defs>';

const ids = (list: readonly { readonly id: string }[]): string[] => list.map((item) => item.id);

describe("le risorse", () => {
  it("stanno nella scena coi soli elementi e attributi del formato, e non sono strati", () => {
    const scene = sceneOf(doc(`${DEFS}${LAYER}<rect id="a" width="5" height="5" fill="url(#p1) #000000" filter="url(#f1)"/></g>`));
    // La sfumatura estranea della defs non disegna: nessuno strato immagine.
    expect(kinds(scene)).toEqual(["live"]);
    expect(live(scene, 0).nodes.map((node) => node.id)).toEqual(["l1"]);
    expect(ids(scene.resources)).toEqual(["g1", "p1", "f1"]);
    const [gradient, pattern, filter] = scene.resources;
    expect(gradient).toEqual({
      id: "g1",
      tag: "linearGradient",
      attrs: [["x1", "0"], ["y1", "0"], ["x2", "1"], ["y2", "0"]],
      space: null,
      children: [
        { tag: "stop", attrs: [["offset", "0"], ["stop-color", "#0072b2"]], space: null, children: [] },
        { tag: "stop", attrs: [["offset", "1"], ["stop-color", "#56b4e9"], ["stop-opacity", "0.5"]], space: null, children: [] },
      ],
    });
    expect(pattern!.attrs).toEqual([["width", "20"], ["height", "20"], ["patternUnits", "userSpaceOnUse"]]);
    expect(pattern!.children).toEqual([
      { tag: "rect", attrs: [["width", "10"], ["height", "10"], ["fill", "url(#g1) #0072b2"]], space: null, children: [] },
      {
        tag: "text",
        attrs: [["x", "1"], ["y", "9"], ["font-size", "8"]],
        space: "preserve",
        children: [{ tag: "tspan", attrs: [["x", "1"], ["dy", "0"]], space: null, children: ["a"] }],
      },
    ]);
    expect(filter!.children).toEqual([
      { tag: "feDropShadow", attrs: [["dx", "0"], ["dy", "2"], ["stdDeviation", "2"], ["flood-color", "#000000"]], space: null, children: [] },
    ]);
  });

  it("del file di prova portano ogni attributo del formato, e niente di più", () => {
    const scene = sceneOf(RESOURCES);
    expect(ids(scene.resources)).toEqual(["r00000001", "r00000002", "r00000003", "r00000004", "r00000005", "r00000006", "r00000007", "r00000008"]);
    const parsed = parseXml(new SourceText(RESOURCES), false);
    const same = (def: PaintDef, at: NodeId): void => {
      const element = parsed.element(at)!;
      expect(def.tag).toBe(element.local);
      expect(def.attrs).toEqual(element.attrs.filter((attr) => attr.ns === NS_NONE && attr.local !== "id").map((attr) => [attr.local, attr.value]));
      const children = element.children.filter((child) => {
        const node = parsed.element(child);
        return node !== null && node.ns === NS_SVG && node.local !== "title" && node.local !== "desc";
      });
      const defs = def.children.filter((child): child is PaintDef => typeof child !== "string");
      expect(defs).toHaveLength(children.length);
      defs.forEach((child, i) => same(child, children[i]!));
    };
    for (const resource of scene.resources) {
      const at = parsed.nodes.findIndex((node) => node.kind === "element" && node.attrs.some((attr) => attr.ns === NS_NONE && attr.local === "id" && attr.value === resource.id));
      same(resource, at);
    }
  });

  it("della scena del banco di fedeltà sono tutte vive, come gli oggetti che le usano", () => {
    const scene = sceneOf(FIDELITY.find((each) => each.id === "risorse")!.text);
    expect(kinds(scene)).toEqual(["live"]);
    expect(ids(scene.resources)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]);
    expect((live(scene, 0).nodes[0] as PaintGroup).children.map((node) => node.id)).toEqual(["o1", "o2", "o3", "o4", "o5", "o6"]);
  });

  it("della scena delle sfumature sono tutte vive, come gli oggetti che le usano", () => {
    const scene = sceneOf(FIDELITY.find((each) => each.id === "sfumature")!.text);
    expect(kinds(scene)).toEqual(["live"]);
    expect(ids(scene.resources)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
    expect((live(scene, 0).nodes[0] as PaintGroup).children.map((node) => node.id)).toEqual(["o1", "o2", "o3", "o4", "o5", "o6", "o7"]);
  });

  it("della scena delle punte sono tutte vive, come gli oggetti che le usano", () => {
    const scene = sceneOf(FIDELITY.find((each) => each.id === "punte")!.text);
    expect(kinds(scene)).toEqual(["live"]);
    expect(ids(scene.resources)).toEqual(["s1", "g1", ...Array.from({ length: 14 }, (_, i) => `p${i + 1}`)]);
    expect((live(scene, 0).nodes[0] as PaintGroup).children.map((node) => node.id)).toEqual(["o1", "o2", "o3", "o4", "o5", "o6", "g2", "o8"]);
  });

  it("della scena dei ritagli sono tutte vive, come gli oggetti e il livello che le usano", () => {
    const scene = sceneOf(FIDELITY.find((each) => each.id === "ritagli")!.text);
    expect(kinds(scene)).toEqual(["live"]);
    expect(ids(scene.resources)).toEqual(["c1", "c2", "c3", "g1", "c4", "g2", "m1", "c5"]);
    const [first, second] = live(scene, 0).nodes as [PaintGroup, PaintGroup];
    expect(first.children.map((node) => node.id)).toEqual(["o1", "o2", "g3", "o5", "g4"]);
    expect(second.attrs).toContainEqual(["clip-path", "url(#c5)"]);
    expect(second.children.map((node) => node.id)).toEqual(["o8", "o9"]);
  });

  it("della scena dei simboli sono tutte vive, coi simboli e le istanze", () => {
    const scene = sceneOf(FIDELITY.find((each) => each.id === "simboli")!.text);
    expect(kinds(scene)).toEqual(["live"]);
    expect(ids(scene.resources)).toEqual(["rgiallo00"]);
    expect(scene.symbols.map((symbol) => symbol.id)).toEqual(["rlampada0", "rquadro00"]);
    expect((live(scene, 0).nodes[0] as PaintGroup).children.map((node) => node.id)).toEqual(["o7", "o8", "o9", "o10"]);
  });

  it("restano gli stessi oggetti finché non cambiano, anche in un motore riaperto", () => {
    const source = doc(`${DEFS}${LAYER}<rect id="a" width="5" height="5" fill="url(#p1) #000000"/><rect id="b" width="1" height="1"/></g>`);
    const engine = SceneEngine.open(source);
    const builder = new PaintBuilder();
    const first = builder.build(engine);
    expect(builder.build(engine).resources).toBe(first.resources);
    expect(engine.apply({ op: "set", id: "b", attrs: { fill: "#00ff00" } }).outcome).toBe("applied");
    expect(builder.build(engine).resources).toBe(first.resources);
    expect(engine.apply({ op: "set", id: "g1", attrs: { x2: "0.5" } }).outcome).toBe("applied");
    const changed = builder.build(engine).resources;
    expect(changed).not.toBe(first.resources);
    expect(changed[0]).not.toBe(first.resources[0]);
    expect(changed[0]!.attrs).toContainEqual(["x2", "0.5"]);
    expect(changed[1]).toBe(first.resources[1]);
    expect(changed[2]).toBe(first.resources[2]);
    const again = new PaintBuilder();
    const before = sceneOf(source, again).resources;
    const after = sceneOf(source, again).resources;
    for (const [i, resource] of after.entries()) expect(resource).toBe(before[i]);
  });

  it("hanno il tracciato di un testo, che il testo usa col suo textPath", () => {
    const scene = sceneOf(doc(
      '<defs id="fub-defs"><path id="r1" fub:role="private" d="M0 50 L100 50"><title>Riva</title></path></defs>'
        + `${LAYER}<text id="t" font-size="10"><textPath href="#r1" startOffset="50%">a <tspan font-weight="bold">b</tspan></textPath></text>`
        + '<text id="u"><textPath xlink:href="#r1">c</textPath></text></g>',
    ));
    expect(scene.resources).toEqual([{ id: "r1", tag: "path", attrs: [["d", "M0 50 L100 50"]], space: null, children: [] }]);
    const [t, u] = (live(scene, 0).nodes[0] as PaintGroup).children as [PaintShape, PaintShape];
    expect(t.runs).toEqual([
      { kind: "path", href: "r1", startOffset: "50%", text: "a b", parts: ["a ", { attrs: [["font-weight", "bold"]], space: null, text: "b" }] },
    ]);
    expect(u.runs).toEqual([{ kind: "path", href: "r1", startOffset: null, text: "c" }]);
    expect(ids(resourcesFor([t], [], scene.resources))).toEqual(["r1"]);
  });

  it("si trovano da chi le usa e da chi lo contiene, a cascata, nell'ordine della defs", () => {
    const scene = sceneOf(doc(`${DEFS}${LAYER}<rect id="a" width="5" height="5" fill="url(#p1) #000000"/><rect id="b" width="1" height="1"/></g>`));
    const layer = live(scene, 0).nodes[0] as PaintGroup;
    const [a, b] = layer.children as [PaintShape, PaintShape];
    expect(ids(resourcesFor([a], [], scene.resources))).toEqual(["g1", "p1"]);
    expect(ids(resourcesFor([layer], [], scene.resources))).toEqual(["g1", "p1"]);
    expect(resourcesFor([b], [], scene.resources)).toEqual([]);
    expect(ids(resourcesFor([b], [[], [["filter", "url(#f1)"]]], scene.resources))).toEqual(["f1"]);
    expect(resourcesFor([a], [], [])).toEqual([]);
  });

  it("vanno nei defs delle immagini che le usano, coi motivi e le loro sfumature", () => {
    const scene = sceneOf(doc(`${DEFS}${LAYER}<rect id="a" width="1" height="1"/><use href="#a" fill="url(#p1) #000000"/></g>`));
    expect(kinds(scene)).toEqual(["live", "image"]);
    const body = image(scene, 1).body;
    const defs = body.slice(0, body.indexOf("</defs>"));
    expect(defs).toContain('<pattern id="p1"');
    expect(defs).toContain('<linearGradient id="g1"');
    expect(defs).not.toContain('<filter id="f1"');
  });

  it("vanno nei defs delle immagini anche dal livello che le racchiude e dagli oggetti che uniscono", () => {
    const framed = sceneOf(doc(`${DEFS}<g id="l1" fub:layer="Ombra" filter="url(#f1)"><rect id="a" width="1" height="1"/><use href="#a"/></g>`));
    expect(kinds(framed)).toEqual(["live", "image"]);
    expect(image(framed, 1).body).toContain('<filter id="f1"');
    let body = `${DEFS}${LAYER}`;
    for (let i = 0; i < MAX_IMAGE_LAYERS + 2; i++) body += `<rect id="r${i}" width="1" height="1" fill="url(#g1) #000000"/><use href="#x"/>`;
    const merged = sceneOf(doc(`${body}</g>`)).layers.filter((layer): layer is ImageLayer => layer.kind === "image" && layer.body.includes('<rect id="r'));
    expect(merged.length).toBeGreaterThan(0);
    for (const layer of merged) expect(layer.body.slice(0, layer.body.indexOf("</defs>"))).toContain('<linearGradient id="g1"');
  });
});

/// Due simboli, uno dentro l'altro, e una sfumatura che il contenuto usa.
const SYMBOLS = '<defs id="fub-defs">'
  + '<linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0072b2"/></linearGradient>'
  + '<symbol id="r1" overflow="visible"><title>Presa</title><circle id="o1" r="20" fill="url(#g1) #0072b2"/>'
  + '<g id="o2" transform="rotate(45)"><line id="o3" x1="-8" y1="0" x2="8" y2="0" stroke="#000000"/></g></symbol>'
  + '<symbol id="r2" overflow="visible"><rect id="o4" width="60" height="40" fill="#ffffff"/>'
  + '<use id="o5" transform="translate(30 20)" href="#r1"/></symbol>'
  + '<symbol id="r3" overflow="visible"><rect id="o6" width="1" height="1"/></symbol>'
  + '</defs>';

describe("i simboli", () => {
  it("stanno nella scena col loro contenuto vivo, e non sono strati; un'istanza è un use", () => {
    const scene = sceneOf(doc(`${SYMBOLS}${LAYER}<use id="i1" transform="translate(10 20)" href="#r2"/><rect id="a" width="1" height="1"/></g>`));
    expect(kinds(scene)).toEqual(["live"]);
    const [layer] = live(scene, 0).nodes as [PaintGroup];
    const [instance, rect] = layer.children as [PaintShape, PaintShape];
    expect(instance).toMatchObject({ kind: "shape", tag: "use", role: "instance", id: "i1", symbol: "r2" });
    expect(instance.attrs).toEqual([["transform", "translate(10 20)"]]);
    expect(rect.id).toBe("a");
    expect(scene.symbols.map((symbol) => [symbol.role, symbol.id])).toEqual([["symbol", "r1"], ["symbol", "r2"], ["symbol", "r3"]]);
    const [r1, r2] = scene.symbols as [PaintGroup, PaintGroup];
    expect(r1.attrs).toEqual([]);
    expect(r1.children.map((child) => [child.kind, child.id])).toEqual([["shape", "o1"], ["group", "o2"]]);
    expect(((r1.children[1] as PaintGroup).children[0] as PaintShape).tag).toBe("line");
    expect(r2.children[1]).toMatchObject({ tag: "use", symbol: "r1" });
    expect(ids(scene.resources)).toEqual(["g1"]);
  });

  it("restano gli stessi oggetti finché non cambiano, anche in un motore riaperto", () => {
    const source = doc(`${SYMBOLS}${LAYER}<use id="i1" href="#r1"/><use id="i2" transform="translate(50 0)" href="#r1"/></g>`);
    const engine = SceneEngine.open(source);
    const builder = new PaintBuilder();
    const first = builder.build(engine);
    expect(builder.build(engine).symbols).toBe(first.symbols);
    expect(sceneOf(source, builder).symbols).toEqual(first.symbols);
    const content = (scene: PaintScene): unknown[] => scene.symbols.flatMap((symbol) => symbol.children.filter((child) => child.kind === "shape"));
    for (const [i, shape] of content(sceneOf(source, builder)).entries()) expect(shape).toBe(content(first)[i]);

    // Cambiare il contenuto rifà il simbolo, e le istanze restano le stesse.
    const opened = SceneEngine.open(source);
    const again = new PaintBuilder();
    const before = again.build(opened);
    expect(opened.apply({ op: "set", id: "o1", attrs: { fill: "#ff0000" } }).outcome).toBe("applied");
    const after = again.build(opened);
    expect(after.symbols[0]).not.toBe(before.symbols[0]);
    expect(after.symbols[0]!.key).toBe(before.symbols[0]!.key);
    expect(after.symbols[1]).toBe(before.symbols[1]);
    expect(after.layers[0]).toBe(before.layers[0]);
  });

  it("non contano fra gli elementi vivi quando gli strati immagine si uniscono", () => {
    const foreign = '<foreignObject width="1" height="1"/>';
    let body = SYMBOLS + LAYER;
    for (let i = 0; i <= MAX_IMAGE_LAYERS; i++) body += `${foreign}<rect id="v${i}" width="1" height="1"/>`;
    const scene = sceneOf(doc(`${body}</g>`));
    expect(scene.layers.filter((layer) => layer.kind === "image")).toHaveLength(MAX_IMAGE_LAYERS);
    expect(scene.symbols).toHaveLength(3);
  });

  it("con qualcosa di estraneo che si vede non si dipingono vivi: le istanze stanno negli strati immagine", () => {
    const defs = '<defs id="fub-defs">'
      + '<symbol id="r1" overflow="visible"><circle id="o1" r="5"/><foreignObject width="4" height="4"/></symbol>'
      + '<symbol id="r2" overflow="visible"><use id="o2" href="#r1"/></symbol>'
      + '<symbol id="r3" overflow="visible"><rect id="o3" width="1" height="1"/></symbol>'
      + '</defs>';
    const scene = sceneOf(doc(`${defs}${LAYER}<rect id="a" width="1" height="1"/><use id="i1" href="#r2"/><use id="i2" href="#r3"/></g>`));
    expect(kinds(scene)).toEqual(["live", "image", "live"]);
    expect(ids(scene.symbols.map((symbol) => ({ id: symbol.id! })))).toEqual(["r3"]);
    // L'istanza porta nei defs il suo simbolo intero, e quello che lui usa.
    const body = image(scene, 1).body;
    expect(body).toContain('<use id="i1" href="#r2"/>');
    expect(body).toContain('<symbol id="r2" overflow="visible"><use id="o2" href="#r1"/></symbol>');
    expect(body).toContain('<foreignObject width="4" height="4"/>');
    expect((live(scene, 2).nodes[0] as PaintGroup).children[0]).toMatchObject({ tag: "use", symbol: "r3" });
  });

  it("si trovano dalle istanze, a cascata, con le risorse del loro contenuto", () => {
    const scene = sceneOf(doc(`${SYMBOLS}${LAYER}<use id="i1" href="#r2"/><use id="i2" href="#r1"/></g>`));
    const [i1, i2] = (live(scene, 0).nodes[0] as PaintGroup).children as [PaintShape, PaintShape];
    expect(symbolsFor([i1], scene.symbols).map((symbol) => symbol.id)).toEqual(["r1", "r2"]);
    expect(symbolsFor([i2], scene.symbols).map((symbol) => symbol.id)).toEqual(["r1"]);
    expect(symbolsFor([], scene.symbols)).toEqual([]);
    const used = symbolsFor([i1], scene.symbols);
    expect(ids(resourcesFor([i1, ...used], [], scene.resources))).toEqual(["g1"]);
  });
});

describe("un documento intero come immagine", () => {
  it("tiene il prologo tranne la dichiarazione XML e ricostruisce la radice", () => {
    const text = '﻿<?xml version="1.0" encoding="ISO-8859-1"?>\n<!DOCTYPE svg [<!ENTITY e "x">]>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="5"><text>&e;</text></svg>';
    const layer = wholeDocumentLayer(text)!;
    expect(layer.prolog).toBe('\n<!DOCTYPE svg [<!ENTITY e "x">]>\n');
    expect(layer.body).toBe("<text>&e;</text></svg>");
    expect(layer.transparent).toBe(false);
    expect(layer.root.attrs).toBe(' xmlns="http://www.w3.org/2000/svg"');
    expect(wholeDocumentLayer(text)).toBe(layer);
  });

  it("chiude una radice autochiusa e rifiuta ciò che non è un SVG", () => {
    expect(wholeDocumentLayer('<svg xmlns="http://www.w3.org/2000/svg"/>')?.body).toBe("</svg>");
    expect(wholeDocumentLayer("<html/>")).toBeNull();
    expect(wholeDocumentLayer("<svg><g></svg>")).toBeNull();
  });
});
