import { describe, expect, it } from "vitest";
import { anchorAt, strokeBounds, type Bounds } from "./anchor";
import type { CanvasNode } from "./model";
// I casi sono scritti a mano: li legge anche la copia Rust della regola
// (`crates/fub-canvas-core/src/ops/anchor.rs`, che `draw` usa con `on: "auto"`).
import cases from "../../__fixtures__/ink-anchor.json";

// La metà TypeScript dei casi dell'ancora. `anchor.ts` fa fede; il nucleo lo
// segue riga per riga. Un caso che qui passa e in Rust no (o viceversa) vuol
// dire che le due copie non danno più la stessa scheda.

/** Un numero del file: JSON non scrive `NaN` e gli infiniti, il file li scrive come stringhe. */
type FileNumber = number | "NaN" | "Infinity" | "-Infinity";

interface FileBox {
  readonly x: FileNumber;
  readonly y: FileNumber;
  readonly width: FileNumber;
  readonly height: FileNumber;
}

interface BoundsCase {
  readonly name: string;
  readonly points: readonly (readonly [FileNumber, FileNumber])[];
  readonly size: FileNumber;
  readonly expect: FileBox;
}

interface AnchorCase {
  readonly name: string;
  readonly nodes: readonly (FileBox & { readonly id: string })[];
  readonly refuse?: readonly string[];
  readonly bounds: FileBox;
  readonly expect: string | null;
}

function number(value: FileNumber): number {
  if (typeof value === "number") return value;
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  throw new Error(`numero sconosciuto: ${String(value)}`);
}

function box(value: FileBox): Bounds {
  return { x: number(value.x), y: number(value.y), width: number(value.width), height: number(value.height) };
}

const boundsCases = cases.bounds as unknown as readonly BoundsCase[];
const anchorCases = cases.anchor as unknown as readonly AnchorCase[];

describe("i casi dell'ancora (ink-anchor.json)", () => {
  it("sono abbastanza da dire qualcosa", () => {
    expect(boundsCases.length).toBeGreaterThanOrEqual(5);
    expect(anchorCases.length).toBeGreaterThanOrEqual(8);
  });

  it.each(boundsCases.map((c) => [c.name, c] as const))("strokeBounds: %s", (_name, c) => {
    const points = c.points.map(([x, y]) => ({ x: number(x), y: number(y) }));
    expect(strokeBounds(points, number(c.size))).toEqual(box(c.expect));
  });

  it.each(anchorCases.map((c) => [c.name, c] as const))("anchorAt: %s", (_name, c) => {
    const nodes: CanvasNode[] = c.nodes.map((node) => ({ id: node.id, type: "text", ...box(node) }));
    const refused = new Set(c.refuse ?? []);
    const holder = anchorAt(nodes, box(c.bounds), (node) => !refused.has(node.id));
    expect(holder?.id ?? null).toBe(c.expect);
  });
});
