// L'ordine di lettura della lavagna (T58): come si leggono le schede da
// sinistra a destra e dall'alto in basso, coi gruppi come cartelle. Lo usa
// l'elenco «Schede» dell'ispettore, e lo userà il giro della tastiera e del
// lettore di schermo (T61). È una regola pura: dalle schede del file
// all'elenco, senza DOM e senza la tela.
//
// Le regole:
// - una scheda sta dentro un gruppo se il suo rettangolo è tutto dentro il
//   rettangolo del gruppo, come quando la tela sposta un gruppo col suo
//   contenuto (`engine.ts`): il contenimento è geometrico, il file non ha un
//   secondo legame di parentela. Fra più gruppi che la contengono conta il
//   più piccolo; un gruppo è dentro un altro solo se è più piccolo, o se è
//   grande uguale e sta sotto (prima nell'array), così due gruppi identici non
//   si contengono a vicenda;
// - a ogni livello vengono prima i gruppi, poi le altre schede; ognuno dei
//   due elenchi va in righe, dall'alto in basso, e ogni riga da sinistra a
//   destra; dopo un gruppo viene il suo contenuto, con le stesse regole;
// - due schede stanno sulla stessa riga se si sovrappongono in altezza per più
//   di metà della più bassa. La riga la apre la scheda più in alto: le altre
//   si confrontano con lei;
// - a parità di tutto (due schede esattamente sovrapposte) viene prima quella
//   sotto, cioè quella che sta prima nell'array.

import type { CanvasNode } from "./model";

/** Una scheda al suo posto nell'ordine di lettura. */
export interface ReadingEntry {
  readonly node: CanvasNode;
  /** La posizione della scheda nell'array `nodes` del file. */
  readonly index: number;
  /** Quanti gruppi la contengono: 0 fuori da ogni gruppo. */
  readonly depth: number;
  /** L'id del gruppo che la contiene più da vicino, `null` se nessuno. */
  readonly parent: string | null;
}

interface Placed {
  readonly node: CanvasNode;
  readonly index: number;
  readonly area: number;
}

/** Il rettangolo di `inner` è tutto dentro quello di `outer`. */
function contains(outer: CanvasNode, inner: CanvasNode): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

/** Il gruppo `group` può contenere `item`: lo contiene, e non si contengono a vicenda. */
function holds(group: Placed, item: Placed): boolean {
  if (group.index === item.index || !contains(group.node, item.node)) return false;
  if (item.node.type !== "group") return true;
  return group.area > item.area || (group.area === item.area && group.index < item.index);
}

/** Quanto due schede si sovrappongono in altezza. */
function verticalOverlap(a: CanvasNode, b: CanvasNode): number {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

/** Le schede di un livello in righe: dall'alto in basso, ogni riga da sinistra a destra. */
function inRows(items: readonly Placed[]): Placed[] {
  const byTop = [...items].sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x || a.index - b.index);
  const rows: Placed[][] = [];
  let anchor: Placed | null = null;
  for (const item of byTop) {
    const lowest = anchor ? Math.min(anchor.node.height, item.node.height) : 0;
    if (anchor && verticalOverlap(anchor.node, item.node) > lowest / 2) {
      rows[rows.length - 1]!.push(item);
      continue;
    }
    anchor = item;
    rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.node.x - b.node.x || a.node.y - b.node.y || a.index - b.index));
}

/** Prima i gruppi, poi le altre schede, ognuno in righe. */
function levelOrder(items: readonly Placed[]): Placed[] {
  return [...inRows(items.filter((item) => item.node.type === "group")), ...inRows(items.filter((item) => item.node.type !== "group"))];
}

/**
 * Le schede `nodes` (nell'ordine dell'array del file) in ordine di lettura,
 * ognuna una volta, coi gruppi seguiti dal loro contenuto.
 */
export function readingOrder(nodes: readonly CanvasNode[]): ReadingEntry[] {
  const placed: Placed[] = nodes.map((node, index) => ({ node, index, area: node.width * node.height }));
  const groups = placed.filter((item) => item.node.type === "group");
  // Il gruppo più vicino: il più piccolo che la contiene; a parità quello più
  // in alto nell'array, che dei gruppi identici è il più interno.
  const parentOf = new Map<number, Placed>();
  for (const item of placed) {
    let best: Placed | null = null;
    for (const group of groups) {
      if (!holds(group, item)) continue;
      if (!best || group.area < best.area || (group.area === best.area && group.index > best.index)) best = group;
    }
    if (best) parentOf.set(item.index, best);
  }
  const children = new Map<number | null, Placed[]>();
  for (const item of placed) {
    const key = parentOf.get(item.index)?.index ?? null;
    const list = children.get(key);
    if (list) list.push(item);
    else children.set(key, [item]);
  }
  const out: ReadingEntry[] = [];
  // A mano e non con la ricorsione: un gruppo dentro mille gruppi non deve
  // riempire la pila.
  const stack: { readonly items: Placed[]; at: number; readonly depth: number; readonly parent: string | null }[] = [
    { items: levelOrder(children.get(null) ?? []), at: 0, depth: 0, parent: null },
  ];
  while (stack.length > 0) {
    const level = stack[stack.length - 1]!;
    const item = level.items[level.at++];
    if (!item) {
      stack.pop();
      continue;
    }
    out.push({ node: item.node, index: item.index, depth: level.depth, parent: level.parent });
    const inside = children.get(item.index);
    if (inside) stack.push({ items: levelOrder(inside), at: 0, depth: level.depth + 1, parent: item.node.id });
  }
  return out;
}
