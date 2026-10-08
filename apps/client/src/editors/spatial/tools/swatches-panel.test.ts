// @vitest-environment happy-dom
// I colori del documento come sezione, da sola, su un editor finto che
// cambia come gli si chiede: le tre griglie e i loro nomi, il colore di
// adesso detto non solo col colore, «Applica a», i gesti col puntatore e
// coi tasti, il menu di un colore, il modulo dei campioni coi suoi errori,
// la sola lettura, il fuoco che non si perde e la lingua.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { createSwatchesPanel, type ColorChoice, type ColorsView, type PaintTarget, type SwatchChip, type SwatchesPanel } from "./swatches-panel";

const BRAND: SwatchChip = { id: "ra", name: "Blu marca", color: "#0072b2", uses: 3 };
const PAPER: SwatchChip = { id: "rb", name: "Fondo", color: "#f5f5dc", uses: 0 };

/// Una selezione col riempimento al campione «Blu marca» e il contorno nero.
function viewOf(more: Partial<ColorsView> = {}): ColorsView {
  return {
    swatches: [BRAND, PAPER],
    used: [
      { color: "#000000", uses: 12 },
      { color: "#0072b2", uses: 2 },
      { color: "#3a7bd5", uses: 1 },
    ],
    hidden: 0,
    recent: ["#d55e00", "#3a7bd5"],
    targets: ["fill", "stroke"],
    current: { fill: "url(#ra)", stroke: "#000000" },
    drawing: "#000000",
    drawingSwatch: null,
    ...more,
  };
}

let host: HTMLElement;
let life: Lifetime;
let panel: SwatchesPanel;
let state: { view: ColorsView; editable: boolean };
let calls: string[];
let announced: string[];
let made: number;
/// Ciò che l'editor risponde a un gesto: `null` se lo fa.
let refusal: string | null;

const update = (): void => panel.update(state.view, state.editable);

/// La sezione su un editor finto, che cambia la vista come farebbe
/// l'editor.
function mount(view: ColorsView = viewOf(), editable = true): SwatchesPanel {
  state = { view, editable };
  panel = createSwatchesPanel(life, {
    onApply: (choice: ColorChoice, target: PaintTarget | null) => {
      calls.push(`apply ${choice.value} ${choice.color} ${choice.name} ${target ?? "drawing"}`);
      if (refusal !== null) return refusal;
      const id = /^url\(#([^)]+)\)/.exec(choice.value)?.[1] ?? null;
      if (target === null) state.view = { ...state.view, drawing: choice.color, drawingSwatch: id };
      else state.view = { ...state.view, current: { ...state.view.current, [target]: id === null ? choice.value : `url(#${id})` } };
      update();
      return null;
    },
    onCreate: (name, color, link) => {
      calls.push(`create ${name} ${color} ${link}`);
      if (refusal !== null) return refusal;
      made += 1;
      state.view = { ...state.view, swatches: [...state.view.swatches, { id: `n${made}`, name, color, uses: link ? 1 : 0 }] };
      update();
      return null;
    },
    onLink: (id) => {
      calls.push(`link ${id}`);
      return refusal;
    },
    onRename: (id, name) => {
      calls.push(`rename ${id} ${name}`);
      if (refusal !== null) return refusal;
      state.view = { ...state.view, swatches: state.view.swatches.map((each) => (each.id === id ? { ...each, name } : each)) };
      update();
      return null;
    },
    onRecolor: (id, color) => {
      calls.push(`recolor ${id} ${color}`);
      if (refusal !== null) return refusal;
      state.view = { ...state.view, swatches: state.view.swatches.map((each) => (each.id === id ? { ...each, color } : each)) };
      update();
      return null;
    },
    onDelete: (id) => {
      calls.push(`delete ${id}`);
      if (refusal !== null) return refusal;
      state.view = { ...state.view, swatches: state.view.swatches.filter((each) => each.id !== id) };
      update();
      return null;
    },
    onSelect: (value) => {
      calls.push(`select ${value}`);
      return refusal;
    },
    announce: (text) => announced.push(text),
  });
  host.append(panel.element);
  update();
  return panel;
}

const group = (kind: string): HTMLElement => host.querySelector<HTMLElement>(`.draw-swatches-group[data-group="${kind}"]`)!;
const chips = (kind: string): HTMLButtonElement[] => [...group(kind).querySelectorAll<HTMLButtonElement>(".draw-swatches-chip")];
const chip = (kind: string, key: string): HTMLButtonElement => group(kind).querySelector<HTMLButtonElement>(`.draw-swatches-chip[data-key="${key}"]`)!;
const keys = (kind: string): string[] => chips(kind).map((each) => each.dataset.key!);
const labels = (kind: string): string[] => chips(kind).map((each) => each.getAttribute("aria-label")!);
const counts = (kind: string): string[] => chips(kind).map((each) => each.querySelector(".draw-swatches-count")?.textContent ?? "-");
const current = (): string[] => [...host.querySelectorAll<HTMLElement>('[aria-current="true"]')].map((each) => `${each.closest<HTMLElement>(".draw-swatches-group")!.dataset.group} ${each.dataset.key}`);
const note = (kind: string): HTMLElement => group(kind).querySelector<HTMLElement>(".draw-properties-note")!;
const addButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-swatches-add")!;
const targetRow = (): HTMLElement => host.querySelector<HTMLElement>(".draw-swatches-target")!;
const targetButton = (target: PaintTarget): HTMLButtonElement => targetRow().querySelector<HTMLButtonElement>(`[data-target="${target}"]`)!;
const form = (): HTMLElement => host.querySelector<HTMLElement>(".draw-swatches-form")!;
const formTitle = (): string => form().querySelector(".draw-swatches-form-title")!.textContent!;
const nameInput = (): HTMLInputElement => form().querySelectorAll<HTMLInputElement>('input[type="text"]')[0]!;
const colorInput = (): HTMLInputElement => form().querySelectorAll<HTMLInputElement>('input[type="text"]')[1]!;
const picker = (): HTMLInputElement => form().querySelector<HTMLInputElement>('input[type="color"]')!;
const formError = (): HTMLElement => form().querySelector<HTMLElement>(".draw-properties-error")!;
const submitButton = (): HTMLButtonElement => form().querySelectorAll<HTMLButtonElement>(".draw-swatches-form-actions button")[0]!;
const cancelButton = (): HTMLButtonElement => form().querySelectorAll<HTMLButtonElement>(".draw-swatches-form-actions button")[1]!;
/// Le righe del modulo che si vedono, per il nome della loro etichetta.
const formRows = (): string[] =>
  [...form().querySelectorAll<HTMLElement>(".draw-swatches-form-row")].filter((row) => !row.hidden).map((row) => row.querySelector("label")!.textContent!);
/// Il pulsante di una griglia che prende il Tab.
const tabStop = (kind: string): string | undefined => [...group(kind).querySelectorAll<HTMLButtonElement>("button")].find((each) => each.tabIndex === 0)?.dataset.key;

function key(name: string, init: KeyboardEventInit = {}, target: Element | null = document.activeElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target!.dispatchEvent(event);
  return event;
}

function click(target: Element, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
}

function rightClick(target: Element): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 });
  target.dispatchEvent(event);
  return event;
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/// Il menu aperto per ultimo: quello chiuso può restare un momento, mentre
/// esce.
const menu = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return open[open.length - 1]!;
};
const entries = (): HTMLButtonElement[] => [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const entry = (label: string): HTMLButtonElement => entries().find((one) => one.querySelector(".menu-label")!.textContent === label)!;
/// Una voce come la si legge: il nome, il perché, il tasto, e se è spenta.
const readOf = (one: HTMLButtonElement): (string | null)[] => [
  one.querySelector(".menu-label")!.textContent,
  one.querySelector(".menu-description")?.textContent ?? "",
  one.querySelector(".menu-hint")?.textContent ?? "",
  one.getAttribute("aria-disabled"),
];

const READ_ONLY = "Modifica non applicata: il disegno è in sola lettura.";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  calls = [];
  announced = [];
  made = 0;
  refusal = null;
});

afterEach(() => {
  closeContextMenu();
  for (const open of document.querySelectorAll(".context-menu")) open.remove();
  life.close();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("le griglie", () => {
  it("hanno i campioni col più, i colori usati dal più usato e i recenti, ciascuno col suo nome", () => {
    mount();
    expect([...host.querySelectorAll(".draw-swatches-heading")].map((each) => each.textContent)).toEqual(["Campioni", "Colori usati", "Recenti"]);
    for (const kind of ["swatches", "used", "recent"]) {
      const heading = group(kind).querySelector(".draw-swatches-heading")!;
      expect(group(kind).getAttribute("aria-labelledby")).toBe(heading.id);
      expect(group(kind).querySelector('[role="toolbar"]')!.getAttribute("aria-labelledby")).toBe(heading.id);
    }
    expect(keys("swatches")).toEqual(["ra", "rb"]);
    expect(group("swatches").querySelector(".draw-swatches-grid > button:last-child")).toBe(addButton());
    expect(addButton().getAttribute("aria-label")).toBe("Nuovo campione…");
    expect(keys("used")).toEqual(["#000000", "#0072b2", "#3a7bd5"]);
    expect(keys("recent")).toEqual(["#d55e00", "#3a7bd5"]);
    // Un campione col suo nome e il codice, un colore della tavolozza col
    // suo nome, gli altri col codice; con quanti oggetti lo mostrano.
    expect(labels("swatches")).toEqual(["Blu marca, campione #0072b2, usato da 3 oggetti", "Fondo, campione #f5f5dc, non usato"]);
    expect(labels("used")).toEqual(["Nero, usato da 12 oggetti", "Blu, usato da 2 oggetti", "#3a7bd5, usato da 1 oggetto"]);
    expect(labels("recent")).toEqual(["Vermiglio", "#3a7bd5"]);
    // Il numero si vede sotto il colore, e non si sente due volte.
    expect(counts("swatches")).toEqual(["3", "0"]);
    expect(counts("used")).toEqual(["12", "2", "1"]);
    expect(counts("recent")).toEqual(["-", "-"]);
    expect(chip("used", "#000000").querySelector(".draw-swatches-count")!.getAttribute("aria-hidden")).toBe("true");
    // La forma della tavolozza, o l'anello di un colore a piacere.
    const shape = (button: HTMLButtonElement): string => button.querySelector<HTMLElement>(".draw-swatch-frame")!.dataset.shape!;
    expect(chips("used").map(shape)).toEqual(["circle", "square", "ring"]);
    expect(chip("swatches", "rb").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#f5f5dc");
    // Il suggerimento dice anche che cosa fa un clic.
    expect(chip("swatches", "ra").title).toBe("Blu marca, campione #0072b2, usato da 3 oggetti\nClic: al riempimento.\nMaiusc+clic: al contorno.");
    expect([note("swatches").hidden, note("used").hidden, note("recent").hidden]).toEqual([true, true, true]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("senza campioni né colori lo dicono, e senza recenti la griglia non c'è", () => {
    mount(viewOf({ swatches: [], used: [], recent: [] }));
    expect(note("swatches").hidden).toBe(false);
    expect(note("swatches").textContent).toBe("Ancora nessun campione: «+» ne fa uno, e il menu di un colore usato lo rende un campione.");
    expect(note("used").textContent).toBe("Nessun colore scritto: gli oggetti usano i campioni, o il disegno è vuoto.");
    expect(group("used").querySelector<HTMLElement>(".draw-swatches-grid")!.hidden).toBe(true);
    expect(group("recent").hidden).toBe(true);
    // Il più c'è sempre, e prende il Tab.
    expect(tabStop("swatches")).toBe("+");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("dicono quanti colori usati restano fuori, al singolare e al plurale", () => {
    mount(viewOf({ hidden: 1 }));
    expect(note("used").textContent).toBe("E 1 altro colore, usato meno.");
    state.view = viewOf({ hidden: 3 });
    update();
    expect(note("used").textContent).toBe("E altri 3 colori, usati meno.");
  });

  it("scrivono i numeri nella lingua dell'app", () => {
    mount(viewOf({ used: [{ color: "#000000", uses: 12345 }] }));
    expect(counts("used")).toEqual(["12.345"]);
    expect(labels("used")).toEqual(["Nero, usato da 12.345 oggetti"]);
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(counts("used")).toEqual(["12,345"]);
    expect(labels("used")).toEqual(["Black, used by 12,345 objects"]);
    expect([...host.querySelectorAll(".draw-swatches-heading")].map((each) => each.textContent)).toEqual(["Swatches", "Colors in use", "Recent"]);
    expect(targetRow().querySelector(".draw-properties-label")!.textContent).toBe("Apply to");
    expect([targetButton("fill").textContent, targetButton("stroke").textContent]).toEqual(["Fill", "Stroke"]);
    expect(addButton().getAttribute("aria-label")).toBe("New swatch…");
  });

  it("cambiano soltanto ciò che cambia: un colore che resta tiene il suo pulsante", () => {
    mount();
    const black = chip("used", "#000000");
    state.view = viewOf({ used: [{ color: "#3a7bd5", uses: 4 }, { color: "#000000", uses: 2 }] });
    update();
    expect(keys("used")).toEqual(["#3a7bd5", "#000000"]);
    expect(chip("used", "#000000")).toBe(black);
    expect(labels("used")).toEqual(["#3a7bd5, usato da 4 oggetti", "Nero, usato da 2 oggetti"]);
  });
});

describe("il colore di adesso", () => {
  it("è quello del bersaglio scelto, con aria-current, e prende il Tab della griglia", () => {
    mount();
    expect(current()).toEqual(["swatches ra"]);
    expect(tabStop("swatches")).toBe("ra");
    // Il contorno è nero: il nero usato, non il campione.
    click(targetButton("stroke"));
    expect(current()).toEqual(["used #000000"]);
    // Un colore misto non è nessuno.
    state.view = viewOf({ current: { fill: "url(#ra)", stroke: null } });
    update();
    expect(current()).toEqual([]);
  });

  it("senza selezione è il colore con cui si disegna; se viene da un campione, soltanto il campione", () => {
    mount(viewOf({ targets: null, current: {}, drawing: "#3a7bd5" }));
    expect(current()).toEqual(["used #3a7bd5", "recent #3a7bd5"]);
    state.view = viewOf({ targets: null, current: {}, drawing: "#0072b2", drawingSwatch: "ra" });
    update();
    // Il blu usato scritto è lo stesso colore, ma non è il campione.
    expect(current()).toEqual(["swatches ra"]);
  });
});

describe("«Applica a»", () => {
  it("c'è quando la selezione ha riempimento e contorno, come una barra con la scelta premuta", () => {
    mount();
    expect(targetRow().hidden).toBe(false);
    const label = targetRow().querySelector(".draw-properties-label")!;
    expect(label.textContent).toBe("Applica a");
    expect(targetRow().querySelector('[role="toolbar"]')!.getAttribute("aria-labelledby")).toBe(label.id);
    expect([targetButton("fill").textContent, targetButton("stroke").textContent]).toEqual(["Riempimento", "Contorno"]);
    expect([targetButton("fill").getAttribute("aria-pressed"), targetButton("stroke").getAttribute("aria-pressed")]).toEqual(["true", "false"]);
    expect([targetButton("fill").tabIndex, targetButton("stroke").tabIndex]).toEqual([0, -1]);
    // Le frecce passano all'altro, senza sceglierlo; il clic lo sceglie.
    targetButton("fill").focus();
    key("ArrowRight");
    expect(document.activeElement).toBe(targetButton("stroke"));
    expect(targetButton("stroke").getAttribute("aria-pressed")).toBe("false");
    click(targetButton("stroke"));
    expect([targetButton("fill").getAttribute("aria-pressed"), targetButton("stroke").getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    expect(chip("swatches", "ra").title).toBe("Blu marca, campione #0072b2, usato da 3 oggetti\nClic: al contorno.\nMaiusc+clic: al riempimento.");
    key("Home");
    expect(document.activeElement).toBe(targetButton("fill"));
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("non c'è senza selezione, né con un bersaglio solo, e il suggerimento lo dice", () => {
    mount(viewOf({ targets: null, current: {} }));
    expect(targetRow().hidden).toBe(true);
    expect(chip("used", "#000000").title).toBe("Nero, usato da 12 oggetti\nClic: disegna con questo colore.");
    state.view = viewOf({ targets: ["stroke"], current: { stroke: "#000000" } });
    update();
    expect(targetRow().hidden).toBe(true);
    expect(chip("used", "#000000").title).toBe("Nero, usato da 12 oggetti\nClic: al contorno.");
    state.view = viewOf({ targets: [], current: {} });
    update();
    expect(chip("used", "#000000").title).toBe("Nero, usato da 12 oggetti\nLa selezione non ha un colore da cambiare.");
  });
});

describe("dare un colore", () => {
  it("un clic lo dà al bersaglio, e con Maiusc all'altro; un campione si scrive col suo ripiego", () => {
    mount();
    click(chip("used", "#3a7bd5"));
    click(chip("swatches", "ra"), { shiftKey: true });
    expect(calls).toEqual(["apply #3a7bd5 #3a7bd5 #3a7bd5 fill", "apply url(#ra) #0072b2 #0072b2 Blu marca stroke"]);
    expect(current()).toEqual(["used #3a7bd5", "recent #3a7bd5"]);
  });

  it("con un bersaglio solo va lì anche con Maiusc", () => {
    mount(viewOf({ targets: ["stroke"], current: { stroke: "#000000" } }));
    click(chip("recent", "#d55e00"), { shiftKey: true });
    expect(calls).toEqual(["apply #d55e00 #d55e00 Vermiglio stroke"]);
  });

  it("senza selezione è il colore con cui si disegna", () => {
    mount(viewOf({ targets: null, current: {} }));
    click(chip("swatches", "ra"));
    expect(calls).toEqual(["apply url(#ra) #0072b2 #0072b2 Blu marca drawing"]);
    expect(current()).toEqual(["swatches ra"]);
  });

  it("una selezione senza colore da cambiare lo dice, e non chiede niente", () => {
    mount(viewOf({ targets: [], current: {} }));
    click(chip("used", "#000000"));
    expect(calls).toEqual([]);
    expect(announced).toEqual(["La selezione non ha un colore da cambiare."]);
  });

  it("ciò che l'editor non fa si sente", () => {
    mount();
    refusal = "Modifica non applicata: gli oggetti scelti sono bloccati.";
    click(chip("used", "#000000"));
    expect(announced).toEqual(["Modifica non applicata: gli oggetti scelti sono bloccati."]);
  });
});

describe("da tastiera", () => {
  it("ogni griglia prende un Tab; le frecce, Inizio e Fine passano agli altri, anche al più", () => {
    mount();
    expect([tabStop("swatches"), tabStop("used"), tabStop("recent")]).toEqual(["ra", "#000000", "#d55e00"]);
    chip("swatches", "ra").focus();
    key("ArrowRight");
    expect(document.activeElement).toBe(chip("swatches", "rb"));
    expect(tabStop("swatches")).toBe("rb");
    key("ArrowRight");
    expect(document.activeElement).toBe(addButton());
    key("ArrowRight");
    expect(document.activeElement).toBe(chip("swatches", "ra"));
    key("ArrowLeft");
    expect(document.activeElement).toBe(addButton());
    key("Home");
    expect(document.activeElement).toBe(chip("swatches", "ra"));
    key("End");
    expect(document.activeElement).toBe(addButton());
    // Senza disposizione, giù è il seguente; in fondo il fuoco resta.
    key("ArrowDown");
    expect(document.activeElement).toBe(addButton());
    // Un aggiornamento non toglie il Tab al pulsante che l'aveva.
    update();
    expect(tabStop("swatches")).toBe("+");
  });

  it("Invio e Spazio danno il colore, Maiusc+Invio all'altro bersaglio; sul più aprono il modulo", () => {
    mount();
    chip("used", "#0072b2").focus();
    expect(key("Enter").defaultPrevented).toBe(true);
    key(" ");
    key("Enter", { shiftKey: true });
    expect(calls).toEqual(["apply #0072b2 #0072b2 Blu fill", "apply #0072b2 #0072b2 Blu fill", "apply #0072b2 #0072b2 Blu stroke"]);
    addButton().focus();
    key("Enter");
    expect(form().hidden).toBe(false);
    expect(document.activeElement).toBe(nameInput());
  });

  it("F2 rinomina un campione e Canc lo elimina; su un colore usato non fanno niente", () => {
    mount();
    chip("used", "#000000").focus();
    expect(key("F2").defaultPrevented).toBe(false);
    expect(key("Delete").defaultPrevented).toBe(false);
    chip("swatches", "rb").focus();
    key("F2");
    expect(form().hidden).toBe(false);
    expect(formTitle()).toBe("Rinomina «Fondo»");
    key("Escape", {}, nameInput());
    expect(document.activeElement).toBe(chip("swatches", "rb"));
    key("Delete");
    expect(calls).toEqual(["delete rb"]);
    // Il fuoco passa al vicino.
    expect(document.activeElement).toBe(addButton());
    chip("swatches", "ra").focus();
    key("Backspace");
    expect(calls).toEqual(["delete rb", "delete ra"]);
    expect(document.activeElement).toBe(addButton());
  });

  it("Ctrl e Alt lasciano i tasti a chi sta sopra", () => {
    mount();
    chip("swatches", "ra").focus();
    expect(key("ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("Enter", { altKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(chip("swatches", "ra"));
    expect(calls).toEqual([]);
  });
});

describe("il menu di un colore", () => {
  it("di un campione: dove darlo, rinominarlo, cambiarne il colore, sceglierne gli oggetti, eliminarlo", () => {
    mount();
    expect(rightClick(chip("swatches", "ra")).defaultPrevented).toBe(true);
    expect(entries().map(readOf)).toEqual([
      ["Applica al riempimento", "", "", null],
      ["Applica al contorno", "", "", null],
      ["Rinomina…", "", "F2", null],
      ["Cambia colore…", "", "", null],
      ["Scegli gli oggetti con questo campione", "", "", null],
      ["Elimina campione", "Chi lo usa tiene il suo colore.", "Delete", null],
    ]);
    expect(menu().getAttribute("aria-labelledby")).toBe(chip("swatches", "ra").id);
    entry("Applica al contorno").click();
    rightClick(chip("swatches", "ra"));
    entry("Scegli gli oggetti con questo campione").click();
    rightClick(chip("swatches", "ra"));
    entry("Elimina campione").click();
    expect(calls).toEqual(["apply url(#ra) #0072b2 #0072b2 Blu marca stroke", "select url(#ra)", "delete ra"]);
  });

  it("di un campione che nessuno usa: sceglierne gli oggetti è spento, e dice perché", () => {
    mount();
    rightClick(chip("swatches", "rb"));
    expect(readOf(entry("Scegli gli oggetti con questo campione"))).toEqual(["Scegli gli oggetti con questo campione", "Nessun oggetto lo usa.", "", "true"]);
  });

  it("di un colore usato: renderlo campione, passarlo al campione dello stesso colore, sceglierne gli oggetti", () => {
    mount();
    rightClick(chip("used", "#0072b2"));
    expect(entries().map(readOf)).toEqual([
      ["Applica al riempimento", "", "", null],
      ["Applica al contorno", "", "", null],
      ["Rendi campione…", "", "", null],
      ["Usa il campione «Blu marca»", "Chi ha questo colore scritto passa al campione.", "", null],
      ["Scegli gli oggetti con questo colore", "", "", null],
    ]);
    entry("Usa il campione «Blu marca»").click();
    rightClick(chip("used", "#0072b2"));
    entry("Scegli gli oggetti con questo colore").click();
    expect(calls).toEqual(["link ra", "select #0072b2"]);
  });

  it("di un recente, e senza selezione", () => {
    mount(viewOf({ targets: null, current: {} }));
    rightClick(chip("recent", "#d55e00"));
    expect(entries().map(readOf)).toEqual([
      ["Disegna con questo colore", "", "", null],
      ["Rendi campione…", "", "", null],
    ]);
    entry("Disegna con questo colore").click();
    expect(calls).toEqual(["apply #d55e00 #d55e00 Vermiglio drawing"]);
  });

  it("si apre anche coi tasti, sotto il colore, e il clic destro che il tasto manda dietro non ne apre un altro", () => {
    mount();
    chip("used", "#000000").focus();
    expect(key("F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.querySelectorAll(".context-menu")).toHaveLength(1);
    const echo = rightClick(chip("used", "#000000"));
    expect(echo.defaultPrevented).toBe(true);
    expect(document.querySelectorAll(".context-menu")).toHaveLength(1);
    closeContextMenu();
    key("ContextMenu", {}, chip("used", "#000000"));
    expect(entries().map((one) => one.querySelector(".menu-label")!.textContent)).toContain("Rendi campione…");
  });
});

describe("il modulo dei campioni", () => {
  it("«Nuovo campione…» parte dal colore del bersaglio, col suo nome, e il campione nuovo prende il fuoco", () => {
    mount();
    click(addButton());
    expect(form().hidden).toBe(false);
    expect(form().getAttribute("role")).toBe("group");
    expect(formTitle()).toBe("Nuovo campione");
    expect(formRows()).toEqual(["Nome", "Colore"]);
    // Il riempimento è il campione «Blu marca»: il suo colore, che nella
    // tavolozza si chiama Blu.
    expect([nameInput().value, colorInput().value, picker().value]).toEqual(["Blu", "#0072b2", "#0072b2"]);
    expect(document.activeElement).toBe(nameInput());
    expect([submitButton().textContent, cancelButton().textContent]).toEqual(["Crea", "Annulla"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    type(nameInput(), "  Mare  ");
    type(colorInput(), "#005A8C");
    expect(picker().value).toBe("#005a8c");
    key("Enter", {}, colorInput());
    expect(calls).toEqual(["create Mare #005a8c false"]);
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(chip("swatches", "n1"));
    expect(tabStop("swatches")).toBe("n1");
  });

  it("un colore a piacere dà il nome «Campione», il primo libero", () => {
    mount(viewOf({ targets: null, current: {}, drawing: "#3a7bd5", swatches: [{ id: "rc", name: "Campione", color: "#123456", uses: 0 }] }));
    click(addButton());
    expect([nameInput().value, colorInput().value]).toEqual(["Campione 2", "#3a7bd5"]);
    // Il selettore del sistema scrive il codice.
    type(picker(), "#ff8800");
    expect(colorInput().value).toBe("#ff8800");
    click(submitButton());
    expect(calls).toEqual(["create Campione 2 #ff8800 false"]);
  });

  it("dice accanto che cosa non va, e resta: il nome vuoto, già preso, o che si legge come un colore, e il colore", () => {
    mount();
    click(addButton());
    type(nameInput(), "   ");
    key("Enter", {}, nameInput());
    expect(formError().hidden).toBe(false);
    expect(formError().textContent).toBe("Scrivi un nome.");
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(nameInput().getAttribute("aria-describedby")).toBe(formError().id);
    expect(announced).toEqual(["Scrivi un nome."]);
    type(nameInput(), "blu MARCA");
    key("Enter", {}, nameInput());
    expect(formError().textContent).toBe("C’è già un campione «blu MARCA»: scegline un altro.");
    type(nameInput(), "#ff0000");
    key("Enter", {}, nameInput());
    expect(formError().textContent).toBe("«#ff0000» si legge come un colore, non come un nome: scegline un altro.");
    type(nameInput(), "Mare");
    type(colorInput(), "mare");
    key("Enter", {}, nameInput());
    expect(formError().textContent).toBe("Scrivi un colore: un codice come #0072b2 o un nome come red.");
    expect(colorInput().getAttribute("aria-invalid")).toBe("true");
    expect(nameInput().hasAttribute("aria-invalid")).toBe(false);
    expect(document.activeElement).toBe(colorInput());
    expect(form().hidden).toBe(false);
    expect(calls).toEqual([]);
    // Ciò che l'editor rifiuta si dice nel modulo.
    type(colorInput(), "teal");
    refusal = "Modifica non applicata: il disegno è cambiato.";
    key("Enter", {}, colorInput());
    expect(calls).toEqual(["create Mare #008080 false"]);
    expect(formError().textContent).toBe("Modifica non applicata: il disegno è cambiato.");
    expect(form().hidden).toBe(false);
  });

  it("Esc e «Annulla» lo chiudono, e il fuoco torna da dove era partito", () => {
    mount();
    addButton().focus();
    key("Enter");
    expect(key("Escape", {}, nameInput()).defaultPrevented).toBe(true);
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(addButton());
    rightClick(chip("used", "#3a7bd5"));
    entry("Rendi campione…").click();
    click(cancelButton());
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(chip("used", "#3a7bd5"));
    expect(calls).toEqual([]);
  });

  it("«Rendi campione…» chiede soltanto il nome, e il colore passa al campione", () => {
    mount();
    rightClick(chip("used", "#3a7bd5"));
    entry("Rendi campione…").click();
    expect(formTitle()).toBe("Rendi campione #3a7bd5");
    expect(formRows()).toEqual(["Nome"]);
    expect(nameInput().value).toBe("Campione");
    type(nameInput(), "Cielo");
    key("Enter", {}, nameInput());
    expect(calls).toEqual(["create Cielo #3a7bd5 true"]);
    expect(document.activeElement).toBe(chip("swatches", "n1"));
  });

  it("«Rinomina…» e «Cambia colore…» partono dal campione, e non chiedono niente se non cambia", () => {
    mount();
    chip("swatches", "ra").focus();
    key("F2");
    expect(formRows()).toEqual(["Nome"]);
    expect(nameInput().value).toBe("Blu marca");
    expect(submitButton().textContent).toBe("Applica");
    key("Enter", {}, nameInput());
    expect(calls).toEqual([]);
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(chip("swatches", "ra"));
    key("F2");
    type(nameInput(), "Blu oceano");
    key("Enter", {}, nameInput());
    expect(labels("swatches")[0]).toBe("Blu oceano, campione #0072b2, usato da 3 oggetti");
    rightClick(chip("swatches", "ra"));
    entry("Cambia colore…").click();
    expect(formTitle()).toBe("Cambia il colore di «Blu oceano»");
    expect(formRows()).toEqual(["Colore"]);
    expect(colorInput().value).toBe("#0072b2");
    expect(document.activeElement).toBe(colorInput());
    type(colorInput(), "#005a8c");
    key("Enter", {}, colorInput());
    expect(calls).toEqual(["rename ra Blu oceano", "recolor ra #005a8c"]);
    expect(document.activeElement).toBe(chip("swatches", "ra"));
  });

  it("si chiude se il campione che cambiava se ne va, per esempio annullando", () => {
    mount();
    chip("swatches", "rb").focus();
    key("F2");
    state.view = viewOf({ swatches: [BRAND] });
    update();
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(chip("swatches", "ra"));
  });
});

describe("in sola lettura", () => {
  it("i colori si guardano e se ne scelgono gli oggetti; il resto dice perché no", () => {
    mount(viewOf(), false);
    expect(addButton().getAttribute("aria-disabled")).toBe("true");
    click(addButton());
    expect(form().hidden).toBe(true);
    click(chip("used", "#000000"));
    chip("swatches", "ra").focus();
    key("F2");
    key("Delete");
    expect(calls).toEqual([]);
    expect(announced).toEqual([READ_ONLY, READ_ONLY, READ_ONLY, READ_ONLY]);
    rightClick(chip("swatches", "ra"));
    expect(entries().map((one) => [one.querySelector(".menu-label")!.textContent, one.getAttribute("aria-disabled")])).toEqual([
      ["Applica al riempimento", "true"],
      ["Applica al contorno", "true"],
      ["Rinomina…", "true"],
      ["Cambia colore…", "true"],
      ["Scegli gli oggetti con questo campione", null],
      ["Elimina campione", "true"],
    ]);
    entry("Scegli gli oggetti con questo campione").click();
    expect(calls).toEqual(["select url(#ra)"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("chiude il modulo aperto, e senza campioni lo dice senza invitare a farne", () => {
    mount();
    click(addButton());
    panel.update(viewOf({ swatches: [] }), false);
    expect(form().hidden).toBe(true);
    expect(note("swatches").textContent).toBe("Il disegno non ha campioni.");
  });
});
