// I vettori scritti a mano attraverso il `.wasm` vero: le toppe sul testo
// (`src/__fixtures__/canvas-patches/`) e le operazioni sul modello
// (`src/__fixtures__/canvas-ops/`), le stesse cartelle che
// `crates/fub-canvas-wasm/tests/` fa girare in nativo e `../vectors.test.ts`
// contro il TypeScript. Gli stessi controlli: il testo di `preview`, il tratto
// UTF-16 di `commit` applicato al testo di prima, l'annulla; per un rifiuto la
// ragione, e la lavagna che non cambia.
//
// I file si leggono grezzi (`?raw`): l'import JSON di Vite farebbe di una
// chiave `__proto__` il prototipo dell'oggetto.
import { describe, expect, it } from "vitest";
import type { CanvasPatch } from "../operation";
import { CanvasCoreError, openCore, type CanvasCore, type CanvasIntentOp, type CanvasSourceEdit } from "./core";

const MIN_PATCH_VECTORS = 30;
const MIN_OP_VECTORS = 20;

const patchFiles = import.meta.glob("../../../__fixtures__/canvas-patches/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const opFiles = import.meta.glob("../../../__fixtures__/canvas-ops/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface PatchVector {
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

interface OpVector {
  readonly about: string;
  readonly before: unknown;
  readonly seed?: number;
  readonly ops: readonly CanvasIntentOp[];
  readonly expect: {
    readonly outcome: "applied" | "rejected" | "malformed";
    readonly after?: unknown;
    readonly created?: readonly string[];
    readonly error?: Readonly<Record<string, unknown>>;
  };
}

/** I vettori di una cartella in ordine di nome; un file che non si legge fa fallire il test. */
function read<T>(files: Record<string, string>): [string, T][] {
  return Object.keys(files).sort().map((path) => {
    const file = path.slice(path.lastIndexOf("/") + 1);
    if (!file.endsWith(".json")) throw new Error(`${file}: nella cartella solo vettori .json`);
    try {
      return [file, JSON.parse(files[path]!) as T];
    } catch (error) {
      throw new Error(`${file}: ${String(error)}`);
    }
  });
}

/** Il tratto applicato al testo di prima come stringa UTF-16, come fa la sessione. */
function applyEdit(before: string, edit: CanvasSourceEdit): string {
  if (!(edit.start <= edit.end && edit.end <= before.length)) throw new Error(`tratto ${JSON.stringify(edit)} fuori da ${before.length} unità`);
  return before.slice(0, edit.start) + edit.text + before.slice(edit.end);
}

/** L'errore di una chiamata, o `null` se è riuscita. */
function failure(work: () => unknown): CanvasCoreError | null {
  try {
    work();
    return null;
  } catch (error) {
    if (error instanceof CanvasCoreError) return error;
    throw error;
  }
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

/** Fa girare un vettore delle toppe: una stringa dice dove il `.wasm` non dà ciò che il vettore si aspetta. */
async function runPatches(vector: PatchVector): Promise<string | null> {
  let core: CanvasCore;
  try {
    core = await openCore(vector.before);
  } catch (error) {
    return `before non si apre: ${String(error)}`;
  }
  try {
    if (vector.expect.outcome === "applied") {
      const expected = vector.expect.text;
      const preview = core.preview(vector.patches);
      if (preview !== expected) return `testo di preview\n  dato:   ${show(preview)}\n  atteso: ${show(expected)}`;
      if (core.preview(vector.patches) !== expected) return "preview ha cambiato la lavagna";
      const committed = core.commit(vector.patches);
      const after = applyEdit(vector.before, committed.edit);
      if (after !== expected) return `il tratto ${show(committed.edit)} dà\n  ${show(after)}\n  atteso: ${show(expected)}`;
      const undo = vector.expect.undo ?? vector.before;
      const undoPreview = core.preview(committed.inverse);
      if (undoPreview !== undo) return `preview dell'annulla\n  dato:   ${show(undoPreview)}\n  atteso: ${show(undo)}`;
      const undone = core.commit(committed.inverse);
      const back = applyEdit(after, undone.edit);
      if (back !== undo) return `testo dell'annulla\n  dato:   ${show(back)}\n  atteso: ${show(undo)}`;
      return null;
    }
    if (vector.expect.outcome === "rejected") {
      const model = show(core.model());
      const reason = vector.expect.reason;
      const previewError = failure(() => core.preview(vector.patches));
      if (previewError?.code !== reason) return `preview: ${previewError ? `ragione ${previewError.code}` : "applicato"}, attesa ${String(reason)}`;
      const commitError = failure(() => core.commit(vector.patches));
      if (commitError?.code !== reason) return `commit: ${commitError ? `ragione ${commitError.code}` : "applicato"}, attesa ${String(reason)}`;
      if (!commitError?.message) return "l'errore non ha un messaggio";
      if (show(core.model()) !== model) return "il rifiuto ha cambiato la lavagna";
      return null;
    }
    return `esito ${String(vector.expect.outcome)} sconosciuto`;
  } catch (error) {
    return `errore inatteso: ${String(error)}`;
  } finally {
    core.close();
  }
}

/** Fa girare un vettore delle operazioni. */
async function runOps(vector: OpVector): Promise<string | null> {
  const beforeText = JSON.stringify(vector.before);
  const core = await openCore(beforeText);
  try {
    const opened = core.model();
    const expect = vector.expect;
    const error = failure(() => core.compile(vector.ops, vector.seed));
    if (expect.outcome === "malformed") return error?.code === "request" ? null : `atteso request, dato ${error?.code ?? "applicato"}`;
    if (expect.outcome === "rejected") {
      if (error?.code !== "op") return `atteso op, dato ${error?.code ?? "applicato"}`;
      for (const [key, value] of Object.entries(expect.error ?? {})) {
        if (show(error.details[key]) !== show(value)) return `error.${key}: ${show(error.details[key])}, atteso ${show(value)}`;
      }
      return null;
    }
    if (expect.outcome !== "applied") return `esito ${String(expect.outcome)} sconosciuto`;
    if (error) return `non si compila: ${error.code} ${error.message}`;
    const compiled = core.compile(vector.ops, vector.seed);
    if (expect.created && show(compiled.created) !== show(expect.created)) {
      return `id creati ${show(compiled.created)}, attesi ${show(expect.created)}`;
    }
    const afterText = core.preview(compiled.patches);
    const committed = core.commit(compiled.patches);
    if (applyEdit(beforeText, committed.edit) !== afterText) return `il tratto ${show(committed.edit)} non dà il testo di preview`;
    // Il modello atteso letto dallo stesso nucleo: lo stesso valore JSON, R9.
    const expectedCore = await openCore(JSON.stringify(expect.after));
    const expected = expectedCore.model();
    expectedCore.close();
    const model = core.model();
    if (show(normalize(model)) !== show(normalize(expected))) return `il modello di dopo\n  ${show(model)}\n  atteso: ${show(expected)}`;
    const reopened = await openCore(afterText);
    const again = reopened.model();
    reopened.close();
    if (show(normalize(again)) !== show(normalize(expected))) return "il testo di dopo, riaperto, non dà il modello atteso";
    core.commit(committed.inverse);
    if (show(normalize(core.model().nodes)) !== show(normalize(opened.nodes))) return "l'annulla non ridà le schede di prima";
    return null;
  } catch (error) {
    return `errore inatteso: ${String(error)}`;
  } finally {
    core.close();
  }
}

/** Un valore JSON con le chiavi in ordine: lo stesso valore, scritto allo stesso modo. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

describe("i vettori attraverso il .wasm", () => {
  it("le cartelle tengono i vettori", () => {
    const patches = read<PatchVector>(patchFiles);
    expect(patches.length).toBeGreaterThanOrEqual(MIN_PATCH_VECTORS);
    patches.forEach(([file, vector], index) => {
      expect(file).toBe(`${String(index + 1).padStart(2, "0")}-${vector.name}.json`);
      expect(vector.description, file).toBeTruthy();
    });
    const ops = read<OpVector>(opFiles);
    expect(ops.length).toBeGreaterThanOrEqual(MIN_OP_VECTORS);
    for (const [file, vector] of ops) expect(vector.about, file).toBeTruthy();
  });

  it("ogni vettore delle toppe dà il testo, il tratto e la ragione attesi", async () => {
    const failures: string[] = [];
    for (const [file, vector] of read<PatchVector>(patchFiles)) {
      const error = await runPatches(vector);
      if (error !== null) failures.push(`${file}: ${error}`);
    }
    expect(failures.join("\n")).toBe("");
  });

  it("ogni vettore delle operazioni dà le toppe, gli id e l'errore attesi", async () => {
    const failures: string[] = [];
    for (const [file, vector] of read<OpVector>(opFiles)) {
      const error = await runOps(vector);
      if (error !== null) failures.push(`${file}: ${error}`);
    }
    expect(failures.join("\n")).toBe("");
  });

  it("ogni ragione del commit ha un vettore", () => {
    const reasons = new Set(read<PatchVector>(patchFiles).map(([, vector]) => vector.expect.reason));
    for (const reason of ["stale", "invalid", "rejected"]) expect(reasons.has(reason), reason).toBe(true);
  });

  it("un vettore cambiato di un byte fallisce", async () => {
    let mutated = 0;
    for (const [file, vector] of read<PatchVector>(patchFiles)) {
      for (const key of ["text", "undo", "reason"] as const) {
        const original = vector.expect[key];
        if (original === undefined) continue;
        const changed = { ...vector, expect: { ...vector.expect, [key]: key === "reason" ? `${original}x` : `${original} ` } };
        expect(await runPatches(changed), `${file}: ${key}`).not.toBeNull();
        mutated++;
      }
    }
    for (const [file, vector] of read<OpVector>(opFiles)) {
      if (vector.expect.outcome !== "applied" || !vector.expect.created?.length) continue;
      const changed = { ...vector, expect: { ...vector.expect, created: [...vector.expect.created, "x"] } };
      expect(await runOps(changed), `${file}: created`).not.toBeNull();
      mutated++;
    }
    expect(mutated).toBeGreaterThanOrEqual(MIN_PATCH_VECTORS);
  });
});
