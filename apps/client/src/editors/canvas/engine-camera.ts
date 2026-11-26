// Il motore della lavagna: la camera (vista, zoom, rotella, salti). Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { commandForKey } from "./chrome/commands";
import { applyFindMarks, findMarks, type FindTarget } from "./find";
import { fit, stepCamera, zoomAtPoint, type MotionState } from "../../spatial/camera";
import { type CanvasNode } from "./model";
import { type CanvasView, type CanvasViewSnapshot } from "./view-state";
import { WHEEL_SETTLE_MS, wheelPixels } from "./engine-options";
import {
  VIEW_ZOOM_COMMANDS,
  isTextTarget,
  Viewport,
  PanSample,
  ZOOM_LIMITS,
  clampZoom,
  FIT_LIMITS,
  FIT_MARGIN,
  INERTIA_MIN_SPEED,
  INERTIA_WINDOW_MS,
  MAX_FRAME_MS,
} from "./engine-parts";
import { toCamera, fromCamera, edgeScrollSpeed, sameViewport, overlaps } from "./engine-geometry";
import type { CanvasEngine } from "./engine";

export const cameraMethods = {
  // --- camera ---------------------------------------------------------------

  _applyCamera(this: CanvasEngine): void {
    // Camera transforms are immediate for both motion preferences.
    this._stage.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.zoom})`;
    // Il filo sta nello stage (T91): la sua camera è quella dello stage. Le prese no.
    this._handleLayer.style.transform = `translate(${this._camera.x}px, ${this._camera.y}px) scale(${this._camera.zoom})`;
    this._inkLayer?.setCamera(this._camera.x, this._camera.y, this._camera.zoom);
    this._inkRuler?.place();
    this._paintGrid();
    // Le maniglie e i segni sopra le schede restano della stessa misura sullo
    // schermo a ogni zoom (T66): la pelle divide per `--canvas-zoom`.
    this._stage.style.setProperty("--canvas-zoom", String(this._camera.zoom));
    this._markAllHandles();
    // Il selettore delle sezioni resta attaccato alla sua scheda (T74).
    this._partsPicker?.handle.reposition();
    // E la barra del ritaglio alla sua (T78), e quella della selezione alle
    // schede scelte, anche durante lo zoom (#411 C-06).
    this._placeCropBar();
    this._followSelectionBar();
    // Anche la resa passa di qui: la scelta cambiata si ricorda con la camera.
    this._viewMemo?.changed();
    // Ogni cambio di zoom passa di qui (bottoni, tasti, menu, `fitCamera`): la
    // banda lo legge a fine gesto, dentro un gesto `_statusSettle` tace.
    this._statusSettle();
  },

  // --- riaprire dove eri (T36) ------------------------------------------------

  /** Ciò che si ricorda adesso: `null` se la lavagna non mostra un documento. */
  _viewSnapshot(this: CanvasEngine): CanvasViewSnapshot {
    if (!this._doc) return null;
    const camera = { ...this._camera };
    const selection = [...this._selection];
    return {
      camera,
      selection,
      ...(this._navigatorHidden ? { navigatorHidden: true } : {}),
      ...(this._gridOverride !== null ? { grid: this._gridOverride } : {}),
    };
  },

  /** La lavagna si è appena mostrata: la vista ricordata, se arriva, parte da qui. */
  _markOpenView(this: CanvasEngine): void {
    if (!this._viewMemo) return;
    this._openView = {
      camera: { ...this._camera },
      selection: this._selection.join("\n"),
      navigatorHidden: this._navigatorHidden,
      grid: this._gridOverride,
    };
  },

  /**
   * La vista ricordata per l'apertura `round`: la camera, se nessuno l'ha
   * mossa e se almeno una scheda cade nella vista ricordata (se no resta
   * «inquadra tutto»); la scelta, se è ancora vuota, con le sole schede che ci
   * sono; e le schede PDF già montate su un'altra pagina si rimontano sulla
   * loro. Arrivata prima che il nucleo aprisse il testo, aspetta `_revive`.
   */
  _restoreView(this: CanvasEngine, round: number, view: CanvasView | null): void {
    if (this._destroyed || round !== this._viewRound || view === null) return;
    const doc = this._doc;
    const open = this._openView;
    if (!doc || !open) {
      this._heldView = { round, view };
      return;
    }
    this._heldView = null;
    this._openView = null;
    let moved = false;
    const camera = view.camera;
    if (camera && sameViewport(this._camera, open.camera)) {
      const next: Viewport = { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom) };
      const seen = this._viewRectOf(next);
      if (doc.nodes.some((node) => overlaps(node, seen))) {
        this._camera = next;
        moved = true;
      }
    }
    let selected = false;
    if (view.selection.length > 0 && this._selection.join("\n") === open.selection && this._edgeSelection.length === 0) {
      const present = new Set(doc.nodes.map((node) => node.id));
      const selection = view.selection.filter((id) => present.has(id));
      if (selection.length > 0) {
        this._selection = selection;
        selected = true;
      }
    }
    // «Nascondi il navigatore» (T55), se nessuno l'ha cambiato nel frattempo.
    const hidden = view.navigatorHidden === true;
    if (this._navigatorHidden === open.navigatorHidden && hidden !== this._navigatorHidden) {
      this._navigatorHidden = hidden;
      this._statusSettle();
    }
    // La griglia di Ctrl+' per questa lavagna (T71), se nessuno l'ha cambiata nel frattempo.
    if (view.grid !== undefined && this._gridOverride === open.grid && this._gridOverride !== view.grid) {
      this._gridOverride = view.grid;
      this._paintGrid();
    }
    let remount = false;
    for (const entry of this._cards.values()) {
      const page = this._viewMemo?.page(entry.id) ?? null;
      const shown = entry.view?.page?.();
      if (page === null || shown === undefined || shown === page) continue;
      // Una chiave che nessun corpo ha: la resa smonta la vista e la rimonta.
      entry.bodyKey = null;
      remount = true;
    }
    if (!moved && !selected && !remount) return;
    this._render();
    if (selected) this._options.onSelectionChange();
  },

  _screenToWorld(this: CanvasEngine, clientX: number, clientY: number): { x: number; y: number } {
    const rect = this._viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this._camera.x) / this._camera.zoom,
      y: (clientY - rect.top - this._camera.y) / this._camera.zoom,
    };
  },

  /**
   * La camera che mostra tutte le schede `nodes` (T53: con `fit` di
   * `spatial/camera.ts`): al centro, con `FIT_MARGIN` per lato, mai oltre il
   * 100%. Senza schede, il 100% con l'origine in alto a sinistra.
   */
  _fitTarget(this: CanvasEngine, nodes: readonly CanvasNode[], margin = FIT_MARGIN): Viewport {
    if (!nodes.length) return { x: 24, y: 24, zoom: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const rect = this._viewport.getBoundingClientRect();
    const view = { w: Math.max(1, rect.width || 800), h: Math.max(1, rect.height || 600) };
    // Il margine sta nei bordi, in unità della lavagna: il centro non cambia.
    const bounds = {
      minX: minX - margin,
      minY: minY - margin,
      maxX: Math.max(minX + 1, maxX) + margin,
      maxY: Math.max(minY + 1, maxY) + margin,
    };
    return fromCamera(fit(bounds, view, 0, 0, FIT_LIMITS));
  },

  _zoomAt(this: CanvasEngine, clientX: number, clientY: number, factor: number): void {
    this._stopMotion(false);
    const rect = this._viewport.getBoundingClientRect();
    const at = { x: clientX - rect.left, y: clientY - rect.top };
    this._camera = fromCamera(zoomAtPoint(toCamera(this._camera), factor, at, ZOOM_LIMITS));
    this._applyCamera();
    // Dai pulsanti e dai tasti lo zoom è un gesto finito; dalla rotella il
    // gesto è ancora in corso e `_refreshLive` aspetta che finisca.
    this._refreshLive();
  },

  // --- muoversi (T53) ---------------------------------------------------------

  /**
   * Il salto della camera a `target`: Maiusc+1, Maiusc+2, 0 e il clic nel
   * navigatore (T55). È il solo posto da cui la vista salta: qui il salto entra
   * nella storia di Indietro e Avanti (T56), se sposta la vista. Vola con
   * `stepCamera`; col movimento ridotto arriva subito, senza volo.
   */
  _jumpCamera(this: CanvasEngine, target: Viewport): void {
    const goal: Viewport = { x: target.x, y: target.y, zoom: clampZoom(target.zoom) };
    // Un salto che non sposta niente non entra nella storia.
    if (!sameViewport(goal, this._camera)) this._jumps.record(this._camera, goal);
    this._flyCamera(goal);
  },

  /**
   * Porta la vista a `target` senza ricordarlo: è il volo di ogni salto, e
   * anche di Indietro e Avanti (T56), che non scrivono una storia loro.
   */
  _flyCamera(this: CanvasEngine, target: Viewport): void {
    this._stopMotion(false);
    const goal: Viewport = { x: target.x, y: target.y, zoom: clampZoom(target.zoom) };
    if (this._reducedMotion || sameViewport(goal, this._camera)) {
      this._camera = goal;
      this._applyCamera();
      this._refreshLive();
      return;
    }
    const from = this._camera;
    this._runMotion({
      scale: from.zoom, tx: from.x, ty: from.y,
      targetScale: goal.zoom, targetTx: goal.x, targetTy: goal.y,
      vx: 0, vy: 0,
    });
  },

  /**
   * Il velo dei risultati `matches` (`null` lo toglie), con quello di adesso
   * segnato: un giro sulle schede che scrive solo dove il segno cambia.
   */
  _showFound(this: CanvasEngine, matches: readonly FindTarget[] | null, current: number): void {
    this._findMarkOf = findMarks(matches, current);
    applyFindMarks(this._cards, this._findMarkOf);
  },

  /**
   * Il salto a un risultato (T60): le sue schede al centro della vista, con lo
   * zoom di adesso, o più lontano se non ci stanno. È un salto come gli altri
   * (`_jumpCamera`): Indietro torna da dove si era partiti; col movimento
   * ridotto arriva senza volo.
   */
  _jumpToFound(this: CanvasEngine, target: FindTarget): void {
    const ids = new Set(target.nodes);
    const nodes = (this._doc?.nodes ?? []).filter((node) => ids.has(node.id));
    if (nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const rect = this._viewport.getBoundingClientRect();
    const zoom = Math.min(this._camera.zoom, this._fitTarget(nodes).zoom);
    this._jumpCamera({
      x: (rect.width || 800) / 2 - ((minX + maxX) / 2) * zoom,
      y: (rect.height || 600) / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  },

  /**
   * «Nascondi il navigatore» e «Mostra il navigatore» (T55): per questa
   * lavagna, ricordato nella vista (T36). Il fuoco che stava sul navigatore
   * torna alla lavagna.
   */
  _setNavigatorHidden(this: CanvasEngine, hidden: boolean): void {
    if (this._navigatorClosed() === hidden) return;
    const focused = this._navigator.element.contains(document.activeElement);
    if (this._workspace.workspace === "simple") {
      // Nello spazio Semplice la scelta vale per questa apertura (T65).
      this._simpleNavigator = !hidden;
      this._statusSettle();
      if (focused && this._navigator.element.hidden) this._viewport.focus();
      return;
    }
    this._navigatorHidden = hidden;
    this._viewMemo?.changed();
    this._statusSettle();
    if (focused && this._navigator.element.hidden) this._viewport.focus();
  },

  /**
   * Il navigatore è chiuso per scelta: nello spazio Semplice finché non lo si
   * mostra (T65), nello Completo come dice la vista (T55).
   */
  _navigatorClosed(this: CanvasEngine): boolean {
    return this._workspace.workspace === "simple" ? !this._simpleNavigator : this._navigatorHidden;
  },

  /** «0»: il 100% sul centro della vista. */
  _zoomToActual(this: CanvasEngine): void {
    const rect = this._viewport.getBoundingClientRect();
    const center = { x: (rect.width || 800) / 2, y: (rect.height || 600) / 2 };
    this._jumpCamera(fromCamera(zoomAtPoint(toCamera(this._camera), 1 / this._camera.zoom, center, ZOOM_LIMITS)));
  },

  /**
   * L'inerzia dopo uno spostamento col dito: la vista va avanti alla
   * velocità del gesto (px al ms) e rallenta con `stepCamera`. Col movimento
   * ridotto niente.
   */
  _fling(this: CanvasEngine, vx: number, vy: number): void {
    if (this._reducedMotion || Math.hypot(vx, vy) < INERTIA_MIN_SPEED) return;
    const at = this._camera;
    this._runMotion({ scale: at.zoom, tx: at.x, ty: at.y, targetScale: at.zoom, targetTx: at.x, targetTy: at.y, vx, vy });
  },

  /** La velocità alla fine di uno spostamento, in px al ms, sugli ultimi `INERTIA_WINDOW_MS` della scia. */
  _panSpeed(this: CanvasEngine, trail: readonly PanSample[], end: PanSample): { vx: number; vy: number } {
    const first = trail.find((point) => end.t - point.t <= INERTIA_WINDOW_MS);
    if (!first || end.t - first.t <= 0) return { vx: 0, vy: 0 };
    return { vx: (end.x - first.x) / (end.t - first.t), vy: (end.y - first.y) / (end.t - first.t) };
  },

  _runMotion(this: CanvasEngine, state: MotionState): void {
    this._motion = { state, last: null };
    if (this._motionFrame === undefined) this._motionFrame = requestAnimationFrame((now) => this._motionStep(now));
  },

  _motionStep(this: CanvasEngine, now: number): void {
    this._motionFrame = undefined;
    const motion = this._motion;
    if (!motion || this._destroyed) return;
    if (this._reducedMotion) {
      this._stopMotion(true);
      return;
    }
    const dt = motion.last === null ? 16 : Math.min(MAX_FRAME_MS, Math.max(0, now - motion.last));
    motion.last = now;
    const state = stepCamera(motion.state, dt);
    motion.state = state;
    const resting = Math.abs(state.scale - state.targetScale) < 0.001
      && Math.abs(state.tx - state.targetTx) < 0.5
      && Math.abs(state.ty - state.targetTy) < 0.5
      && state.vx === 0 && state.vy === 0;
    if (resting) {
      this._stopMotion(true);
      return;
    }
    this._camera = { x: state.tx, y: state.ty, zoom: state.scale };
    this._applyCamera();
    this._motionFrame = requestAnimationFrame((later) => this._motionStep(later));
  },

  /**
   * Ferma il volo o l'inerzia. Con `arrive` la vista va dove andava (il volo
   * finisce sul suo bersaglio, l'inerzia dov'è) e le schede vive si rifanno.
   */
  _stopMotion(this: CanvasEngine, arrive: boolean): void {
    if (this._motionFrame !== undefined) cancelAnimationFrame(this._motionFrame);
    this._motionFrame = undefined;
    const motion = this._motion;
    if (!motion) return;
    this._motion = null;
    if (!arrive || this._destroyed) return;
    const { targetScale, targetTx, targetTy } = motion.state;
    this._camera = { x: targetTx, y: targetTy, zoom: targetScale };
    this._applyCamera();
    this._refreshLive();
  },

  /** La finestra perde il fuoco: niente scorre più da solo, e Spazio non è più tenuto. */
  _stillCamera(this: CanvasEngine): void {
    this._releaseSpace();
    this._stopEdgeScroll();
    this._stopMotion(true);
  },

  /**
   * Spazio giù sulla lavagna o su una scheda (non in un campo né dentro la
   * scheda attiva): `true` se l'ha preso. Con una penna giù non vale (la
   * penna ha la precedenza), ma la pagina non scorre.
   */
  _holdSpace(this: CanvasEngine, event: KeyboardEvent): boolean {
    if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isTextTarget(event.target) || !this._onCardOrBoard(event.target)) return false;
    event.preventDefault();
    if (this._spaceHeld || this._penDown) return true;
    this._spaceHeld = true;
    // Il tocco conta dal primo tasto giù, non dalla ripetizione del sistema.
    this._spaceTap = event.repeat ? null : { at: event.timeStamp, from: this._pointerSeen, spoiled: false };
    this._viewport.toggleAttribute("data-space-pan", true);
    // Il mouse che scrive torna alla lavagna finché Spazio è giù.
    this._applyInkMouse();
    return true;
  },

  _releaseSpace(this: CanvasEngine): void {
    this._spaceTap = null;
    if (!this._spaceHeld) return;
    this._spaceHeld = false;
    this._viewport.removeAttribute("data-space-pan");
    if (!this._destroyed) this._applyInkMouse();
  },

  /**
   * Un trascinamento (una scheda, una maniglia, un filo) si è mosso a
   * `event`: vicino al bordo della vista la fa scorrere, fuori dalla fascia
   * smette. Il primo fotogramma parte da qui.
   */
  _trackEdge(this: CanvasEngine, event: PointerEvent): void {
    const speed = this._edgeSpeed(event.clientX, event.clientY);
    if (speed.x === 0 && speed.y === 0) {
      this._stopEdgeScroll();
      return;
    }
    const last = this._edgeScroll?.last ?? null;
    this._edgeScroll = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      shiftKey: event.shiftKey, altKey: event.altKey, last,
    };
    if (this._edgeFrame === undefined) this._edgeFrame = requestAnimationFrame((now) => this._edgeStep(now));
  },

  /** La velocità dello scorrimento al bordo nel punto, in px al ms, verso dove va la vista. */
  _edgeSpeed(this: CanvasEngine, clientX: number, clientY: number): { x: number; y: number } {
    const rect = this._viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: edgeScrollSpeed(clientX - rect.left, rect.right - clientX),
      y: edgeScrollSpeed(clientY - rect.top, rect.bottom - clientY),
    };
  },

  _edgeStep(this: CanvasEngine, now: number): void {
    this._edgeFrame = undefined;
    const edge = this._edgeScroll;
    if (!edge || this._destroyed) return;
    const drag = this._drag?.pointerId === edge.pointerId ? this._drag : null;
    const resize = this._resize?.pointerId === edge.pointerId ? this._resize : null;
    const connect = this._connect?.pointerId === edge.pointerId ? this._connect : null;
    if (!drag && !resize && !connect) {
      this._stopEdgeScroll();
      return;
    }
    const dt = edge.last === null ? 16 : Math.min(MAX_FRAME_MS, Math.max(0, now - edge.last));
    edge.last = now;
    const speed = this._edgeSpeed(edge.clientX, edge.clientY);
    // La vista va verso il bordo: la lavagna scorre al contrario.
    const dx = -speed.x * dt;
    const dy = -speed.y * dt;
    this._camera = { ...this._camera, x: this._camera.x + dx, y: this._camera.y + dy };
    this._applyCamera();
    // Ciò che si tira resta sotto il puntatore fermo: il punto di partenza
    // del gesto scorre con la lavagna.
    if (drag) {
      drag.startX += dx;
      drag.startY += dy;
      this._moveDrag(edge);
    } else if (resize) {
      resize.startX += dx;
      resize.startY += dy;
      this._moveResize(edge);
    } else {
      this._moveConnect(edge.clientX, edge.clientY);
    }
    this._edgeFrame = requestAnimationFrame((later) => this._edgeStep(later));
  },

  _stopEdgeScroll(this: CanvasEngine): void {
    if (this._edgeFrame !== undefined) cancelAnimationFrame(this._edgeFrame);
    this._edgeFrame = undefined;
    this._edgeScroll = null;
  },

  _wheel(this: CanvasEngine, event: WheelEvent): void {
    const target = this._targetOf(event);
    // Sopra la scheda attiva la rotella scorre lei (A-11); Ctrl+rotella e il
    // pizzico ingrandiscono sempre la lavagna.
    if (!event.ctrlKey && !event.metaKey && this._insideActive(target, true)) {
      this._wheelUnderVeil(event, target);
      return;
    }
    // Sopra il testo che si scrive in una scheda la rotella scorre il testo
    // (una scheda di testo lunga, T43).
    if (!event.ctrlKey && !event.metaKey && target instanceof Node && this._editor?.place.contains(target)) {
      this._wheelUnderVeil(event, target);
      return;
    }
    event.preventDefault();
    // La rotella prende la vista: un volo o un'inerzia si fermano (T53).
    this._stopMotion(false);
    // Prima di muovere la camera: lo zoom della rotella è un gesto in corso.
    clearTimeout(this._wheelTimer);
    this._wheelTimer = setTimeout(() => {
      this._wheelTimer = undefined;
      this._refreshLive();
      // La rotella finita è un gesto finito: la banda legge lo zoom nuovo.
      this._statusSettle();
    }, WHEEL_SETTLE_MS);
    // Il delta in pixel: la pagina della rotella è la vista, misurata solo se serve.
    const page = event.deltaMode === 2 ? this._viewport.getBoundingClientRect() : null;
    const dx = wheelPixels(event.deltaX, event.deltaMode, page?.width ?? 0);
    const dy = wheelPixels(event.deltaY, event.deltaMode, page?.height ?? 0);
    // Ctrl+rotella e il pizzico ingrandiscono con qualunque impostazione; uno
    // scatto senza parte verticale non ingrandisce.
    if (event.ctrlKey || event.metaKey) {
      if (dy !== 0) this._zoomAt(event.clientX, event.clientY, dy < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    // Maiusc sposta di lato. Dove il sistema non manda `deltaX`, si usa `deltaY`.
    if (event.shiftKey) {
      this._camera.x -= dx !== 0 ? dx : dy;
      this._applyCamera();
      return;
    }
    // `zoom`: la rotella ingrandisce. Un evento con una parte orizzontale (le due
    // dita sul touchpad) sposta, come in `pan`, così il touchpad resta usabile.
    if (this._wheelSetting === "zoom" && dx === 0) {
      if (dy !== 0) this._zoomAt(event.clientX, event.clientY, dy < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    this._camera.x -= dx;
    this._camera.y -= dy;
    this._applyCamera();
  },

  /**
   * La rotella sopra la scheda attiva, presa dal velo della croce (T20d): il
   * browser scorrerebbe gli antenati del velo, cioè niente. La scorre la
   * lavagna: il primo antenato di `under` che può scorrere in quella
   * direzione, dentro la vista. Senza velo scorre il browser, come sempre.
   */
  _wheelUnderVeil(this: CanvasEngine, event: WheelEvent, under: EventTarget | null): void {
    if (event.target !== this._penVeil || !(under instanceof Element)) return;
    for (let element: Element | null = under; element && element !== this._viewport; element = element.parentElement) {
      const dx = wheelPixels(event.deltaX, event.deltaMode, element.clientWidth);
      const dy = wheelPixels(event.deltaY, event.deltaMode, element.clientHeight);
      const style = getComputedStyle(element);
      const free = (overflow: string): boolean => overflow === "auto" || overflow === "scroll";
      const vertical = dy !== 0 && free(style.overflowY) && element.scrollHeight > element.clientHeight;
      const horizontal = dx !== 0 && free(style.overflowX) && element.scrollWidth > element.clientWidth;
      if (!vertical && !horizontal) continue;
      event.preventDefault();
      element.scrollBy({ left: horizontal ? dx : 0, top: vertical ? dy : 0 });
      return;
    }
  },

  /**
   * Un tasto dello zoom fuori dalla vista (la riga delle opzioni, la colonna, il
   * navigatore) zooma, come i tasti degli strumenti sulla colonna (IMP-040).
   * Dentro la vista lo prende `_keydown`, che sa della scheda attiva e dei campi.
   */
  _zoomKeydown(this: CanvasEngine, event: KeyboardEvent): void {
    if (event.defaultPrevented || !this._doc || this._isSceneOversized()) return;
    if (event.target instanceof Node && this._viewport.contains(event.target)) return;
    const zoom = this.commands().filter((command) => VIEW_ZOOM_COMMANDS.has(command.id));
    // In una casella a discesa (i campi del filo nella barra della selezione) un
    // numero o un segno cerca l'opzione, come in un campo: solo Ctrl zooma.
    const writing = isTextTarget(event.target) || event.target instanceof HTMLSelectElement;
    const command = commandForKey(zoom, event, { writing, onBoard: false });
    if (command) this._runKey(event, command);
  },
};
export type CameraMethods = typeof cameraMethods;
