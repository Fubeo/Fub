// I vettori dell'inchiostro della lavagna (`src/__fixtures__/canvas-ink/`)
// contro `readInkLayers`, sul modello che dà il nucleo (`wasm/core.ts`): gli
// stessi che legge il nucleo Rust. Un vettore che
// non passa si corregge nel lettore, non nel vettore.
import { describe, expect, it } from "vitest";
import { readInkLayers, type InkLayerState } from "./ink-record";
import { openCore } from "./wasm/core";

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly expect: { readonly layers: readonly unknown[] };
}

const FILES = import.meta.glob("../../__fixtures__/canvas-ink/*.json", { import: "default", eager: true }) as Record<
  string,
  Vector
>;
const VECTORS = Object.entries(FILES)
  .map(([path, vector]) => [path.replace(/^.*\/([^/]+)\.json$/, "$1"), vector] as const)
  .sort(([a], [b]) => a.localeCompare(b));

/// Un livello letto nella forma dei vettori.
function asVector(layer: InkLayerState): unknown {
  return {
    layer: layer.layer,
    state: layer.state,
    strokes: layer.strokes.map((entry) =>
      entry.drawn ? { id: entry.id, drawn: true } : { id: entry.id, drawn: false, reason: entry.reason }),
  };
}

describe("vettori dell'inchiostro della lavagna", () => {
  it("ci sono tutti i vettori", () => {
    // 28 vettori scritti a mano da T5: uno che sparisce si vede qui.
    expect(VECTORS.length).toBe(28);
  });

  it.each(VECTORS)("%s", async (file, vector) => {
    expect(vector.name).toBe(file);
    const core = await openCore(vector.source);
    let layers: InkLayerState[];
    try {
      layers = readInkLayers(core.model());
    } finally {
      core.close();
    }
    expect(layers.map(asVector)).toEqual(vector.expect.layers);
    for (const layer of layers) {
      // I tratti disegnabili sono quelli `drawn`, nello stesso ordine.
      expect(layer.drawable.map((stroke) => stroke.id)).toEqual(
        layer.strokes.filter((entry) => entry.drawn).map((entry) => entry.id),
      );
    }
  });
});
