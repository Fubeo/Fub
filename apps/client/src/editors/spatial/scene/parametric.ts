// Poligoni e stelle: le forme sintetiche coi parametri (formato della scena,
// §6). `fub:geom` porta il centro, il raggio, i lati o le punte, il rapporto
// interno di una stella, la rotazione e il raggio degli angoli; `d` si
// calcola da lì, come per la freccia.
//
// - **La lettura** vuole la grammatica intera: un numero di valori diverso,
//   un raggio che non è positivo, lati che non sono un intero da 3 a 1000,
//   un rapporto fuori da (0, 1] o un raggio degli angoli negativo lasciano un
//   tracciato qualunque, che si legge da `d`.
// - **Rotazione 0 è la forma diritta:** un poligono poggia su un lato, una
//   stella ha una punta in alto. I gradi vanno in senso orario, come
//   `rotate()`.
// - **Gli angoli arrotondati** sono archi di cerchio tangenti ai due lati;
//   un raggio che non entra in metà lato si riduce a quello che entra, vertice
//   per vertice.
// - **Il `d` si calcola dalla geometria com'è scritta**, così chi lo
//   rigenera da `fub:geom` ottiene lo stesso testo: `polygonalAttrs` scrive
//   la geometria, la rilegge e ne calcola il `d`.

import { formatNumber, formatScaled, roundHalfUp } from "../number";
import type { Segment } from "./geometry";
import { toRadians, type Point } from "./matrix";
import { pathData } from "./serialize";
import { numberList } from "./values";

/// Il valore di `fub:shape` di un poligono e di una stella.
export type PolygonalShape = "polygon" | "star";

/// Un poligono regolare o una stella, come li porta `fub:geom`.
export interface Polygonal {
  readonly shape: PolygonalShape;
  readonly cx: number;
  readonly cy: number;
  /// Il raggio del cerchio dei vertici, o delle punte.
  readonly r: number;
  /// I lati di un poligono, le punte di una stella.
  readonly count: number;
  /// Il rapporto fra il raggio dei vertici interni e quello delle punte, di
  /// una stella; `null` per un poligono.
  readonly ratio: number | null;
  /// Gradi, in senso orario.
  readonly rotation: number;
  /// Il raggio degli angoli; 0 li lascia vivi.
  readonly corner: number;
}

/// Quanti lati, o punte, al più e al meno.
export const MIN_COUNT = 3;
export const MAX_COUNT = 1000;

/// I decimali del rapporto di una stella.
export const RATIO_DECIMALS = 4;

/// Il rapporto di una stella nuova: quello della stella a cinque punte
/// disegnata senza alzare la penna, i cui lati stanno in linea a due a due,
/// cos 72° / cos 36°.
export const STAR_RATIO = 0.382;

const countOk = (value: number): boolean => Number.isInteger(value) && value >= MIN_COUNT && value <= MAX_COUNT;

/// La geometria di un `path` con `fub:shape` `shape` e `fub:geom` `geom`;
/// `null` se `geom` è fuori dalla grammatica.
export function readPolygonal(shape: PolygonalShape, geom: string): Polygonal | null {
  const numbers = numberList(geom);
  if (numbers === null) return null;
  if (shape === "polygon") {
    if (numbers.length !== 6) return null;
    const [cx, cy, r, count, rotation, corner] = numbers as [number, number, number, number, number, number];
    if (!(r > 0) || !countOk(count) || !(corner >= 0)) return null;
    return { shape, cx, cy, r, count, ratio: null, rotation, corner };
  }
  if (numbers.length !== 7) return null;
  const [cx, cy, r, count, ratio, rotation, corner] = numbers as [number, number, number, number, number, number, number];
  if (!(r > 0) || !countOk(count) || !(ratio > 0 && ratio <= 1) || !(corner >= 0)) return null;
  return { shape, cx, cy, r, count, ratio, rotation, corner };
}

/// La rotazione fra -180 escluso e 180, come FubDraw la scrive.
export function normalRotation(degrees: number): number {
  const turned = degrees % 360;
  const value = turned > 180 ? turned - 360 : turned <= -180 ? turned + 360 : turned;
  return value === 0 ? 0 : value;
}

/// `fub:geom` di `p`, coi numeri del formato (§7). La rotazione si arrotonda
/// prima di riportarla fra -180 escluso e 180, così anche 180,004 si scrive
/// `180`.
export function writePolygonal(p: Polygonal): string {
  const two = (value: number): string => formatNumber(value, 2);
  const parts = [two(p.cx), two(p.cy), two(p.r), String(p.count)];
  if (p.shape === "star") parts.push(formatNumber(p.ratio ?? STAR_RATIO, RATIO_DECIMALS));
  const hundredths = roundHalfUp(normalRotation(p.rotation), 100);
  parts.push(formatScaled(hundredths <= -18000 ? hundredths + 36000 : hundredths, 2), two(p.corner));
  return parts.join(" ");
}

/// I vertici di `p`, dal primo, nel verso in cui il tracciato li percorre:
/// orario sullo schermo.
export function polygonalVertices(p: Polygonal): Point[] {
  const out: Point[] = [];
  const at = (degrees: number, radius: number): Point => {
    const radians = toRadians(degrees);
    return [p.cx + radius * Math.cos(radians), p.cy + radius * Math.sin(radians)];
  };
  if (p.shape === "polygon") {
    for (let k = 0; k < p.count; k++) out.push(at(90 + 180 / p.count + (360 * k) / p.count + p.rotation, p.r));
    return out;
  }
  const inner = p.r * (p.ratio ?? STAR_RATIO);
  for (let j = 0; j < p.count; j++) {
    const tip = 270 + (360 * j) / p.count + p.rotation;
    out.push(at(tip, p.r), at(tip + 180 / p.count, inner));
  }
  return out;
}

/// Vero se `a` e `b` si scrivono nello stesso punto.
const samePlace = (a: Point, b: Point): boolean =>
  formatNumber(a[0], 2) === formatNumber(b[0], 2) && formatNumber(a[1], 2) === formatNumber(b[1], 2);

/// Un vertice col suo arco: i punti di tangenza sul lato che arriva e su
/// quello che parte, il raggio e il verso. Senza arco, `radius` è 0.
interface Turn {
  readonly at: Point;
  readonly enter: Point;
  readonly leave: Point;
  readonly radius: number;
  readonly sweep: boolean;
}

/// Il vertice `i` di `vertices` arrotondato di `corner`, se entra.
function turnAt(vertices: readonly Point[], i: number, corner: number): Turn {
  const m = vertices.length;
  const at = vertices[i]!;
  const before = vertices[(i + m - 1) % m]!;
  const after = vertices[(i + 1) % m]!;
  const sharp: Turn = { at, enter: at, leave: at, radius: 0, sweep: true };
  if (!(corner > 0)) return sharp;
  const back = [before[0] - at[0], before[1] - at[1]] as const;
  const ahead = [after[0] - at[0], after[1] - at[1]] as const;
  const backLength = Math.hypot(back[0], back[1]);
  const aheadLength = Math.hypot(ahead[0], ahead[1]);
  if (backLength === 0 || aheadLength === 0) return sharp;
  const cos = Math.min(1, Math.max(-1, (back[0] * ahead[0] + back[1] * ahead[1]) / (backLength * aheadLength)));
  const angle = Math.acos(cos);
  const half = Math.tan(angle / 2);
  // Un vertice piatto non gira, e uno senza apertura non ha dove.
  if (!(half > 0) || !Number.isFinite(half) || angle >= Math.PI - 1e-9) return sharp;
  let reach = corner / half;
  let radius = corner;
  const room = Math.min(backLength, aheadLength) / 2;
  if (reach > room) {
    reach = room;
    radius = reach * half;
  }
  if (formatNumber(radius, 2) === "0") return sharp;
  const enter: Point = [at[0] + (back[0] / backLength) * reach, at[1] + (back[1] / backLength) * reach];
  const leave: Point = [at[0] + (ahead[0] / aheadLength) * reach, at[1] + (ahead[1] / aheadLength) * reach];
  // Un arco che comincia e finisce nello stesso punto scritto non si vede.
  if (samePlace(enter, leave)) return sharp;
  // Con l'asse y che scende, un prodotto vettoriale positivo è una svolta
  // in senso orario: l'arco va nel verso positivo di SVG.
  const cross = (at[0] - before[0]) * (after[1] - at[1]) - (at[1] - before[1]) * (after[0] - at[0]);
  return { at, enter, leave, radius, sweep: cross > 0 };
}

/// I segmenti di `p`: i vertici chiusi, e con un raggio degli angoli gli
/// archi al posto dei vertici (§6).
export function polygonalSegments(p: Polygonal): Segment[] {
  const vertices = polygonalVertices(p);
  const turns = vertices.map((_, i) => turnAt(vertices, i, p.corner));
  const segments: Segment[] = [];
  let current: Point = turns[0]!.enter;
  segments.push({ kind: "move", to: current });
  turns.forEach((turn, i) => {
    if (i > 0 && !samePlace(current, turn.enter)) segments.push({ kind: "line", to: turn.enter });
    current = turn.enter;
    if (turn.radius > 0) {
      segments.push({ kind: "arc", radii: [turn.radius, turn.radius], rotation: 0, large: false, sweep: turn.sweep, to: turn.leave });
      current = turn.leave;
    }
  });
  segments.push({ kind: "close" });
  return segments;
}

/// `d` di `p`.
export function polygonalPath(p: Polygonal): string {
  return pathData(polygonalSegments(p));
}

/// `fub:shape`, `fub:geom` e `d` di `p`: la geometria com'è scritta, e il
/// `d` calcolato da lei. `null` se, scritta, la geometria non si rilegge,
/// come un raggio che arrotondato vale 0.
export function polygonalAttrs(p: Polygonal): { readonly "fub:shape": PolygonalShape; readonly "fub:geom": string; readonly d: string } | null {
  const geom = writePolygonal(p);
  const written = readPolygonal(p.shape, geom);
  if (written === null) return null;
  return { "fub:shape": p.shape, "fub:geom": geom, d: polygonalPath(written) };
}
