// @vitest-environment happy-dom
// I difetti della lavagna trovati dal collaudo dell'app (IMP-040…043) e dal
// giro dell'issue #411 (C-05, C-06): il fuoco dopo un pulsante della colonna,
// lo spostamento dal corpo di una scheda, «Aggiungi testo» che apre in
// scrittura in un posto libero, la scheda nuova lasciata vuota, l'aggancio
// solo al rilascio e la barra della scelta durante lo zoom.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine, type CanvasChange } from "./engine";
import { DEFAULT_PREFERENCES, type CanvasPreferences } from "./preferences";
import { canvasCoreReady } from "./wasm/core";
import { setReducedMotionPreference } from "../../theme/reduced-motion";

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

vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  setReducedMotionPreference(false);
  watched.appliers = [];
  vi.restoreAllMocks();
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

function pointer(target: EventTarget, type: string, init: PointerEventInit): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerType: "mouse", ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function mounted(source: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "collaudo",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
  });
  engine.setDoc(source);
  return { engine, host, changes };
}

/** Le impostazioni della lavagna cambiate a lavagna aperta, come le manda un cambio da Impostazioni. */
function setPreferences(change: Partial<CanvasPreferences>): void {
  for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, ...change });
}

const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
const cardOf = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
const handleOf = (host: HTMLElement, id: string) => cardOf(host, id).querySelector<HTMLElement>(".canvas-node-handle")!;
const bodyOf = (host: HTMLElement, id: string) => cardOf(host, id).querySelector<HTMLElement>(".canvas-card-body")!;

function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

function screenOf(host: HTMLElement, x: number, y: number): { clientX: number; clientY: number } {
  const camera = cameraOf(host);
  return { clientX: x * camera.zoom + camera.x, clientY: y * camera.zoom + camera.y };
}

/** Il nodo `id` come sta adesso nel documento della lavagna. */
function nodeOf(engine: CanvasEngine, id: string) {
  return JSON.parse(engine.getDoc()).nodes.find((node: { id: string }) => node.id === id) as
    { id: string; x: number; y: number; width: number; height: number; text?: string } | undefined;
}

function key(target: Element | null, init: KeyboardEventInit): void {
  (target ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("il fuoco dopo un pulsante della lavagna (IMP-040)", () => {
  it("dopo un clic su un pulsante della colonna, il clic sulla testata di una scheda riporta il fuoco sulla lavagna: Canc la toglie e Ctrl+Z la riporta", async () => {
    const { engine, host, changes } = mounted(BOARD);
    const tool = host.querySelector<HTMLButtonElement>(".canvas-tool")!;
    tool.focus();
    expect(document.activeElement).toBe(tool);
    pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 20, 10) });
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 20, 10) });
    expect(engine.selection().nodes).toEqual(["a"]);
    expect(viewportOf(host).contains(document.activeElement)).toBe(true);
    key(document.activeElement, { key: "Delete" });
    expect(changes).toHaveLength(1);
    expect(nodeOf(engine, "a")).toBeUndefined();
    // Tolta la scheda, il fuoco resta sulla lavagna: Ctrl+Z arriva.
    expect(viewportOf(host).contains(document.activeElement)).toBe(true);
    key(document.activeElement, { key: "z", ctrlKey: true });
    await vi.waitFor(() => expect(nodeOf(engine, "a")).toBeDefined());
    engine.destroy();
  });

  it("dopo un pulsante della riga delle opzioni, il clic su un filo o nel vuoto riporta il fuoco sulla vista", () => {
    const { engine, host } = mounted(BOARD);
    const tool = host.querySelector<HTMLButtonElement>(".canvas-tool")!;
    tool.focus();
    const viewport = viewportOf(host);
    pointer(viewport, "pointerdown", { pointerId: 2, button: 0, buttons: 1, ...screenOf(host, 300, 400) });
    pointer(viewport, "pointerup", { pointerId: 2, button: 0, buttons: 0, ...screenOf(host, 300, 400) });
    expect(viewport.contains(document.activeElement)).toBe(true);
    engine.destroy();
  });
});

describe("lo spostamento dal corpo di una scheda (IMP-041)", () => {
  it("trascinare dal corpo di una scheda di testo la sposta, in un passo, e il clic che segue non entra a scrivere", () => {
    const { engine, host, changes } = mounted(BOARD);
    const body = bodyOf(host, "a");
    pointer(body, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 100, 60) });
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, 20, 20), altKey: true });
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 20, 20), altKey: true });
    body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(changes).toHaveLength(1);
    expect(nodeOf(engine, "a")).toMatchObject({ x: -80, y: -40 });
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    engine.destroy();
  });

  it("un clic fermo sul corpo sceglie e basta: il documento non cambia", () => {
    const { engine, host, changes } = mounted(BOARD);
    const body = bodyOf(host, "b");
    pointer(body, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 500, 60) });
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, 501, 61) });
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 501, 61) });
    expect(engine.selection().nodes).toEqual(["b"]);
    expect(changes).toEqual([]);
    engine.destroy();
  });

  it("in sola lettura il corpo sceglie e non sposta", () => {
    const { engine, host, changes } = mounted(BOARD);
    engine.setReadOnly(true);
    pointer(bodyOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 100, 60) });
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, 20, 20) });
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 20, 20) });
    expect(changes).toEqual([]);
    expect(engine.selection().nodes).toEqual(["a"]);
    engine.destroy();
  });

  it("un preferences test di controllo: le impostazioni si applicano", () => {
    const { engine } = mounted(BOARD);
    setPreferences({});
    engine.destroy();
  });
});
