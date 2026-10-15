// @vitest-environment happy-dom
// Le forme delle raccolte nell'editor: il pannello che si apre dal livello
// Standard, l'inserimento al centro della vista con un clic o con Invio, il
// trascinamento sul foglio con la sua anteprima, e ciò che non si può fare:
// in un documento che non si modifica, su un livello bloccato, fuori dal
// foglio.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { drawStrings } from "../strings";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

const IT = drawStrings.catalogFor("it");
const EN = drawStrings.catalogFor("en");

/// Un quadrato in un foglio di 400 × 400: la vista di 400 × 400 ha il centro
/// in (200, 200), e una forma di 160 × 100 vi sta con l'angolo in (120, 150).
const SOURCE = doc(`<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="13" y="7" width="40" height="40" fill="#000000"/></g>`).replace(
  'viewBox="0 0 100 100"',
  'viewBox="0 0 400 400"',
);

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;

function mount(source = SOURCE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { onChange: (change) => changes.push(change), level: "standard", ...options });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const root = (): HTMLElement => host.querySelector<HTMLElement>(".draw-editor")!;
/// Ciò che l'editor ha detto per ultimo, dalla sua regione viva.
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();

const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Forme"], [role="toolbar"] button[aria-label="Shapes"]')!;
const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-library")!;
const tile = (id: string): HTMLButtonElement => panel().querySelector<HTMLButtonElement>(`.draw-library-tile[data-shape="${id}"]`)!;
const search = (): HTMLInputElement => panel().querySelector<HTMLInputElement>(".draw-library-search")!;
/// La riga viva del pannello.
const panelSpoken = (): string => (panel().querySelector('[role="status"]')?.textContent ?? "").trim();
/// Ciò che il foglio mostra mentre si tira una forma.
const preview = (): Element[] => [...host.querySelectorAll(".draw-preview > g > g > *")];

/// Dà al foglio una misura, che happy-dom non calcola, e un posto sullo
/// schermo: i punti del client sono anche quelli della scena.
function size(width: number, height: number): void {
  Object.defineProperty(surface(), "clientWidth", { configurable: true, value: width });
  Object.defineProperty(surface(), "clientHeight", { configurable: true, value: height });
  vi.spyOn(surface(), "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
}

function key(name: string, init: KeyboardEventInit = {}, target: HTMLElement = surface()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function pointer(type: string, target: HTMLElement, x: number, y: number, init: PointerEventInit = {}): void {
  target.dispatchEvent(
    new PointerEvent(type, { ...MOUSE, bubbles: true, cancelable: true, composed: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, ...init }),
  );
}

/// La forma `id` presa dal pannello e portata, passo per passo, nei punti
/// `to`; senza rilasciarla.
function carry(id: string, to: readonly (readonly [number, number])[], init: PointerEventInit = {}): HTMLButtonElement {
  const from = tile(id);
  pointer("pointerdown", from, 10, 10);
  pointer("pointermove", from, 20, 10);
  for (const [x, y] of to) pointer("pointermove", from, x, y, init);
  return from;
}

/// Il pannello aperto, sul foglio di 400 × 400.
function opening(source = SOURCE, options: DrawEditorOptions = {}): void {
  mount(source, options);
  size(400, 400);
  button().click();
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
  vi.restoreAllMocks();
});

describe("il pannello delle forme, dal livello Standard", () => {
  it("c'è dal livello Standard, si apre dal pulsante e dà il fuoco alla ricerca", () => {
    mount(SOURCE, { level: "essential" });
    expect(button().hidden).toBe(true);
    editor.setLevel("standard");
    expect(button().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    expect(panel().hidden).toBe(true);
    button().click();
    expect(panel().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(search());
    expect(formatIssues(checkAccessibility(host))).toBe("");
    button().click();
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
  });

  it("sparisce, chiuso, se il livello scende sotto lo Standard", () => {
    opening();
    expect(panel().hidden).toBe(false);
    editor.setLevel("essential");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
  });

  it("i suoi tasti restano suoi: una lettera nella ricerca non cambia lo strumento", () => {
    opening();
    expect(editor.tool).toBe("pen");
    search().focus();
    key("r", {}, search());
    key("v", {}, search());
    expect(editor.tool).toBe("pen");
    expect(changes).toEqual([]);
  });

  it("annulla e ripeti passano, anche da un riquadro", () => {
    opening();
    const before = editor.engine.text;
    tile("basic-rectangle").focus();
    key("Enter", {}, tile("basic-rectangle"));
    expect(changes).toHaveLength(1);
    key("z", { ctrlKey: true }, tile("basic-rectangle"));
    expect(editor.engine.text).toBe(before);
    key("y", { ctrlKey: true }, tile("basic-rectangle"));
    expect(editor.engine.text).not.toBe(before);
  });
});

describe("inserire una forma con la tastiera o con un clic", () => {
  it("Invio la mette al centro della vista, in un passo, la sceglie e riporta alla Selezione", () => {
    opening();
    expect(editor.tool).toBe("pen");
    const before = editor.engine.text;
    tile("basic-rectangle").focus();
    key("Enter", {}, tile("basic-rectangle"));
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="120" y="150" width="160" height="100" fill="none" stroke="#000000" stroke-width="4">\s*<title>Rettangolo<\/title>\s*<\/rect>/);
    expect(changes.map((change) => change.origin)).toEqual(["input"]);
    expect(editor.selection).toHaveLength(1);
    expect(editor.tool).toBe("select");
    expect(spoken()).toMatch(/^Forma inserita: Rettangolo\. Il disegno ha 2 oggetti\.$/);
    // Il fuoco resta dov'era: chi inserisce con la tastiera ne inserisce un'altra.
    expect(document.activeElement).toBe(tile("basic-rectangle"));
    editor.undo();
    expect(editor.engine.text).toBe(before);
    editor.redo();
    expect(editor.selection).toHaveLength(1);
  });

  it("un clic fa lo stesso, e uno Spazio", () => {
    opening();
    tile("basic-ellipse").click();
    expect(editor.engine.text).toMatch(/<ellipse id="o[a-z0-9]{8}" cx="200" cy="200" rx="80" ry="50"/);
    tile("basic-circle").focus();
    key(" ", {}, tile("basic-circle"));
    expect(editor.engine.text).toMatch(/<ellipse id="o[a-z0-9]{8}" cx="200" cy="200" rx="50" ry="50"/);
    expect(changes).toHaveLength(2);
    editor.undo();
    expect(editor.engine.text).not.toContain("<title>Cerchio</title>");
    expect(editor.engine.text).toContain("<title>Ellisse</title>");
  });

  it("col colore e lo spessore scelti, e il nome nella lingua di adesso", () => {
    opening();
    editor.setColor("#0072b2");
    editor.setWidth(8);
    vi.stubGlobal("navigator", { language: "en-GB" });
    tile("basic-rectangle").click();
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="120" y="150" width="160" height="100" fill="none" stroke="#0072b2" stroke-width="8">\s*<title>Rectangle<\/title>/);
    expect(IT["draw.library.basic-rectangle"]).toBe("Rettangolo");
    expect(EN["draw.library.basic-rectangle"]).toBe("Rectangle");
  });

  it("con la griglia che aggancia, l'angolo in alto a sinistra va su un incrocio", () => {
    opening();
    editor.setGrid({ ...editor.grid, snap: true, step: 50 });
    tile("basic-rectangle").click();
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="100" y="150" width="160" height="100"/);
  });

  it("una forma di più pezzi è un gruppo con il nome, e si sceglie intera", () => {
    opening();
    tile("school-axes").click();
    expect(editor.engine.text).toMatch(/<g id="o[a-z0-9]{8}">\s*<title>Assi cartesiani<\/title>/);
    expect(editor.selection).toHaveLength(1);
    expect(spoken()).toContain("Forma inserita: Assi cartesiani.");
  });

  it("si vede la vista, non il foglio: con lo zoom il centro è quello della vista", () => {
    opening();
    key("+");
    tile("basic-rectangle").click();
    const [, x, y, width, height] = /<rect id="o[a-z0-9]{8}" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none"/.exec(editor.engine.text)!.map(Number) as [number, number, number, number, number];
    // Al centro della vista, alla misura della forma nella scena.
    expect([x! + width! / 2, y! + height! / 2]).toEqual([200, 200]);
    expect([width, height]).toEqual([160, 100]);
  });

  it("l'ordine di lettura e il nome: la verifica non ha niente da dire", () => {
    opening();
    tile("basic-rectangle").click();
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("le forme dove non si può scrivere", () => {
  it("in un documento che non si modifica il pannello si apre e non inserisce, e dice perché", () => {
    opening(doc(`${LAYER}<rect id="o1a2b3c4d" width="5" height="5"/></g>`).replace(' fub:version="1"', ""));
    expect(editor.engine.status).not.toBe("fubdraw");
    expect(panel().hidden).toBe(false);
    tile("basic-rectangle").click();
    key("Enter", {}, tile("basic-rectangle"));
    expect(changes).toEqual([]);
    expect(panelSpoken()).toContain("sola lettura");
    // Né si tira.
    carry("basic-rectangle", [[200, 200]]);
    pointer("pointerup", tile("basic-rectangle"), 200, 200);
    expect(changes).toEqual([]);
    expect(preview()).toEqual([]);
  });

  it("se chi monta l'editor lo chiude, il pannello lo sa", () => {
    opening();
    editor.setReadOnly(true);
    tile("basic-rectangle").click();
    expect(changes).toEqual([]);
    expect(panelSpoken()).toContain("sola lettura");
    editor.setReadOnly(false);
    tile("basic-rectangle").click();
    expect(changes).toHaveLength(1);
  });

  it("con ogni livello bloccato non inserisce, e lo dice come gli altri strumenti", () => {
    opening(doc('<g id="l1" fub:layer="Uno" fub:locked="true"></g>'));
    tile("basic-rectangle").click();
    expect(changes).toEqual([]);
    expect(spoken()).toBe("«Uno» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
    expect(editor.selection).toEqual([]);
  });
});

describe("tirare una forma sul foglio", () => {
  it("mostra la forma com'è, col centro sotto il puntatore, e il cursore dice che si può lasciare", () => {
    opening();
    const from = carry("basic-rectangle", [[250, 180]]);
    expect(root().dataset.libraryDrop).toBe("copy");
    const shown = preview();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.tagName.toLowerCase()).toBe("rect");
    expect(shown[0]!.getAttribute("x")).toBe("170");
    expect(shown[0]!.getAttribute("y")).toBe("130");
    expect(shown[0]!.getAttribute("width")).toBe("160");
    expect(shown[0]!.getAttribute("height")).toBe("100");
    // L'anteprima non porta il nome, e non scrive.
    expect(shown[0]!.querySelector("title")).toBeNull();
    expect(changes).toEqual([]);
    pointer("pointerup", from, 250, 180);
    expect(root().dataset.libraryDrop).toBeUndefined();
  });

  it("rilasciata sul foglio entra lì, in un passo, e la sceglie", () => {
    opening();
    const before = editor.engine.text;
    const from = carry("basic-rectangle", [[250, 180]], { ctrlKey: true });
    pointer("pointerup", from, 251, 181, { ctrlKey: true });
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="171" y="131" width="160" height="100" fill="none" stroke="#000000" stroke-width="4">\s*<title>Rettangolo<\/title>/);
    expect(changes).toHaveLength(1);
    expect(editor.selection).toHaveLength(1);
    expect(editor.tool).toBe("select");
    expect(spoken()).toMatch(/^Forma inserita: Rettangolo\./);
    expect(preview()).toEqual([]);
    expect(document.activeElement).toBe(surface());
    // Il clic che il browser manda dopo il rilascio non la inserisce un'altra volta.
    from.click();
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("si aggancia come un oggetto spostato: alla pagina, e Ctrl la lascia libera", () => {
    opening();
    // Il centro a 3 pixel da quello della pagina: la forma vi si aggancia.
    let from = carry("basic-rectangle", [[203, 200]]);
    pointer("pointerup", from, 203, 200);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="120" y="150" width="160" height="100"/);
    editor.undo();
    from = carry("basic-rectangle", [[203, 200]], { ctrlKey: true });
    pointer("pointerup", from, 203, 200, { ctrlKey: true });
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="123" y="150" width="160" height="100"/);
  });

  it("con la griglia che aggancia, l'angolo va su un incrocio", () => {
    opening();
    editor.setGrid({ ...editor.grid, snap: true, step: 50 });
    const from = carry("basic-rectangle", [[263, 217]]);
    pointer("pointerup", from, 263, 217);
    // L'angolo sarebbe in (183, 167).
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="200" y="150" width="160" height="100"/);
  });

  it("fuori dal foglio il cursore lo dice, l'anteprima sparisce e rilasciarla non lascia traccia", () => {
    opening();
    const before = editor.engine.text;
    const from = carry("basic-rectangle", [[250, 180], [-60, 180]]);
    expect(root().dataset.libraryDrop).toBe("none");
    expect(preview()).toEqual([]);
    pointer("pointerup", from, -60, 180);
    expect(editor.engine.text).toBe(before);
    expect(changes).toEqual([]);
    expect(editor.selection).toEqual([]);
    expect(editor.tool).toBe("pen");
    expect(root().dataset.libraryDrop).toBeUndefined();
    expect(spoken()).toBe("Inserimento annullato.");
  });

  it("Esc la ferma, e il foglio resta com'era", () => {
    opening();
    const before = editor.engine.text;
    const from = carry("basic-rectangle", [[250, 180]]);
    expect(preview()).toHaveLength(1);
    const escape = key("Escape", {}, from);
    expect(escape.defaultPrevented).toBe(true);
    expect(preview()).toEqual([]);
    expect(root().dataset.libraryDrop).toBeUndefined();
    expect(spoken()).toBe("Inserimento annullato.");
    // Il rilascio che viene dopo non fa niente.
    pointer("pointerup", from, 250, 180);
    expect(editor.engine.text).toBe(before);
    expect(changes).toEqual([]);
  });

  it("un puntatore annullato la ferma", () => {
    opening();
    const from = carry("basic-rectangle", [[250, 180]]);
    pointer("pointercancel", from, 250, 180);
    expect(preview()).toEqual([]);
    expect(changes).toEqual([]);
    expect(spoken()).toBe("Inserimento annullato.");
  });

  it("chiudere il pannello a metà la ferma", () => {
    opening();
    carry("basic-rectangle", [[250, 180]]);
    button().click();
    expect(preview()).toEqual([]);
    expect(root().dataset.libraryDrop).toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("un movimento sotto la soglia è un clic: inserisce al centro", () => {
    opening();
    const from = tile("basic-rectangle");
    pointer("pointerdown", from, 10, 10);
    pointer("pointermove", from, 11, 11);
    pointer("pointerup", from, 11, 11);
    from.click();
    expect(changes).toHaveLength(1);
    expect(editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="120" y="150"/);
  });

  it("un secondo puntatore non la sposta", () => {
    opening();
    const from = carry("basic-rectangle", [[250, 180]]);
    pointer("pointermove", from, 100, 100, { pointerId: 2 });
    expect(preview()[0]!.getAttribute("x")).toBe("170");
    pointer("pointerup", from, 100, 100, { pointerId: 2 });
    expect(changes).toEqual([]);
    expect(preview()).toHaveLength(1);
    pointer("pointerup", from, 250, 180);
    expect(changes).toHaveLength(1);
  });

  it("sul foglio di un documento con un livello bloccato, rilasciarla dice perché non entra", () => {
    opening(doc('<g id="l1" fub:layer="Uno" fub:locked="true"></g>'));
    const from = carry("basic-rectangle", [[250, 180]]);
    expect(root().dataset.libraryDrop).toBe("none");
    pointer("pointerup", from, 250, 180);
    expect(changes).toEqual([]);
    expect(spoken()).toBe("«Uno» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
  });
});
