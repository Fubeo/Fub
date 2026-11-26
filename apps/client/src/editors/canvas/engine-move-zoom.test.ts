// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: spostare e ingrandire (T53), le pagine di un PDF (T72).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { CANVAS_ZOOM_STEP, CanvasEngine, EDGE_SCROLL_MAX, EDGE_SCROLL_ZONE, edgeScrollSpeed, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import { canvasCoreReady } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { CANVAS_TOOL_IDS, toolCommandId } from "./chrome/commands";
import { INERTIA_MS } from "../../spatial/camera";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { createCardRegistry } from "../core/cards/contract";
import { CardCache } from "./card-cache";
import { canvasSource, mounted, openField, press, readCanvas, type } from "./engine-test-support";

// Le impostazioni della lavagna (T35): il motore monta `watchPreferences`, e la
// prova tiene le sue funzioni per cambiare «La rotella del mouse» a lavagna
// aperta, come farebbe un cambio da Impostazioni. Il resto del modulo è quello vero.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("./preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preferences")>()),
  watchPreferences: (apply: (preferences: CanvasPreferences) => void) => {
    watched.appliers.push(apply);
    return () => {
      watched.appliers = watched.appliers.filter((other) => other !== apply);
    };
  },
}));

// Le notifiche della shell (T70, «Estrai in una nota»): la prova legge che
// cosa dicono e quale gesto offrono. Il resto del modulo è quello vero.
const notices = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../../ui/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/notify")>()),
  notify: notices.notify,
}));

// Il nucleo si carica una volta: dopo, la tela si apre subito.
beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

// --- muoversi (T53) --------------------------------------------------------------

describe("CanvasEngine: spostare e ingrandire (T53)", () => {
  /** I fotogrammi in attesa, che la prova fa girare a mano con un orologio suo. */
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let now = 0;

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    setReducedMotionPreference(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Fa girare `count` fotogrammi da `dt` ms (o finché ce ne sono). */
  function runFrames(count = 1, dt = 16): void {
    for (let i = 0; i < count && frames.size > 0; i++) {
      now += dt;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(now);
    }
  }

  /** Fa girare i fotogrammi finché la vista non si ferma (al più `limit`); dà quanti ne sono girati. */
  function settle(limit = 600): number {
    let count = 0;
    while (frames.size > 0 && count < limit) {
      runFrames(1);
      count++;
    }
    return count;
  }

  function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
    if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;

  /** La vista misura 800 × 600 a partire da (0, 0): happy-dom non dispone niente. */
  function sized(host: HTMLElement): void {
    vi.spyOn(viewportOf(host), "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
  }

  function key(target: EventTarget, init: KeyboardEventInit, type: "keydown" | "keyup" = "keydown"): KeyboardEvent {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  function pointer(target: EventTarget, type: string, init: PointerEventInit & { timeStamp?: number }): PointerEvent {
    const { timeStamp, ...rest } = init;
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 5, pointerType: "mouse", ...rest });
    if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
    target.dispatchEvent(event);
    return event;
  }

  /** Un trascinamento da `from` (premuto su `target`) a `to`, lasciato lì se `release`. */
  function drag(
    host: HTMLElement,
    target: EventTarget,
    from: { x: number; y: number },
    to: { x: number; y: number },
    init: PointerEventInit = {},
    release = true,
  ): void {
    pointer(target, "pointerdown", { clientX: from.x, clientY: from.y, ...init });
    pointer(viewportOf(host), "pointermove", { clientX: to.x, clientY: to.y, ...init });
    if (release) pointer(viewportOf(host), "pointerup", { clientX: to.x, clientY: to.y, ...init });
  }

  it("lo zoom va dal 5% al 400%; + e − a passi di 1,25, come nel disegno", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    viewport.focus();
    const start = cameraOf(host).zoom;
    key(viewport, { key: "+" });
    expect(cameraOf(host).zoom).toBeCloseTo(start * CANVAS_ZOOM_STEP, 9);
    key(viewport, { key: "-" });
    expect(cameraOf(host).zoom).toBeCloseTo(start, 9);
    for (let i = 0; i < 40; i++) key(viewport, { key: "+" });
    expect(cameraOf(host).zoom).toBe(4);
    for (let i = 0; i < 60; i++) key(viewport, { key: "-" });
    expect(cameraOf(host).zoom).toBe(0.05);
    // Il passo non vola: nessun fotogramma.
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("0 porta al 100% sul centro della vista, in volo; col movimento ridotto subito", () => {
    const { engine, host } = mounted();
    sized(host);
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    const center = { x: (400 - start.x) / start.zoom, y: (300 - start.y) / start.zoom };
    key(viewport, { key: "0", code: "Digit0" });
    // Il primo fotogramma non è ancora arrivato: la vista vola.
    expect(cameraOf(host)).toEqual(start);
    expect(frames.size).toBe(1);
    runFrames(1);
    const between = cameraOf(host).zoom;
    expect(between).toBeGreaterThan(start.zoom);
    expect(between).toBeLessThan(1);
    settle();
    const end = cameraOf(host);
    expect(end.zoom).toBeCloseTo(1, 6);
    expect((400 - end.x) / end.zoom).toBeCloseTo(center.x, 3);
    expect((300 - end.y) / end.zoom).toBeCloseTo(center.y, 3);
    expect(frames.size).toBe(0);
    // Col movimento ridotto: dopo + il salto arriva subito, senza fotogrammi.
    key(viewport, { key: "+" });
    setReducedMotionPreference(true);
    key(viewport, { key: "0", code: "Digit0" });
    expect(cameraOf(host).zoom).toBe(1);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("Maiusc+1 mostra tutto e Maiusc+2 la selezione, in volo; Maiusc+2 senza selezione non fa niente", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const all = cameraOf(host);
    key(viewport, { key: "+" });
    key(viewport, { key: "+" });
    const zoomed = cameraOf(host);
    key(viewport, { key: "@", code: "Digit2", shiftKey: true });
    expect(cameraOf(host)).toEqual(zoomed);
    expect(frames.size).toBe(0);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(cameraOf(host)).toEqual(zoomed);
    settle();
    const back = cameraOf(host);
    expect(back.zoom).toBeCloseTo(all.zoom, 6);
    expect(back.x).toBeCloseTo(all.x, 3);
    expect(back.y).toBeCloseTo(all.y, 3);
    // Una sola scheda scelta: Maiusc+2 la inquadra, al più al 100%.
    pointer(card(host, "t"), "pointerdown", { clientX: 10, clientY: 10 });
    pointer(viewport, "pointerup", { clientX: 10, clientY: 10 });
    key(viewport, { key: "@", code: "Digit2", shiftKey: true });
    expect(frames.size).toBe(1);
    settle();
    const one = cameraOf(host);
    expect(one.zoom).toBe(1);
    // La scheda `t` (40, 40, 240 × 140) sta al centro della vista di riserva, 800 × 600.
    expect(one.x + 160 * one.zoom).toBeCloseTo(400, 3);
    expect(one.y + 110 * one.zoom).toBeCloseTo(300, 3);
    // Col movimento ridotto il salto non vola.
    setReducedMotionPreference(true);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(frames.size).toBe(0);
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    engine.destroy();
  });

  it("Spazio tenuto e trascina sposta la vista con ogni strumento, anche sopra una scheda", () => {
    const { engine, host, changes } = mounted();
    const viewport = viewportOf(host);
    for (const tool of CANVAS_TOOL_IDS) {
      engine.commands().find((command) => command.id === toolCommandId(tool))!.run();
      viewport.focus();
      const down = key(viewport, { key: " " });
      expect(down.defaultPrevented, tool).toBe(true);
      expect(viewport.hasAttribute("data-space-pan"), tool).toBe(true);
      // La ripetizione del tasto tiene la mano, e la pagina non scorre.
      expect(key(viewport, { key: " ", repeat: true }).defaultPrevented).toBe(true);
      const before = cameraOf(host);
      const handle = card(host, "t").querySelector(".canvas-node-handle")!;
      drag(host, handle, { x: 100, y: 100 }, { x: 160, y: 130 });
      const after = cameraOf(host);
      expect(after.x - before.x, tool).toBeCloseTo(60, 6);
      expect(after.y - before.y, tool).toBeCloseTo(30, 6);
      key(window, { key: " " }, "keyup");
      expect(viewport.hasAttribute("data-space-pan")).toBe(false);
    }
    // Niente si è mosso nel file: si spostava la vista.
    expect(changes).toHaveLength(0);
    expect(nodeOf(engine, "t").x).toBe(40);
    // Spazio lasciato, la testata torna a spostare la scheda.
    engine.commands().find((command) => command.id === "canvas.tool.select")!.run();
    const handle = card(host, "t").querySelector(".canvas-node-handle")!;
    drag(host, handle, { x: 100, y: 100 }, { x: 160, y: 100 });
    expect(nodeOf(engine, "t").x).toBeGreaterThan(40);
    engine.destroy();
  });

  it("mentre si scrive in una scheda Spazio è uno spazio", () => {
    const { engine, host } = mounted();
    const input = openField(host, "t");
    const event = press(input, " ");
    expect(event.defaultPrevented).toBe(false);
    expect(viewportOf(host).hasAttribute("data-space-pan")).toBe(false);
    engine.destroy();
  });

  it("Spazio con la penna giù non prende la vista: la penna ha la precedenza", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const target = card(host, "t");
    const cam = cameraOf(host);
    const at = (x: number, y: number) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
    const pen = { pointerId: 9, pointerType: "pen", buttons: 1, pressure: 0.5 } as const;
    pointer(target, "pointerdown", { ...pen, ...at(80, 80), timeStamp: 1 });
    pointer(target, "pointermove", { ...pen, ...at(100, 90), timeStamp: 9 });
    viewport.focus();
    const down = key(viewport, { key: " " });
    expect(down.defaultPrevented).toBe(true);
    expect(viewport.hasAttribute("data-space-pan")).toBe(false);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, pointerType: "pen", ...at(100, 90) }));
    engine.destroy();
  });

  it("il tasto centrale trascina e sposta, anche sopra una scheda, senza sceglierla", () => {
    const { engine, host } = mounted();
    const before = cameraOf(host);
    drag(host, card(host, "f"), { x: 300, y: 100 }, { x: 250, y: 140 }, { button: 1, buttons: 4 });
    const after = cameraOf(host);
    expect(after.x - before.x).toBeCloseTo(-50, 6);
    expect(after.y - before.y).toBeCloseTo(40, 6);
    expect(card(host, "f").classList.contains("selected")).toBe(false);
    expect(engine.getDoc()).toBe(canvasSource());
    engine.destroy();
  });

  it("la velocità al bordo: zero fuori dalla fascia, più veloce più si è vicini, la massima sul bordo e fuori", () => {
    expect(edgeScrollSpeed(EDGE_SCROLL_ZONE, 500)).toBe(0);
    expect(edgeScrollSpeed(300, 300)).toBe(0);
    expect(edgeScrollSpeed(500, 30)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(500, 5)).toBeGreaterThan(edgeScrollSpeed(500, 30));
    expect(edgeScrollSpeed(500, 0)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollSpeed(500, -200)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollSpeed(10, 500)).toBeLessThan(0);
  });

  it("trascinando una scheda vicino al bordo la vista scorre e la scheda resta sotto il puntatore; il rilascio ferma tutto", () => {
    const { engine, host, changes } = mounted();
    sized(host);
    const start = cameraOf(host);
    const handle = card(host, "t").querySelector(".canvas-node-handle")!;
    // Lontano dal bordo niente scorre.
    drag(host, handle, { x: 100, y: 100 }, { x: 300, y: 300 }, {}, false);
    expect(frames.size).toBe(0);
    // A 5 px dal bordo destro: scorre.
    pointer(viewportOf(host), "pointermove", { clientX: 795, clientY: 300 });
    expect(frames.size).toBe(1);
    runFrames(1);
    const near = start.x - cameraOf(host).x;
    expect(near).toBeCloseTo(edgeScrollSpeed(795, 5) * 16, 6);
    expect(cameraOf(host).y).toBe(start.y);
    // Fuori dalla finestra: la velocità più alta.
    pointer(viewportOf(host), "pointermove", { clientX: 900, clientY: 300 });
    runFrames(1);
    expect(start.x - cameraOf(host).x - near).toBeCloseTo(EDGE_SCROLL_MAX * 16, 6);
    runFrames(10);
    const scrolled = start.x - cameraOf(host).x;
    pointer(viewportOf(host), "pointerup", { clientX: 900, clientY: 300 });
    expect(frames.size).toBe(0);
    runFrames(5);
    expect(start.x - cameraOf(host).x).toBe(scrolled);
    // La scheda è andata dove sta il puntatore sulla lavagna scorsa, in un passo.
    expect(changes).toHaveLength(1);
    const expected = 40 + (900 - 100 + scrolled) / start.zoom;
    expect(Math.abs(nodeOf(engine, "t").x - expected)).toBeLessThanOrEqual(4);
    engine.destroy();
  });

  it("lo scorrimento al bordo vale mentre si tira una maniglia o un filo, e si ferma con Esc e quando la finestra perde il fuoco", () => {
    const { engine, host } = mounted();
    sized(host);
    // La maniglia in basso a destra della scheda `t`, tirata verso il bordo in basso.
    pointer(card(host, "t"), "pointerdown", { clientX: 10, clientY: 10 });
    pointer(viewportOf(host), "pointerup", { clientX: 10, clientY: 10 });
    const grip = card(host, "t").querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!;
    const start = cameraOf(host);
    drag(host, grip, { x: 200, y: 200 }, { x: 400, y: 590 }, {}, false);
    expect(frames.size).toBe(1);
    runFrames(3);
    expect(cameraOf(host).y).toBeLessThan(start.y);
    // La finestra perde il fuoco: lo scorrimento si ferma.
    window.dispatchEvent(new Event("blur"));
    expect(frames.size).toBe(0);
    pointer(viewportOf(host), "pointerup", { clientX: 400, clientY: 590 });
    // Un filo con Alt dal corpo della scheda `f`, tirato verso il bordo sinistro.
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    const body = card(host, "f").querySelector<HTMLElement>(".canvas-card-body")!;
    const before = cameraOf(host);
    drag(host, body, { x: 500, y: 100 }, { x: 3, y: 300 }, { altKey: true, pointerId: 6 }, false);
    expect(frames.size).toBe(1);
    runFrames(2);
    expect(cameraOf(host).x).toBeGreaterThan(before.x);
    key(viewportOf(host), { key: "Escape" });
    runFrames(1);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("l'inerzia dopo uno spostamento col dito, con stepCamera; col movimento ridotto niente, anche cambiato a lavagna aperta", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    /** Un dito che scorre di 20 px ogni 10 ms verso destra, e si alza. */
    function swipe(pointerId: number, from: number): void {
      const finger = { pointerId, pointerType: "touch" };
      pointer(viewport, "pointerdown", { ...finger, clientX: from, clientY: 300, timeStamp: 0 });
      for (let i = 1; i <= 5; i++) pointer(viewport, "pointermove", { ...finger, clientX: from + 20 * i, clientY: 300, timeStamp: 10 * i });
      pointer(viewport, "pointerup", { ...finger, clientX: from + 100, clientY: 300, timeStamp: 50 });
    }
    const start = cameraOf(host);
    swipe(1, 100);
    const released = cameraOf(host);
    expect(released.x - start.x).toBeCloseTo(100, 6);
    expect(frames.size).toBe(1);
    const steps = settle();
    expect(steps).toBeGreaterThan(3);
    expect(frames.size).toBe(0);
    // Due px al ms per `INERTIA_MS`: la vista va avanti di circa 600 px.
    const glide = cameraOf(host).x - released.x;
    expect(glide).toBeGreaterThan(2 * INERTIA_MS * 0.9);
    expect(glide).toBeLessThan(2 * INERTIA_MS * 1.05);
    expect(cameraOf(host).y).toBeCloseTo(start.y, 6);
    // Un dito che si posa ferma l'inerzia.
    swipe(2, 100);
    runFrames(2);
    const caught = cameraOf(host);
    pointer(viewport, "pointerdown", { pointerId: 3, pointerType: "touch", clientX: 400, clientY: 300, timeStamp: 100 });
    expect(frames.size).toBe(0);
    expect(cameraOf(host)).toEqual(caught);
    pointer(viewport, "pointerup", { pointerId: 3, pointerType: "touch", clientX: 400, clientY: 300, timeStamp: 110 });
    // Il movimento ridotto cambiato a inerzia in corso la ferma subito.
    swipe(4, 100);
    expect(frames.size).toBe(1);
    setReducedMotionPreference(true);
    expect(frames.size).toBe(0);
    // E dopo, niente inerzia.
    swipe(5, 100);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("chiudere la lavagna ferma il volo", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    key(viewport, { key: "+" });
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(frames.size).toBe(1);
    engine.destroy();
    expect(frames.size).toBe(0);
  });

  // --- indietro e avanti (T56) ---

  it("Indietro e Avanti rifanno i salti (Maiusc+1), non lo zoom a passi", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const all = cameraOf(host);
    key(viewport, { key: "+" });
    const zoomed = cameraOf(host);
    // Lo zoom a passi non è un salto: la storia è ancora vuota.
    expect(engine.jumpBack()).toBe(false);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(engine.jumpBack()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(zoomed.zoom, 6);
    expect(cameraOf(host).x).toBeCloseTo(zoomed.x, 3);
    expect(cameraOf(host).y).toBeCloseTo(zoomed.y, 3);
    // Niente prima del salto: Indietro ora dice di no, e la cronologia del riquadro entra.
    expect(engine.jumpBack()).toBe(false);
    expect(engine.jumpForward()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(engine.jumpForward()).toBe(false);
    engine.destroy();
  });

  it("un clic nel navigatore è un salto, uno spostamento a mano no: Indietro torna prima del salto", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const navigator = host.querySelector<HTMLElement>(".canvas-navigator")!;
    // La mappa misura 168 × 120 da (0, 0): happy-dom non dispone niente.
    vi.spyOn(navigator, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 168, bottom: 120, width: 168, height: 120, toJSON: () => ({}),
    } as DOMRect);
    for (let i = 0; i < 4; i++) key(viewport, { key: "+" });
    settle();
    const zoomed = cameraOf(host);
    // Il clic sulla mappa vola: è un salto.
    const tap = (type: string): void => {
      navigator.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse", isPrimary: true, clientX: 150, clientY: 100,
      }));
    };
    tap("pointerdown");
    tap("pointerup");
    expect(frames.size).toBe(1);
    settle();
    const jumped = cameraOf(host);
    expect(jumped).not.toEqual(zoomed);
    // Lo spostamento a mano (il tasto centrale) non entra nella storia.
    drag(host, viewport, { x: 300, y: 300 }, { x: 350, y: 330 }, { button: 1, buttons: 4 });
    expect(cameraOf(host)).not.toEqual(jumped);
    // Indietro torna prima del salto, non al punto dove la mano ha lasciato la vista.
    expect(engine.jumpBack()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(zoomed.zoom, 6);
    expect(cameraOf(host).x).toBeCloseTo(zoomed.x, 3);
    expect(cameraOf(host).y).toBeCloseTo(zoomed.y, 3);
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("il salto dell'ispettore (`revealSource` «jump») entra in Indietro; quello della shell no; lo spostamento a mano non conta", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const doc = engine.getDoc();
    const byteOf = (id: string) => new TextEncoder().encode(doc.slice(0, doc.indexOf(`{"id":"${id}"`))).length;
    // Dalla shell (o all'apertura) la vista si mette sulla scheda, senza storia.
    expect(engine.revealSource(byteOf("t"))).toBe(true);
    expect(frames.size).toBe(0);
    expect(engine.jumpBack()).toBe(false);
    const framed = cameraOf(host);
    // Dall'ispettore è un salto: vola, e Indietro torna da dove si era.
    expect(engine.revealSource(byteOf("w"), "jump")).toBe(true);
    expect(frames.size).toBe(1);
    settle();
    expect(engine.selection().nodes).toEqual(["w"]);
    const jumped = cameraOf(host);
    expect(jumped).not.toEqual(framed);
    // Uno spostamento a mano dopo il salto non entra nella storia.
    drag(host, viewport, { x: 300, y: 300 }, { x: 350, y: 330 }, { button: 1, buttons: 4 });
    expect(cameraOf(host)).not.toEqual(jumped);
    expect(engine.jumpBack()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(framed.zoom, 6);
    expect(cameraOf(host).x).toBeCloseTo(framed.x, 3);
    expect(cameraOf(host).y).toBeCloseTo(framed.y, 3);
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("col movimento ridotto Indietro e Avanti arrivano subito, senza volo", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const all = cameraOf(host);
    key(viewport, { key: "+" });
    const zoomed = cameraOf(host);
    setReducedMotionPreference(true);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(engine.jumpBack()).toBe(true);
    expect(cameraOf(host)).toEqual(zoomed);
    expect(engine.jumpForward()).toBe(true);
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("una lavagna aperta ricomincia senza salti, e due lavagne hanno ciascuna la sua storia", () => {
    const first = mounted();
    const viewportFirst = viewportOf(first.host);
    key(viewportFirst, { key: "+" });
    key(viewportFirst, { key: "!", code: "Digit1", shiftKey: true });
    settle();
    const second = mounted();
    expect(second.engine.jumpBack()).toBe(false);
    expect(first.engine.jumpBack()).toBe(true);
    first.engine.destroy();
    second.engine.destroy();
  });

  it("a fine volo la banda di stato è avvisata, perché lo zoom è cambiato", () => {
    let statusChanges = 0;
    const { engine, host } = mounted(canvasSource(), {
      onStatusChange: () => {
        statusChanges++;
      },
    });
    const viewport = viewportOf(host);
    key(viewport, { key: "+" });
    const before = statusChanges;
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    // Durante il volo la banda aspetta, come in ogni gesto.
    expect(statusChanges).toBe(before);
    settle();
    expect(statusChanges).toBeGreaterThan(before);
    engine.destroy();
  });
});

describe("CanvasEngine: spargi le pagine di un PDF (T72)", () => {
  /** Un PDF a sinistra (`p`), una nota più in basso (`t`). */
  const pdfBoard = () => JSON.stringify({
    nodes: [
      { id: "p", type: "file", x: 0, y: 0, width: 360, height: 480, file: "docs/manuale.pdf" },
      { id: "t", type: "text", x: 0, y: 600, width: 240, height: 140, text: "nota" },
    ],
    edges: [],
  });

  /** Il lettore delle pagine finto: `count` pagine (`null`: il PDF non si apre), misura 612×792. */
  function pdfPages(count: number | null) {
    return {
      count: vi.fn(async (_path: string) => count),
      sizes: vi.fn(async (_path: string, wanted: readonly number[]) => wanted.map(() => ({ width: 612, height: 792 }))),
    };
  }

  function open(count: number | null = 24, overrides: Partial<CanvasEngineOptions> = {}) {
    const pages = pdfPages(count);
    const watches: Array<{ path: string; changed: () => void; stop: ReturnType<typeof vi.fn> }> = [];
    const made = mounted(pdfBoard(), {
      cards: {
        registry: createCardRegistry([]),
        snapshots: new CardCache(),
        watch: (path, changed) => {
          const stop = vi.fn();
          watches.push({ path, changed, stop });
          return stop;
        },
        pdfPages: pages,
      },
      ...overrides,
    });
    return { ...made, pages, watches };
  }

  /** Sceglie la scheda `id` col tasto destro, come il gesto. */
  function choose(engine: CanvasEngine, host: HTMLElement, id = "p") {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`));
    try {
      return engine.contextMenu({ x: 10, y: 10 });
    } finally {
      pointing.mockRestore();
    }
  }

  function spreadCommand(engine: CanvasEngine) {
    return engine.commands().find((command) => command.id === "canvas.spread_pages")!;
  }

  function spread(engine: CanvasEngine): void {
    spreadCommand(engine).run();
  }

  /** Il dialogo aperto per ultimo. */
  function dialog(): HTMLElement {
    const all = document.querySelectorAll<HTMLElement>(".kit-dialog");
    return all[all.length - 1]!;
  }

  function dialogField(): HTMLInputElement {
    return dialog().querySelector<HTMLInputElement>(".kit-field-input")!;
  }

  function dialogNote(): string {
    return dialog().querySelector(".kit-dialog-body p")?.textContent ?? "";
  }

  function answer(action: "spread" | "cancel"): void {
    dialog().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  }

  /** Le schede nate dalle pagine (quelle con `subpath`, senza il gruppo). */
  function placed(engine: CanvasEngine) {
    return readCanvas(engine.getDoc()).nodes.filter((node) => node.subpath !== undefined);
  }

  it("chiede le pagine (di serie tutte) e mette una scheda per pagina accanto al PDF, con un gruppo oltre 12", async () => {
    const { engine, host, pages } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(24));
    expect(pages.count).toHaveBeenCalledWith("docs/manuale.pdf");
    expect(pages.sizes).toHaveBeenCalledWith("docs/manuale.pdf", Array.from({ length: 24 }, (_, index) => index + 1));
    const cards = placed(engine);
    expect(cards.map((node) => node.subpath)).toEqual(Array.from({ length: 24 }, (_, index) => `#page=${index + 1}`));
    expect(cards.every((node) => node.type === "file" && node.file === "docs/manuale.pdf")).toBe(true);
    // Le misure di nascita del PDF (T29): 360 di larghezza, l'altezza segue la pagina; in riga dopo il PDF.
    expect(cards[0]).toMatchObject({ x: 384, y: 0, width: 360, height: 466 });
    expect(cards[10]).toMatchObject({ x: 384, y: 496 });
    const group = readCanvas(engine.getDoc()).nodes.find((node) => node.type === "group");
    expect(group?.label).toBe(t("canvas.spread.group", { count: "24" }));
    engine.destroy();
  });

  it("un intervallo fa nascere solo le sue pagine, e sotto le 13 niente gruppo", async () => {
    const { engine, host } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    type(dialogField(), "3-7, 9");
    expect(dialogNote()).toBe(t("canvas.spread.count", { n: "6" }));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(6));
    expect(placed(engine).map((node) => node.subpath)).toEqual(["#page=3", "#page=4", "#page=5", "#page=6", "#page=7", "#page=9"]);
    expect(readCanvas(engine.getDoc()).nodes.some((node) => node.type === "group")).toBe(false);
    engine.destroy();
  });

  it("un intervallo oltre l'ultima pagina si taglia e si dice", async () => {
    const { engine, host } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    type(dialogField(), "20-40");
    expect(dialogNote()).toBe(t("canvas.spread.cut", { pages: "24", n: "5" }));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(5));
    expect(placed(engine).map((node) => node.subpath)).toEqual(["#page=20", "#page=21", "#page=22", "#page=23", "#page=24"]);
    engine.destroy();
  });

  it("un testo che non si legge non chiude il dialogo, e Annulla non tocca la lavagna", async () => {
    const { engine, host, changes } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    type(dialogField(), "3-x");
    expect(dialogNote()).toBe(t("canvas.spread.bad", { text: "3-x" }));
    answer("spread");
    expect(document.querySelectorAll(".kit-dialog")).toHaveLength(1);
    expect(placed(engine)).toHaveLength(0);
    answer("cancel");
    expect(placed(engine)).toHaveLength(0);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("più di 200 schede chiede conferma: Annulla non fa nulla, Spargi le fa nascere", async () => {
    const { engine, host } = open(201);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-201"));
    answer("spread");
    await vi.waitFor(() => expect(dialog().querySelector(".kit-dialog-title")?.textContent).toBe(t("canvas.spread.confirm.title", { n: "201" })));
    answer("cancel");
    expect(placed(engine)).toHaveLength(0);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-201"));
    answer("spread");
    await vi.waitFor(() => expect(dialog().querySelector(".kit-dialog-title")?.textContent).toBe(t("canvas.spread.confirm.title", { n: "201" })));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(201));
    engine.destroy();
  }, 20_000);

  it("tutte le schede nate da «Spargi» tornano con un solo annulla", async () => {
    const { engine, host } = open(24);
    const before = readCanvas(engine.getDoc()).nodes.map((node) => node.id);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(24));
    engine.undo();
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.id)).toEqual(before);
    engine.destroy();
  });

  it("un PDF che non si apre lo dice, e la voce resta spenta finché il file non cambia", async () => {
    const { engine, host, watches } = open(null);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toContain(t("canvas.card.unreadable", { name: "manuale.pdf" })));
    expect(document.querySelector(".kit-dialog")).toBeNull();
    expect(spreadCommand(engine).disabled()).toBe(t("canvas.commands.why.pdf_unreadable"));
    expect(watches.map((watch) => watch.path)).toEqual(["docs/manuale.pdf"]);
    // Il file cambia: il comando torna acceso, e il suo ascolto si scioglie.
    watches[0]!.changed();
    expect(spreadCommand(engine).disabled()).toBeNull();
    expect(watches[0]!.stop).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("in sola lettura la voce è spenta col perché, e non apre niente", () => {
    const { engine, host, pages } = open(24);
    choose(engine, host);
    engine.setReadOnly(true);
    expect(spreadCommand(engine).disabled()).toBe(t("canvas.commands.why.read_only"));
    spread(engine);
    expect(pages.count).not.toHaveBeenCalled();
    expect(document.querySelector(".kit-dialog")).toBeNull();
    engine.destroy();
  });

  it("il menu del PDF ha «Spargi le pagine…» dopo «Apri a lato»; una nota non ce l'ha, e senza lettore è spenta", () => {
    const { engine, host } = open(24, { onOpenPathBeside: () => {} });
    const idsOf = (menu: ReturnType<CanvasEngine["contextMenu"]>) => (menu?.context ?? [])
      .filter((entry): entry is SurfaceMenuItem => typeof entry !== "string")
      .map((item) => item.id);
    expect(idsOf(choose(engine, host)).slice(0, 4)).toEqual(["canvas.open", "canvas.open_beside", "canvas.spread_pages", "canvas.connect"]);
    expect(idsOf(choose(engine, host, "t"))).not.toContain("canvas.spread_pages");
    expect(spreadCommand(engine).disabled()).toBe(t("canvas.commands.why.no_pdf"));
    engine.destroy();
    const bare = mounted(pdfBoard());
    choose(bare.engine, bare.host);
    expect(spreadCommand(bare.engine).disabled()).toBe(t("canvas.commands.why.no_pdf_reader"));
    bare.engine.destroy();
  });
});
