// @vitest-environment happy-dom
// I simboli nell'editor: il pannello che si apre dal livello Esperto, i
// simboli del disegno e quelli delle librerie del vault, l'inserimento al
// centro della vista o dove li si lascia, la copia di una libreria che entra
// una volta sola, l'aggiornamento dalla libreria dopo la finestra che lo
// mostra, e l'eliminazione di un simbolo che non ha istanze.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawChange, type DrawEditor, type DrawEditorOptions } from "./editor";
import { type LibraryChange, type LibraryFile, type SymbolLibraryPort } from "./symbol-libraries";
import { readLibrary, type Library } from "./symbol-library";
import { LAYER } from "./test-support";

const V = "ov1v1v1v1";
const A = "oa1a1a1a1";

/// Una libreria con la «Valvola», un rettangolo di 40 × 20 attorno
/// all'origine.
const valvola = (fill: string): string =>
  doc(`<title>Impianti</title><defs id="fub-defs"><symbol id="rvalvola0" overflow="visible"><title>Valvola</title><rect id="${V}" x="-20" y="-10" width="40" height="20" fill="${fill}"/></symbol></defs>${LAYER}</g>`);
const IMPIANTI = "Symbols/Impianti.svg";

/// Un foglio di 400 × 400 con un quadrato, e la «Presa» del disegno, che non
/// ha istanze.
const SOURCE = doc(
  '<title>Prova</title><defs id="fub-defs"><symbol id="rpresa000" overflow="visible"><title>Presa</title><circle id="op1p1p1p1" r="10" fill="#000000"/></symbol></defs>' +
    `${LAYER}<rect id="${A}" x="13" y="7" width="40" height="40" fill="#000000"/></g>`,
).replace('viewBox="0 0 100 100"', 'viewBox="0 0 400 400"');

const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

/// Il vault finto: i file coi loro testi e chi ascolta.
class Vault implements SymbolLibraryPort {
  readonly texts = new Map<string, string>();
  readonly files_ = new Map<string, LibraryFile>();
  listener: ((change: LibraryChange) => void) | null = null;
  private clock = 1;

  put(path: string, text: string): void {
    this.texts.set(path, text);
    this.files_.set(path, { path, size: text.length, mtime: this.clock++ });
    this.listener?.({ path });
  }

  setting(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  files(folder: string): Promise<readonly LibraryFile[]> {
    const inside = [...this.files_.values()].filter((file) => file.path.startsWith(`${folder}/`));
    return inside.length === 0 ? Promise.reject(new Error("no folder")) : Promise.resolve(inside);
  }

  read(path: string): Promise<string> {
    return Promise.resolve(this.texts.get(path)!);
  }

  watch(changed: (change: LibraryChange) => void): () => void {
    this.listener = changed;
    return () => {
      this.listener = null;
    };
  }
}

let host: HTMLElement;
let owner: Lifetime;
let changes: DrawChange[];
let editor: DrawEditor;
let vault: Vault;

function mount(source = SOURCE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { onChange: (change) => changes.push(change), level: "expert", symbolLibraries: vault, ...options });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();
const button = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Simboli"]')!;
const panel = (): HTMLElement => host.querySelector<HTMLElement>(".draw-symbols")!;
const tiles = (): HTMLButtonElement[] => [...panel().querySelectorAll<HTMLButtonElement>(".draw-symbols-tile")];
const names = (): string[] => tiles().map((each) => each.getAttribute("aria-label")!);
const tile = (start: string, section: string): HTMLButtonElement =>
  tiles().find((each) => each.getAttribute("aria-label")!.startsWith(start) && each.closest(".draw-symbols-group")!.querySelector("h3")!.textContent === section)!;
const here = (name: string): HTMLButtonElement => tile(name, "In questo disegno");
const there = (name: string): HTMLButtonElement => tile(name, "Impianti");
const footer = (): string => panel().querySelector(".draw-symbols-footer")!.textContent!;
const symbols = (): string[] => [...editor.engine.text.matchAll(/<symbol id="(r[a-z0-9]{8})"/g)].map((match) => match[1]!);
const uses = (): string[] => [...editor.engine.text.matchAll(/<use [^>]*\/>/g)].map((match) => match[0]);

const menu = (): HTMLButtonElement[] => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
};
const labelOf = (entry: HTMLElement): string => entry.querySelector(".menu-label")!.textContent ?? "";
const item = (label: string): HTMLButtonElement => menu().find((entry) => labelOf(entry) === label)!;
const noteOf = (entry: HTMLElement): string | null => entry.querySelector(".menu-description")?.textContent ?? null;
/// Apre il menu del riquadro `of` dalla tastiera.
function menuOf(of: HTMLButtonElement): void {
  of.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }));
}

const dialog = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".modale");
  return open[open.length - 1]!;
};

/// Dà al foglio una misura e un posto sullo schermo: i punti del client sono
/// anche quelli della scena.
function size(width: number, height: number): void {
  Object.defineProperty(surface(), "clientWidth", { configurable: true, value: width });
  Object.defineProperty(surface(), "clientHeight", { configurable: true, value: height });
  vi.spyOn(surface(), "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
}

function pointer(type: string, target: HTMLElement, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { ...MOUSE, bubbles: true, cancelable: true, composed: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }),
  );
}

/// Il pannello aperto sul foglio di 400 × 400, con le librerie lette.
async function opening(source = SOURCE, options: DrawEditorOptions = {}): Promise<void> {
  mount(source, options);
  size(400, 400);
  button().click();
  await vi.waitFor(() => expect(footer()).toBe("Le librerie sono i disegni della cartella «Symbols» del vault; la cartella si sceglie nelle impostazioni dei disegni."));
  await vi.waitFor(() => expect(there("Valvola")).toBeDefined());
}

const library = (text: string): Library => readLibrary(IMPIANTI, text) as Library;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  changes = [];
  vault = new Vault();
  vault.put(IMPIANTI, valvola("#0072b2"));
  vi.stubGlobal("navigator", { language: "it-IT" });
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  owner.close();
  host.remove();
  for (const modal of document.querySelectorAll(".modale")) modal.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("il pannello dei simboli, dal livello Esperto", () => {
  it("c'è dal livello Esperto, si apre dal pulsante e legge le librerie soltanto allora", async () => {
    const read = vi.spyOn(vault, "read");
    mount(SOURCE, { level: "standard" });
    expect(button().hidden).toBe(true);
    editor.setLevel("expert");
    expect(button().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    expect(panel().hidden).toBe(true);
    expect(read).not.toHaveBeenCalled();
    button().click();
    expect(panel().hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(panel().querySelector(".draw-symbols-search"));
    await vi.waitFor(() => expect(there("Valvola")).toBeDefined());
    expect(read).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(["Presa, nessuna istanza", "Valvola"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    editor.setLevel("standard");
    expect(panel().hidden).toBe(true);
  });

  it("un disegno senza simboli lo dice, e dice dove si cercano le librerie", async () => {
    const empty = doc(`<title>Prova</title>${LAYER}</g>`);
    vault = new Vault();
    mount(empty);
    button().click();
    await vi.waitFor(() => expect(footer()).toBe("La cartella «Symbols» non c’è nel vault: creala e mettici dei disegni coi loro simboli, oppure scegline un’altra nelle impostazioni dei disegni."));
    expect(panel().querySelector(".draw-symbols-note")!.textContent).toBe("Ancora nessun simbolo: scegli degli oggetti e usa «Crea simbolo», o inseriscine uno da una libreria.");
    expect(tiles()).toHaveLength(0);
  });

  it("senza le librerie del vault mostra soltanto i simboli del disegno", () => {
    mount(SOURCE, { symbolLibraries: undefined });
    button().click();
    expect(names()).toEqual(["Presa, nessuna istanza"]);
    expect(panel().querySelector<HTMLElement>(".draw-symbols-footer")!.hidden).toBe(true);
  });
});

describe("inserire", () => {
  it("un simbolo del disegno entra come sua istanza al centro della vista, scelta, in un passo", async () => {
    await opening();
    here("Presa").click();
    expect(uses()).toHaveLength(1);
    expect(uses()[0]).toMatch(/^<use id="o[a-z0-9]{8}" transform="matrix\(1 0 0 1 200 200\)" href="#rpresa000"\/>$/);
    expect(editor.selection).toHaveLength(1);
    expect(spoken()).toMatch(/^Simbolo inserito: Presa\./);
    await vi.waitFor(() => expect(names()[0]).toBe("Presa, 1 istanza"));
    editor.undo();
    expect(spoken()).toBe("Annullato: Inserimento del simbolo.");
    expect(uses()).toHaveLength(0);
  });

  it("uno di una libreria entra la prima volta come copia, col simbolo e un'istanza, in un passo; poi come istanza", async () => {
    await opening();
    const before = changes.length;
    there("Valvola").click();
    await vi.waitFor(() => expect(uses()).toHaveLength(1));
    expect(changes.length).toBe(before + 1);
    const copied = symbols().find((id) => id !== "rpresa000")!;
    const print = library(valvola("#0072b2")).symbols[0]!.print;
    expect(editor.engine.text).toContain(`fub:source="${IMPIANTI}#rvalvola0 ${print}"`);
    expect(uses()[0]).toContain(`href="#${copied}"`);
    expect(spoken()).toMatch(/^Simbolo inserito: Valvola\./);
    await vi.waitFor(() => expect(there("Valvola").getAttribute("aria-label")).toBe("Valvola, già nel disegno"));
    expect(here("Valvola").getAttribute("aria-label")).toBe("Valvola, 1 istanza");

    there("Valvola").click();
    expect(symbols()).toHaveLength(2);
    expect(uses()).toHaveLength(2);
    expect(uses()[1]).toContain(`href="#${copied}"`);
    editor.undo();
    expect(symbols()).toHaveLength(2);
    editor.undo();
    expect(spoken()).toBe("Annullato: Inserimento del simbolo.");
    expect(symbols()).toEqual(["rpresa000"]);
  });

  it("se la libreria è cambiata, entra il simbolo del disegno, e lo si dice", async () => {
    await opening();
    there("Valvola").click();
    await vi.waitFor(() => expect(uses()).toHaveLength(1));
    vault.put(IMPIANTI, valvola("#d55e00"));
    await vi.waitFor(() => expect(there("Valvola").getAttribute("aria-label")).toBe("Valvola, già nel disegno, in una versione diversa"));
    expect(here("Valvola").getAttribute("aria-label")).toBe("Valvola, 1 istanza, la libreria ne ha una versione nuova");
    expect(here("Valvola").querySelector(".draw-symbols-badge")!.textContent).toBe("↻");
    there("Valvola").click();
    expect(symbols()).toHaveLength(2);
    expect(uses()).toHaveLength(2);
    expect(editor.engine.text).not.toContain("#d55e00");
    expect(spoken()).toContain("La libreria ne ha una versione diversa: la porta nel disegno «Aggiorna nel disegno…», nel menu del simbolo.");
  });

  it("tirato sul foglio entra dove lo si lascia; fuori dal foglio no", async () => {
    await opening();
    const from = here("Presa");
    pointer("pointerdown", from, 10, 10);
    pointer("pointermove", from, 30, 10);
    pointer("pointermove", from, 100, 120);
    expect(host.querySelector(".draw-editor")!.getAttribute("data-library-drop")).toBe("copy");
    pointer("pointerup", from, 100, 120);
    expect(uses()).toHaveLength(1);
    expect(uses()[0]).toContain('transform="matrix(1 0 0 1 100 120)"');
    expect(document.activeElement).toBe(surface());

    pointer("pointerdown", from, 10, 10);
    pointer("pointermove", from, 30, 10);
    pointer("pointermove", from, 600, 120);
    expect(host.querySelector(".draw-editor")!.getAttribute("data-library-drop")).toBe("none");
    pointer("pointerup", from, 600, 120);
    expect(uses()).toHaveLength(1);
    expect(spoken()).toBe("Inserimento annullato.");
  });

  it("in sola lettura non entra niente", async () => {
    await opening();
    editor.setReadOnly(true);
    here("Presa").click();
    expect(uses()).toHaveLength(0);
    expect(here("Presa").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("il menu di un simbolo", () => {
  it("di un simbolo del disegno: inserisci, istanze, modifica, rinomina, elimina; elimina c'è quando non ha istanze", async () => {
    await opening();
    menuOf(here("Presa"));
    expect(menu().map(labelOf)).toEqual(["Inserisci", "Scegli le istanze", "Modifica simbolo", "Rinomina simbolo…", "Elimina simbolo"]);
    expect(item("Scegli le istanze").getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item("Scegli le istanze"))).toBe("Non ha ancora istanze.");
    expect(item("Elimina simbolo").getAttribute("aria-disabled")).toBeNull();
    item("Elimina simbolo").click();
    expect(symbols()).toEqual([]);
    expect(spoken()).toBe("Simbolo «Presa» eliminato.");
    editor.undo();
    expect(spoken()).toBe("Annullato: Eliminazione del simbolo.");
    expect(symbols()).toEqual(["rpresa000"]);
  });

  it("eliminato un simbolo, se ne vanno anche le risorse private che usava", async () => {
    const source = SOURCE.replace(
      '<circle id="op1p1p1p1" r="10" fill="#000000"/></symbol>',
      '<circle id="op1p1p1p1" r="10" fill="url(#rgrad0000)"/></symbol><linearGradient id="rgrad0000" fub:role="private"><stop offset="0" stop-color="#ffffff"/></linearGradient>',
    );
    await opening(source);
    menuOf(here("Presa"));
    item("Elimina simbolo").click();
    expect(editor.engine.text).not.toContain("rgrad0000");
    editor.undo();
    expect(editor.engine.text).toContain('<linearGradient id="rgrad0000"');
  });

  it("un simbolo che ha istanze non si elimina, e lo dice; «Scegli le istanze» le sceglie", async () => {
    await opening();
    here("Presa").click();
    here("Presa").click();
    const placed = editor.selection;
    editor.select([]);
    menuOf(here("Presa"));
    expect(item("Elimina simbolo").getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item("Elimina simbolo"))).toBe("Ha delle istanze: si elimina quando non ne ha più.");
    item("Scegli le istanze").click();
    expect(editor.selection).toHaveLength(2);
    expect(editor.selection).toContain(placed[0]);
    expect(document.activeElement).toBe(surface());
  });

  it("«Aggiorna dalla libreria…» mostra la finestra e, confermata, porta nel disegno il simbolo nuovo, in un passo", async () => {
    await opening();
    there("Valvola").click();
    await vi.waitFor(() => expect(uses()).toHaveLength(1));
    const copied = symbols().find((id) => id !== "rpresa000")!;
    const instance = uses()[0]!;
    menuOf(here("Valvola"));
    expect(item("Aggiorna dalla libreria…").getAttribute("aria-disabled")).toBe("true");
    expect(noteOf(item("Aggiorna dalla libreria…"))).toBe("È uguale a quello della libreria «Impianti».");
    closeContextMenu();

    vault.put(IMPIANTI, valvola("#d55e00"));
    await vi.waitFor(() => expect(here("Valvola").hasAttribute("data-stale")).toBe(true));
    menuOf(here("Valvola"));
    const update = item("Aggiorna dalla libreria…");
    expect(update.getAttribute("aria-disabled")).toBeNull();
    expect(noteOf(update)).toBe("La libreria «Impianti» ne ha una versione nuova.");
    const before = changes.length;
    update.click();
    await vi.waitFor(() => expect(dialog().querySelector(".draw-symbol-update-message")).not.toBeNull());
    expect(dialog().querySelector(".draw-symbol-update-message")!.textContent).toBe(
      "Il simbolo prende il contenuto che ha nella libreria «Impianti»: cambia anche la sua istanza nel disegno, che resta dov’è. " +
        "Se il simbolo è stato modificato in questo disegno, quelle modifiche si perdono.",
    );
    // Le due anteprime sono per gli occhi: la frase dice tutto.
    expect(dialog().querySelector(".draw-symbol-update-pair")!.getAttribute("aria-hidden")).toBe("true");
    expect([...dialog().querySelectorAll(".draw-symbol-update-caption")].map((each) => each.textContent)).toEqual(["Adesso", "Dalla libreria «Impianti»"]);
    expect(dialog().querySelector("h2, .palette-heading")!.textContent).toBe("Aggiorna «Valvola»");
    dialog().querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(changes.length).toBe(before + 1));
    expect(editor.engine.text).toContain('fill="#d55e00"');
    expect(symbols()).toContain(copied);
    expect(uses()[0]).toBe(instance);
    expect(spoken()).toBe("Il simbolo «Valvola» ora è come nella libreria.");
    await vi.waitFor(() => expect(here("Valvola").hasAttribute("data-stale")).toBe(false));
    editor.undo();
    expect(spoken()).toBe("Annullato: Aggiornamento del simbolo.");
    expect(editor.engine.text).not.toContain('fill="#d55e00"');
  });

  it("un simbolo cambiato nel disegno torna com'è nella libreria, e la finestra dice che le modifiche si perdono", async () => {
    await opening();
    there("Valvola").click();
    await vi.waitFor(() => expect(uses()).toHaveLength(1));
    const inner = /<symbol id="r[a-z0-9]{8}" fub:source[^>]*><title>Valvola<\/title><rect id="(o[a-z0-9]{8})"/.exec(editor.engine.text)![1]!;
    expect(editor.perform("draw.action.fill", { op: "set", id: inner, attrs: { fill: "#009e73" } })).toBe(true);
    menuOf(here("Valvola"));
    const update = item("Aggiorna dalla libreria…");
    expect(update.getAttribute("aria-disabled")).toBeNull();
    expect(noteOf(update)).toBe("È cambiato in questo disegno: torna com’è nella libreria «Impianti».");
    update.click();
    await vi.waitFor(() => expect(dialog().querySelector(".draw-symbol-update-message")).not.toBeNull());
    expect(dialog().querySelector(".draw-symbol-update-message")!.textContent).toBe(
      "Il simbolo prende il contenuto che ha nella libreria «Impianti»: cambia anche la sua istanza nel disegno, che resta dov’è. " +
        "Le modifiche fatte al simbolo in questo disegno si perdono.",
    );
    dialog().querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(editor.engine.text).not.toContain("#009e73"));
    expect(editor.engine.text).toContain('fill="#0072b2"');
    menuOf(here("Valvola"));
    expect(item("Aggiorna dalla libreria…").getAttribute("aria-disabled")).toBe("true");
  });

  it("chi rinuncia alla finestra non cambia niente", async () => {
    await opening();
    there("Valvola").click();
    await vi.waitFor(() => expect(uses()).toHaveLength(1));
    vault.put(IMPIANTI, valvola("#d55e00"));
    await vi.waitFor(() => expect(here("Valvola").hasAttribute("data-stale")).toBe(true));
    menuOf(here("Valvola"));
    item("Aggiorna dalla libreria…").click();
    await vi.waitFor(() => expect(dialog().querySelector(".draw-symbol-update-message")).not.toBeNull());
    const text = editor.engine.text;
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.engine.text).toBe(text);
  });

  it("«Modifica simbolo» entra nel simbolo da una sua istanza; lì dentro il simbolo non entra in sé stesso", async () => {
    await opening();
    here("Presa").click();
    menuOf(here("Presa"));
    item("Modifica simbolo").click();
    expect(host.querySelector<HTMLElement>(".draw-isolation")!.hidden).toBe(false);
    const before = editor.engine.text;
    here("Presa").click();
    expect(editor.engine.text).toBe(before);
    expect(spoken()).toBe("Modifica non applicata: un simbolo conterrebbe sé stesso.");
  });

  it("di un simbolo di una libreria che il disegno non ha: soltanto inserisci", async () => {
    await opening();
    menuOf(there("Valvola"));
    expect(menu().map(labelOf)).toEqual(["Inserisci"]);
  });
});
