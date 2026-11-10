// I percorsi degli archi di draw.io: i bordi delle forme, i gomiti, le
// curve e le rotte che draw.io calcola da sé (entità, sequenze).

import type { Bounds, Segment } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";

/// Il contorno su cui draw.io mette i capi di un arco: il riquadro della
/// forma, o l'ellisse o il rombo che vi stanno dentro.
export type Perimeter = "rect" | "ellipse" | "rhombus";

/// Dove il raggio dal centro di `box` verso `toward` esce dal contorno
/// `kind`.
export function rimOf(box: Bounds, kind: Perimeter, toward: Point): Point {
  if (kind === "rect") return rim(box, toward);
  const c = centreOf(box);
  const [hw, hh] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2];
  const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
  if (hw < 1e-9 || hh < 1e-9 || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return c;
  const s = kind === "ellipse" ? 1 / Math.hypot(dx / hw, dy / hh) : 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  return [c[0] + dx * s, c[1] + dy * s];
}

/// Il punto del contorno `kind` di `box` sul raggio dal centro verso `at`,
/// dentro o fuori che sia: dove draw.io porta un punto fisso sul contorno.
export function perimeterPoint(box: Bounds, kind: Perimeter, at: Point): Point {
  const c = centreOf(box);
  const [hw, hh] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2];
  const [dx, dy] = [at[0] - c[0], at[1] - c[1]];
  if (hw < 1e-9 || hh < 1e-9 || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return at;
  if (kind !== "rect") return rimOf(box, kind, at);
  const s = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return [c[0] + dx * s, c[1] + dy * s];
}

/// Il capo di un arco a gomito sul contorno `kind` di `box`, verso `next`,
/// come lo mette draw.io: dritto in su o in giù se `next` sta sopra o sotto
/// la forma, dritto di lato se le sta a fianco, se no verso il centro.
export function orthogonalRim(box: Bounds, kind: Perimeter, next: Point): Point {
  const c = centreOf(box);
  const half = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2] as const;
  const within = (axis: 0 | 1): boolean => next[axis] >= box.min[axis] && next[axis] <= box.max[axis];
  for (const axis of [0, 1] as const) {
    if (!within(axis) || within(axis === 0 ? 1 : 0)) continue;
    // Lungo l'altro asse, fin dove arriva il contorno a quell'altezza.
    const other = axis === 0 ? 1 : 0;
    const f = half[axis] < 1e-9 ? 0 : Math.min(1, Math.abs(next[axis] - c[axis]) / half[axis]);
    const reach = kind === "rect" ? half[other] : kind === "ellipse" ? half[other] * Math.sqrt(1 - f * f) : half[other] * (1 - f);
    const out: [number, number] = [next[0], next[1]];
    out[other] = next[other] < c[other] ? c[other] - reach : c[other] + reach;
    return out;
  }
  return rimOf(box, kind, next);
}

/// Vero se `box` contiene il punto (`x`, `y`), bordi compresi.
const holds = (box: Bounds, x: number, y: number): boolean => x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1];

/// I vertici di mezzo di `sideToSideEdgeStyle` fra `s` e `t`, forme o punti,
/// come li fa draw.io: la curva in verticale, a metà fra le due o dove dice
/// il punto di passaggio `pt`, e le due uscite di lato all'altezza dei
/// centri, o di `pt` se ci sta.
export function sideToSide(s: Bounds, t: Bounds, pt: Point | null): Point[] {
  const l = Math.max(s.min[0], t.min[0]);
  const r = Math.min(s.max[0], t.max[0]);
  const x = pt !== null ? pt[0] : Math.round(r + (l - r) / 2);
  let y1 = (s.min[1] + s.max[1]) / 2;
  let y2 = (t.min[1] + t.max[1]) / 2;
  if (pt !== null && pt[1] >= s.min[1] && pt[1] <= s.max[1]) y1 = pt[1];
  if (pt !== null && pt[1] >= t.min[1] && pt[1] <= t.max[1]) y2 = pt[1];
  const free = (y: number): boolean => !holds(s, x, y) && !holds(t, x, y);
  const out: Point[] = [];
  if (free(y1)) out.push([x, y1]);
  if (free(y2)) out.push([x, y2]);
  if (out.length === 1) {
    if (pt === null) out.push([x, (Math.max(s.min[1], t.min[1]) + Math.min(s.max[1], t.max[1])) / 2]);
    else if (free(pt[1])) out.push([x, pt[1]]);
  }
  return out;
}

/// `box` con gli assi scambiati.
export const transposed = (box: Bounds): Bounds => ({ min: [box.min[1], box.min[0]], max: [box.max[1], box.max[0]] });

/// Il percorso di un arco `entityRelationEdgeStyle` dalla forma `source`
/// alla forma `target`, come lo fa draw.io: esce di lato dall'una ed entra di
/// lato nell'altra, coi due tratti lunghi `segment`; il tratto obliquo che
/// draw.io mette fra i due qui va a gomito, come ogni gomito di FubDraw.
export function entityRoute(source: Bounds, target: Bounds, segment: number): { readonly points: Point[]; readonly sourceLeft: boolean; readonly targetLeft: boolean } {
  const sourceLeft = target.max[0] < source.min[0];
  const targetLeft = source.max[0] < target.min[0];
  const [x0, y0] = [sourceLeft ? source.min[0] : source.max[0], (source.min[1] + source.max[1]) / 2];
  const [xe, ye] = [targetLeft ? target.min[0] : target.max[0], (target.min[1] + target.max[1]) / 2];
  const departure = x0 + (sourceLeft ? -segment : segment);
  const arrival = xe + (targetLeft ? -segment : segment);
  let via: Point[];
  if (sourceLeft === targetLeft) {
    const x = sourceLeft ? Math.min(x0, xe) - segment : Math.max(x0, xe) + segment;
    via = [[x, y0], [x, ye]];
  } else if (departure < arrival === sourceLeft) {
    const middle = (y0 + ye) / 2;
    via = [[departure, y0], [departure, middle], [arrival, middle], [arrival, ye]];
  } else {
    const middle = (departure + arrival) / 2;
    via = [[middle, y0], [middle, ye]];
  }
  return { points: elbowThrough([x0, y0], via, [xe, ye], false, false), sourceLeft, targetLeft };
}

/// Il percorso di un messaggio `sequenceEdgeStyle` da `source` a `target`,
/// o dai capi liberi `startAt` ed `endAt`: orizzontale, all'altezza del punto
/// di passaggio `via`, o del capo libero, o della prima forma, dal lato di
/// una forma che guarda l'altra.
export function sequenceRoute(source: Bounds | null, target: Bounds | null, startAt: Point, endAt: Point, via: Point | null): Point[] {
  const y = via?.[1] ?? (source === null ? startAt[1] : target === null ? endAt[1] : startAt[1]);
  const [from, to] = [source === null ? startAt[0] : centreOf(source)[0], target === null ? endAt[0] : centreOf(target)[0]];
  const x0 = source === null ? startAt[0] : to >= from ? source.max[0] : source.min[0];
  const xe = target === null ? endAt[0] : from <= to ? target.min[0] : target.max[0];
  return [
    [x0, y],
    [xe, y],
  ];
}

/// Il centro di un riquadro.
export const centreOf = (box: Bounds): Point => [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];

/// `p` girato di `angle` gradi, in senso orario, attorno a `centre`.
export function turned(p: Point, angle: number, centre: Point): Point {
  const a = (angle * Math.PI) / 180;
  const [x, y] = [p[0] - centre[0], p[1] - centre[1]];
  return [centre[0] + x * Math.cos(a) - y * Math.sin(a), centre[1] + x * Math.sin(a) + y * Math.cos(a)];
}

/// Il punto a `t` della lunghezza della spezzata `points`, e la direzione
/// del tratto su cui cade, di lunghezza uno.
export function along(points: readonly Point[], t: number): { readonly at: Point; readonly direction: Point } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]));
  let left = lengths.reduce((sum, length) => sum + length, 0) * t;
  for (const [i, length] of lengths.entries()) {
    if (length < 1e-9 || (left > length && i < lengths.length - 1)) {
      left -= length;
      continue;
    }
    const [a, b] = [points[i]!, points[i + 1]!];
    const f = Math.min(1, left / length);
    return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
  }
  return { at: points[0]!, direction: [1, 0] };
}

/// Dove il raggio dal centro di `box` verso `toward` ne esce.
function rim(box: Bounds, toward: Point): Point {
  const c = centreOf(box);
  const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
  const [hw, hh] = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return c;
  const scale = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return [c[0] + dx * Math.min(1, scale), c[1] + dy * Math.min(1, scale)];
}

/// Il punto da cui un arco a gomito esce da `box` verso `toward`: dritto in
/// verticale se `toward` sta sopra o sotto, in orizzontale se sta di lato;
/// se no dal lato che lo guarda. Dice anche se il primo tratto è verticale.
export function exitTowards(box: Bounds, toward: Point): { readonly at: Point; readonly vertical: boolean } {
  const c = centreOf(box);
  if (toward[0] >= box.min[0] && toward[0] <= box.max[0] && (toward[1] < box.min[1] || toward[1] > box.max[1])) {
    return { at: [toward[0], toward[1] < box.min[1] ? box.min[1] : box.max[1]], vertical: true };
  }
  if (toward[1] >= box.min[1] && toward[1] <= box.max[1]) {
    return { at: [toward[0] < c[0] ? box.min[0] : box.max[0], toward[1]], vertical: false };
  }
  return { at: [toward[0] < c[0] ? box.min[0] : box.max[0], c[1]], vertical: false };
}

/// I punti di una linea a gomito da `start` a `end` attraverso `via`: fra
/// due punti che non sono in fila si gira una volta, alternando la
/// direzione. `first` e `last` dicono se il primo e l'ultimo tratto sono
/// verticali.
export function elbowThrough(start: Point, via: readonly Point[], end: Point, first: boolean | null, last: boolean | null): Point[] {
  const all = [start, ...via, end];
  const out: Point[] = [start];
  let vertical = first;
  for (let i = 1; i < all.length; i++) {
    const a = out[out.length - 1]!;
    const b = all[i]!;
    const aligned = Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5;
    if (!aligned) {
      // L'ultimo tratto entra nel suo lato; gli altri alternano.
      let goVertical = vertical === null ? Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) : !vertical;
      if (i === 1 && first !== null) goVertical = first;
      if (i === all.length - 1 && last !== null) goVertical = !last;
      out.push(goVertical ? [a[0], b[1]] : [b[0], a[1]]);
      vertical = !goVertical;
    } else {
      vertical = Math.abs(a[0] - b[0]) < 0.5;
    }
    out.push(b);
  }
  // Via i punti doppi e quelli in mezzo a un tratto dritto.
  const clean: Point[] = [];
  for (const p of out) {
    const last2 = clean[clean.length - 1];
    if (last2 !== undefined && Math.abs(last2[0] - p[0]) < 0.01 && Math.abs(last2[1] - p[1]) < 0.01) continue;
    clean.push(p);
    while (clean.length >= 3) {
      const [a, b, c] = [clean[clean.length - 3]!, clean[clean.length - 2]!, clean[clean.length - 1]!];
      const straight = (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01);
      if (!straight) break;
      clean.splice(clean.length - 2, 1);
    }
  }
  return clean;
}

/// La curva di un arco curvo di draw.io: quadratiche da un punto di mezzo
/// all'altro, coi punti di passaggio per controllo (`mxConnector`).
export function curvedThrough(points: readonly Point[]): Segment[] {
  const out: Segment[] = [{ kind: "move", to: points[0]! }];
  if (points.length < 3) {
    for (const p of points.slice(1)) out.push({ kind: "line", to: p });
    return out;
  }
  let at = points[0]!;
  const quad = (control: Point, to: Point): void => {
    // Una quadratica è una cubica coi controlli a due terzi.
    out.push({ kind: "cubic", c1: [at[0] + ((control[0] - at[0]) * 2) / 3, at[1] + ((control[1] - at[1]) * 2) / 3], c2: [to[0] + ((control[0] - to[0]) * 2) / 3, to[1] + ((control[1] - to[1]) * 2) / 3], to });
    at = to;
  };
  for (let i = 1; i < points.length - 2; i++) {
    const [p, q] = [points[i]!, points[i + 1]!];
    quad(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  }
  quad(points[points.length - 2]!, points[points.length - 1]!);
  return out;
}

// ---------------------------------------------------------------------------
// Il lettore.
// ---------------------------------------------------------------------------
