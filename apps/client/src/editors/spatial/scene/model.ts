// Il modello del motore delle operazioni: la sorgente come albero di pezzi di
// testo, allineato alla classificazione del formato della scena (§4).
//
// Un contenitore modificabile (la radice, un livello, un gruppo, un
// collegamento) è il suo tag d'apertura, i suoi pezzi e il suo tag di
// chiusura; ogni altro nodo è un pezzo opaco, il suo testo grezzo. Fra due
// nodi stanno gli spazi, come stringhe. Unire i pezzi in ordine ridà il file
// byte per byte, terminatori compresi.
//
// Così un'operazione cambia solo i pezzi che tocca, e un `batch` di diecimila
// operazioni costa quanto il numero delle operazioni più una sola scrittura
// del testo, non diecimila copie di un file da 20 MiB. Le posizioni dei nodi
// si ricalcolano con una visita sola, quando servono; le voci della scena si
// ricavano dall'albero con la stessa visita di `classify.ts`, e i test le
// confrontano con quelle che il lettore ricava dal testo.
//
// I pezzi sono grezzi: un file a CRLF resta a CRLF. Il testo nuovo nasce a LF
// e prende il terminatore prevalente quando entra nell'albero.

import { isContainer } from "./analysis";
import { characterData, classifyChild, describe, elementItem, type Details, type Item, type StrokeProblem, type Tags } from "./classify";
import { escapeAttribute, NamespaceScope } from "./serialize";
import { SourceText, type Span } from "./text";
import {
  isSpace,
  NS_NONE,
  NS_SVG,
  parseXml,
  SVG_NS,
  valueOf,
  XmlError,
  type ElementNode,
  type NodeId,
  type TextNode,
  type XmlDocument,
} from "./xml";

/// Un pezzo di un contenitore: spazi fra due nodi, oppure un nodo. Due
/// stringhe non stanno mai una accanto all'altra, e nessuna è vuota.
export type Part = string | SceneNode;

/// Un nodo dell'albero.
export type SceneNode = OtherNode | LeafNode | ContainerNode;

/// Un elemento dell'albero: un'unità o un contenitore.
export type ElementPart = LeafNode | ContainerNode;

interface Placed {
  /// `null` solo per la radice, che sta nel documento.
  parent: ContainerNode | null;
  /// Gli indici grezzi nell'ultimo testo disposto (`layout`): valgono fino
  /// alla modifica successiva.
  start: number;
  end: number;
}

/// Ciò che il motore sa di un elemento qualunque.
export interface ElementFacts {
  /// Il nome come è scritto.
  readonly name: string;
  readonly uri: string;
  readonly local: string;
  /// L'attributo `id`; `null` se manca o è vuoto.
  readonly id: string | null;
}

/// Un nodo che non è un elemento: commento, istruzione di elaborazione,
/// CDATA, riferimento a entità, dichiarazione, `DOCTYPE`, o un testo che non
/// è fatto solo di spazi, senza gli spazi ai bordi.
export interface OtherNode extends Placed {
  readonly kind: "other";
  readonly raw: string;
}

/// Un elemento che vale come un'unità: modificabile coi suoi figli, oppure
/// estraneo.
export interface LeafNode extends Placed {
  readonly kind: "leaf";
  readonly raw: string;
  readonly facts: ElementFacts;
  /// `null` se l'elemento è estraneo.
  readonly details: Details | null;
  /// I problemi di un tratto, S004 e S010, come li trova il lettore; vuoto
  /// per ogni altro elemento.
  readonly problems: readonly StrokeProblem[];
  /// Gli id di tutti gli elementi che contiene, il suo compreso.
  readonly ids: readonly string[];
  /// Quanti elementi contiene, lui compreso.
  readonly elements: number;
  /// L'indice dopo il `>` del suo tag d'apertura, dall'inizio di `raw`; per
  /// un elemento autochiuso è `raw.length`.
  readonly openLength: number;
}

/// La radice, un livello, un gruppo o un collegamento: i figli si
/// classificano uno per uno.
export interface ContainerNode extends Placed {
  readonly kind: "container";
  /// Il tag d'apertura; l'elemento intero se è autochiuso.
  head: string;
  /// Il tag di chiusura; `null` se l'elemento è autochiuso.
  tail: string | null;
  parts: Part[];
  facts: ElementFacts;
  /// `null` per la radice, che non si classifica.
  details: Details | null;
  /// Le dichiarazioni di namespace del tag d'apertura.
  declarations: ReadonlyArray<readonly [string | null, string]>;
  /// La lunghezza del percorso: 0 per la radice.
  readonly depth: number;
  /// Dove finisce il tag d'apertura e dove comincia quello di chiusura,
  /// nell'ultimo testo disposto.
  openEnd: number;
  closeStart: number | null;
}

/// Un documento: il BOM, poi prologo, radice ed epilogo.
export interface DocumentModel {
  readonly bom: string;
  parts: Part[];
  readonly root: ContainerNode;
}

// ---------------------------------------------------------------------------
// Costruzione.
// ---------------------------------------------------------------------------

/// I fatti di un elemento letto.
export function factsOf(doc: XmlDocument, element: ElementNode): ElementFacts {
  const id = valueOf(element, NS_NONE, "id");
  return {
    name: element.name,
    uri: doc.namespaces[element.ns]!,
    local: element.local,
    id: id === undefined || id === "" ? null : id,
  };
}

/// Le dichiarazioni di namespace sul tag di `element`.
export function declarationsOf(element: ElementNode): Array<[string | null, string]> {
  const out: Array<[string | null, string]> = [];
  for (const attr of element.attrs) {
    if (attr.name === "xmlns") out.push([null, attr.value]);
    else if (attr.name.startsWith("xmlns:")) out.push([attr.local, attr.value]);
  }
  return out;
}

/// Aggiunge uno spazio a `parts`, unendolo a quello che lo precede.
export function pushGap(parts: Part[], gap: string): void {
  if (gap === "") return;
  const last = parts[parts.length - 1];
  if (typeof last === "string") parts[parts.length - 1] = last + gap;
  else parts.push(gap);
}

/// Unisce le stringhe vicine e toglie quelle vuote.
export function tidy(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    if (typeof part === "string") pushGap(out, part);
    else out.push(part);
  }
  return out;
}

/// Costruisce i nodi di un documento letto.
class Builder {
  private readonly text: string;

  constructor(private readonly doc: XmlDocument) {
    this.text = doc.source.text;
  }

  private slice(from: number, to: number): string {
    return this.text.slice(from, to);
  }

  /// I pezzi dei figli di `id`, che nell'albero è `container`.
  parts(id: NodeId, container: ContainerNode): Part[] {
    const out: Part[] = [];
    for (const child of this.doc.children(id)) {
      const node = this.doc.nodes[child]!;
      if (node.kind === "text") this.textPart(out, node);
      else if (node.kind === "element") out.push(this.element(child, container));
      else out.push({ kind: "other", raw: this.slice(node.start, node.end), parent: container, start: 0, end: 0 });
    }
    return out;
  }

  /// Un testo: spazi, oppure spazi, testo e spazi.
  private textPart(out: Part[], node: TextNode): void {
    const raw = this.slice(node.start, node.end);
    if (node.blank) {
      pushGap(out, raw);
      return;
    }
    let from = 0;
    let to = raw.length;
    while (from < to && isSpace(raw.charCodeAt(from))) from++;
    while (to > from && isSpace(raw.charCodeAt(to - 1))) to--;
    pushGap(out, raw.slice(0, from));
    out.push({ kind: "other", raw: raw.slice(from, to), parent: null, start: 0, end: 0 });
    pushGap(out, raw.slice(to));
  }

  /// Un elemento figlio di `parent`, classificato come lo classifica il
  /// lettore in quella posizione.
  element(id: NodeId, parent: ContainerNode): ElementPart {
    const doc = this.doc;
    const element = doc.element(id)!;
    const depth = parent.depth + 1;
    const found = classifyChild(doc, id, parent.depth === 0, depth);
    const facts = factsOf(doc, element);
    if (found !== null && isContainer(found[1])) {
      const container: ContainerNode = {
        kind: "container",
        head: this.slice(element.start, element.openEnd),
        tail: element.closeStart === null ? null : this.slice(element.closeStart, element.end),
        parts: [],
        facts,
        details: describe(doc, id, found[0], found[1]).details,
        declarations: declarationsOf(element),
        depth,
        parent,
        start: 0,
        end: 0,
        openEnd: 0,
        closeStart: null,
      };
      container.parts = this.parts(id, container);
      return container;
    }
    const [ids, elements] = this.inside(id);
    const described = found === null ? null : describe(doc, id, found[0], found[1]);
    return {
      kind: "leaf",
      raw: this.slice(element.start, element.end),
      facts,
      details: described === null ? null : described.details,
      problems: described === null ? [] : described.problems,
      ids,
      elements,
      openLength: element.openEnd - element.start,
      parent,
      start: 0,
      end: 0,
    };
  }

  /// Gli id e il numero degli elementi dentro `id`, lui compreso. La visita
  /// usa una pila: un'unità estranea può annidare centomila elementi.
  private inside(id: NodeId): [string[], number] {
    const ids: string[] = [];
    let elements = 0;
    const stack = [id];
    while (stack.length > 0) {
      const element = this.doc.element(stack.pop()!);
      if (element === null) continue;
      elements++;
      const value = valueOf(element, NS_NONE, "id");
      if (value !== undefined && value !== "") ids.push(value);
      for (let i = element.children.length - 1; i >= 0; i--) stack.push(element.children[i]!);
    }
    return [ids, elements];
  }

  /// La radice e i pezzi che la circondano.
  document(): DocumentModel {
    const doc = this.doc;
    const rootElement = doc.element(doc.root)!;
    const root: ContainerNode = {
      kind: "container",
      head: this.slice(rootElement.start, rootElement.openEnd),
      tail: rootElement.closeStart === null ? null : this.slice(rootElement.closeStart, rootElement.end),
      parts: [],
      facts: factsOf(doc, rootElement),
      details: null,
      declarations: declarationsOf(rootElement),
      depth: 0,
      parent: null,
      start: 0,
      end: 0,
      openEnd: 0,
      closeStart: null,
    };
    root.parts = this.parts(doc.root, root);
    const parts: Part[] = [];
    for (const id of doc.top) {
      const node = doc.nodes[id]!;
      if (node.kind === "text") pushGap(parts, this.slice(node.start, node.end));
      else if (node.kind === "element") parts.push(root);
      else parts.push({ kind: "other", raw: this.slice(node.start, node.end), parent: null, start: 0, end: 0 });
    }
    return { bom: this.slice(0, doc.source.text.charCodeAt(0) === 0xfeff ? 1 : 0), parts, root };
  }
}

/// L'albero di un documento letto per intero.
export function buildDocument(doc: XmlDocument): DocumentModel {
  const model = new Builder(doc).document();
  // I testi estranei hanno il genitore solo ora: `textPart` non lo sapeva.
  const adopt = (container: ContainerNode): void => {
    for (const part of container.parts) {
      if (typeof part === "string") continue;
      part.parent = container;
      if (part.kind === "container") adopt(part);
    }
  };
  adopt(model.root);
  return model;
}

/// Un elemento scritto da solo, `raw`, letto nello scope `scope`.
export interface Fragment {
  readonly doc: XmlDocument;
  readonly id: NodeId;
}

/// Legge `raw`, il testo di un elemento solo, dentro un contenitore che
/// dichiara `scope`. `null` se non è un elemento ben formato da solo.
export function parseFragment(raw: string, scope: NamespaceScope): Fragment | null {
  let open = "<fub-fragment";
  for (const [prefix, uri] of scope.entries()) {
    if (prefix === null) {
      if (uri !== "") open += ` xmlns="${escapeAttribute(uri)}"`;
    } else {
      open += ` xmlns:${prefix}="${escapeAttribute(uri)}"`;
    }
  }
  open += ">";
  let doc: XmlDocument;
  try {
    doc = parseXml(new SourceText(`${open}${raw}</fub-fragment>`), false);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
  const children = doc.children(doc.root);
  if (children.length !== 1) return null;
  const element = doc.element(children[0]!);
  if (element === null || element.start !== open.length || element.end !== open.length + raw.length) return null;
  return { doc, id: children[0]! };
}

/// Il nodo di un frammento letto, come figlio di `parent`.
export function buildFragment(fragment: Fragment, parent: ContainerNode): ElementPart {
  const node = new Builder(fragment.doc).element(fragment.id, parent);
  const adopt = (container: ContainerNode): void => {
    for (const part of container.parts) {
      if (typeof part === "string") continue;
      part.parent = container;
      if (part.kind === "container") adopt(part);
    }
  };
  if (node.kind === "container") adopt(node);
  return node;
}

// ---------------------------------------------------------------------------
// Testo e posizioni.
// ---------------------------------------------------------------------------

/// Il testo grezzo di un nodo.
export function rawOf(node: SceneNode): string {
  if (node.kind !== "container") return node.raw;
  const out: string[] = [];
  emit(node, out);
  return out.join("");
}

function emit(node: SceneNode, out: string[]): void {
  if (node.kind !== "container") {
    out.push(node.raw);
    return;
  }
  out.push(node.head);
  if (node.tail === null) return;
  for (const part of node.parts) {
    if (typeof part === "string") out.push(part);
    else emit(part, out);
  }
  out.push(node.tail);
}

/// Il testo grezzo del documento.
export function materialize(model: DocumentModel): string {
  const out: string[] = [model.bom];
  for (const part of model.parts) {
    if (typeof part === "string") out.push(part);
    else emit(part, out);
  }
  return out.join("");
}

/// Assegna a ogni nodo i suoi indici grezzi nel testo di `materialize`.
export function layout(model: DocumentModel): void {
  let pos = model.bom.length;
  const place = (node: SceneNode): void => {
    node.start = pos;
    if (node.kind !== "container") {
      pos += node.raw.length;
    } else {
      pos += node.head.length;
      node.openEnd = pos;
      if (node.tail === null) {
        node.closeStart = null;
      } else {
        for (const part of node.parts) {
          if (typeof part === "string") pos += part.length;
          else place(part);
        }
        node.closeStart = pos;
        pos += node.tail.length;
      }
    }
    node.end = pos;
  };
  for (const part of model.parts) {
    if (typeof part === "string") pos += part.length;
    else place(part);
  }
}

/// I pezzi di testo prima del pezzo `index` di `owner`, dal più vicino,
/// fino all'inizio del documento escluso il BOM. `owner` è `null` per il
/// documento.
function* textBefore(model: DocumentModel, owner: ContainerNode | null, index: number): Generator<string> {
  let container = owner;
  let at = index;
  for (;;) {
    const parts = container === null ? model.parts : container.parts;
    for (let i = at - 1; i >= 0; i--) {
      const part = parts[i]!;
      if (typeof part === "string") yield part;
      else yield* reversedText(part);
    }
    if (container === null) return;
    yield container.head;
    const parent: ContainerNode | null = container.parent;
    at = (parent === null ? model.parts : parent.parts).indexOf(container);
    container = parent;
  }
}

function* reversedText(node: SceneNode): Generator<string> {
  if (node.kind !== "container") {
    yield node.raw;
    return;
  }
  if (node.tail !== null) {
    yield node.tail;
    for (let i = node.parts.length - 1; i >= 0; i--) {
      const part = node.parts[i]!;
      if (typeof part === "string") yield part;
      else yield* reversedText(part);
    }
  }
  yield node.head;
}

/// L'indice dell'ultimo carattere che va a capo in `text`, `\n` o `\r`; `-1`
/// se non ce n'è.
function lastBreakChar(text: string): number {
  return Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
}

/// Dove comincia l'ultimo a capo di `text`: per `\r\n` l'indice del `\r`;
/// `-1` se `text` non va a capo.
export function lastBreak(text: string): number {
  const k = lastBreakChar(text);
  return k > 0 && text.charCodeAt(k) === 0x0a && text.charCodeAt(k - 1) === 0x0d ? k - 1 : k;
}

/// Il rientro della riga su cui sta un testo scritto prima del pezzo `index`
/// di `owner`, dopo `lead`: gli spazi e le tabulazioni in testa alla riga,
/// come `SourceText.indent`. Si ricava dall'albero, senza il testo intero,
/// perché dentro un `batch` il testo non c'è ancora.
export function indentAt(model: DocumentModel, owner: ContainerNode | null, index: number, lead: string): string {
  const passed: string[] = [];
  let first = "";
  let found = false;
  const pieces = (function* (): Generator<string> {
    yield lead;
    yield* textBefore(model, owner, index);
  })();
  for (const piece of pieces) {
    const k = lastBreakChar(piece);
    if (k >= 0) {
      first = piece.slice(k + 1);
      found = true;
      break;
    }
    passed.push(piece);
  }
  let indent = "";
  const take = (text: string): boolean => {
    let i = 0;
    while (i < text.length && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09)) i++;
    indent += text.slice(0, i);
    return i === text.length;
  };
  if (found && !take(first)) return indent;
  for (let i = passed.length - 1; i >= 0; i--) if (!take(passed[i]!)) break;
  return indent;
}

/// Il rientro della riga su cui comincia `node`.
export function indentOf(model: DocumentModel, node: SceneNode): string {
  const owner = node.parent;
  return indentAt(model, owner, (owner === null ? model.parts : owner.parts).indexOf(node), "");
}

// ---------------------------------------------------------------------------
// Percorsi, scope e nomi.
// ---------------------------------------------------------------------------

/// I figli elemento di un contenitore, nell'ordine.
export function elementChildren(container: ContainerNode): ElementPart[] {
  const out: ElementPart[] = [];
  for (const part of container.parts) if (typeof part !== "string" && part.kind !== "other") out.push(part);
  return out;
}

/// Il percorso di un elemento: gli indici dei figli elemento dalla radice.
export function pathOf(node: ElementPart): number[] {
  const path: number[] = [];
  let current: ElementPart = node;
  while (current.parent !== null) {
    path.push(elementChildren(current.parent).indexOf(current));
    current = current.parent;
  }
  return path.reverse();
}

/// Il nome con cui un bersaglio indica il tag: il nome locale per gli
/// elementi SVG, il nome scritto per gli altri.
export function tagName(node: ElementPart): string {
  return node.facts.uri === SVG_NS ? node.facts.local : node.facts.name;
}

/// Gli scope in vigore dentro `container`.
export function scopeOf(container: ContainerNode): NamespaceScope {
  const chain: ContainerNode[] = [];
  for (let c: ContainerNode | null = container; c !== null; c = c.parent) chain.push(c);
  let scope = NamespaceScope.EMPTY;
  for (let i = chain.length - 1; i >= 0; i--) {
    const declarations = chain[i]!.declarations;
    if (declarations.length > 0) scope = scope.declare(declarations);
  }
  return scope;
}

/// Il contenitore più profondo dentro `node`, come lunghezza del percorso.
export function deepest(node: ElementPart): number {
  if (node.kind !== "container") return 0;
  let max = node.depth;
  for (const part of node.parts) {
    if (typeof part !== "string" && part.kind === "container") max = Math.max(max, deepest(part));
  }
  return max;
}

/// Tutti gli elementi del sottoalbero di `node`, lui compreso, coi loro id.
export function idsIn(node: ElementPart): string[] {
  if (node.kind === "leaf") return [...node.ids];
  const out: string[] = node.facts.id === null ? [] : [node.facts.id];
  for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") out.push(...idsIn(part));
  return out;
}

/// Quanti elementi ha il sottoalbero di `node`, lui compreso.
export function elementsIn(node: ElementPart): number {
  if (node.kind === "leaf") return node.elements;
  let count = 1;
  for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") count += elementsIn(part);
  return count;
}

/// Vero se l'elemento è nel namespace SVG col nome `local`.
export function isSvgElement(node: ElementPart, local: string): boolean {
  return node.facts.uri === SVG_NS && node.facts.local === local;
}

// ---------------------------------------------------------------------------
// Voci.
// ---------------------------------------------------------------------------

/// Il testo del primo `title` fra i figli di `container`, come lo legge la
/// lettura intera; `null` se non ne ha. Un `title` estraneo si rilegge.
function titleOf(container: ContainerNode): string | null {
  for (const part of container.parts) {
    if (typeof part === "string" || part.kind === "other" || !isSvgElement(part, "title")) continue;
    if (part.details?.text !== undefined) return part.details.text;
    const fragment = part.kind === "leaf" ? parseFragment(part.raw, scopeOf(container)) : null;
    return fragment === null ? "" : characterData(fragment.doc, fragment.id);
  }
  return null;
}

interface Pending {
  start: number;
  end: number;
  elements: [number, number];
}

/// Le voci della scena, ricavate dall'albero disposto su `source`: le stesse
/// che `classifyDocument` ricava dal testo, con la stessa visita.
export function deriveItems(model: DocumentModel, source: SourceText): Item[] {
  const items: Item[] = [];
  const tags = (node: ContainerNode): Tags => ({
    open: source.span(node.start, node.openEnd),
    close: node.closeStart === null ? null : source.span(node.closeStart, node.end),
  });
  const extend = (pending: Pending | null, node: SceneNode, element: number | null, next: number): Pending => {
    const block = pending ?? { start: node.start, end: node.end, elements: [element ?? next, element ?? next] };
    block.end = node.end;
    if (element !== null) block.elements[1] = element + 1;
    return block;
  };
  const flush = (pending: Pending | null, parentPath: readonly number[] | null): void => {
    if (pending === null) return;
    const span: Span = source.span(pending.start, pending.end);
    items.push({
      kind: "foreign",
      parentPath: parentPath === null ? null : [...parentPath],
      ...span,
      elements: pending.elements,
      indent: source.indent(pending.start),
    });
  };
  const walk = (container: ContainerNode, path: readonly number[]): void => {
    let pending: Pending | null = null;
    let elements = 0;
    for (const part of container.parts) {
      if (typeof part === "string") continue;
      if (part.kind === "other") {
        pending = extend(pending, part, null, elements);
        continue;
      }
      const index = elements++;
      if (part.details === null) {
        pending = extend(pending, part, index, elements);
        continue;
      }
      flush(pending, path);
      pending = null;
      const childPath = [...path, index];
      const span = source.span(part.start, part.end);
      if (part.kind === "container") {
        // Il nome di un contenitore viene dai figli di adesso.
        const title = titleOf(part);
        const details = title === null ? part.details : { ...part.details, title };
        items.push(elementItem(details, childPath, span, source.indent(part.start), tags(part)));
        walk(part, childPath);
      } else {
        items.push(elementItem(part.details, childPath, span, source.indent(part.start), null));
      }
    }
    flush(pending, path);
  };
  let pending: Pending | null = null;
  // Per il documento la radice è l'elemento 0: l'epilogo comincia da 1.
  let next = 0;
  for (const part of model.parts) {
    if (typeof part === "string") continue;
    if (part.kind === "container") {
      flush(pending, null);
      pending = null;
      items.push({ kind: "root", ...source.span(part.start, part.end), tags: tags(part) });
      walk(part, []);
      next = 1;
    } else {
      pending = extend(pending, part, null, next);
    }
  }
  flush(pending, null);
  return items;
}

/// Vero se `element`, letto, è nel namespace SVG.
export function isSvgNode(element: ElementNode): boolean {
  return element.ns === NS_SVG;
}
