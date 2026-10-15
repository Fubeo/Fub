// Le forme coi parametri: i poligoni e le stelle, e gli angoli arrotondati
// dei rettangoli (formato della scena, §4 e §6). Che cosa ne mostra il
// pannello delle proprietà, i cambi che ne scrive, e la maniglia degli
// angoli sul foglio.
//
// - **Si cambiano gli oggetti scelti, non le loro parti.** Un poligono
//   dentro un gruppo scelto resta com'è: i lati sono di chi si sceglie.
// - **Il raggio degli angoli si misura nella scena**: quello scritto per la
//   scala dell'oggetto, la media dei due assi, così il campo e la maniglia
//   dicono ciò che si vede; si scrive diviso per la stessa scala.
// - **Un rettangolo** ha gli angoli in `rx`: `ry` si toglie, perché in SVG un
//   raggio assente vale l'altro, e zero toglie anche `rx`.
// - **Dal poligono alla stella** restano centro, raggio, rotazione, numero
//   e angoli; la stella prende il rapporto interno dello strumento.
// - **La maniglia degli angoli** sta sulla bisettrice del vertice più in alto
//   sullo schermo, a pari altezza il più a sinistra: una punta, per la
//   stella. Sta dentro il vertice di un tratto fisso dello schermo più la
//   distanza del centro dell'arco, così, tirata lungo la bisettrice, resta
//   sotto il puntatore e cambia il raggio di tutti gli angoli.

import { formatNumber } from "../number";
import { apply, type Matrix, type Point } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import { MAX_COUNT, MIN_COUNT, polygonalAttrs, polygonalVertices, type Polygonal, type PolygonalShape } from "../scene/parametric";
import { length, nonNegativeLength } from "../scene/values";
import { fubAttributes, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import { directionCursor, type GripCursor } from "./frame";
import type { Unit } from "./hit";
import type { Shared } from "./look";
import { MIN_RATIO, polygonCount, withCount, type PolygonTool } from "./shapes";

/// Le forme coi parametri fra gli oggetti scelti, o quelle dello strumento.
export interface ShapeFacts {
  /// I poligoni e le stelle, con la forma se è la stessa.
  readonly shape: Shared<PolygonalShape>;
  /// I loro lati, o punte.
  readonly count: Shared<number>;
  /// Il rapporto interno delle stelle.
  readonly ratio: Shared<number>;
  /// Il raggio degli angoli di poligoni, stelle e rettangoli, nella scena.
  readonly corner: Shared<number>;
}

/// Un cambio di «Forma».
export type ShapeChange =
  | { readonly shape: PolygonalShape }
  | { readonly count: number }
  | { readonly ratio: number }
  /// Nella scena.
  | { readonly corner: number };

/// La scala media di `m`: quanto vi diventa lunga una lunghezza.
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/// Un valore della geometria come lo scrive il file.
const written = (value: number): number => Number(formatNumber(value, 2));

/// Il valore comune di `values`; un valore che non è un numero non è comune
/// a niente.
function sharedOf<T>(values: readonly T[]): Shared<T> {
  const first = values[0];
  const same = first !== undefined && first === first && values.every((value) => value === first);
  return { count: values.length, value: same ? first : null };
}

/// I raggi degli angoli di un rettangolo, com'è scritto: in SVG un raggio
/// assente vale l'altro.
function rectRadii(node: ElementPart): Point {
  const own = plainAttributes(node);
  const rx = nonNegativeLength(own.get("rx") ?? "");
  const ry = nonNegativeLength(own.get("ry") ?? "");
  return [rx ?? ry ?? 0, ry ?? rx ?? 0];
}

/// Le forme coi parametri di `units`; `null` se non ce ne sono.
export function shapeFacts(model: DocumentModel, units: readonly Unit[]): ShapeFacts | null {
  const shapes: Polygonal[] = [];
  const corners: number[] = [];
  for (const unit of units) {
    const node = nodeOf(model, unit);
    const k = scaleOf(unit.matrix);
    const polygonal = node.details?.polygonal;
    if (polygonal !== undefined) {
      shapes.push(polygonal);
      corners.push(written(polygonal.corner * k));
    } else if (unit.role === "rect") {
      const [rx, ry] = rectRadii(node);
      // Due raggi diversi non sono un raggio solo.
      corners.push(rx === ry ? written(rx * k) : Number.NaN);
    }
  }
  if (corners.length === 0) return null;
  const stars = shapes.filter((shape) => shape.shape === "star");
  return {
    shape: sharedOf(shapes.map((shape) => shape.shape)),
    count: sharedOf(shapes.map((shape) => shape.count)),
    ratio: sharedOf(stars.map((shape) => shape.ratio!)),
    corner: sharedOf(corners),
  };
}

/// Le forme dello strumento Poligono, come le mostra il pannello senza
/// selezione.
export function toolFacts(tool: PolygonTool): ShapeFacts {
  return {
    shape: { count: 1, value: tool.shape },
    count: { count: 1, value: polygonCount(tool) },
    ratio: tool.shape === "star" ? { count: 1, value: tool.ratio } : { count: 0, value: null },
    corner: { count: 1, value: tool.corner },
  };
}

/// Il rapporto interno `ratio` fra quelli che una stella ammette.
const ratioIn = (ratio: number): number => Math.min(1, Math.max(MIN_RATIO, ratio));

/// Lo strumento dopo `change`.
export function toolWith(tool: PolygonTool, change: ShapeChange): PolygonTool {
  if ("shape" in change) return { ...tool, shape: change.shape };
  if ("count" in change) return withCount(tool, change.count);
  if ("ratio" in change) return { ...tool, ratio: ratioIn(change.ratio) };
  return { ...tool, corner: Math.max(0, change.corner) };
}

/// `polygonal` dopo `change`, in un oggetto di scala `k`; `null` se non
/// cambia. `ratio` è il rapporto di una stella che nasce da un poligono.
function reshaped(polygonal: Polygonal, change: ShapeChange, k: number, ratio: number): Polygonal | null {
  if ("shape" in change) {
    if (change.shape === polygonal.shape) return null;
    return { ...polygonal, shape: change.shape, ratio: change.shape === "star" ? ratioIn(ratio) : null };
  }
  if ("count" in change) return { ...polygonal, count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(change.count))) };
  if ("ratio" in change) return polygonal.shape === "star" ? { ...polygonal, ratio: ratioIn(change.ratio) } : null;
  return k > 0 ? { ...polygonal, corner: Math.max(0, change.corner / k) } : null;
}

/// Gli attributi che `change` scrive in `node`, di scala `k`; `null` se non
/// ne cambia nessuno.
function changedAttrs(node: ElementPart, role: string, change: ShapeChange, k: number, ratio: number): Record<string, string | null> | null {
  const polygonal = node.details?.polygonal;
  if (polygonal !== undefined) {
    const next = reshaped(polygonal, change, k, ratio);
    const attrs = next === null ? null : polygonalAttrs(next);
    if (attrs === null) return null;
    const fub = fubAttributes(node);
    if (attrs["fub:shape"] === fub.get("shape") && attrs["fub:geom"] === fub.get("geom")) return null;
    return { ...(attrs["fub:shape"] === fub.get("shape") ? {} : { "fub:shape": attrs["fub:shape"] }), "fub:geom": attrs["fub:geom"], d: attrs.d };
  }
  if (role !== "rect" || !("corner" in change) || !(k > 0)) return null;
  const own = plainAttributes(node);
  const radius = formatNumber(Math.max(0, change.corner / k), 2);
  const attrs: Record<string, string | null> = {};
  if (radius === "0") {
    if (own.has("rx")) attrs.rx = null;
  } else if (own.get("rx") === undefined || length(own.get("rx")!) !== Number(radius)) {
    attrs.rx = radius;
  }
  if (own.has("ry")) attrs.ry = null;
  return Object.keys(attrs).length === 0 ? null : attrs;
}

/// Le operazioni che danno `change` agli oggetti `units`, coi lati e gli
/// angoli che hanno; `tool` dà il rapporto alle stelle che nascono da un
/// poligono. La selezione resta la stessa.
export function shapeOps(model: DocumentModel, units: readonly Unit[], change: ShapeChange, ids: NewIds, tool: PolygonTool): Arranged & { readonly changed: number } {
  const plan = new Plan(model, ids);
  let changed = 0;
  const nodes = units.map((unit) => nodeOf(model, unit));
  units.forEach((unit, at) => {
    const node = nodes[at]!;
    const attrs = changedAttrs(node, unit.role, change, scaleOf(unit.matrix), tool.ratio);
    if (attrs === null) return;
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs });
    changed++;
  });
  return { ...plan.finish(units.map((unit, at) => plan.keyOf(nodes[at]!, unit.key))), changed };
}

// ---------------------------------------------------------------------------
// La maniglia degli angoli.
// ---------------------------------------------------------------------------

/// La maniglia degli angoli di un oggetto, nelle sue coordinate: sta sulla
/// bisettrice di un vertice, verso l'interno.
export interface CornerGrip {
  readonly vertex: Point;
  /// La bisettrice verso l'interno, lunga 1.
  readonly inward: Point;
  /// Quanto dista dal vertice il centro dell'arco di raggio 1:
  /// 1 / sin(α/2), con α l'angolo fra i lati.
  readonly reach: number;
  /// Il raggio più grande che entra: oltre, gli archi vicini si toccano a
  /// metà lato.
  readonly max: number;
  /// Il raggio di adesso, al più `max`.
  readonly radius: number;
}

/// Un vertice da arrotondare: dove sta e la sua bisettrice verso l'interno.
interface Corner {
  readonly vertex: Point;
  readonly inward: Point;
}

/// Il vertice di `corners` più in alto sullo schermo, con `matrix` dalle
/// coordinate dell'oggetto allo schermo; a pari altezza il più a sinistra.
function topmost(corners: readonly Corner[], matrix: Matrix): Corner {
  let best = corners[0]!;
  let [bx, by] = apply(matrix, best.vertex);
  for (const corner of corners.slice(1)) {
    const [x, y] = apply(matrix, corner.vertex);
    // Due vertici che i calcoli mettono quasi alla stessa altezza ci sono.
    const level = Math.abs(y - by) <= 1e-9 * Math.max(1, Math.abs(y), Math.abs(by));
    if ((level && x < bx) || (!level && y < by)) [best, bx, by] = [corner, x, y];
  }
  return best;
}

/// La maniglia degli angoli di `node`, un poligono, una stella o un
/// rettangolo, con `matrix` dalle sue coordinate alla scena; `null` per gli
/// altri. Sta sul vertice più in alto, una punta per la stella.
export function cornerGrip(node: ElementPart, role: string, matrix: Matrix): CornerGrip | null {
  const polygonal = node.details?.polygonal;
  if (polygonal !== undefined) {
    const vertices = polygonalVertices(polygonal);
    const m = vertices.length;
    const at = vertices[0]!;
    const before = vertices[m - 1]!;
    const after = vertices[1]!;
    const back: Point = [before[0] - at[0], before[1] - at[1]];
    const ahead: Point = [after[0] - at[0], after[1] - at[1]];
    const side = Math.hypot(ahead[0], ahead[1]);
    const lb = Math.hypot(back[0], back[1]);
    if (!(side > 0) || !(lb > 0)) return null;
    const half = Math.acos(Math.min(1, Math.max(-1, (back[0] * ahead[0] + back[1] * ahead[1]) / (lb * side)))) / 2;
    // Un vertice piatto non ha angolo da arrotondare.
    if (!(Math.sin(half) > 0) || !(Math.cos(half) > 1e-9)) return null;
    // I vertici che si arrotondano allo stesso modo del primo: tutti, in un
    // poligono; le punte, in una stella. La bisettrice di ciascuno va verso
    // il centro.
    const corners: Corner[] = [];
    for (let i = 0; i < m; i += polygonal.shape === "star" ? 2 : 1) {
      const vertex = vertices[i]!;
      const toward = Math.hypot(polygonal.cx - vertex[0], polygonal.cy - vertex[1]);
      corners.push({ vertex, inward: [(polygonal.cx - vertex[0]) / toward, (polygonal.cy - vertex[1]) / toward] });
    }
    // Come in `parametric.ts`: il punto di tangenza dista r / tan(α/2) dal
    // vertice, e non va oltre metà lato. I lati sono lunghi tutti uguali.
    const max = (Math.min(side, lb) / 2) * Math.tan(half);
    return { ...topmost(corners, matrix), reach: 1 / Math.sin(half), max, radius: Math.min(polygonal.corner, max) };
  }
  if (role !== "rect") return null;
  const own = plainAttributes(node);
  const x = length(own.get("x") ?? "0") ?? 0;
  const y = length(own.get("y") ?? "0") ?? 0;
  const width = nonNegativeLength(own.get("width") ?? "") ?? 0;
  const height = nonNegativeLength(own.get("height") ?? "") ?? 0;
  if (!(width > 0) || !(height > 0)) return null;
  const [rx, ry] = rectRadii(node);
  const h = Math.SQRT1_2;
  const corners: Corner[] = [
    { vertex: [x, y], inward: [h, h] },
    { vertex: [x + width, y], inward: [-h, h] },
    { vertex: [x + width, y + height], inward: [-h, -h] },
    { vertex: [x, y + height], inward: [h, -h] },
  ];
  // SVG riduce ogni raggio a metà del suo lato.
  const max = Math.min(width, height) / 2;
  return { ...topmost(corners, matrix), reach: Math.SQRT2, max, radius: Math.min(rx, ry, max) };
}

/// La maniglia nella scena per il raggio `radius`, con `matrix` dalle
/// coordinate dell'oggetto alla scena: dentro il vertice di `inset`, in
/// coordinate dell'oggetto, più la distanza del centro dell'arco. Così non
/// copre le maniglie della cornice, e scorre quanto il puntatore che la tira.
export function cornerSpot(grip: CornerGrip, matrix: Matrix, radius: number, inset: number): Point {
  const along = inset + Math.max(0, Math.min(radius, grip.max)) * grip.reach;
  return apply(matrix, [grip.vertex[0] + grip.inward[0] * along, grip.vertex[1] + grip.inward[1] * along]);
}

/// Il raggio della maniglia presa in `from`, col raggio `start`, e tirata in
/// `to`, punti nelle coordinate dell'oggetto: cambia di quanto la maniglia
/// scorre lungo la bisettrice, fra 0 e il raggio più grande che entra.
export function cornerDrag(grip: CornerGrip, from: Point, to: Point, start: number): number {
  const along = (to[0] - from[0]) * grip.inward[0] + (to[1] - from[1]) * grip.inward[1];
  return Math.min(grip.max, Math.max(0, start + along / grip.reach));
}

/// Il cursore sopra la maniglia: la direzione della bisettrice sullo
/// schermo, a passi di 45°, come quelli della cornice.
export function cornerCursor(grip: CornerGrip, matrix: Matrix, turn = 0): GripCursor {
  const [x, y] = grip.inward;
  const dx = matrix[0] * x + matrix[2] * y;
  const dy = matrix[1] * x + matrix[3] * y;
  return directionCursor((Math.atan2(dy, dx) * 180) / Math.PI + turn);
}

/// Gli attributi di `node` col raggio degli angoli `radius`, nelle sue
/// coordinate: per l'anteprima della maniglia e per l'operazione. `null` se
/// non cambiano.
export function cornerAttrs(node: ElementPart, role: string, radius: number): Record<string, string | null> | null {
  return changedAttrs(node, role, { corner: radius }, 1, 0);
}
