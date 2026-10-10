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
import {
  characterData,
  classifyChild,
  describe,
  elementItem,
  localGradients,
  withArrivingSymbols,
  withOriginals,
  NO_RESOURCES,
  originalsOf,
  referencesOf,
  resourceIndex,
  type Details,
  type Item,
  type Place,
  type Resolve,
  type StrokeProblem,
  type Tags,
} from "./classify";
import { urlIds } from "./values";
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
  /// Gli id a cui rimandano gli attributi dell'elemento, senza ripetizioni
  /// (formato della scena, risorse).
  readonly refs: readonly string[];
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
  /// Gli id a cui rimandano gli attributi di tutti gli elementi che
  /// contiene, il suo compreso, e i fogli `style`, senza ripetizioni.
  readonly refs: readonly string[];
  /// Quanti elementi contiene, lui compreso.
  readonly elements: number;
  /// L'indice dopo il `>` del suo tag d'apertura, dall'inizio di `raw`; per
  /// un elemento autochiuso è `raw.length`.
  readonly openLength: number;
}

/// La radice, un livello, un gruppo, un collegamento, una `defs` o un
/// simbolo: i figli si classificano uno per uno.
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
    refs: [...new Set(referencesOf(element))],
  };
}

/// Il posto dei figli di `container`: la radice, una `defs` della radice o
/// un altro contenitore.
export function placeOf(container: ContainerNode): Place {
  if (container.depth === 0) return "root";
  return container.details?.role === "defs" ? "defs" : "inside";
}

/// Gli originali fra i figli di `container` nell'albero, se è una
/// ripetizione: gli id dei figli modificabili, titoli, descrizioni e copie
/// esclusi (formato della scena, ripetizioni). Vuoto per ogni altro
/// contenitore.
export function originalsIn(container: ContainerNode): Set<string> {
  const out = new Set<string>();
  if (container.details?.repeat === undefined) return out;
  for (const part of container.parts) {
    if (typeof part === "string" || part.kind === "other" || part.facts.id === null) continue;
    const role = part.details?.role;
    if (role !== undefined && role !== "title" && role !== "desc" && role !== "copy") out.add(part.facts.id);
  }
  return out;
}

/// `resolve` per un figlio nuovo di `container`: in una ripetizione, con gli
/// originali che ha già.
export function childResolve(container: ContainerNode, resolve: Resolve): Resolve {
  return container.details?.repeat === undefined ? resolve : withOriginals(resolve, originalsIn(container));
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

  constructor(
    private readonly doc: XmlDocument,
    /// Le risorse modificabili a cui gli elementi possono rimandare.
    private readonly resolve: Resolve,
  ) {
    this.text = doc.source.text;
  }

  private slice(from: number, to: number): string {
    return this.text.slice(from, to);
  }

  /// I pezzi dei figli di `id`, che nell'albero è `container`. In una
  /// ripetizione gli originali sono i figli letti e quelli che `container`
  /// ha già.
  parts(id: NodeId, container: ContainerNode): Part[] {
    let resolve = this.resolve;
    if (container.details?.repeat !== undefined) {
      const originals = originalsOf(this.doc, id, container.depth + 1, this.resolve);
      for (const original of originalsIn(container)) originals.add(original);
      resolve = withOriginals(this.resolve, originals);
    }
    const out: Part[] = [];
    for (const child of this.doc.children(id)) {
      const node = this.doc.nodes[child]!;
      if (node.kind === "text") this.textPart(out, node);
      else if (node.kind === "element") out.push(this.element(child, container, resolve));
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
  /// lettore in quella posizione; `resolve` dice che cosa è ogni id a cui
  /// rimanda, gli originali compresi in una ripetizione.
  element(id: NodeId, parent: ContainerNode, resolve: Resolve = this.resolve): ElementPart {
    const doc = this.doc;
    const element = doc.element(id)!;
    const depth = parent.depth + 1;
    const found = classifyChild(doc, id, placeOf(parent), depth, resolve);
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
    const [ids, refs, elements] = this.inside(id);
    const described = found === null ? null : describe(doc, id, found[0], found[1]);
    return {
      kind: "leaf",
      raw: this.slice(element.start, element.end),
      facts,
      details: described === null ? null : described.details,
      problems: described === null ? [] : described.problems,
      ids,
      refs,
      elements,
      openLength: element.openEnd - element.start,
      parent,
      start: 0,
      end: 0,
    };
  }

  /// Gli id, i riferimenti e il numero degli elementi dentro `id`, lui
  /// compreso. La visita usa una pila: un'unità estranea può annidare
  /// centomila elementi.
  private inside(id: NodeId): [string[], string[], number] {
    const doc = this.doc;
    const ids: string[] = [];
    const refs = new Set<string>();
    let elements = 0;
    const stack = [id];
    while (stack.length > 0) {
      const element = doc.element(stack.pop()!);
      if (element === null) continue;
      elements++;
      const value = valueOf(element, NS_NONE, "id");
      if (value !== undefined && value !== "") ids.push(value);
      for (const ref of referencesOf(element)) refs.add(ref);
      // Un foglio di stile rimanda con `url(#id)` come un attributo.
      if (element.local === "style") {
        for (const child of element.children) {
          const node = doc.nodes[child]!;
          if (node.kind === "text" || node.kind === "cdata") for (const ref of urlIds(node.value)) refs.add(ref);
        }
      }
      for (let i = element.children.length - 1; i >= 0; i--) stack.push(element.children[i]!);
    }
    return [ids, [...refs], elements];
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
  const resources = resourceIndex(doc);
  const model = new Builder(doc, (id) => resources.get(id) ?? null).document();
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
  const open = wrapperOf(scope);
  const doc = parseWrapped(open, raw);
  if (doc === null) return null;
  const children = doc.children(doc.root);
  if (children.length !== 1) return null;
  const element = doc.element(children[0]!);
  if (element === null || element.start !== open.length || element.end !== open.length + raw.length) return null;
  return { doc, id: children[0]! };
}

/// Quanti frammenti si leggono insieme al più, e di quanti caratteri: il
/// testo letto resta vivo finché vive uno degli elementi che ne sono stati
/// tagliati, e un lotto piccolo tiene piccolo anche quel peso.
const FRAGMENTS_PER_READ = 16;
const FRAGMENT_CHARS = 16_384;

/// Come [`parseFragment`] per più frammenti dello stesso scope, uno dopo
/// l'altro e senza altro fra loro, letti insieme: il tag che li avvolge e
/// l'avvio della lettura si pagano una volta ogni lotto, non una volta ogni
/// frammento. Ogni frammento dà gli stessi nodi che darebbe da solo, e i
/// frammenti di un lotto condividono il documento letto.
///
/// `null` se anche un solo frammento non è un elemento ben formato da solo,
/// o se i frammenti letti insieme non si dividono come sono stati dati: chi
/// chiama li legge allora uno alla volta, e sa quale è il difetto.
export function parseFragments(raws: readonly string[], scope: NamespaceScope): Fragment[] | null {
  const open = wrapperOf(scope);
  const out: Fragment[] = [];
  let from = 0;
  while (from < raws.length) {
    let to = from;
    let chars = 0;
    do {
      chars += raws[to]!.length;
      to++;
    } while (to < raws.length && to - from < FRAGMENTS_PER_READ && chars + raws[to]!.length <= FRAGMENT_CHARS);
    const doc = parseWrapped(open, raws.slice(from, to).join(""));
    if (doc === null) return null;
    const children = doc.children(doc.root);
    if (children.length !== to - from) return null;
    let at = open.length;
    for (let i = 0; i < children.length; i++) {
      const length = raws[from + i]!.length;
      const element = doc.element(children[i]!);
      if (element === null || element.start !== at || element.end !== at + length) return null;
      out.push({ doc, id: children[i]! });
      at += length;
    }
    from = to;
  }
  return out;
}

/// Il tag d'apertura di un elemento letto da solo: il documento letto e
/// l'elemento in esso. `null` se non si legge.
export type Head = { readonly doc: XmlDocument; readonly element: ElementNode } | null;

/// I tag d'apertura già letti, per elemento, col testo e lo scope con cui sono
/// stati letti: chi li chiede due volte per lo stesso testo, e nello stesso
/// scope, non li rilegge. Li riempie chi li legge ([`readHead`] di `arrange`),
/// e il motore per le unità che ha appena riscritto e riletto.
export const HEADS = new WeakMap<ElementPart, { readonly raw: string; readonly scope: string; readonly head: Head }>();

/// Lo scope come chiave di [`HEADS`]: i suoi legami, in ordine.
export function scopeKey(scope: NamespaceScope): string {
  return [...scope.entries()].map(([prefix, uri]) => `${prefix ?? ""}=${uri}`).join(" ");
}

/// `fragment`, da cui è stata costruita l'unità `node` dentro uno scope di
/// chiave `key`, è anche il suo tag d'apertura letto: chi lo chiede non lo
/// rilegge. Il documento letto, che è quello di un lotto di frammenti, resta
/// vivo quanto l'unità.
export function rememberHead(node: LeafNode, key: string, fragment: Fragment): void {
  HEADS.set(node, { raw: node.raw, scope: key, head: { doc: fragment.doc, element: fragment.doc.element(fragment.id)! } });
}

/// Il tag d'apertura dell'elemento che avvolge un frammento: dichiara i
/// namespace di `scope`.
function wrapperOf(scope: NamespaceScope): string {
  let open = "<fub-fragment";
  for (const [prefix, uri] of scope.entries()) {
    if (prefix === null) {
      if (uri !== "") open += ` xmlns="${escapeAttribute(uri)}"`;
    } else {
      open += ` xmlns:${prefix}="${escapeAttribute(uri)}"`;
    }
  }
  return `${open}>`;
}

function parseWrapped(open: string, raw: string): XmlDocument | null {
  try {
    return parseXml(new SourceText(`${open}${raw}</fub-fragment>`), false);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
}

/// Uno o più elementi fratelli scritti da soli, `raw`, con gli spazi fra
/// loro: i figli di `id` in `doc`, da `offset` nel testo letto.
export interface Sequence {
  readonly doc: XmlDocument;
  readonly id: NodeId;
  readonly offset: number;
}

/// Legge `raw` dentro un contenitore che dichiara `scope`: uno o più elementi
/// fratelli, con spazi fra loro. `null` se non è ben formato, se non
/// comincia e finisce con un elemento, o se fra gli elementi c'è altro.
export function parseSequence(raw: string, scope: NamespaceScope): Sequence | null {
  const open = wrapperOf(scope);
  const doc = parseWrapped(open, raw);
  if (doc === null) return null;
  const children = doc.children(doc.root);
  const first = doc.element(children[0] ?? doc.root);
  const last = doc.element(children[children.length - 1] ?? doc.root);
  if (children.length === 0 || first === null || last === null) return null;
  if (first.start !== open.length || last.end !== open.length + raw.length) return null;
  for (const child of children) {
    const node = doc.nodes[child]!;
    if (node.kind === "element" || (node.kind === "text" && node.blank)) continue;
    return null;
  }
  return { doc, id: doc.root, offset: open.length };
}

/// I pezzi di una sequenza letta, come figli di `parent`, coi riferimenti
/// risolti da `resolve`. In una `defs` le sfumature della sequenza valgono
/// anche per le risorse che le seguono, e i suoi simboli per tutta la
/// sequenza; nella radice valgono i simboli delle sue `defs`.
export function buildSequence(sequence: Sequence, parent: ContainerNode, resolve: Resolve = NO_RESOURCES): Part[] {
  let inner = resolve;
  const place = placeOf(parent);
  if (place === "defs") {
    const local = localGradients(sequence.doc, sequence.id);
    if (local.size > 0) inner = (id) => local.get(id) ?? resolve(id);
  }
  inner = withArrivingSymbols(sequence.doc, sequence.doc.children(sequence.id), place, inner);
  const parts = new Builder(sequence.doc, inner).parts(sequence.id, parent);
  const adopt = (container: ContainerNode): void => {
    for (const part of container.parts) {
      if (typeof part === "string") continue;
      part.parent = container;
      if (part.kind === "container") adopt(part);
    }
  };
  for (const part of parts) {
    if (typeof part === "string") continue;
    part.parent = parent;
    if (part.kind === "container") adopt(part);
  }
  return parts;
}

/// Il nodo di un frammento letto, come figlio di `parent`, coi riferimenti
/// risolti da `resolve`. In una ripetizione rimanda anche agli originali che
/// `parent` ha.
export function buildFragment(fragment: Fragment, parent: ContainerNode, resolve: Resolve = NO_RESOURCES): ElementPart {
  // Un simbolo che entra in una `defs`, anche con la sua, è un simbolo da sé.
  const inner = withArrivingSymbols(fragment.doc, [fragment.id], placeOf(parent), resolve);
  const node = new Builder(fragment.doc, inner).element(fragment.id, parent, childResolve(parent, inner));
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

/// Ciò che dice se `node` è cambiato, per chi legge un nodo una volta sola:
/// un'unità che un'operazione cambia è un nodo nuovo, mentre un contenitore
/// riscrive sul posto il suo tag d'apertura.
export function writtenOf(node: ElementPart): string {
  return node.kind === "container" ? node.head : node.raw;
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
  const out: string[] = [];
  collectIds(node, out);
  return out;
}

function collectIds(node: ElementPart, out: string[]): void {
  if (node.kind === "leaf") {
    for (const id of node.ids) out.push(id);
    return;
  }
  if (node.facts.id !== null) out.push(node.facts.id);
  for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") collectIds(part, out);
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
export function titleOf(container: ContainerNode): string | null {
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
