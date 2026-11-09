import { afterEach, describe, expect, it } from "vitest";
import { parseInkBrush } from "../../ink/brush";
import { quantizeInk, type InkSample } from "../../ink/sample";
import { EraseSweep, type Spot } from "../../ink/tools/sweep";
import { ERASER } from "../../ink/tools/eraser";
import { decodeInk, encodeInk, inkFromQuantized, inkToQuantized } from "../spatial/ink/codec";
import { cutInk, cutPath, cutStrokePatches, erasableInk, InkEraseSource, inkKey, pieceRecords, type ErasableInk } from "./ink-erase";
import { decodeStroke, type DrawableStroke, type InkLayerState } from "./ink-record";
import type { CanvasDocument, CanvasNode } from "./model";
import type { StoredInkStroke } from "./operation";
import { openCore, type CanvasCore } from "./wasm/core";

/// Un tratto disegnato coi soli campi che la gomma legge: punti in unità
/// dell'ancora (scala 100), spessore 4.
function drawable(id: string, points: readonly (readonly [number, number])[], ref: { width: number; height: number } | null): DrawableStroke {
  return {
    id,
    ref,
    brush: { size: 4 },
    ink: { scale: 100, samples: points.map(([x, y], t) => ({ x: x * 100, y: y * 100, t })) },
  } as unknown as DrawableStroke;
}

function layer(node: CanvasNode | null, strokes: readonly DrawableStroke[], state: "ok" | "foreign" = "ok"): InkLayerState {
  return {
    layer: node ? { node: node.id } : "board",
    node,
    state,
    strokes: strokes.map((stroke) => ({ id: stroke.id, drawn: true as const, stroke })),
    drawable: state === "ok" ? strokes : [],
  };
}

/// Le chiavi che una passata da `from` a `to` prende, a zoom 1.
function swept(states: readonly InkLayerState[], from: readonly [number, number], to: readonly [number, number]): string[] {
  const source = new InkEraseSource(erasableInk(states));
  const sweep = new EraseSweep(ERASER, "pen");
  sweep.along(source, from, 1);
  sweep.along(source, to, 1);
  return sweep.marked().map((unit) => unit.key);
}

describe("che cosa prende la gomma sulla lavagna", () => {
  const note: CanvasNode = { id: "n", type: "text", x: 100, y: 100, width: 60, height: 40 } as CanvasNode;
  const image: CanvasNode = { id: "i", type: "file", x: 0, y: 0, width: 400, height: 100, file: "foto.png" } as CanvasNode;

  it("su una nota rimpicciolita il tratto resta dove è scritto, anche fuori dalla scheda", () => {
    // Scritto su 200 × 100, la nota ora è 60 × 40: il tratto a (150, 50) della scheda esce.
    const states = [layer(note, [drawable("a", [[140, 50], [160, 50]], { width: 200, height: 100 })])];
    expect(swept(states, [250, 130], [250, 170])).toEqual([inkKey({ node: "n" }, "a")]);
    // Non dove sarebbe stirato nella misura di adesso (× 0,3).
    expect(swept(states, [145, 105], [145, 125])).toEqual([]);
  });

  it("su un'immagine allargata il tratto scala e si centra", () => {
    // Riferimento 200 × 100 su 400 × 100: s = 1, spostato di 100.
    const states = [layer(image, [drawable("a", [[50, 50], [60, 50]], { width: 200, height: 100 })])];
    expect(swept(states, [155, 30], [155, 70])).toEqual([inkKey({ node: "i" }, "a")]);
    expect(swept(states, [55, 30], [55, 70])).toEqual([]);
  });

  it("il raggio della gomma e lo spessore del tratto contano; un tratto di un punto si prende", () => {
    const states = [layer(null, [drawable("a", [[0, 0], [100, 0]], null), drawable("b", [[50, 40]], null)])];
    // 8 di gomma più 2 di metà spessore: a 9 sì, a 11 no.
    expect(swept(states, [50, 9], [60, 9])).toEqual([inkKey("board", "a")]);
    expect(swept(states, [50, 11], [60, 11])).toEqual([]);
    expect(swept(states, [40, 40], [60, 40])).toEqual([inkKey("board", "b")]);
  });

  it("un livello estraneo e un tratto non disegnato non si prendono", () => {
    const foreign = layer(note, [drawable("a", [[0, 0], [50, 0]], null)], "foreign");
    const kept: InkLayerState = { layer: "board", node: null, state: "ok", strokes: [{ id: "x", drawn: false, reason: "decode" }], drawable: [] };
    expect(erasableInk([foreign, kept])).toEqual([]);
  });

  it("le chiavi distinguono lo stesso id in livelli diversi", () => {
    expect(inkKey("board", "a")).not.toBe(inkKey({ node: "board" }, "a"));
    expect(inkKey({ node: "a" }, "b\u0000c")).not.toBe(inkKey({ node: "a\u0000b" }, "c"));
    expect(inkKey({ node: "a" }, '","b')).not.toBe(inkKey({ node: 'a","' }, "b"));
  });
});

// La gomma «Solo il pezzo» (T22): tratti scritti a mano, coi campi del file.
const CUT_BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=10 taperEnd=10 capStart=1 capEnd=1 sim=0 pen=ballpoint";

/// Un tratto del file: un campione ogni 10 unità da `x0` a `x1` sulla riga
/// `y`, `t` in millisecondi pari a `x − x0`, pressione che sale.
function record(id: string, x0: number, x1: number, y: number, extra: Record<string, unknown> = {}): StoredInkStroke {
  const samples: InkSample[] = [];
  for (let x = x0, i = 0; x <= x1; x += 10, i++) samples.push({ x, y, t: x - x0, p: Math.min(1, 0.2 + i * 0.05) });
  return {
    id,
    tool: "pen",
    at: "2026-11-09T10:00:00.000Z",
    brush: CUT_BRUSH,
    color: "#0072b2",
    anchor: { kind: "free" },
    ink: encodeInk(inkFromQuantized(quantizeInk(samples, 100))),
    ...extra,
  };
}

/// Il tratto `stroke` libero sulla radice, pronto per la gomma.
function unitOf(stroke: StoredInkStroke): ErasableInk {
  const drawable = decodeStroke(stroke)!;
  return erasableInk([{ layer: "board", node: null, state: "ok", strokes: [{ id: stroke.id, drawn: true, stroke: drawable }], drawable: [drawable] }])[0]!;
}

const vertical = (x: number): Spot[] => [[x, -50], [x, 50]];

describe("la gomma che taglia: i pezzi", () => {
  it("un passaggio a metà dà due pezzi coi campi del tratto, id nuovi, `at` spostato e la pressione dei loro campioni", () => {
    const stroke = record("a", 0, 100, 0, { "x-mine": { k: [1, 2] }, layerless: true });
    const pieces = cutInk(unitOf(stroke), vertical(50), 3)!;
    // 3 di gomma più 2 di metà spessore: il taglio va da 45 a 55.
    expect(pieces).toHaveLength(2);
    let n = 0;
    const records = pieceRecords(decodeStroke(stroke)!, pieces, () => `p${++n}`);
    expect(records.map((each) => each.id)).toEqual(["p1", "p2"]);
    for (const each of records) {
      expect(Object.keys(each)).toEqual(Object.keys(stroke));
      expect(each).toMatchObject({ tool: "pen", color: "#0072b2", anchor: { kind: "free" }, "x-mine": { k: [1, 2] }, layerless: true });
    }
    expect(records[0]!.at).toBe("2026-11-09T10:00:00.000Z");
    expect(records[1]!.at).toBe("2026-11-09T10:00:00.055Z");
    // Ai tagli niente rastremazione; ai capi del tratto resta.
    expect(parseInkBrush(records[0]!.brush as string)).toMatchObject({ taperStart: 10, taperEnd: 0 });
    expect(parseInkBrush(records[1]!.brush as string)).toMatchObject({ taperStart: 0, taperEnd: 10 });
    const first = inkToQuantized(decodeInk(records[0]!.ink as string)).samples;
    const second = inkToQuantized(decodeInk(records[1]!.ink as string)).samples;
    const original = inkToQuantized(decodeInk(stroke.ink as string)).samples;
    // I campioni interi tengono la loro pressione; quello del taglio sta in mezzo.
    expect(first.slice(0, 5)).toEqual(original.slice(0, 5));
    expect(first[5]!.x).toBeCloseTo(4500, -1);
    expect(first[5]!.p!).toBeGreaterThan(original[4]!.p!);
    expect(first[5]!.p!).toBeLessThan(original[5]!.p!);
    expect(second[0]!.t).toBe(0);
    expect(second[0]!.x).toBeCloseTo(5500, -1);
    expect(second.slice(1).map((each) => each.p)).toEqual(original.slice(6).map((each) => each.p));
  });

  it("un tratto non toccato non si taglia, uno coperto tutto se ne va senza pezzi", () => {
    expect(cutInk(unitOf(record("a", 0, 100, 0)), vertical(300), 3)).toBeNull();
    expect(cutInk(unitOf(record("a", 0, 20, 0)), [[-40, 0], [60, 0]], 8)).toEqual([]);
    // Un tratto di un campione solo, toccato, se ne va tutto.
    expect(cutInk(unitOf(record("b", 0, 0, 0)), vertical(1), 3)).toEqual([]);
  });

  it("tagliato a un capo resta un pezzo, con un id di `newNodeId`; senza `at` il pezzo non ne prende uno", () => {
    const stroke = record("a", 0, 100, 0);
    delete (stroke as Record<string, unknown>).at;
    const pieces = cutInk(unitOf(stroke), vertical(0), 3)!;
    expect(pieces).toHaveLength(1);
    const [only] = pieceRecords(decodeStroke(stroke)!, pieces);
    expect(only!.id).toMatch(/^s-/);
    expect("at" in only!).toBe(false);
    expect(parseInkBrush(only!.brush as string)).toMatchObject({ taperStart: 0, taperEnd: 10 });
    expect(cutPath(pieces)).not.toBe("");
  });

  it("su un'immagine allargata taglia dove il tratto si vede", () => {
    // Riferimento 200 × 100 su 400 × 100: s = 1, spostato di 100.
    const image: CanvasNode = { id: "i", type: "file", x: 0, y: 0, width: 400, height: 100, file: "foto.png" } as CanvasNode;
    const stroke = { ...record("a", 0, 100, 50), anchor: { kind: "card", width: 200, height: 100 } };
    const drawable = decodeStroke(stroke)!;
    const [unit] = erasableInk([{ layer: { node: "i" }, node: image, state: "ok", strokes: [{ id: "a", drawn: true, stroke: drawable }], drawable: [drawable] }]);
    expect(cutInk(unit!, vertical(50), 3)).toBeNull();
    const pieces = cutInk(unit!, [[150, 0], [150, 100]], 3)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.ink.samples[pieces[0]!.ink.samples.length - 1]!.x).toBeCloseTo(4500, -1);
  });
});

const cores: CanvasCore[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
});

describe("la gomma che taglia: le toppe", () => {
  it("i pezzi vanno al posto del tratto, nel suo ordine, e l'inversa ridà il testo di prima", async () => {
    const strokes = [record("a", 0, 100, 0), record("b", 0, 100, 20), record("c", 0, 100, 40), record("d", 0, 20, 60)];
    const source = JSON.stringify({ nodes: [], edges: [], "fub:ink": { v: 1, strokes } });
    const core = await openCore(source);
    cores.push(core);
    const doc: CanvasDocument = core.model();
    const piece = (id: string) => ({ ...record(id, 0, 10, 0) });
    const patches = cutStrokePatches(doc, core.inkLayers(), "board", [
      { id: "c", pieces: [piece("c1"), piece("c2"), piece("c3")] },
      { id: "a", pieces: [piece("a1"), piece("a2")] },
      { id: "d", pieces: [] },
    ])!;
    expect(patches.filter((patch) => patch.after === null)).toHaveLength(3);
    expect(patches.filter((patch) => patch.before === null)).toHaveLength(5);
    const { edit, inverse } = core.commit(patches);
    const after = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    const ids = (core.model()["fub:ink"] as { strokes: StoredInkStroke[] }).strokes.map((each) => each.id);
    expect(ids).toEqual(["a1", "a2", "b", "c1", "c2", "c3"]);
    const back = core.commit(inverse).edit;
    expect(after.slice(0, back.start) + back.text + after.slice(back.end)).toBe(source);
  });

  it("un tratto che non c'è, ripetuto, o un livello che non si scrive non fanno toppe", async () => {
    const source = JSON.stringify({ nodes: [], edges: [], "fub:ink": { v: 1, strokes: [record("a", 0, 100, 0)] } });
    const core = await openCore(source);
    cores.push(core);
    const layers = core.inkLayers();
    expect(cutStrokePatches(core.model(), layers, "board", [{ id: "x", pieces: [] }])).toBeNull();
    expect(cutStrokePatches(core.model(), layers, "board", [{ id: "a", pieces: [] }, { id: "a", pieces: [] }])).toBeNull();
    expect(cutStrokePatches(core.model(), layers, { node: "manca" }, [{ id: "a", pieces: [] }])).toBeNull();
    expect(cutStrokePatches(core.model(), layers, "board", [{ id: "a", pieces: [record("a", 0, 10, 0)] }])).toBeNull();
  });
});
