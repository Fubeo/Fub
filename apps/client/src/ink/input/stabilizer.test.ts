import { describe, expect, it } from "vitest";
import type { InkSample } from "../sample";
import {
  MAX_STRING_PX,
  NO_STABILIZER,
  SMOOTHING_STEP_MS,
  Stabilizer,
  stabilizerActive,
  type StabilizerConfig,
} from "./stabilizer";

// Le proprietà dello stabilizzatore. Le risposte numeriche, uguali a quelle di
// Rust, sono in `../mirror.test.ts`; qui ciò che lo stabilizzatore promette a
// chi lo usa: i test del codice da cui deriva (vedi `THIRD_PARTY_NOTICES.md`),
// nella forma di questo modulo.

const point = (x: number, y: number, t: number): InkSample => ({ x, y, p: 1, t });

function smooth(config: StabilizerConfig, zoom: number, points: readonly InkSample[]): InkSample[] {
  const stabilizer = new Stabilizer(config, zoom);
  const out: InkSample[] = [];
  for (const p of points) stabilizer.push(p, out);
  stabilizer.finish(out);
  return out;
}

const average = (amount: number): StabilizerConfig => ({ ...NO_STABILIZER, amount, catchUpOnEnd: false });
const string = (amount: number): StabilizerConfig => ({ ...NO_STABILIZER, amount, pulledString: true, catchUpOnEnd: false });

describe("lo stabilizzatore del tratto", () => {
  it("spento lascia i campioni come sono", () => {
    const points = [point(0, 0, 0), point(3, 1, 4), point(9, 2, 8)];
    expect(stabilizerActive(NO_STABILIZER)).toBe(false);
    expect(smooth(NO_STABILIZER, 1, points)).toEqual(points);
    // Una quantità che non è un numero lo spegne, come una negativa.
    expect(stabilizerActive({ ...NO_STABILIZER, amount: Number.NaN })).toBe(false);
    expect(stabilizerActive({ ...NO_STABILIZER, amount: -1 })).toBe(false);
  });

  it("la corda non muove il pennino per un tremito più corto di lei", () => {
    const jitter = Array.from({ length: 8 }, (_, i) => point(i % 2 === 0 ? 0 : 5, 0, 0));
    const out = smooth(string(0.2), 1, jitter);
    // La corda è lunga 0,2 × 100 = 20: il pennino resta nel primo punto.
    expect(out).toEqual([jitter[0]]);
  });

  it("la corda segue il puntatore a distanza di corda", () => {
    const out = smooth(string(0.2), 1, [point(0, 0, 0), point(100, 0, 0)]);
    expect(out.length).toBe(2);
    expect(out[1]!.x).toBeCloseTo(100 - 0.2 * MAX_STRING_PX, 9);
  });

  it("la corda si accorcia con lo zoom: è in pixel dello schermo", () => {
    const far = [point(0, 0, 0), point(100, 0, 0)];
    expect(smooth(string(0.2), 2, far)[1]!.x).toBeCloseTo(90, 9);
    // Uno zoom che non è un numero vale 1.
    expect(smooth(string(0.2), Number.NaN, far)[1]!.x).toBeCloseTo(80, 9);
    // Uno zoom nullo vale 0,01: la corda diventa lunga 2000 unità e il pennino
    // non si muove.
    expect(smooth(string(0.2), 0, far)).toEqual([far[0]]);
  });

  it("la media conta il tempo, non il numero di eventi", () => {
    // Lo stesso gesto a 1000 Hz e a ~60 Hz porta il pennino nello stesso punto.
    const gesture = (interval: number): InkSample[] => {
      const points = [point(0, 0, 0)];
      for (let t = interval; t <= 32; t += interval) points.push(point(100, 0, t));
      return points;
    };
    const fast = smooth(average(0.8), 1, gesture(1));
    const slow = smooth(average(0.8), 1, gesture(SMOOTHING_STEP_MS));
    expect(fast.length).toBeGreaterThan(slow.length);
    expect(fast[fast.length - 1]!.x).toBeCloseTo(slow[slow.length - 1]!.x, 6);
  });

  it("con catchUp il pennino si avvicina anche a puntatore fermo, senza si ferma", () => {
    const paused = [point(0, 0, 0), point(100, 0, 16), point(100, 0, 500)];
    const caught = smooth(average(0.8), 1, paused);
    const waiting = smooth({ ...average(0.8), catchUp: false }, 1, paused);
    expect(caught[caught.length - 1]!.x).toBeGreaterThan(waiting[waiting.length - 1]!.x);
    expect(caught[caught.length - 1]!.x).toBeGreaterThan(99);
  });

  it("dopo una lunga pausa un evento non produce una raffica di campioni", () => {
    const out = smooth(average(0.5), 1, [point(0, 0, 0), point(50, 0, 3_600_000)]);
    // Il primo, più al massimo 64 passi.
    expect(out.length).toBeLessThanOrEqual(65);
    expect(out[out.length - 1]!.x).toBeCloseTo(50, 6);
  });

  it("con catchUpOnEnd il tratto finisce dove è il puntatore", () => {
    const points = [point(0, 0, 0), point(12, 3, 8), point(25, -4, 16), point(60, 0, 40)];
    const behind = smooth(string(0.2), 1, points);
    const ended = smooth({ ...string(0.2), catchUpOnEnd: true }, 1, points);
    expect(behind[behind.length - 1]).not.toEqual(points[3]);
    expect(ended[ended.length - 1]).toEqual(points[3]);
  });

  it("i campioni escono col canale di pressione e il tempo del puntatore che li ha mossi", () => {
    const out = smooth(average(0.5), 1, [{ x: 0, y: 0, p: 0.3, t: 0 }, { x: 10, y: 0, p: 0.9, t: 16 }]);
    expect(out[out.length - 1]).toMatchObject({ p: 0.9, t: 16 });
  });
});
