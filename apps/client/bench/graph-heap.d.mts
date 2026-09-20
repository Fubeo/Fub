export type HeapUnsupported = {
  status: "unsupported";
  reason: string;
};

export type HeapSample = number | HeapUnsupported;

export type HeapSampleSummary = {
  heapSamples: HeapSample[];
  heapUsed: HeapSample;
};

export type HeapStabilityPolicy = {
  nodes: number;
  seed: number;
  minWindows: number;
  warmupWindows: number;
  measurementWindows: number;
  maxSlopeBytesPerWindow: number;
  maxMonotonicIncreases: number;
};

export type HeapStabilityResult = {
  required: boolean;
  pass: boolean | null;
  reason: string | null;
  policy: HeapStabilityPolicy;
  measured?: {
    windows: number;
    series: number[];
    slopeBytesPerWindow: number | null;
    monotonicIncreaseCount: number;
  } | null;
};

export const HEAP_SAMPLES_PER_WINDOW: 3;
export const HEAP_STABILITY: Readonly<HeapStabilityPolicy>;
export const summarizeHeapSamples: (
  samples: readonly HeapSample[],
) => HeapSampleSummary;
export const linearSlope: (values: readonly number[]) => number | null;
export const heapStability: (
  config: { nodes: number; seed: number; soakWindows: number },
  series: readonly HeapSample[],
) => HeapStabilityResult;
