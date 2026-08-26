// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

describe("canale del moto ridotto", () => {
  it("legge matchMedia una volta e diffonde il cambio", async () => {
    vi.resetModules();
    let matches = true;
    let change: ((event: { matches: boolean }) => void) | undefined;
    const media = {
      get matches() {
        return matches;
      },
      addEventListener: vi.fn((_name: string, listener: (event: { matches: boolean }) => void) => {
        change = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const query = vi.fn(() => media);
    const previous = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { value: query, configurable: true });
    try {
      const motion = await import("./reduced-motion");
      const { createCameraState } = await import("../graph/render/camera");
      const { pulseOpacity } = await import("../graph/render/painter");
      expect(motion.reducedMotion()).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
      const camera = createCameraState(motion.reducedMotion());
      camera.zoom(2, 400, 300);
      expect(camera.state().scale).toBe(2);
      expect(pulseOpacity("n0", 100, 1, !motion.reducedMotion())).toBeUndefined();
      const seen: boolean[] = [];
      const unsubscribe = motion.onReducedMotionChange((value) => {
        seen.push(value);
        camera.setReducedMotion(value);
      });
      matches = false;
      change?.({ matches });
      expect(motion.reducedMotion()).toBe(false);
      expect(seen).toEqual([false]);
      camera.zoom(2, 400, 300);
      expect(camera.state().scale).toBe(2);
      expect(camera.ready()).toBe(false);
      expect(pulseOpacity("n0", 100, 1, !motion.reducedMotion())).toBeDefined();
      unsubscribe();
    } finally {
      Object.defineProperty(window, "matchMedia", { value: previous, configurable: true });
    }
  });
});
