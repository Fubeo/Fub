// La view immagine (P07/F23): decodifica, errori, limiti, rilascio.
//
// I byte arrivano dalla porta (`readAll`, tetto inline imposto), mai da cifre
// inventate: `decodeImage` verifica la firma (PNG/JPEG/GIF/WebP/BMP/AVIF,
// SVG come testo) e rifiuta il resto con un errore che nomina specie e byte.
// Il rendering usa un `blob:` revocato al teardown: niente URL che
// sopravvivono alla chiusura, niente `data:` giganti nel DOM. Le immagini
// rotte mostrano specie, dimensione ed errore — mai un riquadro vuoto.

import type { Lifetime } from "../../ui/lifetime";
import type { ResourceDescriptor } from "./media-types";
import { t } from "../../i18n/strings";

export interface DecodedImage {
  readonly blob: Blob;
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
}

const SIGNATURES: { kind: string; mime: string; magic: number[] }[] = [
  { kind: "PNG", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: "JPEG", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { kind: "GIF", mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
  { kind: "WebP", mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
  { kind: "BMP", mime: "image/bmp", magic: [0x42, 0x4d] },
  { kind: "AVIF", mime: "image/avif", magic: [0x00, 0x00, 0x00] },
];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.byteLength < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Verifica la firma e costruisce il Blob revocabile. SVG: tag di apertura
 * dopo gli spazi (mai script: lo decide la sanitize, non qui). Rifiuta con un
 * errore che dice specie attesa, byte avuti e primi byte in esadecimale.
 */
export function decodeImage(descriptor: ResourceDescriptor, bytes: Uint8Array): DecodedImage {
  if (bytes.byteLength === 0) {
    throw new Error(`image ${descriptor.id} is empty: no bytes to decode`);
  }
  if (descriptor.mime === "image/svg+xml") {
    const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().slice(0, 4).toLowerCase();
    if (head.charCodeAt(0) !== 60 || head.slice(1) !== "svg") {
      throw new Error(`image ${descriptor.id} claims SVG but starts with ${JSON.stringify(head)}`);
    }
    const blob = new Blob([bytes as BlobPart], { type: descriptor.mime });
    return { blob, url: URL.createObjectURL(blob), width: null, height: null };
  }
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
  const dims = known.kind === "PNG" ? pngDimensions(bytes) : null;
  return { blob, url, width: dims?.[0] ?? null, height: dims?.[1] ?? null };
}

function pngDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (width === 0 || height === 0 || width > 100_000 || height > 100_000) return null;
  return [width, height];
}

export interface ImageView {
  readonly element: HTMLElement;
  destroy(): void;
}

/** Monta l'immagine decodificata: `loading="lazy"`, `decoding="async"`. */
export function mountImageView(image: DecodedImage, alt: string, life: Lifetime): ImageView {
  const figure = document.createElement("figure");
  figure.className = "media-image";
  const img = document.createElement("img");
  img.src = image.url;
  img.alt = alt;
  img.decoding = "async";
  img.loading = "lazy";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }
  figure.append(img);
  let revoked = false;
  function revoke(): void {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(image.url);
  }
  life.listen(img, "error", () => {
    revoke();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = t("media.image.undecodable", { name: alt, mime: image.blob.type, size: image.blob.size });
    figure.replaceChildren(message);
  });
  life.add(() => {
    revoke();
    figure.remove();
  });
  return { element: figure, destroy: () => life.close() };
}
