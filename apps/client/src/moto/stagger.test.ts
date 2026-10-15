// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeMotions, animate } from "./animate";
import { createManualDriver, setMotionDriver, type ManualDriver } from "./driver";
import { setMotionPreference } from "./level";
import { STAGGER_MAX, STAGGER_MS } from "./spring";
import { stagger } from "./stagger";

let driver: ManualDriver;

function rows(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => {
    const el = document.createElement("li");
    document.body.append(el);
    return el;
  });
}

const delays = (): number[] => driver.plays.map((play) => play.timing.delay);

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
});

afterEach(() => {
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.replaceChildren();
});

describe("stagger", () => {
  it("ritarda ogni voce di 12 ms, e dall'ottava in poi partono insieme", () => {
    const items = rows(11);
    const seen: [HTMLElement, number][] = [];
    stagger(items, (item, index) => {
      seen.push([item, index]);
      return animate(item, { from: { y: 6, opacity: 0 } });
    });
    expect(seen).toEqual(items.map((item, index) => [item, index]));
    expect(delays()).toEqual([0, 12, 24, 36, 48, 60, 72, 84, 84, 84, 84]);
    expect(delays()[STAGGER_MAX - 1]).toBe((STAGGER_MAX - 1) * STAGGER_MS);
  });

  it("accetta un passo e un tetto diversi, e un iterabile qualunque", () => {
    stagger(new Set(rows(5)), (item) => animate(item, { from: { opacity: 0 } }), { each: 30, max: 3 });
    expect(delays()).toEqual([0, 30, 60, 60, 60]);
  });

  it("il ritardo si somma a quello della corsa, e non esce dalla chiamata", () => {
    const [a, b, c] = rows(3);
    stagger([a, b], (item) => animate(item, { from: { opacity: 0 }, delay: 100 }));
    animate(c, { from: { opacity: 0 } });
    expect(delays()).toEqual([100, 112, 0]);
  });

  it("nell'attesa la voce sta nella posa di partenza, poi corre", () => {
    const [, second] = rows(2);
    stagger([document.body.children[0], second], (item) =>
      animate(item, { from: { opacity: 0 }, duration: 100 }),
    );
    const play = driver.plays[1];
    expect(play.keyframes[0]).toEqual({ opacity: 0 });
    driver.advance(100);
    expect(driver.plays[0].state).toBe("finished");
    expect(play.state).toBe("running");
    driver.advance(13);
    expect(play.state).toBe("finished");
  });

  it("rende una corsa sola: viva finché lo è una voce, e annullabile insieme", async () => {
    const items = rows(3);
    const motion = stagger(items, (item) => animate(item, { from: { opacity: 0 }, duration: 100 }));
    expect(motion.running).toBe(true);
    driver.advance(110);
    expect(driver.plays[0].state).toBe("finished");
    expect(motion.running).toBe(true);
    driver.advance(20);
    expect(motion.running).toBe(false);
    await expect(motion.finished).resolves.toBeUndefined();

    const again = stagger(items, (item) => animate(item, { from: { opacity: 0 } }));
    expect(activeMotions()).toBe(3);
    again.cancel();
    expect(again.running).toBe(false);
    expect(activeMotions()).toBe(0);
  });

  it("senza voci è una corsa già finita", async () => {
    const motion = stagger([], () => animate(document.body));
    expect(motion.running).toBe(false);
    await expect(motion.finished).resolves.toBeUndefined();
  });

  it("nel livello «ridotto» non c'è sfalsamento", () => {
    setMotionPreference("reduced");
    stagger(rows(4), (item) => animate(item, { from: { y: 6, opacity: 0 }, whenReduced: "fade" }));
    expect(delays()).toEqual([0, 0, 0, 0]);
    for (const play of driver.plays) expect(play.keyframes[0]).toEqual({ opacity: 0 });
  });
});
