// La coreografia delle superfici sovrane della shell.
//
// Una superficie entra, esce o viene riannodata mentre stava uscendo. Il DOM
// resta proprietario del layout e dei gesti; questo modulo possiede soltanto il
// passaggio fra gli stati e l'unico limite di sicurezza. Niente View
// Transitions: animano una fotografia della pagina invece dell'elemento, non
// sentono il livello del moto, e su alcuni WebKitGTK la cattura del vecchio
// fotogramma fa cadere il processo.
import { reducedMotion } from "../theme/reduced-motion";

type Phase = "enter" | "exit";

interface MotionRun {
  readonly phase: Phase;
  cancel(): void;
  finish(): void;
}

// Non è una durata del disegno: è il tetto oltre il quale un `animationend`
// perso non può tenere una superficie appesa. Le durate vere restano nei token.
const SAFETY_BOUND_MS = 600;
const runs = new WeakMap<HTMLElement, MotionRun>();

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
    return;
  }

  // Il nodo può essere appena entrato nel documento, o arrivare da `exit`. Il
  // flush rende `pre-enter` il fotogramma di partenza prima di scrivere `enter`.
  void element.offsetWidth;
  waitForMotion(element, "enter", () => {
    element.dataset.shellMotion = "rest";
  });
  element.dataset.shellMotion = "enter";
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
  element.style.setProperty("pointer-events", "none");

  if (reducedMotion()) {
    element.dataset.shellMotion = "exit";
    conceal();
    return;
  }

  waitForMotion(element, "exit", conceal);
  element.dataset.shellMotion = "exit";
}

/** Porta subito al termine il passaggio pendente, per uno smontaggio definitivo. */
export function finishSurface(element: HTMLElement): void {
  runs.get(element)?.finish();
}

