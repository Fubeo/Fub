// Il motore della lavagna: il Lazo e i tratti scelti. Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { anchorAt } from "./anchor";
import { erasableInk, type ErasableInk } from "./ink-erase";
import { type SelectionBarRestyle, type SelectionBarStrokes } from "./chrome/selection-bar";
import { Lasso, LASSO_MIN_STEP, extendLasso, lassoPath } from "./lasso";
import { dryStroke, foreignInkLayer, type InkLayerRef } from "./ink-record";
import { moveStrokesOp, restyleStrokesOp, sameLayer, type CanvasPatch } from "./operation";
import { type CanvasNode } from "./model";
import { type CanvasIntentOp } from "./wasm/core";
import { LASSO_FRAME_PAD } from "./engine-options";
import { StrokeDrag, LassoLayer, strokesByLayer, keysAfter } from "./engine-parts";
import { inkHolderText, cardMenuName } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const lassoMethods = {
  // --- il Lazo (T86) ------------------------------------------------------------

  /**
   * I tratti scelti col Lazo che ci sono ancora e si vedono, in coordinate
   * della lavagna; non quelli delle schede scelte, che vanno con loro.
   */
  _chosenStrokes(this: CanvasEngine): ErasableInk[] {
    if (this._strokeSelection.size === 0 || !this._doc || this._isSceneOversized()) return [];
    const cards = new Set(this._selection);
    return erasableInk(this._inkStateList(), this._pagesShown, this._aspectsShown, this._cellsShown)
      .filter((unit) => this._strokeSelection.has(unit.key) && (unit.node === null || !cards.has(unit.node)));
  },

  /** I tratti scelti come li mostra la barra della selezione: colore, spessore sullo schermo, sola lettura. */
  _strokesShown(this: CanvasEngine, units: readonly ErasableInk[]): SelectionBarStrokes | null {
    if (units.length === 0) return null;
    const zoom = this._camera.zoom;
    const colors = new Set(units.map((unit) => unit.stroke.color.toLowerCase()));
    // Lo spessore come si vede, al mezzo pixel: il passo del cursore.
    const widths = new Set(units.map((unit) => Math.round(unit.stroke.brush.size * unit.fit.s * zoom * 2) / 2));
    const [color] = colors;
    const [width] = widths;
    return {
      count: units.length,
      color: colors.size === 1 ? color! : null,
      width: widths.size === 1 ? width! : null,
      tool: units.every((unit) => unit.stroke.tool === "highlighter") ? "highlighter" : "pen",
      off: this._readOnly ? t("canvas.commands.why.read_only") : null,
    };
  },

  /** Lo strato del lazo, creato la prima volta e poi lo stesso, in cima allo stage. */
  _lassoLayerNow(this: CanvasEngine): LassoLayer {
    let layer = this._lassoLayer;
    if (!layer) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "canvas-lasso");
      svg.setAttribute("aria-hidden", "true");
      const chosen = document.createElementNS(ns, "g");
      chosen.setAttribute("class", "canvas-lasso-chosen");
      const frame = document.createElementNS(ns, "rect");
      frame.setAttribute("class", "canvas-lasso-frame");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("class", "canvas-lasso-path");
      svg.append(chosen, frame, path);
      layer = { svg, chosen, frame, path };
      this._lassoLayer = layer;
    }
    if (this._stage.lastElementChild !== layer.svg) this._stage.append(layer.svg);
    return layer;
  },

  /**
   * Disegna lo strato del lazo: il giro in corso, i tratti scelti col loro
   * contorno d'accento e la cornice tratteggiata attorno. Spostandosi, i
   * tratti portano il loro colore sopra gli originali attenuati. Senza giro
   * e senza tratti scelti lo strato esce dallo stage.
   */
  _paintLasso(this: CanvasEngine): void {
    if (this._destroyed) return;
    const lasso = this._lasso;
    const drag = this._strokeDrag;
    const units = drag ? drag.units : this._chosenStrokes();
    if (!lasso && units.length === 0) {
      this._lassoLayer?.svg.remove();
      return;
    }
    const layer = this._lassoLayerNow();
    layer.path.setAttribute("d", lasso ? lassoPath(lasso.points) : "");
    const moving = drag !== null && drag.moved;
    const paths = layer.chosen.children;
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const unit of units) {
      const dry = dryStroke(unit.stroke, this._inkPaths);
      if (!dry) continue;
      let path = paths[count] as SVGPathElement | undefined;
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        layer.chosen.append(path);
      }
      count += 1;
      path.setAttribute("d", dry.path);
      path.setAttribute("transform", `matrix(${unit.fit.s} 0 0 ${unit.fit.s} ${unit.fit.x} ${unit.fit.y})`);
      path.setAttribute("fill", moving ? dry.fill : "none");
      if (moving && dry.opacity !== undefined) path.setAttribute("fill-opacity", String(dry.opacity));
      else path.removeAttribute("fill-opacity");
      minX = Math.min(minX, unit.minX);
      minY = Math.min(minY, unit.minY);
      maxX = Math.max(maxX, unit.maxX);
      maxY = Math.max(maxY, unit.maxY);
    }
    while (paths.length > count) paths[paths.length - 1]!.remove();
    if (count > 0) {
      // Qualche pixel dello schermo attorno ai tratti, a ogni zoom.
      const pad = LASSO_FRAME_PAD / this._camera.zoom;
      layer.frame.setAttribute("x", String(minX - pad));
      layer.frame.setAttribute("y", String(minY - pad));
      layer.frame.setAttribute("width", String(maxX - minX + 2 * pad));
      layer.frame.setAttribute("height", String(maxY - minY + 2 * pad));
      layer.frame.removeAttribute("display");
    } else {
      layer.frame.setAttribute("display", "none");
    }
    this._shiftLasso(moving ? drag.dx : 0, moving ? drag.dy : 0);
  },

  /** Porta i tratti scelti e la loro cornice di `dx`, `dy`, senza ridisegnarli. */
  _shiftLasso(this: CanvasEngine, dx: number, dy: number): void {
    const layer = this._lassoLayer;
    if (!layer) return;
    const shift = dx === 0 && dy === 0 ? null : `translate(${dx} ${dy})`;
    for (const element of [layer.chosen, layer.frame]) {
      if (shift === null) element.removeAttribute("transform");
      else element.setAttribute("transform", shift);
    }
  },

  /** Comincia un giro del Lazo dal punto dell'appoggio; con Maiusc aggiungerà alla scelta. */
  _beginLasso(this: CanvasEngine, event: PointerEvent): void {
    this._lasso = {
      pointerId: event.pointerId,
      points: [this._screenToWorld(event.clientX, event.clientY)],
      additive: event.shiftKey,
      pressed: this._nodeAt(this._targetOf(event)),
    };
    this._viewport.setPointerCapture?.(event.pointerId);
    this._paintLasso();
  },

  /** Il giro cresce coi punti dell'evento che si allontanano dall'ultimo (un passo per pixel dello schermo). */
  _moveLasso(this: CanvasEngine, event: PointerEvent): void {
    const lasso = this._lasso;
    if (!lasso) return;
    const rect = this._viewport.getBoundingClientRect();
    const { x, y, zoom } = this._camera;
    const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    let grew = false;
    for (const one of coalesced.length > 0 ? coalesced : [event]) {
      const point = { x: (one.clientX - rect.left - x) / zoom, y: (one.clientY - rect.top - y) / zoom };
      if (extendLasso(lasso.points, point, LASSO_MIN_STEP / zoom)) grew = true;
    }
    if (grew) this._lassoLayer?.path.setAttribute("d", lassoPath(lasso.points));
  },

  /**
   * Il giro chiuso sceglie le schede tutte dentro e i tratti coi punti tutti
   * dentro (`lasso.ts`); i tratti delle schede scelte vanno con loro e non si
   * scelgono a parte. Con Maiusc si aggiunge alla scelta. Un giro senza area è
   * un clic: sceglie la scheda sotto, o toglie la scelta.
   */
  _endLasso(this: CanvasEngine): void {
    const lasso = this._lasso;
    this._lasso = null;
    const doc = this._doc;
    if (!lasso || !doc) {
      this._paintLasso();
      return;
    }
    const loop = new Lasso(lasso.points);
    if (!loop.closed) {
      if (lasso.pressed !== null) this._selectNode(lasso.pressed, lasso.additive);
      else if (!lasso.additive) this._clearSelection();
      this._paintLasso();
      return;
    }
    const cards = doc.nodes.filter((node) => loop.containsBox(node)).map((node) => node.id);
    const selection = lasso.additive ? [...this._selection, ...cards.filter((id) => !this._selection.includes(id))] : cards;
    const held = new Set(selection);
    const strokes: string[] = [];
    for (const unit of erasableInk(this._inkStateList(), this._pagesShown, this._aspectsShown, this._cellsShown)) {
      if (unit.node !== null && held.has(unit.node)) continue;
      // Un tratto di pagina (T19) o di cella (T38) il Lazo non lo prende: il
      // nucleo non sa dove la pagina o la cella sta nella scheda, e non lo
      // sposta né lo ridimensiona.
      if (unit.stroke.page !== null || unit.stroke.cell !== null) continue;
      // Il riquadro prima dei punti: i tratti lontani si lasciano subito.
      if (unit.maxX < loop.minX || unit.minX > loop.maxX || unit.maxY < loop.minY || unit.minY > loop.maxY) continue;
      if (loop.containsPoints(unit.points)) strokes.push(unit.key);
    }
    this._selection = selection;
    this._edgeSelection = [];
    this._strokeSelection = new Set(lasso.additive ? [...this._strokeSelection, ...strokes] : strokes);
    this._options.onSelectionChange();
    this._displaySelection();
  },

  /** L'appoggio cade dentro ciò che il Lazo ha scelto: la cornice dei tratti, o una scheda scelta. */
  _insideChosen(this: CanvasEngine, event: PointerEvent): boolean {
    const { x, y } = this._screenToWorld(event.clientX, event.clientY);
    for (const node of this._selectedNodes()) {
      if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) return true;
    }
    const units = this._chosenStrokes();
    if (units.length === 0) return false;
    const pad = LASSO_FRAME_PAD / this._camera.zoom;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const unit of units) {
      minX = Math.min(minX, unit.minX);
      minY = Math.min(minY, unit.minY);
      maxX = Math.max(maxX, unit.maxX);
      maxY = Math.max(maxY, unit.maxY);
    }
    return x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad;
  },

  /** Comincia a spostare le schede scelte (coi gruppi, ciò che contengono) e i tratti scelti. */
  _beginStrokeDrag(this: CanvasEngine, event: PointerEvent): void {
    const doc = this._doc;
    if (!doc) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of this._selection) {
      const node = doc.nodes.find((n) => n.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y });
    }
    for (const group of doc.nodes.filter((node) => origin.has(node.id) && node.type === "group")) {
      for (const child of doc.nodes) {
        if (child.id !== group.id && child.x >= group.x && child.y >= group.y
          && child.x + child.width <= group.x + group.width
          && child.y + child.height <= group.y + group.height) {
          origin.set(child.id, { x: child.x, y: child.y });
        }
      }
    }
    // I tratti delle schede che si spostano vanno con loro.
    const units = this._chosenStrokes().filter((unit) => unit.node === null || !origin.has(unit.node));
    this._strokeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      units,
      view: this._viewport.getBoundingClientRect(),
      moved: false,
      dx: 0,
      dy: 0,
      clientX: event.clientX,
      clientY: event.clientY,
      holder: undefined,
    };
    this._viewport.setPointerCapture?.(event.pointerId);
  },

  /**
   * Le schede e i tratti scelti seguono il puntatore, in unità intere della
   * lavagna. Sopra un'altra scheda i tratti la accendono come la penna
   * (T69): bordo tratteggiato ed etichetta; Alt li lascia liberi.
   */
  _moveStrokeDrag(this: CanvasEngine, event: PointerEvent): void {
    const drag = this._strokeDrag;
    const doc = this._doc;
    if (!drag || !doc) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) <= 3) return;
    const first = !drag.moved;
    drag.moved = true;
    const zoom = this._camera.zoom;
    drag.dx = Math.round((event.clientX - drag.startX) / zoom);
    drag.dy = Math.round((event.clientY - drag.startY) / zoom);
    if (drag.origin.size > 0) {
      const byId = new Map(doc.nodes.map((node) => [node.id, node] as const));
      for (const [id, start] of drag.origin) {
        const node = byId.get(id);
        if (!node) continue;
        node.x = start.x + drag.dx;
        node.y = start.y + drag.dy;
      }
      this._renderLive();
    }
    if (first) {
      this._fadeUnits(drag.units, true);
      this._syncSelectionBar();
      this._paintLasso();
    } else {
      this._shiftLasso(drag.dx, drag.dy);
    }
    if (event.altKey !== this._altHeld) this._altHeld = event.altKey;
    if (drag.units.length > 0) this._showStrokeHolder(drag);
  },

  /**
   * La scheda che prenderebbe i tratti spostati adesso: la regola della penna
   * (`anchorAt`) sul loro riquadro spostato, fra le schede che non si
   * spostano con loro e non hanno il livello d'un altro programma; con Alt,
   * nessuna.
   */
  _strokeHolder(this: CanvasEngine, drag: StrokeDrag): CanvasNode | null {
    const doc = this._doc;
    const layers = this._inkLayersNow();
    if (this._altHeld || !doc || !layers || drag.units.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const unit of drag.units) {
      minX = Math.min(minX, unit.minX);
      minY = Math.min(minY, unit.minY);
      maxX = Math.max(maxX, unit.maxX);
      maxY = Math.max(maxY, unit.maxY);
    }
    const bounds = { x: minX + drag.dx, y: minY + drag.dy, width: maxX - minX, height: maxY - minY };
    return anchorAt(doc.nodes, bounds, (node) => !drag.origin.has(node.id) && !foreignInkLayer(layers, { node: node.id }));
  },

  /** Mostra a chi andranno i tratti spostati: il bordo attorno alla scheda e l'etichetta accanto al puntatore. */
  _showStrokeHolder(this: CanvasEngine, drag: StrokeDrag): void {
    const holder = this._strokeHolder(drag);
    const marks = this._inkMarksNow();
    const id = holder?.id ?? null;
    if (id !== drag.holder || !marks.frames.isConnected) {
      drag.holder = id;
      this._placeInkFrame(marks.frames, holder);
      const text = inkHolderText(holder);
      if (marks.label.textContent !== text) marks.label.textContent = text;
      marks.label.toggleAttribute("data-free", holder === null);
    }
    marks.label.removeAttribute("data-idle");
    this._placeInkLabelAt(drag.view, drag.clientX, drag.clientY);
  },

  /** Via il bordo e l'etichetta dello spostamento. */
  _hideStrokeHolder(this: CanvasEngine): void {
    const marks = this._inkMarks;
    if (!marks || this._inkTarget) return;
    marks.frames.setAttribute("data-idle", "");
    marks.label.setAttribute("data-idle", "");
  },

  /** Il rilascio: il modello in mano torna quello del nucleo, poi lo spostamento va nel file. */
  _endStrokeDrag(this: CanvasEngine): void {
    const drag = this._strokeDrag;
    this._strokeDrag = null;
    if (!drag) return;
    this._hideStrokeHolder();
    this._fadeUnits(drag.units, false);
    if (!drag.moved) {
      this._paintLasso();
      return;
    }
    this._doc = this._coreModel() ?? this._doc;
    this._moveChosen([...drag.origin.keys()], drag.units, drag.dx, drag.dy, drag.holder ?? null);
  },

  /**
   * Sposta in un commit solo, un passo d'annulla, le schede `cards` e i
   * tratti `units` di `dx`, `dy`: le schede con `move`, i tratti con
   * `move_strokes` livello per livello. Se i tratti finiscono su un'altra
   * scheda (`holder`) passano a lei, e l'avviso lo dice con «Annulla» e
   * «Rendilo libero». Ciò che il nucleo rifiuta lo dice l'avviso, e la
   * lavagna resta com'era.
   */
  _moveChosen(this: CanvasEngine, cards: readonly string[], units: readonly ErasableInk[], dx: number, dy: number, holder: string | null): void {
    const to: InkLayerRef = holder === null ? "board" : { node: holder };
    const ops: CanvasIntentOp[] = [];
    if (cards.length > 0 && (dx !== 0 || dy !== 0)) ops.push({ op: "move", ids: [...cards], dx, dy });
    const groups = strokesByLayer(units);
    let passed = false;
    for (const { layer, ids } of groups) {
      const same = sameLayer(layer, to);
      if (same && dx === 0 && dy === 0) continue;
      if (!same) passed = true;
      ops.push(moveStrokesOp(layer, ids, dx, dy, to, this._layerAspect(layer)));
    }
    const patches = ops.length > 0 ? this._compileOps(ops) : null;
    if (!patches || patches.length === 0) {
      this._render();
      return;
    }
    if (!this._commitChosen(patches)) {
      this._render();
      return;
    }
    const node = holder === null ? null : this._doc?.nodes.find((one) => one.id === holder) ?? null;
    if (passed && node) {
      const ids = patches.flatMap((patch) => patch.kind === "ink" && !patch.before && patch.after && sameLayer(patch.layer, to) ? [patch.after.id] : []);
      const name = cardMenuName(node);
      this._showRemoval(name ? t("canvas.ink.moved_to", { name }) : t("canvas.ink.moved_card"), true, { layer: to, ids });
    }
    this._statusSettle();
  },

  /**
   * Il commit delle toppe compilate dal Lazo, un passo d'annulla; i tratti
   * scelti restano scelti dove sono andati. `false` se il nucleo l'ha
   * rifiutato (l'avviso dice perché).
   */
  _commitChosen(this: CanvasEngine, patches: readonly CanvasPatch[]): boolean {
    const inkOnly = patches.every((patch) => patch.kind === "ink");
    const chosen = keysAfter(this._strokeSelection, patches);
    const code = this._commitLocal(patches, "input", (step) => this._pushUndo(step, true), !inkOnly);
    if (code !== true) {
      // Una trappola la dice il nucleo che si riapre.
      if (code !== "trap") this._showNotice(t(code === "limit" ? "canvas.ink.full" : "canvas.ink.refused"));
      return false;
    }
    this._inkChain = null;
    this._strokeSelection = chosen;
    if (inkOnly) this._paintInk();
    else this._paintLasso();
    if (this._intakeError) this._showNotice("");
    return true;
  },

  /**
   * «Rendilo libero» dell'avviso: i tratti appena passati a una scheda
   * tornano liberi sulla lavagna, dove si vedono, in un passo d'annulla suo.
   * Vale finché lo spostamento è l'ultimo passo.
   */
  _freeMovedInk(this: CanvasEngine): void {
    const removal = this._removal;
    const free = removal?.free;
    if (!removal || !free || removal.step === undefined || this._undo[this._undo.length - 1] !== removal.step) {
      this._dropRemoval();
      return;
    }
    const patches = this._compileOps([moveStrokesOp(free.layer, free.ids, 0, 0, "board", this._layerAspect(free.layer))]);
    if (patches && patches.length > 0 && this._commitChosen(patches)) this._dropRemoval();
    this._statusSettle();
    this._viewport.focus({ preventScroll: true });
  },

  /**
   * Cambia colore o spessore dei tratti scelti dalla barra della selezione,
   * livello per livello in un commit solo: un annulla per gesto. Lo spessore
   * arriva in pixel dello schermo e va nel file in unità della lavagna.
   */
  _restyleChosen(this: CanvasEngine, change: SelectionBarRestyle): void {
    if (this._destroyed || this._readOnly || this._isSceneOversized()) return;
    const units = this._chosenStrokes();
    if (units.length === 0) return;
    let style: { readonly color?: string; readonly size?: number };
    if ("color" in change) style = { color: change.color };
    else {
      const size = Math.round((change.width / this._camera.zoom) * 1000) / 1000;
      if (!(size > 0)) return;
      style = { size };
    }
    const ops = strokesByLayer(units).map(({ layer, ids }) =>
      restyleStrokesOp(layer, ids, style, "size" in style ? this._layerAspect(layer) : null),
    );
    const patches = this._compileOps(ops);
    if (patches && patches.length > 0) this._commitChosen(patches);
    this._statusSettle();
  },
};
export type LassoMethods = typeof lassoMethods;
