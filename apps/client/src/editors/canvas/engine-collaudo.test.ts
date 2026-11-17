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

});

// Una scheda sola: la vista si apre centrata su di lei.
const ONE = JSON.stringify({
  nodes: [{ id: "c", type: "text", x: 0, y: 0, width: 320, height: 160, text: "centro" }],
  edges: [],
});

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Le schede nate dopo `before`, come stanno nel documento. */
function bornAfter(engine: CanvasEngine, before: readonly string[]) {
  return (JSON.parse(engine.getDoc()).nodes as Array<{ id: string; x: number; y: number; width: number; height: number; text?: string }>)
    .filter((node) => !before.includes(node.id));
}

const undoOf = (engine: CanvasEngine) => engine.commands().find((command) => command.id === "canvas.undo")!;

describe("«Aggiungi testo» apre la scheda in scrittura, in un posto libero (IMP-042)", () => {
  it("dalla barra dei comandi la scheda nasce accanto a quella al centro, senza coprirla, col fuoco nel testo", () => {
    const { engine, host } = mounted(ONE);
    host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click();
    const born = bornAfter(engine, ["c"]);
    expect(born).toHaveLength(1);
    expect(overlaps(born[0]!, nodeOf(engine, "c")!)).toBe(false);
    const editor = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(cardOf(host, born[0]!.id).contains(editor)).toBe(true);
    engine.destroy();
  });

  it("dal comando (la ricerca, il menu) fa lo stesso", () => {
    const { engine, host } = mounted(ONE);
    engine.commands().find((command) => command.id === "canvas.add.text")!.run();
    const born = bornAfter(engine, ["c"]);
    expect(born).toHaveLength(1);
    expect(overlaps(born[0]!, nodeOf(engine, "c")!)).toBe(false);
    expect(document.activeElement).toBe(host.querySelector(".canvas-text-editor"));
    engine.destroy();
  });
});

describe("«Aggiungi qui › Testo» del tasto destro", () => {
  it("la scheda nasce dove dice il menu, in scrittura: il menu non le toglie il fuoco", () => {
    const { engine, host } = mounted(ONE);
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(viewportOf(host));
    const at = screenOf(host, 1000, 1000);
    const menu = engine.contextMenu({ x: at.clientX, y: at.clientY })!;
    pointing.mockRestore();
    const add = (menu.context as ReadonlyArray<{ id?: string; items?: ReadonlyArray<{ id?: string; run?: () => void }> }>)
      .find((item) => item.id === "canvas.add")!;
    add.items!.find((item) => item.id === "canvas.add.text")!.run!();
    const born = bornAfter(engine, ["c"]);
    expect(born).toHaveLength(1);
    expect(born[0]).toMatchObject({ x: 1000, y: 1000 });
    expect(document.activeElement).toBe(host.querySelector(".canvas-text-editor"));
    engine.destroy();
  });
});

describe("la scheda nuova lasciata vuota se ne va (IMP-043)", () => {
  it("«Aggiungi testo» e poi Esc senza scrivere: la scheda non resta, il testo torna quello di prima e non resta niente da annullare", () => {
    const { engine, host } = mounted(ONE);
    const before = engine.getDoc();
    host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click();
    expect(bornAfter(engine, ["c"])).toHaveLength(1);
    key(host.querySelector(".canvas-text-editor"), { key: "Escape" });
    expect(bornAfter(engine, ["c"])).toEqual([]);
    expect(engine.getDoc()).toBe(before);
    expect(undoOf(engine).disabled()).not.toBeNull();
    engine.destroy();
  });

  it("con del testo scritto la scheda resta, e un annulla la toglie", async () => {
    const { engine, host } = mounted(ONE);
    host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click();
    const field = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    field.value = "prova A";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    key(field, { key: "Escape" });
    const born = bornAfter(engine, ["c"]);
    expect(born).toHaveLength(1);
    expect(born[0]!.text).toBe("prova A");
    expect(undoOf(engine).disabled()).toBeNull();
    engine.destroy();
  });
});

describe("i tasti della shell mentre si scrive in una scheda di testo (dubbia del collaudo)", () => {
  it("Ctrl+W sale alla shell, che chiude la linguetta come fuori dalla scrittura; la tela non ne fa un suo comando", () => {
    const { engine, host, changes } = mounted(ONE);
    host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click();
    const field = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    const reached: string[] = [];
    const listen = (event: KeyboardEvent) => reached.push(`${event.ctrlKey ? "Ctrl+" : ""}${event.key}`);
    document.addEventListener("keydown", listen);
    try {
      const count = changes.length;
      key(field, { key: "w", ctrlKey: true });
      // Ctrl+D fuori dal campo duplica la scelta: dentro sale alla shell, e la tela non duplica.
      key(field, { key: "d", ctrlKey: true });
      // I tasti che scrivono restano al campo.
      key(field, { key: "z", ctrlKey: true });
      key(field, { key: "a", ctrlKey: true });
      key(field, { key: "q" });
      expect(reached).toEqual(["Ctrl+w", "Ctrl+d"]);
      expect(changes.length).toBe(count);
      expect(host.querySelector(".canvas-text-editor")).toBe(field);
    } finally {
      document.removeEventListener("keydown", listen);
    }
    engine.destroy();
  });
});
