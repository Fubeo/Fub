import { describe, expect, it } from "vitest";
import {
  CANVAS_CLIPBOARD_TYPE,
  CANVAS_CLIPBOARD_VERSION,
  cardsMarkdown,
  clipboardJson,
  copiedCards,
  placedCards,
  readCanvasClipboard,
} from "./clipboard";
import type { CanvasDocument } from "./model";

const INK = { v: 1, strokes: [{ id: "s-1", tool: "pen", brush: "pf1 size=3", color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 }, ink: "1 s100 cxy 100,100 5,5" }] };

function board(): CanvasDocument {
  return {
    nodes: [
      { id: "g", type: "group", x: 0, y: 0, width: 900, height: 600, label: "Corso" },
      { id: "b", type: "text", x: 400, y: 40, width: 240, height: 140, text: "Seconda", "fub:ink": INK, vendor: { keep: 1 } },
      { id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "Prima" },
      { id: "n", type: "file", x: 40, y: 300, width: 240, height: 140, file: "Corsi/Statistica/lezione 1.md", subpath: "#Media" },
      { id: "x", type: "file", x: 400, y: 300, width: 240, height: 140, file: "Corsi/voti.xlsx" },
      { id: "w", type: "link", x: 700, y: 300, width: 240, height: 100, url: "https://example.com" },
    ],
    edges: [
      { id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow", label: "poi", "fub:mine": true },
      { id: "e2", fromNode: "a", toNode: "w" },
    ],
    "fub:ink": { v: 1, strokes: [] },
  };
}

describe("le schede negli appunti (T68)", () => {
  it("la forma: version 1, le schede in ordine di file, i soli fili fra loro, inchiostro e campi sconosciuti com'erano", () => {
    const doc = board();
    const clipboard = copiedCards(doc, ["a", "b", "x", "assente"])!;
    expect(CANVAS_CLIPBOARD_TYPE).toBe("application/x-fub-canvas+json");
    expect(JSON.parse(clipboardJson(clipboard))).toEqual({
      version: 1,
      nodes: [doc.nodes[1], doc.nodes[2], doc.nodes[4]],
      edges: [doc.edges[0]],
    });
    // Le chiavi della radice sono queste tre e basta.
    expect(Object.keys(JSON.parse(clipboardJson(clipboard)))).toEqual(["version", "nodes", "edges"]);
    // Una copia per valore: cambiare gli appunti non tocca la lavagna.
    (clipboard.nodes[0]!["fub:ink"] as { v: number }).v = 9;
    expect(INK.v).toBe(1);
    expect(copiedCards(doc, ["assente"])).toBeNull();
  });

  it("il Markdown: in ordine di lettura, il testo, il link [[…]] di un file, l'indirizzo, il nome del gruppo", () => {
    const doc = board();
    expect(cardsMarkdown(doc.nodes)).toBe([
      "Corso",
      "Prima",
      "Seconda",
      "[[Corsi/Statistica/lezione 1#Media]]",
      "[[Corsi/voti.xlsx]]",
      "https://example.com",
    ].join("\n\n"));
    // Una scheda senza niente da dire non lascia righe vuote.
    expect(cardsMarkdown([{ id: "v", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" }, doc.nodes[2]!])).toBe("Prima");
  });

  it("rilegge la sua forma", () => {
    const clipboard = copiedCards(board(), ["a", "b"])!;
    expect(readCanvasClipboard(clipboardJson(clipboard))).toEqual({ kind: "cards", clipboard: JSON.parse(clipboardJson(clipboard)) });
  });

  it("una versione futura si rifiuta tutta, anche se il resto si leggerebbe", () => {
    const future = JSON.stringify({ version: CANVAS_CLIPBOARD_VERSION + 1, nodes: board().nodes, edges: [], more: {} });
    expect(readCanvasClipboard(future)).toEqual({ kind: "future", version: 2 });
    expect(readCanvasClipboard(JSON.stringify({ version: 7 }))).toEqual({ kind: "future", version: 7 });
  });

  it("un JSON rotto, o una forma che non è quella di Fub, è rotto: si incolla come testo", () => {
    const node = { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x" };
    const broken = [
      "",
      "{\"version\": 1, \"nodes\": [",
      "null",
      "[1, 2]",
      JSON.stringify({ nodes: [node], edges: [] }),
      JSON.stringify({ version: "1", nodes: [node], edges: [] }),
      JSON.stringify({ version: 0, nodes: [node], edges: [] }),
      JSON.stringify({ version: 1.5, nodes: [node], edges: [] }),
      JSON.stringify({ version: 1, nodes: [], edges: [] }),
      JSON.stringify({ version: 1, nodes: [node] }),
      JSON.stringify({ version: 1, nodes: [{ ...node, type: "video" }], edges: [] }),
      JSON.stringify({ version: 1, nodes: [{ ...node, id: "" }], edges: [] }),
      JSON.stringify({ version: 1, nodes: [{ ...node, x: "0" }], edges: [] }),
      JSON.stringify({ version: 1, nodes: [node, node], edges: [] }),
      JSON.stringify({ version: 1, nodes: [node], edges: [{ id: "e", fromNode: "a", toNode: "altrove" }] }),
      JSON.stringify({ version: 1, nodes: [node], edges: [{ id: "e", fromNode: "a", toNode: "a" }, { id: "e", fromNode: "a", toNode: "a" }] }),
    ];
    for (const text of broken) expect(readCanvasClipboard(text), text).toEqual({ kind: "broken" });
  });

  it("incollando: ids nuovi, fili riattaccati, le stesse distanze, l'angolo nel punto, il resto com'era", () => {
    const clipboard = copiedCards(board(), ["a", "b", "w"])!;
    let next = 0;
    const placed = placedCards(clipboard, { x: 1000, y: 2000 }, (prefix) => `${prefix}${++next}`);
    expect(placed.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["n1", 1360, 2000],
      ["n2", 1000, 2000],
      ["n3", 1660, 2260],
    ]);
    expect(placed.nodes[0]).toMatchObject({ text: "Seconda", "fub:ink": INK, vendor: { keep: 1 } });
    expect(placed.edges).toEqual([
      { id: "e4", fromNode: "n2", toNode: "n1", toEnd: "arrow", label: "poi", "fub:mine": true },
      { id: "e5", fromNode: "n2", toNode: "n3" },
    ]);
    // Gli appunti restano come erano: si incollano di nuovo.
    expect(clipboard.nodes[0]!.id).toBe("b");
  });

  it("500 schede: si leggono e si dispongono", () => {
    const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, type: "text" as const, x: (i % 25) * 300, y: Math.floor(i / 25) * 200, width: 280, height: 180, text: `scheda ${i}` }));
    const edges = nodes.slice(1).map((node, i) => ({ id: `e${i}`, fromNode: nodes[i]!.id, toNode: node.id }));
    const clipboard = copiedCards({ nodes, edges }, nodes.map((node) => node.id))!;
    const read = readCanvasClipboard(clipboardJson(clipboard));
    expect(read.kind).toBe("cards");
    if (read.kind !== "cards") return;
    let next = 0;
    const placed = placedCards(read.clipboard, { x: 8, y: 16 }, (prefix) => `${prefix}${++next}`);
    expect(placed.nodes).toHaveLength(500);
    expect(placed.edges).toHaveLength(499);
    expect([placed.nodes[0]!.x, placed.nodes[0]!.y, placed.nodes[499]!.x, placed.nodes[499]!.y]).toEqual([8, 16, 8 + 24 * 300, 16 + 19 * 200]);
  });
});
