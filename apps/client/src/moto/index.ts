// Il movimento dello Scrittoio.
//
// Regole che questo modulo tiene per tutti:
// - lo stato cambia subito e l'animazione lo segue: il DOM è già nello stato
//   finale al primo fotogramma, ciò che si muove è la differenza;
// - si animano soltanto `transform` e `opacity`, e una corsa finita non lascia
//   niente sull'elemento: lo stato finale è quello del CSS, al pixel;
// - tutto è interrompibile, e una corsa nuova riparte da posa e velocità
//   correnti; nessuna corsa tocca `pointer-events` dell'elemento vero;
// - se il sistema o l'utente chiedono meno movimento vale «ridotto», sempre;
// - niente View Transitions (su alcuni WebKitGTK la cattura del vecchio
//   fotogramma fa cadere il processo, vedi `ui/motion.ts`) e niente `linear()`:
//   le molle sono campionate in fotogrammi chiave.
//
// Il modulo non conosce la shell: riceve elementi.

export {
  DURATION,
  EXIT_SAFETY_MS,
  PRESS_SCALE,
  SKELETON_DELAY_MS,
  SPRINGS,
  STAGGER_MAX,
  STAGGER_MS,
  critical,
  invalidateSpringTokens,
  resolveSpring,
  sampleSpring,
} from "./spring";
export type { Spring, SpringName, SpringSamples, SpringTravel } from "./spring";

export { motionLevel, onMotionLevelChange, setMotionPreference } from "./level";
export type { MotionLevel, MotionPreference } from "./level";

export { createManualDriver, motionDriver, setMotionDriver } from "./driver";
export type { DriverRun, DriverTiming, ManualDriver, MotionDriver, RecordedPlay } from "./driver";

export { activeMotions, animate, halt, liveState } from "./animate";
export type { Motion, MotionSpec, MotionState, Pose } from "./animate";

export { flip } from "./flip";
export type { FlipOptions } from "./flip";

export { enter, exitGhost, prepareExit } from "./presence";
export type { ExitSpec, Ghost } from "./presence";

export { stagger } from "./stagger";
export type { StaggerOptions } from "./stagger";

export { springValue } from "./value";
export type { SpringValue, SpringValueOptions } from "./value";

export { onFrame } from "./ticker";
export type { FrameListener } from "./ticker";

export { drag } from "./gesture";
export type { DragInfo, DragOptions } from "./gesture";
