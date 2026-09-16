import type { GraphData } from "../src/graph/sim/types";

export type GraphFixtureNodeCount = 2_000 | 10_000;

export interface GraphFixture extends GraphData {
  readonly digest: string;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function assertNodeCount(
  nodeCount: number,
): asserts nodeCount is GraphFixtureNodeCount {
  if (nodeCount !== 2_000 && nodeCount !== 10_000) {
    throw new RangeError("graph fixture nodeCount must be 2000 or 10000");
  }
}

function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError(
      "graph fixture seed must be an unsigned 32-bit integer",
    );
  }
}

function seedRandom(seed: number): number {
  let value = (seed + 0x6d2b79f5) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function fnvUpdate(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** FNV-1a over an unambiguous, exact emitted node and edge order. */
export function graphFixtureDigest(
  nodes: readonly string[],
  edges: readonly { from: string; to: string }[],
): string {
  let hash = FNV_OFFSET;
  for (const id of nodes) {
    hash = fnvUpdate(hash, `n${id.length}:`);
    hash = fnvUpdate(hash, id);
  }
  for (const edge of edges) {
    hash = fnvUpdate(hash, `e${edge.from.length}:`);
    hash = fnvUpdate(hash, edge.from);
    hash = fnvUpdate(hash, `${edge.to.length}:`);
    hash = fnvUpdate(hash, edge.to);
  }
  return hash.toString(16).padStart(8, "0");
}

/** Generate a connected, deterministic, browser-safe sparse graph in O(n). */
export function generateGraphFixture(
  nodeCount: GraphFixtureNodeCount,
  seed: number,
): GraphFixture {
  assertNodeCount(nodeCount);
  assertSeed(seed);

  const prefix = `fixture-${seed.toString(16).padStart(8, "0")}-`;
  const nodes = new Array<string>(nodeCount);
  for (let i = 0; i < nodeCount; i++) nodes[i] = `${prefix}${i}`;

  const edges = new Array<{ from: string; to: string }>(nodeCount * 2);
  const maxJump = Math.floor((nodeCount - 1) / 2);
  const jump = 2 + Math.floor(seedRandom(seed) * (maxJump - 1));
  for (let i = 0; i < nodeCount; i++) {
    const next = (i + 1) % nodeCount;
    const extra = (i + jump) % nodeCount;
    edges[i * 2] = { from: nodes[i]!, to: nodes[next]! };
    edges[i * 2 + 1] = { from: nodes[i]!, to: nodes[extra]! };
  }

  return { nodes, edges, digest: graphFixtureDigest(nodes, edges) };
}
