// @vitest-environment happy-dom
// La riga delle opzioni della lavagna (T50): la riga di ogni strumento, il
// menu delle penne di N4 dentro, la barra di una scheda in scrittura (T41,
// T42) al posto della riga, ogni controllo un comando del catalogo, la sola
// lettura, «…» quando non c'è posto e la tastiera.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime } from "../../../ui/lifetime";
import type { OptionItem } from "../../../kit/options-bar";
import { CanvasEngine, type CanvasChange } from "../engine";
import type { PenMenu } from "../pen-menu";
import { canvasCoreReady, openCoreNow } from "../wasm/core";
import type { CanvasDocument } from "../model";
import { CANVAS_COMMANDS, type CanvasCommand, type CanvasTip, type CanvasToolId } from "./commands";
import { canvasOptionsMode, createCanvasOptions, type CanvasChosenColor } from "./options";

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
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due", color: "4" },
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
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "options",
    formatId: "canvas",
    documentId: "lavagna.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    // Né la penna né l'interruttore ricordati: la prova parte dalla Selezione.
    penMemory: { read: () => new Promise(() => {}), save: () => {} },
    inkMouseMemory: { read: () => new Promise(() => {}), save: () => {} },
  });
  engine.setDoc(source);
  return { engine, host, changes };
}

const run = (engine: CanvasEngine, id: string) => engine.commands().find((command) => command.id === id)!.run();
const row = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-header > .canvas-options")!;
/** Gli elementi della riga, coi nomi di `data-option`. */
const shown = (host: HTMLElement) =>
  [...row(host).querySelectorAll<HTMLElement>(".kit-options-row > .canvas-options-item")].map((item) => item.dataset.option);
const control = (host: HTMLElement, action: string) =>
  row(host).querySelector<HTMLButtonElement>(`[data-canvas-action="${action}"]`);
const penPopover = () => document.querySelector<HTMLElement>(".canvas-pen-popover");
const menuLabels = () => [...document.querySelectorAll<HTMLElement>(".context-menu .menu-label")].map((label) => label.textContent);
function menuEntry(label: string): HTMLElement {
  const entry = [...document.querySelectorAll<HTMLElement>(".context-menu [role^=menuitem]")]
    .find((item) => item.querySelector(".menu-label")?.textContent === label);
  if (!entry) throw new Error(`nessuna voce «${label}»`);
  return entry;
}
/** Sceglie la scheda `id` col clic. */
function select(host: HTMLElement, id: string): void {
  const node = host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0 }));
  host.querySelector(".canvas-viewport")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
}

describe("che cosa mostra la riga", () => {
  it("la regola: lo strumento, le schede scelte e la scheda in scrittura", () => {
    expect(canvasOptionsMode("pen", 0, false)).toBe("ink");
    expect(canvasOptionsMode("highlighter", 3, false)).toBe("ink");
    expect(canvasOptionsMode("eraser", 0, false)).toBe("ink");
    expect(canvasOptionsMode("select", 0, false)).toBe("select");
    expect(canvasOptionsMode("select", 2, false)).toBe("cards");
    // Il lazo (T86): la sua riga che spiega il gesto, o le schede che ha scelto.
    expect(canvasOptionsMode("lasso", 0, false)).toBe("lasso");
    expect(canvasOptionsMode("lasso", 3, false)).toBe("cards");
    expect(canvasOptionsMode("hand", 2, false)).toBe("hand");
    expect(canvasOptionsMode("text", 0, false)).toBe("text");
    expect(canvasOptionsMode("connect", 1, false)).toBe("connect");
    // Mentre si scrive in una scheda vince la sua barra, con ogni strumento.
    expect(canvasOptionsMode("pen", 0, true)).toBe("writing");
    expect(canvasOptionsMode("select", 1, true)).toBe("writing");
  });

  it("la riga di ogni strumento, sopra la barra di N4 e la lavagna", () => {
    const { engine, host } = mounted();
    const header = host.querySelector(".canvas-header")!;
    expect(header.nextElementSibling).toBe(host.querySelector(".canvas-toolbar"));
    expect(row(host).getAttribute("role")).toBe("toolbar");
    expect(row(host).getAttribute("aria-label")).toBe(t("canvas.options"));
    // La Selezione senza schede: come si sceglie, e la Vista.
    expect(shown(host)).toEqual(["hint", "view"]);
    expect(row(host).querySelector(".canvas-options-hint")!.textContent).toBe(t("canvas.options.select_hint"));
    // Con una scheda scelta: il colore, la misura e l'allineamento del testo
    // (T92) e Disponi.
    select(host, "a");
    expect(shown(host)).toEqual(["color", "text-size", "text-align", "arrange", "view"]);
    const rows: Array<[CanvasToolId, string[], string | null]> = [
      ["hand", ["view"], null],
      ["pen", ["pen", "view"], null],
      ["highlighter", ["pen", "view"], null],
      ["eraser", ["pen", "view"], null],
      ["text", ["text-size", "text-align", "view"], null],
      ["connect", ["hint", "tips", "view"], "canvas.options.connect_hint"],
    ];
    for (const [tool, items, hint] of rows) {
      run(engine, `canvas.tool.${tool}`);
      expect(shown(host), tool).toEqual(items);
      if (hint) expect(row(host).querySelector(".canvas-options-hint")!.textContent, tool).toBe(t(hint as "canvas.options.connect_hint"));
    }
    // I gruppi hanno il loro nome per chi ascolta.
    expect(row(host).querySelector('[data-option="tips"] [role="radiogroup"]')!.getAttribute("aria-label")).toBe(t("canvas.options.tips"));
    run(engine, "canvas.tool.text");
    expect(row(host).querySelector('[data-option="text-size"] [role="radiogroup"]')!.getAttribute("aria-label")).toBe(t("canvas.options.text_size"));
    expect(row(host).querySelector('[data-option="text-align"] [role="radiogroup"]')!.getAttribute("aria-label")).toBe(t("canvas.options.text_align"));
    expect(row(host).querySelector('[data-option="view"] [role="group"]')!.getAttribute("aria-label")).toBe(t("canvas.options.view"));
    engine.destroy();
  });

  it("ogni controllo è un comando del catalogo, col suo nome e il suo tasto", () => {
    const { engine, host } = mounted();
    const ids = new Set(CANVAS_COMMANDS.map((spec) => spec.id));
    const seen = new Set<string>();
    select(host, "a");
    for (const tool of ["select", "connect", "text"] as const) {
      run(engine, `canvas.tool.${tool}`);
      if (tool === "select") select(host, "a");
      for (const button of row(host).querySelectorAll<HTMLElement>("[data-command]")) {
        const id = button.dataset.command!;
        expect(ids.has(id), id).toBe(true);
        seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual([
      "canvas.align_menu", "canvas.bring_front", "canvas.color_menu", "canvas.fit", "canvas.send_back",
      "canvas.text_align.center", "canvas.text_align.end", "canvas.text_align.start",
      "canvas.text_size.l", "canvas.text_size.m", "canvas.text_size.s", "canvas.text_size.xl",
      "canvas.tips.end", "canvas.tips.none", "canvas.tips.start", "canvas.zoom_in", "canvas.zoom_out",
    ]);
    // Il nome è quello del comando, il tasto quello del catalogo.
    const zoom = control(host, "zoom-in")!;
    expect(zoom.getAttribute("aria-label")).toBe(t("canvas.zoom_in"));
    expect(zoom.getAttribute("aria-keyshortcuts")).toBe("+");
    // Il clic esegue il comando: la camera cambia.
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const before = stage.style.transform;
    zoom.click();
    expect(stage.style.transform).not.toBe(before);
    engine.destroy();
  });
});

describe("il menu delle penne dentro la riga", () => {
  it("con Penna, Evidenziatore e Gomma la riga ha il pulsante della penna di N4, e il menu si apre lì", () => {
    const { engine, host } = mounted();
    run(engine, "canvas.tool.pen");
    const button = control(host, "ink-pen")!;
    expect(button.classList.contains("canvas-button")).toBe(true);
    expect(button.hasAttribute("data-label")).toBe(true);
    button.click();
    expect(penPopover()).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // Lo strumento cambiato dal menu (la Gomma) non chiude il menu: la riga
    // resta la stessa.
    penPopover()!.querySelector<HTMLElement>('[data-group="tool"][data-value="eraser"]')!.click();
    expect(engine.commands().find((command) => command.id === "canvas.tool.eraser")).toBeDefined();
    expect(host.querySelector(".canvas-viewport")!.getAttribute("data-tool")).toBe("eraser");
    expect(penPopover()).not.toBeNull();
    expect(control(host, "ink-pen")).toBe(button);
    // Un altro strumento con il menu aperto: il menu si chiude.
    run(engine, "canvas.tool.select");
    expect(penPopover()).toBeNull();
    expect(control(host, "ink-pen")).toBeNull();
    engine.destroy();
  });

  it("«Scegli la penna…» da Ctrl+/ con la Selezione sceglie lo strumento della penna e apre il menu", () => {
    const { engine, host } = mounted();
    expect(control(host, "ink-pen")).toBeNull();
    run(engine, "canvas.pen_menu");
    expect(host.querySelector(".canvas-viewport")!.getAttribute("data-tool")).toBe("pen");
    expect(control(host, "ink-pen")!.getAttribute("aria-expanded")).toBe("true");
    expect(penPopover()).not.toBeNull();
    engine.destroy();
  });
});

describe("la Selezione con delle schede scelte", () => {
  it("il colore: il pozzo dice il colore e apre i colori del catalogo; più colori, «Colori diversi»", () => {
    const { engine, host, changes } = mounted();
    select(host, "b");
    const well = control(host, "color-menu")!;
    expect(well.getAttribute("aria-label")).toBe(t("canvas.options.color_value", { name: t("canvas_menu.color.4") }));
    expect(well.querySelector(".kit-color-chip")!.getAttribute("data-canvas-color")).toBe("4");
    well.click();
    expect(well.getAttribute("aria-expanded")).toBe("true");
    // Lo stesso menu del tasto destro (T47): Nessuno, i sei, «Colori delle
    // note ›», «Altro…».
    expect(menuLabels()).toEqual([
      t("canvas_menu.color.none"), t("canvas_menu.color.1"), t("canvas_menu.color.2"), t("canvas_menu.color.3"),
      t("canvas_menu.color.4"), t("canvas_menu.color.5"), t("canvas_menu.color.6"),
      t("canvas_menu.color.notes"), t("canvas_menu.color.other"),
    ]);
    expect(menuEntry(t("canvas_menu.color.notes")).getAttribute("aria-haspopup")).toBe("menu");
    expect(menuEntry(t("canvas_menu.color.other")).getAttribute("role")).toBe("menuitemradio");
    expect(menuEntry(t("canvas_menu.color.4")).getAttribute("aria-checked")).toBe("true");
    menuEntry(t("canvas_menu.color.1")).click();
    expect(readCanvas(engine.getDoc()).nodes.find((node) => node.id === "b")!.color).toBe("1");
    expect(changes).toHaveLength(1);
    expect(well.getAttribute("aria-label")).toBe(t("canvas.options.color_value", { name: t("canvas_menu.color.1") }));
    // Tutte e due: colori diversi.
    host.querySelector(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    expect(well.getAttribute("aria-label")).toBe(t("canvas.options.color_value", { name: t("canvas.options.color_mixed") }));
    expect(well.querySelector(".kit-color-chip")!.classList.contains("mixed")).toBe(true);
    engine.destroy();
  });

  it("Disponi: davanti, dietro e «Allinea e distribuisci», spento col perché con una scheda sola", () => {
    const { engine, host, changes } = mounted();
    select(host, "a");
    const align = control(host, "align-menu")!;
    expect(align.getAttribute("aria-disabled")).toBe("true");
    expect(align.getAttribute("aria-label")).toBe(t("canvas.options.off", { name: t("canvas.options.align_menu"), why: t("canvas.commands.why.two") }));
    align.click();
    expect(document.querySelector(".context-menu")).toBeNull();
    control(host, "bring-front")!.click();
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.id)).toEqual(["b", "a"]);
    host.querySelector(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    expect(align.getAttribute("aria-disabled")).toBeNull();
    align.click();
    expect(menuEntry(t("canvas.distribute_x")).getAttribute("aria-disabled")).toBe("true");
    menuEntry(t("canvas.align_left")).click();
    expect(changes).toHaveLength(2);
    engine.destroy();
  });

  it("il cambio di strumento con un menu della riga aperto lo chiude", () => {
    const { engine, host } = mounted();
    select(host, "a");
    control(host, "color-menu")!.click();
    expect(document.querySelector(".context-menu")).not.toBeNull();
    run(engine, "canvas.tool.hand");
    expect(document.querySelector(".context-menu")).toBeNull();
    engine.destroy();
  });
});

describe("Collega e le punte", () => {
  it("la punta scelta va sul filo nuovo; alla fine resta come sempre", () => {
    const { engine, host, changes } = mounted();
    const tie = (tip: CanvasTip): Record<string, unknown> => {
      run(engine, "canvas.tool.connect");
      control(host, `tips-${tip}`)!.click();
      expect(control(host, `tips-${tip}`)!.getAttribute("aria-checked")).toBe("true");
      const from = host.querySelector<HTMLElement>('.canvas-node[data-node="a"]')!;
      const to = host.querySelector<HTMLElement>('.canvas-node[data-node="b"]')!;
      vi.spyOn(document, "elementFromPoint").mockReturnValue(to);
      from.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 5, clientX: 10, clientY: 10 }));
      host.querySelector(".canvas-viewport")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 5, clientX: 500, clientY: 10 }));
      const edges = readCanvas(engine.getDoc()).edges;
      return edges[edges.length - 1] as unknown as Record<string, unknown>;
    };
    expect(tie("end")).toMatchObject({ fromNode: "a", toNode: "b", toEnd: "arrow" });
    expect(tie("end").fromEnd).toBeUndefined();
    expect(tie("start")).toMatchObject({ fromEnd: "arrow", toEnd: "none" });
    expect(tie("none")).toMatchObject({ toEnd: "none" });
    expect(tie("none").fromEnd).toBeUndefined();
    expect(changes).toHaveLength(5);
    engine.destroy();
  });
});

describe("la misura e l'allineamento del testo (T92)", () => {
  const checked = (host: HTMLElement, option: "text-size" | "text-align") =>
    [...row(host).querySelectorAll<HTMLElement>(`[data-option="${option}"] [role="radio"]`)]
      .filter((button) => button.getAttribute("aria-checked") === "true")
      .map((button) => button.dataset.canvasAction);

  it("col Testo: le «A» delle quattro misure e i tre allineamenti, coi nomi del catalogo; di serie medio e a sinistra", () => {
    const { engine, host } = mounted();
    run(engine, "canvas.tool.text");
    const sizes = [...row(host).querySelectorAll<HTMLElement>('[data-option="text-size"] .canvas-text-size')];
    expect(sizes.map((button) => button.dataset.size)).toEqual(["s", "m", "l", "xl"]);
    expect(sizes.map((button) => button.textContent)).toEqual(["A", "A", "A", "A"]);
    expect(sizes.map((button) => button.getAttribute("aria-label"))).toEqual(
      ["s", "m", "l", "xl"].map((size) => t(`canvas.options.text_size.${size}` as "canvas.options.text_size.s")),
    );
    expect(control(host, "text-align-center")!.getAttribute("aria-label")).toBe(t("canvas.options.text_align.center"));
    expect(control(host, "text-align-center")!.querySelector("svg")).not.toBeNull();
    expect(checked(host, "text-size")).toEqual(["text-size-m"]);
    expect(checked(host, "text-align")).toEqual(["text-align-start"]);
    // Senza schede scelte la scelta vale per le prossime: si segna, il file non cambia.
    control(host, "text-size-l")!.click();
    expect(checked(host, "text-size")).toEqual(["text-size-l"]);
    engine.destroy();
  });

  it("con le schede di testo scelte: il clic le cambia in un commit; misure diverse non ne segnano nessuna", () => {
    const { engine, host, changes } = mounted();
    select(host, "a");
    control(host, "text-size-xl")!.click();
    expect(changes).toHaveLength(1);
    expect(readCanvas(engine.getDoc()).nodes.find((node) => node.id === "a")!["fub:text"]).toEqual({ v: 1, size: "xl" });
    expect(checked(host, "text-size")).toEqual(["text-size-xl"]);
    host.querySelector(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    expect(checked(host, "text-size")).toEqual([]);
    expect(checked(host, "text-align")).toEqual(["text-align-start"]);
    control(host, "text-align-end")!.click();
    expect(changes).toHaveLength(2);
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node["fub:text"])).toEqual([{ v: 1, size: "xl", align: "end" }, { v: 1, align: "end" }]);
    // Tornate di serie, il campo se ne va.
    control(host, "text-size-m")!.click();
    control(host, "text-align-start")!.click();
    expect(engine.getDoc()).not.toContain("fub:text");
    engine.destroy();
  });

  it("con una scheda di file scelta i controlli ci sono, spenti col perché", () => {
    const source = JSON.stringify({ nodes: [{ id: "f", type: "file", x: 0, y: 0, width: 200, height: 100, file: "Nota.md" }], edges: [] });
    const { engine, host, changes } = mounted(source);
    select(host, "f");
    const large = control(host, "text-size-l")!;
    expect(large.getAttribute("aria-disabled")).toBe("true");
    expect(large.getAttribute("aria-label")).toBe(t("canvas.options.off", { name: t("canvas.options.text_size.l"), why: t("canvas.commands.why.no_text_card") }));
    large.click();
    expect(changes).toHaveLength(0);
    // Spenti, non segnano un valore.
    expect(checked(host, "text-size")).toEqual([]);
    expect(checked(host, "text-align")).toEqual([]);
    engine.destroy();
  });
});

describe("la sola lettura", () => {
  it("i controlli che cambiano la lavagna sono spenti col perché; la Vista resta", () => {
    const { engine, host } = mounted();
    select(host, "a");
    engine.setReadOnly(true);
    for (const action of ["color-menu", "text-size-l", "text-align-center", "bring-front", "send-back", "align-menu"]) {
      const button = control(host, action)!;
      expect(button.getAttribute("aria-disabled"), action).toBe("true");
      expect(button.getAttribute("aria-label"), action).toContain(t("canvas.commands.why.read_only"));
    }
    for (const action of ["zoom-in", "zoom-out", "fit"]) expect(control(host, action)!.getAttribute("aria-disabled"), action).toBeNull();
    // Il clic su uno spento non fa niente.
    const before = engine.getDoc();
    control(host, "bring-front")!.click();
    expect(engine.getDoc()).toBe(before);
    // Penna e Collega non si scelgono: la riga resta quella della Selezione.
    run(engine, "canvas.tool.pen");
    expect(shown(host)).toEqual(["color", "text-size", "text-align", "arrange", "view"]);
    engine.destroy();
  });
});

describe("la barra di una scheda in scrittura (T41, T42)", () => {
  /// Una barra finta, come quella di formato di una nota.
  function fakeBar(): OptionItem[] {
    const bold = document.createElement("button");
    bold.type = "button";
    bold.className = "finta-grassetto";
    bold.textContent = "G";
    return [{ id: "fake-bold", element: bold, priority: 1 }];
  }

  it("prende il posto della riga finché la scheda scrive, e la riga torna allo strumento quando esce", () => {
    const { engine, host } = mounted();
    run(engine, "canvas.tool.pen");
    control(host, "ink-pen")!.click();
    expect(penPopover()).not.toBeNull();
    const bar = fakeBar();
    engine.setCardOptions(bar);
    // Il menu della penna si chiude; la barra finta è la riga, da sola.
    expect(penPopover()).toBeNull();
    const items = [...row(host).querySelector(".kit-options-row")!.children];
    expect(items).toEqual([bar[0]!.element]);
    // Cambiare strumento mentre si scrive non la toglie.
    run(engine, "canvas.tool.select");
    expect([...row(host).querySelector(".kit-options-row")!.children]).toEqual([bar[0]!.element]);
    // La scheda esce: la riga dello strumento.
    engine.setCardOptions(null);
    expect(bar[0]!.element.isConnected).toBe(false);
    expect(shown(host)).toEqual(["hint", "view"]);
    engine.destroy();
  });

  it("un'altra barra (dalla nota al foglio) prende il posto di quella di prima", () => {
    const { engine, host } = mounted();
    const note = fakeBar();
    const formula = fakeBar();
    engine.setCardOptions(note);
    engine.setCardOptions(formula);
    expect(note[0]!.element.isConnected).toBe(false);
    expect([...row(host).querySelector(".kit-options-row")!.children]).toEqual([formula[0]!.element]);
    engine.setCardOptions([]);
    expect(shown(host)).toEqual(["hint", "view"]);
    engine.destroy();
  });
});

describe("la riga da sola", () => {
  function standalone(tool: CanvasToolId = "select", chosen = 2, drag: "select" | "pan" = "select") {
    const lifetime = openLifetime();
    const ran: string[] = [];
    const command = (id: string): CanvasCommand => ({
      id, label: id, path: "Lavagna", keys: [], context: "always", boardKeys: false, danger: false,
      disabled: () => null, run: () => ran.push(id),
    });
    const commands = CANVAS_COMMANDS.map((spec) => command(spec.id));
    const penButton = document.createElement("button");
    const penMenu: PenMenu = { button: penButton, isOpen: false, sync: () => {}, open: () => {}, close: vi.fn() };
    const color: CanvasChosenColor = "2";
    const options = createCanvasOptions({
      lifetime,
      tool: () => tool,
      chosen: () => chosen,
      color: () => color,
      tips: () => "end",
      commands: () => commands,
      run: (id) => ran.push(id),
      penMenu,
      dragEmpty: () => drag,
    });
    document.body.append(options.element);
    options.sync();
    return { options, lifetime, ran };
  }

  it("il suggerimento della Selezione dice il gesto di «Trascinare nel vuoto» (N6 T20b)", () => {
    const hint = (drag: "select" | "pan") => standalone("select", 0, drag).options.element.querySelector(".canvas-options-hint")!.textContent;
    // Di serie il vuoto sceglie; con «sposta la vista» il suggerimento dice il trascinamento che sposta.
    expect(hint("select")).toBe(t("canvas.options.select_hint"));
    expect(hint("pan")).toBe(t("canvas.options.select_hint_pan"));
    expect(hint("pan")).not.toBe(hint("select"));
  });

  it("a 700 px la Vista va per prima in «…»", () => {
    const { options, lifetime } = standalone();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains("canvas-options-item") ? 100 : this.classList.contains("kit-options-more") ? 32 : 0;
      return { width, height: 32, x: 0, y: 0, left: 0, top: 0, right: width, bottom: 32, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(options.element, "clientWidth", { configurable: true, value: 450 });
    options.bar.fit();
    expect(options.bar.overflow()).toEqual(["view"]);
    // Poi la misura e l'allineamento del testo (T92), prima di Disponi.
    Object.defineProperty(options.element, "clientWidth", { configurable: true, value: 250 });
    options.bar.fit();
    expect(options.bar.overflow()).toEqual(["text-size", "text-align", "view"]);
    Object.defineProperty(options.element, "clientWidth", { configurable: true, value: 160 });
    options.bar.fit();
    expect(options.bar.overflow()).toEqual(["text-size", "text-align", "arrange", "view"]);
    lifetime.close();
  });

  it("un solo punto di tabulazione; le frecce, Inizio e Fine si muovono fra i controlli", () => {
    const { options, lifetime } = standalone();
    const buttons = [...options.element.querySelectorAll<HTMLButtonElement>(".kit-options-row button")];
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0]!.tabIndex).toBe(0);
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]!.tabIndex).toBe(0);
    expect(buttons[0]!.tabIndex).toBe(-1);
    buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    buttons[buttons.length - 1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    lifetime.close();
  });

  it("la vita chiusa non lascia ascoltatori: un clic dopo non esegue niente", () => {
    const { options, lifetime, ran } = standalone("hand");
    const zoom = options.element.querySelector<HTMLButtonElement>('[data-canvas-action="zoom-in"]')!;
    zoom.click();
    expect(ran).toEqual(["canvas.zoom_in"]);
    lifetime.close();
    zoom.click();
    expect(ran).toEqual(["canvas.zoom_in"]);
  });
});
