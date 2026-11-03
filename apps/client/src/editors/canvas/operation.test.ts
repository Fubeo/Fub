// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseCanvas, serializeCanvas } from "./model";
import { applyOperation } from "../core/text-operation";
import {
  addStrokePatch,
  applyCanvasPatches,
  canvasCommitOutcome,
  commitCanvasPatches,
  eraseStrokePatch,
  eraseStrokePatches,
  invertCanvasOperation,
  inverseCanvasPatches,
  removeNodePatch,
  type CanvasPatch,
  type StoredInkStroke,
  upsertEdgePatch,
  upsertNodePatch,
} from "./operation";

function source(): string {
  return JSON.stringify({
    nodes: [
      { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 120, text: "vedi [[Nota]] e #tag" },
      { id: "n2", type: "file", x: 300, y: 0, width: 200, height: 120, file: "foto.png" },
    ],
    edges: [{ id: "e1", fromNode: "n1", toNode: "n2", toEnd: "arrow", label: "usa" }],
    xFuture: { nested: [1, 2] },
  });
}

describe("canvas model", () => {
  it("conserva i campi sconosciuti a ogni livello", () => {
    const withExtra = parseCanvas(JSON.stringify({
      nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a", xVendor: 1 }],
      edges: [],
      xRoot: true,
    }));
    expect((withExtra.nodes[0] as Record<string, unknown>).xVendor).toBe(1);
    expect((withExtra as Record<string, unknown>).xRoot).toBe(true);
    const round = parseCanvas(serializeCanvas(withExtra));
    expect((round.nodes[0] as Record<string, unknown>).xVendor).toBe(1);
    expect((round as Record<string, unknown>).xRoot).toBe(true);
  });

  it("non scarta chiavi future che collidono col prototipo JavaScript", () => {
    const text = '{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a","constructor":{"keep":1}}],"edges":[],"__proto__":{"own":true}}';
    const doc = parseCanvas(text);
    expect(Object.prototype.hasOwnProperty.call(doc, "__proto__")).toBe(true);
    expect(doc["__proto__"]).toEqual({ own: true });
    expect(doc.nodes[0].constructor).toEqual({ keep: 1 });
    const patch = upsertNodePatch(doc, { ...doc.nodes[0], x: 8 })!;
    const committed = commitCanvasPatches(doc, text, [patch])!;
    expect(committed.source).toContain('"__proto__":{"own":true}');
    expect(committed.source).toContain('"constructor":{"keep":1}');
  });

  it("guarda i limiti di un campo solo sulla scheda del suo tipo, come il nucleo Rust", () => {
    const doc = parseCanvas(JSON.stringify({
      nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a",
        subpath: "senza-cancelletto", url: "", background: "b".repeat(9000) }],
      edges: [],
    }));
    expect(doc.nodes[0].subpath).toBe("senza-cancelletto");
    expect(doc.nodes[0].background).toHaveLength(9000);
    expect(() => parseCanvas(JSON.stringify({
      nodes: [{ id: "n", type: "file", x: 0, y: 0, width: 10, height: 10, file: "a.md", subpath: "x" }],
      edges: [],
    }))).toThrow();
    expect(() => parseCanvas(JSON.stringify({
      nodes: [{ id: "n", type: "group", x: 0, y: 0, width: 10, height: 10, text: 5 }],
      edges: [],
    }))).toThrow();
  });

  it("rifiuta JSON corrotto, id duplicati e archi orfani senza indovinare", () => {
    expect(() => parseCanvas("{")).toThrow();
    expect(() => parseCanvas('{"nodes":[],"edges":[],"future":1e999}')).toThrow();
    const dup = JSON.parse(source()) as { nodes: unknown[] };
    dup.nodes.push(dup.nodes[0]);
    expect(() => parseCanvas(JSON.stringify(dup))).toThrow();
    expect(() => parseCanvas(JSON.stringify({
      nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a" }],
      edges: [{ id: "e", fromNode: "n", toNode: "missing" }],
    }))).toThrow();
  });
});

describe("canvas operations", () => {
  it("valida tutte le preimmagini prima di mutare un singolo nodo", () => {
    const before = source();
    const doc = parseCanvas(before);
    const valid = upsertNodePatch(doc, { ...doc.nodes[0], x: 16 })!;
    const stale = {
      ...upsertNodePatch(doc, { ...doc.nodes[1], x: 400 })!,
      before: { ...(doc.nodes[1]), x: 9999 },
    };

    expect(applyCanvasPatches(doc, [valid, stale])).toBe(false);
    expect(doc.nodes[0].x).toBe(0);
    expect(doc.nodes[1].x).toBe(300);
  });

  it("sposta, duplica logica e annulla come una sola operazione con preimmagini", () => {
    const before = source();
    const doc = parseCanvas(before);
    const moved = upsertNodePatch(doc, { ...doc.nodes[0], x: 8, y: 8 })!;
    const relabeled = upsertEdgePatch(doc, { ...doc.edges[0], label: "dipende" })!;
    const committed = commitCanvasPatches(doc, before, [moved, relabeled])!;
    expect(applyOperation(before, committed.operation)).toBe(committed.source);
    expect(doc.nodes[0].x).toBe(8);
    expect(applyCanvasPatches(doc, inverseCanvasPatches([moved, relabeled]))).toBe(true);
    expect(doc.nodes[0].x).toBe(0);
    expect(doc.edges[0].label).toBe("usa");
  });

  it("rifiuta la rimozione di un nodo con archi e la rifiuta senza preimmagine", () => {
    const doc = parseCanvas(source());
    expect(removeNodePatch(doc, "n1")).not.toBeNull();
    // apply rifiuta: l'arco e1 punta ancora a n1.
    expect(applyCanvasPatches(doc, [removeNodePatch(doc, "n1")!])).toBe(false);
    expect(doc.nodes).toHaveLength(2);
  });

  it("rimuove e ripristina insieme due nodi e il loro arco senza stati parziali", () => {
    const doc = parseCanvas(source());
    const edge = { kind: "remove-edge" as const, before: { ...doc.edges[0] }, after: null };
    const first = removeNodePatch(doc, "n1")!;
    const second = removeNodePatch(doc, "n2")!;
    const committed = commitCanvasPatches(doc, source(), [edge, first, second]);
    expect(committed).not.toBeNull();
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    expect(applyCanvasPatches(doc, inverseCanvasPatches(committed!.operation.patches))).toBe(true);
    expect(serializeCanvas(doc)).toBe(serializeCanvas(parseCanvas(source())));
  });
  it("rifiuta una patch finale non valida senza mutare il documento o i campi sconosciuti", () => {
    const doc = parseCanvas(source());
    const invalid = upsertNodePatch(doc, { ...doc.nodes[0], width: 0 })!;
    const valid = upsertEdgePatch(doc, { ...doc.edges[0], label: "nuova" })!;
    expect(commitCanvasPatches(doc, source(), [valid, invalid])).toBeNull();
    expect(doc.nodes[0].width).toBe(200);
    expect(doc.edges[0].label).toBe("usa");
    expect(doc.xFuture).toEqual({ nested: [1, 2] });
  });

  it("riconnette un estremo mantenendo attributi futuri e inverte la patch intera", () => {
    const before = JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 100, text: "a" },
        { id: "b", type: "text", x: 120, y: 0, width: 100, height: 100, text: "b" },
        { id: "c", type: "text", x: 240, y: 0, width: 100, height: 100, text: "c" },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", fromEnd: "arrow", toSide: "top",
        color: "#abcdef", label: "note", vendor: { keep: true } }],
      xFuture: true,
    });
    const doc = parseCanvas(before);
    const edge = upsertEdgePatch(doc, { ...doc.edges[0], toNode: "c", toEnd: "none" })!;
    const committed = commitCanvasPatches(doc, before, [edge])!;
    expect(committed.operation.patches).toHaveLength(1);
    expect(doc.edges[0]).toMatchObject({
      fromNode: "a", toNode: "c", fromEnd: "arrow", toEnd: "none",
      color: "#abcdef", label: "note", vendor: { keep: true },
    });
    expect(applyCanvasPatches(doc, inverseCanvasPatches(committed.operation.patches))).toBe(true);
    expect(doc.edges[0].toNode).toBe("b");
    expect(doc.xFuture).toBe(true);
  });
  it("modifica soltanto i byte noti lasciando intatti spazi, escape e campi futuri", () => {
    const before = ' \n{ \"root\": {\"escaped\":\"\\\\u00e9\"}, \"nodes\" : [ {\"id\":\"a\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":100,\"height\":80,\"text\":\"a\",\"vendor\": {  \"keep\" : \"\\\\u0055\" }} ], \"edges\": [] }\n';
    const doc = parseCanvas(before);
    const moved = upsertNodePatch(doc, { ...doc.nodes[0], x: 8 })!;
    const committed = commitCanvasPatches(doc, before, [moved])!;
    expect(committed.source).toBe(before.replace('\"x\":0', '\"x\":8'));
    expect(applyOperation(before, committed.operation)).toBe(committed.source);
    const colored = upsertNodePatch(doc, { ...doc.nodes[0], color: "#aabbcc" })!;
    const second = commitCanvasPatches(doc, committed.source, [colored])!;
    expect(second.source).toContain('\"vendor\": {  \"keep\" : \"\\\\u0055\" }');
    expect(second.source).toContain('\"root\": {\"escaped\":\"\\\\u00e9\"}');
    expect(parseCanvas(second.source).nodes[0].color).toBe("#aabbcc");
  });
  it("confronta le preimmagini per valore, in qualunque ordine di chiavi (R9)", () => {
    const doc = parseCanvas(source());
    const { id, type, ...rest } = doc.nodes[0];
    const reordered = { ...rest, type, id };
    expect(upsertNodePatch(doc, reordered)).toBeNull();
    const moved = { kind: "upsert-node" as const, before: reordered, after: { ...reordered, x: 4 } };
    expect(commitCanvasPatches(doc, source(), [moved])?.source).toContain('"x":4');
  });

  it("scrive le chiavi di un nodo nuovo nell'ordine di R10", () => {
    const doc = parseCanvas(source());
    const after = { text: "t", height: 5, width: 5, y: 0, x: 0, type: "text" as const, id: "n3", xV: 1, color: "1" };
    const committed = commitCanvasPatches(doc, source(), [upsertNodePatch(doc, after)!])!;
    expect(committed.source).toContain('{"id":"n3","type":"text","x":0,"y":0,"width":5,"height":5,"color":"1","text":"t","xV":1}');
  });

  it("dice perché un commit è rifiutato, con le ragioni del nucleo Rust", () => {
    const before = source();
    const doc = parseCanvas(before);
    const stale = { ...upsertNodePatch(doc, { ...doc.nodes[0], x: 1 })!, before: { ...doc.nodes[0], x: 99 } };
    expect(canvasCommitOutcome(doc, before, [stale])).toEqual({ outcome: "rejected", reason: "stale" });
    const invalid = upsertNodePatch(doc, { ...doc.nodes[0], width: 0 })!;
    expect(canvasCommitOutcome(doc, before, [invalid])).toEqual({ outcome: "rejected", reason: "invalid" });
    const repeated = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a"}],"edges":[],"k":1,"k":2}';
    const other = parseCanvas(repeated);
    const moved = upsertNodePatch(other, { ...other.nodes[0], x: 3 })!;
    expect(canvasCommitOutcome(other, repeated, [moved])).toEqual({ outcome: "rejected", reason: "rejected" });
    expect(other.nodes[0].x).toBe(0);
    expect(canvasCommitOutcome(doc, before, [])).toMatchObject({ outcome: "applied", source: before });
    expect(commitCanvasPatches(doc, before, [])).toBeNull();
  });

  it("riordina card senza riemettere i byte ignoti di ciascuna", () => {
    const before = '{ "nodes": [ {"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a","future": { "escaped": "\\\\u0055" }}, {"id":"b","type":"text","x":20,"y":0,"width":10,"height":10,"text":"b"} ], "edges": [], "tail": [ 1,  2 ] }';
    const doc = parseCanvas(before);
    const patch = { kind: "reorder" as const, before: ["a", "b"], after: ["b", "a"] };
    const committed = commitCanvasPatches(doc, before, [patch])!;
    expect(committed.source).toContain('"future": { "escaped": "\\\\u0055" }');
    expect(committed.source).toContain('"tail": [ 1,  2 ]');
    expect(parseCanvas(committed.source).nodes.map((node) => node.id)).toEqual(["b", "a"]);
    expect(applyCanvasPatches(doc, inverseCanvasPatches([patch]))).toBe(true);
    expect(doc.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  });
});

const BRUSH = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";

function stroke(id: string, anchor: StoredInkStroke["anchor"] = { kind: "card", width: 200, height: 120 }): StoredInkStroke {
  return { id, tool: "pen", brush: BRUSH, color: "#0072b2", anchor, ink: "1 s100 cxy 100,100 10,0" };
}

function inkSource(strokes: readonly string[]): string {
  return JSON.stringify({
    nodes: [
      { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 120, text: "a",
        "fub:ink": { v: 1, strokes: strokes.map((id) => stroke(id)) } },
      { id: "n2", type: "text", x: 300, y: 0, width: 200, height: 120, text: "b" },
    ],
    edges: [],
  });
}

function strokeIds(doc: ReturnType<typeof parseCanvas>, node = 0): string[] {
  const layer = doc.nodes[node]["fub:ink"] as { strokes: StoredInkStroke[] } | undefined;
  return layer ? layer.strokes.map((entry) => entry.id) : [];
}

describe("canvas ink patches", () => {
  it("addStrokePatch mette il tratto in fondo, coi campi nell'ordine di scrittura", () => {
    const doc = parseCanvas(inkSource(["s1", "s2"]));
    const { ink, anchor, id, ...rest } = stroke("s3");
    const patch = addStrokePatch(doc, { node: "n1" }, { ink, anchor, ...rest, id, "fub:x": 1 })!;
    expect(patch).toMatchObject({ kind: "ink", layer: { node: "n1" }, at: 2, before: null });
    expect(Object.keys(patch.after!)).toEqual(["id", "tool", "brush", "color", "anchor", "ink", "fub:x"]);
    expect(commitCanvasPatches(doc, inkSource(["s1", "s2"]), [patch])).not.toBeNull();
    expect(strokeIds(doc)).toEqual(["s1", "s2", "s3"]);
  });

  it("addStrokePatch fa nascere il livello e non scrive dove non può", () => {
    const doc = parseCanvas(inkSource([]));
    expect(addStrokePatch(doc, { node: "n2" }, stroke("s1"))).toMatchObject({ at: 0, before: null });
    expect(addStrokePatch(doc, "board", stroke("s1", { kind: "free" }))).toMatchObject({ layer: "board", at: 0 });
    expect(addStrokePatch(doc, { node: "manca" }, stroke("s1"))).toBeNull();
    const full = parseCanvas(inkSource(["s1"]));
    expect(addStrokePatch(full, { node: "n1" }, stroke("s1"))).toBeNull();
    const foreign = parseCanvas(JSON.stringify({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a", "fub:ink": { v: 2, strokes: [] } }],
      edges: [],
    }));
    expect(addStrokePatch(foreign, { node: "n1" }, stroke("s1"))).toBeNull();
    expect(eraseStrokePatch(foreign, { node: "n1" }, "s1")).toBeNull();
  });

  it("eraseStrokePatch toglie il tratto dalla sua posizione e l'annulla lo rimette", () => {
    const before = inkSource(["s1", "s2", "s3"]);
    const doc = parseCanvas(before);
    const patch = eraseStrokePatch(doc, { node: "n1" }, "s2")!;
    expect(patch).toMatchObject({ kind: "ink", layer: { node: "n1" }, at: 1, after: null, before: { id: "s2" } });
    expect(eraseStrokePatch(doc, { node: "n1" }, "manca")).toBeNull();
    expect(eraseStrokePatch(doc, { node: "n2" }, "s2")).toBeNull();
    const committed = commitCanvasPatches(doc, before, [patch])!;
    expect(strokeIds(doc)).toEqual(["s1", "s3"]);
    expect(commitCanvasPatches(doc, committed.source, invertCanvasOperation(committed.operation).patches)?.source).toBe(before);
    expect(strokeIds(doc)).toEqual(["s1", "s2", "s3"]);
  });

  it("una passata di gomma è un commit solo, e l'annulla rimette ogni tratto al suo posto", () => {
    const before = inkSource(["s1", "s2", "s3", "s4"]);
    const doc = parseCanvas(before);
    const patches = eraseStrokePatches(doc, { node: "n1" }, ["s4", "s1", "s3"])!;
    expect(patches.map((patch) => patch.at)).toEqual([3, 0, 1]);
    expect(eraseStrokePatches(doc, { node: "n1" }, ["s1", "s1"])).toBeNull();
    expect(eraseStrokePatches(doc, { node: "n1" }, [])).toEqual([]);
    const committed = commitCanvasPatches(doc, before, patches)!;
    expect(strokeIds(doc)).toEqual(["s2"]);
    expect(commitCanvasPatches(doc, committed.source, invertCanvasOperation(committed.operation).patches)?.source).toBe(before);
    expect(strokeIds(doc)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("togliere tutti i tratti fa sparire la chiave, e l'annulla la rimette", () => {
    const before = inkSource(["s1", "s2"]);
    const doc = parseCanvas(before);
    const committed = commitCanvasPatches(doc, before, eraseStrokePatches(doc, { node: "n1" }, ["s1", "s2"])!)!;
    expect(Object.prototype.hasOwnProperty.call(doc.nodes[0], "fub:ink")).toBe(false);
    expect(committed.source).not.toContain("fub:ink");
    expect(commitCanvasPatches(doc, committed.source, invertCanvasOperation(committed.operation).patches)?.source).toBe(before);
  });

  it("l'inversa di aggiunte e tolte nello stesso livello le disfa in ordine inverso", () => {
    const before = inkSource(["s1", "s2", "s3"]);
    const doc = parseCanvas(before);
    const erased = eraseStrokePatch(doc, { node: "n1" }, "s1")!;
    const added = { kind: "ink" as const, layer: { node: "n1" }, at: 0, before: null, after: stroke("s4") };
    const second = { kind: "ink" as const, layer: { node: "n1" }, at: 2, before: stroke("s3"), after: null };
    const committed = commitCanvasPatches(doc, before, [erased, added, second])!;
    expect(strokeIds(doc)).toEqual(["s4", "s2"]);
    const inverse = inverseCanvasPatches(committed.operation.patches);
    expect(inverse.map((patch) => patch.kind === "ink" && [patch.at, patch.before?.id ?? null, patch.after?.id ?? null]))
      .toEqual([[2, null, "s3"], [0, "s4", null], [0, null, "s1"]]);
    expect(commitCanvasPatches(doc, committed.source, inverse)?.source).toBe(before);
  });

  it("una toppa su una scheda tolta nel frattempo è stale e non cambia niente", () => {
    const before = inkSource(["s1"]);
    const doc = parseCanvas(before);
    const patch = addStrokePatch(doc, { node: "n2" }, stroke("s9"))!;
    const removed = commitCanvasPatches(doc, before, [removeNodePatch(doc, "n2")!])!;
    const model = JSON.stringify(doc);
    expect(canvasCommitOutcome(doc, removed.source, [patch])).toEqual({ outcome: "rejected", reason: "stale" });
    expect(applyCanvasPatches(doc, [patch])).toBe(false);
    expect(JSON.stringify(doc)).toBe(model);
  });

  it("il livello della radice passa nel modello, accanto agli altri campi della radice", () => {
    const before = '{"nodes":[],"edges":[],"xRoot":{"a":1}}';
    const doc = parseCanvas(before);
    const keep = doc.xRoot;
    const patch = addStrokePatch(doc, "board", stroke("s1", { kind: "free" }))!;
    const committed = commitCanvasPatches(doc, before, [patch])!;
    expect(doc.xRoot).toBe(keep);
    expect(Object.keys(doc)).toEqual(["nodes", "edges", "xRoot", "fub:ink"]);
    expect(parseCanvas(committed.source)).toEqual(doc);
    expect(applyCanvasPatches(doc, inverseCanvasPatches([patch]))).toBe(true);
    expect(Object.keys(doc)).toEqual(["nodes", "edges", "xRoot"]);
  });

  it("rifiuta come invalid una toppa ink che il nucleo non saprebbe leggere", () => {
    const before = inkSource(["s1"]);
    const doc = parseCanvas(before);
    const bad = [
      { kind: "ink", layer: { node: "n1" }, at: 1, before: null, after: { tool: "pen" } },
      { kind: "ink", layer: { node: "n1" }, at: 1, before: null, after: { ...stroke("s2"), id: "" } },
      { kind: "ink", layer: "radice", at: 1, before: null, after: stroke("s2") },
      { kind: "ink", layer: { node: "n1", altro: 1 }, at: 1, before: null, after: stroke("s2") },
      { kind: "ink", layer: { node: "n1" }, at: -1, before: null, after: stroke("s2") },
      { kind: "ink", layer: { node: "n1" }, at: 0.5, before: null, after: stroke("s2") },
      { kind: "sconosciuta" },
    ] as unknown as CanvasPatch[];
    for (const patch of bad) {
      expect(canvasCommitOutcome(doc, before, [patch]), JSON.stringify(patch)).toEqual({ outcome: "rejected", reason: "invalid" });
    }
  });
});
