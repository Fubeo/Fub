// Il righello della lavagna (T87), come quello del disegno (P13): una riga
// sopra la lavagna finché non la si toglie dalla colonna; non entra nel file.
// La parte pura (dove sta, il bordo che un tratto segue, come si gira) è del
// disegno (`editors/spatial/tools/ruler.ts`); qui la riga sullo schermo.
//
// - **Dove sta.** Un centro e un angolo nella lavagna; la larghezza è in pixel
//   dello schermo (`RULER_WIDTH_PX`) e non cambia con lo zoom. Nasce in mezzo
//   a ciò che si vede, dritto.
// - **Sopra la vista, fuori da lei.** La riga è un fratello della vista: un
//   appoggio sul suo corpo non arriva allo strato della penna, così la penna,
//   il mouse e il dito la prendono e la spostano. Le due fasce lungo i bordi,
//   larghe quanto la portata della penna, lasciano passare il puntatore: un
//   tratto che comincia lì comincia sulla lavagna e segue il bordo.
// - **Girare.** La rotella sopra la riga la gira a gradi, con Maiusc a passi
//   di `RULER_STEP`; col fuoco su di lei le frecce fanno lo stesso e Inizio la
//   raddrizza. È un cursore per il lettore di schermo, con l'angolo.

import { t } from "../../i18n/strings";
import type { Lifetime } from "../../ui/lifetime";
import type { Point } from "../spatial/scene/matrix";
import { rulerDegrees, RULER_WIDTH_PX, steppedRuler, turnedRuler, type Ruler } from "../spatial/tools/ruler";

/** Quanta rotella fa un grado, e quanta un passo con Maiusc (come nel disegno). */
const WHEEL_PER_DEGREE = 20;
const WHEEL_PER_STEP = 60;

/** Quanto si muove il puntatore prima che la riga lo segua, in pixel. */
const DRAG_PX = 3;

export interface CanvasRulerOptions {
  /** Dove sta la riga: il contenitore della vista (`.canvas-area`). */
  readonly host: HTMLElement;
  /** La camera della lavagna. */
  readonly camera: () => { readonly x: number; readonly y: number; readonly zoom: number };
  /** Il punto della lavagna in mezzo a ciò che si vede. */
  readonly viewCenter: () => Point;
  /** Dice al lettore di schermo ciò che la riga ha fatto. */
  readonly announce: (text: string) => void;
  /** La riga è comparsa o se n'è andata. */
  readonly onToggle?: (on: boolean) => void;
  readonly lifetime: Lifetime;
}

export interface CanvasRuler {
  /** Il righello sulla lavagna; `null` se non c'è. */
  readonly ruler: Ruler | null;
  /** Mette o toglie il righello. */
  set(on: boolean): void;
  /** La camera è cambiata: la riga torna dove sta nella lavagna. */
  place(): void;
  /** L'elemento della riga, `.canvas-ruler`. */
  readonly element: HTMLElement;
}

/** Monta la riga, nascosta, in `options.host`. */
export function createCanvasRuler(options: CanvasRulerOptions): CanvasRuler {
  const { lifetime } = options;
  let ruler: Ruler | null = null;
  const element = document.createElement("div");
  element.className = "canvas-ruler";
  element.hidden = true;
  const bar = document.createElement("div");
  bar.className = "canvas-ruler-bar";
  bar.style.setProperty("--canvas-ruler-width", `${RULER_WIDTH_PX}px`);
  const grip = document.createElement("div");
  grip.className = "canvas-ruler-grip";
  grip.tabIndex = 0;
  grip.setAttribute("role", "slider");
  grip.setAttribute("aria-valuemin", "0");
  grip.setAttribute("aria-valuemax", "179");
  const angle = document.createElement("span");
  angle.className = "canvas-ruler-angle";
  angle.setAttribute("aria-hidden", "true");
  grip.append(angle);
  bar.append(grip);
  element.append(bar);
  options.host.append(element);
  lifetime.add(() => element.remove());

  const place = (): void => {
    if (ruler === null) return;
    const { x, y, zoom } = options.camera();
    bar.style.setProperty("--canvas-ruler-x", `${ruler.center[0] * zoom + x}px`);
    bar.style.setProperty("--canvas-ruler-y", `${ruler.center[1] * zoom + y}px`);
    bar.style.setProperty("--canvas-ruler-angle", `${ruler.angle}deg`);
    const degrees = String(rulerDegrees(ruler));
    angle.textContent = `${degrees}°`;
    grip.setAttribute("aria-label", t("canvas.ruler"));
    grip.setAttribute("aria-valuenow", degrees);
    grip.setAttribute("aria-valuetext", t("canvas.ruler.angle", { angle: degrees }));
  };

  const put = (next: Ruler): void => {
    ruler = next;
    place();
  };

  const turnSaid = (): void => {
    if (ruler !== null) options.announce(t("canvas.ruler.angle", { angle: String(rulerDegrees(ruler)) }));
  };

  const set = (on: boolean): void => {
    if (on === (ruler !== null)) return;
    if (!on) {
      ruler = null;
      element.hidden = true;
      drag = null;
      options.announce(t("canvas.ruler.hidden"));
      options.onToggle?.(false);
      return;
    }
    put({ center: options.viewCenter(), angle: 0 });
    element.hidden = false;
    options.announce(t("canvas.ruler.shown", { angle: String(rulerDegrees(ruler!)) }));
    options.onToggle?.(true);
  };

  // Spostare: il corpo della riga segue il puntatore che l'ha presa.
  let drag: { readonly pointerId: number; readonly x: number; readonly y: number; readonly from: Ruler; moved: boolean } | null = null;
  lifetime.listen(grip, "pointerdown", (event) => {
    if (ruler === null || event.button !== 0 || drag !== null) return;
    event.preventDefault();
    event.stopPropagation();
    grip.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: ruler, moved: false };
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Un puntatore che non si cattura segue lo stesso finché resta sopra.
    }
  });
  lifetime.listen(grip, "pointermove", (event) => {
    if (drag === null || event.pointerId !== drag.pointerId || ruler === null) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) <= DRAG_PX) return;
    drag.moved = true;
    const { zoom } = options.camera();
    put({ ...ruler, center: [drag.from.center[0] + dx / zoom, drag.from.center[1] + dy / zoom] });
  });
  const release = (event: PointerEvent, cancelled: boolean): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const was = drag;
    drag = null;
    if (cancelled && ruler !== null) put(was.from);
    else if (was.moved) options.announce(t("canvas.ruler.moved"));
  };
  lifetime.listen(grip, "pointerup", (event) => release(event, false));
  lifetime.listen(grip, "pointercancel", (event) => release(event, true));
  lifetime.listen(grip, "lostpointercapture", (event) => release(event, false));

  // Girare con la rotella: a gradi, con Maiusc a passi di 15°.
  let wheel = 0;
  lifetime.listen(grip, "wheel", (event) => {
    if (ruler === null) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    if (event.shiftKey) {
      wheel += delta;
      if (Math.abs(wheel) < WHEEL_PER_STEP) return;
      put(steppedRuler(ruler, wheel > 0 ? 1 : -1));
      wheel = 0;
    } else {
      put(turnedRuler(ruler, Math.max(-5, Math.min(5, delta / WHEEL_PER_DEGREE))));
    }
    turnSaid();
  }, { passive: false });

  // Girare con la tastiera: le frecce a gradi, con Maiusc a passi; Inizio dritto.
  lifetime.listen(grip, "keydown", (event) => {
    if (ruler === null) return;
    let next: Ruler | null = null;
    const up = event.key === "ArrowRight" || event.key === "ArrowUp";
    const down = event.key === "ArrowLeft" || event.key === "ArrowDown";
    if (up || down) next = event.shiftKey ? steppedRuler(ruler, up ? 1 : -1) : turnedRuler(ruler, up ? 1 : -1);
    else if (event.key === "Home") next = { ...ruler, angle: 0 };
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    put(next);
  });

  return {
    get ruler() {
      return ruler;
    },
    set,
    place,
    element,
  };
}
