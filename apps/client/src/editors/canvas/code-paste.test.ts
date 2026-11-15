// «Incolla codice» su una lavagna che ha già gli id della lista (LIC T25): la
// traduzione in aggiornamenti o in copie, provata contro il nucleo vero.
import { beforeAll, describe, expect, it } from "vitest";

import SPEC_RS from "../../../../../crates/fub-canvas-core/src/spec.rs?raw";
import { asCopies, asUpdates, CARD_REFERENCES, codeClashes, NOT_CARD_REFERENCES, placedAt } from "./code-paste";
import type { CanvasDocument } from "./model";
import { canvasCoreReady, openCoreNow, type CanvasCore, type CanvasIntentOp } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

const BRUSH = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
const stroke = (id: string, anchor: Record<string, unknown>, ink = "1 s100 cxy 4000,2500 120,40 95,-10") =>
  ({ id, tool: "pen", brush: BRUSH, color: "#0072b2", anchor, ink });

/** Due schede collegate, un gruppo, un tratto sulla prima e uno libero. */
const SOURCE = JSON.stringify({
  nodes: [
    { id: "g", type: "group", x: -40, y: -40, width: 800, height: 300, label: "G" },
    { id: "a", type: "text", x: 0, y: 0, width: 240, height: 160, text: "uno", "fub:ink": { v: 1, strokes: [stroke("s-a", { kind: "card", width: 240, height: 160 })] } },
    { id: "b", type: "text", x: 400, y: 0, width: 240, height: 160, text: "due", color: "4" },
  ],
  edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "va", toEnd: "none" }],
  "fub:ink": { v: 1, strokes: [stroke("s-free", { kind: "free" }, "1 s100 cxy 80000,30000 1000,0")] },
});

function withCore<T>(source: string, run: (core: CanvasCore, doc: CanvasDocument) => T): T {
  const core = openCoreNow(source);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return run(core, core.model());
  } finally {
    core.close();
  }
}

/** Il testo che il nucleo scrive per `ops` su `source`. */
function written(source: string, ops: readonly unknown[], seed = 7n): string {
  return withCore(source, (core) => core.preview(core.compile(ops as CanvasIntentOp[], seed).patches));
}

describe("code-paste", () => {
  it("la lavagna copiata e incollata su sé stessa: tutto preso; aggiornando niente cambia", () => {
    withCore(SOURCE, (core, doc) => {
      const ops = JSON.parse(core.describe()) as unknown[];
      const clashes = codeClashes(doc, ops);
      expect(clashes).toEqual({ ok: true, clashes: { cards: ["g", "a", "b"], edges: ["e1"], strokes: 2 } });
      const update = asUpdates(doc, ops);
      expect([...update.updated]).toEqual(["g", "a", "b"]);
      const report = core.check(update.ops, 7n);
      expect(report.ok).toBe(true);
      expect(written(SOURCE, update.ops)).toBe(SOURCE);
    });
  });

  it("aggiornando, i campi cambiati si scrivono e i tratti cambiati si sostituiscono con lo stesso id", () => {
    withCore(SOURCE, (core, doc) => {
      const ops = JSON.parse(core.describe()) as Array<Record<string, unknown>>;
      const text = JSON.stringify(ops)
        .replace('"uno"', '"UNO"')
        .replace('"va"', '"vai"')
        .replace("1 s100 cxy 80000,30000 1000,0", "1 s100 cxy 80000,30000 2000,0");
      const update = asUpdates(doc, JSON.parse(text) as unknown[]);
      expect(core.check(update.ops, 7n).ok).toBe(true);
      const after = withCore(written(SOURCE, update.ops), (_, model) => model);
      expect(after.nodes.find((node) => node.id === "a")).toMatchObject({ text: "UNO", x: 0, y: 0 });
      expect(after.edges).toEqual([expect.objectContaining({ id: "e1", fromNode: "a", toNode: "b", label: "vai", toEnd: "none" })]);
      const free = (after as unknown as { "fub:ink": { strokes: Array<{ id: string; ink: string }> } })["fub:ink"].strokes;
      expect(free).toEqual([expect.objectContaining({ id: "s-free", ink: "1 s100 cxy 80000,30000 2000,0" })]);
    });
  });

  it("come copie: ids nuovi per schede e archi, i riferimenti seguono, i tratti liberi presi perdono l'id", () => {
    withCore(SOURCE, (core, doc) => {
      const ops = JSON.parse(core.describe()) as unknown[];
      const copies = asCopies(doc, ops, 7n);
      expect(copies).toEqual(asCopies(doc, ops, 7n));
      const report = core.check(copies, 7n);
      expect(report.ok).toBe(true);
      const after = withCore(written(SOURCE, copies), (_, model) => model);
      expect(after.nodes).toHaveLength(6);
      expect(after.edges).toHaveLength(2);
      const fresh = after.nodes.slice(3);
      expect(fresh.map((node) => node.id).filter((id) => ["g", "a", "b"].includes(id))).toEqual([]);
      const byText = (text: string) => fresh.find((node) => (node as { text?: string }).text === text)!;
      const edge = after.edges[1]!;
      expect([edge.fromNode, edge.toNode]).toEqual([byText("uno").id, byText("due").id]);
      // Il tratto della scheda va con la copia della scheda.
      expect((byText("uno") as unknown as { "fub:ink"?: { strokes: unknown[] } })["fub:ink"]?.strokes).toHaveLength(1);
      const free = (after as unknown as { "fub:ink": { strokes: Array<{ id: string }> } })["fub:ink"].strokes;
      expect(free).toHaveLength(2);
      expect(free[1]!.id).not.toBe("s-free");
    });
  });

  it("i riferimenti di un'operazione seguono la copia, i lati di `sides` no", () => {
    withCore(SOURCE, (_, doc) => {
      const copies = asCopies(doc, [
        { op: "add_card", id: "a", text: "x" },
        { op: "connect", from: "a", to: "b", sides: { from: "right", to: "left" } },
        { op: "move", ids: ["a", "b"], dx: 10, dy: 0 },
      ], 7n) as Array<Record<string, unknown>>;
      const fresh = copies[0]!.id as string;
      expect(fresh).toMatch(/^[0-9a-f]{16}$/);
      expect(copies[1]).toEqual({ op: "connect", from: fresh, to: "b", sides: { from: "right", to: "left" } });
      expect(copies[2]).toEqual({ op: "move", ids: [fresh, "b"], dx: 10, dy: 0 });
    });
  });

  it("una scheda contro un arco o un altro tipo non si traduce", () => {
    withCore(SOURCE, (_, doc) => {
      expect(codeClashes(doc, [{ op: "add_card", id: "e1", text: "x" }]))
        .toEqual({ ok: false, kind: { index: 0, id: "e1", kind: "edge" } });
      expect(codeClashes(doc, [{ op: "connect", id: "a", from: "a", to: "b" }]))
        .toEqual({ ok: false, kind: { index: 0, id: "a", kind: "text" } });
      expect(codeClashes(doc, [{ op: "add_card", id: "g", text: "x" }]))
        .toEqual({ ok: false, kind: { index: 0, id: "g", kind: "group" } });
      expect(codeClashes(doc, [{ op: "add_card", text: "x" }])).toEqual({ ok: true, clashes: null });
    });
  });
});

/** I campi di ogni operazione di `OPS` (spec.rs) con un tipo che può portare id: `id`, `ids`, `layer`, `node`, `edge`, `patch`. */
function specIdFields(source: string): Map<string, string[]> {
  const start = source.indexOf("pub const OPS");
  const body = source.slice(start, source.indexOf("\n];", start));
  const out = new Map<string, string[]>();
  for (const block of body.split(/\n {4}OpSpec \{/).slice(1)) {
    const name = /name: "([a-z_]+)"/.exec(block)![1]!;
    const fields = [...block.matchAll(/(?:required|optional)\(\s*"([a-zA-Z_]+)",\s*FieldKind::([A-Za-z]+)/g)]
      .filter((match) => ["Id", "Ids", "Layer", "Node", "Edge", "Patch"].includes(match[2]!))
      .map((match) => match[1]!);
    out.set(name, fields);
  }
  return out;
}

describe("i riferimenti delle copie e `OPS` del nucleo", () => {
  it("ogni campo id di `OPS` è un riferimento o non lo è, dichiarato; la tabella non nomina campi che `OPS` non ha", () => {
    const spec = specIdFields(SPEC_RS);
    expect(spec.size).toBeGreaterThan(20);
    expect(spec.get("align")).toEqual(["ids"]);
    for (const [op, fields] of spec) {
      const declared = new Set([...(CARD_REFERENCES[op] ?? []), ...(NOT_CARD_REFERENCES[op] ?? [])].map((path) => path.split(".")[0]));
      for (const field of fields) expect(declared.has(field), `${op}.${field}`).toBe(true);
    }
    for (const [op, paths] of Object.entries({ ...CARD_REFERENCES, ...NOT_CARD_REFERENCES })) {
      expect(spec.has(op), op).toBe(true);
      for (const path of paths) expect(spec.get(op), `${op}.${path}`).toContain(path.split(".")[0]);
    }
    for (const [op, paths] of Object.entries(NOT_CARD_REFERENCES)) {
      for (const path of paths) expect(CARD_REFERENCES[op] ?? [], `${op}.${path}`).not.toContain(path);
    }
  });

  it("`align.to` uguale a un id copiato non si rinomina; `ids` sì", () => {
    const source = JSON.stringify({
      nodes: [{ id: "left", type: "text", x: 0, y: 0, width: 100, height: 60, text: "l" }],
      edges: [],
    });
    withCore(source, (core, doc) => {
      const copies = asCopies(doc, [
        { op: "add_card", id: "left", text: "copia", x: 0, y: 200 },
        { op: "add_card", id: "other", text: "altra", x: 300, y: 200 },
        { op: "align", ids: ["left", "other"], to: "left" },
      ], 7n) as Array<Record<string, unknown>>;
      const fresh = copies[0]!.id as string;
      expect(fresh).not.toBe("left");
      expect(copies[2]).toEqual({ op: "align", ids: [fresh, "other"], to: "left" });
      expect(core.check(copies, 7n).ok).toBe(true);
    });
  });

  it("con `place` il blocco si sposta come Ctrl+V: le schede e, con un `move_strokes`, i tratti liberi", () => {
    withCore(SOURCE, (core, doc) => {
      const ops = JSON.parse(core.describe()) as unknown[];
      const at = { x: 1000, y: 800 };
      const copies = asCopies(doc, ops, 7n, placedAt(at));
      expect(core.check(copies, 7n).ok).toBe(true);
      const after = withCore(written(SOURCE, copies), (_, model) => model);
      const fresh = after.nodes.slice(3);
      // L'angolo del blocco (schede e tratti) cade in `at`: il gruppo è il più in alto a sinistra.
      const group = fresh.find((node) => node.type === "group")!;
      expect([group.x, group.y]).toEqual([at.x, at.y]);
      const dx = at.x - -40;
      const dy = at.y - -40;
      for (const [index, node] of fresh.entries()) {
        const original = after.nodes[index]!;
        expect([node.x, node.y]).toEqual([original.x + dx, original.y + dy]);
      }
      const free = (after as unknown as { "fub:ink": { strokes: Array<{ id: string; ink: string }> } })["fub:ink"].strokes;
      expect(free).toHaveLength(2);
      const head = (ink: string) => ink.split(" ")[3]!.split(",").map(Number);
      expect(head(free[1]!.ink)).toEqual([head(free[0]!.ink)[0]! + dx * 100, head(free[0]!.ink)[1]! + dy * 100]);
    });
  });
});
