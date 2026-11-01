// L'editor del disegno: i segni sul foglio: la selezione, la cornice e i
// collegamenti. Un pezzo di createDrawEditor (`../editor.ts`): lavora sul
// contesto che i pezzi condividono.

import { iconEl } from "../../../../ui/icons";
import { linkName } from "../../describe";
import type { Bounds } from "../../scene/geometry";
import { apply, compose, IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import { SVG_NS } from "../../scene/read";
import type { Elem } from "../../scene/serialize";
import { t } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { movedMatrix } from "../edit";
import { linkTarget, nodeOf } from "../arrange";
import {
  angleOf,
  FRAME_PX,
  frameSize,
  frameView,
  gripCursor,
  movedFrame,
  normalized,
  type Frame,
  type FrameView,
  type Grip,
  type GripCursor,
} from "../frame";
import { screenBox } from "../../view";
import type { Unit } from "../hit";
import type { EditorContext } from "./context";
import { comparePaths, holdsPath, matrixText, translated, union } from "./helpers";

/// Di quanto il segno di un collegamento scelto si scosta, in pixel CSS, in
/// alto e a destra: oltre la maniglia d'angolo, che sporge di 4 dalla cornice.
const MARK_CLEAR_PX = FRAME_PX + 4;

/// Un collegamento che si vede, col suo segno sul foglio.
interface LinkMark {
  readonly unit: Unit;
  /// Dove porta, com'è scritto.
  readonly target: string;
  readonly element: HTMLButtonElement;
}

/// Ciò che i segni sul foglio: la selezione, la cornice e i collegamenti dà agli altri pezzi dell'editor.
export interface MarksContext {
  selectedUnits: () => Unit[];
  inOrder: (keys: Iterable<string>) => string[];
  frameOf: (units: readonly Unit[]) => Frame | null;
  frameNow: () => FrameView | null;
  frameCursor: (frame: Frame, grip: Grip) => GripCursor;
  measuresText: (arg0: readonly [number, number]) => string;
  degreesText: (degrees: number) => string;
  showGrip: (cursor: GripCursor | "rotating" | "move" | "copy" | null) => void;
  showHandles: () => void;
  /// I collegamenti che si vedono, ognuno col suo segno: si ricostruiscono
  /// quando cambia la scena.
  marks: LinkMark[] | null;
  openLink: (target: string) => void;
  showShape: (elem: Elem | null, matrix: Matrix, defs?: readonly Elem[]) => void;
  clearPreviews: () => void;
}

/// Monta i segni sul foglio: la selezione, la cornice e i collegamenti.
export function installMarks(ctx: EditorContext): void {
  const {
    life, relabels, surface, linkLayer, painter, previewLayer, overlay, clearInk, indexer, editable, currentIndex, readFirst, numberText,
    coordText, lengthText, options
  } = ctx;
  // --- Selezione e anteprime ----------------------------------------------

  /// Gli oggetti di `keys` che si scelgono adesso, anche dentro i gruppi,
  /// una volta sola e in ordine di documento; di un gruppo scelto non anche
  /// ciò che contiene, che si muove già con lui.
  const unitsOf = (keys: Iterable<string>): Unit[] => {
    const index = currentIndex();
    const found = new Map<string, Unit>();
    for (const key of keys) {
      const unit = index.get(key);
      if (unit !== null) found.set(unit.key, unit);
    }
    const out: Unit[] = [];
    // In ordine di documento chi contiene viene subito prima di ciò che
    // contiene: basta guardare l'ultimo tenuto.
    for (const unit of [...found.values()].sort((a, b) => comparePaths(a.path, b.path))) {
      const last = out[out.length - 1];
      if (last === undefined || !holdsPath(last.path, unit.path)) out.push(unit);
    }
    return out;
  };

  const selectedUnits = (): Unit[] => unitsOf(ctx.selection);
  ctx.selectedUnits = selectedUnits;

  /// Le chiavi di `keys` che sono oggetti adesso, come [`unitsOf`].
  const inOrder = (keys: Iterable<string>): string[] => unitsOf(keys).map((unit) => unit.key);
  ctx.inOrder = inOrder;

  // --- La cornice di trasformazione ------------------------------------------

  /// La cornice di `units`: quella di un oggetto solo, che ruota con lui, o
  /// il riquadro comune di più oggetti, se non ne tengono uno loro. `null`
  /// se non disegnano niente.
  const frameOf = (units: readonly Unit[]): Frame | null => {
    if (units.length === 1) {
      const unit = units[0]!;
      const box = unit.frame();
      return box === null ? null : { matrix: unit.matrix, box, geometry: unit.shapeFrame() ?? box };
    }
    if (ctx.kept !== null && ctx.kept.index === currentIndex() && ctx.kept.keys === units.map((unit) => unit.key).join("\n")) return ctx.kept.frame;
    let box: Bounds | null = null;
    let geometry: Bounds | null = null;
    for (const unit of units) {
      box = union(box, unit.bounds);
      geometry = union(geometry, unit.geometry ?? unit.bounds);
    }
    return box === null ? null : { matrix: IDENTITY, box, geometry: geometry ?? box };
  };
  ctx.frameOf = frameOf;

  /// La cornice che si vede adesso: con lo strumento Selezione, se il
  /// disegno si scrive. Durante un gesto della cornice, com'è diventata;
  /// mentre si sposta o si sceglie col riquadro, nessuna, e nemmeno mentre
  /// si ritaglia, che ha i suoi segni.
  const frameNow = (): FrameView | null => {
    if (ctx.tool !== "select" || !editable() || ctx.selection.length === 0) return null;
    const g = ctx.current?.kind === "select" ? ctx.current : null;
    if (g !== null && (g.mode === "move" || g.mode === "marquee")) return null;
    if (g !== null && g.grip !== null) return frameView(g.matrix === null ? g.grip.frame : movedFrame(g.grip.frame, g.matrix), ctx.camera.scale);
    const frame = frameOf(selectedUnits());
    return frame === null ? null : frameView(frame, ctx.camera.scale);
  };
  ctx.frameNow = frameNow;

  /// Il cursore della maniglia `grip` della cornice `frame`.
  const frameCursor = (frame: Frame, grip: Grip): GripCursor => gripCursor(frame, grip, ctx.camera.angle);
  ctx.frameCursor = frameCursor;

  /// Le misure e gli angoli come si leggono sulla cornice: le misure
  /// nell'unità del documento, con la sigla una volta in fondo.
  const measuresText = ([width, height]: readonly [number, number]): string => `${coordText(width)} × ${lengthText(height)}`;
  ctx.measuresText = measuresText;
  const degreesText = (degrees: number): string => `${numberText(degrees)}°`;
  ctx.degreesText = degreesText;

  /// La cornice fra le maniglie: il riquadro comune di più oggetti, le
  /// maniglie, e sotto di lei le misure, o l'angolo mentre la si gira.
  const frameHandles = (): OverlayHandle[] => {
    const view = frameNow();
    if (view === null) return [];
    const out: OverlayHandle[] = [];
    const { min, max } = view.padded;
    if (ctx.selection.length > 1) {
      out.push({ kind: "box", x: min[0], y: min[1], width: max[0] - min[0], height: max[1] - min[1], matrix: view.frame.matrix });
    }
    for (const { grip, at } of view.spots) {
      out.push(grip === "rotate" ? { kind: "rotor", x: at[0], y: at[1], stem: view.stem } : { kind: "grip", x: at[0], y: at[1] });
    }
    const g = ctx.current?.kind === "select" && (ctx.current.mode === "resize" || ctx.current.mode === "rotate") ? ctx.current : null;
    if (g !== null || ctx.current === null) {
      const corners = [min, [max[0], min[1]], max, [min[0], max[1]]].map((corner) => apply(view.frame.matrix, corner as Point));
      const x = corners.reduce((sum, corner) => sum + corner[0], 0) / 4;
      const y = Math.max(...corners.map((corner) => corner[1]));
      const text = g?.mode === "rotate" ? degreesText(normalized(angleOf(g.grip!.frame.matrix) + g.angle)) : measuresText(frameSize(view.frame));
      out.push({ kind: "label", x, y, text });
    }
    return out;
  };

  /// Il cursore del foglio sopra una maniglia, o durante il suo gesto; sopra
  /// una tavola, con lo strumento Tavola, quello che sposta, o con Alt,
  /// mentre la si sposta, quello che copia.
  const showGrip = (cursor: GripCursor | "rotating" | "move" | "copy" | null): void => {
    if (cursor === null) delete surface.dataset.grip;
    else surface.dataset.grip = cursor;
  };
  ctx.showGrip = showGrip;

  /// Le cornici della selezione e il riquadro di un trascinamento sul
  /// vuoto. Le misure della banda di stato seguono.
  const showHandles = (): void => {
    readFirst(placeHandles);
    ctx.statusChanged();
  };
  ctx.showHandles = showHandles;

  const placeHandles = (): void => {
    const handles: OverlayHandle[] = [];
    const move = ctx.current?.kind === "select" && ctx.current.mode === "move" ? ctx.current : null;
    const delta = move === null ? null : ctx.moveDelta(move);
    const shaping = ctx.current?.kind === "select" && (ctx.current.mode === "resize" || ctx.current.mode === "rotate") ? ctx.current.matrix : null;
    let band: Bounds | null = null;
    for (const unit of selectedUnits()) {
      const frame = unit.frame();
      if (frame === null) continue;
      let matrix = unit.matrix;
      if (delta !== null) {
        const moved = movedMatrix(unit, delta[0], delta[1]);
        if (moved !== null) matrix = compose(unit.parent, moved);
      } else if (shaping !== null) {
        matrix = compose(shaping, matrix);
      }
      // La barra della selezione sa dove sta la selezione, anche a metà
      // gesto.
      for (const corner of [frame.min, [frame.max[0], frame.min[1]], frame.max, [frame.min[0], frame.max[1]]] as const) {
        const [x, y] = apply(matrix, corner as Point);
        band = union(band, { min: [x, y], max: [x, y] });
      }
      // Il margine è lo stesso sullo schermo lungo i due assi, anche per un
      // oggetto scalato più in un verso che nell'altro.
      const sx = Math.hypot(matrix[0], matrix[1]) * ctx.camera.scale;
      const sy = Math.hypot(matrix[2], matrix[3]) * ctx.camera.scale;
      const padX = sx > 0 ? FRAME_PX / sx : 0;
      const padY = sy > 0 ? FRAME_PX / sy : 0;
      handles.push({
        kind: "box",
        x: frame.min[0] - padX,
        y: frame.min[1] - padY,
        width: frame.max[0] - frame.min[0] + 2 * padX,
        height: frame.max[1] - frame.min[1] + 2 * padY,
        matrix,
      });
    }
    handles.push(...frameHandles());
    handles.push(...ctx.nibHandles());
    handles.push(...ctx.rulerHandles());
    const lasso = ctx.current?.kind === "select" && ctx.current.mode === "marquee" ? ctx.current : null;
    if (lasso !== null && lasso.from !== null && lasso.end !== null) {
      const [x1, y1] = lasso.from;
      const [x2, y2] = lasso.end;
      const slanted = ctx.slantedMarquee(lasso.from, lasso.end);
      handles.push({ kind: "lasso", points: slanted === null ? [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] : [...slanted.corners] });
    }
    overlay.setHandles(handles);
    ctx.selectionBand = band;
    ctx.placeBar();
    showLinks(delta);
    const keys = ctx.selection.join("\n");
    if (keys !== ctx.noticed) {
      ctx.noticed = keys;
      ctx.followSelection();
      ctx.syncTree();
      ctx.syncProperties();
      options.onSelectionChange?.();
    }
    if (null !== ctx.noticedBoard) {
      ctx.noticedBoard = null;
      ctx.syncProperties();
    }
  };

  // --- I segni dei collegamenti ---------------------------------------------

  ctx.marks = null;

  const labelMarks = (): void => {
    for (const { target, element } of ctx.marks ?? []) {
      const text = t("draw.link.open", { note: linkName(target) });
      element.setAttribute("aria-label", text);
      element.title = text;
    }
  };
  relabels.push(labelMarks);

  /// I segni sullo schermo. Durante uno spostamento seguono gli oggetti
  /// scelti, di `delta` nella scena, e i collegamenti che contengono; durante
  /// un ridimensionamento o una rotazione, la loro trasformazione. Con la
  /// Selezione il segno di un oggetto scelto si scosta, per lasciare libera
  /// la maniglia della cornice sul suo angolo.
  function showLinks(delta: readonly [number, number] | null = null): void {
    if (options.links === undefined) return;
    if (ctx.marks === null) {
      const model = ctx.engine.model;
      const list: LinkMark[] = [];
      for (const unit of model === null ? [] : indexer.links(model)) {
        const target = linkTarget(nodeOf(model!, unit));
        if (target === null || unit.bounds === null) continue;
        const element = document.createElement("button");
        element.type = "button";
        element.className = "draw-link-mark";
        element.tabIndex = -1;
        element.dataset.mark = String(list.length);
        const svg = iconEl("draw-link");
        if (svg !== null) element.append(svg);
        list.push({ unit, target, element });
      }
      ctx.marks = list;
      linkLayer.replaceChildren(...list.map((mark) => mark.element));
      labelMarks();
    }
    const shaping = ctx.current?.kind === "select" && (ctx.current.mode === "resize" || ctx.current.mode === "rotate") ? ctx.current.matrix : null;
    // Anche mentre si sposta, quando la cornice non si vede: il segno non salta.
    const framed = ctx.tool === "select" && editable();
    const chosen = delta !== null || shaping !== null || framed ? selectedUnits().map((unit) => unit.path) : [];
    for (const { unit, element } of ctx.marks) {
      const inside = chosen.some((path) => path.every((at, i) => unit.path[i] === at));
      let bounds = unit.bounds!;
      if (inside && delta !== null) bounds = translated(bounds, delta[0], delta[1])!;
      else if (inside && shaping !== null) bounds = unit.boundsAfter(shaping) ?? bounds;
      const clear = framed && inside ? MARK_CLEAR_PX : 0;
      // In alto a destra dell'oggetto come si vede, anche sul foglio girato.
      const box = screenBox(ctx.camera, bounds);
      element.style.transform = `translate(${box.max[0] + clear}px, ${box.min[1] - clear}px)`;
    }
  }

  /// Apre la nota a cui porta `target`: il gesto in corso si annulla, e un
  /// testo che si scrive si chiude.
  const openLink = (target: string): void => {
    const links = options.links;
    if (links === undefined) return;
    ctx.cancelGesture();
    links.open(target);
  };
  ctx.openLink = openLink;

  life.listen(linkLayer, "click", (event) => {
    const element = event.target instanceof Element ? event.target.closest(".draw-link-mark") : null;
    const mark = element instanceof HTMLElement ? ctx.marks?.[Number(element.dataset.mark)] : undefined;
    if (mark !== undefined) openLink(mark.target);
  });

  /// Mostra `elem`, una forma che si sta disegnando, nella scena con
  /// `matrix`; `defs` sono le risorse che usa, come la punta di un
  /// connettore.
  const showShape = (elem: Elem | null, matrix: Matrix, defs: readonly Elem[] = []): void => {
    previewLayer.replaceChildren();
    if (elem === null) return;
    previewLayer.setAttribute("transform", matrixText(matrix));
    const build = (each: Elem): SVGElement => {
      const shape = document.createElementNS(SVG_NS, each.tag);
      // I nomi con un prefisso sono dati di FubDraw: non si disegnano.
      for (const [name, value] of Object.entries(each.attrs)) if (!name.includes(":")) shape.setAttribute(name, value);
      for (const child of each.children ?? []) shape.append(build(child));
      // Il testo di una riga, come in un `tspan`.
      if (each.text !== undefined && each.text !== null) shape.textContent = each.text;
      return shape;
    };
    if (defs.length > 0) {
      const holder = document.createElementNS(SVG_NS, "defs");
      for (const each of defs) holder.append(build(each));
      previewLayer.append(holder);
    }
    previewLayer.append(build(elem));
  };
  ctx.showShape = showShape;

  const clearPreviews = (): void => {
    clearInk();
    showShape(null, [1, 0, 0, 1, 0, 0]);
    painter.setDraft(null);
    showHandles();
    overlay.flush();
  };
  ctx.clearPreviews = clearPreviews;
}
