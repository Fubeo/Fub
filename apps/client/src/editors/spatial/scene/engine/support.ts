// Gli aiuti senza stato del motore delle operazioni: i rifiuti, i controlli
// sugli argomenti, i ruoli dei nodi, gli id nuovi e le riscritture degli
// attributi (vedi `../engine.ts`).

import { BrushError } from "../../../../ink/brush";
import { InkError } from "../../../../ink/sample";
import { isContainer } from "../analysis";
import {
  classifyChild,
  isResourceTag,
  NO_RESOURCES,
  originalsOf,
  repeatOf,
  styleKindOf,
  withArrivingSymbols,
  withOriginals,
  type Place,
  type Resolve,
} from "../classify";
import { DEFS_ID, isNewId, pageId, type IdKind } from "../ids";
import { declarationsOf, parseFragment, type ContainerNode, type ElementPart, type Fragment } from "../model";
import type { BatchOp, Op, PathTarget, Reason } from "../ops";
import { ElemError, escapeAttribute, NamespaceScope, type OutAttr, type OutElement } from "../serialize";
import { isSpace, SVG_NS, type Attr, type ElementNode, type NodeId, type XmlDocument } from "../xml";

/// Quante operazioni `set` di fila su unità diverse, al meno e al più, un
/// `batch` applica in un passaggio solo.
export const LEAF_RUN_MIN = 2;
export const LEAF_RUN_MAX = 512;

/// Un tratto di `set` che si applica in un passaggio solo: le unità
/// bersaglio, come sono scritte, e dove stanno nel loro contenitore.
export interface LeafRun {
  readonly nodes: ElementPart[];
  readonly raws: string[];
  readonly indices: number[];
}

/// Il rientro di una riga che comincia dopo lo spazio `gap`, che va a capo:
/// gli spazi e le tabulazioni dopo l'ultimo a capo, come `indentAt`.
export function indentAfterBreak(gap: string): string {
  let at = Math.max(gap.lastIndexOf("\n"), gap.lastIndexOf("\r")) + 1;
  const from = at;
  while (at < gap.length && (gap.charCodeAt(at) === 0x20 || gap.charCodeAt(at) === 0x09)) at++;
  return gap.slice(from, at);
}

/// Un rifiuto dentro il motore: risale fino ad `apply`, che disfa tutto.
export class Rejection extends Error {
  /// Gli indici nei `batch`, dal più esterno.
  readonly indices: number[] = [];

  constructor(
    readonly reason: Reason,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export function reject(reason: Reason, detail: string): never {
  throw new Rejection(reason, detail);
}

/// Il dettaglio di un `ElemError` come rifiuto `invalid-elem`.
export function elemGuard<T>(write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (error instanceof ElemError) reject("invalid-elem", error.detail);
    throw error;
  }
}

export const OP_NAMES: ReadonlySet<unknown> = new Set(["add", "remove", "set", "text", "move", "ident", "page", "meta", "adopt", "anchor", "batch"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPath(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((i) => Number.isSafeInteger(i) && (i as number) >= 0);
}

export function isPathTarget(value: unknown): value is PathTarget {
  return isRecord(value) && isPath(value.path) && typeof value.tag === "string";
}

/// Vero se `text` è fatto solo degli spazi di XML.
export function isBlank(text: string): boolean {
  return /^[ \t\r\n]*$/.test(text);
}

/// Il dettaglio di un errore d'inchiostro o di pennello.
export function inkDetail(error: unknown): string | null {
  return error instanceof InkError || error instanceof BrushError ? error.detail : null;
}

/// Il punto da cui un elemento è stato tolto, coi nodi che lo descrivono.
/// Diventa uno `Slot` a operazione finita, quando i percorsi sono quelli
/// della scena su cui l'inversa si applicherà.
export interface Anchor {
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
export interface Point {
  readonly owner: ContainerNode;
  readonly index: number;
  readonly split: number;
}

/// Dove va un elemento nuovo: un punto con lo spazio che lo precede, oppure
/// un genitore vuoto da riscrivere in forma aperta.
export type Destination =
  | { readonly kind: "point"; readonly point: Point; readonly gap: string }
  | { readonly kind: "empty"; readonly parent: ContainerNode; readonly indent: string };

/// Ciò che si sa di un elemento riletto da solo.
export interface Reread {
  readonly fragment: Fragment;
  readonly element: ElementNode;
  /// Lo scope in vigore dentro l'elemento.
  readonly scope: NamespaceScope;
}

/// Ciò che si sa di `fragment`, un elemento riletto da solo dentro `outer`.
export function readOf(fragment: Fragment, outer: NamespaceScope): Reread {
  const element = fragment.doc.element(fragment.id)!;
  const declarations = declarationsOf(element);
  return { fragment, element, scope: declarations.length === 0 ? outer : outer.declare(declarations) };
}

/// Il ruolo di un elemento, `null` se è estraneo.
export function roleOf(node: ElementPart): string | null {
  return node.details === null ? null : node.details.role;
}

/// Vero per la carta della pagina: una carta senza `fub:board` (formato della
/// scena, tavole).
export function isPagePaper(node: ElementPart): boolean {
  return node.details !== null && node.details.role === "paper" && node.details.board === undefined;
}

/// Che cosa è, fra tavole e carte, un elemento nuovo con questo tag e questi
/// `fub:role` e `fub:board`, figlio della radice se `top`; rifiuta una carta
/// che non è di una tavola o non sta sotto la radice (formato della scena,
/// tavole).
export function sheetOf(tag: string, role: string | undefined, board: string | undefined, top: boolean): "board" | "paper" | null {
  if (role === "paper") {
    if (!top || tag !== "rect" || board === undefined) reject("invalid-elem", "una carta nuova è di una tavola, sotto la radice");
    return "paper";
  }
  return top && tag === "view" && role === "board" ? "board" : null;
}

/// Vero se un elemento è `title` o `desc` di SVG.
export function isMeta(node: ElementPart): boolean {
  return node.facts.uri === SVG_NS && (node.facts.local === "title" || node.facts.local === "desc");
}

/// `ops` uno dopo l'altro in un `batch` solo: un `batch` fra loro si apre, e
/// la sua etichetta passa a quello nuovo.
export function chain(ops: readonly Op[]): BatchOp {
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
/// di una `defs` (`inDefs`), il tracciato di un testo, un `text` o una
/// `polyline` con `fub:role` uguale a `role` `style`, uno stile, e un
/// `symbol` un simbolo.
export function isResource(tag: string, inDefs: boolean, role: string | undefined): boolean {
  return isResourceTag(tag) || (inDefs && (tag === "path" || tag === "symbol" || (role === "style" && styleKindOf(tag) !== null)));
}

/// Controlla l'id di un elemento nuovo (§4): ogni elemento ne ha uno nella
/// forma degli id nuovi, tranne `title`, `desc`, `tspan` e `textPath`. Una
/// risorsa l'ha nella forma delle risorse e una `defs` è quella di FubDraw;
/// ciò che sta dentro una risorsa può non averlo, e se l'ha è nella forma
/// delle risorse. `inDefs` dice se l'elemento è figlio di una `defs`, `role`
/// il suo `fub:role`; `sheet` se è una tavola o la carta di una tavola (formato della scena,
/// tavole); `page` il numero del gruppo di una pagina annotata, che ha l'id
/// dal suo numero (`annotation-format.md`, §3).
export function checkNewId(
  tag: string,
  id: string | undefined,
  layer: boolean,
  inResource: boolean,
  inDefs: boolean,
  role: string | undefined,
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
  const kind: IdKind = inResource || isResource(tag, inDefs, role) ? "resource" : layer ? "layer" : (sheet ?? "object");
  if (!isNewId(id, kind)) reject("invalid-elem", `id non valido per ${ID_NAMES[kind]}: ${JSON.stringify(id)}`);
}

/// Il nome espanso di ogni elemento e attributo dell'elemento `id`, in
/// ordine: due letture con gli stessi nomi dicono la stessa cosa.
export function expandedNames(doc: XmlDocument, id: NodeId): string {
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
export function sameScope(a: NamespaceScope, b: NamespaceScope): boolean {
  const left = new Map(a.entries());
  const right = b.entries();
  return left.size === right.length && right.every(([prefix, uri]) => left.get(prefix) === uri);
}

/// Dove sta, nel testo di `element`, l'attributo `attr`: dagli spazi che lo
/// precedono alla virgoletta di chiusura, dall'inizio dell'elemento.
export function attributeSpan(doc: XmlDocument, element: ElementNode, attr: Attr): [number, number] {
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
/// `originals` sono gli originali fra i fratelli dell'elemento, se sta in una
/// ripetizione.
export function reindent(
  raw: string,
  scope: NamespaceScope,
  place: Place,
  depth: number,
  from: string,
  to: string,
  resolve: Resolve = NO_RESOURCES,
  originals: ReadonlySet<string> = new Set(),
): string {
  if (from === to || raw.includes("xml:space")) return raw;
  const fragment = parseFragment(raw, scope);
  if (fragment === null) return raw;
  const { doc } = fragment;
  // Un simbolo che si sposta in una `defs`, anche con la sua, è ancora un
  // simbolo.
  const inner = withArrivingSymbols(doc, [fragment.id], place, resolve);
  const base = doc.element(fragment.id)!.start;
  const ranges: Array<readonly [number, number]> = [];
  const stack: Array<readonly [NodeId, Place, number, Resolve]> = [[fragment.id, place, depth, withOriginals(inner, originals)]];
  while (stack.length > 0) {
    const [id, at, level, around] = stack.pop()!;
    const found = classifyChild(doc, id, at, level, around);
    if (found === null) continue;
    const element = doc.element(id)!;
    const container = isContainer(found[1]);
    // Gli spazi di un'unità contano solo fra figli elemento: dentro un
    // `title` sono il suo testo.
    if (!container && !element.children.some((child) => doc.element(child) !== null)) continue;
    // I figli di una ripetizione rimandano anche ai loro originali.
    const repeat = found[1] === "group" && repeatOf(element) !== null;
    const below = repeat ? withOriginals(inner, originalsOf(doc, id, level + 1, inner)) : inner;
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" && node.blank) ranges.push([node.start - base, node.end - base]);
      else if (container && node.kind === "element") stack.push([child, found[1] === "defs" ? "defs" : "inside", level + 1, below]);
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
export interface Change {
  readonly key: string;
  readonly uri: string;
  readonly local: string;
  readonly name: string;
  readonly value: string | null;
}

/// Gli attributi scritti con i cambiamenti di `changes`, per nome espanso
/// (`"<uri> <local>"`): un valore nuovo prende il posto del vecchio, `null` lo
/// toglie, un attributo che non c'era va in fondo.
export function changed(changes: ReadonlyMap<string, Change>): (attrs: OutAttr[]) => OutAttr[] {
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

/// Gli elementi il cui contenuto è testo, come li scrive `elementToOut`.
export const TEXT_HOLDERS: readonly string[] = ["title", "desc", "tspan", "textPath"];

/// `out` con la parte al percorso `part`, indici dei figli elemento, data da
/// `change`.
export function withPart(out: OutElement, part: readonly number[], change: (inner: OutElement) => OutElement): OutElement {
  if (part.length === 0) return change(out);
  const [index, ...rest] = part;
  return { ...out, children: out.children.map((child, i) => (i === index ? withPart(child, rest, change) : child)) };
}

/// Gli id a cui rimanda `node` con ciò che contiene, come li conta l'albero.
export function refsWithin(node: ElementPart): Set<string> {
  const out = new Set<string>();
  const stack: ElementPart[] = [node];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const id of at.kind === "leaf" ? at.refs : at.facts.refs) out.add(id);
    if (at.kind !== "container") continue;
    for (const part of at.parts) if (typeof part !== "string" && part.kind !== "other") stack.push(part);
  }
  return out;
}
