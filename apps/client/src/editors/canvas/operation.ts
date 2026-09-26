import {
  invertOperation,
  operationFromText,
  type TextOperation,
} from "../core/text-operation";
import { parseCanvas, type CanvasDocument, type CanvasEdge, type CanvasNode } from "./model";
import { patchCanvasSource, sameCanvasModel } from "./source-edit";

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

function cloneNode(node: CanvasNode): CanvasNode {
  return JSON.parse(JSON.stringify(node)) as CanvasNode;
}

function cloneEdge(edge: CanvasEdge): CanvasEdge {
  return JSON.parse(JSON.stringify(edge)) as CanvasEdge;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
          : !current || !sameValue(current, patch.before)) return null;
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
        if (!current || !sameValue(current, patch.before)
          || draft.edges.some((edge) => edge.fromNode === current.id || edge.toNode === current.id)) return null;
        draft.nodes = draft.nodes.filter((node) => node.id !== current.id);
        break;
      }
      case "upsert-edge": {
        const current = edgeById(draft, patch.after.id);
        if (patch.before === null ? current !== undefined
          : !current || !sameValue(current, patch.before)) return null;
        if (!nodeById(draft, patch.after.fromNode) || !nodeById(draft, patch.after.toNode)) return null;
        const index = draft.edges.findIndex((edge) => edge.id === patch.after.id);
        if (index >= 0) draft.edges[index] = cloneEdge(patch.after);
        else draft.edges.push(cloneEdge(patch.after));
        break;
      }
      case "remove-edge": {
        const current = edgeById(draft, patch.before.id);
        if (!current || !sameValue(current, patch.before)) return null;
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

export function commitCanvasPatches(
  doc: CanvasDocument,
  beforeSource: string,
  patches: readonly CanvasPatch[],
): { readonly source: string; readonly operation: CanvasOperation } | null {
  if (!patches.length) return null;
  const draft = canvasDraft(doc, patches);
  if (!draft) return null;
  let source: string;
  try {
    const before = parseCanvas(beforeSource);
    if (!sameCanvasModel(before, doc)) return null;
    source = patchCanvasSource(beforeSource, before, draft);
    if (!sameCanvasModel(parseCanvas(source), draft)) return null;
  } catch {
    return null;
  }
  doc.nodes = draft.nodes;
  doc.edges = draft.edges;
  return {
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
      ...operationFromText(beforeSource, source),
    },
  };
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
