import { describe, expect, it } from "vitest";
import {
  CANVAS_CLIPBOARD_TYPE,
  CANVAS_CLIPBOARD_VERSION,
  cardsMarkdown,
  clipboardJson,
  copiedSelection,
  joinedInkPatches,
  pastedInkOps,
  placedSelection,
  readCanvasClipboard,
} from "./clipboard";
import type { CanvasDocument } from "./model";
import type { CanvasPatch } from "./operation";

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
    const clipboard = copiedSelection(doc, ["a", "b", "x", "assente"])!;
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
    expect(copiedSelection(doc, ["assente"])).toBeNull();
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
    const clipboard = copiedSelection(board(), ["a", "b"])!;
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
    const clipboard = copiedSelection(board(), ["a", "b", "w"])!;
    let next = 0;
    const placed = placedSelection(clipboard, { x: 1000, y: 2000 }, (prefix) => `${prefix}${++next}`);
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
    const clipboard = copiedSelection({ nodes, edges }, nodes.map((node) => node.id))!;
    const read = readCanvasClipboard(clipboardJson(clipboard));
    expect(read.kind).toBe("cards");
    if (read.kind !== "cards") return;
    let next = 0;
    const placed = placedSelection(read.clipboard, { x: 8, y: 16 }, (prefix) => `${prefix}${++next}`);
    expect(placed.nodes).toHaveLength(500);
    expect(placed.edges).toHaveLength(499);
    expect([placed.nodes[0]!.x, placed.nodes[0]!.y, placed.nodes[499]!.x, placed.nodes[499]!.y]).toEqual([8, 16, 8 + 24 * 300, 16 + 19 * 200]);
  });
});

describe("i tratti liberi negli appunti (T94)", () => {
  const BRUSH = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
  const free = (id: string, ink: string, more: Record<string, unknown> = {}): Record<string, unknown> & { id: string } =>
    ({ id, tool: "pen", brush: BRUSH, color: "#0072b2", anchor: { kind: "free" }, ink, ...more });
  const F1 = free("f1", "1 s100 cxy 4000,2500 120,40 95,-10", { vendor: { keep: 1 } });
  const F2 = free("f2", "1 s100 cxy 90050,70025 100,0");

  function inked(): CanvasDocument {
    return { ...board(), "fub:ink": { v: 1, strokes: [F1, F2], more: true } };
  }

  it("la forma col campo: i soli tratti scelti, nell'ordine del livello, com'erano, dopo le altre chiavi", () => {
    const doc = inked();
    const clipboard = copiedSelection(doc, ["a"], ["f2", "f1", "assente"])!;
    const json = JSON.parse(clipboardJson(clipboard));
    expect(Object.keys(json)).toEqual(["version", "nodes", "edges", "fub:ink"]);
    expect(json["fub:ink"]).toEqual({ v: 1, strokes: [F1, F2] });
    expect(json.nodes).toEqual([doc.nodes[2]]);
    // Una copia per valore.
    (clipboard["fub:ink"]!.strokes[0]!.vendor as { keep: number }).keep = 9;
    expect((F1.vendor as { keep: number }).keep).toBe(1);
    // Senza tratti scelti, il campo non c'è.
    expect(Object.keys(JSON.parse(clipboardJson(copiedSelection(doc, ["a"], [])!)))).toEqual(["version", "nodes", "edges"]);
    expect(Object.keys(JSON.parse(clipboardJson(copiedSelection(doc, ["a"], ["assente"])!)))).toEqual(["version", "nodes", "edges"]);
    // Solo tratti: nessuna scheda, la forma c'è lo stesso.
    expect(JSON.parse(clipboardJson(copiedSelection(doc, [], ["f1"])!))).toEqual({ version: 1, nodes: [], edges: [], "fub:ink": { v: 1, strokes: [F1] } });
    expect(copiedSelection(doc, ["assente"], ["assente"])).toBeNull();
    // Una lavagna senza livello della radice non ha tratti da copiare.
    expect(copiedSelection(board(), [], ["f1"])).toBeNull();
  });

  it("rilegge la forma col campo, solo tratti, e quella senza campo di un Fub di prima", () => {
    const doc = inked();
    const both = clipboardJson(copiedSelection(doc, ["a", "b"], ["f1"])!);
    expect(readCanvasClipboard(both)).toEqual({ kind: "cards", clipboard: JSON.parse(both) });
    const only = clipboardJson(copiedSelection(doc, [], ["f1", "f2"])!);
    expect(readCanvasClipboard(only)).toEqual({ kind: "cards", clipboard: JSON.parse(only) });
    const old = JSON.stringify({ version: 1, nodes: [doc.nodes[2]], edges: [] });
    const read = readCanvasClipboard(old);
    expect(read).toEqual({ kind: "cards", clipboard: JSON.parse(old) });
    expect(read.kind === "cards" && "fub:ink" in read.clipboard).toBe(false);
    // Un livello vuoto con le schede non porta niente; senza schede non è niente.
    const empty = readCanvasClipboard(JSON.stringify({ version: 1, nodes: [doc.nodes[2]], edges: [], "fub:ink": { v: 1, strokes: [] } }));
    expect(empty.kind === "cards" && "fub:ink" in empty.clipboard).toBe(false);
    expect(readCanvasClipboard(JSON.stringify({ version: 1, nodes: [], edges: [], "fub:ink": { v: 1, strokes: [] } }))).toEqual({ kind: "broken" });
    expect(readCanvasClipboard(JSON.stringify({ version: 1, nodes: [], edges: [] }))).toEqual({ kind: "broken" });
  });

  it("un campo rotto, o un tratto che non si incolla, rifiuta tutto: anche le schede accanto", () => {
    const node = board().nodes[2];
    const shape = (ink: unknown) => JSON.stringify({ version: 1, nodes: [node], edges: [], "fub:ink": ink });
    const refused = [
      shape(null),
      shape([F1]),
      shape("1 s100 cxy 0,0"),
      shape({ strokes: [F1] }),
      shape({ v: 2, strokes: [F1] }),
      shape({ v: 1 }),
      shape({ v: 1, strokes: {} }),
      shape({ v: 1, strokes: [null] }),
      shape({ v: 1, strokes: [{ ...F1, id: "" }] }),
      shape({ v: 1, strokes: [{ ...F1, id: 7 }] }),
      shape({ v: 1, strokes: [F1, F1] }),
      // L'ancora di una scheda alla radice non vale.
      shape({ v: 1, strokes: [{ ...F1, anchor: { kind: "card", width: 240, height: 140 } }] }),
      shape({ v: 1, strokes: [{ ...F1, tool: "matita" }] }),
      shape({ v: 1, strokes: [{ ...F1, brush: "pennello" }] }),
      shape({ v: 1, strokes: [{ ...F1, ink: "1 s100 cxy 1,a" }] }),
      shape({ v: 1, strokes: [{ ...F1, ink: "1 s100 cxyq 1,2,3" }] }),
      // Senza schede, lo stesso.
      JSON.stringify({ version: 1, nodes: [], edges: [], "fub:ink": { v: 2, strokes: [F1] } }),
    ];
    for (const text of refused) expect(readCanvasClipboard(text), text).toEqual({ kind: "refused" });
  });

  it("i limiti dell'inchiostro: 10 000 campioni e 512 KiB per tratto, e i numeri dell'inchiostro", () => {
    const shape = (ink: string) => JSON.stringify({ version: 1, nodes: [], edges: [], "fub:ink": { v: 1, strokes: [free("f", ink)] } });
    expect(readCanvasClipboard(shape(`1 s100 cxy 0,0${" 1,0".repeat(9_999)}`)).kind).toBe("cards");
    expect(readCanvasClipboard(shape(`1 s100 cxy 0,0${" 1,0".repeat(10_000)}`))).toEqual({ kind: "refused" });
    expect(readCanvasClipboard(shape(`1 s100 cxy 0,0${" 0,0".repeat(140_000)}`))).toEqual({ kind: "refused" });
    // Un numero oltre ±(2⁵³ − 1) non è dell'inchiostro.
    expect(readCanvasClipboard(shape("1 s100 cxy 9007199254740992,0"))).toEqual({ kind: "refused" });
  });

  it("incollando: l'angolo del riquadro di schede e tratti nel punto, i tratti con ids nuovi e lo spostamento delle schede", () => {
    const clipboard = copiedSelection(inked(), ["a"], ["f1", "f2"])!;
    let next = 0;
    const id = (prefix: string): string => `${prefix}${++next}`;
    const placed = placedSelection(clipboard, { x: 1000, y: 2000 }, id);
    // Il primo tratto parte da (40, 25), la scheda da (40, 40): l'angolo è (40, 25).
    expect([placed.dx, placed.dy]).toEqual([960, 1975]);
    expect(placed.nodes.map((node) => [node.id, node.x, node.y])).toEqual([["n1", 1000, 2015]]);
    expect(placed.strokes).toEqual([{ ...F1, id: "s2" }, { ...F2, id: "s3" }]);
    // L'id resta il primo campo, come nel file.
    expect(Object.keys(placed.strokes[0]!)[0]).toBe("id");
    expect(pastedInkOps(placed)).toEqual([
      { op: "add_strokes", layer: "board", strokes: placed.strokes },
      { op: "move_strokes", layer: "board", ids: ["s2", "s3"], dx: 960, dy: 1975 },
    ]);
    // Gli appunti restano com'erano: si incollano di nuovo.
    expect(clipboard["fub:ink"]!.strokes[0]!.id).toBe("f1");
    // Solo tratti: l'angolo è quello dei tratti, all'intero sotto.
    const only = placedSelection(copiedSelection(inked(), [], ["f2"])!, { x: 0, y: 0 }, id);
    expect([only.nodes, only.dx, only.dy]).toEqual([[], -900, -700]);
    // Già al loro posto: niente da spostare; senza tratti, niente da fare.
    const still = placedSelection(copiedSelection(inked(), [], ["f1"])!, { x: 40, y: 25 }, id);
    expect(pastedInkOps(still).map((op) => op.op)).toEqual(["add_strokes"]);
    expect(pastedInkOps(placedSelection(copiedSelection(inked(), ["a"])!, { x: 0, y: 0 }, id))).toEqual([]);
  });

  it("l'aggiunta e lo spostamento di un tratto diventano una toppa sola; le altre restano", () => {
    const added = { id: "s2", ink: "1 s100 cxy 0,0" };
    const moved = { id: "s2", ink: "1 s100 cxy 500,500" };
    const other: CanvasPatch = { kind: "ink", layer: { node: "a" }, at: 0, before: { id: "x" }, after: { id: "x", color: "#000000" } };
    const patches: CanvasPatch[] = [
      { kind: "ink", layer: "board", at: 3, before: null, after: added },
      other,
      { kind: "ink", layer: "board", at: 3, before: added, after: moved },
    ];
    expect(joinedInkPatches(patches)).toEqual([{ kind: "ink", layer: "board", at: 3, before: null, after: moved }, other]);
  });
});
