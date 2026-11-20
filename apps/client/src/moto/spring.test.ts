// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createFramePacer, resetScreenPeriod } from "../theme/frame-rate";
import {
  DURATION,
  EXIT_SAFETY_MS,
  PRESS_SCALE,
  MIN_SAMPLE_MS,
  SAMPLE_MS,
  SKELETON_DELAY_MS,
  SPRING_MAX_MS,
  SPRINGS,
  STAGGER_MAX,
  STAGGER_MS,
  calmPresence,
  critical,
  invalidateSpringTokens,
  resolveSpring,
  samplePeriodMs,
  sampleSpring,
  springFor,
  type SpringName,
} from "./spring";

const NAMES = Object.keys(SPRINGS) as SpringName[];

/// L'integrazione del modello vivo del piano: passo di 1/480 s, velocità prima
/// della posizione, un campione ogni otto passi.
function reference(k: number, c: number, samples: number): number[] {
  const h = 1 / 480;
  let x = 0;
  let v = 0;
  const out = [x];
  for (let i = 1; i <= samples * 8; i++) {
    v += (-k * (x - 1) - c * v) * h;
    x += v * h;
    if (i % 8 === 0) out.push(x);
  }
  return out;
}

describe("i parametri del disegno", () => {
  it("le cinque molle e le costanti sono quelle del piano", () => {
    expect(SPRINGS).toEqual({
      snap: { stiffness: 560, damping: 38 },
      soft: { stiffness: 300, damping: 30 },
      wide: { stiffness: 170, damping: 24 },
      elastic: { stiffness: 420, damping: 20 },
      jelly: { stiffness: 260, damping: 12 },
    });
    expect(DURATION).toEqual({ state: 90, swap: 140, short: 220, large: 360, scene: 560 });
    expect([PRESS_SCALE, STAGGER_MS, STAGGER_MAX]).toEqual([0.97, 12, 8]);
    expect([EXIT_SAFETY_MS, SKELETON_DELAY_MS]).toEqual([600, 120]);
  });
});

describe("sampleSpring", () => {
  it("parte da `from`, si assesta e finisce esattamente su `to`", () => {
    for (const name of NAMES) {
      const { values, duration } = sampleSpring(SPRINGS[name], { from: 20, to: 120 });
      expect(values[0]).toBe(20);
      expect(values[values.length - 1]).toBe(120);
      expect(duration).toBeCloseTo((values.length - 1) * SAMPLE_MS, 9);
      // Assestata davvero, non chiusa dal tetto: gli ultimi campioni sono già
      // a un soffio dal bersaglio.
      expect(duration).toBeLessThan(SPRING_MAX_MS);
      expect(Math.abs(values[values.length - 2] - 120)).toBeLessThan(0.5);
    }
  });

  it("coincide con l'integrazione del modello vivo, campione per campione", () => {
    for (const name of NAMES) {
      const { stiffness, damping } = SPRINGS[name];
      const { values } = sampleSpring(SPRINGS[name], { from: 0, to: 1 });
      const expected = reference(stiffness, damping, values.length - 2);
      // L'ultimo campione è lo scatto sul bersaglio: gli altri sono la curva.
      expect(values.slice(0, -1)).toEqual(expected);
    }
  });

  it("Elastico e Gelatina superano il bersaglio, e con `critical` nessuna lo supera", () => {
    const peak = (values: number[]) => Math.max(...values);
    expect(peak(sampleSpring(SPRINGS.elastic, { from: 0, to: 1 }).values)).toBeGreaterThan(1.05);
    expect(peak(sampleSpring(SPRINGS.jelly, { from: 0, to: 1 }).values)).toBeGreaterThan(1.2);
    for (const name of NAMES) {
      const calm = sampleSpring(critical(SPRINGS[name]), { from: 0, to: 1 }).values;
      expect(peak(calm)).toBe(1);
      // E scendendo: nessun campione passa sotto.
      const down = sampleSpring(critical(SPRINGS[name]), { from: 1, to: 0 }).values;
      expect(Math.min(...down)).toBe(0);
    }
  });

  it("è pura e deterministica", () => {
    const spring = { stiffness: 420, damping: 20 };
    const travel = { from: -3, to: 7, velocity: 0.4 };
    const first = sampleSpring(spring, travel);
    const second = sampleSpring(spring, travel);
    expect(second).toEqual(first);
    expect(second.values).not.toBe(first.values);
    expect(spring).toEqual({ stiffness: 420, damping: 20 });
    expect(travel).toEqual({ from: -3, to: 7, velocity: 0.4 });
  });

  it("la velocità iniziale è in unità al millisecondo e si sente dal primo campione", () => {
    const still = sampleSpring(SPRINGS.soft, { from: 0, to: 100 }).values;
    const pushed = sampleSpring(SPRINGS.soft, { from: 0, to: 100, velocity: 1 }).values;
    const against = sampleSpring(SPRINGS.soft, { from: 0, to: 100, velocity: -1 }).values;
    // 1 px/ms per un sessantesimo di secondo sono quasi 17 px in più.
    expect(pushed[1] - still[1]).toBeGreaterThan(12);
    expect(pushed[1] - still[1]).toBeLessThan(17);
    expect(against[1]).toBeLessThan(0);
    expect(against[against.length - 1]).toBe(100);
  });

  it("una spinta da fermo sul bersaglio parte e torna", () => {
    const { values } = sampleSpring(SPRINGS.elastic, { from: 5, to: 5, velocity: 2 });
    expect(Math.max(...values)).toBeGreaterThan(20);
    expect(values[values.length - 1]).toBe(5);
    expect(sampleSpring(SPRINGS.elastic, { from: 5, to: 5 }).values).toEqual([5, 5]);
  });

  it("una soglia più larga accorcia la coda", () => {
    const fine = sampleSpring(SPRINGS.jelly, { from: 0, to: 10 });
    const coarse = sampleSpring(SPRINGS.jelly, { from: 0, to: 10, precision: 0.5 });
    expect(coarse.duration).toBeLessThan(fine.duration);
    expect(coarse.values[coarse.values.length - 1]).toBe(10);
  });

  it("una molla che non si assesta è chiusa dal tetto, e una instabile non dà valori non finiti", () => {
    const endless = sampleSpring({ stiffness: 200, damping: 0.001 }, { from: 0, to: 1 });
    expect(endless.duration).toBeCloseTo(SPRING_MAX_MS, 6);
    expect(endless.values[endless.values.length - 1]).toBe(1);

    const unstable = sampleSpring({ stiffness: 1e9, damping: 1 }, { from: 0, to: 1 });
    expect(unstable.values.every(Number.isFinite)).toBe(true);
    expect(unstable.values[unstable.values.length - 1]).toBe(1);
  });
});

/// Un pacer che vede `frames` fotogrammi di uno schermo a `hz`.
function watchScreen(hz: number, frames = 20): void {
  const pacer = createFramePacer(() => 0);
  for (let k = 0; k < frames; k++) pacer.admit((k * 1000) / hz);
}

/// Il valore di una tabella a `time` ms, come lo interpola il browser.
function between(values: readonly number[], period: number, time: number): number {
  const position = Math.min(time / period, values.length - 1);
  const index = Math.min(Math.floor(position), values.length - 2);
  return values[index]! + (values[index + 1]! - values[index]!) * (position - index);
}

describe("il ritmo dei campioni", () => {
  afterEach(() => resetScreenPeriod());

  it("segue lo schermo, fra 60 e 240 Hz", () => {
    expect(samplePeriodMs()).toBeCloseTo(SAMPLE_MS, 9);
    watchScreen(180);
    expect(samplePeriodMs()).toBeCloseTo(1000 / 180, 9);
    resetScreenPeriod();
    watchScreen(360);
    expect(samplePeriodMs()).toBeCloseTo(MIN_SAMPLE_MS, 9);
    resetScreenPeriod();
    watchScreen(30);
    expect(samplePeriodMs()).toBeCloseTo(SAMPLE_MS, 9);
  });

  it("a 180 Hz è la stessa traiettoria: un campione su tre è quello a 60 Hz", () => {
    for (const name of NAMES) {
      for (const travel of [{ from: 0, to: 1 }, { from: 300, to: 0, velocity: -1.5, precision: 0.05 }]) {
        const slow = sampleSpring(SPRINGS[name], travel, SAMPLE_MS);
        const fast = sampleSpring(SPRINGS[name], travel, 1000 / 180);
        expect(fast.period).toBeCloseTo(1000 / 180, 9);
        expect(fast.duration).toBeCloseTo((fast.values.length - 1) * fast.period, 9);
        // L'assestamento cade nello stesso sessantesimo di secondo.
        expect(Math.abs(fast.duration - slow.duration)).toBeLessThanOrEqual(SAMPLE_MS);
        for (let k = 1; k < slow.values.length - 1 && 3 * k < fast.values.length - 1; k++) {
          expect(fast.values[3 * k]).toBeCloseTo(slow.values[k]!, 9);
        }
      }
    }
  });

  it("fra due fotogrammi chiave a 180 Hz la corsa resta sulla curva; a 60 ne usciva", () => {
    // Lo scarto massimo fra la tabella interpolata dal browser e la curva vera
    // (presa a 1440 Hz), su una corsa di 300 px della molla più rigida.
    const travel = { from: 300, to: 0, precision: 0.05 };
    const truth = sampleSpring(SPRINGS.snap, travel, 1000 / 1440);
    const gap = (period: number): number => {
      const table = sampleSpring(SPRINGS.snap, travel, period).values;
      let worst = 0;
      for (let k = 0; k < truth.values.length - 1; k++) {
        worst = Math.max(worst, Math.abs(between(table, period, k * truth.period) - truth.values[k]!));
      }
      return worst;
    };
    expect(gap(SAMPLE_MS)).toBeGreaterThan(2);
    expect(gap(1000 / 180)).toBeLessThan(gap(SAMPLE_MS) / 6);
  });
});

describe("critical", () => {
  it("tiene la rigidezza e porta lo smorzamento al valore critico", () => {
    expect(critical({ stiffness: 400, damping: 10 })).toEqual({ stiffness: 400, damping: 40 });
    expect(critical({ stiffness: 100, damping: 5, mass: 4 })).toEqual({
      stiffness: 100,
      damping: 40,
      mass: 4,
    });
  });

  it("non rende più svelta una molla già sovrasmorzata", () => {
    expect(critical({ stiffness: 100, damping: 50 })).toEqual({ stiffness: 100, damping: 50 });
  });
});

describe("calmPresence", () => {
  const speed = (values: number[]): number =>
    Math.max(...values.slice(1).map((value, index) => Math.abs(value - values[index]!)));

  it.each(NAMES)("%s: metà strada senza superamento, e non più lunga della molla piena", (name) => {
    const full = sampleSpring(SPRINGS[name], { from: 0, to: 1 });
    const calm = calmPresence(SPRINGS[name]);
    const half = sampleSpring(calm, { from: 0.5, to: 1 });
    expect(Math.max(...half.values)).toBe(1);
    expect(sampleSpring(calm, { from: 0, to: 1 }).duration).toBeLessThanOrEqual(full.duration);
    expect(half.duration).toBeLessThanOrEqual(full.duration);
    expect(speed(half.values)).toBeLessThanOrEqual(speed(full.values));
    // Critica, e la rigidezza non scende mai sotto quella piena.
    expect(calm.damping).toBeCloseTo(2 * Math.sqrt(calm.stiffness), 6);
    expect(calm.stiffness).toBeGreaterThanOrEqual(SPRINGS[name].stiffness);
  });

  it("dà le rigidezze del piano", () => {
    const k = Object.fromEntries(NAMES.map((name) => [name, calmPresence(SPRINGS[name]).stiffness]));
    expect(k.snap).toBeGreaterThan(600);
    expect(k.snap).toBeLessThan(700);
    expect(k.soft).toBeGreaterThan(330);
    expect(k.soft).toBeLessThan(410);
  });

  it("`springFor` la dà alle presenze del calmo, e `critical` al resto", () => {
    expect(springFor("soft", true, true)).toEqual(calmPresence(SPRINGS.soft));
    expect(springFor("soft", true)).toEqual(critical(SPRINGS.soft));
    expect(springFor("soft", false, true)).toEqual(SPRINGS.soft);
  });
});

describe("i token della pelle", () => {
  const root = document.documentElement;

  afterEach(() => {
    root.removeAttribute("style");
    invalidateSpringTokens();
  });

  it("senza token valgono le molle di serie", () => {
    expect(resolveSpring("soft")).toBe(SPRINGS.soft);
  });

  it("legge rigidezza e smorzamento da `:root`", () => {
    root.style.setProperty("--spring-soft-k", "123");
    root.style.setProperty("--spring-soft-c", " 14.5 ");
    expect(resolveSpring("soft")).toEqual({ stiffness: 123, damping: 14.5 });
    // Le altre non cambiano.
    expect(resolveSpring("snap")).toBe(SPRINGS.snap);
  });

  it("un token solo sostituisce solo il suo parametro", () => {
    root.style.setProperty("--spring-wide-c", "9");
    expect(resolveSpring("wide")).toEqual({ stiffness: 170, damping: 9 });
  });

  it("un token che non è un numero finito positivo ricade sul valore di serie", () => {
    for (const bad of ["molle", "0", "-40", "Infinity", "12px"]) {
      root.style.setProperty("--spring-jelly-k", bad);
      root.style.setProperty("--spring-jelly-c", bad);
      invalidateSpringTokens();
      expect(resolveSpring("jelly"), bad).toBe(SPRINGS.jelly);
    }
  });

  it("tiene i valori letti finché non li si invalida", () => {
    root.style.setProperty("--spring-snap-k", "700");
    expect(resolveSpring("snap").stiffness).toBe(700);
    root.style.setProperty("--spring-snap-k", "800");
    expect(resolveSpring("snap").stiffness).toBe(700);
    invalidateSpringTokens();
    expect(resolveSpring("snap").stiffness).toBe(800);
  });

  it("accetta un'altra radice", () => {
    const scope = document.createElement("div");
    document.body.append(scope);
    scope.style.setProperty("--spring-elastic-k", "333");
    expect(resolveSpring("elastic", scope).stiffness).toBe(333);
    expect(resolveSpring("elastic")).toBe(SPRINGS.elastic);
    scope.remove();
  });

  it("`springFor` risolve il nome e calma quando serve", () => {
    root.style.setProperty("--spring-elastic-k", "400");
    expect(springFor("elastic", false)).toEqual({ stiffness: 400, damping: 20 });
    expect(springFor("elastic", true)).toEqual({ stiffness: 400, damping: 40 });
    const own = { stiffness: 90, damping: 3 };
    expect(springFor(own, false)).toBe(own);
  });
});
