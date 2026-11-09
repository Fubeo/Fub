// @vitest-environment happy-dom
// La penna sulla lavagna (N4 T12): il tratto si scrive nel `.canvas` con un
// passo d'annulla, segue la scheda, e il ridisegno aspetta la penna.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { CanvasEngine, type CanvasChange, type CanvasCorePort } from "./engine";
import { INK_SCALE_ASPECT } from "./ink-paint";
import type { CanvasPatch } from "./operation";
import { canvasCoreReady, openCoreNow } from "./wasm/core";

// Il limite dei campioni di un pezzo, piccolo: un tratto spezzato si prova con
// qualche decina di eventi invece che con diecimila (la scia si rifà a ogni
// evento). Gli altri tratti di questo file ne hanno al più tre.
vi.mock("../../ink/sample", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ink/sample")>()),
  INK_MAX_SAMPLES: 16,
}));

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
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
