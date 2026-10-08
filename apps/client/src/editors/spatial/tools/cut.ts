// Le Forbici e il Coltello del livello Esperto, e «Unisci»: un tracciato si
// taglia in un punto, o dove un tratto lo attraversa, e i capi di tracciati
// aperti si uniscono. Senza DOM.
//
// - **Un taglio** apre un sottotracciato chiuso nel punto tagliato, e ne
//   divide uno aperto in due. Il punto diventa due nodi nello stesso posto,
//   i capi nuovi; le curve si dividono esatte, e ciò che si vede non cambia.
//   I capi di un sottotracciato aperto non hanno niente da tagliare.
// - **Il Coltello** divide l'area di una forma chiusa lungo il suo tratto,
//   con la divisione delle booleane: un tratto che entra e non esce non
//   divide niente. Un tracciato aperto si taglia dove il tratto lo
//   attraversa.
// - **Unire** fa di più sottotracciati aperti uno solo, ogni volta fra i due
//   capi più vicini di sottotracciati diversi: due capi nello stesso punto
//   diventano un nodo solo, altrimenti li unisce una linea. Se alla fine i
//   due capi si toccano, il tracciato si chiude; uno solo si chiude sempre.
//   Due capi scelti, anche di due tracciati, si uniscono allo stesso modo.
// - **Le punte seguono i capi** (`endtips.ts`). Un taglio lascia il primo
//   vertice del tracciato al pezzo che lo ha ancora, e l'ultimo a quello che
//   ha ancora lui; un tracciato che si unisce dice quale capo di quale pezzo
//   è diventato il suo inizio e la sua fine, e uno chiuso non ha né l'uno né
//   l'altra.

import { pointAt, splitAt, type Curve } from "../scene/curves";
import type { Segment } from "../scene/geometry";
import type { Matrix, Point } from "../scene/matrix";
import { mapped } from "./boolean";
import { NO_TIPS, type EndTips, type TipSource } from "./endtips";
import { curveAt, joinNodes, moveNodes, nodeKey, parseKey, readNodes, writeNodes, type Edited, type Link, type NodeKey, type Subpath } from "./nodes";
import type { TipEnd } from "./tips";

/// Un punto di un tracciato: il segmento `link` del sottotracciato `sub`, al
/// parametro `t`.
export interface Spot {
  readonly sub: number;
  readonly link: number;
  readonly t: number;
}

/// Ciò che lascia un taglio: i sottotracciati, quello di prima da cui viene
/// ognuno, i capi nuovi, e quanti tagli si sono fatti.
export interface Cut {
  readonly subs: readonly Subpath[];
  readonly origin: readonly number[];
  readonly ends: readonly NodeKey[];
  readonly count: number;
}

/// Quanto un punto può stare da un nodo ed essere il nodo: le coordinate si
/// scrivono al centesimo, e due punti scritti al centesimo sbagliano al più
/// di un centesimo e mezzo fra loro.
const TOLERANCE = 0.015;

const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function linkOf(curve: Curve): Link {
  switch (curve.kind) {
    case "line": return { kind: "line" };
    case "quad": return { kind: "quad", control: curve.control };
    case "cubic": return { kind: "cubic", c1: curve.c1, c2: curve.c2 };
    case "arc": return { kind: "arc", radii: curve.radii, rotation: curve.rotation, large: curve.large, sweep: curve.sweep };
  }
}

/// Il punto `spot` come nodo di `sub`, se ci cade; altrimenti `null`.
function nodeOfSpot(sub: Subpath, link: number, t: number): number | null {
  const { from, curve } = curveAt(sub, link);
  const p = pointAt(from, curve, t);
  if (distance(p, from) <= TOLERANCE) return link;
  if (distance(p, curve.to) <= TOLERANCE) return (link + 1) % sub.nodes.length;
  return null;
}

/// `sub` tagliato ai nodi `at` e nei punti `inner` dei suoi segmenti: i
/// pezzi, e per ognuno se comincia e se finisce in un taglio. `null` se non
/// c'è niente da tagliare.
function cutOne(sub: Subpath, at: ReadonlySet<number>, inner: ReadonlyMap<number, readonly number[]>): Array<{ readonly sub: Subpath; readonly start: boolean; readonly end: boolean }> | null {
  const n = sub.nodes.length;
  // I nodi e i segmenti coi nodi nuovi, e quali nodi si tagliano.
  const nodes: Point[] = [];
  const links: Link[] = [];
  const cuts: boolean[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push(sub.nodes[i]!);
    cuts.push(at.has(i));
    if (i >= sub.links.length) break;
    let { from, curve } = curveAt(sub, i);
    let done = 0;
    for (const t of inner.get(i) ?? []) {
      const [head, tail] = splitAt(from, curve, (t - done) / (1 - done));
      links.push(linkOf(head));
      nodes.push(head.to);
      cuts.push(true);
      from = head.to;
      curve = tail;
      done = t;
    }
    links.push(linkOf(curve));
  }
  let order = nodes;
  let segments = links;
  let marks = cuts;
  if (sub.closed) {
    // Un chiuso comincia dal primo taglio, che si ripete alla fine.
    const first = cuts.indexOf(true);
    if (first < 0) return null;
    order = [...nodes.slice(first), ...nodes.slice(0, first), nodes[first]!];
    segments = [...links.slice(first), ...links.slice(0, first)];
    marks = [...cuts.slice(first), ...cuts.slice(0, first), true];
  }
  const pieces: Array<{ sub: Subpath; start: boolean; end: boolean }> = [];
  let start = 0;
  for (let i = 1; i < order.length - 1; i++) {
    if (!marks[i]) continue;
    pieces.push({ sub: { nodes: order.slice(start, i + 1), links: segments.slice(start, i), closed: false }, start: sub.closed || start > 0, end: true });
    start = i;
  }
  pieces.push({ sub: { nodes: order.slice(start), links: segments.slice(start), closed: false }, start: sub.closed || start > 0, end: sub.closed });
  if (!sub.closed && pieces.length === 1) return null;
  return pieces;
}

/// `subs` tagliati nei punti `spots`: un punto che cade su un nodo taglia il
/// nodo. `null` se nessun punto taglia: tutti sui capi di sottotracciati
/// aperti.
export function cutAt(subs: readonly Subpath[], spots: readonly Spot[]): Cut | null {
  const out: Subpath[] = [];
  const origin: number[] = [];
  const ends: NodeKey[] = [];
  let count = 0;
  subs.forEach((sub, s) => {
    const at = new Set<number>();
    const inner = new Map<number, number[]>();
    for (const spot of spots) {
      if (spot.sub !== s || spot.link < 0 || spot.link >= sub.links.length) continue;
      const node = nodeOfSpot(sub, spot.link, spot.t);
      if (node !== null) {
        if (sub.closed || (node > 0 && node < sub.nodes.length - 1)) at.add(node);
        continue;
      }
      const list = inner.get(spot.link) ?? [];
      list.push(spot.t);
      inner.set(spot.link, list);
    }
    // Due punti dello stesso segmento troppo vicini sono un taglio solo.
    for (const [link, list] of inner) {
      const { from, curve } = curveAt(sub, link);
      const sorted = [...list].sort((a, b) => a - b);
      const kept: number[] = [];
      for (const t of sorted) {
        const last = kept[kept.length - 1];
        if (last === undefined || distance(pointAt(from, curve, last), pointAt(from, curve, t)) > TOLERANCE) kept.push(t);
      }
      inner.set(link, kept);
    }
    const pieces = at.size + inner.size === 0 ? null : cutOne(sub, at, inner);
    if (pieces === null) {
      origin.push(s);
      out.push(sub);
      return;
    }
    count += at.size + [...inner.values()].reduce((sum, list) => sum + list.length, 0);
    for (const piece of pieces) {
      const index = out.length;
      if (piece.start) ends.push(nodeKey(index, 0));
      if (piece.end) ends.push(nodeKey(index, piece.sub.nodes.length - 1));
      origin.push(s);
      out.push(piece.sub);
    }
  });
  return count === 0 ? null : { subs: out, origin, ends, count };
}

/// Il nodo `at` del sottotracciato `s` come punto da tagliare.
export function nodeSpot(subs: readonly Subpath[], s: number, at: number): Spot {
  const sub = subs[s]!;
  return at < sub.links.length ? { sub: s, link: at, t: 0 } : { sub: s, link: at - 1, t: 1 };
}

// ---------------------------------------------------------------------------
// Dove un tratto attraversa un tracciato.
// ---------------------------------------------------------------------------

/// Una curva come spezzata: i punti e i loro parametri. Una linea è un passo
/// solo; una curva tanti quanti ne servono perché la spezzata le stia a meno
/// di un centesimo, fino a 256.
function flattened(from: Point, curve: Curve): { readonly points: Point[]; readonly ts: number[] } {
  if (curve.kind === "line") return { points: [from, curve.to], ts: [0, 1] };
  // La lunghezza della curva, da sedici passi, dice quanti ne servono.
  let rough = 0;
  let last = from;
  for (let k = 1; k <= 16; k++) {
    const p = pointAt(from, curve, k / 16);
    rough += distance(last, p);
    last = p;
  }
  const steps = Math.min(256, Math.max(16, Math.ceil(Math.sqrt(rough) * 4)));
  const points: Point[] = [];
  const ts: number[] = [];
  for (let k = 0; k <= steps; k++) {
    points.push(k === 0 ? from : k === steps ? curve.to : pointAt(from, curve, k / steps));
    ts.push(k / steps);
  }
  return { points, ts };
}

interface Flat {
  readonly sub: number;
  readonly link: number;
  readonly points: readonly Point[];
  readonly ts: readonly number[];
  readonly min: Point;
  readonly max: Point;
}

function flats(subs: readonly Subpath[]): Flat[] {
  const out: Flat[] = [];
  subs.forEach((sub, s) => {
    sub.links.forEach((_, link) => {
      const { from, curve } = curveAt(sub, link);
      const { points, ts } = flattened(from, curve);
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      out.push({ sub: s, link, points, ts, min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] });
    });
  });
  return out;
}

/// I punti in cui il tratto `knife` attraversa `subs`, nelle stesse
/// coordinate, in ordine di sottotracciato, segmento e parametro. Dove il
/// tratto tocca senza attraversare, o corre lungo il tracciato, non c'è un
/// punto.
export function crossings(subs: readonly Subpath[], knife: readonly Subpath[]): Spot[] {
  const blades = flats(knife);
  const out: Spot[] = [];
  for (const flat of flats(subs)) {
    for (const blade of blades) {
      if (blade.min[0] > flat.max[0] || blade.max[0] < flat.min[0] || blade.min[1] > flat.max[1] || blade.max[1] < flat.min[1]) continue;
      for (let i = 0; i + 1 < flat.points.length; i++) {
        const a = flat.points[i]!;
        const b = flat.points[i + 1]!;
        for (let j = 0; j + 1 < blade.points.length; j++) {
          const c = blade.points[j]!;
          const d = blade.points[j + 1]!;
          const rx = b[0] - a[0];
          const ry = b[1] - a[1];
          const sx = d[0] - c[0];
          const sy = d[1] - c[1];
          const denominator = rx * sy - ry * sx;
          if (denominator === 0) continue;
          const qx = c[0] - a[0];
          const qy = c[1] - a[1];
          const u = (qx * sy - qy * sx) / denominator;
          const v = (qx * ry - qy * rx) / denominator;
          // Mezzi aperti: un incrocio sul punto fra due passi conta una
          // volta sola.
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const t = flat.ts[i]! + (flat.ts[i + 1]! - flat.ts[i]!) * u;
          out.push({ sub: flat.sub, link: flat.link, t });
        }
      }
    }
  }
  return out.sort((p, q) => p.sub - q.sub || p.link - q.link || p.t - q.t);
}

// ---------------------------------------------------------------------------
// Unire.
// ---------------------------------------------------------------------------

/// `subs` portati da `m` in altre coordinate: gli archi coi raggi e la
/// rotazione dell'ellisse trasformata.
export function mapSubs(subs: readonly Subpath[], m: Matrix): Subpath[] {
  const segments: readonly Segment[] = mapped(writeNodes(subs), m);
  return readNodes(segments);
}

/// I capi di `sub`, se è aperto.
const endsOf = (sub: Subpath): readonly Point[] => (sub.closed ? [] : [sub.nodes[0]!, sub.nodes[sub.nodes.length - 1]!]);

/// `subs` coi due capi `a` e `b` portati a metà strada, se non sono già
/// nello stesso punto: le maniglie che vi partono li seguono.
function meet(subs: readonly Subpath[], a: NodeKey, b: NodeKey, pa: Point, pb: Point): Subpath[] {
  if (pa[0] === pb[0] && pa[1] === pb[1]) return subs.slice();
  const mid: Point = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  const corner = (): "corner" => "corner";
  const once = moveNodes(subs, new Set([a]), [mid[0] - pa[0], mid[1] - pa[1]], corner);
  return moveNodes(once, new Set([b]), [mid[0] - pb[0], mid[1] - pb[1]], corner);
}

/// Unisce i capi `a` e `b` di `subs`, come `joinNodes`: due capi più vicini
/// di `merge` diventano un nodo solo, a metà strada, tranne i due di una
/// linea sola; altrimenti li unisce una linea. `null` se non sono due capi
/// di sottotracciati aperti.
export function joinEnds(subs: readonly Subpath[], a: NodeKey, b: NodeKey, merge: number): Edited | null {
  const [sa, ea] = parseKey(a);
  const [sb, eb] = parseKey(b);
  const pa = subs[sa]?.nodes[ea];
  const pb = subs[sb]?.nodes[eb];
  if (pa === undefined || pb === undefined || a === b) return null;
  const line = sa === sb && subs[sa]!.nodes.length <= 2;
  return joinNodes(!line && distance(pa, pb) <= merge ? meet(subs, a, b, pa, pb) : subs, new Set([a, b]));
}

/// Dove stanno le punte di un elemento con i sottotracciati `subs`: i nodi
/// del suo primo vertice e dell'ultimo, come SVG disegna `marker-start` e
/// `marker-end`; `null` se non ha nodi. L'ultimo vertice di un sottotracciato
/// chiuso è il suo primo.
export function tipKeys(subs: readonly Subpath[]): Readonly<Record<TipEnd, NodeKey>> | null {
  const tail = subs[subs.length - 1];
  return tail === undefined ? null : { start: nodeKey(0, 0), end: nodeKey(subs.length - 1, tail.closed ? 0 : tail.nodes.length - 1) };
}

/// Una punta nei nodi di una modifica: di quale parte è, a quale capo, e il
/// nodo che quel capo è.
export interface TipSpot extends TipSource {
  readonly key: NodeKey;
}

/// Da quale punta prende la sua ciascun capo di `subs`, dopo una modifica
/// che ha portato i nodi di `spots` dove dice `moved` (senza, sono gli
/// stessi): la punta del nodo che è diventato quel capo. Un capo che nessuno
/// di loro è diventato non ha punta, tranne se la punta del suo stesso capo
/// ha perso il nodo, tolto dalla modifica: allora il vertice che prende il
/// suo posto la tiene, come lo disegna SVG.
export function followEnds(
  spots: readonly TipSpot[],
  subs: readonly Subpath[],
  moved: ReadonlyMap<NodeKey, NodeKey> | null,
): { readonly start: TipSource | null; readonly end: TipSource | null } {
  const keys = tipKeys(subs);
  const pick = (end: TipEnd): TipSource | null => {
    if (keys === null) return null;
    const became = spots.find((spot) => (moved === null ? spot.key : moved.get(spot.key)) === keys[end]);
    if (became !== undefined) return { owner: became.owner, end: became.end };
    const lost = spots.find((spot) => spot.end === end && moved !== null && !moved.has(spot.key));
    return lost === undefined ? null : { owner: lost.owner, end: lost.end };
  };
  return { start: pick("start"), end: pick("end") };
}

/// Le punte di un elemento dopo la modifica che porta i nodi di `before` in
/// `after`, dove `moved` dice dove è finito ogni nodo che resta (senza, i
/// nodi sono gli stessi): `undefined` se non cambiano. Se l'elemento aveva
/// un sottotracciato aperto e non ne ha più, le punte se ne vanno: non ha
/// più capi. La punta di un sottotracciato chiuso che si apre se ne va
/// anche lei, da qualunque nodo si apra: una forma chiusa non ha capi, e
/// quelli nuovi non sono suoi, come per le Forbici.
export function tipsAfter(before: readonly Subpath[], after: readonly Subpath[], moved: ReadonlyMap<NodeKey, NodeKey> | null): EndTips | undefined {
  if (after.length > 0 && after.every((sub) => sub.closed)) return before.some((sub) => !sub.closed) ? NO_TIPS : undefined;
  const was = tipKeys(before);
  if (moved === null || was === null) return undefined;
  const found = followEnds([{ owner: 0, end: "start", key: was.start }, { owner: 0, end: "end", key: was.end }], after, moved);
  const opened = (sub: Subpath | undefined, now: Subpath | undefined): boolean => sub?.closed === true && now?.closed === false;
  const tips: EndTips = {
    start: opened(before[0], after[0]) ? null : (found.start?.end ?? null),
    end: opened(before[before.length - 1], after[after.length - 1]) ? null : (found.end?.end ?? null),
  };
  return tips.start === "start" && tips.end === "end" ? undefined : tips;
}

/// Ciò che lascia l'unione dei capi di due tracciati: il primo col
/// sottotracciato del secondo, e il secondo senza; e le punte di ciascuno
/// dopo: quelle del primo prendono i capi del primo o del secondo (`owner`
/// 0 e 1), quelle del secondo restano ai capi che non sono passati nel
/// primo.
export interface JoinedAcross {
  readonly kept: Edited;
  readonly rest: Edited;
  readonly tips: {
    readonly kept: { readonly start: TipSource | null; readonly end: TipSource | null };
    readonly rest: EndTips;
  };
}

/// Unisce il capo `a` del tracciato `first` col capo `b` del tracciato
/// `second`, che `m` porta nelle coordinate del primo, come [`joinEnds`]: il
/// sottotracciato di `b` passa nel primo. `null` se non sono due capi di
/// sottotracciati aperti.
export function joinAcross(first: readonly Subpath[], a: NodeKey, second: readonly Subpath[], b: NodeKey, m: Matrix, merge: number): JoinedAcross | null {
  const [sb, eb] = parseKey(b);
  const sub = second[sb];
  if (sub === undefined) return null;
  const moved = mapSubs([sub], m);
  if (moved.length !== 1 || moved[0]!.nodes.length !== sub.nodes.length) return null;
  const kept = joinEnds([...first, moved[0]!], a, nodeKey(first.length, eb), merge);
  if (kept === null) return null;
  const shifted = new Map<NodeKey, NodeKey>();
  second.forEach((each, s) => {
    if (s !== sb) each.nodes.forEach((_, at) => shifted.set(nodeKey(s, at), nodeKey(s < sb ? s : s - 1, at)));
  });
  // Le punte: i capi del primo, e quelli del secondo che stanno nel
  // sottotracciato passato nel primo, vanno dove li portano i nodi.
  const spots: TipSpot[] = [];
  const firstKeys = tipKeys(first);
  if (firstKeys !== null) for (const end of ["start", "end"] as const) spots.push({ owner: 0, end, key: firstKeys[end] });
  const secondKeys = tipKeys(second);
  if (secondKeys !== null) {
    for (const end of ["start", "end"] as const) {
      const [s, at] = parseKey(secondKeys[end]);
      if (s === sb) spots.push({ owner: 1, end, key: nodeKey(first.length, at) });
    }
  }
  const tips = { kept: followEnds(spots, kept.subs, kept.moved), rest: { start: sb === 0 ? null : "start", end: sb === second.length - 1 ? null : "end" } as const };
  return { kept, rest: { subs: second.filter((_, s) => s !== sb), selected: [], changed: 1, moved: shifted }, tips };
}

/// Un capo di uno dei pezzi che «Unisci» unisce: il pezzo, nell'ordine in cui
/// è dato, e il capo, `start` il suo primo nodo e `end` l'ultimo.
export interface PieceEnd {
  readonly piece: number;
  readonly end: TipEnd;
}

/// Ciò che lascia «Unisci»: il tracciato, se si è chiuso, quante linee nuove
/// uniscono capi lontani, e quali capi dei pezzi sono diventati il suo
/// inizio e la sua fine (`null` se si è chiuso, e non ha né l'uno né
/// l'altra).
export interface Joined {
  readonly sub: Subpath;
  readonly closed: boolean;
  readonly lines: number;
  readonly start: PieceEnd | null;
  readonly end: PieceEnd | null;
}

/// I sottotracciati aperti `pieces` in uno solo: ogni volta i due capi più
/// vicini di due diversi, fino a uno. Due capi più vicini di `merge`
/// diventano un nodo solo, a metà strada; altrimenti li unisce una linea.
/// Alla fine il tracciato si chiude se i suoi capi stanno entro `merge`, e
/// uno solo si chiude sempre. `null` se un pezzo è chiuso o non ha segmenti,
/// o se è uno solo ed è una linea.
export function joinPaths(pieces: readonly Subpath[], merge: number): Joined | null {
  if (pieces.length === 0 || pieces.some((piece) => piece.closed || piece.links.length === 0)) return null;
  // Una linea sola chiusa andrebbe e tornerebbe sulla stessa retta.
  if (pieces.length === 1 && pieces[0]!.links.length === 1 && pieces[0]!.links[0]!.kind === "line") return null;
  let subs: Subpath[] = pieces.slice();
  // Di ogni sottotracciato, i capi dei pezzi che ne sono l'inizio e la fine.
  let ends: Array<readonly [PieceEnd, PieceEnd]> = pieces.map((_, piece) => [{ piece, end: "start" }, { piece, end: "end" }] as const);
  let lines = 0;
  const join = (sa: number, ea: number, sb: number, eb: number): void => {
    // L'inizio di uno con la fine dell'altro: quello finisce, questo
    // comincia, e nessuno si percorre al contrario.
    if (sa !== sb && ea === 0 && eb > 0) {
      [subs[sa], subs[sb]] = [subs[sb]!, subs[sa]!];
      [ends[sa], ends[sb]] = [ends[sb]!, ends[sa]!];
      [ea, eb] = [eb, 0];
    }
    const a = nodeKey(sa, ea);
    const b = nodeKey(sb, eb);
    const pa = subs[sa]!.nodes[ea]!;
    const pb = subs[sb]!.nodes[eb]!;
    const close = distance(pa, pb) <= merge;
    if (close) subs = meet(subs, a, b, pa, pb);
    else lines++;
    const joined = joinNodes(subs, new Set([a, b]));
    if (joined === null) return;
    if (sa !== sb) {
      // Dei quattro capi, i due che restano sono il primo nodo e l'ultimo
      // del sottotracciato unito.
      const there: Array<readonly [NodeKey, PieceEnd]> = [
        [nodeKey(sa, 0), ends[sa]![0]],
        [nodeKey(sa, subs[sa]!.nodes.length - 1), ends[sa]![1]],
        [nodeKey(sb, 0), ends[sb]![0]],
        [nodeKey(sb, subs[sb]!.nodes.length - 1), ends[sb]![1]],
      ];
      const became = (key: NodeKey): PieceEnd => there.find(([from]) => joined.moved.get(from) === key)![1];
      const made = [became(nodeKey(sa, 0)), became(nodeKey(sa, joined.subs[sa]!.nodes.length - 1))] as const;
      ends = ends.flatMap((each, s) => (s === sb ? [] : [s === sa ? made : each]));
    }
    subs = [...joined.subs];
  };
  while (subs.length > 1) {
    let best: [number, number, number, number] | null = null;
    let nearest = Infinity;
    let turns = Infinity;
    for (let sa = 0; sa < subs.length; sa++) {
      for (let sb = sa + 1; sb < subs.length; sb++) {
        endsOf(subs[sa]!).forEach((pa, i) => {
          endsOf(subs[sb]!).forEach((pb, j) => {
            const d = distance(pa, pb);
            // A pari distanza, l'unione che percorre meno pezzi al
            // contrario, e fra quelle che non ne percorrono nessuno la fine
            // del primo con l'inizio del secondo, che resta il primo.
            const reversed = i === j ? 2 : i === 0 ? 1 : 0;
            if (d < nearest - 1e-9 || (d <= nearest + 1e-9 && reversed < turns)) {
              nearest = d;
              turns = reversed;
              best = [sa, i === 0 ? 0 : subs[sa]!.nodes.length - 1, sb, j === 0 ? 0 : subs[sb]!.nodes.length - 1];
            }
          });
        });
      }
    }
    if (best === null) return null;
    const before = subs.length;
    join(...(best as [number, number, number, number]));
    if (subs.length === before) return null;
  }
  const sub = subs[0]!;
  const last = sub.nodes.length - 1;
  const open: Joined = { sub, closed: false, lines, start: ends[0]![0], end: ends[0]![1] };
  if (pieces.length > 1 && distance(sub.nodes[0]!, sub.nodes[last]!) > merge) return open;
  if (last < 1) return open;
  join(0, 0, 0, last);
  return { sub: subs[0]!, closed: true, lines, start: null, end: null };
}
