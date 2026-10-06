// La scena di un painter (`paint.ts`): quali strati, con che cosa dentro, e
// che cosa resta lo stesso oggetto fra una modifica e l'altra.

import { describe, expect, it } from "vitest";
import { SceneEngine } from "../scene/engine";
import { doc, HEAD } from "../scene/test-support";
import { SourceText } from "../scene/text";
import { NS_SVG, parseXml } from "../scene/xml";
import {
  IMAGE_PLACEHOLDER,
  imageDocument,
  MAX_IMAGE_LAYERS,
  PaintBuilder,
  wholeDocumentLayer,
  type ImageLayer,
  type LiveLayer,
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
