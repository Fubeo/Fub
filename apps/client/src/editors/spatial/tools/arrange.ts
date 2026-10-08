// Disporre gli oggetti scelti (livello Standard): duplicare, cambiare ordine,
// raggruppare e separare, collegare a una nota, allineare e distribuire. Ogni
// comando diventa un `batch` solo, così annulla e ripeti lo disfano intero.
//
// - **Gli id prima di tutto.** Un oggetto o un livello senza id, che il
//   comando deve nominare, lo riceve con `ident` in testa al `batch`: i
//   percorsi valgono finché niente si sposta, e dopo si nomina per id.
// - **Spostare, non riscrivere.** Ordine, gruppi e separazione muovono gli
//   elementi con `move`, che li porta com'erano scritti; solo ciò che cambia
//   davvero passa da `set`.
// - **Ciò che si vede resta.** Raggruppare oggetti di livelli diversi ne
//   compensa le trasformazioni; separare un gruppo porta la sua
//   trasformazione e lo stile che i figli ereditavano su ciascun figlio, e
//   moltiplica la sua opacità nella loro. Qui si scrivono gli oggetti; le
//   parti estranee si spostano come sono, e ciò che serve perché si vedano
//   com'erano, anche con un foglio di stile del disegno che dopo il comando
//   sceglierebbe altro, lo aggiunge l'editor (`styled.ts`).
// - **Un collegamento è un gruppo che porta a una nota**: un `a` con `href`,
//   che si crea attorno agli oggetti come un gruppo e si toglie come si
//   separa un gruppo. Un collegamento non ne contiene un altro.
// - **La copia è un oggetto nuovo.** Un duplicato ha id nuovi in tutto il
//   sottoalbero, e sta sopra gli originali del suo livello, spostato di un
//   passo; le risorse private che usa le ha copiate anche lui, e quelle
//   condivise le condivide. Un oggetto con parti estranee non si duplica,
//   perché un'operazione non le sa scrivere.
// - **I connettori seguono le copie.** Un connettore copiato con gli oggetti
//   a cui è agganciato, e un'etichetta con il suo connettore, nominano le
//   copie; senza, il capo è libero e l'etichetta un testo qualunque
//   (`connector-copies.ts`).
// - **Allineare e distribuire** spostano soltanto, sui riquadri che si vedono,
//   contorno compreso; gli spostamenti si arrotondano come quelli a mano.

import type { Bounds } from "../scene/geometry";
import type { IdKind } from "../scene/ids";
import { compose, IDENTITY, invert, type Matrix } from "../scene/matrix";
import { declarationsOf, elementChildren, HEADS, parseFragment, pathOf, scopeKey, scopeOf, tagName, type ContainerNode, type DocumentModel, type ElementPart, type Head } from "../scene/model";
import { ROOT, type AddOp, type Op, type Pos, type Target } from "../scene/ops";
import { NamespaceScope, type Elem, type Run } from "../scene/serialize";
import { href as parseHref, opacity as parseOpacity, transform as parseTransform } from "../scene/values";
import { FUB_NS, NS_SVG, SVG_NS, XLINK_NS, XML_URI, type ElementNode, type XmlDocument } from "../scene/xml";
import { formatNumber } from "../number";
import { relinkCopies } from "./connector-copies";
import { moveOps, movedMatrix, roundDelta, transformValue, type Moved, type NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { holdsEffect, ResourceCopies } from "./resources";

/// Dove va la selezione nell'ordine del suo livello.
export type Order = "front" | "forward" | "backward" | "back";

/// A che cosa si allinea la selezione: un bordo o il centro, su un asse.
export type Edge = "left" | "center" | "right" | "top" | "middle" | "bottom";

export type Axis = "x" | "y";

/// Gli attributi che i figli ereditano da un gruppo e che, separandolo, si
/// portano su ciascuno che non li ha già.
export const INHERITED: readonly string[] = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
];

/// I tag che hanno testo e non figli.
const TEXT_TAGS: ReadonlySet<string> = new Set(["title", "desc", "tspan", "textPath"]);

/// I decimali dell'opacità che separare un gruppo moltiplica.
const OPACITY_PLACES = 4;

/// Un comando pronto: le operazioni, in un `batch`, e le chiavi della
/// selezione dopo.
export type Arranged = Moved;

/// Le operazioni di un comando: gli `ident` in testa, poi il resto.
export class Plan {
  private readonly idents: Op[] = [];
  readonly ops: Op[] = [];
  /// Gli id dati in questo comando, per percorso.
  private readonly named = new Map<string, string>();

  constructor(
    readonly model: DocumentModel,
    readonly ids: NewIds,
  ) {}

  /// L'id di `node`, un elemento modificabile: il suo, o uno nuovo con
  /// `ident`.
  idOf(node: ElementPart, kind: IdKind = "object"): string {
    if (node.facts.id !== null) return node.facts.id;
    const path = pathOf(node);
    const key = path.join(".");
    let id = this.named.get(key);
    if (id === undefined) {
      id = this.ids.next(kind);
      this.named.set(key, id);
      this.idents.push({ op: "ident", path, tag: tagName(node), id });
    }
    return id;
  }

  /// Il genitore di `node` come lo nomina un'operazione: `#root`, o l'id del
  /// livello o del gruppo.
  parentOf(node: ElementPart): string {
    const parent = node.parent!;
    if (parent === this.model.root) return ROOT;
    return this.idOf(parent, parent.parent === this.model.root && parent.details?.role === "layer" ? "layer" : "object");
  }

  /// La chiave di `node` dopo il comando: il suo id, anche quello che gli
  /// dà il comando, o `key` se resta senza.
  keyOf(node: ElementPart, key: string): string {
    return node.facts.id ?? this.named.get(pathOf(node).join(".")) ?? key;
  }

  finish(keys: readonly string[]): Arranged {
    return { ops: this.ops.length === 0 ? [] : [...this.idents, ...this.ops], keys };
  }
}

/// Il nodo del modello di `unit`, o di una voce della scena col suo percorso.
export function nodeOf(model: DocumentModel, unit: { readonly path: readonly number[] }): ElementPart {
  let node: ElementPart = model.root;
  for (const at of unit.path) node = elementChildren(node as ContainerNode)[at]!;
  return node;
}

/// Il percorso del genitore di un oggetto, come chiave.
const parentKey = (unit: Unit): string => unit.path.slice(0, -1).join(".");

function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Leggere un elemento.
// ---------------------------------------------------------------------------

/// Il tag d'apertura di `node` letto da solo, nello scope del genitore; la
/// radice non ne ha. Chi lo riceve non lo cambia. I tag già letti stanno in
/// [`HEADS`]: chi li chiede due volte per lo stesso testo, e nello stesso
/// scope, non li rilegge. Un connettore che segue ne chiede tre, e
/// un'operazione su duecento oggetti ne chiede migliaia.
export function readHead(node: ElementPart): Head {
  const raw = node.kind === "leaf" ? node.raw : node.tail === null ? node.head : `${node.head}</${node.facts.name}>`;
  const scope = node.parent === null ? NamespaceScope.EMPTY : scopeOf(node.parent);
  const key = scopeKey(scope);
  const known = HEADS.get(node);
  if (known !== undefined && known.raw === raw && known.scope === key) return known.head;
  const fragment = parseFragment(raw, scope);
  const head: Head = fragment === null ? null : { doc: fragment.doc, element: fragment.doc.element(fragment.id)! };
  HEADS.set(node, { raw, scope: key, head });
  return head;
}

/// Il nome di un attributo come lo scrive un'operazione; `null` se non ha un
/// prefisso con cui scriverlo. Le dichiarazioni di namespace non sono
/// attributi.
function attributeKey(doc: XmlDocument, element: ElementNode, at: number, scope: NamespaceScope): string | null | undefined {
  const attr = element.attrs[at]!;
  if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) return undefined;
  const uri = doc.namespaces[attr.ns] ?? "";
  if (uri === "") return attr.local;
  if (uri === FUB_NS) return `fub:${attr.local}`;
  if (uri === XLINK_NS) return `xlink:${attr.local}`;
  if (uri === XML_URI) return `xml:${attr.local}`;
  const prefix = scope.attributePrefix(uri);
  return prefix === null ? null : `${prefix}:${attr.local}`;
}

function attributesOf(doc: XmlDocument, element: ElementNode, scope: NamespaceScope): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  for (let at = 0; at < element.attrs.length; at++) {
    const key = attributeKey(doc, element, at, scope);
    if (key === undefined) continue;
    if (key === null) return null;
    attrs[key] = element.attrs[at]!.value;
  }
  return attrs;
}

/// Gli attributi senza namespace di `node`, come li legge un parser.
export function plainAttributes(node: ElementPart): Map<string, string> {
  const read = readHead(node);
  const out = new Map<string, string>();
  if (read === null) return out;
  for (const attr of read.element.attrs) if ((read.doc.namespaces[attr.ns] ?? "") === "" && !attr.name.startsWith("xmlns")) out.set(attr.local, attr.value);
  return out;
}

/// Gli attributi `fub:` di `node`, per nome locale.
export function fubAttributes(node: ElementPart): Map<string, string> {
  const read = readHead(node);
  const out = new Map<string, string>();
  for (const attr of read?.element.attrs ?? []) if (read!.doc.namespaces[attr.ns] === FUB_NS) out.set(attr.local, attr.value);
  return out;
}

/// I valori di `href` e di `xlink:href` di `node`; `null` quello che manca.
function hrefAttributes(node: ElementPart): { readonly plain: string | null; readonly xlink: string | null } {
  const read = readHead(node);
  let plain: string | null = null;
  let xlink: string | null = null;
  for (const attr of read?.element.attrs ?? []) {
    if (attr.local !== "href") continue;
    const uri = read!.doc.namespaces[attr.ns] ?? "";
    if (uri === "") plain = attr.value;
    else if (uri === XLINK_NS) xlink = attr.value;
  }
  return { plain, xlink };
}

/// L'`href` di `node` com'è scritto: come in SVG 2, `href` prevale su
/// `xlink:href`. `null` se non ce l'ha.
export function hrefOf(node: ElementPart): string | null {
  const { plain, xlink } = hrefAttributes(node);
  return plain ?? xlink;
}

/// Il percorso del vault a cui porta il collegamento `node`, com'è scritto:
/// relativo al disegno, o dalla radice del vault se comincia con `/`. Come in
/// SVG 2, `href` prevale su `xlink:href`. `null` se non porta nel vault.
export function linkTarget(node: ElementPart): string | null {
  const value = hrefOf(node);
  if (value === null) return null;
  const target = parseHref(value);
  return target.kind === "vault" ? target.url : null;
}

/// Un elemento letto, come lo scrive un'operazione.
function xmlElem(doc: XmlDocument, element: ElementNode, outer: NamespaceScope): Elem | null {
  if (element.ns !== NS_SVG) return null;
  const scope = outer.declare(declarationsOf(element));
  const attrs = attributesOf(doc, element, scope);
  if (attrs === null) return null;
  const children: Elem[] = [];
  const runs: Run[] = [];
  let text = "";
  for (const id of element.children) {
    const child = doc.nodes[id]!;
    if (child.kind === "element") {
      const elem = xmlElem(doc, child, scope);
      if (elem === null) return null;
      children.push(elem);
      // Un pezzo di una riga o del tracciato: solo testo dentro.
      runs.push({ text: elem.text ?? "", attrs: elem.attrs });
    } else if (child.kind === "text") {
      text += child.value;
      runs.push(child.value);
    }
  }
  if ((element.local === "tspan" || element.local === "textPath") && children.length > 0) return { tag: element.local, attrs, runs };
  if (TEXT_TAGS.has(element.local)) return { tag: element.local, attrs, text };
  return children.length === 0 ? { tag: element.local, attrs } : { tag: element.local, attrs, children };
}

/// `node` come lo scrive un'operazione, coi figli; `null` se contiene parti
/// estranee, o nomi che un'operazione non sa scrivere. I commenti dentro un
/// gruppo non passano.
export function elemOf(node: ElementPart): Elem | null {
  return elemIn(node, scopeOf(node.parent!));
}

function elemIn(node: ElementPart, scope: NamespaceScope): Elem | null {
  if (node.details === null || node.facts.uri !== SVG_NS) return null;
  const read = readHead(node);
  if (read === null) return null;
  if (node.kind === "leaf") return xmlElem(read.doc, read.element, scope);
  const inner = scope.declare(node.declarations);
  const attrs = attributesOf(read.doc, read.element, inner);
  if (attrs === null) return null;
  const children: Elem[] = [];
  for (const child of elementChildren(node)) {
    const elem = elemIn(child, inner);
    if (elem === null) return null;
    children.push(elem);
  }
  return { tag: node.facts.local, attrs, children };
}

/// `elem` con id nuovi, che il motore chiede a ogni elemento aggiunto: solo
/// titoli, descrizioni e righe di testo possono restare senza. Con `made`,
/// l'id che ciascuno aveva e quello che prende, anche nei discendenti, perché
/// chi nomina un oggetto per id possa seguirne la copia.
export function renamed(elem: Elem, ids: NewIds, made?: Map<string, string>): Elem {
  const attrs = { ...elem.attrs };
  if (attrs.id !== undefined || !TEXT_TAGS.has(elem.tag)) {
    const id = ids.next("object");
    if (attrs.id !== undefined) made?.set(attrs.id, id);
    attrs.id = id;
  }
  const out: { tag: string; attrs: Record<string, string>; children?: Elem[]; text?: string | null; runs?: readonly Run[] } = { tag: elem.tag, attrs };
  if (elem.children !== undefined) out.children = elem.children.map((child) => renamed(child, ids, made));
  if (elem.text !== undefined) out.text = elem.text;
  if (elem.runs !== undefined) out.runs = elem.runs;
  return out;
}

// ---------------------------------------------------------------------------
// Duplicare.
// ---------------------------------------------------------------------------

/// Le copie di `units`, spostate di (`dx`, `dy`) nella scena: per ogni
/// livello, subito sopra l'originale più in alto, nell'ordine degli
/// originali. Le risorse private che usano si copiano con `copies`: un
/// comando che copia anche altro gli passa le sue, e le loro operazioni
/// escono qui tutte insieme, prima degli oggetti. I connettori e le etichette
/// copiati nominano le copie degli oggetti copiati con loro; senza di essi
/// restano liberi. `null` se un oggetto ha parti che non si copiano.
export function duplicateOps(
  model: DocumentModel,
  units: readonly Unit[],
  dx: number,
  dy: number,
  ids: NewIds,
  copies: ResourceCopies = new ResourceCopies(model, ids, elemOf),
): Arranged | null {
  const plan = new Plan(model, ids);
  const adds: AddOp[] = [];
  /// L'id degli oggetti copiati e quello delle loro copie.
  const made = new Map<string, string>();
  const byParent = new Map<string, Unit[]>();
  for (const unit of units) {
    const list = byParent.get(parentKey(unit));
    if (list === undefined) byParent.set(parentKey(unit), [unit]);
    else list.push(unit);
  }
  const keys: string[] = [];
  for (const list of byParent.values()) {
    const top = nodeOf(model, list[list.length - 1]!);
    const parent = plan.parentOf(top);
    let after = plan.idOf(top);
    for (const unit of list) {
      const elem = elemOf(nodeOf(model, unit));
      const copy = elem === null ? null : copies.adopt(renamed(elem, ids, made));
      if (copy === null) return null;
      const moved = movedMatrix(unit, dx, dy) ?? unit.transform;
      const value = transformValue(moved);
      const attrs = copy.attrs as Record<string, string>;
      if (value === null) delete attrs.transform;
      else attrs.transform = value;
      adds.push({ op: "add", parent, pos: { after }, elem: copy });
      after = attrs.id!;
      keys.push(after);
    }
  }
  // Le risorse prima di chi le usa. I connettori nominano le copie solo ora,
  // che ognuna ha il suo id.
  const linked = relinkCopies(adds.map((add) => add.elem), made);
  plan.ops.push(...copies.ops(), ...adds.map((add, at): AddOp => ({ ...add, elem: linked[at]! })));
  return plan.finish(keys);
}

// ---------------------------------------------------------------------------
// Ordine.
// ---------------------------------------------------------------------------

/// Il nuovo ordine di `keys`, dal basso in alto, con `chosen` spostati.
function reorder(keys: readonly string[], chosen: ReadonlySet<string>, order: Order): string[] {
  const out = [...keys];
  switch (order) {
    case "front":
      return [...keys.filter((key) => !chosen.has(key)), ...keys.filter((key) => chosen.has(key))];
    case "back":
      return [...keys.filter((key) => chosen.has(key)), ...keys.filter((key) => !chosen.has(key))];
    case "forward":
      // Dall'alto: un blocco di oggetti scelti sale insieme di un posto.
      for (let i = out.length - 2; i >= 0; i--) {
        if (chosen.has(out[i]!) && !chosen.has(out[i + 1]!)) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
      }
      return out;
    case "backward":
      for (let i = 1; i < out.length; i++) {
        if (chosen.has(out[i]!) && !chosen.has(out[i - 1]!)) [out[i - 1], out[i]] = [out[i]!, out[i - 1]!];
      }
      return out;
  }
}

/// Le operazioni che portano `units` più su o più giù fra gli oggetti del
/// loro livello, o del gruppo che li contiene: ciascuno resta nel suo.
/// Nessuna operazione se l'ordine non cambia.
export function orderOps(model: DocumentModel, index: SceneIndex, units: readonly Unit[], order: Order, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const chosen = new Set(units.map((unit) => unit.key));
  const parents = new Map<string, Unit>();
  for (const unit of units) if (!parents.has(parentKey(unit))) parents.set(parentKey(unit), unit);
  for (const first of parents.values()) {
    const siblings = index.siblings(first);
    const byKey = new Map(siblings.map((unit) => [unit.key, unit]));
    const before = siblings.map((unit) => unit.key);
    const after = reorder(before, chosen, order);
    // Si sposta solo chi non sta già subito sopra quello che deve avere
    // sotto: alla fine ogni oggetto scelto sta sopra il suo vicino nuovo.
    const now = [...before];
    after.forEach((key, at) => {
      if (!chosen.has(key)) return;
      const below = at > 0 ? after[at - 1]! : null;
      const from = now.indexOf(key);
      const place = below === null ? 0 : now.indexOf(below) + 1;
      if (from === place) return;
      now.splice(from, 1);
      now.splice(below === null ? 0 : now.indexOf(below) + 1, 0, key);
      const node = nodeOf(model, byKey.get(key)!);
      const pos: Pos = below === null ? { first: true } : { after: plan.idOf(nodeOf(model, byKey.get(below)!)) };
      plan.ops.push({ op: "move", target: plan.idOf(node), parent: plan.parentOf(node), pos });
    });
  }
  if (plan.ops.length === 0) return { ops: [], keys: units.map((unit) => unit.key) };
  // Ogni oggetto scelto riceve un id, anche se resta fermo: chi gli passa
  // accanto cambia il suo percorso.
  return plan.finish(units.map((unit) => plan.idOf(nodeOf(model, unit))));
}

// ---------------------------------------------------------------------------
// Gruppi.
// ---------------------------------------------------------------------------

/// Un contenitore nuovo `tag` con `units`, nel piano `plan`: al posto del
/// più alto e nel suo livello, con gli oggetti nell'ordine di prima. Un
/// oggetto di un altro livello vi entra con la trasformazione che lo lascia
/// dov'era. Torna l'id del contenitore; `null`, e il piano com'era, se il
/// livello del più alto schiaccia il piano.
export function wrapIn(plan: Plan, units: readonly Unit[], tag: "g" | "a", attrs: Readonly<Record<string, string>>): string | null {
  const top = units[units.length - 1];
  if (top === undefined) return null;
  const inverse = invert(top.parent);
  if (inverse === null) return null;
  const topNode = nodeOf(plan.model, top);
  const parent = plan.parentOf(topNode);
  const after = plan.idOf(topNode);
  const wrapper = plan.ids.next("object");
  plan.ops.push({ op: "add", parent, pos: { after }, elem: { tag, attrs: { id: wrapper, ...attrs }, children: [] } });
  for (const unit of units) {
    const id = plan.idOf(nodeOf(plan.model, unit));
    if (!sameMatrix(unit.parent, top.parent)) {
      plan.ops.push({ op: "set", id, attrs: { transform: transformValue(compose(inverse, unit.matrix)) } });
    }
    plan.ops.push({ op: "move", target: id, parent: wrapper, pos: { last: true } });
  }
  return wrapper;
}

/// Un contenitore nuovo `elem` con `units`, al posto del più alto e nel suo
/// livello, con gli oggetti nell'ordine di prima: vedi [`wrapIn`]. `null` se
/// il livello del più alto schiaccia il piano.
function wrapOps(model: DocumentModel, units: readonly Unit[], ids: NewIds, tag: "g" | "a", attrs: Readonly<Record<string, string>>): Arranged | null {
  const plan = new Plan(model, ids);
  const wrapper = wrapIn(plan, units, tag, attrs);
  return wrapper === null ? null : plan.finish([wrapper]);
}

/// Un gruppo nuovo con `units`, al posto del più alto e nel suo livello: vedi
/// [`wrapOps`].
export function groupOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | null {
  return wrapOps(model, units, ids, "g", {});
}

/// Vero se `unit` è un gruppo che si separa: un `g` che non è un livello.
export function isGroup(unit: Unit): boolean {
  return unit.tag === "g" && unit.role === "group";
}

/// Vero se `node` ha un ritaglio, una maschera, un filtro o degli effetti,
/// anche nascosti: valgono per lui intero, nelle sue coordinate.
export function holdsEffects(node: ElementPart): boolean {
  return holdsEffect(plainAttributes(node)) || fubAttributes(node).has("effect");
}

/// Vero se il contenitore `unit` si toglie senza cambiare ciò che si vede:
/// non ha un ritaglio, una maschera, un filtro o degli effetti, che valgono
/// per lui intero e che i figli, da soli, non disegnerebbero allo stesso
/// modo.
export function unwrappable(model: DocumentModel, unit: Unit): boolean {
  return !holdsEffects(nodeOf(model, unit));
}

/// Separa i gruppi fra `units` che si separano: vedi [`unwrapOps`] e
/// [`unwrappable`].
export function ungroupOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged {
  return unwrapOps(model, units, ids, (unit) => isGroup(unit) && unwrappable(model, unit));
}

/// Toglie i contenitori fra `units` che `unwraps` sceglie, nel piano `plan`:
/// i figli prendono il posto del contenitore, in ordine, con la sua
/// trasformazione e lo stile che ne ereditavano; titolo e descrizione del
/// contenitore se ne vanno con lui. Le parti estranee si spostano come sono:
/// ciò che portano lo aggiunge `styled.ts`. Torna gli oggetti di `units`
/// rimasti, e gli id dei figli portati fuori.
export function unwrapIn(plan: Plan, units: readonly Unit[], unwraps: (unit: Unit) => boolean): { readonly kept: Unit[]; readonly freed: string[] } {
  const { model } = plan;
  const kept: Unit[] = [];
  const freed: string[] = [];
  // Dall'ultimo contenitore al primo, e in ognuno dall'ultimo figlio al
  // primo: così il percorso di una parte estranea senza id vale ancora
  // quando tocca a lei.
  for (const unit of [...units].reverse()) {
    if (!unwraps(unit)) {
      kept.push(unit);
      continue;
    }
    const node = nodeOf(model, unit) as ContainerNode;
    const container = plan.idOf(node);
    const parent = plan.parentOf(node);
    const own = plainAttributes(node);
    const matrix = parseTransform(own.get("transform") ?? "") ?? IDENTITY;
    const moves = !sameMatrix(matrix, IDENTITY);
    const inherited = INHERITED.filter((name) => own.has(name));
    const alpha = parseOpacity(own.get("opacity") ?? "");
    const fades = alpha !== null && alpha < 1;
    const carries = moves || inherited.length > 0 || fades;
    const children = elementChildren(node).filter((child) => !(child.facts.uri === SVG_NS && (child.facts.local === "title" || child.facts.local === "desc")));
    for (const child of [...children].reverse()) {
      let target: Target;
      if (child.details === null) {
        target = child.facts.id ?? { path: pathOf(child), tag: tagName(child) };
      } else {
        const id = plan.idOf(child);
        target = id;
        freed.push(id);
        if (carries) {
          const theirs = plainAttributes(child);
          const change: Record<string, string | null> = {};
          if (moves) change.transform = transformValue(compose(matrix, parseTransform(theirs.get("transform") ?? "") ?? IDENTITY));
          for (const name of inherited) if (!theirs.has(name)) change[name] = own.get(name)!;
          if (fades) change.opacity = formatNumber((parseOpacity(theirs.get("opacity") ?? "") ?? 1) * alpha, OPACITY_PLACES);
          if (Object.keys(change).length > 0) plan.ops.push({ op: "set", id, attrs: change });
        }
      }
      plan.ops.push({ op: "move", target, parent, pos: { after: container } });
    }
    plan.ops.push({ op: "remove", target: container });
  }
  return { kept, freed };
}

/// Toglie i contenitori fra `units` che `unwraps` sceglie: vedi
/// [`unwrapIn`]. La selezione dopo sono i figli e gli altri oggetti scelti.
export function unwrapOps(model: DocumentModel, units: readonly Unit[], ids: NewIds, unwraps: (unit: Unit) => boolean): Arranged {
  const plan = new Plan(model, ids);
  const { kept, freed } = unwrapIn(plan, units, unwraps);
  if (plan.ops.length === 0) return { ops: [], keys: units.map((unit) => unit.key) };
  // Un oggetto rimasto scelto riceve un id: i figli portati fuori cambiano il
  // suo percorso.
  const named = kept.map((unit) => plan.idOf(nodeOf(model, unit)));
  return plan.finish([...named, ...freed]);
}

// ---------------------------------------------------------------------------
// Collegamenti.
// ---------------------------------------------------------------------------

/// Vero se `unit` è un collegamento: un `a`.
export function isLink(unit: Unit): boolean {
  return unit.tag === "a" && unit.role === "link";
}

/// Vero se `node` è un `a` o ne contiene uno.
export function holdsLink(node: ElementPart): boolean {
  if (node.facts.uri === SVG_NS && node.facts.local === "a") return true;
  return node.kind === "container" && elementChildren(node).some(holdsLink);
}

/// Vero se uno di `units` è un collegamento o ne contiene uno: attorno non
/// se ne crea un altro, che porterebbe in due posti.
export function holdsLinks(model: DocumentModel, units: readonly Unit[]): boolean {
  return units.some((unit) => holdsLink(nodeOf(model, unit)));
}

/// Un collegamento nuovo a `href` attorno a `units`, al posto del più alto e
/// nel suo livello, come un gruppo. `"nested"` se un oggetto è un
/// collegamento o ne contiene uno (vedi [`holdsLinks`]). `null` se il livello
/// del più alto schiaccia il piano.
export function linkOps(model: DocumentModel, units: readonly Unit[], href: string, ids: NewIds): Arranged | "nested" | null {
  if (holdsLinks(model, units)) return "nested";
  return wrapOps(model, units, ids, "a", { href });
}

/// Porta il collegamento `unit` a `href`. Un `xlink:href`, per i lettori di
/// SVG 1.1, cambia insieme a `href`; uno da solo resta solo.
export function relinkOps(model: DocumentModel, unit: Unit, href: string, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const node = nodeOf(model, unit);
  const now = hrefAttributes(node);
  const attrs: Record<string, string> = {};
  if (now.plain !== null || now.xlink === null) attrs.href = href;
  if (now.xlink !== null) attrs["xlink:href"] = href;
  if (now.plain === (attrs.href ?? null) && now.xlink === (attrs["xlink:href"] ?? null)) return { ops: [], keys: [unit.key] };
  const id = plan.idOf(node);
  plan.ops.push({ op: "set", id, attrs });
  return plan.finish([id]);
}

/// Toglie i collegamenti fra `units` che si tolgono: gli oggetti restano
/// dov'erano, come quelli di un gruppo che si separa (vedi [`unwrapOps`] e
/// [`unwrappable`]).
export function unlinkOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged {
  return unwrapOps(model, units, ids, (unit) => isLink(unit) && unwrappable(model, unit));
}

// ---------------------------------------------------------------------------
// Allineare e distribuire.
// ---------------------------------------------------------------------------

/// Unisce gli spostamenti di più oggetti, ognuno col suo.
function moves(list: ReadonlyArray<readonly [Unit, number, number]>, ids: NewIds): Arranged {
  const ops: Op[] = [];
  const keys: string[] = [];
  for (const [unit, dx, dy] of list) {
    const x = roundDelta(dx);
    const y = roundDelta(dy);
    if (x === 0 && y === 0) {
      keys.push(unit.key);
      continue;
    }
    const moved = moveOps([unit], x, y, ids);
    ops.push(...moved.ops);
    keys.push(...(moved.keys.length > 0 ? moved.keys : [unit.key]));
  }
  return { ops, keys };
}

/// Il riquadro che contiene `units`; `null` se nessuno disegna.
export function boundsOf(units: readonly Unit[]): Bounds | null {
  let out: Bounds | null = null;
  for (const unit of units) {
    const b = unit.bounds;
    if (b === null) continue;
    out = out === null ? b : { min: [Math.min(out.min[0], b.min[0]), Math.min(out.min[1], b.min[1])], max: [Math.max(out.max[0], b.max[0]), Math.max(out.max[1], b.max[1])] };
  }
  return out;
}

/// Allinea `units` al bordo o al centro `edge` di `reference`.
export function alignOps(units: readonly Unit[], edge: Edge, reference: Bounds, ids: NewIds): Arranged {
  const list = units.map((unit): readonly [Unit, number, number] => {
    const b = unit.bounds;
    if (b === null) return [unit, 0, 0];
    switch (edge) {
      case "left":
        return [unit, reference.min[0] - b.min[0], 0];
      case "center":
        return [unit, (reference.min[0] + reference.max[0] - b.min[0] - b.max[0]) / 2, 0];
      case "right":
        return [unit, reference.max[0] - b.max[0], 0];
      case "top":
        return [unit, 0, reference.min[1] - b.min[1]];
      case "middle":
        return [unit, 0, (reference.min[1] + reference.max[1] - b.min[1] - b.max[1]) / 2];
      case "bottom":
        return [unit, 0, reference.max[1] - b.max[1]];
    }
  });
  return moves(list, ids);
}

/// Distribuisce `units` lungo `axis` con lo stesso spazio fra uno e
/// l'altro: il primo e l'ultimo restano dove sono. Servono almeno tre
/// oggetti che disegnano.
export function distributeOps(units: readonly Unit[], axis: Axis, ids: NewIds): Arranged {
  const a = axis === "x" ? 0 : 1;
  const drawn = units.filter((unit) => unit.bounds !== null);
  if (drawn.length < 3) return { ops: [], keys: units.map((unit) => unit.key) };
  const sorted = [...drawn].sort((p, q) => p.bounds!.min[a] - q.bounds!.min[a] || p.bounds!.max[a] - q.bounds!.max[a]);
  const first = sorted[0]!.bounds!;
  const last = sorted[sorted.length - 1]!.bounds!;
  const inner = sorted.slice(1, -1);
  const sizes = inner.reduce((sum, unit) => sum + unit.bounds!.max[a] - unit.bounds!.min[a], 0);
  const gap = (last.min[a] - first.max[a] - sizes) / (sorted.length - 1);
  let at = first.max[a] + gap;
  const shifts = new Map<Unit, number>();
  for (const unit of inner) {
    shifts.set(unit, at - unit.bounds!.min[a]);
    at += unit.bounds!.max[a] - unit.bounds!.min[a] + gap;
  }
  const list = units.map((unit): readonly [Unit, number, number] => {
    const shift = shifts.get(unit) ?? 0;
    return axis === "x" ? [unit, shift, 0] : [unit, 0, shift];
  });
  return moves(list, ids);
}
