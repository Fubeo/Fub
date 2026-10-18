// Le immagini incollate nel disegno: uno screenshot, una foto, un'immagine
// trascinata dal file manager. Entrano nel file come data URI di un `image`
// (formato della scena), e il disegno resta un file solo, che si apre e si
// manda così com'è.
//
// - **Il tipo vero.** PNG, JPEG, WebP e GIF si incorporano coi loro byte, e
//   il tipo si legge dai primi byte, non da ciò che dice chi incolla. Ogni
//   altra immagine che il browser sa leggere, come BMP o TIFF, diventa PNG,
//   che non perde niente. Una foto girata con l'EXIF si ricodifica diritta:
//   non tutti i lettori del file applicano l'EXIF.
// - **Il peso.** Un'immagine incorporata pesa al più 5 MiB, e le immagini di
//   un solo gesto se li dividono: così l'operazione resta una sola, sta nei
//   limiti delle operazioni anche in rete, e annulla la toglie intera. Il
//   disegno intero resta sotto il limite oltre il quale si apre in sola
//   lettura. Oltre, l'editor propone di ridurre: l'immagine perde pixel, non
//   misura sul foglio.
// - **Ridurre.** Un'immagine senza trasparenza diventa JPEG, che a parità di
//   peso tiene più dettaglio; una con la trasparenza resta PNG. Se non basta,
//   la si rimpicciolisce, a metà per volta, perché un passo solo da molto
//   grande a molto piccolo perde i dettagli fini.
// - **Dove va.** Al cursore, o al centro della vista, con la sua misura in
//   pixel come unità della scena; se non ci sta, la si rimpicciolisce fino a
//   prendere quattro quinti della vista.
//
// La lettura e la scrittura dei pixel passano da un [`ImageCodec`]: nel
// browser è quello di `createImageBitmap` e del canvas, nei test uno finto.
// Lo stesso codec dà a «Ricalca immagine» i pixel di un'immagine del
// disegno, rimpiccioliti a metà per volta se sono troppi.

import { formatNumber } from "../number";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { MAX_EDIT_BYTES } from "../scene/read";
import type { Elem } from "../scene/serialize";

/// I tipi che un disegno incorpora così come sono.
export type RasterType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/// I tipi in cui l'editor ricodifica.
export type EncodeType = "image/png" | "image/jpeg";

/// La qualità del JPEG di una riduzione: quella che i browser usano di
/// default, dove gli artefatti non si vedono ancora.
export const JPEG_QUALITY = 0.92;

/// La parte della vista che un'immagine incollata occupa al più.
export const VIEW_SHARE = 0.8;

/// Quanti tentativi fa una riduzione prima di arrendersi.
const REDUCE_ATTEMPTS = 8;

/// Il margine, per immagine, per il resto della riga dell'`image` nel file:
/// tag, id, coordinate e rientro.
const ELEMENT_BYTES = 256;

/// Lo spazio che serve almeno per proporre un'immagine: sotto, il disegno è
/// pieno.
export const MIN_ROOM = 16 * 1024;

/// Un'immagine letta: le misure in pixel e il modo di ricodificarla.
export interface Decoded {
  readonly width: number;
  readonly height: number;
  /// Nessun pixel trasparente, nemmeno in parte: si può fare JPEG.
  opaque(): boolean;
  /// I byte dell'immagine portata a `scale` delle sue misure, nel tipo
  /// chiesto; `null` se il browser non ci riesce o dà un altro tipo.
  encode(type: EncodeType, scale: number): Promise<Uint8Array | null>;
  /// I pixel del rettangolo `rect`, in RGBA, rimpiccioliti a metà per
  /// volta finché non sono più di `most`; `null` se il browser non ci
  /// riesce. Senza, l'immagine non si ricalca.
  pixels?(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, most: number): ImageData | null;
  close(): void;
}

export interface ImageCodec {
  /// `null` se non è un'immagine che il browser sa leggere.
  decode(blob: Blob): Promise<Decoded | null>;
}

/// Il tipo di un'immagine dai suoi primi byte; `null` se non è uno dei
/// quattro che un disegno incorpora.
export function sniffRaster(bytes: Uint8Array): RasterType | null {
  const at = (offset: number, text: string): boolean => {
    if (bytes.length < offset + text.length) return false;
    for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    return true;
  };
  if (at(0, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (at(0, "\xff\xd8\xff")) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  return null;
}

/// L'orientamento EXIF di un JPEG, da 1 a 8; 1, cioè diritto, se non lo
/// dice. Chi mostra il file non sempre lo applica: un JPEG girato si
/// ricodifica diritto, così ogni lettore lo vede come l'editor.
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    // L'inizio dell'immagine vera: l'EXIF, se c'è, è già passato.
    if (marker === 0xda || length < 2) return 1;
    const body = at + 4;
    const exif = marker === 0xe1 && body + 14 <= bytes.length &&
      bytes[body] === 0x45 && bytes[body + 1] === 0x78 && bytes[body + 2] === 0x69 && bytes[body + 3] === 0x66 &&
      bytes[body + 4] === 0 && bytes[body + 5] === 0;
    if (exif) {
      const tiff = body + 6;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
      const end = Math.min(bytes.length, at + 2 + length);
      const u16 = (offset: number): number | null =>
        offset + 2 > end ? null : little ? bytes[offset]! | (bytes[offset + 1]! << 8) : (bytes[offset]! << 8) | bytes[offset + 1]!;
      const u32 = (offset: number): number | null => {
        const high = u16(little ? offset + 2 : offset);
        const low = u16(little ? offset : offset + 2);
        return high === null || low === null ? null : high * 0x10000 + low;
      };
      const first = u32(tiff + 4);
      if (first === null) return 1;
      const ifd = tiff + first;
      const count = u16(ifd);
      if (count === null) return 1;
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        const tag = u16(entry);
        if (tag === null) return 1;
        if (tag !== 0x0112) continue;
        const value = u16(entry + 8);
        return value !== null && value >= 1 && value <= 8 ? value : 1;
      }
      return 1;
    }
    at += 2 + length;
  }
  return 1;
}

/// Un file SVG: dal tipo o, se il tipo manca, dal nome.
const isSvgFile = (file: File): boolean => file.type === "image/svg+xml" || (file.type === "" && /\.svg$/i.test(file.name));

/// I file di `data` che possono essere immagini: un SVG no, perché non è
/// raster e non si incorpora (formato della scena); entra come disegno.
export function imageFiles(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files).filter((file) => !isSvgFile(file) && (file.type === "" || file.type.startsWith("image/")));
}

/// I file SVG di `data`, che entrano come disegni (`clipboard.ts`).
export function svgFiles(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files).filter(isSvgFile);
}

/// `data` porta dei file: per sapere, durante un trascinamento, se il
/// rilascio può essere un'immagine, quando i file non si leggono ancora ma
/// se ne vedono il genere e il tipo.
export function carriesFiles(data: DataTransfer | null): boolean {
  if (data === null) return false;
  return Array.from(data.types).includes("Files") || Array.from(data.items ?? []).some((item) => item.kind === "file");
}

/// Il data URI di `bytes`, in base64.
export function dataUri(type: RasterType, bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return `data:${type};base64,${btoa(parts.join(""))}`;
}

/// I byte del data URI `href` in base64 di un'immagine, col suo tipo;
/// `null` se non lo è, o non si legge.
export function dataBlob(href: string): Blob | null {
  const match = /^data:(image\/[a-z0-9.+-]+)(?:;[^,;]*)*;base64,/i.exec(href.trim());
  if (match === null) return null;
  try {
    const text = atob(href.trim().slice(match[0].length).replace(/[\t\n\f\r ]+/g, ""));
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return new Blob([bytes], { type: match[1]!.toLowerCase() });
  } catch {
    return null;
  }
}

/// Quanti byte di immagini entrano ancora in un disegno di `docBytes` byte,
/// per `count` immagini: i byte decodificati, che in base64 diventano
/// quattro ogni tre.
export function roomFor(docBytes: number, count: number): number {
  const free = MAX_EDIT_BYTES - docBytes - count * ELEMENT_BYTES;
  return free <= 0 ? 0 : Math.floor((free * 3) / 4);
}

/// Il peso massimo di ciascuna immagine di un gesto: tutte insieme pesano al
/// più `budget`, e se lo superano se lo dividono in proporzione al loro peso.
export function limitsFor(sizes: readonly number[], budget: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= budget) return sizes.map(() => budget);
  return sizes.map((size) => Math.floor((budget * size) / total));
}

/// Il peso che un gesto può portare: 5 MiB, o meno se il disegno è quasi al
/// suo limite.
export function budgetFor(docBytes: number, count: number): number {
  return Math.min(MAX_IMAGE_BYTES, roomFor(docBytes, count));
}

/// Un'immagine pronta per il file.
export interface Encoded {
  readonly type: RasterType;
  readonly bytes: Uint8Array;
}

/// `decoded` ricodificata sotto `limit` byte: JPEG se è opaca, PNG se no, e
/// rimpicciolita finché non ci sta. `null` se il browser non ci riesce.
export async function reduce(decoded: Decoded, limit: number): Promise<Encoded | null> {
  const type: EncodeType = decoded.opaque() ? "image/jpeg" : "image/png";
  let scale = 1;
  for (let attempt = 0; attempt < REDUCE_ATTEMPTS; attempt++) {
    const bytes = await decoded.encode(type, scale);
    if (bytes === null) return null;
    if (bytes.length <= limit) return { type, bytes };
    // Il peso segue il numero dei pixel: la scala nuova lo porta sotto il
    // limite, con un margine, e scende almeno di un decimo per volta.
    scale *= Math.min(0.9, Math.sqrt(limit / bytes.length) * 0.95);
    if (decoded.width * scale < 1 || decoded.height * scale < 1) return null;
  }
  return null;
}

/// Dove va un'immagine di `width` × `height` pixel nella scena: centrata in
/// `at`, o al centro di `view`, una unità per pixel e al più quattro quinti
/// della vista. Se ci sta, non esce dalla vista.
export function placeImage(width: number, height: number, view: Bounds, at: Point | null): Bounds {
  const viewW = view.max[0] - view.min[0];
  const viewH = view.max[1] - view.min[1];
  // Una vista senza misura, come un foglio non ancora in pagina, non
  // rimpicciolisce e non trattiene.
  const sized = viewW > 0 && viewH > 0;
  const fit = sized ? Math.min(1, (VIEW_SHARE * viewW) / width, (VIEW_SHARE * viewH) / height) : 1;
  const w = width * fit;
  const h = height * fit;
  const center: Point = at ?? [(view.min[0] + view.max[0]) / 2, (view.min[1] + view.max[1]) / 2];
  const inside = (c: number, half: number, min: number, max: number): number =>
    sized ? Math.min(Math.max(c, min + half), max - half) : c;
  const cx = inside(center[0], w / 2, view.min[0], view.max[0]);
  const cy = inside(center[1], h / 2, view.min[1], view.max[1]);
  return { min: [cx - w / 2, cy - h / 2], max: [cx + w / 2, cy + h / 2] };
}

/// L'elemento di un'immagine nel riquadro `box`, nelle coordinate del
/// livello che la riceve, con la geometria a due decimali come le forme.
export function imageElem(id: string, href: string, box: Bounds): Elem {
  const text = (value: number): string => formatNumber(value, 2);
  // Un lato nullo non si disegnerebbe: il più piccolo che il file scrive.
  const side = (value: number): string => text(Math.max(0.01, Number(text(value))));
  return {
    tag: "image",
    attrs: { id, x: text(box.min[0]), y: text(box.min[1]), width: side(box.max[0] - box.min[0]), height: side(box.max[1] - box.min[1]), href },
  };
}

// --- Il codec del browser ----------------------------------------------------

/// Il lato lungo a cui si guarda la trasparenza: un'immagine più piccola
/// mescola i pixel, e un pixel trasparente lascia comunque un segno.
const ALPHA_PROBE = 1024;

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function draw(source: CanvasImageSource, from: { width: number; height: number }, width: number, height: number): HTMLCanvasElement | null {
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, from.width, from.height, 0, 0, width, height);
  return canvas;
}

/// `bitmap` a `width` × `height`, a metà per volta.
function scaled(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement | null {
  let source: CanvasImageSource = bitmap;
  let size = { width: bitmap.width, height: bitmap.height };
  while (size.width / 2 >= width && size.height / 2 >= height) {
    const half = { width: Math.max(1, Math.round(size.width / 2)), height: Math.max(1, Math.round(size.height / 2)) };
    const step = draw(source, size, half.width, half.height);
    if (step === null) return null;
    source = step;
    size = half;
  }
  return draw(source, size, width, height);
}

function blobOf(canvas: HTMLCanvasElement, type: EncodeType): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

/// Il codec del browser: `createImageBitmap` legge, il canvas scrive.
/// `null` dove il browser non li ha.
export function browserCodec(): ImageCodec | null {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  return {
    async decode(blob) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      } catch {
        return null;
      }
      if (bitmap.width === 0 || bitmap.height === 0) {
        bitmap.close();
        return null;
      }
      let opaque: boolean | null = null;
      return {
        width: bitmap.width,
        height: bitmap.height,
        opaque() {
          if (opaque !== null) return opaque;
          const fit = Math.min(1, ALPHA_PROBE / Math.max(bitmap.width, bitmap.height));
          const probe = scaled(bitmap, Math.max(1, Math.round(bitmap.width * fit)), Math.max(1, Math.round(bitmap.height * fit)));
          const data = probe?.getContext("2d")?.getImageData(0, 0, probe.width, probe.height).data;
          opaque = data !== undefined;
          if (data !== undefined) {
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] !== 255) {
                opaque = false;
                break;
              }
            }
          }
          return opaque;
        },
        pixels(rect, most) {
          let source: CanvasImageSource = bitmap;
          let from = { ...rect };
          let [width, height] = [rect.width, rect.height];
          for (;;) {
            const step = width * height > most && (width > 1 || height > 1);
            if (step) [width, height] = [Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))];
            else if (source !== bitmap) break;
            const canvas = canvasOf(width, height);
            const context = canvas.getContext("2d");
            if (context === null) return null;
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.drawImage(source, from.x, from.y, from.width, from.height, 0, 0, width, height);
            source = canvas;
            from = { x: 0, y: 0, width, height };
          }
          try {
            return (source as HTMLCanvasElement).getContext("2d")?.getImageData(0, 0, width, height) ?? null;
          } catch {
            return null;
          }
        },
        async encode(type, scale) {
          const width = Math.max(1, Math.round(bitmap.width * scale));
          const height = Math.max(1, Math.round(bitmap.height * scale));
          const canvas = scaled(bitmap, width, height);
          if (canvas === null) return null;
          const out = await blobOf(canvas, type);
          if (out === null || out.type !== type) return null;
          return new Uint8Array(await out.arrayBuffer());
        },
        close() {
          bitmap.close();
        },
      };
    },
  };
}
