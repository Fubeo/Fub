// La view immagine (P07/F23): decodifica, errori, limiti, rilascio, zoom.
//
// I byte arrivano dalla porta (`readAll`, tetto inline imposto), mai da cifre
// inventate: `decodeImage` verifica la firma (PNG/JPEG/GIF/WebP/BMP/AVIF/ICO,
// SVG come testo) e rifiuta il resto con un errore che nomina specie e byte.
// Il rendering usa un `blob:` revocato al teardown: niente URL che
// sopravvivono alla chiusura, niente `data:` giganti nel DOM. Le immagini
// rotte mostrano specie, dimensione ed errore — mai un riquadro vuoto. Si
// guarda in una `ZoomView`: adatta, 100%, rotella, trascinamento, rotazione,
// scacchiera sotto la trasparenza.

import type { Lifetime } from "../../ui/lifetime";
import { formatBytes, type ResourceDescriptor } from "./media-types";
import { t } from "../../i18n/strings";
import { mountZoomView, type Size } from "./zoom-view";

export interface DecodedImage {
  readonly blob: Blob;
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
  /// Il nome breve del formato, per chi guarda: `PNG`, `SVG`.
  readonly format: string;
}

const SIGNATURES: { kind: string; mime: string; magic: number[] }[] = [
  { kind: "PNG", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: "JPEG", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { kind: "GIF", mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
  { kind: "WebP", mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
  { kind: "BMP", mime: "image/bmp", magic: [0x42, 0x4d] },
  { kind: "AVIF", mime: "image/avif", magic: [0x00, 0x00, 0x00] },
  { kind: "ICO", mime: "image/vnd.microsoft.icon", magic: [0x00, 0x00, 0x01, 0x00] },
];

/// Formati che il sistema riconosce come immagini ma che una webview non
/// decodifica: si dice con parole chiare, non con un'icona rotta.
const UNDECODABLE: Record<string, string> = {
  "image/heic": "HEIC",
  "image/tiff": "TIFF",
};

/// Quanto testo si guarda per trovare l'elemento `svg`: abbastanza per un prologo con
/// commenti di licenza e un DOCTYPE con entità.
const SVG_PROLOGUE_BYTES = 64 * 1024;
/// L'apertura dell'elemento radice, senza badare a maiuscole.
const SVG_ELEMENT = /^<(?:svg)[\s>/]/i;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/// Dove comincia l'elemento `svg` dopo il prologo che XML ammette — BOM,
/// spazi, dichiarazione, istruzioni, commenti, DOCTYPE anche con un
/// sottoinsieme interno — o `null` se il testo non è un SVG.
export function svgStart(text: string): number | null {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (text.slice(i, i + 9).toUpperCase() === "<!DOCTYPE") {
      // Il sottoinsieme interno fra `[` e `]` può contenere `>`.
      let depth = 0;
      let j = i + 9;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (j >= text.length) return null;
      i = j + 1;
      continue;
    }
    break;
  }
  return SVG_ELEMENT.test(text.slice(i, i + 5)) ? i : null;
}

/// Le misure che un SVG dichiara: `width`/`height` in px (o senza unità),
/// altrimenti la `viewBox`. Percentuali ed em non sono misure intrinseche.
export function svgSize(text: string, start = svgStart(text) ?? 0): Size | null {
  const end = text.indexOf(">", start);
  if (end < 0) return null;
  const tag = text.slice(start, end);
  const attribute = (name: string): string | null => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
    return match ? match[2]!.trim() : null;
  };
  const length = (value: string | null): number | null => {
    const match = /^(\d+(?:\.\d+)?)\s*(px)?$/i.exec(value ?? "");
    const n = match ? Number(match[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const width = length(attribute("width"));
  const height = length(attribute("height"));
  const box = (attribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const boxed = box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0
    ? { width: box[2]!, height: box[3]! }
    : null;
  if (width && height) return { width, height };
  if (boxed && width) return { width, height: (width * boxed.height) / boxed.width };
  if (boxed && height) return { width: (height * boxed.width) / boxed.height, height };
  return boxed;
}

/**
 * Verifica la firma e costruisce il Blob revocabile. SVG: l'elemento `svg`
 * dopo il prologo XML (mai script: l'SVG si mostra come `<img>`, inerte).
 * Rifiuta con un errore che dice specie attesa, byte avuti e primi byte in
 * esadecimale.
 */
export function decodeImage(descriptor: ResourceDescriptor, bytes: Uint8Array): DecodedImage {
  if (bytes.byteLength === 0) {
    throw new Error(`image ${descriptor.id} is empty: no bytes to decode`);
  }
  if (descriptor.mime === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes.subarray(0, SVG_PROLOGUE_BYTES));
    const start = svgStart(text);
    if (start === null) {
      const head = text.replace(/^﻿/, "").trimStart().slice(0, 16);
      throw new Error(`image ${descriptor.id} claims SVG but starts with ${JSON.stringify(head)}`);
    }
    const size = svgSize(text, start);
    const blob = new Blob([bytes as BlobPart], { type: descriptor.mime });
    return {
      blob,
      url: URL.createObjectURL(blob),
      width: size ? Math.round(size.width) : null,
      height: size ? Math.round(size.height) : null,
      format: "SVG",
    };
  }
  const undecodable = UNDECODABLE[descriptor.mime];
  if (undecodable) throw new Error(t("media.image.unsupported", { format: undecodable }));
  const known = SIGNATURES.find((entry) => entry.mime === descriptor.mime);
  if (!known) {
    throw new Error(`image ${descriptor.id} has unsupported type ${descriptor.mime}`);
  }
  if (descriptor.mime === "image/avif") {
    const ftyp = new TextDecoder().decode(bytes.slice(4, 8));
    if (bytes.byteLength < 12 || ftyp !== "ftyp") {
      throw new Error(`image ${descriptor.id} claims AVIF but has no ftyp box`);
    }
  } else if (descriptor.mime === "image/webp") {
    const riff = new TextDecoder().decode(bytes.slice(8, 12));
    if (bytes.byteLength < 12 || riff !== "WEBP") {
      throw new Error(`image ${descriptor.id} claims WebP but has no WEBP chunk`);
    }
  } else if (!startsWith(bytes, known.magic)) {
    const head = Array.from(bytes.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    throw new Error(
      `image ${descriptor.id} claims ${known.kind} but starts with ${head} (${bytes.byteLength} bytes)`,
    );
  }
  const blob = new Blob([bytes as BlobPart], { type: descriptor.mime });
  const url = URL.createObjectURL(blob);
  const dims = known.kind === "PNG" ? pngDimensions(bytes) : known.kind === "GIF" ? gifDimensions(bytes) : null;
  return { blob, url, width: dims?.[0] ?? null, height: dims?.[1] ?? null, format: known.kind };
}

function plausible(width: number, height: number): [number, number] | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (width === 0 || height === 0 || width > 100_000 || height > 100_000) return null;
  return [width, height];
}

function pngDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return plausible(view.getUint32(16), view.getUint32(20));
}

function gifDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.byteLength < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return plausible(view.getUint16(6, true), view.getUint16(8, true));
}

export interface ImageView {
  readonly element: HTMLElement;
  destroy(): void;
}

/// La riga sotto l'immagine: formato, misure quando si sanno, peso.
export function imageInfo(image: Pick<DecodedImage, "format" | "blob">, width: number | null, height: number | null): string {
  const size = formatBytes(image.blob.size);
  return width && height
    ? t("media.image.info", { format: image.format, width, height, size })
    : t("media.image.info_unsized", { format: image.format, size });
}

/** Monta l'immagine decodificata in una vista con zoom. */
export function mountImageView(image: DecodedImage, alt: string, life: Lifetime): ImageView {
  const figure = document.createElement("figure");
  figure.className = "media-image";
  let revoked = false;
  function revoke(): void {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(image.url);
  }
  const view = mountZoomView(image.url, {
    label: alt,
    size: image.width && image.height ? { width: image.width, height: image.height } : null,
    backdrop: "checker",
    info: imageInfo(image, image.width, image.height),
    vector: image.format === "SVG",
    onError: () => {
      revoke();
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = t("media.image.undecodable", { name: alt, mime: image.blob.type, size: image.blob.size });
      figure.replaceChildren(message);
    },
  }, life);
  life.listen(view.image, "load", () => {
    const width = view.image.naturalWidth || image.width;
    const height = view.image.naturalHeight || image.height;
    view.info(imageInfo(image, width, height));
  });
  figure.append(view.element);
  life.add(() => {
    revoke();
    figure.remove();
  });
  return { element: figure, destroy: () => life.close() };
}
