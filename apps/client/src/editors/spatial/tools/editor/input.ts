// L'editor del disegno: la navigazione, il menu radiale e la tastiera. Un pezzo
// di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { BoundsBuilder, type Bounds } from "../../scene/geometry";
import { apply, compose, IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import { elementChildren, type DocumentModel, type ElementPart } from "../../scene/model";
import type { Op } from "../../scene/ops";
import { transform as parseTransform } from "../../scene/values";
import { t } from "../../strings";
import { boxMatrix, gesture as asGesture, mappedBounds, roundDelta, transformOps } from "../edit";
import { plainAttributes } from "../arrange";
import { holdsFilters, visibleBox } from "../effects";
import { MIN_SIZE } from "../frame";
import { lineBeyond } from "../grid";
import { toolCommand } from "./chrome/commands";
import { openRadial, type Radial, type RadialItem, type RadialPointer } from "../radial";
import { nextTurn, normalTurn, panned, turnBy, turnTo, zoomAt } from "../../view";
import type { Unit } from "../hit";
import { isLight, PALETTE, swatchOf } from "../palette";
import { toolKeyText, toolSpec, type ToolId } from "../registry";
import { DRAW_SCALE_LIMITS, ZOOM_SETTLE_MS } from "./constants";
import type { EditorContext } from "./context";
import { sign, union } from "./helpers";

/// Quanto girano due dita prima che il foglio giri con loro, in gradi: un
/// pizzico per lo zoom non gira il foglio per sbaglio.
const TWIST_START_DEG = 8;

/// Rilasciato a meno di tanti gradi da un angolo retto, il foglio girato
/// dalle dita ci si posa.
const TWIST_SNAP_DEG = 5;

/// Quanto della rotella, in pixel, vale un passo della rotazione con Ctrl o
/// ⌘ e Maiusc: uno scatto del mouse ne dà cento.
const TURN_WHEEL_PX = 50;

/// Quanto dura al più un tocco di più dita che annulla o ripete, in
/// millisecondi, dal primo dito giù all'ultimo su.
const TAP_MS = 300;

/// Quanto può scorrere un dito di un tocco, in pixel: oltre è un pizzico o
/// uno scorrimento.
const TAP_SLOP_PX = 12;

/// Gli strumenti che il menu radiale offre quando chi disegna ne ha usati
/// meno di tre: prima quelli che si alternano di più alla penna.
const FILL_TOOLS: readonly ToolId[] = [
  "pen", "eraser", "select", "highlighter", "rect", "ellipse", "line", "arrow",
];

/// Ciò che la navigazione, il menu radiale e la tastiera dà agli altri pezzi dell'editor.
export interface InputContext {
  /// Il menu radiale aperto, se c'è, e quando il puntatore che l'aveva
  /// aperto si è alzato.
  radial: Radial | null;
  radialLift: number;
  /// L'ultimo puntatore appoggiato sulla superficie, finché è giù: il menu
  /// radiale aperto dal suo clic destro lo segue.
  down: { readonly id: number; readonly type: string } | null;
  colorName: (code: string) => string;
  showRadial: (x: number, y: number, held: RadialPointer | null, keyboard?: boolean) => void;
  toolbarFocus: { readonly sync: (target: HTMLButtonElement | null) => void; readonly current: () => HTMLButtonElement | null; };
  /// Lo zoom con la rotella o il pizzico è in corso: la barra accanto alla
  /// selezione non si vede finché la vista non si ferma (B7).
  zooming: boolean;
  arrangeFocus: { readonly sync: (target: HTMLButtonElement | null) => void; readonly current: () => HTMLButtonElement | null; };
  boundsOf: (units: readonly Unit[]) => Bounds | null;
  geometryOf: (units: readonly Unit[]) => Bounds | null;
  visibleBoundsOf: (units: readonly Unit[]) => Bounds | null;
  effectsExtent: (model: DocumentModel) => Bounds | null;
  placeSelection: (units: readonly Unit[], from: Bounds, to: Bounds) => boolean;
  resizeSelection: (dw: number, dh: number) => void;
  moveOnGrid: (x: number, y: number, lines: number) => void;
  resizeOnGrid: (x: number, y: number, lines: number) => void;
}

/// Monta la navigazione, il menu radiale e la tastiera.
export function installInput(ctx: EditorContext): void {
  const {
    life, has, measureText, style, history, toolbar, surface, suggestions, titleInput, arrangeBar, editable, grownPage,
    newIds, announce, setCamera, stepNow, lengthSpoken, localPoint, viewCenter, announceTurn, selectedUnits, inOrder, showHandles, currentTitle,
    syncControls, commit, undo, redo, moveSelection, setColor, pickTool, cancelGesture, pen
  } = ctx;
  // --- Navigazione: tasto centrale, dita, rotella ------------------------------

  const navigating = new Map<number, { x: number; y: number }>();
  let pinch: { key: string; center: { x: number; y: number }; distance: number; angle: number | null } | null = null;
  /// Quanto hanno girato le dita da quando si sono appoggiate, e se il
  /// foglio gira con loro: comincia oltre [`TWIST_START_DEG`].
  let twist: { total: number; turning: boolean } | null = null;

  const measure = (): typeof pinch => {
    if (navigating.size === 0) return null;
    const points = [...navigating.values()];
    const center = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    const two = points.length >= 2;
    const distance = two ? Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) : 0;
    const angle = two && distance > 0 ? (Math.atan2(points[1]!.y - points[0]!.y, points[1]!.x - points[0]!.x) * 180) / Math.PI : null;
    return { key: [...navigating.keys()].sort((a, b) => a - b).join(","), center, distance, angle };
  };

  /// Le dita che si alzano posano il foglio girato su un angolo retto
  /// vicino, e dicono l'angolo.
  const endTwist = (): void => {
    const ended = twist;
    twist = null;
    if (ended === null || !ended.turning) return;
    const square = Math.round(ctx.camera.angle / 90) * 90;
    if (Math.abs(ctx.camera.angle - square) <= TWIST_SNAP_DEG) setCamera(turnTo(ctx.camera, square, viewCenter()));
    announceTurn();
  };

  const followPinch = (): void => {
    const next = measure();
    // Le dita appoggiate sul righello muovono lui, non il foglio (P13).
    if (ctx.rulerPinch(pinch, next)) {
      pinch = next;
      return;
    }
    if (next !== null && pinch !== null && next.key === pinch.key) {
      const at: Point = [pinch.center.x, pinch.center.y];
      let c = ctx.camera;
      if (next.distance > 0 && pinch.distance > 0) c = zoomAt(c, next.distance / pinch.distance, at, DRAW_SCALE_LIMITS);
      // Le dita girano il foglio come un quaderno sul tavolo, dal livello che
      // lo offre e se chi disegna non l'ha spento.
      if (next.angle !== null && pinch.angle !== null && has("gestures") && ctx.grid.twist) {
        const turned = normalTurn(next.angle - pinch.angle);
        twist ??= { total: 0, turning: false };
        twist.total += turned;
        if (twist.turning) c = turnBy(c, turned, at);
        else if (Math.abs(twist.total) >= TWIST_START_DEG) twist.turning = true;
      }
      setCamera(panned(c, next.center.x - pinch.center.x, next.center.y - pinch.center.y));
      suggestions.done("two-fingers");
    } else {
      endTwist();
    }
    pinch = next;
  };

  /// Le dita di un tocco: dove si sono appoggiate, quante al massimo, da
  /// quando, e se è ancora un tocco. Un dito che scorre, un tocco lungo, una
  /// penna vicina o un dito tolto dal sistema non lo sono più.
  let fingers: { readonly down: Map<number, Point>; most: number; readonly start: number; spoiled: boolean } | null = null;

  const followFingers = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    const at: Point = [event.clientX, event.clientY];
    if (event.type === "pointerdown") {
      fingers ??= { down: new Map(), most: 0, start: event.timeStamp, spoiled: false };
      fingers.down.set(event.pointerId, at);
      fingers.most = Math.max(fingers.most, fingers.down.size);
      if (pen.roleOf(event.pointerId) === "ignore") fingers.spoiled = true;
      return;
    }
    const from = fingers?.down.get(event.pointerId);
    if (fingers === null || from === undefined) return;
    if (event.type === "pointermove") {
      if (Math.hypot(at[0] - from[0], at[1] - from[1]) > TAP_SLOP_PX) fingers.spoiled = true;
      return;
    }
    if (event.type === "pointercancel") fingers.spoiled = true;
    fingers.down.delete(event.pointerId);
    if (fingers.down.size > 0) return;
    const ended = fingers;
    fingers = null;
    if (ended.spoiled || ended.most < 2 || ended.most > 3 || event.timeStamp - ended.start > TAP_MS) return;
    if (!ctx.grid.taps || !has("gestures") || !editable() || ctx.pressed !== null) return;
    tapped(ended.most === 2 ? "undo" : "redo");
  };

  /// Il tocco di due dita annulla, quello di tre ripete; se non c'è niente,
  /// lo dice, perché il dito non ha visto succedere niente.
  const tapped = (command: "undo" | "redo"): void => {
    const can = command === "undo" ? history.canUndo : history.canRedo;
    if (!can) {
      announce(t(command === "undo" ? "draw.undo.none" : "draw.redo.none"));
      return;
    }
    if (command === "undo") undo();
    else redo();
  };

  // --- Il menu radiale -------------------------------------------------------

  ctx.radial = null;
  ctx.radialLift = -Infinity;
  ctx.down = null;

  /// Le tre voci di una lista del menu radiale: le recenti che valgono, poi
  /// quelle di riserva, senza quella di adesso.
  const threeOf = <T,>(recent: readonly T[], fill: readonly T[], now: T, valid: (each: T) => boolean): (T | undefined)[] => {
    const out: T[] = [];
    for (const each of [...recent, ...fill]) {
      if (out.length === 3) break;
      if (each !== now && valid(each) && !out.includes(each)) out.push(each);
    }
    return [out[0], out[1], out[2]];
  };

  /// Il nome di un colore: quello del campione, o il codice.
  const colorName = (code: string): string => {
    const swatch = swatchOf(code);
    if (swatch !== null) return t(swatch.label);
    return t(isLight(code) ? "draw.color.custom.light" : "draw.color.custom", { code });
  };
  ctx.colorName = colorName;

  const { toolIcon } = ctx;

  /// Le otto voci, dall'alto in senso orario: in alto annulla e in basso
  /// ripete; a destra gli strumenti di prima, il più recente in orizzontale;
  /// a sinistra, allo stesso modo, i colori.
  const radialItems = (): (RadialItem | null)[] => {
    // Gli strumenti, Annulla e Ripeti vengono dal catalogo dei comandi.
    const fromCatalog = (id: string): RadialItem | null => {
      const command = ctx.command(id);
      if (command === null) return null;
      return { label: command.label, ...(command.icon === undefined ? {} : { icon: command.icon }), ...(command.hint === undefined ? {} : { hint: command.hint }), disabled: command.disabled, run: command.run };
    };
    const toolItem = (id: ToolId | undefined): RadialItem | null => {
      if (id === undefined) return null;
      const item = fromCatalog(toolCommand(id));
      // Dal radiale lo strumento si prende come dalla colonna, col suo tasto.
      return item === null ? null : { ...item, hint: toolKeyText(toolSpec(id).shortcut), run: () => pickTool(id) };
    };
    const colorItem = (code: string | undefined): RadialItem | null =>
      code === undefined
        ? null
        : {
            label: t("draw.radial.color", { color: colorName(code) }),
            swatch: { color: code },
            run: () => {
              setColor(code);
              announce(t("draw.announce.color", { color: colorName(code) }));
            },
          };
    const [tool1, tool2, tool3] = threeOf(ctx.recentTools, FILL_TOOLS, ctx.tool, (id) => ctx.tools.some((spec) => spec.id === id));
    const palette = PALETTE.map((swatch) => swatch.color);
    const [color1, color2, color3] = threeOf(ctx.recentColors, palette, style().color, (code) => swatchOf(code) !== null || has("colors"));
    return [
      fromCatalog("draw.undo"),
      toolItem(tool2),
      toolItem(tool1),
      toolItem(tool3),
      fromCatalog("draw.redo"),
      colorItem(color3),
      colorItem(color1),
      colorItem(color2),
    ];
  };

  /// Apre il menu radiale in `x`, `y` sullo schermo. Un gesto a metà del
  /// puntatore che lo apre si annulla.
  function showRadial(x: number, y: number, held: RadialPointer | null, keyboard = false): void {
    if (ctx.current !== null) cancelGesture();
    ctx.radial = openRadial(x, y, radialItems(), {
      label: t("draw.radial"),
      center: { icon: toolIcon(ctx.tool), color: style().color },
      held,
      keyboard,
      // Il clic destro che il sistema manda dietro al tasto della penna.
      onRelease: (at) => {
        if (held?.pointerType === "pen") ctx.radialLift = at;
      },
      onClose: () => {
        ctx.radial = null;
      },
    });
  }
  ctx.showRadial = showRadial;
  life.add(() => ctx.radial?.close());

  const onPointer = (event: PointerEvent): void => {
    if (event.type === "pointerdown") ctx.down = { id: event.pointerId, type: event.pointerType };
    followFingers(event);
    if (pen.roleOf(event.pointerId) === "navigate") {
      if (!navigating.has(event.pointerId)) {
        try {
          surface.setPointerCapture(event.pointerId);
        } catch {
          // Non catturabile: il gesto prosegue finché il puntatore resta sopra.
        }
      }
      navigating.set(event.pointerId, localPoint(event.clientX, event.clientY));
      // Il tasto centrale del mouse, senza questo, apre lo scorrimento automatico.
      if (event.type === "pointerdown") event.preventDefault();
    } else {
      navigating.delete(event.pointerId);
    }
    followPinch();
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (event.type !== "lostpointercapture") followFingers(event);
    if (event.type !== "lostpointercapture" && ctx.down?.id === event.pointerId) ctx.down = null;
    if (!navigating.delete(event.pointerId)) return;
    followPinch();
  };

  life.listen(surface, "pointerdown", onPointer);
  life.listen(surface, "pointermove", onPointer);
  // Dove sta il puntatore, per la banda di stato: un tocco non ha un posto
  // quando il dito se ne va.
  life.listen(surface, "pointermove", (event: PointerEvent) => {
    ctx.statusPointer = ctx.sceneAt(event.clientX, event.clientY);
    ctx.statusChanged();
  });
  life.listen(surface, "pointerleave", () => {
    ctx.statusPointer = null;
    ctx.statusChanged();
  });
  life.listen(surface, "pointerup", onPointerEnd);
  life.listen(surface, "pointercancel", onPointerEnd);
  life.listen(surface, "lostpointercapture", onPointerEnd);

  /// La rotella e il pizzico del trackpad, sul foglio e sul campo del testo.
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    // Sopra il righello la rotella lo gira (P13).
    if (!event.ctrlKey && !event.metaKey && ctx.rulerWheel(event.clientX, event.clientY, dy !== 0 ? dy : dx, event.shiftKey)) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && has("gestures")) {
      // Gira la vista a passi di 15°, attorno al puntatore. Con Maiusc alcuni
      // sistemi mandano la rotella come orizzontale.
      wheelTurn += dy !== 0 ? dy : dx;
      if (Math.abs(wheelTurn) < TURN_WHEEL_PX) return;
      const direction = wheelTurn > 0 ? 1 : -1;
      wheelTurn = 0;
      const local = localPoint(event.clientX, event.clientY);
      ctx.placed = true;
      setCamera(turnTo(ctx.camera, nextTurn(ctx.camera.angle, direction), [local.x, local.y]));
      announceTurn();
    } else if (event.ctrlKey || event.metaKey) {
      // Il pizzico del trackpad arriva così, a passi piccoli; la rotella del
      // mouse a passi da 100: il limite tiene lo scatto entro il 22%.
      const step = Math.max(-50, Math.min(50, dy));
      const local = localPoint(event.clientX, event.clientY);
      ctx.zooming = true;
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(settleZoom, ZOOM_SETTLE_MS);
      setCamera(zoomAt(ctx.camera, Math.exp(-step * 0.005), [local.x, local.y], DRAW_SCALE_LIMITS));
    } else if (event.shiftKey && dx === 0) {
      setCamera(panned(ctx.camera, -dy, 0));
    } else {
      setCamera(panned(ctx.camera, -dx, -dy));
    }
  };
  /// La rotella che gira la vista, raccolta finché non fa un passo.
  let wheelTurn = 0;
  /// Lo zoom finisce quando la rotella tace per `ZOOM_SETTLE_MS`: allora la
  /// barra della selezione torna, al suo posto nuovo.
  ctx.zooming = false;
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;
  const settleZoom = (): void => {
    ctx.zooming = false;
    ctx.placeBar();
  };
  life.add(() => clearTimeout(zoomTimer));
  life.listen(surface, "wheel", onWheel, { passive: false });

  // --- Tastiera --------------------------------------------------------------

  /// Una barra di pulsanti col roving tabindex: uno solo prende il Tab, le
  /// frecce, Inizio e Fine passano agli altri, e il puntatore non prende il
  /// fuoco, che resta al foglio con le scorciatoie. Dà la funzione che porta
  /// il Tab su `target`, o lo tiene dov'è se c'è ancora; e il pulsante che lo
  /// tiene.
  ///
  /// Un campo di numeri della barra (`.draw-arrange-input`) si raggiunge con
  /// le frecce dai pulsanti vicini e ha il suo Tab, ma non entra nel
  /// roving: dentro il campo le frecce, Inizio e Fine sono suoi, per il
  /// cursore, e ne esce Tab o Esc.
  const rove = (bar: HTMLElement): { readonly sync: (target: HTMLButtonElement | null) => void; readonly current: () => HTMLButtonElement | null } => {
    let current: HTMLButtonElement | null = null;
    const focusable = (): HTMLButtonElement[] =>
      [...bar.querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.disabled && !control.hidden && !control.hasAttribute("data-more") && control.closest("[hidden]") === null);
    /// I pulsanti e i campi di numeri che le frecce raggiungono.
    const reachable = (): HTMLElement[] =>
      [...bar.querySelectorAll<HTMLElement>("button, input.draw-arrange-input")].filter(
        (control) => !(control as HTMLButtonElement | HTMLInputElement).disabled && !control.hidden && !control.hasAttribute("data-more") && control.closest("[hidden]") === null,
      );
    const sync = (target: HTMLButtonElement | null): void => {
      const controls = focusable();
      const keep = target ?? current;
      current = keep !== null && controls.includes(keep) ? keep : controls[0] ?? null;
      for (const control of bar.querySelectorAll<HTMLButtonElement>("button")) control.tabIndex = control === current ? 0 : -1;
    };
    life.listen(bar, "keydown", (event) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      const controls = reachable();
      const at = controls.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (at + 1) % controls.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (at - 1 + controls.length) % controls.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = controls.length - 1;
      if (next === null) return;
      event.preventDefault();
      const target = controls[next]!;
      if (target instanceof HTMLButtonElement) sync(target);
      target.focus();
    });
    life.listen(bar, "focusin", (event) => {
      if (event.target instanceof HTMLButtonElement) sync(event.target);
    });
    life.listen(bar, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest("button")) event.preventDefault();
    });
    return { sync, current: () => current };
  };
  const toolbarFocus = rove(toolbar);
  ctx.toolbarFocus = toolbarFocus;
  const arrangeFocus = rove(arrangeBar);
  ctx.arrangeFocus = arrangeFocus;

  life.listen(titleInput, "change", () => {
    const value = titleInput.value.trim();
    if (value === currentTitle()) return;
    commit("draw.action.title", { op: "meta", title: value === "" ? null : value });
  });
  life.listen(titleInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      titleInput.blur();
      surface.focus({ preventScroll: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      titleInput.value = currentTitle();
      surface.focus({ preventScroll: true });
    }
  });
  life.listen(titleInput, "blur", () => {
    if (titleInput.value.trim() === currentTitle()) titleInput.value = currentTitle();
  });

  /// Il riquadro di `units` nella scena, contorno compreso.
  const boundsOf = (units: readonly Unit[]): Bounds | null => {
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, unit.bounds);
    return bounds;
  };
  ctx.boundsOf = boundsOf;

  /// Il riquadro della geometria di `units`, senza contorno: quello che la
  /// griglia aggancia. Un oggetto senza geometria conta col suo riquadro.
  const geometryOf = (units: readonly Unit[]): Bounds | null => {
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, unit.geometry ?? unit.bounds);
    return bounds;
  };
  ctx.geometryOf = geometryOf;

  /// Il riquadro del nodo `node`, con la matrice `matrix` che porta le sue
  /// coordinate nella scena, come lo disegnano i suoi effetti e quelli di ciò
  /// che contiene: le ombre e i bagliori escono dalla geometria. `null` se
  /// non ha filtri, non disegna niente o non si sa.
  const effectsBox = (model: DocumentModel, node: ElementPart, matrix: Matrix): Bounds | null => {
    if (!holdsFilters(node)) return null;
    const box = visibleBox(model, node, measureText);
    if (box === null) return null;
    const out = new BoundsBuilder();
    for (const corner of [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]] as const) out.include(apply(matrix, corner));
    return out.finish();
  };

  /// Il riquadro di `units` come si vede: quello di `boundsOf` e, dove gli
  /// effetti escono dalla geometria, quello degli effetti. Soltanto per
  /// l'esportazione e per la pagina: la selezione, la cornice e
  /// l'aggancio restano sulla geometria.
  const visibleBoundsOf = (units: readonly Unit[]): Bounds | null => {
    const model = ctx.engine.model;
    let bounds = boundsOf(units);
    if (model === null) return bounds;
    for (const unit of units) bounds = union(bounds, effectsBox(model, unit.node, unit.matrix));
    return bounds;
  };
  ctx.visibleBoundsOf = visibleBoundsOf;

  /// Il riquadro degli effetti di tutti gli oggetti di `model`, anche dei
  /// livelli bloccati o nascosti, come il riquadro del disegno di
  /// `SceneIndexer.extent`; `null` se nessuno ha effetti. Le matrici sono
  /// quelle della scena: il livello, poi l'oggetto.
  const effectsExtent = (model: DocumentModel): Bounds | null => {
    let extent: Bounds | null = null;
    const matrixOf = (node: ElementPart, outer: Matrix): Matrix => {
      const written = plainAttributes(node).get("transform");
      const own = written === undefined ? IDENTITY : parseTransform(written);
      return own === null || own === IDENTITY ? outer : compose(outer, own);
    };
    const visit = (node: ElementPart, outer: Matrix): void => {
      const role = node.details?.role;
      if (role === undefined || role === "paper" || role === "board" || role === "title" || role === "desc" || role === "defs" || role === "resource") return;
      if (role === "layer" && node.kind === "container") {
        const inner = matrixOf(node, outer);
        for (const child of elementChildren(node)) visit(child, inner);
        return;
      }
      extent = union(extent, effectsBox(model, node, matrixOf(node, outer)));
    };
    for (const child of elementChildren(model.root)) visit(child, IDENTITY);
    return extent;
  };
  ctx.effectsExtent = effectsExtent;

  /// Porta il riquadro `from` della selezione in `to`, e la tiene scelta: la
  /// pagina cresce se serve, come per ogni oggetto che ne esce.
  const placeSelection = (units: readonly Unit[], from: Bounds, to: Bounds): boolean =>
    // Il riquadro va da `from` a `to` scalando sugli assi: ogni oggetto, il
    // suo contorno compreso, finisce dentro `to`.
    transformSelection(units, boxMatrix(from, to), to);
  ctx.placeSelection = placeSelection;

  /// Applica `m`, una scala e una traslazione della scena, agli oggetti
  /// scelti, e li tiene scelti: la pagina cresce se `extent`, dove finiscono,
  /// ne esce.
  const transformSelection = (units: readonly Unit[], m: Matrix, extent: Bounds): boolean => {
    const moved = transformOps(units, m, newIds());
    const ops: Op[] = [...moved.ops];
    const page = grownPage(extent);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.resize", asGesture(ops)) === null) return false;
    ctx.selection = inOrder(moved.keys);
    syncControls();
    showHandles();
    return true;
  };

  /// Ctrl o ⌘ e le frecce: la selezione cresce o cala di (`dw`, `dh`),
  /// ferma nell'angolo in alto a sinistra. Un lato che misura zero, come
  /// quello di una linea dritta, resta zero.
  const resizeSelection = (dw: number, dh: number): void => {
    const units = selectedUnits();
    const from = boundsOf(units);
    if (from === null) return;
    const w = from.max[0] - from.min[0];
    const h = from.max[1] - from.min[1];
    const width = w > 0 ? Math.max(Math.min(w, MIN_SIZE), w + dw) : w;
    const height = h > 0 ? Math.max(Math.min(h, MIN_SIZE), h + dh) : h;
    if (width === w && height === h) return;
    const to: Bounds = { min: from.min, max: [from.min[0] + width, from.min[1] + height] };
    if (placeSelection(units, from, to)) announce(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }));
  };
  ctx.resizeSelection = resizeSelection;

  /// Con l'aggancio, le frecce portano l'angolo in alto a sinistra della
  /// geometria scelta alla riga `lines` righe più in là, sull'asse della
  /// freccia.
  const moveOnGrid = (x: number, y: number, lines: number): void => {
    const units = selectedUnits();
    const from = geometryOf(units);
    if (from === null) return;
    const [left, top] = from.min;
    const dx = x === 0 ? 0 : lineBeyond(left, stepNow(), sign(x), lines) - left;
    const dy = y === 0 ? 0 : lineBeyond(top, stepNow(), sign(y), lines) - top;
    moveSelection(units, roundDelta(dx), roundDelta(dy));
  };
  ctx.moveOnGrid = moveOnGrid;

  /// Con l'aggancio, Ctrl o ⌘ e le frecce portano il lato destro o quello in
  /// basso della geometria scelta alla riga `lines` righe più in là, fermo
  /// l'angolo in alto a sinistra. Il lato non passa la prima riga dopo
  /// quello opposto, e un lato che misura zero resta zero.
  const resizeOnGrid = (x: number, y: number, lines: number): void => {
    const units = selectedUnits();
    const from = geometryOf(units);
    const shown = boundsOf(units);
    if (from === null || shown === null) return;
    const edge = (min: number, max: number, direction: number): number =>
      direction === 0 || max <= min ? max : Math.max(lineBeyond(max, stepNow(), sign(direction), lines), lineBeyond(min, stepNow(), 1, 1));
    const right = edge(from.min[0], from.max[0], x);
    const bottom = edge(from.min[1], from.max[1], y);
    if (right === from.max[0] && bottom === from.max[1]) return;
    const m = boxMatrix(from, { min: from.min, max: [right, bottom] });
    const to = mappedBounds(shown, m);
    if (transformSelection(units, m, to)) {
      announce(t("draw.resized", { width: lengthSpoken(to.max[0] - to.min[0]), height: lengthSpoken(to.max[1] - to.min[1]) }));
    }
  };
  ctx.resizeOnGrid = resizeOnGrid;
}
