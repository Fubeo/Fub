// @vitest-environment happy-dom
// L'editor del disegno, dal puntatore al testo: ogni strumento produce le
// operazioni attese, annulla e ripeti le disfano, e chi non vede sente che
// cosa è successo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { decodeInk } from "../ink/codec";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { MERGE_MS } from "./history";
import type { Decoded, EncodeType, ImageCodec } from "./images";
import { LAYER } from "./test-support";

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
const spoken = (): string => (host.querySelector('[role="status"]')?.textContent ?? "").trim();

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

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
});

afterEach(() => {
  owner.close();
  host.remove();
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
    expect(shown(".draw-tool")).toEqual(["Selezione", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia", "Testo"]);
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

  it("un gruppo che porta una trasformazione su parti estranee non si separa, e lo dice", () => {
    const source = doc(`${LAYER}<g id="og1g1g1g1" transform="translate(5 0)"><rect id="oa1a1a1a1" x="0" y="0" width="5" height="5"/><use href="#oa1a1a1a1"/></g></g>`);
    mount(source, { level: "standard" });
    editor.select(["og1g1g1g1"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toContain("Non separato");
    key("d", { ctrlKey: true });
    expect(editor.engine.text).toBe(source);
    expect(spoken()).toContain("Non duplicato");
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
      "Collegamento a «Ciclo dell'acqua», 1 oggetto",
      "Rettangolo, Nero",
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
    expect(labels()).toEqual(["Livello «Sfondo»", "Rettangolo, Blu", "Livello «Note», corrente", "Rettangolo, Nero"]);
    editor.select([A]);
    expect(shownName()).toBe("Sfondo");
    expect(labels()).toEqual(["Livello «Sfondo», corrente", "Rettangolo, Blu", "Livello «Note»", "Rettangolo, Nero"]);
    // Oggetti di due livelli non cambiano il livello corrente.
    editor.select([A, B]);
    expect(shownName()).toBe("Sfondo");
    editor.select([B]);
    expect(shownName()).toBe("Note");
    editor.setLevel("essential");
    expect(labels()).toEqual(["Livello «Sfondo»", "Rettangolo, Blu", "Livello «Note»", "Rettangolo, Nero"]);
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
  const SNAP = { shown: false, snap: true, step: 20 } as const;
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
    expect(editor.grid).toEqual({ shown: true, snap: true, step: 50 });
    expect(grids).toEqual([
      { shown: true, snap: false, step: 20 },
      { shown: true, snap: false, step: 50 },
      { shown: true, snap: true, step: 50 },
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
    mount(SOURCE, { level: "standard", grid: { shown: true, snap: false, step: 0 }, onGridChange: (grid) => grids.push(grid) });
    expect(editor.grid).toEqual({ shown: true, snap: false, step: 20 });
    editor.setGrid({ shown: true, snap: true, step: 25 });
    editor.setGrid({ shown: false, snap: true, step: 5000 });
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 25 });
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
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20 });
    expect(key("#", { ctrlKey: true }).defaultPrevented).toBe(false);
    editor.setLevel("essential");
    expect(key("%", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(editor.grid).toEqual({ shown: false, snap: true, step: 20 });
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

describe("il testo, dal livello Standard", () => {
  /// Un testo blu di due righe, nel corpo 20: il suo riquadro va da (10, 24)
  /// a (46, 70).
  const T = "ot1t1t1t1";
  const TEXT = doc(
    `<title>Prova</title>${LAYER}<text id="${T}" x="10" y="40" fill="#0072b2" font-family="Inter, sans-serif" font-size="20">` +
      `<tspan x="10" dy="0">Uno</tspan><tspan x="10" dy="25">Due</tspan></text></g>`,
  );
  const EMPTY = doc(`<title>Prova</title>${LAYER}</g>`);

  const input = (): HTMLTextAreaElement => host.querySelector<HTMLTextAreaElement>(".draw-text-input")!;
  const layer = (): HTMLElement => host.querySelector<HTMLElement>(".draw-text-layer")!;
  const painted = (): SVGElement => host.querySelector<SVGElement>(".spatial-painter text")!;
  /// Un tocco col mouse in (`x`, `y`).
  const tap = (x: number, y: number): void => drag([[x, y]]);
  /// Scrive `value` nel campo, come la tastiera.
  const type = (value: string): void => {
    input().value = value;
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
    expect(document.getElementById(input().getAttribute("aria-describedby")!)?.textContent).toBe("Invio va a capo; Esc, Tab o Ctrl+Invio concludono.");
    expect(input().style.fontFamily).toBe("Inter, sans-serif");
    expect(input().style.fontSize).toBe("32px");
    expect(input().style.lineHeight).toBe("40px");
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
    expect(input().value).toBe("Uno\nDue");
    expect(input().getAttribute("aria-label")).toBe("Testo");
    expect(input().style.fontSize).toBe("20px");
    expect(input().style.lineHeight).toBe("25px");
    expect(input().style.textAlign).toBe("left");
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
    key("F2");
    expect(layer().hidden).toBe(true);
    expect(spoken()).toBe("Scegli un testo da modificare.");
    expect(changes).toEqual([]);
    editor.setLevel("essential");
    editor.select([T]);
    expect(key("F2").defaultPrevented).toBe(false);
    expect(layer().hidden).toBe(true);
  });

  it("Spazio scrive dov'è il cursore, e con l'aggancio la linea di base va sulla griglia", () => {
    mount(EMPTY, { level: "standard", grid: { shown: false, snap: true, step: 20 } });
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
    expect(input().style.lineHeight).toBe("60px");
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
      "Disponi · dal livello Standard",
      "Testo · dal livello Standard",
      "Griglia · dal livello Standard",
      "Strumenti · dal livello Esperto",
      "Disponi · dal livello Esperto",
      "Nodi · dal livello Esperto",
      "Bézier · dal livello Esperto",
      "Attributi · dal livello Esperto",
    ]);
    // Solo ciò che manca: i sette strumenti dell'Essenziale non si ripetono.
    expect(tables[0]!.rows).toEqual([["H", "Evidenziatore"], ["T", "Testo"]]);
    expect(tables[1]!.rows).toContainEqual(["Ctrl+D", "Duplica"]);
    expect(tables[3]!.rows).toContainEqual(["#", "Mostra o nasconde la griglia"]);
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
      { caption: "Strumenti · dal livello Esperto", rows: [["N", "Nodi"], ["B", "Bézier"]] },
      { caption: "Disponi · dal livello Esperto", rows: [["Ctrl+Shift+M", "Trasforma…"]] },
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
          ["Shift+J", "Unisci i capi"],
          ["Esc", "Toglie la scelta dei nodi, poi quella dell’oggetto"],
          ["Alt+F10", "Va alla barra dei nodi"],
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
        caption: "Attributi · dal livello Esperto",
        rows: [
          ["Ctrl+Shift+X", "Mostra o nasconde gli attributi dell’oggetto scelto"],
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
    expect(labels()).toEqual(["Livello «Livello 1»", "Rettangolo, Nero", "Ellisse, Nero"]);
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

describe("gli attributi, dal livello Esperto", () => {
  const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Attributi"]')!;
  const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-inspector")!;
  const dock = (): HTMLElement => host.querySelector<HTMLElement>(".draw-dock")!;
  const row = (name: string): HTMLTableRowElement => panel().querySelector<HTMLTableRowElement>(`tr[data-key="${name}"]`)!;
  const control = (name: string): HTMLInputElement => row(name).querySelector<HTMLInputElement>(".draw-inspector-input")!;
  const keysOf = (): string[] => [...panel().querySelectorAll<HTMLTableRowElement>("tbody tr")].map((tr) => tr.dataset.key!);

  function write(target: HTMLInputElement, text: string): void {
    target.focus();
    target.value = text;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("il pulsante c'è solo all'Esperto; apre il pannello accanto al foglio, e il fuoco ci va", () => {
    mount(SOURCE, { level: "standard" });
    expect(button().hidden).toBe(true);
    editor.setLevel("expert");
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
    // Scesi dall'Esperto, il pannello si chiude e il pulsante sparisce.
    editor.setLevel("standard");
    expect(panel().hidden).toBe(true);
    expect(button().hidden).toBe(true);
  });

  it("l'albero e gli attributi stanno uno sotto l'altro", () => {
    mount(SOURCE, { level: "expert" });
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    button().click();
    expect([...dock().children].map((child) => child.className)).toEqual(["draw-objects", "draw-inspector"]);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    expect(dock().hidden).toBe(false);
    button().click();
    expect(dock().hidden).toBe(true);
  });

  it("un valore cambiato è un passo, che si annulla col suo nome", () => {
    mount(SOURCE, { level: "expert" });
    editor.select(["o1a2b3c4d"]);
    button().click();
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
    button().click();
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
    button().click();
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
    button().click();
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
    button().click();
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
    button().click();
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
    ]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    closeMenus();
    // Estremi diversi: nessuno è segnato. Il rettangolo pieno non ha contorno
    // e non conta.
    editor.select([A, B, C]);
    outline().click();
    expect(menu().filter((entry) => entry.getAttribute("aria-checked") === "true").map(labelOf)).toEqual(["Continuo", "Angoli vivi"]);
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

  it("c'è solo all'Esperto, col suo tasto, e apre una finestra che parte da niente da cambiare", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A]);
    editor.focus();
    expect(transform().hidden).toBe(true);
    // Sotto l'Esperto il tasto resta a chi lo aveva.
    expect(key("m", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(document.querySelectorAll(".modale")).toHaveLength(0);
    editor.setLevel("expert");
    expect(transform().hidden).toBe(false);
    expect(transform().getAttribute("aria-haspopup")).toBe("dialog");
    expect(transform().getAttribute("aria-keyshortcuts")).toBe("Control+Shift+M");
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

  it("ruota attorno al centro, in un passo che si annulla, e la pagina cresce se l'oggetto ne esce", async () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    transform().click();
    field("rotate").value = "90";
    await submit();
    // Il centro è (10, 5): in senso orario la destra va in basso.
    expect(editor.engine.text).toContain(`<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000" transform="matrix(0 1 -1 0 15 -5)"/>`);
    expect(editor.engine.text).toContain('viewBox="0 -256 100 356"');
    expect(spoken()).toBe("1 oggetto trasformato.");
    expect(editor.selection).toEqual([A]);
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(SHAPES);
    expect(spoken()).toBe("Annullato: Trasformazione.");
  });

  it("trasforma la selezione come un insieme: una scala negativa la rispecchia attorno al suo centro", async () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A, B]);
    transform().click();
    field("scaleX").value = "-100";
    await submit();
    // Il riquadro va da 0 a 50: ogni oggetto passa dall'altra parte.
    expect(editor.engine.text).toContain(`<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000" transform="matrix(-1 0 0 1 50 0)"/>`);
    expect(editor.engine.text).toContain(`<rect id="${B}" x="40" y="0" width="10" height="10" fill="#000000" transform="matrix(-1 0 0 1 50 0)"/>`);
    expect(spoken()).toBe("2 oggetti trasformati.");
    expect(editor.selection).toEqual([A, B]);
  });

  it("non scrive una trasformazione che il file perderebbe, e non scrive niente se non cambia niente", async () => {
    mount(SHAPES, { level: "expert" });
    editor.select([A]);
    transform().click();
    field("scaleX").value = "0.001";
    field("scaleY").value = "0.001";
    await submit();
    expect(spoken()).toBe("Un oggetto diventerebbe troppo piccolo per scriverne la trasformazione: niente è cambiato.");
    transform().click();
    field("rotate").value = "360";
    await submit();
    expect(spoken()).toBe("È già così: niente da cambiare.");
    // Scendendo dall'Esperto mentre la finestra è aperta, la risposta non
    // scrive niente.
    transform().click();
    field("rotate").value = "45";
    editor.setLevel("standard");
    await submit();
    expect(changes).toEqual([]);
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

describe("l'oggetto in tracciato, dal livello Esperto", () => {
  const A = "oa2a2a2a2";
  const T = "ot2t2t2t2";
  const P = "op2p2p2p2";
  const SHAPES = doc(
    `${LAYER}<rect id="${A}" x="0" y="0" width="20" height="10" fill="#000000"/>`
      + `<text id="${T}" x="0" y="40"><tspan x="0" dy="0">Ciao</tspan></text>`
      + `<path id="${P}" d="M0 60 L10 70" fill="none" stroke="#000000" stroke-width="1"/></g>`,
  );

  const pathButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.draw-arrange button[aria-label="Oggetto in tracciato"]')!;

  it("c'è solo all'Esperto, e fa degli oggetti tracciati in un passo che si annulla", () => {
    mount(SHAPES, { level: "standard" });
    editor.select([A]);
    expect(pathButton().hidden).toBe(true);
    // Sotto l'Esperto il comando non scrive, anche chiesto.
    pathButton().click();
    expect(changes).toEqual([]);
    editor.setLevel("expert");
    expect(pathButton().hidden).toBe(false);
    expect(pathButton().hasAttribute("aria-keyshortcuts")).toBe(false);
    pathButton().click();
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
    pathButton().click();
    expect(spoken()).toBe("1 oggetto è diventato un tracciato. 1 oggetto resta com’è: testi, immagini e forme vuote non diventano tracciati.");
    expect(editor.selection).toEqual([A, T]);
    editor.select([T]);
    pathButton().click();
    expect(spoken()).toBe("È già così: niente da cambiare. 1 oggetto resta com’è: testi, immagini e forme vuote non diventano tracciati.");
    editor.select([P]);
    pathButton().click();
    expect(spoken()).toBe("È già così: niente da cambiare.");
    expect(changes).toHaveLength(1);
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

  it("dice quando l'oggetto scelto non è un tracciato, o gli oggetti sono più d'uno", () => {
    mount(SHAPES, { level: "expert" });
    editor.select([R]);
    editor.focus();
    key("n");
    expect(spoken()).toBe("Strumento: Nodi. L’oggetto scelto non è un tracciato: «Oggetto in tracciato» lo rende modificabile coi nodi.");
    expect(nodesBar().hidden).toBe(true);
    expect(arrangeBar().hidden).toBe(false);
    // Le frecce non spostano mai l'oggetto, con lo strumento Nodi.
    key("ArrowRight");
    expect(changes).toEqual([]);
    editor.select([P, R]);
    editor.setTool("nodes");
    expect(spoken()).toBe("Strumento: Nodi. Scegli un oggetto solo per modificarne i nodi.");
    editor.select([]);
    editor.setTool("nodes");
    expect(spoken()).toBe("Strumento: Nodi.");
    // Un tocco sceglie l'oggetto di cui modificare i nodi.
    tap(30, 10);
    expect(editor.selection).toEqual([P]);
    expect(spoken()).toBe("Tracciato, Nero: 3 nodi da modificare.");
    tap(210, 210);
    expect(editor.selection).toEqual([R]);
    expect(spoken()).toBe("L’oggetto scelto non è un tracciato: «Oggetto in tracciato» lo rende modificabile coi nodi.");
    // Senza un tracciato il riquadro sceglie gli oggetti, con Maiusc in
    // aggiunta, e il vuoto toglie la scelta.
    drag([[0, 0], [60, 60]], { shiftKey: true });
    expect(editor.selection).toEqual([P, R]);
    expect(spoken()).toBe("Scegli un oggetto solo per modificarne i nodi.");
    tap(300, 300);
    expect(editor.selection).toEqual([]);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    drag([[0, 0], [60, 60]]);
    expect(editor.selection).toEqual([P]);
    expect(spoken()).toBe("Tracciato, Nero: 3 nodi da modificare.");
    expect(changes).toEqual([]);
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
    expect(enabled()).toEqual(["Aggiungi nodi", "Elimina nodi", "Nodi a spigolo", "Nodi lisci", "Nodi simmetrici", "Segmenti in curve", "Spezza ai nodi"]);
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
    expect(spoken()).toBe("Senza nodi il tracciato non c’è più: eliminato. Il disegno ha 2 oggetti.");
    expect(editor.selection).toEqual([]);
    expect(changes).toHaveLength(4);
    editor.undo();
    expect(spoken()).toBe("Annullato: Eliminazione di nodi.");
    expect(d()).toBe("M50 10 L50 50");
  });

  it("Maiusc e una lettera, o la barra, cambiano tipo dei nodi e dei segmenti, spezzano e uniscono", () => {
    editing();
    key("Home");
    // Un capo si elimina soltanto.
    expect(enabled()).toEqual(["Elimina nodi"]);
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

  it("dentro un gruppo, la forma toccata è quella di cui si modificano i nodi, e il gruppo resta scelto", () => {
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
    expect(spoken()).toBe("Strumento: Nodi. Gruppo, 2 oggetti: 2 nodi da modificare.");
    tap(30, 50);
    expect(spoken()).toBe("Gruppo, 2 oggetti: 3 nodi da modificare.");
    drag([[50, 90], [60, 90], [70, 90]]);
    expect(d(B)).toBe("M10 50 L50 50 L70 90");
    expect(d(A)).toBe("M10 10 L50 10");
    expect(editor.selection).toEqual([G]);
    // La forma resta quella anche dopo la modifica.
    key("Home");
    expect(spoken()).toBe("Nodo 1 di 3, capo: x 10, y 50.");
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
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
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
  const drawing = (source = EMPTY): void => {
    mount(source, { level: "expert" });
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
    expect(tools.slice(tools.indexOf("arrow"))).toEqual(["arrow", "bezier", "text"]);
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
    editor.setGrid({ shown: false, snap: true, step: 10 });
    tap(1, 2);
    drag([[38, 41], [44, 47], [52, 49]]);
    // Ctrl lascia il punto libero.
    tap(73, 77, { ctrlKey: true });
    key("Enter");
    expect(written()).toBe("M0 0 C0 0 30 30 40 40 C50 50 73 77 73 77");
    // Due nodi sullo stesso incrocio non fanno un tracciato.
    editor.setGrid({ shown: false, snap: true, step: 50 });
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
    mount(SOURCE, { imageCodec: codec(100, 50), level: "standard", grid: { shown: false, snap: true, step: 20 } });
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
    expect(spoken()).toBe("Non è un’immagine che il disegno sa leggere.");
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
