// I costruttori delle toppe, su lavagne scritte a mano. Che cosa fa una toppa
// sul testo lo dicono i vettori (`src/__fixtures__/canvas-patches/`), contro il
// nucleo nativo e il `.wasm`; qui ciò che il motore mette nella toppa.
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasDocument, CanvasNode } from "./model";
import {
  addStrokePatch,
  eraseStrokePatch,
  eraseStrokePatches,
  removeEdgePatch,
  removeNodePatch,
  upsertEdgePatch,
  upsertNodePatch,
  type CanvasPatch,
  type StoredInkStroke,
} from "./operation";
import { CanvasCoreError, openCore, type CanvasCore } from "./wasm/core";

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

// Le toppe dell'inchiostro: i costruttori fanno la toppa sul modello che dà il
// nucleo, e il nucleo (il `.wasm` vero, come la tela) la applica e la disfa.
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

function strokeIds(doc: CanvasDocument, node = 0): string[] {
  const layer = doc.nodes[node]!["fub:ink"] as { strokes: StoredInkStroke[] } | undefined;
  return layer ? layer.strokes.map((entry) => entry.id) : [];
}

const cores: CanvasCore[] = [];

/** Una lavagna aperta nel nucleo, chiusa a fine prova. */
async function open(source: string): Promise<CanvasCore> {
  const core = await openCore(source);
  cores.push(core);
  return core;
}

afterEach(() => {
  for (const core of cores.splice(0)) core.close();
});

/** `commit` sul nucleo: il sorgente nuovo, dal tratto cambiato, e le toppe dell'annulla. */
function commit(core: CanvasCore, before: string, patches: readonly CanvasPatch[]): { source: string; inverse: CanvasPatch[] } {
  const { edit, inverse } = core.commit(patches);
  return { source: before.slice(0, edit.start) + edit.text + before.slice(edit.end), inverse };
}

/** Il codice del rifiuto del nucleo a `patches`. */
function refusal(core: CanvasCore, patches: readonly CanvasPatch[]): string {
  try {
    core.commit(patches);
  } catch (error) {
    if (error instanceof CanvasCoreError) return error.code;
    throw error;
  }
  throw new Error("il nucleo ha applicato la toppa");
}

describe("canvas ink patches", () => {
  it("addStrokePatch mette il tratto in fondo, coi campi nell'ordine di scrittura", async () => {
    const core = await open(inkSource(["s1", "s2"]));
    const { ink, anchor, id, ...rest } = stroke("s3");
    const patch = addStrokePatch(core.model(), { node: "n1" }, { ink, anchor, ...rest, id, "fub:x": 1 })!;
    expect(patch).toMatchObject({ kind: "ink", layer: { node: "n1" }, at: 2, before: null });
    expect(Object.keys(patch.after!)).toEqual(["id", "tool", "brush", "color", "anchor", "ink", "fub:x"]);
    commit(core, inkSource(["s1", "s2"]), [patch]);
    expect(strokeIds(core.model())).toEqual(["s1", "s2", "s3"]);
  });

  it("addStrokePatch fa nascere il livello e non scrive dove non può", async () => {
    const doc = (await open(inkSource([]))).model();
    expect(addStrokePatch(doc, { node: "n2" }, stroke("s1"))).toMatchObject({ at: 0, before: null });
    expect(addStrokePatch(doc, "board", stroke("s1", { kind: "free" }))).toMatchObject({ layer: "board", at: 0 });
    expect(addStrokePatch(doc, { node: "manca" }, stroke("s1"))).toBeNull();
    const full = (await open(inkSource(["s1"]))).model();
    expect(addStrokePatch(full, { node: "n1" }, stroke("s1"))).toBeNull();
    const foreign = (await open(JSON.stringify({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10, text: "a", "fub:ink": { v: 2, strokes: [] } }],
      edges: [],
    }))).model();
    expect(addStrokePatch(foreign, { node: "n1" }, stroke("s1"))).toBeNull();
    expect(eraseStrokePatch(foreign, { node: "n1" }, "s1")).toBeNull();
  });

  it("eraseStrokePatch toglie il tratto dalla sua posizione e l'annulla lo rimette", async () => {
    const before = inkSource(["s1", "s2", "s3"]);
    const core = await open(before);
    const doc = core.model();
    const patch = eraseStrokePatch(doc, { node: "n1" }, "s2")!;
    expect(patch).toMatchObject({ kind: "ink", layer: { node: "n1" }, at: 1, after: null, before: { id: "s2" } });
    expect(eraseStrokePatch(doc, { node: "n1" }, "manca")).toBeNull();
    expect(eraseStrokePatch(doc, { node: "n2" }, "s2")).toBeNull();
    const committed = commit(core, before, [patch]);
    expect(strokeIds(core.model())).toEqual(["s1", "s3"]);
    expect(commit(core, committed.source, committed.inverse).source).toBe(before);
    expect(strokeIds(core.model())).toEqual(["s1", "s2", "s3"]);
  });

  it("una passata di gomma è un commit solo, e l'annulla rimette ogni tratto al suo posto", async () => {
    const before = inkSource(["s1", "s2", "s3", "s4"]);
    const core = await open(before);
    const doc = core.model();
    const patches = eraseStrokePatches(doc, { node: "n1" }, ["s4", "s1", "s3"])!;
    expect(patches.map((patch) => patch.at)).toEqual([3, 0, 1]);
    expect(eraseStrokePatches(doc, { node: "n1" }, ["s1", "s1"])).toBeNull();
    expect(eraseStrokePatches(doc, { node: "n1" }, [])).toEqual([]);
    const committed = commit(core, before, patches);
    expect(strokeIds(core.model())).toEqual(["s2"]);
    expect(commit(core, committed.source, committed.inverse).source).toBe(before);
    expect(strokeIds(core.model())).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("togliere tutti i tratti fa sparire la chiave, e l'annulla la rimette", async () => {
    const before = inkSource(["s1", "s2"]);
    const core = await open(before);
    const committed = commit(core, before, eraseStrokePatches(core.model(), { node: "n1" }, ["s1", "s2"])!);
    expect(Object.prototype.hasOwnProperty.call(core.model().nodes[0], "fub:ink")).toBe(false);
    expect(committed.source).not.toContain("fub:ink");
    expect(commit(core, committed.source, committed.inverse).source).toBe(before);
  });

  it("l'inversa di aggiunte e tolte nello stesso livello le disfa in ordine inverso", async () => {
    const before = inkSource(["s1", "s2", "s3"]);
    const core = await open(before);
    const erased = eraseStrokePatch(core.model(), { node: "n1" }, "s1")!;
    const added = { kind: "ink" as const, layer: { node: "n1" }, at: 0, before: null, after: stroke("s4") };
    const second = { kind: "ink" as const, layer: { node: "n1" }, at: 2, before: stroke("s3"), after: null };
    const committed = commit(core, before, [erased, added, second]);
    expect(strokeIds(core.model())).toEqual(["s4", "s2"]);
    expect(committed.inverse.map((patch) => patch.kind === "ink" && [patch.at, patch.before?.id ?? null, patch.after?.id ?? null]))
      .toEqual([[2, null, "s3"], [0, "s4", null], [0, null, "s1"]]);
    expect(commit(core, committed.source, committed.inverse).source).toBe(before);
  });

  it("una toppa su una scheda tolta nel frattempo è stale e non cambia niente", async () => {
    const before = inkSource(["s1"]);
    const core = await open(before);
    const patch = addStrokePatch(core.model(), { node: "n2" }, stroke("s9"))!;
    commit(core, before, [removeNodePatch(core.model(), "n2")!]);
    const model = JSON.stringify(core.model());
    expect(refusal(core, [patch])).toBe("stale");
    expect(JSON.stringify(core.model())).toBe(model);
  });

  it("il livello della radice passa nel modello, accanto agli altri campi della radice", async () => {
    const before = '{"nodes":[],"edges":[],"xRoot":{"a":1}}';
    const core = await open(before);
    const patch = addStrokePatch(core.model(), "board", stroke("s1", { kind: "free" }))!;
    const committed = commit(core, before, [patch]);
    const doc = core.model();
    expect(doc.xRoot).toEqual({ a: 1 });
    expect(Object.keys(doc)).toEqual(["nodes", "edges", "xRoot", "fub:ink"]);
    expect((await open(committed.source)).model()).toEqual(doc);
    commit(core, committed.source, committed.inverse);
    expect(Object.keys(core.model())).toEqual(["nodes", "edges", "xRoot"]);
  });

  // Il nucleo non legge la richiesta (`request`): la toppa non arriva nemmeno
  // alla bozza. La copia TypeScript di prima lo chiamava `invalid`.
  it("rifiuta come request una toppa ink che il nucleo non saprebbe leggere, e non cambia niente", async () => {
    const core = await open(inkSource(["s1"]));
    const model = JSON.stringify(core.model());
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
      expect(refusal(core, [patch]), JSON.stringify(patch)).toBe("request");
      expect(JSON.stringify(core.model())).toBe(model);
    }
  });
});
