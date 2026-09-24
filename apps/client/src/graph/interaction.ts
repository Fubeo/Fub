// Tutta l'interazione del grafo: puntatore (hover, drag, pan, zoom, click) e
// tastiera (focus nodi, frecce, fit, apertura). Il wiring vive su Pointer
// Events unificati con `setPointerCapture`, così mouse, penna e tocco passano
// da un solo codice.
//
// Il file ha due strati, come il resto del lotto:
// - `nodeAt` e `aggiornaDrag` sono pure: niente DOM, niente Canvas2D — è ciò
//   che i test esercitano (l'hit-test in screen space con scala ≠ 1 era il
//   bug del codice di prima, che confrontava coordinate mondo e schermo
//   senza convertire).
// - `creaInterazione` incolla le pure agli eventi reali del canvas.
//
// I bug dei report chiusi qui:
// - 2-2: `pointerleave` azzera `hovered` e il cursore — l'highlight non
//   resta orfano quando il puntatore esce dal canvas.
// - 2-4 / S5-3: `tabindex=0` + `role="application"` + `aria-label`
//   iniettabile e un percorso tastiera completo (frecce, +/−, F, Invio, Esc,
//   P) — il grafo non è più una superficie solo-mouse.
//
// Niente i18n qui: ogni stringa mostrata all'utente arriva da un parametro
// (`setA11yLabel`), perché i test non devono conoscere le lingue.

import type { Camera, CameraState, Point, WorldBound } from "./render/camera";
import { screenToWorld } from "./render/camera";
import type { Structure } from "./sim/types";

export interface InteractionActions {
  open(id: string): void;
  warm(level: number): void;
  requestRedraw(): void;
}

export interface InteractionOptions {
  canvas: HTMLCanvasElement;
  structureRef: () => Structure;
  cameraState: CameraState;
  actions: InteractionActions;
  isVisible?: (index: number) => boolean;
}

export interface Interaction {
  destroy(): void;
  setA11yLabel(text: string): void;
  focusedNode(i: number): void;
  /// Il nodo selezionato da tastiera: l'orchestratore lo incolla in
  /// `DrawState.focused`, così il pittore lo tratta come focus
  /// senza che l'interazione conosca il pittore.
  getFocusedNode(): number;
}

/// Hit-test in screen space: il nodo va convertito in coordinate schermo
/// (x·scala + t) prima di misurare la distanza, e la soglia è `r·scale + 6`
/// — 6 px di tolleranza **di schermo**, non di mondo. Senza la scala il
/// hit-test era giusto solo a scala 1 e il click mancava i nodi zoommati.
/// Ritorna l'indice del nodo più vicino entro soglia, −1 se nessuno.
export function nodeAt(s: Structure, c: Camera, x: number, y: number, isVisible?: (index: number) => boolean): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < s.n; i++) {
    if (isVisible && !isVisible(i)) continue;
    const dx = s.x[i] * c.scale + c.tx - x;
    const dy = s.y[i] * c.scale + c.ty - y;
    const threshold = s.radius[i] * c.scale + 6;
    const d2 = dx * dx + dy * dy;
    if (d2 < threshold * threshold && d2 < bestD) {
      best = i;
      bestD = d2;
    }
  }
  return best;
}

/// Lo stato della macchina a stati del puntatore. `pinMap` (quale `fixed`
/// aveva il nodo prima del drag) vive nel wiring: dipende dalla struttura
/// reale, che la macchina pura non tocca.
export interface DragState {
  hovered: number;
  dragged: number;
  draggingEmpty: boolean;
  lastX: number;
  lastY: number;
}

export function initialDragState(): DragState {
  return { hovered: -1, dragged: -1, draggingEmpty: false, lastX: 0, lastY: 0 };
}

export interface DragEvent {
  type: "down" | "move" | "up" | "leave";
  x: number;
  y: number;
  button: number;
}

export interface DragResult {
  state: DragState;
  /// Delta di schermo accumulato dal pan a vuoto (da applicare alla camera).
  panDx: number;
  panDy: number;
  /// Nuovo bersaglio mondo del nodo trascinato (da scrivere in px/py).
  target: Point | null;
}

/// La macchina a stati del puntatore, pura e testabile da sola. Consuma
/// eventi e produce il prossimo stato più i delta da applicare fuori (camera
/// per il pan, struttura per il drag). Il wiring si occupa solo di eseguirli.
export function updateDrag(
  prev: DragState,
  ev: DragEvent,
  hit: (x: number, y: number) => number,
  s2m: (x: number, y: number) => Point,
): DragResult {
  const st: DragState = { ...prev };
  let panDx = 0;
  let panDy = 0;
  let target: Point | null = null;
  if (ev.type === "down" && st.dragged < 0 && !st.draggingEmpty) {
    if (ev.button === 1) {
      // Tasto centrale: pan anche sopra un nodo (il piano §6 lo riserva al
      // pan; il primario sopra un nodo trascina, sopra il vuoto pana).
      st.draggingEmpty = true;
    } else if (ev.button === 0) {
      const i = hit(ev.x, ev.y);
      if (i >= 0) {
        st.dragged = i;
        st.hovered = -1;
      } else {
        st.draggingEmpty = true;
      }
    }
  } else if (ev.type === "move") {
    if (st.dragged >= 0) {
      target = s2m(ev.x, ev.y);
    } else if (st.draggingEmpty) {
      panDx = ev.x - st.lastX;
      panDy = ev.y - st.lastY;
    } else {
      st.hovered = hit(ev.x, ev.y);
    }
  } else if (ev.type === "up") {
    if (st.dragged >= 0) st.dragged = -1;
    if (st.draggingEmpty) st.draggingEmpty = false;
  } else if (ev.type === "leave") {
    // Bug 2-2: uscire dal canvas è il segnale canonico «non c'è più nessun
    // nodo sotto». Non tocca il drag: con setPointerCapture il leave non
    // arriva durante un drag, ma se arrivasse non deve spezzarlo. E non
    // aggiorna la base del pan: le coordinate (0,0) del leave sono finte, e
    // spostare lì `lastX/Y` farebbe slittare il pan al rientro nel canvas.
    if (st.dragged < 0 && !st.draggingEmpty) st.hovered = -1;
    return { state: st, panDx: 0, panDy: 0, target: null };
  }
  st.lastX = ev.x;
  st.lastY = ev.y;
  return { state: st, panDx, panDy, target };
}

/// Il nodo più vicino al focalizzato nella direzione (dx, dy) di una freccia:
/// la scelta del «nearest» è il coseno dell'angolo col vettore — il nodo che
/// sta più sulla linea della freccia, non il più vicino in assoluto.
function nodeInDirection(s: Structure, i: number, dx: number, dy: number, isVisible: (index: number) => boolean): number {
  let best = -1;
  let bestCos = -Infinity;
  const xf = s.x[i];
  const yf = s.y[i];
  for (let k = 0; k < s.n; k++) {
    if (k === i) continue;
    if (!isVisible(k)) continue;
    const vx = s.x[k] - xf;
    const vy = s.y[k] - yf;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) continue;
    const cos = (vx * dx + vy * dy) / len;
    if (cos > bestCos) {
      bestCos = cos;
      best = k;
    }
  }
  return best;
}

/// I versori delle frecce, in una tabella statica: la tastiera è un dominio
/// chiuso, non serve una mappa dinamica.
const ARROW_DIRECTIONS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/// Bounds del mondo occupato dai nodi. Con zero nodi non esistono bounds
/// sensati: un quadrato di comodo evita di mandare `Infinity` dentro
/// `fit`, che produrrebbe NaN.
function worldBounds(s: Structure): WorldBound {
  if (s.n === 0) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < s.n; i++) {
    if (s.x[i] < minX) minX = s.x[i];
    if (s.y[i] < minY) minY = s.y[i];
    if (s.x[i] > maxX) maxX = s.x[i];
    if (s.y[i] > maxY) maxY = s.y[i];
  }
  return { minX, minY, maxX, maxY };
}

/// Il drag è un gesto, non un click: oltre 5 px di spostamento il click
/// nativo che segue un drag non deve aprire una nota.
const CLICK_THRESHOLD_PX = 5;
/// Prima di aprire su click si aspetta questo tempo: se arriva un dblclick
/// (pin + centra), l'apertura viene cancellata — altrimenti il doppio click
/// su un nodo aprirebbe la nota due volte.
const CLICK_DELAY_MS = 250;
const KEYBOARD_PAN_PX = 40;
const KEYBOARD_ZOOM = 1.2;
/// Un nodo si afferra solo dopo questo spostamento: sotto, il gesto è un
/// click, e il nodo non deve sussultare né scaldare il grafo.
const GRAB_THRESHOLD_PX = 3;
/// Quanta velocità conserva un nodo lasciato andare. Il drag lo muove con la
/// molla del puntatore (v = Δ/dt), e lasciargliela tutta lo lanciava
/// attraverso il grafo a ogni rilascio.
const RELEASE_KEEP = 0.2;
/// La finestra su cui si misura la velocità del pan al rilascio, e la pausa
/// oltre la quale il rilascio è da fermo (niente inerzia).
const FLING_WINDOW_MS = 90;
const FLING_IDLE_MS = 60;
/// Sensibilità della rotella per pixel di scorrimento; il pinch del trackpad
/// (rotella con Ctrl) dà delta piccoli e ne vuole di più. Il fattore di un
/// singolo evento è limitato: un colpo di rotella «a scatti» non deve
/// catapultare la vista.
const WHEEL_ZOOM_PER_PX = 0.0015;
const PINCH_ZOOM_PER_PX = 0.01;
const WHEEL_STEP_MAX = 0.5;
const WHEEL_LINE_PX = 16;

export function createInteraction(options: InteractionOptions): Interaction {
  const { canvas, structureRef, cameraState, actions, isVisible = () => true } = options;

  const s2m = (x: number, y: number): Point => screenToWorld(cameraState.state(), { x, y });
  const hit = (x: number, y: number): number => nodeAt(structureRef(), cameraState.state(), x, y, isVisible);
  const viewport = (): { w: number; h: number } => {
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };
  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const timeOf = (e: { timeStamp?: number }): number =>
    typeof e.timeStamp === "number" && e.timeStamp > 0 ? e.timeStamp : performance.now();
  const samplePan = (t: number, p: Point): void => {
    panSamples.push({ t, x: p.x, y: p.y });
    while (panSamples.length > 2 && t - panSamples[0].t > FLING_WINDOW_MS) panSamples.shift();
  };
  /// La velocità del pan (px/ms) sugli ultimi campioni, zero se il puntatore
  /// si era fermato prima di rilasciare.
  const panVelocity = (t: number): Point => {
    const first = panSamples[0];
    const last = panSamples[panSamples.length - 1];
    if (!first || !last || t - last.t > FLING_IDLE_MS) return { x: 0, y: 0 };
    const span = last.t - first.t;
    if (span < 8) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / span, y: (last.y - first.y) / span };
  };

  let state = initialDragState();
  let focused = -1;
  /// Il `fixed` che aveva il nodo prima del drag: al rilascio torna quello
  /// (un pin esplicito non deve essere mangiato da un trascinamento).
  const pinMap = new Map<number, number>();
  /// I pointer attualmente giù, per il pinch a due dita. Map perché i
  /// pointer sono chiavi dinamiche (inserzione/rimozione runtime).
  const activePointers = new Map<number, Point>();
  /// Base del pinch: distanza tra le due dita alla seconda discesa e scala
  /// di partenza. Il fattore di zoom è distanza attuale / distanza base.
  let pinchBase: { distance: number; centerX: number; centerY: number } | null = null;
  let downX = 0;
  let downY = 0;
  /// Il nodo sotto il puntatore è stato afferrato davvero (oltre la soglia)?
  /// Fino ad allora il pointerdown su un nodo è solo un click possibile.
  let grabbing = false;
  /// Dove il nodo sta rispetto al punto afferrato, in coordinate mondo: il
  /// nodo si trascina da lì, invece di saltare col centro sotto il cursore.
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  /// Gli ultimi punti del pan, per la velocità al rilascio.
  const panSamples: Array<{ t: number; x: number; y: number }> = [];
  let clickTimeout: ReturnType<typeof setTimeout> | undefined;
  let pendingClick = -1;
  let a11yLabel = "";

  // Superficie tastierabile e annunciabile (bug 2-4 / S5-3): senza questi tre
  // attributi il canvas è invisibile a screen reader e irraggiungibile da
  // tastiera, mentre il resto della shell è presidiato.
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", a11yLabel);

  // Rilascio della presa corrente: ripristina il `fixed` che il nodo aveva
  // prima del drag (pinMappa), riaccende la sim e pulisce il cursore. La
  // usa `onPointerUp` e il pinch, che smonta il drag del primo dito quando
  // arriva il secondo.
  const releaseGrip = (at?: number): void => {
    const s = structureRef();
    if (state.dragged >= 0) {
      const i = state.dragged;
      if (grabbing) {
        s.fixed[i] = pinMap.get(i) ?? 0;
        s.dragged = -1;
        // Il nodo resta dove è stato lasciato e con poca della velocità del
        // gesto: si scalda la sim perché i vicini si riassestino attorno a lui.
        s.vx[i] *= RELEASE_KEEP;
        s.vy[i] *= RELEASE_KEEP;
        actions.warm(0.3);
      }
      pinMap.delete(i);
      grabbing = false;
      canvas.style.cursor = state.hovered >= 0 ? "pointer" : "default";
    } else if (state.draggingEmpty) {
      canvas.style.cursor = "default";
      if (at !== undefined) {
        const v = panVelocity(at);
        if (v.x !== 0 || v.y !== 0) cameraState.fling(v.x, v.y);
      }
      panSamples.length = 0;
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = localPoint(e);
    activePointers.set(e.pointerId, p);
    // Secondo dito sul touch: si smonta drag/pan del primo e parte il pinch.
    // Il pinch è zoom sul punto medio delle dita, con fattore pari al
    // rapporto tra distanza attuale e distanza alla discesa del secondo dito.
    if (activePointers.size >= 2) {
      releaseGrip();
      state = initialDragState();
      const pts = [...activePointers.values()];
      pinchBase = {
        distance: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        centerX: (pts[0].x + pts[1].x) / 2,
        centerY: (pts[0].y + pts[1].y) / 2,
      };
      actions.requestRedraw();
      return;
    }
    const result = updateDrag(state, { type: "down", x: p.x, y: p.y, button: e.button }, hit, s2m);
    state = result.state;
    // Base per il confronto click/drag: se il pointer si sposta oltre la
    // soglia prima dell'up, il click non scatta.
    downX = p.x;
    downY = p.y;
    if (state.dragged >= 0) {
      // Il nodo non si prende ancora: lo si prenderà al primo spostamento
      // oltre la soglia (`grab`). Qui si ricorda soltanto da dove.
      const i = state.dragged;
      const s = structureRef();
      pinMap.set(i, s.fixed[i]);
      const m = s2m(p.x, p.y);
      grabOffsetX = s.x[i] - m.x;
      grabOffsetY = s.y[i] - m.y;
      grabbing = false;
      if (typeof canvas.setPointerCapture === "function") canvas.setPointerCapture(e.pointerId);
    } else if (state.draggingEmpty) {
      canvas.style.cursor = "grabbing";
      panSamples.length = 0;
      samplePan(timeOf(e), p);
      if (typeof canvas.setPointerCapture === "function") canvas.setPointerCapture(e.pointerId);
    }
    actions.requestRedraw();
  };

  const onPointerMove = (e: PointerEvent): void => {
    const p = localPoint(e);
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, p);
    if (pinchBase) {
      // Zoom sul punto medio: il fattore è il rapporto delle distanze, così
      // il pinch scala in modo simmetrico e resta ancorato alle dita.
      const pts = [...activePointers.values()];
      if (pts.length >= 2) {
        const distance = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const centerX = (pts[0].x + pts[1].x) / 2;
        const centerY = (pts[0].y + pts[1].y) / 2;
        cameraState.zoom(distance / pinchBase.distance, centerX, centerY);
        pinchBase = { distance, centerX, centerY };
      }
      actions.requestRedraw();
      return;
    }
    const first = state;
    const result = updateDrag(state, { type: "move", x: p.x, y: p.y, button: 0 }, hit, s2m);
    state = result.state;
    if (state.dragged >= 0 && result.target) {
      const s = structureRef();
      const i = state.dragged;
      if (!grabbing && Math.hypot(p.x - downX, p.y - downY) > GRAB_THRESHOLD_PX) {
        // Presa: da qui la molla del puntatore guida il nodo, che il motore
        // sente solo a sim sveglia — la si risveglia.
        grabbing = true;
        s.dragged = i;
        s.fixed[i] = 2;
        canvas.style.cursor = "grabbing";
      }
      if (grabbing) {
        s.px[i] = result.target.x + grabOffsetX;
        s.py[i] = result.target.y + grabOffsetY;
        actions.warm(0.3);
      }
    } else if (state.draggingEmpty) {
      if (result.panDx !== 0 || result.panDy !== 0) cameraState.pan(result.panDx, result.panDy);
      samplePan(timeOf(e), p);
    } else if (state.hovered !== first.hovered) {
      canvas.style.cursor = state.hovered >= 0 ? "pointer" : "default";
    }
    actions.requestRedraw();
  };

  const onPointerUp = (e: PointerEvent): void => {
    const p = localPoint(e);
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchBase = null;
    // Prima si rilascia la presa, poi si aggiorna la macchina: `aggiornaDrag`
    // con "up" azzera `dragged`/`draggingEmpty` nello stato, e
    // `rilasciaPresa` legge da lì l'indice del nodo da sbloccare.
    const activeGrip = state.dragged >= 0 || state.draggingEmpty;
    if (activeGrip) releaseGrip(timeOf(e));
    const result = updateDrag(state, { type: "up", x: p.x, y: p.y, button: e.button }, hit, s2m);
    state = result.state;
    actions.requestRedraw();
  };

  const onPointerLeave = (): void => {
    const first = state;
    const result = updateDrag(state, { type: "leave", x: 0, y: 0, button: 0 }, hit, s2m);
    state = result.state;
    if (state.hovered !== first.hovered) {
      canvas.style.cursor = "default";
      actions.requestRedraw();
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = localPoint(e);
    // Il delta in pixel, qualunque unità abbia scelto il browser: Firefox
    // conta righe, qualche mouse pagine.
    const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? viewport().h : 1;
    const perPx = e.ctrlKey ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX;
    const step = Math.max(-WHEEL_STEP_MAX, Math.min(WHEEL_STEP_MAX, -e.deltaY * unit * perPx));
    cameraState.zoom(Math.exp(step), p.x, p.y);
    actions.requestRedraw();
  };

  const onClick = (e: MouseEvent): void => {
    const p = localPoint(e);
    if (Math.hypot(p.x - downX, p.y - downY) > CLICK_THRESHOLD_PX) return;
    // Il nodo si decide adesso, sotto il puntatore: fra un quarto di secondo
    // il grafo può essersi mosso, e il click aprirebbe il vicino.
    pendingClick = hit(p.x, p.y);
    clearTimeout(clickTimeout);
    clickTimeout = setTimeout(() => {
      const i = pendingClick;
      pendingClick = -1;
      if (i >= 0 && i < structureRef().n) {
        // Il click è anche un focus: chi arriva da tastiera dopo un click
        // trova il nodo già focalizzato e può riaprirlo con Invio.
        focused = i;
        actions.open(structureRef().id[i]);
        actions.requestRedraw();
      }
    }, CLICK_DELAY_MS);
  };

  const onDoubleClick = (e: MouseEvent): void => {
    clearTimeout(clickTimeout);
    clickTimeout = undefined;
    pendingClick = -1;
    const p = localPoint(e);
    const i = hit(p.x, p.y);
    if (i >= 0) {
      const s = structureRef();
      // Pin: doppio click blocca il nodo, un altro lo sblocca. Il pin è un
      // impegno dell'utente, non uno stato del motore: va salvato e
      // rispettato dal drag (pinMappa).
      s.fixed[i] = s.fixed[i] === 1 ? 0 : 1;
      cameraState.centerOn(s.x[i], s.y[i], 1.6, viewport());
    } else {
      cameraState.fit(worldBounds(structureRef()), viewport());
    }
    actions.requestRedraw();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k in ARROW_DIRECTIONS) {
      const [dx, dy] = ARROW_DIRECTIONS[k];
      if (focused >= 0) {
        const newItem = nodeInDirection(structureRef(), focused, dx, dy, isVisible);
        if (newItem >= 0) {
          focused = newItem;
        }
      } else {
        cameraState.pan(dx * KEYBOARD_PAN_PX, dy * KEYBOARD_PAN_PX);
      }
      e.preventDefault();
      actions.requestRedraw();
    } else if (k === "+" || k === "=") {
      cameraState.zoom(KEYBOARD_ZOOM, viewport().w / 2, viewport().h / 2);
      e.preventDefault();
      actions.requestRedraw();
    } else if (k === "-") {
      cameraState.zoom(1 / KEYBOARD_ZOOM, viewport().w / 2, viewport().h / 2);
      e.preventDefault();
      actions.requestRedraw();
    } else if (k === "f" || k === "F") {
      cameraState.fit(worldBounds(structureRef()), viewport());
      e.preventDefault();
      actions.requestRedraw();
    } else if (k === "Enter") {
      if (focused >= 0) {
        actions.open(structureRef().id[focused]);
        actions.requestRedraw();
      }
      e.preventDefault();
    } else if (k === "Escape") {
      if (focused >= 0) {
        focused = -1;
        actions.requestRedraw();
      }
      e.preventDefault();
    } else if (k === "p" || k === "P") {
      if (focused >= 0) {
        const s = structureRef();
        s.fixed[focused] = s.fixed[focused] === 1 ? 0 : 1;
        actions.requestRedraw();
      }
      e.preventDefault();
    }
  };

  const onFocus = (): void => {
    // Anello di focus sul canvas stesso: il token --focus-ring se il tema lo
    // definisce, altrimenti l'outline di default del browser. Il token vive
    // su :root, quindi si legge da documentElement.
    const fc = getComputedStyle(document.documentElement).getPropertyValue("--focus-ring").trim();
    if (fc) {
      canvas.style.outline = `2px solid ${fc}`;
      canvas.style.outlineOffset = "1px";
    }
  };

  const onBlur = (): void => {
    canvas.style.outline = "";
    canvas.style.outlineOffset = "";
  };

  const listener = <K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    canvas.addEventListener(type, fn as EventListener, opts);
  };

  listener("pointerdown", onPointerDown);
  listener("pointermove", onPointerMove);
  listener("pointerup", onPointerUp);
  listener("pointercancel", onPointerUp);
  listener("pointerleave", onPointerLeave);
  listener("wheel", onWheel, { passive: false });
  listener("click", onClick);
  listener("dblclick", onDoubleClick);
  listener("keydown", onKeyDown);
  listener("focus", onFocus);
  listener("blur", onBlur);

  return {
    destroy() {
      clearTimeout(clickTimeout);
      clickTimeout = undefined;
      // Il canvas appartiene al chiamante: qui si tolgono solo i gestori.
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("focus", onFocus);
      canvas.removeEventListener("blur", onBlur);
    },
    setA11yLabel(text: string) {
      a11yLabel = text;
      canvas.setAttribute("aria-label", text);
    },
    focusedNode(i: number) {
      focused = i < 0 || isVisible(i) ? i : -1;
      actions.requestRedraw();
    },
    getFocusedNode() {
      return focused;
    },
  };
}
