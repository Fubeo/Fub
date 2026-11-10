/**
 * La geometria dei fili della lavagna (N6 T67), pura: niente DOM, niente
 * motore. Il lato di una scheda dove un filo si attacca, la forma del filo
 * (la curva di oggi, D6), la distanza di un punto da un filo e il filo sotto
 * il puntatore, entro una tolleranza misurata sullo schermo.
 *
 * Le coordinate sono quelle della lavagna (il mondo); la tolleranza è in
 * pixel dello schermo e si divide per lo zoom.
 */

/** Un lato di una scheda, come lo scrive JSON Canvas (`fromSide`, `toSide`). */
export type EdgeSide = "top" | "right" | "bottom" | "left";

export const EDGE_SIDES: readonly EdgeSide[] = ["top", "right", "bottom", "left"];

export interface EdgePoint {
  readonly x: number;
  readonly y: number;
}

/** Il rettangolo di una scheda sulla lavagna. */
export interface EdgeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Un filo già messo sulla lavagna: i suoi estremi, nel mondo. */
export interface PlacedEdge {
  readonly id: string;
  readonly a: EdgePoint;
  readonly b: EdgePoint;
}

/** Quanto vicino, sullo schermo, un filo si prende (D8). */
export const EDGE_GRAB_PX = 8;

/** Quanti pezzi dritti approssimano la curva per misurarne la distanza. */
const CURVE_STEPS = 24;

/** Il punto a metà del lato `side` di `box`. */
export function sidePoint(box: EdgeBox, side: EdgeSide): EdgePoint {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height / 2 };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2 };
  }
}

function distance(a: EdgePoint, b: EdgePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Il lato di `box` il cui punto di mezzo è più vicino a `toward`. */
export function nearestSide(box: EdgeBox, toward: EdgePoint): EdgeSide {
  let best: EdgeSide = "right";
  let bestDistance = Infinity;
  for (const side of EDGE_SIDES) {
    const d = distance(sidePoint(box, side), toward);
    if (d < bestDistance) {
      best = side;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * I lati di un filo da `from` a `to`: la coppia di punti di mezzo più vicini
 * (D2: tutta la scheda è il bersaglio, il lato lo sceglie Fub). Con
 * `fromSide` (il filo è partito da un punto) si sceglie solo l'arrivo. Un
 * filo da una scheda a sé stessa esce a destra e torna in alto.
 */
export function nearestSides(
  from: EdgeBox,
  to: EdgeBox,
  fromSide?: EdgeSide,
  sameCard = false,
): { fromSide: EdgeSide; toSide: EdgeSide } {
  if (sameCard) {
    const start = fromSide ?? "right";
    return { fromSide: start, toSide: start === "top" ? "right" : "top" };
  }
  if (fromSide) return { fromSide, toSide: nearestSide(to, sidePoint(from, fromSide)) };
  let best = { fromSide: "right" as EdgeSide, toSide: "left" as EdgeSide };
  let bestDistance = Infinity;
  for (const a of EDGE_SIDES) {
    for (const b of EDGE_SIDES) {
      const d = distance(sidePoint(from, a), sidePoint(to, b));
      if (d < bestDistance) {
        best = { fromSide: a, toSide: b };
        bestDistance = d;
      }
    }
  }
  return best;
}

/**
 * I quattro punti della curva di un filo da `a` a `b`: la forma di oggi, che
 * esce e arriva in orizzontale (la forma che segue i lati è D6, v2).
 */
export function edgeCurve(a: EdgePoint, b: EdgePoint): readonly [EdgePoint, EdgePoint, EdgePoint, EdgePoint] {
  const half = (b.x - a.x) / 2;
  return [a, { x: a.x + half, y: a.y }, { x: b.x - half, y: b.y }, b];
}

/** L'attributo `d` del filo da `a` a `b`. */
export function edgePathData(a: EdgePoint, b: EdgePoint): string {
  const [, c1, c2] = edgeCurve(a, b);
  return `M ${a.x} ${a.y} C ${c1.x} ${a.y}, ${c2.x} ${b.y}, ${b.x} ${b.y}`;
}

function curveAt(curve: readonly [EdgePoint, EdgePoint, EdgePoint, EdgePoint], t: number): EdgePoint {
  const [p0, p1, p2, p3] = curve;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Il punto del segmento `a`–`b` più vicino a `p`. */
function closestOnSegment(p: EdgePoint, a: EdgePoint, b: EdgePoint): EdgePoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Il punto del filo da `a` a `b` più vicino a `p`, e quanto dista. */
export function closestOnEdge(p: EdgePoint, a: EdgePoint, b: EdgePoint): { point: EdgePoint; distance: number } {
  const curve = edgeCurve(a, b);
  let previous = a;
  let best = { point: a, distance: distance(p, a) };
  for (let step = 1; step <= CURVE_STEPS; step++) {
    const next = curveAt(curve, step / CURVE_STEPS);
    const point = closestOnSegment(p, previous, next);
    const d = distance(p, point);
    if (d < best.distance) best = { point, distance: d };
    previous = next;
  }
  return best;
}

/** Quanto dista `p` dal filo da `a` a `b`, nel mondo. */
export function distanceToEdge(p: EdgePoint, a: EdgePoint, b: EdgePoint): number {
  return closestOnEdge(p, a, b).distance;
}

/** Il rettangolo che contiene la curva: i quattro punti la racchiudono. */
function curveBounds(a: EdgePoint, b: EdgePoint): EdgeBox {
  const xs = edgeCurve(a, b).map((point) => point.x);
  const ys = edgeCurve(a, b).map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function overlaps(a: EdgeBox, b: EdgeBox): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/**
 * Il filo sotto `point`, entro `tolerancePx` pixel dello schermo a zoom
 * `zoom`: il più vicino, con il punto del filo più vicino. Guarda solo i
 * fili che toccano `view` (la parte di lavagna in vista): con duecento fili
 * la ricerca resta sui pochi che si vedono.
 */
export function edgeAt(
  point: EdgePoint,
  edges: readonly PlacedEdge[],
  zoom: number,
  view: EdgeBox,
  tolerancePx = EDGE_GRAB_PX,
): { id: string; point: EdgePoint; distance: number } | null {
  const reach = tolerancePx / (zoom > 0 ? zoom : 1);
  const near: EdgeBox = { x: point.x - reach, y: point.y - reach, width: reach * 2, height: reach * 2 };
  let best: { id: string; point: EdgePoint; distance: number } | null = null;
  for (const edge of edges) {
    const bounds = curveBounds(edge.a, edge.b);
    if (!overlaps(bounds, view) || !overlaps(bounds, near)) continue;
    const hit = closestOnEdge(point, edge.a, edge.b);
    if (hit.distance <= reach && (!best || hit.distance < best.distance)) best = { id: edge.id, ...hit };
  }
  return best;
}

/** `point` è dentro `box` (i bordi compresi). */
export function insideBox(point: EdgePoint, box: EdgeBox): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

/**
 * Dove nasce la scheda di un filo lasciato nel vuoto (D7): il lato che
 * guarda verso `from` (l'altro capo) cade sotto il puntatore, così il filo
 * arriva dritto e la scheda non lo copre.
 */
export function linkedCardPlacement(
  from: EdgePoint,
  pointer: EdgePoint,
  width: number,
  height: number,
): { x: number; y: number; side: EdgeSide } {
  const dx = from.x - pointer.x;
  const dy = from.y - pointer.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx <= 0
      ? { x: pointer.x, y: pointer.y - height / 2, side: "left" }
      : { x: pointer.x - width, y: pointer.y - height / 2, side: "right" };
  }
  return dy <= 0
    ? { x: pointer.x - width / 2, y: pointer.y, side: "top" }
    : { x: pointer.x - width / 2, y: pointer.y - height, side: "bottom" };
}
