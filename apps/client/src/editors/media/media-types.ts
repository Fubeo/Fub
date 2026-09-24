// Le specie media del vault, come le legge chi disegna (P07/F23).
//
// Autorita' sul MIME resta `fub_abi::rules::media::mime_of` lato Rust; qui la
// tabella serve a chi deve decidere *quale view montare* senza aprire il file.
// Le due tabelle si tengono allineate a mano: i casi sono gli stessi, nello
// stesso ordine, confronto case-insensitive. Chi aggiunge un'estensione di la'
// la aggiunge anche qui, o la view cade su `other` (risposta onesta, non buco).
//
// Nessun import Tauri qui dentro: i byte arrivano dalla porta iniettata
// (`resource-port.ts`), mai da un canale diretto.

import type {
  ResourceDescriptor as HostResourceDescriptor,
  ResourceKind,
} from "../../host/contract";

/// Quanto si chiede per volta sull'IPC: tetto imposto, non suggerimento.
/// Gemello di `RESOURCE_CHUNK_BYTES` in `crates/fub-host/src/resources.rs`.
export const MEDIA_IPC_CHUNK = 64 * 1024;

/// Quanti byte si assemblano al massimo per un'anteprima inline. Oltre, solo
/// streaming via protocollo con Range: un errore esplicito, mai un OOM.
/// Gemello di `RESOURCE_MAX_INLINE_BYTES` lato host.
export const MEDIA_MAX_INLINE_BYTES = 64 * 1024 * 1024;

export type MediaKind = ResourceKind;
export type ResourceHandle = string;
export type ResourceDescriptor = HostResourceDescriptor;

const IMAGE_MIME: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/gif": true,
  "image/webp": true,
  "image/svg+xml": true,
  "image/bmp": true,
  "image/vnd.microsoft.icon": true,
  "image/avif": true,
  "image/heic": true,
  "image/tiff": true,
};

const AUDIO_MIME: Record<string, true> = {
  "audio/mpeg": true,
  "audio/wav": true,
  "audio/ogg": true,
  "audio/mp4": true,
  "audio/flac": true,
};

const VIDEO_MIME: Record<string, true> = {
  "video/mp4": true,
  "video/webm": true,
  "video/quicktime": true,
  "video/x-matroska": true,
};

function mimeForExt(ext: string): string | null {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/vnd.microsoft.icon";
    case "avif":
      return "image/avif";
    case "heic":
      return "image/heic";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

function extOf(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  if (base.startsWith(".") && !base.slice(1).includes(".")) return null;
  const cut = base.lastIndexOf(".");
  if (cut < 0) return null;
  const ext = base.slice(cut + 1).toLowerCase();
  return ext ? ext : null;
}

/// Il MIME dedotto dal nome, o `null` quando non si sa (risposta onesta).
/// I documenti (`md`, `markdown`, `fubsheet`, `base`, `canvas`) non sono
/// risorse: tornano `null` come `mime_of` torna `None` per le note.
export function mimeOfId(id: string): string | null {
  const ext = extOf(id);
  if (!ext) return null;
  if (ext === "md" || ext === "markdown" || ext === "fubsheet" || ext === "base" || ext === "canvas") {
    return null;
  }
  return mimeForExt(ext);
}

/// La specie da un MIME gia' noto. `application/pdf` e' l'unico documento che
/// qui e' una risorsa: nessuna estensione di formato lo rivendica, lo nomina
/// la tabella MIME.
export function mediaKindOfMime(mime: string | null): MediaKind {
  if (!mime) return "other";
  if (IMAGE_MIME[mime]) return "image";
  if (AUDIO_MIME[mime]) return "audio";
  if (VIDEO_MIME[mime]) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

/// La specie da un id del vault, senza aprire il file.
export function mediaKindOfId(id: string): MediaKind {
  return mediaKindOfMime(mimeOfId(id));
}

/// Il MIME da servire, o il fallback onesto quando non si sa.
export function mimeOrOctet(id: string): string {
  return mimeOfId(id) ?? "application/octet-stream";
}

/// L'URL con cui la shell chiede un handle al protocollo, senza esporre path.
export function assetUrl(handle: ResourceHandle): string {
  return `fub-asset://localhost/${handle}`;
}
