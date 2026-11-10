// La classificazione della scena: le ripetizioni, l'indice delle risorse e
// degli stili, e il giudizio di un figlio, modificabile o estraneo, con la
// geometria che ne decide il ruolo (`../classify.ts`).

import { isContainer, type Role } from "../analysis";
import { readConnectorEnd, readConnectorGeom, type ConnectorEnd, type ConnectorGeom } from "../connectors";
import { readRepeat, type Repeat } from "../repeat";
import { readPolygonal, type Polygonal } from "../parametric";
import { readVarWidth, type VarWidth } from "../varwidth";
import { numberList, paint, viewBox, type Rgb } from "../values";
import { NS_FUB, NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../xml";
import { MAX_DEPTH, NO_RESOURCES, type Place, type Resolve, RESOURCE_TAGS, type ResourceKind, resourceKind, type ResourceTag, type StyleFacts, type Tag } from "./types";
import { allowedPart, attributesAllowed, characterDataOnly, tagOf, unitChildrenAllowed } from "./attributes";
import { styleKindOf, swatchOf } from "./facts";
import { COPY_ATTRIBUTES, defsAllowed, INSTANCE_ATTRIBUTES, pathResourceAllowed, referencesOf, resourceAllowed, styleAllowed, symbolAllowed, useAllowed } from "./resources";

// ---------------------------------------------------------------------------
// Le ripetizioni (formato della scena, ripetizioni).
// ---------------------------------------------------------------------------

/// La ripetizione di `element`, se `fub:repeat` si legge. Vale per un `g`
/// che è un gruppo, non un livello: lo sa chi lo classifica.
export function repeatOf(element: ElementNode): Repeat | null {
  const value = valueOf(element, NS_FUB, "repeat");
  return value === undefined ? null : readRepeat(value);
}

/// Gli originali fra i figli di `parent`, una ripetizione: gli id dei figli
/// modificabili, titoli e descrizioni esclusi. `depth` è la profondità dei
/// figli, e `resolve`, che non conosce gli originali, dice che cosa è ogni id
/// a cui rimandano: un'istanza di un simbolo può essere un originale, una
/// copia no.
export function originalsOf(doc: XmlDocument, parent: NodeId, depth: number, resolve: Resolve): Set<string> {
  const out = new Set<string>();
  for (const child of doc.children(parent)) {
    const element = doc.element(child);
    if (element === null) continue;
    const id = valueOf(element, NS_NONE, "id");
    if (id === undefined || id === "") continue;
    const found = classifyChild(doc, child, "inside", depth, resolve);
    if (found !== null && found[1] !== "title" && found[1] !== "desc") out.add(id);
  }
  return out;
}

/// `resolve` con gli originali `originals`, per i figli di una ripetizione:
/// un id che una risorsa porta resta suo.
export function withOriginals(resolve: Resolve, originals: ReadonlySet<string>): Resolve {
  return originals.size === 0 ? resolve : (id) => resolve(id) ?? (originals.has(id) ? "original" : null);
}

/// Gli id a cui rimanda `element` con ciò che contiene, una volta ciascuno.
export function referencesWithin(doc: XmlDocument, element: ElementNode): Set<string> {
  const out = new Set<string>();
  const stack: ElementNode[] = [element];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const id of referencesOf(at)) out.add(id);
    for (let i = at.children.length - 1; i >= 0; i--) {
      const child = doc.element(at.children[i]!);
      if (child !== null) stack.push(child);
    }
  }
  return out;
}

/// I simboli fra `candidates`, `symbol` con gli attributi di
/// [`symbolAllowed`]: quelli che non contengono sé stessi, nemmeno
/// attraverso altri candidati. Un id che `taken` dice già preso, o di un
/// candidato precedente, non è un simbolo. Restituisce gli id, in ordine.
///
/// Gli archi sono i riferimenti, `url(#id)` o `href="#id"`, che il contenuto
/// di un candidato fa ad altri candidati; un candidato su un ciclo, o che
/// rimanda a sé, non è un simbolo. Le componenti fortemente connesse si
/// cercano con Tarjan, senza ricorsione: una catena di simboli può essere
/// lunga quanto il file.
export function acyclicSymbols(doc: XmlDocument, candidates: readonly ElementNode[], taken: (id: string) => boolean): string[] {
  const ids: string[] = [];
  const index = new Map<string, number>();
  const elements: ElementNode[] = [];
  for (const element of candidates) {
    if (!symbolAllowed(element)) continue;
    const id = valueOf(element, NS_NONE, "id")!;
    if (taken(id) || index.has(id)) continue;
    index.set(id, ids.length);
    ids.push(id);
    elements.push(element);
  }
  const edges = elements.map((element) => {
    const out: number[] = [];
    for (const ref of referencesWithin(doc, element)) {
      const to = index.get(ref);
      if (to !== undefined) out.push(to);
    }
    return out;
  });
  const order = new Array<number>(ids.length).fill(-1);
  const low = new Array<number>(ids.length).fill(0);
  const onStack = new Array<boolean>(ids.length).fill(false);
  const cyclic = new Array<boolean>(ids.length).fill(false);
  const stack: number[] = [];
  let counter = 0;
  for (let root = 0; root < ids.length; root++) {
    if (order[root] !== -1) continue;
    const frames: Array<[node: number, next: number]> = [[root, 0]];
    order[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const [node, next] = frame;
      if (next < edges[node]!.length) {
        frame[1]++;
        const to = edges[node]![next]!;
        if (to === node) cyclic[node] = true;
        if (order[to] === -1) {
          order[to] = low[to] = counter++;
          stack.push(to);
          onStack[to] = true;
          frames.push([to, 0]);
        } else if (onStack[to]) {
          low[node] = Math.min(low[node]!, order[to]!);
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) low[parent[0]] = Math.min(low[parent[0]]!, low[node]!);
      if (low[node] !== order[node]) continue;
      const component: number[] = [];
      for (;;) {
        const member = stack.pop()!;
        onStack[member] = false;
        component.push(member);
        if (member === node) break;
      }
      if (component.length > 1) for (const member of component) cyclic[member] = true;
    }
  }
  return ids.filter((_, k) => !cyclic[k]);
}

/// I simboli fra gli elementi `ids` di `doc`, che entrano insieme in una
/// `defs` della radice: per chi li legge prima di aggiungerli, con le
/// risorse che `resolve` conosce già. Un id che `resolve` conosce resta
/// suo.
export function localSymbols(doc: XmlDocument, ids: readonly NodeId[], resolve: Resolve): Map<string, ResourceKind> {
  const candidates: ElementNode[] = [];
  for (const id of ids) {
    const element = doc.element(id);
    if (element !== null && tagOf(element) === "symbol") candidates.push(element);
  }
  const found = new Map<string, ResourceKind>();
  if (candidates.length === 0) return found;
  for (const id of acyclicSymbols(doc, candidates, (id) => resolve(id) !== null)) found.set(id, "symbol");
  return found;
}

/// `resolve` coi simboli fra gli elementi `ids` di `doc`, come
/// [`localSymbols`].
export function withLocalSymbols(doc: XmlDocument, ids: readonly NodeId[], resolve: Resolve): Resolve {
  const local = localSymbols(doc, ids, resolve);
  return local.size === 0 ? resolve : (id) => local.get(id) ?? resolve(id);
}

/// `resolve` coi simboli che arrivano con gli elementi `ids` di `doc`, che
/// entrano in un contenitore in `place`: loro stessi in una `defs`, i figli
/// delle loro `defs` nella radice.
export function withArrivingSymbols(doc: XmlDocument, ids: readonly NodeId[], place: Place, resolve: Resolve): Resolve {
  if (place === "defs") return withLocalSymbols(doc, ids, resolve);
  if (place === "inside") return resolve;
  const inner: NodeId[] = [];
  for (const id of ids) {
    const element = doc.element(id);
    if (element !== null && tagOf(element) === "defs") inner.push(...doc.children(id));
  }
  return inner.length === 0 ? resolve : withLocalSymbols(doc, inner, resolve);
}

/// L'indice delle risorse modificabili del documento: per ogni id, il tipo
/// della risorsa (formato della scena, risorse). Prima le sfumature e i
/// tracciati, che non rimandano a niente, poi le altre, che nel contenuto
/// possono usare le sfumature. Di due risorse con lo stesso id vale la prima,
/// in quest'ordine: il documento è comunque in sola lettura (S003).
export function resourceIndex(doc: XmlDocument): Map<string, ResourceKind> {
  return indexResources(doc).kinds;
}

/// Gli stili del documento, per id: il tipo di ognuno (formato della scena,
/// stili).
export type Styles = ReadonlyMap<string, StyleFacts["kind"]>;

/// Le risorse modificabili di un documento: il tipo di ognuna, il `d` dei
/// tracciati, il colore dei campioni e il tipo degli stili.
export interface Resources {
  readonly kinds: Map<string, ResourceKind>;
  readonly paths: Map<string, string>;
  readonly swatches: Map<string, Rgb>;
  readonly styles: Map<string, StyleFacts["kind"]>;
}

/// Gli stili modificabili del documento, per id: di due con lo stesso id, o
/// di uno stile con l'id di una risorsa, vale il primo, come per le risorse.
export function styleIndex(doc: XmlDocument): Styles {
  return indexResources(doc).styles;
}

export function indexResources(doc: XmlDocument): Resources {
  const kinds = new Map<string, ResourceKind>();
  const paths = new Map<string, string>();
  const swatches = new Map<string, Rgb>();
  const styles = new Map<string, StyleFacts["kind"]>();
  const others: Array<[ElementNode, ResourceTag]> = [];
  const prototypes: Array<[ElementNode, Tag]> = [];
  const symbols: ElementNode[] = [];
  const judge = (element: ElementNode, tag: ResourceTag | "path", resolve: Resolve): void => {
    const id = valueOf(element, NS_NONE, "id");
    if (id === undefined || kinds.has(id)) return;
    if (tag === "path" ? !pathResourceAllowed(doc, element) : !resourceAllowed(doc, element, tag, resolve)) return;
    kinds.set(id, resourceKind(tag)!);
    if (tag === "path") paths.set(id, valueOf(element, NS_NONE, "d")!);
    const swatch = valueOf(element, NS_FUB, "role") === "swatch" ? swatchOf(doc, element) : null;
    const color = swatch === null ? null : paint(swatch.color);
    if (color !== null && color !== "none") swatches.set(id, color);
  };
  for (const child of doc.children(doc.root)) {
    const defs = doc.element(child);
    if (defs === null || tagOf(defs) !== "defs" || !defsAllowed(defs)) continue;
    for (const inner of defs.children) {
      const element = doc.element(inner);
      const tag = element === null ? null : tagOf(element);
      if (element === null || tag === null) continue;
      if (styleKindOf(tag) !== null && valueOf(element, NS_FUB, "role") === "style") prototypes.push([element, tag]);
      if (tag === "symbol") symbols.push(element);
      if (tag !== "path" && !RESOURCE_TAGS.has(tag)) continue;
      if (tag === "linearGradient" || tag === "radialGradient" || tag === "path") judge(element, tag, NO_RESOURCES);
      else others.push([element, tag as ResourceTag]);
    }
  }
  const first: Resolve = (id) => kinds.get(id) ?? null;
  for (const [element, tag] of others) judge(element, tag, first);
  // I simboli dopo le altre risorse, che il loro contenuto usa: un id già
  // preso resta della risorsa.
  for (const id of acyclicSymbols(doc, symbols, (id) => kinds.has(id))) kinds.set(id, "symbol");
  // Gli stili per ultimi: usano ogni altra risorsa, e nessuno li usa.
  for (const [element, tag] of prototypes) {
    const id = valueOf(element, NS_NONE, "id");
    if (id === undefined || kinds.has(id) || styles.has(id) || !styleAllowed(doc, element, tag, first)) continue;
    styles.set(id, styleKindOf(tag)!);
  }
  return { kinds, paths, swatches, styles };
}

/// Le sfumature modificabili fra i figli di `parent`, per un `add` di più
/// risorse in una `defs`: il contenuto di un motivo che le segue le usa.
export function localGradients(doc: XmlDocument, parent: NodeId): Map<string, ResourceKind> {
  const found = new Map<string, ResourceKind>();
  for (const child of doc.children(parent)) {
    const element = doc.element(child);
    const tag = element === null ? null : tagOf(element);
    if (element === null || (tag !== "linearGradient" && tag !== "radialGradient")) continue;
    const id = valueOf(element, NS_NONE, "id");
    if (id !== undefined && !found.has(id) && resourceAllowed(doc, element, tag, NO_RESOURCES)) found.set(id, "gradient");
  }
  return found;
}

export const UNIT_ROLES: Readonly<Partial<Record<Tag, Role>>> = {
  rect: "rect",
  ellipse: "ellipse",
  circle: "circle",
  line: "line",
  polyline: "polyline",
  polygon: "polygon",
  text: "text",
  image: "image",
};

/// Il ruolo di un figlio di un contenitore, o `null` se è estraneo. `place`
/// dice dov'è il contenitore: la radice decide livelli, carta e `defs`, una
/// `defs` della radice le risorse. `depth` è la lunghezza del percorso del
/// figlio, che per un contenitore oltre [`MAX_DEPTH`] lo rende estraneo.
/// `resolve` dice che cosa è la risorsa di ogni id a cui l'elemento rimanda.
export function classifyChild(doc: XmlDocument, id: NodeId, place: Place, depth: number, resolve: Resolve = NO_RESOURCES): [Tag, Role] | null {
  const found = classify(doc, id, place, resolve);
  // Un contenitore oltre la profondità massima è un'unità.
  return found !== null && isContainer(found[1]) && depth > MAX_DEPTH ? null : found;
}

export function classify(doc: XmlDocument, id: NodeId, place: Place, resolve: Resolve): [Tag, Role] | null {
  const element = doc.element(id);
  if (element === null) return null;
  const tag = tagOf(element);
  if (tag === null) return null;
  if (tag === "defs") return place === "root" && defsAllowed(element) ? [tag, "defs"] : null;
  if (RESOURCE_TAGS.has(tag)) {
    return place === "defs" && resourceAllowed(doc, element, tag as ResourceTag, resolve) ? [tag, "resource"] : null;
  }
  // Un `path` in una `defs` è il tracciato di un testo (formato della scena,
  // testo).
  if (tag === "path" && place === "defs") return pathResourceAllowed(doc, element) ? [tag, "resource"] : null;
  // Un `text` o una `polyline` con `fub:role="style"` in una `defs` è uno
  // stile (formato della scena, stili).
  if (place === "defs" && styleKindOf(tag) !== null && valueOf(element, NS_FUB, "role") === "style") {
    return styleAllowed(doc, element, tag, resolve) ? [tag, "resource"] : null;
  }
  // Un simbolo sta in una `defs` della radice, e l'indice delle risorse sa
  // se contiene sé stesso (formato della scena, simboli).
  if (tag === "symbol") {
    const symbol = valueOf(element, NS_NONE, "id");
    return place === "defs" && symbol !== undefined && resolve(symbol) === "symbol" && symbolAllowed(element) ? [tag, "symbol"] : null;
  }
  // In una `defs` stanno solo risorse, stili, simboli, titolo e
  // descrizione.
  if (place === "defs" && tag !== "title" && tag !== "desc") return null;
  // Una tavola è un `view` della radice (formato della scena, tavole).
  if (tag === "view") return place === "root" && boardAllowed(doc, element, resolve) ? [tag, "board"] : null;
  if (tag === "use") {
    if (useAllowed(doc, element, resolve, "symbol", INSTANCE_ATTRIBUTES)) return [tag, "instance"];
    // Una copia sta fra i figli di una ripetizione, dove `resolve` conosce
    // gli originali (formato della scena, ripetizioni).
    return useAllowed(doc, element, resolve, "original", COPY_ATTRIBUTES) ? [tag, "copy"] : null;
  }
  if (!attributesAllowed(element, tag, resolve)) return null;
  const underRoot = place === "root";
  switch (tag) {
    case "g":
      return [tag, underRoot && valueOf(element, NS_FUB, "layer") !== undefined ? "layer" : "group"];
    case "a":
      return [tag, "link"];
    case "title":
    case "desc":
      return characterDataOnly(doc, element) ? [tag, tag] : null;
    case "tspan":
    case "textPath":
      return null;
    default: {
      if (!unitChildrenAllowed(doc, element, tag, resolve)) return null;
      if (tag === "path") return [tag, pathRole(element)];
      if (tag === "rect" && underRoot && valueOf(element, NS_FUB, "role") === "paper") return [tag, "paper"];
      return [tag, UNIT_ROLES[tag]!];
    }
  }
}

/// Vero se `element`, un `view` della radice, è una tavola (formato della
/// scena, tavole): `fub:role="board"`, un id, un `viewBox` largo e alto più di
/// zero, nessun altro attributo SVG e per figli soltanto titoli e
/// descrizioni.
export function boardAllowed(doc: XmlDocument, element: ElementNode, resolve: Resolve): boolean {
  if (valueOf(element, NS_FUB, "role") !== "board" || !valueOf(element, NS_NONE, "id")) return false;
  if (boardBox(element) === null) return false;
  const attributes = element.attrs.every((attr) => {
    switch (attr.ns) {
      case NS_NONE:
        return attr.local === "id" || attr.local === "viewBox";
      case NS_SVG:
      case NS_XLINK:
        return false;
      default:
        return true;
    }
  });
  return attributes && element.children.every((child) => {
    const node = doc.nodes[child]!;
    if (node.kind === "text") return node.blank;
    return node.kind === "element" && allowedPart(doc, child, false, resolve);
  });
}

/// Il rettangolo di una tavola, dal suo `viewBox`, se è largo e alto più di
/// zero.
export function boardBox(element: ElementNode): [number, number, number, number] | null {
  const value = valueOf(element, NS_NONE, "viewBox");
  const box = value === undefined ? null : viewBox(value);
  return box !== null && box[2] > 0 && box[3] > 0 ? box : null;
}

/// Il ruolo di un `path`: tratto, freccia o tracciato.
export function pathRole(element: ElementNode): Role {
  const tool = valueOf(element, NS_FUB, "tool");
  if (tool === "pen" || tool === "highlighter") return "stroke";
  // Uno strumento sconosciuto, o una forma sconosciuta, lasciano un
  // tracciato: la geometria si legge da `d` (§6).
  const shape = valueOf(element, NS_FUB, "shape");
  if (shape === "arrow" && arrowGeometry(element) !== null) return "arrow";
  if (shape === "connector" && connectorGeometry(element) !== null) return "connector";
  if (polygonalGeometry(element) !== null) return shape === "star" ? "star" : "ngon";
  if (widthGeometry(element) !== null) return "width";
  return "path";
}

/// `fub:geom` di un poligono regolare o di una stella, se si legge.
export function polygonalGeometry(element: ElementNode): Polygonal | null {
  const shape = valueOf(element, NS_FUB, "shape");
  const geom = valueOf(element, NS_FUB, "geom");
  if (geom === undefined || (shape !== "polygon" && shape !== "star")) return null;
  return readPolygonal(shape, geom);
}

/// `fub:geom` di un contorno a spessore variabile, se si legge.
export function widthGeometry(element: ElementNode): VarWidth | null {
  const geom = valueOf(element, NS_FUB, "geom");
  return geom === undefined || valueOf(element, NS_FUB, "shape") !== "width" ? null : readVarWidth(geom);
}

/// `fub:geom` di un connettore, se si legge.
export function connectorGeometry(element: ElementNode): ConnectorGeom | null {
  const geom = valueOf(element, NS_FUB, "geom");
  return geom === undefined ? null : readConnectorGeom(geom);
}

/// Un capo di un connettore, `fub:from` o `fub:to`, se si legge.
export function connectorEnd(element: ElementNode, name: "from" | "to"): ConnectorEnd | null {
  const value = valueOf(element, NS_FUB, name);
  return value === undefined ? null : readConnectorEnd(value);
}

/// `fub:geom` di una freccia: quattro numeri SVG.
export function arrowGeometry(element: ElementNode): [number, number, number, number] | null {
  const geom = valueOf(element, NS_FUB, "geom");
  const numbers = geom === undefined ? null : numberList(geom);
  return numbers !== null && numbers.length === 4 ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!] : null;
}
