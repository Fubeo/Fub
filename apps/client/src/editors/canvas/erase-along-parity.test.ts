import { describe, expect, it } from "vitest";
import type { Spot } from "../../ink/tools/sweep";
import type { CardCellBox, CardPageBox } from "./cards";
import { cutInk, erasableInk, pieceRecords } from "./ink-erase";
import { decodeStroke, type DrawableStroke, type InkLayerState } from "./ink-record";
import type { CanvasNode } from "./model";

// I vettori di `erase_along` (`canvas-ops/erase-along-*.json`) rifatti dalla
// gomma «Solo il pezzo» della tela: `erasableInk` porta i tratti nelle
// coordinate della lavagna, `cutInk` li taglia e `pieceRecords` scrive i
// pezzi, con gli id che il nucleo ha dato (`expect.created`, nell'ordine).
// Ogni livello che ne esce deve essere quello di `expect.after`, campo per
// campo: così il taglio del nucleo è quello che la tela fa a mano.
//
// I vettori rifiutati o che non si leggono non hanno pezzi da confrontare.

type Json = Record<string, any>;

interface Vector {
  readonly about: string;
  readonly before: Json;
  readonly seed?: number;
  readonly ops: readonly Json[];
  readonly expect: { readonly outcome: string; readonly after?: Json; readonly created?: readonly string[] };
}

const files = import.meta.glob("../../__fixtures__/canvas-ops/erase-along-*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const vectors: ReadonlyArray<readonly [string, Vector]> = Object.entries(files)
  .map(([path, text]): [string, Vector] => [path.slice(path.lastIndexOf("/") + 1), JSON.parse(text) as Vector])
  .sort(([a], [b]) => (a < b ? -1 : 1));

interface Layer {
  readonly node: CanvasNode | null;
  readonly strokes: readonly Json[];
}

/// I livelli di una lavagna, nell'ordine delle schede e poi la radice, come
/// li legge il nucleo; tutti `ok` (i vettori qui non hanno livelli estranei).
function layersOf(doc: Json): Layer[] {
  const layers: Layer[] = [];
  for (const node of doc.nodes as CanvasNode[]) {
    const ink = (node as unknown as Json)["fub:ink"];
    if (ink) layers.push({ node, strokes: ink.strokes });
  }
  if (doc["fub:ink"]) layers.push({ node: null, strokes: doc["fub:ink"].strokes });
  return layers;
}

function stateOf(layer: Layer): InkLayerState {
  const drawable = layer.strokes
    .map((record) => decodeStroke(record))
    .filter((stroke): stroke is DrawableStroke => stroke !== null);
  return {
    layer: layer.node ? { node: layer.node.id } : "board",
    node: layer.node,
    state: "ok",
    strokes: drawable.map((stroke) => ({ id: stroke.id, drawn: true as const, stroke })),
    drawable,
  } as unknown as InkLayerState;
}

/// I tratti di ogni livello dopo la passata della tela: quelli tagliati
/// lasciano il posto ai loro pezzi. La chiave è l'id della scheda, `""` per
/// la radice.
function guiAfter(vector: Vector): Map<string, Json[]> {
  const op = vector.ops[0]!;
  // `on` sulla pagina di un PDF o sulla cella di un foglio (LIC T19): la
  // scheda è `card`, e la tela mostra la pagina o la cella nel suo angolo,
  // un'unità della lavagna per punto PDF o pixel del foglio.
  const content: Json | null = typeof op.on === "object" && op.on !== null ? op.on : null;
  const on: string = content ? content.card : (op.on ?? "auto");
  const created = [...(vector.expect.created ?? [])];
  const layers = layersOf(vector.before);
  let path = op.points as Spot[];
  if (on !== "auto" && on !== "board") {
    // Le coordinate della scheda diventano della lavagna, come fa la tela.
    const card = layers.find((layer) => layer.node?.id === on)!.node!;
    path = path.map(([x, y]): Spot => [x + card.x, y + card.y]);
  }
  const touched = layers.filter((layer) =>
    on === "auto" ? true : on === "board" ? layer.node === null : layer.node?.id === on,
  );
  // La pagina mostrata: la misura data, o quella dell'ancora dei suoi tratti.
  const pageBox = (layer: Layer): CardPageBox | null => {
    if (!content || typeof content.page !== "number") return null;
    const written = layer.strokes.find((record) => record.anchor?.kind === "page" && record.anchor.page === content.page);
    const [width, height] = (content.page_size as [number, number] | undefined) ?? [written?.anchor.width, written?.anchor.height];
    return { page: content.page, size: { width, height }, rect: { x: 0, y: 0, width, height } };
  };
  const cellBox = (node: string, sheet: string, cell: string): CardCellBox | null =>
    content && node === on && content.sheet === sheet && content.cell === cell
      ? { sheet, cell, rect: { x: 0, y: 0, width: 64, height: 20 }, zoom: 1 }
      : null;
  // Con la pagina o la cella in `on` la gomma in codice guarda solo i loro
  // tratti: dove stanno gli altri, rispetto alla pagina o alla cella, lo sa
  // la resa. La gomma della tela, che passa sulla scheda, taglierebbe anche
  // quelli che il cammino tocca.
  const ofContent = (stroke: DrawableStroke): boolean =>
    !content
      || (typeof content.page === "number"
        ? stroke.page === content.page
        : stroke.cell?.sheet === content.sheet && stroke.cell?.cell === content.cell);
  const result = new Map<string, Json[]>();
  for (const layer of layers) {
    const key = layer.node?.id ?? "";
    if (!touched.includes(layer)) {
      result.set(key, [...layer.strokes]);
      continue;
    }
    // `aspect` è la proporzione del contenuto della scheda di `on`: la tela
    // la dà a `erasableInk` con `aspects`, per scheda.
    const aspects = (node: string): number | null => (node === on && typeof op.aspect === "number" ? op.aspect : null);
    const units = new Map(
      erasableInk([stateOf(layer)], () => pageBox(layer), aspects, cellBox)
        .filter((unit) => ofContent(unit.stroke))
        .map((unit) => [unit.id, unit]),
    );
    const strokes: Json[] = [];
    for (const record of layer.strokes) {
      const unit = units.get(record.id);
      const pieces = unit ? cutInk(unit, path, op.size / 2) : null;
      if (unit && pieces) strokes.push(...pieceRecords(unit.stroke, pieces, () => created.shift()!));
      else strokes.push(record);
    }
    result.set(key, strokes);
  }
  expect(created, "ogni id dato dal nucleo è di un pezzo della tela").toEqual([]);
  return result;
}

describe("erase_along come la gomma «Solo il pezzo»", () => {
  const applied = vectors.filter(([, vector]) => vector.expect.outcome === "applied");

  it("ci sono i vettori del taglio a metà e della lavagna con l'immagine", () => {
    const names = applied.map(([name]) => name);
    expect(names).toContain("erase-along-cuts-in-half.json");
    expect(names).toContain("erase-along-auto-board-and-card.json");
    expect(names).toContain("erase-along-aspect.json");
    expect(names).toContain("erase-along-on-page.json");
    expect(names).toContain("erase-along-on-page-other-size.json");
    expect(names).toContain("erase-along-on-cell.json");
  });

  for (const [name, vector] of applied) {
    it(name, () => {
      const gui = guiAfter(vector);
      const after = new Map(layersOf(vector.expect.after!).map((layer) => [layer.node?.id ?? "", layer.strokes]));
      for (const [key, strokes] of gui) {
        // Un livello rimasto senza tratti perde la chiave `fub:ink`.
        expect(after.get(key) ?? [], `${name}: il livello ${key || "della radice"}`).toEqual(strokes);
      }
      expect([...after.keys()].every((key) => gui.has(key))).toBe(true);
    });
  }
});
