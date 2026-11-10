// I conti del colpo: il lazo, l'appiattimento delle parti, l'avvolgimento, le
// distanze dai lati e ciò che il lazo o un tratto tocca.

import { BoundsBuilder, fmin, rectPath, type Bounds } from "../../scene/geometry";
import { arcCenter, onEllipse } from "../../scene/curves";
import { apply, IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import {
  Clip,
  clipSegment,
  cut,
  inflate,
  Region,
  sameMatrix,
  scaleOf,
  transformedBounds,
  type Flat,
  type Run,
  type Solid,
  type Space,
} from "../clips";
import { FLATNESS, MAX_STEPS, type Part, type Sampled } from "./base";

/// Un lazo: un poligono della scena chiuso dall'ultimo punto al primo, che
/// contiene i punti con la regola non zero, come un riempimento. Un giro che
/// si chiude ripassando sull'inizio non lascia buchi.
export class Lasso {
  readonly bounds: Bounds;
  private readonly flat: Flat;

  constructor(points: readonly Point[]) {
    const out = new BoundsBuilder();
    const coords = new Float64Array(points.length * 2);
    points.forEach((p, i) => {
      coords[2 * i] = p[0];
      coords[2 * i + 1] = p[1];
      out.include(p);
    });
    this.bounds = out.finish()!;
    this.flat = { runs: [{ points: coords, closed: true }], radius: 0 };
  }

  contains(p: Point): boolean {
    return winding(this.flat, p) !== 0;
  }

  /// I lati il cui riquadro incontra `bounds`, quattro numeri per lato.
  edgesNear(bounds: Bounds): number[] {
    const out: number[] = [];
    forEachEdge(this.flat, true, (ax, ay, bx, by) => {
      if (Math.max(ax, bx) >= bounds.min[0] && Math.min(ax, bx) <= bounds.max[0] && Math.max(ay, by) >= bounds.min[1] && Math.min(ay, by) <= bounds.max[1]) {
        out.push(ax, ay, bx, by);
      }
      return false;
    });
    return out;
  }
}

export function localBounds(part: Part): Bounds | null {
  const cache = part.cache!;
  if (cache.local === undefined) cache.local = transformedBounds(part.segments, IDENTITY);
  return cache.local;
}

/// Vero se `inner` sta tutto dentro `outer`.
export function holds(outer: Bounds, inner: Bounds): boolean {
  return inner.min[0] >= outer.min[0] && inner.max[0] <= outer.max[0] && inner.min[1] >= outer.min[1] && inner.max[1] <= outer.max[1];
}

export function includeInflated(out: BoundsBuilder, bounds: Bounds, by: number): void {
  out.include([bounds.min[0] - by, bounds.min[1] - by]);
  out.include([bounds.max[0] + by, bounds.max[1] + by]);
}

/// Aggiunge a `out` ciò che si vede della forma `part` il cui riquadro senza
/// contorno è `bounds`: allargato di `by` e tagliato da ogni regione di
/// `part`, misurate in `space`. Una forma tagliata via non aggiunge niente.
export function includeSeen(out: BoundsBuilder, part: Part, bounds: Bounds, by: number, space: Space): void {
  if (part.regions === null) {
    includeInflated(out, bounds, by);
    return;
  }
  const seen = cut(inflate(bounds, by), part.regions, space);
  if (seen !== null) includeInflated(out, seen, 0);
}

/// Le regioni di ritagli e maschere che non fanno parte di un oggetto, come
/// quelle di un livello su un blocco estraneo: non hanno coordinate
/// dell'oggetto e non si spostano con nessuno.
export function fixed(clips: readonly Clip[] | null): readonly Region[] | null {
  return clips === null ? null : clips.map((clip) => new Region(clip, null, false));
}

/// Vero se il segmento da `a` a `b`, allargato di `tolerance`, incontra
/// `bounds`. [`SceneIndex.along`] chiede all'albero dei riquadri lo stesso
/// riquadro con gli stessi conti: cambiano insieme.
export function near(bounds: Bounds | null, a: Point, b: Point, tolerance: number): boolean {
  if (bounds === null) return false;
  return Math.max(a[0], b[0]) + tolerance >= bounds.min[0] && Math.min(a[0], b[0]) - tolerance <= bounds.max[0]
    && Math.max(a[1], b[1]) + tolerance >= bounds.min[1] && Math.min(a[1], b[1]) - tolerance <= bounds.max[1];
}

// ---------------------------------------------------------------------------
// Appiattimento.
// ---------------------------------------------------------------------------

function flatten(part: Solid): Flat {
  if (part.flat !== null) return part.flat;
  const m = part.matrix;
  const runs: Run[] = [];
  let points: number[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  const push = (p: Point): void => {
    points.push(p[0], p[1]);
  };
  const finish = (closed: boolean): void => {
    if (points.length >= 2) runs.push({ points: Float64Array.from(points), closed });
    points = [];
  };
  for (const segment of part.segments) {
    switch (segment.kind) {
      case "move":
        finish(false);
        current = segment.to;
        start = segment.to;
        push(apply(m, current));
        break;
      case "line":
        if (points.length === 0) push(apply(m, current));
        push(apply(m, segment.to));
        current = segment.to;
        break;
      case "quad": {
        if (points.length === 0) push(apply(m, current));
        const p0 = apply(m, current);
        const p1 = apply(m, segment.control);
        const p2 = apply(m, segment.to);
        const dd = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
        const n = steps(Math.sqrt((0.25 * dd) / FLATNESS));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
        }
        current = segment.to;
        break;
      }
      case "cubic": {
        if (points.length === 0) push(apply(m, current));
        const p0 = apply(m, current);
        const p1 = apply(m, segment.c1);
        const p2 = apply(m, segment.c2);
        const p3 = apply(m, segment.to);
        const dd = Math.max(
          Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
          Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
        );
        const n = steps(Math.sqrt((0.75 * dd) / FLATNESS));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
        }
        current = segment.to;
        break;
      }
      case "arc":
        if (points.length === 0) push(apply(m, current));
        for (const p of arcPoints(current, segment.radii, segment.rotation, segment.large, segment.sweep, segment.to, m)) push(p);
        current = segment.to;
        break;
      case "close":
        if (points.length === 0) push(apply(m, current));
        finish(true);
        current = start;
        break;
    }
  }
  finish(false);
  part.flat = { runs, radius: part.radius * scaleOf(m) };
  return part.flat;
}

function steps(estimate: number): number {
  return Number.isFinite(estimate) ? Math.min(MAX_STEPS, Math.max(1, Math.ceil(estimate))) : 1;
}

/// I punti di un arco ellittico dopo `from`, fino a `to` compreso, portati
/// nella scena da `m`: la conversione al centro delle note di SVG (F.6.5).
function arcPoints(from: Point, radii: Point, rotation: number, large: boolean, sweep: boolean, to: Point, m: Matrix): Point[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const arc = arcCenter(from, { kind: "arc", radii, rotation, large, sweep, to });
  if (arc === null) return [apply(m, to)];
  // Il passo angolare che tiene la corda entro `FLATNESS` dall'arco, sul
  // raggio più grande nella scena.
  const radius = Math.max(arc.radii[0], arc.radii[1]) * Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  const angle = radius > FLATNESS ? 2 * Math.acos(fmin(1, 1 - FLATNESS / radius)) : Math.PI / 2;
  const n = steps(Math.abs(arc.delta) / angle);
  const out: Point[] = [];
  for (let i = 1; i < n; i++) out.push(apply(m, onEllipse(arc, arc.start + (arc.delta * i) / n)));
  out.push(apply(m, to));
  return out;
}

// ---------------------------------------------------------------------------
// Prove di contatto.
// ---------------------------------------------------------------------------

/// Il numero di avvolgimento di `p` rispetto a tutti i sottotracciati, chiusi
/// come li chiude il riempimento.
function winding(flat: Flat, p: Point): number {
  let total = 0;
  const [px, py] = p;
  for (const run of flat.runs) {
    const pts = run.points;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[2 * i]!;
      const ay = pts[2 * i + 1]!;
      const j = i + 1 === n ? 0 : i + 1;
      const bx = pts[2 * j]!;
      const by = pts[2 * j + 1]!;
      if (ay <= py) {
        if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) total++;
      } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) {
        total--;
      }
    }
  }
  return total;
}

/// Ogni lato dei sottotracciati: quelli chiusi anche dall'ultimo punto al
/// primo, e quelli aperti di un riempimento.
function forEachEdge(flat: Flat, fill: boolean, visit: (ax: number, ay: number, bx: number, by: number) => boolean): boolean {
  for (const run of flat.runs) {
    const pts = run.points;
    const n = pts.length / 2;
    if (n === 1 && visit(pts[0]!, pts[1]!, pts[0]!, pts[1]!)) return true;
    for (let i = 0; i + 1 < n; i++) {
      if (visit(pts[2 * i]!, pts[2 * i + 1]!, pts[2 * i + 2]!, pts[2 * i + 3]!)) return true;
    }
    if (n > 2 && (run.closed || fill) && visit(pts[2 * n - 2]!, pts[2 * n - 1]!, pts[0]!, pts[1]!)) return true;
  }
  return false;
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/// La distanza fra i segmenti `ab` e `cd`: zero se si incrociano.
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointSegmentDistance(bx, by, cx, cy, dx, dy),
    pointSegmentDistance(cx, cy, ax, ay, bx, by),
    pointSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

function partBounds(part: Solid): Bounds | null {
  const cache = part.cache;
  if (cache !== null && cache.scene !== null && sameMatrix(cache.scene.matrix, part.matrix)) return cache.scene.bounds;
  return transformedBounds(part.segments, part.matrix);
}

/// Vero se `p` sta dentro il riempimento di `solid`, appiattito in `flat`,
/// con la sua regola.
function covers(solid: Solid, flat: Flat, p: Point): boolean {
  const turns = winding(flat, p);
  return solid.evenodd === true ? (turns & 1) !== 0 : turns !== 0;
}

/// Vero se il punto `p` tocca la forma `solid`, ignorando ritagli e maschere:
/// dentro il riempimento, o a meno della tolleranza dal suo contorno.
function solidHits(solid: Solid, p: Point, tolerance: number): boolean {
  const radius = solid.radius * scaleOf(solid.matrix);
  if (!near(partBounds(solid), p, p, tolerance + radius)) return false;
  const flat = flatten(solid);
  if (solid.fill && covers(solid, flat, p)) return true;
  const reach = flat.radius + tolerance;
  return forEachEdge(flat, solid.fill, (ax, ay, bx, by) => pointSegmentDistance(p[0], p[1], ax, ay, bx, by) <= reach);
}

/// Vero se `p` sta dentro ogni ritaglio e ogni maschera di `regions`, con la
/// stessa tolleranza di una forma: dentro la finestra di una maschera e
/// dentro, o vicino, a una forma del contenuto.
function regionsHit(regions: readonly Region[], p: Point, tolerance: number): boolean {
  for (const { clip } of regions) {
    const window = clip.windowSolid();
    if (window !== null && !solidHits(window, p, tolerance)) return false;
    if (!clip.solids().some((solid) => solidHits(solid, p, tolerance))) return false;
  }
  return true;
}

/// Vero se `p` tocca la parte che si vede di `part`: la forma, dove i
/// ritagli e le maschere che la tagliano la lasciano.
export function partHits(part: Part, p: Point, tolerance: number): boolean {
  return solidHits(part, p, tolerance) && (part.regions === null || regionsHit(part.regions, p, tolerance));
}

/// Che cosa colora `part` nel punto `p`: il contorno, che sta sopra, il
/// riempimento, o niente. Il contorno di un sottotracciato aperto non ha il
/// lato che il riempimento chiude. Dove un ritaglio o una maschera nasconde
/// la forma non colora niente.
export function partSample(part: Part, p: Point, tolerance: number): Sampled["on"] | null {
  const radius = part.radius * scaleOf(part.matrix);
  if (!near(partBounds(part), p, p, tolerance + radius)) return null;
  if (part.regions !== null && !regionsHit(part.regions, p, tolerance)) return null;
  const flat = flatten(part);
  const away = edgeDistance(flat, false, p);
  if (flat.radius > 0 && away <= flat.radius) return "stroke";
  if (part.fill && covers(part, flat, p)) return "fill";
  if (tolerance <= 0) return null;
  if (flat.radius > 0) return away <= flat.radius + tolerance ? "stroke" : null;
  return part.fill && edgeDistance(flat, true, p) <= tolerance ? "fill" : null;
}

/// La distanza di `p` dal lato più vicino di `flat`; con `fill` anche dai
/// lati che chiudono i sottotracciati aperti.
function edgeDistance(flat: Flat, fill: boolean, p: Point): number {
  let best = Infinity;
  forEachEdge(flat, fill, (ax, ay, bx, by) => {
    best = Math.min(best, pointSegmentDistance(p[0], p[1], ax, ay, bx, by));
    return false;
  });
  return best;
}

function solidTouches(solid: Solid, a: Point, b: Point, tolerance: number): boolean {
  const radius = solid.radius * scaleOf(solid.matrix);
  if (!near(partBounds(solid), a, b, tolerance + radius)) return false;
  const flat = flatten(solid);
  if (solid.fill && (covers(solid, flat, a) || covers(solid, flat, b))) return true;
  const reach = flat.radius + tolerance;
  return forEachEdge(flat, solid.fill, (cx, cy, dx, dy) => segmentDistance(a[0], a[1], b[0], b[1], cx, cy, dx, dy) <= reach);
}

/// Vero se il segmento da `a` a `b` tocca la parte che si vede di `part`.
/// Si toglie prima ciò che sta fuori dai riquadri dei ritagli e delle
/// maschere, poi si guarda se ciò che resta tocca anche loro e la forma.
export function partTouches(part: Part, a: Point, b: Point, tolerance: number): boolean {
  const regions = part.regions;
  if (regions === null) return solidTouches(part, a, b, tolerance);
  let from = a;
  let to = b;
  for (const region of regions) {
    const box = region.clip.sceneBox();
    const kept = box === null ? null : clipSegment(from, to, box, tolerance);
    if (kept === null) return false;
    [from, to] = kept;
  }
  for (const { clip } of regions) {
    const window = clip.windowSolid();
    if (window !== null && !solidTouches(window, from, to, tolerance)) return false;
    if (!clip.solids().some((solid) => solidTouches(solid, from, to, tolerance))) return false;
  }
  return solidTouches(part, from, to, tolerance);
}

/// Vero se `solid` sta tutta dentro il lazo, contorno compreso: nessun lato
/// di `edges`, quelli del lazo che le stanno vicino, arriva al suo contorno,
/// e comincia dentro.
export function solidInside(solid: Solid, lasso: Lasso, edges: readonly number[]): boolean {
  const flat = flatten(solid);
  const first = flat.runs[0];
  if (first === undefined) return true;
  const reach = flat.radius;
  const crosses = forEachEdge(flat, solid.fill, (ax, ay, bx, by) => {
    for (let i = 0; i < edges.length; i += 4) {
      if (segmentDistance(ax, ay, bx, by, edges[i]!, edges[i + 1]!, edges[i + 2]!, edges[i + 3]!) <= reach) return true;
    }
    return false;
  });
  return !crosses && lasso.contains([first.points[0]!, first.points[1]!]);
}

/// Vero se tutte le `solids` stanno dentro il lazo, e `box` le contiene.
function allInside(solids: readonly Solid[], box: Bounds, lasso: Lasso): boolean {
  if (!holds(lasso.bounds, box)) return false;
  const edges = lasso.edgesNear(box);
  if (edges.length === 0) return lasso.contains(box.min);
  return solids.every((solid) => solidInside(solid, lasso, edges));
}

/// Il riquadro che contiene le `solids`, contorno compreso.
function solidsBox(solids: readonly Solid[]): Bounds | null {
  const out = new BoundsBuilder();
  for (const solid of solids) {
    const bounds = partBounds(solid);
    if (bounds !== null) includeInflated(out, bounds, solid.radius * scaleOf(solid.matrix));
  }
  return out.finish();
}

/// Vero se ciò che si vede di `part`, tagliata da ritagli o maschere, sta
/// tutto dentro il lazo. Ciò che si vede sta dentro la forma e dentro ogni
/// regione, e anche dentro il riquadro dove le regioni e la forma si
/// incontrano: basta che il lazo contenga uno di loro.
export function visibleInside(part: Part, lasso: Lasso): boolean {
  const regions = part.regions!;
  const bounds = partBounds(part);
  if (bounds === null) return true;
  const own = inflate(bounds, part.radius * scaleOf(part.matrix));
  const seen = cut(own, regions, "scene");
  if (seen === null) return true;
  if (allInside([part], own, lasso)) return true;
  for (const { clip } of regions) {
    for (const group of clip.covers()) {
      const box = solidsBox(group);
      if (box !== null && allInside(group, box, lasso)) return true;
    }
  }
  const [x0, y0] = seen.min;
  const [x1, y1] = seen.max;
  const box: Solid = { segments: rectPath(x0, y0, x1 - x0, y1 - y0, 0, 0), matrix: IDENTITY, fill: true, radius: 0, cache: null, flat: null };
  return allInside([box], seen, lasso);
}
