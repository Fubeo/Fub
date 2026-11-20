import { describe, expect, it } from "vitest";
import type { Spot } from "../../ink/tools/sweep";
import type { CardCellBox, CardPageBox } from "../core/cards/contract";
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

/// Dove la scheda mostra la pagina o la cella di `on`: nel suo angolo, un'unità
/// della lavagna per punto PDF o pixel del foglio (`corner`), o spostata, e la
/// pagina scalata (`moved`: la pagina in `{x: 12, y: 44}`, 595/360 punti per
/// unità, un A4 in `360 × 509.4…`; la cella in `{x: 104, y: 60}`), così
/// `pageFit` e il passaggio dalla lavagna al contenuto non sono l'identità.
/// Il rettangolo ha le proporzioni della pagina mostrata, come `pageBox()`
/// della scheda: un tratto scritto a un'altra misura ci va con `pageFit`.
type Placement = "corner" | "moved";
const K = 595 / 360;
const PLACEMENTS: readonly Placement[] = ["corner", "moved"];

/// I tratti di ogni livello dopo la passata della tela: quelli tagliati
/// lasciano il posto ai loro pezzi. La chiave è l'id della scheda, `""` per
/// la radice.
function guiAfter(vector: Vector, placement: Placement): Map<string, Json[]> {
  const op = vector.ops[0]!;
  // `on` sulla pagina di un PDF o sulla cella di un foglio (LIC T19): la
  // scheda è `card`, e la tela mostra la pagina o la cella dove dice
  // `placement`.
  const content: Json | null = typeof op.on === "object" && op.on !== null ? op.on : null;
  const on: string = content ? content.card : (op.on ?? "auto");
  const created = [...(vector.expect.created ?? [])];
  const layers = layersOf(vector.before);
  let path = op.points as Spot[];
  let radius = op.size / 2;
  // La pagina mostrata: la misura data, o quella dell'ancora dei suoi tratti.
  const shownSize = (layer: Layer): [number, number] => {
    const written = layer.strokes.find((record) => record.anchor?.kind === "page" && record.anchor.page === content!.page);
    return (content!.page_size as [number, number] | undefined) ?? [written?.anchor.width, written?.anchor.height];
  };
  const pageRect = (width: number, height: number) =>
    placement === "corner" ? { x: 0, y: 0, width, height } : { x: 12, y: 44, width: width / K, height: height / K };
  const cellRect = placement === "corner" ? { x: 0, y: 0, width: 64, height: 20 } : { x: 104, y: 60, width: 64, height: 20 };
  if (on !== "auto" && on !== "board") {
    // Le coordinate della scheda, della pagina o della cella diventano della
    // lavagna, come la tela le mostra: sulla pagina col fattore di `pageFit`
    // (il minore, dall'angolo del rettangolo), che scala anche il raggio.
    const layer = layers.find((item) => item.node?.id === on)!;
    const card = layer.node!;
    let fit = { s: 1, x: 0, y: 0 };
    if (content && typeof content.page === "number") {
      const [width, height] = shownSize(layer);
      const rect = pageRect(width, height);
      fit = { s: Math.min(rect.width / width, rect.height / height), x: rect.x, y: rect.y };
    } else if (content) {
      fit = { s: 1, x: cellRect.x, y: cellRect.y };
    }
    if (placement === "moved" && content) expect(fit.s === 1 && fit.x === 0 && fit.y === 0, "non è l'identità").toBe(false);
    path = path.map(([x, y]): Spot => [card.x + fit.x + fit.s * x, card.y + fit.y + fit.s * y]);
    radius *= fit.s;
  }
  const touched = layers.filter((layer) =>
    on === "auto" ? true : on === "board" ? layer.node === null : layer.node?.id === on,
  );
  const pageBox = (layer: Layer): CardPageBox | null => {
    if (!content || typeof content.page !== "number") return null;
    const [width, height] = shownSize(layer);
    return { page: content.page, size: { width, height }, rect: pageRect(width, height) };
  };
  const cellBox = (node: string, sheet: string, cell: string): CardCellBox | null =>
    content && node === on && content.sheet === sheet && content.cell === cell
      ? { sheet, cell, rect: cellRect, zoom: 1 }
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
      const pieces = unit ? cutInk(unit, path, radius) : null;
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
    expect(names).toContain("erase-along-on-page-wider-than-tall.json");
    expect(names).toContain("erase-along-on-cell.json");
  });

  for (const [name, vector] of applied) for (const placement of PLACEMENTS) {
    // Lo spostamento conta solo con la pagina o la cella in `on`.
    if (placement === "moved" && typeof vector.ops[0]!.on !== "object") continue;
    it(`${name} (${placement})`, () => {
      const gui = guiAfter(vector, placement);
      const after = new Map(layersOf(vector.expect.after!).map((layer) => [layer.node?.id ?? "", layer.strokes]));
      for (const [key, strokes] of gui) {
        // Un livello rimasto senza tratti perde la chiave `fub:ink`.
        expect(after.get(key) ?? [], `${name}: il livello ${key || "della radice"}`).toEqual(strokes);
      }
      expect([...after.keys()].every((key) => gui.has(key))).toBe(true);
    });
  }
});
