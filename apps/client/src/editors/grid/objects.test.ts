// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import fixture from "../../__fixtures__/xlsx-grid.json";
import { MAX_GRID_KNOWN_MEDIA, type GridBytesWindow, type GridObject } from "../../host/contract";
import { gestureRect } from "./engine";
import { drawObject, GridMediaCache, objectLabel } from "./objects";

const objects = (fixture.windows as GridBytesWindow[])[0].objects;
const [image, shape, chart] = objects;

function withMedia(key: string, data: string | null): GridObject {
  return { ...structuredClone(image), media: { mime: "image/png", key, data } };
}

describe("gli oggetti della griglia", () => {
  it("tiene le immagini per impronta e dice all'host le ultime", () => {
    const cache = new GridMediaCache();
    expect(cache.remember([withMedia("a", null)])).toBe(false);
    expect(cache.missing([withMedia("a", null)])).toBe(true);
    expect(cache.remember([withMedia("a", "AAAA")])).toBe(true);
    // La stessa impronta non si prende due volte.
    expect(cache.remember([withMedia("a", "BBBB")])).toBe(false);
    expect(cache.url("a")).toBe("data:image/png;base64,AAAA");
    expect(cache.missing([withMedia("a", null)])).toBe(false);
    cache.remember(Array.from({ length: MAX_GRID_KNOWN_MEDIA + 10 }, (_, index) => withMedia(`k${index}`, "AAAA")));
    const known = cache.known();
    expect(known).toHaveLength(MAX_GRID_KNOWN_MEDIA);
    expect(known[known.length - 1]).toBe(`k${MAX_GRID_KNOWN_MEDIA + 9}`);
    cache.clear();
    expect(cache.known()).toEqual([]);
    expect(cache.url("a")).toBeNull();
  });

  it("disegna un grafico come immagine, una forma con il suo testo e un posto vuoto per ciò che manca", () => {
    const cache = new GridMediaCache();
    cache.remember([image]);
    const drawn = drawObject(chart, 384, 260, 1, cache, "serif") as HTMLImageElement;
    expect(drawn.tagName).toBe("IMG");
    expect(drawn.alt).toBe("");
    expect(decodeURIComponent(drawn.src)).toContain("<svg");
    expect((drawObject(image, 10, 10, 1, cache, "serif") as HTMLImageElement).src).toBe(cache.url(image.media!.key));
    expect((drawObject(image, 10, 10, 1, new GridMediaCache(), "serif") as HTMLElement).className).toBe("grid-object-missing");

    const box = drawObject(shape, 192, 40, 2, cache, "serif") as HTMLElement;
    expect(box.querySelector("rect")?.getAttribute("fill")).toBe("#FFF2CC");
    const text = box.querySelector<HTMLElement>(".grid-object-text")!;
    expect(text.textContent).toBe("Conti di casa");
    expect(text.style.fontSize).toBe(`${(11 * (96 / 72) * 2).toFixed(2)}px`);

    const missing = drawObject({ ...structuredClone(image), missing: "unsupported" }, 10, 10, 1, cache, "serif");
    expect(missing.className).toBe("grid-object-missing");
    expect(missing.textContent).not.toBe("");

    const arrow = drawObject({ ...structuredClone(shape), shape: { ...shape.shape!, kind: "arrow", text: "" } }, 100, 50, 1, cache, "serif");
    expect(arrow.querySelector("line")).not.toBeNull();
    expect(arrow.querySelector("polygon")).not.toBeNull();
    expect(arrow.querySelector(".grid-object-text")).toBeNull();
  });

  it("nomina un oggetto con il tipo e il suo testo", () => {
    expect(objectLabel(image)).toContain("Il sole");
    expect(objectLabel(shape)).toContain("Conti di casa");
    expect(objectLabel({ ...structuredClone(image), alt: "" })).not.toBe("");
  });

  it("sposta o misura un riquadro dalla maniglia presa", () => {
    const from = { left: 10, top: 20, width: 100, height: 50 };
    expect(gestureRect(from, null, 5, -5, false)).toEqual({ left: 15, top: 15, width: 100, height: 50 });
    expect(gestureRect(from, "e", 20, 99, false)).toEqual({ left: 10, top: 20, width: 120, height: 50 });
    expect(gestureRect(from, "nw", 10, 10, false)).toEqual({ left: 20, top: 30, width: 90, height: 40 });
    // Un lato non passa l'altro.
    expect(gestureRect(from, "w", 500, 0, false).width).toBe(1);
    // Con Shift un angolo tiene la proporzione.
    const kept = gestureRect(from, "se", 100, 0, true);
    expect(kept.width / kept.height).toBeCloseTo(2, 5);
  });
});
