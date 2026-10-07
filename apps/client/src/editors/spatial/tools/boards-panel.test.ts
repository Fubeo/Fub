// @vitest-environment happy-dom
// Le tavole come pannello, da solo: le righe col numero, il nome e la misura,
// la tavola di adesso detta non solo col colore, la tastiera dell'elenco e la
// sola lettura, il campo del nome, il menu della tavola, «Nuova tavola» col
// suo perché, il pannello vuoto, il fuoco che non si perde, le righe
// disegnate a pezzi e la lingua.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { createBoardsPanel, type BoardRow, type BoardsPanel, type BoardsView } from "./boards-panel";
import { ROW_PX } from "./objects";

const NAMES = ["Copertina", "Evaporazione", "Condensazione", "Precipitazione", "Raccolta"];

/// `count` tavole, `b1`, `b2`…: le prime coi nomi del ciclo dell'acqua, le
/// altre «Tavola N».
function boardsOf(count: number): BoardRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: `b${index + 1}`, name: NAMES[index] ?? `Tavola ${index + 1}`, size: "1600 × 1000 px" }));
}

interface State {
  boards: BoardRow[];
  current: string | null;
  editable: boolean;
  canAdd: boolean;
}

let host: HTMLElement;
let life: Lifetime;
let panel: BoardsPanel;
let state: State;
let calls: string[];
let added: number;

const view = (): BoardsView => ({ ...state, boards: [...state.boards] });

/// Il pannello su un disegno finto, che cambia come gli si chiede, come
/// farebbe l'editor.
function mount(more: Partial<State> = {}): BoardsPanel {
  state = { boards: boardsOf(5), current: "b1", editable: true, canAdd: true, ...more };
  panel = createBoardsPanel(life, {
    onGo: (id) => {
      calls.push(`go ${id}`);
      state.current = id;
      panel.update(view());
    },
    onAdd: () => {
      calls.push("add");
      added += 1;
      const board = { id: `n${added}`, name: `Tavola ${state.boards.length + 1}`, size: "1600 × 1000 px" };
      state.boards = [...state.boards, board];
      state.current = board.id;
      panel.update(view());
    },
    onRename: (id, name) => {
      calls.push(`rename ${id} ${name}`);
      state.boards = state.boards.map((board) => (board.id === id ? { ...board, name } : board));
      panel.update(view());
    },
    onDelete: (id) => {
      calls.push(`delete ${id}`);
      state.boards = state.boards.filter((board) => board.id !== id);
      if (state.current === id) state.current = null;
      panel.update(view());
    },
    onMove: (id, to) => {
      calls.push(`move ${id} ${to}`);
      const moved = state.boards.find((board) => board.id === id)!;
      const rest = state.boards.filter((board) => board.id !== id);
      state.boards = [...rest.slice(0, to), moved, ...rest.slice(to)];
      panel.update(view());
    },
    onLeave: () => calls.push("leave"),
  });
  host.append(panel.element);
  panel.update(view());
  return panel;
}

const list = (): HTMLElement => host.querySelector<HTMLElement>('[role="listbox"]')!;
const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="option"]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
const row = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[role="option"][data-key="${id}"]`)!;
const active = (): HTMLElement | null => document.getElementById(list().getAttribute("aria-activedescendant") ?? "");
const current = (): HTMLElement[] => rows().filter((each) => each.getAttribute("aria-current") === "true");
const textOf = (item: HTMLElement, part: string): string => item.querySelector(`.draw-board-${part}`)!.textContent!;
const field = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>(".draw-board-rename");
const addButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-boards-add")!;
const empty = (): HTMLElement => host.querySelector<HTMLElement>(".draw-boards-empty")!;
const scroller = (): HTMLElement => host.querySelector<HTMLElement>(".draw-boards-scroll")!;
const said = (): string => host.querySelector('[role="status"]')!.textContent!.trim();
const hint = (): string => document.getElementById(list().getAttribute("aria-describedby")!)!.textContent!;

function key(name: string, init: KeyboardEventInit = {}, target: Element = list()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function rightClick(target: Element): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 });
  target.dispatchEvent(event);
  return event;
}

/// Il menu aperto per ultimo: quello chiuso può restare un momento, mentre
/// esce.
const menu = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return open[open.length - 1]!;
};
/// Le sue voci, e una voce per nome.
const entries = (): HTMLButtonElement[] => [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const entry = (label: string): HTMLButtonElement => entries().find((one) => one.querySelector(".menu-label")!.textContent === label)!;
/// Una voce come la si legge: il nome, il perché se è spenta, il tasto, e se
/// è spenta.
const readOf = (one: HTMLButtonElement): (string | null)[] => [
  one.querySelector(".menu-label")!.textContent,
  one.querySelector(".menu-description")?.textContent ?? "",
  one.querySelector(".menu-hint")?.textContent ?? "",
  one.getAttribute("aria-disabled"),
];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  calls = [];
  added = 0;
});

afterEach(() => {
  // Un menu rimasto aperto va chiuso davvero: tolto e basta, terrebbe il
  // fuoco anche nella prova dopo.
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  life.close();
  host.remove();
  vi.restoreAllMocks();
});

describe("le righe", () => {
  it("hanno il numero, il nome e la misura, e il nome della riga dice tutto a parole", () => {
    mount();
    const heading = host.querySelector("h2")!;
    expect(heading.textContent).toBe("Tavole");
    expect(list().getAttribute("aria-labelledby")).toBe(heading.id);
    expect(panel.element.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("5 tavole");
    expect(addButton().textContent).toBe("Nuova tavola");
    expect(addButton().closest(".draw-boards-header")).not.toBeNull();
    expect(empty().hidden).toBe(true);
    expect(scroller().hidden).toBe(false);
    expect(rows().map((item) => [textOf(item, "number"), textOf(item, "name"), textOf(item, "size")])).toEqual([
      ["1", "Copertina", "1600 × 1000 px"],
      ["2", "Evaporazione", "1600 × 1000 px"],
      ["3", "Condensazione", "1600 × 1000 px"],
      ["4", "Precipitazione", "1600 × 1000 px"],
      ["5", "Raccolta", "1600 × 1000 px"],
    ]);
    expect(row("b2").getAttribute("aria-label")).toBe("Tavola 2 di 5: Evaporazione, 1600 × 1000 px");
    expect(rows().map((item) => [item.getAttribute("aria-posinset"), item.getAttribute("aria-setsize")])).toEqual([1, 2, 3, 4, 5].map((at) => [String(at), "5"]));
    expect(rows().map((item) => item.style.top)).toEqual([0, 1, 2, 3, 4].map((index) => `${index * ROW_PX}px`));
    // Il nome intero, quando la riga lo accorcia.
    expect(row("b3").querySelector<HTMLElement>(".draw-board-name")!.title).toBe("Condensazione");
    expect(hint()).toBe("Invio porta alla tavola; F2 la rinomina, Alt+↑ e Alt+↓ la spostano, Canc la elimina; Maiusc+F10 apre il suo menu.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("la tavola di adesso ha aria-current, il triangolo e il nome che lo dice, non solo il colore", () => {
    mount({ current: "b2" });
    expect(current()).toEqual([row("b2")]);
    expect(row("b2").getAttribute("aria-label")).toBe("Tavola 2 di 5: Evaporazione, 1600 × 1000 px, corrente");
    const glyph = row("b2").querySelector<HTMLElement>(".draw-board-glyph")!;
    expect(glyph.dataset.shape).toBe("draw-board-here");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.childElementCount).toBe(1);
    expect(rows().filter((item) => item.querySelector(".draw-board-glyph")!.childElementCount > 0)).toEqual([row("b2")]);
    // La scelta segue la riga attiva, che parte dalla tavola di adesso.
    expect(active()).toBe(row("b2"));
    expect(rows().map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false", "false"]);

    // Senza tavola di adesso, nessuna riga lo dice.
    state.current = null;
    panel.update(view());
    expect(current()).toEqual([]);
    expect(row("b2").querySelector(".draw-board-glyph")!.childElementCount).toBe(0);
    expect(row("b2").getAttribute("aria-label")).toBe("Tavola 2 di 5: Evaporazione, 1600 × 1000 px");
  });

  it("una tavola sola si conta al singolare", () => {
    mount({ boards: boardsOf(1) });
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("1 tavola");
    expect(row("b1").getAttribute("aria-label")).toBe("Tavola 1 di 1: Copertina, 1600 × 1000 px, corrente");
  });

  it("si disegnano a pezzi: mille tavole scorrono come dieci", () => {
    mount({ boards: boardsOf(1000), current: "b1000" });
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("1000 tavole");
    expect(list().style.height).toBe(`${1000 * ROW_PX}px`);
    expect(rows().length).toBeLessThan(60);
    // La tavola di adesso, in fondo, c'è anche se è lontana.
    expect(active()?.dataset.key).toBe("b1000");
    expect(active()?.getAttribute("aria-posinset")).toBe("1000");
    expect(active()?.getAttribute("aria-setsize")).toBe("1000");
    expect(active()?.style.top).toBe(`${999 * ROW_PX}px`);
    expect(active()?.getAttribute("aria-label")).toBe("Tavola 1000 di 1000: Tavola 1000, 1600 × 1000 px, corrente");
    panel.focus();
    key("Home");
    expect(active()?.dataset.key).toBe("b1");
    expect(rows().length).toBeLessThan(60);
    scroller().scrollTop = 500 * ROW_PX;
    scroller().dispatchEvent(new Event("scroll"));
    expect(rows().some((item) => item.dataset.key === "b501")).toBe(true);
    expect(rows().length).toBeLessThan(60);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("la tastiera", () => {
  it("le frecce muovono la riga attiva senza andarci; Invio o Spazio ci vanno", () => {
    mount();
    panel.focus();
    expect(document.activeElement).toBe(list());
    expect(active()?.dataset.key).toBe("b1");
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    key("ArrowDown");
    expect(active()?.dataset.key).toBe("b3");
    expect(calls).toEqual([]);
    expect(current()).toEqual([row("b1")]);
    key("Enter");
    expect(calls).toEqual(["go b3"]);
    expect(current()).toEqual([row("b3")]);
    expect(active()?.dataset.key).toBe("b3");
    key("End");
    expect(active()?.dataset.key).toBe("b5");
    key(" ");
    expect(calls).toEqual(["go b3", "go b5"]);
    key("Home");
    expect(active()?.dataset.key).toBe("b1");
    key("ArrowUp");
    expect(active()?.dataset.key).toBe("b1");
    key("PageDown");
    expect(active()?.dataset.key).toBe("b5");
    key("PageUp");
    expect(active()?.dataset.key).toBe("b1");
  });

  it("i tasti dell'elenco non arrivano all'editor; quelli con Ctrl sì, ed Esc torna al foglio", () => {
    mount();
    const outside: string[] = [];
    host.addEventListener("keydown", (event) => outside.push(event.key));
    panel.focus();
    for (const name of ["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", "Enter", " "]) expect(key(name).defaultPrevented).toBe(true);
    expect(key("ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
    expect(outside).toEqual([]);
    expect(key("z", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("ArrowLeft", { altKey: true }).defaultPrevented).toBe(false);
    expect(key("F10").defaultPrevented).toBe(false);
    expect(outside).toEqual(["z", "ArrowLeft", "F10"]);
    key("Escape");
    expect(calls).toEqual(["go b1", "go b1", "move b1 1", "leave"]);
  });

  it("Alt+↑ e Alt+↓ spostano la tavola fra le vicine; al bordo non c'è dove andare, e lo si dice", () => {
    mount();
    panel.focus();
    key("ArrowDown");
    key("ArrowDown", { altKey: true });
    expect(calls).toEqual(["move b2 2"]);
    expect(rows().map((item) => item.dataset.key)).toEqual(["b1", "b3", "b2", "b4", "b5"]);
    // La riga attiva resta sulla tavola, al suo posto nuovo, col numero nuovo.
    expect(active()?.dataset.key).toBe("b2");
    expect(textOf(row("b2"), "number")).toBe("3");
    expect(row("b2").getAttribute("aria-label")).toBe("Tavola 3 di 5: Evaporazione, 1600 × 1000 px");
    key("ArrowUp", { altKey: true });
    expect(calls).toEqual(["move b2 2", "move b2 1"]);
    key("Home");
    expect(key("ArrowUp", { altKey: true }).defaultPrevented).toBe(true);
    expect(said()).toBe("È già la prima tavola.");
    key("End");
    key("ArrowDown", { altKey: true });
    expect(said()).toBe("È già l’ultima tavola.");
    expect(calls).toEqual(["move b2 2", "move b2 1"]);
  });

  it("Canc e ⌫ eliminano la tavola, e la riga attiva passa alla più vicina", () => {
    mount();
    panel.focus();
    key("ArrowDown");
    key("ArrowDown");
    expect(key("Delete").defaultPrevented).toBe(true);
    expect(calls).toEqual(["delete b3"]);
    expect(active()?.dataset.key).toBe("b4");
    key("End");
    key("Backspace");
    expect(calls).toEqual(["delete b3", "delete b5"]);
    // L'ultima se n'è andata: la vicina è quella prima.
    expect(active()?.dataset.key).toBe("b4");
    expect(document.activeElement).toBe(list());
  });

  it("quando la tavola di adesso cambia da fuori la riga attiva la segue, e resta dove era se no", () => {
    mount();
    panel.focus();
    key("End");
    expect(active()?.dataset.key).toBe("b5");
    // Un nome cambiato da fuori non sposta la riga attiva.
    state.boards = state.boards.map((board) => (board.id === "b2" ? { ...board, name: "Vapore" } : board));
    panel.update(view());
    expect(active()?.dataset.key).toBe("b5");
    expect(textOf(row("b2"), "name")).toBe("Vapore");
    // La tavola di adesso cambiata, sì.
    state.current = "b3";
    panel.update(view());
    expect(active()?.dataset.key).toBe("b3");
    expect(current()).toEqual([row("b3")]);
  });
});

describe("il puntatore", () => {
  it("un clic va alla tavola; il secondo clic di un doppio clic no", () => {
    mount();
    row("b4").click();
    expect(calls).toEqual(["go b4"]);
    expect(document.activeElement).toBe(list());
    expect(active()?.dataset.key).toBe("b4");
    expect(current()).toEqual([row("b4")]);
    row("b2").querySelector(".draw-board-name")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    row("b2").querySelector(".draw-board-name")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    expect(calls).toEqual(["go b4", "go b2"]);
  });
});

describe("il campo del nome", () => {
  it("F2 apre il campo; Invio scrive il nome ripulito, Esc lo lascia, un nome vuoto o uguale non cambia niente, uscire lo scrive", () => {
    mount();
    panel.focus();
    key("ArrowDown");
    expect(key("F2").defaultPrevented).toBe(true);
    let input = field()!;
    expect(input.closest('[data-key="b2"]')!.hasAttribute("data-renaming")).toBe(true);
    expect(input.value).toBe("Evaporazione");
    expect(input.maxLength).toBe(200);
    expect(input.getAttribute("aria-label")).toBe("Nome della tavola «Evaporazione»");
    expect(document.activeElement).toBe(input);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // I tasti del campo sono suoi.
    key("ArrowDown", {}, input);
    key("Delete", {}, input);
    expect(active()?.dataset.key).toBe("b2");
    expect(calls).toEqual([]);
    input.value = "  Il vapore \n sale ";
    key("Enter", {}, input);
    expect(calls).toEqual(["rename b2 Il vapore sale"]);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(textOf(row("b2"), "name")).toBe("Il vapore sale");

    key("F2");
    field()!.value = "Altro";
    key("Escape", {}, field()!);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(list());

    // Un nome vuoto, o uguale, non cambia niente.
    key("F2");
    field()!.value = "   ";
    key("Enter", {}, field()!);
    key("F2");
    field()!.value = " Il vapore  sale";
    key("Enter", {}, field()!);
    expect(calls).toEqual(["rename b2 Il vapore sale"]);
    expect(calls).not.toContain("leave");

    // Un doppio clic sul nome lo apre; uscire dal campo lo scrive. Il
    // puntatore nel campo resta al campo.
    row("b4").querySelector(".draw-board-name")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    input = field()!;
    expect(input.value).toBe("Precipitazione");
    input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(rightClick(input).defaultPrevented).toBe(false);
    input.value = "Pioggia";
    input.blur();
    expect(calls).toEqual(["rename b2 Il vapore sale", "rename b4 Pioggia"]);
    expect(field()).toBeNull();
    // Un doppio clic sulla misura non apre niente.
    row("b4").querySelector(".draw-board-size")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(field()).toBeNull();
  });

  it("rename porta in vista la tavola e apre il campo; falso se non c'è", () => {
    mount({ boards: boardsOf(200), current: "b1" });
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 10 * ROW_PX });
    expect(panel.rename("b999")).toBe(false);
    expect(panel.rename("b150")).toBe(true);
    expect(field()!.value).toBe("Tavola 150");
    expect(field()!.closest('[data-key="b150"]')).not.toBeNull();
    expect(scroller().scrollTop).toBe(150 * ROW_PX - 10 * ROW_PX);
    expect(active()?.dataset.key).toBe("b150");
  });

  it("la riga col campo del nome non si sposta mentre l'elenco scorre", () => {
    mount({ boards: boardsOf(200) });
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 10 * ROW_PX });
    scroller().scrollTop = 0;
    scroller().dispatchEvent(new Event("scroll"));
    panel.rename("b6");
    const item = row("b6");
    const placed = vi.spyOn(list(), "insertBefore");
    for (const top of [100, 0, 28, 0, 30, 3]) {
      scroller().scrollTop = top * ROW_PX;
      scroller().dispatchEvent(new Event("scroll"));
    }
    expect(placed.mock.calls.length).toBeGreaterThan(0);
    expect(placed.mock.calls.map(([node]) => node)).not.toContain(item);
    expect(field()!.closest('[data-key="b6"]')).toBe(item);
    const shown = [...list().children].filter((child) => child !== item).map((child) => Number((child as HTMLElement).dataset.index));
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });

  it("un aggiornamento col campo aperto lo lascia com'è, finché la sua tavola c'è e il disegno si cambia", () => {
    mount();
    panel.rename("b2");
    const item = row("b2");
    field()!.value = "Vapo";
    // Un'altra tavola cambia nome, e una se ne aggiunge: il campo resta, col
    // suo testo e il fuoco.
    state.boards = [...state.boards.map((board) => (board.id === "b4" ? { ...board, name: "Pioggia" } : board)), { id: "b6", name: "Mare", size: "800 × 600 px" }];
    panel.update(view());
    expect(field()!.closest('[data-key="b2"]')).toBe(item);
    expect(field()!.value).toBe("Vapo");
    expect(document.activeElement).toBe(field());
    expect(textOf(row("b4"), "name")).toBe("Pioggia");
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("6 tavole");
    // La tavola di adesso cambiata da fuori non porta via la riga attiva dal
    // campo.
    state.current = "b5";
    panel.update(view());
    expect(active()?.dataset.key).toBe("b2");
    expect(document.activeElement).toBe(field());
    key("Enter", {}, field()!);
    expect(calls).toEqual(["rename b2 Vapo"]);
  });

  it("il campo di una tavola che se ne va, o di un disegno che non si cambia più, si chiude senza scrivere", () => {
    mount();
    panel.rename("b2");
    field()!.value = "Vapore";
    state.boards = state.boards.filter((board) => board.id !== "b2");
    panel.update(view());
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(active()?.dataset.key).toBe("b3");

    panel.rename("b3");
    field()!.value = "Nuvole";
    state.editable = false;
    panel.update(view());
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(calls).toEqual([]);
  });
});

describe("il menu della tavola", () => {
  it("il clic destro apre il menu della tavola, col suo nome; le voci che non si usano sono spente", () => {
    mount();
    expect(rightClick(row("b3")).defaultPrevented).toBe(true);
    expect(menu().getAttribute("aria-labelledby")).toBe(row("b3").id);
    expect(active()?.dataset.key).toBe("b3");
    expect(entries().map(readOf)).toEqual([
      ["Vai", "", "Enter", null],
      ["Rinomina…", "", "F2", null],
      ["Sposta su", "", "Alt+↑", null],
      ["Sposta giù", "", "Alt+↓", null],
      ["Elimina", "", "Delete", null],
    ]);
    expect(menu().querySelectorAll('[role="separator"]').length).toBe(2);
    expect(entry("Elimina").classList.contains("danger")).toBe(true);
    entry("Sposta giù").click();
    expect(calls).toEqual(["move b3 3"]);
    expect(rows().map((item) => item.dataset.key)).toEqual(["b1", "b2", "b4", "b3", "b5"]);

    // Al bordo, la voce spenta dice perché.
    rightClick(row("b1").querySelector(".draw-board-size")!);
    expect(readOf(entry("Sposta su"))).toEqual(["Sposta su", "È già la prima tavola.", "Alt+↑", "true"]);
    expect(entry("Sposta giù").getAttribute("aria-disabled")).toBeNull();
    entry("Vai").click();
    expect(calls).toEqual(["move b3 3", "go b1"]);

    rightClick(row("b5"));
    expect(readOf(entry("Sposta giù"))).toEqual(["Sposta giù", "È già l’ultima tavola.", "Alt+↓", "true"]);
    entry("Rinomina…").click();
    expect(field()!.value).toBe("Raccolta");
    expect(document.activeElement).toBe(field());
    key("Escape", {}, field()!);

    rightClick(row("b2"));
    entry("Elimina").click();
    expect(calls).toEqual(["move b3 3", "go b1", "delete b2"]);
  });

  it("Maiusc+F10 e il tasto del menu lo aprono per la riga attiva, una volta sola", () => {
    mount();
    panel.focus();
    key("End");
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(menu().getAttribute("aria-labelledby")).toBe(row("b5").id);
    expect(entry("Sposta giù").getAttribute("aria-disabled")).toBe("true");
    closeContextMenu();
    expect(document.activeElement).toBe(list());
    key("Home");
    expect(key("ContextMenu").defaultPrevented).toBe(true);
    expect(menu().getAttribute("aria-labelledby")).toBe(row("b1").id);
    // Il clic destro che il tasto manda dietro non apre un altro menu.
    const menus = document.querySelectorAll(".context-menu").length;
    expect(rightClick(list()).defaultPrevented).toBe(true);
    expect(document.querySelectorAll(".context-menu").length).toBe(menus);
    closeContextMenu();
    // Più tardi, il menu che arriva sull'elenco stesso è quello della riga
    // attiva.
    rightClick(list());
    expect(menu().getAttribute("aria-labelledby")).toBe(row("b1").id);
  });

  it("si chiude se la sua tavola se ne va, e il fuoco torna all'elenco", () => {
    mount();
    rightClick(row("b2"));
    expect(menu().getAttribute("aria-labelledby")).toBe(row("b2").id);
    expect(menu().contains(document.activeElement)).toBe(true);
    state.boards = state.boards.filter((board) => board.id !== "b2");
    panel.update(view());
    expect(document.querySelector(".context-menu[aria-labelledby]")).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(active()?.dataset.key).toBe("b3");
  });
});

describe("Nuova tavola", () => {
  it("aggiunge una tavola, e il puntatore non le toglie il fuoco", () => {
    mount();
    panel.focus();
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    addButton().dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    addButton().click();
    expect(calls).toEqual(["add"]);
    expect(document.activeElement).toBe(list());
    // La tavola nuova è quella di adesso, e la riga attiva la segue.
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("6 tavole");
    expect(active()?.dataset.key).toBe("n1");
    expect(current()).toEqual([row("n1")]);
  });

  it("al limite resta raggiungibile, spenta, e dice perché non aggiunge", () => {
    mount({ canAdd: false });
    const button = addButton();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.title).toBe("Il disegno ha già 1000 tavole: è il massimo.");
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    expect(calls).toEqual([]);
    expect(said()).toBe("Il disegno ha già 1000 tavole: è il massimo.");
    expect(formatIssues(checkAccessibility(host))).toBe("");

    state.canAdd = true;
    panel.update(view());
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.hasAttribute("title")).toBe(false);
    button.click();
    expect(calls).toEqual(["add"]);
  });

  it("Esc sul pulsante torna al foglio", () => {
    mount();
    addButton().focus();
    expect(key("Escape", {}, addButton()).defaultPrevented).toBe(true);
    expect(calls).toEqual(["leave"]);
  });
});

describe("il pannello vuoto", () => {
  it("dice che il disegno è una pagina sola e che cosa fa «Nuova tavola», che lo spiega", () => {
    mount({ boards: [], current: null });
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("0 tavole");
    expect(empty().hidden).toBe(false);
    expect(empty().textContent).toBe("Il disegno è una pagina sola. Con «Nuova tavola» la pagina diventa la tavola 1, e accanto ne nasce un’altra.");
    expect(scroller().hidden).toBe(true);
    expect(rows()).toEqual([]);
    expect(addButton().getAttribute("aria-describedby")).toBe(empty().id);
    panel.focus();
    expect(document.activeElement).toBe(addButton());
    expect(formatIssues(checkAccessibility(host))).toBe("");
    addButton().click();
    expect(calls).toEqual(["add"]);
    expect(empty().hidden).toBe(true);
    expect(scroller().hidden).toBe(false);
    expect(addButton().hasAttribute("aria-describedby")).toBe(false);
  });

  it("l'ultima tavola eliminata lascia il fuoco nel pannello, a «Nuova tavola»", () => {
    mount({ boards: boardsOf(1) });
    panel.focus();
    key("Delete");
    expect(calls).toEqual(["delete b1"]);
    expect(scroller().hidden).toBe(true);
    expect(document.activeElement).toBe(addButton());
    // Le tavole che tornano, per esempio annullando, non gli tolgono il fuoco:
    // resta al pulsante, e la riga attiva è pronta.
    state.boards = boardsOf(1);
    state.current = "b1";
    panel.update(view());
    expect(document.activeElement).toBe(addButton());
    expect(active()?.dataset.key).toBe("b1");
  });

  it("in sola lettura dice soltanto che non ci sono tavole, e il fuoco va alla spiegazione", () => {
    mount({ boards: [], current: null, editable: false });
    expect(empty().textContent).toBe("Il disegno non ha tavole.");
    expect(addButton().disabled).toBe(true);
    panel.focus();
    expect(document.activeElement).toBe(empty());
    key("Escape", {}, empty());
    expect(calls).toEqual(["leave"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("la sola lettura", () => {
  it("le tavole si guardano e ci si va: gli altri tasti non fanno niente, e dicono perché", () => {
    mount({ editable: false });
    expect(addButton().disabled).toBe(true);
    expect(list().hasAttribute("aria-disabled")).toBe(false);
    expect(hint()).toBe("Invio porta alla tavola; Maiusc+F10 apre il suo menu.");
    panel.focus();
    key("ArrowDown");
    expect(active()?.dataset.key).toBe("b2");
    key("Enter");
    expect(calls).toEqual(["go b2"]);
    for (const [name, init] of [["F2", {}], ["Delete", {}], ["Backspace", {}], ["ArrowDown", { altKey: true }], ["ArrowUp", { altKey: true }]] as const) {
      expect(key(name, init).defaultPrevented).toBe(true);
      expect(said()).toBe("Modifica non applicata: il disegno è in sola lettura.");
    }
    row("b3").querySelector(".draw-board-name")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(field()).toBeNull();
    expect(panel.rename("b3")).toBe(false);
    expect(calls).toEqual(["go b2"]);
    expect(active()?.dataset.key).toBe("b2");
    // Il menu si apre, e ci si va soltanto: le voci spente non dicono il
    // bordo, perché non è il bordo a fermarle.
    rightClick(row("b5"));
    expect(entries().map((one) => one.getAttribute("aria-disabled"))).toEqual([null, "true", "true", "true", "true"]);
    expect(menu().querySelector(".menu-description")).toBeNull();
    entry("Vai").click();
    expect(calls).toEqual(["go b2", "go b5"]);
    row("b1").click();
    expect(calls).toEqual(["go b2", "go b5", "go b1"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");

    state.editable = true;
    panel.update(view());
    expect(addButton().disabled).toBe(false);
    expect(hint()).toBe("Invio porta alla tavola; F2 la rinomina, Alt+↑ e Alt+↓ la spostano, Canc la elimina; Maiusc+F10 apre il suo menu.");
  });
});

describe("la lingua", () => {
  it("relabel riscrive tutto in inglese, coi numeri come li scrive l'inglese", () => {
    mount({ boards: boardsOf(1000), current: "b2", canAdd: false });
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(host.querySelector("h2")!.textContent).toBe("Boards");
    expect(host.querySelector(".draw-boards-count")!.textContent).toBe("1,000 boards");
    expect(addButton().textContent).toBe("New board");
    expect(addButton().title).toBe("The drawing already has 1,000 boards, the most it can have.");
    expect(row("b1").getAttribute("aria-label")).toBe("Board 1 of 1,000: Copertina, 1600 × 1000 px");
    expect(row("b2").getAttribute("aria-label")).toBe("Board 2 of 1,000: Evaporazione, 1600 × 1000 px, current");
    expect(hint()).toBe("Enter goes to the board; F2 renames it, Alt+↑ and Alt+↓ move it, Delete removes it; Shift+F10 opens its menu.");
    panel.rename("b3");
    expect(field()!.getAttribute("aria-label")).toBe("Name of the board “Condensazione”");
    key("Escape", {}, field()!);
    rightClick(row("b3"));
    expect(entries().map((one) => one.querySelector(".menu-label")!.textContent)).toEqual(["Go to board", "Rename…", "Move up", "Move down", "Delete"]);
    closeContextMenu();
    panel.focus();
    key("Home");
    key("ArrowUp", { altKey: true });
    expect(said()).toBe("It’s already the first board.");

    state.boards = [];
    panel.update(view());
    expect(empty().textContent).toBe("The drawing is a single page. With “New board” the page becomes board 1, and another one appears next to it.");
  });
});
