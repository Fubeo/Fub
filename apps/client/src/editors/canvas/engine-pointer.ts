// Il motore della lavagna: il puntatore e il dito. Metodi della classe
// `CanvasEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import { nearFreeSpot } from "./free-spot";
import { t } from "../../i18n/strings";
import { saveFingerWrites } from "./chrome/rail";
import { isEmptyBoard } from "./chrome/empty";
import { cardsTouched, edgesBetween, marqueeBox, marqueeMoved, sameIds, unionIds } from "./marquee";
import { TAP_MAX_MS, TAP_SLOP_PX, isTap, pinchCamera, type TouchPoint } from "./touch";
import { type EdgeSide } from "./edges";
import {
  MarqueeLayer,
  MarqueeGesture,
  FINGER_CONTROLS,
  CardLink,
  FINGER_HANDLES,
  LONG_PRESS_MS,
  FINGERS_TAP_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  MENU_ECHO_MS,
  ZOOM_LIMITS,
} from "./engine-parts";
import { snap, TEXT_CARD_HEIGHT } from "./engine-geometry";
import type { CanvasEngine } from "./engine";

export const pointerMethods = {
  // --- pointer ------------------------------------------------------------------

  _nodeAt(this: CanvasEngine, target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>(".canvas-node") : null;
    return el?.dataset.node ?? null;
  },

  _edgeAt(this: CanvasEngine, target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<SVGElement>(".canvas-edge-hit") : null;
    return el?.dataset.edge ?? null;
  },
  _displaySelection(this: CanvasEngine): void {
    for (const el of this._stage.querySelectorAll<HTMLElement>(".canvas-node")) {
      el.classList.toggle("selected", this._selection.includes(el.dataset.node ?? ""));
    }
    if (this._doc && !this._isSceneOversized()) this._drawEdges();
    this._syncSelectionFrame();
    this._paintLasso();
    this._drawToolbar();
    // Una scheda sola scelta con delle gemelle: la banda le dice (T22).
    if (this._twinsKey() !== this._twinsShown) this._statusSettle();
  },

  _pointerDown(this: CanvasEngine, event: PointerEvent): void {
    // Sotto il velo della croce (T20d) vale ciò che c'è sotto.
    const target = this._targetOf(event);
    // Un clic fuori dal ritaglio lo applica, come «Fatto» (il ritaglio del
    // disegno fa lo stesso, A-27). I gesti dentro il ritaglio non arrivano qui.
    const crop = this._crop;
    if (crop?.editor && !crop.editor.contains(target)) this._finishCrop("done", crop.editor.zone());
    // Il tasto laterale della penna senza lo strato della penna (la sola
    // lettura), che altrimenti lo prende prima (T63).
    if (event.pointerType === "pen" && event.button === 2 && this._inkLayer === null && this._penButtonSetting !== "eraser") {
      event.preventDefault();
      this._barrelDown(event);
      return;
    }
    // Un clic fuori dalle maniglie chiude il doppio clic che le adatta (T66).
    if (!(target instanceof Element && target.closest("[data-resize], [data-resize-frame]"))) this._handleTap = null;
    // Prima di ogni gesto, il testo in sospeso (non i clic dentro il campo).
    if (!(target instanceof Node && this._editor?.place.contains(target))) this._recordPending();
    const pressed = this._nodeAt(target);
    this._pressedSelected = pressed !== null && this._selection.length === 1 && this._selection[0] === pressed
      ? pressed
      : null;
    // Un clic fuori dalla scheda attiva ne esce. La penna no: scrive sopra
    // anche una scheda attiva (N4); e il tasto centrale, che sposta la vista,
    // non toglie la scrittura (T41).
    const panning = event.button === 1 && this._writingId !== null;
    if (this._activeId !== null && event.pointerType !== "pen" && !panning && !this._insideActive(target, false)) {
      this._leaveCard(false);
    }
    if (event.pointerType === "touch") this._touchDown(event);
    else this._mouseDown(event);
  },

  _mouseDown(this: CanvasEngine, event: PointerEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    const target = this._targetOf(event);
    // Ctrl+clic (Cmd+clic) su un link di una scheda lo segue (D-18 (c)): il
    // `click` deve arrivare al link, non a uno spostamento della lavagna.
    if (event.button === 0 && modifier && this._cardLinkAt(target) !== null) return;
    // ↗ di un estratto (T75) prende il suo clic, anche con Ctrl (Cmd).
    if (event.button === 0 && target instanceof Element && target.closest("[data-excerpt-open]")) return;
    // Anche «Torna a N px» dell'avviso dei tratti sul testo.
    if (event.button === 0 && target instanceof Element && target.closest("[data-ink-reflow]")) return;
    // Spazio tenuto: il tasto principale sposta la vista, con qualsiasi
    // strumento e sopra ogni cosa (T53).
    if (event.button === 0 && this._spaceHeld) {
      // Il clic che segue non entra nella scheda scelta sotto il puntatore.
      this._pressedSelected = null;
      this._beginPan(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    // Una maniglia vince su Alt (dal centro) e su Maiusc (le proporzioni):
    // i tasti si leggono mentre si tira (T66). La Mano sposta e basta.
    if (event.button === 0 && !modifier && this._tool !== "hand" && this._resizeFromHandle(event)) return;
    // Alt+trascina dal corpo di una scheda tira un filo (T67); nel vuoto Alt
    // sposta ancora la vista.
    if (event.button === 0 && event.altKey && !modifier && this._tool !== "hand"
      && !this._insideActive(target, false)) {
      const from = this._nodeAt(target);
      if (from && this._beginConnect(event, { from })) return;
    }
    if (event.button === 1 || modifier || event.altKey) {
      const toggle = event.button === 0 && modifier && !event.altKey ? this._nodeAt(target) ?? undefined : undefined;
      this._pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, camX: this._camera.x, camY: this._camera.y, toggle };
      this._viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    // La Mano sposta la lavagna, anche sopra le schede, e non sceglie niente.
    if (this._tool === "hand") {
      this._beginPan(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
      return;
    }
    // Il Lazo (T86): dentro ciò che ha scelto lo sposta; altrove, o con
    // Maiusc che aggiunge, fa un giro nuovo. In sola lettura sceglie e basta.
    if (this._tool === "lasso" && this._doc && !this._isSceneOversized()) {
      event.preventDefault();
      if (!this._readOnly && !event.shiftKey && this._insideChosen(event)) this._beginStrokeDrag(event);
      else this._beginLasso(event);
      return;
    }
    const endpoint = target instanceof Element ? target.closest<SVGElement>("[data-reconnect]") : null;
    if (endpoint && !this._readOnly) {
      const edge = this._doc?.edges.find((entry) => entry.id === endpoint.dataset.reconnect);
      if (!edge) return;
      const side = endpoint.dataset.endpoint === "from" ? "from" : "to";
      this._beginConnect(event, { from: edge.fromNode, edgeId: edge.id, endpoint: side });
      return;
    }
    const connectHandle = target instanceof Element ? target.closest<HTMLElement>("[data-connect]") : null;
    if (connectHandle) {
      if (this._readOnly) return;
      this._beginConnect(event, { from: connectHandle.dataset.connect! });
      return;
    }
    // I quattro punti sui lati (T67): il filo parte da quel lato.
    const port = target instanceof Element ? target.closest<HTMLElement>(".canvas-port") : null;
    const portOwner = port ? this._nodeAt(port) : null;
    if (port && portOwner) {
      this._beginConnect(event, { from: portOwner, fromSide: port.dataset.side as EdgeSide });
      return;
    }
    const nodeId = this._nodeAt(target);
    // Collega: da una scheda si trascina il filo fino a un'altra, come dalla
    // maniglia di collegamento.
    if (nodeId && this._tool === "connect" && !this._readOnly) {
      // Dopo «Collega…» il filo parte dalla scheda scelta allora, e il clic
      // su un'altra lo chiude dove si alza (T17).
      const from = this._connectFrom;
      this._connectFrom = null;
      this._beginConnect(event, from !== null && from !== nodeId ? { from, back: true } : { from: nodeId });
      return;
    }
    // Un filo entro 8 px vince sulla scheda dove si vede, fuori dalla scheda (T67).
    const wire = this._wireAt(target, event.clientX, event.clientY);
    if (wire) {
      // Scegliere il filo rifà i fili, e il bersaglio di questo clic esce dal
      // documento: WebKitGTK porterebbe il fuoco su BODY. Il mouse giù annullato
      // lo lascia, e il fuoco va sulla vista qui sotto (IMP-052).
      event.preventDefault();
      this._selectEdge(wire);
      this._claimFocus(null);
      return;
    }
    if (nodeId) {
      this._selectNode(nodeId, event.shiftKey);
      this._keepContentFocus(event, nodeId);
      // Il fuoco rimasto su un pulsante della colonna o della riga torna alla
      // lavagna: Canc, Ctrl+Z e lo zoom valgono per la scheda appena scelta (IMP-040).
      this._claimFocus(this._cards.get(nodeId)?.article ?? null);
      if (this._readOnly || !this._doc || !this._dragsCard(target, nodeId)) return;
      this._beginDrag(event);
      return;
    }
    const edgeId = this._edgeAt(target);
    if (edgeId) {
      this._selectEdge(edgeId);
      this._claimFocus(null);
      return;
    }
    // Testo: un clic sul vuoto mette lì una scheda di testo, col campo aperto,
    // e la colonna torna alla Selezione.
    if (this._tool === "text" && !this._readOnly) {
      event.preventDefault();
      this._placeText(event.clientX, event.clientY);
      return;
    }
    // Col mouse e con la Selezione, il vuoto sceglie con un rettangolo (N6 T20b);
    // con «sposta la vista» resta il comportamento di prima, qui sotto. Il dito e
    // la penna nel vuoto spostano sempre la vista, e arrivano da un'altra strada.
    if (event.pointerType === "mouse" && this._tool === "select" && this._doc && this._dragEmptySetting === "select"
      && !this._isSceneOversized()) {
      this._beginMarquee(event);
      return;
    }
    if (!event.shiftKey) this._clearSelection();
    this._claimFocus(null);
    this._beginPan(event.pointerId, event.clientX, event.clientY);
  },

  /**
   * Il fuoco fuori dalla lavagna (un pulsante della colonna, della riga delle
   * opzioni o della barra dei comandi appena cliccato) va su `card`, o sulla
   * vista: i tasti della lavagna arrivano di nuovo (IMP-040). Il fuoco già
   * dentro la vista resta dov'è (una scheda, il campo che scrive).
   */
  _claimFocus(this: CanvasEngine, card: HTMLElement | null): void {
    if (this._viewport.contains(document.activeElement)) return;
    (card?.isConnected ? card : this._viewport).focus({ preventScroll: true });
  },

  /**
   * Il mouse giù su `target` sposta la scheda `id` (IMP-041): dalla testata
   * sempre; dal corpo se la scheda non è attiva né in scrittura (allora il
   * corpo è del contenuto) e se sotto il puntatore non c'è un controllo della
   * vista (un pulsante, un campo), che tiene il suo clic. Un clic fermo resta
   * un clic: lo spostamento comincia oltre i 3 px.
   */
  _dragsCard(this: CanvasEngine, target: EventTarget | null, id: string): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest(".canvas-node-handle")) return true;
    if (this._activeId === id || this._editor?.id === id) return false;
    const entry = this._cards.get(id);
    if (!entry || !entry.article.contains(target)) return false;
    const control = target.closest("button, input, textarea, select, [contenteditable=''], [contenteditable='true']");
    return control === null || !entry.article.contains(control);
  },

  /**
   * Il trascinamento sinistro sul vuoto con la Selezione (N6 T20b) comincia il
   * rettangolo: il puntatore è preso dalla lavagna, e il fuoco va sulla vista, così
   * Esc arriva. Il clic non cambia ancora la scelta: lo fa il rilascio. Il
   * rettangolo si disegna al movimento; la scelta si aggiorna una volta per
   * fotogramma, e a fine gesto.
   */
  _beginMarquee(this: CanvasEngine, event: PointerEvent): void {
    const at = this._screenToWorld(event.clientX, event.clientY);
    this._marquee = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: at,
      to: at,
      additive: event.shiftKey,
      moved: false,
      base: { nodes: [...this._selection], edges: [...this._edgeSelection], strokes: new Set(this._strokeSelection) },
    };
    this._viewport.setPointerCapture?.(event.pointerId);
    this._viewport.focus({ preventScroll: true });
    event.preventDefault();
  },

  /** Il puntatore del rettangolo si muove: il riquadro segue subito, la scelta aspetta il fotogramma. */
  _moveMarquee(this: CanvasEngine, event: PointerEvent): void {
    const marquee = this._marquee;
    if (!marquee) return;
    marquee.to = this._screenToWorld(event.clientX, event.clientY);
    if (!marquee.moved) {
      if (!marqueeMoved(marquee.startX, marquee.startY, event.clientX, event.clientY)) return;
      marquee.moved = true;
    }
    this._paintMarquee(marquee);
    this._scheduleMarquee();
  },

  /**
   * Lo strato del rettangolo sullo stage, creato la prima volta che serve e poi lo
   * stesso. Si aggiunge allo stage quando serve, e non a ogni movimento: ogni
   * spostamento di un figlio dello stage rifà lo stile di ciò che gli sta attorno.
   */
  _marqueeLayerNow(this: CanvasEngine): MarqueeLayer {
    let layer = this._marqueeLayer;
    if (!layer) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "canvas-marquee");
      svg.setAttribute("aria-hidden", "true");
      const box = document.createElementNS(ns, "rect");
      box.setAttribute("class", "canvas-marquee-box");
      svg.append(box);
      layer = { svg, box };
      this._marqueeLayer = layer;
    }
    if (layer.svg.parentElement !== this._stage) this._stage.append(layer.svg);
    return layer;
  },

  /** Disegna il rettangolo del gesto nel suo strato: quattro attributi, nessuna scheda toccata. */
  _paintMarquee(this: CanvasEngine, marquee: MarqueeGesture): void {
    const layer = this._marqueeLayerNow();
    const box = marqueeBox(marquee.from, marquee.to);
    layer.box.setAttribute("x", String(box.minX));
    layer.box.setAttribute("y", String(box.minY));
    layer.box.setAttribute("width", String(box.maxX - box.minX));
    layer.box.setAttribute("height", String(box.maxY - box.minY));
  },

  /** Chiede un fotogramma per la scelta, se non ce n'è già uno in attesa. */
  _scheduleMarquee(this: CanvasEngine): void {
    if (this._marqueeFrame === undefined) this._marqueeFrame = requestAnimationFrame(() => this._marqueeStep());
  },

  /** Il fotogramma del rettangolo: la scelta si rifà una volta, con il rettangolo di adesso. */
  _marqueeStep(this: CanvasEngine): void {
    this._marqueeFrame = undefined;
    const marquee = this._marquee;
    if (marquee !== null && marquee.moved && !this._destroyed) this._applyMarquee(marquee);
  },

  /** La scelta che il rettangolo fa adesso: le schede che tocca (più quelle di prima, con Maiusc) e i fili fra due di loro. */
  _applyMarquee(this: CanvasEngine, marquee: MarqueeGesture): void {
    const doc = this._doc;
    if (!doc) return;
    const touched = cardsTouched(marqueeBox(marquee.from, marquee.to), doc.nodes);
    const nodes = marquee.additive ? unionIds(marquee.base.nodes, touched) : touched;
    const edges = edgesBetween(new Set(nodes), doc.edges);
    this._setChoice(
      nodes,
      marquee.additive ? unionIds(marquee.base.edges, edges) : edges,
      marquee.additive ? marquee.base.strokes : new Set(),
    );
  },

  /**
   * Mette la scelta a `nodes`, `edges` e `strokes` e la mostra sullo stage. Solo le
   * schede che cambiano stato toccano la classe, e i fili si rifanno solo se la
   * loro scelta cambia: un fotogramma che non sposta niente non tocca lo stage.
   * La riga delle opzioni e la barra dei comandi si rifanno solo quando la scelta
   * passa da vuota a piena o viceversa, e lo stato verso chi ascolta (l'ispettore)
   * solo a fine gesto, come il lazo: a ogni fotogramma costano troppo (N6 T20b).
   * A fine gesto le rifà chi chiama.
   */
  _setChoice(this: CanvasEngine, nodes: readonly string[], edges: readonly string[], strokes: ReadonlySet<string>): void {
    const was = new Set(this._selection);
    const next = new Set(nodes);
    const changed = new Set<string>();
    for (const id of was) if (!next.has(id)) changed.add(id);
    for (const id of next) if (!was.has(id)) changed.add(id);
    const edgesChanged = !sameIds(this._edgeSelection, edges);
    const strokesChanged = !sameIds(this._strokeSelection, strokes);
    if (changed.size === 0 && !edgesChanged && !strokesChanged) return;
    this._selection = [...nodes];
    this._edgeSelection = [...edges];
    this._strokeSelection = new Set(strokes);
    if (changed.size > 0) {
      for (const el of this._stage.querySelectorAll<HTMLElement>(".canvas-node")) {
        const id = el.dataset.node ?? "";
        if (changed.has(id)) el.classList.toggle("selected", next.has(id));
      }
    }
    if (edgesChanged && this._doc && !this._isSceneOversized()) this._drawEdges();
    if (strokesChanged) this._paintLasso();
    this._syncSelectionFrame();
    if ((was.size === 0) !== (next.size === 0)) this._drawToolbar();
  },

  /**
   * Il rettangolo finisce col rilascio, con la cattura persa o con la finestra
   * (una volta sola). Uno spostato lascia la scelta dove il rettangolo l'ha
   * portata; un clic senza spostamento toglie la scelta, come prima, se non c'è
   * Maiusc.
   */
  _endMarquee(this: CanvasEngine): void {
    const marquee = this._marquee;
    if (marquee === null) return;
    if (marquee.moved) this._applyMarquee(marquee);
    else if (!marquee.additive) this._clearSelection();
    this._stopMarquee();
    // La riga, la barra dei comandi e chi ascolta la scelta si rifanno a fine gesto, con la scelta di adesso.
    if (marquee.moved) this._settleChoice();
  },

  /** Esc: il rettangolo si annulla e la scelta torna com'era prima del trascinamento. */
  _cancelMarquee(this: CanvasEngine): void {
    const marquee = this._marquee;
    if (marquee === null) return;
    this._stopMarquee();
    if (marquee.moved) {
      this._setChoice(marquee.base.nodes, marquee.base.edges, marquee.base.strokes);
      this._settleChoice();
    }
  },

  /** La scelta del rettangolo è quella finale: la riga e la barra si rifanno, e chi ascolta la scelta ne è avvisato una volta. */
  _settleChoice(this: CanvasEngine): void {
    this._drawToolbar();
    this._options.onSelectionChange();
  },

  /** Il rettangolo smette: il fotogramma in attesa si ferma e lo strato esce dallo stage. */
  _stopMarquee(this: CanvasEngine): void {
    this._marquee = null;
    if (this._marqueeFrame !== undefined) cancelAnimationFrame(this._marqueeFrame);
    this._marqueeFrame = undefined;
    this._marqueeLayer?.svg.remove();
  },

  /**
   * La scheda di testo dello strumento Testo, nel punto `clientX`, `clientY` della
   * finestra; senza punto, al centro della vista («Scrivi una scheda», T62). Si
   * apre in scrittura. Con `link` (un filo lasciato nel vuoto, T67) nasce
   * collegata alla scheda `link.from`, nello stesso commit. La colonna torna
   * alla Selezione, salvo con `keepTool` (il doppio tocco, T63).
   */
  _placeText(this: CanvasEngine, clientX?: number, clientY?: number, link?: CardLink, keepTool = false): void {
    const at = clientX === undefined || clientY === undefined
      ? this._freeTextSpot()
      : link ? this._screenToWorld(clientX, clientY) : this._freeTextSpotAt(this._screenToWorld(clientX, clientY));
    const placed = this._addNode("text", undefined, at, link);
    if (!placed) return;
    // Il passo che l'ha messa: lasciata vuota, se ne va con lui (T44).
    const born = this._undo[this._undo.length - 1] ?? null;
    // Il doppio tocco (T63) lascia lo strumento com'è.
    if (!keepTool) this._pickTool("select");
    this._render();
    this._beginCardEdit(placed, born);
  },

  /**
   * L'angolo in alto a sinistra di una scheda di testo nuova senza un punto
   * scelto («Aggiungi testo», «Scrivi una scheda»): al centro della vista, o
   * al posto libero più vicino, così non copre un'altra scheda (IMP-042).
   */
  _freeTextSpot(this: CanvasEngine): { x: number; y: number } | undefined {
    const doc = this._doc;
    if (!doc) return undefined;
    const rect = this._viewport.getBoundingClientRect();
    const center = this._screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const spot = nearFreeSpot(doc.nodes, { x: snap(center.x - 160), y: snap(center.y - 80), width: 320, height: TEXT_CARD_HEIGHT });
    return { x: spot.x, y: spot.y };
  },

  /**
   * L'angolo in alto a sinistra di una scheda di testo nuova nel punto `at`
   * (del mondo) scelto da chi usa (il doppio clic, il doppio tocco, il menu):
   * lì, se la scheda ci sta senza coprirne un'altra; se no al posto libero più
   * vicino, con la regola di «Aggiungi testo» (IMP-042). Una scheda che nasce
   * sopra quelle accanto le nasconde, e il clic dopo cade su di loro
   * (IMP-3808).
   */
  _freeTextSpotAt(this: CanvasEngine, at: { x: number; y: number }): { x: number; y: number } {
    const doc = this._doc;
    if (!doc) return at;
    const spot = nearFreeSpot(doc.nodes, { x: snap(at.x), y: snap(at.y), width: 320, height: TEXT_CARD_HEIGHT });
    return { x: spot.x, y: spot.y };
  },

  /** La lavagna vuota (T62): le righe e i pulsanti, se la lavagna è vuota e si può scrivere. */
  _syncEmpty(this: CanvasEngine): void {
    const doc = this._doc;
    this._empty.sync({
      empty: !this._destroyed && doc !== null && isEmptyBoard(doc),
      editable: !this._readOnly && !this._isSceneOversized(),
    });
  },

  /** La scheda `nodeId` presa col clic: `additive` (Maiuscolo) la aggiunge o la toglie. */
  _selectNode(this: CanvasEngine, nodeId: string, additive: boolean): void {
    if (additive) {
      this._selection = this._selection.includes(nodeId)
        ? this._selection.filter((id) => id !== nodeId)
        : [...this._selection, nodeId];
    } else if (!this._selection.includes(nodeId)) {
      this._selection = [nodeId];
      this._strokeSelection = new Set();
    } else {
      return;
    }
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._displaySelection();
  },

  _selectEdge(this: CanvasEngine, edgeId: string): void {
    this._edgeSelection = [edgeId];
    this._selection = [];
    this._strokeSelection = new Set();
    this._options.onSelectionChange();
    this._displaySelection();
  },

  _clearSelection(this: CanvasEngine): void {
    this._selection = [];
    this._edgeSelection = [];
    this._strokeSelection = new Set();
    this._options.onSelectionChange();
    this._displaySelection();
  },

  /** Comincia a trascinare le schede scelte, e ciò che i gruppi scelti contengono. */
  _beginDrag(this: CanvasEngine, event: PointerEvent): void {
    if (!this._doc) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of this._selection) {
      const node = this._doc.nodes.find((n) => n.id === id);
      if (node) origin.set(id, { x: node.x, y: node.y });
    }
    // A group carries every card fully inside it. Containment is geometric,
    // not a second persisted parent relation that would conflict with Canvas.
    for (const group of this._doc.nodes.filter((node) => origin.has(node.id) && node.type === "group")) {
      for (const child of this._doc.nodes) {
        if (child.id !== group.id && child.x >= group.x && child.y >= group.y
          && child.x + child.width <= group.x + group.width
          && child.y + child.height <= group.y + group.height) {
          origin.set(child.id, { x: child.x, y: child.y });
        }
      }
    }
    const ids = this._selection.filter((id) => origin.has(id));
    this._drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ids, origin, moved: false, dx: 0, dy: 0, aimDx: 0, aimDy: 0 };
    // La cattura arriva con lo spostamento (`_moveDrag`), non qui: un clic fermo
    // resta un clic, e il suo doppio clic arriva alla scheda, non alla vista (IMP-053).
    event.preventDefault();
  },

  _beginPan(this: CanvasEngine, pointerId: number, clientX: number, clientY: number): void {
    this._pan = { pointerId, startX: clientX, startY: clientY, camX: this._camera.x, camY: this._camera.y };
    this._viewport.setPointerCapture?.(pointerId);
  },

  // --- il dito -----------------------------------------------------------------

  /** «Il dito sposta le schede», adesso. */
  _fingerMovesCard(this: CanvasEngine): boolean {
    return this._options.fingerMovesCard ? this._options.fingerMovesCard() : this._fingerMovesCardSetting;
  },

  /**
   * Un dito si posa. Il primo sposta la lavagna, anche sopra le schede, e se
   * si alza presto e vicino fa quello che fa un clic; con «Il dito sposta le
   * schede» sopra una scheda la sposta. Le maniglie (testata, ridimensiona,
   * collega) e i controlli (pulsanti, collegamenti, campi) fanno come col
   * mouse; in sola lettura le maniglie spostano la lavagna. Il secondo dito
   * comincia il pizzico, salvo durante un gesto su una scheda, che tiene il
   * dito suo. Con una penna giù il dito non fa niente, e il palmo nemmeno.
   *
   * Con «Il dito scrive» (T64) il primo dito scrive e qui non arriva: lo
   * prende lo strato della penna. Il secondo dito annulla il suo tratto (lo
   * fa la sessione della penna) e lo prende con sé: i due pizzicano.
   */
  _touchDown(this: CanvasEngine, event: PointerEvent): void {
    if (this._penDown || this._palm(event.pointerId) || this._drag || this._resize || this._connect || this._pinch) return;
    this._adopted = this._adoptWritingFingers(event.pointerId);
    this._fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._fingers.size >= 2) {
      this._beginPinch();
      event.preventDefault();
      return;
    }
    const hit = this._targetOf(event);
    const target = hit instanceof Element ? hit : null;
    // Vicino a un angolo della scelta il dito prende la maniglia (T66); un
    // controllo sotto il dito (il pulsante del filo) resta suo.
    if (!target?.closest(FINGER_CONTROLS) && this._resizeFromFinger(event)) return;
    if (target?.closest(FINGER_CONTROLS) || (!this._readOnly && target?.closest(FINGER_HANDLES))) {
      this._mouseDown(event);
      return;
    }
    const nodeId = this._nodeAt(target);
    if (nodeId && !this._readOnly && this._doc && this._fingerMovesCard()) {
      this._selectNode(nodeId, event.shiftKey);
      this._beginDrag(event);
      return;
    }
    this._tap = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, at: event.timeStamp, target, shift: event.shiftKey };
    this._beginPan(event.pointerId, event.clientX, event.clientY);
  },

  /**
   * Le dita che scrivevano (T64) e che la sessione della penna ha appena
   * fatto diventare navigazione, perché si è posato il dito `except`: da qui
   * la lavagna le segue come le sue, dal punto dove sono adesso. Un dito che
   * la lavagna non ha preso per altre ragioni (posato durante uno
   * spostamento, il palmo) non era dello strato e resta fuori.
   */
  _adoptWritingFingers(this: CanvasEngine, except: number): number[] {
    const adopted: number[] = [];
    for (const [id, touch] of this._touches) {
      if (id === except || !touch.swallowed || this._fingers.has(id)) continue;
      if (this._inkLayer?.roleOf(id) !== "navigate") continue;
      touch.swallowed = false;
      this._fingers.set(id, { x: touch.x, y: touch.y });
      adopted.push(id);
    }
    return adopted;
  },

  /** «Il dito scrive» dall'interruttore della colonna: vale subito, e si scrive nelle Impostazioni di questo computer. */
  _setFingerWrites(this: CanvasEngine, on: boolean): void {
    if (this._destroyed || on === this._fingerWritesSetting) return;
    const before = this._fingerWritesSetting;
    this._fingerWritesSetting = on;
    this._rail.sync();
    // Una scrittura che non riesce lascia il valore di prima, se nel frattempo
    // nessuno l'ha cambiato.
    saveFingerWrites(on, () => {
      if (this._destroyed || this._fingerWritesSetting !== on) return;
      this._fingerWritesSetting = before;
      this._rail.sync();
    });
  },

  /**
   * Il dito `pointerId` è il palmo: lo decide la sessione della penna
   * (`ink/input/roles.ts`), che fa palmo ogni dito con una penna giù o
   * sospesa, e le dita già giù quando la penna arriva. Senza lo strato (sola
   * lettura) non c'è penna che scriva, e nessun dito è palmo.
   */
  _palm(this: CanvasEngine, pointerId: number): boolean {
    return this._inkLayer?.roleOf(pointerId) === "ignore";
  },

  /** Le prime due dita giù diventano un pizzico: il pan e il tocco breve finiscono. */
  _beginPinch(this: CanvasEngine): void {
    const [a, b] = [...this._fingers.keys()];
    if (a === undefined || b === undefined) return;
    this._pan = null;
    this._tap = null;
    this._pinch = { a, b, a0: this._local(this._fingers.get(a)!), b0: this._local(this._fingers.get(b)!), start: { ...this._camera } };
    this._viewport.setPointerCapture?.(b);
  },

  /** Un punto del client in coordinate del viewport. */
  _local(this: CanvasEngine, point: TouchPoint): TouchPoint {
    const rect = this._viewport.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  },

  /** Un dito si muove: `true` se l'ha preso il dito, `false` se tocca al gesto comune. */
  _touchMove(this: CanvasEngine, event: PointerEvent): boolean {
    if (!this._fingers.has(event.pointerId)) return true;
    this._fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // La penna vince, giù o sospesa: il dito si ferma, e una scheda che
    // spostava torna dov'era.
    if (this._penDown || this._palm(event.pointerId)) {
      this._cancelGestures();
      return true;
    }
    const pinch = this._pinch;
    if (pinch) {
      const a = this._fingers.get(pinch.a);
      const b = this._fingers.get(pinch.b);
      if (a && b && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
        this._camera = { ...pinchCamera(pinch.start, pinch.a0, pinch.b0, this._local(a), this._local(b), ZOOM_LIMITS) };
        this._applyCamera();
      }
      return true;
    }
    const tap = this._tap;
    if (tap?.pointerId === event.pointerId && !isTap(tap.startX, tap.startY, event.clientX, event.clientY, 0)) this._tap = null;
    return false;
  },

  /**
   * Un dito si alza: `true` se l'ha preso il dito. Dal pizzico, il dito che
   * resta sposta la lavagna; un tocco breve fa quello che fa un clic.
   */
  _touchUp(this: CanvasEngine, event: PointerEvent): boolean {
    if (!this._fingers.delete(event.pointerId)) return true;
    const pinch = this._pinch;
    if (pinch) {
      if (event.pointerId !== pinch.a && event.pointerId !== pinch.b) return true;
      this._pinch = null;
      const rest = [...this._fingers][0];
      if (rest) this._beginPan(rest[0], rest[1].x, rest[1].y);
      return true;
    }
    const tap = this._tap;
    if (tap?.pointerId !== event.pointerId) return false;
    this._tap = null;
    this._pan = null;
    if (isTap(tap.startX, tap.startY, event.clientX, event.clientY, event.timeStamp - tap.at)) this._tapAt(tap.target, tap.shift);
    return true;
  },

  /** Il tocco breve su `target`: sceglie come il clic del mouse. */
  _tapAt(this: CanvasEngine, target: Element | null, additive: boolean): void {
    if (!target?.isConnected) return;
    const nodeId = this._nodeAt(target);
    if (nodeId) {
      this._selectNode(nodeId, additive);
      return;
    }
    const edgeId = this._edgeAt(target);
    if (edgeId) this._selectEdge(edgeId);
    else if (!additive) this._clearSelection();
  },

  /**
   * La penna si appoggia col tasto laterale (`canvas.pen_button`): apre il
   * menu radiale, che la segue finché il tasto è giù; o sposta la lavagna; o
   * fa un giro di Lazo che sceglie come lo strumento Lazo, e lo strumento di
   * prima resta. Con `eraser` cancella lo strato della penna, e qui non
   * arriva. I movimenti e il rilascio sono quelli di ogni puntatore.
   */
  _barrelDown(this: CanvasEngine, event: PointerEvent): void {
    const action = this._penButtonSetting;
    if (this._destroyed || !this._doc || action === "eraser") return;
    this._menuHeld = event.pointerId;
    this._recordPending();
    if (action === "radial") {
      this._openRadial(event.clientX, event.clientY, { pointerType: "pen", pointerId: event.pointerId });
    } else if (action === "pan") {
      this._beginPan(event.pointerId, event.clientX, event.clientY);
    } else if (!this._isSceneOversized()) {
      this._selectionBar.hide();
      this._beginLasso(event);
    }
  },

  /**
   * Un puntatore si alza o si perde, ovunque. Quello che aveva preso un gesto
   * della lavagna (il tasto laterale, il tocco lungo) lascia dietro di sé, per
   * poco, il silenzio del menu del sistema. Un dito alzato fuori dalla vista
   * chiude il suo tocco, che non è più un tocco.
   */
  _pointerEnded(this: CanvasEngine, event: PointerEvent): void {
    this._pointerLeft(event);
    if (event.pointerType === "touch" && !(event.target instanceof Node && this._viewport.contains(event.target))) {
      this._gestureUp(event, true);
    }
  },

  /**
   * Il puntatore `event` si è alzato davvero: il rilascio vero, dal documento,
   * prima della vista. Si toglie dal ricordo (`_pressed`), dalle dita che il
   * tocco teneva e dal menu che aveva aperto. Una chiusura senza rilascio non
   * lo chiama: un dito che ha perso la cattura può essere ancora giù.
   */
  _pointerLeft(this: CanvasEngine, event: PointerEvent): void {
    this._pressed.delete(event.pointerId);
    if (event.pointerType === "touch") this._touches.delete(event.pointerId);
    this._menuLet(event.pointerId);
  },

  /** Il menu che il puntatore `pointerId` teneva non è più suo: il silenzio del menu di sistema resta per poco (`MENU_ECHO_MS`). */
  _menuLet(this: CanvasEngine, pointerId: number): void {
    if (pointerId !== this._menuHeld) return;
    this._menuHeld = null;
    this._menuEchoUntil = performance.now() + MENU_ECHO_MS;
  },

  /**
   * Un movimento di un puntatore premuto: ne ricorda il punto. Senza tasto, il
   * rilascio non è arrivato (il browser l'ha perso, o è caduto fuori dalla
   * finestra): la pressione è finita e il gesto del puntatore si chiude adesso
   * (T20a). Il dito no: non ha un tasto da lasciare, e il suo contatto lo
   * chiudono il rilascio, il `pointercancel` o la finestra.
   */
  _pointerMoved(this: CanvasEngine, event: PointerEvent): void {
    const seen = this._pressed.get(event.pointerId);
    if (seen === undefined) return;
    seen.last = event;
    if (event.buttons === 0 && seen.held && event.pointerType !== "touch") {
      seen.held = false;
      this._gestureLost(event);
    }
  },

  /**
   * Il gesto di `event` si chiude senza il suo rilascio, con l'ultimo evento
   * del puntatore: un movimento senza tasto, o la cattura persa (solo col mouse
   * e la penna: il browser e lo strato della penna tolgono la cattura a un dito
   * che passa a scrivere o a far da navigazione, T64), o la finestra che perde
   * il fuoco. Passa dalla stessa fine del rilascio (`_gestureEnd`) e non fa
   * niente se il gesto non c'è più: un rilascio che arriva dopo non trova niente
   * da chiudere. Il ricordo del puntatore (`_pressed`, `_touches`) resta, perché
   * il suo rilascio vero lo toglie.
   */
  _gestureLost(this: CanvasEngine, event: PointerEvent): void {
    if (!this._gestureOpen(event.pointerId)) return;
    // Il menu radiale che il puntatore teneva si chiude con lui: senza rilascio
    // non c'è una voce su cui si è alzato, e nessuna si sceglie.
    const menu = this._menuHeld === event.pointerId;
    this._gestureEnd(event, true);
    this._menuLet(event.pointerId);
    if (menu) this._radial?.close();
    if (this._viewport.hasPointerCapture?.(event.pointerId)) this._viewport.releasePointerCapture(event.pointerId);
  },

  /** La finestra perde il fuoco: ogni puntatore premuto si chiude come se si fosse alzato (`_gestureLost`). */
  _gesturesLost(this: CanvasEngine): void {
    for (const { last } of [...this._pressed.values()]) this._gestureLost(last);
  },

  /**
   * Un gesto della lavagna è aperto per il puntatore `pointerId`: lo spostamento
   * della vista, il trascinamento di una scheda o di un tratto del Lazo, il
   * ridimensionamento, il filo, il giro del Lazo, il rettangolo della Selezione
   * (N6 T20b), il pizzico e il dito, il tocco lungo, il menu radiale che il
   * puntatore tiene. Il tratto della penna no:
   * lo tiene l'adattatore dell'inchiostro (`ink/dom/pointer-adapter.ts`), che
   * lo annulla alla cattura persa e alla finestra.
   */
  _gestureOpen(this: CanvasEngine, pointerId: number): boolean {
    return this._pan?.pointerId === pointerId || this._tap?.pointerId === pointerId
      || this._drag?.pointerId === pointerId || this._resize?.pointerId === pointerId
      || this._connect?.pointerId === pointerId || this._lasso?.pointerId === pointerId
      || this._marquee?.pointerId === pointerId
      || this._strokeDrag?.pointerId === pointerId || this._edgeScroll?.pointerId === pointerId
      || this._longPress?.pointerId === pointerId || this._pinch?.a === pointerId || this._pinch?.b === pointerId
      || this._fingers.has(pointerId) || this._menuHeld === pointerId;
  },

  /**
   * Un dito si posa, dopo ciò che il dito fa di suo (`_touchDown`): comincia
   * o cresce un tocco di più dita e, se è il primo e si ferma lì, il tocco
   * lungo. Con la penna giù o col palmo non è un tocco.
   */
  _gestureDown(this: CanvasEngine, event: PointerEvent): void {
    const point = { x: event.clientX, y: event.clientY };
    const hit = this._targetOf(event);
    const target = hit instanceof Element ? hit : null;
    // Le dita che scrivevano, prese da questo (T64), sono nel tocco dal loro
    // appoggio: un dito che ha già scritto più in là non fa un tocco.
    const adopted = this._adopted.flatMap((id) => {
      const touch = this._touches.get(id);
      return touch ? [[id, touch] as const] : [];
    });
    this._adopted = [];
    const start = Math.min(event.timeStamp, ...adopted.map(([, touch]) => touch.at));
    const taps = this._fingerTap ??= { down: new Map(), first: point, most: 0, start, spoiled: false, target };
    for (const [id, touch] of adopted) {
      taps.down.set(id, { x: touch.startX, y: touch.startY });
      if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > TAP_SLOP_PX) taps.spoiled = true;
    }
    taps.down.set(event.pointerId, point);
    taps.most = Math.max(taps.most, taps.down.size);
    if (this._penDown || this._palm(event.pointerId)) taps.spoiled = true;
    // Il secondo dito: è un pizzico o un tocco di più dita, non un tocco lungo.
    this._cancelLongPress();
    if (taps.down.size === 1 && !taps.spoiled && this._fingers.has(event.pointerId) && this._longPressHere(target)) {
      const timer = setTimeout(() => this._longPressFire(), LONG_PRESS_MS);
      this._longPress = { pointerId: event.pointerId, x: point.x, y: point.y, target, timer };
    }
  },

  /** Dove il tocco lungo vale: sulla lavagna e sulle schede, non sui controlli né dentro la scheda in cui si scrive. */
  _longPressHere(this: CanvasEngine, target: Element | null): boolean {
    if (!target || !this._viewport.contains(target) || target.closest(FINGER_CONTROLS)) return false;
    if (this._resize !== null || this._connect !== null) return false;
    return !(this._activeId !== null && this._insideActive(target, false));
  },

  /**
   * Un dito si muove: oltre `TAP_SLOP_PX` dal suo appoggio non è più un tocco
   * né un tocco lungo (due dita che si muovono sono un pizzico). Solo un
   * confronto di distanza per evento.
   */
  _gestureMove(this: CanvasEngine, event: PointerEvent): void {
    const taps = this._fingerTap;
    if (!taps || (taps.spoiled && this._longPress === null)) return;
    const from = taps.down.get(event.pointerId);
    if (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) <= TAP_SLOP_PX) return;
    taps.spoiled = true;
    if (this._longPress?.pointerId === event.pointerId) this._cancelLongPress();
  },

  /** Il tocco lungo che aspetta si ferma, col suo timer. */
  _cancelLongPress(this: CanvasEngine): void {
    const press = this._longPress;
    if (!press) return;
    this._longPress = null;
    clearTimeout(press.timer);
  },

  /**
   * Il dito è rimasto fermo `LONG_PRESS_MS`: sopra una scheda il suo menu
   * (lo stesso del tasto destro, nel punto del dito), altrove il menu
   * radiale, che segue il dito finché non si alza. Il gesto del dito si
   * ferma dov'era. La penna giù, o il dito diventato palmo, vincono.
   */
  _longPressFire(this: CanvasEngine): void {
    const press = this._longPress;
    this._longPress = null;
    if (!press || this._destroyed || !this._doc) return;
    if (this._penDown || this._palm(press.pointerId) || !this._fingers.has(press.pointerId)) return;
    this._lastTap = null;
    this._cancelGestures();
    this._menuHeld = press.pointerId;
    const target = press.target;
    if (target?.isConnected && this._nodeAt(target) !== null) {
      const menu = new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, composed: true, clientX: press.x, clientY: press.y, button: 2,
      });
      this._ownMenu = menu;
      try {
        target.dispatchEvent(menu);
      } finally {
        this._ownMenu = null;
      }
      return;
    }
    this._openRadial(press.x, press.y, { pointerType: "touch", pointerId: press.pointerId });
  },

  /**
   * Un dito si alza (o si perde: `cancelled`). Quando si è alzato l'ultimo:
   * due dita che non si sono mosse, entro `FINGERS_TAP_MS` dal primo
   * appoggio, annullano; tre ripetono. Un dito solo nel vuoto, due volte
   * vicino e presto, mette lì una scheda di testo già in scrittura.
   */
  _gestureUp(this: CanvasEngine, event: PointerEvent, cancelled: boolean): void {
    if (this._longPress?.pointerId === event.pointerId) this._cancelLongPress();
    const taps = this._fingerTap;
    if (!taps || !taps.down.has(event.pointerId)) return;
    if (cancelled || this._penDown) taps.spoiled = true;
    taps.down.delete(event.pointerId);
    if (taps.down.size > 0) return;
    this._fingerTap = null;
    const ms = event.timeStamp - taps.start;
    if (taps.spoiled || taps.most > 3) {
      this._lastTap = null;
      return;
    }
    if (taps.most >= 2) {
      this._lastTap = null;
      if (ms <= FINGERS_TAP_MS) this._fingersTapped(taps.most === 2 ? "undo" : "redo");
      return;
    }
    if (ms > TAP_MAX_MS || !this._emptyAt(taps.target)) {
      this._lastTap = null;
      return;
    }
    const last = this._lastTap;
    if (last && taps.start - last.at <= DOUBLE_TAP_MS && Math.hypot(taps.first.x - last.x, taps.first.y - last.y) <= DOUBLE_TAP_PX) {
      this._lastTap = null;
      this._placeText(taps.first.x, taps.first.y, undefined, true);
      return;
    }
    this._lastTap = { x: taps.first.x, y: taps.first.y, at: event.timeStamp };
  },

  /** Il vuoto della lavagna sotto `target`: niente schede, fili, maniglie o controlli, e la lavagna si cambia. */
  _emptyAt(this: CanvasEngine, target: Element | null): boolean {
    if (!target?.isConnected || !this._viewport.contains(target) || this._readOnly || this._isSceneOversized()) return false;
    return this._emptyTarget(target);
  },

  /** `target` non è una scheda, un filo, una maniglia né un controllo: la regola del doppio tocco e del doppio clic. */
  _emptyTarget(this: CanvasEngine, target: Element): boolean {
    return this._nodeAt(target) === null && this._edgeAt(target) === null
      && target.closest(FINGER_CONTROLS) === null && target.closest(FINGER_HANDLES) === null;
  },

  /** Il tocco di due dita annulla, quello di tre ripete; se non c'è niente, lo dice. */
  _fingersTapped(this: CanvasEngine, command: "undo" | "redo"): void {
    const can = !this._readOnly && (command === "undo" ? this._undo.length > 0 || this._pending !== null : this._redo.length > 0);
    if (!can) {
      this._sayGesture(t(command === "undo" ? "canvas.gesture.no_undo" : "canvas.gesture.no_redo"));
      return;
    }
    if (command === "undo") this.undo();
    else this.redo();
    this._statusSettle();
  },

  /**
   * La regione viva della tela: dice al lettore di schermo ciò che un gesto
   * non ha fatto (T63), ciò che un commit ha cambiato e la scheda che da una
   * parte non c'è (T61). La stessa frase si ridice: uno spazio fermo in coda,
   * alterno, la fa annunciare di nuovo.
   */
  _sayGesture(this: CanvasEngine, text: string): void {
    if (this._destroyed) return;
    let said = this._gestureSaid;
    if (!said) {
      said = document.createElement("div");
      said.className = "sr-only canvas-gesture-said";
      said.setAttribute("role", "status");
      said.setAttribute("aria-live", "polite");
      this._root.append(said);
      this._gestureSaid = said;
    }
    this._gestureEcho = !this._gestureEcho;
    said.textContent = this._gestureEcho ? text : `${text} `;
  },
};
export type PointerMethods = typeof pointerMethods;
