// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../ui/lifetime";
import { activeMotions, animate, launch, liveState } from "./animate";
import { createManualDriver, setMotionDriver, type ManualDriver, type MotionDriver } from "./driver";
import { setMotionPreference } from "./level";
import { DURATION, SAMPLE_MS, SPRINGS, sampleSpring } from "./spring";

let driver: ManualDriver;
let el: HTMLElement;

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  el = document.createElement("div");
  document.body.append(el);
});

afterEach(() => {
  // Ogni prova deve aver lasciato il banco pulito: è la stessa prova del banco.
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.replaceChildren();
});

/// La traslazione orizzontale di un fotogramma chiave.
function xOf(frame: Keyframe): number {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(frame.transform));
  if (!match) throw new Error(`nessuna traslazione in ${String(frame.transform)}`);
  return Number(match[1]);
}

const last = <T>(items: readonly T[]): T => items[items.length - 1];

/// Valore e pendenza di una tabella di campioni a `time` ms.
function tableAt(values: number[], time: number): { value: number; slope: number } {
  const index = Math.floor(time / SAMPLE_MS);
  const step = values[index + 1] - values[index];
  return { value: values[index] + step * (time / SAMPLE_MS - index), slope: step / SAMPLE_MS };
}

describe("i fotogrammi chiave", () => {
  it("contengono soltanto `transform` e `opacity`", () => {
    animate(el, { from: { x: 100, y: -20, scale: 0.9, rotate: 3, opacity: 0 }, spring: "elastic" });
    const [play] = driver.plays;
    expect(play.keyframes.length).toBeGreaterThan(10);
    for (const frame of play.keyframes) {
      expect(Object.keys(frame).sort()).toEqual(["opacity", "transform"]);
    }
    expect(play.keyframes[0]).toEqual({
      transform: "translate(100px, -20px) rotate(3deg) scale(0.9, 0.9)",
      opacity: 0,
    });
    // L'ultimo è l'identità: finita la corsa resta il CSS, senza scarto.
    expect(last(play.keyframes)).toEqual({
      transform: "translate(0px, 0px) rotate(0deg) scale(1, 1)",
      opacity: 1,
    });
  });

  it("portano solo i canali che si muovono", () => {
    animate(el, { from: { opacity: 0 } });
    expect(Object.keys(driver.plays[0].keyframes[0])).toEqual(["opacity"]);

    const other = document.createElement("div");
    animate(other, { from: { y: 12 } });
    expect(driver.plays[1].keyframes[0]).toEqual({ transform: "translate(0px, 12px)" });
  });

  it("una molla è campionata, mai una `linear()`", () => {
    animate(el, { from: { x: 40 }, spring: "jelly" });
    const { timing, keyframes } = driver.plays[0];
    expect(timing.easing).toBe("linear");
    expect(timing.duration).toBeCloseTo((keyframes.length - 1) * SAMPLE_MS, 9);
    expect(JSON.stringify(driver.plays)).not.toContain("linear(");
  });

  it("ogni canale ha la sua molla, e la durata è la più lunga", () => {
    animate(el, { from: { x: 300, opacity: 0 }, spring: "jelly" });
    const { keyframes } = driver.plays[0];
    const x = sampleSpring(SPRINGS.jelly, { from: 300, to: 0, precision: 0.05 }).values;
    const opacity = sampleSpring(SPRINGS.jelly, { from: 0, to: 1, precision: 0.002 }).values;
    expect(x.length).not.toBe(opacity.length);
    expect(keyframes).toHaveLength(Math.max(x.length, opacity.length));
    expect(xOf(keyframes[5])).toBeCloseTo(x[5], 2);
    // Il canale che arriva prima aspetta fermo sul suo bersaglio.
    const shorter = Math.min(x.length, opacity.length);
    expect(keyframes[shorter].opacity).toBe(1);
    expect(xOf(keyframes[shorter])).toBeCloseTo(x[Math.min(shorter, x.length - 1)], 2);
  });

  it("un superamento non esce dall'opacità né capovolge la scala", () => {
    animate(el, { from: { opacity: 0, scale: 3 }, spring: "jelly" });
    for (const frame of driver.plays[0].keyframes) {
      expect(frame.opacity).toBeGreaterThanOrEqual(0);
      expect(frame.opacity).toBeLessThanOrEqual(1);
      expect(String(frame.transform)).not.toContain("-");
    }
    // Il superamento c'è: si vede dalla scala che scende sotto uno.
    expect(driver.plays[0].keyframes.some((frame) => /scale\(0\./.test(String(frame.transform)))).toBe(true);
  });

  it("con `duration` è una curva a tempo: due estremi e una `cubic-bezier()`", () => {
    animate(el, { from: { opacity: 0, y: 8 }, duration: DURATION.short });
    expect(driver.plays[0].keyframes).toEqual([
      { transform: "translate(0px, 8px)", opacity: 0 },
      { transform: "translate(0px, 0px)", opacity: 1 },
    ]);
    expect(driver.plays[0].timing).toEqual({ duration: 220, delay: 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });

    animate(el, { from: { opacity: 0 }, duration: 100, easing: "ease-out" });
    expect(driver.plays[1].timing.easing).toBe("cubic-bezier(0, 0, 0.58, 1)");
    animate(el, { from: { opacity: 0 }, duration: 100, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    expect(driver.plays[2].timing.easing).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    // Una `linear()` non passa: ricade sulla curva di serie.
    animate(el, { from: { opacity: 0 }, duration: 100, easing: "linear(0, 0.4, 1)" });
    expect(driver.plays[3].timing.easing).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("`to` può non essere l'identità, e un valore non finito vale il riposo", () => {
    animate(el, { from: { x: Number.NaN }, to: { x: 50, opacity: 0 }, duration: 100 });
    expect(driver.plays[0].keyframes).toEqual([
      { transform: "translate(0px, 0px)", opacity: 1 },
      { transform: "translate(50px, 0px)", opacity: 0 },
    ]);
  });

  it("una velocità iniziale muove anche chi parte dal riposo", () => {
    animate(el, { velocity: { x: 1 }, spring: "elastic" });
    const xs = driver.plays[0].keyframes.map(xOf);
    expect(Math.max(...xs)).toBeGreaterThan(20);
    expect(last(xs)).toBe(0);
  });

  it("senza niente da muovere non parte niente", () => {
    const motion = animate(el, { from: { x: 0, opacity: 1 } });
    expect(motion.running).toBe(false);
    expect(driver.plays).toHaveLength(0);
  });
});

describe("la vita di una corsa", () => {
  it("alla fine non lascia stile in linea, e `finished` si risolve", async () => {
    const motion = animate(el, { from: { x: 30, opacity: 0 } });
    expect(motion.running).toBe(true);
    expect(activeMotions()).toBe(1);

    driver.advance(driver.plays[0].timing.duration);
    expect(motion.running).toBe(false);
    expect(driver.plays[0].state).toBe("finished");
    expect(activeMotions()).toBe(0);
    expect(el.getAttribute("style")).toBeNull();
    await expect(motion.finished).resolves.toBeUndefined();
  });

  it("annullata o portata alla fine si risolve lo stesso, e non lascia niente", async () => {
    const canceled = animate(el, { from: { x: 30 } });
    canceled.cancel();
    canceled.cancel();
    expect(canceled.running).toBe(false);
    expect(driver.plays[0].state).toBe("canceled");
    await expect(canceled.finished).resolves.toBeUndefined();

    const finished = animate(el, { from: { x: 30 } });
    finished.finish();
    expect(finished.running).toBe(false);
    await expect(finished.finished).resolves.toBeUndefined();
    expect(activeMotions()).toBe(0);
    expect(el.getAttribute("style")).toBeNull();
  });

  it("conta le corse vive", () => {
    const other = document.createElement("div");
    animate(el, { from: { x: 30 } });
    animate(other, { from: { x: 30 } });
    expect(activeMotions()).toBe(2);
    // Una nuova sullo stesso elemento prende il posto della vecchia.
    animate(el, { from: { y: 30 } });
    expect(activeMotions()).toBe(2);
    driver.advance(2000);
    expect(activeMotions()).toBe(0);
  });

  it("col ritardo l'elemento aspetta nella posa di partenza", () => {
    animate(el, { from: { x: 80 }, delay: 30 });
    const { timing } = driver.plays[0];
    expect(timing.delay).toBe(30);
    driver.advance(20);
    expect(liveState(el)?.pose.x).toBe(80);
    driver.advance(timing.duration);
    expect(activeMotions()).toBe(1);
    driver.advance(10);
    expect(activeMotions()).toBe(0);
  });

  it("chiudere la vita annulla la corsa, e su una vita chiusa non parte", async () => {
    const life = openLifetime();
    const first = animate(el, { from: { x: 30 }, lifetime: life });
    const other = document.createElement("div");
    const second = animate(other, { from: { x: 30 }, lifetime: life });
    life.close();
    expect(first.running).toBe(false);
    expect(second.running).toBe(false);
    expect(driver.plays.map((play) => play.state)).toEqual(["canceled", "canceled"]);
    await expect(first.finished).resolves.toBeUndefined();

    const late = animate(el, { from: { x: 30 }, lifetime: life });
    expect(late.running).toBe(false);
    expect(driver.plays).toHaveLength(2);
  });

  it("una vita vede solo le corse ancora vive", () => {
    const life = openLifetime();
    const done = animate(el, { from: { x: 30 }, lifetime: life });
    driver.advance(2000);
    expect(done.running).toBe(false);
    const live = animate(el, { from: { x: 30 }, lifetime: life });
    life.close();
    expect(live.running).toBe(false);
    expect(driver.plays.map((play) => play.state)).toEqual(["finished", "canceled"]);
  });

  it("un motore che conclude dentro `play`, o che rifiuta, non lascia corse appese", async () => {
    const eager: MotionDriver = {
      ...driver,
      play(_el, _keyframes, _timing, done) {
        done();
        return { time: () => 0, cancel: () => {} };
      },
    };
    setMotionDriver(eager);
    const concluded = animate(el, { from: { x: 30 } });
    expect(concluded.running).toBe(false);
    expect(activeMotions()).toBe(0);

    const broken: MotionDriver = {
      ...driver,
      play() {
        throw new Error("fotogrammi rifiutati");
      },
    };
    setMotionDriver(broken);
    const refused = animate(el, { from: { x: 30 } });
    expect(refused.running).toBe(false);
    expect(activeMotions()).toBe(0);
    await expect(refused.finished).resolves.toBeUndefined();
  });

  it("col motore istantaneo la corsa è già conclusa", async () => {
    setMotionDriver(null);
    const motion = animate(el, { from: { x: 30, opacity: 0 }, spring: "jelly" });
    expect(motion.running).toBe(false);
    expect(el.getAttribute("style")).toBeNull();
    await expect(motion.finished).resolves.toBeUndefined();
    expect(motion.reverse().running).toBe(false);
  });
});

describe("l'interruzione", () => {
  it("una corsa nuova parte da posa e velocità correnti della vecchia", async () => {
    const first = animate(el, { from: { x: 100 }, spring: "soft" });
    driver.advance(58);
    const table = sampleSpring(SPRINGS.soft, { from: 100, to: 0, precision: 0.05 }).values;
    const now = tableAt(table, 58);
    expect(liveState(el)?.pose.x).toBeCloseTo(now.value, 9);
    expect(liveState(el)?.velocity.x).toBeCloseTo(now.slope, 9);

    // Il `from` dichiarato non conta per un canale già in corsa.
    const second = animate(el, { from: { x: 500 }, spring: "soft" });
    expect(first.running).toBe(false);
    expect(driver.plays[0].state).toBe("canceled");
    await expect(first.finished).resolves.toBeUndefined();
    expect(second.running).toBe(true);
    expect(activeMotions()).toBe(1);

    const frames = driver.plays[1].keyframes;
    expect(xOf(frames[0])).toBeCloseTo(now.value, 1);
    const carried = sampleSpring(SPRINGS.soft, { from: now.value, to: 0, velocity: now.slope, precision: 0.05 });
    const fromRest = sampleSpring(SPRINGS.soft, { from: now.value, to: 0, precision: 0.05 });
    expect(xOf(frames[1])).toBeCloseTo(carried.values[1], 1);
    // La velocità conta davvero: senza, il secondo campione sarebbe un altro.
    expect(Math.abs(carried.values[1] - fromRest.values[1])).toBeGreaterThan(1);
    expect(last(frames)).toEqual({ transform: "translate(0px, 0px)" });
  });

  it("un canale fermo parte da dove dice la corsa nuova, gli altri proseguono", () => {
    animate(el, { from: { x: 100 }, spring: "soft" });
    driver.advance(58);
    const x = liveState(el)?.pose.x ?? Number.NaN;
    animate(el, { from: { opacity: 0 }, spring: "soft" });
    const [frame] = driver.plays[1].keyframes;
    expect(frame.opacity).toBe(0);
    expect(xOf(frame)).toBeCloseTo(x, 1);
  });

  it("anche una curva a tempo si lascia interrompere a metà", () => {
    animate(el, { from: { x: 100 }, duration: 200, easing: "linear" });
    driver.advance(100);
    expect(liveState(el)?.pose.x).toBeCloseTo(50, 3);
    expect(liveState(el)?.velocity.x).toBeCloseTo(-0.5, 3);
    animate(el, { duration: 100 });
    expect(xOf(driver.plays[1].keyframes[0])).toBeCloseTo(50, 1);
  });

  it("`reverse` a metà torna alla posa di partenza", () => {
    const motion = animate(el, { from: { x: 100, opacity: 0 }, spring: "soft" });
    driver.advance(58);
    const state = liveState(el);
    const back = motion.reverse();
    expect(motion.running).toBe(false);
    expect(back.running).toBe(true);

    const frames = driver.plays[1].keyframes;
    expect(xOf(frames[0])).toBeCloseTo(state?.pose.x ?? Number.NaN, 1);
    expect(frames[0].opacity).toBeCloseTo(state?.pose.opacity ?? Number.NaN, 2);
    // Parte nel verso in cui stava andando, poi inverte: prima cala ancora.
    expect(xOf(frames[1])).toBeLessThan(xOf(frames[0]));
    expect(last(frames)).toEqual({ transform: "translate(100px, 0px)", opacity: 0 });

    driver.advance(2000);
    expect(back.running).toBe(false);
    expect(el.getAttribute("style")).toBeNull();
  });

  it("due inversioni tornano a puntare al riposo", () => {
    const motion = animate(el, { from: { x: 100 }, spring: "soft" });
    driver.advance(58);
    const back = motion.reverse();
    driver.advance(58);
    back.reverse();
    expect(last(driver.plays[2].keyframes)).toEqual({ transform: "translate(0px, 0px)" });
  });

  it("`reverse` di una corsa finita rifà la strada al contrario", () => {
    const motion = animate(el, { from: { opacity: 0 }, duration: 100, delay: 40 });
    driver.advance(200);
    const back = motion.reverse();
    expect(back.running).toBe(true);
    expect(driver.plays[1].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(driver.plays[1].timing.delay).toBe(0);
  });
});

describe("i livelli", () => {
  it("in «calmo» le molle non superano il bersaglio", () => {
    animate(el, { from: { x: 100 }, spring: "elastic" });
    expect(Math.min(...driver.plays[0].keyframes.map(xOf))).toBeLessThan(-5);

    setMotionPreference("calm");
    const other = document.createElement("div");
    animate(other, { from: { x: 100 }, spring: "elastic" });
    expect(Math.min(...driver.plays[1].keyframes.map(xOf))).toBe(0);
  });

  it("in «ridotto» non parte niente e la corsa è già conclusa", async () => {
    setMotionPreference("reduced");
    const motion = animate(el, { from: { x: 100, opacity: 0 }, spring: "elastic" });
    expect(motion.running).toBe(false);
    expect(driver.plays).toHaveLength(0);
    expect(activeMotions()).toBe(0);
    await expect(motion.finished).resolves.toBeUndefined();
  });

  it("in «ridotto» con `fade` resta la sola opacità, in 90 ms", () => {
    setMotionPreference("reduced");
    const motion = animate(el, { from: { y: 8, opacity: 0 }, spring: "elastic", whenReduced: "fade" });
    expect(motion.running).toBe(true);
    expect(driver.plays[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(driver.plays[0].timing.duration).toBe(90);

    // Senza opacità da sfumare non resta niente.
    const other = document.createElement("div");
    expect(animate(other, { from: { y: 8 }, whenReduced: "fade" }).running).toBe(false);
    expect(driver.plays).toHaveLength(1);
  });
});

describe("ciò che serve ai moduli vicini", () => {
  it("un tetto tronca la corsa, e `onEnd` arriva una volta comunque finisca", () => {
    const onEnd = vi.fn();
    launch(el, { from: { x: 100 }, spring: "jelly" }, { limit: 300, onEnd });
    const { timing, keyframes } = driver.plays[0];
    expect(timing.duration).toBeLessThanOrEqual(300);
    expect(timing.duration).toBeGreaterThan(300 - SAMPLE_MS - 1e-6);
    expect(timing.duration).toBeCloseTo((keyframes.length - 1) * SAMPLE_MS, 9);
    driver.advance(300);
    expect(onEnd).toHaveBeenCalledTimes(1);

    const canceled = vi.fn();
    launch(el, { from: { x: 100 } }, { onEnd: canceled }).cancel();
    expect(canceled).toHaveBeenCalledTimes(1);

    setMotionPreference("reduced");
    const skipped = vi.fn();
    launch(el, { from: { x: 100 } }, { onEnd: skipped });
    expect(skipped).toHaveBeenCalledTimes(1);
  });

  it("si può partire dallo stato di un altro elemento", () => {
    launch(el, { from: { opacity: 0 }, spring: "soft" }, { inherit: { pose: { opacity: 0.4 }, velocity: { opacity: 0.002 } } });
    expect(driver.plays[0].keyframes[0]).toEqual({ opacity: 0.4 });
  });
});

describe("uno pseudo-elemento", () => {
  it("è un bersaglio a sé: la sua corsa convive con quella dell'elemento", () => {
    const body = animate(el, { from: { opacity: 0 } });
    const shape = animate(el, { from: { x: 60 }, pseudo: "::before" });
    expect(body.running).toBe(true);
    expect(shape.running).toBe(true);
    expect(activeMotions()).toBe(2);
    expect(driver.plays[0].timing.pseudo).toBeUndefined();
    expect(driver.plays[1].timing.pseudo).toBe("::before");

    // Nessuna delle due vede lo stato dell'altra.
    expect(liveState(el)?.pose).toEqual({ opacity: 0 });
    expect(liveState(el, "::before")?.pose).toEqual({ x: 60 });
    expect(liveState(el, "::after")).toBeNull();

    shape.cancel();
    expect(body.running).toBe(true);
    expect(liveState(el, "::before")).toBeNull();
    expect(activeMotions()).toBe(1);
  });

  it("una corsa nuova sullo stesso pseudo-elemento riparte da dov'era la vecchia", () => {
    const first = animate(el, { from: { x: 100 }, pseudo: "::before" });
    driver.advance(48);
    const seen = liveState(el, "::before");
    const x = seen?.pose.x ?? Number.NaN;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(100);

    animate(el, { from: { x: -40 }, pseudo: "::before" });
    expect(first.running).toBe(false);
    expect(activeMotions()).toBe(1);
    expect(xOf(driver.plays[1].keyframes[0])).toBeCloseTo(x, 1);
    expect(driver.plays[1].timing.pseudo).toBe("::before");
  });

  it("l'inversione resta sullo pseudo-elemento, e la vita chiusa lo ferma", () => {
    const lifetime = openLifetime();
    const motion = animate(el, { from: { x: 30 }, pseudo: "::after", lifetime });
    driver.advance(32);
    const back = motion.reverse();
    expect(driver.plays[1].timing.pseudo).toBe("::after");
    expect(back.running).toBe(true);
    back.cancel();

    animate(el, { from: { x: 30 }, pseudo: "::after", lifetime });
    lifetime.close();
    expect(liveState(el, "::after")).toBeNull();
    expect(activeMotions()).toBe(0);
  });
});
