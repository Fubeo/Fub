// Chi fa l'indice: visita la scena e ne trae le unità, con lo stile ereditato,
// i livelli, i simboli e i ritagli (vedi `../hit.ts`).

import { BoundsBuilder, parsePath, rectPath, Track, type Bounds, type Segment } from "../../scene/geometry";
import { markerMatrix, placed, vertices, type Vertex } from "../../scene/markers";
import { compose, IDENTITY, invert, type Matrix } from "../../scene/matrix";
import {
  originalOf,
  tagName,
  type ContainerNode,
  type DocumentModel,
  type ElementPart,
  type LeafNode,
} from "../../scene/model";
import type { Elem } from "../../scene/serialize";
import { reference } from "../../scene/values";
import type { PaintAttr, PaintBuilder, PaintNode, PaintResource, PaintShape } from "../../painter/paint";
import { Clip, needsBox, Region, sameMatrix, scaleOf, transformedBounds, type ClipLook } from "../clips";
import {
  type Holder,
  INITIAL,
  type LayerInfo,
  MAX_INSTANCE_PARTS,
  MAX_SYMBOL_DEPTH,
  type Part,
  type ShapeCache,
  type Style,
  type SymbolInfo,
  type Via,
} from "./base";
import { ForeignShapes } from "./foreign";
import { fixed, includeInflated, includeSeen } from "./geometry";
import { childLoop, defsChild, hasLink, Lookup, pickable, push, symbolPath } from "./lookup";
import { SceneIndex } from "./scene-index";
import {
  attr,
  clipLook,
  elemBounds,
  elemSegments,
  hidden,
  MARKED,
  MARKER_PROPERTIES,
  type MarkerLook,
  markerLook,
  shapeSegments,
  styleOf,
  textLook,
  textSegments,
  transformOf,
} from "./shapes";
import { ForeignBlock, Unit } from "./unit";

/// Chi riceve gli oggetti di un documento: il nodo, il suo percorso, il
/// livello, la matrice e lo stile del genitore, e i ritagli e le maschere di
/// chi lo contiene.
type Visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null) => void;

/// Chi riceve i blocchi estranei fuori dagli oggetti: il blocco, la matrice
/// e lo stile del genitore, il suo percorso, e i ritagli e le maschere del
/// genitore.
type ForeignVisit = (leaf: LeafNode, parent: Matrix, style: Style, path: readonly number[], clips: readonly Clip[] | null) => void;

/// Costruisce gli indici di un documento, ricordando la geometria delle
/// forme che non cambiano fra una scena e l'altra.
export class SceneIndexer {
  private cache = new WeakMap<PaintShape, ShapeCache>();
  private tracks = new WeakMap<PaintResource, Track | null>();
  private markers = new WeakMap<PaintResource, MarkerLook | null>();
  private looks = new WeakMap<PaintResource, ClipLook | null>();
  /// Il contenuto dei simboli, per gruppo dipinto: il gruppo cambia quando
  /// cambia il contenuto.
  private symbolInfos = new WeakMap<PaintNode, SymbolInfo>();
  /// Il riquadro degli originali delle copie, per nodo dipinto.
  private originalBoxes = new WeakMap<PaintNode, Bounds | null>();
  /// Gli oggetti già misurati che dipendono soltanto dal loro elemento e da
  /// dove stanno: dopo un tratto, l'indice nuovo misura di nuovo solo ciò
  /// che è cambiato.
  private known = new WeakMap<LeafNode, KnownUnit>();
  /// Quanti simboli si stanno attraversando, uno dentro l'altro.
  private depth = 0;
  /// Mentre si misura un simbolo, quelli che il suo contenuto usa.
  private reached: Map<ContainerNode, PaintNode | undefined> | null = null;
  private readonly foreign: ForeignShapes;

  /// `holder` trova gli elementi a cui i blocchi estranei rimandano; senza,
  /// un `use` vede solo il blocco in cui sta.
  ///
  /// `pages`, nelle annotazioni di un PDF, dà i gruppi della pagina che si
  /// annota: sono i soli figli della radice che contano, trattati come
  /// livelli che si scrivono, per l'indice e per ogni altra ricerca.
  constructor(
    private readonly builder: PaintBuilder,
    private readonly holder: Holder | null = null,
    private readonly pages: ((model: DocumentModel) => readonly ContainerNode[]) | null = null,
  ) {
    this.foreign = new ForeignShapes(builder, holder);
  }

  /// L'indice di `model`, che il `PaintBuilder` ha appena disegnato. Con
  /// `scope`, un gruppo o un collegamento isolato, gli oggetti sono i suoi
  /// figli, e fuori non si sceglie niente.
  ///
  /// `through` sono le istanze da cui si entra nei simboli, dalla più
  /// esterna: il contenuto di un simbolo sta nelle coordinate dell'istanza,
  /// con lo stile e i ritagli che lei gli dà. Così si isola un simbolo, o un
  /// gruppo del suo contenuto.
  index(model: DocumentModel, scope: ContainerNode | null = null, through: readonly LeafNode[] = []): SceneIndex {
    const units: Unit[] = [];
    const layers: LayerInfo[] = [];
    const nested = new Lookup(
      model,
      scope,
      through,
      this.rootStyle(model),
      (node) => this.attrsOf(node),
      (node, path, layer, parent, style, clips) => this.unit(node, path, layer, parent, style, clips),
      (node, attrs, matrix, style, outer) => this.clipsOf(node, attrs, matrix, style, outer),
      this.pagesOf(model),
    );
    if (scope === null) {
      this.walk(model, (layer) => !layer.locked && !layer.hidden, layers, (node, path, layer, parent, style, clips) => {
        if (node.details!.locked === true) return;
        push(units, this.unit(node, path, layer, parent, style, clips));
      });
    } else {
      this.walk(model, () => false, layers, () => {});
      units.push(...nested.childrenOf(scope));
    }
    return new SceneIndex(units, layers, nested);
  }

  /// Il riquadro nella scena di `elem`, la forma che uno strumento scrive al
  /// posto di `leaf`, come [`elemBounds`], con le punte che nomina, lette
  /// fra le risorse del documento di `leaf`: come lo avrà la forma scritta.
  writtenBounds(elem: Elem, matrix: Matrix, leaf: LeafNode): Bounds | null {
    const bounds = elemBounds(elem, matrix);
    const attrs: PaintAttr[] = Object.entries(elem.attrs);
    if (bounds === null || !MARKED.has(elem.tag) || MARKER_PROPERTIES.every(([, name]) => attr(attrs, name) === undefined)) return bounds;
    const style = styleOf(INITIAL, attrs);
    const host: Part = { leaf, segments: elemSegments(elem, attrs, style), matrix, frameMatrix: matrix, fill: false, radius: 0, cache: null, flat: null, host: null, regions: null, via: null };
    const tips: Part[] = [];
    this.tips(host, attrs, style, tips);
    const out = new BoundsBuilder();
    includeInflated(out, bounds, 0);
    for (const part of tips) {
      const local = transformedBounds(part.segments, part.matrix);
      if (local !== null) includeInflated(out, local, part.radius * scaleOf(part.matrix));
    }
    return out.finish();
  }

  /// Vero se dentro `container`, un gruppo, un collegamento o un simbolo di
  /// `model`, si sceglie: se sta nel documento, e né lui né chi lo contiene
  /// è bloccato o nascosto. In un simbolo si entra soltanto da un'istanza di
  /// `through`, come per [`index`], che si veda e non sia bloccata.
  opens(model: DocumentModel, container: ContainerNode, through: readonly LeafNode[] = []): boolean {
    const role = container.details?.role;
    if (role !== "group" && role !== "link" && role !== "symbol") return false;
    return new Lookup(model, null, through, this.rootStyle(model), (node) => this.attrsOf(node), () => null, (_node, _attrs, _matrix, _style, outer) => outer, this.pagesOf(model)).contextOf(container) !== null;
  }

  /// I collegamenti di `model` che si vedono, a ogni profondità: anche
  /// quelli dentro un gruppo, e quelli dei livelli bloccati che l'indice non
  /// tocca, perché un collegamento si apre anche lì. La chiave di uno dentro
  /// un gruppo non è una chiave della selezione.
  ///
  /// Un collegamento nel contenuto di un simbolo si apre da ogni istanza, e
  /// c'è una volta per istanza, fino a [`MAX_INSTANCE_PARTS`] collegamenti.
  links(model: DocumentModel): Unit[] {
    const units: Unit[] = [];
    const linked = new Map<ContainerNode, boolean>();
    let depth = 0;
    const visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null): void => {
      if (node.details === null || units.length >= MAX_INSTANCE_PARTS) return;
      if (node.details.role === "link") {
        push(units, this.unit(node, path, layer, parent, style, clips));
        return;
      }
      const symbol = node.details.role === "instance" ? this.symbolNode(node, node.details.symbol!) : null;
      if (node.kind !== "container" && (symbol === null || depth >= MAX_SYMBOL_DEPTH || !hasLink(symbol, linked))) return;
      const attrs = this.attrsOf(node);
      if (attrs === null || hidden(attrs)) return;
      const matrix = compose(parent, transformOf(attrs));
      const inner = styleOf(style, attrs);
      const below = this.clipsOf(node, attrs, matrix, inner, clips);
      const container = symbol ?? (node as ContainerNode);
      const at = symbol === null ? path : symbolPath(symbol);
      if (symbol !== null) depth++;
      childLoop(container, (child, index) => visit(child, [...at, index], layer, matrix, inner, below));
      if (symbol !== null) depth--;
    };
    this.walk(model, (layer) => !layer.hidden, [], visit);
    return units;
  }

  /// Gli oggetti di `model` che si vedono, anche quelli bloccati che
  /// l'indice non tocca: ciò su cui le guide intelligenti si allineano. Dei
  /// contenitori `open`, il gruppo isolato e quelli da cui si sposta un
  /// oggetto, i figli uno per uno al posto del tutto; delle istanze di
  /// `through`, da cui si modifica un simbolo, il suo contenuto.
  seen(model: DocumentModel, open: ReadonlySet<ContainerNode> = new Set(), through: readonly LeafNode[] = []): Unit[] {
    const units: Unit[] = [];
    const visit = (node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null): void => {
      const entered = node.kind === "leaf" && through.includes(node) ? this.symbolNode(node, node.details!.symbol!) : null;
      if (entered === null && (node.kind !== "container" || !open.has(node))) {
        push(units, this.unit(node, path, layer, parent, style, clips));
        return;
      }
      const attrs = this.attrsOf(node);
      if (attrs === null || hidden(attrs)) return;
      const matrix = compose(parent, transformOf(attrs));
      const inner = styleOf(style, attrs);
      const below = this.clipsOf(node, attrs, matrix, inner, clips);
      const container = entered ?? (node as ContainerNode);
      const at = entered === null ? path : symbolPath(entered);
      childLoop(container, (child, index) => {
        if (pickable(child)) visit(child, [...at, index], layer, matrix, inner, below);
      });
    };
    this.walk(model, (layer) => !layer.hidden, [], visit);
    return units;
  }

  /// Gli oggetti di `model` che una tavola porta con sé quando si sposta:
  /// quelli che non sono bloccati né stanno in un livello bloccato, anche
  /// nascosti o in un livello nascosto, che altrimenti si ritroverebbero
  /// altrove quando tornano a vedersi. Il riquadro di uno nascosto è quello
  /// che avrebbe se si vedesse.
  movable(model: DocumentModel): Unit[] {
    const units: Unit[] = [];
    this.walk(model, (layer) => !layer.locked, [], (node, path, layer, parent, style, clips) => {
      if (node.details!.locked !== true) push(units, this.unit(node, path, layer, parent, style, clips, true));
    });
    return units;
  }

  /// Il riquadro di tutto ciò che `model` disegna, contorno compreso: anche
  /// gli oggetti dei livelli bloccati o nascosti, che l'indice non tocca ma
  /// che restano nel disegno. `null` se non disegna niente.
  extent(model: DocumentModel): Bounds | null {
    const units: Unit[] = [];
    const parts: Part[] = [];
    this.walk(
      model,
      () => true,
      [],
      (node, path, layer, parent, style, clips) => push(units, this.unit(node, path, layer, parent, style, clips)),
      (leaf, parent, style, _path, clips) => this.estimate(leaf, parent, IDENTITY, style, fixed(clips), parts),
    );
    const out = new BoundsBuilder();
    for (const unit of units) {
      if (unit.bounds === null) continue;
      out.include(unit.bounds.min);
      out.include(unit.bounds.max);
    }
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds !== null) includeSeen(out, part, bounds, part.radius * scaleOf(part.matrix), "scene");
    }
    return out.finish();
  }

  /// I blocchi estranei di `model` che si vedono fuori dagli oggetti, in
  /// ordine di documento: si vedono come uno strato immagine, ma non si
  /// scelgono.
  foreignBlocks(model: DocumentModel): ForeignBlock[] {
    const out: ForeignBlock[] = [];
    this.walk(model, (layer) => !layer.hidden, [], () => {}, (leaf, parent, style, path, clips) => {
      const parts: Part[] = [];
      this.estimate(leaf, parent, IDENTITY, style, fixed(clips), parts);
      if (parts.length > 0) out.push(new ForeignBlock(path, parts));
    });
    return out;
  }

  /// Il riquadro nella scena di `node`, un elemento di `model`, contorno
  /// compreso, come se né lui né chi lo contiene fosse nascosto: ciò che la
  /// sua miniatura inquadra, e la miniatura mostra ciò che ritagli e
  /// maschere lasciano vedere. Ciò che è nascosto dentro di lui non conta.
  /// `null` se non disegna niente, o se non è del disegno.
  frameOf(model: DocumentModel, node: ElementPart): Bounds | null {
    if (node.kind === "leaf" && node.details === null) return null;
    const chain: ContainerNode[] = [];
    for (let at = node.parent; at !== null && at !== model.root; at = at.parent) chain.unshift(at);
    let matrix = IDENTITY;
    let style = this.rootStyle(model);
    let clips: readonly Clip[] | null = null;
    for (const container of chain) {
      const attrs = this.builder.headInfo(container).attrs;
      matrix = compose(matrix, transformOf(attrs));
      style = styleOf(style, attrs);
      clips = this.clipsOf(container, attrs, matrix, style, clips);
    }
    const attrs = this.attrsOf(node);
    if (attrs === null) return null;
    const own = compose(matrix, transformOf(attrs));
    const inner = styleOf(style, attrs);
    const parts: Part[] = [];
    this.collect(node, own, IDENTITY, inner, this.regionsOf(node, attrs, own, inner, clips), parts);
    const scene = new BoundsBuilder();
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds !== null) includeSeen(scene, part, bounds, part.radius * scaleOf(part.matrix), "scene");
    }
    return scene.finish();
  }

  /// I livelli di `model` in `layers`, e i suoi oggetti a `visit`: degli
  /// oggetti nei livelli, solo quelli dei livelli che `enters` accetta. I
  /// blocchi estranei degli stessi posti vanno a `foreign`, se c'è.
  private walk(
    model: DocumentModel,
    enters: (layer: LayerInfo) => boolean,
    layers: LayerInfo[],
    visit: Visit,
    foreign: ForeignVisit | null = null,
  ): void {
    const root = model.root;
    const rootStyle = this.rootStyle(model);
    const pages = this.pagesOf(model);
    childLoop(root, (child, index) => {
      if (pages !== null) {
        if (child.kind === "container" && pages.includes(child)) this.walkLayer(child, [index], "", false, false, rootStyle, enters, layers, visit, foreign);
        return;
      }
      if (child.kind === "leaf") {
        if (child.details === null) {
          foreign?.(child, IDENTITY, rootStyle, [index], null);
          return;
        }
        const role = child.details.role;
        if (role === "paper" || role === "board" || role === "title" || role === "desc") return;
        visit(child, [index], null, IDENTITY, rootStyle, null);
        return;
      }
      const role = child.details!.role;
      // Le risorse si vedono soltanto in chi le usa.
      if (role === "defs") return;
      if (role !== "layer") {
        visit(child, [index], null, IDENTITY, rootStyle, null);
        return;
      }
      const layer = child.details!.layer!;
      this.walkLayer(child, [index], layer.name, layer.locked, layer.hidden, rootStyle, enters, layers, visit, foreign);
    });
  }

  /// Un livello, o un gruppo di una pagina che ne fa le veci: in `layers`, e
  /// i suoi figli a `visit` se `enters` lo accetta, col ritaglio e la
  /// maschera del livello.
  private walkLayer(
    child: ContainerNode,
    path: number[],
    name: string,
    locked: boolean,
    hidden: boolean,
    rootStyle: Style,
    enters: (layer: LayerInfo) => boolean,
    layers: LayerInfo[],
    visit: Visit,
    foreign: ForeignVisit | null,
  ): void {
    const head = this.builder.headInfo(child);
    const matrix = compose(IDENTITY, transformOf(head.attrs));
    const info: LayerInfo = { id: child.facts.id, path, name, locked, hidden: hidden || head.hidden, matrix };
    layers.push(info);
    if (!enters(info)) return;
    const style = styleOf(rootStyle, head.attrs);
    const clips = this.clipsOf(child, head.attrs, matrix, style, null);
    childLoop(child, (grandchild, inner) => {
      if (grandchild.kind === "leaf") {
        if (grandchild.details === null) {
          foreign?.(grandchild, matrix, style, [...path, inner], clips);
          return;
        }
        if (grandchild.details.role === "title" || grandchild.details.role === "desc") return;
      }
      visit(grandchild, [...path, inner], info.id, matrix, style, clips);
    });
  }

  /// I gruppi della pagina che si annota; `null` per un disegno.
  private pagesOf(model: DocumentModel): readonly ContainerNode[] | null {
    return this.pages === null ? null : this.pages(model);
  }

  /// Lo stile che la radice di `model` trasmette ai figli.
  private rootStyle(model: DocumentModel): Style {
    return styleOf(INITIAL, this.builder.headInfo(model.root).attrs);
  }

  /// L'oggetto `node`, se si vede, o anche nascosto con `shown`. `clips` sono
  /// i ritagli e le maschere di chi lo contiene.
  private unit(node: ElementPart, path: number[], layer: string | null, parent: Matrix, style: Style, clips: readonly Clip[] | null, shown = false): Unit | null {
    const attrs = this.attrsOf(node);
    if (attrs === null || (!shown && hidden(attrs))) return null;
    const known = node.kind === "leaf" && clips === null ? this.known.get(node) : undefined;
    if (known !== undefined && known.attrs === attrs && known.unit.layer === layer && equalStyle(known.style, style) && sameMatrix(known.unit.parent, parent) && samePath(known.unit.path, path)) return known.unit;
    const own = transformOf(attrs);
    const matrix = compose(parent, own);
    const inner = styleOf(style, attrs);
    const parts: Part[] = [];
    this.collect(node, matrix, IDENTITY, inner, this.regionsOf(node, attrs, matrix, inner, clips), parts);
    const scene = new BoundsBuilder();
    const geometry = new BoundsBuilder();
    for (const part of parts) {
      const bounds = this.sceneBounds(part);
      if (bounds === null) continue;
      includeSeen(scene, part, bounds, part.radius * scaleOf(part.matrix), "scene");
      if (part.host === null) includeSeen(geometry, part, bounds, 0, "scene");
    }
    const id = node.facts.id;
    const tag = tagName(node);
    const look = node.kind === "leaf" && node.details!.role === "text" ? textLook(this.builder.shape(node), inner, node.details!.wrap ?? null, this.textTrack(node)) : null;
    const unit = new Unit(
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
    if (node.kind === "leaf" && clips === null && standalone(node, attrs)) this.known.set(node, { unit, attrs, style });
    return unit;
  }

  /// Gli attributi dipinti di un elemento; `null` se non disegna.
  private attrsOf(node: ElementPart): readonly PaintAttr[] | null {
    if (node.kind === "container") return this.builder.headInfo(node).attrs;
    const shape = this.builder.shape(node);
    return shape === null ? null : shape.attrs;
  }

  /// Le forme di `node` e dei suoi discendenti visibili. `matrix` porta le
  /// coordinate di `node` nella scena, `frame` in quelle dell'oggetto;
  /// `regions` sono i ritagli e le maschere che lo tagliano, i suoi compresi.
  ///
  /// Le forme del contenuto di un simbolo, attraverso un'istanza, hanno in
  /// `via` la più esterna.
  private collect(node: ElementPart, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via | null = null): void {
    if (node.kind === "leaf") {
      if (node.details!.role === "instance") {
        this.instance(node, matrix, frame, style, regions, out, via ?? { leaf: node, matrix });
        return;
      }
      if (node.details!.role === "copy") {
        this.copy(node, matrix, frame, style, regions, out, via ?? { leaf: node, matrix });
        return;
      }
      const shape = this.builder.shape(node)!;
      const part = this.part(node, shape, matrix, frame, style, regions, via);
      out.push(part);
      if (MARKED.has(shape.tag)) this.tips(part, shape.attrs, style, out);
      return;
    }
    this.children(node, matrix, frame, style, regions, out, via);
  }

  /// Le forme dei figli visibili di `container`, come [`collect`].
  private children(container: ContainerNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via | null): void {
    childLoop(container, (child) => {
      if (child.kind === "leaf" && child.details === null) {
        this.estimate(child, matrix, frame, style, regions, out, via);
        return;
      }
      const childAttrs = this.attrsOf(child);
      if (childAttrs === null || hidden(childAttrs)) return;
      const own = transformOf(childAttrs);
      const childMatrix = compose(matrix, own);
      const childFrame = compose(frame, own);
      const inner = styleOf(style, childAttrs);
      this.collect(child, childMatrix, childFrame, inner, this.regionsBelow(child, childAttrs, childMatrix, childFrame, inner, regions), out, via);
    });
  }

  /// Le forme di un'istanza: il contenuto del suo simbolo nelle sue
  /// coordinate, `matrix` e `frame`, con lo stile che lei trasmette. Oltre
  /// [`MAX_INSTANCE_PARTS`] forme nell'oggetto, il riquadro del simbolo.
  private instance(leaf: LeafNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via): void {
    const symbol = this.symbolNode(leaf, leaf.details!.symbol!);
    if (symbol === null || this.depth >= MAX_SYMBOL_DEPTH) return;
    const info = this.symbolInfo(symbol, style);
    if (out.length + info.parts > MAX_INSTANCE_PARTS) {
      const box = info.box;
      if (box === null) return;
      const segments = rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0);
      out.push({ leaf, segments, matrix, frameMatrix: frame, fill: true, radius: 0, cache: null, flat: null, host: null, regions, via });
      return;
    }
    this.depth++;
    try {
      this.children(symbol, matrix, frame, style, regions, out, via);
    } finally {
      this.depth--;
    }
  }

  /// Le forme di una copia: il suo originale nelle sue coordinate, `matrix`
  /// e `frame`, con la sua trasformazione, il suo stile e i suoi ritagli,
  /// come lo disegna un `use`. Oltre [`MAX_INSTANCE_PARTS`] forme
  /// nell'oggetto, il riquadro dell'originale.
  private copy(leaf: LeafNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via): void {
    const original = originalOf(leaf);
    const attrs = original === null ? null : this.attrsOf(original);
    if (attrs === null || hidden(attrs)) return;
    const own = transformOf(attrs);
    const inner = styleOf(style, attrs);
    const at = compose(matrix, own);
    const atFrame = compose(frame, own);
    const below = this.regionsBelow(original!, attrs, at, atFrame, inner, regions);
    if (out.length < MAX_INSTANCE_PARTS) {
      this.collect(original!, at, atFrame, inner, below, out, via);
      return;
    }
    const box = this.originalBox(original!, inner);
    if (box === null) return;
    const segments = rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0);
    out.push({ leaf, segments, matrix: at, frameMatrix: atFrame, fill: true, radius: 0, cache: null, flat: null, host: null, regions: below, via });
  }

  /// Il riquadro della geometria dell'originale `node`, misurato una volta
  /// per ciò che il painter ne disegna. Lo stile è quello della prima copia
  /// che lo chiede: conta soltanto per i testi.
  private originalBox(node: ElementPart, style: Style): Bounds | null {
    const [paint] = this.builder.paintsOf(node);
    const known = paint === undefined ? undefined : this.originalBoxes.get(paint);
    if (known !== undefined) return known;
    const box = this.objectBox(node, style);
    if (paint !== undefined) this.originalBoxes.set(paint, box);
    return box;
  }

  /// Quante forme dà il contenuto di `symbol`, a cascata, e il riquadro
  /// della sua geometria, senza contorni né marcatori: si misurano una volta
  /// per contenuto. Lo stile è quello della prima istanza che lo chiede:
  /// conta soltanto per i testi.
  private symbolInfo(symbol: ContainerNode, style: Style): SymbolInfo {
    const [paint] = this.builder.paintsOf(symbol);
    const outer = this.reached;
    const known = paint === undefined ? undefined : this.symbolInfos.get(paint);
    if (known !== undefined && (known.scene === null || known.scene === this.builder.built) && [...known.uses].every(([node, group]) => this.builder.paintsOf(node)[0] === group)) {
      if (outer !== null) for (const [node, group] of known.uses) outer.set(node, group);
      outer?.set(symbol, paint);
      return known;
    }
    const parts: Part[] = [];
    const uses = new Map<ContainerNode, PaintNode | undefined>();
    this.reached = uses;
    this.depth++;
    try {
      this.children(symbol, IDENTITY, IDENTITY, style, null, parts, null);
    } finally {
      this.depth--;
      this.reached = outer;
    }
    const box = new BoundsBuilder();
    for (const part of parts) {
      if (part.host !== null) continue;
      const bounds = transformedBounds(part.segments, part.matrix);
      if (bounds !== null) includeInflated(box, bounds, 0);
    }
    const info: SymbolInfo = { parts: parts.length, box: box.finish(), uses, scene: this.builder.drawsLive(symbol) ? null : this.builder.built };
    if (paint !== undefined) this.symbolInfos.set(paint, info);
    if (outer !== null) for (const [node, group] of uses) outer.set(node, group);
    outer?.set(symbol, paint);
    return info;
  }

  /// I ritagli e le maschere di `node`, un elemento con gli attributi dipinti
  /// `attrs`, dopo quelli di chi lo contiene, `outer`. `matrix` porta le
  /// coordinate di `node` nella scena e `style` è lo stile che trasmette ai
  /// figli, che serve a misurare il riquadro della sua geometria. Senza
  /// ritagli né maschere, `outer` com'è.
  private clipsOf(node: ElementPart, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, outer: readonly Clip[] | null): readonly Clip[] | null {
    let clipId: string | null = null;
    let maskId: string | null = null;
    for (const [name, value] of attrs) {
      if (name === "clip-path") clipId = reference(value);
      else if (name === "mask") maskId = reference(value);
    }
    if (clipId === null && maskId === null) return outer;
    const found: Clip[] = [];
    let box: Bounds | null | undefined;
    for (const [id, tag] of [[clipId, "clipPath"], [maskId, "mask"]] as const) {
      const look = id === null ? null : this.clipLook(node, id, tag);
      if (look === null) continue;
      if (needsBox(look) && box === undefined) box = this.objectBox(node, style);
      found.push(new Clip(look, matrix, box ?? null));
    }
    if (found.length === 0) return outer;
    return outer === null ? found : [...outer, ...found];
  }

  /// Le regioni di un oggetto `node`, la cui matrice nella scena è `matrix`:
  /// i ritagli e le maschere di chi lo contiene, `outer`, che restano dove
  /// sono quando l'oggetto si sposta, e i suoi, che vanno con lui.
  private regionsOf(node: ElementPart, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, outer: readonly Clip[] | null): readonly Region[] | null {
    const clips = this.clipsOf(node, attrs, matrix, style, outer);
    if (clips === null) return null;
    const back = outer === null ? null : invert(matrix);
    const fixed = outer === null ? 0 : outer.length;
    return clips.map((clip, at) => (at < fixed ? new Region(clip, back === null ? null : compose(back, clip.user), false) : new Region(clip, IDENTITY, true)));
  }

  /// Le regioni di una forma sotto `node`, un discendente dell'oggetto con
  /// `frame` dalle sue coordinate a quelle dell'oggetto: quelle di prima,
  /// `outer`, e le sue, che vanno con l'oggetto.
  private regionsBelow(
    node: ElementPart,
    attrs: readonly PaintAttr[],
    matrix: Matrix,
    frame: Matrix,
    style: Style,
    outer: readonly Region[] | null,
  ): readonly Region[] | null {
    const clips = this.clipsOf(node, attrs, matrix, style, null);
    if (clips === null) return outer;
    const added = clips.map((clip) => new Region(clip, frame, true));
    return outer === null ? added : [...outer, ...added];
  }

  /// Il riquadro della geometria di `node` nelle sue coordinate, senza
  /// contorno, punte, ritagli né maschere: `objectBoundingBox`. `style` è
  /// quello che trasmette ai figli. `null` se non disegna niente.
  private objectBox(node: ElementPart, style: Style): Bounds | null {
    const out = new BoundsBuilder();
    this.addGeometry(node, IDENTITY, style, out);
    return out.finish();
  }

  private addGeometry(node: ElementPart, matrix: Matrix, style: Style, out: BoundsBuilder): void {
    if (node.kind === "leaf") {
      if (node.details!.role === "instance") {
        // Il riquadro del simbolo, che si misura una volta.
        const symbol = this.symbolNode(node, node.details!.symbol!);
        const box = symbol === null || this.depth >= MAX_SYMBOL_DEPTH ? null : this.symbolInfo(symbol, style).box;
        if (box !== null) out.path(rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0), matrix);
        return;
      }
      if (node.details!.role === "copy") {
        const original = originalOf(node);
        const attrs = original === null ? null : this.attrsOf(original);
        if (attrs !== null && !hidden(attrs)) this.addGeometry(original!, compose(matrix, transformOf(attrs)), styleOf(style, attrs), out);
        return;
      }
      out.path(this.part(node, this.builder.shape(node)!, matrix, matrix, style, null).segments, matrix);
      return;
    }
    childLoop(node, (child) => {
      if (child.kind === "leaf" && child.details === null) {
        for (const shape of this.foreign.shapes(child, style)) out.path(shape.segments, compose(matrix, shape.matrix));
        return;
      }
      const attrs = this.attrsOf(child);
      if (attrs === null || hidden(attrs)) return;
      this.addGeometry(child, compose(matrix, transformOf(attrs)), styleOf(style, attrs), out);
    });
  }

  /// Il ritaglio o la maschera, secondo `tag`, di id `id` nel documento di
  /// `from`, letti e ricordati per risorsa; `null` se non c'è, se è un'altra
  /// risorsa o se non disegna niente.
  private clipLook(from: ElementPart, id: string, tag: "clipPath" | "mask"): ClipLook | null {
    const resource = this.liveResource(from, id);
    if (resource === null || resource.tag !== tag) return null;
    let look = this.looks.get(resource);
    if (look === undefined) {
      look = clipLook(resource);
      this.looks.set(resource, look);
    }
    return look;
  }

  private part(leaf: LeafNode, shape: PaintShape, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, via: Via | null = null): Part {
    let cache = this.cache.get(shape) ?? null;
    let segments: readonly Segment[];
    if (shape.tag === "text") {
      // Il riquadro di un testo dipende dallo stile ereditato, e dal suo
      // tracciato: non si ricorda.
      segments = textSegments(shape.attrs, shape.runs ?? [], style, leaf.details!.wrap ?? null, this.textTrack(leaf));
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
    return { leaf, segments, matrix, frameMatrix: frame, fill, radius, cache, flat: null, host: null, regions, via };
  }

  /// I marcatori di `host`, una forma con gli attributi `attrs` e lo stile
  /// `style`, che si disegnano sopra di lei: le punte delle linee. Un
  /// marcatore che non c'è o che non disegna niente non conta.
  private tips(host: Part, attrs: readonly PaintAttr[], style: Style, out: Part[]): void {
    let list: readonly Vertex[] | null = null;
    for (const [place, name] of MARKER_PROPERTIES) {
      const value = attr(attrs, name);
      const id = value === undefined ? null : reference(value);
      const look = id === null ? null : this.marker(host.leaf, id);
      if (look === null) continue;
      list ??= host.cache === null ? vertices(host.segments) : (host.cache.vertices ??= vertices(host.segments));
      for (const vertex of placed(list, place)) {
        const m = markerMatrix(look.fit, vertex, place, style.strokeWidth);
        for (const shape of look.shapes) {
          const local = compose(m, shape.matrix);
          out.push({
            leaf: host.leaf,
            segments: shape.segments,
            matrix: compose(host.matrix, local),
            frameMatrix: compose(host.frameMatrix, local),
            fill: shape.fill,
            radius: shape.radius,
            cache: null,
            flat: null,
            host,
            regions: host.regions,
            via: host.via,
          });
        }
      }
    }
  }

  /// La risorsa viva di id `id` nel documento di `from`; `null` se non c'è.
  private liveResource(from: ElementPart, id: string): PaintResource | null {
    const node = this.holder === null ? this.resourceNode(from, id) : this.holder(id);
    if (node === null || node.kind !== "leaf" || node.details?.role !== "resource") return null;
    return this.builder.resource(node);
  }

  /// Il marcatore vivo di id `id` nel documento di `leaf`, letto e ricordato
  /// per risorsa; `null` se non c'è o non disegna niente.
  private marker(leaf: LeafNode, id: string): MarkerLook | null {
    const resource = this.liveResource(leaf, id);
    if (resource === null || resource.tag !== "marker") return null;
    let look = this.markers.get(resource);
    if (look === undefined) {
      look = markerLook(resource);
      this.markers.set(resource, look);
    }
    return look;
  }

  /// Il tracciato misurato del testo su tracciato `leaf`: una risorsa del
  /// suo documento. `null` per un testo che non ne segue uno.
  private textTrack(leaf: LeafNode): Track | null {
    const id = leaf.details?.textPath;
    if (id === undefined) return null;
    const child = this.resourceNode(leaf, id);
    if (child === null) return null;
    const resource = this.builder.resource(child);
    let track = this.tracks.get(resource);
    if (track === undefined) {
      const d = resource.attrs.find(([name]) => name === "d")?.[1];
      const segments = d === undefined ? null : parsePath(d);
      track = segments === null ? null : new Track(segments);
      this.tracks.set(resource, track);
    }
    return track;
  }

  /// La risorsa di id `id` nelle `defs` della radice del documento di
  /// `from`; `null` se non c'è.
  private resourceNode(from: ElementPart, id: string): LeafNode | null {
    const found = defsChild(from, id, (child) => child.kind === "leaf" && child.details?.role === "resource");
    return found === null ? null : (found as LeafNode);
  }

  /// Il simbolo di id `id` del documento di `from`; `null` se non c'è.
  private symbolNode(from: ElementPart, id: string): ContainerNode | null {
    const isSymbol = (node: ElementPart): boolean => node.kind === "container" && node.details?.role === "symbol";
    const node = this.holder === null ? defsChild(from, id, isSymbol) : this.holder(id);
    return node !== null && isSymbol(node) ? (node as ContainerNode) : null;
  }

  /// Le forme stimate del blocco estraneo `leaf`, figlio di un contenitore
  /// che `matrix` porta nella scena e `frame` nelle coordinate dell'oggetto,
  /// tagliate dalle regioni del contenitore. Il ritaglio e la maschera che il
  /// blocco scrive per sé non si leggono: è una stima.
  private estimate(leaf: LeafNode, matrix: Matrix, frame: Matrix, style: Style, regions: readonly Region[] | null, out: Part[], via: Via | null = null): void {
    for (const shape of this.foreign.shapes(leaf, style)) {
      out.push({
        leaf,
        segments: shape.segments,
        matrix: compose(matrix, shape.matrix),
        frameMatrix: compose(frame, shape.matrix),
        fill: shape.fill,
        radius: shape.radius,
        cache: shape.cache,
        flat: null,
        host: null,
        regions,
        via,
      });
    }
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

/// Un oggetto già misurato, con gli attributi dipinti della sua forma, che
/// la riconoscono, e lo stile del genitore con cui si è misurato.
interface KnownUnit {
  readonly unit: Unit;
  readonly attrs: readonly PaintAttr[];
  readonly style: Style;
}

/// Vero se l'oggetto `leaf`, con gli attributi dipinti `attrs`, dipende
/// soltanto da sé, da dove sta e dallo stile del genitore: non rimanda a
/// simboli, originali, ritagli, maschere, punte o tracciati, che cambiano
/// senza che lui cambi.
function standalone(leaf: LeafNode, attrs: readonly PaintAttr[]): boolean {
  const details = leaf.details!;
  if (details.role === "instance" || details.role === "copy" || details.textPath !== undefined) return false;
  return attrs.every(([name]) => name !== "clip-path" && name !== "mask" && !name.startsWith("marker"));
}

/// Due stili uguali in tutto, anche in ciò che di un testo si mostra.
function equalStyle(a: Style, b: Style): boolean {
  return (
    a === b
    || (a.fill === b.fill
      && a.stroke === b.stroke
      && a.strokeWidth === b.strokeWidth
      && a.fontSize === b.fontSize
      && a.spacing === b.spacing
      && a.anchor === b.anchor
      && a.family === b.family
      && a.weight === b.weight
      && a.color === b.color)
  );
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((step, at) => step === b[at]);
}
