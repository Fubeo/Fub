// Il lettore del contratto dell'anteprima dei file Craft contro la fixture
// che serde scrive (`crates/fub-format-craft/tests/ts_preview.rs`).
import { describe, expect, it } from "vitest";
import fixture from "../__fixtures__/craft-preview.json";
import {
  CRAFT_BUNDLE_NS,
  CRAFT_PHOTO_COMMAND,
  CRAFT_PREVIEW_COMMAND,
  CRAFT_PREVIEW_VERSION,
  CRAFT_RENDER_JOB,
  readCraftPreview,
  readPhotoSidecar,
} from "./craft";

const samples: unknown[] = fixture.samples;
const photos: unknown[] = fixture.photos;

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
    expect(fixture.photo_command).toBe(CRAFT_PHOTO_COMMAND);
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
    expect(read.some((preview) => preview.revision === null)).toBe(true);
    expect(read.some((preview) => preview.image?.media_type === "image/jpeg" && preview.image.orientation === 6)).toBe(
      true,
    );
    expect(new Set(read.map((preview) => preview.info.app))).toEqual(
      new Set(["vectorcraft", "photocraft", "figcraft", "xmp", "raw", "pdf", "document"]),
    );
    expect(new Set(read.map((preview) => preview.missing).filter((missing) => missing !== null))).toEqual(
      new Set(["absent", "over_limit", "unreadable", "failed"]),
    );
    expect(new Set(read.map((preview) => preview.render?.consent).filter((consent) => consent !== undefined))).toEqual(
      new Set(["ask", "on", "off"]),
    );
    const overLimit = read.find((preview) => preview.missing === "over_limit")!;
    expect(overLimit.limit_bytes).toBeGreaterThan(0);
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
    for (const version of [1, 3, "2"]) {
      expect(readCraftPreview(spoiled(0, (preview) => (preview.version = version))), String(version)).toBeNull();
    }
  });

  it("un limite senza over_limit non si legge", () => {
    expect(readCraftPreview(spoiled(0, (preview) => (preview.limit_bytes = 1024)))).toBeNull();
    const absent = samples.findIndex((value) => readCraftPreview(value)?.missing === "absent");
    expect(readCraftPreview(spoiled(absent, (preview) => (preview.limit_bytes = 1024)))).toBeNull();
    const overLimit = samples.findIndex((value) => readCraftPreview(value)?.missing === "over_limit");
    expect(readCraftPreview(spoiled(overLimit, (preview) => (preview.limit_bytes = null)))?.limit_bytes).toBeNull();
  });

  it("un campo mancante dà null", () => {
    for (const key of ["doc", "revision", "size", "origin", "queued", "image", "missing", "limit_bytes", "info", "render"]) {
      expect(readCraftPreview(spoiled(0, (preview) => delete preview[key])), key).toBeNull();
    }
    for (const key of ["app", "editor", "format_version", "bytes", "photo", "edits", "xmp"]) {
      expect(readCraftPreview(spoiled(0, (preview) => delete preview.info[key])), key).toBeNull();
    }
    for (const key of ["media_type", "data", "width", "height", "orientation"]) {
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
      (preview) => (preview.revision = 7),
      (preview) => (preview.image.media_type = "image/gif"),
      (preview) => (preview.image.orientation = 0),
      (preview) => (preview.image.orientation = 9),
      (preview) => (preview.image.orientation = 1.5),
      (preview) => (preview.missing = "gone"),
      (preview) => (preview.limit_bytes = -1),
      (preview) => (preview.image.width = 0),
      (preview) => (preview.image.height = 1.5),
      (preview) => (preview.info.app = "lightcraft"),
      (preview) => (preview.info.app = "gridcraft"),
      (preview) => (preview.info.bytes = -1),
      (preview) => (preview.info.edits = [1]),
      (preview) => (preview.info.xmp = { rating: 6, label: null, flag: null, keywords: [] }),
      (preview) => (preview.info.xmp = { rating: null, label: null, flag: "none", keywords: [] }),
      (preview) => (preview.render = { app: null, consent: "ask" }),
      (preview) => (preview.render = { app: "VectorCraft" }),
      (preview) => (preview.render = { app: "VectorCraft", consent: "always" }),
    ];
    for (const edit of broken) expect(readCraftPreview(spoiled(0, edit)), edit.toString()).toBeNull();
    for (const value of [null, undefined, 1, "x", []]) expect(readCraftPreview(value)).toBeNull();
  });
});

describe("readPhotoSidecar", () => {
  it("ogni esempio passa e torna uguale, con e senza XMP", () => {
    expect(photos.length).toBeGreaterThanOrEqual(2);
    const read = photos.map((value) => readPhotoSidecar(value));
    expect(read).toEqual(photos);
    expect(read.some((photo) => photo?.xmp !== null && photo?.meta !== null)).toBe(true);
    expect(read.some((photo) => photo?.xmp === null && photo?.meta === null)).toBe(true);
  });

  it("una forma rotta o un'altra versione dà null", () => {
    const photo = (edit: (value: Record<string, any>) => void): unknown => {
      const value = structuredClone(photos[0]) as Record<string, any>;
      edit(value);
      return value;
    };
    for (const key of ["version", "doc", "xmp", "meta", "edits"]) {
      expect(readPhotoSidecar(photo((value) => delete value[key])), key).toBeNull();
    }
    expect(readPhotoSidecar(photo((value) => (value.version = 1)))).toBeNull();
    expect(readPhotoSidecar(photo((value) => (value.xmp = 1)))).toBeNull();
    expect(readPhotoSidecar(photo((value) => (value.meta = { rating: 9, label: null, flag: null, keywords: [] })))).toBeNull();
    expect(readPhotoSidecar(photo((value) => (value.edits = "x")))).toBeNull();
    expect(readPhotoSidecar(photo((value) => (value.extra = 1)))).toEqual(photos[0]);
    for (const value of [null, 1, "x", []]) expect(readPhotoSidecar(value)).toBeNull();
  });
});
