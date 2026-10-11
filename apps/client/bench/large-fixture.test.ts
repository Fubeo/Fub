import { describe, expect, it } from "vitest";

import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, openSource, readScene } from "../src/editors/spatial/scene/read";
import { LARGE_LIMITS, largeFixture } from "./large-fixture";

describe("il disegno del banco delle scene grandi", () => {
  it.each([LARGE_LIMITS[0], 5_000, LARGE_LIMITS[1]])("con %i elementi si apre modificabile, pulito, con gli elementi che dice", (elements) => {
    const fixture = largeFixture(elements);
    const scene = readScene(fixture.text);
    expect(scene.status).toBe("fubdraw");
    expect(scene.readOnly).toEqual([]);
    // Le forme hanno i colori a caso: qualcuna si legge poco sul suo fondo
    // (S009), e otto inchiostri in aree piene sono un codice di colori
    // (S017). Sono note dell'accessibilità, giuste, e non dicono niente del
    // formato.
    expect(scene.diagnostics.filter((each) => each.code !== "S009" && each.code !== "S017")).toEqual([]);
    expect(scene.items.filter((item) => item.kind === "foreign")).toEqual([]);
    expect(openSource(fixture.text).doc.elements).toBe(elements);
    expect(elements + 100).toBeLessThanOrEqual(MAX_ELEMENTS);
    expect(new TextEncoder().encode(fixture.text).length).toBeLessThan(MAX_EDIT_BYTES);
    // Il disegno più grande si legge in un paio di secondi.
  }, 30_000);

  it("ha il rettangolo da scegliere dove dice, e tratti a penna veri", () => {
    const fixture = largeFixture(5_000);
    const engine = SceneEngine.open(fixture.text);
    expect(engine.holder(fixture.target.id)?.facts.local).toBe("rect");
    const [x, y, w, h] = fixture.target.box;
    expect(fixture.text).toContain(`<rect id="${fixture.target.id}" x="${x}" y="${y}" width="${w}" height="${h}"`);
    expect(fixture.target.center).toEqual([x + w / 2, y + h / 2]);
    expect(fixture.strokes).toBeGreaterThan(fixture.objects / 20);
    expect(fixture.text).toContain('fub:tool="pen"');
    // Il `d` di ogni tratto è quello che il motore ricalcola da `fub:ink`:
    // riscriverli tutti non cambia il file.
    const first = /<path id="([^"]+)" fub:tool="pen"/.exec(fixture.text)![1]!;
    expect(engine.text).toBe(fixture.text);
    expect(engine.holder(first)?.facts.local).toBe("path");
  });

  it("è lo stesso disegno a ogni chiamata", () => {
    const first = largeFixture(2_000);
    const again = largeFixture(2_000);
    expect(again.text).toBe(first.text);
    expect(again.digest).toBe(first.digest);
    expect(largeFixture(2_001).digest).not.toBe(first.digest);
  });

  it("non fa disegni troppo piccoli o oltre il limite", () => {
    for (const elements of [0, LARGE_LIMITS[0] - 1, 1.5, Number.NaN, LARGE_LIMITS[1] + 1]) {
      expect(() => largeFixture(elements)).toThrow(RangeError);
    }
  });
});
