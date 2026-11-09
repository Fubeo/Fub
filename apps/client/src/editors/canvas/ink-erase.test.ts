import { describe, expect, it } from "vitest";
import { EraseSweep } from "../../ink/tools/sweep";
import { ERASER } from "../../ink/tools/eraser";
import { erasableInk, InkEraseSource, inkKey } from "./ink-erase";
import type { DrawableStroke, InkLayerState } from "./ink-record";
import type { CanvasNode } from "./model";

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
