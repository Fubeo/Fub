// I simboli nell'editor (Disegni, simboli; formato della scena, simboli):
// leggere i simboli del disegno, crearne uno dalla selezione e scollegare
// un'istanza. Ogni comando diventa un `batch` solo, come quelli di
// `arrange.ts`.
//
// - **Crea simbolo** sposta gli oggetti scelti, com'erano scritti, nel
//   contenuto di un simbolo nuovo della `defs`, e al loro posto, dov'era il
//   più alto, mette un'istanza. L'origine del simbolo è il centro del
//   riquadro che si vede, a numeri interi: l'istanza ci porta il contenuto,
//   e il disegno resta com'era. Gli oggetti di un altro livello vi entrano
//   con la trasformazione che li lascia dov'erano, come in un gruppo.
// - **Gli agganci restano veri.** Un connettore fuori dal simbolo agganciato
//   a un oggetto che vi entra si aggancia all'istanza, se un capo solo vi
//   entra; dentro, un capo agganciato a ciò che resta fuori si stacca, come
//   un'etichetta che resta da una parte senza il suo connettore o la sua
//   forma.
// - **Scollega** mette al posto di ogni istanza un gruppo con una copia del
//   contenuto del simbolo, con id nuovi, la trasformazione, l'opacità e gli
//   effetti dell'istanza, e il suo nome o quello del simbolo. Le risorse
//   private del contenuto si copiano come per un duplicato; i connettori
//   agganciati all'istanza si agganciano al gruppo. Un contenuto con parti
//   estranee non si copia, e non si scollega.
// - **Scambia** dà alle istanze scelte un altro simbolo, al posto e con la
//   trasformazione che hanno; un simbolo che conterrebbe sé stesso non si
//   sceglie. **Rinomina** cambia il `title` del simbolo, come per un
//   oggetto, e due simboli non hanno lo stesso nome.

import type { Bounds } from "../scene/geometry";
import { apply, compose, invert, translate } from "../scene/matrix";
import { elementChildren, pathOf, titleOf, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import type { AddOp, Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { elemOf, fubAttributes, nodeOf, Plan, renamed, type Arranged } from "./arrange";
import { isLinkName, relinkCopies, relinked } from "./connector-copies";
import { transformValue, type NewIds } from "./edit";
import type { Unit } from "./hit";
import { cleanName, NAME_MAX, nameKey, nameOps } from "./naming";
import { homeOf, ResourceCopies } from "./resources";

/// Un simbolo del disegno: l'id, il nome, il nodo e da dove viene.
export interface DocumentSymbol {
  readonly id: string;
  /// Il primo `title`; vuoto senza.
  readonly name: string;
  readonly node: ContainerNode;
  /// `fub:source`, com'è scritto; `null` senza.
  readonly source: string | null;
}

/// I simboli del disegno `model`, in ordine di documento.
export function documentSymbols(model: DocumentModel): DocumentSymbol[] {
  const out: DocumentSymbol[] = [];
  for (const defs of elementChildren(model.root)) {
    if (defs.kind !== "container" || defs.details?.role !== "defs") continue;
    for (const child of elementChildren(defs)) {
      if (child.kind !== "container" || child.details?.role !== "symbol" || child.facts.id === null) continue;
      out.push({ id: child.facts.id, name: titleOf(child) ?? "", node: child, source: child.details.source ?? null });
    }
  }
  return out;
}

/// Il simbolo di id `id` di `model`; `null` se non c'è.
export function symbolNode(model: DocumentModel, id: string): ContainerNode | null {
  return documentSymbols(model).find((symbol) => symbol.id === id)?.node ?? null;
}

/// Vero se `unit` è un'istanza di un simbolo.
export function isInstance(unit: Unit): boolean {
  return unit.role === "instance";
}

/// Il simbolo di cui `node` è un'istanza; `null` se non lo è.
export function instanceSymbol(model: DocumentModel, node: ElementPart): DocumentSymbol | null {
  if (node.kind !== "leaf" || node.details?.role !== "instance") return null;
  return documentSymbols(model).find((symbol) => symbol.id === node.details!.symbol) ?? null;
}

/// Il primo nome libero da `base` fra i simboli di `model`, pulito come
/// ogni nome: lui, poi `base 2`, `base 3` e così via. Due nomi uguali senza
/// badare alle maiuscole sono lo stesso.
export function freshSymbolName(model: DocumentModel, base: string): string {
  return freeSymbolName(new Set(documentSymbols(model).map((symbol) => nameKey(symbol.name))), base);
}

/// Il primo nome libero da `base` fuori da `taken`, le chiavi dei nomi presi
/// ([`nameKey`]): come [`freshSymbolName`], per chi conta anche i simboli
/// che stanno arrivando.
export function freeSymbolName(taken: ReadonlySet<string>, base: string): string {
  const clean = cleanName(base);
  if (!taken.has(nameKey(clean))) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${Array.from(clean).slice(0, NAME_MAX - suffix.length).join("").trimEnd()}${suffix}`;
    if (!taken.has(nameKey(name))) return name;
  }
}

/// Perché `name`, già pulito, non va come nome del simbolo `except`: è
/// vuoto, o un altro simbolo si chiama già così. `null` se va.
export function symbolNameProblem(model: DocumentModel, name: string, except: string | null = null): "empty" | "taken" | null {
  if (name === "") return "empty";
  const key = nameKey(name);
  return documentSymbols(model).some((symbol) => symbol.id !== except && nameKey(symbol.name) === key) ? "taken" : null;
}

/// Le operazioni che danno al simbolo `symbol` il nome `name`, già pulito:
/// il suo primo `title`, come per un oggetto. `"foreign"` se il simbolo ha
/// nomi che un'operazione non sa scrivere.
export function renameSymbolOps(model: DocumentModel, symbol: DocumentSymbol, name: string, ids: NewIds): Arranged | "foreign" {
  return nameOps(model, { path: pathOf(symbol.node) }, name, ids);
}

/// Quante istanze ha ogni simbolo di `model`, per id, dovunque stiano:
/// anche nel contenuto di un altro simbolo.
export function instanceCounts(model: DocumentModel): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: ElementPart): void => {
    const details = node.details;
    if (details?.role === "instance" && details.symbol !== undefined) counts.set(details.symbol, (counts.get(details.symbol) ?? 0) + 1);
    if (node.kind === "container") for (const child of elementChildren(node)) visit(child);
  };
  visit(model.root);
  return counts;
}

/// I simboli che `units` non possono avere: quelli nel cui contenuto sta
/// uno di loro, anche attraverso altri simboli, e quelli che li usano. Un
/// simbolo così conterrebbe sé stesso.
export function cyclingSymbols(model: DocumentModel, units: readonly Unit[]): Set<string> {
  // Chi usa ogni simbolo: i simboli che hanno una sua istanza nel contenuto.
  const users = new Map<string, Set<string>>();
  const visit = (node: ElementPart, within: string | null): void => {
    const details = node.details;
    if (details?.role === "instance" && details.symbol !== undefined && within !== null) {
      let set = users.get(details.symbol);
      if (set === undefined) users.set(details.symbol, (set = new Set()));
      set.add(within);
    }
    if (node.kind === "container") for (const child of elementChildren(node)) visit(child, details?.role === "symbol" ? node.facts.id : within);
  };
  visit(model.root, null);
  const out = new Set<string>();
  const queue: string[] = [];
  for (const unit of units) {
    for (let at: ElementPart | null = unit.node.parent; at !== null; at = at.parent) {
      if (at.details?.role === "symbol" && at.facts.id !== null) queue.push(at.facts.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const user of users.get(id) ?? []) queue.push(user);
  }
  return out;
}

/// Le operazioni che danno alle istanze fra `units` il simbolo `id`, al
/// posto e con la trasformazione che hanno: soltanto `href`, che sostituisce
/// un `xlink:href`. La selezione resta.
export function swapOps(model: DocumentModel, units: readonly Unit[], id: string, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  for (const unit of units) {
    const node = nodeOf(model, unit);
    if (!isInstance(unit) || node.details?.symbol === id) continue;
    const attrs: Record<string, string | null> = { href: `#${id}` };
    if (elemOf(node)?.attrs["xlink:href"] !== undefined) attrs["xlink:href"] = null;
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs });
  }
  return plan.finish(units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key)));
}

/// Perché «Crea simbolo» non si fa: niente che si veda, o il livello del più
/// alto schiaccia il piano.
export type SymbolRefusal = "empty" | "flat";

/// Un simbolo creato: le operazioni, la selezione dopo, che è l'istanza, e
/// l'id e il nome del simbolo.
export interface SymbolMade extends Arranged {
  readonly id: string;
  readonly name: string;
  readonly instance: string;
}

/// «Crea simbolo» con `units`, col primo nome libero da `base`: vedi
/// l'intestazione.
export function symbolOps(model: DocumentModel, units: readonly Unit[], base: string, ids: NewIds): SymbolMade | SymbolRefusal {
  const ordered = [...units].sort((a, b) => comparePaths(a.path, b.path));
  const top = ordered[ordered.length - 1];
  const seen = top === undefined ? null : visibleBounds(ordered);
  if (top === undefined || seen === null) return "empty";
  const inverse = invert(top.parent);
  if (inverse === null) return "flat";
  const [x, y] = apply(inverse, [(seen.min[0] + seen.max[0]) / 2, (seen.min[1] + seen.max[1]) / 2]);
  const place = translate(Math.round(x), Math.round(y));
  const back = invert(compose(top.parent, place))!;
  const plan = new Plan(model, ids);
  const id = ids.next("resource");
  const name = freshSymbolName(model, base);
  const instance = ids.next("object");
  const home = homeOf(model);
  plan.ops.push(...home.prelude, {
    op: "add",
    parent: home.parent,
    pos: { last: true },
    elem: { tag: "symbol", attrs: { id, overflow: "visible" }, children: [{ tag: "title", attrs: {}, text: name }] },
  });
  const topNode = nodeOf(model, top);
  const use: Record<string, string> = { id: instance };
  const at = transformValue(place);
  if (at !== null) use.transform = at;
  use.href = `#${id}`;
  plan.ops.push({ op: "add", parent: plan.parentOf(topNode), pos: { after: plan.idOf(topNode) }, elem: { tag: "use", attrs: use } });
  const roots = new Set<ElementPart>();
  const moves: Op[] = [];
  for (const unit of ordered) {
    const node = nodeOf(model, unit);
    roots.add(node);
    const unitId = plan.idOf(node);
    const next = transformValue(compose(back, unit.matrix));
    if (next !== transformValue(unit.transform)) moves.push({ op: "set", id: unitId, attrs: { transform: next } });
    moves.push({ op: "move", target: unitId, parent: id, pos: { last: true } });
  }
  const inside = (node: ElementPart): boolean => {
    for (let at: ElementPart | null = node; at !== null; at = at.parent) if (roots.has(at)) return true;
    return false;
  };
  const enters = new Set<string>();
  for (const root of roots) collectIds(root, enters);
  relinkAll(model, plan, (node, name, target) => {
    const from = inside(node);
    if (from === enters.has(target)) return target;
    // Un capo di fuori si aggancia all'istanza; il resto si stacca.
    return !from && (name === "from" || name === "to") ? instance : null;
  });
  plan.ops.push(...moves);
  return { ...plan.finish([instance]), id, name, instance };
}

/// Perché «Scollega» non si fa: il contenuto di un simbolo ha parti che
/// un'operazione non sa copiare.
export type DetachRefusal = "content";

/// «Scollega» le istanze fra `units`: vedi l'intestazione. Le altre restano
/// scelte com'erano.
export function detachOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Arranged | DetachRefusal {
  const plan = new Plan(model, ids);
  const copies = new ResourceCopies(model, ids, elemOf);
  const adds: AddOp[] = [];
  const removes: Op[] = [];
  const groups = new Map<string, string>();
  const keys: string[] = [];
  for (const unit of units) {
    const node = nodeOf(model, unit);
    const symbol = instanceSymbol(model, node);
    const own = symbol === null ? null : elemOf(node);
    if (symbol === null || own === null) {
      if (symbol !== null) return "content";
      keys.push(unit.key);
      continue;
    }
    const made = new Map<string, string>();
    const content: Elem[] = [];
    for (const child of elementChildren(symbol.node)) {
      const role = child.details?.role;
      if (role === "title" || role === "desc") continue;
      const elem = elemOf(child);
      const copy = elem === null ? null : copies.adopt(renamed(elem, ids, made));
      if (copy === null) return "content";
      content.push(copy);
    }
    const group = ids.next("object");
    const attrs: Record<string, string> = { id: group };
    for (const [name, value] of Object.entries(own.attrs)) if (name !== "id" && name !== "href" && name !== "xlink:href") attrs[name] = value;
    const named = (own.children ?? []).filter((child) => child.tag === "title" || child.tag === "desc");
    const title: Elem[] = named.some((child) => child.tag === "title") || symbol.name === "" ? [] : [{ tag: "title", attrs: {}, text: symbol.name }];
    const instanceId = plan.idOf(node);
    adds.push({ op: "add", parent: plan.parentOf(node), pos: { after: instanceId }, elem: { tag: "g", attrs, children: [...title, ...named, ...relinkCopies(content, made)] } });
    removes.push({ op: "remove", target: instanceId });
    groups.set(instanceId, group);
    keys.push(group);
  }
  if (groups.size === 0) return { ops: [], keys: units.map((unit) => unit.key) };
  plan.ops.push(...copies.ops(), ...adds, ...removes);
  relinkAll(model, plan, (_node, _name, target) => groups.get(target) ?? target);
  return plan.finish(keys);
}

/// Riscrive, nel piano `plan`, i riferimenti dei connettori e delle
/// etichette di tutto `model`: `next` dice per l'elemento, il nome e l'id a
/// cui rimanda l'id nuovo, lo stesso se non cambia, o `null` per togliere il
/// riferimento.
function relinkAll(model: DocumentModel, plan: Plan, next: (node: ElementPart, name: "from" | "to" | "along" | "inside", target: string) => string | null): void {
  const visit = (container: ContainerNode): void => {
    for (const child of elementChildren(container)) {
      if (child.details === null) continue;
      if (child.kind === "container") visit(child);
      const attrs: Record<string, string | null> = {};
      for (const [local, value] of fubAttributes(child)) {
        if (!isLinkName(local)) continue;
        const written = relinked(local, value, (target) => next(child, local, target));
        if (written !== value) attrs[`fub:${local}`] = written;
      }
      // Un connettore coi due capi sull'istanza non unirebbe niente: si
      // stacca.
      if (attrs["fub:from"] !== undefined && attrs["fub:from"] !== null && attrs["fub:from"] === attrs["fub:to"]) {
        attrs["fub:from"] = null;
        attrs["fub:to"] = null;
      }
      if (Object.keys(attrs).length > 0) plan.ops.push({ op: "set", id: plan.idOf(child), attrs });
    }
  };
  visit(model.root);
}

/// Gli id di `node` e di ciò che contiene, in `out`.
function collectIds(node: ElementPart, out: Set<string>): void {
  if (node.facts.id !== null) out.add(node.facts.id);
  if (node.kind === "container") for (const child of elementChildren(node)) collectIds(child, out);
}

/// Il riquadro che si vede di `units`, contorno compreso; `null` se non si
/// vede niente.
function visibleBounds(units: readonly Unit[]): Bounds | null {
  let out: Bounds | null = null;
  for (const unit of units) {
    const box = unit.bounds;
    if (box === null) continue;
    out = out === null ? box : { min: [Math.min(out.min[0], box.min[0]), Math.min(out.min[1], box.min[1])], max: [Math.max(out.max[0], box.max[0]), Math.max(out.max[1], box.max[1])] };
  }
  return out;
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
