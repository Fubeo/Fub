// La Curvatura del livello Esperto, il secondo modo della penna di Bézier: un
// tracciato che passa morbido per i punti che si posano, come lo strumento
// Curvatura di Illustrator. Senza DOM.
//
// - **Un punto liscio** prende le maniglie dai suoi due vicini, con la
//   Catmull-Rom centripeta: la curva vi passa senza spigolo, e senza i cappi
//   e le cuspidi della Catmull-Rom uniforme quando i punti stanno a distanze
//   molto diverse (Yuksel, Schaefer e Keyser, «Parameterization and
//   Applications of Catmull-Rom Curves», 2011). Le maniglie si allungano
//   quanto gira il tracciato nel punto, perché dei punti su un cerchio, a
//   passi uguali, diano il cerchio: quattro punti, un cerchio a meno di tre
//   decimillesimi del raggio. Nessuna maniglia va oltre metà della sua corda,
//   così nessun segmento fa un cappio.
// - **Uno spigolo**, e il capo di un tracciato aperto, lasciano la curva
//   libera: la maniglia verso un vicino liscio è quella del vicino
//   rispecchiata sull'asse della corda, così il segmento è simmetrico, un
//   arco se il vicino ci arriva su un cerchio. Tre punti fanno un arco. Fra
//   due spigoli c'è una linea.
// - **Si scrivono cubiche**, coi nodi e i segmenti dello strumento Nodi: il
//   tracciato si modifica poi come ogni altro.
// - **Sui tracciati che ci sono già** spostare un nodo, cambiarne il tipo o
//   toglierlo ricalcola soltanto i segmenti attorno: quelli che toccano lui e
//   i suoi vicini lisci. Il resto non cambia.

import { arcToCubics, lineToCubic, quadToCubic, type Curve } from "../scene/curves";
import type { Point } from "../scene/matrix";
import type { PenNode } from "./bezier";
import { curveAt, nodeKey, parseKey, type KindOf, type Link, type NodeKey, type Subpath } from "./nodes";

/// Il tipo di un punto della Curvatura.
export type CurveKind = "smooth" | "corner";

/// Un nodo della penna. Uno posato dalla Curvatura ha `curve`, e le sue
/// maniglie vengono dai vicini ([`curved`]); gli altri le hanno loro.
export interface DraftNode extends PenNode {
  readonly curve?: CurveKind;
}

const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/// Oltre questa svolta le maniglie non si allungano di più: è già quella di
/// tre punti a passi uguali su un cerchio.
const MAX_TURN = (2 * Math.PI) / 3;

/// Di quanto si allungano le maniglie della Catmull-Rom in un punto dove il
/// tracciato gira di `turn`: per punti a passi uguali su un cerchio, quanto
/// porta la maniglia della Catmull-Rom, il raggio per sen(`turn`) / 3, a
/// quella dell'arco, i 4/3 del raggio per tan(`turn` / 4).
function stretch(turn: number): number {
  const angle = Math.min(turn, MAX_TURN);
  return angle < 1e-6 ? 1 : (4 * Math.tan(angle / 4)) / Math.sin(angle);
}

/// La maniglia `handle` del nodo `at`, sulla corda verso `other`, accorciata
/// perché non vada oltre metà della corda.
function bounded(at: Point, handle: Point, other: Point): Point {
  const chord = minus(other, at);
  const size = dot(chord, chord);
  const along = size > 0 ? dot(minus(handle, at), chord) / size : 0;
  return along > 0.5 ? plus(at, times(minus(handle, at), 0.5 / along)) : handle;
}

/// Le maniglie del punto liscio `at` fra `before` e `after`, della
/// Catmull-Rom centripeta: la tangente nel nodo, coi nodi del parametro a
/// distanze che crescono con la radice delle corde, e ogni maniglia a un
/// terzo del passo del parametro dal suo lato, allungata quanto il
/// tracciato gira ([`stretch`]) e non oltre metà della sua corda. Una
/// maniglia che torna indietro lungo la sua corda resta quella della
/// Catmull-Rom. `null` se `at` coincide con un vicino, o i due vicini fra
/// loro: lì la curva non ha un verso.
export function smoothHandles(before: Point, at: Point, after: Point): { readonly in: Point; readonly out: Point } | null {
  const d0 = Math.sqrt(distance(before, at));
  const d1 = Math.sqrt(distance(at, after));
  if (!(d0 > 0 && d1 > 0) || !(distance(before, after) > 0)) return null;
  const tangent = plus(minus(times(minus(at, before), 1 / d0), times(minus(after, before), 1 / (d0 + d1))), times(minus(after, at), 1 / d1));
  const incoming = minus(at, before);
  const outgoing = minus(after, at);
  const k = stretch(Math.atan2(Math.abs(cross(incoming, outgoing)), dot(incoming, outgoing)));
  const side = (handle: Point, other: Point): Point => {
    const along = dot(minus(handle, at), minus(other, at));
    return along <= 0 ? handle : bounded(at, plus(at, times(minus(handle, at), k)), other);
  };
  return { in: side(minus(at, times(tangent, d0 / 3)), before), out: side(plus(at, times(tangent, d1 / 3)), after) };
}

/// La maniglia libera del nodo `at`, uno spigolo o un capo, sul segmento
/// verso `other`, la cui maniglia verso `at` è `handle`: quella rispecchiata
/// sull'asse della corda, senza la parte che torna indietro lungo la corda.
export function freeHandle(at: Point, other: Point, handle: Point): Point {
  const chord = minus(at, other);
  const size = dot(chord, chord);
  if (!(size > 0)) return at;
  // Dal vicino, quanto la maniglia va verso `at` e quanto di lato.
  const along = Math.max(0, dot(minus(handle, other), chord) / size);
  const aside = minus(minus(handle, other), times(chord, dot(minus(handle, other), chord) / size));
  return plus(minus(at, times(chord, along)), aside);
}

/// I nodi `nodes` della penna con le maniglie dei punti della Curvatura:
/// quelle di un punto liscio dai suoi vicini, che in un tracciato aperto non
/// mancano ai capi; quelle di uno spigolo, o di un capo, libere
/// ([`freeHandle`]), o nessuna se il vicino non ne ha una verso di lui.
/// Gli altri nodi restano come sono. Chiuso, il primo e l'ultimo sono
/// vicini.
export function curved(nodes: readonly DraftNode[], closed: boolean): PenNode[] {
  const n = nodes.length;
  const neighbor = (i: number, step: 1 | -1): DraftNode | undefined => (closed ? (n > 1 ? nodes[(i + step + n) % n] : undefined) : nodes[i + step]);
  // Prima i punti lisci, che dipendono solo dai vicini.
  const first = nodes.map((node, i): PenNode => {
    if (node.curve === undefined) return node;
    const before = neighbor(i, -1);
    const after = neighbor(i, 1);
    const handles = node.curve === "smooth" && before !== undefined && after !== undefined ? smoothHandles(before.at, node.at, after.at) : null;
    return handles === null ? { at: node.at, in: null, out: null } : { at: node.at, ...handles };
  });
  // Poi gli spigoli, dalle maniglie dei vicini verso di loro.
  return first.map((node, i) => {
    const draft = nodes[i]!;
    if (draft.curve === undefined || node.in !== null) return node;
    const before = closed ? (n > 1 ? first[(i - 1 + n) % n] : undefined) : first[i - 1];
    const after = closed ? (n > 1 ? first[(i + 1) % n] : undefined) : first[i + 1];
    return {
      at: node.at,
      in: before?.out == null ? null : freeHandle(node.at, before.at, before.out),
      out: after?.in == null ? null : freeHandle(node.at, after.at, after.in),
    };
  });
}

// ---------------------------------------------------------------------------
// I tracciati che ci sono già.
// ---------------------------------------------------------------------------

/// `curve` da `from` come cubiche che si vedono uguali.
function cubicsOf(from: Point, curve: Curve): Array<Extract<Curve, { readonly kind: "cubic" }>> {
  switch (curve.kind) {
    case "line":
      return [lineToCubic(from, curve.to) as Extract<Curve, { readonly kind: "cubic" }>];
    case "quad":
      return [quadToCubic(from, curve) as Extract<Curve, { readonly kind: "cubic" }>];
    case "cubic":
      return [curve];
    case "arc":
      return arcToCubics(from, curve).flatMap((piece, i, all) => {
        const start = i === 0 ? from : all[i - 1]!.to;
        return piece.kind === "cubic" ? [piece] : [lineToCubic(start, piece.to) as Extract<Curve, { readonly kind: "cubic" }>];
      });
  }
}

/// La maniglia che il segmento `link` di `sub` ha adesso dal lato `which`:
/// il punto di controllo di una cubica; per una linea, a un terzo da quel
/// capo; per una quadratica, quella della cubica che è; per un arco, sulla
/// tangente, a un terzo della corda.
function handleOf(sub: Subpath, link: number, which: "c1" | "c2"): Point {
  const { from, curve } = curveAt(sub, link);
  const cubics = cubicsOf(from, curve);
  const piece = which === "c1" ? cubics[0] : cubics[cubics.length - 1];
  if (piece === undefined) return which === "c1" ? from : curve.to;
  if (cubics.length === 1) return piece[which];
  // Un arco di più pezzi: il verso del pezzo, lungo un terzo della corda.
  const node = which === "c1" ? from : curve.to;
  const toward = minus(piece[which], node);
  const size = Math.hypot(toward[0], toward[1]);
  return size > 0 ? plus(node, times(toward, distance(from, curve.to) / 3 / size)) : node;
}

/// `subs` coi segmenti attorno ai nodi `around` ricalcolati come li
/// disegnerebbe la Curvatura, coi tipi `kinds`: i nodi lisci fra `around` e
/// i loro vicini prendono le maniglie della Catmull-Rom centripeta, e ogni
/// segmento che ne tocca uno si rifà con quelle. Un segmento fra due spigoli
/// resta com'è; con `reset` diventa una linea se tocca un nodo di `reset`,
/// quelli a cui si è appena cambiato il tipo. Dall'altra parte di un
/// segmento rifatto, uno spigolo ha la maniglia libera ([`freeHandle`]), e
/// un nodo liscio più lontano tiene la sua.
export function recurve(subs: readonly Subpath[], around: ReadonlySet<NodeKey>, kinds: KindOf, reset: ReadonlySet<NodeKey> = new Set()): Subpath[] {
  return subs.map((sub, s) => {
    const n = sub.nodes.length;
    const centers = [...around].map(parseKey).filter(([sa, at]) => sa === s && at < n).map(([, at]) => at);
    if (centers.length === 0 || n < 2) return sub;
    const step = (at: number, by: 1 | -1): number | null => {
      const next = at + by;
      if (sub.closed) return (next + n) % n;
      return next >= 0 && next < n ? next : null;
    };
    // I nodi da ricalcolare: quelli toccati e i loro vicini.
    const touched = new Set<number>();
    for (const at of centers) {
      touched.add(at);
      for (const by of [-1, 1] as const) {
        const next = step(at, by);
        if (next !== null) touched.add(next);
      }
    }
    // Le maniglie nuove dei nodi lisci.
    const smooth = new Map<number, { readonly in: Point; readonly out: Point }>();
    for (const at of touched) {
      if (kinds(s, at) === "corner") continue;
      const before = step(at, -1);
      const after = step(at, 1);
      if (before === null || after === null) continue;
      const handles = smoothHandles(sub.nodes[before]!, sub.nodes[at]!, sub.nodes[after]!);
      if (handles !== null) smooth.set(at, handles);
    }
    const resets = (at: number): boolean => reset.has(nodeKey(s, at));
    const links = sub.links.map((link, i): Link => {
      const a = i;
      const b = (i + 1) % n;
      const fromA = smooth.get(a);
      const toB = smooth.get(b);
      if (fromA === undefined && toB === undefined) {
        if (!(resets(a) || resets(b)) || kinds(s, a) !== "corner" || kinds(s, b) !== "corner") {
          // Un segmento fra due spigoli resta: senza `reset` lo sposta chi
          // ha spostato i nodi. Uno che tocca un nodo liscio rimasto senza
          // maniglie, fra vicini coincidenti, anche.
          return link;
        }
        return { kind: "line" };
      }
      // Il lato senza maniglie nuove: uno spigolo, un capo, o un nodo liscio
      // ricalcolato fra vicini coincidenti, va libero; un nodo liscio più
      // lontano tiene la sua.
      const free = (at: number): boolean => kinds(s, at) === "corner" || touched.has(at);
      let c1 = fromA?.out ?? null;
      let c2 = toB?.in ?? null;
      if (c1 === null) c1 = free(a) ? null : handleOf(sub, i, "c1");
      if (c2 === null) c2 = free(b) ? null : handleOf(sub, i, "c2");
      if (c1 === null) c1 = freeHandle(sub.nodes[a]!, sub.nodes[b]!, c2!);
      if (c2 === null) c2 = freeHandle(sub.nodes[b]!, sub.nodes[a]!, c1);
      return { kind: "cubic", c1, c2 };
    });
    return { nodes: sub.nodes, links, closed: sub.closed };
  });
}
