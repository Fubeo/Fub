// @vitest-environment happy-dom
// «Rendi modificabile» nell'editor, dal livello Esperto: la voce del menu
// della selezione sul blocco di un altro programma sotto il puntatore o
// sugli oggetti scelti che ne contengono, quella per tutto il disegno, la
// finestra con il prima e il dopo, e un passo d'annulla.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";

const OK = "ok1a1a1a1";
const GROUP = "ogr2b2b2b";

/// Un foglio di 400 × 400: un quadrato rosso scritto con `style`, uno
/// modificabile, uno in uno `switch` che FubDraw non ha, e un gruppo
/// modificabile con dentro un cerchio scritto con `style`.
const SOURCE = doc(
  `<title>Prova</title>${LAYER}<rect x="10" y="10" width="80" height="80" style="fill:#ff0000"/>` +
    `<rect id="${OK}" x="200" y="200" width="40" height="40" fill="#0072b2"/>` +
    `<switch><rect x="300" y="10" width="50" height="50" fill="#00ff00"/></switch>` +
    `<g id="${GROUP}"><rect x="100" y="300" width="40" height="40" fill="#000000"/><circle cx="200" cy="320" r="10" style="fill:#d55e00"/></g></g>`,
).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

/// Lo stesso foglio senza parti di altri programmi.
const PLAIN = doc(`<title>Prova</title>${LAYER}<rect id="${OK}" x="200" y="200" width="40" height="40" fill="#0072b2"/></g>`).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

const ITEM = "Rendi modificabile…";
const ALL = "Rendi modificabile il disegno…";

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;

function mount(source = SOURCE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { onChange: (change) => changes.push(change), level: "expert", ...options });
  editor.setTool("select");
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();
const menu = (): HTMLButtonElement[] => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')];
};
const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
const noteOf = (entry: HTMLElement): string | null => entry.querySelector(".menu-description")?.textContent ?? null;
const item = (label: string): HTMLButtonElement | undefined => menu().find((entry) => labelOf(entry) === label);
const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".shell-dialog")!;
const rightClick = (x: number, y: number): void => {
  surface().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
};
const selectionMenu = (): void => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Selezione avanzata"]')!.click();

/// Sceglie `label` nel menu aperto e conferma la finestra che apre.
async function confirm(label: string): Promise<void> {
  item(label)!.click();
  await vi.waitFor(() => expect(dialog()?.querySelector(".draw-editable-message")).toBeTruthy());
  dialog().querySelector("form")!.requestSubmit();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu, .shell-dialog")) open.remove();
  owner.close();
  host.remove();
});

describe("«Rendi modificabile» nel menu della selezione", () => {
  it("c'è dall'Esperto", () => {
    mount(SOURCE, { level: "standard" });
    rightClick(50, 50);
    expect(item(ITEM)).toBeUndefined();
    expect(item(ALL)).toBeUndefined();
    closeContextMenu();
    editor.setLevel("expert");
    rightClick(50, 50);
    expect(item(ITEM)!.getAttribute("aria-disabled")).toBeNull();
    expect(item(ALL)!.getAttribute("aria-disabled")).toBeNull();
  });

  it("sul blocco sotto il puntatore: la finestra, poi la parte riscritta in un passo, che si annulla", async () => {
    mount();
    rightClick(50, 50);
    item(ITEM)!.click();
    await vi.waitFor(() => expect(dialog()?.querySelector(".draw-editable-message")).toBeTruthy());
    expect(dialog().querySelector(".palette-heading")!.textContent).toBe("Rendi modificabile");
    expect(dialog().querySelector(".draw-editable-message")!.textContent).toBe("Una parte di un altro programma diventa modificabile, e si vede come prima.");
    expect([...dialog().querySelectorAll(".draw-editable-list li")].map((each) => each.textContent)).toEqual(["Stile in linea scritto come attributi: 1"]);
    dialog().querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const text = editor.engine.text;
    expect(text).toContain('<rect x="10" y="10" width="80" height="80" fill="#ff0000"/>');
    // Una forma senza id resta senza, come le altre; il resto non si tocca.
    expect(text).toContain('<circle cx="200" cy="320" r="10" style="fill:#d55e00"/>');
    expect(text).toContain("<switch>");
    expect(spoken()).toBe("Una parte è diventata modificabile.");
    editor.undo();
    expect(editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Parti rese modificabili.");
  });

  it("sugli oggetti scelti che hanno parti di altri programmi; spenta, col perché, dove non ce ne sono", async () => {
    mount();
    rightClick(395, 395);
    expect(item(ITEM)!.getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item(ITEM)!)).toBe("Scegli degli oggetti con parti di altri programmi, o tocca col tasto destro una parte che ne viene.");
    closeContextMenu();
    editor.select([OK]);
    selectionMenu();
    expect(item(ITEM)!.getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item(ITEM)!)).toBe("Gli oggetti scelti non hanno parti di altri programmi.");
    closeContextMenu();
    editor.select([GROUP]);
    selectionMenu();
    await confirm(ITEM);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(editor.engine.text).toContain('<circle cx="200" cy="320" r="10" fill="#d55e00"/>');
    expect(editor.engine.text).toContain('style="fill:#ff0000"');
  });

  it("su tutto il disegno dice che cosa resta e perché, e lo ripete dopo", async () => {
    mount();
    rightClick(395, 395);
    item(ALL)!.click();
    await vi.waitFor(() => expect(dialog()?.querySelector(".draw-editable-message")).toBeTruthy());
    expect(dialog().querySelector(".palette-heading")!.textContent).toBe("Rendi modificabile il disegno");
    expect(dialog().querySelector(".draw-editable-message")!.textContent).toBe(
      "2 parti di altri programmi diventano modificabili, e si vedono come prima. Una parte resta com’è: sotto, il perché.",
    );
    expect([...dialog().querySelectorAll(".draw-editable-list li")].map((each) => each.textContent)).toContain("«switch»: FubDraw non ha l’elemento «switch»");
    expect([...dialog().querySelectorAll("figcaption")].map((each) => each.textContent)).toEqual(["Prima", "Dopo: ciò che resta è sbiadito"]);
    dialog().querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(editor.engine.text).not.toContain("style=");
    expect(editor.engine.text).toContain("<switch>");
    expect(spoken()).toBe("2 parti sono diventate modificabili. Una resta com’è.");
  });

  it("annullata la finestra niente cambia; un disegno senza parti di altri programmi spegne la voce", async () => {
    mount();
    rightClick(50, 50);
    item(ITEM)!.click();
    await vi.waitFor(() => expect(dialog()?.querySelector(".draw-editable-message")).toBeTruthy());
    [...dialog().querySelectorAll("button")].find((button) => button.textContent === "Annulla")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toHaveLength(0);
    expect(editor.engine.text).toBe(SOURCE);
    owner.close();
    owner = openLifetime();
    host.replaceChildren();
    mount(PLAIN);
    rightClick(395, 395);
    expect(item(ALL)!.getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item(ALL)!)).toBe("Il disegno non ha parti di altri programmi che si vedono.");
  });

  it("in sola lettura le voci sono spente", () => {
    mount();
    editor.setReadOnly(true);
    rightClick(50, 50);
    expect(item(ITEM)!.getAttribute("aria-disabled")).toBe("true");
    expect(item(ALL)!.getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item(ITEM)!)).toBeNull();
  });
});
