// La Mano e la Lente (D3, F2): muovono e ingrandiscono la vista, e il
// disegno non cambia. La Mano trascina; tenendo Spazio, con qualunque
// strumento, il puntatore che trascina è la Mano. La Lente ingrandisce al
// clic, rimpicciolisce con Alt, e inquadra il riquadro che si trascina.
//
// I gesti si prendono in cattura sulla radice, prima della pipeline della
// penna: un trascinamento della vista non comincia un tratto.

import type { Bounds } from "../../scene/geometry";
import type { Point } from "../../scene/matrix";
import { panned, zoomAt } from "../../view";
import { DRAW_SCALE_LIMITS } from "./constants";
import type { EditorContext } from "./context";

/// Sotto questi pixel il gesto della Lente è un clic, non un riquadro.
const CLICK_SLOP_PX = 4;
/// Di quanto ingrandisce o rimpicciolisce un clic della Lente.
const ZOOM_STEP = 2;

export interface HandZoomContext {
  /// Spazio è tenuto giù sul foglio: il trascinamento è della Mano.
  spaceHeld: boolean;
}

/// Il gesto della vista in corso.
interface ViewDrag {
  readonly id: number;
  readonly mode: "pan" | "zoom";
  /// Dove è cominciato e dov'è adesso, nelle coordinate del foglio.
  readonly from: Point;
  at: Point;
}

/// Il rettangolo dello schermo fra due punti, in ordine.
export function screenBox(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

export function installHandZoom(ctx: EditorContext): void {
  const { life, root, surface } = ctx;
  ctx.spaceHeld = false;
  let drag: ViewDrag | null = null;

  // Il riquadro della Lente, sopra il foglio.
  const box = document.createElement("div");
  box.className = "draw-zoom-box";
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  surface.append(box);

  const showMode = (): void => {
    const pan = drag?.mode === "pan" || (drag === null && ctx.spaceHeld);
    if (pan) surface.dataset.view = drag === null ? "grab" : "grabbing";
    else delete surface.dataset.view;
  };

  const modeFor = (event: PointerEvent): ViewDrag["mode"] | null => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return null;
    if (ctx.spaceHeld || ctx.tool === "hand") return "pan";
    if (ctx.tool === "zoom") return "zoom";
    return null;
  };

  const local = (event: PointerEvent): Point => {
    const at = ctx.localPoint(event.clientX, event.clientY);
    return [at.x, at.y];
  };

  const onDown = (event: PointerEvent): void => {
    if (drag !== null || !surface.contains(event.target as Node)) return;
    const mode = modeFor(event);
    if (mode === null) return;
    // Il gesto è della vista: né la pipeline né gli strumenti lo vedono.
    event.stopPropagation();
    event.preventDefault();
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Non catturabile: il gesto prosegue finché il puntatore resta sopra.
    }
    const at = local(event);
    drag = { id: event.pointerId, mode, from: at, at };
    ctx.placed = true;
    if (!surface.contains(document.activeElement)) surface.focus({ preventScroll: true });
    showMode();
  };

  const onMove = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.id) return;
    event.stopPropagation();
    const at = local(event);
    if (drag.mode === "pan") {
      ctx.setCamera(panned(ctx.camera, at[0] - drag.at[0], at[1] - drag.at[1]));
    } else {
      const shown = screenBox(drag.from, at);
      box.hidden = shown.w < CLICK_SLOP_PX && shown.h < CLICK_SLOP_PX;
      box.style.transform = `translate(${shown.x}px, ${shown.y}px)`;
      box.style.width = `${shown.w}px`;
      box.style.height = `${shown.h}px`;
    }
    drag.at = at;
  };

  const onEnd = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.id) return;
    event.stopPropagation();
    const ended = drag;
    drag = null;
    box.hidden = true;
    showMode();
    if (event.type !== "pointerup" || ended.mode !== "zoom") return;
    const shown = screenBox(ended.from, local(event));
    if (shown.w < CLICK_SLOP_PX && shown.h < CLICK_SLOP_PX) {
      // Un clic: due volte più grande lì, o la metà con Alt.
      ctx.setCamera(zoomAt(ctx.camera, event.altKey ? 1 / ZOOM_STEP : ZOOM_STEP, ended.from, DRAW_SCALE_LIMITS));
      return;
    }
    // Un riquadro: si inquadra ciò che contiene.
    const corners = [ctx.sceneAt(event.clientX, event.clientY), sceneOf(ended.from)];
    const bounds: Bounds = {
      min: [Math.min(corners[0]![0], corners[1]![0]), Math.min(corners[0]![1], corners[1]![1])],
      max: [Math.max(corners[0]![0], corners[1]![0]), Math.max(corners[0]![1], corners[1]![1])],
    };
    ctx.setCamera(ctx.fitted(bounds, ctx.viewArea()));
  };

  /// Un punto del foglio nella scena, come `sceneAt` per uno dello schermo.
  const sceneOf = (at: Point): Point => {
    const rect = surface.getBoundingClientRect();
    return ctx.sceneAt(rect.left + at[0], rect.top + at[1]);
  };

  const capture = { capture: true } as const;
  life.listen(root, "pointerdown", onDown, capture);
  life.listen(root, "pointermove", onMove, capture);
  life.listen(root, "pointerup", onEnd, capture);
  life.listen(root, "pointercancel", onEnd, capture);

  // Spazio tenuto col mouse fermo sul foglio è la Mano. Battuto da chi usa
  // la tastiera, col cursore del foglio o senza il mouse sopra, resta il
  // «premi» del cursore (DEC-27).
  let hovering = false;
  life.listen(surface, "pointermove", (event: PointerEvent) => {
    hovering = event.buttons === 0 && event.pointerType !== "touch";
  });
  life.listen(surface, "pointerleave", () => {
    hovering = false;
  });
  life.listen(
    root,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key !== " " || event.target !== surface || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ctx.spaceHeld) {
        event.preventDefault();
        return;
      }
      if (!hovering || !ctx.cursorMark.hidden || ctx.pressed !== null || ctx.current !== null) return;
      event.preventDefault();
      ctx.spaceHeld = true;
      showMode();
    },
    capture,
  );
  const letGo = (): void => {
    if (!ctx.spaceHeld) return;
    ctx.spaceHeld = false;
    showMode();
  };
  life.listen(root, "keyup", (event: KeyboardEvent) => {
    if (event.key === " ") letGo();
  });
  life.listen(surface, "blur", letGo);
}
