// Le immagini di un diagramma importato, pronte per il disegno. Un disegno
// incorpora soltanto PNG, JPEG, WebP e GIF, ciascuna fino a 5 MiB, e resta
// modificabile fino a 20 MiB in tutto:
//
// - **un SVG** si disegna in PNG, al doppio della sua misura sul foglio;
// - **un altro formato** che il browser legge si ricodifica in PNG;
// - **un JPEG girato** si ricodifica diritto, come quando si incolla;
// - **un'immagine troppo pesante** si rimpicciolisce, e il rapporto lo dice;
// - **un'immagine fuori dal file**, o che non si legge, resta fuori, e il
//   rapporto lo dice.

import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { href as hrefKind } from "../scene/values";
import { browserCodec, dataBlob, dataUri, jpegOrientation, limitsFor, reduce, sniffRaster, type Decoded, type Encoded, type ImageCodec } from "../tools/images";
import { Notes, type Diagram, type ImageNode, type Layer, type Node } from "./diagram";

/// Ciò che il browser sa fare con le immagini.
export interface Pictures {
  readonly codec: ImageCodec;
  /// L'SVG di `blob` disegnato in PNG a `width` × `height` pixel; `null` se
  /// il browser non ci riesce.
  svg(blob: Blob, width: number, height: number): Promise<Blob | null>;
}

/// Le immagini col browser: `createImageBitmap` legge, il canvas scrive, e
/// un SVG si disegna come lo disegna un `img`, senza script né risorse di
/// fuori. `null` dove il browser non ha un codec.
export function browserPictures(): Pictures | null {
  const codec = browserCodec();
  if (codec === null) return null;
  return {
    codec,
    async svg(blob, width, height) {
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context === null) return null;
        context.drawImage(image, 0, 0, width, height);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      } catch {
        return null;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
}

/// Quanti pixel ha un SVG disegnato per ogni unità del foglio: due, per gli
/// schermi densi.
const SVG_DENSITY = 2;

/// Il lato più lungo di un SVG disegnato, almeno e al più: un'icona piccola
/// regge un ingrandimento, una tavola grande non pesa troppo.
const SVG_LEAST = 512;
const SVG_MOST = 4096;

/// I byte e il tipo del data URI `href`, in base64 o no; `null` se non lo è.
export function dataBytes(href: string): Blob | null {
  const blob = dataBlob(href);
  if (blob !== null) return blob;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[^,;]*)*),/i.exec(href.trim());
  if (match === null || /;base64$/i.test(match[2]!)) return null;
  try {
    return new Blob([decodeURIComponent(href.trim().slice(match[0].length))], { type: (match[1] ?? "text/plain").toLowerCase() });
  } catch {
    return null;
  }
}

/// I pixel di un SVG largo `width` e alto `height` sul foglio.
export function svgPixels(width: number, height: number): readonly [number, number] {
  const long = Math.max(width, height, 1e-9);
  const scale = Math.min(SVG_MOST, Math.max(SVG_LEAST, long * SVG_DENSITY)) / long;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/// Il nome della radice di un SVG. Sta in una costante: nessun file del
/// client scrive quel tag a mano fuori dalle prove.
const SVG_ROOT = "svg";

/// L'inizio di un SVG: la dichiarazione, i commenti e il DOCTYPE, se ci
/// sono, e la radice.
const SVG_HEAD = new RegExp(String.raw`^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype ${SVG_ROOT}[^>]*>\s*)?<${SVG_ROOT}[\s>]`, "i");

/// Se `bytes` sono un SVG, anche senza dirlo.
function looksSvg(type: string, bytes: Uint8Array): boolean {
  if (type === "image/svg+xml") return true;
  return SVG_HEAD.test(new TextDecoder().decode(bytes.subarray(0, 512)).trimStart());
}

/// Un'immagine letta, prima di diventare un `href`.
interface Ready {
  readonly encoded: Encoded;
  /// Se è stata rimpicciolita.
  readonly reduced: boolean;
}

/// Prepara le immagini di un diagramma, una volta per immagine uguale.
class Settler {
  private readonly cache = new Map<string, Promise<Ready | null>>();

  constructor(
    private readonly pictures: Pictures | null,
    private readonly notes: Notes,
  ) {}

  /// `node` pronto, sotto `limit` byte; `null` se resta fuori.
  async node(node: ImageNode, limit: number): Promise<ImageNode | null> {
    const kind = hrefKind(node.href);
    if (kind.kind === "data" && kind.raster && kind.bytes <= limit) {
      const sniffed = await this.sniffed(node.href);
      if (sniffed === "same") return node;
    }
    if (kind.kind !== "data") {
      this.notes.add("image", node.href.length > 80 ? `${node.href.slice(0, 79)}…` : node.href);
      return null;
    }
    const [width, height] = [node.box.max[0] - node.box.min[0], node.box.max[1] - node.box.min[1]];
    const key = `${limit} ${width} ${height} ${node.href}`;
    let ready = this.cache.get(key);
    if (ready === undefined) {
      ready = this.ready(node.href, width, height, limit);
      this.cache.set(key, ready);
    }
    const done = await ready;
    if (done === null) {
      this.notes.add("image", /^data:([^;,]*)/i.exec(node.href)?.[1] ?? "");
      return null;
    }
    if (done.reduced) this.notes.add("reduced");
    return { ...node, href: dataUri(done.encoded.type, done.encoded.bytes) };
  }

  /// `"same"` se il data URI `href` porta davvero un'immagine del tipo che
  /// dice, e diritta: così entra com'è.
  private async sniffed(href: string): Promise<"same" | "other"> {
    const blob = dataBytes(href);
    if (blob === null) return "other";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = sniffRaster(bytes);
    if (type === null || type !== blob.type) return "other";
    return type === "image/jpeg" && jpegOrientation(bytes) !== 1 ? "other" : "same";
  }

  /// L'immagine di `href` come entra nel disegno, sotto `limit` byte.
  private async ready(href: string, width: number, height: number, limit: number): Promise<Ready | null> {
    const blob = dataBytes(href);
    if (blob === null) return null;
    let bytes = new Uint8Array(await blob.arrayBuffer());
    let type = sniffRaster(bytes);
    let source: Blob = blob;
    if (type === null && looksSvg(blob.type, bytes)) {
      if (this.pictures === null) return null;
      const [w, h] = svgPixels(width, height);
      const drawn = await this.pictures.svg(new Blob([bytes], { type: "image/svg+xml" }), w, h).catch(() => null);
      if (drawn === null) return null;
      source = drawn;
      bytes = new Uint8Array(await drawn.arrayBuffer());
      type = sniffRaster(bytes);
    }
    if (type === "image/jpeg" && jpegOrientation(bytes) !== 1) type = null;
    if (type !== null && bytes.length <= limit) return { encoded: { type, bytes }, reduced: false };
    if (this.pictures === null) return null;
    let decoded: Decoded | null;
    try {
      decoded = await this.pictures.codec.decode(source);
    } catch {
      decoded = null;
    }
    if (decoded === null) return null;
    try {
      if (type === null) {
        // Un JPEG girato resta JPEG, diritto; il resto diventa PNG, che non perde.
        const as = sniffRaster(bytes) === "image/jpeg" ? "image/jpeg" : "image/png";
        const encoded = await decoded.encode(as, 1);
        if (encoded === null) return null;
        if (encoded.length <= limit) return { encoded: { type: as, bytes: encoded }, reduced: false };
      }
      const smaller = await reduce(decoded, limit);
      return smaller === null ? null : { encoded: smaller, reduced: true };
    } finally {
      decoded.close();
    }
  }
}

/// Le immagini di `diagram`, nell'ordine in cui si scrivono.
export function imagesOf(diagram: Diagram): ImageNode[] {
  const out: ImageNode[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "image") out.push(node);
      else if (node.type === "group") walk(node.children);
    }
  };
  for (const layer of diagram.layers) walk(layer.nodes);
  return out;
}

/// I byte che un'immagine porta nel disegno, decodificati.
function imageBytes(node: ImageNode): number {
  const kind = hrefKind(node.href);
  return kind.kind === "data" ? kind.bytes : 0;
}

/// `diagram` con le immagini pronte per il disegno: ciascuna sotto 5 MiB e,
/// con `budget`, tutte insieme sotto `budget` byte, divisi in proporzione al
/// loro peso. Le note dicono quali restano fuori e quante si rimpiccioliscono.
export async function settleImages(diagram: Diagram, pictures: Pictures | null, budget: number | null = null): Promise<Diagram> {
  const images = imagesOf(diagram);
  if (images.length === 0) return diagram;
  const notes = new Notes(diagram.notes);
  const settler = new Settler(pictures, notes);
  const sizes = images.map(imageBytes);
  const limits = budget === null ? sizes.map(() => MAX_IMAGE_BYTES) : limitsFor(sizes, budget).map((limit) => Math.min(limit, MAX_IMAGE_BYTES));
  const settled = new Map<ImageNode, ImageNode | null>();
  // Una alla volta: un disegno con molte immagini grandi non le tiene tutte
  // decodificate insieme.
  for (const [i, node] of images.entries()) settled.set(node, await settler.node(node, limits[i]!));
  const walk = (nodes: readonly Node[]): Node[] =>
    nodes.flatMap((node): Node[] => {
      if (node.type === "image") {
        const done = settled.get(node);
        return done === null || done === undefined ? [] : [done];
      }
      if (node.type === "group") return [{ ...node, children: walk(node.children) }];
      return [node];
    });
  const layers: Layer[] = diagram.layers.map((layer) => ({ ...layer, nodes: walk(layer.nodes) }));
  return { ...diagram, layers, notes: notes.list() };
}
