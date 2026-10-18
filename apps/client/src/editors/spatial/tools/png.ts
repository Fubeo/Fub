// La selezione copiata come PNG, per chi non legge un SVG: lo stesso
// documento che va negli appunti, disegnato dal browser.
//
// - **Si vede tutto.** Dentro un'immagine il browser non carica niente da
//   fuori: le immagini del vault vi entrano coi loro byte, come in Lettura
//   (`read-images.ts`), e i caratteri dell'app come in ogni immagine del
//   disegno (`picture.ts`).
// - **Doppia densità**: due pixel per ogni pixel CSS, finché il lato e
//   l'area restano quelli che ogni browser disegna in un canvas; oltre, la
//   densità scende quanto serve.
// - **La misura vera.** Il PNG dice la sua densità (`pHYs`): chi lo mette in
//   un documento lo fa grande quanto il disegno.

/// I pixel per pixel CSS di un PNG copiato.
export const PNG_SCALE = 2;

/// Il lato più lungo e l'area di un canvas che ogni browser disegna.
export const MAX_PNG_SIDE = 16384;
export const MAX_PNG_AREA = 32 * 1024 * 1024;

/// Pixel CSS per pollice.
const CSS_DPI = 96;

/// Le misure di un PNG copiato.
export interface PngSize {
  readonly width: number;
  readonly height: number;
  /// I pixel per pixel CSS.
  readonly scale: number;
}

/// Le misure in pixel del PNG di un disegno di `width` × `height` pixel
/// CSS: [`PNG_SCALE`] per pixel, o meno se il canvas non lo terrebbe.
/// `null` se il disegno non ha misura.
export function pngSize(width: number, height: number): PngSize | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const scale = Math.min(PNG_SCALE, MAX_PNG_SIDE / Math.max(width, height), Math.sqrt(MAX_PNG_AREA / (width * height)));
  return {
    width: Math.max(1, Math.min(MAX_PNG_SIDE, Math.floor(width * scale))),
    height: Math.max(1, Math.min(MAX_PNG_SIDE, Math.floor(height * scale))),
    scale,
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

/// Il CRC-32 di un chunk PNG, sul suo tipo e i suoi dati.
function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const word = (bytes: Uint8Array, at: number): number => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const chunkType = (bytes: Uint8Array, at: number): string => String.fromCharCode(...bytes.subarray(at + 4, at + 8));

/// `png` con la densità di `scale` pixel per pixel CSS, in un chunk `pHYs`
/// subito dopo `IHDR`. Un PNG che la dice già, o che non si legge, resta
/// com'è.
export function withDensity(png: Uint8Array, scale: number): Uint8Array {
  if (png.length < 33 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte) || chunkType(png, 8) !== "IHDR") return png;
  for (let at = 8; at + 8 <= png.length; ) {
    const type = chunkType(png, at);
    if (type === "pHYs") return png;
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + word(png, at);
  }
  const perMeter = Math.round((CSS_DPI * scale) / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, perMeter);
  view.setUint32(12, perMeter);
  // L'unità è il metro.
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const end = 8 + 12 + word(png, 8);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, end));
  out.set(chunk, end);
  out.set(png.subarray(end), end + chunk.length);
  return out;
}

/// Il PNG di `svg`, un documento SVG che si vede da solo, alla misura in
/// pixel CSS che dà la sua radice; `null` se il browser non lo disegna.
export async function rasterize(svg: string): Promise<Blob | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = pngSize(image.naturalWidth, image.naturalHeight);
    if (size === null) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) return null;
    return new Blob([withDensity(new Uint8Array(await blob.arrayBuffer()), size.scale) as BlobPart], { type: "image/png" });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
