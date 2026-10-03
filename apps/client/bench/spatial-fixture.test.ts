import { describe, expect, it } from "vitest";

import { load } from "../src/editors/spatial/scene/test-support";
import { CORPUS } from "./corpus";
import { generateSpatialFixture, SPATIAL_FIXTURE_KINDS, textDigest, type SpatialFixtureKind } from "./spatial-fixture";
// Ciò che `spatial-scale.mjs` si aspetta di aprire: se il generatore cambia,
// i numeri di prima non si confrontano più, e questo test lo dice.
import { SPATIAL_ORACLES as ORACLES } from "./spatial-oracles.mjs";

describe("le fixture del disegno", () => {
  it.each(SPATIAL_FIXTURE_KINDS)("%s è sempre la stessa", (kind) => {
    const fixture = generateSpatialFixture(kind);
    const { objects, layers, samples, bytes, digest } = fixture;
    expect({ objects, layers, samples, bytes, digest }).toEqual(ORACLES[kind]);
    expect(textDigest(fixture.text)).toBe(digest);
  }, 60_000);

  it.each(SPATIAL_FIXTURE_KINDS)("%s si legge come l'editor l'ha scritta, senza perdite", (kind) => {
    const fixture = generateSpatialFixture(kind);
    const scene = load(fixture.text);
    // Soltanto il contrasto dei tratti nei tre colori chiari della tavolozza,
    // che la barra offre e un disegno vero usa.
    expect(new Set(scene.diagnostics.map((d) => `${d.code} ${d.severity}`))).toEqual(new Set(["S009 info"]));
    const tags = new Map<string, number>();
    for (const item of scene.items) if (item.kind === "element") tags.set(item.role, (tags.get(item.role) ?? 0) + 1);
    expect(tags.get("layer")).toBe(fixture.layers);
    const drawn = [...tags].filter(([role]) => role !== "layer" && role !== "paper" && role !== "title").reduce((sum, [, n]) => sum + n, 0);
    expect(drawn).toBe(fixture.objects);
    expect(scene.items.some((item) => item.kind === "foreign")).toBe(false);
  }, 60_000);

  it("il denso pesa almeno 5 MB, il disegno che il budget di apertura chiede", () => {
    expect(ORACLES.dense.bytes).toBeGreaterThanOrEqual(5_000_000);
  });

  it("l'inchiostro ha 2 000 tratti da 100 campioni con la pressione", () => {
    const { text } = generateSpatialFixture("ink");
    const strokes = text.match(/fub:tool="pen"/g) ?? [];
    expect(strokes).toHaveLength(2_000);
    expect(text.match(/sim=1/g)).toBeNull();
    expect(text.match(/fub:ink="1 s100 cxypt /g)).toHaveLength(2_000);
  }, 60_000);

  it("il disegno del vault fisso si legge senza diagnostica e senza perdite", () => {
    const scene = load(CORPUS["Risorse/Ciclo dell'acqua.svg"]!);
    expect(scene.diagnostics).toEqual([]);
    expect(scene.items.filter((item) => item.kind === "element" && item.role === "stroke")).toHaveLength(4);
  });

  it("una fixture sconosciuta non si genera", () => {
    expect(() => generateSpatialFixture("huge" as SpatialFixtureKind)).toThrow(RangeError);
  });
});
