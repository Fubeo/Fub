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
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
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
    expect(shown(".draw-tool")).toEqual(["Selezione", "Penna", "Evidenziatore", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
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
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toEqual([
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
    dialog().querySelector<HTMLButtonElement>(".palette-actions button")!.click();
  });

  it("i pulsanti della barra fanno lo stesso", () => {
    mount();
    const named = (label: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!;
    expect(named("Proprietà").getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(named("Tasti del disegno").getAttribute("aria-haspopup")).toBe("dialog");
    named("Tasti del disegno").click();
    expect(dialog().querySelector("h2")!.textContent).toBe("Tasti del disegno");
    dialog().querySelector<HTMLButtonElement>(".palette-actions button")!.click();
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
