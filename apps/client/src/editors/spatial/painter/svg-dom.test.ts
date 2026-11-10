// @vitest-environment happy-dom
// Il painter SVG DOM: che cosa entra nel documento della shell e che cosa
// no, che cosa resta lo stesso nodo fra due scene, e che ogni risorsa che
// apre si chiude quando la sua vita finisce. Qui il documento vivo, le
// miniature, la vista dei contorni e lo smontaggio; l'anteprima degli
// strumenti e lo strato sopra la scena in `svg-dom.tools.test.ts`, le
// risorse, i simboli e le copie vive in `svg-dom.resources.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import type { ContainerNode, ElementPart } from "../scene/model";
import { doc } from "../scene/test-support";
import { IMAGE_PLACEHOLDER, PaintBuilder, wholeDocumentLayer, type PaintScene } from "./paint";
import { toScene, toScreen, viewTransform, type View } from "../view";
import { createSvgPainter, miniaturePicture, paintMiniature, shapeCount, type ScenePainter } from "./svg-dom";
import { aroundCenter, blobs, decoded, host, HOSTILE, largeRects, LAYER, live, owner, sceneOf, setUp, tearDown, urls } from "./test-support";

beforeEach(setUp);
afterEach(tearDown);

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

  it("in una scena grande la camera muove la radice, e arriva agli strati quando si ferma", () => {
    vi.useFakeTimers();
    const painter = createSvgPainter(host, owner, { settleMs: 100 });
    painter.update(sceneOf(SceneEngine.open(doc(`${LAYER}${largeRects()}</g>`)), new PaintBuilder()));
    const root = host.querySelector<HTMLElement>(".spatial-painter")!;
    const camera = host.querySelector(".spatial-layer > g")!;
    const drawn = camera.getAttribute("transform");
    expect(root.hasAttribute("data-large")).toBe(true);
    // Il margine dipinto è un quarto del lato più lungo della vista.
    expect(root.style.getPropertyValue("overflow-clip-margin")).toBe("200px");
    /// Dove la radice porta un punto dello schermo, con la divisione per la
    /// coordinata omogenea.
    const moved = ([x, y]: readonly [number, number]): [number, number] => {
      const m = /^matrix3d\((.*)\)$/.exec(root.style.transform)![1]!.split(",").map(Number);
      const w = m[3]! * x + m[7]! * y + m[15]!;
      return [(m[0]! * x + m[4]! * y + m[12]!) / w, (m[1]! * x + m[5]! * y + m[13]!) / w];
    };
    // Uno zoom del doppio, poi girato e ancora avanti: la radice, partita,
    // porta anche oltre il doppio.
    const views = [aroundCenter(2, 0), aroundCenter(2.5, 30), aroundCenter(5, 270)];
    for (const view of views) {
      painter.setView(view);
      // Gli strati restano dove sono disegnati; la radice li porta dove la
      // camera chiede, punto per punto.
      expect(camera.getAttribute("transform")).toBe(drawn);
      for (const p of [[0, 0], [800, 0], [123, 456]] as const) {
        const [x, y] = moved(p);
        const [ex, ey] = toScreen(view, toScene({ scale: 1, angle: 0, tx: 0, ty: 0 }, p));
        expect(x).toBeCloseTo(ex, 6);
        expect(y).toBeCloseTo(ey, 6);
      }
    }
    // La parte lineare della trasformazione non cambia scala.
    expect(root.style.transform).toMatch(/^matrix3d\(0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, /);
    vi.advanceTimersByTime(100);
    expect(camera.getAttribute("transform")).toBe(viewTransform(views[2]!));
    expect(root.style.transform).toBe("");
    // Tornata piccola, la scena prende subito la vista che la radice
    // mostrava.
    const last = aroundCenter(5.5, 270);
    painter.setView(last);
    expect(root.style.transform).not.toBe("");
    painter.update(sceneOf(SceneEngine.open(doc(`${LAYER}<rect width="1" height="1"/></g>`)), new PaintBuilder()));
    expect(root.hasAttribute("data-large")).toBe(false);
    expect(root.style.transform).toBe("");
    expect(root.style.getPropertyValue("overflow-clip-margin")).toBe("");
    expect(host.querySelector(".spatial-layer > g")!.getAttribute("transform")).toBe(viewTransform(last));
  });

  it("in una scena grande un passo che scopre oltre il margine, o che salta, ridisegna subito", () => {
    vi.useFakeTimers();
    const painter = createSvgPainter(host, owner, { settleMs: 100 });
    painter.update(sceneOf(SceneEngine.open(doc(`${LAYER}${largeRects()}</g>`)), new PaintBuilder()));
    const root = host.querySelector<HTMLElement>(".spatial-painter")!;
    const camera = host.querySelector(".spatial-layer > g")!;
    /// Vero se la radice porta gli strati, che restano dove sono disegnati;
    /// altrimenti sono già nella vista.
    const carried = (view: View): boolean => {
      const drawn = camera.getAttribute("transform");
      painter.setView(view);
      if (root.style.transform === "") {
        expect(camera.getAttribute("transform")).toBe(viewTransform(view));
        return false;
      }
      expect(camera.getAttribute("transform")).toBe(drawn);
      return true;
    };
    // Una panoramica dentro il margine di 200 px la porta la radice; oltre,
    // il bordo destro scoprirebbe ciò che non è dipinto.
    expect(carried({ scale: 1, angle: 0, tx: -150, ty: 0 })).toBe(true);
    expect(carried({ scale: 1, angle: 0, tx: -250, ty: 0 })).toBe(false);
    // Da ferma, la radice non parte ingrandita oltre il doppio: un salto.
    expect(carried(aroundCenter(2.5, 0, [-250, 0]))).toBe(false);
    vi.advanceTimersByTime(100);
    // Fino al doppio parte, e poi segue lo zoom anche oltre.
    expect(carried(aroundCenter(2.5 * 1.5, 0, [-250, 0]))).toBe(true);
    expect(carried(aroundCenter(2.5 * 4, 0, [-250, 0]))).toBe(true);
    vi.advanceTimersByTime(100);
    expect(root.style.transform).toBe("");
    // Indietro, il margine basta fino a 0,7 della scala; a metà no.
    expect(carried(aroundCenter(10 * 0.7, 0, [-250, 0]))).toBe(true);
    expect(carried(aroundCenter(10 * 0.5, 0, [-250, 0]))).toBe(false);
  });

  it("dove il browser non conosce overflow-clip-margin, una scena grande ridisegna ogni passo che scopre", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const painter = createSvgPainter(host, owner, { settleMs: 100 });
    vi.unstubAllGlobals();
    painter.update(sceneOf(SceneEngine.open(doc(`${LAYER}${largeRects()}</g>`)), new PaintBuilder()));
    const root = host.querySelector<HTMLElement>(".spatial-painter")!;
    expect(root.hasAttribute("data-large")).toBe(true);
    expect(root.style.getPropertyValue("overflow-clip-margin")).toBe("");
    painter.setView({ scale: 1, angle: 0, tx: -1, ty: 0 });
    expect(root.style.transform).toBe("");
    // Uno zoom avanti non scopre niente.
    painter.setView(aroundCenter(1.5, 0, [-1, 0]));
    expect(root.style.transform).toMatch(/^matrix3d\(/);
  });

  it("in una scena piccola la camera arriva subito agli strati", () => {
    const painter = createSvgPainter(host, owner, { settleMs: 100 });
    painter.update(sceneOf(SceneEngine.open(doc(`${LAYER}<rect width="1" height="1"/></g>`)), new PaintBuilder()));
    painter.setView({ scale: 2, angle: 0, tx: 10, ty: -20 });
    const root = host.querySelector<HTMLElement>(".spatial-painter")!;
    expect(root.hasAttribute("data-large")).toBe(false);
    expect(root.style.transform).toBe("");
    expect(host.querySelector(".spatial-layer > g")!.getAttribute("transform")).toBe("matrix(2 0 0 2 10 -20)");
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

  it("dà la fusione e l'isolamento allo stile in linea, accanto all'anteprima", async () => {
    const engine = SceneEngine.open(doc(
      `${LAYER}<g id="g" style="isolation: isolate"><rect id="a" width="4" height="4" style="mix-blend-mode: multiply"/></g>`
        + '<rect id="b" width="2" height="2"/></g>',
    ));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const node = (id: string): SVGElement => host.querySelector(`[data-scene-id="${id}"]`)!;
    expect(node("a").style.getPropertyValue("mix-blend-mode")).toBe("multiply");
    expect(node("g").style.getPropertyValue("isolation")).toBe("isolate");
    expect(node("b").getAttribute("style")).toBeNull();
    // L'anteprima sbiadisce e torna senza toccare la fusione.
    const [paintA] = builder.paintsOf(engine.holder("a")!);
    painter.setDraft({ faded: new Set([paintA!]) });
    expect(node("a").style.opacity).toBe("0.25");
    expect(node("a").style.getPropertyValue("mix-blend-mode")).toBe("multiply");
    painter.setDraft(null);
    expect(node("a").style.opacity).toBe("");
    expect(node("a").style.getPropertyValue("mix-blend-mode")).toBe("multiply");
    // La fusione cambiata non tocca l'attenuazione del gruppo isolato.
    painter.setFocus([engine.holder("l1")!, engine.holder("g")!]);
    expect(engine.apply({ op: "set", id: "b", attrs: { style: "mix-blend-mode: screen" } }).outcome).toBe("applied");
    painter.update(sceneOf(engine, builder));
    expect(node("b").style.getPropertyValue("mix-blend-mode")).toBe("screen");
    expect(node("b").style.opacity).toBe("0.4");
    painter.setFocus(null);
    expect(node("b").style.opacity).toBe("");
    expect(node("b").style.getPropertyValue("mix-blend-mode")).toBe("screen");
    // Tolto lo style, se ne vanno.
    expect(engine.apply({ op: "set", id: "b", attrs: { style: null } }).outcome).toBe("applied");
    expect(engine.apply({ op: "set", id: "g", attrs: { style: null } }).outcome).toBe("applied");
    painter.update(sceneOf(engine, builder));
    expect(node("b").style.getPropertyValue("mix-blend-mode")).toBe("");
    expect(node("g").style.getPropertyValue("isolation")).toBe("");
    painter.dispose();
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

describe("la vista dei contorni", () => {
  it("accende un foglio sugli strati vivi e lo mette dentro gli strati immagine, e spenta li toglie", async () => {
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(SceneEngine.open(HOSTILE), new PaintBuilder()));
    await decoded();
    const root = host.querySelector<HTMLElement>(".spatial-painter")!;
    painter.setOutline(true);
    await decoded();
    expect(root.hasAttribute("data-outline")).toBe(true);
    const sheet = root.querySelector("style")!.textContent!;
    expect(sheet).toContain(".spatial-painter[data-outline] svg *{fill:none!important");
    expect(sheet).toContain("vector-effect:non-scaling-stroke!important");
    // L'estraneo, uno strato immagine, si ridisegna col foglio dentro.
    const img = host.querySelector("img")!;
    expect(await blobs.get(img.getAttribute("src")!)!.text()).toContain("svg *{fill:none!important");
    painter.setOutline(false);
    expect(root.hasAttribute("data-outline")).toBe(false);
    expect(root.querySelector("style")).toBeNull();
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
    painter.update({ root: { attrs: [], page: null, units: "px", guides: [] }, layers: [layer], resources: [], symbols: [], originals: new Set() });
    await decoded();
    expect(host.querySelectorAll("rect, script")).toHaveLength(0);
    const text = await blobs.get(host.querySelector("img")!.getAttribute("src")!)!.text();
    expect(text).toContain("<script>x()</script>");
    expect(text).not.toContain("background:none");
    painter.update({ root: { attrs: [], page: null, units: "px", guides: [] }, layers: [layer], resources: [], symbols: [], originals: new Set() });
    expect(urls).toBe(1);
  });
});
