// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PF1_DEFAULTS } from "../../ink/brush";
import { PenQuiet } from "../../ink/quiet";
import type { InkSample } from "../../ink/sample";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mountInkLayer, type InkLayer, type InkLayerOptions, type InkLayerStroke } from "./ink-layer";

type Init = PointerEventInit & { readonly timeStamp?: number };

/// Un `PointerEvent` sintetico, come nei test di `ink/dom/pointer-adapter`.
function pointerEvent(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: type !== "pointerleave",
    cancelable: true,
    composed: true,
    isPrimary: true,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    ...rest,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

const PEN = { pointerId: 7, pointerType: "pen" } as const;
const PEN2 = { pointerId: 8, pointerType: "pen" } as const;
const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

const down = (init: Init) => pointerEvent("pointerdown", { button: 0, buttons: 1, pressure: 0.5, ...init });
const move = (init: Init) => pointerEvent("pointermove", { button: -1, buttons: 1, pressure: 0.5, ...init });
const up = (init: Init) => pointerEvent("pointerup", { button: 0, buttons: 0, pressure: 0, ...init });
const click = (type: "click" | "dblclick", detail: number) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, detail });

describe("lo strato d'inchiostro della lavagna", () => {
  let owner: Lifetime;
  let viewport: HTMLElement;
  let card: HTMLElement;
  let quiet: PenQuiet;
  let runs: Array<() => void>;
  let strokes: InkLayerStroke[];
  let board: string[];

  beforeEach(() => {
    owner = openLifetime();
    viewport = document.createElement("div");
    viewport.className = "canvas-viewport";
    const stage = document.createElement("div");
    stage.className = "canvas-stage";
    card = document.createElement("div");
    card.className = "canvas-node";
    stage.append(card);
    viewport.append(stage);
    document.body.append(viewport);
    runs = [];
    quiet = new PenQuiet((run) => {
      runs.push(run);
      return () => {};
    });
    strokes = [];
    board = [];
    // Gli ascoltatori della lavagna: in bolla sul viewport, come in `engine.ts`.
    for (const type of ["pointerdown", "click", "dblclick"]) {
      viewport.addEventListener(type, (event) => board.push(`${type}:${(event as PointerEvent).pointerType ?? ""}`));
    }
  });

  afterEach(() => {
    owner.close();
    viewport.remove();
  });

  function mount(options: Partial<InkLayerOptions> = {}): InkLayer {
    return mountInkLayer({
      viewport,
      // La camera finta: la lavagna è spostata di 100 e a scala 2.
      toWorld: (x, y) => ({ x: (x - 100) / 2, y: (y - 100) / 2 }),
      look: (input) => ({ brush: { ...PF1_DEFAULTS, sim: !input.pressure }, color: "#0072b2", tool: "pen" }),
      quiet,
      onStroke: (stroke) => strokes.push(stroke),
      ...options,
    }, owner);
  }

  const wet = (): SVGSVGElement => viewport.querySelector<SVGSVGElement>("svg.canvas-ink-wet")!;
  const trails = (): SVGPathElement[] => [...wet().querySelectorAll("path")];

  function scribble(target: EventTarget, pen: typeof PEN = PEN, at = 0): void {
    target.dispatchEvent(down({ ...pen, clientX: 120, clientY: 140, timeStamp: at }));
    target.dispatchEvent(move({ ...pen, clientX: 130, clientY: 150, timeStamp: at + 8 }));
    target.dispatchEvent(move({ ...pen, clientX: 140, clientY: 156, timeStamp: at + 16 }));
  }

  it("la penna sul viewport fa la scia e consegna i campioni della lavagna; la lavagna non vede niente", () => {
    const layer = mount();
    scribble(viewport);
    expect(trails()).toHaveLength(1);
    expect(trails()[0]!.getAttribute("d")).toMatch(/^M/);
    expect(trails()[0]!.getAttribute("fill")).toBe("#0072b2");
    expect(quiet.active).toBe(true);
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 20 }));
    viewport.dispatchEvent(click("click", 1));
    viewport.dispatchEvent(click("dblclick", 2));

    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    expect(stroke.samples.map((s: InkSample) => [s.x, s.y])).toEqual([[10, 20], [15, 25], [20, 28]]);
    expect(stroke).toMatchObject({ id: 1, color: "#0072b2", tool: "pen", role: "ink", split: false });
    expect(stroke.brush).toMatchObject({ sim: false });
    expect(board).toEqual([]);
    expect(quiet.active).toBe(false);
    // La scia resta fino a `settle`.
    expect(trails()).toHaveLength(1);
    layer.settle(1);
    expect(trails()).toHaveLength(0);
  });

  it("la penna su una scheda si ferma prima della scheda e della lavagna, anche sulla testata e su un campo in modifica", () => {
    mount();
    const handle = document.createElement("div");
    handle.className = "canvas-node-handle";
    const connect = document.createElement("button");
    connect.dataset.connect = "right";
    const field = document.createElement("textarea");
    field.value = "testo";
    card.append(handle, connect, field);
    field.focus();
    const reached: string[] = [];
    for (const element of [card, handle, connect, field]) {
      element.addEventListener("pointerdown", () => reached.push(element.localName));
      element.addEventListener("dblclick", () => reached.push(`dbl:${element.localName}`));
    }
    let t = 0;
    for (const target of [card, handle, connect, field]) {
      const event = down({ ...PEN, clientX: 120, clientY: 140, timeStamp: t });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      document.dispatchEvent(up({ ...PEN, clientX: 120, clientY: 140, timeStamp: t + 5 }));
      target.dispatchEvent(click("dblclick", 2));
      t += 100;
    }
    expect(reached).toEqual([]);
    expect(board).toEqual([]);
    expect(strokes).toHaveLength(4);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("testo");
  });

  it("il mouse passa alla lavagna e non fa scia", () => {
    mount();
    const event = down({ ...MOUSE, clientX: 120, clientY: 140 });
    viewport.dispatchEvent(event);
    viewport.dispatchEvent(move({ ...MOUSE, clientX: 130, clientY: 150 }));
    document.dispatchEvent(up({ ...MOUSE, clientX: 130, clientY: 150 }));
    viewport.dispatchEvent(click("click", 1));
    viewport.dispatchEvent(click("dblclick", 2));
    expect(event.defaultPrevented).toBe(false);
    expect(board).toEqual(["pointerdown:mouse", "click:", "dblclick:"]);
    expect(trails()).toHaveLength(0);
    expect(strokes).toEqual([]);
    expect(quiet.active).toBe(false);
  });

  it("dopo un tratto il click della tastiera passa, e il mouse che segue riapre i click", () => {
    mount();
    scribble(viewport);
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 20 }));
    viewport.dispatchEvent(click("click", 0));
    expect(board).toEqual(["click:"]);
    viewport.dispatchEvent(down({ ...MOUSE, clientX: 120, clientY: 140 }));
    document.dispatchEvent(up({ ...MOUSE, clientX: 120, clientY: 140 }));
    viewport.dispatchEvent(click("click", 1));
    expect(board).toEqual(["click:", "pointerdown:mouse", "click:"]);
  });

  it("un tratto annullato toglie la scia e lascia il silenzio una volta", () => {
    const cancelled: Array<[number, string]> = [];
    const leave = vi.spyOn(quiet, "leave");
    const layer = mount({ onCancel: (id, reason) => cancelled.push([id, reason]) });
    for (const [i, interrupt] of ([
      ["pointercancel", () => document.dispatchEvent(pointerEvent("pointercancel", { ...PEN }))],
      ["hidden", () => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      }],
      ["api", () => layer.cancel()],
    ] as const).entries()) {
      scribble(viewport, PEN, i * 100);
      expect(trails()).toHaveLength(1);
      interrupt[1]();
      expect(trails()).toHaveLength(0);
      expect(cancelled[i]).toEqual([i + 1, interrupt[0]]);
      expect(leave).toHaveBeenCalledTimes(i + 1);
      document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: i * 100 + 30 }));
      expect(leave).toHaveBeenCalledTimes(i + 1);
    }
    expect(strokes).toEqual([]);
    expect(quiet.active).toBe(false);
  });

  it("il palmo: il dito che diventa palmo non lascia scia (il dito naviga, la penna scrive)", () => {
    mount();
    viewport.dispatchEvent(down({ pointerId: 20, pointerType: "touch", clientX: 120, clientY: 140 }));
    expect(board).toEqual(["pointerdown:touch"]);
    scribble(viewport);
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 20 }));
    document.dispatchEvent(up({ pointerId: 20, pointerType: "touch", clientX: 120, clientY: 140 }));
    expect(strokes).toHaveLength(1);
    expect(board).toEqual(["pointerdown:touch"]);
  });

  it("due penne insieme: la sessione fa un tratto alla volta, la seconda penna non arriva alla lavagna", () => {
    const layer = mount();
    scribble(viewport, PEN, 0);
    const second = down({ ...PEN2, clientX: 160, clientY: 160, timeStamp: 2 });
    card.dispatchEvent(second);
    card.dispatchEvent(move({ ...PEN2, clientX: 170, clientY: 170, timeStamp: 10 }));
    expect(second.defaultPrevented).toBe(true);
    expect(trails()).toHaveLength(1);
    document.dispatchEvent(up({ ...PEN2, clientX: 170, clientY: 170, timeStamp: 30 }));
    expect(quiet.active).toBe(true);
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 30 }));
    expect(quiet.active).toBe(false);
    expect(strokes.map((s) => s.id)).toEqual([1]);
    expect(board).toEqual([]);
    layer.settle(1);
    expect(trails()).toHaveLength(0);
  });

  it("settle dentro onStroke toglie la scia nello stesso giro; un tratto aperto la tiene", () => {
    let layer: InkLayer | null = null;
    layer = mount({ onStroke: (stroke) => layer!.settle(stroke.id) });
    scribble(viewport);
    layer.settle(1);
    expect(trails()).toHaveLength(1);
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 20 }));
    expect(trails()).toHaveLength(0);
  });

  it("setCamera durante un tratto sposta la scia e non i campioni", () => {
    const layer = mount();
    layer.setCamera(100, 100, 2);
    expect(wet().style.transform).toBe("translate(100px, 100px) scale(2)");
    scribble(viewport);
    const before = trails()[0]!.getAttribute("d");
    layer.setCamera(-30, 5, 0.5);
    expect(wet().style.transform).toBe("translate(-30px, 5px) scale(0.5)");
    expect(trails()[0]!.getAttribute("d")).toBe(before);
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 20 }));
    expect(strokes[0]!.samples.map((s) => [s.x, s.y])).toEqual([[10, 20], [15, 25], [20, 28]]);
  });

  it("la gomma della penna: niente scia, i punti a onErase, la fine a onEraseEnd", () => {
    const erased: Array<[number, number[][]]> = [];
    const ended: number[] = [];
    mount({
      onErase: (id, points) => erased.push([id, points.map((p) => [p.x, p.y])]),
      onEraseEnd: (id) => ended.push(id),
    });
    const event = down({ ...PEN, button: 5, buttons: 32, clientX: 120, clientY: 140, timeStamp: 0 });
    viewport.dispatchEvent(event);
    viewport.dispatchEvent(move({ ...PEN, buttons: 32, clientX: 130, clientY: 150, timeStamp: 8 }));
    expect(event.defaultPrevented).toBe(true);
    expect(trails()).toHaveLength(0);
    expect(quiet.active).toBe(true);
    document.dispatchEvent(up({ ...PEN, button: 5, buttons: 0, clientX: 130, clientY: 150, timeStamp: 12 }));
    expect(erased).toEqual([[1, [[10, 20]]], [1, [[15, 25]]]]);
    expect(ended).toEqual([1]);
    expect(strokes).toEqual([]);
    expect(board).toEqual([]);
    expect(quiet.active).toBe(false);
  });

  it("la gomma dice prima chi la fa: onEraseStart col tipo del puntatore, anche col tasto laterale", () => {
    const started: Array<[number, string]> = [];
    const order: string[] = [];
    mount({
      onEraseStart: (id, pointerType) => {
        started.push([id, pointerType]);
        order.push("start");
      },
      onErase: () => order.push("erase"),
      onEraseEnd: () => order.push("end"),
    });
    viewport.dispatchEvent(down({ ...PEN, button: 2, buttons: 2, clientX: 120, clientY: 140, timeStamp: 0 }));
    viewport.dispatchEvent(move({ ...PEN, buttons: 2, clientX: 130, clientY: 150, timeStamp: 8 }));
    document.dispatchEvent(up({ ...PEN, button: 2, buttons: 0, clientX: 130, clientY: 150, timeStamp: 12 }));
    expect(started).toEqual([[1, "pen"]]);
    expect(order[0]).toBe("start");
    expect(order[order.length - 1]).toBe("end");
    expect(strokes).toEqual([]);
    expect(board).toEqual([]);
  });

  it("setMouse: il mouse scrive dal prossimo appoggio, e torna alla lavagna; un tratto già giù finisce", () => {
    const layer = mount();
    layer.setMouse("ink");
    const event = down({ ...MOUSE, clientX: 120, clientY: 140, timeStamp: 0 });
    viewport.dispatchEvent(event);
    viewport.dispatchEvent(move({ ...MOUSE, clientX: 130, clientY: 150, timeStamp: 8 }));
    // Il mouse torna alla lavagna a metà tratto: il tratto finisce com'è.
    layer.setMouse("ignore");
    viewport.dispatchEvent(move({ ...MOUSE, clientX: 140, clientY: 156, timeStamp: 16 }));
    document.dispatchEvent(up({ ...MOUSE, clientX: 140, clientY: 156, timeStamp: 20 }));
    expect(event.defaultPrevented).toBe(true);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.pointerType).toBe("mouse");
    expect(board).toEqual([]);

    viewport.dispatchEvent(down({ ...MOUSE, clientX: 120, clientY: 140, timeStamp: 40 }));
    document.dispatchEvent(up({ ...MOUSE, clientX: 120, clientY: 140, timeStamp: 44 }));
    expect(strokes).toHaveLength(1);
    expect(board).toEqual(["pointerdown:mouse"]);
  });

  it("il silenzio rimanda il lavoro finché la penna è giù", () => {
    mount();
    scribble(viewport);
    const work = vi.fn();
    quiet.defer("render", work);
    expect(work).not.toHaveBeenCalled();
    document.dispatchEvent(up({ ...PEN, clientX: 140, clientY: 156, timeStamp: 20 }));
    expect(runs).toHaveLength(1);
    runs[0]!();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("la chiusura del padrone annulla il tratto, toglie la scia e gli ascoltatori", () => {
    const cancelled: string[] = [];
    mount({ onCancel: (_id, reason) => cancelled.push(reason) });
    scribble(viewport);
    owner.close();
    expect(cancelled).toEqual(["destroy"]);
    expect(quiet.active).toBe(false);
    expect(viewport.querySelector(".canvas-ink-wet")).toBeNull();
    viewport.dispatchEvent(down({ ...PEN, clientX: 120, clientY: 140, timeStamp: 50 }));
    expect(board).toEqual(["pointerdown:pen"]);
  });
});
