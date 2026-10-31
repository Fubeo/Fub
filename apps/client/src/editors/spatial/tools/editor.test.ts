// @vitest-environment happy-dom
// L'editor del disegno, dal puntatore al testo: ogni strumento produce le
// operazioni attese, annulla e ripeti le disfano, e chi non vede sente che
// cosa è successo.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID } from "./grid";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { applyOperation } from "../../core/text-operation";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { displayBinding } from "../../../ui/commands";
import { SHELL_KEYS } from "../../../ui/shell-keys.generated";
import { decodeInk } from "../ink/codec";
import { polygonalAttrs, readPolygonal } from "../scene/parametric";
import { SceneEngine } from "../scene/engine";
import type { Op } from "../scene/ops";
import { readScene } from "../scene/read";
import { transform as parseTransform } from "../scene/values";
import { doc } from "../scene/test-support";
import { filterElem, writeEffects, type Shadow } from "./effects";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions, type DrawImages, type DrawPlace } from "./editor";
import { MERGE_MS } from "./history";
import { blockMiddle } from "./labels";
import { textRich } from "./look";
import type { Decoded, EncodeType, ImageCodec } from "./images";
import { rasterize } from "./png";
import { appearance, LAYER } from "./test-support";
import { DEFS, markersIn, tipOf, written } from "./tip-support";
import { DEFAULT_CURVE } from "../../../ink/input/pressure";
import { closeRadial } from "./radial";
import { FEATURES } from "./registry";
import { loadWriting } from "./writing";
import type { ProofPorts } from "../../core/proof-ports";
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

/// Mette `value` al posto di tutto il testo del campo di Scrittura `field`,
/// come il browser quando sostituisce la scelta.
function replaceAll(field: HTMLElement, value: string): void {
  const range = document.createRange();
  range.selectNodeContents(field);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: value }));
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

// Scrittura arriva prima dei testi, come dopo il montaggio del disegno.
beforeAll(async () => {
  await loadWriting();
});

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
    // Ciò che il livello Standard aggiunge c'è, nascosto.
    const groups = [...toolbar.querySelectorAll(".draw-group:not([hidden])")].map((group) => [group.getAttribute("role"), group.getAttribute("aria-label")]);
    expect(groups).toEqual([
      ["group", "Colore"],
      ["radiogroup", "Spessore"],
      ["group", "Modifica"],
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
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Penna", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
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
    mount(SOURCE, { level: "standard" });
    drag(shaky);
    const raw = pathOf();
    editor.dispose();
    mount(SOURCE, { level: "standard", grid: { ...DEFAULT_GRID, steady: { amount: 1, string: true } } });
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

describe("il livello Standard", () => {
  /// Se il selettore sceglie un colore qualunque, o soltanto i campioni.
  const free = (): boolean => {
    const open = picker().querySelector(".kit-color-input") !== null;
    well().click();
    return open;
  };
  const widths = (): string[] =>
    [...host.querySelectorAll<HTMLElement>(".draw-width")].map((control) => `${control.querySelector<HTMLElement>(".draw-width-bar")!.style.getPropertyValue("--draw-width")}${control.getAttribute("aria-checked") === "true" ? "*" : ""}`);

  it("aggiunge l'evidenziatore dopo la penna e un colore qualunque, e il livello cambia dal vivo", () => {
    mount();
    expect(railNames()).not.toContain("Evidenziatore");
    expect(free()).toBe(false);
    key("q");
    expect(editor.tool).toBe("pen");

    editor.select(["o1a2b3c4d"]);
    editor.setLevel("standard");
    expect(editor.level).toBe("standard");
    expect(railNames()).toEqual(["Selezione", "Lazo", "Mano", "Zoom", "Tavola", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Poligono", "Linea", "Freccia", "Connettore", "Testo", "Contagocce", "Sfumatura"]);
    expect(free()).toBe(true);
    expect(railTool("Evidenziatore").title).toBe("Evidenziatore (Shift+P)");
    editor.setTool("highlighter");
    const highlighter = host.querySelector<HTMLButtonElement>('.draw-rail [data-tool="highlighter"]')!;
    highlighter.focus();
    expect(document.getElementById(highlighter.getAttribute("aria-describedby")!)?.textContent).toContain("spessore costante");
    editor.setTool("pen");
    // Il documento, la selezione e la cronologia restano.
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");

    key("P", { shiftKey: true });
    expect(editor.tool).toBe("highlighter");
    // Tornati all'Essenziale, l'evidenziatore non c'è più: si riparte dalla penna.
    editor.setLevel("essential");
    expect(editor.tool).toBe("pen");
    expect(railNames()).not.toContain("Evidenziatore");
    expect(changes).toEqual([]);
  });

  it("l'evidenziatore scrive un tratto giallo, largo e trasparente, che si annulla col suo nome", () => {
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
    typeColor("#0072B2");
    expect(editor.color).toBe("#0072b2");
    expect(spoken()).toBe("Colore: Blu.");
    expect(well().getAttribute("aria-label")).toBe("Colore: Blu");
    typeColor("rosso");
    expect(editor.color).toBe("#0072b2");
    expect(picker().querySelector(".kit-color-input")!.getAttribute("aria-invalid")).toBe("true");
    well().click();
  });

  it("sotto lo Standard il colore a piacere non c'è: si torna al nero", () => {
    mount(SOURCE, { level: "standard" });
    editor.setColor("#3a7bd5");
    editor.setLevel("essential");
    expect(editor.color).toBe("#000000");
    expect(well().getAttribute("aria-label")).toBe("Colore: Nero");
    // All'Essenziale un colore fuori dalla tavolozza non si sceglie, e il
    // selettore ha soltanto i consigliati.
    editor.setColor("#3a7bd5");
    expect(editor.color).toBe("#000000");
    expect(pickerGroups().map((group) => group[0])).toEqual(["Consigliati"]);
    well().click();
    editor.setLevel("standard");
    expect(pickerGroups().map((group) => group[0])).toEqual(["Consigliati", "Recenti"]);
    well().click();
  });
});

describe("disporre, dal livello Standard", () => {
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
    mount(ROW, { level: "standard" });
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
    editor.setLevel("standard");
    editor.select([A]);
    expect(extra()).toEqual([]);
    expect(shown().length).toBeLessThanOrEqual(6);
    expect(more.hidden).toBe(true);
  });

  it("accanto alla selezione non si vede durante lo zoom con la rotella, e torna quando la rotella tace", async () => {
    mount(ROW, { level: "standard" });
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

  it("la barra della selezione c'è dal livello Standard, con qualcosa di scelto; Alt+F10 ci va ed Esc torna al foglio", () => {
    mount(ROW);
    editor.select([A]);
    expect(bar().hidden).toBe(true);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(false);

    editor.setLevel("standard");
    expect(bar().hidden).toBe(false);
    expect(bar().getAttribute("role")).toBe("toolbar");
    expect(bar().getAttribute("aria-label")).toBe("Disponi");
    // «Sposta in un livello» non serve con un livello solo, che ha già tutto;
    // «Modifica il testo» scrive l'etichetta della forma chiusa.
    expect([...bar().querySelectorAll("button:not([hidden])")].map((control) => control.getAttribute("aria-label"))).toEqual([
      "Modifica il testo",
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
    expect(document.activeElement).toBe(named("Modifica il testo"));
    key("ArrowRight", {}, named("Modifica il testo"));
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
    editor.setLevel("essential");
    expect(bar().hidden).toBe(true);
    expect(hint?.textContent).not.toContain("Alt+F10");
    expect(changes).toEqual([]);
  });

  it("Ctrl+D copia sopra l'originale, un passo più in là, e la selezione passa alla copia", () => {
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(doc(`${LAYER}<g id="og1g1g1g1">${"<rect id=\"oa1a1a1a1\" x=\"0\" y=\"0\" width=\"5\" height=\"5\"/>"}<rect id="ob2b2b2b2" x="10" y="0" width="5" height="5"/></g></g>`), { level: "standard" });
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
    mount(source, { level: "standard" });
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
    mount(source, { level: "standard" });
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
    mount(doc(`${LAYER}<g id="og1g1g1g1"><rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`), { level: "standard" });
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    expect(key("g", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    editor.select(["og1g1g1g1"]);
    host.querySelector<HTMLButtonElement>(`[aria-controls="${properties().id}"]`)!.click();
    expect(key("g", { ctrlKey: true, shiftKey: true }, properties()).defaultPrevented).toBe(true);
    expect(spoken()).toBe("1 gruppo separato.");
    // All'Essenziale non si raggruppa: i tasti restano a chi li aveva.
    editor.setLevel("essential");
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("non raggruppa né riordina ciò a cui il foglio di stile del disegno darebbe uno stile che non si può togliere, e dice perché", () => {
    const source = doc(`<style>g g rect{fill:#d55e00}rect:last-child{stroke:#000}</style>${LAYER}<rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g>`);
    mount(source, { level: "standard" });
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
    mount(source, { level: "standard" });
    editor.select(["m"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non separato: il foglio di stile del disegno ha uno stile che dipende da dove si guarda il disegno, «@media (prefers-color-scheme: dark)», e l’aspetto potrebbe cambiare.");
  });

  it("un foglio di stile che sceglie per classe, come quelli di Illustrator, lascia separare", () => {
    mount(doc(`<style>.st0{fill:#d55e00}</style>${LAYER}<g id="og1g1g1g1"><rect id="${A}" class="st0" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`), { level: "standard" });
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
    mount(source, { level: "standard" });
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
    mount(ROW, { level: "standard" });
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
    mount(ROW, { level: "standard", links });
    editor.select([A, B]);
    expect(shown()).toEqual(["Duplica", "Raggruppa", "Separa", "Collega a una nota…", "Ordine", "Allinea e distribuisci", "Collega le forme scelte"]);
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
    mount(LINKED, { level: "standard", links });
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
    mount(LINKED, { level: "standard", links });
    editor.select([L, B]);
    expect(named("Collega a una nota…")!.disabled).toBe(true);
    key("k", { ctrlKey: true });
    expect(spoken()).toContain("Non collegato");
    expect(links.choose).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it("una scelta lasciata a metà, o che non riesce, non cambia niente; una seconda non parte finché c'è la prima", async () => {
    const empty = stub(null);
    mount(ROW, { level: "standard", links: empty });
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
    mount(ROW, { level: "standard", links: failing });
    editor.select([A]);
    key("k", { ctrlKey: true });
    await settle();
    expect(failing.choose).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
  });

  it("mentre si sceglie la nota, valgono gli oggetti scelti alla fine", async () => {
    let answer: (href: string | null) => void = () => {};
    const links = { choose: vi.fn(() => new Promise<string | null>((resolve) => (answer = resolve))), open: vi.fn() };
    mount(ROW, { level: "standard", links });
    editor.select([A, B]);
    key("k", { ctrlKey: true });
    editor.select([B]);
    answer("c.md");
    await settle();
    expect(editor.engine.text).toMatch(new RegExp(`${RECT_A}\\s*<a id="${editor.selection[0]}" href="c.md">\\s*${RECT_B}\\s*</a>`));
  });

  it("Ctrl+Maiusc+K toglie i collegamenti scelti e lascia gli oggetti dov'erano, anche senza chi sceglie le note", () => {
    mount(LINKED, { level: "standard" });
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
    // Anche al livello Essenziale, e anche dentro un gruppo; un indirizzo
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
      "Livello «Livello 1»",
      "Rettangolo, Nero",
      "Collegamento a «Ciclo dell'acqua», 1 oggetto",
    ]);
  });

  it("«?» elenca i tasti dei collegamenti", () => {
    mount(ROW, { level: "standard", links: stub() });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+K", "Collega a una nota, o cambia il collegamento scelto"]);
    expect(rows).toContainEqual(["Ctrl+Shift+K", "Togli il collegamento"]);
    expect(rows).toContainEqual(["Alt+Enter", "Apre la nota del collegamento scelto"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("i livelli, dal livello Standard", () => {
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

  it("il pulsante c'è dal livello Standard e dice dove si disegna; il menu sceglie il livello corrente", () => {
    mount(TWO);
    expect(layers().closest("[hidden]")).not.toBeNull();
    editor.setLevel("standard");
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
    // All'Essenziale si disegna nel più alto, come sempre.
    editor.setLevel("essential");
    drag([[60, 60], [90, 80]]);
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${B}"[^>]*/>\\s*<rect id="o[a-z0-9]{8}"[^>]*/>\\s*</g>\\s*</svg>`));
  });

  it("scegliere oggetti di un livello solo lo rende corrente, e l'albero lo dice", () => {
    mount(TWO, { level: "standard" });
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
    editor.setLevel("essential");
    expect(labels()).toEqual(["Livello «Note»", "Rettangolo, Nero", "Livello «Sfondo»", "Rettangolo, Blu"]);
  });

  it("un livello nuovo sopra quello corrente, rinominato, nascosto e mostrato: un passo di annulla ciascuno", async () => {
    mount(TWO, { level: "standard" });
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
    mount(TWO, { level: "standard" });
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
    mount(TWO, { level: "standard" });
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
    mount(scaled, { level: "standard" });
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
    mount(source, { level: "standard" });
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

describe("la griglia e la pagina, dal livello Standard", () => {
  /// La griglia con l'aggancio acceso, al passo di partenza.
  const SNAP = { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } as const;
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

  it("«Pagina e griglia» c'è dal livello Standard; la griglia si vede sopra la carta, e chi monta l'editor lo sa", () => {
    const grids: unknown[] = [];
    mount(SOURCE, { onGridChange: (grid) => grids.push(grid) });
    size(200, 100);
    expect(pageButton().hidden).toBe(true);
    expect(lines().style.display).toBe("none");
    editor.setLevel("standard");
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
      ["menuitemcheckbox", "Guide intelligenti", "true", null],
      ["menuitemcheckbox", "Forme dal tratto", "true", null],
      ["menuitemcheckbox", "Mostra i righelli", "false", "Shift+R"],
      ["menuitemcheckbox", "Mostra le guide", "true", "|"],
      ["menuitem", "Guide…", null, null],
      ["menuitem", "Unità: Pixel…", null, null],
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
    expect(editor.grid).toEqual({ shown: true, snap: true, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(grids).toEqual([
      { shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: false, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: true, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
    ]);

    // Sotto lo Standard non si vede e non aggancia, ma resta com'era.
    editor.setLevel("essential");
    expect(lines().style.display).toBe("none");
    expect(editor.grid.shown).toBe(true);
    editor.setLevel("standard");
    expect(lines().style.display).toBe("");
    // La griglia non entra nel file.
    expect(changes).toEqual([]);
  });

  it("`setGrid` la cambia senza dirlo; un passo fuori dai limiti resta quello di prima, e uno insolito entra nel menu", () => {
    const grids: unknown[] = [];
    mount(SOURCE, { level: "standard", grid: { shown: true, snap: false, step: 0, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE }, onGridChange: (grid) => grids.push(grid) });
    expect(editor.grid).toEqual({ shown: true, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    editor.setGrid({ shown: true, snap: true, step: 25, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    editor.setGrid({ shown: false, snap: true, step: 5000, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 25, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
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

  it("«#» la mostra e «%» aggancia, anche con AltGr; con Ctrl e sotto lo Standard no", () => {
    mount(SOURCE, { level: "standard" });
    expect(key("#", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Griglia visibile.");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Aggancio alla griglia acceso.");
    expect(altGraph("#").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Griglia nascosta.");
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(key("#", { ctrlKey: true }).defaultPrevented).toBe(false);
    editor.setLevel("essential");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    // Nel titolo si scrivono.
    editor.setLevel("standard");
    const title = host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(key("#", { shiftKey: true }, title).defaultPrevented).toBe(false);
    expect(editor.grid.shown).toBe(false);
  });

  it("una forma va da un incrocio all'altro; tenendo Ctrl si posa libera", () => {
    mount(doc(`${LAYER}</g>`), { level: "standard", grid: SNAP });
    editor.setTool("rect");
    drag([[13, 17], [30, 40], [59, 61]]);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="20" y="20" width="40" height="40" fill="none"/);
    drag([[13, 17], [30, 40], [59, 61]], { ctrlKey: true });
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="13" y="17" width="46" height="44" fill="none"/);
    // All'Essenziale non si aggancia.
    editor.setLevel("essential");
    drag([[113, 117], [159, 161]]);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="113" y="117" width="46" height="44" fill="none"/);
  });

  it("trascinare porta sull'incrocio più vicino l'angolo della geometria vicino al punto preso, contorno escluso", () => {
    mount(SOURCE, { level: "standard", grid: SNAP });
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
    mount(OFF, { level: "standard", grid: SNAP });
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
    mount(doc(`${LAYER}<rect id="${A}" x="0" y="0" width="50" height="10" fill="#000000"/></g>`), { level: "standard", grid: SNAP });
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
    mount(SOURCE, { level: "standard", grid: SNAP });
    editor.select(["o1a2b3c4d"]);
    key("ArrowRight", { ctrlKey: true });
    // Da 60–80 a 60–100: il contorno di 2 si allarga con la forma.
    expect(editor.engine.text).toContain('transform="matrix(2 0 0 1 -60 0)"');
    expect(spoken()).toBe("Misure: 44 × 22.");
  });

  it("il cursore va di incrocio in incrocio; con Ctrl resta libero", () => {
    mount(SOURCE, { level: "standard", grid: SNAP });
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
    mount(OFF, { level: "standard", grid: SNAP });
    editor.select([A]);
    key("d", { ctrlKey: true });
    const [copy] = editor.selection;
    expect(editor.engine.text).toContain(`<rect id="${copy}" x="13" y="7" width="40" height="40" fill="#000000" transform="matrix(1 0 0 1 40 40)"/>`);
  });

  it("«Adatta la pagina» la porta attorno al disegno con un margine, in un passo che si annulla", () => {
    mount(SOURCE, { level: "standard" });
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
      { level: "standard" },
    );
    choose("Adatta la pagina al disegno");
    expect(editor.engine.text).toContain('viewBox="-70 -70 300 110"');
    expect(spoken()).toBe("Pagina adattata: 300 × 110.");
  });

  it("un disegno vuoto non ha una pagina da adattare, e lo dice", () => {
    mount(doc(`${LAYER}</g>`), { level: "standard" });
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
      { level: "standard" },
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
    mount(SOURCE, { level: "standard" });
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

describe("le guide intelligenti, dal livello Standard", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  /// Un disegno in una pagina larga, perché i suoi bordi e il suo centro
  /// restino lontani da ciò che si sposta.
  const wide = (body: string): string => doc(`<title>Prova</title>${body}`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');
  /// Un quadrato blu da spostare, da (20, 200) a (60, 240), e un rettangolo
  /// arancione, da (200, 50) a (260, 80).
  const APART = wide(
    `${LAYER}<rect id="${A}" x="20" y="200" width="40" height="40" fill="#0072b2"/><rect id="${B}" x="200" y="50" width="60" height="30" fill="#e69f00"/></g>`,
  );
  /// Il quadrato blu, e due quadrati in fila a 60 l'uno dall'altro.
  const ROW = wide(
    `${LAYER}<rect id="${A}" x="20" y="300" width="40" height="40" fill="#0072b2"/>` +
      `<rect id="${B}" x="100" y="100" width="40" height="40" fill="#e69f00"/><rect id="${C}" x="200" y="100" width="40" height="40" fill="#009e73"/></g>`,
  );

  const transformOf = (id: string): string | null => editor.engine.text.match(new RegExp(`id="${id}"[^>]*? transform="([^"]*)"`))?.[1] ?? null;
  const hover = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const pageButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const entry = (label: string): HTMLButtonElement => menu().find((one) => labelOf(one) === label)!;

  // Un menu rimasto aperto va chiuso davvero: tolto e basta, terrebbe il
  // fuoco anche nella prova dopo.
  afterEach(() => {
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("spostando, un bordo si ferma in linea con quello di un altro oggetto, e lo si dice; Ctrl o ⌘ lascia libero, e le frecce non agganciano", () => {
    mount(APART, { level: "standard" });
    editor.setTool("select");
    // Il bordo in alto arriva a 53, a 3 da quello del rettangolo: ci va sopra.
    drag([[40, 220], [41, 150], [43, 73]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 3 -150)");
    expect(spoken()).toBe("1 oggetto spostato. Agganciato: il bordo superiore in linea con quello di Rettangolo, Arancione.");
    editor.undo();
    drag([[40, 220], [41, 150], [43, 73]], { ctrlKey: true });
    expect(transformOf(A)).toBe("matrix(1 0 0 1 3 -147)");
    expect(spoken()).toBe("1 oggetto spostato.");
    key("ArrowUp");
    expect(transformOf(A)).toBe("matrix(1 0 0 1 3 -148)");
  });

  it("spostando, si ferma alla distanza che c'è fra due oggetti della fila, e mentre si trascina la mostra", () => {
    const layer = recording();
    mount(ROW, { level: "standard" });
    editor.setTool("select");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 40, clientY: 320, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 323, clientY: 122, timeStamp: (clock += 8) }));
    layer.frame();
    // Le due distanze uguali; quella dal quadrato in linea non si ripete.
    expect(layer.texts()).toEqual(["60", "60"]);
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 323, clientY: 122, timeStamp: (clock += 8) }));
    layer.frame();
    // Fermo, sotto la selezione restano le sue misure.
    expect(layer.texts()).toEqual(["40 × 40"]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 280 -200)");
    expect(spoken()).toBe("1 oggetto spostato. Agganciato: a distanze uguali in orizzontale, 60; il bordo superiore in linea con quello di Rettangolo, Verde.");
  });

  it("con la griglia vince il più vicino fra la riga e il bersaglio", () => {
    mount(APART, { level: "standard", grid: { shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    editor.setTool("select");
    // In alto a 53: il bordo del rettangolo, a 50, è più vicino della riga a 60.
    drag([[40, 220], [41, 150], [43, 73]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 0 -150)");
    editor.undo();
    // A 56 la riga è più vicina.
    drag([[40, 220], [41, 150], [43, 76]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 0 -140)");
  });

  it("si allineano agli oggetti dei livelli bloccati, non a quelli dei livelli nascosti", () => {
    mount(
      wide(
        `<g id="l1" fub:layer="Sfondo" fub:locked="true"><rect id="${B}" x="200" y="50" width="60" height="30" fill="#e69f00"/></g>` +
          `<g id="l2" fub:layer="Note" display="none"><rect x="200" y="55" width="60" height="30" fill="#000000"/></g>` +
          `<g id="l3" fub:layer="Disegno"><rect id="${A}" x="20" y="200" width="40" height="40" fill="#0072b2"/></g>`,
      ),
      { level: "standard" },
    );
    editor.setTool("select");
    drag([[40, 220], [41, 150], [43, 73]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 3 -150)");
  });

  it("si allineano a ciò che si vede nella vista", () => {
    mount(
      wide(`${LAYER}<rect id="${A}" x="20" y="100" width="40" height="40" fill="#0072b2"/><rect id="${B}" x="200" y="60" width="40" height="40" fill="#e69f00"/></g>`),
      { level: "standard" },
    );
    editor.setTool("select");
    size(150, 150);
    drag([[40, 120], [40, 100], [40, 83]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 0 -37)");
    editor.undo();
    size(300, 300);
    drag([[40, 120], [40, 100], [40, 83]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 0 -40)");
  });

  it("ridimensionando, il bordo tirato si ferma in linea con un altro oggetto", () => {
    mount(
      wide(`${LAYER}<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000"/><rect id="${B}" x="236" y="20" width="20" height="20" fill="#e69f00"/></g>`),
      { level: "standard" },
    );
    editor.setTool("select");
    editor.select([A]);
    // Il lato destro, preso a 204, arriva a 232: il bordo dell'altro è a 236.
    drag([[204, 125], [220, 125], [236, 125]]);
    expect(transformOf(A)).toBe("matrix(1.36 0 0 1 -36 0)");
    expect(spoken()).toBe("Misure: 136 × 50. Agganciato: il bordo destro in linea con il bordo sinistro di Rettangolo, Arancione.");
    editor.undo();
    drag([[204, 125], [220, 125], [236, 125]], { ctrlKey: true });
    expect(transformOf(A)).toBe("matrix(1.32 0 0 1 -32 0)");
  });

  it("disegnando una forma, il punto tirato si ferma in linea con gli oggetti", () => {
    mount(APART, { level: "standard" });
    editor.setTool("rect");
    drag([[103, 303], [150, 320], [197, 348]]);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="103" y="303" width="97" height="45" fill="none"/);
    expect(spoken()).toBe("Rettangolo aggiunto. Il disegno ha 3 oggetti. Agganciato: il punto in linea con il bordo sinistro di Rettangolo, Arancione.");
  });

  it("«Pagina e griglia» le spegne e le riaccende, e chi monta l'editor lo sa", () => {
    const grids: unknown[] = [];
    mount(APART, { level: "standard", onGridChange: (grid) => grids.push(grid) });
    pageButton().click();
    const item = entry("Guide intelligenti");
    expect(item.getAttribute("role")).toBe("menuitemcheckbox");
    expect(item.getAttribute("aria-checked")).toBe("true");
    expect(item.querySelector(".menu-description")!.textContent).toBe(
      "Allinea ai bordi e ai centri degli altri oggetti e della pagina. Tieni premuto Ctrl mentre trascini per posare libero.",
    );
    item.click();
    expect(spoken()).toBe("Guide intelligenti spente.");
    expect(editor.grid).toEqual({ shown: false, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(grids).toEqual([{ shown: false, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE }]);
    editor.setTool("select");
    drag([[40, 220], [41, 150], [43, 73]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 3 -147)");
    pageButton().click();
    entry("Guide intelligenti").click();
    expect(spoken()).toBe("Guide intelligenti accese.");
    expect(grids).toHaveLength(2);
  });

  it("nel Personalizzato ci sono anche senza la griglia, sole nel menu; all'Essenziale no", () => {
    mount(APART, { level: "custom", custom: ["pen", "eraser", "rect", "ellipse", "line", "arrow", "guides"] });
    expect(pageButton().hidden).toBe(false);
    pageButton().click();
    expect(menu().map(labelOf)).toEqual(["Guide intelligenti"]);
    editor.setLevel("essential");
    expect(pageButton().hidden).toBe(true);
    editor.setTool("select");
    drag([[40, 220], [41, 150], [43, 73]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 3 -147)");
  });

  it("con Alt e una selezione, misurano le distanze dall'oggetto sotto il puntatore, o dalla pagina", () => {
    const layer = recording();
    mount(APART, { level: "standard" });
    editor.setTool("select");
    hover(230, 65, { altKey: true });
    layer.frame();
    expect(layer.texts(), "senza selezione niente").toEqual([]);
    editor.select([A]);
    hover(230, 65, { altKey: true });
    layer.frame();
    // Le misure della selezione restano sotto di lei.
    expect(layer.texts()).toEqual(["40 × 40", "140", "120"]);
    // Fuori dagli oggetti, dalla pagina.
    hover(300, 300, { altKey: true });
    layer.frame();
    expect(layer.texts()).toEqual(["40 × 40", "20", "340", "200", "160"]);
    // Lasciato Alt, le distanze se ne vanno.
    surface().dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    layer.frame();
    expect(layer.texts()).toEqual(["40 × 40"]);
    expect(changes).toEqual([]);
  });

  it("«?» elenca i loro tasti", async () => {
    mount(SOURCE, { level: "standard" });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Guide intelligenti");
    expect(rows).toContainEqual(["Ctrl", "Tenuto mentre si trascina: posa libero, senza agganciarsi agli altri oggetti"]);
    expect(rows).toContainEqual(["Alt", "Tenuto con una selezione: le distanze dall’oggetto sotto il puntatore, o dalla pagina"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    // La finestra chiusa rende il fuoco dopo.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("i righelli e le guide del documento, dal livello Standard", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  /// Un disegno in una pagina larga, con gli attributi `root` sulla radice:
  /// un quadrato blu da (20, 200) a (60, 240) e un rettangolo arancione da
  /// (200, 50) a (260, 80), lontani dalle guide delle prove.
  const sheet = (root = ""): string =>
    doc(`<title>Prova</title>${LAYER}<rect id="${A}" x="20" y="200" width="40" height="40" fill="#0072b2"/><rect id="${B}" x="200" y="50" width="60" height="30" fill="#e69f00"/></g>`).replace(
      'viewBox="0 0 100 100"',
      `viewBox="0 0 400 400"${root}`,
    );

  const stage = (): HTMLElement => host.querySelector<HTMLElement>(".draw-stage")!;
  const rulers = (): SVGSVGElement => host.querySelector<SVGSVGElement>(".draw-rulers")!;
  const corner = (): string => rulers().querySelector('[data-part="unit"]')!.textContent ?? "";
  const guidesOf = (): string | null => editor.engine.text.match(/fub:guides="([^"]*)"/)?.[1] ?? null;
  const transformOf = (id: string): string | null => editor.engine.text.match(new RegExp(`id="${id}"[^>]*? transform="([^"]*)"`))?.[1] ?? null;
  const hover = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  };
  const shift = (name: string): KeyboardEvent => key(name, { shiftKey: true });
  const pageButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Pagina e griglia"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const entry = (label: string): HTMLButtonElement => menu().find((one) => labelOf(one) === label)!;
  const rightClick = (x: number, y: number): MouseEvent => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
    surface().dispatchEvent(event);
    return event;
  };
  /// Monta il disegno al livello Standard, col foglio di 400 per 300 e i
  /// righelli accesi: la camera resta l'identità, e i punti dello schermo
  /// sono quelli della scena.
  const withRulers = (source: string, options: DrawEditorOptions = {}): void => {
    mount(source, { level: "standard", ...options });
    size(400, 300);
    shift("R");
  };

  // Un menu rimasto aperto va chiuso davvero: tolto e basta, terrebbe il
  // fuoco anche nella prova dopo.
  afterEach(() => {
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("Maiusc+R mostra e nasconde i righelli, «|» le guide; l'Essenziale non li ha, e chi monta l'editor lo sa", () => {
    const grids: unknown[] = [];
    mount(sheet(), { onGridChange: (grid) => grids.push(grid) });
    size(400, 300);
    shift("R");
    expect(editor.grid.rulers).toBe(false);
    expect(rulers().style.display).toBe("none");

    editor.setLevel("standard");
    expect(shift("R").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Righelli visibili.");
    expect(editor.grid.rulers).toBe(true);
    expect(stage().hasAttribute("data-rulers")).toBe(true);
    expect(rulers().style.display).toBe("");
    expect(rulers().getAttribute("aria-hidden")).toBe("true");
    expect(corner()).toBe("px");
    // Un numero ogni cento pixel; lo zero sta sotto l'angolo.
    const labels = [...rulers().querySelectorAll('[data-ruler="x"] [data-part="labels"] text')].map((text) => text.textContent);
    expect(labels).toContain("100");
    expect(labels).not.toContain("0");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    key("|");
    expect(spoken()).toBe("Guide nascoste.");
    expect(editor.grid.rulerGuides).toBe(false);
    shift("R");
    expect(spoken()).toBe("Righelli nascosti.");
    expect(stage().hasAttribute("data-rulers")).toBe(false);
    expect(rulers().style.display).toBe("none");
    expect(grids).toEqual([
      expect.objectContaining({ rulers: true, rulerGuides: true }),
      expect.objectContaining({ rulers: true, rulerGuides: false }),
      expect.objectContaining({ rulers: false, rulerGuides: false }),
    ]);
  });

  it("una guida si tira da un righello, con qualunque strumento: orizzontale da quello in alto, verticale da quello a sinistra, un passo di annulla ciascuna", () => {
    // Due gesti di fila, ma non così vicini da fondersi in un passo.
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    withRulers(sheet());
    editor.setTool("pen");
    drag([[100, 10], [100, 60], [100, 120]]);
    expect(guidesOf()).toBe("y 120");
    expect(spoken()).toBe("Guida orizzontale aggiunta a 120.");
    now.mockReturnValue(MERGE_MS + 1);
    drag([[10, 100], [60, 100], [150.4, 100]]);
    expect(guidesOf()).toBe("y 120; x 150.4");
    expect(spoken()).toBe("Guida verticale aggiunta a 150,4.");
    // La penna non ha disegnato niente.
    expect(editor.engine.text).not.toContain('fub:tool="pen"');
    editor.undo();
    expect(guidesOf()).toBe("y 120");
    editor.undo();
    expect(guidesOf()).toBeNull();
    // Rilasciata sopra un righello, o senza averla mossa, non c'è.
    drag([[100, 10], [100, 60], [100, 12]]);
    drag([[100, 10], [100, 10]]);
    expect(guidesOf()).toBeNull();
    // Dall'angolo non se ne tira nessuna.
    drag([[10, 10], [100, 100]]);
    expect(guidesOf()).toBeNull();
  });

  it("si aggancia alla griglia e agli oggetti, finché Ctrl o ⌘ non è tenuto", () => {
    withRulers(sheet(), { grid: { shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    drag([[10, 100], [50, 100], [93, 100]]);
    expect(guidesOf()).toBe("x 100");
    editor.undo();
    drag([[10, 100], [50, 100], [93, 100]], { ctrlKey: true });
    expect(guidesOf()).toBe("x 93");
    editor.undo();
    // Il bordo destro del quadrato, a 60, è più vicino della riga a 80.
    drag([[10, 100], [50, 100], [63, 100]]);
    expect(guidesOf()).toBe("x 60");
  });

  it("con Selezione una guida si sposta e, rilasciata su un righello, se ne va; una bloccata si attraversa", () => {
    withRulers(sheet(' fub:guides="x 200; y 150 locked"'));
    editor.setTool("select");
    hover(201, 280);
    expect(surface().dataset.grip).toBe("ew");
    hover(300, 151);
    expect(surface().dataset.grip).toBeUndefined();
    hover(100, 10);
    expect(surface().dataset.ruler).toBe("top");
    hover(10, 10);
    expect(surface().dataset.ruler).toBe("corner");

    drag([[201, 280], [230, 280], [251, 280]]);
    expect(guidesOf()).toBe("x 250; y 150 locked");
    expect(spoken()).toBe("Guida verticale spostata a 250.");
    expect(editor.selection).toEqual([]);
    // Sulla guida bloccata il gesto è della selezione: un riquadro sul vuoto.
    drag([[300, 151], [330, 170], [390, 290]]);
    expect(guidesOf()).toBe("x 250; y 150 locked");
    drag([[250, 280], [100, 280], [10, 280]]);
    expect(guidesOf()).toBe("y 150 locked");
    expect(spoken()).toBe("Guida verticale eliminata.");
    editor.undo();
    expect(guidesOf()).toBe("x 250; y 150 locked");
  });

  it("gli oggetti si agganciano alle guide finché si vedono, e lo si dice", () => {
    withRulers(sheet(' fub:guides="x 100"'));
    editor.setTool("select");
    // Il bordo destro arriva a 97, a 3 dalla guida: ci va sopra. Il bordo in
    // alto resta sul centro della pagina, dov'era.
    drag([[40, 220], [60, 220], [77, 220]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 40 0)");
    expect(spoken()).toBe("1 oggetto spostato. Agganciato: il bordo destro in linea con una guida; il bordo superiore in linea con il centro verticale della pagina.");
    editor.undo();
    key("|");
    drag([[40, 220], [60, 220], [77, 220]]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 37 0)");
    expect(spoken()).toBe("1 oggetto spostato. Agganciato: il bordo superiore in linea con il centro verticale della pagina.");
  });

  it("il tasto destro su una guida apre il suo menu, anche per una bloccata; sull'angolo, quello dei righelli", () => {
    withRulers(sheet(' fub:guides="x 200; y 150 locked"'));
    // Lontano dalle guide, il menu della selezione, col radiale in fondo.
    expect(rightClick(300, 280).defaultPrevented).toBe(true);
    expect(document.querySelector(".draw-radial")).toBeNull();
    expect(menu().map(labelOf)).toContain("Menu radiale");
    closeContextMenu();

    expect(rightClick(202, 280).defaultPrevented).toBe(true);
    expect(menu().map(labelOf)).toEqual(["Blocca la guida", "Elimina la guida", "Guide…", "Blocca tutte le guide", "Elimina tutte le guide"]);
    entry("Blocca la guida").click();
    expect(guidesOf()).toBe("x 200 locked; y 150 locked");
    expect(spoken()).toBe("Guida bloccata.");
    rightClick(300, 151);
    expect(menu().map(labelOf)).toEqual(["Sblocca la guida", "Elimina la guida", "Guide…", "Sblocca tutte le guide", "Elimina tutte le guide"]);
    entry("Sblocca tutte le guide").click();
    expect(guidesOf()).toBe("x 200; y 150");
    expect(spoken()).toBe("Guide sbloccate.");

    surface().dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    expect(menu().map((one) => [labelOf(one), one.getAttribute("aria-checked")])).toEqual([
      ["Pixel", "true"],
      ["Millimetri", "false"],
      ["Centimetri", "false"],
      ["Pollici", "false"],
      ["Punti", "false"],
      ["Mostra le guide", "true"],
      ["Guide…", null],
      ["Blocca tutte le guide", null],
      ["Elimina tutte le guide", null],
      ["Nascondi i righelli", null],
    ]);
    entry("Elimina tutte le guide").click();
    expect(guidesOf()).toBeNull();
    expect(spoken()).toBe("2 guide eliminate.");
    rightClick(100, 10);
    entry("Nascondi i righelli").click();
    expect(editor.grid.rulers).toBe(false);
  });

  it("l'unità del documento si sceglie dall'angolo dei righelli, in un passo che si annulla, e il disegno non cambia", () => {
    withRulers(sheet());
    const before = editor.engine.text;
    surface().dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    entry("Millimetri").click();
    expect(spoken()).toBe("Il documento ora misura in millimetri.");
    expect(editor.engine.text).toBe(before.replace('viewBox="0 0 400 400"', 'viewBox="0 0 400 400" fub:units="mm"'));
    expect(corner()).toBe("mm");
    pageButton().click();
    expect(entry("Unità: Millimetri…")).toBeDefined();
    closeContextMenu();
    editor.undo();
    expect(editor.engine.text).toBe(before);
    expect(corner()).toBe("px");
  });

  it("nell'unità del documento: il passo della griglia, le misure dette e i campi; il passo di ogni unità si ricorda", () => {
    mount(sheet(' fub:units="mm"'), { level: "standard" });
    size(400, 300);
    pageButton().click();
    expect(menu().filter((one) => one.getAttribute("role") === "menuitemradio").map((one) => [labelOf(one), one.getAttribute("aria-checked")])).toEqual([
      ["Passo di 1 mm", "false"],
      ["Passo di 2 mm", "false"],
      ["Passo di 5 mm", "true"],
      ["Passo di 10 mm", "false"],
      ["Passo di 20 mm", "false"],
    ]);
    entry("Passo di 10 mm").click();
    expect(spoken()).toBe("Passo della griglia: 10 millimetri.");
    expect(editor.grid.step).toBe(20);
    expect(editor.grid.steps.mm).toBeCloseTo(37.795, 3);

    editor.select([A]);
    editor.focus();
    key("Enter");
    expect(["x", "y", "width", "height"].map((id) => [propertyLabel(id), propertyInput(id).value])).toEqual([
      ["X (mm)", "5,292"],
      ["Y (mm)", "52,917"],
      ["Larghezza (mm)", "10,583"],
      ["Altezza (mm)", "10,583"],
    ]);
    enter(propertyInput("width"), "20");
    expect(transformOf(A)).toBe("matrix(1.8898 0 0 1 -17.7953 0)");
    expect(propertyInput("width").value).toBe("20");
  });

  it("«Guide…» le scrive coi numeri, in un passo, e un doppio clic su una guida apre la sua riga", async () => {
    withRulers(sheet(' fub:guides="x 200"'));
    pageButton().click();
    entry("Guide…").click();
    expect(dialog().querySelector("h2")!.textContent).toBe("Guide");
    const buttons = (): HTMLButtonElement[] => [...dialog().querySelectorAll<HTMLButtonElement>(".draw-guides-tools button")];
    buttons().find((one) => one.textContent === "Aggiungi un’orizzontale")!.click();
    const positions = (): HTMLInputElement[] => [...dialog().querySelectorAll<HTMLInputElement>('input[type="number"]')];
    // Al centro di ciò che si vede, fuori dai righelli.
    expect(positions().map((input) => input.value)).toEqual(["200", "162"]);
    positions()[1]!.value = "75.5";
    await submit();
    expect(guidesOf()).toBe("x 200; y 75.5");
    expect(spoken()).toBe("Guide aggiornate.");
    editor.undo();
    expect(guidesOf()).toBe("x 200");

    editor.setTool("select");
    drag([[200, 280], [200, 280]]);
    drag([[200, 280], [200, 280]]);
    expect(dialog().querySelector("h2")!.textContent).toBe("Guide");
    expect(document.activeElement).toBe(positions()[0]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions button:not(.primary)")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guidesOf()).toBe("x 200");
  });

  it("i tasti dei righelli stanno nell'elenco dei tasti", () => {
    mount(sheet(), { level: "standard" });
    shift("?");
    const table = [...dialog().querySelectorAll("table")].find((one) => one.querySelector("caption")!.textContent === "Righelli e guide")!;
    expect([...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent])).toEqual([
      ["Shift+R", "Mostra o nasconde i righelli"],
      ["| o Ctrl+;", "Mostra o nasconde le guide"],
      ["Ctrl", "Tenuto mentre si tira una guida: posa libero, senza agganciarsi"],
    ]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il testo, dal livello Standard", () => {
  /// Un testo blu di due righe, nel corpo 20: il suo riquadro va da (10, 24)
  /// a (46, 70).
  const T = "ot1t1t1t1";
  const TEXT = doc(
    `<title>Prova</title>${LAYER}<text id="${T}" x="10" y="40" fill="#0072b2" font-family="Inter, sans-serif" font-size="20">` +
      `<tspan x="10" dy="0">Uno</tspan><tspan x="10" dy="25">Due</tspan></text></g>`,
  );
  const EMPTY = doc(`<title>Prova</title>${LAYER}</g>`);

  const input = (): HTMLElement => host.querySelector<HTMLElement>(".draw-text-input")!;
  /// Le righe del campo, come le mostra.
  const rows = (): HTMLElement[] => [...input().querySelectorAll<HTMLElement>(".draw-text-line")];
  const shown = (): string => rows().map((row) => row.textContent).join("\n");
  const layer = (): HTMLElement => host.querySelector<HTMLElement>(".draw-text-layer")!;
  const painted = (): SVGElement => host.querySelector<SVGElement>(".spatial-painter text")!;
  /// Un tocco col mouse in (`x`, `y`).
  const tap = (x: number, y: number): void => drag([[x, y]]);
  /// Mette `value` al posto del testo del campo.
  const type = (value: string): void => {
    replaceAll(input(), value);
  };
  /// Le righe del testo `id`, come le scrive il file.
  const lines = (id: string): string[] => {
    const text = new RegExp(`<text id="${id}"[^>]*>([\\s\\S]*?)</text>`).exec(editor.engine.text)?.[1] ?? "";
    return [...text.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]!);
  };

  it("lo strumento c'è dal livello Standard: un tocco apre il campo dove resterà il testo, ed Esc lo scrive in un passo che si annulla", () => {
    mount(EMPTY);
    key("t");
    expect(editor.tool).toBe("pen");
    editor.setLevel("standard");
    key("t");
    expect(editor.tool).toBe("text");
    expect(surface().dataset.tool).toBe("text");
    tap(30, 50);
    expect(layer().hidden).toBe(false);
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-label")).toBe("Testo nuovo");
    expect(document.getElementById(input().getAttribute("aria-describedby")!)?.textContent).toBe("Invio va a capo; Ctrl+B, I e U formattano; Esc, Tab o Ctrl+Invio concludono.");
    // Il campo scrive con le famiglie che la superficie usa davvero: quelle
    // di Fub al posto delle generiche, come l'export.
    expect(input().style.fontFamily).toBe('Inter, Literata, "JetBrains Mono"');
    expect(input().style.fontSize).toBe("32px");
    expect(input().style.lineHeight).toBe("1.25");
    expect(input().getAttribute("contenteditable")).toBe("true");
    expect(input().getAttribute("role")).toBe("textbox");
    expect(input().getAttribute("aria-multiline")).toBe("true");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    expect(changes).toEqual([]);

    // Gli spazi in fila valgono uno, le righe vuote ai bordi non ci sono, e
    // quella in mezzo resta.
    type("  Ciao\t  mondo \n\n due\n\n");
    expect(input().style.height).toBe("200px");
    expect(key("Enter", {}, input()).defaultPrevented).toBe(false);
    expect(key("Escape", {}, input()).defaultPrevented).toBe(true);
    expect(layer().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(changes).toHaveLength(1);
    // La prima linea di base va sotto il tocco di metà riga.
    expect(editor.engine.text).toMatch(/<text id="o[a-z0-9]{8}" x="30" y="61.62" fill="#000000" font-family="Inter, sans-serif" font-size="32">/);
    const [id] = editor.selection;
    expect(lines(id!)).toEqual(["Ciao mondo", " ", "due"]);
    expect(editor.engine.text).toContain('<tspan x="30" dy="40">due</tspan>');
    expect(spoken()).toBe("Testo aggiunto. Il disegno ha 1 oggetto.");

    key("z", { ctrlKey: true });
    expect(editor.engine.text).not.toContain("<text");
    expect(spoken()).toBe("Annullato: Testo.");
  });

  it("un tocco su un testo lo apre com'è, al suo posto, e Tab scrive le righe cambiate", () => {
    mount(TEXT, { level: "standard" });
    editor.setTool("text");
    tap(20, 35);
    expect(shown()).toBe("Uno\nDue");
    expect(input().getAttribute("aria-label")).toBe("Testo");
    expect(input().style.fontSize).toBe("20px");
    expect(rows().map((row) => [row.style.textAlign, row.style.marginTop])).toEqual([
      ["left", ""],
      ["left", "0px"],
    ]);
    // Il testo sotto il campo non si vede, finché il campo è aperto.
    expect(painted().style.visibility).toBe("hidden");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    type("Uno\n\nTre");
    expect(key("Tab", {}, input()).defaultPrevented).toBe(true);
    expect(painted().style.visibility).toBe("");
    expect(lines(T)).toEqual(["Uno", " ", "Tre"]);
    // Le righe nuove copiano la precedente e ne prendono l'interlinea.
    expect(editor.engine.text).toContain('<tspan x="10" dy="25"> </tspan>');
    expect(editor.engine.text).toContain('<tspan x="10" dy="25">Tre</tspan>');
    expect(editor.selection).toEqual([T]);
    expect(spoken()).toBe("Testo modificato.");
    expect(changes).toHaveLength(1);
    key("z", { ctrlKey: true });
    expect(lines(T)).toEqual(["Uno", "Due"]);
    expect(spoken()).toBe("Annullato: Modifica del testo.");
  });

  it("Ctrl+Invio conclude; un testo nuovo vuoto, o uno che non cambia, non scrive niente; uno svuotato se ne va", () => {
    mount(TEXT, { level: "standard" });
    editor.setTool("text");
    tap(80, 90);
    type(" \n\t ");
    expect(key("Enter", { ctrlKey: true }, input()).defaultPrevented).toBe(true);
    expect(layer().hidden).toBe(true);
    expect(changes).toEqual([]);

    tap(20, 35);
    type("Uno  \nDue");
    key("Escape", {}, input());
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual([T]);

    tap(20, 35);
    type("\n ");
    key("Escape", {}, input());
    expect(editor.engine.text).not.toContain(T);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("1 oggetto eliminato. Il disegno ha 0 oggetti.");
    key("z", { ctrlKey: true });
    expect(lines(T)).toEqual(["Uno", "Due"]);
  });

  it("con la selezione, due tocchi su un testo lo aprono; F2 e «Modifica il testo» aprono quello scelto", () => {
    mount(doc(`<title>Prova</title>${LAYER}<line id="oa1a1a1a1" x1="60" y1="60" x2="80" y2="80" stroke="#000000"/>${TEXT.slice(TEXT.indexOf("<text"), TEXT.indexOf("</g>"))}</g>`), { level: "standard" });
    editor.setTool("select");
    tap(20, 35);
    expect(editor.selection).toEqual([T]);
    expect(layer().hidden).toBe(true);
    tap(22, 36);
    expect(layer().hidden).toBe(false);
    expect(document.activeElement).toBe(input());
    key("Escape", {}, input());
    expect(editor.selection).toEqual([T]);
    // Due tocchi lenti non lo aprono.
    tap(20, 35);
    clock += 1000;
    tap(20, 35);
    expect(layer().hidden).toBe(true);

    const edit = host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Modifica il testo"]')!;
    expect(edit.hidden).toBe(false);
    expect(edit.title).toBe("Modifica il testo (F2)");
    expect(edit.getAttribute("aria-keyshortcuts")).toBe("F2");
    edit.click();
    expect(document.activeElement).toBe(input());
    // Mentre si scrive, la barra della selezione non c'è.
    expect(host.querySelector<HTMLElement>(".draw-arrange")!.hidden).toBe(true);
    key("Escape", {}, input());

    surface().focus();
    expect(key("F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    key("Escape", {}, input());
    editor.select(["oa1a1a1a1"]);
    expect(edit.hidden).toBe(true);
    // Su un oggetto che non è un testo e non ne ha uno dentro, F2 apre il
    // suo nome nell'albero.
    key("F2");
    expect(layer().hidden).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".draw-object-rename"));
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(changes).toEqual([]);
    editor.setLevel("essential");
    editor.select([T]);
    expect(key("F2").defaultPrevented).toBe(false);
    expect(layer().hidden).toBe(true);
  });

  it("Ctrl+B su una parola la scrive in un pezzo, con l'operazione text; il campo riapre il testo coi suoi pezzi", () => {
    mount(TEXT, { level: "standard" });
    editor.setTool("text");
    tap(20, 35);
    const two = rows()[1]!.firstChild!;
    document.getSelection()!.setBaseAndExtent(two, 0, two, 3);
    expect(key("b", { ctrlKey: true }, input()).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Grassetto attivato.");
    key("Escape", {}, input());
    expect(editor.engine.text).toContain('<tspan x="10" dy="0">Uno</tspan>\n  <tspan x="10" dy="25"><tspan font-weight="bold">Due</tspan></tspan>');
    expect(changes).toHaveLength(1);
    expect(spoken()).toBe("Testo modificato.");

    tap(20, 35);
    const piece = rows()[1]!.querySelector<HTMLElement>(".draw-text-piece")!;
    expect(piece.textContent).toBe("Due");
    expect(piece.style.fontWeight).toBe("bold");
    key("Escape", {}, input());
    expect(changes).toHaveLength(1);
    key("z", { ctrlKey: true });
    expect(lines(T)).toEqual(["Uno", "Due"]);
  });

  it("una riga spezzata sopra una che scrive il suo aspetto riscrive il testo intero, con lo stesso nome, in un passo", () => {
    mount(TEXT.replace('<tspan x="10" dy="25">Due', '<tspan x="10" dy="25" font-style="italic">Due'), { level: "standard" });
    editor.setTool("text");
    tap(20, 35);
    const one = rows()[0]!.firstChild!;
    document.getSelection()!.setBaseAndExtent(one, 1, one, 1);
    const split = new InputEvent("beforeinput", { inputType: "insertParagraph", bubbles: true, cancelable: true });
    input().dispatchEvent(split);
    expect(split.defaultPrevented).toBe(true);
    expect(shown()).toBe("U\nno\nDue");
    key("Escape", {}, input());
    expect(editor.engine.text).toContain(`<text id="${T}" x="10" y="40" fill="#0072b2" font-family="Inter, sans-serif" font-size="20">`);
    expect(editor.engine.text).toContain('<tspan x="10" dy="0">U</tspan>\n  <tspan x="10" dy="25">no</tspan>\n  <tspan x="10" dy="25" font-style="italic">Due</tspan>');
    expect(changes).toHaveLength(1);
    expect(editor.selection).toEqual([T]);
    key("z", { ctrlKey: true });
    expect(lines(T)).toEqual(["Uno", "Due"]);
  });

  it("Spazio scrive dov'è il cursore, e con l'aggancio la linea di base va sulla griglia", () => {
    mount(EMPTY, { level: "standard", grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    size(200, 100);
    editor.setTool("text");
    surface().focus();
    expect(key(" ").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    type("A");
    key("Escape", {}, input());
    expect(editor.engine.text).toMatch(/<text id="o[a-z0-9]{8}" x="100" y="60" /);
  });

  it("toccare il foglio, cambiare strumento o livello e annullare concludono il testo; caricare un documento o la sola lettura lo lasciano", () => {
    mount(TEXT, { level: "standard" });
    editor.setTool("text");
    tap(80, 90);
    type("Tre");
    // Il tocco che conclude un testo non ne apre un altro.
    tap(70, 10);
    expect(layer().hidden).toBe(true);
    expect(changes).toHaveLength(1);
    expect(spoken()).toBe("Testo aggiunto. Il disegno ha 2 oggetti.");
    tap(70, 10);
    expect(layer().hidden).toBe(false);
    type("Quattro");
    editor.setTool("select");
    expect(changes).toHaveLength(2);

    editor.setTool("text");
    tap(60, 95);
    type("Cinque");
    editor.undo();
    expect(changes).toHaveLength(4);
    expect(editor.engine.text).not.toContain("Cinque");
    expect(editor.canRedo).toBe(true);

    tap(60, 95);
    type("Sei");
    editor.setLevel("essential");
    expect(changes).toHaveLength(5);
    expect(editor.engine.text).toContain(">Sei</tspan>");
    editor.setLevel("standard");
    editor.setTool("text");

    tap(60, 80);
    type("Sette");
    host.querySelector<HTMLInputElement>(".draw-title-input")!.focus();
    expect(changes).toHaveLength(6);
    expect(editor.engine.text).toContain(">Sette</tspan>");

    tap(60, 65);
    type("Otto");
    editor.setReadOnly(true);
    expect(layer().hidden).toBe(true);
    expect(changes).toHaveLength(6);
    editor.setReadOnly(false);

    tap(60, 65);
    type("Nove");
    editor.load(SceneEngine.open(TEXT));
    expect(layer().hidden).toBe(true);
    expect(changes).toHaveLength(6);
    expect(editor.engine.text).not.toContain("Nove");
  });

  it("le dimensioni prendono il posto degli spessori; il colore è quello della penna, e cambiano il testo che si scrive", () => {
    mount(SOURCE, { level: "standard" });
    editor.setColor("#d55e00");
    editor.setTool("text");
    expect(editor.color).toBe("#d55e00");
    expect(editor.width).toBe(32);
    const group = host.querySelector<HTMLElement>('[role="toolbar"] .draw-group[aria-label="Dimensione"]');
    expect(group).not.toBeNull();
    const sizes = [...host.querySelectorAll<HTMLButtonElement>(".draw-width")];
    expect(sizes.map((control) => [control.getAttribute("aria-label"), control.getAttribute("aria-checked")])).toEqual([
      ["Piccolo", "false"],
      ["Medio", "true"],
      ["Grande", "false"],
    ]);
    for (const control of sizes) {
      expect(control.querySelector<HTMLElement>(".draw-width-bar")!.hidden).toBe(true);
      expect(control.querySelector<HTMLElement>(".draw-size-glyph")!.hidden).toBe(false);
    }
    expect(formatIssues(checkAccessibility(host))).toBe("");

    tap(20, 30);
    type("Ciao");
    // Un pulsante della barra lascia il fuoco al campo.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    sizes[2]!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    sizes[2]!.click();
    expect(editor.width).toBe(48);
    expect(input().style.fontSize).toBe("48px");
    editor.setColor("#009e73");
    expect(input().style.color).toMatch(/^(#009e73|rgb\(0, 158, 115\))$/);
    key("Escape", {}, input());
    expect(editor.engine.text).toMatch(/<text id="o[a-z0-9]{8}" x="20" y="[\d.]+" fill="#009e73" font-family="Inter, sans-serif" font-size="48">/);

    // La penna ha il suo spessore, e lo stesso colore.
    editor.setTool("pen");
    expect(editor.width).toBe(4);
    expect(editor.color).toBe("#009e73");
    expect(group!.getAttribute("aria-label")).toBe("Spessore");
    expect(sizes.map((control) => control.getAttribute("aria-label"))).toEqual(["Sottile", "Medio", "Spesso"]);
  });

  it("il gruppo «Carattere» c'è mentre si scrive: famiglia, corpo ed enfasi di ciò che si scrive, col fuoco che resta al campo", () => {
    mount(SOURCE, { level: "standard" });
    editor.setTool("text");
    const character = host.querySelector<HTMLElement>('[role="toolbar"] .draw-group[aria-label="Carattere"]')!;
    expect(character.hidden).toBe(true);
    tap(20, 30);
    type("Ciao");
    expect(character.hidden).toBe(false);
    const toggle = (name: string): HTMLButtonElement => character.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    const font = character.querySelector<HTMLButtonElement>(".kit-font-button")!;
    const size = character.querySelector<HTMLInputElement>("input")!;
    expect(font.getAttribute("aria-label")).toBe("Carattere: Inter");
    expect(size.value).toBe("32");
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("false");

    // Senza scelta, il grassetto vale per ciò che si scriverà, e il gruppo
    // lo dice; il fuoco resta al campo.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    toggle("Grassetto").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    toggle("Grassetto").click();
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("true");
    toggle("Grassetto").click();
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("false");

    // La scelta del carattere prende il fuoco senza concludere il testo, e lo
    // ridà al campo; la famiglia va a tutto ciò che è scelto.
    const range = document.createRange();
    range.selectNodeContents(input());
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    font.click();
    const search = document.querySelector<HTMLInputElement>(".kit-font-popover input")!;
    expect(document.activeElement).toBe(search);
    search.value = "literata";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    key("Enter", {}, search);
    expect(layer().hidden).toBe(false);
    expect(font.getAttribute("aria-label")).toBe("Carattere: Literata");
    expect(document.activeElement).toBe(input());
    // Il corpo scritto nel campo numerico, sul testo scelto.
    size.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    size.focus();
    size.value = "40";
    key("Enter", {}, size);
    expect(layer().hidden).toBe(false);
    key("Escape", {}, input());
    expect(editor.engine.text).toMatch(/font-family="Literata, serif"/);
    expect(editor.engine.text).toMatch(/font-size="40"/);
    expect(character.hidden).toBe(true);
  });

  it("il correttore segna ciò che si scrive, e dal menu del tasto destro corregge in un passo del testo", async () => {
    const checks: string[][] = [];
    const proof = {
      queryIndex: vi.fn(async (query: { kind: string; query?: unknown }) => {
        const segments = (query.query as { segments: string[] }).segments;
        checks.push(segments);
        const encoder = new TextEncoder();
        return {
          kind: "custom",
          value: {
            language: { code: "it", spelling: true, grammar: true, missing_dictionary: null },
            segments: segments.map((segment) => {
              const at = segment.indexOf("speling");
              if (at < 0) return [];
              const start = encoder.encode(segment.slice(0, at)).length;
              return [{ start, end: start + 7, kind: "spelling", message: "Ortografia", suggestions: ["spelling"] }];
            }),
          },
        };
      }),
      invokeCommand: vi.fn(async () => ({ notify: null })),
      settings: vi.fn(async () => [{ spec: { key: "proof.language" }, value: "it", source: "default" }]),
      interfaceLanguage: () => "it",
      watch: () => () => {},
    } as unknown as ProofPorts;
    mount(SOURCE, { level: "standard", proof: { ports: proof } });
    editor.setTool("text");
    tap(20, 30);
    // Il correttore di Fub prende il posto di quello del browser.
    expect(input().spellcheck).toBe(false);
    type("un speling qui");
    const mark = await vi.waitFor(() => {
      const found = input().querySelector<HTMLElement>(".draw-text-proof-spelling");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(mark.textContent).toBe("speling");
    expect(mark.title).toBe("Ortografia");
    expect(checks).toEqual([["un speling qui"]]);

    // Dalla tastiera, il menu del cursore che sta nel tratto.
    const text = mark.firstChild ?? mark;
    document.getSelection()!.setBaseAndExtent(text, 2, text, 2);
    const menuKey = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    input().dispatchEvent(menuKey);
    expect(menuKey.defaultPrevented).toBe(true);
    const items = [...document.querySelectorAll<HTMLElement>(".context-menu [role=menuitem]")];
    expect(items.map((item) => item.querySelector(".menu-label")?.textContent)).toEqual(["spelling", "Aggiungi al dizionario", "Ignora"]);
    items[0]!.click();
    expect(layer().hidden).toBe(false);
    expect(input().textContent).toBe("un spelling qui");
    // La riga cambiata perde il suo tratto.
    expect(input().querySelector(".draw-text-proof-spelling")).toBeNull();
    key("Escape", {}, input());
    expect(lines(editor.engine.text.match(/<text id="(o[a-z0-9]{8})"/)![1]!)).toEqual(["un spelling qui"]);
  });

  it("il campo segue la trasformazione del testo e lo zoom", () => {
    const turned = doc(`<title>Prova</title>${LAYER}<text id="${T}" x="0" y="0" transform="rotate(90 50 50)" font-size="10"><tspan x="0" dy="0">Su</tspan></text></g>`);
    mount(turned, { level: "standard" });
    editor.setTool("text");
    editor.select([T]);
    surface().focus();
    key("F2");
    const [, matrix] = /^matrix\(([^)]*)\) translate\(/.exec(input().style.transform) ?? [];
    expect(matrix!.split(", ").map((n) => Math.round(Number(n) * 1e9) / 1e9 || 0)).toEqual([0, 1, -1, 0, 100, 0]);
    expect(input().style.fontSize).toBe("10px");
    key("+");
    expect(input().style.fontSize).toBe("12.5px");
    key("Escape", {}, input());
  });

  describe("le etichette nelle forme", () => {
    const R = "or1r1r1r1";
    /// Un rettangolo arancio da (100, 100) a (300, 220): il centro è in
    /// (200, 160), e le righe di un'etichetta sono larghe 200 − 2 · 6.
    const SHAPE = doc(`<title>Prova</title>${LAYER}<rect id="${R}" x="100" y="100" width="200" height="120" fill="#e69f00" stroke="#000000" stroke-width="2"/></g>`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 300"');
    /// L'id dell'etichetta del disegno.
    const labelId = (): string => /<text id="([^"]+)"/.exec(editor.engine.text)![1]!;
    /// Dove cade, nella scena, il mezzo delle righe dell'etichetta: fra la
    /// cima delle maiuscole della prima riga e il fondo dell'ultima.
    const middleOf = (id: string): [number, number] => {
      const label = editor.engine.holder(id)!;
      const rich = textRich(label)!;
      const [a, b, c, d, e, f] = parseTransform(rich.attrs.transform!)!;
      const y = blockMiddle(rich);
      expect([a, b, c, d]).toEqual([1, 0, 0, 1]);
      return [e + c * y, f + d * y];
    };

    it("due tocchi su una forma chiusa ci scrivono dentro, al centro; Esc la mette in un gruppo con la forma, in un passo", () => {
      mount(SHAPE, { level: "standard" });
      editor.setTool("select");
      tap(150, 130);
      expect(editor.selection).toEqual([R]);
      tap(151, 131);
      expect(layer().hidden).toBe(false);
      expect(document.activeElement).toBe(input());
      expect(input().getAttribute("aria-label")).toBe("Etichetta nella forma");
      expect(rows().map((row) => row.style.textAlign)).toEqual(["center"]);
      expect(formatIssues(checkAccessibility(host))).toBe("");
      type("Inizio");
      key("Escape", {}, input());
      expect(changes).toHaveLength(1);
      const [group] = editor.selection;
      expect(group).not.toBe(R);
      const label = labelId();
      expect(editor.engine.text).toMatch(
        new RegExp(`<g id="${group}">\\s*<rect id="${R}"[^>]*/>\\s*<text id="${label}" fub:inside="${R}" fub:wrap="188" x="0" y="0" fill="#000000" font-family="Inter, sans-serif" font-size="32" text-anchor="middle" transform="matrix\\(1 0 0 1 200 168.8\\)">`),
      );
      const [x, y] = middleOf(label);
      expect(x).toBeCloseTo(200, 2);
      expect(y).toBeCloseTo(160, 2);
      expect(spoken()).toBe("Etichetta aggiunta.");
      key("z", { ctrlKey: true });
      expect(editor.engine.text).toBe(SHAPE);
      expect(spoken()).toBe("Annullato: Etichetta nella forma.");
    });

    it("F2 e «Modifica il testo» sulla forma scelta fanno lo stesso; un'etichetta vuota non scrive niente e la forma resta scelta", () => {
      mount(SHAPE, { level: "standard" });
      editor.select([R]);
      const edit = host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Modifica il testo"]')!;
      expect(edit.hidden).toBe(false);
      edit.click();
      expect(document.activeElement).toBe(input());
      key("Escape", {}, input());
      expect(changes).toEqual([]);
      expect(editor.selection).toEqual([R]);
      surface().focus();
      expect(key("F2").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input());
      type("Fine");
      key("Tab", {}, input());
      expect(changes).toHaveLength(1);
      // All'Essenziale, senza lo strumento Testo, niente etichette.
      editor.setLevel("essential");
      editor.select([R]);
      expect(key("F2").defaultPrevented).toBe(false);
      expect(layer().hidden).toBe(true);
    });

    it("due tocchi sul gruppo cambiano l'etichetta, che va a capo e resta al centro; svuotata, la forma torna com'era", () => {
      mount(SHAPE, { level: "standard" });
      editor.setTool("select");
      editor.select([R]);
      surface().focus();
      key("F2");
      type("Uno");
      key("Escape", {}, input());
      const [group] = editor.selection;
      const label = labelId();
      tap(150, 130);
      tap(151, 131);
      expect(shown()).toBe("Uno");
      expect(input().getAttribute("aria-label")).toBe("Etichetta nella forma");
      type("Uno due tre quattro cinque sei sette otto");
      // Mentre si scrive il campo resta al centro della forma.
      expect(rows().length).toBeGreaterThan(1);
      key("Escape", {}, input());
      expect(editor.selection).toEqual([group]);
      expect(spoken()).toBe("Testo modificato.");
      expect(lines(label).length).toBeGreaterThan(1);
      const [x, y] = middleOf(label);
      expect(x).toBeCloseTo(200, 2);
      expect(y).toBeCloseTo(160, 2);

      tap(150, 130);
      tap(151, 131);
      type(" ");
      key("Escape", {}, input());
      // La forma torna nel livello com'era, a capo come la scrive il motore.
      expect(editor.engine.text.replace(/\n\s*/g, "")).toBe(SHAPE);
      expect(editor.selection).toEqual([R]);
      expect(spoken()).toBe("Etichetta tolta.");
      key("z", { ctrlKey: true });
      expect(lines(label).length).toBeGreaterThan(1);
      expect(spoken()).toBe("Annullato: Rimozione dell’etichetta.");
    });

    it("due tocchi dentro una forma senza riempimento ci scrivono lo stesso", () => {
      mount(SHAPE.replace('fill="#e69f00"', 'fill="none"'), { level: "standard" });
      editor.setTool("select");
      // Un tocco nel vuoto della forma non la sceglie: due ne aprono l'etichetta.
      tap(200, 160);
      expect(editor.selection).toEqual([]);
      tap(201, 161);
      expect(document.activeElement).toBe(input());
      type("Dentro");
      key("Escape", {}, input());
      expect(changes).toHaveLength(1);
      expect(editor.engine.text).toContain(`fub:inside="${R}"`);
      // Fuori dalla forma due tocchi non aprono niente.
      tap(360, 260);
      tap(361, 261);
      expect(layer().hidden).toBe(true);
    });

    it("svuotata l'etichetta, il gruppo a cui è agganciato un connettore resta", () => {
      const G = "og1g1g1g1";
      const L = "ot1t1t1t1";
      const C = "oc1c1c1c1";
      mount(
        SHAPE.replace(
          /<rect [^>]*\/>/,
          (rect) =>
            `<g id="${G}">${rect}` +
            `<text id="${L}" fub:inside="${R}" fub:wrap="188" x="0" y="0" font-size="32" text-anchor="middle" transform="matrix(1 0 0 1 200 168.8)"><tspan x="0" dy="0">Uno</tspan></text></g>` +
            `<path id="${C}" fub:shape="connector" fub:geom="straight 300 160 380 160" fub:from="${G} right" d="M300 160 L380 160" fill="none" stroke="#000000" stroke-width="2"/>`,
        ),
        { level: "standard" },
      );
      editor.setTool("select");
      tap(150, 130);
      tap(151, 131);
      expect(shown()).toBe("Uno");
      type(" ");
      key("Escape", {}, input());
      expect(spoken()).toBe("Etichetta tolta.");
      expect(editor.engine.text).not.toContain(`id="${L}"`);
      expect(editor.engine.holder(G)).not.toBeNull();
      expect(editor.engine.text).toContain(`fub:from="${G} right"`);
    });

    it("la forma che cambia misura si porta dietro l'etichetta, nello stesso passo", () => {
      mount(SHAPE, { level: "standard" });
      editor.select([R]);
      surface().focus();
      key("F2");
      type("Uno");
      key("Escape", {}, input());
      const label = labelId();
      expect(editor.engine.apply({ op: "set", id: R, attrs: { x: "0", width: "100" } }).outcome).toBe("applied");
      const [x, y] = middleOf(label);
      expect(x).toBeCloseTo(50, 2);
      expect(y).toBeCloseTo(160, 2);
      expect(textRich(editor.engine.holder(label)!)!.attrs["fub:wrap"]).toBe("88");
    });

    it("un'etichetta che esce dalla pagina la fa crescere, nello stesso passo", () => {
      mount(SHAPE, { level: "standard" });
      editor.select([R]);
      surface().focus();
      key("F2");
      type("uno due tre quattro cinque sei sette otto nove dieci undici dodici");
      key("Escape", {}, input());
      expect(changes).toHaveLength(1);
      const [, , , height] = editor.engine.text.match(/viewBox="([^"]*)"/)![1]!.split(" ").map(Number);
      expect(height).toBeGreaterThan(300);
      key("z", { ctrlKey: true });
      expect(editor.engine.text).toBe(SHAPE);
    });

    it("con la forma scelta, «Rinomina» nel menu non promette F2, che scrive l'etichetta", () => {
      mount(SHAPE, { level: "standard" });
      editor.select([R]);
      host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!.click();
      const open = document.querySelectorAll<HTMLElement>(".context-menu");
      const rename = [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")!.textContent === "Rinomina")!;
      expect(rename.querySelector(".menu-hint")).toBeNull();
    });
  });

  it("«?» elenca i tasti del testo", async () => {
    mount(SOURCE, { level: "standard" });
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Testo");
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Space", "Con lo strumento Testo: scrive dov’è il cursore, o cambia il testo che c’è"]);
    expect(rows).toContainEqual(["F2", "Modifica il testo scelto, o l’etichetta della forma scelta"]);
    expect(rows).toContainEqual(["Enter", "Va a capo, mentre si scrive"]);
    expect(rows).toContainEqual(["Esc o Tab o Ctrl+Enter", "Conclude il testo, mentre si scrive"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    // L'elenco si chiude con la sua risposta, prima del test dopo.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("i poligoni e le stelle, dal livello Standard", () => {
  const A = "o1a2b3c4d";
  const H = "oh1h1h1h1";
  const hexagon = (geom: string): string => {
    const attrs = polygonalAttrs(readPolygonal("polygon", geom)!)!;
    return `<path id="${H}" fub:shape="polygon" fub:geom="${attrs["fub:geom"]}" d="${attrs.d}" fill="none" stroke="#000000" stroke-width="2"/>`;
  };
  /// Un rettangolo pieno da (100, 100) a (200, 150), e un esagono di raggio
  /// 50 attorno a (200, 300).
  const SHAPES = doc(`${LAYER}<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000"/>${hexagon("200 300 50 6 0 0")}</g>`);
  const toolButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-keyshortcuts="Y"], [role="toolbar"] button[aria-label="Poligono"], [role="toolbar"] button[aria-label="Stella"]')!;
  const press = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const move = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const release = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const hover = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  };
  const painted = (id: string): Element => host.querySelector(`[data-scene-id="${id}"]`)!;

  it("il Poligono disegna dal centro, col vertice sotto il puntatore, e lo dice per nome", () => {
    mount(SOURCE, { level: "standard" });
    editor.setTool("polygon");
    expect(spoken()).toBe("Strumento: Poligono.");
    drag([[200, 200], [200, 170], [200, 150]]);
    expect(editor.engine.text).toMatch(
      /<path id="o[a-z0-9]{8}" fub:shape="polygon" fub:geom="200 200 50 6 -30 0" d="M200 250 L156.7 225 L156.7 175 L200 150 L243.3 175 L243.3 225 Z" fill="none" stroke="#000000" stroke-width="4"\/>/,
    );
    expect(spoken()).toBe("Esagono aggiunto. Il disegno ha 2 oggetti.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Poligono.");
    // Un tocco non disegna niente.
    drag([[200, 200], [201, 201]]);
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("Y di nuovo, o il pulsante, passa alla stella e ritorno; la stella ha una punta sotto il puntatore", () => {
    mount(SOURCE, { level: "standard" });
    key("y");
    expect(editor.tool).toBe("polygon");
    key("y");
    expect(spoken()).toBe("Strumento: Stella.");
    expect(toolButton().getAttribute("aria-label")).toBe("Stella");
    drag([[200, 200], [200, 160]]);
    expect(editor.engine.text).toContain('fub:shape="star" fub:geom="200 200 40 5 0.382 0 0" d="M200 160 ');
    expect(spoken()).toBe("Stella a 5 punte aggiunta. Il disegno ha 2 oggetti.");
    toolButton().click();
    expect(spoken()).toBe("Strumento: Poligono.");
    expect(toolButton().getAttribute("aria-label")).toBe("Poligono");
    // Un altro strumento, e di nuovo Y: si torna al poligono di prima.
    editor.setTool("rect");
    key("y");
    expect([editor.tool, toolButton().getAttribute("aria-label")]).toEqual(["polygon", "Poligono"]);
  });

  it("mentre si trascina, ↑ e ↓ cambiano i lati, ← e → il raggio interno della stella, e Maiusc la tiene diritta", () => {
    mount(SOURCE, { level: "standard" });
    editor.setTool("polygon");
    press(200, 200);
    move(200, 150);
    key("ArrowUp");
    key("ArrowUp");
    expect(spoken()).toBe("Ottagono.");
    release(200, 150);
    expect(editor.engine.text).toContain('fub:geom="200 200 50 8 -22.5 0"');
    // I lati restano per la forma dopo.
    drag([[300, 200], [330, 240]], { shiftKey: true });
    expect(editor.engine.text).toContain('fub:geom="300 200 50 8 0 0"');
    key("y");
    // Lontano dagli altri, perché niente si agganci.
    press(437, 419);
    move(437, 369);
    key("ArrowRight");
    expect(spoken()).toBe("Raggio interno 40%.");
    key("PageDown");
    expect(spoken()).toBe("Stella a 4 punte.");
    // Le frecce non spostano niente mentre si disegna.
    expect(editor.selection).toEqual([]);
    release(437, 369);
    expect(editor.engine.text).toContain('fub:shape="star" fub:geom="437 419 50 4 0.4 0 0"');
    expect(spoken()).toBe("Stella a 4 punte aggiunta. Il disegno ha 4 oggetti.");
  });

  it("da tastiera: Spazio preme sul centro, le frecce tirano il vertice, PgUp e PgDn cambiano i lati", () => {
    mount(SOURCE, { level: "standard" });
    size(400, 300);
    key("y");
    key("ArrowRight");
    key(" ");
    key("ArrowUp", { shiftKey: true });
    key("PageUp");
    expect(spoken()).toBe("Ettagono.");
    key(" ");
    // Con un numero dispari di lati, diritto vuol dire un vertice in alto.
    expect(editor.engine.text).toContain('fub:shape="polygon" fub:geom="210 150 50 7 0 0"');
    // Il vertice tirato è sul bordo della pagina, e si aggancia.
    expect(spoken()).toBe("Ettagono aggiunto. Il disegno ha 2 oggetti. Agganciato: il punto in linea con il bordo inferiore della pagina.");
  });

  it("Esc a metà lascia il disegno com'era", () => {
    mount(SOURCE, { level: "standard" });
    editor.setTool("polygon");
    press(200, 200);
    move(240, 230);
    key("Escape");
    release(240, 230);
    expect(editor.engine.text).toBe(SOURCE);
    expect(changes).toEqual([]);
  });

  it("all'Essenziale non c'è, e Y non fa niente", () => {
    mount(SOURCE);
    key("y");
    expect(editor.tool).toBe("pen");
    expect(host.querySelector('[role="toolbar"] button[data-tool="polygon"]:not([hidden])')).toBeNull();
  });

  it("«Forma» nel pannello: senza selezione lo strumento, con un poligono scelto i suoi lati e il tipo, un passo ciascuno", () => {
    mount(SHAPES, { level: "standard" });
    editor.setTool("polygon");
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
    expect(property("shape").textContent).toContain("Per i poligoni e le stelle che disegnerai.");
    expect(propertyLabel("count")).toBe("Lati");
    enter(propertyInput("count"), "5");
    drag([[400, 200], [400, 150]]);
    expect(editor.engine.text).toContain('fub:geom="400 200 50 5 0 0"');
    // Il tipo dello strumento dal pannello: il pulsante lo segue.
    property("shape").querySelector<HTMLButtonElement>('button[aria-label="Stella"]')!.click();
    expect(toolButton().getAttribute("aria-label")).toBe("Stella");
    expect(propertyLabel("count")).toBe("Punte");
    expect(propertyInput("inner").value).toBe("38,2");
    // Con l'esagono scelto, il pannello cambia lui.
    editor.setTool("select");
    editor.select([H]);
    expect(propertyLabel("count")).toBe("Lati");
    expect(propertyInput("count").value).toBe("6");
    const before = editor.engine.text;
    enter(propertyInput("count"), "8");
    expect(editor.engine.text).toContain(`<path id="${H}" fub:shape="polygon" fub:geom="200 300 50 8 0 0" d="${polygonalAttrs(readPolygonal("polygon", "200 300 50 8 0 0")!)!.d}"`);
    expect(editor.selection).toEqual([H]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Lati o punte.");
    expect(editor.engine.text).toBe(before);
    property("shape").querySelector<HTMLButtonElement>('button[aria-label="Stella"]')!.click();
    expect(editor.engine.text).toContain(`<path id="${H}" fub:shape="star" fub:geom="200 300 50 6 0.382 0 0"`);
    expect(propertyLabel("count")).toBe("Punte");
    editor.undo();
    expect(spoken()).toBe("Annullato: Tipo di forma.");
    // Il raggio degli angoli vale anche per il rettangolo, in un passo.
    editor.select([A, H]);
    enter(propertyInput("corner"), "4");
    expect(editor.engine.text).toContain(`<rect id="${A}" x="100" y="100" width="100" height="50" rx="4" fill="#000000"/>`);
    expect(editor.engine.text).toContain('fub:geom="200 300 50 6 0 4"');
    editor.undo();
    expect(spoken()).toBe("Annullato: Raggio degli angoli.");
    expect(editor.engine.text).toBe(before);
  });

  it("la maniglia degli angoli arrotonda il rettangolo scelto mentre la si tira, in un passo che si annulla", () => {
    mount(SHAPES, { level: "standard" });
    editor.setTool("select");
    editor.select([A]);
    // Sulla bisettrice dell'angolo in alto a sinistra, 16 pixel dentro.
    const at = 100 + 16 * Math.SQRT1_2;
    hover(at, at);
    expect(surface().dataset.grip).toBe("nwse");
    press(at, at);
    move(at + 5, at + 5);
    move(at + 10, at + 10);
    expect(painted(A).getAttribute("rx")).toBe("10");
    expect(editor.engine.text).toBe(SHAPES);
    release(at + 10, at + 10);
    expect(editor.engine.text).toContain(`<rect id="${A}" x="100" y="100" width="100" height="50" rx="10" fill="#000000"/>`);
    expect(spoken()).toBe("Raggio degli angoli 10.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    // La maniglia sta dove il raggio l'ha portata, e torna indietro.
    press(at + 10, at + 10);
    move(at - 20, at - 20);
    release(at - 20, at - 20);
    expect(editor.engine.text).toBe(SHAPES);
    editor.undo();
    editor.undo();
    expect(spoken()).toBe("Annullato: Raggio degli angoli.");
    expect(editor.engine.text).toBe(SHAPES);
  });

  it("e quella di un poligono sta sul vertice più in alto, e scrive il raggio nella sua geometria", () => {
    mount(SHAPES, { level: "standard" });
    editor.setTool("select");
    editor.select([H]);
    // Il vertice in alto a sinistra è in (175, 256,7); la bisettrice va al
    // centro, a 60° sotto l'orizzontale.
    const [ix, iy] = [0.5, Math.sqrt(3) / 2];
    const [x, y] = [175 + 16 * ix, 300 - 25 * Math.sqrt(3) + 16 * iy];
    hover(x, y);
    expect(surface().dataset.grip).toBe("nwse");
    // 10 di raggio portano il centro dell'arco 10 / sin 60° più in là.
    const along = 10 / (Math.sqrt(3) / 2);
    press(x, y);
    move(x + along * ix, y + along * iy);
    expect(painted(H).getAttribute("d")).toBe(polygonalAttrs(readPolygonal("polygon", "200 300 50 6 0 10")!)!.d);
    release(x + along * ix, y + along * iy);
    expect(editor.engine.text).toContain('fub:geom="200 300 50 6 0 10"');
    expect(spoken()).toBe("Raggio degli angoli 10.");
  });

  it("un tocco sulla maniglia o Esc a metà non cambiano niente; Esc riporta la forma di prima", () => {
    mount(SHAPES, { level: "standard" });
    editor.setTool("select");
    editor.select([A]);
    const at = 100 + 16 * Math.SQRT1_2;
    drag([[at, at], [at, at]]);
    expect(editor.selection).toEqual([A]);
    press(at, at);
    move(at + 20, at + 20);
    expect(painted(A).getAttribute("rx")).toBe("20");
    key("Escape");
    expect(painted(A).hasAttribute("rx")).toBe(false);
    release(at + 20, at + 20);
    expect(editor.engine.text).toBe(SHAPES);
    expect(changes).toEqual([]);
  });

  it("non c'è su una forma troppo piccola sullo schermo, con più oggetti scelti, o all'Essenziale", () => {
    mount(SOURCE, { level: "standard" });
    editor.setTool("select");
    // Un quadrato di 20: la maniglia avrebbe meno di 32 pixel per scorrere.
    editor.select([A]);
    const at = 60 + 16 * Math.SQRT1_2;
    hover(at, at);
    expect(surface().dataset.grip).toBeUndefined();
    owner.close();
    owner = openLifetime();
    host.replaceChildren();
    mount(SHAPES, { level: "standard" });
    editor.setTool("select");
    editor.select([A, H]);
    hover(100 + 16 * Math.SQRT1_2, 100 + 16 * Math.SQRT1_2);
    expect(surface().dataset.grip).toBeUndefined();
    editor.setLevel("essential");
    editor.select([A]);
    hover(100 + 16 * Math.SQRT1_2, 100 + 16 * Math.SQRT1_2);
    expect(surface().dataset.grip).toBeUndefined();
  });

  it("«?» elenca i tasti del poligono", () => {
    mount(SOURCE, { level: "standard" });
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Poligono");
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Y", "Di nuovo, dal poligono alla stella e ritorno"]);
    expect(rows).toContainEqual(["↑ o ↓ o PgUp o PgDn", "Mentre si disegna, un lato o una punta in più o in meno; disegnando con la tastiera, PgUp e PgDn"]);
    expect(rows).toContainEqual(["← o →", "Mentre si disegna una stella, il raggio interno"]);
    expect(rows).toContainEqual(["Shift", "Tenuto, la forma resta diritta"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("le forme dal tratto, dal livello Standard", () => {
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
    mount(PAGE, { level: "standard" });
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
    mount(PAGE, { level: "standard" });
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
    mount(PAGE, { level: "standard" });
    press(LINE);
    hold(500);
    expect(spoken()).toBe("Linea.");
    moveTo(300, 200);
    lift(300, 200);
    expect(editor.engine.text).toMatch(/<line id="o[a-z0-9]{8}" x1="100" y1="100" x2="300" y2="200" stroke="#000000" stroke-width="4"/);
  });

  it("un tratto piccolo, o che non somiglia a una forma, resta inchiostro e si continua a disegnare", () => {
    mount(PAGE, { level: "standard" });
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
    mount(PAGE, { level: "standard" });
    press(RECT);
    hold(500);
    key("Escape");
    expect(preview()).toBeNull();
    lift(100, 100);
    expect(changes).toEqual([]);
    expect(editor.engine.text).toBe(PAGE);
  });

  it("non c'è all'Essenziale, con l'evidenziatore, né con l'interruttore spento, che si ricorda", () => {
    const grids: unknown[] = [];
    mount(PAGE, { onGridChange: (grid) => grids.push(grid) });
    press(RECT);
    hold(600);
    lift(100, 100);
    expect(strokes()).toHaveLength(1);
    editor.setLevel("standard");
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
    mount(PAGE, { level: "standard" });
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
    editor.setLevel("essential");
    editor.select([rect!]);
    expect(shapeButton().hidden).toBe(true);
  });

  it("«?» elenca il tasto delle forme dal tratto", () => {
    mount(SOURCE, { level: "standard" });
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Forme dal tratto")?.rows).toEqual([["Shift", "Tenuto, la forma dal tratto resta regolare"]]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il pannello delle proprietà, dal livello Standard", () => {
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
    mount(SOURCE, { level: "standard", onGridChange: (grid) => panels.push(grid.panel) });
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
    // Senza il pannello, all'Essenziale, il pulsante apre una finestra.
    editor.setLevel("essential");
    expect(button().getAttribute("aria-haspopup")).toBe("dialog");
    expect(button().hasAttribute("aria-expanded")).toBe(false);
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
    mount(SOURCE, { level: "standard" });
    // Finché l'editor non ha una misura, il pannello aspetta di saperla.
    expect(properties().hidden).toBe(true);
    measured(1000);
    expect(properties().hidden).toBe(false);
    // Aprirsi da sé non è una scelta di chi disegna: non si ricorda.
    expect(editor.grid.panel).toBeNull();
    editor.dispose();

    mount(SOURCE, { level: "standard" });
    measured(400);
    expect(properties().hidden).toBe(true);
    editor.dispose();

    mount(SOURCE, { level: "standard", grid: { ...editor.grid, panel: false } });
    measured(1000);
    expect(properties().hidden).toBe(true);
    // Chi monta l'editor lo riapre come l'aveva lasciato chi disegna.
    editor.setGrid({ ...editor.grid, panel: true });
    expect(properties().hidden).toBe(false);
    expect(document.activeElement).not.toBe(propertyInput("pageWidth"));
  });

  it("Invio ci porta; posizione e misure si scrivono, ciascuna in un passo che si annulla col suo nome", () => {
    mount(TWO, { level: "standard" });
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
    mount(TWO, { level: "standard" });
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
    mount(TWO, { level: "standard" });
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
    mount(TEXT, { level: "standard" });
    editor.select([T]);
    key("Enter");
    const toggle = (label: string): HTMLButtonElement => property("emphasis").querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const opening = (): string => /<text [^>]*>/.exec(editor.engine.text)![0];
    // Il grassetto di una parola rende misto il peso. Lo stile di serie,
    // dallo Standard, sta nel menu degli stili di testo.
    expect(property("preset")).toBeNull();
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
    mount(TWO, { level: "standard" });
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
    mount(TWO, { level: "standard", onGridChange: (grid) => grids.push([grid.panel, grid.shown]) });
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
    mount(TWO, { level: "standard" });
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

describe("i colori del documento, dal livello Standard", () => {
  const A = "o1a2b3c4d";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  /// Il campione «Blu marca», che il riempimento di A usa; B e C hanno il
  /// colore scritto, C proprio quello del campione.
  const SWATCHED = doc(
    '<defs id="fub-defs"><linearGradient id="rs" fub:role="swatch" fub:name="Blu marca" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient></defs>' +
      `${LAYER}<rect id="${A}" x="60" y="60" width="20" height="20" fill="url(#rs) #0072b2" stroke="#000000" stroke-width="2"/>` +
      `<rect id="${B}" x="10" y="20" width="10" height="10" fill="#d55e00"/><rect id="${C}" x="30" y="20" width="10" height="10" fill="#0072b2"/></g>`,
  );
  const panelButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;
  const section = (): HTMLElement => properties().querySelector<HTMLElement>('.draw-properties-section[data-section="colors"]')!;
  const group = (kind: string): HTMLElement => section().querySelector<HTMLElement>(`.draw-swatches-group[data-group="${kind}"]`)!;
  const chips = (kind: string): HTMLButtonElement[] => [...group(kind).querySelectorAll<HTMLButtonElement>(".draw-swatches-chip")];
  const chip = (kind: string, key: string): HTMLButtonElement => group(kind).querySelector<HTMLButtonElement>(`.draw-swatches-chip[data-key="${key}"]`)!;
  const keys = (kind: string): string[] => chips(kind).map((each) => each.dataset.key!);
  const labels = (kind: string): string[] => chips(kind).map((each) => each.getAttribute("aria-label")!);
  /// I colori detti «di adesso», con la loro griglia.
  const current = (): string[] =>
    [...section().querySelectorAll<HTMLElement>('.draw-swatches-chip[aria-current="true"]')].map(
      (each) => `${each.closest<HTMLElement>(".draw-swatches-group")!.dataset.group} ${each.dataset.key}`,
    );
  const addButton = (): HTMLButtonElement => section().querySelector<HTMLButtonElement>(".draw-swatches-add")!;
  const targetButton = (target: string): HTMLButtonElement => section().querySelector<HTMLButtonElement>(`.draw-swatches-target [data-target="${target}"]`)!;
  const form = (): HTMLElement => section().querySelector<HTMLElement>(".draw-swatches-form")!;
  const formTitle = (): string => form().querySelector(".draw-swatches-form-title")!.textContent!;
  const nameInput = (): HTMLInputElement => form().querySelectorAll<HTMLInputElement>('input[type="text"]')[0]!;
  const colorInput = (): HTMLInputElement => form().querySelectorAll<HTMLInputElement>('input[type="text"]')[1]!;
  const shiftClick = (target: HTMLElement): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
  };
  /// Il menu di un colore, col clic destro, e una sua voce.
  const menuOf = (kind: string, key: string): void => {
    chip(kind, key).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  };
  const item = (label: string): HTMLButtonElement => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")!.textContent === label)!;
  };
  /// Il rettangolo `id` com'è scritto adesso.
  const rect = (id: string): string => new RegExp(`<rect id="${id}"[^>]*/>`).exec(editor.engine.text)![0];
  /// Il colore dei tratti della penna e del contorno dei rettangoli nuovi,
  /// nell'ordine del file.
  const inked = (): string[] => [...editor.engine.text.matchAll(/fub:tool="pen"[^>]*? fill="([^"]*)"/g)].map((match) => match[1]!);
  const outlined = (): string[] =>
    [...editor.engine.text.matchAll(new RegExp(`<rect id="(?!(?:${A}|${B}|${C})")[^"]*"[^>]*? stroke="([^"]*)"`, "g"))].map((match) => match[1]!);
  /// Il colore che la barra dà per scelto.
  const checked = (): string | null => well().querySelector(".kit-color-well-name")?.textContent ?? null;

  afterEach(() => {
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("mostra i campioni, i colori scritti e i recenti, contati, e il colore di adesso", () => {
    mount(SWATCHED, { level: "standard", colors: ["#e69f00"] });
    panelButton().click();
    expect(section().hidden).toBe(false);
    expect(labels("swatches")).toEqual(["Blu marca, campione #0072b2, usato da 1 oggetto"]);
    expect(keys("used")).toEqual(["#000000", "#d55e00", "#0072b2"]);
    expect(labels("used")).toEqual(["Nero, usato da 1 oggetto", "Vermiglio, usato da 1 oggetto", "Blu, usato da 1 oggetto"]);
    expect(keys("recent")).toEqual(["#e69f00"]);
    // Senza selezione il colore di adesso è quello con cui si disegna.
    expect(current()).toEqual(["used #000000"]);
    expect(formatIssues(checkAccessibility(section()))).toBe("");
    // Con una selezione, quello del riempimento; «Applica a» sceglie il
    // contorno.
    editor.select([A]);
    expect(current()).toEqual(["swatches rs"]);
    targetButton("stroke").click();
    expect(current()).toEqual(["used #000000"]);
    expect(formatIssues(checkAccessibility(section()))).toBe("");
  });

  it("un clic dà il colore al riempimento della selezione e Maiusc al contorno; un campione si scrive col suo colore", () => {
    const remembered: (readonly string[])[] = [];
    mount(SWATCHED, { level: "standard", onColorsChange: (colors) => remembered.push(colors) });
    editor.select([B]);
    key("Enter");
    chip("swatches", "rs").click();
    expect(rect(B)).toBe(`<rect id="${B}" x="10" y="20" width="10" height="10" fill="url(#rs) #0072b2"/>`);
    expect(spoken()).toBe("Riempimento: Blu marca.");
    expect(labels("swatches")).toEqual(["Blu marca, campione #0072b2, usato da 2 oggetti"]);
    expect(current()).toEqual(["swatches rs"]);
    // Un campione non è un colore recente: ha la sua griglia.
    expect(remembered).toEqual([]);
    shiftClick(chip("used", "#000000"));
    expect(rect(B)).toContain('stroke="#000000"');
    expect(spoken()).toBe("Contorno: Nero.");
    expect(remembered).toEqual([["#000000"]]);
    expect(keys("recent")).toEqual(["#000000"]);
    editor.undo();
    expect(rect(B)).not.toContain("stroke=");
    editor.undo();
    expect(spoken()).toBe("Annullato: Riempimento.");
    expect(editor.engine.text).toBe(SWATCHED);
  });

  it("«Nuovo campione…» fa un campione del colore della selezione, e il fuoco va a lui", () => {
    mount(SWATCHED, { level: "standard" });
    editor.select([B]);
    key("Enter");
    addButton().click();
    expect(formTitle()).toBe("Nuovo campione");
    // Un colore della tavolozza dà il suo nome al campione.
    expect(nameInput().value).toBe("Vermiglio");
    expect(colorInput().value).toBe("#d55e00");
    expect(document.activeElement).toBe(nameInput());
    key("Enter", {}, nameInput());
    const made = /<linearGradient id="([a-z0-9]+)" fub:role="swatch" fub:name="Vermiglio" gradientUnits="userSpaceOnUse">\s*<stop stop-color="#d55e00"\/>\s*<\/linearGradient>/.exec(
      editor.engine.text,
    );
    expect(made).not.toBeNull();
    // Nuovo, il campione non prende chi ha il colore scritto.
    expect(rect(B)).toContain('fill="#d55e00"');
    expect(spoken()).toBe("Campione «Vermiglio» creato.");
    expect(form().hidden).toBe(true);
    expect(keys("swatches")).toEqual(["rs", made![1]]);
    expect(document.activeElement).toBe(chip("swatches", made![1]!));
    editor.undo();
    expect(spoken()).toBe("Annullato: Nuovo campione.");
    expect(editor.engine.text).toBe(SWATCHED);
  });

  it("«Rendi campione…» dal menu di un colore scritto: chi lo usa passa al campione", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    menuOf("used", "#d55e00");
    item("Rendi campione…").click();
    expect(formTitle()).toBe("Rendi campione #d55e00");
    typeIn(nameInput(), "Accento");
    key("Enter", {}, nameInput());
    const id = /<linearGradient id="([a-z0-9]+)" fub:role="swatch" fub:name="Accento"/.exec(editor.engine.text)![1]!;
    expect(rect(B)).toBe(`<rect id="${B}" x="10" y="20" width="10" height="10" fill="url(#${id}) #d55e00"/>`);
    expect(spoken()).toBe("Campione «Accento» creato: lo usa 1 oggetto.");
    expect(keys("used")).toEqual(["#000000", "#0072b2"]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Colore reso campione.");
    expect(editor.engine.text).toBe(SWATCHED);
  });

  it("«Usa il campione» porta al campione chi ha il suo colore scritto", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    menuOf("used", "#0072b2");
    item("Usa il campione «Blu marca»").click();
    expect(rect(C)).toBe(`<rect id="${C}" x="30" y="20" width="10" height="10" fill="url(#rs) #0072b2"/>`);
    expect(spoken()).toBe("Ora «Blu marca» lo usano 2 oggetti.");
    expect(keys("used")).toEqual(["#000000", "#d55e00"]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Oggetti passati a un campione.");
    expect(editor.engine.text).toBe(SWATCHED);
  });

  it("F2 rinomina un campione, e «Cambia colore…» lo cambia per chi lo usa", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    chip("swatches", "rs").focus();
    key("F2", {}, chip("swatches", "rs"));
    expect(formTitle()).toBe("Rinomina «Blu marca»");
    expect(nameInput().value).toBe("Blu marca");
    typeIn(nameInput(), "Blu scuro");
    key("Enter", {}, nameInput());
    expect(editor.engine.text).toContain('fub:name="Blu scuro"');
    expect(spoken()).toBe("Il campione ora si chiama «Blu scuro».");
    expect(document.activeElement).toBe(chip("swatches", "rs"));
    editor.undo();
    expect(spoken()).toBe("Annullato: Nome di un campione.");
    expect(editor.engine.text).toBe(SWATCHED);

    menuOf("swatches", "rs");
    item("Cambia colore…").click();
    expect(formTitle()).toBe("Cambia il colore di «Blu marca»");
    expect(document.activeElement).toBe(colorInput());
    typeIn(colorInput(), "#56b4e9");
    key("Enter", {}, colorInput());
    expect(editor.engine.text).toContain('<stop stop-color="#56b4e9"/>');
    expect(rect(A)).toContain('fill="url(#rs) #56b4e9"');
    // Chi ha il colore di prima scritto lo tiene: non usa il campione.
    expect(rect(C)).toContain('fill="#0072b2"');
    expect(spoken()).toBe("«Blu marca» ora è Azzurro.");
    expect(labels("swatches")).toEqual(["Blu marca, campione #56b4e9, usato da 1 oggetto"]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Colore di un campione.");
    expect(editor.engine.text).toBe(SWATCHED);
  });

  it("Canc elimina un campione: chi lo usava tiene il suo colore, scritto, e il fuoco resta nella griglia", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    chip("swatches", "rs").focus();
    key("Delete", {}, chip("swatches", "rs"));
    expect(editor.engine.text).not.toContain("linearGradient");
    expect(rect(A)).toContain('fill="#0072b2"');
    expect(spoken()).toBe("Campione «Blu marca» eliminato: chi lo usava tiene il suo colore.");
    expect(keys("swatches")).toEqual([]);
    expect(document.activeElement).toBe(addButton());
    editor.undo();
    expect(spoken()).toBe("Annullato: Campione eliminato.");
    expect(editor.engine.text).toBe(SWATCHED);
  });

  it("il menu di un colore sceglie gli oggetti che lo mostrano, se si possono scegliere", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    menuOf("swatches", "rs");
    item("Scegli gli oggetti con questo campione").click();
    expect(editor.selection).toEqual([A]);
    expect(spoken()).toBe("1 oggetto scelto.");
    menuOf("used", "#0072b2");
    item("Scegli gli oggetti con questo colore").click();
    expect(editor.selection).toEqual([C]);
    editor.dispose();

    mount(
      doc(
        `${LAYER}<rect id="${A}" x="0" y="0" width="5" height="5" fill="#000000"/></g>` +
          `<g id="l2" fub:layer="Bloccato" fub:locked="true"><rect id="${B}" x="10" y="0" width="5" height="5" fill="#009e73"/></g>`,
      ),
      { level: "standard" },
    );
    editor.select([A]);
    key("Enter");
    menuOf("used", "#009e73");
    item("Scegli gli oggetti con questo colore").click();
    expect(spoken()).toBe("Nessun oggetto che si può scegliere mostra questo colore.");
    expect(editor.selection).toEqual([A]);
  });

  it("senza selezione un campione è il colore con cui si disegna: gli oggetti nuovi lo usano e lo seguono", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    chip("swatches", "rs").click();
    expect(spoken()).toBe("Colore: Blu marca.");
    expect(current()).toEqual(["swatches rs"]);
    expect(checked()).toBe("Blu");
    drag([[100, 100], [140, 120]]);
    editor.setTool("rect");
    drag([[100, 20], [130, 50]]);
    expect(editor.selection).toEqual([]);
    expect(inked()).toEqual(["url(#rs) #0072b2"]);
    expect(outlined()).toEqual(["url(#rs) #0072b2"]);
    expect(labels("swatches")).toEqual(["Blu marca, campione #0072b2, usato da 3 oggetti"]);

    // Il campione cambia colore, e ciò che si disegna con lui; anche
    // annullando.
    menuOf("swatches", "rs");
    item("Cambia colore…").click();
    typeIn(colorInput(), "#009e73");
    key("Enter", {}, colorInput());
    expect(checked()).toBe("Verde");
    expect(current()).toEqual(["swatches rs"]);
    // Annullare sceglie gli oggetti che tornano come prima.
    editor.undo();
    expect(checked()).toBe("Blu");
    editor.select([]);
    expect(current()).toEqual(["swatches rs"]);

    // Un colore della barra lascia il campione.
    pickSwatch("Vermiglio");
    well().click();
    expect(current()).toEqual(["used #d55e00", "recent #d55e00"]);
    drag([[140, 20], [170, 50]]);
    expect(outlined()).toEqual(["url(#rs) #0072b2", "#d55e00"]);

    // Se il campione se ne va, ciò che si disegna tiene il suo colore,
    // scritto.
    chip("swatches", "rs").click();
    chip("swatches", "rs").focus();
    key("Delete", {}, chip("swatches", "rs"));
    expect(current()).toEqual(["used #0072b2"]);
    drag([[180, 20], [210, 50]]);
    expect(outlined()).toEqual(["#0072b2", "#d55e00", "#0072b2"]);
  });

  it("il colore lascia il campione con un disegno nuovo, o senza «Colori del documento»; e lì la sezione non c'è", () => {
    mount(SWATCHED, { level: "standard" });
    panelButton().click();
    chip("swatches", "rs").click();
    editor.setLevel("custom", ["pen", "properties", "colors"]);
    expect(section().hidden).toBe(true);
    editor.setLevel("standard");
    expect(section().hidden).toBe(false);
    expect(current()).toEqual(["used #0072b2"]);
    drag([[100, 100], [140, 120]]);
    expect(inked()).toEqual(["#0072b2"]);

    chip("swatches", "rs").click();
    editor.setEngine(SceneEngine.open(SOURCE));
    expect(keys("swatches")).toEqual([]);
    drag([[100, 100], [140, 120]]);
    expect(inked()).toEqual(["#0072b2"]);
  });

  it("i colori scritti entrano fra i recenti, che chi monta l'editor ricorda; i campioni no", () => {
    const remembered: (readonly string[])[] = [];
    mount(SWATCHED, { level: "standard", colors: ["#cc79a7"], onColorsChange: (colors) => remembered.push(colors) });
    editor.select([B]);
    key("Enter");
    expect(keys("recent")).toEqual(["#cc79a7"]);
    enter(propertyInput("fill"), "#e69f00");
    expect(remembered).toEqual([["#e69f00", "#cc79a7"]]);
    expect(keys("recent")).toEqual(["#e69f00", "#cc79a7"]);
    // Il campione scritto per nome nel campo non è un recente.
    enter(propertyInput("fill"), "blu marca");
    expect(rect(B)).toContain('fill="url(#rs) #0072b2"');
    expect(remembered).toHaveLength(1);
    // Un recente si dà come gli altri colori.
    chip("recent", "#cc79a7").click();
    expect(rect(B)).toContain('fill="#cc79a7"');
    expect(remembered[1]).toEqual(["#cc79a7", "#e69f00"]);
    // I recenti di un'altra finestra, da chi monta l'editor, non gli
    // tornano indietro.
    editor.setRecentColors(["#56b4e9", "#3a7bd5"]);
    expect(keys("recent")).toEqual(["#56b4e9", "#3a7bd5"]);
    expect(labels("recent")).toEqual(["Azzurro", "#3a7bd5"]);
    expect(remembered).toHaveLength(2);
  });

  it("in sola lettura la sezione mostra i colori, e un gesto dice perché non cambia nulla", () => {
    mount(SWATCHED, { level: "standard" });
    editor.select([B]);
    key("Enter");
    editor.setReadOnly(true);
    chip("swatches", "rs").click();
    expect(spoken()).toBe("Modifica non applicata: il disegno è in sola lettura.");
    expect(addButton().getAttribute("aria-disabled")).toBe("true");
    expect(changes).toEqual([]);
  });
});

describe("gli stili del documento, dal livello Standard", () => {
  const A = "o1a2b3c4d";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  const T = "ot4t4t4t4";
  const BOX = '<polyline id="rbox00000" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#e69f00" stroke="#000000" stroke-width="2"/>';
  const TITLE = '<text id="rtitle000" fub:role="style" fub:name="Titolo" fill="#1a1a1a" font-family="Inter, sans-serif" font-size="48" font-weight="600"/>';
  /// Lo stile «Riquadro», che A segue con un contorno più spesso e C così
  /// com'è; B non segue niente; il testo T nemmeno.
  const STYLED = doc(
    `<defs id="fub-defs">${BOX}${TITLE}</defs>` +
      `${LAYER}<rect id="${A}" fub:style="rbox00000" x="60" y="60" width="20" height="20" fill="#e69f00" stroke="#000000" stroke-width="4"/>` +
      `<rect id="${B}" x="10" y="20" width="10" height="10" fill="#0072b2"/>` +
      `<rect id="${C}" fub:style="rbox00000" x="30" y="20" width="10" height="10" fill="#e69f00" stroke="#000000" stroke-width="2"/>` +
      `<text id="${T}" x="10" y="140" fill="#000000" font-family="Inter, sans-serif" font-size="32"><tspan x="10" dy="0">Capitolo</tspan></text></g>`,
  );
  const face = (id: string): HTMLButtonElement => property(id).querySelector<HTMLButtonElement>(".draw-properties-menu")!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  /// Apre il menu del campo `id` e ne preme la voce `label`.
  const pick = (id: string, label: string): void => {
    face(id).click();
    menu().find((entry) => labelOf(entry) === label)!.click();
  };
  const ask = (id: string): HTMLElement => property(id).querySelector<HTMLElement>(".draw-properties-ask")!;
  const askInput = (id: string): HTMLInputElement => ask(id).querySelector<HTMLInputElement>("input")!;
  /// L'elemento `id` com'è scritto adesso.
  const element = (id: string): string => new RegExp(`<[a-z]+ id="${id}"[^>]*>`).exec(editor.engine.text)?.[0] ?? "";

  afterEach(() => {
    closeContextMenu();
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("la riga dice lo stile della selezione, e sceglierne uno lo dà, in un passo col suo nome", () => {
    mount(STYLED, { level: "standard" });
    editor.select([B]);
    key("Enter");
    expect(face("lookStyle").getAttribute("aria-label")).toBe("Stile grafico: Nessuno");
    face("lookStyle").click();
    expect(menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled") === "true"])).toEqual([
      ["Riquadro", false],
      ["Nuovo stile dalla selezione…", false],
      ["Aggiorna lo stile dalla selezione", true],
      ["Torna allo stile", true],
      ["Scollega dallo stile", true],
      ["Rinomina lo stile…", true],
      ["Elimina lo stile", true],
    ]);
    expect(formatIssues(checkAccessibility(document.querySelector<HTMLElement>(".context-menu")!))).toBe("");
    closeContextMenu();
    pick("lookStyle", "Riquadro");
    expect(element(B)).toBe(`<rect id="${B}" fub:style="rbox00000" x="10" y="20" width="10" height="10" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("Stile «Riquadro» applicato a 1 oggetto.");
    expect(face("lookStyle").getAttribute("aria-label")).toBe("Stile grafico: Riquadro");
    expect(formatIssues(checkAccessibility(properties()))).toBe("");
    editor.undo();
    expect(spoken()).toBe("Annullato: Stile applicato.");
    expect(editor.engine.text).toBe(STYLED);
  });

  it("«Nuovo stile dalla selezione…» chiede il nome nel pannello, e lo stile nuovo lo segue chi era scelto", () => {
    mount(STYLED, { level: "standard" });
    editor.select([B]);
    key("Enter");
    pick("lookStyle", "Nuovo stile dalla selezione…");
    expect(ask("lookStyle").hidden).toBe(false);
    expect(ask("lookStyle").textContent).toContain("Nuovo stile grafico");
    expect(askInput("lookStyle").value).toBe("Stile grafico 1");
    expect(document.activeElement).toBe(askInput("lookStyle"));
    // Un nome che c'è già non va, e il modulo lo dice e resta.
    enter(askInput("lookStyle"), "riquadro");
    expect(ask("lookStyle").hidden).toBe(false);
    expect(askInput("lookStyle").getAttribute("aria-invalid")).toBe("true");
    expect(ask("lookStyle").textContent).toContain("C’è già uno stile «riquadro» di questo tipo: scegline un altro.");
    expect(editor.engine.text).toBe(STYLED);
    enter(askInput("lookStyle"), "Avviso");
    // Lo stile nuovo dice tutto l'aspetto che si vede, anche ciò che B non
    // scrive: chi lo segue poi avrà lo stesso aspetto.
    const made =
      /<polyline id="([a-z0-9]+)" fub:role="style" fub:name="Avviso" points="0,0 100,0 100,100" fill="#0072b2" stroke="none" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="none"\/>/.exec(
        editor.engine.text,
      );
    expect(made).not.toBeNull();
    expect(element(B)).toBe(`<rect id="${B}" fub:style="${made![1]}" x="10" y="20" width="10" height="10" fill="#0072b2"/>`);
    expect(spoken()).toBe("Stile «Avviso» creato: lo segue 1 oggetto.");
    expect(ask("lookStyle").hidden).toBe(true);
    expect(document.activeElement).toBe(face("lookStyle"));
    expect(face("lookStyle").getAttribute("aria-label")).toBe("Stile grafico: Avviso");
    editor.undo();
    expect(spoken()).toBe("Annullato: Nuovo stile.");
    expect(editor.engine.text).toBe(STYLED);
  });

  it("aggiornare, tornare, rinominare ed eliminare lavorano sullo stile che la selezione segue", () => {
    mount(STYLED, { level: "standard" });
    editor.select([A]);
    key("Enter");
    expect(face("lookStyle").getAttribute("aria-label")).toBe("Stile grafico: Riquadro, modificato");
    expect(property("strokeWidth").hasAttribute("data-differs")).toBe(true);
    expect(property("fill").hasAttribute("data-differs")).toBe(false);
    expect(property("lookStyle").textContent).toContain("Diverso dallo stile: spessore.");
    pick("lookStyle", "Aggiorna lo stile dalla selezione");
    expect(element("rbox00000")).toContain('stroke-width="4"');
    expect(element(C)).toContain('stroke-width="4"');
    expect(spoken()).toBe("Stile «Riquadro» aggiornato: lo seguono 2 oggetti.");
    expect(face("lookStyle").getAttribute("aria-label")).toBe("Stile grafico: Riquadro");
    expect(property("strokeWidth").hasAttribute("data-differs")).toBe(false);
    editor.undo();
    expect(spoken()).toBe("Annullato: Stile aggiornato.");
    expect(editor.engine.text).toBe(STYLED);
    // Annulla sceglie ciò che il passo ha toccato: C.
    expect(editor.selection).toEqual([C]);
    editor.select([A]);
    pick("lookStyle", "Torna allo stile");
    expect(element(A)).toContain('stroke-width="2"');
    expect(spoken()).toBe("1 oggetto torna allo stile «Riquadro».");
    pick("lookStyle", "Rinomina lo stile…");
    expect(ask("lookStyle").textContent).toContain("Rinomina «Riquadro»");
    expect(askInput("lookStyle").value).toBe("Riquadro");
    enter(askInput("lookStyle"), "Avviso");
    expect(element("rbox00000")).toContain('fub:name="Avviso"');
    expect(spoken()).toBe("Lo stile ora si chiama «Avviso».");
    pick("lookStyle", "Elimina lo stile");
    expect(editor.engine.text).not.toContain("rbox00000");
    expect(element(A)).toBe(`<rect id="${A}" x="60" y="60" width="20" height="20" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("Stile «Avviso» eliminato: 2 oggetti che lo seguivano tengono il loro aspetto.");
    expect(face("lookStyle").getAttribute("aria-label")).toBe("Stile grafico: Nessuno");
    editor.undo();
    expect(spoken()).toBe("Annullato: Stile eliminato.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Nome di uno stile.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Ritorno allo stile.");
    expect(editor.engine.text).toBe(STYLED);
  });

  it("«Scollega dallo stile» lascia l'aspetto, e un testo sceglie fra i suoi stili e quelli di serie", () => {
    mount(STYLED, { level: "standard" });
    editor.select([C]);
    key("Enter");
    pick("lookStyle", "Scollega dallo stile");
    expect(element(C)).toBe(`<rect id="${C}" x="30" y="20" width="10" height="10" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("1 oggetto scollegato dallo stile: tiene il suo aspetto.");
    editor.select([T]);
    expect(face("textStyle").getAttribute("aria-label")).toBe("Stile di testo: Nessuno");
    face("textStyle").click();
    // «Titolo» c'è già nel documento: quello di serie non si offre.
    expect(menu().map(labelOf).slice(0, 5)).toEqual(["Titolo", "Sottotitolo", "Titoletto", "Testo", "Didascalia"]);
    closeContextMenu();
    pick("textStyle", "Sottotitolo");
    const made = /<text id="([a-z0-9]+)" fub:role="style" fub:name="Sottotitolo" [^>]*\/>/.exec(editor.engine.text);
    expect(made![0]).toContain('font-size="48"');
    expect(made![0]).toContain('font-weight="600"');
    expect(element(T)).toContain(`fub:style="${made![1]}"`);
    expect(element(T)).toContain('font-size="48"');
    expect(spoken()).toBe("Stile «Sottotitolo» creato: lo segue 1 oggetto.");
    pick("textStyle", "Titolo");
    expect(element(T)).toContain('fub:style="rtitle000"');
    expect(element(T)).toContain('fill="#1a1a1a"');
    expect(spoken()).toBe("Stile «Titolo» applicato a 1 oggetto.");
    editor.undo();
    editor.undo();
    expect(spoken()).toBe("Annullato: Nuovo stile.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Scollegamento dallo stile.");
    expect(editor.engine.text).toBe(STYLED);
  });

  it("senza gli stili del documento, lo stile di serie torna un menu che cambia soltanto il corpo e il peso", () => {
    mount(STYLED, { level: "custom", custom: ["text", "properties"] });
    editor.select([T]);
    key("Enter");
    expect(property("textStyle")).toBeNull();
    const select = property("preset").querySelector("select")!;
    select.value = "title";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(element(T)).toBe(`<text id="${T}" x="10" y="140" fill="#000000" font-family="Inter, sans-serif" font-size="64" font-weight="bold">`);
    expect(editor.engine.text.match(/fub:role="style"/g)).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Stile del testo.");
    expect(editor.engine.text).toBe(STYLED);
  });

  it("in sola lettura il menu si apre ma non cambia niente", () => {
    mount(STYLED, { level: "standard" });
    editor.select([B]);
    key("Enter");
    editor.setReadOnly(true);
    expect(face("lookStyle").getAttribute("aria-disabled")).toBe("true");
    expect(changes).toEqual([]);
  });
});

describe("il contagocce, dal livello Standard", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  const D = "od4d4d4d4";
  const G = "og5g5g5g5";
  const P = "op8p8p8p8";
  const IMAGE = "oi9i9i9i9";
  const UNDER = "ou0u0u0u0";
  /// A, da vestire, in alto a sinistra; B, arancione col contorno vermiglio
  /// tratteggiato e mezzo trasparente, sotto il cursore che parte dal mezzo
  /// di un foglio di 400 × 300; C col campione «Blu marca»; P col motivo; un
  /// gruppo di due forme; D in un livello bloccato, sotto gli altri; e la
  /// parte di un altro programma.
  const A_RECT = `<rect id="${A}" x="10" y="10" width="40" height="40" fill="#000000" stroke="#000000" stroke-width="2"/>`;
  const B_RECT = `<rect id="${B}" x="230" y="130" width="40" height="40" fill="#e69f00" stroke="#d55e00" stroke-width="6" stroke-dasharray="4 2" opacity="0.5"/>`;
  const LOOKS = doc(
    '<defs id="fub-defs"><linearGradient id="rs" fub:role="swatch" fub:name="Blu marca" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>' +
      '<pattern id="rpppppppp" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="#000000"/></pattern></defs>' +
      `<g id="l2" fub:layer="Sfondo" fub:locked="true"><rect id="${D}" x="300" y="200" width="40" height="40" fill="#56b4e9"/></g>` +
      `${LAYER}${A_RECT}${B_RECT}` +
      `<rect id="${C}" x="100" y="10" width="40" height="40" fill="url(#rs) #0072b2"/>` +
      `<rect id="${P}" x="10" y="200" width="40" height="40" fill="url(#rpppppppp) #000000"/>` +
      `<g id="${G}"><rect id="oh6h6h6h6" x="100" y="200" width="40" height="40" fill="#009e73"/><rect id="oj7j7j7j7" x="140" y="200" width="40" height="40" fill="#cc79a7" stroke="#56b4e9" stroke-width="4"/></g>` +
      '<rect class="estraneo" x="300" y="10" width="40" height="40" fill="#f0e442"/></g>',
  );
  /// Un'immagine di 40 × 20 pixel, la metà sinistra rossa e la destra
  /// trasparente, larga il doppio sopra un quadrato verde.
  const PICTURE = doc(
    `${LAYER}${A_RECT}<rect id="${UNDER}" x="200" y="100" width="100" height="100" fill="#009e73"/>` +
      `<image id="${IMAGE}" x="200" y="100" width="80" height="40" href="data:image/png;base64,iVBORw0KGgo="/></g>`,
  );

  /// Un codec coi pixel dell'immagine di `PICTURE`: quelli che legge, e le
  /// immagini che chiude.
  function pixelCodec(): ImageCodec & { rects: string[]; closed: number } {
    const fake = {
      rects: [] as string[],
      closed: 0,
      async decode(): Promise<Decoded | null> {
        return {
          width: 40,
          height: 20,
          opaque: () => false,
          encode: async () => null,
          pixels(rect: { x: number; y: number; width: number; height: number }, most: number) {
            fake.rects.push(`${rect.x} ${rect.y} ${rect.width} ${rect.height} ${most}`);
            const data = new Uint8ClampedArray(rect.width * rect.height * 4);
            for (let at = 0; at < data.length; at += 4) if (rect.x < 20) data.set([255, 0, 0, 255], at);
            return { width: rect.width, height: rect.height, data } as ImageData;
          },
          close() {
            fake.closed++;
          },
        };
      },
    };
    return fake;
  }

  const rect = (id: string): string => new RegExp(`<rect id="${id}"[^>]*/>`).exec(editor.engine.text)![0];
  /// Un clic nel punto `x`, `y` del foglio, che è anche quello della scena.
  const click = (x: number, y: number, init: Init = {}): void => drag([[x, y], [x, y]], init);
  const hover = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const dropper = (source = LOOKS, options: DrawEditorOptions = {}): void => {
    mount(source, { level: "standard", ...options });
    size(400, 300);
  };
  const panelButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;
  const targetButton = (target: string): HTMLButtonElement =>
    properties().querySelector<HTMLButtonElement>(`.draw-properties-section[data-section="colors"] .draw-swatches-target [data-target="${target}"]`)!;
  /// Il colore che la barra dà per scelto.
  const checked = (): string | null => well().querySelector(".kit-color-well-name")?.textContent ?? null;
  /// Il contorno dei rettangoli nuovi, nell'ordine del file.
  const outlined = (): string[] =>
    [...editor.engine.text.matchAll(/<rect id="(?!o[a-z]\d[a-z]\d[a-z]\d[a-z]\d")[^"]*"[^>]*? stroke="([^"]*)"/g)].map((match) => match[1]!);

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("è uno strumento dello Standard, col tasto I, e dice dove va ciò che prende", () => {
    mount(LOOKS);
    key("i");
    expect(editor.tool).toBe("pen");
    editor.setLevel("standard");
    key("i");
    expect(editor.tool).toBe("eyedropper");
    expect(spoken()).toBe("Strumento: Contagocce. Il colore che prendi è quello con cui disegni.");
    expect(railTool("Contagocce").title).toBe("Contagocce (I)");
    const control = host.querySelector<HTMLButtonElement>('.draw-rail [data-tool="eyedropper"]')!;
    control.focus();
    expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toContain("Maiusc");
    editor.setTool("select");
    editor.select([A, C]);
    key("i");
    expect(spoken()).toBe("Strumento: Contagocce. Ciò che prendi va ai 2 oggetti scelti.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un clic dà agli oggetti scelti l'aspetto della forma sotto il puntatore, in un passo", () => {
    dropper();
    editor.select([A]);
    editor.setTool("eyedropper");
    click(250, 150);
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#e69f00" stroke="#d55e00" stroke-width="6" stroke-dasharray="4 2" opacity="0.5"/>`);
    expect(spoken()).toBe("Aspetto di Rettangolo dato a 1 oggetto.");
    expect(changes).toHaveLength(1);
    // Il contagocce non sceglie e non sposta: la selezione resta, e la forma
    // da cui prende non cambia.
    expect(editor.selection).toEqual([A]);
    expect(rect(B)).toBe(B_RECT);
    editor.undo();
    expect(editor.engine.text).toBe(LOOKS);
    expect(spoken()).toBe("Annullato: Aspetto preso col contagocce.");
    // Dentro un gruppo, la forma sotto il puntatore; da un livello bloccato
    // si legge senza cambiarlo.
    click(160, 220);
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#cc79a7" stroke="#56b4e9" stroke-width="4"/>`);
    click(320, 220);
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#56b4e9"/>`);
    expect(rect(D)).toBe(`<rect id="${D}" x="300" y="200" width="40" height="40" fill="#56b4e9"/>`);
    // Lo stesso aspetto di nuovo non cambia niente.
    click(320, 220);
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(changes).toHaveLength(4);
  });

  it("con Maiusc dà il solo colore sotto il puntatore, al riempimento o al contorno come dice «Applica a»; un campione resta un campione", () => {
    const remembered: (readonly string[])[] = [];
    dropper(LOOKS, { onColorsChange: (colors) => remembered.push(colors) });
    editor.select([A]);
    editor.setTool("eyedropper");
    click(250, 150, { shiftKey: true });
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("Riempimento: Arancione.");
    // Sul contorno, il colore del contorno.
    click(231, 150, { shiftKey: true });
    expect(rect(A)).toContain('fill="#d55e00"');
    expect(spoken()).toBe("Riempimento: Vermiglio.");
    expect(remembered).toEqual([["#e69f00"], ["#d55e00", "#e69f00"]]);
    panelButton().click();
    targetButton("stroke").click();
    click(120, 30, { shiftKey: true });
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#d55e00" stroke="url(#rs) #0072b2" stroke-width="2"/>`);
    expect(spoken()).toBe("Contorno: Blu marca.");
    // Un campione non è un colore recente; un motivo si dà come gli altri.
    expect(remembered).toHaveLength(2);
    click(30, 220, { shiftKey: true });
    expect(rect(A)).toContain('stroke="url(#rpppppppp) #000000"');
    expect(spoken()).toBe("Contorno: un motivo.");
    expect(changes).toHaveLength(4);
  });

  it("senza selezione prende il colore con cui si disegna, anche un campione; un motivo no", () => {
    const remembered: (readonly string[])[] = [];
    dropper(LOOKS, { onColorsChange: (colors) => remembered.push(colors) });
    editor.setTool("eyedropper");
    click(250, 150);
    expect(spoken()).toBe("Colore: Arancione.");
    expect(checked()).toBe("Arancione");
    expect(remembered).toEqual([["#e69f00", "#000000"]]);
    editor.setTool("rect");
    drag([[300, 60], [350, 90]]);
    editor.setTool("eyedropper");
    click(120, 30);
    expect(spoken()).toBe("Colore: Blu marca.");
    editor.setTool("rect");
    drag([[300, 100], [350, 120]]);
    expect(outlined()).toEqual(["#e69f00", "url(#rs) #0072b2"]);
    editor.setTool("eyedropper");
    click(30, 220);
    expect(spoken()).toBe("Un motivo non è un colore con cui disegnare: scegli prima gli oggetti a cui darlo.");
    click(380, 120);
    expect(spoken()).toBe("Qui non c’è niente da prendere: tocca un oggetto o un’immagine.");
    click(320, 30);
    expect(spoken()).toBe("Questa parte viene da un altro programma: FubDraw la mostra, ma non ne prende il colore.");
    // Soltanto i due rettangoli nuovi.
    expect(changes).toHaveLength(2);
  });

  it("da un'immagine prende il colore del pixel, e dove è trasparente guarda sotto", async () => {
    const codec = pixelCodec();
    dropper(PICTURE, { imageCodec: codec });
    editor.setTool("eyedropper");
    click(210, 110);
    await settle();
    expect(spoken()).toBe("Colore: Personalizzato #ff0000.");
    // Un pixel solo, quello sotto il puntatore: per l'anteprima e per ciò
    // che prende.
    expect([...new Set(codec.rects)]).toEqual(["5 5 1 1 1"]);
    click(270, 110);
    expect(spoken()).toBe("Colore: Verde.");
    editor.select([A]);
    click(210, 110);
    expect(rect(A)).toContain('fill="#ff0000"');
    expect(spoken()).toBe("Riempimento: Personalizzato #ff0000.");
    // Un'immagine aperta per il contagocce si chiude con lo strumento.
    expect(codec.closed).toBe(0);
    editor.setTool("select");
    expect(codec.closed).toBe(1);
  });

  it("dalla tastiera, sopra un'immagine il cursore dice il colore appena l'ha letto", async () => {
    const layer = recording();
    dropper(PICTURE, { imageCodec: pixelCodec() });
    editor.setTool("eyedropper");
    key("ArrowUp", { shiftKey: true });
    expect(spoken()).toBe("x 200, y 100: Immagine, lettura dei pixel…");
    layer.frame();
    expect(layer.texts()).toEqual(["Lettura…"]);
    await settle();
    expect(spoken()).toBe("x 200, y 100: Immagine, Personalizzato #ff0000");
    layer.frame();
    expect(layer.texts()).toEqual(["#ff0000"]);
  });

  it("un'immagine dal web non si legge, e lo dice", () => {
    dropper(doc(`${LAYER}<image id="${IMAGE}" x="200" y="100" width="80" height="40" href="https://example.com/a.png"/></g>`), { imageCodec: pixelCodec() });
    editor.setTool("eyedropper");
    click(210, 110);
    expect(spoken()).toBe("Il colore di un’immagine dal web non si legge: mettila nel vault, e prendilo da quella.");
    expect(changes).toEqual([]);
  });

  it("dalla tastiera: le frecce portano il cursore anche con una selezione, e dice che cosa c'è sotto; Spazio prende l'aspetto, Maiusc+Spazio il colore", () => {
    dropper();
    editor.select([A]);
    editor.setTool("eyedropper");
    key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 250, y 150: Rettangolo, Arancione");
    expect(rect(A)).toBe(A_RECT);
    key(" ");
    expect(rect(A)).toContain('fill="#e69f00" stroke="#d55e00"');
    expect(spoken()).toBe("Aspetto di Rettangolo dato a 1 oggetto.");
    editor.undo();
    key(" ", { shiftKey: true });
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("Riempimento: Arancione.");
    key("ArrowUp", { shiftKey: true });
    key("ArrowUp", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 300, y 50: una parte di un altro programma, che il contagocce non legge");
  });

  it("accanto al puntatore mostra ciò che prende, col suo nome; Maiusc passa al colore, e un dito lo vede sopra di sé", () => {
    const layer = recording();
    dropper();
    editor.select([A]);
    editor.setTool("eyedropper");
    hover(250, 150);
    layer.frame();
    expect(layer.texts()).toEqual(["Rettangolo"]);
    key("Shift", { shiftKey: true });
    layer.frame();
    expect(layer.texts()).toEqual(["Arancione"]);
    surface().dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    hover(120, 30);
    layer.frame();
    expect(layer.texts()).toEqual(["Rettangolo"]);
    editor.select([]);
    hover(120, 30);
    layer.frame();
    expect(layer.texts()).toEqual(["Blu marca"]);
    hover(320, 30);
    layer.frame();
    expect(layer.texts()).toEqual(["Non si prende"]);
    hover(380, 120);
    layer.frame();
    expect(layer.texts()).toEqual([]);
    // Il dito non passa sopra: l'anteprima c'è mentre tocca, e poi sparisce.
    const TOUCH = { pointerId: 7, pointerType: "touch" } as const;
    surface().dispatchEvent(pointer("pointerdown", { ...TOUCH, button: 0, buttons: 1, pressure: 0.5, clientX: 380, clientY: 120, timeStamp: (clock += 8) }));
    surface().dispatchEvent(pointer("pointermove", { ...TOUCH, button: -1, buttons: 1, pressure: 0.5, clientX: 250, clientY: 150, timeStamp: (clock += 8) }));
    layer.frame();
    expect(layer.texts()).toEqual(["Arancione"]);
    surface().dispatchEvent(pointer("pointerup", { ...TOUCH, button: 0, buttons: 0, pressure: 0, clientX: 250, clientY: 150, timeStamp: (clock += 8) }));
    layer.frame();
    expect(layer.texts()).toEqual([]);
    expect(spoken()).toBe("Colore: Arancione.");
  });

  it("Esc a metà non prende niente", () => {
    dropper();
    editor.select([A]);
    editor.setTool("eyedropper");
    surface().dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 250, clientY: 150, timeStamp: (clock += 8) }));
    key("Escape");
    surface().dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 250, clientY: 150, timeStamp: (clock += 8) }));
    expect(editor.engine.text).toBe(LOOKS);
    expect(changes).toEqual([]);
  });

  /// Le righe dell'albero: A da vestire e B, come sopra; K bloccato e N
  /// nascosto, senza riempimento; R con una sfumatura sua; un'immagine; il
  /// gruppo; e D nel livello bloccato.
  const K = "ok1k1k1k1";
  const N = "on2n2n2n2";
  const R = "or3r3r3r3";
  const ROWS = doc(
    '<defs id="fub-defs"><linearGradient id="r1a1a1a1a" fub:role="private" x2="1"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#e69f00"/></linearGradient></defs>' +
      `<g id="l2" fub:layer="Sfondo" fub:locked="true"><rect id="${D}" x="300" y="200" width="40" height="40" fill="#56b4e9"/></g>` +
      `${LAYER}${A_RECT}${B_RECT}` +
      `<rect id="${K}" x="100" y="10" width="40" height="40" fill="#009e73" fub:locked="true"/>` +
      `<rect id="${N}" x="160" y="10" width="40" height="40" fill="none" stroke="#cc79a7" stroke-width="3" display="none"/>` +
      `<rect id="${R}" x="10" y="200" width="40" height="40" fill="url(#r1a1a1a1a) #0072b2"/>` +
      `<image id="${IMAGE}" x="200" y="100" width="80" height="40" href="data:image/png;base64,iVBORw0KGgo="/>` +
      `<g id="${G}"><rect id="oh6h6h6h6" x="100" y="200" width="40" height="40" fill="#009e73"/><rect id="oj7j7j7j7" x="140" y="200" width="40" height="40" fill="#cc79a7" stroke="#56b4e9" stroke-width="4"/></g></g>`,
  );
  const objectsTree = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
  const inTree = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => key(name, init, objectsTree());
  /// Apre l'albero, se è chiuso, e porta la riga attiva a `id` con Ctrl e le
  /// frecce, senza cambiare la selezione.
  const reach = (id: string): void => {
    if (objectsTree().closest<HTMLElement>(".draw-objects")!.hidden) host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    objectsTree().focus();
    const keys = (): (string | undefined)[] => [...objectsTree().querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => row.dataset.key);
    const at = (): number => keys().indexOf(document.getElementById(objectsTree().getAttribute("aria-activedescendant") ?? "")?.dataset.key);
    for (let step = 0; step < 20 && at() !== keys().indexOf(id); step++) inTree(at() < keys().indexOf(id) ? "ArrowDown" : "ArrowUp", { ctrlKey: true });
    expect(keys()[at()]).toBe(id);
  };

  it("dall'albero, I dà agli oggetti scelti l'aspetto dell'oggetto della riga, anche bloccato o nascosto, e non cambia strumento", () => {
    dropper(ROWS);
    editor.select([A]);
    const tool = editor.tool;
    reach(B);
    expect(inTree("i").defaultPrevented).toBe(true);
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#e69f00" stroke="#d55e00" stroke-width="6" stroke-dasharray="4 2" opacity="0.5"/>`);
    expect(spoken()).toBe("Aspetto di Rettangolo dato a 1 oggetto.");
    expect(editor.tool).toBe(tool);
    expect(editor.selection).toEqual([A]);
    expect(document.activeElement).toBe(objectsTree());
    editor.undo();
    expect(editor.engine.text).toBe(ROWS);
    // Bloccato o nascosto si legge senza cambiarlo. Col blocco delle
    // maiuscole la lettera è grande, ed è sempre l'aspetto.
    reach(K);
    inTree("I");
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#009e73"/>`);
    expect(spoken()).toBe("Aspetto di Rettangolo dato a 1 oggetto.");
    reach(N);
    inTree("i");
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="none" stroke="#cc79a7" stroke-width="3"/>`);
    expect(rect(N)).toContain('display="none"');
    reach(D);
    inTree("i");
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#56b4e9"/>`);
    // Un gruppo dà quello della sua prima parte; una sua parte, il suo.
    reach(G);
    inTree("i");
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#009e73"/>`);
    expect(spoken()).toBe("Aspetto di Gruppo dato a 1 oggetto.");
    inTree("ArrowRight");
    reach("oj7j7j7j7");
    inTree("i");
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#cc79a7" stroke="#56b4e9" stroke-width="4"/>`);
    // Una sfumatura viene intera, in una copia che resta di A.
    reach(R);
    inTree("i");
    expect(rect(A)).toMatch(new RegExp(`^<rect id="${A}" x="10" y="10" width="40" height="40" fill="url\\(#r[a-z0-9]+\\) #0072b2"/>$`));
    expect(rect(A)).not.toContain("r1a1a1a1a");
    expect(editor.engine.text.match(/<linearGradient /g)).toHaveLength(2);
    // Un livello non ha un aspetto; l'oggetto stesso non cambia niente.
    reach("l1");
    inTree("i");
    expect(spoken()).toBe("Un livello non ha un aspetto da prendere: il contagocce prende da un oggetto.");
    reach(A);
    inTree("i");
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(editor.selection).toEqual([A]);
  });

  it("dall'albero, Maiusc con I dà il colore della riga, il riempimento o il contorno se non riempie; senza selezione è quello con cui si disegna", () => {
    const remembered: (readonly string[])[] = [];
    dropper(ROWS, { onColorsChange: (colors) => remembered.push(colors) });
    editor.select([A]);
    reach(B);
    expect(inTree("I", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("Riempimento: Arancione.");
    expect(remembered).toEqual([["#e69f00"]]);
    // Senza riempimento il contorno, anche nascosto; al contorno, come dice
    // «Applica a».
    panelButton().click();
    targetButton("stroke").click();
    reach(N);
    inTree("I", { shiftKey: true });
    expect(rect(A)).toBe(`<rect id="${A}" x="10" y="10" width="40" height="40" fill="#e69f00" stroke="#cc79a7" stroke-width="2"/>`);
    expect(spoken()).toBe("Contorno: Porpora.");
    // Una sfumatura ha un colore per punto, e un'immagine anche: sul foglio.
    reach(R);
    inTree("I", { shiftKey: true });
    expect(spoken()).toBe("Una sfumatura ha un colore in ogni punto: prendine uno col contagocce sul foglio. Senza Maiusc, I dà l’aspetto intero, sfumatura compresa.");
    reach(IMAGE);
    inTree("I", { shiftKey: true });
    expect(spoken()).toBe("Il colore di un’immagine è quello di un punto: prendilo col contagocce sul foglio.");
    expect(changes).toHaveLength(2);
    // Senza selezione, il colore con cui si disegna.
    editor.select([]);
    reach(K);
    inTree("i");
    expect(spoken()).toBe("Colore: Verde.");
    expect(checked()).toBe("Verde");
    reach(R);
    inTree("i");
    expect(spoken()).toBe("Una sfumatura ha un colore in ogni punto: prendine uno col contagocce sul foglio.");
    expect(changes).toHaveLength(2);
    // Senza il contagocce il tasto passa all'editor.
    editor.setLevel("essential");
    expect(inTree("i").defaultPrevented).toBe(false);
  });
});

describe("lo strumento Sfumatura, dal livello Standard", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  /// A con la sua sfumatura lineare, dal blu al bianco da sinistra a destra;
  /// B arancione pieno; C con la sua radiale, dal bianco al vermiglio.
  const SHADES = doc(
    '<defs id="fub-defs"><linearGradient id="ra" fub:role="private" gradientUnits="userSpaceOnUse" x1="20" y1="50" x2="180" y2="50"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#ffffff"/></linearGradient>' +
      '<radialGradient id="rc" fub:role="private" gradientUnits="userSpaceOnUse" cx="300" cy="200" r="50"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#e69f00"/><stop offset="1" stop-color="#d55e00"/></radialGradient></defs>' +
      `${LAYER}<rect id="${A}" x="0" y="0" width="200" height="100" fill="url(#ra) #80b9d8"/>` +
      `<rect id="${B}" x="0" y="150" width="100" height="100" fill="#e69f00"/>` +
      `<rect id="${C}" x="250" y="150" width="100" height="100" fill="url(#rc) #e69f00"/></g>`,
  );
  /// La sfumatura che riempie `id`, com'è scritta adesso.
  const shade = (id: string): string => {
    const text = editor.engine.text;
    const ref = new RegExp(`<rect id="${id}"[^>]* fill="url\\(#([^)]+)\\)`).exec(text)?.[1];
    if (ref === undefined) return new RegExp(`<rect id="${id}"[^>]*/>`).exec(text)![0];
    return new RegExp(`<(linear|radial)Gradient id="${ref}"[^>]*>[\\s\\S]*?</\\1Gradient>`).exec(text)![0].replace(/\s*\n\s*/g, "");
  };
  /// Un tocco, lontano nel tempo dal precedente: non fa un doppio tocco.
  const tap = (x: number, y: number, init: Init = {}): void => {
    clock += 1000;
    drag([[x, y]], init);
  };
  const hover = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const gradientTool = () => railTool("Sfumatura");

  /// Il disegno `source`, con gli oggetti `keys` scelti e lo strumento
  /// Sfumatura.
  const shading = (keys: readonly string[] = [A], source = SHADES): void => {
    mount(source, { level: "standard" });
    size(400, 300);
    editor.focus();
    editor.select(keys);
    key("g");
  };

  it("c'è dal livello Standard, col tasto G, e dice dove va la sfumatura", () => {
    mount(SHADES, { level: "standard" });
    size(400, 300);
    editor.focus();
    expect(gradientTool().title).toBe("Sfumatura (G)");
    key("g");
    expect(editor.tool).toBe("gradient");
    expect(surface().dataset.tool).toBe("gradient");
    expect(spoken()).toBe("Strumento: Sfumatura. Scegli gli oggetti a cui dare una sfumatura: un clic su un oggetto lo sceglie.");
    editor.select([B]);
    key("v");
    key("g");
    expect(spoken()).toBe("Strumento: Sfumatura. La sfumatura va al riempimento degli oggetti scelti.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    expect(changes).toEqual([]);
  });

  it("trascinata sugli oggetti scelti traccia la loro sfumatura, dal loro colore; con Maiusc va di 45° in 45°", () => {
    shading([B]);
    drag([[20, 200], [50, 200], [80, 200]]);
    expect(shade(B)).toMatch(/^<linearGradient id="[^"]+" fub:role="private" x1="20" y1="200" x2="80" y2="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e69f00"\/><stop offset="1" stop-color="#e69f00" stop-opacity="0"\/><\/linearGradient>$/);
    expect(spoken()).toBe("Sfumatura lineare tracciata: angolo 0°, lunga 60.");
    expect(editor.selection).toEqual([B]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHADES);
    expect(spoken()).toBe("Annullato: Sfumatura tracciata.");
    drag([[20, 200], [50, 220], [80, 230]], { shiftKey: true });
    expect(shade(B)).toContain('x1="20" y1="200" x2="65" y2="245"');
    expect(spoken()).toBe("Sfumatura lineare tracciata: angolo 45°, lunga 63,6.");
  });

  it("su un oggetto campito nasce dal fondo della campitura, come dal pannello", () => {
    const hatched = doc(
      '<defs id="fub-defs"><pattern id="rh" fub:role="private" fub:pattern="lines -45 8 1.5 #000000 #e69f00" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(-45)"><rect width="8" height="8" fill="#e69f00"/><rect y="3.25" width="8" height="1.5" fill="#000000"/></pattern></defs>' +
        `${LAYER}<rect id="${B}" x="0" y="150" width="100" height="100" fill="url(#rh) #bb8100"/></g>`,
    );
    shading([B], hatched);
    drag([[20, 200], [50, 200], [80, 200]]);
    expect(shade(B)).toContain('<stop offset="0" stop-color="#e69f00"/><stop offset="1" stop-color="#e69f00" stop-opacity="0"/>');
    // La campitura che nessuno usa più se ne va.
    expect(editor.engine.text).not.toContain("<pattern");
  });

  it("radiale se lo sono già tutte quelle degli oggetti scelti, col centro dove parte", () => {
    shading([C]);
    drag([[280, 180], [290, 180], [300, 180]]);
    // La stessa sfumatura, cambiata sul posto, coi punti di prima.
    expect(shade(C)).toBe(
      '<radialGradient id="rc" fub:role="private" cx="280" cy="180" r="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#e69f00"/><stop offset="1" stop-color="#d55e00"/></radialGradient>',
    );
    expect(spoken()).toBe("Sfumatura radiale tracciata: raggio 20.");
  });

  it("senza niente di scelto, il trascinamento sceglie l'oggetto da cui parte; dal vuoto dice che cosa serve", () => {
    shading([]);
    drag([[20, 200], [50, 200], [80, 200]]);
    expect(editor.selection).toEqual([B]);
    expect(shade(B)).toContain('x1="20" y1="200" x2="80" y2="200"');
    expect(changes).toHaveLength(1);
    editor.undo();
    editor.select([]);
    drag([[380, 20], [380, 50], [380, 80]]);
    expect(spoken()).toBe("Scegli gli oggetti a cui dare una sfumatura: un clic su un oggetto lo sceglie.");
    expect(editor.selection).toEqual([]);
    expect(editor.engine.text).toBe(SHADES);
  });

  it("un tocco sul foglio sceglie l'oggetto, con Maiusc lo aggiunge o lo toglie, e sul vuoto lascia la selezione", () => {
    shading([]);
    tap(50, 200);
    expect(editor.selection).toEqual([B]);
    expect(spoken()).toBe("1 oggetto scelto. La sfumatura va al riempimento degli oggetti scelti.");
    tap(300, 160, { shiftKey: true });
    expect(editor.selection).toEqual([B, C]);
    tap(50, 200, { shiftKey: true });
    expect(editor.selection).toEqual([C]);
    tap(380, 20);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("Scegli gli oggetti a cui dare una sfumatura: un clic su un oggetto lo sceglie.");
    expect(changes).toEqual([]);
  });

  it("i capi si trascinano: uno gira e allunga la linea attorno all'altro, con Maiusc di 45° in 45°; la linea la sposta", () => {
    shading();
    drag([[180, 50], [180, 70], [180, 90]]);
    expect(shade(A)).toContain('x1="20" y1="50" x2="180" y2="90"');
    expect(spoken()).toBe("Fine della sfumatura: x 180, y 90.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(spoken()).toBe("Annullato: Capo della sfumatura spostato.");
    drag([[180, 50], [180, 100], [180, 140]], { shiftKey: true });
    expect(shade(A)).toContain('x1="20" y1="50" x2="145" y2="175"');
    editor.undo();
    // La linea, presa a metà, porta con sé la sfumatura.
    drag([[100, 50], [110, 60], [120, 70]]);
    expect(shade(A)).toContain('x1="40" y1="70" x2="200" y2="70"');
    expect(spoken()).toBe("Inizio della sfumatura: x 40, y 70.");
    editor.undo();
    expect(editor.engine.text).toBe(SHADES);
  });

  it("il centro di una radiale la sposta, il raggio la gira e la allarga; con Alt sul centro si prende il fuoco", () => {
    shading([C]);
    drag([[300, 200], [310, 200], [320, 210]]);
    expect(shade(C)).toContain('cx="320" cy="210" r="50"');
    expect(spoken()).toBe("Centro della sfumatura: x 320, y 210.");
    editor.undo();
    drag([[350, 200], [360, 200], [370, 200]]);
    expect(shade(C)).toContain('cx="300" cy="200" r="70"');
    editor.undo();
    drag([[300, 200], [310, 200], [320, 200]], { altKey: true });
    expect(shade(C)).toContain('cx="300" cy="200" r="50" fx="320" fy="200"');
    expect(spoken()).toBe("Fuoco della sfumatura: x 320, y 200.");
  });

  it("un punto scorre lungo la linea, e lontano da lei si toglie, se ne restano due", () => {
    shading([C]);
    // Il punto a metà pende 16 pixel sotto la linea, a 325.
    drag([[325, 216], [330, 216], [335, 216]]);
    expect(shade(C)).toContain('<stop offset="0.7" stop-color="#e69f00"/>');
    expect(spoken()).toBe("Punto 2 di 3 della sfumatura, Arancione, al 70%.");
    expect(changes).toHaveLength(1);
    // Tirato giù, lontano dalla linea, se ne va.
    drag([[335, 216], [335, 240], [335, 260]]);
    expect(shade(C)).not.toContain("#e69f00\"/>");
    expect(spoken()).toBe("Punto 2 tolto.");
    // Degli ultimi due, nessuno si stacca.
    drag([[350, 216], [350, 240], [350, 260]]);
    expect(changes).toHaveLength(2);
  });

  it("un tocco sceglie un capo o un punto e lo dice; due sulla linea aggiungono un punto, del colore che si vede lì", () => {
    shading();
    tap(20, 50);
    expect(spoken()).toBe("Inizio della sfumatura: x 20, y 50.");
    tap(180, 66);
    expect(spoken()).toBe("Punto 2 di 2 della sfumatura, #ffffff, al 100%.");
    tap(60, 50);
    expect(spoken()).toBe("Linea della sfumatura, al 25%: il doppio clic aggiunge un punto qui.");
    drag([[60, 50]]);
    expect(shade(A)).toMatch(/<stop offset="0" stop-color="#0072b2"\/><stop offset="0.25" stop-color="#[0-9a-f]{6}"\/><stop offset="1" stop-color="#ffffff"\/>/);
    expect(spoken()).toBe("Punto 2 aggiunto, al 25%.");
    expect(changes).toHaveLength(1);
  });

  it("due tocchi su un punto, o Invio, portano al suo colore nel pannello; Invio su un capo, alla sezione", () => {
    shading();
    /// Il campo che ha il fuoco, se sta nella sezione «Sfumatura».
    const focused = (): HTMLInputElement | null =>
      document.activeElement?.closest('.draw-properties-section[data-section="gradient"]') === null ? null : (document.activeElement as HTMLInputElement);
    tap(180, 66);
    drag([[180, 66]]);
    expect(focused()?.value).toBe("#ffffff");
    editor.focus();
    key("Home");
    key("Enter");
    expect(focused()).not.toBeNull();
    editor.focus();
    key("Tab");
    key("Tab");
    key("Enter");
    expect(focused()?.value).toBe("#0072b2");
    expect(changes).toEqual([]);
  });

  it("dalla tastiera: Tab va di capo in capo e di punto in punto, Inizio e Fine agli estremi, Esc lascia", () => {
    shading();
    key("Tab");
    expect(spoken()).toBe("Inizio della sfumatura: x 20, y 50.");
    key("Tab");
    expect(spoken()).toBe("Fine della sfumatura: x 180, y 50.");
    key("Tab");
    expect(spoken()).toBe("Punto 1 di 2 della sfumatura, Blu, al 0%.");
    key("End");
    expect(spoken()).toBe("Punto 2 di 2 della sfumatura, #ffffff, al 100%.");
    key("Home");
    expect(spoken()).toBe("Inizio della sfumatura: x 20, y 50.");
    key("Tab", { shiftKey: true });
    key("Escape");
    expect(spoken()).toBe("Nessun capo o punto della sfumatura scelto.");
    expect(changes).toEqual([]);
  });

  it("le frecce spostano il capo scelto come un nodo, e il punto scelto lungo la linea", () => {
    shading();
    key("Tab");
    key("ArrowRight");
    expect(shade(A)).toContain('x1="21" y1="50" x2="180" y2="50"');
    expect(spoken()).toBe("Inizio della sfumatura: x 21, y 50.");
    key("ArrowDown", { shiftKey: true });
    expect(shade(A)).toContain('x1="21" y1="60" x2="180" y2="50"');
    // Il punto: verso la fine con →, verso l'inizio con ←; di traverso, ↑ va
    // avanti.
    key("End");
    key("ArrowLeft");
    expect(shade(A)).toContain('<stop offset="0.99" stop-color="#ffffff"/>');
    expect(spoken()).toBe("Punto 2 di 2 della sfumatura, #ffffff, al 99%.");
    key("ArrowLeft", { shiftKey: true });
    expect(shade(A)).toContain('<stop offset="0.89" stop-color="#ffffff"/>');
    expect(changes).toHaveLength(4);
  });

  it("Canc toglie il punto scelto, mai l'oggetto; Ins ne aggiunge uno a metà col seguente", () => {
    shading([C]);
    key("Delete");
    expect(spoken()).toBe("Canc e Ins valgono per un punto della sfumatura: sceglilo con Tab.");
    expect(editor.engine.text).toBe(SHADES);
    key("End");
    key("Insert");
    expect(shade(C)).toMatch(/<stop offset="0.5" stop-color="#e69f00"\/><stop offset="0.75" stop-color="#[0-9a-f]{6}"\/><stop offset="1" stop-color="#d55e00"\/>/);
    expect(spoken()).toBe("Punto 3 aggiunto, al 75%.");
    key("Delete");
    expect(spoken()).toBe("Punto 3 tolto.");
    expect(changes).toHaveLength(2);
  });

  it("con più sfumature dice di quale parla", () => {
    shading([A, C]);
    key("Tab");
    expect(spoken()).toBe("Inizio della sfumatura: x 20, y 50. Sfumatura 1 di 2.");
  });

  it("«Applica a» il contorno: la sfumatura va al contorno degli oggetti scelti", () => {
    const D = "od4d4d4d4";
    shading([D], doc(`${LAYER}<rect id="${D}" x="0" y="0" width="100" height="100" fill="#ffffff" stroke="#000000" stroke-width="4"/></g>`));
    properties().querySelector<HTMLButtonElement>('.draw-properties-section[data-section="colors"] .draw-swatches-target [data-target="stroke"]')!.click();
    drag([[20, 50], [50, 50], [80, 50]]);
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${D}"[^>]* fill="#ffffff" stroke="url\\(#[^)]+\\) #000000"`));
    expect(shade(D)).toBe(new RegExp(`<rect id="${D}"[^>]*/>`).exec(editor.engine.text)![0]);
  });

  it("mentre si trascina, il foglio mostra la sfumatura nuova; Esc la lascia com'era", () => {
    shading();
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 180, clientY: 50, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 180, clientY: 90, timeStamp: (clock += 8) }));
    const rect = host.querySelector<SVGElement>(`[data-scene-id="${A}"]`)!;
    const shown = host.querySelector<SVGElement>("svg.spatial-defs:last-child linearGradient")!;
    expect(rect.style.fill.replace(/"/g, "")).toBe(`url(#${shown.id})`);
    expect(["x1", "y1", "x2", "y2"].map((name) => shown.getAttribute(name))).toEqual(["20", "50", "180", "90"]);
    key("Escape");
    expect(rect.style.fill).toBe("");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 180, clientY: 90, timeStamp: (clock += 8) }));
    expect(editor.engine.text).toBe(SHADES);
    expect(changes).toEqual([]);
  });

  it("il foglio mostra la linea, i capi e i quadratini dei punti, appesi sotto la linea; di una radiale anche il bordo", () => {
    const layer = recording();
    shading();
    layer.frame();
    const at = (name: string, x: number, y: number): boolean => layer.calls().some((call) => call[0] === name && Math.round(call[1] as number) === x && Math.round(call[2] as number) === y);
    // La linea e l'asta del primo punto; il cerchio dell'inizio; i
    // quadratini, larghi 12.
    expect([at("moveTo", 20, 50), at("lineTo", 180, 50), at("lineTo", 20, 66), at("arc", 20, 50)]).toEqual([true, true, true, true]);
    expect([at("fillRect", 14, 60), at("fillRect", 174, 60)]).toEqual([true, true]);
    expect(layer.calls().some(([name, dash]) => name === "setLineDash" && (dash as number[]).length > 0)).toBe(false);
    editor.select([C]);
    layer.frame();
    expect(layer.calls().some(([name, dash]) => name === "setLineDash" && (dash as number[]).length > 0)).toBe(true);
    // Senza lo strumento, niente.
    key("v");
    layer.frame();
    expect(at("fillRect", 294, 210)).toBe(false);
  });

  it("il puntatore sopra un capo, un punto o la linea dice che li sposta", () => {
    shading();
    hover(20, 50);
    expect(surface().dataset.grip).toBe("move");
    hover(100, 66);
    expect(surface().dataset.grip).toBeUndefined();
    hover(100, 51);
    expect(surface().dataset.grip).toBe("move");
  });

  it("il cursore dice il capo, il punto o la linea sotto di sé; Spazio, le frecce e Spazio li spostano", () => {
    shading([C]);
    // Il cursore parte dal mezzo del foglio, a 200, 150.
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 300, y 150: Rettangolo");
    key("ArrowDown", { shiftKey: true });
    expect(spoken()).toBe("x 300, y 200: Centro della sfumatura.");
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key(" ");
    expect(shade(C)).toContain('cx="350" cy="200" r="50"');
    expect(spoken()).toBe("Centro della sfumatura: x 350, y 200.");
    expect(changes).toHaveLength(1);
  });

  it("i tasti della Sfumatura stanno nell'elenco", () => {
    shading();
    key("?", { shiftKey: true });
    const table = [...dialog().querySelectorAll("table")].find((each) => each.querySelector("caption")!.textContent === "Sfumatura")!;
    expect([...table.querySelectorAll("tr")].map((row) => row.querySelector("th")!.textContent)).toEqual(["Space", "Shift", "Alt", "Tab o Shift+Tab", "Home o End", "←↑→↓", "Insert", "Del", "Enter", "Esc"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("la barra accanto alla selezione, dal livello Standard", () => {
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const spot = (): readonly number[] => /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(bar().style.transform)!.slice(1).map(Number);

  it("sta sotto la selezione, oltre le maniglie; in cima al foglio se chi disegna lo sceglie", () => {
    mount(SOURCE, { level: "standard" });
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
    mount(doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="20" width="10" height="10" fill="#000000"/></g>`), { level: "standard" });
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

  it("senza il pannello delle proprietà, si sceglie in «Pagina e griglia»", () => {
    mount(SOURCE, { level: "custom", custom: ["arrange", "grid"] });
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
    mount(BOXES);
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
    mount(BOXES);
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
    mount(BOXES);
    editor.select(["oa1a1a1a1"]);
    key("Enter");
    // Un secondo Invio non apre un'altra finestra.
    key("Enter");
    expect(document.querySelectorAll(".modale")).toHaveLength(1);
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(changes).toEqual([]);
  });

  it("«?» elenca i tasti, gruppo per gruppo", () => {
    mount();
    key("?", { shiftKey: true });
    expect(dialog().querySelector("h2")!.textContent).toBe("Tasti del disegno");
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toEqual([
      "Strumenti",
      "Disegnare da tastiera",
      "Oggetti",
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

  it("«Mostra tutto» aggiunge i tasti dei livelli sopra, ciascuno col livello da cui vale", () => {
    mount();
    key("?", { shiftKey: true });
    const extra = dialog().querySelector<HTMLElement>(".keys-more")!;
    expect(extra.hidden).toBe(true);
    dialog().querySelector<HTMLButtonElement>(".keys-show-all")!.click();
    expect(extra.querySelector(".keys-note")!.textContent).toBe(
      "Il livello di adesso è «Essenziale». I tasti qui sotto valgono da un livello più alto, che si sceglie nelle Impostazioni, nel gruppo «Disegni».",
    );
    const tables = [...extra.querySelectorAll("table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    expect(tables.map((table) => table.caption)).toEqual([
      "Strumenti · dal livello Standard",
      "Oggetti · dal livello Standard",
      "Disponi · dal livello Standard",
      "Selezione avanzata · dal livello Standard",
      "Ritaglia l’immagine · dal livello Standard",
      "Poligono · dal livello Standard",
      "Evidenziatore · dal livello Standard",
      "Forme dal tratto · dal livello Standard",
      "Testo · dal livello Standard",
      "Tavole · dal livello Standard",
      "Contagocce · dal livello Standard",
      "Sfumatura · dal livello Standard",
      "Griglia · dal livello Standard",
      "Guide intelligenti · dal livello Standard",
      "Righelli e guide · dal livello Standard",
      "Proprietà · dal livello Standard",
      "Vista · dal livello Standard",
      "Modifica · dal livello Standard",
      "Elenco delle tavole · dal livello Standard",
      "Presentazione · dal livello Standard",
      "Cronologia · dal livello Standard",
      "Accessibilità · dal livello Standard",
    ]);
    // Solo ciò che manca: i sette strumenti dell'Essenziale non si ripetono.
    expect(tables[0]!.rows).toEqual([["Q", "Lazo"], ["F", "Tavola"], ["I", "Contagocce"], ["G", "Sfumatura"], ["Shift+P", "Evidenziatore"], ["X", "Connettore"], ["Y", "Poligono"], ["T", "Testo"]]);
    // Dell'albero, il nome, la ricerca e il passo.
    expect(tables[1]!.rows).toEqual([
      ["F2", "Nell’albero cambia il nome della riga; sul foglio, quello dell’oggetto scelto, se non è un testo"],
      ["Ctrl+F", "Nell’albero, porta alla ricerca fra gli oggetti"],
      ["Alt+↑ o Alt+↓", "Nell’albero porta la riga di un passo, davanti o dietro, dentro o fuori da un gruppo"],
    ]);
    expect(tables[2]!.rows).toContainEqual(["Ctrl+D", "Duplica"]);
    expect(tables[3]!.rows).toEqual([
      ["Ctrl", "Tenuto col clic, sceglie l’oggetto dentro il gruppo"],
      ["Ctrl+Enter", "Isola il gruppo scelto"],
      ["Esc", "Esce dal gruppo isolato, un gruppo alla volta"],
      ["Ctrl+Shift+L", "Blocca la selezione; nell’albero blocca o sblocca la riga"],
      ["Ctrl+Shift+H", "Nasconde la selezione; nell’albero nasconde o mostra la riga"],
      ["Shift+F10", "Apre il menu della selezione"],
    ]);
    expect(tables[4]!.rows).toEqual([
      ["←↑→↓", "Sposta l’immagine sotto il ritaglio, con Maiusc di più"],
      ["Shift", "Tirando un segno, tiene le proporzioni del ritaglio"],
      ["Alt", "Tirando un segno, ritaglia attorno al centro"],
      ["Enter", "Applica il ritaglio"],
      ["Esc", "Annulla il ritaglio"],
    ]);
    expect(tables[5]!.rows).toContainEqual(["Y", "Di nuovo, dal poligono alla stella e ritorno"]);
    expect(tables[6]!.rows).toEqual([["Shift", "Tenuto premuto mentre si traccia, il tratto è dritto"]]);
    expect(tables[7]!.rows).toEqual([["Shift", "Tenuto, la forma dal tratto resta regolare"]]);
    // Le tavole, tutte dallo Standard: i passi fra loro valgono con ogni
    // strumento, il resto con lo strumento Tavola.
    expect(tables[9]!.rows).toEqual([
      ["Alt+PgUp o Alt+PgDn", "Va alla tavola prima o dopo, e la inquadra"],
      ["Tab o Shift+Tab", "Con lo strumento Tavola, la tavola dopo o prima"],
      ["Home o End", "Con lo strumento Tavola, la prima o l’ultima tavola"],
      ["←↑→↓", "Con lo strumento Tavola, sposta la tavola scelta di 1, con Maiusc di 10, con ciò che ci sta sopra"],
      ["Ctrl+←↑→↓", "Con lo strumento Tavola, allarga o stringe la tavola scelta, o la pagina, di 1, con Maiusc di 10"],
      ["Ctrl+D", "Con lo strumento Tavola, duplica la tavola scelta, o la pagina, con ciò che ci sta sopra"],
      ["Del", "Con lo strumento Tavola, elimina la tavola scelta; il disegno resta"],
      ["F2", "Con lo strumento Tavola, rinomina la tavola scelta"],
      ["Esc", "Con lo strumento Tavola, lascia la tavola scelta"],
      ["Shift", "Tenuto all’inizio del trascinamento: disegna una tavola anche dentro un’altra"],
      ["Alt", "Tenuto mentre si sposta una tavola: ne lascia una copia dove la si posa, con ciò che ci sta sopra"],
    ]);
    expect(tables[10]!.rows).toEqual([
      ["←↑→↓", "Muovono il cursore, anche con oggetti scelti, e dicono che cosa c’è sotto"],
      ["Space", "Dà agli oggetti scelti l’aspetto di ciò che è sotto il cursore; senza selezione, ne prende il colore per disegnare"],
      ["Shift+Space", "Prende soltanto il colore sotto il cursore"],
      ["I", "Nell’albero degli oggetti, dà agli oggetti scelti l’aspetto della riga; senza selezione, ne prende il colore per disegnare"],
      ["Shift+I", "Nell’albero degli oggetti, prende soltanto il colore della riga"],
    ]);
    expect(tables[12]!.rows).toContainEqual(["# o Ctrl+'", "Mostra o nasconde la griglia"]);
    expect(tables[13]!.rows).toEqual([
      ["Ctrl+U", "Accende o spegne le guide intelligenti"],
      ["Ctrl", "Tenuto mentre si trascina: posa libero, senza agganciarsi agli altri oggetti"],
      ["Alt", "Tenuto con una selezione: le distanze dall’oggetto sotto il puntatore, o dalla pagina"],
    ]);
    // Lo zoom c'è già; presentare e la vista girata, dallo
    // Standard.
    expect(tables[16]!.rows).toEqual([
      ["F5", "Presenta dalla prima tavola"],
      ["Shift+F5", "Presenta dalla tavola di adesso: quella scelta, o quella al centro della vista"],
      ["4", "Ruota la vista a sinistra"],
      ["6", "Ruota la vista a destra"],
      ["5", "Raddrizza la vista"],
    ]);
    // Copiare e incollare ci sono già; lo stile, dallo Standard.
    expect(tables[17]!.rows).toEqual([
      ["Ctrl+Alt+C", "Copia lo stile"],
      ["Ctrl+Alt+V", "Incolla lo stile"],
    ]);
    // L'elenco delle tavole e la cronologia, tutti dallo Standard.
    expect(tables[18]!.rows).toEqual([
      ["↑ o ↓ o Home o End", "Nell’elenco delle tavole, la tavola prima o dopo, la prima o l’ultima"],
      ["Enter o Space", "Nell’elenco delle tavole, porta alla tavola"],
      ["F2", "Nell’elenco delle tavole, cambia il nome della tavola"],
      ["Ctrl+D", "Nell’elenco delle tavole, duplica la tavola col suo contenuto"],
      ["Alt+↑ o Alt+↓", "Nell’elenco delle tavole, sposta la tavola prima o dopo la sua vicina"],
      ["Del", "Nell’elenco delle tavole, elimina la tavola"],
      ["Shift+F10", "Nell’elenco delle tavole, apre il menu della tavola"],
      ["Esc", "Dall’elenco delle tavole torna al foglio"],
    ]);
    // Dentro la presentazione, i suoi tasti.
    expect(tables[19]!.rows).toEqual([
      ["→ o ↓ o Space o PgDn o Enter o N", "La tavola dopo, come un clic o il dito che scorre verso sinistra; dopo l’ultima, lo schermo di fine, e da lì esce"],
      ["← o ↑ o PgUp o ⌫ o P", "La tavola prima, come il dito che scorre verso destra"],
      ["Home o End", "La prima o l’ultima tavola"],
      ["0…9", "Un numero e poi Invio: la tavola con quel numero"],
      ["B o .", "Mette e toglie lo schermo nero"],
      ["W o ,", "Mette e toglie lo schermo bianco"],
      ["L", "Accende e spegne il laser"],
      ["E", "Cancella l’inchiostro"],
      ["Esc", "Esce dalla presentazione"],
    ]);
    expect(tables[20]!.rows.map(([keys]) => keys)).toEqual(["Enter o Space", "F2", "Del", "Esc"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");

    // Ciò che è elencato non si può fare: il livello resta l'Essenziale.
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    key("P", { shiftKey: true });
    expect(editor.tool).toBe("pen");
    expect(editor.level).toBe("essential");
    key("#");
    expect(editor.grid.shown).toBe(false);
  });

  it("dallo Standard non c'è «Mostra tutto»: sopra non ci sono altri tasti (ADR 0231)", () => {
    mount(SOURCE, { level: "standard" });
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
    selecting(ONE, [A], { level: "standard", grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
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
    expect(labels()).toEqual(["Livello «Livello 1»", "Rettangolo, Nero"]);
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
    expect(labels()).toEqual(["Livello «Livello 1»", "Ellisse, Nero", "Rettangolo, Nero"]);
    editor.select(["o1a2b3c4d"]);
    editor.deleteSelection();
    expect(labels()).toEqual(["Livello «Livello 1»", "Ellisse, Nero"]);
  });

  it("Invio su un oggetto apre le sue proprietà, Canc lo elimina", () => {
    mount();
    button().click();
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(dialog().querySelector("h2")!.textContent).toBe("Posizione e misure");
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
  });
});

describe("i nomi e il filtro dell'albero, dal livello Standard", () => {
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
    mount(NAMED, { level: "standard" });
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
    mount(NAMED, { level: "standard" });
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
    mount(NAMED, { level: "standard" });
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
      { level: "standard" },
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
    mount(doc(`${LAYER.replace(">", ' fub:locked="true">')}<rect id="oa1a1a1a1" width="10" height="10"/></g>`), { level: "standard" });
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
    mount(NAMED.replace('<rect id="oa1a1a1a1" x="10" y="10" width="20" height="20" fill="#000000"/>', '<line id="oa1a1a1a1" x1="10" y1="10" x2="30" y2="30" stroke="#000000"/>'), { level: "standard" });
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
    mount(NAMED, { level: "standard" });
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
    editor.setLevel("essential");
    expect(filter.hidden).toBe(true);
    expect(search.value).toBe("");
    expect(labels()).toHaveLength(4);
    // Senza i livelli niente nomi: F2 nell'albero passa.
    tree().focus();
    expect(inTree("F2").defaultPrevented).toBe(false);
    expect(changes.map((change) => change.origin)).toEqual(["input"]);
  });
});

describe("spostare dall'albero, dal livello Standard", () => {
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
    mount(STACKED, { level: "standard" });
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
    mount(STACKED, { level: "standard" });
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
    mount(STACKED, { level: "standard" });
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
      { level: "standard" },
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
    mount(source, { level: "standard" });
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
      { level: "standard" },
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
    mount(STACKED, { level: "standard" });
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
    mount(source, { level: "standard" });
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

  it("all'Essenziale l'albero non sposta e non ha miniature", () => {
    mount(STACKED);
    openAt("oc3c3c3c3");
    inTree("ArrowDown", { altKey: true });
    expect(editor.engine.text).toBe(STACKED);
    expect(activeKey()).toBe("og1g1g1g1");
    expect([...host.querySelectorAll<HTMLElement>(".draw-object-thumb")].every((holder) => holder.hidden)).toBe(true);
  });
});

describe("la selezione avanzata, dal livello Standard", () => {
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
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
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
  /// Un lazo col mouse lungo i lati del poligono `corners`, chiuso.
  const lasso = (corners: readonly (readonly [number, number])[], init: Init = {}): void => {
    const points: [number, number][] = [];
    corners.forEach((corner, at) => {
      const next = corners[(at + 1) % corners.length]!;
      for (let step = 0; step < 4; step++) points.push([corner[0] + ((next[0] - corner[0]) * step) / 4, corner[1] + ((next[1] - corner[1]) * step) / 4]);
    });
    drag(points, init);
  };
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

  it("all'Essenziale non c'è: niente Lazo, niente menu, e i tasti restano a chi li aveva", () => {
    mount(SET);
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

  it("il Lazo, col tasto Q, sceglie ciò che racchiude per intero; Maiusc aggiunge, Alt toglie, un tocco sceglie", () => {
    mount(SET, { level: "standard" });
    key("q");
    expect(editor.tool).toBe("lasso");
    lasso([[5, 5], [75, 5], [75, 35], [5, 35]]);
    expect(editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("2 oggetti scelti.");
    // Un gruppo si sceglie solo intero.
    lasso([[5, 55], [35, 55], [35, 85], [5, 85]]);
    expect(editor.selection).toEqual([]);
    editor.select([A]);
    lasso([[5, 55], [115, 55], [115, 85], [5, 85]], { shiftKey: true });
    expect(editor.selection).toEqual([A, G]);
    lasso([[5, 5], [35, 5], [35, 35], [5, 35]], { altKey: true });
    expect(editor.selection).toEqual([G]);
    tap(60, 20);
    expect(editor.selection).toEqual([B]);
    tap(20, 20, { shiftKey: true });
    expect(editor.selection).toEqual([A, B]);
    tap(60, 20, { shiftKey: true });
    expect(editor.selection).toEqual([A]);
    tap(150, 150);
    expect(editor.selection).toEqual([]);
    // Senza il Lazo, chi lo aveva in mano riprende la Selezione, non la penna.
    editor.setLevel("essential");
    expect(editor.tool).toBe("select");
    expect(changes).toEqual([]);
  });

  it("il Lazo si tira anche dalla tastiera: Spazio lo comincia, le frecce lo tirano, Spazio lo chiude", () => {
    mount(SET, { level: "standard" });
    // Il cursore parte dal centro della vista, (40, 40). Spazio due volte,
    // senza frecce, sceglie ciò che è sotto il cursore.
    size(80, 80);
    key("q");
    for (let step = 0; step < 2; step++) key("ArrowLeft");
    for (let step = 0; step < 3; step++) key("ArrowDown");
    key(" ");
    key(" ");
    expect(editor.selection).toEqual([G]);
    // Senza selezione le frecce muovono il cursore. Da (0, 0), il lazo gira
    // attorno al primo rettangolo.
    key("Escape");
    for (let step = 0; step < 2; step++) key("ArrowLeft");
    key("ArrowUp", { shiftKey: true });
    for (let step = 0; step < 2; step++) key("ArrowUp");
    expect(spoken()).toBe("x 0, y 0");
    key(" ");
    for (let step = 0; step < 4; step++) key("ArrowRight");
    for (let step = 0; step < 4; step++) key("ArrowDown");
    for (let step = 0; step < 4; step++) key("ArrowLeft");
    key(" ");
    expect(editor.selection).toEqual([A]);
    expect(spoken()).toBe("1 oggetto scelto.");
    expect(changes).toEqual([]);
  });

  it("con Ctrl o ⌘ un clic sceglie l'oggetto dentro il gruppo, Maiusc lo aggiunge, e lo si sposta da solo", () => {
    mount(SET, { level: "standard" });
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
    mount(SET, { level: "standard" });
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
    mount(SET, { level: "standard" });
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
    mount(SET, { level: "standard" });
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
    mount(SET, { level: "standard" });
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
    mount(SET, { level: "standard" });
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
      ["Collega le forme scelte", "true"],
      ["Isola il gruppo", "true"],
    ]);
    expect(item("Stesso riempimento").querySelector(".menu-description")!.textContent).toBe("Scegli prima degli oggetti.");
    expect(item("Collega le forme scelte").querySelector(".menu-description")!.textContent).toBe("Scegli almeno due oggetti da unire: i connettori non contano.");
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
    mount(SET, { level: "standard" });
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

  it("l'albero mostra il blocco e la visibilità con un segno e a parole, e li cambia dal segno o coi tasti", () => {
    const flagged = SET.replace(`fill="#0072b2"/>`, `fill="#0072b2" fub:locked="true"/>`).replace(`<g id="${H}">`, `<g id="${H}" display="none">`);
    mount(flagged, { level: "standard" });
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
    mount(SET, { level: "standard" });
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
    mount(SOURCE, { imageCodec: codec(100, 50) });
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
    mount(SOURCE, { imageCodec: codec(100, 50), level: "standard", grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
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
    mount(SOURCE, { imageCodec: fake });
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

  describe("la descrizione, dal livello Standard", () => {
    const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-describe")!;
    const input = (): HTMLInputElement => bar().querySelector<HTMLInputElement>(".draw-describe-input")!;
    const label = (): string => bar().querySelector("label")!.textContent!;
    const act = (action: string): HTMLButtonElement => bar().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    const ids = (): string[] => [...editor.engine.text.matchAll(/<image id="([^"]+)"/g)].map((found) => found[1]!);

    it("entrata un'immagine, la barra la chiede col fuoco nel campo; Invio la scrive in un passo suo", async () => {
      mount(SOURCE, { imageCodec: codec(200, 100), level: "standard" });
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
      mount(SOURCE, { imageCodec: codec(100, 50), level: "standard" });
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
      mount(SOURCE, { imageCodec: codec(100, 50), level: "standard" });
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
      mount(SOURCE, { imageCodec: codec(100, 50), level: "standard" });
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

    it("all'Essenziale non c'è: l'immagine entra e il fuoco resta sul foglio", async () => {
      mount(SOURCE, { imageCodec: codec(100, 50) });
      size(1000, 500);
      surface().focus();
      paste([file(PNG)]);
      await settle();
      expect(bar().hidden).toBe(true);
      expect(document.activeElement).toBe(surface());
    });
  });
});

describe("le immagini del vault, dal livello Standard", () => {
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
    mount(SOURCE, { level: "standard", imageCodec: fake, images });
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

  it("il pulsante «Immagine dal vault…» c'è dallo Standard, se chi monta l'editor sa scegliere", async () => {
    const images = vault(HREF);
    mount(SOURCE, { imageCodec: codec(20, 10), images });
    expect(insertShown()).toBe(false);
    expect(key("i", { ctrlKey: true }).defaultPrevented).toBe(false);
    editor.setLevel("standard");
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
    mount(SOURCE, { level: "standard", imageCodec: codec(20, 10), images: { url: images.url, read: images.read } });
    expect(insertShown()).toBe(false);
    expect(key("i", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("«?» elenca Ctrl+I tra i tasti della modifica", () => {
    mount(SOURCE, { level: "standard", images: vault(HREF) });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+I", "Immagine dal vault…"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("una scelta annullata o fallita non aggiunge niente; un'immagine sparita o illeggibile lo si dice", async () => {
    mount(SOURCE, { level: "standard", imageCodec: codec(20, 10), images: vault(null) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("");
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    // Chi sceglie dice da sé perché non ha potuto.
    mount(SOURCE, { level: "standard", imageCodec: codec(20, 10), images: vault(new Error("rotto")) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("");
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    mount(SOURCE, { level: "standard", imageCodec: codec(20, 10), images: vault(HREF, null) });
    key("i", { ctrlKey: true });
    await settle();
    expect(spoken()).toBe("L’immagine scelta non si apre: forse non è più nel vault.");
    owner.close();
    host.replaceChildren();
    owner = openLifetime();
    mount(SOURCE, { level: "standard", imageCodec: codec(20, 10, false), images: vault(HREF) });
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
    mount(SOURCE, { level: "standard", imageCodec: codec(20, 10), images });
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

describe("la cronologia, dal livello Standard", () => {
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

  it("c'è dal livello Standard: il pulsante la apre a destra del foglio, e aperta prende il fuoco", () => {
    mount();
    expect(button().hidden).toBe(true);
    editor.setLevel("standard");
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
    // Sotto il livello Standard si chiude.
    button().click();
    editor.setLevel("essential");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("ogni gesto è un passo; un clic su un passo ci torna in un colpo, con un cambiamento solo e gli stessi byte", () => {
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
    three();
    button().click();
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    editor.load(SceneEngine.open(SOURCE));
    expect(rows()).toEqual(["Disegno aperto *"]);
    expect(panel().querySelector(".draw-history-count")!.textContent).toBe("0 passi");
  });

  it("«?» elenca i tasti della cronologia", () => {
    mount(SOURCE, { level: "standard" });
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

describe("la verifica dell'accessibilità, dal livello Standard", () => {
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

  it("c'è dal livello Standard: il pulsante la apre a destra del foglio, e aperta legge il disegno e prende il fuoco", () => {
    mount(POOR);
    expect(button().hidden).toBe(true);
    editor.setLevel("standard");
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
    // Sotto il livello Standard si chiude.
    button().click();
    editor.setLevel("essential");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("un colore che si legge si mette in un passo; il fuoco passa al problema dopo, e un annulla lo riporta", () => {
    mount(POOR, { level: "standard" });
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
    mount(POOR, { level: "standard" });
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
    mount(POOR, { level: "standard" });
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
    mount(POOR, { level: "standard" });
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
    mount(POOR.replace('<text id="o1a1a1a1a"', '<text id="o1a1a1a1a" fub:locked="true"'), { level: "standard" });
    button().click();
    expect(action(1, "fix")).toBeNull();
    action(1, "go").click();
    expect(spoken()).toMatch(/non si sceglie: è bloccato, nascosto o fuori dal gruppo isolato\.$/);
    expect(editor.selection).toEqual([]);
  });

  it("in sola lettura i problemi si guardano soltanto", () => {
    mount(POOR, { level: "standard" });
    button().click();
    editor.setReadOnly(true);
    expect(panel().querySelector<HTMLElement>(".draw-access-note")!.hidden).toBe(false);
    expect(rows().map((row) => row.querySelectorAll('[data-action]:not([data-action="go"])').length)).toEqual([0, 0, 0]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("l'ordine di lettura: un clic sceglie l'oggetto, Alt+↓ lo sposta, e se passerebbe sopra un vicino che copre prima lo dice", () => {
    mount(STACK, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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

  it("e un documento con ogni livello bloccato lo dice", () => {
    mount(doc('<g id="l1" fub:layer="Uno" fub:locked="true"></g>'));
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    expect(changes).toEqual([]);
    expect(spoken()).toBe("Ogni livello è bloccato o nascosto: non c’è dove disegnare.");
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

  it("Ctrl+', Ctrl+; e Ctrl+U accendono e spengono griglia, guide e guide intelligenti", () => {
    mount(SOURCE, { level: "standard" });
    surface().focus();
    const { shown, rulerGuides, guides } = editor.grid;
    key("'", { ctrlKey: true });
    expect(editor.grid.shown).toBe(!shown);
    key(";", { ctrlKey: true, shiftKey: true });
    expect(editor.grid.rulerGuides).toBe(!rulerGuides);
    key("u", { ctrlKey: true });
    expect(editor.grid.guides).toBe(!guides);
    expect(spoken()).toBe(guides ? "Guide intelligenti spente." : "Guide intelligenti accese.");
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
    mount(SOURCE, { level: "standard" });
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
  /// Le funzioni che non stanno nell'editor: la stampa è della finestra
  /// «Esporta» della superficie, i caratteri del vault sono voci in più nella
  /// scelta della famiglia, quando chi ospita ne dà.
  const OUTSIDE = new Set(["print", "fonts"]);

  /// Ciò che si raggiunge con le funzioni `features`: i comandi del catalogo,
  /// le sezioni e i campi delle proprietà che si vedono, senza selezione, con
  /// ogni oggetto da solo e con tutti insieme, con la selezione e con la penna.
  const reach = (features: readonly string[]): Set<string> => {
    host.replaceChildren();
    mount(KINDS, { level: "custom", custom: features, ...HOST });
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
    mount(KINDS, { level: "standard" });
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

  it("ogni funzione del registro si raggiunge: spegnerla toglie un comando, una sezione o un campo", () => {
    const every = FEATURES.map((spec) => spec.id);
    const full = reach(every);
    const unreachable = every.filter((feature) => {
      if (OUTSIDE.has(feature)) return false;
      const without = reach(every.filter((one) => one !== feature));
      return ![...full].some((what) => !without.has(what));
    });
    expect(unreachable.join(" ")).toBe("");
    // Un editor per funzione: più lento degli altri.
  }, 60_000);

  it("il menu radiale prende dal catalogo strumenti, Annulla e Ripeti, e si apre dal catalogo da tastiera", () => {
    mount(KINDS, { level: "standard" });
    editor.setTool("pen");
    const radial = editor.commands().find((one) => one.id === "draw.radial")!;
    radial.run();
    const items = [...document.querySelectorAll<HTMLElement>(".draw-radial-item")].map((item) => item.getAttribute("aria-label"));
    expect(items).toContain("Annulla");
    expect(items).toContain("Ripeti");
    closeRadial();
  });
});

describe("il livello Personalizzato", () => {
  /// Due livelli: «Sfondo» con due rettangoli, «Note» con un testo.
  const PARTS = doc(
    `<title>Prova</title><g id="l1" fub:layer="Sfondo"><rect id="oa5a5a5a5" x="0" y="0" width="20" height="20" fill="#d55e00"/>` +
      `<rect id="ob5b5b5b5" x="10" y="10" width="20" height="20" fill="#0072b2"/></g>` +
      `<g id="l2" fub:layer="Note"><text id="ot5t5t5t5" x="0" y="60"><tspan x="0" dy="0">Ciao</tspan></text></g>`,
  );
  const A = "oa5a5a5a5";
  const B = "ob5b5b5b5";
  const T = "ot5t5t5t5";

  const shownTools = railNames;
  /// Se nella barra degli strumenti si vede il pulsante `label`.
  const visible = (label: string): boolean =>
    [...host.querySelectorAll<HTMLButtonElement>(".draw-toolbar button")].some(
      (control) => control.getAttribute("aria-label") === label && control.closest("[hidden]") === null,
    );
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const barButtons = (): string[] => [...bar().querySelectorAll<HTMLButtonElement>("button:not([hidden])")].map((control) => control.getAttribute("aria-label") ?? "");
  const hint = (): string => document.getElementById(surface().getAttribute("aria-describedby")!)?.textContent ?? "";

  it("ha le parti scelte una per una, e i tasti e i comandi delle altre non partono", () => {
    mount(PARTS, { level: "custom", custom: ["rect", "ellipse", "layers", "futuro"] });
    expect(editor.level).toBe("custom");
    // Un nome che l'editor non conosce non conta.
    expect([...editor.features]).toEqual(["rect", "ellipse", "layers"]);
    // Senza la penna si comincia dal primo strumento che disegna.
    expect(editor.tool).toBe("rect");
    expect(shownTools()).toEqual(["Selezione", "Mano", "Zoom", "Rettangolo", "Ellisse"]);
    expect(host.querySelector(".draw-layer-button")!.closest("[hidden]")).toBeNull();
    expect(visible("Pagina e griglia")).toBe(false);
    expect(visible("Altro colore…")).toBe(false);
    expect(visible("Attributi")).toBe(false);
    key("p");
    expect(editor.tool).toBe("rect");
    key("#");
    expect(editor.grid.shown).toBe(false);

    editor.select([A, B]);
    // Della barra della selezione, i pulsanti delle parti scelte.
    expect(barButtons()).toEqual(["Sposta in un livello"]);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("g", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("M", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(hint()).toContain("Alt+F10");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un testo scelto da solo non si modifica senza la parte del testo: coi
    // livelli, F2 ne apre il nome.
    editor.select([T]);
    expect(barButtons()).toEqual(["Sposta in un livello"]);
    expect(key("F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".draw-object-rename"));
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(changes).toEqual([]);
  });

  it("la barra della selezione c'è quando ha un pulsante da mostrare", () => {
    mount(PARTS, { level: "custom", custom: ["text"] });
    editor.select([T]);
    expect(bar().hidden).toBe(false);
    expect(barButtons()).toEqual(["Modifica il testo"]);
    // Una forma chiusa ci riceve l'etichetta; due oggetti, niente.
    editor.select([A]);
    expect(barButtons()).toEqual(["Modifica il testo"]);
    editor.select([A, B]);
    expect(bar().hidden).toBe(true);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(false);
    editor.setLevel("custom", ["pen"]);
    editor.select([T]);
    expect(bar().hidden).toBe(true);
    expect(hint()).not.toContain("Alt+F10");
  });

  it("cambia dal vivo con le parti, e tornando al Personalizzato ritrova quelle di prima", () => {
    mount(PARTS, { level: "custom", custom: ["pen", "text"] });
    expect(editor.tool).toBe("pen");
    expect(shownTools()).toEqual(["Selezione", "Mano", "Zoom", "Penna", "Testo"]);
    editor.setTool("text");
    editor.setLevel("custom", ["ellipse", "pen"]);
    // Uno strumento che se ne va lascia il posto alla penna, se c'è.
    expect(editor.tool).toBe("pen");
    editor.setLevel("custom", ["ellipse"]);
    expect(editor.tool).toBe("ellipse");
    editor.setLevel("standard");
    expect(editor.features.has("text")).toBe(true);
    editor.setLevel("custom");
    expect([...editor.features]).toEqual(["ellipse"]);
    // Senza strumenti che disegnano resta la Selezione.
    editor.setLevel("custom", []);
    expect(editor.tool).toBe("select");
    expect(shownTools()).toEqual(["Selezione", "Mano", "Zoom"]);
    expect(changes).toEqual([]);
  });

  it("«Mostra tutto» elenca i tasti delle parti che non ha, col livello da cui vengono", () => {
    mount(SOURCE, { level: "custom", custom: ["pen", "eraser", "rect", "ellipse", "line", "arrow", "grid"] });
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toEqual([
      "Strumenti",
      "Disegnare da tastiera",
      "Oggetti",
      "Griglia",
      "Vista",
      "Modifica",
    ]);
    dialog().querySelector<HTMLButtonElement>(".keys-show-all")!.click();
    const extra = dialog().querySelector<HTMLElement>(".keys-more")!;
    expect(extra.querySelector(".keys-note")!.textContent).toBe(
      "Il livello di adesso è «Personalizzato». I tasti qui sotto sono delle parti che non ha: si aggiungono nelle Impostazioni, nel gruppo «Disegni».",
    );
    const tables = [...extra.querySelectorAll("table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    expect(tables.map((table) => table.caption)).toEqual([
      "Strumenti · dal livello Standard",
      "Oggetti · dal livello Standard",
      "Disponi · dal livello Standard",
      "Selezione avanzata · dal livello Standard",
      "Ritaglia l’immagine · dal livello Standard",
      "Poligono · dal livello Standard",
      "Evidenziatore · dal livello Standard",
      "Forme dal tratto · dal livello Standard",
      "Testo · dal livello Standard",
      "Tavole · dal livello Standard",
      "Contagocce · dal livello Standard",
      "Sfumatura · dal livello Standard",
      "Guide intelligenti · dal livello Standard",
      "Righelli e guide · dal livello Standard",
      "Proprietà · dal livello Standard",
      "Vista · dal livello Standard",
      "Modifica · dal livello Standard",
      "Elenco delle tavole · dal livello Standard",
      "Presentazione · dal livello Standard",
      "Cronologia · dal livello Standard",
      "Accessibilità · dal livello Standard",
    ]);
    expect(tables[0]!.rows).toEqual([["Q", "Lazo"], ["F", "Tavola"], ["I", "Contagocce"], ["G", "Sfumatura"], ["Shift+P", "Evidenziatore"], ["X", "Connettore"], ["Y", "Poligono"], ["T", "Testo"]]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
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
    mount();
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
    mount(SOURCE, { level: "standard" });
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

  it("lo stile si copia e si incolla con Ctrl+Alt+C e Ctrl+Alt+V, dal livello Standard, in un passo", () => {
    const A = "oa1a1a1a1";
    const B = "ob2b2b2b2";
    const PAIR = doc(
      `<title>Prova</title>${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2" stroke="#d55e00" stroke-width="4" stroke-dasharray="4 2" opacity="0.5"/>` +
        `<rect id="${B}" x="50" y="10" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
    );
    mount(PAIR);
    editor.select([A]);
    expect(key("c", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    editor.dispose();
    mount(PAIR, { level: "standard" });
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
      { level: "standard" },
    );
    editor.select([A]);
    key("c", { ctrlKey: true, altKey: true });
    editor.dispose();
    // Qui «blu mare» ha lo stesso colore, e «Vermiglio» un altro.
    const OTHER = doc(
      `<defs id="fub-defs">${swatch("rt1t1t1t1", "blu mare", "#0072b2")}${swatch("rt2t2t2t2", "Vermiglio", "#e69f00")}</defs>` +
        `${LAYER}<rect id="${B}" x="50" y="10" width="20" height="20" fill="#000000"/></g>`,
    );
    mount(OTHER, { level: "standard" });
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
      { level: "standard" },
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

describe("la vista girata e i gesti, dal livello Standard", () => {
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
    mount(SOURCE, { level: "standard" });
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

  it("all'Essenziale la vista non gira, e il livello che toglie la vista girata la raddrizza", () => {
    mount();
    size(200, 100);
    key("6");
    near(cameraOf(), [1, 0, 0, 1, 0, 0]);
    expect(turnButton().hidden).toBe(true);
    editor.setLevel("standard");
    key("6");
    expect(turnButton().hidden).toBe(false);
    editor.setLevel("essential");
    near(cameraOf(), [1, 0, 0, 1, 0, 0]);
    expect(turnButton().hidden).toBe(true);
  });

  it("la rotella con Ctrl e Maiusc gira a passi, attorno al puntatore", () => {
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard", onGridChange: (grid) => grids.push(grid) });
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

describe("il menu radiale, dal livello Standard", () => {
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard", colors: ["#3a7bd5", "#000000", "#cc79a7", "#56b4e9"] });
    size(200, 100);
    surface().focus();
    rightClick(100, 50);
    expect(colors()).toEqual(["sw Colore: Azzurro", "w Colore: Personalizzato #3a7bd5", "nw Colore: Porpora"]);
    voice("Colore: Personalizzato #3a7bd5").click();
    expect(spoken()).toBe("Colore: Personalizzato #3a7bd5.");
    // Senza i colori a piacere la penna torna al nero, e a sinistra restano
    // i recenti della tavolozza.
    editor.setLevel("custom", ["pen", "gestures"]);
    rightClick(100, 50);
    expect(colors()).toEqual(["sw Colore: Blu", "w Colore: Porpora", "nw Colore: Azzurro"]);
  });

  it("tenuto premuto segue il puntatore: lasciato verso una voce la sceglie, e non disegna", () => {
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
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
    mount(SOURCE, { level: "standard" });
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    expect(editor.engine.text).not.toBe(SOURCE);
    const ERASER = { pointerId: 6, pointerType: "pen", button: 5, buttons: 32 } as const;
    drag([[25, 2], [25, 18]], ERASER);
    expect(editor.engine.text).toBe(SOURCE);
    expect(editor.tool).toBe("pen");
  });

  it("il tasto laterale fa ciò che si è scelto: il lazo, la gomma o niente, e il clic destro dopo non apre il menu", () => {
    mount(SOURCE, { level: "standard" });
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = editor.engine.text;
    const BARREL = { pointerId: 6, pointerType: "pen", button: 2, buttons: 2 } as const;
    editor.setGrid({ ...editor.grid, barrel: "none" });
    drag([[25, 2], [25, 18]], BARREL);
    expect(radial()).toBeNull();
    expect(editor.engine.text).toBe(drawn);
    editor.setGrid({ ...editor.grid, barrel: "lasso" });
    drag([[5, 5], [45, 5], [45, 15], [5, 15]], BARREL);
    expect(editor.selection).toHaveLength(1);
    expect(rightClick(45, 15, { pointerType: "pen" }).defaultPrevented).toBe(true);
    expect(document.querySelector(".context-menu")).toBeNull();
    editor.setGrid({ ...editor.grid, barrel: "eraser" });
    drag([[25, 2], [25, 18]], BARREL);
    expect(editor.engine.text).toBe(SOURCE);
    expect(editor.tool).toBe("pen");
  });

  it("il tocco lungo del dito che disegna lo apre senza lasciare un punto; alzato nel mezzo, resta aperto", () => {
    mount(SOURCE, { level: "standard" });
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

  it("col mouse e con Maiusc+F10 si apre il menu della selezione, e il radiale è la sua ultima voce, col fuoco sulla prima voce che vale", () => {
    mount(SOURCE, { level: "standard" });
    size(200, 100);
    expect(rightClick(100, 50, { pointerType: "mouse" }).defaultPrevented).toBe(true);
    expect(radial()).toBeNull();
    expect(entries().map((one) => one.querySelector(".menu-label")!.textContent).slice(0, 2)).toEqual(["Taglia", "Copia"]);
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
    editor.setLevel("custom", ["pen", "gestures"]);
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(radial()).not.toBeNull();
  });

  it("con gli strumenti che scelgono, sulle guide e all'Essenziale il clic destro resta quello di prima", () => {
    mount(SOURCE, { level: "standard" });
    size(200, 100);
    editor.setTool("select");
    rightClick(100, 50);
    expect(radial()).toBeNull();
    expect(document.querySelector(".context-menu")).not.toBeNull();
    closeContextMenu();
    editor.setTool("pen");
    editor.setLevel("essential");
    expect(rightClick(100, 50).defaultPrevented).toBe(false);
    expect(radial()).toBeNull();
    const PEN = { pointerId: 6, pointerType: "pen" } as const;
    surface().dispatchEvent(pointer("pointerdown", { ...PEN, button: 2, buttons: 2, pressure: 0.3, clientX: 100, clientY: 50, timeStamp: (clock += 8) }));
    expect(radial()).toBeNull();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(false);
  });
});

describe("le tavole, dal livello Standard", () => {
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
  const boarding = (source = BOARDS): void => {
    mount(source, { level: "standard" });
    size(1000, 500);
    key("f");
  };
  const boardsButton = (): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Tavole"]');
  const boardsList = (): HTMLElement => host.querySelector<HTMLElement>('.draw-boards [role="listbox"]')!;
  /// Le righe dell'elenco, dall'alto: il nome e la misura, e `*` su quella
  /// di adesso.
  const boardRows = (): string[] =>
    [...host.querySelectorAll<HTMLElement>('.draw-boards [role="option"]')]
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
      .map((item) => `${item.querySelector(".draw-board-name")!.textContent} ${item.querySelector(".draw-board-size")!.textContent}${item.getAttribute("aria-current") === "true" ? " *" : ""}`);
  /// Dove stanno le carte delle tavole sullo schermo.
  const sheets = (): string[] => [...host.querySelectorAll<HTMLElement>(".draw-sheets .draw-page")].map((sheet) => sheet.style.transform);

  it("F sceglie lo strumento e la tavola che si guarda, e lascia la selezione", () => {
    mount(BOARDS, { level: "standard" });
    size(1000, 500);
    editor.select([SQUARE]);
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", false]]);
    key("f");
    expect(editor.tool).toBe("board");
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("Strumento: Tavola. Copertina, tavola 1 di 2, 400 × 200.");
    expect(names()).toEqual([["Copertina", true], ["Evaporazione", false]]);
    expect(host.querySelectorAll(".draw-sheets .draw-page")).toHaveLength(2);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un trascinamento fuori dalle tavole ne disegna una, e con Maiusc anche dentro", () => {
    boarding();
    drag([[100, 300], [150, 350], [300, 420]]);
    expect(spoken()).toBe("Tavola 3 aggiunta, 200 × 120.");
    expect(editor.engine.text).toMatch(/<view id="b[0-9a-z]{8}" fub:role="board" viewBox="100 300 200 120">\s*<title>Tavola 3<\/title>\s*<\/view>/);
    expect(names().map(([name, chosen]) => [name, chosen])).toEqual([["Copertina", false], ["Evaporazione", false], ["Tavola 3", true]]);
    // Senza Maiusc, dentro una tavola si sposta lei.
    drag([[50, 50], [100, 100], [150, 120]], { shiftKey: true });
    expect(spoken()).toBe("Tavola 4 aggiunta, 100 × 70.");
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("spostare una tavola porta con sé ciò che le sta sopra, e annulla la riporta", () => {
    boarding();
    drag([[600, 150], [620, 170], [650, 200]]);
    expect(spoken()).toBe("Evaporazione spostata a x 530, y 50, con 1 oggetto.");
    expect(editor.engine.text).toContain('<view id="b9i0j1k2l" fub:role="board" viewBox="530 50 400 200">');
    expect(editor.engine.text).toContain('<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="530" y="50" width="400" height="200" fill="#fafafa"/>');
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", true]]);
    expect(editor.selection).toEqual([]);
    editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("una maniglia del bordo allarga la tavola scelta", () => {
    boarding();
    drag([[400, 100], [420, 100], [440, 100]]);
    expect(spoken()).toBe("Copertina, 440 × 200.");
    expect(editor.engine.text).toContain('<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 440 200">');
    expect(editor.engine.text).toContain('x="0" y="0" width="440" height="200" fill="#fafafa"/>');
  });

  it("da tastiera si va di tavola in tavola, si sposta, si allarga e si toglie", () => {
    boarding();
    key("Tab");
    expect(spoken()).toBe("Evaporazione, tavola 2 di 2, 400 × 200.");
    // Oltre l'ultima, il Tab esce dal foglio.
    expect(key("Tab").defaultPrevented).toBe(false);
    key("ArrowRight");
    expect(spoken()).toBe("Evaporazione spostata a x 481, y 0, con 1 oggetto.");
    key("ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Evaporazione, 400 × 210.");
    key("Home");
    expect(spoken()).toBe("Copertina, tavola 1 di 2, 400 × 200.");
    key("Delete");
    expect(spoken()).toBe("Copertina eliminata; il disegno resta com’era. Evaporazione, tavola 1 di 1, 400 × 210.");
    expect(names()).toEqual([["Evaporazione", true]]);
    key("Escape");
    expect(spoken()).toBe("Nessuna tavola scelta.");
    expect(names()).toEqual([["Evaporazione", false]]);
    editor.undo();
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("Alt e Pag vanno di tavola in tavola con ogni strumento", () => {
    mount(BOARDS, { level: "standard" });
    size(1000, 500);
    key("PageDown", { altKey: true });
    expect(spoken()).toBe("Copertina, tavola 1 di 2, 400 × 200.");
    key("PageDown", { altKey: true });
    expect(spoken()).toBe("Evaporazione, tavola 2 di 2, 400 × 200.");
    key("PageDown", { altKey: true });
    expect(spoken()).toBe("Evaporazione è l’ultima tavola.");
    expect(editor.tool).toBe("pen");
  });

  it("senza tavole sceglie la pagina, e la prima tavola disegnata la fa diventare la tavola 1", () => {
    boarding(SOURCE);
    expect(spoken()).toBe("Strumento: Tavola. Pagina, 100 × 100. Disegna una tavola per dividere il disegno in pagine.");
    drag([[200, 20], [250, 50], [300, 90]]);
    expect(spoken()).toBe("La pagina è diventata Tavola 1; Tavola 2 aggiunta, 100 × 70.");
    expect(names()).toEqual([["Tavola 1", false], ["Tavola 2", true]]);
    // Due passi: la pagina che diventa la tavola 1, poi la tavola nuova.
    // Annullata questa, resta la tavola 1, ed è lei la scelta.
    expect(changes).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Nuova tavola.");
    expect(names()).toEqual([["Tavola 1", true]]);
    editor.undo();
    expect(spoken()).toBe("Annullato: Prima tavola dalla pagina.");
    expect(editor.engine.text).toBe(SOURCE);
    key("d", { ctrlKey: true });
    expect(spoken()).toBe("La pagina è diventata Tavola 1. Tavola 1 copia aggiunta a x 180, y 0, con 1 oggetto.");
    editor.undo();
    editor.undo();
    editor.redo();
    expect(spoken()).toBe("Ripetuto: Prima tavola dalla pagina.");
    expect(names()).toEqual([["Tavola 1", true]]);
    editor.redo();
    expect(names()).toEqual([["Tavola 1", false], ["Tavola 1 copia", true]]);
  });

  it("con Alt, spostare una tavola ne lascia una copia dove la si posa, con ciò che le sta sopra", () => {
    boarding();
    const target = surface();
    const at = (type: string, x: number, y: number, altKey: boolean): void => {
      const buttons = type === "pointerup" ? 0 : 1;
      target.dispatchEvent(pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons * 0.5, clientX: x, clientY: y, altKey, timeStamp: (clock += 8) }));
    };
    at("pointerdown", 600, 150, true);
    at("pointermove", 600, 300, true);
    // La tavola resta dov'è; la cornice della copia dice dove andrà.
    expect(target.dataset.grip).toBe("copy");
    expect(sheets()).toEqual(["translate(0px, 0px)", "translate(480px, 0px)"]);
    // Alt lasciato a metà gesto: la tavola si sposta, e lo si vede.
    target.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    expect(target.dataset.grip).toBe("move");
    expect(sheets()).toEqual(["translate(0px, 0px)", "translate(480px, 150px)"]);
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true }));
    expect(target.dataset.grip).toBe("copy");
    expect(sheets()).toEqual(["translate(0px, 0px)", "translate(480px, 0px)"]);
    at("pointermove", 600, 450, true);
    at("pointerup", 600, 450, true);
    // La copia si aggancia anche alla tavola da cui viene.
    expect(spoken()).toBe("Evaporazione copia aggiunta a x 480, y 300, con 1 oggetto. Agganciato: il bordo sinistro in linea con quello di Evaporazione.");
    const text = editor.engine.text;
    expect(text).toContain('<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>');
    expect(text).toMatch(/<view id="b[0-9a-z]{8}" fub:role="board" viewBox="480 300 400 200">\s*<title>Evaporazione copia<\/title>\s*<\/view>/);
    expect(text).toMatch(/<rect id="o[0-9a-z]{8}" x="600" y="50" width="20" height="20" fill="#000000" transform="matrix\(1 0 0 1 0 300\)"\/>/);
    expect(text).toContain(`<rect id="${SQUARE}" x="600" y="50" width="20" height="20" fill="#000000"/>`);
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", false], ["Evaporazione copia", true]]);
    editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("Ctrl+D con lo strumento Tavola duplica la tavola scelta accanto, con ciò che le sta sopra", () => {
    boarding();
    key("Tab");
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Evaporazione copia aggiunta a x 960, y 0, con 1 oggetto.");
    const text = editor.engine.text;
    // La copia sta subito dopo la sua tavola, con la sua carta.
    expect(text).toMatch(/<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione<\/title><\/view>\s*<view id="b[0-9a-z]{8}" fub:role="board" viewBox="960 0 400 200">/);
    expect(text).toMatch(/<rect id="c[0-9a-z]{8}" fub:role="paper" fub:board="b[0-9a-z]{8}" x="960" y="0" width="400" height="200" fill="#fafafa"\/>/);
    expect(text).toMatch(/<rect id="o[0-9a-z]{8}" x="600" y="50" width="20" height="20" fill="#000000" transform="matrix\(1 0 0 1 480 0\)"\/>/);
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", false], ["Evaporazione copia", true]]);
    // Ancora: la copia della copia va più in là.
    key("d", { ctrlKey: true });
    expect(spoken()).toBe("Evaporazione copia copia aggiunta a x 1440, y 0, con 1 oggetto.");
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
    key("Escape");
    key("d", { ctrlKey: true });
    expect(spoken()).toBe("Nessuna tavola scelta.");
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("senza tavole, Ctrl+D duplica la pagina, che prima diventa la tavola 1", () => {
    boarding(SOURCE);
    key("d", { ctrlKey: true });
    expect(spoken()).toBe("La pagina è diventata Tavola 1. Tavola 1 copia aggiunta a x 180, y 0, con 1 oggetto.");
    expect(names()).toEqual([["Tavola 1", false], ["Tavola 1 copia", true]]);
    // Annullata la copia, resta la tavola 1, scelta; poi la pagina.
    editor.undo();
    expect(spoken()).toBe("Annullato: Copia di una tavola.");
    expect(names()).toEqual([["Tavola 1", true]]);
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Prima tavola dalla pagina.");
  });

  it("il pulsante Tavole apre l'elenco, che segna la tavola di adesso e porta alle altre", () => {
    mount(BOARDS, { level: "standard" });
    size(1000, 500);
    expect(boardsButton()!.hidden).toBe(false);
    boardsButton()!.click();
    expect(boardsButton()!.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(boardsList());
    // Senza una tavola scelta, quella di adesso è quella che si guarda.
    expect(boardRows()).toEqual(["Copertina 400 × 200 *", "Evaporazione 400 × 200"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    key("ArrowDown", {}, boardsList());
    key("Enter", {}, boardsList());
    expect(spoken()).toBe("Evaporazione, tavola 2 di 2, 400 × 200.");
    expect(boardRows()).toEqual(["Copertina 400 × 200", "Evaporazione 400 × 200 *"]);
    expect(document.activeElement).toBe(boardsList());
    // Esc torna al foglio; il pulsante chiude l'elenco.
    key("Escape", {}, boardsList());
    expect(document.activeElement).toBe(surface());
    boardsButton()!.click();
    expect(host.querySelector<HTMLElement>(".draw-boards")!.hidden).toBe(true);
  });

  it("dall'elenco si aggiungono, si rinominano, si riordinano, si duplicano e si eliminano le tavole", () => {
    mount(BOARDS, { level: "standard" });
    size(1000, 500);
    boardsButton()!.click();
    host.querySelector<HTMLButtonElement>(".draw-boards-add")!.click();
    // Della misura di quella di adesso, a destra di tutte; il nome si scrive
    // subito.
    expect(spoken()).toBe("Tavola 3 aggiunta, 400 × 200.");
    expect(editor.engine.text).toMatch(/<view id="b[0-9a-z]{8}" fub:role="board" viewBox="960 0 400 200">\s*<title>Tavola 3<\/title>/);
    const name = host.querySelector<HTMLInputElement>(".draw-boards .draw-board-rename")!;
    expect(document.activeElement).toBe(name);
    name.value = "Condensazione";
    key("Enter", {}, name);
    expect(spoken()).toBe("Ora la tavola si chiama «Condensazione».");
    expect(boardRows()).toEqual(["Copertina 400 × 200", "Evaporazione 400 × 200", "Condensazione 400 × 200 *"]);
    key("ArrowUp", { altKey: true }, boardsList());
    expect(spoken()).toBe("Condensazione ora è la tavola 2 di 3.");
    expect(boardRows()).toEqual(["Copertina 400 × 200", "Condensazione 400 × 200 *", "Evaporazione 400 × 200"]);
    key("d", { ctrlKey: true }, boardsList());
    expect(spoken()).toBe("Condensazione copia aggiunta a x 1440, y 0.");
    expect(boardRows()).toEqual(["Copertina 400 × 200", "Condensazione 400 × 200", "Condensazione copia 400 × 200 *", "Evaporazione 400 × 200"]);
    key("Delete", {}, boardsList());
    expect(spoken()).toBe("Condensazione copia eliminata; il disegno resta com’era. Evaporazione, tavola 3 di 3, 400 × 200.");
    expect(boardRows()).toEqual(["Copertina 400 × 200", "Condensazione 400 × 200", "Evaporazione 400 × 200 *"]);
    // Con l'elenco aperto, F2 sul foglio apre il nome lì.
    key("f");
    key("F2");
    expect(document.activeElement).toBe(host.querySelector(".draw-boards .draw-board-rename"));
    expect(document.querySelector(".modale")).toBeNull();
    key("Escape", {}, host.querySelector<HTMLElement>(".draw-boards .draw-board-rename")!);
    for (let step = 0; step < 5; step++) editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("in un disegno senza pagina, «Nuova tavola» ne mette una attorno a ciò che c'è", () => {
    const loose = SOURCE.replace(' viewBox="0 0 100 100"', "");
    mount(loose, { level: "standard" });
    size(1000, 500);
    boardsButton()!.click();
    expect(host.querySelector(".draw-boards-empty")!.textContent).toBe(
      "Il disegno non ha una pagina: è un foglio senza bordi. Con «Nuova tavola» una tavola racchiude tutto ciò che c’è.",
    );
    host.querySelector<HTMLButtonElement>(".draw-boards-add")!.click();
    expect(spoken()).toBe("Tavola 1 aggiunta, 22 × 22.");
    expect(editor.engine.text).toMatch(/<view id="b[0-9a-z]{8}" fub:role="board" viewBox="59 59 22 22">\s*<title>Tavola 1<\/title>/);
    expect(boardRows()).toEqual(["Tavola 1 22 × 22 *"]);
    editor.undo();
    expect(editor.engine.text).toBe(loose);
  });

  /// Il pannello delle proprietà, aperto, e i suoi campi.
  const openProperties = (): void => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
  const propertySection = (id: string): HTMLElement => properties().querySelector<HTMLElement>(`.draw-properties-section[data-section="${id}"]`)!;
  const subject = (): string | null => properties().querySelector(".draw-properties-subject")!.textContent;
  const preset = (id: string): HTMLSelectElement => property(id).querySelector("select")!;
  const choosePreset = (id: string, value: string): void => {
    preset(id).value = value;
    preset(id).dispatchEvent(new Event("change", { bubbles: true }));
  };
  const orientations = (id: string): Array<string | null> => [...property(id).querySelectorAll("button")].map((button) => button.getAttribute("aria-pressed"));
  /// Vero se il pannello mostra il campo `id`: un campo entra nel pannello
  /// la prima volta che ha di che mostrarsi.
  const showing = (id: string): boolean => {
    const field = properties().querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`);
    return field !== null && !field.hidden;
  };
  /// Scrive `text` nel campo `id` del pannello e lo fa partire con Invio.
  const writeProperty = (id: string, text: string): void => {
    const input = propertyInput(id);
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };

  it("il pannello delle proprietà mostra la tavola scelta, e la segue", () => {
    boarding();
    openProperties();
    expect(subject()).toBe("Tavola 1 di 2");
    expect(propertySection("board").hidden).toBe(false);
    expect(propertyInput("boardName").value).toBe("Copertina");
    expect(preset("boardPreset").value).toBe("custom");
    expect(orientations("boardOrientation")).toEqual(["false", "true"]);
    expect(["boardX", "boardY", "boardWidth", "boardHeight"].map((id) => propertyInput(id).value)).toEqual(["0", "0", "400", "200"]);
    // Con le tavole la pagina è la tela: non ha un formato.
    expect(showing("pagePreset")).toBe(false);
    expect(showing("pageWidth")).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    key("Tab");
    expect(subject()).toBe("Tavola 2 di 2");
    expect(propertyInput("boardName").value).toBe("Evaporazione");
    expect(propertyInput("boardX").value).toBe("480");
    // Con un altro strumento il pannello torna al disegno.
    key("v");
    expect(subject()).toBe("Il disegno");
    expect(propertySection("board").hidden).toBe(true);
  });

  it("dal pannello la tavola prende una misura pronta, il verso, il posto con ciò che porta, le misure e il nome", () => {
    boarding();
    openProperties();
    key("Tab");
    choosePreset("boardPreset", "hd");
    expect(editor.engine.text).toContain('<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 1280 720">');
    expect(preset("boardPreset").value).toBe("hd");
    property("boardOrientation").querySelector<HTMLButtonElement>('button[aria-label="Verticale"]')!.click();
    expect(editor.engine.text).toContain('<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 720 1280">');
    expect(orientations("boardOrientation")).toEqual(["true", "false"]);
    writeProperty("boardX", "500");
    expect(editor.engine.text).toContain('<view id="b9i0j1k2l" fub:role="board" viewBox="500 0 720 1280">');
    expect(editor.engine.text).toContain(`<rect id="${SQUARE}" x="600" y="50" width="20" height="20" fill="#000000" transform="matrix(1 0 0 1 20 0)"/>`);
    writeProperty("boardWidth", "800");
    expect(editor.engine.text).toContain('<view id="b9i0j1k2l" fub:role="board" viewBox="500 0 800 1280">');
    expect(preset("boardPreset").value).toBe("custom");
    writeProperty("boardName", "Retro");
    expect(editor.engine.text).toContain("<title>Retro</title>");
    expect(names()).toEqual([["Copertina", false], ["Retro", true]]);
    // Un nome vuoto non cambia niente, come nell'elenco.
    writeProperty("boardName", "  ");
    expect(propertyInput("boardName").value).toBe("Retro");
    for (let step = 0; step < 5; step += 1) editor.undo();
    expect(editor.engine.text).toBe(BOARDS);
  });

  it("senza tavole, il pannello dà alla pagina una misura pronta e un verso", () => {
    mount(SOURCE, { level: "standard" });
    openProperties();
    expect(subject()).toBe("Il disegno");
    expect(preset("pagePreset").value).toBe("custom");
    expect(property("pageOrientation").querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
    choosePreset("pagePreset", "a4");
    expect(editor.engine.text).toContain('viewBox="0 0 793.7 1122.52"');
    property("pageOrientation").querySelector<HTMLButtonElement>('button[aria-label="Orizzontale"]')!.click();
    expect(editor.engine.text).toContain('viewBox="0 0 1122.52 793.7"');
    expect(preset("pagePreset").value).toBe("a4");
    expect(orientations("pageOrientation")).toEqual(["false", "true"]);
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("dall'indice una tavola si sceglie e si inquadra, e la selezione resta", () => {
    mount(BOARDS, { level: "standard" });
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
    key("f");
    expect(spoken()).toBe("Strumento: Tavola. Copertina, tavola 1 di 2, 400 × 200.");
    expect(names()).toEqual([["Copertina", true], ["Evaporazione", false]]);
  });

  it("all'Essenziale le tavole si vedono, ma lo strumento, i suoi tasti e l'elenco non ci sono", () => {
    mount(BOARDS);
    size(1000, 500);
    key("f");
    key("PageDown", { altKey: true });
    expect(editor.tool).toBe("pen");
    expect(spoken()).toBe("");
    expect(names()).toEqual([["Copertina", false], ["Evaporazione", false]]);
    expect(boardsButton()?.hidden ?? true).toBe(true);
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
    mount(SOURCE_EXPORT, { level: "standard" });
    expect(editor.exportScene()).toEqual({ scene: { selection: null, boards: BOARDS_OFFERED }, naming: null, named: 0 });
  });

  it("la selezione per id, col riquadro sui numeri interi, e gli id che mancano pronti in un passo che non è ancora scritto", () => {
    mount(SOURCE_EXPORT, { level: "standard" });
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
    mount(SOURCE_EXPORT, { level: "standard" });
    key("a", { ctrlKey: true });
    editor.setReadOnly(true);
    expect(editor.exportScene()).toEqual({
      scene: { selection: { count: 2, ids: [SQUARE], box: [10, 10, 610, 60] }, boards: BOARDS_OFFERED },
      naming: null,
      named: 0,
    });
  });
});

describe("le punte delle linee, dal livello Standard", () => {
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
    mount(LINE, { level: "standard" });
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
    mount(LINE, { level: "standard" });
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

describe("«Ritaglia immagine», dal livello Standard", () => {
  const IMAGE = "img";
  const PNG_HREF = "data:image/png;base64,iVBORw0KGgo=";
  const DRAWING = doc(`${LAYER}<image id="${IMAGE}" x="10" y="10" width="40" height="20" href="${PNG_HREF}"/><rect id="r" x="60" y="60" width="20" height="20"/></g>`);
  const CROPPED = doc(
    `<defs id="fub-defs"><clipPath id="c1" fub:role="private"><rect x="20" y="10" width="20" height="20"/></clipPath></defs>` +
      `${LAYER}<image id="${IMAGE}" x="10" y="10" width="40" height="20" href="${PNG_HREF}" clip-path="url(#c1)"/><rect id="r" x="60" y="60" width="20" height="20"/></g>`,
  );

  const arrangeAction = (label: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`.draw-arrange button[aria-label="${label}"]`)!;
  const cropButton = (): HTMLButtonElement => arrangeAction("Ritaglia…");
  const uncropButton = (): HTMLButtonElement => arrangeAction("Togli il ritaglio");
  const bar = (): HTMLElement => [...host.querySelectorAll<HTMLElement>(".draw-paths")].find((each) => each.querySelector(".draw-paths-title")!.textContent === "Ritaglia l’immagine")!;
  const names = (): string[] => [...bar().querySelectorAll("label")].map((label) => label.querySelector("span")!.textContent ?? "");
  const side = (name: string): HTMLInputElement => [...bar().querySelectorAll("label")].find((label) => label.textContent!.startsWith(name))!.querySelector("input")!;
  const status = (): string => bar().querySelector("output")!.textContent ?? "";
  const action = (name: string): HTMLButtonElement => [...bar().querySelectorAll("button")].find((each) => each.textContent === name)!;
  const painted = (): SVGElement => surface().querySelector<SVGElement>(`image[data-scene-id="${IMAGE}"]`)!;
  /// Il rettangolo del ritaglio scritto, e la posizione dell'immagine.
  const written = (): string => {
    const text = editor.engine.text;
    const rect = /<clipPath id="([^"]+)" fub:role="private">\s*<rect ([^/]*)\/>\s*<\/clipPath>/.exec(text);
    const image = new RegExp(`<image id="${IMAGE}" ([^>]*)/>`).exec(text)![1]!;
    const at = / x="([^"]+)" y="([^"]+)"/.exec(` ${image}`)!;
    const clip = /clip-path="url\(#([^)]+)\)"/.exec(image);
    return `${at[1]} ${at[2]}${clip === null ? "" : ` ${clip[1] === rect![1] ? "" : "!"}${rect![2]}`}`;
  };
  /// Due tocchi del mouse nello stesso punto.
  const twice = (x: number, y: number): void => {
    clock += 1000;
    drag([[x, y]]);
    drag([[x, y]]);
  };

  it("c'è dallo Standard, con un'immagine scelta da sola; «Togli il ritaglio» con una ritagliata", () => {
    mount(CROPPED, { level: "essential" });
    editor.select([IMAGE]);
    expect(cropButton().hidden).toBe(true);
    editor.setLevel("standard");
    expect(cropButton().hidden).toBe(false);
    expect(uncropButton().hidden).toBe(false);
    editor.select([IMAGE, "r"]);
    expect(cropButton().hidden).toBe(true);
    expect(uncropButton().hidden).toBe(false);
    editor.select(["r"]);
    expect(cropButton().hidden).toBe(true);
    expect(uncropButton().hidden).toBe(true);
  });

  it("dalla barra: i margini e quanto si vede, l'anteprima, Invio scrive il ritaglio in un passo", () => {
    mount(DRAWING, { level: "standard" });
    const before = editor.engine.text;
    editor.select([IMAGE]);
    cropButton().click();
    expect(bar().hidden).toBe(false);
    expect(names()).toEqual(["In alto", "A destra", "In basso", "A sinistra"]);
    expect(names().map((name) => side(name).value)).toEqual(["0", "0", "0", "0"]);
    expect(document.activeElement).toBe(side("In alto"));
    expect(status()).toBe("Si vede l’immagine intera.");
    expect(spoken()).toBe("Tira i segni per ritagliare, e l’immagine per spostarla sotto il ritaglio; anche le frecce la spostano. Invio applica, Esc annulla.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    typeIn(side("A sinistra"), "10");
    typeIn(side("In basso"), "5");
    expect(status()).toBe("Si vede 30 × 15 di 40 × 20.");
    // L'anteprima: l'immagine intera attenuata, e sopra la parte che resta.
    expect(painted().style.visibility).toBe("hidden");
    const stands = [...surface().querySelectorAll("image:not([data-scene-id])")];
    expect(stands).toHaveLength(2);
    expect(stands[0]!.parentElement!.getAttribute("style")).toMatch(/^opacity: ?0\.3;?$/);
    expect(stands[1]!.getAttribute("clip-path")).toMatch(/^url\(#/);
    expect(changes).toEqual([]);
    // Un margine che lascia troppo poco non cambia il ritaglio.
    typeIn(side("A destra"), "40");
    expect(status()).toBe("I margini lasciano troppo poco dell’immagine.");
    typeIn(side("A destra"), "0");
    key("Enter", {}, side("A destra"));
    expect(bar().hidden).toBe(true);
    expect(painted().style.visibility).toBe("");
    expect(surface().querySelectorAll("image:not([data-scene-id])")).toHaveLength(0);
    expect(changes).toHaveLength(1);
    expect(written()).toBe('10 10 x="20" y="10" width="30" height="15"');
    expect(spoken()).toBe("Immagine ritagliata: si vede 30 × 15.");
    expect(document.activeElement).toBe(surface());
    expect(editor.selection).toEqual([IMAGE]);
    // L'immagine è dove si vede, anche per l'export della selezione.
    expect(editor.exportScene().scene.selection!.box).toEqual([20, 10, 30, 15]);
    expect(uncropButton().hidden).toBe(false);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("sul foglio: un segno tira il ritaglio, l'immagine si sposta sotto, anche con le frecce, e Invio applica", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    // Il segno a metà del lato destro.
    drag([[50, 20], [46, 20], [40, 20]]);
    expect(status()).toBe("Si vede 30 × 20 di 40 × 20.");
    expect(spoken()).toBe("Si vede 30 × 20 di 40 × 20.");
    expect(side("A destra").value).toBe("10");
    // Dentro, l'immagine scorre sotto il ritaglio, e si ferma al suo bordo.
    drag([[20, 20], [16, 20], [12, 20], [0, 20]]);
    expect(spoken()).toBe("Margini: in alto 0, a destra 0, in basso 0, a sinistra 10.");
    key("ArrowRight");
    expect(spoken()).toBe("Margini: in alto 0, a destra 1, in basso 0, a sinistra 9.");
    expect(changes).toEqual([]);
    key("Enter");
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(1);
    expect(written()).toBe('1 10 x="10" y="10" width="30" height="20"');
  });

  it("con Maiusc un angolo tiene le proporzioni, con Alt il ritaglio resta attorno al centro", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    // L'angolo in basso a destra verso l'alto a sinistra: metà, nelle
    // proporzioni di 40 × 20.
    drag([[50, 30], [40, 26], [30, 20]], { shiftKey: true });
    expect(status()).toBe("Si vede 20 × 10 di 40 × 20.");
    action("Annulla").click();
    expect(spoken()).toBe("Ritaglio annullato.");
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [45, 20]], { altKey: true });
    expect(names().map((name) => side(name).value)).toEqual(["0", "5", "0", "5"]);
    action("Applica").click();
    expect(written()).toBe('10 10 x="15" y="10" width="30" height="20"');
  });

  it("due tocchi la aprono; Esc annulla; un tocco fuori applica e sceglie ciò che tocca", () => {
    mount(DRAWING, { level: "standard" });
    editor.setTool("select");
    twice(30, 20);
    expect(bar().hidden).toBe(false);
    expect(document.activeElement).toBe(surface());
    drag([[50, 20], [46, 20], [40, 20]]);
    key("Escape");
    expect(bar().hidden).toBe(true);
    expect(spoken()).toBe("Ritaglio annullato.");
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual([IMAGE]);
    twice(30, 20);
    drag([[50, 20], [46, 20], [40, 20]]);
    drag([[70, 70]]);
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(1);
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
    expect(editor.selection).toEqual(["r"]);
  });

  it("un ritaglio che c'è si cambia sul posto, e portato all'immagine intera se ne va", () => {
    mount(CROPPED, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    expect(names().map((name) => side(name).value)).toEqual(["0", "10", "0", "10"]);
    expect(status()).toBe("Si vede 20 × 20 di 40 × 20.");
    typeIn(side("A destra"), "0");
    key("Enter", {}, side("A destra"));
    expect(written()).toBe('10 10 x="20" y="10" width="30" height="20"');
    cropButton().click();
    typeIn(side("A sinistra"), "0");
    key("Enter", {}, side("A sinistra"));
    expect(spoken()).toBe("Ritaglio tolto: si vede l’immagine intera.");
    expect(written()).toBe("10 10");
    expect(editor.engine.text).not.toContain("clipPath");
  });

  it("cambiare strumento o scelta applica il ritaglio; un annulla lo chiude senza scriverlo", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [40, 20]]);
    editor.select(["r"]);
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(1);
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[40, 20], [36, 20], [30, 20]]);
    key("r");
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    expect(written()).toBe('10 10 x="10" y="10" width="20" height="20"');
    key("v");
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[30, 20], [26, 20], [20, 20]]);
    // Annulla chiude il ritaglio come Esc, e non annulla altro.
    editor.undo();
    expect(bar().hidden).toBe(true);
    expect(spoken()).toBe("Ritaglio annullato.");
    expect(written()).toBe('10 10 x="10" y="10" width="20" height="20"');
    expect(changes).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Ritaglio.");
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
  });

  /// Il ritaglio aperto con il lato destro tirato a 30, sull'immagine scelta.
  const cropping = (source = DRAWING): void => {
    mount(source, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [40, 20]]);
    expect(status()).toBe("Si vede 30 × 20 di 40 × 20.");
  };

  it("Ctrl+D con un ritaglio aperto lo applica prima: due passi, il ritaglio e la duplicazione", () => {
    cropping();
    const before = DRAWING;
    key("d", { ctrlKey: true });
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    expect(editor.engine.text.match(/<image /g)).toHaveLength(2);
    // La copia è dell'immagine com'è dopo il ritaglio.
    expect(editor.engine.text.match(/clip-path="url\(#/g)).toHaveLength(2);
    // Ognuna col suo ritaglio.
    expect(editor.engine.text.match(/<clipPath /g)).toHaveLength(2);
    expect(editor.selection).toHaveLength(1);
    expect(editor.selection[0]).not.toBe(IMAGE);
    editor.undo();
    expect(spoken()).toBe("Annullato: Duplicazione.");
    expect(editor.engine.text.match(/<image /g)).toHaveLength(1);
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
    editor.undo();
    expect(spoken()).toBe("Annullato: Ritaglio.");
    expect(editor.engine.text).toBe(before);
  });

  it("Canc con un ritaglio aperto lo applica prima, e poi toglie l'immagine", () => {
    cropping();
    key("Delete");
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    expect(editor.engine.text).not.toContain("<image");
    editor.undo();
    expect(spoken()).toBe("Annullato: Eliminazione.");
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
    editor.undo();
    expect(spoken()).toBe("Annullato: Ritaglio.");
    expect(editor.engine.text).toBe(DRAWING);
  });

  it("tagliare e incollare con un ritaglio aperto lo applicano prima, e poi tagliano o incollano", async () => {
    cropping();
    const clipboard = (type: "cut" | "paste", data = new DataTransfer()): DataTransfer => {
      surface().dispatchEvent(new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data }));
      return data;
    };
    const cut = clipboard("cut");
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    expect(editor.engine.text).not.toContain("<image");
    // Ciò che si è tagliato è l'immagine già ritagliata.
    expect(cut.getData("text/plain")).toContain("clip-path");
    editor.undo();
    expect(spoken()).toBe("Annullato: Taglio.");
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
    // Incollare, con un altro ritaglio aperto.
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[40, 20], [36, 20], [30, 20]]);
    const data = new DataTransfer();
    data.setData("text/plain", cut.getData("text/plain"));
    clipboard("paste", data);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bar().hidden).toBe(true);
    expect(written()).toBe('10 10 x="10" y="10" width="20" height="20"');
    expect(editor.engine.text.match(/<image /g)).toHaveLength(2);
  });

  it("un valore scritto nel pannello delle proprietà applica prima il ritaglio aperto", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    key("Enter");
    expect(propertyInput("x").value).toBe("10");
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [40, 20]]);
    enter(propertyInput("x"), "15");
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    // L'immagine è ritagliata, e poi spostata di 5.
    expect(editor.engine.text).toMatch(/<image id="img" [^>]*clip-path="url\(#[^)]+\)" transform="matrix\(1 0 0 1 5 0\)"/);
    expect(editor.engine.text).toContain('<rect x="10" y="10" width="30" height="20"/>');
    editor.undo();
    expect(editor.engine.text).not.toContain("matrix(1 0 0 1 5 0)");
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
    editor.undo();
    expect(editor.engine.text).toBe(DRAWING);
  });

  it("un'immagine senza id, ritagliata da un comando, resta la scelta di quel comando", () => {
    const loose = doc(`${LAYER}<image x="10" y="10" width="40" height="20" href="${PNG_HREF}"/><rect id="r" x="60" y="60" width="20" height="20"/></g>`);
    mount(loose, { level: "standard" });
    editor.setTool("select");
    twice(30, 20);
    expect(bar().hidden).toBe(false);
    drag([[50, 20], [46, 20], [40, 20]]);
    key("d", { ctrlKey: true });
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    expect(editor.engine.text.match(/<image /g)).toHaveLength(2);
    expect(editor.selection).toHaveLength(1);
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(loose);
  });

  it("annulla con un ritaglio aperto lo chiude come Esc e non annulla altro; ripeti lo chiude e poi ripete", () => {
    mount(DRAWING, { level: "standard" });
    editor.select(["r"]);
    key("d", { ctrlKey: true });
    const duplicated = editor.engine.text;
    expect(changes).toHaveLength(1);
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [40, 20]]);
    key("z", { ctrlKey: true });
    expect(bar().hidden).toBe(true);
    expect(spoken()).toBe("Ritaglio annullato.");
    expect(editor.engine.text).toBe(duplicated);
    expect(changes).toHaveLength(1);
    // Il passo prima è ancora lì, e si annulla col secondo annulla.
    editor.undo();
    expect(spoken()).toBe("Annullato: Duplicazione.");
    expect(editor.engine.text).toBe(DRAWING);
    // Ripetere con il ritaglio aperto lo chiude, e poi ripete.
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [40, 20]]);
    editor.redo();
    expect(bar().hidden).toBe(true);
    expect(spoken()).toBe("Ripetuto: Duplicazione.");
    expect(editor.engine.text).toBe(duplicated);
    expect(written()).toBe("10 10");
  });

  /// Un segno preso con il mouse e tirato fin dove si dice, senza lasciarlo.
  const grab = (from: readonly [number, number], to: readonly [number, number], init: Init = {}): void => {
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: from[0], clientY: from[1], timeStamp: (clock += 8), ...init }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: to[0], clientY: to[1], timeStamp: (clock += 8), ...init }));
  };
  const release = (at: readonly [number, number], init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: at[0], clientY: at[1], timeStamp: (clock += 8), ...init }));
  };
  const modifier = (name: string, down: boolean, init: KeyboardEventInit = {}): void => {
    surface().dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name, bubbles: true, cancelable: true, ...init }));
  };

  it("Maiusc premuto a metà del segno, senza muovere il puntatore, rifà subito il ritaglio; lasciandolo, torna libero", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    grab([50, 30], [40, 26]);
    expect(status()).toBe("Si vede 30 × 16 di 40 × 20.");
    modifier("Shift", true, { shiftKey: true });
    // Nelle proporzioni di 40 × 20.
    expect(status()).toBe("Si vede 32 × 16 di 40 × 20.");
    expect(names().map((name) => side(name).value)).toEqual(["0", "8", "4", "0"]);
    modifier("Shift", false);
    expect(status()).toBe("Si vede 30 × 16 di 40 × 20.");
    modifier("Shift", true, { shiftKey: true });
    // Il puntatore si alza con Maiusc premuto, senza muoversi: vale il ritaglio con le proporzioni.
    release([40, 26], { shiftKey: true });
    expect(spoken()).toBe("Si vede 32 × 16 di 40 × 20.");
    expect(side("A destra").value).toBe("8");
    action("Applica").click();
    expect(written()).toBe('10 10 x="10" y="10" width="32" height="16"');
  });

  it("Maiusc lasciato prima del puntatore: al rilascio il ritaglio è quello senza proporzioni", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    grab([50, 30], [40, 26], { shiftKey: true });
    expect(status()).toBe("Si vede 32 × 16 di 40 × 20.");
    // Il tasto si lascia fuori dal foglio, e il puntatore si alza senza Maiusc.
    release([40, 26], { shiftKey: false });
    expect(spoken()).toBe("Si vede 30 × 16 di 40 × 20.");
    expect([side("A destra").value, side("In basso").value]).toEqual(["10", "4"]);
  });

  it("Alt premuto e lasciato a metà del segno tiene il ritaglio attorno al centro, o no", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    grab([50, 20], [45, 20]);
    expect(names().map((name) => side(name).value)).toEqual(["0", "5", "0", "0"]);
    modifier("Alt", true, { altKey: true });
    expect(names().map((name) => side(name).value)).toEqual(["0", "5", "0", "5"]);
    expect(status()).toBe("Si vede 30 × 20 di 40 × 20.");
    modifier("Alt", false);
    expect(names().map((name) => side(name).value)).toEqual(["0", "5", "0", "0"]);
    modifier("Alt", true, { altKey: true });
    release([45, 20], { altKey: true });
    expect(spoken()).toBe("Si vede 30 × 20 di 40 × 20.");
    expect(names().map((name) => side(name).value)).toEqual(["0", "5", "0", "5"]);
  });

  it("un margine vuoto o illeggibile non cambia niente, e lasciando il campo si riscrive com'è", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    typeIn(side("A destra"), "10");
    expect(status()).toBe("Si vede 30 × 20 di 40 × 20.");
    // Il campo svuotato, o con ciò che un campo numerico non legge, non porta il margine al bordo.
    for (const text of ["", "abc"]) {
      typeIn(side("A destra"), text);
      expect(status()).toBe("Scrivi un valore.");
      expect(painted().style.visibility).toBe("hidden");
      side("A destra").dispatchEvent(new Event("change", { bubbles: true }));
      expect(side("A destra").value).toBe("10");
      expect(status()).toBe("Si vede 30 × 20 di 40 × 20.");
    }
    // Invio con il campo vuoto applica l'ultimo ritaglio che si vedeva.
    typeIn(side("A destra"), "");
    key("Enter", {}, side("A destra"));
    expect(written()).toBe('10 10 x="10" y="10" width="30" height="20"');
  });

  it("i margini si leggono come i campi di «Trasforma»: la virgola dei decimali, lo zero negativo, il segno meno", () => {
    mount(DRAWING, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    typeIn(side("A sinistra"), "2,5");
    expect(status()).toBe("Si vede 37,5 × 20 di 40 × 20.");
    typeIn(side("A sinistra"), "2.5");
    expect(status()).toBe("Si vede 37,5 × 20 di 40 × 20.");
    typeIn(side("In alto"), "-0");
    expect(status()).toBe("Si vede 37,5 × 20 di 40 × 20.");
    side("In alto").dispatchEvent(new Event("change", { bubbles: true }));
    expect(side("In alto").value).toBe("0");
    // Un margine non è sotto lo zero.
    typeIn(side("A sinistra"), "-4");
    expect(status()).toBe("Si vede l’immagine intera.");
    side("A sinistra").dispatchEvent(new Event("change", { bubbles: true }));
    expect(side("A sinistra").value).toBe("0");
    typeIn(side("In basso"), "2+3");
    expect(status()).toBe("Si vede 40 × 15 di 40 × 20.");
    typeIn(side("In basso"), "1,5e1");
    expect(status()).toBe("Si vede 40 × 5 di 40 × 20.");
  });

  it("un tocco fuori con Maiusc applica il ritaglio e aggiunge ciò che tocca; sul vuoto lascia la scelta", () => {
    cropping();
    drag([[40, 80]], { shiftKey: true });
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(1);
    expect(editor.selection).toEqual([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[40, 20], [36, 20], [30, 20]]);
    drag([[70, 70]], { shiftKey: true });
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(2);
    expect(editor.selection).toEqual([IMAGE, "r"]);
  });

  it("un tocco fuori con Ctrl sceglie dentro i gruppi, dopo aver applicato il ritaglio", () => {
    const grouped = doc(`${LAYER}<image id="${IMAGE}" x="10" y="10" width="40" height="20" href="${PNG_HREF}"/><g id="grp"><rect id="in" x="60" y="60" width="20" height="20"/></g></g>`);
    mount(grouped, { level: "standard" });
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[50, 20], [46, 20], [40, 20]]);
    drag([[70, 70]], { ctrlKey: true });
    expect(bar().hidden).toBe(true);
    expect(changes).toHaveLength(1);
    expect(editor.selection).toEqual(["in"]);
    editor.select([IMAGE]);
    cropButton().click();
    surface().focus();
    drag([[40, 20], [36, 20], [30, 20]]);
    drag([[70, 70]]);
    expect(editor.selection).toEqual(["grp"]);
  });

  it("«Togli il ritaglio» rende intere le immagini scelte, in un passo", () => {
    mount(CROPPED, { level: "standard" });
    const before = editor.engine.text;
    editor.select([IMAGE, "r"]);
    uncropButton().click();
    expect(spoken()).toBe("1 immagine di nuovo intera.");
    expect(written()).toBe("10 10");
    expect(editor.engine.text).not.toContain("clipPath");
    expect(editor.selection).toEqual([IMAGE, "r"]);
    editor.undo();
    expect(editor.engine.text).toBe(before);
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

  it("c'è dallo Standard, nella barra «Disponi», col nome, il valore e i limiti; sotto lo Standard e senza selezione no", () => {
    mount(SHEET, { level: "standard" });
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
    editor.setLevel("essential");
    editor.select([A]);
    expect(opacityLabel().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("un valore scritto e Invio cambiano l'opacità in un passo, «Opacità», che si annulla e si ripete", () => {
    mount(SHEET, { level: "standard" });
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
    mount(SHEET, { level: "standard" });
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
    mount(SHEET, { level: "standard" });
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
    mount(SHEET, { level: "standard" });
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
    mount(SHEET, { level: "standard" });
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
    mount(SHEET, { level: "standard" });
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
    mount(SHEET, { level: "standard" });
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
    mount(SHEET.replace(' fub:version="1"', ""), { level: "standard" });
    editor.select([A]);
    expect(arrangeBar().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  // --- La fusione nel pannello ----------------------------------------------

  const panelButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!;

  it("«Fusione» non c'è più a nessun livello (ADR 0231)", () => {
    for (const level of ["standard", "expert"] as const) {
      mount(SHEET, { level });
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

  it("lo stile copiato porta la fusione e gli effetti, dallo Standard, e incollarli è un passo solo", () => {
    mount(LOOKS, { level: "standard" });
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

  it("il contagocce dà anche la fusione e gli effetti della forma sotto il puntatore", () => {
    mount(LOOKS, { level: "standard" });
    size(400, 300);
    editor.select([A]);
    editor.setTool("eyedropper");
    drag([[250, 150], [250, 150]]);
    expect(style(A)).toBe("mix-blend-mode: multiply");
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${A}"[^>]* fub:effect="shadow 0 4 8 #000000 0\\.25"`));
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(LOOKS);
  });

  /// Un rettangolo con l'ombra, e un gruppo spostato di 100 con un altro dentro.
  const SHADOWED = doc(
    `${filterFor("rf1f1f1f1", 10, 10, 20)}${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2" ${FX}/>`
      + `<g id="${G}" transform="translate(100 0)"><rect id="oc1c1c1c1" x="10" y="10" width="20" height="20" fill="#009e73" ${FX}/></g></g>`,
  );

  it("l'export della selezione conta l'ombra: quella di un oggetto, e quella di ciò che un gruppo porta, spostata come lui", () => {
    mount(SHADOWED, { level: "standard" });
    editor.select([A]);
    // L'ombra arriva 12 a sinistra e a destra, 8 sopra e 16 sotto.
    expect(editor.exportScene().scene.selection!.box).toEqual([-2, 2, 44, 44]);
    editor.select([G]);
    expect(editor.exportScene().scene.selection!.box).toEqual([98, 2, 44, 44]);
    editor.select([A, G]);
    expect(editor.exportScene().scene.selection!.box).toEqual([-2, 2, 144, 44]);
    // Senza effetti, il riquadro è quello della forma.
    editor.dispose();
    mount(doc(`${LAYER}<rect id="${A}" x="10" y="10" width="20" height="20" fill="#0072b2"/></g>`), { level: "standard" });
    editor.select([A]);
    expect(editor.exportScene().scene.selection!.box).toEqual([10, 10, 20, 20]);
  });

  it("«Adatta la pagina al disegno» comprende l'ombra, con il suo margine, in un passo che si annulla", () => {
    mount(SHADOWED, { level: "standard" });
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

describe("la verifica propone le campiture", () => {
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Accessibilità"]')!;
  const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-access")!;
  const rows = (): HTMLElement[] => [...panel().querySelectorAll<HTMLElement>(".draw-access-problem")];
  /// I colori confusi di ogni riga, dall'alto: il suo e quello accanto.
  const confused = (): string[] => rows().map((row) => [...row.querySelectorAll<HTMLElement>(".draw-access-swatch")].map((chip) => chip.style.background).join(" "));
  const fixes = (): HTMLButtonElement[] => rows().map((row) => row.querySelector<HTMLButtonElement>('[data-action="fix"]')!);

  const rect = (id: string, x: number, fill: string): string => `<rect id="${id}" x="${x}" y="0" width="20" height="20" fill="${fill}"/>`;
  const BLUE = "#a6cee3";
  const GREEN = "#b2df8a";
  const YELLOW = "#f0e442";
  /// Due coppie di quadrati, azzurro e verde chiaro, ciascun colore su due
  /// aree: si distinguono soltanto per la tinta.
  const CODE = doc(
    `<title>Prova</title>${LAYER}${rect("oa1a1a1a1", 0, BLUE)}${rect("ob2b2b2b2", 30, GREEN)}${rect("oc3c3c3c3", 60, BLUE)}${rect("od4d4d4d4", 90, GREEN)}</g>`,
  );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("«Dai una campitura» dà una campitura a tutte le aree del colore, in un passo; le righe se ne vanno e un annulla riporta il file", () => {
    mount(CODE, { level: "standard" });
    button().click();
    expect(rows().map((row) => row.querySelector(".draw-access-what")!.textContent)).toEqual([
      "Nota: Due colori si distinguono solo per la tinta",
      "Nota: Due colori si distinguono solo per la tinta",
    ]);
    expect(confused()).toEqual([`${BLUE} ${GREEN}`, `${GREEN} ${BLUE}`]);
    expect(rows()[0]!.querySelector(".draw-access-detail")!.textContent).toContain("hanno un contrasto di 1,1:1, ne servono almeno 3:1");
    expect(fixes().map((fix) => [fix.textContent, fix.getAttribute("aria-label")])).toEqual([
      ["Dai una campitura", `Dai una campitura alle 2 aree di colore ${BLUE}`],
      ["Dai una campitura", `Dai una campitura alle 2 aree di colore ${GREEN}`],
    ]);
    expect(formatIssues(checkAccessibility(host))).toBe("");

    fixes()[0]!.click();
    // Un passo solo, con il suo nome.
    expect(changes).toHaveLength(1);
    expect(spoken()).toBe("Campitura diagonale su 2 aree.");
    const text = editor.engine.text;
    // Le due aree azzurre hanno una campitura sul loro colore, righe nere;
    // le verdi no.
    expect(text.match(/<pattern [^>]*fub:pattern="lines -45 [\d.]+ [\d.]+ #000000 #a6cee3"/g)).toHaveLength(2);
    expect([...text.matchAll(/<rect id="(o[^"]+)"[^>]* fill="([^"]+)"\/>/g)].map((found) => [found[1], found[2]!.startsWith("url(#r") ? "campitura" : found[2]])).toEqual([
      ["oa1a1a1a1", "campitura"],
      ["ob2b2b2b2", GREEN],
      ["oc3c3c3c3", "campitura"],
      ["od4d4d4d4", GREEN],
    ]);
    // L'azzurro non è più un colore di codice: il verde non ha più chi lo
    // confonda, e le due righe se ne vanno insieme.
    expect(rows()).toHaveLength(0);
    expect(panel().querySelector(".draw-access-count")!.textContent).toBe("nessun problema");

    key("z", { ctrlKey: true });
    expect(spoken()).toBe("Annullato: Dai una campitura.");
    expect(editor.engine.text).toBe(CODE);
    vi.advanceTimersByTime(250);
    expect(rows()).toHaveLength(2);
  });

  it("un colore dopo l'altro: ogni campitura è diversa dalle già date", () => {
    const CODES = doc(
      `<title>Prova</title>${LAYER}${rect("oa1a1a1a1", 0, BLUE)}${rect("ob2b2b2b2", 30, GREEN)}${rect("oc3c3c3c3", 60, YELLOW)}` +
        `${rect("od4d4d4d4", 90, BLUE)}${rect("oe5e5e5e5", 120, GREEN)}${rect("of6f6f6f6", 150, YELLOW)}</g>`,
    );
    mount(CODES, { level: "standard" });
    button().click();
    expect(confused()).toEqual([`${BLUE} ${GREEN}`, `${GREEN} ${BLUE}`, `${YELLOW} ${GREEN}`]);
    fixes()[0]!.click();
    expect(spoken()).toBe("Campitura diagonale su 2 aree.");
    // Il verde e il giallo restano confusi fra loro.
    expect(confused()).toEqual([`${GREEN} ${YELLOW}`, `${YELLOW} ${GREEN}`]);
    fixes()[0]!.click();
    expect(spoken()).toBe("Campitura puntinata su 2 aree.");
    expect(rows()).toHaveLength(0);
    expect(changes).toHaveLength(2);
    key("z", { ctrlKey: true });
    expect(spoken()).toBe("Annullato: Dai una campitura.");
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(CODES);
  });

  it("un'area che non si sceglie resta com'è: la campitura va alle altre", () => {
    const LOCKED = doc(
      `<title>Prova</title>${LAYER}${rect("oa1a1a1a1", 0, BLUE)}${rect("ob2b2b2b2", 30, GREEN)}${rect("od4d4d4d4", 90, GREEN)}</g>` +
        `<g id="l2" fub:layer="Bloccato" fub:locked="true">${rect("oc3c3c3c3", 60, BLUE)}</g>`,
    );
    mount(LOCKED, { level: "standard" });
    button().click();
    expect(confused()).toEqual([`${BLUE} ${GREEN}`, `${GREEN} ${BLUE}`]);
    fixes()[0]!.click();
    expect(spoken()).toBe("Campitura diagonale su un’area.");
    expect(editor.engine.text).toContain(`<rect id="oc3c3c3c3" x="60" y="0" width="20" height="20" fill="${BLUE}"/>`);
    expect(editor.engine.text).not.toContain(`<rect id="oa1a1a1a1" x="0" y="0" width="20" height="20" fill="${BLUE}"/>`);
    // Un solo azzurro resta fra le aree: non fa più un codice.
    expect(rows()).toHaveLength(0);
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(LOCKED);
  });

  it("in sola lettura la campitura non si propone", () => {
    mount(CODE, { level: "standard" });
    button().click();
    editor.setReadOnly(true);
    expect(rows()).toHaveLength(2);
    expect(rows().map((row) => row.querySelector('[data-action="fix"]'))).toEqual([null, null]);
    expect(changes).toEqual([]);
  });
});

describe("la campitura", () => {
  const BLUE = doc(`${LAYER}<rect id="r" x="20" y="20" width="40" height="30" fill="#0072b2"/></g>`);
  /// Due rettangoli e un gruppo con una parte bloccata.
  const PARTS = doc(
    `${LAYER}<rect id="r" x="20" y="20" width="40" height="30" fill="#0072b2"/>`
      + `<rect id="s" x="80" y="20" width="40" height="30" fill="#d55e00"/>`
      + `<g id="og" fill="#009e73"><rect id="oa" x="20" y="80" width="40" height="30"/>`
      + `<rect id="ob" x="80" y="80" width="40" height="30" fill="#cc79a7" fub:locked="true"/></g>`
      + `<line id="l" x1="0" y1="150" x2="100" y2="150" stroke="#000000" stroke-width="2"/></g>`,
  );

  const openProperties = (): void => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
  const section = (): HTMLElement => properties().querySelector<HTMLElement>('.draw-properties-section[data-section="hatch"]')!;
  const kindButton = (): HTMLButtonElement => section().querySelector<HTMLButtonElement>(".draw-properties-menu")!;
  const hatchField = (id: string): HTMLInputElement => section().querySelector<HTMLInputElement>(`.draw-properties-field[data-field="hatch-${id}"] input[type="text"]`)!;
  const fieldsGroup = (): HTMLElement => section().querySelector<HTMLElement>(".draw-hatch-fields")!;
  const visible = (): Array<string | undefined> =>
    [...properties().querySelectorAll<HTMLElement>(".draw-properties-section")].filter((each) => !each.hidden).map((each) => each.dataset.section);
  /// Le voci del menu aperto per ultimo.
  const menuItems = (): HTMLButtonElement[] => {
    const menus = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...menus[menus.length - 1]!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const entry = (label: string): HTMLButtonElement => menuItems().find((each) => labelOf(each) === label)!;
  /// Sceglie dal menu del tipo la voce `label`.
  function choose(label: string): void {
    kindButton().click();
    entry(label).click();
  }
  /// La campitura privata che il testo ha, e quante.
  const patterns = (text = editor.engine.text): string[] => text.match(/<pattern [\s\S]*?<\/pattern>/g) ?? [];
  const patternOf = (id: string, text = editor.engine.text): string | null => new RegExp(`<[a-z]+ id="${id}"[^>]*? fill="url\\(#([^)]+)\\)`).exec(text)?.[1] ?? null;
  const closeMenus = (): void => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  };
  afterEach(closeMenus);

  it("c'è dal livello Standard, dopo «Sfumatura» e prima del contorno; con «Campiture» fuori dal Personalizzato non c'è", () => {
    mount(PARTS, { level: "standard" });
    openProperties();
    expect(section().hidden).toBe(true);
    editor.select(["r"]);
    expect(section().hidden).toBe(false);
    expect(section().querySelector("h3")!.textContent).toBe("Campitura");
    expect(kindButton().textContent).toBe("Nessuna");
    expect(fieldsGroup().hidden).toBe(true);
    expect(visible().indexOf("hatch")).toBe(visible().indexOf("gradient") + 1);
    editor.setLevel("expert");
    expect(visible().slice(visible().indexOf("gradient"), visible().indexOf("gradient") + 3)).toEqual(["gradient", "hatch", "stroke"]);
    // Una linea senza riempimento non ha la sezione.
    editor.select(["l"]);
    expect(section().hidden).toBe(true);
    editor.select([]);
    expect(section().hidden).toBe(true);
    // Nel Personalizzato si vede con la sua parte.
    editor.setLevel("custom", ["rect", "properties"]);
    editor.select(["r"]);
    expect(section().hidden).toBe(true);
    editor.setLevel("custom", ["rect", "properties", "hatches"]);
    editor.select(["r"]);
    expect(section().hidden).toBe(false);
    expect(changes).toEqual([]);
  });

  it("una campitura pronta scrive la campitura privata e il riempimento col ripiego, in un solo passo che annulla al byte", () => {
    mount(BLUE, { level: "standard" });
    openProperties();
    editor.select(["r"]);
    const before = editor.engine.text;
    kindButton().click();
    expect(kindButton().getAttribute("aria-expanded")).toBe("true");
    expect(menuItems().map(labelOf)).toEqual(["Nessuna", "Diagonale", "Incrociata", "Orizzontale", "Puntinata", "Quadrettata"]);
    expect(menuItems().map((each) => each.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false", "false"]);
    entry("Diagonale").click();
    expect(changes).toHaveLength(1);
    const after = editor.engine.text;
    const id = patternOf("r")!;
    expect(id).toMatch(/^r[0-9a-z]{8}$/);
    expect(after).toContain(
      `  <defs id="fub-defs">
    <pattern id="${id}" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 8 1.5 #ffffff #0072b2">
      <rect width="8" height="8" fill="#0072b2"/>
      <rect y="3.25" width="8" height="1.5" fill="#ffffff"/>
    </pattern>
  </defs><g id="l1" fub:layer="Livello 1"><rect id="r" x="20" y="20" width="40" height="30" fill="url(#${id}) #308cc0"/></g></svg>`,
    );
    expect(patterns()).toHaveLength(1);
    expect(editor.selection).toEqual(["r"]);
    expect(spoken()).toContain("Campitura «Diagonale» su 1 oggetto.");
    // Il pannello segue: la scelta, i campi e le loro unità.
    expect(kindButton().textContent).toBe("Diagonale");
    expect(kindButton().getAttribute("aria-expanded")).toBe("false");
    expect(fieldsGroup().hidden).toBe(false);
    expect(["color", "background", "spacing", "width", "angle"].map((name) => hatchField(name).value)).toEqual(["#ffffff", "#0072b2", "8", "1,5", "-45"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un passo solo, col suo nome, e al byte.
    editor.undo();
    expect(editor.engine.text).toBe(before);
    expect(spoken()).toBe("Annullato: Campitura.");
    expect(kindButton().textContent).toBe("Nessuna");
    expect(editor.selection).toEqual(["r"]);
    editor.redo();
    expect(editor.engine.text).toBe(after);
    expect(kindButton().textContent).toBe("Diagonale");
  });

  it("scegliere la campitura che c'è già non scrive niente", () => {
    mount(BLUE, { level: "standard" });
    openProperties();
    editor.select(["r"]);
    choose("Diagonale");
    const count = changes.length;
    const said = spoken();
    choose("Diagonale");
    expect(changes).toHaveLength(count);
    expect(spoken()).toBe(said);
    expect(kindButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("il passo cambia sul posto, con `set`: la campitura è la stessa, e un colpo di freccia dopo l'altro si annulla insieme", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    mount(BLUE, { level: "standard" });
    openProperties();
    editor.select(["r"]);
    choose("Diagonale");
    const first = editor.engine.text;
    const id = patternOf("r")!;
    now.mockReturnValue(MERGE_MS + 1);
    enter(hatchField("spacing"), "12");
    expect(patterns()).toHaveLength(1);
    expect(patternOf("r")).toBe(id);
    expect(editor.engine.text).toContain(`<pattern id="${id}" fub:role="private" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 12 1.5 #ffffff #0072b2">`);
    expect(hatchField("spacing").value).toBe("12");
    const typed = editor.engine.text;
    now.mockReturnValue(2 * MERGE_MS + 2);
    hatchField("spacing").focus();
    key("ArrowUp", {}, hatchField("spacing"));
    key("ArrowUp", {}, hatchField("spacing"));
    expect(editor.engine.text).toContain('fub:pattern="lines -45 14 1.5 #ffffff #0072b2"');
    expect(patterns()).toHaveLength(1);
    expect(document.activeElement).toBe(hatchField("spacing"));
    // I due colpi si annullano insieme; il numero scritto, a parte.
    editor.undo();
    expect(editor.engine.text).toBe(typed);
    expect(spoken()).toBe("Annullato: Passo della campitura.");
    editor.undo();
    expect(editor.engine.text).toBe(first);
    expect(spoken()).toBe("Annullato: Passo della campitura.");
  });

  it("ogni genere di cambio ha il suo nome nella cronologia", () => {
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    mount(BLUE, { level: "standard" });
    openProperties();
    editor.select(["r"]);
    choose("Puntinata");
    const wanted: Array<[() => void, string]> = [
      [() => enter(hatchField("width"), "4"), "Annullato: Diametro dei puntini."],
      [() => enter(hatchField("angle"), "20"), "Annullato: Angolo della campitura."],
      [() => enter(hatchField("color"), "#ffff00"), "Annullato: Colore della campitura."],
      [() => enter(hatchField("background"), "nessuno"), "Annullato: Fondo della campitura."],
    ];
    const texts = [editor.engine.text];
    for (const [change] of wanted) {
      time += 10 * MERGE_MS;
      change();
      texts.push(editor.engine.text);
    }
    for (let at = wanted.length - 1; at >= 0; at -= 1) {
      editor.undo();
      expect(spoken()).toBe(wanted[at]![1]);
      expect(editor.engine.text).toBe(texts[at]);
    }
  });

  it("«Nessuna» torna al colore del fondo, e un annulla riporta la campitura", () => {
    mount(BLUE, { level: "standard" });
    openProperties();
    editor.select(["r"]);
    choose("Incrociata");
    const hatched = editor.engine.text;
    choose("Nessuna");
    expect(patterns()).toEqual([]);
    expect(editor.engine.text).toContain('<rect id="r" x="20" y="20" width="40" height="30" fill="#0072b2"/>');
    expect(spoken()).toContain("Campitura tolta da 1 oggetto.");
    expect(kindButton().textContent).toBe("Nessuna");
    expect(fieldsGroup().hidden).toBe(true);
    editor.undo();
    expect(editor.engine.text).toBe(hatched);
    expect(spoken()).toBe("Annullato: Togli la campitura.");
    expect(kindButton().textContent).toBe("Incrociata");
  });

  it("un gruppo la dà alle sue parti, e una parte bloccata resta com'è", () => {
    mount(PARTS, { level: "standard" });
    openProperties();
    editor.select(["og"]);
    expect(kindButton().textContent).toBe("Nessuna");
    choose("Orizzontale");
    const text = editor.engine.text;
    expect(patterns()).toHaveLength(1);
    expect(text).toMatch(/<rect id="oa" x="20" y="80" width="40" height="30" fill="url\(#r[0-9a-z]{8}\) #[0-9a-f]{6}"\/>/);
    expect(text).toContain('<rect id="ob" x="80" y="80" width="40" height="30" fill="#cc79a7" fub:locked="true"/>');
    expect(text).toContain('<g id="og" fill="#009e73">');
    expect(spoken()).toContain("Campitura «Orizzontale» su 1 oggetto.");
    editor.undo();
    expect(patterns()).toEqual([]);
  });

  it("più oggetti: una scelta li cambia tutti, e i campi non toccano chi non ha una campitura", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    mount(PARTS, { level: "standard" });
    openProperties();
    editor.select(["r", "s"]);
    choose("Diagonale");
    expect(patterns()).toHaveLength(2);
    expect(spoken()).toContain("Campitura «Diagonale» su 2 oggetti.");
    expect(kindButton().textContent).toBe("Diagonale");
    enter(hatchField("angle"), "30");
    expect(editor.engine.text.match(/rotate\(30\)/g)).toHaveLength(2);
    const turned = editor.engine.text;
    // Con un oggetto senza campitura i campi cambiano soltanto le altre.
    editor.select(["r", "s", "oa"]);
    expect(kindButton().textContent).toBe("Misto");
    expect(section().querySelector(".draw-hatch > .draw-properties-note")!.textContent).toBe("I campi cambiano la campitura di 2 oggetti: gli altri restano come sono.");
    // Un altro passo, a tempo debito: due passi di seguito si unirebbero.
    now.mockReturnValue(10 * MERGE_MS);
    enter(hatchField("angle"), "10");
    expect(editor.engine.text.match(/rotate\(10\)/g)).toHaveLength(2);
    expect(editor.engine.text).toContain('<rect id="oa" x="20" y="80" width="40" height="30"/>');
    editor.undo();
    expect(editor.engine.text).toBe(turned);
  });

  it("in sola lettura la campitura si guarda e basta", () => {
    mount(BLUE, { level: "standard" });
    openProperties();
    editor.select(["r"]);
    choose("Diagonale");
    const shown = editor.engine.text;
    const count = changes.length;
    editor.setReadOnly(true);
    expect(kindButton().getAttribute("aria-disabled")).toBe("true");
    expect(hatchField("spacing").readOnly).toBe(true);
    kindButton().click();
    expect(spoken()).toContain("sola lettura");
    expect(kindButton().getAttribute("aria-expanded")).toBe("false");
    key("ArrowUp", {}, hatchField("spacing"));
    expect(editor.engine.text).toBe(shown);
    expect(changes).toHaveLength(count);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

});

describe("il Connettore, dal livello Standard", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  const G = "og4g4g4g4";
  const I = "oi5i5i5i5";
  const J = "oj6j6j6j6";
  const rect = (id: string, name: string, x: number, y: number, width: number, height: number, fill: string): string =>
    `<rect id="${id}" x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"><title>${name}</title></rect>`;
  /// Tre rettangoli, Alfa in alto a sinistra, Beta alla sua destra e Gamma
  /// sotto, e in basso a destra un gruppo di due.
  const SHAPES = doc(
    `<title>Prova</title>${LAYER}${rect(A, "Alfa", 40, 60, 60, 40, "#e69f00")}${rect(B, "Beta", 240, 60, 60, 40, "#009e73")}${rect(C, "Gamma", 140, 200, 60, 40, "#56b4e9")}` +
      `<g id="${G}"><title>Coppia</title>${rect(I, "Dentro", 290, 200, 40, 40, "#d55e00")}${rect(J, "Fuori", 340, 200, 40, 40, "#cc79a7")}</g></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 300"');

  // Per i test che guardano i marcatori nel disegno.
  const scene = (): never => ({ engine: editor.engine }) as never;
  /// L'elemento `id`, com'è scritto nel testo del disegno.
  const tag = (id: string): string => new RegExp(`<[a-zA-Z]+ id="${id}"[^>]*>`).exec(editor.engine.text)![0];
  const attr = (id: string, name: string): string | null => new RegExp(` ${name}="([^"]*)"`).exec(tag(id))?.[1] ?? null;
  /// Gli id dei connettori del disegno, in ordine di documento.
  const lines = (): string[] => [...editor.engine.text.matchAll(/<path id="([^"]+)" [^>]*fub:shape="connector"/g)].map((match) => match[1]!);
  const numbers = (geom: string): number[] => geom.split(" ").slice(1).map(Number);
  const pointsOf = (id: string): Array<[number, number]> => {
    const all = numbers(attr(id, "fub:geom")!);
    return Array.from({ length: all.length / 2 }, (_, i) => [all[2 * i]!, all[2 * i + 1]!]);
  };
  /// Il `d` che la geometria `fub:geom` di `id` detta: i punti in fila, o
  /// la curva.
  const dictated = (id: string): string => {
    const geom = attr(id, "fub:geom")!;
    const points = pointsOf(id).map(([x, y]) => `${x} ${y}`);
    return geom.startsWith("curved") ? `M${points[0]} C${points.slice(1).join(" ")}` : `M${points[0]} ${points.slice(1).map((each) => `L${each}`).join(" ")}`;
  };
  /// Un trascinamento col Connettore in mano, da `from` a `to` passando a
  /// metà.
  const link = (from: readonly [number, number], to: readonly [number, number], init: Init = {}): void =>
    drag([from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to], init);
  /// Un tocco, lontano nel tempo dal precedente.
  const tap = (x: number, y: number, init: Init = {}): void => {
    clock += 1000;
    drag([[x, y]], init);
  };
  const toolButton = () => railTool("Connettore");
  const connecting = (source = SHAPES, options: DrawEditorOptions = {}): void => {
    mount(source, { level: "standard", ...options });
    key("x");
  };

  it("c'è dal livello Standard, col tasto X dopo la freccia; all'Essenziale no, e chi lo aveva in mano riprende la penna", () => {
    mount(SHAPES);
    expect(toolButton().hidden).toBe(true);
    expect(key("x").defaultPrevented).toBe(false);
    expect(editor.tool).toBe("pen");
    editor.setLevel("standard");
    expect(toolButton().hidden).toBe(false);
    expect(toolButton().title).toBe("Connettore (X)");
    const tools = railNames();
    expect(tools.slice(tools.indexOf("Freccia"))).toEqual(["Freccia", "Connettore", "Testo", "Contagocce", "Sfumatura"]);
    key("x");
    expect(editor.tool).toBe("connector");
    expect(spoken()).toBe("Strumento: Connettore.");
    expect(toolButton().checked).toBe(true);
    editor.setLevel("essential");
    expect(toolButton().hidden).toBe(true);
    expect(editor.tool).toBe("pen");
    expect(changes).toEqual([]);
  });

  it("un trascinamento da un oggetto a un altro scrive un connettore a gomito, agganciato a tutti e due, in un passo che si annulla", () => {
    connecting();
    // Lontano dai punti d'aggancio, il lato lo sceglie FubDraw.
    link([60, 90], [155, 225]);
    const [id] = lines();
    expect(lines()).toHaveLength(1);
    expect(attr(id!, "fub:from")).toBe(`${A} auto`);
    expect(attr(id!, "fub:to")).toBe(`${C} auto`);
    expect(attr(id!, "fub:geom")).toMatch(/^elbow /);
    // Un gomito ha almeno una svolta, parte da un lato di Alfa e arriva a uno di Gamma.
    const points = pointsOf(id!);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect([[70, 60], [100, 80], [70, 100], [40, 80]]).toContainEqual(points[0]);
    expect([[170, 200], [200, 220], [170, 240], [140, 220]]).toContainEqual(points[points.length - 1]);
    expect(attr(id!, "d")).toBe(dictated(id!));
    expect(attr(id!, "fill")).toBe("none");
    expect(attr(id!, "stroke")).toBe("#000000");
    // La punta è un triangolo medio alla fine, e il capo d'inizio non ne ha.
    expect(attr(id!, "marker-start")).toBeNull();
    expect(tipOf(scene(), id!, "end")).toBe("triangle medium end #000000");
    expect(markersIn(scene())).toHaveLength(1);
    // Resta scelto, e lo strumento è ancora il Connettore.
    expect(editor.selection).toEqual([id]);
    expect(editor.tool).toBe("connector");
    expect(spoken()).toBe("Connettore aggiunto da Rettangolo «Alfa» a Rettangolo «Gamma». Il disegno ha 5 oggetti.");
    expect(changes).toHaveLength(1);
    const written = editor.engine.text;
    editor.undo();
    expect(spoken()).toBe("Annullato: Connettore.");
    expect(editor.engine.text).toBe(SHAPES);
    editor.redo();
    expect(spoken()).toBe("Ripetuto: Connettore.");
    expect(editor.engine.text).toBe(written);
  });

  /// Un gesto del puntatore che passa per `steps`: il primo preme, l'ultimo
  /// alza, ognuno coi suoi modificatori.
  const sweep = (steps: ReadonlyArray<readonly [number, number, Init?]>): void => {
    const last = steps.length - 1;
    steps.forEach(([x, y, init], at) => {
      const type = at === 0 ? "pointerdown" : at === last ? "pointerup" : "pointermove";
      surface().dispatchEvent(
        pointer(type, { ...MOUSE, button: at === 0 || at === last ? 0 : -1, buttons: at === last ? 0 : 1, pressure: at === last ? 0 : 0.5, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }),
      );
    });
  };
  /// Il puntatore passa sopra `x`, `y` senza premere.
  const hover = (x: number, y: number, init: Init = {}): void =>
    void surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  const edges = (box: readonly [number, number, number, number]): string[] => {
    const [x1, y1, x2, y2] = box;
    return [`${x1},${y1}`, `${x2},${y1}`, `${x2},${y2}`, `${x1},${y2}`];
  };

  describe("sopra un oggetto", () => {
    let layer: ReturnType<typeof recording>;
    beforeEach(() => {
      layer = recording();
    });
    /// I cerchi dell'ultimo disegno, dove stanno e quanto sono larghi: da 3,5
    /// i punti d'aggancio, da 4,5 quello che il capo prenderebbe.
    const circles = (): string[] =>
      layer
        .calls()
        .filter(([name]) => name === "arc")
        .map(([, x, y, radius]) => `${x},${y} r${radius}`)
        .sort();
    /// Gli angoli da cui parte un tratto del contorno, dell'ultimo disegno.
    const outlined = (): string[] =>
      layer
        .calls()
        .filter(([name]) => name === "moveTo")
        .map(([, x, y]) => `${x},${y}`)
        .sort();
    const over = (x: number, y: number, init: Init = {}): void => {
      hover(x, y, init);
      layer.frame();
    };

    it("il Connettore mostra il contorno e i cinque punti d'aggancio, e il punto vicino al puntatore pieno", () => {
      connecting();
      over(200, 140);
      expect(circles()).toEqual([]);
      expect(outlined()).toEqual([]);
      over(60, 90);
      expect(circles()).toEqual(["100,80 r3.5", "40,80 r3.5", "70,100 r3.5", "70,60 r3.5", "70,80 r3.5"]);
      expect(outlined()).toEqual(edges([40, 60, 100, 100]).sort());
      // Vicino al punto di destra, è quello che il capo prenderebbe.
      over(97, 83);
      expect(circles()).toEqual(["100,80 r4.5", "40,80 r3.5", "70,100 r3.5", "70,60 r3.5", "70,80 r3.5"]);
      over(200, 140);
      expect(circles()).toEqual([]);
      // Gli altri strumenti non li mostrano.
      editor.setTool("select");
      over(60, 90);
      expect(circles()).toEqual([]);
    });

    it("un gruppo mostra i suoi punti, e con Ctrl o ⌘ quelli dell'oggetto dentro", () => {
      connecting();
      over(300, 230);
      expect(circles()).toEqual(["290,220 r3.5", "335,200 r3.5", "335,220 r3.5", "335,240 r3.5", "380,220 r3.5"]);
      over(300, 230, { ctrlKey: true });
      expect(circles()).toEqual(["290,220 r3.5", "310,200 r3.5", "310,220 r3.5", "310,240 r3.5", "330,220 r3.5"]);
    });

    it("uscendo dal foglio o cambiando strumento i punti spariscono, e scegliendo il Connettore sopra un oggetto si vedono subito", () => {
      connecting();
      over(60, 90);
      expect(circles()).toHaveLength(5);
      surface().dispatchEvent(new Event("pointerleave"));
      layer.frame();
      expect(circles()).toEqual([]);
      over(60, 90);
      expect(circles()).toHaveLength(5);
      editor.setTool("rect");
      layer.frame();
      expect(circles()).toEqual([]);
      editor.setTool("connector");
      layer.frame();
      expect(circles()).toHaveLength(5);
    });

    it("tirando un connettore si vedono i punti dell'oggetto da cui parte e di quello che si tocca", () => {
      connecting();
      const target = surface();
      target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 60, clientY: 90, timeStamp: (clock += 8) }));
      target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 150, clientY: 90, timeStamp: (clock += 8) }));
      target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 242, clientY: 82, timeStamp: (clock += 8) }));
      layer.frame();
      // Alfa da cui parte, con l'aggancio automatico: nessun punto pieno. Beta,
      // dove il capo si aggancerebbe a sinistra.
      expect(circles()).toEqual(
        ["100,80 r3.5", "40,80 r3.5", "70,100 r3.5", "70,60 r3.5", "70,80 r3.5", "240,80 r4.5", "270,100 r3.5", "270,60 r3.5", "270,80 r3.5", "300,80 r3.5"].sort(),
      );
      target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 242, clientY: 82, timeStamp: (clock += 8) }));
    });
  });

  it("il capo preso vicino a un punto d'aggancio si aggancia lì, altrove sceglie FubDraw", () => {
    connecting();
    link([97, 83], [243, 78]);
    expect(attr(lines()[0]!, "fub:from")).toBe(`${A} right`);
    expect(attr(lines()[0]!, "fub:to")).toBe(`${B} left`);
    // Fra due punti che stanno allo stesso livello il gomito è un tratto solo.
    expect(attr(lines()[0]!, "fub:geom")).toBe("elbow 100 80 240 80");
    expect(attr(lines()[0]!, "d")).toBe("M100 80 L240 80");
    // A 9 pixel dal punto di sinistra di Alfa si aggancia ancora; a 11 no.
    // (Il connettore nuovo resta scelto, e i suoi capi si prendono: si lascia.)
    editor.select([]);
    link([49, 80], [160, 215]);
    expect(attr(lines()[1]!, "fub:from")).toBe(`${A} left`);
    editor.select([]);
    link([51, 80], [160, 215]);
    expect(attr(lines()[2]!, "fub:from")).toBe(`${A} auto`);
    expect(attr(lines()[2]!, "fub:to")).toBe(`${C} auto`);
  });

  it("la soglia dell'aggancio è la stessa sullo schermo a qualunque zoom", () => {
    connecting();
    size(400, 300);
    key("+");
    key("+");
    // Al 156 % la scena sta attorno al centro del foglio: il punto sinistro
    // di Alfa, in 40, 80, è a -50, 40,6 sullo schermo.
    const onScreen = (x: number, y: number): [number, number] => [200 + (x - 200) * 1.5625, 150 + (y - 150) * 1.5625];
    const to = onScreen(160, 215);
    link([-41, 40.625], to);
    expect(attr(lines()[0]!, "fub:from")).toBe(`${A} left`);
    editor.select([]);
    // A 11 pixel, che sulla scena sono 7 unità, no: il limite è di pixel.
    link([-39, 40.625], to);
    expect(attr(lines()[1]!, "fub:from")).toBe(`${A} auto`);
  });

  it("con Ctrl o ⌘ il capo si aggancia all'oggetto dentro un gruppo, senza al gruppo", () => {
    connecting();
    link([300, 230], [60, 90]);
    expect(attr(lines()[0]!, "fub:from")).toBe(`${G} auto`);
    editor.select([]);
    link([300, 230], [60, 90], { ctrlKey: true });
    expect(attr(lines()[1]!, "fub:from")).toBe(`${I} auto`);
    expect(attr(lines()[1]!, "fub:to")).toBe(`${A} auto`);
  });

  it("un capo non si aggancia all'oggetto dell'altro capo, né a chi lo contiene o vi sta dentro", () => {
    connecting();
    // Da Alfa a un punto di Alfa: l'altro capo resta libero dove cade.
    link([60, 90], [80, 70]);
    expect(attr(lines()[0]!, "fub:from")).toBe(`${A} auto`);
    expect(attr(lines()[0]!, "fub:to")).toBeNull();
    expect(pointsOf(lines()[0]!)[pointsOf(lines()[0]!).length - 1]).toEqual([80, 70]);
    expect(spoken()).toBe("Connettore aggiunto da Rettangolo «Alfa». Il disegno ha 5 oggetti.");
    // Dal gruppo a un oggetto dentro il gruppo.
    editor.select([]);
    sweep([[300, 230], [330, 225], [350, 220, { ctrlKey: true }], [352, 220, { ctrlKey: true }]]);
    expect(attr(lines()[1]!, "fub:from")).toBe(`${G} auto`);
    expect(attr(lines()[1]!, "fub:to")).toBeNull();
    // Da un oggetto dentro il gruppo al gruppo.
    editor.select([]);
    sweep([[300, 230, { ctrlKey: true }], [330, 225, { ctrlKey: true }], [360, 230], [362, 230]]);
    expect(attr(lines()[2]!, "fub:from")).toBe(`${I} auto`);
    expect(attr(lines()[2]!, "fub:to")).toBeNull();
    // Due fratelli, invece, si uniscono.
    editor.select([]);
    link([300, 230], [350, 230], { ctrlKey: true });
    expect(attr(lines()[3]!, "fub:from")).toBe(`${I} auto`);
    expect(attr(lines()[3]!, "fub:to")).toBe(`${J} auto`);
  });

  it("con Ctrl o ⌘ una linea che passa sopra un oggetto in un gruppo non gli toglie l'aggancio", () => {
    connecting();
    // Una linea libera, in verticale, sopra il secondo oggetto del gruppo.
    link([352, 150], [352, 280]);
    expect(lines()).toHaveLength(1);
    editor.select([]);
    link([60, 90], [350, 232], { ctrlKey: true });
    expect(attr(lines()[1]!, "fub:to")).toBe(`${J} auto`);
    // Senza Ctrl, il gruppo.
    editor.select([]);
    link([60, 90], [350, 232]);
    expect(attr(lines()[2]!, "fub:to")).toBe(`${G} auto`);
  });

  it("da un punto vuoto a un altro il connettore è libero, e uno quasi fermo non si scrive", () => {
    connecting();
    link([120, 130], [200, 150]);
    const [id] = lines();
    expect(attr(id!, "fub:from")).toBeNull();
    expect(attr(id!, "fub:to")).toBeNull();
    expect(pointsOf(id!)[0]).toEqual([120, 130]);
    expect(pointsOf(id!)[pointsOf(id!).length - 1]).toEqual([200, 150]);
    expect(attr(id!, "d")).toBe(dictated(id!));
    expect(spoken()).toBe("Connettore aggiunto. Il disegno ha 5 oggetti.");
    expect(changes).toHaveLength(1);
    // Oltre la soglia del trascinamento, ma sotto la misura minima.
    drag([[150, 130], [153.5, 130]]);
    expect(lines()).toHaveLength(1);
    expect(changes).toHaveLength(1);
    // Con un capo solo su un oggetto, la frase dice quale.
    editor.select([]);
    link([60, 90], [200, 140]);
    expect(attr(lines()[1]!, "fub:from")).toBe(`${A} auto`);
    expect(attr(lines()[1]!, "fub:to")).toBeNull();
    expect(spoken()).toBe("Connettore aggiunto da Rettangolo «Alfa». Il disegno ha 6 oggetti.");
    editor.select([]);
    link([200, 140], [250, 90]);
    expect(attr(lines()[2]!, "fub:from")).toBeNull();
    expect(attr(lines()[2]!, "fub:to")).toBe(`${B} auto`);
    expect(spoken()).toBe("Connettore aggiunto verso Rettangolo «Beta». Il disegno ha 7 oggetti.");
  });

  it("con la griglia accesa i capi liberi vanno alla griglia, e con Ctrl o ⌘ restano dove sono", () => {
    const snap: DrawEditorOptions = {
      grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE },
    };
    connecting(SHAPES, snap);
    link([118, 127], [203, 152]);
    expect(pointsOf(lines()[0]!)[0]).toEqual([120, 120]);
    expect(pointsOf(lines()[0]!)[pointsOf(lines()[0]!).length - 1]).toEqual([200, 160]);
    editor.select([]);
    link([118, 127], [203, 152], { ctrlKey: true });
    expect(pointsOf(lines()[1]!)[0]).toEqual([118, 127]);
    expect(pointsOf(lines()[1]!)[pointsOf(lines()[1]!).length - 1]).toEqual([203, 152]);
    // I capi agganciati a un oggetto non vanno alla griglia.
    editor.select([]);
    link([97, 83], [243, 78]);
    expect(attr(lines()[2]!, "fub:geom")).toBe("elbow 100 80 240 80");
  });

  it("un tocco sceglie come la Selezione: Maiusc aggiunge e toglie, Ctrl o ⌘ entra nei gruppi, il vuoto toglie", () => {
    connecting();
    tap(60, 90);
    expect(editor.selection).toEqual([A]);
    tap(260, 80, { shiftKey: true });
    expect(editor.selection).toEqual([A, B]);
    tap(60, 90, { shiftKey: true });
    expect(editor.selection).toEqual([B]);
    // Il vuoto con Maiusc non toglie niente.
    tap(200, 140, { shiftKey: true });
    expect(editor.selection).toEqual([B]);
    tap(320, 220);
    expect(editor.selection).toEqual([G]);
    tap(310, 220, { ctrlKey: true });
    expect(editor.selection).toEqual([I]);
    tap(200, 140);
    expect(editor.selection).toEqual([]);
    expect(editor.tool).toBe("connector");
    expect(lines()).toEqual([]);
    expect(changes).toEqual([]);
  });

  /// Un connettore da Alfa, a destra, a Beta, a sinistra: resta scelto, e il
  /// Connettore in mano.
  const joined = (): string => {
    link([97, 83], [243, 78]);
    return lines()[0]!;
  };
  /// Come si vede sul foglio l'oggetto `id`.
  const painted = (id: string): SVGElement => host.querySelector<SVGElement>(`[data-scene-id="${id}"]`)!;

  describe("riagganciare un capo", () => {
    const ends = (id: string): { first: [number, number]; last: [number, number] } => {
      const points = pointsOf(id);
      return { first: points[0]!, last: points[points.length - 1]! };
    };

    it("un connettore scelto ha ai capi due quadrati, e tirato su un altro oggetto il capo vi si aggancia, in un passo", () => {
      const layer = recording();
      connecting();
      const id = joined();
      layer.frame();
      // I quadrati dei nodi: non i cerchi dell'aggancio, che qui non ci sono.
      const squares = (): string[] =>
        layer
          .calls()
          .filter(([name, , , width, height]) => name === "rect" && width === 8 && height === 8)
          .map(([, x, y]) => `${x},${y}`);
      expect(squares()).toEqual(["96.5,76.5", "236.5,76.5"]);
      const before = editor.engine.text;
      link([240, 80], [160, 215]);
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:to")).toBe(`${C} auto`);
      expect(attr(id, "fub:geom")).toMatch(/^elbow /);
      expect(ends(id).first).toEqual([100, 80]);
      expect([[170, 200], [200, 220], [170, 240], [140, 220]]).toContainEqual(ends(id).last);
      expect(attr(id, "d")).toBe(dictated(id));
      expect(spoken()).toBe("Fine agganciata a Rettangolo «Gamma».");
      expect(editor.selection).toEqual([id]);
      expect(changes).toHaveLength(2);
      editor.undo();
      expect(spoken()).toBe("Annullato: Aggancio del connettore.");
      expect(editor.engine.text).toBe(before);
    });

    it("mentre lo si tira il connettore si vede dove andrebbe", () => {
      connecting();
      const id = joined();
      const resting = painted(id).getAttribute("d");
      expect(resting).toBe(attr(id, "d"));
      const target = surface();
      const at = (type: string, x: number, y: number, held = 1): void =>
        void target.dispatchEvent(pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons: held, pressure: held === 1 ? 0.5 : 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
      at("pointerdown", 240, 80);
      at("pointermove", 200, 150);
      at("pointermove", 160, 215);
      // Il testo non cambia finché non si lascia, il disegno sì.
      expect(attr(id, "d")).toBe(resting);
      expect(painted(id).getAttribute("d")).not.toBe(resting);
      expect(painted(id).getAttribute("d")).toMatch(/^M100 80 /);
      at("pointerup", 160, 215, 0);
      expect(painted(id).getAttribute("d")).toBe(attr(id, "d"));
      expect(attr(id, "d")).not.toBe(resting);
    });

    it("tirato nel vuoto il capo si stacca e resta dove si lascia; l'altro capo resta agganciato", () => {
      connecting();
      const id = joined();
      const before = editor.engine.text;
      link([240, 80], [200, 140]);
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:to")).toBeNull();
      expect(ends(id).last).toEqual([200, 140]);
      expect(attr(id, "d")).toBe(dictated(id));
      expect(spoken()).toBe("Fine staccata: ora è libera.");
      // Il capo libero si riaggancia come ogni altro; qui l'inizio, prima a Gamma.
      link([100, 80], [160, 215]);
      expect(attr(id, "fub:from")).toBe(`${C} auto`);
      expect(spoken()).toBe("Inizio agganciato a Rettangolo «Gamma».");
      editor.undo();
      editor.undo();
      expect(editor.engine.text).toBe(before);
    });

    it("un capo non si riaggancia all'oggetto dell'altro capo", () => {
      connecting();
      const id = joined();
      // L'inizio, portato su Beta, dove sta la fine: resta libero.
      link([100, 80], [270, 70]);
      expect(attr(id, "fub:from")).toBeNull();
      expect(attr(id, "fub:to")).toBe(`${B} left`);
      expect(spoken()).toBe("Inizio staccato: ora è libero.");
    });

    it("un connettore che non è scelto non ha capi da prendere: il gesto ne tira uno nuovo", () => {
      connecting();
      joined();
      editor.select([]);
      link([240, 80], [160, 215]);
      expect(lines()).toHaveLength(2);
    });
  });

  describe("quando gli oggetti si muovono o se ne vanno", () => {
    it("il connettore segue l'oggetto spostato col mouse, e un annulla riporta tutto com'era", () => {
      connecting();
      const id = joined();
      const before = editor.engine.text;
      const resting = attr(id, "d");
      editor.setTool("select");
      editor.select([]);
      const target = surface();
      const at = (type: string, x: number, y: number, held = 1): void =>
        void target.dispatchEvent(pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons: held, pressure: held === 1 ? 0.5 : 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
      at("pointerdown", 60, 90);
      at("pointermove", 65, 110);
      at("pointermove", 60, 130);
      // Mentre si trascina, la linea segue l'oggetto sul foglio.
      expect(painted(id).getAttribute("d")).not.toBe(resting);
      expect(attr(id, "d")).toBe(resting);
      at("pointerup", 60, 130, 0);
      expect(editor.engine.text).toContain(`<rect id="${A}" `);
      expect(attr(A, "transform")).toBe("matrix(1 0 0 1 0 40)");
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(pointsOf(id)[0]).toEqual([100, 120]);
      expect(attr(id, "d")).toBe(dictated(id));
      expect(painted(id).getAttribute("d")).toBe(attr(id, "d"));
      expect(changes).toHaveLength(2);
      editor.undo();
      expect(editor.engine.text).toBe(before);
      editor.redo();
      expect(pointsOf(id)[0]).toEqual([100, 120]);
    });

    it("e quello spostato con le frecce, anche questo in un passo solo", () => {
      connecting();
      const id = joined();
      const before = editor.engine.text;
      editor.select([B]);
      key("ArrowDown", { shiftKey: true });
      expect(attr(B, "transform")).toBe("matrix(1 0 0 1 0 10)");
      const points = pointsOf(id);
      expect(points[points.length - 1]).toEqual([240, 90]);
      expect(attr(id, "d")).toBe(dictated(id));
      expect(changes).toHaveLength(2);
      editor.undo();
      expect(editor.engine.text).toBe(before);
    });

    it("l'oggetto eliminato lascia il connettore con l'ultima geometria e il capo libero, e un annulla ridà tutto", () => {
      connecting();
      const id = joined();
      const before = editor.engine.text;
      const geom = attr(id, "fub:geom");
      const d = attr(id, "d");
      editor.select([B]);
      key("Delete");
      expect(editor.engine.text).not.toContain(`id="${B}"`);
      expect(attr(id, "fub:to")).toBeNull();
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:geom")).toBe(geom);
      expect(attr(id, "d")).toBe(d);
      editor.undo();
      expect(editor.engine.text).toBe(before);
      // L'inizio, lo stesso.
      editor.select([A]);
      key("Delete");
      expect(attr(id, "fub:from")).toBeNull();
      expect(attr(id, "fub:to")).toBe(`${B} left`);
      expect(attr(id, "d")).toBe(d);
    });
  });

  // --- Il pannello delle proprietà ----------------------------------------------

  const openProperties = (): void => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Proprietà"]')!.click();
  const section = (): HTMLElement => properties().querySelector<HTMLElement>('.draw-properties-section[data-section="connector"]')!;
  const kindRadio = (kind: string): HTMLButtonElement => section().querySelector<HTMLButtonElement>(`button[data-kind="${kind}"]`)!;
  const anchorMenu = (end: "from" | "to"): HTMLSelectElement => section().querySelector<HTMLSelectElement>(`[data-field="connector-${end}"] select`)!;
  const labelArea = (): HTMLTextAreaElement => section().querySelector<HTMLTextAreaElement>('[data-field="connector-label"] textarea')!;
  const invertButton = (): HTMLButtonElement => section().querySelector<HTMLButtonElement>('[data-field="connector-invert"]')!;
  const pickAnchor = (end: "from" | "to", value: string): void => {
    anchorMenu(end).value = value;
    anchorMenu(end).dispatchEvent(new Event("change", { bubbles: true }));
  };
  const writeLabel = (text: string): void => {
    typeIn(labelArea(), text);
    key("Enter", {}, labelArea());
  };
  /// Le etichette del disegno: l'id, dove stanno lungo il connettore, e il
  /// `transform` che le porta al loro posto.
  const labels = (): Array<{ id: string; along: string; transform: string | null }> =>
    [...editor.engine.text.matchAll(/<text [^>]*>/g)].flatMap(([element]) => {
      const along = / fub:along="([^"]*)"/.exec(element)?.[1];
      return along === undefined ? [] : [{ id: / id="([^"]*)"/.exec(element)![1]!, along, transform: / transform="([^"]*)"/.exec(element)?.[1] ?? null }];
    });
  /// Un connettore da Alfa a Beta con l'etichetta «Sì», e il pannello aperto.
  const labelled = (): string => {
    connecting();
    const id = joined();
    openProperties();
    writeLabel("Sì");
    return id;
  };

  describe("le etichette e le copie", () => {
    const clip = (type: "copy" | "cut" | "paste", data = new DataTransfer()): DataTransfer => {
      // Con il fuoco in un campo, gli appunti sono del campo.
      editor.focus();
      surface().dispatchEvent(new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data }));
      return data;
    };
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    };

    it("un'etichetta scritta nel pannello è un testo che segue il connettore", () => {
      const id = labelled();
      expect(labels()).toEqual([{ id: expect.any(String), along: `${id} 0.5 4`, transform: "matrix(1 0 0 1 170 68)" }]);
      expect(editor.engine.text).toContain("<tspan x=\"0\" dy=\"0\">Sì</tspan>");
      expect(editor.selection).toEqual([id]);
    });

    it("eliminare o tagliare il connettore porta via la sua etichetta, e un annulla le ridà", () => {
      const id = labelled();
      const before = editor.engine.text;
      key("Delete");
      expect(lines()).toEqual([]);
      expect(labels()).toEqual([]);
      expect(editor.engine.text).not.toContain("<text");
      editor.undo();
      expect(editor.engine.text).toBe(before);
      editor.select([id]);
      const data = clip("cut");
      expect(data.getData("text/plain")).toContain(`fub:along="${id} 0.5 4"`);
      expect(labels()).toEqual([]);
      editor.undo();
      expect(editor.engine.text).toBe(before);
    });

    it("copiare il connettore copia anche l'etichetta, e incollarlo la lega al connettore nuovo", async () => {
      const id = labelled();
      const data = clip("copy");
      const svg = data.getData("text/plain");
      expect(svg).toContain(`fub:along="${id} 0.5 4"`);
      expect(changes).toHaveLength(2);
      const holding = new DataTransfer();
      holding.setData("text/plain", svg);
      clip("paste", holding);
      await settle();
      expect(lines()).toHaveLength(2);
      const copy = lines()[1]!;
      expect(labels().map((label) => label.along)).toEqual([`${id} 0.5 4`, `${copy} 0.5 4`]);
      // Gli oggetti a cui era agganciato non sono stati copiati: i capi della copia sono liberi.
      expect(attr(copy, "fub:from")).toBeNull();
      expect(attr(copy, "fub:to")).toBeNull();
      expect(attr(id, "fub:from")).toBe(`${A} right`);
    });

    it("duplicare il connettore da solo lo lascia coi capi liberi e la sua etichetta", () => {
      const id = labelled();
      editor.select([id]);
      key("d", { ctrlKey: true });
      expect(lines()).toHaveLength(2);
      const copy = lines()[1]!;
      expect(labels().map((label) => label.along)).toEqual([`${id} 0.5 4`, `${copy} 0.5 4`]);
      expect(attr(copy, "fub:from")).toBeNull();
      expect(attr(copy, "fub:to")).toBeNull();
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:to")).toBe(`${B} left`);
    });

    it("duplicando gli oggetti insieme al connettore, la copia si aggancia alle copie e la sua etichetta la segue", () => {
      const id = labelled();
      const before = editor.engine.text;
      editor.select([A, B, id]);
      key("d", { ctrlKey: true });
      expect(lines()).toHaveLength(2);
      const copy = lines()[1]!;
      const [copyA, copyB] = editor.selection.filter((key) => key !== copy && labels().every((label) => label.id !== key));
      expect(attr(copy, "fub:from")).toBe(`${copyA} right`);
      expect(attr(copy, "fub:to")).toBe(`${copyB} left`);
      // L'originale è rimasto agganciato agli originali.
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:to")).toBe(`${B} left`);
      expect(labels().map((label) => label.along)).toEqual([`${id} 0.5 4`, `${copy} 0.5 4`]);
      // Muovendo la copia di Beta, segue la copia del connettore e non l'originale.
      const original = attr(id, "d");
      editor.select([copyB!]);
      key("ArrowDown", { shiftKey: true });
      expect(attr(id, "d")).toBe(original);
      expect(attr(copy, "d")).toBe(dictated(copy));
      expect(attr(copy, "d")).not.toBe(original);
      editor.undo();
      editor.undo();
      expect(editor.engine.text).toBe(before);
    });
  });

  describe("«Collega le forme scelte»", () => {
    const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
    const connectButton = (): HTMLButtonElement => bar().querySelector<HTMLButtonElement>('button[aria-label="Collega le forme scelte"]')!;
    const selectionButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!;
    const menu = (): HTMLButtonElement[] => {
      const open = document.querySelectorAll<HTMLElement>(".context-menu");
      return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    };
    const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
    const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
    afterEach(() => {
      closeContextMenu();
      for (const open of document.querySelectorAll(".context-menu")) open.remove();
    });

    it("tre forme scelte si uniscono in fila, da sinistra a destra, con due connettori che restano scelti, in un passo", () => {
      mount(SHAPES, { level: "standard" });
      editor.select([A, B, C]);
      expect(connectButton().hidden).toBe(false);
      connectButton().click();
      // I centri sono più distesi in larghezza: Alfa, Gamma e Beta.
      expect(lines()).toHaveLength(2);
      const [first, second] = lines();
      expect([attr(first!, "fub:from"), attr(first!, "fub:to")]).toEqual([`${A} auto`, `${C} auto`]);
      expect([attr(second!, "fub:from"), attr(second!, "fub:to")]).toEqual([`${C} auto`, `${B} auto`]);
      for (const id of lines()) {
        expect(attr(id, "fub:geom")).toMatch(/^elbow /);
        expect(attr(id, "d")).toBe(dictated(id));
        expect(tipOf(scene(), id, "end")).toBe("triangle medium end #000000");
      }
      expect(markersIn(scene())).toHaveLength(1);
      expect(editor.selection).toEqual(lines());
      expect(spoken()).toBe("2 connettori aggiunti. Il disegno ha 6 oggetti.");
      expect(changes).toHaveLength(1);
      editor.undo();
      expect(spoken()).toBe("Annullato: Collega le forme.");
      expect(editor.engine.text).toBe(SHAPES);
    });

    it("dal menu della selezione fa lo stesso, e con le forme già unite lo dice senza scrivere niente", () => {
      mount(SHAPES, { level: "standard" });
      editor.select([A, B]);
      selectionButton().click();
      item("Collega le forme scelte").click();
      expect(spoken()).toBe("1 connettore aggiunto. Il disegno ha 5 oggetti.");
      expect(attr(lines()[0]!, "fub:from")).toBe(`${A} auto`);
      expect(attr(lines()[0]!, "fub:to")).toBe(`${B} auto`);
      const written = editor.engine.text;
      editor.select([A, B]);
      selectionButton().click();
      item("Collega le forme scelte").click();
      expect(spoken()).toBe("Le forme scelte sono già unite.");
      expect(editor.engine.text).toBe(written);
      expect(changes).toHaveLength(1);
      expect(editor.selection).toEqual([A, B]);
    });

    it("una coppia già unita, nell'uno o nell'altro verso, si salta e si dice", () => {
      connecting();
      // Da Gamma ad Alfa, a mano.
      link([160, 225], [60, 90]);
      editor.setTool("select");
      editor.select([A, B, C]);
      connectButton().click();
      expect(lines()).toHaveLength(2);
      expect([attr(lines()[1]!, "fub:from"), attr(lines()[1]!, "fub:to")]).toEqual([`${C} auto`, `${B} auto`]);
      expect(spoken()).toBe("1 connettore aggiunto. 1 coppia era già unita. Il disegno ha 6 oggetti.");
    });

    it("gli oggetti senza id ne ricevono uno, nello stesso passo", () => {
      const plain = doc(`${LAYER}<rect x="40" y="60" width="60" height="40" fill="#e69f00"/><rect x="240" y="60" width="60" height="40" fill="#009e73"/></g>`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 300"');
      mount(plain, { level: "standard" });
      key("a", { ctrlKey: true });
      expect(editor.selection).toHaveLength(2);
      connectButton().click();
      const [id] = lines();
      const [from, to] = [attr(id!, "fub:from")!.split(" ")[0]!, attr(id!, "fub:to")!.split(" ")[0]!];
      expect(editor.engine.text).toMatch(new RegExp(`<rect id="${from}" x="40"`));
      expect(editor.engine.text).toMatch(new RegExp(`<rect id="${to}" x="240"`));
      expect(changes).toHaveLength(1);
      editor.undo();
      expect(editor.engine.text).toBe(plain);
    });

    it("con meno di due oggetti il pulsante non c'è e la voce del menu è spenta, e dice perché; i connettori non contano", () => {
      mount(SHAPES, { level: "standard" });
      editor.select([A]);
      expect(connectButton().hidden).toBe(true);
      selectionButton().click();
      expect(item("Collega le forme scelte").getAttribute("aria-disabled")).toBe("true");
      expect(item("Collega le forme scelte").querySelector(".menu-description")!.textContent).toBe("Scegli almeno due oggetti da unire: i connettori non contano.");
      item("Collega le forme scelte").click();
      expect(changes).toEqual([]);
      closeContextMenu();
      for (const open of document.querySelectorAll(".context-menu")) open.remove();
      // Un oggetto e un connettore sono ancora uno solo da unire.
      key("x");
      link([97, 83], [243, 78]);
      editor.select([A, lines()[0]!]);
      expect(connectButton().hidden).toBe(true);
      selectionButton().click();
      expect(item("Collega le forme scelte").getAttribute("aria-disabled")).toBe("true");
    });

    it("all'Essenziale non c'è, e in sola lettura la voce è spenta e la barra non si vede", () => {
      mount(SHAPES);
      editor.select([A, B]);
      expect(connectButton().hidden).toBe(true);
      editor.setLevel("standard");
      expect(connectButton().hidden).toBe(false);
      selectionButton().click();
      expect(item("Collega le forme scelte").getAttribute("aria-disabled")).toBeNull();
      closeContextMenu();
      for (const open of document.querySelectorAll(".context-menu")) open.remove();
      editor.setReadOnly(true);
      expect(bar().hidden).toBe(true);
      selectionButton().click();
      expect(item("Collega le forme scelte").getAttribute("aria-disabled")).toBe("true");
      item("Collega le forme scelte").click();
      expect(lines()).toEqual([]);
      expect(changes).toEqual([]);
    });
  });

  describe("la sezione «Connettore» delle proprietà", () => {
    it("c'è con un connettore scelto e non senza, e dice il suo tipo, gli agganci e l'etichetta", () => {
      connecting();
      openProperties();
      expect(section().hidden).toBe(true);
      const id = joined();
      expect(section().hidden).toBe(false);
      expect(["straight", "elbow", "curved"].map((kind) => kindRadio(kind).getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
      expect([anchorMenu("from").value, anchorMenu("to").value]).toEqual(["right", "left"]);
      expect(labelArea().value).toBe("");
      // Un oggetto scelto accanto non cambia la sezione; da solo, la toglie.
      editor.select([A, id]);
      expect(section().hidden).toBe(false);
      editor.select([A]);
      expect(section().hidden).toBe(true);
      expect(formatIssues(checkAccessibility(host))).toBe("");
    });

    it("«Curvo» riscrive il percorso in un passo, e il connettore che si tira dopo è curvo", () => {
      connecting();
      const id = joined();
      openProperties();
      const before = editor.engine.text;
      kindRadio("curved").click();
      expect(attr(id, "fub:geom")).toMatch(/^curved (-?[\d.]+ ){7}-?[\d.]+$/);
      expect(attr(id, "d")).toBe(dictated(id));
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:to")).toBe(`${B} left`);
      expect(kindRadio("curved").getAttribute("aria-checked")).toBe("true");
      expect(spoken()).toBe("1 connettore cambiato.");
      expect(changes).toHaveLength(2);
      editor.undo();
      expect(spoken()).toBe("Annullato: Tipo del connettore.");
      expect(editor.engine.text).toBe(before);
      expect(kindRadio("elbow").getAttribute("aria-checked")).toBe("true");
      editor.redo();
      expect(attr(id, "fub:geom")).toMatch(/^curved /);
      // Lo strumento disegna del tipo scelto per ultimo.
      editor.select([]);
      link([60, 90], [155, 225]);
      expect(attr(lines()[1]!, "fub:geom")).toMatch(/^curved (-?[\d.]+ ){7}-?[\d.]+$/);
      expect(attr(lines()[1]!, "d")).toBe(dictated(lines()[1]!));
      expect(kindRadio("curved").getAttribute("aria-checked")).toBe("true");
      // Anche «Collega le forme scelte».
      editor.select([A, B, C]);
      host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Collega le forme scelte"]')!.click();
      expect(attr(lines()[2]!, "fub:geom")).toMatch(/^curved /);
    });

    it("l'aggancio di un capo cambia il punto in cui il connettore tocca l'oggetto, in un passo", () => {
      connecting();
      const id = joined();
      openProperties();
      const before = editor.engine.text;
      pickAnchor("from", "top");
      expect(attr(id, "fub:from")).toBe(`${A} top`);
      expect(attr(id, "fub:to")).toBe(`${B} left`);
      expect(pointsOf(id)[0]).toEqual([70, 60]);
      expect(attr(id, "d")).toBe(dictated(id));
      expect(spoken()).toBe("1 connettore cambiato.");
      expect(anchorMenu("from").value).toBe("top");
      editor.undo();
      expect(spoken()).toBe("Annullato: Aggancio del connettore.");
      expect(editor.engine.text).toBe(before);
      expect(anchorMenu("from").value).toBe("right");
      pickAnchor("to", "bottom");
      expect(attr(id, "fub:to")).toBe(`${B} bottom`);
      const points = pointsOf(id);
      expect(points[points.length - 1]).toEqual([270, 100]);
    });

    it("un capo libero lo dice e non si cambia dal menu", () => {
      connecting();
      const id = joined();
      openProperties();
      editor.select([B]);
      key("Delete");
      editor.select([id]);
      expect(anchorMenu("to").value).toBe("free");
      expect(anchorMenu("to").disabled).toBe(true);
      expect(anchorMenu("from").disabled).toBe(false);
      expect(section().textContent).toContain("Per agganciarlo, trascina il capo su un oggetto con lo strumento Connettore.");
      expect(formatIssues(checkAccessibility(host))).toBe("");
    });

    it("l'etichetta è un testo lungo il connettore: lo segue quando gli oggetti si muovono, e vuota se ne va", () => {
      const id = labelled();
      const [label] = labels();
      expect(label!.transform).toBe("matrix(1 0 0 1 170 68)");
      const before = editor.engine.text;
      editor.select([B]);
      key("ArrowRight", { shiftKey: true });
      // Il connettore si allunga di 10, e l'etichetta resta a metà.
      expect(labels()).toEqual([{ id: label!.id, along: `${id} 0.5 4`, transform: "matrix(1 0 0 1 175 68)" }]);
      editor.undo();
      expect(editor.engine.text).toBe(before);
      // Un testo nuovo cambia le righe dell'etichetta che c'è, e non ne fa un'altra.
      editor.select([id]);
      writeLabel("No");
      expect(labels().map((each) => each.id)).toEqual([label!.id]);
      expect(editor.engine.text).toContain('<tspan x="0" dy="0">No</tspan>');
      expect(editor.engine.text).not.toContain(">Sì<");
      writeLabel("");
      expect(labels()).toEqual([]);
      expect(editor.engine.text).not.toContain("<text");
      editor.undo();
      expect(spoken()).toBe("Annullato: Etichetta del connettore.");
      expect(labels()).toHaveLength(1);
    });

    it("«Inverti» porta la freccia dall'altra parte: la punta di fine resta di fine, e l'etichetta resta dov'è", () => {
      const id = labelled();
      const before = editor.engine.text;
      const first = pointsOf(id)[0]!;
      const last = pointsOf(id)[pointsOf(id).length - 1]!;
      const place = labels()[0]!.transform;
      expect(tipOf(scene(), id, "end")).toBe("triangle medium end #000000");
      invertButton().click();
      expect(attr(id, "fub:from")).toBe(`${B} left`);
      expect(attr(id, "fub:to")).toBe(`${A} right`);
      expect(pointsOf(id)[0]).toEqual(last);
      expect(pointsOf(id)[pointsOf(id).length - 1]).toEqual(first);
      expect(attr(id, "d")).toBe(dictated(id));
      // La punta non cambia lato: ora indica Alfa.
      expect(tipOf(scene(), id, "end")).toBe("triangle medium end #000000");
      expect(attr(id, "marker-start")).toBeNull();
      expect(markersIn(scene())).toHaveLength(1);
      expect(labels()[0]!.along).toBe(`${id} 0.5 4`);
      expect(labels()[0]!.transform).toBe(place);
      expect(spoken()).toBe("1 connettore cambiato.");
      editor.undo();
      expect(spoken()).toBe("Annullato: Inverti il connettore.");
      expect(editor.engine.text).toBe(before);
    });
  });

  it("l'accessibilità resta pulita con lo strumento in mano, i punti d'aggancio in vista e la sezione aperta", () => {
    const layer = recording();
    labelled();
    hover(60, 90);
    layer.frame();
    expect(editor.tool).toBe("connector");
    expect(layer.calls().filter(([name]) => name === "arc")).toHaveLength(5);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    editor.select([A, B]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  describe("il gesto", () => {
    const press = (type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void =>
      void surface().dispatchEvent(
        pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, clientX: x, clientY: y, timeStamp: (clock += 8) }),
      );
    const preview = (): SVGElement | null => host.querySelector<SVGElement>('.draw-preview path[fill="none"]');

    it("mentre lo si tira il connettore nuovo si vede in anteprima, come sarà scritto", () => {
      connecting();
      expect(preview()).toBeNull();
      press("pointerdown", 60, 90);
      // Un tocco appena mosso non è ancora un trascinamento.
      press("pointermove", 61, 90);
      expect(preview()).toBeNull();
      press("pointermove", 150, 90);
      press("pointermove", 243, 78);
      const shown = preview()!;
      expect(shown.getAttribute("d")).toBe("M100 80 L240 80");
      expect(shown.getAttribute("marker-end")).toMatch(/^url\(#draw-preview-tip-\d+\)$/);
      press("pointerup", 243, 78);
      expect(preview()).toBeNull();
      expect(attr(lines()[0]!, "d")).toBe("M100 80 L240 80");
    });

    it("Esc a metà del gesto lo annulla: niente anteprima e niente connettore", () => {
      connecting();
      press("pointerdown", 60, 90);
      press("pointermove", 150, 90);
      press("pointermove", 243, 78);
      expect(preview()).not.toBeNull();
      key("Escape");
      expect(preview()).toBeNull();
      press("pointerup", 243, 78);
      expect(lines()).toEqual([]);
      expect(changes).toEqual([]);
    });

    it("in un livello bloccato non si scrive niente, e si dice perché", () => {
      const locked = doc(`<title>Prova</title><g id="l1" fub:layer="Livello 1" fub:locked="true">${rect(A, "Alfa", 40, 60, 60, 40, "#e69f00")}</g>`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 300"');
      connecting(locked);
      link([120, 130], [200, 150]);
      expect(lines()).toEqual([]);
      expect(changes).toEqual([]);
      expect(spoken()).toBe("«Livello 1» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
      expect(preview()).toBeNull();
    });

    it("un oggetto bloccato non si aggancia, e in sola lettura il gesto non scrive", () => {
      connecting();
      editor.select([A]);
      key("L", { ctrlKey: true, shiftKey: true });
      editor.select([]);
      const written = editor.engine.text;
      link([60, 90], [155, 225]);
      expect(attr(lines()[0]!, "fub:from")).toBeNull();
      expect(attr(lines()[0]!, "fub:to")).toBe(`${C} auto`);
      editor.undo();
      expect(editor.engine.text).toBe(written);
      editor.setReadOnly(true);
      link([60, 90], [155, 225]);
      expect(lines()).toEqual([]);
    });
  });

  describe("più oggetti insieme a un connettore", () => {
    it("oggetti e connettore scelti insieme si spostano senza cambiare niente fra loro", () => {
      connecting();
      const id = joined();
      const geom = attr(id, "fub:geom");
      editor.select([A, B, id]);
      key("ArrowRight", { shiftKey: true });
      expect(attr(A, "transform")).toBe("matrix(1 0 0 1 10 0)");
      expect(attr(B, "transform")).toBe("matrix(1 0 0 1 10 0)");
      expect(attr(id, "transform")).toBe("matrix(1 0 0 1 10 0)");
      expect(attr(id, "fub:geom")).toBe(geom);
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      expect(attr(id, "fub:to")).toBe(`${B} left`);
      expect(spoken()).toBe("3 oggetti spostati.");
    });

    it("un connettore scelto con uno solo dei suoi oggetti si sposta, e il capo dell'altro resta dov'è sul foglio", () => {
      connecting();
      const id = joined();
      editor.select([A, id]);
      key("ArrowDown", { shiftKey: true });
      expect(attr(A, "transform")).toBe("matrix(1 0 0 1 0 10)");
      expect(attr(id, "transform")).toBe("matrix(1 0 0 1 0 10)");
      // Nel suo riferimento, spostato di 10 in giù: l'inizio sta a destra di
      // Alfa spostata, la fine a sinistra di Beta, ferma.
      const points = pointsOf(id);
      expect([points[0]![0], points[0]![1] + 10]).toEqual([100, 90]);
      expect([points[points.length - 1]![0], points[points.length - 1]![1] + 10]).toEqual([240, 80]);
      expect(attr(id, "d")).toBe(dictated(id));
      // Resta agganciato: niente da dire.
      expect(spoken()).toBe("2 oggetti spostati.");
    });

    it("un connettore spostato da solo si stacca dagli oggetti, resta com'è e lo dice", () => {
      connecting();
      const id = joined();
      const geom = attr(id, "fub:geom");
      editor.select([id]);
      key("ArrowDown", { shiftKey: true });
      expect(attr(id, "fub:from")).toBeNull();
      expect(attr(id, "fub:to")).toBeNull();
      expect(attr(id, "fub:geom")).toBe(geom);
      expect(attr(id, "transform")).toBe("matrix(1 0 0 1 0 10)");
      // Sul foglio non si vede: lo dice l'annuncio.
      expect(spoken()).toBe("1 oggetto spostato. Il connettore si è staccato: i suoi oggetti non erano fra gli scelti.");
      editor.undo();
      expect(attr(id, "fub:from")).toBe(`${A} right`);
      // Anche spostato dal pannello delle proprietà.
      openProperties();
      editor.select([id]);
      enter(propertyInput("x"), "90");
      expect(attr(id, "fub:from")).toBeNull();
      expect(spoken()).toBe("Il connettore si è staccato: i suoi oggetti non erano fra gli scelti.");
      // E girato da solo, con la sua cornice.
      editor.undo();
      key("]");
      expect(attr(id, "fub:to")).toBeNull();
      expect(spoken()).toMatch(/ Il connettore si è staccato: i suoi oggetti non erano fra gli scelti\.$/);
    });

    it("l'oggetto agganciato dentro un gruppo segue il gruppo, e il gruppo eliminato libera il capo", () => {
      connecting();
      link([300, 230], [60, 90], { ctrlKey: true });
      const id = lines()[0]!;
      expect(attr(id, "fub:from")).toBe(`${I} auto`);
      const before = editor.engine.text;
      editor.select([G]);
      key("ArrowRight", { shiftKey: true });
      expect(pointsOf(id)[0]).toEqual([300, 220]);
      expect(attr(id, "d")).toBe(dictated(id));
      editor.undo();
      expect(editor.engine.text).toBe(before);
      editor.select([G]);
      key("Delete");
      expect(attr(id, "fub:from")).toBeNull();
      expect(attr(id, "fub:to")).toBe(`${A} auto`);
    });
  });
});

describe("presentare, dal livello Standard", () => {
  /// Tre tavole 400 × 200 in fila, con un quadrato sulla seconda.
  const DECK = doc(
    "<title>Ciclo</title>" +
      '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>' +
      '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title><desc>Il sole scalda il mare.</desc></view>' +
      '<view id="bmnopqrst" fub:role="board" viewBox="960 0 400 200"><title>Pioggia</title></view>' +
      `${LAYER}<rect id="oa1a1a1a1" x="600" y="50" width="20" height="20" fill="#000000"/></g>`,
  ).replace('viewBox="0 0 100 100"', 'viewBox="0 0 1360 200"');

  const presentButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Presenta"]')!;
  const presentation = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-present");
  /// Ciò che la presentazione ha detto per ultimo.
  const told = (): string => (presentation()?.querySelector('[role="status"]')?.textContent ?? "").trim();
  /// Un tasto nella presentazione, dove sta il fuoco.
  const inside = (name: string): KeyboardEvent => key(name, {}, document.activeElement as HTMLElement);

  /// Aspetta che la presentazione si apra, e il suo primo annuncio.
  async function opened(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(presentation()).not.toBeNull());
    await vi.waitFor(() => expect(told()).not.toBe(""));
    return presentation()!;
  }

  afterEach(() => {
    presentation()?.remove();
  });

  it("il pulsante e F5 ci sono dallo Standard, non nell'Essenziale", async () => {
    mount(DECK);
    expect(presentButton().hidden).toBe(true);
    expect(key("F5").defaultPrevented).toBe(false);
    editor.setLevel("standard");
    expect(presentButton().hidden).toBe(false);
    expect(presentButton().getAttribute("aria-keyshortcuts")).toBe("F5");
    // Accanto a «Tavole».
    expect(presentButton().previousElementSibling?.getAttribute("aria-label")).toBe("Tavole");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    presentButton().click();
    await opened();
    expect(told()).toBe("Presentazione: Copertina, tavola 1 di 3. Esc per uscire.");
  });

  it("nel Personalizzato è una parte, «Presentare»", () => {
    mount(DECK, { level: "custom", custom: ["present"] });
    expect(editor.features.has("present")).toBe(true);
    expect(presentButton().hidden).toBe(false);
    editor.setLevel("custom", ["pen"]);
    expect(presentButton().hidden).toBe(true);
    expect(key("F5").defaultPrevented).toBe(false);
  });

  it("F5 presenta dalla prima tavola, anche in sola lettura, e all'uscita il foglio sceglie e inquadra la tavola dov'era arrivata", async () => {
    mount(DECK, { level: "standard" });
    size(1000, 500);
    editor.setReadOnly(true);
    expect(key("F5").defaultPrevented).toBe(true);
    // Con Ctrl, F5 resta del browser.
    expect(key("F5", { ctrlKey: true }).defaultPrevented).toBe(false);
    const shown = await opened();
    expect(told()).toBe("Presentazione: Copertina, tavola 1 di 3. Esc per uscire.");
    expect(formatIssues(checkAccessibility(shown))).toBe("");
    expect([...shown.querySelectorAll("img")].map((img) => img.alt)).toContain("Copertina");
    inside("ArrowRight");
    expect(told()).toBe("Evaporazione, tavola 2 di 3.");
    inside("Escape");
    expect(presentation()).toBeNull();
    expect(document.activeElement).toBe(surface());
    expect(spoken()).toBe("Evaporazione, tavola 2 di 3, 400 × 200.");
    // La tavola scelta è quella di adesso anche per l'elenco.
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Tavole"]')!.click();
    expect([...host.querySelectorAll<HTMLElement>('.draw-boards [aria-current="true"] .draw-board-name')].map((name) => name.textContent)).toEqual(["Evaporazione"]);
    expect(changes).toEqual([]);
    expect(editor.engine.text).toBe(DECK);
  });

  it("Maiusc+F5 presenta dalla tavola di adesso", async () => {
    mount(DECK, { level: "standard" });
    size(1000, 500);
    key("PageDown", { altKey: true });
    key("PageDown", { altKey: true });
    key("PageDown", { altKey: true });
    expect(spoken()).toBe("Pioggia, tavola 3 di 3, 400 × 200.");
    expect(key("F5", { shiftKey: true }).defaultPrevented).toBe(true);
    await opened();
    expect(told()).toBe("Presentazione: Pioggia, tavola 3 di 3. Esc per uscire.");
    inside("ArrowLeft");
    inside("Escape");
    expect(spoken()).toBe("Evaporazione, tavola 2 di 3, 400 × 200.");
  });

  it("«Presenta da qui» nel menu di una tavola dell'elenco", async () => {
    mount(DECK, { level: "standard" });
    size(1000, 500);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Tavole"]')!.click();
    const row = host.querySelector<HTMLElement>('.draw-boards [role="option"][data-index="1"]')!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
    const items = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')];
    const here = items.find((item) => item.querySelector(".menu-label")!.textContent === "Presenta da qui")!;
    expect(here).toBeDefined();
    here.click();
    closeContextMenu();
    await opened();
    expect(told()).toBe("Presentazione: Evaporazione, tavola 2 di 3. Esc per uscire.");
  });

  it("l'inchiostro, gli schermi vuoti e il resto non toccano il disegno", async () => {
    mount(DECK, { level: "standard" });
    size(1000, 500);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    key("F5");
    const shown = await opened();
    const stage = shown.querySelector<HTMLElement>(".draw-present-stage")!;
    const at = (type: string, x: number, y: number, buttons: number): void =>
      void stage.dispatchEvent(pointer(type, { ...MOUSE, button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons === 0 ? 0 : 0.5, clientX: x, clientY: y, timeStamp: (clock += 8) }));
    at("pointerdown", 100, 100, 1);
    at("pointermove", 200, 150, 1);
    at("pointermove", 300, 200, 1);
    at("pointerup", 300, 200, 0);
    expect(shown.querySelectorAll(".draw-present-ink path")).toHaveLength(1);
    for (const name of ["b", "b", "w", "l", "e", "w", "End", "ArrowRight"]) inside(name);
    expect(presentation()).not.toBeNull();
    inside("ArrowRight");
    expect(presentation()).toBeNull();
    expect(changes).toEqual([]);
    expect(editor.canUndo).toBe(false);
    expect(editor.engine.text).toBe(DECK);
    expect(spoken()).toBe("Pioggia, tavola 3 di 3, 400 × 200.");
  });

  it("«?» elenca F5 e Maiusc+F5 nella vista, e i tasti della presentazione nel loro gruppo", () => {
    mount(DECK, { level: "standard" });
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    const view = tables.find((table) => table.caption === "Vista")!;
    expect(view.rows).toContainEqual(["F5", "Presenta dalla prima tavola"]);
    expect(view.rows).toContainEqual(["Shift+F5", "Presenta dalla tavola di adesso: quella scelta, o quella al centro della vista"]);
    const inner = tables.find((table) => table.caption === "Presentazione")!;
    expect(inner.rows.map(([keys]) => keys)).toEqual(["→ o ↓ o Space o PgDn o Enter o N", "← o ↑ o PgUp o ⌫ o P", "Home o End", "0…9", "B o .", "W o ,", "L", "E", "Esc"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("un editor che se ne va porta via la presentazione", async () => {
    mount(DECK, { level: "standard" });
    key("F5");
    await opened();
    owner.close();
    expect(presentation()).toBeNull();
    owner = openLifetime();
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
    expect(railNames()).toEqual(["Selezione", "Mano", "Zoom", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia", "Testo"]);
    expect(fullButton().hidden).toBe(false);

    fullButton().click();
    expect(onWorkspace).toHaveBeenLastCalledWith("full");
    expect(host.querySelector<HTMLElement>(".draw-editor")!.dataset.workspace).toBe("full");
    expect(rail().dataset.size).toBe("normal");
    expect(fullButton().hidden).toBe(true);
    expect(railNames()).toContain("Lazo");
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
    expect(railNames()).not.toContain("Lazo");

    // Dall'esterno (un'altra finestra ha cambiato l'impostazione): niente
    // richiamo, perché la scelta è già ricordata.
    onWorkspace.mockClear();
    editor.setWorkspace("full");
    expect(railNames()).toContain("Lazo");
    editor.setWorkspace("full", ["select", "text", "pen"]);
    expect(railNames()).toEqual(["Selezione", "Testo", "Penna"]);
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
    expect(captions[0]).toBe("Strumenti");
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
    editor.setWorkspace("full", ["text", "pen"]);
    expect(railNames()).toEqual(["Selezione", "Testo", "Penna"]);
    key("r");
    expect(editor.tool).toBe("rect");
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
    expect(rows().slice(0, 2)).toEqual(["lasso", "select"]);
    const hand = row("hand").querySelector<HTMLInputElement>("input")!;
    hand.click();
    expect(railNames().slice(0, 2)).toEqual(["Lazo", "Selezione"]);
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
