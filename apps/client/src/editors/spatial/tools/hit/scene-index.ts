// L'indice degli oggetti di una scena: chi sta sotto un punto, dentro un
// rettangolo o un lazo, lungo un tratto (vedi `../hit.ts`).

import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import { elementChildren, type ContainerNode } from "../../scene/model";
import { BoxTree } from "../box-tree";
import { type LayerInfo, TREE_FROM } from "./base";
import { Lasso } from "./geometry";
import { later } from "./lookup";
import type { Nested, Unit } from "./unit";

/// L'indice degli oggetti di una scena, in ordine di documento: l'ultimo è
/// quello che si vede sopra. Gli oggetti dell'indice sono quelli in cima, o
/// quelli del gruppo isolato; quelli più dentro si trovano con `get`,
/// `children` e `deepAt`.
export class SceneIndex {
  private readonly byKey = new Map<string, Unit | null>();
  /// Gli oggetti di primo livello, per [`siblings`]: si raccolgono la prima
  /// volta che servono.
  private top: ReadonlySet<Unit> | null = null;
  /// L'albero dei riquadri degli oggetti, per [`along`]: si costruisce la
  /// prima volta che serve, e soltanto con molti oggetti.
  private tree: BoxTree | null | undefined;

  private scoped: Unit | null | undefined;

  constructor(
    readonly units: readonly Unit[],
    readonly layers: readonly LayerInfo[],
    private readonly nested: Nested | null = null,
  ) {
    for (const unit of units) this.byKey.set(unit.key, unit);
  }

  /// Il gruppo, il collegamento o il simbolo isolato come oggetto, che
  /// riceve ciò che si disegna: per un simbolo, nelle coordinate
  /// dell'istanza da cui lo si modifica. `null` senza isolamento.
  scope(): Unit | null {
    if (this.scoped === undefined) this.scoped = this.nested?.scopeUnit() ?? null;
    return this.scoped;
  }

  /// L'oggetto di chiave `key`, anche dentro un gruppo; `null` se non si
  /// sceglie: se non c'è, se è bloccato o nascosto, se lo è un gruppo che lo
  /// contiene, o se sta fuori dal gruppo isolato.
  get(key: string): Unit | null {
    let unit = this.byKey.get(key);
    if (unit === undefined) {
      unit = this.nested?.resolve(key) ?? null;
      this.byKey.set(key, unit);
    }
    return unit;
  }

  /// Gli oggetti che si scelgono fra i figli di `unit`, se è un gruppo o un
  /// collegamento, in ordine di documento.
  children(unit: Unit): Unit[] {
    if (unit.node.kind !== "container" || this.nested === null) return [];
    return this.nested.childrenOf(unit.node).map((child) => this.keep(child));
  }

  /// Gli oggetti che si scelgono accanto a `unit`, nello stesso genitore, lui
  /// compreso, in ordine di documento.
  siblings(unit: Unit): Unit[] {
    const parent = unit.node.parent;
    this.top ??= new Set(this.units);
    if (this.top.has(unit) || parent === null || this.nested === null) return this.units.filter((each) => each.node.parent === parent);
    return this.nested.childrenOf(parent).map((child) => this.keep(child));
  }

  /// Lo stesso oggetto di prima, se l'indice l'ha già dato: così una chiave
  /// dà sempre lo stesso oggetto.
  private keep(unit: Unit): Unit {
    const known = this.byKey.get(unit.key);
    if (known !== undefined && known !== null && known.node === unit.node) return known;
    this.byKey.set(unit.key, unit);
    return unit;
  }

  /// L'oggetto più in alto sotto `p`. In una ripetizione isolata, una copia
  /// che sta sopra dà il suo originale.
  at(p: Point, tolerance: number): Unit | null {
    let found: Unit | null = null;
    for (let i = this.units.length - 1; i >= 0 && found === null; i--) if (this.units[i]!.hits(p, tolerance)) found = this.units[i]!;
    const scope = this.nested?.scope ?? null;
    return scope === null ? found : this.throughCopies(scope, p, tolerance, found);
  }

  /// L'oggetto più dentro sotto `p`: in quello più in alto, il figlio più in
  /// alto che `p` tocca, e così via finché non ci sono figli da scegliere.
  /// In una ripetizione una copia dà il suo originale.
  deepAt(p: Point, tolerance: number): Unit | null {
    let unit = this.at(p, tolerance);
    while (unit !== null) {
      const children = this.children(unit);
      let inner: Unit | null = null;
      for (let i = children.length - 1; i >= 0 && inner === null; i--) if (children[i]!.hits(p, tolerance)) inner = children[i]!;
      if (unit.node.kind === "container") inner = this.throughCopies(unit.node, p, tolerance, inner);
      if (inner === null) return unit;
      unit = inner;
    }
    return null;
  }

  /// L'originale della copia più in alto di `container` che `p` tocca, se
  /// sta sopra `found`, un figlio di `container`; altrimenti `found`.
  private throughCopies(container: ContainerNode, p: Point, tolerance: number, found: Unit | null): Unit | null {
    const copies = this.nested?.copiesOf(container) ?? [];
    for (let i = copies.length - 1; i >= 0; i--) {
      const copy = copies[i]!;
      if (found !== null && !later(copy.path, found.path)) break;
      if (!copy.hits(p, tolerance)) continue;
      const original = this.get(copy.node.details!.original!);
      return original !== null && original.node.parent === container ? original : found;
    }
    return found;
  }

  /// Gli oggetti che il segmento da `a` a `b` tocca, in ordine di documento,
  /// tranne quelli che `marked` ha già sotto la loro chiave: la gomma li ha
  /// segnati, e non serve provarli di nuovo. Con molti oggetti si provano
  /// soltanto quelli che l'albero dei riquadri dà per il riquadro di `near`,
  /// fatto con gli stessi conti: sono proprio quelli che `touches` non
  /// scarterebbe subito.
  ///
  /// Un gruppo o un collegamento non si prende intero perché il segmento ne
  /// tocca un figlio: la gomma scende fra i figli e prende soltanto quelli
  /// toccati, fino in fondo («la gomma non cancella ciò che non ha toccato»).
  /// Un livello di Inkscape, che per Fub è un `<g>` qualsiasi, con dentro
  /// tutto il disegno non sparisce perché la gomma ha sfiorato una parola.
  along(a: Point, b: Point, tolerance: number, marked?: ReadonlyMap<string, Unit>): Unit[] {
    if (this.tree === undefined) this.tree = this.units.length < TREE_FROM ? null : new BoxTree(this.units.map((unit) => unit.bounds));
    const touched = (unit: Unit): boolean => marked?.get(unit.key) !== unit && unit.touches(a, b, tolerance);
    const deep = (unit: Unit): Unit[] => this.deepAlong(unit, a, b, tolerance, marked);
    if (this.tree === null) return this.units.filter(touched).flatMap(deep);
    const found: Unit[] = [];
    const near = this.tree.search(Math.min(a[0], b[0]) - tolerance, Math.min(a[1], b[1]) - tolerance, Math.max(a[0], b[0]) + tolerance, Math.max(a[1], b[1]) + tolerance);
    for (const i of near) if (touched(this.units[i]!)) found.push(...deep(this.units[i]!));
    return found;
  }

  /// Ciò che la gomma prende di `unit`, che il segmento tocca: lui intero se
  /// non è un gruppo o un collegamento con dei figli, o se è una ripetizione
  /// (che si prende intera); sennò i figli toccati, e così via. Il
  /// contenitore si prende intero soltanto quando lo stesso segmento prende
  /// interi tutti i suoi figli, nessuno era già segnato e non ha altri figli
  /// (bloccati, nascosti, titoli, blocchi estranei): così non resta un `<g>`
  /// o un `<a>` vuoto, niente si toglie due volte, e niente che la gomma non
  /// tocca se ne va col contenitore. Un figlio già segnato non si riprova; un
  /// figlio bloccato non è fra i figli (`childrenOf`), quindi non si prende
  /// mai.
  private deepAlong(unit: Unit, a: Point, b: Point, tolerance: number, marked?: ReadonlyMap<string, Unit>): Unit[] {
    const node = unit.node;
    if (node.kind !== "container") return [unit];
    const role = node.details?.role;
    if ((role !== "group" && role !== "link") || node.details?.repeat !== undefined) return [unit];
    const children = this.children(unit);
    // Soltanto figli bloccati o che non si scelgono: la gomma li lascia.
    if (children.length === 0) return elementChildren(node).length === 0 ? [unit] : [];
    const out: Unit[] = [];
    let whole = children.length === elementChildren(node).length;
    for (const child of children) {
      if (marked?.get(child.key) === child) {
        whole = false;
        continue;
      }
      if (!child.touches(a, b, tolerance)) {
        whole = false;
        continue;
      }
      const taken = this.deepAlong(child, a, b, tolerance, marked);
      if (taken.length !== 1 || taken[0] !== child) whole = false;
      out.push(...taken);
    }
    return whole ? [unit] : out;
  }

  /// Gli oggetti che stanno interi dentro il lazo `points`, un poligono della
  /// scena chiuso dall'ultimo punto al primo: la stessa regola del riquadro
  /// di selezione.
  inside(points: readonly Point[]): Unit[] {
    if (points.length < 3) return [];
    const lasso = new Lasso(points);
    return this.units.filter((unit) => unit.inside(lasso));
  }

  /// Gli oggetti che stanno interi dentro `area`, un rettangolo della scena.
  within(area: Bounds): Unit[] {
    return this.units.filter((unit) => unit.bounds !== null
      && unit.bounds.min[0] >= area.min[0] && unit.bounds.max[0] <= area.max[0]
      && unit.bounds.min[1] >= area.min[1] && unit.bounds.max[1] <= area.max[1]);
  }
}
