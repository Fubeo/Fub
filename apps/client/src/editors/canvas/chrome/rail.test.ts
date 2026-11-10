// @vitest-environment happy-dom
// La colonna degli strumenti della lavagna (T49): gli strumenti, i loro tasti,
// la colonna personalizzata (`canvas.toolbar`) e la sola lettura.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { CanvasEngine } from "../engine";
import { DEFAULT_PREFERENCES, type CanvasPreferences } from "../preferences";
import { canvasCoreReady } from "../wasm/core";
import { CANVAS_COMMANDS, CANVAS_TOOL_IDS, CANVAS_TOOL_KEYS, toolCommandId } from "./commands";
import { CANVAS_RAIL_TOOLS, canvasRailLayout } from "./rail";

// Le impostazioni della lavagna: la prova tiene le funzioni di
// `watchPreferences` per cambiare la colonna a lavagna aperta, come farebbe un
// cambio da Impostazioni. Il resto del modulo è quello vero.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("../preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../preferences")>()),
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
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

function mounted(source = BOARD) {
  const host = document.createElement("div");
  document.body.append(host);
  const engine = new CanvasEngine(host, {
    surfaceId: "rail",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: () => {},
    onSelectionChange: () => {},
    // Né la penna né l'interruttore ricordati: la prova parte dalla Selezione.
    penMemory: { read: () => new Promise(() => {}), save: () => {} },
    inkMouseMemory: { read: () => new Promise(() => {}), save: () => {} },
  });
  engine.setDoc(source);
  return { engine, host };
}

const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
const slots = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".canvas-rail .kit-rail-slot")];
const slotOf = (host: HTMLElement, tool: string) =>
  slots(host).find((slot) => (slot.dataset.tools ?? "").split(" ").includes(tool))!;
const pressed = (host: HTMLElement) => slots(host).filter((slot) => slot.getAttribute("aria-pressed") === "true").map((slot) => slot.dataset.tool);
const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;

function key(target: EventTarget, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function preferences(toolbar: readonly string[]): void {
  for (const apply of watched.appliers) apply({ ...DEFAULT_PREFERENCES, toolbar });
}

function mouse(target: EventTarget, type: string, clientX: number, clientY: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 3, pointerType: "mouse", clientX, clientY }));
}

describe("la forma della colonna", () => {
  it("vuota è quella di serie: la penna con l'evidenziatore in tendina, tre gruppi", () => {
    expect(canvasRailLayout([])).toEqual([
      [["select"], ["hand"]],
      [["pen", "highlighter"], ["eraser"]],
      [["text"], ["connect"]],
    ]);
    expect(CANVAS_RAIL_TOOLS).toEqual(["select", "hand", "pen", "highlighter", "eraser", "text", "connect"]);
  });

  it("personalizzata: l'ordine scelto, un filo dove cambia la famiglia, un nome che non c'è si salta, la Selezione in cima", () => {
    expect(canvasRailLayout(["pen", "domani", "text", "pen", "hand"])).toEqual([
      [["select"]],
      [["pen"]],
      [["text"]],
      [["hand"]],
    ]);
    expect(canvasRailLayout(["hand", "select", "eraser"])).toEqual([[["hand"], ["select"]], [["eraser"]]]);
    // Solo nomi sconosciuti: quella di serie.
    expect(canvasRailLayout(["lasso", "domani"])).toEqual(canvasRailLayout([]));
  });
});

describe("la colonna della lavagna", () => {
  it("sta a sinistra della lavagna: una toolbar del kit con sei caselle, nome, tasto e suggerimento; di serie la Selezione", () => {
    const { host } = mounted();
    const rail = host.querySelector(".canvas-body > .canvas-rail > .kit-rail")!;
    expect(rail.getAttribute("role")).toBe("toolbar");
    expect(rail.getAttribute("aria-label")).toBe(t("menu.tools"));
    expect(host.querySelector(".canvas-body > .canvas-area > .canvas-viewport")).not.toBeNull();
    expect(slots(host).map((slot) => slot.dataset.slot)).toEqual(["select", "hand", "pen", "eraser", "text", "connect"]);
    expect(slotOf(host, "highlighter").dataset.tools).toBe("pen highlighter");
    expect(slotOf(host, "highlighter").getAttribute("aria-haspopup")).toBe("menu");
    const pen = slotOf(host, "pen");
    expect(pen.getAttribute("aria-label")).toBe(t("canvas.tool.pen"));
    expect(pen.getAttribute("aria-keyshortcuts")).toBe("P");
    expect(slotOf(host, "select").classList.contains("canvas-tool")).toBe(true);
    expect(pressed(host)).toEqual(["select"]);
    // Un solo punto di tabulazione, come il kit.
    expect(slots(host).filter((slot) => slot.tabIndex === 0)).toHaveLength(1);
    expect(viewportOf(host).dataset.tool).toBe("select");
  });

  it("ogni strumento è un comando del catalogo col suo tasto, e nessun tasto è doppio", () => {
    for (const tool of CANVAS_TOOL_IDS) {
      const spec = CANVAS_COMMANDS.find((each) => each.id === toolCommandId(tool));
      expect(spec?.keys, tool).toEqual([CANVAS_TOOL_KEYS[tool]]);
    }
    expect(Object.values(CANVAS_TOOL_KEYS)).toEqual(["v", "h", "p", "Shift-p", "e", "t", "c"]);
  });

  it("i tasti scelgono lo strumento, sulla lavagna e sulla colonna; Maiusc+P è l'evidenziatore", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const steps: Array<[string, boolean, string]> = [
      ["h", false, "hand"], ["p", false, "pen"], ["P", true, "highlighter"], ["e", false, "eraser"],
      ["t", false, "text"], ["c", false, "connect"], ["v", false, "select"],
    ];
    for (const [letter, shift, tool] of steps) {
      expect(key(viewport, letter, shift).defaultPrevented, letter).toBe(true);
      expect(engine.tool).toBe(tool);
      expect(viewport.dataset.tool).toBe(tool);
    }
    key(viewport, "P", true);
    // La casella della penna mostra l'evidenziatore, ed è premuta.
    expect(slotOf(host, "pen").dataset.tool).toBe("highlighter");
    expect(pressed(host)).toEqual(["highlighter"]);
    // Col fuoco sulla colonna i tasti degli strumenti valgono lo stesso.
    key(slotOf(host, "select"), "h");
    expect(engine.tool).toBe("hand");
  });

  it("un tasto di una lettera non vale mentre si scrive in una scheda", () => {
    const { engine, host } = mounted();
    card(host, "a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor");
    expect(field).not.toBeNull();
    const event = key(field!, "p");
    expect(event.defaultPrevented).toBe(false);
    expect(engine.tool).toBe("select");
  });

  it("il clic su una casella sceglie; la Penna fa scrivere il mouse ed è l'interruttore «Scrivi col mouse»", () => {
    const { engine, host } = mounted();
    slotOf(host, "pen").click();
    expect(engine.tool).toBe("pen");
    expect(viewportOf(host).dataset.ink).toBe("pen");
    const inkMouse = host.querySelector<HTMLButtonElement>('[data-canvas-action="ink-mouse"]')!;
    expect(inkMouse.getAttribute("aria-pressed")).toBe("true");
    // La Gomma è la gomma della penna di N4: il cursore è la cella.
    slotOf(host, "eraser").click();
    expect(viewportOf(host).dataset.ink).toBe("eraser");
    // L'interruttore spento torna alla Selezione; acceso, alla penna del menu.
    inkMouse.click();
    expect(engine.tool).toBe("select");
    expect(viewportOf(host).dataset.ink).toBeUndefined();
    inkMouse.click();
    expect(engine.tool).toBe("eraser");
  });

  it("Esc toglie la scelta, poi torna alla Selezione; senza niente da fare resta alla shell", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    mouse(card(host, "a"), "pointerdown", 10, 10);
    mouse(viewport, "pointerup", 10, 10);
    key(viewport, "h");
    expect(engine.selectedText()).not.toBeNull();
    expect(key(viewport, "Escape").defaultPrevented).toBe(true);
    expect(engine.selectedText()).toBeNull();
    expect(engine.tool).toBe("hand");
    key(viewport, "Escape");
    expect(engine.tool).toBe("select");
    expect(key(viewport, "Escape").defaultPrevented).toBe(false);
  });

  it("la colonna personalizzata: uno strumento che non c'è si salta, uno tolto resta nei tasti e in Ctrl+/", () => {
    const { engine, host } = mounted();
    preferences(["pen", "domani", "text"]);
    expect(slots(host).map((slot) => slot.dataset.slot)).toEqual(["select", "pen", "text"]);
    expect(host.querySelectorAll(".canvas-rail .kit-rail-rule")).toHaveLength(2);
    key(viewportOf(host), "h");
    expect(engine.tool).toBe("hand");
    expect(engine.commands().some((command) => command.id === "canvas.tool.hand")).toBe(true);
    // Vuota di nuovo: quella di serie.
    preferences([]);
    expect(slots(host).map((slot) => slot.dataset.slot)).toEqual(["select", "hand", "pen", "eraser", "text", "connect"]);
    expect(pressed(host)).toEqual(["hand"]);
  });

  it("in sola lettura Penna, Evidenziatore, Gomma, Testo e Collega sono spenti col perché; Selezione e Mano no", () => {
    const { engine, host } = mounted();
    engine.setReadOnly(true);
    const off = slots(host).filter((slot) => slot.getAttribute("aria-disabled") === "true").map((slot) => slot.dataset.slot);
    expect(off).toEqual(["pen", "eraser", "text", "connect"]);
    expect(slotOf(host, "pen").getAttribute("aria-label")).toBe(t("canvas.tool.readonly", { name: t("canvas.tool.pen") }));
    slotOf(host, "pen").click();
    key(viewportOf(host), "t");
    key(viewportOf(host), "P", true);
    expect(engine.tool).toBe("select");
    const pen = engine.commands().find((command) => command.id === "canvas.tool.pen")!;
    expect(pen.disabled()).toBe(t("canvas.commands.why.read_only"));
    expect(engine.commands().find((command) => command.id === "canvas.tool.hand")!.disabled()).toBeNull();
    key(viewportOf(host), "h");
    expect(engine.tool).toBe("hand");
    // Di nuovo scrivibile: tutto acceso, col nome di sempre.
    engine.setReadOnly(false);
    expect(slots(host).some((slot) => slot.hasAttribute("aria-disabled"))).toBe(false);
    expect(slotOf(host, "pen").getAttribute("aria-label")).toBe(t("canvas.tool.pen"));
  });

  it("la Mano sposta la lavagna anche sopra una scheda, e non la sceglie", () => {
    const { engine, host } = mounted();
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    key(viewportOf(host), "h");
    const before = stage.style.transform;
    mouse(card(host, "a"), "pointerdown", 20, 20);
    mouse(viewportOf(host), "pointermove", 80, 50);
    mouse(viewportOf(host), "pointerup", 80, 50);
    expect(stage.style.transform).not.toBe(before);
    expect(engine.selectedText()).toBeNull();
  });

  it("il Testo mette una scheda di testo dove si fa clic, col campo aperto, e torna alla Selezione", () => {
    const { engine, host } = mounted();
    key(viewportOf(host), "t");
    mouse(viewportOf(host), "pointerdown", 300, 400);
    const doc = JSON.parse(engine.getDoc()) as { nodes: Array<{ id: string; type: string }> };
    expect(doc.nodes).toHaveLength(3);
    expect(doc.nodes[2]!.type).toBe("text");
    expect(host.querySelector(`.canvas-node[data-node="${doc.nodes[2]!.id}"] .canvas-text-editor`)).not.toBeNull();
    expect(engine.tool).toBe("select");
  });

  it("Collega tira un filo da una scheda all'altra", () => {
    const { engine, host } = mounted();
    key(viewportOf(host), "c");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(card(host, "b"));
    mouse(card(host, "a"), "pointerdown", 20, 20);
    mouse(viewportOf(host), "pointerup", 420, 20);
    const doc = JSON.parse(engine.getDoc()) as { edges: Array<{ fromNode: string; toNode: string }> };
    expect(doc.edges).toEqual([expect.objectContaining({ fromNode: "a", toNode: "b" })]);
  });
});
