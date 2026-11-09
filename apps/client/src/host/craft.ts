// Il contratto dell'anteprima dei file Craft, `CraftPreview`, rispecchiato a
// mano da `crates/fub-format-craft/src/contract.rs`.
//
// Il bundle `fub.craft` lo risponde come effetto `Custom` del comando
// `craft.preview` e come esito del job `craft.render`; i dati dell'XMP di una
// foto, `PhotoSidecar`, sono l'effetto del comando `craft.photo`. Arrivano
// come `unknown`: `readCraftPreview` e `readPhotoSidecar` controllano ogni
// campo e danno `null` per una forma che non è questa, invece di lasciar
// passare un oggetto a metà.
//
// Che i due lati non divergano lo dice la fixture generata da serde
// (`crates/fub-format-craft/tests/ts_preview.rs`, `craft-preview.json`), che
// `craft.test.ts` legge.

/// La versione della forma che la shell sa leggere.
export const CRAFT_PREVIEW_VERSION = 2;
/// Il comando, in sola lettura, che chiede l'anteprima.
export const CRAFT_PREVIEW_COMMAND = "craft.preview";
/// Il comando, in sola lettura, che dà l'XMP di una foto e i suoi dati.
export const CRAFT_PHOTO_COMMAND = "craft.photo";
/// Il job che fa l'anteprima con la riga di comando dell'app.
export const CRAFT_RENDER_JOB = "craft.render";
/// Lo spazio dei nomi del bundle e dell'effetto `Custom`.
export const CRAFT_BUNDLE_NS = "fub.craft";

/// Di che cosa è l'anteprima: un file Craft, un XMP, o un file che un'app
/// Craft sa mostrare (una foto RAW, un PDF, un documento).
export type CraftPreviewSubject = "vectorcraft" | "photocraft" | "figcraft" | "xmp" | "raw" | "pdf" | "document";
/// Perché l'immagine manca: il file non ne ha una, andrebbe letto intero e
/// supera il peso massimo, è rotto, o l'app ha provato e non ci è riuscita.
export type CraftMissing = "absent" | "over_limit" | "unreadable" | "failed";
/// Il valore di `craft.cli-previews`: chiedere, farle da sé, mai.
export type CraftRenderConsent = "ask" | "on" | "off";
/// Il tipo dell'immagine.
export type CraftImageType = "image/png" | "image/jpeg";
/// `small` per la figura nella nota e l'anteprima al passaggio, `large` per la scheda.
export type CraftPreviewSize = "small" | "large";
/// Da dove viene l'immagine: dal file, dalla riga di comando dell'app, da nessuna parte.
export type CraftPreviewOrigin = "file" | "cli" | "none";
/// La scelta di una foto in un XMP.
export type CraftFlag = "pick" | "reject";

/// Il PNG o il JPEG in base64, con le misure della sua intestazione e
/// l'orientamento EXIF da applicare (da 1 a 8; 1 vuol dire «così com'è»).
export interface CraftPreviewImage {
  media_type: CraftImageType;
  data: string;
  width: number;
  height: number;
  orientation: number;
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
  app: CraftPreviewSubject;
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

/// L'app installata che può fare l'anteprima che manca, col consenso che le
/// impostazioni danno.
export interface CraftRenderOffer {
  app: string;
  consent: CraftRenderConsent;
}

/// L'anteprima di un documento Craft, per una misura e una revisione.
export interface CraftPreview {
  version: 2;
  doc: string;
  /// La revisione dei byte da cui l'anteprima è nata, o `null` quando Fub ne
  /// ha letto solo dei pezzi: allora vale come appena letta.
  revision: string | null;
  size: CraftPreviewSize;
  origin: CraftPreviewOrigin;
  /// La risposta ha messo in coda il job `craft.render`.
  queued: boolean;
  image: CraftPreviewImage | null;
  /// `null` quando `image` c'è; altrimenti perché manca.
  missing: CraftMissing | null;
  /// Il peso massimo in byte, solo con `missing: "over_limit"`.
  limit_bytes: number | null;
  info: CraftPreviewInfo;
  render: CraftRenderOffer | null;
}

/// L'XMP che sta accanto a una foto e i suoi dati.
export interface CraftPhotoSidecar {
  version: 2;
  doc: string;
  /// Il percorso dell'XMP, se c'è nel vault.
  xmp: string | null;
  meta: CraftXmpInfo | null;
  /// Le copie `-Edit.psd` della foto che esistono.
  edits: string[];
}

const SUBJECTS: readonly CraftPreviewSubject[] = ["vectorcraft", "photocraft", "figcraft", "xmp", "raw", "pdf", "document"];
const MISSING: readonly CraftMissing[] = ["absent", "over_limit", "unreadable", "failed"];
const CONSENTS: readonly CraftRenderConsent[] = ["ask", "on", "off"];
const IMAGE_TYPES: readonly CraftImageType[] = ["image/png", "image/jpeg"];
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
  const media_type = oneOf(image.media_type, IMAGE_TYPES);
  const width = count(image.width);
  const height = count(image.height);
  if (width === 0 || height === 0) throw new Malformed();
  const orientation = count(image.orientation);
  if (orientation < 1 || orientation > 8) throw new Malformed();
  return { media_type, data: text(image.data), width, height, orientation };
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
    app: oneOf(info.app, SUBJECTS),
    editor: text(info.editor),
    format_version: nullable(info.format_version, text),
    bytes: count(info.bytes),
    photo: nullable(info.photo, text),
    edits: texts(info.edits),
    xmp: nullable(info.xmp, readXmp),
  };
}

function readRender(value: unknown): CraftRenderOffer {
  const render = record(value);
  return { app: text(render.app), consent: oneOf(render.consent, CONSENTS) };
}

/// Il `CraftPreview` che `value` porta, o `null` se la forma non è quella del
/// contratto: un campo mancante o di un altro tipo, una `version` diversa da
/// 2, o un `limit_bytes` senza `missing: "over_limit"`. I campi in più si
/// ignorano, e l'oggetto che torna ha soltanto i campi del contratto.
export function readCraftPreview(value: unknown): CraftPreview | null {
  try {
    const preview = record(value);
    if (preview.version !== CRAFT_PREVIEW_VERSION) return null;
    const missing = nullable(preview.missing, (value) => oneOf(value, MISSING));
    const limit_bytes = nullable(preview.limit_bytes, count);
    if (limit_bytes !== null && missing !== "over_limit") return null;
    return {
      version: CRAFT_PREVIEW_VERSION,
      doc: text(preview.doc),
      revision: nullable(preview.revision, text),
      size: oneOf(preview.size, SIZES),
      origin: oneOf(preview.origin, ORIGINS),
      queued: flag(preview.queued),
      image: nullable(preview.image, readImage),
      missing,
      limit_bytes,
      info: readInfo(preview.info),
      render: nullable(preview.render, readRender),
    };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}

/// Il `CraftPhotoSidecar` che `value` porta, o `null` se la forma non è quella
/// del contratto (le stesse regole di `readCraftPreview`).
export function readPhotoSidecar(value: unknown): CraftPhotoSidecar | null {
  try {
    const sidecar = record(value);
    if (sidecar.version !== CRAFT_PREVIEW_VERSION) return null;
    return {
      version: CRAFT_PREVIEW_VERSION,
      doc: text(sidecar.doc),
      xmp: nullable(sidecar.xmp, text),
      meta: nullable(sidecar.meta, readXmp),
      edits: texts(sidecar.edits),
    };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}
