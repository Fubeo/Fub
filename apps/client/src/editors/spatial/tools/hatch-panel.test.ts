// @vitest-environment happy-dom
// La sezione «Campitura», da sola, su un editor finto che cambia come gli si
// chiede: il menu del tipo in ogni stato (nessuna, pronta, personalizzata,
// di un altro programma, mista, un motivo del documento), i campi con i loro
// nomi, unità e valori, i numeri che si calcolano e si tengono nei limiti, i
// colori, i tasti, il motivo che si rinomina e si elimina, i rifiuti, la
// sola lettura e la lingua.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import type { DrawKey } from "../strings";
import { createHatchPanel, hatchIcon, type HatchMotif, type HatchPanel, type HatchPanelView } from "./hatch-panel";
import { HATCH_PRESETS, MAX_SPACING, MIN_SPACING, MIN_WIDTH } from "./hatches";
import type { HatchChange, HatchView } from "./patterns";
import { fromUnit } from "./rulers";

const READ_ONLY = "Modifica non applicata: il disegno è in sola lettura.";

/// Una campitura diagonale blu, su un oggetto.
const DIAGONAL: HatchView = { count: 1, hatched: 1, choice: "diagonal", kind: "lines", angle: 45, spacing: 8, width: 1, color: "#0072b2", background: "none" };
const NONE: HatchView = { count: 1, hatched: 0, choice: "none", kind: null, angle: null, spacing: null, width: null, color: null, background: null };
const MOTIFS: HatchMotif[] = [
  { id: "ra", name: "Tratti blu", color: "#0072b2" },
  { id: "rb", name: "Pois", color: "#d55e00" },
];
const SWATCHES = [{ id: "sa", name: "Blu marca", color: "#0072b2" }];

function viewOf(hatch: Partial<HatchView> = {}, more: Partial<HatchPanelView> = {}): HatchPanelView {
  return { key: "oa", hatch: { ...DIAGONAL, ...hatch }, unit: "px", swatches: SWATCHES, motifs: MOTIFS, expert: false, ...more };
}

interface Sent {
  readonly change: HatchChange;
  readonly label: DrawKey;
}

let host: HTMLElement;
let life: Lifetime;
let panel: HatchPanel;
let state: { view: HatchPanelView; editable: boolean };
let sent: Sent[];
let announced: string[];
let calls: string[];
/// Ciò che l'editor risponde a un cambio: `null` se lo fa.
let refusal: string | null;
/// Perché l'editor non fa «Motivo dalla selezione»; `null` se lo fa.
let motifBlock: string | null;
/// Ciò che l'editor risponde a «Elimina motivo».
let deleteRefusal: string | null;
/// Un editor che, a ogni cambio, dà alla selezione un'altra chiave.
let rekey: boolean;

const update = (): void => panel.update(state.view, state.editable);

/// La vista dopo `change`, come la darebbe l'editor.
function changed(view: HatchPanelView, change: HatchChange): HatchPanelView {
  const hatch = view.hatch;
  let next: HatchView = hatch;
  if ("preset" in change) {
    next = { ...hatch, choice: change.preset, hatched: hatch.count, kind: change.preset === "dots" ? "dots" : change.preset === "grid" || change.preset === "cross" ? "cross" : "lines", angle: hatch.angle ?? 45, spacing: hatch.spacing ?? 8, width: hatch.width ?? 1, color: hatch.color ?? "#000000", background: hatch.background ?? "none" };
  } else if ("none" in change) {
    next = NONE;
  } else if ("pattern" in change) {
    next = { ...NONE, choice: `pattern:${change.pattern}` };
  } else if ("angle" in change) {
    next = { ...hatch, angle: change.angle };
  } else if ("spacing" in change) {
    next = { ...hatch, spacing: change.spacing };
  } else if ("width" in change) {
    next = { ...hatch, width: change.width };
  } else if ("color" in change) {
    next = { ...hatch, color: change.color };
  } else if ("background" in change) {
    next = { ...hatch, background: change.background ?? "none" };
  }
  return { ...view, key: rekey ? `${view.key}+` : view.key, hatch: next };
}

/// La sezione su un editor finto.
function mount(view: HatchPanelView = viewOf(), editable = true): HatchPanel {
  state = { view, editable };
  panel = createHatchPanel(life, {
    onChange: (change, label) => {
      sent.push({ change, label });
      if (refusal !== null) return refusal;
      state.view = changed(state.view, change);
      update();
      return null;
    },
    onMotif: () => calls.push("motif"),
    motifReason: () => motifBlock,
    onRename: (id, name) => {
      calls.push(`rename ${id} ${name}`);
      if (refusal !== null) return refusal;
      state.view = { ...state.view, motifs: state.view.motifs.map((each) => (each.id === id ? { ...each, name } : each)) };
      update();
      return null;
    },
    onDelete: (id) => {
      calls.push(`delete ${id}`);
      if (deleteRefusal !== null) return deleteRefusal;
      state.view = { ...state.view, hatch: { ...NONE }, motifs: state.view.motifs.filter((each) => each.id !== id) };
      update();
      return null;
    },
    announce: (text) => announced.push(text),
  });
  host.append(panel.element);
  update();
  return panel;
}

const one = <T extends Element = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!;
const kind = (): HTMLButtonElement => one<HTMLButtonElement>(".draw-properties-menu");
const group = (): HTMLElement => one(".draw-hatch-fields");
const motifGroup = (): HTMLElement => one(".draw-hatch-motif");
const field = (id: string): HTMLElement => one(`.draw-properties-field[data-field="hatch-${id}"]`);
const input = (id: string): HTMLInputElement => field(id).querySelector<HTMLInputElement>('input[type="text"]')!;
const picker = (id: string): HTMLInputElement => field(id).querySelector<HTMLInputElement>('input[type="color"]')!;
const chip = (id: string): HTMLButtonElement => field(id).querySelector<HTMLButtonElement>(".draw-properties-chip")!;
const labelOf = (id: string): string => field(id).querySelector("label")!.firstElementChild!.textContent!;
const nameOf = (id: string): string => field(id).querySelector("label")!.textContent!;
const errorOf = (id: string): HTMLElement => field(id).closest(".draw-hatch-fields, .draw-hatch-motif")!.querySelector<HTMLElement>(".draw-properties-error")!;
const note = (): HTMLElement => one(".draw-hatch > .draw-properties-note");
const deleteButton = (): HTMLButtonElement => motifGroup().querySelector<HTMLButtonElement>("button")!;
const lastSent = (): Sent => sent[sent.length - 1]!;
const visibleFields = (): string[] =>
  [...host.querySelectorAll<HTMLElement>(".draw-properties-field")].filter((each) => each.closest("[hidden]") === null).map((each) => each.dataset.field!.replace("hatch-", ""));

function key(name: string, init: KeyboardEventInit = {}, target: Element | null = document.activeElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target!.dispatchEvent(event);
  return event;
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/// Scrive `text` nel campo, lasciandolo col fuoco e senza confermare.
function type(target: HTMLInputElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

/// Scrive `text` e conferma con Invio.
function enter(target: HTMLInputElement, text: string): void {
  type(target, text);
  key("Enter");
}

/// Il menu aperto per ultimo: quello chiuso può restare un momento, mentre
/// esce.
const menu = (): HTMLElement => {
  const menus = document.querySelectorAll<HTMLElement>(".context-menu");
  return menus[menus.length - 1]!;
};
const entries = (): HTMLButtonElement[] => [...menu().querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
const labels = (): string[] => entries().map((each) => each.querySelector(".menu-label")!.textContent!);
const entry = (label: string): HTMLButtonElement => entries().find((each) => each.querySelector(".menu-label")!.textContent === label)!;
const reason = (label: string): string => entry(label).querySelector(".menu-description")?.textContent ?? "";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  sent = [];
  announced = [];
  calls = [];
  refusal = null;
  motifBlock = null;
  deleteRefusal = null;
  rekey = false;
});

afterEach(() => {
  closeContextMenu();
  for (const menus of document.querySelectorAll(".context-menu")) menus.remove();
  life.close();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("il menu del tipo, in ogni stato", () => {
  it("senza campitura dice «Nessuna», con la sua figura, e non mostra i campi", () => {
    mount(viewOf(NONE));
    expect(kind().textContent).toBe("Nessuna");
    expect(kind().getAttribute("aria-label")).toBe("Tipo: Nessuna");
    expect(kind().getAttribute("aria-haspopup")).toBe("menu");
    expect(kind().getAttribute("aria-expanded")).toBe("false");
    expect(kind().querySelector(".draw-properties-menu-picture svg")).not.toBeNull();
    expect(group().hidden).toBe(true);
    expect(motifGroup().hidden).toBe(true);
    expect(note().hidden).toBe(true);
    expect(visibleFields()).toEqual(["kind"]);
  });

  it("una campitura pronta ha il suo nome e la sua figura, e mostra i campi", () => {
    for (const preset of HATCH_PRESETS) {
      state = { view: viewOf({ choice: preset }), editable: true };
      host.replaceChildren();
      mount(viewOf({ choice: preset }));
      const name = { diagonal: "Diagonale", cross: "Incrociata", horizontal: "Orizzontale", dots: "Puntinata", grid: "Quadrettata" }[preset];
      expect(kind().textContent).toBe(name);
      expect(kind().getAttribute("aria-label")).toBe(`Tipo: ${name}`);
      expect(kind().querySelector(".draw-properties-menu-picture svg")).not.toBeNull();
    }
    expect(group().hidden).toBe(false);
    expect(visibleFields()).toEqual(["kind", "color", "background", "spacing", "width", "angle"]);
    expect(note().hidden).toBe(true);
  });

  it("una personalizzata si legge nel pulsante, con i campi", () => {
    mount(viewOf({ choice: "custom", angle: 33 }));
    expect(kind().textContent).toBe("Personalizzata");
    expect(kind().querySelector(".draw-properties-menu-picture svg")).not.toBeNull();
    expect(group().hidden).toBe(false);
    expect(input("angle").value).toBe("33");
    expect(note().hidden).toBe(true);
  });

  it("il motivo di un altro programma si legge nel pulsante, senza campi, e una nota dice che resta com'è", () => {
    mount(viewOf({ choice: "other", hatched: 0, kind: null, angle: null, spacing: null, width: null, color: null, background: null }));
    expect(kind().textContent).toBe("Altro motivo");
    expect(group().hidden).toBe(true);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe("È un motivo di un altro programma: FubDraw lo lascia com’è. Sceglierne un altro lo sostituisce.");
  });

  it("una scelta mista dice «Misto», senza figura, e la nota dice che cosa fanno i campi", () => {
    mount(viewOf({ count: 3, hatched: 2, choice: null, kind: "lines" }));
    expect(kind().textContent).toBe("Misto");
    expect(kind().getAttribute("aria-label")).toBe("Tipo: Misto");
    expect(kind().querySelector(".draw-properties-menu-picture svg")).toBeNull();
    expect(note().textContent).toBe("I campi cambiano la campitura di 2 oggetti: gli altri restano come sono.");
    expect(group().hidden).toBe(false);
    state.view = viewOf({ count: 3, hatched: 1, choice: null, kind: "lines" });
    update();
    expect(note().textContent).toBe("I campi cambiano la campitura di 1 oggetto: gli altri restano come sono.");
    // Senza nessuna campitura di FubDraw, i campi non ci sono.
    state.view = viewOf({ count: 2, hatched: 0, choice: null, kind: null, angle: null, spacing: null, width: null, color: null, background: null });
    update();
    expect(note().textContent).toBe("Gli oggetti scelti hanno riempimenti diversi: una scelta dal menu li cambia tutti.");
    expect(group().hidden).toBe(true);
    // Tutti con una campitura, anche diverse: niente da dire.
    state.view = viewOf({ count: 2, hatched: 2, choice: null, kind: "lines" });
    update();
    expect(note().hidden).toBe(true);
  });

  it("un motivo del documento dice il suo nome; all'Esperto ha il nome da riscrivere e il pulsante che elimina", () => {
    mount(viewOf({ choice: "pattern:ra", hatched: 0, kind: null, angle: null, spacing: null, width: null, color: null, background: null }, { expert: true }));
    expect(kind().textContent).toBe("Tratti blu");
    expect(kind().getAttribute("aria-label")).toBe("Tipo: Tratti blu");
    expect(kind().querySelector(".draw-properties-menu-picture svg")).not.toBeNull();
    expect(group().hidden).toBe(true);
    expect(motifGroup().hidden).toBe(false);
    expect(motifGroup().getAttribute("role")).toBe("group");
    expect(motifGroup().getAttribute("aria-label")).toBe("Motivo «Tratti blu»");
    expect(labelOf("name")).toBe("Nome");
    expect(input("name").value).toBe("Tratti blu");
    expect(deleteButton().textContent).toBe("Elimina motivo");
    expect(visibleFields()).toEqual(["kind", "name"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Sotto l'Esperto il nome si legge, e non si cambia da qui.
    state.view = { ...state.view, expert: false };
    update();
    expect(kind().textContent).toBe("Tratti blu");
    expect(motifGroup().hidden).toBe(true);
  });

  it("un motivo che il documento non ha più si legge come un motivo d'altri", () => {
    mount(viewOf({ choice: "pattern:zz", hatched: 0, kind: null }, { expert: true }));
    expect(kind().textContent).toBe("Altro motivo");
    expect(motifGroup().hidden).toBe(true);
  });

  it("le figure sono icone registrate, una per scelta", () => {
    expect(hatchIcon("none")).toBe("draw-hatch-none");
    expect(hatchIcon("diagonal")).toBe("draw-hatch-diagonal");
    expect(hatchIcon("grid")).toBe("draw-hatch-grid");
    expect(hatchIcon("custom")).toBe("draw-hatch-custom");
    expect(hatchIcon("other")).toBe("draw-hatch-pattern");
    expect(hatchIcon("pattern:ra")).toBe("draw-hatch-pattern");
    expect(hatchIcon(null)).toBeNull();
    mount();
    for (const choice of ["none", ...HATCH_PRESETS, "custom", "other"] as const) {
      state.view = viewOf({ choice });
      update();
      expect(kind().querySelector(".draw-properties-menu-picture svg path")).not.toBeNull();
    }
  });
});

describe("il menu: le voci", () => {
  it("sotto l'Esperto ha Nessuna e le cinque pronte, ciascuna con la sua figura, e la scelta di adesso è segnata", () => {
    mount();
    click(kind());
    expect(kind().getAttribute("aria-expanded")).toBe("true");
    expect(menu().getAttribute("role")).toBe("menu");
    expect(menu().getAttribute("aria-labelledby")).toBe(one(".draw-properties-label").id);
    expect(labels()).toEqual(["Nessuna", "Diagonale", "Incrociata", "Orizzontale", "Puntinata", "Quadrettata"]);
    expect(entries().map((each) => each.getAttribute("role"))).toEqual(Array(6).fill("menuitemradio"));
    expect(entries().map((each) => each.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "false", "false"]);
    expect(entries().every((each) => each.querySelector(".menu-icon svg") !== null)).toBe(true);
    // Il fuoco parte dalla voce di adesso.
    expect(document.activeElement).toBe(entry("Diagonale"));
    expect(formatIssues(checkAccessibility(menu()))).toBe("");
  });

  it("una campitura personalizzata, d'altri o mista non è una voce: nessuna è segnata", () => {
    for (const choice of ["custom", "other", null] as const) {
      closeContextMenu();
      host.replaceChildren();
      mount(viewOf({ choice }));
      click(kind());
      expect(labels()).toEqual(["Nessuna", "Diagonale", "Incrociata", "Orizzontale", "Puntinata", "Quadrettata"]);
      expect(entries().map((each) => each.getAttribute("aria-checked"))).toEqual(Array(6).fill("false"));
    }
  });

  it("all'Esperto ha anche i motivi del documento per nome, e dopo una riga «Motivo dalla selezione»", () => {
    mount(viewOf({ choice: "pattern:rb", hatched: 0 }, { expert: true }));
    click(kind());
    expect(labels()).toEqual(["Nessuna", "Diagonale", "Incrociata", "Orizzontale", "Puntinata", "Quadrettata", "Tratti blu", "Pois", "Motivo dalla selezione"]);
    expect(entries().map((each) => each.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false", "false", "false", "false", "true", null]);
    const separators = [...menu().querySelectorAll('[role="separator"]')];
    expect(separators).toHaveLength(2);
    expect(separators[0]!.nextElementSibling).toBe(entry("Tratti blu"));
    expect(separators[1]!.nextElementSibling).toBe(entry("Motivo dalla selezione"));
    // Ogni motivo ha la striscia del suo colore e la sua figura.
    expect(entry("Pois").querySelector(".menu-swatch")).not.toBeNull();
    expect(entry("Pois").querySelector(".menu-icon svg")).not.toBeNull();
    expect(document.activeElement).toBe(entry("Pois"));
    expect(formatIssues(checkAccessibility(menu()))).toBe("");
  });

  it("senza motivi all'Esperto c'è soltanto il comando, dopo una riga", () => {
    mount(viewOf({}, { expert: true, motifs: [] }));
    click(kind());
    expect(labels()).toEqual(["Nessuna", "Diagonale", "Incrociata", "Orizzontale", "Puntinata", "Quadrettata", "Motivo dalla selezione"]);
    expect(menu().querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it("ogni voce manda il suo cambio col nome del suo passo", () => {
    mount(viewOf({ choice: "none", hatched: 0 }, { expert: true }));
    click(kind());
    click(entry("Incrociata"));
    expect(sent).toEqual([{ change: { preset: "cross" }, label: "draw.action.hatch" }]);
    // Il menu si chiude, e il pulsante torna a dire che non è aperto.
    expect(kind().getAttribute("aria-expanded")).toBe("false");
    expect(kind().textContent).toBe("Incrociata");
    click(kind());
    click(entry("Nessuna"));
    expect(lastSent()).toEqual({ change: { none: true }, label: "draw.action.hatch_none" });
    expect(kind().textContent).toBe("Nessuna");
    click(kind());
    click(entry("Pois"));
    expect(lastSent()).toEqual({ change: { pattern: "rb" }, label: "draw.action.hatch" });
    expect(kind().textContent).toBe("Pois");
    expect(sent).toHaveLength(3);
  });

  it("scegliere ciò che c'è già non cambia niente", () => {
    mount();
    click(kind());
    click(entry("Diagonale"));
    expect(sent).toEqual([]);
    state.view = viewOf({ choice: "none", hatched: 0 });
    update();
    click(kind());
    click(entry("Nessuna"));
    expect(sent).toEqual([]);
  });

  it("scegliere con una campitura personalizzata o mista cambia: nessuna voce è già la scelta", () => {
    mount(viewOf({ choice: "custom" }));
    click(kind());
    click(entry("Diagonale"));
    expect(lastSent().change).toEqual({ preset: "diagonal" });
  });

  it("«Motivo dalla selezione» lo fa l'editor, e chiude il menu", () => {
    mount(viewOf({}, { expert: true }));
    click(kind());
    click(entry("Motivo dalla selezione"));
    expect(calls).toEqual(["motif"]);
    expect(sent).toEqual([]);
    expect(kind().getAttribute("aria-expanded")).toBe("false");
  });

  it("se l'editor non può fare un motivo, la voce c'è, spenta, e dice perché", () => {
    motifBlock = "Gli oggetti scelti non disegnano niente.";
    mount(viewOf({}, { expert: true }));
    click(kind());
    const disabled = entry("Motivo dalla selezione");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(reason("Motivo dalla selezione")).toBe("Gli oggetti scelti non disegnano niente.");
    click(disabled);
    expect(calls).toEqual([]);
  });

  it("la ragione si chiede quando il menu si apre, non prima", () => {
    mount(viewOf({}, { expert: true }));
    motifBlock = "Non ora.";
    click(kind());
    expect(reason("Motivo dalla selezione")).toBe("Non ora.");
  });
});

describe("il menu: la tastiera", () => {
  it("freccia giù e freccia su lo aprono sulla voce di adesso, e non muovono il foglio", () => {
    mount();
    kind().focus();
    const down = key("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(menu().getAttribute("role")).toBe("menu");
    expect(document.activeElement).toBe(entry("Diagonale"));
    closeContextMenu();
    const up = key("ArrowUp", {}, kind());
    expect(up.defaultPrevented).toBe(true);
    expect(kind().getAttribute("aria-expanded")).toBe("true");
  });

  it("con un modificatore, le frecce non lo aprono", () => {
    mount();
    kind().focus();
    expect(key("ArrowDown", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(key("ArrowDown", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(kind().getAttribute("aria-expanded")).toBe("false");
  });

  it("dentro il menu le frecce passano da una voce all'altra e Invio sceglie", () => {
    mount();
    kind().focus();
    key("ArrowDown");
    key("ArrowDown", {}, menu());
    expect(document.activeElement).toBe(entry("Incrociata"));
    key("ArrowDown", {}, menu());
    expect(document.activeElement).toBe(entry("Orizzontale"));
    key("Home", {}, menu());
    expect(document.activeElement).toBe(entry("Nessuna"));
    key("End", {}, menu());
    expect(document.activeElement).toBe(entry("Quadrettata"));
    // Invio, su un pulsante, è un clic.
    click(entry("Quadrettata"));
    expect(lastSent().change).toEqual({ preset: "grid" });
  });

  it("Esc chiude il menu, e il pulsante torna a dire che non è aperto", () => {
    mount();
    kind().focus();
    key("ArrowDown");
    expect(kind().getAttribute("aria-expanded")).toBe("true");
    key("Escape", {}, menu());
    expect(kind().getAttribute("aria-expanded")).toBe("false");
    expect(sent).toEqual([]);
  });
});

describe("i campi", () => {
  it("hanno i nomi nell'ordine, ciascuno con la sua unità che si sente", () => {
    mount();
    expect(["color", "background", "spacing", "width", "angle"].map(labelOf)).toEqual(["Colore", "Fondo", "Passo", "Spessore", "Angolo"]);
    expect(["spacing", "width", "angle"].map(nameOf)).toEqual(["Passo (px)", "Spessore (px)", "Angolo (°)"]);
    expect(["spacing", "width", "angle"].map((id) => field(id).querySelector(".draw-properties-unit")!.textContent)).toEqual(["px", "px", "°"]);
    expect(group().getAttribute("role")).toBe("group");
    expect(group().getAttribute("aria-label")).toBe("Campitura");
  });

  it("dicono i valori: il colore, il fondo (Nessuno), i numeri nell'unità del disegno", () => {
    mount();
    expect(["color", "background", "spacing", "width", "angle"].map((id) => input(id).value)).toEqual(["#0072b2", "Nessuno", "8", "1", "45"]);
    state.view = viewOf({ background: "#fff2cc", spacing: 12.345 });
    update();
    expect(input("background").value).toBe("#fff2cc");
    expect(input("spacing").value).toBe("12,35");
  });

  it("le lunghezze seguono l'unità dello spessore del contorno", () => {
    mount(viewOf({ spacing: fromUnit(2, "mm"), width: fromUnit(0.25, "mm") }, { unit: "mm" }));
    expect(input("spacing").value).toBe("2");
    expect(input("width").value).toBe("0,25");
    expect(nameOf("spacing")).toBe("Passo (mm)");
    expect(field("spacing").querySelector(".draw-properties-unit")!.textContent).toBe("mm");
    // Un valore scritto prende l'unità del campo, e quella che dice.
    enter(input("spacing"), "3");
    expect((lastSent().change as { spacing: number }).spacing).toBeCloseTo(fromUnit(3, "mm"), 2);
    enter(input("width"), "0.5mm");
    expect((lastSent().change as { width: number }).width).toBeCloseTo(fromUnit(0.5, "mm"), 2);
    enter(input("spacing"), "1in");
    expect((lastSent().change as { spacing: number }).spacing).toBe(96);
  });

  it("con soli puntini lo spessore è il diametro, e il suo passo ha il suo nome", () => {
    mount(viewOf({ choice: "dots", kind: "dots" }));
    expect(labelOf("width")).toBe("Diametro");
    expect(nameOf("width")).toBe("Diametro (px)");
    enter(input("width"), "3");
    expect(lastSent()).toEqual({ change: { width: 3 }, label: "draw.action.hatch_diameter" });
    state.view = viewOf({ choice: "cross", kind: "cross" });
    update();
    expect(labelOf("width")).toBe("Spessore");
    // Con righe e puntini insieme, resta lo spessore.
    state.view = viewOf({ count: 2, hatched: 2, choice: null, kind: null });
    update();
    expect(labelOf("width")).toBe("Spessore");
  });

  it("i numeri sono campi di valore con limiti, il valore e il testo che si sentono; i colori sono campi di testo", () => {
    mount();
    expect(["spacing", "width", "angle"].map((id) => input(id).getAttribute("role"))).toEqual(["spinbutton", "spinbutton", "spinbutton"]);
    expect(["color", "background", "name"].map((id) => field(id).querySelector("input")!.getAttribute("role"))).toEqual([null, null, null]);
    expect(input("spacing").getAttribute("aria-valuenow")).toBe("8");
    expect(input("spacing").getAttribute("aria-valuemin")).toBe(String(MIN_SPACING));
    expect(input("spacing").getAttribute("aria-valuemax")).toBe(String(MAX_SPACING));
    expect(input("spacing").getAttribute("aria-valuetext")).toBe("8 px");
    // Lo spessore non passa il passo.
    expect(input("width").getAttribute("aria-valuemin")).toBe(String(MIN_WIDTH));
    expect(input("width").getAttribute("aria-valuemax")).toBe("8");
    expect(input("angle").getAttribute("aria-valuenow")).toBe("45");
    expect(input("angle").getAttribute("aria-valuemin")).toBe("-180");
    expect(input("angle").getAttribute("aria-valuemax")).toBe("180");
    expect(input("angle").getAttribute("aria-valuetext")).toBe("45 °");
    // Ogni campo ha il suo nome da un'etichetta.
    for (const id of ["color", "background", "spacing", "width", "angle"]) {
      expect(document.querySelector(`label[for="${input(id).id}"]`)).not.toBeNull();
    }
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un valore misto è vuoto, dice «Misto» e non ha valore", () => {
    mount(viewOf({ count: 2, hatched: 2, choice: null, angle: null, spacing: null, width: null, color: null, background: null }));
    for (const id of ["color", "background", "spacing", "width", "angle"]) {
      expect(input(id).value).toBe("");
      expect(input(id).placeholder).toBe("Misto");
    }
    for (const id of ["spacing", "width", "angle"]) {
      expect(input(id).hasAttribute("aria-valuenow")).toBe(false);
      expect(input(id).getAttribute("aria-valuetext")).toBe("Misto");
    }
    expect(chip("color").querySelector<HTMLElement>(".draw-swatch-frame")!.dataset.shape).toBe("mixed");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("il campione del colore ha il colore, e quello del fondo senza fondo è barrato", () => {
    mount();
    expect(chip("color").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#0072b2");
    expect(chip("background").querySelector<HTMLElement>(".draw-swatch-frame")!.dataset.shape).toBe("none");
    expect(chip("background").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("");
    expect(chip("color").getAttribute("aria-label")).toBe("Colore: campioni");
    expect(chip("color").getAttribute("aria-haspopup")).toBe("menu");
    expect(picker("color").getAttribute("aria-label")).toBe("Colore: selettore del sistema");
    expect(picker("color").value).toBe("#0072b2");
  });
});

describe("scrivere un numero", () => {
  it("Invio scrive il valore, col nome del suo passo", () => {
    mount();
    enter(input("spacing"), "12");
    expect(lastSent()).toEqual({ change: { spacing: 12 }, label: "draw.action.hatch_spacing" });
    expect(input("spacing").value).toBe("12");
    expect(document.activeElement).toBe(input("spacing"));
    enter(input("width"), "2");
    expect(lastSent()).toEqual({ change: { width: 2 }, label: "draw.action.hatch_width" });
    enter(input("angle"), "30");
    expect(lastSent()).toEqual({ change: { angle: 30 }, label: "draw.action.hatch_angle" });
    expect(sent).toHaveLength(3);
    expect(errorOf("spacing").hidden).toBe(true);
  });

  it("calcola le espressioni e segue le unità e le percentuali", () => {
    mount();
    enter(input("spacing"), "2*5");
    expect((lastSent().change as { spacing: number }).spacing).toBe(10);
    enter(input("spacing"), "50%");
    expect((lastSent().change as { spacing: number }).spacing).toBe(5);
    enter(input("angle"), "90-135");
    expect((lastSent().change as { angle: number }).angle).toBe(-45);
    enter(input("angle"), "0.5°");
    expect((lastSent().change as { angle: number }).angle).toBe(0.5);
  });

  it("tiene i valori nei limiti", () => {
    mount();
    enter(input("spacing"), "0");
    expect((lastSent().change as { spacing: number }).spacing).toBe(MIN_SPACING);
    enter(input("spacing"), "99999");
    expect((lastSent().change as { spacing: number }).spacing).toBe(MAX_SPACING);
    // Lo spessore non passa il passo (adesso 1000), né scende sotto il minimo.
    enter(input("width"), "5000");
    expect((lastSent().change as { width: number }).width).toBe(MAX_SPACING);
    enter(input("width"), "0");
    expect((lastSent().change as { width: number }).width).toBe(MIN_WIDTH);
    // L'angolo si porta tra -180 e 180.
    enter(input("angle"), "270");
    expect((lastSent().change as { angle: number }).angle).toBe(-90);
    enter(input("angle"), "-180");
    expect((lastSent().change as { angle: number }).angle).toBe(180);
  });

  it("un valore uguale non scrive niente, e il campo dice com'era", () => {
    mount();
    enter(input("spacing"), "8");
    enter(input("angle"), "45");
    enter(input("spacing"), "4+4");
    expect(sent).toEqual([]);
    expect(input("spacing").value).toBe("8");
  });

  it("su e giù cambiano di 1, con Maiusc di 10, e partono subito", () => {
    mount();
    input("spacing").focus();
    const up = key("ArrowUp");
    expect(up.defaultPrevented).toBe(true);
    expect(lastSent().change).toEqual({ spacing: 9 });
    key("ArrowUp", { shiftKey: true });
    expect(lastSent().change).toEqual({ spacing: 19 });
    key("ArrowDown");
    expect(lastSent().change).toEqual({ spacing: 18 });
    key("ArrowDown", { shiftKey: true });
    expect(lastSent().change).toEqual({ spacing: 8 });
    expect(input("spacing").value).toBe("8");
    // I passi di seguito hanno lo stesso nome, e la cronologia li unisce.
    expect(sent.map((each) => each.label)).toEqual(Array(4).fill("draw.action.hatch_spacing"));
    // L'angolo gira, e il passo non scende sotto il minimo.
    input("angle").focus();
    key("ArrowUp", { shiftKey: true });
    expect(lastSent()).toEqual({ change: { angle: 55 }, label: "draw.action.hatch_angle" });
    for (let step = 0; step < 14; step += 1) key("ArrowUp", { shiftKey: true });
    expect((lastSent().change as { angle: number }).angle).toBe(-165);
    input("spacing").focus();
    for (let step = 0; step < 3; step += 1) key("ArrowDown", { shiftKey: true });
    expect((lastSent().change as { spacing: number }).spacing).toBe(MIN_SPACING);
  });

  it("su e giù contano nell'unità del campo", () => {
    mount(viewOf({ spacing: fromUnit(2, "mm") }, { unit: "mm" }));
    input("spacing").focus();
    key("ArrowUp");
    expect((lastSent().change as { spacing: number }).spacing).toBeCloseTo(fromUnit(3, "mm"), 2);
    expect(input("spacing").value).toBe("3");
  });

  it("su e giù partono dal valore scritto a metà", () => {
    mount();
    type(input("spacing"), "20");
    key("ArrowUp");
    expect(lastSent().change).toEqual({ spacing: 21 });
    expect(input("spacing").value).toBe("21");
  });

  it("su e giù con un valore misto e niente di scritto dicono che i valori sono diversi", () => {
    mount(viewOf({ count: 2, hatched: 2, choice: null, spacing: null }));
    input("spacing").focus();
    key("ArrowUp");
    expect(sent).toEqual([]);
    expect(announced).toEqual(["I valori sono diversi: scrivi quello da dare a tutti."]);
    // Scritto un valore, parte da lì.
    type(input("spacing"), "6");
    key("ArrowUp");
    expect(lastSent().change).toEqual({ spacing: 7 });
  });

  it("scrivere un valore misto lo dà a tutti, in un passo", () => {
    mount(viewOf({ count: 2, hatched: 2, choice: null, spacing: null }));
    enter(input("spacing"), "10");
    expect(sent).toHaveLength(1);
    expect(lastSent().change).toEqual({ spacing: 10 });
    expect(input("spacing").value).toBe("10");
  });

  it("Esc riporta com'era e, di nuovo, lascia il tasto al foglio", () => {
    mount();
    type(input("spacing"), "9");
    const first = key("Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(input("spacing").value).toBe("8");
    expect(sent).toEqual([]);
    const second = key("Escape");
    expect(second.defaultPrevented).toBe(false);
    // Con un errore scritto, Esc lo toglie.
    enter(input("spacing"), "abc");
    expect(errorOf("spacing").hidden).toBe(false);
    key("Escape");
    expect(errorOf("spacing").hidden).toBe(true);
    expect(input("spacing").hasAttribute("aria-invalid")).toBe(false);
    expect(input("spacing").value).toBe("8");
  });

  it("un valore che non va resta scritto, segnato, col messaggio accanto, e a voce", () => {
    mount();
    enter(input("spacing"), "abc");
    expect(sent).toEqual([]);
    expect(input("spacing").value).toBe("abc");
    expect(input("spacing").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("spacing").hidden).toBe(false);
    expect(errorOf("spacing").textContent).toBe("Scrivi un numero o un calcolo, come 120+15.");
    expect(input("spacing").getAttribute("aria-describedby")).toBe(errorOf("spacing").id);
    expect(announced).toEqual(["Scrivi un numero o un calcolo, come 120+15."]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un'unità che il campo non ha, e un campo vuoto, non vanno.
    enter(input("angle"), "3mm");
    expect(input("spacing").hasAttribute("aria-invalid")).toBe(false);
    expect(input("angle").getAttribute("aria-invalid")).toBe("true");
    enter(input("angle"), "");
    expect(errorOf("angle").textContent).toBe("Scrivi un valore.");
    // Corretto, l'errore se ne va.
    enter(input("angle"), "10");
    expect(input("angle").hasAttribute("aria-invalid")).toBe(false);
    expect(errorOf("angle").hidden).toBe(true);
    expect(lastSent().change).toEqual({ angle: 10 });
  });

  it("lasciare il campo scrive, senza parlare se il valore non va", () => {
    mount();
    type(input("spacing"), "11");
    input("angle").focus();
    expect(lastSent().change).toEqual({ spacing: 11 });
    announced.length = 0;
    type(input("angle"), "zzz");
    input("spacing").focus();
    expect(input("angle").getAttribute("aria-invalid")).toBe("true");
    expect(announced).toEqual([]);
  });

  it("se l'editor rifiuta il valore, il campo resta com'era scritto e dice perché", () => {
    mount();
    refusal = "Non si può.";
    enter(input("spacing"), "6");
    expect(sent).toHaveLength(1);
    expect(input("spacing").value).toBe("6");
    expect(input("spacing").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("spacing").textContent).toBe("Non si può.");
    expect(announced).toEqual(["Non si può."]);
    // Il valore del disegno non è cambiato.
    expect(state.view.hatch.spacing).toBe(8);
  });

  it("il fuoco resta sul campo quando il disegno cambia sotto, anche con un'altra chiave", () => {
    mount();
    rekey = true;
    enter(input("spacing"), "12");
    expect(document.activeElement).toBe(input("spacing"));
    expect(input("spacing").value).toBe("12");
    // Un valore a metà non si perde per un aggiornamento con la stessa chiave.
    type(input("angle"), "7");
    update();
    expect(input("angle").value).toBe("7");
    // Con un'altra selezione, il campo torna al disegno.
    state.view = { ...state.view, key: "altra" };
    update();
    expect(input("angle").value).toBe("45");
  });
});

describe("scrivere un colore", () => {
  it("è un codice, un nome o il nome di un campione, e si copia il colore", () => {
    mount();
    enter(input("color"), "#FF0000");
    expect(lastSent()).toEqual({ change: { color: "#ff0000" }, label: "draw.action.hatch_color" });
    enter(input("color"), "blue");
    expect(lastSent().change).toEqual({ color: "#0000ff" });
    enter(input("color"), "00ff00");
    expect(lastSent().change).toEqual({ color: "#00ff00" });
    enter(input("color"), "blu MARCA");
    expect(lastSent().change).toEqual({ color: "#0072b2" });
    // Il campo dice il codice che si è scritto, non il nome del campione.
    expect(input("color").value).toBe("#0072b2");
    expect(picker("color").value).toBe("#0072b2");
    expect(chip("color").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#0072b2");
    const count = sent.length;
    enter(input("color"), "non è un colore");
    expect(sent).toHaveLength(count);
    expect(input("color").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("color").textContent).toBe("Scrivi un colore: un codice come #0072b2, un nome come red, o il nome di un campione del documento.");
    expect(announced).toEqual([errorOf("color").textContent]);
  });

  it("il fondo è un colore, o «nessuno»", () => {
    mount();
    enter(input("background"), "#ffffcc");
    expect(lastSent()).toEqual({ change: { background: "#ffffcc" }, label: "draw.action.hatch_background" });
    expect(input("background").value).toBe("#ffffcc");
    enter(input("background"), "nessuno");
    expect(lastSent()).toEqual({ change: { background: null }, label: "draw.action.hatch_background" });
    expect(input("background").value).toBe("Nessuno");
    expect(chip("background").querySelector<HTMLElement>(".draw-swatch-frame")!.dataset.shape).toBe("none");
    enter(input("background"), "NONE");
    expect(sent).toHaveLength(2);
    enter(input("background"), "boh");
    expect(errorOf("background").textContent).toBe("Scrivi un colore: un codice come #0072b2, un nome come red, il nome di un campione, o «nessuno».");
  });

  it("il colore delle righe non ha «nessuno»", () => {
    mount();
    enter(input("color"), "nessuno");
    expect(input("color").getAttribute("aria-invalid")).toBe("true");
    expect(sent).toEqual([]);
  });

  it("un colore uguale non scrive niente, e un campo che non cambia non dice niente", () => {
    mount();
    enter(input("color"), "#0072B2");
    enter(input("background"), "nessuno");
    expect(sent).toEqual([]);
    expect(announced).toEqual([]);
    expect(input("color").getAttribute("aria-invalid")).toBeNull();
  });

  it("Esc riporta il colore e il campione com'erano", () => {
    mount();
    type(input("color"), "#123456");
    expect(chip("color").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#123456");
    key("Escape");
    expect(input("color").value).toBe("#0072b2");
    expect(chip("color").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#0072b2");
    expect(picker("color").value).toBe("#0072b2");
  });

  it("il selettore del sistema mostra il colore mentre lo si muove e lo scrive quando lo si sceglie", () => {
    mount();
    const system = picker("color");
    system.value = "#102030";
    system.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input("color").value).toBe("#102030");
    expect(sent).toEqual([]);
    expect(chip("color").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#102030");
    system.dispatchEvent(new Event("change", { bubbles: true }));
    expect(lastSent()).toEqual({ change: { color: "#102030" }, label: "draw.action.hatch_color" });
    // Chiuso senza scegliere, il campo torna al disegno.
    system.value = "#445566";
    system.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input("color").value).toBe("#445566");
    input("spacing").focus();
    expect(input("color").value).toBe("#102030");
  });

  it("il campione apre i colori del documento e della tavolozza, e ogni voce scrive il colore", () => {
    mount();
    click(chip("color"));
    expect(chip("color").getAttribute("aria-expanded")).toBe("true");
    expect(labels()).toHaveLength(1 + 8);
    expect(labels().slice(0, 3)).toEqual(["Blu marca", "Nero", "Blu"]);
    expect(reason("Blu marca")).toBe("Campione #0072b2");
    // Il colore di adesso è segnato.
    expect(entry("Blu marca").getAttribute("aria-checked")).toBe("true");
    expect(entry("Nero").getAttribute("aria-checked")).toBe("false");
    click(entry("Nero"));
    expect(lastSent()).toEqual({ change: { color: "#000000" }, label: "draw.action.hatch_color" });
    expect(input("color").value).toBe("#000000");
    expect(chip("color").getAttribute("aria-expanded")).toBe("false");
  });

  it("il campione del fondo ha anche «Nessuno», in testa", () => {
    mount(viewOf({ background: "#ffffcc" }));
    click(chip("background"));
    expect(labels()[0]).toBe("Nessuno");
    expect(entry("Nessuno").getAttribute("aria-checked")).toBe("false");
    click(entry("Nessuno"));
    expect(lastSent().change).toEqual({ background: null });
    expect(input("background").value).toBe("Nessuno");
    click(chip("background"));
    expect(entry("Nessuno").getAttribute("aria-checked")).toBe("true");
  });
});

describe("il motivo del documento", () => {
  const motifView = (more: Partial<HatchPanelView> = {}): HatchPanelView =>
    viewOf({ choice: "pattern:ra", hatched: 0, kind: null, angle: null, spacing: null, width: null, color: null, background: null }, { expert: true, ...more });

  it("Invio lo rinomina, e lo dice a chi ascolta il pannello", () => {
    mount(motifView());
    enter(input("name"), "  Righe   blu ");
    expect(calls).toEqual(["rename ra Righe blu"]);
    expect(input("name").value).toBe("Righe blu");
    expect(kind().textContent).toBe("Righe blu");
    expect(motifGroup().getAttribute("aria-label")).toBe("Motivo «Righe blu»");
    expect(errorOf("name").hidden).toBe(true);
    expect(document.activeElement).toBe(input("name"));
  });

  it("lasciare il campo lo rinomina, e lo stesso nome non fa niente", () => {
    mount(motifView());
    type(input("name"), "Altro");
    input("name").blur();
    expect(calls).toEqual(["rename ra Altro"]);
    enter(input("name"), "Altro");
    expect(calls).toEqual(["rename ra Altro"]);
  });

  it("un nome che non va resta scritto, segnato, e dice perché", () => {
    mount(motifView());
    enter(input("name"), "");
    expect(input("name").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("name").textContent).toBe("Scrivi un nome.");
    expect(input("name").getAttribute("aria-describedby")).toBe(errorOf("name").id);
    expect(announced).toEqual(["Scrivi un nome."]);
    // Come un campione, o un altro motivo, già c'è.
    enter(input("name"), "pois");
    expect(errorOf("name").textContent).toBe("C’è già un campione o un motivo «pois»: scegline un altro.");
    enter(input("name"), "blu marca");
    expect(errorOf("name").textContent).toBe("C’è già un campione o un motivo «blu marca»: scegline un altro.");
    // Un nome che si legge come un colore non vale.
    enter(input("name"), "#ff0000");
    expect(errorOf("name").textContent).toBe("«#ff0000» si legge come un colore, non come un nome: scegline un altro.");
    enter(input("name"), "nessuno");
    expect(errorOf("name").textContent).toBe("«nessuno» si legge come un colore, non come un nome: scegline un altro.");
    expect(calls).toEqual([]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Corretto, l'errore se ne va; il nome che ha già non è un problema.
    enter(input("name"), "Nuovo");
    expect(errorOf("name").hidden).toBe(true);
    expect(calls).toEqual(["rename ra Nuovo"]);
    enter(input("name"), "NUOVO");
    expect(calls).toEqual(["rename ra Nuovo", "rename ra NUOVO"]);
  });

  it("se l'editor rifiuta il nome, il campo resta com'era scritto e dice perché", () => {
    mount(motifView());
    refusal = "Non si può.";
    enter(input("name"), "Nuovo");
    expect(input("name").value).toBe("Nuovo");
    expect(input("name").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("name").textContent).toBe("Non si può.");
    expect(announced).toEqual(["Non si può."]);
  });

  it("Esc riporta il nome com'era, e di nuovo lascia il tasto al foglio", () => {
    mount(motifView());
    type(input("name"), "Boh");
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(input("name").value).toBe("Tratti blu");
    expect(key("Escape").defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
  });

  it("«Elimina motivo» lo elimina e il fuoco resta nella sezione, al menu", () => {
    mount(motifView());
    deleteButton().focus();
    click(deleteButton());
    expect(calls).toEqual(["delete ra"]);
    expect(motifGroup().hidden).toBe(true);
    expect(kind().textContent).toBe("Nessuna");
    expect(document.activeElement).toBe(kind());
    expect(announced).toEqual([]);
  });

  it("se l'editor non lo elimina, lo dice sotto, e a voce", () => {
    mount(motifView());
    deleteRefusal = "Non si può eliminare.";
    click(deleteButton());
    expect(errorOf("name").textContent).toBe("Non si può eliminare.");
    expect(errorOf("name").hidden).toBe(false);
    expect(announced).toEqual(["Non si può eliminare."]);
    expect(motifGroup().hidden).toBe(false);
  });
});

describe("la sola lettura", () => {
  it("tutto si guarda e niente cambia", () => {
    mount(viewOf({}, { expert: true }), false);
    expect(kind().getAttribute("aria-disabled")).toBe("true");
    for (const id of ["color", "background", "spacing", "width", "angle"]) expect(input(id).readOnly).toBe(true);
    expect([chip("color"), chip("background")].every((each) => each.disabled)).toBe(true);
    expect([picker("color"), picker("background")].every((each) => each.disabled)).toBe(true);
    // Il menu non si apre, e lo dice.
    click(kind());
    expect(announced).toEqual([READ_ONLY]);
    expect(kind().getAttribute("aria-expanded")).toBe("false");
    key("ArrowDown", {}, kind());
    expect(announced).toEqual([READ_ONLY, READ_ONLY]);
    expect(document.querySelectorAll(".context-menu")).toHaveLength(0);
    type(input("spacing"), "5");
    key("Enter");
    key("ArrowUp");
    expect(sent).toEqual([]);
    expect(announced).toEqual([READ_ONLY, READ_ONLY, READ_ONLY]);
    click(chip("color"));
    expect(sent).toEqual([]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("anche il motivo si guarda: il nome è di sola lettura e «Elimina motivo» lo dice", () => {
    mount(viewOf({ choice: "pattern:ra", hatched: 0 }, { expert: true }), false);
    expect(input("name").readOnly).toBe(true);
    expect(deleteButton().getAttribute("aria-disabled")).toBe("true");
    click(deleteButton());
    type(input("name"), "Altro");
    key("Enter");
    expect(calls).toEqual([]);
    expect(announced).toEqual([READ_ONLY]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("torna a poter cambiare quando il disegno si può modificare", () => {
    mount(viewOf(), false);
    state.editable = true;
    update();
    expect(kind().hasAttribute("aria-disabled")).toBe(false);
    expect(input("spacing").readOnly).toBe(false);
    enter(input("spacing"), "9");
    expect(lastSent().change).toEqual({ spacing: 9 });
  });
});

describe("il fuoco", () => {
  it("un campo che se ne va lascia il fuoco al menu, nella sezione", () => {
    mount();
    input("color").focus();
    state.view = viewOf(NONE);
    update();
    expect(document.activeElement).toBe(kind());
  });

  it("un valore scritto in un campo nascosto non si scrive", () => {
    mount();
    type(input("spacing"), "30");
    state.view = viewOf(NONE);
    update();
    expect(sent).toEqual([]);
  });
});

describe("la lingua", () => {
  it("riscrive i testi e i numeri nella lingua dell'app", () => {
    mount(viewOf({ spacing: 12.5 }));
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(kind().textContent).toBe("Diagonal");
    expect(kind().getAttribute("aria-label")).toBe("Type: Diagonal");
    expect(["color", "background", "spacing", "width", "angle"].map(labelOf)).toEqual(["Color", "Background", "Spacing", "Line width", "Angle"]);
    expect(input("background").value).toBe("None");
    expect(input("spacing").value).toBe("12.5");
    expect(chip("color").getAttribute("aria-label")).toBe("Color: swatches");
    expect(group().getAttribute("aria-label")).toBe("Hatch");
    click(kind());
    expect(labels()).toEqual(["None", "Diagonal", "Crosshatch", "Horizontal", "Dotted", "Grid"]);
  });

  it("anche il diametro, la nota, il motivo e i suoi comandi", () => {
    mount(viewOf({ choice: "dots", kind: "dots" }));
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(labelOf("width")).toBe("Diameter");
    state.view = viewOf({ choice: "other", hatched: 0, kind: null }, { expert: true });
    update();
    expect(kind().textContent).toBe("Other pattern");
    expect(note().textContent).toBe("This is a pattern from another program: FubDraw leaves it as it is. Choosing another one replaces it.");
    state.view = viewOf({ choice: "pattern:ra", hatched: 0, kind: null }, { expert: true });
    update();
    expect(motifGroup().getAttribute("aria-label")).toBe("Pattern “Tratti blu”");
    expect(labelOf("name")).toBe("Name");
    expect(deleteButton().textContent).toBe("Delete pattern");
    click(kind());
    expect(labels().slice(-1)).toEqual(["Pattern from selection"]);
  });
});
