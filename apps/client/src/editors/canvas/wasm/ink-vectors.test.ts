// I vettori dell'inchiostro della lavagna (`src/__fixtures__/canvas-ink/`)
// attraverso il `.wasm` vero: `inkLayers()` dà i livelli che il nucleo legge,
// gli stessi che danno `crates/fub-canvas-core/tests/ink_vectors.rs` e
// `crates/fub-canvas-wasm/tests/` in nativo. Le regole stanno solo nel nucleo:
// il client decodifica e disegna, e qui si prova che ogni tratto che il
// nucleo dice da disegnare il codec TypeScript lo sa decodificare. Un vettore
// che non passa si corregge nel nucleo, non nel vettore.
//
// I vettori delle toppe (`canvas-patches/*-ink-*.json`) e delle operazioni
// (`canvas-ops/*ink*.json`) che toccano l'inchiostro passano da
// `vectors.test.ts` con gli altri; qui se ne conta il numero, così uno che
// sparisce si vede.
//
// I file si leggono grezzi (`?raw`), come in `vectors.test.ts`.
import { describe, expect, it } from "vitest";
import { inkLayerStates } from "../ink-record";
import { openCore } from "./core";

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly expect: { readonly layers: readonly unknown[] };
}

/** I 28 vettori scritti a mano da T5. */
const INK_VECTORS = 28;
/** Le toppe `ink` di `canvas-patches/` (87–103). */
const INK_PATCH_VECTORS = 17;
/** Le operazioni che portano l'inchiostro con la scheda, in `canvas-ops/`. */
const INK_OP_VECTORS = 4;

const inkFiles = import.meta.glob("../../../__fixtures__/canvas-ink/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const patchFiles = import.meta.glob("../../../__fixtures__/canvas-patches/*ink*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const opFiles = import.meta.glob("../../../__fixtures__/canvas-ops/*ink*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const VECTORS = Object.entries(inkFiles)
  .map(([path, raw]) => [path.replace(/^.*\/([^/]+)\.json$/, "$1"), JSON.parse(raw) as Vector] as const)
  .sort(([a], [b]) => a.localeCompare(b));

describe("i vettori dell'inchiostro attraverso il .wasm", () => {
  it("ci sono tutti i vettori dell'inchiostro, anche quelli delle toppe e delle operazioni", () => {
    expect(VECTORS.length).toBe(INK_VECTORS);
    expect(Object.keys(patchFiles).length).toBe(INK_PATCH_VECTORS);
    expect(Object.keys(opFiles).length).toBe(INK_OP_VECTORS);
  });

  it.each(VECTORS)("%s", async (file, vector) => {
    expect(vector.name).toBe(file);
    const core = await openCore(vector.source);
    try {
      const layers = core.inkLayers();
      expect(layers).toEqual(vector.expect.layers);
      // Lo stesso testo, la stessa risposta: il nucleo non rilegge.
      expect(core.inkLayers()).toBe(layers);
      const states = inkLayerStates(core.model(), layers);
      expect(states.map((state) => state.layer)).toEqual(layers.map((layer) => layer.layer));
      for (const [index, state] of states.entries()) {
        const read = layers[index]!;
        expect(state.state).toBe(read.state);
        // Ogni tratto che il nucleo dice da disegnare si decodifica: nessun
        // `decode`, e i disegnabili sono i `drawn` del nucleo, nell'ordine.
        expect(state.strokes.map((entry) => (entry.drawn ? { id: entry.id, drawn: true } : { id: entry.id, drawn: false, reason: entry.reason })))
          .toEqual(read.strokes);
        expect(state.drawable.map((stroke) => stroke.id)).toEqual(
          read.strokes.filter((entry) => entry.drawn).map((entry) => entry.id),
        );
      }
    } finally {
      core.close();
    }
  });
});
