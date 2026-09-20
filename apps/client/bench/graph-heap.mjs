export const HEAP_SAMPLES_PER_WINDOW = 3;

export const HEAP_STABILITY = Object.freeze({
  nodes: 10_000,
  seed: 6,
  minWindows: 16,
  warmupWindows: 8,
  measurementWindows: 8,
  maxSlopeBytesPerWindow: 65_536,
  maxMonotonicIncreases: 6,
});

const unsupported = (sample) => sample !== null && typeof sample === "object"
  ? sample
  : { status: "unsupported", reason: "JSHeapUsedSize sample is not finite" };

/**
 * Preserve the acquisition order for the report while selecting from a copy so
 * repeated samples always produce the same numeric median without mutating the
 * raw evidence.
 */
export const summarizeHeapSamples = (samples) => {
  const raw = [...samples];
  if (!raw.length) return { heapSamples: raw, heapUsed: unsupported(undefined) };
  if (!raw.every(Number.isFinite)) {
    return {
      heapSamples: raw,
      heapUsed: unsupported(raw.find((sample) => !Number.isFinite(sample))),
    };
  }
  const ordered = [...raw].sort((a, b) => a - b);
  return { heapSamples: raw, heapUsed: ordered[Math.floor(ordered.length / 2)] };
};

export const linearSlope = (values) => {
  const points = values.map((value, index) => [index + 1, value]).filter(([, y]) => Number.isFinite(y));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const denominator = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  return denominator ? points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / denominator : null;
};

export const heapStability = (config, series) => {
  const canonical = config.nodes === HEAP_STABILITY.nodes && config.seed === HEAP_STABILITY.seed;
  if (!canonical || config.soakWindows < HEAP_STABILITY.minWindows) {
    return {
      required: false,
      pass: null,
      reason: canonical
        ? `requires at least ${HEAP_STABILITY.minWindows} soak windows`
        : "only the 10k/seed-6 fixture has a hard heap oracle",
      policy: HEAP_STABILITY,
    };
  }
  if (!series.every(Number.isFinite)) {
    return {
      required: true,
      pass: false,
      reason: "heap series is incomplete after forced GC",
      policy: HEAP_STABILITY,
      measured: null,
    };
  }
  const measured = series.slice(-HEAP_STABILITY.measurementWindows);
  const slope = linearSlope(measured);
  const increases = measured.slice(1).reduce(
    (count, value, index) => count + (value > measured[index] ? 1 : 0),
    0,
  );
  const pass =
    slope !== null
    && slope <= HEAP_STABILITY.maxSlopeBytesPerWindow
    && increases <= HEAP_STABILITY.maxMonotonicIncreases;
  return {
    required: true,
    pass,
    reason: pass ? null : "tail heap did not stabilize within the hard oracle",
    policy: HEAP_STABILITY,
    measured: {
      windows: measured.length,
      series: measured,
      slopeBytesPerWindow: slope,
      monotonicIncreaseCount: increases,
    },
  };
};
