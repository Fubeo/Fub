// L'editor del disegno: la simmetria della penna. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { polygonalKind } from "../../describe";
import { clampSlices, isSymmetryKind, symmetryRays, type PenSymmetry } from "../symmetry";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Bounds } from "../../scene/geometry";
import { apply, compose, invert, translate, type Matrix, type Point } from "../../scene/matrix";
import type { Elem } from "../../scene/serialize";
import { t } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import type { PaintNode } from "../../painter/paint";
import { movedMatrix, roundDelta, transformedMatrix, transformValue, type Destination } from "../edit";
import { boundsAfter, numericMatrix, numericOps, UNCHANGED } from "../transform";
import type { FieldId } from "../properties";
import {
  angleOf,
  frameCenter,
  frameGuides,
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
  type Axis as FrameAxis,
  type Frame,
} from "../frame";
import { anchorsOf, GUIDE_PX, GuideIndex, nearer } from "../guides";
import { nearestCorner, snapDelta } from "../grid";
import { fromUnit } from "../rulers";
import { sceneCorners, toScene, toScreen } from "../../view";
import type { Unit } from "../hit";
import { cornerAttrs, cornerCursor, cornerDrag, shapeOps } from "../reshape";
import { constrainEnd, polygonCount, shapeElem, stepRatio, withCount } from "../shapes";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, MIN_SHAPE_PX, RATIO_ROLES, ROTATE_STEP } from "./constants";
import type { EditorContext } from "./context";
import { holdsPath, scaleOf, translated } from "./helpers";
import type { CornerDrag, GestureBase, SelectGesture, ShapeGesture, SymmetryGesture } from "./types";

/// Quanto lontano dal centro della simmetria, in pixel, il puntatore lo
/// prende; e quanto vicino al centro della pagina o di una tavola, tirato,
/// ci si aggancia.
const SYMMETRY_GRAB_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 7, touch: 16 };

const SYMMETRY_SNAP_PX: Readonly<Record<InkPointerType, number>> = { pen: 8, mouse: 6, touch: 12 };

/// Ciò che la simmetria della penna dà agli altri pezzi dell'editor.
export interface PenSymmetryContext {
  symmetryNow: () => PenSymmetry & { readonly center: Point };
  symmetryShown: () => boolean;
  setSymmetry: (next: PenSymmetry) => void;
  symmetryText: () => string;
  symmetryStart: (base: GestureBase) => SymmetryGesture | null;
  symmetryUpdate: (g: SymmetryGesture, p: Point) => void;
  symmetryEnd: (g: SymmetryGesture) => void;
  symmetryHandles: () => OverlayHandle[];
  hoverSymmetry: (p: Point | null, pointer: InkPointerType) => void;
  symmetryFromPanel: (id: FieldId, value: number | string | boolean) => string | null;
  shapeEnds: (g: ShapeGesture, to: Destination) => [Point, Point] | null;
  shapeOf: (g: ShapeGesture, id: string, to: Destination) => Elem | null;
  drawShape: (g: ShapeGesture) => void;
  polygonSaid: () => string;
  polygonKey: (event: KeyboardEvent) => boolean;
  snappedDelta: (dx: number, dy: number, source: Point | null, box: Bounds | null, guides: () => GuideIndex, pointer: InkPointerType) => [number, number];
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

/// Monta la simmetria della penna.
export function installPenSymmetry(ctx: EditorContext): void {
  const {
    folio, has, painter, boardsNow, editable, currentIndex, currentPage, newIds, announce, announceSelection, readFirst, numberText, docUnit,
    stepNow, lengthText, lengthSpoken, viewCenter, selectedUnits, inOrder, frameOf, frameNow, frameCursor, degreesText, cornerAt, showGrip,
    showHandles, showShape, syncProperties, syncControls, drawnPaint, hookedIn, detachedNote, moveSelection, select, isolate, leaveIsolation, isolable,
    setPolygonTool, gridOn, guidesOn, guideReach, guidesFor, guided, snapNote, noted
  } = ctx;
  // --- La simmetria della penna ----------------------------------------------
  //
  // Con la simmetria accesa la penna e l'evidenziatore mostrano gli assi o i
  // raggi, tratteggiati, e il centro, che si prende e si tira; ogni tratto
  // scrive anche le sue copie (`symmetry.ts`). La simmetria si sceglie nel
  // pannello delle proprietà, senza niente di scelto.

  /// Il centro della simmetria quando nessuno l'ha messo: il centro della
  /// tavola che si guarda, o della prima; senza tavole, della pagina; senza
  /// pagina, di ciò che si vede.
  const homeCenter = (): Point => {
    const list = boardsNow();
    const page = currentPage();
    let center: Point;
    if (list.length > 0) {
      const { min, max } = (ctx.boardInView() ?? list[0]!).box;
      center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    } else if (page !== null) {
      center = [page.x + page.width / 2, page.y + page.height / 2];
    } else {
      center = toScene(ctx.camera, viewCenter());
    }
    return [roundDelta(center[0]), roundDelta(center[1])];
  };

  /// La simmetria di adesso, col centro: la prima volta che serve, il
  /// centro va al suo posto.
  const symmetryNow = (): PenSymmetry & { readonly center: Point } => {
    if (ctx.symmetry.center === null) ctx.symmetry = { ...ctx.symmetry, center: homeCenter() };
    // La stessa simmetria finché non cambia: il pannello la confronta.
    return ctx.symmetry as PenSymmetry & { readonly center: Point };
  };
  ctx.symmetryNow = symmetryNow;

  /// Vero se la penna o l'evidenziatore disegnano in simmetria.
  const symmetryShown = (): boolean => has("symmetry") && ctx.symmetry.kind !== "none" && (ctx.tool === "pen" || ctx.tool === "highlighter") && editable();
  ctx.symmetryShown = symmetryShown;

  /// La simmetria diventa `next`: le guide e il pannello la seguono. Il
  /// tratto in corso finisce come era cominciato.
  const setSymmetry = (next: PenSymmetry): void => {
    ctx.symmetry = next;
    showHandles();
    syncProperties();
  };
  ctx.setSymmetry = setSymmetry;

  /// La simmetria della penna a parole; vuoto se è spenta.
  const symmetryText = (): string => {
    if (!has("symmetry")) return "";
    switch (ctx.symmetry.kind) {
      case "none":
        return "";
      case "vertical":
        return t("draw.symmetry.said.vertical");
      case "horizontal":
        return t("draw.symmetry.said.horizontal");
      case "radial":
        return t(ctx.symmetry.mirror ? "draw.symmetry.said.mirrored" : "draw.symmetry.said.radial", { count: clampSlices(ctx.symmetry.slices) });
    }
  };
  ctx.symmetryText = symmetryText;

  /// Vero se il punto `p` dello schermo sta sul centro della simmetria.
  const onSymmetryCenter = (p: Point, pointer: InkPointerType): boolean => {
    const [x, y] = toScreen(ctx.camera, symmetryNow().center);
    return Math.hypot(x - p[0], y - p[1]) <= SYMMETRY_GRAB_PX[pointer];
  };

  /// Il centro sotto il puntatore appena sceso prende il gesto, e si tira.
  const symmetryStart = (base: GestureBase): SymmetryGesture | null => {
    const down = ctx.downAt;
    if (down === null || !symmetryShown() || !onSymmetryCenter(down, base.pointer)) return null;
    const center = symmetryNow().center;
    const p = toScene(ctx.camera, down);
    return { ...base, kind: "symmetry", from: down, offset: [center[0] - p[0], center[1] - p[1]], before: center, moved: false, snapped: null };
  };
  ctx.symmetryStart = symmetryStart;

  /// I punti a cui si aggancia il centro tirato: i centri delle tavole, o
  /// senza tavole quello della pagina.
  const symmetryTargets = (): Point[] => {
    const list = boardsNow();
    const page = currentPage();
    if (list.length === 0) return page === null ? [] : [[page.x + page.width / 2, page.y + page.height / 2]];
    return list.map(({ box }): Point => [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]);
  };

  /// Il centro tirato segue il puntatore in `p`, oltre il tremito della
  /// mano; vicino al centro di una tavola o della pagina ci si aggancia,
  /// tranne con Ctrl o ⌘.
  const symmetryUpdate = (g: SymmetryGesture, p: Point): void => {
    const [x, y] = toScreen(ctx.camera, p);
    if (!g.moved && Math.hypot(x - g.from[0], y - g.from[1]) <= DRAG_PX[g.pointer]) return;
    if (!g.moved) showGrip("move");
    g.moved = true;
    const next: Point = [p[0] + g.offset[0], p[1] + g.offset[1]];
    let reach = ctx.free ? 0 : SYMMETRY_SNAP_PX[g.pointer] / ctx.camera.scale;
    g.snapped = null;
    for (const target of symmetryTargets()) {
      const far = Math.hypot(target[0] - next[0], target[1] - next[1]);
      if (far <= reach) {
        reach = far;
        g.snapped = target;
      }
    }
    const [cx, cy] = g.snapped ?? next;
    ctx.symmetry = { ...ctx.symmetry, center: [roundDelta(cx), roundDelta(cy)] };
    showHandles();
    syncProperties();
  };
  ctx.symmetryUpdate = symmetryUpdate;

  /// La fine del gesto che tira il centro: si dice dove sta. Un tocco fermo
  /// non cambia niente.
  const symmetryEnd = (g: SymmetryGesture): void => {
    ctx.current = null;
    showGrip(null);
    showHandles();
    if (!g.moved) return;
    const [x, y] = symmetryNow().center;
    const said = g.snapped === null ? "draw.symmetry.moved" : boardsNow().length > 0 ? "draw.symmetry.snapped.board" : "draw.symmetry.snapped.page";
    announce(t(said, { x: lengthSpoken(x), y: lengthSpoken(y) }));
  };
  ctx.symmetryEnd = symmetryEnd;

  /// Le guide della simmetria, con la penna e l'evidenziatore, e mentre si
  /// tira il centro dove sta.
  const symmetryHandles = (): OverlayHandle[] => {
    if (!symmetryShown()) return [];
    const now = symmetryNow();
    const [x, y] = now.center;
    const g = ctx.current?.kind === "symmetry" && ctx.current.moved ? ctx.current : null;
    const out: OverlayHandle[] = [{ kind: "symmetry", center: now.center, rays: symmetryRays(now), active: g !== null }];
    if (g !== null) out.push({ kind: "label", x, y, text: t("draw.cursor.at", { x: lengthText(x), y: lengthText(y) }) });
    return out;
  };
  ctx.symmetryHandles = symmetryHandles;

  /// Il puntatore passa sopra `p`, sullo schermo, senza premere: sopra il
  /// centro della simmetria il cursore dice che lo sposta.
  const hoverSymmetry = (p: Point | null, pointer: InkPointerType): void => {
    if (p !== null && symmetryShown() && onSymmetryCenter(p, pointer)) showGrip("move");
  };
  ctx.hoverSymmetry = hoverSymmetry;

  /// Un campo di «Simmetria»: cambia la simmetria della penna. «Rimetti al
  /// centro» la riporta al centro della tavola che si guarda, o della
  /// pagina.
  const symmetryFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const now = symmetryNow();
    if (id === "symmetry" && value === "center") {
      setSymmetry({ ...now, center: homeCenter() });
      const [x, y] = symmetryNow().center;
      announce(t("draw.symmetry.recentered", { x: lengthSpoken(x), y: lengthSpoken(y) }));
    } else if (id === "symmetry" && typeof value === "string" && isSymmetryKind(value)) {
      setSymmetry({ ...now, kind: value });
    } else if (id === "symmetrySlices" && typeof value === "number") {
      setSymmetry({ ...now, slices: clampSlices(value) });
    } else if (id === "symmetryMirror" && typeof value === "boolean") {
      setSymmetry({ ...now, mirror: value });
    } else if ((id === "symmetryX" || id === "symmetryY") && typeof value === "number") {
      const at = roundDelta(fromUnit(value, docUnit()));
      setSymmetry({ ...now, center: id === "symmetryX" ? [at, now.center[1]] : [now.center[0], at] });
    }
    return null;
  };
  ctx.symmetryFromPanel = symmetryFromPanel;

  /// Gli estremi di una forma nelle coordinate del suo livello, con Maiusc
  /// applicato lì: un quadrato resta un quadrato nel livello.
  const shapeEnds = (g: ShapeGesture, to: Destination): [Point, Point] | null => {
    if (g.from === null || g.end === null) return null;
    const from = apply(to.inverse, g.from);
    const end = apply(to.inverse, guided(g.end, () => guidesFor(g, []), g.pointer));
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
    return shapeElem(g.tool, id, ends[0], ends[1], { color: drawnPaint(g.color), width: g.width }, minimumFor(to), { ...ctx.polygonTool, straight: ctx.shift });
  };
  ctx.shapeOf = shapeOf;

  const drawShape = (g: ShapeGesture): void => {
    showShape(shapeOf(g, "preview", g.to), g.to.matrix);
    // Le guide seguono il punto che si tira.
    if (guidesOn() || ctx.guiding) showHandles();
  };
  ctx.drawShape = drawShape;

  /// Il poligono o la stella che lo strumento disegna, a parole: «Esagono»,
  /// «Stella a 5 punte».
  const polygonSaid = (): string => polygonalKind({ shape: ctx.polygonTool.shape, count: polygonCount(ctx.polygonTool) });
  ctx.polygonSaid = polygonSaid;

  /// I tasti di un poligono mentre lo si disegna: ↑ e ↓, o Pag↑ e Pag↓, un
  /// lato o una punta in più o in meno, ← e → il raggio interno di una
  /// stella. Mentre la tastiera tiene premuto le frecce muovono il cursore, e
  /// restano i tasti di pagina. Vero se il tasto era del poligono: anche ← e
  /// → di un poligono, che non spostano niente a metà gesto.
  const polygonKey = (event: KeyboardEvent): boolean => {
    const arrowsFree = ctx.pressed === null;
    const count =
      event.key === "PageUp" || (arrowsFree && event.key === "ArrowUp") ? 1 : event.key === "PageDown" || (arrowsFree && event.key === "ArrowDown") ? -1 : 0;
    const ratio = arrowsFree && event.key === "ArrowRight" ? 1 : arrowsFree && event.key === "ArrowLeft" ? -1 : 0;
    if (count !== 0) {
      setPolygonTool(withCount(ctx.polygonTool, polygonCount(ctx.polygonTool) + count));
      announce(t("draw.polygon.count.said", { kind: polygonSaid() }));
    } else if (ratio !== 0 && ctx.polygonTool.shape === "star") {
      setPolygonTool({ ...ctx.polygonTool, ratio: stepRatio(ctx.polygonTool.ratio, ratio) });
      announce(t("draw.polygon.ratio.said", { value: numberText(ctx.polygonTool.ratio * 100) }));
    }
    return count !== 0 || ratio !== 0;
  };
  ctx.polygonKey = polygonKey;

  /// Lo spostamento di (`dx`, `dy`) di ciò che ha la geometria `box`, preso
  /// nel punto `source`, coi bersagli di `guides`. Con la griglia il punto
  /// preso va sull'incrocio; con le guide, lungo ciascun asse, un bordo o il
  /// centro della geometria va sul bersaglio più vicino, o dove le distanze
  /// sono uguali; fra la griglia e le guide vince il più vicino. Ctrl o ⌘ lo
  /// lascia libero.
  const snappedDelta = (dx: number, dy: number, source: Point | null, box: Bounds | null, guides: () => GuideIndex, pointer: InkPointerType): [number, number] => {
    if (ctx.free) return [roundDelta(dx), roundDelta(dy)];
    const line = gridOn() && source !== null ? snapDelta(source, dx, dy, stepNow()) : null;
    if (box === null || !guidesOn()) return line ?? [roundDelta(dx), roundDelta(dy)];
    const index = guides();
    const reach = guideReach(pointer);
    const moved = translated(box, dx, dy)!;
    const raw = [dx, dy] as const;
    const along = (axis: FrameAxis): number => {
      // In linea vince, a pari scarto, sulle distanze uguali.
      const align = index.snap(axis, anchorsOf(moved, axis).map((anchor) => anchor.value), reach);
      const space = index.spaceSnap(axis, moved, reach);
      const offset = align !== null && (space === null || Math.abs(align) <= Math.abs(space)) ? align : space;
      const value = nearer(raw[axis], offset === null ? null : raw[axis] + offset, line === null ? null : line[axis]);
      return line !== null && value === line[axis] ? value : roundDelta(value);
    };
    return [along(0), along(1)];
  };
  ctx.snappedDelta = snappedDelta;

  /// Lo spostamento del gesto `g`, che porta la geometria scelta (vedi
  /// [`snappedDelta`]).
  const moveDelta = (g: SelectGesture): [number, number] => {
    if (g.from === null || g.end === null) return [0, 0];
    const box = guidesOn() && !ctx.free ? ctx.geometryOf(g.units) : null;
    return snappedDelta(g.end[0] - g.from[0], g.end[1] - g.from[1], g.source, box, () => guidesFor(g, g.units.map((unit) => unit.key)), g.pointer);
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
    const guides = guidesOn() && !ctx.free ? frameGuides(guidesFor(g, g.units.map((unit) => unit.key)), frame.matrix, GUIDE_PX[g.pointer], ctx.camera.scale) : null;
    const work = snap === null && guides === null ? frame.box : frame.geometry;
    const [m0, m1, m2, m3] = frame.matrix;
    const minimum: [number, number] = [MIN_SIZE / Math.hypot(m0, m1), MIN_SIZE / Math.hypot(m2, m3)];
    const ratio = isCorner(grip) && g.units.some((unit) => RATIO_ROLES.has(unit.role)) !== ctx.shift;
    return resizeMatrix(frame, work, resized(work, grip, delta, { ratio, fromCenter: ctx.alt, minimum, snap, guides }));
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
  const applyFrame = (units: readonly Unit[], frame: Frame, m: Matrix, turn: number | null, note = ""): void => {
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
      announce(noted(noted(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }), note), detachedNote(hooked)));
    } else {
      announce(noted(t(turn > 0 ? "draw.rotated.clockwise" : "draw.rotated.counter", { angle: degreesText(Math.abs(turn)) }), detachedNote(hooked)));
    }
  };

  /// `[` e `]`: la selezione ruota di `degrees` gradi, in senso orario se
  /// positivi, attorno al centro della sua cornice.
  const rotateSelection = (degrees: number): void => {
    ctx.settleCrop();
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return;
    applyFrame(units, frame, rotationMatrix(frameCenter(frame), degrees), degrees);
  };
  ctx.rotateSelection = rotateSelection;

  /// Maiusc+H e Maiusc+V: la selezione si riflette attorno al centro della
  /// sua cornice, da sinistra a destra o dall'alto in basso del foglio.
  const flipSelection = (axis: "x" | "y"): void => {
    ctx.settleCrop();
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
    const corner = cornerAt(p, g.pointer, view, grip);
    const inverse = corner === null ? null : invert(corner.unit.matrix);
    if (corner !== null && inverse !== null) {
      g.corner = { unit: corner.unit, grip: corner.grip, from: apply(inverse, p), radius: corner.grip.radius };
      g.units = [corner.unit];
      return;
    }
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

  /// La maniglia degli angoli tirata in `p`, un punto della scena: il raggio
  /// nuovo, e l'oggetto che lo mostra.
  const cornerUpdate = (drag: CornerDrag, p: Point): void => {
    const inverse = invert(drag.unit.matrix);
    if (inverse === null) return;
    drag.radius = cornerDrag(drag.grip, drag.from, apply(inverse, p), drag.grip.radius);
    const attrs = cornerAttrs(drag.unit.node, drag.unit.role, drag.radius);
    if (attrs === null) {
      painter.setDraft(null);
      return;
    }
    const d = attrs.d;
    if (typeof d === "string") painter.setDraft({ paths: new Map(drag.unit.paints.map((paint) => [paint, d])) });
    else painter.setDraft({ radii: new Map(drag.unit.paints.map((paint) => [paint, attrs])) });
  };

  /// Scrive il raggio a cui si è lasciata la maniglia degli angoli, in un
  /// passo, e lo dice.
  const applyCorner = (drag: CornerDrag): void => {
    const model = ctx.engine.model;
    if (model === null) return;
    const scale = scaleOf(drag.unit.matrix);
    const reshaped = shapeOps(model, [drag.unit], { corner: drag.radius * scale }, newIds(), ctx.polygonTool);
    if (reshaped.ops.length === 0) return;
    if (ctx.arrange("draw.action.corner", reshaped) !== null) announce(t("draw.corner.said", { value: lengthText(drag.radius * scale) }));
  };

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
      g.mode = g.corner !== null ? "corner" : g.grip === null ? "move" : g.grip.grip === "rotate" ? "rotate" : "resize";
      g.release = null;
      if (g.corner !== null) showGrip(cornerCursor(g.corner.grip, g.corner.unit.matrix, ctx.camera.angle));
      else if (g.grip !== null) showGrip(g.grip.grip === "rotate" ? "rotating" : frameCursor(g.grip.frame, g.grip.grip));
    }
    if (g.mode === "corner") {
      cornerUpdate(g.corner!, g.end);
      showHandles();
      return;
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
    if (g.corner !== null) {
      // Come per la cornice, un tocco sulla maniglia non cambia niente.
      ctx.lastTap = null;
      painter.setDraft(null);
      ctx.current = null;
      showGrip(null);
      if (g.mode === "corner") applyCorner(g.corner);
      showHandles();
      return;
    }
    if (g.grip !== null) {
      // Un tocco su una maniglia, senza tirarla, non cambia niente.
      ctx.lastTap = null;
      painter.setDraft(null);
      const note = g.mode === "resize" ? snapNote() : "";
      ctx.current = null;
      showGrip(null);
      if (g.mode !== "pending" && g.matrix !== null) applyFrame(g.units, g.grip.frame, g.matrix, g.mode === "rotate" ? g.angle : null, note);
      showHandles();
      return;
    }
    if (g.mode === "move") {
      ctx.lastTap = null;
      const [dx, dy] = moveDelta(g);
      const note = snapNote();
      painter.setDraft(null);
      ctx.current = null;
      moveSelection(g.units, dx, dy, note);
      showHandles();
      return;
    }
    ctx.current = null;
    if (g.mode === "pending" && g.release !== null) select(ctx.selection.filter((key) => key !== g.release));
    // Due tocchi sullo stesso testo lo aprono, su un gruppo o un collegamento
    // lo isolano, e sul vuoto escono dal gruppo isolato.
    const still = g.from !== null && g.end !== null && Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale <= DRAG_PX[g.pointer];
    // Il vuoto dentro una forma chiusa senza riempimento conta come la forma:
    // due tocchi ne aprono l'etichetta, come in draw.io.
    const inside = g.mode === "marquee" && still && !ctx.shift ? ctx.labelHostAt(g.from!) : null;
    const tap = g.mode === "pending" && g.release === null && !ctx.shift && g.hit !== null && g.from !== null
      ? { key: g.hit, time, at: g.from }
      : inside !== null ? { key: inside.key, time, at: g.from! }
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
      if (unit !== null && unit.look !== null && has("text") && editable()) {
        ctx.lastTap = null;
        ctx.editText(unit);
        return;
      }
      // Due tocchi su una forma chiusa ci scrivono dentro, come in Visio e
      // in PowerPoint; su un gruppo fatto di una forma e della sua etichetta
      // cambiano l'etichetta, invece di isolarlo.
      if (unit !== null && ctx.editLabel(unit)) {
        ctx.lastTap = null;
        return;
      }
      // Due tocchi su un'immagine la ritagliano, come in Illustrator.
      if (unit !== null && unit.role === "image" && has("crop") && editable() && ctx.selection.length === 1 && ctx.selection[0] === unit.key) {
        ctx.lastTap = null;
        ctx.openCrop(false);
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
