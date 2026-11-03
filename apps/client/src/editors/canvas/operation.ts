// Le toppe della tela: la forma che il nucleo (`crates/fub-canvas-core`,
// caricato in WebAssembly da `wasm/core.ts`) applica al sorgente, e i
// costruttori che il motore usa per farle. Il commit, il suo annulla e la
// lettura del file stanno tutti nel nucleo; qui c'è solo ciò che serve a
// descrivere un cambiamento.
import type { TextOperation } from "../core/text-operation";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";

export type CanvasPatch =
  | { readonly kind: "upsert-node"; readonly before: CanvasNode | null; readonly after: CanvasNode; readonly at?: number }
  | { readonly kind: "remove-node"; readonly before: CanvasNode; readonly after: null; readonly at?: number }
  | { readonly kind: "upsert-edge"; readonly before: CanvasEdge | null; readonly after: CanvasEdge }
  | { readonly kind: "remove-edge"; readonly before: CanvasEdge; readonly after: null }
  | { readonly kind: "reorder"; readonly before: readonly string[]; readonly after: readonly string[] };

export interface CanvasOperation extends TextOperation {
  readonly kind: "canvas";
  readonly patches: readonly CanvasPatch[];
}

// L'ordine in cui si scrivono le chiavi note (R10), come `node_value` ed
// `edge_value` in Rust; le sconosciute vengono dopo, nel loro ordine.
const NODE_ORDER = [
  "id", "type", "x", "y", "width", "height", "color", "text", "file", "subpath", "url", "label",
  "background", "backgroundStyle",
] as const;
const EDGE_ORDER = ["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd", "color", "label"] as const;

/**
 * `value` con le chiavi note prima, in `order`, poi le altre nel loro ordine.
 * `Object.fromEntries` definisce ogni chiave come propria, anche `__proto__`.
 */
function ordered<T extends object>(value: T, order: readonly string[]): T {
  const record = value as Record<string, unknown>;
  const entries: [string, unknown][] = [];
  for (const key of order) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) entries.push([key, record[key]]);
  }
  for (const [key, val] of Object.entries(record)) {
    if (!order.includes(key)) entries.push([key, val]);
  }
  return Object.fromEntries(entries) as T;
}

// I campi noti facoltativi: in una toppa, come nel file, `null` vale come
// assente (R7), e così li legge il nucleo Rust.
const NODE_OPTIONAL = ["color", "text", "file", "subpath", "url", "label", "background", "backgroundStyle"] as const;
const EDGE_OPTIONAL = ["fromSide", "fromEnd", "toSide", "toEnd", "color", "label"] as const;

function withoutNulls<T extends object>(value: T, keys: readonly string[]): T {
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] === null) delete record[key];
  }
  return value;
}

// Una copia con le chiavi nell'ordine in cui si scrivono (R10), senza i campi
// noti a `null` (R7).
function cloneNode(node: CanvasNode): CanvasNode {
  return ordered(withoutNulls(JSON.parse(JSON.stringify(node)) as CanvasNode, NODE_OPTIONAL), NODE_ORDER);
}

function cloneEdge(edge: CanvasEdge): CanvasEdge {
  return ordered(withoutNulls(JSON.parse(JSON.stringify(edge)) as CanvasEdge, EDGE_OPTIONAL), EDGE_ORDER);
}

/** Uguali come valori JSON (R9): l'ordine delle chiavi non conta, come in `patch::same_value`. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object"
    && !Array.isArray(left) && !Array.isArray(right)) {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key]));
  }
  return false;
}

function nodeById(doc: CanvasDocument, id: string): CanvasNode | undefined {
  return doc.nodes.find((node) => node.id === id);
}

function edgeById(doc: CanvasDocument, id: string): CanvasEdge | undefined {
  return doc.edges.find((edge) => edge.id === id);
}

let canvasIds = 0;

export function newNodeId(prefix = "n"): string {
  canvasIds += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}-${canvasIds}`;
}

export function upsertNodePatch(
  doc: CanvasDocument,
  after: CanvasNode,
): Extract<CanvasPatch, { kind: "upsert-node" }> | null {
  const before = nodeById(doc, after.id);
  if (before && sameValue(before, after)) return null;
  return {
    kind: "upsert-node",
    before: before ? cloneNode(before) : null,
    after: cloneNode(after),
  };
}

export function removeNodePatch(doc: CanvasDocument, id: string): Extract<CanvasPatch, { kind: "remove-node" }> | null {
  const before = nodeById(doc, id);
  if (!before) return null;
  return { kind: "remove-node", before: cloneNode(before), after: null, at: doc.nodes.findIndex((node) => node.id === id) };
}

export function upsertEdgePatch(
  doc: CanvasDocument,
  after: CanvasEdge,
): Extract<CanvasPatch, { kind: "upsert-edge" }> | null {
  const before = edgeById(doc, after.id);
  if (before && sameValue(before, after)) return null;
  return {
    kind: "upsert-edge",
    before: before ? cloneEdge(before) : null,
    after: cloneEdge(after),
  };
}

export function removeEdgePatch(doc: CanvasDocument, id: string): Extract<CanvasPatch, { kind: "remove-edge" }> | null {
  const before = edgeById(doc, id);
  if (!before) return null;
  return { kind: "remove-edge", before: cloneEdge(before), after: null };
}
