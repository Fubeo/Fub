// La spina di un tratto a penna, per lo strumento «Nodi»: un tracciato di
// pochi nodi lungo i campioni dell'inchiostro, come quello su cui Illustrator
// stende un pennello. I nodi si modificano sulla spina, e l'inchiostro la
// segue. Senza DOM.
//
// - **La spina** viene dai campioni coi minimi quadrati di Schneider («An
//   Algorithm for Automatically Fitting Digitized Curves»), entro una
//   tolleranza che cresce con lo spessore del pennello. Dove la mano gira di
//   colpo la spina ha uno spigolo; un tratto fra due spigoli che va dritto è
//   una linea.
// - **Ogni campione ha un posto sulla spina:** il segmento, il parametro e lo
//   scarto da lì, che è il tremolio della mano. Quando la spina cambia, il
//   campione va nello stesso posto della spina nuova, con lo scarto girato
//   quanto gira lei lì. Pressione, tempo e altitudine restano; l'azimut gira
//   con lo scarto.
// - **Dove la spina si allunga** l'inchiostro riceve campioni in mezzo, coi
//   valori di mezzo, così il contorno resta morbido. Non con la pressione
//   simulata, che il pennello calcola dalla distanza fra i campioni.
// - **Eliminare un nodo** porta i campioni dei segmenti uniti sul segmento
//   nuovo, in proporzione alla lunghezza; eliminare un capo accorcia il
//   tratto.
// - **La stessa spina per lo stesso inchiostro:** dipende soltanto dai
//   campioni e dalla tolleranza.

import { createInk, inkChannel, inkLength, inkPoint, type Ink } from "../ink/codec";
import { INK_MAX_SAMPLES, quantizeAzimuth, quantizeCoordinate } from "../ink/sample";
import { derivativeAt, pointAt, type Curve } from "../scene/curves";
import { remEuclid } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { AWAY_SAMPLES, REFINE_ROUNDS, away, closer, cumulative, endDirection, fitCubics, onLine, straight, unit, type Fitted } from "./fit";
import { curveAt, parseKey, type Link, type NodeKey, type Subpath } from "./nodes";

/// Un posto sulla spina: il segmento e il parametro. Su una spina di un nodo
/// solo, senza segmenti, è `{ link: 0, t: 0 }`.
export interface Place {
  readonly link: number;
  readonly t: number;
}

/// La spina di un tratto: un sottotracciato aperto, e per ogni campione il
/// suo posto e il suo scarto da lì.
export interface Spine {
  readonly sub: Subpath;
  readonly places: readonly Place[];
  readonly offsets: readonly Point[];
}

/// Quanto la spina può scostarsi dai campioni di un pennello spesso `size`:
/// metà dello spessore, e mai meno di mezza unità.
export const spineTolerance = (size: number): number => Math.max(0.5, size / 2);

/// Quanto deve girare il tratto, in un tratto lungo tre tolleranze per parte,
/// perché la spina vi metta uno spigolo.
const CORNER_RADIANS = (75 * Math.PI) / 180;

const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: Point, b: Point, f: number): Point => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

const rotate = (a: Point, radians: number): Point => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [a[0] * cos - a[1] * sin, a[0] * sin + a[1] * cos];
};

// ---------------------------------------------------------------------------
// La spina dai campioni.
// ---------------------------------------------------------------------------

/// Gli indici dei punti dove il tratto fa uno spigolo: quanto gira fra il
/// punto lontano `reach` prima e quello lontano `reach` dopo supera
/// [`CORNER_RADIANS`], ed è il più alto lì attorno. Mai i capi.
function corners(points: readonly Point[], reach: number): number[] {
  const n = points.length;
  const turns = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const j = away(points, i, -1, 0, reach);
    const k = away(points, i, 1, n - 1, reach);
    // Troppo vicino a un capo per dire dove va il tratto.
    if (j === null || k === null) continue;
    const u = unit(minus(points[i]!, points[j]!));
    const v = unit(minus(points[k]!, points[i]!));
    if (u === null || v === null) continue;
    turns[i] = Math.acos(Math.min(1, Math.max(-1, dot(u, v))));
  }
  const near = (i: number, m: number): boolean => Math.abs(m - i) <= AWAY_SAMPLES && distance(points[m]!, points[i]!) < reach;
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const turn = turns[i]!;
    if (turn < CORNER_RADIANS) continue;
    let highest = true;
    for (let m = i - 1; highest && m > 0 && near(i, m); m--) if (turns[m]! > turn) highest = false;
    for (let m = i + 1; highest && m < n - 1 && near(i, m); m++) if (turns[m]! >= turn) highest = false;
    if (highest) out.push(i);
  }
  return out;
}

const linkOf = (curve: Curve): Link =>
  curve.kind === "cubic" ? { kind: "cubic", c1: curve.c1, c2: curve.c2 } : { kind: "line" };

/// La spina dei punti `points`, i campioni di un tratto in ordine, entro
/// `tolerance` da loro.
export function fitSpine(points: readonly Point[], tolerance: number): Spine {
  // I punti distinti, e per ogni campione il suo.
  const unique: Point[] = [];
  const owner: number[] = [];
  for (const p of points) {
    const last = unique[unique.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) unique.push(p);
    owner.push(unique.length - 1);
  }
  if (unique.length < 2) {
    const node = unique[0] ?? [0, 0];
    return { sub: { nodes: [node], links: [], closed: false }, places: points.map(() => ({ link: 0, t: 0 })), offsets: points.map((p) => minus(p, node)) };
  }
  const lengths = cumulative(unique);
  // Gli spigoli si cercano sui punti a un quarto di tolleranza l'uno
  // dall'altro: il tremolio più fitto non conta, e un tratto di mille
  // campioni per unità costa quanto uno di pochi.
  const coarse: number[] = [0];
  for (let i = 1; i < unique.length - 1; i++) if (distance(unique[i]!, unique[coarse[coarse.length - 1]!]!) >= tolerance / 4) coarse.push(i);
  coarse.push(unique.length - 1);
  const cuts = [0, ...corners(coarse.map((i) => unique[i]!), 3 * tolerance).map((i) => coarse[i]!), unique.length - 1];
  const pieces: Fitted[] = [];
  for (let c = 0; c + 1 < cuts.length; c++) {
    const first = cuts[c]!;
    const last = cuts[c + 1]!;
    if (straight(unique, first, last, tolerance)) {
      const a = unique[first]!;
      const b = unique[last]!;
      pieces.push({ first, last, curve: { kind: "line", to: b }, u: unique.slice(first, last + 1).map((p) => onLine(a, b, p)) });
      continue;
    }
    fitCubics(unique, lengths, first, last, endDirection(unique, first, last, tolerance), endDirection(unique, last, first, tolerance), tolerance, pieces);
  }
  const nodes: Point[] = [unique[0]!];
  const links: Link[] = [];
  const at = new Array<Place>(unique.length);
  pieces.forEach((piece, link) => {
    nodes.push(piece.curve.to);
    links.push(linkOf(piece.curve));
    for (let i = piece.first; i < piece.last; i++) at[i] = { link, t: piece.u[i - piece.first]! };
  });
  at[unique.length - 1] = { link: pieces.length - 1, t: 1 };
  const sub: Subpath = { nodes, links, closed: false };
  // Ogni punto sul punto più vicino del suo segmento, così lo scarto è
  // quello che si vede.
  const places = at.map((place, i): Place => {
    const { from, curve } = curveAt(sub, place.link);
    if (curve.kind !== "cubic") return place;
    let t = place.t;
    for (let round = 0; round < REFINE_ROUNDS; round++) t = closer(from, curve, unique[i]!, t);
    return { link: place.link, t };
  });
  const offsets = places.map((place, i) => minus(unique[i]!, placePoint(sub, place)));
  return { sub, places: owner.map((i) => places[i]!), offsets: owner.map((i) => offsets[i]!) };
}

// ---------------------------------------------------------------------------
// I posti sulla spina.
// ---------------------------------------------------------------------------

/// Il punto della spina `sub` al posto `place`.
export function placePoint(sub: Subpath, place: Place): Point {
  if (sub.links.length === 0) return sub.nodes[0]!;
  const { from, curve } = curveAt(sub, place.link);
  return pointAt(from, curve, place.t);
}

/// L'angolo del verso in cui la spina `sub` passa per `place`; `null` se lì
/// non va da nessuna parte.
function headingAt(sub: Subpath, place: Place): number | null {
  if (sub.links.length === 0) return null;
  const { from, curve } = curveAt(sub, place.link);
  let d = derivativeAt(from, curve, place.t);
  // Una maniglia ritirata sul nodo: il verso di poco più in là.
  if (Math.hypot(d[0], d[1]) < 1e-9) {
    const a = pointAt(from, curve, Math.max(0, place.t - 1e-3));
    const b = pointAt(from, curve, Math.min(1, place.t + 1e-3));
    d = minus(b, a);
  }
  return Math.hypot(d[0], d[1]) < 1e-12 ? null : Math.atan2(d[1], d[0]);
}

/// La lunghezza del segmento `link`, sulla spezzata di sedici passi.
function linkLength(sub: Subpath, link: number): number {
  const { from, curve } = curveAt(sub, link);
  let total = 0;
  let last = from;
  for (let i = 1; i <= 16; i++) {
    const p = pointAt(from, curve, i / 16);
    total += distance(last, p);
    last = p;
  }
  return total;
}

/// Il posto della spina `sub`, fra i segmenti da `from` a `to` esclusi, più
/// vicino a `p`.
function nearestPlace(sub: Subpath, from: number, to: number, p: Point): Place {
  const STEPS = 32;
  let best: Place = { link: from, t: 0 };
  let nearest = Infinity;
  for (let link = from; link < to; link++) {
    const { from: start, curve } = curveAt(sub, link);
    const gap = (t: number): number => distance(pointAt(start, curve, t), p);
    let t = 0;
    let d = gap(0);
    for (let k = 1; k <= STEPS; k++) {
      const g = gap(k / STEPS);
      if (g < d) {
        d = g;
        t = k / STEPS;
      }
    }
    // La sezione aurea attorno al campione più vicino.
    let lo = Math.max(0, t - 1 / STEPS);
    let hi = Math.min(1, t + 1 / STEPS);
    for (let round = 0; round < 30; round++) {
      const a = hi - (hi - lo) / 1.618033988749895;
      const b = lo + (hi - lo) / 1.618033988749895;
      if (gap(a) < gap(b)) hi = b;
      else lo = a;
    }
    const refined = (lo + hi) / 2;
    if (gap(refined) < d) {
      d = gap(refined);
      t = refined;
    }
    if (d < nearest) {
      nearest = d;
      best = { link, t };
    }
  }
  return best;
}

/// I nodi della spina in `moved` di una modifica di `nodes.ts`: dal numero
/// di prima a quello di dopo.
export function spineMoves(moved: ReadonlyMap<NodeKey, NodeKey>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [from, to] of moved) {
    const [s, at] = parseKey(from);
    const [t, now] = parseKey(to);
    if (s === 0 && t === 0) out.set(at, now);
  }
  return out;
}

/// Dove va ogni posto di `places` quando la spina `before` diventa `after`.
/// `moved` porta ogni nodo che resta al suo numero nuovo; senza, i nodi sono
/// gli stessi. Un segmento diviso porta i suoi posti sul pezzo dove
/// stavano, segmenti uniti in proporzione alla lunghezza; `null` per un posto
/// oltre un capo eliminato.
export function movedPlaces(before: Subpath, after: Subpath, moved: ReadonlyMap<number, number> | null, places: readonly Place[]): (Place | null)[] {
  if (moved === null || before.links.length === 0) return places.slice();
  const kept = (at: number): boolean => moved.has(at);
  const lengths = before.links.map((_, link) => linkLength(before, link));
  const memo = new Map<number, { readonly p: number; readonly q: number } | null>();
  const ends = (link: number): { readonly p: number; readonly q: number } | null => {
    let found = memo.get(link);
    if (found !== undefined) return found;
    let p = link;
    while (p >= 0 && !kept(p)) p--;
    let q = link + 1;
    while (q < before.nodes.length && !kept(q)) q++;
    found = p < 0 || q >= before.nodes.length ? null : { p, q };
    memo.set(link, found);
    return found;
  };
  return places.map((place): Place | null => {
    const found = ends(place.link);
    if (found === null) return null;
    const { p, q } = found;
    const np = moved.get(p)!;
    const nq = moved.get(q)!;
    if (nq <= np) return null;
    if (q - p > 1) {
      // Segmenti uniti in uno: il posto in proporzione alla lunghezza.
      let total = 0;
      let before = 0;
      for (let link = p; link < q; link++) {
        if (link < place.link) before += lengths[link]!;
        total += lengths[link]!;
      }
      const s = total > 0 ? (before + place.t * lengths[place.link]!) / total : (place.link - p + place.t) / (q - p);
      return { link: np, t: Math.min(1, Math.max(0, s)) };
    }
    if (nq - np === 1) return { link: np, t: place.t };
    // Un segmento diviso: il pezzo dove il punto sta.
    return nearestPlace(after, np, nq, placePoint(before, place));
  });
}

// ---------------------------------------------------------------------------
// L'inchiostro che segue la spina.
// ---------------------------------------------------------------------------

/// Come scrivere l'inchiostro che segue la spina: `dense`, se aggiungere
/// campioni dove la spina si allunga; `gap`, la distanza fra campioni che
/// basta, in unità.
export interface Following {
  readonly dense: boolean;
  readonly gap: number;
}

/// L'inchiostro `ink`, con la spina `spine`, quando la spina diventa `after`
/// con i nodi portati da `moved`: i campioni ai loro posti sulla spina
/// nuova, e la spina nuova coi loro posti, da rileggere senza ricalcolarla.
/// `null` se non resta nessun campione, o se l'inchiostro non si scrive.
export function followedInk(ink: Ink, spine: Spine, after: Subpath, moved: ReadonlyMap<number, number> | null, how: Following): { readonly ink: Ink; readonly spine: Spine } | null {
  const width = ink.channels.length;
  const count = inkLength(ink);
  if (count !== spine.places.length) return null;
  const azimuth = inkChannel(ink, "z");
  const time = inkChannel(ink, "t");
  const places = movedPlaces(spine.sub, after, moved, spine.places);
  /// Un campione da scrivere: la riga dei valori, il posto, lo scarto com'era
  /// e quanto gira, e il punto di prima.
  interface Row {
    readonly values: number[];
    readonly place: Place;
    readonly offset: Point;
    readonly turn: number;
    readonly old: Point;
  }
  const turnAt = (place: Place, was: Place): number => {
    const now = headingAt(after, place);
    const then = headingAt(spine.sub, was);
    return now === null || then === null ? 0 : remEuclid(now - then + Math.PI, 2 * Math.PI) - Math.PI;
  };
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const place = places[i];
    if (place === null || place === undefined) continue;
    rows.push({ values: ink.values.slice(i * width, (i + 1) * width), place, offset: spine.offsets[i]!, turn: turnAt(place, spine.places[i]!), old: inkPoint(ink, i) });
  }
  if (rows.length === 0) return null;
  const pointOf = (row: Row): Point => plus(placePoint(after, row.place), rotate(row.offset, row.turn));
  // Campioni in mezzo, dove due vicini si sono allontanati.
  let out: Row[] = rows;
  if (how.dense && after.links.length > 0) {
    out = [];
    let budget = INK_MAX_SAMPLES - rows.length;
    rows.forEach((row, i) => {
      out.push(row);
      const next = rows[i + 1];
      if (next === undefined || budget <= 0) return;
      const was = distance(row.old, next.old);
      const now = distance(pointOf(row), pointOf(next));
      const step = Math.max(was, how.gap);
      if (!(now > 1.5 * step)) return;
      const extra = Math.min(budget, Math.ceil(now / step) - 1);
      budget -= extra;
      const g0 = row.place.link + row.place.t;
      const g1 = next.place.link + next.place.t;
      for (let k = 1; k <= extra; k++) {
        const f = k / (extra + 1);
        const g = g0 + (g1 - g0) * f;
        const link = Math.min(after.links.length - 1, Math.max(0, Math.floor(g)));
        const place = { link, t: Math.min(1, Math.max(0, g - link)) };
        const values = row.values.map((value, j) => {
          if (j === azimuth) return value + (remEuclid(next.values[j]! - value + 180, 360) - 180) * f;
          return value + (next.values[j]! - value) * f;
        });
        // Lo scarto e il giro di mezzo.
        const turn = row.turn + (remEuclid(next.turn - row.turn + Math.PI, 2 * Math.PI) - Math.PI) * f;
        out.push({ values, place, offset: lerp(row.offset, next.offset, f), turn, old: lerp(row.old, next.old, f) });
      }
    });
  }
  const values: number[] = [];
  const offsets: Point[] = [];
  const firstTime = time === null ? 0 : Math.round(out[0]!.values[time]!);
  for (const row of out) {
    const at = pointOf(row);
    const x = quantizeCoordinate(at[0], ink.scale);
    const y = quantizeCoordinate(at[1], ink.scale);
    offsets.push(minus([x / ink.scale, y / ink.scale], placePoint(after, row.place)));
    row.values.forEach((value, j) => {
      if (j === 0) values.push(x);
      else if (j === 1) values.push(y);
      else if (j === azimuth) values.push(quantizeAzimuth(value + (row.turn * 180) / Math.PI));
      else if (j === time) values.push(Math.round(value) - firstTime);
      else values.push(Math.round(value));
    });
  }
  try {
    return { ink: createInk(ink.scale, ink.channels, values), spine: { sub: after, places: out.map((row) => row.place), offsets } };
  } catch {
    return null;
  }
}
