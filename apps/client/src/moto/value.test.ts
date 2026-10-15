// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFrameRatePreference } from "../theme/frame-rate";
import { openLifetime } from "../ui/lifetime";
import { activeMotions } from "./animate";
import { createManualDriver, setMotionDriver, type ManualDriver } from "./driver";
import { setMotionPreference } from "./level";
import { frameListeners, onFrame } from "./ticker";
import { springValue } from "./value";

const FRAME = 1000 / 60;
let driver: ManualDriver;

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
});

afterEach(() => {
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  setFrameRatePreference("");
  vi.unstubAllGlobals();
});

describe("l'orologio unico", () => {
  it("chiede un solo fotogramma per quanti iscritti ci siano, e si ferma senza", () => {
    const request = vi.spyOn(driver, "requestFrame");
    const cancel = vi.spyOn(driver, "cancelFrame");
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onFrame(a);
    const stopB = onFrame(b);
    expect(request).toHaveBeenCalledTimes(1);
    expect(frameListeners()).toBe(2);
    expect(activeMotions()).toBe(2);

    driver.advance(FRAME * 3);
    // Un fotogramma per battito, non uno per iscritto.
    expect(request).toHaveBeenCalledTimes(4);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);
    expect(a.mock.calls[0][0]).toBeCloseTo(FRAME, 6);
    expect(a.mock.calls[2][1]).toBeCloseTo(FRAME * 3, 6);

    stopA();
    stopA();
    driver.advance(FRAME);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(4);
    expect(cancel).not.toHaveBeenCalled();

    stopB();
    // Con l'ultimo iscritto il fotogramma in attesa è annullato, e non se ne
    // chiedono altri.
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(request.mock.results[request.mock.results.length - 1].value);
    const asked = request.mock.calls.length;
    driver.advance(FRAME * 10);
    expect(request).toHaveBeenCalledTimes(asked);
    expect(b).toHaveBeenCalledTimes(4);
    expect(frameListeners()).toBe(0);
  });

  it("un iscritto che si toglie da solo, o ne toglie un altro, non rompe il giro", () => {
    const calls: string[] = [];
    let stopSecond = () => {};
    const stopFirst = onFrame(() => {
      calls.push("primo");
      stopFirst();
      stopSecond();
    });
    stopSecond = onFrame(() => calls.push("secondo"));
    driver.advance(FRAME * 3);
    expect(calls).toEqual(["primo"]);
    expect(frameListeners()).toBe(0);
  });

  it("dopo una pausa riparte dal presente, e non recupera un intervallo lungo", () => {
    driver.advance(1000);
    const seen: number[] = [];
    const stop = onFrame((elapsed) => seen.push(elapsed));
    driver.advance(FRAME);
    expect(seen[0]).toBeCloseTo(FRAME, 6);
    stop();

    // Un fotogramma che arriva dopo mezzo secondo (scheda nascosta).
    let late: ((time: number) => void) | null = null;
    setMotionDriver({ ...driver, requestFrame: (callback) => ((late = callback), 1), cancelFrame: () => {} });
    const elapsed: number[] = [];
    const stopLate = onFrame((ms) => elapsed.push(ms));
    (late as ((time: number) => void) | null)?.(driver.now() + 500);
    expect(elapsed).toEqual([100]);
    stopLate();
  });

  it("rispetta il tetto dei fotogrammi scelto dall'utente", () => {
    setFrameRatePreference("30");
    const seen: number[] = [];
    const stop = onFrame((elapsed) => seen.push(elapsed));
    driver.advance(FRAME * 12);
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.length).toBeLessThanOrEqual(7);
    // Un fotogramma scartato non perde tempo: quello dopo ne conta due.
    expect(seen[seen.length - 1]).toBeCloseTo(FRAME * 2, 6);
  });

  it("col motore di serie batte su `requestAnimationFrame`, uno solo", () => {
    setMotionDriver(null);
    const pending = new Map<number, FrameRequestCallback>();
    let ids = 0;
    const request = vi.fn((callback: FrameRequestCallback) => {
      pending.set(++ids, callback);
      return ids;
    });
    const cancel = vi.fn((id: number) => void pending.delete(id));
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const beats = vi.fn();
    const stopA = onFrame(beats);
    const stopB = onFrame(() => {});
    expect(request).toHaveBeenCalledTimes(1);
    const [[id, callback]] = [...pending];
    pending.delete(id);
    callback(performance.now() + 16);
    expect(beats).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(1);

    stopA();
    stopB();
    expect(cancel).toHaveBeenCalledWith(2);
    expect(pending.size).toBe(0);
  });
});

describe("springValue", () => {
  it("raggiunge il bersaglio, ci si ferma esatto, e lascia l'orologio", () => {
    const seen: number[] = [];
    const value = springValue({ spring: "soft", initial: 0, onUpdate: (next) => seen.push(next) });
    expect(value.get()).toBe(0);
    expect(activeMotions()).toBe(0);

    value.set(100);
    expect(seen).toEqual([]);
    expect(activeMotions()).toBe(1);
    driver.advance(FRAME * 4);
    expect(value.get()).toBeGreaterThan(0);
    expect(value.get()).toBeLessThan(100);
    expect(value.velocity()).toBeGreaterThan(0);
    expect(seen).toHaveLength(4);

    driver.advance(2000);
    expect(value.get()).toBe(100);
    expect(value.velocity()).toBe(0);
    expect(seen[seen.length - 1]).toBe(100);
    expect(activeMotions()).toBe(0);
    const settled = seen.length;
    driver.advance(500);
    expect(seen).toHaveLength(settled);
  });

  it("più valori in moto battono su un solo fotogramma", () => {
    const request = vi.spyOn(driver, "requestFrame");
    const values = [1, 2, 3].map(() => springValue({ spring: "wide", initial: 0, onUpdate: () => {} }));
    values.forEach((value) => value.set(10));
    expect(request).toHaveBeenCalledTimes(1);
    expect(activeMotions()).toBe(3);
    driver.advance(FRAME * 2);
    expect(request).toHaveBeenCalledTimes(3);
    values.forEach((value) => value.stop());
    expect(activeMotions()).toBe(0);
  });

  it("`elastic` supera il bersaglio; in «calmo» no", () => {
    const peak = (): number => {
      let highest = 0;
      const value = springValue({ spring: "elastic", initial: 0, onUpdate: (next) => (highest = Math.max(highest, next)) });
      value.set(100);
      driver.advance(3000);
      expect(value.get()).toBe(100);
      return highest;
    };
    expect(peak()).toBeGreaterThan(105);
    setMotionPreference("calm");
    expect(peak()).toBe(100);
  });

  it("cambiare bersaglio in volo prosegue da posizione e velocità correnti", () => {
    const seen: number[] = [];
    const value = springValue({ spring: "soft", initial: 0, onUpdate: (next) => seen.push(next) });
    value.set(100);
    driver.advance(FRAME * 5);
    const position = value.get();
    const speed = value.velocity();
    expect(speed).toBeGreaterThan(0);

    value.set(-100);
    expect(value.get()).toBe(position);
    expect(value.velocity()).toBe(speed);
    driver.advance(FRAME);
    // Lo slancio lo porta ancora avanti prima di tornare.
    expect(value.get()).toBeGreaterThan(position);
    driver.advance(3000);
    expect(value.get()).toBe(-100);
  });

  it("`set` con una velocità dà la spinta del rilascio", () => {
    const value = springValue({ spring: "soft", initial: 0, onUpdate: () => {} });
    value.set(0, 2);
    expect(value.velocity()).toBe(2);
    expect(activeMotions()).toBe(1);
    driver.advance(FRAME * 2);
    expect(value.get()).toBeGreaterThan(20);
    driver.advance(3000);
    expect(value.get()).toBe(0);
    expect(activeMotions()).toBe(0);
  });

  it("`jump` porta al valore senza molla, `stop` ferma dov'è", () => {
    const seen: number[] = [];
    const value = springValue({ spring: "soft", initial: 0, onUpdate: (next) => seen.push(next) });
    value.set(100);
    driver.advance(FRAME * 3);
    value.jump(40);
    expect(value.get()).toBe(40);
    expect(value.velocity()).toBe(0);
    expect(seen[seen.length - 1]).toBe(40);
    expect(activeMotions()).toBe(0);

    value.set(100);
    driver.advance(FRAME * 3);
    const held = value.get();
    value.stop();
    expect(activeMotions()).toBe(0);
    driver.advance(500);
    expect(value.get()).toBe(held);
    expect(value.velocity()).toBe(0);
    // Fermo non vuol dire finito: un `set` lo rimette in moto.
    value.set(100);
    driver.advance(3000);
    expect(value.get()).toBe(100);
  });

  it("un `set` sul valore in cui è già fermo non accende l'orologio", () => {
    const update = vi.fn();
    const value = springValue({ spring: "soft", initial: 5, onUpdate: update });
    value.set(5);
    expect(activeMotions()).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("nel livello «ridotto» e col motore istantaneo `set` salta al bersaglio", () => {
    const seen: number[] = [];
    const value = springValue({ spring: "jelly", initial: 0, onUpdate: (next) => seen.push(next) });
    setMotionPreference("reduced");
    value.set(100);
    expect(value.get()).toBe(100);
    expect(seen).toEqual([100]);
    expect(activeMotions()).toBe(0);

    setMotionPreference("system");
    setMotionDriver(null);
    value.set(30);
    expect(value.get()).toBe(30);
    expect(seen).toEqual([100, 30]);
  });

  it("passare a «ridotto» in volo: il `set` successivo chiude il moto", () => {
    const value = springValue({ spring: "soft", initial: 0, onUpdate: () => {} });
    value.set(100);
    driver.advance(FRAME * 3);
    setMotionPreference("reduced");
    value.set(100);
    expect(value.get()).toBe(100);
    expect(activeMotions()).toBe(0);
  });

  it("chiusa la vita il valore si ferma e non risponde più", () => {
    const life = openLifetime();
    const update = vi.fn();
    const value = springValue({ spring: "soft", initial: 0, onUpdate: update, lifetime: life });
    value.set(100);
    driver.advance(FRAME * 3);
    const held = value.get();
    const calls = update.mock.calls.length;

    life.close();
    expect(activeMotions()).toBe(0);
    value.set(200);
    value.jump(300);
    driver.advance(500);
    expect(value.get()).toBe(held);
    expect(update).toHaveBeenCalledTimes(calls);
  });

  it("una soglia larga chiude prima il moto", () => {
    const frames = (precision?: number): number => {
      let count = 0;
      const value = springValue({ spring: "wide", initial: 0, onUpdate: () => count++, precision });
      value.set(10);
      driver.advance(3000);
      expect(value.get()).toBe(10);
      return count;
    };
    expect(frames(0.5)).toBeLessThan(frames());
  });
});
