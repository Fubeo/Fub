// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import type { EditorContext } from "../context";
import { installNavigator, navigatorBox } from "./navigator";

/// Un editor finto con un foglio, una vista e le notifiche della banda, che si chiamano
/// a mano come fa la banda a ogni fotogramma.
function fingi() {
  const surface = document.createElement("div");
  document.body.append(surface);
  const life = openLifetime();
  const ascoltatori = new Set<() => void>();
  const ctx = {
    disposed: false,
    surface,
    life,
    camera: { scale: 1, angle: 0, tx: 0, ty: 0 },
    placed: false,
    viewArea: () => ({ x: 0, y: 0, w: 400, h: 300 }),
    currentIndex: vi.fn(() => ({ units: [] })),
    currentPage: () => null,
    boardsNow: () => [],
    status: {
      subscribe: (listener: () => void) => {
        ascoltatori.add(listener);
        return () => ascoltatori.delete(listener);
      },
    },
    setCamera: vi.fn(),
    statusChanged: vi.fn(),
    announce: vi.fn(),
  } as unknown as EditorContext;
  installNavigator(ctx);
  const cambia = (): void => [...ascoltatori].forEach((ascolto) => ascolto());
  /// La panoramica sta subito dopo il foglio.
  const panoramica = (): HTMLElement => surface.nextElementSibling as HTMLElement;
  return { ctx, life, cambia, panoramica };
}

describe("il navigatore della banda", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("nasce spento, si accende e si spegne, e la banda se ne accorge", () => {
    const { ctx, panoramica } = fingi();
    expect(ctx.navigator).toBe(false);
    expect(panoramica().hidden).toBe(true);
    ctx.setNavigator(true);
    expect(panoramica().hidden).toBe(false);
    expect(ctx.statusChanged).toHaveBeenCalledTimes(1);
    ctx.setNavigator(false);
    expect(panoramica().hidden).toBe(true);
    expect(ctx.statusChanged).toHaveBeenCalledTimes(2);
  });

  it("si rilegge a ogni avviso della banda, e chiudere il disegno ne stacca l'ascolto", () => {
    const { ctx, cambia, life } = fingi();
    ctx.setNavigator(true);
    expect(ctx.currentIndex).toHaveBeenCalledTimes(1);
    cambia();
    cambia();
    cambia();
    expect(ctx.currentIndex).toHaveBeenCalledTimes(4);
    life.close();
    cambia();
    expect(ctx.currentIndex).toHaveBeenCalledTimes(4);
  });

  it("spento, la panoramica non si rilegge", () => {
    const { ctx, cambia } = fingi();
    cambia();
    cambia();
    expect(ctx.currentIndex).not.toHaveBeenCalled();
  });
});

describe("la geometria della panoramica", () => {
  it("senza disegno inquadra un quadrato di riferimento, e con il disegno lo contiene con un margine", () => {
    expect(navigatorBox(null, [])).toEqual({ min: [0, 0], max: [1, 1] });
    // Il margine è il 6 % della misura più grande: 6 unità per un disegno di 100 × 50.
    expect(navigatorBox({ min: [0, 0], max: [100, 50] }, [])).toEqual({ min: [-6, -6], max: [106, 56] });
  });
});
