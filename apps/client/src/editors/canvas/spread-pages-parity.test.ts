import { describe, expect, it } from "vitest";
import { t } from "../../i18n/strings";
import { bornSize, spreadLayout } from "./drop-layout";
import { parsePageRanges } from "./page-ranges";

// I vettori di `spread_pages` (`canvas-ops/spread-pages-*.json`) rifatti con le
// funzioni di «Spargi le pagine…» della GUI (T72): `parsePageRanges` sceglie
// le pagine, `bornSize("pdf", …)` le misura, `spreadLayout` le mette in fila
// accanto alla scheda e dà il gruppo oltre 12. Le schede che il nucleo fa
// nascere (`expect.after`, dopo quelle di `before`) devono essere quelle che
// la GUI farebbe, campo per campo, e nello stesso ordine: prima il gruppo, poi
// le pagine. Così le misure e i posti del codice sono quelli della tela.

type Json = Record<string, any>;

interface Vector {
  readonly about: string;
  readonly before: { readonly nodes: readonly Json[] };
  readonly ops: readonly Json[];
  readonly expect: { readonly outcome: string; readonly after?: { readonly nodes: readonly Json[] } };
}

const files = import.meta.glob("../../__fixtures__/canvas-ops/spread-pages-*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const applied: ReadonlyArray<readonly [string, Vector]> = Object.entries(files)
  .map(([path, text]): [string, Vector] => [path.slice(path.lastIndexOf("/") + 1), JSON.parse(text) as Vector])
  .filter(([, vector]) => vector.expect.outcome === "applied")
  .sort(([a], [b]) => (a < b ? -1 : 1));

/// Le pagine come le sceglie la GUI: il testo con `parsePageRanges`; una lista
/// come la darebbe il campo, in ordine e senza doppi, senza quelle oltre
/// l'ultima.
function chosenPages(pages: unknown, count: number): readonly number[] {
  if (Array.isArray(pages)) {
    return [...new Set(pages.map(Number))].filter((page) => page <= count).sort((a, b) => a - b);
  }
  const ranges = parsePageRanges(typeof pages === "string" ? pages : "", count);
  if (!ranges.ok) throw new Error(`la GUI non legge le pagine ${JSON.stringify(pages)}`);
  return ranges.pages;
}

/// Una scheda senza l'id, che viene dal seme del nucleo e da `newNodeId` nella GUI.
function withoutId(node: Json): Json {
  const { id: _id, ...rest } = node;
  return rest;
}

describe("spread_pages come «Spargi le pagine…» della GUI", () => {
  it("ci sono i vettori", () => {
    expect(applied.length).toBeGreaterThanOrEqual(4);
  });

  for (const [name, vector] of applied) {
    it(name, () => {
      expect(vector.ops).toHaveLength(1);
      const op = vector.ops[0]!;
      const beside = vector.before.nodes.find((node) => node.id === op.id)!;
      const path = String(beside.file).split("#")[0]!;
      const pages = chosenPages(op.pages, op.page_count);
      const sizes: readonly (readonly number[])[] = op.page_sizes ?? [];
      const measured = pages.map((page) => {
        const size = sizes[page - 1];
        return size ? { width: size[0]!, height: size[1]! } : undefined;
      });
      const layout = spreadLayout(pages.map((_, index) => bornSize("pdf", measured[index])), {
        x: beside.x,
        y: beside.y,
        width: beside.width,
        height: beside.height,
      });
      const gui: Json[] = [];
      if (layout.group) {
        const label = op.label ?? t("canvas.spread.group", { count: String(pages.length) });
        gui.push({ type: "group", ...layout.group, label });
      }
      pages.forEach((page, index) => {
        gui.push({ type: "file", ...layout.rects[index]!, file: path, subpath: `#page=${page}` });
      });
      const born = vector.expect.after!.nodes.slice(vector.before.nodes.length).map(withoutId);
      expect(born).toEqual(gui);
    });
  }
});
