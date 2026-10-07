// Il motore delle operazioni sulla scena: applica le operazioni, ne calcola
// l'inversa e consegna la `TextOperation` per la `DocumentSession`. Il
// contratto è in `docs/reference/scene-operations.md`, e i `§` dei commenti
// sono le sue sezioni.
//
// Il motore tiene la sorgente come albero di pezzi di testo (`model.ts`) e
// cambia solo i pezzi che un'operazione tocca: il resto del file, terminatori
// misti compresi, resta byte per byte com'era (§6). Ogni elemento scritto da
// un'operazione si rilegge con la classificazione del lettore
// (`classify.ts`): se il lettore non lo vedrebbe modificabile, l'operazione
// si rifiuta. Così il controllo dei valori è uno solo, e la scena in memoria
// è quella che il lettore ricava dal testo.
//
// L'inversa si calcola quando l'operazione si applica (§2). In più ogni esito
// porta un `Undo`: se arriva sulla stessa scena lasciata dall'operazione,
// rimette i nodi di prima e il file torna identico byte per byte; altrimenti
// applica l'inversa, che vale anche dopo cambiamenti altrui (§7).

import { formatNumber } from "../number";
import { BrushError, parseBrush } from "../ink/brush";
import { decodeInk, inkToQuantized, unknownChannels } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { InkError } from "../ink/sample";
import type { TextOperation } from "../../core/text-operation";
import { isContainer, len } from "./analysis";
import { classifyChild, describe, isResourceTag, NO_RESOURCES, resourceKind, type Details, type Item, type Place, type Resolve } from "./classify";
import { sceneOperation } from "./diff";
import { DEFS_ID, isNewId, pageId, type IdKind } from "./ids";
import { positive } from "./annotations";
import {
  buildDocument,
  buildFragment,
  buildSequence,
  declarationsOf,
  deepest,
  deriveItems,
  elementChildren,
  factsOf,
  idsIn,
  indentAt,
  indentOf,
  lastBreak,
  layout,
  materialize,
  parseFragment,
  parseSequence,
  pathOf,
  placeOf,
  rawOf,
  scopeOf,
  tagName,
  tidy,
  type ContainerNode,
  type DocumentModel,
  type ElementPart,
  type Fragment,
  type Part,
  type Sequence,
} from "./model";
import {
  MAX_BATCH,
  MAX_IMAGE_HREF_BYTES,
  MAX_NESTING,
  MAX_VALUE_BYTES,
  ROOT,
  type BatchOp,
  type MetaOp,
  type Op,
  type AnchorPrevious,
  type PagePrevious,
  type PathTarget,
  type Reason,
  type Slot,
  type Target,
  type TextLine,
} from "./ops";
import { MAX_BOARDS, MAX_EDIT_BYTES, MAX_ELEMENTS, MAX_RESOURCES, openSource, readScene, type ReadOnly, type Status } from "./read";
import { parseGuides, parseUnits } from "./rulers";
import {
  attributeName,
  attributesOf,
  canonicalOrder,
  canonicalRuns,
  ElemError,
  elemToOut,
  elementToOut,
  escapeAttribute,
  escapeText,
  isXmlText,
  lineContent,
  NamespaceScope,
  readRuns,
  rootOrder,
  writeElement,
  writeOpenTag,
  type Elem,
  type OutAttr,
  type OutElement,
  type Run,
} from "./serialize";
import { lineBreakOf, newline, normalizeEol, SourceText, utf8Length } from "./text";
import { Tree, type Entry, type HeadState } from "./tree";
import { length as svgLength, number as svgNumber } from "./values";
import {
  FUB_NS,
  isSpace,
  isSvg,
  NS_FUB,
  NS_NONE,
  NS_SVG,
  SVG_NS,
  valueOf,
  XLINK_NS,
  XMLNS_URI,
  type Attr,
  type ElementNode,
  type NodeId,
  type XmlDocument,
} from "./xml";

/// Un'operazione applicata.
export interface Applied {
  readonly outcome: "applied";
  /// L'operazione come si è applicata: quella chiesta, oppure, se la
  /// raccolta ha tolto delle risorse, un `batch` con lei e poi i `remove`
  /// della raccolta (§2).
  readonly forward: Op;
  /// L'inversa, calcolata sulla scena di prima (§2).
  readonly inverse: Op;
  /// Gli id degli elementi toccati, con quelli dei loro discendenti.
  readonly touched: readonly string[];
  /// Le modifiche sul testo a LF di prima (§6).
  readonly operation: TextOperation;
  /// Il testo grezzo di dopo, coi terminatori del file.
  readonly text: string;
  /// Un `add` di un elemento già presente e identico (§8): niente cambia.
  readonly duplicate: boolean;
  /// L'undo di questa operazione.
  readonly undo: Undo;
}

/// Un'operazione rifiutata: la scena resta com'era.
export interface Rejected {
  readonly outcome: "rejected";
  readonly reason: Reason;
  readonly detail: string;
  /// In un `batch`, l'indice dell'operazione che ha fallito.
  readonly index?: number;
}

export type Outcome = Applied | Rejected;

/// Una fila di undo applicati uno dopo l'altro (`SceneEngine.undoAll`), con
/// un solo cambiamento del testo, quello di tutta la fila.
export interface Replayed {
  /// L'undo di ogni undo applicato, in ordine: rimette il suo passo.
  readonly undos: readonly Undo[];
  /// Il rifiuto che ha fermato la fila, all'undo di indice `undos.length`;
  /// `null` se la fila è arrivata in fondo.
  readonly rejected: Rejected | null;
  /// Gli id toccati dalla fila, ciascuno una volta, nell'ordine in cui la
  /// fila li ha toccati.
  readonly touched: readonly string[];
  /// Le modifiche di tutta la fila sul testo a LF di prima (§6).
  readonly operation: TextOperation;
  /// Il testo grezzo di dopo.
  readonly text: string;
}

/// L'undo di un'operazione applicata: l'inversa, e l'operazione che l'undo
/// annulla, che è l'inversa dell'undo stesso (il redo).
export class Undo {
  constructor(
    readonly inverse: Op,
    readonly forward: Op,
    readonly touched: readonly string[],
  ) {}
}

/// Ciò che rende esatto un undo: il registro dell'operazione e le due scene
/// fra cui vale. Fuori dal modulo non si vede.
interface Exact {
  readonly engine: SceneEngine;
  readonly entries: readonly Entry[];
  /// La scena prima dell'operazione, a cui l'undo riporta.
  readonly before: number;
  /// La scena lasciata dall'operazione: l'undo è esatto solo da qui.
  readonly after: number;
}

const EXACT = new WeakMap<Undo, Exact>();

/// Un undo solo per due operazioni applicate una dopo l'altra, come la pila
/// le fonde (§7): annulla tutte e due con l'inversa di `first`, e il suo redo
/// le ripete con l'operazione in avanti di `second`. Vale se le due sono
/// `set` sulle stesse chiavi degli stessi elementi, anche in due `batch` con
/// lo stesso ordine, e se `second` è stata applicata subito dopo `first` e
/// sullo stesso motore: l'undo resta esatto. Altrimenti `null`.
export function mergeUndo(first: Undo, second: Undo): Undo | null {
  const a = EXACT.get(first);
  const b = EXACT.get(second);
  if (a === undefined || b === undefined || a.engine !== b.engine || a.after !== b.before) return null;
  if (!sameSets(first.forward, second.forward)) return null;
  const merged = new Undo(first.inverse, second.forward, [...new Set([...first.touched, ...second.touched])]);
  EXACT.set(merged, { engine: a.engine, entries: [...a.entries, ...b.entries], before: a.before, after: b.after });
  return merged;
}

/// Vero se `a` e `b` cambiano le stesse chiavi degli stessi elementi: due
/// `set`, o due `batch` di `set` nello stesso ordine. Allora l'inversa di `a`
/// rimette anche tutto ciò che `b` ha cambiato.
function sameSets(a: Op, b: Op): boolean {
  if (a.op === "set" && b.op === "set") {
    const keys = Object.keys(a.attrs);
    return (
      a.id === b.id &&
      keys.length === Object.keys(b.attrs).length &&
      keys.every((key) => Object.prototype.hasOwnProperty.call(b.attrs, key))
    );
  }
  if (a.op === "batch" && b.op === "batch") {
    return a.ops.length === b.ops.length && a.ops.every((op, i) => sameSets(op, b.ops[i]!));
  }
  return false;
}

/// Un rifiuto dentro il motore: risale fino ad `apply`, che disfa tutto.
class Rejection extends Error {
  /// Gli indici nei `batch`, dal più esterno.
  readonly indices: number[] = [];

  constructor(
    readonly reason: Reason,
    readonly detail: string,
  ) {
    super(detail);
  }
}

function reject(reason: Reason, detail: string): never {
  throw new Rejection(reason, detail);
}

/// Il dettaglio di un `ElemError` come rifiuto `invalid-elem`.
function elemGuard<T>(write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (error instanceof ElemError) reject("invalid-elem", error.detail);
    throw error;
  }
}

const OP_NAMES: ReadonlySet<unknown> = new Set(["add", "remove", "set", "text", "move", "ident", "page", "meta", "adopt", "anchor", "batch"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPath(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((i) => Number.isSafeInteger(i) && (i as number) >= 0);
}

function isPathTarget(value: unknown): value is PathTarget {
  return isRecord(value) && isPath(value.path) && typeof value.tag === "string";
}

/// Vero se `text` è fatto solo degli spazi di XML.
function isBlank(text: string): boolean {
  return /^[ \t\r\n]*$/.test(text);
}

/// Il dettaglio di un errore d'inchiostro o di pennello.
function inkDetail(error: unknown): string | null {
  return error instanceof InkError || error instanceof BrushError ? error.detail : null;
}

/// Il punto da cui un elemento è stato tolto, coi nodi che lo descrivono.
/// Diventa uno `Slot` a operazione finita, quando i percorsi sono quelli
/// della scena su cui l'inversa si applicherà.
interface Anchor {
  readonly owner: ContainerNode;
  /// L'elemento che precede il punto; `null` se nessuno.
  readonly after: ElementPart | null;
  /// I nodi che non sono elementi fra quell'elemento e il punto.
  readonly skip: number;
  /// Gli spazi rimasti davanti al punto.
  readonly lead: string;
}

/// Il punto dove si inserisce un elemento: prima del pezzo `index` di
/// `owner`, oppure dentro quel pezzo, se sono spazi, dopo `split` caratteri.
interface Point {
  readonly owner: ContainerNode;
  readonly index: number;
  readonly split: number;
}

/// Dove va un elemento nuovo: un punto con lo spazio che lo precede, oppure
/// un genitore vuoto da riscrivere in forma aperta.
type Destination =
  | { readonly kind: "point"; readonly point: Point; readonly gap: string }
  | { readonly kind: "empty"; readonly parent: ContainerNode; readonly indent: string };

/// Ciò che si sa di un elemento riletto da solo.
interface Reread {
  readonly fragment: Fragment;
  readonly element: ElementNode;
  /// Lo scope in vigore dentro l'elemento.
  readonly scope: NamespaceScope;
}

/// Il ruolo di un elemento, `null` se è estraneo.
function roleOf(node: ElementPart): string | null {
  return node.details === null ? null : node.details.role;
}

/// Vero per la carta della pagina: una carta senza `fub:board` (formato della
/// scena, tavole).
function isPagePaper(node: ElementPart): boolean {
  return node.details !== null && node.details.role === "paper" && node.details.board === undefined;
}

/// Che cosa è, fra tavole e carte, un elemento nuovo con questo tag e questi
/// `fub:role` e `fub:board`, figlio della radice se `top`; rifiuta una carta
/// che non è di una tavola o non sta sotto la radice (formato della scena,
/// tavole).
function sheetOf(tag: string, role: string | undefined, board: string | undefined, top: boolean): "board" | "paper" | null {
  if (role === "paper") {
    if (!top || tag !== "rect" || board === undefined) reject("invalid-elem", "una carta nuova è di una tavola, sotto la radice");
    return "paper";
  }
  return top && tag === "view" && role === "board" ? "board" : null;
}

/// Vero se un elemento è `title` o `desc` di SVG.
function isMeta(node: ElementPart): boolean {
  return node.facts.uri === SVG_NS && (node.facts.local === "title" || node.facts.local === "desc");
}

/// `ops` uno dopo l'altro in un `batch` solo: un `batch` fra loro si apre, e
/// la sua etichetta passa a quello nuovo.
function chain(ops: readonly Op[]): BatchOp {
  const out: Op[] = [];
  let label: string | undefined;
  for (const op of ops) {
    if (op.op !== "batch") {
      out.push(op);
      continue;
    }
    for (const inner of op.ops) out.push(inner);
    label ??= op.label;
  }
  return label === undefined ? { op: "batch", ops: out } : { op: "batch", ops: out, label };
}

const ID_NAMES: Readonly<Record<IdKind, string>> = {
  object: "un oggetto",
  layer: "un livello",
  resource: "una risorsa",
  board: "una tavola",
  paper: "la carta di una tavola",
};

/// Vero se un elemento di tag `tag` è una risorsa: un `path` lo è come figlio
/// di una `defs` (`inDefs`), il tracciato di un testo.
function isResource(tag: string, inDefs: boolean): boolean {
  return isResourceTag(tag) || (inDefs && tag === "path");
}

/// Controlla l'id di un elemento nuovo (§4): ogni elemento ne ha uno nella
/// forma degli id nuovi, tranne `title`, `desc`, `tspan` e `textPath`. Una
/// risorsa l'ha nella forma delle risorse e una `defs` è quella di FubDraw;
/// ciò che sta dentro una risorsa può non averlo, e se l'ha è nella forma
/// delle risorse. `inDefs` dice se l'elemento è figlio di una `defs`;
/// `sheet` se è una tavola o la carta di una tavola (formato della scena,
/// tavole); `page` il numero del gruppo di una pagina annotata, che ha l'id
/// dal suo numero (`annotation-format.md`, §3).
function checkNewId(
  tag: string,
  id: string | undefined,
  layer: boolean,
  inResource: boolean,
  inDefs: boolean,
  sheet: "board" | "paper" | null = null,
  page: number | null = null,
): void {
  if (id === undefined) {
    if (!inResource && tag !== "title" && tag !== "desc" && tag !== "tspan" && tag !== "textPath") reject("invalid-elem", `${tag} senza id`);
    return;
  }
  if (page !== null) {
    if (id !== pageId(page)) reject("invalid-elem", `id non valido per la pagina: ${JSON.stringify(id)}`);
    return;
  }
  if (tag === "defs" && !inResource) {
    if (id !== DEFS_ID) reject("invalid-elem", `una defs nuova ha l'id ${DEFS_ID}: ${JSON.stringify(id)}`);
    return;
  }
  const kind: IdKind = inResource || isResource(tag, inDefs) ? "resource" : layer ? "layer" : (sheet ?? "object");
  if (!isNewId(id, kind)) reject("invalid-elem", `id non valido per ${ID_NAMES[kind]}: ${JSON.stringify(id)}`);
}

/// Il nome espanso di ogni elemento e attributo dell'elemento `id`, in
/// ordine: due letture con gli stessi nomi dicono la stessa cosa.
function expandedNames(doc: XmlDocument, id: NodeId): string {
  const out: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const element = doc.element(stack.pop()!);
    if (element === null) continue;
    out.push(`<${doc.namespaces[element.ns]} ${element.local}`);
    for (const attr of element.attrs) out.push(`${doc.namespaces[attr.ns]} ${attr.local}`);
    for (let i = element.children.length - 1; i >= 0; i--) stack.push(element.children[i]!);
  }
  return out.join("\n");
}

/// Le associazioni di due scope sono le stesse.
function sameScope(a: NamespaceScope, b: NamespaceScope): boolean {
  const left = new Map(a.entries());
  const right = b.entries();
  return left.size === right.length && right.every(([prefix, uri]) => left.get(prefix) === uri);
}

/// Dove sta, nel testo di `element`, l'attributo `attr`: dagli spazi che lo
/// precedono alla virgoletta di chiusura, dall'inizio dell'elemento.
function attributeSpan(doc: XmlDocument, element: ElementNode, attr: Attr): [number, number] {
  const text = doc.source.text;
  // Prima del valore: la virgoletta, spazi, `=`, spazi, il nome.
  let i = attr.raw[0] - 2;
  while (isSpace(text.charCodeAt(i))) i--;
  i--;
  while (isSpace(text.charCodeAt(i))) i--;
  let from = i + 1 - attr.name.length;
  while (isSpace(text.charCodeAt(from - 1))) from--;
  return [from - element.start, attr.raw[1] + 1 - element.start];
}

/// Il rientro degli spazi fra i figli di un elemento spostato: ogni riga che
/// comincia con `from` comincia con `to`. Si toccano solo gli spazi fra i
/// figli di livelli, gruppi, collegamenti e unità con figli, mai il testo, i
/// valori o il contenuto estraneo. Se anche una sola riga non comincia con
/// `from`, il rientro del file non è regolare e l'elemento resta com'è: così
/// la stessa regola, applicata all'indietro, rimette i byte di prima.
export function reindent(raw: string, scope: NamespaceScope, place: Place, depth: number, from: string, to: string, resolve: Resolve = NO_RESOURCES): string {
  if (from === to || raw.includes("xml:space")) return raw;
  const fragment = parseFragment(raw, scope);
  if (fragment === null) return raw;
  const { doc } = fragment;
  const base = doc.element(fragment.id)!.start;
  const ranges: Array<readonly [number, number]> = [];
  const stack: Array<readonly [NodeId, Place, number]> = [[fragment.id, place, depth]];
  while (stack.length > 0) {
    const [id, at, level] = stack.pop()!;
    const found = classifyChild(doc, id, at, level, resolve);
    if (found === null) continue;
    const element = doc.element(id)!;
    const container = isContainer(found[1]);
    // Gli spazi di un'unità contano solo fra figli elemento: dentro un
    // `title` sono il suo testo.
    if (!container && !element.children.some((child) => doc.element(child) !== null)) continue;
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" && node.blank) ranges.push([node.start - base, node.end - base]);
      else if (container && node.kind === "element") stack.push([child, found[1] === "defs" ? "defs" : "inside", level + 1]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const starts: number[] = [];
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) {
      const c = raw.charCodeAt(i);
      if (c !== 0x0a && c !== 0x0d) continue;
      if (c === 0x0d && i + 1 < end && raw.charCodeAt(i + 1) === 0x0a) continue;
      const line = i + 1;
      // Una riga vuota non ha rientro da spostare.
      if (line < end && (raw.charCodeAt(line) === 0x0a || raw.charCodeAt(line) === 0x0d)) continue;
      if (line + from.length > end || !raw.startsWith(from, line)) return raw;
      starts.push(line);
    }
  }
  let out = "";
  let at = 0;
  for (const start of starts) {
    out += raw.slice(at, start) + to;
    at = start + from.length;
  }
  return out + raw.slice(at);
}

/// Un attributo che un `set` cambia: la chiave scritta nell'operazione, il
/// nome espanso, il nome col prefisso del documento e il valore nuovo, `null`
/// per toglierlo.
interface Change {
  readonly key: string;
  readonly uri: string;
  readonly local: string;
  readonly name: string;
  readonly value: string | null;
}

/// Gli attributi scritti con i cambiamenti di `changes`, per nome espanso
/// (`"<uri> <local>"`): un valore nuovo prende il posto del vecchio, `null` lo
/// toglie, un attributo che non c'era va in fondo.
function changed(changes: ReadonlyMap<string, Change>): (attrs: OutAttr[]) => OutAttr[] {
  return (attrs) => {
    const out: OutAttr[] = [];
    const done = new Set<string>();
    for (const attr of attrs) {
      const expanded = `${attr.uri} ${attr.local}`;
      const change = changes.get(expanded);
      if (change === undefined) {
        out.push(attr);
        continue;
      }
      done.add(expanded);
      if (change.value !== null) out.push({ ...attr, text: escapeAttribute(change.value) });
    }
    for (const [expanded, change] of changes) {
      if (done.has(expanded) || change.value === null) continue;
      out.push({ name: change.name, uri: change.uri, local: change.local, text: escapeAttribute(change.value) });
    }
    return out;
  };
}

/// Il motore di un documento aperto.
export class SceneEngine {
  private readonly tree: Tree | null;
  private readonly eol: string;
  private raw: string;
  private lf: string;
  /// Perché il documento è in sola lettura; vuoto se si può modificare.
  readonly readOnly: readonly ReadOnly[];
  /// La scena corrente: cambia a ogni operazione applicata, e torna quella
  /// di prima con un undo esatto.
  private state = 0;
  private counter = 0;
  private items: readonly Item[] | null = null;
  // Lo stato di un'applicazione in corso.
  private touched = new Set<string>();
  private duplicate = false;
  /// Le `defs` di FubDraw che hanno perso un figlio: la raccolta toglie
  /// quella rimasta vuota.
  private emptied = new Set<ContainerNode>();
  /// Le tavole che l'operazione tocca, con quelle delle carte che tocca, e
  /// gli id delle carte: la coerenza le guarda alla fine (formato della
  /// scena, tavole).
  private boards = new Set<string>();
  private papers = new Set<string>();
  /// Vero mentre si applica un'inversa del motore: il limite delle
  /// operazioni di un `batch` vale per ciò che arriva, e l'inversa di un
  /// `add` grande toglie i suoi elementi uno per uno.
  private inverse = false;
  /// Vero mentre `undoAll` applica la sua fila: il testo si scrive una volta,
  /// alla fine.
  private quiet = false;

  /// Che cosa è la risorsa modificabile che porta `id` nella scena corrente:
  /// ogni elemento scritto si legge con le risorse che ci sono (formato della
  /// scena, risorse).
  private readonly resolve: Resolve = (id) => {
    const node = this.tree === null ? null : this.tree.element(id);
    return node !== null && roleOf(node) === "resource" ? resourceKind(node.facts.local) : null;
  };

  private constructor(source: string) {
    const opened = openSource(source);
    this.raw = source;
    this.lf = normalizeEol(source);
    this.eol = newline(lineBreakOf(source));
    this.readOnly = opened.readOnly;
    this.tree = opened.readOnly.length === 0 ? new Tree(buildDocument(opened.doc), opened.status, opened.doc.elements) : null;
  }

  /// Apre `source`, il testo intero del file. Lancia `ReadError` se non è
  /// una scena.
  static open(source: string): SceneEngine {
    return new SceneEngine(source);
  }

  /// Il testo grezzo corrente.
  get text(): string {
    return this.raw;
  }

  /// Il testo corrente a LF, quello della `DocumentSession`.
  get normalized(): string {
    return this.lf;
  }

  /// `null` per un documento in sola lettura.
  get status(): Status | null {
    return this.tree === null ? null : this.tree.status;
  }

  /// L'albero del documento, per chi lo disegna (`painter/`): si legge e
  /// non si modifica. Un nodo che un'operazione non tocca resta lo stesso
  /// oggetto, e su questo il painter misura che cosa ridisegnare. `null` per
  /// un documento in sola lettura, che la superficie mostra intero come
  /// immagine inerte.
  get model(): DocumentModel | null {
    return this.tree === null ? null : this.tree.model;
  }

  /// L'elemento che porta `id`, o l'unità estranea che lo contiene: il
  /// painter ci risolve i riferimenti di un blocco estraneo verso il resto
  /// del documento.
  holder(id: string): ElementPart | null {
    return this.tree === null ? null : this.tree.holder(id);
  }

  /// Le voci della scena corrente, le stesse che il lettore ricava dal testo.
  scene(): readonly Item[] {
    if (this.items === null) {
      if (this.tree === null) {
        this.items = readScene(this.raw).items;
      } else {
        layout(this.tree.model);
        this.items = deriveItems(this.tree.model, new SourceText(this.raw));
      }
    }
    return this.items;
  }

  /// Applica `op`: tutta oppure niente.
  apply(op: Op): Outcome {
    const tree = this.tree;
    if (tree === null) {
      return { outcome: "rejected", reason: "read-only", detail: `documento in sola lettura: ${this.readOnly.join(", ")}` };
    }
    const mark = tree.mark();
    this.touched = new Set();
    this.duplicate = false;
    this.emptied = new Set();
    this.boards = new Set();
    this.papers = new Set();
    // La raccolta guarda soltanto i riferimenti che toglie questa operazione.
    tree.orphans();
    const boards = this.boardCount();
    let forward: Op = op;
    let inverse: Op;
    try {
      inverse = this.run(op);
      const { removes, restores } = this.collect();
      if (!this.inverse) this.checkBoards(boards);
      if (removes.length > 0) {
        forward = chain([op, ...removes]);
        inverse = chain([...restores.reverse(), inverse]);
      }
    } catch (error) {
      tree.rollback(mark);
      if (!(error instanceof Rejection)) throw error;
      const first = error.indices[0];
      return first === undefined
        ? { outcome: "rejected", reason: error.reason, detail: error.detail }
        : { outcome: "rejected", reason: error.reason, detail: error.detail, index: first };
    }
    return this.commit(tree.take(mark), forward, inverse, [...this.touched], this.duplicate, null);
  }

  /// Annulla l'operazione di `undo`: esattamente, se la scena è quella che
  /// l'operazione ha lasciato; altrimenti con l'inversa, che è rifiutata se
  /// il bersaglio è cambiato altrove (§7).
  undo(undo: Undo): Outcome {
    const exact = EXACT.get(undo);
    const tree = this.tree;
    if (tree !== null && exact !== undefined && exact.engine === this && exact.after === this.state) {
      const mark = tree.mark();
      tree.undo(exact.entries);
      return this.commit(tree.take(mark), undo.inverse, undo.forward, undo.touched, false, exact.before);
    }
    this.inverse = true;
    try {
      return this.apply(undo.inverse);
    } finally {
      this.inverse = false;
    }
  }

  /// Annulla gli undo di `undos`, uno dopo l'altro, come `undo`, e si ferma
  /// al primo rifiutato. Il testo si scrive una volta sola, alla fine: mille
  /// passi costano poco più di uno, e il cambiamento è uno, dal testo di
  /// prima a quello di dopo (§7).
  undoAll(undos: readonly Undo[]): Replayed {
    const before = this.lf;
    const done: Undo[] = [];
    const touched = new Set<string>();
    let rejected: Rejected | null = null;
    this.quiet = true;
    try {
      for (const undo of undos) {
        const outcome = this.undo(undo);
        if (outcome.outcome === "rejected") {
          rejected = outcome;
          break;
        }
        done.push(outcome.undo);
        for (const id of outcome.touched) touched.add(id);
      }
    } finally {
      this.quiet = false;
      if (done.length > 0) {
        this.raw = materialize(this.tree!.model);
        this.lf = normalizeEol(this.raw);
      }
    }
    return { undos: done, rejected, touched: [...touched], operation: sceneOperation(before, this.lf), text: this.raw };
  }

  /// Chiude un'applicazione: il testo nuovo, la `TextOperation` e l'undo.
  /// `target` è la scena a cui riporta un undo esatto; `null` per una scena
  /// nuova, che deve stare nei limiti. Nella fila di `undoAll` il testo
  /// resta indietro, e lo scrive lei alla fine: un undo esatto non lo
  /// guarda nemmeno, l'inversa solo per i limiti.
  private commit(
    entries: Entry[],
    forward: Op,
    inverse: Op,
    touched: readonly string[],
    duplicate: boolean,
    target: number | null,
  ): Outcome {
    const tree = this.tree!;
    const before = this.state;
    let operation: TextOperation = { beforeLength: this.lf.length, afterLength: this.lf.length, edits: [] };
    if (entries.length > 0) {
      const raw = this.quiet && target !== null ? null : materialize(tree.model);
      if (raw !== null && target === null && (utf8Length(raw) > MAX_EDIT_BYTES || tree.elements > MAX_ELEMENTS)) {
        const mark = tree.mark();
        tree.undo(entries);
        tree.take(mark);
        return {
          outcome: "rejected",
          reason: "limit",
          detail: `il documento supererebbe ${MAX_EDIT_BYTES} byte o ${MAX_ELEMENTS} elementi`,
        };
      }
      if (raw !== null && !this.quiet) {
        const lf = normalizeEol(raw);
        operation = sceneOperation(this.lf, lf);
        this.raw = raw;
        this.lf = lf;
      }
      this.items = null;
      this.state = target ?? ++this.counter;
    }
    const undo = new Undo(inverse, forward, touched);
    EXACT.set(undo, { engine: this, entries, before, after: this.state });
    return { outcome: "applied", forward, inverse, touched, operation, text: this.raw, duplicate, undo };
  }

  // -------------------------------------------------------------------------
  // Le operazioni.
  // -------------------------------------------------------------------------

  private get t(): Tree {
    return this.tree!;
  }

  private run(op: unknown): Op {
    if (!isRecord(op) || !OP_NAMES.has(op.op)) {
      reject("invalid-elem", `operazione sconosciuta: ${JSON.stringify(isRecord(op) ? op.op : op)}`);
    }
    if (op.op === "batch") return this.batch(op);
    if (op.op === "adopt") return this.adopt(op);
    // Un SVG estraneo resta com'è finché «Modifica» non lo adotta (formato
    // della scena, §2).
    if (this.t.status === "foreign") reject("foreign", "il documento non è di FubDraw: si modifica dopo «Modifica»");
    switch (op.op) {
      case "add":
        return "slot" in op ? this.restore(op) : this.add(op);
      case "remove":
        return this.remove(op);
      case "set":
        return this.set(op);
      case "text":
        return this.text_(op);
      case "move":
        return "slot" in op ? this.moveBack(op) : this.move(op);
      case "ident":
        return this.ident(op);
      case "page":
        return this.page(op);
      case "anchor":
        return this.anchor(op);
      default:
        return this.meta(op);
    }
  }

  private batch(op: Record<string, unknown>): Op {
    const ops = op.ops;
    if (!Array.isArray(ops)) reject("invalid-elem", "batch senza ops");
    if (op.label !== undefined && typeof op.label !== "string") reject("invalid-elem", "etichetta non stringa");
    const count = (list: readonly unknown[]): number =>
      list.reduce<number>(
        (sum, inner) => sum + (isRecord(inner) && inner.op === "batch" && Array.isArray(inner.ops) ? count(inner.ops) : 1),
        0,
      );
    if (!this.inverse && count(ops) > MAX_BATCH) reject("limit", `batch oltre ${MAX_BATCH} operazioni`);
    const inverses: Op[] = [];
    for (let i = 0; i < ops.length; i++) {
      try {
        inverses.push(this.run(ops[i]));
      } catch (error) {
        if (error instanceof Rejection) error.indices.unshift(i);
        throw error;
      }
    }
    const inverse: BatchOp = { op: "batch", ops: inverses.reverse() };
    return typeof op.label === "string" ? { ...inverse, label: op.label } : inverse;
  }

  // -------------------------------------------------------------------------
  // Riferimenti.
  // -------------------------------------------------------------------------

  /// Un bersaglio: l'elemento con quell'id, o quello senza id al percorso.
  private target(target: unknown, reason: Reason = "missing-target"): ElementPart {
    if (typeof target === "string") {
      const node = this.t.element(target);
      if (node === null || node === this.t.model.root) reject(reason, `nessun elemento con id ${JSON.stringify(target)}`);
      return node;
    }
    if (!isPathTarget(target)) reject("invalid-elem", "bersaglio non valido");
    const node = this.walk(target.path);
    if (node === null || node === this.t.model.root || node.facts.id !== null || tagName(node) !== target.tag) {
      reject(reason, `nessun ${target.tag} senza id al percorso ${JSON.stringify(target.path)}`);
    }
    return node;
  }

  /// L'elemento al percorso, scendendo solo nei contenitori.
  private walk(path: readonly number[]): ElementPart | null {
    let node: ElementPart = this.t.model.root;
    for (const index of path) {
      if (node.kind !== "container") return null;
      const child: ElementPart | undefined = elementChildren(node)[index];
      if (child === undefined) return null;
      node = child;
    }
    return node;
  }

  /// Un genitore: la radice, o un livello, un gruppo o un collegamento
  /// modificabile.
  private container(ref: unknown): ContainerNode {
    if (ref === ROOT) return this.t.model.root;
    let node: ElementPart | null;
    if (typeof ref === "string") {
      node = this.t.element(ref);
    } else {
      if (!isPathTarget(ref)) reject("invalid-elem", "genitore non valido");
      node = this.walk(ref.path);
      if (node !== null && (node.facts.id !== null || tagName(node) !== ref.tag)) node = null;
    }
    if (node === null || node === this.t.model.root) reject("missing-parent", `nessun genitore ${JSON.stringify(ref)}`);
    if (node.kind !== "container") {
      if (node.details === null) reject("foreign", `${JSON.stringify(ref)} è estraneo`);
      reject("missing-parent", `${JSON.stringify(ref)} non è un livello né un gruppo`);
    }
    return node;
  }

  /// Come si indirizza `node` adesso.
  private targetOf(node: ElementPart): Target {
    return node.facts.id ?? { path: pathOf(node), tag: tagName(node) };
  }

  private refOf(container: ContainerNode): Target {
    return container === this.t.model.root ? ROOT : this.targetOf(container);
  }

  /// Vero se un contenitore bloccato, livello, gruppo o collegamento,
  /// contiene `node`, `node` escluso.
  private lockedAbove(node: ElementPart): boolean {
    for (let c = node.parent; c !== null; c = c.parent) {
      if (c.details?.locked === true) return true;
    }
    return false;
  }

  /// Vero se in `container` non si scrive: è bloccato o sta dentro un
  /// contenitore bloccato.
  private lockedInside(container: ContainerNode): boolean {
    return container.details?.locked === true || this.lockedAbove(container);
  }

  /// I controlli comuni su un elemento da cambiare: niente carta della
  /// pagina, niente contenitori bloccati sopra e, se `editable`, niente
  /// estranei. Un elemento bloccato si cambia: è così che si sblocca. La
  /// carta di una tavola si cambia (formato della scena, tavole); con
  /// `pagePaper` passa anche quella della pagina, e la controlla chi chiama.
  private guard(node: ElementPart, editable: boolean, pagePaper = false): void {
    if (!pagePaper && isPagePaper(node)) reject("locked", "la carta della pagina cambia solo con page");
    if (this.lockedAbove(node)) reject("locked", "l'elemento sta in un livello o in un gruppo bloccato");
    if (editable && node.details === null) reject("foreign", "l'elemento è estraneo");
  }

  /// Vero se `container` è `node` o sta dentro `node`.
  private within(container: ContainerNode, node: ElementPart): boolean {
    for (let c: ContainerNode | null = container; c !== null; c = c.parent) if (c === node) return true;
    return false;
  }

  private touch(node: ElementPart): void {
    for (const id of idsIn(node)) this.touched.add(id);
  }

  // -------------------------------------------------------------------------
  // Le tavole (formato della scena, tavole).
  // -------------------------------------------------------------------------

  /// Annota `node`, se è una tavola o una carta della radice: la coerenza
  /// guarda la tavola, o quella della carta, alla fine dell'operazione. Si
  /// chiama prima di cambiare `node`, e dopo averlo aggiunto.
  private sheet(node: ElementPart): void {
    if (node.parent !== this.t.model.root || node.details === null) return;
    const id = node.facts.id;
    if (node.details.role === "board" && id !== null) this.boards.add(id);
    if (node.details.role !== "paper") return;
    if (node.details.board !== undefined) this.boards.add(node.details.board);
    if (id !== null) this.papers.add(id);
  }

  /// Quante tavole ha il documento.
  private boardCount(): number {
    let count = 0;
    for (const child of elementChildren(this.t.model.root)) if (roleOf(child) === "board") count++;
    return count;
  }

  /// La coerenza delle tavole, alla fine di un'operazione: ogni tavola
  /// toccata, o di una carta toccata, ha al più una carta, con la sua
  /// geometria; ogni carta toccata, o di quelle tavole, rimanda a una tavola
  /// che c'è; in un disegno con le tavole nessuna carta toccata è senza
  /// tavola, e nessuna lo è dopo la prima tavola. Un file già fuori regola
  /// altrove si modifica lo stesso. `before` sono le tavole di prima.
  private checkBoards(before: number): void {
    if (this.boards.size === 0 && this.papers.size === 0) return;
    const root = this.t.model.root;
    const boards = new Map<string, ElementPart>();
    const papers = new Map<string, ElementPart[]>();
    const free: ElementPart[] = [];
    let count = 0;
    for (const child of elementChildren(root)) {
      const role = roleOf(child);
      if (role === "board") {
        count++;
        if (!boards.has(child.facts.id!)) boards.set(child.facts.id!, child);
      } else if (role === "paper") {
        const board = child.details!.board;
        if (board === undefined) free.push(child);
        else papers.set(board, [...(papers.get(board) ?? []), child]);
      }
    }
    if (count > MAX_BOARDS && count > before) reject("limit", `il documento supererebbe ${MAX_BOARDS} tavole`);
    const involved = new Set(this.boards);
    for (const id of this.papers) {
      const paper = this.t.element(id);
      if (paper === null || paper.parent !== root || roleOf(paper) !== "paper") continue;
      const board = paper.details!.board;
      if (board === undefined) {
        if (count > 0) reject("invalid-elem", `la carta ${id} non ha una tavola in un disegno con le tavole`);
      } else {
        involved.add(board);
      }
    }
    if (before === 0 && count > 0 && free.length > 0) {
      reject("invalid-elem", "con la prima tavola la carta della pagina diventa la sua");
    }
    for (const id of involved) {
      const own = papers.get(id) ?? [];
      const board = boards.get(id);
      if (board === undefined) {
        if (own.length > 0) reject("invalid-elem", `una carta rimanda alla tavola ${id}, che non c'è`);
        continue;
      }
      if (own.length > 1) reject("invalid-elem", `la tavola ${id} ha più di una carta`);
      const paper = own[0];
      if (paper === undefined) continue;
      const element = this.reread(paper).element;
      const box = board.details!.box!;
      const rect = [len(element, "x") ?? 0, len(element, "y") ?? 0, len(element, "width") ?? 0, len(element, "height") ?? 0];
      if (rect.some((v, i) => v !== box[i])) reject("invalid-elem", `la carta della tavola ${id} non ha la sua geometria`);
    }
  }

  // -------------------------------------------------------------------------
  // Le risorse del disegno (formato della scena, risorse).
  // -------------------------------------------------------------------------

  /// Gli id delle risorse modificabili che `node` è o contiene: una risorsa,
  /// o i figli di una `defs`.
  private resourcesIn(node: ElementPart): string[] {
    const nodes = node.kind === "container" && roleOf(node) === "defs" ? elementChildren(node) : [node];
    const out: string[] = [];
    for (const child of nodes) if (roleOf(child) === "resource" && child.facts.id !== null) out.push(child.facts.id);
    return out;
  }

  /// Il primo id di una risorsa modificabile che `node` è o contiene a cui
  /// rimanda qualcosa fuori da `node`; `null` se nessuno.
  private usedOutside(node: ElementPart): string | null {
    const ids = this.resourcesIn(node);
    if (ids.length === 0) return null;
    // I rimandi da dentro `node`, contati come li conta l'albero.
    const inside = new Map<string, number>();
    const count = (part: ElementPart): void => {
      for (const id of part.kind === "leaf" ? part.refs : part.facts.refs) inside.set(id, (inside.get(id) ?? 0) + 1);
      if (part.kind !== "container") return;
      for (const child of part.parts) if (typeof child !== "string" && child.kind !== "other") count(child);
    };
    count(node);
    return ids.find((id) => this.t.referrers(id) > (inside.get(id) ?? 0)) ?? null;
  }

  /// I controlli sulle risorse che entrano con `nodes` (§2): nessuna ha un
  /// id a cui il documento rimanda già, perché chi rimanda cambierebbe
  /// natura, e se `limit` il documento non ne riceve oltre il limite.
  private checkResources(nodes: readonly ElementPart[], limit: boolean): void {
    const ids = nodes.flatMap((node) => this.resourcesIn(node));
    const used = ids.find((id) => this.t.referrers(id) > 0);
    if (used !== undefined) reject("duplicate-id", `il documento rimanda già a ${used}`);
    if (limit && ids.length > 0 && this.t.resources + ids.length > MAX_RESOURCES) {
      reject("limit", `il documento supererebbe ${MAX_RESOURCES} risorse`);
    }
  }

  /// La raccolta, alla fine di ogni operazione applicata (§2): le risorse
  /// `private` e `shared` a cui l'operazione ha tolto l'ultimo riferimento se
  /// ne vanno, poi quelle rimaste sole per questo, e infine la `defs` di
  /// FubDraw rimasta vuota. Restituisce i `remove` fatti, in ordine, e le
  /// loro inverse.
  private collect(): { removes: Op[]; restores: Op[] } {
    const removes: Op[] = [];
    const restores: Op[] = [];
    const drop = (node: ElementPart): void => {
      const target = this.targetOf(node);
      removes.push({ op: "remove", target });
      restores.push(this.remove({ op: "remove", target }));
    };
    for (let lost = this.t.orphans(); lost.length > 0; lost = this.t.orphans()) {
      for (const id of lost) {
        const node = this.t.element(id);
        // Una risorsa senza ciclo di vita resta anche sola.
        if (node !== null && node.details?.lifecycle !== undefined) drop(node);
      }
    }
    for (const defs of [...this.emptied]) {
      if (this.t.element(DEFS_ID) === defs && defs.parts.every((part) => typeof part === "string")) drop(defs);
    }
    return { removes, restores };
  }

  // -------------------------------------------------------------------------
  // Testo e pezzi.
  // -------------------------------------------------------------------------

  /// Il testo a LF scritto col terminatore del file.
  private eolOf(text: string): string {
    return this.eol === "\n" ? text : text.replace(/\n/g, this.eol);
  }

  /// Sostituisce i pezzi `[from, to)` di `owner`, allargando la finestra
  /// agli spazi vicini perché due stringhe non restino accostate.
  private replace(owner: ContainerNode, from: number, to: number, replacement: readonly Part[]): void {
    const parts = owner.parts;
    let items = [...replacement];
    let start = from;
    let end = to;
    if (start > 0 && typeof parts[start - 1] === "string") {
      start--;
      items = [parts[start]!, ...items];
    }
    if (end < parts.length && typeof parts[end] === "string") {
      items = [...items, parts[end]!];
      end++;
    }
    this.t.splice(owner, start, end - start, tidy(items));
  }

  /// Mette nel punto, preceduti da `gap`, un elemento o pezzi che
  /// cominciano e finiscono con un elemento.
  private insertAt(point: Point, gap: string, parts: readonly Part[]): void {
    const { owner, index, split } = point;
    const there = owner.parts[index];
    if (typeof there === "string" && split > 0) {
      this.replace(owner, index, index + 1, [there.slice(0, split) + gap, ...parts, there.slice(split)]);
    } else {
      this.replace(owner, index, index, [gap, ...parts]);
    }
  }

  /// Toglie `node` dal suo contenitore. Se comincia una riga, va via anche
  /// l'a capo col rientro che lo precede, così non resta una riga vuota
  /// (§6). Restituisce il punto e gli spazi tolti, per rimetterlo.
  private detach(node: ElementPart): { anchor: Anchor; gap: string } {
    const owner = node.parent!;
    if (owner.facts.id === DEFS_ID && roleOf(owner) === "defs") this.emptied.add(owner);
    const index = owner.parts.indexOf(node);
    const before = owner.parts[index - 1];
    let from = index;
    let gap = "";
    let lead = "";
    if (typeof before === "string") {
      const k = lastBreak(before);
      if (k >= 0) {
        gap = before.slice(k);
        lead = before.slice(0, k);
        from = index - 1;
      } else {
        lead = before;
      }
    }
    // Il punto si descrive dall'elemento che precede: i nodi che non sono
    // elementi non si spostano mai, e si contano.
    let skip = 0;
    let after: ElementPart | null = null;
    for (let i = (typeof before === "string" ? index - 1 : index) - 1; i >= 0; i--) {
      const part = owner.parts[i]!;
      if (typeof part === "string") continue;
      if (part.kind !== "other") {
        after = part;
        break;
      }
      skip++;
    }
    this.replace(owner, from, index + 1, from === index || lead === "" ? [] : [lead]);
    return { anchor: { owner, after, skip, lead }, gap };
  }

  /// Lo `Slot` di un punto, sulla scena corrente.
  private slotOf(anchor: Anchor): Slot {
    return {
      parent: this.refOf(anchor.owner),
      after: anchor.after === null ? null : this.targetOf(anchor.after),
      skip: anchor.skip,
      lead: anchor.lead,
    };
  }

  /// I nodi di uno `Slot`, sulla scena corrente.
  private anchorOf(slot: unknown): Anchor {
    if (
      !isRecord(slot)
      || (typeof slot.parent !== "string" && !isPathTarget(slot.parent))
      || (slot.after !== null && typeof slot.after !== "string" && !isPathTarget(slot.after))
      || !Number.isSafeInteger(slot.skip)
      || (slot.skip as number) < 0
      || typeof slot.lead !== "string"
      || !isBlank(slot.lead)
    ) {
      reject("invalid-elem", "punto non valido");
    }
    const owner = this.container(slot.parent);
    let after: ElementPart | null = null;
    if (slot.after !== null) {
      after = this.target(slot.after, "missing-anchor");
      if (after.parent !== owner) reject("missing-anchor", "l'elemento di riferimento ha cambiato genitore");
    }
    return { owner, after, skip: slot.skip as number, lead: slot.lead };
  }

  /// Il punto di un `Anchor` nei pezzi correnti.
  private pointOf(anchor: Anchor): Point {
    const { owner } = anchor;
    let k = anchor.after === null ? -1 : owner.parts.indexOf(anchor.after);
    if (anchor.after !== null && k < 0) reject("missing-anchor", "l'elemento di riferimento non c'è più");
    for (let left = anchor.skip; left > 0;) {
      k++;
      const part = owner.parts[k];
      if (part === undefined || (typeof part !== "string" && part.kind !== "other")) reject("missing-anchor", "il punto non c'è più");
      if (typeof part !== "string") left--;
    }
    if (anchor.lead === "") return { owner, index: k + 1, split: 0 };
    const next = owner.parts[k + 1];
    if (typeof next !== "string" || !next.startsWith(anchor.lead)) reject("missing-anchor", "gli spazi del punto sono cambiati");
    return { owner, index: k + 1, split: anchor.lead.length };
  }

  /// Vero se un contenitore non ha figli né righe: `<g/>`, `<g></g>`.
  private collapsed(container: ContainerNode): boolean {
    return container.tail === null || container.parts.every((part) => typeof part === "string" && lastBreak(part) < 0);
  }

  /// Dove va un elemento nuovo secondo `pos` (§2 e §6), su una riga sua.
  /// `defs` dice se è una `defs`, che con `first` va prima della carta.
  private destination(parent: ContainerNode, pos: unknown, defs = false): Destination {
    const model = this.t.model;
    const line = (point: Point, indent: string): Destination => ({ kind: "point", point, gap: this.eolOf(`\n${indent}`) });
    const after = (anchor: ElementPart): Destination =>
      line({ owner: parent, index: parent.parts.indexOf(anchor) + 1, split: 0 }, indentOf(model, anchor));
    const inner = (): string => `${indentOf(model, parent)}  `;
    if (!isRecord(pos)) reject("invalid-elem", "posizione non valida");
    if (pos.after !== undefined) {
      const anchor = typeof pos.after === "string" ? this.t.element(pos.after) : null;
      if (anchor === null || anchor.parent !== parent) {
        reject("missing-anchor", `${JSON.stringify(pos.after)} non è un figlio del genitore`);
      }
      return after(anchor);
    }
    if (pos.first !== true && pos.last !== true) reject("invalid-elem", "posizione non valida");
    if (this.collapsed(parent)) return { kind: "empty", parent, indent: inner() };
    const children = elementChildren(parent);
    if (pos.first === true) {
      // `first` viene dopo titolo e descrizione che stanno in testa e, sotto
      // la radice, dopo le `defs` modificabili, le carte e le tavole che li
      // seguono: in fondo all'ordine visivo, non prima dei metadati. Una
      // `defs` va subito dopo titolo e descrizione, prima della carta.
      const root = parent === model.root && !defs;
      const head = (child: ElementPart): boolean => {
        const role = roleOf(child);
        return role === "defs" || role === "paper" || role === "board";
      };
      let anchor: ElementPart | null = null;
      for (const child of children) {
        if (!isMeta(child) && !(root && head(child))) break;
        anchor = child;
      }
      return anchor === null ? line({ owner: parent, index: 0, split: 0 }, inner()) : after(anchor);
    }
    // `last`: prima della riga del tag di chiusura.
    const sibling = children[children.length - 1];
    const indent = sibling === undefined ? inner() : indentOf(model, sibling);
    const end = parent.parts.length;
    const tail = parent.parts[end - 1];
    if (typeof tail === "string" && lastBreak(tail) >= 0) {
      return line({ owner: parent, index: end - 1, split: lastBreak(tail) }, indent);
    }
    return line({ owner: parent, index: end, split: 0 }, indent);
  }

  /// Il rientro della riga su cui comincia un elemento messo in `to`.
  private indentFor(to: Destination): string {
    if (to.kind === "empty") return to.indent;
    const { owner, index, split } = to.point;
    const there = owner.parts[index];
    const lead = typeof there === "string" ? there.slice(0, split) : "";
    return indentAt(this.t.model, owner, index, lead + to.gap);
  }

  /// Mette in `to` un elemento, o pezzi che cominciano e finiscono con un
  /// elemento.
  private place(to: Destination, parts: readonly Part[]): void {
    if (to.kind === "point") {
      this.insertAt(to.point, to.gap, parts);
      return;
    }
    // Un genitore vuoto si riscrive in forma aperta, col figlio dentro (§6).
    const { parent } = to;
    const indent = indentOf(this.t.model, parent);
    if (parent.tail === null) this.rewriteHead(parent, (attrs) => attrs, false);
    this.t.splice(parent, 0, parent.parts.length, [this.eolOf(`\n${to.indent}`), ...parts, this.eolOf(`\n${indent}`)]);
  }

  // -------------------------------------------------------------------------
  // Lettura e scrittura di un elemento.
  // -------------------------------------------------------------------------

  /// `raw` letto come figlio di `parent`; `null` se non è un elemento ben
  /// formato da solo in quello scope.
  private build(raw: string, parent: ContainerNode): ElementPart | null {
    const fragment = parseFragment(raw, scopeOf(parent));
    return fragment === null ? null : buildFragment(fragment, parent, this.resolve);
  }

  /// Un elemento del documento riletto da solo; per un contenitore solo i
  /// tag.
  private reread(node: ElementPart): Reread {
    const raw = node.kind === "leaf" ? node.raw : node.tail === null ? node.head : `${node.head}</${node.facts.name}>`;
    const outer = node.parent === null ? NamespaceScope.EMPTY : scopeOf(node.parent);
    const fragment = parseFragment(raw, outer);
    if (fragment === null) throw new Error("un elemento del documento non si rilegge da solo");
    const element = fragment.doc.element(fragment.id)!;
    const declarations = declarationsOf(element);
    return { fragment, element, scope: declarations.length === 0 ? outer : outer.declare(declarations) };
  }

  /// Cambia il tag d'apertura di un contenitore in `head`, e lo riclassifica
  /// al suo posto: deve restare un contenitore modificabile.
  private setHead(node: ContainerNode, head: string, tail: string | null): void {
    const outer = node.parent === null ? NamespaceScope.EMPTY : scopeOf(node.parent);
    const fragment = parseFragment(tail === null ? head : `${head}</${node.facts.name}>`, outer);
    if (fragment === null) reject("invalid-elem", "il tag riscritto non si legge");
    const element = fragment.doc.element(fragment.id)!;
    let details: Details | null = null;
    if (node.parent !== null) {
      const found = classifyChild(fragment.doc, fragment.id, placeOf(node.parent), node.depth, this.resolve);
      if (found === null || !isContainer(found[1])) reject("invalid-elem", "il tag riscritto non rientra nel formato");
      details = describe(fragment.doc, fragment.id, found[0], found[1]).details;
    }
    const state: HeadState = { head, tail, facts: factsOf(fragment.doc, element), details, declarations: declarationsOf(element) };
    this.t.setHead(node, state);
  }

  /// Riscrive il tag d'apertura di un contenitore in forma canonica, con gli
  /// attributi che `change` ricava da quelli scritti. `selfClosing` dice se
  /// il tag resta autochiuso; `false` porta un `<g/>` in forma aperta.
  private rewriteHead(node: ContainerNode, change: (attrs: OutAttr[]) => OutAttr[], selfClosing: boolean): void {
    const { fragment, element } = this.reread(node);
    const attrs = change(attributesOf(fragment.doc, element));
    const out: OutElement = {
      name: element.name,
      group: isSvg(element, "g"),
      attrs: node === this.t.model.root ? rootOrder(attrs) : canonicalOrder(attrs),
      children: [],
      text: null,
    };
    const tail = selfClosing ? null : (node.tail ?? `</${element.name}>`);
    this.setHead(node, this.eolOf(writeOpenTag(out, selfClosing)), tail);
  }

  /// Sostituisce un'unità con `raw`, riletto nella stessa posizione.
  private replaceLeaf(node: ElementPart, raw: string): ElementPart {
    const parent = node.parent!;
    const built = this.build(raw, parent);
    if (built === null) reject("invalid-elem", "l'elemento riscritto non si legge");
    const index = parent.parts.indexOf(node);
    this.replace(parent, index, index + 1, [built]);
    return built;
  }

  /// Riscrive un'unità modificabile in forma canonica, al suo rientro, con
  /// ciò che `change` ricava dalla forma scritta.
  private rewriteLeaf(node: ElementPart, change: (out: OutElement, read: Reread) => OutElement): ElementPart {
    const read = this.reread(node);
    const out = change(elementToOut(read.fragment.doc, read.fragment.id), read);
    return this.replaceLeaf(node, this.eolOf(writeElement(out, indentOf(this.t.model, node))));
  }

  /// Il primo problema di un elemento appena scritto: estraneo, o un tratto
  /// che non si legge (S004). `null` se è modificabile tutto.
  private problem(node: ElementPart): string | null {
    if (node.details === null) return `${tagName(node)} non rientra nel formato`;
    if (node.kind === "leaf") {
      const s004 = node.problems.find(([code]) => code === "S004");
      return s004 === undefined ? null : s004[1];
    }
    for (const part of node.parts) {
      if (typeof part === "string") continue;
      if (part.kind === "other") return "contenuto che non è un elemento";
      const inner = this.problem(part);
      if (inner !== null) return inner;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Validazione.
  // -------------------------------------------------------------------------

  /// Il numero di un gruppo di pagina: un `g` figlio della radice con
  /// `fub:page` (`annotation-format.md`, §3); `null` per ogni altro elemento.
  private pageNumber(node: ElementPart): number | null {
    if (node.parent !== this.t.model.root || node.facts.uri !== SVG_NS || node.facts.local !== "g") return null;
    const { fragment, element } = this.reread(node);
    return positive(element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === "page")?.value);
  }

  /// Controlla `elem` e ne fa la forma da scrivere: id nuovi, valori nei
  /// limiti, inchiostro e pennello dei tratti, `d` dei tratti ricalcolato
  /// (§4). Il resto lo giudica la classificazione, sull'elemento scritto.
  private prepare(elem: unknown, scope: NamespaceScope, underRoot: boolean, underDefs: boolean): Elem {
    const ids = new Set<string>();
    /// `inDefs`: l'elemento è figlio di una `defs` della radice.
    const visit = (value: unknown, top: boolean, inResource: boolean, inDefs: boolean): Elem => {
      if (!isRecord(value) || typeof value.tag !== "string" || !isRecord(value.attrs)) reject("invalid-elem", "elemento non valido");
      const tag = value.tag;
      const attrs: Record<string, string> = {};
      const named = new Map<string, string>();
      for (const [key, raw] of Object.entries(value.attrs)) {
        if (typeof raw !== "string") reject("invalid-elem", `valore non stringa per ${key}`);
        const name = elemGuard(() => attributeName(key, scope));
        this.checkValue(tag, name.uri, name.local, raw);
        named.set(`${name.uri} ${name.local}`, key);
        attrs[key] = raw;
      }
      const get = (uri: string, local: string): string | undefined => {
        const key = named.get(`${uri} ${local}`);
        return key === undefined ? undefined : attrs[key];
      };
      const sheet = sheetOf(tag, get(FUB_NS, "role"), get(FUB_NS, "board"), top && underRoot);
      const layer = tag === "g" && get(FUB_NS, "layer") !== undefined;
      if (layer && !(top && underRoot)) reject("invalid-elem", "un livello sta solo sotto la radice");
      // Il gruppo di una pagina annotata ha l'id dal numero.
      const page = tag === "g" && top && underRoot ? positive(get(FUB_NS, "page")) : null;
      const id = get("", "id");
      checkNewId(tag, id, layer, inResource, inDefs, sheet, page);
      if (id !== undefined) {
        if (ids.has(id) || (!top && this.t.has(id))) reject("duplicate-id", `id già usato: ${id}`);
        ids.add(id);
      }
      // Il contorno di un tratto lo calcola chi possiede il documento (§4).
      const tool = get(FUB_NS, "tool");
      if (tag === "path" && (tool === "pen" || tool === "highlighter")) {
        const d = this.stroke(get(FUB_NS, "ink"), get(FUB_NS, "brush"));
        if (d !== null) attrs[named.get(" d") ?? "d"] = d;
      }
      const out: { -readonly [K in keyof Elem]: Elem[K] } = { tag, attrs };
      if (value.children !== undefined) {
        if (!Array.isArray(value.children)) reject("invalid-elem", `figli non validi su ${tag}`);
        const inside = inResource || isResource(tag, inDefs);
        const defs = tag === "defs" && top && underRoot;
        out.children = value.children.map((child) => visit(child, false, inside, defs));
      }
      if (value.text !== undefined) out.text = value.text as string | null;
      // I pezzi di una riga: la forma la controlla la scrittura, i valori la
      // classificazione.
      if (value.runs !== undefined) out.runs = value.runs as Run[];
      return out;
    };
    return visit(elem, true, false, underDefs);
  }

  /// `d` di un tratto da inchiostro e pennello; `null` se l'inchiostro ha
  /// canali sconosciuti e il contorno non si ricalcola (S010). Rifiuta un
  /// tratto che non si legge (S004).
  private stroke(ink: string | undefined, brush: string | undefined): string | null {
    try {
      if (ink === undefined) throw new InkError("missing");
      const decoded = decodeInk(ink);
      if (brush === undefined) throw new BrushError("missing");
      const parsed = parseBrush(brush);
      if (unknownChannels(decoded) !== "") return null;
      return pf1(inkToQuantized(decoded), parsed);
    } catch (error) {
      const detail = inkDetail(error);
      if (detail !== null) reject("invalid-elem", detail);
      if (error instanceof RangeError) reject("invalid-elem", `il contorno non si calcola: ${error.message}`);
      throw error;
    }
  }

  /// I limiti di §5 su un valore nuovo.
  private checkValue(tag: string, uri: string, local: string, value: string): void {
    if (!isXmlText(value)) reject("invalid-elem", `carattere non ammesso da XML nel valore di ${local}`);
    const image = tag === "image" && local === "href" && (uri === "" || uri === XLINK_NS);
    const limit = image ? MAX_IMAGE_HREF_BYTES : MAX_VALUE_BYTES;
    if (utf8Length(value) > limit) reject("limit", `${local} oltre ${limit} byte`);
  }

  /// Il limite di annidamento per un elemento che finisce sotto `parent`.
  private checkNesting(node: ElementPart, parent: ContainerNode): void {
    if (node.kind !== "container") return;
    if (deepest(node) - node.depth + parent.depth + 1 > MAX_NESTING) reject("limit", `annidamento oltre ${MAX_NESTING} livelli`);
  }

  // -------------------------------------------------------------------------
  // add, remove e le loro inverse.
  // -------------------------------------------------------------------------

  private add(op: Record<string, unknown>): Op {
    const parent = this.container(op.parent);
    if (this.lockedInside(parent)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    if (op.raw !== undefined) {
      if (op.elem !== undefined) reject("invalid-elem", "un add porta elem oppure raw, non tutti e due");
      return this.addRaw(parent, op.pos, op.raw);
    }
    const root = parent === this.t.model.root;
    const scope = scopeOf(parent);
    const elem = this.prepare(op.elem, scope, root, parent.details?.role === "defs");
    if (root && (elem.tag === "title" || elem.tag === "desc")) {
      reject("invalid-elem", "titolo e descrizione della radice cambiano con meta");
    }
    const out = elemGuard(() => elemToOut(elem, scope));
    const id = elem.attrs.id;
    if (id !== undefined && this.t.has(id)) {
      // Un `add` ripetuto dalla rete è un doppione, non un errore (§8).
      const existing = this.t.element(id);
      if (existing !== null && existing.details !== null && this.canonical(existing) === writeElement(out, "")) {
        this.duplicate = true;
        return { op: "batch", ops: [] };
      }
      reject("duplicate-id", `id già usato: ${id}`);
    }
    const to = this.destination(parent, op.pos, elem.tag === "defs");
    const node = this.build(this.eolOf(writeElement(out, this.indentFor(to))), parent);
    if (node === null) reject("invalid-elem", "l'elemento scritto non si legge");
    const problem = this.problem(node);
    if (problem !== null) reject("invalid-elem", problem);
    this.checkNesting(node, parent);
    this.checkResources([node], true);
    this.place(to, [node]);
    this.touch(node);
    this.sheet(node);
    return { op: "remove", target: this.targetOf(node) };
  }

  /// `add` con `raw`: uno o più elementi fratelli scritti così come sono,
  /// coi ritorni a capo del documento (§2). Quelli che il formato ammette
  /// passano dagli stessi controlli di `elem`, e il contorno dei loro tratti
  /// si ricalcola; gli estranei restano come sono.
  private addRaw(parent: ContainerNode, pos: unknown, raw: unknown): Op {
    if (typeof raw !== "string") reject("invalid-elem", "raw non è un testo");
    const scope = scopeOf(parent);
    let text = this.eolOf(raw.replace(/\r\n?/g, "\n"));
    let sequence = parseSequence(text, scope);
    if (sequence === null) reject("invalid-elem", "raw non è una sequenza di elementi ben formata");
    let parts = buildSequence(sequence, parent, this.resolve);
    const edits = this.checkSequence(sequence, parts, parent);
    if (edits.length > 0) {
      let rewritten = "";
      let at = 0;
      for (const [from, to, value] of edits) {
        rewritten += text.slice(at, from) + value;
        at = to;
      }
      text = rewritten + text.slice(at);
      sequence = parseSequence(text, scope);
      if (sequence === null) reject("invalid-elem", "il contorno riscritto non si legge");
      parts = buildSequence(sequence, parent, this.resolve);
    }
    const nodes = parts.filter((part): part is ElementPart => typeof part !== "string" && part.kind !== "other");
    for (const node of nodes) {
      const problem = this.rawProblem(node);
      if (problem !== null) reject("invalid-elem", problem);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const id of idsIn(node)) {
        if (seen.has(id)) reject("duplicate-id", `id ripetuto: ${id}`);
        seen.add(id);
        ids.push(id);
      }
    }
    // Un `add` ripetuto dalla rete è un doppione, non un errore (§8).
    const same = (node: ElementPart): boolean => {
      const existing = node.facts.id === null ? null : this.t.element(node.facts.id);
      return existing !== null && rawOf(existing) === rawOf(node);
    };
    if (nodes.every(same)) {
      this.duplicate = true;
      return { op: "batch", ops: [] };
    }
    const taken = ids.find((id) => this.t.has(id));
    if (taken !== undefined) reject("duplicate-id", `id già usato: ${taken}`);
    this.checkResources(nodes, true);
    const to = this.destination(parent, pos, nodes.every((node) => roleOf(node) === "defs"));
    for (const node of nodes) this.checkNesting(node, parent);
    this.place(to, parts);
    for (const node of nodes) {
      this.touch(node);
      this.sheet(node);
    }
    // Dall'ultimo al primo: togliere un elemento non sposta i percorsi di
    // quelli che lo precedono.
    const removes = nodes.map((node): Op => ({ op: "remove", target: this.targetOf(node) })).reverse();
    return removes.length === 1 ? removes[0]! : { op: "batch", ops: removes };
  }

  /// I controlli di `elem` sugli elementi modificabili di `sequence`, letta
  /// come `parts` sotto `parent`: valori nei limiti, id nella forma degli
  /// id nuovi, niente carta, livelli solo sotto la radice, titolo e
  /// descrizione della radice solo con `meta`. Restituisce, in ordine e
  /// negli indici di `raw`, le modifiche che portano il `d` di ogni tratto
  /// al contorno ricalcolato (§4).
  private checkSequence(sequence: Sequence, parts: readonly Part[], parent: ContainerNode): Array<[number, number, string]> {
    const { doc, offset } = sequence;
    const underRoot = parent === this.t.model.root;
    const underDefs = parent.details?.role === "defs";
    const edits: Array<[number, number, string]> = [];
    /// `inDefs`: l'elemento è figlio di una `defs` della radice.
    const check = (element: ElementNode, top: boolean, inResource: boolean, inDefs: boolean): void => {
      const tag = element.local;
      for (const attr of element.attrs) {
        if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
        this.checkValue(tag, doc.namespaces[attr.ns]!, attr.local, attr.value);
      }
      const sheet = sheetOf(tag, valueOf(element, NS_FUB, "role"), valueOf(element, NS_FUB, "board"), top && underRoot);
      const layer = tag === "g" && valueOf(element, NS_FUB, "layer") !== undefined;
      if (layer && !(top && underRoot)) reject("invalid-elem", "un livello sta solo sotto la radice");
      // Il gruppo di una pagina annotata ha l'id dal numero.
      const page = tag === "g" && top && underRoot ? positive(valueOf(element, NS_FUB, "page")) : null;
      checkNewId(tag, valueOf(element, NS_NONE, "id"), layer, inResource, inDefs, sheet, page);
      const tool = valueOf(element, NS_FUB, "tool");
      if (tag !== "path" || (tool !== "pen" && tool !== "highlighter")) return;
      const d = this.stroke(valueOf(element, NS_FUB, "ink"), valueOf(element, NS_FUB, "brush"));
      if (d === null) return;
      const written = element.attrs.find((attr) => attr.ns === NS_NONE && attr.local === "d");
      if (written === undefined) {
        const at = element.openEnd - (element.closeStart === null ? 2 : 1) - offset;
        edits.push([at, at, ` d="${escapeAttribute(d)}"`]);
      } else if (written.value !== d) {
        edits.push([written.raw[0] - offset, written.raw[1] - offset, escapeAttribute(d)]);
      }
    };
    /// Un elemento modificabile con quelli che contiene.
    const visit = (id: NodeId, node: ElementPart, top: boolean, inDefs: boolean): void => {
      if (node.details === null) return;
      const element = doc.element(id)!;
      check(element, top, false, inDefs);
      const inner = element.children.filter((child) => doc.element(child) !== null);
      if (node.kind === "container") {
        const children = elementChildren(node);
        inner.forEach((child, i) => visit(child, children[i]!, false, roleOf(node) === "defs"));
        return;
      }
      // Ciò che sta dentro una risorsa ha l'id facoltativo.
      const inResource = roleOf(node) === "resource";
      const stack = inner.reverse();
      while (stack.length > 0) {
        const child = doc.element(stack.pop()!)!;
        check(child, false, inResource, false);
        for (let i = child.children.length - 1; i >= 0; i--) if (doc.element(child.children[i]!) !== null) stack.push(child.children[i]!);
      }
    };
    const nodes = parts.filter((part): part is ElementPart => typeof part !== "string" && part.kind !== "other");
    const top = doc.children(sequence.id).filter((child) => doc.element(child) !== null);
    top.forEach((child, i) => {
      const element = doc.element(child)!;
      if (underRoot && element.ns === NS_SVG && (element.local === "title" || element.local === "desc")) {
        reject("invalid-elem", "titolo e descrizione della radice cambiano con meta");
      }
      visit(child, nodes[i]!, true, underDefs);
    });
    return edits;
  }

  /// Il primo problema di un elemento letto da `raw`: un tratto che non si
  /// legge (S004). Le parti estranee non ne hanno.
  private rawProblem(node: ElementPart): string | null {
    if (node.details === null) return null;
    if (node.kind === "leaf") {
      const s004 = node.problems.find(([code]) => code === "S004");
      return s004 === undefined ? null : s004[1];
    }
    for (const part of node.parts) {
      if (typeof part === "string" || part.kind === "other") continue;
      const inner = this.rawProblem(part);
      if (inner !== null) return inner;
    }
    return null;
  }

  /// La forma canonica di un elemento del documento, per confrontarla.
  private canonical(node: ElementPart): string {
    const fragment = parseFragment(rawOf(node), scopeOf(node.parent!));
    return fragment === null ? "" : writeElement(elementToOut(fragment.doc, fragment.id), "");
  }

  private remove(op: Record<string, unknown>): Op {
    const node = this.target(op.target);
    this.guard(node, false);
    // Chi usa una risorsa diventerebbe estraneo (§2).
    const used = this.usedOutside(node);
    if (used !== null) reject("in-use", `qualcosa fuori da ciò che si toglie usa ${used}`);
    this.touch(node);
    this.sheet(node);
    const raw = rawOf(node);
    const { anchor, gap } = this.detach(node);
    return { op: "add", slot: this.slotOf(anchor), gap, raw };
  }

  /// L'inversa di `remove`: rimette gli spazi e l'elemento così come erano.
  private restore(op: Record<string, unknown>): Op {
    if (typeof op.raw !== "string" || typeof op.gap !== "string" || !isBlank(op.gap)) reject("invalid-elem", "ripristino non valido");
    const anchor = this.anchorOf(op.slot);
    if (this.lockedInside(anchor.owner)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    const node = this.build(op.raw, anchor.owner);
    if (node === null) reject("invalid-elem", "l'elemento da rimettere non si legge");
    const taken = idsIn(node).find((id) => this.t.has(id));
    if (taken !== undefined) reject("duplicate-id", `id già usato: ${taken}`);
    this.checkResources([node], false);
    this.insertAt(this.pointOf(anchor), op.gap, [node]);
    this.touch(node);
    this.sheet(node);
    return { op: "remove", target: this.targetOf(node) };
  }

  // -------------------------------------------------------------------------
  // move e la sua inversa.
  // -------------------------------------------------------------------------

  private move(op: Record<string, unknown>): Op {
    const node = this.target(op.target);
    this.guard(node, false);
    const parent = this.container(op.parent);
    if (this.lockedInside(parent)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    if (this.within(parent, node)) reject("cycle", "un elemento non va dentro sé stesso");
    const root = parent === this.t.model.root;
    if (roleOf(node) === "layer" && !root) reject("invalid-elem", "un livello sta solo sotto la radice");
    if (isMeta(node) && (root || node.parent === this.t.model.root)) {
      reject("invalid-elem", "titolo e descrizione della radice cambiano con meta");
    }
    if (isRecord(op.pos) && op.pos.after !== undefined && op.pos.after === node.facts.id) {
      reject("missing-anchor", "l'elemento di riferimento è quello che si sposta");
    }
    this.checkNesting(node, parent);
    // Il punto d'arrivo si cerca dopo aver tolto l'elemento: `last` e
    // `first` non contano l'elemento stesso.
    return this.relocate(node, () => this.destination(parent, op.pos, roleOf(node) === "defs"));
  }

  /// L'inversa di `move`: riporta l'elemento al punto da cui è partito.
  private moveBack(op: Record<string, unknown>): Op {
    if (typeof op.gap !== "string" || !isBlank(op.gap)) reject("invalid-elem", "ritorno non valido");
    const gap = op.gap;
    const node = this.target(op.target);
    this.guard(node, false);
    // I riferimenti del punto valgono sulla scena con l'elemento al suo
    // posto: si risolvono prima di toglierlo.
    const anchor = this.anchorOf(op.slot);
    if (this.lockedInside(anchor.owner)) reject("locked", "il genitore è bloccato o sta in un contenitore bloccato");
    if (this.within(anchor.owner, node)) reject("cycle", "un elemento non va dentro sé stesso");
    if (anchor.after === node) reject("missing-anchor", "l'elemento di riferimento è quello che si sposta");
    return this.relocate(node, () => ({ kind: "point", point: this.pointOf(anchor), gap }));
  }

  /// Sposta `node`: lo toglie, ne porta il rientro su quello del punto
  /// d'arrivo, lo rilegge lì e lo inserisce. Ruolo e nomi non cambiano.
  private relocate(node: ElementPart, destination: () => Destination): Op {
    const model = this.t.model;
    const oldParent = node.parent!;
    const oldScope = scopeOf(oldParent);
    const oldIndent = indentOf(model, node);
    const raw = rawOf(node);
    this.touch(node);
    this.sheet(node);
    const { anchor, gap } = this.detach(node);
    const to = destination();
    const owner = to.kind === "point" ? to.point.owner : to.parent;
    const moved = reindent(raw, oldScope, placeOf(oldParent), oldParent.depth + 1, oldIndent, this.indentFor(to), this.resolve);
    const built = this.build(moved, owner);
    if (built === null) reject("invalid-elem", "lo spostamento lascerebbe un prefisso non dichiarato");
    const newScope = scopeOf(owner);
    if (!sameScope(oldScope, newScope)) {
      const before = parseFragment(raw, oldScope)!;
      const after = parseFragment(moved, newScope)!;
      if (expandedNames(before.doc, before.id) !== expandedNames(after.doc, after.id)) {
        reject("invalid-elem", "lo spostamento cambierebbe i namespace dell'elemento");
      }
    }
    if (roleOf(built) !== roleOf(node)) reject("invalid-elem", "lo spostamento cambierebbe il ruolo dell'elemento");
    this.place(to, [built]);
    return { op: "move", target: this.targetOf(built), slot: this.slotOf(anchor), gap };
  }

  // -------------------------------------------------------------------------
  // set, text e ident.
  // -------------------------------------------------------------------------

  private set(op: Record<string, unknown>): Op {
    if (typeof op.id !== "string" || !isRecord(op.attrs)) reject("invalid-elem", "set non valido");
    if (op.id === ROOT) return this.setRoot(op.attrs);
    const node = this.target(op.id);
    this.guard(node, true, true);
    this.sheet(node);
    const { fragment, element, scope } = this.reread(node);
    const doc = fragment.doc;
    const changes = new Map<string, Change>();
    for (const [key, value] of Object.entries(op.attrs)) {
      if (value !== null && typeof value !== "string") reject("invalid-elem", `valore non valido per ${key}`);
      const name = elemGuard(() => attributeName(key, scope));
      if (name.uri === "" && name.local === "id") reject("invalid-elem", "l'id cambia solo con ident");
      if (value !== null) this.checkValue(element.local, name.uri, name.local, value);
      const expanded = `${name.uri} ${name.local}`;
      if (changes.has(expanded)) reject("invalid-elem", `attributo ripetuto: ${key}`);
      changes.set(expanded, { key, ...name, value });
    }
    const written = (uri: string, local: string): Attr | undefined =>
      element.attrs.find((a) => doc.namespaces[a.ns] === uri && a.local === local);
    const current = (uri: string, local: string): string | undefined => {
      const change = changes.get(`${uri} ${local}`);
      return change !== undefined ? (change.value ?? undefined) : written(uri, local)?.value;
    };
    // La carta della pagina diventa quella di una tavola con `fub:board` e
    // nient'altro; quella di una tavola cambia in geometria e tavola
    // (formato della scena, tavole).
    const paper = roleOf(node) === "paper";
    if (paper) {
      const allowed = isPagePaper(node) ? [`${FUB_NS} board`] : [" x", " y", " width", " height", `${FUB_NS} board`];
      const outside = [...changes.keys()].find((key) => !allowed.includes(key));
      if (outside !== undefined) reject("locked", `la carta cambia solo con page, o in geometria e tavola: ${changes.get(outside)!.key}`);
      if (isPagePaper(node) && changes.get(`${FUB_NS} board`)?.value === null) reject("locked", "la carta della pagina cambia solo con page");
    } else if (current(FUB_NS, "role") === "paper") {
      reject("invalid-elem", "una carta nasce con add");
    }
    if (isSvg(element, "g") && current(FUB_NS, "layer") !== undefined && node.parent !== this.t.model.root) {
      reject("invalid-elem", "un livello sta solo sotto la radice");
    }
    // Un tratto si ridisegna quando cambiano inchiostro, pennello o
    // strumento, e il suo `d` non si scrive a mano (§4).
    const tool = current(FUB_NS, "tool");
    const touchesStroke = [`${FUB_NS} ink`, `${FUB_NS} brush`, `${FUB_NS} tool`, " d"].some((key) => changes.has(key));
    if (isSvg(element, "path") && (tool === "pen" || tool === "highlighter") && touchesStroke) {
      const d = this.stroke(current(FUB_NS, "ink"), current(FUB_NS, "brush"));
      if (d === null) reject("invalid-elem", "un tratto con canali sconosciuti non si ridisegna (S010)");
      changes.set(" d", { key: changes.get(" d")?.key ?? "d", uri: "", local: "d", name: "d", value: d });
    }

    // L'inversa: i valori di prima delle chiavi che cambiano.
    const previous: Record<string, string | null> = {};
    for (const change of changes.values()) previous[change.key] = written(change.uri, change.local)?.value ?? null;
    const edit = changed(changes);

    if (node.kind === "container") {
      // Si riscrive solo il tag, perché i figli non cambiano; un `<g/>` si
      // riscrive per intero, in forma aperta (§6).
      if (node.tail === null && isSvg(element, "g")) {
        const indent = indentOf(this.t.model, node);
        this.rewriteHead(node, edit, false);
        this.t.splice(node, 0, node.parts.length, [this.eolOf(`\n${indent}`)]);
      } else {
        this.rewriteHead(node, edit, node.tail === null);
      }
    } else {
      const built = this.rewriteLeaf(node, (out, read) => ({
        ...out,
        attrs: canonicalOrder(edit(attributesOf(read.fragment.doc, read.element))),
      }));
      const problem = this.problem(built);
      if (problem !== null) reject("invalid-elem", problem);
      if ((roleOf(built) === "paper") !== paper) reject("invalid-elem", "una carta nasce con add");
    }
    // Un gruppo cambia anche come si vedono i suoi figli.
    this.touch(node);
    return { op: "set", id: op.id, attrs: previous };
  }

  /// `set` sulla radice: soltanto l'unità e le guide del documento, coi
  /// valori nella loro grammatica (formato della scena, unità e guide). Il
  /// resto della radice cambia con `page` e `adopt`. Nessun elemento cambia
  /// aspetto, e nessun id è toccato.
  private setRoot(attrs: Record<string, unknown>): Op {
    const root = this.t.model.root;
    const { fragment, element, scope } = this.reread(root);
    const changes = new Map<string, Change>();
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && typeof value !== "string") reject("invalid-elem", `valore non valido per ${key}`);
      const name = elemGuard(() => attributeName(key, scope));
      if (name.uri !== FUB_NS || (name.local !== "units" && name.local !== "guides")) {
        reject("invalid-elem", `sulla radice set cambia soltanto fub:units e fub:guides: ${key}`);
      }
      if (value !== null) {
        this.checkValue("svg", name.uri, name.local, value);
        if ((name.local === "units" ? parseUnits(value) : parseGuides(value)) === null) {
          reject("invalid-elem", `${key} fuori grammatica: ${JSON.stringify(value)}`);
        }
      }
      const expanded = `${name.uri} ${name.local}`;
      if (changes.has(expanded)) reject("invalid-elem", `attributo ripetuto: ${key}`);
      changes.set(expanded, { key, ...name, value });
    }
    const previous: Record<string, string | null> = {};
    for (const change of changes.values()) {
      previous[change.key] = element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === change.local)?.value ?? null;
    }
    this.rewriteHead(root, changed(changes), root.tail === null);
    return { op: "set", id: ROOT, attrs: previous };
  }

  private text_(op: Record<string, unknown>): Op {
    if (typeof op.id !== "string" || !Array.isArray(op.lines)) reject("invalid-elem", "text non valido");
    // Una riga è testo, o le sue parti: quelle senza niente da dire si
    // tolgono, e una riga che resta senza pezzi è testo.
    const lines: TextLine[] = [];
    for (const line of op.lines as unknown[]) {
      if (typeof line === "string") {
        if (!isXmlText(line) || /[\r\n]/.test(line)) reject("invalid-elem", "riga non valida");
        lines.push(line);
        continue;
      }
      const runs = elemGuard(() => canonicalRuns(line));
      lines.push(runs.every((run) => typeof run === "string") ? runs.join("") : runs);
    }
    // Come ogni riga continua il paragrafo, se l'operazione lo dice
    // (formato della scena, testo).
    let joins: Array<string | null> | null = null;
    if (op.joins !== undefined) {
      if (!Array.isArray(op.joins) || op.joins.length !== lines.length) reject("invalid-elem", "joins non ha una voce per riga");
      joins = (op.joins as unknown[]).map((join) => {
        if (join !== null && typeof join !== "string") reject("invalid-elem", "una voce di joins non è un testo");
        if (join !== null) this.checkValue("tspan", FUB_NS, "join", join);
        return join;
      });
    }
    const node = this.target(op.id);
    this.guard(node, true);
    if (roleOf(node) !== "text") reject("invalid-elem", `${op.id} non è un testo`);
    const before = this.reread(node);
    if (node.details!.textPath !== undefined) return this.textAlong(node, lines, joins);
    const previous: TextLine[] = [];
    const previousJoins: Array<string | null> = [];
    for (const child of before.element.children) {
      const tspan = before.fragment.doc.element(child);
      if (tspan === null || !isSvg(tspan, "tspan")) continue;
      previous.push(readRuns(before.fragment.doc, tspan) ?? node.details!.lines![previous.length]!);
      previousJoins.push(valueOf(tspan, NS_FUB, "join") ?? null);
    }
    const built = this.rewriteLeaf(node, (out, { fragment, element, scope }) => {
      const doc = fragment.doc;
      const others: OutElement[] = [];
      const tspans: ElementNode[] = [];
      for (const child of element.children) {
        const read = doc.element(child);
        if (read === null) continue;
        if (isSvg(read, "tspan")) tspans.push(read);
        else others.push(elementToOut(doc, child));
      }
      // Una riga nuova copia gli attributi della precedente, senza id e senza
      // `fub:join`, perché comincia un paragrafo, e va giù di un'interlinea:
      // quella delle righe che ci sono già, oppure 1,25 volte il corpo con cui
      // si vede l'ultima riga.
      let spacing: string | null = null;
      for (let k = tspans.length - 1; k >= 1 && spacing === null; k--) spacing = valueOf(tspans[k]!, NS_NONE, "dy") ?? null;
      if (spacing === null) {
        const last = tspans.length === 0 ? [] : [tspans[tspans.length - 1]!];
        spacing = formatNumber(this.fontSize([...last, element], node.parent) * 1.25, 2);
      }
      const name = scope.svgName("tspan")!;
      const isJoin = (a: OutAttr): boolean => a.uri === FUB_NS && a.local === "join";
      const written: OutElement[] = [];
      for (let i = 0; i < lines.length; i++) {
        let attrs: OutAttr[];
        if (i < tspans.length) {
          attrs = attributesOf(doc, tspans[i]!);
        } else {
          const dy: OutAttr = { name: "dy", uri: "", local: "dy", text: escapeAttribute(i === 0 ? "0" : spacing) };
          const base = i > 0
            ? written[i - 1]!.attrs.filter((a) => !(a.uri === "" && (a.local === "id" || a.local === "dy")) && !isJoin(a))
            : attributesOf(doc, element).filter((a) => a.uri === "" && a.local === "x");
          attrs = [...base, dy];
        }
        const join = joins?.[i];
        if (join !== undefined) {
          attrs = attrs.filter((a) => !isJoin(a));
          if (join !== null) attrs.push({ ...elemGuard(() => attributeName("fub:join", scope)), text: escapeAttribute(join) });
        }
        attrs = canonicalOrder(attrs);
        const line = lines[i]!;
        const text = typeof line === "string" ? escapeText(line) : elemGuard(() => lineContent(line, scope));
        written.push({ name, group: false, attrs, children: [], text });
      }
      return { ...out, children: [...others, ...written] };
    });
    // Un pezzo con un attributo che il formato non gli dà renderebbe
    // estraneo il testo.
    const problem = this.problem(built);
    if (problem !== null) reject("invalid-elem", problem);
    this.touched.add(op.id);
    // L'inversa rimette i `fub:join` di prima anche se l'operazione non ne
    // aveva: una riga che se ne va riprende il suo quando torna.
    const joined = joins !== null || previousJoins.some((join) => join !== null);
    return joined ? { op: "text", id: op.id, lines: previous, joins: previousJoins } : { op: "text", id: op.id, lines: previous };
  }

  /// `text` di un testo su tracciato: la sua riga sola è il contenuto del
  /// `textPath`, che tiene i suoi attributi (formato della scena, testo).
  private textAlong(node: ElementPart, lines: readonly TextLine[], joins: readonly (string | null)[] | null): Op {
    if (lines.length !== 1) reject("invalid-elem", "un testo su tracciato ha una riga sola");
    if (joins !== null) reject("invalid-elem", "un testo su tracciato non va a capo");
    const id = node.facts.id!;
    const line = lines[0]!;
    let previous: TextLine = node.details!.lines![0]!;
    const built = this.rewriteLeaf(node, (out, { fragment, element, scope }) => {
      const doc = fragment.doc;
      const children: OutElement[] = [];
      for (const child of element.children) {
        const read = doc.element(child);
        if (read === null) continue;
        if (!isSvg(read, "textPath")) {
          children.push(elementToOut(doc, child));
          continue;
        }
        previous = readRuns(doc, read) ?? previous;
        const text = typeof line === "string" ? escapeText(line) : elemGuard(() => lineContent(line, scope));
        children.push({ name: read.name, group: false, attrs: canonicalOrder(attributesOf(doc, read)), children: [], text });
      }
      return { ...out, children };
    });
    const problem = this.problem(built);
    if (problem !== null) reject("invalid-elem", problem);
    this.touched.add(id);
    return { op: "text", id, lines: [previous] };
  }

  /// Il corpo con cui si vede il primo di `elements`, dal più interno al
  /// più esterno, dentro `container`: il primo `font-size` valido che si
  /// incontra salendo, 16 se nessuno lo scrive.
  private fontSize(elements: readonly ElementNode[], container: ContainerNode | null): number {
    const sizeOf = (element: ElementNode): number | null => {
      const value = valueOf(element, NS_NONE, "font-size");
      return value === undefined ? null : svgLength(value);
    };
    for (const element of elements) {
      const size = sizeOf(element);
      if (size !== null && size >= 0) return size;
    }
    for (let c = container; c !== null; c = c.parent) {
      const size = sizeOf(this.reread(c).element);
      if (size !== null && size >= 0) return size;
    }
    return 16;
  }

  private ident(op: Record<string, unknown>): Op {
    if (!isPath(op.path) || op.path.length === 0 || typeof op.tag !== "string" || (op.id !== null && typeof op.id !== "string")) {
      reject("invalid-elem", "ident non valido");
    }
    const { path, tag } = op;
    const id = op.id as string | null;
    const node = this.walk(path);
    if (node === null || tagName(node) !== tag) reject("missing-target", `nessun ${tag} al percorso ${JSON.stringify(path)}`);
    if ((id === null) === (node.facts.id === null)) {
      reject("missing-target", id === null ? "l'elemento non ha un id da togliere" : "l'elemento ha già un id");
    }
    this.guard(node, true);
    this.sheet(node);
    const old = node.facts.id;
    // Senza id una risorsa è estranea, e chi la usa con lei (§2).
    if (id === null && roleOf(node) === "resource" && this.t.referrers(old!) > 0) reject("in-use", `qualcosa usa ${old}`);
    if (id !== null) {
      // Ogni id che il formato ammette, non solo quelli che FubDraw genera:
      // un id si cambia togliendolo e dandone un altro, e l'undo rimette
      // quello di prima com'era scritto. Il gruppo di una pagina annotata
      // ha l'id dal suo numero.
      if (id === "") reject("invalid-elem", "id vuoto");
      this.checkValue(tag, "", "id", id);
      const page = this.pageNumber(node);
      if (page !== null && id !== pageId(page)) reject("invalid-elem", `id non valido per la pagina: ${JSON.stringify(id)}`);
      if (this.t.has(id)) reject("duplicate-id", `id già usato: ${id}`);
    }
    // Si tocca solo l'attributo, nel testo del tag: gli altri restano come
    // sono scritti, anche su più righe (§6).
    const { fragment, element } = this.reread(node);
    const raw = node.kind === "leaf" ? node.raw : node.head;
    let patched: string;
    if (id === null) {
      const [from, to] = attributeSpan(fragment.doc, element, element.attrs.find((a) => a.ns === NS_NONE && a.local === "id")!);
      patched = raw.slice(0, from) + raw.slice(to);
    } else {
      const at = 1 + element.name.length;
      patched = `${raw.slice(0, at)} id="${escapeAttribute(id)}"${raw.slice(at)}`;
    }
    if (node.kind === "container") this.setHead(node, patched, node.tail);
    else this.sheet(this.replaceLeaf(node, patched));
    this.touched.add(id ?? old!);
    return { op: "ident", path: [...path], tag, id: id === null ? old : null };
  }

  // -------------------------------------------------------------------------
  // page, meta e adopt: la radice.
  // -------------------------------------------------------------------------

  private page(op: Record<string, unknown>): Op {
    const root = this.t.model.root;
    // Le carte delle tavole hanno la geometria delle loro tavole (formato
    // della scena, tavole).
    const papers = elementChildren(root).filter(isPagePaper);
    const value = (element: ElementNode, local: string): string | null => valueOf(element, NS_NONE, local) ?? null;
    const rootElement = this.reread(root).element;
    const firstPaper = papers[0] === undefined ? null : this.reread(papers[0]).element;
    const previous: PagePrevious = {
      root: { viewBox: value(rootElement, "viewBox"), width: value(rootElement, "width"), height: value(rootElement, "height") },
      paper: firstPaper === null
        ? null
        : { x: value(firstPaper, "x"), y: value(firstPaper, "y"), width: value(firstPaper, "width"), height: value(firstPaper, "height") },
    };

    let rootValues: Record<string, string | null>;
    let paperValues: Record<string, string | null> | null;
    if (op.previous !== undefined) {
      // L'inversa rimette i valori di prima così come erano.
      const given = op.previous;
      if (!isRecord(given) || !isRecord(given.root) || (given.paper !== null && !isRecord(given.paper))) {
        reject("invalid-elem", "page non valido");
      }
      const strings = (record: Record<string, unknown>, keys: readonly string[]): Record<string, string | null> => {
        const out: Record<string, string | null> = {};
        for (const key of keys) {
          const v = record[key];
          if (v !== null && typeof v !== "string") reject("invalid-elem", `valore non valido per ${key}`);
          out[key] = v;
        }
        return out;
      };
      rootValues = strings(given.root, ["viewBox", "width", "height"]);
      paperValues = given.paper === null ? null : strings(given.paper as Record<string, unknown>, ["x", "y", "width", "height"]);
    } else {
      if (typeof op.viewBox !== "string") reject("invalid-elem", "viewBox assente");
      const tokens = op.viewBox.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").split(/[ \t\r\n,]+/);
      const numbers = tokens.map((token) => svgNumber(token));
      if (tokens.length !== 4 || numbers.some((n) => n === null) || numbers[2]! <= 0 || numbers[3]! <= 0) {
        reject("invalid-elem", `viewBox non valido: ${JSON.stringify(op.viewBox)}`);
      }
      const [x, y, w, h] = tokens as [string, string, string, string];
      rootValues = { viewBox: `${x} ${y} ${w} ${h}`, width: w, height: h };
      paperValues = { x, y, width: w, height: h };
    }
    for (const [local, v] of Object.entries(rootValues)) if (v !== null) this.checkValue("svg", "", local, v);
    if (paperValues !== null) for (const [local, v] of Object.entries(paperValues)) if (v !== null) this.checkValue("rect", "", local, v);
    const assign = (values: Record<string, string | null>) => (attrs: OutAttr[]): OutAttr[] => {
      const out: OutAttr[] = [];
      const done = new Set<string>();
      for (const attr of attrs) {
        if (attr.uri !== "" || !(attr.local in values)) {
          out.push(attr);
          continue;
        }
        done.add(attr.local);
        const v = values[attr.local];
        if (v !== null && v !== undefined) out.push({ ...attr, text: escapeAttribute(v) });
      }
      for (const [local, v] of Object.entries(values)) {
        if (!done.has(local) && v !== null) out.push({ name: local, uri: "", local, text: escapeAttribute(v) });
      }
      return out;
    };
    this.rewriteHead(root, assign(rootValues), root.tail === null);
    if (paperValues !== null) {
      const values = paperValues;
      for (const paper of papers) {
        const built = this.rewriteLeaf(paper, (out, read) => ({
          ...out,
          attrs: canonicalOrder(assign(values)(attributesOf(read.fragment.doc, read.element))),
        }));
        if (roleOf(built) !== "paper") reject("invalid-elem", "la carta riscritta non rientra nel formato");
        this.touch(built);
      }
    }
    return { op: "page", viewBox: previous.root.viewBox ?? "", previous };
  }

  private meta(op: Record<string, unknown>): Op {
    const root = this.t.model.root;
    const fields = (["title", "desc"] as const).filter((field) => op[field] !== undefined);
    for (const field of fields) {
      const v = op[field];
      if (v !== null && (typeof v !== "string" || !isXmlText(v))) reject("invalid-elem", `${field} non valido`);
    }
    const find = (local: string): ElementPart | null =>
      elementChildren(root).find((child) => child.facts.uri === SVG_NS && child.facts.local === local) ?? null;
    const inverse: { -readonly [K in keyof MetaOp]: MetaOp[K] } = { op: "meta" };
    for (const field of fields) {
      const existing = find(field);
      if (existing !== null && existing.details === null) reject("foreign", `il ${field} della radice è estraneo`);
      inverse[field] = existing === null ? null : (existing.details!.text ?? "");
    }
    for (const field of fields) {
      const v = op[field] as string | null;
      const existing = find(field);
      if (v === null) {
        if (existing !== null) this.detach(existing);
        continue;
      }
      if (existing !== null) {
        this.rewriteLeaf(existing, (out) => ({ ...out, text: escapeText(v) }));
        continue;
      }
      // Il titolo va per primo, la descrizione subito dopo il titolo.
      const out = elemGuard(() => elemToOut({ tag: field, attrs: {}, text: v }, scopeOf(root)));
      const title = field === "desc" ? find("title") : null;
      const model = this.t.model;
      let to: Destination;
      if (this.collapsed(root)) {
        to = { kind: "empty", parent: root, indent: `${indentOf(model, root)}  ` };
      } else if (title !== null) {
        const point = { owner: root, index: root.parts.indexOf(title) + 1, split: 0 };
        to = { kind: "point", point, gap: this.eolOf(`\n${indentOf(model, title)}`) };
      } else {
        to = { kind: "point", point: { owner: root, index: 0, split: 0 }, gap: this.eolOf(`\n${indentOf(model, root)}  `) };
      }
      const node = this.build(this.eolOf(writeElement(out, this.indentFor(to))), root);
      if (node === null || node.details === null) reject("invalid-elem", `${field} non rientra nel formato`);
      this.place(to, [node]);
    }
    return inverse;
  }

  /// Impronta e numero di pagine sulla radice di un `.fubann`. Si tocca solo
  /// il valore di ciascuno, o lo si aggiunge in coda al tag: il resto della
  /// radice resta com'è scritto, come in `adopt`. Uno dei due può mancare, e
  /// allora resta com'è; mancano tutti e due, è un rifiuto. L'inversa rimette
  /// i valori di prima così come erano, anche fuori grammatica.
  private anchor(op: Record<string, unknown>): Op {
    if (this.t.status !== "fubdraw") reject("invalid-elem", "il documento non è di FubDraw");
    const root = this.t.model.root;
    const { fragment, element, scope } = this.reread(root);
    const prefix = scope.attributePrefix(FUB_NS);
    if (prefix === null) reject("invalid-elem", "la radice non dichiara il namespace di FubDraw");
    const written = (local: string): Attr | undefined =>
      element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === local);
    const previous: AnchorPrevious = {
      digest: written("digest")?.value ?? null,
      pages: written("pages")?.value ?? null,
    };
    // `undefined`: il valore resta com'è.
    let values: { digest?: string | null; pages?: string | null };
    if (op.previous !== undefined) {
      const given = op.previous;
      if (!isRecord(given) || (given.digest !== null && typeof given.digest !== "string") || (given.pages !== null && typeof given.pages !== "string")) {
        reject("invalid-elem", "anchor non valido");
      }
      values = { digest: given.digest as string | null, pages: given.pages as string | null };
    } else {
      const { digest, pages } = op;
      if (digest === undefined && pages === undefined) reject("invalid-elem", "anchor senza impronta né pagine");
      if (digest !== undefined && (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest))) {
        reject("invalid-elem", "l'impronta non è sha256: e 64 cifre minuscole");
      }
      if (pages !== undefined && (typeof pages !== "number" || !Number.isSafeInteger(pages) || pages < 1 || pages > 0xffff_ffff)) {
        reject("invalid-elem", "il numero di pagine non è un intero positivo");
      }
      values = {};
      if (digest !== undefined) values.digest = digest as string;
      if (pages !== undefined) values.pages = String(pages);
    }
    for (const [local, v] of Object.entries(values)) if (typeof v === "string") this.checkValue("svg", FUB_NS, local, v);
    // Le modifiche dalla fine del tag, così gli indici di prima valgono; gli
    // attributi nuovi vanno dopo l'ultimo, l'impronta prima delle pagine.
    const edits: Array<{ from: number; to: number; text: string }> = [];
    const last = element.attrs[element.attrs.length - 1];
    const end = last === undefined ? 1 + element.name.length : last.raw[1] + 1 - element.start;
    let added = "";
    for (const local of ["digest", "pages"] as const) {
      const v = values[local];
      if (v === undefined) continue;
      const attr = written(local);
      if (attr !== undefined) {
        if (v === null) {
          const [from, to] = attributeSpan(fragment.doc, element, attr);
          edits.push({ from, to, text: "" });
        } else {
          // Fra apici singoli anche l'apice si scrive come riferimento.
          const quote = fragment.doc.source.text[attr.raw[0] - 1];
          const text = quote === "'" ? escapeAttribute(v).replace(/'/g, "&#39;") : escapeAttribute(v);
          edits.push({ from: attr.raw[0] - element.start, to: attr.raw[1] - element.start, text });
        }
      } else if (v !== null) {
        added += ` ${prefix}:${local}="${escapeAttribute(v)}"`;
      }
    }
    if (added !== "") edits.push({ from: end, to: end, text: added });
    edits.sort((a, b) => b.from - a.from || b.to - a.to);
    let head = root.head;
    for (const { from, to, text } of edits) head = head.slice(0, from) + text + head.slice(to);
    if (head !== root.head) this.setHead(root, head, root.tail);
    return { op: "anchor", previous };
  }

  private adopt(op: Record<string, unknown>): Op {
    if (op.undo !== undefined && typeof op.undo !== "boolean") reject("invalid-elem", "adopt non valido");
    const root = this.t.model.root;
    const { fragment, element, scope } = this.reread(root);
    const head = root.head;
    if (op.undo !== true) {
      if (this.t.status !== "foreign") reject("invalid-elem", "il documento è già di FubDraw");
      // Il prefisso di FubDraw: quello già legato al suo namespace, oppure
      // `fub`, oppure il primo `fubN` libero.
      let prefix = scope.attributePrefix(FUB_NS);
      let added = "";
      if (prefix === null) {
        prefix = "fub";
        for (let n = 1; scope.uri(prefix) !== null; n++) prefix = `fub${n}`;
        added = ` xmlns:${prefix}="${escapeAttribute(FUB_NS)}"`;
      }
      // Dopo l'ultima dichiarazione, o subito dopo il nome: il resto del tag
      // resta com'è scritto (§6).
      const declarations = element.attrs.filter((a) => fragment.doc.namespaces[a.ns] === XMLNS_URI);
      const last = declarations[declarations.length - 1];
      const at = last === undefined ? 1 + element.name.length : last.raw[1] + 1 - element.start;
      this.setHead(root, `${head.slice(0, at)}${added} ${prefix}:version="1"${head.slice(at)}`, root.tail);
      this.t.setStatus("fubdraw");
      return { op: "adopt", undo: true };
    }
    if (this.t.status !== "fubdraw") reject("invalid-elem", "il documento non è di FubDraw");
    const version = element.attrs.find((a) => fragment.doc.namespaces[a.ns] === FUB_NS && a.local === "version");
    if (version === undefined) reject("invalid-elem", "la radice non ha fub:version");
    const removed: Array<[number, number]> = [attributeSpan(fragment.doc, element, version)];
    // La dichiarazione va via solo se nient'altro usa il prefisso.
    const prefix = version.name.slice(0, version.name.indexOf(":"));
    const declaration = element.attrs.find((a) => fragment.doc.namespaces[a.ns] === XMLNS_URI && a.name === `xmlns:${prefix}`);
    if (declaration !== undefined) {
      const uses = new RegExp(`[\\s<]${prefix.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}:`);
      const own = element.attrs.some((a) => a !== version && a.name.startsWith(`${prefix}:`));
      const inside = root.parts.some((part) => typeof part !== "string" && part.kind !== "other" && uses.test(rawOf(part)));
      if (!own && !inside) removed.push(attributeSpan(fragment.doc, element, declaration));
    }
    removed.sort((a, b) => b[0] - a[0]);
    let patched = head;
    for (const [from, to] of removed) patched = patched.slice(0, from) + patched.slice(to);
    this.setHead(root, patched, root.tail);
    this.t.setStatus("foreign");
    return { op: "adopt" };
  }
}
