// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../moto";
import { frameListeners } from "../../moto/ticker";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { DURATION } from "../../moto/spring";
import {
  ANTS_MS,
  ANTS_STEP,
  containMarks,
  createMarksMotion,
  copyMarkOf,
  enterValues,
  GLIDE,
  GLIDE_QUICK,
  selectionMotion,
  selectionSpeedOf,
  slowRoot,
  SLIDE,
  stepMarks,
  type MarksHost,
  type MarksMotion,
  type MarksPose,
  type MarksTarget,
} from "./grid-motion";
import { edgeParts, selectionParts, ZONES, type Bands, type MarkGeometry, type SelectionLook, type Zone } from "./marks";

const FRAME = 1000 / 60;
const W = 100;
const H = 28;
/// Le intestazioni, senza righe né colonne bloccate.
const PLAIN: Bands = { top: 24, left: 40 };

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
  document.body.replaceChildren();
});

/// Un generatore pseudo-casuale ripetibile (mulberry32).
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// La geometria di una selezione su una griglia di celle uguali: il
/// rettangolo da (r1, c1) a (r2, c2) e la cella attiva (r, c) dentro.
function geometryOf(r1: number, c1: number, r2: number, c2: number, r: number, c: number, bands = PLAIN): number[] {
  const x = (column: number) => bands.left + column * W;
  const y = (row: number) => bands.top + row * H;
  return [x(c1), y(r1), x(c2 + 1), y(r2 + 1), x(c), y(r), x(c + 1), y(r + 1), x(c2 + 1), y(r2 + 1)];
}

/// Un gesto: una sequenza di selezioni come la fanno frecce, Maiusc+frecce,
/// Ctrl+frecce e il puntatore che trascina.
function gesture(random: () => number, length: number): number[][] {
  let r = 10;
  let c = 10;
  let anchor = { r, c };
  const out: number[][] = [];
  for (let index = 0; index < length; index += 1) {
    const kind = random();
    const step = () => (random() < 0.5 ? -1 : 1);
    if (kind < 0.35) {
      // Una freccia: la selezione è la cella.
      if (random() < 0.5) r = Math.max(0, r + step());
      else c = Math.max(0, c + step());
      anchor = { r, c };
      out.push(geometryOf(r, c, r, c, r, c));
    } else if (kind < 0.7) {
      // Maiusc+freccia o il trascinamento: si allarga dall'ancora.
      const focus = { r: Math.max(0, r + Math.round((random() - 0.5) * 6)), c: Math.max(0, c + Math.round((random() - 0.5) * 6)) };
      out.push(geometryOf(Math.min(anchor.r, focus.r), Math.min(anchor.c, focus.c), Math.max(anchor.r, focus.r), Math.max(anchor.c, focus.c), anchor.r, anchor.c));
    } else {
      // Ctrl+freccia: un salto lungo.
      if (random() < 0.5) r = Math.max(0, r + step() * Math.floor(5 + random() * 40));
      else c = Math.max(0, c + step() * Math.floor(3 + random() * 20));
      anchor = { r, c };
      out.push(geometryOf(r, c, r, c, r, c));
    }
  }
  return out;
}

/// Prova le regole di un passo da `before` a `after` verso `goal`.
function checkStep(goal: readonly number[], before: readonly number[], after: MarksPose, label: string): void {
  const [bL, bT, bR, bB, aL, aT, aR, aB, hR, hB] = after.x;
  // La cella attiva dentro il rettangolo; il quadratino sul suo angolo.
  expect(aL >= bL - 1e-9 && aT >= bT - 1e-9 && aR <= bR + 1e-9 && aB <= bB + 1e-9, `${label}: contenimento`).toBe(true);
  expect([hR, hB], `${label}: quadratino`).toEqual([bR, bB]);
  for (let index = 0; index < 4; index += 1) {
    // Il rettangolo non passa il bersaglio e non torna mai indietro.
    const was = before[index] - goal[index];
    const now = after.x[index] - goal[index];
    expect(was * now >= -1e-9, `${label}: il numero ${index} passa il bersaglio`).toBe(true);
    expect(Math.abs(now) <= Math.abs(was) + 1e-9, `${label}: il numero ${index} torna indietro`).toBe(true);
  }
}

describe("le regole del passo", () => {
  for (const [name, spring] of [["GLIDE_QUICK", GLIDE_QUICK], ["GLIDE", GLIDE], ["SLIDE", SLIDE]] as const) {
    for (const irregular of [false, true]) {
      it(`${name}, fotogrammi ${irregular ? "irregolari" : "regolari"}: niente sorpasso, mai indietro, contenuti, e arrivano`, () => {
        for (let seed = 1; seed <= 40; seed += 1) {
          const random = seeded(seed * 7919 + (irregular ? 1 : 0));
          const targets = gesture(random, 60);
          const first = targets[0]!;
          const pose: MarksPose = { x: first.slice(), v: first.map(() => 0) };
          let cursor = 0;
          while (cursor < targets.length) {
            // Da 1 a 20 eventi in un fotogramma: conta l'ultimo.
            cursor = Math.min(targets.length, cursor + 1 + Math.floor(random() * 20));
            const target: MarksTarget = { geometry: targets[cursor - 1]!, spring, fill: false };
            // Irregolari: da 33 a 100 ms, come un fotogramma perso o una scheda
            // che torna (`onFrame` non passa mai più di 100 ms).
            const dt = irregular ? (33 + random() * 67) / 1000 : FRAME / 1000;
            const before = pose.x.slice();
            stepMarks(target, pose, dt);
            checkStep(target.geometry, before, pose, `seme ${seed}`);
          }
          const last: MarksTarget = { geometry: targets[targets.length - 1]!, spring, fill: false };
          let frames = 0;
          while (!stepMarks(last, pose, FRAME / 1000) && frames < 200) frames += 1;
          expect(pose.x, `seme ${seed}: arriva`).toEqual(last.geometry);
          expect(frames, `seme ${seed}: arriva presto`).toBeLessThan(60);
        }
      });
    }
  }

  it("senza la regola dell'indietro un bersaglio nuovo dall'altra parte fa tornare indietro", () => {
    // I segni corrono a destra a 800 px/s; il bersaglio nuovo sta 30 px
    // dietro. Con la regola la velocità si azzera e si va verso il bersaglio;
    // senza, un fotogramma breve li porta ancora a destra, lontano.
    const goal = geometryOf(0, 0, 0, 0, 0, 0);
    const run = (backward: boolean) => {
      const pose: MarksPose = { x: goal.map((value) => value + 30), v: goal.map(() => 800) };
      const before = pose.x[0]!;
      stepMarks({ geometry: goal, spring: GLIDE, fill: false }, pose, 0.004, backward);
      return pose.x[0]! - before;
    };
    expect(run(true)).toBeLessThan(0);
    expect(run(false)).toBeGreaterThan(0);
  });

  it("la velocità verso il bersaglio non supera la radice lenta per la distanza", () => {
    expect(slowRoot(GLIDE)).toBeCloseTo(35, 0);
    expect(slowRoot(SLIDE)).toBeCloseTo(25, 0);
    const from = geometryOf(0, 0, 0, 0, 0, 0);
    const to = geometryOf(0, 30, 0, 30, 0, 30);
    const pose: MarksPose = { x: from.slice(), v: from.map(() => 5000) };
    stepMarks({ geometry: to, spring: GLIDE, fill: false }, pose, 0);
    expect(Math.abs(pose.v[0]!)).toBeLessThanOrEqual(slowRoot(GLIDE) * Math.abs(to[0]! - from[0]!) + 1e-6);
  });

  it("il contenimento: il rettangolo raggiunge la cella attiva che esce verso il suo bersaglio, o la ferma", () => {
    const goal = geometryOf(0, 0, 3, 3, 0, 0);
    const pose: MarksPose = { x: goal.slice(), v: goal.map(() => 0) };
    pose.x[4] = goal[0]! - 30;
    containMarks(pose, goal);
    // La cella attiva esce oltre il bersaglio del lato: si ferma sul lato.
    expect(pose.x[4]).toBe(pose.x[0]);
    const pose2: MarksPose = { x: goal.slice(), v: goal.map(() => 0) };
    pose2.x[0] = goal[0]! + 50;
    pose2.x[4] = goal[0]! + 20;
    containMarks(pose2, goal);
    // Il lato è in ritardo, la cella attiva ancora dentro il suo bersaglio:
    // il lato la raggiunge.
    expect(pose2.x[0]).toBe(goal[0]! + 20);
  });

  it("mentre si tira il riempimento il quadratino sta sull'angolo del riempimento", () => {
    const g = geometryOf(0, 0, 0, 0, 0, 0);
    const fill = g.slice();
    fill[9] = g[3]! + 4 * H;
    const pose: MarksPose = { x: g.slice(), v: g.map(() => 0) };
    stepMarks({ geometry: fill, spring: GLIDE, fill: true }, pose, FRAME / 1000);
    expect(pose.x[9]).toBe(fill[9]);
  });
});

/// Un host con i livelli e i lift di ogni zona.
function makeHost(bands: Bands = PLAIN): { host: MarksHost; life: Lifetime; layers: Record<Zone, HTMLElement>; lifts: Record<Zone, HTMLElement> } {
  const layers = {} as Record<Zone, HTMLElement>;
  const lifts = {} as Record<Zone, HTMLElement>;
  for (const zone of ZONES) {
    layers[zone] = document.body.appendChild(document.createElement("div"));
    layers[zone].className = `grid-marks-${zone}`;
    lifts[zone] = document.body.appendChild(document.createElement("div"));
    lifts[zone].className = `grid-lift-${zone}`;
  }
  const life = openLifetime();
  return { host: { layers, lifts, lifetime: life, bands: () => bands }, life, layers, lifts };
}

const LOOK: SelectionLook = { lone: false, edges: true, handle: true, header: { width: 40, height: 24 } };
const partsFor = (lone: boolean) => (geometry: MarkGeometry) => selectionParts(geometry, { ...LOOK, lone });

describe("il motore dei segni", () => {
  it("dieci eventi in un fotogramma muovono come l'ultimo da solo", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = seeded(seed);
      const targets = gesture(random, 80);
      const batches: number[][][] = [];
      for (let cursor = 0; cursor < targets.length;) {
        const size = 1 + Math.floor(random() * 20);
        batches.push(targets.slice(cursor, cursor + size));
        cursor += size;
      }
      const record = (all: boolean): number[][] => {
        const { host, life } = makeHost();
        const marks = createMarksMotion(host);
        marks.update({ geometry: targets[0]!, parts: partsFor(false), glide: false });
        const seen: number[][] = [];
        for (const batch of batches) {
          for (const geometry of all ? batch : batch.slice(-1)) marks.update({ geometry, parts: partsFor(false) });
          driver.advance(FRAME);
          seen.push([...marks.shown()!]);
        }
        driver.advance(2000);
        seen.push([...marks.shown()!]);
        life.close();
        return seen;
      };
      const all = record(true);
      const last = record(false);
      expect(all.length).toBe(last.length);
      all.forEach((frame, index) => frame.forEach((value, n) => expect(value, `seme ${seed}, fotogramma ${index}`).toBeCloseTo(last[index]![n]!, 6)));
    }
  });

  it("chi scivola parte dal fotogramma dopo, arriva e smette di chiedere fotogrammi", () => {
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    const a = geometryOf(0, 0, 0, 0, 0, 0);
    const b = geometryOf(0, 4, 0, 4, 0, 4);
    marks.update({ geometry: a, parts: partsFor(true), glide: false });
    expect(marks.moving()).toBe(false);
    marks.update({ geometry: b, parts: partsFor(true) });
    // Dentro l'evento non avanza niente.
    expect(marks.shown()).toEqual(a);
    expect(marks.moving()).toBe(true);
    driver.advance(FRAME);
    expect(marks.shown()![0]).toBeGreaterThan(a[0]!);
    driver.advance(1000);
    expect(marks.shown()).toEqual(b);
    expect(marks.moving()).toBe(false);
    expect(frameListeners()).toBe(0);
    life.close();
  });

  it("con il moto ridotto i segni saltano al bersaglio senza iscriversi all'orologio", () => {
    setMotionPreference("reduced");
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
    const b = geometryOf(5, 5, 5, 5, 5, 5);
    marks.update({ geometry: b, parts: partsFor(true) });
    expect(marks.shown()).toEqual(b);
    expect(marks.moving()).toBe(false);
    expect(frameListeners()).toBe(0);
    life.close();
  });

  it("«ridotto» acceso a metà corsa porta i segni al bersaglio al primo fotogramma", () => {
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
    const b = geometryOf(0, 9, 0, 9, 0, 9);
    marks.update({ geometry: b, parts: partsFor(true) });
    driver.advance(FRAME);
    expect(marks.shown()).not.toEqual(b);
    setMotionPreference("reduced");
    driver.advance(FRAME);
    expect(marks.shown()).toEqual(b);
    expect(frameListeners()).toBe(0);
    life.close();
  });

  it("glide falso (il cambio di foglio) salta, anche a metà corsa", () => {
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
    marks.update({ geometry: geometryOf(0, 9, 0, 9, 0, 9), parts: partsFor(true) });
    driver.advance(FRAME);
    const c = geometryOf(3, 3, 3, 3, 3, 3);
    marks.update({ geometry: c, parts: partsFor(true), glide: false });
    expect(marks.shown()).toEqual(c);
    expect(marks.moving()).toBe(false);
    life.close();
  });

  it("chiusa la vita, niente ascoltatori né corse, e un aggiornamento dopo non fa niente", () => {
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
    marks.update({ geometry: geometryOf(9, 9, 9, 9, 9, 9), parts: partsFor(true) });
    expect(frameListeners()).toBe(1);
    life.close();
    expect(frameListeners()).toBe(0);
    expect(activeMotions()).toBe(0);
    marks.update({ geometry: geometryOf(1, 1, 1, 1, 1, 1), parts: partsFor(true) });
    expect(frameListeners()).toBe(0);
  });

  it("i lati restano al loro posto d'arrivo e un transform li porta dove si vedono, senza tagli in mezzo alla corsa", () => {
    const { host, life, layers } = makeHost();
    const marks = createMarksMotion(host);
    marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
    const b = geometryOf(0, 3, 0, 3, 0, 3);
    marks.update({ geometry: b, parts: partsFor(true) });
    driver.advance(FRAME * 2);
    const top = [...layers.body.children].find((el) => (el as HTMLElement).dataset.mark === "rect-top") as HTMLElement;
    // Il posto d'arrivo, nelle coordinate del livello del corpo.
    expect(top.style.left).toBe(`${b[0]! - 1}px`);
    expect(top.style.transform).toMatch(/^translate\(-/);
    driver.advance(1000);
    expect(top.style.transform).toBe("");
    // Un pezzo per lato, anche dopo tante corse: il serbatoio non cresce.
    expect(layers.body.querySelectorAll('[data-mark="rect-top"]')).toHaveLength(1);
    life.close();
  });

  it("il quadratino tra B5 e A5 col filo della colonna ferma cambia livello nello stesso fotogramma, senza dissolversi", () => {
    // Una colonna ferma larga 100: il suo filo sta su x = 140.
    const bands: Bands = { top: 24, left: 140 };
    const { host, life, lifts } = makeHost(bands);
    const marks = createMarksMotion(host);
    const cell = (column: number) => geometryOf(4, column, 4, column, 4, column, { top: 24, left: 40 });
    const shown = () => ZONES.flatMap((zone) => [...lifts[zone].children].filter((el) => !(el as HTMLElement).hidden).map(() => zone));
    marks.update({ geometry: cell(1), parts: partsFor(true), glide: false });
    expect(shown()).toEqual(["body"]);
    marks.update({ geometry: cell(0), parts: partsFor(true) });
    const plays = driver.plays.length;
    for (let frame = 0; frame < 40; frame += 1) {
      driver.advance(FRAME);
      // Mai due quadratini, mai nessuno.
      expect(shown()).toHaveLength(1);
    }
    expect(shown()).toEqual(["left"]);
    // Nessuna dissolvenza: il quadratino non ricompare, cambia solo livello.
    expect(driver.plays.length).toBe(plays);
    marks.update({ geometry: cell(1), parts: partsFor(true) });
    for (let frame = 0; frame < 40; frame += 1) {
      driver.advance(FRAME);
      expect(shown()).toHaveLength(1);
    }
    expect(shown()).toEqual(["body"]);
    life.close();
  });

  it("un pezzo che compare al suo posto si dissolve dentro; uno senza riposo non compare", () => {
    const { host, life, layers } = makeHost();
    const marks = createMarksMotion(host);
    marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
    // Una cella sola: niente anello né velo.
    expect(layers.body.querySelectorAll(".grid-mark-ring:not([hidden]), .grid-mark-veil:not([hidden])")).toHaveLength(0);
    expect(driver.plays.length).toBeGreaterThan(0);
    life.close();
  });

  describe("le maniglie del tocco", () => {
    const withGrips = (grips: boolean) => (geometry: MarkGeometry) => selectionParts(geometry, { ...LOOK, handle: false, grips });
    const gripsIn = (lifts: Record<Zone, HTMLElement>) =>
      ZONES.flatMap((zone) => [...lifts[zone].querySelectorAll<HTMLElement>(".grid-mark-touch:not([hidden])")]);
    const scaleOf = (el: HTMLElement) => Number(/scale\(([\d.]+)/.exec(el.style.transform)?.[1] ?? "1");

    it("compaiono crescendo dal centro da ENTER_SCALE con `SLIDE`, nel fotogramma del motore, e poi stanno ferme", () => {
      const { host, life, lifts } = makeHost();
      const marks = createMarksMotion(host);
      const g = geometryOf(2, 2, 4, 3, 2, 2);
      marks.update({ geometry: g, parts: withGrips(false), glide: false });
      expect(gripsIn(lifts)).toHaveLength(0);
      const plays = driver.plays.length;
      marks.update({ geometry: g, parts: withGrips(true) });
      const shown = gripsIn(lifts);
      expect(shown.map((el) => el.dataset.handle).sort()).toEqual(["a", "b"]);
      // Nessuna corsa a parte: le fa crescere il fotogramma del motore.
      expect(driver.plays.length).toBe(plays);
      expect(marks.moving()).toBe(true);
      const b = shown.find((el) => el.dataset.handle === "b")!;
      // Il posto d'arrivo: 14 × 14 col centro sull'angolo dei fili.
      expect([b.style.left, b.style.top, b.style.width, b.style.height]).toEqual([`${g[2]! - 8}px`, `${g[3]! - 8}px`, "14px", "14px"]);
      expect(scaleOf(b)).toBeCloseTo(0.96, 6);
      expect(b.style.opacity).toBe("0");
      let last = scaleOf(b);
      for (let frame = 0; frame < 6; frame += 1) {
        driver.advance(FRAME);
        // Cresce senza mai passare la misura vera, e il centro resta fermo.
        expect(scaleOf(b)).toBeGreaterThanOrEqual(last);
        expect(scaleOf(b)).toBeLessThanOrEqual(1);
        last = scaleOf(b);
      }
      driver.advance(1000);
      expect(b.style.transform).toBe("");
      expect(b.style.opacity).toBe("");
      expect(marks.moving()).toBe(false);
      expect(frameListeners()).toBe(0);
      life.close();
    });

    it("con «ridotto» si dissolvono soltanto, senza crescere", () => {
      setMotionPreference("reduced");
      const { host, life, lifts } = makeHost();
      const marks = createMarksMotion(host);
      const g = geometryOf(2, 2, 4, 3, 2, 2);
      marks.update({ geometry: g, parts: withGrips(false), glide: false });
      const plays = driver.plays.length;
      marks.update({ geometry: g, parts: withGrips(true) });
      const shown = gripsIn(lifts);
      expect(shown).toHaveLength(2);
      expect(shown.every((el) => el.style.transform === "" && el.style.opacity === "")).toBe(true);
      expect(driver.plays.length).toBe(plays + 2);
      expect(frameListeners()).toBe(0);
      life.close();
    });

    it("seguono la selezione con gli altri pezzi; tolte, spariscono subito", () => {
      const { host, life, lifts } = makeHost();
      const marks = createMarksMotion(host);
      marks.update({ geometry: geometryOf(2, 2, 2, 2, 2, 2), parts: withGrips(true), glide: false });
      const next = geometryOf(2, 2, 6, 5, 2, 2);
      marks.update({ geometry: next, parts: withGrips(true) });
      for (let frame = 0; frame < 30; frame += 1) {
        driver.advance(FRAME);
        const shown = marks.shown()!;
        const b = gripsIn(lifts).find((el) => el.dataset.handle === "b")!;
        // Il centro della maniglia sta sull'angolo che si vede, in ogni fotogramma.
        const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(b.style.transform);
        const tx = m ? Number(m[1]) : 0;
        const ty = m ? Number(m[2]) : 0;
        const k = scaleOf(b);
        expect(parseFloat(b.style.left) + tx + 7 * k).toBeCloseTo(shown[2]! - 1, 3);
        expect(parseFloat(b.style.top) + ty + 7 * k).toBeCloseTo(shown[3]! - 1, 3);
      }
      marks.update({ geometry: next, parts: withGrips(false) });
      expect(gripsIn(lifts)).toHaveLength(0);
      life.close();
    });

    it("tolte mentre crescono tornano indietro da dove sono, senza saltare; richieste di nuovo, riprendono da lì", () => {
      const { host, life, lifts } = makeHost();
      const marks = createMarksMotion(host);
      const g = geometryOf(2, 2, 4, 3, 2, 2);
      marks.update({ geometry: g, parts: withGrips(false), glide: false });
      marks.update({ geometry: g, parts: withGrips(true) });
      driver.advance(FRAME);
      driver.advance(FRAME);
      const b = gripsIn(lifts).find((el) => el.dataset.handle === "b")!;
      const midway = Number(b.style.opacity);
      expect(midway).toBeGreaterThan(0);
      expect(midway).toBeLessThan(1);
      marks.update({ geometry: g, parts: withGrips(false) });
      // Nello stesso fotogramma è ancora lì, con la stessa comparsa.
      expect(b.hidden).toBe(false);
      expect(Number(b.style.opacity)).toBeCloseTo(midway, 6);
      // La molla porta la velocità che aveva: prima rallenta, poi torna
      // indietro, senza salti da un fotogramma all'altro.
      let last = midway;
      let peak = midway;
      for (let frame = 0; frame < 12; frame += 1) {
        driver.advance(FRAME);
        const now = Number(b.style.opacity);
        expect(Math.abs(now - last)).toBeLessThan(0.2);
        peak = Math.max(peak, now);
        last = now;
      }
      expect(last).toBeLessThan(peak);
      expect(b.hidden).toBe(false);
      const shrinking = last;
      // Richiesta di nuovo mentre torna indietro: cresce da dove è.
      marks.update({ geometry: g, parts: withGrips(true) });
      expect(gripsIn(lifts).filter((el) => el.dataset.handle === "b")).toEqual([b]);
      expect(Number(b.style.opacity)).toBeCloseTo(shrinking, 6);
      driver.advance(1000);
      expect(b.style.opacity).toBe("");
      // Tolta di nuovo, si nasconde quando è tornata a zero e il motore si ferma.
      marks.update({ geometry: g, parts: withGrips(false) });
      driver.advance(1000);
      expect(gripsIn(lifts)).toHaveLength(0);
      expect(marks.moving()).toBe(false);
      expect(frameListeners()).toBe(0);
      life.close();
    });
  });

  let motion: MarksMotion | null = null;
  afterEach(() => {
    motion = null;
  });
  it("owns riconosce i suoi pezzi e clear li nasconde tutti", () => {
    const { host, life, layers } = makeHost();
    motion = createMarksMotion(host);
    motion.update({ geometry: geometryOf(1, 1, 3, 3, 1, 1), parts: partsFor(false), glide: false });
    const pieces = [...layers.body.children];
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((el) => motion!.owns(el))).toBe(true);
    expect(motion.owns(document.createElement("div"))).toBe(false);
    motion.clear();
    expect(pieces.every((el) => (el as HTMLElement).hidden)).toBe(true);
    expect(motion.shown()).toBeNull();
    life.close();
  });
});

/// Le promesse `finished` si risolvono in microtask: le lascia correre.
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("le formiche, il battito e i valori che entrano (griglia T6)", () => {
  const BOX = { L: 140, T: 52, R: 240, B: 164 };
  const ants = () => edgeParts("ants", "ants", BOX, 2, { glide: false, fade: true });
  const strips = (layers: Record<Zone, HTMLElement>) => [...layers.body.querySelectorAll<HTMLElement>(".grid-mark-ants:not([hidden]) > .grid-ants")];
  const walkingPlays = () => driver.plays.filter((play) => play.state === "running" && (play.el as HTMLElement).classList.contains("grid-ants"));

  function waitingMarks(walk: boolean) {
    const made = makeHost();
    const marks = createMarksMotion(made.host);
    marks.update({ geometry: geometryOf(1, 1, 2, 1, 1, 1), parts: partsFor(false), still: ants(), glide: false, walk });
    return { ...made, marks };
  }

  it("camminano un passo lineare alla volta finché il foglio non risponde, poi si fermano ed escono con una dissolvenza", async () => {
    const { life, layers, marks } = waitingMarks(true);
    expect(strips(layers)).toHaveLength(4);
    expect(marks.walking()).toBe(true);
    const first = walkingPlays();
    expect(first).toHaveLength(4);
    for (const play of first) {
      expect(play.timing.duration).toBe(ANTS_MS);
      expect(play.timing.easing).toBe("cubic-bezier(0, 0, 1, 1)");
      // Solo transform, di un passo.
      expect(play.keyframes.every((frame) => Object.keys(frame).every((key) => key === "transform" || key === "offset" || key === "easing"))).toBe(true);
      expect(JSON.stringify(play.keyframes)).toContain(`${ANTS_STEP}px`);
    }
    driver.advance(ANTS_MS + FRAME);
    await flush();
    // Il passo dopo riparte da capo.
    expect(walkingPlays()).toHaveLength(4);
    expect(driver.plays.filter((play) => (play.el as HTMLElement).classList.contains("grid-ants")).length).toBeGreaterThanOrEqual(8);

    // La risposta: le formiche non servono più.
    marks.update({ geometry: geometryOf(1, 1, 5, 1, 1, 1), parts: partsFor(false), still: [], walk: false });
    expect(marks.walking()).toBe(false);
    expect(walkingPlays()).toHaveLength(0);
    const leaving = [...layers.body.querySelectorAll<HTMLElement>(".grid-mark-ants")];
    expect(leaving.every((el) => !el.hidden)).toBe(true);
    driver.advance(DURATION.swap + FRAME);
    await flush();
    expect(leaving.every((el) => el.hidden)).toBe(true);
    driver.advance(ANTS_MS * 3);
    await flush();
    expect(walkingPlays()).toHaveLength(0);
    expect(activeMotions()).toBe(0);
    life.close();
  });

  it("ferme mentre si tira: il contorno c'è, nessuna corsa", () => {
    const { life, layers, marks } = waitingMarks(false);
    expect(strips(layers)).toHaveLength(4);
    expect(marks.walking()).toBe(false);
    expect(walkingPlays()).toHaveLength(0);
    life.close();
  });

  it("lo smontaggio le ferma", async () => {
    const { life, marks } = waitingMarks(true);
    expect(walkingPlays()).toHaveLength(4);
    life.close();
    expect(marks.walking()).toBe(false);
    expect(activeMotions()).toBe(0);
    driver.advance(ANTS_MS * 2);
    await flush();
    expect(walkingPlays()).toHaveLength(0);
  });

  it("«ridotto» le ferma a metà cammino, e con «ridotto» non partono e se ne vanno senza dissolvenza", async () => {
    const { life, layers, marks } = waitingMarks(true);
    driver.advance(ANTS_MS / 2);
    setMotionPreference("reduced");
    expect(marks.walking()).toBe(false);
    expect(walkingPlays()).toHaveLength(0);
    driver.advance(ANTS_MS * 2);
    await flush();
    expect(walkingPlays()).toHaveLength(0);
    // Ancora in attesa: il contorno resta, fermo.
    marks.update({ geometry: geometryOf(1, 1, 2, 1, 1, 1), parts: partsFor(false), still: ants(), walk: true });
    expect(strips(layers)).toHaveLength(4);
    expect(marks.walking()).toBe(false);
    marks.update({ geometry: geometryOf(1, 1, 2, 1, 1, 1), parts: partsFor(false), still: [], walk: false });
    expect(layers.body.querySelectorAll(".grid-mark-ants:not([hidden])")).toHaveLength(0);
    life.close();
  });

  it("il battito di una copia è un velo che svanisce in DURATION.swap e poi si nasconde", async () => {
    const { host, life, layers } = makeHost();
    const marks = createMarksMotion(host);
    marks.pulse({ x: 140, y: 52, w: 300, h: 168 });
    const flash = layers.body.querySelector<HTMLElement>(".grid-mark-flash")!;
    expect(flash.hidden).toBe(false);
    expect(marks.owns(flash)).toBe(true);
    const play = driver.plays[driver.plays.length - 1]!;
    expect(play.el).toBe(flash);
    expect(play.timing.duration).toBe(DURATION.swap);
    expect(play.keyframes.map((frame) => Number(frame.opacity))).toEqual([1, 0]);
    driver.advance(DURATION.swap + FRAME);
    await flush();
    expect(flash.hidden).toBe(true);
    life.close();
  });

  it("i valori di un riempimento entrano uno dopo l'altro, con una dissolvenza", () => {
    const life = openLifetime();
    const texts = [0, 1, 2].map(() => document.body.appendChild(document.createElement("span")));
    enterValues(texts, life);
    const plays = driver.plays.filter((play) => texts.includes(play.el as HTMLElement));
    expect(plays).toHaveLength(3);
    expect(plays.map((play) => play.timing.delay)).toEqual([...plays.map((play) => play.timing.delay)].sort((a, b) => a - b));
    expect(plays[1]!.timing.delay).toBeGreaterThan(plays[0]!.timing.delay);
    expect(plays.every((play) => Number(play.keyframes[0]!.opacity) === 0)).toBe(true);
    life.close();
  });
});

/// Il tempo (ms) in cui un lato fermo arriva al 90 % di un salto di dieci
/// colonne, a passi di un millisecondo.
function ninetyPercent(spring: typeof GLIDE): number {
  const from = geometryOf(0, 0, 0, 0, 0, 0);
  const goal = geometryOf(0, 10, 0, 10, 0, 10);
  const pose: MarksPose = { x: from.slice(), v: from.map(() => 0) };
  const distance = goal[0]! - from[0]!;
  for (let ms = 1; ms <= 1000; ms += 1) {
    stepMarks({ geometry: goal, spring, fill: false }, pose, 0.001);
    if (Math.abs(goal[0]! - pose.x[0]!) <= distance * 0.1) return ms;
  }
  return Infinity;
}

describe("le due preferenze della griglia (griglia T9)", () => {
  it("un valore che non si conosce vale quello di serie", () => {
    expect(copyMarkOf("dash")).toBe("dash");
    expect(copyMarkOf("pulse")).toBe("pulse");
    expect(copyMarkOf("dash-pulse")).toBe("dash-pulse");
    for (const strange of ["zigzag", "", 3, true, null, undefined, ["dash"]]) {
      expect(copyMarkOf(strange)).toBe("dash-pulse");
      expect(selectionSpeedOf(strange)).toBe("normal");
    }
    expect(selectionSpeedOf("quick")).toBe("quick");
    expect(selectionSpeedOf("soft")).toBe("soft");
    expect(selectionSpeedOf("none")).toBe("none");
  });

  it("ogni velocità ha la sua molla; le colonne che scivolano tengono SLIDE con ogni scelta", () => {
    expect(selectionMotion("quick")).toEqual({ spring: GLIDE_QUICK, snap: false });
    expect(selectionMotion("normal")).toEqual({ spring: GLIDE, snap: false });
    expect(selectionMotion("soft")).toEqual({ spring: SLIDE, snap: false });
    expect(selectionMotion("none")).toEqual({ spring: GLIDE, snap: true });
    for (const speed of ["quick", "normal", "soft", "none"] as const) {
      expect(selectionMotion(speed, SLIDE)).toEqual({ spring: SLIDE, snap: false });
    }
  });

  it("i tempi al 90 %: Svelta prima di Come di norma, Morbida dopo", () => {
    expect(slowRoot(GLIDE_QUICK)).toBeCloseTo(50, 6);
    const quick = ninetyPercent(GLIDE_QUICK);
    const normal = ninetyPercent(GLIDE);
    const soft = ninetyPercent(SLIDE);
    // Misurati: 74, 105 e 148 ms.
    expect(quick).toBeGreaterThanOrEqual(65);
    expect(quick).toBeLessThanOrEqual(85);
    expect(normal).toBeGreaterThanOrEqual(95);
    expect(normal).toBeLessThanOrEqual(115);
    expect(soft).toBeGreaterThanOrEqual(135);
    expect(soft).toBeLessThanOrEqual(165);
  });

  it("A scatti: in ogni fotogramma la selezione scelta, senza iscriversi all'orologio, anche con eventi fitti", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const random = seeded(seed);
      const targets = gesture(random, 80);
      const { host, life } = makeHost();
      const marks = createMarksMotion(host);
      const { spring, snap } = selectionMotion("none");
      marks.update({ geometry: targets[0]!, parts: partsFor(false), glide: false });
      for (let cursor = 1; cursor < targets.length;) {
        const size = 1 + Math.floor(random() * 10);
        for (const geometry of targets.slice(cursor, cursor + size)) {
          marks.update({ geometry, parts: partsFor(false), spring, snap });
          expect(marks.shown(), `seme ${seed}`).toEqual(geometry);
        }
        cursor += size;
        expect(marks.moving(), `seme ${seed}`).toBe(false);
        driver.advance(FRAME);
        expect(marks.shown(), `seme ${seed}`).toEqual(targets[Math.min(cursor, targets.length) - 1]);
      }
      expect(frameListeners()).toBe(0);
      life.close();
    }
  });

  it("A scatti scelto a metà corsa: il segno che scivola finisce la sua corsa, il gesto dopo salta", () => {
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    const a = geometryOf(0, 0, 0, 0, 0, 0);
    const b = geometryOf(0, 6, 0, 6, 0, 6);
    marks.update({ geometry: a, parts: partsFor(true), glide: false });
    marks.update({ geometry: b, parts: partsFor(true), ...selectionMotion("normal") });
    driver.advance(FRAME * 2);
    const mid = marks.shown()!;
    expect(mid[0]).toBeGreaterThan(a[0]!);
    expect(mid[0]).toBeLessThan(b[0]!);
    // Un ridisegno con lo stesso bersaglio (la risposta del foglio, uno
    // scorrimento) e la scelta nuova: niente salto, la corsa continua.
    marks.update({ geometry: b, parts: partsFor(true), ...selectionMotion("none") });
    expect(marks.shown()).toEqual(mid);
    expect(marks.moving()).toBe(true);
    driver.advance(FRAME);
    expect(marks.shown()![0]).toBeGreaterThan(mid[0]!);
    expect(marks.shown()![0]).toBeLessThan(b[0]!);
    // Il gesto dopo: subito sulla cella scelta.
    const c = geometryOf(2, 1, 2, 1, 2, 1);
    marks.update({ geometry: c, parts: partsFor(true), ...selectionMotion("none") });
    expect(marks.shown()).toEqual(c);
    expect(marks.moving()).toBe(false);
    expect(frameListeners()).toBe(0);
    life.close();
  });

  it("una molla cambiata a metà corsa riparte da dove si vede, senza salti", () => {
    const { host, life } = makeHost();
    const marks = createMarksMotion(host);
    const a = geometryOf(0, 0, 0, 0, 0, 0);
    const b = geometryOf(0, 8, 0, 8, 0, 8);
    marks.update({ geometry: a, parts: partsFor(true), glide: false });
    marks.update({ geometry: b, parts: partsFor(true), ...selectionMotion("quick") });
    driver.advance(FRAME * 2);
    const mid = marks.shown()!;
    marks.update({ geometry: b, parts: partsFor(true), ...selectionMotion("soft") });
    expect(marks.shown()).toEqual(mid);
    let last = mid[0]!;
    for (let frame = 0; frame < 60; frame += 1) {
      driver.advance(FRAME);
      const now = marks.shown()![0]!;
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now).toBeLessThanOrEqual(b[0]!);
      last = now;
    }
    expect(marks.shown()).toEqual(b);
    life.close();
  });

  for (const speed of ["quick", "normal", "soft", "none"] as const) {
    it(`con il moto ridotto la selezione si ferma subito anche con «${speed}»`, () => {
      setMotionPreference("reduced");
      const { host, life } = makeHost();
      const marks = createMarksMotion(host);
      marks.update({ geometry: geometryOf(0, 0, 0, 0, 0, 0), parts: partsFor(true), glide: false });
      const b = geometryOf(4, 7, 4, 7, 4, 7);
      marks.update({ geometry: b, parts: partsFor(true), ...selectionMotion(speed) });
      expect(marks.shown()).toEqual(b);
      expect(marks.moving()).toBe(false);
      expect(frameListeners()).toBe(0);
      life.close();
    });
  }
});
