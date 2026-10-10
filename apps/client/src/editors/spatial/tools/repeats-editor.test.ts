// @vitest-environment happy-dom
// Le ripetizioni nell'editor, dal livello Esperto: il menu «Ripeti» nella
// barra della selezione e nel menu del foglio, il tipo che cambia,
// «Espandi», la separazione, l'originale che si elimina e quello nuovo che
// riceve le sue copie, in un passo d'annulla ciascuno.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

const A = "oa1a1a1a1";
const B = "ob2b2b2b2";
const R = "or3r3r3r3";
const C = "oc4c4c4c4";

/// Un foglio di 400 × 400 con due quadrati.
const SOURCE = doc(
  `<title>Prova</title>${LAYER}<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2"/>` +
    `<rect id="${B}" x="300" y="300" width="20" height="20" fill="#d55e00"/></g>`,
).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

/// Una ripetizione a specchio del quadrato blu sulla verticale per x = 250,
/// e il quadrato arancione fuori.
const MIRRORED = doc(
  `<title>Prova</title>${LAYER}<g id="${R}" fub:repeat="mirror 250 100 250 120">` +
    `<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2"/>` +
    `<use id="${C}" transform="matrix(-1 0 0 1 500 0)" href="#${A}"/></g>` +
    `<rect id="${B}" x="300" y="300" width="20" height="20" fill="#d55e00"/></g>`,
).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

const D = "od5d5d5d5";
const E = "oe6e6e6e6";

/// Il quadrato blu ripetuto quattro volte intorno a (200, 200).
const RADIAL = doc(
  `<title>Prova</title>${LAYER}<g id="${R}" fub:repeat="radial 4 200 200">` +
    `<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2"/>` +
    `<use id="${C}" transform="matrix(0 1 -1 0 400 0)" href="#${A}"/>` +
    `<use id="${D}" transform="matrix(-1 0 0 -1 400 400)" href="#${A}"/>` +
    `<use id="${E}" transform="matrix(0 -1 1 0 0 400)" href="#${A}"/></g></g>`,
).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

/// Il quadrato blu in una griglia di 2 × 1 col passo di 30.
const GRID = doc(
  `<title>Prova</title>${LAYER}<g id="${R}" fub:repeat="grid 2 1 30 30">` +
    `<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2"/>` +
    `<use id="${C}" transform="matrix(1 0 0 1 30 0)" href="#${A}"/></g></g>`,
).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;
let clock = 100;

function mount(source = SOURCE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { onChange: (change) => changes.push(change), level: "expert", ...options });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();
const barButton = (label: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`.draw-arrange button[aria-label="${label}"]`)!;
const menu = (): HTMLButtonElement[] => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')];
};
const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
const noteOf = (entry: HTMLElement): string | null => entry.querySelector(".menu-description")?.textContent ?? null;
const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
/// Le voci del menu aperto: il nome, se è spenta, se è segnata e la nota.
const entries = (): Array<[string, string | null, string | null, string | null]> =>
  menu().map((entry) => [labelOf(entry), entry.getAttribute("aria-disabled"), entry.getAttribute("aria-checked"), noteOf(entry)]);
const element = (id: string): string => new RegExp(`<[a-z]+ id="${id}"[^>]*>`).exec(editor.engine.text)?.[0] ?? "";
const uses = (): string[] => [...editor.engine.text.matchAll(/<use [^>]*\/>/g)].map((match) => match[0]);

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { ...MOUSE, bubbles: true, cancelable: true, composed: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y });
}

/// Un trascinamento col mouse: la camera parte dall'identità, quindi i
/// punti sono anche quelli della scena.
function drag(points: readonly (readonly [number, number])[]): void {
  const target = surface();
  const [x0, y0] = points[0]!;
  target.dispatchEvent(pointer("pointerdown", x0, y0));
  for (const [x, y] of points.slice(1)) target.dispatchEvent(pointer("pointermove", x, y));
  const [x1, y1] = points[points.length - 1]!;
  target.dispatchEvent(pointer("pointerup", x1, y1));
}

function key(name: string, init: KeyboardEventInit = {}): void {
  surface().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

/// Il pannello delle proprietà, un suo campo e ciò che vi si scrive.
const properties = (): HTMLElement => host.querySelector<HTMLElement>(".draw-properties")!;
const property = (id: string): HTMLElement => properties().querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`)!;
const propertyInput = (id: string): HTMLInputElement => property(id).querySelector<HTMLInputElement>(".draw-properties-input")!;
const face = (id: string): HTMLButtonElement => property(id).querySelector<HTMLButtonElement>(".draw-properties-menu")!;
/// I campi di «Ripetizione» che si vedono, col valore: il tipo, poi i
/// numeri col loro nome.
const repeatRows = (): string[] =>
  [...properties().querySelectorAll<HTMLElement>('.draw-properties-field[data-field^="repeat"]')]
    .filter((field) => !field.hidden)
    .map((field) => {
      const input = field.querySelector<HTMLInputElement>(".draw-properties-input");
      return input === null ? field.querySelector(".draw-properties-menu")!.textContent! : `${field.querySelector("label")!.textContent}: ${input.value}`;
    });

/// Scrive `text` nel campo e lo fa partire con Invio.
function enter(target: HTMLInputElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

const rightClick = (x: number, y: number): void => {
  surface().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
  clock += 1000;
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  owner.close();
  host.remove();
});

describe("il menu «Ripeti»", () => {
  it("c'è dall'Esperto, e la ripetizione radiale nuova diventa la selezione, in un passo", () => {
    mount(SOURCE, { level: "standard" });
    editor.select([A]);
    expect(barButton("Ripeti").hidden).toBe(true);
    editor.setLevel("expert");
    expect(barButton("Ripeti").hidden).toBe(false);
    expect(barButton("Ripeti").getAttribute("aria-haspopup")).toBe("menu");
    barButton("Ripeti").click();
    expect(entries()).toEqual([
      ["Ripetizione radiale", null, null, null],
      ["Ripetizione a griglia", null, null, null],
      ["Ripetizione a specchio", null, null, null],
      ["Espandi la ripetizione", "true", null, "Fra gli oggetti scelti non c’è una ripetizione."],
    ]);
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
    item("Ripetizione radiale").click();
    const made = new RegExp(`<g id="(o[a-z0-9]{8})" fub:repeat="radial 8 200 141">\\s*<rect id="${A}"`).exec(editor.engine.text);
    expect(made).not.toBeNull();
    expect(editor.selection).toEqual([made![1]]);
    expect(uses()).toHaveLength(7);
    expect(uses().every((each) => each.endsWith(`href="#${A}"/>`))).toBe(true);
    // Il quarto di giro è esatto.
    expect(uses()[1]).toMatch(/transform="matrix\(0 1 -1 0 341 -59\)"/);
    expect(spoken()).toBe("Ripetizione radiale: l’originale 8 volte intorno al centro.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Ripetizione.");
    expect(editor.engine.text).toBe(SOURCE);
  });

  it("su una ripetizione segna il suo tipo, e un altro tipo la rifà coi valori di partenza", () => {
    mount(MIRRORED);
    editor.select([R]);
    barButton("Ripeti").click();
    expect(entries()).toEqual([
      ["Ripetizione radiale", null, "false", null],
      ["Ripetizione a griglia", null, "false", null],
      ["Ripetizione a specchio", null, "true", null],
      ["Espandi la ripetizione", null, null, null],
    ]);
    // Il tipo che ha già non cambia niente.
    item("Ripetizione a specchio").click();
    expect(editor.engine.text).toBe(MIRRORED);
    barButton("Ripeti").click();
    item("Ripetizione a griglia").click();
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="grid 3 3 25 25">`);
    expect(uses()).toHaveLength(8);
    expect(element(C)).toBe(`<use id="${C}" transform="matrix(1 0 0 1 25 0)" href="#${A}"/>`);
    expect(editor.selection).toEqual([R]);
    expect(spoken()).toBe("Ripetizione a griglia: l’originale in 3 colonne per 3 righe.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Modifica della ripetizione.");
    expect(editor.engine.text).toBe(MIRRORED);
  });

  it("dentro la ripetizione aperta cambia il tipo di quella degli originali scelti, che restano la selezione", () => {
    mount(MIRRORED);
    editor.select([R]);
    key("Enter", { ctrlKey: true });
    expect(editor.selection).toEqual([A]);
    barButton("Ripeti").click();
    expect(entries().map(([label, , checked]) => [label, checked])).toEqual([
      ["Ripetizione radiale", "false"],
      ["Ripetizione a griglia", "false"],
      ["Ripetizione a specchio", "true"],
      ["Espandi la ripetizione", null],
    ]);
    item("Ripetizione radiale").click();
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="radial 8 200 141">`);
    expect(editor.selection).toEqual([A]);
  });

  it("dal menu del foglio: le stesse voci, ed «Espandi» fa delle copie oggetti veri, con la selezione che resta", () => {
    mount(MIRRORED);
    editor.setTool("select");
    rightClick(200, 110);
    expect(editor.selection).toEqual([R]);
    const labels = menu().map(labelOf);
    const at = labels.indexOf("Ripetizione radiale");
    expect(labels.slice(at, at + 4)).toEqual(["Ripetizione radiale", "Ripetizione a griglia", "Ripetizione a specchio", "Espandi la ripetizione"]);
    item("Espandi la ripetizione").click();
    expect(uses()).toEqual([]);
    expect(element(R)).toBe(`<g id="${R}">`);
    expect(editor.engine.text).toMatch(new RegExp(`<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2"/>\\s*<rect id="o[a-z0-9]{8}" x="190" y="100" width="20" height="20" fill="#0072b2" transform="matrix\\(-1 0 0 1 500 0\\)"/>\\s*</g>`));
    expect(editor.selection).toEqual([R]);
    expect(spoken()).toBe("1 ripetizione espansa: ogni copia ora è un oggetto, che si modifica da solo.");
    editor.undo();
    expect(editor.engine.text).toBe(MIRRORED);
  });

  it("in sola lettura le voci del menu del foglio sono spente", () => {
    mount(MIRRORED);
    editor.setTool("select");
    editor.select([R]);
    editor.setReadOnly(true);
    rightClick(200, 110);
    const shown = entries().filter(([label]) => label.startsWith("Ripetizione") || label === "Espandi la ripetizione");
    expect(shown.map(([, disabled, , note]) => [disabled, note])).toEqual([
      ["true", null],
      ["true", null],
      ["true", null],
      ["true", null],
    ]);
  });
});

describe("separare, eliminare e aggiungere", () => {
  it("«Separa» una ripetizione: le copie diventano oggetti accanto all'originale, in un passo", () => {
    mount(MIRRORED);
    editor.select([R]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(editor.engine.text).not.toContain("fub:repeat");
    expect(element(R)).toBe("");
    expect(uses()).toEqual([]);
    expect(editor.engine.text).toMatch(
      new RegExp(`<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2"/>\\s*<rect id="(o[a-z0-9]{8})" x="190" y="100" width="20" height="20" fill="#0072b2" transform="matrix\\(-1 0 0 1 500 0\\)"/>`),
    );
    expect(editor.selection).toHaveLength(2);
    expect(spoken()).toBe("1 gruppo separato.");
    editor.undo();
    expect(editor.engine.text).toBe(MIRRORED);
  });

  it("eliminare l'ultimo originale toglie la ripetizione intera", () => {
    mount(MIRRORED);
    editor.select([R]);
    key("Enter", { ctrlKey: true });
    expect(editor.selection).toEqual([A]);
    key("Delete");
    expect(editor.engine.text).not.toContain(R);
    expect(uses()).toEqual([]);
    expect(editor.engine.text).toContain(`<rect id="${B}"`);
    editor.undo();
    expect(editor.engine.text).toBe(MIRRORED);
  });

  it("un oggetto disegnato dentro la ripetizione aperta è un originale, e riceve le sue copie nello stesso passo", () => {
    mount(MIRRORED);
    editor.select([R]);
    key("Enter", { ctrlKey: true });
    editor.setTool("rect");
    drag([
      [200, 150],
      [210, 160],
      [220, 170],
    ]);
    const added = new RegExp(`<rect id="(o[a-z0-9]{8})" x="200" y="150" width="20" height="20"[^>]*/>\\s*<use id="o[a-z0-9]{8}" transform="matrix\\(-1 0 0 1 500 0\\)" href="#([a-z0-9]+)"/>`).exec(editor.engine.text);
    expect(added).not.toBeNull();
    expect(added![2]).toBe(added![1]);
    expect(uses()).toHaveLength(2);
    editor.undo();
    expect(editor.engine.text).toBe(MIRRORED);
  });

  it("nell'albero la ripetizione è un oggetto solo, col suo tipo, che si apre sui suoi originali e non sulle copie", () => {
    mount(MIRRORED);
    host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    const tree = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
    const rows = (): [string | undefined, string | null][] =>
      [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => [row.dataset.key, row.querySelector(".draw-object-label")!.textContent]);
    expect(rows()).toEqual([
      ["l1", "Livello «Livello 1», corrente"],
      [B, "Rettangolo, Vermiglio"],
      [R, "Ripetizione a specchio, 1 oggetto"],
    ]);
    // Fine porta all'ultima riga, la ripetizione, e la freccia a destra la
    // apre.
    tree().focus();
    for (const name of ["End", "ArrowRight"]) tree().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    expect(editor.selection).toEqual([R]);
    expect(rows()).toEqual([
      ["l1", "Livello «Livello 1», corrente"],
      [B, "Rettangolo, Vermiglio"],
      [R, "Ripetizione a specchio, 1 oggetto"],
      [A, "Rettangolo, Blu"],
    ]);
  });

  it("le copie non si scelgono da sole: Ctrl+A sceglie la ripetizione, e il clic su una copia anche", () => {
    mount(MIRRORED);
    editor.setTool("select");
    key("a", { ctrlKey: true });
    expect(editor.selection).toEqual([R, B]);
    editor.select([]);
    clock += 1000;
    drag([[300, 110]]);
    expect(editor.selection).toEqual([R]);
  });
});

describe("la sezione «Ripetizione» del pannello", () => {
  it("una radiale mostra il tipo, le volte, il raggio e il centro, e ogni numero la cambia con le sue copie", () => {
    mount(RADIAL);
    editor.select([R]);
    key("Enter");
    const section = properties().querySelector<HTMLElement>('.draw-properties-section[data-section="repeat"]')!;
    expect(section.hidden).toBe(false);
    expect(section.querySelector(".draw-properties-toggle-text")!.textContent).toBe("Ripetizione");
    // Dopo «Forma» e prima di «Aspetto».
    const order = [...properties().querySelectorAll<HTMLElement>(".draw-properties-section")].map((each) => each.dataset.section);
    expect(order.indexOf("repeat")).toBe(order.indexOf("shape") + 1);
    expect(repeatRows()).toEqual(["Radiale", "Volte: 4", "Raggio (px): 90", "Centro X (px): 200", "Centro Y (px): 200"]);
    enter(propertyInput("repeatCount"), "6");
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="radial 6 200 200">`);
    expect(uses()).toHaveLength(5);
    expect(element(C)).toBe(`<use id="${C}" transform="matrix(0.5 0.866 -0.866 0.5 273.2051 -73.2051)" href="#${A}"/>`);
    expect(editor.selection).toEqual([R]);
    expect(repeatRows()[1]).toBe("Volte: 6");
    editor.undo();
    expect(editor.engine.text).toBe(RADIAL);
    // Il raggio allontana l'originale dal centro, e le copie lo seguono.
    enter(propertyInput("repeatRadius"), "100");
    expect(element(A)).toBe(`<rect id="${A}" x="190" y="100" width="20" height="20" fill="#0072b2" transform="matrix(1 0 0 1 0 -10)"/>`);
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="radial 4 200 200">`);
    editor.undo();
    enter(propertyInput("repeatX"), "210");
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="radial 4 210 200">`);
    expect(element(C)).toBe(`<use id="${C}" transform="matrix(0 1 -1 0 410 -10)" href="#${A}"/>`);
    editor.undo();
    expect(editor.engine.text).toBe(RADIAL);
  });

  it("una griglia mostra colonne, righe e passi, e non scrive una griglia di una cella", () => {
    mount(GRID);
    editor.select([R]);
    key("Enter");
    expect(repeatRows()).toEqual(["A griglia", "Colonne: 2", "Righe: 1", "Passo delle colonne (px): 30", "Passo delle righe (px): 30"]);
    enter(propertyInput("repeatColumns"), "3");
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="grid 3 1 30 30">`);
    expect(uses()).toHaveLength(2);
    enter(propertyInput("repeatColumns"), "1");
    expect(propertyInput("repeatColumns").getAttribute("aria-invalid")).toBe("true");
    expect(property("repeatColumns").querySelector(".draw-properties-error")!.textContent).toBe("Una griglia ha da 2 a 1000 celle, colonne per righe.");
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="grid 3 1 30 30">`);
    enter(propertyInput("repeatStepX"), "40");
    expect(element(C)).toBe(`<use id="${C}" transform="matrix(1 0 0 1 40 0)" href="#${A}"/>`);
  });

  it("uno specchio mostra l'angolo e la distanza dell'asse dal centro dell'originale", () => {
    mount(MIRRORED);
    editor.select([R]);
    key("Enter");
    expect(repeatRows()).toEqual(["A specchio", "Angolo dell’asse (°): 90", "Distanza dell’asse (px): 50"]);
    // Un asse orizzontale, 50 sopra il centro del quadrato.
    enter(propertyInput("repeatAngle"), "0");
    expect(element(C)).toBe(`<use id="${C}" transform="matrix(1 0 0 -1 0 120)" href="#${A}"/>`);
    expect(repeatRows()).toEqual(["A specchio", "Angolo dell’asse (°): 0", "Distanza dell’asse (px): 50"]);
    enter(propertyInput("repeatDistance"), "-20");
    expect(element(C)).toBe(`<use id="${C}" transform="matrix(1 0 0 -1 0 260)" href="#${A}"/>`);
  });

  it("il menu del tipo rifà la ripetizione, ed «Espandi la ripetizione» la espande", () => {
    mount(RADIAL);
    editor.select([R]);
    key("Enter");
    face("repeat").click();
    expect(entries().map(([label, , checked]) => [label, checked])).toEqual([
      ["Radiale", "true"],
      ["A griglia", "false"],
      ["A specchio", "false"],
      ["Espandi la ripetizione", null],
    ]);
    item("A griglia").click();
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="grid 3 3 25 25">`);
    expect(repeatRows()[0]).toBe("A griglia");
    face("repeat").click();
    item("Espandi la ripetizione").click();
    expect(uses()).toEqual([]);
    expect(editor.selection).toEqual([R]);
    expect(repeatRows()).toEqual([]);
  });

  it("dentro la ripetizione aperta la sezione è quella della ripetizione degli originali scelti", () => {
    mount(RADIAL);
    editor.select([R]);
    key("Enter", { ctrlKey: true });
    expect(editor.selection).toEqual([A]);
    key("Enter");
    expect(repeatRows()[0]).toBe("Radiale");
    enter(propertyInput("repeatCount"), "3");
    expect(element(R)).toBe(`<g id="${R}" fub:repeat="radial 3 200 200">`);
    expect(editor.selection).toEqual([A]);
  });
});
