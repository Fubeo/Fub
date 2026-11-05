// I costruttori delle toppe, su lavagne scritte a mano. Che cosa fa una toppa
// sul testo lo dicono i vettori (`src/__fixtures__/canvas-patches/`), contro il
// nucleo nativo e il `.wasm`; qui ciò che il motore mette nella toppa.
import { describe, expect, it } from "vitest";
import type { CanvasDocument, CanvasNode } from "./model";
import { removeEdgePatch, removeNodePatch, upsertEdgePatch, upsertNodePatch } from "./operation";

function board(): CanvasDocument {
  return {
    nodes: [
      { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 120, text: "vedi [[Nota]] e #tag" },
      { id: "n2", type: "file", x: 300, y: 0, width: 200, height: 120, file: "foto.png" },
    ],
    edges: [{ id: "e1", fromNode: "n1", toNode: "n2", toEnd: "arrow", label: "usa" }],
    xFuture: { nested: [1, 2] },
  };
}

describe("i costruttori delle toppe", () => {
  it("una scheda o un arco uguali per valore, in qualunque ordine di chiavi, non fanno toppa (R9)", () => {
    const doc = board();
    const { id, type, ...rest } = doc.nodes[0]!;
    expect(upsertNodePatch(doc, { ...rest, type, id })).toBeNull();
    expect(upsertEdgePatch(doc, { label: "usa", toEnd: "arrow", toNode: "n2", fromNode: "n1", id: "e1" })).toBeNull();
  });

  it("una scheda nuova ha le chiavi nell'ordine di R10 e perde i campi noti a null (R7)", () => {
    const doc = board();
    const after = { text: "t", height: 5, width: 5, y: 0, x: 0, type: "text", id: "n3", xV: 1, color: "1", label: null } as unknown as CanvasNode;
    const patch = upsertNodePatch(doc, after)!;
    expect(patch.before).toBeNull();
    expect(JSON.stringify(patch.after)).toBe('{"id":"n3","type":"text","x":0,"y":0,"width":5,"height":5,"color":"1","text":"t","xV":1}');
  });

  it("uno spostamento porta la scheda di prima e quella di dopo, copiate", () => {
    const doc = board();
    const moved = { ...doc.nodes[0]!, x: 8, y: 8 };
    const patch = upsertNodePatch(doc, moved)!;
    expect(patch.before).toEqual(doc.nodes[0]);
    expect(patch.before).not.toBe(doc.nodes[0]);
    expect(patch.after).toEqual(moved);
    expect(patch.after).not.toBe(moved);
  });

  it("le chiavi __proto__ e constructor restano campi propri della scheda", () => {
    const doc = JSON.parse('{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a","constructor":{"keep":1}}],"edges":[]}') as CanvasDocument;
    const node = JSON.parse('{"id":"n","type":"text","x":8,"y":0,"width":10,"height":10,"text":"a","constructor":{"keep":1},"__proto__":{"own":true}}') as CanvasNode;
    const patch = upsertNodePatch(doc, node)!;
    expect(Object.prototype.hasOwnProperty.call(patch.after, "__proto__")).toBe(true);
    expect(JSON.stringify(patch.after)).toContain('"constructor":{"keep":1},"__proto__":{"own":true}');
  });

  it("togliere una scheda o un arco dice dove stava; un id che non c'è non fa toppa", () => {
    const doc = board();
    expect(removeNodePatch(doc, "n2")).toEqual({ kind: "remove-node", before: doc.nodes[1], after: null, at: 1 });
    expect(removeNodePatch(doc, "manca")).toBeNull();
    expect(removeEdgePatch(doc, "e1")).toEqual({ kind: "remove-edge", before: doc.edges[0], after: null, at: 0 });
    expect(removeEdgePatch(doc, "manca")).toBeNull();
  });

  it("riattaccare un estremo tiene i campi dell'arco, anche sconosciuti", () => {
    const doc = board();
    doc.edges[0] = { ...doc.edges[0]!, vendor: { keep: true } };
    const patch = upsertEdgePatch(doc, { ...doc.edges[0], toNode: "n1", toEnd: "none" })!;
    expect(patch.before).toMatchObject({ toNode: "n2", toEnd: "arrow", vendor: { keep: true } });
    expect(patch.after).toMatchObject({ fromNode: "n1", toNode: "n1", toEnd: "none", label: "usa", vendor: { keep: true } });
  });
});
