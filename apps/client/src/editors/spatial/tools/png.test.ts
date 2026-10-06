// Il PNG della selezione copiata: la misura, che il canvas di ogni browser
// tiene; la densità scritta nel file.

import { describe, expect, it } from "vitest";
import { MAX_PNG_AREA, MAX_PNG_SIDE, pngSize, withDensity } from "./png";

/// Un PNG di un pixel, coi chunk senza dati veri: basta a contare i byte.
function tinyPng(extra: readonly string[] = []): Uint8Array {
  const chunk = (type: string, length: number): number[] => [0, 0, 0, length, ...[...type].map((c) => c.charCodeAt(0)), ...new Array<number>(length).fill(0), 0, 0, 0, 0];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", 13),
    ...extra.flatMap((type) => chunk(type, type === "pHYs" ? 9 : 0)),
    ...chunk("IDAT", 2),
    ...chunk("IEND", 0),
  ]);
}

const text = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));

describe("la misura del PNG", () => {
  it("ha due pixel per pixel CSS", () => {
    expect(pngSize(300, 150)).toEqual({ width: 600, height: 300, scale: 2 });
  });

  it("scende quanto serve per il lato e per l'area del canvas", () => {
    const long = pngSize(20000, 100)!;
    expect(long.width).toBe(MAX_PNG_SIDE);
    expect(long.scale).toBeCloseTo(MAX_PNG_SIDE / 20000);
    const large = pngSize(8000, 8000)!;
    expect(large.width * large.height).toBeLessThanOrEqual(MAX_PNG_AREA);
    expect(large.width).toBe(Math.floor(Math.sqrt(MAX_PNG_AREA)));
  });

  it("non c'è per un disegno senza misura", () => {
    expect(pngSize(0, 10)).toBeNull();
    expect(pngSize(Number.NaN, 10)).toBeNull();
  });
});

describe("la densità del PNG", () => {
  it("si scrive in un pHYs dopo IHDR, in pixel per metro, col suo CRC", () => {
    const png = withDensity(tinyPng(), 2);
    expect(png.length).toBe(tinyPng().length + 21);
    expect(text(png, 37, 41)).toBe("pHYs");
    const view = new DataView(png.buffer);
    expect(view.getUint32(33)).toBe(9);
    // 192 dpi.
    expect(view.getUint32(41)).toBe(7559);
    expect(view.getUint32(45)).toBe(7559);
    expect(png[49]).toBe(1);
    // Il CRC-32 di «pHYs», dei due 7559 e del metro, come lo dà zlib.
    expect(view.getUint32(50)).toBe(0x8fe5f165);
    expect(text(png, 58, 62)).toBe("IDAT");
  });

  it("resta quella che il PNG dice già, e un file che non è un PNG resta com'è", () => {
    const said = tinyPng(["pHYs"]);
    expect(withDensity(said, 2)).toBe(said);
    const other = new Uint8Array([1, 2, 3]);
    expect(withDensity(other, 2)).toBe(other);
  });
});
