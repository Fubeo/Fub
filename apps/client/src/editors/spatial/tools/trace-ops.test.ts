// «Ricalca immagine» sul documento: quali pixel si vedono e dove vanno, il
// gruppo che si scrive sopra l'immagine e l'immagine che resta nascosta, in
// un passo che un annulla riporta al byte.

import { describe, expect, it } from "vitest";
import { parsePath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import type { Traced } from "./trace";
import { imageWindow, traceOps, tracedGroup, traceSource, weightOf } from "./trace-ops";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Un ricalco di 4 × 2 pixel: un quadrato rosso a sinistra e uno blu a
/// destra.
const TRACED: Traced = {
  width: 4,
  height: 2,
  shapes: [
    { color: [255, 0, 0], segments: square(0, 0, 2) },
    { color: [0, 0, 255], segments: square(2, 0, 2) },
  ],
  nodes: 8,
  colors: 2,
};

function square(x: number, y: number, side: number): Segment[] {
  return [
    { kind: "move", to: [x, y] },
    { kind: "line", to: [x + side, y] },
    { kind: "line", to: [x + side, y + side] },
    { kind: "line", to: [x, y + side] },
    { kind: "close" },
  ];
}

/// I punti di `d`, in ordine.
const points = (d: string): Point[] => parsePath(d)!.flatMap((segment) => (segment.kind === "close" ? [] : [segment.to]));

describe("imageWindow", () => {
  it("con meet si vedono tutti i pixel, nel riquadro che l'immagine riempie", () => {
    const seen = imageWindow({ min: [10, 20], max: [110, 120] }, "", [200, 100]);
    expect(seen).toEqual({ pixels: { x: 0, y: 0, width: 200, height: 100 }, target: { min: [10, 45], max: [110, 95] } });
    expect(imageWindow({ min: [0, 0], max: [100, 100] }, "xMinYMax meet", [200, 100])!.target).toEqual({ min: [0, 50], max: [100, 100] });
  });

  it("con slice si ricalca solo la parte che il riquadro mostra", () => {
    expect(imageWindow({ min: [0, 0], max: [100, 100] }, "xMidYMid slice", [200, 100])).toEqual({
      pixels: { x: 50, y: 0, width: 100, height: 100 },
      target: { min: [0, 0], max: [100, 100] },
    });
    expect(imageWindow({ min: [0, 0], max: [100, 100] }, "xMinYMin slice", [200, 100])!.pixels).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("i pixel tagliati a metà diventano interi, almeno uno, sul rettangolo che si vede", () => {
    // Il riquadro mostra da 1,5 a 2,5: un pixel solo.
    expect(imageWindow({ min: [0, 0], max: [10, 10] }, "xMidYMid slice", [4, 1])).toEqual({
      pixels: { x: 2, y: 0, width: 1, height: 1 },
      target: { min: [0, 0], max: [10, 10] },
    });
  });

  it("con none l'immagine si stira sul riquadro; un riquadro vuoto non mostra niente", () => {
    expect(imageWindow({ min: [0, 0], max: [40, 10] }, "none", [4, 2])).toEqual({
      pixels: { x: 0, y: 0, width: 4, height: 2 },
      target: { min: [0, 0], max: [40, 10] },
    });
    expect(imageWindow({ min: [0, 0], max: [0, 10] }, "", [4, 2])).toBeNull();
    expect(imageWindow({ min: [0, 0], max: [10, 10] }, "", [0, 2])).toBeNull();
  });
});

describe("traceSource", () => {
  it("legge l'href, anche xlink:href, il riquadro e le proporzioni", () => {
    const opened = open(doc(`${LAYER}<image id="a" x="10" y="20" width="30" height="40" preserveAspectRatio="xMinYMin slice" href="a.png"/><image id="b" width="5" height="6" xlink:href="b.png"/></g>`));
    expect(traceSource(opened.index.get("a")!.node)).toEqual({ href: "a.png", box: { min: [10, 20], max: [40, 60] }, aspect: "xMinYMin slice" });
    expect(traceSource(opened.index.get("b")!.node)).toEqual({ href: "b.png", box: { min: [0, 0], max: [5, 6] }, aspect: "" });
  });

  it("un'immagine senza area non si ricalca", () => {
    const opened = open(doc(`${LAYER}<image id="a" width="0" height="40" href="a.png"/></g>`));
    expect(traceSource(opened.index.get("a")!.node)).toBeNull();
  });
});

describe("tracedGroup", () => {
  it("porta i pixel di lavoro nel rettangolo, con un tracciato pieno per forma", () => {
    const opened = open(doc(`${LAYER}<image id="a" x="10" y="20" width="40" height="20" href="a.png"/></g>`));
    const group = tracedGroup(opened.index.get("a")!.node, TRACED, { min: [10, 20], max: [50, 40] }, null);
    expect(group.tag).toBe("g");
    expect(group.attrs).toEqual({});
    expect(group.children!.map((child) => child.attrs.fill)).toEqual(["#ff0000", "#0000ff"]);
    expect(points(group.children![0]!.attrs.d!)).toEqual([[10, 20], [30, 20], [30, 40], [10, 40]]);
    expect(points(group.children![1]!.attrs.d!)).toEqual([[30, 20], [50, 20], [50, 40], [30, 40]]);
    // Senza id: è l'anteprima.
    expect(group.children!.every((child) => child.attrs.id === undefined)).toBe(true);
  });

  it("prende la trasformazione, l'opacità e il titolo dell'immagine, e toglie il contorno e la trasparenza che il livello darebbe", () => {
    const opened = open(doc(`${LAYER}<g id="g" stroke="#000" stroke-width="3" fill-opacity="0.5"><image id="a" width="4" height="2" transform="rotate(10)" opacity="0.8" href="a.png"><title>Logo</title></image></g></g>`));
    const group = tracedGroup(opened.index.get("a")!.node, TRACED, { min: [0, 0], max: [4, 2] }, null);
    expect(group.attrs).toEqual({ transform: "rotate(10)", opacity: "0.8", stroke: "none", "fill-opacity": "1" });
    expect(group.children![0]).toEqual({ tag: "title", attrs: {}, text: "Logo" });
  });

  it("pesa coi suoi id e il valore più lungo", () => {
    const opened = open(doc(`${LAYER}<image id="a" width="4" height="2" href="a.png"/></g>`));
    const group = tracedGroup(opened.index.get("a")!.node, TRACED, { min: [0, 0], max: [4, 2] }, null);
    const weight = weightOf(group);
    expect(weight.elements).toBe(3);
    expect(weight.longest).toBe(Math.max(...group.children!.map((child) => child.attrs.d!.length)));
    expect(weight.bytes).toBeGreaterThan(group.children!.reduce((sum, child) => sum + child.attrs.d!.length, 0) + 3 * 20);
  });
});

describe("traceOps", () => {
  it("scrive il gruppo subito sopra l'immagine e la nasconde, in un passo che un annulla riporta al byte", () => {
    const opened = open(doc(`${LAYER}<image id="a" width="4" height="2" href="a.png"><title>Logo</title></image><rect id="r" width="1" height="1"/></g>`));
    const before = opened.engine.text;
    const arranged = traceOps(opened.engine.model!, opened.index.get("a")!.node, TRACED, { min: [0, 0], max: [4, 2] }, ids(opened));
    const outcome = opened.engine.apply(gesture(arranged.ops)!);
    expect(outcome.outcome).toBe("applied");
    const text = opened.engine.text;
    const [group] = arranged.keys;
    // L'immagine, poi il gruppo col titolo e le due forme, poi il resto.
    expect([...text.matchAll(/<(\w+) id="([^"]+)"/g)].map((m) => (m[2] === group ? "group" : m[1]))).toEqual(["g", "image", "group", "path", "path", "rect"]);
    expect(text).toMatch(/<image id="a"[^>]* display="none"/);
    expect(text).toMatch(new RegExp(`<g id="${group}">\\s*<title>Logo</title>\\s*<path`));
    if (outcome.outcome !== "applied") return;
    expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
  });

  it("dà un id all'immagine che non ce l'ha", () => {
    const opened = open(doc(`${LAYER}<image width="4" height="2" href="a.png"/></g>`));
    const unit = opened.index.units.find((each) => each.role === "image")!;
    const arranged = traceOps(opened.engine.model!, unit.node, TRACED, { min: [0, 0], max: [4, 2] }, ids(opened));
    expect(arranged.ops[0]!.op).toBe("ident");
    expect(opened.engine.apply(gesture(arranged.ops)!).outcome).toBe("applied");
    expect(opened.engine.text).toMatch(/<image id="[^"]+"[^>]* display="none"[^>]*\/>\s*<g id="[^"]+">\s*<path/);
  });
});
