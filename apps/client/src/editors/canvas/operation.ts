import {
  invertOperation,
  lineFeeds,
  operationFromText,
  type TextOperation,
} from "../core/text-operation";
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
  | { readonly kind: "reorder"; readonly before: readonly string[]; readonly after: readonly string[] };

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

/** Validate every preimage on a private draft; the live graph is never partially mutated. */
function canvasDraft(doc: CanvasDocument, patches: readonly CanvasPatch[]): CanvasDocument | null {
  const draft = JSON.parse(JSON.stringify(doc)) as CanvasDocument;
  for (const patch of patches) {
    switch (patch.kind) {
      case "upsert-node": {
        const current = nodeById(draft, patch.after.id);
        if (patch.before === null ? current !== undefined
          : !current || !sameValue(current, cloneNode(patch.before))) return null;
        const index = draft.nodes.findIndex((node) => node.id === patch.after.id);
        if (index >= 0) draft.nodes[index] = cloneNode(patch.after);
        else if (patch.at !== undefined && Number.isInteger(patch.at) && patch.at >= 0 && patch.at <= draft.nodes.length) {
          draft.nodes.splice(patch.at, 0, cloneNode(patch.after));
        } else if (patch.at !== undefined) return null;
        else draft.nodes.push(cloneNode(patch.after));
        break;
      }
      case "remove-node": {
        const current = nodeById(draft, patch.before.id);
        if (!current || !sameValue(current, cloneNode(patch.before))
          || draft.edges.some((edge) => edge.fromNode === current.id || edge.toNode === current.id)) return null;
        draft.nodes = draft.nodes.filter((node) => node.id !== current.id);
        break;
      }
      case "upsert-edge": {
        const current = edgeById(draft, patch.after.id);
        if (patch.before === null ? current !== undefined
          : !current || !sameValue(current, cloneEdge(patch.before))) return null;
        if (!nodeById(draft, patch.after.fromNode) || !nodeById(draft, patch.after.toNode)) return null;
        const index = draft.edges.findIndex((edge) => edge.id === patch.after.id);
        if (index >= 0) draft.edges[index] = cloneEdge(patch.after);
        else draft.edges.push(cloneEdge(patch.after));
        break;
      }
      case "remove-edge": {
        const current = edgeById(draft, patch.before.id);
        if (!current || !sameValue(current, cloneEdge(patch.before))) return null;
        draft.edges = draft.edges.filter((edge) => edge.id !== current.id);
        break;
      }
      case "reorder": {
        const current = draft.nodes.map((node) => node.id);
        if (!sameValue(current, [...patch.before])
          || !sameValue([...patch.after].sort(), [...current].sort())) return null;
        const byId = new Map(draft.nodes.map((node) => [node.id, node]));
        draft.nodes = patch.after.map((id) => byId.get(id)!).filter(Boolean);
        break;
      }
    }
  }
  return draft;
}

export function applyCanvasPatches(doc: CanvasDocument, patches: readonly CanvasPatch[]): boolean {
  const draft = canvasDraft(doc, patches);
  if (!draft) return false;
  doc.nodes = draft.nodes;
  doc.edges = draft.edges;
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
  const draft = canvasDraft(doc, patches);
  if (!draft) return { outcome: "rejected", reason: "stale" };
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
  doc.nodes = draft.nodes;
  doc.edges = draft.edges;
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
