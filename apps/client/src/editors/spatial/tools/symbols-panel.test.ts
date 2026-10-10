// @vitest-environment happy-dom
// I simboli come pannello, da solo: le sezioni del disegno e delle librerie,
// il nome di ogni riquadro col suo stato a parole e il segno che lo ripete,
// le note al posto della griglia, la ricerca, la tastiera, il menu, le
// anteprime chieste una volta per versione, il trascinamento che passa
// all'editor e la sola lettura.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { createSymbolsPanel, refKey, type SymbolRef, type SymbolsPanel, type SymbolsView } from "./symbols-panel";

let host: HTMLElement;
let life: Lifetime;
let panel: SymbolsPanel;
let calls: string[];
let pictures: Map<string, string | null>;
let asked: string[];

const SLOP = { pen: 3, mouse: 3, touch: 8 } as const;

const drawing = (id: string): SymbolRef => ({ kind: "drawing", id });
const library = (path: string, id: string): SymbolRef => ({ kind: "library", path, id });

const VIEW: SymbolsView = {
  editable: true,
  sections: [
    {
      key: "drawing",
      title: "In questo disegno",
      tiles: [
        { ref: drawing("rvalvola0"), name: "Valvola", version: "1", uses: 3, stale: true },
        { ref: drawing("rpompa000"), name: "Pompa", version: "1", uses: 0 },
      ],
      note: null,
    },
    {
      key: "Symbols/Impianti.svg",
      title: "Impianti",
      tiles: [
        { ref: library("Symbols/Impianti.svg", "rvalvola0"), name: "Valvola", version: "a", present: true, stale: true },
        { ref: library("Symbols/Impianti.svg", "rcaldaia0"), name: "Caldaia", version: "a" },
        { ref: library("Symbols/Impianti.svg", "rpompa000"), name: "Pompa", version: "a", present: true },
      ],
      note: null,
    },
    { key: "Symbols/Enorme.svg", title: "Enorme", tiles: [], note: "Non si legge: è più grande di 16 MB." },
  ],
  footer: "Le librerie sono i disegni della cartella «Symbols» del vault.",
};

function mount(view: SymbolsView = VIEW): SymbolsPanel {
  panel = createSymbolsPanel(life, {
    onInsert: (ref) => calls.push(`insert ${refKey(ref)}`),
    onDrag: (ref, event) => calls.push(`drag ${refKey(ref)} ${event.clientX},${event.clientY}`),
    onMenu: (ref, at, labelledBy) => calls.push(`menu ${refKey(ref)} ${at instanceof HTMLElement ? "tile" : "pointer"} ${labelledBy === tile(ref).id}`),
    picture: (ref, version) => {
      asked.push(`${refKey(ref)}@${version}`);
      return Promise.resolve(pictures.get(refKey(ref)) ?? null);
    },
    onLeave: () => calls.push("leave"),
    slop: SLOP,
  });
  host.append(panel.element);
  panel.update(view);
  return panel;
}

const search = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[type="search"]')!;
const tiles = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-symbols-tile")];
const shown = (): HTMLButtonElement[] => tiles().filter((each) => !each.hidden);
const names = (): string[] => shown().map((each) => each.getAttribute("aria-label")!);
const tile = (ref: SymbolRef): HTMLButtonElement => tiles().find((each) => each.getAttribute("aria-label")!.startsWith(nameOf(ref)) && sectionOf(each) === sectionTitle(ref))!;
const badge = (ref: SymbolRef): HTMLElement => tile(ref).querySelector<HTMLElement>(".draw-symbols-badge")!;
const groups = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".draw-symbols-group")].filter((each) => !each.hidden);
const titles = (): string[] => groups().map((each) => each.querySelector("h3")!.textContent!);
const said = (): string => host.querySelector('[role="status"]')!.textContent!.trim();
const count = (): string => host.querySelector(".draw-symbols-count")!.textContent!;

function nameOf(ref: SymbolRef): string {
  for (const section of VIEW.sections) for (const each of section.tiles) if (refKey(each.ref) === refKey(ref)) return each.name;
  throw new Error(refKey(ref));
}

function sectionTitle(ref: SymbolRef): string {
  return ref.kind === "drawing" ? "In questo disegno" : "Impianti";
}

function sectionOf(button: HTMLElement): string {
  return button.closest(".draw-symbols-group")!.querySelector("h3")!.textContent!;
}

function key(name: string, target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function type(text: string): void {
  search().value = text;
  search().dispatchEvent(new Event("input", { bubbles: true }));
}

function pointer(type: string, target: Element, init: Partial<PointerEventInit> = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0, ...init });
  Object.assign(event, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? "mouse", isPrimary: init.isPrimary ?? true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  calls = [];
  pictures = new Map();
  asked = [];
  // Senza chi guarda, le anteprime si chiedono subito: qui si vede quando.
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("navigator", { language: "it-IT" });
});

afterEach(() => {
  life.close();
  host.remove();
  vi.unstubAllGlobals();
});

describe("i riquadri", () => {
  it("stanno nelle sezioni, nell'ordine dato, coi nomi e lo stato a parole", () => {
    mount();
    expect(titles()).toEqual(["In questo disegno", "Impianti", "Enorme"]);
    expect(names()).toEqual([
      "Valvola, 3 istanze, la libreria ne ha una versione nuova",
      "Pompa, nessuna istanza",
      "Valvola, già nel disegno, in una versione diversa",
      "Caldaia",
      "Pompa, già nel disegno",
    ]);
    // Il suggerimento dice lo stesso; il nome sotto l'anteprima è per gli
    // occhi.
    expect(tile(drawing("rvalvola0")).title).toBe("Valvola, 3 istanze, la libreria ne ha una versione nuova");
    expect(tile(drawing("rvalvola0")).querySelector(".draw-symbols-name")!.getAttribute("aria-hidden")).toBe("true");
    expect(count()).toBe("5 simboli");
  });

  it("hanno un segno che ripete lo stato, mai il solo colore", () => {
    mount();
    expect(badge(drawing("rvalvola0")).textContent).toBe("↻");
    expect(badge(drawing("rpompa000")).textContent).toBe("0");
    expect(badge(library("Symbols/Impianti.svg", "rvalvola0")).textContent).toBe("↻");
    expect(badge(library("Symbols/Impianti.svg", "rpompa000")).textContent).toBe("✓");
    expect(badge(library("Symbols/Impianti.svg", "rcaldaia0")).hidden).toBe(true);
    expect(tile(drawing("rvalvola0")).hasAttribute("data-stale")).toBe(true);
    expect(tile(library("Symbols/Impianti.svg", "rpompa000")).hasAttribute("data-present")).toBe(true);
    expect(tile(library("Symbols/Impianti.svg", "rcaldaia0")).hasAttribute("data-present")).toBe(false);
    for (const each of tiles()) expect(each.querySelector(".draw-symbols-badge")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("una sezione senza simboli dice perché al posto della griglia; in fondo, dove si cercano", () => {
    mount();
    const enorme = groups()[2]!;
    expect(enorme.querySelector<HTMLElement>(".draw-symbols-note")!.hidden).toBe(false);
    expect(enorme.querySelector(".draw-symbols-note")!.textContent).toBe("Non si legge: è più grande di 16 MB.");
    expect(enorme.querySelector<HTMLElement>(".draw-symbols-grid")!.hidden).toBe(true);
    expect(groups()[0]!.querySelector<HTMLElement>(".draw-symbols-note")!.hidden).toBe(true);
    expect(host.querySelector(".draw-symbols-footer")!.textContent).toBe("Le librerie sono i disegni della cartella «Symbols» del vault.");
  });

  it("hanno un solo riquadro nel giro di Tab, e ogni griglia è un gruppo col titolo della sezione", () => {
    mount();
    expect(tiles().filter((each) => each.tabIndex === 0)).toEqual([tiles()[0]]);
    for (const grid of host.querySelectorAll(".draw-symbols-grid")) {
      expect(grid.getAttribute("role")).toBe("group");
      expect(document.getElementById(grid.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
    }
    expect(document.getElementById(panel.element.getAttribute("aria-labelledby")!)!.textContent).toBe("Simboli");
  });

  it("passano la verifica dell'accessibilità, anche in sola lettura", () => {
    mount();
    expect(formatIssues(checkAccessibility(host))).toBe("");
    panel.update({ ...VIEW, editable: false });
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("restano gli stessi quando la vista cambia: il fuoco non si perde", () => {
    mount();
    const pompa = tile(library("Symbols/Impianti.svg", "rpompa000"));
    pompa.focus();
    const sections = VIEW.sections.map((section) => (section.key === "drawing" ? { ...section, tiles: [section.tiles[1]!] } : section));
    panel.update({ ...VIEW, sections });
    expect(tile(library("Symbols/Impianti.svg", "rpompa000"))).toBe(pompa);
    expect(document.activeElement).toBe(pompa);
    expect(names()[0]).toBe("Pompa, nessuna istanza");
    expect(tiles()).toHaveLength(4);
  });
});

describe("le anteprime", () => {
  it("si chiedono una volta per versione, e mostrano l'immagine o il posto vuoto", async () => {
    pictures.set("d:rvalvola0", "blob:valvola");
    mount();
    await vi.waitFor(() => expect(tile(drawing("rvalvola0")).querySelector("img")!.hidden).toBe(false));
    const image = tile(drawing("rvalvola0")).querySelector("img")!;
    expect(image.getAttribute("src")).toBe("blob:valvola");
    expect(image.alt).toBe("");
    expect(tile(drawing("rpompa000")).dataset.picture).toBe("none");
    expect(tile(drawing("rpompa000")).querySelector("img")!.hidden).toBe(true);
    expect(asked).toContain("d:rvalvola0@1");

    asked.length = 0;
    panel.update(VIEW);
    expect(asked).toEqual([]);
    const sections = VIEW.sections.map((section) => (section.key === "drawing" ? { ...section, tiles: [{ ...section.tiles[0]!, version: "2" }, section.tiles[1]!] } : section));
    pictures.set("d:rvalvola0", null);
    panel.update({ ...VIEW, sections });
    expect(asked).toEqual(["d:rvalvola0@2"]);
    await vi.waitFor(() => expect(tile(drawing("rvalvola0")).dataset.picture).toBe("none"));
    expect(image.hasAttribute("src")).toBe(false);
  });
});

describe("la ricerca", () => {
  it("guarda il nome del simbolo e quello della libreria, senza maiuscole né accenti", () => {
    mount();
    type("VALV");
    expect(names().map((each) => each.split(",")[0])).toEqual(["Valvola", "Valvola"]);
    type("impianti pompa");
    expect(names()).toEqual(["Pompa, già nel disegno"]);
    expect(titles()).toEqual(["Impianti"]);
    expect(count()).toBe("1 simbolo");
    expect(said()).toBe("1 simbolo");
    type("caldàia");
    expect(names()).toEqual(["Caldaia"]);
  });

  it("senza risultati lo dice, e nessuna sezione resta", () => {
    mount();
    type("trasformatore");
    expect(shown()).toHaveLength(0);
    expect(groups()).toHaveLength(0);
    const empty = host.querySelector<HTMLElement>(".draw-symbols-empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("Nessun simbolo per «trasformatore».");
    expect(said()).toBe("Nessun simbolo per «trasformatore».");
  });

  it("Esc svuota il campo; a campo vuoto torna al foglio", () => {
    mount();
    type("pompa");
    expect(key("Escape", search()).defaultPrevented).toBe(true);
    expect(search().value).toBe("");
    expect(shown()).toHaveLength(5);
    expect(calls).toEqual([]);
    key("Escape", search());
    expect(calls).toEqual(["leave"]);
  });
});

describe("la tastiera", () => {
  it("dal campo ↓ porta al primo riquadro; le frecce passano da una sezione all'altra; ↑ dal primo torna al campo", () => {
    mount();
    panel.focus();
    expect(document.activeElement).toBe(search());
    key("ArrowDown", search());
    expect(document.activeElement).toBe(tiles()[0]);
    key("ArrowRight", tiles()[0]!);
    key("ArrowRight", tiles()[1]!);
    expect(document.activeElement).toBe(tiles()[2]);
    expect(tiles()[2]!.tabIndex).toBe(0);
    key("End", tiles()[2]!);
    expect(document.activeElement).toBe(tiles()[4]);
    key("ArrowRight", tiles()[4]!);
    expect(document.activeElement).toBe(tiles()[4]);
    key("Home", tiles()[4]!);
    expect(document.activeElement).toBe(tiles()[0]);
    key("ArrowUp", tiles()[0]!);
    expect(document.activeElement).toBe(search());
  });

  it("Invio e Spazio inseriscono; Esc da un riquadro torna al foglio", () => {
    mount();
    key("Enter", tiles()[0]!);
    key(" ", tiles()[3]!);
    key("Escape", tiles()[3]!);
    expect(calls).toEqual(["insert d:rvalvola0", "insert l:Symbols/Impianti.svg#rcaldaia0", "leave"]);
  });

  it("il tasto del menu e Maiusc+F10 aprono il menu sotto il riquadro; il clic destro che segue no", () => {
    mount();
    const valvola = tile(drawing("rvalvola0"));
    const menu = key("ContextMenu", valvola);
    expect(menu.defaultPrevented).toBe(true);
    pointer("contextmenu", valvola, { clientX: 5, clientY: 5 });
    key("F10", tile(drawing("rpompa000")), { shiftKey: true });
    expect(calls).toEqual(["menu d:rvalvola0 tile true", "menu d:rpompa000 tile true"]);
  });

  it("focusTile porta il fuoco al riquadro che si vede", () => {
    mount();
    expect(panel.focusTile(library("Symbols/Impianti.svg", "rcaldaia0"))).toBe(true);
    expect(document.activeElement).toBe(tile(library("Symbols/Impianti.svg", "rcaldaia0")));
    type("pompa");
    expect(panel.focusTile(library("Symbols/Impianti.svg", "rcaldaia0"))).toBe(false);
    expect(panel.focusTile(drawing("nessuno"))).toBe(false);
  });
});

describe("il puntatore", () => {
  it("il clic inserisce; il clic destro apre il menu nel punto", () => {
    mount();
    const caldaia = tile(library("Symbols/Impianti.svg", "rcaldaia0"));
    pointer("pointerdown", caldaia);
    pointer("pointerup", caldaia);
    pointer("click", caldaia);
    const menu = pointer("contextmenu", caldaia, { clientX: 10, clientY: 10 });
    expect(menu.defaultPrevented).toBe(true);
    expect(calls).toEqual(["insert l:Symbols/Impianti.svg#rcaldaia0", "menu l:Symbols/Impianti.svg#rcaldaia0 pointer true"]);
  });

  it("oltre la soglia il trascinamento passa all'editor, e il clic che segue non inserisce", () => {
    mount();
    const caldaia = tile(library("Symbols/Impianti.svg", "rcaldaia0"));
    pointer("pointerdown", caldaia, { clientX: 10, clientY: 10 });
    pointer("pointermove", caldaia, { clientX: 12, clientY: 11 });
    expect(calls).toEqual([]);
    pointer("pointermove", caldaia, { clientX: 30, clientY: 10 });
    pointer("pointerup", caldaia, { clientX: 30, clientY: 10 });
    pointer("click", caldaia);
    expect(calls).toEqual(["drag l:Symbols/Impianti.svg#rcaldaia0 30,10"]);
  });

  it("il dito che scorre in verticale non trascina: scorre il pannello", () => {
    mount();
    const caldaia = tile(library("Symbols/Impianti.svg", "rcaldaia0"));
    pointer("pointerdown", caldaia, { clientX: 10, clientY: 10, pointerType: "touch" });
    pointer("pointermove", caldaia, { clientX: 11, clientY: 40, pointerType: "touch" });
    expect(calls).toEqual([]);
  });
});

describe("la sola lettura", () => {
  it("i riquadri restano raggiungibili, non inseriscono né si trascinano, e dicono perché", () => {
    mount({ ...VIEW, editable: false });
    for (const each of tiles()) expect(each.getAttribute("aria-disabled")).toBe("true");
    const caldaia = tile(library("Symbols/Impianti.svg", "rcaldaia0"));
    pointer("click", caldaia);
    key("Enter", caldaia);
    pointer("pointerdown", caldaia, { clientX: 10, clientY: 10 });
    pointer("pointermove", caldaia, { clientX: 40, clientY: 10 });
    expect(calls).toEqual([]);
    expect(said()).toContain("sola lettura");
    expect(document.getElementById(search().getAttribute("aria-describedby")!)!.textContent).toBe("Il disegno è in sola lettura: i simboli si guardano, ma non si inseriscono.");
    // Il menu c'è comunque: i suoi comandi dicono da sé che cosa si può.
    key("ContextMenu", caldaia);
    expect(calls).toEqual(["menu l:Symbols/Impianti.svg#rcaldaia0 tile true"]);
    panel.update(VIEW);
    expect(caldaia.hasAttribute("aria-disabled")).toBe(false);
  });
});

describe("le lingue", () => {
  it("relabel() riscrive il pannello in inglese", () => {
    mount();
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(host.querySelector("h2")!.textContent).toBe("Symbols");
    expect(host.querySelector<HTMLLabelElement>(`label[for="${search().id}"]`)!.textContent).toBe("Search symbols");
    expect(names()[0]).toBe("Valvola, 3 instances, the library has a newer version");
    expect(names()[2]).toBe("Valvola, already in the drawing, in a different version");
    expect(count()).toBe("5 symbols");
  });
});
