// Il caricatore sul `.wasm` vero (`virtual:fub-canvas-wasm`, compilato dai
// sorgenti di adesso): l'andata e il ritorno di D-1 (a), i testi che
// `TextEncoder` cambierebbe, la memoria, le chiamate dopo `close` e dopo una
// trappola. I vettori sono in `vectors.test.ts`.
import { loadCanvasWasm } from "virtual:fub-canvas-wasm";
import { describe, expect, it } from "vitest";
import type { CanvasPatch } from "../operation";
import {
  CanvasCoreError,
  canvasCoreMemoryBytes,
  createCanvasCoreRuntime,
  openCore,
  unpairedSurrogateAt,
  type CanvasCore,
  type CanvasSourceEdit,
} from "./core";

function applyEdit(before: string, edit: CanvasSourceEdit): string {
  expect(edit.start).toBeLessThanOrEqual(edit.end);
  expect(edit.end).toBeLessThanOrEqual(before.length);
  return before.slice(0, edit.start) + edit.text + before.slice(edit.end);
}

/** Una lavagna di una scheda di testo, con o senza BOM e CRLF (come `one_card` dei test di Rust). */
function oneCard(text: string, bom = false, crlf = false): string {
  const node = { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text };
  let source = JSON.stringify({ nodes: [node], edges: [] }, null, 2);
  if (crlf) source = source.replace(/\n/g, "\r\n");
  return bom ? `﻿${source}` : source;
}

/** La toppa che cambia il testo della prima scheda e la sposta. */
function retext(core: CanvasCore, text: string): CanvasPatch[] {
  const node = core.model().nodes[0]!;
  return [{ kind: "upsert-node", before: node, after: { ...node, text, x: 7 } }];
}

function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    if (error instanceof CanvasCoreError) return error.code;
    throw error;
  }
  return "nessun errore";
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CanvasCoreError) return error.code;
    throw error;
  }
  return "nessun errore";
}

/** Un nucleo a parte, con le funzioni del modulo avvolte da `wrap`. */
function runtimeWith(wrap: (exports: WebAssembly.Exports) => WebAssembly.Exports) {
  return createCanvasCoreRuntime({
    load: loadCanvasWasm,
    instantiate: async (module) => wrap((await WebAssembly.instantiate(module, {})).exports),
  });
}

describe("il nucleo della lavagna in WebAssembly", () => {
  it("il tratto UTF-16 di ogni commit, sulla stringa di prima, dà il testo di preview", async () => {
    const texts: [string, string][] = [
      ["abc", "abd"],
      ["é", "éè"],
      ["€ uno", "€ due €"],
      ["a😀b", "a😀c"],
      ["😀", "😀😀"],
      ["😀x😀", "x"],
      ["ñ€😀", "😀€ñ"],
      ["", "𝄞 chiave"],
      ["riga\r\naltra", "riga\naltra 😀"],
    ];
    let cases = 0;
    for (const bom of [false, true]) {
      for (const crlf of [false, true]) {
        for (const [old, next] of texts) {
          const source = oneCard(old, bom, crlf);
          const core = await openCore(source);
          const patches = retext(core, next);
          const preview = core.preview(patches);
          const committed = core.commit(patches);
          const after = applyEdit(source, committed.edit);
          expect(after, `${old} → ${next}, BOM ${bom}, CRLF ${crlf}`).toBe(preview);
          expect(after.startsWith("﻿")).toBe(bom);
          expect(core.model().nodes[0]!.text).toBe(next);
          const undone = core.commit(committed.inverse);
          expect(applyEdit(after, undone.edit), `l'annulla di ${old}`).toBe(source);
          core.close();
          cases++;
        }
      }
    }
    expect(cases).toBe(36);
  });

  it("un testo vuoto è una lavagna vuota, e uno di soli caratteri di quattro byte torna uguale", async () => {
    const empty = await openCore("");
    expect(empty.model()).toEqual({ nodes: [], edges: [] });
    empty.close();

    const four = "😀𝄞🀄".repeat(50);
    const source = oneCard(four, true, true);
    const core = await openCore(source);
    expect(core.model().nodes[0]!.text).toBe(four);
    expect(core.preview([])).toBe(source);
    const committed = core.commit(retext(core, `${four}😀`));
    const after = applyEdit(source, committed.edit);
    expect(after).toBe(core.preview([]));
    // Il tratto non taglia mai una coppia di surrogati.
    expect(unpairedSurrogateAt(committed.edit.text)).toBe(-1);
    expect(unpairedSurrogateAt(after.slice(0, committed.edit.start))).toBe(-1);
    core.close();
  });

  it("un surrogato spaiato è un errore utf8, mai un U+FFFD", async () => {
    // `JSON.stringify` scriverebbe `\ud83d`: il surrogato va messo nel sorgente a mano.
    for (const bad of ["\uD800", "a\uDC00b", oneCard("x@").replace("@", "\uD83D"), oneCard("@y").replace("@", "\uDE00")]) {
      expect(unpairedSurrogateAt(bad)).not.toBe(-1);
      expect(await rejectionCode(openCore(bad)), JSON.stringify(bad)).toBe("utf8");
    }
    expect(unpairedSurrogateAt("😀")).toBe(-1);
    const source = oneCard("testo");
    const core = await openCore(source);
    expect(codeOf(() => core.reset(oneCard("@").replace("@", "\uD800")))).toBe("utf8");
    // Scritto come escape `\ud800` il surrogato spaiato è un sorgente che serde rifiuta.
    expect(codeOf(() => core.reset(oneCard("\uD800")))).toBe("source");
    // Dentro una toppa `JSON.stringify` scrive `\ud800`, e il nucleo lo rifiuta.
    const patches = retext(core, "a\uD800b");
    expect(codeOf(() => core.commit(patches))).not.toBe("nessun errore");
    expect(codeOf(() => core.preview(patches))).not.toBe("nessun errore");
    // Niente è cambiato.
    expect(core.preview([])).toBe(source);
    expect(core.model().nodes[0]!.text).toBe("testo");
    expect(JSON.stringify(core.model())).not.toContain("�");
    core.close();
  });

  it("dopo close ogni chiamata è un errore handle, e close si ripete", async () => {
    const core = await openCore(oneCard("uno"));
    const patches = retext(core, "due");
    core.close();
    expect(core.closed).toBe(true);
    expect(codeOf(() => core.model())).toBe("handle");
    expect(codeOf(() => core.reset(oneCard("tre")))).toBe("handle");
    expect(codeOf(() => core.commit(patches))).toBe("handle");
    expect(codeOf(() => core.preview(patches))).toBe("handle");
    expect(codeOf(() => core.compile([]))).toBe("handle");
    expect(codeOf(() => core.nodeAt(0))).toBe("handle");
    expect(() => core.close()).not.toThrow();
  });

  it("reset, nodeAt e compile", async () => {
    const core = await openCore(oneCard("uno"));
    const source = oneCard("€😀", true, true);
    expect(core.reset(source).nodes[0]!.text).toBe("€😀");
    // Con un errore la lavagna resta com'era.
    expect(codeOf(() => core.reset("{"))).toBe("source");
    expect(core.preview([])).toBe(source);
    const inside = new TextEncoder().encode(source.slice(0, source.indexOf('"€😀"'))).length;
    expect(core.nodeAt(inside)).toBe(0);
    expect(core.nodeAt(0)).toBeNull();
    expect(core.nodeAt(2 ** 40)).toBeNull();
    expect(codeOf(() => core.nodeAt(-1))).toBe("request");
    const op = [{ op: "add_card", node: { type: "text", x: 0, y: 0, width: 1, height: 1, text: "" } }];
    const max = 18446744073709551615n;
    expect(core.compile(op, max)).toEqual(core.compile(op, max.toString()));
    expect(codeOf(() => core.compile(op, 2 ** 60))).toBe("request");
    expect(codeOf(() => core.compile([{ op: "fly" }]))).toBe("request");
    const compiled = core.compile(op, 7);
    expect(compiled.created).toHaveLength(1);
    core.commit(compiled.patches);
    expect(core.model().nodes).toHaveLength(2);
    core.close();
  });

  it("un rifiuto del commit porta la ragione, e la lavagna non cambia", async () => {
    const source = oneCard("uno");
    const core = await openCore(source);
    const node = core.model().nodes[0]!;
    const stale: CanvasPatch[] = [{ kind: "upsert-node", before: { ...node, text: "altro" }, after: { ...node, x: 1 } }];
    expect(codeOf(() => core.commit(stale))).toBe("stale");
    const invalid: CanvasPatch[] = [{ kind: "upsert-node", before: node, after: { ...node, width: 0 } }];
    expect(codeOf(() => core.commit(invalid))).toBe("invalid");
    expect(core.preview([])).toBe(source);
    core.close();
  });

  it("dopo 10 000 giri di openCore, commit e close la memoria non cresce oltre il primo centinaio", async () => {
    const source = oneCard("😀 giro €", true, true);
    let afterHundred = 0;
    for (let round = 1; round <= 10_000; round++) {
      const core = await openCore(source);
      core.commit(retext(core, `giro ${round} 😀`));
      core.close();
      if (round === 100) afterHundred = canvasCoreMemoryBytes() ?? 0;
    }
    expect(afterHundred).toBeGreaterThan(0);
    expect(canvasCoreMemoryBytes()).toBeLessThanOrEqual(afterHundred);
  }, 120_000);

  it("ogni buffer chiesto a fub_alloc torna a fub_free, anche quando la chiamata fallisce", async () => {
    const live = new Map<number, number>();
    const runtime = runtimeWith((exports) => {
      const alloc = exports.fub_alloc as (len: number) => number;
      const free = exports.fub_free as (ptr: number, len: number) => void;
      return {
        ...exports,
        fub_alloc: (len: number) => {
          const ptr = alloc(len);
          live.set(ptr, len);
          return ptr;
        },
        fub_free: (ptr: number, len: number) => {
          expect(live.get(ptr)).toBe(len);
          live.delete(ptr);
          free(ptr, len);
        },
      };
    });
    const core = await runtime.openCore(oneCard("uno"));
    core.commit(retext(core, "due"));
    expect(codeOf(() => core.commit([{ kind: "reorder", before: ["x"], after: ["y"] }]))).not.toBe("nessun errore");
    expect(codeOf(() => core.reset("{"))).toBe("source");
    expect(codeOf(() => core.compile([{ op: "fly" }]))).toBe("request");
    expect(await rejectionCode(runtime.openCore("[]"))).toBe("source");
    core.preview([]);
    core.close();
    expect([...live]).toEqual([]);
  });

  it("le viste della memoria si rifanno quando la memoria cresce", async () => {
    const runtime = createCanvasCoreRuntime({ load: loadCanvasWasm });
    const small = await runtime.openCore(oneCard("piccola"));
    const before = runtime.memoryBytes()!;
    // Un sorgente di 8 MiB (16 schede da mezzo MiB: il limite di una scheda è
    // 1 MiB) fa crescere la memoria a metà delle chiamate.
    const long = "ü".repeat(256 * 1024);
    const nodes = Array.from({ length: 16 }, (_, index) => ({ id: `n${index}`, type: "text", x: 0, y: 0, width: 10, height: 10, text: long }));
    const source = `\uFEFF${JSON.stringify({ nodes, edges: [] }, null, 2)}`;
    const big = await runtime.openCore(source);
    expect(runtime.memoryBytes()!).toBeGreaterThan(before);
    const committed = big.commit(retext(big, `${long}!`));
    expect(applyEdit(source, committed.edit)).toBe(big.preview([]));
    expect(small.preview([])).toBe(oneCard("piccola"));
    big.close();
    small.close();
  });

  it("una trappola uccide l'istanza; openCore ne fa una nuova, e un handle vecchio non la raggiunge", async () => {
    let trapNext = false;
    const runtime = runtimeWith((exports) => {
      const commit = exports.canvas_commit as (h: number, p: number, l: number) => number;
      return {
        ...exports,
        canvas_commit: (handle: number, ptr: number, len: number) => {
          if (trapNext) {
            trapNext = false;
            throw new WebAssembly.RuntimeError("unreachable");
          }
          return commit(handle, ptr, len);
        },
      };
    });
    const first = await runtime.openCore(oneCard("uno"));
    const second = await runtime.openCore(oneCard("due"));
    trapNext = true;
    expect(codeOf(() => first.commit(retext(first, "x")))).toBe("trap");
    expect(runtime.memoryBytes()).toBeNull();
    // Tutte le lavagne dell'istanza morta rispondono trap, e close non lancia.
    expect(codeOf(() => second.model())).toBe("trap");
    expect(codeOf(() => first.preview([]))).toBe("trap");
    expect(() => second.close()).not.toThrow();
    // L'istanza nuova ricomincia gli handle da 1: la lavagna vecchia non ci arriva.
    const reopened = await runtime.openCore(oneCard("uno"));
    expect(reopened.model().nodes[0]!.text).toBe("uno");
    expect(codeOf(() => first.model())).toBe("trap");
    reopened.commit(retext(reopened, "di nuovo"));
    expect(reopened.model().nodes[0]!.text).toBe("di nuovo");
    first.close();
    reopened.close();
  });

  it("un modulo che non si carica è un errore load, e si riprova", async () => {
    let attempts = 0;
    const runtime = createCanvasCoreRuntime({
      load: async () => {
        attempts++;
        if (attempts === 1) throw new Error("rete giù");
        return loadCanvasWasm();
      },
    });
    expect(await rejectionCode(runtime.openCore(""))).toBe("load");
    const core = await runtime.openCore("");
    expect(core.model()).toEqual({ nodes: [], edges: [] });
    core.close();
    expect(attempts).toBe(2);
  });

  // I due rischi che T13 ha lasciato, visti dalla shell.

  it("rischio: un intero oltre 2^53 in un campo sconosciuto arriva arrotondato al modello di JavaScript", async () => {
    const source = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"t","fub:big":9007199254740993}],"edges":[]}';
    const core = await openCore(source);
    const node = core.model().nodes[0]!;
    // JSON.parse arrotonda: il valore del file è 9007199254740993.
    expect(node["fub:big"]).toBe(9007199254740992);
    // Il sorgente resta esatto: il nucleo tiene il suo valore, non quello di JavaScript.
    expect(core.preview([])).toBe(source);
    // Una toppa scritta dal modello arrotondato passa: il nucleo confronta i
    // numeri come f64 (R9), quindi 9007199254740992 e 9007199254740993 sono
    // lo stesso valore, e un `before` stantio su quel campo non si vede.
    const moved: CanvasPatch[] = [{ kind: "upsert-node", before: node, after: { ...node, x: 5 } }];
    const committed = core.commit(moved);
    // Il campo che la toppa non cambia resta quello del file, cifra per cifra.
    expect(applyEdit(source, committed.edit)).toBe(source.replace('"x":0', '"x":5'));
    expect(core.preview([])).toContain('"fub:big":9007199254740993');
    core.close();
  });

  it("rischio: commit([]) su un sorgente vuoto riscrive il testo intero", async () => {
    const core = await openCore("");
    const committed = core.commit([]);
    expect(committed.edit).toEqual({ start: 0, end: 0, text: '{\n  "nodes": [],\n  "edges": []\n}\n' });
    expect(committed.inverse).toEqual([]);
    core.close();
    // Su un sorgente scritto, invece, niente toppe vuol dire nessun cambio.
    const written = await openCore(oneCard("uno"));
    expect(written.commit([]).edit.text).toBe("");
    written.close();
  });
});
