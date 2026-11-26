// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: i fili (T67) e le maniglie delle schede (T66).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine, type CanvasChange } from "./engine";
import type { CanvasDocument } from "./model";
import { type CanvasOperation, type CanvasPatch } from "./operation";
import { canvasCoreReady } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { mounted, readCanvas } from "./engine-test-support";

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

describe("i fili: collegare senza mirare, prendere un filo (T67)", () => {
  /**
   * `a` e `b` affiancate col filo `e1` dritto fra loro (da 200,50 a 400,50);
   * `c` sotto `a`; `s` sotto il filo, col bordo alto a 5 dal filo; `d` ed
   * `e` sovrapposte, `e` sopra.
   */
  function board(): string {
    return JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "a" },
        { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "b" },
        { id: "c", type: "text", x: 0, y: 300, width: 200, height: 100, text: "c" },
        { id: "s", type: "text", x: 250, y: 55, width: 100, height: 60, text: "s" },
        { id: "d", type: "text", x: 400, y: 300, width: 200, height: 100, text: "d" },
        { id: "e", type: "text", x: 450, y: 320, width: 200, height: 100, text: "e" },
      ],
      edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", toEnd: "arrow" }],
    });
  }

  function open() {
    const made = mounted(board());
    const viewport = made.host.querySelector<HTMLElement>(".canvas-viewport")!;
    return { ...made, viewport };
  }

  const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const body = (host: HTMLElement, id: string) => card(host, id).querySelector<HTMLElement>(".canvas-card-body")!;
  const port = (host: HTMLElement, id: string, side: string) =>
    card(host, id).querySelector<HTMLElement>(`:scope > .canvas-port[data-side="${side}"]`)!;
  const doc = (engine: CanvasEngine) => readCanvas(engine.getDoc());

  /** Il punto dello schermo di un punto della lavagna, dalla camera di adesso. */
  function screen(host: HTMLElement, x: number, y: number): { clientX: number; clientY: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const [, tx, ty, zoom] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(transform) ?? [];
    return { clientX: x * Number(zoom ?? 1) + Number(tx ?? 0), clientY: y * Number(zoom ?? 1) + Number(ty ?? 0) };
  }

  function pointer(target: EventTarget, type: string, at: { clientX: number; clientY: number }, init: PointerEventInit = {}): PointerEvent {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse", ...at, ...init });
    target.dispatchEvent(event);
    return event;
  }

  /** Un clic sul punto `at` di `target`. */
  function click(host: HTMLElement, target: EventTarget, at: { clientX: number; clientY: number }, init: PointerEventInit = {}): void {
    pointer(target, "pointerdown", at, init);
    pointer(host.querySelector(".canvas-viewport")!, "pointerup", at, init);
  }

  /** Tira un filo da `from` (un punto, una presa, o Alt sul corpo) fino a `to`, dove sotto il puntatore c'è `under`. */
  function pull(
    host: HTMLElement,
    from: EventTarget,
    start: { clientX: number; clientY: number },
    to: { clientX: number; clientY: number },
    under: Element | null,
    init: PointerEventInit = {},
  ): void {
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(under);
    try {
      pointer(from, "pointerdown", start, init);
      pointer(viewport, "pointermove", to, init);
      pointer(viewport, "pointerup", to, init);
    } finally {
      pointing.mockRestore();
    }
  }

  const patchesOf = (change: CanvasChange): readonly CanvasPatch[] => (change.operation as CanvasOperation).patches ?? [];
  const last = <T,>(list: readonly T[]): T => list[list.length - 1]!;

  it("quattro punti sui lati; si tira da un punto e si rilascia su qualsiasi parte di un'altra scheda, il lato lo sceglie Fub", () => {
    const { engine, host, viewport, changes } = open();
    expect([...card(host, "a").querySelectorAll<HTMLElement>(":scope > .canvas-port")].map((one) => one.dataset.side))
      .toEqual(["top", "right", "bottom", "left"]);
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(body(host, "c"));
    pointer(port(host, "a", "bottom"), "pointerdown", screen(host, 100, 100));
    pointer(viewport, "pointermove", screen(host, 150, 380));
    // Durante il tiro: il tratto fino al lato che Fub sceglierà, la scheda
    // bersaglio segnata, niente ancora nel file.
    expect(host.querySelector(".canvas-edge-draft")?.getAttribute("d")).toBe("M 100 100 C 100 100, 100 300, 100 300");
    expect(card(host, "c").hasAttribute("data-connect-target")).toBe(true);
    expect(changes).toHaveLength(0);
    pointer(viewport, "pointerup", screen(host, 150, 380));
    pointing.mockRestore();
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "a", fromSide: "bottom", toNode: "c", toSide: "top", toEnd: "arrow" });
    expect(changes).toHaveLength(1);
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    expect(card(host, "c").hasAttribute("data-connect-target")).toBe(false);

    // Due schede sovrapposte: il bersaglio è quella sopra (lo dà `elementFromPoint`).
    pull(host, port(host, "b", "bottom"), screen(host, 500, 100), screen(host, 520, 340), card(host, "e"));
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "b", toNode: "e", fromSide: "bottom", toSide: "top" });
    expect(changes).toHaveLength(2);

    // Sulla scheda da cui parte non nasce niente.
    pull(host, port(host, "a", "right"), screen(host, 200, 50), screen(host, 120, 60), card(host, "a"));
    expect(changes).toHaveLength(2);
    engine.destroy();
  });

  it("rilasciato nel vuoto nasce una scheda di testo collegata, già in scrittura, e un solo annulla toglie scheda e filo", () => {
    const { engine, host, viewport, changes } = open();
    const before = engine.getDoc();
    pull(host, port(host, "b", "right"), screen(host, 600, 50), screen(host, 900, 60), viewport);
    expect(changes).toHaveLength(1);
    expect(patchesOf(changes[0]!).map((patch) => patch.kind)).toEqual(["upsert-node", "upsert-edge"]);
    const after = doc(engine);
    const made = after.nodes.find((node) => !["a", "b", "c", "s", "d", "e"].includes(node.id))!;
    expect(made).toMatchObject({ type: "text", width: 320, height: 160 });
    // Il lato sinistro, verso `b`, cade sotto il puntatore (alla griglia).
    expect(Math.abs(made.x - 900)).toBeLessThanOrEqual(8);
    expect(Math.abs(made.y + made.height / 2 - 60)).toBeLessThanOrEqual(8);
    expect(after.edges.find((edge) => edge.toNode === made.id)).toMatchObject({ fromNode: "b", fromSide: "right", toSide: "left" });
    expect(host.querySelector(".canvas-text-editor")).not.toBeNull();
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);

    // Un clic fermo su un punto non fa una scheda.
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(viewport);
    click(host, port(host, "a", "top"), screen(host, 100, 0));
    pointing.mockRestore();
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("Esc durante il tiro annulla tutto: niente tratto, niente filo, niente scheda", () => {
    const { engine, host, viewport, changes } = open();
    const before = engine.getDoc();
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(viewport);
    pointer(port(host, "a", "bottom"), "pointerdown", screen(host, 100, 100));
    pointer(viewport, "pointermove", screen(host, 100, 600));
    expect(host.querySelector(".canvas-edge-draft")).not.toBeNull();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    viewport.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    pointer(viewport, "pointerup", screen(host, 100, 600));
    pointing.mockRestore();
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("Alt+trascina dal corpo di una scheda tira un filo; nel vuoto Alt sposta ancora la vista", () => {
    const { engine, host, viewport } = open();
    pull(host, body(host, "a"), screen(host, 100, 60), screen(host, 100, 350), card(host, "c"), { altKey: true });
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "a", fromSide: "bottom", toNode: "c", toSide: "top" });
    const edges = doc(engine).edges.length;
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const camera = stage.style.transform;
    pointer(viewport, "pointerdown", { clientX: 900, clientY: 900 }, { altKey: true, pointerId: 8 });
    pointer(viewport, "pointermove", { clientX: 940, clientY: 920 }, { altKey: true, pointerId: 8 });
    pointer(viewport, "pointerup", { clientX: 940, clientY: 920 }, { altKey: true, pointerId: 8 });
    expect(stage.style.transform).not.toBe(camera);
    expect(doc(engine).edges).toHaveLength(edges);
    engine.destroy();
  });

  it("C con due schede scelte le collega; con una comincia il collegamento", () => {
    const { engine, host, viewport } = open();
    click(host, body(host, "a"), screen(host, 100, 30));
    click(host, body(host, "c"), screen(host, 100, 350), { shiftKey: true });
    viewport.focus();
    const c = new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true });
    viewport.dispatchEvent(c);
    expect(c.defaultPrevented).toBe(true);
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "a", fromSide: "bottom", toNode: "c", toSide: "top", toEnd: "arrow" });
    expect(viewport.dataset.tool).toBe("select");

    click(host, body(host, "b"), screen(host, 500, 30));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));
    expect(viewport.dataset.tool).toBe("connect");
    engine.destroy();
  });

  it("riattaccare: su un'altra scheda l'estremità cambia scheda e lato; nel vuoto torna dov'era, niente cancellato", () => {
    const { engine, host, viewport, changes } = open();
    const handle = () => host.querySelector<SVGElement>('[data-reconnect="e1"][data-endpoint="to"]');
    click(host, viewport, screen(host, 300, 45));
    expect(handle()).not.toBeNull();
    const before = engine.getDoc();
    pull(host, handle()!, screen(host, 400, 50), screen(host, 800, 700), viewport);
    expect(engine.getDoc()).toBe(before);
    expect(changes).toHaveLength(0);
    click(host, viewport, screen(host, 300, 45));
    pull(host, handle()!, screen(host, 400, 50), screen(host, 100, 380), card(host, "c"));
    expect(doc(engine).edges).toHaveLength(1);
    expect(doc(engine).edges[0]).toMatchObject({ id: "e1", fromNode: "a", fromSide: "right", toNode: "c", toSide: "top" });
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("le prese del filo scelto stanno sopra le schede: un livello dopo lo stage, e il riattacco non nasce da un punto (T91)", async () => {
    const { engine, host, viewport, changes } = open();
    click(host, viewport, screen(host, 300, 45));
    const handle = host.querySelector<SVGElement>('[data-reconnect="e1"][data-endpoint="to"]')!;
    // Le prese non stanno nello stage (dove i punti delle schede le coprono): sono un livello dopo di lui.
    const layer = handle.closest(".canvas-edge-handles");
    const stage = host.querySelector(".canvas-stage")!;
    expect(layer).not.toBeNull();
    expect(stage.contains(handle)).toBe(false);
    expect(stage.compareDocumentPosition(layer!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const structure = (await import("../../theme/scrittoio/structure.css?raw")).default;
    expect(structure).toMatch(/\.canvas-edge-reconnect\s*\{\s*pointer-events:\s*auto;/);
    // Trascinata su «c», la presa riattacca il filo: un commit, nessun filo nuovo, e l'annulla lo riporta.
    const before = engine.getDoc();
    pull(host, handle, screen(host, 400, 50), screen(host, 100, 380), card(host, "c"));
    expect(doc(engine).edges).toHaveLength(1);
    expect(doc(engine).edges[0]).toMatchObject({ id: "e1", fromNode: "a", toNode: "c" });
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("i fili stanno nello stage, prima di ogni scheda: un gruppo sta sotto il filo, le schede sopra (T91)", async () => {
    const grouped = JSON.stringify({
      nodes: [
        { id: "g", type: "group", x: 150, y: -20, width: 300, height: 140, label: "Gruppo" },
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "a" },
        { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "b" },
      ],
      edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", toEnd: "arrow" }],
    });
    const { engine, host } = mounted(grouped);
    const stage = host.querySelector(".canvas-stage")!;
    const edges = host.querySelector(".canvas-edges")!;
    // Il livello dei fili è il primo figlio dello stage: ogni scheda gli sta sopra nell'ordine del DOM.
    expect(stage.firstElementChild).toBe(edges);
    expect(host.querySelector('.canvas-node[data-node="g"]')!.classList.contains("canvas-node-group")).toBe(true);
    // Scegliere una scheda ricompone lo stage: il filo resta il primo.
    click(host, body(host, "b"), screen(host, 500, 30));
    expect(card(host, "b").classList.contains("selected")).toBe(true);
    expect(stage.firstElementChild).toBe(edges);
    // Il gruppo va sotto i fili (z-index negativo), le schede no: lo dice la pelle della struttura.
    const structure = (await import("../../theme/scrittoio/structure.css?raw")).default;
    expect(structure).toMatch(/\.canvas-node-group\s*\{\s*z-index:\s*-1;/);
    engine.destroy();
  });

  it("un filo si prende entro 8 px e si scurisce al passaggio; sopra una scheda vince dove si vede; Canc lo toglie con la patch `at`", () => {
    const { engine, host, viewport, changes } = open();
    const line = () => host.querySelector<SVGElement>('.canvas-edge-line[data-edge="e1"]')!;
    const group = () => line().parentElement!;
    // Il passaggio: entro 8 px il filo si scurisce, fuori no.
    pointer(viewport, "pointermove", screen(host, 300, 43));
    expect(group().hasAttribute("data-hover")).toBe(true);
    pointer(viewport, "pointermove", screen(host, 300, 30));
    expect(group().hasAttribute("data-hover")).toBe(false);
    // A 10 px non si prende.
    click(host, viewport, screen(host, 300, 40));
    expect(line().classList.contains("selected")).toBe(false);
    // Sopra `s`, a 7 px dal filo che lì si vede (fuori da `s`): il filo.
    click(host, body(host, "s"), screen(host, 300, 57));
    expect(line().classList.contains("selected")).toBe(true);
    expect(card(host, "s").classList.contains("selected")).toBe(false);
    // Più giù su `s`, fuori dagli 8 px: la scheda.
    click(host, body(host, "s"), screen(host, 300, 80));
    expect(card(host, "s").classList.contains("selected")).toBe(true);
    expect(line().classList.contains("selected")).toBe(false);
    // Entro 8 px nel vuoto: il filo; Canc lo toglie con `at`, Ctrl+Z lo rimette lì.
    click(host, viewport, screen(host, 220, 44));
    expect(line().classList.contains("selected")).toBe(true);
    const before = engine.getDoc();
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(patchesOf(last(changes))).toEqual([expect.objectContaining({ kind: "remove-edge", at: 0, after: null })]);
    expect(doc(engine).edges).toHaveLength(0);
    expect(doc(engine).nodes).toHaveLength(6);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("in sola lettura niente punti né prese, Alt non collega, ma i fili si scelgono per leggerli", () => {
    const { engine, host, viewport, changes } = open();
    engine.setReadOnly(true);
    expect(host.querySelector(".canvas-port")).toBeNull();
    click(host, viewport, screen(host, 300, 45));
    expect(host.querySelector('.canvas-edge-line[data-edge="e1"]')!.classList.contains("selected")).toBe(true);
    expect(host.querySelector("[data-reconnect]")).toBeNull();
    pull(host, body(host, "a"), screen(host, 100, 60), screen(host, 100, 350), card(host, "c"), { altKey: true });
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    expect(changes).toHaveLength(0);
    engine.setReadOnly(false);
    expect(card(host, "a").querySelectorAll(":scope > .canvas-port")).toHaveLength(4);
    engine.destroy();
  });

  it("la penna scrive, non collega: da un punto non tira un filo", () => {
    const { engine, host, changes } = open();
    pull(host, port(host, "a", "bottom"), screen(host, 100, 100), screen(host, 100, 350), card(host, "c"), { pointerType: "pen" });
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    expect(doc(engine).edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(changes.filter((change) => patchesOf(change).some((patch) => patch.kind === "upsert-edge"))).toHaveLength(0);
    engine.destroy();
  });
});

// Le maniglie per ridimensionare (T66): quattro angoli, Maiusc e Alt, la
// presa a ogni zoom e del dito, il doppio clic che adatta al contenuto, la
// cornice di più schede scelte; ogni gesto è un commit e un annulla.
describe("le maniglie delle schede (T66)", () => {
  const INK_STROKE = {
    id: "s-1", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 },
    ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  function board(): string {
    return JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "una nota", "fub:ink": { v: 1, strokes: [INK_STROKE] } },
        { id: "f", type: "file", x: 400, y: 40, width: 240, height: 140, file: "allegati/foto.png" },
        { id: "w", type: "link", x: 400, y: 240, width: 240, height: 100, url: "https://example.com/x" },
        { id: "p", type: "text", x: 40, y: 400, width: 40, height: 40, text: "." },
      ],
      edges: [],
    });
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const stageOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-stage")!;
  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const handle = (host: HTMLElement, id: string, corner: string): HTMLElement =>
    card(host, id).querySelector<HTMLElement>(`.canvas-resize[data-corner="${corner}"]`)!;

  function zoomOf(host: HTMLElement): number {
    const match = /scale\(([\d.e+-]+)\)/.exec(stageOf(host).style.transform);
    if (!match) throw new Error("niente zoom");
    return Number(match[1]);
  }

  function nodeOf(engine: CanvasEngine, id: string): CanvasDocument["nodes"][number] {
    return readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;
  }

  function boxOf(engine: CanvasEngine, id: string): [number, number, number, number] {
    const node = nodeOf(engine, id);
    return [node.x, node.y, node.width, node.height];
  }

  /** Tira `grip` di `(dx, dy)` unità della lavagna, coi tasti `keys` tenuti giù. */
  function pull(host: HTMLElement, grip: HTMLElement, dx: number, dy: number, keys: { shiftKey?: boolean; altKey?: boolean } = {}): void {
    const zoom = zoomOf(host);
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", clientX: 100, clientY: 100, ...keys }));
    const at = { clientX: 100 + dx * zoom, clientY: 100 + dy * zoom };
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, pointerId: 7, pointerType: "mouse", ...at, ...keys }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "mouse", ...at, ...keys }));
  }

  function choose(host: HTMLElement, id: string): void {
    card(host, id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function chooseAll(host: HTMLElement): void {
    const viewport = viewportOf(host);
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
  }

  function zoomKey(host: HTMLElement, key: "+" | "-"): void {
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }));
  }

  it("ogni scheda ha quattro maniglie agli angoli, in sola lettura nessuna", () => {
    const { engine, host } = mounted(board());
    for (const id of ["t", "f", "w", "p"]) {
      const grips = [...card(host, id).querySelectorAll<HTMLElement>(".canvas-resize")];
      expect(grips.map((grip) => grip.dataset.corner)).toEqual(["se", "sw", "ne", "nw"]);
      for (const grip of grips) expect(grip.dataset.resize).toBe(id);
    }
    engine.setReadOnly(true);
    expect(host.querySelector(".canvas-resize")).toBeNull();
    engine.setReadOnly(false);
    expect(host.querySelectorAll(".canvas-resize")).toHaveLength(16);
    engine.destroy();
  });

  it.each([
    ["se", 48, 36, [40, 40, 288, 176]],
    ["sw", -48, 36, [-8, 40, 288, 176]],
    ["ne", 48, -36, [40, 4, 288, 176]],
    ["nw", -48, -36, [-8, 4, 288, 176]],
  ] as const)("la maniglia %s tira il suo angolo e l'opposto resta fermo, un commit e un annulla", (corner, dx, dy, expected) => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    choose(host, "t");
    pull(host, handle(host, "t", corner), dx, dy);
    expect(boxOf(engine, "t")).toEqual(expected);
    expect(changes).toHaveLength(1);
    // L'inchiostro attaccato resta nella scheda, e la segue.
    expect(nodeOf(engine, "t")["fub:ink"]).toEqual({ v: 1, strokes: [INK_STROKE] });
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("Maiusc tiene le proporzioni, Alt ridimensiona dal centro, e tutti e due insieme", () => {
    const { engine, host } = mounted(board());
    choose(host, "t");
    pull(host, handle(host, "t", "se"), 120, 0, { shiftKey: true });
    expect(boxOf(engine, "t")).toEqual([40, 40, 360, 210]);
    engine.undo();
    pull(host, handle(host, "t", "se"), 24, 20, { altKey: true });
    // 240 + 2·24 = 288; 140 + 2·20 = 180. Alt spegne l'aggancio (T71), quindi
    // niente griglia sull'altezza; il centro resta.
    expect(boxOf(engine, "t")).toEqual([16, 20, 288, 180]);
    engine.undo();
    pull(host, handle(host, "t", "se"), 60, 0, { shiftKey: true, altKey: true });
    expect(boxOf(engine, "t")).toEqual([-20, 5, 360, 210]);
    engine.destroy();
  });

  it("non scende sotto il minimo di una scheda", () => {
    const { engine, host } = mounted(board());
    choose(host, "t");
    pull(host, handle(host, "t", "nw"), 1000, 1000);
    expect(boxOf(engine, "t")).toEqual([240, 140, 40, 40]);
    engine.destroy();
  });

  it("l'area di presa è di 20 px sullo schermo a ogni zoom: la lavagna dice lo zoom alla pelle", async () => {
    const { engine, host } = mounted(board());
    const stage = stageOf(host);
    expect(stage.style.getPropertyValue("--canvas-zoom")).toBe(String(zoomOf(host)));
    const first = zoomOf(host);
    zoomKey(host, "-");
    expect(zoomOf(host)).not.toBe(first);
    expect(stage.style.getPropertyValue("--canvas-zoom")).toBe(String(zoomOf(host)));
    const structure = (await import("../../theme/scrittoio/structure.css?raw")).default;
    expect(structure).toContain("width: calc(20px / var(--canvas-zoom, 1));");
    expect(structure).toContain("height: calc(20px / var(--canvas-zoom, 1));");
    engine.destroy();
  });

  it("una scheda piccolissima sullo schermo tiene solo la maniglia in basso a destra", () => {
    const { engine, host } = mounted(board());
    for (let i = 0; i < 20 && zoomOf(host) * 40 >= 24; i++) zoomKey(host, "-");
    expect(zoomOf(host) * 40).toBeLessThan(24);
    expect(card(host, "p").dataset.handles).toBe("one");
    expect(card(host, "t").dataset.handles).toBeUndefined();
    for (let i = 0; i < 40 && zoomOf(host) * 40 < 24; i++) zoomKey(host, "+");
    expect(card(host, "p").dataset.handles).toBeUndefined();
    engine.destroy();
  });

  it("col dito l'angolo della scheda scelta si prende entro 22 px, più in là no", () => {
    const { engine, host, changes } = mounted(board());
    choose(host, "t");
    const zoom = zoomOf(host);
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(stageOf(host).style.transform)!;
    const corner = { x: Number(match[1]) + (40 + 240) * zoom, y: Number(match[2]) + (40 + 140) * zoom };
    const touch = (type: string, x: number, y: number, pointerId: number) =>
      viewportOf(host).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId, pointerType: "touch", clientX: x, clientY: y }));
    // A 30 px dall'angolo il dito sposta la lavagna, la scheda resta.
    touch("pointerdown", corner.x + 30, corner.y + 30, 11);
    touch("pointermove", corner.x + 30 + 40 * zoom, corner.y + 30, 11);
    touch("pointerup", corner.x + 30 + 40 * zoom, corner.y + 30, 11);
    expect(boxOf(engine, "t")).toEqual([40, 40, 240, 140]);
    expect(changes).toHaveLength(0);
    // A 20 px la prende: la camera si è mossa, l'angolo con lei.
    const moved = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(stageOf(host).style.transform)!;
    const grip = { x: Number(moved[1]) + (40 + 240) * zoom + 20, y: Number(moved[2]) + (40 + 140) * zoom + 20 };
    touch("pointerdown", grip.x, grip.y, 12);
    touch("pointermove", grip.x + 48 * zoom, grip.y + 36 * zoom, 12);
    touch("pointerup", grip.x + 48 * zoom, grip.y + 36 * zoom, 12);
    expect(boxOf(engine, "t")).toEqual([40, 40, 288, 176]);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("più schede scelte: la cornice della scelta scala tutto, l'inchiostro attaccato segue, un annulla", () => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    chooseAll(host);
    expect(stageOf(host).dataset.selection).toBe("many");
    const frame = host.querySelector<HTMLElement>(".canvas-selection-frame")!;
    expect(frame.parentElement).toBe(stageOf(host));
    expect(frame.querySelectorAll(".canvas-resize[data-resize-frame]")).toHaveLength(4);
    // La scelta va da (40, 40) a (640, 440): 600 × 400.
    expect([frame.style.transform, frame.style.width, frame.style.height]).toEqual(["translate(40px, 40px)", "600px", "400px"]);
    pull(host, frame.querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!, 600, 400);
    // Tutto raddoppia dall'angolo in alto a sinistra della scelta.
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 280]);
    expect(boxOf(engine, "f")).toEqual([760, 40, 480, 280]);
    expect(boxOf(engine, "w")).toEqual([760, 440, 480, 200]);
    expect(boxOf(engine, "p")).toEqual([40, 760, 80, 80]);
    expect(nodeOf(engine, "t")["fub:ink"]).toEqual({ v: 1, strokes: [INK_STROKE] });
    expect(changes).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".canvas-selection-frame")!.style.width).toBe("1200px");
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    // Una scheda sola: niente cornice.
    choose(host, "t");
    expect(stageOf(host).dataset.selection).toBe("many");
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    choose(host, "t");
    expect(stageOf(host).dataset.selection).toBeUndefined();
    expect(host.querySelector(".canvas-selection-frame")).toBeNull();
    engine.destroy();
  });

  it("la cornice non lascia una scheda sotto il minimo", () => {
    const { engine, host } = mounted(board());
    chooseAll(host);
    pull(host, host.querySelector<HTMLElement>('.canvas-selection-frame .canvas-resize[data-corner="se"]')!, -2000, -2000);
    for (const id of ["t", "f", "w", "p"]) {
      const node = nodeOf(engine, id);
      expect(node.width, id).toBeGreaterThanOrEqual(40);
      expect(node.height, id).toBeGreaterThanOrEqual(40);
    }
    expect(boxOf(engine, "p").slice(2)).toEqual([40, 40]);
    engine.destroy();
  });

  it("doppio clic su una maniglia: la scheda di testo prende la misura del testo, fino a 480 px", () => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    const article = card(host, "t");
    const body = article.querySelector<HTMLElement>(".canvas-card-body")!;
    // Un'impaginazione finta: il testo vuole 620 px su una riga, a 480 va su
    // più righe e chiede 150 px; la testata è di 28.
    let natural = 620;
    let lines = 150;
    Object.defineProperty(article, "offsetWidth", { configurable: true, get: () => article.style.width === "max-content" ? natural : parseFloat(article.style.width) });
    Object.defineProperty(article, "offsetHeight", { configurable: true, get: () => parseFloat(article.style.height) || 0 });
    Object.defineProperty(body, "offsetHeight", { configurable: true, get: () => Math.max(0, (parseFloat(article.style.height) || 0) - 28) });
    Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => lines });
    handle(host, "t", "ne").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 184]);
    expect(changes).toHaveLength(1);
    // Lo stile della scheda è quello della misura nuova, non della misura.
    expect([article.style.width, article.style.height]).toEqual(["480px", "184px"]);
    // Il doppio clic sulla maniglia non apre il campo.
    expect(host.querySelector(".canvas-text-editor, .canvas-field-editor")).toBeNull();
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    // Un testo corto: la sua larghezza, agganciata per eccesso.
    natural = 130;
    lines = 60;
    handle(host, "t", "se").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "t")).toEqual([40, 40, 136, 88]);
    engine.destroy();
  });

  it("doppio clic su una maniglia: un'immagine prende le proporzioni del contenuto alla larghezza di adesso; le altre non cambiano", () => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    const picture = document.createElement("img");
    Object.defineProperty(picture, "naturalWidth", { value: 400 });
    Object.defineProperty(picture, "naturalHeight", { value: 300 });
    card(host, "f").querySelector(".canvas-card-body")!.append(picture);
    handle(host, "f", "sw").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "f")).toEqual([400, 40, 240, 180]);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    // Come in Chromium: la maniglia presa e lasciata cattura il puntatore, e
    // il doppio clic arriva alla vista. Adatta lo stesso, senza nuove schede.
    for (let i = 0; i < 2; i++) pull(host, handle(host, "f", "se"), 0, 0);
    viewportOf(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "f")).toEqual([400, 40, 240, 180]);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(engine.undo()).toBe(true);
    // Una pagina web non ha una misura sua: niente cambia.
    const count = changes.length;
    handle(host, "w", "se").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(changes).toHaveLength(count);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });
});
