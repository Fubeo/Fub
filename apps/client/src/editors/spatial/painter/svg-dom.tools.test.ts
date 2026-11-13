// @vitest-environment happy-dom
// Il painter SVG DOM: l'anteprima degli strumenti e lo strato sopra la
// scena, e che ogni risorsa che aprono si chiude quando la loro vita finisce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type ContainerNode } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { PaintBuilder } from "./paint";
import { createSvgPainter } from "./svg-dom";
import { createOverlay } from "./overlay";
import { decoded, host, LAYER, live, owner, sceneOf, setUp, tearDown } from "./test-support";

beforeEach(setUp);
afterEach(tearDown);

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

  it("mostra un ritaglio che si regola: l'immagine intera attenuata e sopra la parte che resta, senza il ritaglio che ha", async () => {
    const engine = SceneEngine.open(
      doc(
        `<defs id="fub-defs"><clipPath id="k" fub:role="private"><rect x="10" y="10" width="20" height="20"/></clipPath></defs>${LAYER}` +
          `<image id="i" x="0" y="0" width="80" height="40" transform="rotate(30)" clip-path="url(#k)" href="data:image/png;base64,iVBORw0KGgo="/><circle id="c" r="2"/></g>`,
      ),
    );
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner);
    painter.update(sceneOf(engine, builder));
    await decoded();
    const image = host.querySelector(`[data-scene-id="i"]`) as SVGElement;
    const [paint] = builder.paintsOf(engine.holder("i")!);
    painter.setCrops(new Map([[paint!, { box: { min: [5, 0], max: [85, 40] }, rect: { min: [20, 5], max: [60, 35] } }]]));
    expect(image.style.visibility).toBe("hidden");
    const whole = image.nextElementSibling as SVGElement;
    expect(whole.localName).toBe("g");
    expect(whole.style.opacity).toBe("0.3");
    const ghost = whole.firstElementChild as SVGElement;
    const kept = whole.nextElementSibling as SVGElement;
    for (const copy of [ghost, kept]) {
      expect(copy.localName).toBe("image");
      expect([copy.getAttribute("x"), copy.getAttribute("y"), copy.getAttribute("width"), copy.getAttribute("height")]).toEqual(["5", "0", "80", "40"]);
      expect(copy.getAttribute("transform")).toBe("rotate(30)");
      expect(copy.getAttribute("href")).toBe("data:image/png;base64,iVBORw0KGgo=");
      expect(copy.hasAttribute("data-scene-id")).toBe(false);
      expect(copy.style.visibility).toBe("");
    }
    expect(ghost.hasAttribute("clip-path")).toBe(false);
    const id = /^url\(#(.+)\)$/.exec(kept.getAttribute("clip-path") ?? "")?.[1];
    const clip = id === undefined ? null : document.getElementById(id);
    expect(clip?.localName).toBe("clipPath");
    expect(clip?.innerHTML).toBe('<rect x="20" y="5" width="40" height="30"></rect>');
    painter.setCrops(null);
    expect(image.nextElementSibling?.localName).toBe("circle");
    expect(image.style.visibility).toBe("");
    expect(id === undefined ? null : document.getElementById(id)).toBeNull();
    painter.dispose();
  });

  it("tiene le copie del ritaglio sull'URL dell'immagine, anche se arriva dopo che il ritaglio è aperto", async () => {
    let arrive: (url: string) => void = () => {};
    const engine = SceneEngine.open(doc(`${LAYER}<image id="i" x="0" y="0" width="80" height="40" href="foto.png"/></g>`));
    const builder = new PaintBuilder();
    const painter = createSvgPainter(host, owner, {
      images: () => new Promise<string | null>((resolve) => (arrive = resolve)),
    });
    painter.update(sceneOf(engine, builder));
    await decoded();
    const image = host.querySelector(`[data-scene-id="i"]`) as SVGElement;
    const [paint] = builder.paintsOf(engine.holder("i")!);
    const crop = { box: { min: [0, 0], max: [80, 40] }, rect: { min: [10, 5], max: [60, 35] } } as const;
    painter.setCrops(new Map([[paint!, crop]]));
    const whole = image.nextElementSibling as SVGElement;
    const copies = (): Array<string | null> => [whole.firstElementChild!.getAttribute("href"), whole.nextElementSibling!.getAttribute("href")];
    expect(copies()).toEqual([null, null]);
    arrive("fub-asset://lease/7");
    await decoded();
    expect(image.getAttribute("href")).toBe("fub-asset://lease/7");
    expect(copies()).toEqual(["fub-asset://lease/7", "fub-asset://lease/7"]);
    // Rifatte dal ritaglio che cambia, le copie partono dall'URL che c'è.
    painter.setCrops(new Map([[paint!, { ...crop, rect: { min: [20, 5], max: [60, 35] } }]]));
    expect(image.nextElementSibling!.firstElementChild!.getAttribute("href")).toBe("fub-asset://lease/7");
    painter.setCrops(null);
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

  it("disegna le guide nette sul mezzo pixel", () => {
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
    ]);
    overlay.flush();
    const lines = (): unknown[] => calls.filter(([name]) => name === "setLineDash" || name === "moveTo" || name === "lineTo");
    expect(lines()).toEqual([
      ["setLineDash", []],
      ["moveTo", 10.5, 0.5],
      ["lineTo", 10.5, 100.5],
      ["setLineDash", [4, 3]],
      ["moveTo", 10.5, 0.5],
      ["lineTo", 30.5, 0.5],
      ["setLineDash", []],
    ]);
  });

  it("disegna la punta alla misura vera per lo zoom, girata con la vista; la gomma resta della stessa misura", () => {
    const calls: Array<readonly [string, ...unknown[]]> = [];
    const context = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, name) => {
        if (name in target) return target[name];
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
    const ellipses = (): unknown[] => calls.filter(([name]) => name === "ellipse").map(([, ...args]) => args.slice(0, 5));
    overlay.setView({ scale: 2, angle: 0, tx: 0, ty: 0 });
    overlay.setHandles([{ kind: "nib", x: 10, y: 10, shape: "round", width: 6, height: 6, angle: 0 }]);
    overlay.flush();
    // Il contorno due volte, sul filo di carta e sopra.
    expect(ellipses()).toEqual([[20, 20, 6, 6, 0], [20, 20, 6, 6, 0]]);
    // La punta piatta, girata del suo angolo e di quello della vista.
    calls.length = 0;
    overlay.setView({ scale: 1, angle: 90, tx: 0, ty: 0 });
    overlay.setHandles([{ kind: "nib", x: 0, y: 0, shape: "flat", width: 12, height: 1, angle: 35 }]);
    overlay.flush();
    expect(ellipses()[0]).toEqual([0, 0, 6, 1, (125 * Math.PI) / 180]);
    // La gomma: il diametro è in pixel, con lo zoom che sia.
    calls.length = 0;
    overlay.setView({ scale: 4, angle: 0, tx: 0, ty: 0 });
    overlay.setHandles([{ kind: "nib", x: 0, y: 0, shape: "eraser", width: 16, height: 16, angle: 0 }]);
    overlay.flush();
    expect(ellipses()[0]).toEqual([0, 0, 8, 8, 0]);
    expect(calls.some(([name, dash]) => name === "setLineDash" && Array.isArray(dash) && dash.length > 0)).toBe(true);
  });
});
