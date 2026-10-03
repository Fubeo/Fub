// @vitest-environment happy-dom
//
// «Segui il tablet»: la camera del PC va dove guarda lo scrittore, salta col
// moto ridotto, e si ferma appena l'utente la muove.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";
import { cameraFor, createLiveFollow, type LiveFollow } from "./follow";
import { fakeStage, type FakeStage } from "./test-support";

const VIEW = { x: 100, y: 50, scale: 2, w: 400, h: 300 };

let frames: FrameRequestCallback[] = [];
let stages: FakeStage[] = [];
let released = 0;
let follow: LiveFollow;

function run(frames_ = 200): void {
  let time = 0;
  for (let i = 0; i < frames_ && frames.length > 0; i++) {
    const pending = frames;
    frames = [];
    time += 16;
    for (const callback of pending) callback(time);
  }
}

beforeEach(() => {
  frames = [];
  released = 0;
  stages = [fakeStage({ width: 800, height: 600 })];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  follow?.dispose();
  setReducedMotionPreference(false);
  vi.restoreAllMocks();
});

const make = (on: boolean): LiveFollow =>
  (follow = createLiveFollow(on, {
    stages: () => stages,
    released: () => {
      released++;
    },
  }));

describe("segui il tablet", () => {
  it("la camera contiene tutta la vista, centrata", () => {
    expect(cameraFor(VIEW, 800, 600)).toEqual({ scale: 2, tx: -200, ty: -100 });
    expect(cameraFor({ ...VIEW, w: 0 }, 800, 600)).toBeNull();
    expect(cameraFor(VIEW, 0, 600)).toBeNull();
    expect(cameraFor({ ...VIEW, x: Number.NaN }, 800, 600)).toBeNull();
  });

  it("spento non muove niente; acceso insegue fino alla vista", () => {
    make(false);
    follow.view(VIEW);
    expect(frames).toHaveLength(0);
    follow.set(true);
    run();
    const camera = stages[0]!.stage.camera;
    expect(camera.scale).toBeCloseTo(2, 6);
    expect(camera.tx).toBeCloseTo(-200, 6);
    expect(camera.ty).toBeCloseTo(-100, 6);
    expect(released).toBe(0);
  });

  it("col moto ridotto salta subito", () => {
    setReducedMotionPreference(true);
    make(true);
    follow.view(VIEW);
    expect(frames).toHaveLength(0);
    expect(stages[0]!.stage.camera).toEqual({ scale: 2, tx: -200, ty: -100 });
  });

  it("chi muove la vista sul PC se la riprende", () => {
    make(true);
    follow.view(VIEW);
    run(2);
    stages[0]!.stage.setCamera({ scale: 1, tx: 5, ty: 5 });
    run();
    expect(follow.on).toBe(false);
    expect(released).toBe(1);
    expect(stages[0]!.stage.camera).toEqual({ scale: 1, tx: 5, ty: 5 });
    follow.view({ ...VIEW, x: 0 });
    expect(stages[0]!.stage.camera).toEqual({ scale: 1, tx: 5, ty: 5 });
    // Riacceso, riparte da dov'è l'utente e torna a seguire.
    follow.set(true);
    run();
    expect(stages[0]!.stage.camera.tx).toBeCloseTo(0, 6);
  });

  it("un foglio nuovo va dove sono gli altri", () => {
    setReducedMotionPreference(true);
    make(true);
    follow.view(VIEW);
    stages.push(fakeStage({ width: 400, height: 300 }));
    follow.restage();
    expect(stages[1]!.stage.camera).toEqual({ scale: 1, tx: -100, ty: -50 });
  });
});
