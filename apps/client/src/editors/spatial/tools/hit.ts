// Gli oggetti che gli strumenti toccano: l'indice con cui la selezione
// sceglie, la gomma cancella e lo spostamento sposta.
//
// Un **oggetto** è ciò che al livello Essenziale si sceglie intero: un figlio
// di un livello, o un figlio della radice fuori da ogni livello, che non sia
// la carta, il titolo o la descrizione. Un oggetto fatto a un livello più
// ricco resta intatto anche qui, dove al massimo si sposta o si elimina
// intero. Un gruppo o un collegamento si sceglie con tutto ciò che contiene.
// Gli oggetti di un livello bloccato o nascosto non si toccano, e nemmeno
// quelli bloccati con `fub:locked="true"` o nascosti con `display="none"`.
// Un blocco estraneo non è un oggetto: si vede come immagine e resta com'è.
//
// Dentro un gruppo o un collegamento si sceglie anche un oggetto solo: con
// Ctrl o ⌘ col clic, o isolando il gruppo, che diventa l'unico posto dove si
// sceglie. L'indice dà gli oggetti in cima, quelli del gruppo isolato se ce
// n'è uno, e trova quelli più dentro quando servono, con le stesse regole:
// niente dentro un gruppo bloccato o nascosto.
//
// La geometria è quella che il painter disegna: gli attributi dipinti della
// stessa `PaintScene` (`PaintBuilder.shape` e `headInfo`), con le
// trasformazioni di livelli e gruppi composte. I tracciati si appiattiscono
// solo per gli oggetti vicini al puntatore, con un errore di 0,05 unità
// della scena, e un tratto a penna si tocca dentro il suo contorno pieno
// come lo riempie il browser, con la regola non zero. Un testo si tocca nel
// riquadro stimato delle sue righe: la misura vera dipende dai caratteri.

import type { Role } from "../scene/analysis";
import { BoundsBuilder, fmin, parsePath, rectPath, type Bounds, type Segment } from "../scene/geometry";
import { arcCenter, onEllipse } from "../scene/curves";
import { apply, compose, IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, tagName, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Target } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { length, nonNegativeLength, points as parsePoints, transform as parseTransform } from "../scene/values";
import type { PaintAttr, PaintBuilder, PaintNode, PaintShape, TextRun } from "../painter/paint";

/// L'errore massimo dell'appiattimento, in unità della scena.
export const FLATNESS = 0.05;

/// Il limite di pezzi per una curva: oltre, una curva enorme costerebbe più
/// di quanto il puntatore possa distinguere.
const MAX_STEPS = 256;

/// Un livello del documento, per chi deve scegliere dove scrivere.
export interface LayerInfo {
  readonly id: string | null;
  readonly path: readonly number[];
  /// Il nome scritto in `fub:layer`.
  readonly name: string;
  readonly locked: boolean;
  readonly hidden: boolean;
  /// Dalle coordinate del livello a quelle della scena.
  readonly matrix: Matrix;
}

/// Come si vede un testo, per chi lo modifica sul posto: nelle coordinate
/// dell'oggetto, con lo stile che eredita.
export interface TextLook {
  /// Il punto della linea di base della prima riga dove la riga comincia,
  /// sta al centro o finisce, secondo `anchor`.
  readonly x: number;
  readonly y: number;
  /// Il corpo, e il passo fra una riga e l'altra.
  readonly size: number;
  readonly leading: number;
  readonly anchor: "start" | "middle" | "end";
  /// `font-family`, `font-weight` e `fill` come li eredita; `null` se nessuno
  /// li scrive.
  readonly family: string | null;
  readonly weight: string | null;
  readonly color: string | null;
}

/// Un pezzo di un oggetto che si disegna da solo: una forma.
interface Part {
  /// L'elemento che la disegna.
  readonly leaf: LeafNode;
  readonly segments: readonly Segment[];
  /// Dalle coordinate della forma a quelle della scena.
  readonly matrix: Matrix;
  /// Dalle coordinate della forma a quelle dell'oggetto.
  readonly frameMatrix: Matrix;
  readonly fill: boolean;
  /// Metà dello spessore del contorno, in unità della forma; 0 senza contorno.
  readonly radius: number;
  readonly cache: ShapeCache | null;
  flat: Flat | null;
}

/// Un sottotracciato appiattito, in coordinate della scena: `x, y` a coppie.
interface Run {
  readonly points: Float64Array;
  readonly closed: boolean;
}

interface Flat {
  readonly runs: readonly Run[];
  /// Metà dello spessore del contorno nella scena.
  readonly radius: number;
}

/// Ciò che di una forma non cambia finché non cambia la forma: i segmenti, e
/// il riquadro nella scena dell'ultima matrice.
interface ShapeCache {
  segments: readonly Segment[] | null;
  scene: { readonly matrix: Matrix; readonly bounds: Bounds | null } | null;
  local: Bounds | null | undefined;
}

/// Un oggetto della scena.
export class Unit {
  private frameBounds: Bounds | null | undefined = undefined;
  private shapeBounds: Bounds | null | undefined = undefined;

  constructor(
    /// L'id, o il percorso per un oggetto che non ne ha: la chiave della
    /// selezione.
    readonly key: string,
    readonly target: Target,
    readonly id: string | null,
    readonly path: readonly number[],
    readonly tag: string,
    readonly role: Role,
    /// L'id del livello che lo contiene; `null` alla radice o per un livello
    /// senza id.
    readonly layer: string | null,
    /// Dalle coordinate del genitore a quelle della scena.
    readonly parent: Matrix,
    /// Il suo `transform`, letto; l'identità se non ce l'ha.
    readonly transform: Matrix,
    /// Ciò che il painter disegna per lui.
    readonly paints: readonly PaintNode[],
    /// Il riquadro nella scena, contorno compreso; `null` se non disegna
    /// niente.
    readonly bounds: Bounds | null,
    /// Il riquadro della geometria nella scena, senza contorno: quello che
    /// la griglia aggancia.
    readonly geometry: Bounds | null,
    private readonly parts: readonly Part[],
    /// L'elemento.
    readonly node: ElementPart,
    /// Lo stile che trasmette ai figli.
    readonly inner: Style,
    /// Come si vede, se è un testo.
    readonly look: TextLook | null = null,
  ) {}

  /// Dalle coordinate dell'oggetto a quelle della scena.
  get matrix(): Matrix {
    return compose(this.parent, this.transform);
  }

  /// Il riquadro nelle coordinate dell'oggetto, contorno compreso: con
  /// `matrix` dà la cornice della selezione, che ruota con l'oggetto.
  frame(): Bounds | null {
    if (this.frameBounds === undefined) {
      const out = new BoundsBuilder();
      for (const part of this.parts) {
        const local = part.frameMatrix === IDENTITY && part.cache !== null ? localBounds(part) : transformedBounds(part.segments, part.frameMatrix);
        if (local !== null) includeInflated(out, local, part.radius * scaleOf(part.frameMatrix));
      }
      this.frameBounds = out.finish();
    }
    return this.frameBounds;
  }

  /// Il riquadro della geometria nelle coordinate dell'oggetto, senza
  /// contorno: quello che la griglia aggancia quando la cornice non ruota, e
  /// che dice se un asse dell'oggetto misura zero.
  shapeFrame(): Bounds | null {
    if (this.shapeBounds === undefined) {
      const out = new BoundsBuilder();
      for (const part of this.parts) {
        const local = part.frameMatrix === IDENTITY && part.cache !== null ? localBounds(part) : transformedBounds(part.segments, part.frameMatrix);
        if (local !== null) includeInflated(out, local, 0);
      }
      this.shapeBounds = out.finish();
    }
    return this.shapeBounds;
  }

  /// Il riquadro nella scena dopo `m`, una trasformazione della scena,
  /// contorno compreso: dove finisce l'oggetto, anche ruotato.
  boundsAfter(m: Matrix): Bounds | null {
    const out = new BoundsBuilder();
    for (const part of this.parts) {
      const matrix = compose(m, part.matrix);
      const bounds = transformedBounds(part.segments, matrix);
      if (bounds !== null) includeInflated(out, bounds, part.radius * scaleOf(matrix));
    }
    return out.finish();
  }

  /// Le forme che disegnano l'oggetto, in ordine di documento: l'elemento,
  /// e la matrice dalle sue coordinate a quelle della scena.
  shapes(): Array<{ readonly leaf: LeafNode; readonly matrix: Matrix }> {
    return this.parts.map((part) => ({ leaf: part.leaf, matrix: part.matrix }));
  }

  /// Vero se il punto `p` della scena tocca l'oggetto, con una tolleranza
  /// `tolerance` in unità della scena.
  hits(p: Point, tolerance: number): boolean {
    if (!near(this.bounds, p, p, tolerance)) return false;
    return this.parts.some((part) => partHits(part, p, tolerance));
  }

  /// La forma più in alto dell'oggetto che il punto `p` della scena tocca;
  /// `null` se nessuna.
  shapeAt(p: Point, tolerance: number): LeafNode | null {
    if (!near(this.bounds, p, p, tolerance)) return null;
    for (let i = this.parts.length - 1; i >= 0; i--) if (partHits(this.parts[i]!, p, tolerance)) return this.parts[i]!.leaf;
    return null;
  }

  /// Vero se il segmento da `a` a `b` tocca l'oggetto: il passaggio della
  /// gomma fra due campioni.
  touches(a: Point, b: Point, tolerance: number): boolean {
    if (!near(this.bounds, a, b, tolerance)) return false;
    return this.parts.some((part) => partTouches(part, a, b, tolerance));
  }

  /// Vero se l'oggetto sta tutto dentro il lazo `lasso`, contorno compreso:
  /// nessun contorno arriva a un lato del lazo, e ogni forma comincia dentro.
  inside(lasso: Lasso): boolean {
    const bounds = this.bounds;
    if (bounds === null || !holds(lasso.bounds, bounds)) return false;
    const edges = lasso.edgesNear(bounds);
    // Un riquadro che nessun lato attraversa sta tutto da una parte.
    if (edges.length === 0) return lasso.contains(bounds.min);
    for (const part of this.parts) {
      const flat = flatten(part);
      const first = flat.runs[0];
      if (first === undefined) continue;
      const reach = flat.radius;
      const crosses = forEachEdge(flat, part.fill, (ax, ay, bx, by) => {
        for (let i = 0; i < edges.length; i += 4) {
          if (segmentDistance(ax, ay, bx, by, edges[i]!, edges[i + 1]!, edges[i + 2]!, edges[i + 3]!) <= reach) return true;
        }
        return false;
      });
      if (crosses || !lasso.contains([first.points[0]!, first.points[1]!])) return false;
    }
    return true;
  }
}

/// Un lazo: un poligono della scena chiuso dall'ultimo punto al primo, che
/// contiene i punti con la regola non zero, come un riempimento. Un giro che
/// si chiude ripassando sull'inizio non lascia buchi.
class Lasso {
  readonly bounds: Bounds;
  private readonly flat: Flat;

  constructor(points: readonly Point[]) {
    const out = new BoundsBuilder();
    const coords = new Float64Array(points.length * 2);
    points.forEach((p, i) => {
      coords[2 * i] = p[0];
      coords[2 * i + 1] = p[1];
      out.include(p);
    });
    this.bounds = out.finish()!;
    this.flat = { runs: [{ points: coords, closed: true }], radius: 0 };
  }

  contains(p: Point): boolean {
    return winding(this.flat, p) !== 0;
  }

  /// I lati il cui riquadro incontra `bounds`, quattro numeri per lato.
  edgesNear(bounds: Bounds): number[] {
    const out: number[] = [];
    forEachEdge(this.flat, true, (ax, ay, bx, by) => {
      if (Math.max(ax, bx) >= bounds.min[0] && Math.min(ax, bx) <= bounds.max[0] && Math.max(ay, by) >= bounds.min[1] && Math.min(ay, by) <= bounds.max[1]) {
        out.push(ax, ay, bx, by);
      }
      return false;
    });
    return out;
  }
}

/// Come l'indice trova gli oggetti dentro i gruppi.
interface Nested {
  /// L'oggetto di chiave `key` dove si sceglie, a qualunque profondità;
  /// `null` se non c'è.
  resolve(key: string): Unit | null;
  /// Gli oggetti che si scelgono fra i figli di `container`.
  childrenOf(container: ContainerNode): Unit[];
}

/// L'indice degli oggetti di una scena, in ordine di documento: l'ultimo è
/// quello che si vede sopra. Gli oggetti dell'indice sono quelli in cima, o
/// quelli del gruppo isolato; quelli più dentro si trovano con `get`,
/// `children` e `deepAt`.
export class SceneIndex {
  private readonly byKey: Map<string, Unit | null>;
  private readonly top: ReadonlySet<Unit>;

  constructor(
    readonly units: readonly Unit[],
    readonly layers: readonly LayerInfo[],
    private readonly nested: Nested | null = null,
  ) {
    this.byKey = new Map(units.map((unit) => [unit.key, unit]));
    this.top = new Set(units);
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

  /// L'oggetto più in alto sotto `p`.
  at(p: Point, tolerance: number): Unit | null {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const unit = this.units[i]!;
      if (unit.hits(p, tolerance)) return unit;
    }
    return null;
  }

  /// L'oggetto più dentro sotto `p`: in quello più in alto, il figlio più in
  /// alto che `p` tocca, e così via finché non ci sono figli da scegliere.
  deepAt(p: Point, tolerance: number): Unit | null {
    let unit = this.at(p, tolerance);
    while (unit !== null) {
      const children = this.children(unit);
      let inner: Unit | null = null;
      for (let i = children.length - 1; i >= 0 && inner === null; i--) if (children[i]!.hits(p, tolerance)) inner = children[i]!;
      if (inner === null) return unit;
      unit = inner;
    }
    return null;
  }

  /// Gli oggetti che il segmento da `a` a `b` tocca, in ordine di documento.
  along(a: Point, b: Point, tolerance: number): Unit[] {
    return this.units.filter((unit) => unit.touches(a, b, tolerance));
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

/// Lo stile che un contenitore trasmette ai figli, per quanto serve a
/// toccarli e a modificarne il testo.
interface Style {
  readonly fill: boolean;
  readonly stroke: boolean;
  readonly strokeWidth: number;
  readonly fontSize: number;
  readonly anchor: string;
  readonly family: string | null;
  readonly weight: string | null;
  readonly color: string | null;
}

/// Chi riceve gli oggetti di un documento: il nodo, il suo percorso, il
/// livello, la matrice e lo stile del genitore.
type Visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style) => void;

const INITIAL: Style = { fill: true, stroke: false, strokeWidth: 1, fontSize: 16, anchor: "start", family: null, weight: null, color: null };

/// Costruisce gli indici di un documento, ricordando la geometria delle
/// forme che non cambiano fra una scena e l'altra.
export class SceneIndexer {
  private cache = new WeakMap<PaintShape, ShapeCache>();

  constructor(private readonly builder: PaintBuilder) {}

  /// L'indice di `model`, che il `PaintBuilder` ha appena disegnato. Con
  /// `scope`, un gruppo o un collegamento isolato, gli oggetti sono i suoi
  /// figli, e fuori non si sceglie niente.
  index(model: DocumentModel, scope: ContainerNode | null = null): SceneIndex {
    const units: Unit[] = [];
    const layers: LayerInfo[] = [];
    const nested = new Lookup(model, scope, this.rootStyle(model), (node) => this.attrsOf(node), (node, path, layer, parent, style) => this.unit(node, path, layer, parent, style));
    if (scope === null) {
      this.walk(model, (layer) => !layer.locked && !layer.hidden, layers, (node, path, layer, parent, style) => {
        if (node.details!.locked === true) return;
        push(units, this.unit(node, path, layer, parent, style));
      });
    } else {
      this.walk(model, () => false, layers, () => {});
      units.push(...nested.childrenOf(scope));
    }
    return new SceneIndex(units, layers, nested);
  }

  /// Vero se dentro `container`, un gruppo o un collegamento di `model`, si
  /// sceglie: se sta nel documento, e né lui né chi lo contiene è bloccato o
  /// nascosto.
  opens(model: DocumentModel, container: ContainerNode): boolean {
    const role = container.details?.role;
    if (role !== "group" && role !== "link") return false;
    return new Lookup(model, null, this.rootStyle(model), (node) => this.attrsOf(node), () => null).contextOf(container) !== null;
  }

  /// I collegamenti di `model` che si vedono, a ogni profondità: anche
  /// quelli dentro un gruppo, e quelli dei livelli bloccati che l'indice non
  /// tocca, perché un collegamento si apre anche lì. La chiave di uno dentro
  /// un gruppo non è una chiave della selezione.
  links(model: DocumentModel): Unit[] {
    const units: Unit[] = [];
    const visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style): void => {
      if (node.details === null) return;
      if (node.details.role === "link") {
        push(units, this.unit(node, path, layer, parent, style));
        return;
      }
      if (node.kind !== "container") return;
      const attrs = this.attrsOf(node);
      if (attrs === null || hidden(attrs)) return;
      const matrix = compose(parent, transformOf(attrs));
      const inner = styleOf(style, attrs);
      childLoop(node, (child, index) => visit(child, [...path, index], layer, matrix, inner));
    };
    this.walk(model, (layer) => !layer.hidden, [], visit);
    return units;
  }

  /// Gli oggetti di `model` che si vedono, anche quelli bloccati che
  /// l'indice non tocca: ciò su cui le guide intelligenti si allineano. Dei
  /// contenitori `open`, il gruppo isolato e quelli da cui si sposta un
  /// oggetto, i figli uno per uno al posto del tutto.
  seen(model: DocumentModel, open: ReadonlySet<ContainerNode> = new Set()): Unit[] {
    const units: Unit[] = [];
    const visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style): void => {
      if (node.kind !== "container" || !open.has(node)) {
        push(units, this.unit(node, path, layer, parent, style));
        return;
      }
      const attrs = this.attrsOf(node);
      if (attrs === null || hidden(attrs)) return;
      const matrix = compose(parent, transformOf(attrs));
      const inner = styleOf(style, attrs);
      childLoop(node, (child, index) => {
        if (pickable(child)) visit(child, [...path, index], layer, matrix, inner);
      });
    };
    this.walk(model, (layer) => !layer.hidden, [], visit);
    return units;
  }

  /// Il riquadro di tutto ciò che `model` disegna, contorno compreso: anche
  /// gli oggetti dei livelli bloccati o nascosti, che l'indice non tocca ma
  /// che restano nel disegno. `null` se non disegna niente.
  extent(model: DocumentModel): Bounds | null {
    const units: Unit[] = [];
    this.walk(model, () => true, [], (node, path, layer, parent, style) => push(units, this.unit(node, path, layer, parent, style)));
    const out = new BoundsBuilder();
    for (const unit of units) {
      if (unit.bounds === null) continue;
      out.include(unit.bounds.min);
      out.include(unit.bounds.max);
    }
    return out.finish();
  }

  /// I livelli di `model` in `layers`, e i suoi oggetti a `visit`: degli
  /// oggetti nei livelli, solo quelli dei livelli che `enters` accetta.
  private walk(model: DocumentModel, enters: (layer: LayerInfo) => boolean, layers: LayerInfo[], visit: Visit): void {
    const root = model.root;
    const rootStyle = this.rootStyle(model);
    childLoop(root, (child, index) => {
      if (child.kind === "leaf") {
        if (child.details === null) return;
        const role = child.details.role;
        if (role === "paper" || role === "title" || role === "desc") return;
        visit(child, [index], null, IDENTITY, rootStyle);
        return;
      }
      const role = child.details!.role;
      if (role !== "layer") {
        visit(child, [index], null, IDENTITY, rootStyle);
        return;
      }
      const head = this.builder.headInfo(child);
      const matrix = compose(IDENTITY, transformOf(head.attrs));
      const layer = child.details!.layer!;
      const info: LayerInfo = { id: child.facts.id, path: [index], name: layer.name, locked: layer.locked, hidden: layer.hidden || head.hidden, matrix };
      layers.push(info);
      if (!enters(info)) return;
      const style = styleOf(rootStyle, head.attrs);
      childLoop(child, (grandchild, inner) => {
        if (grandchild.kind === "leaf" && (grandchild.details === null || grandchild.details.role === "title" || grandchild.details.role === "desc")) return;
        visit(grandchild, [index, inner], info.id, matrix, style);
      });
    });
  }

  /// Lo stile che la radice di `model` trasmette ai figli.
  private rootStyle(model: DocumentModel): Style {
    return styleOf(INITIAL, this.builder.headInfo(model.root).attrs);
  }

  /// L'oggetto `node`, se si vede.
  private unit(node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style): Unit | null {
    const attrs = this.attrsOf(node);
    if (attrs === null || hidden(attrs)) return null;
    const own = transformOf(attrs);
    const matrix = compose(parent, own);
    const inner = styleOf(style, attrs);
    const parts: Part[] = [];
    this.collect(node, matrix, IDENTITY, inner, parts);
    const scene = new BoundsBuilder();
    const geometry = new BoundsBuilder();
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds === null) continue;
      includeInflated(scene, bounds, part.radius * scaleOf(part.matrix));
      includeInflated(geometry, bounds, 0);
    }
    const id = node.facts.id;
    const tag = tagName(node);
    const look = node.kind === "leaf" && node.details!.role === "text" ? textLook(this.builder.shape(node), inner) : null;
    return new Unit(
      id ?? `@${path.join(".")}`,
      id ?? { path, tag },
      id,
      path,
      tag,
      node.details!.role,
      layer,
      parent,
      own,
      this.builder.paintsOf(node),
      scene.finish(),
      geometry.finish(),
      parts,
      node,
      inner,
      look,
    );
  }

  /// Gli attributi dipinti di un elemento; `null` se non disegna.
  private attrsOf(node: ElementPart): readonly PaintAttr[] | null {
    if (node.kind === "container") return this.builder.headInfo(node).attrs;
    const shape = this.builder.shape(node);
    return shape === null ? null : shape.attrs;
  }

  /// Le forme di `node` e dei suoi discendenti visibili. `matrix` porta le
  /// coordinate di `node` nella scena, `frame` in quelle dell'oggetto.
  private collect(node: ElementPart, matrix: Matrix, frame: Matrix, style: Style, out: Part[]): void {
    if (node.kind === "leaf") {
      const shape = this.builder.shape(node)!;
      out.push(this.part(node, shape, matrix, frame, style));
      return;
    }
    childLoop(node, (child) => {
      if (child.kind === "leaf" && child.details === null) return;
      const childAttrs = this.attrsOf(child);
      if (childAttrs === null || hidden(childAttrs)) return;
      const own = transformOf(childAttrs);
      this.collect(child, compose(matrix, own), compose(frame, own), styleOf(style, childAttrs), out);
    });
  }

  private part(leaf: LeafNode, shape: PaintShape, matrix: Matrix, frame: Matrix, style: Style): Part {
    let cache = this.cache.get(shape) ?? null;
    let segments: readonly Segment[];
    if (shape.tag === "text") {
      // Il riquadro di un testo dipende dallo stile ereditato: non si ricorda.
      segments = textSegments(shape.attrs, shape.runs ?? [], style);
      cache = null;
    } else {
      if (cache === null) {
        cache = { segments: null, scene: null, local: undefined };
        this.cache.set(shape, cache);
      }
      cache.segments ??= shapeSegments(shape.tag, shape.attrs);
      segments = cache.segments;
    }
    const tag = leaf.details!.tag;
    // Una linea non ha area; un testo e un'immagine si toccano nel loro
    // riquadro.
    const fill = tag === "line" ? false : tag === "text" || tag === "image" ? true : style.fill;
    const radius = style.stroke && tag !== "text" && tag !== "image" ? style.strokeWidth / 2 : 0;
    return { leaf, segments, matrix, frameMatrix: frame, fill, radius, cache, flat: null };
  }

  /// Il riquadro geometrico di una forma nella scena, ricordato per matrice.
  private sceneBounds(part: Part): Bounds | null {
    const cache = part.cache;
    if (cache !== null && cache.scene !== null && sameMatrix(cache.scene.matrix, part.matrix)) return cache.scene.bounds;
    const bounds = transformedBounds(part.segments, part.matrix);
    if (cache !== null) cache.scene = { matrix: part.matrix, bounds };
    return bounds;
  }
}

/// Dove stanno i figli di un contenitore: il suo percorso, il livello, la
/// matrice dalle sue coordinate a quelle della scena e lo stile che
/// trasmette.
interface Context {
  readonly path: readonly number[];
  readonly layer: string | null;
  readonly matrix: Matrix;
  readonly style: Style;
}

type MakeUnit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style) => Unit | null;

/// Trova gli oggetti dentro i gruppi di un documento, per un indice: con
/// `scope` solo quelli dentro il gruppo isolato.
class Lookup implements Nested {
  private ids: Map<string, ElementPart> | null = null;
  private readonly contexts = new Map<ContainerNode, Context | null>();

  constructor(
    private readonly model: DocumentModel,
    private readonly scope: ContainerNode | null,
    private readonly rootStyle: Style,
    private readonly attrsOf: (node: ElementPart) => readonly PaintAttr[] | null,
    private readonly make: MakeUnit,
  ) {}

  resolve(key: string): Unit | null {
    const node = key.startsWith("@") ? this.byPath(key.slice(1)) : this.byId(key);
    if (node === null || !pickable(node) || node.details!.locked === true) return null;
    const parent = node.parent;
    if (parent === null || (this.scope !== null && !within(node, this.scope))) return null;
    const context = this.contextOf(parent);
    if (context === null) return null;
    const index = elementChildren(parent).indexOf(node);
    if (index < 0) return null;
    const unit = this.make(node, [...context.path, index], context.layer, context.matrix, context.style);
    return unit !== null && unit.key === key ? unit : null;
  }

  childrenOf(container: ContainerNode): Unit[] {
    const role = container.details?.role;
    if (role !== "group" && role !== "link") return [];
    if (this.scope !== null && container !== this.scope && !within(container, this.scope)) return [];
    const context = this.contextOf(container);
    if (context === null) return [];
    const out: Unit[] = [];
    childLoop(container, (child, index) => {
      if (pickable(child) && child.details!.locked !== true) push(out, this.make(child, [...context.path, index], context.layer, context.matrix, context.style));
    });
    return out;
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
    if (container === this.model.root) return { path: [], layer: null, matrix: IDENTITY, style: this.rootStyle };
    const parent = container.parent;
    const details = container.details;
    if (parent === null || details === null || details.locked === true) return null;
    const isLayer = details.role === "layer";
    if (isLayer ? parent !== this.model.root : details.role !== "group" && details.role !== "link") return null;
    const index = elementChildren(parent).indexOf(container);
    const outer = index < 0 ? null : this.contextOf(parent);
    const attrs = this.attrsOf(container);
    if (outer === null || attrs === null || hidden(attrs)) return null;
    return {
      path: [...outer.path, index],
      layer: isLayer ? container.facts.id : outer.layer,
      matrix: compose(outer.matrix, transformOf(attrs)),
      style: styleOf(outer.style, attrs),
    };
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
/// la descrizione, un livello o un blocco estraneo.
function pickable(node: ElementPart): boolean {
  const role = node.details?.role;
  return role !== undefined && role !== "paper" && role !== "title" && role !== "desc" && role !== "layer";
}

/// Vero se `node` sta dentro `container`, a qualunque profondità.
function within(node: ElementPart, container: ContainerNode): boolean {
  for (let current = node.parent; current !== null; current = current.parent) if (current === container) return true;
  return false;
}

function push(out: Unit[], unit: Unit | null): void {
  if (unit !== null) out.push(unit);
}

// ---------------------------------------------------------------------------
// Lettura degli attributi dipinti.
// ---------------------------------------------------------------------------

function childLoop(container: ContainerNode, visit: (child: ElementPart, index: number) => void): void {
  let index = 0;
  for (const part of container.parts) {
    if (typeof part === "string" || part.kind === "other") continue;
    visit(part, index++);
  }
}

function attr(attrs: readonly PaintAttr[], name: string): string | undefined {
  for (const [key, value] of attrs) if (key === name) return value;
  return undefined;
}

function hidden(attrs: readonly PaintAttr[]): boolean {
  return attr(attrs, "display")?.trim() === "none";
}

function transformOf(attrs: readonly PaintAttr[]): Matrix {
  const value = attr(attrs, "transform");
  return value === undefined ? IDENTITY : parseTransform(value) ?? IDENTITY;
}

function styleOf(parent: Style, attrs: readonly PaintAttr[]): Style {
  const fill = attr(attrs, "fill");
  const stroke = attr(attrs, "stroke");
  const width = attr(attrs, "stroke-width");
  const size = attr(attrs, "font-size");
  const anchor = attr(attrs, "text-anchor");
  const family = attr(attrs, "font-family");
  const weight = attr(attrs, "font-weight");
  if (fill === undefined && stroke === undefined && width === undefined && size === undefined && anchor === undefined && family === undefined && weight === undefined) {
    return parent;
  }
  return {
    fill: fill === undefined ? parent.fill : fill.trim() !== "none",
    stroke: stroke === undefined ? parent.stroke : stroke.trim() !== "none",
    strokeWidth: width === undefined ? parent.strokeWidth : Math.max(0, length(width) ?? parent.strokeWidth),
    fontSize: size === undefined ? parent.fontSize : nonNegativeLength(size) ?? parent.fontSize,
    anchor: anchor === undefined ? parent.anchor : anchor.trim(),
    family: family === undefined ? parent.family : family.trim(),
    weight: weight === undefined ? parent.weight : weight.trim(),
    color: fill === undefined ? parent.color : fill.trim(),
  };
}

function len(attrs: readonly PaintAttr[], name: string): number | null {
  const value = attr(attrs, name);
  return value === undefined ? null : length(value);
}

/// I raggi di un'ellisse o degli angoli di un rettangolo: in SVG 2 un raggio
/// assente vale l'altro.
function radii(attrs: readonly PaintAttr[]): Point {
  const rx = len(attrs, "rx");
  const ry = len(attrs, "ry");
  return [rx ?? ry ?? 0, ry ?? rx ?? 0];
}

/// Un'ellisse come quattro archi, che il riquadro e l'appiattimento sanno
/// trattare esattamente.
function ellipsePath(cx: number, cy: number, rx: number, ry: number): Segment[] {
  if (!(rx > 0) || !(ry > 0)) return [];
  const arc = (to: Point): Segment => ({ kind: "arc", radii: [rx, ry], rotation: 0, large: false, sweep: true, to });
  return [
    { kind: "move", to: [cx + rx, cy] },
    arc([cx, cy + ry]),
    arc([cx - rx, cy]),
    arc([cx, cy - ry]),
    arc([cx + rx, cy]),
    { kind: "close" },
  ];
}

/// I segmenti di una forma nelle sue coordinate: il tracciato con cui SVG 2
/// la definisce, dallo stesso punto e nello stesso verso.
export function shapeSegments(tag: string, attrs: readonly PaintAttr[]): readonly Segment[] {
  const at = (name: string): number => len(attrs, name) ?? 0;
  switch (tag) {
    case "path": {
      const d = attr(attrs, "d");
      return d === undefined ? [] : parsePath(d) ?? [];
    }
    case "rect": {
      const [w, h] = [at("width"), at("height")];
      // SVG non disegna un rettangolo con un lato nullo.
      if (!(w > 0) || !(h > 0)) return [];
      const [rx, ry] = radii(attrs);
      return rectPath(at("x"), at("y"), w, h, rx, ry);
    }
    case "image": {
      const [w, h] = [at("width"), at("height")];
      if (!(w > 0) || !(h > 0)) return [];
      return rectPath(at("x"), at("y"), w, h, 0, 0);
    }
    case "ellipse": {
      const [rx, ry] = radii(attrs);
      return ellipsePath(at("cx"), at("cy"), rx, ry);
    }
    case "circle":
      return ellipsePath(at("cx"), at("cy"), at("r"), at("r"));
    case "line":
      return [{ kind: "move", to: [at("x1"), at("y1")] }, { kind: "line", to: [at("x2"), at("y2")] }];
    case "polyline":
    case "polygon": {
      const value = attr(attrs, "points");
      const list = value === undefined ? null : parsePoints(value);
      if (list === null || list.length === 0) return [];
      const segments: Segment[] = list.map((p, i) => ({ kind: i === 0 ? "move" : "line", to: p }) as Segment);
      if (tag === "polygon") segments.push({ kind: "close" });
      return segments;
    }
    default:
      return [];
  }
}

/// Quanto è largo un carattere, e dove stanno sopra e sotto la linea di base
/// i bordi di una riga, in volte il corpo: una stima, la misura vera dipende
/// dai caratteri.
const CHAR_EM = 0.6;
const ASCENT_EM = 0.8;
const DESCENT_EM = 0.25;

/// Dove comincia una riga larga `width` col punto d'ancoraggio in `x`.
function lineStart(x: number, width: number, anchor: string): number {
  return anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
}

/// Quanti caratteri si leggono in `text`: gli spazi in fila contano uno, ai
/// bordi niente, come li mostra SVG.
function readable(text: string): number {
  return [...text.replace(/\s+/g, " ").trim()].length;
}

/// Le righe di un testo come rettangoli: l'altezza va da 0,8 em sopra la
/// linea di base a 0,25 em sotto, la larghezza è 0,6 em per carattere.
function textSegments(attrs: readonly PaintAttr[], runs: readonly TextRun[], style: Style): Segment[] {
  const x = len(attrs, "x") ?? 0;
  let y = len(attrs, "y") ?? 0;
  const segments: Segment[] = [];
  for (const run of runs) {
    if (run.kind !== "span") continue;
    const size = len(run.attrs, "font-size") ?? style.fontSize;
    y += len(run.attrs, "dy") ?? 0;
    const lineX = len(run.attrs, "x") ?? x;
    const chars = readable(run.text);
    if (chars === 0) continue;
    const width = CHAR_EM * size * chars;
    const anchor = attr(run.attrs, "text-anchor")?.trim() ?? style.anchor;
    segments.push(...rectPath(lineStart(lineX, width, anchor), y - ASCENT_EM * size, width, (ASCENT_EM + DESCENT_EM) * size, 0, 0));
  }
  return segments;
}

/// Come si vede il testo `shape` con lo stile `style`, che comprende i suoi
/// attributi: la prima riga dà ancoraggio e corpo. Il passo è quello che
/// l'operazione `text` dà a una riga nuova: il `dy` dell'ultima riga dopo la
/// prima che lo scrive, oppure 1,25 volte il corpo dell'ultima riga.
function textLook(shape: PaintShape | null, style: Style): TextLook {
  const attrs = shape?.attrs ?? [];
  const spans = (shape?.runs ?? []).filter((run) => run.kind === "span");
  const first = spans[0]?.attrs ?? [];
  const size = len(first, "font-size") ?? style.fontSize;
  let step: number | null = null;
  for (let k = spans.length - 1; k >= 1 && step === null; k--) step = len(spans[k]!.attrs, "dy");
  const last = spans.length === 0 ? style.fontSize : len(spans[spans.length - 1]!.attrs, "font-size") ?? style.fontSize;
  const anchor = attr(first, "text-anchor")?.trim() ?? style.anchor;
  return {
    x: len(first, "x") ?? len(attrs, "x") ?? 0,
    y: (len(attrs, "y") ?? 0) + (len(first, "dy") ?? 0),
    size,
    leading: step !== null && step > 0 ? step : last * 1.25,
    anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
    family: attr(first, "font-family")?.trim() ?? style.family,
    weight: attr(first, "font-weight")?.trim() ?? style.weight,
    color: attr(first, "fill")?.trim() ?? style.color,
  };
}

/// Il riquadro nella scena delle righe `lines` scritte come `look`, con
/// `matrix` dalle coordinate del testo a quelle della scena: la stessa stima
/// con cui poi le si tocca. `null` se non c'è niente da leggere.
export function linesBounds(look: TextLook, lines: readonly string[], matrix: Matrix): Bounds | null {
  const out = new BoundsBuilder();
  lines.forEach((line, i) => {
    const chars = readable(line);
    if (chars === 0) return;
    const width = CHAR_EM * look.size * chars;
    const left = lineStart(look.x, width, look.anchor);
    const top = look.y + i * look.leading - ASCENT_EM * look.size;
    out.path(rectPath(left, top, width, (ASCENT_EM + DESCENT_EM) * look.size, 0, 0), matrix);
  });
  return out.finish();
}

/// Il riquadro nella scena di una forma che uno strumento sta per scrivere,
/// contorno compreso: la stessa geometria con cui poi la si tocca. `matrix`
/// porta le coordinate del livello nella scena.
export function elemBounds(elem: Elem, matrix: Matrix): Bounds | null {
  const attrs: PaintAttr[] = Object.entries(elem.attrs);
  const style = styleOf(INITIAL, attrs);
  const segments = elem.tag === "text"
    ? textSegments(attrs, (elem.children ?? []).map((child): TextRun => ({ kind: "span", attrs: Object.entries(child.attrs), space: null, text: child.text ?? "" })), style)
    : shapeSegments(elem.tag, attrs);
  const bounds = transformedBounds(segments, matrix);
  if (bounds === null) return null;
  const out = new BoundsBuilder();
  includeInflated(out, bounds, style.stroke ? (style.strokeWidth / 2) * scaleOf(matrix) : 0);
  return out.finish();
}

// ---------------------------------------------------------------------------
// Riquadri.
// ---------------------------------------------------------------------------

function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]);
}

/// Il fattore medio con cui `m` cambia le lunghezze: esatto per una
/// similitudine, una stima per una scala diversa sui due assi.
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function transformedBounds(segments: readonly Segment[], m: Matrix): Bounds | null {
  const out = new BoundsBuilder();
  out.path(segments, m);
  return out.finish();
}

function localBounds(part: Part): Bounds | null {
  const cache = part.cache!;
  if (cache.local === undefined) cache.local = transformedBounds(part.segments, IDENTITY);
  return cache.local;
}

/// Vero se `inner` sta tutto dentro `outer`.
function holds(outer: Bounds, inner: Bounds): boolean {
  return inner.min[0] >= outer.min[0] && inner.max[0] <= outer.max[0] && inner.min[1] >= outer.min[1] && inner.max[1] <= outer.max[1];
}

function includeInflated(out: BoundsBuilder, bounds: Bounds, by: number): void {
  out.include([bounds.min[0] - by, bounds.min[1] - by]);
  out.include([bounds.max[0] + by, bounds.max[1] + by]);
}

/// Vero se il segmento da `a` a `b`, allargato di `tolerance`, incontra
/// `bounds`.
function near(bounds: Bounds | null, a: Point, b: Point, tolerance: number): boolean {
  if (bounds === null) return false;
  return Math.max(a[0], b[0]) + tolerance >= bounds.min[0] && Math.min(a[0], b[0]) - tolerance <= bounds.max[0]
    && Math.max(a[1], b[1]) + tolerance >= bounds.min[1] && Math.min(a[1], b[1]) - tolerance <= bounds.max[1];
}

// ---------------------------------------------------------------------------
// Appiattimento.
// ---------------------------------------------------------------------------

function flatten(part: Part): Flat {
  if (part.flat !== null) return part.flat;
  const m = part.matrix;
  const runs: Run[] = [];
  let points: number[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  const push = (p: Point): void => {
    points.push(p[0], p[1]);
  };
  const finish = (closed: boolean): void => {
    if (points.length >= 2) runs.push({ points: Float64Array.from(points), closed });
    points = [];
  };
  for (const segment of part.segments) {
    switch (segment.kind) {
      case "move":
        finish(false);
        current = segment.to;
        start = segment.to;
        push(apply(m, current));
        break;
      case "line":
        if (points.length === 0) push(apply(m, current));
        push(apply(m, segment.to));
        current = segment.to;
        break;
      case "quad": {
        if (points.length === 0) push(apply(m, current));
        const p0 = apply(m, current);
        const p1 = apply(m, segment.control);
        const p2 = apply(m, segment.to);
        const dd = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
        const n = steps(Math.sqrt((0.25 * dd) / FLATNESS));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
        }
        current = segment.to;
        break;
      }
      case "cubic": {
        if (points.length === 0) push(apply(m, current));
        const p0 = apply(m, current);
        const p1 = apply(m, segment.c1);
        const p2 = apply(m, segment.c2);
        const p3 = apply(m, segment.to);
        const dd = Math.max(
          Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
          Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
        );
        const n = steps(Math.sqrt((0.75 * dd) / FLATNESS));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
        }
        current = segment.to;
        break;
      }
      case "arc":
        if (points.length === 0) push(apply(m, current));
        for (const p of arcPoints(current, segment.radii, segment.rotation, segment.large, segment.sweep, segment.to, m)) push(p);
        current = segment.to;
        break;
      case "close":
        if (points.length === 0) push(apply(m, current));
        finish(true);
        current = start;
        break;
    }
  }
  finish(false);
  part.flat = { runs, radius: part.radius * scaleOf(m) };
  return part.flat;
}

function steps(estimate: number): number {
  return Number.isFinite(estimate) ? Math.min(MAX_STEPS, Math.max(1, Math.ceil(estimate))) : 1;
}

/// I punti di un arco ellittico dopo `from`, fino a `to` compreso, portati
/// nella scena da `m`: la conversione al centro delle note di SVG (F.6.5).
function arcPoints(from: Point, radii: Point, rotation: number, large: boolean, sweep: boolean, to: Point, m: Matrix): Point[] {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const arc = arcCenter(from, { kind: "arc", radii, rotation, large, sweep, to });
  if (arc === null) return [apply(m, to)];
  // Il passo angolare che tiene la corda entro `FLATNESS` dall'arco, sul
  // raggio più grande nella scena.
  const radius = Math.max(arc.radii[0], arc.radii[1]) * Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
  const angle = radius > FLATNESS ? 2 * Math.acos(fmin(1, 1 - FLATNESS / radius)) : Math.PI / 2;
  const n = steps(Math.abs(arc.delta) / angle);
  const out: Point[] = [];
  for (let i = 1; i < n; i++) out.push(apply(m, onEllipse(arc, arc.start + (arc.delta * i) / n)));
  out.push(apply(m, to));
  return out;
}

// ---------------------------------------------------------------------------
// Prove di contatto.
// ---------------------------------------------------------------------------

/// Il numero di avvolgimento di `p` rispetto a tutti i sottotracciati, chiusi
/// come li chiude il riempimento.
function winding(flat: Flat, p: Point): number {
  let total = 0;
  const [px, py] = p;
  for (const run of flat.runs) {
    const pts = run.points;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[2 * i]!;
      const ay = pts[2 * i + 1]!;
      const j = i + 1 === n ? 0 : i + 1;
      const bx = pts[2 * j]!;
      const by = pts[2 * j + 1]!;
      if (ay <= py) {
        if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) total++;
      } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) {
        total--;
      }
    }
  }
  return total;
}

/// Ogni lato dei sottotracciati: quelli chiusi anche dall'ultimo punto al
/// primo, e quelli aperti di un riempimento.
function forEachEdge(flat: Flat, fill: boolean, visit: (ax: number, ay: number, bx: number, by: number) => boolean): boolean {
  for (const run of flat.runs) {
    const pts = run.points;
    const n = pts.length / 2;
    if (n === 1 && visit(pts[0]!, pts[1]!, pts[0]!, pts[1]!)) return true;
    for (let i = 0; i + 1 < n; i++) {
      if (visit(pts[2 * i]!, pts[2 * i + 1]!, pts[2 * i + 2]!, pts[2 * i + 3]!)) return true;
    }
    if (n > 2 && (run.closed || fill) && visit(pts[2 * n - 2]!, pts[2 * n - 1]!, pts[0]!, pts[1]!)) return true;
  }
  return false;
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/// La distanza fra i segmenti `ab` e `cd`: zero se si incrociano.
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointSegmentDistance(bx, by, cx, cy, dx, dy),
    pointSegmentDistance(cx, cy, ax, ay, bx, by),
    pointSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

function partBounds(part: Part): Bounds | null {
  const cache = part.cache;
  if (cache !== null && cache.scene !== null && sameMatrix(cache.scene.matrix, part.matrix)) return cache.scene.bounds;
  return transformedBounds(part.segments, part.matrix);
}

function partHits(part: Part, p: Point, tolerance: number): boolean {
  const radius = part.radius * scaleOf(part.matrix);
  if (!near(partBounds(part), p, p, tolerance + radius)) return false;
  const flat = flatten(part);
  if (part.fill && winding(flat, p) !== 0) return true;
  const reach = flat.radius + tolerance;
  return forEachEdge(flat, part.fill, (ax, ay, bx, by) => pointSegmentDistance(p[0], p[1], ax, ay, bx, by) <= reach);
}

function partTouches(part: Part, a: Point, b: Point, tolerance: number): boolean {
  const radius = part.radius * scaleOf(part.matrix);
  if (!near(partBounds(part), a, b, tolerance + radius)) return false;
  const flat = flatten(part);
  if (part.fill && (winding(flat, a) !== 0 || winding(flat, b) !== 0)) return true;
  const reach = flat.radius + tolerance;
  return forEachEdge(flat, part.fill, (cx, cy, dx, dy) => segmentDistance(a[0], a[1], b[0], b[1], cx, cy, dx, dy) <= reach);
}
