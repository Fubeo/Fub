// «Semplifica» (livello Esperto): meno nodi, la stessa forma entro una
// tolleranza. Senza DOM.
//
// - **Il tracciato com'era si misura.** Si guarda ogni nodo e un punto ogni
//   mezza tolleranza fra loro, e le cubiche nuove passano entro la
//   tolleranza da ognuno (`fit.ts`).
// - **Gli spigoli restano spigoli.** Un nodo dove il tracciato gira più di
//   35° fra i punti a due tolleranze prima e dopo, e più di ogni altro lì
//   attorno, resta, e le curve vi arrivano senza raccordarsi. Una curva più
//   stretta di qualche tolleranza diventa uno spigolo.
// - **Le linee lunghe restano linee.** Un segmento dritto lungo almeno
//   quattro tolleranze resta lui se a ogni capo fa spigolo, finisce,
//   prosegue liscio in una curva o tocca un segmento quattro volte più
//   corto; le curve accanto ne prendono il verso. Un rettangolo arrotondato
//   tiene i lati dritti, e una spezzata di lati pari si liscia. Fra due nodi
//   fermi, punti su una retta diventano una linea.
// - **Mai più nodi di prima.** Un tratto fra due nodi fermi che con le
//   cubiche ne avrebbe quanti o più di prima resta com'era, archi compresi.
// - **Un sottotracciato chiuso** comincia dal suo primo nodo fermo; senza,
//   dal suo primo nodo, e vi passa liscio.

import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { pointAt, tangentAt, type Curve } from "../scene/curves";
import { AWAY_SAMPLES, away, cumulative, endDirection, fitCubics, straight, unit, type Fitted } from "./fit";
import { curveAt, readNodes, writeNodes, type Link, type Subpath } from "./nodes";

/// Quanto gira il tracciato in un nodo, fra i punti a [`REACH`] tolleranze
/// prima e dopo, perché sia uno spigolo.
const CORNER_RADIANS = (35 * Math.PI) / 180;

/// Quanto possono differire i versi ai due lati di un nodo perché vi si
/// passi liscio.
const SMOOTH_RADIANS = (2 * Math.PI) / 180;

/// Le tolleranze fra un nodo e i punti che dicono dove va il tracciato.
const REACH = 2;

/// Le tolleranze di un segmento dritto che resta linea.
const LONG = 4;

/// Quante volte più corto della linea è un segmento accanto che ne è un
/// dettaglio.
const SHORTER = 4;

/// Quanto lontano dal suo terzo di corda può stare una maniglia di una
/// linea fatta curva: meno di quanto il formato scrive.
const STRAIGHT_LINK = 0.005;

/// I punti che si guardano, al più, per un tracciato: oltre, si guardano più
/// radi.
export const MAX_SAMPLES = 8_192;

/// I pezzi in cui si misura la lunghezza di una curva.
const LENGTH_PARTS = 16;

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angle = (u: Point, v: Point): number => Math.acos(Math.min(1, Math.max(-1, dot(u, v))));

/// I nodi di `segments`: quelli che lo strumento Nodi mostra.
export function nodeCount(segments: readonly Segment[]): number {
  return readNodes(segments).reduce((count, sub) => count + sub.nodes.length, 0);
}

/// `segments` con meno nodi, entro `tolerance` da come erano. Una
/// tolleranza che non è un numero positivo non cambia niente.
export function simplified(segments: readonly Segment[], tolerance: number): Segment[] {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) return [...segments];
  const subs = readNodes(segments);
  const total = subs.reduce((sum, sub) => sum + sub.links.reduce((s, _, i) => s + linkLength(curveAt(sub, i)), 0), 0);
  const spacing = Math.max(tolerance / 2, total / MAX_SAMPLES);
  return writeNodes(subs.map((sub) => simplifiedSubpath(sub, tolerance, spacing)));
}

/// La lunghezza di una curva, misurata su una spezzata fitta.
function linkLength({ from, curve }: { readonly from: Point; readonly curve: Curve }): number {
  if (curve.kind === "line") return distance(from, curve.to);
  let length = 0;
  let previous = from;
  for (let i = 1; i <= LENGTH_PARTS; i++) {
    const p = pointAt(from, curve, i / LENGTH_PARTS);
    length += distance(previous, p);
    previous = p;
  }
  return length;
}

/// Vero se la curva è una linea: scritta come tale, o una cubica con le
/// maniglie a un terzo e due terzi della corda, come la lascia una linea
/// fatta curva senza piegarla. Una curva che per caso è quasi dritta, come
/// un pezzo del contorno di un tratto, resta una curva.
function straightLink(from: Point, curve: Curve): boolean {
  if (curve.kind === "line") return !(from[0] === curve.to[0] && from[1] === curve.to[1]);
  if (curve.kind !== "cubic") return false;
  const third = (f: number): Point => [from[0] + (curve.to[0] - from[0]) * f, from[1] + (curve.to[1] - from[1]) * f];
  return distance(curve.c1, third(1 / 3)) <= STRAIGHT_LINK && distance(curve.c2, third(2 / 3)) <= STRAIGHT_LINK && distance(from, curve.to) > 0;
}

/// I punti di un sottotracciato, uno ogni `spacing` o meno, distinti dal
/// precedente; e l'indice del punto di ogni nodo. Chiuso, l'ultimo punto è
/// il primo nodo, di nuovo.
interface Sampled {
  readonly points: Point[];
  readonly at: number[];
}

function sampled(sub: Subpath, spacing: number): Sampled {
  const points: Point[] = [sub.nodes[0]!];
  const at = [0];
  sub.links.forEach((_, i) => {
    const piece = curveAt(sub, i);
    const n = Math.max(1, Math.ceil(linkLength(piece) / spacing));
    for (let j = 1; j <= n; j++) {
      const p = j === n ? piece.curve.to : pointAt(piece.from, piece.curve, j / n);
      const last = points[points.length - 1]!;
      if (p[0] !== last[0] || p[1] !== last[1]) points.push(p);
    }
    at.push(points.length - 1);
  });
  return { points, at };
}

/// Il primo punto dopo `i` nel verso `step` lontano almeno `reach` da lui,
/// come [`away`]: aperto, fino al capo; chiuso, girando attorno, dove
/// l'ultimo punto è il primo. `null` se non c'è.
function around(points: readonly Point[], closed: boolean, i: number, step: 1 | -1, reach: number): number | null {
  const m = points.length - 1;
  if (!closed) return away(points, i, step, step > 0 ? m : 0, reach);
  const from = i % m;
  let k = from;
  for (let count = 0; count < Math.min(AWAY_SAMPLES, m - 1); count++) {
    k = (k + step + m) % m;
    if (distance(points[k]!, points[from]!) >= reach) return k;
  }
  return null;
}

/// Quanto gira il tracciato in ogni nodo, fra i punti lontani `reach` prima
/// e dopo; 0 dove non si sa, ai capi di un sottotracciato aperto.
function turnsAt(sub: Subpath, { points, at }: Sampled, reach: number): number[] {
  return sub.nodes.map((_, k) => {
    if (!sub.closed && (k === 0 || k === sub.nodes.length - 1)) return 0;
    const i = at[k]!;
    const j = around(points, sub.closed, i, -1, reach);
    const l = around(points, sub.closed, i, 1, reach);
    if (j === null || l === null) return 0;
    const u = unit(minus(points[i]!, points[j]!));
    const v = unit(minus(points[l]!, points[i]!));
    return u === null || v === null ? 0 : angle(u, v);
  });
}

/// Gli spigoli: i nodi che girano almeno [`CORNER_RADIANS`], più di ogni
/// altro più vicino di `reach` lungo il tracciato; a pari giro, il primo.
function cornersOf(sub: Subpath, turns: readonly number[], positions: readonly number[], total: number, reach: number): Set<number> {
  const candidates = turns.flatMap((turn, k) => (turn >= CORNER_RADIANS ? [k] : []));
  const c = candidates.length;
  const apart = (a: number, b: number): number => {
    const d = Math.abs(positions[a]! - positions[b]!);
    return sub.closed ? Math.min(d, total - d) : d;
  };
  const beats = (other: number, k: number): boolean => turns[other]! > turns[k]! || (turns[other] === turns[k] && other < k);
  const out = new Set<number>();
  candidates.forEach((k, x) => {
    for (const step of [1, -1]) {
      for (let y = 1; y < c; y++) {
        const at = x + step * y;
        if (!sub.closed && (at < 0 || at >= c)) break;
        const other = candidates[(at + c) % c]!;
        if (other === k || apart(other, k) >= reach) break;
        if (beats(other, k)) return;
      }
    }
    out.add(k);
  });
  return out;
}

/// Il verso, lungo 1, in cui il segmento `link` parte (`end` falso) o
/// arriva.
function travel(sub: Subpath, link: number, end: boolean): Point | null {
  const { from, curve } = curveAt(sub, link);
  return tangentAt(from, curve, end);
}

/// Il sottotracciato `sub` girato perché cominci dal nodo `start`.
function rotated(sub: Subpath, start: number): Subpath {
  if (start === 0) return sub;
  return { nodes: [...sub.nodes.slice(start), ...sub.nodes.slice(0, start)], links: [...sub.links.slice(start), ...sub.links.slice(0, start)], closed: true };
}

/// I punti di un sottotracciato chiuso girati come [`rotated`]: dal nodo
/// `start`, fino a lui di nuovo.
function rotatedSamples({ points, at }: Sampled, start: number): Sampled {
  const m = points.length - 1;
  const s = at[start]!;
  const turned = [...points.slice(s, m), ...points.slice(0, s + 1)];
  const n = at.length - 1;
  const moved: number[] = [];
  for (let k = 0; k < n; k++) {
    const old = (start + k) % n;
    moved.push(old >= start ? at[old]! - s : at[old]! + m - s);
  }
  moved.push(m);
  return { points: turned, at: moved };
}

const linkOf = (curve: Curve): Link =>
  curve.kind === "cubic" ? { kind: "cubic", c1: curve.c1, c2: curve.c2 } : { kind: "line" };

/// `sub` con meno nodi, entro `tolerance`, guardato un punto ogni `spacing`.
function simplifiedSubpath(sub: Subpath, tolerance: number, spacing: number): Subpath {
  const n = sub.nodes.length;
  if (n < 3) return sub;
  const reach = REACH * tolerance;
  const first = sampled(sub, spacing);
  if (first.points.length < 2) return sub;
  const lengths = cumulative(first.points);
  const total = lengths[lengths.length - 1]!;
  const positions = first.at.map((i) => lengths[i]!);
  const corners = cornersOf(sub, turnsAt(sub, first, reach), positions, total, reach);

  // Il segmento che arriva al nodo `k` e quello che ne parte; -1 ai capi di
  // un sottotracciato aperto.
  const links = sub.links.length;
  const before = (k: number): number => (sub.closed ? (k - 1 + n) % n : k - 1);
  const after = (k: number): number => (k < links ? k : -1);
  const straightness = sub.links.map((_, i) => {
    const { from, curve } = curveAt(sub, i);
    return straightLink(from, curve);
  });
  const spans = sub.links.map((_, i) => linkLength(curveAt(sub, i)));
  // Liscio: i versi ai due lati coincidono, e uno dei due segmenti è una
  // curva. Due linee di fila fanno una spezzata, che si liscia, o una
  // retta, che diventa una linea.
  const smooth = sub.nodes.map((_, k) => {
    const [b, a] = [before(k), after(k)];
    if (b < 0 || a < 0 || (straightness[b] && straightness[a])) return false;
    const u = travel(sub, b, true);
    const v = travel(sub, a, false);
    return u !== null && v !== null && angle(u, v) < SMOOTH_RADIANS;
  });
  // Un capo dove una linea lunga resta lei: il sottotracciato finisce, fa
  // spigolo, prosegue liscio in una curva, o il segmento accanto è tanto più
  // corto da essere un dettaglio della linea, non un lato come lei.
  const holds = (line: number, k: number, other: number): boolean =>
    other < 0 || corners.has(k) || smooth[k]! || spans[other]! * SHORTER <= spans[line]!;
  const fixed = sub.links.map(
    (_, i) => straightness[i]! && spans[i]! >= LONG * tolerance && holds(i, i, before(i)) && holds(i, (i + 1) % n, after((i + 1) % n)),
  );
  const stops = new Set(corners);
  if (!sub.closed) {
    stops.add(0);
    stops.add(n - 1);
  }
  fixed.forEach((isFixed, i) => {
    if (isFixed) {
      stops.add(i);
      stops.add((i + 1) % n);
    }
  });

  if (sub.closed && stops.size === 0) return looped(sub, first, tolerance) ?? sub;
  const start = sub.closed ? Math.min(...stops) : 0;
  const turned = rotated(sub, start);
  const samples = start === 0 ? first : rotatedSamples(first, start);
  const back = (k: number): number => (k + start) % n;
  const isFixed = (k: number): boolean => fixed[back(k)]!;
  const marks = [...stops].map((k) => (k - start + n) % n).sort((a, b) => a - b);
  if (sub.closed) marks.push(n);
  return assembled(turned, samples, marks, isFixed, (k) => corners.has(back(k % n)), tolerance);
}

/// Il sottotracciato `sub`, che comincia da un nodo fermo, rifatto pezzo per
/// pezzo fra i nodi fermi `marks` (chiuso, l'ultimo è `n`, il primo di
/// nuovo).
function assembled(sub: Subpath, { points, at }: Sampled, marks: readonly number[], isFixed: (link: number) => boolean, corner: (node: number) => boolean, tolerance: number): Subpath {
  const n = sub.nodes.length;
  const lengths = cumulative(points);
  const nodes: Point[] = [sub.nodes[0]!];
  const out: Link[] = [];
  const original = (a: number, b: number): void => {
    for (let k = a; k < b; k++) {
      out.push(sub.links[k]!);
      nodes.push(sub.nodes[(k + 1) % n]!);
    }
  };
  // Il verso di una linea ferma accanto al nodo `k`, dal lato `side`, se
  // lì non c'è uno spigolo: la curva vi arriva liscia.
  const lineSide = (k: number, side: -1 | 1): Point | null => {
    const node = k % n;
    if (corner(node)) return null;
    const raw = side < 0 ? node - 1 : node;
    const link = sub.closed ? (raw + n) % n : raw;
    if (link < 0 || link >= sub.links.length || !isFixed(link)) return null;
    const { from, curve } = curveAt(sub, link);
    return unit(minus(curve.to, from));
  };

  let m = 0;
  while (m + 1 < marks.length) {
    const a = marks[m]!;
    // Le linee ferme di fila che proseguono, senza spigoli, su una retta
    // diventano una.
    if (isFixed(a)) {
      let b = marks[m + 1]!;
      let next = m + 1;
      while (next + 1 < marks.length && isFixed(b % n) && !corner(b) && straight(points, at[a]!, at[marks[next + 1]!]!, tolerance / 4)) {
        next++;
        b = marks[next]!;
      }
      if (b - a === 1) original(a, b);
      else {
        out.push({ kind: "line" });
        nodes.push(sub.nodes[b % n]!);
      }
      m = next;
      continue;
    }
    const b = marks[m + 1]!;
    const [first, last] = [at[a]!, at[b]!];
    // Un tratto che non va da nessuna parte non ha pezzi: i suoi nodi, nel
    // punto dove comincia, se ne vanno.
    const pieces: Fitted[] = [];
    if (last > first && straight(points, first, last, tolerance / 4)) pieces.push({ first, last, curve: { kind: "line", to: points[last]! }, u: [] });
    else if (last > first) {
      const t1 = lineSide(a, -1) ?? endDirection(points, first, last, tolerance);
      const t2 = lineSide(b, 1) ?? endDirection(points, last, first, tolerance);
      fitCubics(points, lengths, first, last, t1, t2, tolerance, pieces);
    }
    if (pieces.length >= b - a) original(a, b);
    else
      for (const piece of pieces) {
        out.push(linkOf(piece.curve));
        nodes.push(piece.curve.to);
      }
    m++;
  }
  if (sub.closed) nodes.pop();
  return { nodes, links: out, closed: sub.closed };
}

/// Un sottotracciato chiuso senza nodi fermi, rifatto tutto da un capo, il
/// suo primo nodo, dove passa liscio; `null` se non ha meno nodi di prima.
function looped(sub: Subpath, { points }: Sampled, tolerance: number): Subpath | null {
  const m = points.length - 1;
  if (m < 2) return null;
  // Il verso attraverso il primo nodo, dal punto lontano una tolleranza
  // prima a quello dopo, come [`throughDirection`].
  const a = around(points, true, 0, -1, tolerance) ?? m - 1;
  const b = around(points, true, 0, 1, tolerance) ?? 1;
  const through = unit(minus(points[b]!, points[a]!)) ?? unit(minus(points[1]!, points[m - 1]!)) ?? [1, 0];
  const pieces: Fitted[] = [];
  fitCubics(points, cumulative(points), 0, m, through, through, tolerance, pieces);
  if (pieces.length >= sub.links.length) return null;
  const nodes: Point[] = [sub.nodes[0]!];
  const links: Link[] = [];
  for (const piece of pieces) {
    links.push(linkOf(piece.curve));
    nodes.push(piece.curve.to);
  }
  nodes.pop();
  return { nodes, links, closed: true };
}
