// I vettori della misura e dell'allineamento del testo
// (`src/__fixtures__/canvas-text/`) sul lettore TypeScript: gli stessi che
// `crates/fub-canvas-core/tests/text_vectors.rs` fa girare sul nucleo. Le
// lavagne si aprono col `.wasm` vero (`openCore`), come le apre la tela, e lo
// spostamento passa dalle sue operazioni. Un vettore che non passa si
// corregge nel lettore, non nel vettore.
//
// I file si leggono grezzi (`?raw`), come in `parts.test.ts`.
import { describe, expect, it } from "vitest";
import type { CanvasNode } from "./model";
import {
  TEXT_KEY,
  nodeText,
  readText,
  textStyle,
  textValue,
  withTextStyle,
  writeText,
  type TextState,
  type TextStyle,
  type TextWrite,
} from "./text-style";
import { openCore } from "./wasm/core";

/** Quanti vettori: gli stessi che conta il test di Rust. */
const READ_VECTORS = 20;
const WRITE_VECTORS = 14;

interface ReadVector {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly expect: { readonly cards: readonly unknown[] };
}

interface WriteVector {
  readonly name: string;
  readonly description: string;
  readonly node: CanvasNode;
  readonly style: TextStyle;
  readonly expect: unknown;
}

const files = import.meta.glob("../../__fixtures__/canvas-text/*", {
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
function asVector(node: CanvasNode, read: TextState): Record<string, unknown> {
  const shown = textStyle(node);
  const card: Record<string, unknown> =
    read.state === "ok"
      ? { node: node.id, state: "ok", text: JSON.stringify(textValue(read.text)) }
      : { node: node.id, state: "kept", reason: read.reason };
  card.size = shown.size;
  card.align = shown.align;
  return card;
}

function asWritten(write: TextWrite): unknown {
  if (write.outcome === "refused") return write;
  return { outcome: "written", text: write.text === null ? null : JSON.stringify(write.text) };
}

describe("i vettori di fub:text", () => {
  it("sono quanti ne conta Rust, e ognuno ha il nome del suo file", () => {
    expect(READS).toHaveLength(READ_VECTORS);
    expect(WRITES).toHaveLength(WRITE_VECTORS);
    expect(ALL).toHaveLength(READ_VECTORS + WRITE_VECTORS);
    for (const [name, vector] of [...READS, ...WRITES]) expect(vector.name).toBe(name);
  });

  it.each(READS)("%s", async (_file, vector) => {
    const core = await openCore(vector.source);
    try {
      const nodes = core.model().nodes;
      const reads = readText(nodes);
      const byId = new Map(nodes.map((node) => [node.id, node]));
      expect(reads.map(({ node, read }) => asVector(byId.get(node)!, read))).toEqual(vector.expect.cards);
      for (const { node: id, read } of reads) {
        const node = byId.get(id)!;
        // Il giro: uguale per valore, i campi noti nel loro ordine.
        if (read.state === "ok") expect(textValue(read.text)).toEqual(node[TEXT_KEY]);
        // Spostare la scheda non tocca un byte del suo campo.
        const index = nodes.findIndex((card) => card.id === id);
        const keyAt = keyOffsets(vector.source).find((at) => core.nodeAt(utf8Length(vector.source.slice(0, at))) === index);
        expect(keyAt).toBeDefined();
        const { patches } = core.compile([{ op: "move", ids: [id], dx: 40, dy: 0 }]);
        const { edit } = core.commit(patches);
        expect(edit.end).toBeLessThanOrEqual(keyAt!);
        const moved = core.model().nodes[index]!;
        expect(moved.x).toBe(node.x + 40);
        expect(nodeText(moved)).toEqual(read);
        // Torna com'era per la scheda dopo.
        core.reset(vector.source);
      }
    } finally {
      core.close();
    }
  });

  it.each(WRITES)("%s", (_file, vector) => {
    expect(asWritten(writeText(vector.node, vector.style))).toEqual(vector.expect);
  });
});

/** Gli offset (UTF-16) di ogni chiave `"fub:text"` nel testo. */
function keyOffsets(text: string): number[] {
  const out: number[] = [];
  for (let at = text.indexOf(`"${TEXT_KEY}"`); at >= 0; at = text.indexOf(`"${TEXT_KEY}"`, at + 1)) out.push(at);
  return out;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe("withTextStyle", () => {
  const card = (extra: Record<string, unknown> = {}): CanvasNode => ({ id: "t1", type: "text", text: "nota", x: 0, y: 0, width: 300, height: 120, ...extra });

  it("scrive il campo, e tornata di serie la scheda lo perde", () => {
    const big = withTextStyle(card(), { size: "l", align: "center" });
    expect(big?.[TEXT_KEY]).toEqual({ v: 1, size: "l", align: "center" });
    const back = withTextStyle(big!, { size: "m", align: "start" });
    expect(back).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(back, TEXT_KEY)).toBe(false);
    expect(back?.text).toBe("nota");
  });

  it("non cambia una scheda che si mostra già così, nemmeno con un campo futuro", () => {
    expect(withTextStyle(card(), { size: "m", align: "start" })).toBeNull();
    expect(withTextStyle(card({ [TEXT_KEY]: { v: 2, size: "huge" } }), { size: "m", align: "start" })).toBeNull();
    expect(withTextStyle(card({ [TEXT_KEY]: { v: 1, size: "l" } }), { size: "l", align: "start" })).toBeNull();
  });

  it("un campo futuro, cambiato, si riscrive alla versione 1", () => {
    const next = withTextStyle(card({ [TEXT_KEY]: { v: 2, size: "huge" } }), { size: "s", align: "start" });
    expect(next?.[TEXT_KEY]).toEqual({ v: 1, size: "s" });
  });

  it("una scheda di file o un gruppo non cambia", () => {
    expect(withTextStyle({ id: "f1", type: "file", file: "Nota.md", x: 0, y: 0, width: 1, height: 1 }, { size: "l", align: "start" })).toBeNull();
    expect(withTextStyle({ id: "g1", type: "group", x: 0, y: 0, width: 1, height: 1 }, { size: "l", align: "start" })).toBeNull();
  });
});
