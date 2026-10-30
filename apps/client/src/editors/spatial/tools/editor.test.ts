// @vitest-environment happy-dom
// L'editor del disegno, dal puntatore al testo: ogni strumento produce le
// operazioni attese, annulla e ripeti le disfano, e chi non vede sente che
// cosa è successo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID } from "./grid";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { applyOperation } from "../../core/text-operation";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { displayBinding } from "../../../ui/commands";
import { SHELL_KEYS } from "../../../ui/shell-keys.generated";
import { decodeInk } from "../ink/codec";
import { SceneEngine } from "../scene/engine";
import type { Op } from "../scene/ops";
import { readScene } from "../scene/read";
import { doc } from "../scene/test-support";
import { filterElem, writeEffects, type Shadow } from "./effects";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions, type DrawImages, type DrawPlace } from "./editor";
import { MERGE_MS } from "./history";
import type { Decoded, EncodeType, ImageCodec } from "./images";
import { rasterize } from "./png";
import { appearance, LAYER } from "./test-support";
import { DEFS, written } from "./tip-support";
import { DEFAULT_CURVE } from "../../../ink/input/pressure";
import { closeRadial } from "./radial";
import type { Workspace } from "./registry";
import { setReducedMotionPreference } from "../../../theme/reduced-motion";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

const SOURCE = doc(
  `<title>Prova</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

type Init = PointerEventInit & { readonly timeStamp?: number };

function pointer(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, altitudeAngle: Math.PI / 2, ...rest });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;
let clock = 100;

function mount(source = SOURCE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { onChange: (change) => changes.push(change), ...options });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
/// Ciò che l'editor ha detto per ultimo, dalla sua regione viva: l'albero ha
/// la sua riga di stato, e l'elenco delle tavole la sua.
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();

/// Un trascinamento col mouse, sullo schermo: la camera parte dall'identità,
/// quindi i punti sono anche quelli della scena.
function drag(points: readonly (readonly [number, number])[], init: Init = {}): void {
  const target = surface();
  const [x0, y0] = points[0]!;
  target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: x0, clientY: y0, timeStamp: (clock += 8), ...init }));
  for (const [x, y] of points.slice(1)) {
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  }
  const [x1, y1] = points[points.length - 1]!;
  target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: x1, clientY: y1, timeStamp: (clock += 8), ...init }));
}

function key(key: string, init: KeyboardEventInit = {}, target: HTMLElement = surface()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Le caselle della colonna degli strumenti.
const railSlots = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-rail .kit-rail-slot")];

/// Gli strumenti di una casella, coi nomi e i tasti, come li dice la sua
/// tendina; una casella sola dice il suo.
function slotTools(slot: HTMLButtonElement): { name: string; keys: string }[] {
  if (!slot.hasAttribute("aria-haspopup")) return [{ name: slot.getAttribute("aria-label")!, keys: slot.getAttribute("aria-keyshortcuts") ?? "" }];
  slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.querySelector<HTMLElement>(".kit-rail-flyout")!;
  const tools = [...menu.querySelectorAll<HTMLElement>("[role=menuitemradio]")].map((row) => ({
    name: row.querySelector(".kit-rail-flyout-label")!.textContent!,
    keys: row.querySelector(".kit-rail-flyout-keys")?.textContent ?? "",
  }));
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return tools;
}

/// I nomi degli strumenti della colonna, tendine comprese, nell'ordine.
const railNames = (): string[] => railSlots().flatMap((slot) => slotTools(slot).map((tool) => tool.name));

/// Lo strumento `name` nella colonna: il nome col tasto e se è scelto;
/// `hidden` se il livello non lo offre.
function railTool(name: string): { hidden: boolean; title: string; checked: boolean } {
  for (const slot of railSlots()) {
    const tool = slotTools(slot).find((each) => each.name === name);
    if (tool === undefined) continue;
    const shown = slot.getAttribute("aria-label") === name;
    return { hidden: false, title: `${name} (${tool.keys})`, checked: shown && slot.getAttribute("aria-pressed") === "true" };
  }
  return { hidden: true, title: "", checked: false };
}

/// Il pozzo del colore nella barra.
function well(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(".draw-toolbar .kit-color-well-button")!;
}

/// Il selettore del colore, aperto dal pozzo se non lo è.
function picker(): HTMLElement {
  if (well().getAttribute("aria-expanded") !== "true") well().click();
  return document.querySelector<HTMLElement>(".kit-color-popover")!;
}

/// Sceglie nel selettore il campione che si chiama `name`.
function pickSwatch(name: string): void {
  picker().querySelector<HTMLButtonElement>(`.kit-color-swatch[aria-label="${name}"]`)!.click();
}

/// Scrive `code` nel campo del codice del selettore, e Invio.
function typeColor(code: string): void {
  const input = picker().querySelector<HTMLInputElement>(".kit-color-input")!;
  input.focus();
  input.value = code;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

/// I nomi dei campioni del selettore, gruppo per gruppo.
function pickerGroups(): string[][] {
  return [...picker().querySelectorAll<HTMLElement>(".kit-color-group")].map((group) => [
    group.querySelector(".kit-color-group-title")!.textContent!,
    ...[...group.querySelectorAll<HTMLElement>(".kit-color-swatch")].map((swatch) => swatch.getAttribute("aria-label")!),
  ]);
}

/// Dà al foglio una misura, che happy-dom non calcola.
function size(width: number, height: number): void {
  Object.defineProperty(surface(), "clientWidth", { configurable: true, value: width });
  Object.defineProperty(surface(), "clientHeight", { configurable: true, value: height });
}

/// La finestra aperta per ultima.
const dialog = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".modale");
  return open[open.length - 1]!;
};
const field = (name: string): HTMLInputElement | HTMLTextAreaElement => dialog().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;

/// Conferma la finestra e aspetta che l'editor riceva la risposta.
async function submit(): Promise<void> {
  dialog().querySelector("form")!.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/// Il pannello delle proprietà, un suo campo e ciò che vi si scrive.
const properties = (): HTMLElement => host.querySelector<HTMLElement>(".draw-properties")!;
const property = (id: string): HTMLElement => properties().querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`)!;
const propertyInput = (id: string): HTMLInputElement => property(id).querySelector<HTMLInputElement>(".draw-properties-input")!;
const propertyLabel = (id: string): string => property(id).querySelector("label")!.textContent ?? "";

/// Scrive `text` nel campo, come chi lo digita.
function typeIn(target: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

/// Scrive `text` nel campo e lo fa partire con Invio.
function enter(target: HTMLInputElement, text: string): void {
  typeIn(target, text);
  key("Enter", {}, target);
}

/// Lo strato sopra con un contesto che registra ciò che disegna, e i
/// fotogrammi, che partono quando li si chiede. Va preparato prima di
/// montare l'editor.
function recording(): { readonly frame: () => void; readonly texts: () => string[]; readonly calls: () => Array<readonly [string, ...unknown[]]> } {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, name) => {
      if (name in target) return target[name];
      if (name === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => void calls.push([String(name), ...args]);
    },
    set: (target, name, value) => {
      target[name] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  // Ciò che ha fatto l'ultimo disegno, che comincia pulendo.
  const last = (): Array<readonly [string, ...unknown[]]> => calls.slice(calls.map(([name]) => name).lastIndexOf("clearRect"));
  return {
    frame: () => {
      for (const callback of frames.splice(0)) callback(0);
    },
    texts: () => last().filter(([name]) => name === "fillText").map(([, text]) => String(text)),
    calls: last,
  };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
});

afterEach(() => {
  owner.close();
  host.remove();
  vi.unstubAllGlobals();
  // Le finestre chiuse escono con un'animazione, che happy-dom non finisce.
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
  vi.restoreAllMocks();
});

describe("la barra e il foglio", () => {
  it("mettono in fila strumenti, colori, spessori, modifica e vista, e il titolo", () => {
    mount();
    const toolbar = host.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute("aria-label")).toBe("Strumenti di disegno");
    const groups = [...toolbar.querySelectorAll(".draw-group:not([hidden])")].map((group) => [group.getAttribute("role"), group.getAttribute("aria-label")]);
    expect(groups).toEqual([
      ["group", "Colore"],
      ["radiogroup", "Spessore"],
      ["group", "Penna"],
      ["group", "Modifica"],
      ["group", "Livelli"],
      ["group", "Vista"],
    ]);
    // Gli strumenti stanno nella colonna, a sinistra del foglio: le forme in
    // una casella con la tendina, che mostra il rettangolo.
    const rail = host.querySelector('.draw-rail [role="toolbar"]')!;
    expect(rail.getAttribute("aria-label")).toBe("Strumenti");
    expect(rail.getAttribute("aria-orientation")).toBe("vertical");
    const tools = railSlots();
    expect(tools.map((control) => control.getAttribute("aria-label"))).toEqual(["Selezione", "Mano", "Penna", "Gomma", "Rettangolo"]);
    expect(tools.map((control) => control.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
    expect(tools[4]!.getAttribute("aria-keyshortcuts")).toBe("R");
    tools[4]!.focus();
    expect(document.getElementById(tools[4]!.getAttribute("aria-describedby")!)?.textContent).toMatch(/^Rettangolo \(R\) — .*Maiusc/);
    // Il colore è un pozzo col nome, niente formine: apre il selettore, con
    // gli otto colori consigliati in cima.
    expect(well().getAttribute("aria-label")).toBe("Colore: Nero");
    expect(toolbar.querySelectorAll(".draw-color, .draw-swatch")).toHaveLength(0);
    expect(toolbar.querySelectorAll('.draw-width[role="radio"]')).toHaveLength(3);
    expect(host.querySelector<HTMLInputElement>(".draw-title-input")!.value).toBe("Prova");
    expect(host.querySelector(".draw-title-label")!.textContent).toBe("Che cosa hai disegnato?");
    expect(surface().getAttribute("role")).toBe("application");
    expect(surface().getAttribute("aria-label")).toBe("Foglio del disegno");
  });

  it("danno alla barra un solo punto di tabulazione, e le frecce la percorrono", () => {
    mount();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.draw-toolbar[role="toolbar"] button:not([hidden])')];
    expect(buttons.filter((control) => control.tabIndex === 0)).toHaveLength(1);
    buttons[0]!.focus();
    key("ArrowRight", {}, buttons[0]!);
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]!.tabIndex).toBe(0);
    expect(buttons[0]!.tabIndex).toBe(-1);
  });

  it("hanno in alto il menu del disegno, Annulla e Ripeti", () => {
    mount();
    const header = host.querySelector<HTMLElement>(".draw-header")!;
    const top = (): string[] => [...header.querySelectorAll<HTMLButtonElement>(".draw-top button")].map((control) => control.getAttribute("aria-label")!);
    expect(top()).toEqual(["Disegno", "Annulla", "Ripeti"]);
    expect(header.querySelector('.draw-toolbar button[aria-label="Annulla"]')).toBeNull();
    const menuButton = header.querySelector<HTMLButtonElement>('button[aria-label="Disegno"]')!;
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
    menuButton.click();
    const labels = (): string[] =>
      [...document.querySelectorAll<HTMLElement>(".context-menu .menu-label")].map((label) => label.textContent!);
    expect(labels()).toContain("Titolo del disegno…");
    expect(labels()).toContain("Tasti del disegno");
    expect(labels()).not.toContain("Esporta…");
    const title = [...document.querySelectorAll<HTMLElement>(".context-menu [role=menuitem]")].find(
      (entry) => entry.querySelector(".menu-label")!.textContent === "Titolo del disegno…",
    )!;
    title.click();
    expect(document.activeElement).toBe(host.querySelector(".draw-title-input"));
    closeContextMenu();
  });

  it("hanno «Esporta», in alto e nel menu, se chi monta sa esportare", () => {
    const onExport = vi.fn();
    mount(SOURCE, { onExport });
    const fresh = host.querySelector<HTMLElement>(".draw-header")!;
    const exportButton = fresh.querySelector<HTMLButtonElement>('.draw-top button[aria-label="Esporta"]')!;
    expect(exportButton.textContent).toBe("Esporta");
    exportButton.click();
    expect(onExport).toHaveBeenCalledTimes(1);
    fresh.querySelector<HTMLButtonElement>('button[aria-label="Disegno"]')!.click();
    const labels = [...document.querySelectorAll<HTMLElement>(".context-menu .menu-label")].map((label) => label.textContent!);
    expect(labels).toContain("Esporta…");
    closeContextMenu();
  });

  it("dicono lo zoom con la percentuale che si vede", () => {
    mount();
    const zoom = host.querySelector<HTMLButtonElement>(".draw-zoom-level")!;
    expect(zoom.textContent).toMatch(/^100\s?%$/);
    expect(zoom.getAttribute("aria-label")).toBe(`${zoom.textContent}: riporta lo zoom al 100%`);
    key("+");
    expect(zoom.textContent).toMatch(/^125\s?%$/);
    expect(zoom.getAttribute("aria-label")).toContain(zoom.textContent!);
  });
});

describe("gli strumenti", () => {
  it("il rettangolo scrive un `add` nel livello, e lo annuncia", () => {
    mount();
    editor.setTool("rect");
    expect(spoken()).toBe("Strumento: Rettangolo.");
    drag([[10, 10], [30, 20], [50, 40]]);
    expect(changes.map((change) => change.origin)).toEqual(["input"]);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="10" y="10" width="40" height="30" fill="none" stroke="#000000" stroke-width="4"\/>/);
    expect(spoken()).toBe("Rettangolo aggiunto. Il disegno ha 2 oggetti.");
    expect(changes[0]!.text).toBe(editor.engine.text);
  });

  it("con il colore e lo spessore scelti", () => {
    mount();
    editor.setTool("ellipse");
    editor.setColor("#0072b2");
    editor.setWidth(8);
    drag([[10, 10], [50, 30]]);
    expect(editor.engine.text).toMatch(/<ellipse id="o[a-z0-9]{8}" cx="30" cy="20" rx="20" ry="10" fill="none" stroke="#0072b2" stroke-width="8"\/>/);
  });

  it("un tocco con una forma non scrive niente", () => {
    mount();
    editor.setTool("line");
    drag([[10, 10], [11, 11]]);
    expect(changes).toEqual([]);
  });

  it("la penna scrive un tratto col suo inchiostro", () => {
    mount();
    expect(editor.tool).toBe("pen");
    drag([[10, 10], [14, 12], [20, 15], [28, 16], [36, 16]]);
    expect(editor.engine.text).toMatch(/<path id="o[a-z0-9]{8}" fub:tool="pen" fub:at="[^"]+Z" fub:brush="pf1 size=4 [^"]*" d="M[^"]+" fill="#000000" fub:ink="1 [^"]+"\/>/);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 2 oggetti.");
  });

  it("con lo stabilizzatore di «Penna e dita» la corda assorbe il tremito del tratto", () => {
    const shaky: [number, number][] = [[10, 10], [14, 13], [18, 9], [22, 13], [26, 9], [30, 13], [34, 9], [60, 11]];
    const pathOf = (): string => /fub:tool="pen"[^>]* d="([^"]+)"/.exec(editor.engine.text)![1]!;
    mount(SOURCE);
    drag(shaky);
    const raw = pathOf();
    editor.dispose();
    mount(SOURCE, { grid: { ...DEFAULT_GRID, steady: { amount: 1, string: true } } });
    drag(shaky);
    const steady = pathOf();
    expect(steady).not.toBe(raw);
    // La corda tiene fermo il pennino sotto un tremito più corto di lei: il
    // contorno del tratto stabilizzato è più basso di quello che trema.
    const span = (d: string): number => {
      const ys = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => Number(m[2]));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span(steady)).toBeLessThan(span(raw));
  });

  it("la gomma toglie gli oggetti interi che attraversa", () => {
    mount();
    editor.setTool("eraser");
    drag([[50, 70], [56, 70], [64, 70]]);
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 0 oggetti.");
  });

  it("la gomma ferma mentre la rotella sposta la vista non cancella ciò che non ha toccato", () => {
    mount();
    editor.setTool("eraser");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 20, clientY: 70, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 40, clientY: 70, timeStamp: (clock += 8) }));
    // Sotto la gomma ferma la scena scorre fin oltre il rettangolo.
    target.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaMode: 0, bubbles: true, cancelable: true, clientX: 40, clientY: 70 }));
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 40, clientY: 70, timeStamp: (clock += 8) }));
    expect(editor.engine.text).toContain("o1a2b3c4d");
  });

  it("la selezione prende l'oggetto sotto il puntatore e lo sposta con `transform`", () => {
    mount();
    editor.setTool("select");
    drag([[60, 70], [70, 70], [80, 75]]);
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 20 5)"');
    expect(spoken()).toBe("1 oggetto spostato.");
  });

  it("un gruppo di disegni estranei si prende dove si vede, e la sua immagine lo segue mentre lo si trascina", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:scena");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => Promise.resolve());
    mount(doc(`<title>Prova</title>${LAYER}<g id="w"><rect class="logo" x="60" y="60" width="20" height="20"/></g></g>`));
    await Promise.resolve();
    editor.setTool("select");
    const image = (): HTMLElement => host.querySelector<HTMLElement>(".spatial-image")!;
    expect(image().style.transform).toBe("translate(-100px, -75px)");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 70, clientY: 70, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 90, clientY: 75, timeStamp: (clock += 8) }));
    expect(image().style.transform).toBe("matrix(1, 0, 0, 1, -80, -70)");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 90, clientY: 75, timeStamp: (clock += 8) }));
    expect(editor.selection).toEqual(["w"]);
    expect(editor.engine.text).toContain('<g id="w" transform="matrix(1 0 0 1 20 5)">');
    expect(spoken()).toBe("1 oggetto spostato.");
    for (let i = 0; i < 3; i++) await Promise.resolve();
    // L'immagine nuova ha già il gruppo spostato.
    expect(image().style.transform).toBe("translate(-100px, -75px)");
  });

  it("un tocco sul vuoto toglie la selezione, un riquadro sceglie ciò che contiene", () => {
    mount();
    editor.setTool("select");
    editor.select(["o1a2b3c4d"]);
    drag([[10, 10], [10, 10]]);
    expect(editor.selection).toEqual([]);
    drag([[50, 50], [70, 70], [90, 90]]);
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(changes).toEqual([]);
  });

  it("le frecce spostano la selezione di 1, con Maiusc di 10, e i colpi di fila si annullano insieme", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    mount();
    editor.select(["o1a2b3c4d"]);
    key("ArrowRight");
    key("ArrowDown", { shiftKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 1 10)"');
    now.mockReturnValue(MERGE_MS + 1);
    key("ArrowRight");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 2 10)"');

    editor.undo();
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 1 10)"');
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Spostamento.");
  });

  it("Canc elimina la selezione", () => {
    mount();
    editor.select(["o1a2b3c4d"]);
    key("Delete");
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto eliminato. Il disegno ha 0 oggetti.");
  });

  it("le lettere scelgono lo strumento, senza Maiusc", () => {
    mount();
    key("r");
    expect(editor.tool).toBe("rect");
    key("E", { shiftKey: true });
    expect(editor.tool).toBe("rect");
    key("v");
    expect(editor.tool).toBe("select");
  });
});

describe("l'evidenziatore e il colore", () => {
  /// Se il selettore sceglie un colore qualunque, o soltanto i campioni.
  const free = (): boolean => {
    const open = picker().querySelector(".kit-color-input") !== null;
    well().click();
    return open;
  };
  const widths = (): string[] =>
    [...host.querySelectorAll<HTMLElement>(".draw-width")].map((control) => `${control.querySelector<HTMLElement>(".draw-width-bar")!.style.getPropertyValue("--draw-width")}${control.getAttribute("aria-checked") === "true" ? "*" : ""}`);

  it("il Semplice e il Completo hanno lo stesso evidenziatore e lo stesso colore a piacere", () => {
    mount(SOURCE, { workspace: "simple" });
    expect(railNames()).toContain("Evidenziatore");
    expect(free()).toBe(true);
    key("q");
    expect(editor.tool).toBe("pen");
    key("P", { shiftKey: true });
    expect(editor.tool).toBe("highlighter");

    editor.select(["o1a2b3c4d"]);
    editor.setWorkspace("full");
    expect(editor.workspace).toBe("full");
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
    expect(free()).toBe(true);
    expect(railTool("Evidenziatore").title).toBe("Evidenziatore (Shift+P)");
    // Lo strumento, il documento, la selezione e la cronologia restano.
    expect(editor.tool).toBe("highlighter");
    const highlighter = host.querySelector<HTMLButtonElement>('.draw-rail [data-tool="highlighter"]')!;
    highlighter.focus();
    expect(document.getElementById(highlighter.getAttribute("aria-describedby")!)?.textContent).toContain("spessore costante");
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("l'evidenziatore scrive un tratto giallo, largo e trasparente, che si annulla col suo nome", () => {
    mount(SOURCE);
    editor.setTool("highlighter");
    expect(editor.color).toBe("#f0e442");
    expect(editor.width).toBe(16);
    drag([[10, 10], [14, 12], [20, 15], [28, 16], [36, 16]], { pressure: 0.9 });
    expect(editor.engine.text).toMatch(
      /<path id="o[a-z0-9]{8}" fub:tool="highlighter" fub:at="[^"]+Z" fub:brush="pf1 size=16 thinning=0 [^"]*capStart=0 capEnd=0 sim=0 pen=highlighter" d="M[^"]+" fill="#f0e442" fill-opacity="0.5" style="mix-blend-mode: multiply" fub:ink="1 [^"]+"\/>/,
    );
    expect(spoken()).toBe("Evidenziatura aggiunta. Il disegno ha 2 oggetti.");
    // Ha un nome suo anche nel giro degli oggetti e nel loro albero.
    key("End");
    expect(spoken()).toBe("Evidenziatura, Giallo, 2 di 2.");
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Evidenziatura.");
  });

  it("l'evidenziatore ha colore e spessori suoi, e la penna ritrova i propri", () => {
    mount(SOURCE);
    expect(widths()).toEqual(["2px", "4px*", "8px"]);
    editor.setColor("#d55e00");
    editor.setTool("highlighter");
    expect(widths()).toEqual(["8px", "16px*", "24px"]);
    host.querySelectorAll<HTMLButtonElement>(".draw-width")[2]!.click();
    expect(editor.width).toBe(24);
    // La misura è libera, da 0,25 a 200, e resta dell'evidenziatore.
    editor.setWidth(30);
    expect(editor.width).toBe(30);
    editor.setWidth(201);
    expect(editor.width).toBe(30);
    editor.setColor("#56b4e9");
    editor.setTool("pen");
    expect([editor.color, editor.width]).toEqual(["#d55e00", 4]);
    editor.setTool("highlighter");
    expect([editor.color, editor.width]).toEqual(["#56b4e9", 30]);
  });

  it("il selettore scrive un codice, e il colore resta fra i recenti", () => {
    mount(SOURCE);
    expect(pickerGroups()).toEqual([["Consigliati", "Nero", "Blu", "Vermiglio", "Verde", "Porpora", "Arancione", "Azzurro", "Giallo"]]);
    expect(picker().querySelector('.kit-color-swatch[aria-pressed="true"]')?.getAttribute("aria-label")).toBe("Nero");
    typeColor("3A7BD5");
    expect(editor.color).toBe("#3a7bd5");
    expect(spoken()).toBe("Colore: #3a7bd5.");
    expect(well().getAttribute("aria-label")).toBe("Colore: #3a7bd5");
    well().click();

    // Un altro colore della tavolozza, e il codice resta fra i recenti per
    // tornarci.
    pickSwatch("Nero");
    expect(editor.color).toBe("#000000");
    well().click();
    expect(pickerGroups()[1]).toEqual(["Recenti", "#3a7bd5"]);
    pickSwatch("#3a7bd5");
    expect(editor.color).toBe("#3a7bd5");
    well().click();
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    expect(editor.engine.text).toContain('stroke="#3a7bd5"');
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un codice della tavolozza sceglie il suo campione, e uno sbagliato non sceglie niente", () => {
    mount(SOURCE);
    typeColor("#0072B2");
    expect(editor.color).toBe("#0072b2");
    expect(spoken()).toBe("Colore: Blu.");
    expect(well().getAttribute("aria-label")).toBe("Colore: Blu");
    typeColor("rosso");
    expect(editor.color).toBe("#0072b2");
    expect(picker().querySelector(".kit-color-input")!.getAttribute("aria-invalid")).toBe("true");
    well().click();
  });
});

describe("disporre, nel Completo", () => {
  /// Tre rettangoli pieni senza contorno: i loro riquadri sono quelli scritti.
  const ROW = doc(
    `<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="10" fill="#0072b2"/>` +
      `<rect id="ob2b2b2b2" x="40" y="40" width="10" height="10" fill="#000000"/>` +
      `<rect id="oc3c3c3c3" x="80" y="20" width="10" height="20" fill="#d55e00"/></g>`,
  );
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";

  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const named = (label: string): HTMLButtonElement => bar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  /// Gli id dei rettangoli, nell'ordine del file.
  const order = (): string[] => [...editor.engine.text.matchAll(/<rect id="(o[a-z0-9]{8})"/g)].map((match) => match[1]!);
  /// Il menu aperto per ultimo, voce per voce: il nome, e se è spenta.
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  };
  const item = (label: string): HTMLButtonElement => menu().find((entry) => entry.querySelector(".menu-label")!.textContent === label)!;

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("accanto alla selezione mostra al più sei azioni, e le altre nel «…»", () => {
    mount(ROW);
    editor.select([A, B]);
    const more = named("Altri comandi");
    const shown = (): HTMLButtonElement[] =>
      [...bar().querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden && !control.hasAttribute("data-more") && control !== more);
    const extra = (): HTMLButtonElement[] => [...bar().querySelectorAll<HTMLButtonElement>("button[data-more]")];
    // Senza l'Esperto (ADR 0231) le azioni di due forme stanno nella barra.
    expect(shown().length).toBeLessThanOrEqual(6);
    expect(more.hidden).toBe(extra().length === 0);
    if (extra().length > 0) {
      // Le altre non si raggiungono con le frecce: ci porta il «…».
      expect(extra().every((control) => control.tabIndex === -1)).toBe(true);
      more.click();
      expect(more.getAttribute("aria-expanded")).toBe("true");
      expect(menu().map((entry) => entry.querySelector(".menu-label")!.textContent)).toEqual(extra().map((control) => control.getAttribute("aria-label")));
      closeContextMenu();
    }
    // Con meno azioni, niente «…».
    editor.setWorkspace("full");
    editor.select([A]);
    expect(extra()).toEqual([]);
    expect(shown().length).toBeLessThanOrEqual(6);
    expect(more.hidden).toBe(true);
  });

  it("accanto alla selezione non si vede durante lo zoom con la rotella, e torna quando la rotella tace", async () => {
    mount(ROW);
    editor.select([A]);
    expect(bar().hasAttribute("data-beside")).toBe(true);
    expect(bar().hasAttribute("data-gesture")).toBe(false);
    const event = new WheelEvent("wheel", { deltaY: -40, bubbles: true, cancelable: true });
    // happy-dom fa di WheelEvent un UIEvent: i tasti e il punto si danno a mano.
    for (const [name, value] of Object.entries({ ctrlKey: true, shiftKey: false, metaKey: false, clientX: 40, clientY: 40 })) Object.defineProperty(event, name, { value });
    surface().dispatchEvent(event);
    expect(bar().hasAttribute("data-gesture")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(bar().hasAttribute("data-gesture")).toBe(false);
  });

  it("la barra della selezione c'è nel Completo, con qualcosa di scelto; Alt+F10 ci va ed Esc torna al foglio", () => {
    mount(ROW, { workspace: "simple" });
    editor.select([A]);
    expect(bar().hidden).toBe(true);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(false);

    editor.setWorkspace("full");
    expect(bar().hidden).toBe(false);
    expect(bar().getAttribute("role")).toBe("toolbar");
    expect(bar().getAttribute("aria-label")).toBe("Disponi");
    // «Sposta in un livello» non serve con un livello solo, che ha già tutto.
    expect([...bar().querySelectorAll("button:not([hidden])")].map((control) => control.getAttribute("aria-label"))).toEqual([
      "Duplica",
      "Raggruppa",
      "Separa",
      "Ordine",
      "Allinea e distribuisci",
    ]);
    expect(named("Duplica").title).toBe("Duplica (Ctrl+D)");
    expect(named("Duplica").getAttribute("aria-keyshortcuts")).toBe("Control+D");
    expect(named("Ordine").getAttribute("aria-haspopup")).toBe("menu");
    // Un oggetto solo non si raggruppa, e non è un gruppo da separare.
    expect(named("Raggruppa").disabled).toBe(true);
    expect(named("Separa").disabled).toBe(true);
    const hint = document.getElementById(surface().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("Alt+F10");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    surface().focus();
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(named("Duplica"));
    key("ArrowRight", {}, named("Duplica"));
    expect(document.activeElement).toBe(named("Ordine"));
    key("Escape", {}, named("Ordine"));
    expect(document.activeElement).toBe(surface());
    expect(editor.selection).toEqual([A]);

    editor.select([]);
    expect(bar().hidden).toBe(true);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(false);
    editor.select([A]);
    editor.setWorkspace("simple");
    expect(bar().hidden).toBe(true);
    expect(hint?.textContent).not.toContain("Alt+F10");
    expect(changes).toEqual([]);
  });

  it("Ctrl+D copia sopra l'originale, un passo più in là, e la selezione passa alla copia", () => {
    mount(ROW);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    editor.select([A]);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(true);
    const [copy] = editor.selection;
    expect(copy).toMatch(/^o[a-z0-9]{8}$/);
    expect(order()).toEqual([A, copy, B, C]);
    expect(editor.engine.text).toContain(`<rect id="${copy}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(1 0 0 1 24 24)"/>`);
    expect(spoken()).toBe("1 oggetto duplicato. Il disegno ha 4 oggetti.");
    // Un secondo Ctrl+D prosegue la fila, dalla copia.
    named("Duplica").click();
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 48 48)"/>');
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(ROW);
    expect(spoken()).toBe("Annullato: Duplicazione.");
  });

  it("Ctrl+G raggruppa al posto del più alto, e Ctrl+Maiusc+G separa", () => {
    mount(ROW);
    editor.select([A, C]);
    expect(named("Raggruppa").disabled).toBe(false);
    key("g", { ctrlKey: true });
    const [group] = editor.selection;
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${B}"[^>]*/>\\s*<g id="${group}">\\s*<rect id="${A}"[^>]*/>\\s*<rect id="${C}"[^>]*/>\\s*</g>`));
    expect(spoken()).toBe("Gruppo di 2 oggetti.");
    expect(named("Raggruppa").disabled).toBe(true);
    expect(named("Separa").disabled).toBe(false);

    key("G", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).not.toContain(`id="${group}"`);
    expect(editor.engine.text).not.toContain("transform");
    expect(order()).toEqual([B, A, C]);
    expect(editor.selection).toEqual([A, C]);
    expect(spoken()).toBe("1 gruppo separato.");
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(ROW);
  });

  it("l'ordine: Ctrl+] e Ctrl+[ di un posto, con Maiusc agli estremi, anche su una tastiera italiana e con PagSu e PagGiù", () => {
    mount(ROW);
    editor.select([A]);
    key("]", { ctrlKey: true, code: "BracketRight" });
    expect(order()).toEqual([B, A, C]);
    expect(spoken()).toBe("Un posto più avanti.");
    // La tastiera italiana ha «+» dove quella americana ha «]».
    key("+", { ctrlKey: true, code: "BracketRight" });
    expect(order()).toEqual([B, C, A]);
    key("PageDown");
    expect(order()).toEqual([B, A, C]);
    key("PageDown", { shiftKey: true });
    expect(order()).toEqual([A, B, C]);
    expect(spoken()).toBe("In secondo piano.");
    key("{", { ctrlKey: true, shiftKey: true, code: "BracketLeft" });
    expect(spoken()).toBe("È già così: niente da cambiare.");
    key("PageUp", { shiftKey: true });
    expect(order()).toEqual([B, C, A]);
    // Ogni passo si annulla da sé.
    key("z", { ctrlKey: true });
    expect(order()).toEqual([A, B, C]);
    expect(spoken()).toBe("Annullato: Cambio d’ordine.");
    expect(editor.selection).toEqual([A]);
  });

  it("il menu dell'ordine spegne le voci che non cambierebbero niente, e dice le scorciatoie", () => {
    mount(ROW);
    editor.select([C]);
    named("Ordine").click();
    expect(named("Ordine").getAttribute("aria-expanded")).toBe("true");
    expect(menu().map((entry) => [entry.querySelector(".menu-label")!.textContent, entry.querySelector(".menu-hint")!.textContent, entry.getAttribute("aria-disabled")])).toEqual([
      ["Porta in primo piano", "Ctrl+Shift+]", "true"],
      ["Porta avanti", "Ctrl+]", "true"],
      ["Porta indietro", "Ctrl+[", null],
      ["Porta in secondo piano", "Ctrl+Shift+[", null],
    ]);
    item("Porta in secondo piano").click();
    expect(order()).toEqual([C, A, B]);
    expect(named("Ordine").getAttribute("aria-expanded")).toBe("false");
  });

  it("allinea al riquadro della selezione, o alla pagina un oggetto solo, e distribuisce lo spazio", () => {
    mount(ROW);
    editor.select([A, B, C]);
    named("Allinea e distribuisci").click();
    expect(menu().map((entry) => entry.querySelector(".menu-label")!.textContent)).toEqual([
      "Allinea a sinistra",
      "Allinea al centro",
      "Allinea a destra",
      "Allinea in alto",
      "Allinea in mezzo",
      "Allinea in basso",
      "Distribuisci orizzontalmente",
      "Distribuisci verticalmente",
    ]);
    item("Distribuisci orizzontalmente").click();
    // Fra 30 e 80 restano 40 unità, dopo il quadrato largo 10: 20 per parte.
    expect(editor.engine.text).toContain(`<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000" transform="matrix(1 0 0 1 10 0)"/>`);
    expect(spoken()).toBe("3 oggetti distribuiti.");

    named("Allinea e distribuisci").click();
    item("Allinea a sinistra").click();
    expect(editor.engine.text).toContain(`<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000" transform="matrix(1 0 0 1 -30 0)"/>`);
    expect(editor.engine.text).toContain(`<rect id="${C}" x="80" y="20" width="10" height="20" fill="#d55e00" transform="matrix(1 0 0 1 -70 0)"/>`);
    expect(spoken()).toBe("3 oggetti allineati.");

    editor.select([A]);
    named("Allinea e distribuisci").click();
    expect(item("Distribuisci orizzontalmente").getAttribute("aria-disabled")).toBe("true");
    expect(item("Distribuisci orizzontalmente").querySelector(".menu-description")!.textContent).toBe("Servono almeno tre oggetti.");
    item("Allinea a destra, rispetto alla pagina").click();
    expect(editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(1 0 0 1 70 0)"/>`);
  });

  it("allinea con Alt e A, D, W, S, centra con Alt+H e Alt+V, distribuisce con Maiusc", () => {
    mount(ROW);
    editor.select([A, B, C]);
    surface().focus();
    expect(key("ç", { altKey: true, shiftKey: true, code: "KeyH" }).defaultPrevented).toBe(true);
    expect(editor.engine.text).toContain(`<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000" transform="matrix(1 0 0 1 10 0)"/>`);
    expect(spoken()).toBe("3 oggetti distribuiti.");
    // Per posizione: Alt+A su un Mac scrive «å».
    key("å", { altKey: true, code: "KeyA" });
    expect(editor.engine.text).toContain(`<rect id="${C}" x="80" y="20" width="10" height="20" fill="#d55e00" transform="matrix(1 0 0 1 -70 0)"/>`);
    expect(spoken()).toBe("3 oggetti allineati.");
    const steps = changes.length;
    key("w", { altKey: true, code: "KeyW" });
    key("v", { altKey: true, code: "KeyV" });
    expect(changes.length).toBe(steps + 2);
  });

  it("riflette la selezione con Maiusc+H e Maiusc+V, in un passo che si annulla", () => {
    mount(ROW);
    editor.select([A]);
    surface().focus();
    const before = editor.engine.text;
    key("H", { shiftKey: true, code: "KeyH" });
    expect(editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(-1 0 0 1 40 0)"/>`);
    expect(spoken()).toBe("Riflesso da sinistra a destra.");
    key("V", { shiftKey: true, code: "KeyV" });
    expect(spoken()).toBe("Riflesso dall'alto in basso.");
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(before);
    // Senza selezione Maiusc+H non fa niente.
    editor.select([]);
    expect(key("H", { shiftKey: true, code: "KeyH" }).defaultPrevented).toBe(false);
  });

  it("un pulsante che si spegne passa il fuoco a quello che prende il Tab", () => {
    mount(doc(`${LAYER}<g id="og1g1g1g1">${"<rect id=\"oa1a1a1a1\" x=\"0\" y=\"0\" width=\"5\" height=\"5\"/>"}<rect id="ob2b2b2b2" x="10" y="0" width="5" height="5"/></g></g>`));
    editor.select(["og1g1g1g1"]);
    surface().focus();
    key("F10", { altKey: true });
    key("ArrowRight", {}, named("Duplica"));
    expect(document.activeElement).toBe(named("Separa"));
    named("Separa").click();
    expect(editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("1 gruppo separato.");
    expect(named("Separa").disabled).toBe(true);
    expect(document.activeElement).toBe(named("Duplica"));
  });

  it("un gruppo con parti estranee si separa, e loro restano dove si vedevano; non si duplica", () => {
    const source = doc(`${LAYER}<g id="og1g1g1g1" transform="translate(5 0)"><rect id="oa1a1a1a1" x="0" y="0" width="5" height="5"/><use href="#oa1a1a1a1" x="10"/><circle class="c" r="2"/></g></g>`);
    mount(source);
    editor.select(["og1g1g1g1"]);
    key("d", { ctrlKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toContain("Non duplicato");
    key("g", { ctrlKey: true, shiftKey: true });
    // La copia collegata mostra il quadrato con la sua trasformazione nuova:
    // resta com'era scritta.
    expect(editor.engine.text).toContain('<rect id="oa1a1a1a1" x="0" y="0" width="5" height="5" transform="matrix(1 0 0 1 5 0)"/>');
    expect(editor.engine.text).toContain('<use href="#oa1a1a1a1" x="10"/>');
    expect(editor.engine.text).toContain('<circle class="c" r="2" transform="matrix(1 0 0 1 5 0)"/>');
    expect(appearance(editor.engine.text)).toEqual(appearance(source));
    expect(spoken()).toBe("1 gruppo separato. 1 elemento riscritto perché resti com’era.");
    editor.undo();
    expect(editor.engine.text).toBe(source);
  });

  it("il diagramma di Mermaid del banco di fedeltà si separa coi tasti e con la barra, e si vede com'era", () => {
    const source = FIDELITY.find((scene) => scene.id === "mermaid")!.text;
    mount(source);
    editor.select(["m"]);
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    const after = editor.engine.text;
    expect(after).not.toContain('id="m"');
    expect(after).toContain('<rect x="10" y="50" width="90" height="40" rx="5" fill="#ECECFF" stroke="#9370DB"/>');
    expect(appearance(after)).toEqual(appearance(source));
    expect(spoken()).toBe("1 gruppo separato. 5 elementi riscritti perché restino com’erano.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(source);
    expect(editor.selection).toEqual(["m"]);

    named("Separa").click();
    // Lo stesso testo, salvo l'id nuovo della punta della freccia.
    const unnamed = (text: string): string => text.replace(/id="o[a-z0-9]{8}"/g, 'id=""');
    expect(unnamed(editor.engine.text)).toBe(unnamed(after));
    expect(spoken()).toBe("1 gruppo separato. 5 elementi riscritti perché restino com’erano.");
    // Si sceglie la punta della freccia, l'unica parte che FubDraw sa
    // scrivere; le altre restano parti estranee.
    expect(editor.selection).toHaveLength(1);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("Ctrl+G e Ctrl+Maiusc+G restano all'editor anche senza niente di scelto, o dal pannello, e lo dicono", () => {
    mount(doc(`${LAYER}<g id="og1g1g1g1"><rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`));
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    expect(key("g", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    editor.select(["og1g1g1g1"]);
    host.querySelector<HTMLButtonElement>(`[aria-controls="${properties().id}"]`)!.click();
    expect(key("g", { ctrlKey: true, shiftKey: true }, properties()).defaultPrevented).toBe(true);
    expect(spoken()).toBe("1 gruppo separato.");
    // Nel Semplice non si raggruppa: i tasti restano a chi li aveva.
    editor.setWorkspace("simple");
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("non raggruppa né riordina ciò a cui il foglio di stile del disegno darebbe uno stile che non si può togliere, e dice perché", () => {
    const source = doc(`<style>g g rect{fill:#d55e00}rect:last-child{stroke:#000}</style>${LAYER}<rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g>`);
    mount(source);
    editor.select([A, B]);
    key("g", { ctrlKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non raggruppato: un elemento cambierebbe «fill», e FubDraw non sa riscriverlo com’era.");
    editor.select([A]);
    key("]", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toBe("Ordine invariato: un elemento cambierebbe «stroke», e FubDraw non sa riscriverlo com’era.");
  });

  it("un foglio di stile che dipende da dove si guarda il disegno ferma il comando, e si dice quale", () => {
    const source = doc(`<style>@media (prefers-color-scheme: dark){#m rect{fill:#ffffff}}</style>${LAYER}<g id="m"><rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`);
    mount(source);
    editor.select(["m"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non separato: il foglio di stile del disegno ha uno stile che dipende da dove si guarda il disegno, «@media (prefers-color-scheme: dark)», e l’aspetto potrebbe cambiare.");
  });

  it("un foglio di stile che sceglie per classe, come quelli di Illustrator, lascia separare", () => {
    mount(doc(`<style>.st0{fill:#d55e00}</style>${LAYER}<g id="og1g1g1g1"><rect id="${A}" class="st0" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`));
    editor.select(["og1g1g1g1"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("1 gruppo separato.");
    expect(editor.engine.text).not.toContain("og1g1g1g1");
  });

  it("un gruppo con un ritaglio resta intero, e si dice perché", () => {
    const source = doc(
      '<defs id="fub-defs"><clipPath id="rcccccccc"><circle cx="5" cy="5" r="5"/></clipPath></defs>' +
        `${LAYER}<g id="og1g1g1g1" clip-path="url(#rcccccccc)"><rect id="${A}" x="0" y="0" width="5" height="5"/></g>` +
        `<g id="og2g2g2g2"><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`,
    );
    mount(source);
    editor.select(["og1g1g1g1"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non separato: un ritaglio, una maschera, degli effetti o un filtro valgono per tutto il gruppo.");
    editor.select(["og1g1g1g1", "og2g2g2g2"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("1 gruppo separato. I gruppi con un ritaglio, una maschera, degli effetti o un filtro restano interi.");
    expect(editor.engine.text).toContain('<g id="og1g1g1g1" clip-path="url(#rcccccccc)">');
    expect(editor.engine.text).not.toContain("og2g2g2g2");
  });

  it("«?» elenca anche i tasti per disporre", () => {
    mount(ROW);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Disponi");
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+D", "Duplica"]);
    expect(rows).toContainEqual(["Ctrl+Shift+G", "Separa"]);
    expect(rows).toContainEqual(["Ctrl+] o PgUp", "Porta avanti"]);
    expect(rows).toContainEqual(["Ctrl+Shift+[ o Shift+PgDn", "Porta in secondo piano"]);
    expect(rows).toContainEqual(["Alt+F10", "Va alla barra della selezione"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("i collegamenti a una nota", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const L = "ol1l1l1l1";
  const RECT_A = `<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2"/>`;
  const RECT_B = `<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000"/>`;
  const ROW = doc(`<title>Prova</title>${LAYER}${RECT_A}${RECT_B}</g>`);
  const NOTE = "Note/Ciclo%20dell'acqua.md";
  const LINKED = doc(`<title>Prova</title>${LAYER}<a id="${L}" href="${NOTE}">${RECT_A}</a>${RECT_B}</g>`);

  /// Chi monta l'editor: sceglie `answer`, e apre ciò che gli si chiede.
  const stub = (answer: string | null = NOTE) => ({ choose: vi.fn(async (_current: string | null) => answer), open: vi.fn() });
  /// Aspetta che l'editor riceva la scelta.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const named = (label: string): HTMLButtonElement | null => bar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  /// Le azioni che la barra offre, accanto o nel suo «…».
  const shown = (): string[] => [...bar().querySelectorAll("button:not([hidden]):not(.draw-arrange-more)")].map((control) => control.getAttribute("aria-label")!);
  const layer = (): HTMLElement => host.querySelector<HTMLElement>(".draw-link-layer")!;
  const marks = (): HTMLButtonElement[] => [...layer().querySelectorAll<HTMLButtonElement>(".draw-link-mark")];

  it("Ctrl+K mette gli oggetti scelti in un collegamento alla nota che si sceglie, al posto del più alto", async () => {
    const links = stub();
    mount(ROW, { links });
    editor.select([A, B]);
    expect(shown()).toEqual(["Duplica", "Raggruppa", "Separa", "Collega a una nota…", "Ordine", "Allinea e distribuisci"]);
    const link = named("Collega a una nota…")!;
    expect(link.title).toBe("Collega a una nota… (Ctrl+K)");
    expect(link.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    expect(key("k", { ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(links.choose).toHaveBeenCalledWith(null);
    const [created] = editor.selection;
    expect(editor.engine.text).toContain(`<a id="${created}" href="${NOTE}">`);
    expect(editor.engine.text).toMatch(new RegExp(`<a id="${created}" href="[^"]+">\\s*<rect id="${A}"[^>]*/>\\s*<rect id="${B}"[^>]*/>\\s*</a>`));
    expect(spoken()).toBe("Collegato a «Ciclo dell'acqua».");
    expect(changes.map((change) => change.origin)).toEqual(["input"]);
    // Scelto da solo, il collegamento si cambia, si apre e si toglie.
    expect(shown()).toEqual(["Duplica", "Raggruppa", "Separa", "Cambia il collegamento…", "Apri «Ciclo dell'acqua»", "Togli il collegamento", "Ordine", "Allinea e distribuisci"]);
    expect(named("Togli il collegamento")!.title).toBe("Togli il collegamento (Ctrl+Shift+K)");

    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(ROW);
    expect(spoken()).toBe("Annullato: Collegamento.");
  });

  it("col collegamento scelto da solo, Ctrl+K lo porta a un'altra nota, partendo da quella di adesso", async () => {
    const links = stub("Altre/b.md");
    mount(LINKED, { links });
    editor.select([L]);
    named("Cambia il collegamento…")!.click();
    await settle();
    expect(links.choose).toHaveBeenCalledWith(NOTE);
    expect(editor.engine.text).toContain(`<a id="${L}" href="Altre/b.md">`);
    expect(editor.selection).toEqual([L]);
    expect(spoken()).toBe("Ora il collegamento porta a «b».");
    expect(named("Apri «b»")!.hidden).toBe(false);
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(LINKED);
    expect(spoken()).toBe("Annullato: Cambio del collegamento.");
  });

  it("un collegamento non ne contiene un altro: il pulsante si spegne, e Ctrl+K lo dice", () => {
    const links = stub();
    mount(LINKED, { links });
    editor.select([L, B]);
    expect(named("Collega a una nota…")!.disabled).toBe(true);
    key("k", { ctrlKey: true });
    expect(spoken()).toContain("Non collegato");
    expect(links.choose).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it("una scelta lasciata a metà, o che non riesce, non cambia niente; una seconda non parte finché c'è la prima", async () => {
    const empty = stub(null);
    mount(ROW, { links: empty });
    editor.select([A]);
    key("k", { ctrlKey: true });
    key("k", { ctrlKey: true });
    await settle();
    expect(empty.choose).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);

    owner.close();
    owner = openLifetime();
    host.replaceChildren();
    const failing = { choose: vi.fn(async () => Promise.reject(new Error("no"))), open: vi.fn() };
    mount(ROW, { links: failing });
    editor.select([A]);
    key("k", { ctrlKey: true });
    await settle();
    expect(failing.choose).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
  });

  it("mentre si sceglie la nota, valgono gli oggetti scelti alla fine", async () => {
    let answer: (href: string | null) => void = () => {};
    const links = { choose: vi.fn(() => new Promise<string | null>((resolve) => (answer = resolve))), open: vi.fn() };
    mount(ROW, { links });
    editor.select([A, B]);
    key("k", { ctrlKey: true });
    editor.select([B]);
    answer("c.md");
    await settle();
    expect(editor.engine.text).toMatch(new RegExp(`${RECT_A}\\s*<a id="${editor.selection[0]}" href="c.md">\\s*${RECT_B}\\s*</a>`));
  });

  it("Ctrl+Maiusc+K toglie i collegamenti scelti e lascia gli oggetti dov'erano, anche senza chi sceglie le note", () => {
    mount(LINKED);
    editor.select([B]);
    // Senza chi sceglie le note non si collega: Ctrl+K resta al browser.
    expect(shown()).not.toContain("Collega a una nota…");
    expect(key("k", { ctrlKey: true }).defaultPrevented).toBe(false);
    key("K", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Fra gli oggetti scelti non c’è un collegamento.");

    editor.select([L, B]);
    expect(shown()).toContain("Togli il collegamento");
    expect(shown()).not.toContain("Apri «Ciclo dell'acqua»");
    expect(key("K", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(editor.engine.text).not.toContain("<a ");
    expect(editor.engine.text).toMatch(new RegExp(`${RECT_A}\\s*${RECT_B}`));
    expect(editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("1 collegamento tolto.");
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(LINKED);
    expect(spoken()).toBe("Annullato: Rimozione del collegamento.");
  });

  it("ogni collegamento che si vede ha un segno sull'angolo in alto a destra, che apre la sua nota", () => {
    const links = stub();
    const source = doc(
      `<title>Prova</title>${LAYER}<a id="${L}" href="${NOTE}">${RECT_A}</a><g id="og1g1g1g1"><a id="ol2l2l2l2" href="b.md">${RECT_B}</a></g>` +
        `<a id="ol3l3l3l3" href="https://example.org"><rect x="70" y="70" width="5" height="5"/></a></g>`,
    );
    mount(source, { links });
    // Anche nel Semplice, e anche dentro un gruppo; un indirizzo
    // del web non porta a una nota, e non ha segno.
    expect(marks().map((mark) => [mark.getAttribute("aria-label"), mark.title, mark.tabIndex, mark.style.transform])).toEqual([
      ["Apri «Ciclo dell'acqua»", "Apri «Ciclo dell'acqua»", -1, "translate(30px, 10px)"],
      ["Apri «b»", "Apri «b»", -1, "translate(50px, 40px)"],
    ]);
    // Il tocco è di chi disegna, tranne con la Selezione.
    expect(layer().hasAttribute("data-active")).toBe(false);
    editor.setTool("select");
    expect(layer().hasAttribute("data-active")).toBe(true);
    marks()[1]!.querySelector("svg")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(links.open).toHaveBeenCalledWith("b.md");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    // I segni seguono la camera e il disegno.
    key("+");
    expect(marks()[0]!.style.transform).not.toBe("translate(30px, 10px)");
    key("0", { ctrlKey: true });
    editor.select([L]);
    editor.deleteSelection();
    expect(marks().map((mark) => mark.getAttribute("aria-label"))).toEqual(["Apri «b»"]);
  });

  it("senza chi apre le note, i segni non ci sono", () => {
    mount(LINKED);
    expect(layer().hidden).toBe(true);
    expect(marks()).toEqual([]);
  });

  it("Alt+Invio apre la nota del collegamento scelto, a ogni livello e anche in un disegno che non si modifica", () => {
    const links = stub();
    mount(LINKED.replace(' fub:version="1"', ""), { links });
    expect(host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(layer().hasAttribute("data-active")).toBe(true);
    expect(key("Enter", { altKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Scegli un collegamento per aprire la sua nota.");
    editor.select([L]);
    key("Enter", { altKey: true });
    expect(links.open).toHaveBeenCalledWith(NOTE);
    expect(changes).toEqual([]);
  });

  it("l'albero degli oggetti nomina la nota", () => {
    mount(LINKED, { links: stub() });
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    expect([...host.querySelectorAll(".draw-object-label")].map((label) => label.textContent)).toEqual([
      "Livello «Livello 1», corrente",
      "Rettangolo, Nero",
      "Collegamento a «Ciclo dell'acqua», 1 oggetto",
    ]);
  });

  it("«?» elenca i tasti dei collegamenti", () => {
    mount(ROW, { links: stub() });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+K", "Collega a una nota, o cambia il collegamento scelto"]);
    expect(rows).toContainEqual(["Ctrl+Shift+K", "Togli il collegamento"]);
    expect(rows).toContainEqual(["Alt+Enter", "Apre la nota del collegamento scelto"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("i livelli, nel Completo", () => {
  /// Due livelli con un rettangolo ciascuno: «Sfondo» sotto, «Note» sopra.
  const TWO = doc(
    `<title>Prova</title><g id="l1" fub:layer="Sfondo"><rect id="oa1a1a1a1" x="10" y="10" width="20" height="10" fill="#0072b2"/></g>` +
      `<g id="l2" fub:layer="Note"><rect id="ob2b2b2b2" x="40" y="40" width="10" height="10" fill="#000000"/></g>`,
  );
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";

  const layers = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-layer-button")!;
  const shownName = (): string => `${layers().querySelector(".draw-layer-name")!.textContent}${layers().querySelector<HTMLElement>(".draw-layer-state")!.hidden ? "" : ` (${layers().querySelector(".draw-layer-state")!.textContent})`}`;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  /// Apre il menu dei livelli e ne preme la voce `label`.
  const choose = (label: string): void => {
    layers().click();
    menu().find((entry) => labelOf(entry) === label)!.click();
  };
  /// Gli id dei livelli e dei rettangoli, nell'ordine del file.
  const order = (): string[] => [...editor.engine.text.matchAll(/<(?:g|rect) id="([a-z0-9]+)"/g)].map((match) => match[1]!);

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("il pulsante c'è nel Completo e dice dove si disegna; il menu sceglie il livello corrente", () => {
    mount(TWO, { workspace: "simple" });
    expect(layers().closest("[hidden]")).not.toBeNull();
    editor.setWorkspace("full");
    expect(layers().closest("[hidden]")).toBeNull();
    expect(layers().closest('[role="group"]')!.getAttribute("aria-label")).toBe("Livelli");
    expect(shownName()).toBe("Note");
    expect(layers().getAttribute("aria-label")).toBe("Livelli: si disegna in «Note»");
    expect(layers().getAttribute("aria-haspopup")).toBe("menu");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    layers().click();
    expect(layers().getAttribute("aria-expanded")).toBe("true");
    const open = document.querySelector<HTMLElement>(".context-menu")!;
    expect(open.getAttribute("aria-labelledby")).toBe(layers().id);
    expect(menu().map((entry) => [entry.getAttribute("role"), labelOf(entry), entry.getAttribute("aria-checked"), entry.getAttribute("aria-disabled")])).toEqual([
      ["menuitemradio", "Note", "true", null],
      ["menuitemradio", "Sfondo", "false", null],
      ["menuitem", "Nuovo livello", null, null],
      ["menuitem", "Rinomina «Note»…", null, null],
      ["menuitem", "Nascondi «Note»", null, null],
      ["menuitem", "Blocca «Note»", null, null],
      ["menuitem", "Sposta «Note» su", null, "true"],
      ["menuitem", "Sposta «Note» giù", null, null],
      ["menuitem", "Elimina «Note»", null, null],
    ]);
    menu().find((entry) => labelOf(entry) === "Sfondo")!.click();
    expect(spoken()).toBe("Si disegna in «Sfondo».");
    expect(shownName()).toBe("Sfondo");
    expect(changes).toEqual([]);

    // Il rettangolo va nel livello corrente, anche se sotto.
    editor.setTool("rect");
    drag([[60, 60], [90, 80]]);
    expect(editor.engine.text).toMatch(new RegExp(`<g id="l1" fub:layer="Sfondo">\\s*<rect id="${A}"[^>]*/>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>`));
    expect(editor.selection).toEqual([]);
    // Nel Semplice si disegna nel più alto, come sempre.
    editor.setWorkspace("simple");
    drag([[60, 60], [90, 80]]);
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${B}"[^>]*/>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>\\s*</svg>`));
  });

  it("scegliere oggetti di un livello solo lo rende corrente, e l'albero lo dice", () => {
    mount(TWO);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    const labels = (): string[] => [...host.querySelectorAll(".draw-object-label")].map((label) => label.textContent ?? "");
    // Dal davanti: il livello sopra è in cima.
    expect(labels()).toEqual(["Livello «Note», corrente", "Rettangolo, Nero", "Livello «Sfondo»", "Rettangolo, Blu"]);
    editor.select([A]);
    expect(shownName()).toBe("Sfondo");
    expect(labels()).toEqual(["Livello «Note»", "Rettangolo, Nero", "Livello «Sfondo», corrente", "Rettangolo, Blu"]);
    // Oggetti di due livelli non cambiano il livello corrente.
    editor.select([A, B]);
    expect(shownName()).toBe("Sfondo");
    editor.select([B]);
    expect(shownName()).toBe("Note");
    editor.setWorkspace("simple");
    expect(labels()).toEqual(["Livello «Note»", "Rettangolo, Nero", "Livello «Sfondo»", "Rettangolo, Blu"]);
  });

  it("un livello nuovo sopra quello corrente, rinominato, nascosto e mostrato: un passo di annulla ciascuno", async () => {
    mount(TWO);
    choose("Sfondo");
    choose("Nuovo livello");
    const [, , made] = order();
    expect(made).toMatch(/^l[a-z0-9]+$/);
    expect(order()).toEqual(["l1", A, made, "l2", B]);
    expect(editor.engine.text).toMatch(new RegExp(`<g id="${made}" fub:layer="Livello 3">\\s*</g>`));
    expect(spoken()).toBe("Livello «Livello 3» creato: si disegna lì.");
    expect(shownName()).toBe("Livello 3");

    choose("Rinomina «Livello 3»…");
    expect(dialog().querySelector("h2")!.textContent).toBe("Rinomina il livello");
    const name = field("name") as HTMLInputElement;
    expect([name.value, name.required, name.maxLength]).toEqual(["Livello 3", true, 80]);
    name.value = "  Schizzi  ";
    await submit();
    expect(editor.engine.text).toMatch(new RegExp(`<g id="${made}" fub:layer="Schizzi">\\s*</g>`));
    expect(spoken()).toBe("Il livello ora si chiama «Schizzi».");

    choose("Nascondi «Schizzi»");
    expect(editor.engine.text).toMatch(new RegExp(`<g id="${made}" fub:layer="Schizzi" display="none">\\s*</g>`));
    expect(spoken()).toBe("«Schizzi» nascosto.");
    expect(shownName()).toBe("Schizzi (nascosto)");
    expect(layers().getAttribute("aria-label")).toBe("Livelli: si disegna in «Schizzi», nascosto");
    // In un livello nascosto non si disegna, e lo si dice.
    const before = editor.engine.text;
    editor.setTool("rect");
    drag([[60, 60], [90, 80]]);
    expect(editor.engine.text).toBe(before);
    expect(spoken()).toBe("«Schizzi» è nascosto: mostralo, o scegli un altro livello, per disegnare.");

    choose("Mostra «Schizzi»");
    expect(spoken()).toBe("«Schizzi» di nuovo visibile.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Livello mostrato.");
    editor.undo();
    editor.undo();
    expect(spoken()).toBe("Annullato: Nome del livello.");
    editor.undo();
    expect(editor.engine.text).toBe(TWO);
    expect(spoken()).toBe("Annullato: Nuovo livello.");
    // Il livello che se n'è andato lascia corrente quello che aveva sotto.
    expect(shownName()).toBe("Sfondo");
  });

  it("un livello bloccato non riceve né si elimina; i suoi oggetti escono dalla selezione", () => {
    mount(TWO);
    editor.select([B]);
    choose("Blocca «Note»");
    expect(editor.engine.text).toContain('<g id="l2" fub:layer="Note" fub:locked="true">');
    expect(spoken()).toBe("«Note» bloccato.");
    expect(editor.selection).toEqual([]);
    expect(shownName()).toBe("Note (bloccato)");
    editor.setTool("pen");
    const before = editor.engine.text;
    drag([[60, 60], [70, 70], [80, 75]]);
    expect(editor.engine.text).toBe(before);
    expect(spoken()).toBe("«Note» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");

    layers().click();
    const remove = menu().find((entry) => labelOf(entry) === "Elimina «Note»")!;
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.querySelector(".menu-description")!.textContent).toBe("È bloccato: sbloccalo per eliminarlo.");
    expect(menu().find((entry) => labelOf(entry) === "Note")!.querySelector(".menu-description")!.textContent).toBe("bloccato");
    // Sceglierne uno bloccato dice subito che lì non si disegna.
    menu().find((entry) => labelOf(entry) === "Sfondo")!.click();
    choose("Note");
    expect(spoken()).toBe("Si disegna in «Note». «Note» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
    choose("Sblocca «Note»");
    expect(editor.engine.text).toBe(TWO);
    expect(spoken()).toBe("«Note» sbloccato.");
  });

  it("cambia l'ordine dei livelli ed elimina quello corrente con ciò che contiene; annulla lo riporta", () => {
    mount(TWO);
    choose("Sfondo");
    layers().click();
    expect(menu().find((entry) => labelOf(entry) === "Sposta «Sfondo» giù")!.getAttribute("aria-disabled")).toBe("true");
    menu().find((entry) => labelOf(entry) === "Sposta «Sfondo» su")!.click();
    expect(order()).toEqual(["l2", B, "l1", A]);
    expect(spoken()).toBe("«Sfondo» ora sta sopra «Note».");
    choose("Sposta «Sfondo» giù");
    expect(order()).toEqual(["l1", A, "l2", B]);
    expect(spoken()).toBe("«Sfondo» ora sta sotto «Note».");
    const shifted = editor.engine.text;

    choose("Elimina «Sfondo»");
    expect(order()).toEqual(["l2", B]);
    expect(spoken()).toBe("«Sfondo» eliminato, con 1 oggetto. Si disegna in «Note».");
    expect(shownName()).toBe("Note");
    layers().click();
    const remove = menu().find((entry) => labelOf(entry) === "Elimina «Note»")!;
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.querySelector(".menu-description")!.textContent).toBe("È l’unico livello.");
    document.querySelector(".context-menu")!.remove();

    editor.undo();
    expect(editor.engine.text).toBe(shifted);
    expect(spoken()).toBe("Annullato: Eliminazione del livello.");
    // Ciò che torna è scelto, e il suo livello è di nuovo quello corrente.
    expect(editor.selection).toEqual([A]);
    expect(shownName()).toBe("Sfondo");
  });

  it("«Sposta in un livello» porta la selezione in cima a un altro livello, dove si vedeva", () => {
    const scaled = TWO.replace('<g id="l2" fub:layer="Note">', '<g id="l2" fub:layer="Note" transform="scale(2)">');
    mount(scaled);
    const into = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Sposta in un livello"]')!;
    editor.select([A]);
    expect(into().hidden).toBe(false);
    expect(into().getAttribute("aria-haspopup")).toBe("menu");
    into().click();
    expect(menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled"), entry.querySelector(".menu-description")?.textContent ?? null])).toEqual([
      ["Note", null, null],
      ["Sfondo", "true", "Gli oggetti scelti sono già qui."],
    ]);
    menu()[0]!.click();
    expect(order()).toEqual(["l1", "l2", B, A]);
    expect(editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(0.5 0 0 0.5 0 0)"/>`);
    expect(spoken()).toBe("1 oggetto spostato in «Note».");
    expect(editor.selection).toEqual([A]);
    expect(shownName()).toBe("Note");
    editor.undo();
    expect(editor.engine.text).toBe(scaled);
    expect(spoken()).toBe("Annullato: Spostamento in un livello.");
    expect(shownName()).toBe("Sfondo");
  });

  it("un livello senza id resta quello corrente quando ne riceve uno", () => {
    const source = doc(`<g fub:layer="Sotto"/><g fub:layer="Sopra"/>`);
    mount(source);
    choose("Sotto");
    editor.setTool("rect");
    drag([[10, 10], [40, 30]]);
    expect(editor.engine.text).toMatch(/<g id="l[a-z0-9]+" fub:layer="Sotto">\s*<rect id="o[a-z0-9]{8}"[^>]*\/>\s*<\/g>\s*<g fub:layer="Sopra"\/>/);
    expect(shownName()).toBe("Sotto");
    drag([[50, 10], [80, 30]]);
    expect(editor.engine.text).toMatch(/fub:layer="Sotto">\s*<rect[^>]*\/>\s*<rect[^>]*\/>\s*<\/g>/);
    // Annullato l'id, il livello resta quello corrente.
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(source);
    expect(shownName()).toBe("Sotto");
  });
});

describe("la griglia e la pagina, nel Completo", () => {
  /// La griglia con l'aggancio acceso, al passo di partenza.
  const SNAP = { shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } as const;
  /// Un quadrato pieno senza contorno, fuori dalla griglia, in una pagina
  /// che lo lascia muovere: il riquadro è quello scritto.
  const OFF = doc(`<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="13" y="7" width="40" height="40" fill="#000000"/></g>`).replace(
    'viewBox="0 0 100 100"',
    'viewBox="0 0 400 400"',
  );
  const A = "oa1a1a1a1";

  const pageButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const lines = (): HTMLElement => host.querySelector<HTMLElement>(".draw-grid")!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const entry = (label: string): HTMLButtonElement => menu().find((one) => labelOf(one) === label)!;
  /// Apre «Pagina e griglia» e ne preme la voce `label`.
  const choose = (label: string): void => {
    pageButton().click();
    entry(label).click();
  };
  /// Un tasto premuto con AltGr, che su Windows arriva come Ctrl e Alt.
  const altGraph = (name: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: name, ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: (state: string) => state === "AltGraph" });
    surface().dispatchEvent(event);
    return event;
  };

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("«Pagina e griglia» c'è nei due spazi; la griglia, nel Completo, si vede sopra la carta, e chi monta l'editor lo sa", () => {
    const grids: unknown[] = [];
    mount(SOURCE, { workspace: "simple", onGridChange: (grid) => grids.push(grid) });
    size(200, 100);
    expect(pageButton().hidden).toBe(false);
    expect(lines().style.display).toBe("none");
    editor.setWorkspace("full");
    expect(pageButton().hidden).toBe(false);
    expect(pageButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(lines().getAttribute("aria-hidden")).toBe("true");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    pageButton().click();
    expect(pageButton().getAttribute("aria-expanded")).toBe("true");
    expect(menu().map((one) => [one.getAttribute("role"), labelOf(one), one.getAttribute("aria-checked"), one.getAttribute("aria-keyshortcuts")])).toEqual([
      ["menuitemcheckbox", "Mostra la griglia", "false", "#"],
      ["menuitemcheckbox", "Aggancia alla griglia", "false", "%"],
      ["menuitemradio", "Passo di 5", "false", null],
      ["menuitemradio", "Passo di 10", "false", null],
      ["menuitemradio", "Passo di 20", "true", null],
      ["menuitemradio", "Passo di 50", "false", null],
      ["menuitemradio", "Passo di 100", "false", null],
      ["menuitemcheckbox", "Forme dal tratto", "true", null],
      ["menuitemcheckbox", "Barra accanto alla selezione", "true", null],
      ["menuitem", "Ruota la vista a sinistra", null, "4"],
      ["menuitem", "Ruota la vista a destra", null, "6"],
      ["menuitem", "Raddrizza la vista", null, "5"],
      ["menuitem", "Penna e dita…", null, null],
      ["menuitem", "Adatta la pagina al disegno", null, null],
    ]);
    expect(entry("Aggancia alla griglia").querySelector(".menu-description")!.textContent).toBe("Tieni premuto Ctrl mentre trascini per posare libero.");
    entry("Mostra la griglia").click();
    expect(spoken()).toBe("Griglia visibile.");
    expect(lines().style.display).toBe("");
    const [minor, major] = [...lines().querySelectorAll("path")];
    expect(minor!.getAttribute("d")).toContain("M20.5 0V100");
    expect(major!.getAttribute("data-major")).toBe("");
    expect(major!.getAttribute("d")).toContain("M100.5 0V100");
    expect(major!.getAttribute("d")).not.toContain("M20.5 0V100");

    choose("Passo di 50");
    expect(spoken()).toBe("Passo della griglia: 50.");
    expect(minor!.getAttribute("d")).toContain("M50.5 0V100");
    pageButton().click();
    expect(entry("Passo di 50").getAttribute("aria-checked")).toBe("true");
    expect(entry("Mostra la griglia").getAttribute("aria-checked")).toBe("true");
    entry("Aggancia alla griglia").click();
    expect(spoken()).toBe("Aggancio alla griglia acceso.");
    expect(editor.grid).toEqual({ shown: true, snap: true, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(grids).toEqual([
      { shown: true, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: false, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: true, step: 50, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
    ]);

    // Nel Semplice non si vede e non aggancia, ma resta com'era.
    editor.setWorkspace("simple");
    expect(lines().style.display).toBe("none");
    expect(editor.grid.shown).toBe(true);
    editor.setWorkspace("full");
    expect(lines().style.display).toBe("");
    // La griglia non entra nel file.
    expect(changes).toEqual([]);
  });

  it("`setGrid` la cambia senza dirlo; un passo fuori dai limiti resta quello di prima, e uno insolito entra nel menu", () => {
    const grids: unknown[] = [];
    mount(SOURCE, { grid: { shown: true, snap: false, step: 0, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE }, onGridChange: (grid) => grids.push(grid) });
    expect(editor.grid).toEqual({ shown: true, snap: false, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    editor.setGrid({ shown: true, snap: true, step: 25, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    editor.setGrid({ shown: false, snap: true, step: 5000, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 25, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(spoken()).toBe("");
    expect(grids).toEqual([]);
    pageButton().click();
    expect(menu().filter((one) => one.getAttribute("role") === "menuitemradio").map(labelOf)).toEqual([
      "Passo di 5",
      "Passo di 10",
      "Passo di 20",
      "Passo di 25",
      "Passo di 50",
      "Passo di 100",
    ]);
    expect(entry("Passo di 25").getAttribute("aria-checked")).toBe("true");
  });

  it("«#» la mostra e «%» aggancia, anche con AltGr; con Ctrl e nel Semplice no", () => {
    mount(SOURCE);
    expect(key("#", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Griglia visibile.");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Aggancio alla griglia acceso.");
    expect(altGraph("#").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Griglia nascosta.");
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(key("#", { ctrlKey: true }).defaultPrevented).toBe(false);
    editor.setWorkspace("simple");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    // Nel titolo si scrivono.
    editor.setWorkspace("full");
    const title = host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(key("#", { shiftKey: true }, title).defaultPrevented).toBe(false);
    expect(editor.grid.shown).toBe(false);
  });

  it("una forma va da un incrocio all'altro; tenendo Ctrl si posa libera", () => {
    mount(doc(`${LAYER}</g>`), { grid: SNAP });
    editor.setTool("rect");
    drag([[13, 17], [30, 40], [59, 61]]);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="20" y="20" width="40" height="40" fill="none"/);
    drag([[13, 17], [30, 40], [59, 61]], { ctrlKey: true });
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="13" y="17" width="46" height="44" fill="none"/);
    // Nel Semplice non si aggancia.
    editor.setWorkspace("simple");
    drag([[113, 117], [159, 161]]);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="113" y="117" width="46" height="44" fill="none"/);
  });

  it("trascinare porta sull'incrocio più vicino l'angolo della geometria vicino al punto preso, contorno escluso", () => {
    mount(SOURCE, { grid: SNAP });
    editor.setTool("select");
    // Preso a sinistra, a metà altezza: l'angolo in alto a sinistra, (60, 60),
    // spostato di (13, 9) va a (73, 69), e si aggancia a (80, 60).
    drag([[60, 70], [66, 74], [73, 79]]);
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 20 0)"');
    expect(spoken()).toBe("1 oggetto spostato.");
    editor.undo();
    drag([[60, 70], [66, 74], [73, 79]], { ctrlKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 13 9)"');
  });

  it("le frecce spostano la selezione di riga in riga, cinque con Maiusc", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(OFF, { grid: SNAP });
    editor.select([A]);
    key("ArrowRight");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 7 0)"');
    key("ArrowRight");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 27 0)"');
    key("ArrowDown", { shiftKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 27 93)"');
    key("ArrowLeft");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 7 93)"');
    // I colpi di fila sono un passo solo.
    editor.undo();
    expect(editor.engine.text).toBe(OFF);
  });

  it("Ctrl e le frecce portano il lato destro o quello in basso alla riga dopo, ma non oltre la prima dopo quello opposto", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(doc(`${LAYER}<rect id="${A}" x="0" y="0" width="50" height="10" fill="#000000"/></g>`), { grid: SNAP });
    editor.select([A]);
    key("ArrowRight", { ctrlKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1.2 0 0 1 0 0)"');
    expect(spoken()).toBe("Misure: 60 × 10.");
    key("ArrowDown", { ctrlKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1.2 0 0 2 0 0)"');
    expect(spoken()).toBe("Misure: 60 × 20.");
    key("ArrowLeft", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toContain('transform="matrix(0.4 0 0 2 0 0)"');
    expect(spoken()).toBe("Misure: 20 × 20.");
    const before = editor.engine.text;
    key("ArrowLeft", { ctrlKey: true });
    expect(editor.engine.text).toBe(before);
  });

  it("con un contorno, la geometria va sulla riga e la misura detta è quella che si vede", () => {
    mount(SOURCE, { grid: SNAP });
    editor.select(["o1a2b3c4d"]);
    key("ArrowRight", { ctrlKey: true });
    // Da 60–80 a 60–100: il contorno di 2 si allarga con la forma.
    expect(editor.engine.text).toContain('transform="matrix(2 0 0 1 -60 0)"');
    expect(spoken()).toBe("Misure: 44 × 22.");
  });

  it("il cursore va di incrocio in incrocio; con Ctrl resta libero", () => {
    mount(SOURCE, { grid: SNAP });
    size(200, 140);
    key("ArrowRight");
    expect(spoken()).toBe("x 120, y 80");
    key("ArrowDown", { shiftKey: true });
    expect(spoken()).toBe("x 120, y 180");
    key("ArrowLeft", { ctrlKey: true });
    expect(spoken()).toBe("x 119, y 180");
    key("ArrowUp");
    expect(spoken()).toBe("x 120, y 160");
    expect(changes).toEqual([]);
  });

  it("Ctrl+D scosta le copie di un numero intero di passi", () => {
    mount(OFF, { grid: SNAP });
    editor.select([A]);
    key("d", { ctrlKey: true });
    const [copy] = editor.selection;
    expect(editor.engine.text).toContain(`<rect id="${copy}" x="13" y="7" width="40" height="40" fill="#000000" transform="matrix(1 0 0 1 40 40)"/>`);
  });

  it("«Adatta la pagina» la porta attorno al disegno con un margine, in un passo che si annulla", () => {
    mount(SOURCE);
    choose("Adatta la pagina al disegno");
    // Il rettangolo col contorno va da 59 a 81: 20 di margine, a numeri interi.
    expect(editor.engine.text).toContain('viewBox="39 39 62 62"');
    expect(spoken()).toBe("Pagina adattata: 62 × 62.");
    expect(changes).toHaveLength(1);
    expect(editor.engine.text).toContain('<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20"');
    pageButton().click();
    const fit = entry("Adatta la pagina al disegno");
    expect(fit.getAttribute("aria-disabled")).toBe("true");
    expect(fit.querySelector(".menu-description")!.textContent).toBe("La pagina è già adattata al disegno.");
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
    editor.undo();
    expect(spoken()).toBe("Annullato: Pagina adattata al disegno.");
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("comprende i livelli bloccati e nascosti", () => {
    mount(
      doc(
        `<g id="l1" fub:layer="Sfondo" fub:locked="true"><rect x="-50" y="-50" width="10" height="10" fill="#000000"/></g>` +
          `<g id="l2" fub:layer="Note" display="none"><rect x="200" y="10" width="10" height="10" fill="#000000"/></g>` +
          `<g id="l3" fub:layer="Disegno"><rect x="10" y="10" width="10" height="10" fill="#000000"/></g>`,
      ),
      {},
    );
    choose("Adatta la pagina al disegno");
    expect(editor.engine.text).toContain('viewBox="-70 -70 300 110"');
    expect(spoken()).toBe("Pagina adattata: 300 × 110.");
  });

  it("un disegno vuoto non ha una pagina da adattare, e lo dice", () => {
    mount(doc(`${LAYER}</g>`));
    pageButton().click();
    const fit = entry("Adatta la pagina al disegno");
    expect(fit.getAttribute("aria-disabled")).toBe("true");
    expect(fit.querySelector(".menu-description")!.textContent).toBe("Il disegno è vuoto.");
    fit.click();
    expect(changes).toEqual([]);
  });

  it("un disegno con le sole tavole porta la pagina attorno alle tavole", () => {
    mount(
      doc(
        '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
          '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
          '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
          '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
          `${LAYER}</g>`,
      ),
      {},
    );
    pageButton().click();
    const fit = entry("Adatta la pagina al disegno");
    expect(fit.hasAttribute("aria-disabled")).toBe(false);
    expect(fit.querySelector(".menu-description")).toBeNull();
    fit.click();
    expect(editor.engine.text).toContain('viewBox="-20 -20 920 240"');
    expect(spoken()).toBe("Pagina adattata: 920 × 240.");
  });

  it("«?» elenca i tasti della griglia, e le frecce dicono dove vanno con l'aggancio", async () => {
    mount(SOURCE);
    const rows = (): (string | null)[][] => [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Griglia");
    expect(rows()).toContainEqual(["# o Ctrl+'", "Mostra o nasconde la griglia"]);
    expect(rows()).toContainEqual(["%", "Accende o spegne l’aggancio alla griglia"]);
    expect(rows()).toContainEqual(["Ctrl", "Tenuto mentre si trascina: posa libero, fuori dalla griglia"]);
    expect(rows()).toContainEqual(["←↑→↓", "Sposta la selezione di 1, con Maiusc di 10"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    editor.setGrid(SNAP);
    key("?", { shiftKey: true });
    expect(rows()).toContainEqual(["←↑→↓", "Sposta la selezione alla riga seguente della griglia, a cinque righe con Maiusc"]);
    expect(rows()).toContainEqual(["Ctrl+←↑→↓", "Ridimensiona la selezione fino alla riga seguente della griglia, a cinque righe con Maiusc"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("le forme dal tratto, nel Completo", () => {
  /// La pagina larga quanto i tratti: non cresce, e i passi sono quelli
  /// dei tratti.
  const PAGE = SOURCE.replace('viewBox="0 0 100 100"', 'viewBox="0 0 600 600"');

  /// I punti di una mano senza tremito lungo gli spigoli `corners`, uno ogni
  /// quattro pixel.
  const trace = (corners: readonly (readonly [number, number])[]): Array<[number, number]> => {
    const out: Array<[number, number]> = [[corners[0]![0], corners[0]![1]]];
    for (let i = 1; i < corners.length; i++) {
      const [ax, ay] = corners[i - 1]!;
      const [bx, by] = corners[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
      for (let k = 1; k <= steps; k++) out.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
    }
    return out;
  };
  const RECT = trace([[100, 100], [300, 100], [300, 220], [100, 220], [100, 100]]);
  const LINE = trace([[100, 100], [300, 140]]);

  /// Il puntatore scende all'inizio di `points` e li percorre, senza
  /// alzarsi.
  const press = (points: readonly (readonly [number, number])[]): void => {
    const target = surface();
    const [x0, y0] = points[0]!;
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: x0, clientY: y0, timeStamp: (clock += 8) }));
    for (const [x, y] of points.slice(1)) moveTo(x, y);
  };
  const moveTo = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const lift = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  /// Il puntatore resta fermo per `ms` millisecondi.
  const hold = (ms: number): void => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };
  const preview = (): Element | null => host.querySelector(".draw-preview > g > g > *");
  /// Il rettangolo che la forma dal tratto ha scritto, se c'è.
  const shaped = (): RegExpMatchArray | null => editor.engine.text.match(/<rect id="o[a-z0-9]{8}" x="(?!60")[^>]*>/);
  const shapeButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Rendi forma"]')!;
  const pageButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const menuEntry = (label: string): HTMLButtonElement => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.querySelector(".menu-label")!.textContent === label)!;
  };
  const strokes = (): string[] => [...editor.engine.text.matchAll(/<path id="(o[a-z0-9]{8})" fub:tool="pen"/g)].map((found) => found[1]!);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    // Ciò che aspetta un timer, come la chiusura di un menu, finisce prima
    // che tornino i timer veri.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("un tratto a penna tenuto fermo mezzo secondo diventa la forma a cui somiglia, e annulla riporta l'inchiostro", () => {
    mount(PAGE);
    press(RECT);
    hold(499);
    expect(preview()).toBeNull();
    hold(1);
    expect(spoken()).toBe("Rettangolo.");
    expect(preview()?.tagName.toLowerCase()).toBe("rect");
    expect(changes).toEqual([]);
    lift(100, 100);
    expect(preview()).toBeNull();
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="100" y="100" width="200" height="120" fill="none" stroke="#000000" stroke-width="4"\/>/);
    expect(editor.engine.text).not.toContain("fub:ink");
    expect(spoken()).toBe("Rettangolo dal tratto. Il disegno ha 2 oggetti.");
    // Due passi: il tratto, poi la forma al suo posto.
    expect(changes).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Forma dal tratto.");
    expect(strokes()).toHaveLength(1);
    expect(shaped()).toBeNull();
    editor.undo();
    expect(editor.engine.text).toBe(PAGE);
  });

  it("muovendo dopo la tenuta la forma cresce e gira attorno al centro, e Maiusc la tiene regolare", () => {
    mount(PAGE);
    press(RECT);
    hold(500);
    // Il tremito della mano ferma non la muove.
    moveTo(102, 101);
    expect(preview()!.getAttribute("width")).toBe("200");
    // Dal centro (200, 160), il doppio più lontano nella stessa direzione.
    moveTo(0, 40);
    expect(preview()!.getAttribute("width")).toBe("400");
    key("Shift", { shiftKey: true });
    expect(preview()!.getAttribute("width")).toBe(preview()!.getAttribute("height"));
    lift(0, 40, { shiftKey: true });
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="40" y="0" width="320" height="320" /);
    expect(spoken()).toBe("Quadrato dal tratto. Il disegno ha 2 oggetti.");
  });

  it("una linea tenuta ferma diventa un segmento, e la sua fine segue il puntatore", () => {
    mount(PAGE);
    press(LINE);
    hold(500);
    expect(spoken()).toBe("Linea.");
    moveTo(300, 200);
    lift(300, 200);
    expect(editor.engine.text).toMatch(/<line id="o[a-z0-9]{8}" x1="100" y1="100" x2="300" y2="200" stroke="#000000" stroke-width="4"/);
  });

  it("un tratto piccolo, o che non somiglia a una forma, resta inchiostro e si continua a disegnare", () => {
    mount(PAGE);
    press(trace([[100, 100], [115, 100], [115, 110], [100, 110], [100, 100]]));
    hold(800);
    lift(100, 100);
    expect(strokes()).toHaveLength(1);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 2 oggetti.");
    const zigzag = trace([[100, 300], [140, 360], [180, 300], [220, 360], [260, 300]]);
    press(zigzag);
    hold(600);
    // Non è una forma: il tratto continua.
    moveTo(300, 360);
    hold(600);
    lift(300, 360);
    expect(strokes()).toHaveLength(2);
    expect(changes).toHaveLength(2);
  });

  it("Esc lascia il tratto e la forma", () => {
    mount(PAGE);
    press(RECT);
    hold(500);
    key("Escape");
    expect(preview()).toBeNull();
    lift(100, 100);
    expect(changes).toEqual([]);
    expect(editor.engine.text).toBe(PAGE);
  });

  it("non c'è nel Semplice, con l'evidenziatore, né con l'interruttore spento, che si ricorda", () => {
    const grids: unknown[] = [];
    mount(PAGE, { workspace: "simple", onGridChange: (grid) => grids.push(grid) });
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(strokes()).toHaveLength(1);
    editor.setWorkspace("full");
    editor.setTool("highlighter");
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(shaped()).toBeNull();
    editor.setTool("pen");
    pageButton().click();
    const entry = menuEntry("Forme dal tratto");
    expect(entry.getAttribute("role")).toBe("menuitemcheckbox");
    expect(entry.getAttribute("aria-checked")).toBe("true");
    expect(entry.querySelector(".menu-description")!.textContent).toBe("Tieni fermo un tratto a penna alla fine: diventa una linea, una freccia o una forma.");
    entry.click();
    expect(spoken()).toBe("I tratti a penna restano inchiostro anche tenuti fermi.");
    expect(editor.grid.shapes).toBe(false);
    expect(grids).toEqual([expect.objectContaining({ shapes: false })]);
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(strokes()).toHaveLength(2);
    pageButton().click();
    menuEntry("Forme dal tratto").click();
    expect(spoken()).toBe("Un tratto a penna tenuto fermo alla fine diventa una forma.");
  });

  it("«Rendi forma» c'è con un tratto a penna scelto, e fa forme dei tratti in un passo che si annulla", () => {
    mount(PAGE);
    drag(RECT);
    drag(trace([[100, 300], [140, 360], [180, 300], [220, 360], [260, 300]]));
    const [rect, zigzag] = strokes();
    const before = editor.engine.text;
    changes.length = 0;
    editor.setTool("select");
    editor.select(["o1a2b3c4d"]);
    expect(shapeButton().hidden).toBe(true);
    editor.select([rect!, zigzag!, "o1a2b3c4d"]);
    expect(shapeButton().hidden).toBe(false);
    expect(shapeButton().hasAttribute("aria-keyshortcuts")).toBe(false);
    shapeButton().click();
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${rect}" x="100" y="100" width="200" height="120" fill="none" stroke="#000000" stroke-width="4"/>`));
    expect(strokes()).toEqual([zigzag]);
    expect(spoken()).toBe("1 tratto è diventato una forma. 1 tratto resta inchiostro: non somiglia a una forma.");
    expect(editor.selection).toEqual(["o1a2b3c4d", rect, zigzag]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(before);
    expect(spoken()).toBe("Annullato: Forma dal tratto.");
    editor.setWorkspace("simple");
    editor.select([rect!]);
    expect(shapeButton().hidden).toBe(true);
  });

  it("«?» elenca il tasto delle forme dal tratto", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Forme dal tratto")?.rows).toEqual([["Shift", "Tenuto, la forma dal tratto resta regolare"]]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il pannello delle proprietà, nel Completo", () => {
  const A = "o1a2b3c4d";
  const B = "ob2b2b2b2";
  const TWO = doc(
    `${LAYER}<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/><rect id="${B}" x="10" y="20" width="10" height="10" fill="#000000"/></g>`,
  );
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;
  const dock = (): HTMLElement => host.querySelector<HTMLElement>(".draw-dock")!;
  const choose = (id: string, value: string): void => {
    const select = property(id).querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const flip = (id: string): void => property(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();

  it("«Proprietà» lo apre e lo chiude accanto al foglio, e chi monta l'editor lo sa", () => {
    const panels: (boolean | null)[] = [];
    mount(SOURCE, { onGridChange: (grid) => panels.push(grid.panel) });
    expect(button().hasAttribute("aria-haspopup")).toBe(false);
    expect(button().getAttribute("aria-controls")).toBe(properties().id);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    button().click();
    expect(properties().hidden).toBe(false);
    expect(dock().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(properties().querySelector(".draw-properties-subject")!.textContent).toBe("Il disegno");
    expect(properties().contains(document.activeElement)).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    button().click();
    expect(properties().hidden).toBe(true);
    expect(dock().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(panels).toEqual([true, false]);
    // Anche il Semplice ha il pannello: il pulsante non apre una finestra.
    editor.setWorkspace("simple");
    expect(button().hasAttribute("aria-haspopup")).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("si apre da sé se l'editor ha posto accanto al foglio, o come l'ha lasciato chi disegna", () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const measured = (width: number): void => {
      Object.defineProperty(host.querySelector(".draw-editor")!, "clientWidth", { configurable: true, value: width });
      for (const callback of observers.splice(0)) callback([], {} as ResizeObserver);
    };
    mount(SOURCE);
    // Finché l'editor non ha una misura, il pannello aspetta di saperla.
    expect(properties().hidden).toBe(true);
    measured(1000);
    expect(properties().hidden).toBe(false);
    // Aprirsi da sé non è una scelta di chi disegna: non si ricorda.
    expect(editor.grid.panel).toBeNull();
    editor.dispose();

    mount(SOURCE);
    measured(400);
    expect(properties().hidden).toBe(true);
    editor.dispose();

    mount(SOURCE, { grid: { ...editor.grid, panel: false } });
    measured(1000);
    expect(properties().hidden).toBe(true);
    // Chi monta l'editor lo riapre come l'aveva lasciato chi disegna.
    editor.setGrid({ ...editor.grid, panel: true });
    expect(properties().hidden).toBe(false);
    expect(document.activeElement).not.toBe(propertyInput("pageWidth"));
  });

  it("Invio ci porta; posizione e misure si scrivono, ciascuna in un passo che si annulla col suo nome", () => {
    mount(TWO);
    editor.select([A]);
    editor.focus();
    key("Enter");
    expect(document.activeElement).toBe(propertyInput("x"));
    expect(properties().querySelector(".draw-properties-subject")!.textContent).toBe("Rettangolo, Nero");
    // La cornice comprende il contorno, come quella sul foglio.
    expect(["x", "y", "width", "height", "rotation"].map((id) => propertyInput(id).value)).toEqual(["59", "59", "22", "22", "0"]);
    enter(propertyInput("x"), "100");
    // La pagina cresce, come per ogni spostamento che ne esce.
    expect(editor.engine.text).toContain(`stroke-width="2" transform="matrix(1 0 0 1 41 0)"/>`);
    expect(propertyInput("x").value).toBe("100");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(spoken()).toBe("Annullato: Spostamento.");
    expect(propertyInput("x").value).toBe("59");
    enter(propertyInput("rotation"), "90");
    expect(propertyInput("rotation").value).toBe("90");
    expect(editor.selection).toEqual([A]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Rotazione.");
    enter(propertyInput("width"), "44");
    expect(["width", "height"].map((id) => propertyInput(id).value)).toEqual(["44", "22"]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Ridimensionamento.");
    expect(editor.engine.text).toBe(TWO);
  });

  it("il lucchetto tiene le proporzioni, finché chi disegna non lo riapre", () => {
    mount(TWO);
    editor.select([A]);
    key("Enter");
    const lock = (): HTMLButtonElement => property("ratio").querySelector<HTMLButtonElement>("button")!;
    expect(lock().getAttribute("aria-pressed")).toBe("false");
    lock().click();
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    enter(propertyInput("width"), "44");
    expect(["width", "height"].map((id) => propertyInput(id).value)).toEqual(["44", "44"]);
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    // Un'altra selezione parte col suo lucchetto.
    editor.select([B]);
    expect(lock().getAttribute("aria-pressed")).toBe("false");
  });

  it("l'aspetto: il riempimento, lo spessore in punti e l'opacità", () => {
    mount(TWO);
    editor.select([A]);
    key("Enter");
    // In un documento in pixel lo spessore è in pixel; negli altri, in punti.
    expect(propertyLabel("strokeWidth")).toBe("Spessore (px)");
    expect(propertyInput("strokeWidth").value).toBe("2");
    enter(propertyInput("strokeWidth"), "4");
    expect(editor.engine.text).toContain('stroke-width="4"');
    enter(propertyInput("fill"), "#e69f00");
    expect(editor.engine.text).toContain('fill="#e69f00"');
    enter(propertyInput("opacity"), "50");
    expect(editor.engine.text).toContain('opacity="0.5"');
    expect(changes).toHaveLength(3);
    editor.undo();
    expect(spoken()).toBe("Annullato: Opacità.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Riempimento.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Spessore del contorno.");
    expect(editor.engine.text).toBe(TWO);
  });

  it("il testo: lo stile, il peso, l'enfasi, l'interlinea e la spaziatura valgono per il testo intero", () => {
    const T = "ot1t1t1t1";
    const TEXT = doc(
      `${LAYER}<text id="${T}" x="10" y="40" fill="#000000" font-family="Inter, sans-serif" font-size="32">` +
        `<tspan x="10" dy="0">Uno</tspan><tspan x="10" dy="40">Due <tspan font-weight="bold">tre</tspan></tspan></text></g>`,
    );
    mount(TEXT);
    editor.select([T]);
    key("Enter");
    const toggle = (label: string): HTMLButtonElement => property("emphasis").querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const opening = (): string => /<text [^>]*>/.exec(editor.engine.text)![0];
    // Il grassetto di una parola rende misto il peso. Senza gli stili del
    // documento (ADR 0231) lo stile di serie ha il suo campo.
    expect(property("preset")).not.toBeNull();
    expect(property("weight").querySelector("select")!.value).toBe("");
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("mixed");
    expect(toggle("Corsivo").getAttribute("aria-pressed")).toBe("false");
    expect(propertyInput("leading").value).toBe("125");
    expect(propertyInput("spacing").value).toBe("0");
    toggle("Grassetto").click();
    expect(opening()).toContain('font-size="32" font-weight="bold">');
    expect(editor.engine.text).toContain('<tspan x="10" dy="40">Due tre</tspan>');
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("true");
    enter(propertyInput("size"), "64");
    expect(opening()).toContain('font-size="64" font-weight="bold">');
    // L'interlinea segue il corpo.
    expect(editor.engine.text).toContain('<tspan x="10" dy="80">');
    enter(propertyInput("leading"), "150");
    expect(editor.engine.text).toContain('<tspan x="10" dy="96">');
    enter(propertyInput("spacing"), "5");
    expect(opening()).toContain('letter-spacing="3.2"');
    toggle("Corsivo").click();
    expect(opening()).toContain('font-style="italic"');
    expect(changes).toHaveLength(5);
    const undone = [1, 2, 3, 4, 5].map(() => {
      editor.undo();
      return spoken();
    });
    expect(undone).toEqual([
      "Annullato: Corsivo.",
      "Annullato: Spaziatura delle lettere.",
      "Annullato: Interlinea.",
      "Annullato: Dimensione del testo.",
      "Annullato: Grassetto.",
    ]);
    expect(editor.engine.text).toBe(TEXT);
  });

  it("«Disponi» ha i comandi della barra, che dicono quando non servono", () => {
    mount(TWO);
    editor.select([A, B]);
    key("Enter");
    expect(properties().querySelector(".draw-properties-subject")!.textContent).toBe("2 oggetti");
    const action = (id: string): HTMLButtonElement => properties().querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
    expect(action("distribute-x").getAttribute("aria-disabled")).toBe("true");
    action("align-left").click();
    // Il bordo del contorno va a 10, dove comincia l'altro.
    expect(editor.engine.text).toContain(`stroke-width="2" transform="matrix(1 0 0 1 -49 0)"/>`);
    expect(changes).toHaveLength(1);
    expect(editor.selection).toEqual([A, B]);
  });

  it("senza selezione: la pagina, l'unità, la descrizione e la vista", () => {
    const grids: (readonly [boolean | null, boolean])[] = [];
    mount(TWO, { onGridChange: (grid) => grids.push([grid.panel, grid.shown]) });
    key("Enter");
    expect(propertyInput("pageWidth").value).toBe("100");
    enter(propertyInput("pageWidth"), "200");
    expect(editor.engine.text).toContain('viewBox="0 0 200 100"');
    choose("unit", "mm");
    expect(spoken()).toBe("Il documento ora misura in millimetri.");
    expect(editor.engine.text).toContain('fub:units="mm"');
    expect(propertyLabel("pageWidth")).toBe("Larghezza della pagina (mm)");
    expect(propertyInput("pageWidth").value).toBe("52,917");
    const desc = property("desc").querySelector("textarea")!;
    typeIn(desc, "Una prova");
    key("Enter", { ctrlKey: true }, desc);
    expect(editor.engine.text).toContain("<desc>Una prova</desc>");
    flip("grid");
    expect(editor.grid.shown).toBe(true);
    expect(spoken()).toBe("Griglia visibile.");
    // Il pannello aperto da chi disegna si ricorda, come la griglia.
    expect(grids).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(changes).toHaveLength(3);
  });

  it("in un documento che si legge soltanto mostra, e non scrive", () => {
    mount(TWO);
    editor.select([A]);
    key("Enter");
    editor.setReadOnly(true);
    expect(propertyInput("x").readOnly).toBe(true);
    expect(button().disabled).toBe(false);
    enter(propertyInput("x"), "100");
    expect(changes).toEqual([]);
    editor.setReadOnly(false);
    expect(propertyInput("x").readOnly).toBe(false);
  });
});

describe("la barra accanto alla selezione, nel Completo", () => {
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const spot = (): readonly number[] => /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(bar().style.transform)!.slice(1).map(Number);

  it("sta sotto la selezione, oltre le maniglie; in cima al foglio se chi disegna lo sceglie", () => {
    mount(SOURCE);
    size(800, 600);
    editor.select(["o1a2b3c4d"]);
    expect(bar().hidden).toBe(false);
    expect(bar().hasAttribute("data-beside")).toBe(true);
    // Il rettangolo va da 59 a 81 col contorno: la barra, larga zero in
    // happy-dom, sta al suo centro e sotto le maniglie.
    const [x, y] = spot();
    expect(x).toBe(70);
    expect(y).toBeGreaterThan(81 + 12);
    editor.select([]);
    key("Enter");
    property("bar").querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(spoken()).toBe("La barra della selezione sta in cima al foglio.");
    expect(editor.grid.bar).toBe(false);
    editor.select(["o1a2b3c4d"]);
    expect(bar().hasAttribute("data-beside")).toBe(false);
    expect(bar().style.transform).toBe("");
  });

  it("durante un gesto non si vede, e dopo segue la selezione", () => {
    mount(doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="20" width="10" height="10" fill="#000000"/></g>`));
    size(800, 600);
    editor.setTool("select");
    editor.select(["oa1a1a1a1"]);
    expect(spot()[0]).toBe(15);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 15, clientY: 25, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 115, clientY: 25, timeStamp: (clock += 8) }));
    expect(bar().hasAttribute("data-gesture")).toBe(true);
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 115, clientY: 25, timeStamp: (clock += 8) }));
    expect(bar().hasAttribute("data-gesture")).toBe(false);
    expect(spot()[0]).toBe(115);
  });

  it("si sceglie anche in «Pagina e griglia»", () => {
    mount(SOURCE);
    size(800, 600);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!.click();
    const item = [...document.querySelectorAll<HTMLElement>(".context-menu button")].find(
      (one) => one.querySelector(".menu-label")?.textContent === "Barra accanto alla selezione",
    )!;
    expect(item.getAttribute("aria-checked")).toBe("true");
    item.click();
    expect(spoken()).toBe("La barra della selezione sta in cima al foglio.");
    expect(editor.grid.bar).toBe(false);
    editor.select(["o1a2b3c4d"]);
    expect(bar().hidden).toBe(false);
    expect(bar().hasAttribute("data-beside")).toBe(false);
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });
});

describe("da tastiera", () => {
  /// Un rettangolo pieno senza contorno: il suo riquadro è quello scritto.
  const BOXES = doc(
    `<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="10" fill="#0072b2"/>` +
      `<rect id="ob2b2b2b2" x="50" y="50" width="10" height="10" fill="#000000"/></g>`,
  );

  it("il foglio dice che cosa fanno i tasti", () => {
    mount();
    const hint = document.getElementById(surface().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("Spazio preme e rilascia");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("le frecce muovono il cursore dal centro, e dicono dove è e che cosa c'è sotto", () => {
    mount();
    size(120, 140);
    const mark = host.querySelector<HTMLElement>(".draw-cursor")!;
    expect(mark.hidden).toBe(true);
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    key("ArrowRight");
    expect(spoken()).toBe("x 70, y 70");
    expect(mark.hidden).toBe(false);
    expect(mark.style.transform).toBe("translate(70px, 70px)");
    key("ArrowLeft", { shiftKey: true });
    expect(spoken()).toBe("x 20, y 70");
    key("ArrowRight", { ctrlKey: true });
    expect(spoken()).toBe("x 21, y 70");
    expect(changes).toEqual([]);
  });

  it("dice l'oggetto sotto il cursore, col colore", () => {
    mount();
    size(120, 140);
    key("ArrowUp", { ctrlKey: true });
    expect(spoken()).toBe("x 60, y 69: Rettangolo, Nero");
  });

  it("la vista segue il cursore quando arriva al bordo", () => {
    mount();
    size(100, 100);
    for (let i = 0; i < 3; i++) key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 200, y 50");
    expect(host.querySelector(".draw-cursor")!.getAttribute("style")).toContain("translate(76px, 50px)");
    expect(host.querySelector(".draw-preview g")!.getAttribute("transform")).toBe("matrix(1 0 0 1 -124 0)");
  });

  it("un rettangolo: Spazio preme, le frecce tracciano, Spazio rilascia", () => {
    mount();
    size(400, 300);
    key("r");
    key("ArrowRight");
    key(" ");
    expect(spoken()).toBe("Premuto: le frecce tracciano, Spazio rilascia, Esc annulla.");
    expect(host.querySelector(".draw-cursor")!.hasAttribute("data-pressed")).toBe(true);
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    expect(host.querySelector(".draw-preview rect")).not.toBeNull();
    key(" ");
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="210" y="150" width="100" height="50" fill="none" stroke="#000000" stroke-width="4"\/>/);
    expect(spoken()).toBe("Rettangolo aggiunto. Il disegno ha 2 oggetti.");
    expect(host.querySelector(".draw-cursor")!.hasAttribute("data-pressed")).toBe(false);
    expect(changes).toHaveLength(1);
  });

  it("la penna scrive un tratto, fitto come col mouse; Invio rilascia", () => {
    mount();
    size(400, 300);
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown");
    key("Enter");
    expect(editor.engine.text).toMatch(/<path id="o[a-z0-9]{8}" fub:tool="pen" [^>]*fub:ink="1 [^"]+"\/>/);
    const ink = decodeInk(/fub:ink="([^"]+)"/.exec(editor.engine.text)![1]!);
    // Un campione ogni 4 pixel: 50 px e 10 px fanno 13 e 3 campioni, più il
    // primo; 16 ms l'uno dall'altro.
    expect(ink.values.length / ink.channels.length).toBe(17);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 2 oggetti.");
  });

  it("la gomma toglie ciò che il cursore attraversa", () => {
    mount();
    size(100, 140);
    key("e");
    key(" ");
    key("ArrowRight");
    key("ArrowRight");
    key(" ");
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 0 oggetti.");
  });

  it("la selezione: Spazio due volte sceglie, e premendo si trascina", () => {
    mount();
    size(120, 140);
    key("v");
    key(" ");
    key(" ");
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(spoken()).toBe("1 oggetto scelto.");
    // Mentre la tastiera preme, le frecce muovono il cursore anche con una
    // selezione: il gesto trascina.
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key(" ");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 50 0)"');
    expect(spoken()).toBe("1 oggetto spostato.");
  });

  it("un tocco senza niente sotto dice che il cursore è su", () => {
    mount();
    size(400, 300);
    key("l");
    key(" ");
    key(" ");
    expect(changes).toEqual([]);
    expect(spoken()).toBe("Rilasciato.");
  });

  it("Esc annulla il gesto, e il puntatore lo prende al suo posto", () => {
    mount();
    size(400, 300);
    key("r");
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key("Escape");
    expect(host.querySelector(".draw-preview rect")).toBeNull();
    key(" ");
    key("ArrowDown", { shiftKey: true });
    drag([[10, 10], [50, 40]]);
    expect(changes).toHaveLength(1);
    expect(editor.engine.text).toContain('x="10" y="10" width="40" height="30"');
    expect(host.querySelector<HTMLElement>(".draw-cursor")!.hidden).toBe(true);
  });

  it("il fuoco che se ne va porta via il gesto", () => {
    mount();
    size(400, 300);
    editor.focus();
    key("r");
    key(" ");
    key("ArrowRight", { shiftKey: true });
    surface().dispatchEvent(new FocusEvent("blur"));
    key(" ");
    expect(changes).toEqual([]);
  });

  it("Tab passa all'oggetto dopo e lo dice; alla fine lascia uscire", () => {
    mount(BOXES);
    expect(key("Tab").defaultPrevented).toBe(false);
    expect(key("Home").defaultPrevented).toBe(true);
    expect(editor.selection).toEqual(["oa1a1a1a1"]);
    expect(spoken()).toBe("Rettangolo, Blu, 1 di 2.");
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(editor.selection).toEqual(["ob2b2b2b2"]);
    expect(spoken()).toBe("Rettangolo, Nero, 2 di 2.");
    expect(key("Tab").defaultPrevented).toBe(false);
    key("Tab", { shiftKey: true });
    expect(editor.selection).toEqual(["oa1a1a1a1"]);
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    key("End");
    expect(editor.selection).toEqual(["ob2b2b2b2"]);
  });

  it("Ctrl e le frecce ridimensionano la selezione, ferma in alto a sinistra", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(BOXES);
    editor.select(["oa1a1a1a1"]);
    key("ArrowRight", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1.5 0 0 1 -5 0)"');
    expect(spoken()).toBe("Misure: 30 × 10.");
    key("ArrowUp", { metaKey: true });
    expect(editor.engine.text).toContain('transform="matrix(1.5 0 0 0.9 -5 1)"');
    expect(spoken()).toBe("Misure: 30 × 9.");
    expect(editor.selection).toEqual(["oa1a1a1a1"]);
    // I due colpi di fila sono un passo solo.
    editor.undo();
    expect(spoken()).toBe("Annullato: Ridimensionamento.");
    expect(editor.engine.text).toBe(BOXES);
  });

  it("una linea dritta non si ridimensiona sul lato che misura zero", () => {
    mount(doc(`${LAYER}<line id="oc3c3c3c3" x1="10" y1="10" x2="30" y2="10" stroke="#000000" stroke-width="0"/></g>`));
    editor.select(["oc3c3c3c3"]);
    key("ArrowDown", { ctrlKey: true });
    expect(changes).toEqual([]);
  });

  it("Invio apre posizione e misure; i campi non toccati restano esatti", async () => {
    // Senza il pannello delle proprietà, che il PDF non ha, Invio apre una finestra.
    mount(BOXES, { profile: "pdf" });
    editor.select(["oa1a1a1a1"]);
    editor.focus();
    key("Enter");
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().querySelector("h2")!.textContent).toBe("Posizione e misure");
    expect(["x", "y", "w", "h"].map((name) => field(name).value)).toEqual(["10", "10", "20", "10"]);
    expect(document.activeElement).toBe(field("x"));
    field("x").value = "100";
    field("w").value = "40";
    await submit();
    expect(editor.engine.text).toContain('transform="matrix(2 0 0 1 80 0)"');
    expect(document.activeElement).toBe(surface());
    // Soltanto la posizione: uno spostamento.
    key("Enter");
    field("y").value = "15";
    await submit();
    expect(editor.engine.text).toContain('transform="matrix(2 0 0 1 80 5)"');
    expect(spoken()).toBe("1 oggetto spostato.");
  });

  it("Invio senza selezione apre le proprietà del disegno, in un passo che si annulla", async () => {
    // Senza il pannello delle proprietà, che il PDF non ha, Invio apre una finestra.
    mount(BOXES, { profile: "pdf" });
    key("Enter");
    expect(dialog().querySelector("h2")!.textContent).toBe("Proprietà del disegno");
    expect(field("title").value).toBe("Prova");
    expect(field("desc").tagName).toBe("TEXTAREA");
    expect([field("w").value, field("h").value]).toEqual(["100", "100"]);
    field("title").value = " Casa ";
    field("desc").value = "La pianta";
    field("w").value = "150";
    await submit();
    expect(editor.engine.text).toContain("<title>Casa</title>");
    expect(editor.engine.text).toContain("<desc>La pianta</desc>");
    expect(editor.engine.text).toContain('viewBox="0 0 150 100"');
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(BOXES);
    expect(spoken()).toBe("Annullato: Proprietà del disegno.");
  });

  it("annullare la finestra non scrive niente", () => {
    // Senza il pannello delle proprietà, che il PDF non ha, Invio apre una finestra.
    mount(BOXES, { profile: "pdf" });
    editor.select(["oa1a1a1a1"]);
    key("Enter");
    // Un secondo Invio non apre un'altra finestra.
    key("Enter");
    expect(document.querySelectorAll(".modale")).toHaveLength(1);
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(changes).toEqual([]);
  });

  it("«?» elenca i tasti, gruppo per gruppo", () => {
    mount(SOURCE, { workspace: "simple" });
    key("?", { shiftKey: true });
    expect(dialog().querySelector("h2")!.textContent).toBe("Tasti del disegno");
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toEqual([
      "Strumenti",
      "Disegnare da tastiera",
      "Oggetti",
      "Evidenziatore",
      "Proprietà",
      "Vista",
      "Modifica",
    ]);
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["R", "Rettangolo"]);
    expect(rows).toContainEqual(["Space o Enter", "Preme, e poi rilascia"]);
    expect(rows).toContainEqual(["Ctrl+←↑→↓", "Ridimensiona la selezione di 1, con Maiusc di 10"]);
    expect(rows).toContainEqual(["Ctrl+Shift+Z", "Ripeti"]);
    expect(rows).toContainEqual(["Esc", "Toglie la selezione"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("nel Completo non c'è «Mostra tutto»: non ci sono altri tasti (ADR 0231)", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    expect(dialog().querySelector(".keys-show-all")).toBeNull();
    const captions = [...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent);
    expect(captions.some((caption) => /Nodi|Bézier|Attributi|Maschera|Tracciato/.test(caption ?? ""))).toBe(false);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("i pulsanti della barra fanno lo stesso", () => {
    mount();
    const named = (label: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!;
    expect(named("Proprietà").getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(named("Tasti del disegno").getAttribute("aria-haspopup")).toBe("dialog");
    named("Tasti del disegno").click();
    expect(dialog().querySelector("h2")!.textContent).toBe("Tasti del disegno");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("la camera non si anima mai: ogni inquadratura è subito quella nuova", () => {
    const source = doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="10" height="10" fill="#000000"/><rect id="ob2b2b2b2" x="500" y="500" width="10" height="10" fill="#000000"/></g>`);
    mount(source);
    size(100, 100);
    key("Home");
    key("Tab");
    // Nello stesso gestore del tasto: nessun fotogramma in mezzo.
    expect(host.querySelector(".draw-preview g")!.getAttribute("transform")).toBe("matrix(1 0 0 1 -455 -455)");
  });
});

describe("la cornice di trasformazione", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const G = "og1g1g1g1";
  /// Un rettangolo pieno senza contorno, da (100, 100) a (200, 150). La
  /// cornice gli sta a 4 px: l'angolo in basso a destra è (204, 154), il lato
  /// destro (204, 125), la maniglia della rotazione (150, 72).
  const RECT = `<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000"/>`;
  const ONE = doc(`${LAYER}${RECT}</g>`);
  /// Lo stesso riquadro, in due metà raccolte in un gruppo.
  const GROUP = doc(
    `${LAYER}<g id="${G}"><rect id="${A}" x="100" y="100" width="50" height="50" fill="#000000"/>` +
      `<rect id="${B}" x="150" y="100" width="50" height="50" fill="#000000"/></g></g>`,
  );
  /// Due oggetti diversi: il loro riquadro comune, da (30, 30) a (62, 70),
  /// cambia forma quando ruotano, e ruotando restano nella pagina.
  const TWO = doc(
    `${LAYER}<rect id="${A}" x="30" y="30" width="20" height="10" fill="#000000"/>` +
      `<rect id="${B}" x="55" y="45" width="7" height="25" fill="#000000"/></g>`,
  );

  const transformOf = (id: string): string | null => editor.engine.text.match(new RegExp(`id="${id}"[^>]*? transform="([^"]*)"`))?.[1] ?? null;
  const matrixOf = (id: string): number[] => transformOf(id)!.match(/^matrix\((.*)\)$/)![1]!.split(" ").map(Number);
  const hover = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  };
  const selecting = (source: string, keys: readonly string[], options: DrawEditorOptions = {}): void => {
    mount(source, options);
    editor.setTool("select");
    editor.select(keys);
  };

  it("un angolo tira due bordi e tiene fermo l'opposto; le misure si dicono, e il passo si annulla", () => {
    selecting(ONE, [A]);
    drag([[204, 154], [230, 170], [254, 179]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(spoken()).toBe("Misure: 150 × 75.");
    expect(editor.selection).toEqual([A]);
    editor.undo();
    expect(editor.engine.text).toBe(ONE);
    expect(spoken()).toBe("Annullato: Ridimensionamento.");
  });

  it("un lato tira un bordo solo; con Alt il centro resta fermo", () => {
    selecting(ONE, [A]);
    drag([[204, 125], [230, 140], [254, 140]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1 -50 0)");
    editor.undo();
    drag([[204, 125], [214, 125], [224, 125]], { altKey: true });
    expect(transformOf(A)).toBe("matrix(1.4 0 0 1 -60 0)");
    expect(spoken()).toBe("Misure: 140 × 50.");
  });

  it("con Maiusc un angolo tiene le proporzioni", () => {
    selecting(ONE, [A]);
    drag([[204, 154], [230, 154], [254, 154]], { shiftKey: true });
    expect(transformOf(A)).toBe("matrix(1.4 0 0 1.4 -40 -40)");
  });

  it("un gruppo tiene le proporzioni da sé, e Maiusc lo lascia libero", () => {
    selecting(GROUP, [G]);
    drag([[204, 154], [230, 154], [254, 154]]);
    expect(transformOf(G)).toBe("matrix(1.4 0 0 1.4 -40 -40)");
    editor.undo();
    drag([[204, 154], [230, 154], [254, 154]], { shiftKey: true });
    expect(transformOf(G)).toBe("matrix(1.5 0 0 1 -50 0)");
    expect(editor.selection).toEqual([G]);
  });

  it("più oggetti si ridimensionano insieme, nel loro riquadro comune", () => {
    const PAIR = doc(
      `${LAYER}<rect id="${A}" x="100" y="100" width="50" height="20" fill="#000000"/>` +
        `<rect id="${B}" x="160" y="120" width="40" height="30" fill="#000000"/></g>`,
    );
    selecting(PAIR, [A, B]);
    drag([[204, 154], [230, 170], [254, 179]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(transformOf(B)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(spoken()).toBe("Misure: 150 × 75.");
    expect(editor.selection).toEqual([A, B]);
  });

  it("con la griglia il bordo va sulla riga, e Ctrl o ⌘ lo lascia libero", () => {
    selecting(ONE, [A], { grid: { shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    drag([[204, 125], [220, 125], [237, 125]]);
    expect(transformOf(A)).toBe("matrix(1.4 0 0 1 -40 0)");
    editor.undo();
    drag([[204, 125], [220, 125], [237, 125]], { ctrlKey: true });
    expect(transformOf(A)).toBe("matrix(1.33 0 0 1 -33 0)");
  });

  it("una linea dritta ha solo le maniglie lungo di sé, e si allunga col suo contorno", () => {
    const LINE = doc(`${LAYER}<line id="${A}" x1="100" y1="100" x2="200" y2="100" stroke="#000000" stroke-width="2"/></g>`);
    selecting(LINE, [A]);
    // Il contorno arriva a 201, la cornice 4 px più in là.
    hover(205, 100);
    expect(surface().dataset.grip).toBe("ew");
    hover(150, 105);
    expect(surface().dataset.grip).toBeUndefined();
    drag([[205, 100], [230, 100], [256, 100]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1 -49.5 0)");
  });

  it("un oggetto ruotato si ridimensiona lungo i suoi assi, e le maniglie lo seguono", () => {
    const TURNED = doc(`${LAYER}<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000" transform="rotate(90 150 125)"/></g>`);
    selecting(TURNED, [A]);
    // Ruotato di 90° attorno al centro, il lato destro guarda in basso.
    hover(150, 179);
    expect(surface().dataset.grip).toBe("ns");
    drag([[150, 179], [150, 200], [150, 229]]);
    expect(transformOf(A)).toBe("matrix(0 1.5 -1 0 275 -75)");
    expect(spoken()).toBe("Misure: 150 × 50.");
  });

  it("la maniglia in alto ruota attorno al centro, e si ferma da sola sugli angoli retti", () => {
    selecting(ONE, [A]);
    drag([[150, 72], [180, 80], [203, 125]]);
    expect(transformOf(A)).toBe("matrix(0 1 -1 0 275 -25)");
    expect(spoken()).toBe("Rotazione di 90° in senso orario.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Rotazione.");
    // Poco più di un grado prima dell'angolo retto: la calamita lo prende,
    // Ctrl o ⌘ la spegne.
    drag([[150, 72], [180, 80], [203, 124]]);
    expect(transformOf(A)).toBe("matrix(0 1 -1 0 275 -25)");
    editor.undo();
    drag([[150, 72], [180, 80], [203, 124]], { ctrlKey: true });
    expect(spoken()).toBe("Rotazione di 88,9° in senso orario.");
    editor.undo();
    drag([[150, 72], [120, 80], [97, 125]]);
    expect(transformOf(A)).toBe("matrix(0 -1 1 0 25 275)");
    expect(spoken()).toBe("Rotazione di 90° in senso antiorario.");
  });

  it("con Maiusc la rotazione va a passi di 15°", () => {
    selecting(ONE, [A]);
    // 20° dalla maniglia: il passo più vicino è 15°.
    drag([[150, 72], [160, 74], [168, 75]], { shiftKey: true });
    expect(spoken()).toBe("Rotazione di 15° in senso orario.");
    const [a, b] = matrixOf(A);
    expect(a).toBeCloseTo(Math.cos(Math.PI / 12), 3);
    expect(b).toBeCloseTo(Math.sin(Math.PI / 12), 3);
  });

  it("[ e ] ruotano la selezione di 15°, con Maiusc di 90°, anche con AltGr; senza selezione il tasto resta a chi lo aveva", () => {
    mount(ONE);
    // Con la Penna `[` e `]` sono della punta (P4).
    editor.setTool("select");
    expect(key("]").defaultPrevented).toBe(false);
    editor.select([A]);
    expect(key("]").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Rotazione di 15° in senso orario.");
    const [a, b] = matrixOf(A);
    expect(a).toBeCloseTo(Math.cos(Math.PI / 12), 3);
    expect(b).toBeCloseTo(Math.sin(Math.PI / 12), 3);
    key("}", { shiftKey: true });
    expect(spoken()).toBe("Rotazione di 90° in senso orario.");
    key("{", { shiftKey: true });
    key("[");
    expect(spoken()).toBe("Rotazione di 15° in senso antiorario.");
    // Su una tastiera italiana [ è AltGr+è, che arriva come Ctrl e Alt.
    const event = new KeyboardEvent("keydown", { key: "[", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: (state: string) => state === "AltGraph" });
    surface().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(spoken()).toBe("Rotazione di 15° in senso antiorario.");
    const [c, d] = matrixOf(A);
    expect(c).toBeCloseTo(Math.cos(Math.PI / 12), 3);
    expect(d).toBeCloseTo(-Math.sin(Math.PI / 12), 3);
  });

  it("più oggetti tengono la loro cornice ruotata: un giro intero li riporta dov'erano, e si annulla in un passo", () => {
    mount(TWO);
    editor.setTool("select");
    editor.select([A, B]);
    for (let turn = 0; turn < 24; turn++) key("]");
    expect(editor.selection).toEqual([A, B]);
    for (const id of [A, B]) {
      const [a, b, c, d, e, f] = matrixOf(id);
      expect([a, b, c, d]).toEqual([1, 0, 0, 1].map((value) => expect.closeTo(value, 3)));
      expect([e, f]).toEqual([0, 0].map((value) => expect.closeTo(value, 1)));
    }
    editor.undo();
    expect(editor.engine.text).toBe(TWO);
  });

  it("Esc a metà del gesto lascia tutto com'era, e un tocco su una maniglia non cambia niente", () => {
    selecting(ONE, [A]);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 204, clientY: 154, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 254, clientY: 179, timeStamp: (clock += 8) }));
    expect(surface().dataset.grip).toBe("nwse");
    key("Escape");
    expect(surface().dataset.grip).toBeUndefined();
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 254, clientY: 179, timeStamp: (clock += 8) }));
    drag([[204, 154], [204, 154]]);
    drag([[150, 72], [150, 72]]);
    expect(editor.engine.text).toBe(ONE);
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual([A]);
  });

  it("sopra una maniglia il puntatore dice che cosa farà; con un altro strumento no", () => {
    selecting(ONE, [A]);
    hover(204, 154);
    expect(surface().dataset.grip).toBe("nwse");
    hover(204, 96);
    expect(surface().dataset.grip).toBe("nesw");
    hover(150, 154);
    expect(surface().dataset.grip).toBe("ns");
    hover(150, 72);
    expect(surface().dataset.grip).toBe("rotate");
    hover(150, 125);
    expect(surface().dataset.grip).toBeUndefined();
    hover(204, 125);
    expect(surface().dataset.grip).toBe("ew");
    editor.setTool("pen");
    expect(surface().dataset.grip).toBeUndefined();
    hover(204, 125);
    expect(surface().dataset.grip).toBeUndefined();
  });

  it("il segno di un collegamento scelto lascia libera la maniglia d'angolo, e segue la cornice", () => {
    const L = "ol1l1l1l1";
    const LINKED = doc(`${LAYER}<a id="${L}" href="n.md">${RECT}</a></g>`);
    mount(LINKED, { links: { choose: vi.fn(async () => null), open: vi.fn() } });
    const mark = (): string => host.querySelector<HTMLElement>(".draw-link-mark")!.style.transform;
    editor.select([L]);
    expect(mark()).toBe("translate(200px, 100px)");
    editor.setTool("select");
    expect(mark()).toBe("translate(208px, 92px)");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 204, clientY: 154, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 254, clientY: 179, timeStamp: (clock += 8) }));
    expect(mark()).toBe("translate(258px, 92px)");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 254, clientY: 179, timeStamp: (clock += 8) }));
    expect(transformOf(L)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(mark()).toBe("translate(258px, 92px)");
  });

  it("«?» elenca i tasti della rotazione", () => {
    mount(ONE);
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["[ o ]", "Ruota la selezione di 15° in senso antiorario o orario, con Maiusc di 90°"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("l'albero degli oggetti", () => {
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!;
  const tree = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
  const labels = (): string[] => [...host.querySelectorAll(".draw-object-label")].map((label) => label.textContent ?? "");

  it("è chiuso finché non lo si apre; aperto prende il fuoco", () => {
    mount();
    const panel = host.querySelector<HTMLElement>(".draw-objects")!;
    expect(panel.hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel.id);
    button().click();
    expect(panel.hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(tree());
    expect(labels()).toEqual(["Livello «Livello 1», corrente", "Rettangolo, Nero"]);
    expect(host.querySelector(".draw-objects-count")!.textContent).toBe("1 oggetto");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    button().click();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
  });

  it("ha la stessa selezione del foglio, nei due sensi", () => {
    mount();
    button().click();
    const row = (): HTMLElement => host.querySelector<HTMLElement>('[data-key="o1a2b3c4d"]')!;
    expect(row().getAttribute("aria-selected")).toBe("false");
    editor.select(["o1a2b3c4d"]);
    expect(row().getAttribute("aria-selected")).toBe("true");
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(surface());
    key("Escape");
    expect(row().getAttribute("aria-selected")).toBe("false");
    tree().focus();
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
  });

  it("segue il disegno: un oggetto nuovo ci entra, uno eliminato ne esce", () => {
    mount();
    button().click();
    editor.setTool("ellipse");
    drag([[10, 10], [50, 30]]);
    expect(labels()).toEqual(["Livello «Livello 1», corrente", "Ellisse, Nero", "Rettangolo, Nero"]);
    editor.select(["o1a2b3c4d"]);
    editor.deleteSelection();
    expect(labels()).toEqual(["Livello «Livello 1», corrente", "Ellisse, Nero"]);
  });

  it("Invio su un oggetto apre le sue proprietà, Canc lo elimina", () => {
    mount();
    button().click();
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const properties = host.querySelector<HTMLElement>(".draw-properties")!;
    expect(properties.hidden).toBe(false);
    expect(properties.querySelector(".draw-properties-subject")!.textContent).not.toBe("Il disegno");
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
  });
});

describe("i nomi e il filtro dell'albero, nel Completo", () => {
  const NAMED = doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/><rect x="40" y="10" width="20" height="20" fill="#0072b2"/></g>`);
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!;
  const tree = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
  const labels = (): string[] => [...host.querySelectorAll(".draw-object-label")].map((label) => label.textContent ?? "");
  const field = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>(".draw-object-rename");
  const inTree = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, tree());
  const activeKey = (): string | undefined => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.dataset.key;

  /// Scrive `text` nel campo del nome aperto e lo conferma con Invio.
  function rename(text: string): void {
    const input = field()!;
    input.value = text;
    key("Enter", {}, input);
  }

  it("F2 sulla riga dà all'oggetto il suo nome, il primo `title`, in un passo che si annulla; vuoto lo toglie", () => {
    mount(NAMED);
    button().click();
    // Dal davanti: in cima il rettangolo che il documento ha per ultimo.
    expect(labels()).toEqual(["Livello «Livello 1», corrente", "Rettangolo, Blu", "Rettangolo, Nero"]);
    inTree("End");
    expect(editor.selection).toEqual(["oa1a1a1a1"]);
    expect(inTree("F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(field()!.value).toBe("");
    expect(field()!.getAttribute("aria-label")).toBe("Nome di Rettangolo, Nero");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    rename("  Tetto ");
    expect(editor.engine.text).toMatch(/<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000">\s*<title>Tetto<\/title>\s*<\/rect>/);
    expect(spoken()).toBe("Ora si chiama «Tetto».");
    expect(labels()[2]).toBe("Rettangolo «Tetto», Nero");
    expect(document.activeElement).toBe(tree());
    expect(activeKey()).toBe("oa1a1a1a1");
    expect(editor.selection).toEqual(["oa1a1a1a1"]);
    editor.undo();
    expect(editor.engine.text).toBe(NAMED);
    expect(spoken()).toBe("Annullato: Nome.");
    editor.redo();
    tree().focus();
    inTree("F2");
    expect(field()!.value).toBe("Tetto");
    rename("");
    // Il rettangolo torna com'era, su una riga sua come ogni elemento riscritto.
    expect(editor.engine.text).toContain('<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>');
    expect(editor.engine.text).not.toContain("<title>");
    expect(spoken()).toBe("Nome tolto: ora è Rettangolo, Nero.");
    expect(changes.map((change) => change.origin)).toEqual(["input", "undo", "redo", "input"]);
  });

  it("un oggetto senza id ne riceve uno, e resta scelto e sulla riga attiva", () => {
    mount(NAMED);
    button().click();
    inTree("ArrowDown");
    expect(editor.selection[0]).toMatch(/^@/);
    inTree("F2");
    rename("Finestra");
    const [now] = editor.selection;
    expect(now).toMatch(/^o[a-z0-9]{8}$/);
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${now}" x="40" y="10" width="20" height="20" fill="#0072b2">\\s*<title>Finestra</title>`));
    expect(activeKey()).toBe(now);
  });

  it("un livello si rinomina da qui, e non resta senza nome", () => {
    mount(NAMED);
    button().click();
    inTree("F2");
    expect(field()!.value).toBe("Livello 1");
    expect(field()!.maxLength).toBe(80);
    rename("Disegno");
    expect(editor.engine.text).toContain('<g id="l1" fub:layer="Disegno">');
    expect(spoken()).toBe("Il livello ora si chiama «Disegno».");
    expect(labels()[0]).toBe("Livello «Disegno», corrente");
    inTree("F2");
    rename("   ");
    expect(spoken()).toBe("Un livello ha sempre un nome: resta quello di prima.");
    expect(editor.engine.text).toContain('<g id="l1" fub:layer="Disegno">');
    // Esc lascia il nome com'era.
    inTree("F2");
    field()!.value = "Altro";
    key("Escape", {}, field()!);
    expect(editor.engine.text).toContain('<g id="l1" fub:layer="Disegno">');
    expect(document.activeElement).toBe(tree());
  });

  it("dice perché non rinomina un oggetto bloccato, dentro qualcosa di bloccato o in un livello bloccato, o che non sa riscrivere", () => {
    const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";
    mount(
      doc(
        `${LAYER}<rect id="oa1a1a1a1" width="10" height="10" fub:locked="true"/>` +
          `<g id="og1g1g1g1" fub:locked="true"><rect id="ob2b2b2b2" width="10" height="10"/></g>` +
          `<rect id="oc3c3c3c3" xmlns:inkscape="${INKSCAPE}" inkscape:label="Tetto" width="10" height="10"/></g>`,
      ),
      {},
    );
    button().click();
    inTree("ArrowDown");
    expect(activeKey()).toBe("oc3c3c3c3");
    inTree("F2");
    expect(field()).toBeNull();
    expect(spoken()).toBe("Ha parti che il disegno non sa riscrivere: il suo nome resta com’è.");
    inTree("ArrowDown");
    inTree("F2");
    expect(spoken()).toBe("È bloccato: sbloccalo per cambiargli il nome.");
    inTree("ArrowRight");
    inTree("ArrowRight");
    expect(activeKey()).toBe("ob2b2b2b2");
    inTree("F2");
    expect(spoken()).toBe("Ciò che lo contiene è bloccato: sbloccalo prima di cambiargli il nome.");
    inTree("End");
    inTree("F2");
    expect(spoken()).toBe("È bloccato: sbloccalo per cambiargli il nome.");
    expect(field()).toBeNull();
    expect(changes).toEqual([]);

    editor.dispose();
    mount(doc(`${LAYER.replace(">", ' fub:locked="true">')}<rect id="oa1a1a1a1" width="10" height="10"/></g>`));
    button().click();
    inTree("ArrowDown");
    inTree("F2");
    expect(spoken()).toBe("Il suo livello è bloccato: sblocca il livello per cambiargli il nome.");
    // Il livello bloccato, lui, si rinomina.
    inTree("Home");
    inTree("F2");
    expect(field()!.value).toBe("Livello 1");
  });

  it("F2 sul foglio e «Rinomina» nel menu della selezione aprono il nome nell'albero", () => {
    // Una linea: F2 su una forma chiusa ne scrive l'etichetta.
    mount(NAMED.replace('<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>', '<line id="oa1a1a1a1" x1="10" y1="10" x2="30" y2="30" stroke="#000000"/>'));
    editor.select(["oa1a1a1a1"]);
    surface().focus();
    expect(key("F2").defaultPrevented).toBe(true);
    expect(host.querySelector<HTMLElement>(".draw-objects")!.hidden).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(field()!.closest('[data-key="oa1a1a1a1"]')).not.toBeNull();
    key("Escape", {}, field()!);
    surface().focus();
    key("a", { ctrlKey: true });
    key("F2");
    expect(spoken()).toBe("Scegli un oggetto solo per cambiargli il nome.");
    expect(field()).toBeNull();
    editor.select(["oa1a1a1a1"]);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!.click();
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    const rename = [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")!.textContent === "Rinomina")!;
    expect(rename.querySelector(".menu-hint")?.textContent).toBe("F2");
    rename.click();
    expect(document.activeElement).toBe(field());
    expect(changes).toEqual([]);
  });

  it("il filtro c'è coi livelli, e scriverci non comanda il foglio", () => {
    mount(NAMED);
    button().click();
    const filter = host.querySelector<HTMLElement>(".draw-objects-filter")!;
    const search = host.querySelector<HTMLInputElement>(".draw-objects-search")!;
    expect(filter.hidden).toBe(false);
    const tool = editor.tool;
    search.focus();
    expect(key("r", {}, search).defaultPrevented).toBe(false);
    expect(key("Delete", {}, search).defaultPrevented).toBe(false);
    expect(editor.tool).toBe(tool);
    search.value = "blu";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labels()).toEqual(["Livello «Livello 1», corrente", "Rettangolo, Blu"]);
    expect(host.querySelector(".draw-objects-status")!.textContent).toBe("1 oggetto trovato.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un oggetto nuovo che il filtro trova ci entra.
    editor.setTool("rect");
    drag([[100, 100], [120, 120]]);
    expect(host.querySelector(".draw-objects-status")!.textContent).toBe("1 oggetto trovato.");
    editor.setWorkspace("simple");
    expect(filter.hidden).toBe(true);
    expect(search.value).toBe("");
    expect(labels()).toHaveLength(4);
    // Senza i livelli niente nomi: F2 nell'albero passa.
    tree().focus();
    expect(inTree("F2").defaultPrevented).toBe(false);
    expect(changes.map((change) => change.origin)).toEqual(["input"]);
  });
});

describe("spostare dall'albero, nel Completo", () => {
  // Dal davanti: «Sopra» col cerchio, poi «Livello 1» con c, il gruppo g
  // (chiuso, con b) e a.
  const STACKED = doc(
    `${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>`
      + '<g id="og1g1g1g1" transform="translate(50 0)"><rect id="ob2b2b2b2" x="0" y="0" width="10" height="10" fill="#000000"/></g>'
      + '<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#0072b2"/></g>'
      + '<g id="l2" fub:layer="Sopra"><circle id="od4d4d4d4" cx="5" cy="5" r="4" fill="#000000"/></g>',
  );
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!;
  const tree = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
  const keys = (): string[] => [...host.querySelectorAll<HTMLElement>(".draw-object")].map((row) => row.dataset.key ?? "");
  const inTree = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, tree());
  const activeKey = (): string | undefined => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.dataset.key;
  /// Gli id degli elementi del disegno, in ordine di documento.
  const order = (): string[] => [...editor.engine.text.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!);
  const parentOf = (id: string): string | null => editor.engine.holder(id)?.parent?.facts.id ?? null;

  /// Apre l'albero con la riga `key` attiva e scelta.
  function openAt(id: string): void {
    button().click();
    (document.activeElement as HTMLElement).blur();
    editor.select([id]);
    tree().focus();
    expect(activeKey()).toBe(id);
  }

  it("Alt+↓ porta l'oggetto dietro a ciò che ha dietro, in un passo che si annulla, e dice dove è arrivato", () => {
    mount(STACKED);
    openAt("oc3c3c3c3");
    expect(keys()).toEqual(["l2", "od4d4d4d4", "l1", "oc3c3c3c3", "og1g1g1g1", "oa1a1a1a1"]);
    expect(inTree("ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
    // Oltre il gruppo chiuso: fra a e il gruppo.
    expect(order()).toEqual(["l1", "oa1a1a1a1", "oc3c3c3c3", "og1g1g1g1", "ob2b2b2b2", "l2", "od4d4d4d4"]);
    expect(spoken()).toBe("Rettangolo, Blu nel livello «Livello 1», al posto 2 di 3 dal davanti.");
    expect(keys()).toEqual(["l2", "od4d4d4d4", "l1", "og1g1g1g1", "oc3c3c3c3", "oa1a1a1a1"]);
    expect(editor.selection).toEqual(["oc3c3c3c3"]);
    expect(activeKey()).toBe("oc3c3c3c3");
    expect(document.activeElement).toBe(tree());
    editor.undo();
    expect(editor.engine.text).toBe(STACKED);
    expect(spoken()).toBe("Annullato: Riordino.");
    editor.redo();
    expect(order()).toEqual(["l1", "oa1a1a1a1", "oc3c3c3c3", "og1g1g1g1", "ob2b2b2b2", "l2", "od4d4d4d4"]);
    expect(changes.map((change) => change.origin)).toEqual(["input", "undo", "redo"]);
  });

  it("entra in un gruppo aperto restando dov'era sul foglio, ne esce, e passa al livello accanto", () => {
    mount(STACKED);
    openAt("oc3c3c3c3");
    inTree("ArrowDown");
    inTree("ArrowRight");
    inTree("ArrowUp");
    expect(activeKey()).toBe("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("og1g1g1g1");
    // Il gruppo è spostato di 50: il rettangolo lo compensa.
    expect(editor.engine.text).toContain('<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#0072b2" transform="matrix(1 0 0 1 -50 0)"/>');
    expect(spoken()).toMatch(/^Rettangolo, Blu dentro Gruppo.*, al posto 1 di 2 dal davanti\.$/);
    expect(activeKey()).toBe("oc3c3c3c3");
    // Davanti a tutto nel gruppo: Alt+↑ lo porta fuori, davanti al gruppo.
    inTree("ArrowUp", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("l1");
    expect(order().slice(0, 5)).toEqual(["l1", "oa1a1a1a1", "og1g1g1g1", "ob2b2b2b2", "oc3c3c3c3"]);
    expect(editor.engine.text).toContain('<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#0072b2"/>');
    // Davanti a tutto nel livello: nel livello sopra, dietro a ciò che c'è.
    inTree("ArrowUp", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("l2");
    expect(order()).toEqual(["l1", "oa1a1a1a1", "og1g1g1g1", "ob2b2b2b2", "l2", "oc3c3c3c3", "od4d4d4d4"]);
    expect(spoken()).toBe("Rettangolo, Blu nel livello «Sopra», al posto 2 di 2 dal davanti.");
    inTree("ArrowUp", { altKey: true });
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("È già davanti a tutto.");
    expect(changes).toHaveLength(4);
  });

  it("un livello va sopra o sotto gli altri, e resta il livello corrente", () => {
    mount(STACKED);
    button().click();
    inTree("Home");
    expect(activeKey()).toBe("l2");
    const current = host.querySelector(".draw-layer-button")?.textContent;
    inTree("ArrowDown", { altKey: true });
    expect(order()).toEqual(["l2", "od4d4d4d4", "l1", "oa1a1a1a1", "og1g1g1g1", "ob2b2b2b2", "oc3c3c3c3"]);
    expect(spoken()).toBe("«Sopra» ora è al posto 2 di 2 dall’alto.");
    expect(keys().filter((each) => each.startsWith("l"))).toEqual(["l1", "l2"]);
    expect(activeKey()).toBe("l2");
    expect(host.querySelector(".draw-layer-button")?.textContent).toBe(current);
    inTree("ArrowDown", { altKey: true });
    expect(spoken()).toBe("È già l’ultimo livello.");
    editor.undo();
    expect(editor.engine.text).toBe(STACKED);
    expect(spoken()).toBe("Annullato: Ordine dei livelli.");
  });

  it("dice perché non sposta ciò che è bloccato, o dentro qualcosa di bloccato; non entra in un livello bloccato", () => {
    mount(
      doc(
        `${LAYER.replace(">", ' fub:locked="true">')}<rect id="oe5e5e5e5" width="10" height="10"/></g>`
          + `<g id="l2" fub:layer="Sopra"><rect id="oa1a1a1a1" width="10" height="10" fub:locked="true"/>`
          + `<g id="og1g1g1g1" fub:locked="true"><rect id="ob2b2b2b2" width="10" height="10"/></g>`
          + `<rect id="oc3c3c3c3" width="10" height="10"/></g>`,
      ),
      {},
    );
    button().click();
    expect(keys()).toEqual(["l2", "oc3c3c3c3", "og1g1g1g1", "oa1a1a1a1", "l1", "oe5e5e5e5"]);
    inTree("End");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("Il suo livello è bloccato: sblocca il livello per spostarlo.");
    inTree("ArrowUp");
    inTree("ArrowUp");
    expect(activeKey()).toBe("oa1a1a1a1");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("È bloccato: sbloccalo per spostarlo.");
    inTree("ArrowUp");
    inTree("ArrowRight");
    inTree("ArrowRight");
    expect(activeKey()).toBe("ob2b2b2b2");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("Ciò che lo contiene è bloccato: sbloccalo prima di spostarlo.");
    inTree("Home");
    inTree("ArrowDown");
    expect(activeKey()).toBe("oc3c3c3c3");
    // Davanti a tutto, sopra non c'è niente; il gruppo bloccato si scavalca.
    inTree("ArrowDown", { altKey: true });
    expect(order().indexOf("oc3c3c3c3")).toBeLessThan(order().indexOf("og1g1g1g1"));
    expect(parentOf("oc3c3c3c3")).toBe("l2");
    inTree("ArrowDown", { altKey: true });
    inTree("ArrowDown", { altKey: true });
    expect(spoken()).toBe("Lì non va: quel livello è bloccato.");
    expect(parentOf("oc3c3c3c3")).toBe("l2");
    expect(changes).toHaveLength(2);
  });

  it("un oggetto che cambia livello tiene lo stile che gli dava il foglio del disegno; non va dove gliene darebbe uno che non si toglie", () => {
    const source = doc(
      `<style>#l2 rect{fill:#d55e00}</style>${LAYER}<rect id="oe5e5e5e5" width="10" height="10"/></g>`
        + `<g id="l2" fub:layer="Sopra"><rect id="oc3c3c3c3" width="10" height="10"/></g>`,
    );
    mount(source);
    button().click();
    expect(keys()).toEqual(["l2", "oc3c3c3c3", "l1", "oe5e5e5e5"]);
    inTree("Home");
    inTree("ArrowDown");
    expect(activeKey()).toBe("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(parentOf("oc3c3c3c3")).toBe("l1");
    expect(editor.engine.text).toContain('<rect id="oc3c3c3c3" width="10" height="10" fill="#d55e00"/>');
    expect(spoken()).toMatch(/ 1 elemento riscritto perché resti com’era\.$/);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(source);

    inTree("End");
    expect(activeKey()).toBe("oe5e5e5e5");
    inTree("ArrowUp", { altKey: true });
    expect(spoken()).toBe("Lì non va: un elemento cambierebbe «fill», e FubDraw non sa riscriverlo com’era.");
    expect(editor.engine.text).toBe(source);
  });

  it("un collegamento non entra in un altro collegamento: Alt lo porta oltre", () => {
    mount(
      doc(
        `${LAYER}<a id="ol1l1l1l1" href="Note/uno.md"><rect id="oa1a1a1a1" width="10" height="10"/></a>`
          + `<a id="ol2l2l2l2" href="Note/due.md"><rect id="ob2b2b2b2" width="10" height="10"/></a></g>`,
      ),
      {},
    );
    openAt("ol2l2l2l2");
    inTree("ArrowDown");
    inTree("ArrowRight");
    expect(activeKey()).toBe("ol1l1l1l1");
    expect(keys()).toEqual(["l1", "ol2l2l2l2", "ol1l1l1l1", "oa1a1a1a1"]);
    inTree("ArrowUp");
    expect(activeKey()).toBe("ol2l2l2l2");
    inTree("ArrowDown", { altKey: true });
    expect(parentOf("ol2l2l2l2")).toBe("l1");
    expect(order()).toEqual(["l1", "ol2l2l2l2", "ob2b2b2b2", "ol1l1l1l1", "oa1a1a1a1"]);
  });

  it("le righe hanno la miniatura di ciò che disegnano, e la rifanno quando cambia", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // Le miniature si disegnano finché il fotogramma ha tempo, e le altre al
    // fotogramma dopo: su una macchina carica ne servono più d'uno.
    const frame = (): void => {
      for (let round = 0; round < 50 && frames.length > 0; round++) for (const callback of frames.splice(0)) callback(0);
    };
    mount(STACKED);
    openAt("oc3c3c3c3");
    frame();
    const thumb = (id: string): Element | null => host.querySelector(`.draw-object[data-key="${id}"] .draw-object-thumb > svg`);
    // Un oggetto inquadrato su di sé, un livello sulla pagina.
    const viewBox = (id: string): number[] => thumb(id)!.getAttribute("viewBox")!.split(" ").map(Number);
    viewBox("oc3c3c3c3").forEach((value, at) => expect(value).toBeCloseTo([68.8, 8.8, 22.4, 22.4][at]!, 9));
    viewBox("l1").forEach((value, at) => expect(value).toBeCloseTo([-6, -6, 112, 112][at]!, 9));
    expect(thumb("oc3c3c3c3")!.querySelector("rect")!.getAttribute("fill")).toBe("#0072b2");
    expect(thumb("og1g1g1g1")!.querySelectorAll("rect")).toHaveLength(1);
    const before = thumb("og1g1g1g1");
    inTree("ArrowDown");
    inTree("ArrowRight");
    inTree("ArrowUp");
    inTree("ArrowDown", { altKey: true });
    frame();
    expect(thumb("og1g1g1g1")).not.toBe(before);
    expect(thumb("og1g1g1g1")!.querySelectorAll("rect")).toHaveLength(2);
    expect(host.querySelector(".draw-object-thumb > svg [data-scene-id]")).toBeNull();
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("una miniatura porta le risorse che la riga usa, e si rifà quando una di loro cambia", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const frame = (): void => {
      for (let round = 0; round < 50 && frames.length > 0; round++) for (const callback of frames.splice(0)) callback(0);
    };
    const source = doc(
      '<defs id="fub-defs"><linearGradient id="r1a1a1a1a" x2="1"><stop offset="0" stop-color="#0072b2"/></linearGradient>'
        + '<filter id="r2b2b2b2b"><feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="#000000"/></filter></defs>'
        + `${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="url(#r1a1a1a1a) #0072b2"/>`
        + '<rect id="oc3c3c3c3" x="70" y="10" width="20" height="20" fill="#000000"/></g>',
    );
    mount(source);
    openAt("oa1a1a1a1");
    frame();
    const thumb = (id: string): Element | null => host.querySelector(`.draw-object[data-key="${id}"] .draw-object-thumb > svg`);
    const shown = thumb("oa1a1a1a1")!;
    // Solo la sfumatura che usa, sotto un id della miniatura.
    const gradient = shown.querySelector("defs > linearGradient")!;
    expect(gradient.id).toMatch(/^fubthumb\d+-r1a1a1a1a$/);
    expect(shown.querySelectorAll("defs > *")).toHaveLength(1);
    expect(shown.querySelector("rect")!.getAttribute("fill")).toBe(`url(#${gradient.id}) #0072b2`);
    expect(thumb("oc3c3c3c3")!.querySelector("defs")).toBeNull();
    // Le risorse non sono righe dell'albero.
    expect(keys()).toEqual(["l1", "oc3c3c3c3", "oa1a1a1a1"]);
    editor.setEngine(SceneEngine.open(source.replace('stop-color="#0072b2"', 'stop-color="#d55e00"')));
    frame();
    expect(thumb("oa1a1a1a1")).not.toBe(shown);
    expect(thumb("oa1a1a1a1")!.querySelector("stop")!.getAttribute("stop-color")).toBe("#d55e00");
  });

  it("nel Semplice l'albero non sposta e non ha miniature", () => {
    mount(STACKED, { workspace: "simple" });
    openAt("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(editor.engine.text).toBe(STACKED);
    expect(activeKey()).toBe("og1g1g1g1");
    expect([...host.querySelectorAll<HTMLElement>(".draw-object-thumb")].every((holder) => holder.hidden)).toBe(true);
  });
});

describe("la selezione avanzata, nel Completo", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  const D = "od4d4d4d4";
  const E = "oe5e5e5e5";
  const G = "og1g1g1g1";
  const H = "oh2h2h2h2";
  /// Due rettangoli blu in alto; sotto, un gruppo con un rettangolo arancione
  /// e un gruppo di due neri. I riempimenti si toccano, e la camera resta
  /// l'identità.
  const SET = doc(
    `<title>Prova</title>${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/>` +
      `<rect id="${B}" x="50" y="10" width="20" height="20" fill="#0072b2"/>` +
      `<g id="${G}"><rect id="${C}" x="10" y="60" width="20" height="20" fill="#d55e00"/>` +
      `<g id="${H}"><rect id="${D}" x="50" y="60" width="20" height="20" fill="#000000"/>` +
      `<rect id="${E}" x="90" y="60" width="20" height="20" fill="#000000"/></g></g></g>`,
  );

  const selectionButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    // Le voci, fuori dalla riga degli appunti.
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(.menu-quick)')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
  const rightClick = (x: number, y: number): MouseEvent => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    surface().dispatchEvent(event);
    return event;
  };
  const isolation = (): HTMLElement => host.querySelector<HTMLElement>(".draw-isolation")!;
  const crumbs = (): string[] => [...isolation().querySelectorAll(".draw-isolation-crumb")].map((crumb) => crumb.textContent ?? "");
  const painted = (id: string): SVGElement => host.querySelector<SVGElement>(`[data-scene-id="${id}"]`)!;
  /// Un tocco, lontano nel tempo dal precedente: non fa un doppio tocco.
  const tap = (x: number, y: number, init: Init = {}): void => {
    clock += 1000;
    drag([[x, y]], init);
  };
  const doubleTap = (x: number, y: number): void => {
    clock += 1000;
    drag([[x, y]]);
    drag([[x, y]]);
  };

  afterEach(() => {
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("nel Semplice non c'è: niente Lazo, niente menu, e i tasti restano a chi li aveva", () => {
    mount(SET, { workspace: "simple" });
    editor.setTool("select");
    expect(key("q").defaultPrevented).toBe(false);
    expect(editor.tool).toBe("select");
    expect(selectionButton().hidden).toBe(true);
    editor.select([A]);
    expect(key("L", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    editor.select([G]);
    expect(key("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
    doubleTap(20, 70);
    expect(isolation().hidden).toBe(true);
    tap(20, 70, { ctrlKey: true });
    expect(editor.selection).toEqual([G]);
    expect(rightClick(20, 70).defaultPrevented).toBe(false);
    expect(editor.engine.text).toBe(SET);
  });

  it("con Ctrl o ⌘ un clic sceglie l'oggetto dentro il gruppo, Maiusc lo aggiunge, e lo si sposta da solo", () => {
    mount(SET);
    editor.setTool("select");
    tap(20, 70);
    expect(editor.selection).toEqual([G]);
    tap(20, 70, { ctrlKey: true });
    expect(editor.selection).toEqual([C]);
    tap(60, 70, { ctrlKey: true, shiftKey: true });
    expect(editor.selection).toEqual([C, D]);
    tap(150, 150);
    tap(20, 70, { ctrlKey: true });
    expect(editor.selection).toEqual([C]);
    clock += 1000;
    drag([[20, 70], [30, 70], [40, 70]]);
    expect(editor.engine.text).toContain(`<rect id="${C}" x="10" y="60" width="20" height="20" fill="#d55e00" transform="matrix(1 0 0 1 20 0)"/>`);
    expect(editor.engine.text).toContain(`<g id="${G}">`);
    expect(editor.selection).toEqual([C]);
    // Maiusc su un oggetto scelto dentro il gruppo lo toglie.
    tap(40, 70, { shiftKey: true });
    expect(editor.selection).toEqual([]);
  });

  it("due tocchi su un gruppo lo isolano: il resto si attenua e non si sceglie, la barra dice dove si è, Esc esce; il file non cambia", () => {
    mount(SET);
    editor.setTool("select");
    expect(isolation().hidden).toBe(true);
    doubleTap(20, 70);
    expect(editor.selection).toEqual([C]);
    expect(spoken()).toBe("Gruppo isolato: Gruppo, 2 oggetti. Si sceglie solo qui dentro; Esc esce. Rettangolo, Vermiglio, 1 di 2.");
    expect(isolation().hidden).toBe(false);
    expect(isolation().getAttribute("aria-label")).toBe("Gruppo isolato");
    expect(crumbs()).toEqual(["Livello «Livello 1»", "Gruppo, 2 oggetti"]);
    expect(painted(A).style.opacity).toBe("0.4");
    expect(painted(C).style.opacity).toBe("");
    expect(painted(D).style.opacity).toBe("");
    // Fuori dal gruppo non si sceglie niente; Ctrl+A sceglie ciò che c'è dentro.
    tap(20, 20);
    expect(editor.selection).toEqual([]);
    key("a", { ctrlKey: true });
    expect(editor.selection).toEqual([C, H]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    key("Escape");
    expect(editor.selection).toEqual([G]);
    expect(spoken()).toBe("Fuori dal gruppo: si sceglie in tutto il disegno.");
    expect(isolation().hidden).toBe(true);
    expect(painted(A).style.opacity).toBe("");
    key("Escape");
    expect(editor.selection).toEqual([]);
    // Due tocchi sul vuoto escono anche loro.
    doubleTap(20, 70);
    expect(isolation().hidden).toBe(false);
    doubleTap(150, 150);
    expect(isolation().hidden).toBe(true);
    expect(changes).toEqual([]);
    expect(editor.engine.text).toBe(SET);
  });

  it("Ctrl+Invio isola il gruppo scelto; dentro, un gruppo si isola ancora, e la barra riporta a ogni gruppo del percorso", () => {
    mount(SET);
    editor.setTool("select");
    editor.select([A]);
    key("Enter", { ctrlKey: true });
    expect(spoken()).toBe("Scegli un gruppo solo, un collegamento o un’istanza di un simbolo, per isolarlo.");
    expect(isolation().hidden).toBe(true);
    editor.select([G]);
    key("Enter", { ctrlKey: true });
    expect(editor.selection).toEqual([C]);
    editor.select([H]);
    key("Enter", { ctrlKey: true });
    expect(editor.selection).toEqual([D]);
    expect(crumbs()).toEqual(["Livello «Livello 1»", "Gruppo, 2 oggetti", "Gruppo, 2 oggetti"]);
    expect(isolation().querySelector('[aria-current="location"]')!.textContent).toBe(crumbs()[2]);
    expect(painted(C).style.opacity).toBe("0.4");
    isolation().querySelector<HTMLButtonElement>('button.draw-isolation-crumb[data-depth="1"]')!.click();
    expect(editor.selection).toEqual([H]);
    expect(document.activeElement).toBe(surface());
    expect(crumbs()).toHaveLength(2);
    // Esc in un gruppo dentro un altro torna a quello di fuori.
    editor.select([H]);
    key("Enter", { ctrlKey: true });
    key("Escape");
    expect(editor.selection).toEqual([H]);
    expect(crumbs()).toHaveLength(2);
    isolation().querySelector<HTMLButtonElement>("button.draw-isolation-crumb")!.click();
    expect(isolation().hidden).toBe(true);
    expect(editor.selection).toEqual([G]);
    // Il pulsante della barra esce di un gruppo.
    key("Enter", { ctrlKey: true });
    isolation().querySelector<HTMLButtonElement>('button[aria-label="Esci dal gruppo"]')!.click();
    expect(isolation().hidden).toBe(true);
    expect(editor.selection).toEqual([G]);
  });

  it("con un gruppo isolato ciò che si disegna entra nel gruppo, in cima, e il gruppo resta isolato", () => {
    mount(SET);
    editor.select([G]);
    key("Enter", { ctrlKey: true });
    editor.setTool("rect");
    drag([[120, 100], [140, 120]]);
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${E}"[^>]*/>\\s*</g>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>\\s*</g>`));
    expect(isolation().hidden).toBe(false);
    editor.undo();
    expect(editor.engine.text).toBe(SET);
  });

  it("Ctrl+Maiusc+L blocca e Ctrl+Maiusc+H nasconde gli oggetti scelti, in un passo; «Sblocca tutto» e «Mostra tutto» li riportano", () => {
    mount(SET);
    editor.setTool("select");
    editor.select([A]);
    key("L", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toContain(`<rect id="${A}" fub:locked="true" x="10" y="10" width="20" height="20" fill="#0072b2"/>`);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto bloccato: non si sceglie finché non lo sblocchi.");
    tap(20, 20);
    expect(editor.selection).toEqual([]);
    editor.select([B, G]);
    key("H", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("2 oggetti nascosti: non si vedono finché non li mostri.");
    expect(editor.engine.text).toContain(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="#0072b2" display="none"/>`);
    expect(editor.engine.text).toContain(`<g id="${G}" display="none">`);
    editor.undo();
    expect(spoken()).toBe("Annullato: Oggetti nascosti.");
    editor.redo();
    selectionButton().click();
    item("Sblocca tutto").click();
    expect(spoken()).toBe("1 oggetto sbloccato.");
    expect(editor.selection).toEqual([A]);
    selectionButton().click();
    item("Mostra tutto").click();
    expect(spoken()).toBe("2 oggetti di nuovo visibili.");
    expect(editor.selection).toEqual([B, G]);
    expect(editor.engine.text).toBe(SET);
    selectionButton().click();
    expect(item("Sblocca tutto").getAttribute("aria-disabled")).toBe("true");
    expect(item("Sblocca tutto").querySelector(".menu-description")!.textContent).toBe("Non c’è niente da sbloccare.");
    expect(item("Mostra tutto").querySelector(".menu-description")!.textContent).toBe("Non c’è niente di nascosto.");
  });

  it("il menu sceglie i simili, a ogni profondità, e il resto; le voci che adesso non servono dicono perché", () => {
    mount(SET);
    editor.setTool("select");
    selectionButton().click();
    expect(menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled")])).toEqual([
      ["Taglia", "true"],
      ["Copia", "true"],
      ["Incolla", null],
      ["Incolla nello stesso punto", null],
      ["Copia lo stile", "true"],
      ["Incolla lo stile", "true"],
      ["Seleziona tutto", null],
      ["Inverti la selezione", null],
      ["Stesso riempimento", "true"],
      ["Stesso colore del contorno", "true"],
      ["Stesso spessore del contorno", "true"],
      ["Stesso tipo di oggetto", "true"],
      ["Stesso strumento", "true"],
      ["Stesso livello", "true"],
      ["Rinomina", "true"],
      ["Blocca", "true"],
      ["Nascondi", "true"],
      ["Sblocca tutto", "true"],
      ["Mostra tutto", "true"],
      ["Isola il gruppo", "true"],
    ]);
    expect(item("Stesso riempimento").querySelector(".menu-description")!.textContent).toBe("Scegli prima degli oggetti.");
    expect(item("Rinomina").querySelector(".menu-description")!.textContent).toBe("Scegli un oggetto solo per cambiargli il nome.");
    item("Seleziona tutto").click();
    expect(editor.selection).toEqual([A, B, G]);
    editor.select([A]);
    selectionButton().click();
    item("Stesso riempimento").click();
    expect(editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("2 oggetti scelti.");
    selectionButton().click();
    item("Inverti la selezione").click();
    expect(editor.selection).toEqual([G]);
    // Dentro un gruppo, il resto è anche ciò che sta fuori dal gruppo.
    tap(60, 70, { ctrlKey: true });
    expect(editor.selection).toEqual([D]);
    selectionButton().click();
    item("Inverti la selezione").click();
    expect(editor.selection).toEqual([A, B, C, E]);
    tap(150, 150);
    tap(60, 70, { ctrlKey: true });
    selectionButton().click();
    item("Stesso riempimento").click();
    expect(editor.selection).toEqual([D, E]);
    editor.select([A]);
    selectionButton().click();
    item("Stesso tipo di oggetto").click();
    expect(editor.selection).toEqual([A, B, C, D, E]);
    selectionButton().click();
    expect(item("Stesso strumento").getAttribute("aria-disabled")).toBe("true");
    expect(item("Stesso strumento").querySelector(".menu-description")!.textContent).toBe(
      "Vale per i tratti a mano libera: la stessa penna, o lo stesso evidenziatore, con la stessa punta.",
    );
    expect(changes).toEqual([]);
  });

  it("il tasto destro su un oggetto lo sceglie e apre il menu della selezione; Maiusc+F10 lo apre dalla tastiera", () => {
    mount(SET);
    editor.setTool("select");
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(editor.selection).toEqual([B]);
    expect(document.querySelector(".context-menu")!.getAttribute("aria-labelledby")).toBe(selectionButton().id);
    closeContextMenu();
    // Su un oggetto già scelto la selezione resta com'è.
    editor.select([A, B]);
    rightClick(60, 20);
    expect(editor.selection).toEqual([A, B]);
    closeContextMenu();
    // Con la penna il tasto destro apre lo stesso menu, sulla selezione che
    // c'è, e in fondo il menu radiale.
    editor.setTool("pen");
    editor.select([A]);
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(document.querySelector(".draw-radial")).toBeNull();
    expect(menu().map(labelOf)).toContain("Menu radiale");
    expect(editor.selection).toEqual([A]);
    closeContextMenu();
    editor.setTool("select");
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(menu().map(labelOf)).toContain("Isola il gruppo");
    // L'evento che il tasto manda dietro non apre un secondo menu; il tasto
    // destro dopo sì.
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(document.querySelectorAll(".context-menu")).toHaveLength(1);
    closeContextMenu();
    expect(key("ContextMenu").defaultPrevented).toBe(true);
    closeContextMenu();
  });

  it("il tasto destro sul foglio vuoto dà le sole voci che fanno qualcosa, e il piede invita a scrivere", () => {
    mount(SET);
    editor.setTool("select");
    expect(rightClick(150, 150).defaultPrevented).toBe(true);
    expect(editor.selection).toEqual([]);
    expect(document.querySelector("#context-menu .menu-clipboard")).toBeNull();
    expect(menu().map(labelOf)).toEqual(["Incolla", "Incolla nello stesso punto", "Seleziona tutto", "Mostra tutto il disegno", "Menu radiale"]);
    expect(menu().every((entry) => entry.getAttribute("aria-disabled") === null)).toBe(true);
    expect(document.querySelector("#context-menu .menu-foot")!.textContent).toContain("Scrivi per cercare");
    item("Seleziona tutto").click();
    expect(editor.selection).toEqual([A, B, G]);
    // Il resto si trova scrivendo.
    editor.select([]);
    rightClick(150, 150);
    for (const letter of "inverti") key(letter, {}, document.activeElement as HTMLElement);
    expect(menu().map(labelOf)).toEqual(["Inverti la selezione"]);
    closeContextMenu();
    // A chi legge soltanto non resta che vedere il disegno.
    editor.setReadOnly(true);
    rightClick(150, 150);
    expect(menu().map(labelOf)).toEqual(["Seleziona tutto", "Mostra tutto il disegno"]);
    closeContextMenu();
  });

  it("con una selezione il tasto destro dà gli appunti in cima e le sue voci, sempre sotto nove", () => {
    mount(SET);
    editor.setTool("select");
    rightClick(60, 20);
    expect(editor.selection).toEqual([B]);
    const row = document.querySelector<HTMLElement>("#context-menu .menu-clipboard")!;
    expect([...row.querySelectorAll("[role=menuitem]")].map((b) => b.textContent)).toEqual(["Taglia", "Copia", "Incolla"]);
    const labels = menu().map(labelOf);
    expect(labels).toEqual(["Copia lo stile", "Incolla lo stile", "Seleziona simili", "Blocca", "Nascondi", "Isola il gruppo", "Menu radiale"]);
    expect(labels.length).toBeLessThan(9);
    closeContextMenu();
    // Dentro un gruppo, con l'uscita.
    doubleTap(20, 70);
    rightClick(20, 70);
    expect(menu().map(labelOf)).toContain("Esci dal gruppo");
    expect(menu().length).toBeLessThan(9);
    closeContextMenu();
  });

  it("l'albero mostra il blocco e la visibilità con un segno e a parole, e li cambia dal segno o coi tasti", () => {
    const flagged = SET.replace(`fill="#0072b2"/>`, `fill="#0072b2" fub:locked="true"/>`).replace(`<g id="${H}">`, `<g id="${H}" display="none">`);
    mount(flagged);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    const row = (key: string): HTMLElement => host.querySelector<HTMLElement>(`.draw-object[data-key="${key}"]`)!;
    const sign = (key: string, what: "lock" | "hide"): HTMLElement => row(key).querySelector<HTMLElement>(`.draw-object-sign[data-sign="${what}"]`)!;
    expect([...host.querySelectorAll(".draw-object-label")].map((label) => label.textContent)).toEqual([
      "Livello «Livello 1», corrente",
      "Gruppo, 2 oggetti",
      "Rettangolo, Blu",
      "Rettangolo, bloccato, Blu",
    ]);
    expect(sign(A, "lock").hasAttribute("data-on")).toBe(true);
    expect(sign(A, "lock").title).toBe("Sblocca");
    expect(sign(B, "lock").hasAttribute("data-on")).toBe(false);
    expect(row(A).hasAttribute("data-toggles")).toBe(true);
    sign(A, "lock").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/>`);
    expect(spoken()).toBe("Rettangolo, Blu: sbloccato.");
    // Ctrl+Maiusc+H sulla riga attiva la nasconde, e lo stesso tasto la mostra.
    const tree = host.querySelector<HTMLElement>('[role="tree"]')!;
    tree.focus();
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "H", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(editor.engine.text).toContain(`<g id="${G}" display="none">`);
    expect(spoken()).toBe("Gruppo, 2 oggetti: nascosto.");
    tree.dispatchEvent(new KeyboardEvent("keydown", { key: "H", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(editor.engine.text).toContain(`<g id="${G}">`);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("«?» elenca i tasti della selezione avanzata", () => {
    mount(SET);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toContain("Selezione avanzata");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("le immagini incollate", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const MIB = 1024 * 1024;

  /// Un codec finto: ogni immagine misura `width` × `height` pixel, e la sua
  /// ricodifica pesa quanto dice `full` per il tipo, meno se rimpicciolita.
  function codec(width: number, height: number, full: Partial<Record<EncodeType, number>> = {}, readable = true): ImageCodec & { calls: string[]; closed: number } {
    const fake = {
      calls: [] as string[],
      closed: 0,
      async decode(): Promise<Decoded | null> {
        if (!readable) return null;
        return {
          width,
          height,
          opaque: () => true,
          async encode(type: EncodeType, scale: number) {
            fake.calls.push(`${type} ${scale}`);
            const size = full[type];
            return size === undefined ? null : new Uint8Array(Math.round(size * scale * scale)).fill(7);
          },
          close() {
            fake.closed++;
          },
        };
      },
    };
    return fake;
  }

  const file = (bytes: Uint8Array<ArrayBuffer>, name = "shot.png", type = "image/png"): File => new File([bytes], name, { type });

  function paste(files: readonly File[], target: HTMLElement = surface()): ClipboardEvent {
    const data = new DataTransfer();
    for (const one of files) data.items.add(one);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    target.dispatchEvent(event);
    return event;
  }

  /// Un rilascio sul foglio: happy-dom non ha `DragEvent`.
  function drop(files: readonly File[], x: number, y: number): MouseEvent {
    const data = new DataTransfer();
    for (const one of files) data.items.add(one);
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, "dataTransfer", { value: data });
    surface().dispatchEvent(event);
    return event;
  }

  /// Aspetta che l'immagine finisca di entrare.
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const images = (): string[] => editor.engine.text.match(/<image [^>]*\/>/g) ?? [];
  const imageLine = (): string => images()[0] ?? "";
  const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

  it("uno screenshot incollato entra nel file com'è, scelto, con la selezione come strumento", async () => {
    mount(SOURCE, { imageCodec: codec(200, 100) });
    size(1000, 500);
    editor.setTool("pen");
    expect(paste([file(PNG)]).defaultPrevented).toBe(true);
    await settle();
    const [id] = editor.selection;
    expect(imageLine()).toBe(`<image id="${id}" x="400" y="200" width="200" height="100" href="data:image/png;base64,${base64(PNG)}"/>`);
    expect(editor.tool).toBe("select");
    expect(spoken()).toBe("Immagine aggiunta. Strumento: Selezione. Il disegno ha 2 oggetti.");
    // Un gesto solo, che annulla toglie intero.
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(imageLine()).toBe("");
  });

  it("va dove è il cursore, e due immagini insieme sono un gesto, una sopra l'altra", async () => {
    mount(SOURCE, { workspace: "simple", imageCodec: codec(100, 50) });
    size(1000, 500);
    // Con la selezione già in mano, lo strumento non cambia e non si dice.
    editor.setTool("select");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    paste([file(PNG), file(PNG, "due.png")]);
    await settle();
    expect(images().map((line) => line.match(/ x="[^"]*" y="[^"]*"/)![0])).toEqual([' x="250" y="275"', ' x="274" y="299"']);
    expect(editor.selection).toHaveLength(2);
    expect(changes).toHaveLength(1);
    expect(spoken()).toBe("2 immagini aggiunte. Il disegno ha 3 oggetti.");
  });

  it("con l'aggancio, l'angolo in alto a sinistra va sull'incrocio più vicino, e le immagini si scostano di passi interi", async () => {
    mount(SOURCE, { imageCodec: codec(100, 50), grid: { shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    size(1000, 500);
    editor.setTool("select");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    paste([file(PNG), file(PNG, "due.png")]);
    await settle();
    // Da (250, 275) a (260, 280); la seconda parte 40 più in là, non 24.
    expect(images().map((line) => line.match(/ x="[^"]*" y="[^"]*"/)![0])).toEqual([' x="260" y="280"', ' x="300" y="320"']);
  });

  it("oltre i 5 MiB propone di ridurla: una foto diventa JPEG, con la stessa misura sul foglio", async () => {
    const fake = codec(4000, 3000, { "image/jpeg": 3 * MIB });
    mount(SOURCE, { imageCodec: fake });
    size(1000, 500);
    const big = new Uint8Array(6 * MIB);
    big.set(PNG);
    paste([file(big)]);
    await settle();
    expect(dialog().querySelector("h2")!.textContent).toBe("Immagine troppo pesante");
    expect(dialog().querySelector("p")!.textContent).toBe(
      "L’immagine pesa 6 MiB, e in un disegno un’immagine può pesare al più 5 MiB. Ridurla? Avrà meno pixel, ma la stessa misura sul foglio.",
    );
    expect(dialog().getAttribute("aria-describedby")).toBe(dialog().querySelector("p")!.id);
    expect(document.activeElement?.textContent).toBe("Riduci");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    await submit();
    await settle();
    expect(fake.calls).toEqual(["image/jpeg 1"]);
    expect(imageLine()).toMatch(/^<image id="[^"]+" x="233.33" y="50" width="533.33" height="400" href="data:image\/jpeg;base64,BwcH/);
    expect(changes).toHaveLength(1);
    expect(fake.closed).toBe(1);
  });

  it("annullare la riduzione non aggiunge niente", async () => {
    mount(SOURCE, { imageCodec: codec(4000, 3000, { "image/jpeg": 3 * MIB }) });
    const big = new Uint8Array(6 * MIB);
    big.set(PNG);
    paste([file(big)]);
    await settle();
    [...dialog().querySelectorAll("button")].find((button) => button.textContent === "Annulla")!.click();
    await settle();
    expect(changes).toEqual([]);
    expect(imageLine()).toBe("");
  });

  it("un JPEG girato dall'EXIF si ricodifica diritto, e un BMP diventa PNG", async () => {
    const exif = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0,
      1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xda, 0, 2,
    ]);
    const fake = codec(30, 40, { "image/jpeg": 500, "image/png": 900 });
    mount(SOURCE, { workspace: "simple", imageCodec: fake });
    paste([file(exif, "foto.jpg", "image/jpeg")]);
    await settle();
    expect(fake.calls).toEqual(["image/jpeg 1"]);
    expect(imageLine()).toContain('width="30" height="40" href="data:image/jpeg;base64,');
    paste([file(Uint8Array.from([0x42, 0x4d, 0, 0]), "vecchia.bmp", "image/bmp")]);
    await settle();
    expect(fake.calls).toEqual(["image/jpeg 1", "image/png 1"]);
    expect(editor.engine.text).toContain('href="data:image/png;base64,');
  });

  it("un file lasciato sul foglio va dove cade; uno che non è un'immagine lo si dice", async () => {
    mount(SOURCE, { imageCodec: codec(200, 100) });
    size(1000, 500);
    expect(drop([file(PNG)], 150, 120).defaultPrevented).toBe(true);
    await settle();
    expect(imageLine()).toMatch(/ x="50" y="70" width="200" height="100" /);
    const note = drop([file(Uint8Array.from([65]), "nota.txt", "text/plain")], 10, 10);
    expect(note.defaultPrevented).toBe(true);
    expect(spoken()).toBe("Non è un’immagine o un SVG che il disegno sa leggere.");
  });

  it("un'immagine che non si legge, un documento in sola lettura e il titolo non scrivono", async () => {
    mount(SOURCE, { imageCodec: codec(10, 10, {}, false) });
    paste([file(PNG)]);
    await settle();
    expect(spoken()).toBe("Non è un’immagine che il disegno sa leggere.");
    editor.setReadOnly(true);
    paste([file(PNG)]);
    await settle();
    editor.setReadOnly(false);
    // Nel campo del titolo un incolla resta del campo.
    const title = host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(paste([file(PNG)], title).defaultPrevented).toBe(false);
    // Un incolla di solo testo non è un'immagine.
    const words = new DataTransfer();
    words.setData("text/plain", "ciao");
    const plain = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: words });
    surface().dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    await settle();
    expect(changes).toEqual([]);
  });

  it("un disegno al limite non riceve un'altra immagine", async () => {
    const full = doc(`<desc>${"a".repeat(20 * MIB - 1000)}</desc>${LAYER}</g>`);
    mount(full, { imageCodec: codec(10, 10) });
    paste([file(PNG)]);
    await settle();
    expect(spoken()).toBe("Il disegno è vicino al limite di 20 MiB: un’altra immagine non ci sta.");
    expect(changes).toEqual([]);
  });

  describe("la descrizione, nel Completo", () => {
    const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-describe")!;
    const input = (): HTMLInputElement => bar().querySelector<HTMLInputElement>(".draw-describe-input")!;
    const label = (): string => bar().querySelector("label")!.textContent!;
    const act = (action: string): HTMLButtonElement => bar().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    const ids = (): string[] => [...editor.engine.text.matchAll(/<image id="([^"]+)"/g)].map((found) => found[1]!);

    it("entrata un'immagine, la barra la chiede col fuoco nel campo; Invio la scrive in un passo suo", async () => {
      mount(SOURCE, { imageCodec: codec(200, 100) });
      size(1000, 500);
      expect(bar().hidden).toBe(true);
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(false);
      expect(label()).toBe("Descrivi l’immagine appena aggiunta");
      expect(document.activeElement).toBe(input());
      expect(input().placeholder).toBe("Che cosa mostra l’immagine?");
      expect(formatIssues(checkAccessibility(host))).toBe("");
      // Nel campo le lettere si scrivono: non cambiano lo strumento.
      const tool = editor.tool;
      expect(key("p", {}, input()).defaultPrevented).toBe(false);
      expect(editor.tool).toBe(tool);
      const [id] = editor.selection;
      input().value = "  Il molo   al tramonto ";
      key("Enter", {}, input());
      expect(changes).toHaveLength(2);
      expect(editor.engine.text).toContain("<title>Il molo al tramonto</title>");
      expect(spoken()).toBe("Descrizione scritta: «Il molo al tramonto».");
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
      expect(editor.selection).toEqual([id]);
      // Due passi: l'annulla toglie prima la descrizione, poi l'immagine.
      editor.undo();
      expect(editor.engine.text).not.toContain("<title>Il molo");
      expect(images()).toHaveLength(1);
      editor.undo();
      expect(images()).toEqual([]);
    });

    it("più immagini, una alla volta e scelta; «Decorativa» e «Salta» passano alla prossima, e alla fine tornano scelte tutte", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      paste([file(PNG), file(PNG, "due.png"), file(PNG, "tre.png")]);
      await settle();
      const [first, second, third] = ids();
      expect(label()).toBe("Descrivi l’immagine 1 delle 3 appena aggiunte");
      expect(editor.selection).toEqual([first]);
      act("decorative").click();
      expect(editor.engine.text).toMatch(new RegExp(`<image id="${first}"[^>]* aria-hidden="true"/>`));
      expect(label()).toBe("Descrivi l’immagine 2 delle 3 appena aggiunte");
      expect(editor.selection).toEqual([second]);
      expect(document.activeElement).toBe(input());
      act("skip").click();
      expect(label()).toBe("Descrivi l’immagine 3 delle 3 appena aggiunte");
      expect(editor.selection).toEqual([third]);
      input().value = "Barche";
      act("write").click();
      expect(bar().hidden).toBe(true);
      expect(editor.selection).toEqual([first, second, third]);
      expect(document.activeElement).toBe(surface());
      // L'immagine, la decorativa e la descrizione: tre passi.
      expect(changes).toHaveLength(3);
    });

    it("un campo vuoto non scrive niente e lo dice; Esc chiude, e la verifica elenca l'immagine", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      paste([file(PNG)]);
      await settle();
      key("Enter", {}, input());
      expect(spoken()).toBe("Scrivi prima che cosa mostra l’immagine, oppure scegli «Decorativa» o «Salta».");
      expect(bar().hidden).toBe(false);
      expect(document.activeElement).toBe(input());
      key("Escape", {}, input());
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
      expect(changes).toHaveLength(1);
      host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Accessibilità"]')!.click();
      expect([...host.querySelectorAll(".draw-access-what")].map((what) => what.textContent)).toContain("Avviso: Un’immagine non ha una descrizione");
    });

    it("si chiude quando l'immagine se ne va, quando il disegno non si scrive più, e con un altro disegno", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      paste([file(PNG)]);
      await settle();
      editor.undo();
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
      paste([file(PNG)]);
      await settle();
      editor.setReadOnly(true);
      expect(bar().hidden).toBe(true);
      editor.setReadOnly(false);
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(false);
      editor.load(SceneEngine.open(SOURCE));
      expect(bar().hidden).toBe(true);
    });

    it("nel Semplice non c'è: l'immagine entra e il fuoco resta sul foglio", async () => {
      mount(SOURCE, { workspace: "simple", imageCodec: codec(100, 50) });
      size(1000, 500);
      surface().focus();
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
    });
  });
});

describe("le immagini del vault", () => {
  const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  const HREF = "immagini/foto.png";

  /// Un codec che misura ogni immagine `width` × `height` pixel, o nessuna.
  function codec(width: number, height: number, readable = true): ImageCodec & { closed: number } {
    const fake = {
      closed: 0,
      async decode(): Promise<Decoded | null> {
        if (!readable) return null;
        return {
          width,
          height,
          opaque: () => true,
          encode: async () => null,
          close() {
            fake.closed++;
          },
        };
      },
    };
    return fake;
  }

  /// Chi monta l'editor: sceglie `choice`, e del vault legge `blob`.
  function vault(choice: string | null | Error, blob: Blob | null = PNG): DrawImages & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async url(href) {
        calls.push(`url ${href}`);
        return `blob:vault/${href}`;
      },
      async read(href) {
        calls.push(`read ${href}`);
        return blob;
      },
      async choose() {
        calls.push("choose");
        if (choice instanceof Error) throw choice;
        return choice;
      },
    };
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const imageLine = (): string => editor.engine.text.match(/<image [^>]*\/>/)?.[0] ?? "";
  const imageButton = (): HTMLButtonElement =>
    [...host.querySelectorAll<HTMLButtonElement>(".draw-rail button")].find((control) => control.getAttribute("aria-label") === "Immagine dal vault…")!;
  const insertShown = (): boolean => imageButton().closest("[hidden]") === null;

  it("Ctrl+I mette l'immagine scelta per riferimento, dove è il cursore e con la sua misura, e il foglio la mostra", async () => {
    const images = vault(HREF);
    const fake = codec(200, 100);
    mount(SOURCE, { imageCodec: fake, images });
    size(1000, 500);
    editor.setTool("pen");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 300, clientY: 300 }));
    expect(key("i", { ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    const [id] = editor.selection;
    expect(imageLine()).toBe(`<image id="${id}" x="200" y="250" width="200" height="100" href="${HREF}"/>`);
    expect(images.calls.slice(0, 2)).toEqual(["choose", `read ${HREF}`]);
    // I byte servono solo a misurarla: il decodificato si chiude.
    expect(fake.closed).toBe(1);
    expect(editor.tool).toBe("select");
    expect(spoken()).toBe("Immagine aggiunta. Strumento: Selezione. Il disegno ha 2 oggetti.");
    // Il foglio chiede l'URL a chi monta l'editor.
    expect(images.calls).toContain(`url ${HREF}`);
    expect(surface().querySelector(`image[data-scene-id="${id}"]`)!.getAttribute("href")).toBe(`blob:vault/${HREF}`);
    // Un gesto solo, che annulla toglie intero.
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(imageLine()).toBe("");
  });

  it("il pulsante «Immagine dal vault…» c'è nei due spazi, se chi monta l'editor sa scegliere", async () => {
    const images = vault(HREF);
    mount(SOURCE, { workspace: "simple", imageCodec: codec(20, 10), images });
    expect(insertShown()).toBe(true);
    editor.setWorkspace("full");
    expect(insertShown()).toBe(true);
    const control = imageButton();
    expect(control.closest('[role="group"]')!.getAttribute("aria-label")).toBe("Inserisci");
    expect(control.title).toBe("Immagine dal vault… (Ctrl+I)");
    expect(control.getAttribute("aria-keyshortcuts")).toBe("Control+I");
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    control.click();
    await settle();
    expect(imageLine()).toContain(`href="${HREF}"`);
    expect(changes).toHaveLength(1);
    // Come ogni immagine che entra, chiede la sua descrizione.
    expect(host.querySelector<HTMLElement>(".draw-describe")!.hidden).toBe(false);
    expect(document.activeElement).toBe(host.querySelector(".draw-describe-input"));
    // In sola lettura il pulsante si spegne, e Ctrl+I non chiede niente.
    editor.setReadOnly(true);
    expect(imageButton().disabled).toBe(true);
    key("i", { ctrlKey: true });
    await settle();
    expect(images.calls.filter((call) => call === "choose")).toHaveLength(1);
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    // Chi non sa scegliere non ha il pulsante, né il tasto.
    mount(SOURCE, { imageCodec: codec(20, 10), images: { url: images.url, read: images.read } });
    expect(insertShown()).toBe(false);
    expect(key("i", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("«?» elenca Ctrl+I tra i tasti della modifica", () => {
    mount(SOURCE, { images: vault(HREF) });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+I", "Immagine dal vault…"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("una scelta annullata o fallita non aggiunge niente; un'immagine sparita o illeggibile lo si dice", async () => {
    mount(SOURCE, { imageCodec: codec(20, 10), images: vault(null) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("");
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    // Chi sceglie dice da sé perché non ha potuto.
    mount(SOURCE, { imageCodec: codec(20, 10), images: vault(new Error("rotto")) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("");
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    mount(SOURCE, { imageCodec: codec(20, 10), images: vault(HREF, null) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("L’immagine scelta non si apre: forse non è più nel vault.");
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    mount(SOURCE, { imageCodec: codec(20, 10, false), images: vault(HREF) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("Non è un’immagine che il disegno sa leggere.");
    expect(changes).toEqual([]);
  });

  it("un documento che cambia mentre si sceglie non riceve l'immagine", async () => {
    let answer: (href: string | null) => void = () => {};
    let asked = 0;
    let read = 0;
    const images: DrawImages = {
      url: async () => null,
      read: async () => {
        read++;
        return PNG;
      },
      choose: () => {
        asked++;
        return new Promise((resolve) => (answer = resolve));
      },
    };
    mount(SOURCE, { imageCodec: codec(20, 10), images });
    key("i", { ctrlKey: true });
    await settle();
    // Un secondo Ctrl+I, mentre la scelta è aperta, non ne apre un'altra.
    key("i", { ctrlKey: true });
    expect(asked).toBe(1);
    editor.load(SceneEngine.open(SOURCE));
    answer(HREF);
    await settle();
    // L'immagine non si legge nemmeno.
    expect(read).toBe(0);
    expect(imageLine()).toBe("");
    expect(changes).toEqual([]);
  });
});

describe("annulla e ripeti", () => {
  it("disfano e rifanno un gesto intero, dalla tastiera", () => {
    mount();
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    const drawn = editor.engine.text;
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Rettangolo.");
    key("z", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(drawn);
    expect(spoken()).toBe("Ripetuto: Rettangolo.");
    key("z", { ctrlKey: true });
    // Col foglio a fuoco Ctrl+Y è la vista dei contorni, e non ripete.
    key("y", { ctrlKey: true });
    expect(editor.engine.text).toBe(SOURCE);
    key("y", { ctrlKey: true });
    key("z", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(drawn);
    expect(changes.map((change) => change.origin)).toEqual(["input", "undo", "redo", "undo", "redo"]);
  });

  it("la selezione segue ciò che il passo ha toccato", () => {
    mount();
    editor.select(["o1a2b3c4d"]);
    editor.deleteSelection();
    expect(editor.selection).toEqual([]);
    editor.undo();
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
  });

  it("restano quando il documento si ricostruisce dal testo", () => {
    mount();
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    editor.setEngine(SceneEngine.open(editor.engine.text));
    expect(editor.canUndo).toBe(true);
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
  });
});

describe("la cronologia, nel Completo", () => {
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Cronologia"]')!;
  const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-history")!;
  const list = (): HTMLElement => panel().querySelector<HTMLElement>('[role="listbox"]')!;
  const row = (key: string): HTMLElement => panel().querySelector<HTMLElement>(`[role="option"][data-key="${key}"]`)!;
  /// Le righe, dall'alto: il nome, e `*` su quella di adesso, `~` su quelle
  /// da ripetere.
  const rows = (): string[] =>
    [...panel().querySelectorAll<HTMLElement>('[role="option"]')]
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
      .map((item) => `${item.querySelector(".draw-history-label")!.textContent}${item.getAttribute("aria-current") === "step" ? " *" : ""}${item.hasAttribute("data-ahead") ? " ~" : ""}`);

  /// Tre rettangoli, uno dopo l'altro: i testi dopo ciascuno, dal disegno
  /// aperto.
  function three(): string[] {
    const texts = [editor.engine.text];
    editor.setTool("rect");
    for (const y of [100, 150, 200]) {
      drag([[10, y], [40, y + 30]]);
      texts.push(editor.engine.text);
    }
    return texts;
  }

  it("c'è nel Completo: il pulsante la apre a destra del foglio, e aperta prende il fuoco", () => {
    mount(SOURCE, { workspace: "simple" });
    expect(button().hidden).toBe(true);
    editor.setWorkspace("full");
    expect(button().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    button().click();
    expect(panel().hidden).toBe(false);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(list());
    expect(rows()).toEqual(["Disegno aperto *"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Esc torna al foglio, e la cronologia resta aperta.
    key("Escape", {}, list());
    expect(document.activeElement).toBe(surface());
    expect(panel().hidden).toBe(false);
    button().click();
    expect(panel().hidden).toBe(true);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(true);
    // Nel Semplice si chiude.
    button().click();
    editor.setWorkspace("simple");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("ogni gesto è un passo; un clic su un passo ci torna in un colpo, con un cambiamento solo e gli stessi byte", () => {
    mount(SOURCE);
    button().click();
    const texts = three();
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo", "Rettangolo *"]);
    const drawn = changes.length;

    row("p1").click();
    expect(editor.engine.text).toBe(texts[1]);
    expect(changes).toHaveLength(drawn + 1);
    expect(changes[drawn]!.origin).toBe("undo");
    expect(changes[drawn]!.text).toBe(texts[1]);
    expect(applyOperation(texts[3]!, changes[drawn]!.operation)).toBe(texts[1]);
    expect(spoken()).toBe("Indietro fino a «Rettangolo»: 2 passi annullati.");
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo *", "Rettangolo ~", "Rettangolo ~"]);
    expect(editor.canRedo).toBe(true);

    row("p3").click();
    expect(editor.engine.text).toBe(texts[3]);
    expect(changes).toHaveLength(drawn + 2);
    expect(changes[drawn + 1]!.origin).toBe("redo");
    expect(applyOperation(texts[1]!, changes[drawn + 1]!.operation)).toBe(texts[3]);
    expect(spoken()).toBe("Avanti fino a «Rettangolo»: 2 passi ripetuti.");
    // La selezione segue l'ultimo passo del salto, come dopo un ripeti.
    const third = [...texts[3]!.matchAll(/<rect id="([^"]+)"/g)].map((match) => match[1]!).find((id) => !texts[2]!.includes(id))!;
    expect(editor.selection).toEqual([third]);

    row("p0").click();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Indietro fino all’apertura del disegno: 3 passi annullati.");
    // Annulla e ripeti continuano da lì, e la cronologia li segue.
    key("z", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(texts[1]);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo *", "Rettangolo ~", "Rettangolo ~"]);
    // Un gesto nuovo toglie i passi da ripetere.
    drag([[100, 10], [130, 40]]);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *"]);
  });

  it("dalla tastiera: le frecce scelgono la riga, Invio ci va", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    key("ArrowUp", {}, list());
    key("ArrowUp", {}, list());
    expect(editor.engine.text).toBe(texts[3]);
    key("Enter", {}, list());
    expect(editor.engine.text).toBe(texts[1]);
    // Ctrl+Z, dall'elenco, è l'annulla di sempre.
    key("z", { ctrlKey: true }, list());
    expect(editor.engine.text).toBe(SOURCE);
    expect(rows()[0]).toBe("Disegno aperto *");
  });

  it("si ferma al passo che non si annulla più, che esce dalla cronologia, e lo dice", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    // Il secondo rettangolo, altrove, se n'è andato.
    const second = [...texts[2]!.matchAll(/<rect id="([^"]+)"[^>]*\/>/g)].find((match) => !texts[1]!.includes(match[1]!))!;
    const first = [...texts[1]!.matchAll(/<rect id="([^"]+)"/g)].find((match) => !SOURCE.includes(match[1]!))![1]!;
    editor.setEngine(SceneEngine.open(texts[3]!.replace(second[0], "")));
    row("p0").click();
    expect(spoken()).toBe("Indietro fino a «Rettangolo»: un passo annullato. Impossibile annullare «Rettangolo»: il disegno è cambiato nel frattempo.");
    // Il primo rettangolo resta: il salto si è fermato prima.
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo *", "Rettangolo ~"]);
    expect(editor.engine.text).toContain(first);
    expect(editor.engine.text).not.toContain(second[1]!);
    row("p0").click();
    expect(editor.engine.text).not.toContain(first);
    expect(rows()).toEqual(["Disegno aperto *", "Rettangolo ~", "Rettangolo ~"]);
  });

  it("un segno: «Segna questo punto» lo mette dove si è, col nome da scrivere, e ci si torna", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    row("p2").click();
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    const input = panel().querySelector<HTMLInputElement>(".draw-history-rename")!;
    expect(input.value).toBe("Segno 1");
    expect(document.activeElement).toBe(input);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *", "Segno 1", "Rettangolo ~"]);
    input.value = "Due rettangoli";
    key("Enter", {}, input);
    expect(spoken()).toBe("Ora il segno si chiama «Due rettangoli».");
    expect(document.activeElement).toBe(list());
    // Il segno è della sessione: il documento non cambia.
    expect(editor.engine.text).toBe(texts[2]);

    row("p0").click();
    row("m1").click();
    expect(editor.engine.text).toBe(texts[2]);
    expect(spoken()).toBe("Avanti fino al segno «Due rettangoli»: 2 passi ripetuti.");

    // Il prossimo segno ha il numero dopo; Canc lo toglie.
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    expect(panel().querySelector<HTMLInputElement>(".draw-history-rename")!.value).toBe("Segno 2");
    key("Escape", {}, panel().querySelector<HTMLInputElement>(".draw-history-rename")!);
    key("Delete", {}, list());
    expect(spoken()).toBe("Segno «Segno 2» tolto.");
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *", "Due rettangoli", "Rettangolo ~"]);

    // Un gesto nuovo, prima del segno, lo toglie con i passi da ripetere.
    key("z", { ctrlKey: true });
    drag([[100, 10], [130, 40]]);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *"]);
  });

  it("in sola lettura si guarda soltanto", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    editor.setReadOnly(true);
    expect(list().getAttribute("aria-disabled")).toBe("true");
    expect(panel().querySelector<HTMLButtonElement>(".draw-history-action")!.disabled).toBe(true);
    const before = changes.length;
    row("p1").click();
    key("Enter", {}, list());
    expect(editor.engine.text).toBe(texts[3]);
    expect(changes).toHaveLength(before);
    editor.setReadOnly(false);
    row("p1").click();
    expect(editor.engine.text).toBe(texts[1]);
  });

  it("un altro disegno ricomincia da capo, senza segni", () => {
    mount(SOURCE);
    three();
    button().click();
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    editor.load(SceneEngine.open(SOURCE));
    expect(rows()).toEqual(["Disegno aperto *"]);
    expect(panel().querySelector(".draw-history-count")!.textContent).toBe("0 passi");
  });

  it("«?» elenca i tasti della cronologia", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((one) => [one.querySelector("th")!.textContent, one.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Cronologia")?.rows).toEqual([
      ["Enter o Space", "Nella cronologia, torna o va avanti fino alla riga"],
      ["F2", "Nella cronologia, cambia il nome del segno"],
      ["Del", "Nella cronologia, toglie il segno"],
      ["Esc", "Dalla cronologia torna al foglio"],
    ]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("la verifica dell'accessibilità, nel Completo", () => {
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Accessibilità"]')!;
  const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-access")!;
  const rows = (): HTMLElement[] => [...panel().querySelectorAll<HTMLElement>(".draw-access-problem")];
  /// I problemi, dall'alto, come si leggono.
  const problems = (): string[] => rows().map((row) => row.querySelector(".draw-access-what")!.textContent!);
  const action = (at: number, name: string): HTMLButtonElement => rows()[at]!.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const tree = (): HTMLElement => panel().querySelector<HTMLElement>('[role="tree"]')!;
  const item = (name: string): HTMLElement => [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((each) => each.textContent === name)!;
  const active = (): string | null => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.textContent ?? null;
  const warning = (): HTMLElement => panel().querySelector<HTMLElement>(".draw-access-warning")!;
  const ids = (): string[] => [...editor.engine.text.matchAll(/<(?:rect|text|image) id="([^"]+)"/g)].map((found) => found[1]!);

  /// Un testo giallo su bianco, scritto come lo scrive l'editor, e
  /// un'immagine senza descrizione, in un disegno senza titolo.
  const SUN = `<text id="o1a1a1a1a" x="10" y="20" fill="#f0e442">\n  <tspan x="10" dy="0">Sole</tspan>\n</text>`;
  const PHOTO = `<image id="o2b2b2b2b" x="0" y="30" width="10" height="10" href="foto.png"/>`;
  const POOR = doc(`${LAYER}${SUN}${PHOTO}</g>`);
  /// Due quadrati che si sovrappongono e uno lontano, in un disegno che si
  /// legge.
  const STACK = doc(
    `<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="0" y="0" width="20" height="20"/><rect id="ob2b2b2b2" x="10" y="10" width="20" height="20"/>` +
      `<rect id="oc3c3c3c3" x="100" y="100" width="20" height="20"/></g>`,
  );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("c'è nel Completo: il pulsante la apre a destra del foglio, e aperta legge il disegno e prende il fuoco", () => {
    mount(POOR, { workspace: "simple" });
    expect(button().hidden).toBe(true);
    editor.setWorkspace("full");
    expect(button().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    button().click();
    expect(panel().hidden).toBe(false);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Nota: Un testo si legge poco", "Avviso: Un’immagine non ha una descrizione"]);
    expect(panel().querySelector(".draw-access-count")!.textContent).toBe("3 problemi");
    expect(document.activeElement).toBe(action(0, "fix"));
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Esc torna al foglio, e la verifica resta aperta.
    key("Escape", {}, action(0, "fix"));
    expect(document.activeElement).toBe(surface());
    expect(panel().hidden).toBe(false);
    button().click();
    expect(panel().hidden).toBe(true);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(true);
    // Nel Semplice si chiude.
    button().click();
    editor.setWorkspace("simple");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("un colore che si legge si mette in un passo; il fuoco passa al problema dopo, e un annulla lo riporta", () => {
    mount(POOR);
    button().click();
    const color = action(1, "fix");
    expect(color.textContent).toMatch(/^Usa #[0-9a-f]{6} \(4,\d\d:1\)$/);
    const chosen = color.textContent!.slice(4, 11);
    color.focus();
    color.click();
    expect(changes).toHaveLength(1);
    expect(editor.engine.text).toBe(POOR.replace('fill="#f0e442"', `fill="${chosen}"`));
    expect(spoken()).toMatch(new RegExp(`ora usa ${chosen}: contrasto 4,\\d\\d:1\\.$`));
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Avviso: Un’immagine non ha una descrizione"]);
    expect(document.activeElement).toBe(action(1, "describe"));
    // L'annulla di sempre; la verifica rilegge il disegno un momento dopo.
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(POOR);
    expect(problems()).toHaveLength(2);
    vi.advanceTimersByTime(250);
    expect(problems()).toHaveLength(3);
  });

  it("una correzione su un disegno che intanto è cambiato si rilegge: se il problema non c'è più, non fa niente", () => {
    mount(POOR);
    button().click();
    editor.setEngine(SceneEngine.open(POOR.replace('fill="#f0e442"', 'fill="#222222"')));
    // Il disegno nuovo non si è ancora riletto: la riga c'è ancora.
    expect(problems()).toHaveLength(3);
    const before = changes.length;
    action(1, "fix").click();
    expect(changes).toHaveLength(before);
    expect(editor.engine.text).toContain('fill="#222222"');
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Avviso: Un’immagine non ha una descrizione"]);
  });

  it("«Scrivi il titolo» porta al campo del titolo", () => {
    mount(POOR);
    button().click();
    action(0, "fix").click();
    const input = host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "Il porto";
    input.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(250);
    expect(problems()).toEqual(["Nota: Un testo si legge poco", "Avviso: Un’immagine non ha una descrizione"]);
  });

  it("un'immagine si descrive nella riga, o si dichiara decorativa, ciascuna in un passo", () => {
    mount(POOR);
    button().click();
    action(2, "describe").click();
    const field = panel().querySelector<HTMLInputElement>(".draw-access-describe")!;
    expect(document.activeElement).toBe(field);
    field.value = "Il porto al tramonto";
    key("Enter", {}, field);
    expect(changes).toHaveLength(1);
    expect(editor.engine.text).toContain("Il porto al tramonto");
    expect(spoken()).toBe("Descrizione scritta: «Il porto al tramonto».");
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Nota: Un testo si legge poco"]);
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(POOR);
    vi.advanceTimersByTime(250);
    action(2, "decorative").click();
    expect(editor.engine.text).toBe(POOR.replace('href="foto.png"/>', 'href="foto.png" aria-hidden="true"/>'));
    expect(spoken()).toMatch(/è decorativa: lo screen reader la salta\.$/);
    expect(problems()).toHaveLength(2);
  });

  it("un oggetto bloccato non si corregge da qui: ci si va, e si dice perché", () => {
    mount(POOR.replace('<text id="o1a1a1a1a"', '<text id="o1a1a1a1a" fub:locked="true"'));
    button().click();
    expect(action(1, "fix")).toBeNull();
    action(1, "go").click();
    expect(spoken()).toMatch(/non si sceglie: è bloccato, nascosto o fuori dal gruppo isolato\.$/);
    expect(editor.selection).toEqual([]);
  });

  it("in sola lettura i problemi si guardano soltanto", () => {
    mount(POOR);
    button().click();
    editor.setReadOnly(true);
    expect(panel().querySelector<HTMLElement>(".draw-access-note")!.hidden).toBe(false);
    expect(rows().map((row) => row.querySelectorAll('[data-action]:not([data-action="go"])').length)).toEqual([0, 0, 0]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("l'ordine di lettura: un clic sceglie l'oggetto, Alt+↓ lo sposta, e se passerebbe sopra un vicino che copre prima lo dice", () => {
    mount(STACK);
    button().click();
    expect(panel().querySelector(".draw-access-count")!.textContent).toBe("nessun problema");
    expect(document.activeElement).toBe(tree());
    const [first, second, third] = ["oa1a1a1a1", "ob2b2b2b2", "oc3c3c3c3"];
    const name = (key: string): string => [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((each) => each.id.endsWith(key))!.textContent!;
    const firstName = name(first!);
    item(firstName).click();
    expect(editor.selection).toEqual([first]);
    expect(active()).toBe(firstName);
    expect(document.activeElement).toBe(tree());
    key("ArrowDown", { altKey: true }, tree());
    expect(warning().hidden).toBe(false);
    expect(warning().textContent).toMatch(/passerebbe sopra .*, che copre in parte: ripeti per spostarlo lo stesso\.$/);
    expect(changes).toEqual([]);
    key("ArrowDown", { altKey: true }, tree());
    expect(ids()).toEqual([second, first, third]);
    expect(changes).toHaveLength(1);
    expect(warning().hidden).toBe(true);
    expect(spoken()).toMatch(/ora si legge dopo /);
    expect(active()).toBe(firstName);
    // Il vicino lontano non copre niente: si passa subito.
    key("ArrowDown", { altKey: true }, tree());
    expect(ids()).toEqual([second, third, first]);
    // L'ultimo fra i vicini non va oltre; «Leggi prima» lo riporta.
    const [earlier, later] = [...panel().querySelectorAll<HTMLButtonElement>(".draw-access-moves > button")];
    expect(later!.disabled).toBe(true);
    earlier!.click();
    expect(ids()).toEqual([second, first, third]);
    // Ogni spostamento è un passo.
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(STACK);
  });

  it("«?» elenca i tasti della verifica", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((one) => [one.querySelector("th")!.textContent, one.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Accessibilità")?.rows).toEqual([
      ["↑ o ↓ o Home o End", "Nell’ordine di lettura, l’oggetto prima o dopo, il primo o l’ultimo"],
      ["Enter o Space", "Nell’ordine di lettura, sceglie l’oggetto e lo mostra"],
      ["Alt+↑ o Alt+↓", "Nell’ordine di lettura, sposta l’oggetto prima o dopo il suo vicino"],
      ["Esc", "Dalla verifica torna al foglio"],
    ]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il titolo", () => {
  it("si scrive con un `meta`, e vuoto si toglie", () => {
    mount();
    const input = host.querySelector<HTMLInputElement>(".draw-title-input")!;
    input.value = "  Il ciclo dell'acqua ";
    input.dispatchEvent(new Event("change"));
    expect(editor.engine.text).toContain("<title>Il ciclo dell'acqua</title>");
    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(editor.engine.text).not.toContain("<title>");
    editor.undo();
    expect(input.value).toBe("Il ciclo dell'acqua");
  });
});

describe("un documento che non si modifica", () => {
  it("si guarda e basta: la barra è spenta e i gesti non scrivono", () => {
    mount(doc(`${LAYER}<rect id="o1a2b3c4d" width="5" height="5"/></g>`).replace(' fub:version="1"', ""));
    expect(editor.engine.status).not.toBe("fubdraw");
    expect(host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".draw-tool")!.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>(".draw-title-input")!.disabled).toBe(true);
    drag([[10, 10], [50, 40]]);
    key("a", { ctrlKey: true });
    key("Delete");
    expect(changes).toEqual([]);
  });

  it("e un documento con ogni livello bloccato lo dice: nel Completo nomina il livello", () => {
    const LOCKED = doc('<g id="l1" fub:layer="Uno" fub:locked="true"></g>');
    mount(LOCKED, { workspace: "simple" });
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    expect(changes).toEqual([]);
    expect(spoken()).toBe("Ogni livello è bloccato o nascosto: non c’è dove disegnare.");
    editor.setWorkspace("full");
    drag([[10, 10], [50, 40]]);
    expect(changes).toEqual([]);
    expect(spoken()).toBe("«Uno» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
  });
});

describe("per chi lo monta", () => {
  const FOREIGN = doc(`${LAYER}<rect id="o1a2b3c4d" width="5" height="5"/></g>`).replace(' fub:version="1"', "");
  const camera = (): string | null => host.querySelector(".draw-preview g")!.getAttribute("transform");

  it("«Modifica» adotta un SVG estraneo in un passo che si annulla", () => {
    mount(FOREIGN);
    expect(host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(editor.adopt()).toBe(true);
    expect(editor.engine.status).toBe("fubdraw");
    expect(changes.map((change) => change.origin)).toEqual(["input"]);
    expect(changes[0]!.text).toContain('fub:version="1"');
    expect(spoken()).toBe("Ora il disegno si modifica.");
    expect(host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(false);
    expect(editor.adopt()).toBe(false);
    editor.undo();
    expect(editor.engine.status).toBe("foreign");
    expect(editor.engine.text).toBe(FOREIGN);
    expect(spoken()).toBe("Annullato: Disegno reso modificabile.");
  });

  it("non adotta con la scrittura tolta", () => {
    mount(FOREIGN);
    editor.setReadOnly(true);
    expect(editor.adopt()).toBe(false);
    expect(changes).toEqual([]);
  });

  it("con la scrittura tolta si guarda soltanto, e ridata torna a scrivere", () => {
    mount();
    editor.setReadOnly(true);
    expect(host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".draw-tool")!.disabled).toBe(true);
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    key("a", { ctrlKey: true });
    key("Delete");
    expect(changes).toEqual([]);
    editor.setReadOnly(false);
    expect(host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(false);
    drag([[10, 10], [50, 40]]);
    expect(changes).toHaveLength(1);
  });

  it("un documento nuovo azzera cronologia e selezione", () => {
    mount();
    editor.select(["o1a2b3c4d"]);
    key("Delete");
    expect(editor.canUndo).toBe(true);
    const next = doc(`${LAYER}<ellipse id="o5e6f7a8b" cx="20" cy="20" rx="5" ry="5"/></g>`);
    editor.load(SceneEngine.open(next));
    expect(editor.engine.text).toBe(next);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.selection).toEqual([]);
  });

  it("un documento in sola lettura non entra nell'editor", () => {
    mount();
    const inert = SceneEngine.open(`<!DOCTYPE svg>${SOURCE}`);
    expect(inert.model).toBeNull();
    expect(() => editor.setEngine(inert)).toThrow();
    expect(() => editor.load(inert)).toThrow();
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("dice quando la selezione cambia, una volta per cambiamento", () => {
    let calls = 0;
    mount(SOURCE, { onSelectionChange: () => calls++ });
    editor.select(["o1a2b3c4d"]);
    editor.select(["o1a2b3c4d"]);
    expect(calls).toBe(1);
    key("Escape");
    expect(calls).toBe(2);
  });

  it("`reveal` sceglie l'oggetto che contiene il byte, e niente fuori dagli oggetti", () => {
    mount();
    const rect = new TextEncoder().encode(SOURCE.slice(0, SOURCE.indexOf("<rect"))).length;
    expect(editor.reveal(rect + 4)).toBe(true);
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(spoken()).toBe("1 oggetto scelto.");
    editor.select([]);
    expect(editor.reveal(SOURCE.indexOf("<title>") + 2)).toBe(false);
    expect(editor.reveal(SOURCE.indexOf('<g id="l1"') + 2)).toBe(false);
    expect(editor.selection).toEqual([]);
  });

  it("`reveal` di un oggetto senza id lo sceglie per percorso", () => {
    const source = doc(`${LAYER}<rect width="5" height="5"/><rect x="10" width="5" height="5"/></g>`);
    mount(source);
    expect(editor.reveal(source.lastIndexOf("<rect") + 1)).toBe(true);
    expect(editor.selection).toEqual(["@0.1"]);
  });

  it("`reveal` lascia ferma la vista se l'oggetto si vede, se no lo porta al centro o lo inquadra", () => {
    const source = doc(
      `${LAYER}<rect id="oa1a1a1a1" x="60" y="60" width="20" height="20" fill="#000000"/>` +
        `<rect id="ob2b2b2b2" x="60" y="150" width="20" height="20" fill="#000000"/>` +
        `<rect id="oc3c3c3c3" x="0" y="400" width="1000" height="200" fill="#000000"/></g>`,
    );
    mount(source);
    size(200, 100);
    const before = camera();
    expect(editor.reveal(source.indexOf("oa1a1a1a1"))).toBe(true);
    expect(camera()).toBe(before);
    expect(editor.reveal(source.indexOf("ob2b2b2b2"))).toBe(true);
    expect(camera()).toBe("matrix(1 0 0 1 30 -110)");
    expect(editor.reveal(source.indexOf("oc3c3c3c3"))).toBe(true);
    const [scale] = camera()!.slice("matrix(".length).split(" ").map(Number);
    expect(scale).toBeLessThan(1);
  });
});

describe("la Mano e la Lente", () => {
  const camera = (): string | null => host.querySelector(".draw-preview g")!.getAttribute("transform");
  const keyUp = (key: string): void => {
    surface().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  };

  it("la Mano trascina la vista e non tocca il disegno", () => {
    mount();
    editor.setTool("hand");
    expect(surface().dataset.tool).toBe("hand");
    drag([[10, 10], [25, 20], [40, 30]]);
    expect(camera()).toBe("matrix(1 0 0 1 30 20)");
    expect(changes).toEqual([]);
  });

  it("Spazio tenuto col mouse sul foglio presta la Mano a ogni strumento, e lasciato lo rende", () => {
    mount();
    editor.setTool("rect");
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, buttons: 0, clientX: 10, clientY: 10 }));
    expect(key(" ").defaultPrevented).toBe(true);
    expect(surface().dataset.view).toBe("grab");
    drag([[10, 10], [40, 30]]);
    expect(camera()).toBe("matrix(1 0 0 1 30 20)");
    expect(changes).toEqual([]);
    keyUp(" ");
    expect(surface().dataset.view).toBeUndefined();
    drag([[10, 10], [40, 30]]);
    expect(changes).toHaveLength(1);
  });

  it("Spazio senza il mouse sul foglio resta il «premi» del cursore", () => {
    mount();
    editor.setTool("rect");
    expect(key(" ").defaultPrevented).toBe(true);
    expect(surface().dataset.view).toBeUndefined();
    expect(host.querySelector<HTMLElement>(".draw-cursor")!.hasAttribute("data-pressed")).toBe(true);
  });

  it("la Lente ingrandisce al clic, rimpicciolisce con Alt, e inquadra il riquadro", () => {
    mount();
    size(200, 100);
    editor.setTool("zoom");
    drag([[50, 50], [50, 50]]);
    expect(camera()).toBe("matrix(2 0 0 2 -50 -50)");
    drag([[50, 50], [50, 50]], { altKey: true });
    expect(camera()).toBe("matrix(1 0 0 1 0 0)");
    drag([[0, 0], [25, 10], [50, 25]]);
    const [scale] = camera()!.slice("matrix(".length).split(" ").map(Number);
    expect(scale).toBeGreaterThan(1);
    expect(host.querySelector<HTMLElement>(".draw-zoom-box")!.hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("Ctrl+0 col foglio a fuoco è il 100%, Maiusc+2 inquadra la selezione", () => {
    mount();
    size(200, 100);
    surface().focus();
    key("+");
    expect(key("0", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(camera()!.startsWith("matrix(1 0 0 1 ")).toBe(true);
    // Fuori dal foglio Ctrl+0 resta dello Scrittoio.
    const outside = key("0", { ctrlKey: true }, host.querySelector<HTMLElement>(".draw-rail button")!);
    expect(outside.defaultPrevented).toBe(false);
    key("@", { shiftKey: true, code: "Digit2" });
    expect(spoken()).toBe("Niente di scelto da mostrare.");
    editor.select(["o1a2b3c4d"]);
    key("@", { shiftKey: true, code: "Digit2" });
    const [scale] = camera()!.slice("matrix(".length).split(" ").map(Number);
    expect(scale).toBeGreaterThan(2);
    expect(changes).toEqual([]);
  });

  it("Ctrl+' accende e spegne la griglia; Ctrl+; e Ctrl+U non fanno più niente (ADR 0231)", () => {
    mount(SOURCE);
    surface().focus();
    const { shown } = editor.grid;
    key("'", { ctrlKey: true });
    expect(editor.grid.shown).toBe(!shown);
    const grid = editor.grid;
    key(";", { ctrlKey: true, shiftKey: true });
    key("u", { ctrlKey: true });
    expect(editor.grid).toEqual(grid);
  });

  it("Ctrl+. nasconde l'interfaccia del disegno e la riporta", () => {
    mount();
    const root = host.querySelector<HTMLElement>(".draw-editor")!;
    host.querySelector<HTMLElement>(".draw-rail button")!.focus();
    expect(key(".", { ctrlKey: true }, document.activeElement as HTMLElement).defaultPrevented).toBe(true);
    expect(root.hasAttribute("data-bare")).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(spoken()).toBe("Interfaccia nascosta: Ctrl+. la riporta.");
    key(".", { ctrlKey: true });
    expect(root.hasAttribute("data-bare")).toBe(false);
    expect(spoken()).toBe("Interfaccia di nuovo in vista.");
  });

  it("Ctrl+Y col foglio a fuoco mostra i contorni, la banda lo dice, e lo stesso tasto torna al disegno pieno", () => {
    mount();
    const painted = host.querySelector<HTMLElement>(".spatial-painter")!;
    const band = (): string[] => editor.status.items().map((item) => item.id);
    surface().focus();
    expect(key("y", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(painted.hasAttribute("data-outline")).toBe(true);
    expect(painted.querySelector("style")!.textContent).toContain("fill:none!important");
    expect(spoken()).toBe("Vista dei contorni: Ctrl+Y torna al disegno pieno.");
    expect(band()).toContain("outline");
    // Dalla banda si torna al disegno pieno.
    editor.status.items().find((item) => item.id === "outline")!.open!();
    expect(painted.hasAttribute("data-outline")).toBe(false);
    expect(painted.querySelector("style")).toBeNull();
    expect(band()).not.toContain("outline");
    key("y", { ctrlKey: true });
    key("y", { ctrlKey: true });
    expect(spoken()).toBe("Disegno pieno.");
    expect(changes).toEqual([]);
  });

  it("Ctrl+/ cerca fra strumenti e menu, col posto e il tasto; uno spento dice perché; il comando usato torna in cima", async () => {
    mount();
    surface().focus();
    // Sulla tastiera italiana la barra è Maiusc+7.
    expect(key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" }).defaultPrevented).toBe(true);
    const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".draw-commands-dialog")!;
    const input = dialog().querySelector<HTMLInputElement>(".draw-commands-field input")!;
    expect(document.activeElement).toBe(input);
    const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>(".draw-commands-row")];
    const labels = (): string[] => rows().map((row) => row.querySelector(".draw-commands-label")!.textContent!);
    const type = (text: string): void => {
      input.value = text;
      input.dispatchEvent(new Event("input"));
    };
    expect(labels()).toContain("Mano");
    type("contorni");
    expect(labels()[0]).toBe("Contorni");
    expect(rows()[0]!.querySelector(".draw-commands-path")!.textContent).toBe("Disegno › Vista");
    expect(rows()[0]!.querySelector(".draw-commands-key")!.textContent).toBe("Ctrl+Y");
    type("mostra la sel");
    expect(labels()[0]).toBe("Mostra la selezione");
    expect(rows()[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows()[0]!.querySelector(".draw-commands-why")!.textContent).toBe("Scegli prima degli oggetti.");
    type("zzzz");
    expect(dialog().querySelector(".draw-commands-empty")!.textContent).toBe("Nessun comando per questa ricerca.");
    type("contorni");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    key("Enter", {}, input);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
    expect(host.querySelector(".spatial-painter")!.hasAttribute("data-outline")).toBe(true);
    // Alla prossima apertura il comando usato sta in cima.
    key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" });
    expect(labels()[0]).toBe("Contorni");
    key("Escape", {}, document.activeElement as HTMLElement);
    await Promise.resolve();
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
  });
  it("il navigatore, acceso da «Disegno › Vista», mostra il disegno e la vista; premere e trascinare spostano la vista", async () => {
    mount();
    size(200, 100);
    const nav = host.querySelector<HTMLElement>(".draw-navigator")!;
    expect(nav.hidden).toBe(true);
    expect(nav.getAttribute("aria-hidden")).toBe("true");
    surface().focus();
    key("/", { ctrlKey: true, shiftKey: true, code: "Digit7" });
    const input = document.querySelector<HTMLInputElement>(".draw-commands-field input")!;
    input.value = "navigatore";
    input.dispatchEvent(new Event("input"));
    key("Enter", {}, input);
    await Promise.resolve();
    await Promise.resolve();
    expect(nav.hidden).toBe(false);
    expect(spoken()).toBe("Navigatore in vista, in basso a destra.");
    const map = nav.querySelector<SVGSVGElement>(".draw-navigator-map")!;
    expect(map.querySelectorAll(".draw-navigator-shapes rect").length).toBeGreaterThan(0);
    const box = map.getAttribute("viewBox")!.split(" ").map(Number);
    expect(box[2]).toBeGreaterThan(0);
    expect(nav.querySelector(".draw-navigator-view")!.getAttribute("points")).not.toBeNull();
    // La panoramica è larga 160 e alta 120, in alto a sinistra della pagina.
    map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 120, right: 160, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
    const before = camera();
    nav.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 150, clientY: 110 }));
    const moved = camera();
    expect(moved).not.toBe(before);
    nav.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, clientX: 140, clientY: 100 }));
    expect(camera()).not.toBe(moved);
    nav.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, clientX: 140, clientY: 100 }));
    expect(changes).toEqual([]);
  });

  it("i tasti del disegno non prendono quelli dello Scrittoio, tranne quelli dichiarati", async () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const drawn = new Set([...dialog().querySelectorAll("th kbd")].map((kbd) => kbd.textContent!));
    // Col fuoco nel disegno il disegno tiene questi, e fuori restano dello
    // Scrittoio: sul foglio Ctrl+0 è il 100%, fra gli oggetti Ctrl+F li
    // filtra.
    const declared = new Set<string>(["Mod-0", "Mod-f"]);
    const shell = Object.values(SHELL_KEYS).flatMap((chord): string[] => (chord === null ? [] : [chord]));
    const clashes = shell.filter((chord) => !declared.has(chord) && drawn.has(displayBinding(chord)));
    expect(clashes).toEqual([]);
    for (const chord of declared) expect(drawn.has(displayBinding(chord)), chord).toBe(true);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("fuori da un gesto, sotto la selezione ci sono le sue misure", () => {
    const layer = recording();
    mount();
    editor.setTool("select");
    editor.select(["o1a2b3c4d"]);
    layer.frame();
    expect(layer.texts()).toHaveLength(1);
    expect(layer.texts()[0]).toMatch(/^\S+ × \S+$/);
  });
});

describe("il catalogo dei comandi", () => {
  /// Un oggetto di ogni specie che si sceglie: rettangolo, ellisse, linea,
  /// testo, tracciato, gruppo, immagine e collegamento.
  const KINDS = doc(
    `<title>Prova</title>${LAYER}<rect id="oc1c1c1c1" x="10" y="10" width="30" height="20" fill="#0072b2"/>` +
      `<ellipse id="oc2c2c2c2" cx="60" cy="20" rx="10" ry="8" fill="#e69f00"/>` +
      `<line id="oc3c3c3c3" x1="10" y1="50" x2="40" y2="60" stroke="#000000" stroke-width="2"/>` +
      `<text id="oc4c4c4c4" x="50" y="60"><tspan x="50" dy="0">Ciao</tspan></text>` +
      `<path id="oc5c5c5c5" d="M10 80 C20 70 30 90 40 80" fill="none" stroke="#000000"/>` +
      `<g id="oc6c6c6c6"><rect x="60" y="70" width="10" height="10"/><rect x="72" y="70" width="10" height="10"/></g>` +
      `<image id="oc7c7c7c7" x="100" y="10" width="40" height="20" href="data:image/png;base64,iVBORw0KGgo="/>` +
      `<a id="oc8c8c8c8" href="Note/a.md"><rect x="100" y="50" width="20" height="20" fill="#009e73"/></a></g>`,
  );
  const IDS = ["oc1c1c1c1", "oc2c2c2c2", "oc3c3c3c3", "oc4c4c4c4", "oc5c5c5c5", "oc6c6c6c6", "oc7c7c7c7", "oc8c8c8c8"];
  /// Chi ospita l'editor sa fare tutto: esportare, collegare, scegliere
  /// immagini nel vault.
  const HOST: DrawEditorOptions = {
    onExport: () => {},
    links: { choose: async () => null, open: () => {} },
    images: { url: async () => null, read: async () => null, choose: async () => null },
  };

  /// Ciò che si raggiunge nello spazio `workspace`: i comandi del catalogo,
  /// le sezioni e i campi delle proprietà che si vedono, senza selezione, con
  /// ogni oggetto da solo e con tutti insieme, con la selezione e con la penna.
  const reach = (workspace: Workspace): Set<string> => {
    host.replaceChildren();
    mount(KINDS, { workspace, ...HOST });
    editor.setTool("select");
    // Le proprietà aperte, se ci sono: le sezioni si leggono lì.
    editor.commands().find((one) => one.id === "draw.button:properties")?.run();
    const found = new Set<string>();
    const look = (): void => {
      for (const command of editor.commands()) found.add(`comando ${command.id}`);
      for (const section of host.querySelectorAll<HTMLElement>("[data-section]")) {
        if (section.hidden || section.closest("[hidden]") !== null) continue;
        found.add(`sezione ${section.dataset.section}`);
        for (const field of section.querySelectorAll<HTMLElement>("[data-field]")) if (field.closest("[hidden]") === null) found.add(`campo ${field.dataset.field}`);
      }
    };
    look();
    for (const id of IDS) {
      editor.select([id]);
      look();
    }
    editor.select(IDS);
    look();
    editor.select([]);
    editor.setTool("pen");
    look();
    editor.dispose();
    return found;
  };

  it("ha strumenti, Annulla, Ripeti, il menu «Disegno» e la barra della selezione, con id unici", () => {
    mount(KINDS);
    editor.setTool("select");
    editor.select(IDS.slice(0, 2));
    const all = editor.commands();
    const ids = all.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("draw.tool.pen");
    expect(ids).toContain("draw.undo");
    expect(ids).toContain("draw.group");
    expect(ids).toContain("draw.menu:vista/contorni");
    for (const one of all) expect(one.label, one.id).not.toBe("");
    // Un tasto fa una cosa sola: due comandi con lo stesso tasto hanno lo
    // stesso nome (lo stesso comando da due posti).
    const byKey = new Map<string, string>();
    for (const one of all) {
      if (one.hint === undefined || one.hint === "") continue;
      const before = byKey.get(`${one.context} ${one.hint}`);
      if (before !== undefined) expect(one.label, `${one.id} ${one.hint}`).toBe(before);
      else byKey.set(`${one.context} ${one.hint}`, one.label);
    }
  });

  it("il Completo raggiunge tutto ciò che raggiunge il Semplice, e in più le funzioni che il Semplice non ha", () => {
    const full = reach("full");
    const simple = reach("simple");
    expect([...simple].filter((what) => !full.has(what))).toEqual([]);
    const more = [...full].filter((what) => !simple.has(what));
    for (const what of ["comando draw.menu:selezione-avanzata/isola-il-gruppo", "comando draw.button:draw-layers", "comando draw.button:draw-history", "comando draw.button:draw-access", "comando draw.group", "campo grid", "comando draw.unlink"]) {
      expect(more, what).toContain(what);
    }
  });

  it("il menu radiale prende dal catalogo strumenti, Annulla e Ripeti, e si apre dal catalogo da tastiera", () => {
    mount(KINDS);
    editor.setTool("pen");
    const radial = editor.commands().find((one) => one.id === "draw.radial")!;
    radial.run();
    const items = [...document.querySelectorAll<HTMLElement>(".draw-radial-item")].map((item) => item.getAttribute("aria-label"));
    expect(items).toContain("Annulla");
    expect(items).toContain("Ripeti");
    closeRadial();
  });
});

describe("gli appunti", () => {
  const ID = "o1a2b3c4d";

  /// Gli appunti di sistema, che il `navigator` dei test non ha: ciò che vi
  /// si scrive si rilegge.
  let system: ClipboardItem[];
  let clipboard: { read: () => Promise<ClipboardItem[]>; write: (items: ClipboardItem[]) => Promise<void> };
  beforeEach(() => {
    system = [];
    clipboard = {
      read: async () => system,
      write: async (items) => {
        system = [...items];
      },
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  });
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  /// Un evento degli appunti, sul foglio se non si dice dove.
  function clip(type: "copy" | "cut" | "paste", data = new DataTransfer(), target: EventTarget = surface()): ClipboardEvent {
    const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    target.dispatchEvent(event);
    return event;
  }

  /// Appunti che portano `text` come `type`.
  function holding(text: string, type = "text/plain"): DataTransfer {
    const data = new DataTransfer();
    data.setData(type, text);
    return data;
  }

  /// Copia la selezione col tasto, e rende il testo negli appunti.
  function copied(): string {
    const data = new DataTransfer();
    clip("copy", data);
    return data.getData("text/plain");
  }

  /// Un rilascio sul foglio: happy-dom non ha `DragEvent`.
  function drop(files: readonly File[], x: number, y: number): MouseEvent {
    const data = new DataTransfer();
    for (const one of files) data.items.add(one);
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, "dataTransfer", { value: data });
    surface().dispatchEvent(event);
    return event;
  }

  /// Aspetta che l'incolla finisca di entrare.
  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const hover = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y }));
  };
  const rects = (): string[] => editor.engine.text.match(/<rect [^>]*\/>/g) ?? [];
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-progress")!;

  /// Un SVG di `count` quadratini con un nome di 4 KiB ciascuno: pesa
  /// tanto e si disegna in fretta.
  function heavy(count: number): string {
    const name = "x".repeat(4096);
    const squares = Array.from({ length: count }, (_, i) => `<rect x="${i % 50}" y="${Math.floor(i / 50)}" width="1" height="1"><title>${name}</title></rect>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="60">${squares.join("")}</svg>`;
  }

  it("copiare scrive la selezione come SVG, anche in sola lettura; tagliare la toglie, in un passo", () => {
    mount();
    editor.select([ID]);
    const data = new DataTransfer();
    expect(clip("copy", data).defaultPrevented).toBe(true);
    const svg = data.getData("text/plain");
    expect(data.getData("image/svg+xml")).toBe(svg);
    expect(svg).toMatch(/^<svg [^>]*viewBox="59 59 22 22"/);
    expect(svg).toContain('<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>');
    expect(spoken()).toBe("1 oggetto copiato.");
    expect(changes).toEqual([]);
    editor.setReadOnly(true);
    expect(clip("copy").defaultPrevented).toBe(true);
    expect(clip("cut").defaultPrevented).toBe(false);
    expect(rects()).toHaveLength(1);
    editor.setReadOnly(false);
    const cut = new DataTransfer();
    expect(clip("cut", cut).defaultPrevented).toBe(true);
    expect(cut.getData("text/plain")).toBe(svg);
    expect(rects()).toEqual([]);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto tagliato. Il disegno ha 0 oggetti.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("senza selezione lo si dice; un campo, e il resto della pagina, tengono i loro appunti", () => {
    mount();
    expect(clip("copy").defaultPrevented).toBe(false);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    editor.select([ID]);
    const title = host.querySelector<HTMLInputElement>(".draw-title-input")!;
    title.focus();
    expect(clip("copy", new DataTransfer(), title).defaultPrevented).toBe(false);
    expect(clip("paste", holding(SOURCE), title).defaultPrevented).toBe(false);
    title.blur();
    const outside = document.createElement("p");
    document.body.append(outside);
    expect(clip("copy", new DataTransfer(), outside).defaultPrevented).toBe(false);
    outside.remove();
    expect(changes).toEqual([]);
  });

  it("incollato torna com'era, con un id nuovo: al cursore, scelto, in un passo", async () => {
    mount();
    size(1000, 500);
    editor.select([ID]);
    const svg = copied();
    hover(300, 300);
    editor.setTool("rect");
    expect(clip("paste", holding(svg)).defaultPrevented).toBe(true);
    await settle();
    const [id] = editor.selection;
    expect(id).not.toBe(ID);
    expect(rects()).toEqual([
      '<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>',
      `<rect id="${id}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2" transform="matrix(1 0 0 1 230 230)"/>`,
    ]);
    expect(editor.tool).toBe("select");
    expect(spoken()).toBe("1 oggetto incollato. Strumento: Selezione. Il disegno ha 2 oggetti.");
    expect(changes).toHaveLength(1);
    // Di nuovo allo stesso punto, un passo più in là, come una copia.
    clip("paste", holding(svg));
    await settle();
    expect(rects()[2]).toMatch(/ transform="matrix\(1 0 0 1 254 254\)"\/>$/);
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("senza il cursore va al centro della vista; Ctrl+Maiusc+V nello stesso punto", async () => {
    mount();
    size(1000, 500);
    editor.setTool("select");
    editor.select([ID]);
    const svg = copied();
    clip("paste", holding(svg));
    await settle();
    expect(rects()[1]).toMatch(/ transform="matrix\(1 0 0 1 430 180\)"\/>$/);
    expect(key("V", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    clip("paste", holding(svg));
    await settle();
    const [id] = editor.selection;
    expect(rects()[2]).toBe(`<rect id="${id}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>`);
    // Il tasto vale per l'incolla che lo segue, non per i prossimi.
    clip("paste", holding(svg));
    await settle();
    expect(rects()[3]).toMatch(/ transform="matrix\(1 0 0 1 430 180\)"\/>$/);
  });

  it("un SVG di fuori entra in un gruppo, senza eseguire niente; uno che non si legge lo si dice", async () => {
    mount();
    size(1000, 500);
    const active =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="globalThis.attivato = 1"><script>globalThis.attivato = 2</script>' +
      '<image href="nessuna.png" width="1" height="1" onerror="globalThis.attivato = 3"/><rect width="10" height="10" onclick="globalThis.attivato = 4"/></svg>';
    clip("paste", holding(active));
    await settle();
    expect(editor.selection).toHaveLength(1);
    expect(readScene(editor.engine.text).diagnostics.filter((d) => d.code === "S005").map((d) => d.detail)).toEqual(["onload", "script", "onerror", "onclick"]);
    surface().click();
    expect("attivato" in globalThis).toBe(false);
    expect(host.querySelector("script, [onload], [onerror], [onclick]")).toBeNull();
    const before = editor.engine.text;
    clip("paste", holding('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'));
    await settle();
    expect(spoken()).toBe("Non è un SVG ben formato: non si incolla.");
    // Un testo che non è un SVG resta a chi lo vuole.
    expect(clip("paste", holding("ciao")).defaultPrevented).toBe(false);
    expect(spoken()).toBe("Negli appunti non c’è niente che il disegno sappia incollare.");
    editor.setReadOnly(true);
    clip("paste", holding(active));
    await settle();
    expect(editor.engine.text).toBe(before);
  });

  it("ciò che Excalidraw e draw.io mettono negli appunti entra coi suoi oggetti, e il rapporto lo dice", async () => {
    mount();
    size(1000, 500);
    const shape = {
      type: "rectangle", id: "r", x: 0, y: 0, width: 100, height: 50, angle: 0, strokeColor: "#1e1e1e",
      backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 2, strokeStyle: "solid", roughness: 1,
      opacity: 100, groupIds: [], roundness: null, isDeleted: false, locked: false, link: null, boundElements: null,
    };
    const excalidraw = JSON.stringify({ type: "excalidraw/clipboard", elements: [shape], files: {} });
    const pasted = clip("paste", holding(excalidraw));
    expect(pasted.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(rects().length).toBeGreaterThan(1), { timeout: 4000 });
    expect(editor.selection.length).toBeGreaterThan(0);
    // Il tratto a schizzo non entra uguale, e lo si dice.
    expect(spoken()).toMatch(/schizzo/);

    const drawio = encodeURIComponent(
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="20" as="geometry"/></mxCell></root></mxGraphModel>',
    );
    const count = rects().length;
    expect(clip("paste", holding(drawio)).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(rects().length).toBeGreaterThan(count), { timeout: 4000 });
  });

  it("un file .svg lasciato sul foglio va dove cade, col suo nome; due sono un passo", async () => {
    mount();
    size(1000, 500);
    const svg = (fill: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`;
    expect(drop([new File([svg("#336699")], "Logo.svg", { type: "image/svg+xml" })], 150, 120).defaultPrevented).toBe(true);
    await settle();
    const [logo] = editor.selection;
    expect(spoken()).toBe("1 oggetto incollato. Strumento: Selezione. Il disegno ha 2 oggetti.");
    expect(editor.engine.text).toContain(`<g id="${logo}" transform="matrix(1 0 0 1 130 110)">`);
    expect(editor.engine.text).toContain("<title>Logo</title>");
    // Un file senza tipo vale per il suo nome.
    drop([new File([svg("#d55e00")], "uno.svg", { type: "image/svg+xml" }), new File([svg("#000000")], "DUE.SVG")], 400, 300);
    await settle();
    expect(editor.selection).toHaveLength(2);
    expect(changes).toHaveLength(2);
    expect(spoken()).toBe("2 oggetti incollati. Il disegno ha 4 oggetti.");
  });

  it("le immagini e i collegamenti del vault seguono il disegno in cui vanno; ciò che viene da fuori resta", async () => {
    /// I documenti di una cartella, come li trova e li nomina la shell.
    const placeIn = (folder: string): DrawPlace => ({ locate: (href) => `${folder}/${href.split("#")[0]}`, refer: (path) => `../${path}` });
    const linked = doc(
      `<title>Prova</title>${LAYER}<image id="oiiiiiiii" href="foto.png" x="0" y="0" width="10" height="10"/>` +
        '<a id="oaaaaaaaa" href="Note/Pioggia.md#Nuvole"><rect id="orrrrrrrr" x="20" y="0" width="5" height="5"/></a>' +
        '<image id="ojjjjjjjj" href="/Sfondi/mare.png" x="30" y="0" width="10" height="10"/></g>',
    );
    mount(linked, { place: placeIn("Disegni") });
    editor.select(["oiiiiiiii", "oaaaaaaaa", "ojjjjjjjj"]);
    const svg = copied();
    editor.dispose();
    mount(SOURCE, { place: placeIn("Altro") });
    clip("paste", holding(svg));
    await settle();
    expect(editor.engine.text).toContain(' href="../Disegni/foto.png"');
    expect(editor.engine.text).toContain(' href="../Disegni/Note/Pioggia.md#Nuvole"');
    expect(editor.engine.text).toContain(' href="/Sfondi/mare.png"');
    editor.undo();
    // Lo stesso testo scritto altrove non dice da dove viene.
    clip("paste", holding(svg.replace("<svg ", "<svg  ")));
    await settle();
    expect(editor.engine.text).toContain(' href="foto.png"');
  });

  it("un incolla grande mostra la sua barra e resta un passo", async () => {
    mount();
    size(1000, 500);
    editor.setTool("select");
    const svg = heavy(2560);
    expect(svg.length).toBeGreaterThan(10 * 1024 * 1024);
    clip("paste", holding(svg));
    expect(bar().hidden).toBe(false);
    expect(spoken()).toBe("Lettura dell’SVG…");
    expect(formatIssues(checkAccessibility(bar()))).toBe("");
    const labels: string[] = [];
    const values: number[] = [];
    while (!bar().hidden) {
      const label = bar().querySelector(".draw-progress-label")!.textContent!;
      if (labels[labels.length - 1] !== label) labels.push(label);
      const value = bar().querySelector("progress")!.getAttribute("value");
      if (value !== null) values.push(Number(value));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(labels).toEqual(["Lettura dell’SVG…", "Inserimento dell’SVG…", "Scrittura nel disegno…"]);
    expect(values.length).toBeGreaterThan(1);
    expect(values.every((value, i) => value > 0 && value <= 1 && (i === 0 || value >= values[i - 1]!))).toBe(true);
    expect(spoken()).toBe("1 oggetto incollato. Il disegno ha 2 oggetti.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("Esc e «Interrompi» fermano l'incolla, e il disegno non cambia", async () => {
    mount(SOURCE, { workspace: "simple" });
    const svg = heavy(256);
    clip("paste", holding(svg));
    expect(key("Escape").defaultPrevented).toBe(true);
    await settle();
    expect(spoken()).toBe("Incolla interrotto: il disegno non è cambiato.");
    expect(bar().hidden).toBe(true);
    clip("paste", holding(svg));
    const stop = bar().querySelector<HTMLButtonElement>(".draw-progress-stop")!;
    expect(stop.textContent).toBe("Interrompi");
    expect(stop.getAttribute("aria-keyshortcuts")).toBe("Escape");
    stop.focus();
    stop.click();
    await settle();
    expect(spoken()).toBe("Incolla interrotto: il disegno non è cambiato.");
    // Il fuoco torna sul foglio, non resta su un pulsante nascosto.
    expect(document.activeElement).toBe(surface());
    expect(changes).toEqual([]);
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("dal menu: copia col comando del browser, incolla dagli appunti che legge; dove non può lo dice", async () => {
    mount(SOURCE);
    size(1000, 500);
    editor.setTool("select");
    editor.select([ID]);
    const menu = (): HTMLButtonElement[] => {
      const open = document.querySelectorAll<HTMLElement>(".context-menu");
      return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    };
    const item = (label: string): HTMLButtonElement => {
      host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!.click();
      return menu().find((entry) => entry.querySelector(".menu-label")!.textContent === label)!;
    };
    // happy-dom non ha `execCommand`: come un browser che non lo lascia fare.
    item("Copia").click();
    expect(spoken()).toBe("Da qui il browser non lascia scrivere negli appunti: usa Ctrl+C.");
    const sent: DataTransfer[] = [];
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string) => {
        const data = new DataTransfer();
        sent.push(data);
        document.body.dispatchEvent(new ClipboardEvent(command, { bubbles: true, cancelable: true, clipboardData: data }));
        return true;
      },
    });
    try {
      item("Copia").click();
    } finally {
      delete (document as { execCommand?: unknown }).execCommand;
    }
    expect(spoken()).toBe("1 oggetto copiato.");
    const svg = sent[0]!.getData("text/plain");
    expect(svg).toContain('<rect id="o1a2b3c4d"');
    // Il PNG di una copia superata non arriva: l'SVG accanto sì.
    const late = Promise.reject(new Error("superato"));
    late.catch(() => undefined);
    await clipboard.write([new ClipboardItem({ "text/plain": new Blob([svg], { type: "text/plain" }), "image/png": late })]);
    item("Incolla nello stesso punto").click();
    await settle();
    const [id] = editor.selection;
    expect(rects()[1]).toBe(`<rect id="${id}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>`);
    item("Incolla").click();
    await settle();
    expect(rects()[2]).toMatch(/ transform="matrix\(1 0 0 1 430 180\)"\/>$/);
    clipboard.read = async () => [new ClipboardItem({ "image/png": late })];
    item("Incolla").click();
    await settle();
    expect(spoken()).toBe("Negli appunti non c’è niente che il disegno sappia incollare.");
    clipboard.read = () => Promise.reject(new DOMException("negato", "NotAllowedError"));
    item("Incolla").click();
    await settle();
    expect(spoken()).toBe("Da qui il browser non lascia leggere gli appunti: incolla con Ctrl+V.");
    expect(changes).toHaveLength(2);
  });

  it("dove il browser lo lascia fare, la copia scrive anche il PNG; quello di una copia superata no", async () => {
    mount();
    editor.select([ID]);
    const written: ClipboardItem[][] = [];
    clipboard.write = async (items) => {
      written.push([...items]);
    };
    const svg = copied();
    await settle();
    expect(written[0]!.map((item) => item.types)).toEqual([["text/plain", "image/png"]]);
    expect(await (await written[0]![0]!.getType("text/plain")).text()).toBe(svg);
    const png = await written[0]![0]!.getType("image/png");
    expect(png.type).toBe("image/png");
    // Il disegno passa a chi disegna con le dimensioni dell'SVG copiato.
    expect(await png.text()).toContain('viewBox="59 59 22 22"');
    expect(vi.mocked(rasterize)).toHaveBeenCalled();
    // Dove si può, anche l'SVG va negli appunti di sistema.
    Object.defineProperty(ClipboardItem, "supports", { configurable: true, value: (type: string) => type === "image/svg+xml" });
    try {
      copied();
      copied();
    } finally {
      delete (ClipboardItem as { supports?: unknown }).supports;
    }
    expect(written[2]![0]!.types).toEqual(["text/plain", "image/png", "image/svg+xml"]);
    await expect(written[1]![0]!.getType("image/png")).rejects.toThrow();
    await expect(written[2]![0]!.getType("image/png")).resolves.toBeInstanceOf(Blob);
    // Una copia d'altro, nella pagina, supera quella del disegno; un altro
    // disegno che la sente passare no.
    const other = document.createElement("div");
    document.body.append(other);
    try {
      createDrawEditor(other, SceneEngine.open(SOURCE), owner, {});
      copied();
      document.body.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
      copied();
      await settle();
      await expect(written[3]![0]!.getType("image/png")).rejects.toThrow();
      await expect(written[4]![0]!.getType("image/png")).resolves.toBeInstanceOf(Blob);
    } finally {
      other.remove();
    }
  });

  it("lo stile si copia e si incolla con Ctrl+Alt+C e Ctrl+Alt+V, nel Completo, in un passo", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    const PAIR = doc(
      `<title>Prova</title>${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2" stroke="#d55e00" stroke-width="4" stroke-dasharray="4 2" opacity="0.5"/>` +
        `<rect id="${B}" x="50" y="10" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
    );
    mount(PAIR, { workspace: "simple" });
    editor.select([A]);
    expect(key("c", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    editor.dispose();
    mount(PAIR);
    editor.select([B]);
    // Lo stile copiato è della pagina: finché nessuno lo copia, non c'è.
    expect(key("v", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Non c’è uno stile da incollare: prima copialo con Ctrl+Alt+C.");
    editor.select([A]);
    // Su un Mac ⌥C scrive «ç»: vale il tasto.
    expect(key("ç", { metaKey: true, altKey: true, code: "KeyC" }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Stile copiato.");
    editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile incollato su 1 oggetto.");
    expect(rects()[1]).toBe(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="#0072b2" stroke="#d55e00" stroke-width="4" stroke-dasharray="4 2" opacity="0.5"/>`);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(PAIR);
  });

  /// Il campione `name` di colore `color`, con l'id `id`.
  const swatch = (id: string, name: string, color: string): string =>
    `<linearGradient id="${id}" fub:role="swatch" fub:name="${name}" gradientUnits="userSpaceOnUse"><stop stop-color="${color}"/></linearGradient>`;

  it("lo stile incollato in un altro disegno usa il campione con lo stesso nome e colore, o il colore del campione", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    mount(
      doc(
        `<defs id="fub-defs">${swatch("rs1s1s1s1", "Blu mare", "#0072b2")}${swatch("rs2s2s2s2", "Vermiglio", "#d55e00")}</defs>` +
          `${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="url(#rs1s1s1s1) #0072b2" stroke="url(#rs2s2s2s2) #d55e00" stroke-width="4"/></g>`,
      ),
      {},
    );
    editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    editor.dispose();
    // Qui «blu mare» ha lo stesso colore, e «Vermiglio» un altro.
    const OTHER = doc(
      `<defs id="fub-defs">${swatch("rt1t1t1t1", "blu mare", "#0072b2")}${swatch("rt2t2t2t2", "Vermiglio", "#e69f00")}</defs>` +
        `${LAYER}<rect id="${B}" x="50" y="10" width="20" height="20" fill="#000000"/></g>`,
    );
    mount(OTHER);
    editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile incollato su 1 oggetto.");
    expect(rects()[0]).toBe(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="url(#rt1t1t1t1) #0072b2" stroke="#d55e00" stroke-width="4"/>`);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(OTHER);
  });

  it("lo stile incollato dopo che il campione ha cambiato colore lo usa col colore di adesso", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    mount(
      doc(
        `<defs id="fub-defs">${swatch("rs1s1s1s1", "Blu mare", "#0072b2")}</defs>` +
          `${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="url(#rs1s1s1s1) #0072b2"/>` +
          `<rect id="${B}" x="50" y="10" width="20" height="20" fill="#000000"/></g>`,
      ),
      {},
    );
    editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    const recolor: Op = {
      op: "batch",
      ops: [
        { op: "set", id: "rs1s1s1s1", part: [0], attrs: { "stop-color": "#56b4e9" } },
        { op: "set", id: A, attrs: { fill: "url(#rs1s1s1s1) #56b4e9" } },
      ],
    };
    expect(editor.perform("draw.action.swatch_recolor", recolor)).toBe(true);
    editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(rects()[1]).toBe(`<rect id="${B}" x="50" y="10" width="20" height="20" fill="url(#rs1s1s1s1) #56b4e9"/>`);
  });
});

describe("la fine", () => {
  it("toglie l'editor dalla pagina e smette di ascoltare", () => {
    mount();
    const root = host.querySelector(".draw-editor")!;
    const sheet = surface();
    editor.dispose();
    expect(root.isConnected).toBe(false);
    host.append(root);
    editor.setTool("rect");
    sheet.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, clientX: 10, clientY: 10 }));
    sheet.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, clientX: 50, clientY: 40 }));
    expect(changes).toEqual([]);
  });
});

describe("la vista girata e i gesti", () => {
  const A = "o1a2b3c4d";
  /// La camera del foglio, come matrice `[a b c d e f]`.
  const cameraOf = (): number[] => host.querySelector(".draw-preview g")!.getAttribute("transform")!.match(/^matrix\((.*)\)$/)![1]!.split(" ").map(Number);
  const near = (actual: readonly number[], expected: readonly number[], digits = 9): void =>
    expect(actual).toEqual(expected.map((value) => expect.closeTo(value, digits)));
  /// Il punto della scena `p` sullo schermo, con la camera di adesso.
  const onScreen = ([x, y]: readonly [number, number]): [number, number] => {
    const [a, b, c, d, e, f] = cameraOf();
    return [a! * x + c! * y + e!, b! * x + d! * y + f!];
  };
  const turnButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-zoom-level[data-turn]")!;
  const pageButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const entry = (label: string): HTMLButtonElement => menu().find((one) => one.querySelector(".menu-label")!.textContent === label)!;
  /// Un dito, il `pointerId` `id`, in (`x`, `y`) al tempo `at`.
  const touch = (type: string, id: number, x: number, y: number, at: number): void => {
    const up = type === "pointerup";
    surface().dispatchEvent(
      pointer(type, { pointerId: id, pointerType: "touch", isPrimary: false, button: type === "pointermove" ? -1 : 0, buttons: up ? 0 : 1, pressure: up ? 0 : 0.5, clientX: x, clientY: y, timeStamp: at }),
    );
  };
  const wheel = (init: { readonly deltaY: number; readonly ctrlKey?: boolean; readonly shiftKey?: boolean }): void => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: init.deltaY });
    // happy-dom fa di WheelEvent un UIEvent: i tasti e il punto si danno a mano.
    const fields = { ctrlKey: init.ctrlKey ?? false, shiftKey: init.shiftKey ?? false, metaKey: false, clientX: 100, clientY: 50 };
    for (const [name, value] of Object.entries(fields)) Object.defineProperty(event, name, { value });
    surface().dispatchEvent(event);
  };

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("4 e 6 girano la vista di 15° attorno al centro, 5 la raddrizza; il pulsante dice l'angolo e la raddrizza", () => {
    mount(SOURCE);
    size(200, 100);
    expect(turnButton().hidden).toBe(true);
    key("6");
    expect(spoken()).toBe("Vista ruotata di 15°.");
    expect(turnButton().hidden).toBe(false);
    expect(turnButton().textContent).toBe("15°");
    expect(turnButton().getAttribute("aria-label")).toBe("15°: raddrizza la vista");
    expect(turnButton().getAttribute("aria-keyshortcuts")).toBe("5");
    for (let i = 0; i < 5; i++) key("6");
    // Il centro del foglio, (100, 50), resta fermo; l'angolo retto è esatto.
    expect(spoken()).toBe("Vista ruotata di 90°.");
    near(cameraOf(), [0, 1, -1, 0, 150, -50]);
    expect(cameraOf().slice(0, 4)).toEqual([0, 1, -1, 0]);
    key("4");
    expect(spoken()).toBe("Vista ruotata di 75°.");
    key("5");
    expect(spoken()).toBe("Vista diritta.");
    near(cameraOf(), [1, 0, 0, 1, 0, 0]);
    expect(turnButton().hidden).toBe(true);
    key("4");
    expect(spoken()).toBe("Vista ruotata di -15°.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    turnButton().click();
    expect(spoken()).toBe("Vista diritta.");
    expect(turnButton().hidden).toBe(true);
  });

  it("la vista gira nel Semplice e nel Completo, e cambiare spazio non la raddrizza", () => {
    mount(SOURCE, { workspace: "simple" });
    size(200, 100);
    key("6");
    expect(turnButton().hidden).toBe(false);
    editor.setWorkspace("full");
    expect(turnButton().hidden).toBe(false);
    expect(cameraOf()[0]).not.toBeCloseTo(1);
  });

  it("la rotella con Ctrl e Maiusc gira a passi, attorno al puntatore", () => {
    mount(SOURCE);
    size(200, 100);
    wheel({ deltaY: 100, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 15°.");
    // Il punto sotto il puntatore resta dov'è.
    near(onScreen([100, 50]), [100, 50]);
    wheel({ deltaY: 30, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 15°.");
    wheel({ deltaY: 30, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 30°.");
    wheel({ deltaY: -100, ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Vista ruotata di 15°.");
    // Senza Maiusc è lo zoom di sempre, all'angolo di adesso.
    const before = cameraOf();
    wheel({ deltaY: -50, ctrlKey: true });
    expect(Math.atan2(cameraOf()[1]!, cameraOf()[0]!)).toBeCloseTo(Math.atan2(before[1]!, before[0]!), 12);
    expect(Math.hypot(cameraOf()[0]!, cameraOf()[1]!)).toBeGreaterThan(Math.hypot(before[0]!, before[1]!));
  });

  it("sul foglio girato si sceglie e si sposta ciò che si vede sotto il puntatore, e le frecce vanno dove si vede", () => {
    mount(SOURCE);
    size(200, 100);
    editor.setTool("select");
    for (let i = 0; i < 6; i++) key("6");
    // Il quadrato da (60, 60) a (80, 80) si vede da (70, 10) a (90, 30).
    near(onScreen([60, 60]), [90, 10]);
    drag([[80, 11], [85, 11], [90, 11]]);
    expect(editor.selection).toEqual([A]);
    // Dieci pixel a destra sullo schermo sono dieci verso l'alto nella scena.
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 0 -10)"');
    key("ArrowRight");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 0 -11)"');
    key("ArrowDown");
    expect(editor.engine.text).toContain('transform="matrix(1 0 0 1 1 -11)"');
    // Ctrl e → allarga la misura che si vede in orizzontale: l'altezza.
    key("ArrowRight", { ctrlKey: true });
    const [a, b, c, d] = editor.engine.text.match(/transform="matrix\(([^)]*)\)"/)![1]!.split(" ").map(Number);
    expect([a, b, c]).toEqual([1, 0, 0]);
    expect(d).toBeGreaterThan(1);
  });

  it("il riquadro di selezione su un foglio girato di traverso sceglie ciò che sta nel rettangolo come si vede", () => {
    mount(SOURCE);
    size(200, 100);
    editor.setTool("select");
    key("6");
    key("6");
    // Il quadrato col suo contorno, da (59, 59) a (81, 81), sullo schermo.
    const corners = ([[59, 59], [81, 59], [81, 81], [59, 81]] as const).map(onScreen);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const [left, top, right, bottom] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // Un po' più stretto del quadrato girato: i suoi angoli escono.
    drag([[left + 3, top + 3], [right - 3, bottom - 3]]);
    expect(editor.selection).toEqual([]);
    drag([[left - 2, top - 2], [right + 2, bottom + 2]]);
    expect(editor.selection).toEqual([A]);
  });

  it("due dita che ruotano girano il foglio, oltre una soglia e senza salti, e rilasciate vicino a un angolo retto ci si posano", () => {
    mount(SOURCE);
    size(200, 100);
    let at = 1000;
    const around = (degrees: number): [number, number] => [50 + 100 * Math.cos((degrees * Math.PI) / 180), 50 + 100 * Math.sin((degrees * Math.PI) / 180)];
    const twist = (steps: readonly number[]): void => {
      touch("pointerdown", 11, 50, 50, (at += 16));
      touch("pointerdown", 12, 150, 50, (at += 16));
      touch("pointermove", 11, 50, 50, (at += 16));
      for (const degrees of steps) touch("pointermove", 12, ...around(degrees), (at += 16));
      touch("pointerup", 11, 50, 50, (at += 16));
      touch("pointerup", 12, ...around(steps[steps.length - 1]!), (at += 16));
    };
    const angle = (): number => (Math.atan2(cameraOf()[1]!, cameraOf()[0]!) * 180) / Math.PI;
    // I primi 10° aprono il gesto: il foglio gira dei 20 dopo.
    twist([5, 10, 20, 30]);
    expect(angle()).toBeCloseTo(20, 9);
    expect(spoken()).toBe("Vista ruotata di 20°.");
    // A 88° si posa sull'angolo retto, esatto: i pixel restano interi.
    const square = (): void => {
      const [a, b, c, d] = cameraOf();
      expect([a, d]).toEqual([0, 0]);
      expect(b).toBeCloseTo(1, 12);
      expect(c).toBeCloseTo(-1, 12);
    };
    twist([5, 10, 78]);
    square();
    expect(spoken()).toBe("Vista ruotata di 90°.");
    // Un pizzico che gira appena non gira il foglio, e non annulla niente.
    twist([3, 6]);
    square();
    expect(editor.engine.text).toBe(SOURCE);
    // Spenta, le dita non girano più.
    editor.setGrid({ ...editor.grid, twist: false });
    twist([5, 10, 40]);
    square();
  });

  it("un tocco di due dita annulla, uno di tre ripete; un tocco lungo o che scorre no, e si spengono", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = editor.engine.text;
    expect(drawn).not.toBe(SOURCE);
    let at = 5000;
    const tap = (fingers: number, hold = 60, slide = 0): void => {
      for (let i = 0; i < fingers; i++) touch("pointerdown", 21 + i, 100 + 20 * i, 50, (at += 10));
      if (slide > 0) touch("pointermove", 21, 100 + slide, 50, (at += 10));
      at += hold;
      for (let i = 0; i < fingers; i++) touch("pointerup", 21 + i, 100 + 20 * i + (i === 0 ? slide : 0), 50, (at += 10));
    };
    tap(2);
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Tratto.");
    tap(3);
    expect(editor.engine.text).toBe(drawn);
    expect(spoken()).toBe("Ripetuto: Tratto.");
    tap(3);
    expect(spoken()).toBe("Niente da ripetere.");
    tap(2, 400);
    expect(editor.engine.text).toBe(drawn);
    tap(2, 60, 30);
    expect(editor.engine.text).toBe(drawn);
    editor.setGrid({ ...editor.grid, taps: false });
    tap(2);
    expect(editor.engine.text).toBe(drawn);
  });

  it("«Penna e dita…», da «Pagina e griglia», sceglie i gesti e la curva della penna, che preme con lei", async () => {
    const grids: unknown[] = [];
    mount(SOURCE, { onGridChange: (grid) => grids.push(grid) });
    size(200, 100);
    pageButton().click();
    entry("Penna e dita…").click();
    expect(dialog().querySelector("h2")!.textContent).toBe("Penna e dita");
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    const checks = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks.map((check) => [check.closest("label")!.textContent, check.checked])).toEqual([
      ["Due dita che ruotano girano il foglio", true],
      ["Un tocco di due dita annulla, uno di tre ripete", true],
      ["Tira il tratto con una corda: un tremito più corto della corda non lo muove", false],
    ]);
    expect(document.activeElement).toBe(checks[0]);
    checks[0]!.click();
    const soft = [...dialog().querySelectorAll<HTMLInputElement>('input[type="range"]')][0]!;
    expect(soft.closest("label")!.querySelector("span")!.textContent).toBe("Morbidezza");
    soft.value = "100";
    soft.dispatchEvent(new Event("input", { bubbles: true }));
    expect(soft.getAttribute("aria-valuetext")).toBe("+100%");
    await submit();
    expect(spoken()).toBe("Penna e dita aggiornate.");
    expect(editor.grid.twist).toBe(false);
    expect(editor.grid.taps).toBe(true);
    expect(editor.grid.pen).toEqual({ soft: 1, min: 0, full: 1 });
    // Lo stabilizzatore lasciato a zero resta spento.
    expect(editor.grid.steady).toEqual({ amount: 0, string: false });
    expect(grids[grids.length - 1]).toEqual(editor.grid);

    // Un ottavo della corsa, sulla curva più morbida, è metà pressione.
    const PEN = { pointerId: 5, pointerType: "pen" } as const;
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...PEN, button: 0, buttons: 1, pressure: 0.125, clientX: 10, clientY: 10, timeStamp: (clock += 8) }));
    for (const x of [20, 30, 40]) target.dispatchEvent(pointer("pointermove", { ...PEN, button: -1, buttons: 1, pressure: 0.125, clientX: x, clientY: 10, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointerup", { ...PEN, button: 0, buttons: 0, pressure: 0, clientX: 40, clientY: 10, timeStamp: (clock += 8) }));
    const ink = decodeInk(/fub:ink="([^"]+)"/.exec(editor.engine.text)![1]!);
    const width = ink.channels.length;
    const pressures = ink.values.filter((_, i) => i % width === ink.channels.indexOf("p"));
    expect(pressures.length).toBeGreaterThan(1);
    for (const p of pressures) expect(p).toBe(128);
  });
});

describe("il menu radiale", () => {
  const A = "o1a2b3c4d";
  const radial = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-radial:not([data-shell-motion='exit'])");
  /// Le voci, dall'alto in senso orario: il nome, o `-` per una spenta.
  const voices = (): string[] =>
    [...radial()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(
      (one) => `${one.dataset.direction} ${one.getAttribute("aria-label")}${one.getAttribute("aria-disabled") === "true" ? " -" : ""}`,
    );
  const voice = (label: string): HTMLButtonElement =>
    [...radial()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((one) => one.getAttribute("aria-label") === label)!;
  /// Il menu contestuale, sull'orologio dei puntatori delle prove: della
  /// penna, che col mouse apre il menu della selezione.
  const rightClick = (x: number, y: number, init: Init = {}): MouseEvent => {
    const event = pointer("contextmenu", { button: 2, pointerType: "pen", clientX: x, clientY: y, timeStamp: (clock += 8), ...init });
    surface().dispatchEvent(event);
    return event;
  };
  /// Le voci del menu contestuale aperto.
  const entries = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".context-menu [role^='menuitem']")];
  const onPage = (type: string, init: Init): void => {
    document.dispatchEvent(pointer(type, init));
  };

  beforeEach(() => setReducedMotionPreference(true));
  afterEach(() => {
    closeRadial();
    for (const open of document.querySelectorAll(".draw-radial")) open.remove();
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
    setReducedMotionPreference(false);
  });

  it("il clic destro con la penna lo apre: annulla in alto, gli strumenti di prima a destra, i colori a sinistra", () => {
    mount(SOURCE);
    size(200, 100);
    surface().focus();
    expect(rightClick(100, 50).defaultPrevented).toBe(true);
    expect(radial()!.querySelector('[role="menu"]')!.getAttribute("aria-label")).toBe("Menu radiale");
    // Chi non ha ancora cambiato strumento o colore trova i più comuni.
    expect(voices()).toEqual([
      "n Annulla -",
      "ne Selezione",
      "e Gomma",
      "se Evidenziatore",
      "s Ripeti -",
      "sw Colore: Verde",
      "w Colore: Blu",
      "nw Colore: Vermiglio",
    ]);
    expect(formatIssues(checkAccessibility(radial()!))).toBe("");
    voice("Gomma").click();
    expect(radial()).toBeNull();
    expect(editor.tool).toBe("eraser");
    expect(spoken()).toBe("Strumento: Gomma.");
    expect(document.activeElement).toBe(surface());

    rightClick(100, 50);
    expect(voices().slice(1, 4)).toEqual(["ne Selezione", "e Penna", "se Evidenziatore"]);
    voice("Colore: Blu").click();
    expect(spoken()).toBe("Colore: Blu.");
    editor.setTool("pen");
    expect(well().getAttribute("aria-label")).toBe("Colore: Blu");
    rightClick(100, 50);
    // Il colore e lo strumento di prima, in orizzontale: un gesto solo per
    // tornarci.
    expect(voices().slice(1, 4)).toEqual(["ne Selezione", "e Gomma", "se Evidenziatore"]);
    expect(voices().slice(5)).toEqual(["sw Colore: Verde", "w Colore: Nero", "nw Colore: Vermiglio"]);
  });

  it("i colori a sinistra sono i recenti che chi monta l'editor ricorda, senza quello di adesso", () => {
    /// Le voci a sinistra, quelle dei colori.
    const colors = (): string[] => voices().filter((each) => /^(sw|w|nw) /.test(each));
    mount(SOURCE, { colors: ["#3a7bd5", "#000000", "#cc79a7", "#56b4e9"] });
    size(200, 100);
    surface().focus();
    rightClick(100, 50);
    expect(colors()).toEqual(["sw Colore: Azzurro", "w Colore: Personalizzato #3a7bd5", "nw Colore: Porpora"]);
    voice("Colore: Personalizzato #3a7bd5").click();
    expect(spoken()).toBe("Colore: Personalizzato #3a7bd5.");
  });

  it("tenuto premuto segue il puntatore: lasciato verso una voce la sceglie, e non disegna", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = editor.engine.text;
    // Il menu sta intero nella finestra: aperto lontano dai bordi, il suo
    // centro è il punto del tocco lungo.
    const FINGER = { pointerId: 9, pointerType: "touch" } as const;
    surface().dispatchEvent(pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, pressure: 0.5, clientX: 400, clientY: 300, timeStamp: (clock += 8) }));
    rightClick(400, 300, { pointerType: "touch", buttons: 1 });
    expect(radial()).not.toBeNull();
    onPage("pointermove", { ...FINGER, button: -1, buttons: 1, pressure: 0.5, clientX: 410, clientY: 200, timeStamp: (clock += 8) });
    expect(voice("Annulla").hasAttribute("data-hot")).toBe(true);
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toMatch(/^Annulla · /);
    onPage("pointerup", { ...FINGER, button: 0, buttons: 0, pressure: 0, clientX: 410, clientY: 200, timeStamp: (clock += 8) });
    expect(radial()).toBeNull();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Tratto.");
    // Aperto senza il puntatore giù, il menu resta aperto.
    rightClick(100, 50);
    expect(radial()).not.toBeNull();
    voice("Ripeti").click();
    expect(editor.engine.text).toBe(drawn);
  });

  it("il tasto laterale della penna lo apre dov'è la penna; il clic destro che il sistema manda dopo non lo riapre", () => {
    mount(SOURCE);
    size(200, 100);
    const PEN = { pointerId: 6, pointerType: "pen" } as const;
    const down = pointer("pointerdown", { ...PEN, button: 2, buttons: 2, pressure: 0.3, clientX: 400, clientY: 300, timeStamp: (clock += 8) });
    surface().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(radial()).not.toBeNull();
    onPage("pointermove", { ...PEN, button: -1, buttons: 2, pressure: 0.3, clientX: 480, clientY: 310, timeStamp: (clock += 8) });
    onPage("pointerup", { ...PEN, button: 2, buttons: 0, pressure: 0, clientX: 480, clientY: 310, timeStamp: (clock += 8) });
    expect(editor.tool).toBe("eraser");
    expect(radial()).toBeNull();
    expect(rightClick(480, 310, { pointerType: "pen" }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("la penna girata cancella con qualunque strumento, e lo strumento resta", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    expect(editor.engine.text).not.toBe(SOURCE);
    const ERASER = { pointerId: 6, pointerType: "pen", button: 5, buttons: 32 } as const;
    drag([[25, 2], [25, 18]], ERASER);
    expect(editor.engine.text).toBe(SOURCE);
    expect(editor.tool).toBe("pen");
  });

  it("il tasto laterale fa ciò che si è scelto: la gomma o niente", () => {
    mount(SOURCE);
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = editor.engine.text;
    const BARREL = { pointerId: 6, pointerType: "pen", button: 2, buttons: 2 } as const;
    editor.setGrid({ ...editor.grid, barrel: "none" });
    drag([[25, 2], [25, 18]], BARREL);
    expect(radial()).toBeNull();
    expect(editor.engine.text).toBe(drawn);
    editor.setGrid({ ...editor.grid, barrel: "eraser" });
    drag([[25, 2], [25, 18]], BARREL);
    expect(editor.engine.text).toBe(SOURCE);
    expect(editor.tool).toBe("pen");
  });

  it("il tocco lungo del dito che disegna lo apre senza lasciare un punto; alzato nel mezzo, resta aperto", () => {
    mount(SOURCE);
    size(200, 100);
    const FINGER = { pointerId: 9, pointerType: "touch" } as const;
    surface().dispatchEvent(pointer("pointerdown", { ...FINGER, button: 0, buttons: 1, pressure: 0.5, clientX: 100, clientY: 50, timeStamp: (clock += 8) }));
    rightClick(100, 50, { pointerType: "touch", buttons: 1 });
    expect(radial()).not.toBeNull();
    onPage("pointerup", { ...FINGER, button: 0, buttons: 0, pressure: 0, clientX: 102, clientY: 51, timeStamp: (clock += 8) });
    expect(radial()).not.toBeNull();
    expect(editor.engine.text).toBe(SOURCE);
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(radial()).toBeNull();
    expect(document.activeElement).toBe(surface());
  });

  it("col mouse e con Maiusc+F10 si apre il menu del foglio, e il radiale è la sua ultima voce, col fuoco sulla prima voce che vale", () => {
    mount(SOURCE);
    size(200, 100);
    expect(rightClick(100, 50, { pointerType: "mouse" }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    expect(entries().map((one) => one.querySelector(".menu-label")!.textContent).slice(0, 2)).toEqual(["Incolla", "Incolla nello stesso punto"]);
    closeContextMenu();
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    const last = entries()[entries().length - 1]!;
    expect(last.querySelector(".menu-label")!.textContent).toBe("Menu radiale");
    last.click();
    expect(document.querySelector(".context-menu:not([data-shell-motion='exit'])")).toBeNull();
    expect(radial()).not.toBeNull();
    // Niente da annullare: il fuoco va alla prima voce che vale.
    expect(document.activeElement).toBe(voice("Selezione"));
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toBe("Selezione · V");
    key("ArrowRight", {}, document.activeElement as HTMLElement);
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toBe("Gomma · E");
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(surface());
    editor.select([A]);
    key("F10", { shiftKey: true });
    expect(radial()).toBeNull();
    expect(document.querySelector(".context-menu")).not.toBeNull();
    // Senza il menu della selezione Maiusc+F10 apre il radiale.
    closeContextMenu();
    editor.setWorkspace("simple");
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(radial()).not.toBeNull();
  });

  it("con gli strumenti che scelgono il clic destro resta quello di prima", () => {
    mount(SOURCE);
    size(200, 100);
    editor.setTool("select");
    rightClick(100, 50);
    expect(radial()).toBeNull();
    expect(document.querySelector(".context-menu")).not.toBeNull();
    closeContextMenu();
  });
});

describe("le tavole dei disegni che le hanno", () => {
  const SQUARE = "oa1a1a1a1";
  /// Due tavole 400 × 200, la seconda a 80 unità dalla prima, con un
  /// quadrato sopra.
  const BOARDS = doc(
    "<title>Ciclo</title>" +
      '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
      '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
      `${LAYER}<rect id="${SQUARE}" x="600" y="50" width="20" height="20" fill="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 1024 256"');

  const names = (): Array<[string | null, boolean]> =>
    [...host.querySelectorAll<HTMLElement>(".draw-sheet-name")].map((name) => [name.textContent, name.hasAttribute("data-chosen")]);
  /// Dove stanno le carte delle tavole sullo schermo.
  const sheets = (): string[] => [...host.querySelectorAll<HTMLElement>(".draw-sheets .draw-page")].map((sheet) => sheet.style.transform);

  it("dall'indice una tavola si sceglie e si inquadra, e la selezione resta", () => {
    mount(BOARDS);
    size(1000, 500);
    editor.select([SQUARE]);
    const before = sheets();
    expect(editor.reveal(BOARDS.indexOf('<view id="b9i0j1k2l"'))).toBe(true);
    expect(spoken()).toBe("Evaporazione, tavola 2 di 2, 400 × 200.");
    expect(sheets()).not.toEqual(before);
    expect(editor.selection).toEqual([SQUARE]);
    // Un oggetto si sceglie come sempre.
    editor.select([]);
    expect(editor.reveal(BOARDS.indexOf(`<rect id="${SQUARE}"`))).toBe(true);
    expect(editor.selection).toEqual([SQUARE]);
    // Il nome è dentro la tavola, e porta a lei; lo strumento Tavola la
    // trova scelta.
    expect(editor.reveal(BOARDS.indexOf("<title>Copertina"))).toBe(true);
    expect(spoken()).toBe("Copertina, tavola 1 di 2, 400 × 200.");
  });

  it("si vedono coi loro nomi, ma lo strumento, i suoi tasti e l'elenco non ci sono più (ADR 0231)", () => {
    mount(BOARDS);
    size(1000, 500);
    key("f");
    key("PageDown", { altKey: true });
    expect(editor.tool).toBe("pen");
    expect(spoken()).toBe("");
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", false]]);
    expect(host.querySelector('[role="toolbar"] button[aria-label="Tavole"]')).toBeNull();
  });
});

describe("«Esporta»: ciò che il disegno offre", () => {
  const SQUARE = "oa1a1a1a1";
  /// Due tavole, un quadrato con l'id e un triangolo senza.
  const SOURCE_EXPORT = doc(
    "<title>Ciclo</title>" +
      '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>' +
      '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
      '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>' +
      `${LAYER}<rect id="${SQUARE}" x="600" y="50" width="20" height="20" fill="#000000"/><path d="M10 10 L30 10 L30 30 Z" fill="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 1024 256"');
  const BOARDS_OFFERED = [
    { id: "b1a2b3c4d", name: "Copertina" },
    { id: "b9i0j1k2l", name: "Evaporazione" },
  ];

  it("senza selezione, le tavole nel loro ordine", () => {
    mount(SOURCE_EXPORT);
    expect(editor.exportScene()).toEqual({ scene: { selection: null, boards: BOARDS_OFFERED }, naming: null, named: 0 });
  });

  it("la selezione per id, col riquadro sui numeri interi, e gli id che mancano pronti in un passo che non è ancora scritto", () => {
    mount(SOURCE_EXPORT);
    key("a", { ctrlKey: true });
    const offer = editor.exportScene();
    const naming = offer.naming as { op: "batch"; ops: { op: string; path: number[]; tag: string; id: string }[] };
    expect(naming.op).toBe("batch");
    expect(naming.ops).toHaveLength(1);
    const [ident] = naming.ops;
    expect(ident).toMatchObject({ op: "ident", tag: "path" });
    expect(ident!.id).toMatch(/^o[0-9a-z]{8}$/);
    expect(offer.named).toBe(1);
    expect(offer.scene).toEqual({
      selection: { count: 2, ids: [SQUARE, ident!.id], box: [10, 10, 610, 60] },
      boards: BOARDS_OFFERED,
    });
    expect(editor.engine.text, "chiedere non scrive").toBe(SOURCE_EXPORT);
    // Il passo, se lo si fa, dà proprio quegli id, e si annulla.
    expect(editor.perform("draw.action.export_ids", offer.naming!)).toBe(true);
    expect(editor.engine.text).toContain(`<path id="${ident!.id}"`);
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE_EXPORT);
  });

  it("in sola lettura gli id non si danno: la selezione resta con quelli che ha", () => {
    mount(SOURCE_EXPORT);
    key("a", { ctrlKey: true });
    editor.setReadOnly(true);
    expect(editor.exportScene()).toEqual({
      scene: { selection: { count: 2, ids: [SQUARE], box: [10, 10, 610, 60] }, boards: BOARDS_OFFERED },
      naming: null,
      named: 0,
    });
  });
});

describe("le punte delle linee, nel Completo", () => {
  const L = "ol1l1l1l1";
  const LINE = doc(`${LAYER}<line id="${L}" x1="20" y1="40" x2="120" y2="40" stroke="#d55e00" stroke-width="2"/></g>`);
  const face = (id: string): HTMLButtonElement => property(id).querySelector<HTMLButtonElement>(".draw-properties-menu")!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  /// Apre il menu del campo `id` e ne preme la voce `label`.
  const pick = (id: string, label: string): void => {
    face(id).click();
    menu().find((entry) => labelOf(entry) === label)!.click();
  };
  const markers = (): string[] => [...editor.engine.text.matchAll(/<marker [^>]*>/g)].map((match) => match[0]);

  it("dal pannello una punta prende il colore della linea, e lo segue, ogni scelta in un passo col suo nome", () => {
    mount(LINE);
    editor.select([L]);
    key("Enter");
    expect(face("tipEnd").getAttribute("aria-label")).toBe("Punta di fine: Nessuna");
    pick("tipEnd", "Triangolo");
    expect(markers()).toEqual([expect.stringContaining('fub:marker="triangle medium end"')]);
    expect(editor.engine.text).toMatch(/<path d="[^"]+" fill="#d55e00"\/>/);
    expect(editor.engine.text).toMatch(new RegExp(`<line id="${L}" [^>]*marker-end="url\\(#r\\w+\\)"/>`));
    expect(face("tipEnd").getAttribute("aria-label")).toBe("Punta di fine: Triangolo, media");
    pick("tipEnd", "Grande");
    expect(markers()).toEqual([expect.stringContaining('fub:marker="triangle large end"')]);
    // Il contorno nuovo ricolora la punta nello stesso passo, e la punta
    // rossa, che nessuno usa più, se ne va.
    enter(propertyInput("stroke"), "#0072b2");
    expect(markers()).toHaveLength(1);
    expect(editor.engine.text).toMatch(/<path d="[^"]+" fill="#0072b2"\/>/);
    expect(editor.engine.text).not.toContain("#d55e00");
    editor.undo();
    expect(spoken()).toBe("Annullato: Colore del contorno.");
    expect(editor.engine.text).toMatch(/<path d="[^"]+" fill="#d55e00"\/>/);
    editor.undo();
    expect(spoken()).toBe("Annullato: Misura della punta.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Punta di fine.");
    expect(editor.engine.text).toBe(LINE);
  });

  it("«Scambia inizio e fine» porta la punta al capo opposto, e Esc chiude il menu tornando al pulsante", () => {
    mount(LINE);
    editor.select([L]);
    key("Enter");
    pick("tipStart", "Cerchio");
    pick("tipEnd", "Scambia inizio e fine");
    expect(markers()).toEqual([expect.stringContaining('fub:marker="circle medium end"')]);
    expect(editor.engine.text).not.toContain("marker-start");
    expect(face("tipStart").getAttribute("aria-label")).toBe("Punta d’inizio: Nessuna");
    expect(face("tipEnd").getAttribute("aria-label")).toBe("Punta di fine: Cerchio, media");
    face("tipEnd").focus();
    face("tipEnd").click();
    expect(face("tipEnd").getAttribute("aria-expanded")).toBe("true");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(face("tipEnd").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(face("tipEnd"));
    editor.undo();
    expect(spoken()).toBe("Annullato: Punte scambiate.");
  });
});

describe("la fusione e l'opacità", () => {
  const A = "oa1a1a1a1";
  const B = "ob1b1b1b1";
  const G = "og1g1g1g1";
  const SHEET = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="40" height="40" fill="#0072b2" opacity="0.5"/>`
      + `<rect id="${B}" x="50" y="0" width="40" height="40" fill="#d55e00"/>`
      + `<g id="${G}"><rect id="oc1c1c1c1" x="100" y="0" width="40" height="40" fill="#009e73"/></g></g>`,
  );

  const arrangeBar = (): HTMLElement => host.querySelector<HTMLElement>('.draw-arrange[aria-label="Disponi"]')!;
  const opacity = (): HTMLInputElement => arrangeBar().querySelector<HTMLInputElement>(".draw-arrange-input")!;
  const opacityLabel = (): HTMLElement => arrangeBar().querySelector<HTMLElement>(".draw-arrange-field")!;
  /// L'opacità scritta nell'elemento `id`, o `null` se non la scrive.
  const opacityOf = (id: string): string | null => new RegExp(`<(?:rect|g) id="${id}"[^>]*? opacity="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;
  const style = (id: string): string | null => new RegExp(`<(?:rect|g) id="${id}"[^>]*? style="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;
  /// Un tasto dentro il campo dell'opacità.
  const press = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, opacity());

  it("c'è nel Completo, nella barra «Disponi», col nome, il valore e i limiti; nel Semplice e senza selezione no", () => {
    mount(SHEET);
    expect(arrangeBar().hidden).toBe(true);
    editor.select([A]);
    expect(arrangeBar().hidden).toBe(false);
    expect(opacityLabel().hidden).toBe(false);
    expect(opacity().value).toBe("50");
    expect(opacity().getAttribute("role")).toBe("spinbutton");
    expect(opacity().getAttribute("aria-label")).toBe("Opacità");
    expect(opacityLabel().title).toBe("Opacità");
    expect([opacity().getAttribute("aria-valuemin"), opacity().getAttribute("aria-valuemax"), opacity().getAttribute("aria-valuenow"), opacity().getAttribute("aria-valuetext")]).toEqual(["0", "100", "50", "50%"]);
    expect(arrangeBar().querySelector(".draw-arrange-suffix")!.getAttribute("aria-hidden")).toBe("true");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un oggetto che non scrive l'opacità la ha piena.
    editor.select([B]);
    expect(opacity().value).toBe("100");
    // Di oggetti diversi il campo è vuoto, e lo dice.
    editor.select([A, B]);
    expect(opacity().value).toBe("");
    expect(opacity().placeholder).toBe("Misto");
    expect(opacity().getAttribute("aria-valuetext")).toBe("Misto");
    expect(opacity().hasAttribute("aria-valuenow")).toBe(false);
    editor.select([]);
    expect(arrangeBar().hidden).toBe(true);
    editor.setWorkspace("simple");
    editor.select([A]);
    expect(opacityLabel().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("un valore scritto e Invio cambiano l'opacità in un passo, «Opacità», che si annulla e si ripete", () => {
    mount(SHEET);
    editor.select([A]);
    typeIn(opacity(), "30");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(opacityOf(A)).toBe("0.3");
    expect(changes).toHaveLength(1);
    expect(opacity().value).toBe("30");
    expect(opacity().getAttribute("aria-valuenow")).toBe("30");
    editor.undo();
    expect(spoken()).toBe("Annullato: Opacità.");
    expect(editor.engine.text).toBe(SHEET);
    expect(opacity().value).toBe("50");
    editor.redo();
    expect(opacityOf(A)).toBe("0.3");
    // Anche con il segno e un calcolo, come nel pannello.
    typeIn(opacity(), "20+5%");
    press("Enter");
    expect(opacityOf(A)).toBe("0.25");
  });

  it("lasciare il campo scrive il numero; lo stesso numero non scrive niente", () => {
    mount(SHEET);
    editor.select([A]);
    typeIn(opacity(), "50");
    opacity().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(changes).toEqual([]);
    typeIn(opacity(), "80");
    opacity().blur();
    opacity().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(opacityOf(A)).toBe("0.8");
    expect(changes).toHaveLength(1);
  });

  it("le frecce, Pagina, Inizio e Fine la cambiano subito, fra 0 e 100, e i colpi di fila sono un passo", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(SHEET);
    editor.select([A]);
    opacity().focus();
    press("ArrowUp");
    press("ArrowUp");
    expect(opacityOf(A)).toBe("0.52");
    press("ArrowDown", { shiftKey: true });
    expect(opacityOf(A)).toBe("0.42");
    press("PageUp");
    expect(opacityOf(A)).toBe("0.52");
    press("PageDown");
    press("PageDown");
    expect(opacityOf(A)).toBe("0.32");
    expect(opacity().value).toBe("32");
    // Un passo solo: annulla riporta al principio.
    editor.undo();
    expect(editor.engine.text).toBe(SHEET);
    editor.redo();
    press("End");
    expect(opacity().value).toBe("100");
    expect(opacityOf(A)).toBeNull();
    const count = changes.length;
    press("ArrowUp");
    press("PageUp");
    press("End");
    expect(opacity().value).toBe("100");
    expect(changes).toHaveLength(count);
    press("Home");
    expect(opacityOf(A)).toBe("0");
    const zero = changes.length;
    press("ArrowDown");
    press("PageDown", { shiftKey: true });
    press("Home");
    expect(opacityOf(A)).toBe("0");
    expect(opacity().value).toBe("0");
    expect(changes).toHaveLength(zero);
    // Il tasto è del campo: non arriva al foglio, e la selezione non si sposta.
    expect(editor.engine.text).not.toContain("transform=");
  });

  it("un valore che non si legge lo dice e il campo torna com'era; Esc toglie il numero, e poi torna al foglio", () => {
    mount(SHEET);
    editor.select([A]);
    opacity().focus();
    typeIn(opacity(), "abc");
    press("Enter");
    expect(spoken()).toBe("Scrivi un numero o un calcolo, come 120+15.");
    expect(opacity().value).toBe("50");
    typeIn(opacity(), "5 px");
    press("Enter");
    expect(spoken()).toMatch(/^Qui valgono queste unità:/);
    expect(opacity().value).toBe("50");
    typeIn(opacity(), "");
    press("Enter");
    expect(opacity().value).toBe("50");
    expect(changes).toEqual([]);
    // Fuori da 0–100 il valore si ferma al limite.
    typeIn(opacity(), "250");
    press("Enter");
    expect(opacityOf(A)).toBeNull();
    // Esc, con un numero scritto, lo toglie e resta nel campo.
    typeIn(opacity(), "70");
    const first = press("Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(opacity().value).toBe("100");
    expect(document.activeElement).toBe(opacity());
    // Poi torna al foglio, come ogni barra.
    press("Escape");
    expect(document.activeElement).toBe(surface());
  });

  it("con opacità diverse le frecce dicono che sono diverse, e un numero le porta tutte allo stesso valore", () => {
    mount(SHEET);
    editor.select([A, B]);
    opacity().focus();
    press("ArrowUp");
    expect(spoken()).toBe("I valori sono diversi: scrivi quello da dare a tutti.");
    expect(changes).toEqual([]);
    typeIn(opacity(), "60");
    press("Enter");
    expect(opacityOf(A)).toBe("0.6");
    expect(opacityOf(B)).toBe("0.6");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHEET);
  });

  it("un gruppo prende l'opacità sul gruppo, e il campo segue la selezione senza perdere il fuoco", () => {
    mount(SHEET);
    editor.select([G]);
    opacity().focus();
    press("PageDown");
    expect(opacityOf(G)).toBe("0.9");
    expect(document.activeElement).toBe(opacity());
    // Cambiare la selezione ridice il valore; un numero a metà della stessa selezione resta.
    typeIn(opacity(), "4");
    editor.select([G]);
    expect(opacity().value).toBe("4");
    editor.select([A]);
    expect(opacity().value).toBe("50");
  });

  it("si raggiunge con le frecce dai pulsanti vicini, ha il suo Tab, e dentro le frecce sono sue", () => {
    mount(SHEET);
    editor.select([A]);
    const buttons = [...arrangeBar().querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden);
    // I pulsanti hanno un Tab solo fra loro; il campo ha il suo.
    expect(buttons.filter((control) => control.tabIndex === 0)).toHaveLength(1);
    expect(opacity().tabIndex).toBe(0);
    const last = buttons[buttons.length - 1]!;
    last.focus();
    key("ArrowRight", {}, last);
    expect(document.activeElement).toBe(opacity());
    // Dentro, le frecce sinistra e destra e Inizio e Fine non vanno ai pulsanti.
    key("ArrowLeft", {}, opacity());
    expect(document.activeElement).toBe(opacity());
    // Dall'altra parte, la freccia a sinistra dal primo pulsante arriva al campo.
    buttons[0]!.focus();
    key("ArrowLeft", {}, buttons[0]!);
    expect(document.activeElement).toBe(opacity());
    key("End", {}, last);
  });

  it("in un disegno che non si modifica non c'è", () => {
    mount(SHEET.replace(' fub:version="1"', ""));
    editor.select([A]);
    expect(arrangeBar().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  // --- La fusione nel pannello ----------------------------------------------

  const panelButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;

  it("«Fusione» non c'è più in nessuno spazio (ADR 0231)", () => {
    for (const workspace of ["simple", "full"] as const) {
      mount(SHEET, { workspace });
      editor.select([A]);
      panelButton().click();
      expect(host.querySelector('.draw-properties-field[data-field="blend"]')).toBeNull();
      expect(host.querySelector('.draw-properties-field[data-field="isolate"]')).toBeNull();
      owner.close();
      owner = openLifetime();
      host.replaceChildren();
    }
  });

  // --- Gli effetti: lo stile copiato, il contagocce, il riquadro -------------

  const SHADOW: Shadow = { kind: "shadow", dx: 0, dy: 4, blur: 8, color: "#000000", opacity: 0.25, hidden: false };
  /// Il filtro dell'ombra per un quadrato di 20 × 20 in (10, 10), e per uno di 40 × 40 in (230, 130).
  const filterFor = (id: string, x: number, y: number, side: number): string =>
    DEFS(written(filterElem(id, [SHADOW], { x: String(x - 14), y: String(y - 10), width: String(side + 28), height: String(side + 28) })));
  const FX = `filter="url(#rf1f1f1f1)" fub:effect="${writeEffects([SHADOW])}"`;
  /// A senza niente; B con un'ombra e una fusione, più in là.
  const LOOKS = doc(
    `${filterFor("rf1f1f1f1", 230, 130, 40)}${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/>`
      + `<rect id="${B}" x="230" y="130" width="40" height="40" fill="#e69f00" ${FX} style="mix-blend-mode: multiply"/></g>`,
  );

  it("lo stile copiato porta la fusione e gli effetti, nel Completo, e incollarli è un passo solo", () => {
    mount(LOOKS);
    editor.select([B]);
    key("c", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile copiato.");
    editor.select([A]);
    key("v", { ctrlKey: true, altKey: true });
    expect(spoken()).toBe("Stile incollato su 1 oggetto.");
    expect(style(A)).toBe("mix-blend-mode: multiply");
    expect(new RegExp(`<rect id="${A}"[^>]* fub:effect="shadow 0 4 8 #000000 0\\.25"`).test(editor.engine.text)).toBe(true);
    expect(editor.engine.text.match(/<filter /g)).toHaveLength(2);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(LOOKS);
    // E lo stile di un oggetto liscio toglie ombra e fusione a chi le ha.
    editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    editor.select([B]);
    key("v", { ctrlKey: true, altKey: true });
    expect(style(B)).toBeNull();
    expect(editor.engine.text).not.toContain("fub:effect");
    expect(editor.engine.text).not.toContain("<filter");
    editor.undo();
    expect(editor.engine.text).toBe(LOOKS);
  });

  /// Un rettangolo con l'ombra, e un gruppo spostato di 100 con un altro dentro.
  const SHADOWED = doc(
    `${filterFor("rf1f1f1f1", 10, 10, 20)}${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2" ${FX}/>`
      + `<g id="${G}" transform="translate(100 0)"><rect id="oc1c1c1c1" x="10" y="10" width="20" height="20" fill="#009e73" ${FX}/></g></g>`,
  );

  it("l'export della selezione conta l'ombra: quella di un oggetto, e quella di ciò che un gruppo porta, spostata come lui", () => {
    mount(SHADOWED);
    editor.select([A]);
    // L'ombra arriva 12 a sinistra e a destra, 8 sopra e 16 sotto.
    expect(editor.exportScene().scene.selection!.box).toEqual([-2, 2, 44, 44]);
    editor.select([G]);
    expect(editor.exportScene().scene.selection!.box).toEqual([98, 2, 44, 44]);
    editor.select([A, G]);
    expect(editor.exportScene().scene.selection!.box).toEqual([-2, 2, 144, 44]);
    // Senza effetti, il riquadro è quello della forma.
    editor.dispose();
    mount(doc(`${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/></g>`));
    editor.select([A]);
    expect(editor.exportScene().scene.selection!.box).toEqual([10, 10, 20, 20]);
  });

  it("«Adatta la pagina al disegno» comprende l'ombra, con il suo margine, in un passo che si annulla", () => {
    mount(SHADOWED);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!.click();
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.querySelector(".menu-label")!.textContent === "Adatta la pagina al disegno")!.click();
    // Da -2 a 142 e da 2 a 46, con 20 di margine.
    expect(editor.engine.text).toContain('viewBox="-22 -18 184 84"');
    expect(spoken()).toBe("Pagina adattata: 184 × 84.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHADOWED);
    for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  });
});

describe("i connettori del file", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const K = "ok3k3k3k3";
  const rect = (id: string, name: string, x: number, y: number): string =>
    `<rect id="${id}" x="${x}" y="${y}" width="60" height="40" fill="#e69f00"><title>${name}</title></rect>`;
  /// Alfa e Beta, e un connettore scritto prima della decisione 0231 dal
  /// lato destro di Alfa al sinistro di Beta.
  const LINKED = doc(
    `<title>Prova</title>${LAYER}${rect(A, "Alfa", 40, 60)}${rect(B, "Beta", 240, 60)}` +
      `<path id="${K}" fub:shape="connector" fub:geom="straight 100 80 240 80" fub:from="${A} right" fub:to="${B} left" d="M100 80 L240 80" fill="none" stroke="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 300"');
  const tag = (id: string): string => new RegExp(`<[a-zA-Z]+ id="${id}"[^>]*>`).exec(editor.engine.text)![0];
  const attr = (id: string, name: string): string | null => new RegExp(` ${name}="([^"]*)"`).exec(tag(id))?.[1] ?? null;
  const pointsOf = (id: string): Array<[number, number]> => {
    const all = attr(id, "fub:geom")!.split(" ").slice(1).map(Number);
    return Array.from({ length: all.length / 2 }, (_, i) => [all[2 * i]!, all[2 * i + 1]!]);
  };
  /// Il `d` che la geometria dritta di `id` detta.
  const dictated = (id: string): string => {
    const points = pointsOf(id).map(([x, y]) => `${x} ${y}`);
    return `M${points[0]} ${points.slice(1).map((each) => `L${each}`).join(" ")}`;
  };
  const painted = (id: string): SVGElement => host.querySelector<SVGElement>(`[data-scene-id="${id}"]`)!;

  it("seguono l'oggetto spostato col mouse, e un annulla riporta tutto com'era", () => {
    mount(LINKED);
    editor.setTool("select");
    const before = editor.engine.text;
    const resting = attr(K, "d");
    const target = surface();
    const at = (type: string, x: number, y: number, held = 1): void =>
      void target.dispatchEvent(pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons: held, pressure: held === 1 ? 0.5 : 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
    at("pointerdown", 60, 90);
    at("pointermove", 65, 110);
    at("pointermove", 60, 130);
    // Mentre si trascina, la linea segue l'oggetto sul foglio.
    expect(painted(K).getAttribute("d")).not.toBe(resting);
    expect(attr(K, "d")).toBe(resting);
    at("pointerup", 60, 130, 0);
    expect(attr(A, "transform")).toBe("matrix(1 0 0 1 0 40)");
    expect(attr(K, "fub:from")).toBe(`${A} right`);
    expect(pointsOf(K)[0]).toEqual([100, 120]);
    expect(attr(K, "d")).toBe(dictated(K));
    expect(painted(K).getAttribute("d")).toBe(attr(K, "d"));
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("e quello spostato con le frecce, in un passo solo", () => {
    mount(LINKED);
    const before = editor.engine.text;
    editor.select([B]);
    key("ArrowDown", { shiftKey: true });
    expect(attr(B, "transform")).toBe("matrix(1 0 0 1 0 10)");
    const points = pointsOf(K);
    expect(points[points.length - 1]).toEqual([240, 90]);
    expect(attr(K, "d")).toBe(dictated(K));
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("l'oggetto eliminato lascia il connettore con l'ultima geometria e il capo libero", () => {
    mount(LINKED);
    const before = editor.engine.text;
    editor.select([B]);
    key("Delete");
    expect(editor.engine.text).not.toContain(`id="${B}"`);
    expect(attr(K, "fub:to")).toBeNull();
    expect(attr(K, "fub:from")).toBe(`${A} right`);
    expect(attr(K, "fub:geom")).toBe("straight 100 80 240 80");
    expect(attr(K, "d")).toBe("M100 80 L240 80");
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("lo strumento, il tasto X e la sezione delle proprietà non ci sono più (ADR 0231)", () => {
    mount(LINKED);
    key("x");
    expect(editor.tool).toBe("pen");
    expect(railTool("Connettore").hidden).toBe(true);
  });
});

describe("lo spazio di lavoro e la colonna personalizzata", () => {
  /// La voce `label` del menu aperto per ultimo.
  const menuEntry = (label: string): HTMLButtonElement => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.querySelector(".menu-label")?.textContent === label)!;
  };
  const openMenu = (): void => host.querySelector<HTMLButtonElement>('.draw-top button[aria-label="Disegno"]')!.click();
  const fullButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-rail-full")!;
  const rail = (): HTMLElement => host.querySelector<HTMLElement>(".draw-rail .kit-rail")!;
  const custom = (): HTMLElement => document.querySelector<HTMLElement>(".draw-toolbar-dialog")!;
  const action = (id: string): HTMLButtonElement => custom().querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
  const rows = (): string[] => [...custom().querySelectorAll(".draw-toolbar-row")].map((row) => (row as HTMLElement).dataset.tool!);
  const row = (tool: string): HTMLElement => custom().querySelector<HTMLElement>(`.draw-toolbar-row[data-tool="${tool}"]`)!;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  afterEach(() => closeContextMenu());

  it("il Semplice offre gli strumenti per disegnare a mano, con caselle grandi, e «Completo» è a un clic", () => {
    const onWorkspace = vi.fn();
    mount(SOURCE, { workspace: "simple", onWorkspace });
    expect(host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("simple");
    expect(rail().dataset.size).toBe("large");
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
    expect(fullButton().hidden).toBe(false);

    fullButton().click();
    expect(onWorkspace).toHaveBeenLastCalledWith("full");
    expect(host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("full");
    expect(rail().dataset.size).toBe("normal");
    expect(fullButton().hidden).toBe(true);
    expect(spoken()).toContain("Completo");
  });

  it("il menu del disegno sceglie lo spazio, e chi monta lo cambia dal vivo", async () => {
    const onWorkspace = vi.fn();
    mount(SOURCE, { workspace: "full", onWorkspace });
    expect(host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("full");
    openMenu();
    menuEntry("Spazio di lavoro").click();
    await settle();
    const simple = menuEntry("Semplice");
    expect(simple.getAttribute("role")).toBe("menuitemradio");
    expect(simple.getAttribute("aria-checked")).toBe("false");
    simple.click();
    expect(onWorkspace).toHaveBeenLastCalledWith("simple");

    // Dall'esterno (un'altra finestra ha cambiato l'impostazione): niente
    // richiamo, perché la scelta è già ricordata.
    onWorkspace.mockClear();
    editor.setWorkspace("full", ["select", "rect", "pen"]);
    expect(railNames()).toEqual(["Selezione", "Rettangolo", "Penna"]);
    expect(onWorkspace).not.toHaveBeenCalled();
  });

  it("nel Semplice «Mostra tutto» aggiunge i tasti di Completo e dice dove si sceglie; in Completo non manca niente", async () => {
    mount(SOURCE, { workspace: "simple" });
    key("?", { shiftKey: true });
    const extra = dialog().querySelector<HTMLElement>(".keys-more")!;
    dialog().querySelector<HTMLButtonElement>(".keys-show-all")!.click();
    expect(extra.querySelector(".keys-note")!.textContent).toBe(
      "I tasti qui sotto sono dello spazio «Completo», che si sceglie dal menu «Disegno» o col pulsante in fondo alla colonna.",
    );
    const captions = [...extra.querySelectorAll("caption")].map((caption) => caption.textContent);
    // Gli strumenti sono gli stessi nei due spazi (ADR 0231): manca ciò che
    // si fa con gli oggetti.
    expect(captions[0]).toBe("Oggetti");
    expect(captions.some((caption) => caption!.includes("livello")), "niente livelli").toBe(false);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await settle();

    editor.setWorkspace("full");
    key("?", { shiftKey: true });
    expect(dialog().querySelector<HTMLElement>(".keys-show-all")?.hidden ?? true, "in Completo non c'è altro").toBe(true);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    await settle();
  });

  it("una colonna personalizzata mette i suoi strumenti, nel suo ordine; gli altri restano nei tasti", () => {
    mount(SOURCE, { workspace: "full", toolbar: ["select", "ellipse", "pen", "domani" as never] });
    expect(railNames()).toEqual(["Selezione", "Ellisse", "Penna"]);
    // Senza la Selezione, la colonna la mette in cima.
    editor.setWorkspace("full", ["rect", "pen"]);
    expect(railNames()).toEqual(["Selezione", "Rettangolo", "Penna"]);
    key("o");
    expect(editor.tool).toBe("ellipse");
  });

  it("«Personalizza la barra…» sposta, toglie, rimette di serie e salva; Annulla rimette com'era", async () => {
    const onToolbar = vi.fn();
    mount(SOURCE, { workspace: "full", onToolbar });
    const standard = railNames();
    openMenu();
    menuEntry("Personalizza la barra…").click();
    expect(formatIssues(checkAccessibility(custom()))).toBe("");
    expect(rows()[0]).toBe("select");
    expect(row("select").querySelector<HTMLInputElement>("input")!.disabled, "la Selezione resta").toBe(true);

    // Giù la Selezione, via la Mano: la colonna cambia mentre si sceglie.
    row("select").querySelectorAll<HTMLButtonElement>(".draw-toolbar-move")[1]!.click();
    expect(rows().slice(0, 2)).toEqual(["hand", "select"]);
    expect(railNames().slice(0, 2)).toEqual(["Mano", "Selezione"]);
    const hand = row("hand").querySelector<HTMLInputElement>("input")!;
    hand.click();
    expect(railNames().slice(0, 2)).toEqual(["Selezione", "Zoom"]);
    expect(railNames()).not.toContain("Mano");

    // Annulla: com'era, e niente salvato.
    action("cancel").click();
    await settle();
    expect(railNames()).toEqual(standard);
    expect(onToolbar).not.toHaveBeenCalled();

    // Di nuovo, poi Salva.
    openMenu();
    menuEntry("Personalizza la barra…").click();
    row("hand").querySelector<HTMLInputElement>("input")!.click();
    action("save").click();
    await settle();
    expect(onToolbar).toHaveBeenCalledTimes(1);
    expect(onToolbar.mock.calls[0]![0]).not.toContain("hand");
    expect(railNames()).not.toContain("Mano");

    // «Ripristina» torna alla colonna di serie, che si salva vuota.
    openMenu();
    menuEntry("Personalizza la barra…").click();
    custom().querySelector<HTMLButtonElement>(".draw-toolbar-reset")!.click();
    expect(railNames()).toEqual(standard);
    action("save").click();
    await settle();
    expect(onToolbar).toHaveBeenLastCalledWith([]);
  });
});
