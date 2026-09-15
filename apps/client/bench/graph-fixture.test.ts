import { describe, expect, it } from "vitest";

import { generateGraphFixture, graphFixtureDigest } from "./graph-fixture";

const CASES = [
  { nodeCount: 2_000 as const, digest: "66fd12b7" },
  { nodeCount: 10_000 as const, digest: "62e1ed8b" },
];

function assertTopology(nodeCount: 2_000 | 10_000, seed: number): void {
  const fixture = generateGraphFixture(nodeCount, seed);
  const ids = new Set(fixture.nodes);
  expect(fixture.nodes).toHaveLength(nodeCount);
  expect(ids.size).toBe(nodeCount);
  expect(fixture.edges).toHaveLength(nodeCount * 2);
  const pairs = new Set<string>();
  for (const edge of fixture.edges) {
    expect(ids.has(edge.from)).toBe(true);
    expect(ids.has(edge.to)).toBe(true);
    expect(edge.from).not.toBe(edge.to);
    const pair =
      edge.from < edge.to
        ? `${edge.from}\0${edge.to}`
        : `${edge.to}\0${edge.from}`;
    expect(pairs.has(pair)).toBe(false);
    pairs.add(pair);
  }
  expect(pairs.size).toBe(fixture.edges.length);
}

describe("graph bench fixture", () => {
  it.each(CASES)(
    "has a stable digest for $nodeCount nodes",
    ({ nodeCount, digest }) => {
      expect(generateGraphFixture(nodeCount, 0x1234_5678).digest).toBe(digest);
    },
  );

  it("is deterministic for one seed and changes with another", () => {
    const first = generateGraphFixture(2_000, 0x1234_5678);
    const same = generateGraphFixture(2_000, 0x1234_5678);
    const different = generateGraphFixture(2_000, 0x1234_5679);
    expect(same.digest).toBe(first.digest);
    expect(different.digest).not.toBe(first.digest);
    expect(same.nodes).toEqual(first.nodes);
    expect(same.edges).toEqual(first.edges);
  });

  it("emits connected sparse topology without quadratic endpoint checks", () => {
    assertTopology(2_000, 0x1234_5678);
    assertTopology(10_000, 0x1234_5678);
  });

  it("does not share mutable payload arrays between calls", () => {
    const first = generateGraphFixture(2_000, 0x1234_5678);
    const digest = first.digest;
    first.nodes[0] = "mutated";
    first.edges[0] = { from: "mutated", to: "mutated" };
    const fresh = generateGraphFixture(2_000, 0x1234_5678);
    expect(fresh.digest).toBe(digest);
    expect(graphFixtureDigest(fresh.nodes, fresh.edges)).toBe(digest);
  });

  it("rejects unsupported sizes and invalid seeds", () => {
    expect(() => generateGraphFixture(1_000 as never, 1)).toThrow(RangeError);
    expect(() => generateGraphFixture(2_000, -1)).toThrow(RangeError);
    expect(() => generateGraphFixture(2_000, Number.NaN)).toThrow(RangeError);
    expect(() => generateGraphFixture(2_000, 0x1_0000_0000)).toThrow(
      RangeError,
    );
  });
});
