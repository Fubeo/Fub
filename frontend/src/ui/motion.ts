// La coreografia delle superfici sovrane della shell.
//
// Una superficie entra, esce o viene riannodata mentre stava uscendo. Il DOM
// resta proprietario del layout e dei gesti; questo modulo possiede soltanto il
// passaggio fra gli stati, compresi l'unico limite di sicurezza e il ramo
// progressivo delle View Transitions. Il foglio resta la base: senza
// `startViewTransition` le stesse mutazioni e gli stessi keyframe continuano a
// valere.
import { reducedMotion } from "../theme/reduced-motion";

type Phase = "enter" | "exit";

interface MotionRun {
  readonly phase: Phase;
  cancel(): void;
  finish(): void;
}

interface ViewTransitionLike {
  readonly finished?: Promise<unknown>;
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike;
};

// Non è una durata del disegno: è il tetto oltre il quale un `animationend`
// perso non può tenere una superficie appesa. Le durate vere restano nei token.
const SAFETY_BOUND_MS = 600;
const runs = new WeakMap<HTMLElement, MotionRun>();
const names = new WeakMap<HTMLElement, string>();
let nextName = 0;

function transitionName(element: HTMLElement): string {
  const current = names.get(element);
  if (current) return current;
  const suffix = element.id.replace(/[^a-zA-Z0-9_-]/g, "-") || String(++nextName);
  const name = `fub-surface-${suffix}`;
  names.set(element, name);
  return name;
}

function cancel(element: HTMLElement): void {
  runs.get(element)?.cancel();
}

function waitForMotion(
  element: HTMLElement,
  phase: Phase,
  done: () => void,
): MotionRun {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    element.removeEventListener("animationend", onEnd);
    if (timer !== undefined) clearTimeout(timer);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    clear();
    if (runs.get(element) !== run) return;
    runs.delete(element);
    done();
  };
  const onEnd = (event: AnimationEvent) => {
    if (event.target === element) finish();
  };
  const run: MotionRun = {
    phase,
    cancel() {
      if (settled) return;
      settled = true;
      clear();
      if (runs.get(element) === run) runs.delete(element);
    },
    finish,
  };

  runs.set(element, run);
  element.addEventListener("animationend", onEnd);
  timer = setTimeout(finish, SAFETY_BOUND_MS);
  return run;
}

function progressive(element: HTMLElement, run: MotionRun, update: () => void): void {
  const start = (document as TransitionDocument).startViewTransition;
  if (typeof start !== "function") {
    update();
    return;
  }

  element.style.setProperty("view-transition-name", transitionName(element));
  let updated = false;
  const once = () => {
    if (updated || runs.get(element) !== run) return;
    updated = true;
    update();
  };
  try {
    const transition = start.call(document, once);
    transition.finished?.catch(() => {});
  } catch {
    once();
  }
}

/**
 * Annoda una superficie al suo stato visibile. Se stava uscendo, l'uscita viene
 * cancellata senza eseguire la chiusura: un solo attributo cambia valore, quindi
 * riaprire non accumula classi né conserva `pointer-events: none`.
 */
export function enterSurface(element: HTMLElement): void {
  cancel(element);
  element.style.removeProperty("pointer-events");
  element.dataset.shellMotion = "pre-enter";

  if (reducedMotion()) {
    element.dataset.shellMotion = "rest";
    element.style.removeProperty("view-transition-name");
    return;
  }

  // Il nodo può essere appena entrato nel documento, o arrivare da `exit`. Il
  // flush rende `pre-enter` il fotogramma di partenza prima di scrivere `enter`.
  void element.offsetWidth;
  const run = waitForMotion(element, "enter", () => {
    element.dataset.shellMotion = "rest";
    element.style.removeProperty("view-transition-name");
  });
  progressive(element, run, () => {
    element.dataset.shellMotion = "enter";
  });
}

/**
 * Avvia l'uscita e chiama `conceal` una volta sola alla fine. Da subito la
 * superficie non intercetta il puntatore; la pelle lo garantisce leggendo lo
 * stesso attributo che governa il moto.
 */
export function exitSurface(element: HTMLElement, conceal: () => void): void {
  const current = runs.get(element);
  if (current?.phase === "exit") return;
  cancel(element);
  // Il callback di View Transitions può arrivare dopo la fotografia vecchia:
  // il puntatore invece smette di appartenere alla superficie subito.
  element.style.setProperty("pointer-events", "none");

  if (reducedMotion()) {
    element.dataset.shellMotion = "exit";
    conceal();
    return;
  }

  const run = waitForMotion(element, "exit", () => {
    element.style.removeProperty("view-transition-name");
    conceal();
  });
  progressive(element, run, () => {
    element.dataset.shellMotion = "exit";
  });
}

/** Porta subito al termine il passaggio pendente, per uno smontaggio definitivo. */
export function finishSurface(element: HTMLElement): void {
  runs.get(element)?.finish();
}

/** Feature detection esposta per il presidio del ramo progressivo. */
export function supportsViewTransitions(): boolean {
  return typeof (document as TransitionDocument).startViewTransition === "function";
}
