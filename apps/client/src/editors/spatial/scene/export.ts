// Che cosa entra nel file di un export (formato della scena, export): la
// derivazione, che dal testo del disegno fa il testo da esportare, e la misura
// di un'immagine raster. L'host fa lo stesso in `fub-scene` prima di scrivere
// il file, e la finestra «Esporta» lo fa qui per l'anteprima e per dire la
// misura: i vettori di `__fixtures__/scene-export/` li provano tutti e due.
//
// La derivazione cambia il testo in tre punti e lascia uguale ogni altro byte:
//
// 1. **il rettangolo:** la radice prende `viewBox`, `width` e `height` di una
//    tavola o del riquadro della selezione;
// 2. **la selezione:** lungo la strada dalla radice a ogni oggetto scelto si
//    tolgono gli elementi grafici che non sono scelti, non ne contengono uno e
//    non sono una carta;
// 3. **lo sfondo** `none` toglie le carte.

import { formatNumber } from "../number";
import { boardBox, classifyChild, resourceIndex } from "./classify";
import { ReadError } from "./read";
import { SourceText } from "./text";
import { attrOf, isSvg, NS_FUB, NS_NONE, NS_SVG, parseXml, valueOf, XmlError, type ElementNode, type NodeId, type XmlDocument } from "./xml";

/// Un rettangolo sulla tela: angolo in alto a sinistra, larghezza e altezza.
export type ExportBox = readonly [x: number, y: number, width: number, height: number];

/// Che cosa esce in un file: il disegno intero, una tavola, o gli oggetti
/// scelti ritagliati sul loro riquadro.
export type ExportScope =
  | { readonly kind: "drawing" }
  | { readonly kind: "board"; readonly id: string }
  | { readonly kind: "selection"; readonly ids: readonly string[]; readonly box: ExportBox };

/// Lo sfondo: le carte del disegno, o niente.
export type ExportBackground = "paper" | "none";

/// Perché una derivazione non si fa: una tavola che il disegno non ha, un id
/// scelto che non è un oggetto, un riquadro senza area.
export type DeriveRefusal = "unknown-board" | "unknown-object" | "empty-selection" | "bad-box";

export class DeriveError extends Error {
  constructor(
    readonly refusal: DeriveRefusal,
    /// L'id che non va, per le prime due.
    readonly id: string | null = null,
  ) {
    super(id === null ? refusal : `${refusal}: ${id}`);
    this.name = "DeriveError";
  }
}

/// Gli elementi grafici di SVG: quelli che la selezione toglie.
const GRAPHIC = new Set(["a", "circle", "ellipse", "foreignObject", "g", "image", "line", "path", "polygon", "polyline", "rect", "svg", "switch", "text", "use"]);

/// Gli elementi grafici che ne contengono altri.
const GRAPHIC_CONTAINERS = new Set(["a", "g", "svg", "switch"]);

/// I decimali dei numeri del rettangolo, quelli della geometria.
const BOX_PLACES = 2;

function isGraphic(element: ElementNode): boolean {
  return element.ns === NS_SVG && GRAPHIC.has(element.local);
}

/// Vero se `element`, figlio della radice, è una carta.
function isPaper(element: ElementNode): boolean {
  return element.ns === NS_SVG && element.local === "rect" && valueOf(element, NS_FUB, "role") === "paper";
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/// Il cambio che toglie il nodo `id`: dal suo inizio alla sua fine, con lo
/// spazio bianco che lo precede nel genitore se è un nodo di testo di soli
/// spazi.
function removal(doc: XmlDocument, id: NodeId): Edit {
  const node = doc.nodes[id]!;
  const siblings = node.parent === null ? doc.top : doc.children(node.parent);
  const at = siblings.indexOf(id);
  const before = at > 0 ? doc.nodes[siblings[at - 1]!]! : null;
  const start = before?.kind === "text" && before.blank ? before.start : node.start;
  return { start, end: node.end, text: "" };
}

/// I cambi che portano la radice sul rettangolo `box`: un attributo che c'è
/// cambia valore sul posto, quelli che mancano si aggiungono in quest'ordine
/// dopo l'ultimo attributo. La radice ne ha sempre uno: la dichiarazione del
/// namespace di SVG.
function onBox(root: ElementNode, box: ExportBox): Edit[] {
  const edits: Edit[] = [];
  let added = "";
  const values = [
    ["viewBox", box.map((n) => formatNumber(n, BOX_PLACES)).join(" ")],
    ["width", formatNumber(box[2], BOX_PLACES)],
    ["height", formatNumber(box[3], BOX_PLACES)],
  ] as const;
  for (const [local, value] of values) {
    const attr = attrOf(root, NS_NONE, local);
    if (attr === undefined) added += ` ${local}="${value}"`;
    else edits.push({ start: attr.raw[0], end: attr.raw[1], text: value });
  }
  if (added !== "") {
    // Dopo la virgoletta che chiude il valore.
    const end = root.attrs[root.attrs.length - 1]!.raw[1] + 1;
    edits.push({ start: end, end, text: added });
  }
  return edits;
}

/// La tavola `id`: un `view` della radice che la scena legge come tavola.
function boardRect(doc: XmlDocument, id: string): ExportBox {
  const kinds = resourceIndex(doc);
  const resolve = (ref: string) => kinds.get(ref) ?? null;
  for (const child of doc.children(doc.root)) {
    const element = doc.element(child);
    if (element === null || valueOf(element, NS_NONE, "id") !== id) continue;
    if (classifyChild(doc, child, "root", 1, resolve)?.[1] !== "board") continue;
    const box = boardBox(element);
    if (box !== null) return box;
  }
  throw new DeriveError("unknown-board", id);
}

/// Gli elementi grafici a cui si arriva dalla radice passando soltanto per
/// elementi grafici, per id: di due con lo stesso id vale il primo. Le carte
/// non ci sono.
function graphicIds(doc: XmlDocument): Map<string, NodeId> {
  const found = new Map<string, NodeId>();
  const visit = (parent: NodeId, atRoot: boolean): void => {
    for (const child of doc.children(parent)) {
      const element = doc.element(child);
      if (element === null || !isGraphic(element) || (atRoot && isPaper(element))) continue;
      const id = valueOf(element, NS_NONE, "id");
      if (id !== undefined && !found.has(id)) found.set(id, child);
      if (GRAPHIC_CONTAINERS.has(element.local)) visit(child, false);
    }
  };
  visit(doc.root, true);
  return found;
}

/// I cambi che lasciano, degli elementi grafici, solo gli oggetti `ids`, ciò
/// che li contiene e le carte.
function selectionEdits(doc: XmlDocument, ids: readonly string[]): Edit[] {
  if (ids.length === 0) throw new DeriveError("empty-selection");
  const known = graphicIds(doc);
  const chosen = new Set<NodeId>();
  for (const id of ids) {
    const node = known.get(id);
    if (node === undefined) throw new DeriveError("unknown-object", id);
    chosen.add(node);
  }
  // Ciò che contiene un oggetto scelto, e ciò che sta dentro uno scelto: il
  // contenuto di uno scelto resta tutto.
  const inside = (id: NodeId): boolean => {
    for (let at = doc.nodes[id]!.parent; at !== null; at = doc.nodes[at]!.parent) {
      if (chosen.has(at)) return true;
    }
    return false;
  };
  const holders = new Set<NodeId>();
  for (const node of chosen) {
    for (let at = doc.nodes[node]!.parent; at !== null; at = doc.nodes[at]!.parent) holders.add(at);
  }
  const edits: Edit[] = [];
  for (const holder of holders) {
    if (chosen.has(holder) || inside(holder)) continue;
    for (const child of doc.children(holder)) {
      const element = doc.element(child);
      if (element === null || !isGraphic(element) || chosen.has(child) || holders.has(child)) continue;
      if (holder === doc.root && isPaper(element)) continue;
      edits.push(removal(doc, child));
    }
  }
  return edits;
}

/// Il documento intero, anche oltre la misura fino a cui l'editor lo modifica:
/// l'export li scrive tutti.
function readWhole(svg: string): XmlDocument {
  const text = new SourceText(svg);
  let doc: XmlDocument;
  try {
    doc = parseXml(text, false);
  } catch (error) {
    if (error instanceof XmlError) throw new ReadError("malformed", error.offset, error.kind);
    throw error;
  }
  const root = doc.element(doc.root)!;
  if (!isSvg(root, "svg")) throw new ReadError("not-svg", text.byteOf(root.start));
  return doc;
}

/// Il testo da esportare: `svg` con l'ambito `scope` e lo sfondo `background`.
/// Lancia [`DeriveError`] per una tavola che non c'è, un id scelto che non è
/// un oggetto o un riquadro senza area; [`ReadError`](./read) se `svg` non è
/// un SVG.
export function deriveExport(svg: string, scope: ExportScope, background: ExportBackground): string {
  const doc = readWhole(svg);
  const source = doc.source.text;
  const root = doc.element(doc.root)!;
  const edits: Edit[] = [];
  if (scope.kind === "board") edits.push(...onBox(root, boardRect(doc, scope.id)));
  if (scope.kind === "selection") {
    const box = scope.box;
    if (box.length !== 4 || !box.every(Number.isFinite) || Number(formatNumber(box[2], BOX_PLACES)) <= 0 || Number(formatNumber(box[3], BOX_PLACES)) <= 0) {
      throw new DeriveError("bad-box");
    }
    edits.push(...selectionEdits(doc, scope.ids), ...onBox(root, box));
  }
  if (background === "none") {
    for (const child of doc.children(doc.root)) {
      const element = doc.element(child);
      if (element !== null && isPaper(element)) edits.push(removal(doc, child));
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const edit of edits) {
    out += source.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + source.slice(at);
}

// ---------------------------------------------------------------------------
// La misura
// ---------------------------------------------------------------------------

/// Il lato più lungo di un'immagine, in pixel.
export const SIDE_MAX = 16_384;
/// Quanti pixel può avere un'immagine: 32 milioni.
export const AREA_MAX = 33_554_432;
/// La scala più grande che si può chiedere.
export const SCALE_MAX = 8;

/// Come si chiede la misura: una scala, o una larghezza in pixel.
export type ExportSize = { readonly scale: number } | { readonly pixels: number };

/// La misura di un'immagine: la scala a cui si disegna, i pixel, e se la
/// scala chiesta è stata ridotta per stare nei limiti.
export interface ExportMeasure {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly reduced: boolean;
}

const f32 = Math.fround;

/// Vero se un'immagine di `w` × `h` pixel sta nei limiti.
function fitsPixels(w: number, h: number): boolean {
  return w <= SIDE_MAX && h <= SIDE_MAX && f32(w * h) <= AREA_MAX;
}

/// I pixel di un lato `side` alla scala `scale`.
function pixels(side: number, scale: number): number {
  return Math.ceil(f32(side * scale));
}

/// La scala a cui `width` × `height` sta nei limiti: `asked`, o la più grande
/// sotto di lei che ci sta. Il conto è a 32 bit, come quello dell'host.
function fittingScale(width: number, height: number, asked: number): number {
  const fits = (scale: number): boolean => fitsPixels(pixels(width, scale), pixels(height, scale));
  if (fits(asked)) return asked;
  let scale = Math.min(f32(SIDE_MAX / width), f32(SIDE_MAX / height), f32(Math.sqrt(f32(AREA_MAX / f32(width * height)))), asked);
  // L'arrotondamento per eccesso dei lati può sforare di un pixel.
  while (!fits(scale) && scale > 0) scale = f32(scale * f32(0.999));
  return scale;
}

/// La misura di un'immagine del rettangolo `width` × `height` (in unità del
/// disegno) chiesta con `size`. Con una larghezza in pixel l'immagine è larga
/// esattamente così, se ci sta nei limiti; con una scala come l'host ha
/// sempre fatto.
export function measureExport(width: number, height: number, size: ExportSize): ExportMeasure {
  const [w, h] = [f32(width), f32(height)];
  if ("pixels" in size) {
    const scale = f32(size.pixels / w);
    const tall = pixels(h, scale);
    if (fitsPixels(size.pixels, tall)) return { scale, width: size.pixels, height: tall, reduced: false };
    const fitted = fittingScale(w, h, scale);
    return { scale: fitted, width: pixels(w, fitted), height: pixels(h, fitted), reduced: true };
  }
  const asked = f32(size.scale);
  const scale = fittingScale(w, h, asked);
  return { scale, width: pixels(w, scale), height: pixels(h, scale), reduced: scale < asked };
}
