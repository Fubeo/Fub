import { beforeAll, describe, expect, it } from "vitest";
import { parseInkBrush, type Pf1Brush } from "../../ink/brush";
import type { InkSample } from "../../ink/sample";
import { decodeInk } from "../spatial/ink/codec";
import { InkPathCache } from "./ink-paint";
import {
  defaultInkLook,
  inkLayerWritable,
  INK_PEN_COLOR,
  readInkLayer,
  readInkLayers,
  strokeRecord,
  toDry,
  type DrawableStroke,
  type InkStrokeInput,
  type InkStrokeRecord,
} from "./ink-record";
import type { CanvasDocument, CanvasNode } from "./model";
import { canvasCoreReady, openCoreNow } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

/// La lavagna di `doc` scritta nel file e riletta dal nucleo, come la apre la tela.
function throughFile(doc: CanvasDocument): CanvasDocument {
  const core = openCoreNow(JSON.stringify(doc, null, "\t"));
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model();
  } finally {
    core.close();
  }
}

/// L'errore di `s100` (§5): mezzo centesimo di unità.
const S100_ERROR = 0.005;
const NOW = Date.parse("2026-11-02T09:20:31.250Z");

function card(x: number, y: number, width = 300, height = 200, id = "n1"): CanvasNode {
  return { id, type: "text", text: "x", x, y, width, height };
}

/// Un tratto della penna: tre campioni con pressione, in coordinate della
/// lavagna, a partire da (`x`, `y`).
function penStroke(x: number, y: number, extra: Partial<InkStrokeInput> = {}): InkStrokeInput {
  const samples: InkSample[] = [
    { x, y, p: 0.5, t: 0 },
    { x: x + 12.341, y: y + 3.217, p: 0.6, t: 8 },
    { x: x + 30.006, y: y - 4.999, p: 0.4, t: 16 },
  ];
  return { samples, pressure: true, split: false, ...extra };
}

function written(result: ReturnType<typeof strokeRecord>): InkStrokeRecord {
  if (!result.ok) throw new Error(`rifiutato: ${result.reason}`);
  return result.record;
}

/// Il record scritto nel livello di `holder` (o della radice), passato dal
/// testo del file e riletto.
function reread(record: InkStrokeRecord, holder: CanvasNode | null): DrawableStroke {
  const layer = { v: 1, strokes: [record] };
  const doc: CanvasDocument = holder === null
    ? { nodes: [], edges: [], "fub:ink": layer }
    : { nodes: [{ ...holder, "fub:ink": layer }], edges: [] };
  const layers = readInkLayers(throughFile(doc));
  expect(layers).toHaveLength(1);
  expect(layers[0]!.state).toBe("ok");
  const entry = layers[0]!.strokes[0]!;
  if (!entry.drawn) throw new Error(`non si disegna: ${entry.reason}`);
  return entry.stroke;
}

/// I punti di un tratto riletto, riportati in coordinate della lavagna.
function boardPoints(stroke: DrawableStroke, holder: CanvasNode | null): [number, number][] {
  const dx = holder?.x ?? 0;
  const dy = holder?.y ?? 0;
  return stroke.ink.samples.map((s) => [s.x / stroke.ink.scale + dx, s.y / stroke.ink.scale + dy]);
}

function expectSamePoints(stroke: DrawableStroke, holder: CanvasNode | null, samples: readonly InkSample[]): void {
  const points = boardPoints(stroke, holder);
  expect(points).toHaveLength(samples.length);
  for (let i = 0; i < samples.length; i++) {
    expect(Math.abs(points[i]![0] - samples[i]!.x)).toBeLessThanOrEqual(S100_ERROR + 1e-9);
    expect(Math.abs(points[i]![1] - samples[i]!.y)).toBeLessThanOrEqual(S100_ERROR + 1e-9);
  }
}

describe("strokeRecord", () => {
  it("scrive un tratto di una scheda con i campi nell'ordine del formato", () => {
    const holder = card(100, 50);
    const record = written(strokeRecord(penStroke(140, 80), holder, defaultInkLook(1, true), NOW));
    expect(Object.keys(record)).toEqual(["id", "tool", "at", "brush", "color", "anchor", "ink"]);
    expect(Object.keys(record.anchor)).toEqual(["kind", "width", "height"]);
    expect(record.id).toMatch(/^s-/);
    expect(record.tool).toBe("pen");
    expect(record.color).toBe(INK_PEN_COLOR);
    expect(record.anchor).toEqual({ kind: "card", width: 300, height: 200 });
    // L'inizio del tratto: la fine meno la durata.
    expect(record.at).toBe(new Date(NOW - 16).toISOString());
    // I punti sono in unità della scheda, dal suo angolo in alto a sinistra.
    expect(record.ink.startsWith("1 s100 cxypt 4000,3000,128,0 ")).toBe(true);
    expect(parseInkBrush(record.brush).size).toBe(4);
  });

  it("un record riletto dà gli stessi punti entro l'errore di s100, anche a coordinate negative", () => {
    const holder = card(-1250, -830, 640, 420);
    const stroke = penStroke(-1100.123, -700.456);
    const record = written(strokeRecord(stroke, holder, defaultInkLook(1, true), NOW));
    const drawable = reread(record, holder);
    expect(drawable.ref).toEqual({ width: 640, height: 420 });
    expectSamePoints(drawable, holder, stroke.samples);
    const dry = toDry(record)!;
    expect(dry.ref).toEqual({ width: 640, height: 420 });
    expect(dry.fill).toBe(INK_PEN_COLOR);
    expect(dry.path).toMatch(/^M/);
  });

  it("un tratto libero resta in coordinate della lavagna", () => {
    const stroke = penStroke(-40.5, 25.25);
    const record = written(strokeRecord(stroke, null, defaultInkLook(1, true), NOW));
    expect(record.anchor).toEqual({ kind: "free" });
    expect(Object.keys(record.anchor)).toEqual(["kind"]);
    const drawable = reread(record, null);
    expect(drawable.ref).toBeNull();
    expectSamePoints(drawable, null, stroke.samples);
    expect(toDry(record)!.ref).toBeNull();
  });

  it.each([0.01, 0.1, 8, 64])("lo spessore è 4 pixel dello schermo allo zoom %s", (zoom) => {
    const holder = card(0, 0, 4000, 4000);
    const stroke = penStroke(200, 300);
    const record = written(strokeRecord(stroke, holder, defaultInkLook(zoom, true), NOW));
    expect(parseInkBrush(record.brush).size).toBeCloseTo(4 / zoom, 12);
    const drawable = reread(record, holder);
    expectSamePoints(drawable, holder, stroke.samples);
    expect(toDry(record)!.path).not.toBe("");
  });

  it("il mouse senza pressione scrive senza il canale p e con la pressione simulata", () => {
    const stroke: InkStrokeInput = {
      samples: [{ x: 10, y: 10, t: 0 }, { x: 20, y: 15, t: 10 }, { x: 35, y: 12, t: 20 }],
      pressure: false,
      split: false,
    };
    // Anche un aspetto preso con la pressione: il tratto non ce l'ha.
    const record = written(strokeRecord(stroke, null, defaultInkLook(1, true), NOW));
    expect(decodeInk(record.ink).channels).toBe("xyt");
    expect(parseInkBrush(record.brush).sim).toBe(true);
    expectSamePoints(reread(record, null), null, stroke.samples);
  });

  it("un tratto di un punto solo si scrive e si disegna", () => {
    const holder = card(0, 0);
    const stroke: InkStrokeInput = { samples: [{ x: 50, y: 60, p: 0.5, t: 0 }], pressure: true, split: false };
    const record = written(strokeRecord(stroke, holder, defaultInkLook(1, true), NOW));
    expect(record.at).toBe(new Date(NOW).toISOString());
    expect(record.ink).toBe("1 s100 cxypt 5000,6000,128,0");
    expectSamePoints(reread(record, holder), holder, stroke.samples);
    expect(toDry(record)!.path).toMatch(/^M/);
  });

  it("un tratto spezzato dà un record per pezzo, e il pezzo che continua non si assottiglia", () => {
    const holder = card(0, 0);
    const look = defaultInkLook(1, true);
    expect((look.brush as Pf1Brush).taperEnd).toBeGreaterThan(0);
    const first = written(strokeRecord(penStroke(20, 20, { split: true }), holder, look, NOW));
    const second = written(strokeRecord(penStroke(50, 20), holder, look, NOW + 5));
    expect(first.id).not.toBe(second.id);
    expect((parseInkBrush(first.brush) as Pf1Brush).taperEnd).toBe(0);
    expect((parseInkBrush(second.brush) as Pf1Brush).taperEnd).toBe((look.brush as Pf1Brush).taperEnd);
    const layer = { v: 1, strokes: [first, second] };
    const [read] = readInkLayers({ nodes: [{ ...holder, "fub:ink": layer }], edges: [] });
    expect(read!.drawable.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it("oltre 10 000 campioni si rifiuta", () => {
    const samples: InkSample[] = Array.from({ length: 10_001 }, (_, i) => ({ x: i * 0.1, y: 0, t: i }));
    expect(strokeRecord({ samples, pressure: false, split: false }, null, defaultInkLook(1, false), NOW))
      .toEqual({ ok: false, reason: "full" });
  });

  it("una stringa ink oltre 512 KiB si rifiuta", () => {
    // 10 000 campioni che saltano da un capo all'altro dei numeri di fub:ink:
    // ogni campione scrive più di 52 byte.
    const far = 4.5e13;
    const samples: InkSample[] = Array.from({ length: 10_000 }, (_, i) => ({
      x: i % 2 === 0 ? -far : far,
      y: i % 2 === 0 ? far : -far,
      p: i % 2,
      t: i * 1_000_000,
      a: i % 2 === 0 ? 0 : 90,
      z: i % 2 === 0 ? 0 : 359,
    }));
    expect(strokeRecord({ samples, pressure: true, split: false }, null, defaultInkLook(1, true), NOW))
      .toEqual({ ok: false, reason: "full" });
  });

  it("campioni che il formato non scrive si rifiutano senza eccezioni", () => {
    const look = defaultInkLook(1, true);
    expect(strokeRecord({ samples: [], pressure: true, split: false }, null, look, NOW)).toEqual({ ok: false, reason: "failed" });
    const nan: InkStrokeInput = { samples: [{ x: Number.NaN, y: 0, p: 0.5, t: 0 }], pressure: true, split: false };
    expect(strokeRecord(nan, null, look, NOW)).toEqual({ ok: false, reason: "failed" });
    const huge: InkStrokeInput = { samples: [{ x: 1e300, y: 0, p: 0.5, t: 0 }], pressure: true, split: false };
    expect(strokeRecord(huge, null, look, NOW)).toEqual({ ok: false, reason: "failed" });
  });

  it("un'ora che non è un'ora lascia il tratto senza at", () => {
    const record = written(strokeRecord(penStroke(0, 0), null, defaultInkLook(1, true), Number.NaN));
    expect("at" in record).toBe(false);
    expect(Object.keys(record)).toEqual(["id", "tool", "brush", "color", "anchor", "ink"]);
  });

  it("un aspetto che il formato non scrive è un errore di chi chiama", () => {
    const look = defaultInkLook(1, true);
    expect(() => strokeRecord(penStroke(0, 0), null, { ...look, tool: "marker" }, NOW)).toThrow(RangeError);
    expect(() => strokeRecord(penStroke(0, 0), null, { ...look, color: "#07b" }, NOW)).toThrow(RangeError);
    expect(() => defaultInkLook(0, true)).toThrow(RangeError);
  });

  it("l'evidenziatore scrive il suo strumento", () => {
    const look = { ...defaultInkLook(1, true), tool: "highlighter", color: "#F0E442" };
    const record = written(strokeRecord(penStroke(0, 0), null, look, NOW));
    expect(record.tool).toBe("highlighter");
    expect(record.color).toBe("#F0E442");
    expect(reread(record, null).tool).toBe("highlighter");
  });
});

describe("toDry", () => {
  const record = written(strokeRecord(penStroke(10, 10), card(0, 0), defaultInkLook(1, true), NOW));

  it("non disegna un record che non vale", () => {
    expect(toDry({ ...record, color: "red" })).toBeNull();
    expect(toDry({ ...record, ink: "1 s100 cxyq 0,0,1" })).toBeNull();
    expect(toDry({ ...record, id: "" })).toBeNull();
  });

  it("riusa il percorso della cache", () => {
    const cache = new InkPathCache();
    const a = toDry(record, cache)!;
    expect(cache.size).toBe(1);
    const b = toDry(record, cache)!;
    expect(b.path).toBe(a.path);
    expect(cache.size).toBe(1);
  });
});

describe("i livelli", () => {
  it("un livello estraneo non si scrive, uno che manca o vale sì", () => {
    expect(inkLayerWritable(card(0, 0))).toBe(true);
    expect(inkLayerWritable({ ...card(0, 0), "fub:ink": { v: 1, strokes: [] } })).toBe(true);
    expect(inkLayerWritable({ ...card(0, 0), "fub:ink": { v: 2, strokes: [] } })).toBe(false);
    expect(inkLayerWritable({ nodes: [], edges: [], "fub:ink": "x" })).toBe(false);
  });

  it("readInkLayer legge il livello di una scheda o della radice", () => {
    const holder = { ...card(0, 0), "fub:ink": { v: 1, strokes: [record()] } };
    const doc: CanvasDocument = { nodes: [holder], edges: [] };
    expect(readInkLayer(doc, holder)!.layer).toEqual({ node: "n1" });
    expect(readInkLayer(doc, holder)!.drawable).toHaveLength(1);
    expect(readInkLayer(doc, null)).toBeNull();
  });

  function record(): InkStrokeRecord {
    return written(strokeRecord(penStroke(10, 10), card(0, 0), defaultInkLook(1, true), NOW));
  }
});
