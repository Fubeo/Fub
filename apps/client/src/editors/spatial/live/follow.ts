// «Segui il tablet»: la camera del PC insegue la vista dello scrittore.
//
// Serve col proiettore: chi guarda lo schermo grande vede quello che il tablet
// inquadra, senza che qualcuno muova la vista sul PC. La vista arriva in
// coordinate del documento; su ogni foglio diventa la camera che la contiene
// tutta, centrata, nei limiti di zoom del disegno. Lo spostamento usa lo
// stesso inseguimento della camera del grafo, e salta subito col moto
// ridotto.
//
// Chi muove la vista sul PC se la riprende: alla prima camera che non è
// quella messa da qui, il seguito si spegne e l'indicatore lo mostra.

import { createMotionState, fit, stepCamera, type Camera, type MotionState } from "../../../spatial/camera";
import type { LiveView } from "../../../host/contract";
import { reducedMotion } from "../../../theme/reduced-motion";
import { DRAW_SCALE_LIMITS, type DrawStage } from "../tools/editor";
import type { LiveStage } from "./registry";

/// Sotto questi scarti la camera è arrivata.
const REST_SCALE = 1e-4;
const REST_PX = 0.25;

interface Chase {
  motion: MotionState;
  /// L'ultima camera messa da qui: un'altra vuol dire che l'utente l'ha mossa.
  last: Camera | null;
}

export interface LiveFollowOptions {
  stages(): readonly LiveStage[];
  /// Il seguito si è spento da sé, perché l'utente ha mosso la vista.
  released(): void;
}

export interface LiveFollow {
  readonly on: boolean;
  /// Accende o spegne; acceso, va subito all'ultima vista nota.
  set(on: boolean): void;
  view(view: LiveView): void;
  /// I fogli sono cambiati: uno nuovo va dove sono gli altri.
  restage(): void;
  dispose(): void;
}

/// La camera che mostra tutta `view` in un foglio di `width` × `height`.
export function cameraFor(view: LiveView, width: number, height: number): Camera | null {
  if (!(width > 0 && height > 0) || !(view.w > 0 && view.h > 0)) return null;
  if (![view.x, view.y, view.w, view.h].every(Number.isFinite)) return null;
  return fit(
    { minX: view.x, minY: view.y, maxX: view.x + view.w, maxY: view.y + view.h },
    { w: width, h: height },
    0,
    0,
    DRAW_SCALE_LIMITS,
  );
}

const resting = (m: MotionState): boolean =>
  Math.abs(m.targetScale - m.scale) < REST_SCALE
  && Math.abs(m.targetTx - m.tx) < REST_PX
  && Math.abs(m.targetTy - m.ty) < REST_PX;

export function createLiveFollow(initial: boolean, options: LiveFollowOptions): LiveFollow {
  let on = initial;
  let latest: LiveView | null = null;
  let frame: number | null = null;
  let before: number | null = null;
  let disposed = false;
  const chases = new WeakMap<DrawStage, Chase>();

  /// Un foglio la cui camera non è più la nostra: l'utente l'ha presa.
  const takenOver = (stage: DrawStage): boolean => {
    const chase = chases.get(stage);
    return chase !== undefined && chase.last !== null && stage.camera !== chase.last;
  };

  const release = (): void => {
    if (!on) return;
    on = false;
    stop();
    options.released();
  };

  const stop = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    before = null;
  };

  const place = (stage: DrawStage, camera: Camera): void => {
    stage.setCamera(camera);
    // Il foglio tiene la camera che riceve: è questa che si riconosce.
    const chase = chases.get(stage);
    if (chase !== undefined) chase.last = stage.camera;
  };

  const tick = (time: number): void => {
    frame = null;
    if (disposed || !on) return;
    const dt = before === null ? 16 : Math.min(64, Math.max(0, time - before));
    before = time;
    let moving = false;
    for (const { stage } of options.stages()) {
      if (takenOver(stage)) {
        release();
        return;
      }
      const chase = chases.get(stage);
      if (chase === undefined || resting(chase.motion)) continue;
      chase.motion = stepCamera(chase.motion, dt);
      const done = resting(chase.motion);
      const m = chase.motion;
      place(stage, done ? { scale: m.targetScale, tx: m.targetTx, ty: m.targetTy } : { scale: m.scale, tx: m.tx, ty: m.ty });
      if (!done) moving = true;
    }
    if (moving) frame = requestAnimationFrame(tick);
    else before = null;
  };

  const aim = (): void => {
    if (disposed || !on || latest === null) return;
    const jump = reducedMotion();
    for (const { stage } of options.stages()) {
      if (takenOver(stage)) {
        release();
        return;
      }
      const target = cameraFor(latest, stage.width, stage.height);
      if (target === null) continue;
      let chase = chases.get(stage);
      if (chase === undefined) {
        // Il primo passo parte dalla camera che il foglio ha adesso.
        chase = { motion: { ...createMotionState(), ...stage.camera, targetScale: stage.camera.scale, targetTx: stage.camera.tx, targetTy: stage.camera.ty }, last: null };
        chases.set(stage, chase);
      }
      chase.motion = { ...chase.motion, targetScale: target.scale, targetTx: target.tx, targetTy: target.ty, vx: 0, vy: 0 };
      if (jump) {
        chase.motion = { ...chase.motion, scale: target.scale, tx: target.tx, ty: target.ty };
        place(stage, target);
      }
    }
    if (!jump && frame === null) frame = requestAnimationFrame(tick);
  };

  return {
    get on() {
      return on;
    },
    set(next) {
      if (disposed || next === on) return;
      on = next;
      if (!on) {
        stop();
        return;
      }
      // Riaccendere riparte dalle camere di adesso, anche se l'utente le ha
      // mosse: è lui che ha chiesto di tornare a seguire.
      for (const { stage } of options.stages()) {
        const chase = chases.get(stage);
        if (chase !== undefined) {
          const c = stage.camera;
          chase.motion = { ...chase.motion, scale: c.scale, tx: c.tx, ty: c.ty };
          chase.last = c;
        }
      }
      aim();
    },
    view(view) {
      latest = view;
      aim();
    },
    restage() {
      aim();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
