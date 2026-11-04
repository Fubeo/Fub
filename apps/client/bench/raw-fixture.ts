// I RAW delle scene `raw-*` (`?raw-scheda=dritto|girato|senza`): una foto
// RAW nella cartella «Foto», con l'XMP che LightCraft le scrive accanto, come
// le schermate «raw», «raw-girato» e «raw-senza» del prototipo
// `PLAN-ui/craft-anteprime.html` (T28). Il JPEG che il RAW ha dentro è
// disegnato apposta dai disegni del prototipo: le montagne di 600×400, e il
// faro scattato in verticale, che sul disco sta coricato (600×400) e porta
// l'orientamento 6. Soltanto le sue scene lo hanno.
//
// L'host finto non sa dire l'anteprima di un RAW (la dice il bundle vero,
// T27, che legge il JPEG dal file): `rawScenePreview` risponde al suo posto a
// `craft.preview` per il RAW della scena, senza toccare `src/host/fake.ts`.

import type { FakeCraft } from "../src/host/fake";
import type { CraftPreview, CraftPreviewSize } from "../src/host/craft";

export type RawSceneCase = "dritto" | "girato" | "senza";

const CASES: readonly RawSceneCase[] = ["dritto", "girato", "senza"];

export function rawSceneCase(value: string | null): RawSceneCase | null {
  return CASES.find((name) => name === value) ?? null;
}

/// Le montagne, 600×400, dritte.
const MOUNTAINS =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAA" +
  "ACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0" +
  "AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAA" +
  "AAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAM" +
  "ZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQa" +
  "FRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e" +
  "Hh7/wAARCAGQAlgDASIAAhEBAxEB/8QAHAABAQACAwEBAAAAAAAAAAAAAAEFBwMEBggC/8QAQxABAAIBAwEDBwcJCAIDAQAAAAECAwQFEQYxQVEHEiEyM2Fx" +
  "EyNCgZGx0RQVUlNicqHB4SIlQ4KSosLwFiRjdKOy/8QAGQEBAAMBAQAAAAAAAAAAAAAAAAECAwQF/8QAJhEBAAMAAgEDBAMBAQAAAAAAAAECEQMSQQQhMQUT" +
  "QlIiUZEyYf/aAAwDAQACEQMRAD8A+ixeDh6rz0F4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeD" +
  "gEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4OAQXg4BBeDgEF4AUURqyChogoaIKGiChogoaIKGiChogoa" +
  "IKGiChogoaIKGiChogoaIKGiChogoaIKGiChogoaIKGiChogoaIKGiChogoaIKGiChogoaIKGiChogoaIKGiChogoaIKGiChoCiqUFAQUBBQEFAQUBBQEFAQ" +
  "UBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAQUBBQEFAUUQIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoC" +
  "CgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKACiE4goGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIK" +
  "BiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGKAjUgBoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAGgAa" +
  "ABoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAGgAaABoAGgAaAAKKKmIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIKBiCgYgoGIMpsm3" +
  "/lOT5bNX5ms+iJ+lP4Jve3/k2T5bDX5i09kfQnw+H/fBXvG4t0nNYwUWVxBQMQUDEFAxBQMQUDEFAxBQMQUDEFAxBQMQUDEFAxBQMQUDEFAxBQMQUDAXg4Eo" +
  "LwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCO5teitrM/m+mMdfTe38nDpdPk1OeuLHHpntnwjxer" +
  "0mnx6XBXFjj0R2z4z4s+S/WPZeldfvHSmPHWlKxWtY4iIMuOmXHbHkrFq2jiYl+hzN3k9y0dtHqPMnmaT6aWnvj8XVew1umx6rT2xX7/AExPhPi8rqcGTT5r" +
  "YskcWrP2unjv2j3YXrjhF4OGiiC8HAILwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCC8HAILwcAgvBwCC8AP0AqsAAAAAAAAAAAAAAAA" +
  "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" +
  "AAAAAAAAAAAAAAAAAAAA/9k=";
/// Il faro di 400×600, coricato sul disco in 600×400.
export const LIGHTHOUSE_STORED =
  "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" +
  "kkkkkkkkkkkkk//Z";

interface RawScene {
  readonly doc: string;
  readonly xmp: string;
  readonly bytes: number;
  readonly image: { readonly data: string; readonly orientation: number } | null;
  readonly meta: { rating: number; label: string | null; flag: "pick" | "reject" | null; keywords: string[] };
}

const SCENES: Readonly<Record<RawSceneCase, RawScene>> = {
  dritto: {
    doc: "Foto/IMG_0398.CR3",
    xmp: "Foto/IMG_0398.xmp",
    bytes: 25_376_112,
    image: { data: MOUNTAINS, orientation: 1 },
    meta: { rating: 3, label: "Blue", flag: null, keywords: ["montagna", "Dolomiti"] },
  },
  girato: {
    doc: "Foto/IMG_0412.CR3",
    xmp: "Foto/IMG_0412.xmp",
    bytes: 27_011_420,
    image: { data: LIGHTHOUSE_STORED, orientation: 6 },
    meta: { rating: 5, label: null, flag: "pick", keywords: ["faro", "Liguria"] },
  },
  senza: {
    doc: "Foto/IMG_0413.CR3",
    xmp: "Foto/IMG_0413.xmp",
    bytes: 32_505_856,
    image: null,
    meta: { rating: 2, label: null, flag: "reject", keywords: [] },
  },
};

/// Il RAW della scena, per aprirlo dall'albero.
export function rawSceneDoc(kind: RawSceneCase): string {
  return SCENES[kind].doc;
}

/// I file della scena: il RAW (pochi byte: il peso lo dice l'anteprima) e il
/// suo XMP.
export function rawSceneResources(kind: RawSceneCase): Record<string, { bytes: Uint8Array }> {
  const scene = SCENES[kind];
  return {
    [scene.doc]: { bytes: new TextEncoder().encode("RAW") },
    [scene.xmp]: { bytes: new TextEncoder().encode("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"/>") },
  };
}

/// Ciò che il bundle finto dice dell'XMP, per `craft.photo`.
export function rawSceneCraft(kind: RawSceneCase): FakeCraft {
  const scene = SCENES[kind];
  return { docs: { [scene.xmp]: { info: { xmp: scene.meta } } } };
}

/// L'anteprima di `craft.preview` per il RAW della scena: il JPEG che ha
/// dentro col suo orientamento, o, senza JPEG, LightCraft che può farla col
/// consenso da chiedere. `null` per ogni altro documento.
export function rawScenePreview(kind: RawSceneCase, doc: string, size: CraftPreviewSize): CraftPreview | null {
  const scene = SCENES[kind];
  if (doc !== scene.doc) return null;
  const image = scene.image;
  return {
    version: 2,
    doc,
    revision: null,
    size,
    origin: image ? "file" : "none",
    queued: false,
    image: image ? { media_type: "image/jpeg", data: image.data, width: 600, height: 400, orientation: image.orientation } : null,
    missing: image ? null : "absent",
    limit_bytes: null,
    info: { app: "raw", editor: "LightCraft", format_version: null, bytes: scene.bytes, photo: null, edits: [], xmp: null },
    render: image ? null : { app: "LightCraft", consent: "ask" },
  };
}
