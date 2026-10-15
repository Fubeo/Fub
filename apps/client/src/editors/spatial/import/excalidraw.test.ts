import { describe, expect, it } from "vitest";
import { TEXT_FAMILY } from "../tools/text";
import type { Diagram, GroupNode, ImageNode, InkNode, LineNode, Node, PathNode, ShapeNode, TextNode } from "./diagram";
import { NotExcalidraw, readExcalidraw } from "./excalidraw";

// Le scene delle prove, con gli elementi come li scrive Excalidraw: i campi
// di partenza e quelli che ogni prova cambia.

type Fields = Record<string, unknown>;

/// Un elemento `type` con l'id `id`.
const element = (type: string, id: string, fields: Fields = {}): Fields => ({
  type,
  id,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  roundness: null,
  isDeleted: false,
  locked: false,
  link: null,
  boundElements: null,
  ...fields,
});

/// Un testo: `text` scritto, Helvetica (che non è a mano) se non si dice.
const text = (id: string, value: string, fields: Fields = {}): Fields => element("text", id, { text: value, originalText: value, fontSize: 20, fontFamily: 2, textAlign: "left", verticalAlign: "top", lineHeight: 1.25, containerId: null, autoResize: true, ...fields });

/// Una freccia da (`x`, `y`) per i punti `points`, relativi.
const arrow = (id: string, [x, y]: readonly [number, number], points: readonly (readonly [number, number])[], fields: Fields = {}): Fields =>
  element("arrow", id, { x, y, points, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false, ...fields });

/// Una scena coi suoi elementi.
const scene = (elements: readonly Fields[], extra: Fields = {}): string => JSON.stringify({ type: "excalidraw", version: 2, source: "https://excalidraw.com", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {}, ...extra });

/// Il diagramma di una scena.
const read = (elements: readonly Fields[], extra: Fields = {}): Diagram => readExcalidraw(scene(elements, extra));

/// I nodi in cima.
const top = (diagram: Diagram): readonly Node[] => diagram.layers[0]!.nodes;

/// Il nodo in cima con la chiave `key`.
const byKey = (diagram: Diagram, key: string): Node => {
  const found = top(diagram).find((node) => node.key === key);
  if (found === undefined) throw new Error(`manca ${key}`);
  return found;
};

describe("la scena", () => {
  it("dice perché un file non è di Excalidraw", () => {
    for (const bad of ["ciao", "null", "[1]", '{"type":"altro","elements":[]}', '{"type":"excalidraw","elements":{}}']) expect(() => readExcalidraw(bad), bad).toThrow(NotExcalidraw);
  });

  it("legge anche ciò che Excalidraw mette negli appunti, e salta gli elementi cancellati", () => {
    const diagram = readExcalidraw(JSON.stringify({ type: "excalidraw/clipboard", elements: [element("rectangle", "a"), element("rectangle", "b", { isDeleted: true })] }));
    expect(diagram.source).toBe("excalidraw");
    expect(top(diagram).map((node) => node.key)).toEqual(["a"]);
    expect(diagram.background).toBeNull();
  });

  it("tiene il colore della carta, se non è bianca", () => {
    expect(readExcalidraw(scene([], { appState: { viewBackgroundColor: "#FFF9DB" } })).background).toBe("#fff9db");
  });
});

describe("le forme", () => {
  it("un rettangolo tondo ha l'angolo di Excalidraw, e il testo al centro ne è l'etichetta", () => {
    const diagram = read([
      element("rectangle", "r", { roundness: { type: 3 }, backgroundColor: "#a5d8ff", boundElements: [{ id: "t", type: "text" }] }),
      text("t", "Ciao", { x: 30, y: 12, width: 40, height: 25, fontFamily: 5, textAlign: "center", verticalAlign: "middle", containerId: "r" }),
    ]);
    expect(top(diagram)).toEqual([
      {
        type: "shape",
        key: "r",
        locked: false,
        spin: null,
        form: { kind: "rect", corner: 12.5 },
        box: { min: [0, 0], max: [100, 50] },
        look: { stroke: { color: "#1e1e1e", width: 2, dash: "solid" }, fill: { kind: "color", color: "#a5d8ff" }, opacity: 1 },
        label: {
          type: { family: TEXT_FAMILY, size: 20, color: "#1e1e1e", bold: false, italic: false, underline: false, strike: false },
          align: "middle",
          leading: 1.25,
          paragraphs: [[{ text: "Ciao", type: null }]],
        },
      },
    ]);
    expect(diagram.notes).toEqual([{ kind: "hand-font", count: 1, sample: "Excalifont" }]);
  });

  it("gli angoli: adattivi fino a 32, in proporzione, alla vecchia maniera, o dritti", () => {
    const diagram = read([
      element("rectangle", "a", { width: 400, height: 200, roundness: { type: 3 } }),
      element("rectangle", "b", { width: 400, height: 200, roundness: { type: 2 } }),
      element("rectangle", "c", { width: 40, height: 20, strokeSharpness: "round" }),
      element("rectangle", "d"),
      element("ellipse", "e"),
      element("diamond", "f"),
    ]);
    const form = (key: string) => (byKey(diagram, key) as ShapeNode).form;
    expect([form("a"), form("b"), form("c"), form("d"), form("e"), form("f")]).toEqual([
      { kind: "rect", corner: 32 },
      { kind: "rect", corner: 50 },
      { kind: "rect", corner: 5 },
      { kind: "rect", corner: 0 },
      { kind: "ellipse" },
      { kind: "library", id: "basic-diamond" },
    ]);
  });

  it("il tratteggio a mano diventa una campitura a righe del passo di Excalidraw", () => {
    const diagram = read([
      element("rectangle", "h", { backgroundColor: "#ffc9c9", fillStyle: "hachure" }),
      element("rectangle", "x", { backgroundColor: "#ffc9c9", fillStyle: "cross-hatch", strokeWidth: 4 }),
      element("rectangle", "z", { backgroundColor: "#ffc9c9", fillStyle: "zigzag" }),
    ]);
    const fill = (key: string) => (byKey(diagram, key) as ShapeNode).look.fill;
    expect(fill("h")).toEqual({ kind: "hatch", hatch: "lines", color: "#ffc9c9", background: null, spacing: 8, width: 1 });
    expect(fill("x")).toEqual({ kind: "hatch", hatch: "cross", color: "#ffc9c9", background: null, spacing: 16, width: 2 });
    expect(fill("z")).toMatchObject({ kind: "hatch", hatch: "lines" });
    expect(diagram.notes).toEqual([{ kind: "fill", count: 1, sample: "zigzag" }]);
  });

  it("traduce il tratteggio, il contorno trasparente, l'opacità, la rotazione e il blocco", () => {
    const diagram = read([
      element("rectangle", "a", { strokeStyle: "dashed", opacity: 50 }),
      element("rectangle", "b", { strokeStyle: "dotted", angle: Math.PI / 2, locked: true }),
      element("rectangle", "c", { strokeColor: "transparent", backgroundColor: "#ffec99" }),
    ]);
    const a = byKey(diagram, "a") as ShapeNode;
    const b = byKey(diagram, "b") as ShapeNode;
    const c = byKey(diagram, "c") as ShapeNode;
    expect([a.look.stroke?.dash, a.look.opacity]).toEqual(["dashed", 0.5]);
    expect([b.look.stroke?.dash, b.locked]).toEqual(["dotted", true]);
    expect(b.spin?.angle).toBeCloseTo(90);
    expect(b.spin?.centre).toEqual([50, 25]);
    expect(c.look).toEqual({ stroke: null, fill: { kind: "color", color: "#ffec99" }, opacity: 1 });
  });

  it("il testo in cima a una forma resta in cima, in un gruppo con lei, e va a capo nella forma", () => {
    const diagram = read([
      element("rectangle", "r", { boundElements: [{ id: "t", type: "text" }] }),
      text("t", "Titolo lungo", { x: 5, y: 5, width: 90, height: 25, text: "Titolo\nlungo", textAlign: "center", verticalAlign: "top", containerId: "r" }),
    ]);
    const group = top(diagram)[0] as GroupNode;
    expect([group.type, group.key, group.spin]).toEqual(["group", "r", null]);
    expect(group.children.map((child) => [child.type, child.key])).toEqual([
      ["shape", ""],
      ["text", ""],
    ]);
    const title = group.children[1] as TextNode;
    expect(title.at[0]).toBe(50);
    expect(title.at[1]).toBeCloseTo(5 + 12.5 + 0.27 * 20);
    // Il testo scritto, non quello che Excalidraw manda a capo.
    expect([title.width, title.content.paragraphs]).toEqual([90, [[{ text: "Titolo lungo", type: null }]]]);
  });
});

describe("i testi", () => {
  it("un testo a sé resta a punto, o in area se la sua larghezza è fissa", () => {
    const diagram = read([
      text("p", "uno due", { x: 10, y: 10, width: 80, text: "uno\ndue", textAlign: "right", fontFamily: 3 }),
      text("a", "uno due", { x: 10, y: 100, width: 80, text: "uno\ndue", autoResize: false }),
    ]);
    const p = byKey(diagram, "p") as TextNode;
    expect([p.at[0], p.width, p.content.align, p.content.type.family, p.content.paragraphs.length]).toEqual([90, null, "end", "JetBrains Mono, monospace", 2]);
    const a = byKey(diagram, "a") as TextNode;
    expect([a.at[0], a.width, a.content.paragraphs]).toEqual([10, 80, [[{ text: "uno due", type: null }]]]);
    expect(diagram.notes).toEqual([]);
  });
});

describe("le frecce", () => {
  const boxes = [element("rectangle", "a", { x: 0, y: 0 }), element("rectangle", "b", { x: 200, y: 0 }), element("rectangle", "c", { x: 200, y: 100 })];

  it("una freccia agganciata è un connettore, coi capi sugli stessi oggetti e l'etichetta", () => {
    const diagram = read([
      ...boxes,
      arrow("x", [100, 25], [[0, 0], [100, 0]], { startBinding: { elementId: "a" }, endBinding: { elementId: "b", fixedPoint: [0, 0.5] }, boundElements: [{ id: "l", type: "text" }] }),
      text("l", "va", { containerId: "x", textAlign: "center", verticalAlign: "middle" }),
    ]);
    const line = byKey(diagram, "x") as LineNode;
    expect({ ...line, labels: [] }).toEqual({
      type: "line",
      key: "x",
      locked: false,
      spin: null,
      kind: "straight",
      from: { node: "a", anchor: "auto", at: [100, 25] },
      to: { node: "b", anchor: "left", at: [200, 25] },
      look: { stroke: { color: "#1e1e1e", width: 2, dash: "solid" }, fill: null, opacity: 1 },
      start: null,
      end: { shape: "vee", size: "medium" },
      labels: [],
      route: [
        [100, 25],
        [200, 25],
      ],
    });
    expect(line.labels.map((label) => label.content.paragraphs)).toEqual([[[{ text: "va", type: null }]]]);
    expect(line.labels[0]!.t).toBeCloseTo(0.5, 1);
  });

  it("a gomito resta a gomito; arrotondata diventa una curva; a punta e agganciata, una curva con la nota", () => {
    const diagram = read([
      ...boxes,
      arrow("elbow", [100, 25], [[0, 0], [50, 0], [50, 100], [100, 100]], { elbowed: true, startBinding: { elementId: "a" }, endBinding: { elementId: "c" } }),
      arrow("round", [100, 25], [[0, 0], [50, 30], [100, 100]], { roundness: { type: 2 }, startBinding: { elementId: "a" }, endBinding: { elementId: "c" } }),
      arrow("sharp", [100, 25], [[0, 0], [50, 30], [100, 100]], { startBinding: { elementId: "a" }, endBinding: { elementId: "c" } }),
    ]);
    expect(byKey(diagram, "elbow")).toMatchObject({
      kind: "elbow",
      route: [
        [100, 25],
        [150, 25],
        [150, 125],
        [200, 125],
      ],
    });
    expect(byKey(diagram, "round")).toMatchObject({ kind: "curved" });
    expect((byKey(diagram, "round") as LineNode).route).toHaveLength(4);
    expect(byKey(diagram, "sharp")).toMatchObject({ kind: "curved" });
    // Soltanto la freccia a punta cambia aspetto.
    expect(diagram.notes).toEqual([{ kind: "route", count: 1, sample: "" }]);
  });

  it("una freccia libera con più punti resta una linea con le punte", () => {
    const diagram = read([arrow("p", [0, 0], [[0, 0], [50, 30], [100, 0]], { startArrowhead: "dot", endArrowhead: "triangle" })]);
    expect(byKey(diagram, "p")).toEqual({
      type: "path",
      key: "p",
      locked: false,
      spin: null,
      points: [
        [0, 0],
        [50, 30],
        [100, 0],
      ],
      smooth: false,
      closed: false,
      look: { stroke: { color: "#1e1e1e", width: 2, dash: "solid" }, fill: null, opacity: 1 },
      start: { shape: "circle", size: "medium" },
      end: { shape: "triangle", size: "medium" },
    });
  });

  it("le punte che FubDraw non ha: le vuote si riempiono, le altre si tolgono, e la nota lo dice", () => {
    const diagram = read([arrow("a", [0, 0], [[0, 0], [100, 0]], { startArrowhead: "triangle_outline", endArrowhead: "crowfoot_many" }), arrow("b", [0, 0], [[0, 0], [2, 0]], { endArrowhead: "bar" })]);
    expect([(byKey(diagram, "a") as LineNode).start, (byKey(diagram, "a") as LineNode).end]).toEqual([{ shape: "triangle", size: "medium" }, null]);
    // Una freccia di un clic non ha le punte.
    expect((byKey(diagram, "b") as LineNode).end).toBeNull();
    expect(diagram.notes).toEqual([{ kind: "tip", count: 2, sample: "triangle_outline" }]);
  });

  it("una freccia girata ha i capi dove stanno nella tela", () => {
    const diagram = read([arrow("r", [0, 0], [[0, 0], [100, 0]], { width: 100, height: 0, angle: Math.PI })]);
    const line = byKey(diagram, "r") as LineNode;
    expect(line.spin).toBeNull();
    expect(line.from.at[0]).toBeCloseTo(100);
    expect(line.to.at[0]).toBeCloseTo(0);
  });
});

describe("le linee, i tratti e le immagini", () => {
  it("una linea chiusa, o un poligono, si riempie; una aperta no", () => {
    const diagram = read([
      element("line", "poly", { points: [[0, 0], [100, 0], [50, 50]], polygon: true, backgroundColor: "#b2f2bb" }),
      element("line", "loop", { points: [[0, 0], [100, 0], [50, 50], [0, 0]], backgroundColor: "#b2f2bb" }),
      element("line", "open", { points: [[0, 0], [100, 0], [50, 50]], backgroundColor: "#b2f2bb", roundness: { type: 2 } }),
    ]);
    const poly = byKey(diagram, "poly") as PathNode;
    expect([poly.closed, poly.points.length, poly.look.fill]).toEqual([true, 4, { kind: "color", color: "#b2f2bb" }]);
    expect((byKey(diagram, "loop") as PathNode).closed).toBe(true);
    const open = byKey(diagram, "open") as PathNode;
    expect([open.closed, open.smooth, open.look.fill]).toEqual([false, true, null]);
  });

  it("il tratto a mano libera tiene la pressione vera, o la lascia simulare", () => {
    const diagram = read([
      element("freedraw", "real", { x: 10, y: 10, points: [[0, 0], [5, 5]], pressures: [0.2, 1.5], simulatePressure: false }),
      element("freedraw", "fake", { points: [[0, 0], [5, 5]], pressures: [], simulatePressure: true, strokeColor: "#e03131", strokeWidth: 1 }),
    ]);
    expect(byKey(diagram, "real")).toEqual({
      type: "ink",
      key: "real",
      locked: false,
      spin: null,
      samples: [
        { x: 10, y: 10, p: 0.2 },
        { x: 15, y: 15, p: 1 },
      ],
      size: 8.5,
      thinning: 0.6,
      simulate: false,
      color: "#1e1e1e",
      opacity: 1,
    });
    const fake = byKey(diagram, "fake") as InkNode;
    expect([fake.simulate, fake.samples[1], fake.size, fake.color]).toEqual([true, { x: 5, y: 5 }, 4.25, "#e03131"]);
  });

  it("un'immagine incorporata resta, ribaltata e ritagliata come in Excalidraw; una che manca diventa una nota", () => {
    const files = { f1: { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" }, f2: { mimeType: "application/pdf", dataURL: "data:application/pdf;base64,AAAA" } };
    const diagram = read(
      [
        element("image", "i", { width: 100, height: 80, fileId: "f1", scale: [-1, 1], crop: { x: 10, y: 20, width: 50, height: 40, naturalWidth: 100, naturalHeight: 80 } }),
        element("image", "j", { fileId: "manca" }),
        element("image", "k", { fileId: "f2" }),
      ],
      { files },
    );
    expect(top(diagram)).toEqual([
      {
        type: "image",
        key: "i",
        locked: false,
        spin: null,
        href: "data:image/png;base64,AAAA",
        box: { min: [-20, -40], max: [180, 120] },
        opacity: 1,
        crop: { min: [0.1, 0.25], max: [0.6, 0.75] },
        flip: { x: true, y: false, centre: [50, 40] },
      } satisfies ImageNode,
    ]);
    expect(diagram.notes).toEqual([{ kind: "image", count: 2, sample: "application/pdf" }]);
  });
});

describe("i gruppi, le cornici e le note", () => {
  it("i gruppi si annidano come in Excalidraw, dal più esterno", () => {
    const diagram = read([element("rectangle", "a", { groupIds: ["dentro", "fuori"] }), element("rectangle", "b", { groupIds: ["fuori"] }), element("rectangle", "c")]);
    const keys = (nodes: readonly Node[]): unknown[] => nodes.map((node) => (node.type === "group" ? { [node.key]: keys(node.children) } : node.key));
    expect(keys(top(diagram))).toEqual([{ "group:fuori": [{ "group:dentro": ["a"] }, "b"] }, "c"]);
  });

  it("le cornici diventano tavole col loro nome", () => {
    const diagram = read([element("frame", "f", { x: 10, y: 20, width: -200, height: 100, name: "Schizzo" }), element("rectangle", "a", { frameId: "f" })]);
    expect(diagram.boards).toEqual([{ name: "Schizzo", box: { min: [-190, 20], max: [10, 120] } }]);
    expect(top(diagram).map((node) => node.key)).toEqual(["a"]);
  });

  it("conta il tratto a mano, i collegamenti, i contenuti incorporati e gli elementi che non conosce", () => {
    const diagram = read([
      element("rectangle", "a", { roughness: 1, link: "https://excalidraw.com" }),
      element("ellipse", "b", { roughness: 2 }),
      text("t", "a mano", { roughness: 1, fontFamily: 1 }),
      element("embeddable", "e", { link: "https://www.youtube.com/watch?v=x" }),
      element("laser", "l"),
    ]);
    expect(diagram.notes).toEqual([
      { kind: "link", count: 1, sample: "https://excalidraw.com" },
      { kind: "hand-font", count: 1, sample: "Virgil" },
      { kind: "embed", count: 1, sample: "https://www.youtube.com/watch?v=x" },
      { kind: "unknown", count: 1, sample: "laser" },
      // Le forme e le linee; il testo ha la sua nota.
      { kind: "rough", count: 2, sample: "" },
    ]);
  });
});
