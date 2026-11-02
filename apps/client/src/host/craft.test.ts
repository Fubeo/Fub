// Il lettore del contratto dell'anteprima dei file Craft contro la fixture
// che serde scrive (`crates/fub-format-craft/tests/ts_preview.rs`).
import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/craft-preview.json";
import {
  CRAFT_BUNDLE_NS,
  CRAFT_PREVIEW_COMMAND,
  CRAFT_PREVIEW_VERSION,
  CRAFT_RENDER_JOB,
  readCraftPreview,
} from "./craft";

const samples: unknown[] = fixture.samples;

/// Una copia profonda dell'esempio `index`, da guastare.
function sample(index: number): Record<string, unknown> {
  return structuredClone(samples[index]) as Record<string, unknown>;
}

/// L'esempio `index` con `edit` applicato alla copia.
function spoiled(index: number, edit: (value: Record<string, any>) => void): unknown {
  const value = sample(index);
  edit(value);
  return value;
}

describe("readCraftPreview", () => {
  it("i nomi sono quelli del Rust", () => {
    expect(fixture.version).toBe(CRAFT_PREVIEW_VERSION);
    expect(fixture.command).toBe(CRAFT_PREVIEW_COMMAND);
    expect(fixture.job).toBe(CRAFT_RENDER_JOB);
    expect(fixture.ns).toBe(CRAFT_BUNDLE_NS);
  });

  it("ogni esempio passa e torna uguale", () => {
    expect(samples.length).toBeGreaterThanOrEqual(5);
    for (const value of samples) expect(readCraftPreview(value)).toEqual(value);
  });

  it("gli esempi coprono le forme del contratto", () => {
    const read = samples.map((value) => readCraftPreview(value)!);
    expect(read.some((preview) => preview.image !== null)).toBe(true);
    expect(read.some((preview) => preview.image === null && preview.render === null)).toBe(true);
    expect(read.some((preview) => preview.render !== null)).toBe(true);
    expect(read.some((preview) => preview.queued)).toBe(true);
    expect(read.some((preview) => preview.info.xmp !== null)).toBe(true);
  });

  it("un campo in più si ignora", () => {
    const value = spoiled(0, (preview) => {
      preview.extra = 1;
      preview.info.extra = "x";
      preview.image.extra = true;
    });
    expect(readCraftPreview(value)).toEqual(samples[0]);
  });

  it("un'altra versione non si legge", () => {
    expect(readCraftPreview(spoiled(0, (preview) => (preview.version = 2)))).toBeNull();
    expect(readCraftPreview(spoiled(0, (preview) => (preview.version = "1")))).toBeNull();
  });

  it("un campo mancante dà null", () => {
    for (const key of ["doc", "revision", "size", "origin", "queued", "image", "info", "render"]) {
      expect(readCraftPreview(spoiled(0, (preview) => delete preview[key])), key).toBeNull();
    }
    for (const key of ["app", "editor", "format_version", "bytes", "photo", "edits", "xmp"]) {
      expect(readCraftPreview(spoiled(0, (preview) => delete preview.info[key])), key).toBeNull();
    }
    for (const key of ["media_type", "data", "width", "height"]) {
      expect(readCraftPreview(spoiled(0, (preview) => delete preview.image[key])), key).toBeNull();
    }
    const xmp = samples.findIndex((value) => readCraftPreview(value)?.info.xmp !== null);
    for (const key of ["rating", "label", "flag", "keywords"]) {
      expect(readCraftPreview(spoiled(xmp, (preview) => delete preview.info.xmp[key])), key).toBeNull();
    }
  });

  it("un campo di un altro tipo dà null", () => {
    const broken: Array<(preview: Record<string, any>) => void> = [
      (preview) => (preview.doc = 1),
      (preview) => (preview.size = "medium"),
      (preview) => (preview.origin = "web"),
      (preview) => (preview.queued = "no"),
      (preview) => (preview.image = "png"),
      (preview) => (preview.image.media_type = "image/jpeg"),
      (preview) => (preview.image.width = 0),
      (preview) => (preview.image.height = 1.5),
      (preview) => (preview.info.app = "lightcraft"),
      (preview) => (preview.info.bytes = -1),
      (preview) => (preview.info.edits = [1]),
      (preview) => (preview.info.xmp = { rating: 6, label: null, flag: null, keywords: [] }),
      (preview) => (preview.info.xmp = { rating: null, label: null, flag: "none", keywords: [] }),
      (preview) => (preview.render = { app: null }),
    ];
    for (const edit of broken) expect(readCraftPreview(spoiled(0, edit)), edit.toString()).toBeNull();
    for (const value of [null, undefined, 1, "x", []]) expect(readCraftPreview(value)).toBeNull();
  });
});
