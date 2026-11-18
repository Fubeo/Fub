// @vitest-environment happy-dom
// I difetti della lavagna trovati dal collaudo dell'app (IMP-040…043, 052,
// 053) e dal giro dell'issue #411 (C-05, C-06): il fuoco dopo un pulsante
// della colonna o della riga (e i tasti dello zoom), il fuoco dopo il clic su
// un filo, il doppio clic su una porta, lo spostamento dal corpo di una
// scheda, «Aggiungi testo» che apre in scrittura in un posto libero, la scheda
// nuova lasciata vuota, l'aggancio solo al rilascio e la barra della scelta
// durante lo zoom.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine, type CanvasChange } from "./engine";
import { DEFAULT_PREFERENCES, type CanvasPreferences } from "./preferences";
import { canvasCoreReady } from "./wasm/core";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import structure from "../../theme/scrittoio/structure.css?raw";

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

  it("dopo il pulsante «−» della riga delle opzioni il fuoco resta sul pulsante, e + − 0 zoomano lo stesso (IMP-040, lo zoom)", async () => {
    const { engine, host } = mounted(BOARD);
    const start = cameraOf(host).zoom;
    const zoomOut = host.querySelector<HTMLButtonElement>('[data-command="canvas.zoom_out"]')!;
    zoomOut.click();
    const out = cameraOf(host).zoom;
    expect(out).toBeLessThan(start);
    zoomOut.focus();
    expect(document.activeElement).toBe(zoomOut);
    key(document.activeElement, { key: "+" });
    expect(cameraOf(host).zoom).toBeCloseTo(start, 6);
    key(document.activeElement, { key: "-" });
    expect(cameraOf(host).zoom).toBeCloseTo(out, 6);
    // Il 100% è un volo: arriva sui fotogrammi, come nella vista.
    key(document.activeElement, { key: "0" });
    await vi.waitFor(() => expect(cameraOf(host).zoom).toBeCloseTo(1, 6));
    expect(document.activeElement).toBe(zoomOut);
    engine.destroy();
  });
});

/** Due schede unite da un filo: il suo punto di mezzo è (300, 50). */
const LINKED = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }],
});

describe("il fuoco dopo il clic su un filo (IMP-052)", () => {
  /**
   * Il fuoco che il browser dà al mouse giù dopo i gestori del pointerdown, se
   * nessuno l'ha annullato: sul bersaglio o sul suo antenato con `tabindex`. Se
   * il bersaglio non sta più nel documento (la tela l'ha rifatto mentre il clic
   * scendeva), il fuoco va su BODY. È quello che WebKitGTK fa, misurato con
   * WebDriver; happy-dom non lo fa da sé.
   */
  function browserFocusAfterPress(press: PointerEvent, target: Element): void {
    if (press.defaultPrevented) return;
    if (!target.isConnected) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    target.closest<HTMLElement>("[tabindex]")?.focus({ preventScroll: true });
  }

  it("il clic sulla linea sceglie il filo e il fuoco resta sulla lavagna: Canc lo toglie, Ctrl+Z lo riporta", async () => {
    const { engine, host, changes } = mounted(LINKED);
    host.querySelector<HTMLButtonElement>(".canvas-tool")!.focus();
    const line = host.querySelector<SVGElement>(".canvas-edge-hit")!;
    const at = screenOf(host, 300, 50);
    browserFocusAfterPress(pointer(line, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...at }), line);
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...at });
    expect(engine.selection().edges).toEqual(["e"]);
    expect(document.activeElement).toBe(viewportOf(host));
    key(document.activeElement, { key: "Delete" });
    expect(changes).toHaveLength(1);
    expect(JSON.parse(engine.getDoc()).edges).toEqual([]);
    key(document.activeElement, { key: "z", ctrlKey: true });
    await vi.waitFor(() => expect(JSON.parse(engine.getDoc()).edges).toHaveLength(1));
    engine.destroy();
  });
});

describe("il doppio clic su una porta non crea niente (IMP-053)", () => {
  it("il doppio clic sulla porta di una scheda non mette una scheda di testo; nel vuoto della lavagna sì", () => {
    const { engine, host } = mounted(BOARD);
    const port = cardOf(host, "a").querySelector<HTMLElement>('.canvas-port[data-side="left"]')!;
    const on = screenOf(host, 0, 50);
    // Il primo clic sulla porta fa partire un filo, che cattura il puntatore:
    // il doppio clic arriva alla vista, non alla porta (lo misura WebKitGTK).
    for (const pointerId of [1, 2]) {
      pointer(port, "pointerdown", { pointerId, button: 0, buttons: 1, ...on });
      pointer(viewportOf(host), "pointerup", { pointerId, button: 0, buttons: 0, ...on });
    }
    viewportOf(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: on.clientX, clientY: on.clientY }));
    expect(JSON.parse(engine.getDoc()).nodes).toHaveLength(2);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    // Nel vuoto della lavagna il doppio clic mette la scheda, come prima.
    const empty = screenOf(host, 600, 300);
    for (const pointerId of [3, 4]) {
      pointer(viewportOf(host), "pointerdown", { pointerId, button: 0, buttons: 1, ...empty });
      pointer(viewportOf(host), "pointerup", { pointerId, button: 0, buttons: 0, ...empty });
    }
    viewportOf(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: empty.clientX, clientY: empty.clientY }));
    expect(bornAfter(engine, ["a", "b"])).toHaveLength(1);
    engine.destroy();
  });

  it("il doppio clic su un filo non mette niente: il filo non è il vuoto, come per il doppio tocco", () => {
    const { engine, host } = mounted(LINKED);
    const on = screenOf(host, 300, 50);
    // Ogni clic sceglie il filo, e la scelta rifà i fili: il bersaglio si cerca a ogni clic.
    for (const pointerId of [1, 2]) {
      pointer(host.querySelector<SVGElement>(".canvas-edge-hit")!, "pointerdown", { pointerId, button: 0, buttons: 1, ...on });
      pointer(viewportOf(host), "pointerup", { pointerId, button: 0, buttons: 0, ...on });
    }
    host.querySelector<SVGElement>(".canvas-edge-hit")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: on.clientX, clientY: on.clientY }));
    expect(JSON.parse(engine.getDoc()).nodes).toHaveLength(2);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
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

/** Le regole di `structure.css` fuori dalle `@container` (happy-dom non applica il foglio: la prova confronta i selettori veri). */
function structureRules(): Array<{ selector: string; body: string }> {
  const flat = structure.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  return [...flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }));
}

/** `el` ha una regola della struttura che lo nasconde (`display: none`). */
function hiddenByStructure(el: Element): boolean {
  return structureRules().some(({ selector, body }) => /display\s*:\s*none/.test(body)
    && selector.split(",").some((one) => {
      try {
        return el.matches(one.trim());
      } catch {
        return false;
      }
    }));
}

describe("il nome del gruppo una volta sola (#411 C-04)", () => {
  const GROUPS = JSON.stringify({
    nodes: [
      { id: "g", type: "group", x: 0, y: 0, width: 400, height: 300, label: "Media e varianza" },
      { id: "h", type: "group", x: 60, y: -8, width: 400, height: 300 },
      { id: "t", type: "text", x: 600, y: 0, width: 200, height: 100, text: "testo" },
    ],
    edges: [],
  });

  it("da vicino il gruppo mostra solo l'etichetta nella cornice: la testata non ripete il nome", () => {
    const { engine, host } = mounted(GROUPS);
    for (const id of ["g", "h"]) {
      const card = cardOf(host, id);
      const title = card.querySelector(".canvas-node-handle > .canvas-node-title")!;
      const label = card.querySelector(".canvas-group-label")!;
      expect(hiddenByStructure(title), `${id}: il titolo della testata`).toBe(true);
      expect(hiddenByStructure(label), `${id}: l'etichetta`).toBe(false);
      // Il nome grande da lontano non si vede da vicino: c'è solo col livello lontano.
      expect(hiddenByStructure(card.querySelector(".canvas-node-far")!)).toBe(true);
    }
    expect(cardOf(host, "g").querySelector(".canvas-group-label")!.textContent).toBe("Media e varianza");
    expect(cardOf(host, "g").querySelector(".canvas-node-far")!.textContent).toBe("Media e varianza");
    // Le altre schede tengono il loro titolo.
    expect(hiddenByStructure(cardOf(host, "t").querySelector(".canvas-node-title")!)).toBe(false);
    engine.destroy();
  });

  it("il gruppo si sposta trascinando la sua etichetta", () => {
    const { engine, host, changes } = mounted(GROUPS);
    const label = cardOf(host, "g").querySelector<HTMLElement>(".canvas-group-label")!;
    pointer(label, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 20, 20) });
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, -20, 20), altKey: true });
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, -20, 20), altKey: true });
    expect(changes).toHaveLength(1);
    expect(nodeOf(engine, "g")).toMatchObject({ x: -40, y: 0 });
    engine.destroy();
  });
});

describe("«File mancante» dentro la scheda piccola (IMP-045)", () => {
  it("ciò che non ci sta esce in basso, mai in alto, e la scheda piccola stringe su una riga", () => {
    const missing = structureRules().find(({ selector }) => selector === ".canvas-card-missing")!;
    expect(missing.body).toMatch(/justify-content:\s*safe center/);
    expect(missing.body).toMatch(/overflow:\s*hidden/);
    expect(missing.body).toMatch(/container-type:\s*size/);
    expect(structure).toMatch(/@container \(max-height: 120px\) \{\s*\.canvas-card-missing > \.canvas-media-placeholder \{[^}]*white-space: nowrap/);
  });
});

describe("l'aggancio solo al rilascio (#411 C-05)", () => {
  /** La posizione che la scheda `id` mostra adesso (la sua trasformazione), anche a gesto in corso. */
  function shownAt(host: HTMLElement, id: string): { x: number; y: number } {
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(cardOf(host, id).style.transform);
    if (!match) throw new Error(`trasformazione inattesa: ${cardOf(host, id).style.transform}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  }

  /** Trascina la testata di `a` di (dx, dy) unità; `release` falso lascia il gesto aperto. */
  function dragA(host: HTMLElement, dx: number, dy: number, options: { altMove?: boolean; altUp?: boolean; release?: boolean } = {}) {
    pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 20, 10) });
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, 20 + dx, 10 + dy), altKey: options.altMove ?? false });
    if (options.release === false) return;
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 20 + dx, 10 + dy), altKey: options.altUp ?? false });
  }

  it("mentre la trascini la scheda segue il puntatore 1:1 con le guide; lasciata, si aggancia alla guida e alla griglia scivolando", () => {
    const { engine, host, changes } = mounted(BOARD);
    const animate = vi.fn();
    (cardOf(host, "a") as HTMLElement & { animate: unknown }).animate = animate;
    dragA(host, 13, 4, { release: false });
    // Sotto la mano niente salti: 13 e 4, non 16 e 0.
    expect(shownAt(host, "a")).toEqual({ x: 13, y: 4 });
    // La guida del bordo in alto di «b» si vede già.
    expect(host.querySelector(".canvas-guides")).not.toBeNull();
    expect(changes).toHaveLength(0);
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 33, 14) });
    // Lasciata: y sulla guida (0), x sulla griglia di 8 (16), in un passo.
    expect(nodeOf(engine, "a")).toMatchObject({ x: 16, y: 0 });
    expect(changes).toHaveLength(1);
    expect(host.querySelector(".canvas-guides")).toBeNull();
    // Ci scivola, dalla posizione sotto il puntatore.
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, timing] = animate.mock.calls[0]! as [Keyframe[], KeyframeAnimationOptions];
    expect(frames.map((frame) => frame.transform)).toEqual(["translate(13px, 4px)", "translate(16px, 0px)"]);
    expect(timing.duration).toBeGreaterThan(0);
    engine.destroy();
  });

  it("col movimento ridotto va al suo posto subito, senza scivolare", () => {
    setReducedMotionPreference(true);
    const { engine, host } = mounted(BOARD);
    const animate = vi.fn();
    (cardOf(host, "a") as HTMLElement & { animate: unknown }).animate = animate;
    dragA(host, 13, 4);
    expect(nodeOf(engine, "a")).toMatchObject({ x: 16, y: 0 });
    expect(animate).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("Alt tenuto al rilascio lo spegne: la scheda resta dove l'hai lasciata", () => {
    const { engine, host } = mounted(BOARD);
    dragA(host, 13, 4, { altUp: true });
    expect(nodeOf(engine, "a")).toMatchObject({ x: 13, y: 4 });
    engine.destroy();
  });

  it("il passo della griglia viene da «Passo della griglia»; «Nessuna griglia» aggancia solo alle schede vicine", () => {
    const { engine, host } = mounted(BOARD);
    setPreferences({ snapStep: "32" });
    dragA(host, 13, 40);
    expect(nodeOf(engine, "a")).toMatchObject({ x: 0, y: 32 });
    dragA(host, 20, 40);
    expect(nodeOf(engine, "a")).toMatchObject({ x: 32, y: 64 });
    setPreferences({ snapStep: "none" });
    dragA(host, 13, 21);
    expect(nodeOf(engine, "a")).toMatchObject({ x: 45, y: 85 });
    // Senza griglia la guida aggancia ancora: il bordo in alto torna su quello di «b».
    dragA(host, 3, -82);
    expect(nodeOf(engine, "a")).toMatchObject({ x: 48, y: 0 });
    engine.destroy();
  });

  it("il ridimensionamento usa lo stesso passo", () => {
    const { engine, host } = mounted(BOARD);
    setPreferences({ snapStep: "32" });
    pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 20, 10) });
    pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 20, 10) });
    const grip = host.querySelector<HTMLElement>('[data-corner="se"]')!;
    expect(grip).not.toBeNull();
    pointer(grip, "pointerdown", { pointerId: 2, button: 0, buttons: 1, ...screenOf(host, 200, 100) });
    pointer(viewportOf(host), "pointermove", { pointerId: 2, buttons: 1, ...screenOf(host, 213, 150) });
    pointer(viewportOf(host), "pointerup", { pointerId: 2, button: 0, buttons: 0, ...screenOf(host, 213, 150) });
    expect(nodeOf(engine, "a")).toMatchObject({ width: 224, height: 160 });
    engine.destroy();
  });
});

describe("la barra della scelta durante lo zoom (#411 C-06)", () => {
  /** Una rotella con Ctrl (ingrandisce); `ctrlKey` e il punto a mano: l'evento di happy-dom non li porta. */
  function zoomWheel(viewport: HTMLElement, deltaY: number): void {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, deltaY, clientX: 300, clientY: 200 });
    for (const [name, value] of [["ctrlKey", true], ["clientX", 300], ["clientY", 200]] as const) Object.defineProperty(event, name, { value });
    viewport.dispatchEvent(event);
  }

  it("la rotella che ingrandisce non toglie la barra: la barra segue la scheda a ogni passo, e lo spostamento la toglie", () => {
    vi.useFakeTimers();
    try {
      const { engine, host } = mounted(BOARD);
      pointer(handleOf(host, "a"), "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 20, 10) });
      pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 20, 10) });
      const bar = host.querySelector<HTMLElement>(".canvas-selection-bar")!;
      expect(bar.hidden).toBe(false);
      const before = { left: bar.style.left, top: bar.style.top };
      const relabelled = vi.spyOn(bar, "querySelectorAll");
      zoomWheel(viewportOf(host), -100);
      // A rotella che gira la barra c'è, e si è spostata con la scheda.
      expect(bar.hidden).toBe(false);
      expect({ left: bar.style.left, top: bar.style.top }).not.toEqual(before);
      const camera = cameraOf(host);
      // La barra sta centrata sulla scheda (larga 200, centro a 100): segue il centro sullo schermo.
      const placedLeft = parseFloat(bar.style.left);
      zoomWheel(viewportOf(host), -100);
      const next = cameraOf(host);
      expect(next.zoom).not.toBe(camera.zoom);
      expect(parseFloat(bar.style.left) - placedLeft).toBeCloseTo((100 * next.zoom + next.x) - (100 * camera.zoom + camera.x), 5);
      expect(bar.hidden).toBe(false);
      // Il passo di zoom sposta la barra senza rifarne i pulsanti.
      expect(relabelled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(bar.hidden).toBe(false);
      // Spostare la scheda è un gesto sulle schede: la barra si toglie.
      pointer(handleOf(host, "a"), "pointerdown", { pointerId: 2, button: 0, buttons: 1, ...screenOf(host, 20, 10) });
      pointer(viewportOf(host), "pointermove", { pointerId: 2, buttons: 1, ...screenOf(host, 60, 50) });
      expect(bar.hidden).toBe(true);
      pointer(viewportOf(host), "pointerup", { pointerId: 2, button: 0, buttons: 0, ...screenOf(host, 60, 50) });
      expect(bar.hidden).toBe(false);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
