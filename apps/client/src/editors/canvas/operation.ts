import {
  invertOperation,
  lineFeeds,
  operationFromText,
  type TextOperation,
} from "../core/text-operation";
import { INK_KEY, INK_LAYER_VERSION, inkLayerWritable, type InkLayerRef } from "./ink-record";
import { isValidCanvas, parseCanvas, type CanvasDocument, type CanvasEdge, type CanvasNode } from "./model";
import {
  orderedCanvasEdge,
  orderedCanvasNode,
  patchCanvasSource,
  sameCanvasModel,
  sameCanvasValue,
} from "./source-edit";

export type CanvasPatch =
  | { readonly kind: "upsert-node"; readonly before: CanvasNode | null; readonly after: CanvasNode; readonly at?: number }
  | { readonly kind: "remove-node"; readonly before: CanvasNode; readonly after: null; readonly at?: number }
  | { readonly kind: "upsert-edge"; readonly before: CanvasEdge | null; readonly after: CanvasEdge }
  | { readonly kind: "remove-edge"; readonly before: CanvasEdge; readonly after: null }
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
 * del nucleo Rust (`docs/reference/canvas-operations.md` § «Inchiostro»).
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

export function isCanvasOperation(operation: TextOperation | null): operation is CanvasOperation {
  return operation !== null && "kind" in operation && operation.kind === "canvas";
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
  return orderedCanvasNode(withoutNulls(JSON.parse(JSON.stringify(node)) as CanvasNode, NODE_OPTIONAL));
}

function cloneEdge(edge: CanvasEdge): CanvasEdge {
  return orderedCanvasEdge(withoutNulls(JSON.parse(JSON.stringify(edge)) as CanvasEdge, EDGE_OPTIONAL));
}

/** Uguali come valori JSON (R9): l'ordine delle chiavi non conta, come in `patch::same_value`. */
function sameValue(left: unknown, right: unknown): boolean {
  return sameCanvasValue(left, right);
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

/** `"board"` o `{"node": id}`, senza altri campi: la forma di `LayerRef` in Rust. */
function isLayerRef(value: unknown): value is LayerRef {
  if (value === "board") return true;
  return isRecord(value) && typeof value.node === "string" && Object.keys(value).length === 1;
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

/** Why a draft is refused: the word of `PatchError::reason` in the Rust core. */
type DraftRefusal = "stale" | "invalid";

/**
 * Un passo `ink` sulla bozza, come `ink_step` del nucleo Rust e con le sue
 * ragioni: `invalid` per una toppa che porterebbe a un livello che Fub non
 * scrive (senza tratto, livello estraneo, un id che il livello ha già, o una
 * toppa che il nucleo non saprebbe nemmeno leggere), `stale` per una scheda
 * che non c'è, un'immagine di prima che non torna o un `at` oltre la fine.
 */
function inkStep(draft: CanvasDocument, patch: InkPatch): DraftRefusal | null {
  const before: unknown = patch.before ?? null;
  const after: unknown = patch.after ?? null;
  if ((before !== null && !isStoredStroke(before)) || (after !== null && !isStoredStroke(after))
    || !isLayerRef(patch.layer) || !Number.isSafeInteger(patch.at) || patch.at < 0) return "invalid";
  if (before === null && after === null) return "invalid";
  const holder = inkHolder(draft, patch.layer);
  if (!holder) return "stale";
  if (!inkLayerWritable(holder)) return "invalid";
  const layer: Record<string, unknown> = has(holder, INK_KEY)
    ? holder[INK_KEY] as Record<string, unknown>
    : { v: INK_LAYER_VERSION, strokes: [] };
  const strokes = [...layer.strokes as StoredInkStroke[]];
  const at = patch.at;
  if (before === null ? at > strokes.length : at >= strokes.length || !sameValue(strokes[at], before)) return "stale";
  // Il posto che il tratto prende: con `before` quello del tratto di prima,
  // che non conta come doppione.
  if (after !== null && strokes.some((stroke, index) => (before === null || index !== at) && stroke.id === after.id)) {
    return "invalid";
  }
  if (before === null) strokes.splice(at, 0, cloneStroke(after as StoredInkStroke));
  else if (after === null) strokes.splice(at, 1);
  else strokes[at] = cloneStroke(after);
  const extra = Object.entries(layer).filter(([key]) => key !== "v" && key !== "strokes");
  // L'ultimo tratto tolto da `{"v": 1, "strokes": [...]}`: la chiave sparisce.
  // Altrimenti il livello si riscrive `v`, `strokes`, poi gli altri campi; una
  // chiave che c'è resta al suo posto, una nuova va in fondo ai campi.
  if (!strokes.length && !extra.length) delete holder[INK_KEY];
  else holder[INK_KEY] = Object.fromEntries([["v", layer.v], ["strokes", strokes], ...extra]);
  return null;
}

/** Validate every preimage on a private draft; the live graph is never partially mutated. */
function canvasDraft(
  doc: CanvasDocument,
  patches: readonly CanvasPatch[],
): { readonly draft: CanvasDocument } | { readonly refused: DraftRefusal } {
  const draft = JSON.parse(JSON.stringify(doc)) as CanvasDocument;
  const stale = { refused: "stale" } as const;
  for (const patch of patches) {
    switch (patch.kind) {
      case "upsert-node": {
        const current = nodeById(draft, patch.after.id);
        if (patch.before === null ? current !== undefined
          : !current || !sameValue(current, cloneNode(patch.before))) return stale;
        const index = draft.nodes.findIndex((node) => node.id === patch.after.id);
        if (index >= 0) draft.nodes[index] = cloneNode(patch.after);
        else if (patch.at !== undefined && Number.isInteger(patch.at) && patch.at >= 0 && patch.at <= draft.nodes.length) {
          draft.nodes.splice(patch.at, 0, cloneNode(patch.after));
        } else if (patch.at !== undefined) return stale;
        else draft.nodes.push(cloneNode(patch.after));
        break;
      }
      case "remove-node": {
        const current = nodeById(draft, patch.before.id);
        if (!current || !sameValue(current, cloneNode(patch.before))
          || draft.edges.some((edge) => edge.fromNode === current.id || edge.toNode === current.id)) return stale;
        draft.nodes = draft.nodes.filter((node) => node.id !== current.id);
        break;
      }
      case "upsert-edge": {
        const current = edgeById(draft, patch.after.id);
        if (patch.before === null ? current !== undefined
          : !current || !sameValue(current, cloneEdge(patch.before))) return stale;
        if (!nodeById(draft, patch.after.fromNode) || !nodeById(draft, patch.after.toNode)) return stale;
        const index = draft.edges.findIndex((edge) => edge.id === patch.after.id);
        if (index >= 0) draft.edges[index] = cloneEdge(patch.after);
        else draft.edges.push(cloneEdge(patch.after));
        break;
      }
      case "remove-edge": {
        const current = edgeById(draft, patch.before.id);
        if (!current || !sameValue(current, cloneEdge(patch.before))) return stale;
        draft.edges = draft.edges.filter((edge) => edge.id !== current.id);
        break;
      }
      case "reorder": {
        const current = draft.nodes.map((node) => node.id);
        if (!sameValue(current, [...patch.before])
          || !sameValue([...patch.after].sort(), [...current].sort())) return stale;
        const byId = new Map(draft.nodes.map((node) => [node.id, node]));
        draft.nodes = patch.after.map((id) => byId.get(id)!).filter(Boolean);
        break;
      }
      case "ink": {
        const refused = inkStep(draft, patch);
        if (refused !== null) return { refused };
        break;
      }
      default:
        // Una toppa che il nucleo non saprebbe leggere.
        return { refused: "invalid" };
    }
  }
  return { draft };
}

/**
 * `doc` diventa la bozza: le schede, gli archi e i campi della radice, dove
 * vive il livello dell'inchiostro libero. Un campo della radice uguale per
 * valore resta l'oggetto di prima; `defineProperty` scrive anche una chiave
 * `__proto__` come campo proprio.
 */
function adoptDraft(doc: CanvasDocument, draft: CanvasDocument): void {
  doc.nodes = draft.nodes;
  doc.edges = draft.edges;
  const root = doc as Record<string, unknown>;
  for (const key of Object.keys(root)) if (!has(draft, key)) delete root[key];
  for (const [key, value] of Object.entries(draft)) {
    if (key === "nodes" || key === "edges" || (has(root, key) && sameValue(root[key], value))) continue;
    Object.defineProperty(root, key, { value, writable: true, enumerable: true, configurable: true });
  }
}

export function applyCanvasPatches(doc: CanvasDocument, patches: readonly CanvasPatch[]): boolean {
  const result = canvasDraft(doc, patches);
  if (!("draft" in result)) return false;
  adoptDraft(doc, result.draft);
  return true;
}

/**
 * Why a commit is refused, the same word as `CommitError::reason` in the Rust
 * core: `stale` (a patch does not fit the model, or the model is not the
 * source's), `invalid` (the canvas after the patches is not valid),
 * `rejected` (the source cannot be patched, for example a repeated key) or
 * `unstable` (the text written does not read back as the canvas after).
 */
export type CanvasCommitReason = "stale" | "invalid" | "rejected" | "unstable";

export type CanvasCommitOutcome =
  | { readonly outcome: "applied"; readonly source: string; readonly operation: CanvasOperation }
  | { readonly outcome: "rejected"; readonly reason: CanvasCommitReason };

/**
 * Commit `patches` on `doc`, whose source is `beforeSource`: all of them or
 * none. On success `doc` becomes the canvas after; on a refusal it stays as it
 * was and the outcome says why, in the order the Rust core checks (the draft,
 * its validity, the patch of the source, the reread). An empty list is a
 * commit that changes nothing.
 */
export function canvasCommitOutcome(
  doc: CanvasDocument,
  beforeSource: string,
  patches: readonly CanvasPatch[],
): CanvasCommitOutcome {
  const result = canvasDraft(doc, patches);
  if (!("draft" in result)) return { outcome: "rejected", reason: result.refused };
  const draft = result.draft;
  let before: CanvasDocument;
  try {
    before = parseCanvas(beforeSource);
  } catch {
    return { outcome: "rejected", reason: "stale" };
  }
  if (!sameCanvasModel(before, doc)) return { outcome: "rejected", reason: "stale" };
  // La validità della bozza si guarda solo quando qualcosa non va: un testo
  // che si rilegge come la bozza dice già che è valida.
  const refused = (reason: CanvasCommitReason): CanvasCommitOutcome => ({
    outcome: "rejected",
    reason: isValidCanvas(draft) ? reason : "invalid",
  });
  let source: string;
  try {
    source = patchCanvasSource(beforeSource, before, draft);
  } catch {
    return refused("rejected");
  }
  try {
    if (!sameCanvasModel(parseCanvas(source), draft)) return refused("unstable");
  } catch {
    return refused("unstable");
  }
  adoptDraft(doc, draft);
  return {
    outcome: "applied",
    source,
    operation: {
      kind: "canvas",
      patches: patches.map((patch) => {
        switch (patch.kind) {
          case "upsert-node":
            return {
              kind: patch.kind,
              before: patch.before ? cloneNode(patch.before) : null,
              after: cloneNode(patch.after),
              at: patch.at,
            } as CanvasPatch;
          case "remove-node":
            return { kind: patch.kind, before: cloneNode(patch.before), after: null, at: patch.at } as CanvasPatch;
          case "upsert-edge":
            return {
              kind: patch.kind,
              before: patch.before ? cloneEdge(patch.before) : null,
              after: cloneEdge(patch.after),
            } as CanvasPatch;
          case "remove-edge":
            return { kind: patch.kind, before: cloneEdge(patch.before), after: null } as CanvasPatch;
          case "reorder":
            return { kind: patch.kind, before: [...patch.before], after: [...patch.after] } as CanvasPatch;
          case "ink":
            return {
              kind: patch.kind,
              layer: cloneLayerRef(patch.layer),
              at: patch.at,
              before: patch.before ? cloneStroke(patch.before) : null,
              after: patch.after ? cloneStroke(patch.after) : null,
            } as CanvasPatch;
        }
      }),
      // Gli offset di un'operazione si contano sul testo a `\n`, come li
      // valida la sessione: su un file CRLF quelli del testo grezzo non
      // tornerebbero e la modifica sparirebbe (#97). Il testo emesso tiene i
      // terminatori del file: il patcher copia i separatori che trova.
      ...operationFromText(lineFeeds(beforeSource), lineFeeds(source)),
    },
  };
}

export function commitCanvasPatches(
  doc: CanvasDocument,
  beforeSource: string,
  patches: readonly CanvasPatch[],
): { readonly source: string; readonly operation: CanvasOperation } | null {
  if (!patches.length) return null;
  const outcome = canvasCommitOutcome(doc, beforeSource, patches);
  return outcome.outcome === "applied" ? { source: outcome.source, operation: outcome.operation } : null;
}

export function inverseCanvasPatches(patches: readonly CanvasPatch[]): CanvasPatch[] {
  const inverse = [...patches].reverse().map((patch): CanvasPatch => {
    switch (patch.kind) {
      case "upsert-node":
        return patch.before === null
          ? { kind: "remove-node", before: cloneNode(patch.after), after: null }
          : { kind: "upsert-node", before: cloneNode(patch.after), after: cloneNode(patch.before) };
      case "remove-node":
        return { kind: "upsert-node", before: null, after: cloneNode(patch.before), at: patch.at };
      case "upsert-edge":
        return patch.before === null
          ? { kind: "remove-edge", before: cloneEdge(patch.after), after: null }
          : { kind: "upsert-edge", before: cloneEdge(patch.after), after: cloneEdge(patch.before) };
      case "remove-edge":
        return { kind: "upsert-edge", before: null, after: cloneEdge(patch.before) };
      case "reorder":
        return { kind: "reorder", before: [...patch.after], after: [...patch.before] };
      case "ink":
        // Lo stesso `at`: le toppe si disfano in ordine inverso, quindi ogni
        // tratto torna (o se ne va) dalla posizione che aveva dopo le toppe
        // prima di lui. Una toppa `ink` interrompe un gruppo di schede da
        // rimettere, come `is_insert` nel nucleo.
        return {
          kind: "ink",
          layer: cloneLayerRef(patch.layer),
          at: patch.at,
          before: patch.after ? cloneStroke(patch.after) : null,
          after: patch.before ? cloneStroke(patch.before) : null,
        };
    }
  });
  for (let start = 0; start < inverse.length;) {
    if (inverse[start].kind !== "upsert-node" || inverse[start].before !== null) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < inverse.length && inverse[end].kind === "upsert-node" && inverse[end].before === null) end++;
    const group = inverse.slice(start, end);
    group.sort((left, right) => (left.kind === "upsert-node" ? left.at ?? Infinity : Infinity)
      - (right.kind === "upsert-node" ? right.at ?? Infinity : Infinity));
    inverse.splice(start, group.length, ...group);
    start = end;
  }
  return inverse;
}

export function invertCanvasOperation(operation: CanvasOperation): CanvasOperation {
  return {
    kind: "canvas",
    patches: inverseCanvasPatches(operation.patches),
    ...invertOperation(operation),
  };
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
    patches.push({ kind: "ink", layer: cloneLayerRef(layer), at, before: cloneStroke(remaining[at]), after: null });
    remaining.splice(at, 1);
  }
  return patches;
}
