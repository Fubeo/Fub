// @vitest-environment happy-dom
// Il dito sulla lavagna (N4 T14): un dito sposta la vista, anche sopra le
// schede; due dita pizzicano; la testata sposta la scheda; un tocco breve
// sceglie; la penna vince. Con «Il dito sposta le schede» accesa, il dito
// sopra una scheda la sposta.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CanvasEngine, type CanvasChange } from "./engine";
import { canvasCoreReady } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
});

type Init = PointerEventInit & { readonly timeStamp?: number };

function pointerEvent(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    ...rest,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

function mounted(options: { moves?: () => boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const settings = { moves: false };
  const engine = new CanvasEngine(host, {
    surfaceId: "touch",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    fingerMovesCard: options.moves ?? (() => settings.moves),
  });
  engine.setDoc(BOARD);
  return { engine, host, changes, settings };
}

function camera(host: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
const body = (host: HTMLElement, id: string) => card(host, id).querySelector<HTMLElement>(".canvas-node-body") ?? card(host, id);
const handle = (host: HTMLElement, id: string) => card(host, id).querySelector<HTMLElement>(".canvas-node-handle")!;
const selected = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((el) => el.dataset.node);

let clock = 1000;

/** Un dito finto: giù su `target`, poi si muove e si alza sul viewport. */
function finger(host: HTMLElement, pointerId: number, target: Element, x: number, y: number) {
  const viewport = viewportOf(host);
  const base = { pointerId, pointerType: "touch", isPrimary: false, width: 10, height: 10 } as const;
  target.dispatchEvent(pointerEvent("pointerdown", { ...base, clientX: x, clientY: y, button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
  return {
    move(nx: number, ny: number) {
      clock += 16;
      viewport.dispatchEvent(pointerEvent("pointermove", { ...base, clientX: nx, clientY: ny, button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
    },
    up(nx: number, ny: number) {
      clock += 16;
      viewport.dispatchEvent(pointerEvent("pointerup", { ...base, clientX: nx, clientY: ny, button: 0, buttons: 0, pressure: 0, timeStamp: clock }));
    },
    cancel() {
      viewport.dispatchEvent(pointerEvent("pointercancel", { ...base, timeStamp: clock }));
    },
  };
}

/** Il punto del client sopra il punto `(x, y)` della lavagna. */
function screen(host: HTMLElement, x: number, y: number): [number, number] {
  const cam = camera(host);
  return [x * cam.zoom + cam.x, y * cam.zoom + cam.y];
}

function nodeX(engine: CanvasEngine, id: string): number {
  const doc = JSON.parse(engine.getDoc()) as { nodes: { id: string; x: number }[] };
  return doc.nodes.find((node) => node.id === id)!.x;
}

describe("il dito sposta e ingrandisce la lavagna", () => {
  for (const moves of [false, true]) {
    describe(`con «Il dito sposta le schede» ${moves ? "accesa" : "spenta"}`, () => {
      it("un dito sul vuoto sposta la vista, e nient'altro", () => {
        const { host, changes } = mounted({ moves: () => moves });
        const before = camera(host);
        const [x, y] = screen(host, 300, 300);
        const one = finger(host, 1, viewportOf(host), x, y);
        one.move(x + 30, y + 10);
        one.move(x + 60, y + 25);
        one.up(x + 60, y + 25);
        const after = camera(host);
        expect(after.x).toBeCloseTo(before.x + 60);
        expect(after.y).toBeCloseTo(before.y + 25);
        expect(after.zoom).toBe(before.zoom);
        expect(changes).toEqual([]);
      });

      it("due dita pizzicano attorno al loro centro, e quando una si alza l'altra sposta", () => {
        const { host, changes } = mounted({ moves: () => moves });
        const before = camera(host);
        const [cx, cy] = screen(host, 300, 300);
        const one = finger(host, 1, viewportOf(host), cx - 50, cy);
        one.move(cx - 50, cy);
        const two = finger(host, 2, viewportOf(host), cx + 50, cy);
        one.move(cx - 100, cy);
        two.move(cx + 100, cy);
        const pinched = camera(host);
        expect(pinched.zoom).toBeCloseTo(Math.min(4, before.zoom * 2));
        // Il punto (300, 300) della lavagna resta sotto il centro delle dita.
        expect((cx - pinched.x) / pinched.zoom).toBeCloseTo(300);
        expect((cy - pinched.y) / pinched.zoom).toBeCloseTo(300);
        // Un dito si alza a metà pizzico: l'altro sposta la vista, senza zoom.
        two.up(cx + 100, cy);
        one.move(cx - 60, cy + 20);
        const panned = camera(host);
        expect(panned.zoom).toBe(pinched.zoom);
        expect(panned.x).toBeCloseTo(pinched.x + 40);
        expect(panned.y).toBeCloseTo(pinched.y + 20);
        one.up(cx - 60, cy + 20);
        expect(changes).toEqual([]);
      });

      it("il pizzico si ferma al limite dello zoom", () => {
        const { host } = mounted({ moves: () => moves });
        const [cx, cy] = screen(host, 300, 300);
        const one = finger(host, 1, viewportOf(host), cx - 2, cy);
        const two = finger(host, 2, viewportOf(host), cx + 2, cy);
        one.move(cx - 400, cy);
        two.move(cx + 400, cy);
        expect(camera(host).zoom).toBe(4);
        one.up(cx - 400, cy);
        two.up(cx + 400, cy);
        const three = finger(host, 3, viewportOf(host), cx - 400, cy);
        const four = finger(host, 4, viewportOf(host), cx + 400, cy);
        three.move(cx, cy);
        four.move(cx + 1, cy);
        expect(camera(host).zoom).toBe(0.1);
      });

      it("la testata sposta la scheda, in un passo d'annulla", () => {
        const { engine, host, changes } = mounted({ moves: () => moves });
        const before = camera(host);
        const [x, y] = screen(host, 20, 5);
        const one = finger(host, 1, handle(host, "a"), x, y);
        one.move(x + 40 * before.zoom, y);
        one.move(x + 80 * before.zoom, y);
        one.up(x + 80 * before.zoom, y);
        expect(camera(host)).toEqual(before);
        expect(changes).toHaveLength(1);
        expect(nodeX(engine, "a")).toBeGreaterThan(40);
        expect(engine.undo()).toBe(true);
        expect(nodeX(engine, "a")).toBe(0);
      });

      it("un tocco breve sceglie la scheda, e sul vuoto toglie la scelta", () => {
        const { host, changes } = mounted({ moves: () => moves });
        const [x, y] = screen(host, 450, 50);
        const tap = finger(host, 1, body(host, "b"), x, y);
        tap.up(x + 2, y + 1);
        expect(selected(host)).toEqual(["b"]);
        const [ex, ey] = screen(host, 300, 400);
        const empty = finger(host, 2, viewportOf(host), ex, ey);
        empty.up(ex, ey);
        expect(selected(host)).toEqual([]);
        expect(changes).toEqual([]);
      });

      it("la penna che si posa ferma il dito", () => {
        const { host } = mounted({ moves: () => moves });
        const [x, y] = screen(host, 300, 300);
        const one = finger(host, 1, viewportOf(host), x, y);
        one.move(x + 20, y);
        const moved = camera(host);
        const pen = { pointerId: 7, pointerType: "pen", isPrimary: true } as const;
        viewportOf(host).dispatchEvent(pointerEvent("pointerdown", { ...pen, clientX: x - 100, clientY: y, button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
        one.move(x + 80, y + 40);
        one.up(x + 80, y + 40);
        expect(camera(host)).toEqual(moved);
        document.dispatchEvent(pointerEvent("pointerup", { ...pen, clientX: x - 100, clientY: y, button: 0, buttons: 0, pressure: 0, timeStamp: clock + 4 }));
        // Alzata la penna, un dito nuovo sposta di nuovo.
        const two = finger(host, 3, viewportOf(host), x, y);
        two.move(x + 10, y);
        two.up(x + 10, y);
        expect(camera(host).x).toBeCloseTo(moved.x + 10);
      });

      it("pointercancel ferma il gesto e la scheda torna dov'era", () => {
        const { engine, host, changes } = mounted({ moves: () => moves });
        const zoom = camera(host).zoom;
        const [x, y] = screen(host, 20, 5);
        const one = finger(host, 1, handle(host, "a"), x, y);
        one.move(x + 80 * zoom, y);
        one.cancel();
        expect(changes).toEqual([]);
        expect(nodeX(engine, "a")).toBe(0);
      });

      it("in sola lettura il dito sposta la vista, anche dalla testata, e non sposta schede", () => {
        const { engine, host, changes } = mounted({ moves: () => moves });
        engine.setReadOnly(true);
        const before = camera(host);
        for (const target of [handle(host, "a"), body(host, "a")]) {
          const [x, y] = screen(host, 20, 5);
          const one = finger(host, 1, target, x, y);
          one.move(x + 30, y);
          one.up(x + 30, y);
        }
        expect(camera(host).x).toBeCloseTo(before.x + 60);
        expect(changes).toEqual([]);
        expect(nodeX(engine, "a")).toBe(0);
      });
    });
  }

  it("spenta, il dito sopra una scheda sposta la vista e non la scheda", () => {
    const { engine, host, changes } = mounted({ moves: () => false });
    const before = camera(host);
    const [x, y] = screen(host, 450, 50);
    const one = finger(host, 1, body(host, "b"), x, y);
    one.move(x + 50, y + 20);
    one.up(x + 50, y + 20);
    expect(camera(host).x).toBeCloseTo(before.x + 50);
    expect(changes).toEqual([]);
    expect(nodeX(engine, "b")).toBe(400);
    // Uno spostamento non è un tocco: la scheda non si sceglie.
    expect(selected(host)).toEqual([]);
  });

  it("accesa, il dito sopra una scheda la sposta, e la vista resta", () => {
    const { engine, host, changes } = mounted({ moves: () => true });
    const before = camera(host);
    const [x, y] = screen(host, 450, 50);
    const one = finger(host, 1, body(host, "b"), x, y);
    one.move(x + 40 * before.zoom, y);
    one.move(x + 80 * before.zoom, y);
    one.up(x + 80 * before.zoom, y);
    expect(camera(host)).toEqual(before);
    expect(changes).toHaveLength(1);
    expect(nodeX(engine, "b")).toBeGreaterThan(440);
    expect(selected(host)).toEqual(["b"]);
  });

  it("l'impostazione cambiata a dito giù vale dal tocco dopo", () => {
    const { engine, host, changes, settings } = mounted();
    const zoom = camera(host).zoom;
    // Accesa a metà di un pan sopra una scheda: resta un pan.
    let [x, y] = screen(host, 450, 50);
    const pan = finger(host, 1, body(host, "b"), x, y);
    settings.moves = true;
    pan.move(x + 30, y);
    pan.up(x + 30, y);
    expect(changes).toEqual([]);
    // Il tocco dopo sposta la scheda; spenta a metà, la scheda continua.
    [x, y] = screen(host, 450, 50);
    const drag = finger(host, 2, body(host, "b"), x, y);
    settings.moves = false;
    drag.move(x + 80 * zoom, y);
    drag.up(x + 80 * zoom, y);
    expect(changes).toHaveLength(1);
    expect(nodeX(engine, "b")).toBeGreaterThan(440);
  });

  it("durante uno spostamento di scheda il secondo dito non pizzica", () => {
    const { host, changes } = mounted({ moves: () => true });
    const before = camera(host);
    const [x, y] = screen(host, 450, 50);
    const one = finger(host, 1, body(host, "b"), x, y);
    one.move(x + 40, y);
    const two = finger(host, 2, viewportOf(host), x + 200, y + 200);
    two.move(x + 400, y + 300);
    two.up(x + 400, y + 300);
    one.up(x + 40, y);
    expect(camera(host)).toEqual(before);
    expect(changes).toHaveLength(1);
  });
});
