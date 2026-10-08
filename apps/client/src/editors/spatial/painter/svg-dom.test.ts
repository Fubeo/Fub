// @vitest-environment happy-dom
// Il painter SVG DOM: che cosa entra nel documento della shell e che cosa
// no, che cosa resta lo stesso nodo fra due scene, e che ogni risorsa che
// apre si chiude quando la sua vita finisce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type ContainerNode, type ElementPart } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { doc, HEAD } from "../scene/test-support";
import { IMAGE_PLACEHOLDER, PaintBuilder, resourcesFor, wholeDocumentLayer, type PaintScene, type PaintShape } from "./paint";
import { createSvgPainter, liveId, miniaturePicture, paintMiniature, shapeCount, type ScenePainter } from "./svg-dom";
import { createOverlay } from "./overlay";

const LAYER = '<g id="l1" fub:layer="Livello 1">';

/// Un disegno con tutto ciò che non deve entrare vivo: uno script, un
/// `foreignObject` con HTML, un gestore d'evento, un `use`, un collegamento.
const HOSTILE = doc(
  `<title>Ostile</title><desc>d</desc>${LAYER}`
    + '<rect id="a" x="1" y="1" width="10" height="10" fill="#ff0000"/>'
    + '<script>parent.rubato = true</script>'
    + '<foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml" onclick="x()">html</div></foreignObject>'
    + '<rect width="5" height="5" onload="x()"/><use href="#a" x="20"/>'
    + '<a href="Note/altra.md"><circle id="c" cx="5" cy="5" r="2"/></a>'
    + '<rect id="b" x="30" y="1" width="10" height="10"/></g>',
);

let urls = 0;
const blobs = new Map<string, Blob>();
const live = new Set<string>();
let host: HTMLElement;
let owner: Lifetime;

beforeEach(() => {
  urls = 0;
  blobs.clear();
  live.clear();
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:scena-${++urls}`;
    blobs.set(url, blob as Blob);
    live.add(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    live.delete(url);
  });
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => Promise.resolve());
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: 600 });
  document.body.append(host);
  owner = openLifetime();
});

afterEach(() => {
  owner.close();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function sceneOf(engine: SceneEngine, builder: PaintBuilder): PaintScene {
  return builder.build(engine);
}

/// Aspetta le decodifiche già partite.
async function decoded(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

describe("il documento vivo", () => {
  it("dà a uno strato immagine i caratteri dell'app che nomina, appena arrivano", async () => {
    const SHEET = '@font-face{font-family:"Inter";src:url(data:font/woff2;base64,SQ==)}';
    let ready = false;
    let arrive = (): void => {};
    const fonts = {
      now: vi.fn((svg: string) => (!svg.includes("Inter") ? "" : ready ? SHEET : null)),
      load: vi.fn(() => new Promise<string>((resolve) => {
        arrive = () => {
          ready = true;
          resolve(SHEET);
        };
      })),
    };
    const painter = createSvgPainter(host, owner, { fonts });
    const source = HOSTILE.replace('<script>', '<text font-family="Inter" x="1" y="20">Ciao</text><script>');
    painter.update(sceneOf(SceneEngine.open(source), new PaintBuilder()));
    await decoded();
    const shown = async (): Promise<string> => blobs.get(host.querySelector("img")!.getAttribute("src")!)!.text();
    // Subito coi caratteri del sistema, invece di aspettare.
    expect(await shown()).not.toContain("@font-face");
    expect(fonts.load).toHaveBeenCalledTimes(1);
    arrive();
    await decoded();
    await decoded();
    const text = await shown();
    expect(text).toContain(`<style>${SHEET}</style>`);
    expect(text.indexOf("<style>")).toBeLessThan(text.indexOf("Ciao"));
    // La prima immagine se n'è andata.
    expect(live.size).toBe(1);
    // Già letti, i caratteri entrano dal primo disegno.
    painter.update(sceneOf(SceneEngine.open(source.replace("Ciao", "Ciao!")), new PaintBuilder()));
    await decoded();
    expect(await shown()).toContain(`<style>${SHEET}</style>`);
    expect(fonts.load).toHaveBeenCalledTimes(1);
  });

  it("non chiede caratteri per uno strato che non ne nomina", async () => {
    const fonts = { now: vi.fn(() => ""), load: vi.fn(async () => "") };
    const painter = createSvgPainter(host, owner, { fonts });
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    await decoded();
    expect(fonts.load).not.toHaveBeenCalled();
    expect(await blobs.get(host.querySelector("img")!.getAttribute("src")!)!.text()).not.toContain("<style>");
  });

  it("non riceve niente di estraneo, nessun id e nessun collegamento", async () => {
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    await decoded();
    const root = host.querySelector(".spatial-painter")!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    for (const selector of ["script", "foreignObject", "div", "use", "a", "title", "desc", "[id]", "[onload]", "[onclick]"]) {
      expect(root.querySelectorAll(selector), selector).toHaveLength(0);
    }
    expect([...root.querySelectorAll("[data-scene-id]")].map((el) => el.getAttribute("data-scene-id")))
      .toEqual(["l1", "a", "l1", "c", "b"]);
    // L'estraneo è un'immagine da blob, fra i due strati vivi.
    expect([...root.children].map((el) => el.tagName.toLowerCase())).toEqual(["svg", "img", "svg"]);
    const img = root.querySelector("img")!;
    expect(img.className).toBe("spatial-image");
    expect(img.getAttribute("alt")).toBe("");
    const text = await blobs.get(img.getAttribute("src")!)!.text();
    expect(blobs.get(img.getAttribute("src")!)!.type).toBe("image/svg+xml");
    expect(text).toContain("<script>parent.rubato = true</script>");
    expect(text).toContain('viewBox="-100 -75 1000 750"');
  });

  it("porta la camera su ogni strato vivo e segue con l'immagine", async () => {
    vi.useFakeTimers();
    const painter = createSvgPainter(host, owner, { settleMs: 100 });
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    await decoded();
    painter.setView({ scale: 2, angle: 0, tx: 10, ty: -20 });
    for (const g of host.querySelectorAll(".spatial-layer > g")) expect(g.getAttribute("transform")).toBe("matrix(2 0 0 2 10 -20)");
    const img = host.querySelector("img")!;
    // Disegnata per la scala 1 con il margine a (-100, -75): ora è al doppio.
    expect(img.style.transform).toBe("matrix(2, 0, 0, 2, -190, -170)");
    expect(urls).toBe(1);
    vi.advanceTimersByTime(100);
    expect(urls).toBe(2);
    await decoded();
    const next = host.querySelector("img")!;
    expect(next).not.toBe(img);
    expect(next.style.transform).toBe("translate(-100px, -75px)");
    expect(live).toEqual(new Set(["blob:scena-2"]));
    // Una panoramica piccola alla stessa scala non ridisegna.
    painter.setView({ scale: 2, angle: 0, tx: 30, ty: -20 });
    painter.settle();
    expect(urls).toBe(2);
    expect(next.style.transform).toBe("translate(-80px, -75px)");
  });

  it("gira la camera, e ridisegna l'immagine già girata sui pixel dello schermo", async () => {
    vi.useFakeTimers();
    const painter = createSvgPainter(host, owner, { settleMs: 100 });
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    await decoded();
    painter.setView({ scale: 2, angle: 90, tx: 10, ty: -20 });
    for (const g of host.querySelectorAll(".spatial-layer > g")) expect(g.getAttribute("transform")).toBe("matrix(0 2 -2 0 10 -20)");
    // Mentre la vista gira, l'immagine diritta gira con lei.
    const img = host.querySelector("img")!;
    expect(img.style.transform).toBe("matrix(0, 2, -2, 0, 160, -220)");
    vi.advanceTimersByTime(100);
    expect(urls).toBe(2);
    await decoded();
    const next = host.querySelector("img")!;
    expect(next).not.toBe(img);
    // Grande quanto prima, dritta sullo schermo: è il disegno a entrarci
    // girato, dall'angolo in alto a sinistra (-27.5, 55) della scena.
    expect(next.style.transform).toBe("translate(-100px, -75px)");
    const text = await blobs.get(next.getAttribute("src")!)!.text();
    expect(text).toContain('width="1000" height="750" viewBox="0 0 500 375"');
    expect(text).toContain('<g transform="rotate(90) translate(27.5 -55)">');
    // Allo stesso angolo una panoramica sposta e basta.
    painter.setView({ scale: 2, angle: 90, tx: 30, ty: -20 });
    painter.settle();
    expect(urls).toBe(2);
    expect(next.style.transform).toBe("translate(-80px, -75px)");
    // Tornata diritta, ridisegna diritta.
    painter.setView({ scale: 2, angle: 0, tx: 30, ty: -20 });
    painter.settle();
    expect(urls).toBe(3);
  });

  it("scrive i pezzi di una riga come tspan dentro la riga", async () => {
    const painter = createSvgPainter(host, owner);
    const source = doc(
      `${LAYER}<text id="t" x="10" y="20"><tspan x="10" dy="0">a <tspan font-weight="bold" fill="#0072b2" xml:space="preserve">b  c</tspan>!</tspan></text></g>`,
    );
    painter.update(sceneOf(SceneEngine.open(source), new PaintBuilder()));
    await decoded();
    const line = host.querySelector('[data-scene-id="t"] > tspan')!;
    expect(line.getAttribute("dy")).toBe("0");
    expect(line.textContent).toBe("a b  c!");
    expect([...line.childNodes].map((node) => node.nodeName.toLowerCase())).toEqual(["#text", "tspan", "#text"]);
    const piece = line.querySelector("tspan")!;
    expect(piece.getAttribute("font-weight")).toBe("bold");
    expect(piece.getAttribute("fill")).toBe("#0072b2");
    expect(piece.getAttributeNS("http://www.w3.org/XML/1998/namespace", "space")).toBe("preserve");
    expect(piece.textContent).toBe("b  c");
  });

  it("riusa i nodi di ciò che non cambia", async () => {
    const engine = SceneEngine.open(HOSTILE);
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const before = new Map([...host.querySelectorAll("[data-scene-id]")].map((el) => [el.getAttribute("data-scene-id")! + el.tagName, el]));
    const img = host.querySelector("img");
    expect(engine.apply({ op: "set", id: "b", attrs: { fill: "#00ff00" } }).outcome).toBe("applied");
    painter.update(sceneOf(engine, builder));
    await decoded();
    const after = new Map([...host.querySelectorAll("[data-scene-id]")].map((el) => [el.getAttribute("data-scene-id")! + el.tagName, el]));
    expect(after.get("arect")).toBe(before.get("arect"));
    expect(after.get("ccircle")).toBe(before.get("ccircle"));
    expect(after.get("brect")).not.toBe(before.get("brect"));
    expect(after.get("brect")!.getAttribute("fill")).toBe("#00ff00");
    expect(host.querySelector("img")).toBe(img);
    expect(urls).toBe(1);
  });

  it("chiede le immagini del vault e mostra il segnaposto per quelle che non ci sono", async () => {
    const asked: string[] = [];
    const lives: Lifetime[] = [];
    const engine = SceneEngine.open(doc(
      `${LAYER}<image id="i1" href="foto.png" width="4" height="4"/><image id="i2" href="manca.png" width="4" height="4"/>`
        + '<image id="i3" href="https://esempio.it/x.png" width="4" height="4"/></g>',
    ));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner, {
      images: async (path, life) => {
        asked.push(path);
        lives.push(life);
        return path === "foto.png" ? "fub-asset://lease/1" : null;
      },
    });
    painter.update(sceneOf(engine, builder));
    await decoded();
    const href = (id: string): string | null => host.querySelector(`[data-scene-id="${id}"]`)!.getAttribute("href");
    expect(asked).toEqual(["foto.png", "manca.png"]);
    expect(href("i1")).toBe("fub-asset://lease/1");
    expect(href("i2")).toBe(IMAGE_PLACEHOLDER);
    expect(href("i3")).toBe(IMAGE_PLACEHOLDER);
    expect(engine.apply({ op: "remove", target: "i1" }).outcome).toBe("applied");
    painter.update(sceneOf(engine, builder));
    expect(lives[0]!.closed).toBe(true);
    expect(lives[1]!.closed).toBe(false);
    painter.dispose();
    expect(lives[1]!.closed).toBe(true);
  });
});

describe("le miniature", () => {
  const PICTURE = doc(
    '<g id="l1" fub:layer="Nascosto" fill="#00ff00" transform="translate(10 0)" display="none">'
      + '<g id="g" opacity="0.5" display="none"><rect id="r" x="0" y="0" width="50" height="10"/>'
      + '<rect id="h" x="30" y="0" width="5" height="5" display="none"/></g>'
      + '<image id="i" href="foto.png" width="4" height="4"/></g>',
  );

  function opened(): { readonly engine: SceneEngine; readonly builder: PaintBuilder; readonly scene: PaintScene; readonly node: (id: string) => ElementPart } {
    const engine = SceneEngine.open(PICTURE);
    const builder = new PaintBuilder();
    const scene = builder.build(engine);
    return { engine, builder, scene, node: (id) => engine.holder(id)! };
  }

  it("disegnano ciò che l'oggetto dipinge, dentro gli stili di chi lo contiene, visibile anche se è nascosto", () => {
    const { builder, scene, node } = opened();
    const chain = [scene.root.attrs, builder.headInfo(node("l1") as ContainerNode).attrs];
    const svg = paintMiniature(builder.paintsOf(node("g")), chain, { x: 10, y: 0, width: 50, height: 10 }, owner);
    // Inquadrata sul riquadro, con un margine.
    svg.getAttribute("viewBox")!.split(" ").map(Number).forEach((value, at) => expect(value).toBeCloseTo([7, -3, 56, 16][at]!, 9));
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(svg.getAttribute("focusable")).toBe("false");
    const layer = svg.firstElementChild!.firstElementChild!;
    expect([layer.getAttribute("fill"), layer.getAttribute("transform"), layer.hasAttribute("display")]).toEqual(["#00ff00", "translate(10 0)", false]);
    const group = layer.firstElementChild!;
    expect([group.getAttribute("opacity"), group.hasAttribute("display")]).toEqual(["0.5", false]);
    // Ciò che è nascosto dentro resta nascosto.
    expect([...group.children].map((child) => [child.tagName.toLowerCase(), child.getAttribute("display")])).toEqual([["rect", null], ["rect", "none"]]);
    expect(svg.querySelectorAll("[data-scene-id]")).toHaveLength(0);
  });

  it("chiedono le immagini del vault nella vita della miniatura, o mostrano il segnaposto", async () => {
    const { builder, scene, node } = opened();
    const lives: Lifetime[] = [];
    const life = openLifetime();
    const box = { x: 10, y: 0, width: 4, height: 4 };
    const svg = paintMiniature(builder.paintsOf(node("i")), [scene.root.attrs], box, life, async (_path, imageLife) => {
      lives.push(imageLife);
      return "fub-asset://lease/1";
    });
    await decoded();
    expect(svg.querySelector("image")!.getAttribute("href")).toBe("fub-asset://lease/1");
    life.close();
    expect(lives.every((each) => each.closed)).toBe(true);
    const still = paintMiniature(builder.paintsOf(node("i")), [scene.root.attrs], box, owner);
    expect(still.querySelector("image")!.getAttribute("href")).toBe(IMAGE_PLACEHOLDER);
  });

  it("contano le forme fino a un limite, e diventano un'immagine ferma che si revoca con la vita", async () => {
    const { builder, scene, node } = opened();
    const paints = builder.paintsOf(node("l1"));
    expect(shapeCount(paints, 10)).toBe(3);
    expect(shapeCount(paints, 1)).toBe(2);
    const life = openLifetime();
    const img = miniaturePicture(paintMiniature(paints, [scene.root.attrs], { x: 0, y: 0, width: 60, height: 10 }, life), life);
    expect(img.getAttribute("alt")).toBe("");
    const url = img.getAttribute("src")!;
    expect(blobs.get(url)!.type).toBe("image/svg+xml");
    expect(await blobs.get(url)!.text()).toContain('<rect x="0" y="0" width="50" height="10"');
    expect(live.has(url)).toBe(true);
    life.close();
    expect(live.has(url)).toBe(false);
  });
});

describe("l'anteprima degli strumenti", () => {
  it("cambia il transform, sbiadisce e nasconde senza ricreare i nodi, e sopravvive a una scena nuova", async () => {
    const engine = SceneEngine.open(doc(
      `${LAYER}<rect id="a" width="4" height="4" transform="matrix(2 0 0 2 0 0)"/><rect id="b" width="4" height="4"/>`
        + '<g id="g"><rect id="c" width="1" height="1"/></g></g>',
    ));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const node = (id: string): SVGElement => host.querySelector(`[data-scene-id="${id}"]`)!;
    const a = node("a");
    const [paintA] = builder.paintsOf(engine.holder("a")!);
    const [paintB] = builder.paintsOf(engine.holder("b")!);
    const groups = builder.paintsOf(engine.holder("g")!);
    expect(groups).toHaveLength(1);
    painter.setDraft({
      transforms: new Map([[paintA!, "matrix(2 0 0 2 5 0)"], [paintB!, "matrix(1 0 0 1 0 3)"], [groups[0]!, "matrix(1 0 0 1 9 9)"]]),
      faded: new Set([paintB!]),
    });
    expect(node("a")).toBe(a);
    expect(a.getAttribute("transform")).toBe("matrix(2 0 0 2 5 0)");
    expect(node("b").getAttribute("transform")).toBe("matrix(1 0 0 1 0 3)");
    expect(node("b").style.opacity).toBe("0.25");
    expect(node("g").getAttribute("transform")).toBe("matrix(1 0 0 1 9 9)");
    // Una scena nuova che cambia un altro nodo: l'anteprima resta, anche sul
    // gruppo che la scena nuova ridisegna.
    expect(engine.apply({ op: "set", id: "c", attrs: { fill: "#00ff00" } }).outcome).toBe("applied");
    painter.update(sceneOf(engine, builder));
    expect(a.getAttribute("transform")).toBe("matrix(2 0 0 2 5 0)");
    expect(node("b").style.opacity).toBe("0.25");
    expect(node("g").getAttribute("transform")).toBe("matrix(1 0 0 1 9 9)");
    // Tolta, ogni nodo torna a ciò che la scena dipinge.
    painter.setDraft(null);
    expect(a.getAttribute("transform")).toBe("matrix(2 0 0 2 0 0)");
    expect(node("b").hasAttribute("transform")).toBe(false);
    expect(node("b").style.opacity).toBe("");
    expect(node("g").hasAttribute("transform")).toBe(false);
    expect(node("a")).toBe(a);
    // Un testo scritto sul posto si nasconde, e torna com'era.
    painter.setDraft({ hidden: new Set([paintA!]) });
    expect(a.style.visibility).toBe("hidden");
    expect(node("b").style.visibility).toBe("");
    painter.setDraft(null);
    expect(a.style.visibility).toBe("");
  });

  it("attenua ciò che sta fuori dal gruppo isolato, carta esclusa, anche dopo una scena nuova", async () => {
    const engine = SceneEngine.open(doc(
      '<rect id="fub-paper" fub:role="paper" x="0" y="0" width="100" height="100" fill="#ffffff"/>'
        + `${LAYER}<rect id="a" width="4" height="4" opacity="0.5"/>`
        + '<g id="g"><rect id="b" width="1" height="1"/><g id="inner"><rect id="c" width="1" height="1"/></g></g>'
        + '<rect id="d" width="2" height="2"/></g><rect id="loose" width="3" height="3"/><use href="#a"/>',
    ));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const node = (id: string): SVGElement => host.querySelector(`[data-scene-id="${id}"]`)!;
    const chain = ["l1", "g"].map((id) => engine.holder(id)!);
    painter.setFocus(chain);
    expect(node("fub-paper").style.opacity).toBe("");
    expect(node("a").style.opacity).toBe("0.2");
    expect(node("d").style.opacity).toBe("0.4");
    expect(node("loose").style.opacity).toBe("0.4");
    expect(host.querySelector<HTMLElement>("img")!.style.opacity).toBe("0.4");
    // Dentro il gruppo isolato niente si attenua, nemmeno più dentro.
    for (const id of ["l1", "g", "b", "inner", "c"]) expect(node(id).style.opacity, id).toBe("");
    // La gomma sbiadisce dentro, e tolta l'anteprima l'attenuazione resta.
    const [paintB] = builder.paintsOf(engine.holder("b")!);
    const [paintA] = builder.paintsOf(engine.holder("a")!);
    painter.setDraft({ faded: new Set([paintB!, paintA!]) });
    expect(node("b").style.opacity).toBe("0.25");
    painter.setDraft(null);
    expect(node("b").style.opacity).toBe("");
    expect(node("a").style.opacity).toBe("0.2");
    // Una scena nuova: i nodi nuovi si attenuano come i vecchi.
    expect(engine.apply({ op: "add", parent: "l1", pos: { last: true }, elem: { tag: "rect", attrs: { id: "o1a2b3c4d", width: "1", height: "1" } } }).outcome).toBe("applied");
    painter.update(sceneOf(engine, builder));
    expect(node("o1a2b3c4d").style.opacity).toBe("0.4");
    expect(node("c").style.opacity).toBe("");
    // Isolato il gruppo più dentro, si attenuano anche i fratelli di prima.
    painter.setFocus([...chain, engine.holder("inner")!]);
    expect(node("b").style.opacity).toBe("0.4");
    expect(node("c").style.opacity).toBe("");
    painter.setFocus(null);
    for (const id of ["a", "b", "d", "o1a2b3c4d", "loose"]) expect(node(id).style.opacity, id).toBe("");
    expect(host.querySelector<HTMLElement>("img")!.style.opacity).toBe("");
    painter.dispose();
  });

  describe("uno strato immagine dentro un gruppo", () => {
    const CARRIED = doc(`${LAYER}<g id="w"><rect id="a" width="4" height="4"/><use href="#a" x="10"/></g><use href="#a" x="50"/></g>`);
    const images = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>("img")];

    it("segue il gruppo che si sposta, anche quando la camera si muove", async () => {
      vi.useFakeTimers();
      const engine = SceneEngine.open(CARRIED);
      const painter = createSvgPainter(host, owner, { settleMs: 100 });
      painter.update(sceneOf(engine, new PaintBuilder()));
      await decoded();
      const [inside, outside] = images();
      painter.setDraft({ carried: new Map([[engine.holder("w")!, [1, 0, 0, 1, 10, 5]]]) });
      // Disegnata col margine a (-100, -75): il gruppo la porta di (10, 5).
      expect(inside!.style.transform).toBe("matrix(1, 0, 0, 1, -90, -70)");
      expect(outside!.style.transform).toBe("translate(-100px, -75px)");
      painter.setView({ scale: 2, angle: 0, tx: 10, ty: -20 });
      expect(inside!.style.transform).toBe("matrix(2, 0, 0, 2, -170, -160)");
      // Ridisegnata alla scala nuova, la segue ancora.
      vi.advanceTimersByTime(100);
      await decoded();
      const [redrawn] = images();
      expect(redrawn).not.toBe(inside);
      expect(redrawn!.style.transform).toBe("matrix(1, 0, 0, 1, -80, -65)");
      painter.dispose();
    });

    it("torna al suo posto se l'anteprima se ne va senza una scena nuova", async () => {
      const engine = SceneEngine.open(CARRIED);
      const painter = createSvgPainter(host, owner);
      painter.update(sceneOf(engine, new PaintBuilder()));
      await decoded();
      const [inside] = images();
      painter.setDraft({ carried: new Map([[engine.holder("w")!, [1, 0, 0, 1, 10, 5]]]) });
      painter.setDraft(null);
      // Finché l'operazione può ancora arrivare, resta dov'è.
      expect(inside!.style.transform).toBe("matrix(1, 0, 0, 1, -90, -70)");
      await Promise.resolve();
      expect(inside!.style.transform).toBe("translate(-100px, -75px)");
      painter.dispose();
    });

    it("dopo l'operazione resta dove l'ha portata finché l'immagine nuova non è pronta", async () => {
      const engine = SceneEngine.open(CARRIED);
      const builder = new PaintBuilder();
      const painter = createSvgPainter(host, owner);
      painter.update(sceneOf(engine, builder));
      await decoded();
      const [inside, outside] = images();
      painter.setDraft({ carried: new Map([[engine.holder("w")!, [1, 0, 0, 1, 10, 5]]]) });
      painter.setDraft(null);
      let ready = (): void => {};
      vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => new Promise<void>((resolve) => (ready = resolve)));
      expect(engine.apply({ op: "set", id: "w", attrs: { transform: "matrix(1 0 0 1 10 5)" } }).outcome).toBe("applied");
      painter.update(sceneOf(engine, builder));
      await decoded();
      expect(images()[0]).toBe(inside);
      expect(inside!.style.transform).toBe("matrix(1, 0, 0, 1, -90, -70)");
      ready();
      await decoded();
      const [moved, same] = images();
      expect(moved).not.toBe(inside);
      expect(moved!.style.transform).toBe("translate(-100px, -75px)");
      // Lo strato fuori dal gruppo non è cambiato.
      expect(same).toBe(outside);
      expect(live.has(inside!.getAttribute("src")!)).toBe(false);
      painter.dispose();
    });

    it("non si attenua se sta nel gruppo isolato, e sbiadisce con lui", async () => {
      const engine = SceneEngine.open(CARRIED);
      const painter = createSvgPainter(host, owner);
      painter.update(sceneOf(engine, new PaintBuilder()));
      await decoded();
      const [inside, outside] = images();
      const group = engine.holder("w")!;
      painter.setFocus([engine.holder("l1")!, group]);
      expect(inside!.style.opacity).toBe("");
      expect(outside!.style.opacity).toBe("0.4");
      painter.setDraft({ fadedContainers: new Set([group]) });
      expect(inside!.style.opacity).toBe("0.25");
      expect(outside!.style.opacity).toBe("0.4");
      painter.setDraft(null);
      expect(inside!.style.opacity).toBe("");
      expect(outside!.style.opacity).toBe("0.4");
      painter.dispose();
    });
  });

  it("mostra un altro `d` per un tracciato, e lo riporta a quello dipinto", async () => {
    const engine = SceneEngine.open(doc(`${LAYER}<path id="p" d="M0 0 L4 0" stroke="#000000"/><rect id="r" width="4" height="4"/></g>`));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const path = host.querySelector(`[data-scene-id="p"]`)!;
    const [paint] = builder.paintsOf(engine.holder("p")!);
    const [rect] = builder.paintsOf(engine.holder("r")!);
    painter.setDraft({ paths: new Map([[paint!, "M0 0 C1 2 3 2 4 0"]]), transforms: new Map([[rect!, "matrix(1 0 0 1 2 0)"]]) });
    expect(host.querySelector(`[data-scene-id="p"]`)).toBe(path);
    expect(path.getAttribute("d")).toBe("M0 0 C1 2 3 2 4 0");
    painter.setDraft(null);
    expect(path.getAttribute("d")).toBe("M0 0 L4 0");
    expect(host.querySelector(`[data-scene-id="r"]`)!.hasAttribute("d")).toBe(false);
    painter.dispose();
  });

  it("mostra un altro `d` per una forma con un tracciato al suo posto, e lo toglie", async () => {
    const engine = SceneEngine.open(doc(`${LAYER}<rect id="r" x="1" y="2" width="4" height="4" fill="#ff0000" transform="rotate(10)"/><circle id="c" r="2"/></g>`));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const rect = host.querySelector(`[data-scene-id="r"]`) as SVGElement;
    const [paint] = builder.paintsOf(engine.holder("r")!);
    painter.setDraft({ paths: new Map([[paint!, "M1 2 L9 2 L5 6 Z"]]) });
    const stand = rect.nextElementSibling!;
    expect(stand.localName).toBe("path");
    expect([stand.getAttribute("d"), stand.getAttribute("fill"), stand.getAttribute("transform")]).toEqual(["M1 2 L9 2 L5 6 Z", "#ff0000", "rotate(10)"]);
    expect(["x", "width", "data-scene-id"].some((name) => stand.hasAttribute(name))).toBe(false);
    expect(rect.style.visibility).toBe("hidden");
    expect(rect.hasAttribute("d")).toBe(false);
    painter.setDraft(null);
    expect(rect.nextElementSibling?.localName).toBe("circle");
    expect(rect.style.visibility).toBe("");
    painter.dispose();
  });

  it("mostra un altro elemento al posto di un testo, con le sue righe e la sua trasformazione, e lo toglie", async () => {
    const engine = SceneEngine.open(doc(`${LAYER}<text id="t" fub:wrap="60" x="1" y="9" transform="rotate(10)"><tspan x="1" dy="0">Uno due</tspan></text><circle id="c" r="2"/></g>`));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const text = host.querySelector(`[data-scene-id="t"]`) as SVGElement;
    const [paint] = builder.paintsOf(engine.holder("t")!);
    const lines: Elem[] = [
      { tag: "tspan", attrs: { x: "1", dy: "0" }, text: "Uno" },
      { tag: "tspan", attrs: { "fub:join": "space", x: "1", dy: "10" }, runs: [{ text: "due", attrs: { "font-weight": "bold" } }] },
    ];
    painter.setDraft({ replaced: new Map([[paint!, { tag: "text", attrs: { id: "t", "fub:wrap": "30", x: "1", y: "9" }, children: lines }]]) });
    const stand = text.nextElementSibling as SVGElement;
    expect(stand.localName).toBe("text");
    expect(stand.getAttribute("transform")).toBe("rotate(10)");
    expect(stand.innerHTML).toBe('<tspan x="1" dy="0">Uno</tspan><tspan x="1" dy="10"><tspan font-weight="bold">due</tspan></tspan>');
    expect(["id", "fub:wrap"].some((name) => stand.hasAttribute(name))).toBe(false);
    expect(text.style.visibility).toBe("hidden");
    painter.setDraft(null);
    expect(text.nextElementSibling?.localName).toBe("circle");
    expect(text.style.visibility).toBe("");
    painter.dispose();
  });

  it("mostra il tracciato di un testo con un altro d, e lo riporta", async () => {
    const engine = SceneEngine.open(
      doc(`<defs id="fub-defs"><path id="r" fub:role="private" d="M 0 50 L 200 50"/></defs>${LAYER}<text id="t" font-size="10"><textPath href="#r">Sul colle</textPath></text></g>`),
    );
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, new PaintBuilder()));
    await decoded();
    const track = host.querySelector("defs path") as SVGElement;
    const along = host.querySelector(`[data-scene-id="t"]`)!.firstElementChild!;
    expect(along.getAttribute("href")).toBe(`#${track.id}`);
    painter.setDraft({ tracks: new Map([["r", "M0 0 C50 -20 150 -20 200 0"], ["altro", "M0 0 L1 1"]]) });
    expect(track.getAttribute("d")).toBe("M0 0 C50 -20 150 -20 200 0");
    painter.setDraft(null);
    expect(track.getAttribute("d")).toBe("M 0 50 L 200 50");
    painter.dispose();
  });

  it("mostra un'altra sfumatura o un altro colore al posto di quelli dipinti, e li riporta", async () => {
    const engine = SceneEngine.open(
      doc(`${LAYER}<rect id="r" x="1" y="2" width="4" height="4" fill="#ff0000" stroke="#0000ff"/><circle id="c" r="2" fill="#00ff00"/></g>`),
    );
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const rect = host.querySelector(`[data-scene-id="r"]`) as SVGElement;
    const circle = host.querySelector(`[data-scene-id="c"]`) as SVGElement;
    const [r] = builder.paintsOf(engine.holder("r")!);
    const [c] = builder.paintsOf(engine.holder("c")!);
    const shade: Elem = {
      tag: "linearGradient",
      attrs: { id: "preview", "fub:role": "private", gradientUnits: "userSpaceOnUse", x1: "1", y1: "0", x2: "5", y2: "0", onload: "x" },
      children: [
        { tag: "stop", attrs: { offset: "0", "stop-color": "#0072b2" } },
        { tag: "stop", attrs: { offset: "1", "stop-color": "#ffffff", "stop-opacity": "0" } },
      ],
    };
    painter.setDraft({ paints: new Map([[r!, { fill: shade, stroke: "#000000" }], [c!, { fill: "#d55e00" }]]) });
    const shown = host.querySelector("svg.spatial-defs:last-child linearGradient") as SVGElement;
    // Un id dell'anteprima, i soli attributi del formato, i punti.
    expect(shown.id).toMatch(/^fubdraw\d+-draft-\d+$/);
    expect(shown.getAttribute("x2")).toBe("5");
    expect(shown.hasAttribute("onload")).toBe(false);
    expect(shown.hasAttribute("fub:role")).toBe(false);
    expect([...shown.children].map((stop) => stop.getAttribute("stop-opacity"))).toEqual([null, "0"]);
    expect(rect.style.fill.replace(/"/g, "")).toBe(`url(#${shown.id})`);
    expect(["#000000", "rgb(0, 0, 0)"]).toContain(rect.style.stroke);
    expect(["#d55e00", "rgb(213, 94, 0)"]).toContain(circle.style.fill);
    // Gli attributi dipinti restano.
    expect(rect.getAttribute("fill")).toBe("#ff0000");
    painter.setDraft(null);
    expect([rect.style.fill, rect.style.stroke, circle.style.fill]).toEqual(["", "", ""]);
    expect(host.querySelector("linearGradient")).toBeNull();
    painter.dispose();
  });

  it("dà il colore dell'anteprima anche ai pezzi di un testo che hanno il loro", async () => {
    const engine = SceneEngine.open(
      doc(`${LAYER}<text id="t" x="1" y="10" fill="#000000"><tspan x="1" dy="0">Uno <tspan fill="#0072b2">due</tspan></tspan></text></g>`),
    );
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const piece = host.querySelector(`[data-scene-id="t"] tspan[fill]`) as SVGElement;
    const [text] = builder.paintsOf(engine.holder("t")!);
    painter.setDraft({ paints: new Map([[text!, { fill: "#d55e00" }]]) });
    expect(["#d55e00", "rgb(213, 94, 0)"]).toContain(piece.style.fill);
    painter.setDraft(null);
    expect(piece.style.fill).toBe("");
    expect(piece.getAttribute("fill")).toBe("#0072b2");
    painter.dispose();
  });

  it("mostra un contorno pieno sopra una forma che resta senza contorno, e lo toglie", async () => {
    const engine = SceneEngine.open(
      doc(`${LAYER}<rect id="r" x="1" y="2" width="4" height="4" fill="#ff0000" stroke="#0000ff" stroke-width="2" opacity="0.5"/><circle id="c" r="2"/></g>`),
    );
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const rect = host.querySelector(`[data-scene-id="r"]`) as SVGElement;
    const [paint] = builder.paintsOf(engine.holder("r")!);
    painter.setDraft({ strokes: new Map([[paint!, { d: "M0 0 L9 0 L9 1 Z", fill: "#0000ff", "fill-opacity": "0.5" }]]) });
    const stand = rect.nextElementSibling as SVGElement;
    expect(stand.localName).toBe("path");
    expect([stand.getAttribute("d"), stand.getAttribute("opacity"), stand.style.fill, stand.style.fillOpacity, stand.style.stroke]).toEqual([
      "M0 0 L9 0 L9 1 Z",
      "0.5",
      "#0000ff",
      "0.5",
      "none",
    ]);
    expect(["fill", "stroke", "stroke-width", "x", "data-scene-id"].some((name) => stand.hasAttribute(name))).toBe(false);
    expect([rect.style.stroke, rect.style.visibility, rect.getAttribute("fill")]).toEqual(["none", "", "#ff0000"]);
    painter.setDraft(null);
    expect(rect.nextElementSibling?.localName).toBe("circle");
    expect(rect.style.stroke).toBe("");
    painter.dispose();
  });

  it("mostra altri raggi degli angoli per un rettangolo, e li riporta a quelli dipinti", async () => {
    const engine = SceneEngine.open(doc(`${LAYER}<rect id="r" width="40" height="20" rx="2" ry="3"/><rect id="s" width="4" height="4"/></g>`));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const rect = host.querySelector(`[data-scene-id="r"]`)!;
    const square = host.querySelector(`[data-scene-id="s"]`)!;
    const [paintR] = builder.paintsOf(engine.holder("r")!);
    const [paintS] = builder.paintsOf(engine.holder("s")!);
    // Soltanto `rx` e `ry`: un altro attributo non passa.
    const radii: Record<string, string | null>[] = [{ rx: "6", ry: null }, { rx: "1", width: "9" }];
    painter.setDraft({ radii: new Map([[paintR!, radii[0]!], [paintS!, radii[1]!]]) });
    expect(host.querySelector(`[data-scene-id="r"]`)).toBe(rect);
    expect([rect.getAttribute("rx"), rect.hasAttribute("ry")]).toEqual(["6", false]);
    expect([square.getAttribute("rx"), square.getAttribute("width")]).toEqual(["1", "4"]);
    painter.setDraft(null);
    expect([rect.getAttribute("rx"), rect.getAttribute("ry")]).toEqual(["2", "3"]);
    expect(square.hasAttribute("rx")).toBe(false);
    painter.dispose();
  });

  it("dà a due elementi identici di un motore riaperto due forme diverse", () => {
    const body = `${LAYER}<rect width="4" height="4"/><rect width="4" height="4"/></g>`;
    const builder = new PaintBuilder();
    builder.build(SceneEngine.open(doc(body)));
    const engine = SceneEngine.open(doc(body));
    builder.build(engine);
    const [layer] = elementChildren(engine.model!.root);
    const [first, second] = elementChildren(layer as ContainerNode);
    const [paintFirst] = builder.paintsOf(first!);
    const [paintSecond] = builder.paintsOf(second!);
    expect(paintFirst).toBeDefined();
    expect(paintSecond).toBeDefined();
    expect(paintFirst).not.toBe(paintSecond);
  });
});

describe("lo smontaggio", () => {
  it("revoca ogni URL e toglie tutto quando si chiude la vita di chi lo monta", async () => {
    vi.useFakeTimers();
    const painter: ScenePainter = createSvgPainter(host, owner, { settleMs: 50 });
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    painter.setView({ scale: 3, angle: 0, tx: 0, ty: 0 });
    vi.advanceTimersByTime(50);
    // Una decodifica ancora in corso quando la vita si chiude.
    expect(urls).toBe(2);
    owner.close();
    await decoded();
    expect(live.size).toBe(0);
    expect(host.children).toHaveLength(0);
    // Dopo, non apre più niente.
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    painter.setView({ scale: 1, angle: 0, tx: 0, ty: 0 });
    vi.advanceTimersByTime(1000);
    expect(urls).toBe(2);
  });

  it("revoca l'immagine che lascia la scena", async () => {
    const engine = SceneEngine.open(doc(`${LAYER}<rect id="a" width="1" height="1"/></g><use href="#a"/>`));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    expect(live).toEqual(new Set(["blob:scena-1"]));
    painter.update(sceneOf(SceneEngine.open(doc(`${LAYER}<rect id="a" width="1" height="1"/></g>`)), builder));
    expect(live.size).toBe(0);
    expect(host.querySelectorAll("img")).toHaveLength(0);
  });

  it("mostra un documento intero come un'immagine sola", async () => {
    const painter = createSvgPainter(host, owner);
    const layer = wholeDocumentLayer('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><rect width="9" height="9"/></svg>')!;
    painter.update({ root: { attrs: [], page: null, units: "px", guides: [] }, layers: [layer], resources: [] });
    await decoded();
    expect(host.querySelectorAll("rect, script")).toHaveLength(0);
    const text = await blobs.get(host.querySelector("img")!.getAttribute("src")!)!.text();
    expect(text).toContain("<script>x()</script>");
    expect(text).not.toContain("background:none");
    painter.update({ root: { attrs: [], page: null, units: "px", guides: [] }, layers: [layer], resources: [] });
    expect(urls).toBe(1);
  });
});

describe("lo strato sopra la scena", () => {
  it("si monta, raccoglie i ridisegni e se ne va con la vita", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelled: number[] = [];
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      cancelled.push(id);
    });
    const overlay = createOverlay(host, owner);
    const canvas = host.querySelector("canvas.spatial-overlay")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    overlay.setInk("penna", { outline: [[0, 0], [4, 0], [4, 4]], matrix: [1, 0, 0, 1, 0, 0], color: "#000", opacity: 1 });
    overlay.setInk("tablet", { outline: [[0, 0], [1, 1], [0, 2]], matrix: [1, 0, 0, 1, 0, 0], color: "#f00", opacity: 0.5 });
    overlay.setHandles([{ kind: "grip", x: 1, y: 1 }]);
    expect(frames).toHaveLength(1);
    overlay.flush();
    expect(cancelled).toEqual([1]);
    overlay.setInk("penna", null);
    expect(frames).toHaveLength(2);
    owner.close();
    expect(cancelled).toEqual([1, 2]);
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("disegna le guide nette sul mezzo pixel, le croci, e le misure con la scritta in mezzo, che resta nella vista", () => {
    const calls: Array<readonly [string, ...unknown[]]> = [];
    const context = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, name) => {
        if (name in target) return target[name];
        if (name === "measureText") return () => ({ width: 12 });
        return (...args: unknown[]) => void calls.push([String(name), ...args]);
      },
      set: (target, name, value) => {
        target[name] = value;
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    const overlay = createOverlay(host, owner);
    overlay.setView({ scale: 2, angle: 0, tx: 10, ty: 0 });
    overlay.setHandles([
      { kind: "guide", from: [0, 0], to: [0, 50], dashed: false },
      { kind: "guide", from: [0, 0], to: [10, 0], dashed: true },
      { kind: "cross", x: 5, y: 5 },
      { kind: "measure", from: [0, 10], to: [30, 10], text: "30" },
    ]);
    overlay.flush();
    const lines = (): unknown[] => calls.filter(([name]) => name === "setLineDash" || name === "moveTo" || name === "lineTo");
    const texts = (): unknown[] => calls.filter(([name]) => name === "fillText");
    expect(lines()).toEqual([
      ["setLineDash", []],
      ["moveTo", 10.5, 0.5],
      ["lineTo", 10.5, 100.5],
      ["setLineDash", [4, 3]],
      ["moveTo", 10.5, 0.5],
      ["lineTo", 30.5, 0.5],
      // La croce, centrata sul punto.
      ["setLineDash", []],
      ["moveTo", 17, 7],
      ["lineTo", 23, 13],
      ["moveTo", 23, 7],
      ["lineTo", 17, 13],
      // La misura, con le stanghette di traverso ai due capi.
      ["setLineDash", []],
      ["moveTo", 10.5, 20.5],
      ["lineTo", 70.5, 20.5],
      ["moveTo", 10.5, 16.5],
      ["lineTo", 10.5, 24.5],
      ["moveTo", 70.5, 16.5],
      ["lineTo", 70.5, 24.5],
      ["setLineDash", []],
    ]);
    expect(texts()).toEqual([["fillText", "30", 40, 20.5]]);

    // Accanto all'angolo della vista, 800 per 600, la scritta ci resta dentro.
    calls.length = 0;
    overlay.setHandles([{ kind: "measure", from: [390, 298], to: [395, 298], text: "5" }]);
    overlay.flush();
    expect(texts()).toEqual([["fillText", "5", 790, 590.5]]);
  });
});

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
