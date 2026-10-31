// L'editor del disegno: le forme tirate e i gesti della selezione. Un pezzo
// di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import type { Bounds } from "../../scene/geometry";
import { apply, compose, invert, translate, type Matrix, type Point } from "../../scene/matrix";
import type { Elem } from "../../scene/serialize";
import { t } from "../../strings";
import type { PaintNode } from "../../painter/paint";
import { movedMatrix, roundDelta, transformedMatrix, transformValue, type Destination } from "../edit";
import { boundsAfter, numericMatrix, numericOps, UNCHANGED } from "../transform";
import {
  angleOf,
  frameCenter,
  frameSize,
  gridSnap,
  gripAt,
  isCorner,
  MAGNET_DEGREES,
  MIN_SIZE,
  movedFrame,
  resized,
  resizeMatrix,
  rotation,
  rotationMatrix,
  type Frame,
} from "../frame";
import { nearestCorner, snapDelta } from "../grid";
import { sceneCorners, toScreen } from "../../view";
import type { Unit } from "../hit";
import { constrainEnd, shapeElem } from "../shapes";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, MIN_SHAPE_PX, RATIO_ROLES, ROTATE_STEP } from "./constants";
import type { EditorContext } from "./context";
import { holdsPath, scaleOf } from "./helpers";
import type { SelectGesture, ShapeGesture } from "./types";

/// Ciò che le forme e i gesti della selezione danno agli altri pezzi
/// dell'editor.
export interface SelectionGesturesContext {
  shapeEnds: (g: ShapeGesture, to: Destination) => [Point, Point] | null;
  shapeOf: (g: ShapeGesture, id: string, to: Destination) => Elem | null;
  drawShape: (g: ShapeGesture) => void;
  snappedDelta: (dx: number, dy: number, source: Point | null) => [number, number];
  moveDelta: (g: SelectGesture) => [number, number];
  rotateSelection: (degrees: number) => void;
  flipSelection: (axis: "x" | "y") => void;
  selectStart: (g: SelectGesture, p: Point) => void;
  followImages: (moved: Map<object, Matrix>, unit: Unit, next: Matrix) => void;
  boxAround: (a: Point, b: Point) => Bounds;
  slantedMarquee: (from: Point, end: Point) => { corners: readonly Point[]; screen: Bounds } | null;
  marqueed: (from: Point, end: Point) => Unit[];
  selectUpdate: (g: SelectGesture) => void;
  selectEnd: (g: SelectGesture, time: number) => void;
}

/// Monta le forme e i gesti della selezione.
export function installSelectionGestures(ctx: EditorContext): void {
  const {
    folio, has, painter, editable, currentIndex, newIds, announce, announceSelection, readFirst, stepNow, lengthSpoken, selectedUnits, inOrder, frameOf, frameNow, frameCursor, degreesText, showGrip,
    showHandles, showShape, syncControls, hookedIn, detachedNote, moveSelection, select, isolate, leaveIsolation, isolable,
    gridOn, noted, snapped
  } = ctx;

  /// Gli estremi di una forma nelle coordinate del suo livello, con Maiusc
  /// applicato lì: un quadrato resta un quadrato nel livello.
  const shapeEnds = (g: ShapeGesture, to: Destination): [Point, Point] | null => {
    if (g.from === null || g.end === null) return null;
    const from = apply(to.inverse, g.from);
    const end = apply(to.inverse, snapped(g.end));
    return [from, ctx.shift ? constrainEnd(g.tool, from, end) : end];
  };
  ctx.shapeEnds = shapeEnds;

  const minimumFor = (to: Destination): number => {
    const scale = ctx.camera.scale * scaleOf(to.matrix);
    return scale > 0 ? MIN_SHAPE_PX / scale : 0;
  };

  /// L'elemento della forma di `g`, con l'id `id`, nel livello `to`: un
  /// poligono come lo vuole lo strumento, diritto con Maiusc.
  const shapeOf = (g: ShapeGesture, id: string, to: Destination): Elem | null => {
    const ends = shapeEnds(g, to);
    if (ends === null) return null;
    return shapeElem(g.tool, id, ends[0], ends[1], { color: g.color, width: g.width }, minimumFor(to));
  };
  ctx.shapeOf = shapeOf;

  const drawShape = (g: ShapeGesture): void => {
    showShape(shapeOf(g, "preview", g.to), g.to.matrix);
  };
  ctx.drawShape = drawShape;



  /// Lo spostamento di (`dx`, `dy`) di ciò che si prende nel punto
  /// `source`: con la griglia il punto preso va sull'incrocio. Ctrl o ⌘ lo
  /// lascia libero.
  const snappedDelta = (dx: number, dy: number, source: Point | null): [number, number] => {
    const line = gridOn() && !ctx.free && source !== null ? snapDelta(source, dx, dy, stepNow()) : null;
    return line ?? [roundDelta(dx), roundDelta(dy)];
  };
  ctx.snappedDelta = snappedDelta;

  /// Lo spostamento del gesto `g`, che porta la geometria scelta (vedi
  /// [`snappedDelta`]).
  const moveDelta = (g: SelectGesture): [number, number] => {
    if (g.from === null || g.end === null) return [0, 0];
    return snappedDelta(g.end[0] - g.from[0], g.end[1] - g.from[1], g.source);
  };
  ctx.moveDelta = moveDelta;

  /// La trasformazione della scena del ridimensionamento in corso. Gli
  /// angoli tengono le proporzioni degli oggetti che, deformati, non sono più
  /// loro, e Maiusc inverte la scelta; Alt tiene fermo il centro. Con la
  /// griglia o con le guide, a cornice dritta, si tira la geometria, senza il
  /// contorno, e il bordo tirato si ferma sulla riga o sul bersaglio più
  /// vicino.
  const resizeNow = (g: SelectGesture): Matrix | null => {
    if (g.grip === null || g.grip.grip === "rotate" || g.from === null || g.end === null) return null;
    const { grip, frame } = g.grip;
    const inverse = invert(frame.matrix);
    if (inverse === null) return null;
    const [a, b, c, d] = inverse;
    const delta = apply([a, b, c, d, 0, 0], [roundDelta(g.end[0] - g.from[0]), roundDelta(g.end[1] - g.from[1])]);
    const snap = gridOn() && !ctx.free ? gridSnap(frame.matrix, stepNow()) : null;
    const work = snap === null ? frame.box : frame.geometry;
    const [m0, m1, m2, m3] = frame.matrix;
    const minimum: [number, number] = [MIN_SIZE / Math.hypot(m0, m1), MIN_SIZE / Math.hypot(m2, m3)];
    const ratio = isCorner(grip) && g.units.some((unit) => RATIO_ROLES.has(unit.role)) !== ctx.shift;
    return resizeMatrix(frame, work, resized(work, grip, delta, { ratio, fromCenter: ctx.alt, minimum, snap }));
  };

  /// La trasformazione della scena della rotazione in corso, attorno al
  /// centro della cornice. Con Maiusc l'angolo va a passi di 15°; senza, si
  /// ferma da solo sugli angoli retti, se Ctrl o ⌘ non lo lascia libero.
  const rotateNow = (g: SelectGesture): Matrix | null => {
    if (g.grip === null || g.from === null || g.end === null) return null;
    const { frame } = g.grip;
    const pivot = frameCenter(frame);
    g.angle = rotation(pivot, g.from, g.end, angleOf(frame.matrix), { step: ctx.shift ? ROTATE_STEP : null, magnet: ctx.free ? 0 : MAGNET_DEGREES });
    return rotationMatrix(pivot, g.angle);
  };

  /// Scrive `m`, la trasformazione della cornice `frame`, in un passo, e lo
  /// dice: le misure di dopo, e `note`, a che cosa si è agganciato, o, per
  /// una rotazione di `turn` gradi, di quanto. Più oggetti tengono la
  /// cornice com'è diventata.
  const applyFrame = (units: readonly Unit[], frame: Frame, m: Matrix, turn: number | null): void => {
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) {
      announce(t("draw.transform.unwritable"));
      return;
    }
    if (transformed.changed === 0) return;
    const hooked = hookedIn(units);
    if (ctx.arrange(turn === null ? "draw.action.resize" : "draw.action.rotate", transformed, boundsAfter(units, m)) === null) return;
    const after = movedFrame(frame, m);
    ctx.kept = units.length > 1 ? { index: currentIndex(), keys: ctx.selection.join("\n"), frame: after } : null;
    showHandles();
    if (turn === null) {
      const [width, height] = frameSize(after);
      announce(noted(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }), detachedNote(hooked)));
    } else {
      announce(noted(t(turn > 0 ? "draw.rotated.clockwise" : "draw.rotated.counter", { angle: degreesText(Math.abs(turn)) }), detachedNote(hooked)));
    }
  };

  /// `[` e `]`: la selezione ruota di `degrees` gradi, in senso orario se
  /// positivi, attorno al centro della sua cornice.
  const rotateSelection = (degrees: number): void => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return;
    applyFrame(units, frame, rotationMatrix(frameCenter(frame), degrees), degrees);
  };
  ctx.rotateSelection = rotateSelection;

  /// Maiusc+H e Maiusc+V: la selezione si riflette attorno al centro della
  /// sua cornice, da sinistra a destra o dall'alto in basso del foglio.
  const flipSelection = (axis: "x" | "y"): void => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return;
    const m = numericMatrix({ ...UNCHANGED, scaleX: axis === "x" ? -1 : 1, scaleY: axis === "y" ? -1 : 1 }, frameCenter(frame));
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) {
      announce(t("draw.transform.unwritable"));
      return;
    }
    if (transformed.changed === 0) return;
    const hooked = hookedIn(units);
    if (ctx.arrange("draw.action.flip", transformed, boundsAfter(units, m)) === null) return;
    ctx.kept = units.length > 1 ? { index: currentIndex(), keys: ctx.selection.join("\n"), frame: movedFrame(frame, m) } : null;
    showHandles();
    announce(noted(t(axis === "x" ? "draw.flipped.x" : "draw.flipped.y"), detachedNote(hooked)));
  };
  ctx.flipSelection = flipSelection;

  /// Il primo punto di un gesto di selezione: una maniglia della cornice si
  /// potrà tirare; un oggetto sotto il puntatore si sceglie e si potrà
  /// trascinare; il vuoto comincia un riquadro.
  const selectStart = (g: SelectGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    const view = frameNow();
    const grip = view === null ? null : gripAt(view, p, ctx.camera.scale, g.pointer);
    if (grip !== null) {
      g.grip = { grip, frame: view!.frame };
      g.units = selectedUnits();
      return;
    }
    // Con Ctrl o ⌘ si sceglie dentro i gruppi: l'oggetto più dentro sotto il
    // puntatore.
    const index = currentIndex();
    const tolerance = HIT_PX[g.pointer] / ctx.camera.scale;
    let hit = ctx.free && has("selection") ? index.deepAt(p, tolerance) : index.at(p, tolerance);
    // Sopra un oggetto scelto dentro un gruppo, il gesto prende lui: si
    // trascina senza il gruppo, e Maiusc lo toglie.
    if (hit !== null && !ctx.selection.includes(hit.key) && has("selection")) {
      const top = hit;
      const deep = index.deepAt(p, tolerance);
      const inner = deep === null ? undefined : selectedUnits().find((unit) => holdsPath(top.path, unit.path) && (unit.key === deep.key || holdsPath(unit.path, deep.path)));
      if (inner !== undefined) hit = inner;
    }
    g.hit = hit?.key ?? null;
    if (hit === null) {
      g.mode = "marquee";
      g.base = ctx.shift ? ctx.selection : [];
      if (!ctx.shift) select([]);
      return;
    }
    const chosen = ctx.selection.includes(hit.key);
    if (ctx.shift) {
      // Aggiunto un oggetto, il gruppo scelto che lo contiene lo lascia.
      if (chosen) g.release = hit.key;
      else select([...selectedUnits().filter((unit) => !holdsPath(unit.path, hit.path)).map((unit) => unit.key), hit.key]);
    } else if (!chosen) {
      select([hit.key]);
    }
    g.units = selectedUnits();
    const geometry = ctx.geometryOf(g.units);
    g.source = geometry === null ? null : nearestCorner(geometry, p);
  };
  ctx.selectStart = selectStart;

  /// Porta in `moved` lo spostamento della scena che il `transform` `next`
  /// dà a `unit`, se è un contenitore: i suoi strati immagine lo seguono
  /// nell'anteprima.
  const followImages = (moved: Map<object, Matrix>, unit: Unit, next: Matrix): void => {
    if (unit.node.kind !== "container") return;
    const before = invert(unit.matrix);
    if (before !== null) moved.set(unit.node, compose(compose(unit.parent, next), before));
  };
  ctx.followImages = followImages;

  /// Il rettangolo della scena fra i punti `a` e `b`.
  const boxAround = (a: Point, b: Point): Bounds => ({
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  });
  ctx.boxAround = boxAround;

  /// Il riquadro di selezione da `from` a `end`, due punti della scena, sul
  /// foglio girato di traverso: un rettangolo dello schermo, che nella scena
  /// ha quattro angoli qualsiasi. `null` sul foglio dritto o girato di un
  /// angolo retto, dove il rettangolo della scena fra i due punti è lui.
  const slantedMarquee = (from: Point, end: Point): { corners: readonly Point[]; screen: Bounds } | null => {
    if (ctx.camera.angle % 90 === 0) return null;
    const screen = boxAround(toScreen(ctx.camera, from), toScreen(ctx.camera, end));
    const area = { x: screen.min[0], y: screen.min[1], w: screen.max[0] - screen.min[0], h: screen.max[1] - screen.min[1] };
    return { corners: sceneCorners(ctx.camera, area), screen };
  };
  ctx.slantedMarquee = slantedMarquee;

  /// Gli oggetti dentro il riquadro di selezione da `from` a `end`, come si
  /// vede: sul foglio girato di traverso, con la regola del lazo.
  const marqueed = (from: Point, end: Point): Unit[] => {
    const slanted = slantedMarquee(from, end);
    return slanted === null ? currentIndex().within(boxAround(from, end)) : currentIndex().inside(slanted.corners);
  };
  ctx.marqueed = marqueed;

  const selectUpdate = (g: SelectGesture): void => readFirst(() => updateSelect(g));
  ctx.selectUpdate = selectUpdate;

  const updateSelect = (g: SelectGesture): void => {
    if (g.from === null || g.end === null) return;
    if (g.mode === "pending") {
      const distance = Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale;
      if (distance <= DRAG_PX[g.pointer]) return;
      g.mode = g.grip === null ? "move" : g.grip.grip === "rotate" ? "rotate" : "resize";
      g.release = null;
      if (g.grip !== null) showGrip(g.grip.grip === "rotate" ? "rotating" : frameCursor(g.grip.frame, g.grip.grip));
    }
    if (g.mode === "resize" || g.mode === "rotate") {
      g.matrix = g.mode === "resize" ? resizeNow(g) : rotateNow(g);
      const transforms = new Map<PaintNode, string | null>();
      const carried = new Map<object, Matrix>();
      for (const unit of g.matrix === null ? [] : g.units) {
        const next = transformedMatrix(unit, g.matrix!);
        if (next === null) continue;
        const value = transformValue(next);
        for (const paint of unit.paints) transforms.set(paint, value);
        followImages(carried, unit, next);
      }
      const paths = g.matrix === null ? undefined : ctx.followingDraft(g, g.matrix, transforms);
      painter.setDraft({ transforms, carried, ...(paths === undefined ? {} : { paths }) });
    } else if (g.mode === "move") {
      const [dx, dy] = moveDelta(g);
      const transforms = new Map<PaintNode, string | null>();
      const carried = new Map<object, Matrix>();
      for (const unit of g.units) {
        const moved = movedMatrix(unit, dx, dy);
        if (moved === null) continue;
        const value = transformValue(moved);
        for (const paint of unit.paints) transforms.set(paint, value);
        followImages(carried, unit, moved);
      }
      const paths = ctx.followingDraft(g, translate(dx, dy), transforms);
      painter.setDraft({ transforms, carried, paths });
    } else {
      ctx.selection = inOrder([...g.base, ...marqueed(g.from, g.end).map((unit) => unit.key)]);
      syncControls();
    }
    showHandles();
  };

  const selectEnd = (g: SelectGesture, time: number): void => {
    if (g.grip !== null) {
      // Un tocco su una maniglia, senza tirarla, non cambia niente.
      ctx.lastTap = null;
      painter.setDraft(null);
      ctx.current = null;
      showGrip(null);
      if (g.mode !== "pending" && g.matrix !== null) applyFrame(g.units, g.grip.frame, g.matrix, g.mode === "rotate" ? g.angle : null);
      showHandles();
      return;
    }
    if (g.mode === "move") {
      ctx.lastTap = null;
      const [dx, dy] = moveDelta(g);
      painter.setDraft(null);
      ctx.current = null;
      moveSelection(g.units, dx, dy);
      showHandles();
      return;
    }
    ctx.current = null;
    if (g.mode === "pending" && g.release !== null) select(ctx.selection.filter((key) => key !== g.release));
    // Due tocchi su un gruppo o un collegamento lo isolano, su una nota del
    // PDF la aprono, e sul vuoto escono dal gruppo isolato.
    const still = g.from !== null && g.end !== null && Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale <= DRAG_PX[g.pointer];
    const tap = g.mode === "pending" && g.release === null && !ctx.shift && g.hit !== null && g.from !== null
      ? { key: g.hit, time, at: g.from }
      : g.mode === "marquee" && still && !ctx.shift && ctx.isolation !== null ? { key: "", time, at: g.from! } : null;
    const previous = ctx.lastTap;
    ctx.lastTap = tap;
    if (tap !== null && previous !== null && previous.key === tap.key && tap.time - previous.time <= DOUBLE_TAP_MS) {
      const apart = Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * ctx.camera.scale;
      const near = apart <= DOUBLE_TAP_PX[g.pointer];
      if (near && tap.key === "" && leaveIsolation(false)) {
        ctx.lastTap = null;
        return;
      }
      const unit = near && tap.key !== "" ? currentIndex().get(tap.key) : null;
      if (unit !== null && folio !== undefined && ctx.noteOf(unit) !== null && editable()) {
        ctx.lastTap = null;
        void ctx.editNote(unit);
        return;
      }
      if (unit !== null && isolable(unit) && isolate(unit, tap.at, g.pointer)) {
        ctx.lastTap = null;
        return;
      }
    }
    showHandles();
    announceSelection();
  };
  ctx.selectEnd = selectEnd;
}
