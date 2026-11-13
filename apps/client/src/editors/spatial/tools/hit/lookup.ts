// La visita di un oggetto per trovarne le unità, dentro le risorse e i simboli
// di una scena, con i suoi aiuti sui percorsi e sui figli.

import { compose, IDENTITY, type Matrix } from "../../scene/matrix";
import {
  elementChildren,
  type ContainerNode,
  type DocumentModel,
  type ElementPart,
  type LeafNode,
} from "../../scene/model";
import type { PaintAttr } from "../../painter/paint";
import { Clip } from "../clips";
import type { Style } from "./base";
import { hidden, styleOf, transformOf } from "./shapes";
import type { Nested, Unit } from "./unit";

/// Dove stanno i figli di un contenitore: il suo percorso, il livello, la
/// matrice dalle sue coordinate a quelle della scena, lo stile che trasmette
/// e i ritagli e le maschere suoi e di chi lo contiene.
interface Context {
  readonly path: readonly number[];
  readonly layer: string | null;
  readonly matrix: Matrix;
  readonly style: Style;
  readonly clips: readonly Clip[] | null;
}

type MakeUnit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null) => Unit | null;

/// Aggiunge a `outer` i ritagli e le maschere di un contenitore: il nodo, i
/// suoi attributi dipinti, la matrice dalle sue coordinate a quelle della
/// scena e lo stile che trasmette.
type AddClips = (node: ElementPart, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, outer: readonly Clip[] | null) => readonly Clip[] | null;

/// Trova gli oggetti dentro i gruppi di un documento, per un indice: con
/// `scope` solo quelli dentro il gruppo isolato.
export class Lookup implements Nested {
  private ids: Map<string, ElementPart> | null = null;
  private readonly contexts = new Map<ContainerNode, Context | null>();

  constructor(
    private readonly model: DocumentModel,
    readonly scope: ContainerNode | null,
    /// Le istanze da cui si entra nei simboli, dalla più esterna.
    private readonly through: readonly LeafNode[],
    private readonly rootStyle: Style,
    private readonly attrsOf: (node: ElementPart) => readonly PaintAttr[] | null,
    private readonly make: MakeUnit,
    private readonly addClips: AddClips,
    /// Le pagine che si annotano: gli altri figli della radice non ci sono.
    private readonly pages: readonly ContainerNode[] | null = null,
  ) {}

  resolve(key: string): Unit | null {
    const node = key.startsWith("@") ? this.byPath(key.slice(1)) : this.byId(key);
    if (node === null || !pickable(node) || node.details!.locked === true) return null;
    const parent = node.parent;
    if (parent === null || (this.scope !== null && !within(node, this.scope))) return null;
    // Sulle pagine di un PDF un figlio della radice non è un oggetto.
    if (this.pages !== null && parent === this.model.root) return null;
    const context = this.contextOf(parent);
    if (context === null) return null;
    const index = elementChildren(parent).indexOf(node);
    if (index < 0) return null;
    const unit = this.make(node, [...context.path, index], context.layer, context.matrix, context.style, context.clips);
    return unit !== null && unit.key === key ? unit : null;
  }

  childrenOf(container: ContainerNode): Unit[] {
    const role = container.details?.role;
    if (role !== "group" && role !== "link" && role !== "symbol") return [];
    if (this.scope !== null && container !== this.scope && !within(container, this.scope)) return [];
    const context = this.contextOf(container);
    if (context === null) return [];
    const out: Unit[] = [];
    childLoop(container, (child, index) => {
      if (pickable(child) && child.details!.locked !== true) push(out, this.make(child, [...context.path, index], context.layer, context.matrix, context.style, context.clips));
    });
    return out;
  }

  copiesOf(container: ContainerNode): Unit[] {
    if (container.details?.repeat === undefined) return [];
    if (this.scope !== null && container !== this.scope && !within(container, this.scope)) return [];
    const context = this.contextOf(container);
    if (context === null) return [];
    const out: Unit[] = [];
    childLoop(container, (child, index) => {
      if (child.details?.role === "copy" && child.details.locked !== true) push(out, this.make(child, [...context.path, index], context.layer, context.matrix, context.style, context.clips));
    });
    return out;
  }

  scopeUnit(): Unit | null {
    const scope = this.scope;
    const parent = scope?.parent ?? null;
    if (scope === null || parent === null) return null;
    if (scope.details?.role === "symbol") {
      // Il simbolo ha le coordinate, lo stile e i ritagli che l'istanza dà
      // al suo contenuto, e nessuna trasformazione sua.
      const context = this.contextOf(scope);
      return context === null ? null : this.make(scope, [...context.path], context.layer, context.matrix, context.style, context.clips);
    }
    const context = this.contextOf(parent);
    const index = elementChildren(parent).indexOf(scope);
    if (context === null || index < 0 || this.contextOf(scope) === null) return null;
    return this.make(scope, [...context.path, index], context.layer, context.matrix, context.style, context.clips);
  }

  /// Dove stanno i figli di `container`; `null` se lì non si sceglie: se il
  /// contenitore non sta nel documento, o se lui o uno che lo contiene è
  /// bloccato o nascosto.
  contextOf(container: ContainerNode): Context | null {
    let context = this.contexts.get(container);
    if (context === undefined) {
      context = this.compute(container);
      this.contexts.set(container, context);
    }
    return context;
  }

  private compute(container: ContainerNode): Context | null {
    if (container === this.model.root) return { path: [], layer: null, matrix: IDENTITY, style: this.rootStyle, clips: null };
    const parent = container.parent;
    const details = container.details;
    if (parent === null || details === null || details.locked === true) return null;
    if (details.role === "symbol") return this.symbolContext(container);
    // Sulle pagine di un PDF i gruppi della pagina fanno da livelli, e gli
    // altri figli della radice non ci sono.
    const page = this.pages !== null && parent === this.model.root;
    if (page && !this.pages!.includes(container)) return null;
    const isLayer = page || details.role === "layer";
    if (isLayer ? parent !== this.model.root : details.role !== "group" && details.role !== "link") return null;
    const index = elementChildren(parent).indexOf(container);
    const outer = index < 0 ? null : this.contextOf(parent);
    const attrs = this.attrsOf(container);
    if (outer === null || attrs === null || hidden(attrs)) return null;
    const matrix = compose(outer.matrix, transformOf(attrs));
    const style = styleOf(outer.style, attrs);
    return {
      path: [...outer.path, index],
      layer: isLayer ? container.facts.id : outer.layer,
      matrix,
      style,
      clips: this.addClips(container, attrs, matrix, style, outer.clips),
    };
  }

  /// Dove sta il contenuto di `symbol`: dove lo mette la sua istanza fra
  /// quelle da cui si entra, che si sceglie dove sta. `null` senza.
  private symbolContext(symbol: ContainerNode): Context | null {
    const instance = this.through.find((each) => each.details?.role === "instance" && each.details.symbol === symbol.facts.id);
    const parent = instance?.parent ?? null;
    if (instance === undefined || parent === null || instance.details!.locked === true || elementChildren(parent).indexOf(instance) < 0) return null;
    if (this.pages !== null && parent === this.model.root) return null;
    const outer = this.contextOf(parent);
    const attrs = this.attrsOf(instance);
    if (outer === null || attrs === null || hidden(attrs)) return null;
    const matrix = compose(outer.matrix, transformOf(attrs));
    const style = styleOf(outer.style, attrs);
    return { path: symbolPath(symbol), layer: outer.layer, matrix, style, clips: this.addClips(instance, attrs, matrix, style, outer.clips) };
  }

  private byPath(text: string): ElementPart | null {
    if (!/^\d+(\.\d+)*$/.test(text)) return null;
    let node: ElementPart = this.model.root;
    for (const step of text.split(".")) {
      if (node.kind !== "container") return null;
      const child: ElementPart | undefined = elementChildren(node)[Number(step)];
      if (child === undefined) return null;
      node = child;
    }
    return node;
  }

  private byId(id: string): ElementPart | null {
    if (this.ids === null) {
      const ids = new Map<string, ElementPart>();
      const visit = (container: ContainerNode): void => childLoop(container, (child) => {
        if (child.facts.id !== null && !ids.has(child.facts.id)) ids.set(child.facts.id, child);
        if (child.kind === "container") visit(child);
      });
      visit(this.model.root);
      this.ids = ids;
    }
    return this.ids.get(id) ?? null;
  }
}

/// Vero se `node` è un oggetto, nel posto dove sta: non la carta, il titolo,
/// la descrizione, un livello, le risorse con la loro `defs`, una copia in
/// una ripetizione o un blocco estraneo.
export function pickable(node: ElementPart): boolean {
  const role = node.details?.role;
  return role !== undefined && !NOT_PICKABLE.has(role);
}

const NOT_PICKABLE: ReadonlySet<string> = new Set(["paper", "board", "title", "desc", "layer", "defs", "resource", "copy"]);

/// Vero se il percorso `a` viene dopo `b` nel documento: sta più in alto.
export function later(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return a.length > b.length;
}

/// Il percorso di `symbol` nel documento: la sua `defs` fra i figli della
/// radice, e lui fra quelli della `defs`.
export function symbolPath(symbol: ContainerNode): number[] {
  const defs = symbol.parent!;
  return [elementChildren(defs.parent!).indexOf(defs), elementChildren(defs).indexOf(symbol)];
}

/// Vero se nel contenuto di `symbol`, anche attraverso le istanze di altri
/// simboli, c'è un collegamento; `known` ricorda i simboli già visti.
export function hasLink(symbol: ContainerNode, known: Map<ContainerNode, boolean>): boolean {
  const seen = known.get(symbol);
  if (seen !== undefined) return seen;
  // Un ciclo non c'è, ma un documento rotto non deve girare per sempre.
  known.set(symbol, false);
  let found = false;
  const visit = (container: ContainerNode): void => childLoop(container, (child) => {
    if (found || child.details === null) return;
    if (child.details.role === "link") found = true;
    else if (child.kind === "container") visit(child);
    else if (child.details.role === "instance") {
      const target = defsChild(child, child.details.symbol!, (node) => node.kind === "container" && node.details?.role === "symbol");
      if (target !== null && hasLink(target as ContainerNode, known)) found = true;
    }
  });
  visit(symbol);
  known.set(symbol, found);
  return found;
}

/// Il figlio di una `defs` della radice del documento di `from` con l'id
/// `id` che `fits` accetta; `null` se non c'è.
export function defsChild(from: ElementPart, id: string, fits: (node: ElementPart) => boolean): ElementPart | null {
  let root = from.parent;
  while (root !== null && root.parent !== null) root = root.parent;
  if (root === null) return null;
  for (const defs of elementChildren(root)) {
    if (defs.kind !== "container" || defs.details?.role !== "defs") continue;
    for (const child of elementChildren(defs)) if (child.facts.id === id && fits(child)) return child;
  }
  return null;
}

/// Vero se `node` sta dentro `container`, a qualunque profondità.
function within(node: ElementPart, container: ContainerNode): boolean {
  for (let current = node.parent; current !== null; current = current.parent) if (current === container) return true;
  return false;
}

export function push(out: Unit[], unit: Unit | null): void {
  if (unit !== null) out.push(unit);
}

// ---------------------------------------------------------------------------
// Lettura degli attributi dipinti.
// ---------------------------------------------------------------------------

export function childLoop(container: ContainerNode, visit: (child: ElementPart, index: number) => void): void {
  let index = 0;
  for (const part of container.parts) {
    if (typeof part === "string" || part.kind === "other") continue;
    visit(part, index++);
  }
}
