// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseCanvas, serializeCanvas } from "./model";
import { applyOperation } from "../core/text-operation";
import {
  applyCanvasPatches,
  commitCanvasPatches,
  inverseCanvasPatches,
  removeNodePatch,
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
