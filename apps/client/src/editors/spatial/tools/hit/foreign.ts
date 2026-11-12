// La stima delle forme di un blocco estraneo, che conta nella geometria
// dell'oggetto che lo contiene senza essere letto per intero.

import { BoundsBuilder, rectPath, type Segment } from "../../scene/geometry";
import { compose, IDENTITY, translate, type Matrix } from "../../scene/matrix";
import { parseFragment, type ElementPart, type Fragment, type LeafNode } from "../../scene/model";
import { length, numberList } from "../../scene/values";
import { NS_NONE, NS_SVG, NS_XLINK, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../../scene/xml";
import type { PaintAttr, PaintBuilder } from "../../painter/paint";
import { scaleOf, transformedBounds } from "../clips";
import type { Holder, ShapeCache, Style } from "./base";
import { includeInflated } from "./geometry";
import {
  ASCENT_EM,
  attr,
  CHAR_EM,
  DESCENT_EM,
  hidden,
  len,
  lineStart,
  readable,
  shapeSegments,
  styleOf,
  transformOf,
} from "./shapes";

/// Quante forme si stimano in un blocco estraneo: oltre, il blocco conta
/// come il suo riquadro, che costa poco da toccare.
const MAX_ESTIMATES = 2048;

/// Quanti elementi si visitano per stimare un blocco: un `use` che ne
/// ripete altri non fa durare la stima più di così.
const MAX_VISITS = 100_000;

/// Quanti `use` si attraversano uno dentro l'altro.
const MAX_USE_DEPTH = 8;

/// Le proprietà che la stima legge anche dal `style` di un elemento.
const ESTIMATED: ReadonlySet<string> = new Set(["display", "visibility", "fill", "stroke", "stroke-width", "font-size", "text-anchor"]);

/// Una forma stimata di un blocco estraneo: i segmenti nelle sue coordinate,
/// la matrice da queste a quelle del contenitore del blocco, se si tocca
/// dentro, e metà del contorno nelle sue unità.
interface Estimate {
  readonly segments: readonly Segment[];
  readonly matrix: Matrix;
  readonly fill: boolean;
  readonly radius: number;
  readonly cache: ShapeCache;
}

/// La stima di un blocco per lo stile che eredita, con gli elementi fuori
/// dal blocco a cui rimanda: vale finché lo stile è lo stesso e ogni id
/// porta ancora allo stesso elemento.
interface Estimated {
  readonly style: Style;
  readonly refs: ReadonlyArray<readonly [string, ElementPart | null]>;
  readonly shapes: readonly Estimate[];
}

/// Una stima in corso: le forme, finché sono poche, poi solo il riquadro.
interface Estimating {
  readonly refs: Array<readonly [string, ElementPart | null]>;
  readonly out: Estimate[];
  box: BoundsBuilder | null;
  visits: number;
}

/// Stima le forme dei blocchi estranei, e le ricorda per blocco.
export class ForeignShapes {
  private readonly fragments = new WeakMap<LeafNode, Fragment | null>();
  private readonly ids = new WeakMap<XmlDocument, Map<string, NodeId>>();
  private readonly estimates = new WeakMap<LeafNode, Estimated>();

  constructor(
    private readonly builder: PaintBuilder,
    private readonly holder: Holder | null,
  ) {}

  /// Le forme di `leaf`, che eredita `style`, nelle coordinate del suo
  /// contenitore.
  shapes(leaf: LeafNode, style: Style): readonly Estimate[] {
    const known = this.estimates.get(leaf);
    if (known !== undefined && sameStyle(known.style, style) && known.refs.every(([id, node]) => this.holder?.(id) === node)) {
      return known.shapes;
    }
    const run: Estimating = { refs: [], out: [], box: null, visits: 0 };
    const fragment = this.fragment(leaf);
    if (fragment !== null) this.element(fragment.doc, fragment.id, IDENTITY, style, true, 0, run);
    const shapes = run.box === null ? run.out : boxEstimate(run.box);
    this.estimates.set(leaf, { style, refs: run.refs, shapes });
    return shapes;
  }

  private fragment(leaf: LeafNode): Fragment | null {
    let fragment = this.fragments.get(leaf);
    if (fragment === undefined) {
      fragment = leaf.parent === null ? null : parseFragment(leaf.raw, this.builder.scopeInfo(leaf.parent).scope);
      this.fragments.set(leaf, fragment);
    }
    return fragment;
  }

  /// Le forme dell'elemento `id` di `doc`, con `matrix` dalle coordinate di
  /// chi lo contiene a quelle del contenitore del blocco. `visible` è la
  /// `visibility` che eredita: un figlio di un elemento invisibile può
  /// tornare visibile.
  private element(doc: XmlDocument, id: NodeId, matrix: Matrix, style: Style, visible: boolean, depth: number, run: Estimating): void {
    if (++run.visits > MAX_VISITS) return;
    const element = doc.element(id);
    if (element === null || element.ns !== NS_SVG) return;
    const attrs = presentation(element);
    if (hidden(attrs)) return;
    const m = compose(matrix, transformOf(attrs));
    const inner = styleOf(style, attrs);
    const visibility = attr(attrs, "visibility")?.trim();
    const shown = visibility === undefined || visibility === "inherit" ? visible : visibility === "visible";
    switch (element.local) {
      case "g":
      case "a":
      case "switch":
        this.children(doc, element, m, inner, shown, depth, run);
        return;
      case "svg": {
        // Un documento annidato con le sue misure taglia ciò che contiene;
        // senza, è grande quanto chi lo contiene, e conta il contenuto.
        const box = boxOf(attrs);
        if (box === null) this.children(doc, element, compose(m, translate(len(attrs, "x") ?? 0, len(attrs, "y") ?? 0)), inner, shown, depth, run);
        else if (shown) addEstimate(run, box, m, true, 0);
        return;
      }
      case "use":
        this.use(doc, attrs, m, inner, shown, depth, run);
        return;
      case "image":
      case "foreignObject": {
        const box = boxOf(attrs);
        if (box !== null && shown) addEstimate(run, box, m, true, 0);
        return;
      }
      case "text": {
        const segments = shown ? foreignText(doc, element, attrs, inner) : [];
        if (segments.length > 0) addEstimate(run, segments, m, true, 0);
        return;
      }
      case "path":
      case "rect":
      case "circle":
      case "ellipse":
      case "line":
      case "polyline":
      case "polygon": {
        const segments = shapeSegments(element.local, attrs);
        const fill = element.local !== "line" && inner.fill;
        const radius = inner.stroke ? inner.strokeWidth / 2 : 0;
        if (shown && segments.length > 0 && (fill || radius > 0)) addEstimate(run, segments, m, fill, radius);
        return;
      }
      default:
        // `defs`, `symbol`, i ritagli, le maschere, i motivi e i gradienti
        // si disegnano solo da chi li usa.
        return;
    }
  }

  private children(doc: XmlDocument, element: ElementNode, matrix: Matrix, style: Style, visible: boolean, depth: number, run: Estimating): void {
    for (const child of element.children) this.element(doc, child, matrix, style, visible, depth, run);
  }

  /// Un `use`: l'elemento a cui rimanda, spostato di `x` e `y`, con lo stile
  /// del `use`. Una risorsa fuori dal documento non si legge.
  private use(doc: XmlDocument, attrs: readonly PaintAttr[], matrix: Matrix, style: Style, visible: boolean, depth: number, run: Estimating): void {
    if (depth >= MAX_USE_DEPTH) return;
    const target = attr(attrs, "href")?.trim();
    if (target === undefined || !target.startsWith("#")) return;
    const found = this.find(doc, target.slice(1), run);
    if (found === null) return;
    const placed = compose(matrix, translate(len(attrs, "x") ?? 0, len(attrs, "y") ?? 0));
    const element = found.doc.element(found.id)!;
    if (element.ns === NS_SVG && element.local === "symbol") this.symbol(found.doc, element, attrs, placed, style, visible, depth + 1, run);
    else this.element(found.doc, found.id, placed, style, visible, depth + 1, run);
  }

  /// Un `symbol` disegnato da un `use`: il suo `viewBox` sta nel riquadro
  /// del `use`, centrato e intero come vuole il `preserveAspectRatio`
  /// predefinito; senza misure, il contenuto resta com'è.
  private symbol(
    doc: XmlDocument,
    symbol: ElementNode,
    useAttrs: readonly PaintAttr[],
    matrix: Matrix,
    style: Style,
    visible: boolean,
    depth: number,
    run: Estimating,
  ): void {
    const attrs = presentation(symbol);
    if (hidden(attrs)) return;
    const box = numberList(attr(attrs, "viewBox") ?? "");
    const width = len(useAttrs, "width") ?? len(attrs, "width");
    const height = len(useAttrs, "height") ?? len(attrs, "height");
    let m = matrix;
    if (box !== null && box.length === 4 && box[2]! > 0 && box[3]! > 0 && width !== null && height !== null && width > 0 && height > 0) {
      const scale = Math.min(width / box[2]!, height / box[3]!);
      m = compose(matrix, [scale, 0, 0, scale, (width - box[2]! * scale) / 2 - box[0]! * scale, (height - box[3]! * scale) / 2 - box[1]! * scale]);
    }
    this.children(doc, symbol, m, styleOf(style, attrs), visible, depth, run);
  }

  /// L'elemento di id `id`: nello stesso frammento, o fuori dal blocco, e
  /// allora la stima se lo ricorda.
  private find(doc: XmlDocument, id: string, run: Estimating): { readonly doc: XmlDocument; readonly id: NodeId } | null {
    const local = this.idsOf(doc).get(id);
    if (local !== undefined) return { doc, id: local };
    if (this.holder === null) return null;
    const node = this.holder(id);
    run.refs.push([id, node]);
    // Un contenitore del disegno cambia sotto lo stesso oggetto: non si
    // stima da qui.
    if (node === null || node.kind !== "leaf") return null;
    const fragment = this.fragment(node);
    const found = fragment === null ? undefined : this.idsOf(fragment.doc).get(id);
    return found === undefined ? null : { doc: fragment!.doc, id: found };
  }

  private idsOf(doc: XmlDocument): Map<string, NodeId> {
    let ids = this.ids.get(doc);
    if (ids === undefined) {
      const out = new Map<string, NodeId>();
      doc.nodes.forEach((node, index) => {
        if (node.kind !== "element") return;
        const id = valueOf(node, NS_NONE, "id");
        if (id !== undefined && !out.has(id)) out.set(id, index);
      });
      this.ids.set(doc, (ids = out));
    }
    return ids;
  }
}

function estimate(segments: readonly Segment[], matrix: Matrix, fill: boolean, radius: number): Estimate {
  return { segments, matrix, fill, radius, cache: { segments, scene: null, local: undefined } };
}

/// Aggiunge una forma alla stima `run`: oltre `MAX_ESTIMATES` forme, solo
/// al riquadro.
function addEstimate(run: Estimating, segments: readonly Segment[], matrix: Matrix, fill: boolean, radius: number): void {
  if (run.box === null && run.out.length < MAX_ESTIMATES) {
    run.out.push(estimate(segments, matrix, fill, radius));
    return;
  }
  if (run.box === null) {
    run.box = new BoundsBuilder();
    for (const shape of run.out) includeShape(run.box, shape.segments, shape.matrix, shape.radius);
    run.out.length = 0;
  }
  includeShape(run.box, segments, matrix, radius);
}

function includeShape(out: BoundsBuilder, segments: readonly Segment[], matrix: Matrix, radius: number): void {
  const bounds = transformedBounds(segments, matrix);
  if (bounds !== null) includeInflated(out, bounds, radius * scaleOf(matrix));
}

/// Due stili che danno la stessa geometria.
function sameStyle(a: Style, b: Style): boolean {
  return a === b || (a.fill === b.fill && a.stroke === b.stroke && a.strokeWidth === b.strokeWidth && a.fontSize === b.fontSize && a.anchor === b.anchor);
}

/// Gli attributi di un elemento estraneo che la stima legge: quelli senza
/// namespace, e prima le dichiarazioni del suo `style` che contano, che
/// valgono di più, l'ultima per prima. `xlink:href` vale come `href` se
/// `href` manca.
function presentation(element: ElementNode): PaintAttr[] {
  const out: PaintAttr[] = [];
  const style = valueOf(element, NS_NONE, "style");
  if (style !== undefined) {
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      if (ESTIMATED.has(name)) out.unshift([name, declaration.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim()]);
    }
  }
  for (const each of element.attrs) if (each.ns === NS_NONE) out.push([each.local, each.value]);
  const xlink = valueOf(element, NS_XLINK, "href");
  if (xlink !== undefined) out.push(["href", xlink]);
  return out;
}

/// Il rettangolo `x`, `y`, `width`, `height` di un elemento; `null` se un
/// lato non è una lunghezza positiva.
function boxOf(attrs: readonly PaintAttr[]): Segment[] | null {
  const width = len(attrs, "width");
  const height = len(attrs, "height");
  if (width === null || height === null || !(width > 0) || !(height > 0)) return null;
  return rectPath(len(attrs, "x") ?? 0, len(attrs, "y") ?? 0, width, height, 0, 0);
}

/// La prima lunghezza di una lista come quelle di `x` e `y` di un testo.
function firstLength(attrs: readonly PaintAttr[], name: string): number | null {
  const value = attr(attrs, name)?.trim();
  if (value === undefined || value === "") return null;
  return length(value.split(/[\s,]+/)[0]!);
}

/// I pezzi di un testo estraneo come rettangoli, con la stima dei testi del
/// disegno: ogni pezzo comincia dove lo mette il suo `tspan`, o dove finisce
/// il pezzo prima.
function foreignText(doc: XmlDocument, text: ElementNode, attrs: readonly PaintAttr[], style: Style): Segment[] {
  const segments: Segment[] = [];
  let x = (firstLength(attrs, "x") ?? 0) + (firstLength(attrs, "dx") ?? 0);
  let y = (firstLength(attrs, "y") ?? 0) + (firstLength(attrs, "dy") ?? 0);
  const piece = (value: string, at: Style): void => {
    const chars = readable(value);
    if (chars === 0) return;
    const width = CHAR_EM * at.fontSize * chars;
    for (const segment of rectPath(lineStart(x, width, at.anchor), y - ASCENT_EM * at.fontSize, width, (ASCENT_EM + DESCENT_EM) * at.fontSize, 0, 0)) {
      segments.push(segment);
    }
    x += at.anchor === "middle" ? width / 2 : at.anchor === "end" ? 0 : width;
  };
  const visit = (element: ElementNode, at: Style): void => {
    for (const id of element.children) {
      const node = doc.nodes[id]!;
      if (node.kind === "text" || node.kind === "cdata") piece(node.value, at);
      else if (node.kind === "entity-ref") piece(doc.plainEntity(node.name) ?? "?", at);
      else if (node.kind === "element" && node.ns === NS_SVG && (node.local === "tspan" || node.local === "textPath" || node.local === "a")) {
        const own = presentation(node);
        if (hidden(own)) continue;
        x = firstLength(own, "x") ?? x;
        y = firstLength(own, "y") ?? y;
        x += firstLength(own, "dx") ?? 0;
        y += firstLength(own, "dy") ?? 0;
        visit(node, styleOf(at, own));
      }
    }
  };
  visit(text, style);
  return segments;
}

/// Il riquadro di tante forme come una sola: piena, senza contorno.
function boxEstimate(out: BoundsBuilder): Estimate[] {
  const box = out.finish();
  if (box === null) return [];
  return [estimate(rectPath(box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1], 0, 0), IDENTITY, true, 0)];
}

// ---------------------------------------------------------------------------
// Riquadri.
// ---------------------------------------------------------------------------
