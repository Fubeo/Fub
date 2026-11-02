// Il contratto dell'anteprima dei file Craft, `CraftPreview`, rispecchiato a
// mano da `crates/fub-format-craft/src/contract.rs`.
//
// Il bundle `fub.craft` lo risponde come effetto `Custom` del comando
// `craft.preview` e come esito del job `craft.render`. Arriva come `unknown`:
// `readCraftPreview` controlla ogni campo e dà `null` per una forma che non è
// questa, invece di lasciar passare un oggetto a metà.
//
// Che i due lati non divergano lo dice la fixture generata da serde
// (`crates/fub-format-craft/tests/ts_preview.rs`, `craft-preview.json`), che
// `craft.test.ts` legge.

/// La versione della forma che la shell sa leggere.
export const CRAFT_PREVIEW_VERSION = 1;
/// Il comando, in sola lettura, che chiede l'anteprima.
export const CRAFT_PREVIEW_COMMAND = "craft.preview";
/// Il job che fa l'anteprima con la riga di comando dell'app.
export const CRAFT_RENDER_JOB = "craft.render";
/// Lo spazio dei nomi del bundle e dell'effetto `Custom`.
export const CRAFT_BUNDLE_NS = "fub.craft";

/// La famiglia del file.
export type CraftApp = "vectorcraft" | "photocraft" | "figcraft" | "xmp";
/// `small` per la figura nella nota e l'anteprima al passaggio, `large` per la scheda.
export type CraftPreviewSize = "small" | "large";
/// Da dove viene l'immagine: dal file, dalla riga di comando dell'app, da nessuna parte.
export type CraftPreviewOrigin = "file" | "cli" | "none";
/// La scelta di una foto in un XMP.
export type CraftFlag = "pick" | "reject";

/// Il PNG in base64, con le misure della sua intestazione.
export interface CraftPreviewImage {
  media_type: "image/png";
  data: string;
  width: number;
  height: number;
}

/// Voto, etichetta, scelta e parole chiave di un XMP.
export interface CraftXmpInfo {
  rating: number | null;
  label: string | null;
  flag: CraftFlag | null;
  keywords: string[];
}

/// Ciò che si sa del file, con o senza immagine.
export interface CraftPreviewInfo {
  app: CraftApp;
  /// Il nome da mostrare dell'editor esterno.
  editor: string;
  format_version: string | null;
  /// Il peso del file.
  bytes: number;
  /// Per un XMP, la foto a cui appartiene, se c'è nel vault.
  photo: string | null;
  /// Le copie `-Edit.psd` della foto che esistono.
  edits: string[];
  xmp: CraftXmpInfo | null;
}

/// L'app installata che può fare l'anteprima che manca.
export interface CraftRenderOffer {
  app: string;
}

/// L'anteprima di un documento Craft, per una misura e una revisione.
export interface CraftPreview {
  version: 1;
  doc: string;
  revision: string;
  size: CraftPreviewSize;
  origin: CraftPreviewOrigin;
  /// La risposta ha messo in coda il job `craft.render`.
  queued: boolean;
  image: CraftPreviewImage | null;
  info: CraftPreviewInfo;
  render: CraftRenderOffer | null;
}

const APPS: readonly CraftApp[] = ["vectorcraft", "photocraft", "figcraft", "xmp"];
const SIZES: readonly CraftPreviewSize[] = ["small", "large"];
const ORIGINS: readonly CraftPreviewOrigin[] = ["file", "cli", "none"];
const FLAGS: readonly CraftFlag[] = ["pick", "reject"];

/// Il segnale che una parte della forma non è quella del contratto.
class Malformed extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Malformed();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Malformed();
  return value;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Malformed();
  return value;
}

/// Un intero non negativo che JavaScript rappresenta esatto.
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Malformed();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new Malformed();
  return value as T;
}

function nullable<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null ? null : read(value);
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Malformed();
  return value.map(text);
}

function readImage(value: unknown): CraftPreviewImage {
  const image = record(value);
  if (image.media_type !== "image/png") throw new Malformed();
  const width = count(image.width);
  const height = count(image.height);
  if (width === 0 || height === 0) throw new Malformed();
  return { media_type: "image/png", data: text(image.data), width, height };
}

function readXmp(value: unknown): CraftXmpInfo {
  const xmp = record(value);
  const rating = nullable(xmp.rating, (rating) => {
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < -1 || rating > 5) throw new Malformed();
    return rating;
  });
  return {
    rating,
    label: nullable(xmp.label, text),
    flag: nullable(xmp.flag, (value) => oneOf(value, FLAGS)),
    keywords: texts(xmp.keywords),
  };
}

function readInfo(value: unknown): CraftPreviewInfo {
  const info = record(value);
  return {
    app: oneOf(info.app, APPS),
    editor: text(info.editor),
    format_version: nullable(info.format_version, text),
    bytes: count(info.bytes),
    photo: nullable(info.photo, text),
    edits: texts(info.edits),
    xmp: nullable(info.xmp, readXmp),
  };
}

function readRender(value: unknown): CraftRenderOffer {
  return { app: text(record(value).app) };
}

/// Il `CraftPreview` che `value` porta, o `null` se la forma non è quella del
/// contratto: un campo mancante o di un altro tipo, o una `version` diversa da
/// 1. I campi in più si ignorano, e l'oggetto che torna ha soltanto i campi
/// del contratto.
export function readCraftPreview(value: unknown): CraftPreview | null {
  try {
    const preview = record(value);
    if (preview.version !== CRAFT_PREVIEW_VERSION) return null;
    return {
      version: CRAFT_PREVIEW_VERSION,
      doc: text(preview.doc),
      revision: text(preview.revision),
      size: oneOf(preview.size, SIZES),
      origin: oneOf(preview.origin, ORIGINS),
      queued: flag(preview.queued),
      image: nullable(preview.image, readImage),
      info: readInfo(preview.info),
      render: nullable(preview.render, readRender),
    };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}
