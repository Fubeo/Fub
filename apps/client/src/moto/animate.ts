// Una corsa: fotogrammi chiave di `transform` e `opacity`, consegnati al motore.
//
// Lo stato di riposo è quello del CSS, e una corsa non lo scrive mai: mostra
// la differenza fra una posa e il riposo, e quando finisce non lascia niente
// (nessun `fill: forwards`, nessuno stile in linea). Per questo `to` di norma è
// l'identità, e lo stato finale con movimento coincide al pixel con quello
// senza. Se `to` non è l'identità l'elemento torna comunque al suo CSS: tocca
// al chiamante aver già messo il DOM nello stato finale.
//
// Finché dura, il `transform` dei fotogrammi sostituisce quello del CSS. Un
// elemento che ha una trasformazione a riposo la dichiara con le proprietà
// singole (`translate`, `scale`, `rotate`), che si compongono.
//
// Ogni bersaglio — un elemento, o un suo pseudo-elemento — ha al più una corsa
// viva. Una nuova parte dalla posa e dalla velocità che la vecchia ha in
// quell'istante, lette dalla stessa tabella di campioni che ha dato i
// fotogrammi: è ciò che rende tutto interrompibile.
import type { Lifetime, Teardown } from "../ui/lifetime";
import { motionDriver, type DriverRun } from "./driver";
import { curveOf } from "./easing";
import { motionLevel, type MotionLevel } from "./level";
import { DURATION, SAMPLE_MS, sampleSpring, springFor, type Spring, type SpringName } from "./spring";
import { frameListeners } from "./ticker";

/// Una posa rispetto al riposo: px, gradi, fattori di scala. Ciò che manca
/// vale l'identità; `scale` vale per i due assi, che `scaleX`/`scaleY`
/// precisano.
export interface Pose {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  opacity?: number;
}

export interface MotionSpec {
  /// La posa di partenza. Un canale già in corsa parte invece da dov'è.
  from?: Pose;
  /// La posa d'arrivo; omessa è l'identità, cioè il riposo del CSS.
  to?: Pose;
  /// La velocità iniziale per canale, in unità al millisecondo (quella che dà
  /// `drag`). Vale per le molle; un canale già in corsa tiene la sua.
  velocity?: Pose;
  /// La molla che campiona i fotogrammi, canale per canale. Di serie `soft`.
  spring?: SpringName | Spring;
  /// Se c'è, la corsa è una curva a tempo (ms) e la molla non conta.
  duration?: number;
  /// La curva di una corsa a tempo: `cubic-bezier()` o una parola chiave.
  easing?: string;
  /// Attesa prima di partire (ms): intanto l'elemento sta nella posa di partenza.
  delay?: number;
  /// Che cosa resta nel livello «ridotto»: niente, o la sola opacità in 90 ms.
  whenReduced?: "none" | "fade";
  /// Muove uno pseudo-elemento di `el` al posto dell'elemento: una sagoma
  /// disegnata dal CSS si anima senza un nodo in più. È un bersaglio a sé, con
  /// la sua corsa: non interrompe quella dell'elemento né ne eredita lo stato.
  pseudo?: "::before" | "::after";
  /// Chiuderla annulla la corsa.
  lifetime?: Lifetime;
}

export interface Motion {
  /// Si risolve quando la corsa finisce, comunque finisca. Non rigetta mai.
  readonly finished: Promise<void>;
  /// Ferma la corsa: l'elemento torna subito al suo CSS.
  cancel(): void;
  /// Porta la corsa alla fine. Senza riempimento coincide con `cancel`.
  finish(): void;
  /// Torna verso la posa di partenza dalla posizione e dalla velocità correnti.
  reverse(): Motion;
  readonly running: boolean;
}

/// Posa e velocità (unità al millisecondo) dei soli canali in corsa.
export interface MotionState {
  pose: Pose;
  velocity: Pose;
}

/// Ciò che i moduli vicini aggiungono a una corsa e che non è dell'API.
export interface LaunchExtras {
  /// Lo stato da cui partire, al posto di quello della corsa viva sull'elemento.
  inherit?: MotionState | null;
  /// Tetto di ritardo più durata (ms): oltre, la corsa è troncata.
  limit?: number;
  /// Chiamata una volta e in modo sincrono quando la corsa finisce, comunque
  /// finisca.
  onEnd?: () => void;
}

const KEYS = ["x", "y", "scaleX", "scaleY", "rotate", "opacity"] as const;
const OPACITY = 5;
const REST: readonly number[] = [0, 0, 1, 1, 0, 1];
const STILL: readonly number[] = [0, 0, 0, 0, 0, 0];
/// Sotto queste differenze un canale è fermo: px, px, scala, scala, gradi,
/// opacità.
const PRECISION: readonly number[] = [0.05, 0.05, 0.0005, 0.0005, 0.02, 0.002];

interface Run {
  readonly el: Element;
  /// Lo pseudo-elemento che si muove; vuoto per l'elemento stesso.
  readonly pseudo: string;
  /// Una tabella di campioni per canale in corsa, a `SAMPLE_MS` l'uno.
  tracks: (number[] | null)[];
  delay: number;
  handle: DriverRun | null;
  alive: boolean;
  release: Teardown | null;
  readonly settle: () => void;
  readonly onEnd: (() => void) | undefined;
}

interface Plan {
  tracks: (number[] | null)[];
  frames: number;
  duration: number;
  easing: string;
  /// Una molla: un fotogramma chiave per campione. Altrimenti i due estremi.
  sampled: boolean;
}

/// Le corse vive: per elemento, una per bersaglio (`""` è l'elemento stesso).
const runs = new Map<Element, Map<string, Run>>();
let alive = 0;
/// Le corse vive di ogni vita: un solo smontaggio per vita, non uno per corsa,
/// perché una superficie longeva anima migliaia di volte.
const adopted = new WeakMap<Lifetime, Set<Run>>();
let ambientDelay = 0;

function vectorOf(pose: Pose | undefined, base: readonly number[]): number[] {
  if (!pose) return base.slice();
  const pick = (value: number | undefined, index: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : base[index];
  return [
    pick(pose.x, 0),
    pick(pose.y, 1),
    pick(pose.scaleX ?? pose.scale, 2),
    pick(pose.scaleY ?? pose.scale, 3),
    pick(pose.rotate, 4),
    pick(pose.opacity, 5),
  ];
}

function poseOf(vector: readonly number[]): Pose {
  const pose: Pose = {};
  KEYS.forEach((key, index) => {
    pose[key] = vector[index];
  });
  return pose;
}

/// Valore e pendenza (al millisecondo) di una tabella a `time` ms dall'avvio.
function sampleAt(track: readonly number[], time: number): [number, number] {
  const last = track.length - 1;
  const position = Math.max(0, time / SAMPLE_MS);
  if (position >= last) return [track[last], 0];
  const index = Math.floor(position);
  const slope = track[index + 1] - track[index];
  return [track[index] + slope * (position - index), slope / SAMPLE_MS];
}

const round = (value: number, steps: number): number => Math.round(value * steps) / steps;

/// Il fotogramma chiave al campione `index`. Soltanto `transform` e `opacity`,
/// e sempre le stesse funzioni nello stesso ordine: così il browser le
/// interpola una per una.
function keyframe(tracks: readonly (number[] | null)[], index: number): Keyframe {
  const at = (channel: number): number => {
    const track = tracks[channel];
    return track ? track[Math.min(index, track.length - 1)] : REST[channel];
  };
  const frame: Keyframe = {};
  const parts: string[] = [];
  if (tracks[0] || tracks[1]) parts.push(`translate(${round(at(0), 100)}px, ${round(at(1), 100)}px)`);
  if (tracks[4]) parts.push(`rotate(${round(at(4), 100)}deg)`);
  // Un superamento non capovolge l'elemento né esce dall'opacità.
  if (tracks[2] || tracks[3]) {
    parts.push(`scale(${round(Math.max(0, at(2)), 1e4)}, ${round(Math.max(0, at(3)), 1e4)})`);
  }
  if (parts.length > 0) frame.transform = parts.join(" ");
  if (tracks[OPACITY]) frame.opacity = round(Math.min(1, Math.max(0, at(OPACITY))), 1000);
  return frame;
}

/// Una presenza: una corsa che fa apparire o sparire, perché una delle due
/// pose è trasparente.
function isPresence(spec: MotionSpec): boolean {
  return (spec.from?.opacity ?? 1) < 1 || (spec.to?.opacity ?? 1) < 1;
}

/// Nel calmo una presenza fa metà strada: i canali di trasformazione vanno a
/// metà fra la posa e il riposo, l'opacità resta quella.
function halfway(vector: readonly number[]): number[] {
  return vector.map((value, channel) => (channel === OPACITY ? value : REST[channel] + (value - REST[channel]) / 2));
}

function plot(
  from: readonly number[],
  to: readonly number[],
  speed: readonly number[],
  spec: MotionSpec,
  level: MotionLevel,
  presence: boolean,
): Plan | null {
  const reduced = level === "reduced";
  const timed = reduced || spec.duration !== undefined;
  const duration = reduced ? DURATION.state : (spec.duration ?? 0);
  if (timed && !(duration > 0)) return null;

  let sample: (start: number, target: number, channel: number) => number[];
  let easing = "linear";
  let frames = 0;
  if (timed) {
    const curve = curveOf(spec.easing);
    const count = Math.ceil(duration / SAMPLE_MS) + 1;
    easing = curve.css;
    sample = (start, target) =>
      Array.from({ length: count }, (_, index) => {
        return start + (target - start) * curve.at(Math.min(1, (index * SAMPLE_MS) / duration));
      });
  } else {
    const spring = springFor(spec.spring ?? "soft", level === "calm", presence);
    sample = (start, target, channel) =>
      sampleSpring(spring, {
        from: start,
        to: target,
        velocity: speed[channel],
        precision: PRECISION[channel],
      }).values;
  }

  const tracks = from.map((start, channel) => {
    const target = to[channel];
    if (reduced && channel !== OPACITY) return null;
    const idle = start === target && (timed || speed[channel] === 0);
    if (idle && (reduced || target === REST[channel])) return null;
    const values = sample(start, target, channel);
    frames = Math.max(frames, values.length);
    return values;
  });
  if (frames === 0) return null;
  return {
    tracks,
    frames,
    duration: timed ? duration : (frames - 1) * SAMPLE_MS,
    easing,
    sampled: !timed,
  };
}

function hold(run: Run): void {
  let targets = runs.get(run.el);
  if (!targets) {
    targets = new Map();
    runs.set(run.el, targets);
  }
  targets.set(run.pseudo, run);
  alive += 1;
}

function drop(run: Run): void {
  const targets = runs.get(run.el);
  if (targets?.get(run.pseudo) !== run) return;
  targets.delete(run.pseudo);
  if (targets.size === 0) runs.delete(run.el);
  alive -= 1;
}

function adopt(lifetime: Lifetime, run: Run): Teardown {
  let owned = adopted.get(lifetime);
  if (!owned) {
    const fresh = new Set<Run>();
    owned = fresh;
    adopted.set(lifetime, fresh);
    lifetime.add(() => {
      for (const each of [...fresh]) end(each);
    });
  }
  const set = owned;
  set.add(run);
  return () => void set.delete(run);
}

function end(run: Run): void {
  if (!run.alive) return;
  run.alive = false;
  drop(run);
  run.release?.();
  run.handle?.cancel();
  run.onEnd?.();
  run.settle();
}

/// Ferma la corsa viva su `el` (o sul suo pseudo-elemento), se c'è.
export function halt(el: Element, pseudo = ""): void {
  const run = runs.get(el)?.get(pseudo);
  if (run) end(run);
}

/// La posa e la velocità che la corsa viva su `el` (o sul suo pseudo-elemento)
/// ha adesso.
export function liveState(el: Element, pseudo = ""): MotionState | null {
  const run = runs.get(el)?.get(pseudo);
  if (!run) return null;
  const time = (run.handle ? run.handle.time() : 0) - run.delay;
  const state: MotionState = { pose: {}, velocity: {} };
  run.tracks.forEach((track, channel) => {
    if (!track) return;
    const [value, slope] = sampleAt(track, time);
    state.pose[KEYS[channel]] = value;
    state.velocity[KEYS[channel]] = slope;
  });
  return state;
}

/// Aggiunge `ms` di ritardo a ogni corsa avviata dentro `body`: è lo
/// sfalsamento.
export function delayed<T>(ms: number, body: () => T): T {
  const before = ambientDelay;
  ambientDelay = before + ms;
  try {
    return body();
  } finally {
    ambientDelay = before;
  }
}

/// Più corse come una sola.
export function group(motions: readonly Motion[]): Motion {
  return {
    finished: Promise.all(motions.map((motion) => motion.finished)).then(() => undefined),
    cancel: () => motions.forEach((motion) => motion.cancel()),
    finish: () => motions.forEach((motion) => motion.finish()),
    reverse: () => group(motions.map((motion) => motion.reverse())),
    get running() {
      return motions.some((motion) => motion.running);
    },
  };
}

/// `animate`, più ciò che serve a presenza e FLIP.
export function launch(el: Element, spec: MotionSpec, extras: LaunchExtras = {}): Motion {
  const pseudo = spec.pseudo ?? "";
  const state = extras.inherit ?? liveState(el, pseudo);
  halt(el, pseudo);

  const home = vectorOf(spec.from, REST);
  const goal = vectorOf(spec.to, REST);
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const run: Run = {
    el,
    pseudo,
    tracks: [],
    delay: 0,
    handle: null,
    alive: true,
    release: null,
    settle,
    onEnd: extras.onEnd,
  };
  const motion: Motion = {
    finished,
    cancel: () => end(run),
    finish: () => end(run),
    // Si scambiano gli estremi dichiarati, non quelli percorsi: due inversioni
    // tornano a puntare al riposo.
    reverse: () =>
      launch(el, { ...spec, from: poseOf(goal), to: poseOf(home), velocity: undefined, delay: 0 }),
    get running() {
      return run.alive;
    },
  };

  const driver = motionDriver();
  const level = motionLevel();
  const reduced = level === "reduced";
  const skipped = spec.lifetime?.closed || driver.instant || (reduced && spec.whenReduced !== "fade");
  // Gli estremi dichiarati restano quelli di `reverse`: la metà strada è del
  // percorso, non della corsa.
  const presence = level === "calm" && isPresence(spec);
  const start = presence ? halfway(home) : home;
  const plan = skipped
    ? null
    : plot(
        state ? vectorOf(state.pose, start) : start,
        presence ? halfway(goal) : goal,
        vectorOf(state ? { ...spec.velocity, ...state.velocity } : spec.velocity, STILL),
        spec,
        level,
        presence,
      );
  if (!plan) {
    end(run);
    return motion;
  }

  const limit = extras.limit ?? Infinity;
  const delay = Math.min(limit, Math.max(0, (spec.delay || 0) + (reduced ? 0 : ambientDelay)));
  let { frames, duration } = plan;
  if (delay + duration > limit) {
    // Troncata: i campioni restano quelli, la corsa finisce prima.
    frames = Math.floor((limit - delay) / SAMPLE_MS) + 1;
    duration = plan.sampled ? (frames - 1) * SAMPLE_MS : limit - delay;
  }
  if (!(duration > 0)) {
    end(run);
    return motion;
  }
  const keyframes = plan.sampled
    ? Array.from({ length: frames }, (_, index) => keyframe(plan.tracks, index))
    : [keyframe(plan.tracks, 0), keyframe(plan.tracks, Infinity)];

  run.tracks = plan.tracks;
  run.delay = delay;
  hold(run);
  if (spec.lifetime) run.release = adopt(spec.lifetime, run);
  const timing = { duration, delay, easing: plan.easing, ...(pseudo ? { pseudo } : {}) };
  try {
    const handle = driver.play(el, keyframes, timing, () => end(run));
    // Un motore può aver già concluso dentro `play`: allora non c'è niente da tenere.
    if (run.alive) run.handle = handle;
  } catch {
    // Un motore che rifiuta i fotogrammi non lascia una corsa appesa, e un
    // movimento mancato non interrompe chi ha già cambiato lo stato.
    end(run);
  }
  return motion;
}

/// Anima `el` da una posa a un'altra. Una corsa già viva sullo stesso elemento
/// viene annullata, e i suoi canali proseguono da posa e velocità correnti.
export function animate(el: Element, spec: MotionSpec = {}): Motion {
  return launch(el, spec);
}

/// Le corse vive più i cicli iscritti all'orologio: a riposo è zero.
export function activeMotions(): number {
  return alive + frameListeners();
}
