import { describe, expect, it } from "vitest";

import {
  HEAP_SAMPLES_PER_WINDOW,
  heapStability,
  summarizeHeapSamples,
} from "./graph-heap.mjs";

const CONFIG = { nodes: 10_000, seed: 6, soakWindows: 16 };
const BASE_HEAP = 2_000_000;

function stableSampleSets(): number[][] {
  return Array.from({ length: CONFIG.soakWindows }, (_, index) => {
    const jitter = [2_048, 4_096, 1_024][index % 3]!;
    return index % 2 === 0
      ? [BASE_HEAP + jitter, BASE_HEAP, BASE_HEAP - jitter]
      : [BASE_HEAP - jitter, BASE_HEAP + jitter, BASE_HEAP];
  });
}

describe("graph heap sampling", () => {
  it("keeps raw samples and chooses one deterministic median per window", () => {
    expect(HEAP_SAMPLES_PER_WINDOW).toBe(3);
    const raw = [BASE_HEAP + 4_096, BASE_HEAP - 4_096, BASE_HEAP];
    const selected = summarizeHeapSamples(raw);
    expect(selected).toEqual({ heapSamples: raw, heapUsed: BASE_HEAP });
    expect(selected.heapSamples).not.toBe(raw);
    expect(raw).toEqual([BASE_HEAP + 4_096, BASE_HEAP - 4_096, BASE_HEAP]);
  });

  it("ignores small per-window jitter but still rejects a retained-object trend", () => {
    const stableWindows = stableSampleSets().map((samples) => summarizeHeapSamples(samples));
    const stableSeries = stableWindows.map(({ heapUsed }) => heapUsed);
    const stableOracle = heapStability(CONFIG, stableSeries);

    expect(stableWindows.every(({ heapUsed }) => heapUsed === BASE_HEAP)).toBe(true);
    expect(stableOracle).toMatchObject({
      required: true,
      pass: true,
      measured: {
        windows: 8,
        series: Array(8).fill(BASE_HEAP),
        slopeBytesPerWindow: 0,
        monotonicIncreaseCount: 0,
      },
    });

    const trendSamples = Array.from({ length: CONFIG.soakWindows }, (_, index) => {
      const retained = BASE_HEAP + index * 100_000;
      return [retained + 2_048, retained - 2_048, retained];
    });
    const trendSeries = trendSamples.map((samples) => summarizeHeapSamples(samples).heapUsed);
    const trendOracle = heapStability(CONFIG, trendSeries);

    expect(trendOracle).toMatchObject({
      required: true,
      pass: false,
      reason: "tail heap did not stabilize within the hard oracle",
      policy: { maxSlopeBytesPerWindow: 65_536, maxMonotonicIncreases: 6 },
      measured: {
        windows: 8,
        series: trendSeries.slice(-8),
        slopeBytesPerWindow: 100_000,
        monotonicIncreaseCount: 7,
      },
    });
  });
});
