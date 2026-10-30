// L'editor del disegno: la Curvatura sui tracciati che ci sono già. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { showContextMenu, type MenuItem } from "../../../../ui/menu";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import { attachInkInput, type InkInputOptions, type InkInput } from "../../../../ink/dom/pointer-adapter";
import { isDefaultCurve, pressureCurve, type PenCurve } from "../../../../ink/input/pressure";
import { NO_STABILIZER } from "../../../../ink/input/stabilizer";
import { stabilizerOf } from "../grid";
import type { Point } from "../../scene/matrix";
import { plural, t } from "../../strings";
import { gesture as asGesture, removeOps } from "../edit";
import { gripAt } from "../frame";
import { GUIDE_HIT_PX, guideAt } from "../rulers";
import { toScene, toScreen } from "../../view";
import type { Unit } from "../hit";
import { preciseEraseOps, type StrokeCut } from "../erase-precise";
import { cornerCursor } from "../reshape";
import { HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import { toLocal } from "../../../../ink/geometry";
import { holdsPath } from "./helpers";
import type { EraseGesture } from "./types";

/// Quanto dopo il tasto laterale della penna lasciato arriva il menu
/// contestuale che il sistema gli manda dietro, in millisecondi.
const RADIAL_ECHO_MS = 500;

/// Dopo il menu aperto dalla tastiera, per tanti millisecondi il tasto del
/// menu non ne apre un altro.
const KEYED_MENU_MS = 1000;

/// Ciò che la Curvatura sui tracciati che ci sono già dà agli altri pezzi dell'editor.
export interface CurvatureToolContext {
  undoable: () => boolean;
  redoable: () => boolean;
  readModifiers: (event: PointerEvent) => void;
  radialHere: () => boolean;
  /// Il menu del clic destro e di Maiusc+F10 aperto in `at`: quello della
  /// selezione e, con gli strumenti che disegnano, il menu radiale in fondo.
  canvasMenu: (at: { readonly clientX: number; readonly clientY: number }) => MenuItem[];
  handlers: InkInputOptions;
  pen: InkInput;
}

/// Monta la Curvatura sui tracciati che ci sono già.
export function installCurvatureTool(ctx: EditorContext): void {
  const {
    life, has, history, surface, selectionButton, painter, overlay, clearInk, cursorMark, editable, currentIndex, newIds, announce, objects,
    showPage, rulersShown, guidesShown, rulerAt, showRulers, showGuideLines, localPoint, sceneAt, axisCursor, selectedUnits, frameNow, frameCursor, cornerAt, showGrip, showHandles, showShape, clearPreviews, commit, withLabels,
    select, cancelGesture, guidesFor, guided, snapNote, guideUpdate, guideEnd, begin, drawInk, setSymmetry, symmetryUpdate, symmetryEnd,
    hoverSymmetry, drawShape, selectStart, selectUpdate, selectEnd, boardStart, boardUpdate, boardEnd, hoverBoard, lassoAdd, lassoUpdate, lassoEnd,
    hoverDropper,
    dropperMove, takeAt, gradientStart, gradientUpdate, gradientEnd, hoverGradient, eraseAlong, showErased, finishInk, noteAt, watchStill, moveHeld, finishHeld, finishShape,
    hoverConnector, connectorStart, connectorUpdate, connectorEnd, options
  } = ctx;
  /// Annulla e Ripeti: i passi del disegno.
  const undoable = (): boolean => history.canUndo;
  ctx.undoable = undoable;
  const redoable = (): boolean => history.canRedo;
  ctx.redoable = redoable;

  const finishErase = (g: EraseGesture): void => {
    const units = g.sweep.marked();
    if (ctx.grid.eraser === "precise") {
      finishPrecise(g, units);
      return;
    }
    if (units.length === 0) {
      painter.setDraft(null);
      return;
    }
    if (commit("draw.action.erase", asGesture(removeOps(withLabels(units)))) !== null) {
      announce(`${plural(units.length, "draw.erased.one", "draw.erased.other")} ${objects()}`);
    }
  };

  /// La gomma precisa: i tratti tagliati restano a pezzi, gli oggetti che
  /// non sono tratti, e i tratti cancellati tutti, se ne vanno interi.
  const finishPrecise = (g: EraseGesture, units: readonly Unit[]): void => {
    const whole: Unit[] = [];
    const cuts: StrokeCut[] = [];
    for (const unit of units) {
      const cut = g.cuts.get(unit.key);
      if (cut === undefined) continue;
      if (cut === "whole") whole.push(unit);
      else cuts.push(cut);
    }
    const gone = whole.length + cuts.filter((cut) => cut.pieces.length === 0).length;
    if (whole.length === 0 && cuts.length === 0) {
      painter.setDraft(null);
      return;
    }
    const planned = preciseEraseOps(ctx.engine.model!, cuts, withLabels(whole), newIds());
    if (commit("draw.action.erase", asGesture(planned.ops)) === null) return;
    const said = [
      ...(planned.cut > 0 ? [plural(planned.cut, "draw.erased.part.one", "draw.erased.part.other")] : []),
      ...(gone > 0 || planned.cut === 0 ? [plural(gone, "draw.erased.one", "draw.erased.other")] : []),
    ];
    announce(`${said.join(" ")} ${objects()}`);
  };

  const toPoint = (sample: InkSample): Point => [sample.x, sample.y];

  // Maiusc, Ctrl o ⌘, e Alt si leggono dall'evento del puntatore prima della
  // pipeline, che ascolta in cattura sullo stesso elemento: registrato prima
  // di lei, questo ascolto la precede, e il gesto vede lo stato dell'evento
  // in corso.
  const readModifiers = (event: PointerEvent): void => {
    ctx.shift = event.shiftKey;
    ctx.free = event.ctrlKey || event.metaKey;
    ctx.alt = event.altKey;
  };
  ctx.readModifiers = readModifiers;
  // Il ritaglio finisce con i modificatori dell'evento che lo lascia: la
  // pipeline ascolta `pointerup` sul documento, in cattura, e questo ascolto
  // la precede.
  life.listen(
    surface.ownerDocument,
    "pointerup",
    (event) => {
      if (ctx.current?.kind === "crop") readModifiers(event);
    },
    { capture: true },
  );
  /// La maniglia sotto il puntatore che passa senza premere, nel cursore.
  const hoverGrip = (event: PointerEvent): void => {
    if (ctx.tool === "board") {
      hoverBoard(event);
      return;
    }
    // Mentre si ritaglia: un segno tira, l'immagine si sposta.
    if (ctx.cropping !== null) {
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      showGrip(event.buttons === 0 ? ctx.cropCursor(sceneAt(event.clientX, event.clientY), pointer) : null);
      return;
    }
    const view = event.buttons === 0 ? frameNow() : null;
    if (view === null) {
      showGrip(null);
      return;
    }
    const point = sceneAt(event.clientX, event.clientY);
    const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
    const grip = gripAt(view, point, ctx.camera.scale, pointer);
    const corner = cornerAt(point, pointer, view, grip);
    showGrip(corner !== null ? cornerCursor(corner.grip, corner.unit.matrix, ctx.camera.angle) : grip === null ? null : frameCursor(view.frame, grip));
  };
  /// La guida del documento sotto il puntatore che passa, con lo strumento
  /// Selezione: si accende, e il cursore dice dove si sposta. Sopra un
  /// righello il cursore è la freccia; una maniglia della cornice viene
  /// prima.
  const hoverGuide = (event: PointerEvent): void => {
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    const ruler = rulerAt(p);
    if (ruler === null) delete surface.dataset.ruler;
    else surface.dataset.ruler = ruler;
    const guides = ctx.scene.root.guides;
    let hot: number | null = null;
    if (ruler === null && event.buttons === 0 && ctx.tool === "select" && editable() && guidesShown() && guides !== null && surface.dataset.grip === undefined && ctx.cropping === null) {
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      hot = guideAt(guides, ctx.camera, p, GUIDE_HIT_PX[pointer], true);
    }
    if (hot !== null) surface.dataset.grip = axisCursor(guides![hot]!.axis);
    if (hot === ctx.hotGuide) return;
    ctx.hotGuide = hot;
    showGuideLines();
  };
  /// Il puntatore porta con sé il cursore del foglio, che si nasconde: la
  /// tastiera ripartirà da lì.
  const followPointer = (event: PointerEvent): void => {
    if (ctx.pressed !== null) return;
    ctx.cursor = sceneAt(event.clientX, event.clientY);
    cursorMark.hidden = true;
  };
  life.listen(
    surface,
    "pointerdown",
    (event) => {
      readModifiers(event);
      const local = localPoint(event.clientX, event.clientY);
      ctx.downAt = [local.x, local.y];
      // Il puntatore prende il posto della tastiera: il suo gesto finisce.
      ctx.cancelPress();
      followPointer(event);
      // Il puntatore sul foglio conclude il testo che si scrive.
      ctx.closedTyping = ctx.typing !== null;
      ctx.finishText();
      // Dopo un tratto le scorciatoie valgono: il fuoco va al foglio.
      if (document.activeElement !== surface) surface.focus({ preventScroll: true });
    },
    { capture: true },
  );
  life.listen(
    surface,
    "pointermove",
    (event) => {
      readModifiers(event);
      followPointer(event);
      const point = sceneAt(event.clientX, event.clientY);
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      ctx.pointerAt = { at: point, pointer };
      // Sopra una maniglia della cornice o una guida, il cursore dice che
      // cosa fa; col contagocce si vede che cosa prende, con lo strumento
      // Sfumatura che cosa sposta e col Connettore dove si aggancia.
      if (ctx.current === null && ctx.pressed === null) {
        hoverGrip(event);
        hoverGuide(event);
        hoverDropper(event.buttons === 0 ? point : null, pointer);
        ctx.hoverNib(event.buttons === 0 ? point : null, pointer);
        hoverGradient(event.buttons === 0 ? point : null, pointer);
        hoverConnector(event.buttons === 0 ? point : null, pointer);
        hoverSymmetry(event.buttons === 0 ? toScreen(ctx.camera, point) : null, pointer);
        ctx.hoverRuler(event.buttons === 0 ? point : null, pointer);
      }
      // Con Alt, le misure seguono il puntatore.
      if (ctx.current === null && ctx.pressed === null && (ctx.alt || ctx.measured)) showHandles();
      // I righelli segnano dov'è.
      else if (rulersShown()) showRulers();
    },
    { capture: true },
  );
  /// Il menu dei righelli o della guida in `p`, sulla superficie, se lì ce
  /// n'è uno.
  const menuItemsAt = (p: Point, touch: boolean): MenuItem[] | null => {
    if (rulerAt(p) !== null) return ctx.rulerItems();
    if (!guidesShown() || ctx.scene.root.guides === null) return null;
    const index = guideAt(ctx.scene.root.guides, ctx.camera, p, GUIDE_HIT_PX[touch ? "touch" : "mouse"], false);
    return index === null ? null : ctx.guideItems(index);
  };


  /// Vero se lo strumento di adesso ha il menu della selezione.
  const selectingTool = (): boolean => has("selection") && (ctx.tool === "select" || ctx.tool === "lasso");

  /// Vero se il clic destro apre il menu radiale: dal livello che lo offre,
  /// a chi può modificare, con gli strumenti che non hanno il menu della
  /// selezione.
  const radialHere = (): boolean => has("gestures") && editable() && !selectingTool();
  ctx.radialHere = radialHere;

  const canvasMenu = (at: { readonly clientX: number; readonly clientY: number }): MenuItem[] => {
    const items = ctx.selectionItems();
    if (radialHere()) items.push({ label: t("draw.radial"), separator: true, run: () => ctx.showRadial(at.clientX, at.clientY, null, true) });
    return items;
  };
  ctx.canvasMenu = canvasMenu;

  // Col tasto destro, o col tocco lungo, i righelli e le guide del
  // documento hanno il loro menu, con qualunque strumento e anche per una
  // guida bloccata, che solo da qui si sblocca col puntatore. Altrove il
  // menu della selezione o il menu radiale.
  life.listen(surface, "contextmenu", (event) => {
    // Il menu aperto dalla tastiera non si apre una seconda volta: l'evento
    // che il tasto manda dietro si consuma, uno solo.
    if (event.timeStamp - ctx.keyedMenu < KEYED_MENU_MS) {
      ctx.keyedMenu = -Infinity;
      event.preventDefault();
      return;
    }
    // Così quello che il sistema manda dietro al tasto laterale della penna,
    // che il menu radiale ha già visto.
    if (ctx.radial !== null || event.timeStamp - ctx.radialLift < RADIAL_ECHO_MS) {
      ctx.radialLift = -Infinity;
      event.preventDefault();
      return;
    }
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    const kind = "pointerType" in event ? (event as PointerEvent).pointerType : "mouse";
    const touch = kind === "touch";
    const items = menuItemsAt(p, touch);
    // Con gli strumenti che disegnano, la penna e il dito aprono il menu
    // radiale; il mouse il menu, che lo offre in fondo. Il tocco lungo che lo
    // apre non lascia un punto sul foglio.
    if (items === null && radialHere() && kind !== "mouse") {
      if (ctx.pressed !== null || (ctx.current !== null && !(touch && ctx.current.pointer === "touch"))) return;
      event.preventDefault();
      // Se il puntatore è ancora giù, il menu lo segue.
      const held = ctx.down !== null && (ctx.down.type === kind || (kind === "" && ctx.down.type === "mouse")) ? { pointerType: ctx.down.type, pointerId: ctx.down.id } : null;
      ctx.showRadial(event.clientX, event.clientY, held);
      return;
    }
    // Altrove, con gli strumenti che scelgono, il menu della selezione: sopra
    // un oggetto che non è scelto, prima lo sceglie. Un tocco lungo che non
    // ha ancora mosso niente lo apre anche lui.
    const still = ctx.current === null || (ctx.current.kind === "select" && ctx.current.mode === "pending") || (ctx.current.kind === "lasso" && !ctx.current.dragging);
    const picking = items === null && selectingTool() && ctx.pressed === null && still;
    // Con gli strumenti che disegnano il mouse apre lo stesso menu, sulla
    // selezione che c'è, senza scegliere ciò che sta sotto.
    const drawing = items === null && !picking && has("selection") && ctx.pressed === null && ctx.current === null;
    const selecting = picking || drawing;
    if (!selecting && (items === null || items.length === 0)) return;
    // Il tocco lungo che apre il menu non tira anche una guida.
    if (!selecting && ctx.current !== null && ctx.current.kind !== "guide") return;
    event.preventDefault();
    if (ctx.current !== null) cancelGesture();
    if (!selecting) {
      showContextMenu(event, items!);
      return;
    }
    const scenePoint = toScene(ctx.camera, p);
    const tolerance = HIT_PX[touch ? "touch" : "mouse"] / ctx.camera.scale;
    const hit = currentIndex().at(scenePoint, tolerance);
    if (picking && hit !== null && !selectedUnits().some((unit) => unit.key === hit.key || holdsPath(hit.path, unit.path))) select([hit.key]);
    showContextMenu(event, canvasMenu(event), { labelledBy: selectionButton.id });
  });
  // Il tasto laterale della penna apre il menu radiale dove la penna è, e la
  // penna lo guida finché il tasto è giù. Sui righelli, sulle guide e con
  // gli strumenti che scelgono resta al sistema, che ne fa un clic destro.
  life.listen(surface, "pointerdown", (event) => {
    // Il tratto del tasto laterale, se la pipeline l'ha già visto, è rifiutato
    // e il menu lo annulla.
    const busy = ctx.current !== null && ctx.current.kind !== "refused";
    if (event.pointerType !== "pen" || event.button !== 2 || ctx.radial !== null || busy || ctx.pressed !== null) return;
    // Chi ha dato al tasto laterale un altro lavoro lo trova nel tratto.
    if ((ctx.grid.barrel ?? "radial") !== "radial") return;
    const local = localPoint(event.clientX, event.clientY);
    if (menuItemsAt([local.x, local.y], false) !== null || !radialHere()) return;
    event.preventDefault();
    ctx.showRadial(event.clientX, event.clientY, { pointerType: "pen", pointerId: event.pointerId });
  });
  // L'angolo fra i righelli apre il loro menu: l'unità, le guide, e
  // nasconderli.
  life.listen(surface, "click", (event) => {
    const local = localPoint(event.clientX, event.clientY);
    if (rulerAt([local.x, local.y]) === "corner") showContextMenu(event, ctx.rulerItems());
  });
  life.listen(surface, "pointerleave", () => {
    if (ctx.current === null) showGrip(null);
    surface.removeAttribute("data-ruler");
    if (ctx.hotGuide !== null && ctx.current === null) {
      ctx.hotGuide = null;
      showGuideLines();
    }
    ctx.pointerAt = null;
    if (rulersShown()) showRulers();
    hoverDropper(null, "mouse");
    ctx.hoverNib(null, "mouse");
    hoverConnector(null, "mouse");
    if (ctx.measured) showHandles();
  });

  /// La curva della pressione di adesso, rifatta quando la si cambia.
  let penCurve: { readonly of: PenCurve; readonly apply: (pressure: number) => number } | null = null;
  /// La pressione della penna sulla curva di chi disegna, se il livello la
  /// offre: senza, la pressione com'è.
  const penPressure = (pressure: number): number => {
    if (isDefaultCurve(ctx.grid.pen) || !has("gestures")) return pressure;
    if (penCurve?.of !== ctx.grid.pen) penCurve = { of: ctx.grid.pen, apply: pressureCurve(ctx.grid.pen) };
    return penCurve.apply(pressure);
  };

  // I gestori della pipeline, che riceve anche il cursore del foglio.
  const handlers: InkInputOptions = {
    toScene: (clientX, clientY) => {
      const [x, y] = sceneAt(clientX, clientY);
      return { x, y };
    },
    turn: () => ctx.camera.angle,
    pressure: penPressure,
    // Lo stabilizzatore che chi disegna ha scelto in «Penna e dita», se il
    // livello offre quella finestra; la corda si misura in pixel dello schermo.
    stabilizer: () => (has("gestures") ? stabilizerOf(ctx.grid.steady) : NO_STABILIZER),
    scale: () => ctx.camera.scale,
    onStart(start) {
      // Un gesto lungo che la pipeline divide al limite dei campioni
      // continua nel tratto nuovo; il tratto a penna si scrive a pezzi,
      // tranne quello diventato forma, che è ormai un gesto solo.
      if (start.continued && ctx.current !== null && ctx.current.kind !== "refused" && (ctx.current.kind !== "ink" || ctx.current.held !== null)) {
        ctx.current.stroke = start.id;
        return;
      }
      ctx.current = begin(start);
    },
    onSamples(id, samples) {
      const g = ctx.current;
      if (g === null || g.stroke !== id || samples.length === 0) return;
      switch (g.kind) {
        case "ink":
          if (g.held !== null) {
            moveHeld(g, toPoint(samples[samples.length - 1]!));
            break;
          }
          // Il contorno si rifà in `onSettled`, una volta per evento.
          for (const each of samples) {
            const sample = ctx.ruled(each, g.ruler);
            g.scene.push(sample);
            g.local.push(toLocal(sample, g.to.inverse));
          }
          watchStill(g, samples);
          break;
        case "shape":
          // Il primo punto si aggancia subito, l'ultimo a ogni disegno:
          // Ctrl o ⌘ può cambiare a metà gesto.
          g.from ??= guided(toPoint(samples[0]!), () => guidesFor(g, []), g.pointer);
          g.end = toPoint(samples[samples.length - 1]!);
          drawShape(g);
          break;
        case "select":
          if (g.from === null) selectStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          selectUpdate(g);
          break;
        case "lasso":
          for (const sample of samples) lassoAdd(g, toPoint(sample));
          lassoUpdate(g);
          break;
        case "board":
          if (g.from === null) boardStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          boardUpdate(g);
          break;
        case "erase":
          for (const sample of samples) eraseAlong(g, toPoint(sample));
          showErased(g);
          break;
        case "text":
          g.from ??= toPoint(samples[0]!);
          break;
        case "guide":
          guideUpdate(g, toPoint(samples[samples.length - 1]!));
          break;
        case "symmetry":
          symmetryUpdate(g, toPoint(samples[samples.length - 1]!));
          break;
        case "ruler":
          ctx.rulerUpdate(g, toPoint(samples[samples.length - 1]!));
          break;
        case "note":
          g.at ??= toPoint(samples[0]!);
          break;
        case "dropper":
          dropperMove(g, toPoint(samples[samples.length - 1]!));
          break;
        case "gradient":
          if (g.from === null) gradientStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          gradientUpdate(g);
          break;
        case "crop":
          if (g.from === null) ctx.cropStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          ctx.cropUpdate(g);
          break;
        case "connector":
          if (g.from === null) connectorStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          connectorUpdate(g);
          break;
        case "refused":
          break;
      }
    },
    onPredicted(id, samples) {
      const g = ctx.current;
      if (g === null || g.stroke !== id || g.kind !== "ink" || g.held !== null) return;
      g.predicted = samples.map((sample) => toLocal(sample, g.to.inverse));
    },
    onSettled(id) {
      // Campioni e predizione dello stesso evento: il contorno e il foglio si
      // rifanno una volta sola.
      const g = ctx.current;
      if (g !== null && g.stroke === id && g.kind === "ink" && g.held === null) drawInk(g);
    },
    onEnd(stroke) {
      // Il sistema manda un clic destro dietro al tasto laterale: il menu
      // non si apre sopra il lazo o la gomma appena finiti.
      if (stroke.role === "barrel") ctx.radialLift = stroke.timeStamp + (stroke.samples[stroke.samples.length - 1]?.t ?? 0);
      const g = ctx.current;
      if (g === null || g.stroke !== stroke.id) return;
      if (stroke.split && (g.kind !== "ink" || g.held !== null)) return;
      switch (g.kind) {
        case "ink":
          ctx.current = null;
          clearTimeout(ctx.holdTimer);
          if (g.held !== null) {
            // La forma è già a schermo al posto del tratto: la scena la
            // disegna nello stesso gestore.
            finishHeld(g);
            showShape(null, g.to.matrix);
            return;
          }
          // Prima il tratto nella scena, poi via quello in corso: nello
          // stesso gestore, quindi a schermo non c'è un fotogramma senza
          // nessuno dei due.
          finishInk(g, stroke);
          clearInk();
          overlay.flush();
          return;
        case "shape": {
          const note = snapNote();
          ctx.current = null;
          finishShape(g, note);
          showShape(null, g.to.matrix);
          if (ctx.guiding) showHandles();
          return;
        }
        case "select":
          selectEnd(g, stroke.timeStamp);
          return;
        case "lasso":
          lassoEnd(g);
          return;
        case "board":
          boardEnd(g);
          return;
        case "erase":
          ctx.current = null;
          finishErase(g);
          return;
        case "text":
          ctx.current = null;
          if (g.from !== null) ctx.openText(g.from, g.pointer);
          return;
        case "guide":
          guideEnd(g, stroke.timeStamp);
          return;
        case "symmetry":
          symmetryEnd(g);
          return;
        case "ruler":
          ctx.rulerEnd(g);
          return;
        case "note":
          ctx.current = null;
          noteAt(g.at, g.pointer);
          return;
        case "dropper": {
          ctx.current = null;
          const at = g.at;
          // Il puntatore resta sopra il foglio: l'anteprima torna a seguirlo.
          if (at !== null && g.pointer !== "touch" && ctx.tool === "eyedropper") ctx.dropperHover = { index: currentIndex(), at, pointer: g.pointer, keyboard: g.stroke < 0, seen: g.seen };
          showHandles();
          // Maiusc conta quando si rilascia.
          if (at !== null) void takeAt(at, g.pointer, ctx.shift);
          return;
        }
        case "gradient":
          gradientEnd(g, stroke.timeStamp);
          return;
        case "crop":
          ctx.cropEnd(g, stroke.timeStamp);
          return;
        case "connector":
          connectorEnd(g);
          return;
        case "refused":
          ctx.current = null;
          return;
      }
    },
    onCancel(id) {
      const g = ctx.current;
      if (g === null || g.stroke !== id) return;
      ctx.current = null;
      if (g.kind === "ink") clearTimeout(ctx.holdTimer);
      if ((g.kind === "select" && g.mode === "marquee") || g.kind === "lasso") select(g.base);
      if (g.kind === "select" || g.kind === "guide" || g.kind === "board" || g.kind === "gradient" || g.kind === "connector" || g.kind === "symmetry") showGrip(null);
      // Il centro della simmetria torna dov'era.
      if (g.kind === "symmetry") setSymmetry({ ...ctx.symmetry, center: g.before });
      // E il righello.
      if (g.kind === "ruler") ctx.rulerCancel(g);
      clearPreviews();
      // Le tavole tornano come prima del gesto.
      if (g.kind === "board") showPage();
      // Il ritaglio torna com'era prima del gesto.
      if (g.kind === "crop") {
        if (ctx.cropping !== null && g.start !== null) ctx.cropping.crop = g.start;
        showGrip(null);
        ctx.showCropBar(true);
        ctx.showCrop();
      }
    },
    ...(options.touch === undefined ? {} : { touch: options.touch }),
  };
  ctx.handlers = handlers;
  const pen = attachInkInput(surface, handlers, life);
  ctx.pen = pen;
}
