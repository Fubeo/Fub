// L'eco canonica: le operazioni applicate dal PC, rimandate allo scrittore
// con gli elementi come stanno scritti nel documento.
//
// Il motore copia i valori così come arrivano, salvo il `d` di un tratto,
// che ricalcola da `fub:ink` e `fub:brush`: lo scrittore non lo manda, o se
// lo manda non vale. L'eco gli restituisce quello vero, e lo scrittore
// sostituisce i suoi elementi per id. Un `add` porta l'elemento riletto dal
// documento, figli compresi; un `set` porta anche il `d` di un tratto; ogni
// altra operazione torna com'era.

import type { SceneEngine } from "../scene/engine";
import { parseFragment, rawOf, scopeOf } from "../scene/model";
import type { Op } from "../scene/ops";
import { attributeKey, type Elem } from "../scene/serialize";
import { NS_SVG, type NodeId, type XmlDocument } from "../scene/xml";

/// Gli elementi che hanno testo e non figli.
const TEXT_TAGS: ReadonlySet<string> = new Set(["tspan", "title", "desc"]);

function read(doc: XmlDocument, id: NodeId): Elem | null {
  const element = doc.element(id);
  if (element === null || element.ns !== NS_SVG) return null;
  const attrs: Record<string, string> = {};
  for (const attr of element.attrs) {
    if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
    attrs[attributeKey({ name: attr.name, uri: doc.namespaces[attr.ns]!, local: attr.local })] = attr.value;
  }
  const tag = element.local;
  if (TEXT_TAGS.has(tag)) {
    let text = "";
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" || node.kind === "cdata") text += node.value;
    }
    return { tag, attrs, text };
  }
  const children: Elem[] = [];
  for (const child of element.children) {
    if (doc.element(child) === null) continue;
    const inner = read(doc, child);
    if (inner === null) return null;
    children.push(inner);
  }
  return children.length > 0 ? { tag, attrs, children } : { tag, attrs };
}

/// L'elemento `id` come sta scritto nel documento, nella forma delle
/// operazioni; `null` se non c'è o non è un elemento SVG modificabile.
export function elemOf(engine: SceneEngine, id: string): Elem | null {
  const node = engine.holder(id);
  if (node === null || node.facts.id !== id || node.details === null || node.parent === null) return null;
  const fragment = parseFragment(rawOf(node), scopeOf(node.parent));
  return fragment === null ? null : read(fragment.doc, fragment.id);
}

function isStroke(elem: Elem): boolean {
  const tool = elem.attrs["fub:tool"];
  return elem.tag === "path" && (tool === "pen" || tool === "highlighter");
}

/// `op`, già applicata da `engine`, nella forma da rimandare allo scrittore.
export function canonicalEcho(engine: SceneEngine, op: Op): Op {
  switch (op.op) {
    case "batch":
      return { ...op, ops: op.ops.map((inner) => canonicalEcho(engine, inner)) };
    case "add": {
      if ("slot" in op) return op;
      const id = op.elem.attrs.id;
      const elem = id === undefined ? null : elemOf(engine, id);
      return elem === null ? op : { ...op, elem };
    }
    case "set": {
      const elem = elemOf(engine, op.id);
      const d = elem !== null && isStroke(elem) ? elem.attrs.d : undefined;
      return d === undefined ? op : { ...op, attrs: { ...op.attrs, d } };
    }
    default:
      return op;
  }
}

/// Gli id degli elementi che un'operazione aggiunge, anche se arriva dalla
/// rete e non si legge: i tratti dello scrittore hanno l'id del loro
/// inchiostro, che va tolto dall'overlay comunque vada il commit.
export function addedIds(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== "object") return into;
  const op = value as Record<string, unknown>;
  if (op.op === "batch" && Array.isArray(op.ops)) {
    for (const inner of op.ops) addedIds(inner, into);
  } else if (op.op === "add" && !("slot" in op)) {
    const id = (op.elem as { attrs?: Record<string, unknown> } | null | undefined)?.attrs?.id;
    if (typeof id === "string") into.add(id);
  }
  return into;
}
