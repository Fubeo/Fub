// @vitest-environment happy-dom
// Il navigatore della lavagna (N6 T55): quando si vede e quando sparisce, la
// mappa che include la scheda più lontana, il clic che è un salto (vola, come
// Maiusc+1), il trascinamento che sposta subito, il ridisegno solo a fine
// gesto, una sola <canvas> anche con 2000 schede, «Nascondi il navigatore»
// ricordato nella vista, F6 e le frecce.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasEngine, type CanvasEngineOptions } from "../engine";
import { canvasCoreReady } from "../wasm/core";
import type { CanvasNode } from "../model";
import type { CanvasViewMemory } from "../view-state";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";
import {
  NAVIGATOR_KEY_STEP,
  boardBounds,
  centeredOn,
  mapFit,
  mapToBoard,
  navigatorFrame,
  navigatorShown,
  seenBounds,
  type NavigatorView,
} from "./navigator";

beforeAll(async () => {
  await canvasCoreReady();
});

const node = (id: string, x: number, y: number, width = 200, height = 100, extra: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: "text", x, y, width, height, text: id, ...extra }) as CanvasNode;

const VIEW: NavigatorView = { camera: { x: 0, y: 0, zoom: 1 }, width: 800, height: 600 };

describe("il navigatore: le regole", () => {
  it("una lavagna vuota non ce l'ha, né una che sta tutta nella vista, né una nascosta", () => {
    expect(navigatorShown([], VIEW, true)).toBe(false);
    expect(navigatorShown(null, VIEW, true)).toBe(false);
    expect(navigatorShown([node("a", 10, 10)], VIEW, true)).toBe(false);
    // Una scheda che esce di un pixel basta.
    expect(navigatorShown([node("a", 10, 10), node("b", 700, 500, 101)], VIEW, true)).toBe(true);
    expect(navigatorShown([node("a", 10, 10), node("b", 700, 500, 101)], VIEW, false)).toBe(false);
    // Lo zoom conta: al 50% la vista copre il doppio.
    expect(navigatorShown([node("a", 10, 10), node("b", 1400, 1000)], { ...VIEW, camera: { x: 0, y: 0, zoom: 0.5 } }, true)).toBe(false);
  });

  it("la mappa include la scheda più lontana e la vista, e il punto torna dove era", () => {
    const nodes = [node("a", 0, 0), node("far", 90_000, -40_000)];
    const frame = navigatorFrame(nodes, VIEW);
    expect(frame.min[0]).toBeLessThanOrEqual(0);
    expect(frame.max[0]).toBeGreaterThanOrEqual(90_200);
    expect(frame.min[1]).toBeLessThanOrEqual(-40_000);
    expect(frame.max[1]).toBeGreaterThanOrEqual(600);
    const fit = mapFit(frame, 168, 120);
    const [x, y] = mapToBoard(fit, 84, 60);
    expect(x).toBeCloseTo((frame.min[0] + frame.max[0]) / 2, 6);
    expect(y).toBeCloseTo((frame.min[1] + frame.max[1]) / 2, 6);
    expect(boardBounds(nodes)).toEqual({ min: [0, -40_000], max: [90_200, 100] });
  });

  it("centrare su un punto tiene lo zoom", () => {
    const view: NavigatorView = { camera: { x: 10, y: 20, zoom: 2 }, width: 800, height: 600 };
    const camera = centeredOn(view, [100, 50]);
    expect(camera).toEqual({ x: 400 - 200, y: 300 - 100, zoom: 2 });
    const seen = seenBounds({ ...view, camera });
    expect((seen.min[0] + seen.max[0]) / 2).toBeCloseTo(100);
    expect((seen.min[1] + seen.max[1]) / 2).toBeCloseTo(50);
  });
});

// --- sulla lavagna ----------------------------------------------------------------

/** Una tela 2D finta: conta i rettangoli dipinti, happy-dom non dipinge. */
function fakeContext() {
  const calls = { fillRect: 0, strokeRect: 0, drawImage: 0 };
  const ctx = {
    canvas: null,
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {
      calls.fillRect++;
    },
    strokeRect: () => {
      calls.strokeRect++;
    },
    drawImage: () => {
      calls.drawImage++;
    },
  };
  return { ctx, calls };
}

describe("il navigatore sulla lavagna", () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let paint = fakeContext();

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    paint = fakeContext();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => paint.ctx as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    setReducedMotionPreference(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function runFrames(limit = 600): void {
    let now = 0;
    for (let i = 0; i < limit && frames.size > 0; i++) {
      now += 16;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(now);
    }
  }

  /** Due schede lontane: inquadrate tutte e due, la lavagna sta nella vista. */
  function source(extra: CanvasNode[] = []): string {
    return JSON.stringify({ nodes: [node("a", 0, 0), node("b", 4000, 3000, 200, 100, { color: "4" }), ...extra], edges: [] });
  }

  function mounted(text = source(), overrides: Partial<CanvasEngineOptions> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    let statusChanges = 0;
    const engine = new CanvasEngine(host, {
      surfaceId: "test",
      formatId: "canvas",
      revision: "rev-1",
      documentId: "board.canvas",
      onChange: () => {},
      onSelectionChange: () => {},
      onStatusChange: () => {
        statusChanges++;
      },
      ...overrides,
    });
    engine.setDoc(text);
    const navigator = host.querySelector<HTMLElement>(".canvas-navigator")!;
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    // La mappa misura 168 × 120 da (0, 0): happy-dom non dispone niente.
    vi.spyOn(navigator, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 168, bottom: 120, width: 168, height: 120, toJSON: () => ({}),
    } as DOMRect);
    return { engine, host, navigator, viewport, statusChanges: () => statusChanges };
  }

  function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
    if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  function pointer(target: EventTarget, type: string, init: PointerEventInit): PointerEvent {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse", isPrimary: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  /** «0»: il 100% sul centro, senza volo; la lavagna non sta più nella vista. */
  function zoomIn(viewport: HTMLElement): void {
    setReducedMotionPreference(true);
    key(viewport, { key: "0" });
    setReducedMotionPreference(false);
  }

  /** La vista come la vede il navigatore (happy-dom: la misura di riserva). */
  function viewOf(host: HTMLElement): NavigatorView {
    return { camera: cameraOf(host), width: 800, height: 600 };
  }

  const nodesOf = (engine: CanvasEngine): CanvasNode[] => (JSON.parse(engine.getDoc()) as { nodes: CanvasNode[] }).nodes;

  it("sparisce con tutta la lavagna in vista e c'è quando la lavagna esce dalla vista", () => {
    const { host, navigator, viewport } = mounted();
    expect(navigator.hidden).toBe(true);
    zoomIn(viewport);
    expect(cameraOf(host).zoom).toBeCloseTo(1, 9);
    expect(navigator.hidden).toBe(false);
    expect(navigator.getAttribute("aria-label")).toBe("Navigatore");
    // Una lavagna vuota non ce l'ha.
    const empty = mounted(JSON.stringify({ nodes: [], edges: [] }));
    zoomIn(empty.viewport);
    expect(empty.navigator.hidden).toBe(true);
  });

  it("un clic porta la vista lì con un salto: vola come Maiusc+1", () => {
    const { engine, host, navigator, viewport } = mounted();
    zoomIn(viewport);
    const before = viewOf(host);
    const fit = mapFit(navigatorFrame(nodesOf(engine), before), 168, 120);
    const target = centeredOn(before, mapToBoard(fit, 150, 100));
    pointer(navigator, "pointerdown", { clientX: 150, clientY: 100 });
    pointer(navigator, "pointerup", { clientX: 150, clientY: 100 });
    // Un salto vola: la vista parte, e arriva coi fotogrammi.
    expect(frames.size).toBe(1);
    expect(cameraOf(host)).toEqual(before.camera);
    runFrames();
    const after = cameraOf(host);
    expect(after.x).toBeCloseTo(target.x, 0);
    expect(after.y).toBeCloseTo(target.y, 0);
    expect(after.zoom).toBeCloseTo(1, 9);
    // Col movimento ridotto arriva subito.
    setReducedMotionPreference(true);
    pointer(navigator, "pointerdown", { clientX: 20, clientY: 20 });
    pointer(navigator, "pointerup", { clientX: 20, clientY: 20 });
    expect(frames.size).toBe(0);
    expect(cameraOf(host)).not.toEqual(after);
  });

  it("trascinare il riquadro sposta subito la vista, e la banda e la mappa si rifanno solo alla fine", () => {
    const { engine, host, navigator, viewport, statusChanges } = mounted();
    zoomIn(viewport);
    const start = viewOf(host);
    const fit = mapFit(navigatorFrame(nodesOf(engine), start), 168, 120);
    // Il centro della vista nella mappa: si prende il riquadro lì.
    const seen = seenBounds(start);
    const cx = fit.left + ((seen.min[0] + seen.max[0]) / 2 - fit.frame.min[0]) * fit.scale;
    const cy = fit.top + ((seen.min[1] + seen.max[1]) / 2 - fit.frame.min[1]) * fit.scale;
    const status = statusChanges();
    pointer(navigator, "pointerdown", { clientX: cx, clientY: cy });
    pointer(navigator, "pointermove", { clientX: cx + 10, clientY: cy + 5 });
    pointer(navigator, "pointermove", { clientX: cx + 20, clientY: cy + 10 });
    const moved = cameraOf(host);
    // La vista si sposta sotto la mano, senza volo, dello stesso tratto della lavagna.
    expect(frames.size).toBe(0);
    expect(moved.x).toBeCloseTo(start.camera.x - (20 / fit.scale) * start.camera.zoom, 3);
    expect(moved.y).toBeCloseTo(start.camera.y - (10 / fit.scale) * start.camera.zoom, 3);
    expect(statusChanges()).toBe(status);
    pointer(navigator, "pointerup", { clientX: cx + 20, clientY: cy + 10 });
    expect(cameraOf(host)).toEqual(moved);
    expect(frames.size).toBe(0);
  });

  it("2000 schede: una sola <canvas>, e trascinando la lavagna la mappa non si ridipinge", () => {
    const many = Array.from({ length: 2000 }, (_, i) => node(`n${i}`, (i % 50) * 260, Math.floor(i / 50) * 160));
    const { host, navigator, viewport } = mounted(JSON.stringify({ nodes: many, edges: [] }));
    zoomIn(viewport);
    expect(navigator.hidden).toBe(false);
    expect(navigator.querySelectorAll("canvas")).toHaveLength(1);
    expect(navigator.children).toHaveLength(2);
    const painted = paint.calls.fillRect;
    expect(painted).toBeGreaterThanOrEqual(2000);
    // La Mano trascina la lavagna: niente durante, un disegno alla fine.
    key(viewport, { key: "h" });
    pointer(viewport, "pointerdown", { clientX: 400, clientY: 300 });
    for (let k = 1; k <= 10; k++) pointer(viewport, "pointermove", { clientX: 400 - k * 20, clientY: 300 - k * 10 });
    expect(paint.calls.fillRect).toBe(painted);
    pointer(viewport, "pointerup", { clientX: 200, clientY: 200 });
    expect(paint.calls.fillRect).toBeGreaterThan(painted);
    expect(cameraOf(host).x).not.toBe(0);
  });

  it("«Nascondi il navigatore» lo spegne per questa lavagna e si ricorda; «Mostra» lo riaccende", async () => {
    const writes: unknown[] = [];
    const memory: CanvasViewMemory = {
      read: async () => null,
      write: async (_id, value) => {
        writes.push(value);
      },
    };
    const { engine, navigator, viewport } = mounted(source(), { viewMemory: memory });
    await Promise.resolve();
    await Promise.resolve();
    zoomIn(viewport);
    expect(navigator.hidden).toBe(false);
    const ids = () => engine.commands().map((command) => command.id).filter((id) => id.startsWith("canvas.navigator."));
    expect(ids()).toEqual(["canvas.navigator.hide"]);
    const hide = engine.commands().find((command) => command.id === "canvas.navigator.hide")!;
    expect(hide.label).toBe("Nascondi il navigatore");
    expect(hide.path).toBe("Lavagna › Vista");
    navigator.focus();
    hide.run();
    expect(navigator.hidden).toBe(true);
    // Il fuoco torna alla lavagna.
    expect(document.activeElement).toBe(viewport);
    expect(ids()).toEqual(["canvas.navigator.show"]);
    engine.destroy();
    await Promise.resolve();
    expect(writes.at(-1)).toMatchObject({ navigator: false });

    // Riaperta, la lavagna lo ritrova spento; Mostra lo riaccende.
    const again = mounted(source(), { viewMemory: { read: async () => writes.at(-1), write: async () => {} } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    zoomIn(again.viewport);
    expect(again.navigator.hidden).toBe(true);
    again.engine.commands().find((command) => command.id === "canvas.navigator.show")!.run();
    expect(again.navigator.hidden).toBe(false);
  });

  it("F6 ci arriva dalla lavagna, e le frecce spostano il riquadro", () => {
    const { engine, host, navigator, viewport } = mounted();
    zoomIn(viewport);
    viewport.focus();
    expect(engine.zone(1)).toBe(true);
    expect(document.activeElement).toBe(navigator);
    const before = cameraOf(host);
    expect(key(navigator, { key: "ArrowRight" }).defaultPrevented).toBe(true);
    expect(cameraOf(host)).toEqual({ ...before, x: before.x - 800 * NAVIGATOR_KEY_STEP });
    key(navigator, { key: "ArrowUp" });
    expect(cameraOf(host).y).toBeCloseTo(before.y + 600 * NAVIGATOR_KEY_STEP);
    // Dopo il navigatore F6 esce dalla lavagna; indietro torna alla vista.
    expect(engine.zone(1)).toBe(false);
    expect(engine.zone(-1)).toBe(true);
    expect(document.activeElement).toBe(viewport);
    // Senza navigatore la vista è la sola zona.
    engine.commands().find((command) => command.id === "canvas.navigator.hide")!.run();
    expect(engine.zone(1)).toBe(false);
  });
});
