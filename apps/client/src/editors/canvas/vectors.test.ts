// I vettori delle toppe sul testo (`src/__fixtures__/canvas-patches/`),
// scritti a mano: la stessa cartella che
// `crates/fub-canvas-core/tests/patch_vectors.rs` fa girare contro il nucleo
// Rust. Ogni vettore dà il testo grezzo di prima, le toppe e l'esito: per un
// commit riuscito il testo di dopo e quello dell'annulla (le toppe inverse sul
// testo di dopo; se manca, è quello di prima), per un rifiuto la ragione
// (`CommitError::reason`). Così Rust e TypeScript scrivono gli stessi byte
// (`docs/reference/canvas-format.md` § «Parità»).
//
// I file si leggono grezzi (`?raw`) e si decodificano qui: l'import JSON di
// Vite farebbe di una chiave `__proto__` il prototipo dell'oggetto.
import { describe, expect, it } from "vitest";
import { parseCanvas } from "./model";
import { canvasCommitOutcome, commitCanvasPatches, invertCanvasOperation, type CanvasPatch } from "./operation";

const MIN_VECTORS = 30;

const files = import.meta.glob("../../__fixtures__/canvas-patches/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly before: string;
  readonly patches: readonly CanvasPatch[];
  readonly expect: {
    readonly outcome: "applied" | "rejected";
    readonly text?: string;
    readonly undo?: string;
    readonly reason?: string;
  };
}

/** I vettori in ordine di nome; un file che non si legge fa fallire il test. */
function readVectors(): [string, Vector][] {
  return Object.keys(files).sort().map((path) => {
    const file = path.slice(path.lastIndexOf("/") + 1);
    if (!file.endsWith(".json")) throw new Error(`${file}: nella cartella solo vettori .json`);
    try {
      return [file, JSON.parse(files[path]) as Vector];
    } catch (error) {
      throw new Error(`${file}: ${String(error)}`);
    }
  });
}

/** Fa girare un vettore: una stringa dice dove il TypeScript non dà ciò che il vettore si aspetta. */
function run(vector: Vector): string | null {
  const doc = parseCanvas(vector.before);
  const outcome = canvasCommitOutcome(doc, vector.before, vector.patches);
  if (vector.expect.outcome === "applied") {
    if (outcome.outcome !== "applied") return `rifiutato: ${outcome.reason}`;
    if (outcome.source !== vector.expect.text) {
      return `testo di dopo\n  dato:   ${JSON.stringify(outcome.source)}\n  atteso: ${JSON.stringify(vector.expect.text)}`;
    }
    // La strada della sessione: lo stesso testo da `commitCanvasPatches`.
    const again = commitCanvasPatches(parseCanvas(vector.before), vector.before, vector.patches);
    if (again?.source !== vector.expect.text) return "commitCanvasPatches non dà lo stesso testo";
    const undo = commitCanvasPatches(doc, outcome.source, invertCanvasOperation(outcome.operation).patches);
    const expected = vector.expect.undo ?? vector.before;
    if (undo?.source !== expected) {
      return `testo dell'annulla\n  dato:   ${JSON.stringify(undo?.source)}\n  atteso: ${JSON.stringify(expected)}`;
    }
    return null;
  }
  if (vector.expect.outcome === "rejected") {
    const before = JSON.stringify(doc);
    if (outcome.outcome === "applied") return `applicato: ${JSON.stringify(outcome.source)}`;
    if (outcome.reason !== vector.expect.reason) return `ragione ${outcome.reason}, attesa ${String(vector.expect.reason)}`;
    if (JSON.stringify(doc) !== before) return "il rifiuto ha cambiato il modello";
    if (commitCanvasPatches(doc, vector.before, vector.patches) !== null) return "commitCanvasPatches non rifiuta";
    return null;
  }
  return `esito ${String(vector.expect.outcome)} sconosciuto`;
}

describe("canvas patch vectors", () => {
  it("la cartella tiene i vettori numerati", () => {
    const vectors = readVectors();
    expect(vectors.length).toBeGreaterThanOrEqual(MIN_VECTORS);
    vectors.forEach(([file, vector], index) => {
      expect(file).toBe(`${String(index + 1).padStart(2, "0")}-${vector.name}.json`);
      expect(vector.description, file).toBeTruthy();
    });
  });

  it("ogni vettore dà i byte e le ragioni attesi", () => {
    const failures = readVectors().flatMap(([file, vector]) => {
      const error = run(vector);
      return error === null ? [] : [`${file}: ${error}`];
    });
    expect(failures.join("\n")).toBe("");
  });

  it("ogni ragione che tutti e due rifiutano ha un vettore", () => {
    const reasons = new Set(readVectors().map(([, vector]) => vector.expect.reason));
    for (const reason of ["stale", "invalid", "rejected"]) expect(reasons.has(reason), reason).toBe(true);
  });

  it("un vettore cambiato di un byte fallisce", () => {
    let mutated = 0;
    for (const [file, vector] of readVectors()) {
      for (const key of ["text", "undo", "reason"] as const) {
        const original = vector.expect[key];
        if (original === undefined) continue;
        const changed = { ...vector, expect: { ...vector.expect, [key]: key === "reason" ? `${original}x` : `${original} ` } };
        expect(run(changed), `${file}: ${key}`).not.toBeNull();
        mutated++;
      }
    }
    expect(mutated).toBeGreaterThanOrEqual(MIN_VECTORS);
  });
});
