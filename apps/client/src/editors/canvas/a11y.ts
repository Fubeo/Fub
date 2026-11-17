// La lavagna da tastiera e col lettore di schermo (T61): l'ordine in cui Tab
// percorre le schede, la scheda più vicina in una direzione (Alt+frecce), il
// nome di una scheda per il lettore di schermo e la frase che dice che cosa è
// appena cambiato. Regole pure, senza DOM e senza la tela: il motore le chiama
// e scrive il risultato dove serve.
//
// - L'ordine è quello di lettura di T58 (`readingOrder`), lo stesso
//   dell'elenco «Schede» dell'ispettore: gruppi prima, righe dall'alto in
//   basso, e dentro un gruppo il suo contenuto.
// - Il nome di una scheda dice la specie e il nome (le stesse parole della
//   testata del menu e dell'ispettore), il gruppo che la contiene più da
//   vicino e le schede a cui è collegata, con l'etichetta del filo; oltre
//   `LABEL_LINKS_MAX` schede dice solo quante sono: l'elenco sta
//   nell'ispettore.
// - Si calcola una volta per documento (`boardReading`): il motore lo rifà
//   solo quando il documento cambia, mai a ogni resa.

import { t } from "../../i18n/strings";
import { cardKindOf } from "./cards";
import { cardName } from "./chrome/inspector";
import { colorName } from "./colors";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";
import type { CanvasPatch } from "./operation";
import { readingOrder } from "./reading-order";

/// Oltre quante schede collegate il nome dice solo il numero.
export const LABEL_LINKS_MAX = 6;

/// L'etichetta di un filo nel nome, al più così lunga.
const EDGE_LABEL_MAX = 80;

/// Le quattro direzioni di Alt+frecce.
export type CardDirection = "left" | "right" | "up" | "down";

/**
 * La lavagna letta una volta: l'ordine di lettura, il posto di ogni scheda in
 * quell'ordine, il gruppo che la contiene e i fili che la toccano.
 */
export interface BoardReading {
  readonly order: readonly CanvasNode[];
  readonly index: ReadonlyMap<string, number>;
  readonly byId: ReadonlyMap<string, CanvasNode>;
  /** Il gruppo che contiene la scheda più da vicino, se c'è. */
  readonly parent: ReadonlyMap<string, CanvasNode>;
  /** I fili di ogni scheda, nell'ordine del file. */
  readonly edges: ReadonlyMap<string, readonly CanvasEdge[]>;
  /** I nomi già calcolati (`cardName`): una scheda collegata a molte si nomina una volta. */
  readonly names: Map<string, string>;
}

/** Legge la lavagna `doc`: un giro sulle schede (`readingOrder`) e uno sui fili. */
export function boardReading(doc: CanvasDocument): BoardReading {
  const entries = readingOrder(doc.nodes);
  const order: CanvasNode[] = [];
  const index = new Map<string, number>();
  const byId = new Map<string, CanvasNode>();
  for (const node of doc.nodes) byId.set(node.id, node);
  const parent = new Map<string, CanvasNode>();
  for (const entry of entries) {
    index.set(entry.node.id, order.length);
    order.push(entry.node);
    const group = entry.parent === null ? undefined : byId.get(entry.parent);
    if (group) parent.set(entry.node.id, group);
  }
  const edges = new Map<string, CanvasEdge[]>();
  const add = (id: string, edge: CanvasEdge): void => {
    const list = edges.get(id);
    if (list) list.push(edge);
    else edges.set(id, [edge]);
  };
  for (const edge of doc.edges) {
    if (!byId.has(edge.fromNode) || !byId.has(edge.toNode)) continue;
    add(edge.fromNode, edge);
    if (edge.toNode !== edge.fromNode) add(edge.toNode, edge);
  }
  return { order, index, byId, parent, edges, names: new Map() };
}

/** Il nome di `node` (`cardName`), calcolato una volta per lettura. */
function nameIn(reading: BoardReading, node: CanvasNode): string {
  let name = reading.names.get(node.id);
  if (name === undefined) {
    name = cardName(node);
    reading.names.set(node.id, name);
  }
  return name;
}

/** La specie e il nome di una scheda: «Scheda di nota Varianza», «Gruppo Idee». */
export function cardTitle(node: CanvasNode, name = cardName(node)): string {
  const kind = node.type === "group"
    ? t("canvas.a11y.group")
    : t("canvas_menu.header", { kind: t(`canvas_menu.kind.${node.type === "text" ? "text" : cardKindOf(node) ?? "file"}`) });
  return name === "" ? kind : t("canvas.a11y.titled", { kind, name });
}

/** L'etichetta di un filo, su una riga e non troppo lunga; `""` se non ne ha. */
function edgeLabel(edge: CanvasEdge): string {
  const text = typeof edge.label === "string" ? edge.label.replace(/\s+/g, " ").trim() : "";
  return text.length > EDGE_LABEL_MAX ? `${text.slice(0, EDGE_LABEL_MAX - 1).trimEnd()}…` : text;
}

/**
 * Il nome della scheda `node` per il lettore di schermo: «Scheda di nota
 * Varianza, nel gruppo Media e varianza, collegata a 2 schede: Media
 * aritmetica, vedi; istogramma, si vede qui.» Le schede collegate contano una
 * volta sola anche con più fili; `reading` è la lettura di `doc`, da passare
 * quando si nominano molte schede.
 */
export function cardLabel(node: CanvasNode, doc: CanvasDocument, reading: BoardReading = boardReading(doc)): string {
  const group = node.type === "group";
  const parts = [cardTitle(node, nameIn(reading, node))];
  const parent = reading.parent.get(node.id);
  if (parent) {
    const name = nameIn(reading, parent);
    parts.push(name === "" ? t("canvas.a11y.in_group_unnamed") : t("canvas.a11y.in_group", { name }));
  }
  // Le schede dall'altra parte dei fili, una volta ciascuna, con le etichette
  // dei loro fili.
  const linked = new Map<string, string[]>();
  for (const edge of reading.edges.get(node.id) ?? []) {
    const other = edge.fromNode === node.id ? edge.toNode : edge.fromNode;
    const labels = linked.get(other) ?? [];
    const label = edgeLabel(edge);
    if (label !== "" && !labels.includes(label)) labels.push(label);
    linked.set(other, labels);
  }
  if (linked.size > LABEL_LINKS_MAX) {
    parts.push(t(group ? "canvas.a11y.group_linked_many" : "canvas.a11y.linked_many", { n: String(linked.size) }));
  } else if (linked.size > 0) {
    const items: string[] = [];
    for (const [id, labels] of linked) {
      const other = reading.byId.get(id);
      if (!other) continue;
      items.push([nameIn(reading, other) || t("canvas.a11y.unnamed_card"), ...labels].join(", "));
    }
    parts.push(items.length === 1
      ? t(group ? "canvas.a11y.group_linked_one" : "canvas.a11y.linked_one", { name: items[0]! })
      : t(group ? "canvas.a11y.group_linked_list" : "canvas.a11y.linked_list", { n: String(items.length), list: items.join("; ") }));
  }
  const color = node.color ? ` ${t("canvas.options.color_value", { name: colorName(node.color) })}.` : "";
  return `${parts.join(", ")}.${color}`;
}

/**
 * La scheda dopo (`step` 1) o prima (-1) di `fromId` nell'ordine di lettura;
 * senza `fromId` (o se non c'è più) la prima o l'ultima. `null` oltre i bordi.
 */
export function stepInOrder(reading: BoardReading, fromId: string | null, step: 1 | -1): CanvasNode | null {
  const at = fromId === null ? undefined : reading.index.get(fromId);
  if (at === undefined) return reading.order[step > 0 ? 0 : reading.order.length - 1] ?? null;
  return reading.order[at + step] ?? null;
}

/**
 * La scheda più vicina a `from` nella direzione `direction` (Alt+frecce): il
 * centro più vicino dentro un cono di 90° attorno alla direzione (45° per
 * parte, i bordi compresi). A pari distanza vince quella prima nell'ordine di
 * lettura. `null` se da quella parte non c'è niente.
 */
export function nearestCard(from: CanvasNode, reading: BoardReading, direction: CardDirection): CanvasNode | null {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  let best: CanvasNode | null = null;
  let bestDistance = Infinity;
  let bestIndex = Infinity;
  for (const node of reading.order) {
    if (node.id === from.id) continue;
    const dx = node.x + node.width / 2 - cx;
    const dy = node.y + node.height / 2 - cy;
    // Lungo la direzione (`ahead`) e di traverso (`aside`).
    const ahead = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    const aside = direction === "right" || direction === "left" ? Math.abs(dy) : Math.abs(dx);
    if (ahead <= 0 || aside > ahead) continue;
    const distance = Math.hypot(dx, dy);
    const index = reading.index.get(node.id) ?? Infinity;
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && index < bestIndex)) {
      best = node;
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return best;
}

/**
 * Che cosa ha fatto il commit `patches` sulla lavagna, per la regione viva:
 * le schede tolte, poi i fili nuovi, poi le schede spostate (la prima cosa che
 * c'è, una frase sola). `null` per ciò che non si annuncia (un testo, un
 * colore, una misura): lo dice già il nome della scheda col fuoco.
 */
export function changeAnnouncement(patches: readonly CanvasPatch[], doc: CanvasDocument): string | null {
  const removed: CanvasNode[] = [];
  const linked: CanvasEdge[] = [];
  const moved: CanvasNode[] = [];
  for (const patch of patches) {
    if (patch.kind === "remove-node") removed.push(patch.before);
    else if (patch.kind === "upsert-edge" && patch.before === null) linked.push(patch.after);
    else if (patch.kind === "upsert-node" && patch.before !== null) {
      const { before, after } = patch;
      const shifted = before.x !== after.x || before.y !== after.y;
      const same = before.width === after.width && before.height === after.height;
      if (shifted && same) moved.push(after);
    }
  }
  if (removed.length > 0) {
    return removed.length === 1
      ? t("canvas.a11y.removed_one", { name: cardTitle(removed[0]!) })
      : t("canvas.a11y.removed_many", { n: String(removed.length) });
  }
  if (linked.length > 0) {
    if (linked.length > 1) return t("canvas.a11y.linked_now_many", { n: String(linked.length) });
    const edge = linked[0]!;
    const from = doc.nodes.find((node) => node.id === edge.fromNode);
    const to = doc.nodes.find((node) => node.id === edge.toNode);
    if (!from || !to) return null;
    return t("canvas.a11y.linked_now", { from: cardTitle(from), to: cardTitle(to) });
  }
  if (moved.length > 0) {
    return moved.length === 1
      ? t("canvas.a11y.moved_one", { name: cardTitle(moved[0]!) })
      : t("canvas.a11y.moved_many", { n: String(moved.length) });
  }
  return null;
}
