import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { MAX_BOARDS, MAX_EDIT_BYTES } from "../scene/read";
import { utf8Length } from "../scene/text";
import { dataUri, type Decoded } from "../tools/images";
import { TEXT_FAMILY } from "../tools/text";
import type { Diagram, ImageNode, Node } from "./diagram";
import type { Pictures } from "./images";
import { countOf, fontsOf, ImportError, readDiagram, writeImported } from "./index";
import { testSetup } from "./test-support";

/// I byte di un testo in UTF-8.
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/// Una scena di Excalidraw con un rettangolo, o con gli elementi `elements`.
const excalidraw = (elements: readonly object[] = [{ type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], roundness: null, isDeleted: false, locked: false, link: null, boundElements: null }]): string =>
  JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {}, files: {} });

/// Un modello di draw.io con una forma, o con le celle `cells`.
const model = (cells = '<mxCell id="a" value="" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>'): string =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;

/// Un file di draw.io con una pagina.
const mxfile = (inner = model()): string => `<mxfile host="app.diagrams.net"><diagram name="Pagina" id="p">${inner}</diagram></mxfile>`;

/// Un PNG coi pezzi `chunks`, senza CRC: chi legge non li controlla.
function png(...chunks: (readonly [type: string, data: string])[]): Uint8Array {
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [type, data] of [...chunks, ["IEND", ""] as const]) {
    out.push(data.length >>> 24, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff);
    for (const c of type + data) out.push(c.charCodeAt(0));
    out.push(0, 0, 0, 0);
  }
  return Uint8Array.from(out);
}

/// Il perché per cui `name` coi byte `bytes` non si importa.
async function reasonOf(name: string, bytes: Uint8Array): Promise<string> {
  try {
    await readDiagram(name, bytes);
    return "si importa";
  } catch (error) {
    if (error instanceof ImportError) return `${error.reason}: ${error.message}`;
    throw error;
  }
}

describe("readDiagram", () => {
  it("riconosce il programma dal contenuto, qualunque sia il nome", async () => {
    expect((await readDiagram("appunti.txt", utf8(`  ${excalidraw()}`))).source).toBe("excalidraw");
    expect((await readDiagram("appunti.txt", utf8(JSON.stringify({ type: "excalidraw/clipboard", elements: JSON.parse(excalidraw()).elements })))).source).toBe("excalidraw");
    expect((await readDiagram("schema.xml", utf8(`<?xml version="1.0"?>\n<!-- da draw.io -->\n${mxfile()}`))).source).toBe("drawio");
    expect((await readDiagram("modello", utf8(model()))).source).toBe("drawio");
    // Un SVG esportato da draw.io col file dentro.
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" content="${mxfile().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}"><g/></svg>`;
    expect((await readDiagram("schema.svg", utf8(svg))).source).toBe("drawio");
    // Un PNG esportato da draw.io col file in un pezzo di testo.
    expect((await readDiagram("schema.png", png(["tEXt", `mxfile\0${encodeURIComponent(mxfile())}`]))).source).toBe("drawio");
  });

  it("se il contenuto non dice niente, si fida del nome", async () => {
    expect(await reasonOf("schema.drawio", utf8("non è XML"))).toMatch(/^format: /);
    expect(await reasonOf("scena.excalidraw", utf8("{}"))).toMatch(/^format: /);
  });

  it("dice perché un file non si importa: non è dei due programmi, o è vuoto", async () => {
    expect(await reasonOf("note.txt", utf8("ciao"))).toBe("format: il file non è di Excalidraw né di draw.io");
    expect(await reasonOf("foto.png", png(["tEXt", "Software\0draw.io"]))).toBe("format: il file non è di Excalidraw né di draw.io");
    expect(await reasonOf("vuoto.excalidraw", utf8(excalidraw([])))).toBe("empty: il file non ha niente da disegnare");
    expect(await reasonOf("vuoto.drawio", utf8(mxfile(model(""))))).toBe("empty: il file non ha niente da disegnare");
  });

  it("una cornice sola di Excalidraw è una tavola, e si importa", async () => {
    const frame = { ...JSON.parse(excalidraw()).elements[0], type: "frame", id: "f", name: "Tavola" };
    const diagram = await readDiagram("cornice.excalidraw", utf8(excalidraw([frame])));
    expect([countOf(diagram).objects, diagram.boards.map((board) => board.name)]).toEqual([0, ["Tavola"]]);
  });
});

/// Un'immagine nel riquadro di 100 × 100.
const image = (href: string): ImageNode => ({ type: "image", key: "", locked: false, spin: null, href, box: { min: [0, 0], max: [100, 100] }, opacity: 1, crop: null, flip: null });

const diagramOf = (layers: readonly (readonly Node[])[], boards = 0): Diagram => ({
  source: "drawio",
  background: null,
  layers: layers.map((nodes) => ({ name: "", hidden: false, locked: false, nodes })),
  boards: Array.from({ length: boards }, (_, i) => ({ name: `T${i}`, box: { min: [i * 200, 0], max: [i * 200 + 100, 100] } })),
  notes: [],
});

describe("countOf", () => {
  it("conta gli oggetti per genere, dentro i gruppi e senza i gruppi", async () => {
    const diagram = await readDiagram(
      "tutto.excalidraw",
      utf8(
        excalidraw([
          ...JSON.parse(excalidraw()).elements.map((element: object) => ({ ...element, groupIds: ["g"] })),
          { ...JSON.parse(excalidraw()).elements[0], id: "t", type: "text", text: "ciao", originalText: "ciao", fontSize: 20, fontFamily: 2, textAlign: "left", verticalAlign: "top", lineHeight: 1.25, containerId: null, groupIds: ["g"] },
          { ...JSON.parse(excalidraw()).elements[0], id: "l", type: "line", points: [[0, 0], [100, 0]] },
          { ...JSON.parse(excalidraw()).elements[0], id: "i", type: "freedraw", points: [[0, 0], [10, 10], [20, 0]], pressures: [], simulatePressure: true },
        ]),
      ),
    );
    expect(countOf(diagram)).toEqual({ objects: 4, shapes: 1, texts: 1, lines: 1, ink: 1, images: 0, layers: 1, boards: 0 });
    // Un diagramma senza livelli ne ha comunque uno.
    expect(countOf(diagramOf([], 2))).toEqual({ objects: 0, shapes: 0, texts: 0, lines: 0, ink: 0, images: 0, layers: 1, boards: 2 });
  });
});

describe("fontsOf", () => {
  it("dà ogni carattere dei testi una volta, coi pezzi in grassetto o in corsivo", async () => {
    const label = (text: string, extra = ""): string => `<mxCell id="${text}" value="${text}" style="html=1;${extra}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>`;
    const diagram = await readDiagram(
      "testi.drawio",
      utf8(model(label("uno") + label("due", "fontFamily=Courier New;fontSize=20;") + label("tre", "fontStyle=1;") + label("&lt;i&gt;quattro&lt;/i&gt;") + label("cinque"))),
    );
    expect(fontsOf(diagram).map((font) => `${font.family} ${font.weight} ${font.style} ${font.size}`)).toEqual([
      `${TEXT_FAMILY} normal normal 12`,
      "JetBrains Mono, monospace normal normal 20",
      `${TEXT_FAMILY} bold normal 12`,
      `${TEXT_FAMILY} normal italic 12`,
    ]);
  });
});

describe("writeImported", () => {
  it("scrive il disegno col conto e le note", async () => {
    const diagram = await readDiagram("schema.drawio", utf8(mxfile()));
    const imported = await writeImported(diagram, testSetup("schema"), null);
    expect(imported.text).toContain("<title>schema</title>");
    expect(imported.count).toEqual(countOf(diagram));
    expect(imported.notes).toEqual(diagram.notes);
  });

  it("se il disegno passa la misura di un disegno modificabile, rimpicciolisce le immagini quanto basta", async () => {
    // Quattro PNG da 4 MiB: in base64 passano i 20 MiB.
    const big = new Uint8Array(4 * 1024 * 1024);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const href = dataUri("image/png", big);
    expect(4 * href.length).toBeGreaterThan(MAX_EDIT_BYTES);
    expect(big.length).toBeLessThan(MAX_IMAGE_BYTES);
    const calls: string[] = [];
    const pictures: Pictures = {
      codec: {
        async decode(): Promise<Decoded | null> {
          return {
            width: 2000,
            height: 2000,
            opaque: () => true,
            async encode(type, scale) {
              calls.push(type);
              return new Uint8Array(Math.round(big.length * scale * scale));
            },
            close() {},
          };
        },
      },
      svg: async () => null,
    };
    // Ogni immagine diversa, perché si preparino una per una.
    const hrefs = [0, 1, 2, 3].map((i) => href.slice(0, -8) + "AAAAAAA" + "ABCD"[i]);
    const imported = await writeImported(diagramOf([hrefs.map(image)]), testSetup("pesante"), pictures);
    expect(utf8Length(imported.text)).toBeLessThanOrEqual(MAX_EDIT_BYTES);
    expect(imported.count.images).toBe(4);
    expect(imported.notes).toEqual([{ kind: "reduced", count: 4, sample: "" }]);
    expect(new Set(calls)).toEqual(new Set(["image/jpeg"]));
    // Senza browser non si rimpiccioliscono, e il disegno non ci sta.
    await expect(writeImported(diagramOf([hrefs.map(image)]), testSetup("pesante"), null)).rejects.toMatchObject({ reason: "large" });
  }, 60_000);

  it("se con le ombre il disegno non sta nella misura, lascia fuori le ombre e lo dice", async () => {
    const cells = Array.from({ length: 20 }, (_, i) => `<mxCell id="s${i}" value="" style="shadow=1;" vertex="1" parent="1"><mxGeometry x="${i * 120}" y="0" width="100" height="50" as="geometry"/></mxCell>`).join("");
    const shapes = (await readDiagram("ombre.drawio", utf8(model(cells)))).layers[0]!.nodes;
    /// Quattro PNG diversi di `bytes` byte.
    const hrefs = (bytes: number): string[] =>
      [0, 1, 2, 3].map((i) => {
        const raw = new Uint8Array(bytes);
        raw.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        raw[bytes - 1] = i + 1;
        return dataUri("image/png", raw);
      });
    const of = (bytes: number): Diagram => diagramOf([[...shapes, ...hrefs(bytes).map(image)]]);
    // Il disegno con le immagini piccole, con le ombre e senza, dice quanto
    // pesano le ombre; le immagini grandi lasciano posto per metà di loro.
    const small = hrefs(12);
    const plain = (await writeImported(diagramOf([[...shapes.map((node) => (node.type === "shape" ? { ...node, look: { ...node.look, shadow: false } } : node)), ...small.map(image)]]), testSetup("ombre"), null)).text;
    const shaded = (await writeImported(of(12), testSetup("ombre"), null)).text;
    const shadows = utf8Length(shaded) - utf8Length(plain);
    expect(shadows).toBeGreaterThan(20 * 200);
    const room = MAX_EDIT_BYTES - utf8Length(plain) - shadows / 2;
    const bytes = Math.floor(((room / 4 + small[0]!.length - "data:image/png;base64,".length) * 3) / 4);
    const imported = await writeImported(of(bytes), testSetup("ombre"), null);
    expect(utf8Length(imported.text)).toBeLessThanOrEqual(MAX_EDIT_BYTES);
    expect(utf8Length(imported.text)).toBeGreaterThan(MAX_EDIT_BYTES - shadows);
    expect(imported.text).not.toContain("fub:effect");
    expect(imported.notes).toEqual([{ kind: "shadow", count: 20, sample: "" }]);
  }, 60_000);

  it("un diagramma con più tavole di quante un disegno ne tiene non si importa", async () => {
    const shape = (await readDiagram("schema.drawio", utf8(mxfile()))).layers[0]!.nodes;
    const error = await writeImported(diagramOf([shape], MAX_BOARDS + 1), testSetup("tavole"), null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).reason).toBe("large");
  });
});
