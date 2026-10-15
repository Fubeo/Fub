// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime } from "../ui/lifetime";
import { activeMotions, liveState } from "./animate";
import { createManualDriver, setMotionDriver, type ManualDriver } from "./driver";
import { flip } from "./flip";
import { setMotionPreference } from "./level";
import { SAMPLE_MS, SPRINGS, sampleSpring } from "./spring";

let driver: ManualDriver;
/// Il layout finto: happy-dom non ne ha uno. Come in un browser, il riquadro
/// misurato comprende la traslazione di una corsa in volo.
const layout = new Map<Element, DOMRect>();
let log: string[] = [];

function place(el: Element, left: number, top: number, width: number, height: number): void {
  layout.set(el, new DOMRect(left, top, width, height));
}

function element(left: number, top: number, width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  place(el, left, top, width, height);
  el.getBoundingClientRect = () => {
    log.push("measure");
    const base = layout.get(el) ?? new DOMRect();
    const pose = liveState(el)?.pose;
    return new DOMRect(base.x + (pose?.x ?? 0), base.y + (pose?.y ?? 0), base.width, base.height);
  };
  return el;
}

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  log = [];
});

afterEach(() => {
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  layout.clear();
  document.body.replaceChildren();
});

const last = <T>(items: readonly T[]): T => items[items.length - 1];

function xOf(frame: Keyframe): number {
  return Number(/translate\((-?[\d.]+)px/.exec(String(frame.transform))?.[1]);
}

describe("flip", () => {
  it("misura, muta, misura, e anima la differenza verso l'identità", () => {
    const el = element(10, 20, 100, 50);
    const motion = flip([el], () => {
      log.push("mutate");
      place(el, 110, 60, 200, 100);
    });
    expect(log).toEqual(["measure", "mutate", "measure"]);
    expect(motion.running).toBe(true);

    const [play] = driver.plays;
    // Centri: (60, 45) prima e (210, 110) dopo; il riquadro era la metà.
    expect(play.keyframes[0]).toEqual({ transform: "translate(-150px, -65px) scale(0.5, 0.5)" });
    expect(last(play.keyframes)).toEqual({ transform: "translate(0px, 0px) scale(1, 1)" });
    for (const frame of play.keyframes) expect(Object.keys(frame)).toEqual(["transform"]);
    // Di serie la molla è Morbido.
    const soft = sampleSpring(SPRINGS.soft, { from: -150, to: 0, precision: 0.05 }).values;
    expect(xOf(play.keyframes[4])).toBeCloseTo(soft[4], 2);
  });

  it("lo stato finale è il layout: la corsa non lascia niente", async () => {
    const el = element(0, 0, 100, 100);
    const motion = flip([el], () => {
      el.className = "spostato";
      place(el, 0, 240, 100, 100);
    });
    driver.advance(2000);
    expect(motion.running).toBe(false);
    expect(el.getAttribute("style")).toBeNull();
    expect(el.className).toBe("spostato");
    await expect(motion.finished).resolves.toBeUndefined();
  });

  it("senza `scale` sposta soltanto i centri", () => {
    const el = element(0, 0, 100, 100);
    flip([el], () => place(el, 100, 0, 300, 100), { scale: false, spring: "snap" });
    expect(driver.plays[0].keyframes[0]).toEqual({ transform: "translate(-200px, 0px)" });
  });

  it("anima chi si è mosso; chi è fermo, comparso o sparito non è affar suo", () => {
    const moved = element(0, 0, 100, 40);
    const still = element(0, 40, 100, 40);
    const appeared = element(0, 0, 0, 0);
    const gone = element(0, 80, 100, 40);
    const motion = flip([moved, still, appeared, gone], () => {
      place(moved, 0, 120, 100, 40);
      place(appeared, 0, 0, 100, 40);
      place(gone, 0, 0, 0, 0);
    });
    expect(driver.plays.map((play) => play.el)).toEqual([moved]);
    expect(activeMotions()).toBe(1);
    motion.cancel();
    expect(activeMotions()).toBe(0);
  });

  it("un elemento in volo riparte da dove lo si vede, con la sua velocità", () => {
    const el = element(0, 0, 100, 100);
    flip([el], () => place(el, 100, 0, 100, 100));
    driver.advance(58);
    const before = liveState(el);
    const seen = (before?.pose.x ?? Number.NaN) + 100;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(100);

    const states: string[] = [];
    const measure = el.getBoundingClientRect;
    el.getBoundingClientRect = () => {
      states.push(driver.plays[0].state);
      return measure();
    };
    flip([el], () => place(el, 300, 0, 100, 100));
    // La misura «prima» vede la corsa viva, quella «dopo» il layout nudo.
    expect(states).toEqual(["running", "canceled"]);

    const frames = driver.plays[1].keyframes;
    expect(xOf(frames[0])).toBeCloseTo(seen - 300, 1);
    const carried = sampleSpring(SPRINGS.soft, {
      from: seen - 300,
      to: 0,
      velocity: before?.velocity.x,
      precision: 0.05,
    }).values;
    expect(xOf(frames[1])).toBeCloseTo(carried[1], 1);
    expect(before?.velocity.x).toBeGreaterThan(0.5);
    expect(driver.plays[1].timing.duration).toBeCloseTo((carried.length - 1) * SAMPLE_MS, 6);
  });

  it("compensa un'origine della trasformazione che non è il centro", () => {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({ transformOrigin: "0px 0px" })) as unknown as typeof getComputedStyle;
    try {
      const el = element(0, 0, 100, 100);
      flip([el], () => place(el, 0, 0, 200, 200));
      // Rimpicciolire attorno all'angolo in alto a sinistra lascia l'angolo
      // dov'è: non c'è niente da traslare.
      expect(driver.plays[0].keyframes[0]).toEqual({ transform: "scale(0.5, 0.5)" });
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it("in «ridotto» e col motore istantaneo muta e basta", () => {
    const el = element(0, 0, 100, 100);
    setMotionPreference("reduced");
    let mutated = 0;
    const reduced = flip([el], () => {
      mutated++;
      place(el, 50, 0, 100, 100);
    });
    expect(reduced.running).toBe(false);

    setMotionPreference("system");
    setMotionDriver(null);
    flip([el], () => {
      mutated++;
      place(el, 90, 0, 100, 100);
    });
    expect(mutated).toBe(2);
    expect(driver.plays).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it("chiudere la vita annulla le corse", () => {
    const life = openLifetime();
    const a = element(0, 0, 100, 40);
    const b = element(0, 40, 100, 40);
    const motion = flip(
      [a, b],
      () => {
        place(a, 0, 40, 100, 40);
        place(b, 0, 0, 100, 40);
      },
      { lifetime: life },
    );
    expect(activeMotions()).toBe(2);
    life.close();
    expect(motion.running).toBe(false);
    expect(activeMotions()).toBe(0);
  });
});
