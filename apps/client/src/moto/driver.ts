// I motori del movimento: chi fa scorrere davvero una corsa.
//
// `animate` prepara i fotogrammi chiave e li consegna a un motore; il resto
// del modulo non sa quale. Sono tre e si scambiano senza toccare altro: WAAPI
// (`Element.animate`), istantaneo (dove `Element.animate` non esiste, cioè
// sotto happy-dom) e manuale (i test e il banco, che hanno il tempo fermo). Il
// motore possiede anche l'orologio dei cicli in proprio: `now` e i fotogrammi.

export interface DriverTiming {
  /// Durata della parte attiva (ms).
  readonly duration: number;
  /// Attesa prima della parte attiva (ms). Intanto vale il primo fotogramma
  /// chiave, non il riposo.
  readonly delay: number;
  /// `linear` fra i campioni di una molla, una `cubic-bezier()` per una curva a
  /// tempo.
  readonly easing: string;
  /// Lo pseudo-elemento di `el` che si muove al suo posto (`::before`,
  /// `::after`); senza, si muove l'elemento.
  readonly pseudo?: string;
}

export interface DriverRun {
  /// Millisecondi trascorsi dall'avvio, ritardo compreso.
  time(): number;
  /// Toglie l'effetto subito, senza chiamare `done`.
  cancel(): void;
}

export interface MotionDriver {
  /// Vero se il motore non mostra niente: allora `animate` non lo interpella e
  /// i valori a molla saltano al bersaglio.
  readonly instant: boolean;
  now(): number;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  /// Fa scorrere i fotogrammi su `el` e chiama `done` una volta, alla fine
  /// naturale. Finita o annullata, la corsa non lascia niente sull'elemento.
  play(el: Element, keyframes: Keyframe[], timing: DriverTiming, done: () => void): DriverRun;
}

/// Quanto si aspetta, oltre la durata, un `finish` che non arriva (ms).
const GUARD_SLACK_MS = 100;

/// Mai `fill: forwards`: lo stato di riposo è quello del CSS. `backwards` serve
/// al solo ritardo, perché l'attesa mostri la posa di partenza.
function effect(timing: DriverTiming): KeyframeAnimationOptions {
  const options: KeyframeAnimationOptions = {
    duration: timing.duration,
    delay: timing.delay,
    easing: timing.easing,
    fill: "backwards",
  };
  if (timing.pseudo) options.pseudoElement = timing.pseudo;
  return options;
}

/// I fotogrammi del browser. L'identificativo torna a chi chiede, che ne è il
/// proprietario e lo annulla con `cancelFrame`.
const browserFrames = {
  now: (): number => performance.now(),
  requestFrame(callback: (time: number) => void): number {
    const id = requestAnimationFrame(callback);
    return id;
  },
  cancelFrame(id: number): void {
    cancelAnimationFrame(id);
  },
};

const IDLE_RUN: DriverRun = { time: () => 0, cancel: () => {} };

const waapiDriver: MotionDriver = {
  instant: false,
  ...browserFrames,
  play(el, keyframes, timing, done) {
    const animation = el.animate(keyframes, effect(timing));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let open = true;
    const close = (finished: boolean): void => {
      if (!open) return;
      open = false;
      clearTimeout(timer);
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      if (finished) done();
    };
    // Anche un annullamento da fuori chiude la corsa: nessuno resta in attesa.
    animation.onfinish = () => close(true);
    animation.oncancel = () => close(true);
    // Un `finish` perso (scheda nascosta, motore capriccioso) non tiene appesa
    // la corsa né chi ne aspetta la fine.
    timer = setTimeout(() => close(true), timing.delay + timing.duration + GUARD_SLACK_MS);
    return {
      time() {
        const time = animation.currentTime;
        return typeof time === "number" ? time : 0;
      },
      cancel: () => close(false),
    };
  },
};

const instantDriver: MotionDriver = {
  instant: true,
  ...browserFrames,
  play(_el, _keyframes, _timing, done) {
    done();
    return IDLE_RUN;
  },
};

/// Ciò che il motore manuale ha ricevuto, per le prove.
export interface RecordedPlay {
  readonly el: Element;
  readonly keyframes: readonly Keyframe[];
  readonly timing: DriverTiming;
  readonly state: "running" | "finished" | "canceled";
}

export interface ManualDriver extends MotionDriver {
  /// Fa passare `ms` a fotogrammi di un sessantesimo di secondo: a ogni passo
  /// chiude le corse arrivate in fondo e serve i fotogrammi chiesti.
  advance(ms: number): void;
  /// Ogni `play` ricevuto, nell'ordine.
  readonly plays: readonly RecordedPlay[];
}

interface ManualPlay extends RecordedPlay {
  state: RecordedPlay["state"];
  readonly start: number;
  readonly done: () => void;
  readonly animation: Animation | null;
}

/// Un motore il cui tempo avanza solo con `advance`. Dove `Element.animate`
/// esiste tiene l'animazione in pausa e ne sposta il tempo, così ciò che si
/// vede è la posa di quell'istante e non dipende dall'orologio del browser.
export function createManualDriver(): ManualDriver {
  const frame = 1000 / 60;
  let clock = 0;
  let lastFrame = 0;
  const frames = new Map<number, (time: number) => void>();
  const plays: ManualPlay[] = [];
  const running = new Set<ManualPlay>();

  const settle = (play: ManualPlay, state: "finished" | "canceled"): boolean => {
    if (!running.delete(play)) return false;
    play.state = state;
    play.animation?.cancel();
    return true;
  };

  return {
    instant: false,
    plays,
    now: () => clock,
    requestFrame(callback) {
      frames.set(++lastFrame, callback);
      return lastFrame;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    play(el, keyframes, timing, done) {
      const animation = typeof el.animate === "function" ? el.animate(keyframes, effect(timing)) : null;
      animation?.pause();
      const play: ManualPlay = { el, keyframes, timing, state: "running", start: clock, done, animation };
      plays.push(play);
      running.add(play);
      return { time: () => clock - play.start, cancel: () => void settle(play, "canceled") };
    },
    advance(ms) {
      let left = ms;
      while (left > 1e-9) {
        const step = Math.min(left, frame);
        left -= step;
        clock += step;
        for (const play of [...running]) {
          const elapsed = clock - play.start;
          if (elapsed >= play.timing.delay + play.timing.duration - 1e-6) {
            if (settle(play, "finished")) play.done();
          } else if (play.animation) {
            play.animation.currentTime = elapsed;
          }
        }
        // I fotogrammi chiesti durante il giro sono del passo dopo; uno
        // annullato da un altro nello stesso giro non parte.
        for (const id of [...frames.keys()]) {
          const callback = frames.get(id);
          if (!callback) continue;
          frames.delete(id);
          callback(clock);
        }
      }
    },
  };
}

let chosen: MotionDriver | null = null;

/// Sostituisce il motore (i test, il banco); `null` torna alla scelta
/// automatica. Va fatto a corse ferme: quelle vive restano del motore vecchio.
export function setMotionDriver(driver: MotionDriver | null): void {
  chosen = driver;
}

/// Il motore in vigore: quello imposto, altrimenti WAAPI dove esiste e
/// l'istantaneo altrove.
export function motionDriver(): MotionDriver {
  if (chosen) return chosen;
  const waapi = typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
  return waapi ? waapiDriver : instantDriver;
}
