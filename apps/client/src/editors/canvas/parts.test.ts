// I vettori degli estratti (`src/__fixtures__/canvas-parts/`) sul lettore
// TypeScript: gli stessi che `crates/fub-canvas-core/tests/parts_vectors.rs`
// fa girare sul nucleo. Le lavagne si aprono col `.wasm` vero (`openCore`),
// come le apre la tela, e lo spostamento passa dalle sue operazioni.
// Un vettore che non passa si corregge nel lettore, non nel vettore.
//
// I file si leggono grezzi (`?raw`), come in `wasm/vectors.test.ts`.
import { describe, expect, it } from "vitest";
import type { CanvasNode } from "./model";
import {
  cardParts,
  nodeParts,
  partsFromValue,
  partsLayout,
  partsValue,
  readParts,
  writeParts,
  type CanvasParts,
  type PartsState,
  type PartsWrite,
} from "./parts";
import { openCore } from "./wasm/core";

/** Quanti vettori: gli stessi che conta il test di Rust. */
const READ_VECTORS = 30;
const WRITE_VECTORS = 16;

interface ReadVector {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly expect: { readonly cards: readonly unknown[] };
}

interface WriteVector {
  readonly name: string;
  readonly description: string;
  readonly file: string;
  readonly parts: Record<string, unknown>;
  readonly expect: unknown;
}

const files = import.meta.glob("../../__fixtures__/canvas-parts/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ALL = Object.entries(files)
  .map(([path, raw]) => [path.replace(/^.*\/([^/]+)\.json$/, "$1"), raw] as const)
  .sort(([a], [b]) => a.localeCompare(b));
const READS = ALL.filter(([name]) => name.startsWith("read-")).map(([name, raw]) => [name, JSON.parse(raw) as ReadVector] as const);
const WRITES = ALL.filter(([name]) => name.startsWith("write-")).map(([name, raw]) => [name, JSON.parse(raw) as WriteVector] as const);

/** Un campo letto nella forma dei vettori. */
function asVector(node: CanvasNode, read: PartsState): Record<string, unknown> {
  const shows = typeof node.subpath === "string" ? node.subpath : null;
  if (read.state === "kept") return { node: node.id, state: "kept", reason: read.reason, shows };
  const card: Record<string, unknown> = { node: node.id, state: "ok", parts: JSON.stringify(partsValue(read.parts)), shows };
  const layout = partsLayout(read.parts);
  if (layout !== null) card.layout = layout;
  return card;
}

/** Le parti di un vettore di scrittura, prese così come sono: il controllo lo fa `writeParts`. */
function chosen(value: Record<string, unknown>): CanvasParts {
  const extra = Object.fromEntries(
    Object.entries(value).filter(([key]) => !["kind", "pages", "layout", "page", "rect", "key", "sections", "rotate"].includes(key)),
  );
  return {
    ...value,
    layout: value.layout ?? null,
    key: value.key ?? null,
    rotate: value.rotate ?? null,
    extra,
  } as unknown as CanvasParts;
}

function asWritten(write: PartsWrite): unknown {
  if (write.outcome === "refused") return write;
  return { outcome: "written", subpath: write.subpath, parts: write.parts === null ? null : JSON.stringify(write.parts) };
}

describe("i vettori degli estratti", () => {
  it("ci sono tutti, e solo read-* e write-*", () => {
    expect(READS.length).toBe(READ_VECTORS);
    expect(WRITES.length).toBe(WRITE_VECTORS);
    expect(ALL.length).toBe(READ_VECTORS + WRITE_VECTORS);
  });

  it.each(READS)("%s", async (file, vector) => {
    expect(vector.name).toBe(file);
    const core = await openCore(vector.source);
    try {
      const nodes = core.model().nodes;
      const reads = readParts(nodes);
      const byId = new Map(nodes.map((node) => [node.id, node]));
      expect(reads.map(({ node, read }) => asVector(byId.get(node)!, read))).toEqual(vector.expect.cards);
      for (const { node: id, read } of reads) {
        const node = byId.get(id)!;
        if (read.state === "ok") {
          // Il giro: il campo riscritto dà gli stessi byte del campo del file.
          expect(JSON.stringify(partsValue(read.parts))).toBe(JSON.stringify(node["fub:parts"]));
          expect(cardParts(node)).toEqual(read.parts);
        } else {
          expect(cardParts(node)).toBeNull();
        }
        // Spostare la scheda non tocca un byte del suo campo.
        const index = nodes.findIndex((card) => card.id === id);
        const keyAt = keyOffsets(vector.source).find((at) => core.nodeAt(utf8Length(vector.source.slice(0, at))) === index);
        expect(keyAt).toBeDefined();
        const { patches } = core.compile([{ op: "move", ids: [id], dx: 40, dy: 0 }]);
        const { edit } = core.commit(patches);
        expect(edit.end).toBeLessThanOrEqual(keyAt!);
        const moved = core.model().nodes[index]!;
        expect(moved.x).toBe(node.x + 40);
        expect(nodeParts(moved)).toEqual(read);
        // Torna com'era per la scheda dopo.
        core.reset(vector.source);
      }
    } finally {
      core.close();
    }
  });

  it.each(WRITES)("%s", (file, vector) => {
    expect(vector.name).toBe(file);
    expect(asWritten(writeParts(vector.file, chosen(vector.parts)))).toEqual(vector.expect);
  });
});

describe("fub:parts sconosciuto", () => {
  it("una specie futura torna identica dopo uno spostamento, e cambia solo x", async () => {
    const before =
      '{\n  "nodes": [\n' +
      '    { "id": "n1", "type": "file", "file": "Conti.xlsx", "subpath": "#Foglio1", "x": 0, "y": 0, "width": 400, "height": 500,\n' +
      '      "fub:parts": { "kind": "cells", "sheet": "Foglio1", "range": "A1:C9", "zoom": 1.50 } }\n' +
      '  ],\n  "edges": []\n}\n';
    const core = await openCore(before);
    try {
      expect(nodeParts(core.model().nodes[0]!)).toEqual({ state: "kept", reason: "kind" });
      const { patches } = core.compile([{ op: "move", ids: ["n1"], dx: 40, dy: 0 }]);
      const { edit } = core.commit(patches);
      const after = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
      expect(after).toBe(before.replace('"x": 0', '"x": 40'));
    } finally {
      core.close();
    }
  });
});

describe("la scrittura controlla come la lettura", () => {
  it("rifiuta i campi che non valgono e quelli sconosciuti col nome di uno noto", () => {
    const flat: CanvasParts = { kind: "image", rect: [0, 0, 0, 1], rotate: null, extra: {} };
    expect(writeParts("foto.png", flat)).toEqual({ outcome: "refused", reason: "field" });
    const empty: CanvasParts = { kind: "sections", sections: [], extra: {} };
    expect(writeParts("Nota.md", empty)).toEqual({ outcome: "refused", reason: "field" });
    const nan: CanvasParts = { kind: "image", rect: [0, 0, 1, 1], rotate: Number.NaN, extra: {} };
    expect(writeParts("foto.png", nan)).toEqual({ outcome: "refused", reason: "field" });
    const shadow: CanvasParts = { kind: "pages", pages: [1, 2], layout: null, extra: { pages: [9] } };
    expect(writeParts("Libro.pdf", shadow)).toEqual({ outcome: "refused", reason: "field" });
  });

  it("tiene __proto__ come una chiave qualunque, come JSON.parse", () => {
    const value: unknown = JSON.parse('{"kind":"sections","sections":["A","B"],"__proto__":{"x":1}}');
    const parts = partsFromValue(value);
    expect(typeof parts).toBe("object");
    expect(JSON.stringify(partsValue(parts as CanvasParts))).toBe('{"kind":"sections","sections":["A","B"],"__proto__":{"x":1}}');
    expect(Object.getPrototypeOf((parts as CanvasParts).extra)).toBe(Object.prototype);
  });
});

/** Gli offset (UTF-16) di ogni chiave `"fub:parts"` nel testo. */
function keyOffsets(text: string): number[] {
  const out: number[] = [];
  for (let at = text.indexOf('"fub:parts"'); at >= 0; at = text.indexOf('"fub:parts"', at + 1)) out.push(at);
  return out;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
