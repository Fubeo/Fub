// @vitest-environment happy-dom
// Il painter SVG DOM: che cosa entra nel documento della shell e che cosa
// no, che cosa resta lo stesso nodo fra due scene, e che ogni risorsa che
// apre si chiude quando la sua vita finisce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type ContainerNode } from "../scene/model";
import { doc } from "../scene/test-support";
import { IMAGE_PLACEHOLDER, PaintBuilder, wholeDocumentLayer, type PaintScene } from "./paint";
import { createSvgPainter, type ScenePainter } from "./svg-dom";
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
    painter.setView({ scale: 2, tx: 10, ty: -20 });
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
    painter.setView({ scale: 2, tx: 30, ty: -20 });
    painter.settle();
    expect(urls).toBe(2);
    expect(next.style.transform).toBe("translate(-80px, -75px)");
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
    painter.setView({ scale: 3, tx: 0, ty: 0 });
    vi.advanceTimersByTime(50);
    // Una decodifica ancora in corso quando la vita si chiude.
    expect(urls).toBe(2);
    owner.close();
    await decoded();
    expect(live.size).toBe(0);
    expect(host.children).toHaveLength(0);
    // Dopo, non apre più niente.
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    painter.setView({ scale: 1, tx: 0, ty: 0 });
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
    painter.update({ root: { attrs: [], page: null }, layers: [layer] });
    await decoded();
    expect(host.querySelectorAll("rect, script")).toHaveLength(0);
    const text = await blobs.get(host.querySelector("img")!.getAttribute("src")!)!.text();
    expect(text).toContain("<script>x()</script>");
    expect(text).not.toContain("background:none");
    painter.update({ root: { attrs: [], page: null }, layers: [layer] });
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
});
