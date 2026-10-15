// La penna di Bézier del livello Esperto: un tracciato nodo per nodo. Senza
// DOM.
//
// - **Un nodo** è il punto per cui il tracciato passa, con due maniglie:
//   quella da cui arriva e quella verso cui riparte. Un tocco mette uno
//   spigolo, senza maniglie; un trascinamento un nodo simmetrico, con la
//   maniglia d'uscita sotto il puntatore e quella d'entrata opposta.
// - **Un segmento** fra due nodi è una linea se nessuno dei due ha la
//   maniglia verso l'altro, una cubica altrimenti, in cui la maniglia che
//   manca coincide col suo nodo.
// - **Il tracciato si scrive** coi nodi e i segmenti dello strumento Nodi,
//   che lo legge allo stesso modo: il tipo che si vede disegnando è quello
//   che lo strumento Nodi troverà.

import { apply, type Matrix, type Point } from "../scene/matrix";
import { kindOf, samePlace, type Link, type NodeKind, type Subpath } from "./nodes";

/// Un nodo della penna: dove passa il tracciato e le due maniglie, `null`
/// quella che non c'è.
export interface PenNode {
  readonly at: Point;
  readonly in: Point | null;
  readonly out: Point | null;
}

/// Il punto opposto a `p` rispetto ad `at`.
const mirror = (at: Point, p: Point): Point => [2 * at[0] - p[0], 2 * at[1] - p[1]];

/// Il nodo messo in `at`: uno spigolo, o con `handle` un nodo simmetrico che
/// riparte verso `handle`.
export function penNode(at: Point, handle: Point | null): PenNode {
  return handle === null ? { at, in: null, out: null } : { at, in: mirror(at, handle), out: handle };
}

/// Il sottotracciato dei nodi `nodes`, portati da `m` nelle coordinate in
/// cui si scrive: una trasformazione affine porta una cubica nella cubica
/// dei punti trasformati. Chiuso, l'ultimo segmento torna al primo nodo.
export function penPath(nodes: readonly PenNode[], closed: boolean, m: Matrix): Subpath {
  const links: Link[] = [];
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const from = nodes[i]!;
    const to = nodes[(i + 1) % nodes.length]!;
    links.push(
      from.out === null && to.in === null
        ? { kind: "line" }
        : { kind: "cubic", c1: apply(m, from.out ?? from.at), c2: apply(m, to.in ?? to.at) },
    );
  }
  return { nodes: nodes.map((node) => apply(m, node.at)), links, closed };
}

/// Vero se il sottotracciato si scriverebbe tutto in un punto: non
/// disegnerebbe niente.
export function collapsed(sub: Subpath): boolean {
  const first = sub.nodes[0];
  if (first === undefined) return true;
  const points = sub.links.flatMap((link) => (link.kind === "cubic" ? [link.c1, link.c2] : []));
  return [...sub.nodes, ...points].every((point) => samePlace(point, first));
}

/// Il tipo del nodo, dalle sue maniglie, come lo legge lo strumento Nodi in
/// mezzo a due cubiche: senza una delle due è uno spigolo.
export function penKind(node: PenNode): NodeKind {
  if (node.in === null || node.out === null) return "corner";
  const sub: Subpath = {
    nodes: [node.in, node.at, node.out],
    links: [
      { kind: "cubic", c1: node.in, c2: node.in },
      { kind: "cubic", c1: node.out, c2: node.out },
    ],
    closed: false,
  };
  return kindOf(sub, 1);
}
