// Che cosa prende e che cosa taglia la gomma sulla lavagna (N4 T13, T22, A20).
//
// La gomma cerca i tratti dove si vedono: ogni tratto disegnato diventa una
// polilinea in coordinate della lavagna. Un tratto di una scheda passa dalla
// trasformazione di `ink-fit.ts` (su un'immagine o un PDF scalato e centrato,
// sulle altre schede fermo nell'angolo), così la gomma lo prende dove la resa
// lo mostra e non dove sarebbe stirato. Un tratto conservato e non disegnato
// non c'è, e nemmeno quelli di un livello estraneo: non si vedono e non si
// prendono.
//
// La gomma «Solo il pezzo» (T22, D-6 b) taglia invece il tratto dove passa:
// il cammino torna nelle unità del tratto (l'inverso della stessa
// trasformazione), `splitInk` e `cutBrush` di `ink/tools/split.ts` danno i
// pezzi, e ogni pezzo diventa un record coi campi del tratto di partenza
// (anche quelli che Fub non conosce), un id nuovo, `at` spostato all'inizio
// del pezzo e il suo `ink`. Le toppe mettono i pezzi al posto del tratto, nel
// suo ordine (`cutStrokePatches`).
//
// Pura: niente DOM. Il cammino della gomma e il registro di ciò che ha preso
// sono di `EraseSweep` (`ink/tools/sweep.ts`); qui c'è la sorgente e il taglio.

import { formatInkBrush, type InkBrush } from "../../ink/brush";
import { inkPath } from "../../ink/outline";
import { dequantizeSample, quantizeInk, type QuantizedInk } from "../../ink/sample";
import { cutBrush, splitInk } from "../../ink/tools/split";
import type { EraseSource, Erasable, Spot } from "../../ink/tools/sweep";
import { encodeInk, inkFromQuantized } from "../spatial/ink/codec";
import { fitPoint, inkFit, inkFitMode, type InkFit } from "./ink-fit";
import type { DrawableStroke, InkLayerRef, InkLayerState } from "./ink-record";
import type { CanvasDocument } from "./model";
import { addStrokePatch, eraseStrokePatch, eraseStrokePatches, newNodeId, type InkPatch, type StoredInkStroke } from "./operation";
import type { CanvasInkLayer } from "./wasm/core";

/// Che cosa fa la gomma: toglie il tratto intero (di serie, A20) o ne taglia
/// solo il pezzo strofinato (D-6 b).
export type InkEraserMode = "stroke" | "piece";

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
  /// Il tratto com'è decodificato, per tagliarlo.
  readonly stroke: DrawableStroke;
  /// Da unità dell'ancora a coordinate della lavagna: `(x + s·px, y + s·py)`.
  readonly fit: InkFit;
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
        stroke,
        fit: { s: fit.s, x: ox + fit.x, y: oy + fit.y },
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

/// Un pezzo che resta di un tratto tagliato, già quantizzato.
export interface CutPiece {
  /// I campioni del pezzo, nella scala del tratto, col tempo da zero.
  readonly ink: QuantizedInk;
  readonly brush: InkBrush;
  /// Il testo di `brush`: quello del tratto se il pezzo non comincia né
  /// finisce su un taglio.
  readonly brushText: string;
  /// Di quanti millisecondi comincia dopo il tratto intero.
  readonly offset: number;
}

/// Il taglio del cammino `path` della gomma (in coordinate della lavagna,
/// largo `radius` unità della lavagna) sul tratto `unit`: i pezzi che
/// restano, `[]` se lo copre tutto, `null` se non lo tocca. Il cerchio taglia
/// dove tocca l'inchiostro, non solo la linea di mezzo: il raggio cresce di
/// metà dello spessore. Un pezzo che non si scrive (fuori dai numeri
/// dell'inchiostro) fa cancellare il tratto intero, come la gomma precisa dei
/// disegni: la passata lo mostra tutto sbiadito.
export function cutInk(unit: ErasableInk, path: readonly Spot[], radius: number): readonly CutPiece[] | null {
  const { stroke, fit } = unit;
  if (!(fit.s > 0) || path.length === 0) return null;
  const scale = stroke.ink.scale;
  const samples = stroke.ink.samples.map((sample) => dequantizeSample(sample, scale));
  const local = path.map(([x, y]): Spot => [(x - fit.x) / fit.s, (y - fit.y) / fit.s]);
  const pieces = splitInk(samples, local, radius / fit.s + stroke.brush.size / 2);
  if (pieces === null) return null;
  try {
    return pieces.map((piece): CutPiece => {
      const brush = cutBrush(stroke.brush, piece);
      const whole = !piece.cutStart && !piece.cutEnd;
      return {
        ink: quantizeInk(piece.samples, scale),
        brush,
        brushText: whole ? stroke.brushText : formatInkBrush(brush),
        offset: piece.offset,
      };
    });
  } catch {
    return [];
  }
}

/// Il contorno dei pezzi `pieces`, nelle unità in cui il tratto è scritto:
/// ciò che la passata lascia vedere pieno sopra il tratto sbiadito. Vuoto se
/// non resta niente o il contorno non si calcola.
export function cutPath(pieces: readonly CutPiece[]): string {
  const parts: string[] = [];
  for (const piece of pieces) {
    try {
      const d = inkPath(piece.ink, piece.brush);
      if (d !== "") parts.push(d);
    } catch {
      // Un pezzo senza contorno non si vede neanche dopo.
    }
  }
  return parts.join(" ");
}

/// `at` spostato di `offset` millisecondi, in ISO coi millisecondi; com'era se
/// non si legge o se il pezzo comincia col tratto.
function shiftedAt(at: string, offset: number): string {
  const time = Date.parse(at);
  if (Number.isNaN(time) || offset === 0) return at;
  const shifted = new Date(time + Math.round(offset));
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString() : at;
}

/// I record dei pezzi `pieces` del tratto `stroke`, nell'ordine: ogni campo del
/// tratto di partenza nel suo ordine, anche quelli che Fub non conosce, con un
/// id nuovo (`newId`), `at` spostato all'inizio del pezzo se c'era, il
/// pennello del pezzo e il suo `ink`.
export function pieceRecords(
  stroke: DrawableStroke,
  pieces: readonly CutPiece[],
  newId: () => string = () => newNodeId("s"),
): StoredInkStroke[] {
  return pieces.map((piece) => {
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stroke.record)) {
      if (key === "id") record.id = newId();
      else if (key === "at") record.at = typeof value === "string" ? shiftedAt(value, piece.offset) : value;
      else if (key === "brush") record.brush = piece.brushText;
      else if (key === "ink") record.ink = encodeInk(inkFromQuantized(piece.ink));
      else record[key] = value;
    }
    return record as StoredInkStroke;
  });
}

/// Un tratto tagliato: il suo id e i record dei pezzi che lo sostituiscono.
export interface StrokeCut {
  readonly id: string;
  readonly pieces: readonly StoredInkStroke[];
}

/// Le toppe che mettono i pezzi di ogni tratto di `cuts` al suo posto nel
/// livello `layer`, nel suo ordine: prima si tolgono i tratti dall'ultimo al
/// primo (ognuno con la posizione che ha nel file), poi si aggiungono i pezzi
/// dal primo all'ultimo dove stava il loro tratto. Sono le toppe di
/// `eraseStrokePatch` e `addStrokePatch`; l'inversa le disfa in fila. Un
/// tratto coperto tutto se ne va senza pezzi. `null` se il livello non si
/// scrive, un tratto non c'è o è ripetuto, o un pezzo non si aggiunge.
export function cutStrokePatches(
  doc: CanvasDocument,
  layers: readonly CanvasInkLayer[],
  layer: InkLayerRef,
  cuts: readonly StrokeCut[],
): InkPatch[] | null {
  const placed: Array<{ readonly cut: StrokeCut; readonly at: number }> = [];
  for (const cut of cuts) {
    const at = eraseStrokePatch(doc, layers, layer, cut.id)?.at;
    if (at === undefined) return null;
    placed.push({ cut, at });
  }
  placed.sort((a, b) => b.at - a.at);
  const patches = eraseStrokePatches(doc, layers, layer, placed.map((each) => each.cut.id));
  if (!patches) return null;
  placed.reverse();
  // Dove va il primo pezzo del tratto `k`: il suo posto, meno i tratti tolti
  // prima di lui, più i pezzi già messi.
  let inserted = 0;
  for (let k = 0; k < placed.length; k++) {
    const { cut, at } = placed[k]!;
    let position = at - k + inserted;
    for (const piece of cut.pieces) {
      const patch = addStrokePatch(doc, layers, layer, piece);
      if (!patch) return null;
      patches.push({ ...patch, at: position++ });
    }
    inserted += cut.pieces.length;
  }
  return patches;
}
