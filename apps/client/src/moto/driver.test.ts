// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualDriver, motionDriver, setMotionDriver } from "./driver";

/// Ciò che il motore WAAPI tocca di un'`Animation`.
class FakeAnimation {
  currentTime: number | null = 0;
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  canceled = 0;
  paused = false;
  constructor(
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {}
  cancel(): void {
    this.canceled++;
  }
  pause(): void {
    this.paused = true;
  }
}

/// happy-dom non ha `Element.animate`: qui lo si presta, per il tempo di una prova.
function lendAnimate(): { created: FakeAnimation[]; restore(): void } {
  const created: FakeAnimation[] = [];
  const prototype = Element.prototype as unknown as { animate?: unknown };
  prototype.animate = function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = new FakeAnimation(keyframes, options);
    created.push(animation);
    return animation;
  };
  return { created, restore: () => void delete prototype.animate };
}

const FRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const TIMING = { duration: 200, delay: 40, easing: "linear" };

afterEach(() => {
  setMotionDriver(null);
  vi.useRealTimers();
});

describe("la scelta del motore", () => {
  it("senza `Element.animate` è l'istantaneo, che conclude dentro `play`", () => {
    const driver = motionDriver();
    expect(driver.instant).toBe(true);
    const done = vi.fn();
    const run = driver.play(document.createElement("div"), FRAMES, TIMING, done);
    expect(done).toHaveBeenCalledTimes(1);
    run.cancel();
    expect(run.time()).toBe(0);
  });

  it("dove `Element.animate` esiste è WAAPI, e `setMotionDriver` lo scavalca e lo ridà", () => {
    const lent = lendAnimate();
    try {
      expect(motionDriver().instant).toBe(false);
      const manual = createManualDriver();
      setMotionDriver(manual);
      expect(motionDriver()).toBe(manual);
      setMotionDriver(null);
      expect(motionDriver()).not.toBe(manual);
    } finally {
      lent.restore();
    }
    expect(motionDriver().instant).toBe(true);
  });
});

describe("il motore WAAPI", () => {
  it("consegna i fotogrammi senza riempimento in avanti e conclude al `finish`", () => {
    const lent = lendAnimate();
    try {
      const done = vi.fn();
      const run = motionDriver().play(document.createElement("div"), FRAMES, TIMING, done);
      const [animation] = lent.created;
      expect(animation.keyframes).toBe(FRAMES);
      expect(animation.options).toEqual({ duration: 200, delay: 40, easing: "linear", fill: "backwards" });

      animation.currentTime = 75;
      expect(run.time()).toBe(75);
      animation.currentTime = null;
      expect(run.time()).toBe(0);

      animation.onfinish?.();
      expect(done).toHaveBeenCalledTimes(1);
      // Chiusa: l'effetto è tolto e gli ascolti sono sciolti.
      expect(animation.canceled).toBe(1);
      expect(animation.onfinish).toBeNull();
      expect(animation.oncancel).toBeNull();
      run.cancel();
      expect(done).toHaveBeenCalledTimes(1);
      expect(animation.canceled).toBe(1);
    } finally {
      lent.restore();
    }
  });

  it("uno pseudo-elemento arriva al browser come `pseudoElement`", () => {
    const lent = lendAnimate();
    try {
      const run = motionDriver().play(document.createElement("div"), FRAMES, { ...TIMING, pseudo: "::before" }, vi.fn());
      expect(lent.created[0].options).toEqual({
        duration: 200,
        delay: 40,
        easing: "linear",
        fill: "backwards",
        pseudoElement: "::before",
      });
      run.cancel();
    } finally {
      lent.restore();
    }
  });

  it("annullata toglie l'effetto e non chiama `done`, nemmeno allo scadere del tetto", () => {
    vi.useFakeTimers();
    const lent = lendAnimate();
    try {
      const done = vi.fn();
      const run = motionDriver().play(document.createElement("div"), FRAMES, TIMING, done);
      run.cancel();
      expect(lent.created[0].canceled).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(done).not.toHaveBeenCalled();
    } finally {
      lent.restore();
    }
  });

  it("un `finish` perso non tiene appesa la corsa", () => {
    vi.useFakeTimers();
    const lent = lendAnimate();
    try {
      const done = vi.fn();
      motionDriver().play(document.createElement("div"), FRAMES, TIMING, done);
      vi.advanceTimersByTime(TIMING.delay + TIMING.duration);
      expect(done).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(done).toHaveBeenCalledTimes(1);
      expect(lent.created[0].canceled).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      lent.restore();
    }
  });

  it("un annullamento da fuori conclude comunque", () => {
    const lent = lendAnimate();
    try {
      const done = vi.fn();
      motionDriver().play(document.createElement("div"), FRAMES, TIMING, done);
      lent.created[0].oncancel?.();
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      lent.restore();
    }
  });
});

describe("il motore manuale", () => {
  it("registra ciò che riceve e conclude quando il suo tempo arriva in fondo", () => {
    const driver = createManualDriver();
    const el = document.createElement("div");
    const done = vi.fn();
    const run = driver.play(el, FRAMES, TIMING, done);
    expect(driver.plays).toHaveLength(1);
    expect(driver.plays[0]).toMatchObject({ el, keyframes: FRAMES, timing: TIMING, state: "running" });

    driver.advance(100);
    expect(driver.now()).toBeCloseTo(100, 9);
    expect(run.time()).toBeCloseTo(100, 9);
    expect(done).not.toHaveBeenCalled();

    driver.advance(139);
    expect(done).not.toHaveBeenCalled();
    driver.advance(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(driver.plays[0].state).toBe("finished");
    driver.advance(1000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("una corsa annullata non conclude", () => {
    const driver = createManualDriver();
    const done = vi.fn();
    const run = driver.play(document.createElement("div"), FRAMES, TIMING, done);
    run.cancel();
    driver.advance(1000);
    expect(done).not.toHaveBeenCalled();
    expect(driver.plays[0].state).toBe("canceled");
  });

  it("serve i fotogrammi a un sessantesimo di secondo, una volta l'uno", () => {
    const driver = createManualDriver();
    const times: number[] = [];
    const loop = (time: number): void => {
      times.push(time);
      driver.requestFrame(loop);
    };
    driver.requestFrame(loop);
    driver.advance(50);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeCloseTo(1000 / 60, 9);
    expect(times[2]).toBeCloseTo(50, 9);

    const once = vi.fn();
    const canceled = vi.fn();
    driver.requestFrame(once);
    driver.cancelFrame(driver.requestFrame(canceled));
    driver.advance(100);
    expect(once).toHaveBeenCalledTimes(1);
    expect(canceled).not.toHaveBeenCalled();
  });

  it("un fotogramma annullato da un altro nello stesso giro non parte", () => {
    const driver = createManualDriver();
    const second = vi.fn();
    let secondId = 0;
    driver.requestFrame(() => driver.cancelFrame(secondId));
    secondId = driver.requestFrame(second);
    driver.advance(20);
    expect(second).not.toHaveBeenCalled();
  });

  it("dove `Element.animate` esiste tiene l'animazione in pausa e ne sposta il tempo", () => {
    const lent = lendAnimate();
    try {
      const driver = createManualDriver();
      const run = driver.play(document.createElement("div"), FRAMES, TIMING, vi.fn());
      const [animation] = lent.created;
      expect(animation.paused).toBe(true);
      expect(animation.options.fill).toBe("backwards");
      driver.advance(100);
      expect(animation.currentTime).toBeCloseTo(100, 9);
      run.cancel();
      expect(animation.canceled).toBe(1);
    } finally {
      lent.restore();
    }
  });
});
