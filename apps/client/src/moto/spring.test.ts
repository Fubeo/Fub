// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  DURATION,
  EXIT_SAFETY_MS,
  MAX_TILT_DEG,
  PRESS_SCALE,
  SAMPLE_MS,
  SKELETON_DELAY_MS,
  SPRING_MAX_MS,
  SPRINGS,
  STAGGER_MAX,
  STAGGER_MS,
  critical,
  invalidateSpringTokens,
  resolveSpring,
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
    expect([PRESS_SCALE, STAGGER_MS, STAGGER_MAX, MAX_TILT_DEG]).toEqual([0.97, 12, 8, 4]);
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
