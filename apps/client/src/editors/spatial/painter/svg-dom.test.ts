// @vitest-environment happy-dom
// Il painter SVG DOM: che cosa entra nel documento della shell e che cosa
// no, che cosa resta lo stesso nodo fra due scene, e che ogni risorsa che
// apre si chiude quando la sua vita finisce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type ContainerNode, type ElementPart } from "../scene/model";
import { doc } from "../scene/test-support";
import { IMAGE_PLACEHOLDER, PaintBuilder, wholeDocumentLayer, type PaintScene } from "./paint";
import { createSvgPainter, miniaturePicture, paintMiniature, shapeCount, type ScenePainter } from "./svg-dom";
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
    painter.update({ root: { attrs: [], page: null, units: "px", guides: [] }, layers: [layer] });
    await decoded();
    expect(host.querySelectorAll("rect, script")).toHaveLength(0);
    const text = await blobs.get(host.querySelector("img")!.getAttribute("src")!)!.text();
    expect(text).toContain("<script>x()</script>");
    expect(text).not.toContain("background:none");
    painter.update({ root: { attrs: [], page: null, units: "px", guides: [] }, layers: [layer] });
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
