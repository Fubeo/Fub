import { describe, expect, it } from "vitest";
import { connectorAttrs } from "../scene/connectors";
import { SceneEngine } from "../scene/engine";
import { MAX_NESTING } from "../scene/ops";
import type { Point } from "../scene/matrix";
import { SourceText } from "../scene/text";
import { parseXml, type XmlDocument } from "../scene/xml";
import { boardsOf } from "../tools/boards";
import type { Content, Diagram, ImageNode, InkNode, Layer, LineNode, Node, ShapeNode, TextNode } from "./diagram";
import { testSetup } from "./test-support";
import { retitled, writeDiagram } from "./write";

// Le prove dello scrittore: un diagramma fatto a mano, e il disegno che ne
// esce letto come XML.

/// Un elemento del disegno scritto: il nome, gli attributi col prefisso, il
/// testo e i figli.
interface Tree {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly Tree[];
}

function treeOf(doc: XmlDocument, id: number): Tree {
  const element = doc.element(id)!;
  let text = "";
  const children: Tree[] = [];
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") text += node.value;
    else if (node.kind === "element") children.push(treeOf(doc, child));
  }
  return { tag: element.local, attrs: Object.fromEntries(element.attrs.map((attr) => [attr.name, attr.value])), text, children };
}

/// Il disegno scritto da `diagram`, come albero e come testo.
function written(diagram: Diagram): { readonly root: Tree; readonly text: string } {
  const text = writeDiagram(diagram, testSetup("Prova"));
  const doc = parseXml(new SourceText(text), false);
  return { root: treeOf(doc, doc.root), text };
}

/// Tutti gli elementi, in ordine.
const all = (tree: Tree): Tree[] => [tree, ...tree.children.flatMap(all)];

/// L'elemento con l'id `id`.
const byId = (root: Tree, id: string): Tree => {
  const found = all(root).find((each) => each.attrs.id === id);
  if (found === undefined) throw new Error(`manca ${id}`);
  return found;
};

/// Il testo di un `text` di FubDraw, riga per riga.
const linesOf = (text: Tree): string[] => (text.children.length === 0 ? [text.text] : text.children.map((line) => line.text));

/// I livelli del disegno.
const layersOf = (root: Tree): Tree[] => root.children.filter((child) => child.attrs["fub:layer"] !== undefined);

/// I rettangoli nei livelli, senza la carta e le risorse.
const rectsOf = (root: Tree): Tree[] => layersOf(root).flatMap(all).filter((each) => each.tag === "rect");

const diagramOf = (nodes: readonly Node[], extra: Partial<Diagram> = {}): Diagram => ({ source: "drawio", background: null, layers: [{ name: "", hidden: false, locked: false, nodes }], boards: [], notes: [], ...extra });

const LOOK = { stroke: { color: "#1e1e1e", width: 2, dash: "solid" as const }, fill: { kind: "color" as const, color: "#ffffff" }, opacity: 1 };

const shape = (key: string, [x, y, w, h]: readonly [number, number, number, number], extra: Partial<ShapeNode> = {}): ShapeNode => ({
  type: "shape",
  key,
  locked: false,
  spin: null,
  form: { kind: "rect", corner: 0 },
  box: { min: [x, y], max: [x + w, y + h] },
  look: LOOK,
  label: null,
  ...extra,
});

const content = (...paragraphs: string[]): Content => ({
  type: { family: "Inter, sans-serif", size: 16, color: "#1e1e1e", bold: false, italic: false, underline: false, strike: false },
  align: "middle",
  leading: 1.25,
  paragraphs: paragraphs.map((text) => (text === "" ? [] : [{ text, type: null }])),
});

describe("writeDiagram", () => {
  it("porta il disegno a 20 dall'angolo, tratto compreso, col titolo, la carta e il primo livello", () => {
    const { root, text } = written(diagramOf([shape("a", [500, 300, 100, 50])], { background: "#fff2cc" }));
    expect(root.children.find((child) => child.tag === "title")?.text).toBe("Prova");
    expect(byId(root, "fub-paper").attrs.fill).toBe("#fff2cc");
    expect(layersOf(root).map((layer) => layer.attrs["fub:layer"])).toEqual(["Livello 1"]);
    const rect = rectsOf(root)[0]!;
    // Il tratto di 2 sporge di 1 dal riquadro.
    expect([rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height]).toEqual(["21", "21", "100", "50"]);
    // Il motore lo legge com'è.
    expect(SceneEngine.open(text).text).toBe(text);
  });

  it("una forma con l'etichetta è un gruppo con la forma e il testo legato a lei", () => {
    const { root } = written(diagramOf([shape("a", [0, 0, 120, 60], { form: { kind: "rect", corner: 8 }, label: content("Ciao") })]));
    const group = layersOf(root)[0]!.children[0]!;
    expect(group.children.map((child) => child.tag)).toEqual(["rect", "text"]);
    const [rect, label] = group.children as [Tree, Tree];
    expect(rect.attrs.rx).toBe("8");
    expect(label.attrs["fub:inside"]).toBe(rect.attrs.id);
    expect(linesOf(label)).toEqual(["Ciao"]);
  });

  it("il nome di una forma diventa il suo titolo, al posto di quello della raccolta", () => {
    const { root } = written(diagramOf([shape("a", [0, 0, 80, 60], { form: { kind: "library", id: "basic-diamond" }, name: "Decisione" }), shape("b", [100, 0, 40, 40], { name: "Porta" })]));
    const titles = all(root)
      .filter((each) => each.children.some((child) => child.tag === "title") && each.attrs["fub:layer"] === undefined && each.tag !== "svg")
      .map((each) => each.children.filter((child) => child.tag === "title").map((child) => child.text));
    expect(titles).toEqual([["Decisione"], ["Porta"]]);
  });

  it("un connettore si aggancia agli oggetti, tiene il percorso del file e porta l'etichetta", () => {
    const route: Point[] = [
      [100, 25],
      [150, 25],
      [150, 125],
      [200, 125],
    ];
    const line: LineNode = {
      type: "line",
      key: "e",
      locked: false,
      spin: null,
      kind: "elbow",
      from: { node: "a", anchor: "right", at: [100, 25] },
      to: { node: "b", anchor: "left", at: [200, 125] },
      look: { stroke: { color: "#1e1e1e", width: 2, dash: "dashed" }, fill: null, opacity: 1 },
      start: null,
      end: { shape: "triangle", size: "medium" },
      labels: [{ content: content("va"), t: 0.5 }],
      route,
    };
    const { root } = written(diagramOf([shape("a", [0, 0, 100, 50]), shape("b", [200, 100, 100, 50]), line]));
    const [a, b] = rectsOf(root);
    const path = all(root).find((each) => each.attrs["fub:shape"] === "connector")!;
    expect([path.attrs["fub:from"], path.attrs["fub:to"]]).toEqual([`${a!.attrs.id} right`, `${b!.attrs.id} left`]);
    // Il percorso del file, spostato col disegno.
    expect(path.attrs.d).toBe(connectorAttrs({ kind: "elbow", points: route.map(([x, y]): Point => [x + 21, y + 21]) }).d);
    expect(path.attrs["stroke-dasharray"]).toBeDefined();
    const tip = /^url\(#(.+)\)$/.exec(path.attrs["marker-end"] ?? "")?.[1];
    expect(byId(root, tip!).tag).toBe("marker");
    const label = all(root).find((each) => each.attrs["fub:along"] !== undefined)!;
    expect([label.attrs["fub:along"]!.split(" ")[0], linesOf(label)]).toEqual([path.attrs.id, ["va"]]);
  });

  it("tiene i livelli coi nomi, nascosti e bloccati, e blocca gli oggetti bloccati", () => {
    const layers: Layer[] = [
      { name: "", hidden: false, locked: false, nodes: [shape("a", [0, 0, 10, 10], { locked: true })] },
      { name: "Note", hidden: true, locked: true, nodes: [shape("b", [20, 0, 10, 10])] },
    ];
    const { root } = written(diagramOf([], { layers }));
    expect(layersOf(root).map((layer) => [layer.attrs["fub:layer"], layer.attrs.display, layer.attrs["fub:locked"]])).toEqual([
      ["Livello 1", undefined, undefined],
      ["Note", "none", "true"],
    ]);
    expect(layersOf(root)[0]!.children[0]!.attrs["fub:locked"]).toBe("true");
  });

  it("fa le tavole del diagramma, coi loro nomi o con quelli di partenza", () => {
    const { text } = written(
      diagramOf([shape("a", [0, 0, 100, 100]), shape("b", [300, 0, 100, 100])], {
        boards: [
          { name: "Uno", box: { min: [-20, -20], max: [120, 120] } },
          { name: "", box: { min: [280, -20], max: [420, 120] } },
        ],
      }),
    );
    const boards = boardsOf(SceneEngine.open(text).model!);
    expect(boards.map((board) => board.name)).toEqual(["Uno", "Tavola 2"]);
    expect(boards.map((board) => [board.box.min, board.box.max])).toEqual([
      [
        [20, 20],
        [160, 160],
      ],
      [
        [320, 20],
        [460, 160],
      ],
    ]);
  });

  it("un testo con le righe orizzontali è un gruppo col testo e le righe", () => {
    const text: TextNode = {
      type: "text",
      key: "t",
      locked: false,
      spin: null,
      at: [0, 16],
      width: 200,
      frame: { top: 0, bottom: 60, align: "top" },
      content: { ...content("uno", "", "due"), align: "start", rules: [{ paragraph: 1, color: "#ff0000", width: 2 }] },
      opacity: 1,
    };
    // Un rettangolo senza tratto nell'angolo del testo dice di quanto il
    // disegno si sposta.
    const corner = shape("c", [0, 0, 10, 10], { look: { stroke: null, fill: { kind: "color", color: "#ffffff" }, opacity: 1 } });
    const { root } = written(diagramOf([corner, text]));
    const [x, y] = [Number(rectsOf(root)[0]!.attrs.x), Number(rectsOf(root)[0]!.attrs.y)];
    const group = layersOf(root)[0]!.children[1]!;
    expect(group.children.map((child) => child.tag)).toEqual(["text", "line"]);
    const rule = group.children[1]!;
    expect([Number(rule.attrs.x1), Number(rule.attrs.x2), rule.attrs.stroke, rule.attrs["stroke-width"]]).toEqual([x, x + 200, "#ff0000", "2"]);
    // A metà della seconda riga.
    expect(Number(rule.attrs.y1)).toBeCloseTo(y + 1.5 * 20);
  });

  it("la campitura diventa una risorsa del disegno, col colore di riserva", () => {
    const { root } = written(diagramOf([shape("a", [0, 0, 100, 50], { look: { ...LOOK, fill: { kind: "hatch", hatch: "lines", color: "#ff0000", background: null, spacing: 8, width: 1 } } })]));
    const fill = rectsOf(root)[0]!.attrs.fill ?? "";
    const id = /^url\(#([^)]+)\) #ff0000$/.exec(fill)?.[1];
    expect(id === undefined ? fill : byId(root, id).tag).toBe("pattern");
  });

  it("il tratto a mano libera è un tratto della Penna, con la pressione", () => {
    const ink: InkNode = {
      type: "ink",
      key: "i",
      locked: false,
      spin: null,
      samples: [
        { x: 0, y: 0, p: 0.2 },
        { x: 10, y: 5, p: 0.8 },
        { x: 20, y: 0, p: 0.5 },
      ],
      size: 8,
      thinning: 0.6,
      simulate: false,
      color: "#e03131",
      opacity: 0.5,
    };
    const { root } = written(diagramOf([ink]));
    const stroke = all(root).find((each) => each.attrs["fub:ink"] !== undefined)!;
    expect([stroke.attrs["fub:tool"], stroke.attrs.fill, stroke.attrs.opacity]).toEqual(["pen", "#e03131", "0.5"]);
    expect(stroke.attrs["fub:brush"]).toMatch(/\bsize=8\b|\b8\b/);
  });

  it("un'immagine ritagliata ha il suo ritaglio, e la pagina va attorno a ciò che si vede", () => {
    const image: ImageNode = {
      type: "image",
      key: "i",
      locked: false,
      spin: null,
      href: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      box: { min: [0, 0], max: [200, 100] },
      opacity: 1,
      crop: { min: [0.25, 0], max: [0.75, 1] },
      flip: null,
    };
    const { root } = written(diagramOf([image]));
    const elem = all(root).find((each) => each.tag === "image")!;
    expect([elem.attrs.x, elem.attrs.y, elem.attrs.width, elem.attrs.height]).toEqual(["-30", "20", "200", "100"]);
    const clip = /^url\(#([^)]+)\)$/.exec(elem.attrs["clip-path"] ?? "")?.[1];
    const rect = byId(root, clip!).children[0]!;
    expect([rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height]).toEqual(["20", "20", "100", "100"]);
  });

  it("l'ombra di draw.io diventa l'effetto Ombra, sul disegno o sul testo che la getta", () => {
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const image = (key: string, x: number, crop: ImageNode["crop"]): ImageNode => ({ type: "image", key, locked: false, spin: null, href: PNG, box: { min: [x, 200], max: [x + 40, 240] }, opacity: 1, crop, flip: null, shadow: true });
    const line: LineNode = {
      type: "line",
      key: "e",
      locked: false,
      spin: null,
      kind: "straight",
      from: { node: "a", anchor: "right", at: [100, 25] },
      to: { node: "b", anchor: "left", at: [200, 25] },
      look: { ...LOOK, fill: null, shadow: true },
      start: null,
      end: null,
      labels: [
        { content: content("piano"), t: 0.3 },
        { content: { ...content("ombra"), shadow: true }, t: 0.7 },
      ],
      route: null,
    };
    const note: TextNode = { type: "text", key: "t", locked: false, spin: null, at: [0, 120], width: null, frame: null, content: { ...content("nota"), shadow: true }, opacity: 1 };
    const { root, text } = written(
      diagramOf([
        shape("a", [0, 0, 100, 50], { look: { ...LOOK, shadow: true }, label: content("forma") }),
        shape("b", [200, 0, 100, 50], { label: { ...content("etichetta"), shadow: true } }),
        line,
        note,
        image("i", 0, null),
        image("j", 100, { min: [0, 0], max: [0.5, 1] }),
      ]),
    );
    const shadowed = all(root).filter((each) => each.attrs["fub:effect"] !== undefined);
    const said = (each: Tree): string => (each.tag === "text" ? linesOf(each).join(" ") : each.tag);
    expect(shadowed.map(said)).toEqual(["rect", "etichetta", "path", "ombra", "nota", "image"]);
    for (const each of shadowed) {
      expect(each.attrs["fub:effect"]).toBe("shadow 3 3 3.4 #3d4574 0.4");
      const filter = byId(root, /^url\(#([^)]+)\)$/.exec(each.attrs.filter ?? "")![1]!);
      expect(filter.tag).toBe("filter");
    }
    // L'immagine ritagliata non prende effetti, e resta senza ombra.
    expect(all(root).filter((each) => each.tag === "image").map((each) => each.attrs["clip-path"] !== undefined)).toEqual([false, true]);
    expect(SceneEngine.open(text).text).toBe(text);
  });

  it("i gruppi troppo annidati lasciano gli oggetti al gruppo che li contiene, e un connettore non si aggancia a un gruppo che non c'è", () => {
    let inner: Node = shape("a", [0, 0, 100, 50], { label: content("Giù") });
    for (let i = 39; i >= 0; i--) inner = { type: "group", key: `g${i}`, locked: false, spin: null, name: `g${i}`, children: [inner] };
    const line = (key: string, from: string): LineNode => ({
      type: "line",
      key,
      locked: false,
      spin: null,
      kind: "straight",
      from: { node: from, anchor: "bottom", at: [50, 50] },
      to: { node: "b", anchor: "left", at: [200, 125] },
      look: { stroke: { color: "#1e1e1e", width: 2, dash: "solid" }, fill: null, opacity: 1 },
      start: null,
      end: null,
      labels: [],
      route: null,
    });
    const { root } = written(diagramOf([inner, shape("b", [200, 100, 100, 50]), line("e1", "g5"), line("e2", "g39")]));
    const layer = layersOf(root)[0]!;
    const depth = (tree: Tree): number => (tree.tag === "g" ? 1 : 0) + Math.max(0, ...tree.children.map(depth));
    expect(depth(layer)).toBeLessThan(MAX_NESTING);
    const titles = all(layer).filter((each) => each.tag === "title").map((each) => each.text);
    expect([titles.includes("g0"), titles.includes("g23"), titles.includes("g24"), titles.includes("g39")]).toEqual([true, true, false, false]);
    // Gli oggetti ci sono tutti.
    expect(rectsOf(root)).toHaveLength(2);
    const group = all(layer).find((each) => each.tag === "g" && each.children[0]?.text === "g5")!;
    const [e1, e2] = all(root).filter((each) => each.attrs["fub:shape"] === "connector");
    expect([e1!.attrs["fub:from"], e2!.attrs["fub:from"]]).toEqual([`${group.attrs.id} bottom`, undefined]);
  });

  it("con gli stessi id, lo stesso diagramma è lo stesso testo", () => {
    const diagram = diagramOf([shape("a", [0, 0, 100, 50], { label: content("Uno") }), shape("b", [200, 0, 100, 50])]);
    expect(written(diagram).text).toBe(written(diagram).text);
  });
});

describe("retitled", () => {
  it("cambia il solo titolo della radice, scritto come lo vuole XML, e il disegno resta lo stesso", () => {
    const diagram = diagramOf([shape("a", [0, 0, 100, 50], { label: content("Uno") })]);
    const text = written(diagram).text;
    const renamed = retitled(text, "Rete & <server> $& 1");
    expect(renamed).toContain("<title>Rete &amp; &lt;server&gt; $&amp; 1</title>");
    expect(renamed.replace(/<title>[^<]*<\/title>/, "<title>Prova</title>")).toBe(text);
    expect(SceneEngine.open(renamed).text).toBe(renamed);
  });
});
