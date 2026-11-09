// Che cosa prende la gomma «Il tratto intero» sulla lavagna (N4 T13, A20).
//
// La gomma cerca i tratti dove si vedono: ogni tratto disegnato diventa una
// polilinea in coordinate della lavagna. Un tratto di una scheda passa dalla
// trasformazione di `ink-fit.ts` (su un'immagine o un PDF scalato e centrato,
// sulle altre schede fermo nell'angolo), così la gomma lo prende dove la resa
// lo mostra e non dove sarebbe stirato. Un tratto conservato e non disegnato
// non c'è, e nemmeno quelli di un livello estraneo: non si vedono e non si
// prendono.
//
// Pura: niente DOM. Il cammino della gomma e il registro di ciò che ha preso
// sono di `EraseSweep` (`ink/tools/sweep.ts`); qui c'è solo la sorgente.

import type { EraseSource, Erasable, Spot } from "../../ink/tools/sweep";
import { fitPoint, inkFit, inkFitMode, type InkFit } from "./ink-fit";
import type { InkLayerRef, InkLayerState } from "./ink-record";

/// Un tratto disegnato, pronto per la gomma.
export interface ErasableInk extends Erasable {
  /// Unica nella lavagna: il livello e l'id del tratto.
  readonly key: string;
  readonly layer: InkLayerRef;
  /// La scheda che tiene il livello; `null` per la radice.
  readonly node: string | null;
  /// L'id del tratto nel suo livello.
  readonly id: string;
  /// I punti in coordinate della lavagna, `x` e `y` alternati.
  readonly points: readonly number[];
  /// Metà dello spessore come si vede, in unità della lavagna.
  readonly reach: number;
  /// Il riquadro dei punti, allargato di `reach`.
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/// La chiave di un tratto: la scheda (o la radice) e l'id del tratto, senza
/// ambiguità qualunque carattere contengano.
export function inkKey(layer: InkLayerRef, id: string): string {
  return JSON.stringify(layer === "board" ? ["board", id] : ["node", layer.node, id]);
}

const IDENTITY: InkFit = { s: 1, x: 0, y: 0 };

/// I tratti disegnati dei livelli `states` (`inkLayerStates`), in coordinate
/// della lavagna. Un tratto che la resa non mostra (scala zero) non c'è.
export function erasableInk(states: readonly InkLayerState[]): ErasableInk[] {
  const units: ErasableInk[] = [];
  for (const state of states) {
    if (state.state !== "ok") continue;
    const node = state.node;
    const ox = node ? node.x : 0;
    const oy = node ? node.y : 0;
    const mode = node ? inkFitMode(node) : "fixed";
    for (const stroke of state.drawable) {
      // Senza misura (un tratto libero dato a una scheda) le unità sono i
      // pixel della scheda, come in `paintCard`.
      const fit = node && stroke.ref ? inkFit(mode, stroke.ref, { width: node.width, height: node.height }) : IDENTITY;
      if (!(fit.s > 0)) continue;
      const scale = stroke.ink.scale;
      const points: number[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sample of stroke.ink.samples) {
        const [fx, fy] = fitPoint(fit, sample.x / scale, sample.y / scale);
        const x = ox + fx;
        const y = oy + fy;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (points.length === 0) continue;
      const reach = (stroke.brush.size * fit.s) / 2;
      units.push({
        key: inkKey(state.layer, stroke.id),
        layer: state.layer,
        node: node ? node.id : null,
        id: stroke.id,
        points,
        reach,
        minX: minX - reach,
        minY: minY - reach,
        maxX: maxX + reach,
        maxY: maxY + reach,
      });
    }
  }
  return units;
}

/// La sorgente della gomma sui tratti `units`: il segmento della gomma prende
/// un tratto se passa a meno di `radius` più metà del suo spessore da uno dei
/// suoi segmenti.
export class InkEraseSource implements EraseSource<ErasableInk> {
  readonly #units: readonly ErasableInk[];

  constructor(units: readonly ErasableInk[]) {
    this.#units = units;
  }

  get size(): number {
    return this.#units.length;
  }

  *along(from: Spot, to: Spot, radius: number, marked: ReadonlyMap<string, ErasableInk>): Iterable<ErasableInk> {
    const [ax, ay] = from;
    const [bx, by] = to;
    const loX = Math.min(ax, bx) - radius;
    const hiX = Math.max(ax, bx) + radius;
    const loY = Math.min(ay, by) - radius;
    const hiY = Math.max(ay, by) + radius;
    for (const unit of this.#units) {
      if (marked.get(unit.key) === unit) continue;
      if (unit.maxX < loX || unit.minX > hiX || unit.maxY < loY || unit.minY > hiY) continue;
      if (touches(unit, ax, ay, bx, by, radius + unit.reach)) yield unit;
    }
  }
}

/// Il segmento `a`–`b` passa a meno di `limit` dalla polilinea del tratto.
function touches(unit: ErasableInk, ax: number, ay: number, bx: number, by: number, limit: number): boolean {
  const p = unit.points;
  const limit2 = limit * limit;
  if (p.length === 2) return pointSegment2(p[0]!, p[1]!, ax, ay, bx, by) <= limit2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segmentSegment2(ax, ay, bx, by, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= limit2) return true;
  }
  return false;
}

/// Il quadrato della distanza del punto `p` dal segmento `a`–`b`.
function pointSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  let t = length2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / length2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/// Il quadrato della distanza fra i segmenti `a`–`b` e `c`–`d`: zero se si
/// incrociano, altrimenti la minore fra gli estremi e l'altro segmento.
function segmentSegment2(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegment2(ax, ay, cx, cy, dx, dy),
    pointSegment2(bx, by, cx, cy, dx, dy),
    pointSegment2(cx, cy, ax, ay, bx, by),
    pointSegment2(dx, dy, ax, ay, bx, by),
  );
}
