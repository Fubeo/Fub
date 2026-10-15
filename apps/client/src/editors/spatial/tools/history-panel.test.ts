// @vitest-environment happy-dom
// La cronologia come pannello, da sola: le righe dal passo più vecchio, la
// riga di adesso e quelle da ripetere dette non solo col colore, la tastiera
// dell'elenco, il clic e lo scorrimento col puntatore, i segni coi loro nomi,
// la sola lettura e le righe disegnate a pezzi.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { Undo } from "../scene/engine";
import type { DrawKey } from "../strings";
import type { Mark, Step } from "./history";
import { createHistoryPanel, type HistoryPanel, type HistoryView } from "./history-panel";
import { ROW_PX } from "./objects";

const LABELS: readonly DrawKey[] = ["draw.action.stroke", "draw.action.move", "draw.action.fill", "draw.action.delete"];

/// `count` passi coi numeri da `from`: Tratto, Spostamento, Riempimento,
/// Eliminazione, e di nuovo.
function stepsOf(count: number, from = 1): Step[] {
  return Array.from({ length: count }, (_, index) => ({ serial: from + index, label: LABELS[index % LABELS.length]!, undo: {} as Undo, at: -Infinity }));
}

interface State {
  steps: Step[];
  done: number;
  start: number;
  trimmed: boolean;
  marks: Mark[];
  editable: boolean;
}

let host: HTMLElement;
let life: Lifetime;
let panel: HistoryPanel;
let state: State;
let calls: string[];

const view = (): HistoryView => ({ ...state, limit: 1000 });

/// Il pannello su una cronologia finta, che va dove le si chiede come farebbe
/// l'editor.
function mount(more: Partial<State> = {}): HistoryPanel {
  state = { steps: stepsOf(4), done: 4, start: 0, trimmed: false, marks: [], editable: true, ...more };
  panel = createHistoryPanel(life, {
    onGo: (at, mark) => {
      calls.push(`go ${at}${mark === null ? "" : ` ${mark.name}`}`);
      state.done = at === state.start ? 0 : state.steps.findIndex((step) => step.serial === at) + 1;
      panel.update(view());
    },
    onMark: () => calls.push("mark"),
    onRename: (id, name) => {
      calls.push(`rename ${id} ${name}`);
      state.marks = state.marks.map((mark) => (mark.id === id ? { ...mark, name } : mark));
      panel.update(view());
    },
    onUnmark: (id) => {
      calls.push(`unmark ${id}`);
      state.marks = state.marks.filter((mark) => mark.id !== id);
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
const row = (key: string): HTMLElement => host.querySelector<HTMLElement>(`[role="option"][data-key="${key}"]`)!;
const active = (): HTMLElement | null => document.getElementById(list().getAttribute("aria-activedescendant") ?? "");
const current = (): HTMLElement[] => rows().filter((each) => each.getAttribute("aria-current") === "step");
const labelOf = (item: HTMLElement): string => item.querySelector(".draw-history-label")!.textContent!;
const said = (item: HTMLElement): string => item.querySelector(".sr-only")!.textContent!;
const field = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>(".draw-history-rename");

function key(name: string, init: KeyboardEventInit = {}, target: Element = list()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function pointer(type: string, target: Element, y: number, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 40, clientY: y, ...init });
  target.dispatchEvent(event);
  return event;
}

/// L'elenco comincia in cima allo schermo, e ogni riga è alta `ROW_PX`.
function placeList(): void {
  vi.spyOn(list(), "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 240, height: 0, right: 240, bottom: 0, toJSON: () => ({}) } as DOMRect);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  calls = [];
});

afterEach(() => {
  life.close();
  host.remove();
  vi.restoreAllMocks();
});

describe("le righe", () => {
  it("vanno dal disegno aperto al passo più nuovo, e dicono dove si è e cosa si ripete non solo col colore", () => {
    mount({ done: 2 });
    expect(list().getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
    expect(host.querySelector("h2")!.textContent).toBe("Cronologia");
    expect(host.querySelector(".draw-history-count")!.textContent).toBe("4 passi");
    expect(host.querySelector<HTMLElement>(".draw-history-empty")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".draw-history-note")!.hidden).toBe(true);
    expect(rows().map((item) => [labelOf(item), said(item), item.getAttribute("aria-posinset"), item.getAttribute("aria-setsize")])).toEqual([
      ["Disegno aperto", "", "1", "5"],
      ["Tratto", "", "2", "5"],
      ["Spostamento", "", "3", "5"],
      ["Riempimento", ", da ripetere", "4", "5"],
      ["Eliminazione", ", da ripetere", "5", "5"],
    ]);
    // La riga di adesso: `aria-current`, il triangolo e la parola «adesso»,
    // che sono per gli occhi.
    expect(current().map((item) => item.dataset.key)).toEqual(["p2"]);
    const here = row("p2");
    expect(here.querySelector<HTMLElement>(".draw-history-now")!.hidden).toBe(false);
    expect(here.querySelector(".draw-history-now")!.textContent).toBe("adesso");
    expect(here.querySelector<HTMLElement>(".draw-history-glyph")!.dataset.shape).toBe("draw-here");
    for (const part of [".draw-history-glyph", ".draw-history-now", ".draw-history-remove"]) expect(here.querySelector(part)!.getAttribute("aria-hidden")).toBe("true");
    expect(rows().filter((item) => !item.querySelector<HTMLElement>(".draw-history-now")!.hidden)).toEqual([here]);
    expect(rows().map((item) => item.hasAttribute("data-ahead"))).toEqual([false, false, false, true, true]);
    // La scelta segue la riga attiva, che parte da quella di adesso.
    expect(active()).toBe(here);
    expect(rows().map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(rows().map((item) => item.style.top)).toEqual([0, 1, 2, 3, 4].map((index) => `${index * ROW_PX}px`));
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("dicono quando non c'è ancora niente, e quando i passi più vecchi sono dimenticati", () => {
    mount({ steps: [], done: 0 });
    expect(host.querySelector(".draw-history-count")!.textContent).toBe("0 passi");
    expect(host.querySelector<HTMLElement>(".draw-history-empty")!.hidden).toBe(false);
    expect(host.querySelector(".draw-history-empty")!.textContent).toBe("Ogni cosa che fai sul disegno diventa qui un passo, e ci si torna con un clic.");
    expect(rows().map(labelOf)).toEqual(["Disegno aperto"]);
    expect(current()).toEqual([row("p0")]);

    state = { ...state, steps: stepsOf(3, 8), done: 3, start: 7, trimmed: true };
    panel.update(view());
    expect(host.querySelector(".draw-history-count")!.textContent).toBe("3 passi");
    expect(host.querySelector<HTMLElement>(".draw-history-empty")!.hidden).toBe(true);
    expect(rows().map(labelOf)).toEqual(["Inizio della cronologia", "Tratto", "Spostamento", "Riempimento"]);
    const note = host.querySelector<HTMLElement>(".draw-history-note")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("La cronologia ricorda gli ultimi 1000 passi: i più vecchi non si raggiungono più.");
    expect(current()).toEqual([row("p10")]);
  });

  it("si disegnano a pezzi: mille passi scorrono come dieci", () => {
    mount({ steps: stepsOf(1000), done: 1000 });
    expect(list().style.height).toBe(`${1001 * ROW_PX}px`);
    expect(rows().length).toBeLessThan(60);
    // La riga di adesso, in fondo, c'è anche se è lontana.
    expect(active()?.dataset.key).toBe("p1000");
    expect(active()?.getAttribute("aria-posinset")).toBe("1001");
    expect(active()?.getAttribute("aria-setsize")).toBe("1001");
    expect(active()?.style.top).toBe(`${1000 * ROW_PX}px`);
    panel.focus();
    key("Home");
    expect(active()?.dataset.key).toBe("p0");
    expect(rows().length).toBeLessThan(60);
    const scroller = host.querySelector<HTMLElement>(".draw-history-scroll")!;
    scroller.scrollTop = 500 * ROW_PX;
    scroller.dispatchEvent(new Event("scroll"));
    expect(rows().some((item) => item.dataset.key === "p500")).toBe(true);
    expect(rows().length).toBeLessThan(60);
  });
});

describe("la tastiera", () => {
  it("le frecce muovono la riga attiva senza andarci; Invio o Spazio ci vanno", () => {
    mount();
    panel.focus();
    expect(document.activeElement).toBe(list());
    expect(active()?.dataset.key).toBe("p4");
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    key("ArrowUp");
    expect(active()?.dataset.key).toBe("p2");
    expect(calls).toEqual([]);
    expect(current()).toEqual([row("p4")]);
    key("Enter");
    expect(calls).toEqual(["go 2"]);
    expect(current()).toEqual([row("p2")]);
    expect(active()?.dataset.key).toBe("p2");
    key("Home");
    key(" ");
    expect(calls).toEqual(["go 2", "go 0"]);
    expect(rows().filter((item) => item.hasAttribute("data-ahead")).length).toBe(4);
    key("End");
    key("Enter");
    expect(calls).toEqual(["go 2", "go 0", "go 4"]);
    // Dove si è già non c'è niente da fare.
    key("Enter");
    row("p4").click();
    expect(calls).toEqual(["go 2", "go 0", "go 4"]);
    key("PageUp");
    expect(active()?.dataset.key).toBe("p0");
    key("PageDown");
    expect(active()?.dataset.key).toBe("p4");
  });

  it("i tasti dell'elenco non arrivano all'editor; quelli con Ctrl sì, ed Esc torna al foglio", () => {
    mount();
    const outside: string[] = [];
    host.addEventListener("keydown", (event) => outside.push(event.key));
    panel.focus();
    for (const name of ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Enter", " ", "F2", "Delete", "Backspace"]) expect(key(name).defaultPrevented).toBe(true);
    expect(outside).toEqual([]);
    expect(key("z", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("ArrowUp", { altKey: true }).defaultPrevented).toBe(false);
    expect(outside).toEqual(["z", "ArrowUp"]);
    key("Escape");
    expect(calls).toEqual(["leave"]);
  });

  it("quando ci si muove da fuori la riga attiva torna su quella di adesso, e resta dove era se no", () => {
    mount();
    panel.focus();
    key("Home");
    expect(active()?.dataset.key).toBe("p0");
    // Un segno nuovo non sposta il punto: la riga attiva resta.
    state.marks = [{ id: 1, name: "Bozza", at: 4 }];
    panel.update(view());
    expect(active()?.dataset.key).toBe("p0");
    // Un annulla, da fuori, sì.
    state.done = 3;
    panel.update(view());
    expect(active()?.dataset.key).toBe("p3");
    expect(current()).toEqual([row("p3")]);
  });
});

describe("il puntatore", () => {
  it("col mouse, premuto e trascinato, il disegno segue la riga sotto il puntatore", () => {
    mount();
    placeList();
    const down = pointer("pointerdown", row("p1"), ROW_PX + 5);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(list());
    expect(calls).toEqual(["go 1"]);
    pointer("pointermove", list(), ROW_PX + 20);
    expect(calls).toEqual(["go 1"]);
    pointer("pointermove", list(), 3 * ROW_PX + 5);
    expect(calls).toEqual(["go 1", "go 3"]);
    // Sopra l'elenco si ferma alla prima riga, sotto all'ultima.
    pointer("pointermove", list(), -50);
    pointer("pointermove", list(), 50 * ROW_PX);
    expect(calls).toEqual(["go 1", "go 3", "go 0", "go 4"]);
    pointer("pointerup", list(), 50 * ROW_PX, { buttons: 0 });
    // Il clic che segue il rilascio non ci va di nuovo.
    row("p4").click();
    pointer("pointermove", list(), ROW_PX + 5, { buttons: 0 });
    expect(calls).toEqual(["go 1", "go 3", "go 0", "go 4"]);
    expect(current()).toEqual([row("p4")]);
  });

  it("oltre il bordo dell'elenco lo fa scorrere, e il disegno segue", () => {
    mount({ steps: stepsOf(100), done: 100 });
    const scroller = host.querySelector<HTMLElement>(".draw-history-scroll")!;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 10 * ROW_PX });
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    // L'elenco scorso in cima comincia in cima allo schermo.
    vi.spyOn(list(), "getBoundingClientRect").mockImplementation(
      () => ({ x: 0, y: -scroller.scrollTop, left: 0, top: -scroller.scrollTop, width: 240, height: 0, right: 240, bottom: 0, toJSON: () => ({}) }) as DOMRect,
    );
    pointer("pointerdown", row("p5"), 5 * ROW_PX + 5);
    // Due righe sotto il bordo: la riga 11 viene in vista.
    pointer("pointermove", list(), 11 * ROW_PX + 5);
    expect(calls).toEqual(["go 5", "go 11"]);
    expect(scroller.scrollTop).toBe(2 * ROW_PX);
    // Lo stesso punto dello schermo, adesso, è due righe più in là.
    pointer("pointermove", list(), 11 * ROW_PX + 5);
    expect(calls).toEqual(["go 5", "go 11", "go 13"]);
    expect(scroller.scrollTop).toBe(4 * ROW_PX);
  });

  it("uno scorrimento senza il rilascio finisce al primo passaggio senza tasti", () => {
    mount();
    placeList();
    pointer("pointerdown", row("p1"), ROW_PX + 5);
    pointer("pointermove", list(), 2 * ROW_PX + 5, { buttons: 0 });
    pointer("pointermove", list(), 3 * ROW_PX + 5);
    expect(calls).toEqual(["go 1"]);
  });

  it("il dito scorre l'elenco, e un tocco porta alla riga", () => {
    mount();
    placeList();
    const down = pointer("pointerdown", row("p1"), ROW_PX + 5, { pointerType: "touch" });
    expect(down.defaultPrevented).toBe(false);
    pointer("pointermove", list(), 3 * ROW_PX + 5, { pointerType: "touch" });
    expect(calls).toEqual([]);
    row("p1").click();
    expect(calls).toEqual(["go 1"]);
    expect(document.activeElement).toBe(list());
  });
});

describe("i segni", () => {
  const MARKS: Mark[] = [
    { id: 2, name: "Vuoto", at: 0 },
    { id: 1, name: "Bozza", at: 2 },
  ];

  it("stanno sotto il passo dopo cui sono stati messi, con la bandierina e il nome che dice che sono segni", () => {
    mount({ marks: MARKS, done: 1 });
    expect(rows().map((item) => [item.dataset.key, labelOf(item), said(item)])).toEqual([
      ["p0", "Disegno aperto", ""],
      ["m2", "Vuoto", ", segno"],
      ["p1", "Tratto", ""],
      ["p2", "Spostamento", ", da ripetere"],
      ["m1", "Bozza", ", segno, da ripetere"],
      ["p3", "Riempimento", ", da ripetere"],
      ["p4", "Eliminazione", ", da ripetere"],
    ]);
    expect(row("m1").querySelector<HTMLElement>(".draw-history-glyph")!.dataset.shape).toBe("draw-mark");
    expect(row("m1").dataset.kind).toBe("mark");
    expect(row("m1").querySelector<HTMLElement>(".draw-history-remove")!.hidden).toBe(false);
    expect(row("m1").querySelector<HTMLElement>(".draw-history-remove")!.title).toBe("Togli il segno");
    expect(row("p2").querySelector<HTMLElement>(".draw-history-remove")!.hidden).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("ci si va dal segno, che resta la riga attiva", () => {
    mount({ marks: MARKS });
    panel.focus();
    key("ArrowUp");
    key("ArrowUp");
    expect(active()?.dataset.key).toBe("m1");
    key("Enter");
    expect(calls).toEqual(["go 2 Bozza"]);
    expect(current()).toEqual([row("p2")]);
    expect(active()?.dataset.key).toBe("m1");
    row("m2").click();
    expect(calls).toEqual(["go 2 Bozza", "go 0 Vuoto"]);
    expect(active()?.dataset.key).toBe("m2");
  });

  it("«Segna questo punto» lo chiede a chi tiene la cronologia", () => {
    mount();
    const button = host.querySelector<HTMLButtonElement>(".draw-history-action")!;
    // La parola che si vede comincia il nome intero.
    expect(button.textContent).toBe("Segna");
    expect(button.getAttribute("aria-label")).toBe("Segna questo punto");
    expect(button.closest(".draw-history-header")).not.toBeNull();
    button.click();
    expect(calls).toEqual(["mark"]);
  });

  it("F2 apre il campo del nome; Invio scrive il nome ripulito, Esc lo lascia, uscire lo scrive", () => {
    mount({ marks: MARKS });
    panel.focus();
    key("ArrowUp");
    key("ArrowUp");
    expect(key("F2").defaultPrevented).toBe(true);
    let input = field()!;
    expect(input.closest('[data-key="m1"]')!.hasAttribute("data-renaming")).toBe(true);
    expect(input.value).toBe("Bozza");
    expect(input.maxLength).toBe(200);
    expect(input.getAttribute("aria-label")).toBe("Nome del segno «Bozza»");
    expect(document.activeElement).toBe(input);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // I tasti del campo sono suoi.
    key("ArrowUp", {}, input);
    expect(active()?.dataset.key).toBe("m1");
    input.value = "  Prima \n bozza ";
    key("Enter", {}, input);
    expect(calls).toEqual(["rename 1 Prima bozza"]);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(labelOf(row("m1"))).toBe("Prima bozza");

    key("F2");
    field()!.value = "Altro";
    key("Escape", {}, field()!);
    expect(field()).toBeNull();
    expect(calls).toEqual(["rename 1 Prima bozza"]);

    // Un nome vuoto, o uguale, non cambia niente.
    key("F2");
    field()!.value = "   ";
    key("Enter", {}, field()!);
    expect(calls).toEqual(["rename 1 Prima bozza"]);

    // Un doppio clic sul nome lo apre; uscire dal campo lo scrive.
    row("m2").querySelector(".draw-history-label")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    input = field()!;
    expect(input.value).toBe("Vuoto");
    input.value = "Foglio bianco";
    input.blur();
    expect(calls).toEqual(["rename 1 Prima bozza", "rename 2 Foglio bianco"]);
    expect(field()).toBeNull();
  });

  it("F2 su un passo, che non è un segno, non apre niente", () => {
    mount({ marks: MARKS });
    panel.focus();
    expect(key("F2").defaultPrevented).toBe(true);
    expect(field()).toBeNull();
    expect(panel.rename(9)).toBe(false);
    expect(panel.rename(1)).toBe(true);
    expect(field()!.value).toBe("Bozza");
  });

  it("la riga col campo del nome non si sposta mentre l'elenco scorre", () => {
    mount({ steps: stepsOf(200), done: 200, marks: [{ id: 1, name: "Bozza", at: 5 }] });
    const scroller = host.querySelector<HTMLElement>(".draw-history-scroll")!;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 10 * ROW_PX });
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    panel.rename(1);
    const item = row("m1");
    const placed = vi.spyOn(list(), "insertBefore");
    // Fuori dalla finestra la riga va in fondo; tornando, le righe rimaste le
    // stanno dopo, e sono loro a spostarsi.
    for (const top of [100, 0, 28, 0, 30, 3]) {
      scroller.scrollTop = top * ROW_PX;
      scroller.dispatchEvent(new Event("scroll"));
    }
    expect(placed.mock.calls.length).toBeGreaterThan(0);
    expect(placed.mock.calls.map(([node]) => node)).not.toContain(item);
    expect(field()!.closest('[data-key="m1"]')).toBe(item);
    // E le righe che si vedono sono in ordine.
    const shown = [...list().children].filter((child) => child !== item).map((child) => Number((child as HTMLElement).dataset.index));
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });

  it("un segno che se ne va da fuori chiude il suo campo, e il fuoco torna all'elenco", () => {
    mount({ marks: MARKS });
    panel.rename(1);
    expect(document.activeElement).toBe(field());
    state.marks = [MARKS[0]!];
    panel.update(view());
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(list());
    expect(calls).toEqual([]);
  });

  it("Canc, o la croce, lo tolgono; su un passo Canc non toglie niente", () => {
    mount({ marks: MARKS });
    panel.focus();
    expect(key("Delete").defaultPrevented).toBe(true);
    expect(calls).toEqual([]);
    key("ArrowUp");
    key("ArrowUp");
    key("Delete");
    expect(calls).toEqual(["unmark 1"]);
    // La riga attiva, che non c'è più, torna su quella di adesso.
    expect(active()?.dataset.key).toBe("p4");
    placeList();
    const cross = row("m2").querySelector(".draw-history-remove")!;
    pointer("pointerdown", cross, ROW_PX + 5);
    cross.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual(["unmark 1", "unmark 2"]);
    expect(rows().some((item) => item.dataset.kind === "mark")).toBe(false);
  });
});

describe("la sola lettura", () => {
  it("la cronologia si guarda soltanto: le frecce muovono la riga attiva, e nient'altro", () => {
    mount({ marks: [{ id: 1, name: "Bozza", at: 2 }], editable: false });
    expect(list().getAttribute("aria-disabled")).toBe("true");
    expect(host.querySelector<HTMLButtonElement>(".draw-history-action")!.disabled).toBe(true);
    expect(row("m1").querySelector<HTMLElement>(".draw-history-remove")!.hidden).toBe(true);
    panel.focus();
    key("ArrowUp");
    key("ArrowUp");
    expect(active()?.dataset.key).toBe("m1");
    key("Enter");
    key("F2");
    key("Delete");
    row("p1").click();
    expect(active()?.dataset.key).toBe("p1");
    expect(field()).toBeNull();
    expect(calls).toEqual([]);
    expect(panel.rename(1)).toBe(false);
    expect(formatIssues(checkAccessibility(host))).toBe("");

    state.editable = true;
    panel.update(view());
    expect(list().hasAttribute("aria-disabled")).toBe(false);
    expect(host.querySelector<HTMLButtonElement>(".draw-history-action")!.disabled).toBe(false);
  });
});
