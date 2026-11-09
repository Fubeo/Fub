// Le toppe della tela: la forma che il nucleo (`crates/fub-canvas-core`,
// caricato in WebAssembly da `wasm/core.ts`) applica al sorgente, e i
// costruttori che il motore usa per farle. Il commit, il suo annulla e la
// lettura del file stanno tutti nel nucleo; qui c'è solo ciò che serve a
// descrivere un cambiamento.
import type { TextOperation } from "../core/text-operation";
import { INK_KEY, inkLayerWritable, type InkLayerRef } from "./ink-record";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";

export type CanvasPatch =
  | { readonly kind: "upsert-node"; readonly before: CanvasNode | null; readonly after: CanvasNode; readonly at?: number }
  | { readonly kind: "remove-node"; readonly before: CanvasNode; readonly after: null; readonly at?: number }
  | { readonly kind: "upsert-edge"; readonly before: CanvasEdge | null; readonly after: CanvasEdge; readonly at?: number }
  | { readonly kind: "remove-edge"; readonly before: CanvasEdge; readonly after: null; readonly at?: number }
  | { readonly kind: "reorder"; readonly before: readonly string[]; readonly after: readonly string[] }
  | InkPatch;

/**
 * Un tratto com'è salvato in un livello `fub:ink`: un `id` stringa non vuota
 * e gli altri campi come sono nel file, anche quelli che Fub non sa disegnare
 * (`docs/reference/canvas-ink.md`). È il tipo di `before` e `after` di una
 * toppa `ink`, come `InkStroke` del nucleo Rust.
 */
export interface StoredInkStroke {
  readonly id: string;
  readonly [field: string]: unknown;
}

/** Dove sta un livello d'inchiostro: la radice (`"board"`) o una scheda (`{"node": id}`). */
export type LayerRef = InkLayerRef;

/**
 * Aggiunge (`before` a `null`), toglie (`after` a `null`) o cambia il tratto
 * alla posizione `at` dei tratti del livello `layer`, come `CanvasPatch::Ink`
 * del nucleo Rust (`docs/reference/canvas-ink.md` § «Toppa e operazioni»).
 * La applica il nucleo, come le altre toppe.
 */
export interface InkPatch {
  readonly kind: "ink";
  readonly layer: LayerRef;
  readonly at: number;
  readonly before: StoredInkStroke | null;
  readonly after: StoredInkStroke | null;
}

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

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// I campi noti di un tratto, nell'ordine in cui si scrivono (R10), come
// `STROKE_FIELDS` del nucleo Rust; gli sconosciuti vengono dopo, nel loro
// ordine. L'ancora resta com'è: il nucleo non la riordina.
const STROKE_ORDER: readonly string[] = ["id", "tool", "at", "brush", "color", "anchor", "ink"];

/**
 * Una copia del tratto con i campi nell'ordine di scrittura. A differenza di
 * schede e archi un `null` scritto resta: il nucleo conserva i campi di un
 * tratto come sono. `Object.fromEntries` tiene anche una chiave `__proto__`.
 */
function cloneStroke(stroke: StoredInkStroke): StoredInkStroke {
  const copy = JSON.parse(JSON.stringify(stroke)) as Record<string, unknown>;
  const entries: [string, unknown][] = [];
  for (const key of STROKE_ORDER) if (has(copy, key)) entries.push([key, copy[key]]);
  for (const [key, value] of Object.entries(copy)) if (!STROKE_ORDER.includes(key)) entries.push([key, value]);
  return Object.fromEntries(entries) as StoredInkStroke;
}

function cloneLayerRef(layer: LayerRef): LayerRef {
  return layer === "board" ? "board" : { node: layer.node };
}

/** Un tratto che il nucleo Rust legge: un oggetto con un `id` stringa non vuota. */
function isStoredStroke(value: unknown): value is StoredInkStroke {
  return isRecord(value) && typeof value.id === "string" && value.id !== "";
}

/** Chi tiene il livello: la radice o la prima scheda con quell'id (`ink_holder`). */
function inkHolder(doc: CanvasDocument, layer: LayerRef): Record<string, unknown> | undefined {
  return layer === "board" ? doc : nodeById(doc, layer.node);
}

/**
 * I tratti del livello `layer` se Fub ci può scrivere: vuoto se il livello
 * non c'è ancora, `null` se la scheda non c'è o il livello è estraneo
 * (`inkLayerWritable`).
 */
function writableStrokes(doc: CanvasDocument, layer: LayerRef): readonly StoredInkStroke[] | null {
  const holder = inkHolder(doc, layer);
  if (!holder || !inkLayerWritable(holder)) return null;
  if (!has(holder, INK_KEY)) return [];
  return (holder[INK_KEY] as { strokes: StoredInkStroke[] }).strokes;
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

/** `at` è la posizione dell'arco in `doc`: l'annulla lo rimette lì (R11). */
export function removeEdgePatch(doc: CanvasDocument, id: string): Extract<CanvasPatch, { kind: "remove-edge" }> | null {
  const at = doc.edges.findIndex((edge) => edge.id === id);
  if (at < 0) return null;
  return { kind: "remove-edge", before: cloneEdge(doc.edges[at]!), after: null, at };
}

/**
 * La toppa che aggiunge `record` in fondo ai tratti del livello `layer` (il
 * livello nasce se non c'è). `null` se il livello non lo accetta: la scheda
 * non c'è, il livello è estraneo o ha già un tratto con quell'id.
 */
export function addStrokePatch(doc: CanvasDocument, layer: LayerRef, record: StoredInkStroke): InkPatch | null {
  const strokes = writableStrokes(doc, layer);
  if (!strokes || !isStoredStroke(record) || strokes.some((stroke) => stroke.id === record.id)) return null;
  return { kind: "ink", layer: cloneLayerRef(layer), at: strokes.length, before: null, after: cloneStroke(record) };
}

/**
 * La toppa che toglie il tratto `id` dal livello `layer`, con la sua
 * posizione. `null` se il tratto non c'è o il livello è estraneo.
 */
export function eraseStrokePatch(doc: CanvasDocument, layer: LayerRef, id: string): InkPatch | null {
  return eraseStrokePatches(doc, layer, [id])?.[0] ?? null;
}

/**
 * Le toppe che tolgono i tratti `ids` dal livello `layer`, nell'ordine dato:
 * una passata di gomma, un commit solo. Ogni toppa porta la posizione che il
 * tratto ha dopo le cancellazioni prima di lei (come `erase_strokes` del
 * nucleo), così le toppe si applicano in fila e l'inversa rimette ogni tratto
 * al suo posto. `null` se un id non c'è o è ripetuto, o il livello è
 * estraneo; una lista vuota per `ids` vuoto.
 */
export function eraseStrokePatches(doc: CanvasDocument, layer: LayerRef, ids: readonly string[]): InkPatch[] | null {
  const strokes = writableStrokes(doc, layer);
  if (!strokes) return null;
  const remaining = [...strokes];
  const patches: InkPatch[] = [];
  for (const id of ids) {
    const at = remaining.findIndex((stroke) => stroke.id === id);
    if (at < 0) return null;
    patches.push({ kind: "ink", layer: cloneLayerRef(layer), at, before: cloneStroke(remaining[at]!), after: null });
    remaining.splice(at, 1);
  }
  return patches;
}
