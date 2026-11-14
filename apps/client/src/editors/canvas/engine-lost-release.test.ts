// @vitest-environment happy-dom
// Il gesto che perde il rilascio (N6 T20a): la cattura persa, un movimento
// senza tasto e la finestra che perde il fuoco chiudono il gesto come un
// rilascio, una volta sola. Lo spostamento della vista, il trascinamento di una
// scheda e il dito si fermano dove sono, le schede vive tornano come dopo un
// rilascio, e il rilascio che arriva dopo non fa niente. Il gesto di un
// puntatore non chiude quello di un altro. Il tratto della penna non è qui: lo
// chiude l'adattatore di N4 (`ink/dom/pointer-adapter.ts`).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCardRegistry, type CardMode, type CardRenderer, type CardSnapshot, type CardSnapshots, type CardView } from "./cards";
import { CanvasEngine, type CanvasCards, type CanvasChange } from "./engine";
import type { CanvasNode } from "./model";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { canvasCoreReady } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  setReducedMotionPreference(false);
  vi.unstubAllGlobals();
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

/** Due immagini che la vista inquadra a zoom 1 (happy-dom non ha layout): «a» esce con uno spostamento di 800 px. */
const TWO_IMAGES = JSON.stringify({
  nodes: [
    { id: "a", type: "file", x: 0, y: 0, width: 200, height: 100, file: "img/a.png" },
    { id: "b", type: "file", x: 400, y: 0, width: 200, height: 100, file: "img/b.png" },
  ],
  edges: [],
});

type Point = { readonly clientX: number; readonly clientY: number };

function at(clientX: number, clientY: number): Point {
  return { clientX, clientY };
}

/** Un evento del puntatore sul bersaglio `target`; `timeStamp` si legge come nel browser (il costruttore non lo prende). */
function pointer(target: EventTarget, type: string, init: PointerEventInit & { readonly timeStamp?: number }): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerType: "mouse", ...rest,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
  return event;
}

/** Un registro di viste che conta le modalità delle schede di immagine (`setMode`). */
function modeRenderer() {
  const log: [string, CardMode][] = [];
  const renderer: CardRenderer = {
    kinds: ["image"],
    mount: (node: CanvasNode): CardView => ({
      setMode: (mode) => {
        log.push([node.id, mode]);
      },
      destroy: () => {},
    }),
  };
  return { renderer, log };
}

function memorySnapshots(): CardSnapshots {
  const map = new Map<string, CardSnapshot>();
  return {
    get: (path, part) => map.get(`${path}\n${part}`),
    put: (path, part, snapshot) => map.set(`${path}\n${part}`, snapshot),
    forget: (path) => {
      for (const key of [...map.keys()]) if (key.startsWith(`${path}\n`)) map.delete(key);
    },
  };
}

function cardsOf(renderer: CardRenderer): CanvasCards {
  return { registry: createCardRegistry([renderer]), snapshots: memorySnapshots(), watch: () => () => {} };
}

function mounted(source: string, cards?: CanvasCards) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "lost-release",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    ...(cards === undefined ? {} : { cards }),
  });
  engine.setDoc(source);
  return { engine, host, changes };
}

const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
const handleOf = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"] .canvas-node-handle`)!;

function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

function nodeX(engine: CanvasEngine, id: string): number {
  const doc = JSON.parse(engine.getDoc()) as { nodes: { id: string; x: number }[] };
  return doc.nodes.find((node) => node.id === id)!.x;
}

function liveOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>('.canvas-node[data-card-mode="live"]')].map((el) => el.dataset.node!).sort();
}

/**
 * Un modo di chiusura senza rilascio. Ognuno chiude il gesto del puntatore
 * `pointerId` dove stava al punto `at`; la finestra che perde il fuoco chiude
 * tutti i gesti.
 */
interface Closing {
  readonly name: string;
  readonly close: (viewport: HTMLElement, pointerId: number, pointerType: string, at: Point) => void;
}

const LOST_CAPTURE: Closing = {
  name: "la cattura persa",
  close: (viewport, pointerId, pointerType, point) => {
    pointer(viewport, "lostpointercapture", { pointerId, pointerType, ...point });
  },
};

const NO_BUTTON: Closing = {
  name: "un movimento senza tasto",
  close: (viewport, pointerId, pointerType, point) => {
    pointer(viewport, "pointermove", { pointerId, pointerType, buttons: 0, ...point });
  },
};

const BLURRED: Closing = {
  name: "la finestra che perde il fuoco",
  close: () => {
    window.dispatchEvent(new Event("blur"));
  },
};

/** Col mouse le tre chiuse. Il dito non ha un tasto da lasciare, e la cattura persa non lo chiude (T64): gli resta la finestra. */
const MOUSE_CLOSINGS = [LOST_CAPTURE, NO_BUTTON, BLURRED];

describe("il gesto che perde il rilascio si chiude come un rilascio (T20a)", () => {
  for (const closing of MOUSE_CLOSINGS) {
    describe(`con ${closing.name}`, () => {
      it("lo spostamento della vista si ferma dove è, e il rilascio che arriva dopo non sposta né chiude di nuovo", () => {
        const { engine, host } = mounted(BOARD);
        const viewport = viewportOf(host);
        const start = cameraOf(host);
        pointer(viewport, "pointerdown", { pointerId: 1, button: 1, buttons: 4, ...at(300, 200) });
        pointer(viewport, "pointermove", { pointerId: 1, buttons: 4, ...at(360, 230) });
        closing.close(viewport, 1, "mouse", at(360, 230));
        const closed = cameraOf(host);
        expect(closed.x - start.x).toBeCloseTo(60, 6);
        expect(closed.y - start.y).toBeCloseTo(30, 6);
        // Il rilascio tardivo e un movimento senza tasto non spostano più niente.
        pointer(viewport, "pointerup", { pointerId: 1, button: 1, buttons: 0, ...at(420, 260) });
        pointer(viewport, "pointermove", { pointerId: 1, buttons: 0, ...at(500, 300) });
        expect(cameraOf(host)).toEqual(closed);
        engine.destroy();
      });

      it("il trascinamento di una scheda si posa dove è, una sola volta; il rilascio tardivo non la sposta né la salva di nuovo", () => {
        const { engine, host, changes } = mounted(BOARD);
        const viewport = viewportOf(host);
        pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...at(100, 50) });
        pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, ...at(160, 80) });
        closing.close(viewport, 1, "mouse", at(160, 80));
        expect(changes).toHaveLength(1);
        const posed = nodeX(engine, "a");
        expect(posed).toBeGreaterThan(0);
        pointer(viewport, "pointerup", { pointerId: 1, button: 0, buttons: 0, ...at(300, 200) });
        pointer(viewport, "pointermove", { pointerId: 1, buttons: 0, ...at(400, 200) });
        expect(changes).toHaveLength(1);
        expect(nodeX(engine, "a")).toBe(posed);
        engine.destroy();
      });

      it("un trascinamento che esce dalla finestra si posa dove il puntatore l'ha portato", () => {
        const { engine, host, changes } = mounted(BOARD);
        const viewport = viewportOf(host);
        pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...at(100, 50) });
        pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, ...at(-40, 80) });
        closing.close(viewport, 1, "mouse", at(-40, 80));
        expect(changes).toHaveLength(1);
        expect(nodeX(engine, "a")).toBeLessThan(0);
        engine.destroy();
      });

      it("le schede in vista tornano come dopo un rilascio, e la vista che torna le accende di nuovo", () => {
        const { renderer, log } = modeRenderer();
        const { engine, host } = mounted(TWO_IMAGES, cardsOf(renderer));
        const viewport = viewportOf(host);
        expect(liveOf(host)).toEqual(["a", "b"]);
        log.length = 0;
        // A sinistra di 800 px «a» esce dalla vista: durante il gesto nessuna cambia.
        pointer(viewport, "pointerdown", { pointerId: 9, button: 1, buttons: 4, ...at(400, 300) });
        pointer(viewport, "pointermove", { pointerId: 9, buttons: 4, ...at(-400, 300) });
        expect(log).toEqual([]);
        expect(liveOf(host)).toEqual(["a", "b"]);
        closing.close(viewport, 9, "mouse", at(-400, 300));
        expect(log).toEqual([["a", "snapshot"]]);
        expect(liveOf(host)).toEqual(["b"]);
        // Tornata in vista, «a» si accende con un nuovo gesto che finisce col rilascio.
        pointer(viewport, "pointerdown", { pointerId: 9, button: 1, buttons: 4, ...at(400, 300) });
        pointer(viewport, "pointermove", { pointerId: 9, buttons: 4, ...at(1200, 300) });
        pointer(viewport, "pointerup", { pointerId: 9, button: 1, buttons: 0, ...at(1200, 300) });
        expect(log).toEqual([["a", "snapshot"], ["a", "live"]]);
        expect(liveOf(host)).toEqual(["a", "b"]);
        engine.destroy();
      });
    });
  }

  it("il tasto destro su una scheda non apre un gesto: niente si chiude e niente si sposta", () => {
    const { engine, host, changes } = mounted(BOARD);
    const viewport = viewportOf(host);
    const before = cameraOf(host);
    pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 2, buttons: 2, ...at(100, 50) });
    pointer(viewport, "pointermove", { pointerId: 1, buttons: 0, ...at(160, 80) });
    pointer(viewport, "pointerup", { pointerId: 1, button: 2, buttons: 0, ...at(160, 80) });
    expect(changes).toEqual([]);
    expect(nodeX(engine, "a")).toBe(0);
    expect(cameraOf(host)).toEqual(before);
    engine.destroy();
  });

  it("un gesto di un puntatore non chiude quello di un altro: la vista col dito resta, il trascinamento col mouse si posa", () => {
    const { engine, host, changes } = mounted(BOARD);
    const viewport = viewportOf(host);
    // Il dito pan sul vuoto; il mouse trascina «a» mentre il dito è ancora giù.
    pointer(viewport, "pointerdown", { pointerId: 5, pointerType: "touch", button: 0, buttons: 1, ...at(600, 400) });
    pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...at(100, 50) });
    pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, ...at(160, 80) });
    const fingerBefore = cameraOf(host);
    // Il mouse perde la cattura: il suo trascinamento finisce, il dito no.
    LOST_CAPTURE.close(viewport, 1, "mouse", at(160, 80));
    expect(changes).toHaveLength(1);
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(640, 400) });
    expect(cameraOf(host).x).toBeCloseTo(fingerBefore.x + 40, 6);
    pointer(viewport, "pointerup", { pointerId: 5, pointerType: "touch", button: 0, buttons: 0, ...at(640, 400) });
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("il movimento del dito senza tasto non chiude il suo gesto: il dito lo chiude solo la cattura persa o la finestra", () => {
    const { engine, host } = mounted(BOARD);
    const viewport = viewportOf(host);
    pointer(viewport, "pointerdown", { pointerId: 5, pointerType: "touch", button: 0, buttons: 1, ...at(600, 400) });
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 0, ...at(620, 400) });
    const before = cameraOf(host);
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(640, 400) });
    expect(cameraOf(host).x).toBeCloseTo(before.x + 20, 6);
    engine.destroy();
  });

  it("il pan del dito si ferma con la finestra che perde il fuoco: la vista resta, e il dito che si muove dopo non la sposta", () => {
    const { engine, host } = mounted(BOARD);
    const viewport = viewportOf(host);
    pointer(viewport, "pointerdown", { pointerId: 5, pointerType: "touch", button: 0, buttons: 1, ...at(600, 400) });
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(620, 400) });
    BLURRED.close(viewport, 5, "touch", at(620, 400));
    const closed = cameraOf(host);
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(700, 400) });
    pointer(viewport, "pointerup", { pointerId: 5, pointerType: "touch", button: 0, buttons: 0, ...at(700, 400) });
    expect(cameraOf(host)).toEqual(closed);
    engine.destroy();
  });

  it("la cattura persa di un dito non chiude il suo gesto: il dito resta suo, e il rilascio lo chiude una volta sola", () => {
    const { engine, host } = mounted(BOARD);
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    pointer(viewport, "pointerdown", { pointerId: 5, pointerType: "touch", button: 0, buttons: 1, ...at(600, 400) });
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(620, 400) });
    // Lo strato della penna o il browser tolgono la cattura al dito che passa a scrivere (T64).
    LOST_CAPTURE.close(viewport, 5, "touch", at(620, 400));
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(640, 400) });
    expect(cameraOf(host).x - start.x).toBeCloseTo(40, 6);
    pointer(viewport, "pointerup", { pointerId: 5, pointerType: "touch", button: 0, buttons: 0, ...at(640, 400) });
    const released = cameraOf(host);
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(700, 400) });
    expect(cameraOf(host)).toEqual(released);
    engine.destroy();
  });

  it("la finestra che perde il fuoco chiude ogni gesto aperto: il trascinamento si posa, il dito smette di spostare", () => {
    const { engine, host, changes } = mounted(BOARD);
    const viewport = viewportOf(host);
    pointer(viewport, "pointerdown", { pointerId: 5, pointerType: "touch", button: 0, buttons: 1, ...at(600, 400) });
    pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...at(100, 50) });
    pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, ...at(160, 80) });
    window.dispatchEvent(new Event("blur"));
    expect(changes).toHaveLength(1);
    const panned = cameraOf(host);
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(700, 400) });
    pointer(viewport, "pointermove", { pointerId: 1, buttons: 0, ...at(200, 200) });
    expect(cameraOf(host)).toEqual(panned);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });
});
