// Le annotazioni di un PDF: un file `.fubann`, cioè una scena con qualche
// attributo `fub:*` in più (`docs/reference/annotation-format.md`).
//
// È il lettore di `fub-scene` (`annotation.rs`) portato qui, con le stesse
// grammatiche: il documento annotato, l'impronta e il numero di pagine della
// radice, i gruppi di pagina e il corpo delle note. Il profilo `pdf` della
// superficie legge le pagine così, e le fixture di `__fixtures__/annotations/`,
// generate da Rust, tengono i due lettori d'accordo.
//
// Le grammatiche sono esportate: il profilo le usa sul modello del motore, che
// cambia a ogni gesto, senza rileggere il testo.

import { paragraph } from "./analysis";
import { openSource } from "./read";
import type { Span } from "./text";
import { href, numberList, rustTrim } from "./values";
import { attrOf, isSvg, NS_FUB, NS_SVG, valueOf, type XmlDocument } from "./xml";

/// Il prefisso dell'impronta: l'unico algoritmo della versione 1.
export const DIGEST_PREFIX = "sha256:";

/// Il documento annotato, da `fub:annotates`.
export interface Annotated {
  /// Il percorso com'è scritto, ripulito come lo legge un URL: relativo al
  /// `.fubann`, o dalla radice del vault se comincia con `/`.
  readonly path: string;
  /// Il valore grezzo, virgolette escluse.
  readonly value: Span;
}

/// Un gruppo di pagina: un `g` figlio della radice con `fub:page`.
export interface AnnotationPage {
  readonly number: number;
  /// Larghezza e altezza in punti PDF, se sono due numeri positivi.
  readonly size: readonly [number, number] | null;
  readonly bytes: readonly [number, number];
  readonly utf16: readonly [number, number];
}

/// Una nota: un `text` col corpo esteso in `fub:note`.
export interface AnnotationNote {
  /// Il testo disegnato, letto come quello dell'indice.
  readonly text: string;
  /// Il corpo, coi terminatori ridotti a `\n`.
  readonly body: string;
  readonly bytes: readonly [number, number];
  readonly utf16: readonly [number, number];
  /// Il contenuto fra i tag; `null` per un tag autochiuso.
  readonly content: Span | null;
  /// Il valore grezzo di `fub:note`, virgolette escluse.
  readonly value: Span;
}

/// Ciò che delle annotazioni non è la scena: la forma JSON di `Annotations`
/// in Rust, senza `scene`.
export interface Annotations {
  readonly annotates: Annotated | null;
  readonly digest: string | null;
  readonly pageCount: number | null;
  readonly pages: readonly AnnotationPage[];
  readonly notes: readonly AnnotationNote[];
}

/// Un intero positivo in cifre decimali che sta in 32 bit: la grammatica di
/// `fub:version`, valida per `fub:pages` e `fub:page`.
export function positive(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && n <= 0xffff_ffff ? n : null;
}

/// `sha256:` e 64 cifre esadecimali, restituite in minuscolo.
export function digest(value: string | undefined): string | null {
  if (value === undefined || !value.startsWith(DIGEST_PREFIX)) return null;
  const hex = value.slice(DIGEST_PREFIX.length);
  return /^[0-9a-fA-F]{64}$/.test(hex) ? `${DIGEST_PREFIX}${hex.toLowerCase()}` : null;
}

/// Due numeri positivi: larghezza e altezza.
export function pageSize(value: string | undefined): [number, number] | null {
  const numbers = value === undefined ? null : numberList(value);
  if (numbers === null || numbers.length !== 2) return null;
  const [width, height] = numbers as [number, number];
  return width > 0 && height > 0 ? [width, height] : null;
}

/// Il corpo di una nota coi terminatori `\r\n` e `\r` ridotti a `\n`.
export function noteBody(value: string): string {
  return value.includes("\r") ? value.replace(/\r\n?/g, "\n") : value;
}

/// Vero se il corpo fa una nota: non è fatto solo di spazi, quelli di
/// Unicode come li conta Rust.
export function isNoteBody(body: string): boolean {
  return rustTrim(body) !== "";
}

/// Legge le annotazioni da `source`, il testo intero del `.fubann`. Gli errori
/// sono quelli di `readScene`: un file malformato, o con una radice che non è
/// `svg`, non è un insieme di annotazioni. Di un file oltre il limite si legge
/// la testa: gli attributi della radice ci sono, pagine e note no.
export function readAnnotations(source: string): Annotations {
  const { doc } = openSource(source);
  return partsOf(doc);
}

function partsOf(doc: XmlDocument): Annotations {
  const text = doc.source;
  const root = doc.element(doc.root)!;
  const annotatesAttr = attrOf(root, NS_FUB, "annotates");
  let annotates: Annotated | null = null;
  if (annotatesAttr !== undefined) {
    const target = href(annotatesAttr.value);
    if (target.kind === "vault") annotates = { path: target.url, value: text.span(annotatesAttr.raw[0], annotatesAttr.raw[1]) };
  }
  const pages: AnnotationPage[] = [];
  const notes: AnnotationNote[] = [];
  const out: Annotations = {
    annotates,
    digest: digest(valueOf(root, NS_FUB, "digest")),
    pageCount: positive(valueOf(root, NS_FUB, "pages")),
    pages,
    notes,
  };
  // Di un file troncato c'è solo la testa, che non ha né pagine né note.
  if (!doc.complete) return out;

  for (const child of root.children) {
    const group = doc.element(child);
    if (group === null || !isSvg(group, "g")) continue;
    const number = positive(valueOf(group, NS_FUB, "page"));
    if (number === null) continue;
    const span = text.span(group.start, group.end);
    pages.push({ number, size: pageSize(valueOf(group, NS_FUB, "page-size")), ...span });
  }

  // Un `text` dentro un altro non è una nota: `inside` è la fine dell'ultimo.
  let inside = 0;
  doc.nodes.forEach((node, id) => {
    if (node.kind !== "element" || node.ns !== NS_SVG || node.local !== "text" || node.start < inside) return;
    inside = node.end;
    const attr = attrOf(node, NS_FUB, "note");
    if (attr === undefined) return;
    const body = noteBody(attr.value);
    if (!isNoteBody(body)) return;
    notes.push({
      text: paragraph(doc, id),
      body,
      ...text.span(node.start, node.end),
      content: node.closeStart === null ? null : text.span(node.openEnd, node.closeStart),
      value: text.span(attr.raw[0], attr.raw[1]),
    });
  });
  return out;
}
