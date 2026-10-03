// @vitest-environment happy-dom
// L'editor del disegno, dal puntatore al testo: ogni strumento produce le
// operazioni attese, annulla e ripeti le disfano, e chi non vede sente che
// cosa è successo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { MERGE_MS } from "./history";
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

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
});

afterEach(() => {
  owner.close();
  host.remove();
  vi.restoreAllMocks();
});

describe("la barra e il foglio", () => {
  it("mettono in fila strumenti, colori, spessori, modifica e vista, e il titolo", () => {
    mount();
    const toolbar = host.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute("aria-label")).toBe("Strumenti di disegno");
    const groups = [...toolbar.querySelectorAll(".draw-group")].map((group) => [group.getAttribute("role"), group.getAttribute("aria-label")]);
    expect(groups).toEqual([
      ["radiogroup", "Strumento"],
      ["radiogroup", "Colore"],
      ["radiogroup", "Spessore"],
      ["group", "Modifica"],
      ["group", "Vista"],
    ]);
    const tools = [...toolbar.querySelectorAll<HTMLButtonElement>(".draw-tool")];
    expect(tools.map((control) => control.getAttribute("aria-label"))).toEqual(["Selezione", "Penna", "Gomma", "Rettangolo", "Ellisse", "Linea", "Freccia"]);
    expect(tools.map((control) => control.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "false", "false", "false"]);
    expect(tools[3]!.title).toBe("Rettangolo (R)");
    expect(tools[3]!.getAttribute("aria-keyshortcuts")).toBe("R");
    expect(document.getElementById(tools[3]!.getAttribute("aria-describedby")!)?.textContent).toContain("Maiusc");
    expect(toolbar.querySelectorAll('.draw-color[role="radio"]')).toHaveLength(8);
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
