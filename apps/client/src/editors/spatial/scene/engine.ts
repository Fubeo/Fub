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
import { isContainer } from "./analysis";
import { classifyChild, describe, type Details, type Item } from "./classify";
import { sceneOperation } from "./diff";
import { isNewId } from "./ids";
import {
  buildDocument,
  buildFragment,
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
  pathOf,
  rawOf,
  scopeOf,
  tagName,
  tidy,
  type ContainerNode,
  type DocumentModel,
  type ElementPart,
  type Fragment,
  type Part,
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
  type PagePrevious,
  type PathTarget,
  type Reason,
  type Slot,
  type Target,
} from "./ops";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, openSource, readScene, type ReadOnly, type Status } from "./read";
import { parseGuides, parseUnits } from "./rulers";
import {
  attributeName,
  attributesOf,
  canonicalOrder,
  ElemError,
  elemToOut,
  elementToOut,
  escapeAttribute,
  escapeText,
  isXmlText,
  NamespaceScope,
  rootOrder,
  writeElement,
  writeOpenTag,
  type Elem,
  type OutAttr,
  type OutElement,
} from "./serialize";
import { lineBreakOf, newline, normalizeEol, SourceText, utf8Length } from "./text";
import { Tree, type Entry, type HeadState } from "./tree";
import { length as svgLength, number as svgNumber } from "./values";
import {
  FUB_NS,
  isSpace,
  isSvg,
  NS_NONE,
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

const OP_NAMES: ReadonlySet<unknown> = new Set(["add", "remove", "set", "text", "move", "ident", "page", "meta", "adopt", "batch"]);

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

/// Vero se un elemento è `title` o `desc` di SVG.
function isMeta(node: ElementPart): boolean {
  return node.facts.uri === SVG_NS && (node.facts.local === "title" || node.facts.local === "desc");
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
function reindent(raw: string, scope: NamespaceScope, underRoot: boolean, depth: number, from: string, to: string): string {
  if (from === to || raw.includes("xml:space")) return raw;
  const fragment = parseFragment(raw, scope);
  if (fragment === null) return raw;
  const { doc } = fragment;
  const base = doc.element(fragment.id)!.start;
  const ranges: Array<readonly [number, number]> = [];
  const stack: Array<readonly [NodeId, boolean, number]> = [[fragment.id, underRoot, depth]];
  while (stack.length > 0) {
    const [id, under, level] = stack.pop()!;
    const found = classifyChild(doc, id, under, level);
    if (found === null) continue;
    const element = doc.element(id)!;
    const container = isContainer(found[1]);
    // Gli spazi di un'unità contano solo fra figli elemento: dentro un
    // `title` sono il suo testo.
    if (!container && !element.children.some((child) => doc.element(child) !== null)) continue;
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" && node.blank) ranges.push([node.start - base, node.end - base]);
      else if (container && node.kind === "element") stack.push([child, false, level + 1]);
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
    let inverse: Op;
    try {
      inverse = this.run(op);
    } catch (error) {
      tree.rollback(mark);
      if (!(error instanceof Rejection)) throw error;
      const first = error.indices[0];
      return first === undefined
        ? { outcome: "rejected", reason: error.reason, detail: error.detail }
        : { outcome: "rejected", reason: error.reason, detail: error.detail, index: first };
    }
    return this.commit(tree.take(mark), op, inverse, [...this.touched], this.duplicate, null);
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
    return this.apply(undo.inverse);
  }

  /// Chiude un'applicazione: il testo nuovo, la `TextOperation` e l'undo.
  /// `target` è la scena a cui riporta un undo esatto; `null` per una scena
  /// nuova, che deve stare nei limiti.
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
      const raw = materialize(tree.model);
      if (target === null && (utf8Length(raw) > MAX_EDIT_BYTES || tree.elements > MAX_ELEMENTS)) {
        const mark = tree.mark();
        tree.undo(entries);
        tree.take(mark);
        return {
          outcome: "rejected",
          reason: "limit",
          detail: `il documento supererebbe ${MAX_EDIT_BYTES} byte o ${MAX_ELEMENTS} elementi`,
        };
      }
      const lf = normalizeEol(raw);
      operation = sceneOperation(this.lf, lf);
      this.raw = raw;
      this.lf = lf;
      this.items = null;
      this.state = target ?? ++this.counter;
    }
    const undo = new Undo(inverse, forward, touched);
    EXACT.set(undo, { engine: this, entries, before, after: this.state });
    return { outcome: "applied", inverse, touched, operation, text: this.raw, duplicate, undo };
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
    if (count(ops) > MAX_BATCH) reject("limit", `batch oltre ${MAX_BATCH} operazioni`);
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

  /// Vero se un livello bloccato contiene `node`, `node` escluso.
  private lockedAbove(node: ElementPart): boolean {
    for (let c = node.parent; c !== null; c = c.parent) {
      if (c.details?.layer?.locked === true) return true;
    }
    return false;
  }

  /// Vero se in `container` non si scrive: è un livello bloccato o sta
  /// dentro uno.
  private lockedInside(container: ContainerNode): boolean {
    return container.details?.layer?.locked === true || this.lockedAbove(container);
  }

  /// I controlli comuni su un elemento da cambiare: niente carta, niente
  /// livelli bloccati sopra e, se `editable`, niente estranei. Un livello
  /// bloccato si cambia: è così che si sblocca.
  private guard(node: ElementPart, editable: boolean): void {
    if (roleOf(node) === "paper") reject("locked", "la carta cambia solo con page");
    if (this.lockedAbove(node)) reject("locked", "l'elemento sta in un livello bloccato");
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

  /// Mette `node` nel punto, preceduto da `gap`.
  private insertAt(point: Point, gap: string, node: ElementPart): void {
    const { owner, index, split } = point;
    const there = owner.parts[index];
    if (typeof there === "string" && split > 0) {
      this.replace(owner, index, index + 1, [there.slice(0, split) + gap, node, there.slice(split)]);
    } else {
      this.replace(owner, index, index, [gap, node]);
    }
  }

  /// Toglie `node` dal suo contenitore. Se comincia una riga, va via anche
  /// l'a capo col rientro che lo precede, così non resta una riga vuota
  /// (§6). Restituisce il punto e gli spazi tolti, per rimetterlo.
  private detach(node: ElementPart): { anchor: Anchor; gap: string } {
    const owner = node.parent!;
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
  private destination(parent: ContainerNode, pos: unknown): Destination {
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
      // `first` viene dopo titolo e descrizione e, sotto la radice, dopo la
      // carta: in fondo all'ordine visivo, non prima dei metadati.
      let anchor: ElementPart | null = null;
      for (const child of children) {
        if (isMeta(child) || (parent === model.root && roleOf(child) === "paper")) anchor = child;
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

  /// Mette `node` in `to`.
  private place(to: Destination, node: ElementPart): void {
    if (to.kind === "point") {
      this.insertAt(to.point, to.gap, node);
      return;
    }
    // Un genitore vuoto si riscrive in forma aperta, col figlio dentro (§6).
    const { parent } = to;
    const indent = indentOf(this.t.model, parent);
    if (parent.tail === null) this.rewriteHead(parent, (attrs) => attrs, false);
    this.t.splice(parent, 0, parent.parts.length, [this.eolOf(`\n${to.indent}`), node, this.eolOf(`\n${indent}`)]);
  }

  // -------------------------------------------------------------------------
  // Lettura e scrittura di un elemento.
  // -------------------------------------------------------------------------

  /// `raw` letto come figlio di `parent`; `null` se non è un elemento ben
  /// formato da solo in quello scope.
  private build(raw: string, parent: ContainerNode): ElementPart | null {
    const fragment = parseFragment(raw, scopeOf(parent));
    return fragment === null ? null : buildFragment(fragment, parent);
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
      const found = classifyChild(fragment.doc, fragment.id, node.parent.parent === null, node.depth);
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

  /// Controlla `elem` e ne fa la forma da scrivere: id nuovi, valori nei
  /// limiti, inchiostro e pennello dei tratti, `d` dei tratti ricalcolato
  /// (§4). Il resto lo giudica la classificazione, sull'elemento scritto.
  private prepare(elem: unknown, scope: NamespaceScope, underRoot: boolean): Elem {
    const ids = new Set<string>();
    const visit = (value: unknown, top: boolean): Elem => {
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
      if (get(FUB_NS, "role") === "paper") reject("invalid-elem", "la carta nasce solo col documento");
      const layer = tag === "g" && get(FUB_NS, "layer") !== undefined;
      if (layer && !(top && underRoot)) reject("invalid-elem", "un livello sta solo sotto la radice");
      const id = get("", "id");
      if (id === undefined) {
        if (tag !== "title" && tag !== "desc" && tag !== "tspan") reject("invalid-elem", `${tag} senza id`);
      } else {
        if (!isNewId(id, layer ? "layer" : "object")) {
          reject("invalid-elem", `id non valido per un ${layer ? "livello" : "oggetto"}: ${JSON.stringify(id)}`);
        }
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
        out.children = value.children.map((child) => visit(child, false));
      }
      if (value.text !== undefined) out.text = value.text as string | null;
      return out;
    };
    return visit(elem, true);
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
    if (this.lockedInside(parent)) reject("locked", "il genitore è un livello bloccato o ci sta dentro");
    const root = parent === this.t.model.root;
    const scope = scopeOf(parent);
    const elem = this.prepare(op.elem, scope, root);
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
    const to = this.destination(parent, op.pos);
    const node = this.build(this.eolOf(writeElement(out, this.indentFor(to))), parent);
    if (node === null) reject("invalid-elem", "l'elemento scritto non si legge");
    const problem = this.problem(node);
    if (problem !== null) reject("invalid-elem", problem);
    this.checkNesting(node, parent);
    this.place(to, node);
    this.touch(node);
    return { op: "remove", target: this.targetOf(node) };
  }

  /// La forma canonica di un elemento del documento, per confrontarla.
  private canonical(node: ElementPart): string {
    const fragment = parseFragment(rawOf(node), scopeOf(node.parent!));
    return fragment === null ? "" : writeElement(elementToOut(fragment.doc, fragment.id), "");
  }

  private remove(op: Record<string, unknown>): Op {
    const node = this.target(op.target);
    this.guard(node, false);
    this.touch(node);
    const raw = rawOf(node);
    const { anchor, gap } = this.detach(node);
    return { op: "add", slot: this.slotOf(anchor), gap, raw };
  }

  /// L'inversa di `remove`: rimette gli spazi e l'elemento così come erano.
  private restore(op: Record<string, unknown>): Op {
    if (typeof op.raw !== "string" || typeof op.gap !== "string" || !isBlank(op.gap)) reject("invalid-elem", "ripristino non valido");
    const anchor = this.anchorOf(op.slot);
    if (this.lockedInside(anchor.owner)) reject("locked", "il genitore è un livello bloccato o ci sta dentro");
    const node = this.build(op.raw, anchor.owner);
    if (node === null) reject("invalid-elem", "l'elemento da rimettere non si legge");
    const taken = idsIn(node).find((id) => this.t.has(id));
    if (taken !== undefined) reject("duplicate-id", `id già usato: ${taken}`);
    this.insertAt(this.pointOf(anchor), op.gap, node);
    this.touch(node);
    return { op: "remove", target: this.targetOf(node) };
  }

  // -------------------------------------------------------------------------
  // move e la sua inversa.
  // -------------------------------------------------------------------------

  private move(op: Record<string, unknown>): Op {
    const node = this.target(op.target);
    this.guard(node, false);
    const parent = this.container(op.parent);
    if (this.lockedInside(parent)) reject("locked", "il genitore è un livello bloccato o ci sta dentro");
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
    return this.relocate(node, () => this.destination(parent, op.pos));
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
    if (this.lockedInside(anchor.owner)) reject("locked", "il genitore è un livello bloccato o ci sta dentro");
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
    const { anchor, gap } = this.detach(node);
    const to = destination();
    const owner = to.kind === "point" ? to.point.owner : to.parent;
    const moved = reindent(raw, oldScope, oldParent === model.root, oldParent.depth + 1, oldIndent, this.indentFor(to));
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
    this.place(to, built);
    return { op: "move", target: this.targetOf(built), slot: this.slotOf(anchor), gap };
  }

  // -------------------------------------------------------------------------
  // set, text e ident.
  // -------------------------------------------------------------------------

  private set(op: Record<string, unknown>): Op {
    if (typeof op.id !== "string" || !isRecord(op.attrs)) reject("invalid-elem", "set non valido");
    if (op.id === ROOT) return this.setRoot(op.attrs);
    const node = this.target(op.id);
    this.guard(node, true);
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
    if (current(FUB_NS, "role") === "paper") reject("invalid-elem", "la carta nasce solo col documento");
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
      if (roleOf(built) === "paper") reject("invalid-elem", "la carta nasce solo col documento");
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
    const lines: string[] = [];
    for (const line of op.lines as unknown[]) {
      if (typeof line !== "string" || !isXmlText(line) || /[\r\n]/.test(line)) reject("invalid-elem", "riga non valida");
      lines.push(line);
    }
    const node = this.target(op.id);
    this.guard(node, true);
    if (roleOf(node) !== "text") reject("invalid-elem", `${op.id} non è un testo`);
    const previous = [...(node.details!.lines ?? [])];
    this.rewriteLeaf(node, (out, { fragment, element, scope }) => {
      const doc = fragment.doc;
      const others: OutElement[] = [];
      const tspans: ElementNode[] = [];
      for (const child of element.children) {
        const read = doc.element(child);
        if (read === null) continue;
        if (isSvg(read, "tspan")) tspans.push(read);
        else others.push(elementToOut(doc, child));
      }
      // Una riga nuova copia gli attributi della precedente, senza id, e va
      // giù di un'interlinea: quella delle righe che ci sono già, oppure 1,25
      // volte il corpo con cui si vede l'ultima riga.
      let spacing: string | null = null;
      for (let k = tspans.length - 1; k >= 1 && spacing === null; k--) spacing = valueOf(tspans[k]!, NS_NONE, "dy") ?? null;
      if (spacing === null) {
        const last = tspans.length === 0 ? [] : [tspans[tspans.length - 1]!];
        spacing = formatNumber(this.fontSize([...last, element], node.parent) * 1.25, 2);
      }
      const name = scope.svgName("tspan")!;
      const written: OutElement[] = [];
      for (let i = 0; i < lines.length; i++) {
        let attrs: OutAttr[];
        if (i < tspans.length) {
          attrs = canonicalOrder(attributesOf(doc, tspans[i]!));
        } else {
          const dy: OutAttr = { name: "dy", uri: "", local: "dy", text: escapeAttribute(i === 0 ? "0" : spacing) };
          const base = i > 0
            ? written[i - 1]!.attrs.filter((a) => !(a.uri === "" && (a.local === "id" || a.local === "dy")))
            : attributesOf(doc, element).filter((a) => a.uri === "" && a.local === "x");
          attrs = canonicalOrder([...base, dy]);
        }
        written.push({ name, group: false, attrs, children: [], text: escapeText(lines[i]!) });
      }
      return { ...out, children: [...others, ...written] };
    });
    this.touched.add(op.id);
    return { op: "text", id: op.id, lines: previous };
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
    const old = node.facts.id;
    if (id !== null) {
      // Ogni id che il formato ammette, non solo quelli che FubDraw genera:
      // un id si cambia togliendolo e dandone un altro, e l'undo rimette
      // quello di prima com'era scritto.
      if (id === "") reject("invalid-elem", "id vuoto");
      this.checkValue(tag, "", "id", id);
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
    else this.replaceLeaf(node, patched);
    this.touched.add(id ?? old!);
    return { op: "ident", path: [...path], tag, id: id === null ? old : null };
  }

  // -------------------------------------------------------------------------
  // page, meta e adopt: la radice.
  // -------------------------------------------------------------------------

  private page(op: Record<string, unknown>): Op {
    const root = this.t.model.root;
    const papers = elementChildren(root).filter((child) => roleOf(child) === "paper");
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
      this.place(to, node);
    }
    return inverse;
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
