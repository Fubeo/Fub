// La superficie legge come `fub-scene`: ogni fixture di `__fixtures__/scene/`
// letta qui dà la scena che Rust ha scritto accanto, campo per campo, e le due
// fixture grandi rigenerate qui con lo stesso seme hanno la stessa impronta,
// lo stesso riepilogo e la stessa diagnostica (`crates/fub-scene/tests/mirror.rs`).

import { describe, expect, it } from "vitest";
import { isEditable, readScene } from "./read";
import { checkLossless, decimal, dense, DENSE_SEED, facts, fnv1a, ink, INK_SEED, Mulberry32 } from "./test-support";
import { MAX_ELEMENTS } from "./read";
import generated from "../../../__fixtures__/scene/generated.json";

const sources = import.meta.glob("../../../__fixtures__/scene/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const scenes = import.meta.glob("../../../__fixtures__/scene/*.json", {
  import: "default",
  eager: true,
}) as Record<string, unknown>;

/// Il nome della fixture dal percorso: `…/scene/sparse.svg` è `sparse`.
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(svg|json)$/, "");
}

describe("le fixture di fub-scene", () => {
  it("ci sono le coppie che Rust scrive", () => {
    expect(Object.keys(sources).map(nameOf).sort()).toEqual(["boards", "connectors", "crlf-bom", "doctype", "foreign", "legend", "resources", "sparse", "styles", "swatches", "text"]);
    expect(Object.keys(scenes).map(nameOf).sort()).toEqual(["boards", "connectors", "crlf-bom", "doctype", "foreign", "generated", "legend", "resources", "sparse", "styles", "swatches", "text"]);
  });

  it("i file arrivano coi loro byte: BOM e CRLF compresi", () => {
    const crlf = Object.entries(sources).find(([path]) => nameOf(path) === "crlf-bom")![1];
    expect(crlf.charCodeAt(0)).toBe(0xfeff);
    expect(crlf).toContain("\r\n");
  });

  for (const [path, source] of Object.entries(sources)) {
    const name = nameOf(path);
    it(`${name}: la scena è quella di Rust`, () => {
      const expected = scenes[path.replace(/\.svg$/, ".json")];
      const scene = readScene(source);
      checkLossless(source, scene);
      // Il JSON toglie le chiavi assenti e i `-0`, come lo scrive serde.
      expect(JSON.parse(JSON.stringify(scene))).toEqual(expected);
    });
  }
});

describe("le fixture generate", () => {
  it("il generatore è mulberry32, e l'impronta è FNV-1a", () => {
    const rng = new Mulberry32(0);
    expect([rng.next(), rng.next(), rng.next()]).toEqual([1_144_304_738, 1_416_247, 958_946_056]);
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(decimal(12050, 2)).toBe("120.5");
    expect(decimal(-5, 2)).toBe("-0.05");
    expect(decimal(300, 2)).toBe("3");
  });

  it("dense: cinquantamila elementi, ancora modificabile, come lo legge Rust", () => {
    const source = dense(DENSE_SEED);
    expect(/^[\x00-\x7f]*$/.test(source)).toBe(true);
    const elements = source.split("<").length - source.split("</").length;
    expect(elements).toBe(MAX_ELEMENTS);
    const scene = readScene(source);
    checkLossless(source, scene);
    expect(isEditable(scene), scene.readOnly.join(", ")).toBe(true);
    const roles = (wanted: string): number =>
      scene.items.filter((item) => item.kind === "element" && item.role === wanted).length;
    expect(roles("text") > 0 && roles("group") > 0).toBe(true);
    expect(JSON.parse(JSON.stringify(facts(DENSE_SEED, source, scene)))).toEqual(generated.dense);
  }, 60_000);

  it("ink: quaranta tratti, ognuno si ridisegna, come lo legge Rust", () => {
    const [source, samples] = ink(INK_SEED);
    expect(/^[\x00-\x7f]*$/.test(source)).toBe(true);
    const scene = readScene(source);
    checkLossless(source, scene);
    expect(isEditable(scene)).toBe(true);
    expect(scene.summary.counts.strokes).toBe(40);
    expect(scene.summary.ink.samples).toBe(samples);
    for (const item of scene.items) {
      if (item.kind === "element" && item.stroke !== undefined) expect(item.stroke.redrawable, item.id ?? "").toBe(true);
    }
    expect(JSON.parse(JSON.stringify(facts(INK_SEED, source, scene)))).toEqual(generated.ink);
  }, 60_000);
});
