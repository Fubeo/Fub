// Un valore a molla vivo, per ciò che segue il puntatore.
//
// Un cassetto che si trascina o un'inclinazione che insegue la velocità non
// hanno una posa d'arrivo da campionare prima: il bersaglio cambia a ogni
// movimento. Il valore si integra allora fotogramma per fotogramma,
// sull'orologio unico, e chi lo usa decide che cosa farne in `onUpdate`.
import type { Lifetime, Teardown } from "../ui/lifetime";
import { motionDriver } from "./driver";
import { motionLevel } from "./level";
import {
  advanceSpring,
  restPrecision,
  springAtRest,
  springFor,
  type Spring,
  type SpringName,
  type SpringState,
} from "./spring";
import { onFrame } from "./ticker";

export interface SpringValueOptions {
  spring: SpringName | Spring;
  initial: number;
  /// Chiamata a ogni fotogramma in cui il valore cambia, e da `jump`.
  onUpdate: (value: number) => void;
  /// Soglia assoluta sotto cui il valore è fermo, se più larga di quella
  /// relativa alla corsa.
  precision?: number;
  /// Chiuderla ferma il valore e lo rende inerte.
  lifetime?: Lifetime;
}

export interface SpringValue {
  /// Punta a `target`, dalla posizione e dalla velocità correnti. `velocity`
  /// (unità al millisecondo) le dà una spinta, per esempio quella di un
  /// rilascio. Nel livello «ridotto» salta subito al bersaglio.
  set(target: number, velocity?: number): void;
  /// Porta il valore a `value` senza molla, e lo ferma lì.
  jump(value: number): void;
  get(): number;
  /// La velocità corrente, in unità al millisecondo.
  velocity(): number;
  /// Ferma il valore dov'è. Un `set` successivo lo rimette in moto.
  stop(): void;
}

export function springValue(options: SpringValueOptions): SpringValue {
  const state: SpringState = { x: options.initial, v: 0 };
  let target = options.initial;
  let precision = 0;
  let spring: Spring | null = null;
  let release: Teardown | null = null;
  let closed = false;

  const rest = (): void => {
    release?.();
    release = null;
    state.v = 0;
  };
  const jump = (value: number): void => {
    if (closed) return;
    rest();
    target = value;
    state.x = value;
    options.onUpdate(value);
  };
  const step = (elapsed: number): void => {
    if (!spring) return;
    advanceSpring(spring, state, target, elapsed / 1000);
    if (springAtRest(state, target, precision)) {
      state.x = target;
      rest();
    }
    options.onUpdate(state.x);
  };

  options.lifetime?.add(() => {
    rest();
    closed = true;
  });

  return {
    set(next, velocity) {
      if (closed) return;
      const level = motionLevel();
      if (level === "reduced" || motionDriver().instant) {
        if (next !== state.x || release) jump(next);
        return;
      }
      if (velocity !== undefined) state.v = velocity * 1000;
      target = next;
      if (next === state.x && state.v === 0) return;
      spring = springFor(options.spring, level === "calm");
      precision = restPrecision(next - state.x, options.precision);
      if (!release) release = onFrame(step);
    },
    jump,
    get: () => state.x,
    velocity: () => state.v / 1000,
    stop() {
      rest();
      target = state.x;
    },
  };
}
