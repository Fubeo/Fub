// @vitest-environment happy-dom
// La penna sulla lavagna (N4 T12): il tratto si scrive nel `.canvas` con un
// passo d'annulla, segue la scheda, e il ridisegno aspetta la penna. La gomma
// (T13, T22) toglie i tratti interi o ne taglia il pezzo, in un passo.
// L'interruttore «Scrivi col mouse» (T16) si ricorda nello stato di vista.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { parseInkBrush, penOf } from "../../ink/brush";
import { quantizeInk, type InkSample } from "../../ink/sample";
import { encodeInk, inkFromQuantized } from "../spatial/ink/codec";
import { CanvasEngine, type CanvasChange, type CanvasCorePort } from "./engine";
import { INK_SCALE_ASPECT } from "./ink-paint";
import type { CanvasPatch } from "./operation";
import { CanvasCoreError, canvasCoreReady, openCoreNow } from "./wasm/core";

// Il limite dei campioni di un pezzo, piccolo: un tratto spezzato si prova con
// qualche decina di eventi invece che con diecimila (la scia si rifà a ogni
// evento). Gli altri tratti di questo file ne hanno al più tre.
vi.mock("../../ink/sample", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ink/sample")>()),
  INK_MAX_SAMPLES: 16,
}));

// Questo computer, finto: «Ricorda se scrivi col mouse» e gli stati di vista,
// dietro le vere `readInkMouse` e `saveInkMouse` di `preferences.ts`.
const machine = vi.hoisted(() => ({ remember: false, views: new Map<string, unknown>() }));

vi.mock("../../host/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../host/query")>()),
  settings: async () => [{
    spec: {
      key: "canvas.ink_mouse_remember",
      label: "",
      description: "",
      group: "Lavagna",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: machine.remember,
    source: "machine",
  }],
}));

vi.mock("../../host/ipc", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../host/ipc")>();
  return {
    ...original,
    api: {
      ...original.api,
      viewState: async (key: string) => machine.views.get(key) ?? null,
      setViewState: async (key: string, value: unknown) => {
        machine.views.set(key, value);
      },
    },
  };
});

beforeAll(async () => {
  await canvasCoreReady();
});

/** Il nucleo rifiuta ogni commit come troppo grande (`limit`). */
let refuseCommits = false;

afterEach(() => {
  document.body.replaceChildren();
  refuseCommits = false;
  machine.remember = false;
  machine.views.clear();
});

type Init = PointerEventInit & { readonly timeStamp?: number };

/// Un `PointerEvent` sintetico, come in `ink-layer.test.ts`.
function pointerEvent(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: true,
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
const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

/** Tre schede: una nota, un'immagine `.heic` e un PDF. */
const BOARD = JSON.stringify({
  nodes: [
    { id: "t", type: "text", x: 0, y: 0, width: 200, height: 100, text: "nota" },
    { id: "img", type: "file", x: 300, y: 0, width: 200, height: 100, file: "allegati/foto.heic" },
    { id: "doc", type: "file", x: 600, y: 0, width: 200, height: 100, file: "carta.pdf" },
  ],
  edges: [],
});

/** Il nucleo vero, con ogni chiamata contata per nome. */
function countingPort(calls: string[]): CanvasCorePort {
  return {
    ready: canvasCoreReady,
    openNow: (text) => {
      const core = openCoreNow(text);
      if (!core) return null;
      return new Proxy(core, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            calls.push(String(prop));
            if (prop === "commit" && refuseCommits) throw new CanvasCoreError("limit", "troppo grande");
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    },
  };
}

function mounted(source = BOARD) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const calls: string[] = [];
  // Ogni porta che potrebbe scrivere altro: nessuna deve essere chiamata.
  const ports = {
    deposit: vi.fn(async () => [] as string[]),
    resolvePaths: vi.fn(async () => [] as string[]),
    onCreateNote: vi.fn(),
    onPickFile: vi.fn(() => null),
    openExternal: vi.fn(),
    onOpenPath: vi.fn(),
  };
  const engine = new CanvasEngine(host, {
    surfaceId: "ink",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    core: countingPort(calls),
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    onCreateNote: ports.onCreateNote,
    onPickFile: ports.onPickFile,
    onOpenPath: ports.onOpenPath,
    media: { openExternal: ports.openExternal },
    attachments: { deposit: ports.deposit, resolvePaths: ports.resolvePaths },
  });
  engine.setDoc(source);
  return { engine, host, changes, calls, ports };
}

/** La camera della lavagna, letta dalla trasformazione dello stage. */
function camera(host: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

let clock = 0;

/**
 * Un tratto della penna finta per i punti `world` della lavagna: giù e i
 * movimenti su `target`, su sul documento. Con `lift: false` la penna resta
 * giù e la funzione dà quella che la alza.
 */
function pen(host: HTMLElement, target: Element, world: readonly (readonly [number, number])[], lift = true): () => void {
  const cam = camera(host);
  const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
  target.dispatchEvent(pointerEvent("pointerdown", { ...PEN, ...at(world[0]!), button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
  for (const point of world.slice(1)) {
    clock += 8;
    target.dispatchEvent(pointerEvent("pointermove", { ...PEN, ...at(point), button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
  }
  const last = world[world.length - 1]!;
  const end = clock + 4;
  clock += 100;
  const liftPen = () => {
    document.dispatchEvent(pointerEvent("pointerup", { ...PEN, ...at(last), button: 0, buttons: 0, pressure: 0, timeStamp: end }));
  };
  if (lift) liftPen();
  return liftPen;
}

const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
const inkPaths = (element: Element) => [...element.querySelectorAll<SVGPathElement>(".canvas-ink-card path")];

/** Un tratto dentro la scheda di riquadro dato, lontano dai bordi. */
function across(x: number, y: number): [number, number][] {
  return [[x + 40, y + 40], [x + 60, y + 50], [x + 90, y + 55]];
}

type Json = Record<string, unknown>;
function strokesOf(text: string, id: string | null): Json[] {
  const doc = JSON.parse(text) as Json & { nodes: Json[] };
  const holder = id === null ? doc : doc.nodes.find((node) => node.id === id);
  const layer = holder?.["fub:ink"] as { strokes?: Json[] } | undefined;
  return layer?.strokes ?? [];
}

function lastChange(changes: readonly CanvasChange[]): CanvasChange {
  return changes[changes.length - 1]!;
}

describe("la penna scrive sulla lavagna", () => {
  it("un tratto è una toppa ink, una sola scrittura al nucleo e un passo d'annulla", () => {
    const { engine, host, changes, calls } = mounted();
    calls.length = 0;
    pen(host, card(host, "t"), across(0, 0));

    expect(changes).toHaveLength(1);
    const patches: readonly CanvasPatch[] = changes[0]!.operation.patches;
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ kind: "ink", layer: { node: "t" }, at: 0, before: null });
    expect(calls.filter((name) => name === "commit")).toHaveLength(1);
    expect(calls.filter((name) => name === "reset" || name === "preview")).toEqual([]);
    const [stroke] = strokesOf(changes[0]!.text, "t");
    expect(stroke).toMatchObject({ tool: "pen", color: "#0072b2", anchor: { kind: "card", width: 200, height: 100 } });
    // L'asciutto è nella scheda, la scia se n'è andata.
    expect(inkPaths(card(host, "t"))).toHaveLength(1);
    expect(host.querySelectorAll(".canvas-ink-wet path")).toHaveLength(0);

    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(BOARD);
    expect(engine.undo()).toBe(false);
  });

  it("annulla e ripeti vanno per tratto e ridanno il testo di prima byte per byte, senza rifare le schede", () => {
    const { engine, host, changes } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    pen(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]]);
    expect(changes).toHaveLength(2);
    const [one, two] = changes.map((change) => change.text);
    expect(strokesOf(two!, null)).toHaveLength(1);
    expect(host.querySelectorAll(".canvas-ink-board path")).toHaveLength(1);
    const article = card(host, "t");

    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(one);
    expect(host.querySelectorAll(".canvas-ink-board path")).toHaveLength(0);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(BOARD);
    expect(inkPaths(card(host, "t"))).toHaveLength(0);
    expect(engine.redo()).toBe(true);
    expect(lastChange(changes).text).toBe(one);
    expect(engine.redo()).toBe(true);
    expect(lastChange(changes).text).toBe(two);
    // Un passo fatto solo di tratti ridisegna lo strato: la scheda è la stessa.
    expect(card(host, "t")).toBe(article);
    expect(inkPaths(article)).toHaveLength(1);
  });

  it("dopo una modifica da fuori l'annulla del tratto passa dalle toppe e tiene la modifica", () => {
    const { engine, host, changes } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    const outside = JSON.parse(lastChange(changes).text) as Json & { nodes: Json[] };
    outside.nodes[2]!.x = 640;
    engine.syncDoc(JSON.stringify(outside));
    expect(engine.undo()).toBe(true);
    const after = JSON.parse(lastChange(changes).text) as Json & { nodes: Json[] };
    expect(strokesOf(lastChange(changes).text, "t")).toEqual([]);
    expect(after.nodes[2]!.x).toBe(640);
  });

  it("spostare una scheda porta il suo inchiostro, senza ridisegnarlo", () => {
    const { host, changes } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    const before = strokesOf(lastChange(changes).text, "t");
    const d = inkPaths(card(host, "t"))[0]!.getAttribute("d");
    const article = card(host, "t");
    article.querySelector(".canvas-node-handle")!.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(pointerEvent("pointermove", { ...MOUSE, buttons: 1, clientX: 80, clientY: 40 }));
    // Durante il trascinamento la scheda si muove e l'inchiostro con lei.
    expect(article.style.transform).not.toBe("translate(0px, 0px)");
    expect(inkPaths(article)[0]!.getAttribute("d")).toBe(d);
    viewportOf(host).dispatchEvent(pointerEvent("pointerup", { ...MOUSE, clientX: 80, clientY: 40 }));

    const moved = JSON.parse(lastChange(changes).text) as Json & { nodes: Json[] };
    expect(moved.nodes[0]!.x).not.toBe(0);
    expect(strokesOf(lastChange(changes).text, "t")).toEqual(before);
    expect(inkPaths(card(host, "t"))[0]!.getAttribute("d")).toBe(d);
  });

  it("ridimensionare un'immagine o un PDF scala l'inchiostro senza deformarlo; una nota lo lascia fermo", () => {
    const { host, changes } = mounted();
    expect(card(host, "img").querySelector<HTMLElement>(".canvas-card-body")!.dataset.mediaKind).toBe("image");
    expect(card(host, "doc").querySelector<HTMLElement>(".canvas-card-body")!.dataset.mediaKind).toBe("pdf");
    for (const [id, x] of [["t", 0], ["img", 300], ["doc", 600]] as const) pen(host, card(host, id), across(x, 0));
    const nested = (id: string) => card(host, id).querySelector(".canvas-ink-card > svg")!;
    const attrs = (id: string) => ["width", "height", "viewBox", "preserveAspectRatio"].map((name) => nested(id).getAttribute(name));
    const scaled = ["100%", "100%", "0 0 200 100", INK_SCALE_ASPECT];
    expect(attrs("img")).toEqual(scaled);
    expect(attrs("doc")).toEqual(scaled);
    expect(attrs("t")).toEqual(["200", "100", null, null]);
    const paths = (id: string) => inkPaths(card(host, id)).map((path) => path.getAttribute("d"));
    const drawn = { t: paths("t"), img: paths("img"), doc: paths("doc") };

    let pointer = 20;
    for (const id of ["t", "img", "doc"] as const) {
      pointer++;
      host.querySelector(`[data-resize="${id}"]`)!.dispatchEvent(pointerEvent("pointerdown", { pointerId: pointer, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 }));
      viewportOf(host).dispatchEvent(pointerEvent("pointermove", { pointerId: pointer, pointerType: "mouse", buttons: 1, clientX: 160, clientY: 40 }));
      viewportOf(host).dispatchEvent(pointerEvent("pointerup", { pointerId: pointer, pointerType: "mouse", clientX: 160, clientY: 40 }));
    }
    const resized = JSON.parse(lastChange(changes).text) as Json & { nodes: Json[] };
    for (const node of resized.nodes) expect(node.width).not.toBe(200);
    // La misura di riferimento resta quella scritta: il browser scala, i percorsi no.
    expect(attrs("img")).toEqual(scaled);
    expect(attrs("doc")).toEqual(scaled);
    expect(attrs("t")).toEqual(["200", "100", null, null]);
    expect({ t: paths("t"), img: paths("img"), doc: paths("doc") }).toEqual(drawn);
  });

  it("il testo in sospeso e il tratto sono due passi, e il campo resta aperto col suo testo", () => {
    const { engine, host, changes } = mounted();
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
    field.value = "nota scritta";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(engine.hasPending).toBe(true);

    pen(host, field, across(0, 0));
    expect(changes).toHaveLength(2);
    expect(changes[0]!.operation.patches[0]!.kind).toBe("upsert-node");
    expect(changes[1]!.operation.patches[0]!.kind).toBe("ink");
    expect(host.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("nota scritta");
    expect(engine.hasPending).toBe(false);

    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(changes[0]!.text);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(BOARD);
  });

  it("una modifica da fuori a penna giù cambia subito il testo e ridisegna dopo; la scheda si sceglie quando la penna si alza", async () => {
    const { engine, host, changes } = mounted();
    const lift = pen(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]], false);
    const outside = JSON.parse(BOARD) as Json & { nodes: Json[] };
    outside.nodes.push({ id: "n", type: "text", x: 40, y: 250, width: 240, height: 140, text: "nuova" });
    const text = JSON.stringify(outside);
    engine.syncDoc(text);
    expect(engine.getDoc()).toBe(text);
    // Il ridisegno aspetta: la scheda nuova non è ancora sulla scena.
    expect(card(host, "n")).toBeNull();

    lift();
    expect(strokesOf(lastChange(changes).text, "n")).toHaveLength(1);
    await vi.waitFor(() => expect(card(host, "n")).not.toBeNull());
    expect(inkPaths(card(host, "n"))).toHaveLength(1);
  });

  it("la scheda tolta da fuori a penna giù lascia il tratto libero", () => {
    const { engine, host, changes } = mounted();
    const lift = pen(host, card(host, "t"), across(0, 0), false);
    const outside = JSON.parse(BOARD) as Json & { nodes: Json[] };
    outside.nodes.shift();
    engine.syncDoc(JSON.stringify(outside));
    lift();
    expect(strokesOf(lastChange(changes).text, null)).toMatchObject([{ anchor: { kind: "free" } }]);
  });

  it("un tratto spezzato al limite dei campioni si salva a pezzi ed è un passo solo", () => {
    const { engine, host, changes } = mounted();
    // Oltre `INK_MAX_SAMPLES` campioni (qui 16) l'adattatore chiude il pezzo e ne apre un altro.
    const points: [number, number][] = [];
    for (let i = 0; i < 40; i++) points.push([100 + i * 4, 300 + (i % 2) * 3]);
    pen(host, viewportOf(host), points);
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(changes.length);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(BOARD);
    expect(engine.undo()).toBe(false);
    const whole = changes[changes.length - 2]!.text;
    expect(engine.redo()).toBe(true);
    expect(lastChange(changes).text).toBe(whole);
  });

  it("con la penna giù annulla e ripeti non fanno niente", () => {
    const { engine, host, changes } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    const lift = pen(host, card(host, "img"), across(300, 0), false);
    expect(engine.undo()).toBe(false);
    expect(changes).toHaveLength(1);
    lift();
    expect(changes).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(changes[0]!.text);
  });

  it("la sola lettura della tela smonta lo strato, anche a penna giù, e se ne va da sola", () => {
    const { engine, host, changes } = mounted();
    const wet = () => host.querySelector(".canvas-ink-wet");
    expect(wet()).not.toBeNull();
    const lift = pen(host, card(host, "t"), across(0, 0), false);
    expect(host.querySelectorAll(".canvas-ink-wet path")).toHaveLength(1);
    const unwritable = BOARD.replace(/}$/, ',"fub:k":1,"fub:k":2}');
    engine.syncDoc(unwritable);
    expect(wet()).toBeNull();
    const alerts = [...host.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);
    expect(alerts).toEqual([t("canvas.unwritable")]);
    lift();
    expect(changes).toEqual([]);

    engine.syncDoc(BOARD);
    expect(wet()).not.toBeNull();
    pen(host, card(host, "t"), across(0, 0));
    expect(changes).toHaveLength(1);
  });

  it("la sola lettura del pannello smonta lo strato e lo rimonta", () => {
    const { engine, host, changes } = mounted();
    engine.setReadOnly(true);
    expect(host.querySelector(".canvas-ink-wet")).toBeNull();
    pen(host, card(host, "t"), across(0, 0));
    expect(changes).toEqual([]);
    engine.setReadOnly(false);
    expect(host.querySelector(".canvas-ink-wet")).not.toBeNull();
    pen(host, card(host, "t"), across(0, 0));
    expect(changes).toHaveLength(1);
  });

  it("l'unica cosa scritta è il testo del .canvas", () => {
    const { engine, host, changes, ports } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    pen(host, card(host, "img"), across(300, 0));
    pen(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]]);
    engine.undo();
    engine.redo();
    expect(changes).toHaveLength(5);
    for (const change of changes) expect(() => JSON.parse(change.text) as unknown).not.toThrow();
    for (const port of Object.values(ports)) expect(port).not.toHaveBeenCalled();
  });

  it("il livello estraneo della radice non si scrive e lo dice; una scheda estranea lascia il tratto libero", () => {
    const foreign = JSON.stringify({
      nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 200, height: 100, text: "x", "fub:ink": { v: 2, strokes: [] } }],
      edges: [],
      "fub:ink": { v: 2, strokes: [] },
    });
    const { host, changes } = mounted(foreign);
    pen(host, card(host, "t"), across(0, 0));
    expect(changes).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("canvas.ink.foreign"));
    // La scia sparisce comunque.
    expect(host.querySelectorAll(".canvas-ink-wet path")).toHaveLength(0);
  });

  it("la lavagna chiusa a penna giù perde il tratto senza errori", () => {
    const { engine, host, changes } = mounted();
    const lift = pen(host, card(host, "t"), across(0, 0), false);
    engine.destroy();
    expect(() => lift()).not.toThrow();
    expect(changes).toEqual([]);
  });

  it("duplicare una scheda copia il suo inchiostro, cancellarla lo porta via (un passo)", () => {
    const { engine, host, changes } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    const ink = strokesOf(lastChange(changes).text, "t");
    card(host, "t").dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(pointerEvent("pointerup", { ...MOUSE, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    const copy = (JSON.parse(lastChange(changes).text) as { nodes: Json[] }).nodes[3]!;
    expect(strokesOf(lastChange(changes).text, copy.id as string)).toEqual(ink);
    expect(inkPaths(card(host, copy.id as string))).toHaveLength(1);
    const withCopy = lastChange(changes).text;
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(card(host, copy.id as string)).toBeNull();
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(withCopy);
  });
});

const ERASER_PEN = { pointerId: 9, pointerType: "pen" } as const;

/**
 * Una passata del retro della penna sui punti `world` della lavagna. Con
 * `lift: false` resta giù e la funzione dà quella che la alza.
 */
function eraser(host: HTMLElement, target: Element, world: readonly (readonly [number, number])[], lift = true): () => void {
  const cam = camera(host);
  const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
  target.dispatchEvent(pointerEvent("pointerdown", { ...ERASER_PEN, ...at(world[0]!), button: 5, buttons: 32, pressure: 0.5, timeStamp: clock }));
  for (const point of world.slice(1)) {
    clock += 8;
    target.dispatchEvent(pointerEvent("pointermove", { ...ERASER_PEN, ...at(point), button: -1, buttons: 32, pressure: 0.5, timeStamp: clock }));
  }
  const last = world[world.length - 1]!;
  const end = clock + 4;
  clock += 100;
  const liftEraser = () => {
    document.dispatchEvent(pointerEvent("pointerup", { ...ERASER_PEN, ...at(last), button: 5, buttons: 0, pressure: 0, timeStamp: end }));
  };
  if (lift) liftEraser();
  return liftEraser;
}

/** Un tratto del mouse sui punti `world`, col tasto principale; `between` gira dopo il primo movimento. */
function mouse(host: HTMLElement, target: Element, world: readonly (readonly [number, number])[], between?: () => void): void {
  const cam = camera(host);
  const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
  target.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, ...at(world[0]!), button: 0, buttons: 1, timeStamp: clock }));
  world.slice(1).forEach((point, index) => {
    if (index === 1) between?.();
    clock += 8;
    target.dispatchEvent(pointerEvent("pointermove", { ...MOUSE, ...at(point), button: -1, buttons: 1, timeStamp: clock }));
  });
  clock += 4;
  document.dispatchEvent(pointerEvent("pointerup", { ...MOUSE, ...at(world[world.length - 1]!), button: 0, buttons: 0, timeStamp: clock }));
  clock += 100;
}

const opacities = (element: Element, selector = ".canvas-ink-card path") =>
  [...element.querySelectorAll(selector)].map((path) => path.getAttribute("opacity"));
const inkChanges = (changes: readonly CanvasChange[]) =>
  changes.filter((change) => change.operation.patches.some((patch) => patch.kind === "ink"));
const keyD = (target: EventTarget, type: "keydown" | "keyup", init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent(type, { key: "d", bubbles: true, cancelable: true, ...init }));

describe("la gomma «Il tratto intero» e il tasto D", () => {
  it("la gomma sbiadisce i tratti presi e alla fine li cancella in un passo, anche su due livelli; l'annulla li rimette", () => {
    const { engine, host, changes } = mounted();
    pen(host, card(host, "t"), [[20, 20], [60, 25], [100, 30]]);
    pen(host, card(host, "t"), [[20, 80], [60, 82], [100, 85]]);
    pen(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]]);
    expect(changes).toHaveLength(3);
    const before = lastChange(changes).text;

    // Una passata verticale a x = 60 prende il primo tratto della nota, non il secondo.
    const lift = eraser(host, viewportOf(host), [[60, 5], [60, 30], [60, 45]], false);
    expect(opacities(card(host, "t"))).toEqual(["0.25", null]);
    expect(changes).toHaveLength(3);
    // E prosegue, girando attorno al secondo tratto, sul tratto libero: un altro livello.
    const cam = camera(host);
    for (const [x, y] of [[300, 45], [140, 320]] as const) {
      clock += 8;
      viewportOf(host).dispatchEvent(pointerEvent("pointermove", {
        ...ERASER_PEN, clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y, button: -1, buttons: 32, pressure: 0.5, timeStamp: clock,
      }));
    }
    expect(opacities(card(host, "t"))).toEqual(["0.25", null]);
    expect(opacities(host, ".canvas-ink-board path")).toEqual(["0.25"]);
    lift();

    expect(changes).toHaveLength(4);
    const patches = lastChange(changes).operation.patches;
    expect(patches).toHaveLength(2);
    for (const patch of patches) expect(patch).toMatchObject({ kind: "ink", after: null });
    expect(patches.map((patch) => (patch as { layer: unknown }).layer)).toEqual([{ node: "t" }, "board"]);
    expect(strokesOf(lastChange(changes).text, "t")).toHaveLength(1);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(0);
    expect(inkPaths(card(host, "t"))).toHaveLength(1);
    expect(opacities(card(host, "t"))).toEqual([null]);

    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(before);
    expect(inkPaths(card(host, "t"))).toHaveLength(2);
    expect(opacities(card(host, "t"))).toEqual([null, null]);
    expect(host.querySelectorAll(".canvas-ink-board path")).toHaveLength(1);
  });

  it("una passata che non prende niente non scrive; una passata annullata rimette i tratti", () => {
    const { host, changes } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    eraser(host, viewportOf(host), [[400, 400], [420, 420]]);
    expect(changes).toHaveLength(1);

    eraser(host, viewportOf(host), [[60, 30], [60, 60]], false);
    expect(opacities(card(host, "t"))).toEqual(["0.25"]);
    document.dispatchEvent(pointerEvent("pointercancel", { ...ERASER_PEN, buttons: 0 }));
    expect(opacities(card(host, "t"))).toEqual([null]);
    expect(changes).toHaveLength(1);
  });

  it("la gomma su un livello estraneo non cancella niente", () => {
    const foreign = JSON.stringify({
      nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 200, height: 100, text: "x", "fub:ink": { v: 2, strokes: [] } }],
      edges: [],
    });
    const { host, changes } = mounted(foreign);
    eraser(host, viewportOf(host), [[0, 0], [200, 100]]);
    expect(changes).toEqual([]);
  });

  it("prende il tratto di un'immagine ridimensionata dove si vede, non dove sarebbe stirato", () => {
    const { host, changes } = mounted();
    pen(host, card(host, "img"), across(300, 0));
    host.querySelector('[data-resize="img"]')!.dispatchEvent(pointerEvent("pointerdown", { pointerId: 30, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(pointerEvent("pointermove", { pointerId: 30, pointerType: "mouse", buttons: 1, clientX: 400, clientY: 300 }));
    viewportOf(host).dispatchEvent(pointerEvent("pointerup", { pointerId: 30, pointerType: "mouse", clientX: 400, clientY: 300 }));
    const resized = (JSON.parse(lastChange(changes).text) as { nodes: Json[] }).nodes[1]!;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((key) => resized[key] as number);
    // `inkFit` di `scale` sul riferimento 200 × 100.
    const s = Math.min(w! / 200, h! / 100);
    const ox = x! + (w! - 200 * s) / 2;
    const oy = y! + (h! - 100 * s) / 2;
    expect(s).toBeGreaterThan(1.5);
    const count = changes.length;

    // Dove il tratto sarebbe senza scala (40…90, 40…55 nella scheda) non c'è niente.
    eraser(host, viewportOf(host), [[x! + 75, y! + 30], [x! + 75, y! + 60]]);
    expect(changes).toHaveLength(count);
    // Dove si vede, scalato e centrato, sì: il secondo punto (60, 50).
    eraser(host, viewportOf(host), [[ox + 60 * s, oy + 50 * s - 20], [ox + 60 * s, oy + 50 * s + 20]]);
    expect(changes).toHaveLength(count + 1);
    expect(strokesOf(lastChange(changes).text, "img")).toEqual([]);
  });

  it("D tenuto fa scrivere il mouse, D lasciato no; un tratto già giù finisce", () => {
    const { engine, host, changes } = mounted();
    const viewport = viewportOf(host);
    keyD(viewport, "keydown");
    expect(viewport.dataset.ink).toBe("pen");
    mouse(host, viewport, [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toHaveLength(1);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(1);

    // D lasciato a metà tratto: il tratto finisce e si scrive.
    mouse(host, viewport, [[100, 400], [140, 420], [180, 430], [200, 440]], () => keyD(window, "keyup"));
    expect(viewport.dataset.ink).toBeUndefined();
    expect(inkChanges(changes)).toHaveLength(2);

    mouse(host, viewport, [[100, 500], [140, 520], [180, 530]]);
    expect(inkChanges(changes)).toHaveLength(2);

    // La ripetizione del tasto non cambia niente; la finestra che perde il fuoco lo lascia.
    keyD(viewport, "keydown");
    keyD(viewport, "keydown", { repeat: true });
    expect(viewport.dataset.ink).toBe("pen");
    window.dispatchEvent(new Event("blur"));
    expect(viewport.dataset.ink).toBeUndefined();
    keyD(viewport, "keydown");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(viewport.dataset.ink).toBeUndefined();

    // L'interruttore fa lo stesso, senza D.
    engine.setInkMouse(true);
    expect(viewport.dataset.ink).toBe("pen");
    mouse(host, viewport, [[100, 600], [140, 620], [180, 630]]);
    expect(inkChanges(changes)).toHaveLength(3);
    engine.setInkMouse(false);
    expect(viewport.dataset.ink).toBeUndefined();
  });

  it("D in un campo di testo scrive la lettera e non cambia niente", () => {
    const { host, changes } = mounted();
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
    const event = new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(viewportOf(host).dataset.ink).toBeUndefined();
    // Un campo fuori dalla scheda, dentro il viewport: neanche.
    const input = document.createElement("input");
    viewportOf(host).append(input);
    keyD(input, "keydown");
    expect(viewportOf(host).dataset.ink).toBeUndefined();
    expect(inkChanges(changes)).toEqual([]);
  });

  it("D con Ctrl duplica come prima e non fa scrivere il mouse", () => {
    const { host } = mounted();
    keyD(viewportOf(host), "keydown", { ctrlKey: true });
    expect(viewportOf(host).dataset.ink).toBeUndefined();
  });
});

/** Un tratto libero scritto a mano: `count` campioni da `x0`, ogni `step`, sulla riga `y`. */
function freeStroke(id: string, x0: number, y: number, count: number, step: number): Json {
  const samples: InkSample[] = [];
  for (let i = 0; i < count; i++) samples.push({ x: x0 + i * step, y, t: i * 10, p: 0.5 });
  return {
    id,
    tool: "pen",
    at: "2026-11-09T10:00:00.000Z",
    brush: "pf1 size=2 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2",
    anchor: { kind: "free" },
    ink: encodeInk(inkFromQuantized(quantizeInk(samples, 100))),
    "x-vendor": { keep: true },
  };
}

/** Una lavagna coi tratti liberi `strokes` sulla radice. */
function boardWith(strokes: readonly Json[]): string {
  return JSON.stringify({ nodes: [], edges: [], "fub:ink": { v: 1, strokes } });
}

/** Una passata a metà, sulla lavagna di `host`: muove la gomma già giù in `world`. */
function eraserMove(host: HTMLElement, world: readonly (readonly [number, number])[]): void {
  const cam = camera(host);
  for (const [x, y] of world) {
    clock += 8;
    viewportOf(host).dispatchEvent(pointerEvent("pointermove", {
      ...ERASER_PEN, clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y, button: -1, buttons: 32, pressure: 0.5, timeStamp: clock,
    }));
  }
}

const cutPaths = (element: Element, selector: string) => [...element.querySelectorAll(`${selector} path[data-ink-cut]`)];

describe("la gomma «Solo il pezzo»", () => {
  it("con «piece» la passata sbiadisce il pezzo e alla fine taglia, un passo, anche su due livelli", () => {
    const { engine, host, changes } = mounted();
    pen(host, card(host, "t"), [[20, 50], [60, 52], [100, 54], [140, 56], [180, 58]]);
    pen(host, viewportOf(host), [[100, 300], [140, 300], [180, 300], [220, 300], [260, 300]]);
    const before = lastChange(changes).text;
    const [inCard] = strokesOf(before, "t");
    const [free] = strokesOf(before, null);

    engine.setInkEraser("piece");
    const lift = eraser(host, viewportOf(host), [[100, 20], [100, 90]], false);
    // Il tratto della nota sbiadisce e sopra restano pieni i due pezzi.
    expect(opacities(card(host, "t"))).toEqual(["0.25", null]);
    expect(cutPaths(card(host, "t"), ".canvas-ink-card")).toHaveLength(1);
    eraserMove(host, [[180, 200], [180, 280], [180, 320]]);
    expect(opacities(host, ".canvas-ink-board path")).toEqual(["0.25", null]);
    expect(changes).toHaveLength(2);
    lift();

    expect(changes).toHaveLength(3);
    const patches = lastChange(changes).operation.patches as unknown as ReadonlyArray<{ before: unknown; after: unknown }>;
    expect(patches.filter((patch) => patch.after === null)).toHaveLength(2);
    expect(patches.filter((patch) => patch.before === null)).toHaveLength(4);
    const text = lastChange(changes).text;
    const cardPieces = strokesOf(text, "t");
    const freePieces = strokesOf(text, null);
    expect(cardPieces).toHaveLength(2);
    expect(freePieces).toHaveLength(2);
    for (const piece of [...cardPieces, ...freePieces]) expect(piece.id).not.toBe(inCard!.id);
    expect(cardPieces.every((piece) => (piece.anchor as Json).kind === "card")).toBe(true);
    expect(freePieces.every((piece) => piece.color === free!.color && piece.tool === free!.tool)).toBe(true);
    // Dopo: niente sbiadito, niente anteprima, i pezzi disegnati.
    expect(opacities(card(host, "t"))).toEqual([null, null]);
    expect(cutPaths(host, ".canvas-ink-card")).toHaveLength(0);
    expect(cutPaths(host, ".canvas-ink-board")).toHaveLength(0);

    // Un passo: l'annulla ridà il testo di prima byte per byte, il ripeti i pezzi.
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(before);
    expect(inkPaths(card(host, "t"))).toHaveLength(1);
    expect(engine.redo()).toBe(true);
    expect(lastChange(changes).text).toBe(text);
  });

  it("i campi del tratto, anche sconosciuti, passano ai pezzi; un tratto coperto tutto se ne va", () => {
    const source = boardWith([freeStroke("a", 0, 0, 15, 40), freeStroke("b", 0, 100, 2, 2)]);
    const { engine, host, changes } = mounted(source);
    engine.setInkEraser("piece");
    eraser(host, viewportOf(host), [[280, -30], [280, 30], [280, 60], [1, 100], [3, 100]]);
    expect(changes).toHaveLength(1);
    const pieces = strokesOf(lastChange(changes).text, null);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      expect(Object.keys(piece)).toEqual(["id", "tool", "at", "brush", "color", "anchor", "ink", "x-vendor"]);
      expect(piece["x-vendor"]).toEqual({ keep: true });
    }
    expect(pieces[0]!.at).toBe("2026-11-09T10:00:00.000Z");
    expect(pieces[1]!.at).not.toBe("2026-11-09T10:00:00.000Z");
  });

  // Il commit di 1500 toppe nel nucleo dura qualche secondo: sotto carico più dei 5 di serie.
  it("una passata che fa mille pezzi è un commit e un passo", () => {
    const strokes: Json[] = [];
    for (let i = 0; i < 500; i++) strokes.push(freeStroke(`s${i}`, 0, i * 4, 15, 100));
    const source = boardWith(strokes);
    const { engine, host, changes, calls } = mounted(source);
    engine.setInkEraser("piece");
    const commits = calls.filter((call) => call === "commit").length;
    eraser(host, viewportOf(host), [[700, -20], [700, 2020]]);
    expect(calls.filter((call) => call === "commit").length).toBe(commits + 1);
    expect(changes).toHaveLength(1);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(1000);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(source);
    expect(engine.undo()).toBe(false);
  }, 60_000);

  it("il rifiuto del nucleo non cambia niente e lo dice; la passata annullata rimette il tratto", () => {
    const source = boardWith([freeStroke("a", 0, 0, 15, 40)]);
    const { engine, host, changes } = mounted(source);
    engine.setInkEraser("piece");
    refuseCommits = true;
    eraser(host, viewportOf(host), [[280, -30], [280, 30]]);
    expect(changes).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("canvas.ink.full"));
    expect(opacities(host, ".canvas-ink-board path")).toEqual([null]);
    refuseCommits = false;

    eraser(host, viewportOf(host), [[280, -30], [280, 30]], false);
    expect(opacities(host, ".canvas-ink-board path")).toEqual(["0.25", null]);
    document.dispatchEvent(pointerEvent("pointercancel", { ...ERASER_PEN, buttons: 0 }));
    expect(opacities(host, ".canvas-ink-board path")).toEqual([null]);
    expect(changes).toEqual([]);
  });
});

/// Lascia finire ciò che è in coda (la lettura dello stato ricordato).
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const inkMouseButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-canvas-action="ink-mouse"]')!;

describe("l'interruttore «Scrivi col mouse»", () => {
  it("sta in testa alla barra, subito dopo la penna, col nome, il suggerimento e lo stato per il lettore di schermo", () => {
    const { host } = mounted();
    const button = inkMouseButton(host);
    const bar = host.querySelector(".canvas-toolbar")!;
    expect(bar.firstElementChild).toBe(host.querySelector('[data-canvas-action="ink-pen"]'));
    expect(bar.children[1]).toBe(button);
    expect(button.textContent).toBe(t("canvas.ink.mouse"));
    expect(button.title).toBe(t("canvas.ink.mouse_hint"));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.disabled).toBe(false);
  });

  it("il pulsante accende e spegne la scrittura col mouse, e il fuoco gli resta", () => {
    const { host, changes } = mounted();
    const viewport = viewportOf(host);
    mouse(host, viewport, [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toEqual([]);

    const button = inkMouseButton(host);
    button.focus();
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(viewport.dataset.ink).toBe("pen");
    expect(document.activeElement).toBe(button);
    mouse(host, viewport, [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toHaveLength(1);
    // La barra ridisegnata dopo il tratto tiene lo stato.
    expect(inkMouseButton(host).getAttribute("aria-pressed")).toBe("true");

    inkMouseButton(host).click();
    expect(inkMouseButton(host).getAttribute("aria-pressed")).toBe("false");
    expect(viewport.dataset.ink).toBeUndefined();
    mouse(host, viewport, [[100, 400], [140, 420], [180, 430]]);
    expect(inkChanges(changes)).toHaveLength(1);
  });

  it("acceso, D tenuto e lasciato non lo spegne", () => {
    const { host, changes } = mounted();
    const viewport = viewportOf(host);
    inkMouseButton(host).click();
    keyD(viewport, "keydown");
    keyD(window, "keyup");
    window.dispatchEvent(new Event("blur"));
    expect(viewport.dataset.ink).toBe("pen");
    expect(inkMouseButton(host).getAttribute("aria-pressed")).toBe("true");
    mouse(host, viewport, [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toHaveLength(1);
  });

  it("in sola lettura è disabilitato e il mouse non scrive; tornando scrivibile scrive di nuovo", () => {
    const { engine, host, changes } = mounted();
    const viewport = viewportOf(host);
    inkMouseButton(host).click();
    engine.setReadOnly(true);
    expect(inkMouseButton(host).disabled).toBe(true);
    expect(inkMouseButton(host).getAttribute("aria-pressed")).toBe("true");
    expect(viewport.dataset.ink).toBeUndefined();
    mouse(host, viewport, [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toEqual([]);
    engine.setReadOnly(false);
    expect(inkMouseButton(host).disabled).toBe(false);
    expect(viewport.dataset.ink).toBe("pen");
  });

  it("con «Ricorda» spento, riaprendo la lavagna torna spento", async () => {
    const first = mounted();
    await settle();
    inkMouseButton(first.host).click();
    await settle();
    expect(machine.views.get("canvas.ink_mouse")).toEqual({ on: true });
    first.engine.destroy();

    const again = mounted();
    await settle();
    expect(inkMouseButton(again.host).getAttribute("aria-pressed")).toBe("false");
    expect(viewportOf(again.host).dataset.ink).toBeUndefined();
  });

  it("con «Ricorda» acceso, ogni lavagna si apre com'era l'ultima scelta", async () => {
    machine.remember = true;
    const first = mounted();
    await settle();
    expect(inkMouseButton(first.host).getAttribute("aria-pressed")).toBe("false");
    inkMouseButton(first.host).click();
    await settle();
    first.engine.destroy();

    const again = mounted();
    const other = mounted();
    await settle();
    for (const { host } of [again, other]) {
      expect(inkMouseButton(host).getAttribute("aria-pressed")).toBe("true");
      expect(viewportOf(host).dataset.ink).toBe("pen");
    }
    // Spento in una, l'altra resta com'è e la prossima che si apre parte spenta.
    inkMouseButton(again.host).click();
    await settle();
    expect(inkMouseButton(other.host).getAttribute("aria-pressed")).toBe("true");
    const third = mounted();
    await settle();
    expect(inkMouseButton(third.host).getAttribute("aria-pressed")).toBe("false");
  });

  it("l'impostazione cambiata a lavagna aperta vale dalla prossima apertura", async () => {
    machine.views.set("canvas.ink_mouse", { on: true });
    const open = mounted();
    await settle();
    expect(inkMouseButton(open.host).getAttribute("aria-pressed")).toBe("false");
    machine.remember = true;
    await settle();
    expect(inkMouseButton(open.host).getAttribute("aria-pressed")).toBe("false");
    const next = mounted();
    await settle();
    expect(inkMouseButton(next.host).getAttribute("aria-pressed")).toBe("true");
  });
});

const penButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-canvas-action="ink-pen"]')!;
const penPopover = () => document.querySelector<HTMLElement>(".canvas-pen-popover");
/** Sceglie la voce `value` del gruppo `group` nel menu aperto. */
const pick = (group: string, value: string) =>
  penPopover()!.querySelector<HTMLElement>(`[role="radio"][data-group="${group}"][data-value="${value}"]`)!.click();
/** Porta il cursore dello spessore a `value` e lo lascia. */
function slide(value: number): void {
  const slider = penPopover()!.querySelector<HTMLInputElement>(".canvas-pen-width")!;
  slider.value = String(value);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
}
const brushOf = (stroke: Json) => parseInkBrush(stroke.brush as string);

describe("il menu della penna", () => {
  it("sta in testa alla barra e dice penna, colore e spessore; di serie la Sfera blu da 4 pixel", () => {
    const { host } = mounted();
    const button = penButton(host);
    expect(host.querySelector(".canvas-toolbar")!.firstElementChild).toBe(button);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe(t("canvas.ink.pen.label", {
      name: t("canvas.ink.kind.ballpoint"), color: t("canvas.ink.color.blue"), width: t("canvas.ink.width.value", { n: "4" }),
    }));
    expect(button.textContent).toBe(t("canvas.ink.kind.ballpoint"));
  });

  it("un tratto prende penna, colore e spessore scelti", () => {
    const { host, changes } = mounted();
    penButton(host).click();
    expect(penPopover()).not.toBeNull();
    pick("kind", "fountain");
    pick("color", "#d55e00");
    slide(8);
    pen(host, card(host, "t"), across(0, 0));
    const [stroke] = strokesOf(lastChange(changes).text, "t");
    expect(stroke).toMatchObject({ tool: "pen", color: "#d55e00" });
    const brush = brushOf(stroke!);
    expect(penOf(brush)).toBe("fountain");
    expect(brush.size).toBeCloseTo(8 / camera(host).zoom, 2);
    expect(penButton(host).textContent).toBe(t("canvas.ink.kind.fountain"));
  });

  it("l'evidenziatore si salva col suo strumento e il suo colore, trasparente a metà senza multiply", () => {
    const { host, changes } = mounted();
    penButton(host).click();
    pick("tool", "highlighter");
    const lift = pen(host, card(host, "t"), across(0, 0), false);
    const wet = host.querySelector(".canvas-ink-wet path")!;
    expect(wet.getAttribute("fill")).toBe("#f0e442");
    expect(wet.getAttribute("fill-opacity")).toBe("0.5");
    lift();
    const [stroke] = strokesOf(lastChange(changes).text, "t");
    expect(stroke).toMatchObject({ tool: "highlighter", color: "#f0e442" });
    expect(penOf(brushOf(stroke!))).toBe("highlighter");
    expect(brushOf(stroke!).size).toBeCloseTo(16 / camera(host).zoom, 2);
    const [dry] = inkPaths(card(host, "t"));
    expect(dry!.getAttribute("fill-opacity")).toBe("0.5");
    expect(dry!.getAttribute("style") ?? "").not.toContain("multiply");
    expect(dry!.getAttribute("mix-blend-mode")).toBeNull();
  });

  it("la Gomma del menu: la penna toglie il tratto intero, il mouse taglia col modo scelto; il cursore è la cella", () => {
    const { engine, host, changes } = mounted();
    pen(host, viewportOf(host), [[100, 300], [140, 300], [180, 300], [220, 300], [260, 300]]);
    const written = lastChange(changes).text;
    penButton(host).click();
    pick("tool", "eraser");
    expect(penButton(host).getAttribute("aria-label")).toBe(t("canvas.ink.pen.eraser_stroke"));
    // La punta della penna cancella: il tratto intero, di serie.
    pen(host, viewportOf(host), [[180, 260], [180, 300], [180, 340]]);
    expect(strokesOf(lastChange(changes).text, null)).toEqual([]);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(written);

    // Il mouse con l'interruttore acceso: la cella, e «Solo il pezzo» taglia.
    penButton(host).click();
    pick("eraser", "piece");
    inkMouseButton(host).click();
    expect(viewportOf(host).dataset.ink).toBe("eraser");
    mouse(host, viewportOf(host), [[180, 260], [180, 300], [180, 340]]);
    const pieces = strokesOf(lastChange(changes).text, null);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => piece.color === "#0072b2")).toBe(true);

    // Il retro della penna cancella anche con la Penna scelta, col modo
    // scelto: il pezzo di sinistra si taglia in due.
    penButton(host).click();
    pick("tool", "pen");
    expect(viewportOf(host).dataset.ink).toBe("pen");
    eraser(host, viewportOf(host), [[120, 260], [120, 340]]);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(3);
  });

  it("una scelta a metà tratto vale dal tratto dopo", () => {
    const { host, changes } = mounted();
    const lift = pen(host, card(host, "t"), across(0, 0), false);
    penButton(host).click();
    pick("color", "#009e73");
    lift();
    expect(strokesOf(lastChange(changes).text, "t")[0]).toMatchObject({ color: "#0072b2" });
    pen(host, card(host, "t"), across(0, 20));
    expect(strokesOf(lastChange(changes).text, "t")[1]).toMatchObject({ color: "#009e73" });
  });

  it("riaprendo la lavagna la scelta torna; una scelta rotta o di una versione futura vale quella di serie", async () => {
    const first = mounted();
    await settle();
    penButton(first.host).click();
    pick("tool", "highlighter");
    pick("color", "#56b4e9");
    await settle();
    expect(machine.views.get("canvas.pen")).toMatchObject({ version: 1, tool: "highlighter", highlighterColor: "#56b4e9" });
    first.engine.destroy();
    expect(penPopover()).toBeNull();

    const again = mounted();
    await settle();
    expect(penButton(again.host).textContent).toBe(t("canvas.ink.tool.highlighter"));
    pen(again.host, card(again.host, "t"), across(0, 0));
    expect(strokesOf(lastChange(again.changes).text, "t")[0]).toMatchObject({ tool: "highlighter", color: "#56b4e9" });

    machine.views.set("canvas.pen", { version: 99, tool: "highlighter" });
    const future = mounted();
    await settle();
    expect(penButton(future.host).textContent).toBe(t("canvas.ink.kind.ballpoint"));
    machine.views.set("canvas.pen", "rotto");
    const broken = mounted();
    await settle();
    expect(penButton(broken.host).textContent).toBe(t("canvas.ink.kind.ballpoint"));
  });

  it("una ridisegnata non chiude il menu né cambia il pulsante; la sola lettura lo chiude e spegne il pulsante", () => {
    const { engine, host, changes } = mounted();
    const button = penButton(host);
    button.click();
    const open = penPopover();
    expect(open).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // Una modifica da fuori rifà la barra.
    const outside = JSON.parse(BOARD) as Json & { nodes: Json[] };
    outside.nodes[2]!.x = 640;
    engine.syncDoc(JSON.stringify(outside));
    expect(changes).toEqual([]);
    expect(penButton(host)).toBe(button);
    expect(host.querySelector(".canvas-toolbar")!.firstElementChild).toBe(button);
    expect(penPopover()).toBe(open);
    expect(open!.isConnected).toBe(true);

    engine.setReadOnly(true);
    expect(penPopover()).toBeNull();
    expect(button.disabled).toBe(true);
    button.click();
    expect(penPopover()).toBeNull();
    engine.setReadOnly(false);
    expect(button.disabled).toBe(false);
  });
});
