// La vista che ingrandisce: il visualizzatore di immagini, l'anteprima degli
// SVG e la lightbox di immagini e diagrammi la condividono.
//
// Il contenuto è un `<img>` posato al centro del palco e mosso con una
// trasformazione sola — spostamento, rotazione, scala — così niente si
// ridisegna in layout mentre si ingrandisce. La matematica (adattare, zoomare
// sotto il puntatore, tenere il contenuto dentro il palco) è pura ed è qui
// sopra, senza DOM: si prova da sola.
//
// I gesti: rotella (e pizzico del trackpad, che arriva come rotella con Ctrl)
// ingrandisce sotto il puntatore; trascinare sposta; due dita pizzicano;
// doppio clic alterna «adatta» e dimensioni reali. Da tastiera, sul palco:
// `+` `-` `0` (adatta) `1` (100%), frecce per spostare, `r` per ruotare. Ogni
// ascolto sta nella vita di chi monta la vista.

import { t, type Key } from "../../i18n/strings";
import type { Lifetime } from "../../ui/lifetime";
import { reducedMotion } from "../../theme/reduced-motion";
import { attachTooltip, setTooltip } from "../../ui/tooltip";

export type Rotation = 0 | 90 | 180 | 270;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/// Scala, e posizione del centro del contenuto rispetto al centro del palco,
/// in px dello schermo.
export interface ZoomState {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;
/// Il passo di un tasto o di un bottone.
export const ZOOM_STEP = 1.25;
/// Quanto sposta una freccia, in px.
const PAN_STEP = 48;
/// L'aria attorno al contenuto adattato.
const FIT_MARGIN = 16;
/// Il lato di una casella della scacchiera, in px dello schermo.
const CHECKER_CELL = 8;
/// Fin dove si adatta un contenuto vettoriale: oltre il doppio un diagramma
/// di tre riquadri smette di sembrare un diagramma.
export const VECTOR_FIT_LIMIT = 2;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/// Le dimensioni a schermo di un contenuto ruotato.
export function turned(size: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270 ? { width: size.height, height: size.width } : size;
}

/// La scala che fa stare il contenuto nel palco, senza mai ingrandire oltre
/// `limit`: una piccola icona resta piccola e nitida (1), un disegno
/// vettoriale può crescere senza perdere niente.
export function fitScale(content: Size, viewport: Size, rotation: Rotation, limit = 1): number {
  const shown = turned(content, rotation);
  if (shown.width <= 0 || shown.height <= 0) return 1;
  const room = {
    width: Math.max(1, viewport.width - 2 * FIT_MARGIN),
    height: Math.max(1, viewport.height - 2 * FIT_MARGIN),
  };
  return clampScale(Math.min(limit, room.width / shown.width, room.height / shown.height));
}

export function fitted(content: Size, viewport: Size, rotation: Rotation = 0, limit = 1): ZoomState {
  return { scale: fitScale(content, viewport, rotation, limit), x: 0, y: 0, rotation };
}

/// Il contenuto più piccolo del palco resta al centro; quello più grande non
/// lascia vuoti ai bordi.
export function clampPan(state: ZoomState, content: Size, viewport: Size): ZoomState {
  const shown = turned(content, state.rotation);
  const limit = (extent: number, room: number, value: number): number => {
    const spare = (extent * state.scale - room) / 2;
    return spare <= 0 ? 0 : Math.min(spare, Math.max(-spare, value));
  };
  return {
    ...state,
    x: limit(shown.width, viewport.width, state.x),
    y: limit(shown.height, viewport.height, state.y),
  };
}

/// Ingrandisce di `factor` tenendo fermo il punto `at` (relativo al centro del
/// palco): ciò che sta sotto il puntatore resta sotto il puntatore.
export function zoomAt(state: ZoomState, factor: number, at: Point, content: Size, viewport: Size): ZoomState {
  const scale = clampScale(state.scale * factor);
  const k = scale / state.scale;
  return clampPan(
    { ...state, scale, x: at.x - (at.x - state.x) * k, y: at.y - (at.y - state.y) * k },
    content,
    viewport,
  );
}

export function panBy(state: ZoomState, dx: number, dy: number, content: Size, viewport: Size): ZoomState {
  return clampPan({ ...state, x: state.x + dx, y: state.y + dy }, content, viewport);
}

/// Un quarto di giro in senso orario; l'adattamento si rifà sulla nuova forma.
export function rotated(state: ZoomState): Rotation {
  return ((state.rotation + 90) % 360) as Rotation;
}

/// La trasformazione CSS dello stato: il contenuto è posato col suo centro al
/// centro del palco.
export function transformOf(state: ZoomState): string {
  const round = (n: number) => Math.round(n * 100) / 100;
  return `translate(-50%, -50%) translate(${round(state.x)}px, ${round(state.y)}px) `
    + `rotate(${state.rotation}deg) scale(${Math.round(state.scale * 10000) / 10000})`;
}

/// Il fondo sotto un contenuto che può essere trasparente.
export type Backdrop = "checker" | "light" | "dark";
const BACKDROPS: readonly Backdrop[] = ["checker", "light", "dark"];

export interface ZoomViewOptions {
  /// Il nome accessibile del palco.
  readonly label: string;
  /// Le dimensioni intrinseche, quando si sanno prima di caricare (un SVG
  /// senza `width`/`height` non ne ha di naturali).
  readonly size?: Size | null;
  /// Il fondo iniziale; senza, il palco ha il fondo della superficie.
  readonly backdrop?: Backdrop | null;
  /// Una riga di informazioni in fondo alla barra: formato, misure, peso.
  readonly info?: string;
  /// Si chiama quando il contenuto non si decodifica.
  readonly onError?: () => void;
  /// Un disegno vettoriale (un diagramma, un SVG): adattandolo al palco lo si
  /// può anche ingrandire, fino a `VECTOR_FIT_LIMIT`.
  readonly vector?: boolean;
}

export interface ZoomView {
  readonly element: HTMLElement;
  readonly stage: HTMLElement;
  readonly image: HTMLImageElement;
  state(): ZoomState;
  fit(): void;
  actual(): void;
  zoom(factor: number): void;
  rotate(): void;
  /// Riscrive la riga di informazioni (le misure si sanno a immagine caricata).
  info(text: string): void;
  /// Cambia il contenuto (l'anteprima di un SVG che si scrive): lo stato di
  /// zoom resta, se l'utente l'aveva toccato.
  replace(src: string, size?: Size | null): void;
}

function button(text: string, label: string, action: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "zoom-button";
  b.textContent = text;
  b.dataset.zoomAction = action;
  b.setAttribute("aria-label", label);
  return b;
}

export function mountZoomView(src: string, options: ZoomViewOptions, life: Lifetime): ZoomView {
  const element = document.createElement("div");
  element.className = "zoom-view";
  if (options.backdrop) element.dataset.backdrop = options.backdrop;

  const stage = document.createElement("div");
  stage.className = "zoom-stage";
  stage.tabIndex = 0;
  stage.setAttribute("role", "img");
  stage.setAttribute("aria-label", options.label);
  stage.setAttribute("aria-roledescription", t("zoom.stage"));
  // Geometria e gesti, non aspetto: stanno qui e non nella pelle, che non
  // ammette queste proprietà.
  stage.style.position = "relative";
  stage.style.overflow = "hidden";
  stage.style.touchAction = "none";

  const image = document.createElement("img");
  image.className = "zoom-content";
  image.alt = options.label;
  image.decoding = "async";
  image.draggable = false;
  image.style.position = "absolute";
  image.style.left = "50%";
  image.style.top = "50%";
  image.style.maxWidth = "none";
  image.style.maxHeight = "none";
  image.style.transformOrigin = "50% 50%";
  image.style.visibility = "hidden";
  stage.append(image);

  const bar = document.createElement("div");
  bar.className = "zoom-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("zoom.toolbar"));
  const out = button("−", t("zoom.out"), "out");
  const level = document.createElement("span");
  level.className = "zoom-level";
  const into = button("+", t("zoom.in"), "in");
  const fitButton = button(t("zoom.fit"), t("zoom.fit_hint"), "fit");
  const actualButton = button("1:1", t("zoom.actual"), "actual");
  const rotateButton = button("↻", t("zoom.rotate"), "rotate");
  bar.append(out, level, into, fitButton, actualButton, rotateButton);
  let backdropButton: HTMLButtonElement | null = null;
  if (options.backdrop) {
    backdropButton = button("◩", "", "backdrop");
    bar.append(backdropButton);
  }
  for (const control of bar.querySelectorAll<HTMLButtonElement>(".zoom-button")) {
    life.add(attachTooltip(control, control.getAttribute("aria-label") ?? ""));
  }
  const info = document.createElement("span");
  info.className = "zoom-info";
  info.textContent = options.info ?? "";
  info.hidden = !options.info;
  bar.append(info);
  element.append(stage, bar);

  let content: Size = options.size ?? { width: 0, height: 0 };
  const fitLimit = options.vector ? VECTOR_FIT_LIMIT : 1;
  let state: ZoomState = { scale: 1, x: 0, y: 0, rotation: 0 };
  // Finché l'utente non tocca lo zoom, il contenuto segue il palco: si
  // riadatta quando la finestra cambia.
  let following = true;
  let loaded = false;

  function viewport(): Size {
    return { width: stage.clientWidth, height: stage.clientHeight };
  }

  function paint(animate = false): void {
    if (animate && !reducedMotion()) image.dataset.animate = "";
    else delete image.dataset.animate;
    image.style.width = `${content.width}px`;
    image.style.height = `${content.height}px`;
    image.style.transform = transformOf(state);
    // Le caselle della scacchiera restano della stessa misura sullo schermo:
    // l'immagine è scalata, il loro passo lo è al contrario.
    const cell = CHECKER_CELL / state.scale;
    image.style.backgroundSize = `${2 * cell}px ${2 * cell}px`;
    image.style.backgroundPosition = `0 0, ${cell}px ${cell}px`;
    const percent = Math.round(state.scale * 100);
    level.textContent = `${percent}%`;
    stage.dataset.zoomed = String(state.scale > fitScale(content, viewport(), state.rotation, fitLimit) + 1e-6);
    out.disabled = state.scale <= MIN_SCALE;
    into.disabled = state.scale >= MAX_SCALE;
    if (backdropButton) {
      const current = (element.dataset.backdrop ?? "checker") as Backdrop;
      const label = t("zoom.backdrop", { name: t(`zoom.backdrop.${current}` as Key) });
      backdropButton.setAttribute("aria-label", label);
      if (!life.closed) setTooltip(backdropButton, label);
    }
  }

  function set(next: ZoomState, animate = false): void {
    state = clampPan(next, content, viewport());
    paint(animate);
  }

  function fit(animate = false): void {
    following = true;
    set(fitted(content, viewport(), state.rotation, fitLimit), animate);
  }

  function actual(animate = false): void {
    following = false;
    set({ ...state, scale: 1, x: 0, y: 0 }, animate);
  }

  function zoom(factor: number, at: Point = { x: 0, y: 0 }, animate = false): void {
    following = false;
    state = zoomAt(state, factor, at, content, viewport());
    paint(animate);
  }

  function rotate(): void {
    const rotation = rotated(state);
    if (following) {
      state = fitted(content, viewport(), rotation, fitLimit);
      paint(true);
    } else {
      set({ ...state, rotation }, true);
    }
  }

  function pointAt(clientX: number, clientY: number): Point {
    const box = stage.getBoundingClientRect();
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  }

  function measure(): void {
    if (!options.size || options.size.width <= 0 || options.size.height <= 0) {
      const natural = { width: image.naturalWidth, height: image.naturalHeight };
      // Un SVG senza misure proprie non ne ha di naturali: prende il palco.
      content = natural.width > 0 && natural.height > 0 ? natural : viewport();
    }
    loaded = true;
    image.style.visibility = "";
    if (following) fit();
    else set(state);
  }

  life.listen(image, "load", measure);
  life.listen(image, "error", () => {
    options.onError?.();
  });

  life.listen(out, "click", () => zoom(1 / ZOOM_STEP, undefined, true));
  life.listen(into, "click", () => zoom(ZOOM_STEP, undefined, true));
  life.listen(fitButton, "click", () => fit(true));
  life.listen(actualButton, "click", () => actual(true));
  life.listen(rotateButton, "click", rotate);
  if (backdropButton) {
    life.listen(backdropButton, "click", () => {
      const current = (element.dataset.backdrop ?? "checker") as Backdrop;
      element.dataset.backdrop = BACKDROPS[(BACKDROPS.indexOf(current) + 1) % BACKDROPS.length]!;
      paint();
    });
  }

  life.listen(stage, "wheel", (event) => {
    if (!loaded) return;
    event.preventDefault();
    // Il pizzico del trackpad arriva come rotella con Ctrl e passi piccoli.
    const speed = event.ctrlKey ? 0.01 : 0.0015;
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoom(Math.exp(-delta * speed), pointAt(event.clientX, event.clientY));
  }, { passive: false });

  life.listen(stage, "dblclick", (event) => {
    if (!loaded) return;
    event.preventDefault();
    const fitScaleNow = fitScale(content, viewport(), state.rotation, fitLimit);
    if (Math.abs(state.scale - fitScaleNow) < 1e-3 && fitScaleNow < 1) {
      zoom(1 / state.scale, pointAt(event.clientX, event.clientY), true);
    } else if (Math.abs(state.scale - fitScaleNow) < 1e-3) {
      zoom(2, pointAt(event.clientX, event.clientY), true);
    } else {
      fit(true);
    }
  });

  // Trascinamento e pizzico: i puntatori attivi, e da dove è partito il gesto.
  const pointers = new Map<number, Point>();
  let pinch: { distance: number; scale: number } | null = null;

  function spread(): { distance: number; middle: Point } | null {
    const [a, b] = Array.from(pointers.values());
    if (!a || !b) return null;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  life.listen(stage, "pointerdown", (event) => {
    if (!loaded || (event.pointerType === "mouse" && event.button !== 0)) return;
    stage.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const now = spread();
      if (now) pinch = { distance: now.distance, scale: state.scale };
    }
    stage.dataset.dragging = "";
  });
  life.listen(stage, "pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    if (pointers.size >= 2 && pinch) {
      const before = spread();
      pointers.set(event.pointerId, point);
      const after = spread();
      if (!before || !after || before.distance === 0) return;
      following = false;
      const target = pinch.scale * (after.distance / pinch.distance);
      const at = pointAt(after.middle.x, after.middle.y);
      state = zoomAt(state, target / state.scale, at, content, viewport());
      state = panBy(state, after.middle.x - before.middle.x, after.middle.y - before.middle.y, content, viewport());
      paint();
      return;
    }
    pointers.set(event.pointerId, point);
    const moved = panBy(state, point.x - previous.x, point.y - previous.y, content, viewport());
    if (moved.x !== state.x || moved.y !== state.y) {
      following = false;
      state = moved;
      paint();
    }
  });
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) delete stage.dataset.dragging;
  };
  life.listen(stage, "pointerup", release);
  life.listen(stage, "pointercancel", release);

  life.listen(stage, "keydown", (event) => {
    if (!loaded || event.altKey || event.metaKey || event.ctrlKey) return;
    const pan = (dx: number, dy: number) => {
      following = false;
      set(panBy(state, dx, dy, content, viewport()));
    };
    switch (event.key) {
      case "+":
      case "=":
        zoom(ZOOM_STEP, undefined, true);
        break;
      case "-":
      case "_":
        zoom(1 / ZOOM_STEP, undefined, true);
        break;
      case "0":
        fit(true);
        break;
      case "1":
        actual(true);
        break;
      case "r":
      case "R":
        rotate();
        break;
      case "ArrowLeft":
        pan(PAN_STEP, 0);
        break;
      case "ArrowRight":
        pan(-PAN_STEP, 0);
        break;
      case "ArrowUp":
        pan(0, PAN_STEP);
        break;
      case "ArrowDown":
        pan(0, -PAN_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      if (!loaded) return;
      if (following) fit();
      else set(state);
    });
    observer.observe(stage);
    life.add(() => observer.disconnect());
  }

  image.src = src;
  paint();

  return {
    element,
    stage,
    image,
    state: () => state,
    fit: () => fit(true),
    actual: () => actual(true),
    zoom: (factor) => zoom(factor, undefined, true),
    rotate,
    info(text) {
      info.textContent = text;
      info.hidden = !text;
    },
    replace(next, size) {
      if (size && size.width > 0 && size.height > 0) content = size;
      else if (size === null) content = { width: 0, height: 0 };
      options = { ...options, size: size ?? null };
      image.src = next;
    },
  };
}
