import { describe, expect, it } from "vitest";
import type { InkSample } from "../../ink/sample";
import type { CardCellBox, CardPageBox } from "./cards";
import { erasableInk } from "./ink-erase";
import { decodeStroke, defaultInkLook, strokeRecord, type DrawableStroke, type InkLayerState } from "./ink-record";
import type { CanvasNode } from "./model";

// I tratti che `draw` scrive sulla pagina di un PDF e sulla cella di un
// foglio (LIC T19: `canvas-ops/draw-on-page*.json`, `draw-on-cell*.json`)
// riletti con le regole della tela di N6 T19 e T37:
//
// - `decodeStroke` legge l'ancora `page` (la pagina e la sua misura) o `cell`
//   (il foglio e l'indirizzo) come la scrive il nucleo;
// - `erasableInk` mette i campioni dove la tela li disegna, con la pagina o
//   la cella nell'angolo della scheda, un'unità della lavagna per punto PDF o
//   pixel del foglio;
// - `strokeRecord`, la penna della tela, scrive dagli stessi punti la stessa
//   ancora e gli stessi campioni.

type Json = Record<string, any>;

interface Vector {
  readonly ops: readonly Json[];
  readonly expect: { readonly outcome: string; readonly after?: Json; readonly created?: readonly string[] };
}

const files = import.meta.glob(["../../__fixtures__/canvas-ops/draw-on-page*.json", "../../__fixtures__/canvas-ops/draw-on-cell*.json"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const applied: ReadonlyArray<readonly [string, Vector]> = Object.entries(files)
  .map(([path, text]): [string, Vector] => [path.slice(path.lastIndexOf("/") + 1), JSON.parse(text) as Vector])
  .filter(([, vector]) => vector.expect.outcome === "applied")
  .sort(([a], [b]) => (a < b ? -1 : 1));

const NOW = Date.UTC(2026, 10, 15, 9, 0, 0);

/// La scheda di `on` dopo il `draw`, e il tratto che ha scritto.
function written(vector: Vector): { node: CanvasNode; record: Json } {
  const on = vector.ops[0]!.on as Json;
  const node = (vector.expect.after!.nodes as Json[]).find((item) => item.id === on.card)!;
  const record = (node["fub:ink"].strokes as Json[]).find((stroke) => stroke.id === vector.expect.created![0])!;
  return { node: node as unknown as CanvasNode, record };
}

/// Dove la scheda mostra la pagina o la cella di `on`: nel suo angolo, alla
/// scala 1.
function content(on: Json): { page: CardPageBox | null; cell: CardCellBox | null } {
  if (typeof on.page === "number") {
    const [width, height] = on.page_size as [number, number];
    return { page: { page: on.page, size: { width, height }, rect: { x: 0, y: 0, width, height } }, cell: null };
  }
  return { page: null, cell: { sheet: on.sheet, cell: on.cell, rect: { x: 0, y: 0, width: 64, height: 20 }, zoom: 1 } };
}

/// I campioni del tratto nelle unità dell'ancora.
function samplesOf(stroke: DrawableStroke): Array<{ x: number; y: number }> {
  const scale = stroke.ink.scale;
  return stroke.ink.samples.map((sample) => ({ x: sample.x / scale, y: sample.y / scale }));
}

describe("i tratti di draw sulla pagina e sulla cella si leggono con le regole della tela", () => {
  it("ci sono i vettori della pagina e della cella", () => {
    const names = applied.map(([name]) => name);
    expect(names).toContain("draw-on-page.json");
    expect(names).toContain("draw-on-cell.json");
    expect(names).toContain("draw-on-cell-last.json");
  });

  for (const [name, vector] of applied) {
    it(name, () => {
      const op = vector.ops[0]!;
      const on = op.on as Json;
      const { node, record } = written(vector);
      const stroke = decodeStroke(record);
      expect(stroke, "la tela disegna il tratto").not.toBeNull();
      const box = content(on);
      if (box.page) {
        expect(stroke!.page).toBe(on.page);
        expect(stroke!.ref).toEqual({ width: on.page_size[0], height: on.page_size[1] });
        expect(stroke!.cell).toBeNull();
      } else {
        expect(stroke!.cell).toEqual({ sheet: on.sheet, cell: on.cell });
        expect(stroke!.page).toBeNull();
        expect(stroke!.ref).toBeNull();
      }

      // Dove la tela lo mette: la pagina o la cella nell'angolo della scheda.
      const state = {
        layer: { node: node.id },
        node,
        state: "ok",
        strokes: [{ id: stroke!.id, drawn: true as const, stroke }],
        drawable: [stroke],
      } as unknown as InkLayerState;
      const units = erasableInk([state], () => box.page, () => null, (_node, sheet, cell) =>
        box.cell && box.cell.sheet === sheet && box.cell.cell === cell ? box.cell : null,
      );
      expect(units).toHaveLength(1);
      const local = samplesOf(stroke!);
      const placed = units[0]!.points;
      expect(placed).toHaveLength(local.length * 2);
      local.forEach((sample, i) => {
        expect(placed[2 * i]).toBeCloseTo(node.x + sample.x, 9);
        expect(placed[2 * i + 1]).toBeCloseTo(node.y + sample.y, 9);
      });
      if (Array.isArray(op.points)) {
        // I punti dati sono quelli scritti, nelle unità dell'ancora.
        expect(local).toHaveLength(op.points.length);
        (op.points as number[][]).forEach(([x, y], i) => {
          expect(local[i]!.x).toBeCloseTo(x!, 2);
          expect(local[i]!.y).toBeCloseTo(y!, 2);
        });
      }

      // La penna della tela, dagli stessi punti sulla lavagna, scrive la
      // stessa ancora e gli stessi campioni.
      const samples: InkSample[] = local.map((sample, i) => ({ x: node.x + sample.x, y: node.y + sample.y, p: 0.5, t: i * 8 }));
      const gui = strokeRecord({ samples, pressure: true, split: false }, node, defaultInkLook(1, true), NOW, box.page ?? box.cell);
      if (!gui.ok) throw new Error(`la tela rifiuta il tratto: ${gui.reason}`);
      expect(gui.record.anchor).toEqual(record.anchor);
      const reread = decodeStroke(gui.record as unknown as Json);
      expect(reread).not.toBeNull();
      const guiLocal = samplesOf(reread!);
      expect(guiLocal).toHaveLength(local.length);
      guiLocal.forEach((sample, i) => {
        expect(sample.x).toBeCloseTo(local[i]!.x, 2);
        expect(sample.y).toBeCloseTo(local[i]!.y, 2);
      });
    });
  }
});
