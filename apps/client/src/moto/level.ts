// I tre livelli di movimento: di sistema, calmo, ridotto.
//
// La regola è una: se il sistema o l'utente chiedono meno movimento vale
// «ridotto», e non esiste un livello che scavalchi quella richiesta. Sta sopra
// il canale di `theme/reduced-motion.ts`, che resta l'unico a leggere il
// browser; qui si aggiunge soltanto «calmo».
import { onReducedMotionChange, reducedMotion, setReducedMotionPreference } from "../theme/reduced-motion";
import type { Teardown } from "../ui/lifetime";

export type MotionLevel = "full" | "calm" | "reduced";
export type MotionPreference = "system" | "calm" | "reduced";

type Listener = (level: MotionLevel) => void;

let preference: MotionPreference = "system";
const listeners = new Set<{ listener: Listener }>();
/// L'ascolto del canale del moto ridotto: vivo solo finché qualcuno ascolta noi.
let stopReduced: Teardown | null = null;
let announced: MotionLevel = "full";
let writing = false;

export function motionLevel(): MotionLevel {
  if (reducedMotion()) return "reduced";
  return preference === "calm" ? "calm" : "full";
}

function announce(): void {
  if (writing) return;
  const level = motionLevel();
  if (level === announced) return;
  announced = level;
  for (const entry of [...listeners]) {
    if (listeners.has(entry)) entry.listener(level);
  }
}

/// La scelta dell'utente (`appearance.motion`). Va chiamata al posto di
/// `setReducedMotionPreference`, che scrive lo stesso attributo e cancellerebbe
/// «calmo».
export function setMotionPreference(value: MotionPreference): void {
  preference = value;
  // Prima il canale del moto ridotto, che scrive o cancella `data-motion`; poi
  // «calmo», che altrimenti verrebbe cancellato. Intanto si tace: chi ascolta
  // vede un cambio solo, con l'attributo già a posto.
  writing = true;
  try {
    setReducedMotionPreference(value === "reduced");
  } finally {
    writing = false;
  }
  if (value === "calm" && typeof document !== "undefined") {
    document.documentElement.dataset.motion = "calm";
  }
  announce();
}

/// Avvisa a ogni cambio del livello in vigore, che venga dalla scelta
/// dell'utente o dal sistema. Il canale del moto ridotto segue il sistema solo
/// finché qualcuno lo ascolta: una shell che vuole accorgersi del cambio a
/// sessione aperta tiene questo ascolto per tutta la sua vita.
export function onMotionLevelChange(listener: Listener): Teardown {
  if (listeners.size === 0) {
    // Prima l'ascolto: riattaccandosi, il canale rilegge il sistema.
    stopReduced = onReducedMotionChange(announce);
    announced = motionLevel();
  }
  const entry = { listener };
  listeners.add(entry);
  return () => {
    if (!listeners.delete(entry) || listeners.size > 0) return;
    stopReduced?.();
    stopReduced = null;
  };
}
