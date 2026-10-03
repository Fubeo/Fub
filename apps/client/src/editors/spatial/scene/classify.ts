// La regola di classificazione di §4: che cosa della scena è modificabile e
// che cosa è estraneo. È `classify.rs` di `fub-scene`.
//
// Si parte dalla radice, che non si classifica, e si scende solo dentro i
// contenitori modificabili (`g` e `a`), dove ogni figlio si giudica da sé. Un
// elemento di qualunque altro tag è un'unità con i suoi figli: o è tutto
// modificabile o è tutto estraneo. I nodi estranei contigui, con gli spazi fra
// loro, diventano un solo blocco, che la superficie disegna come uno strato
// inerte; gli spazi fra un elemento modificabile e un blocco non sono di
// nessuno.
//
// La visita usa una pila esplicita, non la ricorsione: un SVG con centomila
// gruppi annidati è un file valido, e non deve esaurire lo stack.

import { BrushError, parseBrush } from "../ink/brush";
import { decodeInk, inkDuration, inkLength, unknownChannels, type Ink } from "../ink/codec";
import { InkError } from "../ink/sample";
import { Context, isContainer, Tally, type Role, type Stroke, type Tool } from "./analysis";
import { diagnostic, type Code, type Diagnostic } from "./diagnostics";
import { parsePath } from "./geometry";
import type { Span } from "./text";
import {
  dasharray,
  href,
  keyword,
  length,
  nonNegativeLength,
  numberList,
  opacity,
  paint,
  points,
  preserveAspectRatio,
  transform,
  trim,
} from "./values";
import { isSvg, NS_FUB, NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "./xml";

/// Quanti contenitori modificabili si annidano al massimo sotto la radice: un
/// `g` o un `a` più profondo è estraneo, con tutto ciò che contiene.
export const MAX_DEPTH = 128;

/// I tag d'apertura e di chiusura di un contenitore. `close` è `null` quando
/// il contenitore è autochiuso (`<g/>`): allora `open` è l'elemento intero.
export interface Tags {
  readonly open: Span;
  readonly close: Span | null;
}

/// Il nome e lo stato di un livello (§3).
export interface Layer {
  readonly name: string;
  /// `fub:locked="true"`.
  readonly locked: boolean;
  /// `display="none"`.
  readonly hidden: boolean;
}

/// La radice `svg`: è il documento, e non si classifica.
export interface RootItem extends Span {
  readonly kind: "root";
  readonly tags: Tags;
}

/// Un elemento modificabile.
export interface ElementItem extends Span {
  readonly kind: "element";
  /// Gli indici dei figli elemento dalla radice: è il modo in cui le
  /// operazioni della superficie indicano il loro bersaglio. La radice è
  /// `[]`.
  readonly path: readonly number[];
  readonly tag: string;
  readonly role: Role;
  readonly id: string | null;
  /// Il rientro della riga su cui l'elemento comincia.
  readonly indent: string;
  /// I tag di livelli, gruppi e collegamenti.
  readonly tags?: Tags;
  readonly layer?: Layer;
  readonly stroke?: Stroke;
  /// `x1 y1 x2 y2` di una freccia.
  readonly arrow?: readonly [number, number, number, number];
  /// Il testo di un `title` o di un `desc`, coi riferimenti risolti e gli
  /// spazi com'erano: è ciò che l'operazione `meta` sostituisce.
  readonly text?: string;
  /// Le righe di un `text`, una per `tspan`: è ciò che l'operazione `text`
  /// sostituisce.
  readonly lines?: readonly string[];
}

/// Una sequenza contigua di nodi estranei (§8).
export interface ForeignItem extends Span {
  readonly kind: "foreign";
  /// Il percorso del contenitore; `null` per il prologo e l'epilogo del
  /// documento, fuori dalla radice.
  readonly parentPath: readonly number[] | null;
  /// Gli indici `[da, a)` dei figli elemento del contenitore che il blocco
  /// comprende. Un blocco senza elementi ha `da = a`, l'indice del primo
  /// elemento che lo segue; nel documento la radice è l'elemento 0.
  readonly elements: readonly [number, number];
  readonly indent: string;
}

/// Una voce della scena, in ordine di documento.
export type Item = RootItem | ElementItem | ForeignItem;

/// I tag di §4.
export type Tag =
  | "title"
  | "desc"
  | "g"
  | "a"
  | "path"
  | "rect"
  | "ellipse"
  | "circle"
  | "line"
  | "polyline"
  | "polygon"
  | "text"
  | "tspan"
  | "image";

const TAGS: ReadonlySet<string> = new Set<Tag>([
  "title",
  "desc",
  "g",
  "a",
  "path",
  "rect",
  "ellipse",
  "circle",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "image",
]);

function tagOf(element: ElementNode): Tag | null {
  return element.ns === NS_SVG && TAGS.has(element.local) ? (element.local as Tag) : null;
}

/// Vero se un valore contiene `url(`, in qualunque combinazione di maiuscole
/// ASCII.
function hasUrl(value: string): boolean {
  return /[uU][rR][lL]\(/.test(value);
}

/// Vero se ogni attributo di `element` rientra in §4 per il suo tag.
function attributesAllowed(element: ElementNode, tag: Tag): boolean {
  return element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
        return !hasUrl(attr.value) && svgAttribute(tag, attr.local, attr.value);
      case NS_XLINK:
        return attr.local === "href"
          && (tag === "a" || tag === "image")
          && !hasUrl(attr.value)
          && svgAttribute(tag, "href", attr.value);
      // Un attributo nel namespace SVG non è un attributo SVG: quelli non
      // hanno namespace.
      case NS_SVG:
        return false;
      // `fub:*`, `xml:*`, le dichiarazioni e ogni altro namespace si
      // conservano e non decidono niente.
      default:
        return true;
    }
  });
}

/// Il giudizio su un attributo SVG senza namespace.
function svgAttribute(tag: Tag, name: string, value: string): boolean {
  switch (name) {
    case "id":
      return value !== "";
    case "fill":
    case "stroke":
      return paint(value) !== null;
    case "fill-opacity":
    case "stroke-opacity":
    case "opacity":
      return opacity(value) !== null;
    case "stroke-width":
    case "font-size":
      return nonNegativeLength(value) !== null;
    case "stroke-linecap":
    case "stroke-linejoin":
    case "display":
    case "font-weight":
    case "text-anchor":
      return keyword(name, value);
    case "stroke-dasharray":
      return dasharray(value);
    case "transform":
      return transform(value) !== null;
    case "font-family":
      return true;
    default:
      return geometryAttribute(tag, name, value);
  }
}

/// Il giudizio sugli attributi di geometria, che dipendono dal tag.
function geometryAttribute(tag: Tag, name: string, value: string): boolean {
  const is = (...tags: Tag[]): boolean => tags.includes(tag);
  switch (name) {
    case "x":
      if (is("rect", "image", "text", "tspan")) return length(value) !== null;
      return false;
    case "y":
      if (is("rect", "image", "text")) return length(value) !== null;
      return false;
    case "dy":
      return is("tspan") && length(value) !== null;
    case "cx":
    case "cy":
      return is("ellipse", "circle") && length(value) !== null;
    case "x1":
    case "y1":
    case "x2":
    case "y2":
      return is("line") && length(value) !== null;
    case "width":
    case "height":
      return is("rect", "image") && nonNegativeLength(value) !== null;
    case "r":
      return is("circle") && nonNegativeLength(value) !== null;
    case "rx":
    case "ry":
      return is("rect", "ellipse") && nonNegativeLength(value) !== null;
    case "points":
      return is("polyline", "polygon") && points(value) !== null;
    case "d":
      return is("path") && parsePath(value) !== null;
    case "preserveAspectRatio":
      return is("image") && preserveAspectRatio(value);
    case "href": {
      if (tag === "a") return href(value).kind === "vault";
      if (tag !== "image") return false;
      const target = href(value);
      return target.kind === "vault" || target.kind === "remote" || (target.kind === "data" && target.raster);
    }
    default:
      return false;
  }
}

/// Vero se `element` contiene solo dati di carattere: testo e riferimenti a
/// carattere, niente elementi, commenti, CDATA o entità.
function characterDataOnly(doc: XmlDocument, element: ElementNode): boolean {
  return element.children.every((child) => doc.nodes[child]!.kind === "text");
}

/// Il testo di un elemento che contiene solo dati di carattere.
function characterData(doc: XmlDocument, id: NodeId): string {
  let text = "";
  for (const child of doc.children(id)) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") text += node.value;
  }
  return text;
}

/// Vero se `id` è un `title`, `desc` o, dentro un `text`, un `tspan`
/// modificabile: attributi ammessi e solo testo dentro.
function allowedPart(doc: XmlDocument, id: NodeId, insideText: boolean): boolean {
  const element = doc.element(id);
  if (element === null) return false;
  const tag = tagOf(element);
  if (tag !== "title" && tag !== "desc" && !(tag === "tspan" && insideText)) return false;
  return attributesAllowed(element, tag) && characterDataOnly(doc, element);
}

/// Vero se ogni figlio di un'unità è ammesso: spazi, `title`, `desc` e, per
/// `text`, i `tspan`.
function unitChildrenAllowed(doc: XmlDocument, element: ElementNode, tag: Tag): boolean {
  return element.children.every((child) => {
    const node = doc.nodes[child]!;
    if (node.kind === "text") return node.blank;
    if (node.kind === "element") return allowedPart(doc, child, tag === "text");
    return false;
  });
}

const UNIT_ROLES: Readonly<Partial<Record<Tag, Role>>> = {
  rect: "rect",
  ellipse: "ellipse",
  circle: "circle",
  line: "line",
  polyline: "polyline",
  polygon: "polygon",
  text: "text",
  image: "image",
};

/// Il ruolo di un figlio di un contenitore, o `null` se è estraneo.
/// `underRoot` dice se il contenitore è la radice, che decide livelli e
/// carta; `depth` è la lunghezza del percorso del figlio, che per un
/// contenitore oltre [`MAX_DEPTH`] lo rende estraneo.
export function classifyChild(doc: XmlDocument, id: NodeId, underRoot: boolean, depth: number): [Tag, Role] | null {
  const found = classify(doc, id, underRoot);
  // Un contenitore oltre la profondità massima è un'unità.
  return found !== null && isContainer(found[1]) && depth > MAX_DEPTH ? null : found;
}

function classify(doc: XmlDocument, id: NodeId, underRoot: boolean): [Tag, Role] | null {
  const element = doc.element(id);
  if (element === null) return null;
  const tag = tagOf(element);
  if (tag === null || !attributesAllowed(element, tag)) return null;
  switch (tag) {
    case "g":
      return [tag, underRoot && valueOf(element, NS_FUB, "layer") !== undefined ? "layer" : "group"];
    case "a":
      return [tag, "link"];
    case "title":
    case "desc":
      return characterDataOnly(doc, element) ? [tag, tag] : null;
    case "tspan":
      return null;
    default: {
      if (!unitChildrenAllowed(doc, element, tag)) return null;
      if (tag === "path") return [tag, pathRole(element)];
      if (tag === "rect" && underRoot && valueOf(element, NS_FUB, "role") === "paper") return [tag, "paper"];
      return [tag, UNIT_ROLES[tag]!];
    }
  }
}

/// Il ruolo di un `path`: tratto, freccia o tracciato.
function pathRole(element: ElementNode): Role {
  const tool = valueOf(element, NS_FUB, "tool");
  if (tool === "pen" || tool === "highlighter") return "stroke";
  // Uno strumento sconosciuto, o una forma sconosciuta, lasciano un
  // tracciato: la geometria si legge da `d` (§6).
  if (valueOf(element, NS_FUB, "shape") === "arrow" && arrowGeometry(element) !== null) return "arrow";
  return "path";
}

/// `fub:geom` di una freccia: quattro numeri SVG.
function arrowGeometry(element: ElementNode): [number, number, number, number] | null {
  const geom = valueOf(element, NS_FUB, "geom");
  const numbers = geom === undefined ? null : numberList(geom);
  return numbers !== null && numbers.length === 4 ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!] : null;
}

/// Ciò che una voce dice di un elemento modificabile oltre a percorso,
/// span, rientro e tag: quello che dipende solo dall'elemento. Il motore
/// delle operazioni lo conserva per ogni elemento, e ne ricava le voci senza
/// rileggere il documento.
export interface Details {
  readonly tag: Tag;
  readonly role: Role;
  readonly id: string | null;
  readonly layer?: Layer;
  readonly stroke?: Stroke;
  readonly arrow?: readonly [number, number, number, number];
  readonly text?: string;
  readonly lines?: readonly string[];
}

/// Un problema di un tratto: S004 o S010, col dettaglio.
export type StrokeProblem = readonly [code: Code, detail: string];

/// Legge inchiostro e pennello di un tratto: S004 per ognuno che non si
/// legge, S010 per i canali sconosciuti.
export function readStroke(element: ElementNode): { stroke: Stroke; problems: StrokeProblem[] } {
  const tool: Tool = valueOf(element, NS_FUB, "tool") === "highlighter" ? "highlighter" : "pen";
  const problems: StrokeProblem[] = [];
  let ink: Ink | null = null;
  const inkText = valueOf(element, NS_FUB, "ink");
  if (inkText === undefined) {
    problems.push(["S004", new InkError("missing").detail]);
  } else {
    try {
      ink = decodeInk(inkText);
    } catch (error) {
      if (!(error instanceof InkError)) throw error;
      problems.push(["S004", error.detail]);
    }
  }
  const brushText = valueOf(element, NS_FUB, "brush");
  if (brushText === undefined) {
    problems.push(["S004", new BrushError("missing").detail]);
  } else {
    try {
      parseBrush(brushText);
    } catch (error) {
      if (!(error instanceof BrushError)) throw error;
      problems.push(["S004", error.detail]);
    }
  }
  if (ink !== null) {
    const unknown = unknownChannels(ink);
    if (unknown !== "") problems.push(["S010", unknown]);
  }
  const stroke: { tool: Tool; redrawable: boolean; samples?: number; duration?: number } = {
    tool,
    redrawable: problems.length === 0,
  };
  if (ink !== null) {
    stroke.samples = inkLength(ink);
    const duration = inkDuration(ink);
    if (duration !== null) stroke.duration = duration;
  }
  return { stroke, problems };
}

/// I dettagli di un elemento modificabile di ruolo `role`, coi problemi del
/// suo tratto se è un tratto.
export function describe(doc: XmlDocument, id: NodeId, tag: Tag, role: Role): { details: Details; problems: StrokeProblem[] } {
  const element = doc.element(id)!;
  const details: { -readonly [K in keyof Details]: Details[K] } = {
    tag,
    role,
    id: valueOf(element, NS_NONE, "id") ?? null,
  };
  let problems: StrokeProblem[] = [];
  if (role === "layer") {
    const display = valueOf(element, NS_NONE, "display");
    details.layer = {
      name: valueOf(element, NS_FUB, "layer") ?? "",
      locked: valueOf(element, NS_FUB, "locked") === "true",
      hidden: display !== undefined && trim(display) === "none",
    };
  }
  if (role === "stroke") {
    const read = readStroke(element);
    details.stroke = read.stroke;
    problems = read.problems;
  }
  if (role === "arrow") {
    const arrow = arrowGeometry(element);
    if (arrow !== null) details.arrow = arrow;
  }
  if (role === "title" || role === "desc") details.text = characterData(doc, id);
  if (role === "text") {
    details.lines = element.children
      .filter((child) => {
        const tspan = doc.element(child);
        return tspan !== null && isSvg(tspan, "tspan");
      })
      .map((child) => characterData(doc, child));
  }
  return { details, problems };
}

/// La voce di un elemento modificabile dai suoi dettagli e da dove sta.
export function elementItem(details: Details, path: readonly number[], span: Span, indent: string, tags: Tags | null): ElementItem {
  const item: { -readonly [K in keyof ElementItem]: ElementItem[K] } = {
    kind: "element",
    path,
    tag: details.tag,
    role: details.role,
    id: details.id,
    ...span,
    indent,
  };
  if (tags !== null) item.tags = tags;
  if (details.layer !== undefined) item.layer = details.layer;
  if (details.stroke !== undefined) item.stroke = details.stroke;
  if (details.arrow !== undefined) item.arrow = details.arrow;
  if (details.text !== undefined) item.text = details.text;
  if (details.lines !== undefined) item.lines = details.lines;
  return item;
}

/// Un blocco estraneo in costruzione.
interface Pending {
  start: number;
  end: number;
  elements: [number, number];
}

/// Un contenitore in visita.
interface Frame {
  readonly node: NodeId;
  readonly path: readonly number[];
  next: number;
  elements: number;
  pending: Pending | null;
  readonly context: Context;
}

/// Ciò che la classificazione trova.
export interface Classified {
  readonly items: Item[];
  /// S002, S004 e S010.
  readonly diagnostics: Diagnostic[];
  readonly tally: Tally;
}

function isXmlSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

class Builder {
  readonly items: Item[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly tally = new Tally();

  constructor(
    private readonly doc: XmlDocument,
    /// Falso per un documento oltre il limite di elementi: le voci si
    /// contano e si scartano, e restano solo riepilogo e diagnostica.
    private readonly keep: boolean,
  ) {}

  /// Allunga il blocco in attesa fino a `id`; `element` è l'indice del nodo
  /// fra i figli elemento, se è un elemento. Un blocco comincia e finisce su
  /// un carattere che non è spazio: gli spazi ai bordi di un testo estraneo
  /// stanno fra due voci, come gli altri.
  extend(pending: Pending | null, id: NodeId, element: number | null, next: number): Pending {
    const node = this.doc.nodes[id]!;
    let start = node.start;
    let end = node.end;
    if (node.kind === "text") {
      const text = this.doc.source.text;
      while (start < end && isXmlSpace(text.charCodeAt(start))) start++;
      while (end > start && isXmlSpace(text.charCodeAt(end - 1))) end--;
    }
    const block = pending ?? { start, end, elements: [element ?? next, element ?? next] };
    block.end = end;
    if (element !== null) block.elements[1] = element + 1;
    return block;
  }

  flush(pending: Pending | null, parentPath: readonly number[] | null): void {
    if (pending === null) return;
    const span = this.doc.source.span(pending.start, pending.end);
    if (this.keep) {
      this.items.push({
        kind: "foreign",
        parentPath: parentPath === null ? null : [...parentPath],
        ...span,
        elements: pending.elements,
        indent: this.doc.source.indent(pending.start),
      });
    }
    this.tally.foreign();
    this.diagnostics.push(diagnostic("S002", span));
  }

  tags(id: NodeId): Tags {
    const element = this.doc.element(id)!;
    const source = this.doc.source;
    return {
      open: source.span(element.start, element.openEnd),
      close: element.closeStart === null ? null : source.span(element.closeStart, element.end),
    };
  }

  elementItem(id: NodeId, tag: Tag, role: Role, path: number[], context: Context): void {
    const doc = this.doc;
    const element = doc.element(id)!;
    const span = doc.source.span(element.start, element.end);
    const { details, problems } = describe(doc, id, tag, role);
    for (const [code, detail] of problems) this.diagnostics.push(diagnostic(code, span, detail));
    this.tally.element(doc, element, role, context, span, details.stroke ?? null);
    if (!this.keep) return;
    this.items.push(elementItem(details, path, span, doc.source.indent(element.start), isContainer(role) ? this.tags(id) : null));
  }

  /// Visita la radice e i contenitori modificabili, in ordine di documento.
  walk(root: NodeId): void {
    const doc = this.doc;
    const stack: Frame[] = [
      { node: root, path: [], next: 0, elements: 0, pending: null, context: Context.root(doc.element(root)!) },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = doc.children(frame.node);
      const child = children[frame.next];
      if (child === undefined) {
        stack.pop();
        this.flush(frame.pending, frame.path);
        continue;
      }
      frame.next++;
      const underRoot = frame.node === root;
      const node = doc.nodes[child]!;
      if (node.kind === "text" && node.blank) continue;
      if (node.kind !== "element") {
        frame.pending = this.extend(frame.pending, child, null, frame.elements);
        continue;
      }
      const index = frame.elements++;
      const found = classifyChild(doc, child, underRoot, frame.path.length + 1);
      if (found === null) {
        frame.pending = this.extend(frame.pending, child, index, frame.elements);
        continue;
      }
      const [tag, role] = found;
      const pending = frame.pending;
      frame.pending = null;
      const context = frame.context.child(node);
      this.flush(pending, frame.path);
      const path = [...frame.path, index];
      this.elementItem(child, tag, role, path, context);
      if (isContainer(role)) {
        stack.push({ node: child, path, next: 0, elements: 0, pending: null, context });
      }
    }
  }
}

/// Classifica un documento letto per intero. Con `keep` falso le voci non si
/// conservano: un documento oltre il limite di elementi ne avrebbe troppe, e
/// serve solo il suo riepilogo.
export function classifyDocument(doc: XmlDocument, keep: boolean): Classified {
  const builder = new Builder(doc, keep);
  let pending: Pending | null = null;
  // Per il documento la radice è l'elemento 0: l'epilogo comincia da 1.
  let next = 0;
  for (const id of doc.top) {
    const node = doc.nodes[id]!;
    if (node.kind === "text") continue;
    if (node.kind === "element") {
      builder.flush(pending, null);
      pending = null;
      if (keep) builder.items.push({ kind: "root", ...doc.source.span(node.start, node.end), tags: builder.tags(id) });
      builder.walk(id);
      next = 1;
    } else {
      pending = builder.extend(pending, id, null, next);
    }
  }
  builder.flush(pending, null);
  return { items: builder.items, diagnostics: builder.diagnostics, tally: builder.tally };
}
