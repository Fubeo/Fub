// Il corpus delle forme dal tratto: ogni tratto dei disegni di
// `__fixtures__/ink-shapes/` dà la forma che il suo nome dice, e nessun
// tratto di scrittura, tenuto fermo alla fine, diventa una forma. I disegni
// sintetici sono quelli del generatore (`recognize-corpus.ts`).

import { describe, expect, it } from "vitest";
import { decodeInk, inkLength, inkPoint } from "../ink/codec";
import { apply, compose, IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { readScene } from "../scene/read";
import { elements, text } from "../scene/test-support";
import { transform } from "../scene/values";
import { heldShape, recognize, starOf, type Recognized } from "./recognize";
import { EXPECTED, synthesize, SYNTHETIC, type Expected } from "./recognize-corpus";

const files = import.meta.glob("../../../__fixtures__/ink-shapes/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Il mezzo secondo di tenuta ferma alla fine di `points`, come lo registra
/// una penna a 120 Hz: il punto trema di un pixel e mezzo al più.
function held(points: readonly Point[]): Point[] {
  const [x, y] = points[points.length - 1]!;
  const still = Array.from({ length: 60 }, (_, k): Point => [x + 1.5 * Math.sin(k * 1.7), y + 1.5 * Math.cos(k * 2.3)]);
  return [...points, ...still];
}

/// Quanto trema la penna ferma, in pixel, come la conta l'editor.
const STILL = 4;

/// Il nome del file dal percorso: `…/ink-shapes/sintetico-linee.svg` è
/// `sintetico-linee`.
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, "");

/// Che cosa una forma è, con le parole del corpus.
function said(shape: Recognized | null): string {
  if (shape === null) return "nessuna";
  switch (shape.kind) {
    case "line":
      return "linea";
    case "arrow":
      return "freccia";
    case "rect":
      return "rettangolo";
    case "ellipse":
      return shape.rx === shape.ry ? "cerchio" : "ellisse";
    case "polygon":
      if (starOf(shape.points) !== null) return "stella";
      return ["triangolo", "quadrilatero", "pentagono", "esagono"][shape.points.length - 3] ?? `poligono di ${shape.points.length} lati`;
    case "regular":
      return `poligono regolare di ${shape.count} lati`;
  }
}

interface Sample {
  readonly name: string;
  readonly expected: Expected;
  /// I punti nella scena.
  readonly points: readonly Point[];
}

/// I tratti a penna di `source` che hanno per nome un risultato atteso, coi
/// punti portati nella scena attraverso i `transform` loro e dei genitori.
function strokes(source: string): Sample[] {
  const scene = readScene(source);
  const items = elements(scene);
  const head = (path: readonly number[]): string => {
    const item = items.find((other) => other.path.join(".") === path.join("."))!;
    const own = text(source, item);
    return own.slice(0, own.indexOf(">"));
  };
  const attribute = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  const out: Sample[] = [];
  for (const item of items) {
    if (item.role !== "stroke" || item.stroke?.tool !== "pen") continue;
    const expected = item.title?.trim() as Expected | undefined;
    if (expected === undefined || !EXPECTED.includes(expected)) continue;
    let matrix: Matrix = IDENTITY;
    for (let depth = 1; depth <= item.path.length; depth++) {
      const value = attribute(head(item.path.slice(0, depth)), "transform");
      if (value !== null) matrix = compose(matrix, transform(value) ?? IDENTITY);
    }
    const ink = decodeInk(attribute(head(item.path), "fub:ink")!);
    const points: Point[] = [];
    for (let i = 0; i < inkLength(ink); i++) points.push(apply(matrix, inkPoint(ink, i)));
    out.push({ name: `${item.id ?? item.path.join(".")} (${expected})`, expected, points });
  }
  return out;
}

describe("il corpus delle forme dal tratto", () => {
  it.each(SYNTHETIC)("sintetico-%s.svg è quello del generatore", async (name) => {
    await expect(synthesize(name)).toMatchFileSnapshot(`../../../__fixtures__/ink-shapes/sintetico-${name}.svg`);
  });

  it("ha ogni risultato atteso, e soltanto disegni che si leggono", () => {
    const seen = new Set<Expected>();
    for (const [path, source] of Object.entries(files)) {
      const scene = readScene(source);
      expect(scene.diagnostics.filter((d) => d.severity === "error"), nameOf(path)).toEqual([]);
      for (const stroke of strokes(source)) seen.add(stroke.expected);
    }
    expect([...seen].sort()).toEqual([...EXPECTED].sort());
  });

  it.each(Object.keys(files).map(nameOf))("%s: ogni tratto dà la forma del suo nome", (name) => {
    const source = Object.entries(files).find(([path]) => nameOf(path) === name)![1];
    const wrong: string[] = [];
    for (const stroke of strokes(source)) {
      // La scrittura, tenuta ferma alla fine, resta inchiostro; una forma
      // si riconosce tenuta ferma e col comando.
      if (stroke.expected === "scrittura") {
        const shape = heldShape(held(stroke.points), 1, STILL);
        if (shape !== null) wrong.push(`${stroke.name}: ${said(shape)}`);
        continue;
      }
      const got = said(recognize(stroke.points));
      const still = said(heldShape(held(stroke.points), 1, STILL));
      if (got !== stroke.expected || still !== stroke.expected) wrong.push(`${stroke.name}: ${got}, tenuto ${still}`);
    }
    expect(wrong).toEqual([]);
  });
});
