// La forma che ritaglia una maschera di ritaglio del livello Completo: sta
// dentro il `clipPath` privato del gruppo, con un id di risorsa suo, e
// «Modifica maschera» la sceglie (docs/product/drawing-masks.md). Non è un
// figlio del gruppo nel documento: qui diventa un oggetto che si sceglie e
// si trasforma, e i gesti che la cambiano scrivono la parte `[0]` del suo
// `clipPath` (formato della scena, risorse, §8).

import { buildFragment, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode, parseFragment, scopeOf } from "../scene/model";
import type { Op } from "../scene/ops";
import { reference } from "../scene/values";
import { fubAttributes, plainAttributes } from "./arrange";

/// La forma di un ritaglio, col suo `clipPath` e il gruppo che ritaglia.
export interface ClipShape {
  /// L'id della forma.
  readonly id: string;
  /// Il `clipPath` privato che la contiene, figlio di una `defs`.
  readonly resource: LeafNode;
  /// Il gruppo che il `clipPath` ritaglia, il solo che lo usa.
  readonly group: ContainerNode;
}

/// Il `clipPath` che contiene `id` come forma di una maschera, se `holder`
/// è l'elemento che porta `id`: privato, con una sola forma e quella con
/// l'id. `null` altrimenti.
export function clipResourceOf(holder: ElementPart | null, id: string): LeafNode | null {
  if (holder === null || holder.kind !== "leaf" || holder.details?.role !== "resource") return null;
  if (holder.facts.local !== "clipPath" || holder.facts.id === null || holder.facts.id === id) return null;
  if (holder.ids.length !== 2 || holder.ids[0] !== holder.facts.id || holder.ids[1] !== id) return null;
  return fubAttributes(holder).get("role") === "private" ? holder : null;
}

/// La forma di ritaglio con l'id `id` in `model`; `null` se `id` non è la
/// forma di una maschera di ritaglio che il livello Completo sa cambiare: un
/// `clipPath` privato, con quella sola forma, usato soltanto da un gruppo.
export function findClipShape(model: DocumentModel, id: string): ClipShape | null {
  let resource: LeafNode | null = null;
  const referrers: ElementPart[] = [];
  const visit = (container: ContainerNode): void => {
    for (const child of container.parts) {
      if (typeof child === "string" || child.kind === "other") continue;
      if (resource === null && child.kind === "leaf" && child.ids.includes(id)) resource = clipResourceOf(child, id);
      const refs = child.kind === "leaf" ? child.refs : child.facts.refs;
      if (refs.length > 0) referrers.push(child);
      if (child.kind === "container") visit(child);
    }
  };
  visit(model.root);
  const found = resource as LeafNode | null;
  if (found === null) return null;
  const clip = found.facts.id!;
  const users = referrers.filter((node) => node !== found && (node.kind === "leaf" ? node.refs : node.facts.refs).includes(clip));
  const group = users[0];
  if (users.length !== 1 || group === undefined || group.kind !== "container" || group.details?.role !== "group") return null;
  const written = plainAttributes(group).get("clip-path");
  if (written === undefined || reference(written) !== clip) return null;
  return { id, resource: found, group };
}

/// La forma come elemento figlio del gruppo che ritaglia, per misurarla e
/// sceglierla: nelle coordinate del gruppo, come la scrive un `clipPath` in
/// `userSpaceOnUse`. Non sta fra le parti del gruppo, e non si scrive mai.
export function clipShapeNode(shape: ClipShape): LeafNode | null {
  const parent = shape.resource.parent;
  if (parent === null) return null;
  const fragment = parseFragment(shape.resource.raw, scopeOf(parent));
  if (fragment === null) return null;
  const child = fragment.doc.children(fragment.id).find((each) => fragment.doc.element(each) !== null);
  if (child === undefined) return null;
  const node = buildFragment({ doc: fragment.doc, id: child }, shape.group);
  return node.kind === "leaf" && node.facts.id === shape.id && node.details !== null ? node : null;
}

/// Perché un gesto sulla forma di un ritaglio non si fa.
export const CLIP_SHAPE_REFUSED = "draw.reason.clipShape";

/// `op` con i `set` sulla forma di un ritaglio scritti sulla parte `[0]`
/// del suo `clipPath`; `holder` dà l'elemento che porta un id. Togliere la
/// forma, o cambiarne il tipo, lascerebbe il gruppo con un ritaglio diverso
/// da quello che si vede: [`CLIP_SHAPE_REFUSED`].
export function throughClipShapes(op: Op, holder: (id: string) => ElementPart | null): Op | typeof CLIP_SHAPE_REFUSED {
  const resourceOf = (id: string): LeafNode | null => clipResourceOf(holder(id), id);
  const walk = (each: Op): Op | null => {
    switch (each.op) {
      case "batch": {
        let changed = false;
        const ops: Op[] = [];
        for (const inner of each.ops) {
          const next = walk(inner);
          if (next === null) return null;
          changed ||= next !== inner;
          ops.push(next);
        }
        return changed ? { ...each, ops } : each;
      }
      case "set": {
        if (each.part !== undefined) return each;
        const resource = resourceOf(each.id);
        if (resource === null) return each;
        if (each.tag !== undefined) return null;
        return { op: "set", id: resource.facts.id!, part: [0], attrs: each.attrs };
      }
      case "remove":
        return typeof each.target === "string" && resourceOf(each.target) !== null ? null : each;
      default:
        return each;
    }
  };
  return walk(op) ?? CLIP_SHAPE_REFUSED;
}
