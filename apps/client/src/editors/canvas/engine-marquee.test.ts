// @vitest-environment happy-dom
// Il rettangolo del trascinamento nel vuoto con la Selezione (N6 T20b): col mouse
// sceglie le schede che tocca (e i fili fra due di loro), Maiusc aggiunge, Esc
// annulla, un clic toglie la scelta come prima. Il dito e la penna nel vuoto
// spostano sempre la vista; «sposta la vista» tiene il gesto di prima. Il
// rettangolo non ricalcola le schede che non cambiano, e la scelta si aggiorna
// una volta per fotogramma. La geometria pura sta in `marquee.test.ts`; il gesto
// che perde il rilascio in `engine-lost-release.test.ts`.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine, type CanvasChange } from "./engine";
import { DEFAULT_PREFERENCES, type CanvasPreferences, type DragEmptyAction } from "./preferences";
import { canvasCoreReady } from "./wasm/core";
import { t } from "../../i18n/strings";
import { setReducedMotionPreference } from "../../theme/reduced-motion";

// Le impostazioni della lavagna: il motore monta `watchPreferences`, e la prova
// tiene le sue funzioni per cambiare «Trascinare nel vuoto» a lavagna aperta, come
// farebbe un cambio da Impostazioni. Il resto del modulo è quello vero.
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

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  setReducedMotionPreference(false);
  watched.appliers = [];
  vi.restoreAllMocks();
});

// Due schede, a sinistra e a destra; «a» e «b» sono a 200 px l'una dall'altra.
const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

// Come `BOARD`, con un filo fra «a» e «b» e un altro da «a» a una scheda lontana.
const LINKED = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
    { id: "c", type: "text", x: 2000, y: 2000, width: 200, height: 100, text: "lontana" },
  ],
  edges: [
    { id: "e", fromNode: "a", toNode: "b" },
    { id: "f", fromNode: "a", toNode: "c" },
  ],
});

/** Una riga di `count` schede, ognuna larga 100 e alta 60, a 120 px l'una dall'altra. */
function row(count: number): string {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `n${index}`, type: "text", x: index * 120, y: 0, width: 100, height: 60, text: `${index}`,
  }));
  return JSON.stringify({ nodes, edges: [] });
}

/** Un evento del puntatore sul bersaglio `target`; `timeStamp` si legge come nel browser. */
function pointer(target: EventTarget, type: string, init: PointerEventInit & { readonly timeStamp?: number }): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerType: "mouse", ...rest,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
  return event;
}

function mounted(source: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "marquee",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
  });
  engine.setDoc(source);
  return { engine, host, changes };
}

/** «Trascinare nel vuoto» cambiata a lavagna aperta, come la manda un cambio da Impostazioni. */
function setDragEmpty(value: DragEmptyAction): void {
  for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, dragEmpty: value });
}

const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
const handleOf = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"] .canvas-node-handle`)!;

function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/**
 * Il punto dello schermo dove sta il punto `x`, `y` della lavagna, con la vista
 * come sta adesso: `setDoc` centra la vista, quindi i numeri della lavagna non
 * sono quelli dello schermo.
 */
function screenOf(host: HTMLElement, x: number, y: number): { clientX: number; clientY: number } {
  const camera = cameraOf(host);
  return { clientX: x * camera.zoom + camera.x, clientY: y * camera.zoom + camera.y };
}

/** Il riquadro del rettangolo come lo disegna il motore, in coordinate della lavagna, o `null`. */
function marqueeOf(host: HTMLElement): { x: number; y: number; width: number; height: number } | null {
  const box = host.querySelector<SVGRectElement>(".canvas-marquee-box");
  if (!box) return null;
  return {
    x: Number(box.getAttribute("x")),
    y: Number(box.getAttribute("y")),
    width: Number(box.getAttribute("width")),
    height: Number(box.getAttribute("height")),
  };
}

/** Lascia passare un fotogramma: il rettangolo aggiorna la scelta nel suo fotogramma. */
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Sceglie la scheda `id` col clic sulla sua maniglia, senza spostarla. */
function pick(host: HTMLElement, id: string, shiftKey = false): void {
  pointer(handleOf(host, id), "pointerdown", { pointerId: 1, button: 0, buttons: 1, shiftKey, ...at(20, 20) });
  pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, shiftKey, ...at(20, 20) });
}

function at(clientX: number, clientY: number) {
  return { clientX, clientY };
}

/**
 * Il trascinamento sinistro sul vuoto, dal punto `from` al punto `to` della
 * lavagna, senza rilascio: il puntatore preme e va in `to`.
 */
function dragOnEmpty(host: HTMLElement, from: readonly [number, number], to: readonly [number, number], shiftKey = false): void {
  const viewport = viewportOf(host);
  pointer(viewport, "pointerdown", { pointerId: 1, button: 0, buttons: 1, shiftKey, ...screenOf(host, ...from) });
  pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, shiftKey, ...screenOf(host, ...to) });
}

/** Il rilascio del rettangolo al punto `to` della lavagna. */
function release(host: HTMLElement, to: readonly [number, number], shiftKey = false): void {
  pointer(viewportOf(host), "pointerup", { pointerId: 1, button: 0, buttons: 0, shiftKey, ...screenOf(host, ...to) });
}

describe("il rettangolo del trascinamento nel vuoto con la Selezione (N6 T20b)", () => {
  it("col mouse sceglie le schede che tocca mentre il riquadro si vede, e al rilascio la scelta resta e il riquadro esce", async () => {
    const { engine, host, changes } = mounted(BOARD);
    const camera = cameraOf(host);
    dragOnEmpty(host, [-50, -50], [250, 150]);
    expect(marqueeOf(host)).toEqual({ x: -50, y: -50, width: 300, height: 200 });
    await frame();
    expect(engine.selection().nodes).toEqual(["a"]);
    expect(cameraOf(host)).toEqual(camera);
    release(host, [250, 150]);
    expect(engine.selection().nodes).toEqual(["a"]);
    expect(marqueeOf(host)).toBeNull();
    expect(changes, "scegliere non cambia il documento").toEqual([]);
    engine.destroy();
  });

  it("la scelta si aggiorna una volta per fotogramma: prima del fotogramma resta quella di prima", async () => {
    const { engine, host } = mounted(BOARD);
    dragOnEmpty(host, [-50, -50], [250, 150]);
    expect(engine.selection().nodes).toEqual([]);
    await frame();
    expect(engine.selection().nodes).toEqual(["a"]);
    release(host, [250, 150]);
    engine.destroy();
  });

  it("Maiusc aggiunge alla scelta che c'è, e senza Maiusc la sostituisce", async () => {
    const { engine, host } = mounted(BOARD);
    pick(host, "b");
    expect(engine.selection().nodes).toEqual(["b"]);
    dragOnEmpty(host, [-50, -50], [250, 150], true);
    await frame();
    expect([...engine.selection().nodes].sort()).toEqual(["a", "b"]);
    release(host, [250, 150], true);
    dragOnEmpty(host, [-50, -50], [250, 150]);
    await frame();
    expect(engine.selection().nodes).toEqual(["a"]);
    release(host, [250, 150]);
    engine.destroy();
  });

  it("Esc annulla il rettangolo: la scelta torna com'era, e il rilascio che arriva dopo non fa niente", async () => {
    const { engine, host } = mounted(BOARD);
    pick(host, "b");
    dragOnEmpty(host, [-50, -50], [250, 150]);
    await frame();
    expect(engine.selection().nodes).toEqual(["a"]);
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(engine.selection().nodes).toEqual(["b"]);
    expect(marqueeOf(host)).toBeNull();
    release(host, [250, 150]);
    expect(engine.selection().nodes).toEqual(["b"]);
    engine.destroy();
  });

  it("un clic senza spostamento toglie la scelta come prima, e con Maiusc la lascia", () => {
    const { engine, host } = mounted(BOARD);
    const viewport = viewportOf(host);
    pick(host, "b");
    pointer(viewport, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...screenOf(host, 100, 300) });
    // La scelta resta fino al rilascio: il clic non ha ancora detto di essere un clic.
    expect(engine.selection().nodes).toEqual(["b"]);
    pointer(viewport, "pointerup", { pointerId: 1, button: 0, buttons: 0, ...screenOf(host, 100, 300) });
    expect(engine.selection().nodes).toEqual([]);
    pick(host, "b");
    pointer(viewport, "pointerdown", { pointerId: 1, button: 0, buttons: 1, shiftKey: true, ...screenOf(host, 100, 300) });
    pointer(viewport, "pointerup", { pointerId: 1, button: 0, buttons: 0, shiftKey: true, ...screenOf(host, 100, 300) });
    expect(engine.selection().nodes).toEqual(["b"]);
    engine.destroy();
  });

  it("il dito nel vuoto sposta sempre la vista, e il rettangolo non c'è", () => {
    const { engine, host } = mounted(BOARD);
    const viewport = viewportOf(host);
    pick(host, "b");
    const start = cameraOf(host);
    pointer(viewport, "pointerdown", { pointerId: 5, pointerType: "touch", button: 0, buttons: 1, ...at(600, 400) });
    pointer(viewport, "pointermove", { pointerId: 5, pointerType: "touch", buttons: 1, ...at(640, 400) });
    expect(cameraOf(host).x - start.x).toBeCloseTo(40, 6);
    expect(marqueeOf(host)).toBeNull();
    pointer(viewport, "pointerup", { pointerId: 5, pointerType: "touch", button: 0, buttons: 0, ...at(640, 400) });
    engine.destroy();
  });

  it("un trascinamento che parte dal corpo di una scheda non apre il rettangolo: la scheda prende il gesto", async () => {
    const { engine, host, changes } = mounted(BOARD);
    const viewport = viewportOf(host);
    const body = host.querySelector<HTMLElement>('.canvas-node[data-node="a"]')!;
    const start = cameraOf(host);
    pointer(body, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...at(100, 50) });
    pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, ...at(300, 200) });
    await frame();
    expect(marqueeOf(host)).toBeNull();
    expect(cameraOf(host)).toEqual(start);
    expect(engine.selection().nodes).toEqual(["a"]);
    pointer(viewport, "pointerup", { pointerId: 1, button: 0, buttons: 0, ...at(300, 200) });
    expect(changes).toEqual([]);
    engine.destroy();
  });

  it("in sola lettura il rettangolo sceglie e non cambia niente", async () => {
    const { engine, host, changes } = mounted(BOARD);
    engine.setReadOnly(true);
    dragOnEmpty(host, [-50, -50], [250, 150]);
    await frame();
    expect(engine.selection().nodes).toEqual(["a"]);
    release(host, [250, 150]);
    expect(changes).toEqual([]);
    engine.destroy();
  });

  it("un filo fra due schede scelte va con loro, e un filo verso una scheda fuori no", async () => {
    const { engine, host } = mounted(LINKED);
    dragOnEmpty(host, [-50, -50], [700, 150]);
    await frame();
    expect(engine.selection()).toEqual({ nodes: ["a", "b"], edges: ["e"] });
    release(host, [700, 150]);
    engine.destroy();
  });

  it("un fotogramma cambia la classe delle sole schede che cambiano stato, e il riquadro non tocca le altre", async () => {
    const { engine, host } = mounted(row(12));
    // Ogni scheda conta le sue scritture della classe «selected»: il motore non le
    // fa sulle schede che restano com'erano.
    const spies = [...host.querySelectorAll<HTMLElement>(".canvas-node")].map((card) => vi.spyOn(card.classList, "toggle"));
    const selectedToggles = (): number => spies.reduce(
      (count, spy) => count + spy.mock.calls.filter(([token]) => token === "selected").length,
      0,
    );
    // Solo la prima scheda: una sola classe cambia.
    dragOnEmpty(host, [-10, -10], [50, 70]);
    await frame();
    expect(engine.selection().nodes).toEqual(["n0"]);
    expect(selectedToggles()).toBe(1);
    // Il rettangolo si allarga dentro la stessa scheda: nessuna classe cambia.
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, 60, 70) });
    await frame();
    expect(selectedToggles()).toBe(1);
    // Arriva la seconda: cambia solo lei.
    pointer(viewportOf(host), "pointermove", { pointerId: 1, buttons: 1, ...screenOf(host, 130, 70) });
    await frame();
    expect(engine.selection().nodes).toEqual(["n0", "n1"]);
    expect(selectedToggles()).toBe(2);
    release(host, [130, 70]);
    engine.destroy();
  });

  it("con 2.000 schede il rettangolo sceglie quelle che tocca, come con poche", async () => {
    const { engine, host } = mounted(row(2000));
    // Le prime 50 schede (la scheda i sta a x = 120 · i): il rettangolo arriva a
    // x 5930, dove la cinquantesima (x 5880) è toccata e la cinquantunesima (6000) no.
    dragOnEmpty(host, [-10, -10], [49 * 120 + 50, 70]);
    await frame();
    expect(engine.selection().nodes).toHaveLength(50);
    release(host, [49 * 120 + 50, 70]);
    engine.destroy();
  }, 60_000);

  it("la riga della Selezione dice il gesto di adesso: cambiata l'impostazione, il suggerimento si rifà", () => {
    const { engine, host } = mounted(BOARD);
    const hint = () => host.querySelector(".canvas-options-hint")?.textContent;
    expect(hint()).toBe(t("canvas.options.select_hint"));
    setDragEmpty("pan");
    expect(hint()).toBe(t("canvas.options.select_hint_pan"));
    setDragEmpty("select");
    expect(hint()).toBe(t("canvas.options.select_hint"));
    engine.destroy();
  });

  it("con «sposta la vista» il vuoto si trascina come prima: la scelta si toglie alla pressione, e la vista si sposta", () => {
    const { engine, host } = mounted(BOARD);
    setDragEmpty("pan");
    const viewport = viewportOf(host);
    pick(host, "b");
    const start = cameraOf(host);
    const press = screenOf(host, 100, 300);
    pointer(viewport, "pointerdown", { pointerId: 1, button: 0, buttons: 1, ...press });
    expect(engine.selection().nodes).toEqual([]);
    const moved = { clientX: press.clientX + 40, clientY: press.clientY + 30 };
    pointer(viewport, "pointermove", { pointerId: 1, buttons: 1, ...moved });
    expect(cameraOf(host).x - start.x).toBeCloseTo(40, 6);
    expect(marqueeOf(host)).toBeNull();
    pointer(viewport, "pointerup", { pointerId: 1, button: 0, buttons: 0, ...moved });
    engine.destroy();
  });

  it("chiudere la lavagna mentre si trascina non lascia un fotogramma che sceglie", async () => {
    const { engine, host } = mounted(BOARD);
    dragOnEmpty(host, [-50, -50], [250, 150]);
    engine.destroy();
    await frame();
    expect(engine.selection().nodes).toEqual([]);
    expect(host.querySelector(".canvas-marquee")).toBeNull();
  });
});
