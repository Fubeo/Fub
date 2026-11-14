// @vitest-environment happy-dom
// La penna sulla lavagna (N4 T12): il tratto si scrive nel `.canvas` con un
// passo d'annulla, segue la scheda, e il ridisegno aspetta la penna. La gomma
// (T13, T22) toglie i tratti interi o ne taglia il pezzo, in un passo.
// L'interruttore «Scrivi col mouse» (T16) si ricorda nello stato di vista.
// Con «Il dito scrive» (T64) un dito scrive e due dita spostano.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import editorsSkin from "../../theme/scrittoio/skin/editors.css?raw";
import structure from "../../theme/scrittoio/structure.css?raw";
import { parseInkBrush, penOf } from "../../ink/brush";
import { quantizeInk, type InkSample } from "../../ink/sample";
import { decodeInk, encodeInk, inkFromQuantized, inkLength, inkPoint } from "../spatial/ink/codec";
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
// dietro le vere `readInkMouse` e `saveInkMouse` di `preferences.ts`. Anche
// «Il dito scrive», «Il dito sposta le schede» e lo spazio di lavoro (T64),
// con le scritture delle Impostazioni (`saved`; `refuse` le fa fallire).
const machine = vi.hoisted(() => ({
  remember: false,
  views: new Map<string, unknown>(),
  fingerWrites: false,
  fingerMovesCard: false,
  workspace: "auto",
  saved: [] as [string, unknown][],
  refuse: false,
}));

vi.mock("../../host/query", async (importOriginal) => {
  const entry = (key: string, value: unknown) => ({
    spec: {
      key,
      label: "",
      description: "",
      group: "Lavagna",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value,
    source: "machine",
  });
  return {
    ...(await importOriginal<typeof import("../../host/query")>()),
    settings: async () => [
      entry("canvas.ink_mouse_remember", machine.remember),
      entry("canvas.finger_writes", machine.fingerWrites),
      entry("canvas.finger_moves_card", machine.fingerMovesCard),
      entry("canvas.workspace", machine.workspace),
    ],
  };
});

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
      setSetting: async (key: string, value: unknown) => {
        if (machine.refuse) throw new Error("disco pieno");
        machine.saved.push([key, value]);
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
  machine.fingerWrites = false;
  machine.fingerMovesCard = false;
  machine.workspace = "auto";
  machine.saved = [];
  machine.refuse = false;
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
    createNote: vi.fn(async () => "nota.md"),
    readNote: vi.fn(async () => ""),
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
    notes: { freeName: async (_folder: string, name: string) => name, create: ports.createNote, read: ports.readNote },
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

  it("il rilascio di un tratto non rilegge il modello della lavagna: lo fa da quello che il commit ha cambiato (T20e)", () => {
    const { engine, host, changes, calls } = mounted();
    /** Il modello di una lavagna aperta da capo sul testo, con le chiavi nel loro ordine. */
    const fresh = (text: string) => {
      const core = openCoreNow(text)!;
      try {
        return JSON.stringify(core.model());
      } finally {
        core.close();
      }
    };
    const strokes: [Element, [number, number][], boolean][] = [
      // Il primo tratto della nota: il suo livello nasce dentro la scheda.
      [card(host, "t"), across(0, 0), false],
      [card(host, "t"), across(0, 10), false],
      // Il primo tratto libero fa nascere la chiave della radice: si rilegge tutto.
      [viewportOf(host), [[100, 300], [140, 320], [180, 330]], true],
      [viewportOf(host), [[100, 400], [140, 420], [180, 430]], false],
      [card(host, "doc"), across(600, 0), false],
    ];
    for (const [target, world, whole] of strokes) {
      calls.length = 0;
      pen(host, target, world);
      expect(calls.filter((name) => name === "commit")).toHaveLength(1);
      expect(calls.includes("model")).toBe(whole);
      expect(JSON.stringify(engine.doc())).toBe(fresh(lastChange(changes).text));
    }
    expect(strokesOf(lastChange(changes).text, "t")).toHaveLength(2);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(2);
    // L'annulla di un tratto passa per lo stesso commit, e il modello resta quello del testo.
    for (let k = 0; k < strokes.length; k += 1) {
      expect(engine.undo()).toBe(true);
      expect(JSON.stringify(engine.doc())).toBe(fresh(lastChange(changes).text));
    }
    expect(lastChange(changes).text).toBe(BOARD);
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

describe("la croce sul velo (T20d)", () => {
  const veilOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport > .canvas-pen-veil")!;
  const shown = (host: HTMLElement) => !veilOf(host).hasAttribute("data-idle");
  /** Il mouse che passa sopra la vista, senza tasti. */
  const hover = (host: HTMLElement, x = 50, y = 50) =>
    viewportOf(host).dispatchEvent(pointerEvent("pointermove", { ...MOUSE, clientX: x, clientY: y, button: -1, buttons: 0 }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("la croce sta su un velo sopra le schede e i fili, e solo col mouse che scrive", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const veil = veilOf(host);
    // Sopra lo stage (le schede, i fili) e sopra le prese dei fili: ciò che
    // il puntatore prende per primo. Nessun lettore di schermo lo sente.
    const children = [...viewport.children];
    expect(children.indexOf(veil)).toBeGreaterThan(children.indexOf(host.querySelector(".canvas-stage")!));
    expect(children.indexOf(veil)).toBeGreaterThan(children.indexOf(host.querySelector(".canvas-edge-handles")!));
    expect(veil.getAttribute("aria-hidden")).toBe("true");
    expect(shown(host)).toBe(false);

    // D col mouse sopra la vista: la croce sul velo; D lasciato la toglie.
    hover(host);
    expect(shown(host)).toBe(false);
    keyD(viewport, "keydown");
    expect(shown(host)).toBe(true);
    expect(veil.dataset.tool).toBe("pen");
    expect(viewport.dataset.ink).toBe("pen");
    keyD(window, "keyup");
    expect(shown(host)).toBe(false);
    expect(veil.hidden).toBe(false);

    // La penna del menu, senza D; la Gomma del menu: la cella.
    engine.setInkMouse(true);
    expect(shown(host)).toBe(true);
    openPen(engine);
    pick("tool", "eraser");
    expect(veil.dataset.tool).toBe("eraser");
    expect(viewport.dataset.ink).toBe("eraser");
    openPen(engine);
    pick("tool", "pen");
    expect(veil.dataset.tool).toBe("pen");

    // Un dito che si appoggia toglie il velo: il dito non ha cursore e tocca
    // il contenuto delle schede. Il mouse che torna lo rimette.
    viewport.dispatchEvent(pointerEvent("pointerdown", { pointerId: 40, pointerType: "touch", clientX: 900, clientY: 700, button: 0, buttons: 1 }));
    viewport.dispatchEvent(pointerEvent("pointerup", { pointerId: 40, pointerType: "touch", clientX: 900, clientY: 700, button: 0, buttons: 0 }));
    expect(shown(host)).toBe(false);
    viewport.dispatchEvent(pointerEvent("pointerover", { ...MOUSE, clientX: 50, clientY: 50, buttons: 0 }));
    expect(shown(host)).toBe(true);

    // La penna sospesa che esce dal raggio lo toglie; il mouse che esce no
    // (fuori dalla vista non conta, e ricomparire ridipinge la scheda sotto).
    viewport.dispatchEvent(pointerEvent("pointerleave", { ...MOUSE, bubbles: false, clientX: -5, clientY: 50, buttons: 0 }));
    expect(shown(host)).toBe(true);
    viewport.dispatchEvent(pointerEvent("pointerleave", { ...PEN, bubbles: false, clientX: 50, clientY: 50, buttons: 0 }));
    expect(shown(host)).toBe(false);
    viewport.dispatchEvent(pointerEvent("pointermove", { ...PEN, clientX: 50, clientY: 50, button: -1, buttons: 0 }));
    expect(shown(host)).toBe(true);
    // Spazio tenuto lo toglie (la mano).
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(shown(host)).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    expect(shown(host)).toBe(true);

    // L'interruttore spento: il velo se ne va, e la lavagna torna com'era.
    engine.setInkMouse(false);
    expect(shown(host)).toBe(false);
    expect(viewport.dataset.ink).toBeUndefined();
  });

  it("la croce è del velo: nessuna regola mette un cursore sul viewport che scrive", () => {
    // `cursor` si eredita: sul viewport ricalcolava lo stile di tutta la lavagna.
    expect(structure).not.toMatch(/\.canvas-viewport\[data-ink[^{]*\{[^}]*cursor/);
    expect(structure).toMatch(/\.canvas-pen-veil \{[^}]*cursor: crosshair;/);
    expect(structure).toMatch(/\.canvas-pen-veil\[data-idle\] \{[^}]*visibility: hidden;/);
    expect(structure).toMatch(/\.canvas-pen-veil\[data-tool="eraser"\] \{[^}]*cursor: cell;/);
  });

  it("in sola lettura il velo non c'è mai", () => {
    const { engine, host } = mounted();
    engine.setReadOnly(true);
    hover(host);
    keyD(viewportOf(host), "keydown");
    expect(shown(host)).toBe(false);
  });

  it("col velo il tratto del mouse va alla stessa scheda di prima, e dal vuoto resta libero", () => {
    const { host, changes } = mounted();
    const viewport = viewportOf(host);
    hover(host);
    keyD(viewport, "keydown");
    // Senza velo (il tratto sceso sulla scheda) e col velo: lo stesso livello.
    mouse(host, card(host, "img"), across(300, 0));
    expect(strokesOf(lastChange(changes).text, "img")).toHaveLength(1);
    mouse(host, veilOf(host), across(300, 0));
    expect(strokesOf(lastChange(changes).text, "img")).toHaveLength(2);
    // Sopra il vuoto il tratto è libero, sulla radice.
    mouse(host, veilOf(host), [[100, 400], [140, 420], [180, 430]]);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(1);
    expect(inkChanges(changes)).toHaveLength(3);
  });

  it("sotto il velo il tasto destro, il dito e il doppio clic vedono la scheda", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    hover(host);
    engine.setInkMouse(true);
    const veil = veilOf(host);
    const under = card(host, "img").querySelector(".canvas-card-body") ?? card(host, "img");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(veil);
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [veil, under, viewport] });
    try {
      // Il menu della scheda, non quello del vuoto.
      const menu = engine.contextMenu({ x: 400, y: 50 })!;
      expect(menu.target).toMatchObject({ kind: "node", ref: "img" });
      // Il dito che tocca il velo sceglie la scheda sotto (il primo tocco
      // dopo il mouse: il velo c'era ancora).
      expect(shown(host)).toBe(true);
      const base = { pointerId: 41, pointerType: "touch", isPrimary: false, width: 10, height: 10 } as const;
      clock += 1000;
      veil.dispatchEvent(pointerEvent("pointerdown", { ...base, clientX: 400, clientY: 50, button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
      clock += 16;
      veil.dispatchEvent(pointerEvent("pointerup", { ...base, clientX: 401, clientY: 50, button: 0, buttons: 0, pressure: 0, timeStamp: clock }));
      expect([...host.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((el) => el.dataset.node)).toEqual(["img"]);
      // Il doppio clic sul velo sopra una scheda non mette una scheda nuova.
      const before = engine.getDoc();
      veil.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 400, clientY: 50, detail: 2 }));
      expect(engine.getDoc()).toBe(before);
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it("una scheda in scrittura sotto il velo: il clic ci entra a penna spenta, la rotella la scorre a penna accesa", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    hover(host);
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(field).not.toBeNull();
    // A penna spenta il velo non c'è: il clic arriva al campo.
    expect(shown(host)).toBe(false);
    engine.setInkMouse(true);
    expect(shown(host)).toBe(true);
    // La rotella presa dal velo scorre il campo sotto, non la lavagna.
    const veil = veilOf(host);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(veil);
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [veil, field, viewport] });
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(field, "clientHeight", { configurable: true, value: 100 });
    field.style.overflowY = "auto";
    const scrolled = vi.fn();
    field.scrollBy = scrolled as typeof field.scrollBy;
    const cam = camera(host);
    try {
      const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40, clientX: 50, clientY: 30 });
      veil.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(scrolled).toHaveBeenCalledWith({ left: 0, top: 40 });
      expect(camera(host)).toEqual(cam);
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
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
  it("sta in testa alla barra di N4 (la penna è nella riga delle opzioni), col nome, il suggerimento e lo stato per il lettore di schermo", () => {
    const { host } = mounted();
    const button = inkMouseButton(host);
    const bar = host.querySelector(".canvas-toolbar")!;
    expect(bar.firstElementChild).toBe(button);
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
/**
 * Apre il menu della penna come Ctrl+/ o la riga delle opzioni (T50): il
 * comando `canvas.pen_menu` sceglie lo strumento della penna di adesso, se
 * serve (la riga mostra il pulsante solo con Penna, Evidenziatore e Gomma), e
 * apre il rialzo; un rialzo già aperto resta.
 */
const openPen = (engine: CanvasEngine) => engine.commands().find((command) => command.id === "canvas.pen_menu")!.run();
/** Il pulsante della penna in vista nella riga: lo strumento della penna, il rialzo chiuso. */
function shownPenButton(engine: CanvasEngine, host: HTMLElement): HTMLButtonElement {
  openPen(engine);
  const button = penButton(host);
  button.click();
  return button;
}
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
  it("sta nella riga delle opzioni con la Penna e dice penna, colore e spessore; di serie la Sfera blu da 4 pixel", () => {
    const { engine, host } = mounted();
    // Con la Selezione la riga non ha la penna; con la Penna sì.
    expect(penButton(host)).toBeNull();
    const button = shownPenButton(engine, host);
    expect(host.querySelector('.canvas-options [data-option="pen"] .canvas-group')!.firstElementChild).toBe(button);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe(t("canvas.ink.pen.label", {
      name: t("canvas.ink.kind.ballpoint"), color: t("canvas.ink.color.blue"), width: t("canvas.ink.width.value", { n: "4" }),
    }));
    expect(button.textContent).toBe(t("canvas.ink.kind.ballpoint"));
  });

  it("un tratto prende penna, colore e spessore scelti", () => {
    const { engine, host, changes } = mounted();
    openPen(engine);
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
    const { engine, host, changes } = mounted();
    openPen(engine);
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
    openPen(engine);
    pick("tool", "eraser");
    expect(penButton(host).getAttribute("aria-label")).toBe(t("canvas.ink.pen.eraser_stroke"));
    // La punta della penna cancella: il tratto intero, di serie.
    pen(host, viewportOf(host), [[180, 260], [180, 300], [180, 340]]);
    expect(strokesOf(lastChange(changes).text, null)).toEqual([]);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(written);

    // Il mouse con l'interruttore acceso (la Gomma scelta dalla riga delle
    // opzioni lo accende già, T50): la cella, e «Solo il pezzo» taglia.
    openPen(engine);
    pick("eraser", "piece");
    expect(inkMouseButton(host).getAttribute("aria-pressed")).toBe("true");
    expect(viewportOf(host).dataset.ink).toBe("eraser");
    mouse(host, viewportOf(host), [[180, 260], [180, 300], [180, 340]]);
    const pieces = strokesOf(lastChange(changes).text, null);
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => piece.color === "#0072b2")).toBe(true);

    // Il retro della penna cancella anche con la Penna scelta, col modo
    // scelto: il pezzo di sinistra si taglia in due.
    openPen(engine);
    pick("tool", "pen");
    expect(viewportOf(host).dataset.ink).toBe("pen");
    eraser(host, viewportOf(host), [[120, 260], [120, 340]]);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(3);
  });

  it("una scelta a metà tratto vale dal tratto dopo", () => {
    const { engine, host, changes } = mounted();
    const lift = pen(host, card(host, "t"), across(0, 0), false);
    openPen(engine);
    pick("color", "#009e73");
    lift();
    expect(strokesOf(lastChange(changes).text, "t")[0]).toMatchObject({ color: "#0072b2" });
    pen(host, card(host, "t"), across(0, 20));
    expect(strokesOf(lastChange(changes).text, "t")[1]).toMatchObject({ color: "#009e73" });
  });

  it("riaprendo la lavagna la scelta torna; una scelta rotta o di una versione futura vale quella di serie", async () => {
    const first = mounted();
    await settle();
    openPen(first.engine);
    pick("tool", "highlighter");
    pick("color", "#56b4e9");
    await settle();
    expect(machine.views.get("canvas.pen")).toMatchObject({ version: 1, tool: "highlighter", highlighterColor: "#56b4e9" });
    first.engine.destroy();
    expect(penPopover()).toBeNull();

    const again = mounted();
    await settle();
    expect(shownPenButton(again.engine, again.host).textContent).toBe(t("canvas.ink.tool.highlighter"));
    pen(again.host, card(again.host, "t"), across(0, 0));
    expect(strokesOf(lastChange(again.changes).text, "t")[0]).toMatchObject({ tool: "highlighter", color: "#56b4e9" });

    machine.views.set("canvas.pen", { version: 99, tool: "highlighter" });
    const future = mounted();
    await settle();
    expect(shownPenButton(future.engine, future.host).textContent).toBe(t("canvas.ink.kind.ballpoint"));
    machine.views.set("canvas.pen", "rotto");
    const broken = mounted();
    await settle();
    expect(shownPenButton(broken.engine, broken.host).textContent).toBe(t("canvas.ink.kind.ballpoint"));
  });

  it("una ridisegnata non chiude il menu né cambia il pulsante; la sola lettura lo chiude e spegne il pulsante", () => {
    const { engine, host, changes } = mounted();
    const button = shownPenButton(engine, host);
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
    expect(host.querySelector(".canvas-options")!.contains(button)).toBe(true);
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

/** La penna giù su `target` nel punto `world`: dà chi la muove e chi la alza. */
function penDown(host: HTMLElement, target: Element, world: readonly [number, number], init: PointerEventInit = {}) {
  const cam = camera(host);
  const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
  let last = world;
  target.dispatchEvent(pointerEvent("pointerdown", { ...PEN, ...at(world), ...init, button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
  return {
    move(point: readonly [number, number], more: PointerEventInit = {}) {
      clock += 8;
      last = point;
      target.dispatchEvent(pointerEvent("pointermove", { ...PEN, ...at(point), ...init, ...more, button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
    },
    lift() {
      clock += 4;
      document.dispatchEvent(pointerEvent("pointerup", { ...PEN, ...at(last), ...init, button: 0, buttons: 0, pressure: 0, timeStamp: clock }));
      clock += 100;
    },
  };
}

describe("la scheda tiene l'aspetto del passaggio sotto il velo e il tratto (T20f)", () => {
  const veilOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport > .canvas-pen-veil")!;
  const held = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>(".canvas-node[data-hover-held]")].map((el) => el.dataset.node);
  /** Il puntatore che passa su `target` (un confine: il browser manda `pointerover`). */
  const over = (target: Element, kind: typeof MOUSE | typeof PEN = MOUSE) =>
    target.dispatchEvent(pointerEvent("pointerover", { ...kind, clientX: 50, clientY: 50, button: -1, buttons: 0 }));
  const inside = (host: HTMLElement, id: string) => card(host, id).firstElementChild ?? card(host, id);

  it("il velo che compare sopra la scheda: la scheda tiene il passaggio finché il puntatore non passa davvero altrove", () => {
    const { host } = mounted();
    const viewport = viewportOf(host);
    over(inside(host, "t"));
    // Il passaggio vero: niente da tenere.
    expect(held(host)).toEqual([]);
    keyD(viewport, "keydown");
    over(veilOf(host));
    expect(held(host)).toEqual(["t"]);
    // Un tratto sulla stessa scheda: la cattura porta il passaggio alla vista, e non conta.
    const cam = camera(host);
    veilOf(host).dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, clientX: 40 * cam.zoom + cam.x, clientY: 40 * cam.zoom + cam.y, button: 0, buttons: 1, timeStamp: clock }));
    over(viewport);
    expect(held(host)).toEqual(["t"]);
    clock += 8;
    veilOf(host).dispatchEvent(pointerEvent("pointermove", { ...MOUSE, clientX: 90 * cam.zoom + cam.x, clientY: 55 * cam.zoom + cam.y, button: -1, buttons: 1, timeStamp: clock }));
    clock += 4;
    document.dispatchEvent(pointerEvent("pointerup", { ...MOUSE, clientX: 90 * cam.zoom + cam.x, clientY: 55 * cam.zoom + cam.y, button: 0, buttons: 0, timeStamp: clock }));
    clock += 100;
    expect(held(host)).toEqual(["t"]);
    // Rilasciata la cattura il passaggio torna al velo: sempre la stessa scheda.
    over(veilOf(host));
    expect(held(host)).toEqual(["t"]);
    // D lasciato, il puntatore di nuovo sulla scheda: il passaggio vero la riprende.
    keyD(window, "keyup");
    over(inside(host, "t"));
    expect(held(host)).toEqual([]);
    // Sul vuoto e fuori dalla vista: nessuna scheda.
    keyD(viewport, "keydown");
    over(veilOf(host));
    expect(held(host)).toEqual(["t"]);
    viewport.dispatchEvent(pointerEvent("pointerleave", { ...MOUSE, bubbles: false, clientX: -5, clientY: 50, buttons: 0 }));
    expect(held(host)).toEqual([]);
    keyD(window, "keyup");
    over(viewport);
    over(veilOf(host));
    expect(held(host)).toEqual([]);
  });

  it("sotto il velo un tratto su un'altra scheda lascia la scheda tenuta all'alzata", () => {
    const { host, changes } = mounted();
    over(inside(host, "t"));
    keyD(viewportOf(host), "keydown");
    over(veilOf(host));
    expect(held(host)).toEqual(["t"]);
    // Il puntatore è andato sull'immagine sotto il velo, senza `pointerover`.
    mouse(host, veilOf(host), across(300, 0));
    expect(strokesOf(lastChange(changes).text, "img")).toHaveLength(1);
    expect(held(host)).toEqual([]);
  });

  it("la penna: la scheda sotto la punta tiene il passaggio per tutto il tratto, e lo lascia al passaggio vero o fuori", () => {
    const { host, changes } = mounted();
    const viewport = viewportOf(host);
    over(inside(host, "t"), PEN);
    expect(held(host)).toEqual([]);
    const stroke = penDown(host, card(host, "t"), [40, 40]);
    expect(held(host)).toEqual(["t"]);
    // La cattura sulla vista: il passaggio va alla vista, la scheda resta com'era.
    over(viewport, PEN);
    stroke.move([60, 50]);
    stroke.move([90, 55]);
    expect(held(host)).toEqual(["t"]);
    stroke.lift();
    expect(strokesOf(lastChange(changes).text, "t")).toHaveLength(1);
    expect(held(host)).toEqual(["t"]);
    // La penna sospesa di nuovo sulla scheda: il passaggio vero.
    over(inside(host, "t"), PEN);
    expect(held(host)).toEqual([]);
    // Un altro tratto, poi la penna che esce dal raggio.
    penDown(host, card(host, "t"), [40, 60]).lift();
    expect(held(host)).toEqual(["t"]);
    viewport.dispatchEvent(pointerEvent("pointerleave", { ...PEN, bubbles: false, clientX: 50, clientY: 50, buttons: 0 }));
    expect(held(host)).toEqual([]);
  });

  it("ogni regola della pelle che mostra qualcosa al passaggio sulla scheda vale anche con `data-hover-held`", () => {
    const skin = editorsSkin;
    const rules = [...skin.matchAll(/([^{}]+)\{[^}]*\}/g)].map(([, selectors]) => selectors!.split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()));
    // La scheda (`canvas-node`, `canvas-node-file`…), non una sua parte col
    // proprio passaggio (`canvas-node-twins`, T22).
    const hovering = rules.flat().filter((selector) => /^\.canvas-node(?:-(?:text|file|link|group))?(\[[^\]]+\])*:hover/.test(selector));
    expect(hovering.length).toBeGreaterThanOrEqual(3);
    for (const selector of hovering) {
      const twin = selector.replace(":hover", "[data-hover-held]");
      expect(rules.some((list) => list.includes(selector) && list.includes(twin)), twin).toBe(true);
    }
  });
});

describe("a chi appartiene il tratto (T69)", () => {
  const label = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-ink-label:not([data-idle])");
  /** Le schede col bordo tratteggiato: il contenitore dei lati sullo stage dice di chi è. */
  const targets = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>(".canvas-stage > .canvas-ink-frames:not([data-idle])")].map((el) => el.dataset.node);
  const said = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-ink-said")?.textContent ?? null;
  /** Il livello che tiene l'ultimo tratto scritto: l'id della scheda, o `null` per la radice. */
  function layerOfLast(changes: readonly CanvasChange[]): string | null {
    const [patch] = lastChange(changes).operation.patches as readonly { layer: "board" | { node: string } }[];
    return patch!.layer === "board" ? null : patch!.layer.node;
  }

  it("sopra una scheda: bordo tratteggiato ed etichetta col nome mentre si scrive; all'alzata il tratto è suo e l'etichetta se ne va", () => {
    const { host, changes } = mounted();
    const stroke = penDown(host, card(host, "img"), [340, 40]);
    // Un appoggio senza movimento non mostra niente.
    expect(label(host)).toBeNull();
    stroke.move([360, 50]);
    stroke.move([390, 55]);
    expect(label(host)?.textContent).toBe(t("canvas.ink.attach", { name: "foto.heic" }));
    expect(label(host)?.hasAttribute("data-free")).toBe(false);
    // Il lettore di schermo non la sente mentre cambia.
    expect(label(host)?.getAttribute("aria-hidden")).toBe("true");
    expect(said(host)).toBeNull();
    expect(targets(host)).toEqual(["img"]);
    // Quattro lati attorno al riquadro della scheda, in unità della lavagna;
    // la scheda stessa non cambia (niente contorno da ridipingere).
    const frames = host.querySelector<HTMLElement>(".canvas-stage > .canvas-ink-frames")!;
    const sides = [...frames.querySelectorAll<HTMLElement>(".canvas-ink-frame")];
    expect(sides.map((side) => side.dataset.side)).toEqual(["top", "right", "bottom", "left"]);
    // I lati ereditano la misura dal contenitore.
    expect(["x", "y", "w", "h"].map((key) => frames.style.getPropertyValue(`--canvas-frame-${key}`))).toEqual(["300px", "0px", "200px", "100px"]);
    expect(card(host, "img").hasAttribute("data-ink-target")).toBe(false);
    // L'etichetta sta nella vista, accanto alla punta.
    expect(label(host)!.parentElement).toBe(viewportOf(host));
    const cam = camera(host);
    expect(label(host)!.style.getPropertyValue("--canvas-ink-x")).toBe(`${390 * cam.zoom + cam.x}px`);

    stroke.lift();
    expect(changes).toHaveLength(1);
    expect(layerOfLast(changes)).toBe("img");
    expect(label(host)).toBeNull();
    expect(targets(host)).toEqual([]);
    // All'alzata l'ancora si annuncia, con le parole dell'etichetta.
    expect(said(host)).toBe(t("canvas.ink.attach", { name: "foto.heic" }));
  });

  it("una scheda di testo col titolo in grassetto: l'etichetta e l'annuncio dicono «Idee», non i segni", () => {
    const { host, changes } = mounted(JSON.stringify({
      nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 200, height: 100, text: "# **Idee**" }],
      edges: [],
    }));
    const stroke = penDown(host, card(host, "t"), [120, 40]);
    stroke.move([150, 50]);
    expect(label(host)?.textContent).toBe(t("canvas.ink.attach", { name: "Idee" }));
    stroke.lift();
    expect(changes).toHaveLength(1);
    expect(said(host)).toBe(t("canvas.ink.attach", { name: "Idee" }));
  });

  it("un tratto che passa da una scheda a due: l'etichetta segue la regola, e l'alzata scrive ciò che diceva", () => {
    const { host, changes } = mounted();
    const stroke = penDown(host, card(host, "t"), [120, 40]);
    stroke.move([150, 50]);
    expect(label(host)?.textContent).toBe(t("canvas.ink.attach", { name: "nota" }));
    expect(targets(host)).toEqual(["t"]);
    // A cavallo della nota e dell'immagine: nessuna delle due ne ha metà.
    stroke.move([250, 50]);
    stroke.move([350, 50]);
    expect(label(host)?.textContent).toBe(t("canvas.ink.free"));
    expect(label(host)?.hasAttribute("data-free")).toBe(true);
    expect(targets(host)).toEqual([]);

    stroke.lift();
    expect(layerOfLast(changes)).toBeNull();
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(1);
    expect(said(host)).toBe(t("canvas.ink.free"));
  });

  it("con Alt tenuto il tratto resta libero, anche sopra una scheda e a punta ferma; lasciato Alt, il prossimo si attacca", () => {
    const { host, changes } = mounted();
    const points = across(0, 0);
    const stroke = penDown(host, card(host, "t"), points[0]!);
    stroke.move(points[1]!);
    expect(targets(host)).toEqual(["t"]);
    // Alt preso a punta ferma: l'etichetta lo dice subito.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    expect(label(host)?.textContent).toBe(t("canvas.ink.free"));
    expect(targets(host)).toEqual([]);
    stroke.move(points[2]!, { altKey: true });
    expect(label(host)?.textContent).toBe(t("canvas.ink.free"));
    stroke.lift();
    expect(layerOfLast(changes)).toBeNull();
    expect(strokesOf(lastChange(changes).text, "t")).toEqual([]);

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    pen(host, card(host, "t"), points);
    expect(layerOfLast(changes)).toBe("t");
    expect(said(host)).toBe(t("canvas.ink.attach", { name: "nota" }));
  });

  it("Alt lasciato a metà tratto riattacca il tratto alla scheda, come dice l'etichetta", () => {
    const { host, changes } = mounted();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    const stroke = penDown(host, card(host, "doc"), [640, 40], { altKey: true });
    stroke.move([660, 50], { altKey: true });
    expect(label(host)?.textContent).toBe(t("canvas.ink.free"));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(label(host)?.textContent).toBe(t("canvas.ink.attach", { name: "carta.pdf" }));
    expect(targets(host)).toEqual(["doc"]);
    stroke.lift();
    expect(layerOfLast(changes)).toBe("doc");
  });

  it("dentro il riquadro già visto la regola non si rifà: nessun lavoro in più per movimento", () => {
    const { host, calls } = mounted();
    const stroke = penDown(host, card(host, "t"), [20, 20]);
    stroke.move([120, 80]);
    const asked = calls.filter((name) => name === "inkLayers").length;
    const text = label(host)!.firstChild;
    for (const point of [[60, 40], [100, 60], [40, 70], [110, 30]] as const) stroke.move(point);
    expect(calls.filter((name) => name === "inkLayers").length).toBe(asked);
    // Lo stesso nodo di testo: l'etichetta non si è riscritta.
    expect(label(host)!.firstChild).toBe(text);
    stroke.lift();
  });

  it("bordo ed etichetta si mostrano e si tolgono senza toccare `hidden`, che le regole `:has()` della shell leggono (T20c)", () => {
    const { host } = mounted();
    const observer = new MutationObserver(() => {});
    observer.observe(host, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    const marked = (record: MutationRecord) =>
      record.target instanceof Element && record.target.closest(".canvas-ink-frames, .canvas-ink-label") !== null;
    // Una scheda, poi a cavallo di due (libero), poi un'altra scheda; poi un tratto fuori da tutte.
    const first = penDown(host, card(host, "t"), [120, 40]);
    first.move([150, 50]);
    expect(targets(host)).toEqual(["t"]);
    first.move([250, 50]);
    first.move([350, 50]);
    expect(targets(host)).toEqual([]);
    first.lift();
    const second = penDown(host, card(host, "img"), [340, 40]);
    second.move([360, 50]);
    expect(targets(host)).toEqual(["img"]);
    second.lift();
    const third = penDown(host, viewportOf(host), [120, 400]);
    third.move([140, 420]);
    expect(targets(host)).toEqual([]);
    expect(label(host)?.textContent).toBe(t("canvas.ink.free"));
    third.lift();
    const frames = host.querySelector<HTMLElement>(".canvas-stage > .canvas-ink-frames")!;
    expect(frames.hasAttribute("hidden")).toBe(false);
    expect(frames.hasAttribute("data-idle")).toBe(true);
    expect(observer.takeRecords().filter(marked)).toEqual([]);
    observer.disconnect();
  });

  it("un tratto sulla scheda del tratto prima cambia solo `data-idle` del bordo: niente misure riscritte (T20f)", () => {
    const { host } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    const frames = host.querySelector<HTMLElement>(".canvas-stage > .canvas-ink-frames")!;
    const observer = new MutationObserver(() => {});
    observer.observe(frames, { subtree: true, attributes: true, childList: true });
    const written = () => observer.takeRecords().map((record) => `${record.type}:${record.attributeName ?? ""}`);
    // La stessa scheda: il bordo si mostra e si nasconde, nient'altro.
    const again = penDown(host, card(host, "t"), [120, 40]);
    again.move([150, 50]);
    expect(targets(host)).toEqual(["t"]);
    again.lift();
    expect(written()).toEqual(["attributes:data-idle", "attributes:data-idle"]);
    // Un'altra scheda: la scheda e le misure nuove, una volta.
    const other = penDown(host, card(host, "img"), [340, 40]);
    other.move([360, 50]);
    other.move([390, 55]);
    expect(targets(host)).toEqual(["img"]);
    expect(written()).toEqual(["attributes:data-node", "attributes:style", "attributes:data-idle"]);
    expect(["x", "y", "w", "h"].map((key) => frames.style.getPropertyValue(`--canvas-frame-${key}`))).toEqual(["300px", "0px", "200px", "100px"]);
    other.lift();
    observer.disconnect();
  });

  it("il bordo è uno strato suo sopra le schede, portato con `transform` e mostrato con l'opacità (T20f)", () => {
    const rule = (selector: string) => {
      const match = new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, "\\$&")} \\{([^}]*)\\}`).exec(structure);
      if (!match) throw new Error(`manca la regola ${selector}`);
      return match[1]!;
    };
    const frames = rule(".canvas-ink-frames");
    expect(frames).toMatch(/will-change: opacity;/);
    // `will-change: transform` fermerebbe lo strato alla scala di quando nasce: lati sfocati allo zoom nuovo.
    expect(frames).not.toMatch(/will-change: transform/);
    expect(frames).toMatch(/transform: translate\(var\(--canvas-frame-x, 0px\), var\(--canvas-frame-y, 0px\)\);/);
    expect(rule(".canvas-ink-frames[data-idle]")).toMatch(/^\s*opacity: 0;\s*$/);
    // Sopra ogni scheda: una scheda dipinta dopo lo coprirebbe e chiederebbe uno strato anche lei.
    const above = Number(/z-index: (\d+);/.exec(frames)?.[1]);
    const cards = [...structure.matchAll(/(?:^|\n)([^{}\n]*\.canvas-node[^{}]*)\{([^}]*)\}/g)]
      .map(([, , body]) => /z-index: (-?\d+);/.exec(body!)?.[1])
      .filter((z): z is string => z !== undefined)
      .map(Number);
    expect(cards.length).toBeGreaterThan(0);
    expect(Math.max(...cards)).toBeLessThan(above);
  });

  it("nessuna regola `:has()` dei fogli di stile legge `data-idle`: mostrare il bordo non ricalcola la shell (T20c)", () => {
    const sheets = import.meta.glob<string>("../../**/*.css", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(sheets).length).toBeGreaterThan(10);
    const reading: string[] = [];
    for (const [path, css] of Object.entries(sheets)) {
      for (let at = css.indexOf(":has("); at >= 0; at = css.indexOf(":has(", at + 1)) {
        // L'argomento fino alla parentesi che chiude la sua.
        let depth = 0;
        let end = at + 4;
        for (; end < css.length; end++) {
          if (css[end] === "(") depth++;
          else if (css[end] === ")" && --depth === 0) break;
        }
        const argument = css.slice(at, end + 1);
        if (argument.includes("data-idle")) reading.push(`${path}: ${argument}`);
      }
    }
    expect(reading).toEqual([]);
  });

  it("l'etichetta si misura dopo il layout e resta la stessa da un tratto all'altro; vicino al bordo destro va a sinistra", () => {
    let measured: (() => void) | null = null;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) {
        measured = callback;
      }
      observe(): void {}
      disconnect(): void {}
    });
    try {
      const { host } = mounted();
      const viewport = viewportOf(host);
      viewport.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
      const cam = camera(host);
      // Un punto della lavagna a `screen` px dal bordo sinistro della vista.
      const atScreen = (screen: number): [number, number] => [(screen - cam.x) / cam.zoom, (300 - cam.y) / cam.zoom];
      const first = penDown(host, viewport, atScreen(380));
      first.move(atScreen(400));
      const node = label(host)!;
      Object.defineProperty(node, "offsetWidth", { configurable: true, value: 200 });
      Object.defineProperty(node, "offsetHeight", { configurable: true, value: 30 });
      // Prima della misura nessuna lettura del layout: niente da girare.
      expect(node.hasAttribute("data-flip-x")).toBe(false);
      measured!();
      expect(node.hasAttribute("data-flip-x")).toBe(false);
      first.move(atScreen(700));
      expect(node.hasAttribute("data-flip-x")).toBe(true);
      first.lift();
      expect(label(host)).toBeNull();

      const second = penDown(host, viewport, atScreen(100));
      second.move(atScreen(120));
      expect(label(host)).toBe(node);
      expect(node.hasAttribute("data-flip-x")).toBe(false);
      expect(host.querySelectorAll(".canvas-ink-label")).toHaveLength(1);
      expect(host.querySelectorAll(".canvas-ink-frames")).toHaveLength(1);
      second.lift();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("la finestra che perde il fuoco chiude il tratto e lo salva: etichetta e bordo vanno via, la gomma non ha etichetta", () => {
    const { host, changes } = mounted();
    const stroke = penDown(host, card(host, "t"), [20, 20]);
    stroke.move([60, 40]);
    expect(label(host)).not.toBeNull();
    window.dispatchEvent(new Event("blur"));
    expect(label(host)).toBeNull();
    expect(targets(host)).toEqual([]);
    // Chiuso come un rilascio all'ultimo punto: il tratto si scrive (N6 T20a).
    expect(inkChanges(changes)).toHaveLength(1);

    pen(host, card(host, "t"), across(0, 0));
    const lift = eraser(host, viewportOf(host), [[60, 5], [60, 30], [60, 45]], false);
    expect(label(host)).toBeNull();
    expect(targets(host)).toEqual([]);
    lift();
  });

  it("il pointercancel annulla il tratto della penna: etichetta e bordo vanno via, e non si scrive niente", () => {
    const { host, changes } = mounted();
    const stroke = penDown(host, card(host, "t"), [20, 20]);
    stroke.move([60, 40]);
    expect(label(host)).not.toBeNull();
    viewportOf(host).dispatchEvent(pointerEvent("pointercancel", { ...PEN, timeStamp: clock }));
    expect(label(host)).toBeNull();
    expect(targets(host)).toEqual([]);
    expect(changes).toEqual([]);
    expect(said(host)).toBeNull();
  });
});

describe("il lazo sceglie e sposta l'inchiostro (T86)", () => {
  /** Il mouse sui punti `world` della lavagna: giù, i movimenti e su, tutti sulla vista. */
  function drag(host: HTMLElement, world: readonly (readonly [number, number])[], init: PointerEventInit = {}): void {
    const cam = camera(host);
    const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
    const viewport = viewportOf(host);
    viewport.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, ...init, ...at(world[0]!), button: 0, buttons: 1 }));
    for (const point of world.slice(1)) {
      viewport.dispatchEvent(pointerEvent("pointermove", { ...MOUSE, ...init, ...at(point), button: -1, buttons: 1 }));
    }
    viewport.dispatchEvent(pointerEvent("pointerup", { ...MOUSE, ...init, ...at(world[world.length - 1]!), button: 0, buttons: 0 }));
  }

  /** Un giro rettangolare attorno al riquadro dato, in coordinate della lavagna. */
  function loop(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]];
  }

  const lasso = (engine: CanvasEngine) => engine.commands().find((command) => command.id === "canvas.tool.lasso")!.run();
  const chosen = (host: HTMLElement) => host.querySelectorAll(".canvas-stage > .canvas-lasso .canvas-lasso-chosen path").length;
  const notice = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-removal")?.textContent ?? null;
  const action = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`[data-canvas-action="${name}"]`);

  /** Due tratti liberi sotto le schede: il primo da x 100, il secondo da x 400. */
  function twoFree() {
    const mount = mounted();
    pen(mount.host, viewportOf(mount.host), [[100, 300], [140, 320], [180, 330]]);
    pen(mount.host, viewportOf(mount.host), [[400, 300], [440, 320], [480, 330]]);
    expect(strokesOf(lastChange(mount.changes).text, null)).toHaveLength(2);
    lasso(mount.engine);
    return mount;
  }

  it("il giro sceglie i tratti tutti dentro e lascia quelli fuori; Maiusc aggiunge, un clic nel vuoto toglie", () => {
    const { host, engine } = twoFree();
    expect(engine.tool).toBe("lasso");
    drag(host, loop(80, 280, 200, 350));
    expect(chosen(host)).toBe(1);
    // Il secondo tratto è solo per metà nel giro: non si sceglie.
    drag(host, loop(380, 280, 450, 350), { shiftKey: true });
    expect(chosen(host)).toBe(1);
    drag(host, loop(380, 280, 500, 350), { shiftKey: true });
    expect(chosen(host)).toBe(2);
    drag(host, [[700, 600], [700, 600]]);
    expect(chosen(host)).toBe(0);
  });

  it("i tratti lasciati su un'altra scheda passano a lei in un passo, con «Ora fa parte di» e i suoi due pulsanti", () => {
    const { host, changes, engine } = twoFree();
    const before = lastChange(changes).text;
    const other = strokesOf(before, null)[1]!;
    drag(host, loop(80, 280, 200, 350));
    const count = changes.length;
    // Sopra la nota mentre si trascina: si accende come per la penna.
    const cam = camera(host);
    const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
    const viewport = viewportOf(host);
    viewport.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, ...at([140, 320]), button: 0, buttons: 1 }));
    viewport.dispatchEvent(pointerEvent("pointermove", { ...MOUSE, ...at([110, 180]), button: -1, buttons: 1 }));
    viewport.dispatchEvent(pointerEvent("pointermove", { ...MOUSE, ...at([80, 50]), button: -1, buttons: 1 }));
    expect([...host.querySelectorAll<HTMLElement>(".canvas-stage > .canvas-ink-frames:not([data-idle])")].map((el) => el.dataset.node)).toEqual(["t"]);
    expect(host.querySelector(".canvas-ink-label:not([data-idle])")?.textContent).toBe(t("canvas.ink.attach", { name: "nota" }));
    viewport.dispatchEvent(pointerEvent("pointerup", { ...MOUSE, ...at([80, 50]), button: 0, buttons: 0 }));

    expect(changes).toHaveLength(count + 1);
    const moved = lastChange(changes).text;
    expect(lastChange(changes).operation.patches.map((patch) => patch.kind)).toEqual(["ink", "ink"]);
    const [kept] = strokesOf(moved, null);
    // Il tratto non toccato resta identico.
    expect(kept).toEqual(other);
    const [passed] = strokesOf(moved, "t");
    expect(passed).toMatchObject({ anchor: { kind: "card", width: 200, height: 100 } });
    expect(inkPaths(card(host, "t"))).toHaveLength(1);
    expect(host.querySelectorAll(".canvas-ink-board path")).toHaveLength(1);
    // I tratti restano scelti dove sono andati.
    expect(chosen(host)).toBe(1);
    expect(notice(host)).toBe(t("canvas.ink.moved_to", { name: "nota" }));
    expect(action(host, "undo-removal")?.textContent).toBe(t("app.undo"));
    expect(action(host, "free-ink")?.textContent).toBe(t("canvas.ink.make_free"));
    expect(host.querySelectorAll(".canvas-stage > .canvas-ink-frames:not([data-idle])")).toHaveLength(0);

    // «Annulla» riporta il testo di prima, byte per byte.
    action(host, "undo-removal")!.click();
    expect(lastChange(changes).text).toBe(before);
    expect(notice(host)).toBeNull();
    expect(engine.redo()).toBe(true);
    expect(lastChange(changes).text).toBe(moved);
  });

  it("«Rendilo libero» riporta i tratti sulla radice dove si vedono, in un passo suo", () => {
    const { host, changes, engine } = twoFree();
    drag(host, loop(80, 280, 200, 350));
    drag(host, [[140, 320], [110, 180], [80, 50]]);
    const moved = lastChange(changes).text;
    expect(strokesOf(moved, "t")).toHaveLength(1);
    action(host, "free-ink")!.click();
    const freed = lastChange(changes).text;
    expect(strokesOf(freed, "t")).toEqual([]);
    const free = strokesOf(freed, null);
    expect(free).toHaveLength(2);
    const freeAnchor: Json = (free[1]!.anchor as Json | undefined) ?? { kind: "free" };
    expect(freeAnchor).toEqual({ kind: "free" });
    expect(notice(host)).toBeNull();
    expect(chosen(host)).toBe(1);
    // Il tratto è dove era sulla nota: spostato di (-60, -270) dal suo posto
    // di partenza; cambia solo il primo campione, la forma resta quella.
    const start = strokesOf(lastChange(changes.slice(0, 2)).text, null)[0]!;
    const samples = (ink: unknown) => String(ink).split(" ").slice(3);
    const [first, ...rest] = samples(start.ink);
    const [x, y, ...tail] = first!.split(",").map(Number);
    expect(samples(free[1]!.ink)).toEqual([[x! - 6000, y! - 27000, ...tail].join(","), ...rest]);
    expect(free[1]).toMatchObject({ color: start.color, tool: start.tool, brush: start.brush });
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(moved);
  });

  it("colore e spessore dalla barra della selezione: un annulla ciascuno, gli altri tratti identici", () => {
    const { host, changes, engine } = twoFree();
    const before = lastChange(changes).text;
    const [, other] = strokesOf(before, null);
    drag(host, loop(80, 280, 200, 350));
    const bar = host.querySelector<HTMLElement>(".canvas-selection-bar")!;
    expect(bar.hidden).toBe(false);
    const colorButton = bar.querySelector<HTMLButtonElement>('[data-command="canvas.stroke_color"]')!;
    const widthButton = bar.querySelector<HTMLButtonElement>('[data-command="canvas.stroke_width"]')!;
    expect(colorButton.hidden).toBe(false);
    expect(widthButton.hidden).toBe(false);
    // Solo tratti: niente comandi delle schede.
    expect(bar.querySelector<HTMLButtonElement>('[data-command="canvas.delete"]')!.hidden).toBe(true);

    colorButton.click();
    document.querySelector<HTMLButtonElement>('.canvas-stroke-popover .canvas-pen-swatch[data-value="#d55e00"]')!.click();
    const colored = lastChange(changes).text;
    expect(changes.length).toBe(3);
    expect(strokesOf(colored, null)[0]).toMatchObject({ color: "#d55e00" });
    expect(strokesOf(colored, null)[1]).toEqual(other);

    host.querySelector<HTMLButtonElement>('.canvas-selection-bar [data-command="canvas.stroke_width"]')!.click();
    const slider = document.querySelector<HTMLInputElement>(".canvas-stroke-popover .canvas-pen-width")!;
    slider.value = "12";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(changes.length).toBe(3);
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes.length).toBe(4);
    const widened = lastChange(changes).text;
    const brush = parseInkBrush(strokesOf(widened, null)[0]!.brush as string);
    expect(brush.size).toBeCloseTo(12 / camera(host).zoom, 2);
    expect(strokesOf(widened, null)[1]).toEqual(other);

    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(colored);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(before);
  });

  it("schede e tratti presi insieme si spostano insieme, in un annulla; i tratti della scheda scelta vanno con lei", () => {
    const { host, changes, engine } = mounted();
    pen(host, card(host, "t"), across(0, 0));
    pen(host, viewportOf(host), [[60, 160], [90, 170], [120, 180]]);
    const before = lastChange(changes).text;
    const onCard = strokesOf(before, "t");
    lasso(engine);
    drag(host, loop(-20, -20, 220, 220));
    // La nota è scelta; il suo tratto va con lei, quello libero è scelto da sé.
    expect(engine.selection().nodes).toEqual(["t"]);
    expect(chosen(host)).toBe(1);
    drag(host, [[100, 50], [140, 70], [140, 90]]);
    const moved = lastChange(changes).text;
    const kinds = lastChange(changes).operation.patches.map((patch) => patch.kind);
    expect(kinds.filter((kind) => kind === "upsert-node")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "ink")).toHaveLength(1);
    const doc = JSON.parse(moved) as { nodes: Json[] };
    expect(doc.nodes[0]).toMatchObject({ x: 40, y: 40 });
    // Il tratto della nota non cambia: si sposta con la scheda.
    expect(strokesOf(moved, "t")).toEqual(onCard);
    expect(strokesOf(moved, null)).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(before);
  });

  it("un tratto di un PDF portato su una nota diventa della nota, con le misure della nota", () => {
    const { host, changes, engine } = mounted();
    pen(host, card(host, "doc"), across(600, 0));
    expect(strokesOf(lastChange(changes).text, "doc")).toHaveLength(1);
    lasso(engine);
    drag(host, loop(610, 10, 790, 90));
    expect(engine.selection().nodes).toEqual([]);
    expect(chosen(host)).toBe(1);
    drag(host, [[660, 50], [400, 50], [60, 50]]);
    const moved = lastChange(changes).text;
    expect(strokesOf(moved, "doc")).toEqual([]);
    expect(strokesOf(moved, "t")[0]).toMatchObject({ anchor: { kind: "card", width: 200, height: 100 } });
    expect(notice(host)).toBe(t("canvas.ink.moved_to", { name: "nota" }));
  });

  it("in sola lettura il lazo sceglie, niente si sposta", () => {
    const { host, changes, engine } = twoFree();
    engine.setReadOnly(true);
    const count = changes.length;
    drag(host, loop(80, 280, 200, 350));
    expect(chosen(host)).toBe(1);
    drag(host, [[140, 320], [110, 180], [80, 50]]);
    expect(changes).toHaveLength(count);
    const bar = host.querySelector<HTMLElement>(".canvas-selection-bar")!;
    expect(bar.querySelector('[data-command="canvas.stroke_color"]')!.getAttribute("aria-disabled")).toBe("true");
  });

  it("Esc toglie i tratti scelti, e cambiare strumento pure", () => {
    const { host, engine } = twoFree();
    drag(host, loop(80, 280, 200, 350));
    expect(chosen(host)).toBe(1);
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(chosen(host)).toBe(0);
    drag(host, loop(80, 280, 200, 350));
    expect(chosen(host)).toBe(1);
    engine.commands().find((command) => command.id === "canvas.tool.select")!.run();
    expect(chosen(host)).toBe(0);
  });

  it("duemila tratti nel giro si spostano con una scrittura sola", () => {
    const brush = "pf1 size=2 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
    const strokes = Array.from({ length: 2000 }, (_, i) => ({
      id: `s${i}`,
      tool: "pen",
      brush,
      color: "#000000",
      anchor: { kind: "free" },
      // Un trattino di 4 unità, cinquanta per riga, dieci unità fra l'uno e l'altro.
      ink: `1 s100 cxy ${(1000 + (i % 50) * 10) * 100},${(1000 + Math.floor(i / 50) * 10) * 100} 400,400`,
    }));
    const source = JSON.stringify({ ...JSON.parse(BOARD), "fub:ink": { v: 1, strokes } });
    const { host, changes, calls, engine } = mounted(source);
    lasso(engine);
    drag(host, loop(990, 990, 1520, 1420));
    expect(chosen(host)).toBe(2000);
    calls.length = 0;
    drag(host, [[1200, 1200], [1260, 1230], [1300, 1250]]);
    expect(changes).toHaveLength(1);
    expect(calls.filter((name) => name === "commit")).toHaveLength(1);
    expect(calls.filter((name) => name === "compile")).toHaveLength(1);
    expect(strokesOf(lastChange(changes).text, null)).toHaveLength(2000);
  });
});

describe("il dito scrive (T64)", () => {
  const TOUCH = { pointerType: "touch", isPrimary: false, width: 10, height: 10 } as const;
  const fingerButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".canvas-rail > .canvas-rail-finger")!;
  const wetPaths = (host: HTMLElement) => host.querySelectorAll(".canvas-ink-wet path").length;
  /** Il suggerimento di `button`, come lo legge il lettore di schermo col fuoco. */
  const hint = (button: HTMLElement): string | null => {
    button.focus();
    const id = button.getAttribute("aria-describedby");
    return id === null ? null : document.getElementById(id)?.textContent ?? null;
  };

  /** Il punto del client sopra il punto `(x, y)` della lavagna, con la camera di adesso. */
  function client(host: HTMLElement, [x, y]: readonly [number, number]): { clientX: number; clientY: number } {
    const cam = camera(host);
    return { clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y };
  }

  /** Un dito finto giù su `target` nel punto `world` della lavagna; si muove e si alza in punti del client. */
  function finger(host: HTMLElement, pointerId: number, target: Element, world: readonly [number, number]) {
    const base = { ...TOUCH, pointerId };
    target.dispatchEvent(pointerEvent("pointerdown", { ...base, ...client(host, world), button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
    return {
      move(at: { clientX: number; clientY: number }, ms = 8) {
        clock += ms;
        target.dispatchEvent(pointerEvent("pointermove", { ...base, ...at, button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
      },
      up(at: { clientX: number; clientY: number }) {
        clock += 8;
        target.dispatchEvent(pointerEvent("pointerup", { ...base, ...at, button: 0, buttons: 0, pressure: 0, timeStamp: clock }));
      },
    };
  }

  /** Un tratto del dito per i punti `world`: giù, i movimenti e su. */
  function fingerStroke(host: HTMLElement, target: Element, world: readonly (readonly [number, number])[]): void {
    const points = world.map((point) => client(host, point));
    const one = finger(host, 11, target, world[0]!);
    for (const point of points.slice(1)) one.move(point);
    one.up(points[points.length - 1]!);
  }

  async function mountedWith(settings: { fingerWrites?: boolean; fingerMovesCard?: boolean; workspace?: string } = {}) {
    machine.fingerWrites = settings.fingerWrites ?? false;
    machine.fingerMovesCard = settings.fingerMovesCard ?? false;
    machine.workspace = settings.workspace ?? "auto";
    const board = mounted();
    await settle();
    return board;
  }

  it("spento, il dito sposta la lavagna come oggi e non scrive", async () => {
    const { host, changes } = await mountedWith();
    const before = camera(host);
    fingerStroke(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toEqual([]);
    const after = camera(host);
    expect(after.x).toBeCloseTo(before.x + 80 * before.zoom);
    expect(after.y).toBeCloseTo(before.y + 30 * before.zoom);
    expect(fingerButton(host).getAttribute("aria-pressed")).toBe("false");
  });

  it("acceso, un dito scrive con la penna scelta, e la lavagna resta ferma", async () => {
    const { host, changes } = await mountedWith({ fingerWrites: true });
    const before = camera(host);
    fingerStroke(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]]);
    expect(changes).toHaveLength(1);
    const [stroke] = strokesOf(changes[0]!.text, null);
    expect(stroke).toMatchObject({ tool: "pen", color: "#0072b2" });
    expect(camera(host)).toEqual(before);
    expect(wetPaths(host)).toBe(0);
    expect(fingerButton(host).getAttribute("aria-pressed")).toBe("true");
  });

  it("acceso, «Il dito sposta le schede» non vale: il dito sopra una scheda ci scrive, e il suggerimento lo dice", async () => {
    const { host, changes, engine } = await mountedWith({ fingerWrites: true, fingerMovesCard: true });
    fingerStroke(host, card(host, "t"), across(0, 0));
    expect(changes).toHaveLength(1);
    expect(strokesOf(changes[0]!.text, "t")).toHaveLength(1);
    const doc = JSON.parse(engine.getDoc()) as { nodes: { id: string; x: number; y: number }[] };
    expect(doc.nodes[0]).toMatchObject({ id: "t", x: 0, y: 0 });
    expect(hint(fingerButton(host))).toBe(t("canvas.finger.hint_cards"));
  });

  it("due dita che arrivano a 30 ms una dall'altra pizzicano, e il primo segno si toglie", async () => {
    const { host, changes } = await mountedWith({ fingerWrites: true });
    const viewport = viewportOf(host);
    const before = camera(host);
    const one = finger(host, 11, viewport, [100, 300]);
    const a = client(host, [110, 300]);
    one.move(a, 15);
    // La scia del primo dito c'è: il dito scrive.
    expect(wetPaths(host)).toBe(1);
    clock += 15;
    const two = finger(host, 12, viewport, [200, 300]);
    expect(wetPaths(host)).toBe(0);
    // Le due dita si allontanano: la distanza raddoppia, e la vista con lei.
    const b = client(host, [200, 300]);
    const middle = (a.clientX + b.clientX) / 2;
    const half = (b.clientX - a.clientX) / 2;
    one.move({ clientX: middle - half * 2, clientY: a.clientY });
    two.move({ clientX: middle + half * 2, clientY: b.clientY });
    expect(camera(host).zoom).toBeCloseTo(Math.min(4, before.zoom * 2));
    one.up({ clientX: middle - half * 2, clientY: a.clientY });
    two.up({ clientX: middle + half * 2, clientY: b.clientY });
    expect(inkChanges(changes)).toEqual([]);
    expect(wetPaths(host)).toBe(0);
  });

  it("il dito che scrive perde la cattura quando il secondo arriva: il primo segno si toglie e il pizzico vale lo stesso", async () => {
    const { host, changes } = await mountedWith({ fingerWrites: true });
    const viewport = viewportOf(host);
    const before = camera(host);
    const one = finger(host, 11, viewport, [100, 300]);
    const a = client(host, [110, 300]);
    one.move(a, 15);
    expect(wetPaths(host)).toBe(1);
    clock += 15;
    const two = finger(host, 12, viewport, [200, 300]);
    expect(wetPaths(host)).toBe(0);
    // Lo strato della penna toglie la cattura al primo dito, che il secondo ha preso per il pizzico: il browser la consegna dopo l'appoggio (T20a, T64).
    clock += 1;
    viewport.dispatchEvent(pointerEvent("lostpointercapture", { ...TOUCH, pointerId: 11, ...a, timeStamp: clock }));
    const b = client(host, [200, 300]);
    const middle = (a.clientX + b.clientX) / 2;
    const half = (b.clientX - a.clientX) / 2;
    one.move({ clientX: middle - half * 2, clientY: a.clientY });
    two.move({ clientX: middle + half * 2, clientY: b.clientY });
    expect(camera(host).zoom).toBeCloseTo(Math.min(4, before.zoom * 2));
    one.up({ clientX: middle - half * 2, clientY: a.clientY });
    two.up({ clientX: middle + half * 2, clientY: b.clientY });
    // Il primo segno non è mai stato scritto, e nessun gesto è rimasto aperto.
    expect(inkChanges(changes)).toEqual([]);
    expect(wetPaths(host)).toBe(0);
  });

  it("una penna vera mentre il dito scrive: scrive la penna, il tratto del dito si toglie", async () => {
    const { host, changes } = await mountedWith({ fingerWrites: true });
    const viewport = viewportOf(host);
    const one = finger(host, 11, viewport, [100, 300]);
    one.move(client(host, [140, 320]));
    pen(host, viewport, [[300, 400], [340, 420], [380, 430]]);
    one.move(client(host, [180, 330]));
    one.up(client(host, [180, 330]));
    expect(changes).toHaveLength(1);
    expect(strokesOf(changes[0]!.text, null)).toHaveLength(1);
    expect(wetPaths(host)).toBe(0);
  });

  it("l'interruttore in fondo alla colonna cambia l'impostazione di questo computer, e vale dal tocco dopo", async () => {
    const { host, changes } = await mountedWith();
    const button = fingerButton(host);
    expect(button.getAttribute("aria-label")).toBe(t("canvas.finger"));
    expect(hint(button)).toBe(t("canvas.finger.hint"));
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await settle();
    expect(machine.saved).toEqual([["canvas.finger_writes", true]]);
    fingerStroke(host, viewportOf(host), [[100, 300], [140, 320], [180, 330]]);
    expect(inkChanges(changes)).toHaveLength(1);

    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await settle();
    expect(machine.saved).toEqual([["canvas.finger_writes", true], ["canvas.finger_writes", false]]);
    fingerStroke(host, viewportOf(host), [[100, 400], [140, 420], [180, 430]]);
    expect(inkChanges(changes)).toHaveLength(1);
  });

  it("una scrittura che non riesce rimette l'interruttore com'era", async () => {
    const { host } = await mountedWith();
    machine.refuse = true;
    const button = fingerButton(host);
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await settle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(machine.saved).toEqual([]);
  });

  it("nello spazio Semplice l'interruttore c'è, subito sopra «Completo»", async () => {
    const { host } = await mountedWith({ workspace: "simple" });
    const button = fingerButton(host);
    const full = host.querySelector<HTMLElement>(".canvas-rail > .canvas-rail-full")!;
    expect(full.hidden).toBe(false);
    expect(button.hidden).toBe(false);
    expect(button.nextElementSibling).toBe(full);
  });
});

// Le forme dal tratto, Maiusc e il righello (T87): una forma resta un tratto
// `fub:ink` (D-22 (a)).
describe("le forme dal tratto, Maiusc e il righello", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
  });

  /** I punti del tratto `stroke` di un livello, dal suo `ink`. */
  function pointsOf(stroke: Json): (readonly [number, number])[] {
    const ink = decodeInk(String(stroke.ink));
    return Array.from({ length: inkLength(ink) }, (_, i) => inkPoint(ink, i));
  }

  /** Un rettangolo di 200 × 150 sulla lavagna libera, coi punti di mezzo dei lati: nove campioni. */
  const RECT: [number, number][] = [
    [100, 300], [200, 300], [300, 300], [300, 375], [300, 450], [200, 450], [100, 450], [100, 375], [100, 300],
  ];

  /** Le chiavi del documento e di ogni scheda: una forma non porta niente di nuovo nel file. */
  function keysOf(text: string): string[] {
    const doc = JSON.parse(text) as Json & { nodes: Json[] };
    return [...Object.keys(doc), ...doc.nodes.flatMap((node) => Object.keys(node))].sort();
  }

  it("la penna ferma mezzo secondo fa la forma: due passi, il primo annulla riporta il tratto com'era, il secondo lo toglie", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine, host, changes } = mounted();
    const lift = pen(host, viewportOf(host), RECT, false);
    vi.advanceTimersByTime(500);
    // La forma si dice prima dell'alzata.
    expect(host.querySelector(".canvas-gesture-said")?.textContent?.trim()).toBe(
      t("canvas.ink.shape", { kind: t("canvas.ink.shape.rect") }),
    );
    lift();
    expect(changes).toHaveLength(2);
    const [drawn] = strokesOf(changes[0]!.text, null);
    const [shaped] = strokesOf(changes[1]!.text, null);
    expect(strokesOf(changes[1]!.text, null)).toHaveLength(1);
    // Lo stesso tratto: id, penna, colore, spessore, ancora e ora; cambia l'inchiostro.
    expect(shaped).toEqual({ ...drawn, ink: shaped!.ink });
    expect(shaped!.ink).not.toBe(drawn!.ink);
    const points = pointsOf(shaped!);
    expect(points[0]).toEqual(points[points.length - 1]);
    for (const [x, y] of points) {
      const onSide = Math.abs(x - 100) < 0.5 || Math.abs(x - 300) < 0.5 || Math.abs(y - 300) < 0.5 || Math.abs(y - 450) < 0.5;
      expect(onSide).toBe(true);
    }
    // Il file ha solo tratti `fub:ink`: niente di nuovo fuori dal livello.
    expect(keysOf(changes[1]!.text)).toEqual(keysOf(changes[0]!.text));
    expect(changes[1]!.operation.patches).toEqual([
      expect.objectContaining({ kind: "ink", layer: "board", at: 0, before: drawn, after: shaped }),
    ]);

    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(changes[0]!.text);
    expect(engine.undo()).toBe(true);
    expect(lastChange(changes).text).toBe(BOARD);
  });

  it("un tratto che non è una forma, uno corto e l'evidenziatore restano inchiostro", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine, host, changes } = mounted();
    // Uno zigzag, tenuto fermo.
    let lift = pen(host, viewportOf(host), [[100, 300], [130, 380], [160, 300], [190, 380], [220, 300], [250, 380]], false);
    vi.advanceTimersByTime(500);
    lift();
    expect(changes).toHaveLength(1);
    // Un quadratino di 20 pixel: la misura della scrittura.
    lift = pen(host, viewportOf(host), [[400, 300], [420, 300], [420, 320], [400, 320], [400, 300]], false);
    vi.advanceTimersByTime(500);
    lift();
    expect(changes).toHaveLength(2);
    // L'evidenziatore, sul rettangolo.
    openPen(engine);
    pick("tool", "highlighter");
    lift = pen(host, viewportOf(host), RECT, false);
    vi.advanceTimersByTime(500);
    lift();
    expect(changes).toHaveLength(3);
    expect(strokesOf(lastChange(changes).text, null).map((stroke) => stroke.tool)).toEqual(["pen", "pen", "highlighter"]);
  });

  it("la forma sopra una scheda resta della scheda, come il tratto", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { host, changes } = mounted();
    const box: [number, number][] = [[20, 20], [100, 20], [180, 20], [180, 50], [180, 80], [100, 80], [20, 80], [20, 50], [20, 20]];
    const lift = pen(host, card(host, "t"), box, false);
    vi.advanceTimersByTime(500);
    lift();
    expect(changes).toHaveLength(2);
    const [drawn] = strokesOf(changes[0]!.text, "t");
    const [shaped] = strokesOf(changes[1]!.text, "t");
    expect(shaped).toMatchObject({ id: drawn!.id, anchor: drawn!.anchor });
    expect(shaped!.ink).not.toBe(drawn!.ink);
    expect(strokesOf(changes[1]!.text, null)).toEqual([]);
  });

  it("Maiusc durante il tratto lo tiene dritto a passi di 15°, anche premuto a metà", () => {
    const { host, changes } = mounted();
    // Da (100, 300) verso (180, 330): 20,6°, che va a 15°.
    const lift = pen(host, viewportOf(host), [[100, 300], [130, 318], [150, 312]], false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
    const cam = camera(host);
    clock += 8;
    viewportOf(host).dispatchEvent(pointerEvent("pointermove", {
      ...PEN, clientX: 180 * cam.zoom + cam.x, clientY: 330 * cam.zoom + cam.y, button: -1, buttons: 1, pressure: 0.5, shiftKey: true, timeStamp: clock,
    }));
    lift();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.operation.patches).toHaveLength(1);
    const points = pointsOf(strokesOf(changes[0]!.text, null)[0]!);
    const [x0, y0] = points[0]!;
    expect([x0, y0]).toEqual([100, 300]);
    for (const [x, y] of points.slice(1)) expect((Math.atan2(y - y0, x - x0) * 180) / Math.PI).toBeCloseTo(15, 1);
  });

  it("il righello: «Righello» nella colonna lo mette e lo toglie, non entra nel file; la penna lungo il bordo scrive dritto", () => {
    const { host, changes } = mounted();
    const button = host.querySelector<HTMLButtonElement>(".canvas-rail-ruler")!;
    expect(button.getAttribute("aria-label")).toBe(t("canvas.ruler"));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const element = host.querySelector<HTMLElement>(".canvas-ruler")!;
    expect(element.hidden).toBe(true);
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(element.hidden).toBe(false);
    expect(changes).toHaveLength(0);
    // La riga è un fratello della vista, non un suo figlio: lo strato della penna non la prende.
    expect(viewportOf(host).contains(element)).toBe(false);

    // Il righello nasce dritto in mezzo alla vista; il bordo in basso sta a
    // mezza larghezza (36 pixel dello schermo) sotto il centro.
    const cam = camera(host);
    const center = { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom };
    const edge = center.y + 36 / cam.zoom;
    const grip = host.querySelector<HTMLElement>(".canvas-ruler-grip")!;
    expect(grip.getAttribute("aria-valuenow")).toBe("0");
    pen(host, viewportOf(host), [[center.x, edge + 3 / cam.zoom], [center.x + 60, edge + 9 / cam.zoom], [center.x + 120, edge + 1 / cam.zoom]]);
    expect(changes).toHaveLength(1);
    const ys = pointsOf(strokesOf(changes[0]!.text, null)[0]!).map(([, y]) => y);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]!).toBeGreaterThan(edge);
    expect(ys[0]! - edge).toBeLessThan(4 / cam.zoom);

    // Lontano dal righello il tratto resta com'è.
    pen(host, viewportOf(host), [[center.x, edge + 300], [center.x + 60, edge + 320], [center.x + 120, edge + 310]]);
    expect(new Set(pointsOf(strokesOf(lastChange(changes).text, null)[1]!).map(([, y]) => y)).size).toBeGreaterThan(1);

    button.click();
    expect(element.hidden).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(changes).toHaveLength(2);
  });

  it("il righello si gira con le frecce, a passi di 15° con Maiusc, e con la rotella; si sposta col corpo", () => {
    const { host } = mounted();
    host.querySelector<HTMLButtonElement>(".canvas-rail-ruler")!.click();
    const grip = host.querySelector<HTMLElement>(".canvas-ruler-grip")!;
    const bar = host.querySelector<HTMLElement>(".canvas-ruler-bar")!;
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(grip.getAttribute("aria-valuenow")).toBe("1");
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(grip.getAttribute("aria-valuenow")).toBe("15");
    // La rotella a gradi: 60 sono tre gradi.
    grip.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, bubbles: true, cancelable: true }));
    expect(grip.getAttribute("aria-valuenow")).toBe("18");
    expect(bar.style.getPropertyValue("--canvas-ruler-angle")).toBe("18deg");
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(grip.getAttribute("aria-valuenow")).toBe("0");
    const x = parseFloat(bar.style.getPropertyValue("--canvas-ruler-x"));
    grip.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 10, clientY: 10 }));
    grip.dispatchEvent(pointerEvent("pointermove", { ...MOUSE, button: -1, buttons: 1, clientX: 60, clientY: 10 }));
    grip.dispatchEvent(pointerEvent("pointerup", { ...MOUSE, button: 0, buttons: 0, clientX: 60, clientY: 10 }));
    expect(parseFloat(bar.style.getPropertyValue("--canvas-ruler-x"))).toBeCloseTo(x + 50, 6);
  });
});
