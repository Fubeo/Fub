import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REFERENCE_PERIOD_MS,
  createFramePacer,
  frameRateCapOf,
  probeScreenPeriod,
  resetScreenPeriod,
  screenPeriodMs,
  type FrameSource,
} from "./frame-rate";

/// I callback di uno schermo a `hz` per `ms`, a partire da `from`.
function vsyncs(hz: number, ms: number, from = 0): number[] {
  const period = 1000 / hz;
  const out: number[] = [];
  for (let t = from; t < from + ms; t += period) out.push(t);
  return out;
}

function admitted(hz: number, cap: number, ms: number): number[] {
  const pacer = createFramePacer(() => cap);
  return vsyncs(hz, ms).filter((t) => pacer.admit(t));
}

describe("frameRateCapOf", () => {
  it("riconosce solo i tetti offerti; il resto è il massimo dello schermo", () => {
    expect(frameRateCapOf("")).toBe(0);
    expect(frameRateCapOf("144")).toBe(144);
    expect(frameRateCapOf("180")).toBe(180);
    expect(frameRateCapOf("30")).toBe(30);
    expect(frameRateCapOf("59")).toBe(0);
    expect(frameRateCapOf(120)).toBe(0);
    expect(frameRateCapOf(undefined)).toBe(0);
  });
});

describe("createFramePacer", () => {
  it("senza tetto ammette ogni fotogramma, a qualunque refresh", () => {
    for (const hz of [30, 60, 90, 120, 144, 165, 240, 360]) {
      expect(admitted(hz, 0, 1000)).toHaveLength(vsyncs(hz, 1000).length);
    }
  });

  it("stima il periodo dello schermo e ignora i fotogrammi persi", () => {
    const pacer = createFramePacer(() => 0);
    let t = 0;
    for (let k = 0; k < 30; k++) {
      // uno su cinque dura il doppio
      t += k % 5 === 4 ? 2000 / 144 : 1000 / 144;
      pacer.admit(t);
    }
    expect(pacer.displayPeriodMs()).toBeCloseTo(1000 / 144, 6);
    expect(pacer.periodMs()).toBeCloseTo(1000 / 144, 6);
    expect(pacer.capPeriodMs()).toBe(0);
  });

  it("tiene la media del tetto anche quando non divide il refresh", () => {
    // un secondo di fotogrammi: 60 su 144 Hz, 120 su 144, 30 su 60, 144 su 240
    for (const [hz, cap] of [[144, 60], [144, 120], [60, 30], [240, 144], [165, 90]]) {
      const frames = admitted(hz, cap, 10_000).length / 10;
      expect(Math.abs(frames - cap)).toBeLessThanOrEqual(1);
    }
  });

  it("con un tetto che divide il refresh la cadenza è regolare", () => {
    const frames = admitted(120, 60, 1000);
    for (let k = 2; k < frames.length; k++) {
      expect(frames[k] - frames[k - 1]).toBeCloseTo(1000 / 60, 6);
    }
  });

  it("un tetto sopra il refresh non scarta niente", () => {
    expect(admitted(60, 144, 1000)).toHaveLength(vsyncs(60, 1000).length);
  });

  it("dopo un fotogramma lungo riparte senza raffica", () => {
    const pacer = createFramePacer(() => 60);
    for (const t of vsyncs(144, 200)) pacer.admit(t);
    // mezzo secondo fermo, poi di nuovo a 144 Hz
    const after = vsyncs(144, 100, 700).filter((t) => pacer.admit(t));
    for (let k = 1; k < after.length; k++) expect(after[k] - after[k - 1]).toBeGreaterThan(12);
  });

  it("al risveglio il primo fotogramma passa subito e la pausa non è un intervallo", () => {
    const pacer = createFramePacer(() => 30);
    for (const t of vsyncs(60, 200)) pacer.admit(t);
    pacer.pause();
    expect(pacer.admit(5000)).toBe(true);
    expect(pacer.displayPeriodMs()).toBeCloseTo(1000 / 60, 6);
    expect(pacer.periodMs()).toBeCloseTo(1000 / 30, 6);
    expect(pacer.capPeriodMs()).toBeCloseTo(1000 / 30, 6);
  });

  it("il budget è il periodo dello schermo e non si allunga sotto carico", () => {
    const pacer = createFramePacer(() => 0);
    // finché la finestra non è piena il budget è largo
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 60, 6);
    let t = 0;
    for (let k = 0; k < 20; k++) pacer.admit((t += 1000 / 180));
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 180, 6);
    // ogni fotogramma ne perde uno: la stima va a 90 Hz, il budget resta
    for (let k = 0; k < 40; k++) pacer.admit((t += 2000 / 180));
    expect(pacer.displayPeriodMs()).toBeCloseTo(2000 / 180, 6);
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 180, 6);
  });

  it("un loop che parte già carico non ha un budget più stretto del suo ritmo", () => {
    const pacer = createFramePacer(() => 0);
    let t = 0;
    for (let k = 0; k < 20; k++) pacer.admit((t += 2000 / 180));
    expect(pacer.budgetMs()).toBeCloseTo(2000 / 180, 6);
  });

  it("col tetto il budget è il suo periodo, se è più lento dello schermo", () => {
    let cap = 30;
    const pacer = createFramePacer(() => cap);
    for (const t of vsyncs(180, 200)) pacer.admit(t);
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 30, 6);
    cap = 240;
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 180, 6);
  });

  it("al risveglio il periodo dello schermo si rimpara", () => {
    const pacer = createFramePacer(() => 0);
    for (const t of vsyncs(180, 200)) pacer.admit(t);
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 180, 6);
    pacer.pause();
    // la finestra passa su un monitor a 60 Hz mentre il loop dorme
    for (const t of vsyncs(60, 300, 5000)) pacer.admit(t);
    expect(pacer.budgetMs()).toBeCloseTo(1000 / 60, 6);
  });
});

/// Uno schermo finto: i fotogrammi chiesti partono con `run`, a `hz`.
function fakeScreen(hz: number): FrameSource & { requests: number; run(): void; clock: number } {
  let queue: ((time: number) => void)[] = [];
  const screen = {
    requests: 0,
    clock: 0,
    now: () => screen.clock,
    requestFrame(callback: (time: number) => void): number {
      screen.requests++;
      queue.push(callback);
      return screen.requests;
    },
    run() {
      while (queue.length > 0) {
        const due = queue;
        queue = [];
        screen.clock += 1000 / hz;
        for (const callback of due) callback(screen.clock);
      }
    },
  };
  return screen;
}

describe("il periodo dello schermo per chi non ha un loop", () => {
  beforeEach(() => resetScreenPeriod());
  afterEach(() => resetScreenPeriod());

  it("vale 60 Hz finché nessuno l'ha misurato, poi il più corto visto", () => {
    expect(screenPeriodMs()).toBe(REFERENCE_PERIOD_MS);
    const pacer = createFramePacer(() => 0);
    for (const t of vsyncs(180, 200)) pacer.admit(t);
    expect(screenPeriodMs()).toBeCloseTo(1000 / 180, 6);
    // un altro loop sotto carico non lo allunga
    const loaded = createFramePacer(() => 0);
    for (const t of vsyncs(90, 200)) loaded.admit(t);
    expect(screenPeriodMs()).toBeCloseTo(1000 / 180, 6);
  });

  it("una sonda di pochi fotogrammi lo misura e si ferma da sé", () => {
    const screen = fakeScreen(180);
    probeScreenPeriod(screen);
    screen.run();
    expect(screen.requests).toBeLessThan(15);
    expect(screenPeriodMs()).toBeCloseTo(1000 / 180, 6);
    // uno schermo veloce noto non si misura più
    probeScreenPeriod(screen);
    expect(screen.requests).toBeLessThan(15);
  });

  it("a 60 Hz la sonda si ripete, ma non prima di trenta secondi", () => {
    const screen = fakeScreen(60);
    probeScreenPeriod(screen);
    screen.run();
    const first = screen.requests;
    expect(screenPeriodMs()).toBeCloseTo(1000 / 60, 6);
    probeScreenPeriod(screen);
    expect(screen.requests).toBe(first);
    screen.clock += 30_000;
    probeScreenPeriod(screen);
    screen.run();
    expect(screen.requests).toBe(2 * first);
  });
});

