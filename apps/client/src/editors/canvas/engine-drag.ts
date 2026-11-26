// Il motore della lavagna: la griglia e le guide, trascinare e ridimensionare.\n// Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { mediaKindOfId } from "../media/media-types";
import { type CanvasNode } from "./model";
import { GUIDE_SCREEN_PX, snapGuides, type GuideRect, type GuideResult, type GuideSegment } from "./guides";
import { type CanvasIntentOp } from "./wasm/core";
import {
  CANVAS_SNAP,
  CANVAS_GRID_DOT_STEPS,
  CANVAS_GRID_MIN_PX,
  CANVAS_MIN_SIZE,
  MOVE_CONTENTS_MAX,
} from "./engine-options";
import { CardDrag, CardEntry, PointerAt, INERTIA_WINDOW_MS } from "./engine-parts";
import {
  overlaps,
  snapTo,
  SETTLE_MS,
  MOVE_SIDES,
  ResizeCorner,
  RESIZE_CORNERS,
  RESIZE_FINGER_GRIP_PX,
  ResizeBox,
  resizeBox,
  boxAround,
  scaleInto,
  cornerOf,
  tinyOnScreen,
  resizeHandle,
  markHandles,
  measureText,
  naturalSize,
} from "./engine-geometry";
import type { CanvasEngine } from "./engine";

export const dragMethods = {
  // --- la griglia e le guide (T71) -------------------------------------------

  /**
   * I punti della griglia, ogni `CANVAS_GRID_DOT_STEPS` passi di `CANVAS_SNAP`
   * (32 unità della lavagna, su incroci dell'aggancio), nella vista
   * e sotto le schede. Il livello segue la camera con la sua posizione e il
   * suo passo, senza variabili CSS (lo stage ne ha già). Il punto sta al
   * centro della sua cella, così cade sulle intersezioni. Sotto
   * `CANVAS_GRID_MIN_PX` sullo schermo non si disegna.
   */
  _paintGrid(this: CanvasEngine): void {
    const grid = this._grid;
    if (!grid) return;
    const step = CANVAS_SNAP * CANVAS_GRID_DOT_STEPS * this._camera.zoom;
    grid.hidden = !(this._gridOverride ?? this._gridSetting) || step < CANVAS_GRID_MIN_PX;
    if (grid.hidden) return;
    grid.style.backgroundSize = `${step}px ${step}px`;
    grid.style.backgroundPosition = `${this._camera.x - step / 2}px ${this._camera.y - step / 2}px`;
  },

  /** Ctrl+' (T71): mostra o nasconde la griglia di questa lavagna, e la ricorda con la vista. */
  _toggleGrid(this: CanvasEngine): void {
    this._gridOverride = !(this._gridOverride ?? this._gridSetting);
    this._paintGrid();
    this._viewMemo?.changed();
  },

  /**
   * Le guide del gesto: un elemento solo sopra le schede, con un segno per
   * segmento, nelle coordinate dello schermo. Si svuota a ogni passo; `[]`
   * le toglie.
   */
  _showGuides(this: CanvasEngine, segments: readonly GuideSegment[]): void {
    if (segments.length === 0) {
      this._hideGuides();
      return;
    }
    let layer = this._guideLayer;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "canvas-guides";
      layer.setAttribute("aria-hidden", "true");
      this._viewport.insertBefore(layer, this._handleLayer);
      this._guideLayer = layer;
    }
    const { x, y, zoom } = this._camera;
    layer.replaceChildren(...segments.map((segment) => {
      const line = document.createElement("div");
      const vertical = segment.x1 === segment.x2;
      line.className = "canvas-guide";
      line.dataset.kind = segment.kind;
      line.dataset.axis = vertical ? "v" : "h";
      if (vertical) {
        line.style.left = `${segment.x1 * zoom + x}px`;
        line.style.top = `${Math.min(segment.y1, segment.y2) * zoom + y}px`;
        line.style.height = `${Math.abs(segment.y2 - segment.y1) * zoom}px`;
      } else {
        line.style.left = `${Math.min(segment.x1, segment.x2) * zoom + x}px`;
        line.style.top = `${segment.y1 * zoom + y}px`;
        line.style.width = `${Math.abs(segment.x2 - segment.x1) * zoom}px`;
      }
      return line;
    }));
  },

  _hideGuides(this: CanvasEngine): void {
    this._guideLayer?.remove();
    this._guideLayer = null;
  },

  /**
   * Le schede in vista che un gesto può agganciare: quelle che non si
   * muovono (`moving`) e che stanno nella vista, così con 2000 schede si
   * guarda solo quello che si vede.
   */
  _snapTargets(this: CanvasEngine, moving: ReadonlyMap<string, unknown>): GuideRect[] {
    const doc = this._doc;
    if (!doc) return [];
    const { view } = this._viewRect();
    const out: GuideRect[] = [];
    for (const node of doc.nodes) {
      if (!moving.has(node.id) && overlaps(node, view)) out.push(node);
    }
    return out;
  },

  // --- ridimensionare (T66) ---------------------------------------------------

  /**
   * Il mouse (o il dito, o la penna) giù su una maniglia: comincia il
   * ridimensionamento della sua scheda, o della scelta se è una maniglia
   * della cornice. `false` se sotto non c'è una maniglia che si possa tirare.
   */
  _resizeFromHandle(this: CanvasEngine, event: PointerEvent): boolean {
    if (this._readOnly || !this._doc) return false;
    const hit = this._targetOf(event);
    const target = hit instanceof Element ? hit : null;
    const handle = target?.closest<HTMLElement>("[data-resize], [data-resize-frame]");
    if (!handle) return false;
    const corner = cornerOf(handle.dataset.corner);
    const ids = handle.dataset.resize !== undefined ? [handle.dataset.resize] : this._resizableSelection();
    if (!this._beginResize(event, corner, ids)) return false;
    event.preventDefault();
    return true;
  },

  /**
   * Il dito giù vicino a un angolo della scheda scelta, o della cornice della
   * scelta: la presa è di 44 px sullo schermo a ogni zoom, più larga di
   * quella del mouse. Lo spazio Semplice (T65) non c'è ancora: decide il
   * tipo di puntatore.
   */
  _resizeFromFinger(this: CanvasEngine, event: PointerEvent): boolean {
    if (this._readOnly || !this._doc || this._isSceneOversized()) return false;
    const ids = this._resizableSelection();
    const box = this._boxOf(ids);
    if (!box) return false;
    const rect = this._viewport.getBoundingClientRect();
    const { x: camX, y: camY, zoom } = this._camera;
    let best: { corner: ResizeCorner; distance: number } | null = null;
    for (const corner of this._cornersOf(box)) {
      const east = corner === "ne" || corner === "se";
      const south = corner === "sw" || corner === "se";
      const x = rect.left + camX + (box.x + (east ? box.width : 0)) * zoom;
      const y = rect.top + camY + (box.y + (south ? box.height : 0)) * zoom;
      const distance = Math.max(Math.abs(event.clientX - x), Math.abs(event.clientY - y));
      if (distance <= RESIZE_FINGER_GRIP_PX && (!best || distance < best.distance)) best = { corner, distance };
    }
    if (!best || !this._beginResize(event, best.corner, ids)) return false;
    event.preventDefault();
    return true;
  },

  /**
   * Le schede che un doppio clic su una maniglia adatta: quelle dell'ultima
   * maniglia presa senza muoversi, o quelle della maniglia sotto `target`;
   * `null` se il doppio clic non è su una maniglia. Si usa una volta.
   */
  _takeHandleTap(this: CanvasEngine, target: EventTarget | null): readonly string[] | null {
    const tap = this._handleTap;
    this._handleTap = null;
    if (tap) return tap;
    const handle = target instanceof Element ? target.closest<HTMLElement>("[data-resize], [data-resize-frame]") : null;
    if (!handle) return null;
    return handle.dataset.resize !== undefined ? [handle.dataset.resize] : this._resizableSelection();
  },

  /** Le schede scelte che il documento ha. */
  _resizableSelection(this: CanvasEngine): string[] {
    const doc = this._doc;
    if (!doc) return [];
    // Un insieme, non una ricerca per ogni scelta: il rettangolo (N6 T20b) lo rifà a ogni fotogramma.
    const present = new Set(doc.nodes.map((node) => node.id));
    return this._selection.filter((id) => present.has(id));
  },

  /** Il rettangolo attorno alle schede `ids` del documento di adesso. */
  _boxOf(this: CanvasEngine, ids: readonly string[]): ResizeBox | null {
    const doc = this._doc;
    if (!doc) return null;
    const wanted = new Set(ids);
    return boxAround(doc.nodes.filter((node) => wanted.has(node.id)));
  },

  /** Le maniglie che una cornice mostra a questo zoom: troppo piccola, solo quella in basso a destra. */
  _cornersOf(this: CanvasEngine, box: ResizeBox): readonly ResizeCorner[] {
    return tinyOnScreen(box, this._camera.zoom) ? ["se"] : RESIZE_CORNERS;
  },

  _beginResize(this: CanvasEngine, event: PointerEvent, corner: ResizeCorner, ids: readonly string[]): boolean {
    const doc = this._doc;
    if (!doc) return false;
    const origin = new Map<string, ResizeBox>();
    for (const id of ids) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y, width: node.width, height: node.height });
    }
    const box = boxAround([...origin.values()]);
    if (!box) return false;
    this._resize = { pointerId: event.pointerId, corner, startX: event.clientX, startY: event.clientY, box, origin, moved: false };
    this._viewport.setPointerCapture?.(event.pointerId);
    return true;
  },

  /**
   * Il puntatore che tira una maniglia: Maiusc tiene le proporzioni, Alt
   * tiene fermo il centro, tutti e due insieme. Una scheda sola ha
   * l'aggancio di 8 px (A-23); la scelta scala tutto, posizioni comprese,
   * senza che una scheda scenda sotto il minimo. L'inchiostro attaccato sta
   * nella scheda e la segue nella resa (N4).
   */
  _moveResize(this: CanvasEngine, event: PointerAt): void {
    const resize = this._resize;
    const doc = this._doc;
    if (!resize || !doc) return;
    // Un clic sulla maniglia (o il primo dei due del doppio clic) non cambia
    // la scheda: senza questo l'aggancio la porterebbe subito sulla griglia.
    if (Math.abs(event.clientX - resize.startX) + Math.abs(event.clientY - resize.startY) > 3) resize.moved = true;
    if (!resize.moved) return;
    const dx = (event.clientX - resize.startX) / this._camera.zoom;
    const dy = (event.clientY - resize.startY) / this._camera.zoom;
    const single = resize.origin.size === 1;
    const starts = [...resize.origin.values()];
    const narrowest = Math.max(1, Math.min(...starts.map((start) => start.width)));
    const shortest = Math.max(1, Math.min(...starts.map((start) => start.height)));
    const minWidth = single ? CANVAS_MIN_SIZE : resize.box.width * Math.min(1, CANVAS_MIN_SIZE / narrowest);
    const minHeight = single ? CANVAS_MIN_SIZE : resize.box.height * Math.min(1, CANVAS_MIN_SIZE / shortest);
    // Le guide (T71) portano il lato che tira sulle schede vicine. Solo per una
    // scheda sola, senza Alt (che spegne l'aggancio per il gesto), senza Maiusc
    // (le proporzioni) e con `canvas.snap` acceso.
    const aligning = single && this._snapSetting && !event.altKey && !event.shiftKey;
    let guided = { x: false, y: false };
    let ddx = dx;
    let ddy = dy;
    if (aligning) {
      const east = resize.corner === "ne" || resize.corner === "se";
      const south = resize.corner === "se" || resize.corner === "sw";
      const free = resizeBox(resize.box, resize.corner, dx, dy, { keepRatio: false, fromCenter: false, snap: false, minWidth, minHeight });
      const guide = snapGuides({
        moving: free,
        others: this._snapTargets(resize.origin),
        threshold: GUIDE_SCREEN_PX / this._camera.zoom,
        sides: { x: [east ? "end" : "start"], y: [south ? "end" : "start"] },
      });
      this._showGuides(guide.segments);
      ddx = dx + guide.dx;
      ddy = dy + guide.dy;
      guided = { x: guide.guidedX, y: guide.guidedY };
    } else {
      this._hideGuides();
    }
    const box = resizeBox(resize.box, resize.corner, ddx, ddy, {
      keepRatio: event.shiftKey,
      fromCenter: event.altKey,
      snap: single && this._snapSetting && !event.altKey,
      step: this._snapStep,
      guided,
      minWidth,
      minHeight,
    });
    for (const [id, start] of resize.origin) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (!node) continue;
      const next = single ? box : scaleInto(start, resize.box, box, CANVAS_MIN_SIZE);
      node.x = next.x;
      node.y = next.y;
      node.width = next.width;
      node.height = next.height;
    }
    this._renderLive();
  },

  /**
   * La cornice della scelta: con due schede scelte o più, attorno a tutte,
   * con le sue quattro maniglie che scalano tutto; le maniglie delle schede
   * allora si nascondono (`data-selection="many"`). In sola lettura niente.
   */
  _syncSelectionFrame(this: CanvasEngine): void {
    const ids = !this._readOnly && !this._isSceneOversized() ? this._resizableSelection() : [];
    const box = ids.length >= 2 ? this._boxOf(ids) : null;
    // Scrivere lo stesso valore non deve rifare lo stile delle maniglie di ogni
    // scheda: la regola `[data-selection="many"] > .canvas-node` le legge tutte (N6 T20b).
    if (box) {
      if (this._stage.dataset.selection !== "many") this._stage.dataset.selection = "many";
    } else if (this._stage.dataset.selection !== undefined) {
      delete this._stage.dataset.selection;
    }
    if (!box) {
      this._selectionFrame?.remove();
      return;
    }
    let frame = this._selectionFrame;
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "canvas-selection-frame";
      frame.setAttribute("aria-hidden", "true");
      for (const corner of RESIZE_CORNERS) frame.append(resizeHandle(corner, null));
      this._selectionFrame = frame;
    }
    frame.style.transform = `translate(${box.x}px, ${box.y}px)`;
    frame.style.width = `${box.width}px`;
    frame.style.height = `${box.height}px`;
    markHandles(frame, box, this._camera.zoom);
    // Sopra le schede e l'inchiostro libero: le sue maniglie si prendono.
    if (frame.parentElement !== this._stage || frame.nextSibling) this._stage.append(frame);
  },

  /** Lo zoom è cambiato: le schede (e la cornice) troppo piccole tengono solo una maniglia. */
  _markAllHandles(this: CanvasEngine): void {
    const zoom = this._camera.zoom;
    if (zoom === this._handlesZoom) return;
    this._handlesZoom = zoom;
    for (const entry of this._cards.values()) markHandles(entry.article, entry.node, zoom);
    const frame = this._selectionFrame;
    const box = frame?.isConnected ? this._boxOf(this._resizableSelection()) : null;
    if (frame && box) markHandles(frame, box, zoom);
  },

  /**
   * Il doppio clic su una maniglia: ogni scheda `ids` prende la misura del
   * suo contenuto, in un commit e un annulla. Una scheda di testo la misura
   * del suo testo, fino a `CANVAS_TEXT_FIT_MAX_WIDTH` di larghezza;
   * un'immagine o un PDF le proporzioni del contenuto alla larghezza di
   * adesso; le altre non cambiano. L'angolo in alto a sinistra resta.
   */
  _fitToContent(this: CanvasEngine, ids: readonly string[]): void {
    const doc = this._doc;
    if (!doc || this._readOnly || this._isSceneOversized()) return;
    const ops: CanvasIntentOp[] = [];
    for (const id of ids) {
      const node = doc.nodes.find((entry) => entry.id === id);
      const entry = this._cards.get(id);
      if (!node || !entry) continue;
      const size = this._contentSize(entry, node);
      // La misura del contenuto è di nuovo quella che la scheda prende da sé (T44).
      if (size) this._sizedByHand.delete(id);
      if (!size || (size.width === node.width && size.height === node.height)) continue;
      // La misura la prende la tela dal DOM (il testo come si vede, il corpo
      // senza testata): il nucleo la scrive con `resize` (T24).
      ops.push({ op: "resize", id, width: Math.round(size.width), height: Math.round(size.height) });
    }
    this._writeOps(ops);
  },

  /** La misura del contenuto della scheda `node`; `null` se non c'è o non si sa. */
  _contentSize(this: CanvasEngine, entry: CardEntry, node: CanvasNode): { width: number; height: number } | null {
    if (node.type === "text") {
      // Col campo aperto il testo è nel campo, che non ha una misura sua.
      if (this._editor?.id === node.id) return null;
      const measured = measureText(entry.article, entry.body);
      return measured && { width: Math.max(CANVAS_MIN_SIZE, measured.width), height: Math.max(CANVAS_MIN_SIZE, measured.height) };
    }
    if (node.type !== "file" || typeof node.file !== "string") return null;
    const media = mediaKindOfId(node.file);
    if (media !== "image" && media !== "pdf") return null;
    const natural = naturalSize(entry.body);
    if (!natural) return null;
    // Il riquadro del contenuto: il corpo senza il suo margine interno; il
    // resto della scheda (la testata) resta com'è. Senza misure (prima della
    // prima impaginazione) il contenuto è tutta la scheda.
    const style = getComputedStyle(entry.body);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const innerWidth = entry.body.clientWidth - padX;
    const innerHeight = entry.body.clientHeight - padY;
    const known = innerWidth > 0 && innerHeight > 0;
    const width = known ? innerWidth : node.width;
    const rest = known ? node.height - innerHeight : 0;
    return { width: node.width, height: Math.max(CANVAS_MIN_SIZE, Math.round(rest + width * natural.height / natural.width)) };
  },

  _pointerMove(this: CanvasEngine, event: PointerEvent): void {
    if (event.pointerType === "touch" && this._touchMove(event)) return;
    if (this._lasso && event.pointerId === this._lasso.pointerId) {
      this._moveLasso(event);
      return;
    }
    if (this._marquee && event.pointerId === this._marquee.pointerId) {
      this._moveMarquee(event);
      return;
    }
    if (this._strokeDrag && event.pointerId === this._strokeDrag.pointerId) {
      this._moveStrokeDrag(event);
      return;
    }
    if (this._connect && event.pointerId === this._connect.pointerId) {
      this._moveConnect(event.clientX, event.clientY);
      // Vicino al bordo la vista scorre da sola (T53).
      if (this._connect.moved) this._trackEdge(event);
      return;
    }
    if (!this._pan && !this._resize && !this._drag && event.pointerType === "mouse") {
      // Sotto il velo della croce (T20d) il mouse scrive: nessun filo si
      // scurisce, e nessuna ricerca a ogni movimento del tratto.
      if (event.target === this._penVeil) this._setEdgeHover(null);
      else this._hoverEdge(event.clientX, event.clientY, event.target);
    }
    if (this._pan && event.pointerId === this._pan.pointerId) {
      this._camera.x = this._pan.camX + (event.clientX - this._pan.startX);
      this._camera.y = this._pan.camY + (event.clientY - this._pan.startY);
      // La scia del dito, per l'inerzia del rilascio (T53).
      if (event.pointerType === "touch") {
        const trail = this._pan.trail ??= [];
        trail.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
        while (trail.length > 1 && event.timeStamp - trail[0]!.t > INERTIA_WINDOW_MS) trail.shift();
      }
      this._applyCamera();
      return;
    }
    if (this._resize && event.pointerId === this._resize.pointerId && this._doc) {
      this._moveResize(event);
      if (this._resize.moved) this._trackEdge(event);
      return;
    }
    if (this._drag && event.pointerId === this._drag.pointerId && this._doc) {
      this._moveDrag(event);
      if (this._drag.moved) this._trackEdge(event);
    }
  },

  /** Le schede che si trascinano seguono il puntatore `at`. */
  _moveDrag(this: CanvasEngine, at: PointerAt): void {
    const drag = this._drag;
    const doc = this._doc;
    if (!drag || !doc) return;
    const dx = (at.clientX - drag.startX) / this._camera.zoom;
    const dy = (at.clientY - drag.startY) / this._camera.zoom;
    if (!drag.moved && Math.abs(at.clientX - drag.startX) + Math.abs(at.clientY - drag.startY) > 3) {
      drag.moved = true;
      // Lo spostamento prende il puntatore adesso: così non lo perde se esce dalla vista.
      this._viewport.setPointerCapture?.(drag.pointerId);
    }
    const byId = new Map(doc.nodes.map((node) => [node.id, node] as const));
    // Le schede seguono il puntatore 1:1, in unità intere (#411 C-05): niente
    // salti sotto la mano. L'aggancio è la mira, che vale al rilascio
    // (`_settleDrag`): le guide (T71), che si vedono già, vincono sulla
    // griglia di `canvas.snap_step`, su ogni asse. Alt tenuto, o `canvas.snap`
    // spento: la mira è dove sta la scheda. Lo spostamento è uno per tutte
    // (una `move`, T24): la griglia aggancia l'angolo in alto a sinistra del
    // loro riquadro, come le guide, e le schede tengono le loro distanze.
    const free = at.altKey || !this._snapSetting;
    const guide = drag.moved && !free ? this._dragGuide(drag.origin, byId, dx, dy) : null;
    if (guide === null) this._hideGuides();
    let left = Infinity;
    let top = Infinity;
    for (const origin of drag.origin.values()) {
      left = Math.min(left, origin.x);
      top = Math.min(top, origin.y);
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    const step = this._snapStep;
    const along = (start: number, delta: number, guided: boolean, pull: number): number =>
      free || (!guided && step === null) ? Math.round(delta)
        : guided ? Math.round(delta + pull) : snapTo(start + delta, step!) - start;
    drag.dx = Math.round(dx);
    drag.dy = Math.round(dy);
    drag.aimDx = along(left, dx, guide?.guidedX ?? false, guide?.dx ?? 0);
    drag.aimDy = along(top, dy, guide?.guidedY ?? false, guide?.dy ?? 0);
    for (const [id, origin] of drag.origin) {
      const node = byId.get(id);
      if (!node) continue;
      node.x = origin.x + drag.dx;
      node.y = origin.y + drag.dy;
    }
    this._renderLive();
  },

  /**
   * Il rilascio di uno spostamento agganciato (#411 C-05): le schede vanno
   * dalla posizione sotto il puntatore a quella della mira, scivolando in
   * `SETTLE_MS` (col movimento ridotto subito). Lo stato e i fili sono subito
   * quelli finali: la scivolata è solo dell'aspetto della scheda.
   */
  _settleDrag(this: CanvasEngine, drag: CardDrag): void {
    const fromDx = drag.dx;
    const fromDy = drag.dy;
    if (drag.aimDx === fromDx && drag.aimDy === fromDy) return;
    drag.dx = drag.aimDx;
    drag.dy = drag.aimDy;
    const byId = new Map((this._doc?.nodes ?? []).map((node) => [node.id, node] as const));
    for (const [id, origin] of drag.origin) {
      const node = byId.get(id);
      if (!node) continue;
      node.x = origin.x + drag.dx;
      node.y = origin.y + drag.dy;
    }
    this._renderLive();
    if (this._reducedMotion) return;
    for (const [id, origin] of drag.origin) {
      const article = this._cards.get(id)?.article;
      if (typeof article?.animate !== "function") continue;
      article.animate(
        [
          { transform: `translate(${origin.x + fromDx}px, ${origin.y + fromDy}px)` },
          { transform: `translate(${origin.x + drag.dx}px, ${origin.y + drag.dy}px)` },
        ],
        { duration: SETTLE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
  },

  /**
   * Le guide di uno spostamento: il riquadro delle schede trascinate nella
   * posizione libera, con le schede in vista che restano. Mostra i segmenti
   * che vincono e dà lo spostamento; `null` se non c'è nulla da portare.
   */
  _dragGuide(
    this: CanvasEngine,
    origin: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
    byId: ReadonlyMap<string, CanvasNode>,
    dx: number,
    dy: number,
  ): GuideResult | null {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const [id, start] of origin) {
      const node = byId.get(id);
      if (!node) continue;
      left = Math.min(left, start.x + dx);
      top = Math.min(top, start.y + dy);
      right = Math.max(right, start.x + dx + node.width);
      bottom = Math.max(bottom, start.y + dy + node.height);
    }
    if (!(left <= right)) return null;
    const guide = snapGuides({
      moving: { x: left, y: top, width: right - left, height: bottom - top },
      others: this._snapTargets(origin),
      threshold: GUIDE_SCREEN_PX / this._camera.zoom,
      sides: { x: MOVE_SIDES, y: MOVE_SIDES },
    });
    this._showGuides(guide.segments);
    return guide;
  },

  /**
   * La fine del gesto di un puntatore: il suo rilascio (`lost` falso) o una
   * chiusura senza rilascio (`lost` vero, da `_gestureLost`), per una sola
   * strada. Se chiude uno spostamento, un pizzico, un trascinamento o un
   * ridimensionamento (A-7), le schede vive si rifanno sulla vista e sulle
   * schede di adesso. Un tocco chiuso senza rilascio non conta come tocco
   * breve (`_gestureUp` lo tratta come annullato).
   */
  _gestureEnd(this: CanvasEngine, event: PointerEvent, lost: boolean): void {
    const moving = this._gestureMoving();
    this._pointerRelease(event);
    if (moving) this._refreshLive();
    // Dopo il tocco breve della lavagna: il doppio tocco mette la scheda
    // dopo che il primo ha tolto la scelta (T63).
    if (event.pointerType === "touch") this._gestureUp(event, lost);
    // A fine gesto (e dopo ogni tasto) la banda di stato si rilegge: dentro un
    // gesto `_statusSettle` non dice niente.
    this._statusSettle();
  },

  _pointerRelease(this: CanvasEngine, event: PointerEvent): void {
    // Il rilascio ferma lo scorrimento al bordo, anche fuori dalla finestra (T53).
    if (this._edgeScroll?.pointerId === event.pointerId) this._stopEdgeScroll();
    if (event.pointerType === "touch" && this._touchUp(event)) return;
    if (this._pan && event.pointerId === this._pan.pointerId) {
      const pan = this._pan;
      this._pan = null;
      // Il dito lasciato in corsa: la vista va avanti da sola (T53).
      if (event.pointerType === "touch" && pan.trail) {
        const speed = this._panSpeed(pan.trail, { t: event.timeStamp, x: event.clientX, y: event.clientY });
        this._fling(speed.vx, speed.vy);
      }
      // Ctrl+clic fermo su una scheda: la aggiunge alla scelta, o la toglie.
      if (pan.toggle !== undefined
        && Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) <= 3) {
        this._camera.x = pan.camX;
        this._camera.y = pan.camY;
        this._applyCamera();
        this._selectNode(pan.toggle, true);
      }
      return;
    }
    if (this._lasso && event.pointerId === this._lasso.pointerId) {
      this._endLasso();
      return;
    }
    if (this._marquee && event.pointerId === this._marquee.pointerId) {
      this._endMarquee();
      return;
    }
    if (this._strokeDrag && event.pointerId === this._strokeDrag.pointerId) {
      this._endStrokeDrag();
      return;
    }
    if (this._resize && event.pointerId === this._resize.pointerId && this._doc) {
      const resize = this._resize;
      this._resize = null;
      this._hideGuides();
      this._handleTap = resize.moved ? null : [...resize.origin.keys()];
      // La misura l'ha scelta chi usa: scrivendo la scheda non si allarga più (T44).
      if (resize.moved) for (const id of resize.origin.keys()) this._sizedByHand.add(id);
      this._writeGesture(resize.moved ? this._resizeOps(resize.origin) : null);
      return;
    }
    if (this._drag && event.pointerId === this._drag.pointerId) {
      const drag = this._drag;
      this._drag = null;
      this._hideGuides();
      // Una scheda spostata dal corpo non ci entra col clic che segue il rilascio.
      if (drag.moved) this._pressedSelected = null;
      // L'aggancio vale qui (#411 C-05), se Alt non è tenuto al rilascio.
      if (drag.moved && !event.altKey && this._snapSetting) this._settleDrag(drag);
      if (drag.moved) this._writeGesture(this._dragOps(drag));
      return;
    }
    if (this._connect && event.pointerId === this._connect.pointerId) {
      const connect = this._connect;
      this._endConnect();
      // Il filo di «Collega…» fatto, la colonna torna alla Selezione.
      if (connect.back) this._pickTool("select");
      // Nel vuoto nasce una scheda già in scrittura: la disegna `_placeText`.
      if (this._finishConnect(connect, event.clientX, event.clientY)) return;
      this._render();
    }
  },

  _cancelGestures(this: CanvasEngine): void {
    const active = this._drag !== null || this._resize !== null || this._strokeDrag !== null;
    const moving = this._gestureMoving();
    this._drag = null;
    this._resize = null;
    // Il lazo fermato non sceglie; lo spostamento fermato rimette i tratti.
    const strokeDrag = this._strokeDrag;
    this._strokeDrag = null;
    if (strokeDrag) {
      this._hideStrokeHolder();
      this._fadeUnits(strokeDrag.units, false);
    }
    if (this._lasso || strokeDrag) {
      this._lasso = null;
      this._paintLasso();
    }
    // Il rettangolo fermato lascia la scelta com'è (N6 T20b): un documento nuovo la
    // rifà da sé, e un puntatore annullato non la tocca.
    if (this._marquee !== null) this._stopMarquee();
    this._hideGuides();
    this._pan = null;
    this._endConnect();
    this._stopEdgeScroll();
    this._fingers.clear();
    this._tap = null;
    this._pinch = null;
    // Neanche il tocco lungo e il tocco di più dita (T63) sono più un gesto.
    this._cancelLongPress();
    if (this._fingerTap) this._fingerTap.spoiled = true;
    // Il gesto aveva mosso il modello in mano: torna quello del nucleo.
    const model = active && this._doc ? this._coreModel() : null;
    if (model) {
      this._doc = model;
      this._render();
    }
    // Un gesto fermato (la penna che si posa sotto il dito, un pointercancel)
    // è un gesto finito: la vista è quella dove si è fermato. Con la penna
    // giù il cambio aspetta che si alzi.
    if (moving) this._refreshLive();
    this._statusSettle();
  },

  /**
   * La fine di un gesto che ha mosso il modello in mano (un trascinamento, un
   * ridimensionamento): il modello torna quello del nucleo, poi le operazioni
   * del gesto vanno nel file in un passo d'annulla (T24). Senza operazioni, o
   * se il nucleo le rifiuta, la lavagna si ridisegna com'era.
   */
  _writeGesture(this: CanvasEngine, ops: readonly CanvasIntentOp[] | null): void {
    const model = this._coreModel();
    if (model) this._doc = model;
    if (this._writeOps(ops) === null && !this._destroyed) this._render();
  },

  /**
   * La `move` di un trascinamento (T24): le schede scelte dello spostamento
   * del gesto; un gruppo porta le schede che ci stanno dentro (`contents`,
   * T10), come le ha portate la vista. Oltre `MOVE_CONTENTS_MAX` schede
   * portate il nucleo rifiuta `contents`: allora la `move` dice tutte le
   * schede che la vista ha portato, una per una. `null` se non si è mosso
   * niente.
   */
  _dragOps(this: CanvasEngine, drag: CardDrag): CanvasIntentOp[] | null {
    if (drag.ids.length === 0 || (drag.dx === 0 && drag.dy === 0)) return null;
    const groups = drag.ids.some((id) => this._doc?.nodes.find((node) => node.id === id)?.type === "group");
    if (groups && drag.origin.size > MOVE_CONTENTS_MAX) {
      return [{ op: "move", ids: [...drag.origin.keys()], dx: drag.dx, dy: drag.dy }];
    }
    return [{ op: "move", ids: [...drag.ids], dx: drag.dx, dy: drag.dy, ...(groups ? { contents: true } : {}) }];
  },

  /**
   * Le operazioni di un ridimensionamento (T24), scheda per scheda: una
   * `move` se l'angolo in alto a sinistra è cambiato (le maniglie a sinistra o
   * in alto, Alt, la scelta che scala), una `resize` con le misure del gesto se
   * è cambiata la misura. Le misure sono già in unità intere della lavagna, a
   * ogni zoom. `null` se niente è cambiato.
   */
  _resizeOps(this: CanvasEngine, origin: ReadonlyMap<string, ResizeBox>): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const ops: CanvasIntentOp[] = [];
    for (const [id, start] of origin) {
      const node = doc.nodes.find((entry) => entry.id === id);
      if (!node) continue;
      if (node.x !== start.x || node.y !== start.y) ops.push({ op: "move", ids: [id], dx: node.x - start.x, dy: node.y - start.y });
      if (node.width !== start.width || node.height !== start.height) {
        ops.push({ op: "resize", id, width: node.width, height: node.height });
      }
    }
    return ops.length > 0 ? ops : null;
  },

  _dblclick(this: CanvasEngine, event: MouseEvent): void {
    const target = this._targetOf(event);
    if (this._readOnly || this._nodeAt(target)) return;
    // Su una maniglia della cornice della scelta: tutte le schede scelte
    // prendono la misura del loro contenuto (T66). Con la cattura del
    // puntatore il doppio clic su una maniglia arriva qui.
    const tap = this._takeHandleTap(target);
    if (tap) {
      this._fitToContent(tap);
      return;
    }
    // Il doppio tocco del dito mette la sua scheda da sé (T63): il `dblclick`
    // che il browser ne fa non ne mette un'altra.
    if (this._downByTouch) return;
    // Il doppio clic su una porta, su un filo o su un controllo non mette
    // niente, come il doppio tocco (IMP-053). Conta ciò che è sotto il punto del
    // clic, non il bersaglio: con la cattura del puntatore (il filo che parte da
    // una porta) il `dblclick` arriva alla vista, ma la porta è lì sotto.
    const under = this._elementAt(event.clientX, event.clientY);
    const at = under !== null && this._viewport.contains(under) ? under : target;
    if (!(at instanceof Element) || !this._emptyTarget(at)) return;
    // Nel punto del clic, già in scrittura, come il doppio tocco (T63, T100).
    this._placeText(event.clientX, event.clientY);
  },
};
export type DragMethods = typeof dragMethods;
