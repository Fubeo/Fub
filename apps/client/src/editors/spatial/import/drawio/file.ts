// Il file di draw.io aperto: le pagine dell'XML, compresse o no, e il
// modello portato dentro un PNG (vedi `../drawio.ts`).

import { SourceText } from "../../scene/text";
import { parseXml, XmlError, type ElementNode, type XmlDocument } from "../../scene/xml";
import { InflateError, inflateRaw, inflateZlib } from "../inflate";

/// Il testo più lungo che una pagina compressa può diventare.
const PAGE_LIMIT = 64 * 1024 * 1024;

/// Perché un file non è un diagramma di draw.io.
export class NotDrawio extends Error {}

// ---------------------------------------------------------------------------
// Il file: le pagine, aperte.
// ---------------------------------------------------------------------------

/// Una pagina: il nome e il modello, nel documento che lo contiene.
export interface Page {
  readonly name: string;
  readonly doc: XmlDocument;
  readonly model: ElementNode;
}

/// `text` letto come XML; [`NotDrawio`] se non lo è.
function xmlOf(text: string): XmlDocument {
  try {
    return parseXml(new SourceText(text), false);
  } catch (error) {
    if (error instanceof XmlError) throw new NotDrawio(`l'XML non si legge: ${error.message}`);
    throw error;
  }
}

/// Gli elementi figli di `id`, nell'ordine.
export function elementsIn(doc: XmlDocument, element: ElementNode): ElementNode[] {
  return element.children.map((id) => doc.element(id)).filter((child): child is ElementNode => child !== null);
}

/// Il testo dentro `element`, senza i tag.
function textIn(doc: XmlDocument, element: ElementNode): string {
  let out = "";
  for (const id of element.children) {
    const node = doc.nodes[id]!;
    if (node.kind === "text" || node.kind === "cdata") out += node.value;
  }
  return out;
}

/// Il valore dell'attributo `name`, senza namespace.
export function attr(element: ElementNode, name: string): string | undefined {
  return element.attrs.find((each) => each.ns === 0 && each.local === name)?.value;
}

/// Un numero di un attributo o di uno stile; `fallback` se non si legge.
export function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/// Il testo di una pagina compressa: base64, deflate grezzo, e il testo
/// passato da `encodeURIComponent`.
function inflatePage(data: string): string {
  let binary: string;
  try {
    binary = atob(data.replace(/\s+/g, ""));
  } catch {
    throw new NotDrawio("una pagina compressa non è base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  let raw: Uint8Array;
  try {
    raw = inflateRaw(bytes, PAGE_LIMIT);
  } catch (error) {
    if (error instanceof InflateError) throw new NotDrawio(`una pagina compressa non si apre: ${error.message}`);
    throw error;
  }
  const text = new TextDecoder("utf-8").decode(raw);
  if (text.trimStart().startsWith("<")) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/// I caratteri di controllo che XML non ammette, e che draw.io toglie prima
/// di leggere (`Graph.zapGremlins`).
const GREMLINS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/// Le pagine di `text`: un `mxfile` con le sue pagine, un `mxGraphModel`
/// solo, o un SVG di draw.io col file nell'attributo `content`.
export function pagesOf(text: string): Page[] {
  const doc = xmlOf(text.replace(GREMLINS, ""));
  const root = doc.element(doc.root)!;
  if (root.local === "svg") {
    const content = attr(root, "content");
    if (content === undefined || !/<(mxfile|mxGraphModel)[\s>]/.test(content.slice(0, 4096))) throw new NotDrawio("l'SVG non porta un diagramma di draw.io");
    return pagesOf(content);
  }
  if (root.local === "mxGraphModel") return [{ name: "", doc, model: root }];
  if (root.local !== "mxfile") throw new NotDrawio("non è un file di draw.io");
  const pages: Page[] = [];
  for (const diagram of elementsIn(doc, root)) {
    if (diagram.local !== "diagram") continue;
    const name = attr(diagram, "name") ?? "";
    const inline = elementsIn(doc, diagram).find((child) => child.local === "mxGraphModel");
    if (inline !== undefined) {
      pages.push({ name, doc, model: inline });
      continue;
    }
    const data = textIn(doc, diagram).trim();
    if (data === "") continue;
    const inner = xmlOf(inflatePage(data).replace(GREMLINS, ""));
    const model = inner.element(inner.root)!;
    if (model.local !== "mxGraphModel") throw new NotDrawio("una pagina non ha un modello");
    pages.push({ name, doc: inner, model });
  }
  return pages;
}

/// L'XML di draw.io dentro un PNG (`.drawio.png`): il pezzo `tEXt` o `zTXt`
/// che lo porta; `null` se il PNG non ne ha uno.
export function drawioInPng(bytes: Uint8Array): string | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  const latin = (from: number, to: number): string => {
    let out = "";
    for (let i = from; i < to; i++) out += String.fromCharCode(bytes[i]!);
    return out;
  };
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    const type = latin(at + 4, at + 8);
    const start = at + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return null;
    if (type === "tEXt" || type === "zTXt") {
      const zero = bytes.indexOf(0, start);
      const keyword = zero < 0 || zero >= end ? "" : latin(start, zero);
      if (keyword === "mxfile" || keyword === "mxGraphModel") {
        let value: string;
        if (type === "tEXt") {
          value = latin(zero + 1, end);
        } else {
          try {
            const inflated = inflateZlib(bytes.subarray(zero + 2, end), PAGE_LIMIT);
            value = "";
            for (const byte of inflated) value += String.fromCharCode(byte);
          } catch {
            return null;
          }
        }
        if (/^\s*%3C/i.test(value)) {
          try {
            value = decodeURIComponent(value);
          } catch {
            return null;
          }
        }
        return value;
      }
    }
    if (type === "IEND") return null;
    at = end + 4;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gli stili.
// ---------------------------------------------------------------------------
