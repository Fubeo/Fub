// Riconoscere un disegno di Excalidraw o di draw.io da quello che contiene:
// una parte piccola e senza dipendenze, che l'editor legge a ogni incolla
// senza caricare i lettori, che arrivano soltanto quando servono.

import type { Source } from "./sources";

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

/// Il programma di un file dal contenuto: un JSON di Excalidraw (un file o
/// gli appunti) o un XML di draw.io.
export function sniff(text: string): Source | null {
  const head = text.slice(0, 4096).trimStart();
  if (head.startsWith("{") && /"type"\s*:\s*"excalidraw(\/clipboard)?"/.test(head)) return "excalidraw";
  if (DRAWIO_XML.test(head) || DRAWIO_SVG.test(head)) return "drawio";
  return null;
}

/// Il disegno di un altro programma che il testo degli appunti porta, col
/// testo da leggere; `null` se non ne porta uno. draw.io copia il suo XML
/// anche codificato come un URL (`%3CmxGraphModel…`), e lo si decodifica.
export function foreignDrawing(text: string): { readonly source: Source; readonly text: string } | null {
  const trimmed = text.trimStart();
  let plain = trimmed;
  if (/^%3C/i.test(trimmed)) {
    try {
      plain = decodeURIComponent(trimmed);
    } catch {
      return null;
    }
  }
  const source = sniff(plain);
  // Un SVG di draw.io è prima di tutto un SVG: lo incolla l'editor, coi suoi
  // elementi, come ogni altro SVG.
  if (source === null || (source === "drawio" && DRAWIO_SVG.test(plain.slice(0, 4096)))) return null;
  return { source, text: plain };
}
