// L'editor del disegno: le forme dal tratto e i connettori che seguono. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { polygonalKind } from "../../describe";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import { apply, compose, type Matrix, type Point } from "../../scene/matrix";
import type { Op } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { t } from "../../strings";
import type { PaintNode } from "../../painter/paint";
import { addOp, destination, destinationIn, destinationInto, gesture as asGesture, type Destination } from "../edit";
import {
  ConnectorPreview,
} from "../connectors";
import { elemBounds } from "../hit";
import type { ShapeStyle } from "../shapes";
import { centerOf, heldShape, mapped, regular, shapeOfRecognized, similar, starOf, type Recognized } from "../recognize";
import { heldShapeOps, type HeldShape } from "../inkshape";
import { ADDED } from "./constants";
import type { EditorContext } from "./context";
import { layerRefusal, matrixText, sameDestination, scaleOf } from "./helpers";
import type { InkGesture, SelectGesture, ShapeGesture } from "./types";

/// Quanto resta fermo il puntatore alla fine di un tratto a penna perché il
/// tratto diventi una forma, in millisecondi.
const HOLD_MS = 500;

/// Quanto può tremare il puntatore che sta fermo, in pixel: la penna e il
/// dito non stanno mai fermi del tutto, il mouse sì.
const HOLD_PX: Readonly<Record<InkPointerType, number>> = { pen: 4, mouse: 3, touch: 8 };

/// Ciò che le forme dal tratto e i connettori che seguono danno agli altri pezzi dell'editor.
export interface StrokeShapesContext {
  /// Il mezzo secondo della tenuta ferma: uno solo, perché il gesto è uno.
  holdTimer: number | undefined;
  shapesOn: () => boolean;
  watchStill: (g: InkGesture, samples: readonly InkSample[]) => void;
  strokeShapeOf: (g: InkGesture) => Recognized | null;
  drawHeld: (g: InkGesture) => void;
  moveHeld: (g: InkGesture, p: Point) => void;
  finishHeld: (g: InkGesture) => void;
  finishShape: (g: ShapeGesture) => void;
  destinationNow: () => Destination | null;
  followingDraft: (g: SelectGesture, m: Matrix, transforms: Map<PaintNode, string | null>) => Map<PaintNode, string>;
}

/// Monta le forme dal tratto e i connettori che seguono.
export function installStrokeShapes(ctx: EditorContext): void {
  const {
    life, folio, has, measureText, toolLabel, suggestions, overlay, clearInk, builder, currentIndex,
    grownPage, newIds, announce, objects, showShape, currentLayer, commit, target,
    isolatedUnit, shapeEnds, shapeOf, writeInk, copiesText
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
  };
  ctx.finishHeld = finishHeld;

  /// La forma del gesto `g` entra nel disegno, e lo si dice, con `note`, a
  /// che cosa si è agganciata.
  const finishShape = (g: ShapeGesture): void => {
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
    if (commit(toolLabel(g.tool), asGesture(ops)) === null) return;
    announce(`${t(ADDED[g.tool])} ${objects()}`);
  };
  ctx.finishShape = finishShape;

  // --- I connettori che seguono ----------------------------------------------
  //
  // I connettori dei disegni che li hanno seguono gli oggetti a cui sono
  // agganciati (ADR 0231: non se ne creano più): il motore li ricalcola, e
  // l'anteprima di uno spostamento li mostra dove vanno.

  /// Dove va un oggetto nuovo, senza dirlo se non può: per l'anteprima.
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
