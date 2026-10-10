import { describe, expect, it } from "vitest";
import { TEXT_FAMILY } from "../tools/text";
import type { Diagram, GroupNode, ImageNode, LineNode, Node, PathNode, ShapeNode, TextNode } from "./diagram";
import { drawioInPng, NotDrawio, readDrawio } from "./drawio";

// I file delle prove, scritti come li scrive draw.io: un modello con la
// radice, il livello di partenza e le celle.

/// `text` dentro un attributo XML.
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/// Un modello con le celle `cells` nel livello di partenza.
const model = (cells: string, attrs = ""): string => `<mxGraphModel${attrs}><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;

/// Una forma `id` nel riquadro `x`, `y`, `w`, `h`, relativo al genitore.
function vertex(id: string, style: string, [x, y, w, h]: readonly [number, number, number, number], value = "", parent = "1"): string {
  return `<mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

/// Un arco `id` da `source` a `target`, con la geometria `inner`.
function edge(id: string, style: string, source: string | null, target: string | null, inner = "", value = ""): string {
  const ends = `${source === null ? "" : ` source="${source}"`}${target === null ? "" : ` target="${target}"`}`;
  return `<mxCell id="${id}" value="${esc(value)}" style="${esc(style)}" edge="1" parent="1"${ends}><mxGeometry relative="1" as="geometry">${inner}</mxGeometry></mxCell>`;
}

/// Un punto della geometria di un arco.
const point = (as: string, x: number, y: number): string => `<mxPoint x="${x}" y="${y}" as="${as}"/>`;

/// I punti di passaggio di un arco.
const via = (...points: (readonly [number, number])[]): string => `<Array as="points">${points.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>`;

/// I nodi del primo livello.
const top = (diagram: Diagram): readonly Node[] => diagram.layers[0]?.nodes ?? [];

/// Il nodo con la chiave `key`, a qualunque profondità.
function find(diagram: Diagram, key: string): Node {
  const walk = (nodes: readonly Node[]): Node | null => {
    for (const node of nodes) {
      if (node.key === key) return node;
      if (node.type === "group") {
        const inner = walk(node.children);
        if (inner !== null) return inner;
      }
    }
    return null;
  };
  const found = diagram.layers.map((layer) => walk(layer.nodes)).find((node) => node !== null);
  if (found === undefined || found === null) throw new Error(`manca ${key}`);
  return found;
}

/// Il gruppo che contiene il nodo `key`.
function groupOf(diagram: Diagram, key: string): GroupNode {
  const walk = (nodes: readonly Node[]): GroupNode | null => {
    for (const node of nodes) {
      if (node.type !== "group") continue;
      if (node.children.some((child) => child.key === key)) return node;
      const inner = walk(node.children);
      if (inner !== null) return inner;
    }
    return null;
  };
  const found = diagram.layers.map((layer) => walk(layer.nodes)).find((node) => node !== null);
  if (found === undefined || found === null) throw new Error(`nessun gruppo ha ${key}`);
  return found;
}

/// Le parole di un testo.
const words = (node: TextNode): string[] => node.content.paragraphs.map((runs) => runs.map((run) => run.text).join(""));

/// Il carattere di partenza di draw.io, in FubDraw.
const TYPE = { family: TEXT_FAMILY, size: 12, color: "#000000", bold: false, italic: false, underline: false, strike: false };

/// `bytes` compressi dal `CompressionStream` della piattaforma.
async function compressed(bytes: Uint8Array<ArrayBuffer>, format: "deflate" | "deflate-raw"): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

describe("il file", () => {
  it("mette le pagine l'una accanto all'altra, ognuna una tavola, e apre quelle compresse", async () => {
    const first = model(vertex("a", "", [10, 10, 100, 50], "Uno"), ' pageWidth="850" pageHeight="1100" background="#FFF2CC"');
    const second = model(vertex("b", "", [0, 0, 40, 40], "Due"), ' page="0"');
    const packed = base64(await compressed(new TextEncoder().encode(encodeURIComponent(second)), "deflate-raw"));
    const file = `<mxfile><diagram name="Prima" id="p1">${first}</diagram><diagram name="Vuota" id="p2"></diagram><diagram name="Seconda" id="p3">${packed}</diagram></mxfile>`;
    const diagram = readDrawio(file);
    expect(diagram.source).toBe("drawio");
    expect(diagram.background).toBe("#fff2cc");
    // Il foglio della prima pagina; la seconda non ne ha, e la sua tavola è
    // il disegno con un margine.
    expect(diagram.boards).toEqual([
      { name: "Prima", box: { min: [0, 0], max: [850, 1100] } },
      { name: "Seconda", box: { min: [930, 0], max: [1050, 120] } },
    ]);
    expect((find(diagram, "0:a") as ShapeNode).box).toEqual({ min: [10, 10], max: [110, 60] });
    expect((find(diagram, "1:b") as ShapeNode).box).toEqual({ min: [970, 40], max: [1010, 80] });
    expect(diagram.layers).toHaveLength(1);
  });

  it("legge un modello solo, senza tavole, e la carta bianca non è un colore", () => {
    const diagram = readDrawio(model(vertex("a", "", [0, 0, 10, 10]), ' background="#FFFFFF"'));
    expect(diagram.boards).toEqual([]);
    expect(diagram.background).toBeNull();
    expect(top(diagram).map((node) => node.key)).toEqual(["a"]);
  });

  it("tiene i livelli coi loro nomi, nascosti e bloccati", () => {
    const diagram = readDrawio(
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" value="Sfondo" parent="0"/><mxCell id="2" value="Note" style="locked=1;" parent="0" visible="0"/>${vertex("a", "", [0, 0, 10, 10])}${vertex("b", "", [20, 0, 10, 10], "", "2")}</root></mxGraphModel>`,
    );
    expect(diagram.layers.map(({ name, hidden, locked, nodes }) => [name, hidden, locked, nodes.map((node) => node.key)])).toEqual([
      ["Sfondo", false, false, ["a"]],
      ["Note", true, true, ["b"]],
    ]);
  });

  it("legge il file dentro un SVG di draw.io, e toglie i caratteri che XML non ammette", () => {
    const file = `<mxfile><diagram name="Pagina" id="p">${model(vertex("a", "text;html=1", [0, 0, 80, 20], "a\u0001b"))}</diagram></mxfile>`;
    const diagram = readDrawio(`<svg xmlns="http://www.w3.org/2000/svg" content="${esc(file)}"><g/></svg>`);
    expect(words(find(diagram, "a") as TextNode)).toEqual(["ab"]);
  });

  it("dice perché un file non è di draw.io", () => {
    for (const text of ["ciao", "<html><body/></html>", '<svg xmlns="http://www.w3.org/2000/svg"/>', "<mxfile><diagram>%%%</diagram></mxfile>", "<mxfile><diagram>AAAA</diagram></mxfile>"]) {
      expect(() => readDrawio(text), text).toThrow(NotDrawio);
    }
  });
});

describe("drawioInPng", () => {
  /// Un PNG coi pezzi `chunks`, senza le somme, che il lettore non guarda.
  function png(...chunks: (readonly [type: string, data: Uint8Array])[]): Uint8Array {
    const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (const [type, data] of [["IHDR", new Uint8Array(13)] as const, ...chunks, ["IEND", new Uint8Array()] as const]) {
      parts.push((data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255);
      parts.push(...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
    }
    return new Uint8Array(parts);
  }
  const latin = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
  const xml = model(vertex("a", "", [0, 0, 10, 10]));

  it("trova il file in un pezzo di testo, scritto come URI o compresso", async () => {
    expect(drawioInPng(png(["tEXt", latin(`mxfile\0${encodeURIComponent(xml)}`)]))).toBe(xml);
    const packed = await compressed(new TextEncoder().encode(xml), "deflate");
    expect(drawioInPng(png(["zTXt", new Uint8Array([...latin("mxGraphModel\0\0"), ...packed])]))).toBe(xml);
  });

  it("non trova niente in un PNG senza il file, né in ciò che non è un PNG", () => {
    expect(drawioInPng(png(["tEXt", latin("Software\0draw.io")]))).toBeNull();
    expect(drawioInPng(latin(xml))).toBeNull();
    expect(drawioInPng(png(["zTXt", latin("mxfile\0\0rotto")]))).toBeNull();
  });
});

describe("le forme", () => {
  it("un rettangolo resta un rettangolo, con l'angolo tondo e l'etichetta in mezzo", () => {
    const diagram = readDrawio(model(vertex("a", "rounded=1;whiteSpace=wrap;html=1;arcSize=10;fillColor=#dae8fc;strokeColor=#6c8ebf;", [10, 20, 100, 40], "Ciao")));
    expect(top(diagram)).toEqual([
      {
        type: "shape",
        key: "a",
        locked: false,
        spin: null,
        form: { kind: "rect", corner: 4 },
        box: { min: [10, 20], max: [110, 60] },
        look: { stroke: { color: "#6c8ebf", width: 1, dash: "solid" }, fill: { kind: "color", color: "#dae8fc" }, opacity: 1 },
        label: { type: TYPE, align: "middle", leading: 1.2, paragraphs: [[{ text: "Ciao", type: null }]] },
      },
    ]);
    expect(diagram.notes).toEqual([]);
  });

  it("dà a ogni forma la sua: l'ellisse, la raccolta, i contorni di lati; e un rettangolo a quelle che non ha", () => {
    const diagram = readDrawio(
      model(
        vertex("s", "shape=mxgraph.aws4.lambda_function;fillColor=#ED7100;", [0, 0, 40, 40]) +
          vertex("e", "ellipse;whiteSpace=wrap;", [50, 0, 40, 40]) +
          vertex("r", "rhombus;", [100, 0, 40, 40]) +
          vertex("d", "shape=mxgraph.flowchart.decision;", [150, 0, 40, 40]) +
          vertex("t", "triangle;direction=south;", [200, 0, 40, 20]) +
          vertex("de", "doubleEllipse;", [250, 0, 40, 40]),
      ),
    );
    const form = (key: string) => (find(diagram, key) as ShapeNode).form;
    expect(form("s")).toEqual({ kind: "rect", corner: 0 });
    expect((find(diagram, "s") as ShapeNode).look.fill).toEqual({ kind: "color", color: "#ed7100" });
    expect(form("e")).toEqual({ kind: "ellipse" });
    expect(form("r")).toEqual({ kind: "library", id: "basic-diamond" });
    expect(form("d")).toEqual({ kind: "library", id: "flow-decision" });
    // Il triangolo verso sud: la punta in basso.
    expect(form("t")).toEqual({
      kind: "outline",
      segments: [{ kind: "move", to: [1, 0] }, { kind: "line", to: [0.5, 1] }, { kind: "line", to: [0, 0] }, { kind: "close" }],
    });
    expect(form("de")).toEqual({ kind: "ellipse" });
    expect(diagram.notes).toEqual([{ kind: "stencil", count: 2, sample: "mxgraph.aws4.lambda_function" }]);
  });

  it("traduce il contorno, il tratteggio, la trasparenza e i colori", () => {
    const diagram = readDrawio(
      model(
        vertex("a", "strokeWidth=0;fillColor=none;", [0, 0, 10, 10]) +
          vertex("b", "dashed=1;dashPattern=1 4;", [0, 0, 10, 10]) +
          vertex("c", "dashed=1;dashPattern=8 4 1 4;", [0, 0, 10, 10]) +
          vertex("d", "dashed=1;strokeWidth=3;", [0, 0, 10, 10]) +
          vertex("e", "fillColor=#000000;fillOpacity=50;strokeColor=#FF0000;strokeOpacity=20;opacity=40;", [0, 0, 10, 10]) +
          vertex("f", "fillColor=light-dark(#ff0000, #00ff00);strokeColor=inherit;", [0, 0, 10, 10]),
      ),
    );
    const look = (key: string) => (find(diagram, key) as ShapeNode).look;
    expect(look("a")).toEqual({ stroke: null, fill: null, opacity: 1 });
    expect(look("b").stroke?.dash).toBe("dotted");
    expect(look("c").stroke?.dash).toBe("dashdot");
    expect(look("d").stroke).toEqual({ color: "#000000", width: 3, dash: "dashed" });
    // Il solo riempimento, o il solo contorno, trasparente: sulla carta.
    expect(look("e")).toEqual({ stroke: { color: "#ffcccc", width: 1, dash: "solid" }, fill: { kind: "color", color: "#808080" }, opacity: 0.4 });
    expect(look("f")).toEqual({ stroke: { color: "#000000", width: 1, dash: "solid" }, fill: { kind: "color", color: "#ff0000" }, opacity: 1 });
  });

  it("gira la forma con la sua etichetta", () => {
    const shape = top(readDrawio(model(vertex("a", "rotation=90;", [0, 0, 100, 50], "Su"))))[0] as ShapeNode;
    expect(shape.spin).toEqual({ angle: 90, centre: [50, 25] });
    expect(shape.label).not.toBeNull();
  });

  it("un'immagine incorporata resta, una di fuori diventa una nota e la didascalia resta", () => {
    const diagram = readDrawio(model(vertex("i", "shape=image;image=data:image/png,iVBORw0KGgo=;flipH=1;", [0, 0, 20, 10]) + vertex("j", "image;image=https://example.com/a.png;", [30, 0, 20, 10], "Foto")));
    expect(find(diagram, "i")).toEqual({
      type: "image",
      key: "i",
      locked: false,
      spin: null,
      href: "data:image/png;base64,iVBORw0KGgo=",
      box: { min: [0, 0], max: [20, 10] },
      opacity: 1,
      crop: null,
      flip: { x: true, y: false, centre: [10, 5] },
    });
    expect(find(diagram, "j").type).toBe("text");
    expect(diagram.notes).toEqual([{ kind: "image", count: 1, sample: "https://example.com/a.png" }]);
  });

  it("non legge le celle nascoste", () => {
    const diagram = readDrawio(model(vertex("a", "", [0, 0, 10, 10]).replace('vertex="1"', 'vertex="1" visible="0"') + vertex("b", "", [0, 0, 10, 10])));
    expect(top(diagram).map((node) => node.key)).toEqual(["b"]);
  });
});

describe("i testi", () => {
  it("un testo senza forma resta un testo, col suo carattere e dove lo mette draw.io", () => {
    const diagram = readDrawio(model(vertex("x", "text;html=1;fontStyle=3;fontFamily=Courier New;fontSize=14;fontColor=#333333;", [0, 0, 80, 40], "uno<br>due")));
    expect(top(diagram)).toEqual([
      {
        type: "text",
        key: "x",
        locked: false,
        spin: null,
        at: [2, 16],
        width: null,
        frame: { top: 2, bottom: 38, align: "top" },
        content: {
          type: { family: "JetBrains Mono, monospace", size: 14, color: "#333333", bold: true, italic: true, underline: false, strike: false },
          align: "start",
          leading: 1.2,
          paragraphs: [[{ text: "uno", type: null }], [{ text: "due", type: null }]],
        },
        opacity: 1,
      },
    ]);
  });

  it("un carattere a mano diventa Inter e lo dice, una volta per testo; quelli con le grazie diventano Literata", () => {
    const diagram = readDrawio(model(vertex("a", "text;html=1;fontFamily=Comic Sans MS;", [0, 0, 80, 20], "a") + vertex("b", "text;fontFamily=Georgia;", [0, 0, 80, 20], "b")));
    expect((find(diagram, "a") as TextNode).content.type.family).toBe(TEXT_FAMILY);
    expect((find(diagram, "b") as TextNode).content.type.family).toBe("Literata, serif");
    expect(diagram.notes).toEqual([{ kind: "hand-font", count: 1, sample: "Comic Sans MS" }]);
  });

  it("un testo sotto la forma resta sotto, in un gruppo con lei", () => {
    const diagram = readDrawio(model(vertex("o", "verticalLabelPosition=bottom;verticalAlign=top;html=1;", [0, 0, 40, 40], "Sotto")));
    const group = top(diagram)[0] as GroupNode;
    expect(group.type).toBe("group");
    expect(group.children.map((child) => [child.type, child.key])).toEqual([
      ["shape", "o"],
      ["text", ""],
    ]);
    expect((group.children[0] as ShapeNode).label).toBeNull();
    const text = group.children[1] as TextNode;
    expect([text.at, text.frame]).toEqual([[20, 54], { top: 42, bottom: 78, align: "top" }]);
  });

  it("un testo con una riga orizzontale va a capo nella forma, e tiene la riga", () => {
    const group = top(readDrawio(model(vertex("a", "html=1;", [0, 0, 100, 60], "uno<hr>due"))))[0] as GroupNode;
    const text = group.children[1] as TextNode;
    expect(text.width).toBe(96);
    expect(words(text)).toEqual(["uno", "", "due"]);
    expect(text.content.rules).toEqual([{ paragraph: 1, color: "#808080", width: 1 }]);
  });

  it("una tabella HTML diventa le sue celle, col fondo, il bordo e il testo", () => {
    const group = top(readDrawio(model(vertex("a", "html=1;", [0, 0, 100, 40], '<table border="1"><tr><td>a</td><td>b</td></tr></table>'))))[0] as GroupNode;
    expect(group.children.map((child) => child.type)).toEqual(["shape", "shape", "shape", "text", "shape", "text"]);
    expect(group.children.filter((child): child is TextNode => child.type === "text").map(words)).toEqual([["a"], ["b"]]);
  });

  it("riempie i segnaposto coi campi dell'oggetto, e lascia quelli che non trova", () => {
    const diagram = readDrawio(
      model(
        `<object id="p" label="%nome% e %manca%" nome="Fub" placeholders="1" link="https://fub.example"><mxCell style="text;html=1;" vertex="1" parent="1"><mxGeometry width="80" height="20" as="geometry"/></mxCell></object>`,
      ),
    );
    expect(words(find(diagram, "p") as TextNode)).toEqual(["Fub e %manca%"]);
    expect(diagram.notes).toEqual([
      { kind: "link", count: 1, sample: "https://fub.example" },
      { kind: "placeholder", count: 1, sample: "%manca%" },
    ]);
  });

  it("annota il tratto a mano e la sfumatura", () => {
    const diagram = readDrawio(model(vertex("a", "sketch=1;shadow=1;gradientColor=#ffffff;", [0, 0, 10, 10]) + vertex("b", "shadow=1;", [0, 0, 10, 10])));
    expect(diagram.notes).toEqual([
      { kind: "rough", count: 1, sample: "" },
      { kind: "fill", count: 1, sample: "gradient" },
    ]);
  });

  it("dà l'ombra al disegno della cella, quella del testo all'etichetta, e quella della pagina a tutto", () => {
    const cells =
      vertex("a", "shadow=1;", [0, 0, 40, 20], "con ombra") +
      vertex("b", "textShadow=1;", [100, 0, 40, 20], "testo") +
      vertex("c", "shadow=1;fillColor=none;strokeColor=none;", [200, 0, 40, 20]) +
      vertex("d", "text;shadow=1;", [300, 0, 40, 20], "scritta") +
      edge("e", "shadow=1;", "a", "b", "", "via") +
      edge("f", "", "c", "a");
    const own = readDrawio(model(cells));
    const shape = (id: string): ShapeNode => find(own, id) as ShapeNode;
    expect([shape("a").look.shadow, shape("a").label?.shadow]).toEqual([true, undefined]);
    expect([shape("b").look.shadow, shape("b").label?.shadow]).toEqual([undefined, true]);
    // Una cella che non disegna niente, e c'è per un arco, non getta niente.
    expect(shape("c").look.shadow).toBeUndefined();
    expect((find(own, "d") as TextNode).content.shadow).toBeUndefined();
    const line = find(own, "e") as LineNode;
    expect([line.look.shadow, line.labels[0]?.content.shadow]).toEqual([true, undefined]);
    const page = readDrawio(model(cells, ' shadow="1"'));
    expect([(find(page, "a") as ShapeNode).label?.shadow, (find(page, "d") as TextNode).content.shadow, (find(page, "e") as LineNode).labels[0]?.content.shadow]).toEqual([true, true, true]);
  });

  it("dà l'ombra alle immagini che la chiedono", () => {
    const png = "data:image/png,iVBORw0KGgo";
    const diagram = readDrawio(model(vertex("i", `shape=image;image=${png};shadow=1;`, [0, 0, 20, 20]) + vertex("j", `shape=image;image=${png};`, [40, 0, 20, 20])));
    const images = top(diagram).filter((node): node is ImageNode => node.type === "image");
    expect(images.map((image) => image.shadow)).toEqual([true, undefined]);
  });
});

describe("i contenitori", () => {
  it("una corsia è il riquadro, la testata col titolo e ciò che contiene", () => {
    const diagram = readDrawio(model(vertex("s", "swimlane;whiteSpace=wrap;html=1;startSize=30;fillColor=#dae8fc;", [0, 0, 200, 100], "Corsia") + vertex("k", "", [20, 40, 60, 30], "", "s")));
    const group = top(diagram)[0] as GroupNode;
    const [whole, header, inside] = group.children as [ShapeNode, ShapeNode, ShapeNode];
    expect([whole.key, whole.box, whole.look.fill]).toEqual(["s", { min: [0, 0], max: [200, 100] }, null]);
    expect([header.key, header.box, header.look.fill, header.label?.type.bold, header.label?.paragraphs]).toEqual(["", { min: [0, 0], max: [200, 30] }, { kind: "color", color: "#dae8fc" }, true, [[{ text: "Corsia", type: null }]]]);
    expect([inside.key, inside.box]).toEqual(["k", { min: [20, 40], max: [80, 70] }]);
  });

  it("un contenitore chiuso non mostra ciò che contiene", () => {
    const diagram = readDrawio(model(vertex("s", "swimlane;startSize=30;", [0, 0, 200, 100], "Corsia").replace('vertex="1"', 'vertex="1" collapsed="1"') + vertex("k", "", [20, 40, 60, 30], "", "s")));
    expect(() => find(diagram, "k")).toThrow();
  });

  it("un gruppo che non disegna niente e tiene una forma sola è quella forma", () => {
    const diagram = readDrawio(model(vertex("g", "group", [0, 0, 100, 100]) + vertex("x", "", [10, 10, 20, 20], "", "g")));
    expect(top(diagram).map((node) => [node.type, node.key])).toEqual([["shape", "x"]]);
  });

  it("una tabella di celle ha le righe fra righe e colonne", () => {
    const row = "shape=tableRow;horizontal=0;startSize=0;top=0;left=0;bottom=0;right=0;collapsible=0;fillColor=none;";
    const cell = "shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;";
    const diagram = readDrawio(
      model(
        vertex("t", "shape=table;startSize=0;container=1;fillColor=none;", [0, 400, 200, 60]) +
          vertex("r1", row, [0, 0, 200, 30], "", "t") +
          vertex("c1", cell, [0, 0, 100, 30], "id", "r1") +
          vertex("c2", cell, [100, 0, 100, 30], "int", "r1") +
          vertex("r2", row, [0, 30, 200, 30], "", "t") +
          vertex("c3", cell, [0, 0, 100, 30], "nome", "r2") +
          vertex("c4", cell, [100, 0, 100, 30], "text", "r2"),
      ),
    );
    const lines = groupOf(diagram, "t").children.filter((child): child is PathNode => child.type === "path");
    expect(lines.map((line) => line.points)).toEqual([
      [
        [0, 430],
        [200, 430],
      ],
      [
        [100, 400],
        [100, 460],
      ],
    ]);
    expect(words(find(diagram, "c3") as TextNode)).toEqual(["nome"]);
  });
});

describe("gli agganci", () => {
  it("gli archi prendono il riquadro dell'omino e della linea di vita, e il contorno col nome della cella", () => {
    const diagram = readDrawio(
      model(
        vertex("u", "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;", [0, 0, 30, 60], "Utente") +
          vertex("l", "shape=umlLifeline;perimeter=lifelinePerimeter;size=40;html=1;", [200, 0, 100, 300], "Oggetto") +
          vertex("n", "text;html=1;", [0, 200, 60, 20], "Nota") +
          vertex("o", "verticalLabelPosition=bottom;verticalAlign=top;html=1;", [100, 200, 40, 40], "Sotto") +
          edge("e1", "", "u", "l") +
          edge("e2", "", "n", "o"),
      ),
    );
    const invisible = { form: { kind: "rect", corner: 0 }, look: { stroke: null, fill: null, opacity: 1 }, label: null };
    expect(find(diagram, "u")).toEqual({ type: "shape", key: "u", locked: false, spin: null, box: { min: [0, 0], max: [30, 60] }, ...invisible, name: "Utente" });
    expect(find(diagram, "l")).toEqual({ type: "shape", key: "l", locked: false, spin: null, box: { min: [200, 0], max: [300, 300] }, ...invisible, name: "Oggetto" });
    expect(find(diagram, "n")).toEqual({ type: "shape", key: "n", locked: false, spin: null, box: { min: [0, 200], max: [60, 220] }, ...invisible, name: "Nota" });
    // Il contorno della forma, senza etichetta dentro, prende le parole del
    // testo accanto.
    const outline = find(diagram, "o") as ShapeNode;
    expect([outline.look.fill, outline.name]).toEqual([{ kind: "color", color: "#ffffff" }, "Sotto"]);
    const [e1, e2] = [find(diagram, "e1") as LineNode, find(diagram, "e2") as LineNode];
    expect([e1.from, e1.to, e2.from, e2.to].map((hook) => ("node" in hook ? hook.node : null))).toEqual(["u", "l", "n", "o"]);
  });

  it("una riga di tabella agganciata prende il nome dalle sue celle", () => {
    const row = "shape=tableRow;horizontal=0;startSize=0;top=0;left=0;bottom=0;right=0;collapsible=0;fillColor=none;";
    const cell = "shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;";
    const diagram = readDrawio(
      model(
        vertex("t", "shape=table;startSize=0;container=1;fillColor=none;", [0, 0, 200, 30]) +
          vertex("r1", row, [0, 0, 200, 30], "", "t") +
          vertex("c1", cell, [0, 0, 100, 30], "id", "r1") +
          vertex("c2", cell, [100, 0, 100, 30], "int", "r1") +
          vertex("x", "", [300, 0, 40, 30], "X") +
          edge("e", "", "x", "r1"),
      ),
    );
    expect(find(diagram, "r1")).toMatchObject({ type: "shape", box: { min: [0, 0], max: [200, 30] }, look: { stroke: null, fill: null }, name: "id int" });
  });
});

describe("gli archi", () => {
  const A = vertex("a", "whiteSpace=wrap;html=1;", [0, 0, 100, 50], "A");
  const B = vertex("b", "whiteSpace=wrap;html=1;", [200, 0, 100, 50], "B");
  const C = vertex("c", "whiteSpace=wrap;html=1;", [200, 100, 100, 50], "C");
  const E = vertex("e", "ellipse;whiteSpace=wrap;html=1;", [200, 100, 100, 50], "E");

  it("un arco fra due forme è un connettore agganciato, con la punta e le etichette lungo la linea", () => {
    const label = `<mxCell id="l1" value="uno" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1"><mxGeometry x="-0.5" relative="1" as="geometry"/></mxCell>`;
    const diagram = readDrawio(model(A + B + edge("e1", "edgeStyle=none;html=1;", "a", "b", "", "va") + label));
    expect(find(diagram, "e1")).toEqual({
      type: "line",
      key: "e1",
      locked: false,
      spin: null,
      kind: "straight",
      from: { node: "a", anchor: "auto", at: [50, 25] },
      to: { node: "b", anchor: "auto", at: [250, 25] },
      look: { stroke: { color: "#000000", width: 1, dash: "solid" }, fill: null, opacity: 1 },
      start: null,
      end: { shape: "triangle", size: "medium" },
      labels: [
        { content: { type: { ...TYPE, size: 11 }, align: "middle", leading: 1.2, paragraphs: [[{ text: "va", type: null }]] }, t: 0.5 },
        { content: { type: { ...TYPE, size: 11 }, align: "start", leading: 1.2, paragraphs: [[{ text: "uno", type: null }]] }, t: 0.25 },
      ],
      route: null,
    });
    expect(diagram.notes).toEqual([]);
  });

  it("porta i punti fissi sul contorno della forma, spostati come dice lo stile", () => {
    const diagram = readDrawio(
      model(
        A +
          E +
          edge("e1", "exitX=1;exitY=0.5;exitDx=10;exitDy=5;entryX=0;entryY=0;endArrow=open;startArrow=oval;startFill=0;startSize=10;", "a", "e") +
          edge("e2", "exitX=1;exitY=0.5;entryX=0;entryY=0;entryPerimeter=0;", "a", "e"),
      ),
    );
    const e1 = find(diagram, "e1") as LineNode;
    expect(e1.from).toMatchObject({ node: "a", anchor: "right" });
    expect(e1.from.at[0]).toBeCloseTo(100);
    expect(e1.from.at[1]).toBeCloseTo(25 + 25 / 6);
    // Sull'ellisse, verso l'angolo del riquadro.
    expect(e1.to).toMatchObject({ node: "e", anchor: "top" });
    expect(e1.to.at[0]).toBeCloseTo(250 - 50 / Math.SQRT2);
    expect(e1.to.at[1]).toBeCloseTo(125 - 25 / Math.SQRT2);
    expect([e1.start, e1.end]).toEqual([
      { shape: "circle", size: "large" },
      { shape: "vee", size: "medium" },
    ]);
    expect((find(diagram, "e2") as LineNode).to.at).toEqual([200, 100]);
    // Il cerchio vuoto, che FubDraw riempie.
    expect(diagram.notes).toEqual([{ kind: "tip", count: 1, sample: "oval" }]);
  });

  it("un arco libero con dei punti resta una linea con le punte; senza punti, un connettore libero", () => {
    const diagram = readDrawio(
      model(
        edge("p", "endArrow=block;endFill=0;html=1;", null, null, point("sourcePoint", 0, 200) + point("targetPoint", 100, 200) + via([50, 250])) +
          edge("q", "endArrow=ERmany;", null, null, point("sourcePoint", 0, 300) + point("targetPoint", 100, 300)),
      ),
    );
    expect(find(diagram, "p")).toEqual({
      type: "path",
      key: "p",
      locked: false,
      spin: null,
      points: [
        [0, 200],
        [50, 250],
        [100, 200],
      ],
      smooth: false,
      closed: false,
      look: { stroke: { color: "#000000", width: 1, dash: "solid" }, fill: null, opacity: 1 },
      start: null,
      end: { shape: "triangle", size: "medium" },
    });
    expect(find(diagram, "q")).toMatchObject({ type: "line", kind: "straight", from: { at: [0, 300] }, to: { at: [100, 300] }, end: null });
    expect(diagram.notes).toEqual([{ kind: "tip", count: 2, sample: "block" }]);
  });

  it("di un arco che non si vede restano le etichette, dove le mette draw.io", () => {
    const diagram = readDrawio(model(A + B + edge("x", "strokeColor=none;", "a", "b", "", "nota")));
    const text = top(diagram).find((node) => node.type === "text") as TextNode;
    expect([text.at[0], text.frame?.align, words(text)]).toEqual([150, "middle", ["nota"]]);
    expect(text.at[1]).toBeCloseTo(25 - 6.6 + 11);
  });

  it("i gomiti di draw.io fanno lo stesso percorso, coi capi sui lati giusti", () => {
    const route = [
      [100, 25],
      [150, 25],
      [150, 125],
      [200, 125],
    ];
    const diagram = readDrawio(
      model(A + C + edge("elbow", "edgeStyle=elbowEdgeStyle;elbow=horizontal;", "a", "c") + edge("entity", "edgeStyle=entityRelationEdgeStyle;", "a", "c") + edge("orthogonal", "edgeStyle=orthogonalEdgeStyle;", "a", "c", via([150, 80])) + edge("drawn", "", "a", "c", via([150, 25], [150, 125]))),
    );
    for (const key of ["elbow", "entity", "orthogonal", "drawn"]) expect(find(diagram, key), key).toMatchObject({ kind: "elbow", route });
    expect(find(diagram, "entity")).toMatchObject({ from: { anchor: "right" }, to: { anchor: "left" } });
    expect(diagram.notes).toEqual([]);
  });

  it("un messaggio di un diagramma di sequenza va dritto; un percorso storto diventa una curva, e la nota lo dice", () => {
    const diagram = readDrawio(model(A + B + C + edge("m", "edgeStyle=sequenceEdgeStyle;", "a", "b") + edge("w", "", "a", "c", via([150, 0]))));
    expect(find(diagram, "m")).toMatchObject({
      kind: "straight",
      route: [
        [100, 25],
        [200, 25],
      ],
    });
    expect(find(diagram, "w")).toMatchObject({ kind: "curved" });
    expect(diagram.notes).toEqual([{ kind: "route", count: 1, sample: "" }]);
  });
});
