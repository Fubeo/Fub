// L'altra metà dello specchio a caso della lavagna (la prima è
// `crates/fub-canvas-core/tests/ts_mirror.rs`). Il nucleo nativo fa fede: la
// fixture porta caso per caso la sua risposta, e lo stesso nucleo compilato
// in WebAssembly (`crates/fub-canvas-wasm`, a 32 bit, con un altro
// allocatore) deve dare la stessa, byte per byte: lo stesso «si apre / non si
// apre» da `openCore`, lo stesso esito e la stessa ragione da `preview` e
// `commit`, lo stesso testo e lo stesso annulla.
//
// Una regola cambiata in Rust rende vecchia la fixture (rosso di là);
// rigenerarla (`UPDATE_MIRROR=1 cargo test -p fub-canvas-core --test
// ts_mirror`) la riallinea. Un caso che qui dà un'altra risposta è una
// divergenza della build a 32 bit, e diventa prima un vettore scritto a mano
// in `src/__fixtures__/canvas-patches/`.
//
// La fixture è un sorgente per riga: `{source, open: false}` se il nucleo non
// lo apre, se no `{source, runs}` con le prove fatte su di lui (anche
// nessuna). Ogni sorgente è un caso e ogni prova un altro.
//
// Un testo atteso è scritto come differenza dal testo di prima: `[p, mezzo, s]`
// sono i primi `p` e gli ultimi `s` caratteri UTF-16 di quello, con `mezzo` in
// mezzo. Il file si legge grezzo (`?raw`): l'import JSON di Vite farebbe di
// una chiave `__proto__` il prototipo dell'oggetto.
import { describe, expect, it } from "vitest";
import raw from "../../../__fixtures__/canvas-mirror.json?raw";
import type { CanvasPatch } from "../operation";
import { CanvasCoreError, openCore, type CanvasCore, type CanvasSourceEdit } from "./core";

const MIN_CASES = 2000;

type Delta = readonly [number, string, number];

type Run =
  | {
    readonly patches: readonly CanvasPatch[];
    readonly outcome: "applied";
    readonly text: Delta;
    readonly undo: Delta | string;
  }
  | { readonly patches: readonly CanvasPatch[]; readonly outcome: "rejected"; readonly reason: string };

type Group =
  | { readonly source: string; readonly open: false }
  | { readonly source: string; readonly runs: readonly Run[] };

const groups = JSON.parse(raw) as Group[];
const caseCount = groups.reduce((n, group) => n + 1 + ("runs" in group ? group.runs.length : 0), 0);

function undelta(before: string, [prefix, middle, suffix]: Delta): string {
  return before.slice(0, prefix) + middle + before.slice(before.length - suffix);
}

/** Il tratto applicato al testo di prima come stringa UTF-16, come fa la sessione. */
function applyEdit(before: string, edit: CanvasSourceEdit): string {
  if (!(edit.start <= edit.end && edit.end <= before.length)) throw new Error(`tratto ${JSON.stringify(edit)} fuori da ${before.length} unità`);
  return before.slice(0, edit.start) + edit.text + before.slice(edit.end);
}

/** L'errore di una chiamata del nucleo, o `null` se è riuscita. */
function failure(work: () => unknown): CanvasCoreError | null {
  try {
    work();
    return null;
  } catch (error) {
    if (error instanceof CanvasCoreError) return error;
    throw error;
  }
}

const show = (text: string | undefined): string => JSON.stringify(text);

/** La lavagna aperta, o una stringa che dice dove il `.wasm` non è d'accordo col nucleo nativo sul «si apre». */
async function open(group: Group): Promise<CanvasCore | string | null> {
  let core: CanvasCore;
  try {
    core = await openCore(group.source);
  } catch (error) {
    if (!(error instanceof CanvasCoreError)) throw error;
    return "open" in group ? null : `non si apre: ${error.code} ${error.message}`;
  }
  if ("open" in group) {
    core.close();
    return "si apre, il nucleo nativo no";
  }
  return core;
}

/** Fa girare una prova su `source`: una stringa dice dove il `.wasm` non dà ciò che dà il nucleo nativo. */
async function run(source: string, item: Run): Promise<string | null> {
  const core = await openCore(source);
  try {
    if (item.outcome === "rejected") {
      const previewError = failure(() => core.preview(item.patches));
      if (previewError?.code !== item.reason) return `preview: ${previewError ? `ragione ${previewError.code}` : "applicato"}, attesa ${item.reason}`;
      const commitError = failure(() => core.commit(item.patches));
      return commitError?.code === item.reason ? null : `commit: ${commitError ? `ragione ${commitError.code}` : "applicato"}, attesa ${item.reason}`;
    }
    const text = undelta(source, item.text);
    let preview: string;
    try {
      preview = core.preview(item.patches);
    } catch (error) {
      return `rifiutato: ${String(error)}`;
    }
    if (preview !== text) return `testo di dopo\n  dato:   ${show(preview)}\n  atteso: ${show(text)}`;
    // La strada della sessione: lo stesso testo dal tratto di `commit`.
    const committed = core.commit(item.patches);
    const after = applyEdit(source, committed.edit);
    if (after !== text) return `il tratto ${JSON.stringify(committed.edit)} non dà lo stesso testo`;
    if (typeof item.undo === "string") {
      const undoError = failure(() => core.commit(committed.inverse));
      return undoError?.code === item.undo ? null : `annulla ${undoError ? undoError.code : "applicato"}, atteso ${item.undo}`;
    }
    let undone;
    try {
      undone = core.commit(committed.inverse);
    } catch (error) {
      return `annulla rifiutato: ${String(error)}`;
    }
    const back = applyEdit(after, undone.edit);
    const expected = undelta(after, item.undo);
    return back === expected ? null : `testo dell'annulla\n  dato:   ${show(back)}\n  atteso: ${show(expected)}`;
  } finally {
    core.close();
  }
}

/** Il caso intero: il «si apre» e ogni prova. */
async function check(group: Group): Promise<string[]> {
  const opened = await open(group);
  if (typeof opened === "string") return [opened];
  if (opened === null) return [];
  opened.close();
  if (!("runs" in group)) return [];
  const failures: string[] = [];
  for (const [at, item] of group.runs.entries()) {
    const error = await run(group.source, item);
    if (error !== null) failures.push(`prova ${at + 1}: ${error}`);
  }
  return failures;
}

describe("lo specchio attraverso il .wasm", () => {
  it("la fixture ha abbastanza casi", () => {
    expect(caseCount).toBeGreaterThanOrEqual(MIN_CASES);
  });

  it("ogni caso dà l'esito e i byte del nucleo nativo", async () => {
    const failures: string[] = [];
    for (const [index, group] of groups.entries()) {
      for (const error of await check(group)) {
        failures.push(`riga ${index + 2}: ${error}\n  sorgente: ${show(group.source)}`);
      }
    }
    expect(failures.slice(0, 20).join("\n"), `${failures.length} casi diversi`).toBe("");
  });

  it("un caso cambiato di un byte fallisce", async () => {
    let mutated = 0;
    for (const group of groups) {
      if (mutated >= 50) break;
      // Un sorgente che si apre detto rotto, o viceversa.
      const flipped: Group = "runs" in group ? { source: group.source, open: false } : { source: group.source, runs: [] };
      expect((await check(flipped)).length, group.source).toBeGreaterThan(0);
      if (!("runs" in group)) continue;
      for (const item of group.runs) {
        const changed: Run = item.outcome === "applied"
          ? { ...item, text: [item.text[0], `${item.text[1]} `, item.text[2]] }
          : { ...item, reason: `${item.reason}x` };
        expect(await run(group.source, changed), JSON.stringify(item)).not.toBeNull();
        mutated++;
      }
    }
    expect(mutated).toBeGreaterThanOrEqual(50);
  });
});
