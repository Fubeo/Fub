// @vitest-environment happy-dom
// Le immagini incollate, senza l'editor: il tipo dai byte, l'orientamento
// EXIF, il peso che un gesto può portare, la riduzione e dove l'immagine va.

import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { MAX_EDIT_BYTES } from "../scene/read";
import {
  budgetFor,
  carriesFiles,
  dataUri,
  imageElem,
  imageFiles,
  jpegOrientation,
  limitsFor,
  placeImage,
  reduce,
  roomFor,
  sniffRaster,
  type Decoded,
  type EncodeType,
} from "./images";

const bytes = (...parts: Array<string | number[]>): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? Array.from(part, (c) => c.charCodeAt(0)) : part)));

const PNG = bytes("\x89PNG\r\n\x1a\n", [0, 0, 0, 13]);

/// Un JPEG con l'orientamento EXIF `value`, nell'ordine dei byte `order`.
function exifJpeg(value: number, order: "II" | "MM"): Uint8Array<ArrayBuffer> {
  const u16 = (n: number): number[] => (order === "II" ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number): number[] => (order === "II" ? [...u16(n & 0xffff), ...u16(n >>> 16)] : [...u16(n >>> 16), ...u16(n & 0xffff)]);
  return bytes(
    [0xff, 0xd8, 0xff, 0xe1, 0, 34],
    "Exif\0\0",
    order,
    u16(42),
    u32(8),
    u16(1),
    [...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0],
    u32(0),
    [0xff, 0xda, 0, 2],
  );
}

/// Un'immagine finta: ogni tipo pesa `full` byte a scala piena, e il peso
/// scende col numero dei pixel.
function decoded(width: number, height: number, opaque: boolean, full: Partial<Record<EncodeType, number>>): Decoded & { calls: string[] } {
  const calls: string[] = [];
  return {
    width,
    height,
    calls,
    opaque: () => opaque,
    async encode(type, scale) {
      calls.push(`${type} ${scale.toFixed(3)}`);
      const size = full[type];
      return size === undefined ? null : new Uint8Array(Math.round(size * scale * scale));
    },
    close() {},
  };
}

describe("il tipo e i file", () => {
  it("legge il tipo dai primi byte, non dal nome", () => {
    expect(sniffRaster(PNG)).toBe("image/png");
    expect(sniffRaster(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffRaster(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffRaster(bytes("GIF87a"))).toBe("image/gif");
    expect(sniffRaster(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffRaster(bytes("BM", [0, 0]))).toBe(null);
    expect(sniffRaster(bytes("<svg"))).toBe(null);
    expect(sniffRaster(new Uint8Array())).toBe(null);
  });

  it("legge l'orientamento EXIF nei due ordini dei byte", () => {
    expect(jpegOrientation(exifJpeg(6, "II"))).toBe(6);
    expect(jpegOrientation(exifJpeg(8, "MM"))).toBe(8);
    expect(jpegOrientation(exifJpeg(1, "II"))).toBe(1);
    // Un valore fuori scala, un file tagliato, un JPEG senza EXIF: diritto.
    expect(jpegOrientation(exifJpeg(9, "II"))).toBe(1);
    expect(jpegOrientation(exifJpeg(6, "MM").subarray(0, 20))).toBe(1);
    expect(jpegOrientation(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(jpegOrientation(PNG)).toBe(1);
  });

  it("prende i file che possono essere immagini, ma non un SVG", () => {
    const data = new DataTransfer();
    data.items.add(new File([PNG], "a.png", { type: "image/png" }));
    data.items.add(new File(["<svg/>"], "b.svg", { type: "image/svg+xml" }));
    data.items.add(new File(["x"], "c.txt", { type: "text/plain" }));
    data.items.add(new File([PNG], "d", { type: "" }));
    expect(imageFiles(data).map((file) => file.name)).toEqual(["a.png", "d"]);
    expect(imageFiles(null)).toEqual([]);
    expect(carriesFiles(data)).toBe(true);
    const text = new DataTransfer();
    text.setData("text/plain", "ciao");
    expect(carriesFiles(text)).toBe(false);
  });

  it("scrive il data URI in base64", () => {
    expect(dataUri("image/png", bytes("Man"))).toBe("data:image/png;base64,TWFu");
    // Oltre il pezzo con cui si converte, il testo resta uno.
    const long = new Uint8Array(0x8000 * 2 + 3).fill(65);
    expect(atob(dataUri("image/gif", long).slice("data:image/gif;base64,".length))).toBe("A".repeat(long.length));
  });
});

describe("il peso", () => {
  it("un gesto porta al più 5 MiB, e meno se il disegno è quasi pieno", () => {
    expect(budgetFor(1000, 1)).toBe(MAX_IMAGE_BYTES);
    const near = MAX_EDIT_BYTES - 4 * 1024 * 1024;
    expect(budgetFor(near, 1)).toBe(roomFor(near, 1));
    expect(roomFor(near, 1)).toBeLessThan(3 * 1024 * 1024 + 1);
    expect(roomFor(MAX_EDIT_BYTES, 1)).toBe(0);
  });

  it("le immagini di un gesto si dividono il peso in proporzione", () => {
    expect(limitsFor([1000, 2000], 5000)).toEqual([5000, 5000]);
    expect(limitsFor([3000, 6000], 3000)).toEqual([1000, 2000]);
  });
});

describe("la riduzione", () => {
  it("un'immagine opaca diventa JPEG, se basta a piena misura", async () => {
    const image = decoded(4000, 3000, true, { "image/jpeg": 3_000_000, "image/png": 20_000_000 });
    const out = await reduce(image, MAX_IMAGE_BYTES);
    expect(out?.type).toBe("image/jpeg");
    expect(out?.bytes.length).toBe(3_000_000);
    expect(image.calls).toEqual(["image/jpeg 1.000"]);
  });

  it("una con la trasparenza resta PNG e si rimpicciolisce finché non ci sta", async () => {
    const image = decoded(4000, 3000, false, { "image/png": 20_000_000 });
    const out = await reduce(image, MAX_IMAGE_BYTES);
    expect(out?.type).toBe("image/png");
    expect(out!.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(image.calls[0]).toBe("image/png 1.000");
    expect(image.calls.length).toBeLessThanOrEqual(3);
  });

  it("si arrende se il browser non sa ricodificare, o se non scende mai", async () => {
    expect(await reduce(decoded(10, 10, true, {}), 100)).toBe(null);
    const stubborn: Decoded = { ...decoded(10_000, 10_000, true, {}), encode: async () => new Uint8Array(1000) };
    expect(await reduce(stubborn, 100)).toBe(null);
  });
});

describe("dove va", () => {
  const VIEW = { min: [0, 0], max: [1000, 500] } as const;

  it("una unità per pixel, centrata dove si chiede", () => {
    expect(placeImage(200, 100, VIEW, [300, 200])).toEqual({ min: [200, 150], max: [400, 250] });
    // Senza un punto, al centro della vista.
    expect(placeImage(200, 100, VIEW, null)).toEqual({ min: [400, 200], max: [600, 300] });
  });

  it("al più quattro quinti della vista, e dentro la vista", () => {
    const box = placeImage(4000, 1000, VIEW, [0, 0]);
    expect(box.max[0] - box.min[0]).toBeCloseTo(800);
    expect(box.max[1] - box.min[1]).toBeCloseTo(200);
    expect(box.min).toEqual([0, 0]);
  });

  it("una vista senza misura non la rimpicciolisce", () => {
    expect(placeImage(200, 100, { min: [0, 0], max: [0, 0] }, [50, 50])).toEqual({ min: [-50, 0], max: [150, 100] });
  });

  it("l'elemento ha la geometria a due decimali e l'href", () => {
    expect(imageElem("o1", "data:image/png;base64,AA==", { min: [1.004, 2.5], max: [101.006, 2.501] })).toEqual({
      tag: "image",
      attrs: { id: "o1", x: "1", y: "2.5", width: "100", height: "0.01", href: "data:image/png;base64,AA==" },
    });
  });
});
