// Un colore per autore, come in Word: la forma dice che cosa è successo
// (sottolineato, barrato) e il colore dice chi è stato.
//
// Gli autori prendono un posto, da 1 a `AUTHOR_SLOTS`, nell'ordine in cui
// compaiono nel documento: le revisioni e i commenti, nel punto in cui
// stanno; poi i commenti senza un posto. Il settimo riprende dal primo. Sul
// testo va il posto come classe (`rich-autore-3`), non il colore: il colore è
// della pelle, sulla carta del tema e su quella del file.
import type { Node as PmNode } from "prosemirror-model";
import { commentsOf } from "./comments";
import type { Rev } from "./projection";

export const AUTHOR_SLOTS = 6;

/// Chi, come lo riconosce il posto: senza nome è un autore anche lui.
const key = (by: string | undefined): string => (by ?? "").trim();

/// Il posto di ogni autore del documento.
export function authorSlots(doc: PmNode): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  const meet = (by: string | undefined) => {
    const name = key(by);
    if (!slots.has(name)) slots.set(name, (slots.size % AUTHOR_SLOTS) + 1);
  };
  const comments = commentsOf(doc);
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const revs = (node: PmNode) => {
    for (const mark of node.marks) if (mark.type.name === "ins" || mark.type.name === "del") meet((mark.attrs.rev as Rev).by);
  };
  const walk = (node: PmNode) => {
    node.forEach((child) => {
      revs(child);
      const comment = child.type.name === "atom" ? (child.attrs.comment as { id: number; end?: boolean } | null) : null;
      if (comment && !comment.end) {
        meet(byId.get(comment.id)?.by);
        for (const reply of comments) if (reply.parent === comment.id) meet(reply.by);
      }
      if (!child.isLeaf) walk(child);
      // Il segno di fine del paragrafo viene dopo il suo testo.
      if (child.isTextblock) for (const kind of ["ins", "del"] as const) if (child.attrs[kind]) meet((child.attrs[kind] as Rev).by);
    });
  };
  walk(doc);
  for (const comment of comments) meet(comment.by);
  return slots;
}

/// Il posto di `by`; uno che il documento non conosce sta al primo.
export function authorSlot(slots: ReadonlyMap<string, number>, by: string | undefined): number {
  return slots.get(key(by)) ?? 1;
}

/// La classe del posto, per il testo e per il pallino accanto al nome.
export const authorClass = (slot: number): string => `rich-autore-${slot}`;
