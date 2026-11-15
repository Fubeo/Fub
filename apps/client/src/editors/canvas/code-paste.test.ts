// «Incolla codice» su una lavagna che ha già gli id della lista (LIC T25): la
// traduzione in aggiornamenti o in copie, provata contro il nucleo vero.
import { beforeAll, describe, expect, it } from "vitest";

import { asCopies, asUpdates, codeClashes } from "./code-paste";
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
