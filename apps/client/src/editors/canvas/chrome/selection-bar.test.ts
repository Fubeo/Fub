// @vitest-environment happy-dom
// La barra della selezione della lavagna (T51): quando c'è (a fine gesto, mai
// durante; non con la penna giù né mentre si scrive in una scheda; non con le
// schede fuori dalla vista), dove sta (sopra, o sotto al bordo alto), le
// azioni per una e più schede, ognuna un comando del catalogo, la sola
// lettura e la tastiera.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime } from "../../../ui/lifetime";
import { CanvasEngine } from "../engine";
import { canvasCoreReady, openCoreNow } from "../wasm/core";
import type { CanvasDocument } from "../model";
import { displayCanvasKey, type CanvasCommand } from "./commands";
import {
  SELECTION_BAR_TITLE_ROOM,
  createCanvasSelectionBar,
  selectionBarActions,
  selectionBarPlace,
  selectionBarWanted,
} from "./selection-bar";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
    { id: "f", type: "file", x: 0, y: 300, width: 200, height: 100, file: "Note/tre.md" },
  ],
  edges: [],
});

function readCanvas(text: string): CanvasDocument {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model();
  } finally {
    core.close();
  }
}

function mounted(source = BOARD) {
  const host = document.createElement("div");
  document.body.append(host);
  const engine = new CanvasEngine(host, {
    surfaceId: "selection-bar",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: () => {},
    onSelectionChange: () => {},
    penMemory: { read: () => new Promise(() => {}), save: () => {} },
    inkMouseMemory: { read: () => new Promise(() => {}), save: () => {} },
  });
  engine.setDoc(source);
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
  const bar = host.querySelector<HTMLElement>(".canvas-selection-bar")!;
  const card = (id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  return { engine, host, viewport, bar, card };
}

function pointer(target: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse",
    clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
  }));
}

/// Un clic sulla scheda `id`: la sceglie.
function select(card: HTMLElement): void {
  pointer(card, "pointerdown", 10, 10);
  pointer(card, "pointerup", 10, 10);
}

function selectAll(viewport: HTMLElement): void {
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
}

/// I comandi dei pulsanti che la barra mostra, nell'ordine.
function shown(bar: HTMLElement): string[] {
  return [...bar.querySelectorAll<HTMLButtonElement>("button")].filter((one) => !one.hidden).map((one) => one.dataset.command!);
}

function control(bar: HTMLElement, command: string): HTMLButtonElement {
  return bar.querySelector<HTMLButtonElement>(`button[data-command="${command}"]`)!;
}

describe("le regole della barra", () => {
  it("c'è con delle schede scelte, fuori da ogni gesto, con la penna su e senza scrivere", () => {
    const calm = { chosen: 1, gesture: false, pen: false, writing: false };
    expect(selectionBarWanted(calm)).toBe(true);
    expect(selectionBarWanted({ ...calm, chosen: 0 })).toBe(false);
    expect(selectionBarWanted({ ...calm, gesture: true })).toBe(false);
    expect(selectionBarWanted({ ...calm, pen: true })).toBe(false);
    expect(selectionBarWanted({ ...calm, writing: true })).toBe(false);
  });

  it("le azioni per una, tre e venti schede", () => {
    expect(selectionBarActions(0, null)).toEqual([]);
    expect(selectionBarActions(1, "canvas.open")).toEqual(["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.open", "canvas.delete"]);
    expect(selectionBarActions(1, null)).toEqual(["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.delete"]);
    const many = ["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.align_menu", "canvas.delete"];
    expect(selectionBarActions(3, null)).toEqual(many);
    // Con più schede Apri non c'è, anche se una si aprirebbe.
    expect(selectionBarActions(20, "canvas.open")).toEqual(many);
  });

  it("sta sopra le schede, sopra anche il loro titolo; al bordo alto va sotto; fuori dalla vista non c'è", () => {
    const size = { width: 200, height: 40 };
    const view = { width: 1000, height: 600 };
    const above = selectionBarPlace({ left: 400, top: 300, right: 600, bottom: 400 }, size, view)!;
    expect(above).toEqual({ left: 400, top: 300 - SELECTION_BAR_TITLE_ROOM - 8 - 40 });
    const below = selectionBarPlace({ left: 400, top: 20, right: 600, bottom: 120 }, size, view)!;
    expect(below.top).toBe(130);
    // Dentro la vista anche ai lati.
    expect(selectionBarPlace({ left: -150, top: 300, right: 50, bottom: 400 }, size, view)!.left).toBe(8);
    expect(selectionBarPlace({ left: 1200, top: 300, right: 1400, bottom: 400 }, size, view)).toBeNull();
    expect(selectionBarPlace({ left: 400, top: -300, right: 600, bottom: -10 }, size, view)).toBeNull();
    expect(selectionBarPlace({ left: 400, top: 700, right: 600, bottom: 800 }, size, view)).toBeNull();
  });
});

describe("la barra da sola", () => {
  function fake(disabled: (id: string) => string | null = () => null) {
    const ran: Array<[string, HTMLButtonElement]> = [];
    let back = 0;
    const command = (id: string, keys: string[] = []): CanvasCommand => ({
      id, label: `nome ${id}`, path: "Lavagna", keys, context: "selection", boardKeys: false, danger: false,
      disabled: () => disabled(id), run: () => {},
    });
    const lifetime = openLifetime();
    const bar = createCanvasSelectionBar({
      lifetime,
      commands: () => [command("canvas.color_menu"), command("canvas.connect"), command("canvas.group", ["Mod-g"]),
        command("canvas.align_menu"), command("canvas.open"), command("canvas.delete", ["Delete"])],
      run: (id, trigger) => ran.push([id, trigger]),
      color: () => "4",
      back: () => back++,
    });
    document.body.append(bar.element);
    const box = { left: 300, top: 300, right: 500, bottom: 400 };
    return { bar, ran, lifetime, box, back: () => back };
  }

  it("ogni pulsante è un comando: nome, tasto, clic; il colore dice il suo nome", () => {
    const { bar, ran, box } = fake();
    bar.show({ chosen: 1, open: "canvas.open", box, view: { width: 1000, height: 600 } });
    expect(bar.shown).toBe(true);
    expect(bar.element.getAttribute("role")).toBe("toolbar");
    expect(bar.element.getAttribute("aria-label")).toBe(t("canvas.selection_bar"));
    expect(shown(bar.element)).toEqual(["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.open", "canvas.delete"]);
    expect(control(bar.element, "canvas.group").getAttribute("aria-label")).toBe("nome canvas.group");
    expect(control(bar.element, "canvas.group").getAttribute("aria-keyshortcuts")).toBe(displayCanvasKey("Mod-g", "other"));
    const color = control(bar.element, "canvas.color_menu");
    expect(color.getAttribute("aria-haspopup")).toBe("menu");
    expect(color.getAttribute("aria-label")).toBe(t("canvas.options.color_value", { name: t("canvas_menu.color.4") }));
    expect(color.querySelector<HTMLElement>(".canvas-selection-chip")!.dataset.canvasColor).toBe("4");
    color.click();
    expect(ran.map(([id]) => id)).toEqual(["canvas.color_menu"]);
    expect(ran[0]![1]).toBe(color);
    // Il posto è scritto in linea.
    expect(bar.element.style.top).not.toBe("");
  });

  it("uno spento si vede col perché, e il clic non fa niente", () => {
    const { bar, ran, box } = fake((id) => (id === "canvas.open" ? null : "La lavagna è in sola lettura."));
    bar.show({ chosen: 1, open: "canvas.open", box, view: { width: 1000, height: 600 } });
    const group = control(bar.element, "canvas.group");
    expect(group.getAttribute("aria-disabled")).toBe("true");
    expect(group.getAttribute("aria-label")).toContain("La lavagna è in sola lettura.");
    group.click();
    expect(ran).toEqual([]);
    expect(control(bar.element, "canvas.open").getAttribute("aria-disabled")).toBeNull();
  });

  it("un solo punto di tabulazione, le frecce, Esc torna alla lavagna", () => {
    const { bar, box, back } = fake();
    bar.show({ chosen: 3, open: null, box, view: { width: 1000, height: 600 } });
    const buttons = [...bar.element.querySelectorAll<HTMLButtonElement>("button")].filter((one) => !one.hidden);
    expect(buttons.filter((one) => one.tabIndex === 0)).toHaveLength(1);
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(back()).toBe(1);
    // Nascosta col fuoco dentro, il fuoco torna alla lavagna.
    buttons[0]!.focus();
    bar.hide();
    expect(back()).toBe(2);
  });

  it("fuori dalla vista non c'è", () => {
    const { bar } = fake();
    bar.show({ chosen: 1, open: null, box: { left: 2000, top: 300, right: 2200, bottom: 400 }, view: { width: 1000, height: 600 } });
    expect(bar.shown).toBe(false);
    expect(bar.element.hidden).toBe(true);
  });
});

describe("la barra nella lavagna", () => {
  it("compare a fine clic, non al suo inizio, e sparisce senza scelta", () => {
    const { viewport, bar, card } = mounted();
    expect(bar.hidden).toBe(true);
    pointer(card("a"), "pointerdown", 10, 10);
    expect(bar.hidden).toBe(true);
    pointer(card("a"), "pointerup", 10, 10);
    expect(bar.hidden).toBe(false);
    expect(shown(bar)).toEqual(["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.delete"]);
    // Esc toglie la scelta: la barra va via.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bar.hidden).toBe(true);
  });

  it("con una scheda di file c'è Apri; con più schede Allinea e Collega spento oltre due", () => {
    const { viewport, bar, card } = mounted();
    select(card("f"));
    expect(shown(bar)).toEqual(["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.open", "canvas.delete"]);
    selectAll(viewport);
    expect(shown(bar)).toEqual(["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.align_menu", "canvas.delete"]);
    const connect = control(bar, "canvas.connect");
    expect(connect.getAttribute("aria-disabled")).toBe("true");
    expect(connect.getAttribute("aria-label")).toContain(t("canvas.commands.why.one_or_two"));
  });

  it("sparisce mentre si sposta la vista e torna, al suo posto nuovo, a fine gesto", () => {
    vi.useFakeTimers();
    const { viewport, bar, card } = mounted();
    select(card("a"));
    expect(bar.hidden).toBe(false);
    // Una panoramica: giù nel vuoto, si muove, su.
    pointer(viewport, "pointerdown", 700, 500);
    expect(bar.hidden).toBe(true);
    pointer(viewport, "pointermove", 720, 540);
    pointer(viewport, "pointermove", 760, 580);
    expect(bar.hidden).toBe(true);
    pointer(viewport, "pointerup", 760, 580);
    // Una scelta tolta dal clic nel vuoto non la riporta; si sceglie di nuovo.
    select(card("a"));
    expect(bar.hidden).toBe(false);
    const top = bar.style.top;
    // La rotella con Ctrl: durante non c'è, a fine gesto torna.
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 300 });
    Object.defineProperty(wheel, "ctrlKey", { value: true });
    Object.defineProperty(wheel, "clientX", { value: 400 });
    Object.defineProperty(wheel, "clientY", { value: 300 });
    viewport.dispatchEvent(wheel);
    expect(bar.hidden).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(bar.hidden).toBe(false);
    // Lo zoom cambiato: la barra si è rimessa sopra la scheda, più in basso.
    expect(parseFloat(bar.style.top)).toBeGreaterThan(parseFloat(top));
  });

  it("sparisce mentre si scrive in una scheda e torna quando si esce", () => {
    const { host, bar, card } = mounted();
    select(card("a"));
    expect(bar.hidden).toBe(false);
    card("a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    expect(bar.hidden).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    expect(bar.hidden).toBe(false);
  });

  it("la sola lettura spegne le azioni che cambiano; Apri resta", () => {
    const { engine, bar, card } = mounted();
    select(card("f"));
    engine.setReadOnly(true);
    for (const id of ["canvas.color_menu", "canvas.connect", "canvas.group", "canvas.delete"]) {
      expect(control(bar, id).getAttribute("aria-disabled"), id).toBe("true");
      expect(control(bar, id).getAttribute("aria-label"), id).toContain(t("canvas.commands.why.read_only"));
    }
    expect(control(bar, "canvas.open").getAttribute("aria-disabled")).toBeNull();
    const before = engine.getDoc();
    control(bar, "canvas.delete").click();
    expect(engine.getDoc()).toBe(before);
  });

  it("Raggruppa mette un gruppo attorno alle schede, dietro di loro; l'annulla torna agli stessi byte", () => {
    const { engine, viewport, bar } = mounted();
    selectAll(viewport);
    const before = engine.getDoc();
    control(bar, "canvas.group").click();
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes).toHaveLength(4);
    const group = doc.nodes[0]!;
    expect(group.type).toBe("group");
    expect(group.x).toBeLessThanOrEqual(-16);
    expect(group.y).toBeLessThanOrEqual(-16);
    expect(group.x + group.width).toBeGreaterThanOrEqual(616);
    expect(group.y + group.height).toBeGreaterThanOrEqual(416);
    expect(doc.nodes.slice(1).map((node) => node.id)).toEqual(["a", "b", "f"]);
    expect(engine.selection().nodes).toEqual([group.id]);
    engine.undo();
    expect(engine.getDoc()).toBe(before);
  });

  it("Collega con due schede le collega; Togli le toglie e la barra va via", () => {
    const source = JSON.stringify({ nodes: JSON.parse(BOARD).nodes.slice(0, 2), edges: [] });
    const { engine, viewport, bar } = mounted(source);
    selectAll(viewport);
    control(bar, "canvas.connect").click();
    expect(readCanvas(engine.getDoc()).edges).toHaveLength(1);
    selectAll(viewport);
    control(bar, "canvas.delete").click();
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(0);
    expect(bar.hidden).toBe(true);
  });

  it("Colore apre il menu dei colori sotto il suo pulsante", () => {
    const { bar, card } = mounted();
    select(card("a"));
    const color = control(bar, "canvas.color_menu");
    color.click();
    expect(color.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".context-menu")).not.toBeNull();
  });

  it("la lavagna chiusa non lascia la barra", () => {
    const { engine, host } = mounted();
    engine.destroy();
    expect(host.querySelector(".canvas-selection-bar")).toBeNull();
  });
});
