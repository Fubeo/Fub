// I nodi di un tracciato, per lo strumento «Nodi» del livello Esperto: un
// `d` letto come sottotracciati di nodi e segmenti, le modifiche dello
// strumento, e il `d` riscritto. Senza DOM.
//
// - **Un nodo** è un punto per cui il tracciato passa: l'inizio di un
//   sottotracciato e la fine di ogni segmento. In un sottotracciato chiuso
//   l'ultimo segmento torna al primo nodo, e un nodo che torna dove
//   comincia è il primo.
// - **Un segmento resta del suo tipo**: linea, quadratica, cubica, arco.
//   Spostare un nodo sposta con lui le maniglie delle cubiche che vi
//   arrivano e ne partono; un arco tiene raggi e rotazione, e una quadratica
//   il suo punto di controllo, che è dei suoi due nodi.
// - **Il tipo di un nodo non si scrive nel file**, perché SVG non ha dove:
//   si legge dalle direzioni. Liscio se i due segmenti vi passano allineati
//   al centesimo, simmetrico se anche le due maniglie sono lunghe uguali,
//   spigolo altrimenti. Un nodo liscio resta liscio quando si sposta, sé o
//   un vicino, e quando si trascina una sua maniglia.
// - **Ciò che si vede resta, dove si può.** «In curva» fa di una linea una
//   cubica dritta e di un arco le cubiche che lo approssimano; eliminare un
//   nodo unisce i suoi segmenti in una curva che passa vicino a dov'erano.

import { arcCenter, arcToCubics, derivativeAt, lineToCubic, pointAt, quadToCubic, reversed, splitAt, tangentAt, type Curve } from "../scene/curves";
import { remEuclid, type Segment } from "../scene/geometry";
import { apply, toRadians, type Matrix, type Point } from "../scene/matrix";
import { formatNumber } from "../number";

/// Un segmento senza il suo punto d'arrivo, che è il nodo dopo.
export type Link =
  | { readonly kind: "line" }
  | { readonly kind: "quad"; readonly control: Point }
  | { readonly kind: "cubic"; readonly c1: Point; readonly c2: Point }
  | { readonly kind: "arc"; readonly radii: Point; readonly rotation: number; readonly large: boolean; readonly sweep: boolean };

/// Un sottotracciato: i nodi, e i segmenti da un nodo al successivo. Aperto
/// ha un segmento meno dei nodi; chiuso ne ha tanti quanti, e l'ultimo
/// torna al primo nodo.
export interface Subpath {
  readonly nodes: readonly Point[];
  readonly links: readonly Link[];
  readonly closed: boolean;
}

export type NodeKind = "corner" | "smooth" | "symmetric";

/// Un nodo come chiave: il sottotracciato e la posizione, `"2:5"`.
export type NodeKey = string;

export const nodeKey = (sub: number, at: number): NodeKey => `${sub}:${at}`;

export function parseKey(key: NodeKey): [number, number] {
  const [sub, at] = key.split(":").map(Number);
  return [sub!, at!];
}

/// Una maniglia: il punto di controllo `which` del segmento `link`. `c1`
/// appartiene al nodo da cui il segmento parte, `c2` a quello dove arriva,
/// e il punto di una quadratica a tutti e due.
export interface HandleRef {
  readonly sub: number;
  readonly link: number;
  readonly which: "c1" | "c2" | "control";
}

/// Il tipo di ogni nodo, come lo vuole chi modifica: quello che sceglie, o
/// quello che si legge.
export type KindOf = (sub: number, at: number) => NodeKind;

/// Ciò che una modifica lascia: i sottotracciati, i nodi scelti dopo, quanti
/// nodi o segmenti ha cambiato, e dove è finito ogni nodo che resta.
export interface Edited {
  readonly subs: readonly Subpath[];
  readonly selected: readonly NodeKey[];
  readonly changed: number;
  readonly moved: ReadonlyMap<NodeKey, NodeKey>;
}

/// Quanto un nodo può scostarsi da ciò che si legge e restare quello: le
/// coordinate si scrivono al centesimo, e due punti scritti al centesimo
/// sbagliano al più di un centesimo e mezzo fra loro.
const TOLERANCE = 0.015;

const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const length = (a: Point): number => Math.hypot(a[0], a[1]);
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function unit(a: Point): Point | null {
  const l = length(a);
  return l > 0 && Number.isFinite(l) ? [a[0] / l, a[1] / l] : null;
}

/// Vero se `a` e `b` si scrivono nello stesso punto.
export const samePlace = (a: Point, b: Point): boolean =>
  formatNumber(a[0], 2) === formatNumber(b[0], 2) && formatNumber(a[1], 2) === formatNumber(b[1], 2);

function curveOf(link: Link, to: Point): Curve {
  switch (link.kind) {
    case "line": return { kind: "line", to };
    case "quad": return { kind: "quad", control: link.control, to };
    case "cubic": return { kind: "cubic", c1: link.c1, c2: link.c2, to };
    case "arc": return { kind: "arc", radii: link.radii, rotation: link.rotation, large: link.large, sweep: link.sweep, to };
  }
}

function linkOf(curve: Curve): Link {
  switch (curve.kind) {
    case "line": return { kind: "line" };
    case "quad": return { kind: "quad", control: curve.control };
    case "cubic": return { kind: "cubic", c1: curve.c1, c2: curve.c2 };
    case "arc": return { kind: "arc", radii: curve.radii, rotation: curve.rotation, large: curve.large, sweep: curve.sweep };
  }
}

// ---------------------------------------------------------------------------
// Lettura e scrittura.
// ---------------------------------------------------------------------------

/// I sottotracciati di un `d` già letto da `parsePath`.
export function readNodes(segments: readonly Segment[]): Subpath[] {
  const out: Subpath[] = [];
  let nodes: Point[] = [];
  let links: Link[] = [];
  let start: Point = [0, 0];
  const finish = (closed: boolean): void => {
    if (nodes.length === 0) return;
    if (closed) {
      // Un ultimo segmento che torna dove il sottotracciato comincia è
      // quello che lo chiude; altrimenti lo chiude una linea.
      if (nodes.length > 1 && samePlace(nodes[nodes.length - 1]!, nodes[0]!)) nodes.pop();
      else links.push({ kind: "line" });
    }
    out.push({ nodes, links, closed });
    nodes = [];
    links = [];
  };
  for (const segment of segments) {
    switch (segment.kind) {
      case "move":
        finish(false);
        nodes = [segment.to];
        start = segment.to;
        break;
      case "close":
        // Dopo una chiusura il punto corrente torna all'inizio, e un
        // segmento senza `M` comincia un sottotracciato da lì.
        if (nodes.length === 0) nodes = [start];
        finish(true);
        break;
      default:
        if (nodes.length === 0) nodes = [start];
        links.push(linkOf(segment));
        nodes.push(segment.to);
    }
  }
  finish(false);
  return out;
}

/// I segmenti di `subs`, come li scrive `pathData`. Un sottotracciato chiuso
/// da una linea si chiude con `Z` e basta.
export function writeNodes(subs: readonly Subpath[]): Segment[] {
  const out: Segment[] = [];
  for (const sub of subs) {
    const n = sub.nodes.length;
    if (n === 0) continue;
    out.push({ kind: "move", to: sub.nodes[0]! });
    sub.links.forEach((link, i) => {
      if (sub.closed && i === sub.links.length - 1 && link.kind === "line") return;
      out.push(curveOf(link, sub.nodes[(i + 1) % n]!));
    });
    if (sub.closed) out.push({ kind: "close" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nodi, segmenti e maniglie.
// ---------------------------------------------------------------------------

/// Il segmento che arriva al nodo `at`, o `null`.
export function incoming(sub: Subpath, at: number): number | null {
  if (sub.closed) return sub.links.length === 0 ? null : (at - 1 + sub.nodes.length) % sub.nodes.length;
  return at > 0 ? at - 1 : null;
}

/// Il segmento che parte dal nodo `at`, o `null`.
export function outgoing(sub: Subpath, at: number): number | null {
  return at < sub.links.length ? at : null;
}

/// Il nodo da cui parte il segmento `link`, e quello dove arriva.
export const startOf = (_sub: Subpath, link: number): number => link;
export const endOf = (sub: Subpath, link: number): number => (link + 1) % sub.nodes.length;

/// Il segmento `link` come curva, col punto da cui parte.
export function curveAt(sub: Subpath, link: number): { readonly from: Point; readonly curve: Curve } {
  return { from: sub.nodes[link]!, curve: curveOf(sub.links[link]!, sub.nodes[endOf(sub, link)]!) };
}

/// Il nodo a cui una maniglia è attaccata; per una quadratica, quello da cui
/// il segmento parte.
export function handleNode(sub: Subpath, handle: HandleRef): number {
  return handle.which === "c2" ? endOf(sub, handle.link) : startOf(sub, handle.link);
}

/// Dove sta la maniglia `handle`, o `null` se il segmento non la ha.
export function handlePoint(subs: readonly Subpath[], handle: HandleRef): Point | null {
  const link = subs[handle.sub]?.links[handle.link];
  if (link === undefined) return null;
  if (link.kind === "cubic" && handle.which !== "control") return link[handle.which];
  if (link.kind === "quad" && handle.which === "control") return link.control;
  return null;
}

/// Le maniglie che si vedono con i nodi `selected`: quelle dei segmenti che
/// toccano un nodo scelto.
export function handlesFor(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): HandleRef[] {
  const out: HandleRef[] = [];
  subs.forEach((sub, s) => {
    sub.links.forEach((link, i) => {
      if (!selected.has(nodeKey(s, startOf(sub, i))) && !selected.has(nodeKey(s, endOf(sub, i)))) return;
      if (link.kind === "cubic") out.push({ sub: s, link: i, which: "c1" }, { sub: s, link: i, which: "c2" });
      else if (link.kind === "quad") out.push({ sub: s, link: i, which: "control" });
    });
  });
  return out;
}

/// Quanto arriva al nodo `at` il lato `side`: la lunghezza della maniglia,
/// o della corda per una linea o un arco.
function reach(sub: Subpath, at: number, side: "in" | "out"): { readonly length: number; readonly handle: boolean } {
  const index = side === "in" ? incoming(sub, at) : outgoing(sub, at);
  const link = sub.links[index!]!;
  const node = sub.nodes[at]!;
  if (link.kind === "cubic") return { length: distance(node, side === "in" ? link.c2 : link.c1), handle: true };
  if (link.kind === "quad") return { length: distance(node, link.control), handle: true };
  const other = sub.nodes[side === "in" ? startOf(sub, index!) : endOf(sub, index!)]!;
  return { length: distance(node, other), handle: false };
}

/// Il verso, lungo 1, in cui il tracciato passa per il nodo `at` dal lato
/// `side`: come arriva, o come riparte.
function travel(sub: Subpath, at: number, side: "in" | "out"): Point | null {
  const index = side === "in" ? incoming(sub, at) : outgoing(sub, at);
  if (index === null) return null;
  const { from, curve } = curveAt(sub, index);
  return tangentAt(from, curve, side === "in");
}

/// Il tipo del nodo `at`, come si legge dalle direzioni.
export function kindOf(sub: Subpath, at: number): NodeKind {
  const before = incoming(sub, at);
  const after = outgoing(sub, at);
  if (before === null || after === null || before === after) return "corner";
  const u = travel(sub, at, "in");
  const v = travel(sub, at, "out");
  if (u === null || v === null) return "corner";
  const a = reach(sub, at, "in");
  const b = reach(sub, at, "out");
  // Una maniglia ritirata sul nodo fa uno spigolo, anche se le direzioni
  // che restano si allineano.
  if ((a.handle && a.length <= TOLERANCE) || (b.handle && b.length <= TOLERANCE)) return "corner";
  if (dot(u, v) <= 0 || Math.abs(cross(u, v)) * Math.min(a.length, b.length) > TOLERANCE) return "corner";
  const cubic = sub.links[before]!.kind === "cubic" && sub.links[after]!.kind === "cubic";
  return cubic && Math.abs(a.length - b.length) <= TOLERANCE ? "symmetric" : "smooth";
}

/// Il tipo di ogni nodo di `subs`, letto.
export const inferred = (subs: readonly Subpath[]): KindOf => (sub, at) => kindOf(subs[sub]!, at);

/// Un sottotracciato con il segmento `index` cambiato.
function withLink(sub: Subpath, index: number, link: Link): Subpath {
  const links = sub.links.slice();
  links[index] = link;
  return { ...sub, links };
}

/// `sub` con la maniglia del nodo `at` dal lato `side` girata nel verso
/// `direction` (quello in cui il tracciato passa), lunga `size`. Solo una
/// cubica ha una maniglia da girare.
function turned(sub: Subpath, at: number, side: "in" | "out", direction: Point, size: number): Subpath {
  const index = side === "in" ? incoming(sub, at) : outgoing(sub, at);
  if (index === null) return sub;
  const link = sub.links[index]!;
  if (link.kind !== "cubic") return sub;
  const node = sub.nodes[at]!;
  return side === "in"
    ? withLink(sub, index, { ...link, c2: minus(node, times(direction, size)) })
    : withLink(sub, index, { ...link, c1: plus(node, times(direction, size)) });
}

/// `sub` con la cubica del lato `side` del nodo `at` allineata all'altro
/// lato, che non ha maniglie da girare: la maniglia tiene la sua lunghezza.
function aligned(sub: Subpath, at: number, side: "in" | "out"): Subpath {
  const other = side === "in" ? "out" : "in";
  const direction = travel(sub, at, other);
  if (direction === null) return sub;
  return turned(sub, at, side, direction, reach(sub, at, side).length);
}

/// Il lato di un nodo che ha una cubica, se l'altro non ce l'ha.
function loneCubic(sub: Subpath, at: number): "in" | "out" | null {
  const before = incoming(sub, at);
  const after = outgoing(sub, at);
  if (before === null || after === null || before === after) return null;
  const a = sub.links[before]!.kind === "cubic";
  const b = sub.links[after]!.kind === "cubic";
  return a === b ? null : a ? "in" : "out";
}

// ---------------------------------------------------------------------------
// Spostare nodi e maniglie.
// ---------------------------------------------------------------------------

/// `subs` coi nodi `selected` spostati di `delta`, e con loro le maniglie
/// delle cubiche che li toccano. Un nodo liscio accanto a un segmento che
/// lo spostamento gira, una linea o un arco, gira con lui la sua maniglia.
export function moveNodes(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>, delta: Point, kinds: KindOf): Subpath[] {
  const shift = (p: Point): Point => plus(p, delta);
  return subs.map((sub, s) => {
    const on = (at: number): boolean => selected.has(nodeKey(s, at));
    if (!sub.nodes.some((_, at) => on(at))) return sub;
    const n = sub.nodes.length;
    const links = sub.links.map((link, i): Link => {
      const a = on(i);
      const b = on((i + 1) % n);
      if (link.kind === "cubic" && (a || b)) return { kind: "cubic", c1: a ? shift(link.c1) : link.c1, c2: b ? shift(link.c2) : link.c2 };
      if (link.kind === "quad" && a && b) return { kind: "quad", control: shift(link.control) };
      return link;
    });
    let out: Subpath = { nodes: sub.nodes.map((p, at) => (on(at) ? shift(p) : p)), links, closed: sub.closed };
    for (let at = 0; at < n; at++) {
      if (kinds(s, at) === "corner") continue;
      const side = loneCubic(sub, at);
      if (side === null) continue;
      // Il segmento senza maniglie gira se si sposta uno solo dei suoi nodi.
      const fixed = side === "in" ? outgoing(sub, at)! : incoming(sub, at)!;
      const far = side === "in" ? endOf(sub, fixed) : startOf(sub, fixed);
      if (on(at) !== on(far)) out = aligned(out, at, side);
    }
    return out;
  });
}

/// `subs` con la maniglia `handle` portata in `to`. Al nodo liscio la
/// maniglia dell'altro lato gira con lei, e a quello simmetrico prende
/// anche la sua lunghezza; se l'altro lato è una linea o un arco, è la
/// maniglia trascinata a restare sulla sua retta.
export function moveHandle(subs: readonly Subpath[], handle: HandleRef, to: Point, kinds: KindOf): Subpath[] {
  const sub = subs[handle.sub]!;
  const link = sub.links[handle.link]!;
  const out = subs.slice();
  if (link.kind === "quad" && handle.which === "control") {
    let next = withLink(sub, handle.link, { kind: "quad", control: to });
    // Ai due nodi della quadratica, una cubica dall'altra parte la segue.
    for (const [at, side] of [[startOf(sub, handle.link), "in"], [endOf(sub, handle.link), "out"]] as const) {
      if (kinds(handle.sub, at) !== "corner" && loneCubic(next, at) === side) next = aligned(next, at, side);
    }
    out[handle.sub] = next;
    return out;
  }
  if (link.kind !== "cubic" || handle.which === "control") return out;
  const at = handleNode(sub, handle);
  const side = handle.which === "c2" ? "in" : "out";
  const node = sub.nodes[at]!;
  const kind = kinds(handle.sub, at);
  const otherSide = side === "in" ? "out" : "in";
  const otherIndex = otherSide === "in" ? incoming(sub, at) : outgoing(sub, at);
  const smooth = kind !== "corner" && otherIndex !== null && otherIndex !== handle.link;
  let placed = to;
  if (smooth && sub.links[otherIndex]!.kind !== "cubic") {
    // L'altro lato non gira: la maniglia resta sulla sua retta, dalla parte
    // giusta.
    const direction = travel(sub, at, otherSide);
    if (direction !== null) {
      const along = side === "out" ? dot(minus(to, node), direction) : dot(minus(node, to), direction);
      placed = side === "out" ? plus(node, times(direction, Math.max(0, along))) : minus(node, times(direction, Math.max(0, along)));
    }
  }
  let next = withLink(sub, handle.link, handle.which === "c1" ? { ...link, c1: placed } : { ...link, c2: placed });
  if (smooth && sub.links[otherIndex]!.kind === "cubic") {
    const direction = unit(side === "out" ? minus(placed, node) : minus(node, placed));
    if (direction !== null) {
      const size = kind === "symmetric" ? distance(placed, node) : reach(sub, at, otherSide).length;
      next = turned(next, at, otherSide, direction, size);
    }
  }
  out[handle.sub] = next;
  return out;
}

/// Quanto la piegatura di una cubica al parametro `t` muove la maniglia
/// d'arrivo invece di quella di partenza, da 0 a 1: vicino a un nodo si
/// muove solo la maniglia di quel nodo (le equazioni di Inkscape).
function bendWeight(t: number): number {
  if (t <= 1 / 6) return 0;
  if (t <= 0.5) return ((6 * t - 1) / 2) ** 3 / 2;
  if (t <= 5 / 6) return (1 - ((6 * (1 - t) - 1) / 2) ** 3) / 2 + 0.5;
  return 1;
}

/// Il cerchio per `a`, `b` e `c`; `null` se `c` sta sulla corda da `a` a
/// `b`, al centesimo.
function circleThrough(a: Point, b: Point, c: Point): { readonly center: Point; readonly radius: number } | null {
  const u = minus(b, a);
  const v = minus(c, a);
  const chord = length(u);
  const area = cross(u, v);
  if (chord === 0 || Math.abs(area) / chord <= TOLERANCE) return null;
  const uu = dot(u, u);
  const vv = dot(v, v);
  const offset: Point = [(v[1] * uu - u[1] * vv) / (2 * area), (u[0] * vv - v[0] * uu) / (2 * area)];
  return { center: plus(a, offset), radius: length(offset) };
}

/// L'arco da `from` a `to` che passa per `through`, con le proporzioni e la
/// rotazione di `arc`: un cerchio per tre punti, nel riferimento dove
/// l'ellisse di `arc` è un cerchio. Una linea se `through` sta sulla corda.
function arcThrough(from: Point, to: Point, through: Point, arc: Extract<Link, { readonly kind: "arc" }>): Link {
  const ratio = Math.abs(arc.radii[0]) / Math.abs(arc.radii[1]);
  const radians = toRadians(arc.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const into = (p: Point): Point => [cos * p[0] + sin * p[1], (-sin * p[0] + cos * p[1]) * ratio];
  const [a, b, c] = [into(from), into(to), into(through)];
  const circle = circleThrough(a, b, c);
  if (circle === null) return { kind: "line" };
  const angle = (p: Point): number => Math.atan2(p[1] - circle.center[1], p[0] - circle.center[0]);
  const start = angle(a);
  const toEnd = remEuclid(angle(b) - start, 2 * Math.PI);
  // Il verso in cui, da `from`, si incontra `through` prima di `to`.
  const sweep = remEuclid(angle(c) - start, 2 * Math.PI) < toEnd;
  const span = sweep ? toEnd : 2 * Math.PI - toEnd;
  return { kind: "arc", radii: [circle.radius, circle.radius / ratio], rotation: arc.rotation, large: span > Math.PI, sweep };
}

/// `subs` col segmento `link` del sottotracciato `s` piegato: il punto dove
/// passa al parametro `t` si sposta di `delta`, e i nodi restano dove sono.
/// Una cubica muove le sue maniglie, di più quella del nodo più vicino; una
/// linea diventa prima la cubica dritta che è; una quadratica muove il suo
/// punto di controllo; un arco resta un arco, quello che passa per gli
/// stessi nodi e per il punto spostato, con le stesse proporzioni e la
/// stessa rotazione. Come per le maniglie, un nodo liscio resta liscio.
export function bend(subs: readonly Subpath[], s: number, link: number, t: number, delta: Point, kinds: KindOf): Subpath[] {
  const sub = subs[s]!;
  const at = Math.min(Math.max(t, 1e-3), 1 - 1e-3);
  const { from, curve } = curveAt(sub, link);
  if (curve.kind === "quad") {
    const control = plus(curve.control, times(delta, 1 / (2 * at * (1 - at))));
    return moveHandle(subs, { sub: s, link, which: "control" }, control, kinds);
  }
  const out = subs.slice();
  if (curve.kind === "arc" && arcCenter(from, curve) !== null) {
    let next = withLink(sub, link, arcThrough(from, curve.to, plus(pointAt(from, curve, at), delta), curve));
    // Una cubica dall'altra parte di un nodo liscio segue il verso nuovo.
    const start = startOf(sub, link);
    const end = endOf(sub, link);
    if (kinds(s, start) !== "corner" && loneCubic(next, start) === "in") next = aligned(next, start, "in");
    if (kinds(s, end) !== "corner" && loneCubic(next, end) === "out") next = aligned(next, end, "out");
    out[s] = next;
    return out;
  }
  // Una linea, o un arco che SVG disegna come linea, si piega come la cubica
  // dritta che è.
  const cubic = curve.kind === "cubic" ? curve : (lineToCubic(from, curve.to) as Cubic);
  out[s] = withLink(sub, link, linkOf(cubic));
  const weight = bendWeight(at);
  let bent = out;
  if (weight < 1) bent = moveHandle(bent, { sub: s, link, which: "c1" }, plus(cubic.c1, times(delta, (1 - weight) / (3 * at * (1 - at) ** 2))), kinds);
  if (weight > 0) bent = moveHandle(bent, { sub: s, link, which: "c2" }, plus(cubic.c2, times(delta, weight / (3 * at * at * (1 - at)))), kinds);
  return bent;
}

// ---------------------------------------------------------------------------
// Cambiare nodi e segmenti.
// ---------------------------------------------------------------------------

/// Un sottotracciato in costruzione, con la mappa dei nodi vecchi.
class Builder {
  readonly nodes: Point[] = [];
  readonly links: Link[] = [];
  readonly map = new Map<number, number>();

  node(p: Point, old: number | null): number {
    if (old !== null) this.map.set(old, this.nodes.length);
    this.nodes.push(p);
    return this.nodes.length - 1;
  }
}

/// `subs` con ogni arco fatto delle cubiche che lo approssimano: i nodi di
/// una forma, con le maniglie che un arco non ha.
export function arcsAsCubics(subs: readonly Subpath[]): Subpath[] {
  return subs.map((sub) => (sub.links.some((link) => link.kind === "arc") ? cubics(sub, (link) => sub.links[link]!.kind === "arc").sub : sub));
}

/// `sub` coi segmenti `which` fatti cubiche che si vedono uguali: un arco può
/// diventarne più d'una, con i nodi fra loro. `map` porta ogni nodo vecchio
/// al nuovo.
function cubics(sub: Subpath, which: (link: number) => boolean): { readonly sub: Subpath; readonly map: ReadonlyMap<number, number>; readonly added: readonly number[] } {
  const b = new Builder();
  const added: number[] = [];
  const n = sub.nodes.length;
  for (let at = 0; at < n; at++) {
    b.node(sub.nodes[at]!, at);
    if (at >= sub.links.length) break;
    const { from, curve } = curveAt(sub, at);
    let pieces: Curve[] = [curve];
    if (which(at)) {
      if (curve.kind === "line") pieces = [lineToCubic(from, curve.to)];
      else if (curve.kind === "quad") pieces = [quadToCubic(from, curve)];
      else if (curve.kind === "arc") pieces = arcToCubics(from, curve);
      // Un arco che non disegna niente diventa una linea ferma.
      if (pieces.length === 0) pieces = [lineToCubic(from, curve.to)];
    }
    pieces.forEach((piece, i) => {
      b.links.push(linkOf(piece));
      if (i < pieces.length - 1) added.push(b.node(piece.to, null));
    });
  }
  return { sub: { nodes: b.nodes, links: b.links, closed: sub.closed }, map: b.map, added };
}

/// Vero se il nodo `at` ha un segmento da tutti e due i lati.
function inner(sub: Subpath, at: number): boolean {
  const before = incoming(sub, at);
  const after = outgoing(sub, at);
  return before !== null && after !== null && before !== after;
}

/// I nodi scelti di `s`.
function chosenIn(selected: ReadonlySet<NodeKey>, s: number, sub: Subpath): number[] {
  return sub.nodes.map((_, at) => at).filter((at) => selected.has(nodeKey(s, at)));
}

/// Il risultato di una modifica che cambia i sottotracciati uno per uno, coi
/// nodi rimappati. `each` torna `null` per un sottotracciato che resta
/// com'è.
function assemble(
  subs: readonly Subpath[],
  each: (sub: Subpath, s: number) => { readonly sub: Subpath; readonly map: ReadonlyMap<number, number>; readonly selected: readonly number[]; readonly changed: number } | null,
  selected: ReadonlySet<NodeKey>,
): Edited {
  const out: Subpath[] = [];
  const chosen: NodeKey[] = [];
  const moved = new Map<NodeKey, NodeKey>();
  let changed = 0;
  subs.forEach((sub, s) => {
    const edit = each(sub, s);
    if (edit === null) {
      sub.nodes.forEach((_, at) => {
        moved.set(nodeKey(s, at), nodeKey(out.length, at));
        if (selected.has(nodeKey(s, at))) chosen.push(nodeKey(out.length, at));
      });
      out.push(sub);
      return;
    }
    changed += edit.changed;
    // Un sottotracciato rimasto senza nodi sparisce, e i successivi
    // scalano.
    if (edit.sub.nodes.length === 0) return;
    for (const [from, to] of edit.map) moved.set(nodeKey(s, from), nodeKey(out.length, to));
    for (const at of edit.selected) chosen.push(nodeKey(out.length, at));
    out.push(edit.sub);
  });
  return { subs: out, selected: chosen, changed, moved };
}

const identity = (sub: Subpath): Map<number, number> => new Map(sub.nodes.map((_, at) => [at, at]));

/// I nodi `selected` del tipo `kind`. Uno spigolo non cambia la geometria:
/// conta solo per chi trascina le maniglie. Liscio e simmetrico allineano le
/// due maniglie sul verso medio; i lati senza maniglie diventano prima
/// cubiche che si vedono uguali. Liscio accanto a una linea, a un arco o a
/// una quadratica tiene quel lato com'è e gli allinea la cubica dell'altro.
/// Una maniglia ritirata sul nodo esce di un terzo del suo segmento.
export function setKind(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>, kind: NodeKind): Edited {
  return assemble(subs, (sub, s) => {
    const targets = chosenIn(selected, s, sub).filter((at) => inner(sub, at));
    if (targets.length === 0) return null;
    if (kind === "corner") return { sub, map: identity(sub), selected: chosenIn(selected, s, sub), changed: targets.length };
    const convert = new Set<number>();
    for (const at of targets) {
      const before = incoming(sub, at)!;
      const after = outgoing(sub, at)!;
      const a = sub.links[before]!.kind === "cubic";
      const b = sub.links[after]!.kind === "cubic";
      // Liscio con una cubica sola: l'altro lato resta com'è, e la cubica
      // gli si allinea.
      if (kind === "smooth" && a !== b) continue;
      if (!a) convert.add(before);
      if (!b) convert.add(after);
    }
    const converted = cubics(sub, (link) => convert.has(link));
    let next = converted.sub;
    for (const old of targets) {
      const at = converted.map.get(old)!;
      const lone = loneCubic(next, at);
      if (lone !== null) {
        next = aligned(next, at, lone);
        continue;
      }
      const before = incoming(next, at)!;
      const after = outgoing(next, at)!;
      const third = (link: number): number => distance(next.nodes[startOf(next, link)]!, next.nodes[endOf(next, link)]!) / 3;
      let a = reach(next, at, "in").length;
      let b = reach(next, at, "out").length;
      if (a <= TOLERANCE) a = third(before);
      if (b <= TOLERANCE) b = third(after);
      const u = travel(next, at, "in");
      const v = travel(next, at, "out");
      if (u === null || v === null) continue;
      // Il verso medio; se i due lati tornano indietro l'uno sull'altro, il
      // perpendicolare.
      const direction = unit(plus(u, v)) ?? [-u[1], u[0]];
      if (kind === "symmetric") a = b = (a + b) / 2;
      next = turned(turned(next, at, "in", direction, a), at, "out", direction, b);
    }
    const map = converted.map;
    const chosen = chosenIn(selected, s, sub).map((at) => map.get(at)!);
    return { sub: next, map, selected: chosen, changed: targets.length };
  }, selected);
}

/// I segmenti fra due nodi scelti fatti linee (`"line"`) o curve
/// (`"curve"`): una linea diventa una cubica dritta, una quadratica la
/// cubica che è, un arco le cubiche che lo approssimano.
export function setLinks(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>, kind: "line" | "curve"): Edited {
  return assemble(subs, (sub, s) => {
    const between = (link: number): boolean =>
      endOf(sub, link) !== startOf(sub, link) && selected.has(nodeKey(s, startOf(sub, link))) && selected.has(nodeKey(s, endOf(sub, link)));
    const targets = sub.links.map((_, i) => i).filter((i) => between(i) && (kind === "line" ? sub.links[i]!.kind !== "line" : sub.links[i]!.kind !== "cubic"));
    if (targets.length === 0) return null;
    if (kind === "line") {
      const links = sub.links.map((link, i): Link => (targets.includes(i) ? { kind: "line" } : link));
      return { sub: { ...sub, links }, map: identity(sub), selected: chosenIn(selected, s, sub), changed: targets.length };
    }
    const converted = cubics(sub, (link) => targets.includes(link));
    const chosen = [...chosenIn(selected, s, sub).map((at) => converted.map.get(at)!), ...converted.added].sort((x, y) => x - y);
    return { sub: converted.sub, map: converted.map, selected: chosen, changed: targets.length };
  }, selected);
}

/// `sub` con i segmenti `where` divisi ai loro parametri: i nodi nuovi sono
/// scelti.
function split(sub: Subpath, where: ReadonlyMap<number, number>): { readonly sub: Subpath; readonly map: ReadonlyMap<number, number>; readonly added: readonly number[] } {
  const b = new Builder();
  const added: number[] = [];
  for (let at = 0; at < sub.nodes.length; at++) {
    b.node(sub.nodes[at]!, at);
    if (at >= sub.links.length) break;
    const t = where.get(at);
    if (t === undefined) {
      b.links.push(sub.links[at]!);
      continue;
    }
    const { from, curve } = curveAt(sub, at);
    const [first, second] = splitAt(from, curve, t);
    b.links.push(linkOf(first));
    added.push(b.node(first.to, null));
    b.links.push(linkOf(second));
  }
  return { sub: { nodes: b.nodes, links: b.links, closed: sub.closed }, map: b.map, added };
}

/// Un nodo nuovo a metà di ogni segmento fra due nodi scelti. Sono scelti
/// i nodi nuovi.
export function insertNodes(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): Edited {
  return assemble(subs, (sub, s) => {
    const where = new Map<number, number>();
    sub.links.forEach((_, i) => {
      if (endOf(sub, i) !== startOf(sub, i) && selected.has(nodeKey(s, startOf(sub, i))) && selected.has(nodeKey(s, endOf(sub, i)))) where.set(i, 0.5);
    });
    if (where.size === 0) return null;
    const out = split(sub, where);
    return { sub: out.sub, map: out.map, selected: out.added, changed: out.added.length };
  }, new Set());
}

/// Un nodo nuovo nel segmento `link` del sottotracciato `s`, al parametro
/// `t`: scelto lui solo.
export function insertNode(subs: readonly Subpath[], s: number, link: number, t: number): Edited {
  return assemble(subs, (sub, index) => {
    if (index !== s) return null;
    const out = split(sub, new Map([[link, t]]));
    return { sub: out.sub, map: out.map, selected: out.added, changed: 1 };
  }, new Set());
}

type Cubic = Extract<Curve, { readonly kind: "cubic" }>;

/// La cubica da `from` a `to` che `solve` trova per i parametri dei punti,
/// raffinata: Newton porta ogni parametro sul punto più vicino della curva
/// trovata, e la curva si ricalcola. Torna la migliore dei passi, con quanto
/// si scosta dai punti: un massimo, perché il punto più vicino della curva
/// può solo stare più vicino.
function refined(from: Point, points: readonly Point[], start: readonly number[], solve: (u: readonly number[]) => Cubic): { readonly curve: Cubic; readonly error: number } {
  let u = start;
  const error = (curve: Cubic): number => points.reduce((worst, p, i) => Math.max(worst, distance(pointAt(from, curve, u[i]!), p)), 0);
  let curve = solve(u);
  let best = { curve, error: error(curve) };
  const size = distance(from, points[points.length - 1]!) + best.error;
  for (let round = 0; round < 16 && best.error > size * 1e-9; round++) {
    const { c1, c2, to } = curve;
    // La derivata seconda della cubica, esatta.
    const a = plus(minus(c2, times(c1, 2)), from);
    const b = plus(minus(to, times(c2, 2)), c1);
    const now = curve;
    u = u.map((t, i) => {
      const diff = minus(pointAt(from, now, t), points[i]!);
      const d1 = derivativeAt(from, now, t);
      const d2 = plus(times(a, 6 * (1 - t)), times(b, 6 * t));
      const denominator = dot(d1, d1) + dot(diff, d2);
      return denominator === 0 ? t : Math.min(1, Math.max(0, t - dot(diff, d1) / denominator));
    });
    curve = solve(u);
    const e = error(curve);
    if (e < best.error) best = { curve, error: e };
  }
  return best;
}

/// La curva che fa le veci di `curves`, da `from` a `to`: una linea se lo
/// erano tutte, altrimenti la cubica più vicina ai loro punti che parte e
/// arriva nei loro versi, così un nodo liscio ai capi resta liscio
/// (Schneider, «An Algorithm for Automatically Fitting Digitized Curves»).
/// Quando quei versi non bastano — una maniglia che dovrebbe tornare
/// indietro, o un cappio che parte e arriva lungo la corda — la cubica è
/// libera.
function fitted(from: Point, curves: readonly Curve[], to: Point): Link {
  if (curves.every((curve) => curve.kind === "line")) return { kind: "line" };
  const points: Point[] = [from];
  let at = from;
  for (const curve of curves) {
    for (let i = 1; i <= 16; i++) points.push(pointAt(at, curve, i / 16));
    at = curve.to;
  }
  points[points.length - 1] = to;
  const chord = distance(from, to);
  const lastFrom = curves.length === 1 ? from : curves[curves.length - 2]!.to;
  const t1 = tangentAt(from, curves[0]!, false) ?? unit(minus(to, from));
  const t2 = tangentAt(lastFrom, curves[curves.length - 1]!, true) ?? unit(minus(to, from));
  // I parametri dei punti, per la lunghezza della spezzata.
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + distance(points[i - 1]!, points[i]!));
  const total = lengths[lengths.length - 1]!;
  if (total === 0) return { kind: "line" };
  const start = lengths.map((value) => value / total);
  const basis = (t: number): [number, number, number, number] => {
    const s = 1 - t;
    return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  };
  // Con i versi dati: le due lunghezze delle maniglie, ai minimi quadrati.
  const along = (t1: Point, t2: Point) => (u: readonly number[]): Cubic => {
    const cubic = (a1: number, a2: number): Cubic => ({ kind: "cubic", c1: plus(from, times(t1, a1)), c2: minus(to, times(t2, a2)), to });
    let c11 = 0;
    let c12 = 0;
    let c22 = 0;
    let x1 = 0;
    let x2 = 0;
    points.forEach((p, i) => {
      const b = basis(u[i]!);
      const a1 = times(t1, b[1]);
      const a2 = times(t2, -b[2]);
      // Ciò che i punti chiedono alle lunghezze, tolti i nodi e le maniglie
      // ferme su di loro.
      const r = minus(p, plus(times(from, b[0] + b[1]), times(to, b[2] + b[3])));
      c11 += dot(a1, a1);
      c12 += dot(a1, a2);
      c22 += dot(a2, a2);
      x1 += dot(a1, r);
      x2 += dot(a2, r);
    });
    const det = c11 * c22 - c12 * c12;
    if (Math.abs(det) < 1e-12) return cubic(chord / 3, chord / 3);
    return cubic((x1 * c22 - x2 * c12) / det, (c11 * x2 - c12 * x1) / det);
  };
  // Libera: le due maniglie dove stanno meglio, coordinata per coordinata.
  const free = (u: readonly number[]): Cubic => {
    let m11 = 0;
    let m12 = 0;
    let m22 = 0;
    let r1: Point = [0, 0];
    let r2: Point = [0, 0];
    points.forEach((p, i) => {
      const b = basis(u[i]!);
      // Ciò che i punti chiedono alle maniglie, tolti i nodi.
      const r = minus(p, plus(times(from, b[0]), times(to, b[3])));
      m11 += b[1] * b[1];
      m12 += b[1] * b[2];
      m22 += b[2] * b[2];
      r1 = plus(r1, times(r, b[1]));
      r2 = plus(r2, times(r, b[2]));
    });
    const det = m11 * m22 - m12 * m12;
    if (Math.abs(det) < 1e-12) return { kind: "cubic", c1: plus(from, times(minus(to, from), 1 / 3)), c2: plus(from, times(minus(to, from), 2 / 3)), to };
    const c1 = times(minus(times(r1, m22), times(r2, m12)), 1 / det);
    const c2 = times(minus(times(r2, m11), times(r1, m12)), 1 / det);
    return { kind: "cubic", c1, c2, to };
  };
  const bounds = points.reduce((box, p) => ({ min: [Math.min(box.min[0], p[0]), Math.min(box.min[1], p[1])] as Point, max: [Math.max(box.max[0], p[0]), Math.max(box.max[1], p[1])] as Point }), { min: from, max: from });
  const extent = distance(bounds.min, bounds.max);
  const kept = t1 === null || t2 === null ? null : refined(from, points, start, along(t1, t2));
  // Una maniglia che torna indietro fa una punta al nodo: i versi dati non
  // si tengono. Nemmeno oltre un ventesimo della misura, se la cubica libera
  // si scosta meno della metà.
  const floor = chord * 1e-6;
  const forward = kept !== null && t1 !== null && t2 !== null && dot(minus(kept.curve.c1, from), t1) > floor && dot(minus(to, kept.curve.c2), t2) > floor;
  if (forward && kept.error <= extent / 20) return linkOf(kept.curve);
  const loose = refined(from, points, start, free);
  return linkOf(!forward || loose.error < kept.error / 2 ? loose.curve : kept.curve);
}

/// `subs` senza i nodi `selected`. Fra due nodi che restano, i segmenti che
/// passavano per i nodi tolti diventano una curva sola che passa vicino a
/// dov'erano; alle estremità di un sottotracciato aperto i segmenti si
/// tolgono. Un sottotracciato con meno di due nodi sparisce.
export function deleteNodes(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): Edited {
  return assemble(subs, (sub, s) => {
    const n = sub.nodes.length;
    const gone = (at: number): boolean => selected.has(nodeKey(s, at));
    const removed = sub.nodes.filter((_, at) => gone(at)).length;
    if (removed === 0) return null;
    const kept = sub.nodes.map((_, at) => at).filter((at) => !gone(at));
    if (kept.length < 2) return { sub: { nodes: [], links: [], closed: false }, map: new Map(), selected: [], changed: removed };
    const b = new Builder();
    // Da un nodo che resta al successivo che resta, coi segmenti fra loro.
    const bridge = (from: number, to: number): void => {
      const curves: Curve[] = [];
      for (let link = from; link !== to; link = (link + 1) % n) curves.push(curveAt(sub, link).curve);
      b.links.push(curves.length === 1 ? sub.links[from]! : fitted(sub.nodes[from]!, curves, sub.nodes[to]!));
    };
    if (sub.closed) {
      kept.forEach((at, i) => {
        b.node(sub.nodes[at]!, at);
        bridge(at, kept[(i + 1) % kept.length]!);
      });
    } else {
      kept.forEach((at, i) => {
        b.node(sub.nodes[at]!, at);
        if (i < kept.length - 1) bridge(at, kept[i + 1]!);
      });
    }
    return { sub: { nodes: b.nodes, links: b.links, closed: sub.closed }, map: b.map, selected: [], changed: removed };
  }, new Set());
}

/// `sub`, aperto, percorso al contrario.
function backwards(sub: Subpath): Subpath {
  const links = sub.links.map((link, i) => linkOf(reversed(sub.nodes[i]!, curveOf(link, sub.nodes[i + 1]!))));
  return { nodes: sub.nodes.slice().reverse(), links: links.reverse(), closed: false };
}

/// I sottotracciati spezzati ai nodi scelti: uno chiuso si apre, uno aperto
/// si divide in due. Il nodo spezzato diventa due nodi nello stesso punto,
/// scelti tutti e due. Le estremità di un aperto non hanno niente da
/// spezzare.
export function breakNodes(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): Edited {
  const out: Subpath[] = [];
  const chosen: NodeKey[] = [];
  const moved = new Map<NodeKey, NodeKey>();
  let changed = 0;
  subs.forEach((sub, s) => {
    const n = sub.nodes.length;
    const cuts = chosenIn(selected, s, sub).filter((at) => (sub.closed ? n > 1 : at > 0 && at < n - 1));
    if (cuts.length === 0) {
      sub.nodes.forEach((_, at) => {
        moved.set(nodeKey(s, at), nodeKey(out.length, at));
        if (selected.has(nodeKey(s, at))) chosen.push(nodeKey(out.length, at));
      });
      out.push(sub);
      return;
    }
    changed += cuts.length;
    // Un chiuso si apre al primo taglio, che diventa i due capi: i nodi
    // ricominciano da lì, e il primo si ripete alla fine.
    let nodes = sub.nodes;
    let links = sub.links;
    let origin = (at: number): number => at;
    let inner = cuts;
    if (sub.closed) {
      const first = cuts[0]!;
      nodes = [...sub.nodes.slice(first), ...sub.nodes.slice(0, first), sub.nodes[first]!];
      links = [...sub.links.slice(first), ...sub.links.slice(0, first)];
      origin = (at) => (first + at) % n;
      inner = cuts.slice(1).map((at) => (at - first + n) % n);
      chosen.push(nodeKey(out.length, 0));
    }
    let from = 0;
    for (const cut of [...inner, nodes.length - 1]) {
      const piece = out.length;
      for (let at = from; at <= cut; at++) if (!moved.has(nodeKey(s, origin(at)))) moved.set(nodeKey(s, origin(at)), nodeKey(piece, at - from));
      if (from > 0) chosen.push(nodeKey(piece, 0));
      if (cut < nodes.length - 1 || sub.closed) chosen.push(nodeKey(piece, cut - from));
      out.push({ nodes: nodes.slice(from, cut + 1), links: links.slice(from, cut), closed: false });
      from = cut;
    }
  });
  return { subs: out, selected: chosen, changed, moved };
}

/// Vero se il nodo `at` è un capo di un sottotracciato aperto.
const isEnd = (sub: Subpath, at: number): boolean => !sub.closed && (at === 0 || at === sub.nodes.length - 1);

/// Unisce i due nodi scelti, se sono capi di sottotracciati aperti: i due
/// capi di uno stesso lo chiudono, quelli di due diversi li fanno uno solo.
/// Due capi nello stesso punto diventano un nodo solo; altrimenti li unisce
/// una linea. `null` se i nodi scelti non sono due capi.
export function joinNodes(subs: readonly Subpath[], selected: ReadonlySet<NodeKey>): Edited | null {
  if (selected.size !== 2) return null;
  const [[sa, aa], [sb, ab]] = [...selected].map(parseKey).sort((x, y) => x[0] - y[0] || x[1] - y[1]) as [[number, number], [number, number]];
  const a = subs[sa];
  const b = subs[sb];
  if (a === undefined || b === undefined || !isEnd(a, aa) || !isEnd(b, ab)) return null;
  const moved = new Map<NodeKey, NodeKey>();
  if (sa === sb) {
    const n = a.nodes.length;
    const meet = n > 2 && samePlace(a.nodes[0]!, a.nodes[n - 1]!);
    const out = subs.slice();
    out[sa] = meet ? { nodes: a.nodes.slice(0, -1), links: a.links, closed: true } : { nodes: a.nodes, links: [...a.links, { kind: "line" }], closed: true };
    subs.forEach((sub, s) => sub.nodes.forEach((_, at) => moved.set(nodeKey(s, at), nodeKey(s, s === sa && meet && at === n - 1 ? 0 : at))));
    return { subs: out, selected: meet ? [nodeKey(sa, 0)] : [nodeKey(sa, 0), nodeKey(sa, n - 1)], changed: 1, moved };
  }
  // Il primo finisce nel capo scelto, il secondo ne comincia.
  const flipA = aa === 0 && a.nodes.length > 1;
  const flipB = ab !== 0;
  const head = flipA ? backwards(a) : a;
  const tail = flipB ? backwards(b) : b;
  const meet = samePlace(head.nodes[head.nodes.length - 1]!, tail.nodes[0]!);
  const offset = head.nodes.length - (meet ? 1 : 0);
  const joined: Subpath = {
    nodes: [...head.nodes, ...(meet ? tail.nodes.slice(1) : tail.nodes)],
    links: [...head.links, ...(meet ? [] : [{ kind: "line" } as const]), ...tail.links],
    closed: false,
  };
  const out: Subpath[] = [];
  subs.forEach((sub, s) => {
    if (s === sb) return;
    const index = out.length;
    if (s === sa) {
      a.nodes.forEach((_, at) => moved.set(nodeKey(s, at), nodeKey(index, flipA ? a.nodes.length - 1 - at : at)));
      b.nodes.forEach((_, at) => moved.set(nodeKey(sb, at), nodeKey(index, offset + (flipB ? b.nodes.length - 1 - at : at))));
      out.push(joined);
      return;
    }
    sub.nodes.forEach((_, at) => moved.set(nodeKey(s, at), nodeKey(index, at)));
    out.push(sub);
  });
  const index = sa;
  const end = head.nodes.length - 1;
  return { subs: out, selected: meet ? [nodeKey(index, end)] : [nodeKey(index, end), nodeKey(index, end + 1)], changed: 1, moved };
}

// ---------------------------------------------------------------------------
// Che cosa sta sotto il puntatore.
// ---------------------------------------------------------------------------

/// Il nodo più vicino a `p`, un punto della scena, entro `tolerance`. `m`
/// porta le coordinate del tracciato nella scena.
export function nodeAt(subs: readonly Subpath[], m: Matrix, p: Point, tolerance: number): NodeKey | null {
  let best: NodeKey | null = null;
  let nearest = tolerance;
  subs.forEach((sub, s) => {
    sub.nodes.forEach((node, at) => {
      const d = distance(apply(m, node), p);
      if (d <= nearest) {
        best = nodeKey(s, at);
        nearest = d;
      }
    });
  });
  return best;
}

/// La maniglia di `handles` più vicina a `p`, entro `tolerance`.
export function handleAt(subs: readonly Subpath[], handles: readonly HandleRef[], m: Matrix, p: Point, tolerance: number): HandleRef | null {
  let best: HandleRef | null = null;
  let nearest = tolerance;
  for (const handle of handles) {
    const point = handlePoint(subs, handle);
    if (point === null) continue;
    const d = distance(apply(m, point), p);
    if (d <= nearest) {
      best = handle;
      nearest = d;
    }
  }
  return best;
}

/// I nodi che stanno dentro `area`, un rettangolo della scena.
export function nodesWithin(subs: readonly Subpath[], m: Matrix, area: { readonly min: Point; readonly max: Point }): NodeKey[] {
  const out: NodeKey[] = [];
  subs.forEach((sub, s) => {
    sub.nodes.forEach((node, at) => {
      const [x, y] = apply(m, node);
      if (x >= area.min[0] && x <= area.max[0] && y >= area.min[1] && y <= area.max[1]) out.push(nodeKey(s, at));
    });
  });
  return out;
}

/// Il punto dei segmenti più vicino a `p` entro `tolerance`: il segmento, e
/// il parametro a cui si trova.
export function linkAt(subs: readonly Subpath[], m: Matrix, p: Point, tolerance: number): { readonly sub: number; readonly link: number; readonly t: number } | null {
  const STEPS = 48;
  let best: { sub: number; link: number; t: number } | null = null;
  let nearest = tolerance;
  subs.forEach((sub, s) => {
    sub.links.forEach((_, i) => {
      const { from, curve } = curveAt(sub, i);
      const gap = (t: number): number => distance(apply(m, pointAt(from, curve, t)), p);
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
      const g = gap(refined);
      if (g < d) {
        d = g;
        t = refined;
      }
      if (d <= nearest) {
        best = { sub: s, link: i, t };
        nearest = d;
      }
    });
  });
  return best;
}
