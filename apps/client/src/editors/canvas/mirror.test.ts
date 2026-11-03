// L'altra metà dello specchio a caso della lavagna (la prima è
// `crates/fub-canvas-core/tests/ts_mirror.rs`). Il nucleo Rust fa fede: la
// fixture porta caso per caso la sua risposta, e la copia TypeScript deve dare
// la stessa, byte per byte: lo stesso «si apre / non si apre» da
// `parseCanvas`, lo stesso esito e la stessa ragione da `canvasCommitOutcome`,
// lo stesso testo da `commitCanvasPatches` e lo stesso annulla.
//
// Una regola cambiata in Rust rende vecchia la fixture (rosso di là);
// rigenerarla (`UPDATE_MIRROR=1 cargo test -p fub-canvas-core --test
// ts_mirror`) sposta il rosso qui, finché il TypeScript non è d'accordo. Ogni
// divergenza trovata diventa prima un vettore scritto a mano in
// `src/__fixtures__/canvas-patches/`.
//
// La fixture è un sorgente per riga: `{source, open: false}` se Rust non lo
// apre, se no `{source, runs}` con le prove fatte su di lui (anche nessuna).
// Ogni sorgente è un caso e ogni prova un altro.
//
// Un testo atteso è scritto come differenza dal testo di prima: `[p, mezzo, s]`
// sono i primi `p` e gli ultimi `s` caratteri UTF-16 di quello, con `mezzo` in
// mezzo. Il file si legge grezzo (`?raw`): l'import JSON di Vite farebbe di
// una chiave `__proto__` il prototipo dell'oggetto.
import { describe, expect, it } from "vitest";
import raw from "../../__fixtures__/canvas-mirror.json?raw";
import { parseCanvas } from "./model";
import { canvasCommitOutcome, commitCanvasPatches, invertCanvasOperation, type CanvasPatch } from "./operation";

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

const show = (text: string | undefined): string => JSON.stringify(text);

/** Il «si apre» di un sorgente: una stringa dice dove il TypeScript non è d'accordo. */
function open(group: Group): string | null {
  try {
    parseCanvas(group.source);
  } catch (error) {
    return "open" in group ? null : `non si apre: ${String(error)}`;
  }
  return "open" in group ? "si apre, Rust no" : null;
}

/** Fa girare una prova su `source`: una stringa dice dove il TypeScript non dà ciò che dà Rust. */
function run(source: string, item: Run): string | null {
  const doc = parseCanvas(source);
  const outcome = canvasCommitOutcome(doc, source, item.patches);
  if (item.outcome === "rejected") {
    if (outcome.outcome === "applied") return `applicato: ${show(outcome.source)}`;
    return outcome.reason === item.reason ? null : `ragione ${outcome.reason}, attesa ${item.reason}`;
  }
  if (outcome.outcome !== "applied") return `rifiutato: ${outcome.reason}`;
  const text = undelta(source, item.text);
  if (outcome.source !== text) return `testo di dopo\n  dato:   ${show(outcome.source)}\n  atteso: ${show(text)}`;
  // La strada della sessione: lo stesso testo da `commitCanvasPatches`.
  const again = commitCanvasPatches(parseCanvas(source), source, item.patches);
  if (again?.source !== text) return "commitCanvasPatches non dà lo stesso testo";
  const undo = canvasCommitOutcome(doc, outcome.source, invertCanvasOperation(outcome.operation).patches);
  if (typeof item.undo === "string") {
    if (undo.outcome === "applied") return `annulla applicato: ${show(undo.source)}`;
    return undo.reason === item.undo ? null : `annulla ${undo.reason}, atteso ${item.undo}`;
  }
  if (undo.outcome !== "applied") return `annulla rifiutato: ${undo.reason}`;
  const back = undelta(outcome.source, item.undo);
  return undo.source === back ? null : `testo dell'annulla\n  dato:   ${show(undo.source)}\n  atteso: ${show(back)}`;
}

describe("canvas mirror", () => {
  it("la fixture ha abbastanza casi", () => {
    expect(caseCount).toBeGreaterThanOrEqual(MIN_CASES);
  });

  it("ogni caso dà l'esito e i byte del nucleo Rust", () => {
    const failures = groups.flatMap((group, index) => {
      const where = `riga ${index + 2}`;
      const opened = open(group);
      if (opened !== null) return [`${where}: ${opened}\n  sorgente: ${show(group.source)}`];
      if (!("runs" in group)) return [];
      return group.runs.flatMap((item, at) => {
        const error = run(group.source, item);
        return error === null ? [] : [`${where}, prova ${at + 1}: ${error}\n  sorgente: ${show(group.source)}`];
      });
    });
    expect(failures.slice(0, 20).join("\n"), `${failures.length} casi diversi`).toBe("");
  });

  it("un caso cambiato di un byte fallisce", () => {
    let mutated = 0;
    for (const group of groups) {
      if (mutated >= 50) break;
      // Un sorgente che si apre detto rotto, o viceversa.
      const flipped: Group = "runs" in group ? { source: group.source, open: false } : { source: group.source, runs: [] };
      expect(open(flipped), group.source).not.toBeNull();
      if (!("runs" in group)) continue;
      for (const item of group.runs) {
        const changed: Run = item.outcome === "applied"
          ? { ...item, text: [item.text[0], `${item.text[1]} `, item.text[2]] }
          : { ...item, reason: `${item.reason}x` };
        expect(run(group.source, changed), JSON.stringify(item)).not.toBeNull();
        mutated++;
      }
    }
    expect(mutated).toBeGreaterThanOrEqual(50);
  });
});
