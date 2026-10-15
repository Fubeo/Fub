// L'orologio unico dei cicli in proprio.
//
// Tutto ciò che si muove fuori dai fotogrammi chiave (i valori a molla che
// seguono il puntatore) batte su un solo `requestFrame` del motore, acceso
// finché c'è almeno un iscritto e spento con l'ultimo. Passa dal tetto di
// `theme/frame-rate.ts`, come il ciclo del grafo.
import { createFramePacer } from "../theme/frame-rate";
import type { Teardown } from "../ui/lifetime";
import { motionDriver, type MotionDriver } from "./driver";

/// `elapsed` è il tempo dal battito precedente (ms), `time` l'istante del
/// fotogramma.
export type FrameListener = (elapsed: number, time: number) => void;

/// Un intervallo più lungo non è un fotogramma ma una pausa (scheda nascosta):
/// al risveglio non si recupera con un salto.
const MAX_ELAPSED_MS = 100;

const listeners = new Set<{ listener: FrameListener }>();
const pacer = createFramePacer();
/// Il motore che ha in attesa il nostro fotogramma, e il suo identificativo.
let source: MotionDriver | null = null;
let frame = 0;
let last = 0;

function request(): void {
  const driver = motionDriver();
  if (source === driver) return;
  // Il motore è cambiato sotto un fotogramma in attesa: quello vecchio non
  // batterebbe più per noi.
  source?.cancelFrame(frame);
  source = driver;
  frame = driver.requestFrame(beat);
}

function halt(): void {
  source?.cancelFrame(frame);
  source = null;
  pacer.pause();
}

function beat(time: number): void {
  source = null;
  if (listeners.size === 0) return;
  // Si prenota prima di servire: un iscritto che sbaglia non ferma l'orologio.
  request();
  if (!pacer.admit(time)) return;
  const elapsed = Math.min(Math.max(0, time - last), MAX_ELAPSED_MS);
  last = time;
  for (const entry of [...listeners]) {
    if (listeners.has(entry)) entry.listener(elapsed, time);
  }
}

/// Iscrive un ciclo all'orologio. Il disposer lo toglie; con l'ultimo iscritto
/// l'orologio si ferma.
export function onFrame(listener: FrameListener): Teardown {
  if (listeners.size === 0) last = motionDriver().now();
  const entry = { listener };
  listeners.add(entry);
  request();
  return () => {
    if (listeners.delete(entry) && listeners.size === 0) halt();
  };
}

/// Quanti cicli sono iscritti: zero vuol dire nessun fotogramma chiesto.
export function frameListeners(): number {
  return listeners.size;
}
