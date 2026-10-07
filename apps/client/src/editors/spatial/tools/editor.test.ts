// @vitest-environment happy-dom
// L'editor del disegno, dal puntatore al testo: ogni strumento produce le
// operazioni attese, annulla e ripeti le disfano, e chi non vede sente che
// cosa è successo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { applyOperation } from "../../core/text-operation";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { decodeInk, inkLength, inkPoint } from "../ink/codec";
import { polygonalAttrs, readPolygonal } from "../scene/parametric";
import { SceneEngine } from "../scene/engine";
import { readScene } from "../scene/read";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions, type DrawImages, type DrawPlace } from "./editor";
import { MERGE_MS } from "./history";
import type { Decoded, EncodeType, ImageCodec } from "./images";
import { rasterize } from "./png";
import { arrowPath } from "./shapes";
import { inlineTracer } from "./trace-runner";
import { appearance, LAYER } from "./test-support";
import { DEFAULT_CURVE } from "../pen/pressure";
import { closeRadial } from "./radial";
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
    // Ciò che il livello Standard aggiunge c'è, nascosto.
    const groups = [...toolbar.querySelectorAll(".draw-group:not([hidden])")].map((group) => [group.getAttribute("role"), group.getAttribute("aria-label")]);
    expect(groups).toEqual([
      ["radiogroup", "Strumento"],
      ["radiogroup", "Colore"],
      ["radiogroup", "Spessore"],
      ["group", "Modifica"],
      ["group", "Vista"],
    ]);
    const tools = [...toolbar.querySelectorAll<HTMLButtonElement>(".draw-tool:not([hidden])")];
    expect(tools.map((control) => control.getAttribute("aria-label"))).toEqual(["Selezione", "Penna", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
    expect(tools.map((control) => control.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "false", "false", "false"]);
    expect(tools[3]!.title).toBe("Rettangolo (R)");
    expect(tools[3]!.getAttribute("aria-keyshortcuts")).toBe("R");
    expect(document.getElementById(tools[3]!.getAttribute("aria-describedby")!)?.textContent).toContain("Maiusc");
    expect(toolbar.querySelectorAll('.draw-color[role="radio"]:not([hidden])')).toHaveLength(8);
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

  it("la gomma toglie gli oggetti interi che attraversa", () => {
    mount();
    editor.setTool("eraser");
    drag([[50, 70], [56, 70], [64, 70]]);
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 0 oggetti.");
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
  /// I nomi dei pulsanti che si vedono in un gruppo della barra.
  const shown = (selector: string): string[] =>
    [...host.querySelectorAll<HTMLButtonElement>(`[role="toolbar"] ${selector}:not([hidden])`)]
      .filter((control) => control.closest("[hidden]") === null)
      .map((control) => control.getAttribute("aria-label") ?? "");
  const more = (): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((control) => control.getAttribute("aria-label") === "Altro colore…")!;
  const widths = (): string[] =>
    [...host.querySelectorAll<HTMLElement>(".draw-width")].map((control) => `${control.querySelector<HTMLElement>(".draw-width-bar")!.style.getPropertyValue("--draw-width")}${control.getAttribute("aria-checked") === "true" ? "*" : ""}`);

  it("aggiunge l'evidenziatore dopo la penna e «Altro colore…», e il livello cambia dal vivo", () => {
    mount();
    expect(shown(".draw-tool")).not.toContain("Evidenziatore");
    expect(shown("button")).not.toContain("Altro colore…");
    key("h");
    expect(editor.tool).toBe("pen");

    editor.select(["o1a2b3c4d"]);
    editor.setLevel("standard");
    expect(editor.level).toBe("standard");
    expect(shown(".draw-tool")).toEqual(["Selezione", "Lazo", "Tavola", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia", "Poligono", "Testo"]);
    expect(shown("button")).toContain("Altro colore…");
    const highlighter = host.querySelector<HTMLButtonElement>('[data-tool="highlighter"]')!;
    expect(highlighter.title).toBe("Evidenziatore (H)");
    expect(document.getElementById(highlighter.getAttribute("aria-describedby")!)?.textContent).toContain("spessore costante");
    // Il documento, la selezione e la cronologia restano.
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");

    key("h");
    expect(editor.tool).toBe("highlighter");
    // Tornati all'Essenziale, l'evidenziatore non c'è più: si riparte dalla penna.
    editor.setLevel("essential");
    expect(editor.tool).toBe("pen");
    expect(shown(".draw-tool")).not.toContain("Evidenziatore");
    expect(changes).toEqual([]);
  });

  it("l'evidenziatore scrive un tratto giallo, largo e trasparente, che si annulla col suo nome", () => {
    mount(SOURCE, { level: "standard" });
    editor.setTool("highlighter");
    expect(editor.color).toBe("#f0e442");
    expect(editor.width).toBe(16);
    drag([[10, 10], [14, 12], [20, 15], [28, 16], [36, 16]], { pressure: 0.9 });
    expect(editor.engine.text).toMatch(
      /<path id="o[a-z0-9]{8}" fub:tool="highlighter" fub:at="[^"]+Z" fub:brush="pf1 size=16 thinning=0 [^"]*capStart=0 capEnd=0 sim=0" d="M[^"]+" fill="#f0e442" fill-opacity="0.4" fub:ink="1 [^"]+"\/>/,
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
    // Uno spessore della penna non è dell'evidenziatore.
    editor.setWidth(4);
    expect(editor.width).toBe(24);
    editor.setColor("#56b4e9");
    editor.setTool("pen");
    expect([editor.color, editor.width]).toEqual(["#d55e00", 4]);
    editor.setTool("highlighter");
    expect([editor.color, editor.width]).toEqual(["#56b4e9", 24]);
  });

  it("«Altro colore…» chiede un codice, e il colore resta come campione accanto alla tavolozza", async () => {
    mount(SOURCE, { level: "standard" });
    more().click();
    expect(dialog().querySelector(".modal-title, h2")?.textContent).toBe("Colore personalizzato");
    const code = field("color") as HTMLInputElement;
    expect(code.value).toBe("#000000");
    const picker = dialog().querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(picker.getAttribute("aria-label")).toBe("Selettore dei colori");
    code.value = "3A7BD5";
    code.dispatchEvent(new Event("input", { bubbles: true }));
    expect(picker.value).toBe("#3a7bd5");
    await submit();

    expect(editor.color).toBe("#3a7bd5");
    expect(spoken()).toBe("Colore: Personalizzato #3a7bd5.");
    const custom = host.querySelector<HTMLButtonElement>('.draw-color:has([data-shape="ring"])')!;
    expect(custom.hidden).toBe(false);
    expect(custom.getAttribute("aria-label")).toBe("Personalizzato #3a7bd5");
    expect(custom.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelectorAll('.draw-color[aria-checked="true"]')).toHaveLength(1);

    // Un altro colore della tavolozza, e il campione resta lì per tornarci.
    editor.setColor("#000000");
    expect(custom.getAttribute("aria-checked")).toBe("false");
    custom.click();
    expect(editor.color).toBe("#3a7bd5");
    editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    expect(editor.engine.text).toContain('stroke="#3a7bd5"');
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un codice della tavolozza sceglie il suo campione, uno chiaro lo dice, e uno sbagliato non conferma", async () => {
    mount(SOURCE, { level: "standard" });
    more().click();
    (field("color") as HTMLInputElement).value = "#0072B2";
    await submit();
    expect(editor.color).toBe("#0072b2");
    expect(spoken()).toBe("Colore: Blu.");
    expect(host.querySelector<HTMLButtonElement>('.draw-color:has([data-shape="ring"])')!.hidden).toBe(true);

    more().click();
    const code = field("color") as HTMLInputElement;
    code.value = "rosso";
    expect(code.checkValidity()).toBe(false);
    code.value = "#eee";
    await submit();
    expect(editor.color).toBe("#eeeeee");
    expect(spoken()).toBe("Colore: Personalizzato #eeeeee, chiaro: sulla carta bianca si legge poco.");
  });

  it("sotto lo Standard il colore a piacere non c'è: si torna al nero", () => {
    mount(SOURCE, { level: "standard" });
    editor.setColor("#3a7bd5");
    editor.setLevel("essential");
    expect(editor.color).toBe("#000000");
    expect(host.querySelector<HTMLButtonElement>('.draw-color:has([data-shape="ring"])')!.hidden).toBe(true);
    // All'Essenziale un colore fuori dalla tavolozza non si sceglie.
    editor.setColor("#3a7bd5");
    expect(editor.color).toBe("#000000");
    editor.setLevel("standard");
    expect(host.querySelector<HTMLButtonElement>('.draw-color:has([data-shape="ring"])')!.hidden).toBe(false);
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
    expect(spoken()).toBe("Non separato: un ritaglio, una maschera o un filtro valgono per tutto il gruppo.");
    editor.select(["og1g1g1g1", "og2g2g2g2"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("1 gruppo separato. I gruppi con un ritaglio, una maschera o un filtro restano interi.");
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
  const shown = (): string[] => [...bar().querySelectorAll("button:not([hidden])")].map((control) => control.getAttribute("aria-label")!);
  const layer = (): HTMLElement => host.querySelector<HTMLElement>(".draw-link-layer")!;
  const marks = (): HTMLButtonElement[] => [...layer().querySelectorAll<HTMLButtonElement>(".draw-link-mark")];

  it("Ctrl+K mette gli oggetti scelti in un collegamento alla nota che si sceglie, al posto del più alto", async () => {
    const links = stub();
    mount(ROW, { level: "standard", links });
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
  const SNAP = { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } as const;
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
    expect(editor.grid).toEqual({ shown: true, snap: true, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(grids).toEqual([
      { shown: true, snap: false, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: false, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE },
      { shown: true, snap: true, step: 50, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE },
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
    mount(SOURCE, { level: "standard", grid: { shown: true, snap: false, step: 0, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE }, onGridChange: (grid) => grids.push(grid) });
    expect(editor.grid).toEqual({ shown: true, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    editor.setGrid({ shown: true, snap: true, step: 25, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    editor.setGrid({ shown: false, snap: true, step: 5000, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 25, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
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
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(key("#", { ctrlKey: true }).defaultPrevented).toBe(false);
    editor.setLevel("essential");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
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

  it("«?» elenca i tasti della griglia, e le frecce dicono dove vanno con l'aggancio", async () => {
    mount(SOURCE, { level: "standard" });
    const rows = (): (string | null)[][] => [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Griglia");
    expect(rows()).toContainEqual(["#", "Mostra o nasconde la griglia"]);
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
    expect(layer.texts()).toEqual([]);
    expect(transformOf(A)).toBe("matrix(1 0 0 1 280 -200)");
    expect(spoken()).toBe("1 oggetto spostato. Agganciato: a distanze uguali in orizzontale, 60; il bordo superiore in linea con quello di Rettangolo, Verde.");
  });

  it("con la griglia vince il più vicino fra la riga e il bersaglio", () => {
    mount(APART, { level: "standard", grid: { shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } });
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

  it("modificando i nodi, il nodo trascinato si ferma in linea con gli altri nodi del tracciato", () => {
    const P = "op3p3p3p3";
    mount(wide(`${LAYER}<path id="${P}" d="M10 10 L150 10 L150 150" fill="none" stroke="#000000" stroke-width="2"/></g>`), { level: "expert" });
    editor.select([P]);
    editor.focus();
    key("n");
    drag([[150, 150], [100, 150], [13, 153]]);
    expect(editor.engine.text).toContain('d="M10 10 L150 10 L10 153"');
    expect(spoken()).toBe("Nodo spostato: x 10, y 153. Agganciato: il punto in linea con un nodo.");
  });

  it("con la penna di Bézier, il nodo nuovo si ferma in linea con quelli già posati e con la pagina", () => {
    mount(doc(`<title>Prova</title>${LAYER}</g>`), { level: "expert" });
    editor.focus();
    key("b");
    drag([[10, 10]]);
    expect(spoken()).toBe("Nodo 1, spigolo: x 10, y 10.");
    drag([[52, 12]]);
    expect(spoken()).toBe("Nodo 2, spigolo: x 50, y 10. Agganciato: il punto in linea con il centro orizzontale della pagina; il punto in linea con un nodo.");
    drag([[73, 12]], { ctrlKey: true });
    expect(spoken()).toBe("Nodo 3, spigolo: x 73, y 12.");
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
    expect(editor.grid).toEqual({ shown: false, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    expect(grids).toEqual([{ shown: false, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE }]);
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
    expect(layer.texts()).toEqual(["140", "120"]);
    // Fuori dagli oggetti, dalla pagina.
    hover(300, 300, { altKey: true });
    layer.frame();
    expect(layer.texts()).toEqual(["20", "340", "200", "160"]);
    // Lasciato Alt, le misure se ne vanno.
    surface().dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    layer.frame();
    expect(layer.texts()).toEqual([]);
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
    withRulers(sheet(), { grid: { shown: false, snap: true, step: 20, guides: true, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } });
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
    // Lontano dalle guide, la penna ha il suo menu radiale.
    expect(rightClick(300, 280).defaultPrevented).toBe(true);
    expect(document.querySelector(".context-menu")).toBeNull();
    expect(document.querySelector(".draw-radial")).not.toBeNull();
    closeRadial();

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
      ["|", "Mostra o nasconde le guide"],
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
  /// Mette `value` nel campo, come il browser che lo cambia da sé.
  const type = (value: string): void => {
    input().textContent = value;
    input().dispatchEvent(new Event("input", { bubbles: true }));
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
    expect(input().style.fontFamily).toBe("Inter, sans-serif");
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
    mount(doc(`<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="60" y="60" width="20" height="20" fill="#000000"/>${TEXT.slice(TEXT.indexOf("<text"), TEXT.indexOf("</g>"))}</g>`), { level: "standard" });
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
    // Su un oggetto che non è un testo, F2 apre il suo nome nell'albero.
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
    mount(EMPTY, { level: "standard", grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } });
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

  it("«?» elenca i tasti del testo", () => {
    mount(SOURCE, { level: "standard" });
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Testo");
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Space", "Con lo strumento Testo: scrive dov’è il cursore, o cambia il testo che c’è"]);
    expect(rows).toContainEqual(["F2", "Modifica il testo scelto"]);
    expect(rows).toContainEqual(["Enter", "Va a capo, mentre si scrive"]);
    expect(rows).toContainEqual(["Esc o Tab o Ctrl+Enter", "Conclude il testo, mentre si scrive"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il testo in area e su tracciato, dal livello Esperto", () => {
  /// Un testo in area di corpo 20, largo 120: dieci grafemi per riga.
  const A = "oa2a2a2a2";
  const AREA = doc(
    `<title>Prova</title>${LAYER}<text id="${A}" fub:wrap="120" x="10" y="40" font-size="20">` +
      `<tspan x="10" dy="0">Il testo</tspan><tspan fub:join="space" x="10" dy="25">in area</tspan></text></g>`,
  );
  /// Un testo di corpo 20 sul tracciato orizzontale da (0, 100) a (200, 100).
  const P = "op3p3p3p3";
  const ALONG = doc(
    `<title>Prova</title><defs id="fub-defs"><path id="r1" fub:role="private" d="M 0 100 L 200 100"/></defs>${LAYER}` +
      `<text id="${P}" font-size="20"><textPath startOffset="20" href="#r1">Sul colle</textPath></text></g>`,
  );
  const EMPTY = doc(`<title>Prova</title>${LAYER}</g>`);

  const input = (): HTMLElement => host.querySelector<HTMLElement>(".draw-text-input")!;
  const shown = (): string => [...input().querySelectorAll<HTMLElement>(".draw-text-line")].map((row) => row.textContent).join("\n");
  const tap = (x: number, y: number): void => drag([[x, y]]);
  const type = (value: string): void => {
    input().textContent = value;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  };
  /// Le righe del testo `id`, ciascuna col suo `fub:join`.
  const lines = (id: string): Array<[string, string | null]> => {
    const text = new RegExp(`<text id="${id}"[^>]*>([\\s\\S]*?)</text>`).exec(editor.engine.text)?.[1] ?? "";
    return [...text.matchAll(/<tspan([^>]*)>([^<]*)<\/tspan>/g)].map((match) => [match[2]!, /fub:join="([^"]*)"/.exec(match[1]!)?.[1] ?? null]);
  };

  it("trascinare col Testo apre un testo in area largo quanto il trascinamento, che va a capo da sé", () => {
    mount(EMPTY, { level: "expert" });
    editor.setTool("text");
    drag([[20, 40], [70, 60], [120, 60]]);
    expect(document.activeElement).toBe(input());
    // Il riquadro è largo 100: col corpo 32 dello strumento, cinque grafemi.
    expect(input().style.width).toBe("100px");
    type("Il testo in area va a capo");
    expect(shown()).toBe("Il\ntesto\nin\narea\nva a\ncapo");
    key("Escape", {}, input());
    expect(changes).toHaveLength(1);
    const [id] = editor.selection;
    expect(editor.engine.text).toMatch(new RegExp(`<text id="${id}" fub:wrap="100" x="20" `));
    expect(lines(id!)).toEqual([
      ["Il", null],
      ["testo", "space"],
      ["in", "space"],
      ["area", "space"],
      ["va a", "space"],
      ["capo", "space"],
    ]);
    key("z", { ctrlKey: true });
    expect(editor.engine.text).not.toContain("<text");
  });

  it("al livello Standard trascinare col Testo scrive dove comincia, senza riquadro", () => {
    mount(EMPTY, { level: "standard" });
    editor.setTool("text");
    drag([[20, 40], [70, 60], [120, 60]]);
    expect(input().style.width).not.toBe("100px");
    type("Il testo in area");
    key("Escape", {}, input());
    expect(editor.engine.text).not.toContain("fub:wrap");
  });

  it("un testo in area si riapre nel suo riquadro, e scrivere rifà gli a capo con l'operazione text", () => {
    mount(AREA, { level: "expert" });
    editor.setTool("text");
    tap(20, 35);
    expect(shown()).toBe("Il testo\nin area");
    expect(input().style.width).toBe("120px");
    type("Il testo in area va a capo");
    expect(shown()).toBe("Il testo\nin area va\na capo");
    key("Tab", {}, input());
    expect(lines(A)).toEqual([
      ["Il testo", null],
      ["in area va", "space"],
      ["a capo", "space"],
    ]);
    expect(editor.engine.text).toContain('<tspan fub:join="space" x="10" dy="25">a capo</tspan>');
    expect(spoken()).toBe("Testo modificato.");
    // Un paragrafo nuovo non continua quello prima.
    tap(20, 35);
    type("Uno\nDue");
    key("Tab", {}, input());
    expect(lines(A)).toEqual([
      ["Uno", null],
      ["Due", null],
    ]);
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(lines(A)).toEqual([
      ["Il testo", null],
      ["in area", "space"],
    ]);
  });

  it("un testo su tracciato si apre su una riga sola, dritto dove comincia, e si scrive nel suo textPath", () => {
    mount(ALONG, { level: "expert" });
    editor.setTool("text");
    tap(40, 95);
    expect(document.activeElement).toBe(input());
    expect(shown()).toBe("Sul colle");
    expect(input().getAttribute("aria-multiline")).toBe("false");
    expect(input().style.transform).toMatch(/translate\(20px, 100px\) rotate\(0deg\)/);
    type("Sul colle alto");
    key("Escape", {}, input());
    expect(editor.engine.text).toContain('<textPath startOffset="20" href="#r1">Sul colle alto</textPath>');
    expect(editor.selection).toEqual([P]);
  });
});

describe("la cornice di un testo in area", () => {
  const T = "ot1t1t1t1";
  // Corpo 10, a stima: dieci caratteri per riga. Il riquadro va da 20 a 80,
  // e le righe da 32 a 55; la cornice sta quattro pixel fuori.
  const AREA = doc(`${LAYER}<text id="${T}" fub:wrap="60" x="20" y="40" font-size="10"><tspan x="20" dy="0">Il testo</tspan><tspan fub:join="space" x="20" dy="12.5">va a capo</tspan></text></g>`);
  const press = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  };
  const move = (x: number, y: number, buttons = 1): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons, pressure: 0.5, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  };
  const release = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
  };
  const painted = (): Element => host.querySelector(`[data-scene-id="${T}"]`)!;

  it("cambia la larghezza del riquadro e non il corpo: il testo va di nuovo a capo mentre la si tira", () => {
    mount(AREA, { level: "expert" });
    editor.setTool("select");
    editor.select([T]);
    // L'angolo in basso a destra tira in orizzontale.
    move(84, 59, 0);
    expect(surface().dataset.grip).toBe("ew");
    press(84, 59);
    move(104, 70);
    move(124, 80);
    // L'anteprima mostra le righe di dopo; il file non cambia ancora.
    expect([...painted().nextElementSibling!.querySelectorAll("tspan")].map((line) => line.textContent)).toEqual(["Il testo va a", "capo"]);
    expect(editor.engine.text).toBe(AREA);
    release(124, 80);
    expect(editor.engine.text).toContain('fub:wrap="100" x="20" y="40" font-size="10"');
    expect(editor.engine.text).toMatch(/<tspan x="20" dy="0">Il testo va a<\/tspan>\s*<tspan fub:join="space" x="20" dy="12.5">capo<\/tspan>/);
    expect(spoken()).toBe("Riquadro largo 100.");
    expect(changes).toHaveLength(1);
    expect(painted().nextElementSibling).toBeNull();
    editor.undo();
    expect(spoken()).toBe("Annullato: Larghezza del riquadro.");
    expect(editor.engine.text).toBe(AREA);
  });

  it("da sinistra resta fermo il bordo destro; in alto e in basso non ci sono maniglie", () => {
    mount(AREA, { level: "expert" });
    editor.setTool("select");
    editor.select([T]);
    move(50, 28, 0);
    expect(surface().dataset.grip).toBeUndefined();
    press(16, 59);
    move(-24, 59);
    release(-24, 59);
    expect(editor.engine.text).toContain('fub:wrap="100" x="-20"');
    expect(editor.engine.text).toContain('<tspan x="-20" dy="0">Il testo va a</tspan>');
  });

  it("sotto Esperto la cornice scala il testo come ogni oggetto", () => {
    mount(AREA, { level: "standard" });
    editor.setTool("select");
    editor.select([T]);
    move(50, 28, 0);
    expect(surface().dataset.grip).toBe("ns");
  });
});

describe("il testo su tracciato, dal menu", () => {
  const T = "ot4t4t4t4";
  const R = "or4r4r4r4";
  const PAIR = doc(
    `<title>Prova</title>${LAYER}<text id="${T}" x="20" y="40" font-size="10"><tspan x="20" dy="0">Sul colle</tspan></text>` +
      `<rect id="${R}" x="0" y="50" width="200" height="40" fill="none" stroke="#000000"/></g>`,
  );

  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const button = (): HTMLButtonElement => bar().querySelector<HTMLButtonElement>('button[aria-label="Testo su tracciato"]')!;
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  /// Le voci, col nome, se sono spente e che cosa dicono.
  const entries = (): (string | boolean | null)[][] =>
    menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled") === "true", entry.querySelector(".menu-description")?.textContent ?? null]);
  const closeMenus = (): void => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  };
  /// La voce `label` del menu, sugli oggetti `keys`.
  const run = (keys: string[], label: string): void => {
    editor.select(keys);
    button().click();
    menu().find((entry) => labelOf(entry) === label)!.click();
    closeMenus();
  };

  afterEach(closeMenus);

  it("c'è dall'Esperto con un testo scelto; le voci dicono perché sono spente", () => {
    mount(PAIR, { level: "standard" });
    editor.select([T, R]);
    expect(button().hidden).toBe(true);
    editor.setLevel("expert");
    expect(button().hidden).toBe(false);
    expect(button().getAttribute("aria-haspopup")).toBe("menu");
    editor.select([R]);
    expect(button().hidden).toBe(true);
    editor.select([T]);
    button().click();
    expect(entries()).toEqual([
      ["Metti sul tracciato", true, "Scegli un testo e la forma che deve seguire, e nient’altro."],
      ["Togli dal tracciato", true, "Fra gli oggetti scelti non c’è un testo su tracciato."],
      ["Rovescia sul tracciato", true, "Fra gli oggetti scelti non c’è un testo su tracciato."],
    ]);
  });

  it("mette il testo sul rettangolo, lo rovescia e lo toglie, un passo di annulla ciascuno", () => {
    mount(PAIR, { level: "expert" });
    run([T, R], "Metti sul tracciato");
    expect(spoken()).toBe("Il testo segue il tracciato.");
    expect(editor.selection).toEqual([T]);
    expect(editor.engine.text).not.toContain(R);
    const href = /<textPath startOffset="20" href="#(r[a-z0-9]{8})">Sul colle<\/textPath>/.exec(editor.engine.text)![1]!;
    expect(editor.engine.text).toContain(`<path id="${href}" fub:role="private" d="M0 50 L200 50 L200 90 L0 90 Z"/>`);
    run([T], "Rovescia sul tracciato");
    expect(spoken()).toBe("1 testo è passato dall’altra parte del tracciato.");
    expect(editor.engine.text).toContain(`d="M0 50 L0 90 L200 90 L200 50 L0 50 Z"`);
    run([T], "Togli dal tracciato");
    expect(spoken()).toBe("1 testo è tornato una riga dritta.");
    expect(editor.engine.text).toMatch(new RegExp(`<text id="${T}" x="[0-9.]+" y="[0-9.]+" font-size="10">`));
    expect(editor.engine.text).not.toContain("<textPath");
    expect(changes).toHaveLength(3);
    for (let i = 0; i < 3; i++) editor.undo();
    expect(editor.engine.text).toBe(PAIR);
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
    // Il grassetto di una parola rende misti il peso e lo stile.
    expect(property("preset").querySelector("select")!.value).toBe("");
    expect(property("weight").querySelector("select")!.value).toBe("");
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("mixed");
    expect(toggle("Corsivo").getAttribute("aria-pressed")).toBe("false");
    expect(propertyInput("leading").value).toBe("125");
    expect(propertyInput("spacing").value).toBe("0");
    toggle("Grassetto").click();
    expect(opening()).toContain('font-size="32" font-weight="bold">');
    expect(editor.engine.text).toContain('<tspan x="10" dy="40">Due tre</tspan>');
    expect(toggle("Grassetto").getAttribute("aria-pressed")).toBe("true");
    choose("preset", "title");
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
      "Annullato: Stile del testo.",
      "Annullato: Grassetto.",
    ]);
    expect(editor.engine.text).toBe(TEXT);
  });

  it("il testo in area: la larghezza del riquadro lo manda di nuovo a capo, e il tipo lo fa da punto", () => {
    const T = "ot1t1t1t1";
    // Corpo 10, a stima: dieci caratteri per riga.
    const AREA = doc(`${LAYER}<text id="${T}" fub:wrap="60" x="20" y="40" font-size="10"><tspan x="20" dy="0">Il testo</tspan><tspan fub:join="space" x="20" dy="12.5">va a capo</tspan></text></g>`);
    mount(AREA, { level: "expert" });
    editor.select([T]);
    key("Enter");
    const segment = (label: string): HTMLButtonElement => property("textForm").querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(propertyInput("wrap").value).toBe("60");
    expect(segment("In area").getAttribute("aria-pressed")).toBe("true");
    enter(propertyInput("wrap"), "100");
    expect(editor.engine.text).toContain('<tspan x="20" dy="0">Il testo va a</tspan>');
    segment("Da punto").click();
    expect(editor.engine.text).toMatch(/<text id="ot1t1t1t1" x="20" y="40" font-size="10">\s*<tspan x="20" dy="0">Il testo va a<\/tspan>\s*<tspan x="20" dy="12.5">capo<\/tspan>/);
    // Da punto non ha riquadro.
    expect(property("wrap").hidden).toBe(true);
    const undone = [1, 2].map(() => {
      editor.undo();
      return spoken();
    });
    expect(undone).toEqual(["Annullato: Tipo di testo.", "Annullato: Larghezza del riquadro."]);
    expect(editor.engine.text).toBe(AREA);
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
    expect(rows).toContainEqual(["Ctrl+Shift+Z o Ctrl+Y", "Ripeti"]);
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
      "Poligono · dal livello Standard",
      "Forme dal tratto · dal livello Standard",
      "Testo · dal livello Standard",
      "Tavole · dal livello Standard",
      "Griglia · dal livello Standard",
      "Guide intelligenti · dal livello Standard",
      "Righelli e guide · dal livello Standard",
      "Proprietà · dal livello Standard",
      "Vista · dal livello Standard",
      "Modifica · dal livello Standard",
      "Elenco delle tavole · dal livello Standard",
      "Cronologia · dal livello Standard",
      "Accessibilità · dal livello Standard",
      "Strumenti · dal livello Esperto",
      "Disponi · dal livello Esperto",
      "Tracciato · dal livello Esperto",
      "Nodi · dal livello Esperto",
      "Costruttore di forme · dal livello Esperto",
      "Forbici · dal livello Esperto",
      "Spessore · dal livello Esperto",
      "Bézier · dal livello Esperto",
      "Curvatura · dal livello Esperto",
      "Attributi · dal livello Esperto",
    ]);
    // Solo ciò che manca: i sette strumenti dell'Essenziale non si ripetono.
    expect(tables[0]!.rows).toEqual([["Q", "Lazo"], ["F", "Tavola"], ["H", "Evidenziatore"], ["Y", "Poligono"], ["T", "Testo"]]);
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
    expect(tables[4]!.rows).toContainEqual(["Y", "Di nuovo, dal poligono alla stella e ritorno"]);
    expect(tables[5]!.rows).toEqual([["Shift", "Tenuto, la forma dal tratto resta regolare"]]);
    // Le tavole, tutte dallo Standard: i passi fra loro valgono con ogni
    // strumento, il resto con lo strumento Tavola.
    expect(tables[7]!.rows).toEqual([
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
    expect(tables[8]!.rows).toContainEqual(["#", "Mostra o nasconde la griglia"]);
    expect(tables[9]!.rows).toEqual([
      ["Ctrl", "Tenuto mentre si trascina: posa libero, senza agganciarsi agli altri oggetti"],
      ["Alt", "Tenuto con una selezione: le distanze dall’oggetto sotto il puntatore, o dalla pagina"],
    ]);
    // Lo zoom c'è già; la vista girata e il menu radiale, dallo Standard.
    expect(tables[12]!.rows).toEqual([
      ["4", "Ruota la vista a sinistra"],
      ["6", "Ruota la vista a destra"],
      ["5", "Raddrizza la vista"],
      ["Shift+F10", "Apre il menu radiale: strumenti, colori, annulla"],
    ]);
    // Copiare e incollare ci sono già; lo stile, dallo Standard.
    expect(tables[13]!.rows).toEqual([
      ["Ctrl+Alt+C", "Copia lo stile"],
      ["Ctrl+Alt+V", "Incolla lo stile"],
    ]);
    // L'elenco delle tavole e la cronologia, tutti dallo Standard.
    expect(tables[14]!.rows).toEqual([
      ["↑ o ↓ o Home o End", "Nell’elenco delle tavole, la tavola prima o dopo, la prima o l’ultima"],
      ["Enter o Space", "Nell’elenco delle tavole, porta alla tavola"],
      ["F2", "Nell’elenco delle tavole, cambia il nome della tavola"],
      ["Ctrl+D", "Nell’elenco delle tavole, duplica la tavola col suo contenuto"],
      ["Alt+↑ o Alt+↓", "Nell’elenco delle tavole, sposta la tavola prima o dopo la sua vicina"],
      ["Del", "Nell’elenco delle tavole, elimina la tavola"],
      ["Shift+F10", "Nell’elenco delle tavole, apre il menu della tavola"],
      ["Esc", "Dall’elenco delle tavole torna al foglio"],
    ]);
    expect(tables[15]!.rows.map(([keys]) => keys)).toEqual(["Enter o Space", "F2", "Del", "Esc"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");

    // Ciò che è elencato non si può fare: il livello resta l'Essenziale.
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    key("h");
    expect(editor.tool).toBe("pen");
    expect(editor.level).toBe("essential");
    key("#");
    expect(editor.grid.shown).toBe(false);
  });

  it("dallo Standard «Mostra tutto» aggiunge i tasti dell'Esperto; dall'Esperto non c'è", async () => {
    mount(SOURCE, { level: "standard" });
    key("?", { shiftKey: true });
    dialog().querySelector<HTMLButtonElement>(".keys-show-all")!.click();
    const extra = dialog().querySelector<HTMLElement>(".keys-more")!;
    const tables = [...extra.querySelectorAll("table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]),
    }));
    expect(tables).toEqual([
      { caption: "Strumenti · dal livello Esperto", rows: [["N", "Nodi"], ["M", "Costruttore di forme"], ["C", "Forbici"], ["W", "Spessore"], ["B", "Bézier"]] },
      { caption: "Disponi · dal livello Esperto", rows: [["Ctrl+Shift+M", "Trasforma…"]] },
      { caption: "Tracciato · dal livello Esperto", rows: [["Ctrl+J", "Unisce i capi più vicini dei tracciati aperti scelti; un tracciato solo si chiude"]] },
      {
        caption: "Nodi · dal livello Esperto",
        rows: [
          ["←↑→↓", "Sposta i nodi scelti di 1, con Maiusc di 10, con Ctrl o ⌘ di un pixel"],
          ["Tab o Shift+Tab", "Il nodo dopo o prima"],
          ["Home o End", "Il primo o l’ultimo nodo"],
          ["Ctrl+A", "Sceglie tutti i nodi"],
          ["Enter", "Posizione dei nodi"],
          ["Insert", "Aggiungi nodi"],
          ["Del", "Elimina nodi"],
          ["Shift+C", "Nodi a spigolo"],
          ["Shift+S", "Nodi lisci"],
          ["Shift+Y", "Nodi simmetrici"],
          ["Shift+L", "Segmenti in linee"],
          ["Shift+U", "Segmenti in curve"],
          ["Shift+B", "Spezza ai nodi"],
          ["Shift+J o Ctrl+J", "Unisci i capi"],
          ["Alt", "Tenuto, un nodo trascinato tira fuori le sue maniglie, e una maniglia trascinata si sposta da sola"],
          ["Esc", "Toglie la scelta dei nodi, poi quella dell’oggetto"],
          ["Alt+F10", "Va alla barra dei nodi"],
        ],
      },
      {
        caption: "Costruttore di forme · dal livello Esperto",
        rows: [
          ["Tab o Shift+Tab", "La regione dopo o prima"],
          ["Home o End", "La prima o l’ultima regione"],
          ["Space", "Sceglie la regione, o la lascia"],
          ["Enter", "Unisce le regioni scelte; senza, separa quella a cui si è"],
          ["Del", "Toglie le regioni scelte, o quella a cui si è"],
          ["Alt", "Tenuto, il trascinamento e il tocco tolgono le regioni invece di unirle"],
          ["Shift", "Tenuto, il tocco e il riquadro scelgono le forme invece delle regioni"],
          ["Esc", "Lascia le regioni scelte, poi la selezione"],
        ],
      },
      {
        caption: "Forbici · dal livello Esperto",
        rows: [
          ["Space", "Taglia dove è il cursore: Spazio e di nuovo Spazio. Spazio, le frecce e Spazio tirano il Coltello"],
          ["Alt", "Tenuto, il Coltello taglia dritto"],
        ],
      },
      {
        caption: "Spessore · dal livello Esperto",
        rows: [
          ["Space", "Allarga o stringe dove è il cursore: Spazio, le frecce e Spazio. Su un punto in mezzo, lo sposta"],
          ["Alt", "Tenuto, cambia soltanto il lato che si tira"],
          ["Del", "Toglie il punto dello spessore scelto"],
          ["Enter", "Apre le misure del punto scelto"],
          ["Esc", "Lascia il punto scelto"],
        ],
      },
      {
        caption: "Bézier · dal livello Esperto",
        rows: [
          ["Space", "Un nodo dove è il cursore: Spazio e di nuovo Spazio per uno spigolo, o in mezzo le frecce per tirarne le maniglie"],
          ["Shift", "Tenuto, porta il nodo o la maniglia a passi di 15°"],
          ["Enter o Esc", "Conclude il tracciato"],
          ["Del", "Elimina l’ultimo nodo"],
        ],
      },
      {
        caption: "Curvatura · dal livello Esperto",
        rows: [
          ["B", "Premuto di nuovo, passa dalla penna alla Curvatura e ritorno"],
          ["Space", "Un punto liscio dove è il cursore: Spazio e di nuovo Spazio. Su un punto in mezzo lo fa liscio o spigolo"],
          ["Shift+C", "Il punto sotto il cursore, o l’ultimo, diventa uno spigolo"],
          ["Shift+S", "Il punto sotto il cursore, o l’ultimo, diventa liscio"],
          ["Alt", "Tenuto mentre si tocca, il punto nuovo è uno spigolo"],
        ],
      },
      {
        caption: "Attributi · dal livello Esperto",
        rows: [
          ["Ctrl+Shift+X", "Va agli attributi, nel pannello delle proprietà"],
          ["Enter", "Applica il valore scritto"],
          ["Shift+Enter", "Va a capo, nei punti e nei percorsi"],
          ["Esc", "Riporta il valore com’era; di nuovo, torna al foglio"],
        ],
      },
    ]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
    // Dallo Standard il tasto non apre niente.
    editor.select(["o1a2b3c4d"]);
    key("X", { ctrlKey: true, shiftKey: true });
    expect(host.querySelector<HTMLElement>(".draw-inspector")!.hidden).toBe(true);

    editor.setLevel("expert");
    // L'elenco di prima si chiude con la sua risposta.
    await new Promise((resolve) => setTimeout(resolve, 0));
    key("?", { shiftKey: true });
    expect(dialog().querySelector(".keys-show-all")).toBeNull();
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toContain("Attributi");
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
    selecting(ONE, [A], { level: "standard", grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } });
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
    mount(NAMED, { level: "standard" });
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
    expect(spoken()).toBe("Scegli un gruppo solo, o un collegamento, per isolarlo.");
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
    // Con la penna il tasto destro apre il menu radiale, e la selezione resta.
    editor.setTool("pen");
    expect(rightClick(60, 20).defaultPrevented).toBe(true);
    expect(document.querySelector(".draw-radial")).not.toBeNull();
    expect(editor.selection).toEqual([A, B]);
    closeRadial();
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

describe("gli attributi, dal livello Esperto", () => {
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Attributi"]')!;
  const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-inspector")!;
  const dock = (): HTMLElement => host.querySelector<HTMLElement>(".draw-dock")!;
  const row = (name: string): HTMLTableRowElement => panel().querySelector<HTMLTableRowElement>(`tr[data-key="${name}"]`)!;
  const control = (name: string): HTMLInputElement => row(name).querySelector<HTMLInputElement>(".draw-inspector-input")!;
  const keysOf = (): string[] => [...panel().querySelectorAll<HTMLTableRowElement>("tbody tr")].map((tr) => tr.dataset.key!);

  const write = typeIn;
  /// Gli attributi senza il pannello delle proprietà, in un livello
  /// Personalizzato: un pannello da sé, accanto al foglio.
  const ALONE = ["pen", "attributes"];

  /// Il fuoco agli attributi, come lo porta il tasto.
  const open = (): void => {
    key("X", { ctrlKey: true, shiftKey: true });
  };

  it("dall'Esperto sono una sezione del pannello delle proprietà, e il tasto ci porta e ne torna", () => {
    mount(SOURCE, { level: "standard" });
    editor.setLevel("expert");
    expect(button().hidden).toBe(true);
    expect(properties().contains(panel())).toBe(true);
    expect(panel().hidden).toBe(false);
    expect(panel().hasAttribute("aria-labelledby")).toBe(false);
    // Senza un oggetto solo, il tasto dice perché non ci porta.
    open();
    expect(spoken()).toBe("Scegli un oggetto per vederne gli attributi.");
    expect(properties().hidden).toBe(true);
    editor.select(["o1a2b3c4d"]);
    open();
    expect(properties().hidden).toBe(false);
    expect(properties().querySelector<HTMLElement>('[data-section="attributes"]')!.hidden).toBe(false);
    expect(keysOf()).toEqual(["id", "x", "y", "width", "height", "fill", "stroke", "stroke-width"]);
    expect(panel().contains(document.activeElement)).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Di nuovo, anche da un campo, il fuoco torna al foglio.
    key("X", { ctrlKey: true, shiftKey: true }, control("fill"));
    expect(document.activeElement).toBe(surface());
    // Scesi dall'Esperto, gli attributi escono dal pannello, chiusi.
    editor.setLevel("standard");
    expect(properties().contains(panel())).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(panel().getAttribute("aria-labelledby")).not.toBeNull();
  });

  it("senza il pannello delle proprietà il pulsante li apre accanto al foglio, e il fuoco ci va", () => {
    mount(SOURCE, { level: "custom", custom: ["pen"] });
    expect(button().hidden).toBe(true);
    editor.setLevel("custom", ALONE);
    expect(button().hidden).toBe(false);
    expect(button().title).toBe("Attributi (Ctrl+Shift+X)");
    expect(button().getAttribute("aria-keyshortcuts")).toBe("Control+Shift+X");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(dock().hidden).toBe(true);
    button().click();
    expect(panel().hidden).toBe(false);
    expect(dock().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(panel().querySelector(".draw-inspector-empty")!.textContent).toBe("Scegli un oggetto per vederne gli attributi.");
    expect(document.activeElement).toBe(panel());
    editor.select(["o1a2b3c4d"]);
    expect(panel().querySelector(".draw-inspector-subject")!.textContent).toBe("Rettangolo, Nero, elemento rect");
    expect(keysOf()).toEqual(["id", "x", "y", "width", "height", "fill", "stroke", "stroke-width"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Il tasto lo chiude, anche da un campo, e il fuoco torna al foglio.
    key("X", { ctrlKey: true, shiftKey: true }, control("fill"));
    expect(panel().hidden).toBe(true);
    expect(dock().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    key("X", { ctrlKey: true, shiftKey: true });
    expect(panel().hidden).toBe(false);
    expect(document.activeElement).toBe(control("id"));
    // Senza gli attributi, il pannello si chiude e il pulsante sparisce.
    editor.setLevel("custom", ["pen"]);
    expect(panel().hidden).toBe(true);
    expect(button().hidden).toBe(true);
  });

  it("l'albero e gli attributi stanno uno sotto l'altro", () => {
    mount(SOURCE, { level: "custom", custom: ALONE });
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    button().click();
    expect([...dock().children].filter((child) => !(child as HTMLElement).hidden).map((child) => child.className)).toEqual(["draw-objects", "draw-inspector"]);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    expect(dock().hidden).toBe(false);
    button().click();
    expect(dock().hidden).toBe(true);
  });

  it("un valore cambiato è un passo, che si annulla col suo nome", () => {
    mount(SOURCE, { level: "expert" });
    editor.select(["o1a2b3c4d"]);
    open();
    write(control("stroke-width"), "4");
    key("Enter", {}, control("stroke-width"));
    expect(editor.engine.text).toContain('stroke-width="4"');
    expect(changes).toHaveLength(1);
    expect(spoken()).toBe("stroke-width cambiato.");
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    // Annulla dal pulsante che toglie, fuori da un campo di testo.
    row("fill").querySelector<HTMLButtonElement>(".draw-inspector-remove")!.focus();
    key("z", { ctrlKey: true }, row("fill").querySelector<HTMLButtonElement>(".draw-inspector-remove")!);
    expect(editor.engine.text).toContain('stroke-width="2"');
    expect(spoken()).toBe("Annullato: Modifica di un attributo.");
    expect(control("stroke-width").value).toBe("2");
  });

  it("un oggetto senza id lo riceve, e resta scelto col campo che si stava usando", () => {
    mount(doc(`${LAYER}<rect x="0" y="0" width="20" height="20" fill="#000000"/></g>`), { level: "expert" });
    editor.select(["@0.0"]);
    open();
    expect(control("id").value).toBe("");
    // Un valore che non è partito, in un'altra riga, resta com'era scritto.
    write(control("x"), "dieci");
    key("Enter", {}, control("x"));
    write(control("fill"), "#e69f00");
    const field = control("fill");
    key("Enter", {}, field);
    expect(control("x").value).toBe("dieci");
    expect(control("x").getAttribute("aria-invalid")).toBe("true");
    expect(editor.engine.text).toMatch(/<rect id="(o[a-z0-9]{8})" x="0" y="0" width="20" height="20" fill="#e69f00"\/>/);
    const id = /<rect id="(o[a-z0-9]{8})"/.exec(editor.engine.text)![1]!;
    expect(editor.selection).toEqual([id]);
    expect(control("id").value).toBe(id);
    expect(control("fill")).toBe(field);
    expect(document.activeElement).toBe(field);
  });

  it("l'id si cambia, e resta scelto l'oggetto col nome nuovo", () => {
    mount(SOURCE, { level: "expert" });
    editor.select(["o1a2b3c4d"]);
    open();
    write(control("id"), "Quadrato");
    key("Enter", {}, control("id"));
    expect(editor.engine.text).toContain('<rect id="Quadrato"');
    expect(editor.selection).toEqual(["Quadrato"]);
    expect(spoken()).toBe("Ora l’id è «Quadrato».");
    editor.undo();
    expect(editor.engine.text).toContain('<rect id="o1a2b3c4d"');
    expect(spoken()).toBe("Annullato: Cambio dell’id.");
  });

  it("un id citato da una parte di un altro programma non si cambia", () => {
    const source = doc(
      `<defs><linearGradient id="sfumato"><stop offset="0" stop-color="#ffffff"/></linearGradient></defs>${LAYER}<rect id="o1a2b3c4d" x="0" y="0" width="20" height="20" fill="#000000"/></g><use href="#o1a2b3c4d" x="40"/>`,
    );
    mount(source, { level: "expert" });
    editor.select(["o1a2b3c4d"]);
    open();
    write(control("id"), "Quadrato");
    key("Enter", {}, control("id"));
    expect(editor.engine.text).toBe(source);
    expect(row("id").querySelector(".draw-inspector-error")!.textContent).toBe(
      "Una parte di un altro programma cita «o1a2b3c4d»: cambiarlo romperebbe il riferimento.",
    );
  });

  it("i tasti del foglio non partono dal pannello", () => {
    mount(SOURCE, { level: "expert" });
    editor.select(["o1a2b3c4d"]);
    open();
    write(control("fill"), "#00");
    for (const name of ["Delete", "Backspace", "?", "r", "#", "Escape"]) key(name, {}, control("fill"));
    expect(editor.engine.text).toContain("o1a2b3c4d");
    expect(editor.tool).toBe("pen");
    expect(editor.grid.shown).toBe(false);
    expect(document.querySelectorAll(".modale")).toHaveLength(0);
    // Esc ha riportato il valore; il secondo torna al foglio, con la selezione.
    expect(control("fill").value).toBe("none");
    key("Escape", {}, control("fill"));
    expect(document.activeElement).toBe(surface());
    expect(editor.selection).toEqual(["o1a2b3c4d"]);
    // In un campo, Ctrl+Z è del campo; Canc sul pulsante che toglie non
    // elimina l'oggetto.
    key("z", { ctrlKey: true }, control("fill"));
    const remove = row("stroke").querySelector<HTMLButtonElement>(".draw-inspector-remove")!;
    key("Delete", {}, remove);
    expect(changes).toEqual([]);
  });

  it("un documento in sola lettura si legge e non si scrive, e torna a scriversi dal vivo", () => {
    mount(SOURCE, { level: "expert" });
    editor.select(["o1a2b3c4d"]);
    open();
    editor.setReadOnly(true);
    expect(control("fill").readOnly).toBe(true);
    expect(panel().querySelector<HTMLElement>(".draw-inspector-add")!.hidden).toBe(true);
    editor.setReadOnly(false);
    expect(control("fill").readOnly).toBe(false);
    expect(panel().querySelector<HTMLElement>(".draw-inspector-add")!.hidden).toBe(false);
  });
});

describe("il contorno, dal livello Esperto", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";
  const RECT_A = `<rect id="${A}" x="10" y="10" width="20" height="10" fill="none" stroke="#000000" stroke-width="2"/>`;
  const LINE_B = `<line id="${B}" x1="0" y1="50" x2="50" y2="50" stroke="#0072b2" stroke-width="4" stroke-linecap="round"/>`;
  const FILLED_C = `<rect id="${C}" x="60" y="60" width="10" height="10" fill="#000000"/>`;
  const SHAPES = doc(`${LAYER}${RECT_A}${LINE_B}${FILLED_C}</g>`);

  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const outline = (): HTMLButtonElement => bar().querySelector<HTMLButtonElement>('button[aria-label="Contorno"]')!;
  /// Le voci del menu aperto per ultimo, scelte comprese.
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
  const closeMenus = (): void => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  };

  afterEach(closeMenus);

  it("c'è solo all'Esperto, nella barra della selezione, e il menu segna il contorno che gli oggetti scelti hanno tutti", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A]);
    expect(bar().hidden).toBe(false);
    expect(outline().hidden).toBe(true);
    editor.setLevel("expert");
    expect(outline().hidden).toBe(false);
    expect(outline().getAttribute("aria-haspopup")).toBe("menu");
    outline().click();
    expect(outline().getAttribute("aria-expanded")).toBe("true");
    expect(menu().map((entry) => [labelOf(entry), entry.getAttribute("role"), entry.getAttribute("aria-checked")])).toEqual([
      ["Continuo", "menuitemradio", "true"],
      ["Tratteggiato", "menuitemradio", "false"],
      ["Punteggiato", "menuitemradio", "false"],
      ["Tratto e punto", "menuitemradio", "false"],
      ["Estremi piatti", "menuitemradio", "true"],
      ["Estremi arrotondati", "menuitemradio", "false"],
      ["Estremi quadrati", "menuitemradio", "false"],
      ["Angoli vivi", "menuitemradio", "true"],
      ["Angoli arrotondati", "menuitemradio", "false"],
      ["Angoli smussati", "menuitemradio", "false"],
      ["Uniforme", "menuitemradio", "true"],
      ["Affusolato", "menuitemradio", "false"],
      ["A goccia", "menuitemradio", "false"],
      ["A fuso", "menuitemradio", "false"],
      ["Rovescia lungo la linea", "menuitem", null],
      ["Scambia i lati", "menuitem", null],
    ]);
    // Un contorno uniforme non si rovescia.
    expect(item("Rovescia lungo la linea").getAttribute("aria-disabled")).toBe("true");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    closeMenus();
    // Estremi diversi: nessuno è segnato. Il rettangolo pieno non ha contorno
    // e non conta.
    editor.select([A, B, C]);
    outline().click();
    expect(menu().filter((entry) => entry.getAttribute("aria-checked") === "true").map(labelOf)).toEqual(["Continuo", "Angoli vivi", "Uniforme"]);
    closeMenus();
    editor.setLevel("standard");
    expect(outline().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("una scelta cambia ogni contorno scelto, col suo spessore e i suoi estremi, in un passo che si annulla", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A, B, C]);
    outline().click();
    item("Tratteggiato").click();
    expect(editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="none" stroke="#000000" stroke-width="2" stroke-dasharray="8 6"/>`);
    // Con gli estremi arrotondati il trattino si accorcia di uno spessore, e
    // si vede lungo uguale.
    expect(editor.engine.text).toContain(`stroke-width="4" stroke-linecap="round" stroke-dasharray="12 16"/>`);
    expect(editor.engine.text).toContain(FILLED_C);
    expect(spoken()).toBe("Tratteggiato: 2 contorni.");
    expect(editor.selection).toEqual([A, B, C]);
    expect(changes).toHaveLength(1);

    outline().click();
    expect(item("Tratteggiato").getAttribute("aria-checked")).toBe("true");
    item("Angoli arrotondati").click();
    expect(editor.engine.text).toContain('stroke-linejoin="round"');
    expect(changes).toHaveLength(2);

    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(SHAPES);
  });

  it("un profilo fa del contorno una linea a spessore variabile, e uniforme la riporta, in passi che si annullano", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([B]);
    outline().click();
    item("Affusolato").click();
    expect(editor.engine.text).toContain(`<path id="${B}" fub:shape="width" fub:geom="round miter 0 2 2 1 0 0 M0 50 L50 50" d="`);
    expect(spoken()).toBe("Affusolato: un contorno.");
    expect(editor.selection).toEqual([B]);
    outline().click();
    // Il menu la segna, e non le offre il tratteggio.
    expect(menu().filter((entry) => entry.getAttribute("aria-checked") === "true").map(labelOf)).toEqual(["Estremi arrotondati", "Angoli vivi", "Affusolato"]);
    expect(item("Continuo").getAttribute("aria-disabled")).toBe("true");
    expect(item("Estremi piatti").getAttribute("aria-disabled")).toBeNull();
    item("Rovescia lungo la linea").click();
    expect(editor.engine.text).toContain('fub:geom="round miter 0 0 0 1 2 2 M0 50 L50 50"');
    expect(spoken()).toBe("Rovescia lungo la linea: un contorno.");
    outline().click();
    item("Estremi piatti").click();
    expect(editor.engine.text).toContain('fub:geom="butt miter 0 0 0 1 2 2 M0 50 L50 50"');
    outline().click();
    item("Uniforme").click();
    expect(editor.engine.text).toContain(`<path id="${B}" d="M0 50 L50 50" fill="none" stroke="#0072b2" stroke-width="4"/>`);
    expect(changes).toHaveLength(4);
    for (let i = 0; i < 4; i++) key("z", { ctrlKey: true });
    expect(editor.engine.text).toBe(SHAPES);
  });

  it("senza contorni fra gli oggetti scelti le voci sono spente, e dicono perché", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([C]);
    outline().click();
    expect(menu().every((entry) => entry.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(item("Continuo").querySelector(".menu-description")!.textContent).toBe("Nessun oggetto scelto ha un contorno.");
  });

  it("un tratteggio su misura c'è, segnato e spento, col suo valore; gli estremi lo lasciano com'è", () => {
    const custom = doc(`${LAYER}<rect id="${A}" x="10" y="10" width="20" height="10" fill="none" stroke="#000000" stroke-width="2" stroke-dasharray="5,1 2"/></g>`);
    mount(custom, { level: "expert" });
    editor.select([A]);
    outline().click();
    const own = item("Su misura: 5 1 2");
    expect(own.getAttribute("aria-checked")).toBe("true");
    expect(own.getAttribute("aria-disabled")).toBe("true");
    expect(menu().filter((entry) => entry.getAttribute("aria-checked") === "true").map(labelOf)).toEqual(["Su misura: 5 1 2", "Estremi piatti", "Angoli vivi"]);
    item("Estremi quadrati").click();
    expect(editor.engine.text).toContain('stroke-linecap="square" stroke-dasharray="5,1 2"');
    expect(spoken()).toBe("Estremi quadrati: un contorno.");
  });
});

describe("trasformare con i numeri, dal livello Esperto", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const RECT_A = `<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000"/>`;
  const RECT_B = `<rect id="${B}" x="40" y="0" width="10" height="10" fill="#000000"/>`;
  const SHAPES = doc(`${LAYER}${RECT_A}${RECT_B}</g>`);

  const transform = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Trasforma…"]')!;
  const apply = (): HTMLButtonElement => properties().querySelector<HTMLButtonElement>(".draw-properties-apply")!;
  /// Senza il pannello delle proprietà, «Trasforma…» apre una finestra.
  const DIALOG: DrawEditorOptions = { level: "custom", custom: ["rect", "transform"] };

  it("c'è solo all'Esperto, col suo tasto, e porta ai campi di «Trasforma» nel pannello", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A]);
    editor.focus();
    expect(transform().hidden).toBe(true);
    // Sotto l'Esperto il tasto resta a chi lo aveva.
    expect(key("m", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    editor.setLevel("expert");
    expect(transform().hidden).toBe(false);
    expect(transform().hasAttribute("aria-haspopup")).toBe(false);
    expect(transform().getAttribute("aria-keyshortcuts")).toBe("Control+Shift+M");
    expect(key("m", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(properties().hidden).toBe(false);
    expect(document.activeElement).toBe(propertyInput("turn"));
    expect(["turn", "scaleX", "scaleY", "skewX", "skewY"].map((id) => [propertyLabel(id), propertyInput(id).value])).toEqual([
      ["Rotazione oraria (°)", "0"],
      ["Scala orizzontale (%)", "100"],
      ["Scala verticale (%)", "100"],
      ["Inclinazione orizzontale (°)", "0"],
      ["Inclinazione verticale (°)", "0"],
    ]);
    expect(apply().textContent).toBe("Applica");
    expect(document.querySelectorAll(".modale")).toHaveLength(0);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Il pulsante della barra porta allo stesso posto.
    surface().focus();
    transform().click();
    expect(document.activeElement).toBe(propertyInput("turn"));
    expect(changes).toEqual([]);
  });

  it("ruota attorno al centro, in un passo che si annulla, e la pagina cresce se l'oggetto ne esce", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    transform().click();
    enter(propertyInput("turn"), "90");
    // Il centro è (10, 5): in senso orario la destra va in basso.
    expect(editor.engine.text).toContain(`<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000" transform="matrix(0 1 -1 0 15 -5)"/>`);
    expect(editor.engine.text).toContain('viewBox="0 -256 100 356"');
    expect(spoken()).toBe("1 oggetto trasformato.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    // I valori restano scritti: «Applica» di nuovo ruota ancora.
    expect(propertyInput("turn").value).toBe("90");
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Trasformazione.");
  });

  it("trasforma la selezione come un insieme: una scala negativa la rispecchia attorno al suo centro", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A, B]);
    transform().click();
    typeIn(propertyInput("scaleX"), "-100");
    apply().click();
    // Il riquadro va da 0 a 50: ogni oggetto passa dall'altra parte.
    expect(editor.engine.text).toContain(`<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000" transform="matrix(-1 0 0 1 50 0)"/>`);
    expect(editor.engine.text).toContain(`<rect id="${B}" x="40" y="0" width="10" height="10" fill="#000000" transform="matrix(-1 0 0 1 50 0)"/>`);
    expect(spoken()).toBe("2 oggetti trasformati.");
    expect(editor.selection).toEqual([A, B]);
  });

  it("non scrive una scala dello zero, o niente se non cambia niente", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    transform().click();
    enter(propertyInput("scaleX"), "0");
    expect(spoken()).toBe("Una scala dello zero per cento schiaccerebbe gli oggetti: scrivi un valore diverso da zero.");
    typeIn(propertyInput("scaleX"), "100");
    enter(propertyInput("turn"), "360");
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(changes).toEqual([]);
  });

  it("senza il pannello delle proprietà apre una finestra, che parte da niente da cambiare", () => {
    mount(SHAPES, DIALOG);
    editor.select([A]);
    editor.focus();
    expect(transform().hidden).toBe(false);
    expect(transform().getAttribute("aria-haspopup")).toBe("dialog");
    key("m", { ctrlKey: true, shiftKey: true });
    expect(dialog().querySelector("h2")!.textContent).toBe("Trasforma");
    expect(document.getElementById(dialog().getAttribute("aria-describedby")!)!.textContent).toBe(
      "Attorno al centro degli oggetti scelti: prima la scala, poi l’inclinazione, poi la rotazione. Una scala negativa rispecchia.",
    );
    const fields = ["rotate", "scaleX", "scaleY", "skewX", "skewY"];
    expect(fields.map((name) => [field(name).closest("label")!.querySelector(".palette-label")!.textContent, field(name).value])).toEqual([
      ["Rotazione in senso orario (°)", "0"],
      ["Scala orizzontale (%)", "100"],
      ["Scala verticale (%)", "100"],
      ["Inclinazione orizzontale (°)", "0"],
      ["Inclinazione verticale (°)", "0"],
    ]);
    expect([(field("skewX") as HTMLInputElement).min, (field("skewX") as HTMLInputElement).max]).toEqual(["-89", "89"]);
    expect(document.activeElement).toBe(field("rotate"));
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    // Un secondo Ctrl+Maiusc+M non apre un'altra finestra; Esc non scrive.
    key("m", { ctrlKey: true, shiftKey: true });
    expect(document.querySelectorAll(".modale")).toHaveLength(1);
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(changes).toEqual([]);
  });

  it("la finestra scrive in un passo; non scrive ciò che il file perderebbe, né niente se intanto la trasformazione se n'è andata", async () => {
    mount(SHAPES, DIALOG);
    editor.select([A]);
    transform().click();
    field("rotate").value = "90";
    await submit();
    expect(editor.engine.text).toContain(`<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000" transform="matrix(0 1 -1 0 15 -5)"/>`);
    expect(spoken()).toBe("1 oggetto trasformato.");
    expect(changes).toHaveLength(1);
    transform().click();
    field("rotate").value = "360";
    await submit();
    expect(spoken()).toBe("È già così: niente da cambiare.");
    transform().click();
    field("scaleX").value = "0.001";
    field("scaleY").value = "0.001";
    await submit();
    expect(spoken()).toBe("Un oggetto diventerebbe troppo piccolo per scriverne la trasformazione: niente è cambiato.");
    // Togliendo la trasformazione mentre la finestra è aperta, la risposta
    // non scrive niente.
    transform().click();
    field("rotate").value = "45";
    editor.setLevel("custom", ["rect"]);
    await submit();
    expect(changes).toHaveLength(1);
  });

  it("l'elenco dei tasti lo nomina all'Esperto", () => {
    mount(SHAPES, { level: "expert" });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+Shift+M", "Trasforma…"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("applicare la trasformazione, dal livello Esperto", () => {
  const A = "oa1a1a1a1";
  const T = "ot1t1t1t1";
  const R = "or1r1r1r1";
  const SHAPES = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000" transform="translate(5 5) scale(2)"/>`
      + `<text id="${T}" x="0" y="40" transform="rotate(30)"><tspan x="0" dy="0">Ciao</tspan></text>`
      + `<rect id="${R}" x="0" y="60" width="10" height="10" fill="#000000"/></g>`,
  );

  const applyButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Applica trasformazione"]')!;

  it("c'è solo all'Esperto, e porta la trasformazione nella geometria in un passo che si annulla", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A]);
    expect(applyButton().hidden).toBe(true);
    // Sotto l'Esperto il comando non scrive, anche chiesto.
    applyButton().click();
    expect(changes).toEqual([]);
    editor.setLevel("expert");
    expect(applyButton().hidden).toBe(false);
    expect(applyButton().hasAttribute("aria-keyshortcuts")).toBe(false);
    applyButton().click();
    expect(editor.engine.text).toContain(`<rect id="${A}" x="5" y="5" width="40" height="20" fill="#000000"/>`);
    expect(spoken()).toBe("Trasformazione applicata a 1 oggetto.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Applicazione della trasformazione.");
  });

  it("dice quanti oggetti conservano una trasformazione, e quando non c'è niente da applicare", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A, T]);
    applyButton().click();
    expect(spoken()).toBe("Trasformazione applicata a 1 oggetto. 1 oggetto conserva una trasformazione che la sua forma non sa scrivere.");
    expect(editor.selection).toEqual([A, T]);
    editor.select([T]);
    applyButton().click();
    expect(spoken()).toBe("È già così: niente da cambiare. 1 oggetto conserva una trasformazione che la sua forma non sa scrivere.");
    editor.select([R]);
    applyButton().click();
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(changes).toHaveLength(1);
  });
});

describe("il menu Tracciato, dal livello Esperto", () => {
  const A = "oa2a2a2a2";
  const T = "ot2t2t2t2";
  const P = "op2p2p2p2";
  const L = "ol2l2l2l2";
  const G = "og2g2g2g2";
  // Un poligono di 64 lati: un cerchio fatto di linee.
  const ROUND = Array.from({ length: 64 }, (_, i) => {
    const a = (2 * Math.PI * i) / 64;
    return `${(300 + 80 * Math.cos(a)).toFixed(2)},${(300 + 80 * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  const SHAPES = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000"/>`
      + `<text id="${T}" x="0" y="40"><tspan x="0" dy="0">Ciao</tspan></text>`
      + `<path id="${P}" d="M0 60 L10 70" fill="none" stroke="#000000" stroke-width="1"/>`
      + `<line id="${L}" x1="100" y1="100" x2="200" y2="100" stroke="#0072b2" stroke-width="10"/>`
      + `<polygon id="${G}" points="${ROUND}" fill="#d55e00"/></g>`,
  );

  const pathButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Tracciato"]')!;
  /// Le voci del menu aperto per ultimo.
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
  /// Le voci, col nome, se sono spente e che cosa dicono.
  const entries = (): (string | boolean | null)[][] =>
    menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled") === "true", entry.querySelector(".menu-description")?.textContent ?? null]);
  const closeMenus = (): void => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  };
  /// La voce `label` del menu sugli oggetti scelti.
  const run = (label: string): void => {
    pathButton().click();
    item(label).click();
    closeMenus();
  };
  /// La barra dello scostamento e della semplificazione, e le sue parti.
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-paths")!;
  const field = <E extends HTMLElement>(name: string): E =>
    [...bar().querySelectorAll("label")].find((label) => label.querySelector("span")!.textContent === name)!.querySelector<E>("input, select")!;
  const shown = (): string[] => [...bar().querySelectorAll("label")].filter((label) => !label.hidden).map((label) => label.querySelector("span")!.textContent ?? "");
  const status = (): string => bar().querySelector("output")!.textContent ?? "";
  const action = (name: string): HTMLButtonElement => [...bar().querySelectorAll("button")].find((control) => control.textContent === name)!;
  /// Scrive `value` nel campo `control`, come chi lo cambia.
  const write = (control: HTMLInputElement | HTMLSelectElement, value: string): void => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  };
  /// I punti delle linee dell'ultimo disegno sopra il foglio.
  const drawnPoints = (layer: ReturnType<typeof recording>): string[] => {
    layer.frame();
    return layer.calls().filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => `${Math.round(x as number)},${Math.round(y as number)}`);
  };

  afterEach(closeMenus);

  it("c'è solo all'Esperto, e le voci che non servono dicono perché", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A]);
    expect(pathButton().hidden).toBe(true);
    // Sotto l'Esperto il comando non scrive, anche chiesto.
    run("Oggetto in tracciato");
    expect(changes).toEqual([]);
    editor.setLevel("expert");
    expect(pathButton().hidden).toBe(false);
    expect(pathButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(pathButton().hasAttribute("aria-keyshortcuts")).toBe(false);
    pathButton().click();
    expect(pathButton().getAttribute("aria-expanded")).toBe("true");
    const noStroke = "Fra gli oggetti scelti non c’è una forma col contorno.";
    const noInk = "Fra gli oggetti scelti non c’è un tratto a penna.";
    const noOpen = "Fra gli oggetti scelti non c’è un tracciato aperto.";
    expect(entries()).toEqual([
      ["Oggetto in tracciato", false, null],
      ["Contorno in tracciato", true, noStroke],
      ["Inchiostro in tracciato", true, noInk],
      ["Scostamento…", false, null],
      ["Semplifica…", false, null],
      ["Unisci", true, noOpen],
    ]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    closeMenus();
    editor.select([T, L]);
    pathButton().click();
    expect(entries()).toEqual([
      ["Oggetto in tracciato", false, null],
      ["Contorno in tracciato", false, null],
      ["Inchiostro in tracciato", true, noInk],
      ["Scostamento…", false, null],
      ["Semplifica…", false, null],
      ["Unisci", false, null],
    ]);
    closeMenus();
    editor.select([T]);
    pathButton().click();
    const noShape = "Fra gli oggetti scelti non c’è una forma.";
    expect(entries()).toEqual([
      ["Oggetto in tracciato", false, null],
      ["Contorno in tracciato", true, noStroke],
      ["Inchiostro in tracciato", true, noInk],
      ["Scostamento…", true, noShape],
      ["Semplifica…", true, noShape],
      ["Unisci", true, noOpen],
    ]);
    item("Scostamento…").click();
    expect(bar().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("«Oggetto in tracciato» fa degli oggetti tracciati in un passo che si annulla", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    run("Oggetto in tracciato");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L20 0 L20 10 L0 10 Z" fill="#000000"/>`);
    expect(spoken()).toBe("1 oggetto è diventato un tracciato.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Oggetto in tracciato.");
  });

  it("dice quanti oggetti restano come sono, e quando non c'è niente da fare", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A, T]);
    run("Oggetto in tracciato");
    expect(spoken()).toBe("1 oggetto è diventato un tracciato. 1 oggetto resta com’è: testi, immagini e forme vuote non diventano tracciati.");
    expect(editor.selection).toEqual([A, T]);
    editor.select([T]);
    run("Oggetto in tracciato");
    expect(spoken()).toBe("È già così: niente da cambiare. 1 oggetto resta com’è: testi, immagini e forme vuote non diventano tracciati.");
    editor.select([P]);
    run("Oggetto in tracciato");
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(changes).toHaveLength(1);
  });

  it("«Contorno in tracciato» fa del contorno una forma piena del suo colore", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([L, A]);
    run("Contorno in tracciato");
    expect(new RegExp(`<path id="${L}"[^>]*>`).exec(editor.engine.text)?.[0]).toBe(`<path id="${L}" d="M100 105 L100 95 L200 95 L200 105 Z" fill="#0072b2"/>`);
    expect(spoken()).toBe("1 contorno è diventato una forma piena. 1 oggetto resta com’è: non ha un contorno.");
    expect(editor.selection).toEqual([A, L]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Contorno in tracciato.");
  });

  it("«Inchiostro in tracciato» fa di un tratto a penna la sua spina, col colore e lo spessore", () => {
    mount(doc(`${LAYER}</g>`), { level: "expert" });
    editor.setTool("pen");
    drag([[20, 300], [40, 330], [60, 360], [80, 330], [100, 300]]);
    const id = /<path id="(o[a-z0-9]{8})" fub:tool="pen"/.exec(editor.engine.text)![1]!;
    const before = editor.engine.text;
    editor.setTool("select");
    editor.select([id]);
    run("Inchiostro in tracciato");
    expect(editor.engine.text).toMatch(new RegExp(`<path id="${id}" d="M20 300 [^"]+" fill="none" stroke="#000000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`));
    expect(editor.engine.text).not.toContain("fub:ink");
    expect(spoken()).toBe("1 tratto a penna è diventato un tracciato.");
    expect(editor.selection).toEqual([id]);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("«Scostamento…» apre una barra con l'anteprima; Invio scrive il tracciato nuovo, sotto la forma", () => {
    const layer = recording();
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    editor.focus();
    run("Scostamento…");
    expect(bar().hidden).toBe(false);
    expect(document.getElementById(bar().getAttribute("aria-labelledby")!)!.textContent).toBe("Scostamento");
    expect(shown()).toEqual(["Distanza", "Angoli", "Limite"]);
    const distance = field<HTMLInputElement>("Distanza");
    expect(document.activeElement).toBe(distance);
    expect(distance.value).toBe("4");
    expect(field<HTMLSelectElement>("Angoli").value).toBe("miter");
    expect(field<HTMLInputElement>("Limite").value).toBe("4");
    expect(status()).toBe("1 tracciato nuovo.");
    // L'anteprima: il rettangolo allargato di 4.
    expect(drawnPoints(layer)).toEqual(expect.arrayContaining(["-4,-4", "24,-4", "24,14", "-4,14"]));
    expect(changes).toEqual([]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Gli angoli arrotondati non hanno limite.
    write(field<HTMLSelectElement>("Angoli"), "round");
    expect(shown()).toEqual(["Distanza", "Angoli"]);
    write(field<HTMLSelectElement>("Angoli"), "miter");
    write(distance, "-6");
    expect(status()).toBe("1 forma sparisce: è più stretta del doppio della distanza.");
    write(distance, "");
    expect(status()).toBe("Scrivi una distanza: in più allarga, in meno restringe.");
    key("Enter", {}, distance);
    expect(spoken()).toBe("Scrivi una distanza: in più allarga, in meno restringe.");
    expect(bar().hidden).toBe(false);
    write(distance, "2");
    expect(drawnPoints(layer)).toEqual(expect.arrayContaining(["-2,-2", "22,-2", "22,12", "-2,12"]));
    key("Enter", {}, distance);
    expect(bar().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    const added = editor.selection[0]!;
    expect(added).not.toBe(A);
    // Quattro nodi, come il rettangolo.
    expect(editor.engine.text).toMatch(new RegExp(`<path id="${added}" d="M22 -2 L22 12 L-2 12 L-2 -2 Z" fill="#000000"/>\\s*<rect id="${A}"`));
    expect(spoken()).toBe("1 tracciato nuovo, scostato di 2.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Scostamento.");
    // La barra riapre con la distanza dell'ultima volta; Esc la chiude senza
    // cambiare niente.
    editor.select([A]);
    run("Scostamento…");
    expect(field<HTMLInputElement>("Distanza").value).toBe("2");
    key("Escape", {}, field<HTMLInputElement>("Distanza"));
    expect(bar().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    expect(changes).toHaveLength(2);
  });

  it("l'anteprima segue la selezione, e la barra se ne va col livello", () => {
    const layer = recording();
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    run("Scostamento…");
    editor.select([L]);
    expect(status()).toBe("1 tracciato nuovo.");
    expect(drawnPoints(layer)).toEqual(expect.arrayContaining(["96,96", "204,96", "204,104", "96,104"]));
    editor.select([]);
    expect(status()).toBe("Scegli le forme da cambiare.");
    editor.select([A, T]);
    expect(status()).toBe("1 tracciato nuovo. 1 oggetto resta com’è: non è una forma.");
    editor.setLevel("standard");
    expect(bar().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("«Semplifica…» dice i nodi prima e dopo, e lo scarto; «Applica» scrive in un passo", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([G]);
    run("Semplifica…");
    expect(document.getElementById(bar().getAttribute("aria-labelledby")!)!.textContent).toBe("Semplifica");
    expect(shown()).toEqual(["Semplificazione"]);
    const amount = field<HTMLInputElement>("Semplificazione");
    expect(document.activeElement).toBe(amount);
    expect(amount.value).toBe("50");
    expect(status()).toBe("Da 64 nodi a 8, scarto fino a 0,51.");
    expect(amount.getAttribute("aria-valuetext")).toBe("scarto fino a 0,51");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    write(amount, "0");
    expect(status()).toBe("64 nodi: niente da togliere entro 0,023.");
    action("Applica").click();
    expect(spoken()).toBe("64 nodi: niente da togliere entro 0,023.");
    expect(changes).toEqual([]);
    write(amount, "50");
    const after = Number(/a (\d+),/.exec(status())![1]);
    action("Applica").click();
    expect(bar().hidden).toBe(true);
    expect(editor.engine.text).toMatch(new RegExp(`<path id="${G}" d="M[^"]+C[^"]+" fill="#d55e00"/>`));
    expect(spoken()).toBe(`1 forma semplificata: da 64 nodi a ${after}.`);
    expect(editor.selection).toEqual([G]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Semplifica.");
  });
});

describe("le operazioni booleane, dal livello Esperto", () => {
  const A = "oa4a4a4a4";
  const B = "ob4b4b4b4";
  const C = "oc4c4c4c4";
  const T = "ot4t4t4t4";
  const P = "op4p4p4p4";
  const SHAPES = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="20" height="20" fill="#d55e00"/>`
      + `<rect id="${B}" x="10" y="10" width="20" height="20" fill="#0072b2"/>`
      + `<circle id="${C}" cx="100" cy="100" r="5" fill="#000000"/>`
      + `<path id="${P}" d="M50 50 L60 50 L60 60 Z" fill="#000000"/>`
      + `<text id="${T}" x="0" y="60"><tspan x="0" dy="0">Ciao</tspan></text></g>`,
  );

  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const booleans = (): HTMLButtonElement => bar().querySelector<HTMLButtonElement>('button[aria-label="Operazioni booleane"]')!;
  /// Le voci del menu aperto per ultimo.
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  };
  const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
  const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
  /// Le voci, col nome, se sono spente e che cosa dicono.
  const entries = (): (string | boolean | null)[][] =>
    menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled") === "true", entry.querySelector(".menu-description")?.textContent ?? null]);
  const closeMenus = (): void => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  };
  /// L'operazione `label` sugli oggetti `keys`, dal menu.
  const run = (keys: string[], label: string): void => {
    editor.select(keys);
    booleans().click();
    item(label).click();
    closeMenus();
  };

  afterEach(closeMenus);

  it("c'è solo all'Esperto, nella barra della selezione, con le cinque operazioni", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A, B]);
    expect(bar().hidden).toBe(false);
    expect(booleans().hidden).toBe(true);
    // Sotto l'Esperto il comando non scrive, anche chiesto.
    run([A, B], "Unione");
    expect(changes).toEqual([]);
    editor.setLevel("expert");
    expect(booleans().hidden).toBe(false);
    expect(booleans().getAttribute("aria-haspopup")).toBe("menu");
    expect(booleans().hasAttribute("aria-keyshortcuts")).toBe(false);
    booleans().click();
    expect(booleans().getAttribute("aria-expanded")).toBe("true");
    expect(entries()).toEqual([
      ["Unione", false, null],
      ["Differenza", false, null],
      ["Intersezione", false, null],
      ["Esclusione", false, null],
      ["Divisione", false, null],
    ]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    closeMenus();
    editor.setLevel("standard");
    expect(booleans().hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("le voci spente dicono perché: una forma sola si unisce e basta, e un testo non è una forma", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    booleans().click();
    const few = "Servono almeno due forme.";
    expect(entries()).toEqual([
      ["Unione", false, null],
      ["Differenza", true, few],
      ["Intersezione", true, few],
      ["Esclusione", true, few],
      ["Divisione", true, few],
    ]);
    item("Differenza").click();
    expect(changes).toEqual([]);
    closeMenus();
    editor.select([A, B, T]);
    booleans().click();
    const text = "Le operazioni booleane lavorano sulle forme: 1 oggetto scelto non lo è.";
    expect(entries()).toEqual(
      ["Unione", "Differenza", "Intersezione", "Esclusione", "Divisione"].map((label) => [label, true, text]),
    );
    item("Unione").click();
    expect(changes).toEqual([]);
  });

  it("l'unione fa della forma più in basso un tracciato, con l'area di tutte, in un passo che si annulla", () => {
    mount(SHAPES, { level: "expert" });
    run([B, A], "Unione");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L20 0 L20 10 L30 10 L30 30 L10 30 L10 20 L0 20 Z" fill="#d55e00"/>`);
    expect(editor.engine.text).not.toContain(B);
    expect(spoken()).toBe("Unione: 2 forme diventano un tracciato.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Unione.");
    // Una forma sola diventa il tracciato della sua area.
    run([A], "Unione");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L20 0 L20 20 L0 20 Z" fill="#d55e00"/>`);
    expect(spoken()).toBe("Unione: 1 forma diventa un tracciato.");
  });

  it("differenza, intersezione ed esclusione", () => {
    mount(SHAPES, { level: "expert" });
    run([A, B], "Differenza");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L20 0 L20 10 L10 10 L10 20 L0 20 Z" fill="#d55e00"/>`);
    expect(spoken()).toBe("Differenza: 2 forme diventano un tracciato.");
    editor.undo();
    run([A, B], "Intersezione");
    // Ogni anello comincia, se può, da un nodo della forma più in basso.
    expect(editor.engine.text).toContain(`<path id="${A}" d="M20 20 L10 20 L10 10 L20 10 Z" fill="#d55e00"/>`);
    editor.undo();
    run([A, B], "Esclusione");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L20 0 L20 10 L10 10 L10 20 L0 20 Z M20 20 L20 10 L30 10 L30 30 L10 30 L10 20 Z" fill="#d55e00"/>`);
    expect(spoken()).toBe("Esclusione: 2 forme diventano un tracciato.");
    expect(changes).toHaveLength(5);
  });

  it("la divisione taglia la forma più in basso, e sono scelti i pezzi", () => {
    mount(SHAPES, { level: "expert" });
    run([A, B], "Divisione");
    const pieces = [...editor.engine.text.matchAll(/<path id="([^"]+)" d="([^"]+)" fill="#d55e00"\/>/g)].map((match) => [match[1], match[2]]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([A, "M0 0 L20 0 L20 10 L10 10 L10 20 L0 20 Z"]);
    expect(pieces[1]![1]).toBe("M20 20 L10 20 L10 10 L20 10 Z");
    expect(editor.engine.text).not.toContain(B);
    expect(editor.selection).toEqual([A, pieces[1]![0]]);
    expect(spoken()).toBe("Divisione: la forma diventa 2 tracciati.");
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Divisione.");
  });

  it("un risultato vuoto, o una divisione che non divide, non cambiano niente, e lo si dice", () => {
    mount(SHAPES, { level: "expert" });
    run([A, C], "Intersezione");
    expect(spoken()).toBe("Il risultato sarebbe vuoto: niente è cambiato.");
    run([A, C], "Divisione");
    expect(spoken()).toBe("Le altre forme non dividono quella più in basso: niente è cambiato.");
    expect(editor.selection).toEqual([A, C]);
    // Un tracciato solo che è già il risultato resta com'è.
    run([P], "Unione");
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(editor.engine.text).toBe(SHAPES);
    expect(changes).toEqual([]);
    // Una forma lontana non toglie niente, e se ne va.
    run([A, C], "Differenza");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L20 0 L20 20 L0 20 Z" fill="#d55e00"/>`);
    expect(editor.engine.text).not.toContain(C);
    expect(changes).toHaveLength(1);
  });

  it("dice quando la forma più in basso non si riscrive", () => {
    mount(doc(`${LAYER}<rect xmlns:x="urn:x" id="${A}" x:a="1" x="0" y="0" width="20" height="20"/><rect id="${B}" x="10" y="10" width="20" height="20"/></g>`), { level: "expert" });
    run([A, B], "Unione");
    expect(spoken()).toBe("La forma più in basso ha attributi di un altro programma che FubDraw non sa riscrivere: niente è cambiato.");
    expect(changes).toEqual([]);
  });

  it("dice quando il calcolo non riesce", () => {
    mount(doc(`${LAYER}<rect id="${A}" x="0" y="0" width="20" height="20" transform="scale(0)"/><rect id="${B}" x="10" y="10" width="20" height="20"/></g>`), { level: "expert" });
    run([A, B], "Unione");
    expect(spoken()).toBe("Il calcolo non riesce su queste forme: niente è cambiato.");
    expect(changes).toEqual([]);
  });
});

describe("i nodi, dal livello Esperto", () => {
  const P = "op3p3p3p3";
  const C = "oc3c3c3c3";
  const R = "or3r3r3r3";
  const PATH = `<path id="${P}" d="M10 10 L50 10 L50 50" fill="none" stroke="#000000" stroke-width="2"/>`;
  const CURVE = `<path id="${C}" d="M100 100 C120 80 140 80 160 100" fill="none" stroke="#000000" stroke-width="2"/>`;
  const RECT = `<rect id="${R}" x="200" y="200" width="20" height="20" fill="#000000"/>`;
  const SHAPES = doc(`${LAYER}${PATH}${CURVE}${RECT}</g>`);
  /// Il `d` del tracciato `id`, com'è adesso.
  const d = (id = P): string | null => new RegExp(`<path id="${id}" d="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;

  const tap = (x: number, y: number, init: Init = {}): void => drag([[x, y]], init);
  const nodesTool = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-tool[aria-label="Nodi"]')!;
  const nodesBar = (): HTMLElement => host.querySelector<HTMLElement>('.draw-arrange[aria-label="Comandi dei nodi"]')!;
  const arrangeBar = (): HTMLElement => host.querySelector<HTMLElement>('.draw-arrange[aria-label="Disponi"]')!;
  const command = (label: string): HTMLButtonElement => nodesBar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const enabled = (): string[] => [...nodesBar().querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.disabled).map((control) => control.getAttribute("aria-label")!);

  /// Il tracciato P scelto, con lo strumento Nodi.
  const editing = (source = SHAPES): void => {
    mount(source, { level: "expert" });
    editor.select([P]);
    editor.focus();
    key("n");
  };

  it("c'è solo all'Esperto, col tasto N, e dice di che cosa si modificano i nodi", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([P]);
    editor.focus();
    expect(nodesTool().hidden).toBe(true);
    key("n");
    expect(editor.tool).not.toBe("nodes");
    editor.setLevel("expert");
    expect(nodesTool().hidden).toBe(false);
    expect(nodesTool().title).toBe("Nodi (N)");
    key("n");
    expect(editor.tool).toBe("nodes");
    expect(nodesTool().getAttribute("aria-checked")).toBe("true");
    expect(spoken()).toBe("Strumento: Nodi. Tracciato, Nero: 3 nodi da modificare.");
    // La barra dei nodi prende il posto di quella della selezione.
    expect(nodesBar().hidden).toBe(false);
    expect(nodesBar().getAttribute("role")).toBe("toolbar");
    expect(arrangeBar().hidden).toBe(true);
    expect([...nodesBar().querySelectorAll("button")].map((control) => [control.getAttribute("aria-label"), control.getAttribute("aria-keyshortcuts")])).toEqual([
      ["Aggiungi nodi", "Insert"],
      ["Elimina nodi", "Delete"],
      ["Nodi a spigolo", "Shift+C"],
      ["Nodi lisci", "Shift+S"],
      ["Nodi simmetrici", "Shift+Y"],
      ["Segmenti in linee", "Shift+L"],
      ["Segmenti in curve", "Shift+U"],
      ["Spezza ai nodi", "Shift+B"],
      ["Unisci i capi", "Shift+J"],
      ["Allinea i nodi", null],
    ]);
    expect(command("Nodi a spigolo").title).toBe("Nodi a spigolo (Shift+C)");
    // Canc elimina i nodi: il pulsante che elimina l'oggetto non lo dichiara.
    const remove = host.querySelector<HTMLButtonElement>('.draw-toolbar button[aria-label="Elimina la selezione"]')!;
    expect(remove.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Senza nodi scelti nessun comando serve, e Alt+F10 lo dice.
    expect(enabled()).toEqual([]);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun nodo scelto.");
    expect(document.activeElement).toBe(surface());
    editor.setTool("select");
    expect(nodesBar().hidden).toBe(true);
    expect(arrangeBar().hidden).toBe(false);
    expect(remove.getAttribute("aria-keyshortcuts")).toBe("Delete");
    expect(changes).toEqual([]);
  });

  it("dice quando l'oggetto scelto non ha nodi, e di quanti oggetti si modificano i nodi", () => {
    const T = "ot3t3t3t3";
    const TEXT = `<text id="${T}" x="300" y="300" fill="#000000" font-family="Inter, sans-serif" font-size="20"><tspan x="300" dy="0">Ciao</tspan></text>`;
    mount(doc(`${LAYER}${PATH}${CURVE}${RECT}${TEXT}</g>`), { level: "expert" });
    editor.select([T]);
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi. Un testo non ha nodi: si modifica scrivendo.");
    expect(nodesBar().hidden).toBe(true);
    expect(arrangeBar().hidden).toBe(false);
    // Le frecce non spostano mai l'oggetto, con lo strumento Nodi.
    key("ArrowRight");
    expect(changes).toEqual([]);
    // Con più oggetti scelti si modificano i nodi di tutti.
    editor.select([P, R]);
    editor.setTool("nodes");
    expect(spoken()).toBe("Strumento: Nodi. 2 oggetti: 7 nodi da modificare.");
    expect(nodesBar().hidden).toBe(false);
    editor.select([]);
    editor.setTool("nodes");
    expect(spoken()).toBe("Strumento: Nodi.");
    // Un tocco sceglie l'oggetto di cui modificare i nodi, e prende subito
    // ciò che tocca: qui un segmento, coi suoi due nodi.
    tap(30, 10);
    expect(editor.selection).toEqual([P]);
    expect(spoken()).toBe("Tracciato, Nero: 3 nodi da modificare. 2 nodi scelti.");
    tap(310, 292);
    expect(editor.selection).toEqual([T]);
    expect(spoken()).toBe("Un testo non ha nodi: si modifica scrivendo.");
    // Il riquadro sceglie i nodi che racchiude, coi loro oggetti, e con
    // Maiusc in aggiunta; il vuoto toglie la scelta dei nodi, poi quella
    // degli oggetti.
    drag([[0, 0], [60, 60]], { shiftKey: true });
    expect(editor.selection).toEqual([P, T]);
    expect(spoken()).toBe("Tracciato, Nero: 3 nodi da modificare. 3 nodi scelti.");
    tap(120, 300);
    expect(spoken()).toBe("Nessun nodo scelto.");
    expect(editor.selection).toEqual([P, T]);
    tap(120, 300);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    expect(changes).toEqual([]);
  });

  it("su un testo su tracciato modifica il tracciato, e il testo lo segue", () => {
    const T = "ot3t3t3t3";
    const K = "rk3k3k3k3";
    const ALONG = doc(
      `<defs id="fub-defs"><path id="${K}" fub:role="private" d="M 0 100 L 200 100"/></defs>${LAYER}` +
        `<text id="${T}" font-size="10"><textPath href="#${K}">Sul colle</textPath></text>${PATH}</g>`,
    );
    mount(ALONG, { level: "expert" });
    editor.select([T]);
    editor.focus();
    key("n");
    expect(spoken()).toMatch(/: 2 nodi da modificare\.$/);
    expect(nodesBar().hidden).toBe(false);
    // Mentre si trascina, il testo segue il tracciato che si vedrà.
    const track = (): string | null => host.querySelector("defs path")!.getAttribute("d");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 200, clientY: 100, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 200, clientY: 80, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 200, clientY: 60, timeStamp: (clock += 8) }));
    expect(track()).toBe("M0 100 L200 60");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 200, clientY: 60, timeStamp: (clock += 8) }));
    expect(editor.engine.text).toContain(`<path id="${K}" fub:role="private" d="M0 100 L200 60"/>`);
    expect(editor.engine.text).toContain(`<text id="${T}" font-size="10"><textPath href="#${K}">Sul colle</textPath></text>`);
    expect(spoken()).toBe("Nodo spostato: x 200, y 60.");
    expect(editor.selection).toEqual([T]);
    expect(changes).toHaveLength(1);
    // La pagina cresce col testo, che sta sul tracciato.
    expect(editor.engine.text).toContain('viewBox="-256 0 612 356"');
    // I comandi dei nodi: il segmento diventa una curva.
    tap(100, 80);
    expect(spoken()).toBe("2 nodi scelti.");
    key("U", { shiftKey: true });
    expect(editor.engine.text).toMatch(new RegExp(`<path id="${K}" fub:role="private" d="M0 100 C[^"]+"/>`));
    expect(changes).toHaveLength(2);
    // Il tracciato resta lungo più di zero, e resta suo.
    tap(0, 100);
    key("Delete");
    expect(spoken()).toBe("Il testo ha bisogno di un tracciato lungo più di zero: per lasciarlo, «Togli dal tracciato».");
    expect(changes).toHaveLength(2);
    editor.select([T, P]);
    editor.setTool("nodes");
    tap(0, 100);
    tap(10, 10, { shiftKey: true });
    key("J", { shiftKey: true });
    expect(spoken()).toBe("Il tracciato di un testo resta suo: non si unisce a un’altra forma.");
    expect(changes).toHaveLength(2);
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(ALONG);
  });

  it("trascinare un nodo lo sposta, in un passo che si annulla", () => {
    editing();
    drag([[50, 10], [60, 10], [70, 20]]);
    expect(d()).toBe("M10 10 L70 20 L50 50");
    expect(editor.engine.text).toContain(`<path id="${P}" d="M10 10 L70 20 L50 50" fill="none" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("Nodo spostato: x 70, y 20.");
    expect(editor.selection).toEqual([P]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Spostamento di nodi.");
  });

  it("Maiusc aggiunge e toglie nodi, il riquadro li sceglie, e il vuoto toglie la scelta", () => {
    editing();
    tap(10, 10);
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 10, y 10.");
    tap(50, 50, { shiftKey: true });
    expect(spoken()).toBe("2 nodi scelti.");
    // Trascinare uno dei nodi scelti li sposta tutti.
    drag([[10, 10], [20, 10], [30, 20]]);
    expect(d()).toBe("M30 20 L50 10 L70 60");
    expect(spoken()).toBe("2 nodi spostati.");
    tap(70, 60, { shiftKey: true });
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 30, y 20.");
    // Un tocco su un nodo scelto con altri lo lascia solo.
    tap(70, 60, { shiftKey: true });
    tap(70, 60);
    expect(spoken()).toBe("Nodo 3 di 3, capo: x 70, y 60.");
    drag([[90, 40], [60, 70]]);
    expect(spoken()).toBe("Nodo 3 di 3, capo: x 70, y 60.");
    // Con Maiusc il riquadro aggiunge, e un tocco sul vuoto non toglie.
    drag([[0, 0], [40, 30]], { shiftKey: true });
    expect(spoken()).toBe("2 nodi scelti.");
    tap(30, 40, { shiftKey: true });
    expect(spoken()).toBe("2 nodi scelti.");
    expect(enabled()).toContain("Elimina nodi");
    drag([[0, 0], [100, 90]]);
    expect(spoken()).toBe("3 nodi scelti.");
    tap(30, 40);
    expect(spoken()).toBe("Nessun nodo scelto.");
    expect(editor.selection).toEqual([P]);
    tap(30, 40);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    expect(editor.selection).toEqual([]);
    expect(nodesBar().hidden).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it("un tocco su un segmento ne sceglie i due nodi, due tocchi ci aggiungono un nodo", () => {
    editing();
    // Un tremolio sotto la soglia è ancora un tocco.
    drag([[30, 10], [31, 10]]);
    expect(spoken()).toBe("2 nodi scelti.");
    // Un segmento che è già una linea non diventa una linea.
    expect(enabled()).toEqual(["Aggiungi nodi", "Elimina nodi", "Nodi a spigolo", "Nodi lisci", "Nodi simmetrici", "Segmenti in curve", "Spezza ai nodi", "Allinea i nodi"]);
    tap(30, 10);
    expect(d()).toBe("M10 10 L30 10 L50 10 L50 50");
    expect(spoken()).toBe("1 nodo aggiunto.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(spoken()).toBe("Annullato: Aggiunta di nodi.");
    // Due tocchi lenti no.
    tap(30, 10);
    clock += 1000;
    tap(30, 10);
    expect(d()).toBe("M10 10 L50 10 L50 50");
  });

  it("Esc a metà di un trascinamento lascia il tracciato e i nodi scelti com'erano", () => {
    editing();
    tap(10, 10);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 50, clientY: 50, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 70, clientY: 70, timeStamp: (clock += 8) }));
    key("Escape");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 70, clientY: 70, timeStamp: (clock += 8) }));
    expect(d()).toBe("M10 10 L50 10 L50 50");
    expect(changes).toEqual([]);
    // Scelto è ancora il primo nodo, non quello preso dal gesto.
    key("Delete");
    expect(d()).toBe("M50 10 L50 50");
  });

  it("trascinare un segmento lo piega, e una maniglia si sposta da sola", () => {
    editing();
    drag([[30, 10], [30, 20], [30, 30]]);
    expect(d()).toMatch(/^M10 10 C[-\d. ]+ 50 10 L50 50$/);
    expect(spoken()).toBe("Segmento piegato.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Piegatura di un segmento.");
    editor.select([C]);
    tap(100, 100);
    expect(spoken()).toBe("Nodo 1 di 2, capo: x 100, y 100.");
    drag([[120, 80], [120, 70], [120, 60]]);
    expect(d(C)).toBe("M100 100 C120 60 140 80 160 100");
    expect(spoken()).toBe("Maniglia spostata.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Spostamento di una maniglia.");
    // Lo stesso tracciato, con gli stessi nodi: il nodo resta scelto.
    expect(enabled()).toContain("Elimina nodi");
    // Un tocco sulla maniglia non cambia niente.
    tap(120, 80);
    expect(d(C)).toBe("M100 100 C120 80 140 80 160 100");
  });

  it("Tab va di nodo in nodo e poi all'oggetto dopo; Inizio, Fine, Ctrl+A ed Esc", () => {
    editing();
    size(400, 300);
    key("Tab");
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 10, y 10.");
    key("Tab");
    expect(spoken()).toBe("Nodo 2 di 3, spigolo: x 50, y 10.");
    key("End");
    expect(spoken()).toBe("Nodo 3 di 3, capo: x 50, y 50.");
    key("Tab", { shiftKey: true });
    expect(spoken()).toBe("Nodo 2 di 3, spigolo: x 50, y 10.");
    key("Home");
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 10, y 10.");
    key("a", { ctrlKey: true });
    expect(spoken()).toBe("3 nodi scelti.");
    expect(editor.selection).toEqual([P]);
    // Prima del primo nodo scelto non c'è niente: il Tab esce dal foglio.
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(spoken()).toBe("3 nodi scelti.");
    // Oltre l'ultimo, l'oggetto dopo e i suoi nodi.
    key("Tab");
    expect(editor.selection).toEqual([C]);
    key("Tab");
    expect(spoken()).toBe("Nodo 1 di 2, capo: x 100, y 100.");
    key("Escape");
    expect(spoken()).toBe("Nessun nodo scelto.");
    expect(editor.selection).toEqual([C]);
    key("Escape");
    expect(spoken()).toBe("Nessun oggetto scelto.");
    expect(editor.selection).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("le frecce spostano i nodi scelti, e senza nodi il cursore; Invio apre la loro posizione", async () => {
    editing();
    key("ArrowRight");
    expect(changes).toEqual([]);
    key("Home");
    key("ArrowRight");
    expect(d()).toBe("M11 10 L50 10 L50 50");
    expect(spoken()).toBe("Nodo spostato: x 11, y 10.");
    key("ArrowDown", { shiftKey: true });
    expect(d()).toBe("M11 20 L50 10 L50 50");
    expect(changes).toHaveLength(2);
    // Con Ctrl, un pixel dello schermo: al 156 %, 0,64.
    size(400, 300);
    key("+");
    key("+");
    key("ArrowLeft", { ctrlKey: true });
    expect(d()).toBe("M10.36 20 L50 10 L50 50");
    key("ArrowRight", { ctrlKey: true });
    expect(d()).toBe("M11 20 L50 10 L50 50");
    key("0");
    key("Enter");
    expect(dialog().querySelector("h2")!.textContent).toBe("Posizione dei nodi");
    expect(["x", "y"].map((name) => field(name).value)).toEqual(["11", "20"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    field("x").value = "15";
    await submit();
    expect(d()).toBe("M15 20 L50 10 L50 50");
    expect(spoken()).toBe("Nodo spostato: x 15, y 20.");
    expect(document.activeElement).toBe(surface());
    // Coi nodi tutti scelti, la posizione è quella del loro riquadro.
    key("a", { ctrlKey: true });
    key("Enter");
    expect(["x", "y"].map((name) => field(name).value)).toEqual(["15", "10"]);
    field("y").value = "0";
    await submit();
    expect(d()).toBe("M15 10 L50 0 L50 40");
    expect(spoken()).toBe("3 nodi spostati.");
  });

  it("Insert aggiunge, Canc elimina i nodi e mai l'oggetto, e senza nodi il tracciato se ne va", () => {
    editing();
    key("Delete");
    expect(spoken()).toBe("Nessun nodo scelto.");
    expect(changes).toEqual([]);
    key("a", { ctrlKey: true });
    key("Insert");
    expect(d()).toBe("M10 10 L30 10 L50 10 L50 30 L50 50");
    expect(spoken()).toBe("2 nodi aggiunti.");
    // Scelti restano i nodi nuovi.
    key("Delete");
    expect(d()).toBe("M10 10 L50 10 L50 50");
    expect(spoken()).toBe("2 nodi eliminati.");
    key("Home");
    key("Insert");
    expect(spoken()).toBe("Aggiungere nodi chiede due nodi vicini scelti: il nodo nuovo va a metà del segmento fra loro.");
    key("Delete");
    expect(d()).toBe("M50 10 L50 50");
    expect(spoken()).toBe("1 nodo eliminato.");
    key("a", { ctrlKey: true });
    key("Backspace");
    expect(editor.engine.text).not.toContain(`id="${P}"`);
    expect(spoken()).toBe("Senza nodi la forma non c’è più: eliminata. Il disegno ha 2 oggetti.");
    expect(editor.selection).toEqual([]);
    expect(changes).toHaveLength(4);
    editor.undo();
    expect(spoken()).toBe("Annullato: Eliminazione di nodi.");
    expect(d()).toBe("M50 10 L50 50");
  });

  it("Maiusc e una lettera, o la barra, cambiano tipo dei nodi e dei segmenti, spezzano e uniscono", () => {
    editing();
    key("Home");
    // Un capo si elimina soltanto, o si allinea.
    expect(enabled()).toEqual(["Elimina nodi", "Allinea i nodi"]);
    key("C", { shiftKey: true });
    expect(spoken()).toBe("Il tipo è dei nodi in mezzo al tracciato: i capi di un tracciato aperto non ne hanno.");
    key("Tab");
    key("C", { shiftKey: true });
    // Il nodo è già uno spigolo: il tipo resta, la geometria no.
    expect(spoken()).toBe("1 nodo a spigolo.");
    expect(changes).toEqual([]);
    key("S", { shiftKey: true });
    expect(d()).toMatch(/^M10 10 C[-\d. ]+ 50 10 C[-\d. ]+ 50 50$/);
    expect(spoken()).toBe("1 nodo liscio.");
    key("Tab", { shiftKey: true });
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 10, y 10.");
    key("Tab");
    expect(spoken()).toBe("Nodo 2 di 3, liscio: x 50, y 10.");
    // Uno spigolo non cambia la geometria, ma il nodo lo è.
    key("C", { shiftKey: true });
    expect(spoken()).toBe("1 nodo a spigolo.");
    expect(changes).toHaveLength(1);
    key("Tab", { shiftKey: true });
    key("Tab");
    expect(spoken()).toBe("Nodo 2 di 3, spigolo: x 50, y 10.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Tipo dei nodi.");
    tap(30, 10);
    key("L", { shiftKey: true });
    expect(spoken()).toBe("È già così: niente da cambiare.");
    key("U", { shiftKey: true });
    expect(d()).toMatch(/^M10 10 C[-\d. ]+ 50 10 L50 50$/);
    expect(spoken()).toBe("1 segmento ora è una curva.");
    // Dalla barra, come dai tasti.
    command("Segmenti in linee").click();
    expect(d()).toBe("M10 10 L50 10 L50 50");
    expect(spoken()).toBe("1 segmento ora è una linea.");
    key("Home");
    key("L", { shiftKey: true });
    expect(spoken()).toBe("Cambiare i segmenti chiede due nodi vicini scelti.");
    key("B", { shiftKey: true });
    expect(spoken()).toBe("Spezzare chiede un nodo scelto in mezzo al tracciato, o su un tracciato chiuso.");
    key("Tab");
    key("B", { shiftKey: true });
    expect(d()).toBe("M10 10 L50 10 M50 10 L50 50");
    expect(spoken()).toBe("Tracciato spezzato in 1 nodo.");
    // Spezzato, il tracciato ha due capi dove c'era il nodo, scelti.
    expect(enabled()).toContain("Unisci i capi");
    key("End");
    expect(spoken()).toBe("Nodo 4 di 4, capo: x 50, y 50.");
    drag([[65, 0], [45, 15]]);
    expect(spoken()).toBe("2 nodi scelti.");
    key("J", { shiftKey: true });
    expect(d()).toBe("M10 10 L50 10 L50 50");
    expect(spoken()).toBe("Capi uniti: il tracciato ora è uno solo.");
    tap(10, 10);
    tap(50, 50, { shiftKey: true });
    command("Unisci i capi").click();
    expect(d()).toBe("M10 10 L50 10 L50 50 Z");
    expect(spoken()).toBe("Capi uniti: il tracciato ora è chiuso.");
    key("J", { shiftKey: true });
    expect(spoken()).toBe("Unire chiede due capi scelti di tracciati aperti.");
  });

  it("Alt+F10 va alla barra dei nodi, i suoi tasti valgono lì, ed Esc torna al foglio", () => {
    editing();
    key("Tab");
    key("Tab");
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(command("Elimina nodi"));
    key("S", { shiftKey: true }, command("Elimina nodi"));
    expect(spoken()).toBe("1 nodo liscio.");
    expect(nodesBar().contains(document.activeElement)).toBe(true);
    key("Escape", {}, document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(surface());
    expect(editor.selection).toEqual([P]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("dentro un gruppo si vedono i nodi di tutte le forme, e la forma toccata resta quella di cui si modificano, col gruppo scelto", () => {
    const G = "og4g4g4g4";
    const A = "oa4a4a4a4";
    const B = "ob4b4b4b4";
    const GROUP = doc(
      `${LAYER}<g id="${G}"><path id="${A}" d="M10 10 L50 10" fill="none" stroke="#000000" stroke-width="2"/>`
        + `<path id="${B}" d="M10 50 L50 50 L50 90" fill="none" stroke="#000000" stroke-width="2"/></g></g>`,
    );
    mount(GROUP, { level: "expert" });
    editor.select([G]);
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi. Gruppo, 2 oggetti: 5 nodi da modificare.");
    tap(30, 50);
    expect(spoken()).toBe("Gruppo, 2 oggetti: 3 nodi da modificare. 2 nodi scelti.");
    drag([[50, 90], [60, 90], [70, 90]]);
    expect(d(B)).toBe("M10 50 L50 50 L70 90");
    expect(d(A)).toBe("M10 10 L50 10");
    expect(editor.selection).toEqual([G]);
    // La forma resta quella anche dopo la modifica.
    key("Home");
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 10, y 50.");
  });

  it("i capi di due linee scelti col riquadro si allineano in un passo, che un annulla toglie, e si dice di quanti oggetti sono", () => {
    const L = "ol5l5l5l5";
    const M = "om5m5m5m5";
    const LINES = `<line id="${L}" x1="10" y1="10" x2="50" y2="20" stroke="#000000" stroke-width="2"/>`
      + `<line id="${M}" x1="10" y1="60" x2="60" y2="70" stroke="#000000" stroke-width="2"/>`;
    mount(doc(`${LAYER}${LINES}${RECT}</g>`), { level: "expert" });
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi.");
    // Il riquadro prende i capi a destra delle due linee, e i loro oggetti.
    drag([[40, 0], [80, 40], [80, 80]]);
    expect(editor.selection).toEqual([L, M]);
    expect(spoken()).toBe("2 oggetti: 4 nodi da modificare. 2 nodi scelti in 2 oggetti.");
    expect(changes).toEqual([]);
    command("Allinea i nodi").click();
    const open = [...document.querySelectorAll<HTMLElement>(".context-menu")].pop()!;
    const entries = [...open.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(entries.map((entry) => entry.querySelector(".menu-label")!.textContent)).toEqual([
      "Allinea a sinistra",
      "Allinea al centro",
      "Allinea a destra",
      "Allinea in alto",
      "Allinea in mezzo",
      "Allinea in basso",
      "Distribuisci orizzontalmente",
      "Distribuisci verticalmente",
    ]);
    entries[1]!.click();
    expect(editor.engine.text).toContain(`<line id="${L}" x1="10" y1="10" x2="55" y2="20" stroke="#000000" stroke-width="2"/>`);
    expect(editor.engine.text).toContain(`<line id="${M}" x1="10" y1="60" x2="55" y2="70" stroke="#000000" stroke-width="2"/>`);
    expect(spoken()).toBe("2 nodi allineati.");
    expect(changes).toHaveLength(1);
    // Maiusc+Tab va al nodo prima, anche di un'altra forma, e dice di quale.
    key("Tab", { shiftKey: true });
    expect(spoken()).toBe("Linea, Nero, nodo 1 di 2, capo: x 10, y 10.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Allineamento di nodi.");
    expect(editor.engine.text).toContain(LINES);
    for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  });

  it("«Distribuisci» spazia i nodi scelti fra il primo e l'ultimo, che restano, e chiede almeno tre nodi", () => {
    const ZIGZAG = doc(`${LAYER}<path id="${P}" d="M0 0 L10 30 L50 10 L60 40" fill="none" stroke="#000000" stroke-width="2"/></g>`);
    editing(ZIGZAG);
    const menu = (): HTMLElement[] => {
      command("Allinea i nodi").click();
      return [...[...document.querySelectorAll<HTMLElement>(".context-menu")].pop()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    };
    const entry = (label: string): HTMLElement => menu().find((each) => each.querySelector(".menu-label")!.textContent === label)!;
    tap(10, 30);
    tap(50, 10, { shiftKey: true });
    const few = entry("Distribuisci orizzontalmente");
    expect(few.getAttribute("aria-disabled")).toBe("true");
    expect(few.querySelector(".menu-description")!.textContent).toBe("Servono almeno tre nodi scelti.");
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
    key("a", { ctrlKey: true });
    expect(spoken()).toBe("4 nodi scelti.");
    entry("Distribuisci orizzontalmente").click();
    expect(d()).toBe("M0 0 L20 30 L40 10 L60 40");
    expect(spoken()).toBe("4 nodi distribuiti.");
    // In verticale, nell'ordine dell'altezza: 0, 10, 30 e 40 diventano 0,
    // 13.33, 26.67 e 40.
    entry("Distribuisci verticalmente").click();
    expect(d()).toBe("M0 0 L20 26.67 L40 13.33 L60 40");
    expect(changes).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Distribuzione di nodi.");
    expect(d()).toBe("M0 0 L20 30 L40 10 L60 40");
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("con Maiusc si aggiungono i nodi di un altro oggetto, che si trascinano insieme; Ctrl+A sceglie le forme, poi il disegno", () => {
    editing();
    tap(50, 50);
    expect(spoken()).toBe("Nodo 3 di 3, capo: x 50, y 50.");
    tap(100, 100, { shiftKey: true });
    expect(editor.selection).toEqual([P, C]);
    expect(spoken()).toBe("2 oggetti: 5 nodi da modificare. 2 nodi scelti in 2 oggetti.");
    // Un nodo si trascina con tutti quelli scelti, di ogni forma, in un passo.
    drag([[100, 100], [105, 100], [110, 110]]);
    expect(d()).toBe("M10 10 L50 10 L60 60");
    expect(d(C)).toBe("M110 110 C130 90 140 80 160 100");
    expect(spoken()).toBe("2 nodi spostati.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(d()).toBe("M10 10 L50 10 L50 50");
    expect(d(C)).toBe("M100 100 C120 80 140 80 160 100");
    // Un tocco senza Maiusc su un nodo scelto lascia scelto soltanto lui, e
    // la sua forma.
    tap(100, 100);
    expect(editor.selection).toEqual([C]);
    expect(spoken()).toBe("Tracciato, Nero: 2 nodi da modificare. Nodo 1 di 2, capo: x 100, y 100.");
    key("a", { ctrlKey: true });
    expect(spoken()).toBe("2 nodi scelti.");
    key("a", { ctrlKey: true });
    expect(editor.selection).toEqual([P, C, R]);
    expect(spoken()).toBe("9 nodi scelti in 3 oggetti.");
    key("Escape");
    expect(spoken()).toBe("Nessun nodo scelto.");
    expect(editor.selection).toEqual([P, C, R]);
    // Il trascinamento e il suo annulla.
    expect(changes).toHaveLength(2);
  });

  it("un rettangolo ha i suoi quattro nodi: portati tutti resta un rettangolo, uno solo lo fa tracciato", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([R]);
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi. Rettangolo, Nero: 4 nodi da modificare.");
    expect(nodesBar().hidden).toBe(false);
    // Dentro la forma, lontano dai bordi, si prendono tutti i nodi.
    drag([[210, 210], [220, 210], [230, 220]]);
    expect(editor.engine.text).toContain(`<rect id="${R}" x="220" y="210" width="20" height="20" fill="#000000"/>`);
    expect(spoken()).toBe("4 nodi spostati.");
    // Un tocco sul nodo in basso a destra lo sceglie da solo, e trascinarlo
    // fa della forma un tracciato, con lo stesso id e lo stesso colore.
    tap(240, 230);
    expect(spoken()).toBe("Nodo 3 di 4, spigolo: x 240, y 230.");
    drag([[240, 230], [250, 240], [260, 250]]);
    expect(editor.engine.text).toContain(`<path id="${R}" d="M220 210 L240 210 L260 250 L220 230 Z" fill="#000000"/>`);
    expect(spoken()).toBe("Nodo spostato: x 260, y 250. La forma ora è un tracciato.");
    expect(editor.selection).toEqual([R]);
    editor.undo();
    expect(editor.engine.text).toContain(`<rect id="${R}" x="220" y="210" width="20" height="20" fill="#000000"/>`);
    expect(changes).toHaveLength(3);
  });

  it("un punto su un nodo di un altro oggetto lo prende subito, e lo trascina nello stesso gesto", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([R]);
    editor.focus();
    key("n");
    drag([[50, 50], [65, 50], [90, 50]]);
    expect(editor.selection).toEqual([P]);
    expect(d()).toBe("M10 10 L50 10 L90 50");
    expect(spoken()).toBe("Nodo spostato: x 90, y 50. Agganciato: il punto in linea con il centro verticale della pagina.");
    // Dentro un oggetto pieno, il punto prende tutti i suoi nodi.
    drag([[210, 210], [215, 210], [220, 210]]);
    expect(editor.selection).toEqual([R]);
    expect(editor.engine.text).toContain(`<rect id="${R}" x="210" y="200" width="20" height="20" fill="#000000"/>`);
    expect(spoken()).toBe("4 nodi spostati.");
  });

  it("la freccia ha i due capi dell'asta: la punta segue il suo, e l'asta non si piega", () => {
    const F = "of3f3f3f3";
    const arrow = (x1: number, y1: number, x2: number, y2: number): string =>
      `<path id="${F}" fub:shape="arrow" fub:geom="${x1} ${y1} ${x2} ${y2}" d="${arrowPath(x1, y1, x2, y2, 2)}" fill="none" stroke="#000000" stroke-width="2"/>`;
    mount(doc(`${LAYER}${arrow(20, 300, 120, 300)}</g>`), { level: "expert" });
    editor.select([F]);
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi. Freccia, Nero: 2 nodi da modificare.");
    drag([[120, 300], [120, 320], [120, 340]]);
    expect(editor.engine.text).toContain(arrow(20, 300, 120, 340));
    expect(spoken()).toBe("Nodo spostato: x 120, y 340.");
    // Il punto sull'asta prende tutta la freccia.
    drag([[70, 320], [80, 320], [90, 330]]);
    expect(editor.engine.text).toContain(arrow(40, 310, 140, 350));
    expect(spoken()).toBe("2 nodi spostati.");
    // In curva no, e nemmeno un nodo in più: lo dice, e niente cambia.
    key("U", { shiftKey: true });
    expect(spoken()).toBe("Una freccia ha un’asta dritta fra due capi: per curvarla o darle altri nodi, prima «Oggetto in tracciato».");
    key("Insert");
    expect(spoken()).toBe("Una freccia ha un’asta dritta fra due capi: per curvarla o darle altri nodi, prima «Oggetto in tracciato».");
    expect(editor.engine.text).toContain(arrow(40, 310, 140, 350));
    expect(changes).toHaveLength(2);
  });

  it("un tratto a penna ha i nodi della sua spina: spostarne uno porta l'inchiostro, e il tratto resta uno", () => {
    mount(doc(`${LAYER}</g>`), { level: "expert" });
    editor.setTool("pen");
    drag([[20, 300], [40, 330], [60, 360], [80, 330], [100, 300]]);
    const id = /<path id="(o[a-z0-9]{8})" fub:tool="pen"/.exec(editor.engine.text)![1]!;
    const ink = () => decodeInk(/fub:ink="([^"]+)"/.exec(editor.engine.text)![1]!);
    const shape = () => /fub:tool="pen" [^>]* d="([^"]+)"/.exec(editor.engine.text)![1]!;
    const before = { ink: ink(), d: shape() };
    editor.select([id]);
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi. Tratto, Nero: 3 nodi da modificare.");
    // Lo spigolo in basso scende di 20: il campione lì scende con lui, i capi
    // restano, e il contorno si rifà.
    drag([[60, 360], [60, 370], [60, 380]]);
    expect(spoken()).toBe("Nodo spostato: x 60, y 380.");
    const after = ink();
    expect(inkLength(after)).toBe(inkLength(before.ink));
    const points = Array.from({ length: inkLength(after) }, (_, i) => inkPoint(after, i));
    expect(points).toContainEqual([60, 380]);
    expect(points[0]).toEqual([20, 300]);
    expect(points[points.length - 1]).toEqual([100, 300]);
    expect(shape()).not.toBe(before.d);
    expect(editor.selection).toEqual([id]);
    // Non si spezza: lo dice, e niente cambia.
    key("B", { shiftKey: true });
    expect(spoken()).toBe("Un tratto a penna resta un tratto solo e aperto: non si spezza e non si chiude.");
    editor.undo();
    expect(ink()).toEqual(before.ink);
    expect(shape()).toBe(before.d);
  });

  it("passando col puntatore, una forma mostra il contorno e i nodi prima di toccarla", () => {
    const layer = recording();
    mount(SHAPES, { level: "expert" });
    editor.select([P]);
    editor.focus();
    key("n");
    const hover = (x: number, y: number): void => {
      surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8) }));
      layer.frame();
    };
    /// I rombi dei nodi a spigolo dell'ultimo disegno: dove stanno, e quanto
    /// sono grandi.
    const diamonds = (): string[] => {
      const calls = layer.calls();
      return calls.flatMap((call, i) => {
        const next = calls[i + 1];
        if (call[0] !== "moveTo" || next?.[0] !== "lineTo") return [];
        const [x, top] = [call[1] as number, call[2] as number];
        const [right, y] = [next[1] as number, next[2] as number];
        return right - x === y - top && right > x ? [`${x},${y} r${right - x}`] : [];
      });
    };
    hover(400, 400);
    const editingOnly = diamonds();
    // I tre nodi del tracciato, grandi.
    expect(editingOnly).toEqual(expect.arrayContaining(["10,10 r5.5", "50,50 r5.5"]));
    // Sopra il rettangolo: i suoi quattro spigoli, più piccoli.
    hover(210, 210);
    expect(diamonds().filter((each) => !editingOnly.includes(each))).toEqual(["200,200 r4.5", "220,200 r4.5", "220,220 r4.5", "200,220 r4.5"]);
    // Sopra il tracciato che si modifica, o sul vuoto, niente in più.
    hover(30, 10);
    expect(diamonds()).toEqual(editingOnly);
    hover(210, 210);
    hover(400, 400);
    expect(diamonds()).toEqual(editingOnly);
    // Lo strumento Selezione non li mostra.
    editor.setTool("select");
    hover(210, 210);
    expect(diamonds()).toEqual([]);
  });

  it("una parte di un altro programma non ha nodi, e un tocco lo dice", () => {
    const G = "og5g5g5g5";
    const A = "oa5a5a5a5";
    mount(doc(
      `${LAYER}<g id="${G}"><path id="${A}" d="M10 10 L50 10" fill="none" stroke="#000000" stroke-width="2"/>`
        + `<path style="fill:none;stroke:#000000;stroke-width:2" d="M10 50 L50 50"/></g></g>`,
    ), { level: "expert" });
    editor.select([G]);
    editor.focus();
    key("n");
    // La parte dell'altro programma non si conta fra gli oggetti.
    expect(spoken()).toBe("Strumento: Nodi. Gruppo, 1 oggetto: 2 nodi da modificare.");
    tap(30, 50);
    expect(spoken()).toBe("Questa parte viene da un altro programma: FubDraw la lascia com’è, e i suoi nodi non si modificano.");
    // I nodi restano quelli della forma di prima.
    key("Home");
    expect(spoken()).toBe("Nodo 1 di 2, capo: x 10, y 10.");
    expect(changes).toEqual([]);
  });

  it("«?» elenca i tasti dei nodi, all'Esperto", () => {
    editing();
    key("?", { shiftKey: true });
    const captions = [...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent);
    expect(captions).toContain("Nodi");
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Shift+C", "Nodi a spigolo"]);
    expect(rows).toContainEqual(["Alt+F10", "Va alla barra dei nodi"]);
    expect(rows).toContainEqual(["Tab o Shift+Tab", "Il nodo dopo o prima"]);
    expect(rows).toContainEqual(["Alt", "Tenuto, un nodo trascinato tira fuori le sue maniglie, e una maniglia trascinata si sposta da sola"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  describe("le maniglie di ogni nodo", () => {
    const A = "oa6a6a6a6";
    const Q = "oq6q6q6q6";
    const F = "of6f6f6f6";
    const G = "og6g6g6g6";
    /// Una linea, mezzo giro d'arco e una cubica con la prima maniglia
    /// ritirata sul suo nodo, come la scrive la penna di Bézier.
    const MIXED = `<path id="${A}" d="M100 100 L160 100 A30 30 0 0 1 220 100 C220 100 280 160 280 100" fill="none" stroke="#000000" stroke-width="2"/>`;
    const SQUARE = `<rect id="${Q}" x="100" y="200" width="60" height="60" fill="#000000"/>`;
    const ARROW = `<path id="${F}" fub:shape="arrow" fub:geom="300 300 400 300" d="${arrowPath(300, 300, 400, 300, 2)}" fill="none" stroke="#000000" stroke-width="2"/>`;
    const FREE = { ctrlKey: true } as const;

    /// L'oggetto `id` di `source` scelto, con lo strumento Nodi; lo strato
    /// sopra registra ciò che disegna.
    const nodesOn = (source: string, ...ids: string[]): ReturnType<typeof recording> => {
      const layer = recording();
      mount(doc(`${LAYER}${source}</g>`), { level: "expert" });
      editor.select(ids);
      editor.focus();
      key("n");
      return layer;
    };
    /// Le maniglie dell'ultimo disegno, arrotondate al pixel: i punti, e
    /// quelli legati al nodo da una linea tratteggiata, le ritirate.
    const handlesIn = (layer: ReturnType<typeof recording>): { readonly dots: string[]; readonly folded: string[] } => {
      layer.frame();
      const calls = layer.calls();
      const at = (x: unknown, y: unknown): string => `${Math.round(x as number)},${Math.round(y as number)}`;
      const dots = calls.filter((call) => call[0] === "arc" && call[3] === 3).map((call) => at(call[1], call[2]));
      const folded = calls.flatMap((call, i) => {
        const end = calls[i + 3];
        return call[0] === "setLineDash" && JSON.stringify(call[1]) === "[2,2]" && end?.[0] === "lineTo" ? [at(end[1], end[2])] : [];
      });
      return { dots, folded };
    };

    it("ogni nodo scelto mostra le sue maniglie: sulle linee, sugli archi, e quella ritirata accanto, tratteggiata", () => {
      const layer = nodesOn(`${MIXED}${SQUARE}${ARROW}<rect id="or6r6r6r6" x="450" y="100" width="18" height="18" fill="#000000"/>`, A);
      tap(100, 100);
      expect(handlesIn(layer)).toEqual({ dots: ["120,100"], folded: [] });
      tap(160, 100);
      expect(handlesIn(layer)).toEqual({ dots: ["140,100", "160,83", "220,83"], folded: [] });
      tap(220, 100);
      expect(handlesIn(layer)).toEqual({ dots: ["160,83", "220,83", "234,114", "280,160"], folded: ["234,114"] });
      // La maniglia ritirata è del nodo prima: con l'ultimo si vede l'altra.
      tap(280, 100);
      expect(handlesIn(layer)).toEqual({ dots: ["280,160"], folded: [] });
      // Gli spigoli di un rettangolo, sui suoi lati.
      tap(130, 230);
      tap(100, 200);
      expect(spoken()).toBe("Nodo 1 di 4, spigolo: x 100, y 200.");
      expect(handlesIn(layer)).toEqual({ dots: ["120,200", "100,220"], folded: [] });
      // Lo stesso andando di nodo in nodo con Tab, e col riquadro.
      key("Tab");
      expect(spoken()).toBe("Nodo 2 di 4, spigolo: x 160, y 200.");
      expect(handlesIn(layer)).toEqual({ dots: ["140,200", "160,220"], folded: [] });
      drag([[270, 90], [280, 100], [290, 110]]);
      expect(spoken()).toBe("Tracciato, Nero: 4 nodi da modificare. Nodo 4 di 4, capo: x 280, y 100.");
      expect(handlesIn(layer)).toEqual({ dots: ["280,160"], folded: [] });
      // L'asta di una freccia non si piega: niente maniglie.
      tap(350, 300);
      tap(400, 300);
      expect(spoken()).toBe("Nodo 2 di 2, capo: x 400, y 300.");
      expect(handlesIn(layer).dots).toEqual([]);
      // Su un lato corto la maniglia coprirebbe il nodo: non si vede.
      tap(459, 109);
      tap(450, 100);
      expect(spoken()).toBe("Nodo 1 di 4, spigolo: x 450, y 100.");
      expect(handlesIn(layer).dots).toEqual([]);
      expect(changes).toEqual([]);
    });

    it("trascinare la maniglia di un lato lo curva, e il rettangolo diventa un tracciato, in un passo", () => {
      const layer = nodesOn(SQUARE, Q);
      tap(100, 200);
      drag([[120, 200], [120, 190], [120, 180]], FREE);
      expect(editor.engine.text).toContain(`<path id="${Q}" d="M100 200 C120 180 140 200 160 200 L160 260 L100 260 Z" fill="#000000"/>`);
      expect(spoken()).toBe("Maniglia tirata fuori. La forma ora è un tracciato.");
      // Il nodo resta scelto, e il lato curvo ha ora anche la maniglia
      // dell'altro capo.
      expect(handlesIn(layer).dots).toEqual(["120,180", "140,200", "100,220"]);
      expect(changes).toHaveLength(1);
      editor.undo();
      expect(editor.engine.text).toContain(SQUARE);
      expect(spoken()).toBe("Annullato: Spostamento di una maniglia.");
      // Col dito, allo stesso modo.
      tap(100, 200, { pointerType: "touch" });
      drag([[100, 220], [90, 230], [80, 240]], { ...FREE, pointerType: "touch" });
      expect(editor.engine.text).toContain(`<path id="${Q}" d="M100 200 L160 200 L160 260 L100 260 C100 240 80 240 100 200 Z" fill="#000000"/>`);
      expect(spoken()).toBe("Maniglia tirata fuori. La forma ora è un tracciato.");
    });

    it("la maniglia di un arco si trascina come quella delle cubiche che lo approssimano, e il nodo resta scelto", () => {
      const layer = nodesOn(`<path id="${A}" d="M100 100 L160 100 A30 30 0 0 1 220 100 L280 100" fill="none" stroke="#000000" stroke-width="2"/>`, A);
      tap(220, 100);
      expect(handlesIn(layer).dots).toEqual(["160,83", "220,83", "240,100"]);
      drag([[220, 83], [225, 75], [230, 70]], FREE);
      expect(d(A)).toBe("M100 100 L160 100 C160 83.43 173.43 70 190 70 C206.57 70 230 70.43 220 100 L280 100");
      expect(spoken()).toBe("Maniglia spostata.");
      // Il nodo in mezzo all'arco è nuovo: quello scelto resta il suo.
      expect(handlesIn(layer).dots).toEqual(["207,70", "230,70", "240,100"]);
      key("Home");
      key("End");
      expect(spoken()).toBe("Nodo 5 di 5, capo: x 280, y 100.");
      editor.undo();
      expect(d(A)).toBe("M100 100 L160 100 A30 30 0 0 1 220 100 L280 100");
    });

    it("la maniglia ritirata si tira fuori dal suo nodo", () => {
      const layer = nodesOn(MIXED, A);
      tap(220, 100);
      drag([[234, 114], [234, 130], [234, 150]], FREE);
      expect(d(A)).toBe("M100 100 L160 100 A30 30 0 0 1 220 100 C234.14 150.14 280 160 280 100");
      expect(spoken()).toBe("Maniglia tirata fuori.");
      expect(handlesIn(layer).folded).toEqual([]);
    });

    it("con Alt, trascinare un nodo ne tira fuori le maniglie, e il nodo diventa simmetrico", () => {
      const layer = nodesOn(`${SQUARE}${MIXED}`, Q, A);
      expect(spoken()).toBe("Strumento: Nodi. 2 oggetti: 8 nodi da modificare.");
      drag([[100, 200], [110, 195], [130, 190]], { ...FREE, altKey: true });
      expect(editor.engine.text).toContain(`<path id="${Q}" d="M100 200 C130 190 140 200 160 200 L160 260 L100 260 C100 240 70 210 100 200 Z" fill="#000000"/>`);
      expect(spoken()).toBe("Maniglie tirate fuori: il nodo ora è simmetrico. La forma ora è un tracciato.");
      expect(handlesIn(layer).dots).toEqual(["130,190", "140,200", "100,240", "70,210"]);
      expect(d(A)).toBe("M100 100 L160 100 A30 30 0 0 1 220 100 C220 100 280 160 280 100");
      expect(changes).toHaveLength(1);
      tap(100, 200);
      expect(spoken()).toBe("Nodo 1 di 4, simmetrico: x 100, y 200.");
      // Trascinato verso l'altro lato, la maniglia sotto il puntatore è di
      // quello.
      editor.undo();
      expect(editor.engine.text).toContain(SQUARE);
      drag([[160, 200], [150, 205], [130, 210]], { ...FREE, altKey: true });
      expect(editor.engine.text).toContain(`<path id="${Q}" d="M100 200 C120 200 130 210 160 200 C190 190 160 240 160 260 L100 260 Z" fill="#000000"/>`);
      // Un capo ha una maniglia sola; un tocco con Alt sceglie e basta.
      tap(100, 100, { altKey: true });
      expect(spoken()).toBe("Tracciato, Nero: 4 nodi da modificare. Nodo 1 di 4, capo: x 100, y 100.");
      drag([[100, 100], [100, 90], [110, 80]], { ...FREE, altKey: true });
      expect(d(A)).toBe("M100 100 C110 80 140 100 160 100 A30 30 0 0 1 220 100 C220 100 280 160 280 100");
      expect(spoken()).toBe("Maniglia tirata fuori.");
    });

    it("con Alt un tratto a penna resta un tratto, e una freccia non si piega", () => {
      const layer = nodesOn(ARROW, F);
      drag([[400, 300], [400, 290], [410, 280]], { ...FREE, altKey: true });
      expect(spoken()).toBe("Una freccia ha un’asta dritta fra due capi: per curvarla o darle altri nodi, prima «Oggetto in tracciato».");
      expect(changes).toEqual([]);
      expect(handlesIn(layer).dots).toEqual([]);
      owner.close();
      host.remove();
      host = document.createElement("div");
      document.body.append(host);
      owner = openLifetime();
      mount(doc(`${LAYER}</g>`), { level: "expert" });
      editor.setTool("pen");
      drag([[20, 300], [40, 330], [60, 360], [80, 330], [100, 300]]);
      const id = /<path id="(o[a-z0-9]{8})" fub:tool="pen"/.exec(editor.engine.text)![1]!;
      const ink = (): string => /fub:ink="([^"]+)"/.exec(editor.engine.text)![1]!;
      const before = ink();
      editor.select([id]);
      editor.focus();
      key("n");
      drag([[60, 360], [70, 360], [90, 360]], { ...FREE, altKey: true });
      expect(spoken()).toBe("Maniglie tirate fuori: il nodo ora è simmetrico.");
      expect(ink()).not.toBe(before);
      expect(editor.engine.text).toMatch(new RegExp(`<path id="${id}" fub:tool="pen"`));
      expect(inkLength(decodeInk(ink()))).toBeGreaterThanOrEqual(inkLength(decodeInk(before)));
    });

    it("con Alt una maniglia si sposta da sola, e il suo nodo diventa uno spigolo", () => {
      const S = `<path id="${A}" d="M100 100 C120 80 140 80 160 100 C180 120 200 120 220 100" fill="none" stroke="#000000" stroke-width="2"/>`;
      nodesOn(S, A);
      tap(160, 100);
      expect(spoken()).toBe("Nodo 2 di 3, simmetrico: x 160, y 100.");
      drag([[180, 120], [180, 130], [180, 140]], { ...FREE, altKey: true });
      expect(d(A)).toBe("M100 100 C120 80 140 80 160 100 C180 140 200 120 220 100");
      expect(spoken()).toBe("Maniglia spostata da sola: il nodo ora è uno spigolo.");
      tap(160, 100);
      expect(spoken()).toBe("Nodo 2 di 3, spigolo: x 160, y 100.");
      // Annullato il passo il nodo torna simmetrico, e ripetuto uno spigolo.
      editor.undo();
      tap(160, 100);
      expect(spoken()).toBe("Nodo 2 di 3, simmetrico: x 160, y 100.");
      editor.redo();
      tap(160, 100);
      expect(spoken()).toBe("Nodo 2 di 3, spigolo: x 160, y 100.");
      // Senza Alt l'altra maniglia segue quella trascinata.
      editor.undo();
      drag([[180, 120], [180, 130], [180, 140]], FREE);
      expect(d(A)).toBe("M100 100 C120 80 140 60 160 100 C180 140 200 120 220 100");
      expect(spoken()).toBe("Maniglia spostata.");
    });

    it("toccare la maniglia di una linea sceglie la linea, e il doppio tocco ci aggiunge un nodo", () => {
      editing();
      tap(50, 10);
      tap(37, 10);
      expect(spoken()).toBe("2 nodi scelti.");
      expect(d()).toBe("M10 10 L50 10 L50 50");
      tap(37, 10);
      expect(d()).toBe("M10 10 L37 10 L50 10 L50 50");
      expect(spoken()).toBe("1 nodo aggiunto.");
    });

    it("dentro un gruppo ingrandito le maniglie stanno dove si vedono, e la ritirata è lunga uguale sullo schermo", () => {
      const layer = nodesOn(`<g id="${G}" transform="translate(300 0) scale(2)"><path id="${A}" d="M0 50 C0 50 20 80 40 50 L60 50" fill="none" stroke="#000000" stroke-width="1"/></g>`, G);
      tap(300, 100);
      expect(handlesIn(layer)).toEqual({ dots: ["311,117", "340,160"], folded: ["311,117"] });
      tap(380, 100);
      expect(handlesIn(layer).dots).toEqual(["340,160", "393,100"]);
      tap(300, 100);
      drag([[311, 117], [311, 130], [311, 140]], FREE);
      expect(d(A)).toBe("M0 50 C5.55 69.82 20 80 40 50 L60 50");
      expect(spoken()).toBe("Maniglia tirata fuori.");
    });
  });
});

describe("il Costruttore di forme, dal livello Esperto", () => {
  const A = "oa7a7a7a7";
  const B = "ob7b7b7b7";
  const T = "ot7t7t7t7";
  const SHAPES = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="40" height="40" fill="#d55e00"/>`
      + `<rect id="${B}" x="20" y="20" width="40" height="40" fill="#0072b2"/>`
      + `<text id="${T}" x="0" y="200"><tspan x="0" dy="0">Ciao</tspan></text></g>`,
  );
  /// Il `d` del tracciato `id`, com'è adesso.
  const d = (id: string): string | null => new RegExp(`<path id="${id}" d="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;
  const tap = (x: number, y: number, init: Init = {}): void => drag([[x, y]], init);
  const hover = (x: number, y: number, init: Init = {}): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (clock += 8), ...init }));
  };
  const builderTool = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-tool[aria-label="Costruttore di forme"]')!;

  /// Gli oggetti `ids` scelti, col Costruttore.
  const building = (...ids: string[]): void => {
    mount(SHAPES, { level: "expert" });
    editor.select(ids);
    editor.focus();
    key("m");
  };

  it("c'è solo all'Esperto, col tasto M, e dice su quante regioni lavora", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A, B]);
    editor.focus();
    expect(builderTool().hidden).toBe(true);
    key("m");
    expect(editor.tool).not.toBe("builder");
    editor.setLevel("expert");
    expect(builderTool().hidden).toBe(false);
    expect(builderTool().title).toBe("Costruttore di forme (M)");
    key("m");
    expect(editor.tool).toBe("builder");
    expect(surface().dataset.tool).toBe("builder");
    expect(spoken()).toBe("Strumento: Costruttore di forme. 3 regioni in 2 forme.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    editor.select([A, B, T]);
    editor.setTool("builder");
    expect(spoken()).toBe("Strumento: Costruttore di forme. 3 regioni in 2 forme. 1 oggetto scelto non è una forma e resta com’è.");
    editor.select([A]);
    editor.setTool("builder");
    expect(spoken()).toBe("Strumento: Costruttore di forme. 1 regione nella forma scelta.");
    editor.select([]);
    editor.setTool("builder");
    expect(spoken()).toBe("Strumento: Costruttore di forme. Scegli le forme da unire o separare: tocca una forma, o tira un riquadro attorno a più forme.");
    expect(changes).toEqual([]);
  });

  it("su forme troppe o troppo complesse lo dice, senza regioni, e sceglie le forme come la Selezione", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `oc${i}`);
    const circles = ids.map((id, i) => `<circle id="${id}" cx="${(i % 20) * 7}" cy="${Math.floor(i / 20) * 7}" r="60" fill="#0072b2"/>`).join("");
    mount(doc(`${LAYER}${circles}</g>`), { level: "expert" });
    editor.select(ids);
    editor.focus();
    key("m");
    expect(spoken()).toBe("Strumento: Costruttore di forme. Le forme scelte sono troppe, o troppo complesse, per il Costruttore: scegline meno.");
    hover(70, 50);
    expect(surface().hasAttribute("data-region")).toBe(false);
    tap(300, 300);
    expect(editor.selection).toEqual([]);
    tap(70, 50);
    expect(editor.selection).toHaveLength(1);
    expect(spoken()).toBe("1 oggetto scelto. 1 regione nella forma scelta.");
    expect(changes).toEqual([]);
  });

  it("trascinare attraverso le regioni le unisce, con lo stile della prima, in un passo che si annulla", () => {
    building(A, B);
    drag([[10, 10], [30, 30], [50, 50]]);
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L40 0 L40 20 L60 20 L60 60 L20 60 L20 40 L0 40 Z" fill="#d55e00"/>`);
    expect(editor.engine.text).not.toContain(B);
    expect(spoken()).toBe("3 regioni unite in una forma. 1 forma, rimasta vuota, se ne va. 1 regione nella forma scelta.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Unione di regioni.");
    // La prima regione dà lo stile: da quella di B, l'unione è B, che resta
    // com'è, e A perde ciò che ne copriva.
    drag([[50, 50], [30, 30]]);
    expect(editor.engine.text).toContain(`<rect id="${B}" x="20" y="20" width="40" height="40" fill="#0072b2"/>`);
    expect(d(A)).toBe("M0 0 L40 0 L40 20 L20 20 L20 40 L0 40 Z");
    expect(spoken()).toBe("2 regioni unite in una forma. 2 regioni in 2 forme.");
  });

  it("un tocco separa la regione, con Alt la toglie; una forma intera resta com'è", () => {
    building(A, B);
    tap(30, 30);
    const piece = editor.selection.find((key) => key !== A && key !== B)!;
    expect(editor.selection).toEqual([A, B, piece]);
    expect(d(piece)).toBe("M40 40 L20 40 L20 20 L40 20 Z");
    expect(editor.engine.text).toContain(`d="M40 40 L20 40 L20 20 L40 20 Z" fill="#0072b2"/>`);
    expect(spoken()).toBe("La regione diventa una forma a sé. 3 regioni in 3 forme.");
    editor.undo();
    tap(30, 30, { altKey: true });
    expect(d(A)).toBe("M0 0 L40 0 L40 20 L20 20 L20 40 L0 40 Z");
    expect(d(B)).toBe("M40 40 L40 20 L60 20 L60 60 L20 60 L20 40 Z");
    expect(spoken()).toBe("1 regione tolta. 2 regioni in 2 forme.");
    // Il tocco, l'annulla e il tocco con Alt.
    expect(changes).toHaveLength(3);
    editor.select([A]);
    tap(10, 10);
    expect(spoken()).toBe("La regione è già una forma intera: niente è cambiato.");
    expect(changes).toHaveLength(3);
  });

  it("fuori dalle regioni, o con Maiusc, sceglie gli oggetti come la Selezione", () => {
    building(A);
    // B non è scelto: le sue regioni non ci sono, e il tocco lo sceglie.
    tap(50, 50);
    expect(editor.selection).toEqual([B]);
    expect(spoken()).toBe("1 oggetto scelto. 1 regione nella forma scelta.");
    tap(10, 10, { shiftKey: true });
    expect(editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("2 oggetti scelti. 3 regioni in 2 forme.");
    // Con Maiusc il tocco su un oggetto scelto lo toglie, anche su una
    // regione.
    tap(10, 10, { shiftKey: true });
    expect(editor.selection).toEqual([B]);
    tap(150, 150);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("Scegli le forme da unire o separare: tocca una forma, o tira un riquadro attorno a più forme.");
    drag([[-5, -5], [30, 30], [70, 70]]);
    expect(editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("2 oggetti scelti. 3 regioni in 2 forme.");
    expect(changes).toEqual([]);
  });

  it("la regione sotto il puntatore si accende, e con Alt si tratteggia", () => {
    const layer = recording();
    building(A, B);
    const drawn = (): { readonly filled: number; readonly hatched: number } => {
      layer.frame();
      const calls = layer.calls();
      return {
        filled: calls.filter((call) => call[0] === "fill" && call[1] === "evenodd").length,
        hatched: calls.filter((call) => call[0] === "clip" && call[1] === "evenodd").length,
      };
    };
    expect(drawn()).toEqual({ filled: 0, hatched: 0 });
    hover(30, 30);
    expect(drawn()).toEqual({ filled: 1, hatched: 0 });
    expect(surface().hasAttribute("data-region")).toBe(true);
    hover(31, 31, { altKey: true });
    key("Alt", { altKey: true });
    expect(drawn()).toEqual({ filled: 0, hatched: 1 });
    expect(surface().hasAttribute("data-region")).toBe(false);
    hover(150, 150);
    expect(drawn()).toEqual({ filled: 0, hatched: 0 });
    expect(surface().hasAttribute("data-region")).toBe(false);
  });

  it("dalla tastiera Tab passa fra le regioni, Spazio le sceglie, Invio le unisce, Canc le toglie, Esc le lascia", () => {
    building(A, B);
    size(400, 400);
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Regione 1 di 3, di Rettangolo, Vermiglio.");
    key("Tab");
    // Le forme che coprono la regione, dalla più in alto.
    expect(spoken()).toBe("Regione 2 di 3, di Rettangolo, Blu e Rettangolo, Vermiglio.");
    key(" ");
    expect(spoken()).toBe("Regione scelta: 1 in tutto.");
    key("Tab", { shiftKey: true });
    expect(spoken()).toBe("Regione 1 di 3, di Rettangolo, Vermiglio.");
    key("Tab");
    expect(spoken()).toBe("Regione 2 di 3, di Rettangolo, Blu e Rettangolo, Vermiglio, scelta.");
    key("End");
    expect(spoken()).toBe("Regione 3 di 3, di Rettangolo, Blu.");
    // Oltre l'ultima, il Tab esce dal foglio.
    expect(key("Tab").defaultPrevented).toBe(false);
    key(" ");
    expect(spoken()).toBe("Regione scelta: 2 in tutto.");
    key(" ");
    expect(spoken()).toBe("Regione lasciata: 1 in tutto.");
    key(" ");
    key("Enter");
    // La prima scelta, di A e di B, è di B, la più in alto: l'unione è B.
    expect(editor.engine.text).toContain(`<rect id="${B}" x="20" y="20" width="40" height="40" fill="#0072b2"/>`);
    expect(d(A)).toBe("M0 0 L40 0 L40 20 L20 20 L20 40 L0 40 Z");
    expect(spoken()).toBe("2 regioni unite in una forma. 2 regioni in 2 forme.");
    // L'annulla sceglie ciò che ha cambiato: si torna a scegliere tutte e due.
    editor.undo();
    editor.select([A, B]);
    key("Home");
    expect(spoken()).toBe("Regione 1 di 3, di Rettangolo, Vermiglio.");
    key("Delete");
    expect(d(A)).toBe("M40 40 L20 40 L20 20 L40 20 Z");
    expect(editor.engine.text).toContain(B);
    expect(spoken()).toBe("1 regione tolta. 2 regioni in 2 forme.");
    editor.undo();
    editor.select([A, B]);
    key("Tab");
    key(" ");
    key("Escape");
    expect(spoken()).toBe("Nessuna regione scelta.");
    // Senza una regione, Spazio prende quella sotto il cursore, al centro
    // della vista: qui non ce n'è.
    key(" ");
    expect(spoken()).toBe("Qui non c’è una regione: Tab passa fra le regioni.");
    key("Escape");
    expect(editor.selection).toEqual([]);
    expect(changes).toHaveLength(4);
  });
});

describe("le Forbici e il Coltello, dal livello Esperto", () => {
  const A = "oa9a9a9a9";
  const L = "ol9l9l9l9";
  const F = "of9f9f9f9";
  const T = "ot9t9t9t9";
  const RECT = `<rect id="${A}" x="0" y="0" width="100" height="50" fill="#d55e00"/>`;
  const LINE = `<line id="${L}" x1="200" y1="20" x2="300" y2="20" stroke="#000000" stroke-width="2"/>`;
  const ARROW = `<path id="${F}" fub:shape="arrow" fub:geom="300 300 400 300" d="${arrowPath(300, 300, 400, 300, 2)}" fill="none" stroke="#000000" stroke-width="2"/>`;
  const TEXT = `<text id="${T}" x="0" y="200"><tspan x="0" dy="0">Ciao</tspan></text>`;
  const SHAPES = doc(`${LAYER}${RECT}${LINE}${ARROW}${TEXT}</g>`);
  /// Il `d` del tracciato `id`, com'è adesso.
  const d = (id: string): string | null => new RegExp(`<path id="${id}" d="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;
  /// Gli id dei tracciati del disegno, in ordine.
  const paths = (): string[] => [...editor.engine.text.matchAll(/<path id="([^"]+)"/g)].map((found) => found[1]!);
  const tap = (x: number, y: number, init: Init = {}): void => drag([[x, y]], init);
  const scissorsTool = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-tool[aria-label="Forbici"]')!;

  /// Il disegno `source`, con le Forbici e niente di scelto.
  const cutting = (source = SHAPES): void => {
    mount(source, { level: "expert" });
    editor.focus();
    key("c");
  };

  it("c'è solo all'Esperto, col tasto C", () => {
    mount(SHAPES, { level: "standard" });
    editor.focus();
    expect(scissorsTool().hidden).toBe(true);
    key("c");
    expect(editor.tool).not.toBe("scissors");
    editor.setLevel("expert");
    expect(scissorsTool().hidden).toBe(false);
    expect(scissorsTool().title).toBe("Forbici (C)");
    key("c");
    expect(editor.tool).toBe("scissors");
    expect(surface().dataset.tool).toBe("scissors");
    expect(spoken()).toBe("Strumento: Forbici.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    expect(changes).toEqual([]);
  });

  it("un tocco sul contorno di una linea la taglia in due oggetti, scelti, in un passo che si annulla", () => {
    cutting();
    tap(250, 21);
    const [, piece] = paths().filter((id) => id !== F);
    expect(d(L)).toBe("M200 20 L250 20");
    expect(d(piece!)).toBe("M250 20 L300 20");
    // Il secondo pezzo sta sopra il primo, col suo aspetto.
    expect(editor.engine.text).toContain(`<path id="${L}" d="M200 20 L250 20" stroke="#000000" stroke-width="2"/>\n<path id="${piece}" d="M250 20 L300 20" stroke="#000000" stroke-width="2"/>`);
    expect(editor.selection).toEqual([L, piece]);
    expect(spoken()).toBe("Tracciato tagliato in 2 pezzi.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Taglio con le Forbici.");
    // Su un capo non c'è niente da tagliare.
    tap(200, 20);
    expect(spoken()).toBe("È un capo del tracciato: lì non c’è niente da tagliare.");
    expect(changes).toHaveLength(2);
  });

  it("una forma chiusa tagliata si apre nel punto, e di nuovo si divide; tagliata in un nodo, si apre lì", () => {
    cutting();
    tap(101, 25);
    expect(d(A)).toBe("M100 25 L100 50 L0 50 L0 0 L100 0 L100 25");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M100 25 L100 50 L0 50 L0 0 L100 0 L100 25" fill="#d55e00"/>`);
    expect(editor.selection).toEqual([A]);
    expect(spoken()).toBe("Tracciato aperto nel punto tagliato.");
    tap(50, 50);
    expect(d(A)).toBe("M100 25 L100 50 L50 50");
    expect(spoken()).toBe("Tracciato tagliato in 2 pezzi.");
    expect(editor.selection).toHaveLength(2);
    expect(d(editor.selection[1]!)).toBe("M50 50 L0 50 L0 0 L100 0 L100 25");
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    // Vicino a un nodo, si taglia nel nodo.
    tap(98, 2);
    expect(d(A)).toBe("M100 0 L100 50 L0 50 L0 0 L100 0");
  });

  it("dove non si taglia lo dice: fuori dal contorno, una freccia, un testo", () => {
    cutting();
    tap(50, 25);
    expect(spoken()).toBe("Le Forbici tagliano sul contorno: tocca il bordo di un tracciato o di una forma, o un suo nodo.");
    tap(350, 300);
    expect(spoken()).toBe("Una freccia non si taglia: prima «Oggetto in tracciato».");
    tap(10, 195);
    expect(spoken()).toBe("Un testo non ha nodi: si modifica scrivendo.");
    expect(changes).toEqual([]);
  });

  it("il puntatore sopra un contorno mostra dove si taglia", () => {
    const layer = recording();
    cutting();
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 250, clientY: 22, timeStamp: (clock += 8) }));
    layer.frame();
    // Il contorno della linea, e la croce dove taglia.
    const drawn = layer.calls().filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => `${Math.round(x as number)},${Math.round(y as number)}`);
    expect(drawn).toEqual(expect.arrayContaining(["200,20", "300,20", "247,17", "253,23", "253,17", "247,23"]));
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 150, clientY: 150, timeStamp: (clock += 8) }));
    layer.frame();
    expect(layer.calls().filter(([name]) => name === "moveTo" || name === "lineTo")).toEqual([]);
  });

  it("trascinato è il Coltello: divide la forma che attraversa da parte a parte, e taglia la linea dove la incrocia", () => {
    cutting();
    drag([[50, -20], [52, 10], [50, 40], [50, 70]]);
    expect(spoken()).toBe("1 oggetto tagliato in 2 pezzi.");
    // Il tratto è la scia del trascinamento; i due pezzi chiusi sono scelti,
    // il primo col posto e l'id del rettangolo.
    const [, piece] = editor.selection;
    expect(editor.selection).toEqual([A, piece]);
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L51.33 0 L52 10 L50 40 L50 50 L0 50 Z" fill="#d55e00"/>`);
    expect(editor.engine.text).toContain(`<path id="${piece}" d="M100 0 L100 50 L50 50 L50 40 L52 10 L51.33 0 Z" fill="#d55e00"/>`);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Taglio col Coltello.");
    // Con Alt il taglio è dritto, dal primo punto all'ultimo.
    editor.select([]);
    drag([[250, 0], [290, 20], [250, 40]], { altKey: true });
    expect(d(L)).toBe("M200 20 L250 20");
    expect(spoken()).toBe("1 oggetto tagliato in 2 pezzi.");
  });

  it("il Coltello che entra e non esce non taglia, e dice che cosa resta intero", () => {
    cutting();
    drag([[50, -20], [50, 25]]);
    expect(spoken()).toBe("Il Coltello non ha tagliato niente: una forma chiusa si divide quando il tratto la attraversa da parte a parte.");
    drag([[350, 280], [350, 320]]);
    expect(spoken()).toBe("Il Coltello non ha tagliato niente: una forma chiusa si divide quando il tratto la attraversa da parte a parte. 1 oggetto attraversato resta intero: frecce, linee a spessore variabile, tratti a penna, testi, immagini e parti di altri programmi non si tagliano.");
    expect(changes).toEqual([]);
  });

  it("con una selezione, il Coltello taglia soltanto gli oggetti scelti", () => {
    const B = "ob9b9b9b9";
    const TWO = doc(`${LAYER}${RECT}<rect id="${B}" x="0" y="100" width="100" height="50" fill="#0072b2"/></g>`);
    cutting(TWO);
    editor.select([B]);
    drag([[50, -20], [50, 200]]);
    expect(editor.engine.text).toContain(RECT);
    expect(editor.engine.text).not.toContain(`<rect id="${B}"`);
    expect(editor.selection).toHaveLength(2);
    expect(spoken()).toBe("1 oggetto tagliato in 2 pezzi.");
  });

  it("dalla tastiera: il cursore dice dove taglierebbe, Spazio e Spazio tagliano, Spazio e le frecce tirano il Coltello", () => {
    const K = "ok9k9k9k9";
    const BOX = doc(`${LAYER}<rect id="${K}" x="150" y="100" width="100" height="100" fill="#009e73"/></g>`);
    cutting(BOX);
    size(400, 300);
    key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 250, y 150: Contorno di Rettangolo, Verde, Spazio taglia qui");
    key(" ");
    key(" ");
    expect(d(K)).toBe("M250 150 L250 200 L150 200 L150 100 L250 100 L250 150");
    expect(spoken()).toBe("Tracciato aperto nel punto tagliato.");
    editor.undo();
    editor.select([]);
    key("ArrowLeft", { shiftKey: true });
    key("ArrowUp", { shiftKey: true });
    key("ArrowUp", { shiftKey: true });
    expect(spoken()).toBe("x 200, y 50");
    key(" ");
    for (let i = 0; i < 4; i++) key("ArrowDown", { shiftKey: true });
    key(" ");
    expect(spoken()).toBe("1 oggetto tagliato in 2 pezzi.");
    expect(editor.selection).toHaveLength(2);
    expect(editor.engine.text).not.toContain("<rect");
    // Esc a metà lascia il disegno com'era.
    const cut = editor.engine.text;
    key(" ");
    key("ArrowUp", { shiftKey: true });
    key("Escape");
    expect(editor.engine.text).toBe(cut);
    expect(changes).toHaveLength(3);
  });
});

describe("lo Spessore, dal livello Esperto", () => {
  const L = "ol9l9l9l9";
  const R = "or9r9r9r9";
  const D = "od9d9d9d9";
  const N = "on9n9n9n9";
  const T = "ot9t9t9t9";
  const LINE = `<line id="${L}" x1="0" y1="50" x2="100" y2="50" stroke="#000000" stroke-width="4"/>`;
  const BOX = `<rect id="${R}" x="200" y="0" width="100" height="100" fill="#d55e00" stroke="#0072b2" stroke-width="2"/>`;
  const DASHED = `<line id="${D}" x1="0" y1="200" x2="100" y2="200" stroke="#000000" stroke-width="2" stroke-dasharray="4 2"/>`;
  const BARE = `<rect id="${N}" x="200" y="200" width="50" height="50" fill="#009e73"/>`;
  const TEXT = `<text id="${T}" x="0" y="300"><tspan x="0" dy="0">Ciao</tspan></text>`;
  const SHAPES = doc(`${LAYER}${LINE}${BOX}${DASHED}${BARE}${TEXT}</g>`);
  /// La geometria della linea a spessore variabile `id`, com'è adesso.
  const geom = (id: string): string | null => new RegExp(`<path id="${id}"[^>]* fub:geom="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;
  /// Un tocco, lontano nel tempo dal precedente: non fa un doppio tocco.
  const tap = (x: number, y: number, init: Init = {}): void => {
    clock += 1000;
    drag([[x, y]], init);
  };
  const widthTool = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-tool[aria-label="Spessore"]')!;

  /// Il disegno `source`, con lo Spessore e niente di scelto.
  const widening = (source = SHAPES): void => {
    mount(source, { level: "expert" });
    editor.focus();
    key("w");
  };

  it("c'è solo all'Esperto, col tasto W", () => {
    mount(SHAPES, { level: "standard" });
    editor.focus();
    expect(widthTool().hidden).toBe(true);
    key("w");
    expect(editor.tool).not.toBe("width");
    editor.setLevel("expert");
    expect(widthTool().hidden).toBe(false);
    expect(widthTool().title).toBe("Spessore (W)");
    key("w");
    expect(editor.tool).toBe("width");
    expect(surface().dataset.tool).toBe("width");
    expect(spoken()).toBe("Strumento: Spessore.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    expect(changes).toEqual([]);
  });

  it("trascinato da un contorno lo allarga lì: la linea diventa a spessore variabile, col suo id, in un passo che si annulla", () => {
    widening();
    drag([[50, 52], [50, 54], [50, 56]]);
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 6 6 1 2 2 M0 50 L100 50");
    // Il colore del contorno la riempie, e il contorno non c'è più.
    expect(editor.engine.text).toMatch(new RegExp(`<path id="${L}" [^>]*fill="#000000"/>`));
    expect(editor.engine.text).not.toMatch(new RegExp(`<path id="${L}" [^>]*stroke=`));
    expect(spoken()).toBe("Largo 12 qui: 6 a sinistra, 6 a destra.");
    expect(editor.selection).toEqual([]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Spessore.");
    // Con Alt, soltanto il lato che si tira: sotto, a destra di chi va verso
    // destra; sopra, a sinistra.
    drag([[50, 52], [50, 56]], { altKey: true });
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 2 6 1 2 2 M0 50 L100 50");
    expect(spoken()).toBe("Largo 8 qui: 2 a sinistra, 6 a destra.");
    editor.undo();
    drag([[50, 48], [50, 44]], { altKey: true });
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 6 2 1 2 2 M0 50 L100 50");
  });

  it("premuto sulla linea, tira la parte verso cui va; preso sul lato, verso la linea lo stringe", () => {
    widening();
    drag([[50, 50], [50, 46], [50, 44]], { altKey: true });
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 8 2 1 2 2 M0 50 L100 50");
    editor.undo();
    drag([[50, 50], [50, 54]]);
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 6 6 1 2 2 M0 50 L100 50");
    editor.undo();
    // Il lato di sopra preso e tirato verso il basso: la linea si assottiglia.
    drag([[30, 48], [30, 52]]);
    expect(geom(L)).toBe("butt miter 0 2 2 0.3 0 0 1 2 2 M0 50 L100 50");
  });

  it("un punto si allarga dai suoi lati, e preso al centro scorre lungo la linea; il centro di un capo è la linea", () => {
    widening();
    drag([[50, 52], [50, 56]]);
    // Il lato di sotto del punto, a 6 dalla linea, tirato di 4: i due lati
    // crescono insieme.
    drag([[50, 56], [50, 60]]);
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 10 10 1 2 2 M0 50 L100 50");
    drag([[50, 50], [60, 52], [70, 50]]);
    expect(geom(L)).toBe("butt miter 0 2 2 0.7 10 10 1 2 2 M0 50 L100 50");
    expect(spoken()).toBe("Punto spostato al 70% della linea.");
    // Il capo non scorre: preso al centro e tirato in su, si allarga.
    drag([[0, 50], [0, 46], [0, 44]]);
    expect(geom(L)).toBe("butt miter 0 8 8 0.7 10 10 1 2 2 M0 50 L100 50");
    expect(changes).toHaveLength(4);
    for (let i = 0; i < 4; i++) editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
  });

  it("un tocco sceglie un punto; Canc lo toglie, i capi restano, Esc lo lascia", () => {
    widening();
    drag([[50, 52], [50, 56]]);
    tap(50, 50);
    expect(spoken()).toBe("Punto 2 di 3 scelto: 6 a sinistra, 6 a destra. Canc lo toglie, Invio ne apre le misure.");
    key("Delete");
    expect(geom(L)).toBe("butt miter 0 2 2 1 2 2 M0 50 L100 50");
    expect(spoken()).toBe("Punto dello spessore tolto.");
    tap(0, 52);
    expect(spoken()).toBe("Punto 1 di 2 scelto: 2 a sinistra, 2 a destra. Canc lo toglie, Invio ne apre le misure.");
    key("Delete");
    expect(spoken()).toBe("I punti ai capi della linea restano: stringili a zero per una punta.");
    key("Escape");
    expect(spoken()).toBe("Nessun punto dello spessore scelto.");
    // Senza un punto scelto, Canc non toglie niente: nemmeno la linea.
    key("Delete");
    expect(geom(L)).toBe("butt miter 0 2 2 1 2 2 M0 50 L100 50");
    // Un tocco sulla linea non aggiunge un punto: lo dice.
    tap(30, 51);
    expect(spoken()).toBe("Trascina per allargare o stringere qui: un tocco sceglie soltanto i punti dello spessore.");
    expect(changes).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Rimozione di un punto dello spessore.");
  });

  it("Invio o un doppio tocco aprono le misure del punto scelto", async () => {
    widening();
    drag([[50, 52], [50, 56]]);
    key("Enter");
    expect(dialog().textContent).toContain("Punto dello spessore");
    expect([field("left").value, field("right").value, field("at").value]).toEqual(["6", "6", "50"]);
    field("left").value = "3";
    field("at").value = "25";
    await submit();
    expect(geom(L)).toBe("butt miter 0 2 2 0.25 3 6 1 2 2 M0 50 L100 50");
    expect(spoken()).toBe("Largo 9 qui: 3 a sinistra, 6 a destra.");
    // Due tocchi su un capo: niente posizione, e senza cambiare niente,
    // niente da fare.
    clock += 1000;
    drag([[100, 52]]);
    drag([[100, 52]]);
    expect(field("at")).toBeNull();
    expect([field("left").value, field("right").value]).toEqual(["2", "2"]);
    await submit();
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(changes).toHaveLength(2);
  });

  it("una forma piena diventa un gruppo, col riempimento sotto e la linea del contorno sopra", () => {
    widening();
    // Dal bordo di sopra, verso l'interno: chi percorre il rettangolo dal suo
    // angolo in alto a sinistra lo ha a destra.
    drag([[250, 1], [250, 5]]);
    expect(editor.engine.text).toMatch(
      new RegExp(`<g id="${R}">\\s*<rect id="[^"]+" x="200" y="0" width="100" height="100" fill="#d55e00"/>\\s*<path id="[^"]+" fub:shape="width" fub:geom="butt miter 0 1 1 0.125 5 5 1 1 1 M200 0 L300 0 L300 100 L200 100 Z" d="[^"]+" fill="#0072b2"/>\\s*</g>`),
    );
    expect(spoken()).toBe("Largo 10 qui: 5 a sinistra, 5 a destra.");
    // Il punto è sulla linea nel gruppo: un tocco lo sceglie.
    tap(250, 0);
    expect(spoken()).toBe("Punto 2 di 3 scelto: 5 a sinistra, 5 a destra. Canc lo toglie, Invio ne apre le misure.");
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
  });

  it("dove non cambia spessore lo dice: fuori da un contorno, un tratteggio, una forma senza contorno, un testo", () => {
    widening();
    tap(150, 150);
    expect(spoken()).toBe("Lo Spessore lavora sui contorni: trascina da una linea, o dal bordo di una forma col contorno.");
    drag([[50, 201], [50, 210]]);
    expect(spoken()).toBe("Un contorno tratteggiato non cambia spessore: prima rendilo continuo.");
    tap(225, 225);
    expect(spoken()).toBe("Questa forma non ha un contorno che si vede: prima dagliene uno.");
    tap(10, 295);
    expect(spoken()).toBe("Testi, immagini, frecce e tratti a penna non hanno un contorno che cambia spessore.");
    expect(changes).toEqual([]);
  });

  it("il puntatore sopra un contorno mostra la linea, e il punto che un trascinamento aggiungerebbe", () => {
    const layer = recording();
    widening();
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 50, clientY: 51, timeStamp: (clock += 8) }));
    layer.frame();
    const drawn = layer.calls().filter(([name]) => name === "moveTo" || name === "lineTo").map(([, x, y]) => `${Math.round(x as number)},${Math.round(y as number)}`);
    expect(drawn).toEqual(expect.arrayContaining(["0,50", "100,50"]));
    expect(layer.calls().some(([name, x, y]) => name === "arc" && Math.round(x as number) === 50 && Math.round(y as number) === 50)).toBe(true);
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: 150, clientY: 150, timeStamp: (clock += 8) }));
    layer.frame();
    expect(layer.calls().filter(([name]) => name === "moveTo" || name === "lineTo")).toEqual([]);
  });

  it("mentre si trascina, il foglio mostra la linea nuova al posto del contorno", () => {
    widening();
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 50, clientY: 52, timeStamp: (clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 50, clientY: 58, timeStamp: (clock += 8) }));
    const line = host.querySelector<SVGElement>(`[data-scene-id="${L}"]`)!;
    const stand = line.nextElementSibling as SVGElement;
    expect([stand.localName, stand.getAttribute("d")?.slice(0, 1), stand.style.fill, line.style.stroke]).toEqual(["path", "M", "#000000", "none"]);
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 50, clientY: 58, timeStamp: (clock += 8) }));
    expect(geom(L)).toBe("butt miter 0 2 2 0.5 8 8 1 2 2 M0 50 L100 50");
  });

  it("dalla tastiera: il cursore dice la larghezza, Spazio, le frecce e Spazio allargano", () => {
    const K = "ok9k9k9k9";
    const WIDE = doc(`${LAYER}<line id="${K}" x1="100" y1="150" x2="300" y2="150" stroke="#000000" stroke-width="4"/></g>`);
    widening(WIDE);
    size(400, 300);
    key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 250, y 150: Contorno di Linea, Nero, largo 4 qui: Spazio, le frecce e Spazio lo allargano o lo stringono");
    key(" ");
    key("ArrowDown");
    key(" ");
    expect(geom(K)).toBe("butt miter 0 2 2 0.75 12 12 1 2 2 M100 150 L300 150");
    expect(spoken()).toBe("Largo 24 qui: 12 a sinistra, 12 a destra.");
    // Sul punto, il cursore lo dice.
    key("ArrowUp");
    expect(spoken()).toBe("x 250, y 150: Punto 2 di 3 dello spessore di Linea a spessore variabile, Nero: 12 a sinistra, 12 a destra");
    // Esc a metà lascia il disegno com'era.
    const wide = editor.engine.text;
    key(" ");
    key("ArrowUp", { shiftKey: true });
    key("Escape");
    expect(editor.engine.text).toBe(wide);
    expect(changes).toHaveLength(1);
  });

  it("i tasti dello Spessore stanno nell'elenco, dal livello Esperto", () => {
    widening();
    key("?", { shiftKey: true });
    const table = [...dialog().querySelectorAll("table")].find((each) => each.querySelector("caption")!.textContent === "Spessore")!;
    expect([...table.querySelectorAll("tr")].map((row) => row.querySelector("th")!.textContent)).toEqual(["Space", "Alt", "Del", "Enter", "Esc"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("«Unisci», dal livello Esperto", () => {
  const A = "oa0a0a0a0";
  const B = "ob0b0b0b0";
  const R = "or0r0r0r0";
  const T = "ot0t0t0t0";
  const FIRST = `<line id="${A}" x1="0" y1="0" x2="50" y2="0" stroke="#000000" stroke-width="2"/>`;
  const SECOND = `<path id="${B}" d="M50 50 L50 0.5" fill="none" stroke="#0072b2" stroke-width="2"/>`;
  const RECT = `<rect id="${R}" x="200" y="200" width="20" height="20" fill="#000000"/>`;
  const TEXT = `<text id="${T}" x="0" y="200"><tspan x="0" dy="0">Ciao</tspan></text>`;
  const SHAPES = doc(`${LAYER}${FIRST}${SECOND}${RECT}${TEXT}</g>`);
  const d = (id: string): string | null => new RegExp(`<path id="${id}" d="([^"]*)"`).exec(editor.engine.text)?.[1] ?? null;
  const pathButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Tracciato"]')!;

  afterEach(() => {
    for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  });

  it("Ctrl+J unisce i capi che si toccano in un tracciato solo, il più in basso, in un passo che si annulla", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([B, A]);
    editor.focus();
    key("j", { ctrlKey: true });
    expect(d(A)).toBe("M0 0 L50 0.25 L50 50");
    expect(editor.engine.text).toContain(`<path id="${A}" d="M0 0 L50 0.25 L50 50" stroke="#000000" stroke-width="2"/>`);
    expect(editor.engine.text).not.toContain(B);
    expect(editor.selection).toEqual([A]);
    expect(spoken()).toBe("Tracciati uniti: ora sono uno solo.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Unione di tracciati.");
  });

  it("un tracciato solo si chiude; capi lontani, una linea li unisce", () => {
    const OPEN = doc(`${LAYER}<path id="${B}" d="M0 0 L50 0 L50 50" fill="none" stroke="#000000" stroke-width="2"/><line id="${A}" x1="100" y1="0" x2="150" y2="0" stroke="#000000" stroke-width="2"/></g>`);
    mount(OPEN, { level: "expert" });
    editor.select([B]);
    editor.focus();
    key("j", { ctrlKey: true });
    expect(d(B)).toBe("M0 0 L50 0 L50 50 Z");
    expect(spoken()).toBe("Tracciato chiuso. 1 linea nuova unisce capi lontani.");
    editor.undo();
    editor.select([B, A]);
    key("j", { ctrlKey: true });
    // Si uniscono i capi più vicini: (50, 50) e (100, 0).
    expect(d(B)).toBe("M0 0 L50 0 L50 50 L100 0 L150 0");
    expect(spoken()).toBe("Tracciati uniti: ora sono uno solo. 1 linea nuova unisce capi lontani.");
  });

  it("dice perché non unisce, e nel menu Tracciato è spenta senza un tracciato aperto", () => {
    mount(SHAPES, { level: "expert" });
    editor.focus();
    editor.select([R]);
    key("j", { ctrlKey: true });
    expect(spoken()).toBe("Un tracciato scelto è già chiuso: si uniscono soltanto i capi di tracciati aperti.");
    editor.select([A]);
    key("j", { ctrlKey: true });
    expect(spoken()).toBe("Una linea sola non ha niente da chiudere.");
    editor.select([A, T]);
    key("j", { ctrlKey: true });
    expect(spoken()).toBe("1 oggetto scelto non è un tracciato: gruppi, testi, immagini, frecce e tratti a penna non si uniscono.");
    expect(changes).toEqual([]);
    editor.select([R]);
    pathButton().click();
    const join = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")!.textContent === "Unisci")!;
    expect(join.getAttribute("aria-disabled")).toBe("true");
    expect(join.querySelector(".menu-description")!.textContent).toBe("Fra gli oggetti scelti non c’è un tracciato aperto.");
    expect(join.querySelector(".menu-hint")!.textContent).toBe("Ctrl+J");
    for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
    editor.select([A, B]);
    pathButton().click();
    const enabled = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')].find((entry) => entry.querySelector(".menu-label")!.textContent === "Unisci")!;
    expect(enabled.getAttribute("aria-disabled")).not.toBe("true");
    enabled.click();
    expect(d(A)).toBe("M0 0 L50 0.25 L50 50");
  });

  it("sotto l'Esperto Ctrl+J non unisce", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A, B]);
    editor.focus();
    key("j", { ctrlKey: true });
    expect(changes).toEqual([]);
  });

  it("nello strumento Nodi, due capi scelti di due forme si uniscono in una, con Ctrl+J come con Maiusc+J", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A, B]);
    editor.focus();
    key("n");
    drag([[40, -10], [60, -10], [60, 10]]);
    expect(spoken()).toBe("2 nodi scelti in 2 oggetti.");
    key("j", { ctrlKey: true });
    expect(d(A)).toBe("M0 0 L50 0.25 L50 50");
    expect(editor.engine.text).not.toContain(B);
    expect(spoken()).toBe("Capi uniti: le due forme ora sono un tracciato solo. La forma ora è un tracciato.");
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
  });
});

describe("la penna di Bézier, dal livello Esperto", () => {
  const EMPTY = doc(`${LAYER}</g>`);
  const R = "or3r3r3r3";
  const WITH_RECT = doc(`${LAYER}<rect id="${R}" x="200" y="200" width="20" height="20" fill="#000000"/></g>`);
  /// Il tracciato scritto: tutto l'elemento, o il suo `d`.
  const PATH = /<path id="o[a-z0-9]{8}" d="([^"]*)"([^>]*)\/>/;
  const written = (): string | null => PATH.exec(editor.engine.text)?.[1] ?? null;
  const look = (): string | null => PATH.exec(editor.engine.text)?.[2] ?? null;
  /// Il `d` dell'anteprima, nelle coordinate del livello.
  const preview = (): string | null => host.querySelector(".draw-preview path")?.getAttribute("d") ?? null;
  const tap = (x: number, y: number, init: Init = {}): void => drag([[x, y]], init);
  const bezierTool = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-tool[aria-label="Bézier"]')!;
  const undoButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-toolbar button[aria-label="Annulla"]')!;
  const redoButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-toolbar button[aria-label="Ripeti"]')!;
  /// Preme la voce `label` del menu dei livelli.
  const chooseLayer = (label: string): void => {
    host.querySelector<HTMLButtonElement>(".draw-layer-button")!.click();
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.querySelector(".menu-label")!.textContent === label)!.click();
  };

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  /// Un disegno vuoto all'Esperto, con la penna di Bézier.
  /// La penna, senza le guide intelligenti, che hanno i loro casi.
  const drawing = (source = EMPTY): void => {
    mount(source, { level: "expert", grid: { shown: false, snap: false, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } });
    editor.focus();
    key("b");
  };

  it("c'è solo all'Esperto, col tasto B, dopo le forme", () => {
    mount(EMPTY, { level: "standard" });
    editor.focus();
    expect(bezierTool().hidden).toBe(true);
    key("b");
    expect(editor.tool).toBe("pen");
    editor.setLevel("expert");
    expect(bezierTool().hidden).toBe(false);
    expect(bezierTool().title).toBe("Bézier (B)");
    const tools = [...host.querySelectorAll<HTMLButtonElement>(".draw-tool:not([hidden])")].map((control) => control.dataset.tool);
    expect(tools.slice(tools.indexOf("arrow"))).toEqual(["arrow", "polygon", "bezier", "text"]);
    key("b");
    expect(editor.tool).toBe("bezier");
    expect(bezierTool().getAttribute("aria-checked")).toBe("true");
    expect(spoken()).toBe("Strumento: Bézier.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un tocco mette uno spigolo, e Invio scrive il tracciato in un passo che si annulla", () => {
    drawing();
    tap(10, 10);
    expect(spoken()).toBe("Nodo 1, spigolo: x 10, y 10.");
    expect(preview()).toBeNull();
    tap(50, 10);
    expect(spoken()).toBe("Nodo 2, spigolo: x 50, y 10.");
    expect(preview()).toBe("M10 10 L50 10");
    tap(50, 50);
    expect(preview()).toBe("M10 10 L50 10 L50 50");
    // Finché si disegna, il disegno non cambia.
    expect(changes).toEqual([]);
    key("Enter");
    expect(written()).toBe("M10 10 L50 10 L50 50");
    expect(look()).toBe(' fill="none" stroke="#000000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"');
    expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 1 oggetto.");
    expect(changes).toHaveLength(1);
    expect(preview()).toBeNull();
    // Invio di nuovo apre le proprietà, come sempre: il tracciato è finito.
    editor.undo();
    expect(editor.engine.text).toBe(EMPTY);
    expect(spoken()).toBe("Annullato: Tracciato.");
  });

  it("un trascinamento mette un nodo simmetrico, e un tocco sull'ultimo nodo conclude", () => {
    drawing();
    editor.setColor("#0072b2");
    editor.setWidth(8);
    tap(10, 10);
    drag([[50, 10], [55, 20], [60, 30]]);
    expect(spoken()).toBe("Nodo 2, simmetrico: x 50, y 10.");
    expect(preview()).toBe("M10 10 C10 10 40 -10 50 10");
    tap(90, 10);
    expect(preview()).toBe("M10 10 C10 10 40 -10 50 10 C60 30 90 10 90 10");
    // Il secondo tocco di un doppio clic cade sull'ultimo nodo, anche se
    // trema un poco.
    drag([[91, 11], [92, 12]]);
    expect(written()).toBe("M10 10 C10 10 40 -10 50 10 C60 30 90 10 90 10");
    expect(look()).toBe(' fill="none" stroke="#0072b2" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"');
    expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 1 oggetto.");
    // Il tracciato dopo comincia da capo.
    tap(200, 200);
    expect(spoken()).toBe("Nodo 1, spigolo: x 200, y 200.");
  });

  it("un tocco sul primo nodo chiude il tracciato; trascinato, il primo nodo diventa simmetrico", () => {
    drawing();
    tap(0, 0);
    tap(40, 0);
    tap(40, 40);
    tap(2, 1);
    expect(written()).toBe("M0 0 L40 0 L40 40 Z");
    // Un tracciato chiuso non ha capi.
    expect(look()).toBe(' fill="none" stroke="#000000" stroke-width="4" stroke-linejoin="round"');
    expect(spoken()).toBe("Tracciato chiuso aggiunto. Il disegno ha 1 oggetto.");
    editor.undo();
    tap(100, 0);
    tap(140, 0);
    tap(140, 40);
    drag([[100, 0], [100, -10], [100, -20]]);
    expect(written()).toBe("M100 0 C100 -20 140 0 140 0 L140 40 C140 40 100 20 100 0 Z");
    editor.undo();
    // Riportato sul primo nodo, il trascinamento chiude con uno spigolo.
    tap(100, 0);
    tap(140, 0);
    tap(140, 40);
    drag([[100, 0], [110, 0], [100.5, 0]]);
    expect(written()).toBe("M100 0 L140 0 L140 40 Z");
    // Un nodo solo non si chiude: il tocco lo conclude.
    tap(300, 300);
    tap(301, 300);
    expect(spoken()).toBe("Un tracciato vuole almeno due nodi in punti diversi: non c’è niente da scrivere.");
    expect(changes).toHaveLength(5);
  });

  it("trascinare dall'ultimo nodo ne cambia la maniglia d'uscita: lo spigolo dopo una curva", () => {
    drawing();
    drag([[0, 0], [10, 0], [20, 0]]);
    expect(spoken()).toBe("Nodo 1, simmetrico: x 0, y 0.");
    drag([[40, 0], [40, 10], [40, 20]]);
    expect(spoken()).toBe("Nodo 2, simmetrico: x 40, y 0.");
    drag([[40, 0], [50, 0], [60, 0]]);
    expect(spoken()).toBe("Nodo 2, spigolo: x 40, y 0.");
    tap(80, 0);
    expect(preview()).toBe("M0 0 C20 0 40 -20 40 0 C60 0 80 0 80 0");
    // Una maniglia riportata sul suo nodo non c'è: il trascinamento non
    // conclude il tracciato.
    drag([[80, 0], [90, 0], [80.5, 0]]);
    expect(spoken()).toBe("Nodo 3, spigolo: x 80, y 0.");
    expect(changes).toEqual([]);
    // Così un nodo nuovo trascinato e riportato al suo posto è uno spigolo, e
    // il segmento una linea.
    drag([[120, 0], [130, 0], [120.5, 0]]);
    expect(spoken()).toBe("Nodo 4, spigolo: x 120, y 0.");
    key("Enter");
    expect(written()).toBe("M0 0 C20 0 40 -20 40 0 C60 0 80 0 80 0 L120 0");
  });

  it("Maiusc porta i nodi e le maniglie a passi di 15°, e la griglia li aggancia", () => {
    drawing();
    // La maniglia a 0°, e il nodo dopo a 15° dal primo.
    drag([[100, 0], [110, 1], [120, 2]], { shiftKey: true });
    tap(148, 14, { shiftKey: true });
    key("Enter");
    expect(written()).toBe("M100 0 C120.1 0 148.3 12.94 148.3 12.94");
    editor.undo();
    editor.setGrid({ shown: false, snap: true, step: 10, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    tap(1, 2);
    drag([[38, 41], [44, 47], [52, 49]]);
    // Ctrl lascia il punto libero.
    tap(73, 77, { ctrlKey: true });
    key("Enter");
    expect(written()).toBe("M0 0 C0 0 30 30 40 40 C50 50 73 77 73 77");
    // Due nodi sullo stesso incrocio non fanno un tracciato.
    editor.setGrid({ shown: false, snap: true, step: 50, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE });
    tap(0, 0);
    tap(20, 0);
    expect(spoken()).toBe("Nodo 2, spigolo: x 0, y 0.");
    expect(preview()).toBeNull();
    const before = editor.engine.text;
    key("Enter");
    expect(spoken()).toBe("Un tracciato vuole almeno due nodi in punti diversi: non c’è niente da scrivere.");
    expect(editor.engine.text).toBe(before);
  });

  it("Canc toglie l'ultimo nodo, e Annulla e Ripeti percorrono i passi del tracciato", () => {
    drawing();
    expect(undoButton().disabled).toBe(true);
    tap(10, 10);
    tap(50, 10);
    drag([[50, 10], [60, 10], [70, 10]]);
    expect(spoken()).toBe("Nodo 2, spigolo: x 50, y 10.");
    expect(undoButton().disabled).toBe(false);
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);
    editor.undo();
    expect(spoken()).toBe("Annullato: Maniglia del nodo 2.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Nodo 2.");
    expect(preview()).toBeNull();
    expect(redoButton().disabled).toBe(false);
    editor.redo();
    expect(spoken()).toBe("Ripetuto: Nodo 2.");
    expect(preview()).toBe("M10 10 L50 10");
    key("Delete");
    expect(spoken()).toBe("Nodo 2 eliminato.");
    expect(preview()).toBeNull();
    // Un passo nuovo toglie quelli da ripetere.
    expect(editor.canRedo).toBe(false);
    key("Backspace");
    expect(spoken()).toBe("Nodo 1 eliminato.");
    // Il tracciato vuoto tiene i suoi passi: Annulla rimette il nodo, anche
    // dopo un Ripeti che non aveva niente da fare.
    expect(editor.canUndo).toBe(true);
    editor.redo();
    key("z", { ctrlKey: true });
    expect(spoken()).toBe("Annullato: Eliminazione del nodo 1.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Eliminazione del nodo 2.");
    expect(preview()).toBe("M10 10 L50 10");
    editor.undo();
    editor.undo();
    expect(spoken()).toBe("Annullato: Nodo 1.");
    // Senza nodi e senza passi, Annulla torna al disegno, che non ne ha: i
    // passi da ripetere restano.
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.undo();
    editor.redo();
    expect(spoken()).toBe("Ripetuto: Nodo 1.");
    tap(30, 30);
    key("Enter");
    expect(written()).toBe("M10 10 L30 30");
    expect(changes).toHaveLength(1);
  });

  it("Annulla e Ripeti tornano al disegno quando il tracciato non ha più passi", () => {
    drawing();
    tap(10, 10);
    tap(50, 10);
    key("Enter");
    tap(10, 50);
    editor.undo();
    expect(spoken()).toBe("Annullato: Nodo 1.");
    // Il tracciato vuoto lascia il posto al disegno, e i suoi passi vanno.
    editor.undo();
    expect(spoken()).toBe("Annullato: Tracciato.");
    expect(editor.engine.text).toBe(EMPTY);
    editor.redo();
    expect(spoken()).toBe("Ripetuto: Tracciato.");
    expect(written()).toBe("M10 10 L50 10");
    // Mentre il tracciato ha nodi, Ripeti non tocca il disegno.
    editor.undo();
    tap(10, 50);
    expect(editor.canRedo).toBe(false);
    editor.redo();
    expect(editor.engine.text).toBe(EMPTY);
  });

  it("Esc conclude il tracciato; a metà gesto annulla solo il gesto", () => {
    drawing();
    tap(10, 10);
    key("Escape");
    expect(spoken()).toBe("Un tracciato vuole almeno due nodi in punti diversi: non c’è niente da scrivere.");
    expect(changes).toEqual([]);
    tap(10, 10);
    tap(50, 50);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 90, clientY: 10 }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 100, clientY: 20 }));
    expect(preview()).toBe("M10 10 L50 50 C50 50 80 0 90 10");
    key("Escape");
    expect(preview()).toBe("M10 10 L50 50");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 100, clientY: 20 }));
    expect(changes).toEqual([]);
    key("Escape");
    expect(written()).toBe("M10 10 L50 50");
    expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 1 oggetto.");
    // Senza tracciato, Esc fa ciò che faceva.
    editor.select([editor.engine.text.match(/<path id="(o[a-z0-9]{8})"/)![1]!]);
    key("Escape");
    expect(editor.selection).toEqual([]);
  });

  it("cambiare strumento o livello conclude il tracciato; la sola lettura e un altro documento lo buttano", () => {
    const paths = (): number => editor.engine.text.match(/<path /g)?.length ?? 0;
    drawing();
    tap(10, 10);
    tap(50, 10);
    key("v");
    expect(written()).toBe("M10 10 L50 10");
    expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 1 oggetto. Strumento: Selezione.");
    key("b");
    tap(10, 100);
    editor.setTool("pen");
    expect(spoken()).toBe("Un tracciato vuole almeno due nodi in punti diversi: non c’è niente da scrivere. Strumento: Penna.");
    key("b");
    tap(10, 200);
    tap(50, 200);
    editor.setLevel("standard");
    expect(editor.tool).toBe("pen");
    expect(paths()).toBe(2);
    expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 2 oggetti.");
    editor.setLevel("expert");
    key("b");
    tap(10, 300);
    tap(50, 300);
    editor.setReadOnly(true);
    expect(preview()).toBeNull();
    editor.setReadOnly(false);
    tap(90, 300);
    key("Enter");
    expect(spoken()).toBe("Un tracciato vuole almeno due nodi in punti diversi: non c’è niente da scrivere.");
    expect(paths()).toBe(2);
    tap(10, 10);
    editor.load(SceneEngine.open(EMPTY));
    expect(preview()).toBeNull();
    expect(editor.canUndo).toBe(false);
    expect(changes).toHaveLength(2);
  });

  it("da tastiera: Spazio mette i nodi al cursore, e le frecce ne tirano le maniglie", () => {
    drawing(WITH_RECT);
    editor.select([R]);
    // Con la penna le frecce muovono il cursore, mai la selezione.
    key("ArrowRight");
    expect(spoken()).toBe("x 10, y 0");
    key(" ");
    key(" ");
    expect(spoken()).toBe("Nodo 1, spigolo: x 10, y 0.");
    for (let i = 0; i < 4; i++) key("ArrowRight");
    key(" ");
    key("ArrowDown");
    key("ArrowDown");
    key(" ");
    expect(spoken()).toBe("Nodo 2, simmetrico: x 50, y 0.");
    key("ArrowUp");
    key("ArrowUp");
    expect(spoken()).toBe("x 50, y 0: Ultimo nodo, Spazio conclude il tracciato");
    for (let i = 0; i < 4; i++) key("ArrowLeft");
    expect(spoken()).toBe("x 10, y 0: Primo nodo, Spazio chiude il tracciato");
    expect(changes).toEqual([]);
    key(" ");
    key(" ");
    expect(written()).toBe("M10 0 C10 0 50 -20 50 0 C50 20 10 0 10 0 Z");
    expect(spoken()).toBe("Tracciato chiuso aggiunto. Il disegno ha 2 oggetti.");
    expect(editor.selection).toEqual([R]);
  });

  it("scrive nelle coordinate del livello, anche trasformato", () => {
    drawing(doc(`<g id="l1" fub:layer="Livello 1" transform="matrix(2 0 0 2 100 0)"></g>`));
    tap(100, 0);
    drag([[140, 0], [150, 10], [160, 20]]);
    expect(host.querySelector(".draw-preview g g")!.getAttribute("transform")).toBe("matrix(2 0 0 2 100 0)");
    expect(preview()).toBe("M0 0 C0 0 10 -10 20 0");
    key("Enter");
    expect(written()).toBe("M0 0 C0 0 10 -10 20 0");
    expect(editor.engine.text).toContain('stroke-width="4"');
  });

  it("fra il primo e l'ultimo nodo, vicini, un tocco prende il più vicino", () => {
    drawing();
    for (const [x, y] of [[0, 0], [100, 0], [20, 0], [8, 0]] as const) tap(x, y);
    expect(written()).toBe("M0 0 L100 0 L20 0 Z");
    editor.undo();
    for (const [x, y] of [[0, 0], [100, 0], [20, 0], [12, 0]] as const) tap(x, y);
    expect(written()).toBe("M0 0 L100 0 L20 0");
    // La pagina si allarga quando il tracciato, col suo spessore, ne esce.
    expect(editor.engine.text).toContain('viewBox="-256 -256 612 356"');
    // Un nodo solo è l'ultimo: trascinarlo ne tira la maniglia, e il
    // tracciato continua.
    tap(300, 0);
    drag([[300, 0], [310, 0], [320, 0]]);
    expect(spoken()).toBe("Nodo 1, spigolo: x 300, y 0.");
    tap(340, 20);
    expect(preview()).toBe("M300 0 C320 0 340 20 340 20");
  });

  it("Maiusc, il colore e lo spessore cambiano subito l'anteprima, e Canc e Invio aspettano la fine del gesto", () => {
    drawing();
    tap(0, 0);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 50, clientY: 0 }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 70, clientY: 2 }));
    expect(preview()).toBe("M0 0 C0 0 30 -2 50 0");
    key("Shift", { shiftKey: true });
    expect(preview()).toBe("M0 0 C0 0 29.9 0 50 0");
    target.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    expect(preview()).toBe("M0 0 C0 0 30 -2 50 0");
    key("Delete");
    key("Enter");
    expect(preview()).toBe("M0 0 C0 0 30 -2 50 0");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 70, clientY: 2 }));
    expect(spoken()).toBe("Nodo 2, simmetrico: x 50, y 0.");
    editor.setColor("#0072b2");
    expect(host.querySelector(".draw-preview path")!.getAttribute("stroke")).toBe("#0072b2");
    editor.setWidth(8);
    expect(host.querySelector(".draw-preview path")!.getAttribute("stroke-width")).toBe("8");
    // Canc toglie l'ultimo nodo, non il primo.
    tap(100, 0);
    key("Delete");
    expect(preview()).toBe("M0 0 C0 0 30 -2 50 0");
  });

  it("un livello bloccato non riceve i nodi, e il tracciato aspetta che riceva", () => {
    const LOCKED = "«Livello 1» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.";
    drawing();
    tap(10, 10);
    tap(50, 10);
    chooseLayer("Blocca «Livello 1»");
    tap(90, 10);
    expect(spoken()).toBe(LOCKED);
    key("Enter");
    expect(preview()).toBe("M10 10 L50 10");
    expect(written()).toBeNull();
    chooseLayer("Sblocca «Livello 1»");
    key("Enter");
    expect(written()).toBe("M10 10 L50 10");
    // Cambiare strumento lo butta, e lo dice.
    tap(10, 50);
    tap(50, 50);
    chooseLayer("Blocca «Livello 1»");
    key("v");
    expect(spoken()).toBe(`${LOCKED} Strumento: Selezione.`);
    expect(preview()).toBeNull();
    expect(editor.engine.text.match(/<path /g)).toHaveLength(1);
  });

  it("si scrive sul livello corrente quando si conclude, e l'anteprima lo segue", () => {
    drawing(doc(`${LAYER}</g><g id="l2" fub:layer="Sopra" transform="matrix(2 0 0 2 100 0)"></g>`));
    const transform = (): string | null => host.querySelector(".draw-preview g g")!.getAttribute("transform");
    tap(100, 0);
    tap(140, 0);
    expect(transform()).toBe("matrix(2 0 0 2 100 0)");
    expect(preview()).toBe("M0 0 L20 0");
    chooseLayer("Livello 1");
    tap(140, 40);
    expect(transform()).toBe("matrix(1 0 0 1 0 0)");
    expect(preview()).toBe("M100 0 L140 0 L140 40");
    key("Enter");
    expect(editor.engine.text).toMatch(/<g id="l1" fub:layer="Livello 1">\s*<path id="o[a-z0-9]{8}" d="M100 0 L140 0 L140 40"/);
  });

  it("i tasti della penna stanno nell'elenco, dal livello Esperto", () => {
    drawing();
    key("?", { shiftKey: true });
    const table = [...dialog().querySelectorAll("table")].find((each) => each.querySelector("caption")!.textContent === "Bézier")!;
    expect([...table.querySelectorAll("tr")].map((row) => row.querySelector("th")!.textContent)).toEqual(["Space", "Shift", "Enter o Esc", "Del"]);
    const curves = [...dialog().querySelectorAll("table")].find((each) => each.querySelector("caption")!.textContent === "Curvatura")!;
    expect([...curves.querySelectorAll("tr")].map((row) => row.querySelector("th")!.textContent)).toEqual(["B", "Space", "Shift+C", "Shift+S", "Alt"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  describe("la Curvatura", () => {
    const control = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-tool[data-tool="bezier"]')!;
    /// La penna nel modo Curvatura.
    const curving = (source = EMPTY): void => {
      drawing(source);
      key("b");
    };
    /// Il tocco dopo non è il secondo di un doppio tocco.
    const later = (): void => {
      clock += 1000;
    };

    it("è la penna premuta di nuovo, col suo nome e la sua icona, e ritorno", () => {
      drawing();
      const glyph = control().querySelector("svg")!.innerHTML;
      key("b");
      expect(editor.tool).toBe("bezier");
      expect(spoken()).toBe("Strumento: Curvatura.");
      expect(control().getAttribute("aria-label")).toBe("Curvatura");
      expect(control().title).toBe("Curvatura (B)");
      expect(control().querySelector("svg")!.innerHTML).not.toBe(glyph);
      expect(formatIssues(checkAccessibility(host))).toBe("");
      key("b");
      expect(spoken()).toBe("Strumento: Bézier.");
      expect(control().title).toBe("Bézier (B)");
      expect(control().querySelector("svg")!.innerHTML).toBe(glyph);
    });

    it("tre punti fanno un arco: la curva passa morbida per tutti", () => {
      curving();
      tap(0, 100);
      expect(spoken()).toBe("Nodo 1, liscio: x 0, y 100.");
      tap(50, 50);
      tap(100, 100);
      expect(spoken()).toBe("Nodo 3, liscio: x 100, y 100.");
      expect(preview()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100");
      expect(changes).toEqual([]);
      key("Enter");
      expect(written()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100");
      expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 1 oggetto.");
      expect(changes).toHaveLength(1);
    });

    it("quattro punti chiusi fanno un cerchio", () => {
      curving();
      for (const [x, y] of [[100, 50], [150, 100], [100, 150], [50, 100], [101, 51]] as const) tap(x, y);
      expect(written()).toBe("M100 50 C127.61 50 150 72.39 150 100 C150 127.61 127.61 150 100 150 C72.39 150 50 127.61 50 100 C50 72.39 72.39 50 100 50 Z");
      expect(spoken()).toBe("Tracciato chiuso aggiunto. Il disegno ha 1 oggetto.");
    });

    it("col doppio tocco, o con Alt, uno spigolo; fra due spigoli una linea", () => {
      curving();
      tap(0, 100);
      tap(0, 100);
      expect(spoken()).toBe("Nodo 1, spigolo: x 0, y 100.");
      tap(50, 50);
      tap(100, 100, { altKey: true });
      expect(spoken()).toBe("Nodo 3, spigolo: x 100, y 100.");
      tap(150, 100, { altKey: true });
      expect(preview()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100 L150 100");
      // Il doppio tocco ha posato uno spigolo in un passo solo.
      for (let i = 0; i < 4; i++) editor.undo();
      expect(spoken()).toBe("Annullato: Nodo 1.");
      expect(editor.canUndo).toBe(false);
    });

    it("un trascinamento sposta un punto, un tocco in mezzo lo fa spigolo, e Annulla percorre i passi", () => {
      curving();
      tap(0, 100);
      tap(50, 50);
      tap(100, 100);
      drag([[50, 50], [50, 30], [50, 0]]);
      expect(spoken()).toBe("Nodo 2, liscio: x 50, y 0.");
      expect(preview()).toMatch(/^M0 100 C[^L]* 50 0 C[^L]* 100 100$/);
      tap(50, 0);
      expect(spoken()).toBe("Nodo 2, spigolo: x 50, y 0.");
      expect(preview()).toBe("M0 100 L50 0 L100 100");
      editor.undo();
      expect(spoken()).toBe("Annullato: Tipo del punto 2.");
      expect(preview()).toMatch(/^M0 100 C[^L]* 50 0 C[^L]* 100 100$/);
      editor.undo();
      expect(spoken()).toBe("Annullato: Spostamento del punto 2.");
      expect(preview()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100");
      expect(changes).toEqual([]);
    });

    it("un tocco sull'ultimo punto conclude, ma non subito dopo averlo posato", () => {
      curving();
      tap(0, 100);
      tap(50, 50);
      later();
      tap(50, 50);
      expect(written()).toBe("M0 100 L50 50");
      expect(spoken()).toBe("Tracciato aggiunto. Il disegno ha 1 oggetto.");
    });

    it("da tastiera: Spazio posa i punti, Maiusc+C e Maiusc+S ne cambiano il tipo", () => {
      curving();
      for (let i = 0; i < 10; i++) key("ArrowDown");
      key(" ");
      key(" ");
      expect(spoken()).toBe("Nodo 1, liscio: x 0, y 100.");
      for (let i = 0; i < 5; i++) key("ArrowRight");
      for (let i = 0; i < 5; i++) key("ArrowUp");
      key(" ");
      key(" ");
      for (let i = 0; i < 5; i++) key("ArrowRight");
      for (let i = 0; i < 5; i++) key("ArrowDown");
      key(" ");
      key(" ");
      expect(spoken()).toBe("Nodo 3, liscio: x 100, y 100.");
      expect(preview()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100");
      // Sul punto in mezzo il cursore lo dice, e Maiusc+C lo fa spigolo.
      for (let i = 0; i < 5; i++) key("ArrowLeft");
      for (let i = 0; i < 5; i++) key("ArrowUp");
      expect(spoken()).toBe("x 50, y 50: Nodo 2, liscio: x 50, y 50. Spazio lo fa liscio o spigolo");
      key("C", { shiftKey: true });
      expect(spoken()).toBe("Nodo 2, spigolo: x 50, y 50.");
      expect(preview()).toBe("M0 100 L50 50 L100 100");
      key("S", { shiftKey: true });
      expect(preview()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100");
      key("S", { shiftKey: true });
      expect(spoken()).toBe("È già così: niente da cambiare. Nodo 2, liscio: x 50, y 50.");
      key("Enter");
      expect(written()).toBe("M0 100 C0 72.39 22.39 50 50 50 C77.61 50 100 72.39 100 100");
    });

    describe("su un tracciato scelto", () => {
      const LINE = doc(`${LAYER}<path id="opathpath" d="M0 100 L200 100" fill="none" stroke="#000000"/></g>`);
      const RECT = doc(`${LAYER}<rect id="orectrect" x="0" y="0" width="100" height="50" fill="#000000"/></g>`);

      it("trascinato da un segmento, vi posa un punto e la curva lo segue", () => {
        curving(LINE);
        editor.select(["opathpath"]);
        drag([[100, 100], [100, 50], [100, 0]]);
        expect(written()).toBe("M0 100 C0 44.77 44.77 0 100 0 C155.23 0 200 44.77 200 100");
        expect(spoken()).toBe("Nodo spostato: x 100, y 0.");
        expect(editor.selection).toEqual(["opathpath"]);
        editor.undo();
        expect(editor.engine.text).toBe(LINE);
      });

      it("due tocchi su un punto lo fanno spigolo; un tocco lo sceglie, e Canc lo toglie", () => {
        curving(LINE);
        editor.select(["opathpath"]);
        drag([[100, 100], [100, 50], [100, 0]]);
        later();
        tap(100, 0);
        tap(100, 0);
        expect(written()).toBe("M0 100 L100 0 L200 100");
        expect(spoken()).toBe("1 nodo a spigolo.");
        editor.undo();
        later();
        tap(100, 0);
        key("Delete");
        expect(written()).toBe("M0 100 L200 100");
        expect(spoken()).toBe("1 nodo eliminato.");
        // Un tocco sul segmento posa un punto, e il tracciato non cambia.
        later();
        tap(50, 100);
        expect(written()).toBe("M0 100 L50 100 L200 100");
        expect(spoken()).toBe("1 nodo aggiunto.");
      });

      it("lo spigolo di un rettangolo si sposta coi suoi lati diritti", () => {
        curving(RECT);
        editor.select(["orectrect"]);
        drag([[100, 0], [110, 0], [120, 0]]);
        expect(editor.engine.text).toMatch(/<path id="orectrect" d="M0 0 L120 0 L100 50 L0 50 Z"/);
      });

      it("con un tracciato in corso, i punti sono suoi", () => {
        curving(LINE);
        editor.select(["opathpath"]);
        tap(300, 300);
        tap(100, 100);
        expect(spoken()).toBe("Nodo 2, liscio: x 100, y 100.");
        key("Enter");
        expect(editor.engine.text.match(/<path /g)).toHaveLength(2);
      });
    });
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
    mount(SOURCE, { imageCodec: codec(100, 50), level: "standard", grid: { shown: false, snap: true, step: 20, guides: false, steps: {}, rulers: false, rulerGuides: true, panel: null, bar: true, shapes: true, closed: ["transform", "attributes"], twist: true, taps: true, pen: DEFAULT_CURVE } });
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
    [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((control) => control.getAttribute("aria-label") === "Immagine dal vault…")!;
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
    key("y", { ctrlKey: true });
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
    key("y", { ctrlKey: true });
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

  const shownTools = (): string[] =>
    [...host.querySelectorAll<HTMLButtonElement>(".draw-tool:not([hidden])")].map((control) => control.getAttribute("aria-label") ?? "");
  /// Se nella barra degli strumenti si vede il pulsante `label`.
  const visible = (label: string): boolean =>
    [...host.querySelectorAll<HTMLButtonElement>(".draw-toolbar button")].some(
      (control) => control.getAttribute("aria-label") === label && control.closest("[hidden]") === null,
    );
  const bar = (): HTMLElement => host.querySelector<HTMLElement>(".draw-arrange")!;
  const barButtons = (): string[] => [...bar().querySelectorAll<HTMLButtonElement>("button:not([hidden])")].map((control) => control.getAttribute("aria-label") ?? "");
  const hint = (): string => document.getElementById(surface().getAttribute("aria-describedby")!)?.textContent ?? "";

  it("ha le parti scelte una per una, e i tasti e i comandi delle altre non partono", () => {
    mount(PARTS, { level: "custom", custom: ["rect", "ellipse", "layers", "boolean", "futuro"] });
    expect(editor.level).toBe("custom");
    // Un nome che l'editor non conosce non conta.
    expect([...editor.features]).toEqual(["rect", "ellipse", "layers", "boolean"]);
    // Senza la penna si comincia dal primo strumento che disegna.
    expect(editor.tool).toBe("rect");
    expect(shownTools()).toEqual(["Selezione", "Rettangolo", "Ellisse"]);
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
    expect(barButtons()).toEqual(["Sposta in un livello", "Operazioni booleane"]);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("g", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("M", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(hint()).toContain("Alt+F10");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un testo scelto da solo non si modifica senza la parte del testo: coi
    // livelli, F2 ne apre il nome.
    editor.select([T]);
    expect(barButtons()).toEqual(["Sposta in un livello", "Operazioni booleane"]);
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
    editor.select([A]);
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
    expect(shownTools()).toEqual(["Selezione", "Penna", "Testo"]);
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
    expect(shownTools()).toEqual(["Selezione"]);
    expect(changes).toEqual([]);
  });

  it("«Mostra tutto» elenca i tasti delle parti che non ha, col livello da cui vengono", () => {
    mount(SOURCE, { level: "custom", custom: ["pen", "eraser", "rect", "ellipse", "line", "arrow", "grid", "nodes"] });
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toEqual([
      "Strumenti",
      "Disegnare da tastiera",
      "Oggetti",
      "Nodi",
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
      "Poligono · dal livello Standard",
      "Forme dal tratto · dal livello Standard",
      "Testo · dal livello Standard",
      "Tavole · dal livello Standard",
      "Guide intelligenti · dal livello Standard",
      "Righelli e guide · dal livello Standard",
      "Proprietà · dal livello Standard",
      "Vista · dal livello Standard",
      "Modifica · dal livello Standard",
      "Elenco delle tavole · dal livello Standard",
      "Cronologia · dal livello Standard",
      "Accessibilità · dal livello Standard",
      "Strumenti · dal livello Esperto",
      "Disponi · dal livello Esperto",
      "Tracciato · dal livello Esperto",
      "Costruttore di forme · dal livello Esperto",
      "Forbici · dal livello Esperto",
      "Spessore · dal livello Esperto",
      "Bézier · dal livello Esperto",
      "Curvatura · dal livello Esperto",
      "Attributi · dal livello Esperto",
    ]);
    expect(tables[0]!.rows).toEqual([["Q", "Lazo"], ["F", "Tavola"], ["H", "Evidenziatore"], ["Y", "Poligono"], ["T", "Testo"]]);
    expect(tables[16]!.rows).toEqual([["M", "Costruttore di forme"], ["C", "Forbici"], ["W", "Spessore"], ["B", "Bézier"]]);
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
  /// Il menu contestuale, sull'orologio dei puntatori delle prove.
  const rightClick = (x: number, y: number, init: Init = {}): MouseEvent => {
    const event = pointer("contextmenu", { button: 2, pointerType: "mouse", clientX: x, clientY: y, timeStamp: (clock += 8), ...init });
    surface().dispatchEvent(event);
    return event;
  };
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
    expect(host.querySelector('[role="toolbar"] button[aria-label="Blu"]')!.getAttribute("aria-checked")).toBe("true");
    rightClick(100, 50);
    // Il colore e lo strumento di prima, in orizzontale: un gesto solo per
    // tornarci.
    expect(voices().slice(1, 4)).toEqual(["ne Selezione", "e Gomma", "se Evidenziatore"]);
    expect(voices().slice(5)).toEqual(["sw Colore: Verde", "w Colore: Nero", "nw Colore: Vermiglio"]);
  });

  it("tenuto premuto segue il puntatore: lasciato verso una voce la sceglie, e non disegna", () => {
    mount(SOURCE, { level: "standard" });
    size(200, 100);
    drag([[10, 10], [40, 10]]);
    const drawn = editor.engine.text;
    // Il menu sta intero nella finestra: aperto lontano dai bordi, il suo
    // centro è il punto del clic.
    surface().dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 2, buttons: 2, clientX: 400, clientY: 300, timeStamp: (clock += 8) }));
    // Su Linux e su macOS il menu contestuale arriva col tasto ancora giù.
    rightClick(400, 300, { buttons: 2 });
    expect(radial()).not.toBeNull();
    onPage("pointermove", { ...MOUSE, button: -1, buttons: 2, clientX: 410, clientY: 200, timeStamp: (clock += 8) });
    expect(voice("Annulla").hasAttribute("data-hot")).toBe(true);
    expect(radial()!.querySelector(".draw-radial-caption")!.textContent).toMatch(/^Annulla · /);
    onPage("pointerup", { ...MOUSE, button: 2, buttons: 0, clientX: 410, clientY: 200, timeStamp: (clock += 8) });
    expect(radial()).toBeNull();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Tratto.");
    // Su Windows arriva a tasto lasciato: il menu resta aperto.
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

  it("Maiusc+F10 lo apre al cursore, col nome della voce che ha il fuoco; con qualcosa di scelto apre il menu della selezione", () => {
    mount(SOURCE, { level: "standard" });
    size(200, 100);
    surface().focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
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

describe("«Ricalca immagine», dal livello Esperto", () => {
  const IMAGE = "img";
  const PNG_HREF = "data:image/png;base64,iVBORw0KGgo=";
  const DRAWING = doc(
    `${LAYER}<image id="${IMAGE}" x="10" y="10" width="40" height="20" href="${PNG_HREF}"><title>Logo</title></image><rect id="r" x="60" y="60" width="20" height="20"/></g>`,
  );

  /// Un codec con i pixel: 40 × 20, la metà sinistra nera e la destra
  /// bianca.
  function pixelCodec(): ImageCodec & { rects: string[]; closed: number } {
    const fake = {
      rects: [] as string[],
      closed: 0,
      async decode(): Promise<Decoded | null> {
        return {
          width: 40,
          height: 20,
          opaque: () => true,
          encode: async () => null,
          pixels(rect: { x: number; y: number; width: number; height: number }, most: number) {
            fake.rects.push(`${rect.x} ${rect.y} ${rect.width} ${rect.height} ${most}`);
            const data = new Uint8ClampedArray(rect.width * rect.height * 4);
            for (let y = 0; y < rect.height; y++) {
              for (let x = 0; x < rect.width; x++) {
                const at = (y * rect.width + x) * 4;
                data.fill(rect.x + x < 20 ? 0 : 255, at, at + 3);
                data[at + 3] = 255;
              }
            }
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

  /// Il ricalco nella pagina, che nei test non ha worker.
  const tracer: DrawEditorOptions["tracer"] = (raster) => inlineTracer(raster, () => import("./trace"));

  const traceButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Ricalca immagine…"]')!;
  const bar = (): HTMLElement => [...host.querySelectorAll<HTMLElement>(".draw-paths")].find((each) => each.querySelector(".draw-paths-title")!.textContent === "Ricalca immagine")!;
  const shown = (): string[] => [...bar().querySelectorAll("label")].filter((label) => !label.hidden).map((label) => label.querySelector("span")!.textContent ?? "");
  const control = <E extends HTMLElement>(name: string): E =>
    [...bar().querySelectorAll("label")].find((label) => label.textContent!.startsWith(name))!.querySelector<E>("input, select")!;
  const status = (): string => bar().querySelector("output")!.textContent ?? "";
  const action = (name: string): HTMLButtonElement => [...bar().querySelectorAll("button")].find((each) => each.textContent === name)!;
  const painted = (): Element => surface().querySelector(`image[data-scene-id="${IMAGE}"]`)!;
  /// Il gruppo che l'anteprima mostra al posto dell'immagine; `null` senza.
  const cover = (): Element | null => {
    const next = painted().nextElementSibling;
    return next !== null && next.localName === "g" && !next.hasAttribute("data-scene-id") ? next : null;
  };

  /// Apre la barra e aspetta il primo ricalco.
  async function openBar(): Promise<void> {
    editor.select([IMAGE]);
    traceButton().click();
    await vi.waitFor(() => expect(status()).toMatch(/^1 forma/));
  }

  it("c'è solo all'Esperto, con un'immagine scelta da sola", () => {
    mount(DRAWING, { level: "standard", imageCodec: pixelCodec(), tracer });
    editor.select([IMAGE]);
    expect(traceButton().hidden).toBe(true);
    editor.setLevel("expert");
    expect(traceButton().hidden).toBe(false);
    editor.select([IMAGE, "r"]);
    expect(traceButton().hidden).toBe(true);
    editor.select(["r"]);
    expect(traceButton().hidden).toBe(true);
  });

  it("ricalca i pixel che si vedono, mostra il gruppo al posto dell'immagine e lo scrive in un passo sopra di lei", async () => {
    const codec = pixelCodec();
    mount(DRAWING, { level: "expert", imageCodec: codec, tracer });
    const before = editor.engine.text;
    await openBar();
    expect(codec.rects).toEqual(["0 0 40 20 8000000"]);
    expect(codec.closed).toBe(1);
    expect(shown()).toEqual(["Tipo", "Colori", "Dettaglio", "Senza il bianco"]);
    expect(control<HTMLSelectElement>("Tipo").value).toBe("colors");
    expect(status()).toBe("1 forma, 4 nodi, 1 colore.");
    // L'anteprima: l'immagine non si vede, e al suo posto il gruppo, senza id.
    expect((painted() as SVGElement).style.visibility).toBe("hidden");
    const preview = cover()!;
    expect([...preview.querySelectorAll("path")].map((path) => path.getAttribute("fill"))).toEqual(["#000000"]);
    expect(preview.querySelector("[id]")).toBeNull();
    expect(changes).toEqual([]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    action("Applica").click();
    expect(changes).toHaveLength(1);
    const [group] = editor.selection;
    const text = editor.engine.text;
    expect(text).toMatch(/<image id="img"[^>]* display="none"/);
    const written = new RegExp(`<g id="${group}">\\s*<title>Logo</title>\\s*<path id="[^"]+" d="([^"]+)" fill="#000000"/>\\s*</g>`).exec(text);
    expect(written).not.toBeNull();
    // La metà nera, dove l'immagine la mostra.
    expect(written![1]!.match(/-?\d+(\.\d+)?/g)!.map(Number).sort((a, b) => a - b)).toEqual([10, 10, 10, 10, 30, 30, 30, 30]);
    expect(spoken()).toBe("Immagine ricalcata: 1 forma, in un gruppo. L’immagine resta, nascosta, sotto il gruppo.");
    expect(bar().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("il tipo cambia i campi, un cursore ricalca di nuovo, Esc chiude senza scrivere", async () => {
    mount(DRAWING, { level: "expert", imageCodec: pixelCodec(), tracer });
    await openBar();
    const kind = control<HTMLSelectElement>("Tipo");
    kind.value = "bw";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    expect(shown()).toEqual(["Tipo", "Soglia", "Dettaglio"]);
    // I campi aspettano le impostazioni del tipo, che li riscrivono.
    const threshold = control<HTMLInputElement>("Soglia");
    expect(threshold.disabled).toBe(true);
    expect(status()).toBe("Ricalco…");
    await vi.waitFor(() => expect(threshold.disabled).toBe(false));
    await vi.waitFor(() => expect(status()).toBe("1 forma, 4 nodi, 1 colore."));
    // Una soglia sotto il nero non trova inchiostro.
    threshold.value = "0";
    threshold.dispatchEvent(new Event("input", { bubbles: true }));
    expect(threshold.closest("label")!.querySelector(".draw-paths-value")!.textContent).toBe("0");
    await vi.waitFor(() => expect(status()).toBe("Il ricalco non trova forme: prova un altro tipo o un’altra soglia."));
    expect(cover()!.querySelector("path")).toBeNull();
    action("Applica").click();
    expect(spoken()).toBe("Il ricalco non trova forme: prova un altro tipo o un’altra soglia.");
    expect(bar().hidden).toBe(false);
    key("Escape", {}, threshold);
    expect(bar().hidden).toBe(true);
    expect(cover()).toBeNull();
    expect((painted() as SVGElement).style.visibility).toBe("");
    expect(changes).toEqual([]);
    expect(document.activeElement).toBe(surface());
  });

  it("si chiude se cambia la scelta; riapre col tipo e i valori dell'ultimo ricalco scritto", async () => {
    mount(DRAWING, { level: "expert", imageCodec: pixelCodec(), tracer });
    await openBar();
    editor.select(["r"]);
    expect(bar().hidden).toBe(true);
    expect(cover()).toBeNull();
    await openBar();
    const detail = control<HTMLInputElement>("Dettaglio");
    detail.value = "90";
    detail.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(status()).toMatch(/^1 forma/));
    action("Applica").click();
    editor.undo();
    await openBar();
    expect(control<HTMLInputElement>("Dettaglio").value).toBe("90");
  });

  it("legge un'immagine del vault da chi monta l'editor", async () => {
    const read: string[] = [];
    const images: DrawImages = {
      url: async (href) => `blob:vault/${href}`,
      read: async (href) => {
        read.push(href);
        return new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
      },
    };
    mount(DRAWING.replace(PNG_HREF, "immagini/logo.png"), { level: "expert", imageCodec: pixelCodec(), tracer, images });
    await openBar();
    expect(read).toEqual(["immagini/logo.png"]);
  });

  it("un'immagine dal web non si ricalca, e lo dice", () => {
    mount(DRAWING.replace(PNG_HREF, "https://example.com/logo.png"), { level: "expert", imageCodec: pixelCodec(), tracer });
    editor.select([IMAGE]);
    traceButton().click();
    expect(spoken()).toBe("Un’immagine dal web non si ricalca: mettila nel vault, e ricalca quella.");
    expect(bar().hidden).toBe(true);
  });

  it("un data URI che non si legge lo dice, e la barra si chiude", async () => {
    mount(DRAWING.replace(PNG_HREF, "data:image/png,%89PNG"), { level: "expert", imageCodec: pixelCodec(), tracer });
    editor.select([IMAGE]);
    traceButton().click();
    await vi.waitFor(() => expect(spoken()).toBe("Non è un’immagine che il disegno sa leggere."));
    expect(bar().hidden).toBe(true);
    expect(cover()).toBeNull();
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
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
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
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
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
