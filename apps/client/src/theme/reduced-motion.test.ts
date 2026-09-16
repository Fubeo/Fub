// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

type FakeMedia = {
  matches: boolean;
  dispatch(next: boolean): void;
  addEventListener?: ReturnType<typeof vi.fn>;
  removeEventListener?: ReturnType<typeof vi.fn>;
  addListener?: ReturnType<typeof vi.fn>;
  removeListener?: ReturnType<typeof vi.fn>;
};

describe("canale del moto ridotto", () => {
  function installMedia(initial: boolean, legacy = false) {
    let matches = initial;
    const listeners = new Set<(event: { matches: boolean }) => void>();
    const media = {
      get matches() {
        return matches;
      },
      ...(legacy
        ? {
            addListener: vi.fn((listener: (event: { matches: boolean }) => void) => {
              listeners.add(listener);
            }),
            removeListener: vi.fn((listener: (event: { matches: boolean }) => void) => {
              listeners.delete(listener);
            }),
          }
        : {
            addEventListener: vi.fn(
              (_name: string, listener: (event: { matches: boolean }) => void) => {
                listeners.add(listener);
              },
            ),
            removeEventListener: vi.fn(
              (_name: string, listener: (event: { matches: boolean }) => void) => {
                listeners.delete(listener);
              },
            ),
          }),
      dispatch(next: boolean) {
        matches = next;
        for (const listener of [...listeners]) listener({ matches });
      },
    };
    const query = vi.fn(() => media as unknown as MediaQueryList);
    const previous = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { value: query, configurable: true });
    return {
      media: media as FakeMedia,
      query,
      restore: () =>
        Object.defineProperty(window, "matchMedia", { value: previous, configurable: true }),
    };
  }

  it("tiene il listener nativo solo con subscriber vivi", async () => {
    vi.resetModules();
    const fake = installMedia(true);
    try {
      const motion = await import("./reduced-motion");
      expect(motion.reducedMotion()).toBe(true);
      expect(fake.query).toHaveBeenCalledTimes(1);
      expect(fake.media.addEventListener).not.toHaveBeenCalled();

      const seenA: boolean[] = [];
      const disposeA = motion.onReducedMotionChange((value) => seenA.push(value));
      expect(fake.media.addEventListener).toHaveBeenCalledTimes(1);
      disposeA();
      disposeA();
      expect(fake.media.removeEventListener).toHaveBeenCalledTimes(1);

      fake.media.dispatch(false);
      expect(seenA).toEqual([]);
      const seenB: boolean[] = [];
      const disposeB = motion.onReducedMotionChange((value) => seenB.push(value));
      expect(fake.query).toHaveBeenCalledTimes(1);
      expect(fake.media.addEventListener).toHaveBeenCalledTimes(2);
      expect(motion.reducedMotion()).toBe(false);
      fake.media.dispatch(true);
      expect(seenB).toEqual([true]);
      disposeB();
      expect(fake.media.removeEventListener).toHaveBeenCalledTimes(2);
    } finally {
      fake.restore();
    }
  });

  it("mantiene indipendenti subscription con lo stesso callback", async () => {
    vi.resetModules();
    const fake = installMedia(false);
    try {
      const motion = await import("./reduced-motion");
      const seen: boolean[] = [];
      const listener = (value: boolean) => seen.push(value);
      const disposeA = motion.onReducedMotionChange(listener);
      const disposeB = motion.onReducedMotionChange(listener);
      disposeA();
      expect(fake.media.removeEventListener).not.toHaveBeenCalled();
      fake.media.dispatch(true);
      expect(seen).toEqual([true]);
      disposeB();
      expect(fake.media.removeEventListener).toHaveBeenCalledTimes(1);
    } finally {
      fake.restore();
    }
  });

  it("non visita i subscriber aggiunti durante un dispatch", async () => {
    vi.resetModules();
    const fake = installMedia(false);
    try {
      const motion = await import("./reduced-motion");
      const seen: string[] = [];
      let disposeB: (() => void) | undefined;
      const disposeA = motion.onReducedMotionChange(() => {
        seen.push("a");
        disposeB ??= motion.onReducedMotionChange(() => seen.push("b"));
      });
      fake.media.dispatch(true);
      expect(seen).toEqual(["a"]);
      fake.media.dispatch(false);
      expect(seen).toEqual(["a", "a", "b"]);
      disposeA();
      disposeB?.();
    } finally {
      fake.restore();
    }
  });

  it("conserva un solo listener per subscriber sovrapposti", async () => {
    vi.resetModules();
    const fake = installMedia(false);
    try {
      const motion = await import("./reduced-motion");
      const disposeA = motion.onReducedMotionChange(() => {});
      const disposeB = motion.onReducedMotionChange(() => {});
      expect(fake.media.addEventListener).toHaveBeenCalledTimes(1);
      disposeA();
      expect(fake.media.removeEventListener).not.toHaveBeenCalled();
      disposeB();
      expect(fake.media.removeEventListener).toHaveBeenCalledTimes(1);
    } finally {
      fake.restore();
    }
  });

  it("rimuove simmetricamente il listener legacy", async () => {
    vi.resetModules();
    const fake = installMedia(false, true);
    try {
      const motion = await import("./reduced-motion");
      const dispose = motion.onReducedMotionChange(() => {});
      expect(fake.media.addListener).toHaveBeenCalledTimes(1);
      dispose();
      expect(fake.media.removeListener).toHaveBeenCalledTimes(1);
    } finally {
      fake.restore();
    }
  });

  it("integra il canale con camera e painter", async () => {
    vi.resetModules();
    const fake = installMedia(true);
    try {
      const motion = await import("./reduced-motion");
      const { createCameraState } = await import("../graph/render/camera");
      const { pulseOpacity } = await import("../graph/render/painter");
      const camera = createCameraState(motion.reducedMotion());
      camera.zoom(2, 400, 300);
      expect(camera.state().scale).toBe(2);
      expect(pulseOpacity("n0", 100, 1, !motion.reducedMotion())).toBeUndefined();
      const seen: boolean[] = [];
      const unsubscribe = motion.onReducedMotionChange((value) => {
        seen.push(value);
        camera.setReducedMotion(value);
      });
      fake.media.dispatch(false);
      expect(motion.reducedMotion()).toBe(false);
      expect(seen).toEqual([false]);
      camera.zoom(2, 400, 300);
      expect(camera.state().scale).toBe(2);
      expect(camera.ready()).toBe(false);
      expect(pulseOpacity("n0", 100, 1, !motion.reducedMotion())).toBeDefined();
      unsubscribe();
    } finally {
      fake.restore();
    }
  });
});
