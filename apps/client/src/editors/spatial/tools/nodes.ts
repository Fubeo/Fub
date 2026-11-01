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
// - **Ogni nodo ha le sue maniglie**, come nella Selezione diretta di
//   Illustrator: una linea ha quelle della cubica dritta che è, un arco
//   quelle delle cubiche che lo approssimano, e una maniglia ritirata sul
//   nodo si mostra accanto. Trascinarne una fa prima del segmento quelle
//   cubiche, che si vedono uguali; un nodo aperto tira fuori le sue due.

import { arcToCubics, lineToCubic, quadToCubic, tangentAt, type Curve } from "../scene/curves";
import type { Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";

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

/// Il tipo di ogni nodo, come lo vuole chi modifica: quello che sceglie, o
/// quello che si legge.
export type KindOf = (sub: number, at: number) => NodeKind;

/// Quanto un nodo può scostarsi da ciò che si legge e restare quello: le
/// coordinate si scrivono al centesimo, e due punti scritti al centesimo
/// sbagliano al più di un centesimo e mezzo fra loro.
const TOLERANCE = 0.015;

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);


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

/// Una maniglia come si vede: dove sta, e se è ritirata sul suo nodo e la si
/// mostra accanto, per tirarla fuori.
export interface HandleSpot {
  readonly point: Point;
  readonly folded: boolean;
}

/// La curva `curve` da `from` come cubiche che si vedono uguali: una linea è
/// la cubica dritta che è, una quadratica la cubica che è, un arco le
/// cubiche che lo approssimano, o una linea ferma se non disegna niente.
function asCubics(from: Point, curve: Curve): Cubic[] {
  if (curve.kind === "cubic") return [curve];
  if (curve.kind === "quad") return [quadToCubic(from, curve) as Cubic];
  if (curve.kind === "line") return [lineToCubic(from, curve.to) as Cubic];
  const pieces = arcToCubics(from, curve);
  return pieces.length > 0 && pieces.every((piece) => piece.kind === "cubic") ? (pieces as Cubic[]) : [lineToCubic(from, curve.to) as Cubic];
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

// ---------------------------------------------------------------------------
// Spostare nodi e maniglie.
// ---------------------------------------------------------------------------

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

/// `sub` coi segmenti `which` fatti cubiche che si vedono uguali
/// ([`asCubics`]): un arco può diventarne più d'una, con i nodi fra loro.
/// `map` porta ogni nodo vecchio al nuovo.
function cubics(sub: Subpath, which: (link: number) => boolean): { readonly sub: Subpath; readonly map: ReadonlyMap<number, number>; readonly added: readonly number[] } {
  const b = new Builder();
  const added: number[] = [];
  const n = sub.nodes.length;
  for (let at = 0; at < n; at++) {
    b.node(sub.nodes[at]!, at);
    if (at >= sub.links.length) break;
    const { from, curve } = curveAt(sub, at);
    const pieces: Curve[] = which(at) ? asCubics(from, curve) : [curve];
    pieces.forEach((piece, i) => {
      b.links.push(linkOf(piece));
      if (i < pieces.length - 1) added.push(b.node(piece.to, null));
    });
  }
  return { sub: { nodes: b.nodes, links: b.links, closed: sub.closed }, map: b.map, added };
}

/// `subs` coi segmenti `which` del sottotracciato `s` fatti cubiche
/// ([`cubics`]): `map` porta ogni suo nodo vecchio al nuovo, e `moved`
/// ogni nodo dove è finito, se se ne sono aggiunti.
function converting(subs: readonly Subpath[], s: number, which: ReadonlySet<number>): {
  readonly subs: Subpath[];
  readonly map: (at: number) => number;
  readonly moved: ReadonlyMap<NodeKey, NodeKey> | null;
} {
  const sub = subs[s]!;
  if (which.size === 0) return { subs: subs.slice(), map: (at) => at, moved: null };
  const converted = cubics(sub, (link) => which.has(link));
  const out = subs.slice();
  out[s] = converted.sub;
  if (converted.sub.nodes.length === sub.nodes.length) return { subs: out, map: (at) => converted.map.get(at)!, moved: null };
  const moved = new Map<NodeKey, NodeKey>();
  subs.forEach((each, index) => {
    each.nodes.forEach((_, at) => moved.set(nodeKey(index, at), nodeKey(index, index === s ? converted.map.get(at)! : at)));
  });
  return { subs: out, map: (at) => converted.map.get(at)!, moved };
}

/// I segmenti ai due lati del nodo `key` fatti cubiche che si vedono uguali,
/// per tirarne fuori le maniglie ([`pullHandles`]). Torna il nodo nei
/// sottotracciati nuovi e, se si sono aggiunti nodi, dove è finito ogni nodo.
export function openNode(subs: readonly Subpath[], key: NodeKey): {
  readonly subs: Subpath[];
  readonly key: NodeKey;
  readonly moved: ReadonlyMap<NodeKey, NodeKey> | null;
} {
  const [s, at] = parseKey(key);
  const sub = subs[s]!;
  const which = new Set<number>();
  for (const side of [incoming(sub, at), outgoing(sub, at)]) if (side !== null && sub.links[side]!.kind !== "cubic") which.add(side);
  const done = converting(subs, s, which);
  return { subs: done.subs, key: nodeKey(s, done.map(at)), moved: done.moved };
}

/// `subs` con le maniglie del nodo `key` tirate fuori, come con lo strumento
/// Punto di ancoraggio di Illustrator: quella del lato `side` in `to`, e
/// quella dell'altro lato, se c'è, all'opposto e lunga uguale, così il nodo
/// è simmetrico. I segmenti ai suoi lati sono già cubiche ([`openNode`]).
export function pullHandles(subs: readonly Subpath[], key: NodeKey, side: "in" | "out", to: Point): Subpath[] {
  const [s, at] = parseKey(key);
  const sub = subs[s]!;
  const node = sub.nodes[at]!;
  const opposite = minus(times(node, 2), to);
  let next = sub;
  const place = (index: number | null, which: "c1" | "c2", point: Point): void => {
    const link = index === null ? undefined : next.links[index];
    if (link?.kind === "cubic") next = withLink(next, index!, which === "c1" ? { ...link, c1: point } : { ...link, c2: point });
  };
  place(outgoing(sub, at), "c1", side === "out" ? to : opposite);
  place(incoming(sub, at), "c2", side === "in" ? to : opposite);
  const out = subs.slice();
  out[s] = next;
  return out;
}

type Cubic = Extract<Curve, { readonly kind: "cubic" }>;

// ---------------------------------------------------------------------------
// Che cosa sta sotto il puntatore.
// ---------------------------------------------------------------------------
