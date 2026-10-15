// L'editor del disegno: le forme dal tratto e il Connettore. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { polygonalKind } from "../../describe";
import type { InkSample } from "../../ink/sample";
import type { InkPointerType } from "../../pen/pen-input";
import { apply, compose, IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import type { ElementPart } from "../../scene/model";
import type { Op } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { paint as parsePaint } from "../../scene/values";
import { plural, t } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import type { PaintNode } from "../../painter/paint";
import { addOp, destination, destinationIn, destinationInto, gesture as asGesture, NewIds, type Destination } from "../edit";
import { paintCode } from "../resources";
import { DEFAULT_TIP_SIZE, Shelf, tipElem } from "../tips";
import {
  anchorPoints,
  attachable,
  connectOps,
  connectorAttrsFor,
  connectorElem,
  ConnectorPreview,
  endInputs,
  lineEnds,
  outlineSegments,
  sceneRoute,
  type EndInput,
  type LineEnd,
} from "../connectors";
import { writeConnectorEnd, type Anchor, type ConnectorEnd } from "../../scene/connectors";
import { labelable, labelOf as labelIn } from "../label-hosts";
import { elemBounds, type Unit } from "../hit";
import type { ShapeStyle } from "../shapes";
import { centerOf, heldShape, mapped, regular, shapeOfRecognized, similar, starOf, type Recognized } from "../recognize";
import { heldShapeOps, type HeldShape } from "../inkshape";
import { ADDED, DRAG_PX, HIT_PX, MIN_SHAPE_PX, NODE_PX } from "./constants";
import type { EditorContext } from "./context";
import { holdsPath, insideBounds, layerRefusal, matrixText, sameDestination, scaleOf } from "./helpers";
import type { ConnectorGesture, Hook, InkGesture, SelectGesture, ShapeGesture } from "./types";

/// Quanto resta fermo il puntatore alla fine di un tratto a penna perché il
/// tratto diventi una forma, in millisecondi.
const HOLD_MS = 500;

/// Quanto può tremare il puntatore che sta fermo, in pixel: la penna e il
/// dito non stanno mai fermi del tutto, il mouse sì.
const HOLD_PX: Readonly<Record<InkPointerType, number>> = { pen: 4, mouse: 3, touch: 8 };

/// Quanto vicino a uno dei punti d'aggancio di un oggetto il capo di un
/// connettore vi si aggancia, in pixel; più lontano FubDraw sceglie il lato.
const ANCHOR_PX: Readonly<Record<InkPointerType, number>> = { pen: 12, mouse: 10, touch: 20 };

/// Vero se `a` e `b` sono lo stesso elemento, o uno contiene l'altro.
function related(a: ElementPart, b: ElementPart): boolean {
  for (let node: ElementPart | null = a; node !== null; node = node.parent) if (node === b) return true;
  for (let node: ElementPart | null = b; node !== null; node = node.parent) if (node === a) return true;
  return false;
}

/// Ciò che le forme dal tratto e il Connettore dà agli altri pezzi dell'editor.
export interface ShapesConnectorContext {
  /// Il mezzo secondo della tenuta ferma: uno solo, perché il gesto è uno.
  holdTimer: number | undefined;
  shapesOn: () => boolean;
  watchStill: (g: InkGesture, samples: readonly InkSample[]) => void;
  strokeShapeOf: (g: InkGesture) => Recognized | null;
  drawHeld: (g: InkGesture) => void;
  moveHeld: (g: InkGesture, p: Point) => void;
  finishHeld: (g: InkGesture) => void;
  offerLabel: () => void;
  finishShape: (g: ShapeGesture, note?: string) => void;
  hoverConnector: (p: Point | null, pointer: InkPointerType) => void;
  connectorHandles: () => OverlayHandle[];
  connectorStart: (g: ConnectorGesture, p: Point) => void;
  connectorUpdate: (g: ConnectorGesture) => void;
  connectorEnd: (g: ConnectorGesture) => void;
  destinationNow: () => Destination | null;
  connectSelection: () => void;
  followingDraft: (g: SelectGesture, m: Matrix, transforms: Map<PaintNode, string | null>) => Map<PaintNode, string>;
}

/// Monta le forme dal tratto e il Connettore.
export function installShapesConnector(ctx: EditorContext): void {
  const {
    life, folio, has, measureText, styles, style, toolLabel, suggestions, previewTip, painter, overlay, clearInk, builder, editable, currentIndex,
    grownPage, newIds, announce, objects, selectedUnits, showGrip, showHandles, showShape, currentLayer, drawnPaint, commit, select, nameOfNode, target,
    snapped, isolatedUnit, noted, shapeEnds, shapeOf, polygonSaid, writeInk, copiesText
  } = ctx;
  // --- Le forme dal tratto ---------------------------------------------------
  //
  // Un tratto a penna tenuto fermo alla fine per mezzo secondo diventa la
  // forma a cui somiglia (`recognize.ts`), e lo si dice. Finché il puntatore
  // resta giù, muoverlo regola la forma: la fine di una linea lo segue, una
  // forma chiusa gira e cresce attorno al suo centro; Maiusc la tiene
  // regolare. Alzato il puntatore, il tratto entra nel disegno e la forma
  // prende il suo posto: due passi, e annulla riporta l'inchiostro. Esc
  // lascia tutto, come per ogni tratto.
  life.add(() => clearTimeout(ctx.holdTimer));

  /// Vero se un tratto a penna tenuto fermo diventa una forma.
  const shapesOn = (): boolean => has("recognize") && ctx.grid.shapes;
  ctx.shapesOn = shapesOn;

  /// Segue i campioni nuovi di `g`: ogni volta che il puntatore esce dal
  /// punto fermo, il punto fermo diventa lui, e il mezzo secondo riparte.
  const watchStill = (g: InkGesture, samples: readonly InkSample[]): void => {
    if (!g.holds || !shapesOn()) return;
    let restart = false;
    for (const sample of samples) {
      if (g.still !== null && Math.hypot(sample.x - g.still[0], sample.y - g.still[1]) * ctx.camera.scale <= HOLD_PX[g.pointer]) continue;
      g.still = [sample.x, sample.y];
      restart = true;
    }
    if (!restart) return;
    clearTimeout(ctx.holdTimer);
    ctx.holdTimer = setTimeout(() => holdStroke(g), HOLD_MS);
  };
  ctx.watchStill = watchStill;

  /// La forma a cui somiglia il tratto `g`, nelle coordinate del suo
  /// livello: riconosciuta nella scena, com'è sullo schermo, o nel livello
  /// se il livello deforma. `null` per un tratto piccolo quanto la
  /// scrittura, o che non somiglia a una forma.
  const strokeShapeOf = (g: InkGesture): Recognized | null => {
    const still = HOLD_PX[g.pointer];
    const seen = heldShape(g.scene.map((sample): Point => [sample.x, sample.y]), ctx.camera.scale, still);
    if (seen === null) return null;
    return mapped(seen, g.to.inverse) ?? heldShape(g.local.map((sample): Point => [sample.x, sample.y]), ctx.camera.scale * scaleOf(g.to.matrix), still);
  };
  ctx.strokeShapeOf = strokeShapeOf;

  /// Il mezzo secondo fermo è passato: il tratto diventa la sua forma, se
  /// ne ha una; se no resta inchiostro, e si continua a disegnare.
  const holdStroke = (g: InkGesture): void => {
    if (ctx.current !== g || g.held !== null || g.still === null || !shapesOn()) return;
    const shape = strokeShapeOf(g);
    if (shape === null) return;
    g.held = { shape, from: g.still, end: g.still, moved: false };
    g.predicted = [];
    clearInk();
    overlay.flush();
    drawHeld(g);
    announce(t("draw.recognize.said", { kind: shapeSaid(heldNow(g)) }));
  };

  /// La forma del tratto `g` adesso: regolata dal puntatore, e regolare con
  /// Maiusc.
  const heldNow = (g: InkGesture): Recognized => {
    const held = g.held!;
    let shape = held.shape;
    if (held.moved) {
      const from = apply(g.to.inverse, held.from);
      const end = apply(g.to.inverse, held.end);
      if (shape.kind === "line" || shape.kind === "arrow") {
        shape = { ...shape, to: [shape.to[0] + end[0] - from[0], shape.to[1] + end[1] - from[1]] };
      } else {
        const c = centerOf(shape);
        const before = Math.hypot(from[0] - c[0], from[1] - c[1]);
        if (before > 0) {
          const turn = ((Math.atan2(end[1] - c[1], end[0] - c[0]) - Math.atan2(from[1] - c[1], from[0] - c[0])) * 180) / Math.PI;
          shape = similar(shape, c, Math.hypot(end[0] - c[0], end[1] - c[1]) / before, turn);
        }
      }
    }
    return ctx.shift ? regular(shape) : shape;
  };

  const heldStyle = (g: InkGesture): ShapeStyle => ({ color: g.color, width: g.brush.size });

  /// La forma del tratto tenuto fermo, a schermo, con le copie in
  /// simmetria che diventeranno la stessa forma.
  const drawHeld = (g: InkGesture): void => {
    const elem = shapeOfRecognized(heldNow(g), "preview", heldStyle(g));
    if (elem === null || g.copies.length === 0) {
      showShape(elem, g.to.matrix);
      return;
    }
    const copy: Elem = { ...elem, attrs: Object.fromEntries(Object.entries(elem.attrs).filter(([name]) => name !== "id")) };
    const copies = g.copies.map((m): Elem => ({ tag: "g", attrs: { transform: matrixText(compose(g.to.inverse, compose(m, g.to.matrix))) }, children: [copy] }));
    showShape({ tag: "g", attrs: {}, children: [elem, ...copies] }, g.to.matrix);
  };
  ctx.drawHeld = drawHeld;

  /// Il puntatore del tratto diventato forma è in `p`: oltre il tremito
  /// della mano ferma, la forma lo segue.
  const moveHeld = (g: InkGesture, p: Point): void => {
    const held = g.held!;
    held.end = p;
    if (!held.moved && Math.hypot(p[0] - held.from[0], p[1] - held.from[1]) * ctx.camera.scale > HOLD_PX[g.pointer]) held.moved = true;
    if (held.moved) drawHeld(g);
  };
  ctx.moveHeld = moveHeld;

  /// Che cosa è una forma riconosciuta, a parole: «Rettangolo», «Quadrato»,
  /// «Quadrilatero», «Esagono», «Stella a 5 punte».
  const shapeSaid = (shape: Recognized): string => {
    switch (shape.kind) {
      case "line":
        return t("draw.tool.line");
      case "arrow":
        return t("draw.tool.arrow");
      case "rect":
        return t(shape.width === shape.height ? "draw.kind.ngon.4" : "draw.tool.rect");
      case "ellipse":
        return t(shape.rx === shape.ry ? "draw.kind.circle" : "draw.tool.ellipse");
      case "regular":
        return polygonalKind({ shape: shape.ratio === null ? "polygon" : "star", count: shape.count });
      case "polygon": {
        const star = starOf(shape.points);
        if (star !== null) return polygonalKind({ shape: "star", count: star.count });
        return shape.points.length === 4 ? t("draw.kind.quad") : polygonalKind({ shape: "polygon", count: shape.points.length });
      }
    }
  };

  /// Il tratto tenuto fermo entra nel disegno, poi la sua forma ne prende il
  /// posto: due passi, così annulla riporta l'inchiostro. Una forma che non
  /// si disegna più, schiacciata dal puntatore, lascia il tratto.
  const finishHeld = (g: InkGesture): void => {
    const written = writeInk(g, false);
    if (written === null) return;
    let shape: Recognized | null = heldNow(g);
    // Il livello di adesso, se mentre il gesto durava è cambiato.
    if (!sameDestination(written.to, g.to)) shape = mapped(shape, compose(written.to.inverse, g.to.matrix));
    const index = currentIndex();
    const unit = shape === null ? null : index.get(written.id);
    // Le copie in simmetria diventano la stessa forma, portata come il
    // tratto; dove il livello deforma, e la forma non resta la stessa,
    // restano inchiostro.
    const copies: HeldShape[] = [];
    for (const copy of written.copies) {
      const copied = shape === null ? null : mapped(shape, copy.matrix);
      const copyUnit = index.get(copy.id);
      if (copied !== null && copyUnit !== null) copies.push({ unit: copyUnit, shape: copied });
    }
    const shaped = unit === null || shape === null ? null : heldShapeOps(ctx.engine.model!, unit, shape, g.ids, copies);
    if (shaped === null) {
      announce(`${t("draw.added.stroke")}${copiesText(written.copies.length)} ${objects()}`);
      return;
    }
    const ops: Op[] = [...shaped.ops];
    const page = grownPage(shaped.extent);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.to_shape", asGesture(ops)) === null) return;
    announce(`${t("draw.shaped.held", { kind: shapeSaid(shape!) })}${copiesText(written.copies.length)} ${objects()}`);
    suggestions.done("hold-shape");
    offerLabel();
  };
  ctx.finishHeld = finishHeld;

  /// Dopo una forma nuova, se ce ne sono almeno due senza testo: come si
  /// scrive dentro una forma.
  const offerLabel = (): void => {
    if (!has("text") || !suggestions.wants("label-shape")) return;
    let empty = 0;
    for (const unit of currentIndex().units) {
      if (labelable(unit.node) && labelIn(unit.node) === null && ++empty === 2) {
        suggestions.offer("label-shape");
        return;
      }
    }
  };
  ctx.offerLabel = offerLabel;

  /// La forma del gesto `g` entra nel disegno, e lo si dice, con `note`, a
  /// che cosa si è agganciata.
  const finishShape = (g: ShapeGesture, note = ""): void => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return;
    if (shapeEnds(g, to) === null) return;
    const elem = shapeOf(g, g.ids.next("object"), to);
    if (elem === null) return;
    const ops: Op[] = [...to.prelude, addOp(to, elem)];
    const page = grownPage(elemBounds(elem, to.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    // Il poligono si dice col suo nome, la stella con le sue punte.
    const added =
      g.tool !== "polygon"
        ? t(ADDED[g.tool])
        : ctx.polygonTool.shape === "star"
          ? t("draw.added.star", { count: ctx.polygonTool.points })
          : t("draw.added.ngon", { kind: polygonSaid() });
    if (commit(toolLabel(g.tool), asGesture(ops)) === null) return;
    announce(noted(`${added} ${objects()}`, note));
    offerLabel();
  };
  ctx.finishShape = finishShape;

  // --- Il Connettore ------------------------------------------------------------
  //
  // Un connettore si tira da un oggetto a un altro. Sopra un oggetto se ne
  // vedono il contorno e i cinque punti d'aggancio, il centro e i centri dei
  // lati: vicino a uno il capo si aggancia lì, altrove FubDraw sceglie il
  // lato verso l'altro capo. Il percorso lo calcola `connectors.ts`, e il
  // motore lo ricalcola quando gli oggetti si muovono.

  /// L'aggancio a `unit` del capo in `p`: al punto più vicino entro
  /// [`ANCHOR_PX`], se no scelto da FubDraw. `null` se `unit` non ha un
  /// contorno a cui agganciarsi.
  const hookOn = (unit: Unit, p: Point, pointer: InkPointerType): Hook | null => {
    const points = anchorPoints(unit.node, measureText);
    if (points === null) return null;
    let anchor: Anchor = "auto";
    let near = ANCHOR_PX[pointer] / ctx.camera.scale;
    for (const [name, at] of points) {
      const apart = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (apart <= near) {
        anchor = name;
        near = apart;
      }
    }
    return { unit, anchor, points };
  };

  /// L'oggetto sotto `p` a cui si aggancerebbe un capo: il più in alto che
  /// `p` tocca, o se nessuno il più in alto nel cui riquadro cade; con Ctrl
  /// o ⌘ quello più dentro, come quando si sceglie, ma una linea che passa
  /// sopra non lo copre. Mai `besides`, l'oggetto dell'altro capo, né chi lo
  /// contiene o vi sta dentro.
  const hookAt = (p: Point, pointer: InkPointerType, besides: ElementPart | null): Hook | null => {
    const index = currentIndex();
    const reach = HIT_PX[pointer] / ctx.camera.scale;
    const fits = (unit: Unit): boolean => attachable(unit.node) && (besides === null || !related(unit.node, besides));
    /// L'oggetto più dentro, fra quelli a cui ci si può agganciare, che `p`
    /// tocca: scende nei gruppi, anche in quello di `besides`, dove sta
    /// l'altro capo.
    const deepest = (): Unit | null => {
      for (let i = index.units.length - 1; i >= 0; i--) {
        let unit = index.units[i]!;
        if (!attachable(unit.node) || !unit.hits(p, reach)) continue;
        for (;;) {
          const inner = index.children(unit).reverse().find((child) => attachable(child.node) && child.hits(p, reach));
          if (inner === undefined) return unit;
          unit = inner;
        }
      }
      return null;
    };
    if (ctx.free) {
      const deep = deepest();
      if (deep !== null && fits(deep)) return hookOn(deep, p, pointer);
    }
    const units = index.units;
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!;
      if (fits(unit) && unit.hits(p, reach)) return hookOn(unit, p, pointer);
    }
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!;
      if (fits(unit) && unit.bounds !== null && insideBounds(unit.bounds, p)) return hookOn(unit, p, pointer);
    }
    return null;
  };

  /// I capi dei connettori scelti, che si prendono per riagganciarli: non
  /// quelli bloccati o nascosti.
  const lineEndsNow = (): readonly LineEnd[] => {
    const model = ctx.engine.model;
    if (model === null || ctx.selection.length === 0) return [];
    const index = currentIndex();
    if (ctx.lineEndsFor?.index !== index) ctx.lineEndsFor = { index, ends: lineEnds(model, measureText).filter((end) => index.get(end.id) !== null) };
    return ctx.lineEndsFor.ends.filter((end) => ctx.selection.includes(end.id));
  };

  /// Il capo di un connettore scelto che `p` prende: il più vicino.
  const lineEndAt = (p: Point, pointer: InkPointerType): LineEnd | null => {
    let best: LineEnd | null = null;
    let near = NODE_PX[pointer] / ctx.camera.scale;
    for (const end of lineEndsNow()) {
      const apart = Math.hypot(p[0] - end.at[0], p[1] - end.at[1]);
      if (apart <= near) {
        best = end;
        near = apart;
      }
    }
    return best;
  };

  /// Il puntatore passa sopra `p` senza premere: con lo strumento
  /// Connettore l'oggetto sotto mostra il contorno e i punti d'aggancio, e
  /// sopra il capo di un connettore scelto il cursore dice che lo sposta.
  const hoverConnector = (p: Point | null, pointer: InkPointerType): void => {
    if (ctx.tool !== "connector") return;
    const end = p === null || !editable() ? null : lineEndAt(p, pointer);
    const hook = p === null || end !== null || !editable() ? null : hookAt(p, pointer, null);
    const before = ctx.connectorHover;
    ctx.connectorHover = end === null && hook === null ? null : { hook, end };
    showGrip(end === null ? null : "move");
    const same =
      before?.hook?.unit.node === ctx.connectorHover?.hook?.unit.node &&
      before?.hook?.anchor === ctx.connectorHover?.hook?.anchor &&
      before?.end?.id === ctx.connectorHover?.end?.id &&
      before?.end?.end === ctx.connectorHover?.end?.end;
    if (!same) showHandles();
  };
  ctx.hoverConnector = hoverConnector;

  /// Le maniglie dello strumento Connettore: il contorno e i punti
  /// d'aggancio dell'oggetto sotto il puntatore, e di quello da cui parte il
  /// connettore che si tira; i capi dei connettori scelti.
  const connectorHandles = (): OverlayHandle[] => {
    if (ctx.tool !== "connector") return [];
    const g = ctx.current?.kind === "connector" ? ctx.current : null;
    const out: OverlayHandle[] = [];
    const show = (hook: Hook | null, hint: boolean): void => {
      if (hook === null) return;
      const segments = outlineSegments(hook.unit.node, measureText);
      if (segments !== null) out.push({ kind: "outline", segments, matrix: IDENTITY, hint });
      for (const [name, [x, y]] of hook.points) {
        const chosen = name === hook.anchor;
        out.push({ kind: "node", x, y, shape: "circle", selected: chosen, ...(chosen ? {} : { hint: true }) });
      }
    };
    if (g === null) {
      show(ctx.connectorHover?.hook ?? null, true);
    } else {
      show(g.start, false);
      if (g.dragging) show(g.hook, false);
    }
    if (g !== null && g.grab !== null && g.dragging) return out;
    for (const end of lineEndsNow()) {
      const chosen = (g?.grab?.end ?? ctx.connectorHover?.end) ?? null;
      out.push({ kind: "node", x: end.at[0], y: end.at[1], shape: "square", selected: chosen !== null && chosen.id === end.id && chosen.end === end.end });
    }
    return out;
  };
  ctx.connectorHandles = connectorHandles;

  /// Il primo punto di un gesto del Connettore: il capo di un connettore
  /// scelto, o l'oggetto da cui parte un connettore nuovo.
  const connectorStart = (g: ConnectorGesture, p: Point): void => {
    g.from = p;
    ctx.connectorHover = null;
    const end = lineEndAt(p, g.pointer);
    const now = end === null ? null : endInputs(end.line, (id) => ctx.engine.holder(id), measureText);
    if (end !== null && now !== null) {
      g.grab = { end, other: end.end === "from" ? now[1] : now[0] };
      showGrip("move");
    } else {
      g.start = hookAt(p, g.pointer, null);
    }
    showHandles();
  };
  ctx.connectorStart = connectorStart;

  /// I capi del connettore che `g` tira, o di quello di cui sposta un capo:
  /// agganciati all'oggetto sotto, o liberi dove sono, sulla griglia se
  /// aggancia.
  const gestureEnds = (g: ConnectorGesture): [EndInput, EndInput] | null => {
    if (g.from === null || g.end === null) return null;
    const moving: EndInput = g.hook !== null ? { node: g.hook.unit.node, anchor: g.hook.anchor } : { at: snapped(g.end) };
    if (g.grab !== null) return g.grab.end.end === "from" ? [moving, g.grab.other] : [g.grab.other, moving];
    const start: EndInput = g.start !== null ? { node: g.start.unit.node, anchor: g.start.anchor } : { at: snapped(g.from) };
    return [start, moving];
  };

  /// Il gesto `g` col puntatore in `end`: oltre la soglia del
  /// trascinamento il connettore si vede dove andrebbe, agganciato
  /// all'oggetto sotto il puntatore.
  const connectorUpdate = (g: ConnectorGesture): void => {
    if (g.from === null || g.end === null) return;
    if (!g.dragging) {
      if (Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale <= DRAG_PX[g.pointer]) return;
      g.dragging = true;
    }
    const besides = g.grab !== null ? ("node" in g.grab.other ? g.grab.other.node : null) : (g.start?.unit.node ?? null);
    g.hook = hookAt(g.end, g.pointer, besides);
    const ends = gestureEnds(g);
    if (ends === null) return;
    if (g.grab !== null) {
      const line = ctx.engine.holder(g.grab.end.id);
      const kind = line?.details?.connector?.geom.kind;
      const attrs = line === null || kind === undefined ? null : connectorAttrsFor(line, kind, ends[0], ends[1], measureText);
      painter.setDraft(line === null || attrs === null ? null : { paths: new Map(builder.paintsOf(line).map((paint) => [paint, attrs.d])) });
    } else {
      const to = destinationNow();
      if (to !== null) {
        const { color, width } = style();
        const points = sceneRoute(ctx.connectorKind, ends[0], ends[1], measureText).map((p) => apply(to.inverse, p));
        const elem = connectorElem("", ctx.connectorKind, points, null, null, { paint: color, width, tip: previewTip });
        showShape(elem, to.matrix, [tipElem(previewTip, { shape: "triangle", size: DEFAULT_TIP_SIZE }, "end", color, 1)]);
      }
    }
    showHandles();
  };
  ctx.connectorUpdate = connectorUpdate;

  /// Il gesto `g` finito: un trascinamento scrive il connettore nuovo, o
  /// riaggancia il capo preso; un tocco sceglie ciò che tocca, con Maiusc
  /// lo aggiunge o lo toglie, con Ctrl o ⌘ dentro i gruppi.
  const connectorEnd = (g: ConnectorGesture): void => {
    // Il connettore è quello dei modificatori di quando il puntatore si alza.
    if (g.dragging) connectorUpdate(g);
    ctx.current = null;
    showGrip(null);
    showShape(null, IDENTITY);
    painter.setDraft(null);
    if (g.from === null) return;
    if (!g.dragging) {
      const index = currentIndex();
      const reach = HIT_PX[g.pointer] / ctx.camera.scale;
      const hit = ctx.free && has("selection") ? index.deepAt(g.from, reach) : index.at(g.from, reach);
      if (hit === null) {
        if (!ctx.shift) select([]);
      } else if (ctx.shift && has("selection")) {
        select(ctx.selection.includes(hit.key)
          ? ctx.selection.filter((key) => key !== hit.key)
          : [...selectedUnits().filter((unit) => !holdsPath(unit.path, hit.path)).map((unit) => unit.key), hit.key]);
      } else {
        select([hit.key]);
      }
      return;
    }
    const ends = gestureEnds(g);
    if (ends !== null) {
      if (g.grab !== null) hookEnd(g, g.grab.end, ends);
      else addConnector(g, ends);
    }
    showHandles();
  };
  ctx.connectorEnd = connectorEnd;

  /// Dove va un connettore nuovo, senza dirlo se non può: per l'anteprima.
  const destinationNow = (): Destination | null => {
    const quiet = newIds();
    const model = ctx.engine.model;
    if (folio !== undefined) return model === null ? null : folio.destination(model, currentIndex(), quiet, (id) => ctx.engine.holder(id) !== null);
    const group = isolatedUnit();
    if (group !== null) return destinationInto(group, quiet);
    const layer = has("layers") ? currentLayer() : null;
    if (layer === null) return destination(currentIndex(), quiet);
    return layerRefusal(layer) === null ? destinationIn(layer, quiet) : null;
  };
  ctx.destinationNow = destinationNow;

  /// L'aggancio di `hook` come lo scrive un capo; un oggetto senza id ne
  /// riceve uno in `ops`.
  const hookedEnd = (hook: Hook | null, ids: NewIds, ops: Op[]): ConnectorEnd | null => {
    if (hook === null) return null;
    let id = hook.unit.id;
    if (id === null) {
      id = ids.next("object");
      ops.push({ op: "ident", path: hook.unit.path, tag: hook.unit.tag, id });
    }
    return { id, anchor: hook.anchor };
  };

  /// Scrive il connettore che `g` ha tirato fra `from` e `to`: del tipo
  /// scelto per ultimo, col colore e lo spessore della penna e la punta alla
  /// fine. Resta scelto, e lo strumento resta il Connettore.
  const addConnector = (g: ConnectorGesture, [from, to]: [EndInput, EndInput]): void => {
    const model = ctx.engine.model;
    const dest = target(g.ids);
    if (model === null || dest === null) return;
    const kind = ctx.connectorKind;
    const scene = sceneRoute(kind, from, to, measureText);
    const first = scene[0]!;
    const last = scene[scene.length - 1]!;
    // Fra due punti liberi quasi uguali non c'è niente da unire.
    if (g.start === null && g.hook === null && Math.hypot(last[0] - first[0], last[1] - first[1]) * ctx.camera.scale < MIN_SHAPE_PX) return;
    const ops: Op[] = [...dest.prelude];
    const start = hookedEnd(g.start, g.ids, ops);
    const finish = hookedEnd(g.hook, g.ids, ops);
    const id = g.ids.next("object");
    const shelf = new Shelf(model, g.ids);
    const { color, width } = style();
    const paint = drawnPaint(color);
    const tip = newTip(shelf, paint, color);
    const elem = connectorElem(id, kind, scene.map((p) => apply(dest.inverse, p)), start, finish, { paint, width, tip });
    ops.push(...shelf.ops(), addOp(dest, elem));
    const page = grownPage(elemBounds(elem, dest.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit(toolLabel("connector"), asGesture(ops)) === null) return;
    select([id]);
    const names = { from: g.start === null ? "" : nameOfNode(g.start.unit.node), to: g.hook === null ? "" : nameOfNode(g.hook.unit.node) };
    const said = g.start !== null && g.hook !== null ? "draw.added.connector.both" : g.start !== null ? "draw.added.connector.from" : g.hook !== null ? "draw.added.connector.to" : "draw.added.connector";
    announce(`${t(said, names)} ${objects()}`);
  };

  /// La punta di un connettore nuovo, un triangolo medio alla fine, del
  /// colore con cui si scrive `color`, `paint`: un marcatore di `shelf`.
  const newTip = (shelf: Shelf, paint: string, color: string): string => {
    const parsed = parsePaint(color);
    return shelf.idFor({ shape: "triangle", size: DEFAULT_TIP_SIZE }, "end", { paint: paint !== color || parsed === null ? paint : paintCode(parsed), opacity: 1 });
  };

  /// «Collega le forme scelte», dallo Standard: ogni oggetto scelto si
  /// unisce al seguente sul foglio con un connettore del tipo scelto per
  /// ultimo, col colore e lo spessore della penna. I connettori nuovi
  /// restano scelti, e il pannello li mostra.
  function connectSelection(): void {
    // In sola lettura il comando c'è e lo dice, invece di non fare niente.
    if (has("connector") && !editable()) {
      announce(t("draw.rejected", { reason: t("draw.reason.read_only") }));
      return;
    }
    const units = ctx.arranging("connector");
    const model = ctx.engine.model;
    if (units === null || model === null) return;
    const ids = newIds();
    const to = target(ids);
    if (to === null) return;
    const pen = styles.pen;
    const paint = drawnPaint(pen.color, pen);
    const shelf = new Shelf(model, ids);
    const made = connectOps(model, units, ctx.connectorKind, { paint, width: pen.width, tip: newTip(shelf, paint, pen.color) }, to, ids, measureText);
    if (made === null) {
      announce(t("draw.connect.few"));
      return;
    }
    if (made.lines.length === 0) {
      announce(t("draw.connect.already"));
      return;
    }
    if (commit("draw.action.connect", asGesture([...to.prelude, ...made.idents, ...shelf.ops(), ...made.adds])) === null) return;
    select(made.lines);
    const skipped = made.skipped === 0 ? "" : ` ${plural(made.skipped, "draw.connect.skipped.one", "draw.connect.skipped.other")}`;
    announce(`${plural(made.lines.length, "draw.connect.done.one", "draw.connect.done.other")}${skipped} ${objects()}`);
  }
  ctx.connectSelection = connectSelection;

  /// Riaggancia il capo `grabbed` all'oggetto sotto il puntatore, o lo
  /// lascia libero dove si è rilasciato; il percorso si rifà con l'altro
  /// capo dov'è.
  const hookEnd = (g: ConnectorGesture, grabbed: LineEnd, [from, to]: [EndInput, EndInput]): void => {
    const line = ctx.engine.holder(grabbed.id);
    const kind = line?.details?.connector?.geom.kind;
    if (line === null || kind === undefined) return;
    const attrs = connectorAttrsFor(line, kind, from, to, measureText);
    if (attrs === null) return;
    const ops: Op[] = [];
    const end = hookedEnd(g.hook, g.ids, ops);
    ops.push({ op: "set", id: grabbed.id, attrs: { ...attrs, [`fub:${grabbed.end}`]: end === null ? null : writeConnectorEnd(end) } });
    if (commit("draw.action.connector_anchor", asGesture(ops)) === null) return;
    const which = grabbed.end === "from" ? "from" : "to";
    announce(g.hook === null ? t(`draw.connector.freed.${which}`) : t(`draw.connector.hooked.${which}`, { name: nameOfNode(g.hook.unit.node) }));
  };

  /// I connettori che seguono gli oggetti presi da `g`, portati di `m`, una
  /// trasformazione della scena, per l'anteprima: i loro `d`, e in
  /// `transforms` le loro etichette dove vanno, se `g` non le porta già.
  const followingDraft = (g: SelectGesture, m: Matrix, transforms: Map<PaintNode, string | null>): Map<PaintNode, string> => {
    const paths = new Map<PaintNode, string>();
    const model = ctx.engine.model;
    if (model === null) return paths;
    g.lines ??= new ConnectorPreview(model, new Set(g.units.map((unit) => unit.node)), (id) => ctx.engine.holder(id), measureText);
    if (g.lines.empty) return paths;
    const draft = g.lines.at(m);
    for (const [id, d] of draft.paths) {
      const node = ctx.engine.holder(id);
      for (const paint of node === null ? [] : builder.paintsOf(node)) paths.set(paint, d);
    }
    for (const [id, value] of draft.transforms) {
      const node = ctx.engine.holder(id);
      for (const paint of node === null ? [] : builder.paintsOf(node)) if (!transforms.has(paint)) transforms.set(paint, value);
    }
    return paths;
  };
  ctx.followingDraft = followingDraft;
}
