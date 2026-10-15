// Importare un disegno da un altro programma: Excalidraw e draw.io. Il
// programma si riconosce dal nome del file e, se il nome non basta, dal
// contenuto; il suo lettore dà un diagramma (`diagram.ts`), le immagini si
// preparano (`images.ts`) e lo scrittore (`write.ts`) ne fa il testo di un
// disegno nuovo, con le note di ciò che non entra. Il file d'origine non
// cambia.

import { MAX_EDIT_BYTES } from "../scene/read";
import { utf8Length } from "../scene/text";
import type { Font } from "../tools/measure";
import type { Content, Diagram, Node, Note, Type } from "./diagram";
import { drawioInPng, NotDrawio, readDrawio } from "./drawio";
import { NotExcalidraw, readExcalidraw } from "./excalidraw";
import { imagesOf, settleImages, type Pictures } from "./images";
import { sourceOf, type Source } from "./sources";
import { TooLarge, writeDiagram, type Setup } from "./write";

export { importedName, IMPORT_ACCEPT, sourceOf, type Source } from "./sources";

/// Perché un file non si importa.
export type Unreadable =
  /// Non è un file di nessuno dei due programmi.
  | "format"
  /// È del programma, ma non ha niente da disegnare.
  | "empty"
  /// Non sta in un disegno: troppo grande anche con le immagini
  /// rimpicciolite, o con più oggetti, tavole o risorse di quanti un disegno
  /// ne tiene.
  | "large";

/// Un file che non si importa, col perché.
export class ImportError extends Error {
  constructor(readonly reason: Unreadable, message: string) {
    super(message);
  }
}

/// Ciò che può venire prima della radice di un XML: la dichiarazione, i
/// commenti e il DOCTYPE.
const PROLOG = String.raw`^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?`;

/// Il nome della radice di un SVG. Sta in una costante: nessun file del
/// client scrive quel tag a mano fuori dalle prove.
const SVG_ROOT = "svg";

/// Un XML di draw.io, e un SVG di draw.io, che porta il file nell'attributo
/// `content`.
const DRAWIO_XML = new RegExp(String.raw`${PROLOG}<(mxfile|mxGraphModel)[\s>]`);
const DRAWIO_SVG = new RegExp(String.raw`${PROLOG}<${SVG_ROOT}[^>]*\scontent="&lt;(mxfile|mxGraphModel)[\s&]`);

/// Il programma di un file dal contenuto: un JSON di Excalidraw o un XML di
/// draw.io.
function sniff(text: string): Source | null {
  const head = text.slice(0, 4096).trimStart();
  if (head.startsWith("{") && /"type"\s*:\s*"excalidraw(\/clipboard)?"/.test(head)) return "excalidraw";
  if (DRAWIO_XML.test(head) || DRAWIO_SVG.test(head)) return "drawio";
  return null;
}

/// Il diagramma del file `name` di byte `bytes`. Lancia [`ImportError`] se
/// non si importa.
export async function readDiagram(name: string, bytes: Uint8Array): Promise<Diagram> {
  // Un PNG di draw.io porta il file in un suo pezzo di testo.
  const inPng = drawioInPng(bytes);
  const text = inPng ?? new TextDecoder("utf-8").decode(bytes);
  const source = inPng !== null ? "drawio" : (sniff(text) ?? sourceOf(name));
  let diagram: Diagram;
  try {
    if (source === "excalidraw") diagram = readExcalidraw(text);
    else if (source === "drawio") diagram = readDrawio(text);
    else throw new ImportError("format", "il file non è di Excalidraw né di draw.io");
  } catch (error) {
    if (error instanceof NotExcalidraw || error instanceof NotDrawio) throw new ImportError("format", error.message);
    throw error;
  }
  if (countOf(diagram).objects === 0 && diagram.boards.length === 0) throw new ImportError("empty", "il file non ha niente da disegnare");
  return diagram;
}

/// Quanto entra nel disegno, per il riepilogo prima di scriverlo.
export interface Count {
  /// Gli oggetti, gruppi esclusi.
  readonly objects: number;
  readonly shapes: number;
  readonly texts: number;
  readonly lines: number;
  readonly ink: number;
  readonly images: number;
  readonly layers: number;
  readonly boards: number;
}

/// Quanto c'è in `diagram`.
export function countOf(diagram: Diagram): Count {
  const count = { objects: 0, shapes: 0, texts: 0, lines: 0, ink: 0, images: 0 };
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "group") {
        walk(node.children);
        continue;
      }
      count.objects++;
      if (node.type === "shape") count.shapes++;
      else if (node.type === "text") count.texts++;
      else if (node.type === "line" || node.type === "path") count.lines++;
      else if (node.type === "ink") count.ink++;
      else count.images++;
    }
  };
  for (const layer of diagram.layers) walk(layer.nodes);
  return { ...count, layers: Math.max(1, diagram.layers.length), boards: diagram.boards.length };
}

/// I caratteri dei testi di `diagram`, una volta per famiglia, peso e stile:
/// quelli che la misura deve avere prima di mandare a capo. Il corpo è
/// quello del primo testo che li usa.
export function fontsOf(diagram: Diagram): Font[] {
  const found = new Map<string, Font>();
  const add = (type: Type, run: Partial<Type> | null): void => {
    const font: Font = {
      family: run?.family ?? type.family,
      size: run?.size ?? type.size,
      weight: (run?.bold ?? type.bold) ? "bold" : "normal",
      style: (run?.italic ?? type.italic) ? "italic" : "normal",
      spacing: 0,
    };
    const key = `${font.family}|${font.weight}|${font.style}`;
    if (!found.has(key)) found.set(key, font);
  };
  const content = (each: Content | null): void => {
    if (each === null) return;
    add(each.type, null);
    for (const runs of each.paragraphs) for (const run of runs) if (run.type !== null) add(each.type, run.type);
  };
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "shape") content(node.label);
      else if (node.type === "text") content(node.content);
      else if (node.type === "line") for (const label of node.labels) content(label.content);
      else if (node.type === "group") walk(node.children);
    }
  };
  for (const layer of diagram.layers) walk(layer.nodes);
  return [...found.values()];
}

/// Il disegno scritto.
export interface Imported {
  /// Il testo del disegno nuovo.
  readonly text: string;
  /// Ciò che non entra, o entra cambiato.
  readonly notes: readonly Note[];
  readonly count: Count;
}

/// Il margine, per immagine, fra il posto che si misura per un'immagine e
/// quello che prende: il tipo nel data URI e il riempimento del base64.
const IMAGE_SLACK = 64;

/// Un'immagine vuota, al posto di quelle vere quando si misura il resto.
const STUB = "data:image/png;base64,iVBORw0KGgo=";

/// Il testo di `diagram`; `null` se non sta in un disegno.
function attempt(diagram: Diagram, setup: Setup): string | null {
  try {
    return writeDiagram(diagram, setup);
  } catch (error) {
    if (error instanceof TooLarge) return null;
    throw error;
  }
}

/// `diagram` con ogni immagine che porta `href`.
function withImages(diagram: Diagram, href: string): Diagram {
  const walk = (nodes: readonly Node[]): Node[] =>
    nodes.map((node): Node => (node.type === "image" ? { ...node, href } : node.type === "group" ? { ...node, children: walk(node.children) } : node));
  return { ...diagram, layers: diagram.layers.map((layer) => ({ ...layer, nodes: walk(layer.nodes) })) };
}

/// `diagram` senza ombre, con la nota di quante ne aveva; `null` se non ne
/// aveva.
function shadowless(diagram: Diagram): Diagram | null {
  let count = 0;
  const plain = <T extends { readonly shadow?: boolean }>(each: T): T => {
    if (each.shadow !== true) return each;
    count++;
    const { shadow: _, ...rest } = each;
    return rest as unknown as T;
  };
  const content = (each: Content | null): Content | null => (each === null ? null : plain(each));
  const walk = (nodes: readonly Node[]): Node[] =>
    nodes.map((node): Node => {
      switch (node.type) {
        case "shape":
          return { ...node, look: plain(node.look), label: content(node.label) };
        case "text":
          return { ...node, content: plain(node.content) };
        case "path":
          return { ...node, look: plain(node.look) };
        case "line":
          return { ...node, look: plain(node.look), labels: node.labels.map((label) => ({ ...label, content: plain(label.content) })) };
        case "image":
          return plain(node);
        case "group":
          return { ...node, children: walk(node.children) };
        case "ink":
          return node;
      }
    });
  const layers = diagram.layers.map((layer) => ({ ...layer, nodes: walk(layer.nodes) }));
  return count === 0 ? null : { ...diagram, layers, notes: [...diagram.notes, { kind: "shadow", count, sample: "" }] };
}

/// Il testo di `settled`, con le immagini già pronte, e il diagramma che
/// scrive; `null` se non sta in un disegno nemmeno con le immagini
/// rimpicciolite quanto serve.
async function written(settled: Diagram, setup: Setup, pictures: Pictures | null): Promise<{ readonly text: string; readonly diagram: Diagram } | null> {
  const images = imagesOf(settled);
  const carried = images.reduce((sum, node) => sum + node.href.length, 0);
  // Se le immagini da sole passano la misura, scrivere non serve.
  const text = carried + images.length * IMAGE_SLACK < MAX_EDIT_BYTES ? attempt(settled, setup) : null;
  if (text !== null) return { text, diagram: settled };
  if (carried === 0 || pictures === null) return null;
  // Il resto del disegno, con le immagini vuote, dice quanto posto resta
  // alle immagini: in base64, e poi in byte.
  const rest = attempt(withImages(settled, STUB), setup);
  const room = rest === null ? 0 : MAX_EDIT_BYTES - utf8Length(rest) - images.length * IMAGE_SLACK;
  if (room <= 0) return null;
  const smaller = await settleImages(settled, pictures, Math.floor((room * 3) / 4));
  const again = attempt(smaller, setup);
  return again === null ? null : { text: again, diagram: smaller };
}

/// Scrive `diagram` come disegno nuovo. Le immagini si preparano con
/// `pictures`; se il disegno supera la misura di un disegno modificabile, si
/// rimpiccioliscono quanto basta, e se non basta il disegno perde le ombre,
/// che hanno un filtro ciascuna. Lancia [`ImportError`] se il disegno non
/// ci sta comunque.
export async function writeImported(diagram: Diagram, setup: Setup, pictures: Pictures | null): Promise<Imported> {
  const settled = await settleImages(diagram, pictures);
  let done = await written(settled, setup, pictures);
  if (done === null) {
    const plain = shadowless(settled);
    if (plain !== null) done = await written(plain, setup, pictures);
  }
  if (done === null) throw new ImportError("large", "il disegno non sta nei limiti di un disegno");
  return { text: done.text, notes: done.diagram.notes, count: countOf(done.diagram) };
}
